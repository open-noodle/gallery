import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonFaceSuggestionRepository } from 'src/repositories/person-face-suggestion.repository';
import { DB } from 'src/schema';
import { PersonFaceSuggestionStatus } from 'src/schema/tables/person-face-suggestion.table';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let defaultDatabase: Kysely<DB>;

const getRow = (pId: string, afId: string) =>
  defaultDatabase
    .selectFrom('person_face_suggestion')
    .selectAll()
    .where('personId', '=', pId)
    .where('assetFaceId', '=', afId)
    .executeTakeFirstOrThrow();

const getSpaceRow = (spacePersonId: string, assetFaceId: string) =>
  defaultDatabase
    .selectFrom('person_face_suggestion')
    .selectAll()
    .where('spacePersonId', '=', spacePersonId)
    .where('assetFaceId', '=', assetFaceId)
    .executeTakeFirstOrThrow();

const countRows = (assetFaceId: string, status: PersonFaceSuggestionStatus) =>
  defaultDatabase
    .selectFrom('person_face_suggestion')
    .select((eb) => eb.fn.countAll<string>().as('c'))
    .where('assetFaceId', '=', assetFaceId)
    .where('status', '=', status)
    .executeTakeFirstOrThrow()
    .then((r) => Number(r.c));

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

    it.each(['rejected', 'ignored'] as const)('NEVER resurrects a %s row', async (status) => {
      const { sut } = setup();
      await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);
      await defaultDatabase
        .updateTable('person_face_suggestion')
        .set({ status })
        .where('personId', '=', personId)
        .where('assetFaceId', '=', assetFaceId)
        .execute();
      await sut.upsertPending([{ personId, assetFaceId, distance: 0.4 }]);
      const row = await getRow(personId, assetFaceId);
      expect(row.status).toBe(status);
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
    // F2 at 0.62  — rejected: excluded by status
    // F3 at 0.60  — in band, pending: included
    // F4 at 0.70  — in band, pending: included
    // F5 at 0.90  — above suggestionMaxDistance: excluded by band
    // F6 at 0.65  — in band, pending, but face becomes assigned: excluded by af.personId IS NULL
    let f6Id: string;

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
      // Asset faces for gate-excluded persons
      const { assetFace: fU } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const { assetFace: fH } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const { assetFace: fX } = await ctx.newAssetFace({ assetId: asset.id, personId: null });

      const { sut } = setup();

      // F1: distance 0.45 — at/below maxDistance (excluded by band lower bound)
      await sut.upsertPending([{ personId: personPId, assetFaceId: f1.id, distance: 0.45 }]);

      // F2: insert at 0.62 then reject — excluded because status='rejected'
      await sut.upsertPending([{ personId: personPId, assetFaceId: f2.id, distance: 0.62 }]);
      await defaultDatabase
        .updateTable('person_face_suggestion')
        .set({ status: 'rejected' })
        .where('personId', '=', personPId)
        .where('assetFaceId', '=', f2.id)
        .execute();

      // F3: distance 0.60 — in band, pending (included)
      await sut.upsertPending([{ personId: personPId, assetFaceId: f3.id, distance: 0.6 }]);

      // F4: distance 0.70 — in band, pending (included)
      await sut.upsertPending([{ personId: personPId, assetFaceId: f4.id, distance: 0.7 }]);

      // F5: distance 0.90 — above suggestionMaxDistance (excluded by band upper bound)
      await sut.upsertPending([{ personId: personPId, assetFaceId: f5.id, distance: 0.9 }]);

      // F6: in band (0.65) but face becomes assigned mid-review — excluded by af.personId IS NULL
      const { assetFace: f6 } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      f6Id = f6.id;
      await sut.upsertPending([{ personId: personPId, assetFaceId: f6Id, distance: 0.65 }]);
      await defaultDatabase.updateTable('asset_face').set({ personId: personPId }).where('id', '=', f6Id).execute();

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

    it('excludes a pending suggestion whose face was assigned between scan and read (af.personId IS NULL guard)', async () => {
      const { sut } = setup();
      const res = await sut.getPendingForPerson(personPId, opts);
      // F6 (0.65) has a pending suggestion but asset_face.personId was set — must be excluded.
      // F3 (0.60) and F4 (0.70) are still unassigned: total stays 2.
      expect(res.total).toBe(2);
      expect(res.items.map((i) => i.assetFaceId)).not.toContain(f6Id);
    });

    it('returns the asset id, bounding box and dimensions for each in-band pending item', async () => {
      const { sut } = setup();
      const res = await sut.getPendingForPerson(personPId, opts);

      expect(res.total).toBe(2);
      for (const item of res.items) {
        expect(item.assetId).toEqual(expect.any(String));
        expect(item.imageWidth).toBeGreaterThan(0);
        expect(item.imageHeight).toBeGreaterThan(0);
        expect(typeof item.boundingBoxX1).toBe('number');
        expect(typeof item.boundingBoxX2).toBe('number');
        expect(typeof item.boundingBoxY1).toBe('number');
        expect(typeof item.boundingBoxY2).toBe('number');
      }
      // still ordered by distance ascending (Phase-1 contract preserved)
      expect(res.items.map((i) => i.distance)).toEqual([0.6, 0.7]);
    });
  });

  describe('markConfirmed / markRejected / markIgnored (idempotent, status-guarded)', () => {
    let personId: string;
    let assetFaceId: string;

    beforeAll(async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Suggestion Person', isHidden: false });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      personId = person.id;
      assetFaceId = assetFace.id;
    });

    beforeEach(async () => {
      await defaultDatabase.deleteFrom('person_face_suggestion').where('assetFaceId', '=', assetFaceId).execute();
    });

    afterEach(async () => {
      await defaultDatabase.deleteFrom('person_face_suggestion').where('assetFaceId', '=', assetFaceId).execute();
    });

    it('markConfirmed flips a pending row to confirmed and returns 1; re-running returns 0', async () => {
      const { sut } = setup();
      await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);

      expect(await sut.markConfirmed(personId, assetFaceId)).toBe(1);
      let row = await getRow(personId, assetFaceId);
      expect(row.status).toBe('confirmed');

      // idempotent: already confirmed → no pending row → 0 affected, status unchanged
      expect(await sut.markConfirmed(personId, assetFaceId)).toBe(0);
      row = await getRow(personId, assetFaceId);
      expect(row.status).toBe('confirmed');
    });

    it.each([
      ['markRejected', 'rejected'],
      ['markIgnored', 'ignored'],
    ] as const)('%s flips a pending row to %s and returns 1; re-running returns 0', async (method, status) => {
      const { sut } = setup();
      await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);

      expect(await sut[method](personId, assetFaceId)).toBe(1);
      let row = await getRow(personId, assetFaceId);
      expect(row.status).toBe(status);

      expect(await sut[method](personId, assetFaceId)).toBe(0);
      row = await getRow(personId, assetFaceId);
      expect(row.status).toBe(status);
    });

    it.each([
      ['markConfirmed', 'confirmed'],
      ['markRejected', 'rejected'],
      ['markIgnored', 'ignored'],
    ] as const)(
      '%s resolves pending rows only and cannot be overwritten by another resolution',
      async (method, status) => {
        const { sut } = setup();
        await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);

        expect(await sut[method](personId, assetFaceId)).toBe(1);
        expect(await sut.markConfirmed(personId, assetFaceId)).toBe(0);
        expect(await sut.markRejected(personId, assetFaceId)).toBe(0);
        expect(await sut.markIgnored(personId, assetFaceId)).toBe(0);
        const row = await getRow(personId, assetFaceId);
        expect(row.status).toBe(status);
      },
    );

    it('reject and ignore racing for the same row resolves once', async () => {
      const { sut } = setup();
      await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);

      const results = await Promise.all([
        sut.markRejected(personId, assetFaceId),
        sut.markIgnored(personId, assetFaceId),
      ]);

      expect(results.toSorted()).toEqual([0, 1]);
      const row = await getRow(personId, assetFaceId);
      expect(['rejected', 'ignored']).toContain(row.status);
    });

    it.each([
      ['markRejected', 'rejected'],
      ['markIgnored', 'ignored'],
    ] as const)('%s resolves only the target row and leaves sibling suggestions pending', async (method, status) => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person: siblingPerson } = await ctx.newPerson({
        ownerId: user.id,
        name: 'Sibling Suggestion Person',
        isHidden: false,
      });
      await sut.upsertPending([
        { personId, assetFaceId, distance: 0.6 },
        { personId: siblingPerson.id, assetFaceId, distance: 0.65 },
      ]);

      expect(await sut[method](personId, assetFaceId)).toBe(1);

      const target = await getRow(personId, assetFaceId);
      const sibling = await getRow(siblingPerson.id, assetFaceId);
      expect(target.status).toBe(status);
      expect(sibling.status).toBe('pending');
    });

    it('returns 0 for a (personId, assetFaceId) pair that has no row (benign idempotent)', async () => {
      const { sut } = setup();
      expect(await sut.markConfirmed(personId, assetFaceId)).toBe(0);
      expect(await sut.markRejected(personId, assetFaceId)).toBe(0);
      expect(await sut.markIgnored(personId, assetFaceId)).toBe(0);
    });
  });

  describe('resolveAssignedFace', () => {
    let faceXId: string;

    beforeAll(async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      faceXId = assetFace.id;

      const { person: p1 } = await ctx.newPerson({ ownerId: user.id, name: 'Person One', isHidden: false });
      const { person: p2 } = await ctx.newPerson({ ownerId: user.id, name: 'Person Two', isHidden: false });
      const { person: p3 } = await ctx.newPerson({ ownerId: user.id, name: 'Rejected Person', isHidden: false });
      const { person: p4 } = await ctx.newPerson({ ownerId: user.id, name: 'Ignored Person', isHidden: false });
      const { person: p5 } = await ctx.newPerson({ ownerId: user.id, name: 'Confirmed Person', isHidden: false });
      const p1Id = p1.id;
      const p2Id = p2.id;

      const { sut } = setup();

      // faceX pending for P1 (distance 0.6) and P2 (distance 0.65)
      await sut.upsertPending([{ personId: p1Id, assetFaceId: faceXId, distance: 0.6 }]);
      await sut.upsertPending([{ personId: p2Id, assetFaceId: faceXId, distance: 0.65 }]);

      // faceX rejected for P3 — insert pending then set rejected via raw updateTable
      await sut.upsertPending([{ personId: p3.id, assetFaceId: faceXId, distance: 0.7 }]);
      await defaultDatabase
        .updateTable('person_face_suggestion')
        .set({ status: 'rejected' })
        .where('personId', '=', p3.id)
        .where('assetFaceId', '=', faceXId)
        .execute();

      // faceX ignored for P4 — insert pending then set ignored via raw updateTable
      await sut.upsertPending([{ personId: p4.id, assetFaceId: faceXId, distance: 0.75 }]);
      await defaultDatabase
        .updateTable('person_face_suggestion')
        .set({ status: 'ignored' })
        .where('personId', '=', p4.id)
        .where('assetFaceId', '=', faceXId)
        .execute();

      // faceX confirmed for P5 — insert pending then set confirmed via raw updateTable
      await sut.upsertPending([{ personId: p5.id, assetFaceId: faceXId, distance: 0.8 }]);
      await defaultDatabase
        .updateTable('person_face_suggestion')
        .set({ status: 'confirmed' })
        .where('personId', '=', p5.id)
        .where('assetFaceId', '=', faceXId)
        .execute();

      // Now resolve: deletes pending rows for faceX, leaves rejected, ignored and confirmed alone
      await sut.resolveAssignedFace(faceXId);
    });

    it('deletes all pending rows for that face across all persons', async () => {
      expect(await countRows(faceXId, 'pending')).toBe(0);
    });

    it('preserves rejected, ignored and confirmed rows for that face', async () => {
      expect(await countRows(faceXId, 'rejected')).toBe(1);
      expect(await countRows(faceXId, 'ignored')).toBe(1);
      expect(await countRows(faceXId, 'confirmed')).toBe(1);
    });
  });

  describe("edge 12 — confirming for one person resolves the other person's pending row", () => {
    let p1Id: string;
    let p2Id: string;
    let assetFaceId: string;

    beforeAll(async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const { person: person1 } = await ctx.newPerson({ ownerId: user.id, name: 'Edge12 Person1', isHidden: false });
      const { person: person2 } = await ctx.newPerson({ ownerId: user.id, name: 'Edge12 Person2', isHidden: false });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      p1Id = person1.id;
      p2Id = person2.id;
      assetFaceId = assetFace.id;
    });

    beforeEach(async () => {
      await defaultDatabase.deleteFrom('person_face_suggestion').where('assetFaceId', '=', assetFaceId).execute();
    });

    afterEach(async () => {
      await defaultDatabase.deleteFrom('person_face_suggestion').where('assetFaceId', '=', assetFaceId).execute();
    });

    it("keeps the confirmed row and deletes the sibling person's pending row for the same face", async () => {
      const { sut } = setup();
      // Seed pending rows for BOTH persons pointing at the same assetFaceId
      await sut.upsertPending([
        { personId: p1Id, assetFaceId, distance: 0.6 },
        { personId: p2Id, assetFaceId, distance: 0.65 },
      ]);

      // Confirm flow order: markConfirmed BEFORE resolveAssignedFace
      expect(await sut.markConfirmed(p1Id, assetFaceId)).toBe(1);
      await sut.resolveAssignedFace(assetFaceId); // pending-only delete across ALL persons

      const row = await getRow(p1Id, assetFaceId);
      expect(row.status).toBe('confirmed'); // survives (non-pending)
      const p2Rows = await defaultDatabase
        .selectFrom('person_face_suggestion')
        .selectAll()
        .where('personId', '=', p2Id)
        .where('assetFaceId', '=', assetFaceId)
        .execute();
      expect(p2Rows).toEqual([]); // sibling pending row deleted
    });
  });

  describe('edge 8 — merge cannot strand a cross-person pending row', () => {
    let p1Id: string;
    let assetFaceId: string;

    beforeAll(async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const { person: person1 } = await ctx.newPerson({ ownerId: user.id, name: 'Edge8 Person1', isHidden: false });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      p1Id = person1.id;
      assetFaceId = assetFace.id;
    });

    afterEach(async () => {
      // Restore face to unassigned after each test
      await defaultDatabase.updateTable('asset_face').set({ personId: null }).where('id', '=', assetFaceId).execute();
      await defaultDatabase.deleteFrom('person_face_suggestion').where('assetFaceId', '=', assetFaceId).execute();
    });

    it('half 1: assigning the face makes getPendingForPerson exclude it (pending row references unassigned face only)', async () => {
      const { sut } = setup();
      await sut.upsertPending([{ personId: p1Id, assetFaceId, distance: 0.6 }]);
      // Simulate: face assigned to someone (like what a merge does to its faces)
      await defaultDatabase.updateTable('asset_face').set({ personId: p1Id }).where('id', '=', assetFaceId).execute();

      const res = await sut.getPendingForPerson(p1Id, {
        maxDistance: 0.5,
        suggestionMaxDistance: 0.8,
        page: 1,
        size: 10,
      });
      expect(res.items.find((i) => i.assetFaceId === assetFaceId)).toBeUndefined();
    });

    it('half 2: removing the candidate person (what removeAllPeople does in a merge) drops its rows via FK CASCADE', async () => {
      const { ctx } = setup();
      // Create a fresh person specifically for this test so we can delete it
      const { user } = await ctx.newUser();
      const { person: tempPerson } = await ctx.newPerson({
        ownerId: user.id,
        name: 'Edge8 Temp Person',
        isHidden: false,
      });
      const tempPersonId = tempPerson.id;

      const { sut } = setup();
      await sut.upsertPending([{ personId: tempPersonId, assetFaceId, distance: 0.6 }]);
      expect(await getRow(tempPersonId, assetFaceId)).toBeTruthy();

      // mergePerson → removeAllPeople([mergedAwayPerson]) deletes the person row
      await defaultDatabase.deleteFrom('person').where('id', '=', tempPersonId).execute();

      const remaining = await defaultDatabase
        .selectFrom('person_face_suggestion')
        .selectAll()
        .where('personId', '=', tempPersonId)
        .execute();
      expect(remaining).toEqual([]); // Phase-1 FK ON DELETE CASCADE
    });
  });

  describe('space-person suggestion methods', () => {
    it.each([
      ['markRejectedForSpacePerson', 'rejected'],
      ['markIgnoredForSpacePerson', 'ignored'],
    ] as const)('upserts pending rows by spacePersonId and never resurrects %s rows', async (method, status) => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, name: 'Alice' })
        .returningAll()
        .executeTakeFirstOrThrow();

      await sut.upsertPendingForSpacePerson([
        { spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.7 },
      ]);
      expect(await sut[method](spacePerson.id, assetFace.id)).toBe(1);
      await sut.upsertPendingForSpacePerson([
        { spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.6 },
      ]);

      const row = await getSpaceRow(spacePerson.id, assetFace.id);
      expect(row.status).toBe(status);
      expect(row.distance).toBe(0.7);
    });

    it('markConfirmedForSpacePerson is idempotent and status-guarded', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, name: 'Alice' })
        .returningAll()
        .executeTakeFirstOrThrow();

      await sut.upsertPendingForSpacePerson([
        { spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.7 },
      ]);

      expect(await sut.markConfirmedForSpacePerson(spacePerson.id, assetFace.id)).toBe(1);
      expect(await sut.markConfirmedForSpacePerson(spacePerson.id, assetFace.id)).toBe(0);
      expect(await sut.markRejectedForSpacePerson(spacePerson.id, assetFace.id)).toBe(0);
      expect(await sut.markIgnoredForSpacePerson(spacePerson.id, assetFace.id)).toBe(0);

      const row = await getSpaceRow(spacePerson.id, assetFace.id);
      expect(row.status).toBe('confirmed');
    });

    it.each([
      ['markRejectedForSpacePerson', 'rejected'],
      ['markIgnoredForSpacePerson', 'ignored'],
    ] as const)('%s is idempotent and status-guarded', async (method, status) => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, name: 'Alice' })
        .returningAll()
        .executeTakeFirstOrThrow();

      await sut.upsertPendingForSpacePerson([
        { spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.7 },
      ]);

      expect(await sut[method](spacePerson.id, assetFace.id)).toBe(1);
      expect(await sut[method](spacePerson.id, assetFace.id)).toBe(0);
      expect(await sut.markConfirmedForSpacePerson(spacePerson.id, assetFace.id)).toBe(0);
      expect(await sut.markRejectedForSpacePerson(spacePerson.id, assetFace.id)).toBe(0);
      expect(await sut.markIgnoredForSpacePerson(spacePerson.id, assetFace.id)).toBe(0);

      const row = await getSpaceRow(spacePerson.id, assetFace.id);
      expect(row.status).toBe(status);
    });

    it('space-person reject and ignore racing for the same row resolves once', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, name: 'Alice' })
        .returningAll()
        .executeTakeFirstOrThrow();

      await sut.upsertPendingForSpacePerson([
        { spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.7 },
      ]);

      const results = await Promise.all([
        sut.markRejectedForSpacePerson(spacePerson.id, assetFace.id),
        sut.markIgnoredForSpacePerson(spacePerson.id, assetFace.id),
      ]);

      expect(results.toSorted()).toEqual([0, 1]);
      const row = await getSpaceRow(spacePerson.id, assetFace.id);
      expect(['rejected', 'ignored']).toContain(row.status);
    });

    it.each([
      ['markRejectedForSpacePerson', 'rejected'],
      ['markIgnoredForSpacePerson', 'ignored'],
    ] as const)('%s resolves only the target row and leaves sibling suggestions pending', async (method, status) => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const [spacePerson, siblingSpacePerson] = await ctx.database
        .insertInto('shared_space_person')
        .values([
          { spaceId: space.id, name: 'Alice' },
          { spaceId: space.id, name: 'Bob' },
        ])
        .returningAll()
        .execute();

      await sut.upsertPendingForSpacePerson([
        { spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.7 },
        { spacePersonId: siblingSpacePerson.id, assetFaceId: assetFace.id, distance: 0.75 },
      ]);

      expect(await sut[method](spacePerson.id, assetFace.id)).toBe(1);

      const target = await getSpaceRow(spacePerson.id, assetFace.id);
      const sibling = await getSpaceRow(siblingSpacePerson.id, assetFace.id);
      expect(target.status).toBe(status);
      expect(sibling.status).toBe('pending');
    });

    it('getPendingForSpacePerson filters unshared stale rows at read time', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      const { asset: keptAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: unsharedAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: keptAsset.id, addedById: user.id });
      const { assetFace: keptFace } = await ctx.newAssetFace({ assetId: keptAsset.id, personId: null });
      const { assetFace: staleFace } = await ctx.newAssetFace({ assetId: unsharedAsset.id, personId: null });
      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, name: 'Alice', type: 'person', isHidden: false })
        .returningAll()
        .executeTakeFirstOrThrow();
      await sut.upsertPendingForSpacePerson([
        { spacePersonId: spacePerson.id, assetFaceId: keptFace.id, distance: 0.6 },
        { spacePersonId: spacePerson.id, assetFaceId: staleFace.id, distance: 0.7 },
      ]);

      const result = await sut.getPendingForSpacePerson(space.id, spacePerson.id, {
        maxDistance: 0.5,
        suggestionMaxDistance: 0.8,
        page: 1,
        size: 10,
      });

      expect(result.total).toBe(1);
      expect(result.items.map((item) => item.assetFaceId)).toEqual([keptFace.id]);
    });

    it('getPendingForSpacePerson includes linked-library rows and excludes ineligible asset and face rows', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      const { library } = await ctx.newLibrary({ ownerId: user.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
      const { asset: hiddenAsset } = await ctx.newAsset({
        ownerId: user.id,
        libraryId: library.id,
        visibility: AssetVisibility.Hidden,
      });
      const { asset: lockedAsset } = await ctx.newAsset({
        ownerId: user.id,
        libraryId: library.id,
        visibility: AssetVisibility.Locked,
      });
      const { asset: offlineAsset } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id, isOffline: true });
      const { assetFace: includedFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const { assetFace: assignedFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const { assetFace: deletedFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const { assetFace: invisibleFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const { assetFace: outOfBandFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const { assetFace: hiddenAssetFace } = await ctx.newAssetFace({ assetId: hiddenAsset.id, personId: null });
      const { assetFace: lockedAssetFace } = await ctx.newAssetFace({ assetId: lockedAsset.id, personId: null });
      const { assetFace: offlineAssetFace } = await ctx.newAssetFace({ assetId: offlineAsset.id, personId: null });
      const { person } = await ctx.newPerson({ ownerId: user.id });
      await ctx.database
        .updateTable('asset_face')
        .set({ personId: person.id })
        .where('id', '=', assignedFace.id)
        .execute();
      await ctx.database
        .updateTable('asset_face')
        .set({ deletedAt: new Date() })
        .where('id', '=', deletedFace.id)
        .execute();
      await ctx.database
        .updateTable('asset_face')
        .set({ isVisible: false })
        .where('id', '=', invisibleFace.id)
        .execute();
      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, name: 'Alice', type: 'person', isHidden: false })
        .returningAll()
        .executeTakeFirstOrThrow();
      await sut.upsertPendingForSpacePerson([
        { spacePersonId: spacePerson.id, assetFaceId: includedFace.id, distance: 0.6 },
        { spacePersonId: spacePerson.id, assetFaceId: assignedFace.id, distance: 0.61 },
        { spacePersonId: spacePerson.id, assetFaceId: deletedFace.id, distance: 0.62 },
        { spacePersonId: spacePerson.id, assetFaceId: invisibleFace.id, distance: 0.63 },
        { spacePersonId: spacePerson.id, assetFaceId: outOfBandFace.id, distance: 0.9 },
        { spacePersonId: spacePerson.id, assetFaceId: hiddenAssetFace.id, distance: 0.64 },
        { spacePersonId: spacePerson.id, assetFaceId: lockedAssetFace.id, distance: 0.65 },
        { spacePersonId: spacePerson.id, assetFaceId: offlineAssetFace.id, distance: 0.66 },
      ]);

      const result = await sut.getPendingForSpacePerson(space.id, spacePerson.id, {
        maxDistance: 0.5,
        suggestionMaxDistance: 0.8,
        page: 1,
        size: 10,
      });

      expect(result.total).toBe(1);
      expect(result.items.map((item) => item.assetFaceId)).toEqual([includedFace.id]);
    });

    it('getPendingForSpacePerson returns empty for whitespace name, hidden person, pet person, disabled space, and disabled band', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      const { space: disabledSpace } = await ctx.newSharedSpace({
        createdById: user.id,
        faceRecognitionEnabled: false,
      });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const rows = await ctx.database
        .insertInto('shared_space_person')
        .values([
          { spaceId: space.id, name: 'Valid', type: 'person', isHidden: false },
          { spaceId: space.id, name: '   ', type: 'person', isHidden: false },
          { spaceId: space.id, name: 'Hidden', type: 'person', isHidden: true },
          { spaceId: space.id, name: 'Pet', type: 'pet', isHidden: false },
          { spaceId: disabledSpace.id, name: 'Disabled', type: 'person', isHidden: false },
        ])
        .returningAll()
        .execute();

      for (const person of rows.slice(1)) {
        await sut.upsertPendingForSpacePerson([{ spacePersonId: person.id, assetFaceId: assetFace.id, distance: 0.6 }]);
        await expect(
          sut.getPendingForSpacePerson(person.spaceId, person.id, {
            maxDistance: 0.5,
            suggestionMaxDistance: 0.8,
            page: 1,
            size: 10,
          }),
        ).resolves.toEqual({ total: 0, items: [] });
      }

      await sut.upsertPendingForSpacePerson([{ spacePersonId: rows[0].id, assetFaceId: assetFace.id, distance: 0.6 }]);
      await expect(
        sut.getPendingForSpacePerson(space.id, rows[0].id, {
          maxDistance: 0.5,
          suggestionMaxDistance: 0.5,
          page: 1,
          size: 10,
        }),
      ).resolves.toEqual({ total: 0, items: [] });
    });

    describe('hasPendingForSpacePerson', () => {
      const opts = { maxDistance: 0.5, suggestionMaxDistance: 0.8 };

      it('returns true for an in-band pending suggestion on a directly shared asset', async () => {
        const { ctx, sut } = setup();
        const { user } = await ctx.newUser();
        const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
        const spacePerson = await ctx.database
          .insertInto('shared_space_person')
          .values({ spaceId: space.id, name: 'Alice', type: 'person', isHidden: false })
          .returningAll()
          .executeTakeFirstOrThrow();
        await sut.upsertPendingForSpacePerson([
          { spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.6 },
        ]);

        await expect(sut.hasPendingForSpacePerson(space.id, spacePerson.id, assetFace.id, opts)).resolves.toBe(true);
      });

      it('returns false when the suggestion band is disabled', async () => {
        const { ctx, sut } = setup();
        const { user } = await ctx.newUser();
        const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
        const spacePerson = await ctx.database
          .insertInto('shared_space_person')
          .values({ spaceId: space.id, name: 'Alice', type: 'person', isHidden: false })
          .returningAll()
          .executeTakeFirstOrThrow();
        await sut.upsertPendingForSpacePerson([
          { spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.6 },
        ]);

        await expect(
          sut.hasPendingForSpacePerson(space.id, spacePerson.id, assetFace.id, {
            maxDistance: 0.5,
            suggestionMaxDistance: 0.5,
          }),
        ).resolves.toBe(false);
      });

      it('returns false for a pending suggestion on an asset no longer shared with the space', async () => {
        const { ctx, sut } = setup();
        const { user } = await ctx.newUser();
        const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
        const spacePerson = await ctx.database
          .insertInto('shared_space_person')
          .values({ spaceId: space.id, name: 'Alice', type: 'person', isHidden: false })
          .returningAll()
          .executeTakeFirstOrThrow();
        await sut.upsertPendingForSpacePerson([
          { spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.6 },
        ]);

        await expect(sut.hasPendingForSpacePerson(space.id, spacePerson.id, assetFace.id, opts)).resolves.toBe(true);

        await ctx.database
          .deleteFrom('shared_space_asset')
          .where('spaceId', '=', space.id)
          .where('assetId', '=', asset.id)
          .execute();

        await expect(sut.hasPendingForSpacePerson(space.id, spacePerson.id, assetFace.id, opts)).resolves.toBe(false);
      });

      it('returns false when the candidate face has already been assigned', async () => {
        const { ctx, sut } = setup();
        const { user } = await ctx.newUser();
        const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Personal' });
        const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
        const spacePerson = await ctx.database
          .insertInto('shared_space_person')
          .values({ spaceId: space.id, name: 'Alice', type: 'person', isHidden: false })
          .returningAll()
          .executeTakeFirstOrThrow();
        await sut.upsertPendingForSpacePerson([
          { spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.6 },
        ]);
        await ctx.database
          .updateTable('asset_face')
          .set({ personId: person.id })
          .where('id', '=', assetFace.id)
          .execute();

        await expect(sut.hasPendingForSpacePerson(space.id, spacePerson.id, assetFace.id, opts)).resolves.toBe(false);
      });

      it('returns false for whitespace, hidden, pet, and disabled-space people', async () => {
        const { ctx, sut } = setup();
        const { user } = await ctx.newUser();
        const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
        const { space: disabledSpace } = await ctx.newSharedSpace({
          createdById: user.id,
          faceRecognitionEnabled: false,
        });
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
        await ctx.newSharedSpaceAsset({ spaceId: disabledSpace.id, assetId: asset.id, addedById: user.id });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
        const rows = await ctx.database
          .insertInto('shared_space_person')
          .values([
            { spaceId: space.id, name: '   ', type: 'person', isHidden: false },
            { spaceId: space.id, name: 'Hidden', type: 'person', isHidden: true },
            { spaceId: space.id, name: 'Pet', type: 'pet', isHidden: false },
            { spaceId: disabledSpace.id, name: 'Disabled', type: 'person', isHidden: false },
          ])
          .returningAll()
          .execute();

        for (const person of rows) {
          await sut.upsertPendingForSpacePerson([
            { spacePersonId: person.id, assetFaceId: assetFace.id, distance: 0.6 },
          ]);
          await expect(sut.hasPendingForSpacePerson(person.spaceId, person.id, assetFace.id, opts)).resolves.toBe(
            false,
          );
        }
      });

      it('returns false after a linked library is unlinked from the space', async () => {
        const { ctx, sut } = setup();
        const { user } = await ctx.newUser();
        const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
        const { library } = await ctx.newLibrary({ ownerId: user.id });
        await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: user.id });
        const { asset } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
        const spacePerson = await ctx.database
          .insertInto('shared_space_person')
          .values({ spaceId: space.id, name: 'Alice', type: 'person', isHidden: false })
          .returningAll()
          .executeTakeFirstOrThrow();
        await sut.upsertPendingForSpacePerson([
          { spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.6 },
        ]);

        await expect(sut.hasPendingForSpacePerson(space.id, spacePerson.id, assetFace.id, opts)).resolves.toBe(true);

        await ctx.database
          .deleteFrom('shared_space_library')
          .where('spaceId', '=', space.id)
          .where('libraryId', '=', library.id)
          .execute();

        await expect(sut.hasPendingForSpacePerson(space.id, spacePerson.id, assetFace.id, opts)).resolves.toBe(false);
      });
    });

    it('resolveAssignedFace deletes pending personal and space-person rows for the same face', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Personal' });
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, name: 'Space' })
        .returningAll()
        .executeTakeFirstOrThrow();

      await sut.upsertPending([{ personId: person.id, assetFaceId: assetFace.id, distance: 0.65 }]);
      await sut.upsertPendingForSpacePerson([
        { spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.7 },
      ]);
      await sut.resolveAssignedFace(assetFace.id);

      const pending = await defaultDatabase
        .selectFrom('person_face_suggestion')
        .selectAll()
        .where('assetFaceId', '=', assetFace.id)
        .where('status', '=', 'pending')
        .execute();
      expect(pending).toEqual([]);
    });
  });
});
