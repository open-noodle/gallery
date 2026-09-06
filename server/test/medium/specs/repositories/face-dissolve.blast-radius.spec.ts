import { Kysely } from 'kysely';
import { SourceType } from 'src/enum';
import { FaceDissolveRepository } from 'src/repositories/face-dissolve.repository';
import { DB } from 'src/schema';
import { DissolveScope } from 'src/utils/face-dissolve';
import { mediumFactory } from 'test/medium.factory';
import { seedAsset, seedFace, seedPerson, seedUser } from 'test/medium/specs/repositories/face-dissolve.fixtures';
import { newUuid } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';
import { beforeAll, describe, expect, it } from 'vitest';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

/**
 * P1 target · P2 same user sharing an asset with P1 · P3 pet · P4 second user ·
 * P5 faceless (must survive — no library-wide cleanup).
 */
const buildFixture = async () => {
  const userA = await seedUser(db);
  const userB = await seedUser(db);

  const p1 = await seedPerson(db, { ownerId: userA.id, name: 'P1 target' });
  const p2 = await seedPerson(db, { ownerId: userA.id, name: 'P2 bystander' });
  const p3 = await seedPerson(db, { ownerId: userA.id, name: 'P3 pet', type: 'pet' });
  const p5 = await seedPerson(db, { ownerId: userA.id, name: 'P5 faceless' });
  const p4 = await seedPerson(db, { ownerId: userB.id, name: 'P4 other user' });

  const soloAsset = await seedAsset(db, { ownerId: userA.id });
  const p1Solo = await seedFace(db, { assetId: soloAsset.id, personId: p1.id, sourceType: SourceType.Exif });

  const sharedAsset = await seedAsset(db, { ownerId: userA.id });
  const p1Shared = await seedFace(db, { assetId: sharedAsset.id, personId: p1.id, sourceType: SourceType.Exif });
  const p2Shared = await seedFace(db, { assetId: sharedAsset.id, personId: p2.id, withEmbedding: true });

  const petAsset = await seedAsset(db, { ownerId: userA.id });
  await seedFace(db, { assetId: petAsset.id, personId: p3.id, isPet: true });

  const bAsset = await seedAsset(db, { ownerId: userB.id });
  const p4Face = await seedFace(db, { assetId: bAsset.id, personId: p4.id });

  return { userA, userB, p1, p2, p3, p4, p5, p1Solo, p1Shared, p2Shared, p4Face };
};

describe('dissolve blast radius', () => {
  // Each of the following is split into its own it() (rather than one big test with five
  // sequential assertions) so that one failing assertion cannot silently hide whether a LATER
  // one would have failed too — that coupling is exactly what hid the fact that the old combined
  // "pet person survives" assertion below was dead (see the dedicated L6 test further down).
  it('leaves the other user and their face untouched (L8)', async () => {
    const repo = new FaceDissolveRepository(db);
    const f = await buildFixture();

    await repo.dissolve({
      personId: f.p1.id,
      scope: DissolveScope.All,
      outcome: 'delete-faces-and-person',
      redetect: true,
    });

    const p4Faces = await db.selectFrom('asset_face').select('id').where('personId', '=', f.p4.id).execute();
    expect(p4Faces.map((r) => r.id)).toEqual([f.p4Face.id]);
  });

  it('leaves a same-owner bystander person untouched, including the face on the SHARED asset and its embedding', async () => {
    const repo = new FaceDissolveRepository(db);
    const f = await buildFixture();

    await repo.dissolve({
      personId: f.p1.id,
      scope: DissolveScope.All,
      outcome: 'delete-faces-and-person',
      redetect: true,
    });

    const p2Faces = await db.selectFrom('asset_face').select('id').where('personId', '=', f.p2.id).execute();
    expect(p2Faces.map((r) => r.id)).toEqual([f.p2Shared.id]);
    expect(
      await db.selectFrom('face_search').select('faceId').where('faceId', '=', f.p2Shared.id).execute(),
    ).toHaveLength(1);
  });

  // NOT an L6 test: P3's face already has personId = p3.id, so it is excluded by the personId
  // equality in `inScope` alone — dissolveScopePredicate's pet exclusion is never consulted for
  // it. This only proves the same "other person, same owner" guarantee as the bystander test
  // above, for a person that happens to be typed 'pet'. The real pet-exclusion proof is below.
  it('leaves an unrelated pet person untouched', async () => {
    const repo = new FaceDissolveRepository(db);
    const f = await buildFixture();

    await repo.dissolve({
      personId: f.p1.id,
      scope: DissolveScope.All,
      outcome: 'delete-faces-and-person',
      redetect: true,
    });

    expect(await db.selectFrom('asset_face').select('id').where('personId', '=', f.p3.id).execute()).toHaveLength(1);
  });

  // L6, actually exercised: a pet-tagged face (carries a pet_search row) whose personId IS the
  // target, so it is only excluded by dissolveScopePredicate's `notPet` term — the personId
  // equality alone would include it.
  it('spares a pet-tagged face even when it is owned by the target person itself (L6)', async () => {
    const repo = new FaceDissolveRepository(db);
    const f = await buildFixture();

    const petFace = await seedFace(db, { assetId: f.p1Solo.assetId, personId: f.p1.id, isPet: true });

    await repo.dissolve({
      personId: f.p1.id,
      scope: DissolveScope.All,
      outcome: 'delete-faces',
      redetect: false,
    });

    expect(await db.selectFrom('asset_face').select('id').where('id', '=', petFace.id).execute()).toHaveLength(1);
  });

  it('leaves the unrelated faceless person untouched — no library-wide cleanup ran (L2)', async () => {
    const repo = new FaceDissolveRepository(db);
    const f = await buildFixture();

    await repo.dissolve({
      personId: f.p1.id,
      scope: DissolveScope.All,
      outcome: 'delete-faces-and-person',
      redetect: true,
    });

    expect(await db.selectFrom('person').select('id').where('id', '=', f.p5.id).execute()).toHaveLength(1);
  });

  it('deletes the target person itself', async () => {
    const repo = new FaceDissolveRepository(db);
    const f = await buildFixture();

    await repo.dissolve({
      personId: f.p1.id,
      scope: DissolveScope.All,
      outcome: 'delete-faces-and-person',
      redetect: true,
    });

    expect(await db.selectFrom('person').select('id').where('id', '=', f.p1.id).execute()).toEqual([]);
  });

  it('never deletes a space person it did not orphan (L1)', async () => {
    const repo = new FaceDissolveRepository(db);
    const f = await buildFixture();

    const space = mediumFactory.sharedSpaceInsert({ createdById: f.userA.id });
    const insertedSpace = await db.insertInto('shared_space').values(space).returningAll().executeTakeFirstOrThrow();

    const linkedId = newUuid();
    const preOrphanId = newUuid();
    await db
      .insertInto('shared_space_person')
      .values([
        { id: linkedId, spaceId: insertedSpace.id, name: 'linked' },
        { id: preOrphanId, spaceId: insertedSpace.id, name: 'pre-existing orphan' },
      ])
      .execute();
    await db.insertInto('shared_space_person_face').values({ personId: linkedId, assetFaceId: f.p1Solo.id }).execute();

    await repo.dissolve({
      personId: f.p1.id,
      scope: DissolveScope.All,
      outcome: 'delete-faces',
      redetect: true,
    });

    expect(await db.selectFrom('shared_space_person').select('id').where('id', '=', linkedId).execute()).toEqual([]);
    // the one that was ALREADY orphaned before we ran must survive
    expect(
      await db.selectFrom('shared_space_person').select('id').where('id', '=', preOrphanId).execute(),
    ).toHaveLength(1);
  });

  it('does not strip a manual identity link belonging to another person (L4/L5)', async () => {
    const repo = new FaceDissolveRepository(db);
    const f = await buildFixture();

    const identityId = newUuid();
    await db.insertInto('face_identity').values({ id: identityId }).execute();
    await db
      .insertInto('face_identity_face')
      .values([
        { identityId, assetFaceId: f.p1Shared.id, source: 'ml' },
        { identityId, assetFaceId: f.p2Shared.id, source: 'manual' },
      ])
      .execute();

    await repo.dissolve({
      personId: f.p1.id,
      scope: DissolveScope.All,
      outcome: 'unassign',
      redetect: false,
    });

    // keying the delete by identityId instead of by our face ids would wipe P2's row
    const rows = await db
      .selectFrom('face_identity_face')
      .select(['assetFaceId', 'source'])
      .where('identityId', '=', identityId)
      .execute();
    expect(rows).toEqual([{ assetFaceId: f.p2Shared.id, source: 'manual' }]);

    // L5 — no global identity GC ran
    expect(await db.selectFrom('face_identity').select('id').where('id', '=', identityId).execute()).toHaveLength(1);
  });
});

describe('dissolve blast radius — deletedThumbnailPath (L7)', () => {
  it('returns the thumbnail path when the target person had one', async () => {
    const repo = new FaceDissolveRepository(db);
    const f = await buildFixture();

    await db.updateTable('person').set({ thumbnailPath: '/thumbs/p1.jpg' }).where('id', '=', f.p1.id).execute();

    const result = await repo.dissolve({
      personId: f.p1.id,
      scope: DissolveScope.All,
      outcome: 'delete-faces-and-person',
      redetect: false,
    });

    expect(result.deletedThumbnailPath).toBe('/thumbs/p1.jpg');
  });

  it('normalizes an empty thumbnail path to null instead of queuing a delete for it', async () => {
    const repo = new FaceDissolveRepository(db);
    const f = await buildFixture();

    await db.updateTable('person').set({ thumbnailPath: '' }).where('id', '=', f.p1.id).execute();

    const result = await repo.dissolve({
      personId: f.p1.id,
      scope: DissolveScope.All,
      outcome: 'delete-faces-and-person',
      redetect: false,
    });

    expect(result.deletedThumbnailPath).toBeNull();
  });
});
