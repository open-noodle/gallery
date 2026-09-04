/**
 * #1041 — "hide from timeline" ROLE × OWNERSHIP × PATH matrix.
 *
 * `hidden-album-timeline.medium.spec.ts` proves the RULES (S1-S16, E1-E17) with a single
 * actor who is always the space's creator. This file proves the rules are INDEPENDENT OF ROLE
 * and of who owns the photo, which is the other half of the claim in §2 of the design doc:
 *
 *   - the two "my timeline" switches are per-member preferences, so an Owner, an Editor and a
 *     Viewer must all be able to flip them, with identical effect;
 *   - each one subtracts BOTH the actor's own photos and their peers' photos from the ACTOR's
 *     timeline, because "hide" is about what I see, not about what I own;
 *   - neither one changes any other member's timeline, whatever the actor's role;
 *   - the SHARED `shared_space_album.showInTimeline` flag is the mirror image: Editor+ only, and
 *     it changes the space's own Photos tab for everyone while changing NOBODY's timeline.
 *
 * Everything here goes through SharedSpaceService (not the repository), so the role gate is
 * genuinely exercised, and reads go through TimelineService so the assertion is what the user
 * would actually see on /photos.
 *
 * Deliberately mutation-checked: every "absent" assertion below was observed to fail when the
 * corresponding switch was left un-flipped, so none of them can pass vacuously.
 */
import { Kysely } from 'kysely';
import { AssetVisibility, SharedSpaceRole, TimeBucketSize } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AlbumUserRepository } from 'src/repositories/album-user.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PartnerRepository } from 'src/repositories/partner.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { SharedSpaceService } from 'src/services/shared-space.service';
import { TimelineService } from 'src/services/timeline.service';
import { MediumTestContext, newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const setup = () => {
  const { sut, ctx } = newMediumService(SharedSpaceService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      AlbumUserRepository,
      AssetRepository,
      PartnerRepository,
      SharedSpaceRepository,
      UserRepository,
    ],
    mock: [EventRepository, LoggingRepository, JobRepository, StorageRepository],
  });
  // updateMemberPreferences enqueues the person-metadata backfill; JobRepository is auto-mocked
  // (unimplemented calls throw), so give queue a no-op resolution.
  ctx.getMock(JobRepository).queue.mockResolvedValue(void 0);
  // Same dependency instances as `sut`, so both services see the same DB rows.
  return { spaces: sut, timeline: ctx.getService(TimelineService), ctx };
};

const WHEN = new Date('2025-06-15T12:00:00.000Z');
const BUCKET = '2025-06-01';

const mkAsset = async (
  ctx: MediumTestContext,
  ownerId: string,
  opts: Parameters<MediumTestContext['newAsset']>[0] = {},
) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    fileCreatedAt: WHEN,
    localDateTime: WHEN,
    width: 400,
    height: 300,
    thumbhash: Buffer.from('t'),
    ...opts,
  });
  await ctx.newExif({ assetId: asset.id, timeZone: 'UTC' });
  return asset;
};

const authOf = (user: { id: string; email: string }) => factory.auth({ user: { id: user.id, email: user.email } });

/** What this user actually sees on /photos (own + partner + shared-space merge). */
const ownTimeline = async (timeline: TimelineService, user: { id: string; email: string }): Promise<Set<string>> => {
  const json = await timeline.getTimeBucket(authOf(user), {
    visibility: AssetVisibility.Timeline,
    bucketSize: TimeBucketSize.Month,
    timeBucket: BUCKET,
    withSharedSpaces: true,
  });
  return new Set((JSON.parse(json) as { id?: string[] }).id);
};

/** What the SPACE's own Photos tab shows — the surface the SHARED album flag governs. */
const spaceTab = async (
  timeline: TimelineService,
  user: { id: string; email: string },
  spaceId: string,
): Promise<Set<string>> => {
  const json = await timeline.getTimeBucket(authOf(user), {
    visibility: AssetVisibility.Timeline,
    bucketSize: TimeBucketSize.Month,
    timeBucket: BUCKET,
    spaceId,
  });
  return new Set((JSON.parse(json) as { id?: string[] }).id);
};

/**
 * One space, three members, and four assets covering the ownership × path grid:
 *
 *   ownViaAlbum   — the ACTOR owns it; reaches the space as a cross-owner CONTRIBUTION
 *                   (`album_space_asset`) to the linked album  → hiddenAlbumSpacePairs arm
 *   peerViaAlbum  — the HOST owns it; reaches the space as normal album content
 *                   (`album_asset`)                            → hiddenAlbumIds arm
 *   ownDirect     — the ACTOR owns it; added straight to the space (`shared_space_asset`)
 *   peerDirect    — the HOST owns it; added straight to the space
 *
 * `bystander` is a second Viewer who never touches a switch: every test asserts their timeline is
 * unchanged, which is what makes "this is MY preference" a claim and not a slogan.
 */
const buildWorld = async (ctx: MediumTestContext, actorRole: SharedSpaceRole) => {
  const { user: host } = await ctx.newUser();
  const { user: actor } = await ctx.newUser();
  const { user: bystander } = await ctx.newUser();

  const { space } = await ctx.newSharedSpace({ createdById: host.id, faceRecognitionEnabled: false });
  await ctx.newSharedSpaceMember({
    spaceId: space.id,
    userId: host.id,
    role: SharedSpaceRole.Owner,
    showInTimeline: true,
  });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: actor.id, role: actorRole, showInTimeline: true });
  await ctx.newSharedSpaceMember({
    spaceId: space.id,
    userId: bystander.id,
    role: SharedSpaceRole.Viewer,
    showInTimeline: true,
  });

  const { result: album } = await ctx.newAlbum({ ownerId: host.id, albumName: `matrix-${actorRole}` });
  await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: host.id });

  const peerViaAlbum = await mkAsset(ctx, host.id);
  await ctx.newAlbumAsset({ albumId: album.id, assetId: peerViaAlbum.id });

  const ownViaAlbum = await mkAsset(ctx, actor.id);
  await ctx.newAlbumSpaceAsset({
    albumId: album.id,
    assetId: ownViaAlbum.id,
    spaceId: space.id,
    addedById: host.id,
  });

  const ownDirect = await mkAsset(ctx, actor.id);
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: ownDirect.id, addedById: actor.id });

  const peerDirect = await mkAsset(ctx, host.id);
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: peerDirect.id, addedById: host.id });

  return {
    host,
    actor,
    bystander,
    space,
    album,
    ownViaAlbum: ownViaAlbum.id,
    peerViaAlbum: peerViaAlbum.id,
    ownDirect: ownDirect.id,
    peerDirect: peerDirect.id,
    all: [ownViaAlbum.id, peerViaAlbum.id, ownDirect.id, peerDirect.id],
  };
};

const ROLES: Array<[string, SharedSpaceRole]> = [
  ['Owner', SharedSpaceRole.Owner],
  ['Editor', SharedSpaceRole.Editor],
  ['Viewer', SharedSpaceRole.Viewer],
];

describe('#1041 — hide-from-timeline role × ownership matrix', () => {
  // ===========================================================================
  // Grid H1 — "Hide all space photos from my timeline" (any member, own row)
  // ===========================================================================
  describe('Grid H1 — space-level personal hide', () => {
    it.each(ROLES)(
      'a %s hiding the space loses their OWN and their PEERS photos from their own timeline',
      async (_label, role) => {
        const { spaces, timeline, ctx } = setup();
        const w = await buildWorld(ctx, role);

        const before = await ownTimeline(timeline, w.actor);
        for (const id of w.all) {
          expect(before.has(id)).toBe(true);
        }

        await spaces.updateMemberTimeline(authOf(w.actor), w.space.id, { showInTimeline: false });

        const after = await ownTimeline(timeline, w.actor);
        // Own photos: subtracted by the caller's-own-arm predicate (hiddenFromOwnTimeline).
        expect(after.has(w.ownViaAlbum)).toBe(false);
        expect(after.has(w.ownDirect)).toBe(false);
        // Peers' photos: they only ever reached this timeline through the space arm, which the
        // member flag removes from `timelineSpaceIds`. Different mechanism, same user-visible rule.
        expect(after.has(w.peerViaAlbum)).toBe(false);
        expect(after.has(w.peerDirect)).toBe(false);
      },
    );

    it.each(ROLES)('a %s hiding the space changes NO other member timeline', async (_label, role) => {
      const { spaces, timeline, ctx } = setup();
      const w = await buildWorld(ctx, role);

      await spaces.updateMemberTimeline(authOf(w.actor), w.space.id, { showInTimeline: false });

      const bystanderIds = await ownTimeline(timeline, w.bystander);
      for (const id of w.all) {
        expect(bystanderIds.has(id)).toBe(true);
      }
      const hostIds = await ownTimeline(timeline, w.host);
      for (const id of w.all) {
        expect(hostIds.has(id)).toBe(true);
      }
    });

    it.each(ROLES)("a %s hiding the space does not change the space's own Photos tab", async (_label, role) => {
      const { spaces, timeline, ctx } = setup();
      const w = await buildWorld(ctx, role);

      await spaces.updateMemberTimeline(authOf(w.actor), w.space.id, { showInTimeline: false });

      const tab = await spaceTab(timeline, w.actor, w.space.id);
      for (const id of w.all) {
        expect(tab.has(id)).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Grid H2 — "Hide this album from my timeline" (any member, own row)
  // ===========================================================================
  describe('Grid H2 — album-level personal hide', () => {
    it.each(ROLES)(
      'a %s hiding one album loses their OWN contribution and their PEERS album photos, and nothing else',
      async (_label, role) => {
        const { spaces, timeline, ctx } = setup();
        const w = await buildWorld(ctx, role);

        await spaces.updateAlbumTimelineForMember(authOf(w.actor), w.space.id, w.album.id, { showInTimeline: false });

        const after = await ownTimeline(timeline, w.actor);
        expect(after.has(w.ownViaAlbum)).toBe(false);
        expect(after.has(w.peerViaAlbum)).toBe(false);
        // The album switch gates the ALBUM path only — a directly-added asset is a different path
        // and must survive, whoever owns it (§3, "any visible path wins").
        expect(after.has(w.ownDirect)).toBe(true);
        expect(after.has(w.peerDirect)).toBe(true);
      },
    );

    it.each(ROLES)('a %s hiding one album changes NO other member timeline', async (_label, role) => {
      const { spaces, timeline, ctx } = setup();
      const w = await buildWorld(ctx, role);

      await spaces.updateAlbumTimelineForMember(authOf(w.actor), w.space.id, w.album.id, { showInTimeline: false });

      const bystanderIds = await ownTimeline(timeline, w.bystander);
      for (const id of w.all) {
        expect(bystanderIds.has(id)).toBe(true);
      }
      const hostIds = await ownTimeline(timeline, w.host);
      for (const id of w.all) {
        expect(hostIds.has(id)).toBe(true);
      }
    });

    it.each(ROLES)("a %s hiding one album leaves the space's own Photos tab untouched", async (_label, role) => {
      const { spaces, timeline, ctx } = setup();
      const w = await buildWorld(ctx, role);

      await spaces.updateAlbumTimelineForMember(authOf(w.actor), w.space.id, w.album.id, { showInTimeline: false });

      const tab = await spaceTab(timeline, w.actor, w.space.id);
      for (const id of w.all) {
        expect(tab.has(id)).toBe(true);
      }
    });

    it.each(ROLES)('a %s can un-hide, and their photos come back', async (_label, role) => {
      const { spaces, timeline, ctx } = setup();
      const w = await buildWorld(ctx, role);

      await spaces.updateAlbumTimelineForMember(authOf(w.actor), w.space.id, w.album.id, { showInTimeline: false });
      const whileHidden = await ownTimeline(timeline, w.actor);
      expect(whileHidden.has(w.ownViaAlbum)).toBe(false);

      await spaces.updateAlbumTimelineForMember(authOf(w.actor), w.space.id, w.album.id, { showInTimeline: true });

      const after = await ownTimeline(timeline, w.actor);
      for (const id of w.all) {
        expect(after.has(id)).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Grid H3 — the SHARED album flag is the mirror image of the two above
  // ===========================================================================
  describe('Grid H3 — shared "hide from the space\'s photos" flag (Editor+)', () => {
    it.each(ROLES)('a %s flipping the shared flag is allowed only for Editor+', async (_label, role) => {
      const { spaces, ctx } = setup();
      const w = await buildWorld(ctx, role);

      const attempt = spaces.updateAlbumLink(authOf(w.actor), w.space.id, w.album.id, { showInTimeline: false });
      if (role === SharedSpaceRole.Viewer) {
        await expect(attempt).rejects.toThrow();
      } else {
        await expect(attempt).resolves.toBeUndefined();
      }
    });

    it("an Editor hiding the album from the space's photos changes NOBODY's personal timeline", async () => {
      const { spaces, timeline, ctx } = setup();
      const w = await buildWorld(ctx, SharedSpaceRole.Editor);

      await spaces.updateAlbumLink(authOf(w.actor), w.space.id, w.album.id, { showInTimeline: false });

      for (const member of [w.actor, w.host, w.bystander]) {
        const ids = await ownTimeline(timeline, member);
        for (const id of w.all) {
          expect(ids.has(id)).toBe(true);
        }
      }
    });

    it("an Editor hiding the album from the space's photos DOES remove it from the space tab, for every member", async () => {
      const { spaces, timeline, ctx } = setup();
      const w = await buildWorld(ctx, SharedSpaceRole.Editor);

      await spaces.updateAlbumLink(authOf(w.actor), w.space.id, w.album.id, { showInTimeline: false });

      for (const member of [w.actor, w.host, w.bystander]) {
        const tab = await spaceTab(timeline, member, w.space.id);
        expect(tab.has(w.ownViaAlbum)).toBe(false);
        expect(tab.has(w.peerViaAlbum)).toBe(false);
        // Direct adds are not album content — untouched by the album's shared flag.
        expect(tab.has(w.ownDirect)).toBe(true);
        expect(tab.has(w.peerDirect)).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Grid H4 — who may flip the personal switches, and what they write
  // ===========================================================================
  describe('Grid H4 — personal-switch authorization', () => {
    it.each(ROLES)('a %s may flip both personal switches', async (_label, role) => {
      const { spaces, ctx } = setup();
      const w = await buildWorld(ctx, role);

      await expect(
        spaces.updateAlbumTimelineForMember(authOf(w.actor), w.space.id, w.album.id, { showInTimeline: false }),
      ).resolves.toBeUndefined();
      await expect(
        spaces.updateMemberTimeline(authOf(w.actor), w.space.id, { showInTimeline: false }),
      ).resolves.toBeDefined();
    });

    it('a non-member may flip neither', async () => {
      const { spaces, ctx } = setup();
      const w = await buildWorld(ctx, SharedSpaceRole.Viewer);
      const { user: outsider } = await ctx.newUser();

      await expect(
        spaces.updateAlbumTimelineForMember(authOf(outsider), w.space.id, w.album.id, { showInTimeline: false }),
      ).rejects.toThrow();
      await expect(
        spaces.updateMemberTimeline(authOf(outsider), w.space.id, { showInTimeline: false }),
      ).rejects.toThrow();
    });

    it('hiding an album that is not linked to the space is rejected, not a 500', async () => {
      const { spaces, ctx } = setup();
      const w = await buildWorld(ctx, SharedSpaceRole.Editor);
      const { result: unlinked } = await ctx.newAlbum({ ownerId: w.actor.id, albumName: 'not-linked' });

      await expect(
        spaces.updateAlbumTimelineForMember(authOf(w.actor), w.space.id, unlinked.id, { showInTimeline: false }),
      ).rejects.toThrow(/not linked/i);
    });

    it.each(ROLES)('a %s hiding an album writes exactly one row, keyed to themselves', async (_label, role) => {
      const { spaces, ctx } = setup();
      const w = await buildWorld(ctx, role);

      await spaces.updateAlbumTimelineForMember(authOf(w.actor), w.space.id, w.album.id, { showInTimeline: false });

      const rows = await defaultDatabase
        .selectFrom('shared_space_album_hidden')
        .select(['userId'])
        .where('spaceId', '=', w.space.id)
        .where('albumId', '=', w.album.id)
        .execute();
      expect(rows.map((row) => row.userId)).toEqual([w.actor.id]);
    });

    it.each(ROLES)("a %s hide is invisible in another member's resolved scope", async (_label, role) => {
      const { spaces, ctx } = setup();
      const w = await buildWorld(ctx, role);
      const spaceRepo = ctx.get(SharedSpaceRepository);

      await spaces.updateAlbumTimelineForMember(authOf(w.actor), w.space.id, w.album.id, { showInTimeline: false });

      const actorScope = await spaceRepo.getTimelineHiddenScope(w.actor.id);
      const bystanderScope = await spaceRepo.getTimelineHiddenScope(w.bystander.id);
      const hostScope = await spaceRepo.getTimelineHiddenScope(w.host.id);
      expect(actorScope.hiddenAlbumIds).toContain(w.album.id);
      expect(bystanderScope.hiddenAlbumIds).not.toContain(w.album.id);
      expect(hostScope.hiddenAlbumIds).not.toContain(w.album.id);
    });

    it.each(ROLES)('the album list reports hiddenFromMyTimeline per viewer, for a %s', async (_label, role) => {
      const { spaces, ctx } = setup();
      const w = await buildWorld(ctx, role);

      await spaces.updateAlbumTimelineForMember(authOf(w.actor), w.space.id, w.album.id, { showInTimeline: false });

      const forActor = await spaces.getLinkedAlbums(authOf(w.actor), w.space.id);
      expect(forActor.find((a) => a.id === w.album.id)?.hiddenFromMyTimeline).toBe(true);
      // The SHARED flag is untouched by the personal switch — the two must not be conflated.
      expect(forActor.find((a) => a.id === w.album.id)?.showInTimeline).toBe(true);

      const forBystander = await spaces.getLinkedAlbums(authOf(w.bystander), w.space.id);
      expect(forBystander.find((a) => a.id === w.album.id)?.hiddenFromMyTimeline).toBe(false);
    });
  });

  // ===========================================================================
  // Grid H5 — external libraries: the #1041 reporter's own shape
  // ===========================================================================
  describe('Grid H5 — external-library owners', () => {
    it.each(ROLES)(
      'a %s who linked their own library into the space loses those photos when they hide the SPACE',
      async (_label, role) => {
        const { spaces, timeline, ctx } = setup();
        const w = await buildWorld(ctx, role);
        const { library } = await ctx.newLibrary({ ownerId: w.actor.id });
        await ctx.newSharedSpaceLibrary({ spaceId: w.space.id, libraryId: library.id });
        const libraryAsset = await mkAsset(ctx, w.actor.id, { libraryId: library.id });

        const before = await ownTimeline(timeline, w.actor);
        expect(before.has(libraryAsset.id)).toBe(true);

        await spaces.updateMemberTimeline(authOf(w.actor), w.space.id, { showInTimeline: false });

        const after = await ownTimeline(timeline, w.actor);
        expect(after.has(libraryAsset.id)).toBe(false);
      },
    );

    it.each(ROLES)(
      'a %s hiding only the ALBUM keeps library-backed photos, because the library is a second visible path',
      async (_label, role) => {
        const { spaces, timeline, ctx } = setup();
        const w = await buildWorld(ctx, role);
        const { library } = await ctx.newLibrary({ ownerId: w.actor.id });
        await ctx.newSharedSpaceLibrary({ spaceId: w.space.id, libraryId: library.id });
        // The same photo reaches the space twice: through the album AND through the library.
        const dualPath = await mkAsset(ctx, w.actor.id, { libraryId: library.id });
        await ctx.newAlbumSpaceAsset({
          albumId: w.album.id,
          assetId: dualPath.id,
          spaceId: w.space.id,
          addedById: w.host.id,
        });

        await spaces.updateAlbumTimelineForMember(authOf(w.actor), w.space.id, w.album.id, { showInTimeline: false });

        // §3: hiding one path is not enough. This is exactly what #1041's reporter experienced —
        // it is the documented rule, not a bug, and the album hide-preview count reflects it.
        const afterAlbumHide = await ownTimeline(timeline, w.actor);
        expect(afterAlbumHide.has(dualPath.id)).toBe(true);

        // Hiding the whole space closes the remaining path, and only then does it disappear.
        await spaces.updateMemberTimeline(authOf(w.actor), w.space.id, { showInTimeline: false });
        const afterSpaceHide = await ownTimeline(timeline, w.actor);
        expect(afterSpaceHide.has(dualPath.id)).toBe(false);
      },
    );
  });

  // ===========================================================================
  // Grid H6 — two members hiding independently do not interfere
  // ===========================================================================
  describe('Grid H6 — concurrent, independent preferences', () => {
    it('an Editor hiding the album and a Viewer hiding the space each get exactly their own result', async () => {
      const { spaces, timeline, ctx } = setup();
      const w = await buildWorld(ctx, SharedSpaceRole.Editor);
      // `bystander` is the Viewer here; give them a switch of their own.
      await spaces.updateAlbumTimelineForMember(authOf(w.actor), w.space.id, w.album.id, { showInTimeline: false });
      await spaces.updateMemberTimeline(authOf(w.bystander), w.space.id, { showInTimeline: false });

      // Editor: album photos gone, direct adds kept.
      const editorIds = await ownTimeline(timeline, w.actor);
      expect(editorIds.has(w.ownViaAlbum)).toBe(false);
      expect(editorIds.has(w.peerViaAlbum)).toBe(false);
      expect(editorIds.has(w.ownDirect)).toBe(true);
      expect(editorIds.has(w.peerDirect)).toBe(true);

      // Viewer: everything from this space gone.
      const viewerIds = await ownTimeline(timeline, w.bystander);
      for (const id of w.all) {
        expect(viewerIds.has(id)).toBe(false);
      }

      // Host: untouched by either.
      const hostIds = await ownTimeline(timeline, w.host);
      for (const id of w.all) {
        expect(hostIds.has(id)).toBe(true);
      }
    });
  });
});
