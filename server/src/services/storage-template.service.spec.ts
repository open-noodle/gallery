import { Stats } from 'node:fs';
import { Mock } from 'vitest';
import type { SystemMetadata } from 'src/types.js';
import { SystemConfig, defaults } from 'src/dtos/config.dto.js';
import { AssetFileType, AssetPathType, AssetType, JobStatus, SystemMetadataKey } from 'src/enum.js';
import { storageBackends } from 'src/gallery/utils/storage-backends.js';
import { StorageTemplateService } from 'src/services/storage-template.service.js';
import { AlbumFactory } from 'test/factories/album.factory.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { UserFactory } from 'test/factories/user.factory.js';
import { userStub } from 'test/fixtures/user.stub.js';
import { getForAlbum, getForStorageTemplate } from 'test/mappers.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, makeStream, newTestService } from 'test/utils.js';

const motionAsset = AssetFactory.from({ type: AssetType.Video }).exif().build();
const stillAsset = AssetFactory.from({ livePhotoVideoId: motionAsset.id }).exif().build();

const order = (fn: { mock: { invocationCallOrder: number[] } }, call = 0) => fn.mock.invocationCallOrder[call];

describe(StorageTemplateService.name, () => {
  let sut: StorageTemplateService;
  let mocks: ServiceMocks;

  const expectNoDiskMove = () => {
    expect(mocks.storage.mkdirSync).not.toHaveBeenCalled();
    expect(mocks.storage.rename).not.toHaveBeenCalled();
    expect(mocks.storage.copyFile).not.toHaveBeenCalled();
    expect(mocks.storage.unlink).not.toHaveBeenCalled();
    expect(mocks.storage.utimes).not.toHaveBeenCalled();
  };

  // reads of the S3 upgrade state, which only an asset with a file in S3 makes
  const stateReads = () =>
    mocks.systemMetadata.get.mock.calls.filter(([key]) => key === SystemMetadataKey.StorageTemplateS3State).length;

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  beforeEach(() => {
    ({ sut, mocks } = newTestService(StorageTemplateService));

    mocks.systemMetadata.get.mockResolvedValue({ storageTemplate: { enabled: true } });

    sut.onConfigInit({ newConfig: defaults });
  });

  describe('onConfigValidate', () => {
    it('should allow valid templates', () => {
      expect(() =>
        sut.onConfigValidate({
          newConfig: {
            storageTemplate: {
              template:
                '{{y}}{{M}}{{W}}{{d}}{{h}}{{m}}{{s}}{{filename}}{{ext}}{{filetype}}{{filetypefull}}{{assetId}}{{#if album}}{{album}}{{else}}other{{/if}}',
            },
          } as SystemConfig,
          oldConfig: {} as SystemConfig,
        }),
      ).not.toThrow();
    });

    it('should fail for an invalid template', () => {
      expect(() =>
        sut.onConfigValidate({
          newConfig: {
            storageTemplate: {
              template: '{{foo}}',
            },
          } as SystemConfig,
          oldConfig: {} as SystemConfig,
        }),
      ).toThrow(/Invalid storage template.*/);
    });
  });

  describe('getStorageTemplateOptions', () => {
    it('should send back the datetime variables', () => {
      expect(sut.getStorageTemplateOptions()).toEqual({
        dayOptions: ['d', 'dd'],
        hourOptions: ['h', 'hh', 'H', 'HH'],
        minuteOptions: ['m', 'mm'],
        monthOptions: ['M', 'MM', 'MMM', 'MMMM'],
        presetOptions: [
          '{{y}}/{{y}}-{{MM}}-{{dd}}/{{filename}}',
          '{{y}}/{{MM}}-{{dd}}/{{filename}}',
          '{{y}}/{{MMMM}}-{{dd}}/{{filename}}',
          '{{y}}/{{MM}}/{{filename}}',
          '{{y}}/{{#if album}}{{album}}{{else}}Other/{{MM}}{{/if}}/{{filename}}',
          '{{#if album}}{{album-startDate-y}}/{{album}}{{else}}{{y}}/Other/{{MM}}{{/if}}/{{filename}}',
          '{{y}}/{{MMM}}/{{filename}}',
          '{{y}}/{{MMMM}}/{{filename}}',
          '{{y}}/{{MM}}/{{dd}}/{{filename}}',
          '{{y}}/{{MMMM}}/{{dd}}/{{filename}}',
          '{{y}}/{{y}}-{{MM}}/{{y}}-{{MM}}-{{dd}}/{{filename}}',
          '{{y}}-{{MM}}-{{dd}}/{{filename}}',
          '{{y}}-{{MMM}}-{{dd}}/{{filename}}',
          '{{y}}-{{MMMM}}-{{dd}}/{{filename}}',
          '{{y}}/{{y}}-{{MM}}/{{filename}}',
          '{{y}}/{{y}}-{{WW}}/{{filename}}',
          '{{y}}/{{y}}-{{MM}}-{{dd}}/{{assetId}}',
          '{{y}}/{{y}}-{{MM}}/{{assetId}}',
          '{{y}}/{{y}}-{{WW}}/{{assetId}}',
          '{{album}}/{{filename}}',
          '{{make}}/{{model}}/{{lensModel}}/{{filename}}',
        ],
        secondOptions: ['s', 'ss', 'SSS'],
        weekOptions: ['W', 'WW'],
        yearOptions: ['y', 'yy'],
      });
    });
  });

  describe('handleMigrationSingle', () => {
    it('should skip when storage template is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ storageTemplate: { enabled: false } });

      await expect(sut.handleMigrationSingle({ id: testAsset.id })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.asset.getByIds).not.toHaveBeenCalled();
      expect(mocks.storage.checkFileExists).not.toHaveBeenCalled();
      expect(mocks.storage.rename).not.toHaveBeenCalled();
      expect(mocks.storage.copyFile).not.toHaveBeenCalled();
      expect(mocks.asset.update).not.toHaveBeenCalled();
      expect(mocks.move.create).not.toHaveBeenCalled();
      expect(mocks.move.update).not.toHaveBeenCalled();
      expect(mocks.storage.stat).not.toHaveBeenCalled();
    });

    it('should migrate single moving picture', async () => {
      const motionAsset = AssetFactory.from({
        type: AssetType.Video,

        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
      })
        .exif()
        .build();
      const stillAsset = AssetFactory.from({
        livePhotoVideoId: motionAsset.id,

        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
      })
        .exif()
        .build();

      mocks.user.get.mockResolvedValue(userStub.user1);
      const newMotionPicturePath = `/data/library/${motionAsset.ownerId}/2022/2022-06-19/${stillAsset.originalFileName.slice(0, -4)}.mp4`;
      const newStillPicturePath = `/data/library/${stillAsset.ownerId}/2022/2022-06-19/${stillAsset.originalFileName}`;

      mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(stillAsset));
      mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(motionAsset));

      mocks.move.create.mockResolvedValueOnce({
        id: '123',
        entityId: stillAsset.id,
        pathType: AssetPathType.Original,
        oldPath: stillAsset.originalPath,
        newPath: newStillPicturePath,
      });

      mocks.move.create.mockResolvedValueOnce({
        id: '124',
        entityId: motionAsset.id,
        pathType: AssetPathType.Original,
        oldPath: motionAsset.originalPath,
        newPath: newMotionPicturePath,
      });

      await expect(sut.handleMigrationSingle({ id: stillAsset.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.storage.checkFileExists).toHaveBeenCalledTimes(2);
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: stillAsset.id, originalPath: newStillPicturePath });
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: motionAsset.id, originalPath: newMotionPicturePath });
    });

    it('should migrate live photo motion video alongside the still image using album in path', async () => {
      const motionAsset = AssetFactory.from({
        type: AssetType.Video,
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
      })
        .exif()
        .build();
      const stillAsset = AssetFactory.from({
        livePhotoVideoId: motionAsset.id,
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
      })
        .exif()
        .build();

      const album = AlbumFactory.from()
        .asset({}, (builder) => builder.exif())
        .build();
      const config = structuredClone(defaults);
      config.storageTemplate.template = '{{y}}/{{#if album}}{{album}}{{else}}other/{{MM}}{{/if}}/{{filename}}';
      sut.onConfigInit({ newConfig: config });

      mocks.user.get.mockResolvedValue(userStub.user1);

      const newMotionPicturePath = `/data/library/${motionAsset.ownerId}/2022/${album.albumName}/${stillAsset.originalFileName.slice(0, -4)}.mp4`;
      const newStillPicturePath = `/data/library/${stillAsset.ownerId}/2022/${album.albumName}/${stillAsset.originalFileName}`;

      mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(stillAsset));
      mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(motionAsset));
      mocks.album.getByAssetId.mockResolvedValue([getForAlbum(album)]);

      mocks.move.create.mockResolvedValueOnce({
        id: '123',
        entityId: stillAsset.id,
        pathType: AssetPathType.Original,
        oldPath: stillAsset.originalPath,
        newPath: newStillPicturePath,
      });

      mocks.move.create.mockResolvedValueOnce({
        id: '124',
        entityId: motionAsset.id,
        pathType: AssetPathType.Original,
        oldPath: motionAsset.originalPath,
        newPath: newMotionPicturePath,
      });

      await expect(sut.handleMigrationSingle({ id: stillAsset.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.storage.checkFileExists).toHaveBeenCalledTimes(2);
      expect(mocks.album.getByAssetId).toHaveBeenCalledWith(stillAsset.ownerId, stillAsset.id);
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: stillAsset.id, originalPath: newStillPicturePath });
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: motionAsset.id, originalPath: newMotionPicturePath });
    });

    it('should use handlebar if condition for album', async () => {
      const user = UserFactory.create();
      const asset = AssetFactory.from().owner(user).exif().build();
      const album = AlbumFactory.from()
        .asset({}, (builder) => builder.exif())
        .build();
      const config = structuredClone(defaults);
      config.storageTemplate.template = '{{y}}/{{#if album}}{{album}}{{else}}other/{{MM}}{{/if}}/{{filename}}';

      sut.onConfigInit({ newConfig: config });

      mocks.user.get.mockResolvedValue(user);
      mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(asset));
      mocks.album.getByAssetId.mockResolvedValueOnce([getForAlbum(album)]);

      expect(await sut.handleMigrationSingle({ id: asset.id })).toBe(JobStatus.Success);

      expect(mocks.move.create).toHaveBeenCalledWith({
        entityId: asset.id,
        newPath: expect.stringContaining(
          `/data/library/${user.id}/${asset.fileCreatedAt.getFullYear()}/${album.albumName}/${asset.originalFileName}`,
        ),
        oldPath: asset.originalPath,
        pathType: AssetPathType.Original,
      });
    });

    it('should use handlebar else condition for album', async () => {
      const user = UserFactory.create();
      const asset = AssetFactory.from().owner(user).exif().build();
      const config = structuredClone(defaults);
      config.storageTemplate.template = '{{y}}/{{#if album}}{{album}}{{else}}other//{{MM}}{{/if}}/{{filename}}';
      sut.onConfigInit({ newConfig: config });

      mocks.user.get.mockResolvedValue(user);
      mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(asset));

      expect(await sut.handleMigrationSingle({ id: asset.id })).toBe(JobStatus.Success);

      const month = (asset.fileCreatedAt.getMonth() + 1).toString().padStart(2, '0');
      expect(mocks.move.create).toHaveBeenCalledWith({
        entityId: asset.id,
        newPath: expect.stringContaining(
          `/data/library/${user.id}/${asset.fileCreatedAt.getFullYear()}/other/${month}/${asset.originalFileName}`,
        ),
        oldPath: asset.originalPath,
        pathType: AssetPathType.Original,
      });
    });

    it('should handle album startDate', async () => {
      const user = UserFactory.create();
      const asset = AssetFactory.from().owner(user).exif().build();
      const album = AlbumFactory.from()
        .asset({}, (builder) => builder.exif())
        .build();
      const config = structuredClone(defaults);
      config.storageTemplate.template =
        '{{#if album}}{{album-startDate-y}}/{{album-startDate-MM}} - {{album}}{{else}}{{y}}/{{MM}}/{{/if}}/{{filename}}';

      sut.onConfigInit({ newConfig: config });

      mocks.user.get.mockResolvedValue(user);
      mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(asset));
      mocks.album.getByAssetId.mockResolvedValueOnce([getForAlbum(album)]);
      mocks.album.getMetadataForIds.mockResolvedValueOnce([
        {
          startDate: asset.fileCreatedAt,
          endDate: asset.fileCreatedAt,
          albumId: album.id,
          assetCount: 1,
          lastModifiedAssetTimestamp: null,
        },
      ]);

      expect(await sut.handleMigrationSingle({ id: asset.id })).toBe(JobStatus.Success);

      const month = (asset.fileCreatedAt.getMonth() + 1).toString().padStart(2, '0');
      expect(mocks.move.create).toHaveBeenCalledWith({
        entityId: asset.id,
        newPath: expect.stringContaining(
          `/data/library/${user.id}/${asset.fileCreatedAt.getFullYear()}/${month} - ${album.albumName}/${asset.originalFileName}`,
        ),
        oldPath: asset.originalPath,
        pathType: AssetPathType.Original,
      });
    });

    it('should handle else condition from album startDate', async () => {
      const user = UserFactory.create();
      const asset = AssetFactory.from().owner(user).exif().build();
      const config = structuredClone(defaults);
      config.storageTemplate.template =
        '{{#if album}}{{album-startDate-y}}/{{album-startDate-MM}} - {{album}}{{else}}{{y}}/{{MM}}/{{/if}}/{{filename}}';

      sut.onConfigInit({ newConfig: config });

      mocks.user.get.mockResolvedValue(user);
      mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(asset));

      expect(await sut.handleMigrationSingle({ id: asset.id })).toBe(JobStatus.Success);

      const month = (asset.fileCreatedAt.getMonth() + 1).toString().padStart(2, '0');
      expect(mocks.move.create).toHaveBeenCalledWith({
        entityId: asset.id,
        newPath: `/data/library/${user.id}/${asset.fileCreatedAt.getFullYear()}/${month}/${asset.originalFileName}`,
        oldPath: asset.originalPath,
        pathType: AssetPathType.Original,
      });
    });

    it('should render storage datetime tokens in server timezone to preserve chronological filename ordering across time zones', async () => {
      const user = UserFactory.create();
      const assetBerlin = AssetFactory.from({
        fileCreatedAt: new Date('2025-12-02T14:00:00.000Z'),
        originalFileName: 'A.jpg',
      })
        .owner(user)
        .exif({ timeZone: 'Europe/Berlin' })
        .build();
      const assetLondon = AssetFactory.from({
        fileCreatedAt: new Date('2025-12-02T14:55:00.000Z'),
        originalFileName: 'B.jpg',
      })
        .owner(user)
        .exif({ timeZone: 'Europe/London' })
        .build();
      const config = structuredClone(defaults);
      config.storageTemplate.template = '{{y}}{{MM}}{{dd}}_{{HH}}{{mm}}{{ss}}/{{filename}}';
      sut.onConfigInit({ newConfig: config });

      mocks.user.get.mockResolvedValue(user);
      mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(assetBerlin));
      mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(assetLondon));

      await expect(sut.handleMigrationSingle({ id: assetBerlin.id })).resolves.toBe(JobStatus.Success);
      await expect(sut.handleMigrationSingle({ id: assetLondon.id })).resolves.toBe(JobStatus.Success);

      const formatStorageDateTime = (date: Date) => {
        const year = date.getFullYear().toString();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hour = date.getHours().toString().padStart(2, '0');
        const minute = date.getMinutes().toString().padStart(2, '0');
        const second = date.getSeconds().toString().padStart(2, '0');
        return `${year}${month}${day}_${hour}${minute}${second}`;
      };

      expect(mocks.move.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          entityId: assetBerlin.id,
          newPath: `/data/library/${user.id}/${formatStorageDateTime(assetBerlin.fileCreatedAt)}/A.jpg`,
        }),
      );
      expect(mocks.move.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          entityId: assetLondon.id,
          newPath: `/data/library/${user.id}/${formatStorageDateTime(assetLondon.fileCreatedAt)}/B.jpg`,
        }),
      );
    });

    it('should migrate previously failed move from original path when it still exists', async () => {
      const user = UserFactory.create();
      const asset = AssetFactory.from({
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
      })
        .owner(user)
        .exif()
        .build();

      mocks.user.get.mockResolvedValue(user);

      const previousFailedNewPath = `/data/library/${user.id}/2023/Feb/${asset.originalFileName}`;
      const newPath = `/data/library/${user.id}/2022/2022-06-19/${asset.originalFileName}`;

      mocks.storage.checkFileExists.mockImplementation((path) => Promise.resolve(path === asset.originalPath));
      mocks.move.getByEntity.mockResolvedValue({
        id: '123',
        entityId: asset.id,
        pathType: AssetPathType.Original,
        oldPath: asset.originalPath,
        newPath: previousFailedNewPath,
      });
      mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));
      mocks.move.update.mockResolvedValue({
        id: '123',
        entityId: asset.id,
        pathType: AssetPathType.Original,
        oldPath: asset.originalPath,
        newPath,
      });

      await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.assetJob.getForStorageTemplateJob).toHaveBeenCalledWith(asset.id);
      expect(mocks.storage.checkFileExists).toHaveBeenCalledTimes(3);
      expect(mocks.storage.rename).toHaveBeenCalledWith(asset.originalPath, newPath);
      expect(mocks.move.update).toHaveBeenCalledWith('123', {
        id: '123',
        oldPath: asset.originalPath,
        newPath,
      });
      expect(mocks.asset.update).toHaveBeenCalledWith({
        id: asset.id,
        originalPath: newPath,
      });
    });

    it('should migrate previously failed move from previous new path when old path no longer exists, should validate file size still matches before moving', async () => {
      const user = UserFactory.create();
      const asset = AssetFactory.from({
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
      })
        .owner(user)
        .exif({ fileSizeInByte: 5000 })
        .build();

      mocks.user.get.mockResolvedValue(user);

      const previousFailedNewPath = `/data/library/${asset.ownerId}/2022/June/${asset.originalFileName}`;
      const newPath = `/data/library/${asset.ownerId}/2022/2022-06-19/${asset.originalFileName}`;

      mocks.storage.checkFileExists.mockImplementation((path) => Promise.resolve(path === previousFailedNewPath));
      mocks.storage.stat.mockResolvedValue({ size: 5000 } as Stats);
      mocks.crypto.hashFile.mockResolvedValue(asset.checksum);
      mocks.move.getByEntity.mockResolvedValue({
        id: '123',
        entityId: asset.id,
        pathType: AssetPathType.Original,
        oldPath: asset.originalPath,
        newPath: previousFailedNewPath,
      });
      mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));
      mocks.move.update.mockResolvedValue({
        id: '123',
        entityId: asset.id,
        pathType: AssetPathType.Original,
        oldPath: previousFailedNewPath,
        newPath,
      });

      await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.assetJob.getForStorageTemplateJob).toHaveBeenCalledWith(asset.id);
      expect(mocks.storage.checkFileExists).toHaveBeenCalledTimes(3);
      expect(mocks.storage.stat).toHaveBeenCalledWith(previousFailedNewPath);
      expect(mocks.storage.rename).toHaveBeenCalledWith(previousFailedNewPath, newPath);
      expect(mocks.storage.copyFile).not.toHaveBeenCalled();
      expect(mocks.move.update).toHaveBeenCalledWith('123', { id: '123', oldPath: previousFailedNewPath, newPath });
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: asset.id, originalPath: newPath });
    });

    it('should fail move if copying and hash of asset and the new file do not match', async () => {
      const user = UserFactory.create();
      const asset = AssetFactory.from({
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
      })
        .owner(user)
        .exif()
        .build();

      mocks.user.get.mockResolvedValue(user);
      const newPath = `/data/library/${user.id}/2022/2022-06-19/${asset.originalFileName}`;

      mocks.storage.rename.mockRejectedValue({ code: 'EXDEV' });
      mocks.storage.stat.mockResolvedValue({ size: 5000 } as Stats);
      mocks.crypto.hashFile.mockResolvedValue(Buffer.from('different-hash', 'utf8'));
      mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));
      mocks.move.create.mockResolvedValue({
        id: '123',
        entityId: asset.id,
        pathType: AssetPathType.Original,
        oldPath: asset.originalPath,
        newPath,
      });

      await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.assetJob.getForStorageTemplateJob).toHaveBeenCalledWith(asset.id);
      expect(mocks.storage.checkFileExists).toHaveBeenCalledTimes(1);
      expect(mocks.storage.stat).toHaveBeenCalledWith(newPath);
      expect(mocks.move.create).toHaveBeenCalledWith({
        entityId: asset.id,
        pathType: AssetPathType.Original,
        oldPath: asset.originalPath,
        newPath,
      });
      expect(mocks.storage.rename).toHaveBeenCalledWith(asset.originalPath, newPath);
      expect(mocks.storage.copyFile).toHaveBeenCalledWith(asset.originalPath, newPath);
      expect(mocks.storage.unlink).toHaveBeenCalledWith(newPath);
      expect(mocks.storage.unlink).toHaveBeenCalledTimes(1);
      expect(mocks.asset.update).not.toHaveBeenCalled();
    });

    const testAsset = AssetFactory.from().exif({ fileSizeInByte: 12_345 }).build();

    it.each`
      failedPathChecksum                     | failedPathSize                       | reason
      ${testAsset.checksum}                  | ${500}                               | ${'file size'}
      ${Buffer.from('bad checksum', 'utf8')} | ${testAsset.exifInfo.fileSizeInByte} | ${'checksum'}
    `(
      'should fail to migrate previously failed move from previous new path when old path no longer exists if $reason validation fails',
      async ({ failedPathChecksum, failedPathSize }) => {
        mocks.user.get.mockResolvedValue(userStub.user1);
        const previousFailedNewPath = `/data/library/${userStub.user1.id}/2023/Feb/${testAsset.originalFileName}`;
        const newPath = `/data/library/${userStub.user1.id}/2023/2023-02-23/${testAsset.originalFileName}`;

        mocks.storage.checkFileExists.mockImplementation((path) => Promise.resolve(previousFailedNewPath === path));
        mocks.storage.stat.mockResolvedValue({ size: failedPathSize } as Stats);
        mocks.crypto.hashFile.mockResolvedValue(failedPathChecksum);
        mocks.move.getByEntity.mockResolvedValue({
          id: '123',
          entityId: testAsset.id,
          pathType: AssetPathType.Original,
          oldPath: testAsset.originalPath,
          newPath: previousFailedNewPath,
        });
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(testAsset));
        mocks.move.update.mockResolvedValue({
          id: '123',
          entityId: testAsset.id,
          pathType: AssetPathType.Original,
          oldPath: previousFailedNewPath,
          newPath,
        });

        await expect(sut.handleMigrationSingle({ id: testAsset.id })).resolves.toBe(JobStatus.Success);

        expect(mocks.assetJob.getForStorageTemplateJob).toHaveBeenCalledWith(testAsset.id);
        expect(mocks.storage.checkFileExists).toHaveBeenCalledTimes(3);
        expect(mocks.storage.stat).toHaveBeenCalledWith(previousFailedNewPath);
        expect(mocks.storage.rename).not.toHaveBeenCalled();
        expect(mocks.storage.copyFile).not.toHaveBeenCalled();
        expect(mocks.move.update).not.toHaveBeenCalled();
        expect(mocks.asset.update).not.toHaveBeenCalled();
      },
    );

    it('should skip migration when source has a duplication annotation (+N suffix)', async () => {
      const user = UserFactory.create();
      const asset = AssetFactory.from({
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
      })
        .owner(user)
        .exif()
        .build();

      mocks.user.get.mockResolvedValue(user);

      // The computed destination would be /data/library/{ownerId}/2022/2022-06-19/{originalFileName}
      // But the source already has a +7 suffix, meaning it was previously renamed due to duplicates
      const baseFileName = asset.originalFileName.replace('.jpg', '');
      const computedPath = `/data/library/${user.id}/2022/2022-06-19/${baseFileName}`;
      asset.originalPath = `${computedPath}+7.jpg`;

      mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

      await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.storage.rename).not.toHaveBeenCalled();
      expect(mocks.asset.update).not.toHaveBeenCalled();
    });

    it('should handle errors in getTemplatePath gracefully', async () => {
      const user = UserFactory.create();
      const asset = AssetFactory.from({
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
      })
        .owner(user)
        .exif()
        .build();

      mocks.user.get.mockResolvedValue(user);
      mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

      // Force template rendering to throw by setting an invalid template
      const config = structuredClone(defaults);
      config.storageTemplate.template = '{{nonExistentHelper}}';
      sut.onConfigInit({ newConfig: config });

      await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

      // Should not attempt to move when template rendering fails
      expect(mocks.storage.rename).not.toHaveBeenCalled();
      expect(mocks.asset.update).not.toHaveBeenCalled();
    });
  });

  describe('handle template migration', () => {
    it('should handle no assets', async () => {
      mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([]));
      mocks.user.getList.mockResolvedValue([]);

      await sut.handleMigration();

      expect(mocks.assetJob.streamForStorageTemplateJob).toHaveBeenCalled();
    });

    it('should handle an asset with a duplicate destination', async () => {
      const asset = AssetFactory.from({
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
      })
        .exif()
        .build();

      const oldPath = asset.originalPath;
      const newPath = `/data/library/${asset.ownerId}/2022/2022-06-19/${asset.originalFileName}`;
      const newPath2 = newPath.replace('.jpg', '+1.jpg');

      mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([getForStorageTemplate(asset)]));
      mocks.user.getList.mockResolvedValue([userStub.user1]);
      mocks.move.create.mockResolvedValue({
        id: '123',
        entityId: asset.id,
        pathType: AssetPathType.Original,
        oldPath,
        newPath,
      });

      mocks.storage.checkFileExists.mockResolvedValueOnce(true);
      mocks.storage.checkFileExists.mockResolvedValueOnce(false);

      await sut.handleMigration();

      expect(mocks.assetJob.streamForStorageTemplateJob).toHaveBeenCalled();
      expect(mocks.storage.checkFileExists).toHaveBeenCalledTimes(3); // 2 for duplicate detection + 1 for library folder pre-check
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: asset.id, originalPath: newPath2 });
      expect(mocks.user.getList).toHaveBeenCalled();
    });

    it('should skip when an asset already matches the template', async () => {
      const asset = AssetFactory.from({
        originalPath: '/data/library/user-id/2023/2023-02-23/asset-id.jpg',
      })
        .exif()
        .build();

      mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([getForStorageTemplate(asset)]));
      mocks.user.getList.mockResolvedValue([userStub.user1]);

      await sut.handleMigration();

      expect(mocks.assetJob.streamForStorageTemplateJob).toHaveBeenCalled();
      expect(mocks.storage.rename).not.toHaveBeenCalled();
      expect(mocks.storage.copyFile).not.toHaveBeenCalled();
      expect(mocks.asset.update).not.toHaveBeenCalled();
    });

    it('should skip when an asset is probably a duplicate', async () => {
      const asset = AssetFactory.from({
        originalPath: '/data/library/user-id/2023/2023-02-23/asset-id+1.jpg',
      })
        .exif()
        .build();

      mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([getForStorageTemplate(asset)]));
      mocks.user.getList.mockResolvedValue([userStub.user1]);

      await sut.handleMigration();

      expect(mocks.assetJob.streamForStorageTemplateJob).toHaveBeenCalled();
      expect(mocks.storage.rename).not.toHaveBeenCalled();
      expect(mocks.storage.copyFile).not.toHaveBeenCalled();
      expect(mocks.asset.update).not.toHaveBeenCalled();
    });

    it('should move an asset', async () => {
      const asset = AssetFactory.from({
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
      })
        .exif()
        .build();

      const oldPath = asset.originalPath;
      const newPath = `/data/library/${asset.ownerId}/2022/2022-06-19/${asset.originalFileName}`;
      mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([getForStorageTemplate(asset)]));
      mocks.user.getList.mockResolvedValue([userStub.user1]);
      mocks.move.create.mockResolvedValue({
        id: '123',
        entityId: asset.id,
        pathType: AssetPathType.Original,
        oldPath: asset.originalPath,
        newPath,
      });

      await sut.handleMigration();

      expect(mocks.assetJob.streamForStorageTemplateJob).toHaveBeenCalled();
      expect(mocks.storage.rename).toHaveBeenCalledWith(oldPath, newPath);
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: asset.id, originalPath: newPath });
    });

    it('should use the user storage label', async () => {
      const user = UserFactory.create({ storageLabel: 'label-1' });
      const asset = AssetFactory.from({
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
      })
        .owner(user)
        .exif()
        .build();

      mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([getForStorageTemplate(asset)]));
      mocks.user.getList.mockResolvedValue([user]);
      mocks.move.create.mockResolvedValue({
        id: '123',
        entityId: asset.id,
        pathType: AssetPathType.Original,
        oldPath: asset.originalPath,
        newPath: `/data/library/${user.storageLabel}/2023/2023-02-23/${asset.originalFileName}`,
      });

      await sut.handleMigration();

      expect(mocks.assetJob.streamForStorageTemplateJob).toHaveBeenCalled();
      expect(mocks.storage.rename).toHaveBeenCalledWith(
        asset.originalPath,
        expect.stringContaining(`/data/library/${user.storageLabel}/2022/2022-06-19/${asset.originalFileName}`),
      );
      expect(mocks.asset.update).toHaveBeenCalledWith({
        id: asset.id,
        originalPath: expect.stringContaining(
          `/data/library/${user.storageLabel}/2022/2022-06-19/${asset.originalFileName}`,
        ),
      });
    });

    it('should copy the file if rename fails due to EXDEV (rename across filesystems)', async () => {
      const asset = AssetFactory.from({
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
        originalPath: '/path/to/original.jpg',
      })
        .exif({ fileSizeInByte: 5000 })
        .build();

      const oldPath = asset.originalPath;
      const newPath = `/data/library/${asset.ownerId}/2022/2022-06-19/${asset.originalFileName}`;
      mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([getForStorageTemplate(asset)]));
      mocks.storage.rename.mockRejectedValue({ code: 'EXDEV' });
      mocks.user.getList.mockResolvedValue([userStub.user1]);
      mocks.move.create.mockResolvedValue({
        id: '123',
        entityId: asset.id,
        pathType: AssetPathType.Original,
        oldPath,
        newPath,
      });
      mocks.storage.stat.mockResolvedValueOnce({
        atime: new Date(),
        mtime: new Date(),
      } as Stats);
      mocks.storage.stat.mockResolvedValueOnce({
        size: 5000,
      } as Stats);
      mocks.storage.stat.mockResolvedValueOnce({
        size: 5000,
        atime: new Date(),
        mtime: new Date(),
      } as Stats);
      mocks.crypto.hashFile.mockResolvedValue(asset.checksum);

      await sut.handleMigration();

      expect(mocks.assetJob.streamForStorageTemplateJob).toHaveBeenCalled();
      expect(mocks.storage.rename).toHaveBeenCalledWith(oldPath, newPath);
      expect(mocks.storage.copyFile).toHaveBeenCalledWith(oldPath, newPath);
      expect(mocks.storage.stat).toHaveBeenCalledWith(oldPath);
      expect(mocks.storage.stat).toHaveBeenCalledWith(newPath);
      expect(mocks.storage.utimes).toHaveBeenCalledWith(newPath, expect.any(Date), expect.any(Date));
      expect(mocks.storage.unlink).toHaveBeenCalledWith(oldPath);
      expect(mocks.storage.unlink).toHaveBeenCalledTimes(1);
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: asset.id, originalPath: newPath });
    });

    it('should not update the database if the move fails due to incorrect newPath filesize', async () => {
      const user = UserFactory.create();
      const asset = AssetFactory.from({
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
      })
        .owner(user)
        .exif()
        .build();

      mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([getForStorageTemplate(asset)]));
      mocks.storage.rename.mockRejectedValue({ code: 'EXDEV' });
      mocks.user.getList.mockResolvedValue([user]);
      mocks.move.create.mockResolvedValue({
        id: '123',
        entityId: asset.id,
        pathType: AssetPathType.Original,
        oldPath: asset.originalPath,
        newPath: `/data/library/user-id/2022/2022-06-19/${asset.originalFileName}`,
      });
      mocks.storage.stat.mockResolvedValue({
        size: 100,
      } as Stats);

      await sut.handleMigration();

      expect(mocks.assetJob.streamForStorageTemplateJob).toHaveBeenCalled();
      expect(mocks.storage.rename).toHaveBeenCalledWith(
        asset.originalPath,
        expect.stringContaining(`/data/library/${user.id}/2022/2022-06-19/${asset.originalFileName}`),
      );
      expect(mocks.storage.copyFile).toHaveBeenCalledWith(
        asset.originalPath,
        expect.stringContaining(`/data/library/${user.id}/2022/2022-06-19/${asset.originalFileName}`),
      );
      expect(mocks.storage.stat).toHaveBeenCalledWith(
        expect.stringContaining(`/data/library/${user.id}/2022/2022-06-19/${asset.originalFileName}`),
      );
      expect(mocks.asset.update).not.toHaveBeenCalled();
    });

    it('should not update the database if the move fails', async () => {
      const user = UserFactory.create();
      const asset = AssetFactory.from({
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
      })
        .owner(user)
        .exif()
        .build();

      mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([getForStorageTemplate(asset)]));
      mocks.storage.rename.mockRejectedValue(new Error('Read only system'));
      mocks.storage.copyFile.mockRejectedValue(new Error('Read only system'));
      mocks.move.create.mockResolvedValue({
        id: 'move-123',
        entityId: asset.id,
        pathType: AssetPathType.Original,
        oldPath: asset.originalPath,
        newPath: '',
      });
      mocks.user.getList.mockResolvedValue([user]);

      await sut.handleMigration();

      expect(mocks.assetJob.streamForStorageTemplateJob).toHaveBeenCalled();
      expect(mocks.storage.rename).toHaveBeenCalledWith(
        asset.originalPath,
        expect.stringContaining(`/data/library/${user.id}/2022/2022-06-19/${asset.originalFileName}`),
      );
      expect(mocks.asset.update).not.toHaveBeenCalled();
    });

    it('should migrate live photo motion video alongside the still image', async () => {
      const motionAsset = AssetFactory.from({
        type: AssetType.Video,
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
      })
        .exif()
        .build();
      const stillAsset = AssetFactory.from({
        livePhotoVideoId: motionAsset.id,
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
      })
        .exif()
        .build();
      const album = AlbumFactory.from()
        .asset({}, (builder) => builder.exif())
        .build();
      const config = structuredClone(defaults);
      config.storageTemplate.template = '{{y}}/{{#if album}}{{album}}{{else}}other/{{MM}}{{/if}}/{{filename}}';
      sut.onConfigInit({ newConfig: config });

      const newMotionPicturePath = `/data/library/${motionAsset.ownerId}/2022/${album.albumName}/${stillAsset.originalFileName.slice(0, -4)}.mp4`;
      const newStillPicturePath = `/data/library/${stillAsset.ownerId}/2022/${album.albumName}/${stillAsset.originalFileName}`;

      mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([getForStorageTemplate(stillAsset)]));
      mocks.user.getList.mockResolvedValue([userStub.user1]);
      mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(motionAsset));
      mocks.album.getByAssetId.mockResolvedValue([getForAlbum(album)]);

      mocks.move.create.mockResolvedValueOnce({
        id: '123',
        entityId: stillAsset.id,
        pathType: AssetPathType.Original,
        oldPath: stillAsset.originalPath,
        newPath: newStillPicturePath,
      });

      mocks.move.create.mockResolvedValueOnce({
        id: '124',
        entityId: motionAsset.id,
        pathType: AssetPathType.Original,
        oldPath: motionAsset.originalPath,
        newPath: newMotionPicturePath,
      });

      await sut.handleMigration();

      expect(mocks.assetJob.streamForStorageTemplateJob).toHaveBeenCalled();
      expect(mocks.storage.checkFileExists).toHaveBeenCalledTimes(3); // 2 for path lookups + 1 for library folder pre-check
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: stillAsset.id, originalPath: newStillPicturePath });
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: motionAsset.id, originalPath: newMotionPicturePath });
    });

    it('should use still photo album info when migrating live photo motion video', async () => {
      const user = userStub.user1;
      const album = AlbumFactory.from()
        .asset({}, (builder) => builder.exif())
        .build();
      const config = structuredClone(defaults);
      config.storageTemplate.template = '{{y}}/{{#if album}}{{album}}{{else}}other{{/if}}/{{filename}}';

      sut.onConfigInit({ newConfig: config });

      mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([getForStorageTemplate(stillAsset)]));
      mocks.user.getList.mockResolvedValue([user]);
      mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(motionAsset));
      mocks.album.getByAssetId.mockResolvedValue([getForAlbum(album)]);

      mocks.move.create.mockResolvedValueOnce({
        id: '123',
        entityId: stillAsset.id,
        pathType: AssetPathType.Original,
        oldPath: stillAsset.originalPath,
        newPath: `/data/library/${user.id}/2022/${album.albumName}/${stillAsset.originalFileName}`,
      });

      mocks.move.create.mockResolvedValueOnce({
        id: '124',
        entityId: motionAsset.id,
        pathType: AssetPathType.Original,
        oldPath: motionAsset.originalPath,
        newPath: `/data/library/${user.id}/2022/${album.albumName}/${motionAsset.originalFileName}`,
      });

      await sut.handleMigration();

      expect(mocks.album.getByAssetId).toHaveBeenCalledWith(stillAsset.ownerId, stillAsset.id);
      expect(mocks.album.getByAssetId).toHaveBeenCalledTimes(2);
      expect(mocks.asset.update).toHaveBeenCalledWith({
        id: stillAsset.id,
        originalPath: expect.stringContaining(`/${album.albumName}/`),
      });
      expect(mocks.asset.update).toHaveBeenCalledWith({
        id: motionAsset.id,
        originalPath: expect.stringContaining(`/${album.albumName}/`),
      });
    });
  });

  describe('file rename correctness', () => {
    it('should not create double extensions when filename has lower extension', async () => {
      const user = UserFactory.create({ storageLabel: 'label-1' });
      const asset = AssetFactory.from({
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
        originalPath: `/data/library/${user.id}/2022/2022-06-19/IMG_7065.heic`,
        originalFileName: 'IMG_7065.HEIC',
      })
        .owner(user)
        .exif()
        .build();

      mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([getForStorageTemplate(asset)]));
      mocks.user.getList.mockResolvedValue([user]);
      mocks.move.create.mockResolvedValue({
        id: '123',
        entityId: asset.id,
        pathType: AssetPathType.Original,
        oldPath: `/data/library/${user.id}/2022/2022-06-19/IMG_7065.heic`,
        newPath: `/data/library/${user.id}/2023/2023-02-23/IMG_7065.heic`,
      });

      await sut.handleMigration();

      expect(mocks.assetJob.streamForStorageTemplateJob).toHaveBeenCalled();
      expect(mocks.storage.rename).toHaveBeenCalledWith(
        expect.stringContaining(`/data/library/${user.id}/2022/2022-06-19/IMG_7065.heic`),
        expect.stringContaining(`/data/library/${user.storageLabel}/2022/2022-06-19/IMG_7065.heic`),
      );
    });

    it('should not create double extensions when filename has uppercase extension', async () => {
      const user = UserFactory.create();
      const asset = AssetFactory.from({
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
        originalPath: `/data/library/${user.id}/2022/2022-06-19/IMG_7065.HEIC`,
        originalFileName: 'IMG_7065.HEIC',
      })
        .owner(user)
        .exif({ fileSizeInByte: 12_345 })
        .build();

      mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([getForStorageTemplate(asset)]));
      mocks.user.getList.mockResolvedValue([user]);
      mocks.move.create.mockResolvedValue({
        id: '123',
        entityId: asset.id,
        pathType: AssetPathType.Original,
        oldPath: `/data/library/${user.id}/2022/2022-06-19/IMG_7065.HEIC`,
        newPath: `/data/library/${user.id}/2023/2023-02-23/IMG_7065.heic`,
      });

      await sut.handleMigration();

      expect(mocks.assetJob.streamForStorageTemplateJob).toHaveBeenCalled();
      expect(mocks.storage.rename).toHaveBeenCalledWith(
        expect.stringContaining(`/data/library/${user.id}/2022/2022-06-19/IMG_7065.HEIC`),
        expect.stringContaining(`/data/library/${user.id}/2022/2022-06-19/IMG_7065.heic`),
      );
    });

    it('should normalize the filename to lowercase (JPEG > jpg)', async () => {
      const user = UserFactory.create();
      const asset = AssetFactory.from({
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
        originalPath: `/data/library/${user.id}/2022/2022-06-19/IMG_7065.JPEG`,
        originalFileName: 'IMG_7065.JPEG',
      })
        .owner(user)
        .exif()
        .build();

      mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([getForStorageTemplate(asset)]));
      mocks.user.getList.mockResolvedValue([user]);
      mocks.move.create.mockResolvedValue({
        id: '123',
        entityId: asset.id,
        pathType: AssetPathType.Original,
        oldPath: `/data/library/${user.id}/2022/2022-06-19/IMG_7065.JPEG`,
        newPath: `/data/library/${user.id}/2023/2023-02-23/IMG_7065.jpg`,
      });

      await sut.handleMigration();

      expect(mocks.assetJob.streamForStorageTemplateJob).toHaveBeenCalled();
      expect(mocks.storage.rename).toHaveBeenCalledWith(
        expect.stringContaining(`/data/library/${user.id}/2022/2022-06-19/IMG_7065.JPEG`),
        expect.stringContaining(`/data/library/${user.id}/2022/2022-06-19/IMG_7065.jpg`),
      );
    });

    it('should normalize the filename to lowercase (JPG > jpg)', async () => {
      const user = UserFactory.create();
      const asset = AssetFactory.from({
        fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
        originalPath: '/data/library/user-id/2022/2022-06-19/IMG_7065.JPG',
        originalFileName: 'IMG_7065.JPG',
      })
        .owner(user)
        .exif()
        .build();

      mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([getForStorageTemplate(asset)]));
      mocks.user.getList.mockResolvedValue([user]);
      mocks.move.create.mockResolvedValue({
        id: '123',
        entityId: asset.id,
        pathType: AssetPathType.Original,
        oldPath: `/data/library/${user.id}/2022/2022-06-19/IMG_7065.JPG`,
        newPath: `/data/library/${user.id}/2023/2023-02-23/IMG_7065.jpg`,
      });

      await sut.handleMigration();

      expect(mocks.assetJob.streamForStorageTemplateJob).toHaveBeenCalled();
      expect(mocks.storage.rename).toHaveBeenCalledWith(
        expect.stringContaining(`/data/library/${user.id}/2022/2022-06-19/IMG_7065.JPG`),
        expect.stringContaining(`/data/library/${user.id}/2022/2022-06-19/IMG_7065.jpg`),
      );
    });
  });

  describe('S3 originals', () => {
    const fileCreatedAt = new Date('2022-06-19T23:41:36.910Z');
    const size = 5000;

    let s3: { exists: Mock; copy: Mock; stat: Mock; delete: Mock; downloadToTemp: Mock };
    let previousS3Backend: unknown;

    const expectNothingMoved = () => {
      expect(s3.copy).not.toHaveBeenCalled();
      expect(s3.stat).not.toHaveBeenCalled();
      expect(s3.delete).not.toHaveBeenCalled();
      expect(mocks.move.create).not.toHaveBeenCalled();
      expect(mocks.asset.update).not.toHaveBeenCalled();
      expectNoDiskMove();
    };

    // a job that left the asset to a manual Storage Template Migration: no destination check, no S3 request at all
    const expectLeftForManualRun = () => {
      expect(mocks.user.get).not.toHaveBeenCalled();
      expect(mocks.database.withLock).not.toHaveBeenCalled();
      expect(mocks.storage.checkFileExists).not.toHaveBeenCalled();
      expect(mocks.move.getByEntity).not.toHaveBeenCalled();
      expect(mocks.asset.upsertFile).not.toHaveBeenCalled();
      expect(s3.exists).not.toHaveBeenCalled();
      expect(s3.downloadToTemp).not.toHaveBeenCalled();
      expectNothingMoved();
    };

    beforeEach(() => {
      s3 = {
        exists: vi.fn().mockResolvedValue(false),
        copy: vi.fn().mockResolvedValue(void 0),
        stat: vi.fn().mockResolvedValue({ size }),
        delete: vi.fn().mockResolvedValue(void 0),
        downloadToTemp: vi.fn(),
      };
      previousS3Backend = (storageBackends as any).s3Backend;
      (storageBackends as any).s3Backend = s3;

      // move_history keeps the rows it stored, so a sidecar sees whether the move of its original finished
      const moveHistory = new Map<string, Awaited<ReturnType<typeof mocks.move.create>>>();
      mocks.move.create.mockImplementation(({ entityId, pathType, oldPath, newPath }) => {
        const row = { id: `move-${pathType}-${entityId}`, entityId, pathType, oldPath, newPath };
        moveHistory.set(row.id, row);
        return Promise.resolve(row);
      });
      mocks.move.getByEntity.mockImplementation((entityId, pathType) =>
        Promise.resolve(moveHistory.get(`move-${pathType}-${entityId}`)),
      );
      mocks.move.delete.mockImplementation((id) => {
        const row = moveHistory.get(id);
        moveHistory.delete(id);
        return Promise.resolve(row as any);
      });
    });

    afterEach(() => {
      (storageBackends as any).s3Backend = previousS3Backend;
      vi.restoreAllMocks();
    });

    describe('handleMigrationSingle', () => {
      it('should move an S3 original to its library key with a server-side copy', async () => {
        const user = UserFactory.create();
        const asset = AssetFactory.from({ fileCreatedAt, originalPath: `upload/${user.id}/ab/cd/file.jpg` })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const newKey = `library/${user.id}/2022/2022-06-19/${asset.originalFileName}`;

        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        expect(mocks.move.create).toHaveBeenCalledExactlyOnceWith({
          entityId: asset.id,
          pathType: AssetPathType.Original,
          oldPath: asset.originalPath,
          newPath: newKey,
        });
        expect(s3.copy).toHaveBeenCalledExactlyOnceWith(asset.originalPath, newKey);
        expect(s3.stat).toHaveBeenCalledExactlyOnceWith(newKey);
        expect(mocks.asset.update).toHaveBeenCalledExactlyOnceWith({ id: asset.id, originalPath: newKey });
        expect(s3.delete).toHaveBeenCalledExactlyOnceWith(asset.originalPath);
        expect(mocks.move.delete).toHaveBeenCalledExactlyOnceWith(`move-original-${asset.id}`);
        // the database points at the new key before the old key is deleted
        expect(order(s3.copy)).toBeLessThan(order(s3.stat));
        expect(order(s3.stat)).toBeLessThan(order(mocks.asset.update));
        expect(order(mocks.asset.update)).toBeLessThan(order(s3.delete));
        expect(order(s3.delete)).toBeLessThan(order(mocks.move.delete));
        // the size check is the whole verification: the copy is not read back
        expect(s3.downloadToTemp).not.toHaveBeenCalled();
        expect(mocks.crypto.hashFile).not.toHaveBeenCalled();
        expectNoDiskMove();
      });

      it('should move an S3 sidecar to the new key of its original', async () => {
        const user = UserFactory.create();
        const sidecarKey = `upload/${user.id}/ab/cd/file.jpg.xmp`;
        const asset = AssetFactory.from({ fileCreatedAt, originalPath: `upload/${user.id}/ab/cd/file.jpg` })
          .owner(user)
          .file({ type: AssetFileType.Sidecar, path: sidecarKey })
          .exif({ fileSizeInByte: size })
          .build();
        const newKey = `library/${user.id}/2022/2022-06-19/${asset.originalFileName}`;

        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        expect(s3.copy.mock.calls).toEqual([
          [asset.originalPath, newKey],
          [sidecarKey, `${newKey}.xmp`],
        ]);
        // a sidecar has no recorded size, so its copy is checked against the object it was copied from
        expect(s3.stat).toHaveBeenCalledWith(sidecarKey);
        expect(s3.stat).toHaveBeenCalledWith(`${newKey}.xmp`);
        expect(mocks.asset.update).toHaveBeenCalledExactlyOnceWith({ id: asset.id, originalPath: newKey });
        expect(mocks.asset.upsertFile).toHaveBeenCalledExactlyOnceWith({
          assetId: asset.id,
          type: AssetFileType.Sidecar,
          path: `${newKey}.xmp`,
        });
        expect(s3.delete.mock.calls).toEqual([[asset.originalPath], [sidecarKey]]);
        expect(mocks.move.delete).toHaveBeenCalledWith(`move-sidecar-${asset.id}`);
        expectNoDiskMove();
      });

      it('should move the disk sidecar of an S3 original on disk, to the disk path of its new key', async () => {
        const user = UserFactory.create();
        const sidecarPath = `/data/upload/${user.id}/ab/cd/file.jpg.xmp`;
        const asset = AssetFactory.from({ fileCreatedAt, originalPath: `upload/${user.id}/ab/cd/file.jpg` })
          .owner(user)
          .file({ type: AssetFileType.Sidecar, path: sidecarPath })
          .exif({ fileSizeInByte: size })
          .build();
        const newKey = `library/${user.id}/2022/2022-06-19/${asset.originalFileName}`;
        const newSidecarPath = `/data/library/${user.id}/2022/2022-06-19/${asset.originalFileName}.xmp`;

        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        expect(s3.copy).toHaveBeenCalledExactlyOnceWith(asset.originalPath, newKey);
        expect(s3.delete).toHaveBeenCalledExactlyOnceWith(asset.originalPath);
        expect(mocks.asset.update).toHaveBeenCalledExactlyOnceWith({ id: asset.id, originalPath: newKey });
        expect(mocks.move.create).toHaveBeenCalledWith({
          entityId: asset.id,
          pathType: AssetFileType.Sidecar,
          oldPath: sidecarPath,
          newPath: newSidecarPath,
        });
        expect(mocks.storage.mkdirSync).toHaveBeenCalledExactlyOnceWith(`/data/library/${user.id}/2022/2022-06-19`);
        expect(mocks.storage.rename).toHaveBeenCalledExactlyOnceWith(sidecarPath, newSidecarPath);
        expect(mocks.asset.upsertFile).toHaveBeenCalledExactlyOnceWith({
          assetId: asset.id,
          type: AssetFileType.Sidecar,
          path: newSidecarPath,
        });
      });

      it('should move the S3 sidecar of a disk original to the key of its new disk path', async () => {
        const user = UserFactory.create();
        const sidecarKey = `upload/${user.id}/ab/cd/file.jpg.xmp`;
        const asset = AssetFactory.from({ fileCreatedAt, originalPath: `/data/upload/${user.id}/ab/cd/file.jpg` })
          .owner(user)
          .file({ type: AssetFileType.Sidecar, path: sidecarKey })
          .exif({ fileSizeInByte: size })
          .build();
        const newPath = `/data/library/${user.id}/2022/2022-06-19/${asset.originalFileName}`;
        const newSidecarKey = `library/${user.id}/2022/2022-06-19/${asset.originalFileName}.xmp`;

        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        expect(mocks.storage.rename).toHaveBeenCalledExactlyOnceWith(asset.originalPath, newPath);
        expect(mocks.asset.update).toHaveBeenCalledExactlyOnceWith({ id: asset.id, originalPath: newPath });
        expect(s3.copy).toHaveBeenCalledExactlyOnceWith(sidecarKey, newSidecarKey);
        expect(mocks.asset.upsertFile).toHaveBeenCalledExactlyOnceWith({
          assetId: asset.id,
          type: AssetFileType.Sidecar,
          path: newSidecarKey,
        });
        expect(s3.delete).toHaveBeenCalledExactlyOnceWith(sidecarKey);
        expect(mocks.move.delete).toHaveBeenCalledWith(`move-sidecar-${asset.id}`);
      });

      it('should move both parts of an S3 live photo, the motion video by the still photo date and album', async () => {
        const user = UserFactory.create();
        const motion = AssetFactory.from({
          type: AssetType.Video,
          fileCreatedAt: new Date('2023-02-23T05:06:29.716Z'),
          originalPath: `upload/${user.id}/ef/gh/motion.mp4`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const still = AssetFactory.from({
          livePhotoVideoId: motion.id,
          fileCreatedAt,
          originalPath: `upload/${user.id}/ab/cd/still.jpg`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const album = AlbumFactory.from()
          .asset({}, (builder) => builder.exif())
          .build();
        const config = structuredClone(defaults);
        config.storageTemplate.template = '{{y}}/{{#if album}}{{album}}{{else}}other/{{MM}}{{/if}}/{{filename}}';
        sut.onConfigInit({ newConfig: config });

        const stillKey = `library/${user.id}/2022/${album.albumName}/${still.originalFileName}`;
        const motionKey = `library/${user.id}/2022/${album.albumName}/${still.originalFileName.slice(0, -4)}.mp4`;

        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(still));
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(motion));
        mocks.album.getByAssetId.mockResolvedValue([getForAlbum(album)]);

        await expect(sut.handleMigrationSingle({ id: still.id })).resolves.toBe(JobStatus.Success);

        expect(mocks.album.getByAssetId).toHaveBeenCalledTimes(2);
        expect(mocks.album.getByAssetId).toHaveBeenNthCalledWith(2, still.ownerId, still.id);
        expect(s3.copy.mock.calls).toEqual([
          [still.originalPath, stillKey],
          [motion.originalPath, motionKey],
        ]);
        expect(mocks.asset.update).toHaveBeenCalledWith({ id: still.id, originalPath: stillKey });
        expect(mocks.asset.update).toHaveBeenCalledWith({ id: motion.id, originalPath: motionKey });
        expect(s3.delete.mock.calls).toEqual([[still.originalPath], [motion.originalPath]]);
        expectNoDiskMove();
      });

      it('should move a disk still photo on disk and its S3 motion video inside S3', async () => {
        const user = UserFactory.create();
        const motion = AssetFactory.from({
          type: AssetType.Video,
          fileCreatedAt,
          originalPath: `upload/${user.id}/ab/cd/motion.mp4`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const still = AssetFactory.from({
          livePhotoVideoId: motion.id,
          fileCreatedAt,
          originalPath: `/data/upload/${user.id}/ab/cd/still.jpg`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const stillPath = `/data/library/${user.id}/2022/2022-06-19/${still.originalFileName}`;
        const motionKey = `library/${user.id}/2022/2022-06-19/${still.originalFileName.slice(0, -4)}.mp4`;

        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(still));
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(motion));

        await expect(sut.handleMigrationSingle({ id: still.id })).resolves.toBe(JobStatus.Success);

        expect(mocks.storage.rename).toHaveBeenCalledExactlyOnceWith(still.originalPath, stillPath);
        expect(mocks.asset.update).toHaveBeenCalledWith({ id: still.id, originalPath: stillPath });
        expect(s3.copy).toHaveBeenCalledExactlyOnceWith(motion.originalPath, motionKey);
        expect(s3.delete).toHaveBeenCalledExactlyOnceWith(motion.originalPath);
        expect(mocks.asset.update).toHaveBeenCalledWith({ id: motion.id, originalPath: motionKey });
        expect(mocks.move.create).toHaveBeenCalledTimes(2);
      });

      it('should not move an S3 Android embedded motion video', async () => {
        const user = UserFactory.create();
        const motionId = newUuid();
        const motion = AssetFactory.from({
          id: motionId,
          type: AssetType.Video,
          fileCreatedAt,
          originalPath: `encoded-video/${user.id}/${motionId.slice(0, 2)}/${motionId.slice(2, 4)}/${motionId}-MP.mp4`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const still = AssetFactory.from({
          livePhotoVideoId: motion.id,
          fileCreatedAt,
          originalPath: `upload/${user.id}/ab/cd/still.jpg`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const stillKey = `library/${user.id}/2022/2022-06-19/${still.originalFileName}`;

        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(still));
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(motion));

        await expect(sut.handleMigrationSingle({ id: still.id })).resolves.toBe(JobStatus.Success);

        expect(mocks.assetJob.getForStorageTemplateJob).toHaveBeenCalledWith(motion.id, { includeHidden: true });
        expect(mocks.move.create).toHaveBeenCalledOnce();
        expect(s3.copy).toHaveBeenCalledExactlyOnceWith(still.originalPath, stillKey);
        expect(mocks.asset.update).toHaveBeenCalledExactlyOnceWith({ id: still.id, originalPath: stillKey });
        expect(s3.delete).toHaveBeenCalledExactlyOnceWith(still.originalPath);
      });

      it('should leave an S3 asset that is already at its library key where it is', async () => {
        const user = UserFactory.create();
        const asset = AssetFactory.from({
          fileCreatedAt,
          originalFileName: 'IMG_0001.jpg',
          originalPath: `library/${user.id}/2022/2022-06-19/IMG_0001.jpg`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();

        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        expect(mocks.storage.checkFileExists).not.toHaveBeenCalled();
        expect(s3.exists).not.toHaveBeenCalled();
        expectNothingMoved();
      });

      it('should not move an S3 original to a key outside its library folder', async () => {
        const user = UserFactory.create();
        const asset = AssetFactory.from({
          fileCreatedAt,
          originalFileName: 'IMG_0001.jpg',
          originalPath: `upload/${user.id}/ab/cd/file.jpg`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const config = structuredClone(defaults);
        config.storageTemplate.template = '{{y}}/../../other-user/{{filename}}';
        sut.onConfigInit({ newConfig: config });

        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        expect(mocks.logger.warn).toHaveBeenCalledWith(
          `Skipped attempt to access an invalid path: library/other-user/IMG_0001. Path should start with library/${user.id}/`,
        );
        expect(s3.exists).not.toHaveBeenCalled();
        expectNothingMoved();
      });

      it.each([
        { label: 'an S3 original', prefix: '' },
        { label: 'a disk original', prefix: '/data/' },
      ])('should not let EXIF data move $label into a sibling library folder', async ({ prefix }) => {
        const user = UserFactory.create({ storageLabel: 'admin' });
        const asset = AssetFactory.from({
          fileCreatedAt,
          originalFileName: 'IMG_0001.jpg',
          originalPath: `${prefix}upload/${user.id}/ab/cd/file.jpg`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size, make: '../admin2' })
          .build();
        const config = structuredClone(defaults);
        config.storageTemplate.template = '{{make}}/{{filename}}';
        sut.onConfigInit({ newConfig: config });

        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        // `library/admin2` starts with `library/admin`: the guard needs the separator
        expect(mocks.logger.warn).toHaveBeenCalledWith(
          `Skipped attempt to access an invalid path: ${prefix}library/admin2/IMG_0001. Path should start with ${prefix}library/admin/`,
        );
        expect(mocks.storage.checkFileExists).not.toHaveBeenCalled();
        expect(s3.exists).not.toHaveBeenCalled();
        expectNothingMoved();
      });

      it('should not move an S3 original without a file size', async () => {
        const user = UserFactory.create();
        const asset = AssetFactory.from({ fileCreatedAt, originalPath: `upload/${user.id}/ab/cd/file.jpg` })
          .owner(user)
          .exif({ fileSizeInByte: null })
          .build();

        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        expect(mocks.logger.error).toHaveBeenCalledWith(
          `Asset ${asset.id} missing exif info, skipping storage template migration`,
        );
        expectNothingMoved();
      });

      it('should keep an S3 original at its key when the copy fails', async () => {
        const user = UserFactory.create();
        const asset = AssetFactory.from({ fileCreatedAt, originalPath: `upload/${user.id}/ab/cd/file.jpg` })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const newKey = `library/${user.id}/2022/2022-06-19/${asset.originalFileName}`;

        s3.copy.mockRejectedValue(Object.assign(new Error('Access Denied'), { code: 'AccessDenied' }));
        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        expect(s3.copy).toHaveBeenCalledExactlyOnceWith(asset.originalPath, newKey);
        expect(s3.stat).not.toHaveBeenCalled();
        expect(mocks.asset.update).not.toHaveBeenCalled();
        expect(s3.delete).not.toHaveBeenCalled();
        // the move_history row stays for the next attempt
        expect(mocks.move.delete).not.toHaveBeenCalled();
      });

      it('should delete the copy and keep an S3 original at its key on a size mismatch', async () => {
        const user = UserFactory.create();
        const asset = AssetFactory.from({ fileCreatedAt, originalPath: `upload/${user.id}/ab/cd/file.jpg` })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const newKey = `library/${user.id}/2022/2022-06-19/${asset.originalFileName}`;

        s3.stat.mockResolvedValue({ size: 100 });
        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        expect(s3.copy).toHaveBeenCalledExactlyOnceWith(asset.originalPath, newKey);
        expect(s3.stat).toHaveBeenCalledExactlyOnceWith(newKey);
        expect(s3.delete).toHaveBeenCalledExactlyOnceWith(newKey);
        expect(mocks.asset.update).not.toHaveBeenCalled();
        expect(mocks.move.delete).not.toHaveBeenCalled();
      });

      it.each([
        { failure: 'the copy fails', sidecar: 'an S3 sidecar', prefix: '' },
        { failure: 'the copy fails', sidecar: 'a disk sidecar', prefix: '/data/' },
        { failure: 'the sizes differ', sidecar: 'an S3 sidecar', prefix: '' },
        { failure: 'the sizes differ', sidecar: 'a disk sidecar', prefix: '/data/' },
      ])('should not move $sidecar when $failure for its original', async ({ failure, prefix }) => {
        const user = UserFactory.create();
        const sidecarPath = `${prefix}upload/${user.id}/ab/cd/file.jpg.xmp`;
        const asset = AssetFactory.from({ fileCreatedAt, originalPath: `upload/${user.id}/ab/cd/file.jpg` })
          .owner(user)
          .file({ type: AssetFileType.Sidecar, path: sidecarPath })
          .exif({ fileSizeInByte: size })
          .build();
        const newKey = `library/${user.id}/2022/2022-06-19/${asset.originalFileName}`;

        if (failure === 'the copy fails') {
          s3.copy.mockRejectedValue(Object.assign(new Error('Access Denied'), { code: 'AccessDenied' }));
        } else {
          s3.stat.mockResolvedValue({ size: 100 });
        }
        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        // beside a key the original never reached, a later asset of the same name would overwrite the sidecar
        expect(mocks.logger.warn).toHaveBeenCalledWith(
          `Not moving the sidecar of ${asset.id}: the move of its original is unfinished`,
        );
        expect(s3.copy).toHaveBeenCalledExactlyOnceWith(asset.originalPath, newKey);
        expect(mocks.move.create).toHaveBeenCalledExactlyOnceWith({
          entityId: asset.id,
          pathType: AssetPathType.Original,
          oldPath: asset.originalPath,
          newPath: newKey,
        });
        expect(s3.delete).not.toHaveBeenCalledWith(sidecarPath);
        expect(mocks.asset.update).not.toHaveBeenCalled();
        expect(mocks.asset.upsertFile).not.toHaveBeenCalled();
        expect(mocks.move.delete).not.toHaveBeenCalled();
        expectNoDiskMove();
      });

      it('should normalise a .JPEG key to .jpg under the storage label', async () => {
        const user = UserFactory.create({ storageLabel: 'label-1' });
        const asset = AssetFactory.from({
          fileCreatedAt,
          originalFileName: 'IMG_0001.JPEG',
          originalPath: `upload/${user.id}/ab/cd/file.JPEG`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const newKey = 'library/label-1/2022/2022-06-19/IMG_0001.jpg';

        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        expect(mocks.storage.checkFileExists).toHaveBeenCalledExactlyOnceWith(`/data/${newKey}`);
        expect(s3.exists).toHaveBeenCalledExactlyOnceWith(newKey);
        expect(mocks.move.create).toHaveBeenCalledExactlyOnceWith({
          entityId: asset.id,
          pathType: AssetPathType.Original,
          oldPath: asset.originalPath,
          newPath: newKey,
        });
        expect(s3.copy).toHaveBeenCalledExactlyOnceWith(asset.originalPath, newKey);
        expect(s3.stat).toHaveBeenCalledExactlyOnceWith(newKey);
        expect(mocks.asset.update).toHaveBeenCalledExactlyOnceWith({ id: asset.id, originalPath: newKey });
        expect(s3.delete).toHaveBeenCalledExactlyOnceWith(asset.originalPath);
        expect(mocks.move.delete).toHaveBeenCalledExactlyOnceWith(`move-original-${asset.id}`);
        expectNoDiskMove();
      });

      it('should finish an interrupted S3 move from the key it reached, after checking its size and checksum', async () => {
        const user = UserFactory.create();
        const asset = AssetFactory.from({ fileCreatedAt, originalPath: `upload/${user.id}/ab/cd/file.jpg` })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const previousKey = `library/${user.id}/2022/June/${asset.originalFileName}`;
        const newKey = `library/${user.id}/2022/2022-06-19/${asset.originalFileName}`;
        const cleanup = vi.fn().mockResolvedValue(void 0);
        const move = {
          id: 'move-1',
          entityId: asset.id,
          pathType: AssetPathType.Original,
          oldPath: asset.originalPath,
          newPath: previousKey,
        };

        s3.exists.mockImplementation((key: string) => Promise.resolve(key === previousKey));
        s3.downloadToTemp.mockResolvedValue({ tempPath: '/tmp/staged.jpg', cleanup });
        mocks.crypto.hashFile.mockResolvedValue(asset.checksum);
        mocks.move.getByEntity.mockResolvedValue(move);
        mocks.move.update.mockResolvedValue({ ...move, oldPath: previousKey, newPath: newKey });
        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        expect(s3.exists).toHaveBeenCalledWith(asset.originalPath);
        expect(s3.exists).toHaveBeenCalledWith(previousKey);
        expect(s3.stat).toHaveBeenCalledWith(previousKey);
        expect(s3.downloadToTemp).toHaveBeenCalledExactlyOnceWith(previousKey);
        expect(mocks.crypto.hashFile).toHaveBeenCalledExactlyOnceWith('/tmp/staged.jpg');
        expect(cleanup).toHaveBeenCalledOnce();
        expect(mocks.move.create).not.toHaveBeenCalled();
        expect(mocks.move.update).toHaveBeenCalledWith('move-1', {
          id: 'move-1',
          oldPath: previousKey,
          newPath: newKey,
        });
        expect(s3.copy).toHaveBeenCalledExactlyOnceWith(previousKey, newKey);
        expect(mocks.asset.update).toHaveBeenCalledExactlyOnceWith({ id: asset.id, originalPath: newKey });
        expect(s3.delete).toHaveBeenCalledExactlyOnceWith(previousKey);
        expect(mocks.move.delete).toHaveBeenCalledExactlyOnceWith('move-1');
        expectNoDiskMove();
      });
    });

    describe('destination collisions', () => {
      it('should add +1 when S3 already holds the destination key', async () => {
        const user = UserFactory.create();
        const asset = AssetFactory.from({
          fileCreatedAt,
          originalFileName: 'IMG_0001.jpg',
          originalPath: `upload/${user.id}/ab/cd/file.jpg`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const newKey = `library/${user.id}/2022/2022-06-19/IMG_0001.jpg`;
        const newKey1 = `library/${user.id}/2022/2022-06-19/IMG_0001+1.jpg`;

        s3.exists.mockImplementation((key: string) => Promise.resolve(key === newKey));
        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        expect(mocks.storage.checkFileExists.mock.calls).toEqual([[`/data/${newKey}`], [`/data/${newKey1}`]]);
        expect(s3.exists.mock.calls).toEqual([[newKey], [newKey1]]);
        expect(s3.copy).toHaveBeenCalledExactlyOnceWith(asset.originalPath, newKey1);
        expect(mocks.asset.update).toHaveBeenCalledExactlyOnceWith({ id: asset.id, originalPath: newKey1 });
      });

      it('should add +1 when the disk holds the destination key under the media location', async () => {
        const user = UserFactory.create();
        const asset = AssetFactory.from({
          fileCreatedAt,
          originalFileName: 'IMG_0001.jpg',
          originalPath: `upload/${user.id}/ab/cd/file.jpg`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const newKey = `library/${user.id}/2022/2022-06-19/IMG_0001.jpg`;
        const newKey1 = `library/${user.id}/2022/2022-06-19/IMG_0001+1.jpg`;

        mocks.storage.checkFileExists.mockImplementation((path) => Promise.resolve(path === `/data/${newKey}`));
        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        // the disk answer is enough for the first destination
        expect(s3.exists).toHaveBeenCalledExactlyOnceWith(newKey1);
        expect(s3.copy).toHaveBeenCalledExactlyOnceWith(asset.originalPath, newKey1);
        expect(mocks.asset.update).toHaveBeenCalledExactlyOnceWith({ id: asset.id, originalPath: newKey1 });
        expectNoDiskMove();
      });

      it('should add +1 to a disk original whose destination is held in S3 under its key', async () => {
        const user = UserFactory.create();
        const asset = AssetFactory.from({
          fileCreatedAt,
          originalFileName: 'IMG_0001.jpg',
          originalPath: `/data/upload/${user.id}/ab/cd/file.jpg`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const newPath1 = `/data/library/${user.id}/2022/2022-06-19/IMG_0001+1.jpg`;

        s3.exists.mockImplementation((key: string) =>
          Promise.resolve(key === `library/${user.id}/2022/2022-06-19/IMG_0001.jpg`),
        );
        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        expect(s3.exists).toHaveBeenCalledTimes(2);
        expect(mocks.storage.rename).toHaveBeenCalledExactlyOnceWith(asset.originalPath, newPath1);
        expect(mocks.asset.update).toHaveBeenCalledExactlyOnceWith({ id: asset.id, originalPath: newPath1 });
        expect(s3.copy).not.toHaveBeenCalled();
      });

      it('should still move a disk original when S3 cannot be asked about its destination', async () => {
        const user = UserFactory.create();
        const asset = AssetFactory.from({
          fileCreatedAt,
          originalFileName: 'IMG_0001.jpg',
          originalPath: `/data/upload/${user.id}/ab/cd/file.jpg`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const newKey = `library/${user.id}/2022/2022-06-19/IMG_0001.jpg`;

        s3.exists.mockRejectedValue(new Error('ExpiredToken'));
        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        expect(s3.exists).toHaveBeenCalledExactlyOnceWith(newKey);
        expect(mocks.logger.warn).toHaveBeenCalledWith(
          `Unable to check whether S3 holds ${newKey}, treating /data/${newKey} as free: ExpiredToken`,
        );
        expect(mocks.storage.rename).toHaveBeenCalledExactlyOnceWith(asset.originalPath, `/data/${newKey}`);
        expect(mocks.asset.update).toHaveBeenCalledExactlyOnceWith({ id: asset.id, originalPath: `/data/${newKey}` });
        expect(s3.copy).not.toHaveBeenCalled();
      });

      it('should not move an S3 original when S3 cannot be asked about its destination', async () => {
        const user = UserFactory.create();
        const asset = AssetFactory.from({
          fileCreatedAt,
          originalFileName: 'IMG_0001.jpg',
          originalPath: `upload/${user.id}/ab/cd/file.jpg`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();

        s3.exists.mockRejectedValue(new Error('ExpiredToken'));
        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        // S3 is the real check for a key, so the template keeps the asset where it is
        expect(s3.exists).toHaveBeenCalledExactlyOnceWith(`library/${user.id}/2022/2022-06-19/IMG_0001.jpg`);
        expect(mocks.logger.error).toHaveBeenCalledWith(
          'Unable to get template path for IMG_0001.jpg: Error: ExpiredToken',
        );
        expect(mocks.move.getByEntity).not.toHaveBeenCalled();
        expectNothingMoved();
      });

      it('should check only the disk without S3 configured', async () => {
        (storageBackends as any).s3Backend = undefined;
        const user = UserFactory.create();
        const asset = AssetFactory.from({
          fileCreatedAt,
          originalFileName: 'IMG_0001.jpg',
          originalPath: `/data/upload/${user.id}/ab/cd/file.jpg`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const newPath = `/data/library/${user.id}/2022/2022-06-19/IMG_0001.jpg`;
        const newPath1 = `/data/library/${user.id}/2022/2022-06-19/IMG_0001+1.jpg`;

        mocks.storage.checkFileExists.mockResolvedValueOnce(true);
        mocks.user.get.mockResolvedValue(user);
        mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

        await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

        expect(mocks.storage.checkFileExists.mock.calls).toEqual([[newPath], [newPath1]]);
        expect(s3.exists).not.toHaveBeenCalled();
        expect(mocks.storage.rename).toHaveBeenCalledExactlyOnceWith(asset.originalPath, newPath1);
        expect(mocks.asset.update).toHaveBeenCalledExactlyOnceWith({ id: asset.id, originalPath: newPath1 });
      });
    });

    describe('handleMigration', () => {
      it('should move S3 originals during bulk migration', async () => {
        const user = UserFactory.create({ storageLabel: 'label-1' });
        const asset = AssetFactory.from({ fileCreatedAt, originalPath: `upload/${user.id}/ab/cd/file.jpg` })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const newKey = `library/label-1/2022/2022-06-19/${asset.originalFileName}`;

        mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([getForStorageTemplate(asset)]));
        mocks.user.getList.mockResolvedValue([user]);

        await expect(sut.handleMigration()).resolves.toBe(JobStatus.Success);

        expect(mocks.move.create).toHaveBeenCalledExactlyOnceWith({
          entityId: asset.id,
          pathType: AssetPathType.Original,
          oldPath: asset.originalPath,
          newPath: newKey,
        });
        expect(s3.copy).toHaveBeenCalledExactlyOnceWith(asset.originalPath, newKey);
        expect(s3.stat).toHaveBeenCalledExactlyOnceWith(newKey);
        expect(mocks.asset.update).toHaveBeenCalledExactlyOnceWith({ id: asset.id, originalPath: newKey });
        expect(s3.delete).toHaveBeenCalledExactlyOnceWith(asset.originalPath);
        expect(mocks.move.delete).toHaveBeenCalledExactlyOnceWith(`move-original-${asset.id}`);
        expectNoDiskMove();
      });

      it('should move the disk and S3 originals of one library each in its own namespace', async () => {
        const user = UserFactory.create({ storageLabel: 'label-1' });
        const diskAsset = AssetFactory.from({ fileCreatedAt, originalPath: `/data/upload/${user.id}/ab/cd/disk.jpg` })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const s3Asset = AssetFactory.from({ fileCreatedAt, originalPath: `upload/${user.id}/ef/gh/s3.jpg` })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        const diskPath = `/data/library/label-1/2022/2022-06-19/${diskAsset.originalFileName}`;
        const s3Key = `library/label-1/2022/2022-06-19/${s3Asset.originalFileName}`;

        mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(
          makeStream([getForStorageTemplate(diskAsset), getForStorageTemplate(s3Asset)]),
        );
        mocks.user.getList.mockResolvedValue([user]);

        await expect(sut.handleMigration()).resolves.toBe(JobStatus.Success);

        expect(mocks.storage.rename).toHaveBeenCalledExactlyOnceWith(diskAsset.originalPath, diskPath);
        expect(s3.copy).toHaveBeenCalledExactlyOnceWith(s3Asset.originalPath, s3Key);
        expect(s3.delete).toHaveBeenCalledExactlyOnceWith(s3Asset.originalPath);
        expect(mocks.asset.update).toHaveBeenCalledWith({ id: diskAsset.id, originalPath: diskPath });
        expect(mocks.asset.update).toHaveBeenCalledWith({ id: s3Asset.id, originalPath: s3Key });
      });

      it('should not clean up disk folders when the library folder does not exist on S3 deployments', async () => {
        const user = UserFactory.create();
        const asset = AssetFactory.from({ fileCreatedAt, originalPath: `upload/${user.id}/ab/cd/file.jpg` })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();

        mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([getForStorageTemplate(asset)]));
        mocks.user.getList.mockResolvedValue([user]);
        mocks.storage.checkFileExists.mockResolvedValue(false);

        await expect(sut.handleMigration()).resolves.toBe(JobStatus.Success);

        expect(s3.copy).toHaveBeenCalledOnce();
        expect(mocks.storage.checkFileExists).toHaveBeenLastCalledWith('/data/library');
        expect(mocks.storage.removeEmptyDirs).not.toHaveBeenCalled();
      });

      it('should make no S3 requests for S3 assets already at their library key', async () => {
        const user = UserFactory.create();
        const asset = AssetFactory.from({
          fileCreatedAt,
          originalFileName: 'IMG_0001.jpg',
          originalPath: `library/${user.id}/2022/2022-06-19/IMG_0001.jpg`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();
        // an earlier run gave it +7 because other IMG_0002.jpg files held the destination
        const duplicate = AssetFactory.from({
          fileCreatedAt,
          originalFileName: 'IMG_0002.jpg',
          originalPath: `library/${user.id}/2022/2022-06-19/IMG_0002+7.jpg`,
        })
          .owner(user)
          .exif({ fileSizeInByte: size })
          .build();

        mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(
          makeStream([getForStorageTemplate(asset), getForStorageTemplate(duplicate)]),
        );
        mocks.user.getList.mockResolvedValue([user]);

        await expect(sut.handleMigration()).resolves.toBe(JobStatus.Success);

        expect(s3.exists).not.toHaveBeenCalled();
        expectNothingMoved();
      });
    });

    // an install that upgraded with originals in S3 and the template enabled: its S3 files wait for an admin to run
    // Storage Template Migration by hand (StorageTemplateS3Service decides and clears the state)
    describe('while an upgrade waits for a manual migration', () => {
      const decidedAt = '2026-10-20T08:00:00.000Z';

      let s3State: SystemMetadata[SystemMetadataKey.StorageTemplateS3State] | null;

      beforeEach(() => {
        s3State = { pending: true, decidedAt };
        mocks.systemMetadata.get.mockImplementation((key: SystemMetadataKey) =>
          Promise.resolve(
            (key === SystemMetadataKey.StorageTemplateS3State
              ? s3State
              : { storageTemplate: { enabled: true } }) as any,
          ),
        );
      });

      describe('handleMigrationSingle', () => {
        it('should skip an S3 original without reading its owner or asking S3', async () => {
          const user = UserFactory.create();
          const asset = AssetFactory.from({ fileCreatedAt, originalPath: `upload/${user.id}/ab/cd/file.jpg` })
            .owner(user)
            .exif({ fileSizeInByte: size })
            .build();

          mocks.user.get.mockResolvedValue(user);
          mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

          await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Skipped);

          expect(stateReads()).toBe(1);
          expectLeftForManualRun();
        });

        it('should skip a disk original whose sidecar is in S3, so the two are not split', async () => {
          const user = UserFactory.create();
          const asset = AssetFactory.from({ fileCreatedAt, originalPath: `/data/upload/${user.id}/ab/cd/file.jpg` })
            .owner(user)
            .file({ type: AssetFileType.Sidecar, path: `upload/${user.id}/ab/cd/file.jpg.xmp` })
            .exif({ fileSizeInByte: size })
            .build();

          mocks.user.get.mockResolvedValue(user);
          mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

          await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Skipped);

          expect(stateReads()).toBe(1);
          expectLeftForManualRun();
        });

        it('should move a disk still photo on disk and leave its S3 motion video at its upload key', async () => {
          const user = UserFactory.create();
          const motion = AssetFactory.from({
            type: AssetType.Video,
            fileCreatedAt,
            originalPath: `upload/${user.id}/ef/gh/motion.mp4`,
          })
            .owner(user)
            .exif({ fileSizeInByte: size })
            .build();
          const still = AssetFactory.from({
            livePhotoVideoId: motion.id,
            fileCreatedAt,
            originalFileName: 'IMG_0001.jpg',
            originalPath: `/data/upload/${user.id}/ab/cd/still.jpg`,
          })
            .owner(user)
            .exif({ fileSizeInByte: size })
            .build();
          const stillKey = `library/${user.id}/2022/2022-06-19/IMG_0001.jpg`;
          const stillPath = `/data/${stillKey}`;

          mocks.user.get.mockResolvedValue(user);
          mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(still));
          mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(motion));

          await expect(sut.handleMigrationSingle({ id: still.id })).resolves.toBe(JobStatus.Success);

          expect(mocks.assetJob.getForStorageTemplateJob).toHaveBeenCalledWith(motion.id, { includeHidden: true });
          // the disk still is decided without a reading; the motion video is the one that reads the state
          expect(stateReads()).toBe(1);
          expect(mocks.move.create).toHaveBeenCalledExactlyOnceWith({
            entityId: still.id,
            pathType: AssetPathType.Original,
            oldPath: still.originalPath,
            newPath: stillPath,
          });
          expect(mocks.storage.rename).toHaveBeenCalledExactlyOnceWith(still.originalPath, stillPath);
          expect(mocks.asset.update).toHaveBeenCalledExactlyOnceWith({ id: still.id, originalPath: stillPath });
          // the only S3 request is the still's destination check: the motion video gets no template path at all
          expect(s3.exists).toHaveBeenCalledExactlyOnceWith(stillKey);
          expect(s3.copy).not.toHaveBeenCalled();
          expect(s3.stat).not.toHaveBeenCalled();
          expect(s3.delete).not.toHaveBeenCalled();
        });

        it('should move neither part of a live photo whose still is in S3 and motion video on disk', async () => {
          const user = UserFactory.create();
          const motion = AssetFactory.from({
            type: AssetType.Video,
            fileCreatedAt,
            originalPath: `/data/upload/${user.id}/ef/gh/motion.mp4`,
          })
            .owner(user)
            .exif({ fileSizeInByte: size })
            .build();
          const still = AssetFactory.from({
            livePhotoVideoId: motion.id,
            fileCreatedAt,
            originalPath: `upload/${user.id}/ab/cd/still.jpg`,
          })
            .owner(user)
            .exif({ fileSizeInByte: size })
            .build();

          mocks.user.get.mockResolvedValue(user);
          mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(still));
          mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(motion));

          await expect(sut.handleMigrationSingle({ id: still.id })).resolves.toBe(JobStatus.Skipped);

          // the job stops at the still, so the disk motion video is not even read
          expect(mocks.assetJob.getForStorageTemplateJob).toHaveBeenCalledExactlyOnceWith(still.id);
          expect(stateReads()).toBe(1);
          expectLeftForManualRun();
        });

        it('should move a disk-only live photo and its sidecar as upstream does, without reading the state', async () => {
          const user = UserFactory.create();
          const motion = AssetFactory.from({
            type: AssetType.Video,
            fileCreatedAt,
            originalPath: `/data/upload/${user.id}/ef/gh/motion.mp4`,
          })
            .owner(user)
            .exif({ fileSizeInByte: size })
            .build();
          const sidecarPath = `/data/upload/${user.id}/ab/cd/still.jpg.xmp`;
          const still = AssetFactory.from({
            livePhotoVideoId: motion.id,
            fileCreatedAt,
            originalFileName: 'IMG_0001.jpg',
            originalPath: `/data/upload/${user.id}/ab/cd/still.jpg`,
          })
            .owner(user)
            .file({ type: AssetFileType.Sidecar, path: sidecarPath })
            .exif({ fileSizeInByte: size })
            .build();
          const stillPath = `/data/library/${user.id}/2022/2022-06-19/IMG_0001.jpg`;
          const motionPath = `/data/library/${user.id}/2022/2022-06-19/IMG_0001.mp4`;

          mocks.user.get.mockResolvedValue(user);
          mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(still));
          mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(motion));

          await expect(sut.handleMigrationSingle({ id: still.id })).resolves.toBe(JobStatus.Success);

          expect(mocks.systemMetadata.get).not.toHaveBeenCalledWith(SystemMetadataKey.StorageTemplateS3State);
          expect(mocks.storage.rename.mock.calls).toEqual([
            [still.originalPath, stillPath],
            [sidecarPath, `${stillPath}.xmp`],
            [motion.originalPath, motionPath],
          ]);
          expect(mocks.asset.update).toHaveBeenCalledWith({ id: still.id, originalPath: stillPath });
          expect(mocks.asset.update).toHaveBeenCalledWith({ id: motion.id, originalPath: motionPath });
          expect(mocks.asset.upsertFile).toHaveBeenCalledExactlyOnceWith({
            assetId: still.id,
            type: AssetFileType.Sidecar,
            path: `${stillPath}.xmp`,
          });
          expect(s3.copy).not.toHaveBeenCalled();
        });

        it.each([
          {
            label: 'cleared by a manual run',
            state: { pending: false, decidedAt, clearedAt: '2026-10-21T09:00:00.000Z' },
          },
          { label: 'decided not pending', state: { pending: false, decidedAt } },
          { label: 'absent', state: null },
        ])('should move an S3 original through the per-asset job when the state is $label', async ({ state }) => {
          s3State = state;
          const user = UserFactory.create();
          const asset = AssetFactory.from({ fileCreatedAt, originalPath: `upload/${user.id}/ab/cd/file.jpg` })
            .owner(user)
            .exif({ fileSizeInByte: size })
            .build();
          const newKey = `library/${user.id}/2022/2022-06-19/${asset.originalFileName}`;

          mocks.user.get.mockResolvedValue(user);
          mocks.assetJob.getForStorageTemplateJob.mockResolvedValue(getForStorageTemplate(asset));

          await expect(sut.handleMigrationSingle({ id: asset.id })).resolves.toBe(JobStatus.Success);

          expect(stateReads()).toBe(1);
          expect(mocks.user.get).toHaveBeenCalledWith(user.id, {});
          expect(s3.copy).toHaveBeenCalledExactlyOnceWith(asset.originalPath, newKey);
          expect(mocks.asset.update).toHaveBeenCalledExactlyOnceWith({ id: asset.id, originalPath: newKey });
          expect(s3.delete).toHaveBeenCalledExactlyOnceWith(asset.originalPath);
        });
      });

      describe('handleMigration', () => {
        it('should move an S3 original in the manual bulk migration', async () => {
          const user = UserFactory.create();
          const asset = AssetFactory.from({ fileCreatedAt, originalPath: `upload/${user.id}/ab/cd/file.jpg` })
            .owner(user)
            .exif({ fileSizeInByte: size })
            .build();
          const newKey = `library/${user.id}/2022/2022-06-19/${asset.originalFileName}`;

          mocks.assetJob.streamForStorageTemplateJob.mockReturnValue(makeStream([getForStorageTemplate(asset)]));
          mocks.user.getList.mockResolvedValue([user]);

          await expect(sut.handleMigration()).resolves.toBe(JobStatus.Success);

          expect(s3.copy).toHaveBeenCalledExactlyOnceWith(asset.originalPath, newKey);
          expect(mocks.asset.update).toHaveBeenCalledExactlyOnceWith({ id: asset.id, originalPath: newKey });
          expect(s3.delete).toHaveBeenCalledExactlyOnceWith(asset.originalPath);
          // the bulk job neither reads nor clears the state: StorageTemplateS3Service.onJobSuccess clears it
          expect(stateReads()).toBe(0);
          expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
        });
      });
    });
  });
});
