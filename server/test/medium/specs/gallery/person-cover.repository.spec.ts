import { Kysely, sql } from 'kysely';
import { AssetFileType, AssetType, AssetVisibility } from 'src/enum.js';
import { PersonCoverRepository } from 'src/gallery/repositories/person-cover.repository.js';
import { PERSON_COVER_VERSION } from 'src/gallery/utils/person-cover.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { DB } from 'src/schema/index.js';
import { up } from 'src/schema/migrations-gallery/1800200000000-AddPersonCoverTables.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { newEmbedding } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

// specs/2026-11-21-person-cover-quality-design.md: the candidate rules, the Missing / All selection over the three
// states, the identity query, the guarded writes and the migration's unknown rows, against a real database.
let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [PersonRepository, PersonCoverRepository],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(PersonCoverRepository) };
};

type Ctx = ReturnType<typeof setup>['ctx'];

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

/** A photo with a preview and one face of `personGroupId`, embedded. */
const photoFace = async (
  ctx: Ctx,
  { ownerId, personGroupId, ...asset }: { ownerId: string; personGroupId: string | null } & Record<string, unknown>,
) => {
  const { asset: photo } = await ctx.newAsset({ ownerId, type: AssetType.Image, ...asset });
  await ctx.newAssetFile({ assetId: photo.id, type: AssetFileType.Preview, path: `/thumbs/${photo.id}_preview.jpeg` });
  const { assetFace } = await ctx.newAssetFace({
    assetId: photo.id,
    personGroupId,
    boundingBoxX1: 10,
    boundingBoxY1: 20,
    boundingBoxX2: 110,
    boundingBoxY2: 170,
  });
  await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: newEmbedding() }).execute();
  return { asset: photo, face: assetFace };
};

const setCover = (ctx: Ctx, personGroupId: string, faceAssetId: string | null) =>
  ctx.database.updateTable('person').set({ faceAssetId }).where('personGroupId', '=', personGroupId).execute();

const writeCover = (
  ctx: Ctx,
  row: { personGroupId: string; faceId: string | null; source: 'auto' | 'manual' | 'unknown'; version?: number | null },
  candidateCount: number | null = null,
) =>
  ctx.database
    .insertInto('person_cover')
    .values({ version: null, ...row, candidateCount })
    .onConflict((oc) => oc.column('personGroupId').doUpdateSet({ ...row, candidateCount }))
    .execute();

/** One person in each state the Missing and All selections tell apart. */
const peopleInEveryState = async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const person = async (name: string, extra: Record<string, unknown> = {}) => {
    const { person } = await ctx.newPerson({ ownerId: user.id, name, ...extra });
    const { face } = await photoFace(ctx, { ownerId: user.id, personGroupId: person.personGroupId });
    await photoFace(ctx, { ownerId: user.id, personGroupId: person.personGroupId });
    await setCover(ctx, person.personGroupId, face.id);
    return { id: person.personGroupId, face: face.id };
  };

  const created = await person('created since the table');
  const fresh = await person('fresh automatic pick');
  await writeCover(
    ctx,
    { personGroupId: fresh.id, faceId: fresh.face, source: 'auto', version: PERSON_COVER_VERSION },
    2,
  );
  const older = await person('pick from an older version');
  await writeCover(ctx, { personGroupId: older.id, faceId: older.face, source: 'auto', version: 0 }, 2);
  const grown = await person('grown since the pick');
  await writeCover(
    ctx,
    { personGroupId: grown.id, faceId: grown.face, source: 'auto', version: PERSON_COVER_VERSION },
    1,
  );
  const manual = await person('hand-picked');
  await writeCover(ctx, { personGroupId: manual.id, faceId: manual.face, source: 'manual' });
  const lostManual = await person('hand-picked face gone');
  await writeCover(ctx, {
    personGroupId: lostManual.id,
    faceId: 'ffffffff-0000-4000-8000-000000000000',
    source: 'manual',
  });
  const unknown = await person('from before the table');
  await writeCover(ctx, { personGroupId: unknown.id, faceId: unknown.face, source: 'unknown' });
  const hidden = await person('hidden', { isHidden: true });
  const pet = await person('pet', { type: 'pet' });

  const ids = {
    created: created.id,
    fresh: fresh.id,
    older: older.id,
    grown: grown.id,
    manual: manual.id,
    lostManual: lostManual.id,
    unknown: unknown.id,
    hidden: hidden.id,
    pet: pet.id,
  };
  const names = Object.fromEntries(Object.entries(ids).map(([name, id]) => [id, name]));
  const pick = async (force: boolean) => {
    const rows = await Array.fromAsync(sut.streamPeopleToPick({ force }));
    return rows
      .map(({ personGroupId }) => names[personGroupId])
      .filter(Boolean)
      .toSorted();
  };
  return { pick };
};

describe(PersonCoverRepository.name, () => {
  describe('getPersonCandidates', () => {
    it('keeps only visible, embedded photo faces on timeline images, one per photo', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { person: other } = await ctx.newPerson({ ownerId: user.id });
      const personGroupId = person.personGroupId;

      const { face: kept } = await photoFace(ctx, { ownerId: user.id, personGroupId });
      await ctx.newExif({ assetId: kept.assetId, make: 'Canon' });

      // Everything below is left out.
      await photoFace(ctx, { ownerId: user.id, personGroupId, type: AssetType.Video });
      for (const visibility of [AssetVisibility.Locked, AssetVisibility.Hidden, AssetVisibility.Archive]) {
        await photoFace(ctx, { ownerId: user.id, personGroupId, visibility });
      }
      await photoFace(ctx, { ownerId: user.id, personGroupId, deletedAt: new Date() });
      await photoFace(ctx, { ownerId: user.id, personGroupId, isOffline: true });

      const invisible = await photoFace(ctx, { ownerId: user.id, personGroupId });
      await ctx.database
        .updateTable('asset_face')
        .set({ isVisible: false })
        .where('id', '=', invisible.face.id)
        .execute();

      const deleted = await photoFace(ctx, { ownerId: user.id, personGroupId });
      await ctx.database
        .updateTable('asset_face')
        .set({ deletedAt: new Date() })
        .where('id', '=', deleted.face.id)
        .execute();

      const unembedded = await photoFace(ctx, { ownerId: user.id, personGroupId });
      await ctx.database.deleteFrom('face_search').where('faceId', '=', unembedded.face.id).execute();

      const videoFace = await photoFace(ctx, { ownerId: user.id, personGroupId });
      await ctx.database
        .insertInto('asset_face_video_frame')
        .values({ faceId: videoFace.face.id, path: '/thumbs/frame.jpeg', timeSeconds: 1, quality: 0.5, version: 1 })
        .execute();

      // Two faces of the person on one photo: one is misfiled, so neither counts.
      const twice = await photoFace(ctx, { ownerId: user.id, personGroupId });
      const { assetFace: second } = await ctx.newAssetFace({ assetId: twice.asset.id, personGroupId });
      await ctx.database.insertInto('face_search').values({ faceId: second.id, embedding: newEmbedding() }).execute();

      // Someone else's face on the same photo as a kept one does not count against it.
      await ctx.newAssetFace({ assetId: kept.assetId, personGroupId: other.personGroupId });

      const candidates = await sut.getPersonCandidates(personGroupId);

      expect(candidates.map(({ faceId }) => faceId)).toEqual([kept.id]);
      expect(candidates[0]).toEqual(
        expect.objectContaining({
          assetId: kept.assetId,
          trustedDate: true,
          size: 100,
          previewPath: `/thumbs/${kept.assetId}_preview.jpeg`,
          boundingBoxX1: 10,
          boundingBoxY2: 170,
        }),
      );
      expect(candidates[0].embedding).toHaveLength(512);
    });

    it('trusts a date the owner locked, not a photo without a camera make', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { face: scan } = await photoFace(ctx, { ownerId: user.id, personGroupId: person.personGroupId });
      const { face: edited } = await photoFace(ctx, { ownerId: user.id, personGroupId: person.personGroupId });
      await ctx.newExif({ assetId: scan.assetId, make: null });
      await ctx.newExif({ assetId: edited.assetId, lockedProperties: ['dateTimeOriginal'] });

      const candidates = await sut.getPersonCandidates(person.personGroupId);
      const trusted = Object.fromEntries(candidates.map((candidate) => [candidate.faceId, candidate.trustedDate]));

      expect(trusted).toEqual({ [scan.id]: false, [edited.id]: true });
    });
  });

  describe('getSpacePersonCandidates', () => {
    it('keeps only the space person faces on photos reachable in its space', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const inSpace = await photoFace(ctx, { ownerId: user.id, personGroupId: null });
      const outside = await photoFace(ctx, { ownerId: user.id, personGroupId: null });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: inSpace.asset.id });
      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, representativeFaceId: inSpace.face.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      await ctx.database
        .insertInto('shared_space_person_face')
        .values([
          { personId: spacePerson.id, assetFaceId: inSpace.face.id },
          { personId: spacePerson.id, assetFaceId: outside.face.id },
        ])
        .execute();

      const candidates = await sut.getSpacePersonCandidates(spacePerson.id);

      expect(candidates.map(({ faceId }) => faceId)).toEqual([inSpace.face.id]);
    });
  });

  describe('streamPeopleToPick', () => {
    it('takes the stale automatic covers on a Missing run', async () => {
      const { pick } = await peopleInEveryState();

      await expect(pick(false)).resolves.toEqual(['created', 'grown', 'lostManual', 'older'].toSorted());
    });

    it('takes every cover not hand-picked on an All run, including those from before the table', async () => {
      const { pick } = await peopleInEveryState();

      await expect(pick(true)).resolves.toEqual(
        ['created', 'fresh', 'grown', 'lostManual', 'older', 'unknown'].toSorted(),
      );
    });
  });

  describe('getIdentityHandPickedCovers', () => {
    it('lists the holding hand picks of the personal and space profiles of an identity', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const identity = await ctx.database
        .insertInto('face_identity')
        .values({ type: 'person' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const { person: mine } = await ctx.newPerson({ ownerId: user.id, identityId: identity.id });
      const { person: theirs } = await ctx.newPerson({ ownerId: other.id, identityId: identity.id });
      const { face: myFace } = await photoFace(ctx, { ownerId: user.id, personGroupId: mine.personGroupId });
      const { face: theirFace } = await photoFace(ctx, { ownerId: other.id, personGroupId: theirs.personGroupId });
      await setCover(ctx, mine.personGroupId, myFace.id);
      await setCover(ctx, theirs.personGroupId, theirFace.id);
      await writeCover(ctx, { personGroupId: mine.personGroupId, faceId: myFace.id, source: 'manual' });
      // Not holding any more: the hand-picked face is no longer the cover.
      await writeCover(ctx, { personGroupId: theirs.personGroupId, faceId: myFace.id, source: 'manual' });

      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.database
        .insertInto('shared_space_person')
        .values({
          spaceId: space.id,
          identityId: identity.id,
          representativeFaceId: theirFace.id,
          representativeFaceSource: 'manual',
        })
        .execute();

      const covers = await sut.getIdentityHandPickedCovers(identity.id);

      expect(covers).toEqual(
        expect.arrayContaining([
          { faceId: myFace.id, facePersonGroupId: mine.personGroupId },
          { faceId: theirFace.id, facePersonGroupId: theirs.personGroupId },
        ]),
      );
      expect(covers).toHaveLength(2);
    });
  });

  describe('applyPersonPick', () => {
    it('sets the cover and records an automatic pick', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { face: old } = await photoFace(ctx, { ownerId: user.id, personGroupId: person.personGroupId });
      const { face: best } = await photoFace(ctx, { ownerId: user.id, personGroupId: person.personGroupId });
      await setCover(ctx, person.personGroupId, old.id);

      await expect(
        sut.applyPersonPick({
          personGroupId: person.personGroupId,
          faceId: best.id,
          candidateCount: 2,
          mode: 'missing',
        }),
      ).resolves.toBe('changed');

      const row = await ctx.database
        .selectFrom('person')
        .innerJoin('person_cover', 'person_cover.personGroupId', 'person.personGroupId')
        .select(['person.faceAssetId', 'person_cover.faceId', 'source', 'candidateCount', 'version'])
        .where('person.personGroupId', '=', person.personGroupId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({
        faceAssetId: best.id,
        faceId: best.id,
        source: 'auto',
        candidateCount: 2,
        version: PERSON_COVER_VERSION,
      });
    });

    it('leaves a cover picked by hand while the previews were read, and writes nothing', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { face: handPicked } = await photoFace(ctx, { ownerId: user.id, personGroupId: person.personGroupId });
      const { face: best } = await photoFace(ctx, { ownerId: user.id, personGroupId: person.personGroupId });
      await setCover(ctx, person.personGroupId, handPicked.id);
      await sut.recordHandPick(person.personGroupId, handPicked.id);

      for (const mode of ['missing', 'all'] as const) {
        await expect(
          sut.applyPersonPick({ personGroupId: person.personGroupId, faceId: best.id, candidateCount: 2, mode }),
        ).resolves.toBe('skipped');
      }

      const after = await ctx.database
        .selectFrom('person')
        .innerJoin('person_cover', 'person_cover.personGroupId', 'person.personGroupId')
        .select(['person.faceAssetId', 'source'])
        .where('person.personGroupId', '=', person.personGroupId)
        .executeTakeFirstOrThrow();
      expect(after).toEqual({ faceAssetId: handPicked.id, source: 'manual' });

      // Choose automatically replaces it: the owner asked.
      await expect(
        sut.applyPersonPick({
          personGroupId: person.personGroupId,
          faceId: best.id,
          candidateCount: 2,
          mode: 'action',
        }),
      ).resolves.toBe('changed');
    });

    it('does not set a face that left the person meanwhile', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { person: other } = await ctx.newPerson({ ownerId: user.id });
      const { face: current } = await photoFace(ctx, { ownerId: user.id, personGroupId: person.personGroupId });
      const { face: moved } = await photoFace(ctx, { ownerId: user.id, personGroupId: other.personGroupId });
      await setCover(ctx, person.personGroupId, current.id);

      await expect(
        sut.applyPersonPick({ personGroupId: person.personGroupId, faceId: moved.id, candidateCount: 2, mode: 'all' }),
      ).resolves.toBe('skipped');
    });
  });

  describe('applySpacePersonPick', () => {
    it('updates an automatic space cover, never a hand-picked one', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const { face: current } = await photoFace(ctx, { ownerId: user.id, personGroupId: null });
      const { face: best } = await photoFace(ctx, { ownerId: user.id, personGroupId: null });
      const spacePerson = async (representativeFaceSource: 'auto' | 'manual') => {
        const row = await ctx.database
          .insertInto('shared_space_person')
          .values({ spaceId: space.id, representativeFaceId: current.id, representativeFaceSource })
          .returning('id')
          .executeTakeFirstOrThrow();
        await ctx.database
          .insertInto('shared_space_person_face')
          .values([
            { personId: row.id, assetFaceId: current.id },
            { personId: row.id, assetFaceId: best.id },
          ])
          .execute();
        return row.id;
      };
      const auto = await spacePerson('auto');
      const manual = await spacePerson('manual');

      await expect(sut.applySpacePersonPick({ spacePersonId: auto, faceId: best.id, candidateCount: 2 })).resolves.toBe(
        'changed',
      );
      await expect(
        sut.applySpacePersonPick({ spacePersonId: manual, faceId: best.id, candidateCount: 2 }),
      ).resolves.toBe('skipped');

      const faces = await ctx.database
        .selectFrom('shared_space_person')
        .select(['id', 'representativeFaceId'])
        .where('id', 'in', [auto, manual])
        .execute();
      expect(Object.fromEntries(faces.map((row) => [row.id, row.representativeFaceId]))).toEqual({
        [auto]: best.id,
        [manual]: current.id,
      });
      await expect(sut.getSpacePersonCover(auto)).resolves.toEqual({
        faceId: best.id,
        candidateCount: 2,
        version: PERSON_COVER_VERSION,
      });
      await expect(sut.getSpacePersonCover(manual)).resolves.toBeUndefined();
    });
  });

  describe('migration 1800200000000-AddPersonCoverTables', () => {
    it('marks every existing cover unknown and leaves people without a cover rowless', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const { person: withCover } = await ctx.newPerson({ ownerId: user.id });
      const { person: withoutCover } = await ctx.newPerson({ ownerId: user.id });
      const { face } = await photoFace(ctx, { ownerId: user.id, personGroupId: withCover.personGroupId });
      await setCover(ctx, withCover.personGroupId, face.id);

      // Re-run up() on a database that has no cover tables yet, inside a transaction that is rolled back.
      const rolledBack = new Error('roll back');
      const rows = await ctx.database
        .transaction()
        .execute(async (trx) => {
          await sql`DROP TABLE "shared_space_person_cover"`.execute(trx);
          await sql`DROP TABLE "person_cover"`.execute(trx);
          await up(trx);
          const result = await trx
            .selectFrom('person_cover')
            .select(['personGroupId', 'faceId', 'source'])
            .where('personGroupId', 'in', [withCover.personGroupId, withoutCover.personGroupId])
            .execute();
          throw Object.assign(rolledBack, { result });
        })
        .catch((error: Error & { result?: unknown }) => {
          if (error !== rolledBack) {
            throw error;
          }
          return error.result;
        });

      expect(rows).toEqual([{ personGroupId: withCover.personGroupId, faceId: face.id, source: 'unknown' }]);
    });
  });
});
