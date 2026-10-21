import { Mock } from 'vitest';
import type { MoveRequest } from 'src/cores/storage.core.js';
import { AssetFileType, AssetPathType } from 'src/enum.js';
import { BackendMoveDependencies, moveBackendFile, toBackendKey } from 'src/gallery/utils/backend-file-move.js';
import { StorageService } from 'src/services/storage.service.js';
import { getMocks } from 'test/utils.js';

const checksum = Buffer.from('checksum', 'utf8');
const assetInfo = { sizeInBytes: 1000, checksum };

const oldKey = 'upload/user-1/as/se/asset-1.jpg';
const newKey = 'library/admin/2024/IMG_1.jpg';

const order = (fn: { mock: { invocationCallOrder: number[] } }, call = 0) => fn.mock.invocationCallOrder[call];

const request = (overrides: Partial<MoveRequest> = {}): MoveRequest => ({
  entityId: 'asset-1',
  pathType: AssetPathType.Original,
  oldPath: oldKey,
  newPath: newKey,
  assetInfo,
  ...overrides,
});

const row = (oldPath: string, newPath: string, pathType: MoveRequest['pathType'] = AssetPathType.Original) => ({
  id: 'move-1',
  entityId: 'asset-1',
  pathType,
  oldPath,
  newPath,
});

describe('toBackendKey', () => {
  it('should keep a key as it is', () => {
    expect(toBackendKey('upload/user-1/as/se/asset-1.jpg', '/data')).toBe('upload/user-1/as/se/asset-1.jpg');
  });

  it('should strip the media location from a disk path under it', () => {
    expect(toBackendKey('/data/thumbs/user-1/as/se/asset-1_preview.jpeg', '/data')).toBe(
      'thumbs/user-1/as/se/asset-1_preview.jpeg',
    );
  });

  it('should accept a media location with a trailing slash', () => {
    expect(toBackendKey('/data/thumbs/user-1/a.jpeg', '/data/')).toBe('thumbs/user-1/a.jpeg');
  });

  it('should have no key for the media location itself', () => {
    expect(toBackendKey('/data', '/data')).toBeNull();
    expect(toBackendKey('/data/', '/data')).toBeNull();
  });

  it('should have no key for a sibling that shares the prefix', () => {
    expect(toBackendKey('/data2/x', '/data')).toBeNull();
  });

  it('should have no key for a path outside the media location', () => {
    expect(toBackendKey('/mnt/photos/IMG_1.jpg', '/data')).toBeNull();
  });
});

describe('moveBackendFile', () => {
  let mocks: ReturnType<typeof getMocks>;
  let backend: { exists: Mock; copy: Mock; stat: Mock; delete: Mock; downloadToTemp: Mock };
  let cleanup: Mock;
  let deps: BackendMoveDependencies & { moveDiskFile: Mock; savePath: Mock };
  let previousS3Backend: unknown;

  const expectNoDiskCalls = () => {
    expect(mocks.storage.mkdirSync).not.toHaveBeenCalled();
    expect(mocks.storage.rename).not.toHaveBeenCalled();
    expect(mocks.storage.copyFile).not.toHaveBeenCalled();
    expect(mocks.storage.unlink).not.toHaveBeenCalled();
    expect(mocks.storage.stat).not.toHaveBeenCalled();
    expect(mocks.storage.checkFileExists).not.toHaveBeenCalled();
    expect(mocks.storage.utimes).not.toHaveBeenCalled();
  };

  const expectNothingMoved = () => {
    expect(backend.copy).not.toHaveBeenCalled();
    expect(deps.savePath).not.toHaveBeenCalled();
    expect(backend.delete).not.toHaveBeenCalled();
    expect(mocks.move.delete).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    mocks = getMocks();
    cleanup = vi.fn().mockResolvedValue(void 0);
    backend = {
      exists: vi.fn().mockResolvedValue(false),
      copy: vi.fn().mockResolvedValue(void 0),
      stat: vi.fn().mockResolvedValue({ size: assetInfo.sizeInBytes }),
      delete: vi.fn().mockResolvedValue(void 0),
      downloadToTemp: vi.fn().mockResolvedValue({ tempPath: '/tmp/staged', cleanup }),
    };
    deps = {
      mediaLocation: '/data',
      moveRepository: mocks.move as any,
      cryptoRepository: mocks.crypto as any,
      configRepository: mocks.config as any,
      systemMetadataRepository: mocks.systemMetadata as any,
      logger: mocks.logger as any,
      moveDiskFile: vi.fn().mockResolvedValue(void 0),
      savePath: vi.fn().mockResolvedValue(void 0),
    };

    mocks.move.getByEntity.mockResolvedValue(void 0);
    mocks.move.create.mockImplementation((entity) => Promise.resolve({ id: 'move-1', ...entity } as any));
    mocks.move.update.mockImplementation((id, entity) =>
      Promise.resolve({ entityId: 'asset-1', pathType: AssetPathType.Original, ...entity, id } as any),
    );
    mocks.move.delete.mockResolvedValue(row(oldKey, newKey));

    previousS3Backend = (StorageService as any).s3Backend;
    (StorageService as any).s3Backend = backend;
  });

  afterEach(() => {
    (StorageService as any).s3Backend = previousS3Backend;
  });

  it('should do nothing without an old path', async () => {
    await moveBackendFile(request({ oldPath: null }), deps);

    expect(mocks.move.getByEntity).not.toHaveBeenCalled();
    expect(deps.moveDiskFile).not.toHaveBeenCalled();
    expectNothingMoved();
  });

  describe('a key', () => {
    it('should copy, check the size, save the new key, delete the old key and the move row, in that order', async () => {
      await moveBackendFile(request(), deps);

      expect(mocks.move.getByEntity).toHaveBeenCalledWith('asset-1', AssetPathType.Original);
      expect(mocks.move.create).toHaveBeenCalledWith({
        entityId: 'asset-1',
        pathType: AssetPathType.Original,
        oldPath: oldKey,
        newPath: newKey,
      });
      expect(backend.copy).toHaveBeenCalledWith(oldKey, newKey);
      expect(backend.stat).toHaveBeenCalledTimes(1);
      expect(backend.stat).toHaveBeenCalledWith(newKey);
      expect(deps.savePath).toHaveBeenCalledWith(newKey);
      expect(backend.delete).toHaveBeenCalledTimes(1);
      expect(backend.delete).toHaveBeenCalledWith(oldKey);
      expect(mocks.move.delete).toHaveBeenCalledWith('move-1');

      expect(order(mocks.move.create)).toBeLessThan(order(backend.copy));
      expect(order(backend.copy)).toBeLessThan(order(backend.stat));
      expect(order(backend.stat)).toBeLessThan(order(deps.savePath));
      expect(order(deps.savePath)).toBeLessThan(order(backend.delete));
      expect(order(backend.delete)).toBeLessThan(order(mocks.move.delete));
    });

    it('should not verify the checksum of a move it made itself', async () => {
      await moveBackendFile(request(), deps);

      expect(backend.exists).not.toHaveBeenCalled();
      expect(backend.downloadToTemp).not.toHaveBeenCalled();
      expect(mocks.crypto.hashFile).not.toHaveBeenCalled();
    });

    it('should make no disk calls', async () => {
      await moveBackendFile(request(), deps);

      expectNoDiskCalls();
      expect(deps.moveDiskFile).not.toHaveBeenCalled();
    });

    it('should move a key through the disk backend when S3 is not configured', async () => {
      const previousDiskBackend = (StorageService as any).diskBackend;
      (StorageService as any).diskBackend = backend;
      (StorageService as any).s3Backend = undefined;

      try {
        await moveBackendFile(request(), deps);

        expect(backend.copy).toHaveBeenCalledWith(oldKey, newKey);
        expect(deps.savePath).toHaveBeenCalledWith(newKey);
      } finally {
        (StorageService as any).diskBackend = previousDiskBackend;
      }
    });

    it('should translate a disk new path under the media location into its key', async () => {
      const oldPath = 'thumbs/user-1/asset-1_preview.jpeg';
      const key = 'thumbs/user-1/as/se/asset-1_preview.jpeg';

      await moveBackendFile(
        request({ pathType: AssetFileType.Preview, oldPath, newPath: `/data/${key}`, assetInfo: undefined }),
        deps,
      );

      expect(mocks.move.create).toHaveBeenCalledWith({
        entityId: 'asset-1',
        pathType: AssetFileType.Preview,
        oldPath,
        newPath: key,
      });
      expect(backend.copy).toHaveBeenCalledWith(oldPath, key);
      expect(deps.savePath).toHaveBeenCalledWith(key);
      expect(backend.delete).toHaveBeenCalledWith(oldPath);
      expectNoDiskCalls();
    });

    it('should compare a derivative against the size of its old object', async () => {
      const oldPath = 'thumbs/user-1/asset-1_thumbnail.webp';
      const key = 'thumbs/user-1/as/se/asset-1_thumbnail.webp';
      backend.stat.mockResolvedValue({ size: 42 });

      await moveBackendFile(
        request({ pathType: AssetFileType.Thumbnail, oldPath, newPath: `/data/${key}`, assetInfo: undefined }),
        deps,
      );

      expect(backend.stat).toHaveBeenCalledWith(oldPath);
      expect(backend.stat).toHaveBeenCalledWith(key);
      expect(order(backend.copy)).toBeLessThan(order(backend.stat));
      expect(deps.savePath).toHaveBeenCalledWith(key);
    });

    it('should delete the copy and keep the old key of a derivative whose size does not match', async () => {
      const oldPath = 'thumbs/user-1/asset-1_thumbnail.webp';
      const key = 'thumbs/user-1/as/se/asset-1_thumbnail.webp';
      backend.stat.mockImplementation((path: string) => Promise.resolve({ size: path === oldPath ? 42 : 41 }));

      await moveBackendFile(
        request({ pathType: AssetFileType.Thumbnail, oldPath, newPath: `/data/${key}`, assetInfo: undefined }),
        deps,
      );

      expect(backend.delete).toHaveBeenCalledTimes(1);
      expect(backend.delete).toHaveBeenCalledWith(key);
      expect(deps.savePath).not.toHaveBeenCalled();
      expect(mocks.move.delete).not.toHaveBeenCalled();
    });

    it.each([
      { label: 'outside the media location', newPath: '/mnt/photos/IMG_1.jpg' },
      { label: 'in a sibling of the media location', newPath: '/data2/library/admin/IMG_1.jpg' },
      { label: 'the media location itself', newPath: '/data' },
    ])('should refuse a disk new path $label', async ({ newPath }) => {
      await moveBackendFile(request({ newPath }), deps);

      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('outside the media location'));
      expect(mocks.move.getByEntity).not.toHaveBeenCalled();
      expect(mocks.move.create).not.toHaveBeenCalled();
      expect(deps.moveDiskFile).not.toHaveBeenCalled();
      expectNothingMoved();
      expectNoDiskCalls();
    });

    it('should do nothing when the new path is the key it already has', async () => {
      const key = 'thumbs/user-1/as/se/asset-1_preview.jpeg';

      await moveBackendFile(request({ pathType: AssetFileType.Preview, oldPath: key, newPath: `/data/${key}` }), deps);

      expect(mocks.move.getByEntity).not.toHaveBeenCalled();
      expect(mocks.move.create).not.toHaveBeenCalled();
      expectNothingMoved();
    });

    it('should not move an original without asset info', async () => {
      await moveBackendFile(request({ assetInfo: undefined }), deps);

      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Missing asset info'));
      expectNothingMoved();
    });

    it('should keep the old key and the move row when the copy fails', async () => {
      backend.copy.mockRejectedValue(Object.assign(new Error('Access Denied'), { code: 'AccessDenied' }));

      await expect(moveBackendFile(request(), deps)).resolves.toBeUndefined();

      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Error copying file'));
      expect(backend.stat).not.toHaveBeenCalled();
      expect(deps.savePath).not.toHaveBeenCalled();
      expect(backend.delete).not.toHaveBeenCalled();
      expect(mocks.move.delete).not.toHaveBeenCalled();
    });

    it('should delete the copy, keep the old key and keep the move row on a size mismatch', async () => {
      backend.stat.mockResolvedValue({ size: assetInfo.sizeInBytes - 1 });

      await moveBackendFile(request(), deps);

      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('file size mismatch'));
      expect(backend.delete).toHaveBeenCalledTimes(1);
      expect(backend.delete).toHaveBeenCalledWith(newKey);
      expect(deps.savePath).not.toHaveBeenCalled();
      expect(mocks.move.delete).not.toHaveBeenCalled();
    });

    it('should not save the new key or delete the old one when the size check throws', async () => {
      const error = new Error('NotFound');
      backend.stat.mockRejectedValue(error);

      await expect(moveBackendFile(request(), deps)).rejects.toBe(error);

      expect(deps.savePath).not.toHaveBeenCalled();
      expect(backend.delete).not.toHaveBeenCalled();
      expect(mocks.move.delete).not.toHaveBeenCalled();
    });

    it('should keep the old key when saving the new path fails', async () => {
      const error = new Error('database is down');
      deps.savePath.mockRejectedValue(error);

      await expect(moveBackendFile(request(), deps)).rejects.toBe(error);

      expect(backend.delete).not.toHaveBeenCalled();
      expect(mocks.move.delete).not.toHaveBeenCalled();
    });

    it('should finish the move when the old key cannot be deleted', async () => {
      backend.delete.mockRejectedValue(new Error('object is locked'));

      await expect(moveBackendFile(request(), deps)).resolves.toBeUndefined();

      expect(deps.savePath).toHaveBeenCalledWith(newKey);
      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Unable to delete old file'));
      expect(mocks.move.delete).toHaveBeenCalledWith('move-1');
    });
  });

  describe('a disk file with a key new path', () => {
    it('should hand the move to the disk mover at <mediaLocation>/<key>', async () => {
      const sidecar = request({
        pathType: AssetFileType.Sidecar,
        oldPath: '/data/upload/user-1/as/se/asset-1.jpg.xmp',
        newPath: `${newKey}.xmp`,
        assetInfo: undefined,
      });

      await moveBackendFile(sidecar, deps);

      expect(deps.moveDiskFile).toHaveBeenCalledWith({ ...sidecar, newPath: `/data/${newKey}.xmp` });
      expect(mocks.move.getByEntity).not.toHaveBeenCalled();
      expect(mocks.move.create).not.toHaveBeenCalled();
      expect(backend.exists).not.toHaveBeenCalled();
      expectNothingMoved();
    });
  });

  describe('an interrupted move', () => {
    it.each([
      { label: 'disk paths', move: row('/data/upload/user-1/as/se/asset-1.jpg', '/data/library/admin/IMG_1.jpg') },
      { label: 'a disk new path', move: row(oldKey, '/data/library/admin/IMG_1.jpg') },
      { label: 'a disk old path', move: row('/data/upload/user-1/as/se/asset-1.jpg', newKey) },
    ])('should replace a stale row holding $label', async ({ move }) => {
      mocks.move.getByEntity.mockResolvedValue(move);

      await moveBackendFile(request(), deps);

      expect(backend.exists).not.toHaveBeenCalled();
      expect(mocks.move.create).not.toHaveBeenCalled();
      expect(mocks.move.update).toHaveBeenCalledWith('move-1', { id: 'move-1', oldPath: oldKey, newPath: newKey });
      expect(backend.copy).toHaveBeenCalledWith(oldKey, newKey);
      expect(deps.savePath).toHaveBeenCalledWith(newKey);
      expect(backend.delete).toHaveBeenCalledWith(oldKey);
      expect(mocks.move.delete).toHaveBeenCalledWith('move-1');
      expectNoDiskCalls();
    });

    it('should restart from the old key when the file is still there', async () => {
      const previousNewKey = 'library/admin/2023/IMG_1.jpg';
      mocks.move.getByEntity.mockResolvedValue(row(oldKey, previousNewKey));
      backend.exists.mockImplementation((key: string) => Promise.resolve(key === oldKey));

      await moveBackendFile(request(), deps);

      expect(backend.exists).toHaveBeenCalledWith(oldKey);
      expect(backend.exists).toHaveBeenCalledWith(previousNewKey);
      expect(mocks.move.update).toHaveBeenCalledWith('move-1', { id: 'move-1', oldPath: oldKey, newPath: newKey });
      expect(backend.copy).toHaveBeenCalledWith(oldKey, newKey);
      expect(deps.savePath).toHaveBeenCalledWith(newKey);
      expect(backend.delete).toHaveBeenCalledWith(oldKey);
      expect(mocks.move.delete).toHaveBeenCalledWith('move-1');
      expect(backend.downloadToTemp).not.toHaveBeenCalled();
      expect(mocks.crypto.hashFile).not.toHaveBeenCalled();
    });

    it('should accept the file at its new key after checking its size and checksum', async () => {
      mocks.move.getByEntity.mockResolvedValue(row(oldKey, newKey));
      backend.exists.mockImplementation((key: string) => Promise.resolve(key === newKey));
      mocks.crypto.hashFile.mockResolvedValue(checksum);

      await moveBackendFile(request(), deps);

      expect(backend.stat).toHaveBeenCalledWith(newKey);
      expect(backend.downloadToTemp).toHaveBeenCalledWith(newKey);
      expect(mocks.crypto.hashFile).toHaveBeenCalledWith('/tmp/staged');
      expect(cleanup).toHaveBeenCalled();
      expect(order(backend.stat)).toBeLessThan(order(backend.downloadToTemp));
      expect(order(mocks.crypto.hashFile)).toBeLessThan(order(cleanup));

      expect(mocks.move.update).toHaveBeenCalledWith('move-1', { id: 'move-1', oldPath: newKey, newPath: newKey });
      expect(backend.copy).not.toHaveBeenCalled();
      expect(backend.delete).not.toHaveBeenCalled();
      expect(deps.savePath).toHaveBeenCalledWith(newKey);
      expect(mocks.move.delete).toHaveBeenCalledWith('move-1');
      expectNoDiskCalls();
    });

    it('should move the file on from an earlier new key', async () => {
      const previousNewKey = 'library/admin/2023/IMG_1.jpg';
      mocks.move.getByEntity.mockResolvedValue(row(oldKey, previousNewKey));
      backend.exists.mockImplementation((key: string) => Promise.resolve(key === previousNewKey));
      mocks.crypto.hashFile.mockResolvedValue(checksum);

      await moveBackendFile(request(), deps);

      expect(mocks.move.update).toHaveBeenCalledWith('move-1', {
        id: 'move-1',
        oldPath: previousNewKey,
        newPath: newKey,
      });
      expect(backend.copy).toHaveBeenCalledWith(previousNewKey, newKey);
      expect(deps.savePath).toHaveBeenCalledWith(newKey);
      expect(backend.delete).toHaveBeenCalledWith(previousNewKey);
      expect(order(deps.savePath)).toBeLessThan(order(backend.delete));
      expect(mocks.move.delete).toHaveBeenCalledWith('move-1');
    });

    it('should skip the checksum when hash verification is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ storageTemplate: { hashVerificationEnabled: false } });
      mocks.move.getByEntity.mockResolvedValue(row(oldKey, newKey));
      backend.exists.mockImplementation((key: string) => Promise.resolve(key === newKey));

      await moveBackendFile(request(), deps);

      expect(backend.stat).toHaveBeenCalledWith(newKey);
      expect(backend.downloadToTemp).not.toHaveBeenCalled();
      expect(mocks.crypto.hashFile).not.toHaveBeenCalled();
      expect(deps.savePath).toHaveBeenCalledWith(newKey);
      expect(mocks.move.delete).toHaveBeenCalledWith('move-1');
    });

    it('should give up on a file at its new key with the wrong size', async () => {
      mocks.move.getByEntity.mockResolvedValue(row(oldKey, newKey));
      backend.exists.mockImplementation((key: string) => Promise.resolve(key === newKey));
      backend.stat.mockResolvedValue({ size: assetInfo.sizeInBytes + 1 });

      await moveBackendFile(request(), deps);

      expect(mocks.logger.fatal).toHaveBeenCalledWith(expect.stringContaining('file verification failed'));
      expect(backend.downloadToTemp).not.toHaveBeenCalled();
      expect(mocks.move.update).not.toHaveBeenCalled();
      expectNothingMoved();
    });

    it('should give up on a file at its new key with the wrong checksum', async () => {
      mocks.move.getByEntity.mockResolvedValue(row(oldKey, newKey));
      backend.exists.mockImplementation((key: string) => Promise.resolve(key === newKey));
      mocks.crypto.hashFile.mockResolvedValue(Buffer.from('different', 'utf8'));

      await moveBackendFile(request(), deps);

      expect(mocks.logger.fatal).toHaveBeenCalledWith(expect.stringContaining('file verification failed'));
      expect(cleanup).toHaveBeenCalled();
      expect(mocks.move.update).not.toHaveBeenCalled();
      expectNothingMoved();
    });

    it('should accept a derivative at its new key without comparing it', async () => {
      const oldPath = 'thumbs/user-1/asset-1_preview.jpeg';
      const key = 'thumbs/user-1/as/se/asset-1_preview.jpeg';
      mocks.move.getByEntity.mockResolvedValue(row(oldPath, key, AssetFileType.Preview));
      backend.exists.mockImplementation((path: string) => Promise.resolve(path === key));

      await moveBackendFile(
        request({ pathType: AssetFileType.Preview, oldPath, newPath: `/data/${key}`, assetInfo: undefined }),
        deps,
      );

      expect(backend.stat).not.toHaveBeenCalled();
      expect(backend.downloadToTemp).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.get).not.toHaveBeenCalled();
      expect(mocks.move.update).toHaveBeenCalledWith('move-1', { id: 'move-1', oldPath: key, newPath: key });
      expect(backend.copy).not.toHaveBeenCalled();
      expect(deps.savePath).toHaveBeenCalledWith(key);
      expect(mocks.move.delete).toHaveBeenCalledWith('move-1');
    });

    it('should give up when the file is at neither key', async () => {
      mocks.move.getByEntity.mockResolvedValue(row(oldKey, newKey));
      backend.exists.mockResolvedValue(false);

      await moveBackendFile(request(), deps);

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Unable to complete move. File does not exist at either location.',
      );
      expect(mocks.move.update).not.toHaveBeenCalled();
      expectNothingMoved();
    });

    it('should fail the move when the backend cannot be reached', async () => {
      const error = new Error('socket hang up');
      mocks.move.getByEntity.mockResolvedValue(row(oldKey, newKey));
      backend.exists.mockRejectedValue(error);

      await expect(moveBackendFile(request(), deps)).rejects.toBe(error);

      expect(mocks.move.update).not.toHaveBeenCalled();
      expectNothingMoved();
    });
  });
});
