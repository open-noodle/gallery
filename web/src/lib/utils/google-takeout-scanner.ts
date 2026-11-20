import {
  MEDIA_EXTENSIONS,
  derivePhotoRoots,
  detectAlbums,
  finalizeItemAlbumNames,
  matchSidecarToMedia,
  parseGoogleTakeoutSidecar,
  type TakeoutAlbum,
  type TakeoutMediaItem,
  type TakeoutMetadata,
} from '#lib/utils/google-takeout-parser.ts';

export interface ScanProgress {
  currentFile: string;
  currentZip: string;
  zipIndex: number;
  zipCount: number;
  mediaCount: number;
  withLocation: number;
  withDate: number;
  favorites: number;
  archived: number;
  albumNames: Set<string>;
}

export interface ScanResult {
  items: TakeoutMediaItem[];
  albums: TakeoutAlbum[];
  stats: {
    totalMedia: number;
    withLocation: number;
    withDate: number;
    favorites: number;
    archived: number;
    dateRange: { earliest: Date; latest: Date } | undefined;
  };
}

export interface ScanOptions {
  files: File[];
  onProgress?: (progress: ScanProgress) => void;
  signal?: AbortSignal;
}

function isMediaFile(path: string): boolean {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) {
    return false;
  }
  return MEDIA_EXTENSIONS.has(path.slice(lastDot).toLowerCase());
}

function isSidecarFile(path: string): boolean {
  return path.endsWith('.json') && !isStandaloneJson(path);
}

/** Standalone JSON files that are not sidecars (Google Takeout metadata files). */
function isStandaloneJson(path: string): boolean {
  const basename = path.slice(Math.max(0, path.lastIndexOf('/') + 1));
  const standaloneNames = new Set([
    'metadata.json',
    'print-subscriptions.json',
    'shared_album_comments.json',
    'user-generated-memory-titles.json',
  ]);
  return standaloneNames.has(basename);
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
}

interface ZipEntry {
  filename: string;
  directory?: boolean;
  uncompressedSize?: number;
  lastModDate?: Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getData?: (...args: any[]) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arrayBuffer?: (options?: any) => Promise<ArrayBuffer>;
}

interface ZipMediaDescriptor {
  path: string;
  name: string;
  size: number;
  lastModified: number;
}

function isZipFile(file: File): boolean {
  return (
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed' ||
    file.name.toLowerCase().endsWith('.zip')
  );
}

function getFilePath(file: File): string {
  // Use webkitRelativePath if available (folder selection), otherwise just the name
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function basename(path: string): string {
  return path.slice(Math.max(0, path.lastIndexOf('/') + 1));
}

async function extractZipEntryFile(entry: ZipEntry, name: string, lastModified: number): Promise<File> {
  if (entry.arrayBuffer) {
    const buffer = await entry.arrayBuffer();
    return new File([buffer], name, { lastModified });
  }

  if (entry.getData) {
    const blob = (await entry.getData(new WritableStream())) as Blob;
    return new File([blob], name, { type: blob.type || 'application/octet-stream', lastModified });
  }

  throw new Error(`Zip entry "${entry.filename}" cannot be extracted`);
}

async function getZipEntryFile(zipFile: File, entryPath: string, name: string, lastModified: number): Promise<File> {
  const { BlobReader, ZipReader } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(zipFile));

  try {
    const entries: ZipEntry[] = await reader.getEntries();
    const entry = entries.find((entry) => entry.filename === entryPath);
    if (!entry) {
      throw new Error(`Zip entry "${entryPath}" not found`);
    }

    return await extractZipEntryFile(entry, name, lastModified);
  } finally {
    await reader.close();
  }
}

function trackMediaStats(filePath: string, progress: ScanProgress): void {
  // Tentative album name for progress display only. Authoritative value is
  // written later by finalizeItemAlbumNames once photoRoots is known.
  const parts = filePath.split('/');
  if (parts[0] === 'Takeout' && parts.length >= 4) {
    progress.albumNames.add(parts[2]);
  }

  progress.mediaCount++;
}

function trackMetadataStats(metadata: TakeoutMetadata, progress: ScanProgress): void {
  if (metadata.latitude !== undefined && metadata.longitude !== undefined) {
    progress.withLocation++;
  }
  if (metadata.dateTaken) {
    progress.withDate++;
  }
  if (metadata.isFavorite) {
    progress.favorites++;
  }
  if (metadata.isArchived) {
    progress.archived++;
  }
}

interface PendingSidecar {
  path: string;
  text: string;
  metadata: TakeoutMetadata;
}

/**
Media and sidecars still missing their partner. A Takeout split across parts can put a
photo and its sidecar in different sources, so these wait for a later source.
*/
interface UnmatchedPool {
  media: Map<string, TakeoutMediaItem>;
  sidecars: PendingSidecar[];
}

function dirname(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

function indexByDir(index: Map<string, string[]>, path: string): void {
  const dir = dirname(path);
  const paths = index.get(dir);
  if (paths) {
    paths.push(path);
  } else {
    index.set(dir, [path]);
  }
}

/**
Match one source's sidecars and media against each other and the leftovers of earlier sources.
Items are mutated in place; whatever is still unmatched stays in the pool.
*/
function matchWithPool(
  pool: UnmatchedPool,
  items: TakeoutMediaItem[],
  sidecarTexts: Map<string, string>,
  progress: ScanProgress,
): void {
  const candidates = new Map(pool.media);
  const allByDir = new Map<string, string[]>();
  const newByDir = new Map<string, string[]>();
  for (const path of pool.media.keys()) {
    indexByDir(allByDir, path);
  }
  for (const item of items) {
    candidates.set(item.path, item);
    indexByDir(allByDir, item.path);
    indexByDir(newByDir, item.path);
  }

  const matched = new Map<string, TakeoutMetadata>();
  const stillUnmatched: PendingSidecar[] = [];

  const tryMatch = (sidecar: PendingSidecar, byDir: Map<string, string[]>) => {
    const matches = matchSidecarToMedia(sidecar.path, sidecar.text, byDir.get(dirname(sidecar.path)) ?? []);
    if (matches.length === 0) {
      stillUnmatched.push(sidecar);
      return;
    }
    for (const path of matches) {
      matched.set(path, sidecar.metadata);
    }
  };

  // A pooled sidecar already failed against the pooled media, so only new media can match it.
  for (const sidecar of pool.sidecars) {
    tryMatch(sidecar, newByDir);
  }
  for (const [path, text] of sidecarTexts) {
    const metadata = parseGoogleTakeoutSidecar(text);
    if (metadata) {
      tryMatch({ path, text, metadata }, allByDir);
    }
  }

  for (const [path, metadata] of matched) {
    candidates.get(path)!.metadata = metadata;
    trackMetadataStats(metadata, progress);
    pool.media.delete(path);
  }
  for (const item of items) {
    if (!item.metadata) {
      pool.media.set(item.path, item);
    }
  }
  pool.sidecars = stillUnmatched;
}

async function scanZipFile(
  zipFile: File,
  allItems: TakeoutMediaItem[],
  pool: UnmatchedPool,
  progress: ScanProgress,
  onProgress?: (progress: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { BlobReader, ZipReader, configure } = await import('@zip.js/zip.js');

  configure({ useWebWorkers: true });

  const reader = new ZipReader(new BlobReader(zipFile));

  // Single pass: read all entries once to avoid stream reuse errors.
  // Wrap in try/finally to ensure reader is always closed.
  const mediaDescriptors = new Map<string, ZipMediaDescriptor>();
  const sidecarTexts = new Map<string, string>();

  try {
    const entries: ZipEntry[] = await reader.getEntries();

    for (const entry of entries) {
      if (!entry.filename || entry.filename.endsWith('/')) {
        continue;
      }

      // Prefer arrayBuffer() which creates a fresh TransformStream per call,
      // avoiding the BlobWriter stream lifecycle issues that cause
      // "Can not close stream after closing or error" in browsers.
      const hasExtractor = entry.arrayBuffer || entry.getData;
      if (!hasExtractor) {
        continue;
      }

      checkAbort(signal);
      progress.currentFile = entry.filename;
      onProgress?.(progress);

      try {
        if (isMediaFile(entry.filename)) {
          const name = basename(entry.filename);
          const lastModified = entry.lastModDate?.getTime() ?? zipFile.lastModified;

          mediaDescriptors.set(entry.filename, {
            path: entry.filename,
            name,
            size: entry.uncompressedSize ?? 0,
            lastModified,
          });

          // Update progress counters while scanning so the UI shows activity.
          progress.mediaCount++;
          const parts = entry.filename.split('/');
          if (parts[0] === 'Takeout' && parts.length >= 4) {
            progress.albumNames.add(parts[2]);
          }
          onProgress?.(progress);
        } else if (isSidecarFile(entry.filename)) {
          if (entry.arrayBuffer) {
            const buffer = await entry.arrayBuffer();
            sidecarTexts.set(entry.filename, new TextDecoder().decode(buffer));
          } else {
            const blob = (await entry.getData!(new WritableStream())) as Blob;
            sidecarTexts.set(entry.filename, await blob.text());
          }
        }
      } catch (error) {
        console.warn(`Skipping zip entry "${entry.filename}":`, error);
      }
    }
  } finally {
    await reader.close();
  }

  // mediaCount and albumNames were already updated during scanning.
  const items: TakeoutMediaItem[] = [];
  for (const descriptor of mediaDescriptors.values()) {
    const item: TakeoutMediaItem = {
      path: descriptor.path,
      name: descriptor.name,
      size: descriptor.size,
      lastModified: descriptor.lastModified,
      getFile: () => getZipEntryFile(zipFile, descriptor.path, descriptor.name, descriptor.lastModified),
      metadata: undefined,
      albumName: undefined,
    };
    items.push(item);
    allItems.push(item);
  }

  matchWithPool(pool, items, sidecarTexts, progress);
  onProgress?.(progress);
}

async function scanFolderFiles(
  files: File[],
  allItems: TakeoutMediaItem[],
  pool: UnmatchedPool,
  progress: ScanProgress,
  onProgress?: (progress: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  // Classify files by their relative path
  const mediaFiles: File[] = [];
  const sidecarFiles: File[] = [];

  for (const file of files) {
    const filePath = getFilePath(file);
    if (isMediaFile(filePath)) {
      mediaFiles.push(file);
    } else if (isSidecarFile(filePath)) {
      sidecarFiles.push(file);
    }
  }

  const sidecarTexts = new Map<string, string>();
  for (const sidecar of sidecarFiles) {
    checkAbort(signal);

    const sidecarPath = getFilePath(sidecar);
    progress.currentFile = sidecarPath;
    onProgress?.(progress);

    sidecarTexts.set(sidecarPath, await sidecar.text());
  }

  const items: TakeoutMediaItem[] = [];
  for (const file of mediaFiles) {
    checkAbort(signal);

    const filePath = getFilePath(file);
    progress.currentFile = filePath;
    trackMediaStats(filePath, progress);

    const item: TakeoutMediaItem = {
      path: filePath,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      getFile: () => Promise.resolve(file),
      metadata: undefined,
      albumName: undefined,
    };

    items.push(item);
    allItems.push(item);
    onProgress?.(progress);
  }

  matchWithPool(pool, items, sidecarTexts, progress);
  onProgress?.(progress);
}

export async function scanTakeoutFiles(options: ScanOptions): Promise<ScanResult> {
  const { files, onProgress, signal } = options;

  checkAbort(signal);

  const allItems: TakeoutMediaItem[] = [];
  const progress: ScanProgress = {
    currentFile: '',
    currentZip: '',
    zipIndex: 0,
    zipCount: files.length,
    mediaCount: 0,
    withLocation: 0,
    withDate: 0,
    favorites: 0,
    archived: 0,
    albumNames: new Set(),
  };

  // Separate zip files from folder files
  const zipFiles: File[] = [];
  const folderFiles: File[] = [];

  for (const file of files) {
    if (isZipFile(file)) {
      zipFiles.push(file);
    } else {
      folderFiles.push(file);
    }
  }

  progress.zipCount = zipFiles.length;
  const pool: UnmatchedPool = { media: new Map(), sidecars: [] };

  // Process zip files
  for (let zipIndex = 0; zipIndex < zipFiles.length; zipIndex++) {
    checkAbort(signal);

    const zipFile = zipFiles[zipIndex];
    progress.zipIndex = zipIndex;
    progress.currentZip = zipFile.name;

    await scanZipFile(zipFile, allItems, pool, progress, onProgress, signal);
  }

  // Process folder files
  if (folderFiles.length > 0) {
    await scanFolderFiles(folderFiles, allItems, pool, progress, onProgress, signal);
  }

  const photoRoots = derivePhotoRoots(allItems);
  finalizeItemAlbumNames(allItems, photoRoots);
  const albums = detectAlbums(allItems, photoRoots);

  // Reconcile progress.albumNames — the extraction-time heuristic may have
  // over-counted (e.g. YouTube playlist folders under a full Takeout export).
  // Rebuild from the authoritative album list and fire onProgress one last time
  // so the UI snaps to the correct count. Reassigning the property (rather than
  // clearing + re-adding) is safe because the progress-UI callback snapshots
  // with `new Set(p.albumNames)` on receive — it doesn't hold a reference.
  progress.albumNames = new Set(albums.map((a) => a.name));
  onProgress?.(progress);

  // Compute date range
  const dates = allItems.filter((item) => item.metadata?.dateTaken).map((item) => item.metadata!.dateTaken!);

  let dateRange: { earliest: Date; latest: Date } | undefined;
  if (dates.length > 0) {
    const sorted = dates.sort((a, b) => a.getTime() - b.getTime());
    dateRange = { earliest: sorted[0], latest: sorted.at(-1)! };
  }

  return {
    items: allItems,
    albums,
    stats: {
      totalMedia: allItems.length,
      withLocation: progress.withLocation,
      withDate: progress.withDate,
      favorites: progress.favorites,
      archived: progress.archived,
      dateRange,
    },
  };
}

export {
  MEDIA_EXTENSIONS,
  type TakeoutAlbum,
  type TakeoutMediaItem,
  type TakeoutMetadata,
} from '#lib/utils/google-takeout-parser.ts';
