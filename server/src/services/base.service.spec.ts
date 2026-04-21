import { BaseService } from 'src/services/base.service';
import { newTestService } from 'test/utils';

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
      const result = await (sut as any).ensureLocalFile('/var/lib/immich/upload/abc.jpg');
      expect(result.localPath).toBe('/var/lib/immich/upload/abc.jpg');
      await expect(result.cleanup()).resolves.not.toThrow();
    });

    it('downloads relative keys via the backend and returns its cleanup', async () => {
      const backendCleanup = vi.fn().mockResolvedValue(void 0);
      const backend = {
        downloadToTemp: vi.fn().mockResolvedValue({ tempPath: '/tmp/abc.jpg', cleanup: backendCleanup }),
      };
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'resolveBackendForKey').mockReturnValue(backend as any);

      const result = await (sut as any).ensureLocalFile('upload/user/abc.jpg');

      expect(StorageService.resolveBackendForKey).toHaveBeenCalledWith('upload/user/abc.jpg');
      expect(backend.downloadToTemp).toHaveBeenCalledWith('upload/user/abc.jpg');
      expect(result.localPath).toBe('/tmp/abc.jpg');
      await result.cleanup();
      expect(backendCleanup).toHaveBeenCalledOnce();
    });

    it('propagates errors from resolveBackendForKey without leaking cleanup', async () => {
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'resolveBackendForKey').mockImplementation(() => {
        throw new Error('unknown backend');
      });

      await expect((sut as any).ensureLocalFile('unknown://foo')).rejects.toThrow('unknown backend');
    });

    it('propagates errors from downloadToTemp without leaking cleanup', async () => {
      const backend = { downloadToTemp: vi.fn().mockRejectedValue(new Error('S3 unavailable')) };
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'resolveBackendForKey').mockReturnValue(backend as any);

      await expect((sut as any).ensureLocalFile('upload/user/abc.jpg')).rejects.toThrow('S3 unavailable');
    });
  });
});
