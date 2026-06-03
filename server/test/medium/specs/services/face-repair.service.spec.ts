import { Kysely } from 'kysely';
import { JobName } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
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
import { Mocked } from 'vitest';

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
    real: [FaceRepairRepository, SearchRepository, PersonRepository],
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
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
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
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      leakedFaceIds.push(assetFace.id);
    }

    const candidates: ReattributionCandidate[] = [];
    for await (const c of sut.findReattributionCandidates({ ownerId: user.id, maxDistance: 0.6, voteWindow: 50 })) {
      candidates.push(c);
    }

    // Each leaked face (on Alexia) should report Karina as topOtherPersonId
    for (const leakedId of leakedFaceIds) {
      const candidate = candidates.find((c) => c.assetFaceId === leakedId);
      expect(candidate).toBeDefined();
      expect(candidate!.currentPersonId).toBe(alexia.id);
      expect(candidate!.topOtherPersonId).toBe(karina.id);
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
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: isolated.id });
    await ctx.database
      .insertInto('face_search')
      .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
      .execute();

    const candidates: ReattributionCandidate[] = [];
    for await (const c of sut.findReattributionCandidates({ ownerId: user.id, maxDistance: 0.6, voteWindow: 50 })) {
      candidates.push(c);
    }

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
    const { assetFace: faceA } = await ctx.newAssetFace({ assetId: assetA.id, personId: personA.id });
    await ctx.database
      .insertInto('face_search')
      .values({ faceId: faceA.id, embedding: axisEmbedding('first') })
      .execute();

    // Owner B has many faces on 'first' axis (identical embedding — maximally close)
    await buildCluster(ctx, ownerB.id, axisEmbedding('first'), 10);

    const candidates: ReattributionCandidate[] = [];
    for await (const c of sut.findReattributionCandidates({ ownerId: ownerA.id, maxDistance: 0.6, voteWindow: 50 })) {
      candidates.push(c);
    }

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
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      alexiaLeakedFaceIds.push(assetFace.id);
    }
    for (let i = 0; i < 8; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
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
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: dup.id });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      dupFlaggedFaceIds.push(assetFace.id);
    }
    // 4 genuine faces on mixedAxis slot 0 (isolated, no other person on this axis)
    for (let i = 0; i < 4; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: dup.id });
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
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: sibling.id });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      siblingFlaggedFaceIds.push(assetFace.id);
    }
    for (let i = 0; i < 5; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: sibling.id });
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
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: victimA.id });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: mixedAxisEmbedding(0) })
        .execute();
      victimAFlaggedFaceIds.push(assetFace.id);
    }
    for (let i = 0; i < 4; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: victimA.id });
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
    const pp = (id: string) => plan.perPerson.find((p) => p.personId === id)!;

    // Alexia: 3 flagged / 11 eligible ≈ 0.27
    expect(pp(alexia.id).eligible).toBe(11);
    expect(pp(alexia.id).flagged).toBe(3);
    expect(pp(alexia.id).flaggedFraction).toBeCloseTo(3 / 11);

    // dup: 6 flagged / 10 eligible = 0.6 (over-cap)
    expect(pp(dup.id).eligible).toBe(10);
    expect(pp(dup.id).flagged).toBe(6);
    expect(pp(dup.id).flaggedFraction).toBeCloseTo(0.6);

    // sibling: 5 flagged / 10 eligible = 0.5 (boundary, NOT over-cap)
    expect(pp(sibling.id).eligible).toBe(10);
    expect(pp(sibling.id).flagged).toBe(5);
    expect(pp(sibling.id).flaggedFraction).toBeCloseTo(0.5);

    // victimA: 3 flagged / 7 eligible ≈ 0.43 (under-cap)
    expect(pp(victimA.id).eligible).toBe(7);
    expect(pp(victimA.id).flagged).toBe(3);
    expect(pp(victimA.id).flaggedFraction).toBeCloseTo(3 / 7);

    // solo: 0 flagged / 4 eligible
    expect(pp(solo.id).eligible).toBe(4);
    expect(pp(solo.id).flagged).toBe(0);

    // ── reviewOnlyPersonIds ────────────────────────────────────────────────────
    expect(plan.reviewOnlyPersonIds).toContain(dup.id);
    expect(plan.reviewOnlyPersonIds).not.toContain(alexia.id);
    expect(plan.reviewOnlyPersonIds).not.toContain(sibling.id);
    expect(plan.reviewOnlyPersonIds).not.toContain(victimA.id);
    expect(plan.reviewOnlyPersonIds).not.toContain(karina.id);

    // ── toRepair ───────────────────────────────────────────────────────────────
    // Alexia's 3 leaked faces → toRepair (suspectedOwner = karina)
    for (const faceId of alexiaLeakedFaceIds) {
      const repaired = plan.toRepair.find((f) => f.assetFaceId === faceId);
      expect(repaired).toBeDefined();
      expect(repaired!.suspectedOwnerId).toBe(karina.id);
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
    const { assetFace: suspectFace } = await ctx.newAssetFace({ assetId: suspectAsset.id, personId: suspect.id });
    await ctx.database
      .insertInto('face_search')
      .values({ faceId: suspectFace.id, embedding: axisEmbedding('first') })
      .execute();

    // isolated: 1 face on a completely separate axis — no neighbors within maxDistance=0.6 → NOT unAttributable
    const { person: isolated } = await ctx.newPerson({ ownerId: user.id });
    const { asset: isolatedAsset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: isolatedFace } = await ctx.newAssetFace({ assetId: isolatedAsset.id, personId: isolated.id });
    await ctx.database
      .insertInto('face_search')
      .values({ faceId: isolatedFace.id, embedding: axisEmbedding('second') })
      .execute();

    const plan: RepairPlan = await sut.buildRepairPlan({ ownerId: user.id, ...planParams });

    // suspect face: in unAttributableFaces, NOT in toRepair
    const unAttr = plan.unAttributableFaces.find((f) => f.assetFaceId === suspectFace.id);
    expect(unAttr).toBeDefined();
    expect(unAttr!.currentPersonId).toBe(suspect.id);
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
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
        .execute();
      leakedFaceIds.push(assetFace.id);
    }
    for (let i = 0; i < 4; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
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
      expect(repaired!.suspectedOwnerId).toBe(karina.id);
    }
  });
});

// Setup for executeRepair tests — includes real FaceIdentityRepository and mock JobRepository.
// Uses a dedicated isolated DB so getBackfillWork() is not polluted by other test suites.
let repairDatabase: Kysely<DB>;

const setupRepair = (db?: Kysely<DB>) => {
  return newMediumService(FaceRepairService, {
    database: db ?? repairDatabase,
    real: [FaceRepairRepository, SearchRepository, PersonRepository, FaceIdentityRepository],
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
  const identity = await faceIdentityRepo.ensurePersonIdentity(person.id);
  const faceIds: string[] = [];
  for (let index = 0; index < faceCount; index++) {
    const { asset } = await ctx.newAsset({ ownerId });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
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

  it('unassigns leaked faces, clears their identity links, and queues FacialRecognition for them', async () => {
    const { sut, ctx } = setupRepair();
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
    const { user } = await ctx.newUser();

    // Karina-main: 10 first-axis faces
    const { faceIds: karinaFaceIds } = await buildLinkedCluster(ctx, user.id, axisEmbedding('first'), 10);

    // Alexia: 8 genuine second-axis + 3 leaked first-axis faces
    const faceIdentityRepoReal = ctx.get(FaceIdentityRepository);
    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const alexiaIdentity = await faceIdentityRepoReal.ensurePersonIdentity(alexia.id);
    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
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
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
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

    // Leaked faces are now unassigned
    const leakedRows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personId'])
      .where('id', 'in', leakedFaceIds)
      .execute();
    for (const row of leakedRows) {
      expect(row.personId).toBeNull();
    }

    // face_identity_face rows for leaked faces are deleted
    const leakedLinks = await ctx.database
      .selectFrom('face_identity_face')
      .select('assetFaceId')
      .where('assetFaceId', 'in', leakedFaceIds)
      .execute();
    expect(leakedLinks).toHaveLength(0);

    // Genuine Alexia faces are untouched
    const alexiaRows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personId'])
      .where('id', 'in', alexiaGenuineFaceIds)
      .execute();
    for (const row of alexiaRows) {
      expect(row.personId).toBe(alexia.id);
    }

    // Karina faces are untouched
    const karinaRows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personId'])
      .where('id', 'in', karinaFaceIds)
      .execute();
    for (const row of karinaRows) {
      expect(row.personId).not.toBeNull();
    }

    // No-loop invariant: getBackfillWork().hasPersonalIdentityWork is false after repair
    const afterWork = await faceIdentityRepo.getBackfillWork();
    expect(afterWork.hasPersonalIdentityWork).toBe(false);

    // JobRepository.queueAll was called with FacialRecognition jobs for exactly the unassigned ids
    expect(jobMock.queueAll).toHaveBeenCalledTimes(1);
    const queueAllArg = jobMock.queueAll.mock.calls[0][0] as Array<{
      name: JobName;
      data: { id: string; deferred: boolean };
    }>;
    const queuedIds = queueAllArg.map((j) => j.data.id).toSorted();
    expect(queuedIds).toEqual(leakedFaceIds.toSorted());
    for (const job of queueAllArg) {
      expect(job.name).toBe(JobName.FacialRecognition);
      expect(job.data.deferred).toBe(false);
    }
  });

  it('review-only: does not touch faces of an over-cap person', async () => {
    const { sut, ctx } = setupRepair();
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const { user } = await ctx.newUser();

    // Karina-main: 10 first-axis faces
    await buildLinkedCluster(ctx, user.id, axisEmbedding('first'), 10);

    // Over-cap person: 6 leaked first-axis + 4 genuine mixed — flaggedFraction=0.6 > 0.5 → reviewOnly
    const { person: overCap } = await ctx.newPerson({ ownerId: user.id });
    const overCapIdentity = await faceIdentityRepo.ensurePersonIdentity(overCap.id);
    const overCapFaceIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: overCap.id });
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
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: overCap.id });
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
    expect(plan.reviewOnlyPersonIds).toContain(overCap.id);
    expect(plan.toRepair.some((f) => overCapFaceIds.includes(f.assetFaceId))).toBe(false);

    await sut.executeRepair(plan);

    // All over-cap faces keep their personId
    const rows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personId'])
      .where('id', 'in', overCapFaceIds)
      .execute();
    for (const row of rows) {
      expect(row.personId).toBe(overCap.id);
    }
  });

  it('rep-face reconcile: faceAssetId is updated when the rep was among the unassigned faces', async () => {
    const { sut, ctx } = setupRepair();
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
    jobMock.queueAll.mockResolvedValue();
    const { user } = await ctx.newUser();

    // Karina-main: 10 first-axis faces
    await buildLinkedCluster(ctx, user.id, axisEmbedding('first'), 10);

    // Alexia: 8 genuine + 3 leaked; set faceAssetId to first leaked face
    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const alexiaIdentity = await faceIdentityRepo.ensurePersonIdentity(alexia.id);
    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
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
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
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
      .where('id', '=', alexia.id)
      .execute();

    const plan = await sut.buildRepairPlan({ ownerId: user.id, ...execPlanParams });
    await sut.executeRepair(plan);

    const updated = await ctx.database
      .selectFrom('person')
      .select('faceAssetId')
      .where('id', '=', alexia.id)
      .executeTakeFirstOrThrow();
    // faceAssetId must not be any of the leaked (now-unassigned) faces
    expect(leakedFaceIds).not.toContain(updated.faceAssetId);
    expect(updated.faceAssetId).not.toBeNull();
  });

  it('eligibility re-check: face moved to third person before executeRepair is skipped and not queued', async () => {
    const { sut, ctx } = setupRepair();
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
    const { user } = await ctx.newUser();

    // Karina-main: 10 first-axis faces
    await buildLinkedCluster(ctx, user.id, axisEmbedding('first'), 10);

    // Alexia: 8 genuine + 3 leaked — only 2 will remain in plan after one is moved
    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const alexiaIdentity = await faceIdentityRepo.ensurePersonIdentity(alexia.id);
    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
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
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
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
    await faceIdentityRepo.ensurePersonIdentity(personZ.id);

    jobMock.queueAll.mockResolvedValue();

    const plan = await sut.buildRepairPlan({ ownerId: user.id, ...execPlanParams });

    // After building plan but before executing it, move one leaked face to person Z
    const movedFaceId = leakedFaceIds[0];
    await ctx.database.updateTable('asset_face').set({ personId: personZ.id }).where('id', '=', movedFaceId).execute();

    await sut.executeRepair(plan);

    // The moved face is still on person Z (not unassigned)
    const movedRow = await ctx.database
      .selectFrom('asset_face')
      .select('personId')
      .where('id', '=', movedFaceId)
      .executeTakeFirstOrThrow();
    expect(movedRow.personId).toBe(personZ.id);

    // queueAll was not called with the moved face id
    const queueAllArg = jobMock.queueAll.mock.calls[0]?.[0] as
      | Array<{ name: JobName; data: { id: string } }>
      | undefined;
    const queuedIds = queueAllArg?.map((j) => j.data.id) ?? [];
    expect(queuedIds).not.toContain(movedFaceId);
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
    const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
    jobMock.isActive.mockResolvedValue(false);
    const { user } = await ctx.newUser();

    // Karina-main: 10 first-axis faces
    await buildLinkedCluster(ctx as any, user.id, axisEmbedding('first'), 10);

    // Alexia: 8 genuine + 3 leaked first-axis
    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const alexiaIdentity = await faceIdentityRepo.ensurePersonIdentity(alexia.id);
    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
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
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
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
      .select(['id', 'personId'])
      .where('id', 'in', leakedFaceIds)
      .execute();
    for (const row of rows) {
      expect(row.personId).toBe(alexia.id);
    }

    // queueAll must not have been called
    expect(jobMock.queueAll).not.toHaveBeenCalled();
  });

  it('execute: dryRun=false with isActive=false → mutated=true, leaked faces nulled, queueAll called', async () => {
    const { sut, ctx } = setupRunRepair();
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
    jobMock.isActive.mockResolvedValue(false);
    jobMock.queueAll.mockResolvedValue();
    const { user } = await ctx.newUser();

    await buildLinkedCluster(ctx as any, user.id, axisEmbedding('first'), 10);

    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const alexiaIdentity = await faceIdentityRepo.ensurePersonIdentity(alexia.id);
    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
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
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
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
      .select(['id', 'personId'])
      .where('id', 'in', leakedFaceIds)
      .execute();
    for (const row of rows) {
      expect(row.personId).toBeNull();
    }

    expect(jobMock.queueAll).toHaveBeenCalledTimes(1);
  });

  it('concurrency guard: isActive=true + dryRun=false → throws, nothing mutated; dryRun=true with isActive=true → succeeds', async () => {
    const { sut, ctx } = setupRunRepair();
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
    jobMock.isActive.mockResolvedValue(true);
    const { user } = await ctx.newUser();

    await buildLinkedCluster(ctx as any, user.id, axisEmbedding('first'), 10);

    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const alexiaIdentity = await faceIdentityRepo.ensurePersonIdentity(alexia.id);
    const leakedFaceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
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
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
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
      .select(['id', 'personId'])
      .where('id', 'in', leakedFaceIds)
      .execute();
    for (const row of rows) {
      expect(row.personId).toBe(alexia.id);
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
    const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
    jobMock.isActive.mockResolvedValue(false);
    jobMock.queueAll.mockResolvedValue();

    const { user: ownerA } = await ctx.newUser();
    const { user: ownerB } = await ctx.newUser();

    // Owner A: karina-main + alexia with leaked faces
    await buildLinkedCluster(ctx as any, ownerA.id, axisEmbedding('first'), 10);
    const { person: alexiaA } = await ctx.newPerson({ ownerId: ownerA.id });
    const alexiaAIdentity = await faceIdentityRepoA.ensurePersonIdentity(alexiaA.id);
    const leakedA: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: ownerA.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexiaA.id });
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
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexiaA.id });
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
    const alexiaBIdentity = await faceIdentityRepoA.ensurePersonIdentity(alexiaB.id);
    const leakedB: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: ownerB.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexiaB.id });
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
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexiaB.id });
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

    // OwnerA leaked faces are unassigned
    const rowsA = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personId'])
      .where('id', 'in', leakedA)
      .execute();
    for (const row of rowsA) {
      expect(row.personId).toBeNull();
    }

    // OwnerB leaked faces remain assigned
    const rowsB = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personId'])
      .where('id', 'in', leakedB)
      .execute();
    for (const row of rowsB) {
      expect(row.personId).toBe(alexiaB.id);
    }
  });

  it('idempotency: after real runRepair, second dry-run reports flaggedFaces=0', async () => {
    const { sut, ctx } = setupRunRepair();
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
    jobMock.isActive.mockResolvedValue(false);
    jobMock.queueAll.mockResolvedValue();
    const { user } = await ctx.newUser();

    await buildLinkedCluster(ctx as any, user.id, axisEmbedding('first'), 10);

    const { person: alexia } = await ctx.newPerson({ ownerId: user.id });
    const alexiaIdentity = await faceIdentityRepo.ensurePersonIdentity(alexia.id);
    for (let i = 0; i < 3; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
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
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexia.id });
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

    // Second run: dry-run should report 0 flagged (unassigned faces are no longer eligible)
    const result = await sut.runRepair({ ownerId: user.id, ...runRepairPlanDefaults });
    expect(result.report.totals.flaggedFaces).toBe(0);
  });

  it('empty owner: runRepair on a fresh user with no faces resolves with flaggedFaces=0, mutated=false, no throw', async () => {
    const { sut, ctx } = setupRunRepair();
    const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
    jobMock.isActive.mockResolvedValue(false);
    const { user: emptyUser } = await ctx.newUser();

    const result = await sut.runRepair({ ownerId: emptyUser.id, ...runRepairPlanDefaults });

    expect(result.report.totals.flaggedFaces).toBe(0);
    expect(result.mutated).toBe(false);
  });
});
