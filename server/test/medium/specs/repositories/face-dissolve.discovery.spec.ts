import { Kysely } from 'kysely';
import { SourceType } from 'src/enum';
import { FaceDissolveRepository } from 'src/repositories/face-dissolve.repository';
import { DB } from 'src/schema';
import { mediumFactory } from 'test/medium.factory';
import { seedAsset, seedFace, seedPerson, seedUser } from 'test/medium/specs/repositories/face-dissolve.fixtures';
import { getKyselyDB } from 'test/utils';
import { beforeAll, describe, expect, it } from 'vitest';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

describe('FaceDissolveRepository.getPeopleHealth', () => {
  it('ranks the most contaminated person first and breaks counts down by source', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const dirty = await seedPerson(db, { ownerId: user.id, name: 'Dirty' });
    const clean = await seedPerson(db, { ownerId: user.id, name: 'Clean' });
    const pet = await seedPerson(db, { ownerId: user.id, name: 'Rex', type: 'pet' });

    for (let i = 0; i < 3; i++) {
      const asset = await seedAsset(db, { ownerId: user.id });
      await seedFace(db, { assetId: asset.id, personId: dirty.id, sourceType: SourceType.Exif });
    }
    const cleanAsset = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: cleanAsset.id, personId: clean.id, withEmbedding: true });
    await seedFace(db, { assetId: cleanAsset.id, personId: pet.id, isPet: true });

    const { people } = await repo.getPeopleHealth({ ownerId: user.id, sort: 'exifFaces', page: 1, size: 20 });

    expect(people[0]).toEqual(
      expect.objectContaining({ id: dirty.id, faceCount: 3, exif: 3, machineLearning: 0, facesWithoutEmbedding: 3 }),
    );
    expect(people.find((p) => p.id === clean.id)).toEqual(
      expect.objectContaining({ exif: 0, machineLearning: 1, facesWithoutEmbedding: 0 }),
    );
    // pets are not people the admin can dissolve, so they must not appear at all
    expect(people.find((p) => p.id === pet.id)).toBeUndefined();
  });

  // Mutation-proof: every count below is pairwise distinct (7, 2, 4, 1, 6), so if facesWithoutEmbedding
  // were accidentally aliased to countAll, exif, machineLearning, or manual, this assertion would catch it —
  // a coincidental match on any one of those columns cannot make the test pass by accident.
  it('counts embedding-absence as its own signal, not an alias of another column', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'Mixed' });

    for (let i = 0; i < 2; i++) {
      const asset = await seedAsset(db, { ownerId: user.id });
      await seedFace(db, { assetId: asset.id, personId: person.id, sourceType: SourceType.Exif });
    }
    const manualAsset = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: manualAsset.id, personId: person.id, sourceType: SourceType.Manual });

    const embeddedAsset = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, {
      assetId: embeddedAsset.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
      withEmbedding: true,
    });
    for (let i = 0; i < 3; i++) {
      const asset = await seedAsset(db, { ownerId: user.id });
      await seedFace(db, { assetId: asset.id, personId: person.id, sourceType: SourceType.MachineLearning });
    }

    const { people } = await repo.getPeopleHealth({ ownerId: user.id, sort: 'faceCount', page: 1, size: 20 });

    expect(people.find((p) => p.id === person.id)).toEqual(
      expect.objectContaining({
        faceCount: 7,
        exif: 2,
        machineLearning: 4,
        manual: 1,
        facesWithoutEmbedding: 6,
      }),
    );
  });

  // Mutation-proof: personA wins on faceCount (5 > 2) but personB wins on exifFaces (2 > 0), so the two
  // sorts produce OPPOSITE orderings. A query that ignores `sort` and always orders by one fixed column
  // would pass one of these assertions and fail the other.
  it('actually orders by the requested sort key, not a fixed column', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const personA = await seedPerson(db, { ownerId: user.id, name: 'BigButClean' });
    const personB = await seedPerson(db, { ownerId: user.id, name: 'SmallButDirty' });

    for (let i = 0; i < 5; i++) {
      const asset = await seedAsset(db, { ownerId: user.id });
      await seedFace(db, { assetId: asset.id, personId: personA.id, sourceType: SourceType.MachineLearning });
    }
    for (let i = 0; i < 2; i++) {
      const asset = await seedAsset(db, { ownerId: user.id });
      await seedFace(db, { assetId: asset.id, personId: personB.id, sourceType: SourceType.Exif });
    }

    const byFaceCount = await repo.getPeopleHealth({ ownerId: user.id, sort: 'faceCount', page: 1, size: 20 });
    expect(byFaceCount.people.map((p) => p.id)).toEqual([personA.id, personB.id]);

    const byExif = await repo.getPeopleHealth({ ownerId: user.id, sort: 'exifFaces', page: 1, size: 20 });
    expect(byExif.people.map((p) => p.id)).toEqual([personB.id, personA.id]);
  });

  // Mutation-proof: seeds one active face plus one soft-deleted and one invisible face on the SAME person.
  // If either join condition were dropped, faceCount would read 3 instead of 1.
  it('excludes soft-deleted and invisible faces from every count', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const person = await seedPerson(db, { ownerId: user.id, name: 'HasHiddenFaces' });

    const activeAsset = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: activeAsset.id, personId: person.id, sourceType: SourceType.MachineLearning });

    const deletedAsset = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, {
      assetId: deletedAsset.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
      deletedAt: new Date(),
    });

    const invisibleAsset = await seedAsset(db, { ownerId: user.id });
    await db
      .insertInto('asset_face')
      .values(
        mediumFactory.assetFaceInsert({
          assetId: invisibleAsset.id,
          personId: person.id,
          sourceType: SourceType.MachineLearning,
          isVisible: false,
        }),
      )
      .execute();

    const { people } = await repo.getPeopleHealth({ ownerId: user.id, sort: 'faceCount', page: 1, size: 20 });

    expect(people.find((p) => p.id === person.id)).toEqual(expect.objectContaining({ faceCount: 1 }));
  });
});
