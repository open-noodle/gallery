import { Kysely, sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { SourceType } from 'src/enum.js';
import { FaceDissolveRepository } from 'src/gallery/repositories/face-dissolve.repository.js';
import { DissolveScope } from 'src/gallery/utils/face-dissolve.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { DB } from 'src/schema/index.js';
import {
  runDissolve,
  seedAsset,
  seedFace,
  seedPerson,
  seedUser,
  setFacesRecognizedAt,
} from 'test/medium/specs/repositories/face-dissolve.fixtures.js';
import { mediumFactory } from 'test/medium.factory.js';
import { newUuid } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

const faceRow = (id: string) =>
  db
    .selectFrom('asset_face')
    .select(['id', 'personGroupId', 'deletedAt', 'isVisible'])
    .where('id', '=', id)
    .executeTakeFirst();

const identityRows = (id: string) =>
  db.selectFrom('face_identity_face').select('assetFaceId').where('assetFaceId', '=', id).execute();

const linkIdentity = async (assetFaceId: string, source: 'ml' | 'manual' = 'ml') => {
  const identityId = newUuid();
  await db.insertInto('face_identity').values({ id: identityId }).execute();
  await db.insertInto('face_identity_face').values({ identityId, assetFaceId, source }).execute();
};

const personExists = async (personGroupId: string) => {
  const row = await db
    .selectFrom('person')
    .select('personGroupId')
    .where('personGroupId', '=', personGroupId)
    .executeTakeFirst();
  return row !== undefined;
};

const detectQueue = async () => {
  const ids: string[] = [];
  for await (const row of new AssetJobRepository(db).streamForDetectFacesJob(false)) {
    ids.push(row.id);
  }
  return ids;
};

describe('FaceDissolveRepository.dissolve', () => {
  it('hides detected faces, keeps their embedding, and records them for restore', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Cluster A' });
    const asset = await seedAsset(db, { ownerId: user.id });
    const face = await seedFace(db, { assetId: asset.id, personGroupId: person.personGroupId, withEmbedding: true });
    await linkIdentity(face.id);

    const result = await runDissolve(db, repo, person.personGroupId, DissolveScope.All);

    const row = await faceRow(face.id);
    expect(row?.personGroupId).toBeNull();
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(await identityRows(face.id)).toEqual([]);
    // The tombstone keeps its embedding, so a restore needs no re-detection.
    expect(await db.selectFrom('face_search').select('faceId').where('faceId', '=', face.id).execute()).toHaveLength(1);

    expect(result.hiddenFaceIds).toEqual([face.id]);
    const record = await db
      .selectFrom('face_dissolve')
      .selectAll()
      .where('id', '=', result.dissolveId!)
      .executeTakeFirstOrThrow();
    expect(record).toMatchObject({
      ownerId: user.id,
      actorId: user.id,
      personGroupId: person.personGroupId,
      personName: 'Cluster A',
      scope: 'all',
      hiddenCount: 1,
      deletedCount: 0,
      unassignedCount: 0,
      restoredAt: null,
    });
    expect(
      await db.selectFrom('face_dissolve_face').select('assetFaceId').where('dissolveId', '=', record.id).execute(),
    ).toEqual([{ assetFaceId: face.id }]);
  });

  it('deletes imported faces and re-queues only their photos', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const exifAsset = await seedAsset(db, { ownerId: user.id });
    const mlAsset = await seedAsset(db, { ownerId: user.id });
    const exif = await seedFace(db, {
      assetId: exifAsset.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.Exif,
    });
    await seedFace(db, { assetId: mlAsset.id, personGroupId: person.personGroupId, withEmbedding: true });
    await setFacesRecognizedAt(db, exifAsset.id, new Date());
    await setFacesRecognizedAt(db, mlAsset.id, new Date());

    const result = await runDissolve(db, repo, person.personGroupId, DissolveScope.All);

    expect(result).toMatchObject({ deleted: 1, assetsCleared: 1 });
    expect(await faceRow(exif.id)).toBeUndefined();
    // Deletion still reaches mobile clients.
    expect(
      await db.selectFrom('asset_face_audit').select('assetFaceId').where('assetFaceId', '=', exif.id).execute(),
    ).toHaveLength(1);
    const queued = await detectQueue();
    expect(queued).toContain(exifAsset.id);
    expect(queued).not.toContain(mlAsset.id);
  });

  it('hard-deletes soft-deleted imported faces so re-detection can create a visible one (L12)', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });
    const tombstone = await seedFace(db, {
      assetId: asset.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.Exif,
      deletedAt: new Date(),
    });

    await runDissolve(db, repo, person.personGroupId, DissolveScope.Exif);

    expect(await faceRow(tombstone.id)).toBeUndefined();
  });

  it('unassigns hand-drawn and manual faces and keeps them on the photo', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const editor = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });
    const manual = await seedFace(db, {
      assetId: asset.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.Manual,
    });
    const drawn = await seedFace(db, {
      assetId: asset.id,
      personGroupId: person.personGroupId,
      withEmbedding: true,
      createdBy: editor.id,
    });
    await linkIdentity(manual.id, 'manual');
    await linkIdentity(drawn.id, 'manual');

    const result = await runDissolve(db, repo, person.personGroupId, DissolveScope.All);

    expect(result).toMatchObject({ unassigned: 2, hiddenFaceIds: [], deleted: 0 });
    for (const id of [manual.id, drawn.id]) {
      expect(await faceRow(id)).toMatchObject({ personGroupId: null, deletedAt: null });
      expect(await identityRows(id)).toEqual([]);
    }
  });

  it('removes the person when nothing is left on it', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: asset.id, personGroupId: person.personGroupId, withEmbedding: true });

    const result = await runDissolve(db, repo, person.personGroupId, DissolveScope.All);

    expect(result.personRemoved).toBe(true);
    expect(await personExists(person.personGroupId)).toBe(false);
  });

  it('keeps the person when faces outside the scope remain', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: asset.id, personGroupId: person.personGroupId, sourceType: SourceType.Exif });
    const kept = await seedFace(db, { assetId: asset.id, personGroupId: person.personGroupId, withEmbedding: true });

    const result = await runDissolve(db, repo, person.personGroupId, DissolveScope.Exif);

    expect(result.personRemoved).toBe(false);
    expect(await personExists(person.personGroupId)).toBe(true);
    expect(await faceRow(kept.id)).toMatchObject({ personGroupId: person.personGroupId, deletedAt: null });
  });

  it('clears faces that were already hidden, removes the person, and records nothing to restore', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });
    const hidden = await seedFace(db, {
      assetId: asset.id,
      personGroupId: person.personGroupId,
      withEmbedding: true,
      deletedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await runDissolve(db, repo, person.personGroupId, DissolveScope.All);

    expect(result.hiddenFaceIds).toEqual([]);
    expect(result.personRemoved).toBe(true);
    expect(await faceRow(hidden.id)).toMatchObject({
      personGroupId: null,
      deletedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(
      await db.selectFrom('face_dissolve_face').select('assetFaceId').where('assetFaceId', '=', hidden.id).execute(),
    ).toEqual([]);
  });

  it('hides crop-hidden detected faces like the rest', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });
    const cropped = await seedFace(db, {
      assetId: asset.id,
      personGroupId: person.personGroupId,
      withEmbedding: true,
      isVisible: false,
    });

    const result = await runDissolve(db, repo, person.personGroupId, DissolveScope.All);

    expect(result.hiddenFaceIds).toEqual([cropped.id]);
    const row = await faceRow(cropped.id);
    expect(row).toMatchObject({ personGroupId: null, isVisible: false });
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it('records 2500 faces in one dissolve', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Big' });
    const asset = await seedAsset(db, { ownerId: user.id });
    const faces = Array.from({ length: 2500 }, () =>
      mediumFactory.assetFaceInsert({ assetId: asset.id, personGroupId: person.personGroupId }),
    );
    for (let index = 0; index < faces.length; index += 500) {
      await db
        .insertInto('asset_face')
        .values(faces.slice(index, index + 500))
        .execute();
    }

    const result = await runDissolve(db, repo, person.personGroupId, DissolveScope.All);

    expect(result.hiddenFaceIds).toHaveLength(2500);
    const [{ count }] = await db
      .selectFrom('face_dissolve_face')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('dissolveId', '=', result.dissolveId!)
      .execute();
    expect(Number(count)).toBe(2500);
  });

  it('touches nothing and records nothing when aimed at an id that does not exist', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Bystander' });
    const asset = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: asset.id, personGroupId: person.personGroupId });

    const result = await runDissolve(db, repo, 'ffffffff-ffff-4fff-8fff-ffffffffffff', DissolveScope.All);

    expect(result).toMatchObject({ dissolveId: null, hiddenFaceIds: [], deleted: 0, unassigned: 0 });
    expect(
      await db.selectFrom('asset_face').select('id').where('personGroupId', '=', person.personGroupId).execute(),
    ).toHaveLength(1);
  });

  // L10. The failure is forced at the LAST statement (the record insert), so a rollback has to undo the watermark
  // clear, the hide, the delete and the person removal. Dropping `trx` from any inner call moves that statement
  // outside the transaction and fails this test.
  it('rolls everything back when the dissolve fails partway', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });
    const exif = await seedFace(db, {
      assetId: asset.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.Exif,
    });
    const ml = await seedFace(db, { assetId: asset.id, personGroupId: person.personGroupId, withEmbedding: true });
    const watermark = new Date('2026-01-01T00:00:00.000Z');
    await setFacesRecognizedAt(db, asset.id, watermark);

    await sql`
      CREATE FUNCTION dissolve_rollback_boom() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced dissolve failure'; END $$
    `.execute(db);
    await sql`
      CREATE TRIGGER dissolve_rollback_boom BEFORE INSERT ON face_dissolve
      FOR EACH ROW EXECUTE FUNCTION dissolve_rollback_boom()
    `.execute(db);

    try {
      await expect(runDissolve(db, repo, person.personGroupId, DissolveScope.All)).rejects.toThrow(
        /forced dissolve failure/,
      );
    } finally {
      await sql`DROP TRIGGER IF EXISTS dissolve_rollback_boom ON face_dissolve`.execute(db);
      await sql`DROP FUNCTION IF EXISTS dissolve_rollback_boom()`.execute(db);
    }

    expect(await faceRow(exif.id)).toMatchObject({ personGroupId: person.personGroupId });
    expect(await faceRow(ml.id)).toMatchObject({ personGroupId: person.personGroupId, deletedAt: null });
    expect(await personExists(person.personGroupId)).toBe(true);
    const [status] = await db
      .selectFrom('asset_job_status')
      .select('facesRecognizedAt')
      .where('assetId', '=', asset.id)
      .execute();
    expect(status.facesRecognizedAt).toEqual(watermark);
  });

  it('leaves an out-of-scope hand-drawn face entirely alone', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: asset.id, personGroupId: person.personGroupId, sourceType: SourceType.Exif });
    const handDrawn = await seedFace(db, {
      assetId: asset.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.Manual,
      createdBy: user.id,
    });

    const result = await runDissolve(db, repo, person.personGroupId, DissolveScope.Exif);

    expect(result).toMatchObject({ deleted: 1, unassigned: 0 });
    expect(await faceRow(handDrawn.id)).toMatchObject({ personGroupId: person.personGroupId });
  });
});
