import { Kysely } from 'kysely';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { WebsocketRepository } from 'src/repositories/websocket.repository';
import { DB } from 'src/schema';
import { JobService } from 'src/services/job.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// #763 (Task 1 review finding): job.service.ts's AssetEditReadyV2 / AssetUploadReadyV2 websocket
// payloads are built by hand (not via mapAsset) from `assetRepository.getById` /
// `getByIdsWithAllRelationsButStacks` called with NO authUserId, and mapped `isFavorite:
// asset.isFavorite` off the raw `selectAll('asset')` row. The overlay write path (updateFavorites,
// slice 1) never touches that raw column, so these two events went stale the moment #763 shipped —
// this is a LIVE staleness bug, not incidental tsc fallout from the slice-3 column drop.
//
// These events are always sent to the asset's OWNER (`this.websocketRepository.clientSend(event,
// asset.ownerId, ...)`), so the correct semantics are the OWNER's favorite state — exactly what
// `favoriteExistsForOwner` (src/utils/favorite.ts) resolves. This spec seeds the OWNER's favorite
// via the `asset_favorite` overlay ONLY (never the raw column — the app no longer writes it) and
// asserts the emitted payload reflects it, then asserts a NON-owner's favorite does not leak onto
// the owner-scoped payload.
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
  it('resolves isFavorite from the OWNER overlay row, not the raw asset column', async () => {
    const { sut, ctx } = setup();
    ctx.getMock(JobRepository).run.mockResolvedValue(JobStatus.Success);
    ctx.getMock(EventRepository).emit.mockResolvedValue(undefined as never);

    const { user: owner } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: owner.id });

    // Seed the OWNER's favorite via the overlay ONLY — mirrors how the app writes favorites
    // post-#763 (updateFavorites routes through AssetFavoriteRepository, never asset.isFavorite).
    // mediumFactory.assetInsert still defaults the raw column to false, so this row diverges from
    // the raw column exactly the way a real post-#763 favorite does.
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
