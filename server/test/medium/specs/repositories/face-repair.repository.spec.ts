import { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { AssetVisibility, SourceType } from 'src/enum';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FaceRepairRepository } from 'src/repositories/face-repair.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { mediumFactory, newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [FaceRepairRepository, PersonRepository, FaceIdentityRepository],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(FaceRepairRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

type Ctx = ReturnType<typeof setup>['ctx'];

const EMBEDDING = '[' + Array.from({ length: 512 }, () => 1).join(',') + ']';

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

// Bulk equivalent of seedEligibleFace, for S10.3 (F20): getClusterFacePage's excludeFaceIds now goes up to
// MAX_RESOLVE_FACES (25 000). Bulk-inserted (not one newAsset/newAssetFace round trip per face, matching
// the seedFacesBulk idiom in face-repair.resolve.spec.ts) so seeding 25 000 real eligible faces stays fast.
const seedEligibleFacesBulk = async (ctx: Ctx, ownerId: string, personId: string, count: number): Promise<string[]> => {
  const assets = Array.from({ length: count }, () => mediumFactory.assetInsert({ ownerId }));
  for (let index = 0; index < assets.length; index += 1000) {
    await ctx.database
      .insertInto('asset')
      .values(assets.slice(index, index + 1000))
      .execute();
  }
  const faces = assets.map((asset) =>
    mediumFactory.assetFaceInsert({
      assetId: asset.id,
      personGroupId: personId,
      sourceType: SourceType.MachineLearning,
    }),
  );
  for (let index = 0; index < faces.length; index += 1000) {
    await ctx.database
      .insertInto('asset_face')
      .values(faces.slice(index, index + 1000))
      .execute();
  }
  const searchRows = faces.map((face) => ({ faceId: face.id, embedding: EMBEDDING }));
  for (let index = 0; index < searchRows.length; index += 1000) {
    await ctx.database
      .insertInto('face_search')
      .values(searchRows.slice(index, index + 1000))
      .execute();
  }
  return faces.map((face) => face.id);
};

describe('FaceRepairRepository.streamEligibleFaces', () => {
  it('yields ML-sourced, visible, assigned, embedded, non-deleted faces', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    // eligible face 1
    const { asset: asset1 } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: face1 } = await ctx.newAssetFace({
      assetId: asset1.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
    });
    const embedding1 = '[' + Array.from({ length: 512 }, () => 1).join(',') + ']';
    await ctx.database.insertInto('face_search').values({ faceId: face1.id, embedding: embedding1 }).execute();

    // eligible face 2
    const { asset: asset2 } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: face2 } = await ctx.newAssetFace({
      assetId: asset2.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
    });
    const embedding2 = '[' + Array.from({ length: 512 }, () => 0.5).join(',') + ']';
    await ctx.database.insertInto('face_search').values({ faceId: face2.id, embedding: embedding2 }).execute();

    // skipped: manual-sourced face
    const { asset: asset3 } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: manualFace } = await ctx.newAssetFace({
      assetId: asset3.id,
      personGroupId: person.personGroupId,
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
      personGroupId: person.personGroupId,
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
      personGroupId: person.personGroupId,
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
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
      isVisible: false,
    });
    await ctx.database.insertInto('face_search').values({ faceId: notVisibleFace.id, embedding: embedding1 }).execute();

    // skipped: face with no face_search row
    const { asset: asset7 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAssetFace({
      assetId: asset7.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
    });

    // skipped: face on a soft-deleted asset
    const { asset: deletedAsset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceOnDeletedAsset } = await ctx.newAssetFace({
      assetId: deletedAsset.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database
      .insertInto('face_search')
      .values({ faceId: faceOnDeletedAsset.id, embedding: embedding1 })
      .execute();
    await ctx.softDeleteAsset(deletedAsset.id);

    const results: { assetFaceId: string; personGroupId: string; ownerId: string; embedding: string }[] =
      await Array.fromAsync(sut.streamEligibleFaces({ ownerId: user.id }));

    const resultIds = results.map((r) => r.assetFaceId).toSorted();
    expect(resultIds).toEqual([face1.id, face2.id].toSorted());

    for (const row of results) {
      expect(row.personGroupId).toBe(person.personGroupId);
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
      personGroupId: personA.personGroupId,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database.insertInto('face_search').values({ faceId: faceA.id, embedding }).execute();

    const { asset: assetB } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceB } = await ctx.newAssetFace({
      assetId: assetB.id,
      personGroupId: personB.personGroupId,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database.insertInto('face_search').values({ faceId: faceB.id, embedding }).execute();

    const results: string[] = [];
    for await (const row of sut.streamEligibleFaces({ personGroupId: personA.personGroupId })) {
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
      personGroupId: person.personGroupId,
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

  // Slice 1 (F1): a Locked-folder face must never reach the cleanup console's feed.
  it('S1.6: skips a face on a locked asset and yields a control face on a timeline asset', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
    const { assetFace: lockedFace } = await ctx.newAssetFace({
      assetId: lockedAsset.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database.insertInto('face_search').values({ faceId: lockedFace.id, embedding: EMBEDDING }).execute();

    const timelineFaceId = await seedEligibleFace(ctx, user.id, person.personGroupId);

    const results: string[] = [];
    for await (const row of sut.streamEligibleFaces({ personGroupId: person.personGroupId })) {
      results.push(row.assetFaceId);
    }

    expect(results).toContain(timelineFaceId); // positive control
    expect(results).not.toContain(lockedFace.id);
  });
});

describe('FaceRepairRepository.reattributeFaces', () => {
  it('moves requested faces still on the source person to the destination and returns their ids', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });

    const { asset: assetA } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceA } = await ctx.newAssetFace({ assetId: assetA.id, personGroupId: person.personGroupId });

    const { asset: assetB } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceB } = await ctx.newAssetFace({ assetId: assetB.id, personGroupId: person.personGroupId });

    const { asset: assetC } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceC } = await ctx.newAssetFace({ assetId: assetC.id, personGroupId: person.personGroupId });

    const moved = await sut.reattributeFaces(person.personGroupId, owner.personGroupId, [faceA.id, faceB.id]);

    expect(moved.toSorted()).toEqual([faceA.id, faceB.id].toSorted());

    const rows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personGroupId'])
      .where('id', 'in', [faceA.id, faceB.id, faceC.id])
      .execute();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.personGroupId]));
    expect(byId[faceA.id]).toBe(owner.personGroupId);
    expect(byId[faceB.id]).toBe(owner.personGroupId);
    expect(byId[faceC.id]).toBe(person.personGroupId);
  });

  it('eligibility re-check: skips faces already moved off the source person', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: personP } = await ctx.newPerson({ ownerId: user.id });
    const { person: personQ } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });

    // face x is on person Q at apply time (simulates concurrent move)
    const { asset: assetX } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceX } = await ctx.newAssetFace({ assetId: assetX.id, personGroupId: personQ.personGroupId });

    const moved = await sut.reattributeFaces(personP.personGroupId, owner.personGroupId, [faceX.id]);

    expect(moved).toHaveLength(0);
    const row = await ctx.database
      .selectFrom('asset_face')
      .select('personGroupId')
      .where('id', '=', faceX.id)
      .executeTakeFirstOrThrow();
    expect(row.personGroupId).toBe(personQ.personGroupId);
  });

  it('eligibility re-check: does not move manual-sourced faces', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });

    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: manualFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personGroupId: person.personGroupId,
    });
    await ctx.database
      .updateTable('asset_face')
      .set({ sourceType: 'manual' as SourceType })
      .where('id', '=', manualFace.id)
      .execute();

    const moved = await sut.reattributeFaces(person.personGroupId, owner.personGroupId, [manualFace.id]);

    expect(moved).toHaveLength(0);
    const row = await ctx.database
      .selectFrom('asset_face')
      .select('personGroupId')
      .where('id', '=', manualFace.id)
      .executeTakeFirstOrThrow();
    expect(row.personGroupId).toBe(person.personGroupId);
  });
});

describe('FaceRepairRepository.detachFaces', () => {
  it('nulls personId for requested faces still on the person and deletes their identity link', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const { asset: assetA } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceA } = await ctx.newAssetFace({
      assetId: assetA.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
    });
    const { asset: assetB } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceB } = await ctx.newAssetFace({
      assetId: assetB.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
    });

    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const identity = await faceIdentityRepo.ensurePersonIdentity(person.personGroupId);
    await faceIdentityRepo.linkFace({ assetFaceId: faceA.id, identityId: identity.id, source: 'backfill' });

    const detached = await sut.detachFaces(person.personGroupId, [faceA.id]);

    expect(detached).toEqual([faceA.id]);

    const rows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personGroupId'])
      .where('id', 'in', [faceA.id, faceB.id])
      .execute();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.personGroupId]));
    expect(byId[faceA.id]).toBeNull();
    expect(byId[faceB.id]).toBe(person.personGroupId); // untouched — not requested

    const identityRows = await ctx.database
      .selectFrom('face_identity_face')
      .select('assetFaceId')
      .where('assetFaceId', '=', faceA.id)
      .execute();
    expect(identityRows).toHaveLength(0);
  });

  it('eligibility re-check: skips a face already moved off the source person', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: personP } = await ctx.newPerson({ ownerId: user.id });
    const { person: personQ } = await ctx.newPerson({ ownerId: user.id });

    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: face } = await ctx.newAssetFace({
      assetId: asset.id,
      personGroupId: personQ.personGroupId,
      sourceType: SourceType.MachineLearning,
    });

    const detached = await sut.detachFaces(personP.personGroupId, [face.id]);

    expect(detached).toHaveLength(0);
    const row = await ctx.database
      .selectFrom('asset_face')
      .select('personGroupId')
      .where('id', '=', face.id)
      .executeTakeFirstOrThrow();
    expect(row.personGroupId).toBe(personQ.personGroupId);
  });

  it('eligibility re-check: does not detach manual-sourced faces', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: manualFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personGroupId: person.personGroupId,
    });
    await ctx.database
      .updateTable('asset_face')
      .set({ sourceType: 'manual' as SourceType })
      .where('id', '=', manualFace.id)
      .execute();

    const detached = await sut.detachFaces(person.personGroupId, [manualFace.id]);

    expect(detached).toHaveLength(0);
    const row = await ctx.database
      .selectFrom('asset_face')
      .select('personGroupId')
      .where('id', '=', manualFace.id)
      .executeTakeFirstOrThrow();
    expect(row.personGroupId).toBe(person.personGroupId);
  });

  it('returns an empty array and does nothing when assetFaceIds is empty', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const detached = await sut.detachFaces(person.personGroupId, []);

    expect(detached).toEqual([]);
  });
});

describe('FaceRepairRepository.reconcileRepresentativeFaces', () => {
  it('repoints faceAssetId when the current rep face has been unassigned', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const { asset: assetA } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceA } = await ctx.newAssetFace({ assetId: assetA.id, personGroupId: person.personGroupId });

    const { asset: assetB } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceB } = await ctx.newAssetFace({ assetId: assetB.id, personGroupId: person.personGroupId });

    // Set faceA as rep
    await ctx.database
      .updateTable('person')
      .set({ faceAssetId: faceA.id })
      .where('personGroupId', '=', person.personGroupId)
      .execute();

    // Unassign faceA (simulating what unassignFacesFromPerson does)
    await ctx.database.updateTable('asset_face').set({ personGroupId: null }).where('id', '=', faceA.id).execute();

    await sut.reconcileRepresentativeFaces([person.personGroupId]);

    const updated = await ctx.database
      .selectFrom('person')
      .select('faceAssetId')
      .where('personGroupId', '=', person.personGroupId)
      .executeTakeFirstOrThrow();
    // faceA is unassigned so faceB should now be the rep
    expect(updated.faceAssetId).toBe(faceB.id);
  });

  it("leaves faceAssetId unchanged when it still points to one of the person's faces", async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const { asset: assetA } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceA } = await ctx.newAssetFace({ assetId: assetA.id, personGroupId: person.personGroupId });

    await ctx.database
      .updateTable('person')
      .set({ faceAssetId: faceA.id })
      .where('personGroupId', '=', person.personGroupId)
      .execute();

    await sut.reconcileRepresentativeFaces([person.personGroupId]);

    const updated = await ctx.database
      .selectFrom('person')
      .select('faceAssetId')
      .where('personGroupId', '=', person.personGroupId)
      .executeTakeFirstOrThrow();
    expect(updated.faceAssetId).toBe(faceA.id);
  });
});

describe('FaceRepairRepository.getClusterFacePage', () => {
  it('returns only eligible same-person faces, minus excludeFaceIds, with a correct total', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: other } = await ctx.newPerson({ ownerId: user.id });

    // 4 eligible faces on `person`
    const eligible = [
      await seedEligibleFace(ctx, user.id, person.personGroupId),
      await seedEligibleFace(ctx, user.id, person.personGroupId),
      await seedEligibleFace(ctx, user.id, person.personGroupId),
      await seedEligibleFace(ctx, user.id, person.personGroupId),
    ];

    // exclude two of them (the "flagged" ids the client already holds)
    const excludeFaceIds = [eligible[0], eligible[1]];
    const remaining = [eligible[2], eligible[3]];

    // skip: eligible face on a DIFFERENT person
    await seedEligibleFace(ctx, user.id, other.personGroupId);

    // skip: manual-sourced face on `person`
    const { asset: am } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: manualFace } = await ctx.newAssetFace({ assetId: am.id, personGroupId: person.personGroupId });
    await ctx.database
      .updateTable('asset_face')
      .set({ sourceType: 'manual' as SourceType })
      .where('id', '=', manualFace.id)
      .execute();
    await ctx.database.insertInto('face_search').values({ faceId: manualFace.id, embedding: EMBEDDING }).execute();

    // skip: not-visible face on `person`
    const { asset: anv } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: notVisible } = await ctx.newAssetFace({
      assetId: anv.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
      isVisible: false,
    });
    await ctx.database.insertInto('face_search').values({ faceId: notVisible.id, embedding: EMBEDDING }).execute();

    // skip: soft-deleted face on `person`
    const { asset: ad } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: deletedFace } = await ctx.newAssetFace({
      assetId: ad.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database
      .updateTable('asset_face')
      .set({ deletedAt: new Date() })
      .where('id', '=', deletedFace.id)
      .execute();
    await ctx.database.insertInto('face_search').values({ faceId: deletedFace.id, embedding: EMBEDDING }).execute();

    // skip: face on a soft-deleted asset
    const { asset: deletedAsset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceOnDeletedAsset } = await ctx.newAssetFace({
      assetId: deletedAsset.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database
      .insertInto('face_search')
      .values({ faceId: faceOnDeletedAsset.id, embedding: EMBEDDING })
      .execute();
    await ctx.softDeleteAsset(deletedAsset.id);

    // skip: face with NO face_search row (mirrors streamEligibleFaces' inner join)
    const { asset: anofs } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAssetFace({
      assetId: anofs.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
    });

    const page = await sut.getClusterFacePage(person.personGroupId, { excludeFaceIds, limit: 50, offset: 0 });

    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(false);
    expect(page.faces.map((f) => f.assetFaceId).toSorted()).toEqual(remaining.toSorted());
  });

  it('paginates with a stable order: disjoint pages whose union is the full filtered set', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const ids = [
      await seedEligibleFace(ctx, user.id, person.personGroupId),
      await seedEligibleFace(ctx, user.id, person.personGroupId),
      await seedEligibleFace(ctx, user.id, person.personGroupId),
      await seedEligibleFace(ctx, user.id, person.personGroupId),
      await seedEligibleFace(ctx, user.id, person.personGroupId),
    ];

    const page0 = await sut.getClusterFacePage(person.personGroupId, { excludeFaceIds: [], limit: 2, offset: 0 });
    const page1 = await sut.getClusterFacePage(person.personGroupId, { excludeFaceIds: [], limit: 2, offset: 2 });
    const page2 = await sut.getClusterFacePage(person.personGroupId, { excludeFaceIds: [], limit: 2, offset: 4 });

    expect(page0.total).toBe(5);
    expect(page0.faces).toHaveLength(2);
    expect(page0.hasMore).toBe(true);

    expect(page1.faces).toHaveLength(2);
    expect(page1.hasMore).toBe(true);

    expect(page2.faces).toHaveLength(1);
    expect(page2.hasMore).toBe(false);

    const union = [...page0.faces, ...page1.faces, ...page2.faces].map((f) => f.assetFaceId);
    expect(new Set(union).size).toBe(5); // pages are disjoint
    expect(union.toSorted()).toEqual(ids.toSorted()); // union = full filtered set
  });

  it('applies excludeFaceIds before pagination so total/hasMore stay correct across a page boundary', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const ids = [
      await seedEligibleFace(ctx, user.id, person.personGroupId),
      await seedEligibleFace(ctx, user.id, person.personGroupId),
      await seedEligibleFace(ctx, user.id, person.personGroupId),
      await seedEligibleFace(ctx, user.id, person.personGroupId),
      await seedEligibleFace(ctx, user.id, person.personGroupId),
    ];
    const excludeFaceIds = [ids[0], ids[1]]; // filtered set = 3

    const page0 = await sut.getClusterFacePage(person.personGroupId, { excludeFaceIds, limit: 2, offset: 0 });
    const page1 = await sut.getClusterFacePage(person.personGroupId, { excludeFaceIds, limit: 2, offset: 2 });

    expect(page0.total).toBe(3);
    expect(page0.faces).toHaveLength(2);
    expect(page0.hasMore).toBe(true);

    expect(page1.total).toBe(3);
    expect(page1.faces).toHaveLength(1);
    expect(page1.hasMore).toBe(false);

    const union = [...page0.faces, ...page1.faces].map((f) => f.assetFaceId);
    expect(union).not.toContain(ids[0]);
    expect(union).not.toContain(ids[1]);
    expect(union.toSorted()).toEqual([ids[2], ids[3], ids[4]].toSorted());
  });

  it('returns an empty page (total 0, hasMore false) when every visible face is excluded', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const a = await seedEligibleFace(ctx, user.id, person.personGroupId);
    const b = await seedEligibleFace(ctx, user.id, person.personGroupId);

    const page = await sut.getClusterFacePage(person.personGroupId, { excludeFaceIds: [a, b], limit: 50, offset: 0 });

    expect(page.total).toBe(0);
    expect(page.faces).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  // Slice 1 (F1): getClusterFacePage's own docstring claims it "mirrors streamEligibleFaces' filter
  // exactly" — a Locked face must be excluded from both the list and the total.
  it('S1.8: omits a locked-asset face from both the faces list and the total, with a timeline control included', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const timelineFaceId = await seedEligibleFace(ctx, user.id, person.personGroupId);

    const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
    const { assetFace: lockedFace } = await ctx.newAssetFace({
      assetId: lockedAsset.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database.insertInto('face_search').values({ faceId: lockedFace.id, embedding: EMBEDDING }).execute();

    const page = await sut.getClusterFacePage(person.personGroupId, { excludeFaceIds: [], limit: 50, offset: 0 });

    expect(page.total).toBe(1);
    expect(page.faces.map((f) => f.assetFaceId)).toContain(timelineFaceId); // positive control
    expect(page.faces.map((f) => f.assetFaceId)).not.toContain(lockedFace.id);
  });

  // S10.3 (F20): excludeFaceIds is capped at MAX_RESOLVE_FACES (25 000) by the DTO. Unlike the three write
  // paths above, getClusterFacePage's `NOT IN` is deliberately left as a SINGLE unchunked clause — chunking
  // a NOT IN needs an AND across chunks (excluded from every chunk), not an OR, so it is not a drop-in
  // reuse of the IN-chunking idiom. At the 25 000 cap, one NOT IN clause plus the query's handful of other
  // predicates stays at ~25 010 bind parameters, comfortably under Postgres's 65 535 ceiling — so no
  // chunking is needed here. This exercises that exact worst case with a REAL 25 000-row table (not just
  // parameter count) and proves NOT IN excludes precisely the requested ids, not more and not fewer. Note:
  // `base` is built once and executed twice (count, then page) — those are two independent round trips,
  // each with its own bind-parameter budget, not one combined statement.
  it('S10.3: completes a count+page pair with a 25 000-id excludeFaceIds list (single NOT IN, no bind-parameter error), excluding precisely the requested ids', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const allIds = await seedEligibleFacesBulk(ctx, user.id, person.personGroupId, 25_000);
    const [kept, ...rest] = allIds;
    // 24 999 real ids + 1 synthetic filler id = exactly the 25 000-id cap the DTO now enforces.
    const excludeFaceIds = [...rest, randomUUID()];

    const page = await sut.getClusterFacePage(person.personGroupId, { excludeFaceIds, limit: 50, offset: 0 });

    expect(page.total).toBe(1);
    expect(page.faces.map((f) => f.assetFaceId)).toEqual([kept]); // positive control: the one non-excluded face
    // Seeding 25 000 rows and running the count+page pair measures ~4.3s on an idle machine, against
    // vitest's 5s default — so a loaded CI runner times out (it did). This is a correctness test about
    // bind-parameter limits and exact exclusion, not a latency budget, so give it room rather than
    // shrinking the fixture, which would stop exercising the worst case it exists for.
  }, 60_000);

  // #1061: the console needs enough of the source photo to judge a face in context. getClusterFacePage
  // already inner-joins asset, so this is a free column set on a query that already runs.
  it('T5.1: returns the photo context alongside each face id', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    const { assetFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
      boundingBoxX1: 10,
      boundingBoxY1: 20,
      boundingBoxX2: 30,
      boundingBoxY2: 40,
      imageWidth: 400,
      imageHeight: 300,
    });
    // getClusterFacePage INNER JOINs face_search, so a face without an embedding row never appears. There is
    // no ctx.newFaceSearch helper — this direct insert with the file's existing EMBEDDING const (defined at
    // face-repair.repository.spec.ts:30) is the idiom every other test in this file uses.
    await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: EMBEDDING }).execute();

    const page = await sut.getClusterFacePage(person.personGroupId, { excludeFaceIds: [], limit: 10, offset: 0 });

    expect(page.faces).toEqual([
      expect.objectContaining({
        assetFaceId: assetFace.id,
        boundingBoxX1: 10,
        boundingBoxY1: 20,
        boundingBoxX2: 30,
        boundingBoxY2: 40,
        imageWidth: 400,
        imageHeight: 300,
      }),
    ]);
    expect(page.faces[0].localDateTime).toBeInstanceOf(Date);
  });

  it('T5.3 (pin): a face on a trashed asset is still absent from the page', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    const { assetFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
    });
    // getClusterFacePage INNER JOINs face_search, so a face without an embedding row never appears. There is
    // no ctx.newFaceSearch helper — this direct insert with the file's existing EMBEDDING const (defined at
    // face-repair.repository.spec.ts:30) is the idiom every other test in this file uses.
    await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: EMBEDDING }).execute();
    await ctx.database.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', asset.id).execute();

    const page = await sut.getClusterFacePage(person.personGroupId, { excludeFaceIds: [], limit: 10, offset: 0 });

    expect(page.faces).toEqual([]);
  });
});

describe('FaceRepairRepository.getEligibleFacePage / countEligibleFaces / countAllFaces (Slice 1, S1.7)', () => {
  // S1.7: a person with 1 Timeline + 1 Locked assigned face reports `1` from getEligibleFacePage and
  // countEligibleFaces (the Locked face is not reviewable), but countAllFaces reports `2` — it
  // deliberately counts every remaining face of the person regardless of visibility, because it is the
  // delete gate for an emptied manual-move source (A2): narrowing it would let a person be deleted while
  // Locked-asset faces still point at it, orphaning them via asset_face.personId's ON DELETE SET NULL.
  // countAllFaces must NOT gain the reviewableAssetVisibility predicate — see the Slice 1 plan's
  // correction to the spec.
  it('S1.7: getEligibleFacePage and countEligibleFaces report 1 (locked excluded); countAllFaces reports 2 (locked included)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const timelineFaceId = await seedEligibleFace(ctx, user.id, person.personGroupId);

    const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
    const { assetFace: lockedFace } = await ctx.newAssetFace({
      assetId: lockedAsset.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database.insertInto('face_search').values({ faceId: lockedFace.id, embedding: EMBEDDING }).execute();

    const page = await sut.getEligibleFacePage({ personGroupId: person.personGroupId, limit: 50 });
    expect(page.map((row) => row.assetFaceId)).toContain(timelineFaceId); // positive control
    expect(page.map((row) => row.assetFaceId)).not.toContain(lockedFace.id);
    expect(page).toHaveLength(1);

    await expect(sut.countEligibleFaces({ personGroupId: person.personGroupId })).resolves.toBe(1);

    // countAllFaces counts BOTH faces — this is the A2 guard, not a bug. It must not change with this slice.
    await expect(sut.countAllFaces(person.personGroupId)).resolves.toBe(2);
  });
});

describe('FaceRepairRepository.getEligibleFaceIdsForPerson (Slice 1, S1.9)', () => {
  it('S1.9: omits a locked-asset face id, so a lock bucket naming it is refused rather than silently manual-linking a locked crop', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const timelineFaceId = await seedEligibleFace(ctx, user.id, person.personGroupId);

    const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
    const { assetFace: lockedFace } = await ctx.newAssetFace({
      assetId: lockedAsset.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database.insertInto('face_search').values({ faceId: lockedFace.id, embedding: EMBEDDING }).execute();

    const eligible = await sut.getEligibleFaceIdsForPerson(person.personGroupId, [timelineFaceId, lockedFace.id]);

    expect(eligible.has(timelineFaceId)).toBe(true); // positive control
    expect(eligible.has(lockedFace.id)).toBe(false);
  });
});
