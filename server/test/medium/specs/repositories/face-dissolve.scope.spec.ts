import { Kysely } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { SourceType } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import {
  deleteFacePredicate,
  dissolveFacePredicate,
  DissolveScope,
  dissolveScopePredicate,
  hideFacePredicate,
  keepFacePredicate,
} from 'src/gallery/utils/face-dissolve.js';
import { seedAsset, seedFace, seedPerson, seedUser } from 'test/medium/specs/repositories/face-dissolve.fixtures.js';
import { getKyselyDB } from 'test/utils.js';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

const select = (personGroupId: string, scope: DissolveScope) =>
  db
    .selectFrom('asset_face')
    .select('asset_face.id')
    .where('asset_face.personGroupId', '=', personGroupId)
    .where((eb) => dissolveScopePredicate(eb, scope))
    .execute()
    .then((rows) => rows.map((r) => r.id).sort());

describe('dissolveScopePredicate', () => {
  it('selects the right faces per scope and never a pet face', async () => {
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const pet = await seedPerson(db, { ownerId: user.id, name: 'Rex', type: 'pet' });
    const asset = await seedAsset(db, { ownerId: user.id });

    const exif = await seedFace(db, {
      assetId: asset.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.Exif,
    });
    const mlEmbedded = await seedFace(db, {
      assetId: asset.id,
      personGroupId: person.personGroupId,
      withEmbedding: true,
    });
    const mlBare = await seedFace(db, { assetId: asset.id, personGroupId: person.personGroupId });
    await seedFace(db, { assetId: asset.id, personGroupId: pet.personGroupId, isPet: true });

    await expect(select(person.personGroupId, DissolveScope.All)).resolves.toEqual(
      [exif.id, mlEmbedded.id, mlBare.id].sort(),
    );
    await expect(select(person.personGroupId, DissolveScope.Exif)).resolves.toEqual([exif.id]);
    await expect(select(person.personGroupId, DissolveScope.MachineLearning)).resolves.toEqual(
      [mlEmbedded.id, mlBare.id].sort(),
    );
    await expect(select(person.personGroupId, DissolveScope.WithoutEmbedding)).resolves.toEqual(
      [exif.id, mlBare.id].sort(),
    );

    for (const scope of Object.values(DissolveScope)) {
      await expect(select(pet.personGroupId, scope)).resolves.toEqual([]);
    }
  });
});

describe('treatment predicates', () => {
  const ids = (personGroupId: string, treatment?: typeof keepFacePredicate) =>
    db
      .selectFrom('asset_face')
      .select('asset_face.id')
      .where((eb) => dissolveFacePredicate(eb, personGroupId, DissolveScope.All))
      .$if(!!treatment, (qb) => qb.where((eb) => treatment!(eb)))
      .execute()
      .then((rows) => rows.map((r) => r.id).sort());

  it('assigns every in-scope face exactly one treatment', async () => {
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });
    const on = { assetId: asset.id, personGroupId: person.personGroupId };

    const exif = await seedFace(db, { ...on, sourceType: SourceType.Exif });
    const mlEmbedded = await seedFace(db, { ...on, withEmbedding: true });
    const mlBare = await seedFace(db, on);
    const manual = await seedFace(db, { ...on, sourceType: SourceType.Manual });
    const drawnMl = await seedFace(db, { ...on, withEmbedding: true, createdBy: user.id });
    const drawnExif = await seedFace(db, { ...on, sourceType: SourceType.Exif, createdBy: user.id });

    const keep = await ids(person.personGroupId, keepFacePredicate);
    const hide = await ids(person.personGroupId, hideFacePredicate);
    const remove = await ids(person.personGroupId, deleteFacePredicate);

    expect(keep).toEqual([manual.id, drawnMl.id, drawnExif.id].sort());
    expect(hide).toEqual([mlEmbedded.id, mlBare.id].sort());
    expect(remove).toEqual([exif.id]);
    expect([...keep, ...hide, ...remove].sort()).toEqual(await ids(person.personGroupId));
  });
});
