import { Insertable, Kysely } from 'kysely';
import { AssetVisibility, SharedSpaceRole, TimeBucketSize } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { StackRepository } from 'src/repositories/stack.repository';
import { DB } from 'src/schema';
import { AssetTable } from 'src/schema/tables/asset.table';
import { SharedSpaceService } from 'src/services/shared-space.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';
import { beforeAll, describe, expect, it } from 'vitest';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx, sut } = newMediumService(SharedSpaceService, {
    database: db || defaultDatabase,
    real: [SharedSpaceRepository, AssetRepository, StackRepository, AccessRepository],
    mock: [LoggingRepository, JobRepository],
  });
  const jobs = ctx.getMock(JobRepository);
  jobs.queue.mockResolvedValue();
  jobs.queueAll.mockResolvedValue();
  return {
    ctx,
    sut,
    assetRepo: ctx.get(AssetRepository),
    spaceRepo: ctx.get(SharedSpaceRepository),
  };
};

const createTimelineAsset = async (
  ctx: ReturnType<typeof setup>['ctx'],
  ownerId: string,
  localDateTime: Date,
  options: Partial<Insertable<AssetTable>> = {},
) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    visibility: AssetVisibility.Timeline,
    fileCreatedAt: localDateTime,
    localDateTime,
    width: 400,
    height: 200,
    thumbhash: Buffer.from('thumbhash'),
    ...options,
  });
  await ctx.newExif({ assetId: asset.id, timeZone: 'UTC' });
  return asset;
};

const spaceTimelineCount = async (
  assetRepo: ReturnType<typeof setup>['assetRepo'],
  spaceId: string,
): Promise<number> => {
  const buckets = await assetRepo.getTimeBuckets({
    spaceId,
    visibility: AssetVisibility.Timeline,
    bucketSize: TimeBucketSize.Year,
    withStacked: true,
  });
  return buckets.reduce((total, bucket) => total + bucket.count, 0);
};

const seedOwnedSpaceWithStack = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user } = await ctx.newUser();
  const auth = factory.auth({
    user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin },
  });
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });

  const primary = await createTimelineAsset(ctx, user.id, new Date('2024-01-01T12:00:00.000Z'));
  const child = await createTimelineAsset(ctx, user.id, new Date('2024-01-02T12:00:00.000Z'));
  await ctx.newStack({ ownerId: user.id }, [primary.id, child.id]);

  return { user, auth, space, primary, child };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(`${SharedSpaceService.name} stacks in spaces (#751)`, () => {
  it('contributes the whole stack when only the primary is selected, keeping count and timeline consistent', async () => {
    const { ctx, sut, assetRepo, spaceRepo } = setup();
    const { auth, space, primary } = await seedOwnedSpaceWithStack(ctx);

    await sut.addAssets(auth, space.id, { assetIds: [primary.id] });

    // Both stack members are contributed (raw membership count = 2)...
    await expect(spaceRepo.getAssetCount(space.id)).resolves.toBe(2);
    // ...and the stack-collapsed timeline shows exactly one tile (the primary).
    await expect(spaceTimelineCount(assetRepo, space.id)).resolves.toBe(1);
  });

  it('contributes the whole stack when only a child is selected', async () => {
    const { ctx, sut, assetRepo, spaceRepo } = setup();
    const { auth, space, child } = await seedOwnedSpaceWithStack(ctx);

    await sut.addAssets(auth, space.id, { assetIds: [child.id] });

    await expect(spaceRepo.getAssetCount(space.id)).resolves.toBe(2);
    await expect(spaceTimelineCount(assetRepo, space.id)).resolves.toBe(1);
  });

  it('removes the whole stack when the primary tile is removed — no orphaned child left counting', async () => {
    const { ctx, sut, assetRepo, spaceRepo } = setup();
    const { auth, space, primary } = await seedOwnedSpaceWithStack(ctx);

    await sut.addAssets(auth, space.id, { assetIds: [primary.id] });
    // This is Pierre's exact repro: remove the single visible (primary) tile.
    await sut.removeAssets(auth, space.id, { assetIds: [primary.id] });

    // Count and timeline must BOTH be empty — the child must not linger.
    await expect(spaceRepo.getAssetCount(space.id)).resolves.toBe(0);
    await expect(spaceTimelineCount(assetRepo, space.id)).resolves.toBe(0);
  });

  it('removes the whole stack when a child is removed', async () => {
    const { ctx, sut, assetRepo, spaceRepo } = setup();
    const { auth, space, child } = await seedOwnedSpaceWithStack(ctx);

    await sut.addAssets(auth, space.id, { assetIds: [child.id] });
    await sut.removeAssets(auth, space.id, { assetIds: [child.id] });

    await expect(spaceRepo.getAssetCount(space.id)).resolves.toBe(0);
    await expect(spaceTimelineCount(assetRepo, space.id)).resolves.toBe(0);
  });

  // The exact #751 repro: the client contributes BOTH members (count shows 2),
  // then the user removes the single visible (primary) tile. Before the fix,
  // removal touched only the primary, leaving the child orphaned — the space
  // reported "1 remaining photo" while the timeline was empty.
  it('reproduces #751: removing the primary tile clears the space even when both members were contributed', async () => {
    const { ctx, sut, assetRepo, spaceRepo } = setup();
    const { auth, space, primary, child } = await seedOwnedSpaceWithStack(ctx);

    await sut.addAssets(auth, space.id, { assetIds: [primary.id, child.id] });
    await expect(spaceRepo.getAssetCount(space.id)).resolves.toBe(2);

    await sut.removeAssets(auth, space.id, { assetIds: [primary.id] });

    await expect(spaceRepo.getAssetCount(space.id)).resolves.toBe(0);
    await expect(spaceTimelineCount(assetRepo, space.id)).resolves.toBe(0);
  });

  // Characterization test: this is the exact divergence the stack-atomic
  // membership fix prevents. A stack CHILD contributed without its global
  // collapse-primary counts toward the space but is filtered out of the
  // stack-collapsed timeline. The service can no longer produce this state,
  // but the raw query still behaves this way — which is *why* atomicity is
  // required at the contribution layer.
  it('a lone stack child diverges: counted but invisible in the collapsed timeline', async () => {
    const { ctx, assetRepo, spaceRepo } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });

    const primary = await createTimelineAsset(ctx, user.id, new Date('2024-02-01T12:00:00.000Z'));
    const child = await createTimelineAsset(ctx, user.id, new Date('2024-02-02T12:00:00.000Z'));
    await ctx.newStack({ ownerId: user.id }, [primary.id, child.id]);

    // Contribute ONLY the child directly (bypassing the atomic service path).
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: child.id, addedById: user.id });

    await expect(spaceRepo.getAssetCount(space.id)).resolves.toBe(1);
    await expect(spaceTimelineCount(assetRepo, space.id)).resolves.toBe(0);
  });

  // RBAC: auto-expansion must not pull a Hidden/Locked stack frame into a space.
  it('does not contribute a Hidden stack sibling when expanding on add', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const auth = factory.auth({
      user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin },
    });
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });

    const primary = await createTimelineAsset(ctx, user.id, new Date('2024-03-01T12:00:00.000Z'));
    const { asset: hidden } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Hidden });
    await ctx.newStack({ ownerId: user.id }, [primary.id, hidden.id]);

    await sut.addAssets(auth, space.id, { assetIds: [primary.id] });

    const members = await defaultDatabase
      .selectFrom('shared_space_asset')
      .select('assetId')
      .where('spaceId', '=', space.id)
      .execute();
    const memberIds = members.map((m) => m.assetId);
    expect(memberIds).toContain(primary.id);
    expect(memberIds).not.toContain(hidden.id);
  });
});
