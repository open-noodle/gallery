import { detectAlbums, matchSidecarToMedia, parseGoogleTakeoutSidecar } from '$lib/utils/google-takeout-parser';
import type { TakeoutAlbum, TakeoutMediaItem, TakeoutMetadata } from '$lib/utils/google-takeout-parser';

export type { TakeoutAlbum, TakeoutMediaItem, TakeoutMetadata };

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

const MEDIA_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.heic',
  '.heif',
  '.tiff',
  '.tif',
  '.bmp',
  '.avif',
  '.raw',
  '.arw',
  '.cr2',
  '.cr3',
  '.dng',
  '.nef',
  '.orf',
  '.raf',
  '.rw2',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.m4v',
  '.3gp',
  '.mts',
  '.m2ts',
]);

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
  getData?: (writer: unknown) => Promise<unknown>;
}

export async function scanTakeoutFiles(options: ScanOptions): Promise<ScanResult> {
  const { files, onProgress, signal } = options;

  checkAbort(signal);

  const { BlobReader, ZipReader, BlobWriter: ZipBlobWriter } = await import('@zip.js/zip.js');

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

  for (let zipIndex = 0; zipIndex < files.length; zipIndex++) {
    checkAbort(signal);

    const zipFile = files[zipIndex];
    progress.zipIndex = zipIndex;
    progress.currentZip = zipFile.name;

    const reader = new ZipReader(new BlobReader(zipFile));
    const entries: ZipEntry[] = await reader.getEntries();

    // First pass: collect media paths and sidecar entries
    const mediaPaths: string[] = [];
    const sidecarEntries: ZipEntry[] = [];
    const mediaEntries: ZipEntry[] = [];

    for (const entry of entries) {
      if (!entry.filename || entry.filename.endsWith('/')) {
        continue; // Skip directories
      }

      if (isMediaFile(entry.filename)) {
        mediaPaths.push(entry.filename);
        mediaEntries.push(entry);
      } else if (isSidecarFile(entry.filename)) {
        sidecarEntries.push(entry);
      }
    }

    // Second pass: read sidecar content and match to media
    const metadataMap = new Map<string, TakeoutMetadata>();

    for (const sidecar of sidecarEntries) {
      checkAbort(signal);

      if (!sidecar.getData) {
        continue;
      }

      progress.currentFile = sidecar.filename;
      onProgress?.(progress);

      const blobWriter = new ZipBlobWriter();
      const blob = (await sidecar.getData(blobWriter)) as Blob;
      const text = await blob.text();

      const matchedPath = matchSidecarToMedia(sidecar.filename, text, mediaPaths);
      if (matchedPath) {
        const metadata = parseGoogleTakeoutSidecar(text);
        if (metadata) {
          metadataMap.set(matchedPath, metadata);
        }
      }
    }

    // Third pass: extract media files and build items
    for (const entry of mediaEntries) {
      checkAbort(signal);

      if (!entry.getData) {
        continue;
      }

      progress.currentFile = entry.filename;

      const blobWriter = new ZipBlobWriter();
      const blob = (await entry.getData(blobWriter)) as Blob;
      const basename = entry.filename.slice(Math.max(0, entry.filename.lastIndexOf('/') + 1));
      const file = new File([blob], basename, { type: blob.type || 'application/octet-stream' });

      const metadata = metadataMap.get(entry.filename);

      // Detect album from path
      const parts = entry.filename.split('/');
      const googlePhotosIndex = parts.indexOf('Google Photos');
      let albumName: string | undefined;
      if (googlePhotosIndex !== -1 && googlePhotosIndex < parts.length - 2) {
        albumName = parts[googlePhotosIndex + 1];
        progress.albumNames.add(albumName);
      }

      const item: TakeoutMediaItem = {
        path: entry.filename,
        file,
        metadata,
        albumName,
      };

      allItems.push(item);
      progress.mediaCount++;

      if (metadata?.latitude !== undefined && metadata?.longitude !== undefined) {
        progress.withLocation++;
      }
      if (metadata?.dateTaken) {
        progress.withDate++;
      }
      if (metadata?.isFavorite) {
        progress.favorites++;
      }
      if (metadata?.isArchived) {
        progress.archived++;
      }

      onProgress?.(progress);
    }

    await reader.close();
  }

  // Detect albums from the collected items
  const albums = detectAlbums(allItems);

  // Compute date range
  const dates = allItems
    .filter((item) => item.metadata?.dateTaken)
    .map((item) => item.metadata!.dateTaken!);

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
