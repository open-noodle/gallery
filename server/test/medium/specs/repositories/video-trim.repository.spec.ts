import { Kysely } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { AssetOrder, AssetType, AssetVisibility } from 'src/enum.js';
import { VideoTrimRepository } from 'src/gallery/repositories/video-trim.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = async () => {
  const { ctx } = newMediumService(BaseService, { database: defaultDatabase, real: [], mock: [LoggingRepository] });
  const { user } = await ctx.newUser();
  const { asset: video } = await ctx.newAsset({
    ownerId: user.id,
    type: AssetType.Video,
    duration: 10_000,
    fileCreatedAt: new Date('2026-03-09T12:00:00.000Z'),
    localDateTime: new Date('2026-03-09T12:00:00.000Z'),
  });
  await ctx.newExif({ assetId: video.id, timeZone: 'UTC' });
  return { ctx, user, video, sut: ctx.get(VideoTrimRepository) };
};

const asset = (ctx: Awaited<ReturnType<typeof setup>>['ctx'], id: string) =>
  ctx.database
    .selectFrom('asset')
    .select(['duration', 'isEdited', 'updateId'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(VideoTrimRepository.name, () => {
  it('records the trimmed duration and bumps asset.updateId, leaving asset.duration the original', async () => {
    const { ctx, video, sut } = await setup();
    await sut.upsert(video.id, 1, 5);
    const before = await asset(ctx, video.id);

    await sut.setDuration(video.id, 4000);

    const after = await asset(ctx, video.id);
    expect(after.duration).toBe(10_000);
    expect(after.isEdited).toBe(true);
    expect(after.updateId).not.toBe(before.updateId);
    await expect(sut.get(video.id)).resolves.toEqual({ startTime: 1, endTime: 5 });
  });

  it('does not touch the asset when the trim was removed before the job finished', async () => {
    const { ctx, video, sut } = await setup();
    await sut.upsert(video.id, 1, 5);
    await expect(sut.delete(video.id)).resolves.toBe(true);
    const before = await asset(ctx, video.id);

    await sut.setDuration(video.id, 4000);

    await expect(asset(ctx, video.id)).resolves.toEqual(before);
    await expect(sut.delete(video.id)).resolves.toBe(false);
  });

  it('keeps the probed duration of an earlier trim until the re-trim job replaces it', async () => {
    const { video, sut } = await setup();
    await sut.upsert(video.id, 1, 5);
    await sut.setDuration(video.id, 4000);

    await sut.upsert(video.id, 2, 8);

    await expect(sut.getForTrim(video.id)).resolves.toMatchObject({ duration: 10_000, startTime: 2, endTime: 8 });
    const { duration } = await defaultDatabase
      .selectFrom('asset_video_trim')
      .select('duration')
      .where('assetId', '=', video.id)
      .executeTakeFirstOrThrow();
    expect(duration).toBe(4000);
  });

  it('projects the trimmed duration on the asset, timeline, search and stack reads', async () => {
    const { ctx, user, video, sut } = await setup();
    const { asset: other } = await ctx.newAsset({ ownerId: user.id });
    const { stack } = await ctx.newStack({ ownerId: user.id }, [video.id, other.id]);
    await sut.upsert(video.id, 1, 5);
    await sut.setDuration(video.id, 4000);

    await expect(ctx.get(AssetRepository).getById(video.id)).resolves.toMatchObject({ duration: 4000 });

    const bucket = await ctx
      .get(AssetRepository)
      .getTimeBucket(
        '2026-03-01',
        { order: AssetOrder.Desc, userIds: [user.id], visibility: AssetVisibility.Timeline, withStacked: true },
        factory.auth({ user: { id: user.id } }),
      );
    const { id, duration } = JSON.parse(bucket.assets) as { id: string[]; duration: (number | null)[] };
    expect(duration[id.indexOf(video.id)]).toBe(4000);

    const { items } = await ctx
      .get(SearchRepository)
      .searchMetadata({ page: 1, size: 10 }, { userIds: [user.id], type: AssetType.Video });
    expect(items).toEqual([expect.objectContaining({ id: video.id, duration: 4000 })]);

    const stacked = await ctx.get(StackRepository).getById(stack.id);
    expect(stacked?.assets.find(({ id }) => id === video.id)).toMatchObject({ duration: 4000 });
  });

  it('projects the trimmed duration and the caller favorite on the bulk-update read', async () => {
    const { ctx, user, video, sut } = await setup();
    const { user: member } = await ctx.newUser();
    await sut.upsert(video.id, 1, 5);
    await sut.setDuration(video.id, 4000);
    await ctx.database.insertInto('asset_favorite').values({ assetId: video.id, userId: member.id }).execute();

    const assets = ctx.get(AssetRepository);
    await expect(assets.getByIds([video.id], member.id)).resolves.toEqual([
      expect.objectContaining({ duration: 4000, isFavorite: false, isFavoriteForUser: true }),
    ]);
    await expect(assets.getByIds([video.id], user.id)).resolves.toEqual([
      expect.objectContaining({ duration: 4000, isFavoriteForUser: false }),
    ]);
  });

  it('cascades with the asset', async () => {
    const { ctx, video, sut } = await setup();
    await sut.upsert(video.id, 1, 5);

    await ctx.database.deleteFrom('asset').where('id', '=', video.id).execute();

    await expect(sut.get(video.id)).resolves.toBeUndefined();
  });
});
