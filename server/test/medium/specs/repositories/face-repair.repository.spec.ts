import { Kysely } from 'kysely';
import { AssetVisibility, SourceType } from 'src/enum';
import { FaceRepairRepository } from 'src/repositories/face-repair.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [FaceRepairRepository, PersonRepository],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(FaceRepairRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('FaceRepairRepository.streamEligibleFaces', () => {
  it('yields ML-sourced, visible, assigned, embedded, non-deleted faces', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    // eligible face 1
    const { asset: asset1 } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: face1 } = await ctx.newAssetFace({
      assetId: asset1.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });
    const embedding1 = '[' + Array.from({ length: 512 }, () => 1).join(',') + ']';
    await ctx.database.insertInto('face_search').values({ faceId: face1.id, embedding: embedding1 }).execute();

    // eligible face 2
    const { asset: asset2 } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: face2 } = await ctx.newAssetFace({
      assetId: asset2.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });
    const embedding2 = '[' + Array.from({ length: 512 }, () => 0.5).join(',') + ']';
    await ctx.database.insertInto('face_search').values({ faceId: face2.id, embedding: embedding2 }).execute();

    // skipped: manual-sourced face
    const { asset: asset3 } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: manualFace } = await ctx.newAssetFace({
      assetId: asset3.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning, // will be overridden below
    });
    await ctx.database
      .updateTable('asset_face')
      .set({ sourceType: 'manual' as SourceType })
      .where('id', '=', manualFace.id)
      .execute();
    await ctx.database.insertInto('face_search').values({ faceId: manualFace.id, embedding: embedding1 }).execute();

    // skipped: exif-sourced face
    const { asset: asset4 } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: exifFace } = await ctx.newAssetFace({
      assetId: asset4.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database
      .updateTable('asset_face')
      .set({ sourceType: 'exif' as SourceType })
      .where('id', '=', exifFace.id)
      .execute();
    await ctx.database.insertInto('face_search').values({ faceId: exifFace.id, embedding: embedding1 }).execute();

    // skipped: soft-deleted face
    const { asset: asset5 } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: deletedFace } = await ctx.newAssetFace({
      assetId: asset5.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database
      .updateTable('asset_face')
      .set({ deletedAt: new Date() })
      .where('id', '=', deletedFace.id)
      .execute();
    await ctx.database.insertInto('face_search').values({ faceId: deletedFace.id, embedding: embedding1 }).execute();

    // skipped: not-visible face
    const { asset: asset6 } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: notVisibleFace } = await ctx.newAssetFace({
      assetId: asset6.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
      isVisible: false,
    });
    await ctx.database.insertInto('face_search').values({ faceId: notVisibleFace.id, embedding: embedding1 }).execute();

    // skipped: face with no face_search row
    const { asset: asset7 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAssetFace({
      assetId: asset7.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });

    // skipped: face on a soft-deleted asset
    const { asset: deletedAsset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceOnDeletedAsset } = await ctx.newAssetFace({
      assetId: deletedAsset.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database
      .insertInto('face_search')
      .values({ faceId: faceOnDeletedAsset.id, embedding: embedding1 })
      .execute();
    await ctx.softDeleteAsset(deletedAsset.id);

    const results: { assetFaceId: string; personId: string; ownerId: string; embedding: string }[] = await Array.fromAsync(sut.streamEligibleFaces({ ownerId: user.id }));

    const resultIds = results.map((r) => r.assetFaceId).toSorted();
    expect(resultIds).toEqual([face1.id, face2.id].toSorted());

    for (const row of results) {
      expect(row.personId).toBe(person.id);
      expect(row.ownerId).toBe(user.id);
      expect(typeof row.embedding).toBe('string');
    }
  });

  it('filters by personId when provided', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: personA } = await ctx.newPerson({ ownerId: user.id });
    const { person: personB } = await ctx.newPerson({ ownerId: user.id });
    const embedding = '[' + Array.from({ length: 512 }, () => 1).join(',') + ']';

    const { asset: assetA } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceA } = await ctx.newAssetFace({
      assetId: assetA.id,
      personId: personA.id,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database.insertInto('face_search').values({ faceId: faceA.id, embedding }).execute();

    const { asset: assetB } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceB } = await ctx.newAssetFace({
      assetId: assetB.id,
      personId: personB.id,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database.insertInto('face_search').values({ faceId: faceB.id, embedding }).execute();

    const results: string[] = [];
    for await (const row of sut.streamEligibleFaces({ personId: personA.id })) {
      results.push(row.assetFaceId);
    }

    expect(results).toContain(faceA.id);
    expect(results).not.toContain(faceB.id);
  });

  // Non-Timeline (e.g. Archive) faces are intentionally eligible: they may be left unassigned
  // after repair if recognition cannot re-home them, which is the accepted outcome (blank > wrong).
  it('includes ML-sourced faces on non-Timeline assets (Archive visibility) — intentionally eligible', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const embedding = '[' + Array.from({ length: 512 }, () => 1).join(',') + ']';

    // Archive-visibility asset: face should still be returned by streamEligibleFaces
    const { asset: archiveAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
    const { assetFace: archiveFace } = await ctx.newAssetFace({
      assetId: archiveAsset.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database.insertInto('face_search').values({ faceId: archiveFace.id, embedding }).execute();

    const results: string[] = [];
    for await (const row of sut.streamEligibleFaces({ ownerId: user.id })) {
      results.push(row.assetFaceId);
    }

    // Archive-visibility face IS returned (non-Timeline assets are eligible)
    expect(results).toContain(archiveFace.id);
  });
});

describe('FaceRepairRepository.unassignFacesFromPerson', () => {
  it('sets personId to NULL for requested faces still on that person and returns their ids', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const { asset: assetA } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceA } = await ctx.newAssetFace({ assetId: assetA.id, personId: person.id });

    const { asset: assetB } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceB } = await ctx.newAssetFace({ assetId: assetB.id, personId: person.id });

    const { asset: assetC } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceC } = await ctx.newAssetFace({ assetId: assetC.id, personId: person.id });

    const unassigned = await sut.unassignFacesFromPerson(person.id, [faceA.id, faceB.id]);

    expect(unassigned.toSorted()).toEqual([faceA.id, faceB.id].toSorted());

    const rows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personId'])
      .where('id', 'in', [faceA.id, faceB.id, faceC.id])
      .execute();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.personId]));
    expect(byId[faceA.id]).toBeNull();
    expect(byId[faceB.id]).toBeNull();
    expect(byId[faceC.id]).toBe(person.id);
  });

  it('eligibility re-check: skips faces already moved to another person', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: personP } = await ctx.newPerson({ ownerId: user.id });
    const { person: personQ } = await ctx.newPerson({ ownerId: user.id });

    // face x is on person Q at unassign time (simulates concurrent move)
    const { asset: assetX } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceX } = await ctx.newAssetFace({ assetId: assetX.id, personId: personQ.id });

    const unassigned = await sut.unassignFacesFromPerson(personP.id, [faceX.id]);

    expect(unassigned).toHaveLength(0);
    const row = await ctx.database
      .selectFrom('asset_face')
      .select('personId')
      .where('id', '=', faceX.id)
      .executeTakeFirstOrThrow();
    expect(row.personId).toBe(personQ.id);
  });

  it('eligibility re-check: does not unassign manual-sourced faces', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: manualFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
    await ctx.database
      .updateTable('asset_face')
      .set({ sourceType: 'manual' as SourceType })
      .where('id', '=', manualFace.id)
      .execute();

    const unassigned = await sut.unassignFacesFromPerson(person.id, [manualFace.id]);

    expect(unassigned).toHaveLength(0);
    const row = await ctx.database
      .selectFrom('asset_face')
      .select('personId')
      .where('id', '=', manualFace.id)
      .executeTakeFirstOrThrow();
    expect(row.personId).toBe(person.id);
  });
});

describe('FaceRepairRepository.reconcileRepresentativeFaces', () => {
  it('repoints faceAssetId when the current rep face has been unassigned', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const { asset: assetA } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceA } = await ctx.newAssetFace({ assetId: assetA.id, personId: person.id });

    const { asset: assetB } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceB } = await ctx.newAssetFace({ assetId: assetB.id, personId: person.id });

    // Set faceA as rep
    await ctx.database.updateTable('person').set({ faceAssetId: faceA.id }).where('id', '=', person.id).execute();

    // Unassign faceA (simulating what unassignFacesFromPerson does)
    await ctx.database.updateTable('asset_face').set({ personId: null }).where('id', '=', faceA.id).execute();

    await sut.reconcileRepresentativeFaces([person.id]);

    const updated = await ctx.database
      .selectFrom('person')
      .select('faceAssetId')
      .where('id', '=', person.id)
      .executeTakeFirstOrThrow();
    // faceA is unassigned so faceB should now be the rep
    expect(updated.faceAssetId).toBe(faceB.id);
  });

  it("leaves faceAssetId unchanged when it still points to one of the person's faces", async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const { asset: assetA } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceA } = await ctx.newAssetFace({ assetId: assetA.id, personId: person.id });

    await ctx.database.updateTable('person').set({ faceAssetId: faceA.id }).where('id', '=', person.id).execute();

    await sut.reconcileRepresentativeFaces([person.id]);

    const updated = await ctx.database
      .selectFrom('person')
      .select('faceAssetId')
      .where('id', '=', person.id)
      .executeTakeFirstOrThrow();
    expect(updated.faceAssetId).toBe(faceA.id);
  });
});
