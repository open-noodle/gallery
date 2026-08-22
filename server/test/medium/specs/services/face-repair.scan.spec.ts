import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum';
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
import { insertPersonGroup, mediumFactory, newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// Two clusters on disjoint embedding axes — maximally dissimilar (cosine distance ~1.0),
// standing in for two genuinely different people.
const axisEmbedding = (axis: 'first' | 'second') => {
  const values = Array.from({ length: 512 }, (_, index) => {
    const inFirstHalf = index < 256;
    return (axis === 'first' ? inFirstHalf : !inFirstHalf) ? 1 : 0;
  });
  return '[' + values.join(',') + ']';
};

const PARAMS: RepairScanParams = {
  maxDistance: 0.6,
  minFaces: 3,
  voteWindow: 50,
  voteMargin: 2,
  maxAttributionDistance: 0.35,
  maxFlaggedFraction: 0.5,
  largeClusterThreshold: 50,
};

let db: Kysely<DB>;

const setup = () =>
  newMediumService(FaceRepairService, {
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

beforeAll(async () => {
  db = await getKyselyDB();
});

afterEach(() => db.deleteFrom('face_repair_scan').execute());

describe('FaceRepairService.handleFaceRepairScan', () => {
  it('getLatestScan returns null when no scan row exists', async () => {
    const { sut } = setup();
    const result = await sut.getLatestScanStatus();
    expect(result).toBeNull();
  });

  it('clean instance: handleFaceRepairScan completes with empty report (no flagged faces), not failed', async () => {
    const { sut, ctx } = setup();
    const scanRepo = ctx.get(FaceRepairScanRepository);

    // Create a fresh user with no faces — nothing eligible → empty scan
    await ctx.newUser();

    const scan = await scanRepo.createScan({ requestedBy: null, params: PARAMS });

    await sut.handleFaceRepairScan({ scanId: scan.id });

    const latest = await sut.getLatestScanStatus();
    expect(latest).not.toBeNull();
    expect(latest!.status).toBe('completed');
    expect(latest!.persons).toEqual([]);
    expect(latest!.totals).not.toBeNull();
    expect(latest!.totals!.eligibleFaces).toBe(0);
    expect(latest!.totals!.flaggedFaces).toBe(0);
  });

  it('handleFaceRepairScan with flagged person: scan completes with persons having recommendation + reviewReasons', async () => {
    const { sut, ctx } = setup();
    const scanRepo = ctx.get(FaceRepairScanRepository);
    const { user } = await ctx.newUser();

    // Karina-main: 10 first-axis faces (the reference cluster)
    const karinaData = mediumFactory.personInsert({ personGroupId: await insertPersonGroup(db, user.id), ownerId: user.id, name: 'Karina' });
    await db.insertInto('person').values(karinaData).execute();
    for (let i = 0; i < 10; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: karinaData.personGroupId });
      await db
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
    }

    // Alexia: 3 leaked first-axis faces + 8 genuine second-axis → under cap → toRepair
    // Named person → should get recommendation='review-first' with reason 'named'
    const alexiaData = mediumFactory.personInsert({ personGroupId: await insertPersonGroup(db, user.id), ownerId: user.id, name: 'Alexia' });
    await db.insertInto('person').values(alexiaData).execute();
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexiaData.personGroupId });
      await db
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
    }
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexiaData.personGroupId });
      await db
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
        .execute();
    }

    const scan = await scanRepo.createScan({ requestedBy: null, params: PARAMS });
    await sut.handleFaceRepairScan({ scanId: scan.id });

    const latest = await sut.getLatestScanStatus();
    expect(latest).not.toBeNull();
    expect(latest!.status).toBe('completed');
    expect(latest!.totals).not.toBeNull();
    expect(latest!.totals!.flaggedFaces).toBeGreaterThan(0);
    expect(latest!.persons.length).toBeGreaterThan(0);

    // Alexia is a named person with flagged faces → review-first with 'named' reason
    const alexiaPerson = latest!.persons.find((p) => p.personGroupId === alexiaData.personGroupId);
    expect(alexiaPerson).toBeDefined();
    expect(alexiaPerson!.recommendation).toBe('review-first');
    expect(alexiaPerson!.reviewReasons).toContain('named');
    expect(alexiaPerson!.flagged).toBeGreaterThan(0);
    expect(alexiaPerson!.suspectedOwners.length).toBeGreaterThan(0);
  });

  // D12: the persisted scan report is a point-in-time snapshot. When the suggestion engine (or an admin,
  // via a manual placement) settles one of a person's flagged faces AFTER the scan ran, the dashboard must
  // reflect that live — not keep showing the stale scan-time count until the next full re-scan.
  it('drops a person’s flagged count once a suggestion-side verdict settles one of its flagged faces (D12)', async () => {
    const { sut, ctx } = setup();
    const scanRepo = ctx.get(FaceRepairScanRepository);
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const { user } = await ctx.newUser();

    // Karina-main: 10 first-axis faces (the reference cluster / suspected owner).
    const karinaData = mediumFactory.personInsert({ personGroupId: await insertPersonGroup(db, user.id), ownerId: user.id, name: 'Karina' });
    await db.insertInto('person').values(karinaData).execute();
    for (let i = 0; i < 10; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: karinaData.personGroupId });
      await db
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
    }

    // Alexia: 3 leaked first-axis faces (flagged toward Karina) + 8 genuine second-axis.
    const alexiaData = mediumFactory.personInsert({ personGroupId: await insertPersonGroup(db, user.id), ownerId: user.id, name: 'Alexia' });
    await db.insertInto('person').values(alexiaData).execute();
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexiaData.personGroupId });
      await db
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
    }
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexiaData.personGroupId });
      await db
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
        .execute();
    }

    const scan = await scanRepo.createScan({ requestedBy: null, params: PARAMS });
    await sut.handleFaceRepairScan({ scanId: scan.id });

    const before = await sut.getLatestScanStatus();
    const alexiaBefore = before!.persons.find((p) => p.personGroupId === alexiaData.personGroupId);
    expect(alexiaBefore).toBeDefined();
    expect(alexiaBefore!.flagged).toBe(3);
    const karinaOwnerBefore = alexiaBefore!.suspectedOwners.find((o) => o.ownerPersonId === karinaData.personGroupId);
    expect(karinaOwnerBefore).toBeDefined();
    expect(karinaOwnerBefore!.count).toBe(3);

    // Settle ONE of the flagged faces with a human placement — the exact durable record a suggestion-side
    // confirm (or a cleanup "keep here"/lock) writes. This never touches the scan row itself.
    const flaggedFaces = await scanRepo.getScanFlaggedFaces(scan.id, alexiaData.personGroupId);
    expect(flaggedFaces.length).toBe(3);
    const settledFaceId = flaggedFaces[0].assetFaceId;
    const alexiaIdentity = await faceIdentityRepo.ensurePersonIdentity(alexiaData.personGroupId);
    await faceIdentityRepo.replaceFaceIdentity({
      assetFaceId: settledFaceId,
      identityId: alexiaIdentity.id,
      source: 'manual',
    });

    const after = await sut.getLatestScanStatus();
    const alexiaAfter = after!.persons.find((p) => p.personGroupId === alexiaData.personGroupId);
    expect(alexiaAfter).toBeDefined();
    expect(alexiaAfter!.flagged).toBe(2);
    expect(alexiaAfter!.flaggedFraction).toBeCloseTo(2 / alexiaAfter!.eligible, 5);
    const karinaOwnerAfter = alexiaAfter!.suspectedOwners.find((o) => o.ownerPersonId === karinaData.personGroupId);
    expect(karinaOwnerAfter).toBeDefined();
    expect(karinaOwnerAfter!.count).toBe(2);

    // The scan's own persisted `eligible` denominator is untouched — only how many of those eligible faces
    // are STILL flagged changes.
    expect(alexiaAfter!.eligible).toBe(alexiaBefore!.eligible);
  });

  it('triggerScan overrides flow to the engine: maxFlaggedFraction flips a cluster repairable→review-only', async () => {
    const { sut, ctx } = setup();
    const jobMock = ctx.getMock(JobRepository);
    jobMock.isActive.mockResolvedValue(false);
    jobMock.queue.mockResolvedValue();
    const { user } = await ctx.newUser();

    // Reference owner Karina: 10 first-axis faces, so the leaked faces have a clean cluster to vote toward.
    const karina = mediumFactory.personInsert({ personGroupId: await insertPersonGroup(db, user.id), ownerId: user.id, name: 'Karina' });
    await db.insertInto('person').values(karina).execute();
    for (let i = 0; i < 10; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: karina.personGroupId });
      await db
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
    }

    // Unnamed cluster: 3 leaked first-axis + 8 genuine second-axis → 3/11 ≈ 27% flagged.
    const cluster = mediumFactory.personInsert({ personGroupId: await insertPersonGroup(db, user.id), ownerId: user.id, name: '' });
    await db.insertInto('person').values(cluster).execute();
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: cluster.personGroupId });
      await db
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
    }
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: cluster.personGroupId });
      await db
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
        .execute();
    }

    // Default run (no overrides): 27% < DEFAULT_MAX_FLAGGED_FRACTION (0.5) cap → the leaked faces are repairable, none over-cap.
    const a = await sut.triggerScan(user.id);
    await sut.handleFaceRepairScan({ scanId: a.scanId });
    const defaultRun = await sut.getLatestScanStatus();
    expect(defaultRun!.status).toBe('completed');
    expect(defaultRun!.totals).not.toBeNull();
    expect(defaultRun!.totals!.toRepair).toBeGreaterThan(0);
    expect(defaultRun!.totals!.reviewOnlyByReason.overCap).toBe(0);

    // Clear the scan row so the tuned run is unambiguously the latest (and avoids any active-scan guard).
    await db.deleteFrom('face_repair_scan').execute();

    // Tuned run: 27% > 0.1 cap → the SAME faces go review-only (over-cap), none repaired.
    const b = await sut.triggerScan(user.id, { maxFlaggedFraction: 0.1 });
    await sut.handleFaceRepairScan({ scanId: b.scanId });
    const tunedRun = await sut.getLatestScanStatus();
    expect(tunedRun!.status).toBe('completed');
    expect(tunedRun!.totals).not.toBeNull();
    expect(tunedRun!.totals!.toRepair).toBe(0);
    expect(tunedRun!.totals!.reviewOnlyByReason.overCap).toBeGreaterThan(0);
  });

  it('carries the destination overlay through the live flagged-count recompute', async () => {
    // withLiveFlaggedCounts rebuilds every suspectedOwner. If its object spread is ever replaced with an
    // explicit literal, the overlay fields vanish between the repository and the client with nothing else
    // failing. (Swapping the call order alone does NOT reproduce this — verified by hand; see
    // face-repair.service.ts:582-587.)
    const { sut, ctx } = setup();
    const scanRepo = ctx.get(FaceRepairScanRepository);
    const { user } = await ctx.newUser();

    const karinaData = mediumFactory.personInsert({ personGroupId: await insertPersonGroup(db, user.id), ownerId: user.id, name: 'Karina' });
    await db.insertInto('person').values(karinaData).execute();
    for (let i = 0; i < 10; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: karinaData.personGroupId });
      await db
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
    }

    const alexiaData = mediumFactory.personInsert({ personGroupId: await insertPersonGroup(db, user.id), ownerId: user.id, name: 'Alexia' });
    await db.insertInto('person').values(alexiaData).execute();
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexiaData.personGroupId });
      await db
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
    }
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexiaData.personGroupId });
      await db
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
        .execute();
    }

    const scan = await scanRepo.createScan({ requestedBy: null, params: PARAMS });
    await sut.handleFaceRepairScan({ scanId: scan.id });

    const latest = await sut.getLatestScanStatus();
    const alexia = latest!.persons.find((p) => p.personGroupId === alexiaData.personGroupId)!;
    const destination = alexia.suspectedOwners.find((o) => o.ownerPersonId === karinaData.personGroupId)!;

    // Karina has 10 real faces; the routing share is the 3 leaked onto Alexia. Two different numbers, and
    // both must survive the recompute.
    expect(destination.ownerFaceCount).toBe(10);
    expect(destination.ownerMissing).toBe(false);
    expect(destination.count).toBeGreaterThan(0);
    expect(destination.count).not.toBe(destination.ownerFaceCount);
  });

  // Slice 1 (F1): a cluster contaminated with a Locked-asset leaked face and a Timeline leaked face — only
  // the Timeline one may be flagged for repair. S1.10.
  it('S1.10: only the timeline leaked face is flagged, not the one on a locked asset (control: the timeline face IS flagged)', async () => {
    const { sut, ctx } = setup();
    const scanRepo = ctx.get(FaceRepairScanRepository);
    const { user } = await ctx.newUser();

    // Karina-main: 10 first-axis faces (the reference cluster).
    const karinaData = mediumFactory.personInsert({ personGroupId: await insertPersonGroup(db, user.id), ownerId: user.id, name: 'Karina' });
    await db.insertInto('person').values(karinaData).execute();
    for (let i = 0; i < 10; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: karinaData.personGroupId });
      await db
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
    }

    // Alexia: 8 genuine second-axis faces + 2 leaked first-axis faces (one timeline, one locked).
    const alexiaData = mediumFactory.personInsert({ personGroupId: await insertPersonGroup(db, user.id), ownerId: user.id, name: 'Alexia' });
    await db.insertInto('person').values(alexiaData).execute();
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexiaData.personGroupId });
      await db
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
        .execute();
    }
    const { asset: timelineAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    const { assetFace: timelineLeakedFace } = await ctx.newAssetFace({
      assetId: timelineAsset.id,
      personGroupId: alexiaData.personGroupId,
    });
    await db
      .insertInto('face_search')
      .values({ faceId: timelineLeakedFace.id, embedding: axisEmbedding('first') })
      .execute();

    const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
    const { assetFace: lockedLeakedFace } = await ctx.newAssetFace({
      assetId: lockedAsset.id,
      personGroupId: alexiaData.personGroupId,
    });
    await db
      .insertInto('face_search')
      .values({ faceId: lockedLeakedFace.id, embedding: axisEmbedding('first') })
      .execute();

    const scan = await scanRepo.createScan({ requestedBy: null, params: PARAMS });
    await sut.handleFaceRepairScan({ scanId: scan.id });

    const flaggedFaces = await scanRepo.getScanFlaggedFaces(scan.id, alexiaData.personGroupId);
    const flaggedIds = flaggedFaces.map((f) => f.assetFaceId);

    expect(flaggedIds).toContain(timelineLeakedFace.id); // positive control
    expect(flaggedIds).not.toContain(lockedLeakedFace.id);
  });
});
