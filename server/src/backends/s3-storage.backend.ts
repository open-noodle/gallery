import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  GetObjectCommandInput,
  GetObjectCommandOutput,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommandInput,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  RangeNotSatisfiableError,
  S3SseConfig,
  ServeOptions,
  ServeStrategy,
  StorageBackend,
} from 'src/interfaces/storage-backend.interface';
import { getContentDispositionHeader } from 'src/utils/file';

// getReadableUrl backs server-side, download-free probing (ffprobe) that completes within the
// request. Its URL is a bearer credential, so it gets a much shorter expiry than the client-facing
// presignedUrlExpiry — a long TTL only widens exposure if the URL ever reaches a log.
const READABLE_URL_EXPIRY_SECONDS = 60;

class AsyncLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.active++;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.active--;
      this.queue.shift()?.();
    };
  }
}

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  presignedUrlExpiry: number;
  serveMode: 'redirect' | 'proxy';
  proxyReadConcurrency?: number;
  sse?: S3SseConfig;
}

/**
 * The three SSE-C request headers, precomputed once at construction instead of per-request.
 * S3 requires all three identical on every put/get/head of an SSE-C object — see
 * specs/2026-09-02-s3-sse-c-encryption-design.md.
 */
interface SseCustomerHeaders {
  SSECustomerAlgorithm: 'AES256';
  SSECustomerKey: string;
  SSECustomerKeyMD5: string;
}

export class S3StorageBackend implements StorageBackend {
  private client: S3Client;
  private bucket: string;
  private presignedUrlExpiry: number;
  private serveMode: 'redirect' | 'proxy';
  private proxyReadLimiter: AsyncLimiter;
  private sseHeaders: SseCustomerHeaders | undefined;

  /**
   * A presigned GetObject URL cannot carry the SSE-C customer-key headers S3 requires to decrypt
   * the object (a plain `<img>`/`<video>` fetch or a bare `ffprobe <url>` invocation has no way to
   * attach them), so redirect-style serving and URL-based probing are both unavailable whenever
   * SSE-C is active. See getServeStrategy and getReadableUrl below.
   */
  readonly supportsReadableUrl: boolean;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.presignedUrlExpiry = config.presignedUrlExpiry;
    this.serveMode = config.serveMode;
    this.proxyReadLimiter = new AsyncLimiter(config.proxyReadConcurrency ?? 32);

    const sse = config.sse ?? { mode: 'none' as const };
    if (sse.mode === 'sse-c') {
      this.sseHeaders = {
        SSECustomerAlgorithm: 'AES256',
        SSECustomerKey: sse.key.toString('base64'),
        SSECustomerKeyMD5: sse.keyMd5.toString('base64'),
      };
    }
    this.supportsReadableUrl = !this.sseHeaders;

    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: !!config.endpoint, // needed for MinIO and other S3-compatible services
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            }
          : undefined,
    });
  }

  async put(key: string, source: Readable | Buffer, metadata?: { contentType?: string }): Promise<void> {
    const params: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: key,
      Body: source,
      ContentType: metadata?.contentType,
      ...this.sseHeaders,
    };

    const upload = new Upload({ client: this.client, params });

    await upload.done();
  }

  /**
   * `range` is the client's raw `Range` header, handed to S3 untouched — S3
   * understands `bytes=a-b`, `bytes=a-`, and `bytes=-n`, and answers with
   * `ContentRange` plus a `ContentLength` covering only the returned bytes.
   */
  private async getObject(
    key: string,
    range?: string,
  ): Promise<{ stream: Readable; contentType?: string; length?: number; contentRange?: string }> {
    let response: GetObjectCommandOutput;
    try {
      response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range, ...this.sseHeaders }),
      );
    } catch (error: any) {
      if (range && (error.name === 'InvalidRange' || error.$metadata?.httpStatusCode === 416)) {
        throw new RangeNotSatisfiableError(key);
      }
      throw error;
    }

    return {
      stream: response.Body as Readable,
      contentType: response.ContentType,
      length: response.ContentLength,
      contentRange: response.ContentRange,
    };
  }

  async get(key: string): Promise<{ stream: Readable; contentType?: string; length?: number }> {
    return this.getObject(key);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key, ...this.sseHeaders }));
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deletePrefix(prefix: string): Promise<void> {
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: continuationToken }),
      );
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length > 0) {
        const result = await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }),
        );
        if (result.Errors && result.Errors.length > 0) {
          const first = result.Errors[0];
          throw new Error(`S3 deletePrefix partial failure: ${first.Code}: ${first.Message} (key=${first.Key})`);
        }
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  async getPrefixUsage(prefix: string, shouldCount?: (filename: string) => boolean): Promise<number> {
    let total = 0;
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: continuationToken }),
      );
      for (const object of page.Contents ?? []) {
        const filename = (object.Key ?? '').split('/').pop() ?? '';
        if (shouldCount && !shouldCount(filename)) {
          continue;
        }
        total += object.Size ?? 0;
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    return total;
  }

  private releaseWhenStreamCloses(stream: Readable, release: () => void) {
    stream.once('end', release);
    stream.once('error', release);
    stream.once('close', release);
    return stream;
  }

  async getServeStrategy(key: string, options: ServeOptions): Promise<ServeStrategy> {
    // SSE-C objects can only ever be served by proxy: a presigned GetObject URL has no way to
    // carry the x-amz-server-side-encryption-customer-key* headers S3 requires to decrypt the
    // object, so a plain <img>/<video> fetch of a redirect target would just receive ciphertext.
    // StorageService.onBootstrap already refuses to start with serveMode=redirect + SSE-C
    // configured; this check is defense-in-depth for any path that constructs the backend
    // without going through that startup validation (e.g. tests).
    if (this.serveMode === 'proxy' || this.sseHeaders) {
      const release = await this.proxyReadLimiter.acquire();
      try {
        // forward the client's Range to S3 and relay its partial response, so
        // <video> elements (which require 206) can stream and seek in proxy mode
        const { stream, length, contentRange } = await this.getObject(key, options.range);
        return { type: 'stream', stream: this.releaseWhenStreamCloses(stream, release), length, contentRange };
      } catch (error) {
        release();
        throw error;
      }
    }

    // redirect mode needs no range handling: the browser re-sends its Range header
    // to S3 on the presigned URL, and S3 answers it natively
    const commandInput: GetObjectCommandInput = {
      Bucket: this.bucket,
      Key: key,
      ResponseContentType: options.contentType,
    };
    if (options.fileName) {
      commandInput.ResponseContentDisposition = getContentDispositionHeader(
        options.disposition ?? 'inline',
        options.fileName,
      );
    }

    const url = await getSignedUrl(this.client, new GetObjectCommand(commandInput), {
      expiresIn: this.presignedUrlExpiry,
    });

    return { type: 'redirect', url };
  }

  /**
   * Callers must check `supportsReadableUrl` first: with SSE-C active this presigned URL cannot
   * be used to fetch the object (S3 requires the customer-key headers on the GET, which a bare
   * URL fetch cannot carry), so BaseService.getProbeInput falls back to downloadToTemp instead.
   */
  async getReadableUrl(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: READABLE_URL_EXPIRY_SECONDS,
    });
  }

  async downloadToTemp(key: string): Promise<{ tempPath: string; cleanup: () => Promise<void> }> {
    const tempPath = join(tmpdir(), `immich-${randomUUID()}.tmp`);
    const { stream } = await this.get(key);
    const writeStream = createWriteStream(tempPath);
    await pipeline(stream, writeStream);

    return {
      tempPath,
      cleanup: async () => {
        try {
          await unlink(tempPath);
        } catch {
          // ignore cleanup errors
        }
      },
    };
  }

  /**
   * Re-encrypts an existing, currently-unencrypted object in place using the backend's
   * configured SSE-C key, via a self-copy (CopySource === destination Key). This never downloads
   * or re-uploads bytes through the Gallery process — the copy happens entirely inside S3/the
   * S3-compatible provider — which is why StorageMigrationService uses it (rather than
   * get()+put()) for the "enable encryption on an existing bucket" migration.
   *
   * Only destination SSE-C headers are sent; no CopySourceSSECustomerKey* headers are sent,
   * because the source object is assumed unencrypted going into this call. Calling this a second
   * time on an object already encrypted with this key will fail the read half of the copy (S3
   * needs decryption headers for an already-encrypted source) — callers must track completion
   * externally (StorageMigrationService uses the existing storage_migration_log table for this,
   * not object state) rather than relying on this method being self-idempotent.
   *
   * Throws if the backend was not constructed with SSE-C configured — this method only makes
   * sense as part of turning encryption on, not as a general-purpose copy utility.
   */
  async reencryptInPlace(key: string): Promise<void> {
    if (!this.sseHeaders) {
      throw new Error('reencryptInPlace requires SSE-C to be configured on this backend');
    }

    // CopySource must be URI-encoded per-segment, not as a whole: encodeURIComponent on the full
    // key would turn '/' into '%2F' and break the path structure S3 expects.
    const encodedKey = key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: key,
        CopySource: `${this.bucket}/${encodedKey}`,
        MetadataDirective: 'COPY',
        ...this.sseHeaders,
      }),
    );
  }
}
