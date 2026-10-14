import { Kysely } from 'kysely';
import { JobName, JobStatus, QueueName } from 'src/enum.js';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { WebsocketRepository } from 'src/repositories/websocket.repository.js';
import { DB } from 'src/schema/index.js';
import { JobService } from 'src/services/job.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

// job.service.ts's AssetEditReadyV2 / AssetUploadReadyV2 websocket payloads are built by hand (not via
// mapAsset) and always sent to the asset's OWNER, so their `isFavorite` is asset."isFavorite", the owner's
// favorite projected from the asset_favorite overlay. These cases seed the overlay only, as Gallery writes
// it, and check the payload follows the owner's row and ignores another user's.
let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(JobService, {
    database: db || defaultDatabase,
    real: [AssetRepository, AssetEditRepository],
    mock: [EventRepository, JobRepository, LoggingRepository, WebsocketRepository],
  });
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
}, 30_000);

describe('JobService AssetEditReadyV2 favorite staleness (#763)', () => {
  it('reports the OWNER overlay row projected onto asset.isFavorite', async () => {
    const { sut, ctx } = setup();
    ctx.getMock(JobRepository).run.mockResolvedValue(JobStatus.Success);
    ctx.getMock(EventRepository).emit.mockResolvedValue(undefined as never);

    const { user: owner } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: owner.id });

    // Seed the OWNER's favorite via the overlay only, as updateFavorites does.
    await ctx.database.insertInto('asset_favorite').values({ userId: owner.id, assetId: asset.id }).execute();

    await sut.onJobRun(QueueName.ThumbnailGeneration, {
      name: JobName.AssetEditThumbnailGeneration,
      data: { id: asset.id },
    });

    expect(ctx.getMock(WebsocketRepository).clientSend).toHaveBeenCalledWith(
      'AssetEditReadyV2',
      owner.id,
      expect.objectContaining({ asset: expect.objectContaining({ isFavorite: true }) }),
    );
  });

  it('does not leak a non-owner favorite onto the owner-scoped payload', async () => {
    const { sut, ctx } = setup();
    ctx.getMock(JobRepository).run.mockResolvedValue(JobStatus.Success);
    ctx.getMock(EventRepository).emit.mockResolvedValue(undefined as never);

    const { user: owner } = await ctx.newUser();
    const { user: other } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: owner.id });

    // Only a non-owner favorited the asset — the owner-scoped websocket payload must stay false.
    await ctx.database.insertInto('asset_favorite').values({ userId: other.id, assetId: asset.id }).execute();

    await sut.onJobRun(QueueName.ThumbnailGeneration, {
      name: JobName.AssetEditThumbnailGeneration,
      data: { id: asset.id },
    });

    expect(ctx.getMock(WebsocketRepository).clientSend).toHaveBeenCalledWith(
      'AssetEditReadyV2',
      owner.id,
      expect.objectContaining({ asset: expect.objectContaining({ isFavorite: false }) }),
    );
  });
});
