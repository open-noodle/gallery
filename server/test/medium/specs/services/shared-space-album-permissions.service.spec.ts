import { Kysely } from 'kysely';
import { AlbumUserRole, Permission } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AlbumUserRepository } from 'src/repositories/album-user.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { SharedSpaceService } from 'src/services/shared-space.service';
import { checkAccess } from 'src/utils/access';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const result = newMediumService(SharedSpaceService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      AlbumUserRepository,
      AssetRepository,
      SharedSpaceRepository,
      UserRepository,
    ],
    mock: [EventRepository, LoggingRepository, JobRepository, StorageRepository],
  });
  // Slice 9: unlinkAlbum/removeMember/remove now enqueue the post-commit grant-reconcile job
  // (queueAlbumGrantReconcile → jobRepository.queue). JobRepository is auto-mocked (unimplemented calls
  // throw), so give queue a no-op resolution for the permission-matrix tests that exercise those paths.
  result.ctx.getMock(JobRepository).queue.mockResolvedValue(void 0);
  return result;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

// ---------------------------------------------------------------------------
// Permission-matrix spec: Space Albums Phase 1 — READ
// ---------------------------------------------------------------------------

const authFromUser = (actor: { id: string; email: string }) =>
  factory.auth({ user: { id: actor.id, email: actor.email } });

describe('SharedSpaceService — space-album permission matrix', () => {
  /**
   * Fixture world (created once in beforeAll, shared across all Grid tests):
   *
   *  Space S  — links album A
   *  Space S2 — links album C
   *  Album B  — not linked to any space
   *
   *  Actors:
   *    spaceOwner  — owner member of S (non-admin user)
   *    spaceEditor — editor member of S
   *    spaceViewer — viewer member of S
   *    nonMember   — no membership anywhere
   *    albumOwner  — album_user owner on A, NOT in S
   *    albumEditor — album_user editor on A, NOT in S
   *    albumViewer — album_user viewer on A, NOT in S
   *    crossEditor — editor of S2, NOT in S
   *
   *  assetInA — an asset inside album A (owned by albumOwner)
   */

  let world: {
    spaceS: string;
    spaceS2: string;
    albumA: string;
    albumB: string;
    albumC: string;
    assetInA: string;
    actors: Record<string, { id: string; email: string }>;
  };

  let accessRepo: AccessRepository;
  let spaceRepo: SharedSpaceRepository;

  const authOf = (actorName: string) => {
    const actor = world.actors[actorName];
    if (!actor) {
      throw new Error(`Unknown actor: ${actorName}`);
    }
    return factory.auth({ user: { id: actor.id, email: actor.email } });
  };

  beforeAll(async () => {
    const { ctx } = setup();

    accessRepo = ctx.get(AccessRepository);
    spaceRepo = ctx.get(SharedSpaceRepository);

    // --- Create actors ---
    const { user: spaceOwnerUser } = await ctx.newUser();
    const { user: spaceEditorUser } = await ctx.newUser();
    const { user: spaceViewerUser } = await ctx.newUser();
    const { user: nonMemberUser } = await ctx.newUser();
    const { user: albumOwnerUser } = await ctx.newUser();
    const { user: albumEditorUser } = await ctx.newUser();
    const { user: albumViewerUser } = await ctx.newUser();
    const { user: crossEditorUser } = await ctx.newUser();

    // --- Create spaces ---
    const { space: spaceS } = await ctx.newSharedSpace({ createdById: spaceOwnerUser.id });
    const { space: spaceS2 } = await ctx.newSharedSpace({ createdById: crossEditorUser.id });

    // --- Memberships for S ---
    await ctx.newSharedSpaceMember({ spaceId: spaceS.id, userId: spaceOwnerUser.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: spaceS.id, userId: spaceEditorUser.id, role: 'editor' });
    await ctx.newSharedSpaceMember({ spaceId: spaceS.id, userId: spaceViewerUser.id, role: 'viewer' });

    // --- Memberships for S2 ---
    await ctx.newSharedSpaceMember({ spaceId: spaceS2.id, userId: crossEditorUser.id, role: 'editor' });

    // --- Create albums ---
    // Album A — owned by albumOwner, additional album_user members
    const { result: albumA } = await ctx.newAlbum({ ownerId: albumOwnerUser.id, albumName: 'Album A' });
    // Album B — unlinked
    const { result: albumB } = await ctx.newAlbum({ ownerId: albumOwnerUser.id, albumName: 'Album B' });
    // Album C — linked to S2
    const { result: albumC } = await ctx.newAlbum({ ownerId: crossEditorUser.id, albumName: 'Album C' });

    // album_user rows on A for albumEditor and albumViewer
    await ctx.newAlbumUser({ albumId: albumA.id, userId: albumEditorUser.id, role: AlbumUserRole.Editor });
    await ctx.newAlbumUser({ albumId: albumA.id, userId: albumViewerUser.id, role: AlbumUserRole.Viewer });

    // --- Create asset inside A ---
    const { asset: assetInA } = await ctx.newAsset({ ownerId: albumOwnerUser.id });
    await ctx.newAlbumAsset({ albumId: albumA.id, assetId: assetInA.id });

    // --- Link A to S, C to S2 ---
    await spaceRepo.addAlbum({ spaceId: spaceS.id, albumId: albumA.id, addedById: spaceOwnerUser.id });
    await spaceRepo.addAlbum({ spaceId: spaceS2.id, albumId: albumC.id, addedById: crossEditorUser.id });

    world = {
      spaceS: spaceS.id,
      spaceS2: spaceS2.id,
      albumA: albumA.id,
      albumB: albumB.id,
      albumC: albumC.id,
      assetInA: assetInA.id,
      actors: {
        spaceOwner: spaceOwnerUser,
        spaceEditor: spaceEditorUser,
        spaceViewer: spaceViewerUser,
        nonMember: nonMemberUser,
        albumOwner: albumOwnerUser,
        albumEditor: albumEditorUser,
        albumViewer: albumViewerUser,
        crossEditor: crossEditorUser,
      },
    };
  });

  // =========================================================================
  // Grid R — READ album entity (AlbumRead) via space membership
  // =========================================================================

  describe('Grid R — READ album entity (AlbumRead) via space membership', () => {
    it.each([
      ['spaceOwner', true],
      ['spaceEditor', true],
      ['spaceViewer', true],
      ['nonMember', false],
      ['crossEditor', false], // member of S2; A not linked to S2
    ] as const)('%s checkAccess(AlbumRead, A) → %s', async (actor, allowed) => {
      const result = await checkAccess(accessRepo, {
        auth: authOf(actor),
        permission: Permission.AlbumRead,
        ids: new Set([world.albumA]),
      });
      expect(result.has(world.albumA)).toBe(allowed);
    });

    it('unlinked album B is NOT readable via the space grant', async () => {
      const result = await checkAccess(accessRepo, {
        auth: authOf('spaceViewer'),
        permission: Permission.AlbumRead,
        ids: new Set([world.albumB]),
      });
      expect(result.has(world.albumB)).toBe(false);
    });

    it('read grant does NOT widen write: spaceViewer cannot AlbumAssetCreate on A', async () => {
      const result = await checkAccess(accessRepo, {
        auth: authOf('spaceViewer'),
        permission: Permission.AlbumAssetCreate,
        ids: new Set([world.albumA]),
      });
      expect(result.has(world.albumA)).toBe(false);
    });

    it('AlbumDownload is granted to a space viewer for a linked album', async () => {
      const result = await checkAccess(accessRepo, {
        auth: authOf('spaceViewer'),
        permission: Permission.AlbumDownload,
        ids: new Set([world.albumA]),
      });
      expect(result.has(world.albumA)).toBe(true);
    });
  });

  // =========================================================================
  // Grid 1 — READ asset in album A via full AssetRead authorization chain
  // =========================================================================

  describe('Grid 1 — READ asset in album A (full AssetRead authorization)', () => {
    it.each([
      ['spaceOwner', true],
      ['spaceEditor', true],
      ['spaceViewer', true],
      ['nonMember', false],
      ['albumOwner', true],
      ['albumEditor', true],
      ['albumViewer', true],
      ['crossEditor', false],
    ] as const)('%s read A.asset → allowed=%s', async (actor, allowed) => {
      const allowedIds = await checkAccess(accessRepo, {
        auth: authOf(actor),
        permission: Permission.AssetRead,
        ids: new Set([world.assetInA]),
      });
      expect(allowedIds.has(world.assetInA)).toBe(allowed);
    });

    it('checkSpaceAccess (space-album branch) grants space members, denies non/cross', async () => {
      for (const [actor, expected] of [
        ['spaceOwner', true],
        ['spaceEditor', true],
        ['spaceViewer', true],
        ['nonMember', false],
        ['crossEditor', false],
      ] as const) {
        const r = await accessRepo.asset.checkSpaceAccess(world.actors[actor].id, new Set([world.assetInA]));
        expect(r.has(world.assetInA)).toBe(expected);
      }
    });
  });

  // =========================================================================
  // Grid 2 — WRITE add/remove assets in album A (space-linked write)
  // =========================================================================

  describe('Grid 2 — WRITE add/remove assets in album A (space-linked write)', () => {
    it.each([
      ['spaceOwner', true],
      ['spaceEditor', true],
      ['spaceViewer', false], // Viewer is read-only
      ['nonMember', false],
      ['crossEditor', false], // edits S2; A not linked there
      ['albumOwner', false], // album membership ⊥ space membership
      ['albumViewer', false], // album membership ⊥ space membership
    ] as const)('%s space-linked write to A → allowed=%s', async (actor, allowed) => {
      const result = await accessRepo.album.checkSpaceLinkedAlbumAccess(
        world.actors[actor].id,
        new Set([world.albumA]),
      );
      expect(result.has(world.albumA)).toBe(allowed);
    });

    it('spaceEditor cannot space-link-write to unlinked album B', async () => {
      const result = await accessRepo.album.checkSpaceLinkedAlbumAccess(
        world.actors.spaceEditor.id,
        new Set([world.albumB]),
      );
      expect(result.has(world.albumB)).toBe(false);
    });

    it('albumEditor gets AlbumAssetCreate via album_user path (independent of space membership)', async () => {
      const allowedIds = await checkAccess(accessRepo, {
        auth: authOf('albumEditor'),
        permission: Permission.AlbumAssetCreate,
        ids: new Set([world.albumA]),
      });
      expect(allowedIds.has(world.albumA)).toBe(true);
    });
  });

  // =========================================================================
  // Grid 3 — LINK album into a space (Editor+, non-admin; owns/edits album)
  // =========================================================================

  describe('Grid 3 — LINK album into a space (Editor+ AND owns/edits album; NOT admin-gated)', () => {
    let ctx3: ReturnType<typeof setup>['ctx'];
    let sut3: ReturnType<typeof setup>['sut'];
    let spaceS3: string;
    let spaceOwner3: { id: string; email: string };
    let spaceEditor3: { id: string; email: string };
    let spaceViewer3: { id: string; email: string };
    let ownedByOwner3: string;
    let ownedByEditor3: string;
    let ownedByViewer3: string;
    let viewerOnlyAlbum3: string;
    let albumAlreadyLinked3: string;

    beforeAll(async () => {
      const { ctx, sut } = setup();
      ctx3 = ctx;
      sut3 = sut;

      const { user: ownerUser } = await ctx3.newUser();
      const { user: editorUser } = await ctx3.newUser();
      const { user: viewerUser } = await ctx3.newUser();
      const { user: otherUser } = await ctx3.newUser();

      spaceOwner3 = ownerUser;
      spaceEditor3 = editorUser;
      spaceViewer3 = viewerUser;

      const { space } = await ctx3.newSharedSpace({ createdById: ownerUser.id, faceRecognitionEnabled: false });
      spaceS3 = space.id;

      await ctx3.newSharedSpaceMember({ spaceId: spaceS3, userId: ownerUser.id, role: 'owner' });
      await ctx3.newSharedSpaceMember({ spaceId: spaceS3, userId: editorUser.id, role: 'editor' });
      await ctx3.newSharedSpaceMember({ spaceId: spaceS3, userId: viewerUser.id, role: 'viewer' });

      const { result: alb1 } = await ctx3.newAlbum({ ownerId: ownerUser.id, albumName: 'G3-owner-album' });
      ownedByOwner3 = alb1.id;

      const { result: alb2 } = await ctx3.newAlbum({ ownerId: editorUser.id, albumName: 'G3-editor-album' });
      ownedByEditor3 = alb2.id;

      const { result: alb3 } = await ctx3.newAlbum({ ownerId: viewerUser.id, albumName: 'G3-viewer-album' });
      ownedByViewer3 = alb3.id;

      // An album owned by otherUser; spaceEditor3 is only a Viewer on it
      const { result: alb4 } = await ctx3.newAlbum({ ownerId: otherUser.id, albumName: 'G3-viewer-only-album' });
      viewerOnlyAlbum3 = alb4.id;
      await ctx3.newAlbumUser({ albumId: viewerOnlyAlbum3, userId: editorUser.id, role: AlbumUserRole.Viewer });

      // An album pre-linked to the space (for idempotency test)
      const { result: alb5 } = await ctx3.newAlbum({ ownerId: ownerUser.id, albumName: 'G3-pre-linked-album' });
      albumAlreadyLinked3 = alb5.id;
      await ctx3
        .get(SharedSpaceRepository)
        .addAlbum({ spaceId: spaceS3, albumId: albumAlreadyLinked3, addedById: ownerUser.id });
    });

    it('non-admin spaceOwner who owns the album → ALLOW', async () => {
      expect(spaceOwner3).toBeDefined();
      // ctx3.newUser() always creates non-admin users (isAdmin: false)
      await expect(sut3.linkAlbum(authFromUser(spaceOwner3), spaceS3, ownedByOwner3)).resolves.toBeUndefined();
    });

    it('non-admin spaceEditor who owns the album → ALLOW (divergence from libraries)', async () => {
      await expect(sut3.linkAlbum(authFromUser(spaceEditor3), spaceS3, ownedByEditor3)).resolves.toBeUndefined();
    });

    it('spaceEditor who is only album_user-VIEWER on the album → DENY (cannot re-share read-only)', async () => {
      await expect(sut3.linkAlbum(authFromUser(spaceEditor3), spaceS3, viewerOnlyAlbum3)).rejects.toThrow();
    });

    it('spaceViewer who owns the album → DENY (Viewer cannot manage links)', async () => {
      await expect(sut3.linkAlbum(authFromUser(spaceViewer3), spaceS3, ownedByViewer3)).rejects.toThrow();
    });

    it('re-link already-linked album → idempotent no-op (no throw, no duplicate row)', async () => {
      await sut3.linkAlbum(authFromUser(spaceOwner3), spaceS3, albumAlreadyLinked3);
      await sut3.linkAlbum(authFromUser(spaceOwner3), spaceS3, albumAlreadyLinked3);
      const links = await ctx3.get(SharedSpaceRepository).getLinkedAlbums(spaceS3);
      expect(links.filter((l) => l.id === albumAlreadyLinked3)).toHaveLength(1);
    });
  });

  // =========================================================================
  // Grid 4 — UNLINK album from a space (Editor+; no admin gate)
  // =========================================================================

  describe('Grid 4 — UNLINK album from a space (Editor+; no admin gate)', () => {
    it('spaceOwner → ALLOW', async () => {
      const { ctx, sut } = setup();
      const { user: o } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: o.id, faceRecognitionEnabled: false });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: o.id, role: 'owner' });
      const { result: album } = await ctx.newAlbum({ ownerId: o.id, albumName: 'G4-unlink-owner' });
      await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: o.id });
      await expect(sut.unlinkAlbum(authFromUser(o), space.id, album.id)).resolves.toBeUndefined();
    });

    it('spaceEditor → ALLOW', async () => {
      const { ctx, sut } = setup();
      const { user: o } = await ctx.newUser();
      const { user: e } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: o.id, faceRecognitionEnabled: false });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: o.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: e.id, role: 'editor' });
      const { result: album } = await ctx.newAlbum({ ownerId: o.id, albumName: 'G4-unlink-editor' });
      await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: o.id });
      await expect(sut.unlinkAlbum(authFromUser(e), space.id, album.id)).resolves.toBeUndefined();
    });

    it('spaceViewer → DENY', async () => {
      const { ctx, sut } = setup();
      const { user: o } = await ctx.newUser();
      const { user: v } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: o.id, faceRecognitionEnabled: false });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: o.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: v.id, role: 'viewer' });
      const { result: album } = await ctx.newAlbum({ ownerId: o.id, albumName: 'G4-deny-viewer' });
      await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: o.id });
      await expect(sut.unlinkAlbum(authFromUser(v), space.id, album.id)).rejects.toThrow();
    });

    it('nonMember → DENY', async () => {
      const { ctx, sut } = setup();
      const { user: o } = await ctx.newUser();
      const { user: nm } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: o.id, faceRecognitionEnabled: false });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: o.id, role: 'owner' });
      const { result: album } = await ctx.newAlbum({ ownerId: o.id, albumName: 'G4-deny-nonmember' });
      await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: o.id });
      await expect(sut.unlinkAlbum(authFromUser(nm), space.id, album.id)).rejects.toThrow();
    });
  });

  // =========================================================================
  // Grid 4b — TOGGLE showInTimeline on a linked album (Editor+; no admin gate)
  // =========================================================================

  describe('Grid 4b — TOGGLE showInTimeline on linked album (Editor+; no admin gate)', () => {
    it('spaceOwner → ALLOW (flag persists, verified via getLinkedAlbums)', async () => {
      const { ctx, sut } = setup();
      const { user: o } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: o.id, faceRecognitionEnabled: false });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: o.id, role: 'owner' });
      const { result: album } = await ctx.newAlbum({ ownerId: o.id, albumName: 'G4b-toggle-owner' });
      await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: o.id });

      await expect(
        sut.updateAlbumLink(authFromUser(o), space.id, album.id, { showInTimeline: false }),
      ).resolves.toBeUndefined();

      const links = await sut.getLinkedAlbums(authFromUser(o), space.id);
      expect(links).toHaveLength(1);
      expect(links[0].id).toBe(album.id);
      expect(links[0].showInTimeline).toBe(false);
    });

    it('spaceEditor → ALLOW', async () => {
      const { ctx, sut } = setup();
      const { user: o } = await ctx.newUser();
      const { user: e } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: o.id, faceRecognitionEnabled: false });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: o.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: e.id, role: 'editor' });
      const { result: album } = await ctx.newAlbum({ ownerId: o.id, albumName: 'G4b-toggle-editor' });
      await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: o.id });

      await expect(
        sut.updateAlbumLink(authFromUser(e), space.id, album.id, { showInTimeline: false }),
      ).resolves.toBeUndefined();
    });

    it('spaceViewer → DENY', async () => {
      const { ctx, sut } = setup();
      const { user: o } = await ctx.newUser();
      const { user: v } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: o.id, faceRecognitionEnabled: false });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: o.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: v.id, role: 'viewer' });
      const { result: album } = await ctx.newAlbum({ ownerId: o.id, albumName: 'G4b-toggle-viewer' });
      await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: o.id });

      await expect(
        sut.updateAlbumLink(authFromUser(v), space.id, album.id, { showInTimeline: false }),
      ).rejects.toThrow();
    });

    it('nonMember → DENY', async () => {
      const { ctx, sut } = setup();
      const { user: o } = await ctx.newUser();
      const { user: nm } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: o.id, faceRecognitionEnabled: false });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: o.id, role: 'owner' });
      const { result: album } = await ctx.newAlbum({ ownerId: o.id, albumName: 'G4b-toggle-nonmember' });
      await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: o.id });

      await expect(
        sut.updateAlbumLink(authFromUser(nm), space.id, album.id, { showInTimeline: false }),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // Grid 5 — DELETE the album (album owner only; space link does NOT grant)
  // =========================================================================

  describe('Grid 5 — DELETE the album (album owner only; space does NOT grant)', () => {
    it.each([
      // albumOwner has an album_user row with role=Owner on album A → ALLOW
      ['albumOwner', true],
      // album_user non-owner roles do NOT grant AlbumDelete
      ['albumEditor', false],
      ['albumViewer', false],
      // Space members are NOT album owners → DENY even for owner/editor of S
      ['spaceOwner', false],
      ['spaceEditor', false],
      ['spaceViewer', false],
      ['nonMember', false],
    ] as const)('%s AlbumDelete for albumA → allowed=%s', async (actor, allowed) => {
      const allowedIds = await checkAccess(accessRepo, {
        auth: authOf(actor),
        permission: Permission.AlbumDelete,
        ids: new Set([world.albumA]),
      });
      expect(allowedIds.has(world.albumA)).toBe(allowed);
    });
  });

  // =========================================================================
  // Grid 7 — linking album writes NO album_user rows for space members
  // =========================================================================

  describe('Grid 7 — space-album link writes no album_user rows for space members', () => {
    it('spaceOwner/spaceEditor/spaceViewer have no album_user rows for albumA after linking', async () => {
      // After the fixture setup (album A already linked to S), query album_user
      // and confirm no space-member user ids appear — only genuine album_user actors.
      const spaceActorIds = [world.actors.spaceOwner.id, world.actors.spaceEditor.id, world.actors.spaceViewer.id];

      const rows = await defaultDatabase
        .selectFrom('album_user')
        .select('userId')
        .where('albumId', '=', world.albumA)
        .where('userId', 'in', spaceActorIds)
        .execute();

      expect(rows).toHaveLength(0);
    });

    it('only genuine album_user actors appear in album_user for albumA', async () => {
      const rows = await defaultDatabase
        .selectFrom('album_user')
        .select(['userId', 'role'])
        .where('albumId', '=', world.albumA)
        .orderBy('role')
        .execute();

      const userIds = rows.map((r) => r.userId).sort();
      const expectedIds = [world.actors.albumOwner.id, world.actors.albumEditor.id, world.actors.albumViewer.id].sort();

      expect(userIds).toEqual(expectedIds);
    });
  });

  // =========================================================================
  // Cross-layer SET-EQUALITY GUARD
  // (pins checkSpaceAccess output against independently-derived expected set)
  // =========================================================================

  describe('Set-equality guard — checkSpaceAccess returns exactly the fixture-seeded asset set', () => {
    it('spaceViewer checkSpaceAccess returns exactly {assetInA} and excludes out-of-space asset', async () => {
      // Create an extra asset that is NOT in any space S path — never added to space
      // or any linked album. This strengthens the guard: if the predicate drifts and
      // returns too many, the assertion catches it.
      const { ctx: guardCtx } = setup();
      const { user: outsideOwner } = await guardCtx.newUser();
      const { asset: outsideAsset } = await guardCtx.newAsset({ ownerId: outsideOwner.id });

      // The independently-derived expected set: only assetInA is reachable by
      // spaceViewer via S → shared_space_album link → album A → album_asset.
      // outsideAsset has no path into S.
      const allCandidates = new Set([world.assetInA, outsideAsset.id]);

      const result = await accessRepo.asset.checkSpaceAccess(world.actors.spaceViewer.id, allCandidates);

      expect([...result].sort()).toEqual([world.assetInA]);
    });

    it('spaceOwner checkSpaceAccess for all fixture assets returns exactly {assetInA}', async () => {
      // Same predicate, different actor (spaceOwner). Expected set is the same
      // since album A is linked to S and assetInA is in album A.
      const result = await accessRepo.asset.checkSpaceAccess(world.actors.spaceOwner.id, new Set([world.assetInA]));

      expect([...result].sort()).toEqual([world.assetInA]);
    });

    it('nonMember checkSpaceAccess returns empty set (no drift toward public access)', async () => {
      const result = await accessRepo.asset.checkSpaceAccess(world.actors.nonMember.id, new Set([world.assetInA]));

      expect([...result]).toHaveLength(0);
    });

    it('crossEditor (member of S2 only) cannot reach assetInA via checkSpaceAccess', async () => {
      // crossEditor is editor of S2 (which links album C), but NOT a member of S.
      // assetInA is only in album A which is linked to S. No path exists.
      const result = await accessRepo.asset.checkSpaceAccess(world.actors.crossEditor.id, new Set([world.assetInA]));

      expect([...result]).toHaveLength(0);
    });
  });

  // =========================================================================
  // Grid 6 — combined write-wins: album_user editor + space-viewer → WRITE
  // =========================================================================

  describe('Grid 6 — combined paths: album_user editor AND space-viewer → write wins', () => {
    it('user who is album_user Editor on A AND a Viewer of S gets AlbumAssetCreate (editor path wins)', async () => {
      // A user who holds BOTH an album_user Editor row on album A AND is a
      // space-Viewer of space S must get AlbumAssetCreate — the album-editor
      // path grants write; the space-viewer status does NOT subtract.
      const { ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: combinedUser } = await ctx.newUser();

      const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      // combinedUser is a Viewer of the space
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: combinedUser.id, role: 'viewer' });

      const { result: albumA } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'G6-combined-album' });
      // combinedUser is also an Editor on the album
      await ctx.newAlbumUser({ albumId: albumA.id, userId: combinedUser.id, role: AlbumUserRole.Editor });

      // Link the album to the space
      await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: albumA.id, addedById: owner.id });

      const combinedAuth = factory.auth({ user: { id: combinedUser.id, email: combinedUser.email } });

      const allowedIds = await checkAccess(ctx.get(AccessRepository), {
        auth: combinedAuth,
        permission: Permission.AlbumAssetCreate,
        ids: new Set([albumA.id]),
      });
      expect(allowedIds.has(albumA.id)).toBe(true);
    });
  });

  // =========================================================================
  // Grid 6c — soft-deleted album: assets no longer readable via space path
  // =========================================================================

  describe('Grid 6c — soft-deleted album: assets no longer readable via space path', () => {
    it('after soft-deleting linked album A, spaceViewer cannot read assetInA via checkSpaceAccess', async () => {
      // Use an isolated setup so we don't mutate the shared world fixture.
      const { ctx } = setup();
      const isolatedAccessRepo = ctx.get(AccessRepository);
      const isolatedSpaceRepo = ctx.get(SharedSpaceRepository);

      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });

      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'G6c-soft-deleted-album' });
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
      await isolatedSpaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

      // Before soft-delete: member can read the asset
      const before = await isolatedAccessRepo.asset.checkSpaceAccess(member.id, new Set([asset.id]));
      expect(before.has(asset.id)).toBe(true);

      // Soft-delete the album (album.deletedAt = now(), link row survives)
      await ctx.softDeleteAlbum(album.id);

      // After soft-delete: asset must NOT be readable via the space-album path
      const after = await isolatedAccessRepo.asset.checkSpaceAccess(member.id, new Set([asset.id]));
      expect(after.has(asset.id)).toBe(false);
    });

    it('after soft-deleting linked album A, checkSpaceAccessForSpace also denies the asset', async () => {
      const { ctx } = setup();
      const isolatedAccessRepo = ctx.get(AccessRepository);
      const isolatedSpaceRepo = ctx.get(SharedSpaceRepository);

      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });

      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'G6c-checkSpaceAccessForSpace' });
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
      await isolatedSpaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

      // Before soft-delete: accessible via checkSpaceAccessForSpace
      const before = await isolatedAccessRepo.asset.checkSpaceAccessForSpace(member.id, space.id, new Set([asset.id]));
      expect(before.has(asset.id)).toBe(true);

      // Soft-delete the album
      await ctx.softDeleteAlbum(album.id);

      // After soft-delete: must be denied
      const after = await isolatedAccessRepo.asset.checkSpaceAccessForSpace(member.id, space.id, new Set([asset.id]));
      expect(after.has(asset.id)).toBe(false);
    });
  });

  // =========================================================================
  // Grid 6b — multi-path READ (direct asset + album paths, unlink behaviour)
  // =========================================================================

  describe('Grid 6b — multi-path READ (direct-add vs album-link)', () => {
    it('asset directly in S stays readable after removing its album link from S', async () => {
      const { ctx } = setup();
      const spaceAccessRepo = ctx.get(AccessRepository);
      const spaceAccessSpaceRepo = ctx.get(SharedSpaceRepository);

      // Isolated actors + space + album + asset
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });

      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'G6-album' });
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      // Add asset DIRECTLY to space
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });
      // Also link album to space
      await spaceAccessSpaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

      // Both paths grant access
      const before = await spaceAccessRepo.asset.checkSpaceAccess(member.id, new Set([asset.id]));
      expect(before.has(asset.id)).toBe(true);

      // Remove album link — direct-asset path still works
      await spaceAccessSpaceRepo.removeAlbum(space.id, album.id);
      const after = await spaceAccessRepo.asset.checkSpaceAccess(member.id, new Set([asset.id]));
      expect(after.has(asset.id)).toBe(true);
    });

    it('asset accessible via two space-album links; removing one still grants access via the other', async () => {
      const { ctx } = setup();
      const spaceAccessRepo = ctx.get(AccessRepository);
      const spaceAccessSpaceRepo = ctx.get(SharedSpaceRepository);

      const { user: owner } = await ctx.newUser();
      const { user: memberS1 } = await ctx.newUser();
      const { user: memberS2 } = await ctx.newUser();

      const { space: s1 } = await ctx.newSharedSpace({ createdById: owner.id });
      const { space: s2 } = await ctx.newSharedSpace({ createdById: owner.id });

      await ctx.newSharedSpaceMember({ spaceId: s1.id, userId: memberS1.id, role: 'viewer' });
      await ctx.newSharedSpaceMember({ spaceId: s2.id, userId: memberS2.id, role: 'viewer' });

      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'G6-shared-album' });
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      // Link album to both spaces
      await spaceAccessSpaceRepo.addAlbum({ spaceId: s1.id, albumId: album.id, addedById: owner.id });
      await spaceAccessSpaceRepo.addAlbum({ spaceId: s2.id, albumId: album.id, addedById: owner.id });

      // Both members can read
      const r1 = await spaceAccessRepo.asset.checkSpaceAccess(memberS1.id, new Set([asset.id]));
      expect(r1.has(asset.id)).toBe(true);
      const r2 = await spaceAccessRepo.asset.checkSpaceAccess(memberS2.id, new Set([asset.id]));
      expect(r2.has(asset.id)).toBe(true);

      // Unlink from s1; s1-member loses access, s2-member retains it
      await spaceAccessSpaceRepo.removeAlbum(s1.id, album.id);
      const r1after = await spaceAccessRepo.asset.checkSpaceAccess(memberS1.id, new Set([asset.id]));
      expect(r1after.has(asset.id)).toBe(false);
      const r2after = await spaceAccessRepo.asset.checkSpaceAccess(memberS2.id, new Set([asset.id]));
      expect(r2after.has(asset.id)).toBe(true);
    });
  });
});
