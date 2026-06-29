import { Kysely } from 'kysely';
import { StorageCore } from 'src/cores/storage.core';
import { AssetVisibility, JobName, JobStatus, TimeBucketSize } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AlbumUserRepository } from 'src/repositories/album-user.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PartnerRepository } from 'src/repositories/partner.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { AlbumService } from 'src/services/album.service';
import { SharedSpaceService } from 'src/services/shared-space.service';
import { TimelineService } from 'src/services/timeline.service';
import { UserAdminService } from 'src/services/user-admin.service';
import { UserService } from 'src/services/user.service';
import { newMediumService } from 'test/medium.factory';
import { factory, newEmbedding } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';
import { Mocked } from 'vitest';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const result = newMediumService(SharedSpaceService, {
    database: defaultDatabase,
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
  result.ctx.getMock(JobRepository).queue.mockResolvedValue();
  return result;
};

/** Full setup with face-matching repos wired in (mirrors shared-space-face-identity-repair.spec.ts) */
const setupWithFaceMatch = () => {
  const result = newMediumService(SharedSpaceService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      AlbumUserRepository,
      AssetRepository,
      SharedSpaceRepository,
      UserRepository,
      FaceIdentityRepository,
      PersonRepository,
      ConfigRepository,
      SystemMetadataRepository,
      SearchRepository,
    ],
    mock: [EventRepository, LoggingRepository, JobRepository, StorageRepository],
  });
  const jobs = result.ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  jobs.queue.mockResolvedValue();
  jobs.queueAll.mockResolvedValue();
  jobs.hasInFlightDedupChain.mockResolvedValue(false);
  return { ...result, jobs, faceIdentityRepository: result.ctx.get(FaceIdentityRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const authFromUser = (actor: { id: string; email: string }) =>
  factory.auth({ user: { id: actor.id, email: actor.email } });

describe('SharedSpaceService — getLinkedAlbums', () => {
  it('returns linked album DTO with correct assetCount for a member', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Linked Album' });

    // Add 3 assets to the album
    const { asset: a1 } = await ctx.newAsset({ ownerId: owner.id });
    const { asset: a2 } = await ctx.newAsset({ ownerId: owner.id });
    const { asset: a3 } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a2.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a3.id });

    // Link album to space
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const viewerAuth = authFromUser(viewer);
    const links = await sut.getLinkedAlbums(viewerAuth, space.id);

    expect(links).toHaveLength(1);
    const link = links[0];
    expect(link.albumId).toBe(album.id);
    expect(link.albumName).toBe('Linked Album');
    expect(link.showInTimeline).toBe(true);
    expect(link.assetCount).toBe(3);
    expect(link.addedById).toBe(owner.id);
    expect(typeof link.createdAt).toBe('string');
  });

  it('returns empty array when no albums are linked', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const ownerAuth = authFromUser(owner);
    const links = await sut.getLinkedAlbums(ownerAuth, space.id);

    expect(links).toHaveLength(0);
  });

  it('rejects non-member with ForbiddenException', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: nonMember } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const nonMemberAuth = authFromUser(nonMember);
    await expect(sut.getLinkedAlbums(nonMemberAuth, space.id)).rejects.toThrow();
  });
});

describe('SharedSpaceService — unlinkAlbum face retention', () => {
  it('removes faces for album-only assets but retains faces for assets with another space path', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });

    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'FaceTestAlbum' });

    // a1: only reachable via album A — face should be REMOVED on unlink
    const { asset: a1 } = await ctx.newAsset({ ownerId: user.id });
    // a2: reachable via album A AND directly added to space — face should be RETAINED
    const { asset: a2 } = await ctx.newAsset({ ownerId: user.id });

    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a2.id });

    // Link album to space
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    // Direct-add a2 to space
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: a2.id });

    // Create asset faces for a1 and a2
    const { result: face1Id } = await ctx.newAssetFace({ assetId: a1.id });
    const { result: face2Id } = await ctx.newAssetFace({ assetId: a2.id });

    // Create a space person and link both faces to it
    const spacePersonRepo = ctx.get(SharedSpaceRepository);
    const spacePerson = await spacePersonRepo.createPerson({
      spaceId: space.id,
      name: 'Test Person',
      type: 'person',
      representativeFaceId: null,
    });
    await spacePersonRepo.addPersonFaces([
      { personId: spacePerson.id, assetFaceId: face1Id },
      { personId: spacePerson.id, assetFaceId: face2Id },
    ]);

    // Verify both faces exist before unlinking
    const facesBefore = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('personId', '=', spacePerson.id)
      .execute();
    expect(facesBefore.map((f) => f.assetFaceId)).toContain(face1Id);
    expect(facesBefore.map((f) => f.assetFaceId)).toContain(face2Id);

    // Unlink the album
    await sut.unlinkAlbum(authFromUser(user), space.id, album.id);

    // After unlink: face1 (album-only asset) should be gone, face2 (direct path) should remain
    const facesAfter = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('personId', '=', spacePerson.id)
      .execute();
    expect(facesAfter.map((f) => f.assetFaceId)).not.toContain(face1Id);
    expect(facesAfter.map((f) => f.assetFaceId)).toContain(face2Id);
  });

  it('retains faces for assets that are in a second album also linked to the space (two-album path)', async () => {
    // Asset `a` is in album A AND album B, both linked to space S.
    // A shared_space_person_face exists for `a`'s face.
    // Unlinking album A must NOT remove the face because album B still links `a`
    // into the space — getAlbumAssetIdsWithoutOtherSpacePath excludes it.
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });

    const { result: albumA } = await ctx.newAlbum({ ownerId: user.id, albumName: 'TwoAlbum-A' });
    const { result: albumB } = await ctx.newAlbum({ ownerId: user.id, albumName: 'TwoAlbum-B' });

    const { asset: a } = await ctx.newAsset({ ownerId: user.id });
    // `a` belongs to BOTH albums
    await ctx.newAlbumAsset({ albumId: albumA.id, assetId: a.id });
    await ctx.newAlbumAsset({ albumId: albumB.id, assetId: a.id });

    // Link BOTH albums to the space
    const spacePersonRepo = ctx.get(SharedSpaceRepository);
    await spacePersonRepo.addAlbum({ spaceId: space.id, albumId: albumA.id, addedById: user.id });
    await spacePersonRepo.addAlbum({ spaceId: space.id, albumId: albumB.id, addedById: user.id });

    // Seed an asset face for `a` and link it to a space person
    const { result: faceId } = await ctx.newAssetFace({ assetId: a.id });
    const spacePerson = await spacePersonRepo.createPerson({
      spaceId: space.id,
      name: 'TwoAlbumPerson',
      type: 'person',
      representativeFaceId: null,
    });
    await spacePersonRepo.addPersonFaces([{ personId: spacePerson.id, assetFaceId: faceId }]);

    // Verify face exists before unlink
    const facesBefore = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('personId', '=', spacePerson.id)
      .execute();
    expect(facesBefore.map((f) => f.assetFaceId)).toContain(faceId);

    // Unlink album A — album B still links `a` so the face must be retained
    await sut.unlinkAlbum(authFromUser(user), space.id, albumA.id);

    const facesAfter = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('personId', '=', spacePerson.id)
      .execute();
    expect(facesAfter.map((f) => f.assetFaceId)).toContain(faceId);
  });

  it('deletes space persons that have no remaining faces after unlink', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });

    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'OrphanTestAlbum' });
    const { asset: a1 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    const { result: faceId } = await ctx.newAssetFace({ assetId: a1.id });

    const spacePersonRepo = ctx.get(SharedSpaceRepository);
    const spacePerson = await spacePersonRepo.createPerson({
      spaceId: space.id,
      name: '',
      representativeFaceId: null,
    });
    await spacePersonRepo.addPersonFaces([{ personId: spacePerson.id, assetFaceId: faceId }]);

    // Unlink — a1 has no other path, so the space person should be deleted as orphaned
    await sut.unlinkAlbum(authFromUser(user), space.id, album.id);

    const remaining = await defaultDatabase
      .selectFrom('shared_space_person')
      .select('id')
      .where('id', '=', spacePerson.id)
      .execute();
    expect(remaining).toHaveLength(0);
  });
});

describe('SharedSpaceService — handleSharedSpaceAlbumFaceSync', () => {
  it('returns Skipped when face recognition is disabled', async () => {
    const { ctx, sut } = setupWithFaceMatch();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: false });

    const result = await sut.handleSharedSpaceAlbumFaceSync({ spaceId: space.id, albumId: 'any-album-id' });

    expect(result).toBe(JobStatus.Skipped);
  });

  it('returns Skipped when album not linked to space', async () => {
    const { ctx, sut } = setupWithFaceMatch();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Unlinked' });

    // Album is NOT linked to the space
    const result = await sut.handleSharedSpaceAlbumFaceSync({ spaceId: space.id, albumId: album.id });

    expect(result).toBe(JobStatus.Skipped);
  });

  it('matches album faces into space persons when recognition enabled', async () => {
    const { ctx, sut, faceIdentityRepository, jobs } = setupWithFaceMatch();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });

    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'FaceSyncAlbum' });

    // Create a person + identity for Layer 1 matching
    const { result: person } = await ctx.newPerson({ ownerId: user.id, name: 'AlbumPerson' });
    const identity = await faceIdentityRepository.ensurePersonIdentity(person.id);

    // Create asset, add to album, seed face + identity link
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
    await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: newEmbedding() }).execute();
    await faceIdentityRepository.linkFace({
      assetFaceId: assetFace.id,
      identityId: identity.id,
      source: 'owner-person',
    });

    // Link album to space
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    const result = await sut.handleSharedSpaceAlbumFaceSync({ spaceId: space.id, albumId: album.id });

    expect(result).toBe(JobStatus.Success);

    const spacePersons = await defaultDatabase
      .selectFrom('shared_space_person')
      .select('id')
      .where('spaceId', '=', space.id)
      .execute();
    expect(spacePersons.length).toBeGreaterThan(0);

    expect(jobs.queue).toHaveBeenCalledWith(
      expect.objectContaining({ name: JobName.SharedSpaceIdentityReconciliation, data: { spaceId: space.id } }),
    );
    expect(jobs.queue).toHaveBeenCalledWith(
      expect.objectContaining({ name: JobName.SharedSpacePersonDedup, data: { spaceId: space.id } }),
    );
  });

  it('returns Success and queues dedup when album has assets but no matchable faces', async () => {
    const { ctx, sut, jobs } = setupWithFaceMatch();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });

    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'NoFaceAlbum' });
    // Asset with a raw face (no personId, no identity link) — not matchable
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newAssetFace({ assetId: asset.id }); // no personId

    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    const result = await sut.handleSharedSpaceAlbumFaceSync({ spaceId: space.id, albumId: album.id });

    expect(result).toBe(JobStatus.Success);
    expect(jobs.queue).toHaveBeenCalledWith(
      expect.objectContaining({ name: JobName.SharedSpacePersonDedup, data: { spaceId: space.id } }),
    );
  });
});

const setupTimeline = () =>
  newMediumService(TimelineService, {
    database: defaultDatabase,
    real: [AccessRepository, AssetRepository, PartnerRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });

describe('SharedSpaceService — linked-album assets in space timeline', () => {
  it('includes album assets when showInTimeline is true, excludes them when false', async () => {
    const { sut, ctx } = setupTimeline();

    // Owner creates the space and album
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    // Both owner and viewer are members with showInTimeline=true (default)
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    // Create album owned by owner, link it to the space (showInTimeline defaults true)
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'SpaceAlbum' });
    const { asset: assetInA } = await ctx.newAsset({
      ownerId: owner.id,
      localDateTime: new Date('2024-03-15T12:00:00.000Z'),
      fileCreatedAt: new Date('2024-03-15T12:00:00.000Z'),
      visibility: AssetVisibility.Timeline,
    });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: assetInA.id });
    await ctx.newExif({ assetId: assetInA.id, make: 'Canon' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    // Viewer reads the space timeline — asset should appear (showInTimeline=true)
    const viewerAuth = factory.auth({ user: { id: viewer.id, email: viewer.email } });
    const bucketsOn = await sut.getTimeBuckets(viewerAuth, {
      userId: viewer.id,
      withSharedSpaces: true,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Month,
    });
    const bucketOn = bucketsOn.find((b) => b.timeBucket === '2024-03-01');
    expect(bucketOn?.count).toBe(1);

    const bucketRawOn = await sut.getTimeBucket(viewerAuth, {
      timeBucket: '2024-03-01',
      userId: viewer.id,
      withSharedSpaces: true,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Month,
    });
    const idsOn: string[] = JSON.parse(bucketRawOn).id;
    expect(idsOn).toContain(assetInA.id);

    // Toggle showInTimeline off for the album
    await ctx.get(SharedSpaceRepository).setAlbumShowInTimeline(space.id, album.id, false);

    // Viewer reads again — asset should no longer appear
    const bucketsOff = await sut.getTimeBuckets(viewerAuth, {
      userId: viewer.id,
      withSharedSpaces: true,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Month,
    });
    const bucketOff = bucketsOff.find((b) => b.timeBucket === '2024-03-01');
    expect(bucketOff?.count ?? 0).toBe(0);

    const bucketRawOff = await sut.getTimeBucket(viewerAuth, {
      timeBucket: '2024-03-01',
      userId: viewer.id,
      withSharedSpaces: true,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Month,
    });
    const idsOff: string[] = JSON.parse(bucketRawOff).id;
    expect(idsOff).not.toContain(assetInA.id);
  });
});

describe('SharedSpaceService — linked-album assets via direct spaceId timeline', () => {
  it('includes album assets when spaceId used directly and showInTimeline=true, excludes when false', async () => {
    const { sut, ctx } = setupTimeline();

    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'DirectSpaceAlbum' });
    const { asset: assetInA } = await ctx.newAsset({
      ownerId: owner.id,
      localDateTime: new Date('2024-05-10T12:00:00.000Z'),
      fileCreatedAt: new Date('2024-05-10T12:00:00.000Z'),
      visibility: AssetVisibility.Timeline,
    });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: assetInA.id });
    await ctx.newExif({ assetId: assetInA.id, make: 'Nikon' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const viewerAuth = factory.auth({ user: { id: viewer.id, email: viewer.email } });

    // --- showInTimeline=true: asset MUST appear via spaceId path ---
    const bucketsOn = await sut.getTimeBuckets(viewerAuth, {
      spaceId: space.id,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Month,
    });
    const bucketOn = bucketsOn.find((b) => b.timeBucket === '2024-05-01');
    expect(bucketOn?.count).toBe(1);

    const bucketRawOn = await sut.getTimeBucket(viewerAuth, {
      timeBucket: '2024-05-01',
      spaceId: space.id,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Month,
    });
    const idsOn: string[] = JSON.parse(bucketRawOn).id;
    expect(idsOn).toContain(assetInA.id);

    // Toggle showInTimeline off
    await ctx.get(SharedSpaceRepository).setAlbumShowInTimeline(space.id, album.id, false);

    // --- showInTimeline=false: asset MUST be absent ---
    const bucketsOff = await sut.getTimeBuckets(viewerAuth, {
      spaceId: space.id,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Month,
    });
    const bucketOff = bucketsOff.find((b) => b.timeBucket === '2024-05-01');
    expect(bucketOff?.count ?? 0).toBe(0);

    const bucketRawOff = await sut.getTimeBucket(viewerAuth, {
      timeBucket: '2024-05-01',
      spaceId: space.id,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Month,
    });
    const idsOff: string[] = JSON.parse(bucketRawOff).id;
    expect(idsOff).not.toContain(assetInA.id);
  });
});

describe('SharedSpaceService — space access lifecycle via album branch', () => {
  it('Test 1: removing asset from album revokes space access', async () => {
    const { ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'AccessTestAlbum' });
    const { asset: a1 } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const accessRepo = ctx.get(AccessRepository);

    // Before removal: a1 is accessible
    const before = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([a1.id]));
    expect(before).toContain(a1.id);

    // Remove a1 from the album
    await ctx.get(AlbumRepository).removeAssetIds(album.id, [a1.id]);

    // After removal: a1 is no longer accessible
    const after = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([a1.id]));
    expect(after).not.toContain(a1.id);
  });

  it('Test 2: removing from album does NOT revoke access when asset is also directly added', async () => {
    const { ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'DualPathAlbum' });
    const { asset: a2 } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a2.id });

    // Link album AND directly add the asset to the space
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: a2.id });

    const accessRepo = ctx.get(AccessRepository);

    // Confirm accessible before removal
    const before = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([a2.id]));
    expect(before).toContain(a2.id);

    // Remove from album — direct path should preserve access
    await ctx.get(AlbumRepository).removeAssetIds(album.id, [a2.id]);

    const after = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([a2.id]));
    expect(after).toContain(a2.id);
  });

  it('Test 3: hard-deleting album cascades link removal and revokes access', async () => {
    const { ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'HardDeleteAlbum' });
    const { asset: assetInA } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: assetInA.id });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const accessRepo = ctx.get(AccessRepository);

    // Confirm link and access exist before deletion
    const linkBefore = await ctx.get(SharedSpaceRepository).hasAlbumLink(space.id, album.id);
    expect(linkBefore).toBe(true);
    const accessBefore = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([assetInA.id]));
    expect(accessBefore).toContain(assetInA.id);

    // Hard-delete the album (FK ON DELETE CASCADE removes shared_space_album row)
    await defaultDatabase.deleteFrom('album').where('id', '=', album.id).execute();

    // Link should be gone (cascaded)
    const linkAfter = await ctx.get(SharedSpaceRepository).hasAlbumLink(space.id, album.id);
    expect(linkAfter).toBe(false);

    // Access should be revoked
    const accessAfter = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([assetInA.id]));
    expect(accessAfter).not.toContain(assetInA.id);
  });

  it('Test 4: soft-deleted asset is excluded from space access and timeline', async () => {
    const { sut: timelineSut, ctx } = setupTimeline();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'SoftDeleteAlbum' });
    const { asset: assetInA } = await ctx.newAsset({
      ownerId: owner.id,
      localDateTime: new Date('2024-07-20T12:00:00.000Z'),
      fileCreatedAt: new Date('2024-07-20T12:00:00.000Z'),
      visibility: AssetVisibility.Timeline,
    });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: assetInA.id });
    await ctx.newExif({ assetId: assetInA.id, make: 'Sony' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const viewerAuth = factory.auth({ user: { id: viewer.id, email: viewer.email } });

    // Access and timeline should include the asset before soft-delete
    const accessBefore = await ctx.get(AccessRepository).asset.checkSpaceAccess(viewer.id, new Set([assetInA.id]));
    expect(accessBefore).toContain(assetInA.id);

    const bucketsBefore = await timelineSut.getTimeBuckets(viewerAuth, {
      spaceId: space.id,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Month,
    });
    const bucketBefore = bucketsBefore.find((b) => b.timeBucket === '2024-07-01');
    expect(bucketBefore?.count).toBe(1);

    // Soft-delete the asset
    await ctx.softDeleteAsset(assetInA.id);

    // Access should be revoked
    const accessAfter = await ctx.get(AccessRepository).asset.checkSpaceAccess(viewer.id, new Set([assetInA.id]));
    expect(accessAfter).not.toContain(assetInA.id);

    // Asset should no longer appear in timeline
    const bucketsAfter = await timelineSut.getTimeBuckets(viewerAuth, {
      spaceId: space.id,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Month,
    });
    const bucketAfter = bucketsAfter.find((b) => b.timeBucket === '2024-07-01');
    expect(bucketAfter?.count ?? 0).toBe(0);
  });

  it('Test 5: live-photo video part is reachable via album branch', async () => {
    const { ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    // Create the motion video asset first (no livePhotoVideoId itself)
    const { asset: motion } = await ctx.newAsset({ ownerId: owner.id });
    // Create the still image that references the motion video
    const { asset: still } = await ctx.newAsset({ ownerId: owner.id, livePhotoVideoId: motion.id });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'LivePhotoAlbum' });
    // Only the still is added to the album; motion is reachable via livePhotoVideoId
    await ctx.newAlbumAsset({ albumId: album.id, assetId: still.id });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const accessRepo = ctx.get(AccessRepository);

    // The motion video should be accessible via the still's livePhotoVideoId
    const accessedIds = await accessRepo.asset.checkSpaceAccess(viewer.id, new Set([motion.id]));
    expect(accessedIds).toContain(motion.id);
  });

  it('Test 6: locked (Visibility.Locked) asset in linked album — checkSpaceAccess does NOT filter by visibility', async () => {
    // checkSpaceAccess does NOT filter asset.visibility for ANY space path (album/library/direct) —
    // this is pre-existing behavior inherited from libraries/direct adds, NOT introduced by space albums;
    // locked-asset exclusion across all space paths would be a separate cross-cutting change (out of scope)
    //
    // PARITY: album-linked Locked assets and direct-added Locked assets must behave identically —
    // both are returned by checkSpaceAccess with no visibility filtering applied on either path.
    const { ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'LockedAssetAlbum' });

    // album-linked Locked asset
    const { asset: albumLockedAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: albumLockedAsset.id });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    // direct-added Locked asset (no album involvement)
    const { asset: directLockedAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: directLockedAsset.id });

    const accessRepo = ctx.get(AccessRepository);
    const accessedIds = await accessRepo.asset.checkSpaceAccess(
      viewer.id,
      new Set([albumLockedAsset.id, directLockedAsset.id]),
    );

    // Pinned: both locked assets are returned — visibility is NOT filtered on either the album-branch or the direct-add path
    expect(accessedIds).toContain(albumLockedAsset.id);
    expect(accessedIds).toContain(directLockedAsset.id);
  });

  it('Test 7: empty album link is a no-op (zero assets, timeline unchanged)', async () => {
    // Use setupTimeline which includes SharedSpaceRepository needed for direct repo checks
    const { sut: timelineSut, ctx } = setupTimeline();

    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();

    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    // Link an empty album
    const { result: emptyAlbum } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'EmptyLinkedAlbum' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: emptyAlbum.id, addedById: owner.id });

    // getLinkedAlbums (via SharedSpaceRepository, same DB) should return the link with assetCount=0
    const linkedAlbums = await ctx.get(SharedSpaceRepository).getLinkedAlbums(space.id);
    const link = linkedAlbums.find((l) => l.albumId === emptyAlbum.id);
    expect(link).toBeDefined();
    const assetCount = await ctx.get(SharedSpaceRepository).getAlbumAssetCount(emptyAlbum.id);
    expect(assetCount).toBe(0);

    // Space timeline should have no assets
    const viewerAuth = factory.auth({ user: { id: viewer.id, email: viewer.email } });
    const buckets = await timelineSut.getTimeBuckets(viewerAuth, {
      spaceId: space.id,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Month,
    });
    expect(buckets).toHaveLength(0);
  });

  it('Test 8: face-sync on empty album returns Success with zero space persons created', async () => {
    // handleSharedSpaceAlbumFaceSync on an album with no assets must complete successfully
    // and must not create any shared_space_person rows for the space.
    const { ctx, sut } = setupWithFaceMatch();
    const { user: owner } = await ctx.newUser();

    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    // Link an empty album (no assets)
    const { result: emptyAlbum } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'EmptyFaceSyncAlbum' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: emptyAlbum.id, addedById: owner.id });

    const result = await sut.handleSharedSpaceAlbumFaceSync({ spaceId: space.id, albumId: emptyAlbum.id });

    expect(result).toBe(JobStatus.Success);

    // No space persons should have been created for this space
    const spacePersons = await defaultDatabase
      .selectFrom('shared_space_person')
      .select('id')
      .where('spaceId', '=', space.id)
      .execute();
    expect(spacePersons).toHaveLength(0);
  });
});

describe('onAlbumAssetsAdd (medium)', () => {
  it('queues face match for an album-only asset and produces a space person when run', async () => {
    const { ctx, sut, faceIdentityRepository, jobs } = setupWithFaceMatch();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'AddSyncAlbum' });

    const { result: person } = await ctx.newPerson({ ownerId: user.id, name: 'AddedPerson' });
    const identity = await faceIdentityRepository.ensurePersonIdentity(person.id);

    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
    await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: newEmbedding() }).execute();
    await faceIdentityRepository.linkFace({
      assetFaceId: assetFace.id,
      identityId: identity.id,
      source: 'owner-person',
    });

    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    // The event handler queues a per-asset face match for the face-enabled linked space.
    await sut.onAlbumAssetsAdd({ albumId: album.id, assetIds: [asset.id] });
    expect(jobs.queueAll).toHaveBeenCalledWith([
      { name: JobName.SharedSpaceFaceMatch, data: { spaceId: space.id, assetId: asset.id } },
    ]);

    // Running that match against the real DB creates the space person (linchpin: isAssetInSpace
    // recognises the album path, so processSpaceFaceMatch does NOT early-return).
    const status = await sut.handleSharedSpaceFaceMatch({ spaceId: space.id, assetId: asset.id });
    expect(status).toBe(JobStatus.Success);
    const spacePersons = await ctx.database
      .selectFrom('shared_space_person')
      .select('id')
      .where('spaceId', '=', space.id)
      .execute();
    expect(spacePersons.length).toBeGreaterThan(0);
  });
});

describe('onAlbumAssetsRemove (medium)', () => {
  it('removes faces for an album-only removed asset but retains faces for a removed asset with a direct path', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'RemoveSyncAlbum' });

    const { asset: a1 } = await ctx.newAsset({ ownerId: user.id }); // album-only → face removed
    const { asset: a2 } = await ctx.newAsset({ ownerId: user.id }); // album + direct → face retained

    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a2.id });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: a2.id });

    const { result: face1Id } = await ctx.newAssetFace({ assetId: a1.id });
    const { result: face2Id } = await ctx.newAssetFace({ assetId: a2.id });
    const repo = ctx.get(SharedSpaceRepository);
    const spacePerson = await repo.createPerson({
      spaceId: space.id,
      name: 'Test Person',
      type: 'person',
      representativeFaceId: null,
    });
    await repo.addPersonFaces([
      { personId: spacePerson.id, assetFaceId: face1Id },
      { personId: spacePerson.id, assetFaceId: face2Id },
    ]);

    // Simulate the real removeAssets ordering: album_asset rows for a1,a2 are deleted FIRST.
    await ctx.database
      .deleteFrom('album_asset')
      .where('albumId', '=', album.id)
      .where('assetId', 'in', [a1.id, a2.id])
      .execute();

    await sut.onAlbumAssetsRemove({ albumId: album.id, assetIds: [a1.id, a2.id] });

    const facesAfter = await ctx.database
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('personId', '=', spacePerson.id)
      .execute();
    const faceIds = facesAfter.map((f) => f.assetFaceId);
    expect(faceIds).not.toContain(face1Id);
    expect(faceIds).toContain(face2Id);
  });
});

describe('removeAssets (medium) — multi-path face retention', () => {
  it('retains face for asset still reachable via linked album after direct removal, removes face for direct-only asset', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'RemoveAssetsRetentionAlbum' });

    // assetX: direct-added AND in linked album → face must be RETAINED after removeAssets
    const { asset: assetX } = await ctx.newAsset({ ownerId: user.id });
    // assetY: direct-added ONLY → face must be REMOVED after removeAssets
    const { asset: assetY } = await ctx.newAsset({ ownerId: user.id });

    // Add assetX to the album
    await ctx.newAlbumAsset({ albumId: album.id, assetId: assetX.id });

    // Link album to space
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    // Direct-add both assets to space
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: assetX.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: assetY.id });

    // Create asset faces for assetX and assetY
    const { result: faceXId } = await ctx.newAssetFace({ assetId: assetX.id });
    const { result: faceYId } = await ctx.newAssetFace({ assetId: assetY.id });

    // Create a space person and link both faces to it
    const repo = ctx.get(SharedSpaceRepository);
    const spacePerson = await repo.createPerson({
      spaceId: space.id,
      name: 'MultiPathPerson',
      type: 'person',
      representativeFaceId: null,
    });
    await repo.addPersonFaces([
      { personId: spacePerson.id, assetFaceId: faceXId },
      { personId: spacePerson.id, assetFaceId: faceYId },
    ]);

    // Verify both faces exist before removal
    const facesBefore = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('personId', '=', spacePerson.id)
      .execute();
    expect(facesBefore.map((f) => f.assetFaceId)).toContain(faceXId);
    expect(facesBefore.map((f) => f.assetFaceId)).toContain(faceYId);

    // Remove both assets from the space's direct list
    await sut.removeAssets(authFromUser(user), space.id, { assetIds: [assetX.id, assetY.id] });

    // After removeAssets:
    // - faceX must be RETAINED (assetX still reachable via linked album)
    // - faceY must be REMOVED (assetY has no other path)
    const facesAfter = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('personId', '=', spacePerson.id)
      .execute();
    const remainingIds = facesAfter.map((f) => f.assetFaceId);
    expect(remainingIds).toContain(faceXId);
    expect(remainingIds).not.toContain(faceYId);
  });
});

/**
 * Wire SharedSpaceService + AlbumService sharing a real EventRepository so that
 * AlbumService.delete emits AlbumDelete and the SharedSpaceService.onAlbumDelete
 * handler fires synchronously (mirrors production: emit runs handlers before returning).
 */
const setupWithAlbumDelete = () => {
  // SharedSpaceService context — supplies all real face/space repos and the sut
  const spaceResult = newMediumService(SharedSpaceService, {
    database: defaultDatabase,
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
  spaceResult.ctx.getMock(JobRepository).queue.mockResolvedValue();
  spaceResult.ctx.getMock(JobRepository).queueAll.mockResolvedValue();

  // Real EventRepository (no setup() call needed — emit/onEvent work without it).
  // We manually register onAlbumDelete from the SharedSpaceService instance.
  const realEventRepo = new EventRepository(null as any, new ConfigRepository(), LoggingRepository.create());
  (realEventRepo as any).emitHandlers['AlbumDelete'] = [
    {
      event: 'AlbumDelete',
      priority: 0,
      server: false,
      handler: spaceResult.sut.onAlbumDelete.bind(spaceResult.sut),
      label: 'SharedSpaceService.onAlbumDelete',
    },
  ];

  // AlbumService context — only needs AccessRepository + AlbumRepository to be real.
  const albumResult = newMediumService(AlbumService, {
    database: defaultDatabase,
    real: [AccessRepository, AlbumRepository, UserRepository],
    mock: [EventRepository, LoggingRepository],
  });

  // Swap the mocked eventRepository on AlbumService with our wired real one.
  (albumResult.sut as any).eventRepository = realEventRepo;

  return { spaceSut: spaceResult.sut, albumSut: albumResult.sut, ctx: spaceResult.ctx };
};

describe('SharedSpaceService — onAlbumDelete face cleanup', () => {
  it('removes face for album-only asset but retains face for asset with another space path when album is deleted', async () => {
    const { spaceSut: _spaceSut, albumSut, ctx } = setupWithAlbumDelete();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });

    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'DeleteFaceTestAlbum' });

    // assetX: only reachable via album A — face should be REMOVED when album is deleted
    const { asset: assetX } = await ctx.newAsset({ ownerId: user.id });
    // assetZ: reachable via album A AND directly added to space — face should be RETAINED
    const { asset: assetZ } = await ctx.newAsset({ ownerId: user.id });

    await ctx.newAlbumAsset({ albumId: album.id, assetId: assetX.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: assetZ.id });

    // Link album to space
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    // Direct-add assetZ to space (gives it a second path besides the album)
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: assetZ.id });

    // Seed asset faces
    const { result: faceXId } = await ctx.newAssetFace({ assetId: assetX.id });
    const { result: faceZId } = await ctx.newAssetFace({ assetId: assetZ.id });

    // Create a space person and link both faces to it
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const spacePerson = await spaceRepo.createPerson({
      spaceId: space.id,
      name: 'DeleteTestPerson',
      type: 'person',
      representativeFaceId: null,
    });
    await spaceRepo.addPersonFaces([
      { personId: spacePerson.id, assetFaceId: faceXId },
      { personId: spacePerson.id, assetFaceId: faceZId },
    ]);

    // Verify both faces exist before delete
    const facesBefore = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('personId', '=', spacePerson.id)
      .execute();
    expect(facesBefore.map((f) => f.assetFaceId)).toContain(faceXId);
    expect(facesBefore.map((f) => f.assetFaceId)).toContain(faceZId);

    // Delete the album via the real AlbumService (triggers AlbumDelete event → onAlbumDelete)
    const ownerAuth = factory.auth({ user: { id: user.id, email: user.email } });
    await albumSut.delete(ownerAuth, album.id);

    // After delete: faceX (album-only path) must be gone; faceZ (direct path survives) must remain
    const facesAfter = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('personId', '=', spacePerson.id)
      .execute();
    expect(facesAfter.map((f) => f.assetFaceId)).not.toContain(faceXId);
    expect(facesAfter.map((f) => f.assetFaceId)).toContain(faceZId);
  });
});

/**
 * Wire SharedSpaceService + UserService sharing a real EventRepository so that
 * UserService.handleUserDelete emits AlbumDelete and SharedSpaceService.onAlbumDelete
 * fires BEFORE albums are hard-deleted (same emit-then-delete ordering that the GREEN
 * implementation must guarantee). Mirrors the setupWithAlbumDelete pattern above.
 *
 * Assets are owned by Bob (not Alice) so that when Alice's user row is hard-deleted
 * the asset rows — and their associated asset_face / shared_space_person_face rows —
 * are NOT cascade-deleted.  This gives us clean, inspectable state after the call.
 */
const setupWithUserDelete = () => {
  // SharedSpaceService context — supplies all real face/space repos and the sut
  const spaceResult = newMediumService(SharedSpaceService, {
    database: defaultDatabase,
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
  spaceResult.ctx.getMock(JobRepository).queue.mockResolvedValue();
  spaceResult.ctx.getMock(JobRepository).queueAll.mockResolvedValue();

  // Real EventRepository wired with onAlbumDelete handler
  const realEventRepo = new EventRepository(null as any, new ConfigRepository(), LoggingRepository.create());
  (realEventRepo as any).emitHandlers['AlbumDelete'] = [
    {
      event: 'AlbumDelete',
      priority: 0,
      server: false,
      handler: spaceResult.sut.onAlbumDelete.bind(spaceResult.sut),
      label: 'SharedSpaceService.onAlbumDelete',
    },
  ];

  // UserService context — only needs the repos touched by handleUserDelete
  const userResult = newMediumService(UserService, {
    database: defaultDatabase,
    real: [AlbumRepository, UserRepository, SystemMetadataRepository, ConfigRepository],
    mock: [EventRepository, StorageRepository, LoggingRepository, JobRepository],
  });

  // handleUserDelete calls storageRepository.unlinkDir for each of five folder paths
  // before proceeding to album/user deletion.  Provide a no-op mock so the storage
  // call doesn't throw (the strict automock would fail without an implementation).
  userResult.ctx.getMock(StorageRepository).unlinkDir.mockResolvedValue();

  // Swap the mocked eventRepository on UserService with the real wired one
  (userResult.sut as any).eventRepository = realEventRepo;

  return { userSut: userResult.sut, ctx: spaceResult.ctx };
};

describe('UserService — handleUserDelete: space face cleanup (faces F2)', () => {
  beforeAll(() => {
    // handleUserDelete calls StorageCore.getFolderLocation to build filesystem paths
    // before calling storageRepository.unlinkDir (which is mocked).  setMediaLocation
    // must be called first or getMediaLocation() throws "Media location is not set."
    StorageCore.setMediaLocation('/data');
  });

  it('removes orphaned space persons for album-only faces and retains faces that have another space path when album owner account is hard-deleted', async () => {
    const { userSut, ctx } = setupWithUserDelete();

    const { user: alice } = await ctx.newUser();
    const { user: bob } = await ctx.newUser();

    // Bob's face-enabled space S
    const { space: spaceS } = await ctx.newSharedSpace({ createdById: bob.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: spaceS.id, userId: bob.id, role: 'owner' });

    // Alice's album A — Alice is the owner (isAlbumOwned / getAllIds / deleteAll all key off this)
    const { result: album } = await ctx.newAlbum({ ownerId: alice.id, albumName: 'AliceAlbum' });
    // Link album A to space S
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: spaceS.id, albumId: album.id, addedById: bob.id });

    // assetX: owned by Bob, in album A only — album-only path in space S
    const { asset: assetX } = await ctx.newAsset({ ownerId: bob.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: assetX.id });

    // assetZ: owned by Bob, in album A AND direct-added to space S — has a second path
    const { asset: assetZ } = await ctx.newAsset({ ownerId: bob.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: assetZ.id });
    await ctx.newSharedSpaceAsset({ spaceId: spaceS.id, assetId: assetZ.id });

    // Seed asset faces for assetX and assetZ
    const { result: faceXId } = await ctx.newAssetFace({ assetId: assetX.id });
    const { result: faceZId } = await ctx.newAssetFace({ assetId: assetZ.id });

    const spaceRepo = ctx.get(SharedSpaceRepository);

    // spacePersonX: linked only to faceX (album-only asset) → must be DELETED after cleanup
    const spacePersonX = await spaceRepo.createPerson({
      spaceId: spaceS.id,
      name: 'AlbumOnlyPerson',
      type: 'person',
      representativeFaceId: null,
    });
    await spaceRepo.addPersonFaces([{ personId: spacePersonX.id, assetFaceId: faceXId }]);

    // spacePersonZ: linked only to faceZ (direct-path asset) → must SURVIVE cleanup
    const spacePersonZ = await spaceRepo.createPerson({
      spaceId: spaceS.id,
      name: 'DirectPathPerson',
      type: 'person',
      representativeFaceId: null,
    });
    await spaceRepo.addPersonFaces([{ personId: spacePersonZ.id, assetFaceId: faceZId }]);

    // Control: Bob's second space — NOT linked to album A, must be entirely untouched
    const { space: spaceControl } = await ctx.newSharedSpace({ createdById: bob.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: spaceControl.id, userId: bob.id, role: 'owner' });
    const { asset: assetBob } = await ctx.newAsset({ ownerId: bob.id });
    await ctx.newSharedSpaceAsset({ spaceId: spaceControl.id, assetId: assetBob.id });
    const { result: faceCtrlId } = await ctx.newAssetFace({ assetId: assetBob.id });
    const spacePersonCtrl = await spaceRepo.createPerson({
      spaceId: spaceControl.id,
      name: 'ControlPerson',
      type: 'person',
      representativeFaceId: null,
    });
    await spaceRepo.addPersonFaces([{ personId: spacePersonCtrl.id, assetFaceId: faceCtrlId }]);

    // Pre-condition: all three persons exist
    const personsBefore = await defaultDatabase
      .selectFrom('shared_space_person')
      .select('id')
      .where('id', 'in', [spacePersonX.id, spacePersonZ.id, spacePersonCtrl.id])
      .execute();
    expect(personsBefore).toHaveLength(3);

    // Hard-delete Alice — GREEN: emits AlbumDelete BEFORE deleteAll so onAlbumDelete
    // cleanup runs while album_asset / shared_space_album rows still exist
    await userSut.handleUserDelete({ id: alice.id, force: true });

    // spacePersonX (album-only faces) must be DELETED by deleteOrphanedPersons via onAlbumDelete
    // RED: this assertion FAILS because no AlbumDelete is emitted and the orphaned person survives
    const spacePersonXAfter = await defaultDatabase
      .selectFrom('shared_space_person')
      .select('id')
      .where('id', '=', spacePersonX.id)
      .execute();
    expect(spacePersonXAfter).toHaveLength(0);

    // shared_space_person_face for faceX must be REMOVED (album-only path, no other route)
    // RED: this assertion FAILS because removePersonFacesByAssetIds never ran
    const faceXAfter = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('assetFaceId', '=', faceXId)
      .execute();
    expect(faceXAfter).toHaveLength(0);

    // shared_space_person_face for faceZ must be RETAINED (assetZ has a direct-add path)
    const faceZAfter = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('assetFaceId', '=', faceZId)
      .execute();
    expect(faceZAfter).toHaveLength(1);

    // spacePersonZ must survive (onAlbumDelete retains it because assetZ had a direct path)
    const spacePersonZAfter = await defaultDatabase
      .selectFrom('shared_space_person')
      .select('id')
      .where('id', '=', spacePersonZ.id)
      .execute();
    expect(spacePersonZAfter).toHaveLength(1);

    // Control: spacePersonCtrl (unrelated space) must be entirely untouched
    const spacePersonCtrlAfter = await defaultDatabase
      .selectFrom('shared_space_person')
      .select('id')
      .where('id', '=', spacePersonCtrl.id)
      .execute();
    expect(spacePersonCtrlAfter).toHaveLength(1);
  });
});

/**
 * Wire SharedSpaceService + UserAdminService sharing a real EventRepository so that
 * UserAdminService.delete() emits AlbumDelete and SharedSpaceService.onAlbumDelete fires
 * synchronously while the album_asset / shared_space_album rows still exist (mirrors the
 * setupWithUserDelete pattern above). The UserAdminService JobRepository is mocked so the
 * restore() re-projection queue calls can be asserted.
 *
 * Assets are owned by Bob (not Alice) so soft-deleting/restoring Alice's account leaves the
 * asset_face / shared_space_person_face rows intact for inspection.
 */
const setupWithUserAdminDelete = () => {
  // SharedSpaceService context — supplies all real face/space repos and the onAlbumDelete handler
  const spaceResult = newMediumService(SharedSpaceService, {
    database: defaultDatabase,
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
  spaceResult.ctx.getMock(JobRepository).queue.mockResolvedValue();
  spaceResult.ctx.getMock(JobRepository).queueAll.mockResolvedValue();

  // Real EventRepository wired with onAlbumDelete handler bound to the space sut.
  // Only AlbumDelete is registered, so the UserTrash / UserRestore emits become harmless no-ops.
  const realEventRepo = new EventRepository(null as any, new ConfigRepository(), LoggingRepository.create());
  (realEventRepo as any).emitHandlers['AlbumDelete'] = [
    {
      event: 'AlbumDelete',
      priority: 0,
      server: false,
      handler: spaceResult.sut.onAlbumDelete.bind(spaceResult.sut),
      label: 'SharedSpaceService.onAlbumDelete',
    },
  ];

  // UserAdminService context — real repos touched by delete()/restore()
  const userAdminResult = newMediumService(UserAdminService, {
    database: defaultDatabase,
    real: [AlbumRepository, UserRepository, SharedSpaceRepository],
    mock: [EventRepository, JobRepository, LoggingRepository],
  });
  const jobs = userAdminResult.ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  jobs.queue.mockResolvedValue();

  // Swap the mocked eventRepository on UserAdminService with the real wired one so that
  // AlbumDelete actually runs onAlbumDelete (UserTrash / UserRestore hit no registered handler).
  (userAdminResult.sut as any).eventRepository = realEventRepo;

  return { userAdminSut: userAdminResult.sut, ctx: spaceResult.ctx, jobs };
};

describe('UserAdminService — delete (soft): space face cleanup (faces F3b)', () => {
  it('removes album-only space faces / orphaned persons and retains direct-path faces when an album owner account is soft-deleted', async () => {
    const { userAdminSut, ctx } = setupWithUserAdminDelete();

    const { user: alice } = await ctx.newUser();
    const { user: bob } = await ctx.newUser();

    // Bob's face-enabled space S
    const { space: spaceS } = await ctx.newSharedSpace({ createdById: bob.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: spaceS.id, userId: bob.id, role: 'owner' });

    // Alice's album A linked to space S
    const { result: album } = await ctx.newAlbum({ ownerId: alice.id, albumName: 'AliceSoftDeleteAlbum' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: spaceS.id, albumId: album.id, addedById: bob.id });

    // assetX: owned by Bob, in album A only — album-only path in space S → face removed
    const { asset: assetX } = await ctx.newAsset({ ownerId: bob.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: assetX.id });

    // assetZ: owned by Bob, in album A AND direct-added to S — second path → face retained
    const { asset: assetZ } = await ctx.newAsset({ ownerId: bob.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: assetZ.id });
    await ctx.newSharedSpaceAsset({ spaceId: spaceS.id, assetId: assetZ.id });

    const { result: faceXId } = await ctx.newAssetFace({ assetId: assetX.id });
    const { result: faceZId } = await ctx.newAssetFace({ assetId: assetZ.id });

    const spaceRepo = ctx.get(SharedSpaceRepository);

    // spacePersonP: album-only person (only faceX) → must be DELETED after cleanup
    const spacePersonP = await spaceRepo.createPerson({
      spaceId: spaceS.id,
      name: 'AlbumOnlyPerson',
      type: 'person',
      representativeFaceId: null,
    });
    await spaceRepo.addPersonFaces([{ personId: spacePersonP.id, assetFaceId: faceXId }]);

    // spacePersonZ: direct-path person (only faceZ) → must SURVIVE cleanup
    const spacePersonZ = await spaceRepo.createPerson({
      spaceId: spaceS.id,
      name: 'DirectPathPerson',
      type: 'person',
      representativeFaceId: null,
    });
    await spaceRepo.addPersonFaces([{ personId: spacePersonZ.id, assetFaceId: faceZId }]);

    // Pre-condition: P surfaces in statistics and in the space person list
    const statsBefore = await spaceRepo.getSpacePersonStatistics(spaceS.id, spacePersonP.id);
    expect(statsBefore.assets).toBeGreaterThan(0);
    const personsBefore = await spaceRepo.getPersonsBySpaceId(spaceS.id, {});
    expect(personsBefore.map((p) => p.id)).toContain(spacePersonP.id);

    // Soft-delete Alice's account (non-force) — GREEN: emits AlbumDelete for each owned album
    const adminAuth = authFromUser(bob);
    await userAdminSut.delete(adminAuth, alice.id, {});

    // faceX (album-only) must be removed
    const faceXAfter = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('assetFaceId', '=', faceXId)
      .execute();
    expect(faceXAfter).toHaveLength(0);

    // orphaned person P must be gone
    const personPAfter = await spaceRepo.getPersonById(spacePersonP.id);
    expect(personPAfter).toBeUndefined();

    // faceZ (direct path) must be retained, person Z must survive
    const faceZAfter = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('assetFaceId', '=', faceZId)
      .execute();
    expect(faceZAfter).toHaveLength(1);
    const personZAfter = await spaceRepo.getPersonById(spacePersonZ.id);
    expect(personZAfter).toBeDefined();

    // Slice 1 projection: P no longer surfaces via statistics or the space person list
    const statsAfter = await spaceRepo.getSpacePersonStatistics(spaceS.id, spacePersonP.id);
    expect(statsAfter.assets).toBe(0);
    const personsAfter = await spaceRepo.getPersonsBySpaceId(spaceS.id, {});
    expect(personsAfter.map((p) => p.id)).not.toContain(spacePersonP.id);
  });
});

describe('UserAdminService — restore: space face re-projection (faces F3b)', () => {
  it('re-queues face matching for each face-enabled linked space and a single metadata backfill when an album owner account is restored', async () => {
    const { userAdminSut, ctx, jobs } = setupWithUserAdminDelete();

    const { user: alice } = await ctx.newUser();
    const { user: bob } = await ctx.newUser();

    // Bob's face-enabled space S
    const { space: spaceS } = await ctx.newSharedSpace({ createdById: bob.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: spaceS.id, userId: bob.id, role: 'owner' });

    // Alice's album A linked to face-enabled space S
    const { result: album } = await ctx.newAlbum({ ownerId: alice.id, albumName: 'AliceRestoreAlbum' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: spaceS.id, albumId: album.id, addedById: bob.id });

    const { asset: assetX } = await ctx.newAsset({ ownerId: bob.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: assetX.id });

    const adminAuth = authFromUser(bob);

    // Soft-delete then restore — only the restore re-projection should queue jobs
    await userAdminSut.delete(adminAuth, alice.id, {});
    jobs.queue.mockClear();

    await userAdminSut.restore(adminAuth, alice.id);

    // Per face-enabled linking space: a SharedSpaceFaceMatchAll job
    expect(jobs.queue).toHaveBeenCalledWith(
      expect.objectContaining({ name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: spaceS.id } }),
    );
    // A single metadata backfill to re-converge people
    expect(jobs.queue).toHaveBeenCalledWith(
      expect.objectContaining({ name: JobName.SharedSpacePersonMetadataBackfill }),
    );
  });
});

/**
 * Emit-timing note: AssetDelete fires AFTER the asset row (and cascaded asset_face →
 * shared_space_person_face rows) are already deleted.  The onAssetDelete handler therefore
 * receives the affected (spaceId, personId) pairs pre-captured at the emit site in
 * asset.service.ts BEFORE deletion.  These tests exercise the handler directly with
 * the pre-captured payload and verify it correctly recounts surviving persons and removes orphans.
 */
describe('SharedSpaceService — onAssetDelete face cleanup', () => {
  it('getSpacePersonsForAsset returns (spaceId, personId) pairs for faces on the asset', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });

    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId: asset.id });

    const spaceRepo = ctx.get(SharedSpaceRepository);
    const spacePerson = await spaceRepo.createPerson({
      spaceId: space.id,
      name: 'FaceQueryPerson',
      type: 'person',
      representativeFaceId: null,
    });
    await spaceRepo.addPersonFaces([{ personId: spacePerson.id, assetFaceId: faceId }]);

    const pairs = await spaceRepo.getSpacePersonsForAsset(asset.id);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ spaceId: space.id, personId: spacePerson.id });
  });

  it('recounts surviving person and removes orphan person after asset hard-delete', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });

    // Two assets: X will be deleted; Y will survive.
    const { asset: assetX } = await ctx.newAsset({ ownerId: user.id });
    const { asset: assetY } = await ctx.newAsset({ ownerId: user.id });

    const { result: faceXId } = await ctx.newAssetFace({ assetId: assetX.id });
    const { result: faceYId } = await ctx.newAssetFace({ assetId: assetY.id });

    const spaceRepo = ctx.get(SharedSpaceRepository);

    // Person P has faces on both X and Y — survives with reduced count.
    const personP = await spaceRepo.createPerson({
      spaceId: space.id,
      name: 'PersonP',
      type: 'person',
      representativeFaceId: null,
    });
    await spaceRepo.addPersonFaces([
      { personId: personP.id, assetFaceId: faceXId },
      { personId: personP.id, assetFaceId: faceYId },
    ]);

    // Person Q has a face only on X — becomes orphan after deletion.
    const personQ = await spaceRepo.createPerson({
      spaceId: space.id,
      name: 'PersonQ',
      type: 'person',
      representativeFaceId: null,
    });
    await spaceRepo.addPersonFaces([{ personId: personQ.id, assetFaceId: faceXId }]);

    // Capture affected pairs BEFORE deletion (mirrors asset.service.ts behaviour).
    const affectedSpacePersons = await spaceRepo.getSpacePersonsForAsset(assetX.id);

    // Hard-delete asset X; the DB cascade removes asset_face and shared_space_person_face rows.
    await defaultDatabase.deleteFrom('asset').where('id', '=', assetX.id).execute();

    // Fire the handler with the pre-captured payload.
    await sut.onAssetDelete({ assetId: assetX.id, userId: user.id, affectedSpacePersons });

    // P survives with recounted faceCount/assetCount = 1 (only Y's face remains).
    const personPAfter = await defaultDatabase
      .selectFrom('shared_space_person')
      .select(['faceCount', 'assetCount'])
      .where('id', '=', personP.id)
      .executeTakeFirst();
    expect(personPAfter).toBeDefined();
    expect(personPAfter!.faceCount).toBe(1);
    expect(personPAfter!.assetCount).toBe(1);

    // Q was an orphan (no remaining faces) and must be deleted.
    const personQAfter = await defaultDatabase
      .selectFrom('shared_space_person')
      .select('id')
      .where('id', '=', personQ.id)
      .execute();
    expect(personQAfter).toHaveLength(0);
  });

  it('leaves persons in unaffected spaces untouched', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();

    // Space S contains assetX; space T has no relation to assetX.
    const { space: spaceS } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const { space: spaceT } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });

    const { asset: assetX } = await ctx.newAsset({ ownerId: user.id });
    const { asset: assetT } = await ctx.newAsset({ ownerId: user.id });

    const { result: faceXId } = await ctx.newAssetFace({ assetId: assetX.id });
    const { result: faceTId } = await ctx.newAssetFace({ assetId: assetT.id });

    const spaceRepo = ctx.get(SharedSpaceRepository);

    const personS = await spaceRepo.createPerson({
      spaceId: spaceS.id,
      name: 'PersonS',
      type: 'person',
      representativeFaceId: null,
    });
    await spaceRepo.addPersonFaces([{ personId: personS.id, assetFaceId: faceXId }]);

    const personT = await spaceRepo.createPerson({
      spaceId: spaceT.id,
      name: 'PersonT',
      type: 'person',
      representativeFaceId: null,
    });
    await spaceRepo.addPersonFaces([{ personId: personT.id, assetFaceId: faceTId }]);

    // Only spaceS is affected by the delete of assetX.
    const affectedSpacePersons = await spaceRepo.getSpacePersonsForAsset(assetX.id);
    await defaultDatabase.deleteFrom('asset').where('id', '=', assetX.id).execute();

    await sut.onAssetDelete({ assetId: assetX.id, userId: user.id, affectedSpacePersons });

    // PersonT in spaceT must not have been deleted.
    const personTAfter = await defaultDatabase
      .selectFrom('shared_space_person')
      .select('id')
      .where('id', '=', personT.id)
      .execute();
    expect(personTAfter).toHaveLength(1);
  });
});
