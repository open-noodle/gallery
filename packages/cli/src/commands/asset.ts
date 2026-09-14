import {
  AssetBulkUploadCheckItem,
  AssetBulkUploadCheckResult,
  AssetMediaResponseDto,
  AssetMediaStatus,
  AssetUploadAction,
  AssetVisibility,
  Permission,
  UploadSessionResponseDto,
  addAssetsToAlbum,
  checkBulkUpload,
  createAlbum,
  defaults,
  getAllAlbums,
  getServerConfig,
  getSupportedMediaTypes,
} from '@immich/sdk';
import byteSize from 'byte-size';
import { Matcher, watch as watchFs } from 'chokidar';
import { MultiBar, Presets, SingleBar } from 'cli-progress';
import { chunk } from 'lodash-es';
import micromatch from 'micromatch';
import { Stats, createReadStream, existsSync } from 'node:fs';
import { open, readFile, stat, unlink } from 'node:fs/promises';
import path, { basename } from 'node:path';
import { Queue } from 'src/queue';
import { BaseOptions, Batcher, authenticate, crawl, requirePermissions, s, sha1 } from 'src/utils';

const UPLOAD_WATCH_BATCH_SIZE = 100;
const UPLOAD_WATCH_DEBOUNCE_TIME_MS = 10_000;
// Inline XMP sidecars are capped at 1 MiB (spec §4.3 / §8 row 8).
const MAX_INLINE_SIDECAR_BYTES = 1024 * 1024;

// TODO figure out why `id` is missing
type AssetBulkUploadCheckResults = Array<AssetBulkUploadCheckResult & { id: string }>;
type Asset = { id: string; filepath: string };

export interface UploadOptionsDto {
  recursive?: boolean;
  ignore?: string;
  dryRun?: boolean;
  skipHash?: boolean;
  delete?: boolean;
  deleteDuplicates?: boolean;
  album?: boolean;
  albumName?: string;
  visibility?: AssetVisibility;
  includeHidden?: boolean;
  concurrency: number;
  progress?: boolean;
  watch?: boolean;
  jsonOutput?: boolean;
}

class UploadFile extends File {
  constructor(
    private filepath: string,
    private _size: number,
  ) {
    super([], basename(filepath));
  }

  // @ts-expect-error size is already a property on the new File interface
  get size() {
    return this._size;
  }

  stream() {
    return createReadStream(this.filepath) as any;
  }
}

const uploadBatch = async (files: string[], options: UploadOptionsDto) => {
  const { newFiles, duplicates } = await checkForDuplicates(files, options);
  const newAssets = await uploadFiles(newFiles, options);
  if (options.jsonOutput) {
    console.log(JSON.stringify({ newFiles, duplicates, newAssets }, undefined, 4));
  }
  await updateAlbums([...newAssets, ...duplicates], options);

  await deleteFiles(newAssets, duplicates, options);
};

export const startWatch = async (
  paths: string[],
  options: UploadOptionsDto,
  {
    batchSize = UPLOAD_WATCH_BATCH_SIZE,
    debounceTimeMs = UPLOAD_WATCH_DEBOUNCE_TIME_MS,
  }: { batchSize?: number; debounceTimeMs?: number } = {},
) => {
  const watcherIgnored: Matcher[] = [];
  const { image, video } = await getSupportedMediaTypes();
  const extensions = new Set([...image, ...video]);

  if (options.ignore) {
    watcherIgnored.push((path) => micromatch.contains(path, `**/${options.ignore}`));
  }

  const pathsBatcher = new Batcher<string>({
    batchSize,
    debounceTimeMs,
    onBatch: async (paths: string[]) => {
      const uniquePaths = [...new Set(paths)];
      await uploadBatch(uniquePaths, options);
    },
  });

  const onFile = async (path: string, stats?: Stats) => {
    if (stats?.isDirectory()) {
      return;
    }
    const ext = '.' + path.split('.').pop()?.toLowerCase();
    if (!ext || !extensions.has(ext)) {
      return;
    }

    if (!options.progress) {
      // logging when progress is disabled as it can cause issues with the progress bar rendering
      console.log(`Change detected: ${path}`);
    }
    pathsBatcher.add(path);
  };
  const fsWatcher = watchFs(paths, {
    ignoreInitial: true,
    ignored: watcherIgnored,
    alwaysStat: true,
    awaitWriteFinish: true,
    depth: options.recursive ? undefined : 1,
    persistent: true,
  })
    .on('add', onFile)
    .on('change', onFile)
    .on('error', (error) => console.error(`Watcher error: ${error}`));

  process.on('SIGINT', async () => {
    console.log('Exiting...');
    await fsWatcher.close();
    process.exit();
  });
};

export const upload = async (paths: string[], baseOptions: BaseOptions, options: UploadOptionsDto) => {
  await authenticate(baseOptions);
  await requirePermissions([Permission.AssetUpload]);

  const scanFiles = await scan(paths, options);

  if (scanFiles.length === 0) {
    if (options.watch) {
      console.log('No files found initially.');
    } else {
      console.log('No files found, exiting');
      return;
    }
  }

  if (options.watch) {
    console.log('Watching for changes...');
    await startWatch(paths, options);
    // watcher does not handle the initial scan
    // as the scan() is a more efficient quick start with batched results
  }

  await uploadBatch(scanFiles, options);
};

const scan = async (pathsToCrawl: string[], options: UploadOptionsDto) => {
  const { image, video } = await getSupportedMediaTypes();

  console.log('Crawling for assets...');
  const files = await crawl({
    pathsToCrawl,
    recursive: options.recursive,
    exclusionPattern: options.ignore,
    includeHidden: options.includeHidden,
    extensions: [...image, ...video],
  });

  return files;
};

export const checkForDuplicates = async (files: string[], { concurrency, skipHash, progress }: UploadOptionsDto) => {
  if (skipHash) {
    console.log('Skipping hash check, assuming all files are new');
    return { newFiles: files, duplicates: [] };
  }

  let multiBar: MultiBar | undefined;
  let totalSize = 0;
  const statsMap = new Map<string, Stats>();

  // Calculate total size first
  for (const filepath of files) {
    const stats = await stat(filepath);
    statsMap.set(filepath, stats);
    totalSize += stats.size;
  }

  if (progress) {
    multiBar = new MultiBar(
      {
        format: '{message} | {bar} | {percentage}% | ETA: {eta_formatted} | {value}/{total}',
        formatValue: (v: number, options, type) => {
          // Don't format percentage
          if (type === 'percentage') {
            return v.toString();
          }
          return byteSize(v).toString();
        },
        etaBuffer: 100, // Increase samples for ETA calculation
      },
      Presets.shades_classic,
    );

    // Ensure we restore cursor on interrupt
    process.on('SIGINT', () => {
      if (multiBar) {
        multiBar.stop();
      }
      process.exit(0);
    });
  } else {
    console.log(`Received ${files.length} files (${byteSize(totalSize)}), hashing...`);
  }

  const hashProgressBar = multiBar?.create(totalSize, 0, {
    message: 'Hashing files          ',
  });
  const checkProgressBar = multiBar?.create(totalSize, 0, {
    message: 'Checking for duplicates',
  });

  const newFiles: string[] = [];
  const duplicates: Asset[] = [];

  const checkBulkUploadQueue = new Queue<AssetBulkUploadCheckItem[], void>(
    async (assets: AssetBulkUploadCheckItem[]) => {
      const response = await checkBulkUpload({ assetBulkUploadCheckDto: { assets } });

      const results = response.results as AssetBulkUploadCheckResults;

      for (const { id: filepath, assetId, action } of results) {
        if (action === AssetUploadAction.Accept) {
          newFiles.push(filepath);
        } else {
          // rejects are always duplicates
          duplicates.push({ id: assetId as string, filepath });
        }
      }

      // Update progress based on total size of processed files
      let processedSize = 0;
      for (const asset of assets) {
        const stats = statsMap.get(asset.id);
        processedSize += stats?.size || 0;
      }
      checkProgressBar?.increment(processedSize);
    },
    { concurrency, retry: 3 },
  );

  const results: { id: string; checksum: string }[] = [];
  let checkBulkUploadRequests: AssetBulkUploadCheckItem[] = [];

  const queue = new Queue<string, AssetBulkUploadCheckItem[]>(
    async (filepath: string): Promise<AssetBulkUploadCheckItem[]> => {
      const stats = statsMap.get(filepath);
      if (!stats) {
        throw new Error(`Stats not found for ${filepath}`);
      }
      const dto = { id: filepath, checksum: await sha1(filepath) };

      results.push(dto);
      checkBulkUploadRequests.push(dto);
      if (checkBulkUploadRequests.length === 5000) {
        const batch = checkBulkUploadRequests;
        checkBulkUploadRequests = [];
        void checkBulkUploadQueue.push(batch);
      }

      hashProgressBar?.increment(stats.size);
      return results;
    },
    { concurrency, retry: 3 },
  );

  for (const item of files) {
    void queue.push(item);
  }

  await queue.drained();

  if (checkBulkUploadRequests.length > 0) {
    void checkBulkUploadQueue.push(checkBulkUploadRequests);
  }

  await checkBulkUploadQueue.drained();

  multiBar?.stop();

  console.log(`Found ${newFiles.length} new files and ${duplicates.length} duplicate${s(duplicates.length)}`);

  // Report failures
  const failedTasks = queue.tasks.filter((task) => task.status === 'failed');
  if (failedTasks.length > 0) {
    console.log(`Failed to verify ${failedTasks.length} file${s(failedTasks.length)}:`);
    for (const task of failedTasks) {
      console.log(`- ${task.data} - ${task.error}`);
    }
  }

  return { newFiles, duplicates };
};

export const uploadFiles = async (files: string[], options: UploadOptionsDto): Promise<Asset[]> => {
  const { dryRun, concurrency, progress } = options;
  if (files.length === 0) {
    console.log('All assets were already uploaded, nothing to do.');
    return [];
  }

  // Compute total size first
  let totalSize = 0;
  const statsMap = new Map<string, Stats>();
  for (const filepath of files) {
    const stats = await stat(filepath);
    statsMap.set(filepath, stats);
    totalSize += stats.size;
  }

  if (dryRun) {
    console.log(`Would have uploaded ${files.length} asset${s(files.length)} (${byteSize(totalSize)})`);
    return files.map((filepath) => ({ id: '', filepath }));
  }

  let uploadProgress: SingleBar | undefined;

  if (progress) {
    uploadProgress = new SingleBar(
      {
        format: 'Uploading assets | {bar} | {percentage}% | ETA: {eta_formatted} | {value_formatted}/{total_formatted}',
      },
      Presets.shades_classic,
    );
  } else {
    console.log(`Uploading ${files.length} asset${s(files.length)} (${byteSize(totalSize)})`);
  }
  uploadProgress?.start(totalSize, 0);
  uploadProgress?.update({ value_formatted: 0, total_formatted: byteSize(totalSize) });

  let duplicateCount = 0;
  let duplicateSize = 0;
  let successCount = 0;
  let successSize = 0;
  // Single source of truth for the bar's position, so a per-chunk advance (chunked path) and a
  // per-file advance (single-shot path) can never double-count the same bytes.
  let transferredSize = 0;
  const reportTransferred = (bytes: number) => {
    transferredSize += bytes;
    uploadProgress?.increment(bytes, { value_formatted: byteSize(transferredSize + duplicateSize) });
  };

  const config = await getServerConfig();
  const uploadChunkSize = config?.uploadChunkSize ?? 0;

  const newAssets: Asset[] = [];

  const queue = new Queue<string, AssetMediaResponseDto>(
    async (filepath: string) => {
      const stats = statsMap.get(filepath);
      if (!stats) {
        throw new Error(`Stats not found for ${filepath}`);
      }

      let response: AssetMediaResponseDto;
      if (uploadChunkSize > 0 && stats.size > uploadChunkSize) {
        response = await uploadFileChunked(filepath, stats, options, uploadChunkSize, reportTransferred);
      } else {
        response = await uploadFile(filepath, stats, options);
        reportTransferred(stats.size);
      }

      newAssets.push({ id: response.id, filepath });
      if (response.status === AssetMediaStatus.Duplicate) {
        duplicateCount++;
        duplicateSize += stats.size ?? 0;
      } else {
        successCount++;
        successSize += stats.size ?? 0;
      }

      return response;
    },
    { concurrency, retry: 3 },
  );

  for (const item of files) {
    void queue.push(item);
  }

  await queue.drained();

  uploadProgress?.stop();

  console.log(`Successfully uploaded ${successCount} new asset${s(successCount)} (${byteSize(successSize)})`);
  if (duplicateCount > 0) {
    console.log(`Skipped ${duplicateCount} duplicate asset${s(duplicateCount)} (${byteSize(duplicateSize)})`);
  }

  // Report failures
  const failedTasks = queue.tasks.filter((task) => task.status === 'failed');
  if (failedTasks.length > 0) {
    console.log(`Failed to upload ${failedTasks.length} asset${s(failedTasks.length)}:`);
    for (const task of failedTasks) {
      console.log(`- ${task.data} - ${task.error}`);
    }
  }

  return newAssets;
};

const uploadFile = async (
  input: string,
  stats: Stats,
  { visibility }: UploadOptionsDto,
): Promise<AssetMediaResponseDto> => {
  const { baseUrl, headers } = defaults;

  const formData = new FormData();
  formData.append('fileCreatedAt', stats.mtime.toISOString());
  formData.append('fileModifiedAt', stats.mtime.toISOString());
  formData.append('fileSize', String(stats.size));
  formData.append('isFavorite', 'false');
  formData.append('assetData', new UploadFile(input, stats.size));
  if (visibility) {
    formData.append('visibility', visibility);
  }

  const sidecarPath = findSidecar(input);
  if (sidecarPath) {
    try {
      const stats = await stat(sidecarPath);
      const sidecarData = new UploadFile(sidecarPath, stats.size);
      formData.append('sidecarData', sidecarData);
    } catch {
      // noop
    }
  }

  const response = await fetch(`${baseUrl}/assets`, {
    method: 'post',
    redirect: 'error',
    headers: headers as Record<string, string>,
    body: formData,
    // eslint-disable-next-line unicorn/no-null
    window: null,
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<AssetMediaResponseDto>;
};

// Reads a sidecar as inline UTF-8 text for the create-session call (spec §4.3). Returns
// `undefined` (skip the sidecar, do not fail the whole upload) if it is missing, over the 1 MiB
// cap, or not valid UTF-8.
const readInlineSidecar = async (sidecarPath: string): Promise<string | undefined> => {
  try {
    const buffer = await readFile(sidecarPath);
    if (buffer.byteLength > MAX_INLINE_SIDECAR_BYTES) {
      return undefined;
    }
    const text = buffer.toString('utf8');
    // Round-trip check: re-encoding a truly UTF-8 buffer must reproduce it byte-for-byte. A
    // buffer containing invalid UTF-8 sequences decodes with U+FFFD replacement characters,
    // which breaks the round trip.
    if (!Buffer.from(text, 'utf8').equals(buffer)) {
      return undefined;
    }
    return text;
  } catch {
    return undefined;
  }
};

const uploadFileChunked = async (
  input: string,
  stats: Stats,
  { visibility }: UploadOptionsDto,
  chunkSize: number,
  onBytesUploaded?: (bytes: number) => void,
): Promise<AssetMediaResponseDto> => {
  const { baseUrl, headers } = defaults;

  const sessionCreateDto: Record<string, unknown> = {
    filename: basename(input),
    size: stats.size,
    fileCreatedAt: stats.mtime.toISOString(),
    fileModifiedAt: stats.mtime.toISOString(),
    isFavorite: false,
  };
  if (visibility) {
    sessionCreateDto.visibility = visibility;
  }

  const sidecarPath = findSidecar(input);
  if (sidecarPath) {
    const sidecar = await readInlineSidecar(sidecarPath);
    if (sidecar !== undefined) {
      sessionCreateDto.sidecar = sidecar;
    }
  }

  const sessionResponse = await fetch(`${baseUrl}/assets/upload-session`, {
    method: 'POST',
    redirect: 'error',
    headers: { ...headers, 'Content-Type': 'application/json' } as Record<string, string>,
    body: JSON.stringify(sessionCreateDto),
    // eslint-disable-next-line unicorn/no-null
    window: null,
  });
  if (sessionResponse.status !== 200 && sessionResponse.status !== 201) {
    throw new Error(await sessionResponse.text());
  }

  const sessionResult: unknown = await sessionResponse.json();
  if (sessionResponse.status === 200) {
    // The supplied checksum was already known: a duplicate, no session was created, and no
    // bytes were transferred.
    return sessionResult as AssetMediaResponseDto;
  }

  const session = sessionResult as UploadSessionResponseDto;

  let reportedBytes = 0;
  const report = (bytes: number) => {
    reportedBytes += bytes;
    onBytesUploaded?.(bytes);
  };

  const fileHandle = await open(input, 'r');
  try {
    let offset = 0;
    while (offset < stats.size) {
      const length = Math.min(chunkSize, stats.size - offset);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await fileHandle.read(buffer, 0, length, offset);
      if (bytesRead === 0) {
        throw new Error(`Unexpected end of file while reading ${input} at offset ${offset}`);
      }
      const chunkBody = buffer.subarray(0, bytesRead);

      const patchResponse = await fetch(`${baseUrl}/assets/upload-session/${session.id}`, {
        method: 'PATCH',
        redirect: 'error',
        headers: {
          ...headers,
          'Upload-Offset': String(offset),
          'Content-Type': 'application/offset+octet-stream',
        } as Record<string, string>,
        body: chunkBody,
        // eslint-disable-next-line unicorn/no-null
        window: null,
      });

      if (patchResponse.status === 200 || patchResponse.status === 201) {
        report(bytesRead);
        const finalBody: unknown = await patchResponse.json();
        return finalBody as AssetMediaResponseDto;
      }

      if (patchResponse.status !== 204) {
        throw new Error(await patchResponse.text());
      }

      report(bytesRead);
      offset += bytesRead;
    }

    throw new Error(`Upload session ${session.id} ended without a final response from the server`);
  } catch (error) {
    // Undo whatever partial progress this (failed) attempt reported, so a queue retry that
    // re-uploads the file from scratch cannot double-count bytes on the progress bar.
    if (reportedBytes > 0) {
      onBytesUploaded?.(-reportedBytes);
    }
    throw error;
  } finally {
    await fileHandle.close();
  }
};

export const findSidecar = (filepath: string): string | undefined => {
  const assetPath = path.parse(filepath);
  const noExtension = path.join(assetPath.dir, assetPath.name);

  // XMP sidecars can come in two filename formats. For a photo named photo.ext, the filenames are photo.ext.xmp and photo.xmp
  for (const sidecarPath of [`${noExtension}.xmp`, `${filepath}.xmp`]) {
    if (existsSync(sidecarPath)) {
      return sidecarPath;
    }
  }
};

export const deleteFiles = async (uploaded: Asset[], duplicates: Asset[], options: UploadOptionsDto): Promise<void> => {
  let fileCount = 0;
  if (options.delete) {
    fileCount += uploaded.length;
  }

  if (options.deleteDuplicates) {
    fileCount += duplicates.length;
  }

  if (options.dryRun) {
    console.log(`Would have deleted ${fileCount} local asset${s(fileCount)}`);
    return;
  }

  if (fileCount === 0) {
    return;
  }

  console.log('Deleting assets that have been uploaded...');
  const deletionProgress = new SingleBar(
    { format: 'Deleting local assets | {bar} | {percentage}% | ETA: {eta}s | {value}/{total} assets' },
    Presets.shades_classic,
  );
  deletionProgress.start(fileCount, 0);

  const chunkDelete = async (files: Asset[]) => {
    for (const assetBatch of chunk(files, options.concurrency)) {
      await Promise.all(
        assetBatch.map(async (input: Asset) => {
          await unlink(input.filepath);
          const sidecarPath = findSidecar(input.filepath);
          if (sidecarPath) {
            await unlink(sidecarPath);
          }
        }),
      );
      deletionProgress.update(assetBatch.length);
    }
  };

  try {
    if (options.delete) {
      await chunkDelete(uploaded);
    }

    if (options.deleteDuplicates) {
      await chunkDelete(duplicates);
    }
  } finally {
    deletionProgress.stop();
  }
};

const updateAlbums = async (assets: Asset[], options: UploadOptionsDto) => {
  if (!options.album && !options.albumName) {
    return;
  }
  const { dryRun, concurrency } = options;

  const albums = await getAllAlbums({});
  const existingAlbums = new Map(albums.map((album) => [album.albumName, album.id]));
  const newAlbums: Set<string> = new Set();
  for (const { filepath } of assets) {
    const albumName = getAlbumName(filepath, options);
    if (albumName && !existingAlbums.has(albumName)) {
      newAlbums.add(albumName);
    }
  }

  if (dryRun) {
    // TODO print asset counts for new albums
    console.log(`Would have created ${newAlbums.size} new album${s(newAlbums.size)}`);
    console.log(`Would have updated albums of ${assets.length} asset${s(assets.length)}`);
    return;
  }

  const progressBar = new SingleBar(
    { format: 'Creating albums | {bar} | {percentage}% | ETA: {eta}s | {value}/{total} albums' },
    Presets.shades_classic,
  );
  progressBar.start(newAlbums.size, 0);

  try {
    for (const albumNames of chunk([...newAlbums], concurrency)) {
      const items = await Promise.all(
        albumNames.map((albumName: string) => createAlbum({ createAlbumDto: { albumName } })),
      );
      for (const { id, albumName } of items) {
        existingAlbums.set(albumName, id);
      }
      progressBar.increment(albumNames.length);
    }
  } finally {
    progressBar.stop();
  }

  console.log(`Successfully created ${newAlbums.size} new album${s(newAlbums.size)}`);
  console.log(`Successfully updated ${assets.length} asset${s(assets.length)}`);

  const albumToAssets = new Map<string, string[]>();
  for (const asset of assets) {
    const albumName = getAlbumName(asset.filepath, options);
    if (!albumName) {
      continue;
    }
    const albumId = existingAlbums.get(albumName);
    if (albumId) {
      if (!albumToAssets.has(albumId)) {
        albumToAssets.set(albumId, []);
      }
      albumToAssets.get(albumId)?.push(asset.id);
    }
  }

  const albumUpdateProgress = new SingleBar(
    { format: 'Adding assets to albums | {bar} | {percentage}% | ETA: {eta}s | {value}/{total} assets' },
    Presets.shades_classic,
  );
  albumUpdateProgress.start(assets.length, 0);

  try {
    for (const [albumId, assets] of albumToAssets) {
      for (const assetBatch of chunk(assets, Math.min(1000 * concurrency, 65_000))) {
        await addAssetsToAlbum({ id: albumId, bulkIdsDto: { ids: assetBatch } });
        albumUpdateProgress.increment(assetBatch.length);
      }
    }
  } finally {
    albumUpdateProgress.stop();
  }
};

// `filepath` valid format:
// - Windows: `D:\\test\\Filename.txt` or `D:/test/Filename.txt`
// - Unix: `/test/Filename.txt`
export const getAlbumName = (filepath: string, options: UploadOptionsDto) => {
  return options.albumName ?? path.basename(path.dirname(filepath));
};
