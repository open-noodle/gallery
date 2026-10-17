import { DiskStorageBackend } from 'src/backends/disk-storage.backend.js';
import { AssetMediaCreateDto } from 'src/dtos/asset-media.dto.js';
import { MapAsset } from 'src/dtos/asset-response.dto.js';
import { AssetFileType, JobName } from 'src/enum.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { AssetMediaService } from 'src/services/asset-media.service.js';
import { StorageService } from 'src/services/storage.service.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const createDto = Object.freeze({
  fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
  fileModifiedAt: new Date('2022-06-19T23:41:36.910Z'),
  isFavorite: false,
}) as AssetMediaCreateDto;

// owned by authStub.user1, which is who uploads it
const assetEntity = Object.freeze({ id: 'id_1', ownerId: authStub.user1.user.id }) as MapAsset & {
  isFavorite: boolean;
};

const newFile = () => ({
  uuid: 'random-uuid',
  originalPath: '/dev/null',
  mimeType: 'image/heic',
  checksum: Buffer.from('file hash', 'utf8'),
  originalName: 'asset_1.HEIC',
  size: 42,
});

const newSidecarFile = () => ({
  uuid: 'random-sidecar-uuid',
  originalPath: '/dev/null',
  mimeType: 'application/xml',
  checksum: Buffer.from('sidecar hash', 'utf8'),
  originalName: 'asset_1.xmp',
  size: 12,
});

const expectedKey = 'upload/user-id/id/_1/id_1';
const expectedSidecarKey = 'upload/user-id/id/_1/id_1.xmp';

describe('AssetMediaService.uploadAsset on an S3 write backend', () => {
  let sut: AssetMediaService;
  let mocks: ServiceMocks;
  let s3Backend: { put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  let previousS3Backend: unknown;
  let previousWriteBackendType: unknown;

  beforeAll(() => {
    (StorageService as any).diskBackend = new DiskStorageBackend('/data', {} as StorageRepository);
  });

  beforeEach(() => {
    ({ sut, mocks } = newTestService(AssetMediaService));
    s3Backend = { put: vi.fn().mockResolvedValue(void 0), delete: vi.fn().mockResolvedValue(void 0) };
    previousS3Backend = (StorageService as any).s3Backend;
    previousWriteBackendType = (StorageService as any).writeBackendType;
    (StorageService as any).s3Backend = s3Backend;
    (StorageService as any).writeBackendType = 's3';
    mocks.asset.create.mockResolvedValue(assetEntity);
  });

  afterEach(() => {
    (StorageService as any).s3Backend = previousS3Backend;
    (StorageService as any).writeBackendType = previousWriteBackendType;
  });

  it('uploads the original, points the asset at its key and queues the local file for deletion', async () => {
    const file = newFile();

    await sut.uploadAsset(authStub.user1, createDto, file);

    expect(s3Backend.put).toHaveBeenCalledWith(expectedKey, expect.anything(), {
      contentType: 'application/octet-stream',
    });
    expect(mocks.asset.update).toHaveBeenCalledWith({ id: assetEntity.id, originalPath: expectedKey });
    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FileDelete, data: { files: ['/dev/null'] } });
    expect(s3Backend.delete).not.toHaveBeenCalled();
  });

  it('queues the uploaded S3 original for deletion when post-upload processing fails', async () => {
    const file = newFile();
    const error = new Error('failed after s3 upload');
    mocks.event.emit.mockRejectedValue(error);

    await expect(sut.uploadAsset(authStub.user1, createDto, file)).rejects.toThrow(error);

    expect(s3Backend.put).toHaveBeenCalledWith(expectedKey, expect.anything(), {
      contentType: 'application/octet-stream',
    });
    expect(mocks.asset.update).toHaveBeenCalledWith({ id: assetEntity.id, originalPath: expectedKey });
    expect(mocks.asset.remove).toHaveBeenCalledWith({ id: assetEntity.id });
    // FileDelete routes a relative key to the S3 backend (StorageService.handleDeleteFiles)
    expect(mocks.job.queue).toHaveBeenCalledWith({
      name: JobName.FileDelete,
      data: { files: [expectedKey, undefined] },
    });
    expect(mocks.user.updateUsage).not.toHaveBeenCalled();
  });

  it('keeps the uploaded S3 objects when removing the incomplete asset row fails', async () => {
    const error = new Error('failed after s3 upload');
    mocks.event.emit.mockRejectedValue(error);
    mocks.asset.remove.mockRejectedValue(new Error('remove failed'));

    await expect(sut.uploadAsset(authStub.user1, createDto, newFile(), newSidecarFile())).rejects.toThrow();

    expect(mocks.asset.remove).toHaveBeenCalledWith({ id: assetEntity.id });
    expect(mocks.job.queue).not.toHaveBeenCalledWith({
      name: JobName.FileDelete,
      data: { files: [expectedKey, expectedSidecarKey] },
    });
    expect(s3Backend.delete).not.toHaveBeenCalled();
  });

  it('deletes uploaded S3 originals directly when the temp cleanup queue fails', async () => {
    const error = new Error('job queue unavailable');
    mocks.job.queue.mockRejectedValueOnce(error);

    await expect(sut.uploadAsset(authStub.user1, createDto, newFile())).rejects.toThrow(error);

    expect(s3Backend.delete).toHaveBeenCalledWith(expectedKey);
    expect(mocks.asset.remove).toHaveBeenCalledWith({ id: assetEntity.id });
    expect(mocks.user.updateUsage).not.toHaveBeenCalled();
  });

  it('preserves the original upload error when S3 rollback deletion fails', async () => {
    const error = new Error('job queue unavailable');
    s3Backend.delete.mockRejectedValue(new Error('s3 delete failed'));
    mocks.job.queue.mockRejectedValueOnce(error);

    await expect(sut.uploadAsset(authStub.user1, createDto, newFile())).rejects.toThrow(error);

    expect(mocks.asset.remove).toHaveBeenCalledWith({ id: assetEntity.id });
    expect(s3Backend.delete).toHaveBeenCalledWith(expectedKey);
    expect(mocks.user.updateUsage).not.toHaveBeenCalled();
  });

  it('deletes uploaded S3 sidecars when sidecar post-processing fails', async () => {
    const error = new Error('failed after s3 sidecar upload');
    mocks.asset.upsertFile.mockResolvedValueOnce(void 0).mockRejectedValueOnce(error);

    await expect(sut.uploadAsset(authStub.user1, createDto, newFile(), newSidecarFile())).rejects.toThrow(error);

    expect(s3Backend.put).toHaveBeenCalledWith(expectedKey, expect.anything(), {
      contentType: 'application/octet-stream',
    });
    expect(s3Backend.put).toHaveBeenCalledWith(expectedSidecarKey, expect.anything());
    expect(mocks.asset.remove).toHaveBeenCalledWith({ id: assetEntity.id });
    expect(s3Backend.delete).toHaveBeenCalledWith(expectedKey);
    expect(s3Backend.delete).toHaveBeenCalledWith(expectedSidecarKey);
    expect(mocks.user.updateUsage).not.toHaveBeenCalled();
  });

  it('points the sidecar row at its key after a successful upload', async () => {
    await sut.uploadAsset(authStub.user1, createDto, newFile(), newSidecarFile());

    expect(mocks.asset.upsertFile).toHaveBeenLastCalledWith({
      assetId: assetEntity.id,
      path: expectedSidecarKey,
      type: AssetFileType.Sidecar,
    });
    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FileDelete, data: { files: ['/dev/null'] } });
  });
});

describe('AssetMediaService.uploadAsset on disk', () => {
  let sut: AssetMediaService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(AssetMediaService));
    mocks.asset.create.mockResolvedValue(assetEntity);
  });

  // #569: a row that outlives its files turns a client retry into a duplicate of a row with no file
  it('keeps the uploaded files when removing the incomplete asset row fails', async () => {
    const file = { ...newFile(), originalPath: 'fake_path/asset_1.heic' };
    mocks.asset.upsertExif.mockRejectedValue(new Error('failed after asset create'));
    mocks.asset.remove.mockRejectedValue(new Error('remove failed'));

    await expect(sut.uploadAsset(authStub.user1, createDto, file)).rejects.toThrow();

    expect(mocks.asset.remove).toHaveBeenCalledWith({ id: assetEntity.id });
    expect(mocks.job.queue).not.toHaveBeenCalledWith({
      name: JobName.FileDelete,
      data: { files: [file.originalPath, undefined] },
    });
    expect(mocks.user.updateUsage).not.toHaveBeenCalled();
  });
});
