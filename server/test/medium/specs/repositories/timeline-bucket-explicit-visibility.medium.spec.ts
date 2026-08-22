/**
 * Fix A — Timeline bucket explicit-`visibility` bypass (content leak regression lock).
 *
 * The leak: `getTimeBuckets` / `getTimeBucket` / `getTimeBucketCovers` gate visibility
 * through `withDefaultVisibility` ONLY when `options.visibility === undefined`. When the
 * caller passes an explicit `visibility` (e.g. `visibility=HIDDEN` or `visibility=LOCKED`),
 * the top-level filter becomes `asset.visibility = <requested>` and the space-membership
 * branches (`spaceId`, `timelineSpaceIds`, `spacePersonIds`) carry NO independent visibility
 * gate — so `visibility=HIDDEN AND spaceReachable` surfaces OTHER members' Hidden/Locked
 * in-space assets (id + thumbhash + EXIF/GPS).
 *
 * The fix mirrors `searchAssetBuilder`: every space branch ANDs an independent
 * `eb.or([ ownerId ∈ userIds, spaceVisibilityGate(eb) ])` so an explicit `visibility=HIDDEN`
 * can only surface the CALLER'S OWN hidden rows, never other members'.
 *
 * These tests exercise the repository directly (bypassing the service-level guards) because
 * the leak is in the repository query itself — the primary defense must hold there.
 */

import { Kysely } from 'kysely';
import { AssetVisibility, TimeBucketSize } from 'src/enum';
import { AssetRepository, TimeBucketOptions } from 'src/repositories/asset.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { factory, newEmbedding } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [AssetRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });
  return {
    ctx,
    assetRepo: ctx.get(AssetRepository),
    spaceRepo: ctx.get(SharedSpaceRepository),
  };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const WHEN = new Date('2024-05-15T12:00:00.000Z');
const BUCKET = '2024-01-01'; // Year bucket start for WHEN

// Build an asset that is timeline-bucket-ready (has EXIF, fileCreatedAt/localDateTime, thumbhash).
const makeBucketAsset = async (
  ctx: ReturnType<typeof setup>['ctx'],
  ownerId: string,
  vis: AssetVisibility,
  opts: { libraryId?: string } = {},
) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    visibility: vis,
    fileCreatedAt: WHEN,
    localDateTime: WHEN,
    width: 400,
    height: 300,
    thumbhash: Buffer.from('t'),
    ...opts,
  });
  await ctx.newExif({ assetId: asset.id, timeZone: 'UTC', latitude: 48.8566, longitude: 2.3522, fileSizeInByte: 1024 });
  return asset.id;
};

const countBuckets = (buckets: Array<{ count: number }>) => buckets.reduce((sum, b) => sum + Number(b.count), 0);

// getTimeBucket returns a pre-jsonified `{ assets: string }` — parse the id array out of it.
const bucketAssetIds = async (
  assetRepo: AssetRepository,
  timeBucket: string,
  options: TimeBucketOptions,
  authUserId: string,
): Promise<Set<string>> => {
  const auth = { user: { id: authUserId } } as any;
  const { assets } = await assetRepo.getTimeBucket(timeBucket, options, auth);
  const ids = new Set<string>();
  const parsed = JSON.parse(assets) as { id: string[] };
  for (const id of parsed.id ?? []) {
    ids.add(id);
  }
  return ids;
};

// Build a space person whose faces sit on the given assets.
const seedSpacePerson = async (
  ctx: ReturnType<typeof setup>['ctx'],
  spaceRepo: SharedSpaceRepository,
  spaceId: string,
  faceAssetIds: string[],
) => {
  const faceIds: string[] = [];
  for (const assetId of faceAssetIds) {
    const { result: faceId } = await ctx.newAssetFace({ assetId });
    await ctx.database.insertInto('face_search').values({ faceId, embedding: newEmbedding() }).execute();
    faceIds.push(faceId);
  }
  const person = await spaceRepo.createPerson({
    spaceId,
    name: 'BucketPerson',
    representativeFaceId: faceIds[0],
    type: 'person',
  });
  await spaceRepo.addPersonFaces(
    faceIds.map((assetFaceId) => ({ personId: person.id, assetFaceId })),
    { skipRecount: true },
  );
  return person;
};

// ─────────────────────────────────────────────────────────────────────────────
// PATH 1: spaceId browse (userIds === undefined — pure space browse as a member)
// ─────────────────────────────────────────────────────────────────────────────

describe('timeline bucket explicit-visibility — spaceId browse (no userIds)', () => {
  it("visibility=HIDDEN does NOT surface another member's Hidden in-space assets (direct/library/album)", async () => {
    const { assetRepo, spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    // Direct-add Hidden
    const hiDirect = await makeBucketAsset(ctx, owner.id, AssetVisibility.Hidden);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: hiDirect });

    // Library-linked Hidden
    const { result: library } = await ctx.newLibrary({ ownerId: owner.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    const hiLib = await makeBucketAsset(ctx, owner.id, AssetVisibility.Hidden, { libraryId: library.id });

    // Album (showInTimeline=true) Hidden
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'HiddenLeakAlbum' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    const hiAlbum = await makeBucketAsset(ctx, owner.id, AssetVisibility.Hidden);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: hiAlbum });

    const opts: TimeBucketOptions = {
      spaceId: space.id,
      visibility: AssetVisibility.Hidden,
      bucketSize: TimeBucketSize.Year,
    };

    // getTimeBuckets — count must be 0 (no other-member Hidden leaks)
    expect(countBuckets(await assetRepo.getTimeBuckets(opts, factory.auth()))).toBe(0);

    // getTimeBucket — none of the ids present
    const ids = await bucketAssetIds(assetRepo, BUCKET, opts, viewer.id);
    expect(ids.has(hiDirect)).toBe(false);
    expect(ids.has(hiLib)).toBe(false);
    expect(ids.has(hiAlbum)).toBe(false);

    // getTimeBucketCovers — no cover produced
    const covers = await assetRepo.getTimeBucketCovers({ ...opts, timeBuckets: [BUCKET] });
    const coverIds = new Set(covers.map((c) => c.representativeAssetId));
    expect(coverIds.has(hiDirect)).toBe(false);
    expect(coverIds.has(hiLib)).toBe(false);
    expect(coverIds.has(hiAlbum)).toBe(false);
  });

  it("visibility=LOCKED does NOT surface another member's Locked in-space asset", async () => {
    const { assetRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const loDirect = await makeBucketAsset(ctx, owner.id, AssetVisibility.Locked);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: loDirect });

    const opts: TimeBucketOptions = {
      spaceId: space.id,
      visibility: AssetVisibility.Locked,
      bucketSize: TimeBucketSize.Year,
    };
    expect(countBuckets(await assetRepo.getTimeBuckets(opts, factory.auth()))).toBe(0);
  });

  it('regression: visibility=Timeline space assets are STILL present (no over-block)', async () => {
    const { assetRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const tl = await makeBucketAsset(ctx, owner.id, AssetVisibility.Timeline);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: tl });

    const opts: TimeBucketOptions = {
      spaceId: space.id,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Year,
    };
    expect(countBuckets(await assetRepo.getTimeBuckets(opts, factory.auth()))).toBe(1);
    const ids = await bucketAssetIds(assetRepo, BUCKET, opts, owner.id);
    expect(ids.has(tl)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATH 2: withSharedSpaces (userIds = [caller] + timelineSpaceIds = [space])
// ─────────────────────────────────────────────────────────────────────────────

describe('timeline bucket explicit-visibility — withSharedSpaces (timelineSpaceIds)', () => {
  it("visibility=HIDDEN does NOT surface another member's Hidden in-space asset", async () => {
    const { assetRepo, spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    // owner's Hidden reachable via the space (direct + album)
    const hiDirect = await makeBucketAsset(ctx, owner.id, AssetVisibility.Hidden);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: hiDirect });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'SharedHiddenAlbum' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    const hiAlbum = await makeBucketAsset(ctx, owner.id, AssetVisibility.Hidden);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: hiAlbum });

    const opts: TimeBucketOptions = {
      userIds: [viewer.id],
      timelineSpaceIds: [space.id],
      visibility: AssetVisibility.Hidden,
      bucketSize: TimeBucketSize.Year,
    };

    expect(countBuckets(await assetRepo.getTimeBuckets(opts, factory.auth()))).toBe(0);

    const ids = await bucketAssetIds(assetRepo, BUCKET, opts, viewer.id);
    expect(ids.has(hiDirect)).toBe(false);
    expect(ids.has(hiAlbum)).toBe(false);

    const covers = await assetRepo.getTimeBucketCovers({ ...opts, timeBuckets: [BUCKET] });
    const coverIds = new Set(covers.map((c) => c.representativeAssetId));
    expect(coverIds.has(hiDirect)).toBe(false);
    expect(coverIds.has(hiAlbum)).toBe(false);
  });

  it("OWN Hidden is NOT over-blocked: caller's own Hidden asset via space IS returned", async () => {
    const { assetRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const ownHidden = await makeBucketAsset(ctx, owner.id, AssetVisibility.Hidden);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: ownHidden });

    // Caller IS the owner and asks for their own Hidden with the space in scope.
    const opts: TimeBucketOptions = {
      userIds: [owner.id],
      timelineSpaceIds: [space.id],
      visibility: AssetVisibility.Hidden,
      bucketSize: TimeBucketSize.Year,
    };
    expect(countBuckets(await assetRepo.getTimeBuckets(opts, factory.auth()))).toBe(1);
    const ids = await bucketAssetIds(assetRepo, BUCKET, opts, owner.id);
    expect(ids.has(ownHidden)).toBe(true);
  });

  it("regression: another member's Timeline in-space asset is STILL present", async () => {
    const { assetRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const tl = await makeBucketAsset(ctx, owner.id, AssetVisibility.Timeline);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: tl });

    const opts: TimeBucketOptions = {
      userIds: [viewer.id],
      timelineSpaceIds: [space.id],
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Year,
    };
    const ids = await bucketAssetIds(assetRepo, BUCKET, opts, viewer.id);
    expect(ids.has(tl)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATH 3: spacePersonIds (a space person's faces on another member's Hidden asset)
// ─────────────────────────────────────────────────────────────────────────────

describe('timeline bucket explicit-visibility — spacePersonIds path', () => {
  it("visibility=HIDDEN via a space person does NOT surface another member's Hidden asset", async () => {
    const { assetRepo, spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    // A space person whose faces sit on a Timeline (ok) AND a Hidden (must not leak) asset.
    const tlAsset = await makeBucketAsset(ctx, owner.id, AssetVisibility.Timeline);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: tlAsset });
    const hiAsset = await makeBucketAsset(ctx, owner.id, AssetVisibility.Hidden);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: hiAsset });

    const person = await seedSpacePerson(ctx, spaceRepo, space.id, [tlAsset, hiAsset]);

    const opts: TimeBucketOptions = {
      spaceId: space.id,
      spacePersonIds: [person.id],
      visibility: AssetVisibility.Hidden,
      bucketSize: TimeBucketSize.Year,
    };

    expect(countBuckets(await assetRepo.getTimeBuckets(opts, factory.auth()))).toBe(0);
    const ids = await bucketAssetIds(assetRepo, BUCKET, opts, viewer.id);
    expect(ids.has(hiAsset)).toBe(false);
  });

  it('regression: visibility=Timeline via a space person STILL returns the Timeline asset', async () => {
    const { assetRepo, spaceRepo, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const tlAsset = await makeBucketAsset(ctx, owner.id, AssetVisibility.Timeline);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: tlAsset });
    const person = await seedSpacePerson(ctx, spaceRepo, space.id, [tlAsset]);

    const opts: TimeBucketOptions = {
      spaceId: space.id,
      spacePersonIds: [person.id],
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Year,
    };
    const ids = await bucketAssetIds(assetRepo, BUCKET, opts, owner.id);
    expect(ids.has(tlAsset)).toBe(true);
  });
});

// Seed an album (owner + viewer via a shared space) carrying one asset per visibility.
const seedAlbum = async (ctx: ReturnType<typeof setup>['ctx'], spaceRepo: ReturnType<typeof setup>['spaceRepo']) => {
  const { user: owner } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

  const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'AlbumArm' });
  await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

  const hidden = await makeBucketAsset(ctx, owner.id, AssetVisibility.Hidden);
  const locked = await makeBucketAsset(ctx, owner.id, AssetVisibility.Locked);
  const archive = await makeBucketAsset(ctx, owner.id, AssetVisibility.Archive);
  const timeline = await makeBucketAsset(ctx, owner.id, AssetVisibility.Timeline);
  for (const assetId of [hidden, locked, archive, timeline]) {
    await ctx.newAlbumAsset({ albumId: album.id, assetId });
  }

  return { owner, viewer, album, hidden, locked, archive, timeline };
};

// ─────────────────────────────────────────────────────────────────────────────
// PATH 4: albumId arm (explicit visibility bypasses withDefaultVisibility)
// ─────────────────────────────────────────────────────────────────────────────

describe('timeline bucket explicit-visibility — albumId arm', () => {
  it('visibility=HIDDEN via albumId surfaces NO Hidden album asset (viewer OR owner — flat gate)', async () => {
    const { assetRepo, spaceRepo, ctx } = setup();
    const s = await seedAlbum(ctx, spaceRepo);

    const opts: TimeBucketOptions = {
      albumId: s.album.id,
      visibility: AssetVisibility.Hidden,
      bucketSize: TimeBucketSize.Year,
    };

    expect(countBuckets(await assetRepo.getTimeBuckets(opts, factory.auth()))).toBe(0);

    const asViewer = await bucketAssetIds(assetRepo, BUCKET, opts, s.viewer.id);
    expect(asViewer.has(s.hidden)).toBe(false);

    // Flat: even the album owner does not see their own Hidden via the album arm.
    const asOwner = await bucketAssetIds(assetRepo, BUCKET, opts, s.owner.id);
    expect(asOwner.has(s.hidden)).toBe(false);
  });

  it('visibility=LOCKED via albumId surfaces NO Locked album asset', async () => {
    const { assetRepo, spaceRepo, ctx } = setup();
    const s = await seedAlbum(ctx, spaceRepo);

    const opts: TimeBucketOptions = {
      albumId: s.album.id,
      visibility: AssetVisibility.Locked,
      bucketSize: TimeBucketSize.Year,
    };

    expect(countBuckets(await assetRepo.getTimeBuckets(opts, factory.auth()))).toBe(0);
    const ids = await bucketAssetIds(assetRepo, BUCKET, opts, s.viewer.id);
    expect(ids.has(s.locked)).toBe(false);
  });

  it('regression: visibility=Timeline via albumId STILL returns the Timeline album asset', async () => {
    const { assetRepo, spaceRepo, ctx } = setup();
    const s = await seedAlbum(ctx, spaceRepo);

    const opts: TimeBucketOptions = {
      albumId: s.album.id,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Year,
    };

    const ids = await bucketAssetIds(assetRepo, BUCKET, opts, s.viewer.id);
    expect(ids.has(s.timeline)).toBe(true);
  });

  it('regression: visibility=Archive via albumId STILL returns the Archive album asset (Archive is shareable)', async () => {
    const { assetRepo, spaceRepo, ctx } = setup();
    const s = await seedAlbum(ctx, spaceRepo);

    const opts: TimeBucketOptions = {
      albumId: s.album.id,
      visibility: AssetVisibility.Archive,
      bucketSize: TimeBucketSize.Year,
    };

    const ids = await bucketAssetIds(assetRepo, BUCKET, opts, s.viewer.id);
    expect(ids.has(s.archive)).toBe(true);
  });
});
