import { Kysely } from 'kysely';
import { SourceType } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository';
import { FaceRepairDeclineRepository } from 'src/repositories/face-repair-decline.repository';
import { FaceRepairScanRepository, RepairScanParams } from 'src/repositories/face-repair-scan.repository';
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

const EMBEDDING = '[' + Array.from({ length: 512 }, () => 1).join(',') + ']';
const PARAMS: RepairScanParams = {
  maxDistance: 0.5,
  minFaces: 3,
  voteWindow: 200,
  voteMargin: 2,
  maxAttributionDistance: 0.35,
  maxFlaggedFraction: 0.5,
  largeClusterThreshold: 50,
};
const zeroTotals = () => ({
  eligibleFaces: 0,
  flaggedFaces: 0,
  toRepair: 0,
  reviewOnlyFaces: 0,
  reviewOnlyPersons: 0,
  affectedPersons: 0,
  reviewOnlyByReason: { overCap: 0, badTarget: 0, unAttributable: 0 },
});

// Two disjoint embedding axes (cosine ~1.0) so the detector treats them as different people.
const axisEmbedding = (axis: 'first' | 'second') =>
  '[' + Array.from({ length: 512 }, (_, i) => ((axis === 'first' ? i < 256 : i >= 256) ? 1 : 0)).join(',') + ']';

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
      SystemMetadataRepository,
    ],
    mock: [LoggingRepository, JobRepository],
  });
  const jobMock = ctx.getMock(JobRepository);
  jobMock.isActive.mockResolvedValue(false);
  jobMock.queue.mockResolvedValue();
  jobMock.queueAll.mockResolvedValue();
  return { sut, ctx, scanRepo: ctx.get(FaceRepairScanRepository) };
};

type Ctx = ReturnType<typeof setup>['ctx'];

// Over-cap person: leaked faces on `first` axis (voting toward owner Q's 10-face cluster) + genuine faces on
// `second`. leaked/(leaked+genuine) > maxFlaggedFraction → the cluster is flagged.
const seedOverCapPerson = async (ctx: Ctx, ownerId: string, opts: { leakedCount: number; genuineCount: number }) => {
  const { person: ownerQ } = await ctx.newPerson({ ownerId, name: '' });
  for (let i = 0; i < 10; i++) {
    const { asset } = await ctx.newAsset({ ownerId });
    const { assetFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: ownerQ.id,
      sourceType: SourceType.MachineLearning,
    });
    await db
      .insertInto('face_search')
      .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
      .execute();
  }
  const { person } = await ctx.newPerson({ ownerId, name: '' });
  const leakedFaceIds: string[] = [];
  for (let i = 0; i < opts.leakedCount; i++) {
    const { asset } = await ctx.newAsset({ ownerId });
    const { assetFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });
    await db
      .insertInto('face_search')
      .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
      .execute();
    leakedFaceIds.push(assetFace.id);
  }
  for (let i = 0; i < opts.genuineCount; i++) {
    const { asset } = await ctx.newAsset({ ownerId });
    const { assetFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });
    await db
      .insertInto('face_search')
      .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
      .execute();
  }
  return { person, ownerQ, leakedFaceIds };
};

const seedEligibleFace = async (ctx: Ctx, userId: string, personId: string): Promise<string> => {
  const { asset } = await ctx.newAsset({ ownerId: userId });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId, sourceType: SourceType.MachineLearning });
  await db.insertInto('face_search').values({ faceId: assetFace.id, embedding: EMBEDDING }).execute();
  return assetFace.id;
};

// Seed a completed scan listing `personId` plus its stored flagged rows (fast path for read-behaviour tests).
const seedCompletedScanWithFlagged = async (
  scanRepo: ReturnType<typeof setup>['scanRepo'],
  faces: { assetFaceId: string; personId: string; suspectedOwnerId: string }[],
) => {
  const scan = await scanRepo.createScan({ requestedBy: null, params: PARAMS });
  await scanRepo.completeScan(scan.id, { totals: zeroTotals(), persons: [] });
  await scanRepo.replaceScanFlaggedFaces(scan.id, faces);
  return scan;
};

beforeAll(async () => {
  db = await getKyselyDB();
});

afterEach(() => db.deleteFrom('face_repair_scan').execute());

describe('FaceRepairService.getPersonFlaggedFaces (scan-backed)', () => {
  it('a real scan persists flagged faces and the review reads them (E1, E14)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person, leakedFaceIds } = await seedOverCapPerson(ctx, user.id, { leakedCount: 6, genuineCount: 4 });

    const { scanId } = await sut.triggerScan(user.id);
    await sut.handleFaceRepairScan({ scanId });
    expect((await sut.getLatestScanStatus())!.status).toBe('completed');

    const result = await sut.getPersonFlaggedFaces(person.id);
    expect(result.flaggedFaces.map((f) => f.assetFaceId).toSorted()).toEqual(leakedFaceIds.toSorted());
  });

  it('excludes a flagged face moved off the person since the scan (E2)', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const { person: other } = await ctx.newPerson({ ownerId: user.id });
    const f1 = await seedEligibleFace(ctx, user.id, person.id);
    const f2 = await seedEligibleFace(ctx, user.id, person.id);
    await seedCompletedScanWithFlagged(scanRepo, [
      { assetFaceId: f1, personId: person.id, suspectedOwnerId: owner.id },
      { assetFaceId: f2, personId: person.id, suspectedOwnerId: owner.id },
    ]);

    await db.updateTable('asset_face').set({ personId: other.id }).where('id', '=', f1).execute();

    const result = await sut.getPersonFlaggedFaces(person.id);
    expect(result.flaggedFaces.map((f) => f.assetFaceId)).toEqual([f2]);
  });

  it('filters a face-level decline made after the scan (E3)', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const f1 = await seedEligibleFace(ctx, user.id, person.id);
    const f2 = await seedEligibleFace(ctx, user.id, person.id);
    await seedCompletedScanWithFlagged(scanRepo, [
      { assetFaceId: f1, personId: person.id, suspectedOwnerId: owner.id },
      { assetFaceId: f2, personId: person.id, suspectedOwnerId: owner.id },
    ]);

    // A face-level "keep here" is now a shared verdict, visible to both face engines.
    await ctx.get(FacePersonVerdictRepository).markRejected(owner.id, f1, { source: 'cleanup', actorId: user.id });

    const result = await sut.getPersonFlaggedFaces(person.id);
    expect(result.flaggedFaces.map((f) => f.assetFaceId)).toEqual([f2]);
  });

  it('filters a person-level dismiss made after the scan (E4)', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const f1 = await seedEligibleFace(ctx, user.id, person.id);
    await seedCompletedScanWithFlagged(scanRepo, [
      { assetFaceId: f1, personId: person.id, suspectedOwnerId: owner.id },
    ]);

    await sut.createDeclines({
      persons: [{ personId: person.id, suspectedOwnerIds: [owner.id] }],
      declinedBy: user.id,
    });

    const result = await sut.getPersonFlaggedFaces(person.id);
    expect(result.flaggedFaces).toEqual([]);
  });

  it('still shows a stored face whose owner cluster vanished (snapshot semantics, no recompute) (E13)', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const f1 = await seedEligibleFace(ctx, user.id, person.id);
    await seedCompletedScanWithFlagged(scanRepo, [
      { assetFaceId: f1, personId: person.id, suspectedOwnerId: owner.id },
    ]);

    // Delete the suspected owner — a fresh recompute could no longer flag f1, but the read is a snapshot.
    await db.deleteFrom('person').where('id', '=', owner.id).execute();

    const result = await sut.getPersonFlaggedFaces(person.id);
    expect(result.flaggedFaces.map((f) => f.assetFaceId)).toEqual([f1]);
  });

  it('returns a large flagged set as a bounded read (E10)', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const faces = [];
    for (let i = 0; i < 150; i++) {
      const id = await seedEligibleFace(ctx, user.id, person.id);
      faces.push({ assetFaceId: id, personId: person.id, suspectedOwnerId: owner.id });
    }
    await seedCompletedScanWithFlagged(scanRepo, faces);

    const result = await sut.getPersonFlaggedFaces(person.id);
    expect(result.flaggedFaces).toHaveLength(150);
  });

  it('returns empty when the latest scan has no rows yet (running re-scan) (E12)', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const f1 = await seedEligibleFace(ctx, user.id, person.id);
    await seedCompletedScanWithFlagged(scanRepo, [
      { assetFaceId: f1, personId: person.id, suspectedOwnerId: owner.id },
    ]);

    // A newer scan (no rows yet) becomes the latest.
    await scanRepo.createScan({ requestedBy: null, params: PARAMS });

    const result = await sut.getPersonFlaggedFaces(person.id);
    expect(result.flaggedFaces).toEqual([]);
  });

  it('returns empty when there is no scan at all (E6)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const result = await sut.getPersonFlaggedFaces(person.id);
    expect(result.flaggedFaces).toEqual([]);
  });
});
