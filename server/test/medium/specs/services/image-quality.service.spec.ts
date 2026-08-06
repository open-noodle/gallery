import { Kysely } from 'kysely';
import { AssetFileType, JobStatus } from 'src/enum';
import { AssetJobRepository } from 'src/repositories/asset-job.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { ImageQualityService } from 'src/services/image-quality.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(ImageQualityService, {
    database: db || defaultDatabase,
    real: [AssetRepository, AssetJobRepository, ConfigRepository, SystemMetadataRepository],
    mock: [JobRepository, LoggingRepository, MachineLearningRepository],
  });
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(ImageQualityService.name, () => {
  it('should score an asset and persist scores + qualityScoredAt', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: 'preview.jpg' });

    const mlMock = ctx.getMock(MachineLearningRepository);
    mlMock.analyzeAssetQuality.mockResolvedValue({ sharpness: 60, exposure: 70, brightness: 55, quality: 62 });

    await expect(sut.handleImageQuality({ id: asset.id })).resolves.toBe(JobStatus.Success);

    await expect(
      ctx.database.selectFrom('asset_quality').selectAll().where('assetId', '=', asset.id).executeTakeFirst(),
    ).resolves.toEqual({ assetId: asset.id, sharpness: 60, exposure: 70, brightness: 55, quality: 62 });

    await expect(
      ctx.database
        .selectFrom('asset_job_status')
        .select('qualityScoredAt')
        .where('assetId', '=', asset.id)
        .executeTakeFirst(),
    ).resolves.toEqual({ qualityScoredAt: expect.any(Date) });
  });

  it('re-scoring updates existing scores (upsert)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: 'preview.jpg' });

    const mlMock = ctx.getMock(MachineLearningRepository);
    mlMock.analyzeAssetQuality.mockResolvedValue({ sharpness: 10, exposure: 10, brightness: 10, quality: 10 });
    await sut.handleImageQuality({ id: asset.id });
    mlMock.analyzeAssetQuality.mockResolvedValue({ sharpness: 90, exposure: 80, brightness: 70, quality: 84 });
    await sut.handleImageQuality({ id: asset.id });

    await expect(
      ctx.database.selectFrom('asset_quality').selectAll().where('assetId', '=', asset.id).executeTakeFirst(),
    ).resolves.toEqual({ assetId: asset.id, sharpness: 90, exposure: 80, brightness: 70, quality: 84 });
  });
});
