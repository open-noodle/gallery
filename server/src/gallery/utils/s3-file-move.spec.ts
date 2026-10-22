import { Mock } from 'vitest';
import type { MoveRequest } from 'src/cores/storage.core.js';
import { AssetFileType, AssetPathType } from 'src/enum.js';
import { S3MoveDependencies, moveS3File } from 'src/gallery/utils/s3-file-move.js';
import { storageBackends } from 'src/gallery/utils/storage-backends.js';
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

describe('moveS3File', () => {
  let mocks: ReturnType<typeof getMocks>;
  let s3: { exists: Mock; copy: Mock; stat: Mock; delete: Mock; downloadToTemp: Mock };
  let cleanup: Mock;
  let deps: S3MoveDependencies & { moveDiskFile: Mock; savePath: Mock };
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
    expect(s3.copy).not.toHaveBeenCalled();
    expect(deps.savePath).not.toHaveBeenCalled();
    expect(s3.delete).not.toHaveBeenCalled();
    expect(mocks.move.delete).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    mocks = getMocks();
    cleanup = vi.fn().mockResolvedValue(void 0);
    s3 = {
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

    previousS3Backend = (storageBackends as any).s3Backend;
    (storageBackends as any).s3Backend = s3;
  });

  afterEach(() => {
    (storageBackends as any).s3Backend = previousS3Backend;
  });

  it('should do nothing without an old path', async () => {
    await moveS3File(request({ oldPath: null }), deps);

    expect(mocks.move.getByEntity).not.toHaveBeenCalled();
    expect(deps.moveDiskFile).not.toHaveBeenCalled();
    expectNothingMoved();
  });

  it.each([
    { label: 'a key', move: request() },
    {
      label: 'a disk sidecar with a key new path',
      move: request({
        pathType: AssetFileType.Sidecar,
        oldPath: '/data/upload/user-1/as/se/asset-1.jpg.xmp',
        newPath: `${newKey}.xmp`,
        assetInfo: undefined,
      }),
    },
  ])('should refuse to move $label without S3, before reading or writing a move row', async ({ move }) => {
    (storageBackends as any).s3Backend = undefined;

    await moveS3File(move, deps);

    expect(mocks.logger.warn).toHaveBeenCalledExactlyOnceWith(
      `Unable to move asset-1: ${move.oldPath} => ${move.newPath} needs S3, which is not configured`,
    );
    expect(mocks.move.getByEntity).not.toHaveBeenCalled();
    expect(mocks.move.create).not.toHaveBeenCalled();
    expect(mocks.move.update).not.toHaveBeenCalled();
    expect(deps.moveDiskFile).not.toHaveBeenCalled();
    expectNothingMoved();
    expectNoDiskCalls();
  });

  describe('a key', () => {
    it('should copy, check the size, save the new key, delete the old key and the move row, in that order', async () => {
      await moveS3File(request(), deps);

      expect(mocks.move.getByEntity).toHaveBeenCalledWith('asset-1', AssetPathType.Original);
      expect(mocks.move.create).toHaveBeenCalledWith({
        entityId: 'asset-1',
        pathType: AssetPathType.Original,
        oldPath: oldKey,
        newPath: newKey,
      });
      expect(s3.copy).toHaveBeenCalledWith(oldKey, newKey);
      expect(s3.stat).toHaveBeenCalledTimes(1);
      expect(s3.stat).toHaveBeenCalledWith(newKey);
      expect(deps.savePath).toHaveBeenCalledWith(newKey);
      expect(s3.delete).toHaveBeenCalledTimes(1);
      expect(s3.delete).toHaveBeenCalledWith(oldKey);
      expect(mocks.move.delete).toHaveBeenCalledWith('move-1');

      expect(order(mocks.move.create)).toBeLessThan(order(s3.copy));
      expect(order(s3.copy)).toBeLessThan(order(s3.stat));
      expect(order(s3.stat)).toBeLessThan(order(deps.savePath));
      expect(order(deps.savePath)).toBeLessThan(order(s3.delete));
      expect(order(s3.delete)).toBeLessThan(order(mocks.move.delete));
    });

    it('should not verify the checksum of a move it made itself', async () => {
      await moveS3File(request(), deps);

      expect(s3.exists).not.toHaveBeenCalled();
      expect(s3.downloadToTemp).not.toHaveBeenCalled();
      expect(mocks.crypto.hashFile).not.toHaveBeenCalled();
    });

    it('should make no disk calls', async () => {
      await moveS3File(request(), deps);

      expectNoDiskCalls();
      expect(deps.moveDiskFile).not.toHaveBeenCalled();
    });

    it('should translate a disk new path under the media location into its key', async () => {
      const oldPath = 'thumbs/user-1/asset-1_preview.jpeg';
      const key = 'thumbs/user-1/as/se/asset-1_preview.jpeg';

      await moveS3File(
        request({ pathType: AssetFileType.Preview, oldPath, newPath: `/data/${key}`, assetInfo: undefined }),
        deps,
      );

      expect(mocks.move.create).toHaveBeenCalledWith({
        entityId: 'asset-1',
        pathType: AssetFileType.Preview,
        oldPath,
        newPath: key,
      });
      expect(s3.copy).toHaveBeenCalledWith(oldPath, key);
      expect(deps.savePath).toHaveBeenCalledWith(key);
      expect(s3.delete).toHaveBeenCalledWith(oldPath);
      expectNoDiskCalls();
    });

    it('should compare a derivative against the size of its old object', async () => {
      const oldPath = 'thumbs/user-1/asset-1_thumbnail.webp';
      const key = 'thumbs/user-1/as/se/asset-1_thumbnail.webp';
      s3.stat.mockResolvedValue({ size: 42 });

      await moveS3File(
        request({ pathType: AssetFileType.Thumbnail, oldPath, newPath: `/data/${key}`, assetInfo: undefined }),
        deps,
      );

      expect(s3.stat).toHaveBeenCalledWith(oldPath);
      expect(s3.stat).toHaveBeenCalledWith(key);
      expect(order(s3.copy)).toBeLessThan(order(s3.stat));
      expect(deps.savePath).toHaveBeenCalledWith(key);
    });

    it.each([
      {
        label: 'a derivative',
        pathType: AssetFileType.Thumbnail,
        oldPath: 'thumbs/user-1/asset-1_thumbnail.webp',
        key: 'thumbs/user-1/as/se/asset-1_thumbnail.webp',
      },
      {
        label: 'a sidecar',
        pathType: AssetFileType.Sidecar,
        oldPath: 'upload/user-1/as/se/asset-1.jpg.xmp',
        key: `${newKey}.xmp`,
      },
    ])(
      'should keep the old key and the copy of $label whose size does not match',
      async ({ pathType, oldPath, key }) => {
        // another job (a regenerated thumbnail) may have just written that key
        s3.stat.mockImplementation((path: string) => Promise.resolve({ size: path === oldPath ? 42 : 41 }));

        await moveS3File(request({ pathType, oldPath, newPath: key, assetInfo: undefined }), deps);

        expect(s3.copy).toHaveBeenCalledWith(oldPath, key);
        expect(mocks.logger.warn).toHaveBeenCalledWith('Unable to complete move. File size mismatch: 41 !== 42');
        expect(s3.delete).not.toHaveBeenCalled();
        expect(deps.savePath).not.toHaveBeenCalled();
        expect(mocks.move.delete).not.toHaveBeenCalled();
      },
    );

    it.each([
      { label: 'outside the media location', newPath: '/mnt/photos/IMG_1.jpg' },
      { label: 'in a sibling of the media location', newPath: '/data2/library/admin/IMG_1.jpg' },
      { label: 'the media location itself', newPath: '/data' },
    ])('should refuse a disk new path $label', async ({ newPath }) => {
      await moveS3File(request({ newPath }), deps);

      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('outside the media location'));
      expect(mocks.move.getByEntity).not.toHaveBeenCalled();
      expect(mocks.move.create).not.toHaveBeenCalled();
      expect(deps.moveDiskFile).not.toHaveBeenCalled();
      expectNothingMoved();
      expectNoDiskCalls();
    });

    it('should do nothing when the new path is the key it already has', async () => {
      const key = 'thumbs/user-1/as/se/asset-1_preview.jpeg';

      await moveS3File(request({ pathType: AssetFileType.Preview, oldPath: key, newPath: `/data/${key}` }), deps);

      expect(mocks.move.getByEntity).not.toHaveBeenCalled();
      expect(mocks.move.create).not.toHaveBeenCalled();
      expectNothingMoved();
    });

    it('should not move an original without asset info', async () => {
      await moveS3File(request({ assetInfo: undefined }), deps);

      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Missing asset info'));
      expectNothingMoved();
    });

    it('should keep the old key and the move row when the copy fails', async () => {
      s3.copy.mockRejectedValue(Object.assign(new Error('Access Denied'), { code: 'AccessDenied' }));

      await expect(moveS3File(request(), deps)).resolves.toBeUndefined();

      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Error copying file'));
      expect(s3.stat).not.toHaveBeenCalled();
      expect(deps.savePath).not.toHaveBeenCalled();
      expect(s3.delete).not.toHaveBeenCalled();
      expect(mocks.move.delete).not.toHaveBeenCalled();
    });

    it('should delete the copy of an original, keep the old key and keep the move row on a size mismatch', async () => {
      s3.stat.mockResolvedValue({ size: assetInfo.sizeInBytes - 1 });

      await moveS3File(request(), deps);

      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('File size mismatch'));
      expect(s3.delete).toHaveBeenCalledTimes(1);
      expect(s3.delete).toHaveBeenCalledWith(newKey);
      expect(deps.savePath).not.toHaveBeenCalled();
      expect(mocks.move.delete).not.toHaveBeenCalled();
    });

    it('should not save the new key or delete the old one when the size check throws', async () => {
      const error = new Error('NotFound');
      s3.stat.mockRejectedValue(error);

      await expect(moveS3File(request(), deps)).rejects.toBe(error);

      expect(deps.savePath).not.toHaveBeenCalled();
      expect(s3.delete).not.toHaveBeenCalled();
      expect(mocks.move.delete).not.toHaveBeenCalled();
    });

    it('should keep the old key when saving the new path fails', async () => {
      const error = new Error('database is down');
      deps.savePath.mockRejectedValue(error);

      await expect(moveS3File(request(), deps)).rejects.toBe(error);

      expect(s3.delete).not.toHaveBeenCalled();
      expect(mocks.move.delete).not.toHaveBeenCalled();
    });

    it('should finish the move when the old key cannot be deleted', async () => {
      s3.delete.mockRejectedValue(new Error('object is locked'));

      await expect(moveS3File(request(), deps)).resolves.toBeUndefined();

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

      await moveS3File(sidecar, deps);

      expect(deps.moveDiskFile).toHaveBeenCalledWith({ ...sidecar, newPath: `/data/${newKey}.xmp` });
      // only the original's row is read; the disk mover keeps the sidecar's own
      expect(mocks.move.getByEntity).toHaveBeenCalledExactlyOnceWith('asset-1', AssetPathType.Original);
      expect(mocks.move.create).not.toHaveBeenCalled();
      expect(s3.exists).not.toHaveBeenCalled();
      expectNothingMoved();
    });
  });

  describe('a sidecar', () => {
    const sidecarKey = 'upload/user-1/as/se/asset-1.jpg.xmp';

    it('should move a sidecar whose original has no move row', async () => {
      await moveS3File(
        request({
          pathType: AssetFileType.Sidecar,
          oldPath: sidecarKey,
          newPath: `${newKey}.xmp`,
          assetInfo: undefined,
        }),
        deps,
      );

      expect(mocks.move.getByEntity.mock.calls).toEqual([
        ['asset-1', AssetPathType.Original],
        ['asset-1', AssetFileType.Sidecar],
      ]);
      expect(s3.exists).toHaveBeenCalledWith(`${newKey}.xmp`);
      expect(s3.copy).toHaveBeenCalledWith(sidecarKey, `${newKey}.xmp`);
      expect(deps.savePath).toHaveBeenCalledWith(`${newKey}.xmp`);
      expect(s3.delete).toHaveBeenCalledWith(sidecarKey);
    });

    it('should not overwrite a sidecar already at its destination', async () => {
      // another asset's sidecar, left at `<name>.xmp` when its own move failed after its original had moved on
      s3.exists.mockImplementation((key: string) => Promise.resolve(key === `${newKey}.xmp`));

      await moveS3File(
        request({
          pathType: AssetFileType.Sidecar,
          oldPath: sidecarKey,
          newPath: `${newKey}.xmp`,
          assetInfo: undefined,
        }),
        deps,
      );

      expect(mocks.logger.warn).toHaveBeenCalledWith(`Not moving the sidecar of asset-1: ${newKey}.xmp is taken`);
      expect(mocks.move.create).not.toHaveBeenCalled();
      expectNothingMoved();
    });

    it.each([
      { label: 'a key sidecar', oldPath: sidecarKey },
      { label: 'a disk sidecar', oldPath: `/data/${sidecarKey}` },
    ])('should not move $label while the move of its original is unfinished', async ({ oldPath }) => {
      mocks.move.getByEntity.mockImplementation((_, pathType) =>
        Promise.resolve(pathType === AssetPathType.Original ? row(oldKey, newKey) : undefined),
      );

      await moveS3File(
        request({ pathType: AssetFileType.Sidecar, oldPath, newPath: `${newKey}.xmp`, assetInfo: undefined }),
        deps,
      );

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Not moving the sidecar of asset-1: the move of its original is unfinished',
      );
      expect(mocks.move.getByEntity).toHaveBeenCalledExactlyOnceWith('asset-1', AssetPathType.Original);
      expect(mocks.move.create).not.toHaveBeenCalled();
      expect(mocks.move.update).not.toHaveBeenCalled();
      expect(deps.moveDiskFile).not.toHaveBeenCalled();
      expect(s3.exists).not.toHaveBeenCalled();
      expectNothingMoved();
      expectNoDiskCalls();
    });
  });

  describe('an interrupted move', () => {
    it.each([
      { label: 'disk paths', move: row('/data/upload/user-1/as/se/asset-1.jpg', '/data/library/admin/IMG_1.jpg') },
      { label: 'a disk new path', move: row(oldKey, '/data/library/admin/IMG_1.jpg') },
      { label: 'a disk old path', move: row('/data/upload/user-1/as/se/asset-1.jpg', newKey) },
    ])('should replace a stale row holding $label', async ({ move }) => {
      mocks.move.getByEntity.mockResolvedValue(move);

      await moveS3File(request(), deps);

      expect(s3.exists).not.toHaveBeenCalled();
      expect(mocks.move.create).not.toHaveBeenCalled();
      expect(mocks.move.update).toHaveBeenCalledWith('move-1', { id: 'move-1', oldPath: oldKey, newPath: newKey });
      expect(s3.copy).toHaveBeenCalledWith(oldKey, newKey);
      expect(deps.savePath).toHaveBeenCalledWith(newKey);
      expect(s3.delete).toHaveBeenCalledWith(oldKey);
      expect(mocks.move.delete).toHaveBeenCalledWith('move-1');
      expectNoDiskCalls();
    });

    it('should restart from the old key when the file is still there', async () => {
      const previousNewKey = 'library/admin/2023/IMG_1.jpg';
      mocks.move.getByEntity.mockResolvedValue(row(oldKey, previousNewKey));
      s3.exists.mockImplementation((key: string) => Promise.resolve(key === oldKey));

      await moveS3File(request(), deps);

      expect(s3.exists).toHaveBeenCalledWith(oldKey);
      expect(s3.exists).toHaveBeenCalledWith(previousNewKey);
      expect(mocks.move.update).toHaveBeenCalledWith('move-1', { id: 'move-1', oldPath: oldKey, newPath: newKey });
      expect(s3.copy).toHaveBeenCalledWith(oldKey, newKey);
      expect(deps.savePath).toHaveBeenCalledWith(newKey);
      expect(s3.delete).toHaveBeenCalledWith(oldKey);
      expect(mocks.move.delete).toHaveBeenCalledWith('move-1');
      expect(s3.downloadToTemp).not.toHaveBeenCalled();
      expect(mocks.crypto.hashFile).not.toHaveBeenCalled();
    });

    it('should accept the file at its new key after checking its size and checksum', async () => {
      mocks.move.getByEntity.mockResolvedValue(row(oldKey, newKey));
      s3.exists.mockImplementation((key: string) => Promise.resolve(key === newKey));
      mocks.crypto.hashFile.mockResolvedValue(checksum);

      await moveS3File(request(), deps);

      expect(s3.stat).toHaveBeenCalledWith(newKey);
      expect(s3.downloadToTemp).toHaveBeenCalledWith(newKey);
      expect(mocks.crypto.hashFile).toHaveBeenCalledWith('/tmp/staged');
      expect(cleanup).toHaveBeenCalled();
      expect(order(s3.stat)).toBeLessThan(order(s3.downloadToTemp));
      expect(order(mocks.crypto.hashFile)).toBeLessThan(order(cleanup));

      expect(mocks.move.update).toHaveBeenCalledWith('move-1', { id: 'move-1', oldPath: newKey, newPath: newKey });
      expect(s3.copy).not.toHaveBeenCalled();
      expect(s3.delete).not.toHaveBeenCalled();
      expect(deps.savePath).toHaveBeenCalledWith(newKey);
      expect(mocks.move.delete).toHaveBeenCalledWith('move-1');
      expectNoDiskCalls();
    });

    it('should move the file on from an earlier new key', async () => {
      const previousNewKey = 'library/admin/2023/IMG_1.jpg';
      mocks.move.getByEntity.mockResolvedValue(row(oldKey, previousNewKey));
      s3.exists.mockImplementation((key: string) => Promise.resolve(key === previousNewKey));
      mocks.crypto.hashFile.mockResolvedValue(checksum);

      await moveS3File(request(), deps);

      expect(mocks.move.update).toHaveBeenCalledWith('move-1', {
        id: 'move-1',
        oldPath: previousNewKey,
        newPath: newKey,
      });
      expect(s3.copy).toHaveBeenCalledWith(previousNewKey, newKey);
      expect(deps.savePath).toHaveBeenCalledWith(newKey);
      expect(s3.delete).toHaveBeenCalledWith(previousNewKey);
      expect(order(deps.savePath)).toBeLessThan(order(s3.delete));
      expect(mocks.move.delete).toHaveBeenCalledWith('move-1');
    });

    it('should skip the checksum when hash verification is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ storageTemplate: { hashVerificationEnabled: false } });
      mocks.move.getByEntity.mockResolvedValue(row(oldKey, newKey));
      s3.exists.mockImplementation((key: string) => Promise.resolve(key === newKey));

      await moveS3File(request(), deps);

      expect(s3.stat).toHaveBeenCalledWith(newKey);
      expect(s3.downloadToTemp).not.toHaveBeenCalled();
      expect(mocks.crypto.hashFile).not.toHaveBeenCalled();
      expect(deps.savePath).toHaveBeenCalledWith(newKey);
      expect(mocks.move.delete).toHaveBeenCalledWith('move-1');
    });

    it('should give up on a file at its new key with the wrong size', async () => {
      mocks.move.getByEntity.mockResolvedValue(row(oldKey, newKey));
      s3.exists.mockImplementation((key: string) => Promise.resolve(key === newKey));
      s3.stat.mockResolvedValue({ size: assetInfo.sizeInBytes + 1 });

      await moveS3File(request(), deps);

      expect(mocks.logger.fatal).toHaveBeenCalledWith(expect.stringContaining('file verification failed'));
      expect(s3.downloadToTemp).not.toHaveBeenCalled();
      expect(mocks.move.update).not.toHaveBeenCalled();
      expectNothingMoved();
    });

    it('should give up on a file at its new key with the wrong checksum', async () => {
      mocks.move.getByEntity.mockResolvedValue(row(oldKey, newKey));
      s3.exists.mockImplementation((key: string) => Promise.resolve(key === newKey));
      mocks.crypto.hashFile.mockResolvedValue(Buffer.from('different', 'utf8'));

      await moveS3File(request(), deps);

      expect(mocks.logger.fatal).toHaveBeenCalledWith(expect.stringContaining('file verification failed'));
      expect(cleanup).toHaveBeenCalled();
      expect(mocks.move.update).not.toHaveBeenCalled();
      expectNothingMoved();
    });

    it('should accept a derivative at its new key without comparing it', async () => {
      const oldPath = 'thumbs/user-1/asset-1_preview.jpeg';
      const key = 'thumbs/user-1/as/se/asset-1_preview.jpeg';
      mocks.move.getByEntity.mockResolvedValue(row(oldPath, key, AssetFileType.Preview));
      s3.exists.mockImplementation((path: string) => Promise.resolve(path === key));

      await moveS3File(
        request({ pathType: AssetFileType.Preview, oldPath, newPath: `/data/${key}`, assetInfo: undefined }),
        deps,
      );

      expect(s3.stat).not.toHaveBeenCalled();
      expect(s3.downloadToTemp).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.get).not.toHaveBeenCalled();
      expect(mocks.move.update).toHaveBeenCalledWith('move-1', { id: 'move-1', oldPath: key, newPath: key });
      expect(s3.copy).not.toHaveBeenCalled();
      expect(deps.savePath).toHaveBeenCalledWith(key);
      expect(mocks.move.delete).toHaveBeenCalledWith('move-1');
    });

    it('should give up when the file is at neither key', async () => {
      mocks.move.getByEntity.mockResolvedValue(row(oldKey, newKey));
      s3.exists.mockResolvedValue(false);

      await moveS3File(request(), deps);

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Unable to complete move. File does not exist at either location.',
      );
      expect(mocks.move.update).not.toHaveBeenCalled();
      expectNothingMoved();
    });

    describe('a row the database has moved on from', () => {
      const laterKey = 'library/admin/2025/IMG_1.jpg';
      const finalKey = 'library/admin/2026/IMG_1.jpg';

      it('should move from the database path when an earlier move saved it but did not clean up', async () => {
        // the earlier move saved newKey, then stopped before deleting oldKey and the row
        mocks.move.getByEntity.mockResolvedValue(row(oldKey, newKey));
        s3.exists.mockResolvedValue(true);

        await moveS3File(request({ oldPath: newKey, newPath: laterKey }), deps);

        expect(s3.exists).toHaveBeenCalledExactlyOnceWith(newKey);
        expect(mocks.move.update).toHaveBeenCalledExactlyOnceWith('move-1', {
          id: 'move-1',
          oldPath: newKey,
          newPath: laterKey,
        });
        expect(s3.copy).toHaveBeenCalledExactlyOnceWith(newKey, laterKey);
        expect(deps.savePath).toHaveBeenCalledWith(laterKey);
        // the earlier move's leftover stays: its name may since belong to another asset
        expect(s3.delete).toHaveBeenCalledExactlyOnceWith(newKey);
        expect(mocks.move.delete).toHaveBeenCalledWith('move-1');
        expect(s3.downloadToTemp).not.toHaveBeenCalled();
        expectNoDiskCalls();
      });

      it('should move a sidecar rewritten at its database path, not the outdated one at the row old path', async () => {
        const outdated = 'upload/user-1/as/se/asset-1.jpg.xmp';
        const current = `${newKey}.xmp`;
        mocks.move.getByEntity.mockImplementation((_, pathType) =>
          Promise.resolve(pathType === AssetFileType.Sidecar ? row(outdated, current, pathType) : undefined),
        );
        s3.exists.mockResolvedValue(true);
        s3.stat.mockImplementation((key: string) => Promise.resolve({ size: key === outdated ? 32 : 64 }));

        await moveS3File(
          request({
            pathType: AssetFileType.Sidecar,
            oldPath: current,
            newPath: `${laterKey}.xmp`,
            assetInfo: undefined,
          }),
          deps,
        );

        expect(mocks.move.update).toHaveBeenCalledExactlyOnceWith('move-1', {
          id: 'move-1',
          oldPath: current,
          newPath: `${laterKey}.xmp`,
        });
        expect(s3.copy).toHaveBeenCalledExactlyOnceWith(current, `${laterKey}.xmp`);
        expect(s3.stat).not.toHaveBeenCalledWith(outdated);
        expect(deps.savePath).toHaveBeenCalledWith(`${laterKey}.xmp`);
        expect(s3.delete).toHaveBeenCalledExactlyOnceWith(current);
      });

      it.each([
        { label: 'old', at: newKey },
        { label: 'new', at: laterKey },
      ])(
        'should fall back to upstream recovery at the row $label path when the database path is gone',
        async ({ at }) => {
          // an interrupted recovery moved the row on to newKey => laterKey; the database still has oldKey, since removed
          mocks.move.getByEntity.mockResolvedValue(row(newKey, laterKey));
          s3.exists.mockImplementation((key: string) => Promise.resolve(key === at));
          mocks.crypto.hashFile.mockResolvedValue(checksum);

          await moveS3File(request({ oldPath: oldKey, newPath: finalKey }), deps);

          expect(s3.exists.mock.calls).toEqual([[oldKey], [newKey], [laterKey]]);
          expect(mocks.move.update).toHaveBeenCalledExactlyOnceWith('move-1', {
            id: 'move-1',
            oldPath: at,
            newPath: finalKey,
          });
          expect(s3.copy).toHaveBeenCalledExactlyOnceWith(at, finalKey);
          expect(deps.savePath).toHaveBeenCalledWith(finalKey);
          expect(s3.delete).toHaveBeenCalledExactlyOnceWith(at);
          expect(mocks.move.delete).toHaveBeenCalledWith('move-1');
        },
      );
    });

    it('should fail the move when S3 cannot be reached', async () => {
      const error = new Error('socket hang up');
      mocks.move.getByEntity.mockResolvedValue(row(oldKey, newKey));
      s3.exists.mockRejectedValue(error);

      await expect(moveS3File(request(), deps)).rejects.toBe(error);

      expect(mocks.move.update).not.toHaveBeenCalled();
      expectNothingMoved();
    });
  });
});
