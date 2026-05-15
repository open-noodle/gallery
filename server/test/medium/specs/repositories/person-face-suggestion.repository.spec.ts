import { Kysely } from 'kysely';
import { PersonFaceSuggestionRepository } from 'src/repositories/person-face-suggestion.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
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
});
