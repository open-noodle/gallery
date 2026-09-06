import { Kysely } from 'kysely';
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

const pending = async (repo: AssetJobRepository) => {
  const ids: string[] = [];
  for await (const row of repo.streamForDetectFacesJob(false)) {
    ids.push(row.id);
  }
  return ids;
};

describe('clearFacesRecognizedAt', () => {
  it('makes the non-forced detection pass yield exactly the dissolved assets', async () => {
    const dissolve = new FaceDissolveRepository(db);
    const assetJob = new AssetJobRepository(db);

    const user = await seedUser(db);
    const target = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const other = await seedPerson(db, { ownerId: user.id, name: 'Other' });

    const mine: string[] = [];
    for (let i = 0; i < 2; i++) {
      const asset = await seedAsset(db, { ownerId: user.id });
      await seedFace(db, { assetId: asset.id, personId: target.id });
      await setFacesRecognizedAt(db, asset.id, new Date());
      mine.push(asset.id);
    }
    const theirs = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: theirs.id, personId: other.id });
    await setFacesRecognizedAt(db, theirs.id, new Date());

    // every asset is already recognized, so nothing is pending
    expect(await pending(assetJob)).toEqual([]);

    expect(await dissolve.clearFacesRecognizedAt(target.id, DissolveScope.All)).toBe(2);

    const after = await pending(assetJob);
    expect(after.sort()).toEqual([...mine].sort());
    expect(after).not.toContain(theirs.id);
  });

  it('only clears assets whose face matches the requested scope', async () => {
    const dissolve = new FaceDissolveRepository(db);
    const assetJob = new AssetJobRepository(db);

    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Scoped' });

    const exifAsset = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: exifAsset.id, personId: person.id, sourceType: SourceType.Exif });
    await setFacesRecognizedAt(db, exifAsset.id, new Date());

    const mlAsset = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: mlAsset.id, personId: person.id, sourceType: SourceType.MachineLearning });
    await setFacesRecognizedAt(db, mlAsset.id, new Date());

    expect(await dissolve.clearFacesRecognizedAt(person.id, DissolveScope.Exif)).toBe(1);

    // db is shared across the tests in this file (see getKyselyDB), so other tests' assets may
    // already be pending — assert membership rather than exact equality.
    const after = await pending(assetJob);
    expect(after).toContain(exifAsset.id);
    expect(after).not.toContain(mlAsset.id);
  });
});
