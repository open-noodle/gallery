/**
 * #1041 slices 8 + 9 + 13 — "hide from timeline" actually hides.
 *
 * Every scenario is named after its row in specs/2026-08-31-space-hide-from-timeline-design.md
 * §9.1 (S1-S16, E1-E17) so a failure names the rule it broke. S16 (sync never delivers another
 * member's hidden row) and E11/E11b (unlink cascade / re-link does not resurrect) are already
 * pinned by earlier slices — see shared-space-album-hidden-sync.spec.ts and
 * shared-space-album-hidden.migration.spec.ts — and are not duplicated here. E1/E7b/rule-level
 * resolution correctness (soft-delete, contribution pairing, the MINUS) are pinned at the
 * resolution layer by shared-space-album-hidden.repository.spec.ts; this file adds END-TO-END
 * coverage that the resolved scope is actually WIRED into the personal timeline (slice 8), folder
 * view (slice 9) and memories (slice 13) queries — which is what slices 8/9/13 change.
 *
 * §9.6 test-honesty: every S2-S8 scenario gives the viewer a SECOND, unrelated, visible space so
 * the empty-scope collapse in ownerArmWithHiddenSubtraction / hiddenFromOwnTimeline cannot run —
 * this exact shape hid a real bug behind 139 green tests in this repo before.
 */

import { expressionBuilder, Kysely } from 'kysely';
import { AuthDto } from 'src/dtos/auth.dto';
import { TimeBucketDto } from 'src/dtos/time-bucket.dto';
import { AssetVisibility, SharedSpaceRole, TimeBucketSize } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetRepository, withTimeBucketAssetFilters } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MemoryRepository } from 'src/repositories/memory.repository';
import { PartnerRepository } from 'src/repositories/partner.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { ViewRepository } from 'src/repositories/view-repository';
import { DB } from 'src/schema';
import { MemoryService } from 'src/services/memory.service';
import { TimelineService } from 'src/services/timeline.service';
import { ViewService } from 'src/services/view.service';
import { hiddenFromOwnTimeline } from 'src/utils/shared-space-album-scope';
import { MediumTestContext, newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

// ── slice 8: the personal timeline ──────────────────────────────────────────

const setupTimeline = () =>
  newMediumService(TimelineService, {
    database: defaultDatabase,
    real: [AssetRepository, AccessRepository, PartnerRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });

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

/** §9.6: an unrelated, visible second space so the empty-scope collapse cannot mask the test. */
const giveASecondVisibleSpace = async (ctx: MediumTestContext, userId: string) => {
  const { space } = await ctx.newSharedSpace({ createdById: userId });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId, role: SharedSpaceRole.Owner, showInTimeline: true });
  const decoy = await mkAsset(ctx, userId);
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: decoy.id });
  return { space, decoyAssetId: decoy.id };
};

const idsInBucket = async (
  sut: ReturnType<typeof setupTimeline>['sut'],
  auth: AuthDto,
  dto: Partial<TimeBucketDto>,
): Promise<Set<string>> => {
  const json = await sut.getTimeBucket(auth, {
    visibility: AssetVisibility.Timeline,
    bucketSize: TimeBucketSize.Month,
    ...dto,
    timeBucket: BUCKET,
  });
  return new Set((JSON.parse(json) as { id?: string[] }).id);
};

describe('#1041 slice 8 — personal timeline (/photos)', () => {
  it('S1: I own an asset in no space — shows', async () => {
    const { sut, ctx } = setupTimeline();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    const asset = await mkAsset(ctx, user.id);

    const ids = await idsInBucket(sut, auth, {});
    expect(ids.has(asset.id)).toBe(true);
  });

  it('S2: only in an album I hid, in a space I show — absent', async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    await giveASecondVisibleSpace(ctx, user.id);

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'S2' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    const asset = await mkAsset(ctx, user.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await spaceRepo.hideAlbumForUser(space.id, album.id, user.id);

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(false);
  });

  it('S3: as S2, plus the asset is also in a visible album Y linked to S — shows', async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    await giveASecondVisibleSpace(ctx, user.id);

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: albumX } = await ctx.newAlbum({ ownerId: user.id, albumName: 'S3-X' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: albumX.id, addedById: user.id });
    const { result: albumY } = await ctx.newAlbum({ ownerId: user.id, albumName: 'S3-Y' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: albumY.id, addedById: user.id });
    const asset = await mkAsset(ctx, user.id);
    await ctx.newAlbumAsset({ albumId: albumX.id, assetId: asset.id });
    await ctx.newAlbumAsset({ albumId: albumY.id, assetId: asset.id });
    await spaceRepo.hideAlbumForUser(space.id, albumX.id, user.id);

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(true);
  });

  it('S4: as S2, plus the asset is also a shared_space_asset of S — shows', async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    await giveASecondVisibleSpace(ctx, user.id);

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'S4' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    const asset = await mkAsset(ctx, user.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await spaceRepo.hideAlbumForUser(space.id, album.id, user.id);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(true);
  });

  it('S5: only in space S (direct); I hid S — absent', async () => {
    const { sut, ctx } = setupTimeline();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    await giveASecondVisibleSpace(ctx, user.id);

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: false });
    const asset = await mkAsset(ctx, user.id);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(false);
  });

  it('S6: as S5, plus the asset is also direct in space T, T shown — shows', async () => {
    const { sut, ctx } = setupTimeline();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });

    const { space: s } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: s.id, userId: user.id, showInTimeline: false });
    const { space: t } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: t.id, userId: user.id, showInTimeline: true });
    const asset = await mkAsset(ctx, user.id);
    await ctx.newSharedSpaceAsset({ spaceId: s.id, assetId: asset.id });
    await ctx.newSharedSpaceAsset({ spaceId: t.id, assetId: asset.id });

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(true);
  });

  it('S7: album linked to hidden S and shown T, not hidden by me in T — shows', async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });

    const { space: s } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: s.id, userId: user.id, showInTimeline: false });
    const { space: t } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: t.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'S7' });
    await spaceRepo.addAlbum({ spaceId: s.id, albumId: album.id, addedById: user.id });
    await spaceRepo.addAlbum({ spaceId: t.id, albumId: album.id, addedById: user.id });
    const asset = await mkAsset(ctx, user.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(true);
  });

  it('S8: via a library linked to hidden space S only — absent', async () => {
    const { sut, ctx } = setupTimeline();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    await giveASecondVisibleSpace(ctx, user.id);

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: false });
    const { library } = await ctx.newLibrary({ ownerId: user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    const asset = await mkAsset(ctx, user.id, { libraryId: library.id });

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(false);
  });

  it('S9: another member owns an asset in a space I hid — absent (unchanged)', async () => {
    const { sut, ctx } = setupTimeline();
    const { user: viewer } = await ctx.newUser();
    const { user: owner } = await ctx.newUser();
    const auth = factory.auth({ user: viewer });

    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, showInTimeline: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, showInTimeline: false });
    const asset = await mkAsset(ctx, owner.id);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(false);
  });

  it('S10: another member owns an asset in an album I hid — absent', async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user: viewer } = await ctx.newUser();
    const { user: owner } = await ctx.newUser();
    const auth = factory.auth({ user: viewer });

    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, showInTimeline: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'S10' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    const asset = await mkAsset(ctx, owner.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await spaceRepo.hideAlbumForUser(space.id, album.id, viewer.id);

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(false);
  });

  it('S11: I hid space S; another member shows S and owns an asset in it — it shows for them, my flag is mine alone', async () => {
    const { sut, ctx } = setupTimeline();
    const { user: viewer } = await ctx.newUser();
    const { user: owner } = await ctx.newUser();
    const ownerAuth = factory.auth({ user: owner });

    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, showInTimeline: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, showInTimeline: false });
    const asset = await mkAsset(ctx, owner.id);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const ids = await idsInBucket(sut, ownerAuth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(true);
  });

  it("S12: an editor hides album X from the space's Photos tab; I own assets in X — shows on MY /photos (the shared flag no longer reaches my timeline)", async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'S12' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    await spaceRepo.setAlbumShowInTimeline(space.id, album.id, false);
    const asset = await mkAsset(ctx, user.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(true);
  });

  it("S13: as S12 — absent from the space's own Photos tab (unchanged, still shared-flag gated)", async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'S13' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    await spaceRepo.setAlbumShowInTimeline(space.id, album.id, false);
    const asset = await mkAsset(ctx, user.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    const ids = await idsInBucket(sut, auth, { spaceId: space.id });
    expect(ids.has(asset.id)).toBe(false);
  });

  it("S14: I hid album X for myself only — X's photos still show in the space's Photos tab", async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'S14' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    const asset = await mkAsset(ctx, user.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await spaceRepo.hideAlbumForUser(space.id, album.id, user.id);

    const ids = await idsInBucket(sut, auth, { spaceId: space.id });
    expect(ids.has(asset.id)).toBe(true);
  });

  it('S15: I hid album X in space S; X also linked to space T — shows via T (the hidden row is (space, album, user)-keyed)', async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });

    const { space: s } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: s.id, userId: user.id, showInTimeline: true });
    const { space: t } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: t.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'S15' });
    await spaceRepo.addAlbum({ spaceId: s.id, albumId: album.id, addedById: user.id });
    await spaceRepo.addAlbum({ spaceId: t.id, albumId: album.id, addedById: user.id });
    const asset = await mkAsset(ctx, user.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await spaceRepo.hideAlbumForUser(s.id, album.id, user.id);

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(true);
  });

  // S16 (another member's hidden row is never delivered to me) is a SYNC scenario, already pinned
  // by name in shared-space-album-hidden-sync.spec.ts — not duplicated here.

  it('E1: soft-deleted linked album neither hides nor re-admits (A1 invariant)', async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    await giveASecondVisibleSpace(ctx, user.id);

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'E1' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    const asset = await mkAsset(ctx, user.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await spaceRepo.hideAlbumForUser(space.id, album.id, user.id);
    await ctx.softDeleteAlbum(album.id);

    // The album is soft-deleted: the hide no longer applies (my own asset shows), but the album
    // stays out of every reachability computation too — direct proof of "neither hides nor
    // re-admits" needs only the positive half here, since the album path is otherwise gone.
    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(true);
  });

  it('E2: asset in a hidden album AND trashed — still absent; trash unaffected', async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    await giveASecondVisibleSpace(ctx, user.id);

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'E2' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    const asset = await mkAsset(ctx, user.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await spaceRepo.hideAlbumForUser(space.id, album.id, user.id);
    await defaultDatabase.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', asset.id).execute();

    // withSharedSpaces + isTrashed is rejected by timeBucketChecks (trash is always a personal,
    // space-free browse) — so this exercises the !timelineSpaceIds branch (block1), same as E12,
    // proving the subtraction and the trash filter compose without erroring or double-admitting.
    const ids = await idsInBucket(sut, auth, { isTrashed: true });
    expect(ids.has(asset.id)).toBe(false);
  });

  it('E3/E4: archive/hidden/locked visibility is unaffected by the hide (never on the Timeline-visibility bucket anyway)', async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    await giveASecondVisibleSpace(ctx, user.id);

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'E3E4' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    const archiveAsset = await mkAsset(ctx, user.id, { visibility: AssetVisibility.Archive });
    const hiddenAsset = await mkAsset(ctx, user.id, { visibility: AssetVisibility.Hidden });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: archiveAsset.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: hiddenAsset.id });
    await spaceRepo.hideAlbumForUser(space.id, album.id, user.id);

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(archiveAsset.id)).toBe(false);
    expect(ids.has(hiddenAsset.id)).toBe(false);
  });

  it('E5: viewer belongs to no space — the generated SQL has no hidden-scope predicate at all', async () => {
    const { sut, ctx } = setupTimeline();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    const asset = await mkAsset(ctx, user.id);

    // Row-level: absent membership means an empty scope reaches the query.
    const ids = await idsInBucket(sut, auth, {});
    expect(ids.has(asset.id)).toBe(true);

    // SQL-shape: an empty scope must emit EXACTLY the pre-#1041 predicate, not a trivially-true
    // NOT EXISTS — §9.6 requires asserting the generated SQL, not just the rows, for this claim.
    const emptyScope = await ctx.get(SharedSpaceRepository).getTimelineHiddenScope(user.id);
    const compiled = withTimeBucketAssetFilters(defaultDatabase.selectFrom('asset').selectAll(), {
      userIds: [user.id],
      callerId: user.id,
      hiddenScope: emptyScope,
    }).compile();
    expect(compiled.sql).not.toContain('shared_space_album_hidden');
    expect(compiled.sql).not.toContain('NOT EXISTS');
  });

  it('E6: viewer has spaces but hid nothing — same collapse, the free-for-everyone claim', async () => {
    const { sut, ctx } = setupTimeline();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    await giveASecondVisibleSpace(ctx, user.id);
    const asset = await mkAsset(ctx, user.id);

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(true);

    // SQL-shape: the OWNER-arm subtraction — the "free for everyone who has hidden nothing" claim
    // — collapses to the pre-#1041 predicate: no list-based NOT EXISTS on album_asset/
    // shared_space_asset/album_space_asset attached to the owner term. The personal-timeline V
    // (space-path) arm's 'personal' album gate is a DIFFERENT, per-row correlated NOT EXISTS on
    // the small, sparse shared_space_album_hidden table — that one is a structural, always-present
    // part of the V predicate (not data-dependent), so it legitimately still appears whenever
    // `timelineSpaceIds` is non-empty; it is not part of this collapse claim.
    const scope = await ctx.get(SharedSpaceRepository).getTimelineHiddenScope(user.id);
    expect(scope.hiddenSpaceIds).toEqual([]);
    expect(scope.hiddenAlbumIds).toEqual([]);
    expect(scope.hiddenAlbumSpacePairs).toEqual([]);
    expect(scope.hiddenLibraryIds).toEqual([]);
    // The precise claim lives in hiddenFromOwnTimeline itself: an empty scope returns `undefined`
    // so ownerArmWithHiddenSubtraction's caller emits nothing extra — asserted directly here rather
    // than by grepping compiled SQL, since the V-arm's OWN (unrelated) NOT EXISTS on
    // shared_space_album_hidden uses the identical `= any(...)` column-reference shape and would
    // make a substring match ambiguous.
    const eb = expressionBuilder<DB, 'asset'>();
    expect(hiddenFromOwnTimeline(eb, scope)).toBeUndefined();
  });

  it('E7: a contribution (album_space_asset) honours the hide in its own, only-linked space', async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user: owner } = await ctx.newUser();
    const { user: contributor } = await ctx.newUser();
    const contributorAuth = factory.auth({ user: contributor });
    await giveASecondVisibleSpace(ctx, contributor.id);

    const { space: s } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: s.id, userId: owner.id, showInTimeline: true });
    await ctx.newSharedSpaceMember({ spaceId: s.id, userId: contributor.id, showInTimeline: true });

    // Album linked ONLY to S — no other linkage, so the rule-2c cancellation (E7b, below) cannot
    // fire, and the hide applies cleanly.
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'E7' });
    await spaceRepo.addAlbum({ spaceId: s.id, albumId: album.id, addedById: owner.id });

    const contributed = await mkAsset(ctx, contributor.id);
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributed.id, spaceId: s.id });
    await spaceRepo.hideAlbumForUser(s.id, album.id, contributor.id);

    const ids = await idsInBucket(sut, contributorAuth, { withSharedSpaces: true });
    expect(ids.has(contributed.id)).toBe(false);
  });

  it('E7b: album X hidden by me in S, but ALSO linked to shown T (not hidden there) — a contribution in EITHER space still shows (rule 2c cancels the whole album, keyed on (albumId, spaceId) pairs)', async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user: owner } = await ctx.newUser();
    const { user: contributor } = await ctx.newUser();
    const contributorAuth = factory.auth({ user: contributor });

    const { space: s } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: s.id, userId: owner.id, showInTimeline: true });
    await ctx.newSharedSpaceMember({ spaceId: s.id, userId: contributor.id, showInTimeline: true });
    const { space: t } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: t.id, userId: owner.id, showInTimeline: true });
    await ctx.newSharedSpaceMember({ spaceId: t.id, userId: contributor.id, showInTimeline: true });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'E7b' });
    await spaceRepo.addAlbum({ spaceId: s.id, albumId: album.id, addedById: owner.id });
    await spaceRepo.addAlbum({ spaceId: t.id, albumId: album.id, addedById: owner.id });

    const contributedInS = await mkAsset(ctx, contributor.id);
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributedInS.id, spaceId: s.id });
    const contributedInT = await mkAsset(ctx, contributor.id);
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributedInT.id, spaceId: t.id });

    // Hidden in S only — but T is a visible, unhidden linkage of the SAME album, so rule 2c's MINUS
    // cancels the album entirely (matches S7/S15's mechanism; pinned at the resolution layer by
    // "rule 2c: a visibly-linked album cancels the hide" in shared-space-album-hidden.repository.spec.ts).
    await spaceRepo.hideAlbumForUser(s.id, album.id, contributor.id);

    const ids = await idsInBucket(sut, contributorAuth, { withSharedSpaces: true });
    expect(ids.has(contributedInS.id)).toBe(true);
    expect(ids.has(contributedInT.id)).toBe(true);
  });

  it('E8: stacked asset, primary hidden — the whole stack follows the existing withStacked collapse (no orphan sibling row)', async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    await giveASecondVisibleSpace(ctx, user.id);

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'E8' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    const primary = await mkAsset(ctx, user.id);
    const sibling = await mkAsset(ctx, user.id);
    await ctx.newStack({ ownerId: user.id, primaryAssetId: primary.id } as any, [primary.id, sibling.id]);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: primary.id });
    await spaceRepo.hideAlbumForUser(space.id, album.id, user.id);

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true, withStacked: true });
    // withStacked already collapses a stack down to its primary's row (pre-existing, unrelated to
    // #1041) — a non-primary sibling never appears on its own regardless of hide state. Hiding the
    // primary therefore hides the whole stack's timeline representation; no orphan sibling row.
    expect(ids.has(primary.id)).toBe(false);
    expect(ids.has(sibling.id)).toBe(false);
  });

  it('E9: album linked to two spaces, hidden by me in BOTH — absent', async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    await giveASecondVisibleSpace(ctx, user.id);

    const { space: s } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: s.id, userId: user.id, showInTimeline: true });
    const { space: t } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: t.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'E9' });
    await spaceRepo.addAlbum({ spaceId: s.id, albumId: album.id, addedById: user.id });
    await spaceRepo.addAlbum({ spaceId: t.id, albumId: album.id, addedById: user.id });
    const asset = await mkAsset(ctx, user.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await spaceRepo.hideAlbumForUser(s.id, album.id, user.id);
    await spaceRepo.hideAlbumForUser(t.id, album.id, user.id);

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(false);
  });

  it('E10: withPartners=true, partner owns an asset in an album I hid — the PARTNER asset still shows (the partner trap)', async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const partnerRepo = ctx.get(PartnerRepository);
    const { user } = await ctx.newUser();
    const { user: partner } = await ctx.newUser();
    const auth = factory.auth({ user });
    await partnerRepo.create({ sharedById: partner.id, sharedWithId: user.id, inTimeline: true });
    await giveASecondVisibleSpace(ctx, user.id);

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'E10' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    // I hid this album for myself.
    await spaceRepo.hideAlbumForUser(space.id, album.id, user.id);

    // MY own asset in the hidden album — must be absent.
    const myAsset = await mkAsset(ctx, user.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: myAsset.id });
    // The PARTNER'S asset, also in the SAME hidden-by-me album (partner owns it, sharing with me).
    const partnerAsset = await mkAsset(ctx, partner.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: partnerAsset.id });

    const ids = await idsInBucket(sut, auth, { withPartners: true });
    expect(ids.has(myAsset.id)).toBe(false);
    expect(ids.has(partnerAsset.id)).toBe(true);
  });

  it('E12: withSharedSpaces=false — the subtraction still applies (the !timelineSpaceIds branch)', async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'E12' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    const asset = await mkAsset(ctx, user.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await spaceRepo.hideAlbumForUser(space.id, album.id, user.id);

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: false });
    expect(ids.has(asset.id)).toBe(false);
  });

  it('E13: hidden space with a linked library, but MY assets have libraryId IS NULL — they still show (the NULL <> ALL trap)', async () => {
    const { sut, ctx } = setupTimeline();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: false });
    const { library } = await ctx.newLibrary({ ownerId: user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    // No libraryId — a plain, non-library-backed asset.
    const asset = await mkAsset(ctx, user.id);

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(true);
  });

  it('E14/E14b: membership revoked then re-added — assets return while revoked; the old hide re-applies on re-add', async () => {
    const { ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'E14' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    await spaceRepo.hideAlbumForUser(space.id, album.id, user.id);

    const whileMember = await spaceRepo.getTimelineHiddenScope(user.id);
    expect(whileMember.hiddenAlbumIds).toContain(album.id);

    // Revoke membership — the row is untouched (§5.1), but resolution is membership-scoped.
    await defaultDatabase
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', user.id)
      .execute();
    const whileRevoked = await spaceRepo.getTimelineHiddenScope(user.id);
    expect(whileRevoked.hiddenAlbumIds).not.toContain(album.id);
    // The row itself is still there, inert — E14 asks for this explicitly, not just an absent id.
    const rowStillThere = await defaultDatabase
      .selectFrom('shared_space_album_hidden')
      .selectAll()
      .where('spaceId', '=', space.id)
      .where('albumId', '=', album.id)
      .where('userId', '=', user.id)
      .executeTakeFirst();
    expect(rowStillThere).toBeDefined();

    // Re-add — the old preference applies again (E14b, the documented consequence of E14).
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const afterReAdd = await spaceRepo.getTimelineHiddenScope(user.id);
    expect(afterReAdd.hiddenAlbumIds).toContain(album.id);
  });

  it('E15: I am the space creator — resolution finds me (the guaranteed Owner member row)', async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    // newSharedSpace alone (no explicit newSharedSpaceMember) — mirrors shared-space.service.ts's
    // creation flow, which inserts the Owner member row itself.
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await defaultDatabase
      .insertInto('shared_space_member')
      .values({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner, showInTimeline: true })
      .execute();
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'E15' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    const asset = await mkAsset(ctx, user.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await spaceRepo.hideAlbumForUser(space.id, album.id, user.id);

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(false);
  });

  it('E16: album linked to a space I am NOT a member of — not hidden (every set is membership-scoped)', async () => {
    const { sut, ctx } = setupTimeline();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const auth = factory.auth({ user });
    await giveASecondVisibleSpace(ctx, user.id);

    const { space } = await ctx.newSharedSpace({ createdById: stranger.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: stranger.id, showInTimeline: true });
    // user is a member of NO space here besides the unrelated second one.
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'E16' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    const asset = await mkAsset(ctx, user.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    // Bypass the service-level membership gate and write the row directly, exactly as rule 1's
    // resolution-layer test does — the point is that resolution ignores it regardless.
    await spaceRepo.hideAlbumForUser(space.id, album.id, user.id);

    const ids = await idsInBucket(sut, auth, { withSharedSpaces: true });
    expect(ids.has(asset.id)).toBe(true);
  });
});

// ── slice 9: folder view ────────────────────────────────────────────────────

const setupView = () =>
  newMediumService(ViewService, {
    database: defaultDatabase,
    real: [ViewRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });

const mkPathAsset = async (ctx: MediumTestContext, ownerId: string, subdir: string, basePath: string) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    originalPath: `${basePath}/${subdir}/photo.jpg`,
    fileCreatedAt: WHEN,
    localDateTime: WHEN,
  });
  await ctx.newExif({ assetId: asset.id, timeZone: 'UTC' });
  return asset;
};

describe('#1041 slice 9 — folder view (getUniqueOriginalPaths)', () => {
  it('S2 equivalent: only in an album I hid, in a space I show — path absent', async () => {
    const { sut, ctx } = setupView();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    await giveASecondVisibleSpace(ctx, user.id);
    const basePath = `/view-s2-${Date.now()}`;

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'View-S2' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    const asset = await mkPathAsset(ctx, user.id, 'hidden-album', basePath);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await spaceRepo.hideAlbumForUser(space.id, album.id, user.id);

    const paths = await sut.getUniqueOriginalPaths(auth);
    expect(paths).not.toContain(`${basePath}/hidden-album`);
  });

  it('S5 equivalent: only in space S (direct); I hid S — path absent', async () => {
    const { sut, ctx } = setupView();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    await giveASecondVisibleSpace(ctx, user.id);
    const basePath = `/view-s5-${Date.now()}`;

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: false });
    const asset = await mkPathAsset(ctx, user.id, 'hidden-space', basePath);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const paths = await sut.getUniqueOriginalPaths(auth);
    expect(paths).not.toContain(`${basePath}/hidden-space`);
  });

  it('S6 equivalent: as S5, plus the asset is also direct in space T, T shown — path shows', async () => {
    const { sut, ctx } = setupView();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    const basePath = `/view-s6-${Date.now()}`;

    const { space: s } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: s.id, userId: user.id, showInTimeline: false });
    const { space: t } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: t.id, userId: user.id, showInTimeline: true });
    const asset = await mkPathAsset(ctx, user.id, 'both-spaces', basePath);
    await ctx.newSharedSpaceAsset({ spaceId: s.id, assetId: asset.id });
    await ctx.newSharedSpaceAsset({ spaceId: t.id, assetId: asset.id });

    const paths = await sut.getUniqueOriginalPaths(auth);
    expect(paths).toContain(`${basePath}/both-spaces`);
  });

  it("S12 equivalent: an editor hides album X from the space's Photos tab; I own assets in X — path still shows (the shared flag no longer reaches folder view)", async () => {
    const { sut, ctx } = setupView();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    const basePath = `/view-s12-${Date.now()}`;

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'View-S12' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    await spaceRepo.setAlbumShowInTimeline(space.id, album.id, false);
    const asset = await mkPathAsset(ctx, user.id, 'shared-flag-off', basePath);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    const paths = await sut.getUniqueOriginalPaths(auth);
    expect(paths).toContain(`${basePath}/shared-flag-off`);
  });
});

// ── slice 13: memories ───────────────────────────────────────────────────────

const setupMemory = () =>
  newMediumService(MemoryService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AssetRepository,
      ConfigRepository,
      MemoryRepository,
      PartnerRepository,
      PersonRepository,
      SharedSpaceRepository,
      SystemMetadataRepository,
      UserRepository,
    ],
    mock: [LoggingRepository],
  });

describe('#1041 slice 13 — memories', () => {
  it('S2 equivalent: only in an album I hid, in a space I show — leaves the memory immediately', async () => {
    const { sut, ctx } = setupMemory();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    await giveASecondVisibleSpace(ctx, user.id);

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Mem-S2' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    const hiddenAsset = await mkAsset(ctx, user.id);
    const otherAsset = await mkAsset(ctx, user.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: hiddenAsset.id });

    const { result: memory } = await ctx.newMemory({ ownerId: user.id });
    await ctx.newMemoryAsset({ memoryId: memory.id, assetId: hiddenAsset.id });
    await ctx.newMemoryAsset({ memoryId: memory.id, assetId: otherAsset.id });

    // Hide AFTER the memory already includes the asset — proves the filter runs at DISPLAY time,
    // not only at the next generation pass (§4).
    await spaceRepo.hideAlbumForUser(space.id, album.id, user.id);

    const memories = await sut.search(auth, {});
    const mine = memories.find((m) => m.id === memory.id);
    expect(mine).toBeDefined();
    const assetIds = new Set(mine!.assets.map((a) => a.id));
    expect(assetIds.has(hiddenAsset.id)).toBe(false);
    expect(assetIds.has(otherAsset.id)).toBe(true);
  });

  it('S5 equivalent: only in space S (direct); I hid S — leaves the memory', async () => {
    const { sut, ctx } = setupMemory();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    await giveASecondVisibleSpace(ctx, user.id);

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: false });
    const hiddenAsset = await mkAsset(ctx, user.id);
    const otherAsset = await mkAsset(ctx, user.id);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: hiddenAsset.id });

    const { result: memory } = await ctx.newMemory({ ownerId: user.id });
    await ctx.newMemoryAsset({ memoryId: memory.id, assetId: hiddenAsset.id });
    await ctx.newMemoryAsset({ memoryId: memory.id, assetId: otherAsset.id });

    const memories = await sut.search(auth, {});
    const mine = memories.find((m) => m.id === memory.id);
    expect(mine).toBeDefined();
    const assetIds = new Set(mine!.assets.map((a) => a.id));
    expect(assetIds.has(hiddenAsset.id)).toBe(false);
    expect(assetIds.has(otherAsset.id)).toBe(true);
  });

  it('E10 equivalent: a partner-owned asset in an album I hid still shows in MY memories (the partner trap)', async () => {
    const { sut, ctx } = setupMemory();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const partnerRepo = ctx.get(PartnerRepository);
    const { user } = await ctx.newUser();
    const { user: partner } = await ctx.newUser();
    const auth = factory.auth({ user });
    await partnerRepo.create({ sharedById: partner.id, sharedWithId: user.id, inTimeline: true });
    await giveASecondVisibleSpace(ctx, user.id);

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: partner.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Mem-E10' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    await spaceRepo.hideAlbumForUser(space.id, album.id, user.id);

    const myHiddenAsset = await mkAsset(ctx, user.id);
    const partnerAsset = await mkAsset(ctx, partner.id);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: myHiddenAsset.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: partnerAsset.id });

    const { result: memory } = await ctx.newMemory({ ownerId: user.id });
    await ctx.newMemoryAsset({ memoryId: memory.id, assetId: myHiddenAsset.id });
    await ctx.newMemoryAsset({ memoryId: memory.id, assetId: partnerAsset.id });

    const memories = await sut.search(auth, {});
    const mine = memories.find((m) => m.id === memory.id);
    expect(mine).toBeDefined();
    const assetIds = new Set(mine!.assets.map((a) => a.id));
    expect(assetIds.has(myHiddenAsset.id)).toBe(false);
    expect(assetIds.has(partnerAsset.id)).toBe(true);
  });
});
