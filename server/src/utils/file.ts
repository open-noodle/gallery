import { HttpException, NotFoundException, StreamableFile } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { access, constants } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { CacheControl } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { ImmichReadStream } from 'src/repositories/storage.repository.js';
import { onRouteError } from 'src/utils/logger.js';

export function getFileNameWithoutExtension(path: string): string {
  return basename(path, getFilenameExtension(path));
}

export function getFilenameExtension(path: string) {
  const extension = extname(path);
  if (!extension && path.startsWith('.') && !path.includes('.', 1)) {
    return path;
  }
  return extension;
}

export function getLivePhotoMotionFilename(stillName: string, motionName: string) {
  return getFileNameWithoutExtension(stillName) + getFilenameExtension(motionName);
}

export type ContentDisposition = 'inline' | 'attachment';

export const getContentDispositionHeader = (disposition: ContentDisposition, fileName: string): string => {
  return `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

export class ImmichFileResponse {
  public readonly path!: string;
  public readonly contentType!: string;
  public readonly cacheControl!: CacheControl;
  public readonly fileName?: string;
  public readonly disposition?: ContentDisposition;

  constructor(response: ImmichFileResponse) {
    Object.assign(this, response);
  }
}

export class ImmichRedirectResponse {
  public readonly url!: string;
  public readonly cacheControl!: CacheControl;

  constructor(response: ImmichRedirectResponse) {
    Object.assign(this, response);
  }
}

export class ImmichStreamResponse {
  public readonly stream!: Readable;
  public readonly contentType!: string;
  /** Byte count of `stream` — the partial length when `contentRange` is set, the full object otherwise. */
  public readonly length?: number;
  /** Set only for a partial read (e.g. `bytes 0-1023/1048576`); turns the response into a 206. */
  public readonly contentRange?: string;
  /** Whether this endpoint forwards the client's `Range` header, i.e. whether `Accept-Ranges` is truthful. */
  public readonly acceptsRanges?: boolean;
  public readonly cacheControl!: CacheControl;
  public readonly fileName?: string;
  public readonly disposition?: ContentDisposition;

  constructor(response: ImmichStreamResponse) {
    Object.assign(this, response);
  }
}

export type ImmichMediaResponse = ImmichFileResponse | ImmichRedirectResponse | ImmichStreamResponse;

type SendFile = Parameters<Response['sendFile']>;
type SendFileOptions = SendFile[1];

const cacheControlHeaders: Record<CacheControl, string | null> = {
  [CacheControl.PrivateWithCache]:
    'private, max-age=86400, no-transform, stale-while-revalidate=2592000, stale-if-error=2592000',
  [CacheControl.PrivateWithoutCache]: 'private, no-cache, no-transform',
  [CacheControl.None]: null, // falsy value to prevent adding Cache-Control header
};

// How long a proxied S3 stream may go without delivering data before it is destroyed.
// Anchored to the 60s send-timeout default common to reverse proxies sitting in front of
// S3-compatible endpoints, so the timer usually fires on a connection the remote has
// already given up on. Exported so tests derive their timings from it instead of
// hard-coding a value that silently drifts out of sync when this one changes.
export const S3_STREAM_IDLE_TIMEOUT_MS = 60_000;

export const sendFile = async (
  res: Response,
  next: NextFunction,
  handler: () => Promise<ImmichMediaResponse> | ImmichMediaResponse,
  logger: LoggingRepository,
): Promise<void> => {
  // promisified version of 'res.sendFile' for cleaner async handling
  const _sendFile = (path: string, options: SendFileOptions) =>
    promisify<string, SendFileOptions>(res.sendFile).bind(res)(path, options);

  try {
    const file = await handler();

    if (file instanceof ImmichRedirectResponse) {
      let parsed: URL;
      try {
        parsed = new URL(file.url);
      } catch {
        throw new HttpException('Invalid redirect URL', 500);
      }

      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new HttpException('Invalid redirect URL protocol', 500);
      }

      const cacheControlHeader = cacheControlHeaders[file.cacheControl];
      if (cacheControlHeader) {
        res.set('Cache-Control', cacheControlHeader);
      }
      res.redirect(file.url);
      return;
    }

    if (file instanceof ImmichStreamResponse) {
      // The client can disconnect while we were still awaiting the backend's initial
      // fetch (getServeStrategy/getObject), i.e. before file.stream even existed. Nothing
      // below would ever notice that: `res.once('close', ...)` can't fire for a close that
      // already happened, and nothing else pipes or resumes file.stream, so it would sit
      // forever as an unconsumed, un-destroyed Readable — holding its proxyReadLimiter slot
      // permanently, since releaseWhenStreamCloses is waiting on 'close'/'error'/'end' events
      // that will now never come. A burst of client aborts during the initial fetch (a fast
      // scroll past many thumbnails) can leak the whole pool this way, well before the idle
      // timer below ever gets a chance to run. Catch it here, before touching res at all.
      if (res.destroyed || res.writableEnded) {
        file.stream.destroy();
        return;
      }

      const cacheControlHeader = cacheControlHeaders[file.cacheControl];
      if (cacheControlHeader) {
        res.set('Cache-Control', cacheControlHeader);
      }
      res.header('Content-Type', file.contentType);
      // only claim range support for endpoints that actually forward the Range header —
      // advertising it while ignoring Range invites a client to resume a download and
      // append a full 200 body to its partial file
      if (file.acceptsRanges) {
        res.header('Accept-Ranges', 'bytes');
      }
      if (file.contentRange) {
        // the backend served a partial read; WebKit refuses to play <video> without a 206
        res.status(206);
        res.header('Content-Range', file.contentRange);
      }
      if (file.length !== undefined) {
        res.header('Content-Length', String(file.length));
      }
      if (file.fileName) {
        res.header('Content-Disposition', getContentDispositionHeader(file.disposition ?? 'inline', file.fileName));
      }
      // Idle timeout for proxied S3 streams. When `.pipe()` applies backpressure (the browser
      // has buffered ahead and stopped reading), Node stops the libuv read watcher on the S3
      // socket. While stopped it cannot notice the remote closing the connection, so the
      // socket zombies — dead at the OS level, but still holding its proxy-read slot — until
      // the browser resumes or the process restarts. Once every slot is held by a zombie,
      // each new proxied read blocks in `proxyReadLimiter.acquire()` and never returns.
      // Destroying the stream is what releases both the socket and the slot.
      //
      // The window is a tuning knob rather than a correctness bound: `.destroy()` behaves
      // identically whether or not the remote has already hung up. Too long leaves zombies
      // holding slots; too short cuts streams the client could still have resumed.
      let lastDataAt = Date.now();
      let idleTimer: ReturnType<typeof setTimeout> | undefined;

      // runs for every chunk of every proxied read — keep it to the single assignment
      const onData = () => {
        lastDataAt = Date.now();
      };

      const checkIdle = () => {
        const idleFor = Date.now() - lastDataAt;
        if (idleFor >= S3_STREAM_IDLE_TIMEOUT_MS) {
          file.stream.destroy(new Error('S3 stream idle timeout'));
          return;
        }

        // data arrived while this timer was pending, so the stream is not idle after all —
        // re-arm for whatever is left of the window instead of rescheduling on every chunk
        idleTimer = setTimeout(checkIdle, S3_STREAM_IDLE_TIMEOUT_MS - idleFor);
      };

      const cleanup = () => {
        clearTimeout(idleTimer);
        idleTimer = undefined;
        file.stream.removeListener('data', onData);
      };

      file.stream.once('end', cleanup);
      file.stream.once('close', cleanup);
      file.stream.once('error', cleanup);

      // A client can walk away mid-stream — a <video> abandons a range response on every
      // seek. `pipe` only unpipes on the destination's close and leaves the source open,
      // so destroy it explicitly: for S3 that is what frees the socket and the proxy-read
      // slot (see `releaseWhenStreamCloses`), and without it 32 aborted seeks wedge every
      // proxied read. Destroying an already-finished stream is a no-op.
      res.once('close', () => {
        cleanup();
        file.stream.destroy();
      });

      idleTimer = setTimeout(checkIdle, S3_STREAM_IDLE_TIMEOUT_MS);

      // Attaching 'data' resumes the stream, so these two lines must stay adjacent — never
      // insert an `await` between them. `resume()` defers emission to process.nextTick, so
      // piping within the same tick guarantees no chunk is emitted before `res` is attached.
      // Watching for data from the storage backend instead would cross await boundaries and
      // lose those chunks, which is why the backend only watches for the stream closing.
      file.stream.on('data', onData);
      file.stream.pipe(res);
      return;
    }

    // ImmichFileResponse — existing behavior
    const resolvedPath = resolve(file.path);
    if (resolvedPath !== file.path) {
      throw new HttpException('Invalid file path', 400);
    }
    await access(resolvedPath, constants.R_OK);

    const cacheControlHeader = cacheControlHeaders[file.cacheControl];
    if (cacheControlHeader) {
      res.header('Cache-Control', cacheControlHeader);
    }

    res.header('Content-Type', file.contentType);
    if (file.fileName) {
      res.header('Content-Disposition', getContentDispositionHeader(file.disposition ?? 'inline', file.fileName));
    }

    return await _sendFile(resolvedPath, { root: '/', dotfiles: 'allow' });
  } catch (error: Error | any) {
    const { canWrite } = onRouteError(undefined, res, error, logger, 'Unable to send file');
    if (canWrite) {
      // gallery-fork: preserve HttpException status codes. Upstream #28843 masks
      // every sendFile error as 404, but the fork's shared-space access matrix
      // relies on 401 < 403 < 404 ordering for files served via sendFile (e.g.
      // person thumbnails), so a ForbiddenException must stay 403, not become 404.
      if (error instanceof HttpException) {
        next(error);
      } else {
        next(new NotFoundException());
      }
    }
  }
};

export const asStreamableFile = ({ stream, type, disposition, length }: ImmichReadStream) => {
  return new StreamableFile(stream, { type, disposition, length });
};
