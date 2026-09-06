import { Kysely, sql } from 'kysely';
import { SourceType } from 'src/enum';
import { AssetJobRepository } from 'src/repositories/asset-job.repository';
import { FaceDissolveRepository } from 'src/repositories/face-dissolve.repository';
import { DB } from 'src/schema';
import { DissolveScope } from 'src/utils/face-dissolve';
import {
  seedAsset,
  seedFace,
  seedPerson,
  seedUser,
  setFacesRecognizedAt,
} from 'test/medium/specs/repositories/face-dissolve.fixtures';
import { getKyselyDB } from 'test/utils';
import { beforeAll, describe, expect, it } from 'vitest';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

describe('FaceDissolveRepository.dissolve', () => {
  it('clears the watermark BEFORE deleting, so the assets are still findable', async () => {
    const repo = new FaceDissolveRepository(db);
    const assetJob = new AssetJobRepository(db);

    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: asset.id, personId: person.id, sourceType: SourceType.Exif });
    await setFacesRecognizedAt(db, asset.id, new Date());

    const result = await repo.dissolve({
      personId: person.id,
      scope: DissolveScope.Exif,
      outcome: 'delete-faces',
      redetect: true,
    });

    expect(result.faces).toBe(1);
    expect(result.assetsCleared).toBe(1);

    expect(await db.selectFrom('asset_face').select('id').where('personId', '=', person.id).execute()).toEqual([]);

    const ids: string[] = [];
    for await (const row of assetJob.streamForDetectFacesJob(false)) {
      ids.push(row.id);
    }
    // Reversing the two statements leaves the watermark set and this array empty.
    expect(ids).toEqual([asset.id]);
  });

  it('cascades to every dependent row and emits a sync tombstone', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });
    const face = await seedFace(db, { assetId: asset.id, personId: person.id, withEmbedding: true });
    await db.updateTable('person').set({ faceAssetId: face.id }).where('id', '=', person.id).execute();

    await repo.dissolve({
      personId: person.id,
      scope: DissolveScope.All,
      outcome: 'delete-faces',
      redetect: true,
    });

    expect(await db.selectFrom('face_search').select('faceId').where('faceId', '=', face.id).execute()).toEqual([]);

    const [row] = await db.selectFrom('person').select('faceAssetId').where('id', '=', person.id).execute();
    expect(row.faceAssetId).toBeNull();

    const audit = await db
      .selectFrom('asset_face_audit')
      .select('assetFaceId')
      .where('assetFaceId', '=', face.id)
      .execute();
    expect(audit).toHaveLength(1);
  });

  it('hard-deletes soft-deleted faces so re-detection can create a visible one (L12)', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });
    const tombstone = await seedFace(db, {
      assetId: asset.id,
      personId: person.id,
      sourceType: SourceType.Exif,
      deletedAt: new Date(),
    });

    await repo.dissolve({
      personId: person.id,
      scope: DissolveScope.Exif,
      outcome: 'delete-faces',
      redetect: true,
    });

    // A surviving tombstone would absorb the next detection's embedding and stay invisible.
    expect(await db.selectFrom('asset_face').select('id').where('id', '=', tombstone.id).execute()).toEqual([]);
  });

  it('does not hard-delete soft-deleted faces on unassign', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });
    const tombstone = await seedFace(db, {
      assetId: asset.id,
      personId: person.id,
      deletedAt: new Date(),
    });

    await repo.dissolve({
      personId: person.id,
      scope: DissolveScope.All,
      outcome: 'unassign',
      redetect: false,
    });

    const [row] = await db.selectFrom('asset_face').select(['id', 'personId']).where('id', '=', tombstone.id).execute();
    expect(row).toBeDefined();
    expect(row.personId).toBeNull();
  });

  it('touches nothing when aimed at an id that does not exist', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Bystander' });
    const asset = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: asset.id, personId: person.id });

    const result = await repo.dissolve({
      personId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      scope: DissolveScope.All,
      outcome: 'delete-faces-and-person',
      redetect: true,
    });

    expect(result.faces).toBe(0);
    expect(await db.selectFrom('asset_face').select('id').where('personId', '=', person.id).execute()).toHaveLength(1);
  });

  // L10 — the row the spec's matrix names and nobody wrote. It guards a live regression: dissolve() passes
  // `trx` into clearFacesRecognizedAt(personId, scope, trx). Drop that third argument and the UPDATE falls
  // back to `this.db`, running in its own autocommit outside the transaction — so a dissolve that rolls back
  // still leaves its assets re-queued for detection, with no face change to justify it. Verified: dropping
  // that argument fails THIS test and no other in the file.
  it('rolls back the watermark clear too when the dissolve fails partway', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });
    const face = await seedFace(db, { assetId: asset.id, personId: person.id, sourceType: SourceType.Exif });
    const watermark = new Date('2026-01-01T00:00:00.000Z');
    await setFacesRecognizedAt(db, asset.id, watermark);

    // Forces the failure at the LAST statement of the transaction — after the watermark clear AND after the
    // face delete — so a rollback has to undo both.
    await sql`
      CREATE FUNCTION dissolve_rollback_boom() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced dissolve failure'; END $$
    `.execute(db);
    await sql`
      CREATE TRIGGER dissolve_rollback_boom BEFORE DELETE ON person
      FOR EACH ROW EXECUTE FUNCTION dissolve_rollback_boom()
    `.execute(db);

    try {
      await expect(
        repo.dissolve({
          personId: person.id,
          scope: DissolveScope.Exif,
          outcome: 'delete-faces-and-person',
          redetect: true,
        }),
      ).rejects.toThrow(/forced dissolve failure/);
    } finally {
      await sql`DROP TRIGGER IF EXISTS dissolve_rollback_boom ON person`.execute(db);
      await sql`DROP FUNCTION IF EXISTS dissolve_rollback_boom()`.execute(db);
    }

    expect(await db.selectFrom('asset_face').select('id').where('id', '=', face.id).execute()).toHaveLength(1);
    expect(await db.selectFrom('person').select('id').where('id', '=', person.id).execute()).toHaveLength(1);

    const [status] = await db
      .selectFrom('asset_job_status')
      .select('facesRecognizedAt')
      .where('assetId', '=', asset.id)
      .execute();
    expect(status.facesRecognizedAt).toEqual(watermark);
  });
});
