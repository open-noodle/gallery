import { Kysely } from 'kysely';
import { AssetVisibility, SourceType } from 'src/enum';
import { FaceRepairScanRepository, RepairScanParams } from 'src/repositories/face-repair-scan.repository';
import { FaceRepairRepository } from 'src/repositories/face-repair.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

const PARAMS: RepairScanParams = {
  maxDistance: 0.5,
  minFaces: 3,
  voteWindow: 200,
  voteMargin: 2,
  maxAttributionDistance: 0.35,
  maxFlaggedFraction: 0.5,
  largeClusterThreshold: 50,
};

const EMBEDDING = '[' + Array.from({ length: 512 }, () => 1).join(',') + ']';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [FaceRepairScanRepository, FaceRepairRepository, PersonRepository],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(FaceRepairScanRepository) };
};

type Ctx = ReturnType<typeof setup>['ctx'];

const seedEligibleFace = async (ctx: Ctx, userId: string, personId: string): Promise<string> => {
  const { asset } = await ctx.newAsset({ ownerId: userId });
  const { assetFace } = await ctx.newAssetFace({
    assetId: asset.id,
    personGroupId: personId,
    sourceType: SourceType.MachineLearning,
  });
  await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: EMBEDDING }).execute();
  return assetFace.id;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

afterEach(async () => {
  // Reset any in-flight scans so the next test's createScan guard does not block.
  await defaultDatabase
    .updateTable('face_repair_scan')
    .set({ status: 'failed', finishedAt: new Date() })
    .where('status', 'in', ['pending', 'running'])
    .execute();
});

describe('FaceRepairScanRepository flagged faces', () => {
  it("writes and reads a scan's flagged faces for a person (E1)", async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });

    const f1 = await seedEligibleFace(ctx, user.id, person.personGroupId);
    const f2 = await seedEligibleFace(ctx, user.id, person.personGroupId);

    await sut.replaceScanFlaggedFaces(scan.id, [
      { assetFaceId: f1, personGroupId: person.personGroupId, suspectedOwnerId: owner.personGroupId },
      { assetFaceId: f2, personGroupId: person.personGroupId, suspectedOwnerId: owner.personGroupId },
    ]);

    const result = await sut.getScanFlaggedFaces(scan.id, person.personGroupId);
    expect(result.map((r) => r.assetFaceId).toSorted()).toEqual([f1, f2].toSorted());
    expect(result.every((r) => r.suspectedOwnerId === owner.personGroupId)).toBe(true);
  });

  it('excludes a flagged face that has moved off the person (E2)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const { person: other } = await ctx.newPerson({ ownerId: user.id });
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });

    const moved = await seedEligibleFace(ctx, user.id, person.personGroupId);
    const stay = await seedEligibleFace(ctx, user.id, person.personGroupId);
    await sut.replaceScanFlaggedFaces(scan.id, [
      { assetFaceId: moved, personGroupId: person.personGroupId, suspectedOwnerId: owner.personGroupId },
      { assetFaceId: stay, personGroupId: person.personGroupId, suspectedOwnerId: owner.personGroupId },
    ]);

    // simulate an apply: reassign `moved` to another person
    await ctx.database
      .updateTable('asset_face')
      .set({ personGroupId: other.personGroupId })
      .where('id', '=', moved)
      .execute();

    const result = await sut.getScanFlaggedFaces(scan.id, person.personGroupId);
    expect(result.map((r) => r.assetFaceId)).toEqual([stay]);
  });

  it('excludes non-visible / soft-deleted / asset-deleted / no-embedding faces (E5)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });

    const ok = await seedEligibleFace(ctx, user.id, person.personGroupId);

    // not-visible
    const { asset: a1 } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: notVisible } = await ctx.newAssetFace({
      assetId: a1.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
      isVisible: false,
    });
    await ctx.database.insertInto('face_search').values({ faceId: notVisible.id, embedding: EMBEDDING }).execute();

    // soft-deleted face
    const { asset: a2 } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: deletedFace } = await ctx.newAssetFace({
      assetId: a2.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database
      .updateTable('asset_face')
      .set({ deletedAt: new Date() })
      .where('id', '=', deletedFace.id)
      .execute();
    await ctx.database.insertInto('face_search').values({ faceId: deletedFace.id, embedding: EMBEDDING }).execute();

    // face with no face_search embedding
    const { asset: a3 } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: noEmbedding } = await ctx.newAssetFace({
      assetId: a3.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
    });

    await sut.replaceScanFlaggedFaces(scan.id, [
      { assetFaceId: ok, personGroupId: person.personGroupId, suspectedOwnerId: owner.personGroupId },
      { assetFaceId: notVisible.id, personGroupId: person.personGroupId, suspectedOwnerId: owner.personGroupId },
      { assetFaceId: deletedFace.id, personGroupId: person.personGroupId, suspectedOwnerId: owner.personGroupId },
      { assetFaceId: noEmbedding.id, personGroupId: person.personGroupId, suspectedOwnerId: owner.personGroupId },
    ]);

    const result = await sut.getScanFlaggedFaces(scan.id, person.personGroupId);
    expect(result.map((r) => r.assetFaceId)).toEqual([ok]);
  });

  it('scopes reads to (scanId, personId) (E11)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: p1 } = await ctx.newPerson({ ownerId: user.id });
    const { person: p2 } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });

    const f1 = await seedEligibleFace(ctx, user.id, p1.personGroupId);
    const f2 = await seedEligibleFace(ctx, user.id, p2.personGroupId);
    await sut.replaceScanFlaggedFaces(scan.id, [
      { assetFaceId: f1, personGroupId: p1.personGroupId, suspectedOwnerId: owner.personGroupId },
      { assetFaceId: f2, personGroupId: p2.personGroupId, suspectedOwnerId: owner.personGroupId },
    ]);

    const p1Rows = await sut.getScanFlaggedFaces(scan.id, p1.personGroupId);
    const p2Rows = await sut.getScanFlaggedFaces(scan.id, p2.personGroupId);
    expect(p1Rows.map((r) => r.assetFaceId)).toEqual([f1]);
    expect(p2Rows.map((r) => r.assetFaceId)).toEqual([f2]);
  });

  it("keeps a second scan's rows independent and cascade-deletes on scan delete (E7, E8)", async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });

    const scanA = await sut.createScan({ requestedBy: null, params: PARAMS });
    const fa = await seedEligibleFace(ctx, user.id, person.personGroupId);
    await sut.replaceScanFlaggedFaces(scanA.id, [
      { assetFaceId: fa, personGroupId: person.personGroupId, suspectedOwnerId: owner.personGroupId },
    ]);

    // cascade: deleting the scan row removes its flagged rows
    await ctx.database.deleteFrom('face_repair_scan').where('id', '=', scanA.id).execute();
    const remaining = await ctx.database
      .selectFrom('face_repair_scan_flagged_face')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('scanId', '=', scanA.id)
      .executeTakeFirstOrThrow();
    expect(Number(remaining.count)).toBe(0);

    // a fresh scan reads only its own rows
    const scanB = await sut.createScan({ requestedBy: null, params: PARAMS });
    const fb = await seedEligibleFace(ctx, user.id, person.personGroupId);
    await sut.replaceScanFlaggedFaces(scanB.id, [
      { assetFaceId: fb, personGroupId: person.personGroupId, suspectedOwnerId: owner.personGroupId },
    ]);
    const scanBRows = await sut.getScanFlaggedFaces(scanB.id, person.personGroupId);
    expect(scanBRows.map((r) => r.assetFaceId)).toEqual([fb]);
  });

  it('replaceScanFlaggedFaces is idempotent (re-write replaces prior rows for the scan)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });

    const f1 = await seedEligibleFace(ctx, user.id, person.personGroupId);
    const f2 = await seedEligibleFace(ctx, user.id, person.personGroupId);
    await sut.replaceScanFlaggedFaces(scan.id, [
      { assetFaceId: f1, personGroupId: person.personGroupId, suspectedOwnerId: owner.personGroupId },
    ]);
    await sut.replaceScanFlaggedFaces(scan.id, [
      { assetFaceId: f2, personGroupId: person.personGroupId, suspectedOwnerId: owner.personGroupId },
    ]);

    const rows = await sut.getScanFlaggedFaces(scan.id, person.personGroupId);
    expect(rows.map((r) => r.assetFaceId)).toEqual([f2]);
  });

  // Slice 1, found by the cross-engine e2e: the flagged list is a PERSISTED snapshot, so the scan's own
  // eligibility filter is not enough — an asset moved into the Locked folder after the scan flagged its face
  // would otherwise still have its crop rendered by the admin console, and the apply path would act on it.
  // Both snapshot reads now carry reviewableAssetVisibility.
  it('drops a face whose asset was locked AFTER the scan flagged it, keeping an unlocked control', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });

    const control = await seedEligibleFace(ctx, user.id, person.personGroupId);
    const lockedLater = await seedEligibleFace(ctx, user.id, person.personGroupId);
    await sut.replaceScanFlaggedFaces(scan.id, [
      { assetFaceId: control, personGroupId: person.personGroupId, suspectedOwnerId: owner.personGroupId },
      { assetFaceId: lockedLater, personGroupId: person.personGroupId, suspectedOwnerId: owner.personGroupId },
    ]);

    // Both are flagged while both assets are ordinary — the positive control for the exclusion below.
    const before = await sut.getScanFlaggedFaces(scan.id, person.personGroupId);
    expect(before.map((r) => r.assetFaceId).sort()).toEqual([control, lockedLater].sort());

    await ctx.database
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Locked })
      .where('id', '=', ctx.database.selectFrom('asset_face').select('assetId').where('id', '=', lockedLater))
      .execute();

    const after = await sut.getScanFlaggedFaces(scan.id, person.personGroupId);
    expect(after.map((r) => r.assetFaceId)).toEqual([control]);

    // The apply path reads the same snapshot through the multi-person variant and must agree, or a resolve
    // could still write against a locked-asset face.
    const forApply = await sut.getScanFlaggedFacesForPersons(scan.id, [person.personGroupId]);
    expect(forApply.map((r) => r.assetFaceId)).toEqual([control]);
  });

  // #1061: mirrors face-repair.repository.spec.ts T5.1 — the console needs the same photo context out of
  // getScanFlaggedFaces (the single-person snapshot read) as it does out of getClusterFacePage.
  it('T5.2: returns the photo context alongside each flagged face', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });

    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
      boundingBoxX1: 10,
      boundingBoxY1: 20,
      boundingBoxX2: 30,
      boundingBoxY2: 40,
      imageWidth: 400,
      imageHeight: 300,
    });
    await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: EMBEDDING }).execute();

    await sut.replaceScanFlaggedFaces(scan.id, [
      { assetFaceId: assetFace.id, personId: person.id, suspectedOwnerId: owner.id },
    ]);

    const result = await sut.getScanFlaggedFaces(scan.id, person.id);

    expect(result).toEqual([
      expect.objectContaining({
        assetFaceId: assetFace.id,
        suspectedOwnerId: owner.id,
        boundingBoxX1: 10,
        boundingBoxY1: 20,
        boundingBoxX2: 30,
        boundingBoxY2: 40,
        imageWidth: 400,
        imageHeight: 300,
      }),
    ]);
    expect(result[0].localDateTime).toBeInstanceOf(Date);
  });
});
