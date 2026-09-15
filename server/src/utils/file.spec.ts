import { HttpException } from '@nestjs/common';
import express from 'express';
import { once } from 'node:events';
import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { CacheControl } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import {
  ImmichFileResponse,
  ImmichRedirectResponse,
  ImmichStreamResponse,
  S3_STREAM_IDLE_TIMEOUT_MS,
  sendFile,
} from 'src/utils/file.js';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockResolvedValue(void 0),
  constants: { R_OK: 4 },
}));

describe('ImmichRedirectResponse', () => {
  it('should store redirect URL and cache control', () => {
    const response = new ImmichRedirectResponse({
      url: 'https://s3.amazonaws.com/bucket/key?sig=abc',
      cacheControl: CacheControl.PrivateWithCache,
    });
    expect(response.url).toBe('https://s3.amazonaws.com/bucket/key?sig=abc');
    expect(response.cacheControl).toBe(CacheControl.PrivateWithCache);
  });
});

describe('ImmichStreamResponse', () => {
  it('should store stream and metadata', () => {
    const stream = Readable.from([Buffer.from('data')]);
    const response = new ImmichStreamResponse({
      stream,
      contentType: 'image/jpeg',
      length: 4,
      cacheControl: CacheControl.PrivateWithCache,
    });
    expect(response.stream).toBe(stream);
    expect(response.contentType).toBe('image/jpeg');
    expect(response.length).toBe(4);
  });
});

describe('sendFile with ImmichMediaResponse', () => {
  let mockLogger: LoggingRepository;

  beforeEach(() => {
    mockLogger = { debug: vi.fn(), error: vi.fn(), setContext: vi.fn() } as unknown as LoggingRepository;
  });

  it('should send redirect response with 302', async () => {
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      redirect: vi.fn(),
      headersSent: false,
    } as any;
    const next = vi.fn();

    await sendFile(
      res,
      next,
      () =>
        new ImmichRedirectResponse({
          url: 'https://s3.example.com/signed-url',
          cacheControl: CacheControl.PrivateWithCache,
        }),
      mockLogger,
    );

    expect(res.redirect).toHaveBeenCalledWith('https://s3.example.com/signed-url');
  });

  it('should pipe stream response', async () => {
    const stream = Readable.from([Buffer.from('streamed')]);
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      once: vi.fn(),
      end: vi.fn(),
    } as any;
    stream.pipe = vi.fn().mockReturnValue(res);
    const next = vi.fn();

    const handler = () =>
      new ImmichStreamResponse({
        stream,
        contentType: 'image/jpeg',
        length: 8,
        cacheControl: CacheControl.PrivateWithCache,
      });

    await sendFile(res, next, handler, mockLogger);

    expect(res.header).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
    expect(res.header).toHaveBeenCalledWith('Content-Length', '8');
  });

  it('should not advertise Accept-Ranges for an endpoint that ignores Range', async () => {
    // thumbnails / person + user images never forward the header, so claiming range
    // support would invite a client to resume a download onto a full 200 body
    const stream = Readable.from([Buffer.from('streamed')]);
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      once: vi.fn(),
    } as any;
    stream.pipe = vi.fn().mockReturnValue(res);
    const next = vi.fn();

    await sendFile(
      res,
      next,
      () =>
        new ImmichStreamResponse({
          stream,
          contentType: 'image/webp',
          length: 8,
          cacheControl: CacheControl.PrivateWithCache,
        }),
      mockLogger,
    );

    expect(res.header).not.toHaveBeenCalledWith('Accept-Ranges', expect.anything());
    expect(res.header).toHaveBeenCalledWith('Content-Length', '8');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should advertise Accept-Ranges but stay 200 for a rangeless request to a range-capable endpoint', async () => {
    const stream = Readable.from([Buffer.from('streamed')]);
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      once: vi.fn(),
    } as any;
    stream.pipe = vi.fn().mockReturnValue(res);
    const next = vi.fn();

    await sendFile(
      res,
      next,
      () =>
        new ImmichStreamResponse({
          stream,
          contentType: 'video/mp4',
          length: 1_048_576,
          acceptsRanges: true,
          cacheControl: CacheControl.PrivateWithCache,
        }),
      mockLogger,
    );

    expect(res.header).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    expect(res.header).toHaveBeenCalledWith('Content-Length', '1048576');
    expect(res.header).not.toHaveBeenCalledWith('Content-Range', expect.anything());
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should send 206 with Content-Range for a partial stream response', async () => {
    const stream = Readable.from([Buffer.from('a'.repeat(1024))]);
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      once: vi.fn(),
    } as any;
    stream.pipe = vi.fn().mockReturnValue(res);
    const next = vi.fn();

    await sendFile(
      res,
      next,
      () =>
        new ImmichStreamResponse({
          stream,
          contentType: 'video/mp4',
          length: 1024,
          contentRange: 'bytes 0-1023/1048576',
          acceptsRanges: true,
          cacheControl: CacheControl.PrivateWithCache,
        }),
      mockLogger,
    );

    expect(res.status).toHaveBeenCalledWith(206);
    expect(res.header).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    expect(res.header).toHaveBeenCalledWith('Content-Range', 'bytes 0-1023/1048576');
    expect(res.header).toHaveBeenCalledWith('Content-Length', '1024');
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('should pipe stream response with fileName header', async () => {
    const stream = Readable.from([Buffer.from('streamed')]);
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
      once: vi.fn(),
    } as any;
    stream.pipe = vi.fn().mockReturnValue(res);
    const next = vi.fn();

    await sendFile(
      res,
      next,
      () =>
        new ImmichStreamResponse({
          stream,
          contentType: 'image/jpeg',
          cacheControl: CacheControl.PrivateWithCache,
          fileName: 'photo.jpg',
        }),
      mockLogger,
    );

    expect(res.header).toHaveBeenCalledWith('Content-Disposition', `inline; filename*=UTF-8''photo.jpg`);
  });

  it('should set cache-control for redirect with None', async () => {
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      redirect: vi.fn(),
      headersSent: false,
    } as any;
    const next = vi.fn();

    await sendFile(
      res,
      next,
      () =>
        new ImmichRedirectResponse({
          url: 'https://example.com',
          cacheControl: CacheControl.None,
        }),
      mockLogger,
    );

    expect(res.set).not.toHaveBeenCalledWith('Cache-Control', expect.anything());
    expect(res.redirect).toHaveBeenCalledWith('https://example.com');
  });

  it('should reject redirect with javascript: protocol', async () => {
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      redirect: vi.fn(),
      headersSent: false,
    } as any;
    const next = vi.fn();

    await sendFile(
      res,
      next,
      () =>
        new ImmichRedirectResponse({
          url: 'javascript:alert(1)',
          cacheControl: CacheControl.None,
        }),
      mockLogger,
    );

    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(HttpException));
  });

  it('should reject redirect with invalid URL', async () => {
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      redirect: vi.fn(),
      headersSent: false,
    } as any;
    const next = vi.fn();

    await sendFile(
      res,
      next,
      () =>
        new ImmichRedirectResponse({
          url: '//evil.com/path',
          cacheControl: CacheControl.None,
        }),
      mockLogger,
    );

    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(HttpException));
  });

  it('should send file response for ImmichFileResponse', async () => {
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
      sendFile: vi.fn((_path: string, _options: any, cb: (err?: Error) => void) => cb()),
    } as any;
    const next = vi.fn();

    await sendFile(
      res,
      next,
      () =>
        new ImmichFileResponse({
          path: '/tmp/test-file.jpg',
          contentType: 'image/jpeg',
          cacheControl: CacheControl.PrivateWithCache,
        }),
      mockLogger,
    );

    expect(res.header).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
    expect(res.header).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('private'));
  });

  it('should send file response with fileName for ImmichFileResponse', async () => {
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
      sendFile: vi.fn((_path: string, _options: any, cb: (err?: Error) => void) => cb()),
    } as any;
    const next = vi.fn();

    await sendFile(
      res,
      next,
      () =>
        new ImmichFileResponse({
          path: '/tmp/test-file.jpg',
          contentType: 'image/jpeg',
          cacheControl: CacheControl.PrivateWithCache,
          fileName: 'my-photo.jpg',
        }),
      mockLogger,
    );

    expect(res.header).toHaveBeenCalledWith('Content-Disposition', `inline; filename*=UTF-8''my-photo.jpg`);
  });

  it('should send file response with attachment disposition', async () => {
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
      sendFile: vi.fn((_path: string, _options: any, cb: (err?: Error) => void) => cb()),
    } as any;
    const next = vi.fn();

    await sendFile(
      res,
      next,
      () =>
        new ImmichFileResponse({
          path: '/tmp/test-file.jpg',
          contentType: 'image/jpeg',
          cacheControl: CacheControl.PrivateWithCache,
          fileName: 'my photo.jpg',
          disposition: 'attachment',
        }),
      mockLogger,
    );

    expect(res.header).toHaveBeenCalledWith('Content-Disposition', `attachment; filename*=UTF-8''my%20photo.jpg`);
  });

  it('should set expiry-safe cache-control for redirect responses', async () => {
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      redirect: vi.fn(),
      headersSent: false,
    } as any;
    const next = vi.fn();

    await sendFile(
      res,
      next,
      () =>
        new ImmichRedirectResponse({
          url: 'https://s3.example.com/signed-url',
          cacheControl: CacheControl.PrivateWithoutCache,
        }),
      mockLogger,
    );

    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-cache, no-transform');
    expect(res.redirect).toHaveBeenCalledWith('https://s3.example.com/signed-url');
  });

  it('should reject file path with traversal segments', async () => {
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
      sendFile: vi.fn((_path: string, _options: any, cb: (err?: Error) => void) => cb()),
    } as any;
    const next = vi.fn();

    await sendFile(
      res,
      next,
      () =>
        new ImmichFileResponse({
          path: '/upload/library/../../../etc/passwd',
          contentType: 'application/octet-stream',
          cacheControl: CacheControl.None,
        }),
      mockLogger,
    );

    expect(res.sendFile).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(HttpException));
  });

  it('should pass root option to sendFile to prevent path traversal', async () => {
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
      sendFile: vi.fn((_path: string, _options: any, cb: (err?: Error) => void) => cb()),
    } as any;
    const next = vi.fn();

    await sendFile(
      res,
      next,
      () =>
        new ImmichFileResponse({
          path: '/tmp/test-file.jpg',
          contentType: 'image/jpeg',
          cacheControl: CacheControl.PrivateWithCache,
        }),
      mockLogger,
    );

    expect(res.sendFile).toHaveBeenCalledWith(
      '/tmp/test-file.jpg',
      { root: '/', dotfiles: 'allow' },
      expect.any(Function),
    );
  });

  it('should handle non-http errors by logging and calling next', async () => {
    const error = new Error('Something went wrong');
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
    } as any;
    const next = vi.fn();

    await sendFile(res, next, () => Promise.reject(error), mockLogger);

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Unknown error'), error.stack);
    expect(next).toHaveBeenCalledWith(expect.any(HttpException));
  });

  it('should not log HttpException errors', async () => {
    const error = new HttpException('Not Found', 404);
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
    } as any;
    const next = vi.fn();

    await sendFile(res, next, () => Promise.reject(error), mockLogger);

    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(HttpException));
  });

  it('should silently ignore connection aborted errors', async () => {
    const error = new Error('Connection aborted');
    (error as any).code = 'ECONNABORTED';
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
    } as any;
    const next = vi.fn();

    await sendFile(res, next, () => Promise.reject(error), mockLogger);

    expect(next).not.toHaveBeenCalled();
  });

  it('should silently return if headers are already sent', async () => {
    const error = new Error('Something went wrong');
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: true,
    } as any;
    const next = vi.fn();

    await sendFile(res, next, () => Promise.reject(error), mockLogger);

    expect(next).not.toHaveBeenCalled();
  });
});

describe('S3 stream idle timeout', () => {
  const TIMEOUT = S3_STREAM_IDLE_TIMEOUT_MS;
  let mockLogger: LoggingRepository;

  beforeEach(() => {
    vi.useFakeTimers();
    mockLogger = { debug: vi.fn(), error: vi.fn(), setContext: vi.fn() } as unknown as LoggingRepository;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // starts a proxied stream response the way sendFile does, with `pipe` stubbed out so the
  // stream stays quiet and only the idle timer acts on it
  const startProxyStream = async () => {
    const stream = new Readable({ read() {} });
    const destroy = vi.spyOn(stream, 'destroy');
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      once: vi.fn(),
    } as any;
    stream.pipe = vi.fn() as any;

    await sendFile(
      res,
      vi.fn(),
      () =>
        new ImmichStreamResponse({
          stream,
          contentType: 'video/mp4',
          cacheControl: CacheControl.PrivateWithCache,
        }),
      mockLogger,
    );

    return { stream, destroy, res };
  };

  it('should destroy the stream after a full idle window with no data', async () => {
    const { destroy } = await startProxyStream();

    vi.advanceTimersByTime(TIMEOUT - 1);
    expect(destroy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(destroy).toHaveBeenCalledWith(expect.objectContaining({ message: 'S3 stream idle timeout' }));
  });

  it('should not destroy the stream while data keeps arriving', async () => {
    const { stream, destroy } = await startProxyStream();

    // span more than two full windows — a timer that never reset would have fired long ago
    for (let elapsed = 0; elapsed < TIMEOUT * 2.5; elapsed += TIMEOUT / 4) {
      vi.advanceTimersByTime(TIMEOUT / 4);
      stream.emit('data', Buffer.from('x'));
    }

    expect(destroy).not.toHaveBeenCalled();
  });

  it('should destroy the stream one full window after the last chunk, not after the first', async () => {
    const { stream, destroy } = await startProxyStream();

    vi.advanceTimersByTime(TIMEOUT * 0.9);
    stream.emit('data', Buffer.from('x'));

    // the timer armed at the start fires in here, but the stream has only been idle for a
    // tenth of a window, so it has to re-arm for the remainder instead of destroying
    vi.advanceTimersByTime(TIMEOUT * 0.9);
    expect(destroy).not.toHaveBeenCalled();

    // now a full window has passed since that last chunk
    vi.advanceTimersByTime(TIMEOUT * 0.1);
    expect(destroy).toHaveBeenCalledWith(expect.objectContaining({ message: 'S3 stream idle timeout' }));
  });

  it('should clear the idle timer when the stream ends normally', async () => {
    const { stream, destroy } = await startProxyStream();

    stream.emit('end');
    vi.advanceTimersByTime(TIMEOUT * 2);

    expect(destroy).not.toHaveBeenCalled();
  });

  it('should clear the idle timer when the downstream response closes', async () => {
    const { destroy, res } = await startProxyStream();

    vi.advanceTimersByTime(TIMEOUT / 2);

    const closeHandler = res.once.mock.calls.find((call: any[]) => call[0] === 'close')?.[1];
    closeHandler();

    // `res.once('close')` destroys with no argument — pre-existing behavior
    expect(destroy).toHaveBeenCalledWith();

    // the idle timer was cleared, so nothing destroys it a second time
    vi.advanceTimersByTime(TIMEOUT * 2);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('sendFile with a client that disconnects before the stream is ready', () => {
  let mockLogger: LoggingRepository;

  beforeEach(() => {
    mockLogger = { debug: vi.fn(), error: vi.fn(), setContext: vi.fn() } as unknown as LoggingRepository;
  });

  // res.once('close', ...) can only catch a close that hasn't happened yet -- it can't fire
  // for one that already did. A client that aborts while the handler is still awaiting the
  // backend's initial fetch (getServeStrategy/getObject) leaves res already destroyed by the
  // time the handler resolves, so that registration is a no-op and nothing else ever pipes
  // or resumes the stream either. Without an upfront guard, the stream -- and the
  // proxyReadLimiter slot it holds -- would leak forever.
  it('destroys the stream immediately and never touches res, when res is already destroyed', async () => {
    const stream = new Readable({ read() {} });
    const streamDestroy = vi.spyOn(stream, 'destroy');
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      once: vi.fn(),
      destroyed: true,
      writableEnded: false,
    } as any;

    await sendFile(
      res,
      vi.fn(),
      () =>
        new ImmichStreamResponse({
          stream,
          contentType: 'video/mp4',
          cacheControl: CacheControl.PrivateWithCache,
        }),
      mockLogger,
    );

    // no-arg destroy, matching the existing res.once('close', ...) cleanup convention below --
    // this is an orderly "client's gone" teardown, not an error condition to surface
    expect(streamDestroy).toHaveBeenCalledWith();
    expect(res.set).not.toHaveBeenCalled();
    expect(res.header).not.toHaveBeenCalled();
    expect(res.once).not.toHaveBeenCalled();
  });

  it('destroys the stream immediately when BOTH destroyed and writableEnded are already true', async () => {
    // belt-and-suspenders: a real dead connection can plausibly present as either depending
    // on how it died (client RST vs a clean end from the other side) -- covers both flags at
    // once, and that setting neither doesn't false-positive.
    const stream = new Readable({ read() {} });
    const streamDestroy = vi.spyOn(stream, 'destroy');
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      once: vi.fn(),
      destroyed: true,
      writableEnded: true,
    } as any;

    await sendFile(
      res,
      vi.fn(),
      () =>
        new ImmichStreamResponse({
          stream,
          contentType: 'video/mp4',
          cacheControl: CacheControl.PrivateWithCache,
        }),
      mockLogger,
    );

    expect(streamDestroy).toHaveBeenCalledWith();
    expect(res.header).not.toHaveBeenCalled();
  });

  it('destroys the stream immediately when res.writableEnded is already true', async () => {
    const stream = new Readable({ read() {} });
    const streamDestroy = vi.spyOn(stream, 'destroy');
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      once: vi.fn(),
      destroyed: false,
      writableEnded: true,
    } as any;

    await sendFile(
      res,
      vi.fn(),
      () =>
        new ImmichStreamResponse({
          stream,
          contentType: 'video/mp4',
          cacheControl: CacheControl.PrivateWithCache,
        }),
      mockLogger,
    );

    expect(streamDestroy).toHaveBeenCalledWith();
    expect(res.header).not.toHaveBeenCalled();
  });

  it('proceeds normally when res is still alive', async () => {
    const stream = new Readable({ read() {} });
    stream.pipe = vi.fn() as any;
    const streamDestroy = vi.spyOn(stream, 'destroy');
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      once: vi.fn(),
      destroyed: false,
      writableEnded: false,
    } as any;

    await sendFile(
      res,
      vi.fn(),
      () =>
        new ImmichStreamResponse({
          stream,
          contentType: 'video/mp4',
          cacheControl: CacheControl.PrivateWithCache,
        }),
      mockLogger,
    );

    expect(streamDestroy).not.toHaveBeenCalled();
    expect(res.header).toHaveBeenCalledWith('Content-Type', 'video/mp4');
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });
});

describe('sendFile stream responses over real HTTP', () => {
  const mockLogger = { error: vi.fn(), setContext: vi.fn() } as unknown as LoggingRepository;
  const object = Buffer.from('0123456789'.repeat(200)); // 2000 bytes

  const appServing = (response: () => ImmichStreamResponse) => {
    const app = express();
    app.get('/media', (_req, res, next) => void sendFile(res, next, response, mockLogger));
    return app;
  };

  it('should answer a range request with 206 and the requested bytes', async () => {
    const partial = object.subarray(0, 1024);
    const app = appServing(
      () =>
        new ImmichStreamResponse({
          stream: Readable.from([partial]),
          contentType: 'video/mp4',
          length: partial.length,
          contentRange: `bytes 0-1023/${object.length}`,
          acceptsRanges: true,
          cacheControl: CacheControl.PrivateWithCache,
        }),
    );

    const response = await request(app).get('/media').set('Range', 'bytes=0-1023');

    expect(response.status).toBe(206);
    expect(response.headers['content-range']).toBe(`bytes 0-1023/${object.length}`);
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['content-length']).toBe('1024');
    expect(response.body.length).toBe(1024);
  });

  it('should answer a rangeless request with 200 and the whole object', async () => {
    const app = appServing(
      () =>
        new ImmichStreamResponse({
          stream: Readable.from([object]),
          contentType: 'video/mp4',
          length: object.length,
          acceptsRanges: true,
          cacheControl: CacheControl.PrivateWithCache,
        }),
    );

    const response = await request(app).get('/media');

    expect(response.status).toBe(200);
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['content-range']).toBeUndefined();
    expect(response.headers['content-length']).toBe(String(object.length));
    expect(response.body.length).toBe(object.length);
  });

  it('should destroy the source stream when the client aborts mid-response', async () => {
    // A <video> abandons a range response on every seek. `pipe` alone leaves the source
    // open, which strands the S3 socket and its proxy-read slot until the process dies —
    // 32 abandoned seeks are enough to wedge every proxied read.
    // self-reference instead of `this` (unicorn/no-this-outside-of-class)
    const source: Readable = new Readable({
      read() {
        source.push(Buffer.alloc(64 * 1024, 'x'));
      },
    });

    const app = appServing(
      () =>
        new ImmichStreamResponse({
          stream: source,
          contentType: 'video/mp4',
          acceptsRanges: true,
          contentRange: 'bytes 0-999999/999999999',
          cacheControl: CacheControl.PrivateWithCache,
        }),
    );
    const server = app.listen(0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    await new Promise<void>((resolve) => {
      const clientRequest = get(`http://127.0.0.1:${port}/media`, (response) => {
        response.once('data', () => {
          clientRequest.destroy();
          resolve();
        });
      });
      clientRequest.once('error', () => resolve());
    });

    await vi.waitFor(() => expect(source.destroyed).toBe(true));
    server.close();
  });

  it('should destroy an orphaned stream when the client disconnects before the handler resolves', async () => {
    // The production trigger: a client aborts (e.g. scrolls past a thumbnail) while the
    // handler is still awaiting the backend's initial fetch (getServeStrategy/getObject),
    // i.e. before any stream exists yet. A real disconnected `res` -- not a mock -- so this
    // exercises the actual `res.destroyed`/`res.writableEnded` values Node/Express set, not
    // an assumption about their shape.
    const source: Readable = new Readable({ read() {} });
    const sourceDestroy = vi.spyOn(source, 'destroy');

    const { promise: handlerGate, resolve: resolveHandler } = Promise.withResolvers<void>();
    const { promise: resClosed, resolve: notifyResClosed } = Promise.withResolvers<void>();
    // res.once('close', ...) below is only registered once Express actually dispatches to
    // this route handler -- destroying the client connection before that happens would leave
    // it unregistered and the test hanging forever, so wait for it explicitly rather than
    // guessing at timing with the client-side 'socket' event.
    const { promise: handlerStarted, resolve: notifyHandlerStarted } = Promise.withResolvers<void>();

    const app = express();
    app.get('/media', (_req, res, next) => {
      res.once('close', () => notifyResClosed());
      notifyHandlerStarted();
      void sendFile(
        res,
        next,
        async () => {
          // simulates the in-flight S3 GetObject the client's disconnect races against
          await handlerGate;
          return new ImmichStreamResponse({
            stream: source,
            contentType: 'video/mp4',
            cacheControl: CacheControl.PrivateWithCache,
          });
        },
        mockLogger,
      );
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const clientRequest = get(`http://127.0.0.1:${port}/media`);
    clientRequest.once('error', () => {}); // destroy() below causes an expected client-side ECONNRESET

    await handlerStarted;
    clientRequest.destroy();

    // wait for the server to have actually observed the disconnect before letting the
    // "S3 fetch" resolve -- otherwise this just re-tests the ordinary res.once('close') path
    await resClosed;
    resolveHandler();

    await vi.waitFor(() => expect(sourceDestroy).toHaveBeenCalledWith());
    server.close();
  });
});
