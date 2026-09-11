import { Kysely } from 'kysely';
import { SourceType } from 'src/enum';
import { DB } from 'src/schema';
import { DissolveScope, dissolveScopePredicate } from 'src/utils/face-dissolve';
import { seedAsset, seedFace, seedPerson, seedUser } from 'test/medium/specs/repositories/face-dissolve.fixtures';
import { getKyselyDB } from 'test/utils';
import { beforeAll, describe, expect, it } from 'vitest';

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
