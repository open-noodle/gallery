import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  GetObjectCommandInput,
  GetObjectCommandOutput,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform, addAbortSignal, pipeline as pipelineCallback } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { pipeline } from 'node:stream/promises';
import {
  RangeNotSatisfiableError,
  ServeOptions,
  ServeStrategy,
  StorageBackend,
} from 'src/interfaces/storage-backend.interface.js';
import { getContentDispositionHeader } from 'src/utils/file.js';

// getReadableUrl backs server-side, download-free probing (ffprobe) that completes within the
// request. Its URL is a bearer credential, so it gets a much shorter expiry than the client-facing
// presignedUrlExpiry — a long TTL only widens exposure if the URL ever reaches a log.
const READABLE_URL_EXPIRY_SECONDS = 60;

// How long a proxied read may go without passing data on before it is destroyed. When the
// client stops reading (a browser that has buffered ahead), backpressure pauses the S3 socket,
// and a paused socket cannot notice the remote closing it: it zombies, dead at the OS level but
// still holding its read slot, until the client resumes or the process restarts. Once every
// slot is held by a zombie, each new proxied read blocks in `acquire()` forever. Destroying the
// stream releases both the socket and the slot.
//
// Anchored to the 60s send-timeout common to reverse proxies in front of S3-compatible endpoints,
// so it usually fires on a connection the remote has already given up on. A tuning knob, not a
// correctness bound: too long leaves zombies holding slots; too short cuts streams the client
// could still have resumed. Exported so tests derive their timings from it.
export const S3_STREAM_IDLE_TIMEOUT_MS = 60_000;

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
}

export class S3StorageBackend implements StorageBackend {
  private client: S3Client;
  private bucket: string;
  private presignedUrlExpiry: number;
  private serveMode: 'redirect' | 'proxy';
  private proxyReadLimiter: AsyncLimiter;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.presignedUrlExpiry = config.presignedUrlExpiry;
    this.serveMode = config.serveMode;
    this.proxyReadLimiter = new AsyncLimiter(config.proxyReadConcurrency ?? 32);

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
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: source,
        ContentType: metadata?.contentType,
      },
    });

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
    abortSignal?: AbortSignal,
  ): Promise<{ stream: Readable; contentType?: string; length?: number; contentRange?: string }> {
    let response: GetObjectCommandOutput;
    try {
      response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range }), {
        abortSignal,
      });
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

  async readAll(key: string): Promise<Buffer> {
    const { stream } = await this.get(key);
    return buffer(stream);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
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

  /**
   * Wraps a proxied S3 body so the read slot it holds is released however the read ends: drained,
   * failed, destroyed by the consumer, aborted with the response, or gone idle. The consumer's only
   * duty is the generic one, destroying the stream it stops piping.
   */
  private holdSlotUntilClosed(body: Readable, release: () => void, signal?: AbortSignal): Readable {
    let lastDataAt = Date.now();
    // a Transform rather than a 'data' listener on the body: a 'data' listener would start the
    // body flowing before the consumer has attached, and lose those chunks
    const stream = new Transform({
      transform(chunk, _encoding, callback) {
        lastDataAt = Date.now();
        callback(null, chunk);
      },
    });

    const checkIdle = () => {
      const idleFor = Date.now() - lastDataAt;
      if (idleFor >= S3_STREAM_IDLE_TIMEOUT_MS) {
        stream.destroy(new Error('S3 stream idle timeout'));
        return;
      }
      // data arrived while this timer was pending: re-arm for the rest of the window rather than
      // rescheduling on every chunk
      idleTimer = setTimeout(checkIdle, S3_STREAM_IDLE_TIMEOUT_MS - idleFor);
    };
    let idleTimer = setTimeout(checkIdle, S3_STREAM_IDLE_TIMEOUT_MS);

    // pipeline's listeners leave once the body has ended into `stream`, and pipe() adds none to its
    // source, so a later idle or abort destroy would otherwise be an unhandled 'error' that takes the
    // process down (a stalled client on a stream served without a response signal, e.g. thumbnails).
    // The error stays readable on `stream.errored`; the slot is released on 'close' below.
    stream.on('error', () => {});
    // 'close' follows end, error and destroy alike
    stream.once('close', () => {
      clearTimeout(idleTimer);
      release();
    });
    // destroying either side destroys the other, which is what frees the S3 socket; the error, if
    // any, surfaces on `stream` for the consumer.
    pipelineCallback(body, stream, () => {});
    if (signal) {
      // destroys at once when the signal is already aborted
      addAbortSignal(signal, stream);
    }
    return stream;
  }

  async getServeStrategy(key: string, options: ServeOptions): Promise<ServeStrategy> {
    if (this.serveMode === 'proxy') {
      const { signal } = options;
      // a client that already left takes no place in the queue
      signal?.throwIfAborted();
      const release = await this.proxyReadLimiter.acquire();
      try {
        // the client may have left while this read waited for its slot
        signal?.throwIfAborted();
        // forward the client's Range to S3 and relay its partial response, so
        // <video> elements (which require 206) can stream and seek in proxy mode
        const { stream, length, contentRange } = await this.getObject(key, options.range, signal);
        return { type: 'stream', stream: this.holdSlotUntilClosed(stream, release, signal), length, contentRange };
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
}
