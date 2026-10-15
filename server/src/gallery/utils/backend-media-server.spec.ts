import { S3StorageBackend } from 'src/backends/s3-storage.backend.js';
import { StorageRoutingKind } from 'src/backends/storage-router.js';
import { AssetFileType } from 'src/enum.js';
import { BackendMediaServer } from 'src/gallery/utils/backend-media-server.js';
import { BaseService } from 'src/services/base.service.js';
import { StorageService } from 'src/services/storage.service.js';
import { ServiceMocks, makeStream, newTestService } from 'test/utils.js';

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

  // A remote write backend whose resolution is observable, for the routing cases.
  const remote = () => {
    const put = vi.fn().mockResolvedValue(void 0);
    const getWriteBackend = vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put } as any);
    mocks.storage.createPlainReadStream.mockReturnValue(makeStream([Buffer.from('data')]) as any);
    return { put, getWriteBackend };
  };

  describe('persistFile', () => {
    it('uploads to the write backend and removes the local temp (S3 mode)', async () => {
      const put = vi.fn().mockResolvedValue(void 0);
      const stream = makeStream([Buffer.from('data')]);
      vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put } as any);
      mocks.storage.createPlainReadStream.mockReturnValue(stream as any);

      const result = await sut.persistFile('/local/out.jpg', 'thumbs/aa/bb/x.jpg', 'image/jpeg');

      expect(mocks.storage.createPlainReadStream).toHaveBeenCalledWith('/local/out.jpg');
      expect(put).toHaveBeenCalledWith('thumbs/aa/bb/x.jpg', stream, { contentType: 'image/jpeg' });
      expect(mocks.storage.unlink).toHaveBeenCalledWith('/local/out.jpg');
      expect(result).toBe('thumbs/aa/bb/x.jpg');
    });

    it('returns the local path and deletes nothing (disk mode)', async () => {
      // storageBackends.diskBackend is undefined in this spec file, so getWriteBackend()
      // returns undefined and persistFile takes its disk branch.
      const result = await sut.persistFile('/local/out.jpg', 'thumbs/aa/bb/x.jpg', 'image/jpeg');

      expect(result).toBe('/local/out.jpg');
      expect(mocks.storage.createPlainReadStream).not.toHaveBeenCalled();
      expect(mocks.storage.unlink).not.toHaveBeenCalled();
    });
  });

  // Per-file-type storage routing (specs/2026-08-15-per-file-type-storage-routing-design.md): every file this
  // module writes resolves its backend through the kind it belongs to, once per file.
  describe('routing', () => {
    it('passes the caller-supplied kind and the config through to getWriteBackend', async () => {
      const { getWriteBackend } = remote();

      await sut.persistFile('/local/out.mp4', 'encoded/aa/bb/x.mp4', 'video/mp4', StorageRoutingKind.EncodedVideo);

      expect(getWriteBackend).toHaveBeenCalledTimes(1);
      expect(getWriteBackend).toHaveBeenCalledWith(
        StorageRoutingKind.EncodedVideo,
        expect.objectContaining({ storage: expect.anything() }),
      );
    });

    it('keeps the environment backend when no kind is given', async () => {
      const { getWriteBackend } = remote();

      await sut.persistFile('/local/frame.jpg', 'thumbs/aa/bb/frame.jpg', 'image/jpeg');

      expect(getWriteBackend).toHaveBeenCalledWith(undefined, undefined);
    });

    it('resolves the thumbnails kind for every file in a persistImageFiles batch', async () => {
      const { getWriteBackend } = remote();
      const asset = { id: 'asset-1', ownerId: 'owner-1' };

      await sut.persistImageFiles(asset as any, [
        { path: '/local/thumb.webp', type: AssetFileType.Thumbnail, isEdited: false },
        { path: '/local/preview.jpeg', type: AssetFileType.Preview, isEdited: false },
      ]);

      expect(getWriteBackend).toHaveBeenCalledTimes(2);
      for (const call of getWriteBackend.mock.calls) {
        expect(call[0]).toBe(StorageRoutingKind.Thumbnails);
      }
    });

    it('routes a profile image as a thumbnail, not an original', async () => {
      const { getWriteBackend } = remote();

      await sut.persistProfileImage('user-1', '/dev/null');

      expect(getWriteBackend).toHaveBeenCalledWith(StorageRoutingKind.Thumbnails, expect.anything());
    });
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
