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
  it('leaves every neighbouring person, pet and user intact', async () => {
    const repo = new FaceDissolveRepository(db);
    const f = await buildFixture();

    await repo.dissolve({
      personId: f.p1.id,
      scope: DissolveScope.All,
      outcome: 'delete-faces-and-person',
      redetect: true,
    });

    // L8 — the other user is untouched
    const p4Faces = await db.selectFrom('asset_face').select('id').where('personId', '=', f.p4.id).execute();
    expect(p4Faces.map((r) => r.id)).toEqual([f.p4Face.id]);

    // P2 keeps every face, including the one on the SHARED asset, and its embedding
    const p2Faces = await db.selectFrom('asset_face').select('id').where('personId', '=', f.p2.id).execute();
    expect(p2Faces.map((r) => r.id)).toEqual([f.p2Shared.id]);
    expect(
      await db.selectFrom('face_search').select('faceId').where('faceId', '=', f.p2Shared.id).execute(),
    ).toHaveLength(1);

    // L6 — the pet person and its faces survive
    expect(await db.selectFrom('asset_face').select('id').where('personId', '=', f.p3.id).execute()).toHaveLength(1);

    // L2 — the unrelated faceless person still exists: no library-wide cleanup ran
    expect(await db.selectFrom('person').select('id').where('id', '=', f.p5.id).execute()).toHaveLength(1);

    // the target is gone
    expect(await db.selectFrom('person').select('id').where('id', '=', f.p1.id).execute()).toEqual([]);
  });

  it('never deletes a space person it did not orphan (L1)', async () => {
    const repo = new FaceDissolveRepository(db);
    const f = await buildFixture();

    const space = mediumFactory.sharedSpaceInsert({ id: newUuid(), createdById: f.userA.id });
    await db.insertInto('shared_space').values(space).execute();

    const linkedId = newUuid();
    const preOrphanId = newUuid();
    await db
      .insertInto('shared_space_person')
      .values([
        { id: linkedId, spaceId: space.id, name: 'linked' },
        { id: preOrphanId, spaceId: space.id, name: 'pre-existing orphan' },
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
