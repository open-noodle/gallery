// Slice 2 — behavior tests for the fork-owned Kysely album-scope helpers.
// Exercises spaceAlbumAssetExists / spaceAssetPathBranches against a real DB over
// every access-path combination and edge case (spec §3.2).
import { Kysely } from 'kysely';
import { SharedSpaceRole } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import {
  spaceAlbumAssetExists,
  spaceAssetPathBranches,
  spaceDirectAssetExists,
  spaceLibraryAssetExists,
  type SpaceScope,
} from 'src/utils/shared-space-album-scope';
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

/** Assets whose album leg resolves for the given scope. */
const albumAssetIds = async (
  scope: SpaceScope,
  flags?: { requireShowInTimeline?: boolean; requireAlbumNotDeleted?: boolean; excludeAlbumId?: string },
): Promise<Set<string>> => {
  const rows = await db
    .selectFrom('asset')
    .select('asset.id')
    .where((eb) => spaceAlbumAssetExists(eb, { correlateAssetId: 'asset.id', scope, ...flags }))
    .execute();
  return new Set(rows.map((x) => x.id));
};

/** Assets whose direct-add leg resolves for the given scope. */
const directAssetIds = async (scope: SpaceScope): Promise<Set<string>> => {
  const rows = await db
    .selectFrom('asset')
    .select('asset.id')
    .where((eb) => spaceDirectAssetExists(eb, { correlateAssetId: 'asset.id', scope }))
    .execute();
  return new Set(rows.map((x) => x.id));
};

/** Assets whose library leg resolves for the given scope. */
const libraryAssetIds = async (scope: SpaceScope): Promise<Set<string>> => {
  const rows = await db
    .selectFrom('asset')
    .select('asset.id')
    .where((eb) => spaceLibraryAssetExists(eb, { correlateLibraryId: 'asset.libraryId', scope }))
    .execute();
  return new Set(rows.map((x) => x.id));
};

/** Assets visible via ANY of the three space paths for the given scope. */
const anyPathAssetIds = (scope: SpaceScope, requireShowInTimeline?: boolean) =>
  db
    .selectFrom('asset')
    .select('asset.id')
    .where((eb) =>
      eb.or(
        spaceAssetPathBranches(eb, {
          correlateAssetId: 'asset.id',
          correlateLibraryId: 'asset.libraryId',
          scope,
          requireShowInTimeline,
        }),
      ),
    )
    .execute()
    .then((r) => new Set(r.map((x) => x.id)));

beforeAll(async () => {
  db = await getKyselyDB();
});

describe('spaceAlbumAssetExists — album leg', () => {
  it('selects assets in a linked, non-deleted album (album-only)', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'A' });
    const { asset: a1 } = await ctx.newAsset({ ownerId: user.id });
    const { asset: other } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const ids = await albumAssetIds({ spaceId: space.id });
    expect(ids.has(a1.id)).toBe(true);
    expect(ids.has(other.id)).toBe(false);
  });

  it('excludes a soft-deleted album by default (A1 on) but includes it when requireAlbumNotDeleted=false', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'SD' });
    const { asset: a1 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.softDeleteAlbum(album.id);

    const a1On = await albumAssetIds({ spaceId: space.id });
    const a1Off = await albumAssetIds({ spaceId: space.id }, { requireAlbumNotDeleted: false });
    expect(a1On.has(a1.id)).toBe(false);
    expect(a1Off.has(a1.id)).toBe(true);
  });

  it('honors showInTimeline only when requireShowInTimeline is set', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Hidden' });
    const { asset: a1 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: false });

    const withoutGate = await albumAssetIds({ spaceId: space.id });
    const withGate = await albumAssetIds({ spaceId: space.id }, { requireShowInTimeline: true });
    expect(withoutGate.has(a1.id)).toBe(true);
    expect(withGate.has(a1.id)).toBe(false);
  });

  it('excludeAlbumId ignores the named album but keeps assets reachable via another linked album', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { result: albumA } = await ctx.newAlbum({ ownerId: user.id, albumName: 'A' });
    const { result: albumB } = await ctx.newAlbum({ ownerId: user.id, albumName: 'B' });
    const { asset: x } = await ctx.newAsset({ ownerId: user.id });
    const { asset: y } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: albumA.id, assetId: x.id });
    await ctx.newAlbumAsset({ albumId: albumA.id, assetId: y.id });
    await ctx.newAlbumAsset({ albumId: albumB.id, assetId: x.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: albumA.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: albumB.id });

    const ids = await albumAssetIds({ spaceId: space.id }, { excludeAlbumId: albumA.id });
    expect(ids.has(x.id)).toBe(true); // still reachable via B
    expect(ids.has(y.id)).toBe(false); // only in A, which is excluded
  });

  it('member scope selects only for a member and not a non-member', async () => {
    const { ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'M' });
    const { asset: a1 } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const asMember = await albumAssetIds({ memberUserId: member.id });
    const asStranger = await albumAssetIds({ memberUserId: stranger.id });
    expect(asMember.has(a1.id)).toBe(true);
    expect(asStranger.has(a1.id)).toBe(false);
  });

  it('spaceIds scope selects across multiple linked spaces and dedups by asset id', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { space: s1 } = await ctx.newSharedSpace({ createdById: user.id });
    const { space: s2 } = await ctx.newSharedSpace({ createdById: user.id });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Multi' });
    const { asset: a1 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newSharedSpaceAlbum({ spaceId: s1.id, albumId: album.id });
    await ctx.newSharedSpaceAlbum({ spaceId: s2.id, albumId: album.id });

    const rows = await db
      .selectFrom('asset')
      .select('asset.id')
      .where((eb) => spaceAlbumAssetExists(eb, { correlateAssetId: 'asset.id', scope: { spaceIds: [s1.id, s2.id] } }))
      .execute();
    expect(rows.filter((r) => r.id === a1.id)).toHaveLength(1);
  });

  it('correlates on a non-asset outer column (asset_face.assetId)', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'F' });
    const { asset: a1 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId: a1.id });

    const rows = await db
      .selectFrom('asset_face')
      .select('asset_face.id')
      .where('asset_face.id', '=', faceId)
      .where((eb) =>
        spaceAlbumAssetExists(eb, { correlateAssetId: 'asset_face.assetId', scope: { spaceId: space.id } }),
      )
      .execute();
    expect(rows).toHaveLength(1);
  });
});

const seedRoleFixture = async (ctx: Ctx) => {
  const { user: owner } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const { user: editor } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: 'editor' });
  const { library } = await ctx.newLibrary({ ownerId: owner.id });
  const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'RoleScope' });

  const { asset: direct } = await ctx.newAsset({ ownerId: owner.id });
  const { asset: viaLibrary } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
  const { asset: viaAlbum } = await ctx.newAsset({ ownerId: owner.id });

  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: direct.id, addedById: owner.id });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: viaAlbum.id });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

  return { owner, viewer, editor, direct, viaLibrary, viaAlbum };
};

const roleScopeFor = (userId: string): SpaceScope => ({
  memberUserId: userId,
  memberRole: [SharedSpaceRole.Owner, SharedSpaceRole.Editor],
});

// Slice 3 — M2: an optional `memberRole` filter on the `{ memberUserId }` scope, applied identically
// across all three access-path arms (direct / library / album). Additive: existing `{ memberUserId }`
// callers (no memberRole) must see IDENTICAL results before and after.
describe('SpaceScope.memberRole — role-filtered member scope (M2)', () => {
  it('positive control: without memberRole, a Viewer is reachable on all three arms (existing behavior)', async () => {
    const { ctx } = setup();
    const f = await seedRoleFixture(ctx);

    const direct = await directAssetIds({ memberUserId: f.viewer.id });
    const library = await libraryAssetIds({ memberUserId: f.viewer.id });
    const album = await albumAssetIds({ memberUserId: f.viewer.id });
    expect(direct.has(f.direct.id)).toBe(true);
    expect(library.has(f.viaLibrary.id)).toBe(true);
    expect(album.has(f.viaAlbum.id)).toBe(true);
  });

  it('memberRole [Owner, Editor] excludes a Viewer and includes an Editor on all three arms', async () => {
    const { ctx } = setup();
    const f = await seedRoleFixture(ctx);

    const directAsViewer = await directAssetIds(roleScopeFor(f.viewer.id));
    const directAsEditor = await directAssetIds(roleScopeFor(f.editor.id));
    expect(directAsViewer.has(f.direct.id)).toBe(false);
    expect(directAsEditor.has(f.direct.id)).toBe(true);

    const libraryAsViewer = await libraryAssetIds(roleScopeFor(f.viewer.id));
    const libraryAsEditor = await libraryAssetIds(roleScopeFor(f.editor.id));
    expect(libraryAsViewer.has(f.viaLibrary.id)).toBe(false);
    expect(libraryAsEditor.has(f.viaLibrary.id)).toBe(true);

    const albumAsViewer = await albumAssetIds(roleScopeFor(f.viewer.id));
    const albumAsEditor = await albumAssetIds(roleScopeFor(f.editor.id));
    expect(albumAsViewer.has(f.viaAlbum.id)).toBe(false);
    expect(albumAsEditor.has(f.viaAlbum.id)).toBe(true);
  });
});

const seedAllPaths = async (ctx: Ctx) => {
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  const { library } = await ctx.newLibrary({ ownerId: user.id });
  const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Paths' });

  const { asset: viaAlbum } = await ctx.newAsset({ ownerId: user.id });
  const { asset: viaDirect } = await ctx.newAsset({ ownerId: user.id });
  const { asset: viaLibrary } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
  const { asset: viaAll } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
  const { asset: none } = await ctx.newAsset({ ownerId: user.id });

  await ctx.newAlbumAsset({ albumId: album.id, assetId: viaAlbum.id });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: viaAll.id });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: viaDirect.id, addedById: user.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: viaAll.id, addedById: user.id });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: user.id });
  return { space, viaAlbum, viaDirect, viaLibrary, viaAll, none };
};

describe('spaceAssetPathBranches — the three-path OR', () => {
  it('unions all three paths and excludes assets on none of them', async () => {
    const { ctx } = setup();
    const s = await seedAllPaths(ctx);
    const ids = await anyPathAssetIds({ spaceId: s.space.id });
    expect(ids.has(s.viaAlbum.id)).toBe(true);
    expect(ids.has(s.viaDirect.id)).toBe(true);
    expect(ids.has(s.viaLibrary.id)).toBe(true);
    expect(ids.has(s.viaAll.id)).toBe(true);
    expect(ids.has(s.none.id)).toBe(false);
  });

  it('counts an asset reachable via all three paths exactly once', async () => {
    const { ctx } = setup();
    const s = await seedAllPaths(ctx);
    const rows = await db
      .selectFrom('asset')
      .select('asset.id')
      .where((eb) =>
        eb.or(
          spaceAssetPathBranches(eb, {
            correlateAssetId: 'asset.id',
            correlateLibraryId: 'asset.libraryId',
            scope: { spaceId: s.space.id },
          }),
        ),
      )
      .execute();
    expect(rows.filter((r) => r.id === s.viaAll.id)).toHaveLength(1);
  });
});
