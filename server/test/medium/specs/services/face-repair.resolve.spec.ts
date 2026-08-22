import { BadRequestException, ConflictException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { JobName, SourceType } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository';
import { FaceRepairDeclineRepository } from 'src/repositories/face-repair-decline.repository';
import {
  FaceRepairScanRepository,
  RepairScanParams,
  RepairScanPerson,
  RepairScanTotals,
} from 'src/repositories/face-repair-scan.repository';
import { FaceRepairRepository } from 'src/repositories/face-repair.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { FaceRepairResolveErrorCode, FaceRepairService } from 'src/services/face-repair.service';
import { applyVerdictFilters } from 'src/utils/face-repair';
import { mediumFactory, newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { vi } from 'vitest';

const EMBEDDING = '[' + Array.from({ length: 512 }, () => 1).join(',') + ']';

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
  return { sut, ctx, jobMock, scanRepo: ctx.get(FaceRepairScanRepository) };
};

type Ctx = ReturnType<typeof setup>['ctx'];

const seedFace = async (ctx: Ctx, ownerId: string, personId: string): Promise<string> => {
  const { asset } = await ctx.newAsset({ ownerId });
  const { assetFace } = await ctx.newAssetFace({
    assetId: asset.id,
    personGroupId: personId,
    sourceType: SourceType.MachineLearning,
  });
  await db.insertInto('face_search').values({ faceId: assetFace.id, embedding: EMBEDDING }).execute();
  return assetFace.id;
};

const scanParams = (): RepairScanParams => ({
  maxDistance: 0.5,
  minFaces: 3,
  voteWindow: 200,
  voteMargin: 2,
  maxAttributionDistance: 0.35,
  maxFlaggedFraction: 0.5,
  largeClusterThreshold: 50,
});

const scanTotals = (affectedPersons: number, flaggedFaces: number): RepairScanTotals => ({
  eligibleFaces: flaggedFaces,
  flaggedFaces,
  toRepair: flaggedFaces,
  reviewOnlyFaces: 0,
  reviewOnlyPersons: 0,
  affectedPersons,
  reviewOnlyByReason: { overCap: 0, badTarget: 0, unAttributable: 0 },
});

const scanPerson = (personId: string, ownerId: string, flagged: number): RepairScanPerson => ({
  personId,
  ownerId,
  personName: null,
  faceCount: flagged,
  thumbnailFaceId: null,
  eligible: flagged,
  flagged,
  flaggedFraction: 1,
  suspectedOwners: [],
  recommendation: 'confident',
  reviewReasons: [],
});

// Seed a completed scan whose stored flagged-face snapshot points `faces` at their given suspected owners,
// bypassing the real ANN scan (which is exercised separately in face-repair.scan.spec.ts). resolveFaces reads
// this snapshot via getScanFlaggedFacesForPersons (the same read the now-retired applyRepair used to make).
const seedFlaggedSnapshot = async (
  scanRepo: FaceRepairScanRepository,
  userId: string,
  personId: string,
  faces: { assetFaceId: string; suspectedOwnerId: string }[],
) => {
  const scan = await scanRepo.createScan({ requestedBy: userId, params: scanParams() });
  await scanRepo.replaceScanFlaggedFaces(
    scan.id,
    faces.map((f) => ({ assetFaceId: f.assetFaceId, personId, suspectedOwnerId: f.suspectedOwnerId })),
  );
  await scanRepo.completeScan(scan.id, {
    totals: scanTotals(1, faces.length),
    persons: [scanPerson(personId, userId, faces.length)],
  });
  return scan;
};

const personIdsOf = async (faceIds: string[]): Promise<Record<string, string | null>> => {
  const rows = await db.selectFrom('asset_face').select(['id', 'personId']).where('id', 'in', faceIds).execute();
  return Object.fromEntries(rows.map((r) => [r.id, r.personId]));
};

// Bulk equivalent of seedFace, for tests that need enough faces to span more than one of
// markRejectedMany's/replaceFaceIdentities' internal 1000-row chunks (S7.2). Built with plain bulk
// inserts (not one newAsset/newAssetFace round trip per face) so seeding thousands of faces stays fast.
const seedFacesBulk = async (ctx: Ctx, ownerId: string, personId: string, count: number): Promise<string[]> => {
  const assets = Array.from({ length: count }, () => mediumFactory.assetInsert({ ownerId }));
  for (let index = 0; index < assets.length; index += 1000) {
    await db
      .insertInto('asset')
      .values(assets.slice(index, index + 1000))
      .execute();
  }
  const faces = assets.map((asset) =>
    mediumFactory.assetFaceInsert({ assetId: asset.id, personId, sourceType: SourceType.MachineLearning }),
  );
  for (let index = 0; index < faces.length; index += 1000) {
    await db
      .insertInto('asset_face')
      .values(faces.slice(index, index + 1000))
      .execute();
  }
  const searchRows = faces.map((face) => ({ faceId: face.id, embedding: EMBEDDING }));
  for (let index = 0; index < searchRows.length; index += 1000) {
    await db
      .insertInto('face_search')
      .values(searchRows.slice(index, index + 1000))
      .execute();
  }
  return faces.map((face) => face.id);
};

beforeAll(async () => {
  db = await getKyselyDB();
});

afterEach(() => db.deleteFrom('face_repair_scan').execute());

// ── M1 / M3: per-face owner move, multi-owner mixed cluster ────────────────────────────────────────

describe('FaceRepairService.resolveFaces: move-to-owner (M1, M3, E14)', () => {
  it('moves each flagged face to its OWN suspected owner (mixed cluster) and drains the person from the scan', async () => {
    const { sut, ctx, jobMock, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: ownerB } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });

    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    const f2 = await seedFace(ctx, user.id, source.personGroupId);
    const f3 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [
      { assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId },
      { assetFaceId: f2, suspectedOwnerId: ownerA.personGroupId },
      { assetFaceId: f3, suspectedOwnerId: ownerB.personGroupId },
    ]);

    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [
          { destinationPersonId: ownerA.personGroupId, faceIds: [f1, f2], lock: false },
          { destinationPersonId: ownerB.personGroupId, faceIds: [f3], lock: false },
        ],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    expect(result).toEqual({ moved: 3, declined: 0, locked: 0, detached: 0, unknown: 0, skipped: 0 });

    const byId = await personIdsOf([f1, f2, f3]);
    expect(byId[f1]).toBe(ownerA.personGroupId);
    expect(byId[f2]).toBe(ownerA.personGroupId);
    expect(byId[f3]).toBe(ownerB.personGroupId);

    // Identities are relinked to the destination (reuses executeRepair's transaction). B2: every group here
    // sent lock:false, so the link is an ordinary placement, NOT the durable `manual` lock — the face stays
    // reviewable by a future scan.
    const idRows = await db
      .selectFrom('face_identity_face')
      .select(['assetFaceId', 'source'])
      .where('assetFaceId', 'in', [f1, f2, f3])
      .execute();
    expect(idRows).toHaveLength(3);
    for (const row of idRows) {
      expect(row.source).toBe('owner-person');
    }

    // The source person drains from the latest scan snapshot (drop-on-any-resolution).
    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).not.toContain(source.personGroupId);

    // Never re-queues facial recognition.
    const queuedJobNames = jobMock.queueAll.mock.calls.flatMap(([items]) => items).map((item) => item.name);
    expect(queuedJobNames).not.toContain('FacialRecognition');
  });

  it('deletes the drained UNNAMED source person once every eligible face has moved (E6)', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: owner } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: owner.personGroupId }]);

    await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: owner.personGroupId, faceIds: [f1], lock: false }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    const sourceRow = await db.selectFrom('person').select('id').where('personGroupId', '=', source.personGroupId).executeTakeFirst();
    expect(sourceRow).toBeUndefined();
  });

  it('keeps a drained NAMED source person after all its eligible faces move (M8)', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: owner } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Jane Doe' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: owner.personGroupId }]);

    await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: owner.personGroupId, faceIds: [f1], lock: false }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    // A NAMED source is kept even though it's fully drained of eligible faces (unlike the unnamed case above).
    const sourceRow = await db
      .selectFrom('person')
      .select(['personGroupId', 'name'])
      .where('personGroupId', '=', source.personGroupId)
      .executeTakeFirst();
    expect(sourceRow).toBeDefined();
    expect(sourceRow?.name).toBe('Jane Doe');

    // Still drained from the console/scan even though the person row itself survives.
    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).not.toContain(source.personGroupId);
  });
});

// ── Slice 6a2 (§5.3): moveToPerson carries rest-of-cluster faces, not just the flagged snapshot ────

describe('FaceRepairService.resolveFaces: moveToPerson carries rest-of-cluster faces (Slice 6a2, §5.3)', () => {
  it('moves a rest-of-cluster face (on personId, eligible, never flagged) alongside a flagged face in the same moveToPerson group', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: owner } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });

    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    // A rest-of-cluster face on the same person that was never part of the flagged snapshot — moveToPerson
    // must still carry it (per §5.3: "any eligible face on the person"), not just flagged faces.
    const f2 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: owner.personGroupId }]);

    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: owner.personGroupId, faceIds: [f1, f2], lock: false }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    expect(result).toEqual({ moved: 2, declined: 0, locked: 0, detached: 0, unknown: 0, skipped: 0 });

    const byId = await personIdsOf([f1, f2]);
    expect(byId[f1]).toBe(owner.personGroupId);
    expect(byId[f2]).toBe(owner.personGroupId);
  });
});

// A resolve that settles NONE of the flagged snapshot must not close the person out of the console. The web
// review page used to fire a second, independent resolve for its rest-of-cluster selection; the unconditional
// drop-on-any-resolution then dropped the person while every flagged face was still unresolved, so the admin's
// staged decisions were silently discarded and the same faces came back on the next scan (the reported bug).
describe('FaceRepairService.resolveFaces: a resolve that settles no flagged face does NOT drain the person', () => {
  it('moves only the rest-of-cluster face and leaves the person (and its untouched flagged faces) in the scan', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: owner } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });

    const flagged1 = await seedFace(ctx, user.id, source.personGroupId);
    const flagged2 = await seedFace(ctx, user.id, source.personGroupId);
    const rest = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [
      { assetFaceId: flagged1, suspectedOwnerId: owner.personGroupId },
      { assetFaceId: flagged2, suspectedOwnerId: owner.personGroupId },
    ]);

    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: owner.personGroupId, faceIds: [rest], lock: false }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    expect(result).toEqual({ moved: 1, declined: 0, locked: 0, detached: 0, unknown: 0, skipped: 0 });

    // The rest face moved; the two flagged faces are untouched, still awaiting a decision.
    const byId = await personIdsOf([flagged1, flagged2, rest]);
    expect(byId[rest]).toBe(owner.personGroupId);
    expect(byId[flagged1]).toBe(source.personGroupId);
    expect(byId[flagged2]).toBe(source.personGroupId);

    // ...so the person MUST still be in the console, with its flagged snapshot intact.
    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).toContain(source.personGroupId);

    const stillFlagged = await scanRepo.getScanFlaggedFacesForPersons(latest!.id, [source.personGroupId]);
    expect(stillFlagged.map((face) => face.assetFaceId).sort()).toEqual([flagged1, flagged2].sort());
  });

  it('drains the person once the flagged snapshot IS settled, even alongside a rest-of-cluster face in the same resolve', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: owner } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });

    const flagged = await seedFace(ctx, user.id, source.personGroupId);
    const rest = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: flagged, suspectedOwnerId: owner.personGroupId }]);

    // The unified Apply: every flagged face plus the admin's added rest-of-cluster faces, in ONE resolve.
    await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: owner.personGroupId, faceIds: [flagged, rest], lock: false }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).not.toContain(source.personGroupId);
  });
});

// Ported from the retired applyRepair manual-move spec (E5): a moveToPerson group need not carry every
// eligible face on the person — a partial move leaves the rest, and a source with remaining faces survives
// (unlike the fully-drained-unnamed-source deletion covered elsewhere).
describe('FaceRepairService.resolveFaces: partial move leaves the surviving source intact (E5)', () => {
  it('moves only the picked faces to the destination and leaves the rest; the surviving source is not deleted', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: dest } = await ctx.newPerson({ ownerId: user.id, name: 'Pierre' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const faceIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      faceIds.push(await seedFace(ctx, user.id, source.personGroupId));
    }
    const picked = [faceIds[0], faceIds[1]];
    const kept = faceIds.slice(2);

    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: dest.personGroupId, faceIds: picked, lock: false }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    expect(result.moved).toBe(2);

    const byId = await personIdsOf(faceIds);
    for (const faceId of picked) {
      expect(byId[faceId]).toBe(dest.personGroupId);
    }
    for (const faceId of kept) {
      expect(byId[faceId]).toBe(source.personGroupId);
    }

    // Source survives (faces remain) → not deleted.
    const sourceRow = await db.selectFrom('person').select('id').where('personGroupId', '=', source.personGroupId).executeTakeFirst();
    expect(sourceRow?.id).toBe(source.personGroupId);

    // Picked faces are relinked to the destination. B2: this request sent lock:false, so the link is an
    // ordinary placement rather than the durable `manual` lock.
    const idRows = await db
      .selectFrom('face_identity_face')
      .select(['source'])
      .where('assetFaceId', 'in', picked)
      .execute();
    expect(idRows).toHaveLength(2);
    for (const row of idRows) {
      // B2: this request sent lock:false, so the relink is an ordinary placement, not a durable lock.
      expect(row.source).toBe('owner-person');
    }
  });
});

// ── M2 / M12 / M20: move to a CHOSEN person (owner-scoped, Slice 4) ─────────────────────────────────

describe('FaceRepairService.resolveFaces: move to a chosen person (M2, state 2)', () => {
  it('applies TWO distinct chosen-person destinations in one resolve — the REQUEST destination wins over the stored suspected owner', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    // The scan's suggestion (stored suspectedOwnerId) — deliberately NOT either chosen destination below, so
    // this proves the request's destinationPersonId wins rather than the snapshot's suspectedOwnerId (the
    // Slice-1 review gap: M1/M3 only ever exercised destination === suspectedOwnerId).
    const { person: suggested } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: chosenA } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
    const { person: chosenB } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });

    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    const f2 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [
      { assetFaceId: f1, suspectedOwnerId: suggested.personGroupId },
      { assetFaceId: f2, suspectedOwnerId: suggested.personGroupId },
    ]);

    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [
          { destinationPersonId: chosenA.personGroupId, faceIds: [f1], lock: false },
          { destinationPersonId: chosenB.personGroupId, faceIds: [f2], lock: false },
        ],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    expect(result).toEqual({ moved: 2, declined: 0, locked: 0, detached: 0, unknown: 0, skipped: 0 });

    const byId = await personIdsOf([f1, f2]);
    expect(byId[f1]).toBe(chosenA.personGroupId);
    expect(byId[f2]).toBe(chosenB.personGroupId);
    expect(byId[f1]).not.toBe(suggested.personGroupId);
    expect(byId[f2]).not.toBe(suggested.personGroupId);
  });
});

describe('FaceRepairService.resolveFaces: cross-owner destination rejected (M12, E11)', () => {
  it('throws BadRequestException when destinationPersonId is owned by a DIFFERENT user, and commits nothing', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { user: otherUser } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: strangerPerson } = await ctx.newPerson({ ownerId: otherUser.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    await expect(
      sut.resolveFaces(
        {
          personId: source.personGroupId,
          moveToPerson: [{ destinationPersonId: strangerPerson.personGroupId, faceIds: [f1], lock: false }],
          stay: [],
          lock: [],
          detach: [],
          unknown: [],
        },
        user.id,
      ),
    ).rejects.toThrow(BadRequestException);

    // Nothing committed: face untouched, person still in the scan snapshot.
    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(source.personGroupId);
    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).toContain(source.personGroupId);
  });
});

describe('FaceRepairService.resolveFaces: destination person gone (M20, E18)', () => {
  it('throws BadRequestException when destinationPersonId no longer exists (deleted/merged since the scan), and commits nothing', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    // A destination that was deleted/merged since the scan ran — never existed under this id.
    const goneId = '11111111-1111-4111-8111-111111111111';

    await expect(
      sut.resolveFaces(
        {
          personId: source.personGroupId,
          moveToPerson: [{ destinationPersonId: goneId, faceIds: [f1], lock: false }],
          stay: [],
          lock: [],
          detach: [],
          unknown: [],
        },
        user.id,
      ),
    ).rejects.toThrow(BadRequestException);

    // Nothing committed — the resolve is rolled back whole.
    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(source.personGroupId);
    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).toContain(source.personGroupId);
  });
});

// ── M13: entireCluster (whole-cluster move) + exclusivity (E12) ────────────────────────────────────

describe('FaceRepairService.resolveFaces: entireCluster (M13, E12)', () => {
  it('moves EVERY eligible face of personId — including one never in the flagged snapshot — server-enumerated with no client paging, and drains the person', async () => {
    const { sut, ctx, scanRepo, jobMock } = setup();
    const { user } = await ctx.newUser();
    // The scan's suggestion — deliberately NOT the entireCluster destination below, proving the request's
    // destination wins rather than each face's stored suspectedOwnerId (mirrors the M2 review-gap coverage).
    const { person: suggested } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: dest } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });

    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    // A rest-of-cluster face that was never part of any flagged snapshot — entireCluster must still move it,
    // since it enumerates every ELIGIBLE face of personId, not just the flagged ones.
    const f2 = await seedFace(ctx, user.id, source.personGroupId);

    // Ported from the retired applyRepair manual-move spec (E13): make a soon-to-move face the source's
    // representative, so executeRepair's shared reconcile-representative-faces step must repoint/queue it.
    await db.updateTable('person').set({ faceAssetId: f1 }).where('personGroupId', '=', source.personGroupId).execute();

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: suggested.personGroupId }]);

    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
        entireCluster: { destinationPersonId: dest.personGroupId },
      },
      user.id,
    );

    expect(result).toEqual({ moved: 2, declined: 0, locked: 0, detached: 0, unknown: 0, skipped: 0 });

    const byId = await personIdsOf([f1, f2]);
    expect(byId[f1]).toBe(dest.personGroupId);
    expect(byId[f2]).toBe(dest.personGroupId);

    // Representative reconcile queued a thumbnail regen for the drained source (E13, ported from manual-move).
    const queuedNames = jobMock.queueAll.mock.calls.flatMap(([items]) => items).map((item) => item.name);
    expect(queuedNames).toContain(JobName.PersonGenerateThumbnail);

    // Drained from the console...
    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).not.toContain(source.personGroupId);

    // ...and the now-fully-drained UNNAMED source is auto-deleted (same cleanup the retired applyRepair's manual move used).
    const sourceRow = await db.selectFrom('person').select('id').where('personGroupId', '=', source.personGroupId).executeTakeFirst();
    expect(sourceRow).toBeUndefined();
  });

  it('rejects entireCluster combined with a non-empty moveToPerson bucket, and commits nothing', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: dest } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    await expect(
      sut.resolveFaces(
        {
          personId: source.personGroupId,
          moveToPerson: [{ destinationPersonId: ownerA.personGroupId, faceIds: [f1], lock: false }],
          stay: [],
          lock: [],
          detach: [],
          unknown: [],
          entireCluster: { destinationPersonId: dest.personGroupId },
        },
        user.id,
      ),
    ).rejects.toThrow(BadRequestException);

    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(source.personGroupId);
    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).toContain(source.personGroupId);
  });

  it('rejects entireCluster combined with a non-empty stay, lock, detach, or unknown bucket, and commits nothing', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: dest } = await ctx.newPerson({ ownerId: user.id, name: '' });

    for (const bucket of ['stay', 'lock', 'detach', 'unknown'] as const) {
      const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
      const f1 = await seedFace(ctx, user.id, source.personGroupId);
      await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

      await expect(
        sut.resolveFaces(
          {
            personId: source.personGroupId,
            moveToPerson: [],
            stay: bucket === 'stay' ? [f1] : [],
            lock: bucket === 'lock' ? [f1] : [],
            detach: bucket === 'detach' ? [f1] : [],
            unknown: bucket === 'unknown' ? [f1] : [],
            entireCluster: { destinationPersonId: dest.personGroupId },
          },
          user.id,
        ),
      ).rejects.toThrow(BadRequestException);

      const byId = await personIdsOf([f1]);
      expect(byId[f1]).toBe(source.personGroupId);
      const latest = await scanRepo.getLatestScan();
      const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
      expect(snapshotPersonIds).toContain(source.personGroupId);
    }
  });
});

describe('FaceRepairService.resolveFaces: entireCluster cross-owner destination rejected (M13, E11)', () => {
  it('throws BadRequestException when entireCluster.destinationPersonId is owned by a DIFFERENT user, and commits nothing', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { user: otherUser } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: strangerPerson } = await ctx.newPerson({ ownerId: otherUser.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    await expect(
      sut.resolveFaces(
        {
          personId: source.personGroupId,
          moveToPerson: [],
          stay: [],
          lock: [],
          detach: [],
          unknown: [],
          entireCluster: { destinationPersonId: strangerPerson.personGroupId },
        },
        user.id,
      ),
    ).rejects.toThrow(BadRequestException);

    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(source.personGroupId);
    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).toContain(source.personGroupId);
  });
});

describe('FaceRepairService.resolveFaces: entireCluster destination person gone (M13, E18)', () => {
  it('throws BadRequestException when entireCluster.destinationPersonId no longer exists, and commits nothing', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    // A destination that was deleted/merged since the scan ran — never existed under this id.
    const goneId = '22222222-2222-4222-8222-222222222222';

    await expect(
      sut.resolveFaces(
        {
          personId: source.personGroupId,
          moveToPerson: [],
          stay: [],
          lock: [],
          detach: [],
          unknown: [],
          entireCluster: { destinationPersonId: goneId },
        },
        user.id,
      ),
    ).rejects.toThrow(BadRequestException);

    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(source.personGroupId);
    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).toContain(source.personGroupId);
  });
});

// ── M17 / M18: owner-scoped people endpoints for the move-to-chosen-person picker ───────────────────

describe('FaceRepairService.searchOwnerPeople (M17, owner-scope)', () => {
  it("returns only that owner's people (named + unnamed clusters), filtered by query, and never another owner's", async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { user: otherUser } = await ctx.newUser();
    const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
    const { person: albert } = await ctx.newPerson({ ownerId: user.id, name: 'Albert' });
    const { person: unnamed } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: strangerPerson } = await ctx.newPerson({ ownerId: otherUser.id, name: 'Alice' });

    const all = await sut.searchOwnerPeople(user.id, { page: 0 });
    const allIds = all.people.map((p) => p.id);
    expect(allIds).toEqual(expect.arrayContaining([alice.personGroupId, albert.personGroupId, unnamed.personGroupId]));
    expect(allIds).not.toContain(strangerPerson.personGroupId);
    expect(all.total).toBe(3);

    const filtered = await sut.searchOwnerPeople(user.id, { query: 'al', page: 0 });
    const filteredIds = filtered.people.map((p) => p.id);
    expect(filteredIds).toEqual(expect.arrayContaining([alice.personGroupId, albert.personGroupId]));
    expect(filteredIds).not.toContain(unnamed.personGroupId);
    expect(filteredIds).not.toContain(strangerPerson.personGroupId);
  });

  it('paginates results', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    for (let index = 0; index < 25; index++) {
      await ctx.newPerson({ ownerId: user.id, name: `Person ${index}` });
    }

    const firstPage = await sut.searchOwnerPeople(user.id, { page: 0 });
    expect(firstPage.people.length).toBeLessThanOrEqual(20);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.total).toBe(25);

    const secondPage = await sut.searchOwnerPeople(user.id, { page: 1 });
    expect(secondPage.people.length).toBeGreaterThan(0);

    const firstIds = new Set(firstPage.people.map((p) => p.id));
    for (const person of secondPage.people) {
      expect(firstIds.has(person.id)).toBe(false);
    }
  });
});

describe('FaceRepairService.createOwnerPerson (M18, state 2)', () => {
  it('creates a person under ownerId whose id is immediately usable as a moveToPerson destination', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const created = await sut.createOwnerPerson(user.id, 'New Person');
    expect(created.id).toBeDefined();

    const row = await db
      .selectFrom('person')
      .select(['personGroupId', 'ownerId', 'name'])
      .where('personGroupId', '=', created.id)
      .executeTakeFirst();
    expect(row?.ownerId).toBe(user.id);
    expect(row?.name).toBe('New Person');

    // Immediately usable as a moveToPerson destination for a face owned by the same user (passes the
    // Step-2 cross-owner guard).
    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: created.id, faceIds: [f1], lock: false }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );
    expect(result.moved).toBe(1);

    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(created.id);
  });
});

// ── M15: zero-override — the default owner group covers every flagged face (E10) ───────────────────

describe('FaceRepairService.resolveFaces: zero-override all-to-owner (M15, E10)', () => {
  it('moves every flagged face via the single default owner group and drains the (unnamed) person', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: owner } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });

    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    const f2 = await seedFace(ctx, user.id, source.personGroupId);
    const f3 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [
      { assetFaceId: f1, suspectedOwnerId: owner.personGroupId },
      { assetFaceId: f2, suspectedOwnerId: owner.personGroupId },
      { assetFaceId: f3, suspectedOwnerId: owner.personGroupId },
    ]);

    // The whole point of "zero-override": there is exactly ONE moveToPerson group — the default owner — and
    // it contains every flagged face on the person, i.e. the admin never touched the per-face destination.
    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: owner.personGroupId, faceIds: [f1, f2, f3], lock: false }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    expect(result).toEqual({ moved: 3, declined: 0, locked: 0, detached: 0, unknown: 0, skipped: 0 });

    const byId = await personIdsOf([f1, f2, f3]);
    expect(byId[f1]).toBe(owner.personGroupId);
    expect(byId[f2]).toBe(owner.personGroupId);
    expect(byId[f3]).toBe(owner.personGroupId);

    // Unnamed source has zero remaining faces of any kind → auto-deleted (E6), and drained from the scan.
    const sourceRow = await db.selectFrom('person').select('id').where('personGroupId', '=', source.personGroupId).executeTakeFirst();
    expect(sourceRow).toBeUndefined();

    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).not.toContain(source.personGroupId);
  });
});

// ── M9: face moved off the person since the scan → skipped ─────────────────────────────────────────

describe('FaceRepairService.resolveFaces: skip stale moves (M9, E1)', () => {
  it('skips a face that moved off the person since the snapshot was taken, and counts it in skipped', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: owner } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: elsewhere } = await ctx.newPerson({ ownerId: user.id, name: '' });

    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    const f2 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [
      { assetFaceId: f1, suspectedOwnerId: owner.personGroupId },
      { assetFaceId: f2, suspectedOwnerId: owner.personGroupId },
    ]);

    // f1 moved off `source` after the scan ran (e.g. a concurrent manual move) — no longer on-source at write time.
    await db.updateTable('asset_face').set({ personId: elsewhere.personGroupId }).where('id', '=', f1).execute();

    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: owner.personGroupId, faceIds: [f1, f2], lock: false }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    expect(result.moved).toBe(1);
    expect(result.skipped).toBe(1);

    const byId = await personIdsOf([f1, f2]);
    expect(byId[f1]).toBe(elsewhere.personGroupId); // untouched — still on the person it moved to
    expect(byId[f2]).toBe(owner.personGroupId); // the still-eligible face moved as requested
  });
});

// ── M10: guard reuse — refuse while FacialRecognition/scan active ──────────────────────────────────

describe('FaceRepairService.resolveFaces: concurrency guards (M10, E9)', () => {
  it('throws ConflictException while FacialRecognition is active, with the review-page conflict message', async () => {
    const { sut, ctx, jobMock } = setup();
    const { user } = await ctx.newUser();
    const { person: owner } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    jobMock.isActive.mockResolvedValue(true);

    await expect(
      sut.resolveFaces(
        {
          personId: source.personGroupId,
          moveToPerson: [{ destinationPersonId: owner.personGroupId, faceIds: [f1], lock: false }],
          stay: [],
          lock: [],
          detach: [],
          unknown: [],
        },
        user.id,
      ),
    ).rejects.toThrow(new ConflictException('Refusing to apply while facial recognition is active'));

    // Nothing moved.
    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(source.personGroupId);
  });

  it('throws ConflictException while a scan is pending/running, with the review-page conflict message', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: owner } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: owner.personGroupId }]);
    // A second scan is now pending — getLatestScan sees it, not the completed one above.
    await scanRepo.createScan({ requestedBy: user.id, params: scanParams() });

    await expect(
      sut.resolveFaces(
        {
          personId: source.personGroupId,
          moveToPerson: [{ destinationPersonId: owner.personGroupId, faceIds: [f1], lock: false }],
          stay: [],
          lock: [],
          detach: [],
          unknown: [],
        },
        user.id,
      ),
    ).rejects.toThrow(new ConflictException('Refusing to apply while a scan is in progress'));

    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(source.personGroupId);
  });
});

// ── M19: an empty resolve is rejected outright, never drains the person (E16) ──────────────────────

describe('FaceRepairService.resolveFaces: empty resolve is rejected (M19, E16)', () => {
  it('throws BadRequestException when every bucket is empty and entireCluster is absent, and does not drain the person', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: owner } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: owner.personGroupId }]);

    await expect(
      sut.resolveFaces(
        {
          personId: source.personGroupId,
          moveToPerson: [],
          stay: [],
          lock: [],
          detach: [],
          unknown: [],
        },
        user.id,
      ),
    ).rejects.toThrow(new BadRequestException('Resolve request has no faces to act on'));

    // The face is untouched...
    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(source.personGroupId);

    // ...and — unlike today's bug — the person is NOT drained from the latest scan.
    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).toContain(source.personGroupId);

    const sourceRow = await db.selectFrom('person').select('id').where('personGroupId', '=', source.personGroupId).executeTakeFirst();
    expect(sourceRow).toBeDefined();
  });
});

// ── Slice 2: soft-stay ("Keep here") ────────────────────────────────────────────────────────────────

// "Keep here" is a shared negative verdict now, not a console-private decline row — the suggestion engine
// reads the same record, so a face kept away from someone is never later proposed as that someone.
const declineRowsFor = (assetFaceId: string, suspectedOwnerId: string) =>
  db
    .selectFrom('face_person_verdict')
    .select(['id', 'actorId as declinedBy', 'source', 'status', 'identityId', 'actorId'])
    .where('assetFaceId', '=', assetFaceId)
    .where('personId', '=', suspectedOwnerId)
    .where('status', 'in', ['rejected', 'ignored'])
    .execute();

describe('FaceRepairService.resolveFaces: soft-stay (M4, E3)', () => {
  it('writes a rejected face_person_verdict row for the stayed face and its stored suspected owner', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [f1], lock: [], detach: [], unknown: [] },
      user.id,
    );

    expect(result).toEqual({ moved: 0, declined: 1, locked: 0, detached: 0, unknown: 0, skipped: 0 });

    const rows = await declineRowsFor(f1, ownerA.personGroupId);
    expect(rows).toHaveLength(1);
    expect(rows[0].declinedBy).toBe(user.id);

    // The face itself is untouched (soft-stay never moves anything).
    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(source.personGroupId);
  });

  it('a keep-here row stores both the suspected owner identity and the acting admin (not null)', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    // ownerA already has an established identity (e.g. from an earlier manual placement elsewhere) — this is
    // the case the identity-first key exists to serve: the decline should key off it, not just the person row.
    const identity = await ctx.get(FaceIdentityRepository).ensurePersonIdentity(ownerA.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [f1], lock: [], detach: [], unknown: [] },
      user.id,
    );

    const rows = await declineRowsFor(f1, ownerA.personGroupId);
    expect(rows).toHaveLength(1);
    expect(rows[0].identityId).toBe(identity.id);
    expect(rows[0].actorId).toBe(user.id);
  });

  it('a re-flagged pairing toward the SAME declined owner is silently skipped by move-to-owner, but a genuinely different owner still moves', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: ownerB } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);
    await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [f1], lock: [], detach: [], unknown: [] },
      user.id,
    );

    // Simulate a later scan flagging the exact same (face, owner) pairing again (the real scan never would —
    // it consults declines before flagging — but resolveFaces re-applies the decline filter independently of
    // how the snapshot got there, so this exercises that seam directly).
    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);
    const skippedResult = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: ownerA.personGroupId, faceIds: [f1], lock: false }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );
    expect(skippedResult.moved).toBe(0);
    expect(skippedResult.skipped).toBe(1);
    const stillOnSource = await personIdsOf([f1]);
    expect(stillOnSource[f1]).toBe(source.personGroupId);

    // A genuinely different owner is a real new problem (E3) and still moves.
    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerB.personGroupId }]);
    const movedResult = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: ownerB.personGroupId, faceIds: [f1], lock: false }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );
    expect(movedResult.moved).toBe(1);
    const movedOwner = await personIdsOf([f1]);
    expect(movedOwner[f1]).toBe(ownerB.personGroupId);
  });
});

describe('FaceRepairService.resolveFaces: stay-only drains the person (M11, E13)', () => {
  it('removes the person from the latest scan snapshot even though nothing moved', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [f1], lock: [], detach: [], unknown: [] },
      user.id,
    );

    expect(result.moved).toBe(0);

    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).not.toContain(source.personGroupId);

    // The (unnamed) source is not auto-deleted — the face is still there, just no longer flagged (E13 is
    // about draining from the CONSOLE, not deleting the person).
    const sourceRow = await db.selectFrom('person').select('id').where('personGroupId', '=', source.personGroupId).executeTakeFirst();
    expect(sourceRow).toBeDefined();
  });
});

describe('FaceRepairService.resolveFaces: disjoint buckets — stay overlapping move (M7, E7)', () => {
  it('throws BadRequestException when a face is present in both moveToPerson and stay', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    await expect(
      sut.resolveFaces(
        {
          personId: source.personGroupId,
          moveToPerson: [{ destinationPersonId: ownerA.personGroupId, faceIds: [f1], lock: false }],
          stay: [f1],
          lock: [],
          detach: [],
          unknown: [],
        },
        user.id,
      ),
    ).rejects.toThrow(new BadRequestException('A face cannot be resolved more than one way in the same request'));

    // No side effects: untouched, no decline written, person still in the scan snapshot.
    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(source.personGroupId);
    const rows = await declineRowsFor(f1, ownerA.personGroupId);
    expect(rows).toHaveLength(0);
    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).toContain(source.personGroupId);
  });
});

describe('FaceRepairService.resolveFaces: stay on a non-flagged face (M14, E15)', () => {
  it('throws BadRequestException when a stay id is not in the flagged snapshot for this person', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    // A rest-of-cluster face on the same person that was never part of the flagged snapshot.
    const notFlagged = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    await expect(
      sut.resolveFaces(
        { personId: source.personGroupId, moveToPerson: [], stay: [notFlagged], lock: [], detach: [], unknown: [] },
        user.id,
      ),
    ).rejects.toThrow(
      // Pinned WITH its reason code: the web client keys its translated banner off that code, so a rename
      // here without one there silently drops the admin back to English server text.
      new BadRequestException({
        message: 'Some faces are not in the flagged snapshot for this person',
        code: FaceRepairResolveErrorCode.FacesNotInSnapshot,
      }),
    );

    const byId = await personIdsOf([notFlagged]);
    expect(byId[notFlagged]).toBe(source.personGroupId);
    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).toContain(source.personGroupId);
  });

  it('throws BadRequestException for a stay id when no scan has ever run', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    // No seedFlaggedSnapshot call at all — there is no scan, so no snapshot and no suspected owner.
    await expect(
      sut.resolveFaces(
        { personId: source.personGroupId, moveToPerson: [], stay: [f1], detach: [], lock: [], unknown: [] },
        user.id,
      ),
    ).rejects.toThrow(
      // Pinned WITH its reason code: the web client keys its translated banner off that code, so a rename
      // here without one there silently drops the admin back to English server text.
      new BadRequestException({
        message: 'Some faces are not in the flagged snapshot for this person',
        code: FaceRepairResolveErrorCode.FacesNotInSnapshot,
      }),
    );
  });
});

describe('FaceRepairService.resolveFaces: re-soft-stay is idempotent (M22, E20)', () => {
  it('re-staying an already-declined (face, suspectedOwner) succeeds with no error and exactly one decline row', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const first = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [f1], lock: [], detach: [], unknown: [] },
      user.id,
    );
    expect(first.declined).toBe(1);

    // Re-submit the identical stay request (double-click / retry) against the same still-standing snapshot row.
    const second = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [f1], lock: [], detach: [], unknown: [] },
      user.id,
    );
    // The verdict is upserted, so a re-stay reports 1 again — what must not change is the row count.
    expect(second).toEqual({ moved: 0, declined: 1, locked: 0, detached: 0, unknown: 0, skipped: 0 });

    const rows = await declineRowsFor(f1, ownerA.personGroupId);
    expect(rows).toHaveLength(1);
  });
});

// ── Slice 3: confirm/lock ("Confirm / lock", owner-agnostic) ──────────────────────────────────────

// Build the same VerdictMaps the service builds, from real repositories — so these tests exercise the exact
// production seam (scoped reads + applyVerdictFilters) rather than a hand-rolled approximation.
const buildRealVerdictMaps = async (ctx: Ctx) => {
  const identityRepo = ctx.get(FaceIdentityRepository);
  const verdictRepo = ctx.get(FacePersonVerdictRepository);
  const declineRepo = ctx.get(FaceRepairDeclineRepository);
  const faceRows = await db.selectFrom('asset_face').select('id').execute();
  const personRows = await db.selectFrom('person').select('id').execute();
  const faceIds = faceRows.map((r) => r.id);
  const personIds = personRows.map((r) => r.id);
  return {
    manualLinkedFaceIds: await identityRepo.getManualLinkedFaceIds(faceIds),
    negativeFaceTargets: await verdictRepo.getNegativeVerdictTokens(faceIds),
    ownerTokens: await identityRepo.getPersonVerdictTokens(personIds),
    mutedPersons: await declineRepo.getClusterMuteMap(personIds),
  };
};

// A human placement is recorded as the face's identity link with source='manual' — there is no separate
// lock row any more. These helpers read that record.
const manualLinkFor = (assetFaceId: string) =>
  db
    .selectFrom('face_identity_face')
    .select(['assetFaceId', 'identityId', 'source'])
    .where('assetFaceId', '=', assetFaceId)
    .where('source', '=', 'manual')
    .execute();

describe('FaceRepairService.resolveFaces: confirm/lock (M5, E2)', () => {
  it("records a manual face_identity_face link for the locked face, keyed by the reviewed person's identity", async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [f1], detach: [], unknown: [] },
      user.id,
    );

    expect(result).toEqual({ moved: 0, declined: 0, locked: 1, detached: 0, unknown: 0, skipped: 0 });

    const rows = await manualLinkFor(f1);
    expect(rows).toHaveLength(1);
    // The placement is recorded against the reviewed person's IDENTITY — that is what makes it
    // survive a later merge, and what every future scan consults.
    const expectedIdentity = await ctx.get(FaceIdentityRepository).ensurePersonIdentity(source.personGroupId);
    expect(rows[0].identityId).toBe(expectedIdentity.id);

    // The face itself is untouched (lock never moves anything).
    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(source.personGroupId);
  });

  it('drops a locked face for ANY future suspected owner via the real getDeclineMaps → applyDeclineFilters seam', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: ownerB } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);
    await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [f1], detach: [], unknown: [] },
      user.id,
    );

    // A LATER scan pass re-suspects the SAME face toward a DIFFERENT owner (the age-gap childhood-photo case).
    // Exercise the exact seam buildRepairPlan uses in production: a real, unscoped getDeclineMaps() read
    // followed by applyDeclineFilters — the lock must drop f1 regardless of which owner is now proposed.
    const maps = await buildRealVerdictMaps(ctx);
    const flaggedByPerson = new Map([
      [source.personGroupId, [{ assetFaceId: f1, currentPersonId: source.personGroupId, suspectedOwnerId: ownerB.personGroupId }]],
    ]);
    applyVerdictFilters(flaggedByPerson, maps);

    expect(flaggedByPerson.get(source.personGroupId)).toEqual([]);
  });

  it('re-confirming an already-placed face is idempotent: no error, exactly one placement row', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);
    const first = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [f1], detach: [], unknown: [] },
      user.id,
    );
    expect(first.locked).toBe(1);

    // A later scan re-flags the exact same face (still on the same person) and the admin re-submits the
    // identical lock request (double-click / retry, or simply re-confirming an already-locked face).
    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);
    const second = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [f1], detach: [], unknown: [] },
      user.id,
    );
    // Re-affirming reports the face again (the write is an upsert, not a conditional insert); what must not
    // change is that a face carries exactly ONE placement row — face_identity_face is keyed by assetFaceId.
    expect(second).toEqual({ moved: 0, declined: 0, locked: 1, detached: 0, unknown: 0, skipped: 0 });

    const rows = await manualLinkFor(f1);
    expect(rows).toHaveLength(1);
  });

  // S11 (slice 11d): the lock write clears a durable rejected verdict for this SAME (person, face) target —
  // see clearNegativeForTarget. Without it, a stale "not this person" verdict would keep suppressing this
  // person's suggestion queue for f1 even after a human just locked it there.
  it('clears a durable rejected verdict for the SAME (person, face) target when the face is locked', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    // A durable rejected verdict against `source` for `f1` — e.g. from an earlier "not this person" call
    // that a later scan re-flagged the same face toward `source` for a different reason.
    await ctx.get(FacePersonVerdictRepository).markRejected(source.personGroupId, f1, { actorId: user.id });
    // Positive control: an unrelated rejection against a DIFFERENT person for the same face must survive —
    // clearNegativeForTarget is scoped to `source` only, not a blanket clear for the face.
    await ctx.get(FacePersonVerdictRepository).markRejected(ownerA.personGroupId, f1, { actorId: user.id });
    expect(await declineRowsFor(f1, source.personGroupId)).toHaveLength(1);
    expect(await declineRowsFor(f1, ownerA.personGroupId)).toHaveLength(1);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [f1], detach: [], unknown: [] },
      user.id,
    );

    expect(result.locked).toBe(1);
    expect(await declineRowsFor(f1, source.personGroupId)).toHaveLength(0);
    expect(await declineRowsFor(f1, ownerA.personGroupId)).toHaveLength(1); // untouched — different target
  });
});

describe('FaceRepairService.resolveFaces: lock eligibility (manual review, E15 relaxed)', () => {
  // 2a: inverts the old M14/E15 assertion — a non-flagged face that is currently ON this person now
  // succeeds, because `lock` is no longer gated on flagged-snapshot membership.
  it('locks a non-flagged face that is currently on this person', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    const notFlagged = await seedFace(ctx, user.id, source.personGroupId);
    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [notFlagged], detach: [], unknown: [] },
      user.id,
    );

    expect(result.locked).toBe(1);
    const rows = await manualLinkFor(notFlagged);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('manual');
  });

  // 2b: the actual manual-review path — no scan has ever run, so there is no snapshot at all.
  it('locks a face when no scan has ever run', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [f1], detach: [], unknown: [] },
      user.id,
    );

    expect(result.locked).toBe(1);
    const rows = await manualLinkFor(f1);
    expect(rows).toHaveLength(1);
  });

  // 2c: §5.3 hazard — a face flagged for `source` at scan time but reassigned to a DIFFERENT person since
  // (e.g. a concurrent manual move, mirroring the "skip stale moves" M9/E1 pattern) must be rejected.
  // NOTE on pre-slice-1 behaviour: this does NOT go red against unmodified source. getScanFlaggedFacesForPersons
  // re-validates `asset_face.personId = ff.personId` (i.e. current personId) at snapshot-read time — its own
  // comment calls this out: "a face moved off its recorded person since the scan is silently dropped". So the
  // pre-existing combined stay/lock/detach/unknown snapshot-membership gate already (coincidentally) rejects
  // this shape today. The eligibility check is still required going forward: once `lock` is dropped from that
  // combined gate (3b) it is the ONLY thing standing between a `lock` id and the unscoped
  // `replaceFaceIdentities` upsert — this test pins that the swap does not quietly drop the guarantee.
  it('rejects a lock id that belongs to a different person', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: other } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);
    // f1 moved to a different person after the scan flagged it — still in the raw flagged snapshot, but no
    // longer actually on `source`.
    await db.updateTable('asset_face').set({ personId: other.personGroupId }).where('id', '=', f1).execute();

    await expect(
      sut.resolveFaces(
        { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [f1], detach: [], unknown: [] },
        user.id,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(await manualLinkFor(f1)).toHaveLength(0);
  });

  // 2d: the cross-tenant arm of the same hazard — the face was reassigned to a person owned by a DIFFERENT
  // user. This is what makes the missing check a security issue rather than a correctness nit. Same pre-slice-1
  // caveat as 2c: getScanFlaggedFacesForPersons' current-personId re-check already rejects this shape today.
  it('rejects a lock id that belongs to a different person owned by a different user', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { user: otherUser } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: otherUsersPerson } = await ctx.newPerson({ ownerId: otherUser.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);
    await db.updateTable('asset_face').set({ personId: otherUsersPerson.personGroupId }).where('id', '=', f1).execute();

    await expect(
      sut.resolveFaces(
        { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [f1], detach: [], unknown: [] },
        user.id,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(await manualLinkFor(f1)).toHaveLength(0);
  });

  // 2e: a nonexistent face id is rejected. Pre-slice-1 caveat as 2c/2d: getScanFlaggedFacesForPersons'
  // INNER JOIN to asset_face means a nonexistent id can never appear in the flagged snapshot either, so
  // today's combined gate already 400s this (via "not in the flagged snapshot"), not via an unhandled
  // FK-violation crash. The eligibility read must still reject it once `lock` no longer goes through that gate.
  it('rejects a lock id that does not exist', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });

    await expect(
      sut.resolveFaces(
        { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [randomUUID()], detach: [], unknown: [] },
        user.id,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // 2f: a soft-deleted face is rejected — it is no longer "listed on the manual review page". Flagged while
  // alive, then soft-deleted (the row still physically exists). Same pre-slice-1 caveat: the snapshot read's own
  // `asset_face.deletedAt IS NULL` filter already excludes it from the flagged snapshot today, so the combined
  // gate already rejects it — the write never actually runs pre-slice-1 either.
  it('rejects a lock id for a soft-deleted face', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);
    await db.updateTable('asset_face').set({ deletedAt: new Date() }).where('id', '=', f1).execute();

    await expect(
      sut.resolveFaces(
        { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [f1], detach: [], unknown: [] },
        user.id,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(await manualLinkFor(f1)).toHaveLength(0);
  });

  // 2g: once eligibility constrains the face to this person, re-pointing a face already linked to another
  // identity is the upsert's DO UPDATE behaviour — correct, but must be pinned so nobody later mistakes it
  // for a no-op.
  it('re-points a face already linked to another identity onto this person (upsert, not no-op)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: otherIdentityPerson } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, otherIdentityPerson.personGroupId);

    await sut.resolveFaces(
      { personId: otherIdentityPerson.personGroupId, moveToPerson: [], stay: [], lock: [f1], detach: [], unknown: [] },
      user.id,
    );
    const beforeRows = await manualLinkFor(f1);
    expect(beforeRows).toHaveLength(1);
    const otherIdentity = await ctx.get(FaceIdentityRepository).ensurePersonIdentity(otherIdentityPerson.personGroupId);
    expect(beforeRows[0].identityId).toBe(otherIdentity.id);

    // Move the face onto `source` (outside resolveFaces, simulating the face currently sitting there) and
    // lock it there.
    await db.updateTable('asset_face').set({ personId: source.personGroupId }).where('id', '=', f1).execute();
    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [f1], detach: [], unknown: [] },
      user.id,
    );

    expect(result.locked).toBe(1);
    const afterRows = await manualLinkFor(f1);
    expect(afterRows).toHaveLength(1);
    const sourceIdentity = await ctx.get(FaceIdentityRepository).ensurePersonIdentity(source.personGroupId);
    expect(afterRows[0].identityId).toBe(sourceIdentity.id);
  });

  // 2h: guided regression — a flagged face still locks (the pre-existing, still-supported path).
  it('locks a flagged face as before', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [f1], detach: [], unknown: [] },
      user.id,
    );

    expect(result.locked).toBe(1);
    const rows = await manualLinkFor(f1);
    expect(rows).toHaveLength(1);
  });
});

// ── Slice 5: detach ("Not a face") ──────────────────────────────────────────────────────────────────

const identityLinkRowsFor = (assetFaceId: string) =>
  db
    .selectFrom('face_identity_face')
    .select(['assetFaceId', 'identityId'])
    .where('assetFaceId', '=', assetFaceId)
    .execute();

describe('FaceRepairService.resolveFaces: detach (M6, E4, E15)', () => {
  it('nulls personId and strips the identity link, and a subsequent identity backfill does NOT reattach it', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    // f1 already carries an identity link (as a genuinely-resolved ML face normally would) — proves detach
    // actually strips it, rather than the assertion trivially passing because no link ever existed.
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const sourceIdentity = await faceIdentityRepo.ensurePersonIdentity(source.personGroupId);
    await faceIdentityRepo.linkFace({ assetFaceId: f1, identityId: sourceIdentity.id, source: 'backfill' });
    expect(await identityLinkRowsFor(f1)).toHaveLength(1);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [f1], unknown: [] },
      user.id,
    );

    expect(result).toEqual({ moved: 0, declined: 0, locked: 0, detached: 1, unknown: 0, skipped: 0 });

    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBeNull();
    expect(await identityLinkRowsFor(f1)).toHaveLength(0);

    // Regression lock (E4): backfillPersonalIdentities iterates PEOPLE and links any of THEIR faces lacking an
    // identity row (`where asset_face.personId = person.id`). Since f1's personId is now null, no person's pass
    // will ever select it — it can never be silently re-linked back to `source` (or anyone else) by a later
    // backfill. Exercised via the real repository method (not mocked) — this is the exact mechanism a
    // `JobName.FaceIdentityBackfill` job run invokes; going through the full job/PersonService orchestration
    // isn't needed to prove the guarantee, since all of the reattachment logic lives in this repository call.
    await faceIdentityRepo.backfillPersonalIdentities({ limit: 1000 });

    const afterBackfill = await personIdsOf([f1]);
    expect(afterBackfill[f1]).toBeNull();
    expect(await identityLinkRowsFor(f1)).toHaveLength(0);
  });

  it('leaves the face untouched (still on source, identity link intact) when detach is empty', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [f1], lock: [], detach: [], unknown: [] },
      user.id,
    );

    expect(result.detached).toBe(0);
  });
});

describe('FaceRepairService.resolveFaces: detach on a non-flagged face (E15 relaxed)', () => {
  // 1a: inverts the old M14/E15 assertion — a non-flagged face currently on this person now succeeds,
  // because `detach` is no longer gated on flagged-snapshot membership.
  it('detaches a non-flagged face that is currently on this person', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    // A rest-of-cluster face on the same person that was never part of the flagged snapshot.
    const notFlagged = await seedFace(ctx, user.id, source.personGroupId);

    // notFlagged already carries an identity link (as a genuinely-resolved ML face normally would) — proves
    // detach actually strips it, rather than the assertion trivially passing because no link ever existed.
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const sourceIdentity = await faceIdentityRepo.ensurePersonIdentity(source.personGroupId);
    await faceIdentityRepo.linkFace({ assetFaceId: notFlagged, identityId: sourceIdentity.id, source: 'backfill' });
    expect(await identityLinkRowsFor(notFlagged)).toHaveLength(1);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [notFlagged], unknown: [] },
      user.id,
    );

    expect(result.detached).toBe(1);
    const byId = await personIdsOf([notFlagged]);
    expect(byId[notFlagged]).toBeNull();
    const row = await db
      .selectFrom('asset_face')
      .select('deletedAt')
      .where('id', '=', notFlagged)
      .executeTakeFirstOrThrow();
    expect(row.deletedAt).not.toBeNull();
    expect(await identityLinkRowsFor(notFlagged)).toHaveLength(0);
  });

  // 1b: the actual manual-review path — no scan has ever run, so there is no snapshot at all.
  it('detaches a face when no scan has ever run', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [f1], unknown: [] },
      user.id,
    );

    expect(result.detached).toBe(1);
  });

  // 1c — LOAD-BEARING: proves detach is person-scoped at the write layer (detachFaces filters `personId`),
  // now that the flagged-snapshot gate no longer stands in front of it. A foreign face must become an inert
  // no-op: no throw, `detached: 0`, and the foreign face completely untouched.
  it('is an inert no-op for a face that belongs to a DIFFERENT person', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: other } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const foreignFace = await seedFace(ctx, user.id, other.personGroupId);

    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const otherIdentity = await faceIdentityRepo.ensurePersonIdentity(other.personGroupId);
    await faceIdentityRepo.linkFace({ assetFaceId: foreignFace, identityId: otherIdentity.id, source: 'backfill' });

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [foreignFace], unknown: [] },
      user.id,
    );

    expect(result.detached).toBe(0);
    const byId = await personIdsOf([foreignFace]);
    expect(byId[foreignFace]).toBe(other.personGroupId);
    const row = await db
      .selectFrom('asset_face')
      .select('deletedAt')
      .where('id', '=', foreignFace)
      .executeTakeFirstOrThrow();
    expect(row.deletedAt).toBeNull();
    expect(await identityLinkRowsFor(foreignFace)).toHaveLength(1);
  });
});

describe('FaceRepairService.resolveFaces: detach regenerates the representative thumbnail (M21, E19)', () => {
  it('repoints faceAssetId off the detached face and queues PersonGenerateThumbnail for the person', async () => {
    const { sut, ctx, scanRepo, jobMock } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Jane Doe' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    const f2 = await seedFace(ctx, user.id, source.personGroupId);

    // f1 is the person's representative/feature face.
    await db.updateTable('person').set({ faceAssetId: f1 }).where('personGroupId', '=', source.personGroupId).execute();

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [
      { assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId },
      { assetFaceId: f2, suspectedOwnerId: ownerA.personGroupId },
    ]);

    await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [f1], unknown: [] },
      user.id,
    );

    const updated = await db
      .selectFrom('person')
      .select('faceAssetId')
      .where('personGroupId', '=', source.personGroupId)
      .executeTakeFirstOrThrow();
    // Repointed to the still-eligible remaining face (f2), never left on the now-detached f1.
    expect(updated.faceAssetId).toBe(f2);

    const queuedJobs = jobMock.queueAll.mock.calls.flatMap(([items]) => items);
    expect(queuedJobs).toEqual(
      expect.arrayContaining([{ name: JobName.PersonGenerateThumbnail, data: { id: source.personGroupId } }]),
    );
  });

  it('does NOT queue a thumbnail regen when the detached face was not the representative', async () => {
    const { sut, ctx, scanRepo, jobMock } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Jane Doe' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    const f2 = await seedFace(ctx, user.id, source.personGroupId);

    // f2 (not f1) is the representative — detaching f1 must not disturb it.
    await db.updateTable('person').set({ faceAssetId: f2 }).where('personGroupId', '=', source.personGroupId).execute();

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [
      { assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId },
      { assetFaceId: f2, suspectedOwnerId: ownerA.personGroupId },
    ]);

    await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [f1], unknown: [] },
      user.id,
    );

    const updated = await db
      .selectFrom('person')
      .select('faceAssetId')
      .where('personGroupId', '=', source.personGroupId)
      .executeTakeFirstOrThrow();
    expect(updated.faceAssetId).toBe(f2);

    const queuedJobs = jobMock.queueAll.mock.calls.flatMap(([items]) => items);
    expect(queuedJobs.some((job) => job.name === JobName.PersonGenerateThumbnail)).toBe(false);
  });
});

// ── Temporal-consistency hardening, Slice 2: dismiss drains the latest scan snapshot (M9, E11) ─────

describe('FaceRepairService.createDeclines: dismiss drains the latest scan snapshot (M9, E11)', () => {
  it('removes the dismissed person from the latest scan snapshot while keeping the person-decline row', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerQ } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerQ.personGroupId }]);

    // Sanity: the person starts out present in the latest scan snapshot.
    const before = await scanRepo.getLatestScan();
    const beforeIds = ((before!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(beforeIds).toContain(source.personGroupId);

    await sut.createDeclines({
      persons: [{ personId: source.personGroupId, suspectedOwnerIds: [ownerQ.personGroupId] }],
      declinedBy: user.id,
    });

    // Drained from the latest scan snapshot — a dashboard reload no longer resurfaces it.
    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).not.toContain(source.personGroupId);

    // The persisted person-decline row still exists — it governs future scans independently of the drain
    // (a genuinely new suspected owner can still resurface the person, per the existing subset check).
    const declineRow = await db
      .selectFrom('face_repair_decline')
      .select(['id', 'personId'])
      .where('type', '=', 'person')
      .where('personId', '=', source.personGroupId)
      .executeTakeFirst();
    expect(declineRow).toBeDefined();
  });
});

// ── Temporal-consistency hardening, Slice 3: move-and-lock ─────────────────────────────────────────
//
// A deliberate "Move → chosen person" can ALSO durably, owner-agnostically lock the moved faces to their
// destination (moveToPerson[].lock: true), so a later re-scan never re-flags them — without this, a plain
// move has no persisted marker and the very next scan pass can re-suspect the face right back toward its old
// person. The lock is only ever written for faces that ACTUALLY moved (`executeRepair`'s still-on-source
// re-check at write time is the source of truth), never for a face requested in the same group that turned
// out to be stale (moved off `personId` before this call, M8) — an orphan lock on an untouched face would be
// meaningless (locks are keyed to the DESTINATION the face is confirmed on).

describe('FaceRepairService.resolveFaces: move-and-lock (M5, E13)', () => {
  it('moves the face to the destination AND locks it there; re-issuing the identical request inserts no second lock row', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: dest } = await ctx.newPerson({ ownerId: user.id, name: 'Dest' });
    // NAMED so the empty-unnamed cleanup doesn't delete `source` once f1 moves away — the re-issued second
    // call below needs `source` to still exist.
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Source' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: dest.personGroupId }]);

    const first = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: dest.personGroupId, faceIds: [f1], lock: true }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    expect(first.moved).toBe(1);
    expect(first.locked).toBeGreaterThanOrEqual(1);

    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(dest.personGroupId);

    const rows = await manualLinkFor(f1);
    expect(rows).toHaveLength(1);
    // The placement is recorded against the reviewed person's IDENTITY — that is what makes it
    // survive a later merge, and what every future scan consults.
    const expectedIdentity = await ctx.get(FaceIdentityRepository).ensurePersonIdentity(dest.personGroupId);
    expect(rows[0].identityId).toBe(expectedIdentity.id);

    // Re-issuing the identical move-lock request (double-click / retry, E13): f1 is already on `dest`, so
    // executeRepair's still-on-source re-check moves 0 faces this time — and the move-lock loop only ever
    // locks faces present in `movedFaceIds`, so no second lock row is inserted for f1.
    const second = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: dest.personGroupId, faceIds: [f1], lock: true }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );
    expect(second.moved).toBe(0);

    const rowsAfter = await manualLinkFor(f1);
    expect(rowsAfter).toHaveLength(1);
  });
});

describe('FaceRepairService.resolveFaces: lock:false leaves a move reviewable (B2)', () => {
  it('does not write a manual link for an unlocked move, but does for a locked one', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: dest } = await ctx.newPerson({ ownerId: user.id, name: 'Dest' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: dest.personGroupId }]);

    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: dest.personGroupId, faceIds: [f1], lock: false }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    expect(result.moved).toBe(1);
    // `locked` counts only faces the request explicitly asked to confirm.
    expect(result.locked).toBe(0);

    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(dest.personGroupId);

    // B2: the `lock` flag now governs DURABILITY, not just the reported count. A `manual` link is the
    // strongest verdict in the system — both engines exclude such a face permanently — so writing one for
    // every move made `lock: false` a silent one-way door while the response reported `locked: 0`. The DTO
    // has always documented the opposite ("plain moves stay undurable unless the caller opts in"), and the
    // picker exposes a lock checkbox; this test previously encoded the contradiction as correct.
    const rows = await manualLinkFor(f1);
    expect(rows).toHaveLength(0);

    // The identity is still RE-POINTED, just not as a human placement — otherwise the face would sit on
    // `dest` carrying `source`'s identity, which FaceIdentityBackfill resolves back and silently reverts.
    const links = await db
      .selectFrom('face_identity_face')
      .select(['assetFaceId', 'source'])
      .where('assetFaceId', '=', f1)
      .execute();
    expect(links).toHaveLength(1);
    expect(links[0].source).toBe('owner-person');
  });

  // Positive control for the assertion above: the identical move WITH lock:true does write the manual link,
  // which is what proves the absence above is caused by the flag and not by a broken fixture.
  it('writes the manual link when the same move opts in', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: dest } = await ctx.newPerson({ ownerId: user.id, name: 'Dest' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: dest.personGroupId }]);

    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: dest.personGroupId, faceIds: [f1], lock: true }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    expect(result.moved).toBe(1);
    expect(await manualLinkFor(f1)).toHaveLength(1);
  });
});

describe('FaceRepairService.resolveFaces: move-and-lock skips a face that moved off personId before the call (M8, E1)', () => {
  it('locks only the face that actually moved, never the stale one — no orphan lock', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: dest } = await ctx.newPerson({ ownerId: user.id, name: 'Dest' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: elsewhere } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    const fGone = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [
      { assetFaceId: f1, suspectedOwnerId: dest.personGroupId },
      { assetFaceId: fGone, suspectedOwnerId: dest.personGroupId },
    ]);

    // fGone moved off `source` after the scan ran (e.g. a concurrent manual move) — no longer on-source at
    // write time, mirroring the plain stale-move case (M9) but with lock: true on the group.
    await db.updateTable('asset_face').set({ personId: elsewhere.personGroupId }).where('id', '=', fGone).execute();

    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: dest.personGroupId, faceIds: [f1, fGone], lock: true }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    expect(result.moved).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.locked).toBeGreaterThanOrEqual(1);

    const byId = await personIdsOf([f1, fGone]);
    expect(byId[f1]).toBe(dest.personGroupId);
    expect(byId[fGone]).toBe(elsewhere.personGroupId); // untouched — still on the person it moved to

    const f1Rows = await manualLinkFor(f1);
    expect(f1Rows).toHaveLength(1);
    const goneRows = await manualLinkFor(fGone);
    expect(goneRows).toHaveLength(0); // no orphan lock on the face that never actually moved
  });
});

describe('FaceRepairService.resolveFaces: move-and-lock a rest-of-cluster face (M7, bypasses the flagged-snapshot check)', () => {
  it('locks a face never in the flagged snapshot when lock: true, without throwing BadRequestException', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: dest } = await ctx.newPerson({ ownerId: user.id, name: 'Dest' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    // A rest-of-cluster face on the same person that was never part of the flagged snapshot — moveToPerson
    // already accepts this (§5.3); this proves the NEW lock: true path bypasses the snapshot-membership check
    // the same way — locks here are tied to the move, not the standalone top-level `lock` bucket (which DOES
    // reject a non-flagged face, see M14).
    const notFlagged = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: dest.personGroupId }]);

    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: dest.personGroupId, faceIds: [notFlagged], lock: true }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    expect(result.moved).toBe(1);
    expect(result.locked).toBeGreaterThanOrEqual(1);

    const byId = await personIdsOf([notFlagged]);
    expect(byId[notFlagged]).toBe(dest.personGroupId);
    const rows = await manualLinkFor(notFlagged);
    expect(rows).toHaveLength(1);
  });
});

describe('FaceRepairService.resolveFaces: move-and-lock undo re-enables flagging (M10)', () => {
  it('removing the move-lock via removeResolutions lets a later scan re-flag the face; the face stays on the destination', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: dest } = await ctx.newPerson({ ownerId: user.id, name: 'Dest' });
    const { person: laterSuspect } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: dest.personGroupId }]);

    await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: dest.personGroupId, faceIds: [f1], lock: true }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    expect(await manualLinkFor(f1)).toHaveLength(1);

    const removed = await sut.unconfirmFaces([f1]);
    expect(removed.removed).toBe(1);
    expect(await manualLinkFor(f1)).toHaveLength(0);

    // A later scan re-suspects f1 toward a new owner — exercise the exact seam buildRepairPlan uses in
    // production: a real, unscoped getDeclineMaps() read followed by applyDeclineFilters. With the lock gone,
    // f1 is no longer dropped.
    const maps = await buildRealVerdictMaps(ctx);
    const flaggedByPerson = new Map([
      [dest.personGroupId, [{ assetFaceId: f1, currentPersonId: dest.personGroupId, suspectedOwnerId: laterSuspect.personGroupId }]],
    ]);
    applyVerdictFilters(flaggedByPerson, maps);
    expect(flaggedByPerson.get(dest.personGroupId)).toEqual([
      { assetFaceId: f1, currentPersonId: dest.personGroupId, suspectedOwnerId: laterSuspect.personGroupId },
    ]);

    // Undoing the lock never moves the face back — it stays on the destination it was moved to.
    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(dest.personGroupId);
  });
});

describe('FaceRepairService.resolveFaces: move-lock survives a later person merge (M12)', () => {
  it('re-points the lock personId to the merge target, and a re-run scan still does not re-flag the face', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: dest } = await ctx.newPerson({ ownerId: user.id, name: 'Dest' });
    const { person: dest2 } = await ctx.newPerson({ ownerId: user.id, name: 'Dest2' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: dest.personGroupId }]);

    await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: dest.personGroupId, faceIds: [f1], lock: true }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    // dest is later merged away into dest2 (mergePersonProfile unconditionally sets the target's identityId,
    // which FKs to face_identity — seed a real row so the merge doesn't fail on an unrelated FK violation).
    const personRepository = ctx.get(PersonRepository);
    const identity = await db
      .insertInto('face_identity')
      .values({ type: 'person' })
      .returningAll()
      .executeTakeFirstOrThrow();
    await personRepository.mergePersonProfile({
      sourcePersonId: dest.personGroupId,
      targetPersonId: dest2.personGroupId,
      targetIdentityId: identity.id,
    });

    // The placement survives the merge as a placement. What matters is that the face is still SETTLED, not
    // which identity row it happens to hang off afterwards — the merge chooses the surviving identity, and
    // the scan below is the behaviour anyone actually depends on.
    const lockRows = await manualLinkFor(f1);
    expect(lockRows).toHaveLength(1);
    expect(lockRows[0].source).toBe('manual');

    // The merge itself re-points f1's asset_face row onto dest2 too.
    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(dest2.personGroupId);

    // A re-run scan does not re-flag f1: a human placement is owner-agnostic, so it stays dropped regardless
    // of which owner is now proposed for it.
    const maps = await buildRealVerdictMaps(ctx);
    const flaggedByPerson = new Map([
      [dest2.personGroupId, [{ assetFaceId: f1, currentPersonId: dest2.personGroupId, suspectedOwnerId: source.personGroupId }]],
    ]);
    applyVerdictFilters(flaggedByPerson, maps);
    expect(flaggedByPerson.get(dest2.personGroupId)).toEqual([]);
  });
});

// Streams the exact candidate set PersonService.queueRecognizeFaces feeds into the FacialRecognition queue on a
// normal (non-forced) run: every visible, non-deleted, ML-sourced face with NO person. A face sitting in this
// set gets re-matched by embedding and re-assigned to its nearest neighbour that HAS a person.
const recognitionCandidates = async (ctx: Ctx): Promise<string[]> => {
  const ids: string[] = [];
  for await (const face of ctx
    .get(PersonRepository)
    .getAllFaces({ personId: null, sourceType: SourceType.MachineLearning })) {
    ids.push(face.id);
  }
  return ids;
};

describe('FaceRepairService.resolveFaces: detach is durable against re-recognition', () => {
  it('soft-deletes the detached face so recognition can never hand it back to a person', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Jane Doe' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    // Positive control: a plainly UNASSIGNED face (personId NULL, not detached). It must show up as a
    // recognition candidate — that is precisely the state a bare unassign would have left the detached face in,
    // and why "unassign back to the unknown pool" boomerangs: the pool is the input queue of the very
    // clustering that mis-assigned the face.
    const unassigned = await seedFace(ctx, user.id, source.personGroupId);
    await db.updateTable('asset_face').set({ personId: null }).where('id', '=', unassigned).execute();

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [f1], unknown: [] },
      user.id,
    );
    expect(result.detached).toBe(1);

    const row = await db
      .selectFrom('asset_face')
      .select(['personId', 'deletedAt'])
      .where('id', '=', f1)
      .executeTakeFirstOrThrow();
    expect(row.personId).toBeNull();
    expect(row.deletedAt).not.toBeNull();

    const candidates = await recognitionCandidates(ctx);
    expect(candidates).toContain(unassigned);
    expect(candidates).not.toContain(f1);
  });
});

describe('FaceRepairService.resolveFaces: unknown person (state 6)', () => {
  it('parks the selected faces in one fresh unnamed cluster, locked there, and drains the person', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    const f2 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [
      { assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId },
      { assetFaceId: f2, suspectedOwnerId: ownerA.personGroupId },
    ]);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [], unknown: [f1, f2] },
      user.id,
    );
    expect(result).toEqual({ moved: 0, declined: 0, locked: 0, detached: 0, unknown: 2, skipped: 0 });

    // Both faces land on the SAME new person — one cluster per resolve, so the admin can name the unknown
    // person once rather than N times.
    const byId = await personIdsOf([f1, f2]);
    expect(byId[f1]).not.toBeNull();
    expect(byId[f1]).not.toBe(source.personGroupId);
    expect(byId[f2]).toBe(byId[f1]);

    const cluster = await db
      .selectFrom('person')
      .select(['personGroupId', 'name', 'ownerId'])
      .where('personGroupId', '=', byId[f1]!)
      .executeTakeFirstOrThrow();
    // Unnamed and owned by the LIBRARY's owner (never the reviewing admin), so it surfaces as an unnamed
    // cluster on the owner's People page for them to name later.
    expect(cluster.name).toBe('');
    expect(cluster.ownerId).toBe(user.id);

    // Locked to the new cluster, so the next scan never re-flags them...
    const locks = await manualLinkFor(f1);
    expect(locks).toHaveLength(1);
    const expectedIdentity_locks = await ctx.get(FaceIdentityRepository).ensurePersonIdentity(cluster.id);
    expect(locks[0].identityId).toBe(expectedIdentity_locks.id);

    // ...and never a recognition candidate, because the face now HAS a person (handleRecognizeFaces
    // early-returns on those). This is what a bare unassign could not guarantee.
    const candidates = await recognitionCandidates(ctx);
    expect(candidates).not.toContain(f1);
    expect(candidates).not.toContain(f2);

    // Every flagged face is settled, so the person leaves the console.
    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).not.toContain(source.personGroupId);
  });

  // 1d — §5.4 behaviour change: the flagged-snapshot gate no longer stands in front of `unknown`, so a face
  // that moved off `source` since the scan is no longer rejected outright. executeRepair's still-on-source
  // re-check silently skips it instead, `movedFaceIds` ends up empty, and the freshly created cluster (created
  // BEFORE the move, per the park implementation) is cleaned up as an empty, nameless person.
  it('returns success with unknown: 0 for a face that left this person since the scan', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
    const { person: elsewhere } = await ctx.newPerson({ ownerId: user.id, name: 'Elsewhere' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    // The face moved off `source` between the scan and this resolve. getScanFlaggedFacesForPersons only returns
    // faces STILL on the person, so f1 drops out of the flagged snapshot — but that snapshot is no longer a
    // gate for `unknown`.
    await db.updateTable('asset_face').set({ personId: elsewhere.personGroupId }).where('id', '=', f1).execute();

    const peopleBefore = await db
      .selectFrom('person')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('ownerId', '=', user.id)
      .executeTakeFirstOrThrow();

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [], unknown: [f1] },
      user.id,
    );

    expect(result.unknown).toBe(0);

    // No new person was created — the freshly created empty cluster was cleaned up, and the face is untouched
    // where it now lives.
    const peopleAfter = await db
      .selectFrom('person')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('ownerId', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(peopleAfter.count).toBe(peopleBefore.count);
    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(elsewhere.personGroupId);
    expect(await manualLinkFor(f1)).toHaveLength(0);
  });
});

describe('FaceRepairService.resolveFaces: unknown on a non-flagged face (E15 relaxed)', () => {
  // 1e: a genuine rest-of-cluster face (currently on `source`, never flagged) can be parked too.
  it('parks a non-flagged face into a new unnamed person with a manual link', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    const notFlagged = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [], unknown: [notFlagged] },
      user.id,
    );

    expect(result.unknown).toBe(1);
    const byId = await personIdsOf([notFlagged]);
    expect(byId[notFlagged]).not.toBeNull();
    expect(byId[notFlagged]).not.toBe(source.personGroupId);

    const cluster = await db
      .selectFrom('person')
      .select(['personGroupId', 'name'])
      .where('personGroupId', '=', byId[notFlagged]!)
      .executeTakeFirstOrThrow();
    expect(cluster.name).toBe('');

    const rows = await manualLinkFor(notFlagged);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('manual');
  });
});

describe('FaceRepairService.resolveFaces: unknown empties the source person (E15 relaxed)', () => {
  // 1f: parking EVERY one of source's faces empties it — a mix of one flagged and one non-flagged face,
  // so this only goes green once `unknown` is relaxed. Mirrors the moveToPerson M8/E6 cleanup, gated on
  // countAllFaces (not just countEligibleFaces) and on the source being unnamed.
  it('deletes the drained UNNAMED source person once every face (flagged + non-flagged) is parked', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    const notFlagged = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [], unknown: [f1, notFlagged] },
      user.id,
    );
    expect(result.unknown).toBe(2);

    const sourceRow = await db.selectFrom('person').select('id').where('personGroupId', '=', source.personGroupId).executeTakeFirst();
    expect(sourceRow).toBeUndefined();
  });

  it('keeps a drained NAMED source person after every face (flagged + non-flagged) is parked', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Jane Doe' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    const notFlagged = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [], unknown: [f1, notFlagged] },
      user.id,
    );
    expect(result.unknown).toBe(2);

    const sourceRow = await db
      .selectFrom('person')
      .select(['personGroupId', 'name'])
      .where('personGroupId', '=', source.personGroupId)
      .executeTakeFirst();
    expect(sourceRow).toBeDefined();
    expect(sourceRow?.name).toBe('Jane Doe');
  });
});

describe('FaceRepairService.resolveFaces: stay is the ONLY snapshot-gated bucket (E15 final shape)', () => {
  // 1g — regression/contrast: stay still throws on a non-flagged face, while lock/detach/unknown (all
  // relaxed by this slice, lock by slice 1) succeed on the very same shape of face. Pins the final gate
  // shape so a future refactor cannot silently re-widen it.
  it('rejects stay but accepts lock/detach/unknown for faces that were never flagged', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    const notFlaggedStay = await seedFace(ctx, user.id, source.personGroupId);
    const notFlaggedLock = await seedFace(ctx, user.id, source.personGroupId);
    const notFlaggedDetach = await seedFace(ctx, user.id, source.personGroupId);
    const notFlaggedUnknown = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    await expect(
      sut.resolveFaces(
        { personId: source.personGroupId, moveToPerson: [], stay: [notFlaggedStay], lock: [], detach: [], unknown: [] },
        user.id,
      ),
    ).rejects.toThrow(
      // Pinned WITH its reason code: the web client keys its translated banner off that code, so a rename
      // here without one there silently drops the admin back to English server text.
      new BadRequestException({
        message: 'Some faces are not in the flagged snapshot for this person',
        code: FaceRepairResolveErrorCode.FacesNotInSnapshot,
      }),
    );

    const lockResult = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [notFlaggedLock], detach: [], unknown: [] },
      user.id,
    );
    expect(lockResult.locked).toBe(1);

    const detachResult = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [notFlaggedDetach], unknown: [] },
      user.id,
    );
    expect(detachResult.detached).toBe(1);

    const unknownResult = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [], unknown: [notFlaggedUnknown] },
      user.id,
    );
    expect(unknownResult.unknown).toBe(1);
  });
});

describe('FaceRepairService.resolveFaces: the unknown cluster is usable on the People page', () => {
  it('gives the new cluster a representative face and queues its thumbnail', async () => {
    const { sut, ctx, scanRepo, jobMock } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [], unknown: [f1] },
      user.id,
    );

    const parked = await personIdsOf([f1]);
    const clusterId = parked[f1]!;

    // The entire point of parking a stranger is that someone can NAME them later. A cluster with no
    // representative face renders as a blank tile on the People page — findable in theory, useless in practice.
    const cluster = await db
      .selectFrom('person')
      .select('faceAssetId')
      .where('personGroupId', '=', clusterId)
      .executeTakeFirstOrThrow();
    expect(cluster.faceAssetId).toBe(f1);

    const queuedJobs = jobMock.queueAll.mock.calls.flatMap(([items]) => items);
    expect(queuedJobs).toEqual(
      expect.arrayContaining([{ name: JobName.PersonGenerateThumbnail, data: { id: clusterId } }]),
    );
  });
});

describe('FaceRepairService.resolveFaces: unknown combined with a move in one resolve', () => {
  it('routes each face to its own destination and counts moved and unknown separately', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: 'Paul' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
    const fMove = await seedFace(ctx, user.id, source.personGroupId);
    const fUnknown = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [
      { assetFaceId: fMove, suspectedOwnerId: ownerA.personGroupId },
      { assetFaceId: fUnknown, suspectedOwnerId: ownerA.personGroupId },
    ]);

    // The realistic mixed review: most faces really are Paul's, one is a friend nobody can name.
    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: ownerA.personGroupId, faceIds: [fMove], lock: false }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [fUnknown],
      },
      user.id,
    );

    // `moved` and `unknown` are deliberately disjoint counts — a parked face is not "moved to a person the admin
    // chose", and reporting it in both would double-count it in the apply summary.
    expect(result).toEqual({ moved: 1, declined: 0, locked: 0, detached: 0, unknown: 1, skipped: 0 });

    const byId = await personIdsOf([fMove, fUnknown]);
    expect(byId[fMove]).toBe(ownerA.personGroupId);
    expect(byId[fUnknown]).not.toBe(ownerA.personGroupId);
    expect(byId[fUnknown]).not.toBe(source.personGroupId);

    // The parked face IS locked to its new cluster — `unknown` deliberately writes a durable link so
    // recognition cannot pull the face straight back out. The plainly-moved face sent lock:false, so after
    // B2 it carries an ordinary placement instead and a later scan may still question it.
    expect(await manualLinkFor(fUnknown)).toHaveLength(1);
    expect(await manualLinkFor(fMove)).toHaveLength(0);
  });
});

describe('FaceRepairService.resolveFaces: a failed park leaves no orphan cluster', () => {
  it('removes the freshly created cluster when the move into it throws', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    // The cluster is created BEFORE the faces move into it. If the move blows up (dropped connection, etc.) the
    // nameless, faceless person must not be left stranded on the owner's People page — nothing else ever cleans
    // one up.
    const repairRepo = ctx.get(FaceRepairRepository);
    const reattribute = vi
      .spyOn(repairRepo, 'reattributeFaces')
      .mockRejectedValueOnce(new Error('connection terminated'));

    const peopleBefore = await db
      .selectFrom('person')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('ownerId', '=', user.id)
      .executeTakeFirstOrThrow();

    await expect(
      sut.resolveFaces(
        { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [], unknown: [f1] },
        user.id,
      ),
    ).rejects.toThrow('connection terminated');

    reattribute.mockRestore();

    const peopleAfter = await db
      .selectFrom('person')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('ownerId', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(peopleAfter.count).toBe(peopleBefore.count);

    // The face is untouched and still reviewable — the admin can simply retry.
    const afterFailure = await personIdsOf([f1]);
    expect(afterFailure[f1]).toBe(source.personGroupId);
  });
});

// ── C1: the console-drain check must ignore faces already settled (declined/locked) in a PRIOR resolve ──
// The review page only ever surfaces the decline/lock-filtered pending set, so on a later resolve the admin
// can only settle the still-visible faces. If the drain gate compared against the RAW flagged snapshot it
// would never fire for a person that was partially resolved across sessions, stranding it in the console.
describe('FaceRepairService.resolveFaces: draining ignores faces already settled in a prior resolve (C1)', () => {
  it('drains the person once every STILL-PENDING flagged face is settled, even though an earlier face was soft-stayed in a prior resolve', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: owner } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const a = await seedFace(ctx, user.id, source.personGroupId);
    const b = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [
      { assetFaceId: a, suspectedOwnerId: owner.personGroupId },
      { assetFaceId: b, suspectedOwnerId: owner.personGroupId },
    ]);

    // Resolve 1: soft-stay A only. B is still pending, so the person must NOT drain yet.
    await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [a], lock: [], detach: [], unknown: [] },
      user.id,
    );
    let latest = await scanRepo.getLatestScan();
    let snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).toContain(source.personGroupId);

    // Resolve 2: settle the only still-pending face B. A is filtered out of the review UI (declined in resolve
    // 1), so the admin never re-submits it — yet the person MUST now drain from the console.
    await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [b], lock: [], detach: [], unknown: [] },
      user.id,
    );
    latest = await scanRepo.getLatestScan();
    snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).not.toContain(source.personGroupId);
  });
});

// ── C7: a "keep here" (stay) whose scan-suggested owner was deleted/merged since the scan must not 500 ──
// The flagged-snapshot row stores suspectedOwnerId as a bare uuid (no person FK), so it survives a deleted
// owner; writing a decline against it would hit the decline table's real person FK (23503).
describe('FaceRepairService.resolveFaces: stay tolerates a suspected owner deleted since the scan (C7)', () => {
  it("does not 500 when a stayed face's scan-suggested owner was deleted after the scan; the face is kept and the person drains", async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: owner } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const a = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: a, suspectedOwnerId: owner.personGroupId }]);

    // The scan-suggested owner is deleted (e.g. merged away) before the admin resolves.
    await db.deleteFrom('person').where('personGroupId', '=', owner.personGroupId).execute();

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [a], lock: [], detach: [], unknown: [] },
      user.id,
    );

    // No 500: the dangling-owner stay is dropped from the decline write (declined: 0) but still settles the face.
    expect(result).toEqual({ moved: 0, declined: 0, locked: 0, detached: 0, unknown: 0, skipped: 0 });

    // The face is untouched (kept here) and the person drains from the console.
    const byId = await personIdsOf([a]);
    expect(byId[a]).toBe(source.personGroupId);
    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).not.toContain(source.personGroupId);
  });
});

// ── C2: moveToPerson pre-skip must be scoped to the requested destination, not "declined at all" ──
describe('FaceRepairService.resolveFaces: moveToPerson honors a face declined toward a DIFFERENT owner (C2)', () => {
  it('moves a previously soft-stayed face when the admin picks a DIFFERENT destination', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerO } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: ownerY } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Kept' });
    const a = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: a, suspectedOwnerId: ownerO.personGroupId }]);

    // Resolve 1: soft-stay A — declines the A→O pairing.
    await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [a], lock: [], detach: [], unknown: [] },
      user.id,
    );

    // Resolve 2: the admin changes their mind and moves A to a DIFFERENT person Y. This is a new pairing and
    // must be honored, not silently pre-skipped because A was declined toward O.
    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: ownerY.personGroupId, faceIds: [a], lock: false }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );
    expect(result.moved).toBe(1);
    expect(result.skipped).toBe(0);
    const byId = await personIdsOf([a]);
    expect(byId[a]).toBe(ownerY.personGroupId);
  });

  it('still skips a re-move toward the SAME owner the face was declined against (preserves "do not re-apply a declined pairing")', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerO } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Kept' });
    const a = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: a, suspectedOwnerId: ownerO.personGroupId }]);

    // Resolve 1: soft-stay A (declines A→O).
    await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [a], lock: [], detach: [], unknown: [] },
      user.id,
    );

    // Resolve 2: re-move A toward the SAME owner O it was declined against — skipped, A stays put.
    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: ownerO.personGroupId, faceIds: [a], lock: false }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );
    expect(result.moved).toBe(0);
    expect(result.skipped).toBe(1);
    const byId = await personIdsOf([a]);
    expect(byId[a]).toBe(source.personGroupId);
  });
});

// ── C6: executeRepair must never move a face across owners, even on a caller that skips resolveFaces's guard ──
describe('FaceRepairService.executeRepair: never moves a face across owners (C6)', () => {
  it('skips a route whose destination is owned by a different user, leaving the face untouched', async () => {
    const { sut, ctx } = setup();
    const { user: userA } = await ctx.newUser();
    const { user: userB } = await ctx.newUser();
    const { person: source } = await ctx.newPerson({ ownerId: userA.id, name: '' });
    const { person: foreign } = await ctx.newPerson({ ownerId: userB.id, name: '' });
    const a = await seedFace(ctx, userA.id, source.personGroupId);

    const result = await sut.executeRepair({
      toRepair: [{ assetFaceId: a, currentPersonId: source.personGroupId, suspectedOwnerId: foreign.personGroupId }],
      reviewOnlyFaces: [],
      reviewOnlyPersonIds: [],
      unAttributableFaces: [],
      perPerson: [],
    });

    expect(result.moved).toBe(0);
    expect(result.skipped).toBe(1);
    const byId = await personIdsOf([a]);
    expect(byId[a]).toBe(source.personGroupId);
  });
});

// ── C10: boundary — a resolve with no persisted scan treats moveToPerson faces as rest-of-cluster ──
describe('FaceRepairService.resolveFaces: boundary cases (C10)', () => {
  it('treats a moveToPerson face as a rest-of-cluster face when no scan has ever been persisted (latest is null)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: owner } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Named' });
    const a = await seedFace(ctx, user.id, source.personGroupId);

    // No seedFlaggedSnapshot — there is no persisted scan at all, so `stored` is [] and `flaggedIds` is empty.
    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: owner.personGroupId, faceIds: [a], lock: false }],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    expect(result.moved).toBe(1);
    const byId = await personIdsOf([a]);
    expect(byId[a]).toBe(owner.personGroupId);
  });
});

// ── Slice 7: cleanup resolve atomicity and duplicate-id safety (F12, F13, F14) ─────────────────────

const pendingRowsFor = (assetFaceIds: string[]) =>
  db
    .selectFrom('face_person_verdict')
    .select(['assetFaceId', 'status'])
    .where('assetFaceId', 'in', assetFaceIds)
    .where('status', '=', 'pending')
    .execute();

describe('FaceRepairService.resolveFaces: stay bucket is transactional (F12)', () => {
  it('rolls back the whole stay bucket when drainPendingForFaces throws — no verdict rows written, and the pending row is intact', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const verdictRepo = ctx.get(FacePersonVerdictRepository);
    // A pending suggestion row for f1, so the drain has something to remove — and so we can tell whether it
    // ran at all.
    await verdictRepo.upsertPending([{ personId: ownerA.personGroupId, assetFaceId: f1, distance: 0.4 }]);

    const drainSpy = vi.spyOn(verdictRepo, 'drainPendingForFaces').mockRejectedValueOnce(new Error('boom-stay'));

    await expect(
      sut.resolveFaces(
        { personId: source.personGroupId, moveToPerson: [], stay: [f1], lock: [], detach: [], unknown: [] },
        user.id,
      ),
    ).rejects.toThrow('boom-stay');

    drainSpy.mockRestore();

    // Absence: markRejectedMany's insert (which ran BEFORE the throwing drain, inside the same transaction)
    // was rolled back — no negative verdict row exists.
    const declineRows = await declineRowsFor(f1, ownerA.personGroupId);
    expect(declineRows).toHaveLength(0);
    // The pending row is untouched — the drain that would have removed it never committed either.
    const pending = await pendingRowsFor([f1]);
    expect(pending).toHaveLength(1);

    // Positive control, same call, no fault injection: the bucket really does write and drain when nothing
    // throws — proves the assertions above are not vacuously true for some unrelated reason (e.g. the face
    // being ineligible).
    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [f1], lock: [], detach: [], unknown: [] },
      user.id,
    );
    expect(result.declined).toBe(1);
    const declineRowsAfter = await declineRowsFor(f1, ownerA.personGroupId);
    expect(declineRowsAfter).toHaveLength(1);
    const pendingAfter = await pendingRowsFor([f1]);
    expect(pendingAfter).toHaveLength(0);
  });
});

describe('FaceRepairService.resolveFaces: stay bucket rollback spans every internal chunk (F12)', () => {
  it('rolls back ALL chunks of a stay bucket larger than one internal 1000-row chunk, not just the last one', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });

    // 2100 faces -> markRejectedMany's own internal chunk loop runs THREE 1000-row statements
    // (1000 + 1000 + 100) inside the one wrapping transaction before drainPendingForFaces below throws.
    const faceIds = await seedFacesBulk(ctx, user.id, source.personGroupId, 2100);
    await seedFlaggedSnapshot(
      scanRepo,
      user.id,
      source.personGroupId,
      faceIds.map((assetFaceId) => ({ assetFaceId, suspectedOwnerId: ownerA.personGroupId })),
    );

    const verdictRepo = ctx.get(FacePersonVerdictRepository);
    const drainSpy = vi.spyOn(verdictRepo, 'drainPendingForFaces').mockRejectedValueOnce(new Error('boom-mid-chunk'));

    await expect(
      sut.resolveFaces(
        { personId: source.personGroupId, moveToPerson: [], stay: faceIds, lock: [], detach: [], unknown: [] },
        user.id,
      ),
    ).rejects.toThrow('boom-mid-chunk');

    drainSpy.mockRestore();

    // If the transaction boundary were wrong — e.g. only the LAST internal chunk ran inside `trx` and the
    // earlier ones autocommitted directly against `this.db` (the pre-fix shape) — the first 2000 rows would
    // have survived. Assert exactly zero, not "2000 out of 2100".
    const rows = await db
      .selectFrom('face_person_verdict')
      .select('id')
      .where('personId', '=', ownerA.personGroupId)
      .where('status', 'in', ['rejected', 'ignored'])
      .execute();
    expect(rows).toHaveLength(0);

    // Positive control, same bucket, no fault injection: every one of the 2100 rows really does get written
    // across all three internal chunks when nothing throws.
    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: faceIds, lock: [], detach: [], unknown: [] },
      user.id,
    );
    expect(result.declined).toBe(2100);
    const rowsAfter = await db
      .selectFrom('face_person_verdict')
      .select('id')
      .where('personId', '=', ownerA.personGroupId)
      .where('status', 'in', ['rejected', 'ignored'])
      .execute();
    expect(rowsAfter).toHaveLength(2100);
  }, 30_000);
});

// S7.3 (pin): the happy path is unaffected by wrapping `stay` in a transaction — it still writes one negative
// per face against its OWN stored suspected owner (not the other face's), and drains every pending row for
// those faces. Allowed to pass on first run per the pin-test exception protocol (spec §2) — see "Pin evidence"
// in the final report for the mutate/red/revert/green cycle this test was put through.
describe('FaceRepairService.resolveFaces: stay happy path (S7.3 pin)', () => {
  it('writes one rejected verdict per face against its OWN stored suspected owner, and drains every pending row for those faces', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: ownerB } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    const f2 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [
      { assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId },
      { assetFaceId: f2, suspectedOwnerId: ownerB.personGroupId },
    ]);

    const verdictRepo = ctx.get(FacePersonVerdictRepository);
    await verdictRepo.upsertPending([
      { personId: ownerA.personGroupId, assetFaceId: f1, distance: 0.4 },
      { personId: ownerB.personGroupId, assetFaceId: f2, distance: 0.4 },
    ]);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [f1, f2], lock: [], detach: [], unknown: [] },
      user.id,
    );
    expect(result.declined).toBe(2);

    const rowsA = await declineRowsFor(f1, ownerA.personGroupId);
    expect(rowsA).toHaveLength(1);
    const rowsB = await declineRowsFor(f2, ownerB.personGroupId);
    expect(rowsB).toHaveLength(1);
    // Each face's OWN suspected owner, not the other one's — the cross combination must not exist.
    const cross = await declineRowsFor(f1, ownerB.personGroupId);
    expect(cross).toHaveLength(0);

    const pending = await pendingRowsFor([f1, f2]);
    expect(pending).toHaveLength(0);
  });
});

describe('FaceRepairService.resolveFaces: a face routed to two moveToPerson destinations is rejected (F14)', () => {
  it('throws BadRequestException when the same face appears in two different moveToPerson groups, and commits nothing', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: destQ } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: destR } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: destQ.personGroupId }]);

    await expect(
      sut.resolveFaces(
        {
          personId: source.personGroupId,
          moveToPerson: [
            { destinationPersonId: destQ.personGroupId, faceIds: [f1], lock: false },
            { destinationPersonId: destR.personGroupId, faceIds: [f1], lock: false },
          ],
          stay: [],
          lock: [],
          detach: [],
          unknown: [],
        },
        user.id,
      ),
    ).rejects.toThrow(new BadRequestException('A face cannot be resolved more than one way in the same request'));

    // Nothing committed: face untouched, no verdict written for either destination, no manual link, person
    // still in the scan snapshot.
    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(source.personGroupId);
    const rowsQ = await declineRowsFor(f1, destQ.personGroupId);
    expect(rowsQ).toHaveLength(0);
    const rowsR = await declineRowsFor(f1, destR.personGroupId);
    expect(rowsR).toHaveLength(0);
    const linked = await manualLinkFor(f1);
    expect(linked).toHaveLength(0);
    const latest = await scanRepo.getLatestScan();
    const snapshotPersonIds = ((latest!.persons as unknown as RepairScanPerson[]) ?? []).map((p) => p.personId);
    expect(snapshotPersonIds).toContain(source.personGroupId);
  });

  // Positive control for the case above: TWO distinct faces routed to TWO distinct destinations in the same
  // request are perfectly legitimate and must still succeed — proves the 400 above is genuinely about the
  // SAME face in two groups, not about having more than one moveToPerson group at all.
  it('does NOT reject two different faces routed to two different destinations in the same request', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: destQ } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: destR } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    const f2 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [
      { assetFaceId: f1, suspectedOwnerId: destQ.personGroupId },
      { assetFaceId: f2, suspectedOwnerId: destR.personGroupId },
    ]);

    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [
          { destinationPersonId: destQ.personGroupId, faceIds: [f1], lock: false },
          { destinationPersonId: destR.personGroupId, faceIds: [f2], lock: false },
        ],
        stay: [],
        lock: [],
        detach: [],
        unknown: [],
      },
      user.id,
    );
    expect(result.moved).toBe(2);
    const byId = await personIdsOf([f1, f2]);
    expect(byId[f1]).toBe(destQ.personGroupId);
    expect(byId[f2]).toBe(destR.personGroupId);
  });
});

describe('FaceRepairService.resolveFaces: duplicate id within a single lock bucket is absorbed (F13)', () => {
  it('succeeds when the same face id is repeated in the lock bucket, writing exactly one manual link and raising no 21000 error', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [f1, f1], detach: [], unknown: [] },
      user.id,
    );

    // H5: `locked` counts rows actually written (deduped, same as `moved`), not the raw requested-bucket
    // length — a duplicate id in the request still writes and is counted as exactly one lock.
    expect(result.locked).toBe(1);
    expect(result.moved).toBe(0);
    const rows = await manualLinkFor(f1);
    expect(rows).toHaveLength(1);
  });
});

describe('FaceRepairService.resolveFaces: combined move + stay + duplicated lock in one request (F12, F13)', () => {
  it('applies all three buckets; the move and the stay both commit, and the duplicated lock id writes one link', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: moveDest } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: stayOwner } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const fMove = await seedFace(ctx, user.id, source.personGroupId);
    const fStay = await seedFace(ctx, user.id, source.personGroupId);
    const fLock = await seedFace(ctx, user.id, source.personGroupId);

    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [
      { assetFaceId: fMove, suspectedOwnerId: moveDest.personGroupId },
      { assetFaceId: fStay, suspectedOwnerId: stayOwner.personGroupId },
      { assetFaceId: fLock, suspectedOwnerId: moveDest.personGroupId },
    ]);

    const result = await sut.resolveFaces(
      {
        personId: source.personGroupId,
        moveToPerson: [{ destinationPersonId: moveDest.personGroupId, faceIds: [fMove], lock: false }],
        stay: [fStay],
        lock: [fLock, fLock],
        detach: [],
        unknown: [],
      },
      user.id,
    );

    expect(result.moved).toBe(1);
    expect(result.declined).toBe(1);
    // H5: `locked` counts rows actually written (deduped), not the raw requested-bucket length — the
    // duplicated fLock id still writes and is counted as exactly one lock.
    expect(result.locked).toBe(1);

    const byId = await personIdsOf([fMove, fStay, fLock]);
    expect(byId[fMove]).toBe(moveDest.personGroupId);
    expect(byId[fStay]).toBe(source.personGroupId);
    expect(byId[fLock]).toBe(source.personGroupId);

    const declines = await declineRowsFor(fStay, stayOwner.personGroupId);
    expect(declines).toHaveLength(1);
    const lockRows = await manualLinkFor(fLock);
    expect(lockRows).toHaveLength(1);
  });
});

// S7.9 (pin): `lock` and `detach` were already transactional before this slice — unrelated to F12/F13/F14.
// Allowed to pass on first run per the pin-test exception protocol; see "Pin evidence" in the final report.
describe('FaceRepairService.resolveFaces: lock and detach remain transactional (S7.9 pin)', () => {
  it('rolls back the lock bucket entirely when drainPendingForFaces throws mid-transaction', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const verdictRepo = ctx.get(FacePersonVerdictRepository);
    const drainSpy = vi.spyOn(verdictRepo, 'drainPendingForFaces').mockRejectedValueOnce(new Error('boom-lock'));

    await expect(
      sut.resolveFaces(
        { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [f1], detach: [], unknown: [] },
        user.id,
      ),
    ).rejects.toThrow('boom-lock');

    drainSpy.mockRestore();

    const rows = await manualLinkFor(f1);
    expect(rows).toHaveLength(0);

    // Positive control, same request, no fault injection: it really does write the link.
    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [f1], detach: [], unknown: [] },
      user.id,
    );
    expect(result.locked).toBe(1);
    const rowsAfter = await manualLinkFor(f1);
    expect(rowsAfter).toHaveLength(1);
  });

  it('rolls back the detach bucket entirely when drainPendingForFaces throws mid-transaction', async () => {
    const { sut, ctx, scanRepo } = setup();
    const { user } = await ctx.newUser();
    const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const f1 = await seedFace(ctx, user.id, source.personGroupId);
    await seedFlaggedSnapshot(scanRepo, user.id, source.personGroupId, [{ assetFaceId: f1, suspectedOwnerId: ownerA.personGroupId }]);

    const verdictRepo = ctx.get(FacePersonVerdictRepository);
    const drainSpy = vi.spyOn(verdictRepo, 'drainPendingForFaces').mockRejectedValueOnce(new Error('boom-detach'));

    await expect(
      sut.resolveFaces(
        { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [f1], unknown: [] },
        user.id,
      ),
    ).rejects.toThrow('boom-detach');

    drainSpy.mockRestore();

    // Still on source, not detached — the update+delete pair rolled back together.
    const byId = await personIdsOf([f1]);
    expect(byId[f1]).toBe(source.personGroupId);

    // Positive control, same request, no fault injection: it really does detach.
    const result = await sut.resolveFaces(
      { personId: source.personGroupId, moveToPerson: [], stay: [], lock: [], detach: [f1], unknown: [] },
      user.id,
    );
    expect(result.detached).toBe(1);
    const byIdAfter = await personIdsOf([f1]);
    expect(byIdAfter[f1]).toBeNull();
  });
});
