import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { AssetVisibility, SharedSpaceRole, SystemMetadataKey } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonFaceSuggestionRepository } from 'src/repositories/person-face-suggestion.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { SharedSpaceService } from 'src/services/shared-space.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const setup = (db?: Kysely<DB>) =>
  newMediumService(SharedSpaceService, {
    database: db || defaultDatabase,
    real: [
      SharedSpaceRepository,
      PersonFaceSuggestionRepository,
      FaceIdentityRepository,
      ConfigRepository,
      SystemMetadataRepository,
    ],
    mock: [LoggingRepository, JobRepository],
  });

const authFor = (user: { id: string; name: string; email: string; isAdmin?: boolean }) =>
  factory.auth({ user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin } });

const enableSuggestionBand = async (ctx: ReturnType<typeof setup>['ctx']) => {
  await ctx.get(SystemMetadataRepository).set(SystemMetadataKey.SystemConfig, {
    machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8 } },
  } as any);
};

const createSuggestionFixture = async (
  ctx: ReturnType<typeof setup>['ctx'],
  input: { reviewerRole?: SharedSpaceRole; faceRecognitionEnabled?: boolean } = {},
) => {
  await enableSuggestionBand(ctx);

  const { user: owner } = await ctx.newUser();
  const { user: reviewer } = await ctx.newUser();
  const { user: assetOwner } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({
    createdById: owner.id,
    faceRecognitionEnabled: input.faceRecognitionEnabled ?? true,
  });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({
    spaceId: space.id,
    userId: reviewer.id,
    role: input.reviewerRole ?? SharedSpaceRole.Editor,
  });
  const { asset } = await ctx.newAsset({ ownerId: assetOwner.id, visibility: AssetVisibility.Timeline });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({ spaceId: space.id, name: 'Alice', type: 'person', isHidden: false, identityId: null })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('person_face_suggestion')
    .values({ spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.6 })
    .execute();

  return { owner, reviewer, assetOwner, space, asset, assetFace, spacePerson };
};

describe('SharedSpaceService space face suggestions', () => {
  it('returns suggestions to editors and an empty page to viewers (edge 24)', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx, { reviewerRole: SharedSpaceRole.Viewer });

    await expect(
      sut.getSpacePersonFaceSuggestions(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, { page: 1, size: 50 }),
    ).resolves.toEqual({ total: 0, items: [] });

    await ctx.database
      .updateTable('shared_space_member')
      .set({ role: SharedSpaceRole.Editor })
      .where('spaceId', '=', fx.space.id)
      .where('userId', '=', fx.reviewer.id)
      .execute();

    const result = await sut.getSpacePersonFaceSuggestions(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, {
      page: 1,
      size: 50,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(expect.objectContaining({ assetFaceId: fx.assetFace.id, assetId: fx.asset.id }));
  });

  it('denies viewer confirm/dismiss without mutating rows (edge 24 absence)', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx, { reviewerRole: SharedSpaceRole.Viewer });

    await expect(
      sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      sut.dismissSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const row = await ctx.database
      .selectFrom('person_face_suggestion')
      .select(['status'])
      .where('spacePersonId', '=', fx.spacePerson.id)
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('pending');
  });

  it('rejects a route person from another space with no identity mutation', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);
    const { space: otherSpace } = await ctx.newSharedSpace({ createdById: fx.owner.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: otherSpace.id, userId: fx.reviewer.id, role: SharedSpaceRole.Editor });

    await expect(
      sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), otherSpace.id, fx.spacePerson.id, fx.assetFace.id),
    ).rejects.toBeInstanceOf(BadRequestException);

    const person = await ctx.database
      .selectFrom('shared_space_person')
      .select(['identityId'])
      .where('id', '=', fx.spacePerson.id)
      .executeTakeFirstOrThrow();
    expect(person.identityId).toBeNull();
  });

  it('confirm creates a missing space identity, links the candidate face, and keeps asset_face ownership unchanged (edges 26 and 31)', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);

    await sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id);

    const person = await ctx.database
      .selectFrom('shared_space_person')
      .select(['identityId'])
      .where('id', '=', fx.spacePerson.id)
      .executeTakeFirstOrThrow();
    expect(person.identityId).toEqual(expect.any(String));

    const link = await ctx.database
      .selectFrom('face_identity_face')
      .select(['identityId', 'source'])
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(link).toEqual({ identityId: person.identityId!, source: 'manual' });

    const face = await ctx.database
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .select(['asset_face.personId', 'asset.ownerId'])
      .where('asset_face.id', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(face.personId).toBeNull();
    expect(face.ownerId).toBe(fx.assetOwner.id);
  });

  it('confirm clears other pending personal and space suggestions for the same face (edge 28)', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);
    const { person } = await ctx.newPerson({ ownerId: fx.assetOwner.id, name: 'Personal Alice' });
    await ctx.database
      .insertInto('person_face_suggestion')
      .values({ personId: person.id, assetFaceId: fx.assetFace.id, distance: 0.61 })
      .execute();
    const otherSpacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId: fx.space.id, name: 'Other Alice', type: 'person', isHidden: false })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('person_face_suggestion')
      .values({ spacePersonId: otherSpacePerson.id, assetFaceId: fx.assetFace.id, distance: 0.62 })
      .execute();

    await sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id);

    const rows = await ctx.database
      .selectFrom('person_face_suggestion')
      .select(['personId', 'spacePersonId', 'status'])
      .where('assetFaceId', '=', fx.assetFace.id)
      .execute();
    expect(rows).toEqual([expect.objectContaining({ spacePersonId: fx.spacePerson.id, status: 'confirmed' })]);
  });

  it('confirm overwrites an existing face identity link (edge 32)', async () => {
    const { ctx, sut } = setup();
    const faceIdentityRepository = ctx.get(FaceIdentityRepository);
    const fx = await createSuggestionFixture(ctx);
    const { person: oldPerson } = await ctx.newPerson({ ownerId: fx.assetOwner.id, name: 'Old' });
    const oldIdentity = await faceIdentityRepository.ensurePersonIdentity(oldPerson.id);
    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: fx.assetFace.id,
      identityId: oldIdentity.id,
      source: 'manual',
    });
    const otherSpacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId: fx.space.id, name: 'Other Candidate', type: 'person', isHidden: false })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('person_face_suggestion')
      .values({ spacePersonId: otherSpacePerson.id, assetFaceId: fx.assetFace.id, distance: 0.62 })
      .execute();

    await sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id);

    const spacePerson = await ctx.database
      .selectFrom('shared_space_person')
      .select('identityId')
      .where('id', '=', fx.spacePerson.id)
      .executeTakeFirstOrThrow();
    const link = await ctx.database
      .selectFrom('face_identity_face')
      .select(['identityId', 'source'])
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(link).toEqual({ identityId: spacePerson.identityId!, source: 'manual' });
    const rows = await ctx.database
      .selectFrom('person_face_suggestion')
      .select(['spacePersonId', 'status'])
      .where('assetFaceId', '=', fx.assetFace.id)
      .execute();
    expect(rows).toEqual([expect.objectContaining({ spacePersonId: fx.spacePerson.id, status: 'confirmed' })]);
  });

  it('confirm and dismiss no-op stale unshared candidates (edge 21)', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);
    await ctx.database
      .deleteFrom('shared_space_asset')
      .where('spaceId', '=', fx.space.id)
      .where('assetId', '=', fx.asset.id)
      .execute();

    await expect(
      sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
    ).resolves.toBeUndefined();
    await expect(
      sut.dismissSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
    ).resolves.toBeUndefined();

    const person = await ctx.database
      .selectFrom('shared_space_person')
      .select('identityId')
      .where('id', '=', fx.spacePerson.id)
      .executeTakeFirstOrThrow();
    const row = await ctx.database
      .selectFrom('person_face_suggestion')
      .select('status')
      .where('spacePersonId', '=', fx.spacePerson.id)
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(person.identityId).toBeNull();
    expect(row.status).toBe('pending');
  });

  it('dismiss marks only the target suggestion and leaves identity graph unchanged', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);

    await sut.dismissSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id);

    const row = await ctx.database
      .selectFrom('person_face_suggestion')
      .select('status')
      .where('spacePersonId', '=', fx.spacePerson.id)
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    const link = await ctx.database
      .selectFrom('face_identity_face')
      .select('assetFaceId')
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirst();
    expect(row.status).toBe('rejected');
    expect(link).toBeUndefined();
  });
});
