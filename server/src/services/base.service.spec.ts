import { CLS_REQ, ClsServiceManager } from 'nestjs-cls';
import { EventEmitter } from 'node:events';
import { CacheControl } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { BaseService } from 'src/services/base.service.js';
import { sendFile } from 'src/utils/file.js';
import { newTestService } from 'test/utils.js';

describe(BaseService.name, () => {
  let sut: BaseService;

  beforeEach(() => {
    ({ sut } = newTestService(BaseService));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('ensureLocalFile', () => {
    it('returns the path as-is with a no-op cleanup for absolute paths', async () => {
      const result = await (sut as any).backendMedia.ensureLocalFile('/var/lib/immich/upload/abc.jpg');
      expect(result.localPath).toBe('/var/lib/immich/upload/abc.jpg');
      await expect(result.cleanup()).resolves.not.toThrow();
    });

    it('downloads relative keys via the backend and returns its cleanup', async () => {
      const backendCleanup = vi.fn().mockResolvedValue(void 0);
      const backend = {
        downloadToTemp: vi.fn().mockResolvedValue({ tempPath: '/tmp/abc.jpg', cleanup: backendCleanup }),
      };
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'backendFor').mockReturnValue(backend as any);

      const result = await (sut as any).backendMedia.ensureLocalFile('upload/user/abc.jpg');

      expect(StorageService.backendFor).toHaveBeenCalledWith('upload/user/abc.jpg', expect.anything());
      expect(backend.downloadToTemp).toHaveBeenCalledWith('upload/user/abc.jpg');
      expect(result.localPath).toBe('/tmp/abc.jpg');
      await result.cleanup();
      expect(backendCleanup).toHaveBeenCalledOnce();
    });

    it('runs the backend cleanup when an `await using` scope exits, including on error', async () => {
      const backendCleanup = vi.fn().mockResolvedValue(void 0);
      const backend = {
        downloadToTemp: vi.fn().mockResolvedValue({ tempPath: '/tmp/abc.jpg', cleanup: backendCleanup }),
      };
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'backendFor').mockReturnValue(backend as any);

      await expect(
        (async () => {
          await using local = await (sut as any).backendMedia.ensureLocalFile('upload/user/abc.jpg');
          expect(local.localPath).toBe('/tmp/abc.jpg');
          throw new Error('handler failed');
        })(),
      ).rejects.toThrow('handler failed');
      expect(backendCleanup).toHaveBeenCalledOnce();
    });

    it('propagates errors from backendFor without leaking cleanup', async () => {
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'backendFor').mockImplementation(() => {
        throw new Error('unknown backend');
      });

      await expect((sut as any).backendMedia.ensureLocalFile('unknown://foo')).rejects.toThrow('unknown backend');
    });

    it('propagates errors from downloadToTemp without leaking cleanup', async () => {
      const backend = { downloadToTemp: vi.fn().mockRejectedValue(new Error('S3 unavailable')) };
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'backendFor').mockReturnValue(backend as any);

      await expect((sut as any).backendMedia.ensureLocalFile('upload/user/abc.jpg')).rejects.toThrow('S3 unavailable');
    });
  });

  describe('serveFromBackend', () => {
    it('hands the backend the signal of the response it is serving', async () => {
      const backend = { getServeStrategy: vi.fn().mockResolvedValue({ type: 'redirect', url: 'https://s3/key' }) };
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'backendFor').mockReturnValue(backend as any);
      const res = Object.assign(new EventEmitter(), { set: vi.fn(), redirect: vi.fn() }) as any;

      await sendFile(
        res,
        vi.fn(),
        () => (sut as any).backendMedia.serveFromBackend('upload/user/abc.mp4', 'video/mp4', CacheControl.None),
        { debug: vi.fn(), error: vi.fn() } as unknown as LoggingRepository,
      );

      const { signal } = backend.getServeStrategy.mock.calls[0][1];
      expect(signal.aborted).toBe(false);
      res.emit('close');
      expect(signal.aborted).toBe(true);
    });

    // A client that puts its credential in a header would resend it to the storage host on a redirect.
    it.each([
      ['an API key', { 'x-api-key': 'secret' }, true],
      ['a bearer token', { authorization: 'Bearer secret' }, true],
      ['a user token header', { 'x-immich-user-token': 'secret' }, true],
      ['a session token header', { 'x-immich-session-token': 'secret' }, true],
      ['a shared link key header', { 'x-immich-share-key': 'secret' }, true],
      ['only a session cookie', { cookie: 'immich_access_token=secret' }, false],
    ])('picks the serve path for a request with %s', async (_, headers, proxy) => {
      const backend = { getServeStrategy: vi.fn().mockResolvedValue({ type: 'redirect', url: 'https://s3/key' }) };
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'backendFor').mockReturnValue(backend as any);
      const cls = ClsServiceManager.getClsService();

      await cls.run(() => {
        cls.set(CLS_REQ, { headers });
        return (sut as any).backendMedia.serveFromBackend('upload/user/abc.jpg', 'image/jpeg', CacheControl.None);
      });

      expect(backend.getServeStrategy.mock.calls[0][1].proxy ?? false).toBe(proxy);
    });
  });
});
