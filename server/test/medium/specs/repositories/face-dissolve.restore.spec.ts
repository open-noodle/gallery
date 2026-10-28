import { Kysely } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { FaceDissolveRepository } from 'src/gallery/repositories/face-dissolve.repository.js';
import { DissolveScope } from 'src/gallery/utils/face-dissolve.js';
import { FaceRepairRepository } from 'src/repositories/face-repair.repository.js';
import { DB } from 'src/schema/index.js';
import {
  runDissolve,
  seedAsset,
  seedFace,
  seedPerson,
  seedUser,
} from 'test/medium/specs/repositories/face-dissolve.fixtures.js';
import { getKyselyDB } from 'test/utils.js';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

const faceRow = (id: string) =>
  db.selectFrom('asset_face').select(['id', 'personGroupId', 'deletedAt']).where('id', '=', id).executeTakeFirst();

const restore = (repo: FaceDissolveRepository, dissolveId: string) =>
  db.transaction().execute((trx) => repo.restore(dissolveId, trx));

/** A junk person with `count` detected faces on one photo, dissolved. */
const seedDissolved = async (repo: FaceDissolveRepository, count: number) => {
  const user = await seedUser(db);
  const person = await seedPerson(db, { ownerId: user.id, name: 'Junk' });
  const asset = await seedAsset(db, { ownerId: user.id });
  const faces = [];
  for (let index = 0; index < count; index++) {
    faces.push(await seedFace(db, { assetId: asset.id, personGroupId: person.personGroupId, withEmbedding: true }));
  }
  const result = await runDissolve(db, repo, person.personGroupId, DissolveScope.All);
  return { user, person, asset, faces, dissolveId: result.dissolveId! };
};

describe('FaceDissolveRepository.restore', () => {
  it('un-hides exactly the recorded faces, unassigned, and stamps the record', async () => {
    const repo = new FaceDissolveRepository(db);
    const { faces, dissolveId } = await seedDissolved(repo, 2);

    await expect(restore(repo, dissolveId)).resolves.toEqual({ restored: 2, skipped: 0 });

    for (const face of faces) {
      expect(await faceRow(face.id)).toEqual({ id: face.id, personGroupId: null, deletedAt: null });
    }
    const record = await db
      .selectFrom('face_dissolve')
      .select('restoredAt')
      .where('id', '=', dissolveId)
      .executeTakeFirstOrThrow();
    expect(record.restoredAt).toBeInstanceOf(Date);
  });

  it('leaves a face hidden by the console "Not a face" action alone', async () => {
    const repo = new FaceDissolveRepository(db);
    const { user, asset, dissolveId } = await seedDissolved(repo, 1);
    const other = await seedPerson(db, { ownerId: user.id, name: 'Other' });
    const notAFace = await seedFace(db, { assetId: asset.id, personGroupId: other.personGroupId, withEmbedding: true });
    await new FaceRepairRepository(db).detachFaces(other.personGroupId, [notAFace.id]);

    await restore(repo, dissolveId);

    const row = await faceRow(notAFace.id);
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it('skips a recorded face that was hard-deleted since, and still restores one on a trashed photo', async () => {
    const repo = new FaceDissolveRepository(db);
    const { asset, faces, dissolveId } = await seedDissolved(repo, 2);
    await db.deleteFrom('asset_face').where('id', '=', faces[0].id).execute();
    await db.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', asset.id).execute();

    // The hard-deleted face's record row cascaded away, but it is still reported as skipped.
    await expect(restore(repo, dissolveId)).resolves.toEqual({ restored: 1, skipped: 1 });
    expect(await faceRow(faces[1].id)).toMatchObject({ deletedAt: null });
  });

  it('skips a recorded face that was re-assigned since', async () => {
    const repo = new FaceDissolveRepository(db);
    const { user, faces, dissolveId } = await seedDissolved(repo, 2);
    const other = await seedPerson(db, { ownerId: user.id, name: 'Other' });
    await db
      .updateTable('asset_face')
      .set({ personGroupId: other.personGroupId, deletedAt: null })
      .where('id', '=', faces[0].id)
      .execute();

    await expect(restore(repo, dissolveId)).resolves.toEqual({ restored: 1, skipped: 1 });
    expect(await faceRow(faces[0].id)).toMatchObject({ personGroupId: other.personGroupId });
  });

  it('refuses a second restore of the same dissolve', async () => {
    const repo = new FaceDissolveRepository(db);
    const { dissolveId } = await seedDissolved(repo, 1);
    await restore(repo, dissolveId);
    await expect(restore(repo, dissolveId)).resolves.toBe('already-restored');
  });

  it('returns null for an unknown dissolve', async () => {
    const repo = new FaceDissolveRepository(db);
    await expect(restore(repo, '00000000-0000-7000-8000-000000000000')).resolves.toBeNull();
  });
});

describe('FaceDissolveRepository.listDissolves', () => {
  it('lists newest first with the restorable count', async () => {
    const repo = new FaceDissolveRepository(db);
    const first = await seedDissolved(repo, 3);
    const second = await seedDissolved(repo, 1);
    await db.deleteFrom('asset_face').where('id', '=', first.faces[0].id).execute();

    const { items } = await repo.listDissolves({ page: 1, size: 200 });
    const firstRow = items.find((item) => item.id === first.dissolveId)!;
    const secondIndex = items.findIndex((item) => item.id === second.dissolveId);

    expect(secondIndex).toBeLessThan(items.indexOf(firstRow));
    expect(firstRow).toMatchObject({
      ownerId: first.user.id,
      personName: 'Junk',
      scope: 'all',
      hiddenCount: 3,
      restorableCount: 2,
      restoredAt: null,
    });
    expect(firstRow.ownerName).toBe(first.user.name);
  });
});
