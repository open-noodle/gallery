import { Kysely } from 'kysely';
import { SourceType } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository';
import { FaceRepairDeclineRepository } from 'src/repositories/face-repair-decline.repository';
import { FaceRepairScanRepository } from 'src/repositories/face-repair-scan.repository';
import { FaceRepairRepository } from 'src/repositories/face-repair.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { FaceRepairService } from 'src/services/face-repair.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;

const setup = () => {
  const { ctx, sut } = newMediumService(FaceRepairService, {
    database: db,
    real: [
      FaceRepairRepository,
      FaceRepairScanRepository,
      FaceRepairDeclineRepository,
      FacePersonVerdictRepository,
      FaceIdentityRepository,
      SearchRepository,
      PersonRepository,
      ConfigRepository,
      DatabaseRepository,
      SystemMetadataRepository,
    ],
    mock: [LoggingRepository, JobRepository],
  });
  const jobMock = ctx.getMock(JobRepository);
  jobMock.isActive.mockResolvedValue(false);
  jobMock.queueAll.mockResolvedValue();
  return {
    sut,
    ctx,
    jobMock,
    declineRepo: ctx.get(FaceRepairDeclineRepository),
    verdictRepo: ctx.get(FacePersonVerdictRepository),
  };
};

type Ctx = ReturnType<typeof setup>['ctx'];

const seedFace = async (ctx: Ctx, ownerId: string, personId: string): Promise<string> => {
  const { asset } = await ctx.newAsset({ ownerId });
  const { assetFace } = await ctx.newAssetFace({
    assetId: asset.id,
    personId,
    sourceType: SourceType.MachineLearning,
  });
  return assetFace.id;
};

// face_person_verdict.id is UUID v7 (@PrimaryGeneratedUuidV7Column) — the version nibble is '7'.
// Sanity-checked directly so a regression to v4 ids would be caught here too.
const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeAll(async () => {
  db = await getKyselyDB();
});

afterEach(async () => {
  await db.deleteFrom('face_repair_scan').execute();
  // listResolutions()/removeResolutions() are unscoped by design (the manage page lists every outstanding
  // verdict) — so leftover rows from an earlier test in this file would otherwise leak into a later test's
  // assertions. Reset between tests for isolation.
  await db.deleteFrom('face_repair_decline').execute();
  await db.deleteFrom('face_person_verdict').execute();
});

// ── The resolutions manage page: NEGATIVE verdicts from both engines, listed and undoable ─────────

describe('FaceRepairService.listResolutions', () => {
  it('lists verdicts from both engines with their source, actor and target', async () => {
    const { sut, ctx, verdictRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
    const { person: ownerB } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Jane' });
    const fromCleanup = await seedFace(ctx, user.id, source.id);
    const fromSuggestion = await seedFace(ctx, user.id, source.id);

    await verdictRepo.markRejected(ownerA.id, fromCleanup, { source: 'cleanup', actorId: user.id });
    await verdictRepo.markIgnored(ownerB.id, fromSuggestion, { source: 'suggestion', actorId: user.id });

    const { resolutions } = await sut.listResolutions({ page: 1, size: 50 });
    expect(resolutions).toHaveLength(2);

    const cleanupRow = resolutions.find((r) => r.source === 'cleanup');
    expect(cleanupRow).toBeDefined();
    expect(cleanupRow!.id).toMatch(UUID_V7_RE);
    expect(cleanupRow).toMatchObject({
      assetFaceId: fromCleanup,
      status: 'rejected',
      source: 'cleanup',
      personId: ownerA.id,
      personName: 'Alice',
      actorId: user.id,
    });
    expect(cleanupRow!.createdAt).toBeTruthy();

    const suggestionRow = resolutions.find((r) => r.source === 'suggestion');
    expect(suggestionRow).toMatchObject({
      assetFaceId: fromSuggestion,
      status: 'ignored',
      source: 'suggestion',
      personId: ownerB.id,
      personName: 'Bob',
    });
  });

  it('lists a space-person verdict rendered with its space named and representative face id (S11.17)', async () => {
    const { sut, ctx, verdictRepo } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, name: 'Family Trip' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Jane' });
    const faceId = await seedFace(ctx, user.id, source.id);
    const reprFaceId = await seedFace(ctx, user.id, source.id);

    const spacePerson = await db
      .insertInto('shared_space_person')
      .values({
        spaceId: space.id,
        name: 'Casper',
        type: 'person',
        isHidden: false,
        representativeFaceId: reprFaceId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await verdictRepo.markRejectedForSpacePerson(spacePerson.id, faceId, { source: 'cleanup', actorId: user.id });

    const { resolutions } = await sut.listResolutions({ page: 1, size: 50 });
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toMatchObject({
      assetFaceId: faceId,
      spacePersonId: spacePerson.id,
      spacePersonName: 'Casper',
      spacePersonThumbnailFaceId: reprFaceId,
      spaceName: 'Family Trip',
      personId: null,
      personName: null,
    });
  });

  it('lists a fully-orphaned verdict (target AND identity both GC-d away) as a valid row, never broken', async () => {
    const { sut, ctx, verdictRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Jane' });
    const faceId = await seedFace(ctx, user.id, source.id);

    const identity = await ctx.get(FaceIdentityRepository).ensurePersonIdentity(ownerA.id);
    await verdictRepo.markRejected(ownerA.id, faceId, {
      identityId: identity.id,
      source: 'cleanup',
      actorId: user.id,
    });

    // Simulate the GC/degrade path: the suspected owner is deleted (personId SET NULL) and its identity is
    // independently degraded away too (identityId SET NULL) — the row is now "fully orphaned" (no target, no
    // identity), unreachable by every scan predicate (§ table comment), but the unscoped admin listing is
    // not target-filtered and must still surface it without breaking.
    await ctx.get(PersonRepository).delete([ownerA.id]);
    await db.deleteFrom('face_identity').where('id', '=', identity.id).execute();

    const { resolutions } = await sut.listResolutions({ page: 1, size: 50 });
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toMatchObject({
      assetFaceId: faceId,
      personId: null,
      personName: null,
      spacePersonId: null,
      spacePersonName: null,
      spaceName: null,
    });
  });

  it('does not list human placements — those are unbounded and undone in context', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Jane' });
    const faceId = await seedFace(ctx, user.id, source.id);

    const identity = await ctx.get(FaceIdentityRepository).ensurePersonIdentity(source.id);
    await ctx
      .get(FaceIdentityRepository)
      .replaceFaceIdentity({ assetFaceId: faceId, identityId: identity.id, source: 'manual' });

    const { resolutions } = await sut.listResolutions({ page: 1, size: 50 });
    expect(resolutions).toEqual([]);
  });

  it('returns an empty list when there is nothing recorded', async () => {
    const { sut } = setup();
    const { resolutions } = await sut.listResolutions({ page: 1, size: 50 });
    expect(resolutions).toEqual([]);
  });

  // S11.16: the service threads page/size through and exposes the server's true total, not just the page's
  // own item count — the resolutions page needs `total` to know whether more pages exist.
  it('S11.16: threads page/size through and exposes the true total, not just the current page size', async () => {
    const { sut, ctx, verdictRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Jane' });
    for (let index = 0; index < 3; index++) {
      const faceId = await seedFace(ctx, user.id, source.id);
      await verdictRepo.markRejected(ownerA.id, faceId, { source: 'cleanup', actorId: user.id });
    }

    const page1 = await sut.listResolutions({ page: 1, size: 2 });
    expect(page1.total).toBe(3);
    expect(page1.resolutions).toHaveLength(2);

    const page2 = await sut.listResolutions({ page: 2, size: 2 });
    expect(page2.total).toBe(3);
    expect(page2.resolutions).toHaveLength(1);
  });
});

describe('FaceRepairService.removeResolutions', () => {
  it('removes a verdict by its uuid-v7 row id, re-enabling the pairing', async () => {
    const { sut, ctx, verdictRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.id);
    await verdictRepo.markRejected(ownerA.id, f1, { source: 'cleanup', actorId: user.id });

    const [row] = await sut.listResolutions({ page: 1, size: 50 }).then((r) => r.resolutions);
    expect(row.id).toMatch(UUID_V7_RE);

    const before = await verdictRepo.getNegativeVerdictTokens([f1]);
    expect(before.get(f1)).toContain(`person:${ownerA.id}`);

    expect(await sut.removeResolutions({ verdictIds: [row.id] })).toEqual({ removed: 1 });

    // Undo re-enables flagging: the pairing is no longer settled for a re-scan.
    const after = await verdictRepo.getNegativeVerdictTokens([f1]);
    expect(after.get(f1)).toBeUndefined();
  });

  it('removes a cluster mute by row id', async () => {
    const { sut, ctx, declineRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    await declineRepo.createClusterMutes({
      persons: [{ personId: source.id, suspectedOwnerIds: [ownerA.id] }],
      declinedBy: user.id,
    });

    const [mute] = await declineRepo.listDeclines();
    expect(await sut.removeResolutions({ clusterMuteIds: [mute.id] })).toEqual({ removed: 1 });
    expect(await declineRepo.listDeclines()).toHaveLength(0);
  });

  it('removes a verdict and a cluster mute in the same call and sums the counts', async () => {
    const { sut, ctx, declineRepo, verdictRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.id);
    await verdictRepo.markRejected(ownerA.id, f1, { source: 'cleanup', actorId: user.id });
    await declineRepo.createClusterMutes({
      persons: [{ personId: source.id, suspectedOwnerIds: [ownerA.id] }],
      declinedBy: user.id,
    });

    const [verdict] = await sut.listResolutions({ page: 1, size: 50 }).then((r) => r.resolutions);
    const [mute] = await declineRepo.listDeclines();

    expect(await sut.removeResolutions({ verdictIds: [verdict.id], clusterMuteIds: [mute.id] })).toEqual({
      removed: 2,
    });
    expect(await sut.listResolutions({ page: 1, size: 50 }).then((r) => r.resolutions)).toHaveLength(0);
    expect(await declineRepo.listDeclines()).toHaveLength(0);
  });

  it('is a no-op (removed: 0) when called with nothing to remove', async () => {
    const { sut } = setup();
    expect(await sut.removeResolutions({})).toEqual({ removed: 0 });
  });
});

describe('FaceRepairService.unconfirmFaces', () => {
  it('downgrades a human placement so the face can be flagged again', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Jane' });
    const faceId = await seedFace(ctx, user.id, source.id);
    const identityRepo = ctx.get(FaceIdentityRepository);

    const identity = await identityRepo.ensurePersonIdentity(source.id);
    await identityRepo.replaceFaceIdentity({ assetFaceId: faceId, identityId: identity.id, source: 'manual' });
    const linkedBefore = await identityRepo.getManualLinkedFaceIds([faceId]);
    expect(linkedBefore.has(faceId)).toBe(true);

    expect(await sut.unconfirmFaces([faceId])).toEqual({ removed: 1 });

    // No longer settled...
    const linkedAfter = await identityRepo.getManualLinkedFaceIds([faceId]);
    expect(linkedAfter.has(faceId)).toBe(false);
    // ...but still attributed to the same identity: only the human claim was withdrawn.
    const link = await db
      .selectFrom('face_identity_face')
      .selectAll()
      .where('assetFaceId', '=', faceId)
      .executeTakeFirstOrThrow();
    expect(link.identityId).toBe(identity.id);
    expect(link.source).toBe('ml');
  });

  it('is a no-op for an empty list and for a face with no human placement', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Jane' });
    const faceId = await seedFace(ctx, user.id, source.id);

    expect(await sut.unconfirmFaces([])).toEqual({ removed: 0 });
    expect(await sut.unconfirmFaces([faceId])).toEqual({ removed: 0 });
  });
});
