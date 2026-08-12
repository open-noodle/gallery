import { Kysely } from 'kysely';
import { AssetVisibility, JobName, SourceType } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository';
import { FaceRepairDeclineRepository } from 'src/repositories/face-repair-decline.repository';
import { FaceRepairRepository } from 'src/repositories/face-repair.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { FaceRepairService } from 'src/services/face-repair.service';
import { PersonService } from 'src/services/person.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { Mocked } from 'vitest';

// Disjoint-axis embeddings (cosine distance ~1.0) stand in for genuinely different people.
// newEmbedding() all-positive components leave two vectors ~0.75 similar — unusable here.
const axisEmbedding = (axis: 'first' | 'second') => {
  const values = Array.from({ length: 512 }, (_, index) => {
    const inFirstHalf = index < 256;
    return (axis === 'first' ? inFirstHalf : !inFirstHalf) ? 1 : 0;
  });
  return '[' + values.join(',') + ']';
};

// A mixed-axis embedding with 64 ones in a non-overlapping window of each half.
// cos_sim vs either pure axis ≈ 64/181 ≈ 0.354 → distance ≈ 0.646 (beyond maxDistance=0.6).
const mixedAxisEmbedding = (slot: 0 | 1 | 2 | 3) => {
  const firstHalfStart = slot * 64;
  const secondHalfStart = 256 + slot * 64;
  const values = Array.from({ length: 512 }, (_, i) =>
    (i >= firstHalfStart && i < firstHalfStart + 64) || (i >= secondHalfStart && i < secondHalfStart + 64) ? 1 : 0,
  );
  return '[' + values.join(',') + ']';
};

// Shared repair params matching the executeRepair suite in face-repair.service.spec.ts.
const repairParams = {
  dryRun: false as const,
  maxDistance: 0.6,
  voteWindow: 50,
  minFaces: 1,
  voteMargin: 2,
  maxAttributionDistance: 0.35,
  maxFlaggedFraction: 0.5,
};

// Sets up a FaceRepairService sut with a mocked JobRepository (to capture queueAll) and a
// real FaceIdentityRepository so getBackfillWork() and identity link helpers work.
const setupRepair = (db: Kysely<DB>) => {
  const { ctx, sut } = newMediumService(FaceRepairService, {
    database: db,
    real: [
      FaceRepairRepository,
      FaceRepairDeclineRepository,
      FacePersonVerdictRepository,
      SearchRepository,
      PersonRepository,
      FaceIdentityRepository,
      ConfigRepository,
      DatabaseRepository,
      SystemMetadataRepository,
    ],
    mock: [LoggingRepository, JobRepository],
  });
  const jobMock = ctx.getMock(JobRepository);
  jobMock.isActive.mockResolvedValue(false);
  jobMock.queueAll.mockResolvedValue();
  return { sut, ctx, jobMock, faceIdentityRepository: ctx.get(FaceIdentityRepository) };
};

// Sets up a PersonService sut mirroring people-identity-rbac.spec.ts — mocked
// SystemMetadataRepository overrides minFaces=1 so recognition always runs, and
// the mocked JobRepository prevents queued jobs from auto-running.
const setupPerson = (db: Kysely<DB>) => {
  const { ctx, sut } = newMediumService(PersonService, {
    database: db,
    real: [
      AccessRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      PersonRepository,
      SearchRepository,
      SharedSpaceRepository,
    ],
    mock: [JobRepository, LoggingRepository, SystemMetadataRepository],
  });
  const metadata = ctx.getMock(SystemMetadataRepository);
  metadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } } as any);
  const jobs = ctx.getMock(JobRepository);
  jobs.queue.mockResolvedValue();
  jobs.queueAll.mockResolvedValue();
  return { sut, ctx };
};

// Builds a person + N faces on a given embedding axis, each with an identity link and a
// face_search embedding, with asset visibility=Timeline and sourceType=MachineLearning.
// This makes getBackfillWork().hasPersonalIdentityWork=false for the cluster.
const buildLinkedCluster = async (
  ctx: ReturnType<typeof setupRepair>['ctx'],
  ownerId: string,
  embedding: string,
  faceCount: number,
  name?: string,
) => {
  const faceIdentityRepo = ctx.get(FaceIdentityRepository);
  const { person } = await ctx.newPerson({ ownerId, name: name ?? '' });
  const identity = await faceIdentityRepo.ensurePersonIdentity(person.id);
  const faceIds: string[] = [];
  for (let index = 0; index < faceCount; index++) {
    const { asset } = await ctx.newAsset({ ownerId, visibility: AssetVisibility.Timeline });
    const { assetFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding }).execute();
    await faceIdentityRepo.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
    faceIds.push(assetFace.id);
  }
  return { person, identity, faceIds };
};

// Collects the face ids queued as FacialRecognition jobs from all queueAll mock calls.
const collectQueuedFaceIds = (jobMock: Mocked<JobRepository>): string[] => {
  return jobMock.queueAll.mock.calls
    .flatMap(([items]) => items)
    .filter((item) => item.name === JobName.FacialRecognition)
    .map((item) => (item.data as { id: string }).id);
};

// ── Isolated DB for these e2e tests ─────────────────────────────────────────────────────────────

let e2eDatabase: Kysely<DB>;

beforeAll(async () => {
  e2eDatabase = await getKyselyDB();
});

// ── Task 1: end-to-end re-home + no-loop ────────────────────────────────────────────────────────

describe('face re-attribution repair: end-to-end re-home', () => {
  it('leaked faces re-home directly to their true owner; a later recognition pass does not boomerang them; names preserved; no backfill loop', async () => {
    const { sut: faceRepair, ctx, jobMock, faceIdentityRepository } = setupRepair(e2eDatabase);
    const { sut: personService } = setupPerson(e2eDatabase);
    const { user } = await ctx.newUser();

    // Karina: 10 first-axis faces — the true owner of the leaked embedding.
    const { person: karina } = await buildLinkedCluster(ctx, user.id, axisEmbedding('first'), 10, 'Karina');

    // Alexia: 5 genuine second-axis faces + 3 leaked first-axis faces (contamination).
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const { person: alexia } = await ctx.newPerson({ ownerId: user.id, name: 'Alexia' });
    const alexiaIdentity = await faceIdentityRepo.ensurePersonIdentity(alexia.id);

    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { assetFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: alexia.id,
        sourceType: SourceType.MachineLearning,
      });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      await faceIdentityRepo.linkFace({
        assetFaceId: assetFace.id,
        identityId: alexiaIdentity.id,
        source: 'owner-person',
      });
      leakedFaceIds.push(assetFace.id);
    }
    for (let i = 0; i < 5; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { assetFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: alexia.id,
        sourceType: SourceType.MachineLearning,
      });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
        .execute();
      await faceIdentityRepo.linkFace({
        assetFaceId: assetFace.id,
        identityId: alexiaIdentity.id,
        source: 'owner-person',
      });
    }

    // Baseline: no backfill work before repair.
    const baselineWork = await faceIdentityRepository.getBackfillWork();
    expect(baselineWork.hasPersonalIdentityWork).toBe(false);

    // Run repair (real execution).
    const result = await faceRepair.runRepair({ ownerId: user.id, ...repairParams });
    expect(result.mutated).toBe(true);
    expect(result.executed!.moved).toBe(3);

    // The move is direct — no FacialRecognition jobs are queued (the old re-queue route is exactly what
    // re-clustered unassigned faces back to the wrong person on contaminated clusters).
    expect(collectQueuedFaceIds(jobMock)).toHaveLength(0);

    // Assert: each leaked face is already re-homed to Karina.
    const reassignedRows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personId'])
      .where('id', 'in', leakedFaceIds)
      .execute();
    for (const row of reassignedRows) {
      expect(row.personId).toBe(karina.id);
    }

    // Durability / boomerang regression: a subsequent recognition pass over the moved faces must leave them
    // on Karina (recognition is a no-op for an already-assigned face).
    for (const id of leakedFaceIds) {
      await personService.handleRecognizeFaces({ id, deferred: false });
    }
    const afterRecognition = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personId'])
      .where('id', 'in', leakedFaceIds)
      .execute();
    for (const row of afterRecognition) {
      expect(row.personId).toBe(karina.id);
    }

    // Assert: Karina's name is preserved.
    const karinaRow = await ctx.database
      .selectFrom('person')
      .select(['id', 'name'])
      .where('id', '=', karina.id)
      .executeTakeFirstOrThrow();
    expect(karinaRow.name).toBe('Karina');

    // Assert: Alexia still exists with exactly her 5 genuine faces.
    const alexiaFaceRows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personId'])
      .where('personId', '=', alexia.id)
      .execute();
    expect(alexiaFaceRows).toHaveLength(5);

    // Assert: no backfill work after repair + recognition — no infinite loop.
    const afterWork = await faceIdentityRepository.getBackfillWork();
    expect(afterWork.hasPersonalIdentityWork).toBe(false);
  });
});

// ── Task 2: multi-owner contamination splits correctly ──────────────────────────────────────────

describe('face re-attribution repair: multi-owner contamination split', () => {
  it('leaked faces split to their correct true owners (Karina-leaks→Karina, Bob-leaks→Bob)', async () => {
    const { sut: faceRepair, ctx, jobMock, faceIdentityRepository } = setupRepair(e2eDatabase);
    const { user } = await ctx.newUser();

    // Karina: 10 first-axis faces.
    const { person: karina } = await buildLinkedCluster(ctx, user.id, axisEmbedding('first'), 10, 'Karina');

    // Bob: 10 faces on mixedAxis slot 0 — disjoint from first and second axes.
    const { person: bob } = await buildLinkedCluster(ctx, user.id, mixedAxisEmbedding(0), 10, 'Bob');

    // Alexia: 5 genuine second-axis faces + 2 leaked first-axis (Karina) + 2 leaked slot-0 (Bob).
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const { person: alexia } = await ctx.newPerson({ ownerId: user.id, name: 'Alexia' });
    const alexiaIdentity = await faceIdentityRepo.ensurePersonIdentity(alexia.id);

    const leakedKarinaFaceIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { assetFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: alexia.id,
        sourceType: SourceType.MachineLearning,
      });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      await faceIdentityRepo.linkFace({
        assetFaceId: assetFace.id,
        identityId: alexiaIdentity.id,
        source: 'owner-person',
      });
      leakedKarinaFaceIds.push(assetFace.id);
    }

    const leakedBobFaceIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { assetFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: alexia.id,
        sourceType: SourceType.MachineLearning,
      });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: mixedAxisEmbedding(0) })
        .execute();
      await faceIdentityRepo.linkFace({
        assetFaceId: assetFace.id,
        identityId: alexiaIdentity.id,
        source: 'owner-person',
      });
      leakedBobFaceIds.push(assetFace.id);
    }

    for (let i = 0; i < 5; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { assetFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: alexia.id,
        sourceType: SourceType.MachineLearning,
      });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
        .execute();
      await faceIdentityRepo.linkFace({
        assetFaceId: assetFace.id,
        identityId: alexiaIdentity.id,
        source: 'owner-person',
      });
    }

    // Run repair.
    const result = await faceRepair.runRepair({ ownerId: user.id, ...repairParams });
    expect(result.mutated).toBe(true);
    expect(result.executed!.moved).toBe(4);

    // Direct move — no recognition re-queue; each face went straight to its own suspected owner.
    expect(collectQueuedFaceIds(jobMock)).toHaveLength(0);

    // Assert: Karina-leaks re-homed to Karina.
    const karinaLeakRows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personId'])
      .where('id', 'in', leakedKarinaFaceIds)
      .execute();
    for (const row of karinaLeakRows) {
      expect(row.personId).toBe(karina.id);
    }

    // Assert: Bob-leaks re-homed to Bob.
    const bobLeakRows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personId'])
      .where('id', 'in', leakedBobFaceIds)
      .execute();
    for (const row of bobLeakRows) {
      expect(row.personId).toBe(bob.id);
    }

    // Assert: no backfill work after the split — no infinite loop.
    const afterWork = await faceIdentityRepository.getBackfillWork();
    expect(afterWork.hasPersonalIdentityWork).toBe(false);
  });
});

// ── Task 3: re-home at production minFaces:3 + sub-minFaces stays blank ─────────────────────────

describe('face re-attribution repair: minFaces:3 + sub-minFaces stays unassigned', () => {
  it('leaked face with ≥3 Karina neighbors re-homes to Karina; lone sub-minFaces face is never flagged; no backfill loop', async () => {
    const { sut: faceRepair, ctx, jobMock, faceIdentityRepository } = setupRepair(e2eDatabase);
    const { user } = await ctx.newUser();

    // Karina: 10 first-axis faces — the reference cluster.
    const { person: karina } = await buildLinkedCluster(ctx, user.id, axisEmbedding('first'), 10, 'Karina');

    // Alexia: 3 genuine second-axis faces + 3 leaked first-axis faces (≥ minFaces=3 → should re-home).
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const { person: alexia } = await ctx.newPerson({ ownerId: user.id, name: 'Alexia' });
    const alexiaIdentity = await faceIdentityRepo.ensurePersonIdentity(alexia.id);

    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { assetFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: alexia.id,
        sourceType: SourceType.MachineLearning,
      });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      await faceIdentityRepo.linkFace({
        assetFaceId: assetFace.id,
        identityId: alexiaIdentity.id,
        source: 'owner-person',
      });
      leakedFaceIds.push(assetFace.id);
    }
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { assetFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: alexia.id,
        sourceType: SourceType.MachineLearning,
      });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
        .execute();
      await faceIdentityRepo.linkFace({
        assetFaceId: assetFace.id,
        identityId: alexiaIdentity.id,
        source: 'owner-person',
      });
    }

    // Bob: one lone face on mixedAxisEmbedding(1) — completely isolated, <3 same-axis neighbors.
    // After repair + recognition this face should remain personId=NULL (sub-minFaces → blank).
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const bobIdentity = await faceIdentityRepo.ensurePersonIdentity(bob.id);
    const { asset: loneAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    const { assetFace: loneFace } = await ctx.newAssetFace({
      assetId: loneAsset.id,
      personId: bob.id,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database
      .insertInto('face_search')
      .values({ faceId: loneFace.id, embedding: mixedAxisEmbedding(1) })
      .execute();
    await faceIdentityRepo.linkFace({
      assetFaceId: loneFace.id,
      identityId: bobIdentity.id,
      source: 'owner-person',
    });

    // Baseline: no backfill work.
    const baselineWork = await faceIdentityRepository.getBackfillWork();
    expect(baselineWork.hasPersonalIdentityWork).toBe(false);

    // Run repair at production minFaces=3.
    const result = await faceRepair.runRepair({
      ownerId: user.id,
      dryRun: false,
      maxDistance: 0.6,
      voteWindow: 200,
      minFaces: 3,
      voteMargin: 2,
      maxAttributionDistance: 0.35,
      maxFlaggedFraction: 0.5,
    });
    expect(result.mutated).toBe(true);
    // The 3 leaked faces should be in toRepair; the lone Bob face is sub-minFaces and not in toRepair.
    expect(result.executed!.moved).toBe(3);

    // Direct move — no recognition re-queue.
    expect(collectQueuedFaceIds(jobMock)).toHaveLength(0);

    // Assert: leaked faces re-homed to Karina.
    const reassignedRows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personId'])
      .where('id', 'in', leakedFaceIds)
      .execute();
    for (const row of reassignedRows) {
      expect(row.personId).toBe(karina.id);
    }

    // Assert: lone Bob face was NOT in toRepair (no confident Q with ≥3 neighbors) and stays unmodified.
    const loneRow = await ctx.database
      .selectFrom('asset_face')
      .select('personId')
      .where('id', '=', loneFace.id)
      .executeTakeFirstOrThrow();
    // The lone face was never flagged → its personId is unchanged (still bob.id)
    expect(loneRow.personId).toBe(bob.id);

    // Assert: no backfill work after repair + recognition.
    const afterWork = await faceIdentityRepository.getBackfillWork();
    expect(afterWork.hasPersonalIdentityWork).toBe(false);
  });
});
