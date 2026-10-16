import { S3StorageBackend } from 'src/backends/s3-storage.backend.js';
import { BackendMediaServer } from 'src/gallery/utils/backend-media-server.js';
import { BaseService } from 'src/services/base.service.js';
import { StorageService } from 'src/services/storage.service.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe(BackendMediaServer.name, () => {
  let sut: BackendMediaServer;
  let mocks: ServiceMocks;

  beforeEach(() => {
    let service: BaseService;
    ({ sut: service, mocks } = newTestService(BaseService));
    sut = (service as any).backendMedia;
  });

  afterEach(() => {
    // vitest.config.mjs sets no restoreMocks, so a StorageService spy would leak into later tests
    vi.restoreAllMocks();
  });

  describe('writeFileIfMissing', () => {
    const data = Buffer.from('video');

    it('creates the folder and writes a missing disk file', async () => {
      mocks.storage.checkFileExists.mockResolvedValue(false);

      await expect(sut.writeFileIfMissing('/data/encoded-video/u/ab/cd/x-MP.mp4', data, 'video/mp4')).resolves.toBe(
        true,
      );

      expect(mocks.storage.mkdirSync).toHaveBeenCalledWith('/data/encoded-video/u/ab/cd');
      expect(mocks.storage.createFile).toHaveBeenCalledWith('/data/encoded-video/u/ab/cd/x-MP.mp4', data);
    });

    it('leaves an existing disk file alone', async () => {
      mocks.storage.checkFileExists.mockResolvedValue(true);

      await expect(sut.writeFileIfMissing('/data/x-MP.mp4', data, 'video/mp4')).resolves.toBe(false);

      expect(mocks.storage.createFile).not.toHaveBeenCalled();
    });

    it('uploads a missing S3 object', async () => {
      const s3 = { exists: vi.fn().mockResolvedValue(false), put: vi.fn().mockResolvedValue(void 0) };
      vi.spyOn(StorageService, 'backendFor').mockReturnValue(s3 as unknown as S3StorageBackend);

      await expect(sut.writeFileIfMissing('encoded-video/u/ab/cd/x-MP.mp4', data, 'video/mp4')).resolves.toBe(true);

      expect(s3.put).toHaveBeenCalledWith('encoded-video/u/ab/cd/x-MP.mp4', data, { contentType: 'video/mp4' });
      expect(mocks.storage.createFile).not.toHaveBeenCalled();
    });

    it('leaves an existing S3 object alone', async () => {
      const s3 = { exists: vi.fn().mockResolvedValue(true), put: vi.fn() };
      vi.spyOn(StorageService, 'backendFor').mockReturnValue(s3 as unknown as S3StorageBackend);

      await expect(sut.writeFileIfMissing('encoded-video/u/ab/cd/x-MP.mp4', data, 'video/mp4')).resolves.toBe(false);

      expect(s3.put).not.toHaveBeenCalled();
    });
  });
});
