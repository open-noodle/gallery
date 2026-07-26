import { HttpException } from '@nestjs/common';
import express from 'express';
import { once } from 'node:events';
import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { CacheControl } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { ImmichFileResponse, ImmichRedirectResponse, ImmichStreamResponse, sendFile } from 'src/utils/file';
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
    mockLogger = { error: vi.fn(), setContext: vi.fn() } as unknown as LoggingRepository;
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
    expect(res.set).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('private'));
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

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Unable to send file'), error.stack);
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
    const source = new Readable({
      read() {
        this.push(Buffer.alloc(64 * 1024, 'x'));
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
});
