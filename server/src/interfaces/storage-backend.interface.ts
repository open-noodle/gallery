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

/**
 * S3 server-side encryption configuration. Only SSE-C ("mode: 'sse-c'") is implemented today.
 * The type is a discriminated union so a future SSE-KMS mode can be added without reshaping
 * the config that already exists. See specs/2026-09-02-s3-sse-c-encryption-design.md.
 */
export type S3SseConfig =
  | { mode: 'none' }
  | {
      mode: 'sse-c';
      /** Raw 32-byte AES-256 key, decoded from IMMICH_S3_SSE_C_KEY (base64). */
      key: Buffer;
      /** MD5 digest of `key`, precomputed once so it isn't recomputed per-request. */
      keyMd5: Buffer;
    };

export interface StorageBackend {
  /**
   * Whether `getReadableUrl` returns something a browser or a bare `ffprobe <url>` invocation can
   * fetch on its own. False for an S3 backend with SSE-C active: a presigned URL cannot carry the
   * `x-amz-server-side-encryption-customer-key*` headers S3 requires to decrypt the object, so
   * callers must fall back to `downloadToTemp` instead. Always true for disk and for S3 with no
   * server-side encryption (or, in the future, SSE-KMS, which needs no such headers on GET).
   */
  readonly supportsReadableUrl: boolean;

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
  getPrefixUsage(prefix: string, shouldCount?: (filename: string) => boolean): Promise<number>;

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
