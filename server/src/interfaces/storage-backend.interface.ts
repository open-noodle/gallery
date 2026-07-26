import { Readable } from 'node:stream';
import { CacheControl } from 'src/enum';
import type { ContentDisposition } from 'src/utils/file';

/**
 * Thrown by a backend when the client's `Range` header cannot be satisfied, so
 * the HTTP layer can answer 416 instead of masking it as a 404. Kept here (and
 * not as a Nest `HttpException`) so backends stay free of HTTP framework types.
 */
export class RangeNotSatisfiableError extends Error {
  constructor(key: string) {
    super(`Requested range is not satisfiable for ${key}`);
    this.name = 'RangeNotSatisfiableError';
  }
}

export type ServeOptions = {
  contentType: string;
  cacheControl: CacheControl;
  fileName?: string;
  disposition?: ContentDisposition;
  /**
   * The client's raw `Range` header, forwarded verbatim: S3 resolves `bytes=a-b`,
   * `bytes=a-` and `bytes=-n` for us, so nothing here parses it. Only the S3 proxy
   * strategy reads this — the disk backend ignores it because express' `sendFile`
   * already honors the request's own `Range`, and the S3 redirect strategy ignores
   * it because the client replays the header to S3 on the presigned URL.
   */
  range?: string;
};

export type ServeStrategy =
  | { type: 'file'; path: string }
  | { type: 'redirect'; url: string }
  /** `contentRange` is set only when the backend honored a requested range, and drives the 206 response. */
  | { type: 'stream'; stream: Readable; length?: number; contentRange?: string };

export interface StorageBackend {
  /** Write content to the given key */
  put(key: string, source: Readable | Buffer, metadata?: { contentType?: string }): Promise<void>;

  /** Get a readable stream for the given key */
  get(key: string): Promise<{ stream: Readable; contentType?: string; length?: number }>;

  /** Check if a key exists */
  exists(key: string): Promise<boolean>;

  /** Delete the content at the given key */
  delete(key: string): Promise<void>;

  /** Delete all objects/files under the given key prefix. Idempotent. No-op if nothing matches. */
  deletePrefix(prefix: string): Promise<void>;

  /** Return the total size in bytes for all objects/files under the given key prefix. */
  getPrefixUsage(prefix: string): Promise<number>;

  /** Determine how to serve this file to a client */
  getServeStrategy(key: string, options: ServeOptions): Promise<ServeStrategy>;

  /**
   * A path or URL that external tools (ffmpeg/ffprobe) can read directly,
   * without downloading the object first. Disk returns a filesystem path;
   * S3 returns a presigned URL.
   */
  getReadableUrl(key: string): Promise<string>;

  /**
   * Download content to a local temp file for processing by tools
   * that require filesystem paths (ffmpeg, sharp, exiftool).
   * Returns the temp path and a cleanup function.
   * For disk backend, returns the real path with a no-op cleanup.
   */
  downloadToTemp(key: string): Promise<{ tempPath: string; cleanup: () => Promise<void> }>;
}
