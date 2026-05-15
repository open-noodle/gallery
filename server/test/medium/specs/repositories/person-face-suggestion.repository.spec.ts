import { Kysely } from 'kysely';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonFaceSuggestionRepository } from 'src/repositories/person-face-suggestion.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [PersonFaceSuggestionRepository],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(PersonFaceSuggestionRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

afterAll(async () => {
  await defaultDatabase.destroy();
});

describe('PersonFaceSuggestionRepository', () => {
  it('is constructible via the medium service container', () => {
    const { sut } = setup();
    expect(sut).toBeInstanceOf(PersonFaceSuggestionRepository);
  });

  describe('upsertPending', () => {
    let personId: string;
    let assetFaceId: string;

    const getRow = (pId: string, afId: string) =>
      defaultDatabase
        .selectFrom('person_face_suggestion')
        .selectAll()
        .where('personId', '=', pId)
        .where('assetFaceId', '=', afId)
        .executeTakeFirstOrThrow();

    beforeAll(async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Test Person', isHidden: false });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      personId = person.id;
      assetFaceId = assetFace.id;
    });

    beforeEach(async () => {
      // Ensure each test starts with no existing suggestion row for this pair.
      await defaultDatabase
        .deleteFrom('person_face_suggestion')
        .where('personId', '=', personId)
        .where('assetFaceId', '=', assetFaceId)
        .execute();
    });

    afterEach(async () => {
      // Clean up after each test.
      await defaultDatabase
        .deleteFrom('person_face_suggestion')
        .where('personId', '=', personId)
        .where('assetFaceId', '=', assetFaceId)
        .execute();
    });

    it('inserts a new pending row', async () => {
      const { sut } = setup();
      await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);
      const row = await getRow(personId, assetFaceId);
      expect(row).toMatchObject({ status: 'pending', distance: 0.6 });
    });

    it('refreshes distance for a still-pending row', async () => {
      const { sut } = setup();
      await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);
      await sut.upsertPending([{ personId, assetFaceId, distance: 0.55 }]);
      const row = await getRow(personId, assetFaceId);
      expect(row).toMatchObject({ status: 'pending', distance: 0.55 });
    });

    it('NEVER resurrects a dismissed row', async () => {
      const { sut } = setup();
      await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);
      // Set dismissed directly — Phase 1 has no markDismissed method yet.
      await defaultDatabase
        .updateTable('person_face_suggestion')
        .set({ status: 'dismissed' })
        .where('personId', '=', personId)
        .where('assetFaceId', '=', assetFaceId)
        .execute();
      await sut.upsertPending([{ personId, assetFaceId, distance: 0.4 }]);
      const row = await getRow(personId, assetFaceId);
      expect(row.status).toBe('dismissed');
      expect(row.distance).toBe(0.6); // unchanged
    });

    it('leaves a confirmed row untouched', async () => {
      const { sut } = setup();
      await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);
      await defaultDatabase
        .updateTable('person_face_suggestion')
        .set({ status: 'confirmed' })
        .where('personId', '=', personId)
        .where('assetFaceId', '=', assetFaceId)
        .execute();
      await sut.upsertPending([{ personId, assetFaceId, distance: 0.4 }]);
      const row = await getRow(personId, assetFaceId);
      expect(row.status).toBe('confirmed');
      expect(row.distance).toBe(0.6);
    });
  });

  describe('getPendingForPerson', () => {
    // P: named, visible, type=person — the main subject
    let personPId: string;
    // U: unnamed person — excluded by read gate
    let unnamedPersonId: string;
    // H: hidden person — excluded by read gate
    let hiddenPersonId: string;
    // X: pet person — excluded by read gate
    let petPersonId: string;

    // F1 at 0.45  — below or at maxDistance: excluded by band
    // F2 at 0.62  — dismissed: excluded by status
    // F3 at 0.60  — in band, pending: included
    // F4 at 0.70  — in band, pending: included
    // F5 at 0.90  — above suggestionMaxDistance: excluded by band
    let f3Id: string;
    let f4Id: string;

    const opts = { maxDistance: 0.5, suggestionMaxDistance: 0.8, page: 1, size: 10 };

    beforeAll(async () => {
      const { ctx } = setup();

      const { user } = await ctx.newUser();

      const { person: personP } = await ctx.newPerson({
        ownerId: user.id,
        name: 'Alice',
        isHidden: false,
        type: 'person',
      });
      personPId = personP.id;

      const { person: personU } = await ctx.newPerson({
        ownerId: user.id,
        name: '',
        isHidden: false,
        type: 'person',
      });
      unnamedPersonId = personU.id;

      const { person: personH } = await ctx.newPerson({
        ownerId: user.id,
        name: 'Hidden Hannah',
        isHidden: true,
        type: 'person',
      });
      hiddenPersonId = personH.id;

      const { person: personX } = await ctx.newPerson({
        ownerId: user.id,
        name: 'Fluffy',
        isHidden: false,
        type: 'pet',
      });
      petPersonId = personX.id;

      // Create asset faces (unassigned, i.e. personId = null)
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      const { assetFace: f1 } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const { assetFace: f2 } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const { assetFace: f3 } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const { assetFace: f4 } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const { assetFace: f5 } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      f3Id = f3.id;
      f4Id = f4.id;

      // Asset faces for gate-excluded persons
      const { assetFace: fU } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const { assetFace: fH } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const { assetFace: fX } = await ctx.newAssetFace({ assetId: asset.id, personId: null });

      const { sut } = setup();

      // F1: distance 0.45 — at/below maxDistance (excluded by band lower bound)
      await sut.upsertPending([{ personId: personPId, assetFaceId: f1.id, distance: 0.45 }]);

      // F2: insert at 0.62 then dismiss — excluded because status='dismissed'
      await sut.upsertPending([{ personId: personPId, assetFaceId: f2.id, distance: 0.62 }]);
      await defaultDatabase
        .updateTable('person_face_suggestion')
        .set({ status: 'dismissed' })
        .where('personId', '=', personPId)
        .where('assetFaceId', '=', f2.id)
        .execute();

      // F3: distance 0.60 — in band, pending (included)
      await sut.upsertPending([{ personId: personPId, assetFaceId: f3.id, distance: 0.6 }]);

      // F4: distance 0.70 — in band, pending (included)
      await sut.upsertPending([{ personId: personPId, assetFaceId: f4.id, distance: 0.7 }]);

      // F5: distance 0.90 — above suggestionMaxDistance (excluded by band upper bound)
      await sut.upsertPending([{ personId: personPId, assetFaceId: f5.id, distance: 0.9 }]);

      // Read-gate persons each get one in-band pending suggestion
      await sut.upsertPending([{ personId: unnamedPersonId, assetFaceId: fU.id, distance: 0.65 }]);
      await sut.upsertPending([{ personId: hiddenPersonId, assetFaceId: fH.id, distance: 0.65 }]);
      await sut.upsertPending([{ personId: petPersonId, assetFaceId: fX.id, distance: 0.65 }]);
    });

    it('returns only pending rows strictly inside the band (maxDistance, suggestionMaxDistance], ordered by distance, with total', async () => {
      const { sut } = setup();
      const res = await sut.getPendingForPerson(personPId, opts);
      expect(res.total).toBe(2);
      expect(res.items.map((i) => i.distance)).toEqual([0.6, 0.7]);
    });

    it('returns empty for an unnamed person (read gate)', async () => {
      const { sut } = setup();
      const res = await sut.getPendingForPerson(unnamedPersonId, opts);
      expect(res).toEqual({ total: 0, items: [] });
    });

    it('returns empty for a hidden person (read gate)', async () => {
      const { sut } = setup();
      const res = await sut.getPendingForPerson(hiddenPersonId, opts);
      expect(res).toEqual({ total: 0, items: [] });
    });

    it('returns empty for a pet person (read gate)', async () => {
      const { sut } = setup();
      const res = await sut.getPendingForPerson(petPersonId, opts);
      expect(res).toEqual({ total: 0, items: [] });
    });

    it('returns empty when feature is disabled (suggestionMaxDistance <= maxDistance)', async () => {
      const { sut } = setup();
      const res = await sut.getPendingForPerson(personPId, { ...opts, suggestionMaxDistance: 0.5 });
      expect(res).toEqual({ total: 0, items: [] });
    });
  });
});
