// Slice 6 — behavior tests for `hiddenFromOwnTimeline`, the #1041 predicate builder.
//
// The builder is deliberately NOT wired into any query yet (slice 8 does that); this spec
// exercises it directly against a real DB by compiling a throwaway `asset` query and reading
// back the matching ids, exactly like shared-space-album-scope.medium.spec.ts does for its
// sibling helpers.
import { Kysely } from 'kysely';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { hiddenFromOwnTimeline, type TimelineHiddenScope } from 'src/utils/shared-space-album-scope';
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

const emptyScope: TimelineHiddenScope = {
  hiddenSpaceIds: [],
  hiddenAlbumIds: [],
  hiddenAlbumSpacePairs: [],
  hiddenLibraryIds: [],
};

/** Assets kept by `hiddenFromOwnTimeline(scope)` — i.e. NOT subtracted. */
const keptAssetIds = async (scope: TimelineHiddenScope): Promise<Set<string>> => {
  const rows = await db
    .selectFrom('asset')
    .select('asset.id')
    .where((eb) => {
      const predicate = hiddenFromOwnTimeline(eb, scope, { kind: 'sibling-arm' });
      return predicate ?? eb.lit(true);
    })
    .execute();
  return new Set(rows.map((x) => x.id));
};

/** The compiled SQL text for the predicate alone, for arm-emission assertions. */
const compiledSql = (scope: TimelineHiddenScope): string => {
  const query = db
    .selectFrom('asset')
    .select('asset.id')
    .where((eb) => {
      const predicate = hiddenFromOwnTimeline(eb, scope, { kind: 'sibling-arm' });
      return predicate ?? eb.lit(true);
    });
  return query.compile().sql;
};

beforeAll(async () => {
  db = await getKyselyDB();
});

describe('hiddenFromOwnTimeline', () => {
  it('returns undefined when every list is empty (E6: the collapse)', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });

    // Directly assert on the function's return value via a throwaway eb.
    let sawUndefined = false;
    await db
      .selectFrom('asset')
      .select('asset.id')
      .where((eb) => {
        const predicate = hiddenFromOwnTimeline(eb, emptyScope, { kind: 'sibling-arm' });
        sawUndefined = predicate === undefined;
        return predicate ?? eb.lit(true);
      })
      .execute();
    expect(sawUndefined).toBe(true);

    const kept = await keptAssetIds(emptyScope);
    expect(kept.has(asset.id)).toBe(true);
  });

  it('subtracts an asset in a hidden album (hiddenAlbumIds arm)', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Hidden' });
    const { asset: hidden } = await ctx.newAsset({ ownerId: user.id });
    const { asset: other } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: hidden.id });

    const kept = await keptAssetIds({ ...emptyScope, hiddenAlbumIds: [album.id] });
    expect(kept.has(hidden.id)).toBe(false);
    expect(kept.has(other.id)).toBe(true);
  });

  it('subtracts a contributed asset for its (albumId, spaceId) pair (E7b arm)', async () => {
    const { ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: contributor } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Contrib' });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    const { asset: contributed } = await ctx.newAsset({ ownerId: contributor.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributed.id, spaceId: space.id });

    const kept = await keptAssetIds({
      ...emptyScope,
      hiddenAlbumSpacePairs: [{ albumId: album.id, spaceId: space.id }],
    });
    expect(kept.has(contributed.id)).toBe(false);
  });

  it('does NOT subtract a contribution made to a DIFFERENT space (same albumId, different spaceId)', async () => {
    const { ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: contributor } = await ctx.newUser();
    const { space: hiddenSpace } = await ctx.newSharedSpace({ createdById: owner.id });
    const { space: otherSpace } = await ctx.newSharedSpace({ createdById: owner.id });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Contrib2' });
    await ctx.newSharedSpaceAlbum({ spaceId: hiddenSpace.id, albumId: album.id });
    await ctx.newSharedSpaceAlbum({ spaceId: otherSpace.id, albumId: album.id });
    const { asset: contributed } = await ctx.newAsset({ ownerId: contributor.id });
    // Contribution is made to `otherSpace`, not `hiddenSpace`.
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributed.id, spaceId: otherSpace.id });

    const kept = await keptAssetIds({
      ...emptyScope,
      hiddenAlbumSpacePairs: [{ albumId: album.id, spaceId: hiddenSpace.id }],
    });
    expect(kept.has(contributed.id)).toBe(true);
  });

  it('subtracts an asset directly in a hidden space (hiddenSpaceIds arm)', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { asset: direct } = await ctx.newAsset({ ownerId: user.id });
    const { asset: other } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: direct.id, addedById: user.id });

    const kept = await keptAssetIds({ ...emptyScope, hiddenSpaceIds: [space.id] });
    expect(kept.has(direct.id)).toBe(false);
    expect(kept.has(other.id)).toBe(true);
  });

  it('subtracts an asset whose library is hidden (hiddenLibraryIds arm)', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: user.id });
    const { asset: viaLibrary } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
    const { asset: other } = await ctx.newAsset({ ownerId: user.id });

    const kept = await keptAssetIds({ ...emptyScope, hiddenLibraryIds: [library.id] });
    expect(kept.has(viaLibrary.id)).toBe(false);
    expect(kept.has(other.id)).toBe(true);
  });

  it('E13: keeps assets with libraryId IS NULL when hiddenLibraryIds is non-empty', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: user.id });
    // An asset with NO library at all — the naive `libraryId <> ALL(...)` form is NULL for this
    // row (NULL <> anything is NULL, not true), which would silently subtract it.
    const { asset: noLibrary } = await ctx.newAsset({ ownerId: user.id });

    const kept = await keptAssetIds({ ...emptyScope, hiddenLibraryIds: [library.id] });
    expect(kept.has(noLibrary.id)).toBe(true);
  });

  it('emits only the arms whose list is non-empty (asserted on the generated SQL)', () => {
    const onlyAlbum = compiledSql({ ...emptyScope, hiddenAlbumIds: ['x'] });
    expect(onlyAlbum).toContain('album_asset');
    expect(onlyAlbum).not.toContain('shared_space_asset');
    expect(onlyAlbum).not.toContain('album_space_asset');
    expect(onlyAlbum).not.toContain('"libraryId"');

    const onlySpace = compiledSql({ ...emptyScope, hiddenSpaceIds: ['x'] });
    expect(onlySpace).toContain('shared_space_asset');
    expect(onlySpace).not.toContain('album_asset');
    expect(onlySpace).not.toContain('album_space_asset');
    expect(onlySpace).not.toContain('"libraryId"');

    const onlyLibrary = compiledSql({ ...emptyScope, hiddenLibraryIds: ['x'] });
    expect(onlyLibrary).toContain('"libraryId"');
    expect(onlyLibrary).not.toContain('shared_space_asset');
    expect(onlyLibrary).not.toContain('album_asset');

    const onlyPairs = compiledSql({
      ...emptyScope,
      hiddenAlbumSpacePairs: [{ albumId: 'x', spaceId: 'y' }],
    });
    expect(onlyPairs).toContain('album_space_asset');
    expect(onlyPairs).not.toContain('shared_space_asset');
  });
});
