import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CompletedPart,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  GetObjectCommandInput,
  GetObjectCommandOutput,
  HeadObjectCommand,
  HeadObjectCommandOutput,
  ListObjectsV2Command,
  S3Client,
  UploadPartCopyCommand,
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

// CopyObject copies at most 5 GiB in one request; a larger object is copied part by part with UploadPartCopy,
// whose parts are 5 MiB..5 GiB (the last one smaller) and at most 10,000 per upload. 512 MiB parts keep a large
// video to a handful of requests and only grow for an object near S3's 5 TiB maximum.
const COPY_OBJECT_MAX_BYTES = 5 * 1024 ** 3;
const MULTIPART_COPY_PART_BYTES = 512 * 1024 ** 2;
const MULTIPART_MAX_PARTS = 10_000;

/**
 * A key as the `CopySource` header needs it: S3 URL-decodes the header, so a template name's spaces, Unicode and
 * `+N` duplicate suffix (which it would read as a space) are encoded, per segment so the slashes stay.
 */
const toCopySource = (bucket: string, key: string) =>
  `${bucket}/${key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;

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
  /** Tests only: the largest object copied with one CopyObject (default 5 GiB, CopyObject's limit). */
  multipartCopyThreshold?: number;
  /** Tests only: the smallest part of a multipart copy (default 512 MiB; raised to stay within 10,000 parts). */
  multipartCopyPartSize?: number;
}

export class S3StorageBackend implements StorageBackend {
  private client: S3Client;
  private bucket: string;
  private presignedUrlExpiry: number;
  private serveMode: 'redirect' | 'proxy';
  private proxyReadLimiter: AsyncLimiter;
  private multipartCopyThreshold: number;
  private multipartCopyPartSize: number;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.presignedUrlExpiry = config.presignedUrlExpiry;
    this.serveMode = config.serveMode;
    this.proxyReadLimiter = new AsyncLimiter(config.proxyReadConcurrency ?? 32);
    this.multipartCopyThreshold = config.multipartCopyThreshold ?? COPY_OBJECT_MAX_BYTES;
    this.multipartCopyPartSize = config.multipartCopyPartSize ?? MULTIPART_COPY_PART_BYTES;

    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: !!config.endpoint, // needed for MinIO and other S3-compatible services
      // Only send and verify flexible checksums where the operation requires them, as the SDK did before it
      // turned them on by default. S3-compatible stores such as Garage return a CRC32 header for multipart
      // objects that is not the whole-object CRC the SDK computes, so every read of a large upload failed with
      // "Checksum mismatch" and metadata extraction (and so transcoding) never ran (#1133).
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
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

  async copy(fromKey: string, toKey: string): Promise<void> {
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: fromKey }));
    const size = head.ContentLength ?? 0;
    const copySource = toCopySource(this.bucket, fromKey);

    // a copy is written in STANDARD unless told otherwise; keep the class a lifecycle rule may have moved the source to
    const { ContentType, StorageClass } = head;

    if (size <= this.multipartCopyThreshold) {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: toKey,
          CopySource: copySource,
          MetadataDirective: 'COPY',
          StorageClass,
        }),
      );
      return;
    }

    await this.copyMultipart(copySource, toKey, size, { ContentType, StorageClass });
  }

  /**
   * A copy above CopyObject's limit: UploadPartCopy over consecutive byte ranges of the source, one part at a time.
   * A multipart upload does not inherit the source's metadata, so the content type and storage class are set on it. A
   * failed copy aborts the upload, or its parts would be stored (and billed) until a lifecycle rule removed them.
   */
  private async copyMultipart(
    copySource: string,
    toKey: string,
    size: number,
    source: Pick<HeadObjectCommandOutput, 'ContentType' | 'StorageClass'>,
  ): Promise<void> {
    const { UploadId } = await this.client.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: toKey, ...source }),
    );

    try {
      const partSize = Math.max(this.multipartCopyPartSize, Math.ceil(size / MULTIPART_MAX_PARTS));
      const parts: CompletedPart[] = [];
      for (let start = 0; start < size; start += partSize) {
        const end = Math.min(start + partSize, size) - 1;
        const PartNumber = parts.length + 1;
        const { CopyPartResult } = await this.client.send(
          new UploadPartCopyCommand({
            Bucket: this.bucket,
            Key: toKey,
            UploadId,
            PartNumber,
            CopySource: copySource,
            CopySourceRange: `bytes=${start}-${end}`,
          }),
        );
        parts.push({ ETag: CopyPartResult?.ETag, PartNumber });
      }

      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: toKey,
          UploadId,
          MultipartUpload: { Parts: parts },
        }),
      );
    } catch (error) {
      try {
        await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: toKey, UploadId }));
      } catch {
        // the copy's own error is the one to report
      }
      throw error;
    }
  }

  async stat(key: string): Promise<{ size: number }> {
    // a missing object rejects with NotFound rather than reading as empty
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return { size: head.ContentLength ?? 0 };
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
