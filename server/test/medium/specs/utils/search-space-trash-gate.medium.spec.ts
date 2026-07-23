// H-1 — caller-proof trash gate on the two searchAssetBuilder space arms.
// The other-members branch of the `spaceId` arm and the `timelineSpaceIds`
// (withSharedSpaces) arm must AND `asset.deletedAt IS NULL`, so a space member
// cannot pull another member's trashed asset by flipping the caller-toggleable
// terminal trash filter (withDeleted / trashedAfter / trashedBefore / isOffline).
// The caller's OWN (ownerId IN userIds) branch stays unfiltered so own/partner
// trash search is preserved. Sibling of the fixed albumSharedSpaceScope arm
// (see shared-space-album-scope-sql.medium.spec.ts).
import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { AssetSearchBuilderOptions } from 'src/repositories/search.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { searchAssetBuilderLegacy } from 'src/utils/database';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: db,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx };
};

type Ctx = ReturnType<typeof setup>['ctx'];

const builtIds = async (options: AssetSearchBuilderOptions): Promise<Set<string>> => {
  const rows = await searchAssetBuilderLegacy(db, options).select('asset.id').execute();
  return new Set(rows.map((r) => r.id as string));
};

beforeAll(async () => {
  db = await getKyselyDB();
});

const seed = async (ctx: Ctx) => {
  const { user: owner } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

  // Two of the owner's assets shared directly into the space; both Timeline
  // (pass spaceVisibilityGate). One is then trashed (deletedAt set, link row survives).
  const { asset: live } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
  const { asset: trashed } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: live.id, addedById: owner.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: trashed.id, addedById: owner.id });
  await ctx.softDeleteAsset(trashed.id);

  return { space, owner, viewer, live, trashed };
};

describe('H-1: searchAssetBuilder space arms exclude other members trashed assets', () => {
  describe('spaceId arm', () => {
    it('excludes another member trashed asset with withDeleted=true; live sibling present', async () => {
      const { ctx } = setup();
      const { space, viewer, live, trashed } = await seed(ctx);

      const ids = await builtIds({ spaceId: space.id, userIds: [viewer.id], withDeleted: true });

      expect(ids.has(live.id)).toBe(true);
      expect(ids.has(trashed.id)).toBe(false);
    });

    it('owner branch still returns the callers OWN trashed asset with withDeleted=true', async () => {
      const { ctx } = setup();
      const { space, owner, live, trashed } = await seed(ctx);

      const ids = await builtIds({ spaceId: space.id, userIds: [owner.id], withDeleted: true });

      expect(ids.has(live.id)).toBe(true);
      // owner searches their own space scope: their OWN trash stays reachable (owner branch unfiltered)
      expect(ids.has(trashed.id)).toBe(true);
    });

    it('trashedAfter implicitly flips withDeleted but the other-members gate still excludes their trash', async () => {
      const { ctx } = setup();
      const { space, owner, viewer, trashed } = await seed(ctx);

      // trashedAfter adds `asset.deletedAt >= date` (database.ts:745), so it filters to trashed assets
      // and the non-trashed `live` sibling is legitimately absent. The security property under test:
      // the viewer must NOT receive another member's trashed asset via the implicit withDeleted flip...
      const viewerIds = await builtIds({
        spaceId: space.id,
        userIds: [viewer.id],
        trashedAfter: new Date('1970-01-01T00:00:00.000Z'),
      });
      expect(viewerIds.has(trashed.id)).toBe(false);

      // ...while the owner can still reach their OWN trashed asset via trashedAfter (owner branch unfiltered).
      const ownerIds = await builtIds({
        spaceId: space.id,
        userIds: [owner.id],
        trashedAfter: new Date('1970-01-01T00:00:00.000Z'),
      });
      expect(ownerIds.has(trashed.id)).toBe(true);
    });

    it('trashedBefore implicitly flips withDeleted but the other-members gate still excludes their trash', async () => {
      const { ctx } = setup();
      const { space, owner, viewer, trashed } = await seed(ctx);

      // trashedBefore adds `asset.deletedAt <= date` (database.ts:745); like trashedAfter it filters to
      // trashed assets. The viewer must NOT receive another member's trashed asset via the implicit flip...
      const viewerIds = await builtIds({
        spaceId: space.id,
        userIds: [viewer.id],
        trashedBefore: new Date('2999-01-01T00:00:00.000Z'),
      });
      expect(viewerIds.has(trashed.id)).toBe(false);

      // ...while the owner can still reach their OWN trashed asset (owner branch unfiltered).
      const ownerIds = await builtIds({
        spaceId: space.id,
        userIds: [owner.id],
        trashedBefore: new Date('2999-01-01T00:00:00.000Z'),
      });
      expect(ownerIds.has(trashed.id)).toBe(true);
    });
  });

  describe('timelineSpaceIds (withSharedSpaces) arm', () => {
    it('excludes another member trashed asset with withDeleted=true; live sibling present', async () => {
      const { ctx } = setup();
      const { space, viewer, live, trashed } = await seed(ctx);

      const ids = await builtIds({ timelineSpaceIds: [space.id], userIds: [viewer.id], withDeleted: true });

      expect(ids.has(live.id)).toBe(true);
      expect(ids.has(trashed.id)).toBe(false);
    });

    it('owner branch still returns the callers OWN trashed asset with withDeleted=true', async () => {
      const { ctx } = setup();
      const { space, owner, trashed } = await seed(ctx);

      const ids = await builtIds({ timelineSpaceIds: [space.id], userIds: [owner.id], withDeleted: true });

      expect(ids.has(trashed.id)).toBe(true);
    });
  });
});
