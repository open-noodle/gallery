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

  // Mutation-proof: personA wins on faceCount (5 > 4 > 2) but personB wins on exifFaces (2 > 0), and
  // personC (embedded ML faces) beats personB on facesWithoutEmbedding despite having FEWER total faces —
  // so all three sorts produce genuinely different orderings. A query that ignores `sort` and always
  // orders by one fixed column, or that aliases facesWithoutEmbedding to faceCount, would pass some of
  // these assertions and fail the others. `personA`/`personC` both sit at exif=0, so that assertion only
  // pins the (unambiguous) top of the list rather than asserting an order between two ties — the tied-pair
  // ordering itself is covered by the dedicated pagination test below.
  it('actually orders by the requested sort key, not a fixed column or a different column entirely', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const personA = await seedPerson(db, { ownerId: user.id, name: 'BigButClean' }); // exif, no embedding
    const personB = await seedPerson(db, { ownerId: user.id, name: 'SmallButDirty' }); // exif faces
    const personC = await seedPerson(db, { ownerId: user.id, name: 'MediumButEmbedded' }); // ML, embedded

    for (let i = 0; i < 5; i++) {
      const asset = await seedAsset(db, { ownerId: user.id });
      await seedFace(db, { assetId: asset.id, personId: personA.id, sourceType: SourceType.MachineLearning });
    }
    for (let i = 0; i < 2; i++) {
      const asset = await seedAsset(db, { ownerId: user.id });
      await seedFace(db, { assetId: asset.id, personId: personB.id, sourceType: SourceType.Exif });
    }
    for (let i = 0; i < 4; i++) {
      const asset = await seedAsset(db, { ownerId: user.id });
      await seedFace(db, {
        assetId: asset.id,
        personId: personC.id,
        sourceType: SourceType.MachineLearning,
        withEmbedding: true,
      });
    }

    // faceCount: A(5) > C(4) > B(2) — an unambiguous total ordering.
    const byFaceCount = await repo.getPeopleHealth({ ownerId: user.id, sort: 'faceCount', page: 1, size: 20 });
    expect(byFaceCount.people.map((p) => p.id)).toEqual([personA.id, personC.id, personB.id]);

    // exifFaces: B(2) is unambiguously first; A and C both tie at 0.
    const byExif = await repo.getPeopleHealth({ ownerId: user.id, sort: 'exifFaces', page: 1, size: 20 });
    expect(byExif.people[0].id).toBe(personB.id);

    // facesWithoutEmbedding: A(5, no embeddings at all) > B(2, exif never gets one) > C(0, all embedded).
    // This differs from BOTH orderings above — proof facesWithoutEmbedding is its own sort column, not an
    // alias of faceCount (which ranks C above B) or of exifFaces (which ranks B first).
    const byMissingEmbedding = await repo.getPeopleHealth({
      ownerId: user.id,
      sort: 'facesWithoutEmbedding',
      page: 1,
      size: 20,
    });
    expect(byMissingEmbedding.people.map((p) => p.id)).toEqual([personA.id, personB.id, personC.id]);
  });

  // FIX 1 (review round 1, Finding 1): ties are the common case for this aggregate — every uncontaminated
  // person ties at exif=0 under sort=exifFaces — and without a stable tiebreaker, Postgres is free to order
  // tied rows differently per execution, so paginating by concatenating pages can duplicate one person and
  // silently skip another in the very list whose purpose is "did I miss a contaminated person?".
  //
  // A single test run cannot reliably PROVE Postgres would reorder a tied HashAggregate's output between
  // two back-to-back, unmodified-table queries in the same process — that nondeterminism is a property
  // Postgres reserves the right to exhibit, not one guaranteed to manifest on every invocation. So per the
  // review's own fallback instruction, this asserts the ordering IS `person.id` ascending within the tied
  // group — a deterministic outcome that only holds with the `.orderBy('person.id', 'asc')` tiebreaker in
  // place, and that (confirmed by hand, see the task report's mutation section) fails immediately if that
  // tiebreaker is removed, because the tied group is then returned in an order this assertion does not
  // control or predict.
  it('paginates a fully-tied sort key deterministically, without duplicating or skipping a row', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    // Three people with zero faces each: all tie at exif=0 (and at faceCount=0, and at facesWithoutEmbedding=0).
    const tiedA = await seedPerson(db, { ownerId: user.id, name: 'Tied A' });
    const tiedB = await seedPerson(db, { ownerId: user.id, name: 'Tied B' });
    const tiedC = await seedPerson(db, { ownerId: user.id, name: 'Tied C' });
    const expectedOrder = [tiedA.id, tiedB.id, tiedC.id].toSorted();

    const page1 = await repo.getPeopleHealth({ ownerId: user.id, sort: 'exifFaces', page: 1, size: 2 });
    const page2 = await repo.getPeopleHealth({ ownerId: user.id, sort: 'exifFaces', page: 2, size: 2 });

    const combinedIds = [...page1.people, ...page2.people].map((p) => p.id);
    // Deterministic id-ascending order within the tied group (Fix 1) — this also proves, as a corollary,
    // that no id is duplicated across the two pages and none is skipped: `combinedIds` matches the sorted
    // set of every seeded id exactly, in exactly that order.
    expect(combinedIds).toEqual(expectedOrder);
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
