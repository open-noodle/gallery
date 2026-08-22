import { Kysely } from 'kysely';
import { JobName } from 'src/enum';
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
import { FaceRepairService, ReattributionCandidate, RepairPlan } from 'src/services/face-repair.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

// Two clusters on disjoint embedding axes are maximally dissimilar (cosine distance ~1.0), standing in
// for two genuinely different people. newEmbedding() can't be used here: its all-positive random
// components leave two independent vectors ~0.75 similar.
const axisEmbedding = (axis: 'first' | 'second') => {
  const values = Array.from({ length: 512 }, (_, index) => {
    const inFirstHalf = index < 256;
    return (axis === 'first' ? inFirstHalf : !inFirstHalf) ? 1 : 0;
  });
  return '[' + values.join(',') + ']';
};

const setup = (db?: Kysely<DB>) => {
  return newMediumService(FaceRepairService, {
    database: db || defaultDatabase,
    real: [
      FaceRepairRepository,
      SearchRepository,
      PersonRepository,
      FaceRepairDeclineRepository,
      FacePersonVerdictRepository,
      FaceIdentityRepository,
    ],
    mock: [LoggingRepository],
  });
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const buildCluster = async (
  ctx: ReturnType<typeof setup>['ctx'],
  ownerId: string,
  embedding: string,
  faceCount: number,
) => {
  const { person } = await ctx.newPerson({ ownerId });
  const faceIds: string[] = [];
  for (let index = 0; index < faceCount; index++) {
    const { asset } = await ctx.newAsset({ ownerId });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding }).execute();
    faceIds.push(assetFace.id);
  }
  return { person, faceIds };
};

describe('FaceRepairService.findReattributionCandidates', () => {
  it('reports leaked faces with topOtherPersonId pointing to the true owner', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();

    // Karina-main: many faces on 'first' axis
    const { person: karina, faceIds: karinaFaceIds } = await buildCluster(ctx, user.id, axisEmbedding('first'), 10);

    // Alexia: a few leaked 'first'-axis faces wrongly assigned to her
    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const leakedFaceIds: string[] = [];
    for (let index = 0; index < 3; index++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      leakedFaceIds.push(assetFace.id);
    }

    const candidates: ReattributionCandidate[] = await Array.fromAsync(
      sut.findReattributionCandidates({ ownerId: user.id, maxDistance: 0.6, voteWindow: 50 }),
    );

    // Each leaked face (on Alexia) should report Karina as topOtherPersonId
    for (const leakedId of leakedFaceIds) {
      const candidate = candidates.find((c) => c.assetFaceId === leakedId);
      expect(candidate).toBeDefined();
      expect(candidate!.currentPersonId).toBe(alexia.personGroupId);
      expect(candidate!.topOtherPersonId).toBe(karina.personGroupId);
      expect(candidate!.topOtherCount).toBeGreaterThan(0);
    }

    // Clean Karina faces: Karina's own neighbors dominate (10 own, 3 leaked Alexia)
    const karinaCandidate = candidates.find((c) => c.assetFaceId === karinaFaceIds[0]);
    expect(karinaCandidate).toBeDefined();
    // Karina's own count must be strictly greater than any rival (own-person dominates)
    expect(karinaCandidate!.ownCount).toBeGreaterThan(karinaCandidate!.topOtherCount);
  });

  it('excludes self from neighbors (single-face person has ownCount === 0)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();

    // A single isolated face on 'second' axis — no neighbors in range
    const { person: isolated } = await ctx.newPerson({ ownerId: user.id });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: isolated.personGroupId });
    await ctx.database
      .insertInto('face_search')
      .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
      .execute();

    const candidates: ReattributionCandidate[] = await Array.fromAsync(
      sut.findReattributionCandidates({ ownerId: user.id, maxDistance: 0.6, voteWindow: 50 }),
    );

    const candidate = candidates.find((c) => c.assetFaceId === assetFace.id);
    expect(candidate).toBeDefined();
    // Self excluded: no neighbors → ownCount = 0, topOtherPersonId = null
    expect(candidate!.ownCount).toBe(0);
    expect(candidate!.topOtherPersonId).toBeNull();
  });

  it('does not report cross-owner neighbors as topOther', async () => {
    const { sut, ctx } = setup();
    const { user: ownerA } = await ctx.newUser();
    const { user: ownerB } = await ctx.newUser();

    // Owner A has one face on 'first' axis
    const { person: personA } = await ctx.newPerson({ ownerId: ownerA.id });
    const { asset: assetA } = await ctx.newAsset({ ownerId: ownerA.id });
    const { assetFace: faceA } = await ctx.newAssetFace({ assetId: assetA.id, personGroupId: personA.personGroupId });
    await ctx.database
      .insertInto('face_search')
      .values({ faceId: faceA.id, embedding: axisEmbedding('first') })
      .execute();

    // Owner B has many faces on 'first' axis (identical embedding — maximally close)
    await buildCluster(ctx, ownerB.id, axisEmbedding('first'), 10);

    const candidates: ReattributionCandidate[] = await Array.fromAsync(
      sut.findReattributionCandidates({ ownerId: ownerA.id, maxDistance: 0.6, voteWindow: 50 }),
    );

    // Owner A's face should not see owner B's person as topOther (cross-owner)
    const candidateA = candidates.find((c) => c.assetFaceId === faceA.id);
    expect(candidateA).toBeDefined();
    expect(candidateA!.topOtherPersonId).toBeNull();
  });
});

// Disjoint mixed-axis embeddings that are outside maxDistance=0.6 of both pure axes and of each other.
// Each vector has 64 ones in the first half and 64 ones in the second half (non-overlapping 64-element
// windows), giving ||v|| = sqrt(128).  cos_sim vs either pure axis ≈ 64/181 ≈ 0.354 → distance ≈ 0.646.
const mixedAxisEmbedding = (slot: 0 | 1 | 2 | 3) => {
  const firstHalfStart = slot * 64;
  const secondHalfStart = 256 + slot * 64;
  const values = Array.from({ length: 512 }, (_, i) =>
    (i >= firstHalfStart && i < firstHalfStart + 64) || (i >= secondHalfStart && i < secondHalfStart + 64) ? 1 : 0,
  );
  return '[' + values.join(',') + ']';
};

// Shared params for all buildRepairPlan tests.
const planParams = {
  maxDistance: 0.6,
  voteWindow: 50,
  minFaces: 3,
  voteMargin: 2,
  maxAttributionDistance: 0.35,
  maxFlaggedFraction: 0.5,
};

describe('FaceRepairService.buildRepairPlan', () => {
  it('routes flagged faces correctly: toRepair vs reviewOnly (cap + bad-target + boundary + untouched)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();

    // === Karina-main: 10 first-axis faces (the reference cluster; not a victim) ===
    const { person: karina } = await buildCluster(ctx, user.id, axisEmbedding('first'), 10);

    // === Alexia: 8 genuine second-axis + 3 leaked first-axis faces (under cap → toRepair) ===
    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const alexiaLeakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      alexiaLeakedFaceIds.push(assetFace.id);
    }
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
        .execute();
    }

    // === dup: 6 first-axis (flagged toward Karina) + 4 third-axis genuine (not flagged) ===
    // flaggedFraction = 6/10 = 0.6 > maxFlaggedFraction=0.5  →  over-cap
    const { person: dup } = await ctx.newPerson({ ownerId: user.id });
    const dupFlaggedFaceIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: dup.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      dupFlaggedFaceIds.push(assetFace.id);
    }
    // 4 genuine faces on mixedAxis slot 0 (isolated, no other person on this axis)
    for (let i = 0; i < 4; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: dup.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: mixedAxisEmbedding(0) })
        .execute();
    }

    // === sibling: 5 first-axis (flagged toward Karina) + 5 fourth-axis genuine ===
    // flaggedFraction = 5/10 = 0.5  →  NOT > cap (boundary case) → toRepair
    const { person: sibling } = await ctx.newPerson({ ownerId: user.id });
    const siblingFlaggedFaceIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: sibling.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      siblingFlaggedFaceIds.push(assetFace.id);
    }
    for (let i = 0; i < 5; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: sibling.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: mixedAxisEmbedding(1) })
        .execute();
    }

    // === victimA: 3 faces on mixedAxis slot 0 (flagged toward dup) + 4 genuine on slot 2 ===
    // dup has 4 slot-0 faces; victimA has 3 → each victimA slot-0 face has ownCount=2 < minFaces=3
    // AND topOtherCount=4 ≥ minFaces=3 → FLAGGED toward dup.
    // dup has 4 slot-0 faces; each dup slot-0 face has ownCount=3 AND topOtherCount=3 → margin=0 < 2 → NOT flagged.
    // flaggedFraction for victimA = 3/(3+4) = 3/7 ≈ 0.43 < 0.5 → under-cap (bad-target, not over-cap)
    const { person: victimA } = await ctx.newPerson({ ownerId: user.id });
    const victimAFlaggedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: victimA.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: mixedAxisEmbedding(0) })
        .execute();
      victimAFlaggedFaceIds.push(assetFace.id);
    }
    for (let i = 0; i < 4; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: victimA.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: mixedAxisEmbedding(2) })
        .execute();
    }

    // === solo: 4 faces on mixedAxis slot 3 — completely isolated, no confident Q ===
    const { person: solo, faceIds: soloFaceIds } = await buildCluster(ctx, user.id, mixedAxisEmbedding(3), 4);

    // ── Run ────────────────────────────────────────────────────────────────────
    const plan: RepairPlan = await sut.buildRepairPlan({ ownerId: user.id, ...planParams });

    // ── perPerson fractions ────────────────────────────────────────────────────
    const pp = (id: string) => plan.perPerson.find((p) => p.personGroupId === id)!;

    // Alexia: 3 flagged / 11 eligible ≈ 0.27
    expect(pp(alexia.personGroupId).eligible).toBe(11);
    expect(pp(alexia.personGroupId).flagged).toBe(3);
    expect(pp(alexia.personGroupId).flaggedFraction).toBeCloseTo(3 / 11);

    // dup: 6 flagged / 10 eligible = 0.6 (over-cap)
    expect(pp(dup.personGroupId).eligible).toBe(10);
    expect(pp(dup.personGroupId).flagged).toBe(6);
    expect(pp(dup.personGroupId).flaggedFraction).toBeCloseTo(0.6);

    // sibling: 5 flagged / 10 eligible = 0.5 (boundary, NOT over-cap)
    expect(pp(sibling.personGroupId).eligible).toBe(10);
    expect(pp(sibling.personGroupId).flagged).toBe(5);
    expect(pp(sibling.personGroupId).flaggedFraction).toBeCloseTo(0.5);

    // victimA: 3 flagged / 7 eligible ≈ 0.43 (under-cap)
    expect(pp(victimA.personGroupId).eligible).toBe(7);
    expect(pp(victimA.personGroupId).flagged).toBe(3);
    expect(pp(victimA.personGroupId).flaggedFraction).toBeCloseTo(3 / 7);

    // solo: 0 flagged / 4 eligible
    expect(pp(solo.personGroupId).eligible).toBe(4);
    expect(pp(solo.personGroupId).flagged).toBe(0);

    // ── reviewOnlyPersonIds ────────────────────────────────────────────────────
    expect(plan.reviewOnlyPersonIds).toContain(dup.personGroupId);
    expect(plan.reviewOnlyPersonIds).not.toContain(alexia.personGroupId);
    expect(plan.reviewOnlyPersonIds).not.toContain(sibling.personGroupId);
    expect(plan.reviewOnlyPersonIds).not.toContain(victimA.personGroupId);
    expect(plan.reviewOnlyPersonIds).not.toContain(karina.personGroupId);

    // ── toRepair ───────────────────────────────────────────────────────────────
    // Alexia's 3 leaked faces → toRepair (suspectedOwner = karina)
    for (const faceId of alexiaLeakedFaceIds) {
      const repaired = plan.toRepair.find((f) => f.assetFaceId === faceId);
      expect(repaired).toBeDefined();
      expect(repaired!.suspectedOwnerId).toBe(karina.personGroupId);
    }
    // sibling's 5 first-axis faces → toRepair (boundary: fraction=0.5 NOT > cap)
    for (const faceId of siblingFlaggedFaceIds) {
      expect(plan.toRepair.find((f) => f.assetFaceId === faceId)).toBeDefined();
    }
    // dup's flagged faces must NOT be in toRepair (over-cap)
    for (const faceId of dupFlaggedFaceIds) {
      expect(plan.toRepair.find((f) => f.assetFaceId === faceId)).toBeUndefined();
    }
    // victimA's flagged faces must NOT be in toRepair (bad-target)
    for (const faceId of victimAFlaggedFaceIds) {
      expect(plan.toRepair.find((f) => f.assetFaceId === faceId)).toBeUndefined();
    }
    // solo's faces must NOT be in toRepair
    for (const faceId of soloFaceIds) {
      expect(plan.toRepair.find((f) => f.assetFaceId === faceId)).toBeUndefined();
    }

    // ── reviewOnlyFaces ────────────────────────────────────────────────────────
    // dup's 6 flagged first-axis faces → reason='over-cap'
    for (const faceId of dupFlaggedFaceIds) {
      const rof = plan.reviewOnlyFaces.find((f) => f.assetFaceId === faceId);
      expect(rof).toBeDefined();
      expect(rof!.reason).toBe('over-cap');
    }
    // victimA's 3 flagged slot-0 faces → reason='bad-target'
    for (const faceId of victimAFlaggedFaceIds) {
      const rof = plan.reviewOnlyFaces.find((f) => f.assetFaceId === faceId);
      expect(rof).toBeDefined();
      expect(rof!.reason).toBe('bad-target');
    }
    // solo's faces must not appear in reviewOnlyFaces
    for (const faceId of soloFaceIds) {
      expect(plan.reviewOnlyFaces.find((f) => f.assetFaceId === faceId)).toBeUndefined();
    }
  });

  it('unAttributableFaces: close-but-sub-minFaces neighbor lands in unAttributableFaces, not toRepair; isolated face does not', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();

    // clusterSmall: 2 first-axis faces (< minFaces=3, so not a confident owner)
    await buildCluster(ctx, user.id, axisEmbedding('first'), 2);

    // suspect: 1 first-axis face belonging to a different person — ownCount < minFaces=3,
    // topOtherPersonId=clusterSmall, topOtherNearest ~0 (identical axis) <= maxAttributionDistance=0.35,
    // but topOtherCount=2 < minFaces=3 → NOT flagged → should land in unAttributableFaces
    const { person: suspect } = await ctx.newPerson({ ownerId: user.id });
    const { asset: suspectAsset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: suspectFace } = await ctx.newAssetFace({ assetId: suspectAsset.id, personGroupId: suspect.personGroupId });
    await ctx.database
      .insertInto('face_search')
      .values({ faceId: suspectFace.id, embedding: axisEmbedding('first') })
      .execute();

    // isolated: 1 face on a completely separate axis — no neighbors within maxDistance=0.6 → NOT unAttributable
    const { person: isolated } = await ctx.newPerson({ ownerId: user.id });
    const { asset: isolatedAsset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: isolatedFace } = await ctx.newAssetFace({ assetId: isolatedAsset.id, personGroupId: isolated.personGroupId });
    await ctx.database
      .insertInto('face_search')
      .values({ faceId: isolatedFace.id, embedding: axisEmbedding('second') })
      .execute();

    const plan: RepairPlan = await sut.buildRepairPlan({ ownerId: user.id, ...planParams });

    // suspect face: in unAttributableFaces, NOT in toRepair
    const unAttr = plan.unAttributableFaces.find((f) => f.assetFaceId === suspectFace.id);
    expect(unAttr).toBeDefined();
    expect(unAttr!.currentPersonId).toBe(suspect.personGroupId);
    expect(plan.toRepair.find((f) => f.assetFaceId === suspectFace.id)).toBeUndefined();

    // isolated face: NOT in unAttributableFaces (no close other owner)
    expect(plan.unAttributableFaces.find((f) => f.assetFaceId === isolatedFace.id)).toBeUndefined();

    // clusterSmall's own faces are also under minFaces — but they have each other as close neighbors
    // Their topOtherPersonId will be suspect (1 face), topOtherCount=1 < minFaces=3 → also unAttributable
    // (just confirm suspect face is captured, which is the main assertion)
  });

  it('large Karina cluster (60 faces > old window=50): sparse leaked faces are still flagged with voteWindow:200', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();

    // Karina-main: 60 first-axis faces (> old DEFAULT_VOTE_WINDOW of 50).
    // With window=200, all 60 Karina votes are visible for each leaked face.
    // With window=50, only 49 would be counted (still ≥ minFaces=3, so flagging still works here,
    // but note: if Karina's faces were < 50 and co-located leaked faces filled the window, they could
    // crowd out Karina — the documented voteWindow limitation).
    const { person: karina } = await buildCluster(ctx, user.id, axisEmbedding('first'), 60);

    // Alexia: 3 leaked first-axis faces (ownCount=2 each, < minFaces=3 — P doesn't claim F)
    // + 4 genuine second-axis faces to keep flaggedFraction = 3/7 ≈ 0.43 < maxFlaggedFraction=0.5.
    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      leakedFaceIds.push(assetFace.id);
    }
    for (let i = 0; i < 4; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
        .execute();
    }

    const plan: RepairPlan = await sut.buildRepairPlan({
      ownerId: user.id,
      ...planParams,
      voteWindow: 200, // widened window — captures all 60 Karina neighbors, not just the nearest 50
    });

    // All 3 leaked faces must flag toward Karina — topOtherCount(Karina)=60 ≥ minFaces=3
    // and ownCount(Alexia)=2 < minFaces=3 (P doesn't claim F → flagged)
    for (const faceId of leakedFaceIds) {
      const repaired = plan.toRepair.find((f) => f.assetFaceId === faceId);
      expect(repaired).toBeDefined();
      expect(repaired!.suspectedOwnerId).toBe(karina.personGroupId);
    }
  });
});

// Setup for executeRepair tests — includes real FaceIdentityRepository and mock JobRepository.
// Uses a dedicated isolated DB so getBackfillWork() is not polluted by other test suites.
let repairDatabase: Kysely<DB>;

const setupRepair = (db?: Kysely<DB>) => {
  return newMediumService(FaceRepairService, {
    database: db ?? repairDatabase,
    real: [
      FaceRepairRepository,
      SearchRepository,
      PersonRepository,
      FaceIdentityRepository,
      FaceRepairDeclineRepository,
      FacePersonVerdictRepository,
      DatabaseRepository,
    ],
    mock: [LoggingRepository, JobRepository],
  });
};

// Build a cluster (person + N faces on a given embedding) and set up identity + links so
// getBackfillWork().hasPersonalIdentityWork is false for this cluster.
const buildLinkedCluster = async (
  ctx: ReturnType<typeof setupRepair>['ctx'],
  ownerId: string,
  embedding: string,
  faceCount: number,
) => {
  const faceIdentityRepo = ctx.get(FaceIdentityRepository);
  const { person } = await ctx.newPerson({ ownerId });
  const identity = await faceIdentityRepo.ensurePersonIdentity(person.personGroupId);
  const faceIds: string[] = [];
  for (let index = 0; index < faceCount; index++) {
    const { asset } = await ctx.newAsset({ ownerId });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding }).execute();
    await faceIdentityRepo.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
    faceIds.push(assetFace.id);
  }
  return { person, identity, faceIds };
};

// The shared params that produce a manageable/deterministic plan for execute tests.
const execPlanParams = {
  maxDistance: 0.6,
  voteWindow: 50,
  minFaces: 3,
  voteMargin: 2,
  maxAttributionDistance: 0.35,
  maxFlaggedFraction: 0.5,
};

describe('FaceRepairService.executeRepair', () => {
  beforeAll(async () => {
    repairDatabase = await getKyselyDB();
  });

  it('re-attributes leaked faces directly to their suspected owner with manual identity links, no recognition re-queue', async () => {
    const { sut, ctx } = setupRepair();
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const jobMock = ctx.getMock(JobRepository);
    const { user } = await ctx.newUser();

    // Karina-main: 10 first-axis faces — the suspected owner of the leaked embedding.
    const { person: karina, faceIds: karinaFaceIds } = await buildLinkedCluster(
      ctx,
      user.id,
      axisEmbedding('first'),
      10,
    );
    const karinaIdentity = await faceIdentityRepo.ensurePersonIdentity(karina.personGroupId);

    // Alexia: 8 genuine second-axis + 3 leaked first-axis faces
    const faceIdentityRepoReal = ctx.get(FaceIdentityRepository);
    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const alexiaIdentity = await faceIdentityRepoReal.ensurePersonIdentity(alexia.personGroupId);
    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
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
    const alexiaGenuineFaceIds: string[] = [];
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
        .execute();
      await faceIdentityRepo.linkFace({
        assetFaceId: assetFace.id,
        identityId: alexiaIdentity.id,
        source: 'owner-person',
      });
      alexiaGenuineFaceIds.push(assetFace.id);
    }

    // Confirm baseline: no backfill work before repair
    const baselineWork = await faceIdentityRepo.getBackfillWork();
    expect(baselineWork.hasPersonalIdentityWork).toBe(false);

    jobMock.queueAll.mockResolvedValue();

    const plan = await sut.buildRepairPlan({ ownerId: user.id, ...execPlanParams });
    await sut.executeRepair(plan);

    // Leaked faces now belong to their suspected owner Karina (durable, not unassigned).
    const leakedRows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personGroupId'])
      .where('id', 'in', leakedFaceIds)
      .execute();
    for (const row of leakedRows) {
      expect(row.personGroupId).toBe(karina.personGroupId);
    }

    // face_identity_face rows for leaked faces now point to Karina's identity, sourced 'manual'
    // (so a later recognition pass cannot re-cluster them away).
    const leakedLinks = await ctx.database
      .selectFrom('face_identity_face')
      .select(['assetFaceId', 'identityId', 'source'])
      .where('assetFaceId', 'in', leakedFaceIds)
      .execute();
    expect(leakedLinks).toHaveLength(leakedFaceIds.length);
    for (const link of leakedLinks) {
      expect(link.identityId).toBe(karinaIdentity.id);
      expect(link.source).toBe('manual');
    }

    // Genuine Alexia faces are untouched
    const alexiaRows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personGroupId'])
      .where('id', 'in', alexiaGenuineFaceIds)
      .execute();
    for (const row of alexiaRows) {
      expect(row.personGroupId).toBe(alexia.personGroupId);
    }

    // Karina's original faces are untouched
    const karinaRows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personGroupId'])
      .where('id', 'in', karinaFaceIds)
      .execute();
    for (const row of karinaRows) {
      expect(row.personGroupId).toBe(karina.personGroupId);
    }

    // No-loop invariant: getBackfillWork().hasPersonalIdentityWork is false after repair
    const afterWork = await faceIdentityRepo.getBackfillWork();
    expect(afterWork.hasPersonalIdentityWork).toBe(false);

    // The move is direct — FacialRecognition is never re-queued (that re-queue was the boomerang vector).
    const queuedJobNames = jobMock.queueAll.mock.calls.flatMap(([items]) => items).map((item) => item.name);
    expect(queuedJobNames).not.toContain(JobName.FacialRecognition);
  });

  it('review-only: does not touch faces of an over-cap person', async () => {
    const { sut, ctx } = setupRepair();
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const { user } = await ctx.newUser();

    // Karina-main: 10 first-axis faces
    await buildLinkedCluster(ctx, user.id, axisEmbedding('first'), 10);

    // Over-cap person: 6 leaked first-axis + 4 genuine mixed — flaggedFraction=0.6 > 0.5 → reviewOnly
    const { person: overCap } = await ctx.newPerson({ ownerId: user.id });
    const overCapIdentity = await faceIdentityRepo.ensurePersonIdentity(overCap.personGroupId);
    const overCapFaceIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: overCap.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      await faceIdentityRepo.linkFace({
        assetFaceId: assetFace.id,
        identityId: overCapIdentity.id,
        source: 'owner-person',
      });
      overCapFaceIds.push(assetFace.id);
    }
    for (let i = 0; i < 4; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: overCap.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
        .execute();
      await faceIdentityRepo.linkFace({
        assetFaceId: assetFace.id,
        identityId: overCapIdentity.id,
        source: 'owner-person',
      });
    }

    const plan = await sut.buildRepairPlan({ ownerId: user.id, ...execPlanParams });
    // The over-cap person should be review-only
    expect(plan.reviewOnlyPersonIds).toContain(overCap.personGroupId);
    expect(plan.toRepair.some((f) => overCapFaceIds.includes(f.assetFaceId))).toBe(false);

    await sut.executeRepair(plan);

    // All over-cap faces keep their personId
    const rows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personGroupId'])
      .where('id', 'in', overCapFaceIds)
      .execute();
    for (const row of rows) {
      expect(row.personGroupId).toBe(overCap.personGroupId);
    }
  });

  it('rep-face reconcile: faceAssetId is updated when the rep was among the re-attributed faces', async () => {
    const { sut, ctx } = setupRepair();
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const jobMock = ctx.getMock(JobRepository);
    jobMock.queueAll.mockResolvedValue();
    const { user } = await ctx.newUser();

    // Karina-main: 10 first-axis faces
    await buildLinkedCluster(ctx, user.id, axisEmbedding('first'), 10);

    // Alexia: 8 genuine + 3 leaked; set faceAssetId to first leaked face
    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const alexiaIdentity = await faceIdentityRepo.ensurePersonIdentity(alexia.personGroupId);
    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
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
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
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
    // Point faceAssetId at first leaked face
    await ctx.database
      .updateTable('person')
      .set({ faceAssetId: leakedFaceIds[0] })
      .where('personGroupId', '=', alexia.personGroupId)
      .execute();

    const plan = await sut.buildRepairPlan({ ownerId: user.id, ...execPlanParams });
    await sut.executeRepair(plan);

    const updated = await ctx.database
      .selectFrom('person')
      .select('faceAssetId')
      .where('personGroupId', '=', alexia.personGroupId)
      .executeTakeFirstOrThrow();
    // faceAssetId must not be any of the leaked (now-re-attributed) faces
    expect(leakedFaceIds).not.toContain(updated.faceAssetId);
    expect(updated.faceAssetId).not.toBeNull();
  });

  it('eligibility re-check: a face moved to a third person before executeRepair is skipped, not re-attributed', async () => {
    const { sut, ctx } = setupRepair();
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const jobMock = ctx.getMock(JobRepository);
    const { user } = await ctx.newUser();

    // Karina-main: 10 first-axis faces — the suspected owner.
    const { person: karina } = await buildLinkedCluster(ctx, user.id, axisEmbedding('first'), 10);

    // Alexia: 8 genuine + 3 leaked — only 2 will remain in plan after one is moved
    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const alexiaIdentity = await faceIdentityRepo.ensurePersonIdentity(alexia.personGroupId);
    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
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
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
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

    // Third person Z
    const { person: personZ } = await ctx.newPerson({ ownerId: user.id });
    await faceIdentityRepo.ensurePersonIdentity(personZ.personGroupId);

    jobMock.queueAll.mockResolvedValue();

    const plan = await sut.buildRepairPlan({ ownerId: user.id, ...execPlanParams });

    // After building plan but before executing it, move one leaked face to person Z
    const movedFaceId = leakedFaceIds[0];
    await ctx.database.updateTable('asset_face').set({ personGroupId: personZ.personGroupId }).where('id', '=', movedFaceId).execute();

    await sut.executeRepair(plan);

    // The face that moved to Z since planning is left on Z — the write-time re-check (still-on-source) skips it.
    const movedRow = await ctx.database
      .selectFrom('asset_face')
      .select('personGroupId')
      .where('id', '=', movedFaceId)
      .executeTakeFirstOrThrow();
    expect(movedRow.personGroupId).toBe(personZ.personGroupId);

    // The two remaining leaked faces were re-attributed to the suspected owner Karina.
    const remainingRows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personGroupId'])
      .where('id', 'in', leakedFaceIds.slice(1))
      .execute();
    for (const row of remainingRows) {
      expect(row.personGroupId).toBe(karina.personGroupId);
    }

    // The apply never re-queues FacialRecognition.
    const queuedJobNames = jobMock.queueAll.mock.calls.flatMap(([items]) => items).map((item) => item.name);
    expect(queuedJobNames).not.toContain(JobName.FacialRecognition);
  });
});

// ── runRepair tests ────────────────────────────────────────────────────────────
// Uses a dedicated isolated DB and adds ConfigRepository + SystemMetadataRepository
// as real deps so getConfig() resolves the default config correctly.

let runRepairDatabase: Kysely<DB>;

const setupRunRepair = (db?: Kysely<DB>) => {
  return newMediumService(FaceRepairService, {
    database: db ?? runRepairDatabase,
    real: [
      FaceRepairRepository,
      SearchRepository,
      PersonRepository,
      FaceIdentityRepository,
      ConfigRepository,
      SystemMetadataRepository,
      FaceRepairDeclineRepository,
      FacePersonVerdictRepository,
      DatabaseRepository,
    ],
    mock: [LoggingRepository, JobRepository],
  });
};

// The params used by runRepair scenarios — override via options.maxDistance etc.
const runRepairPlanDefaults = {
  maxDistance: 0.6,
  voteWindow: 50,
  minFaces: 3,
  voteMargin: 2,
  maxAttributionDistance: 0.35,
  maxFlaggedFraction: 0.5,
};

describe('FaceRepairService.runRepair', () => {
  beforeAll(async () => {
    runRepairDatabase = await getKyselyDB();
  });

  it('dry-run (default): returns dryRun=true, mutated=false, flaggedFaces>0, mutates nothing, queueAll not called', async () => {
    const { sut, ctx } = setupRunRepair();
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const jobMock = ctx.getMock(JobRepository);
    jobMock.isActive.mockResolvedValue(false);
    const { user } = await ctx.newUser();

    // Karina-main: 10 first-axis faces
    await buildLinkedCluster(ctx as any, user.id, axisEmbedding('first'), 10);

    // Alexia: 8 genuine + 3 leaked first-axis
    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const alexiaIdentity = await faceIdentityRepo.ensurePersonIdentity(alexia.personGroupId);
    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
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
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
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

    const result = await sut.runRepair({ ownerId: user.id, ...runRepairPlanDefaults });

    expect(result.dryRun).toBe(true);
    expect(result.mutated).toBe(false);
    expect(result.report.totals.flaggedFaces).toBeGreaterThan(0);

    // Leaked faces must still have their original personId (nothing mutated)
    const rows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personGroupId'])
      .where('id', 'in', leakedFaceIds)
      .execute();
    for (const row of rows) {
      expect(row.personGroupId).toBe(alexia.personGroupId);
    }

    // queueAll must not have been called
    expect(jobMock.queueAll).not.toHaveBeenCalled();
  });

  it('execute: dryRun=false with isActive=false → mutated=true, leaked faces re-attributed, no recognition re-queue', async () => {
    const { sut, ctx } = setupRunRepair();
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const jobMock = ctx.getMock(JobRepository);
    jobMock.isActive.mockResolvedValue(false);
    jobMock.queueAll.mockResolvedValue();
    const { user } = await ctx.newUser();

    const { person: karina } = await buildLinkedCluster(ctx as any, user.id, axisEmbedding('first'), 10);

    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const alexiaIdentity = await faceIdentityRepo.ensurePersonIdentity(alexia.personGroupId);
    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
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
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
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

    const result = await sut.runRepair({ ownerId: user.id, dryRun: false, ...runRepairPlanDefaults });

    expect(result.dryRun).toBe(false);
    expect(result.mutated).toBe(true);

    const rows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personGroupId'])
      .where('id', 'in', leakedFaceIds)
      .execute();
    for (const row of rows) {
      expect(row.personGroupId).toBe(karina.personGroupId);
    }

    const queuedJobNames = jobMock.queueAll.mock.calls.flatMap(([items]) => items).map((item) => item.name);
    expect(queuedJobNames).not.toContain(JobName.FacialRecognition);
  });

  it('concurrency guard: isActive=true + dryRun=false → throws, nothing mutated; dryRun=true with isActive=true → succeeds', async () => {
    const { sut, ctx } = setupRunRepair();
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const jobMock = ctx.getMock(JobRepository);
    jobMock.isActive.mockResolvedValue(true);
    const { user } = await ctx.newUser();

    await buildLinkedCluster(ctx as any, user.id, axisEmbedding('first'), 10);

    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const alexiaIdentity = await faceIdentityRepo.ensurePersonIdentity(alexia.personGroupId);
    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
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
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
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

    // dryRun=false + isActive=true → throws
    await expect(sut.runRepair({ ownerId: user.id, dryRun: false, ...runRepairPlanDefaults })).rejects.toThrow();

    // Leaked faces still have their personId (nothing mutated)
    const rows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personGroupId'])
      .where('id', 'in', leakedFaceIds)
      .execute();
    for (const row of rows) {
      expect(row.personGroupId).toBe(alexia.personGroupId);
    }

    // dryRun=true (default) with isActive=true → succeeds (read-only)
    await expect(sut.runRepair({ ownerId: user.id, ...runRepairPlanDefaults })).resolves.toMatchObject({
      dryRun: true,
      mutated: false,
    });
  });

  it('scope: runRepair scoped to ownerA mutates only ownerA faces; ownerB faces remain assigned', async () => {
    const { sut, ctx } = setupRunRepair();
    const faceIdentityRepoA = ctx.get(FaceIdentityRepository);
    const jobMock = ctx.getMock(JobRepository);
    jobMock.isActive.mockResolvedValue(false);
    jobMock.queueAll.mockResolvedValue();

    const { user: ownerA } = await ctx.newUser();
    const { user: ownerB } = await ctx.newUser();

    // Owner A: karina-main + alexia with leaked faces
    const { person: karinaA } = await buildLinkedCluster(ctx as any, ownerA.id, axisEmbedding('first'), 10);
    const { person: alexiaA } = await ctx.newPerson({ ownerId: ownerA.id });
    const alexiaAIdentity = await faceIdentityRepoA.ensurePersonIdentity(alexiaA.personGroupId);
    const leakedA: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: ownerA.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexiaA.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      await faceIdentityRepoA.linkFace({
        assetFaceId: assetFace.id,
        identityId: alexiaAIdentity.id,
        source: 'owner-person',
      });
      leakedA.push(assetFace.id);
    }
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: ownerA.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexiaA.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
        .execute();
      await faceIdentityRepoA.linkFace({
        assetFaceId: assetFace.id,
        identityId: alexiaAIdentity.id,
        source: 'owner-person',
      });
    }

    // Owner B: mirrored setup
    await buildLinkedCluster(ctx as any, ownerB.id, axisEmbedding('first'), 10);
    const { person: alexiaB } = await ctx.newPerson({ ownerId: ownerB.id });
    const alexiaBIdentity = await faceIdentityRepoA.ensurePersonIdentity(alexiaB.personGroupId);
    const leakedB: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: ownerB.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexiaB.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      await faceIdentityRepoA.linkFace({
        assetFaceId: assetFace.id,
        identityId: alexiaBIdentity.id,
        source: 'owner-person',
      });
      leakedB.push(assetFace.id);
    }
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: ownerB.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexiaB.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
        .execute();
      await faceIdentityRepoA.linkFace({
        assetFaceId: assetFace.id,
        identityId: alexiaBIdentity.id,
        source: 'owner-person',
      });
    }

    await sut.runRepair({ ownerId: ownerA.id, dryRun: false, ...runRepairPlanDefaults });

    // OwnerA leaked faces are re-attributed to OwnerA's suspected owner
    const rowsA = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personGroupId'])
      .where('id', 'in', leakedA)
      .execute();
    for (const row of rowsA) {
      expect(row.personGroupId).toBe(karinaA.personGroupId);
    }

    // OwnerB leaked faces remain assigned
    const rowsB = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personGroupId'])
      .where('id', 'in', leakedB)
      .execute();
    for (const row of rowsB) {
      expect(row.personGroupId).toBe(alexiaB.personGroupId);
    }
  });

  it('idempotency: after real runRepair, second dry-run reports flaggedFaces=0', async () => {
    const { sut, ctx } = setupRunRepair();
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const jobMock = ctx.getMock(JobRepository);
    jobMock.isActive.mockResolvedValue(false);
    jobMock.queueAll.mockResolvedValue();
    const { user } = await ctx.newUser();

    await buildLinkedCluster(ctx as any, user.id, axisEmbedding('first'), 10);

    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const alexiaIdentity = await faceIdentityRepo.ensurePersonIdentity(alexia.personGroupId);
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      await faceIdentityRepo.linkFace({
        assetFaceId: assetFace.id,
        identityId: alexiaIdentity.id,
        source: 'owner-person',
      });
    }
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
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

    // First run: real execution
    await sut.runRepair({ ownerId: user.id, dryRun: false, ...runRepairPlanDefaults });

    // Second run: dry-run should report 0 flagged (re-attributed faces now match their owner's cluster)
    const result = await sut.runRepair({ ownerId: user.id, ...runRepairPlanDefaults });
    expect(result.report.totals.flaggedFaces).toBe(0);
  });

  it('empty owner: runRepair on a fresh user with no faces resolves with flaggedFaces=0, mutated=false, no throw', async () => {
    const { sut, ctx } = setupRunRepair();
    const jobMock = ctx.getMock(JobRepository);
    jobMock.isActive.mockResolvedValue(false);
    const { user: emptyUser } = await ctx.newUser();

    const result = await sut.runRepair({ ownerId: emptyUser.id, ...runRepairPlanDefaults });

    expect(result.report.totals.flaggedFaces).toBe(0);
    expect(result.mutated).toBe(false);
  });
});

// ── decline filter integration tests ──────────────────────────────────────────
// These tests exercise that buildRepairPlan (and all callers — getPersonFlaggedFaces, resolveFaces)
// honor persisted face-level declines and person-level dismissals.

let declineDatabase: Kysely<DB>;

const setupDecline = (db?: Kysely<DB>) => {
  return newMediumService(FaceRepairService, {
    database: db ?? declineDatabase,
    real: [
      FaceRepairRepository,
      FaceRepairScanRepository,
      SearchRepository,
      PersonRepository,
      FaceRepairDeclineRepository,
      FacePersonVerdictRepository,
      FaceIdentityRepository,
    ],
    mock: [LoggingRepository, JobRepository],
  });
};

describe('FaceRepairService decline filter', () => {
  beforeAll(async () => {
    declineDatabase = await getKyselyDB();
  });

  it('a declined face is not flagged on the next scan', async () => {
    const { sut, ctx } = setupDecline();
    const jobMock = ctx.getMock(JobRepository);
    jobMock.isActive.mockResolvedValue(false);
    const verdictRepo = ctx.get(FacePersonVerdictRepository);
    const { user } = await ctx.newUser();

    // Karina-main: 10 first-axis faces — the suspected owner
    await buildCluster(ctx, user.id, axisEmbedding('first'), 10);

    // Alexia: 3 leaked first-axis + 8 genuine second-axis
    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      leakedFaceIds.push(assetFace.id);
    }
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
        .execute();
    }

    // Decline face[0] toward its suspected owner (Karina)
    const plan0 = await sut.buildRepairPlan({ ownerId: user.id, ...planParams });
    const declinedFace = plan0.toRepair.find(
      (f) => f.currentPersonId === alexia.personGroupId && leakedFaceIds.includes(f.assetFaceId),
    )!;
    expect(declinedFace).toBeDefined();
    await verdictRepo.markRejected(declinedFace.suspectedOwnerId, declinedFace.assetFaceId, {
      source: 'cleanup',
      actorId: null,
    });

    // Re-plan: declined face must not appear in toRepair or reviewOnlyFaces
    const plan1 = await sut.buildRepairPlan({ ownerId: user.id, ...planParams });
    const allFlagged1 = [...plan1.toRepair, ...plan1.reviewOnlyFaces];
    expect(allFlagged1.find((f) => f.assetFaceId === declinedFace.assetFaceId)).toBeUndefined();
    // The other leaked faces still appear (not declined)
    const remaining = leakedFaceIds.filter((id) => id !== declinedFace.assetFaceId);
    for (const faceId of remaining) {
      expect(allFlagged1.find((f) => f.assetFaceId === faceId)).toBeDefined();
    }
  });

  it('resolveFaces does not move a declined face', async () => {
    const { sut, ctx } = setupDecline();
    const jobMock = ctx.getMock(JobRepository);
    jobMock.isActive.mockResolvedValue(false);
    jobMock.queue.mockResolvedValue();
    const verdictRepo = ctx.get(FacePersonVerdictRepository);
    const { user } = await ctx.newUser();

    // Karina-main: 10 first-axis faces
    const { person: karina } = await buildCluster(ctx, user.id, axisEmbedding('first'), 10);

    // Alexia: 3 leaked + 8 genuine (same as above)
    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      leakedFaceIds.push(assetFace.id);
    }
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
        .execute();
    }

    // Run a scan first so the flagged snapshot is persisted (resolveFaces reads that snapshot, not a live
    // recompute), using the same params as planParams so it flags exactly the leaked faces.
    const { scanId } = await sut.triggerScan(user.id, planParams);
    await sut.handleFaceRepairScan({ scanId });

    // Find the suspected owner for all leaked faces, then decline all of them POST-scan
    const plan0 = await sut.buildRepairPlan({ ownerId: user.id, ...planParams });
    const leakedToRepair = plan0.toRepair.filter(
      (f) => f.currentPersonId === alexia.personGroupId && leakedFaceIds.includes(f.assetFaceId),
    );
    expect(leakedToRepair.length).toBeGreaterThan(0);
    for (const face of leakedToRepair) {
      await verdictRepo.markRejected(face.suspectedOwnerId, face.assetFaceId, { source: 'cleanup', actorId: null });
    }

    // resolveFaces, requesting the exact leaked-face -> karina moves the client would have built from the
    // pre-decline flagged snapshot — the post-scan declines must be filtered from the snapshot, moving 0.
    const result = await sut.resolveFaces(
      {
        personId: alexia.personGroupId,
        moveToPerson: [
          { destinationPersonId: karina.personGroupId, faceIds: leakedToRepair.map((f) => f.assetFaceId), lock: false },
        ],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );
    expect(result.moved).toBe(0);
    expect(result.skipped).toBe(leakedToRepair.length);

    // Faces still assigned to Alexia
    const rows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personGroupId'])
      .where('id', 'in', leakedFaceIds)
      .execute();
    for (const row of rows) {
      expect(row.personGroupId).toBe(alexia.personGroupId);
    }

    // karina is not used by this test path but ensure she wasn't somehow affected
    const karinaFaces = await ctx.database
      .selectFrom('asset_face')
      .select('personGroupId')
      .where('personGroupId', '=', karina.personGroupId)
      .execute();
    expect(karinaFaces.length).toBe(10);
  });

  it('dismissed person is absent from getPersonFlaggedFaces when its suspected set matches the fingerprint', async () => {
    const { sut, ctx } = setupDecline();
    const declineRepo = ctx.get(FaceRepairDeclineRepository);
    const { user } = await ctx.newUser();

    // Karina-main: 10 first-axis faces
    const { person: karina } = await buildCluster(ctx, user.id, axisEmbedding('first'), 10);

    // Alexia: 3 leaked first-axis + 8 genuine second-axis
    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      leakedFaceIds.push(assetFace.id);
    }
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
        .execute();
    }

    // Dismiss Alexia with Karina as the fingerprint
    await declineRepo.createClusterMutes({
      persons: [{ personId: alexia.personGroupId, suspectedOwnerIds: [karina.personGroupId] }],
      declinedBy: null,
    });

    // getPersonFlaggedFaces must return empty for alexia (dismissed, same set of suspected owners)
    const { flaggedFaces } = await sut.getPersonFlaggedFaces(alexia.personGroupId);
    expect(flaggedFaces.length).toBe(0);
  });

  // M11 (temporal-consistency hardening design, Slice 4, E12): buildRepairPlan's own decline/lock read must be
  // bounded to the faces/persons it just flagged, not an unscoped whole-table load — and doing so must not
  // change which faces end up flagged, over a fixture with declines/locks both INSIDE and OUTSIDE the flagged
  // set. Before Slice 4 Step 2, buildRepairPlan calls getDeclineMaps() with no scope; the call-args assertion
  // below fails until that call site is scoped from `flaggedByPerson`.
  it(
    'M11: buildRepairPlan flags exactly the same faces via a scoped getDeclineMaps read as it does unscoped, ' +
      'and reads that scope from the flagged set only',
    async () => {
      const { sut, ctx } = setupDecline();
      const jobMock = ctx.getMock(JobRepository);
      jobMock.isActive.mockResolvedValue(false);
      const declineRepo = ctx.get(FaceRepairDeclineRepository);
      const verdictRepo = ctx.get(FacePersonVerdictRepository);
      const { user } = await ctx.newUser();

      // Karina-main: 10 first-axis faces (the reference/suspected-owner cluster — never itself flagged).
      const { person: karina, faceIds: karinaFaceIds } = await buildCluster(ctx, user.id, axisEmbedding('first'), 10);

      // Alexia: 3 leaked first-axis faces (flagged toward karina) + 8 genuine second-axis (never flagged).
      const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
      const leakedFaceIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
        await ctx.database
          .insertInto('face_search')
          .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
          .execute();
        leakedFaceIds.push(assetFace.id);
      }
      for (let i = 0; i < 8; i++) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alexia.personGroupId });
        await ctx.database
          .insertInto('face_search')
          .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
          .execute();
      }

      const baseline = await sut.buildRepairPlan({ ownerId: user.id, ...planParams });
      const leaked = baseline.toRepair.filter(
        (f) => f.currentPersonId === alexia.personGroupId && leakedFaceIds.includes(f.assetFaceId),
      );
      expect(leaked).toHaveLength(3);
      const [declinedFace, lockedFace, untouchedFace] = leaked;

      // INSIDE the flagged set: decline one leaked face toward its suspected owner, lock another.
      await verdictRepo.markRejected(declinedFace.suspectedOwnerId, declinedFace.assetFaceId, {
        source: 'cleanup',
        actorId: null,
      });
      const alexiaIdentity = await ctx.get(FaceIdentityRepository).ensurePersonIdentity(alexia.personGroupId);
      await ctx
        .get(FaceIdentityRepository)
        .replaceFaceIdentity({ assetFaceId: lockedFace.assetFaceId, identityId: alexiaIdentity.id, source: 'manual' });

      // OUTSIDE the flagged set entirely: a lock on one of karina's OWN faces (never a candidate — her faces
      // always vote for herself) and a person-level dismiss for a brand-new person with no faces at all.
      const karinaIdentity = await ctx.get(FaceIdentityRepository).ensurePersonIdentity(karina.personGroupId);
      await ctx
        .get(FaceIdentityRepository)
        .replaceFaceIdentity({ assetFaceId: karinaFaceIds[0], identityId: karinaIdentity.id, source: 'manual' });
      const { person: unrelated } = await ctx.newPerson({ ownerId: user.id });
      await declineRepo.createClusterMutes({
        persons: [{ personId: unrelated.personGroupId, suspectedOwnerIds: [karina.personGroupId] }],
        declinedBy: null,
      });

      const spy = vi.spyOn(ctx.get(FaceIdentityRepository), 'getManualLinkedFaceIds');

      const plan = await sut.buildRepairPlan({ ownerId: user.id, ...planParams });
      const flaggedIds = new Set([...plan.toRepair, ...plan.reviewOnlyFaces].map((f) => f.assetFaceId));

      // Functional equivalence with the unscoped baseline, minus exactly the two faces the inside-scope
      // decline/lock drop — the outside-scope rows (karina's own lock, the unrelated person's dismiss) never
      // touch anything in the flagged set either way, scoped or not.
      expect(flaggedIds.has(untouchedFace.assetFaceId)).toBe(true);
      expect(flaggedIds.has(declinedFace.assetFaceId)).toBe(false);
      expect(flaggedIds.has(lockedFace.assetFaceId)).toBe(false);

      // The scoped-load contract itself: buildRepairPlan's verdict reads must be bounded to exactly the
      // faces it just flagged — never an unscoped scan of an ever-growing table.
      expect(spy).toHaveBeenCalledTimes(1);
      const [scopedFaceIds] = spy.mock.calls[0]!;
      expect(new Set(scopedFaceIds)).toEqual(new Set(leakedFaceIds));
    },
  );
});
