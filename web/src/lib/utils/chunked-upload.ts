import {
  createUploadSession,
  deleteUploadSession,
  type AssetMediaResponseDto,
  type AssetMetadataUpsertItemDto,
  type AssetVisibility,
} from '@immich/sdk';
import { AbortError, createUrl, sleep, trackUpload } from '$lib/utils';

/** Number of extra attempts made for a single chunk before giving up. */
export const DEFAULT_MAX_CHUNK_RETRIES = 3;
/** Base backoff, in ms, multiplied by the attempt number between chunk retries. */
export const DEFAULT_CHUNK_RETRY_DELAY_MS = 500;

export interface ChunkedUploadParams {
  file: File;
  /** Bytes per chunk, from `ServerConfigDto.uploadChunkSize`. */
  chunkSize: number;
  checksum?: string;
  fileCreatedAt: string;
  fileModifiedAt: string;
  filename?: string;
  isFavorite?: boolean;
  visibility?: AssetVisibility;
  metadata?: AssetMetadataUpsertItemDto[];
  duration?: number;
  livePhotoVideoId?: string;
  sidecar?: string;
  /** Shared-link auth, mirroring `authManager.params`. Omitted for authenticated-user uploads. */
  key?: string;
  slug?: string;
  onUploadProgress?: (loaded: number, total: number) => void;
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * Whether a file of `fileSize` bytes should go through the chunked-upload session protocol
 * instead of the single-shot multipart path. `uploadChunkSize` is `0` or `undefined` when the
 * server does not support (or does not advertise) chunked uploads.
 */
export function shouldUploadChunked(fileSize: number, uploadChunkSize: number | null | undefined): boolean {
  return typeof uploadChunkSize === 'number' && uploadChunkSize > 0 && fileSize > uploadChunkSize;
}

class OffsetMismatchError extends Error {
  constructor(public offset: number) {
    super('Upload offset mismatch');
    this.name = 'OffsetMismatchError';
  }
}

const sessionUrl = (id: string, key: string | undefined, slug: string | undefined) =>
  createUrl(`/assets/upload-session/${id}`, { key, slug });

type RawResponse = {
  status: number;
  text: string;
  getHeader: (name: string) => string | null;
};

function xhrRequest(options: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: Blob;
  onProgress?: (loaded: number) => void;
  signal: AbortSignal;
}): Promise<RawResponse> {
  const { method, url, headers, body, onProgress, signal } = options;

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortError());
      return;
    }

    const xhr = new XMLHttpRequest();

    const onSignalAbort = () => xhr.abort();
    signal.addEventListener('abort', onSignalAbort);
    const cleanup = () => signal.removeEventListener('abort', onSignalAbort);

    xhr.addEventListener('error', () => {
      cleanup();
      reject(new Error(`Network error during ${method} ${url}`));
    });

    xhr.addEventListener('abort', () => {
      cleanup();
      reject(new AbortError());
    });

    xhr.addEventListener('load', () => {
      cleanup();
      resolve({
        status: xhr.status,
        text: xhr.responseText,
        getHeader: (name: string) => xhr.getResponseHeader(name),
      });
    });

    if (onProgress) {
      xhr.upload.addEventListener('progress', (event) => onProgress(event.loaded));
    }

    xhr.open(method, url);
    for (const [key, value] of Object.entries(headers ?? {})) {
      xhr.setRequestHeader(key, value);
    }
    xhr.send(body);
  });
}

type PatchChunkResult = { done: true; asset: AssetMediaResponseDto } | { done: false; offset: number };

async function patchChunk(
  sessionId: string,
  offset: number,
  chunk: Blob,
  onProgress: ((loaded: number) => void) | undefined,
  signal: AbortSignal,
  key: string | undefined,
  slug: string | undefined,
): Promise<PatchChunkResult> {
  const response = await xhrRequest({
    method: 'PATCH',
    url: sessionUrl(sessionId, key, slug),
    headers: {
      'Content-Type': 'application/offset+octet-stream',
      'Upload-Offset': String(offset),
    },
    body: chunk,
    onProgress,
    signal,
  });

  if (response.status === 204) {
    const header = response.getHeader('Upload-Offset');
    return { done: false, offset: header === null ? offset + chunk.size : Number(header) };
  }

  if (response.status === 200 || response.status === 201) {
    return { done: true, asset: JSON.parse(response.text) as AssetMediaResponseDto };
  }

  if (response.status === 409) {
    const body = response.text ? (JSON.parse(response.text) as { offset: number }) : { offset };
    throw new OffsetMismatchError(body.offset);
  }

  throw new Error(`Unexpected status ${response.status} while uploading a chunk`);
}

async function fetchSessionOffset(
  sessionId: string,
  signal: AbortSignal,
  key: string | undefined,
  slug: string | undefined,
): Promise<number> {
  const response = await xhrRequest({ method: 'HEAD', url: sessionUrl(sessionId, key, slug), signal });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to resync upload offset (status ${response.status})`);
  }

  const header = response.getHeader('Upload-Offset');
  return header === null ? 0 : Number(header);
}

/**
 * Uploads a file through the chunked upload-session protocol (spec §4.1), reporting globally
 * monotonic progress (`committedBytes + thisChunkLoaded`) so `uploadAssetsStore.updateProgress`
 * semantics stay unchanged relative to the single-shot path.
 */
export async function uploadFileChunked(params: ChunkedUploadParams): Promise<AssetMediaResponseDto> {
  const {
    file,
    chunkSize,
    checksum,
    fileCreatedAt,
    fileModifiedAt,
    filename,
    isFavorite,
    visibility,
    metadata,
    duration,
    livePhotoVideoId,
    sidecar,
    key,
    slug,
    onUploadProgress,
    maxRetries = DEFAULT_MAX_CHUNK_RETRIES,
    retryDelayMs = DEFAULT_CHUNK_RETRY_DELAY_MS,
  } = params;

  const controller = new AbortController();
  const unsubscribe = trackUpload(() => controller.abort());
  let sessionId: string | undefined;

  try {
    const session = await createUploadSession({
      uploadSessionCreateDto: {
        filename: filename ?? file.name,
        size: file.size,
        fileCreatedAt,
        fileModifiedAt,
        checksum,
        isFavorite,
        visibility,
        metadata,
        duration,
        livePhotoVideoId,
        sidecar,
      },
      key,
      slug,
    });

    if ('status' in session) {
      // The checksum was a known duplicate: the server never created a session.
      return session;
    }

    sessionId = session.id;
    let offset = session.offset;
    onUploadProgress?.(offset, file.size);

    while (offset < file.size) {
      if (controller.signal.aborted) {
        throw new AbortError();
      }

      let attempt = 0;
      while (true) {
        const chunkStart = offset;
        const chunk = file.slice(chunkStart, Math.min(chunkStart + chunkSize, file.size));

        try {
          const result = await patchChunk(
            sessionId,
            offset,
            chunk,
            (loaded) => onUploadProgress?.(chunkStart + loaded, file.size),
            controller.signal,
            key,
            slug,
          );

          if (result.done) {
            return result.asset;
          }

          offset = result.offset;
          onUploadProgress?.(offset, file.size);
          break;
        } catch (error) {
          if (error instanceof AbortError) {
            throw error;
          }

          attempt++;
          if (attempt > maxRetries) {
            throw error;
          }

          if (error instanceof OffsetMismatchError) {
            offset = error.offset;
          } else {
            try {
              offset = await fetchSessionOffset(sessionId, controller.signal, key, slug);
            } catch {
              // Resync itself failed; retry the same chunk from the offset we already believed.
            }
          }

          if (retryDelayMs > 0) {
            await sleep(retryDelayMs * attempt);
          }
        }
      }
    }

    throw new Error('Chunked upload session ended without a final server response');
  } catch (error) {
    if (sessionId) {
      await deleteUploadSession({ id: sessionId, key, slug }).catch(() => {});
    }
    throw error;
  } finally {
    unsubscribe();
  }
}
