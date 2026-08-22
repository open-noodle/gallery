import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { newEmbedding } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let database: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, { database, real: [], mock: [LoggingRepository] });
  return { ctx, sut: ctx.get(FaceIdentityRepository) };
};

beforeAll(async () => {
  database = await getKyselyDB('facemove864');
});

const seedFace = async (ctx: any, userId: string, identityId: string) => {
  const { person } = await ctx.newPerson({ ownerId: userId, name: 'Alice' });
  const { asset } = await ctx.newAsset({ ownerId: userId, visibility: AssetVisibility.Timeline });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
  await database.insertInto('face_search').values({ faceId: assetFace.id, embedding: newEmbedding() }).execute();
  await database
    .insertInto('face_identity_face')
    .values({ assetFaceId: assetFace.id, identityId, source: 'owner-person' })
    .execute();
  return assetFace;
};

const newIdentity = () =>
  database.insertInto('face_identity').values({ type: 'person' }).returning('id').executeTakeFirstOrThrow();

const newSpacePerson = (spaceId: string, identityId: string) =>
  database.insertInto('shared_space_person').values({ spaceId, identityId }).returning('id').executeTakeFirstOrThrow();

const moveOn = (sut: FaceIdentityRepository) =>
  (
    sut as unknown as {
      moveSpacePersonFacesForIdentity: (input: {
        fromPersonId: string;
        toPersonId: string;
        identityId: string;
      }) => Promise<void>;
    }
  ).moveSpacePersonFacesForIdentity.bind(sut);

const facesOf = (personId: string) =>
  database.selectFrom('shared_space_person_face').select('assetFaceId').where('personId', '=', personId).execute();

describe(`${FaceIdentityRepository.name} space face move (#864)`, () => {
  // Orphan cleanup runs concurrently with the identity backfill during a library unmap, so the
  // person the backfill resolved as its move target can be deleted before the move executes.
  // Reassigning onto a missing person violates shared_space_person_face_personId_fkey and kills
  // the whole FaceIdentityBackfill job.
  it('skips the move when the target person no longer exists', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });

    const identity = await database
      .insertInto('face_identity')
      .values({ type: 'person' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
    const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    await database.insertInto('face_search').values({ faceId: assetFace.id, embedding: newEmbedding() }).execute();
    await database
      .insertInto('face_identity_face')
      .values({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' })
      .execute();

    const source = await database
      .insertInto('shared_space_person')
      .values({ spaceId: space.id, identityId: identity.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await database
      .insertInto('shared_space_person_face')
      .values({ personId: source.id, assetFaceId: assetFace.id })
      .execute();

    const move = (
      sut as unknown as {
        moveSpacePersonFacesForIdentity: (input: {
          fromPersonId: string;
          toPersonId: string;
          identityId: string;
        }) => Promise<void>;
      }
    ).moveSpacePersonFacesForIdentity.bind(sut);

    // The target was deleted by orphan cleanup between resolution and the move.
    const deletedTargetId = '00000000-0000-4000-8000-000000000864';

    await expect(
      move({ fromPersonId: source.id, toPersonId: deletedTargetId, identityId: identity.id }),
    ).resolves.not.toThrow();

    // the face stays attached to its original person rather than being orphaned
    await expect(
      database
        .selectFrom('shared_space_person_face')
        .select('personId')
        .where('assetFaceId', '=', assetFace.id)
        .executeTakeFirst(),
    ).resolves.toEqual({ personId: source.id });
  });

  // Guards the behaviour the #864 fix must NOT break: with a live target the move still happens.
  it('moves the faces when the target person exists', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const identity = await newIdentity();
    const assetFace = await seedFace(ctx, user.id, identity.id);
    const source = await newSpacePerson(space.id, identity.id);
    const target = await newSpacePerson(space.id, null as unknown as string);
    await database
      .insertInto('shared_space_person_face')
      .values({ personId: source.id, assetFaceId: assetFace.id })
      .execute();

    await moveOn(sut)({ fromPersonId: source.id, toPersonId: target.id, identityId: identity.id });

    await expect(facesOf(target.id)).resolves.toEqual([{ assetFaceId: assetFace.id }]);
    await expect(facesOf(source.id)).resolves.toEqual([]);
  });

  // The target may already hold the same face; moving would violate the (personId, assetFaceId)
  // uniqueness, so the source row is dropped instead.
  it('drops the source row when the target already holds that face', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const identity = await newIdentity();
    const assetFace = await seedFace(ctx, user.id, identity.id);
    const source = await newSpacePerson(space.id, identity.id);
    const target = await newSpacePerson(space.id, null as unknown as string);
    await database
      .insertInto('shared_space_person_face')
      .values([
        { personId: source.id, assetFaceId: assetFace.id },
        { personId: target.id, assetFaceId: assetFace.id },
      ])
      .execute();

    await moveOn(sut)({ fromPersonId: source.id, toPersonId: target.id, identityId: identity.id });

    await expect(facesOf(source.id)).resolves.toEqual([]);
    await expect(facesOf(target.id)).resolves.toEqual([{ assetFaceId: assetFace.id }]);
  });

  it('moves only the faces of the requested identity, leaving others behind', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const identity = await newIdentity();
    const otherIdentity = await newIdentity();
    const matchingFace = await seedFace(ctx, user.id, identity.id);
    const otherFace = await seedFace(ctx, user.id, otherIdentity.id);
    const source = await newSpacePerson(space.id, identity.id);
    const target = await newSpacePerson(space.id, null as unknown as string);
    await database
      .insertInto('shared_space_person_face')
      .values([
        { personId: source.id, assetFaceId: matchingFace.id },
        { personId: source.id, assetFaceId: otherFace.id },
      ])
      .execute();

    await moveOn(sut)({ fromPersonId: source.id, toPersonId: target.id, identityId: identity.id });

    await expect(facesOf(target.id)).resolves.toEqual([{ assetFaceId: matchingFace.id }]);
    await expect(facesOf(source.id)).resolves.toEqual([{ assetFaceId: otherFace.id }]);
  });
});
