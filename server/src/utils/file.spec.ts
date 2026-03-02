import { describe, expect, it, vi } from 'vitest';
import { ImmichFileResponse, ImmichRedirectResponse, ImmichStreamResponse, sendFile } from 'src/utils/file';
import { CacheControl } from 'src/enum';
import { Readable } from 'node:stream';
import { LoggingRepository } from 'src/repositories/logging.repository';

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
  const mockLogger = { error: vi.fn(), setContext: vi.fn() } as unknown as LoggingRepository;

  it('should send redirect response with 302', async () => {
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      redirect: vi.fn(),
      headersSent: false,
    } as any;
    const next = vi.fn();

    const handler = () =>
      new ImmichRedirectResponse({
        url: 'https://s3.example.com/signed-url',
        cacheControl: CacheControl.PrivateWithCache,
      });

    await sendFile(res, next, handler, mockLogger);

    expect(res.redirect).toHaveBeenCalledWith('https://s3.example.com/signed-url');
  });

  it('should pipe stream response', async () => {
    const stream = Readable.from([Buffer.from('streamed')]);
    const res = {
      set: vi.fn(),
      header: vi.fn(),
      headersSent: false,
      status: vi.fn().mockReturnThis(),
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
});
