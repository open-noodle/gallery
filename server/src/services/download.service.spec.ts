import { BadRequestException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { DownloadResponseDto } from 'src/dtos/download.dto';
import { AssetType } from 'src/enum';
import { DownloadService } from 'src/services/download.service';
import { StorageService } from 'src/services/storage.service';
import { AssetFactory } from 'test/factories/asset.factory';
import { authStub } from 'test/fixtures/auth.stub';
import { newUuid } from 'test/small.factory';
import { makeStream, newTestService, ServiceMocks } from 'test/utils';
import { vitest } from 'vitest';

const downloadResponse: DownloadResponseDto = {
  totalSize: 105_000,
  archives: [
    {
      assetIds: ['asset-1', 'asset-2'],
      size: 105_000,
    },
  ],
};

describe(DownloadService.name, () => {
  let sut: DownloadService;
  let mocks: ServiceMocks;

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  beforeEach(() => {
    ({ sut, mocks } = newTestService(DownloadService));
  });

  describe('downloadArchive', () => {
    it('should skip asset ids that could not be found', async () => {
      const archiveMock = {
        addFile: vitest.fn(),
        finalize: vitest.fn(),
        stream: new Readable(),
      };
      const asset = AssetFactory.create();

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id, 'unknown-asset']));
      mocks.asset.getForOriginals.mockResolvedValue([asset]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      await expect(
        sut.downloadArchive(authStub.admin, { assetIds: [asset.id, 'unknown-asset'] }),
      ).resolves.toMatchObject({
        stream: archiveMock.stream,
      });

      expect(archiveMock.addFile).toHaveBeenCalledTimes(1);
      expect(archiveMock.addFile).toHaveBeenNthCalledWith(1, asset.originalPath, asset.originalFileName);
    });

    it('should log a warning if the original path could not be resolved', async () => {
      const archiveMock = {
        addFile: vitest.fn(),
        finalize: vitest.fn(),
        stream: new Readable(),
      };

      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id]));
      mocks.storage.realpath.mockRejectedValue(new Error('Could not read file'));
      mocks.asset.getForOriginals.mockResolvedValue([asset1, asset2]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      await expect(sut.downloadArchive(authStub.admin, { assetIds: [asset1.id, asset2.id] })).resolves.toMatchObject({
        stream: archiveMock.stream,
      });

      expect(mocks.logger.warn).toHaveBeenCalledTimes(2);
      expect(archiveMock.addFile).toHaveBeenCalledTimes(2);
      expect(archiveMock.addFile).toHaveBeenNthCalledWith(1, asset1.originalPath, asset1.originalFileName);
      expect(archiveMock.addFile).toHaveBeenNthCalledWith(2, asset2.originalPath, asset2.originalFileName);
    });

    it('should download an archive', async () => {
      const archiveMock = {
        addFile: vitest.fn(),
        finalize: vitest.fn(),
        stream: new Readable(),
      };

      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id]));
      mocks.asset.getForOriginals.mockResolvedValue([asset1, asset2]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      await expect(sut.downloadArchive(authStub.admin, { assetIds: [asset1.id, asset2.id] })).resolves.toMatchObject({
        stream: archiveMock.stream,
      });

      expect(archiveMock.addFile).toHaveBeenCalledTimes(2);
      expect(archiveMock.addFile).toHaveBeenNthCalledWith(1, asset1.originalPath, asset1.originalFileName);
      expect(archiveMock.addFile).toHaveBeenNthCalledWith(2, asset2.originalPath, asset2.originalFileName);
    });

    it('should handle duplicate file names', async () => {
      const archiveMock = {
        addFile: vitest.fn(),
        finalize: vitest.fn(),
        stream: new Readable(),
      };
      const asset1 = AssetFactory.create({ originalFileName: 'IMG_123.jpg' });
      const asset2 = AssetFactory.create({ originalFileName: 'IMG_123.jpg' });

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id]));
      mocks.asset.getForOriginals.mockResolvedValue([asset1, asset2]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      await expect(sut.downloadArchive(authStub.admin, { assetIds: [asset1.id, asset2.id] })).resolves.toMatchObject({
        stream: archiveMock.stream,
      });

      expect(archiveMock.addFile).toHaveBeenCalledTimes(2);
      expect(archiveMock.addFile).toHaveBeenNthCalledWith(1, '/data/library/IMG_123.jpg', 'IMG_123.jpg');
      expect(archiveMock.addFile).toHaveBeenNthCalledWith(2, '/data/library/IMG_123.jpg', 'IMG_123+1.jpg');
    });

    it('should be deterministic', async () => {
      const archiveMock = {
        addFile: vitest.fn(),
        finalize: vitest.fn(),
        stream: new Readable(),
      };
      const asset1 = AssetFactory.create({ originalFileName: 'IMG_123.jpg' });
      const asset2 = AssetFactory.create({ originalFileName: 'IMG_123.jpg' });

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id]));
      mocks.asset.getForOriginals.mockResolvedValue([asset1, asset2]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      await expect(sut.downloadArchive(authStub.admin, { assetIds: [asset1.id, asset2.id] })).resolves.toMatchObject({
        stream: archiveMock.stream,
      });

      expect(archiveMock.addFile).toHaveBeenCalledTimes(2);
      expect(archiveMock.addFile).toHaveBeenNthCalledWith(1, '/data/library/IMG_123.jpg', 'IMG_123.jpg');
      expect(archiveMock.addFile).toHaveBeenNthCalledWith(2, '/data/library/IMG_123.jpg', 'IMG_123+1.jpg');
    });

    it.each([
      { input: '../../../../tmp/pwn.jpg', expected: '........tmppwn.jpg' },
      { input: String.raw`C:\temp\abs3.jpg`, expected: 'Ctempabs3.jpg' },
      { input: 'a/../../b.jpg', expected: 'a....b.jpg' },
      { input: String.raw`..\..\win1.jpg`, expected: '....win1.jpg' },
      { input: '/etc/passwd', expected: 'etcpasswd' },
      { input: '..', expected: 'unnamed' },
      { input: '', expected: 'unnamed' },
    ])('should sanitize unsafe originalFileName "$input" to "$expected"', async ({ input, expected }) => {
      const archiveMock = {
        addFile: vitest.fn(),
        finalize: vitest.fn(),
        stream: new Readable(),
      };
      const asset = AssetFactory.create({ originalFileName: input, originalPath: '/data/library/safe.jpg' });

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.asset.getForOriginals.mockResolvedValue([asset]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      await expect(sut.downloadArchive(authStub.admin, { assetIds: [asset.id] })).resolves.toMatchObject({
        stream: archiveMock.stream,
      });

      expect(archiveMock.addFile).toHaveBeenCalledWith('/data/library/safe.jpg', expected);
    });

    it('should dedupe sanitized duplicate unsafe filenames', async () => {
      const archiveMock = {
        addFile: vitest.fn(),
        finalize: vitest.fn(),
        stream: new Readable(),
      };
      const asset1 = AssetFactory.create({
        originalFileName: '../../../tmp/pwn.jpg',
        originalPath: '/data/library/a.jpg',
      });
      const asset2 = AssetFactory.create({
        originalFileName: '../../../tmp/pwn.jpg',
        originalPath: '/data/library/b.jpg',
      });

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id]));
      mocks.asset.getForOriginals.mockResolvedValue([asset1, asset2]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      await expect(sut.downloadArchive(authStub.admin, { assetIds: [asset1.id, asset2.id] })).resolves.toMatchObject({
        stream: archiveMock.stream,
      });

      expect(archiveMock.addFile).toHaveBeenCalledTimes(2);
      expect(archiveMock.addFile).toHaveBeenNthCalledWith(1, '/data/library/a.jpg', '......tmppwn.jpg');
      expect(archiveMock.addFile).toHaveBeenNthCalledWith(2, '/data/library/b.jpg', '......tmppwn+1.jpg');
    });

    it('should resolve symlinks', async () => {
      const archiveMock = {
        addFile: vitest.fn(),
        finalize: vitest.fn(),
        stream: new Readable(),
      };

      const asset = AssetFactory.create({ originalPath: '/path/to/symlink.jpg' });
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.asset.getForOriginals.mockResolvedValue([asset]);
      mocks.storage.realpath.mockResolvedValue('/path/to/realpath.jpg');
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      await expect(sut.downloadArchive(authStub.admin, { assetIds: [asset.id] })).resolves.toMatchObject({
        stream: archiveMock.stream,
      });

      expect(archiveMock.addFile).toHaveBeenCalledWith('/path/to/realpath.jpg', asset.originalFileName);
    });

    it('should use edited path when edited flag is true and editedPath exists', async () => {
      const archiveMock = {
        addFile: vitest.fn(),
        finalize: vitest.fn(),
        stream: new Readable(),
      };
      const asset = AssetFactory.create();
      const editedAsset = { ...asset, editedPath: '/edited/path.jpg' };

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.asset.getForOriginals.mockResolvedValue([editedAsset]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      await expect(sut.downloadArchive(authStub.admin, { assetIds: [asset.id], edited: true })).resolves.toMatchObject({
        stream: archiveMock.stream,
      });

      expect(archiveMock.addFile).toHaveBeenCalledTimes(1);
      expect(archiveMock.addFile).toHaveBeenCalledWith('/edited/path.jpg', asset.originalFileName);
    });

    it('should fall back to original path when edited flag is true but editedPath is null', async () => {
      const archiveMock = {
        addFile: vitest.fn(),
        finalize: vitest.fn(),
        stream: new Readable(),
      };
      const asset = AssetFactory.create();
      const assetWithoutEdit = { ...asset, editedPath: null };

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.asset.getForOriginals.mockResolvedValue([assetWithoutEdit]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      await expect(sut.downloadArchive(authStub.admin, { assetIds: [asset.id], edited: true })).resolves.toMatchObject({
        stream: archiveMock.stream,
      });

      expect(archiveMock.addFile).toHaveBeenCalledTimes(1);
      expect(archiveMock.addFile).toHaveBeenCalledWith(asset.originalPath, asset.originalFileName);
    });

    it('should use EncodedVideo editedPath for trimmed video in archive', async () => {
      const archiveMock = {
        addFile: vitest.fn(),
        finalize: vitest.fn(),
        stream: new Readable(),
      };
      const asset = AssetFactory.create({ type: AssetType.Video });
      const editedAsset = { ...asset, editedPath: '/encoded-video/owner/asset_edited.mp4' };

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.asset.getForOriginals.mockResolvedValue([editedAsset]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      await expect(sut.downloadArchive(authStub.admin, { assetIds: [asset.id], edited: true })).resolves.toMatchObject({
        stream: archiveMock.stream,
      });

      expect(archiveMock.addFile).toHaveBeenCalledTimes(1);
      expect(archiveMock.addFile).toHaveBeenCalledWith('/encoded-video/owner/asset_edited.mp4', asset.originalFileName);
    });

    it('should use original path when edited flag is not set', async () => {
      const archiveMock = {
        addFile: vitest.fn(),
        finalize: vitest.fn(),
        stream: new Readable(),
      };
      const asset = AssetFactory.create();

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.asset.getForOriginals.mockResolvedValue([asset]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      await expect(sut.downloadArchive(authStub.admin, { assetIds: [asset.id] })).resolves.toMatchObject({
        stream: archiveMock.stream,
      });

      expect(archiveMock.addFile).toHaveBeenCalledTimes(1);
      expect(archiveMock.addFile).toHaveBeenCalledWith(asset.originalPath, asset.originalFileName);
    });

    it('should use a LazyS3Readable for S3 assets without calling backend.get() upfront', async () => {
      const archiveMock = {
        addFile: vitest.fn(),
        finalize: vitest.fn(),
        stream: new Readable(),
      };

      // Relative path → isAbsolute returns false → S3 branch
      const asset = AssetFactory.create();
      const s3Asset = { ...asset, originalPath: 'upload/library/photo.jpg' };

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([s3Asset.id]));
      mocks.asset.getForOriginals.mockResolvedValue([s3Asset]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      const mockBackend = { get: vitest.fn() };
      vitest.spyOn(StorageService, 'resolveBackendForKey').mockReturnValue(mockBackend as any);

      await sut.downloadArchive(authStub.admin, { assetIds: [s3Asset.id] });

      // backend.get() must NOT be called during archive construction — it is lazy
      expect(mockBackend.get).not.toHaveBeenCalled();

      // addFile receives a Readable (the LazyS3Readable wrapper), not a raw S3 stream
      expect(archiveMock.addFile).toHaveBeenCalledTimes(1);
      const [passedStream, passedName] = archiveMock.addFile.mock.calls[0];
      expect(passedStream).toBeInstanceOf(Readable);
      expect(passedName).toBe(s3Asset.originalFileName);
    });

    it('should destroy all lazy streams and the zip stream when abort() is called', async () => {
      const capturedStreams: Readable[] = [];
      const archiveMock = {
        addFile: vitest.fn().mockImplementation((input: Readable | string) => {
          if (typeof input !== 'string') {
            capturedStreams.push(input);
          }
        }),
        finalize: vitest.fn(),
        stream: new Readable(),
      };

      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      const s3Asset1 = { ...asset1, originalPath: 'upload/library/a.jpg' };
      const s3Asset2 = { ...asset2, originalPath: 'upload/library/b.jpg' };

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([s3Asset1.id, s3Asset2.id]));
      mocks.asset.getForOriginals.mockResolvedValue([s3Asset1, s3Asset2]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      const mockBackend = { get: vitest.fn() };
      vitest.spyOn(StorageService, 'resolveBackendForKey').mockReturnValue(mockBackend as any);

      const { abort } = await sut.downloadArchive(authStub.admin, {
        assetIds: [s3Asset1.id, s3Asset2.id],
      });

      const lazyDestroySpies = capturedStreams.map((s) => vitest.spyOn(s, 'destroy'));
      const zipDestroySpy = vitest.spyOn(archiveMock.stream, 'destroy');

      abort();

      expect(zipDestroySpy).toHaveBeenCalled();
      for (const spy of lazyDestroySpies) {
        expect(spy).toHaveBeenCalled();
      }
    });

    it('should not throw when abort() is called before archiver has started any entry', async () => {
      const archiveMock = {
        addFile: vitest.fn(),
        finalize: vitest.fn(),
        stream: new Readable(),
      };

      const asset = AssetFactory.create();
      const s3Asset = { ...asset, originalPath: 'upload/library/photo.jpg' };

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([s3Asset.id]));
      mocks.asset.getForOriginals.mockResolvedValue([s3Asset]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      const mockBackend = { get: vitest.fn() };
      vitest.spyOn(StorageService, 'resolveBackendForKey').mockReturnValue(mockBackend as any);

      const { abort } = await sut.downloadArchive(authStub.admin, { assetIds: [s3Asset.id] });

      // abort() fires before _read() is ever called — no S3 socket is open, source is undefined
      expect(() => abort()).not.toThrow();
      // backend.get() must still not have been called
      expect(mockBackend.get).not.toHaveBeenCalled();
    });

    it('should not throw when abort() is called on an all-disk archive', async () => {
      const archiveMock = {
        addFile: vitest.fn(),
        finalize: vitest.fn(),
        stream: new Readable(),
      };

      // AssetFactory.create() produces absolute paths by default → disk branch
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id]));
      mocks.asset.getForOriginals.mockResolvedValue([asset1, asset2]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      const { abort } = await sut.downloadArchive(authStub.admin, {
        assetIds: [asset1.id, asset2.id],
      });

      expect(() => abort()).not.toThrow();
    });

    it('should wrap only S3 assets in LazyS3Readable, leaving disk assets as string paths', async () => {
      const capturedCalls: Array<[Readable | string, string]> = [];
      const archiveMock = {
        addFile: vitest.fn().mockImplementation((input: Readable | string, name: string) => {
          capturedCalls.push([input, name]);
        }),
        finalize: vitest.fn(),
        stream: new Readable(),
      };

      // Disk asset — absolute path
      const diskAsset = AssetFactory.create({ originalPath: '/data/library/disk.jpg' });
      // S3 asset — relative path
      const s3AssetBase = AssetFactory.create();
      const s3Asset = { ...s3AssetBase, originalPath: 'upload/library/s3.jpg' };

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([diskAsset.id, s3Asset.id]));
      mocks.asset.getForOriginals.mockResolvedValue([diskAsset, s3Asset]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);
      mocks.storage.realpath.mockResolvedValue('/data/library/disk.jpg');

      const mockBackend = { get: vitest.fn() };
      vitest.spyOn(StorageService, 'resolveBackendForKey').mockReturnValue(mockBackend as any);

      await sut.downloadArchive(authStub.admin, { assetIds: [diskAsset.id, s3Asset.id] });

      expect(archiveMock.addFile).toHaveBeenCalledTimes(2);

      // Disk asset — must receive a string path, not a Readable
      const [diskInput] = capturedCalls[0];
      expect(typeof diskInput).toBe('string');

      // S3 asset — must receive a Readable (LazyS3Readable), not a string
      const [s3Input] = capturedCalls[1];
      expect(s3Input).toBeInstanceOf(Readable);

      // backend.get() must not have been called upfront
      expect(mockBackend.get).not.toHaveBeenCalled();
    });

    it('should forward backend.get() rejection as a stream error on _read()', async () => {
      let capturedLazy: Readable | undefined;
      const archiveMock = {
        addFile: vitest.fn().mockImplementation((input: Readable | string) => {
          if (typeof input !== 'string') {
            capturedLazy = input;
          }
        }),
        finalize: vitest.fn(),
        stream: new Readable(),
      };

      const asset = AssetFactory.create();
      const s3Asset = { ...asset, originalPath: 'upload/library/photo.jpg' };

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([s3Asset.id]));
      mocks.asset.getForOriginals.mockResolvedValue([s3Asset]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      const fetchError = new Error('S3 connection refused');
      const mockBackend = { get: vitest.fn().mockRejectedValue(fetchError) };
      vitest.spyOn(StorageService, 'resolveBackendForKey').mockReturnValue(mockBackend as any);

      await sut.downloadArchive(authStub.admin, { assetIds: [s3Asset.id] });

      // Register an error handler before triggering _read()
      const errorHandler = vitest.fn();
      capturedLazy!.on('error', errorHandler);

      // Trigger _read() — this starts the fetch which will reject
      capturedLazy!.read();

      // Let the rejected promise settle
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(errorHandler).toHaveBeenCalledWith(fetchError);
    });

    it('should forward a mid-stream S3 error to the lazy readable', async () => {
      let capturedLazy: Readable | undefined;
      const archiveMock = {
        addFile: vitest.fn().mockImplementation((input: Readable | string) => {
          if (typeof input !== 'string') {
            capturedLazy = input;
          }
        }),
        finalize: vitest.fn(),
        stream: new Readable(),
      };

      const asset = AssetFactory.create();
      const s3Asset = { ...asset, originalPath: 'upload/library/photo.jpg' };

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([s3Asset.id]));
      mocks.asset.getForOriginals.mockResolvedValue([s3Asset]);
      mocks.storage.createZipStream.mockReturnValue(archiveMock);

      const s3Stream = new Readable({ read() {} });
      const mockBackend = { get: vitest.fn().mockResolvedValue({ stream: s3Stream }) };
      vitest.spyOn(StorageService, 'resolveBackendForKey').mockReturnValue(mockBackend as any);

      await sut.downloadArchive(authStub.admin, { assetIds: [s3Asset.id] });

      const errorHandler = vitest.fn();
      capturedLazy!.on('error', errorHandler);
      capturedLazy!.read(); // starts fetch

      await new Promise<void>((resolve) => setImmediate(resolve)); // let .then() run

      const midStreamError = new Error('S3 connection reset');
      s3Stream.emit('error', midStreamError);

      expect(errorHandler).toHaveBeenCalledWith(midStreamError);
    });
  });

  describe('getDownloadInfo', () => {
    it('should throw an error for an invalid dto', async () => {
      await expect(sut.getDownloadInfo(authStub.admin, {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should return a list of archives (assetIds)', async () => {
      const assetIds = ['asset-1', 'asset-2'];

      mocks.user.getMetadata.mockResolvedValue([]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
      mocks.downloadRepository.downloadAssetIds.mockReturnValue(
        makeStream([
          { id: 'asset-1', livePhotoVideoId: null, size: 100_000 },
          { id: 'asset-2', livePhotoVideoId: null, size: 5000 },
        ]),
      );

      await expect(sut.getDownloadInfo(authStub.admin, { assetIds })).resolves.toEqual(downloadResponse);

      expect(mocks.downloadRepository.downloadAssetIds).toHaveBeenCalledWith(['asset-1', 'asset-2']);
    });

    it('should return a list of archives (albumId)', async () => {
      mocks.user.getMetadata.mockResolvedValue([]);
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['album-1']));
      mocks.downloadRepository.downloadAlbumId.mockReturnValue(
        makeStream([
          { id: 'asset-1', livePhotoVideoId: null, size: 100_000 },
          { id: 'asset-2', livePhotoVideoId: null, size: 5000 },
        ]),
      );

      await expect(sut.getDownloadInfo(authStub.admin, { albumId: 'album-1' })).resolves.toEqual(downloadResponse);

      expect(mocks.access.album.checkOwnerAccess).toHaveBeenCalledWith(authStub.admin.user.id, new Set(['album-1']));
      expect(mocks.downloadRepository.downloadAlbumId).toHaveBeenCalledWith('album-1');
    });

    it('should return a list of archives (userId)', async () => {
      mocks.user.getMetadata.mockResolvedValue([]);
      mocks.downloadRepository.downloadUserId.mockReturnValue(
        makeStream([
          { id: 'asset-1', livePhotoVideoId: null, size: 100_000 },
          { id: 'asset-2', livePhotoVideoId: null, size: 5000 },
        ]),
      );

      await expect(sut.getDownloadInfo(authStub.admin, { userId: authStub.admin.user.id })).resolves.toEqual(
        downloadResponse,
      );

      expect(mocks.downloadRepository.downloadUserId).toHaveBeenCalledWith(authStub.admin.user.id);
    });

    it('should split archives by size', async () => {
      mocks.user.getMetadata.mockResolvedValue([]);
      mocks.downloadRepository.downloadUserId.mockReturnValue(
        makeStream([
          { id: 'asset-1', livePhotoVideoId: null, size: 5000 },
          { id: 'asset-2', livePhotoVideoId: null, size: 100_000 },
          { id: 'asset-3', livePhotoVideoId: null, size: 23_456 },
          { id: 'asset-4', livePhotoVideoId: null, size: 123_000 },
        ]),
      );

      await expect(
        sut.getDownloadInfo(authStub.admin, {
          userId: authStub.admin.user.id,
          archiveSize: 30_000,
        }),
      ).resolves.toEqual({
        totalSize: 251_456,
        archives: [
          { assetIds: ['asset-1', 'asset-2'], size: 105_000 },
          { assetIds: ['asset-3', 'asset-4'], size: 146_456 },
        ],
      });
    });

    it('should include the video portion of a live photo', async () => {
      const assetIds = ['asset-1', 'asset-2'];

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
      mocks.user.getMetadata.mockResolvedValue([]);
      mocks.downloadRepository.downloadAssetIds.mockReturnValue(
        makeStream([
          { id: 'asset-1', livePhotoVideoId: 'asset-3', size: 5000 },
          { id: 'asset-2', livePhotoVideoId: 'asset-4', size: 100_000 },
        ]),
      );
      mocks.downloadRepository.downloadMotionAssetIds.mockReturnValue(
        makeStream([
          { id: 'asset-3', livePhotoVideoId: null, size: 23_456, originalPath: '/path/to/file.mp4' },
          { id: 'asset-4', livePhotoVideoId: null, size: 123_000, originalPath: '/path/to/file.mp4' },
        ]),
      );

      await expect(sut.getDownloadInfo(authStub.admin, { assetIds, archiveSize: 30_000 })).resolves.toEqual({
        totalSize: 251_456,
        archives: [
          { assetIds: ['asset-1', 'asset-2'], size: 105_000 },
          { assetIds: ['asset-3', 'asset-4'], size: 146_456 },
        ],
      });
    });

    it('should return a list of archives (spaceId)', async () => {
      const spaceId = newUuid();

      mocks.user.getMetadata.mockResolvedValue([]);
      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
      mocks.downloadRepository.downloadSpaceId.mockReturnValue(
        makeStream([
          { id: 'asset-1', livePhotoVideoId: null, size: 100_000 },
          { id: 'asset-2', livePhotoVideoId: null, size: 5000 },
        ]),
      );

      await expect(sut.getDownloadInfo(authStub.admin, { spaceId })).resolves.toEqual(downloadResponse);

      expect(mocks.access.sharedSpace.checkMemberAccess).toHaveBeenCalledWith(
        authStub.admin.user.id,
        new Set([spaceId]),
      );
      expect(mocks.downloadRepository.downloadSpaceId).toHaveBeenCalledWith(spaceId);
    });

    it('should reject non-member for spaceId download', async () => {
      const spaceId = newUuid();
      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set());

      await expect(sut.getDownloadInfo(authStub.admin, { spaceId })).rejects.toThrow();
    });

    it('should return empty archives for space with no assets', async () => {
      const spaceId = newUuid();

      mocks.user.getMetadata.mockResolvedValue([]);
      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
      mocks.downloadRepository.downloadSpaceId.mockReturnValue(makeStream([]));

      await expect(sut.getDownloadInfo(authStub.admin, { spaceId })).resolves.toEqual({
        totalSize: 0,
        archives: [],
      });
    });

    it('should include live photo video for space download', async () => {
      const spaceId = newUuid();

      mocks.user.getMetadata.mockResolvedValue([]);
      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
      mocks.downloadRepository.downloadSpaceId.mockReturnValue(
        makeStream([{ id: 'asset-1', livePhotoVideoId: 'motion-1', size: 5000 }]),
      );
      mocks.downloadRepository.downloadMotionAssetIds.mockReturnValue(
        makeStream([{ id: 'motion-1', livePhotoVideoId: null, size: 2000, originalPath: '/path/to/file.mp4' }]),
      );

      const result = await sut.getDownloadInfo(authStub.admin, { spaceId });

      expect(result.totalSize).toBe(7000);
      expect(result.archives[0].assetIds).toEqual(['asset-1', 'motion-1']);
    });

    it('should include spaceId in error message for invalid dto', async () => {
      await expect(sut.getDownloadInfo(authStub.admin, {})).rejects.toThrow(
        'assetIds, albumId, userId, or spaceId is required',
      );
    });

    it('should skip the video portion of an android live photo by default', async () => {
      const assetIds = ['asset-1'];

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
      mocks.user.getMetadata.mockResolvedValue([]);
      mocks.downloadRepository.downloadAssetIds.mockReturnValue(
        makeStream([{ id: 'asset-1', livePhotoVideoId: 'asset-3', size: 5000 }]),
      );

      mocks.downloadRepository.downloadMotionAssetIds.mockReturnValue(
        makeStream([
          {
            id: 'asset-2',
            livePhotoVideoId: null,
            size: 23_456,
            originalPath: '/data/encoded-video/uuid-MP.mp4',
          },
        ]),
      );

      await expect(sut.getDownloadInfo(authStub.admin, { assetIds })).resolves.toEqual({
        totalSize: 5000,
        archives: [
          {
            assetIds: ['asset-1'],
            size: 5000,
          },
        ],
      });
    });
  });
});
