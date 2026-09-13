/**
 * Medium tests for `AccessRepository.asset.checkSpaceEditAccess` — the space-editor
 * write rule (#734, spec §2).
 *
 * Rule: you may edit an asset if you own it, or if you are Owner/Editor of a space
 * that shows it AND its owner is a member of that space.
 *
 * These tests are the only place S-7/S-8 (Hidden/Locked), S-9 (trashed), S-10/S-10b
 * (offline), S-11 (showInTimeline), S-12 (live-photo motion) and S-13/S-13b/S-13c
 * (wrong-space membership) can fail. A refactor that swaps the bespoke arms for
 * `spaceAssetPathBranches` drops those gates and still compiles — this file is what
 * catches it.
 *
 * The role × reach-path × owner-membership rule itself is covered below by a full
 * `describe.each`/`it.each` cross-product (`checkSpaceEditAccess — the full grant
 * matrix`), not by hand-written cases: reach path ∈ {direct, library, album,
 * contribution} × actor role ∈ {owner, editor, viewer, non-member} × asset-owner
 * membership ∈ {member, not-member}. `contribution` is the #764 cross-owner arm
 * (`album_space_asset`, folded into the album path via `spaceAlbumAssetExists` —
 * see `src/utils/shared-space-album-scope.ts`) and previously had zero coverage at
 * this rule level.
 *
 * Discipline: every deny cell must be non-vacuous. Each reach path's fixture
 * builder is reused, unchanged, by at least one GRANT cell (role ∈ {owner, editor}
 * with a member owner) in the same describe block — so a deny cell can never pass
 * merely because the asset was unreachable in the first place; it can only pass
 * because the specific gate (role, or owner membership) under test denied it. This
 * is exactly the bug item 1 of the #992 audit found in the sibling service spec:
 * a VIEWER-denial fixture that never made the asset editor-reachable at all.
 */
import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [AccessRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });
  return { ctx, accessRepo: ctx.get(AccessRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const markOffline = (assetId: string) =>
  defaultDatabase.updateTable('asset').set({ isOffline: true }).where('id', '=', assetId).execute();

const trash = (assetId: string) =>
  defaultDatabase.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', assetId).execute();

/** Anna (Editor) + Bob (Member) in one space. */
const newSpaceWithEditorAndMember = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user: anna } = await ctx.newUser();
  const { user: bob } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: bob.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: bob.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: anna.id, role: 'editor' });
  return { anna, bob, space };
};

// ---------------------------------------------------------------------------
// The full grant matrix: reach path × actor role × owner membership.
// ---------------------------------------------------------------------------

type ReachPath = 'direct' | 'library' | 'album' | 'contribution';
type ActorRole = 'owner' | 'editor' | 'viewer' | 'non-member';
type OwnerMembership = 'member' | 'not-member';

/**
 * Builds the asset and its single reach path into `spaceId`, owned by `ownerId`.
 * Each builder inserts exactly the rows that path needs — nothing shared with the
 * other paths — so a deny result can only be explained by the role/membership gate
 * under test, never by an unrelated missing row.
 */
const reachPathBuilders: Record<
  ReachPath,
  (ctx: ReturnType<typeof setup>['ctx'], args: { spaceId: string; ownerId: string }) => Promise<{ assetId: string }>
> = {
  direct: async (ctx, { spaceId, ownerId }) => {
    const { asset } = await ctx.newAsset({ ownerId, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId, assetId: asset.id });
    return { assetId: asset.id };
  },
  library: async (ctx, { spaceId, ownerId }) => {
    const { library } = await ctx.newLibrary({ ownerId });
    const { asset } = await ctx.newAsset({ ownerId, libraryId: library.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceLibrary({ spaceId, libraryId: library.id });
    return { assetId: asset.id };
  },
  album: async (ctx, { spaceId, ownerId }) => {
    const { result: album } = await ctx.newAlbum({ ownerId, albumName: 'Matrix album' });
    const { asset } = await ctx.newAsset({ ownerId, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId, albumId: album.id });
    return { assetId: asset.id };
  },
  // #764 cross-owner contribution: the asset is deliberately never added to the album
  // owner's own `album_asset` rows — its only path into the linked album is
  // `album_space_asset`, so this exercises `spaceContributedAssetExists` in isolation.
  contribution: async (ctx, { spaceId, ownerId }) => {
    const { user: albumOwner } = await ctx.newUser();
    const { result: album } = await ctx.newAlbum({ ownerId: albumOwner.id, albumName: 'Matrix contribution' });
    const { asset } = await ctx.newAsset({ ownerId, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAlbum({ spaceId, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId });
    return { assetId: asset.id };
  },
};

const reachPaths: ReachPath[] = ['direct', 'library', 'album', 'contribution'];
const actorRoles: ActorRole[] = ['owner', 'editor', 'viewer', 'non-member'];
const ownerMemberships: OwnerMembership[] = ['member', 'not-member'];

describe('checkSpaceEditAccess — the full grant matrix (reach path × actor role × owner membership)', () => {
  describe.each(reachPaths)('reach path: %s', (reachPath) => {
    it.each(actorRoles.flatMap((role) => ownerMemberships.map((ownerMembership) => [role, ownerMembership] as const)))(
      'actor role=%s, owner membership=%s',
      async (actorRole, ownerMembership) => {
        const { ctx, accessRepo } = setup();
        const { user: owner } = await ctx.newUser();
        const { user: actor } = await ctx.newUser();
        const { space } = await ctx.newSharedSpace({ createdById: owner.id });

        if (actorRole !== 'non-member') {
          await ctx.newSharedSpaceMember({ spaceId: space.id, userId: actor.id, role: actorRole });
        }

        if (ownerMembership === 'member') {
          // Role is irrelevant to the owner-membership gate — 'viewer' proves that: the
          // asset owner never needs edit rights of their own for a fellow editor to act.
          await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'viewer' });
        }

        const { assetId } = await reachPathBuilders[reachPath](ctx, { spaceId: space.id, ownerId: owner.id });

        const expectGranted = (actorRole === 'owner' || actorRole === 'editor') && ownerMembership === 'member';

        const allowed = await accessRepo.asset.checkSpaceEditAccess(actor.id, new Set([assetId]));

        expect(allowed).toEqual(expectGranted ? new Set([assetId]) : new Set());
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Gates the matrix above cannot express — visibility, lifecycle, timeline display,
// live-photo resolution, and wrong-space membership binding.
// ---------------------------------------------------------------------------

describe('checkSpaceEditAccess — gates that must survive any refactor', () => {
  it.each([
    ['S-7 Hidden', AssetVisibility.Hidden],
    ['S-8 Locked', AssetVisibility.Locked],
  ])('%s: denies a non-space-shareable visibility on every path', async (_label, visibility) => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);

    const { asset: direct } = await ctx.newAsset({ ownerId: bob.id, visibility });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: direct.id });

    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: 'V' });
    const { asset: viaAlbum } = await ctx.newAsset({ ownerId: bob.id, visibility });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: viaAlbum.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([direct.id, viaAlbum.id]));

    expect(allowed).toEqual(new Set());
  });

  it('S-9: denies a trashed asset', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
    await trash(asset.id);

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });

  it('S-10: denies an offline library asset', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { library } = await ctx.newLibrary({ ownerId: bob.id });
    const { asset } = await ctx.newAsset({
      ownerId: bob.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    await markOffline(asset.id);

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });

  it('S-10b: denies an offline asset reached via the album path', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { library } = await ctx.newLibrary({ ownerId: bob.id });
    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: 'OfflineViaAlbum' });
    const { asset } = await ctx.newAsset({
      ownerId: bob.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await markOffline(asset.id);

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });

  it('S-11: the album arm ignores showInTimeline', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: 'Quiet' });
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: false });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set([asset.id]));
  });

  it('S-12: resolves the motion half of a live photo', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { asset: motion } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    const { asset: still } = await ctx.newAsset({
      ownerId: bob.id,
      visibility: AssetVisibility.Timeline,
      livePhotoVideoId: motion.id,
    });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: still.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([motion.id]));

    expect(allowed).toEqual(new Set([motion.id]));
  });

  it('S-13: membership binds to the space granting the role, not to any space', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space: spaceA } = await newSpaceWithEditorAndMember(ctx);
    // Bob leaves A; he is a member of B only. His asset still reaches A via a linked album.
    await defaultDatabase
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', spaceA.id)
      .where('userId', '=', bob.id)
      .execute();
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: bob.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: bob.id, role: 'owner' });

    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: 'Cross' });
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: spaceA.id, albumId: album.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });

  it('S-13b: the DIRECT arm binds membership to the space granting the role, not to any space', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space: spaceA } = await newSpaceWithEditorAndMember(ctx);
    // Bob leaves A; he is a member of B only. His asset is still direct-added to A.
    await defaultDatabase
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', spaceA.id)
      .where('userId', '=', bob.id)
      .execute();
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: bob.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: bob.id, role: 'owner' });

    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: spaceA.id, assetId: asset.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });

  it('S-13c: the LIBRARY arm binds membership to the space granting the role, not to any space', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space: spaceA } = await newSpaceWithEditorAndMember(ctx);
    // Bob leaves A; he is a member of B only. His library asset is still linked into A.
    await defaultDatabase
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', spaceA.id)
      .where('userId', '=', bob.id)
      .execute();
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: bob.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: bob.id, role: 'owner' });

    const { library } = await ctx.newLibrary({ ownerId: bob.id });
    const { asset } = await ctx.newAsset({
      ownerId: bob.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceA.id, libraryId: library.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });
});
