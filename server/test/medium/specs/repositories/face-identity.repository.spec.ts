import { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { AssetVisibility, SharedSpaceRole } from 'src/enum';
import {
  FaceIdentityRepository,
  type SharedSpaceFaceMatchBackfillTarget,
} from 'src/repositories/face-identity.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { newEmbedding, newUuid } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [FaceIdentityRepository],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(FaceIdentityRepository) };
};

type FaceIdentityRepositoryInternals = {
  getSharedSpaceFaceMatchTargetsForAssetFaces(
    assetFaceIds: string[],
  ): Promise<Array<{ spaceId: string; assetId: string }>>;
  addPendingSharedSpaceFaceMatchBackfillTargets(
    targets: SharedSpaceFaceMatchBackfillTarget[],
  ): Promise<SharedSpaceFaceMatchBackfillTarget[]>;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

// Seeds one owned identity with `assets` distinct timeline photos, for the total/hidden
// characterisation cases. Declared at module scope: eslint's consistent-function-scoping rejects
// helpers defined inside a describe block.
const seedCharacterisationIdentity = async (
  ctx: ReturnType<typeof setup>['ctx'],
  sut: FaceIdentityRepository,
  input: { userId: string; name: string; assets: number; isHidden?: boolean },
) => {
  const { person } = await ctx.newPerson({
    ownerId: input.userId,
    name: input.name,
    isHidden: input.isHidden ?? false,
  });
  const identity = await sut.ensurePersonIdentity(person.personGroupId);
  for (let index = 0; index < input.assets; index++) {
    const { asset } = await ctx.newAsset({ ownerId: input.userId, visibility: AssetVisibility.Timeline });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
  }
  return { person, identity };
};

const newSpacePerson = async (ctx: ReturnType<typeof setup>['ctx'], spaceId: string) => {
  return ctx.database.insertInto('shared_space_person').values({ spaceId }).returningAll().executeTakeFirstOrThrow();
};

const linkSpaceFace = async (ctx: ReturnType<typeof setup>['ctx'], personId: string, assetFaceId: string) => {
  await ctx.database.insertInto('shared_space_person_face').values({ personId, assetFaceId }).execute();
};

const setMemberTimeline = async (
  ctx: ReturnType<typeof setup>['ctx'],
  input: { spaceId: string; userId: string; showInTimeline: boolean },
) => {
  await ctx.database
    .updateTable('shared_space_member')
    .set({ showInTimeline: input.showInTimeline })
    .where('spaceId', '=', input.spaceId)
    .where('userId', '=', input.userId)
    .execute();
};

const createAccessibleSpaceIdentity = async (
  ctx: ReturnType<typeof setup>['ctx'],
  sut: FaceIdentityRepository,
  input: { memberUserId: string; ownerUserId: string; showInTimeline?: boolean; embedding: string },
) => {
  const { space } = await ctx.newSharedSpace({ createdById: input.ownerUserId, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: input.ownerUserId, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: input.memberUserId, role: SharedSpaceRole.Viewer });
  await ctx.database
    .updateTable('shared_space_member')
    .set({ showInTimeline: input.showInTimeline ?? true })
    .where('spaceId', '=', space.id)
    .where('userId', '=', input.memberUserId)
    .execute();
  const { person } = await ctx.newPerson({ ownerId: input.ownerUserId });
  const identity = await sut.ensurePersonIdentity(person.personGroupId);
  const { asset } = await ctx.newAsset({ ownerId: input.ownerUserId, visibility: AssetVisibility.Timeline });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: input.ownerUserId });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
  await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: input.embedding }).execute();
  await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: space.id,
      identityId: identity.id,
      representativeFaceId: assetFace.id,
      type: 'person',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await linkSpaceFace(ctx, spacePerson.id, assetFace.id);

  return { space, spacePerson, identity };
};

// One real-life person (identity I) appears in three places: Alice's library person (no birthday),
// space S where Bob set the birthday, and Dave's own library person (no birthday, never shared into
// S). Used by the birthday-visibility permission matrix to prove who may read the space-set birthday
// via `getResolvedPersonByIdentityId` — the resolver the owner asset-detail view
// (`AssetService.applyResolvedPersonMetadata`) relies on.
const seedBirthdayPermissionWorld = async (ctx: ReturnType<typeof setup>['ctx'], sut: FaceIdentityRepository) => {
  const { user: alice } = await ctx.newUser();
  const { user: bob } = await ctx.newUser();
  const { user: carol } = await ctx.newUser();
  const { user: dave } = await ctx.newUser();

  // Alice owns the global person + asset; this face anchors the shared identity.
  const { person: alicePerson } = await ctx.newPerson({ ownerId: alice.id, name: 'Ina' });
  const { asset: aliceAsset } = await ctx.newAsset({ ownerId: alice.id, visibility: AssetVisibility.Timeline });
  const { assetFace: aliceFace } = await ctx.newAssetFace({ assetId: aliceAsset.id, personGroupId: alicePerson.personGroupId });
  const identity = await sut.ensurePersonIdentity(alicePerson.personGroupId);
  await sut.linkFace({ assetFaceId: aliceFace.id, identityId: identity.id, source: 'owner-person' });

  // Space S: Alice (owner) + Bob (viewer, timeline on). The birthday is set here.
  const { space: spaceS } = await ctx.newSharedSpace({ createdById: alice.id });
  await ctx.newSharedSpaceMember({ spaceId: spaceS.id, userId: alice.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: spaceS.id, userId: bob.id, role: SharedSpaceRole.Viewer });
  await ctx.newSharedSpaceAsset({ spaceId: spaceS.id, assetId: aliceAsset.id, addedById: alice.id });
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: spaceS.id,
      identityId: identity.id,
      name: '',
      representativeFaceId: aliceFace.id,
      type: 'person',
      birthDate: '2014-02-14',
      birthDateSource: 'manual',
      birthDateSourceUpdatedAt: new Date('2026-06-10T20:41:12.000Z'),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await linkSpaceFace(ctx, spacePerson.id, aliceFace.id);

  // Dave has the SAME person in his own library (same identity) via his own asset, but is not a
  // member of space S and never set a birthday — he must never inherit Bob's space-set birthday.
  const { person: davePerson } = await ctx.newPerson({ ownerId: dave.id, name: 'Ina' });
  await ctx.database.updateTable('person').set({ identityId: identity.id }).where('personGroupId', '=', davePerson.personGroupId).execute();
  const { asset: daveAsset } = await ctx.newAsset({ ownerId: dave.id, visibility: AssetVisibility.Timeline });
  const { assetFace: daveFace } = await ctx.newAssetFace({ assetId: daveAsset.id, personGroupId: davePerson.personGroupId });
  await sut.linkFace({ assetFaceId: daveFace.id, identityId: identity.id, source: 'owner-person' });

  // Carol is a registered user with no person, asset, or space membership touching this identity.
  return {
    identity,
    spaceS,
    expectedBirthDate: '2014-02-14',
    userIds: [alice.id, bob.id, carol.id, dave.id],
    alice,
    bob,
    carol,
    dave,
  };
};

const newIdentityFace = async (
  ctx: ReturnType<typeof setup>['ctx'],
  sut: FaceIdentityRepository,
  input: {
    ownerId: string;
    name?: string;
    isHidden?: boolean;
    libraryId?: string | null;
    isOffline?: boolean;
    deletedAt?: Date | null;
    visibility?: AssetVisibility;
  },
) => {
  const { person } = await ctx.newPerson({
    ownerId: input.ownerId,
    name: input.name ?? '',
    isHidden: input.isHidden ?? false,
  });
  const { asset } = await ctx.newAsset({
    ownerId: input.ownerId,
    libraryId: input.libraryId,
    isOffline: input.isOffline ?? false,
    deletedAt: input.deletedAt ?? null,
    visibility: input.visibility ?? AssetVisibility.Timeline,
  });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
  const identity = await sut.ensurePersonIdentity(person.personGroupId);
  await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'backfill' });

  return { person, asset, assetFace, identity };
};

const newLibraryIdentityFace = async (
  ctx: ReturnType<typeof setup>['ctx'],
  sut: FaceIdentityRepository,
  input: {
    ownerId: string;
    libraryId: string;
    personId?: string;
    identityId?: string;
    visibility?: AssetVisibility;
    name?: string;
  },
) => {
  const { person } = input.personId
    ? {
        person: await ctx.database
          .selectFrom('person')
          .selectAll()
          .where('personGroupId', '=', input.personId)
          .executeTakeFirstOrThrow(),
      }
    : await ctx.newPerson({ ownerId: input.ownerId, name: input.name ?? '' });
  const identity =
    input.identityId === undefined
      ? await sut.ensurePersonIdentity(person.personGroupId)
      : { id: input.identityId, type: 'person' };
  const { asset } = await ctx.newAsset({
    ownerId: input.ownerId,
    libraryId: input.libraryId,
    visibility: input.visibility ?? AssetVisibility.Timeline,
  });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
  await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: newEmbedding() }).execute();
  await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });

  return { person, identity, asset, assetFace };
};

const getPersonalIdentityMismatchRows = async (ctx: ReturnType<typeof setup>['ctx'], assetFaceIds: string[]) => {
  const rows = await ctx.database
    .selectFrom('asset_face')
    .innerJoin('person', 'person.personGroupId', 'asset_face.personGroupId')
    .innerJoin('face_identity_face', 'face_identity_face.assetFaceId', 'asset_face.id')
    .select([
      'asset_face.id as assetFaceId',
      'asset_face.personId',
      'person.identityId as personIdentityId',
      'face_identity_face.identityId as faceIdentityId',
    ])
    .where('asset_face.id', 'in', assetFaceIds)
    .orderBy('asset_face.id')
    .execute();

  return rows.filter((row) => row.personIdentityId !== row.faceIdentityId);
};

// Two clusters on disjoint embedding axes are maximally dissimilar (cosine distance ~1.0), standing in
// for two genuinely different people. newEmbedding() can't be used here: its all-positive random
// components leave two independent vectors ~0.75 similar.
const axisEmbedding = (axis: 'first' | 'second') => {
  const values = Array.from({ length: 512 }, (_, index) => {
    const inFirstHalf = index < 256;
    return (axis === 'first' ? inFirstHalf : !inFirstHalf) ? 1 : 0;
  });
  return '[' + values.join(',') + ']';
};

// A 0/1 vector with `firstHalfOnes` ones in [0,256) and `secondHalfOnes` ones in [256,512). Against an
// all-ones-first-half centroid (axisEmbedding('first')), cosine distance = 1 - firstHalfOnes/256 when the
// total ones = 256. So blendedEmbedding(140,116) sits at distance ~0.453 and (116,140) at ~0.547 —
// straddling the 0.5 guard threshold for boundary tests.
const blendedEmbedding = (firstHalfOnes: number, secondHalfOnes: number) => {
  const values = Array.from({ length: 512 }, (_, index) => {
    if (index < firstHalfOnes) {
      return 1;
    }
    if (index >= 256 && index < 256 + secondHalfOnes) {
      return 1;
    }
    return 0;
  });
  return '[' + values.join(',') + ']';
};

const newPersonalIdentityCluster = async (
  ctx: ReturnType<typeof setup>['ctx'],
  sut: FaceIdentityRepository,
  input: { ownerId: string; embedding: string; faceCount: number },
) => {
  const { person } = await ctx.newPerson({ ownerId: input.ownerId });
  const identity = await sut.ensurePersonIdentity(person.personGroupId);
  const assetFaceIds: string[] = [];
  for (let index = 0; index < input.faceCount; index++) {
    const { asset } = await ctx.newAsset({ ownerId: input.ownerId });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: input.embedding }).execute();
    await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
    assetFaceIds.push(assetFace.id);
  }
  return { person, identity, assetFaceIds };
};

// A secondary identity backed by faces but with NO personal person pointing at it. This is the
// structural precondition that let the real corruption slip past countMergeConflicts: a duplicate
// identity with no competing named person, so the same-owner conflict check sees nothing to block.
const newOrphanIdentityCluster = async (
  ctx: ReturnType<typeof setup>['ctx'],
  input: { ownerId: string; embedding?: string; faceCount: number },
) => {
  const identity = await ctx.database
    .insertInto('face_identity')
    .values({ type: 'person' })
    .returningAll()
    .executeTakeFirstOrThrow();
  const assetFaceIds: string[] = [];
  for (let index = 0; index < input.faceCount; index++) {
    const { asset } = await ctx.newAsset({ ownerId: input.ownerId });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id });
    // embedding omitted => faces with no face_search row, exercising the "cannot assess" path.
    if (input.embedding) {
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assetFace.id, embedding: input.embedding })
        .execute();
    }
    await ctx.database
      .insertInto('face_identity_face')
      .values({ identityId: identity.id, assetFaceId: assetFace.id, source: 'backfill' })
      .execute();
    assetFaceIds.push(assetFace.id);
  }
  return { identity, assetFaceIds };
};

const getLinkedIdentityIds = async (ctx: ReturnType<typeof setup>['ctx'], assetFaceIds: string[]) => {
  const rows = await ctx.database
    .selectFrom('face_identity_face')
    .select(['assetFaceId', 'identityId'])
    .where('assetFaceId', 'in', assetFaceIds)
    .execute();
  return new Set(rows.map((row) => row.identityId));
};

describe(FaceIdentityRepository.name, () => {
  // #733 review: a manual merge may mix types (target type wins). A profile re-pointed onto the surviving identity
  // must not keep its old type — a pet-typed profile pointing at a person identity would be misread by the
  // automatic dedup/matching queries that filter on type. mergeIdentitiesAfterProfileResolution reconciles it.
  it('reconciles a re-pointed profile’s type to the surviving identity on a manual cross-type merge', async () => {
    const { sut, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: otherOwner } = await ctx.newUser();

    // Target: a person-typed identity carrying the owner's own person profile.
    const targetIdentity = await ctx.database
      .insertInto('face_identity')
      .values({ type: 'person' })
      .returningAll()
      .executeTakeFirstOrThrow();
    const { person: targetPerson } = await ctx.newPerson({ ownerId: owner.id });
    await ctx.database
      .updateTable('person')
      .set({ identityId: targetIdentity.id, type: 'person' })
      .where('personGroupId', '=', targetPerson.personGroupId)
      .execute();

    // Source: a pet-typed identity that ANOTHER owner holds a pet profile on, so the merge re-points it (survives).
    const sourceIdentity = await ctx.database
      .insertInto('face_identity')
      .values({ type: 'pet' })
      .returningAll()
      .executeTakeFirstOrThrow();
    const { person: petProfile } = await ctx.newPerson({ ownerId: otherOwner.id });
    await ctx.database
      .updateTable('person')
      .set({ identityId: sourceIdentity.id, type: 'pet' })
      .where('personGroupId', '=', petProfile.personGroupId)
      .execute();

    await sut.mergeIdentitiesAfterProfileResolution({
      targetIdentityId: targetIdentity.id,
      sourceIdentityIds: [sourceIdentity.id],
      source: 'manual',
    });

    const reconciled = await ctx.database
      .selectFrom('person')
      .select(['identityId', 'type'])
      .where('personGroupId', '=', petProfile.personGroupId)
      .executeTakeFirstOrThrow();
    expect(reconciled.identityId).toBe(targetIdentity.id);
    expect(reconciled.type).toBe('person');
  });

  it('returns no accessible identity match when multiple shared identities are within threshold', async () => {
    const { ctx, sut } = setup();
    const { user: member } = await ctx.newUser();
    const { user: ownerA } = await ctx.newUser();
    const { user: ownerB } = await ctx.newUser();
    const embedding = newEmbedding();
    try {
      await createAccessibleSpaceIdentity(ctx, sut, {
        memberUserId: member.id,
        ownerUserId: ownerA.id,
        embedding,
      });
      await createAccessibleSpaceIdentity(ctx, sut, {
        memberUserId: member.id,
        ownerUserId: ownerB.id,
        embedding,
      });

      await expect(
        sut.findClosestAccessibleIdentityForFace({
          userId: member.id,
          embedding,
          maxDistance: 0.5,
          type: 'person',
          excludeIdentityId: null,
        }),
      ).resolves.toBeUndefined();
    } finally {
      await ctx.database.deleteFrom('user').where('id', 'in', [member.id, ownerA.id, ownerB.id]).execute();
    }
  });

  it('does not use timeline-disabled spaces for global accessible identity matching', async () => {
    const { ctx, sut } = setup();
    const { user: member } = await ctx.newUser();
    const { user: owner } = await ctx.newUser();
    const embedding = newEmbedding();
    try {
      await createAccessibleSpaceIdentity(ctx, sut, {
        memberUserId: member.id,
        ownerUserId: owner.id,
        showInTimeline: false,
        embedding,
      });

      await expect(
        sut.findClosestAccessibleIdentityForFace({
          userId: member.id,
          embedding,
          maxDistance: 0.5,
          type: 'person',
          excludeIdentityId: null,
        }),
      ).resolves.toBeUndefined();
    } finally {
      await ctx.database.deleteFrom('user').where('id', 'in', [member.id, owner.id]).execute();
    }
  });

  it('treats two accessible space profiles on the same identity as one strict upload candidate', async () => {
    const { ctx, sut } = setup();
    const { user: member } = await ctx.newUser();
    const { user: owner } = await ctx.newUser();
    const embedding = newEmbedding();

    try {
      const first = await createAccessibleSpaceIdentity(ctx, sut, {
        memberUserId: member.id,
        ownerUserId: owner.id,
        embedding,
      });
      const { space: secondSpace } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: secondSpace.id, userId: owner.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceMember({ spaceId: secondSpace.id, userId: member.id, role: SharedSpaceRole.Viewer });
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      await ctx.newSharedSpaceAsset({ spaceId: secondSpace.id, assetId: asset.id, addedById: owner.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id });
      await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding }).execute();
      await sut.linkFace({
        assetFaceId: assetFace.id,
        identityId: first.identity.id,
        source: 'shared-space-evidence',
      });
      const secondSpacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({
          spaceId: secondSpace.id,
          identityId: first.identity.id,
          representativeFaceId: assetFace.id,
          type: 'person',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await linkSpaceFace(ctx, secondSpacePerson.id, assetFace.id);

      await expect(
        sut.findClosestAccessibleIdentityForFace({
          userId: member.id,
          embedding,
          maxDistance: 0.5,
          type: 'person',
          excludeIdentityId: null,
        }),
      ).resolves.toEqual(expect.objectContaining({ identityId: first.identity.id }));
    } finally {
      await ctx.database.deleteFrom('user').where('id', 'in', [member.id, owner.id]).execute();
    }
  });

  it('reports backfill work for legacy people, unlinked visible faces, and legacy space people', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      const spacePerson = await newSpacePerson(ctx, space.id);
      await linkSpaceFace(ctx, spacePerson.id, assetFace.id);

      await expect(sut.hasBackfillWork()).resolves.toBe(true);

      await sut.backfillPersonalIdentities({ limit: 100 });
      await sut.backfillSpacePersonIdentities({ limit: 100 });

      await expect(sut.getBackfillWork()).resolves.toEqual({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('repairs stale personal face identity links when the assigned person has no identity yet', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    let staleIdentityId: string | undefined;

    try {
      const staleIdentity = await ctx.database
        .insertInto('face_identity')
        .values({ type: 'person' })
        .returningAll()
        .executeTakeFirstOrThrow();
      staleIdentityId = staleIdentity.id;

      const { person } = await ctx.newPerson({ ownerId: user.id, identityId: null });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      await sut.linkFace({ assetFaceId: assetFace.id, identityId: staleIdentity.id, source: 'backfill' });

      await expect(sut.getBackfillWork()).resolves.toMatchObject({ hasPersonalIdentityWork: true });

      await sut.backfillPersonalIdentities({ limit: 100 });

      const [updatedPerson, updatedFaceLink] = await Promise.all([
        ctx.database.selectFrom('person').select(['identityId']).where('personGroupId', '=', person.personGroupId).executeTakeFirstOrThrow(),
        ctx.database
          .selectFrom('face_identity_face')
          .select(['identityId'])
          .where('assetFaceId', '=', assetFace.id)
          .executeTakeFirstOrThrow(),
      ]);

      expect(updatedPerson.identityId).toEqual(expect.any(String));
      expect(updatedFaceLink.identityId).toBe(updatedPerson.identityId);
      await expect(sut.getBackfillWork()).resolves.toMatchObject({ hasPersonalIdentityWork: false });
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      if (staleIdentityId) {
        await ctx.database.deleteFrom('face_identity').where('id', '=', staleIdentityId).execute();
      }
    }
  });

  it('classifies personal identity work separately from projection work', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { person } = await ctx.newPerson({ ownerId: user.id, identityId: null });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });

      await expect(sut.getBackfillWork()).resolves.toEqual({
        hasPersonalIdentityWork: true,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });
      await expect(sut.hasBackfillWork()).resolves.toBe(true);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('classifies shared-space identity repair separately from projection work', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      const first = await newIdentityFace(ctx, sut, { ownerId: user.id });
      const second = await newIdentityFace(ctx, sut, { ownerId: user.id });
      for (const assetId of [first.asset.id, second.asset.id]) {
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId, addedById: user.id });
      }
      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({
          spaceId: space.id,
          identityId: first.identity.id,
          representativeFaceId: first.assetFace.id,
          type: 'person',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await linkSpaceFace(ctx, spacePerson.id, first.assetFace.id);
      await linkSpaceFace(ctx, spacePerson.id, second.assetFace.id);

      await expect(sut.getBackfillWork()).resolves.toEqual({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: true,
        hasSharedSpaceProjectionWork: true,
      });
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('does not classify disconnected stale space-person faces as projection work', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      const first = await newIdentityFace(ctx, sut, { ownerId: user.id });
      const second = await newIdentityFace(ctx, sut, { ownerId: user.id });
      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({
          spaceId: space.id,
          identityId: first.identity.id,
          representativeFaceId: first.assetFace.id,
          type: 'person',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await linkSpaceFace(ctx, spacePerson.id, first.assetFace.id);
      await linkSpaceFace(ctx, spacePerson.id, second.assetFace.id);

      await expect(sut.getBackfillWork()).resolves.toEqual({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: true,
        hasSharedSpaceProjectionWork: false,
      });
      await expect(sut.getSharedSpaceFaceMatchBackfillTargets()).resolves.toEqual([]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('classifies projection work only when identities are already linked', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const linked = await newIdentityFace(ctx, sut, { ownerId: user.id });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: linked.asset.id, addedById: user.id });

      await expect(sut.getBackfillWork()).resolves.toEqual({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: true,
      });
      await expect(sut.getSharedSpaceFaceMatchBackfillTargets()).resolves.toEqual([
        { spaceId: space.id, assetId: linked.asset.id },
      ]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('returns one projection target for an asset with multiple identity-linked faces in one space', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const first = await newIdentityFace(ctx, sut, { ownerId: user.id });
      const { person: secondPerson } = await ctx.newPerson({ ownerId: user.id });
      const { assetFace: secondFace } = await ctx.newAssetFace({
        assetId: first.asset.id,
        personGroupId: secondPerson.personGroupId,
      });
      const secondIdentity = await sut.ensurePersonIdentity(secondPerson.personGroupId);
      await sut.linkFace({ assetFaceId: secondFace.id, identityId: secondIdentity.id, source: 'backfill' });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: first.asset.id, addedById: user.id });

      await expect(sut.getBackfillWork()).resolves.toMatchObject({ hasSharedSpaceProjectionWork: true });
      await expect(sut.getSharedSpaceFaceMatchBackfillTargets()).resolves.toEqual([
        { spaceId: space.id, assetId: first.asset.id },
      ]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('classifies identity-less assigned faces as identity work without projection targets', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });

      await expect(sut.getBackfillWork()).resolves.toEqual({
        hasPersonalIdentityWork: true,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });
      await expect(sut.getSharedSpaceFaceMatchBackfillTargets()).resolves.toEqual([]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('keeps projection work summary aligned with target discovery', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const linked = await newIdentityFace(ctx, sut, { ownerId: user.id });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: linked.asset.id, addedById: user.id });

      await expect(sut.getBackfillWork()).resolves.toMatchObject({ hasSharedSpaceProjectionWork: true });
      await expect(sut.getSharedSpaceFaceMatchBackfillTargets()).resolves.toEqual([
        { spaceId: space.id, assetId: linked.asset.id },
      ]);

      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({
          spaceId: space.id,
          identityId: linked.identity.id,
          representativeFaceId: linked.assetFace.id,
          type: 'person',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await linkSpaceFace(ctx, spacePerson.id, linked.assetFace.id);

      await expect(sut.getBackfillWork()).resolves.toMatchObject({ hasSharedSpaceProjectionWork: false });
      await expect(sut.getSharedSpaceFaceMatchBackfillTargets()).resolves.toEqual([]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('targets same-identity projections with an incompatible space-person type', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const linked = await newIdentityFace(ctx, sut, { ownerId: user.id });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: linked.asset.id, addedById: user.id });
      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({
          spaceId: space.id,
          identityId: linked.identity.id,
          representativeFaceId: linked.assetFace.id,
          type: 'pet',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await linkSpaceFace(ctx, spacePerson.id, linked.assetFace.id);

      await expect(sut.getSharedSpaceFaceMatchBackfillTargets()).resolves.toEqual([
        { spaceId: space.id, assetId: linked.asset.id },
      ]);
      await expect(sut.getBackfillWork()).resolves.toMatchObject({ hasSharedSpaceProjectionWork: true });
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('dedupes direct and linked-library projection targets for the same asset in the same space', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { library } = await ctx.newLibrary({ ownerId: user.id });
      const linked = await newIdentityFace(ctx, sut, { ownerId: user.id, libraryId: library.id });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: linked.asset.id, addedById: user.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: user.id });

      await expect(sut.getSharedSpaceFaceMatchBackfillTargets()).resolves.toEqual([
        { spaceId: space.id, assetId: linked.asset.id },
      ]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('targets a face assigned to the wrong space-person identity for projection repair', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const linked = await newIdentityFace(ctx, sut, { ownerId: user.id });
      const wrong = await newIdentityFace(ctx, sut, { ownerId: user.id });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: linked.asset.id, addedById: user.id });
      const wrongSpacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({
          spaceId: space.id,
          identityId: wrong.identity.id,
          representativeFaceId: linked.assetFace.id,
          type: 'person',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await linkSpaceFace(ctx, wrongSpacePerson.id, linked.assetFace.id);

      await expect(sut.getSharedSpaceFaceMatchBackfillTargets()).resolves.toEqual([
        { spaceId: space.id, assetId: linked.asset.id },
      ]);
      await expect(sut.getBackfillWork()).resolves.toMatchObject({
        hasSpacePersonIdentityWork: true,
        hasSharedSpaceProjectionWork: true,
      });
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('excludes disabled spaces and ineligible assets from projection targets', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const timeline = await newIdentityFace(ctx, sut, { ownerId: user.id });
      const offline = await newIdentityFace(ctx, sut, { ownerId: user.id, isOffline: true });
      const deleted = await newIdentityFace(ctx, sut, { ownerId: user.id, deletedAt: new Date() });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      const { space: disabled } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: false });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceMember({ spaceId: disabled.id, userId: user.id, role: SharedSpaceRole.Owner });
      for (const assetId of [timeline.asset.id, offline.asset.id, deleted.asset.id]) {
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId, addedById: user.id });
        await ctx.newSharedSpaceAsset({ spaceId: disabled.id, assetId, addedById: user.id });
      }

      await expect(sut.getSharedSpaceFaceMatchBackfillTargets()).resolves.toEqual([
        { spaceId: space.id, assetId: timeline.asset.id },
      ]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('excludes deleted invisible unassigned and identity-less faces from projection targets', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const eligible = await newIdentityFace(ctx, sut, { ownerId: user.id });
      const deletedFace = await newIdentityFace(ctx, sut, { ownerId: user.id });
      const invisibleFace = await newIdentityFace(ctx, sut, { ownerId: user.id });
      const unassignedFace = await newIdentityFace(ctx, sut, { ownerId: user.id });
      const identityless = await newIdentityFace(ctx, sut, { ownerId: user.id });
      await ctx.database
        .updateTable('asset_face')
        .set({ deletedAt: new Date() })
        .where('id', '=', deletedFace.assetFace.id)
        .execute();
      await ctx.database
        .updateTable('asset_face')
        .set({ isVisible: false })
        .where('id', '=', invisibleFace.assetFace.id)
        .execute();
      await ctx.database
        .updateTable('asset_face')
        .set({ personId: null })
        .where('id', '=', unassignedFace.assetFace.id)
        .execute();
      await ctx.database
        .deleteFrom('face_identity_face')
        .where('assetFaceId', '=', identityless.assetFace.id)
        .execute();
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      for (const assetId of [
        eligible.asset.id,
        deletedFace.asset.id,
        invisibleFace.asset.id,
        unassignedFace.asset.id,
        identityless.asset.id,
      ]) {
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId, addedById: user.id });
      }

      await expect(sut.getSharedSpaceFaceMatchBackfillTargets()).resolves.toEqual([
        { spaceId: space.id, assetId: eligible.asset.id },
      ]);
      await expect(sut.getBackfillWork()).resolves.toMatchObject({
        hasPersonalIdentityWork: true,
        hasSharedSpaceProjectionWork: true,
      });
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('reports backfill work for dominant multi-candidate space people', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      const { person: dominantPerson } = await ctx.newPerson({ ownerId: user.id });
      const { person: noisyPerson } = await ctx.newPerson({ ownerId: user.id });
      const dominantIdentity = await sut.ensurePersonIdentity(dominantPerson.personGroupId);
      const noisyIdentity = await sut.ensurePersonIdentity(noisyPerson.personGroupId);
      const spacePerson = await newSpacePerson(ctx, space.id);

      for (let index = 0; index < 20; index++) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: dominantPerson.personGroupId });
        await sut.linkFace({ assetFaceId: assetFace.id, identityId: dominantIdentity.id, source: 'backfill' });
        await linkSpaceFace(ctx, spacePerson.id, assetFace.id);
      }

      for (let index = 0; index < 2; index++) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: noisyPerson.personGroupId });
        await sut.linkFace({ assetFaceId: assetFace.id, identityId: noisyIdentity.id, source: 'backfill' });
        await linkSpaceFace(ctx, spacePerson.id, assetFace.id);
      }

      await expect(sut.hasBackfillWork()).resolves.toBe(true);

      await sut.backfillSpacePersonIdentities({ limit: 100 });

      await expect(sut.getBackfillWork()).resolves.toEqual({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('reports backfill work for identity-linked faces missing from linked-library space people', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { library } = await ctx.newLibrary({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const identity = await sut.ensurePersonIdentity(person.personGroupId);
      await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'backfill' });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: user.id });

      await expect(sut.hasBackfillWork()).resolves.toBe(true);

      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, identityId: identity.id, representativeFaceId: assetFace.id })
        .returningAll()
        .executeTakeFirstOrThrow();
      await linkSpaceFace(ctx, spacePerson.id, assetFace.id);

      await expect(sut.hasBackfillWork()).resolves.toBe(false);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('reports mixed and duplicate space-person links as repairable backfill work', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });

      const { person: firstPerson } = await ctx.newPerson({ ownerId: user.id });
      const { asset: firstAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: firstFace } = await ctx.newAssetFace({ assetId: firstAsset.id, personGroupId: firstPerson.personGroupId });
      const firstIdentity = await sut.ensurePersonIdentity(firstPerson.personGroupId);
      await sut.linkFace({ assetFaceId: firstFace.id, identityId: firstIdentity.id, source: 'backfill' });

      const { person: secondPerson } = await ctx.newPerson({ ownerId: user.id });
      const { asset: secondAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: secondFace } = await ctx.newAssetFace({ assetId: secondAsset.id, personGroupId: secondPerson.personGroupId });
      const secondIdentity = await sut.ensurePersonIdentity(secondPerson.personGroupId);
      await sut.linkFace({ assetFaceId: secondFace.id, identityId: secondIdentity.id, source: 'backfill' });

      await newSpacePerson(ctx, space.id);
      const conflictingSpacePerson = await newSpacePerson(ctx, space.id);
      await linkSpaceFace(ctx, conflictingSpacePerson.id, firstFace.id);
      await linkSpaceFace(ctx, conflictingSpacePerson.id, secondFace.id);
      await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, identityId: firstIdentity.id })
        .execute();
      const duplicateSpacePerson = await newSpacePerson(ctx, space.id);
      await linkSpaceFace(ctx, duplicateSpacePerson.id, firstFace.id);

      await expect(sut.hasBackfillWork()).resolves.toBe(true);
      await sut.backfillSpacePersonIdentities({ limit: 100 });
      await expect(sut.hasBackfillWork()).resolves.toBe(false);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  // Regression for the same duplicate-key crash class on the repair path. A space person stamped
  // with identity A but whose face actually belongs to identity C must be split — repair INSERTs a
  // new space person for C. Two concurrent backfill passes both miss the not-yet-committed C row and
  // race to INSERT it, tripping `shared_space_person_spaceId_identityId_key`; the loser crashed the
  // FaceIdentityBackfill job.
  it('does not crash when concurrent backfill passes create the space person for a split-out identity', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });

      const { person: personA } = await ctx.newPerson({ ownerId: user.id });
      const identityA = await sut.ensurePersonIdentity(personA.personGroupId);

      const { person: personC } = await ctx.newPerson({ ownerId: user.id });
      const identityC = await sut.ensurePersonIdentity(personC.personGroupId);
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: personC.personGroupId });
      await sut.linkFace({ assetFaceId: assetFace.id, identityId: identityC.id, source: 'backfill' });

      // Space person carries identity A, but its only face belongs to identity C → repair splits it out.
      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, identityId: identityA.id, representativeFaceId: assetFace.id, type: 'person' })
        .returningAll()
        .executeTakeFirstOrThrow();
      await linkSpaceFace(ctx, spacePerson.id, assetFace.id);

      // Two backfill passes at once both race to INSERT the C space person.
      await expect(
        Promise.all([
          sut.backfillSpacePersonIdentities({ limit: 100 }),
          sut.backfillSpacePersonIdentities({ limit: 100 }),
        ]),
      ).resolves.toBeDefined();

      // Exactly one space person exists for the split-out identity.
      const cPeople = await ctx.database
        .selectFrom('shared_space_person')
        .select('id')
        .where('spaceId', '=', space.id)
        .where('identityId', '=', identityC.id)
        .execute();
      expect(cPeople).toHaveLength(1);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('does not rewrite already-consistent space people on repeated identity backfill passes', async () => {
    const { ctx, sut } = setup(await getKyselyDB());
    const { user } = await ctx.newUser();
    try {
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const identity = await sut.ensurePersonIdentity(person.personGroupId);
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'backfill' });
      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, identityId: identity.id, representativeFaceId: assetFace.id })
        .returningAll()
        .executeTakeFirstOrThrow();
      await linkSpaceFace(ctx, spacePerson.id, assetFace.id);

      // The first pass settles the derived counts (and may legitimately bump updatedAt doing so).
      await sut.backfillSpacePersonIdentities({ limit: 100 });
      const settled = await ctx.database
        .selectFrom('shared_space_person')
        .select(['faceCount', 'assetCount', 'updatedAt'])
        .where('id', '=', spacePerson.id)
        .executeTakeFirstOrThrow();
      expect(settled.faceCount).toBe(1);

      // A person whose identity and counts already match its faces must not be rewritten by the
      // next pass. The unconditional recount UPDATE fires the updatedAt trigger for every scanned
      // row, which on a real library rewrites the entire shared_space_person table once per pass —
      // constant write load and updatedAt churn for sync watchers.
      await sut.backfillSpacePersonIdentities({ limit: 100 });
      const afterSecondPass = await ctx.database
        .selectFrom('shared_space_person')
        .select(['faceCount', 'assetCount', 'updatedAt'])
        .where('id', '=', spacePerson.id)
        .executeTakeFirstOrThrow();
      expect(afterSecondPass).toEqual(settled);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('preserves manual space representative faces during space identity backfill', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const identity = await ctx.database
        .insertInto('face_identity')
        .values({ type: 'person' })
        .returningAll()
        .executeTakeFirstOrThrow();
      const { asset: manualAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: manualFace } = await ctx.newAssetFace({ assetId: manualAsset.id });
      const { asset: identityAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: identityFace } = await ctx.newAssetFace({ assetId: identityAsset.id });
      const person = await ctx.database
        .insertInto('shared_space_person')
        .values({
          spaceId: space.id,
          representativeFaceId: manualFace.id,
          representativeFaceSource: 'manual',
          type: 'person',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await linkSpaceFace(ctx, person.id, manualFace.id);
      await linkSpaceFace(ctx, person.id, identityFace.id);
      await ctx.database
        .insertInto('face_identity_face')
        .values({ identityId: identity.id, assetFaceId: identityFace.id, source: 'backfill' })
        .execute();

      await sut.backfillSpacePersonIdentities({ limit: 100 });

      const updated = await ctx.database
        .selectFrom('shared_space_person')
        .select(['identityId', 'representativeFaceId', 'representativeFaceSource'])
        .where('id', '=', person.id)
        .executeTakeFirstOrThrow();
      expect(updated).toEqual({
        identityId: identity.id,
        representativeFaceId: manualFace.id,
        representativeFaceSource: 'manual',
      });
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('refreshes automatic space representative faces during space identity backfill', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const identity = await ctx.database
        .insertInto('face_identity')
        .values({ type: 'person' })
        .returningAll()
        .executeTakeFirstOrThrow();
      const { asset: staleAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: staleFace } = await ctx.newAssetFace({ assetId: staleAsset.id });
      const { asset: identityAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: identityFace } = await ctx.newAssetFace({ assetId: identityAsset.id });
      const person = await ctx.database
        .insertInto('shared_space_person')
        .values({
          spaceId: space.id,
          representativeFaceId: staleFace.id,
          representativeFaceSource: 'auto',
          type: 'person',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await linkSpaceFace(ctx, person.id, staleFace.id);
      await linkSpaceFace(ctx, person.id, identityFace.id);
      await ctx.database
        .insertInto('face_identity_face')
        .values({ identityId: identity.id, assetFaceId: identityFace.id, source: 'backfill' })
        .execute();

      await sut.backfillSpacePersonIdentities({ limit: 100 });

      const updated = await ctx.database
        .selectFrom('shared_space_person')
        .select(['identityId', 'representativeFaceId', 'representativeFaceSource'])
        .where('id', '=', person.id)
        .executeTakeFirstOrThrow();
      expect(updated).toEqual({
        identityId: identity.id,
        representativeFaceId: identityFace.id,
        representativeFaceSource: 'auto',
      });
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('enforces one identity per personal profile and one active identity per face', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });

    const identity = await sut.ensurePersonIdentity(person.personGroupId);
    const linked = await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
    const linkedAgain = await sut.linkFace({
      assetFaceId: assetFace.id,
      identityId: identity.id,
      source: 'owner-person',
    });
    const secondIdentity = await sut.ensurePersonIdentity(person.personGroupId);

    const updatedPerson = await ctx.database
      .selectFrom('person')
      .select(['identityId'])
      .where('personGroupId', '=', person.personGroupId)
      .executeTakeFirstOrThrow();

    expect(secondIdentity.id).toBe(identity.id);
    expect(updatedPerson.identityId).toBe(identity.id);
    expect(linked).toEqual(expect.objectContaining({ assetFaceId: assetFace.id, identityId: identity.id }));
    expect(linkedAgain).toEqual(expect.objectContaining({ assetFaceId: assetFace.id, identityId: identity.id }));
  });

  it('backfills personal identities idempotently and pages by cursor', async () => {
    const { ctx, sut } = setup(await getKyselyDB());
    const { user } = await ctx.newUser();
    try {
      const { person: firstPerson } = await ctx.newPerson({ ownerId: user.id });
      const { person: secondPerson } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: firstFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: firstPerson.personGroupId });
      const { assetFace: secondFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: firstPerson.personGroupId });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });

      const firstPage = await sut.backfillPersonalIdentities({ limit: 1 });
      const secondPage = await sut.backfillPersonalIdentities({ cursor: firstPage.nextCursor, limit: 1 });
      await sut.backfillPersonalIdentities({ limit: 100 });
      const firstIdentity = await ctx.database
        .selectFrom('person')
        .select('identityId')
        .where('personGroupId', '=', firstPerson.personGroupId)
        .executeTakeFirstOrThrow();
      await sut.backfillPersonalIdentities({ limit: 100 });

      const people = await ctx.database
        .selectFrom('person')
        .select(['personGroupId', 'identityId'])
        .where('personGroupId', 'in', [firstPerson.personGroupId, secondPerson.personGroupId])
        .orderBy('id')
        .execute();
      const links = await ctx.database
        .selectFrom('face_identity_face')
        .select(['assetFaceId', 'identityId'])
        .where('assetFaceId', 'in', [firstFace.id, secondFace.id])
        .orderBy('assetFaceId')
        .execute();

      const affectedTargets = [
        ...(firstPage.affectedSpaceAssets ?? []),
        ...(secondPage.affectedSpaceAssets ?? []),
      ].toSorted((a, b) => a.spaceId.localeCompare(b.spaceId) || a.assetId.localeCompare(b.assetId));

      expect(firstPage).toEqual({
        processed: 1,
        affectedSpaceAssets: expect.any(Array),
        nextCursor: expect.any(String),
      });
      expect(secondPage.processed).toBe(1);
      expect(affectedTargets).toEqual([{ spaceId: space.id, assetId: asset.id }]);
      expect(people.every((person) => person.identityId)).toBe(true);
      expect(people.find((person) => person.id === firstPerson.personGroupId)?.identityId).toBe(firstIdentity.identityId);
      expect(links).toHaveLength(2);
      expect(new Set(links.map((link) => link.identityId))).toEqual(new Set([firstIdentity.identityId]));
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('reports personal face identity mismatches as backfill work', async () => {
    const { ctx, sut } = setup(await getKyselyDB());
    const { user } = await ctx.newUser();
    try {
      const { person: targetPerson } = await ctx.newPerson({ ownerId: user.id });
      const { person: sourcePerson } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: sourcePerson.personGroupId });
      const targetIdentity = await sut.ensurePersonIdentity(targetPerson.personGroupId);
      await sut.ensurePersonIdentity(sourcePerson.personGroupId);
      await sut.linkFace({
        assetFaceId: assetFace.id,
        identityId: targetIdentity.id,
        source: 'shared-space-evidence',
      });

      await expect(sut.getBackfillWork()).resolves.toEqual({
        hasPersonalIdentityWork: true,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });
      await expect(sut.hasBackfillWork()).resolves.toBe(true);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('repairs personal face identity mismatches by moving faces to an existing same-owner target person', async () => {
    const { ctx, sut } = setup(await getKyselyDB());
    const { user } = await ctx.newUser();
    try {
      const { person: targetPerson } = await ctx.newPerson({ ownerId: user.id });
      const { person: sourcePerson } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: sourcePerson.personGroupId });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
      const targetIdentity = await sut.ensurePersonIdentity(targetPerson.personGroupId);
      const sourceIdentity = await sut.ensurePersonIdentity(sourcePerson.personGroupId);
      await sut.linkFace({
        assetFaceId: assetFace.id,
        identityId: targetIdentity.id,
        source: 'shared-space-evidence',
      });

      const result = await sut.backfillPersonalIdentities({ limit: 100 });

      const updatedFace = await ctx.database
        .selectFrom('asset_face')
        .select('personId')
        .where('id', '=', assetFace.id)
        .executeTakeFirstOrThrow();
      const sourceProfile = await ctx.database
        .selectFrom('person')
        .select('identityId')
        .where('personGroupId', '=', sourcePerson.personGroupId)
        .executeTakeFirstOrThrow();
      const pendingTargetRows = await sut.getPendingSharedSpaceFaceMatchBackfillTargets();
      const pendingTargets = pendingTargetRows.map(({ spaceId, assetId }) => ({
        spaceId,
        assetId,
      }));

      expect(updatedFace.personId).toBe(targetPerson.personGroupId);
      expect(sourceProfile.identityId).toBe(sourceIdentity.id);
      expect(await getPersonalIdentityMismatchRows(ctx, [assetFace.id])).toEqual([]);
      expect(result.affectedSpaceAssets).toEqual([{ spaceId: space.id, assetId: asset.id }]);
      expect(pendingTargets).toEqual([{ spaceId: space.id, assetId: asset.id }]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('repairs only mismatched personal face groups when a stale person still has correctly linked faces', async () => {
    const { ctx, sut } = setup(await getKyselyDB());
    const { user } = await ctx.newUser();
    try {
      const { person: targetPerson } = await ctx.newPerson({ ownerId: user.id });
      const { person: sourcePerson } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: sourceLinkedFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: sourcePerson.personGroupId });
      const { assetFace: targetLinkedFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: sourcePerson.personGroupId });
      const targetIdentity = await sut.ensurePersonIdentity(targetPerson.personGroupId);
      const sourceIdentity = await sut.ensurePersonIdentity(sourcePerson.personGroupId);
      await sut.linkFace({ assetFaceId: sourceLinkedFace.id, identityId: sourceIdentity.id, source: 'owner-person' });
      await sut.linkFace({
        assetFaceId: targetLinkedFace.id,
        identityId: targetIdentity.id,
        source: 'shared-space-evidence',
      });

      await sut.backfillPersonalIdentities({ limit: 100 });

      const faces = await ctx.database
        .selectFrom('asset_face')
        .select(['id', 'personId'])
        .where('id', 'in', [sourceLinkedFace.id, targetLinkedFace.id])
        .orderBy('id')
        .execute();

      expect(faces.find((face) => face.id === sourceLinkedFace.id)?.personId).toBe(sourcePerson.personGroupId);
      expect(faces.find((face) => face.id === targetLinkedFace.id)?.personId).toBe(targetPerson.personGroupId);
      expect(await getPersonalIdentityMismatchRows(ctx, [sourceLinkedFace.id, targetLinkedFace.id])).toEqual([]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('keeps mismatched personal faces assigned to the source person when the target profile is owned by another user', async () => {
    const { ctx, sut } = setup(await getKyselyDB());
    const { user: sourceOwner } = await ctx.newUser();
    const { user: targetOwner } = await ctx.newUser();
    try {
      const { person: sourcePerson } = await ctx.newPerson({ ownerId: sourceOwner.id });
      const { person: otherOwnerTargetPerson } = await ctx.newPerson({ ownerId: targetOwner.id });
      const { asset } = await ctx.newAsset({ ownerId: sourceOwner.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: sourcePerson.personGroupId });
      const targetIdentity = await sut.ensurePersonIdentity(otherOwnerTargetPerson.personGroupId);
      const sourceIdentity = await sut.ensurePersonIdentity(sourcePerson.personGroupId);
      await sut.linkFace({
        assetFaceId: assetFace.id,
        identityId: targetIdentity.id,
        source: 'shared-space-evidence',
      });

      await sut.backfillPersonalIdentities({ limit: 100 });

      const updatedFace = await ctx.database
        .selectFrom('asset_face')
        .select('personId')
        .where('id', '=', assetFace.id)
        .executeTakeFirstOrThrow();

      expect(updatedFace.personId).toBe(sourcePerson.personGroupId);
      // The source owner has no person referencing the other owner's identity, so the face cannot
      // move anywhere. The mismatch must still be resolved — by realigning the link to the face's
      // current person — because leftover work makes handleFaceIdentityBackfill re-queue forever.
      const link = await ctx.database
        .selectFrom('face_identity_face')
        .select('identityId')
        .where('assetFaceId', '=', assetFace.id)
        .executeTakeFirstOrThrow();
      expect(link.identityId).toBe(sourceIdentity.id);
      expect(await getPersonalIdentityMismatchRows(ctx, [assetFace.id])).toEqual([]);
      await expect(sut.getBackfillWork()).resolves.toEqual({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });
    } finally {
      await ctx.database.deleteFrom('user').where('id', 'in', [sourceOwner.id, targetOwner.id]).execute();
    }
  });

  it('persists personal-identity affected targets across enabled spaces and dedupes direct library overlap', async () => {
    const { ctx, sut } = setup(await getKyselyDB());
    const { user } = await ctx.newUser();
    try {
      const { library } = await ctx.newLibrary({ ownerId: user.id });
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const { asset: offlineAsset } = await ctx.newAsset({ ownerId: user.id, isOffline: true });
      await ctx.newAssetFace({ assetId: offlineAsset.id, personGroupId: person.personGroupId });
      const { space: directAndLinked } = await ctx.newSharedSpace({
        createdById: user.id,
        faceRecognitionEnabled: true,
      });
      const { space: linkedOnly } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      const { space: disabled } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: false });
      for (const spaceId of [directAndLinked.id, linkedOnly.id, disabled.id]) {
        await ctx.newSharedSpaceMember({ spaceId, userId: user.id, role: SharedSpaceRole.Owner });
      }
      await ctx.newSharedSpaceAsset({ spaceId: directAndLinked.id, assetId: asset.id, addedById: user.id });
      await ctx.newSharedSpaceAsset({ spaceId: directAndLinked.id, assetId: offlineAsset.id, addedById: user.id });
      await ctx.newSharedSpaceLibrary({ spaceId: directAndLinked.id, libraryId: library.id, addedById: user.id });
      await ctx.newSharedSpaceLibrary({ spaceId: linkedOnly.id, libraryId: library.id, addedById: user.id });
      await ctx.newSharedSpaceAsset({ spaceId: disabled.id, assetId: asset.id, addedById: user.id });

      const result = await sut.backfillPersonalIdentities({ limit: 100 });
      const expectedTargets = [
        { spaceId: directAndLinked.id, assetId: asset.id },
        { spaceId: linkedOnly.id, assetId: asset.id },
      ].toSorted((a, b) => a.spaceId.localeCompare(b.spaceId) || a.assetId.localeCompare(b.assetId));
      const pendingTargetRows = await sut.getPendingSharedSpaceFaceMatchBackfillTargets();
      const pendingTargets = pendingTargetRows.map(({ spaceId, assetId }) => ({ spaceId, assetId }));

      expect(result.affectedSpaceAssets).toEqual(expectedTargets);
      expect(pendingTargets).toEqual(expectedTargets);
      await expect(
        ctx.database
          .selectFrom('face_identity_face')
          .select('identityId')
          .where('assetFaceId', '=', assetFace.id)
          .executeTakeFirst(),
      ).resolves.toEqual(expect.objectContaining({ identityId: expect.any(String) }));
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('does not persist personal-identity targets for already linked faces on the same backfill page', async () => {
    const { ctx, sut } = setup(await getKyselyDB());
    const { user } = await ctx.newUser();
    try {
      const alreadyLinked = await newIdentityFace(ctx, sut, { ownerId: user.id });
      const { person: missingPerson } = await ctx.newPerson({ ownerId: user.id });
      const { asset: missingAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: missingAssetFace } = await ctx.newAssetFace({
        assetId: missingAsset.id,
        personGroupId: missingPerson.personGroupId,
      });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: alreadyLinked.asset.id, addedById: user.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: missingAsset.id, addedById: user.id });

      const result = await sut.backfillPersonalIdentities({ limit: 100 });
      const pendingTargetRows = await sut.getPendingSharedSpaceFaceMatchBackfillTargets();
      const pendingTargets = pendingTargetRows.map(({ spaceId, assetId }) => ({ spaceId, assetId }));

      expect(result.affectedSpaceAssets).toEqual([{ spaceId: space.id, assetId: missingAsset.id }]);
      expect(pendingTargets).toEqual([{ spaceId: space.id, assetId: missingAsset.id }]);
      await expect(
        ctx.database
          .selectFrom('face_identity_face')
          .select('identityId')
          .where('assetFaceId', '=', missingAssetFace.id)
          .executeTakeFirst(),
      ).resolves.toEqual(expect.objectContaining({ identityId: expect.any(String) }));
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('handles large personal-identity rematch target batches without exceeding the postgres parameter limit', async () => {
    const { ctx, sut } = setup(await getKyselyDB());
    const { user } = await ctx.newUser();
    try {
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
      const repository = sut as unknown as FaceIdentityRepositoryInternals;
      const assetFaceIds = [assetFace.id, ...Array.from({ length: 32_999 }, () => newUuid())];

      await expect(repository.getSharedSpaceFaceMatchTargetsForAssetFaces(assetFaceIds)).resolves.toEqual([
        { spaceId: space.id, assetId: asset.id },
      ]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('chunks large pending rematch target inserts below the postgres parameter limit', async () => {
    const insertedChunks: SharedSpaceFaceMatchBackfillTarget[][] = [];
    const execute = vi.fn().mockResolvedValue(void 0);
    const db = {
      insertInto: vi.fn(() => ({
        values: vi.fn((values: SharedSpaceFaceMatchBackfillTarget[]) => {
          insertedChunks.push(values);
          return {
            onConflict: vi.fn(() => ({ execute })),
          };
        }),
      })),
    };
    const repository = new FaceIdentityRepository(
      db as unknown as Kysely<DB>,
    ) as unknown as FaceIdentityRepositoryInternals;
    const targets = Array.from({ length: 33_000 }, () => ({ spaceId: newUuid(), assetId: newUuid() }));

    await expect(repository.addPendingSharedSpaceFaceMatchBackfillTargets(targets)).resolves.toHaveLength(33_000);

    expect(insertedChunks).toHaveLength(33);
    expect(insertedChunks.every((chunk) => chunk.length <= 1000)).toBe(true);
    expect(insertedChunks.reduce((total, chunk) => total + chunk.length, 0)).toBe(33_000);
  });

  it('persists personal-identity targets only for unlinked faces when one person has mixed linked faces', async () => {
    const { ctx, sut } = setup(await getKyselyDB());
    const { user } = await ctx.newUser();
    try {
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const identity = await sut.ensurePersonIdentity(person.personGroupId);
      const { asset: alreadyLinkedAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: alreadyLinkedFace } = await ctx.newAssetFace({
        assetId: alreadyLinkedAsset.id,
        personGroupId: person.personGroupId,
      });
      await sut.linkFace({ assetFaceId: alreadyLinkedFace.id, identityId: identity.id, source: 'backfill' });
      const { asset: missingAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: missingAssetFace } = await ctx.newAssetFace({ assetId: missingAsset.id, personGroupId: person.personGroupId });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: alreadyLinkedAsset.id, addedById: user.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: missingAsset.id, addedById: user.id });

      const result = await sut.backfillPersonalIdentities({ limit: 100 });
      const pendingTargetRows = await sut.getPendingSharedSpaceFaceMatchBackfillTargets();
      const pendingTargets = pendingTargetRows.map(({ spaceId, assetId }) => ({ spaceId, assetId }));

      expect(result.affectedSpaceAssets).toEqual([{ spaceId: space.id, assetId: missingAsset.id }]);
      expect(pendingTargets).toEqual([{ spaceId: space.id, assetId: missingAsset.id }]);
      await expect(
        ctx.database
          .selectFrom('face_identity_face')
          .select('identityId')
          .where('assetFaceId', '=', missingAssetFace.id)
          .executeTakeFirst(),
      ).resolves.toEqual({ identityId: identity.id });
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('does not persist personal-identity targets for faces already assigned in the shared space', async () => {
    const { ctx, sut } = setup(await getKyselyDB());
    const { user } = await ctx.newUser();
    try {
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
      const spacePerson = await newSpacePerson(ctx, space.id);
      await linkSpaceFace(ctx, spacePerson.id, assetFace.id);

      const result = await sut.backfillPersonalIdentities({ limit: 100 });
      const pendingTargetRows = await sut.getPendingSharedSpaceFaceMatchBackfillTargets();

      expect(result.affectedSpaceAssets).toEqual([]);
      expect(pendingTargetRows).toEqual([]);
      await expect(
        ctx.database
          .selectFrom('face_identity_face')
          .select('identityId')
          .where('assetFaceId', '=', assetFace.id)
          .executeTakeFirst(),
      ).resolves.toEqual(expect.objectContaining({ identityId: expect.any(String) }));
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('persists one affected target per enabled space when the same photo lives in ten spaces', async () => {
    const { ctx, sut } = setup(await getKyselyDB());
    const { user } = await ctx.newUser();
    try {
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const enabledSpaces = [];
      for (let index = 0; index < 10; index++) {
        const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
        enabledSpaces.push(space);
      }
      const { space: disabledSpace } = await ctx.newSharedSpace({
        createdById: user.id,
        faceRecognitionEnabled: false,
      });
      await ctx.newSharedSpaceMember({ spaceId: disabledSpace.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: disabledSpace.id, assetId: asset.id, addedById: user.id });

      const result = await sut.backfillPersonalIdentities({ limit: 100 });
      const expectedTargets = enabledSpaces
        .map((space) => ({ spaceId: space.id, assetId: asset.id }))
        .toSorted((a, b) => a.spaceId.localeCompare(b.spaceId) || a.assetId.localeCompare(b.assetId));
      const pendingTargetRows = await sut.getPendingSharedSpaceFaceMatchBackfillTargets();
      const pendingTargets = pendingTargetRows.map(({ spaceId, assetId }) => ({ spaceId, assetId }));

      expect(result.affectedSpaceAssets).toEqual(expectedTargets);
      expect(pendingTargets).toEqual(expectedTargets);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('keeps pending targets that were rewritten after a worker snapshot', async () => {
    const { ctx, sut } = setup(await getKyselyDB());
    const { user } = await ctx.newUser();
    try {
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });

      await sut.backfillPersonalIdentities({ limit: 100 });
      const snapshot = await sut.getPendingSharedSpaceFaceMatchBackfillTargets();
      await ctx.database.deleteFrom('face_identity_face').where('assetFaceId', '=', assetFace.id).execute();
      await sut.backfillPersonalIdentities({ limit: 100 });
      const rewritten = await sut.getPendingSharedSpaceFaceMatchBackfillTargets();

      expect(rewritten[0].updateId).not.toBe(snapshot[0].updateId);

      await sut.deletePendingSharedSpaceFaceMatchBackfillTargets(snapshot);

      await expect(sut.getPendingSharedSpaceFaceMatchBackfillTargets()).resolves.toMatchObject([
        { spaceId: space.id, assetId: asset.id, updateId: rewritten[0].updateId },
      ]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('reports durable pending face-match targets as backfill work', async () => {
    const { ctx, sut } = setup(await getKyselyDB());
    const { user } = await ctx.newUser();
    try {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
      await ctx.database
        .insertInto('shared_space_face_match_backfill_target')
        .values({ spaceId: space.id, assetId: asset.id })
        .execute();

      await expect(sut.getBackfillWork()).resolves.toEqual({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });
      await expect(sut.hasBackfillWork()).resolves.toBe(true);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('persists personal-identity pending targets before identity rows are mutated', async () => {
    const { ctx, sut } = setup(await getKyselyDB());
    const { user } = await ctx.newUser();
    const ensureSpy = vi.spyOn(sut, 'ensurePersonIdentity').mockRejectedValueOnce(new Error('identity write failed'));
    try {
      const { person } = await ctx.newPerson({ ownerId: user.id, identityId: null });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });

      await expect(sut.backfillPersonalIdentities({ limit: 100 })).rejects.toThrow('identity write failed');

      await expect(sut.getPendingSharedSpaceFaceMatchBackfillTargets()).resolves.toMatchObject([
        { spaceId: space.id, assetId: asset.id },
      ]);
      await expect(
        ctx.database.selectFrom('person').select('identityId').where('personGroupId', '=', person.personGroupId).executeTakeFirstOrThrow(),
      ).resolves.toEqual({ identityId: null });
    } finally {
      ensureSpy.mockRestore();
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('does not backfill hidden or deleted faces as identity-linked faces', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: visibleFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    const { assetFace: hiddenFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personGroupId: person.personGroupId,
      isVisible: false,
    });
    const { assetFace: deletedFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personGroupId: person.personGroupId,
      deletedAt: new Date(),
    });

    await sut.backfillPersonalIdentities({ limit: 100 });

    const links = await ctx.database
      .selectFrom('face_identity_face')
      .select(['assetFaceId'])
      .where('assetFaceId', 'in', [visibleFace.id, hiddenFace.id, deletedFace.id])
      .execute();

    expect(links.map((link) => link.assetFaceId)).toEqual([visibleFace.id]);
  });

  it('uses a named accessible space profile for display while keeping a viewer-owned primary profile', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
    const { person } = await ctx.newPerson({
      ownerId: user.id,
      name: '',
      birthDate: new Date('1988-02-03T00:00:00.000Z'),
    });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    const identity = await sut.ensurePersonIdentity(person.personGroupId);
    await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
    const spacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({
        spaceId: space.id,
        identityId: identity.id,
        name: 'Shared Name',
        representativeFaceId: assetFace.id,
        type: 'person',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: spacePerson.id, assetFaceId: assetFace.id })
      .execute();

    try {
      const result = await sut.getAccessiblePeople(user.id, { withHidden: false, page: 1, size: 50 });

      expect(result.people).toEqual([
        expect.objectContaining({
          id: person.personGroupId,
          name: 'Shared Name',
          birthDate: '1988-02-03',
          primaryProfile: { type: 'user-person', id: person.personGroupId },
          filterId: `person:${person.personGroupId}`,
        }),
      ]);
    } finally {
      await ctx.database.deleteFrom('shared_space_person').where('id', '=', spacePerson.id).execute();
      await ctx.database
        .deleteFrom('shared_space_asset')
        .where('spaceId', '=', space.id)
        .where('assetId', '=', asset.id)
        .execute();
    }
  });

  it('resolves a space-set birthday for the owner when only a sibling space profile carries it', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
    // Owner's library person: has the NAME, but no birthday.
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ina' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    const identity = await sut.ensurePersonIdentity(person.personGroupId);
    await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
    // Space profile (set by an editor): carries the manual birthday, no name.
    const spacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({
        spaceId: space.id,
        identityId: identity.id,
        name: '',
        representativeFaceId: assetFace.id,
        type: 'person',
        birthDate: '2014-02-14',
        birthDateSource: 'manual',
        birthDateSourceUpdatedAt: new Date('2026-06-10T20:41:12.000Z'),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: spacePerson.id, assetFaceId: assetFace.id })
      .execute();

    try {
      const result = await sut.getAccessiblePeople(user.id, { withHidden: false, page: 1, size: 50 });

      expect(result.people).toEqual([
        expect.objectContaining({
          id: person.personGroupId,
          name: 'Ina', // name still resolves from the owner profile
          birthDate: '2014-02-14', // birthday resolves from the sibling space profile
          primaryProfile: { type: 'user-person', id: person.personGroupId },
        }),
      ]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('resolves a space-set birthday via the single-person view', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ina' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    const identity = await sut.ensurePersonIdentity(person.personGroupId);
    await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
    const spacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({
        spaceId: space.id,
        identityId: identity.id,
        name: '',
        representativeFaceId: assetFace.id,
        type: 'person',
        birthDate: '2014-02-14',
        birthDateSource: 'manual',
        birthDateSourceUpdatedAt: new Date('2026-06-10T20:41:12.000Z'),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: spacePerson.id, assetFaceId: assetFace.id })
      .execute();

    try {
      const result = await sut.getAccessiblePersonByProfileId(user.id, spacePerson.id);

      expect(result).toEqual(expect.objectContaining({ id: person.personGroupId, name: 'Ina', birthDate: '2014-02-14' }));
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it("resolves a space-set birthday by the owner's own identity id", async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
    // Owner's library person: has the NAME, but no birthday — exactly the owner detail-view scenario.
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ina' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    const identity = await sut.ensurePersonIdentity(person.personGroupId);
    await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
    const spacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({
        spaceId: space.id,
        identityId: identity.id,
        name: '',
        representativeFaceId: assetFace.id,
        type: 'person',
        birthDate: '2014-02-14',
        birthDateSource: 'manual',
        birthDateSourceUpdatedAt: new Date('2026-06-10T20:41:12.000Z'),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: spacePerson.id, assetFaceId: assetFace.id })
      .execute();

    try {
      const result = await sut.getResolvedPersonByIdentityId(user.id, identity.id);

      expect(result).toEqual(expect.objectContaining({ id: person.personGroupId, name: 'Ina', birthDate: '2014-02-14' }));
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('prefers the owner birthday over a more-recent space birthday', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
    const { person } = await ctx.newPerson({
      ownerId: user.id,
      name: 'Ina',
      birthDate: new Date('1990-01-01T00:00:00.000Z'),
    });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    const identity = await sut.ensurePersonIdentity(person.personGroupId);
    await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
    const spacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({
        spaceId: space.id,
        identityId: identity.id,
        name: '',
        representativeFaceId: assetFace.id,
        type: 'person',
        birthDate: '2014-02-14',
        birthDateSource: 'manual',
        birthDateSourceUpdatedAt: new Date('2026-06-10T20:41:12.000Z'),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: spacePerson.id, assetFaceId: assetFace.id })
      .execute();

    try {
      const result = await sut.getAccessiblePeople(user.id, { withHidden: false, page: 1, size: 50 });

      expect(result.people).toEqual([expect.objectContaining({ id: person.personGroupId, birthDate: '1990-01-01' })]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('picks the most-recently edited manual birthday across spaces', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ina' }); // owner: no birthday
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    const identity = await sut.ensurePersonIdentity(person.personGroupId);
    await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });

    const { space: spaceA } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: user.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceAsset({ spaceId: spaceA.id, assetId: asset.id, addedById: user.id });
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: user.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceAsset({ spaceId: spaceB.id, assetId: asset.id, addedById: user.id });

    // Newer edit (the winner), inserted FIRST so a profileId/updatedAt-only ordering would NOT pick it.
    const newerWinner = await ctx.database
      .insertInto('shared_space_person')
      .values({
        spaceId: spaceA.id,
        identityId: identity.id,
        name: '',
        representativeFaceId: assetFace.id,
        type: 'person',
        birthDate: '2014-02-14',
        birthDateSource: 'manual',
        birthDateSourceUpdatedAt: new Date('2026-06-10T20:41:12.000Z'), // most recent
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: newerWinner.id, assetFaceId: assetFace.id })
      .execute();

    const olderLoser = await ctx.database
      .insertInto('shared_space_person')
      .values({
        spaceId: spaceB.id,
        identityId: identity.id,
        name: '',
        representativeFaceId: assetFace.id,
        type: 'person',
        birthDate: '2013-02-14',
        birthDateSource: 'manual',
        birthDateSourceUpdatedAt: new Date('2025-01-01T00:00:00.000Z'), // older
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: olderLoser.id, assetFaceId: assetFace.id })
      .execute();

    try {
      const result = await sut.getAccessiblePeople(user.id, { withHidden: false, page: 1, size: 50 });
      expect(result.people).toEqual([expect.objectContaining({ id: person.personGroupId, birthDate: '2014-02-14' })]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('prefers a manual birthday over a more-recent inherited one', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ina' }); // owner: no birthday
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    const identity = await sut.ensurePersonIdentity(person.personGroupId);
    await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });

    const { space: spaceA } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: user.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceAsset({ spaceId: spaceA.id, assetId: asset.id, addedById: user.id });
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: user.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceAsset({ spaceId: spaceB.id, assetId: asset.id, addedById: user.id });

    const manualWinner = await ctx.database
      .insertInto('shared_space_person')
      .values({
        spaceId: spaceA.id,
        identityId: identity.id,
        name: '',
        representativeFaceId: assetFace.id,
        type: 'person',
        birthDate: '2014-02-14',
        birthDateSource: 'manual',
        birthDateSourceUpdatedAt: new Date('2025-01-01T00:00:00.000Z'), // older
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: manualWinner.id, assetFaceId: assetFace.id })
      .execute();

    const inheritedLoser = await ctx.database
      .insertInto('shared_space_person')
      .values({
        spaceId: spaceB.id,
        identityId: identity.id,
        name: '',
        representativeFaceId: assetFace.id,
        type: 'person',
        birthDate: '2013-02-14',
        birthDateSource: 'inherited',
        birthDateSourceUpdatedAt: new Date('2026-06-10T20:41:12.000Z'), // newer, but inherited
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: inheritedLoser.id, assetFaceId: assetFace.id })
      .execute();

    try {
      const result = await sut.getAccessiblePeople(user.id, { withHidden: false, page: 1, size: 50 });
      expect(result.people).toEqual([expect.objectContaining({ id: person.personGroupId, birthDate: '2014-02-14' })]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('returns the person with a null birthday when no profile has one', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ina' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    const identity = await sut.ensurePersonIdentity(person.personGroupId);
    await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
    const spacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({
        spaceId: space.id,
        identityId: identity.id,
        name: '',
        representativeFaceId: assetFace.id,
        type: 'person',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: spacePerson.id, assetFaceId: assetFace.id })
      .execute();

    try {
      const result = await sut.getAccessiblePeople(user.id, { withHidden: false, page: 1, size: 50 });
      expect(result.people).toEqual([expect.objectContaining({ id: person.personGroupId, name: 'Ina', birthDate: null })]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('does not surface a birthday from a hidden space profile unless withHidden is set', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ina' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    const identity = await sut.ensurePersonIdentity(person.personGroupId);
    await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
    const spacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({
        spaceId: space.id,
        identityId: identity.id,
        name: '',
        representativeFaceId: assetFace.id,
        type: 'person',
        isHidden: true,
        birthDate: '2014-02-14',
        birthDateSource: 'manual',
        birthDateSourceUpdatedAt: new Date('2026-06-10T20:41:12.000Z'),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: spacePerson.id, assetFaceId: assetFace.id })
      .execute();

    try {
      const hiddenExcluded = await sut.getAccessiblePeople(user.id, { withHidden: false, page: 1, size: 50 });
      expect(hiddenExcluded.people).toEqual([expect.objectContaining({ id: person.personGroupId, birthDate: null })]);

      const hiddenIncluded = await sut.getAccessiblePeople(user.id, { withHidden: true, page: 1, size: 50 });
      expect(hiddenIncluded.people).toEqual([expect.objectContaining({ id: person.personGroupId, birthDate: '2014-02-14' })]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('does not leak a birthday from a space hidden from the viewer timeline', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ina' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    const identity = await sut.ensurePersonIdentity(person.personGroupId);
    await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
    const spacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({
        spaceId: space.id,
        identityId: identity.id,
        name: '',
        representativeFaceId: assetFace.id,
        type: 'person',
        birthDate: '2014-02-14',
        birthDateSource: 'manual',
        birthDateSourceUpdatedAt: new Date('2026-06-10T20:41:12.000Z'),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: spacePerson.id, assetFaceId: assetFace.id })
      .execute();
    // Hide the space from the viewer's timeline -> excluded from timeline_spaces.
    await setMemberTimeline(ctx, { spaceId: space.id, userId: user.id, showInTimeline: false });

    try {
      const result = await sut.getAccessiblePeople(user.id, { withHidden: false, page: 1, size: 50 });
      expect(result.people).toEqual([expect.objectContaining({ id: person.personGroupId, birthDate: null })]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  // Matrix: who may read a birthday set inside a shared space. The resolver here
  // (getResolvedPersonByIdentityId) is the same one AssetService uses to overlay the birthday on the
  // owner's asset-detail view, so this guards against leaking a space-set birthday to users who are
  // not entitled to it.
  describe('birthday visibility permission matrix', () => {
    it('shows the space-set birthday to the asset owner who is a member of the space', async () => {
      const { ctx, sut } = setup();
      const world = await seedBirthdayPermissionWorld(ctx, sut);

      try {
        const result = await sut.getResolvedPersonByIdentityId(world.alice.id, world.identity.id);
        expect(result?.birthDate).toBe(world.expectedBirthDate);
      } finally {
        await ctx.database.deleteFrom('user').where('id', 'in', world.userIds).execute();
      }
    });

    it('shows the space-set birthday to a fellow space member with the space in their timeline', async () => {
      const { ctx, sut } = setup();
      const world = await seedBirthdayPermissionWorld(ctx, sut);

      try {
        const result = await sut.getResolvedPersonByIdentityId(world.bob.id, world.identity.id);
        expect(result?.birthDate).toBe(world.expectedBirthDate);
      } finally {
        await ctx.database.deleteFrom('user').where('id', 'in', world.userIds).execute();
      }
    });

    it('hides the birthday from a member who has removed the space from their timeline', async () => {
      const { ctx, sut } = setup();
      const world = await seedBirthdayPermissionWorld(ctx, sut);
      await setMemberTimeline(ctx, { spaceId: world.spaceS.id, userId: world.bob.id, showInTimeline: false });

      try {
        const result = await sut.getResolvedPersonByIdentityId(world.bob.id, world.identity.id);
        expect(result).toBeUndefined();
      } finally {
        await ctx.database.deleteFrom('user').where('id', 'in', world.userIds).execute();
      }
    });

    it('does not leak the birthday to a user who shares the identity but not the space', async () => {
      const { ctx, sut } = setup();
      const world = await seedBirthdayPermissionWorld(ctx, sut);

      try {
        const result = await sut.getResolvedPersonByIdentityId(world.dave.id, world.identity.id);
        // Dave resolves the same person (he shares the identity via his own library) but must never
        // inherit the birthday that was only set inside a space he does not belong to.
        expect(result).toBeDefined();
        expect(result?.birthDate).toBeNull();
      } finally {
        await ctx.database.deleteFrom('user').where('id', 'in', world.userIds).execute();
      }
    });

    it('returns nothing to a user with no access to the identity', async () => {
      const { ctx, sut } = setup();
      const world = await seedBirthdayPermissionWorld(ctx, sut);

      try {
        const result = await sut.getResolvedPersonByIdentityId(world.carol.id, world.identity.id);
        expect(result).toBeUndefined();
      } finally {
        await ctx.database.deleteFrom('user').where('id', 'in', world.userIds).execute();
      }
    });
  });

  it('filters unnamed identity-grouped people below the configured minimum face count', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    try {
      const { person: singletonPerson } = await ctx.newPerson({ ownerId: user.id, name: '' });
      const { asset: singletonAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: singletonFace } = await ctx.newAssetFace({
        assetId: singletonAsset.id,
        personGroupId: singletonPerson.personGroupId,
      });
      const singletonIdentity = await sut.ensurePersonIdentity(singletonPerson.personGroupId);
      await sut.linkFace({ assetFaceId: singletonFace.id, identityId: singletonIdentity.id, source: 'owner-person' });

      const { person: namedSingletonPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Named singleton' });
      const { asset: namedAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: namedFace } = await ctx.newAssetFace({
        assetId: namedAsset.id,
        personGroupId: namedSingletonPerson.personGroupId,
      });
      const namedIdentity = await sut.ensurePersonIdentity(namedSingletonPerson.personGroupId);
      await sut.linkFace({ assetFaceId: namedFace.id, identityId: namedIdentity.id, source: 'owner-person' });

      const { person: eligiblePerson } = await ctx.newPerson({ ownerId: user.id, name: '' });
      const eligibleIdentity = await sut.ensurePersonIdentity(eligiblePerson.personGroupId);
      for (let index = 0; index < 3; index++) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: eligiblePerson.personGroupId });
        await sut.linkFace({ assetFaceId: assetFace.id, identityId: eligibleIdentity.id, source: 'owner-person' });
      }

      const result = await sut.getAccessiblePeople(user.id, {
        withHidden: false,
        page: 1,
        size: 50,
        minimumFaceCount: 3,
      });

      expect(result.total).toBe(2);
      expect(result.people.map((person) => person.id)).toEqual(
        expect.arrayContaining([namedSingletonPerson.personGroupId, eligiblePerson.personGroupId]),
      );
      expect(result.people.map((person) => person.id)).not.toContain(singletonPerson.personGroupId);
      expect(result.people.find((person) => person.id === namedSingletonPerson.personGroupId)?.numberOfAssets).toBe(1);
      expect(result.people.find((person) => person.id === eligiblePerson.personGroupId)?.numberOfAssets).toBe(3);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  // `getAccessiblePeopleIdentityPage` already computes COUNT(DISTINCT assetId) per identity, and
  // `hydrateAccessiblePeople` used to throw that away and rebuild the whole `accessible_faces` CTE
  // to compute the identical number a second time — on a large library that recomputation was the
  // single most expensive part of GET /api/people. Hydrate now accepts those counts. These tests
  // pin the contract that supplying them changes NOTHING about the result.
  describe('hydrateAccessiblePeople with precomputed asset counts', () => {
    it('returns byte-identical rows whether or not counts are supplied', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Counted' });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);
        for (let index = 0; index < 3; index++) {
          const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
          const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
          await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
        }

        const pageRows = await sut.getAccessiblePeopleIdentityPage({
          userId: user.id,
          withHidden: true,
          limit: 50,
          offset: 0,
          minimumFaceCount: 1,
        });
        const counts = new Map(pageRows.map((row) => [row.identityId, Number(row.visibleAssetCount)]));

        const withoutCounts = await sut.hydrateAccessiblePeople({
          userId: user.id,
          identityIds: pageRows.map((row) => row.identityId),
          withHidden: true,
        });
        const withCounts = await sut.hydrateAccessiblePeople({
          userId: user.id,
          identityIds: pageRows.map((row) => row.identityId),
          withHidden: true,
          assetCounts: counts,
        });

        expect(withoutCounts).toHaveLength(1);
        expect(withoutCounts[0].numberOfAssets).toBe(3);
        expect(withCounts).toEqual(withoutCounts);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    // The count is COUNT(DISTINCT assetId), not a face count. If the page query and hydrate ever
    // disagreed on that, every face in the UI would show an inflated photo count.
    it('counts distinct assets, not faces, when one asset holds several faces of the same identity', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Twice' });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);
        const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
        for (let index = 0; index < 2; index++) {
          const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
          await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
        }

        const pageRows = await sut.getAccessiblePeopleIdentityPage({
          userId: user.id,
          withHidden: true,
          limit: 50,
          offset: 0,
          minimumFaceCount: 1,
        });
        expect(Number(pageRows[0].visibleAssetCount)).toBe(1);

        const withCounts = await sut.hydrateAccessiblePeople({
          userId: user.id,
          identityIds: pageRows.map((row) => row.identityId),
          withHidden: true,
          assetCounts: new Map(pageRows.map((row) => [row.identityId, Number(row.visibleAssetCount)])),
        });
        const withoutCounts = await sut.hydrateAccessiblePeople({
          userId: user.id,
          identityIds: pageRows.map((row) => row.identityId),
          withHidden: true,
        });

        expect(withCounts[0].numberOfAssets).toBe(1);
        expect(withCounts).toEqual(withoutCounts);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('preserves the requested identity ordering', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        const identityIds: string[] = [];
        for (const name of ['Anna', 'Bruno', 'Carla']) {
          const { person } = await ctx.newPerson({ ownerId: user.id, name });
          const identity = await sut.ensurePersonIdentity(person.personGroupId);
          const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
          const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
          await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
          identityIds.push(identity.id);
        }

        const reversed = identityIds.toReversed();
        const counts = new Map(reversed.map((identityId) => [identityId, 1]));

        const withCounts = await sut.hydrateAccessiblePeople({
          userId: user.id,
          identityIds: reversed,
          withHidden: true,
          assetCounts: counts,
        });
        const withoutCounts = await sut.hydrateAccessiblePeople({
          userId: user.id,
          identityIds: reversed,
          withHidden: true,
        });

        expect(withCounts.map((person) => person.name)).toEqual(['Carla', 'Bruno', 'Anna']);
        expect(withCounts).toEqual(withoutCounts);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    // Without counts, an identity whose faces are all inaccessible is dropped by the INNER JOIN on
    // asset_counts. The precomputed path must drop it too rather than emitting a 0-asset row.
    it('omits an identity that has no accessible faces, matching the uncounted path', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: stranger } = await ctx.newUser();

      try {
        const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Unreachable' });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);
        // The only face lives on an asset owned by someone else and never shared.
        const { asset } = await ctx.newAsset({ ownerId: stranger.id, visibility: AssetVisibility.Timeline });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
        await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });

        const withoutCounts = await sut.hydrateAccessiblePeople({
          userId: user.id,
          identityIds: [identity.id],
          withHidden: true,
        });
        const withCounts = await sut.hydrateAccessiblePeople({
          userId: user.id,
          identityIds: [identity.id],
          withHidden: true,
          assetCounts: new Map([[identity.id, 0]]),
        });

        expect(withoutCounts).toEqual([]);
        expect(withCounts).toEqual([]);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
        await ctx.database.deleteFrom('user').where('id', '=', stranger.id).execute();
      }
    });

    it('drops an identity missing from the supplied counts rather than inventing a row', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Present' });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);
        const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
        await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });

        const withCounts = await sut.hydrateAccessiblePeople({
          userId: user.id,
          identityIds: [identity.id],
          withHidden: true,
          assetCounts: new Map(),
        });

        expect(withCounts).toEqual([]);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('returns an empty array for an empty identity list', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        await expect(
          sut.hydrateAccessiblePeople({
            userId: user.id,
            identityIds: [],
            withHidden: true,
            assetCounts: new Map(),
          }),
        ).resolves.toEqual([]);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('agrees with the uncounted path for a space-visible identity', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      try {
        const { identity } = await createAccessibleSpaceIdentity(ctx, sut, {
          memberUserId: member.id,
          ownerUserId: owner.id,
          embedding: newEmbedding(),
        });

        const pageRows = await sut.getAccessiblePeopleIdentityPage({
          userId: member.id,
          withHidden: true,
          limit: 50,
          offset: 0,
          minimumFaceCount: 1,
        });
        expect(pageRows.map((row) => row.identityId)).toContain(identity.id);

        const withoutCounts = await sut.hydrateAccessiblePeople({
          userId: member.id,
          identityIds: pageRows.map((row) => row.identityId),
          withHidden: true,
        });
        const withCounts = await sut.hydrateAccessiblePeople({
          userId: member.id,
          identityIds: pageRows.map((row) => row.identityId),
          withHidden: true,
          assetCounts: new Map(pageRows.map((row) => [row.identityId, Number(row.visibleAssetCount)])),
        });

        expect(withCounts).toEqual(withoutCounts);
        expect(withCounts[0].numberOfAssets).toBe(1);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', owner.id).execute();
        await ctx.database.deleteFrom('user').where('id', '=', member.id).execute();
      }
    });

    // Seeds BOTH a hidden and a visible identity, so withHidden=false still yields a non-empty
    // result. With only a hidden person, both paths return [] and the comparison proves nothing.
    it.each([true, false])('agrees with the uncounted path for withHidden=%s', async (withHidden) => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        const seed = async (name: string, isHidden: boolean) => {
          const { person } = await ctx.newPerson({ ownerId: user.id, name, isHidden });
          const identity = await sut.ensurePersonIdentity(person.personGroupId);
          const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
          const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
          await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
          return identity.id;
        };
        const hiddenIdentityId = await seed('Shy', true);
        const visibleIdentityId = await seed('Open', false);
        const identityIds = [hiddenIdentityId, visibleIdentityId];

        const withoutCounts = await sut.hydrateAccessiblePeople({ userId: user.id, identityIds, withHidden });
        const withCounts = await sut.hydrateAccessiblePeople({
          userId: user.id,
          identityIds,
          withHidden,
          assetCounts: new Map(identityIds.map((identityId) => [identityId, 1])),
        });

        // Guards the comparison itself: an empty-vs-empty result would pass either way.
        expect(withoutCounts.length).toBe(withHidden ? 2 : 1);
        expect(withCounts).toEqual(withoutCounts);
        expect(withCounts.every((person) => person.numberOfAssets === 1)).toBe(true);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    // The end-to-end invariant the whole optimisation rests on: the number the page query computes
    // is the number the endpoint reports.
    it('makes getAccessiblePeople report exactly the page query visibleAssetCount', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Endtoend' });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);
        for (let index = 0; index < 4; index++) {
          const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
          const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
          await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
        }

        const pageRows = await sut.getAccessiblePeopleIdentityPage({
          userId: user.id,
          withHidden: false,
          limit: 50,
          offset: 0,
          minimumFaceCount: 1,
        });
        const result = await sut.getAccessiblePeople(user.id, {
          withHidden: false,
          page: 1,
          size: 50,
          minimumFaceCount: 1,
        });

        const expected = Number(pageRows.find((row) => row.identityId === identity.id)?.visibleAssetCount);
        expect(expected).toBe(4);
        expect(result.people.find((candidate) => candidate.id === person.personGroupId)?.numberOfAssets).toBe(expected);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });
  });

  // Fix B — the no-timeline-spaces fast path, exercised through the repository rather than through
  // the predicate helper alone (see accessible-timeline-asset-predicate.medium.spec.ts for the
  // fragment-level equivalence proof).
  describe('getAccessiblePeople without any timeline-enabled space', () => {
    it('returns the viewer own people with correct counts', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: stranger } = await ctx.newUser();

      try {
        const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Solo' });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);
        for (let index = 0; index < 2; index++) {
          const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
          const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
          await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
        }

        // A face belonging to someone else's library must stay invisible on the fast path.
        const { person: theirs } = await ctx.newPerson({ ownerId: stranger.id, name: 'Theirs' });
        const strangerIdentity = await sut.ensurePersonIdentity(theirs.personGroupId);
        const { asset: strangerAsset } = await ctx.newAsset({
          ownerId: stranger.id,
          visibility: AssetVisibility.Timeline,
        });
        const { assetFace: strangerFace } = await ctx.newAssetFace({
          assetId: strangerAsset.id,
          personGroupId: theirs.personGroupId,
        });
        await sut.linkFace({
          assetFaceId: strangerFace.id,
          identityId: strangerIdentity.id,
          source: 'owner-person',
        });

        const result = await sut.getAccessiblePeople(user.id, {
          withHidden: false,
          page: 1,
          size: 50,
          minimumFaceCount: 1,
        });

        expect(result.people.map((candidate) => candidate.name)).toEqual(['Solo']);
        expect(result.people[0].numberOfAssets).toBe(2);
        expect(result.total).toBe(1);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
        await ctx.database.deleteFrom('user').where('id', '=', stranger.id).execute();
      }
    });

    it('does not surface space people while the membership has showInTimeline off', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      try {
        const { space } = await createAccessibleSpaceIdentity(ctx, sut, {
          memberUserId: member.id,
          ownerUserId: owner.id,
          showInTimeline: false,
          embedding: newEmbedding(),
        });
        expect(space.id).toBeDefined();

        const result = await sut.getAccessiblePeople(member.id, {
          withHidden: false,
          page: 1,
          size: 50,
          minimumFaceCount: 1,
        });

        expect(result.people).toEqual([]);
        expect(result.total).toBe(0);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', owner.id).execute();
        await ctx.database.deleteFrom('user').where('id', '=', member.id).execute();
      }
    });

    // The fast path is chosen per request. If the decision were cached anywhere, enabling the
    // timeline would not take effect and the member would stay blind to the space's people.
    it('picks the space path up as soon as the membership timeline is switched on', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      try {
        const { space } = await createAccessibleSpaceIdentity(ctx, sut, {
          memberUserId: member.id,
          ownerUserId: owner.id,
          showInTimeline: false,
          embedding: newEmbedding(),
        });

        const before = await sut.getAccessiblePeople(member.id, {
          withHidden: false,
          page: 1,
          size: 50,
          minimumFaceCount: 1,
        });
        expect(before.people).toEqual([]);

        await setMemberTimeline(ctx, { spaceId: space.id, userId: member.id, showInTimeline: true });

        const after = await sut.getAccessiblePeople(member.id, {
          withHidden: false,
          page: 1,
          size: 50,
          minimumFaceCount: 1,
        });
        expect(after.people).toHaveLength(1);
        expect(after.total).toBe(1);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', owner.id).execute();
        await ctx.database.deleteFrom('user').where('id', '=', member.id).execute();
      }
    });
  });

  // Fix C — characterisation of the total/hidden header numbers BEFORE folding the separate counts
  // query into the page query. These pin behaviour that is deliberately NOT symmetric with the page
  // itself, so the fold cannot quietly "tidy" it:
  //   * total/hidden ignore withHidden entirely — they are library-wide figures, not page figures;
  //   * eligibility for the totals uses NULLIF(name, '') while the page uses NULLIF(BTRIM(name), ''),
  //     so a whitespace-only name counts as named for the total but as unnamed for the listing.
  describe('getAccessiblePeople total/hidden characterisation', () => {
    it.each([true, false])('reports the same library-wide totals for withHidden=%s', async (withHidden) => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        await seedCharacterisationIdentity(ctx, sut, { userId: user.id, name: 'Visible', assets: 1 });
        await seedCharacterisationIdentity(ctx, sut, { userId: user.id, name: 'Concealed', assets: 1, isHidden: true });

        const result = await sut.getAccessiblePeople(user.id, {
          withHidden,
          page: 1,
          size: 50,
          minimumFaceCount: 1,
        });

        // Totals are library-wide and identical either way...
        expect(result.total).toBe(2);
        expect(result.hidden).toBe(1);
        // ...while the listing itself does respect withHidden.
        expect(result.people).toHaveLength(withHidden ? 2 : 1);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('counts an unnamed identity only once it reaches minimumFaceCount', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        await seedCharacterisationIdentity(ctx, sut, { userId: user.id, name: '', assets: 2 });
        await seedCharacterisationIdentity(ctx, sut, { userId: user.id, name: '', assets: 3 });

        const result = await sut.getAccessiblePeople(user.id, {
          withHidden: true,
          page: 1,
          size: 50,
          minimumFaceCount: 3,
        });

        expect(result.total).toBe(1);
        expect(result.hidden).toBe(0);
        expect(result.people).toHaveLength(1);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('counts a named identity that is below minimumFaceCount', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        await seedCharacterisationIdentity(ctx, sut, { userId: user.id, name: 'Named', assets: 1 });

        const result = await sut.getAccessiblePeople(user.id, {
          withHidden: true,
          page: 1,
          size: 50,
          minimumFaceCount: 5,
        });

        expect(result.total).toBe(1);
        expect(result.people).toHaveLength(1);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    // Existing asymmetry, pinned deliberately: BTRIM in the listing, none in the totals.
    it('treats a whitespace-only name as named for the total but unnamed for the listing', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        await seedCharacterisationIdentity(ctx, sut, { userId: user.id, name: ' '.repeat(3), assets: 1 });

        const result = await sut.getAccessiblePeople(user.id, {
          withHidden: true,
          page: 1,
          size: 50,
          minimumFaceCount: 3,
        });

        expect(result.total).toBe(1);
        expect(result.people).toHaveLength(0);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    // The fold must keep returning totals when the requested page is empty — a CROSS JOIN onto the
    // page rows would silently produce zeros here.
    it('still reports totals when the requested page is past the end', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        await seedCharacterisationIdentity(ctx, sut, { userId: user.id, name: 'Only', assets: 1 });

        const result = await sut.getAccessiblePeople(user.id, {
          withHidden: true,
          page: 5,
          size: 50,
          minimumFaceCount: 1,
        });

        expect(result.people).toEqual([]);
        expect(result.hasNextPage).toBe(false);
        expect(result.total).toBe(1);
        expect(result.hidden).toBe(0);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('reports zeroes for a library with no people at all', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        const result = await sut.getAccessiblePeople(user.id, {
          withHidden: true,
          page: 1,
          size: 50,
          minimumFaceCount: 1,
        });

        expect(result).toEqual({ total: 0, hidden: 0, hasNextPage: false, people: [] });
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('counts identities reachable only through a timeline-enabled space', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      try {
        await createAccessibleSpaceIdentity(ctx, sut, {
          memberUserId: member.id,
          ownerUserId: owner.id,
          embedding: newEmbedding(),
        });

        const result = await sut.getAccessiblePeople(member.id, {
          withHidden: true,
          page: 1,
          size: 50,
          minimumFaceCount: 1,
        });

        expect(result.total).toBe(1);
        expect(result.people).toHaveLength(1);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', owner.id).execute();
        await ctx.database.deleteFrom('user').where('id', '=', member.id).execute();
      }
    });
  });

  describe('getAccessiblePeopleStatistics', () => {
    it('counts visible and hidden identity profiles and unassigned faces in owned global scope', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        const { person: visiblePerson } = await ctx.newPerson({ ownerId: user.id, name: 'Visible' });
        const { asset: visibleAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
        const { assetFace: visibleFace } = await ctx.newAssetFace({
          assetId: visibleAsset.id,
          personGroupId: visiblePerson.personGroupId,
        });
        const visibleIdentity = await sut.ensurePersonIdentity(visiblePerson.personGroupId);
        await sut.linkFace({ assetFaceId: visibleFace.id, identityId: visibleIdentity.id, source: 'owner-person' });

        const { person: hiddenPerson } = await ctx.newPerson({
          ownerId: user.id,
          name: 'Hidden',
          isHidden: true,
        });
        const { asset: hiddenAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
        const { assetFace: hiddenFace } = await ctx.newAssetFace({
          assetId: hiddenAsset.id,
          personGroupId: hiddenPerson.personGroupId,
        });
        const hiddenIdentity = await sut.ensurePersonIdentity(hiddenPerson.personGroupId);
        await sut.linkFace({ assetFaceId: hiddenFace.id, identityId: hiddenIdentity.id, source: 'owner-person' });

        const { asset: unassignedAsset } = await ctx.newAsset({
          ownerId: user.id,
          visibility: AssetVisibility.Timeline,
        });
        await ctx.newAssetFace({ assetId: unassignedAsset.id });

        await expect(sut.getAccessiblePeopleStatistics(user.id, { minimumFaceCount: 1 })).resolves.toEqual({
          total: 2,
          hidden: 1,
          detectedFaceCount: 3,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('includes archived owned identity faces in global people overview statistics', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Archived Person' });
        const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);
        await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });

        await expect(sut.getAccessiblePeopleStatistics(user.id, { minimumFaceCount: 1 })).resolves.toEqual({
          total: 1,
          hidden: 0,
          detectedFaceCount: 1,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('dedupes an identity represented by both personal and space-person rows', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
        const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Shared Alice' });
        const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);
        await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
        const spacePerson = await ctx.database
          .insertInto('shared_space_person')
          .values({
            spaceId: space.id,
            identityId: identity.id,
            name: 'Shared Alice',
            representativeFaceId: assetFace.id,
            type: 'person',
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await linkSpaceFace(ctx, spacePerson.id, assetFace.id);

        await expect(sut.getAccessiblePeopleStatistics(user.id, { minimumFaceCount: 1 })).resolves.toEqual({
          total: 1,
          hidden: 0,
          detectedFaceCount: 1,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('dedupes a detected face reachable through owned assets and timeline shared spaces', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
        const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Owned Shared' });
        const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);
        await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });

        await expect(sut.getAccessiblePeopleStatistics(user.id, { minimumFaceCount: 1 })).resolves.toEqual({
          total: 1,
          hidden: 0,
          detectedFaceCount: 1,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('includes linked-library faces only through timeline-enabled member spaces', async () => {
      const { ctx, sut } = setup();
      const { user: source } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      try {
        const { library } = await ctx.newLibrary({ ownerId: source.id });
        const { space } = await ctx.newSharedSpace({ createdById: source.id, faceRecognitionEnabled: true });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: source.id, role: SharedSpaceRole.Owner });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
        const { person } = await ctx.newPerson({ ownerId: source.id, name: 'Library Person' });
        const { asset } = await ctx.newAsset({
          ownerId: source.id,
          libraryId: library.id,
          visibility: AssetVisibility.Timeline,
        });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);
        await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
        await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: source.id });
        const spacePerson = await ctx.database
          .insertInto('shared_space_person')
          .values({
            spaceId: space.id,
            identityId: identity.id,
            name: 'Library Person',
            representativeFaceId: assetFace.id,
            type: 'person',
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await linkSpaceFace(ctx, spacePerson.id, assetFace.id);

        await expect(sut.getAccessiblePeopleStatistics(member.id, { minimumFaceCount: 1 })).resolves.toEqual({
          total: 1,
          hidden: 0,
          detectedFaceCount: 1,
        });

        await setMemberTimeline(ctx, { spaceId: space.id, userId: member.id, showInTimeline: false });

        await expect(sut.getAccessiblePeopleStatistics(member.id, { minimumFaceCount: 1 })).resolves.toEqual({
          total: 0,
          hidden: 0,
          detectedFaceCount: 0,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', 'in', [source.id, member.id]).execute();
      }
    });

    it('dedupes linked-library faces reachable through multiple timeline spaces', async () => {
      const { ctx, sut } = setup();
      const { user: source } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      try {
        const { library } = await ctx.newLibrary({ ownerId: source.id });
        const { person } = await ctx.newPerson({ ownerId: source.id, name: 'Library Person' });
        const { asset } = await ctx.newAsset({
          ownerId: source.id,
          libraryId: library.id,
          visibility: AssetVisibility.Timeline,
        });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);
        await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });

        for (let index = 0; index < 2; index++) {
          const { space } = await ctx.newSharedSpace({ createdById: source.id, faceRecognitionEnabled: true });
          await ctx.newSharedSpaceMember({ spaceId: space.id, userId: source.id, role: SharedSpaceRole.Owner });
          await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
          await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: source.id });
          const spacePerson = await ctx.database
            .insertInto('shared_space_person')
            .values({
              spaceId: space.id,
              identityId: identity.id,
              name: 'Library Person',
              representativeFaceId: assetFace.id,
              type: 'person',
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          await linkSpaceFace(ctx, spacePerson.id, assetFace.id);
        }

        await expect(sut.getAccessiblePeopleStatistics(member.id, { minimumFaceCount: 1 })).resolves.toEqual({
          total: 1,
          hidden: 0,
          detectedFaceCount: 1,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', 'in', [source.id, member.id]).execute();
      }
    });

    it('keeps identity list and statistics aligned by excluding identities only evidenced by offline assets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        const { person: visiblePerson } = await ctx.newPerson({ ownerId: user.id, name: 'Visible' });
        const { asset: visibleAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
        const { assetFace: visibleFace } = await ctx.newAssetFace({
          assetId: visibleAsset.id,
          personGroupId: visiblePerson.personGroupId,
        });
        const visibleIdentity = await sut.ensurePersonIdentity(visiblePerson.personGroupId);
        await sut.linkFace({ assetFaceId: visibleFace.id, identityId: visibleIdentity.id, source: 'owner-person' });

        const { person: offlinePerson } = await ctx.newPerson({
          ownerId: user.id,
          name: 'Offline',
          isHidden: true,
        });
        const { asset: offlineAsset } = await ctx.newAsset({
          ownerId: user.id,
          visibility: AssetVisibility.Timeline,
          isOffline: true,
        });
        const { assetFace: offlineFace } = await ctx.newAssetFace({
          assetId: offlineAsset.id,
          personGroupId: offlinePerson.personGroupId,
        });
        const offlineIdentity = await sut.ensurePersonIdentity(offlinePerson.personGroupId);
        await sut.linkFace({ assetFaceId: offlineFace.id, identityId: offlineIdentity.id, source: 'owner-person' });

        await expect(
          sut.getAccessiblePeople(user.id, {
            withHidden: true,
            page: 1,
            size: 50,
            minimumFaceCount: 1,
          }),
        ).resolves.toMatchObject({
          total: 1,
          hidden: 0,
          people: [expect.objectContaining({ id: visiblePerson.personGroupId })],
        });
        await expect(sut.getAccessiblePeopleStatistics(user.id, { minimumFaceCount: 1 })).resolves.toEqual({
          total: 1,
          hidden: 0,
          detectedFaceCount: 1,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });
  });

  describe('getAccessiblePeopleFaceStatistics', () => {
    it('splits owned global faces into visible, hidden, and unassigned buckets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        await newIdentityFace(ctx, sut, { ownerId: user.id, name: 'Visible' });
        await newIdentityFace(ctx, sut, { ownerId: user.id, name: 'Hidden', isHidden: true });
        const { asset: unassignedAsset } = await ctx.newAsset({
          ownerId: user.id,
          visibility: AssetVisibility.Timeline,
        });
        await ctx.newAssetFace({ assetId: unassignedAsset.id });

        const result = await sut.getAccessiblePeopleFaceStatistics(user.id, { minimumFaceCount: 1 });
        const overview = await sut.getAccessiblePeopleStatistics(user.id, { minimumFaceCount: 1 });

        expect(result).toEqual({
          detectedFaceCount: 3,
          assignedVisibleFaceCount: 1,
          namedVisiblePersonCount: 1,
          assignedHiddenFaceCount: 1,
          unassignedFaceCount: 1,
        });
        expect(result.detectedFaceCount).toBe(overview.detectedFaceCount);
        expect(result.assignedVisibleFaceCount + result.assignedHiddenFaceCount + result.unassignedFaceCount).toBe(
          result.detectedFaceCount,
        );
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('classifies identity faces as visible when any accessible eligible profile is visible', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
        const { assetFace, identity } = await newIdentityFace(ctx, sut, {
          ownerId: user.id,
          name: 'Hidden personal',
          isHidden: true,
        });
        const spacePerson = await ctx.database
          .insertInto('shared_space_person')
          .values({
            spaceId: space.id,
            identityId: identity.id,
            name: 'Visible space',
            isHidden: false,
            representativeFaceId: assetFace.id,
            type: 'person',
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await linkSpaceFace(ctx, spacePerson.id, assetFace.id);

        await expect(sut.getAccessiblePeopleFaceStatistics(user.id, { minimumFaceCount: 1 })).resolves.toEqual({
          detectedFaceCount: 1,
          assignedVisibleFaceCount: 1,
          namedVisiblePersonCount: 1,
          assignedHiddenFaceCount: 0,
          unassignedFaceCount: 0,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('treats low-evidence unnamed identities below minimumFaceCount as unassigned', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        await newIdentityFace(ctx, sut, { ownerId: user.id });

        await expect(sut.getAccessiblePeopleFaceStatistics(user.id, { minimumFaceCount: 2 })).resolves.toEqual({
          detectedFaceCount: 1,
          assignedVisibleFaceCount: 0,
          namedVisiblePersonCount: 0,
          assignedHiddenFaceCount: 0,
          unassignedFaceCount: 1,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('returns unassigned faces when no identity is linked and is deterministic', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
        await ctx.newAssetFace({ assetId: asset.id });
        await ctx.newAssetFace({ assetId: asset.id });

        const first = await sut.getAccessiblePeopleFaceStatistics(user.id, { minimumFaceCount: 1 });
        const second = await sut.getAccessiblePeopleFaceStatistics(user.id, { minimumFaceCount: 1 });

        expect(first).toEqual({
          detectedFaceCount: 2,
          assignedVisibleFaceCount: 0,
          namedVisiblePersonCount: 0,
          assignedHiddenFaceCount: 0,
          unassignedFaceCount: 2,
        });
        expect(second).toEqual(first);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('includes archived assets but excludes invalid global assets and face rows', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        const valid = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
        await ctx.newAssetFace({ assetId: valid.asset.id });
        const archived = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
        await ctx.newAssetFace({ assetId: archived.asset.id });

        const invalidAssets = await Promise.all([
          ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline, deletedAt: new Date() }),
          ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline, isOffline: true }),
          ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked }),
        ]);
        for (const { asset } of invalidAssets) {
          await ctx.newAssetFace({ assetId: asset.id });
        }

        const invalidFaceAsset = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
        await ctx.newAssetFace({ assetId: invalidFaceAsset.asset.id, isVisible: false });
        await ctx.newAssetFace({ assetId: invalidFaceAsset.asset.id, deletedAt: new Date() });

        await expect(sut.getAccessiblePeopleFaceStatistics(user.id, { minimumFaceCount: 1 })).resolves.toEqual({
          detectedFaceCount: 2,
          assignedVisibleFaceCount: 0,
          namedVisiblePersonCount: 0,
          assignedHiddenFaceCount: 0,
          unassignedFaceCount: 2,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('includes linked-library faces only through timeline-enabled member spaces and dedupes overlaps', async () => {
      const { ctx, sut } = setup();
      const { user: source } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      try {
        const { library } = await ctx.newLibrary({ ownerId: source.id });
        const { space } = await ctx.newSharedSpace({ createdById: source.id, faceRecognitionEnabled: true });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: source.id, role: SharedSpaceRole.Owner });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
        const { person } = await ctx.newPerson({ ownerId: source.id, name: 'Library Person' });
        const { asset } = await ctx.newAsset({
          ownerId: source.id,
          libraryId: library.id,
          visibility: AssetVisibility.Timeline,
        });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);
        await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: source.id });
        await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: source.id });
        const spacePerson = await ctx.database
          .insertInto('shared_space_person')
          .values({
            spaceId: space.id,
            identityId: identity.id,
            name: 'Library Person',
            representativeFaceId: assetFace.id,
            type: 'person',
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await linkSpaceFace(ctx, spacePerson.id, assetFace.id);

        await expect(sut.getAccessiblePeopleFaceStatistics(member.id, { minimumFaceCount: 1 })).resolves.toEqual({
          detectedFaceCount: 1,
          assignedVisibleFaceCount: 1,
          namedVisiblePersonCount: 1,
          assignedHiddenFaceCount: 0,
          unassignedFaceCount: 0,
        });

        await setMemberTimeline(ctx, { spaceId: space.id, userId: member.id, showInTimeline: false });

        await expect(sut.getAccessiblePeopleFaceStatistics(member.id, { minimumFaceCount: 1 })).resolves.toEqual({
          detectedFaceCount: 0,
          assignedVisibleFaceCount: 0,
          namedVisiblePersonCount: 0,
          assignedHiddenFaceCount: 0,
          unassignedFaceCount: 0,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', 'in', [source.id, member.id]).execute();
      }
    });

    it('counts linked-library identity faces from multiple libraries through one timeline-visible space', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      try {
        const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
        const { library: library1 } = await ctx.newLibrary({ ownerId: owner.id });
        const { library: library2 } = await ctx.newLibrary({ ownerId: owner.id });
        await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library1.id, addedById: owner.id });
        await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library2.id, addedById: owner.id });

        const first = await newLibraryIdentityFace(ctx, sut, {
          ownerId: owner.id,
          libraryId: library1.id,
          name: 'Alice',
        });
        const second = await newLibraryIdentityFace(ctx, sut, {
          ownerId: owner.id,
          libraryId: library2.id,
          personId: first.person.personGroupId,
          identityId: first.identity.id,
        });
        const spacePerson = await ctx.database
          .insertInto('shared_space_person')
          .values({
            spaceId: space.id,
            identityId: first.identity.id,
            name: 'Alice',
            representativeFaceId: first.assetFace.id,
            type: 'person',
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await linkSpaceFace(ctx, spacePerson.id, first.assetFace.id);
        await linkSpaceFace(ctx, spacePerson.id, second.assetFace.id);

        await expect(sut.getAccessiblePeopleFaceStatistics(member.id, { minimumFaceCount: 1 })).resolves.toEqual({
          detectedFaceCount: 2,
          assignedVisibleFaceCount: 2,
          namedVisiblePersonCount: 1,
          assignedHiddenFaceCount: 0,
          unassignedFaceCount: 0,
        });
        await expect(sut.getAccessiblePeopleStatistics(member.id, { minimumFaceCount: 1 })).resolves.toEqual({
          total: 1,
          hidden: 0,
          detectedFaceCount: 2,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', 'in', [owner.id, member.id]).execute();
      }
    });

    it('counts multiple linked-library owners for a member and excludes them for a stranger', async () => {
      const { ctx, sut } = setup();
      const { user: ownerA } = await ctx.newUser();
      const { user: ownerB } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { user: stranger } = await ctx.newUser();
      try {
        const owners = [
          { userId: ownerA.id, name: 'Owner A Person' },
          { userId: ownerB.id, name: 'Owner B Person' },
        ];

        for (const owner of owners) {
          const { space } = await ctx.newSharedSpace({ createdById: owner.userId, faceRecognitionEnabled: true });
          await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.userId, role: SharedSpaceRole.Owner });
          await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
          await setMemberTimeline(ctx, { spaceId: space.id, userId: member.id, showInTimeline: true });
          const { library } = await ctx.newLibrary({ ownerId: owner.userId });
          await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.userId });
          const face = await newLibraryIdentityFace(ctx, sut, {
            ownerId: owner.userId,
            libraryId: library.id,
            name: owner.name,
          });
          const spacePerson = await ctx.database
            .insertInto('shared_space_person')
            .values({
              spaceId: space.id,
              identityId: face.identity.id,
              name: owner.name,
              representativeFaceId: face.assetFace.id,
              type: 'person',
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          await linkSpaceFace(ctx, spacePerson.id, face.assetFace.id);
        }

        await expect(sut.getAccessiblePeopleFaceStatistics(member.id, { minimumFaceCount: 1 })).resolves.toEqual({
          detectedFaceCount: 2,
          assignedVisibleFaceCount: 2,
          namedVisiblePersonCount: 2,
          assignedHiddenFaceCount: 0,
          unassignedFaceCount: 0,
        });
        await expect(sut.getAccessiblePeopleStatistics(member.id, { minimumFaceCount: 1 })).resolves.toEqual({
          total: 2,
          hidden: 0,
          detectedFaceCount: 2,
        });
        await expect(sut.getAccessiblePeopleFaceStatistics(stranger.id, { minimumFaceCount: 1 })).resolves.toEqual({
          detectedFaceCount: 0,
          assignedVisibleFaceCount: 0,
          namedVisiblePersonCount: 0,
          assignedHiddenFaceCount: 0,
          unassignedFaceCount: 0,
        });
        await expect(sut.getAccessiblePeopleStatistics(stranger.id, { minimumFaceCount: 1 })).resolves.toEqual({
          total: 0,
          hidden: 0,
          detectedFaceCount: 0,
        });
      } finally {
        await ctx.database
          .deleteFrom('user')
          .where('id', 'in', [ownerA.id, ownerB.id, member.id, stranger.id])
          .execute();
      }
    });

    it('does not classify linked-library identity faces as assigned without a published space person', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      try {
        const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
        const { library: library1 } = await ctx.newLibrary({ ownerId: owner.id });
        const { library: library2 } = await ctx.newLibrary({ ownerId: owner.id });
        await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library1.id, addedById: owner.id });
        await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library2.id, addedById: owner.id });

        const first = await newLibraryIdentityFace(ctx, sut, {
          ownerId: owner.id,
          libraryId: library1.id,
          name: 'Private Alice',
        });
        await newLibraryIdentityFace(ctx, sut, {
          ownerId: owner.id,
          libraryId: library2.id,
          personId: first.person.personGroupId,
          identityId: first.identity.id,
        });

        await expect(sut.getAccessiblePeopleFaceStatistics(member.id, { minimumFaceCount: 1 })).resolves.toEqual({
          detectedFaceCount: 2,
          assignedVisibleFaceCount: 0,
          namedVisiblePersonCount: 0,
          assignedHiddenFaceCount: 0,
          unassignedFaceCount: 2,
        });
        await expect(sut.getAccessiblePeopleStatistics(member.id, { minimumFaceCount: 1 })).resolves.toEqual({
          total: 0,
          hidden: 0,
          detectedFaceCount: 2,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', 'in', [owner.id, member.id]).execute();
      }
    });

    it('excludes linked-library space faces from global stats when the member hides the space from timeline', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      try {
        const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
        await setMemberTimeline(ctx, { spaceId: space.id, userId: member.id, showInTimeline: false });
        const { library: library1 } = await ctx.newLibrary({ ownerId: owner.id });
        const { library: library2 } = await ctx.newLibrary({ ownerId: owner.id });
        await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library1.id, addedById: owner.id });
        await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library2.id, addedById: owner.id });
        const first = await newLibraryIdentityFace(ctx, sut, {
          ownerId: owner.id,
          libraryId: library1.id,
          name: 'Alice',
        });
        const second = await newLibraryIdentityFace(ctx, sut, {
          ownerId: owner.id,
          libraryId: library2.id,
          personId: first.person.personGroupId,
          identityId: first.identity.id,
        });
        const spacePerson = await ctx.database
          .insertInto('shared_space_person')
          .values({
            spaceId: space.id,
            identityId: first.identity.id,
            name: 'Alice',
            representativeFaceId: first.assetFace.id,
            type: 'person',
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await linkSpaceFace(ctx, spacePerson.id, first.assetFace.id);
        await linkSpaceFace(ctx, spacePerson.id, second.assetFace.id);

        await expect(sut.getAccessiblePeopleFaceStatistics(member.id, { minimumFaceCount: 1 })).resolves.toEqual({
          detectedFaceCount: 0,
          assignedVisibleFaceCount: 0,
          namedVisiblePersonCount: 0,
          assignedHiddenFaceCount: 0,
          unassignedFaceCount: 0,
        });
        await expect(sut.getAccessiblePeopleStatistics(member.id, { minimumFaceCount: 1 })).resolves.toEqual({
          total: 0,
          hidden: 0,
          detectedFaceCount: 0,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', 'in', [owner.id, member.id]).execute();
      }
    });

    it('removes shared-space library faces after membership is removed while preserving owned global faces', async () => {
      const { ctx, sut } = setup();
      const { user: source } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      try {
        const { asset: ownedAsset } = await ctx.newAsset({ ownerId: member.id, visibility: AssetVisibility.Timeline });
        await ctx.newAssetFace({ assetId: ownedAsset.id });

        const { library } = await ctx.newLibrary({ ownerId: source.id });
        const { space } = await ctx.newSharedSpace({ createdById: source.id, faceRecognitionEnabled: true });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: source.id, role: SharedSpaceRole.Owner });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
        const { person } = await ctx.newPerson({ ownerId: source.id, name: 'Library Person' });
        const { asset } = await ctx.newAsset({
          ownerId: source.id,
          libraryId: library.id,
          visibility: AssetVisibility.Timeline,
        });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);
        await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
        await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: source.id });
        const spacePerson = await ctx.database
          .insertInto('shared_space_person')
          .values({
            spaceId: space.id,
            identityId: identity.id,
            name: 'Library Person',
            representativeFaceId: assetFace.id,
            type: 'person',
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await linkSpaceFace(ctx, spacePerson.id, assetFace.id);

        await expect(sut.getAccessiblePeopleFaceStatistics(member.id, { minimumFaceCount: 1 })).resolves.toEqual({
          detectedFaceCount: 2,
          assignedVisibleFaceCount: 1,
          namedVisiblePersonCount: 1,
          assignedHiddenFaceCount: 0,
          unassignedFaceCount: 1,
        });

        await ctx.database
          .deleteFrom('shared_space_member')
          .where('spaceId', '=', space.id)
          .where('userId', '=', member.id)
          .execute();

        await expect(sut.getAccessiblePeopleFaceStatistics(member.id, { minimumFaceCount: 1 })).resolves.toEqual({
          detectedFaceCount: 1,
          assignedVisibleFaceCount: 0,
          namedVisiblePersonCount: 0,
          assignedHiddenFaceCount: 0,
          unassignedFaceCount: 1,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', 'in', [source.id, member.id]).execute();
      }
    });

    it('counts distinct named visible accessible identities', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      try {
        const named = await newIdentityFace(ctx, sut, { ownerId: user.id, name: 'Alice' });
        const { assetFace: secondNamedFace } = await ctx.newAssetFace({
          assetId: named.asset.id,
          personGroupId: named.person.personGroupId,
        });
        await sut.linkFace({
          assetFaceId: secondNamedFace.id,
          identityId: named.identity.id,
          source: 'owner-person',
        });
        await newIdentityFace(ctx, sut, { ownerId: user.id, name: 'Hidden', isHidden: true });
        await newIdentityFace(ctx, sut, { ownerId: user.id, name: '' });
        await newIdentityFace(ctx, sut, { ownerId: user.id, name: ' '.repeat(3) });

        await expect(sut.getAccessiblePeopleFaceStatistics(user.id, { minimumFaceCount: 1 })).resolves.toMatchObject({
          namedVisiblePersonCount: 1,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });
  });

  describe('getAccessiblePersonStatistics', () => {
    it('counts owned and timeline shared-space identity faces once each', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: partner } = await ctx.newUser();
      try {
        const { person } = await ctx.newPerson({ ownerId: owner.id, name: 'Alice' });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);

        const { asset: ownedAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
        const { assetFace: ownedFace } = await ctx.newAssetFace({ assetId: ownedAsset.id, personGroupId: person.personGroupId });
        await sut.linkFace({ assetFaceId: ownedFace.id, identityId: identity.id, source: 'owner-person' });

        const { space } = await ctx.newSharedSpace({ createdById: partner.id, faceRecognitionEnabled: true });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: partner.id, role: SharedSpaceRole.Owner });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Viewer });
        await setMemberTimeline(ctx, { spaceId: space.id, userId: owner.id, showInTimeline: true });
        const { asset: sharedAsset } = await ctx.newAsset({
          ownerId: partner.id,
          visibility: AssetVisibility.Timeline,
        });
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: sharedAsset.id, addedById: partner.id });
        const { assetFace: sharedFace } = await ctx.newAssetFace({ assetId: sharedAsset.id });
        await sut.linkFace({ assetFaceId: sharedFace.id, identityId: identity.id, source: 'shared-space-evidence' });

        await expect(sut.getAccessiblePersonStatistics(owner.id, identity.id)).resolves.toEqual({
          assets: 2,
          faces: 2,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', 'in', [owner.id, partner.id]).execute();
      }
    });

    it('counts linked-library identity faces only through timeline-enabled member spaces', async () => {
      const { ctx, sut } = setup();
      const { user: source } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      try {
        const { library } = await ctx.newLibrary({ ownerId: source.id });
        const { person } = await ctx.newPerson({ ownerId: source.id, name: 'Library Person' });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);
        const { space } = await ctx.newSharedSpace({ createdById: source.id, faceRecognitionEnabled: true });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: source.id, role: SharedSpaceRole.Owner });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
        await setMemberTimeline(ctx, { spaceId: space.id, userId: member.id, showInTimeline: true });
        await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: source.id });
        const { asset } = await ctx.newAsset({
          ownerId: source.id,
          libraryId: library.id,
          visibility: AssetVisibility.Timeline,
        });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
        await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });

        await expect(sut.getAccessiblePersonStatistics(member.id, identity.id)).resolves.toEqual({
          assets: 1,
          faces: 1,
        });

        await setMemberTimeline(ctx, { spaceId: space.id, userId: member.id, showInTimeline: false });

        await expect(sut.getAccessiblePersonStatistics(member.id, identity.id)).resolves.toEqual({
          assets: 0,
          faces: 0,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', 'in', [source.id, member.id]).execute();
      }
    });

    it('removes inaccessible space assets after the user leaves a space while keeping owned assets', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: partner } = await ctx.newUser();
      try {
        const { person } = await ctx.newPerson({ ownerId: owner.id, name: 'Alice' });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);

        const { asset: ownedAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
        const { assetFace: ownedFace } = await ctx.newAssetFace({ assetId: ownedAsset.id, personGroupId: person.personGroupId });
        await sut.linkFace({ assetFaceId: ownedFace.id, identityId: identity.id, source: 'owner-person' });

        const { space } = await ctx.newSharedSpace({ createdById: partner.id, faceRecognitionEnabled: true });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: partner.id, role: SharedSpaceRole.Owner });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Viewer });
        await setMemberTimeline(ctx, { spaceId: space.id, userId: owner.id, showInTimeline: true });
        const { asset: sharedAsset } = await ctx.newAsset({
          ownerId: partner.id,
          visibility: AssetVisibility.Timeline,
        });
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: sharedAsset.id, addedById: partner.id });
        const { assetFace: sharedFace } = await ctx.newAssetFace({ assetId: sharedAsset.id });
        await sut.linkFace({ assetFaceId: sharedFace.id, identityId: identity.id, source: 'shared-space-evidence' });

        await expect(sut.getAccessiblePersonStatistics(owner.id, identity.id)).resolves.toEqual({
          assets: 2,
          faces: 2,
        });

        await ctx.database
          .deleteFrom('shared_space_member')
          .where('spaceId', '=', space.id)
          .where('userId', '=', owner.id)
          .execute();

        await expect(sut.getAccessiblePersonStatistics(owner.id, identity.id)).resolves.toEqual({
          assets: 1,
          faces: 1,
        });
      } finally {
        await ctx.database.deleteFrom('user').where('id', 'in', [owner.id, partner.id]).execute();
      }
    });

    it('keeps global person detail statistics stable after identity backfill reruns', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      try {
        const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Backfilled Person' });
        const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);
        await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });

        await expect(sut.getAccessiblePersonStatistics(user.id, identity.id)).resolves.toEqual({ assets: 1, faces: 1 });

        await sut.backfillPersonalIdentities({ limit: 100 });
        await sut.backfillSpacePersonIdentities({ limit: 100 });
        await sut.backfillPersonalIdentities({ limit: 100 });
        await sut.backfillSpacePersonIdentities({ limit: 100 });

        await expect(sut.getAccessiblePersonStatistics(user.id, identity.id)).resolves.toEqual({ assets: 1, faces: 1 });
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('resolves a timeline-enabled shared-space profile id to the accessible identity id', async () => {
      const { ctx, sut } = setup();
      const { user: source } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      try {
        const { person } = await ctx.newPerson({ ownerId: source.id, name: 'Library Person' });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);
        const { space } = await ctx.newSharedSpace({ createdById: source.id, faceRecognitionEnabled: true });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: source.id, role: SharedSpaceRole.Owner });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
        await setMemberTimeline(ctx, { spaceId: space.id, userId: member.id, showInTimeline: true });
        const { asset } = await ctx.newAsset({ ownerId: source.id, visibility: AssetVisibility.Timeline });
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: source.id });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
        const spacePerson = await ctx.database
          .insertInto('shared_space_person')
          .values({ spaceId: space.id, identityId: identity.id, name: 'Library Person', type: 'person' })
          .returningAll()
          .executeTakeFirstOrThrow();
        await linkSpaceFace(ctx, spacePerson.id, assetFace.id);

        await expect(sut.getAccessibleProfileIdentityId(member.id, spacePerson.id)).resolves.toBe(identity.id);

        await setMemberTimeline(ctx, { spaceId: space.id, userId: member.id, showInTimeline: false });

        await expect(sut.getAccessibleProfileIdentityId(member.id, spacePerson.id)).resolves.toBeUndefined();
      } finally {
        await ctx.database.deleteFrom('user').where('id', 'in', [source.id, member.id]).execute();
      }
    });

    it('does not resolve hidden or faceless shared-space profile ids to accessible global statistics', async () => {
      const { ctx, sut } = setup();
      const { user: source } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      try {
        const { person } = await ctx.newPerson({ ownerId: source.id, name: 'Library Person' });
        const identity = await sut.ensurePersonIdentity(person.personGroupId);
        const { space } = await ctx.newSharedSpace({ createdById: source.id, faceRecognitionEnabled: true });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: source.id, role: SharedSpaceRole.Owner });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
        await setMemberTimeline(ctx, { spaceId: space.id, userId: member.id, showInTimeline: true });
        const { asset } = await ctx.newAsset({ ownerId: source.id, visibility: AssetVisibility.Timeline });
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: source.id });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id });

        const hiddenProfile = await ctx.database
          .insertInto('shared_space_person')
          .values({ spaceId: space.id, identityId: identity.id, name: 'Hidden', type: 'person', isHidden: true })
          .returningAll()
          .executeTakeFirstOrThrow();
        await linkSpaceFace(ctx, hiddenProfile.id, assetFace.id);

        const { person: facelessPerson } = await ctx.newPerson({ ownerId: source.id, name: 'Faceless Person' });
        const facelessIdentity = await sut.ensurePersonIdentity(facelessPerson.personGroupId);
        const facelessProfile = await ctx.database
          .insertInto('shared_space_person')
          .values({
            spaceId: space.id,
            identityId: facelessIdentity.id,
            name: 'Faceless',
            type: 'person',
            isHidden: false,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        await expect(sut.getAccessibleProfileIdentityId(member.id, hiddenProfile.id)).resolves.toBeUndefined();
        await expect(sut.getAccessibleProfileIdentityId(member.id, facelessProfile.id)).resolves.toBeUndefined();
      } finally {
        await ctx.database.deleteFrom('user').where('id', 'in', [source.id, member.id]).execute();
      }
    });
  });

  it('infers shared-space person identity from linked personal faces and reports conflicts', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: aliceFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alice.personGroupId });
    const { assetFace: bobFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: bob.personGroupId });
    const aliceIdentity = await sut.ensurePersonIdentity(alice.personGroupId);
    const bobIdentity = await sut.ensurePersonIdentity(bob.personGroupId);
    await sut.linkFace({ assetFaceId: aliceFace.id, identityId: aliceIdentity.id, source: 'backfill' });
    await sut.linkFace({ assetFaceId: bobFace.id, identityId: bobIdentity.id, source: 'backfill' });
    const singleIdentityPerson = await newSpacePerson(ctx, space.id);
    const conflictingPerson = await newSpacePerson(ctx, space.id);
    await linkSpaceFace(ctx, singleIdentityPerson.id, aliceFace.id);
    await linkSpaceFace(ctx, conflictingPerson.id, aliceFace.id);
    await linkSpaceFace(ctx, conflictingPerson.id, bobFace.id);

    const result = await sut.backfillSpacePersonIdentities({ limit: 100 });

    const spacePeople = await ctx.database
      .selectFrom('shared_space_person')
      .leftJoin('shared_space_person_face', 'shared_space_person_face.personId', 'shared_space_person.id')
      .select(['shared_space_person.identityId'])
      .select((eb) => eb.fn.count('shared_space_person_face.assetFaceId').$castTo<number>().as('faceCount'))
      .where('shared_space_person.spaceId', '=', space.id)
      .groupBy(['shared_space_person.id', 'shared_space_person.identityId'])
      .execute();

    expect(result).toEqual(expect.objectContaining({ processed: 2, conflictCount: 0 }));
    expect(spacePeople.filter((person) => person.identityId === aliceIdentity.id)).toHaveLength(1);
    expect(spacePeople.filter((person) => person.identityId === bobIdentity.id)).toHaveLength(1);
    expect(spacePeople.filter((person) => person.identityId === null && person.faceCount > 0)).toHaveLength(0);
  });

  it('splits mixed legacy space people by linked face identity when backfill is rerun', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
      const { assetFace: aliceFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: alice.personGroupId });
      const { assetFace: bobFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: bob.personGroupId });
      const aliceIdentity = await sut.ensurePersonIdentity(alice.personGroupId);
      const bobIdentity = await sut.ensurePersonIdentity(bob.personGroupId);
      await sut.linkFace({ assetFaceId: aliceFace.id, identityId: aliceIdentity.id, source: 'backfill' });
      await sut.linkFace({ assetFaceId: bobFace.id, identityId: bobIdentity.id, source: 'backfill' });
      const mixedSpacePerson = await newSpacePerson(ctx, space.id);
      await linkSpaceFace(ctx, mixedSpacePerson.id, aliceFace.id);
      await linkSpaceFace(ctx, mixedSpacePerson.id, bobFace.id);

      await expect(sut.hasBackfillWork()).resolves.toBe(true);

      const result = await sut.backfillSpacePersonIdentities({ limit: 100 });

      const spacePeople = await ctx.database
        .selectFrom('shared_space_person')
        .leftJoin('shared_space_person_face', 'shared_space_person_face.personId', 'shared_space_person.id')
        .select(['shared_space_person.id', 'shared_space_person.identityId'])
        .select((eb) => eb.fn.count('shared_space_person_face.assetFaceId').$castTo<number>().as('faceCount'))
        .where('shared_space_person.spaceId', '=', space.id)
        .groupBy(['shared_space_person.id', 'shared_space_person.identityId'])
        .execute();

      expect(result.conflictCount).toBe(0);
      expect(result.affectedSpaceAssets).toEqual([]);
      await expect(sut.getPendingSharedSpaceFaceMatchBackfillTargets()).resolves.toEqual([]);
      expect(spacePeople.filter((person) => person.identityId === aliceIdentity.id)).toHaveLength(1);
      expect(spacePeople.filter((person) => person.identityId === bobIdentity.id)).toHaveLength(1);
      expect(spacePeople.find((person) => person.identityId === aliceIdentity.id)?.faceCount).toBe(1);
      expect(spacePeople.find((person) => person.identityId === bobIdentity.id)?.faceCount).toBe(1);
      expect(spacePeople.filter((person) => person.identityId === null && person.faceCount > 0)).toHaveLength(0);
      await expect(sut.getBackfillWork()).resolves.toEqual({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('does not persist rematch targets for already consistent shared-space people', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Consistent' });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const identity = await sut.ensurePersonIdentity(person.personGroupId);
      await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'backfill' });
      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, identityId: identity.id, representativeFaceId: assetFace.id, type: 'person' })
        .returningAll()
        .executeTakeFirstOrThrow();
      await linkSpaceFace(ctx, spacePerson.id, assetFace.id);

      const result = await sut.backfillSpacePersonIdentities({ limit: 100 });

      expect(result).toEqual(
        expect.objectContaining({
          conflictCount: 0,
          affectedSpaceAssets: [],
        }),
      );
      await expect(sut.getPendingSharedSpaceFaceMatchBackfillTargets()).resolves.toEqual([]);
      await expect(sut.getBackfillWork()).resolves.toEqual({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('infers shared-space person identity from a dominant linked identity with tiny noisy candidates', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { person: dominantPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Dominant' });
    const dominantIdentity = await sut.ensurePersonIdentity(dominantPerson.personGroupId);
    const noisyIdentities = [];
    const spacePerson = await newSpacePerson(ctx, space.id);

    for (let index = 0; index < 100; index++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: dominantPerson.personGroupId });
      await sut.linkFace({ assetFaceId: assetFace.id, identityId: dominantIdentity.id, source: 'backfill' });
      await linkSpaceFace(ctx, spacePerson.id, assetFace.id);
    }

    for (let index = 0; index < 3; index++) {
      const { person: noisyPerson } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: noisyPerson.personGroupId });
      const noisyIdentity = await sut.ensurePersonIdentity(noisyPerson.personGroupId);
      noisyIdentities.push(noisyIdentity.id);
      await sut.linkFace({ assetFaceId: assetFace.id, identityId: noisyIdentity.id, source: 'backfill' });
      await linkSpaceFace(ctx, spacePerson.id, assetFace.id);
    }

    await sut.backfillSpacePersonIdentities({ limit: 100 });

    const updatedSpacePerson = await ctx.database
      .selectFrom('shared_space_person')
      .select('identityId')
      .where('id', '=', spacePerson.id)
      .executeTakeFirstOrThrow();

    expect(updatedSpacePerson.identityId).toBe(dominantIdentity.id);
    expect(noisyIdentities).toHaveLength(3);
  });

  it('infers shared-space person identity when high-evidence dominance has a few absolute noisy faces', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { person: dominantPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Dominant' });
    const dominantIdentity = await sut.ensurePersonIdentity(dominantPerson.personGroupId);
    const spacePerson = await newSpacePerson(ctx, space.id);

    for (let index = 0; index < 73; index++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: dominantPerson.personGroupId });
      await sut.linkFace({ assetFaceId: assetFace.id, identityId: dominantIdentity.id, source: 'backfill' });
      await linkSpaceFace(ctx, spacePerson.id, assetFace.id);
    }

    for (let personIndex = 0; personIndex < 2; personIndex++) {
      const { person: noisyPerson } = await ctx.newPerson({ ownerId: user.id });
      const noisyIdentity = await sut.ensurePersonIdentity(noisyPerson.personGroupId);

      for (let faceIndex = 0; faceIndex < 2; faceIndex++) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: noisyPerson.personGroupId });
        await sut.linkFace({ assetFaceId: assetFace.id, identityId: noisyIdentity.id, source: 'backfill' });
        await linkSpaceFace(ctx, spacePerson.id, assetFace.id);
      }
    }

    await sut.backfillSpacePersonIdentities({ limit: 100 });

    const updatedSpacePerson = await ctx.database
      .selectFrom('shared_space_person')
      .select('identityId')
      .where('id', '=', spacePerson.id)
      .executeTakeFirstOrThrow();

    expect(updatedSpacePerson.identityId).toBe(dominantIdentity.id);
  });

  it('infers shared-space person identity when large-cluster noisy evidence stays proportional to dominance', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { person: dominantPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Dominant' });
    const { person: noisyPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Noisy' });
    const dominantIdentity = await sut.ensurePersonIdentity(dominantPerson.personGroupId);
    const noisyIdentity = await sut.ensurePersonIdentity(noisyPerson.personGroupId);
    const spacePerson = await newSpacePerson(ctx, space.id);

    for (let index = 0; index < 200; index++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: dominantPerson.personGroupId });
      await sut.linkFace({ assetFaceId: assetFace.id, identityId: dominantIdentity.id, source: 'backfill' });
      await linkSpaceFace(ctx, spacePerson.id, assetFace.id);
    }

    for (let index = 0; index < 20; index++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: noisyPerson.personGroupId });
      await sut.linkFace({ assetFaceId: assetFace.id, identityId: noisyIdentity.id, source: 'backfill' });
      await linkSpaceFace(ctx, spacePerson.id, assetFace.id);
    }

    await sut.backfillSpacePersonIdentities({ limit: 100 });

    const updatedSpacePerson = await ctx.database
      .selectFrom('shared_space_person')
      .select('identityId')
      .where('id', '=', spacePerson.id)
      .executeTakeFirstOrThrow();

    expect(updatedSpacePerson.identityId).toBe(dominantIdentity.id);
  });

  it('splits shared-space person identity when noisy evidence exceeds the old proportional tolerance', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { person: dominantPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Dominant' });
    const { person: noisyPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Noisy' });
    const dominantIdentity = await sut.ensurePersonIdentity(dominantPerson.personGroupId);
    const noisyIdentity = await sut.ensurePersonIdentity(noisyPerson.personGroupId);
    const spacePerson = await newSpacePerson(ctx, space.id);

    for (let index = 0; index < 73; index++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: dominantPerson.personGroupId });
      await sut.linkFace({ assetFaceId: assetFace.id, identityId: dominantIdentity.id, source: 'backfill' });
      await linkSpaceFace(ctx, spacePerson.id, assetFace.id);
    }

    for (let index = 0; index < 9; index++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: noisyPerson.personGroupId });
      await sut.linkFace({ assetFaceId: assetFace.id, identityId: noisyIdentity.id, source: 'backfill' });
      await linkSpaceFace(ctx, spacePerson.id, assetFace.id);
    }

    await sut.backfillSpacePersonIdentities({ limit: 100 });

    const spacePeople = await ctx.database
      .selectFrom('shared_space_person')
      .select('identityId')
      .where('spaceId', '=', space.id)
      .execute();

    expect(spacePeople.filter((person) => person.identityId === dominantIdentity.id)).toHaveLength(1);
    expect(spacePeople.filter((person) => person.identityId === noisyIdentity.id)).toHaveLength(1);
  });

  it('repairs duplicate space-person rows for the same identity instead of leaving conflicts', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: firstFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    const { assetFace: secondFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    const identity = await sut.ensurePersonIdentity(person.personGroupId);
    await sut.linkFace({ assetFaceId: firstFace.id, identityId: identity.id, source: 'backfill' });
    await sut.linkFace({ assetFaceId: secondFace.id, identityId: identity.id, source: 'backfill' });
    const firstSpacePerson = await newSpacePerson(ctx, space.id);
    const duplicateSpacePerson = await newSpacePerson(ctx, space.id);
    await linkSpaceFace(ctx, firstSpacePerson.id, firstFace.id);
    await linkSpaceFace(ctx, duplicateSpacePerson.id, secondFace.id);

    const result = await sut.backfillSpacePersonIdentities({ limit: 100 });

    const spacePeople = await ctx.database
      .selectFrom('shared_space_person')
      .select(['id', 'identityId'])
      .where('id', 'in', [firstSpacePerson.id, duplicateSpacePerson.id])
      .execute();

    expect(result.conflictCount).toBe(0);
    expect(spacePeople.filter((person) => person.identityId === identity.id)).toHaveLength(1);
    expect(spacePeople.filter((person) => person.identityId === null)).toHaveLength(0);
  });

  it('replaces, unlinks, and merges identity face links without violating scoped profile uniqueness', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { person: targetPerson } = await ctx.newPerson({ ownerId: user.id });
    const { person: sourcePerson } = await ctx.newPerson({ ownerId: user.id });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: targetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: targetPerson.personGroupId });
    const { assetFace: sourceFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: sourcePerson.personGroupId });
    const targetIdentity = await sut.ensurePersonIdentity(targetPerson.personGroupId);
    const sourceIdentity = await sut.ensurePersonIdentity(sourcePerson.personGroupId);
    const sourceSpacePerson = await newSpacePerson(ctx, space.id);
    await ctx.database
      .updateTable('shared_space_person')
      .set({ identityId: sourceIdentity.id })
      .where('id', '=', sourceSpacePerson.id)
      .execute();

    await sut.linkFace({ assetFaceId: targetFace.id, identityId: targetIdentity.id, source: 'backfill' });
    await sut.replaceFaceIdentity({ assetFaceId: sourceFace.id, identityId: sourceIdentity.id, source: 'manual' });
    await sut.unlinkFaces([targetFace.id]);
    const result = await sut.mergeIdentities({
      targetIdentityId: targetIdentity.id,
      sourceIdentityIds: [sourceIdentity.id, sourceIdentity.id],
      source: 'manual',
    });

    const links = await ctx.database
      .selectFrom('face_identity_face')
      .select(['assetFaceId', 'identityId'])
      .where('assetFaceId', 'in', [targetFace.id, sourceFace.id])
      .execute();
    const sourceProfile = await ctx.database
      .selectFrom('person')
      .select('identityId')
      .where('personGroupId', '=', sourcePerson.personGroupId)
      .executeTakeFirstOrThrow();
    const sourceSpaceProfile = await ctx.database
      .selectFrom('shared_space_person')
      .select('identityId')
      .where('id', '=', sourceSpacePerson.id)
      .executeTakeFirstOrThrow();

    expect(result).toEqual({ personalProfileConflictCount: 1, spaceProfileConflictCount: 0 });
    expect(links).toEqual([{ assetFaceId: sourceFace.id, identityId: sourceIdentity.id }]);
    expect(sourceProfile.identityId).toBe(sourceIdentity.id);
    expect(sourceSpaceProfile.identityId).toBe(sourceIdentity.id);
  });

  it('does not leave a source person attached to moved identity faces when a same-owner target person exists', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { person: targetPerson } = await ctx.newPerson({ ownerId: user.id });
      const { person: sourcePerson } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: sourceFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: sourcePerson.personGroupId });
      const targetIdentity = await sut.ensurePersonIdentity(targetPerson.personGroupId);
      const sourceIdentity = await sut.ensurePersonIdentity(sourcePerson.personGroupId);
      await sut.linkFace({
        assetFaceId: sourceFace.id,
        identityId: sourceIdentity.id,
        source: 'owner-person',
      });

      await sut
        .mergeIdentities({
          targetIdentityId: targetIdentity.id,
          sourceIdentityIds: [sourceIdentity.id],
          source: 'shared-space-evidence',
        })
        .catch(() => {});

      const faces = await ctx.database
        .selectFrom('asset_face')
        .innerJoin('person', 'person.personGroupId', 'asset_face.personGroupId')
        .innerJoin('face_identity_face', 'face_identity_face.assetFaceId', 'asset_face.id')
        .select([
          'asset_face.id as assetFaceId',
          'asset_face.personId',
          'person.identityId as personIdentityId',
          'face_identity_face.identityId as faceIdentityId',
        ])
        .where('asset_face.id', '=', sourceFace.id)
        .execute();

      expect(faces.filter((face) => face.personIdentityId !== face.faceIdentityId)).toEqual([]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('does not leave a source space person attached to moved identity faces when a same-space target profile exists', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      const targetSpacePerson = await newSpacePerson(ctx, space.id);
      const sourceSpacePerson = await newSpacePerson(ctx, space.id);
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: sourceFace } = await ctx.newAssetFace({ assetId: asset.id });
      await linkSpaceFace(ctx, sourceSpacePerson.id, sourceFace.id);
      const targetIdentity = await sut.ensureSpacePersonIdentity(targetSpacePerson.id);
      const sourceIdentity = await sut.ensureSpacePersonIdentity(sourceSpacePerson.id);
      await sut.linkFace({
        assetFaceId: sourceFace.id,
        identityId: sourceIdentity.id,
        source: 'shared-space-evidence',
      });

      await sut
        .mergeIdentities({
          targetIdentityId: targetIdentity.id,
          sourceIdentityIds: [sourceIdentity.id],
          source: 'shared-space-evidence',
        })
        .catch(() => {});

      const faces = await ctx.database
        .selectFrom('shared_space_person_face')
        .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
        .innerJoin('face_identity_face', 'face_identity_face.assetFaceId', 'shared_space_person_face.assetFaceId')
        .select([
          'shared_space_person_face.assetFaceId as assetFaceId',
          'shared_space_person_face.personId as spacePersonId',
          'shared_space_person.identityId as spacePersonIdentityId',
          'face_identity_face.identityId as faceIdentityId',
        ])
        .where('shared_space_person_face.assetFaceId', '=', sourceFace.id)
        .execute();

      expect(faces.filter((face) => face.spacePersonIdentityId !== face.faceIdentityId)).toEqual([]);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('counts same-owner personal conflicts before identity merge', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { person: targetPerson } = await ctx.newPerson({ ownerId: user.id });
      const { person: sourcePerson } = await ctx.newPerson({ ownerId: user.id });
      const targetIdentity = await sut.ensurePersonIdentity(targetPerson.personGroupId);
      const sourceIdentity = await sut.ensurePersonIdentity(sourcePerson.personGroupId);

      await expect(
        sut.getMergeConflicts({
          targetIdentityId: targetIdentity.id,
          sourceIdentityIds: [sourceIdentity.id],
        }),
      ).resolves.toEqual({ personalProfileConflictCount: 1, spaceProfileConflictCount: 0 });
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  it('counts same-space profile conflicts before identity merge', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    try {
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      const targetSpacePerson = await newSpacePerson(ctx, space.id);
      const sourceSpacePerson = await newSpacePerson(ctx, space.id);
      const targetIdentity = await sut.ensureSpacePersonIdentity(targetSpacePerson.id);
      const sourceIdentity = await sut.ensureSpacePersonIdentity(sourceSpacePerson.id);

      await expect(
        sut.getMergeConflicts({
          targetIdentityId: targetIdentity.id,
          sourceIdentityIds: [sourceIdentity.id],
        }),
      ).resolves.toEqual({ personalProfileConflictCount: 0, spaceProfileConflictCount: 1 });
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
    }
  });

  describe('getSpaceMergeConflictPairs', () => {
    it('returns the conflicting same-space rows with the fields needed to pick a survivor', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      try {
        const { space } = await ctx.newSharedSpace({ createdById: user.id });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });

        const targetSpacePerson = await ctx.database
          .insertInto('shared_space_person')
          .values({ spaceId: space.id, name: '', nameSource: 'auto', faceCount: 1, type: 'person' })
          .returningAll()
          .executeTakeFirstOrThrow();
        const sourceSpacePerson = await ctx.database
          .insertInto('shared_space_person')
          .values({ spaceId: space.id, name: 'Alice', nameSource: 'manual', faceCount: 3, type: 'person' })
          .returningAll()
          .executeTakeFirstOrThrow();
        const targetIdentity = await sut.ensureSpacePersonIdentity(targetSpacePerson.id);
        const sourceIdentity = await sut.ensureSpacePersonIdentity(sourceSpacePerson.id);

        await expect(
          sut.getSpaceMergeConflictPairs({
            targetIdentityId: targetIdentity.id,
            sourceIdentityIds: [sourceIdentity.id],
          }),
        ).resolves.toEqual([
          {
            spaceId: space.id,
            sourceId: sourceSpacePerson.id,
            sourceName: 'Alice',
            sourceNameSource: 'manual',
            sourceFaceCount: 3,
            targetId: targetSpacePerson.id,
            targetName: '',
            targetNameSource: 'auto',
            targetFaceCount: 1,
          },
        ]);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('returns no pairs when only one side is present in a space', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      try {
        const { space } = await ctx.newSharedSpace({ createdById: user.id });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
        const sourceSpacePerson = await newSpacePerson(ctx, space.id);
        const targetSpacePerson = await newSpacePerson(ctx, space.id);
        const targetIdentity = await sut.ensureSpacePersonIdentity(targetSpacePerson.id);
        const sourceIdentity = await sut.ensureSpacePersonIdentity(sourceSpacePerson.id);
        // Remove the target-identity row so the space holds only the source side.
        await ctx.database.deleteFrom('shared_space_person').where('id', '=', targetSpacePerson.id).execute();

        await expect(
          sut.getSpaceMergeConflictPairs({
            targetIdentityId: targetIdentity.id,
            sourceIdentityIds: [sourceIdentity.id],
          }),
        ).resolves.toEqual([]);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });
  });

  describe('same-space collapse convergence', () => {
    it('migrates the surviving space-person onto the target identity once the colliding row is collapsed', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      try {
        const { space } = await ctx.newSharedSpace({ createdById: user.id });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
        // The loser holds the target identity; the survivor holds the source identity and must end
        // up on the canonical target identity after the collapse + merge.
        const loserSpacePerson = await newSpacePerson(ctx, space.id);
        const survivorSpacePerson = await newSpacePerson(ctx, space.id);
        const targetIdentity = await sut.ensureSpacePersonIdentity(loserSpacePerson.id);
        const sourceIdentity = await sut.ensureSpacePersonIdentity(survivorSpacePerson.id);

        // While both rows exist the merge is blocked by the (spaceId, identityId) unique index.
        await expect(
          sut.mergeIdentities({
            targetIdentityId: targetIdentity.id,
            sourceIdentityIds: [sourceIdentity.id],
            source: 'shared-space-evidence',
          }),
        ).resolves.toEqual({ personalProfileConflictCount: 0, spaceProfileConflictCount: 1 });
        const blocked = await ctx.database
          .selectFrom('shared_space_person')
          .select('identityId')
          .where('id', '=', survivorSpacePerson.id)
          .executeTakeFirstOrThrow();
        expect(blocked.identityId).toBe(sourceIdentity.id);

        // Collapse the colliding row away (faces are reassigned to the survivor in the service path).
        await ctx.database.deleteFrom('shared_space_person').where('id', '=', loserSpacePerson.id).execute();

        await expect(
          sut.mergeIdentities({
            targetIdentityId: targetIdentity.id,
            sourceIdentityIds: [sourceIdentity.id],
            source: 'shared-space-evidence',
          }),
        ).resolves.toEqual({ personalProfileConflictCount: 0, spaceProfileConflictCount: 0 });

        const survivor = await ctx.database
          .selectFrom('shared_space_person')
          .select(['id', 'identityId'])
          .where('id', '=', survivorSpacePerson.id)
          .executeTakeFirstOrThrow();
        expect(survivor.identityId).toBe(targetIdentity.id);

        const loserGone = await ctx.database
          .selectFrom('shared_space_person')
          .select('id')
          .where('id', '=', loserSpacePerson.id)
          .executeTakeFirst();
        expect(loserGone).toBeUndefined();
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });
  });

  describe('repair', () => {
    it('merges non-conflicting identities by moving face links without merging scoped metadata', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      const birthDate = new Date('1990-01-01');
      const { person: personalPerson } = await ctx.newPerson({
        ownerId: user.id,
        name: 'Personal Alice',
        birthDate,
      });
      const { asset: personalAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: personalFace } = await ctx.newAssetFace({
        assetId: personalAsset.id,
        personGroupId: personalPerson.personGroupId,
      });
      const personalIdentity = await sut.ensurePersonIdentity(personalPerson.personGroupId);
      await sut.linkFace({ assetFaceId: personalFace.id, identityId: personalIdentity.id, source: 'owner-person' });

      const { asset: spaceAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: spaceFace } = await ctx.newAssetFace({ assetId: spaceAsset.id });
      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({
          spaceId: space.id,
          name: 'Space Alice',
          birthDate: '1988-02-03',
          representativeFaceId: spaceFace.id,
          type: 'person',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await linkSpaceFace(ctx, spacePerson.id, spaceFace.id);
      const spaceIdentity = await sut.ensureSpacePersonIdentity(spacePerson.id);
      await sut.linkFace({ assetFaceId: spaceFace.id, identityId: spaceIdentity.id, source: 'shared-space-evidence' });

      await sut.mergeIdentities({
        targetIdentityId: spaceIdentity.id,
        sourceIdentityIds: [personalIdentity.id],
        source: 'manual',
      });

      const oldSourceFaces = await ctx.database
        .selectFrom('face_identity_face')
        .selectAll()
        .where('identityId', '=', personalIdentity.id)
        .execute();
      const personalProfile = await ctx.database
        .selectFrom('person')
        .select(['name', 'birthDate', 'identityId'])
        .where('personGroupId', '=', personalPerson.personGroupId)
        .executeTakeFirstOrThrow();
      const spaceProfile = await ctx.database
        .selectFrom('shared_space_person')
        .select(['name', 'birthDate', 'identityId'])
        .where('id', '=', spacePerson.id)
        .executeTakeFirstOrThrow();

      expect(oldSourceFaces).toHaveLength(0);
      expect(personalProfile.name).toBe('Personal Alice');
      expect(personalProfile.birthDate).toEqual(birthDate);
      expect(personalProfile.identityId).toBe(spaceIdentity.id);
      expect(spaceProfile).toEqual(
        expect.objectContaining({
          name: 'Space Alice',
          birthDate: new Date('1988-02-03'),
          identityId: spaceIdentity.id,
        }),
      );
    });

    it('detaches a space profile into a fresh identity and moves only that profile faces', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      const { person: personalPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      const { asset: personalAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: personalFace } = await ctx.newAssetFace({
        assetId: personalAsset.id,
        personGroupId: personalPerson.personGroupId,
      });
      const originalIdentity = await sut.ensurePersonIdentity(personalPerson.personGroupId);
      await sut.linkFace({ assetFaceId: personalFace.id, identityId: originalIdentity.id, source: 'owner-person' });

      const { asset: spaceAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: spaceFace } = await ctx.newAssetFace({ assetId: spaceAsset.id });
      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({
          spaceId: space.id,
          identityId: originalIdentity.id,
          name: 'Alice in Space',
          representativeFaceId: spaceFace.id,
          type: 'person',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await linkSpaceFace(ctx, spacePerson.id, spaceFace.id);
      await sut.linkFace({
        assetFaceId: spaceFace.id,
        identityId: originalIdentity.id,
        source: 'shared-space-evidence',
      });

      const newIdentityId = await sut.detachScopedProfile({
        type: 'space-person',
        id: spacePerson.id,
        spaceId: space.id,
      });

      const detachedProfile = await ctx.database
        .selectFrom('shared_space_person')
        .select('identityId')
        .where('id', '=', spacePerson.id)
        .executeTakeFirstOrThrow();
      const sourcePersonal = await ctx.database
        .selectFrom('person')
        .select('identityId')
        .where('personGroupId', '=', personalPerson.personGroupId)
        .executeTakeFirstOrThrow();
      const links = await ctx.database
        .selectFrom('face_identity_face')
        .select(['assetFaceId', 'identityId'])
        .where('assetFaceId', 'in', [personalFace.id, spaceFace.id])
        .orderBy('assetFaceId')
        .execute();

      expect(newIdentityId).not.toBe(originalIdentity.id);
      expect(detachedProfile.identityId).toBe(newIdentityId);
      expect(sourcePersonal.identityId).toBe(originalIdentity.id);
      expect(links).toEqual(
        expect.arrayContaining([
          { assetFaceId: personalFace.id, identityId: originalIdentity.id },
          { assetFaceId: spaceFace.id, identityId: newIdentityId },
        ]),
      );
    });

    // Separating a profile is a statement about GROUPING — "this profile is not the same human as the ones it
    // was grouped with". It says nothing about whether each individual face inside it is correctly placed. So
    // the detach must not relabel those faces as human placements: `source='manual'` is read by BOTH engines
    // as "a human attested to this face", owner-agnostically (face-repair.ts isSettledForOwner /
    // face-person-verdict.repository.ts applyPendingEligibility) — permanently excluding them from the cleanup
    // console and from suggestions. Stamping it here would hide every ML mistake in exactly the contaminated
    // cluster a user separates BECAUSE it is contaminated, with no UI to undo it. Same shape as the R1 people
    // -merge decision: a person-level action is not a per-face attestation.
    it('preserves each backing face source when detaching, so machine placements stay scannable', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      const { person: personalPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      const originalIdentity = await sut.ensurePersonIdentity(personalPerson.personGroupId);

      // Two faces behind ONE space profile, reaching it by different routes: one placed by the machine, one
      // genuinely placed by a human. The detach must leave both labels exactly as it found them.
      const { asset: evidenceAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: evidenceFace } = await ctx.newAssetFace({ assetId: evidenceAsset.id });
      const { asset: placedAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: placedFace } = await ctx.newAssetFace({ assetId: placedAsset.id });

      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({
          spaceId: space.id,
          identityId: originalIdentity.id,
          name: 'Alice in Space',
          representativeFaceId: evidenceFace.id,
          type: 'person',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await linkSpaceFace(ctx, spacePerson.id, evidenceFace.id);
      await linkSpaceFace(ctx, spacePerson.id, placedFace.id);
      await sut.linkFace({
        assetFaceId: evidenceFace.id,
        identityId: originalIdentity.id,
        source: 'shared-space-evidence',
      });
      await sut.linkFace({ assetFaceId: placedFace.id, identityId: originalIdentity.id, source: 'manual' });

      const newIdentityId = await sut.detachScopedProfile({
        type: 'space-person',
        id: spacePerson.id,
        spaceId: space.id,
      });

      const links = await ctx.database
        .selectFrom('face_identity_face')
        .select(['assetFaceId', 'identityId', 'source'])
        .where('assetFaceId', 'in', [evidenceFace.id, placedFace.id])
        .execute();

      const evidenceLink = links.find((link) => link.assetFaceId === evidenceFace.id);
      const placedLink = links.find((link) => link.assetFaceId === placedFace.id);

      // The machine placement keeps its true origin — still visible to both scan engines.
      expect(evidenceLink?.source).toBe('shared-space-evidence');
      // Positive control: a face a human really did place keeps 'manual'. Without this, dropping the write
      // entirely (rather than dropping only the relabel) would pass the assertion above just as well.
      expect(placedLink?.source).toBe('manual');
      // The separation itself still holds: both faces moved to the fresh identity, which is what makes the
      // detach stick — not the source stamp.
      expect(newIdentityId).not.toBe(originalIdentity.id);
      expect(evidenceLink?.identityId).toBe(newIdentityId);
      expect(placedLink?.identityId).toBe(newIdentityId);
    });

    it('rejects detach when selected space-person faces also back non-repairable personal profiles', async () => {
      const { ctx, sut } = setup();
      const { user: actor } = await ctx.newUser();
      const { user: sourceOwner } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: actor.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: actor.id, role: SharedSpaceRole.Editor });
      const { person: sourcePerson } = await ctx.newPerson({ ownerId: sourceOwner.id });
      const { asset } = await ctx.newAsset({ ownerId: sourceOwner.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: sourcePerson.personGroupId });
      const identity = await sut.ensurePersonIdentity(sourcePerson.personGroupId);
      await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
      const spacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, identityId: identity.id, representativeFaceId: assetFace.id, type: 'person' })
        .returningAll()
        .executeTakeFirstOrThrow();
      await linkSpaceFace(ctx, spacePerson.id, assetFace.id);

      const resolved = await sut.resolveDetachRef(actor.id, {
        type: 'space-person',
        id: spacePerson.id,
        spaceId: space.id,
      });

      expect(resolved).toEqual(expect.objectContaining({ accessible: true, allBackingFacesRepairable: false }));
    });
  });

  describe('embedding-consistency guard on automatic identity merges', () => {
    it('refuses an automatic shared-space merge of two embedding-distinct identities', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      try {
        const target = await newPersonalIdentityCluster(ctx, sut, {
          ownerId: user.id,
          embedding: axisEmbedding('first'),
          faceCount: 3,
        });
        const source = await newOrphanIdentityCluster(ctx, {
          ownerId: user.id,
          embedding: axisEmbedding('second'),
          faceCount: 3,
        });

        await sut.mergeIdentities({
          targetIdentityId: target.identity.id,
          sourceIdentityIds: [source.identity.id],
          source: 'shared-space-evidence',
        });

        // Faces stay on their original identity — the catastrophic cross-person reassignment is blocked.
        expect(await getLinkedIdentityIds(ctx, source.assetFaceIds)).toEqual(new Set([source.identity.id]));
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('still performs an automatic shared-space merge when the two identities are embedding-consistent', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      try {
        const target = await newPersonalIdentityCluster(ctx, sut, {
          ownerId: user.id,
          embedding: axisEmbedding('first'),
          faceCount: 3,
        });
        const source = await newOrphanIdentityCluster(ctx, {
          ownerId: user.id,
          embedding: axisEmbedding('first'),
          faceCount: 3,
        });

        await sut.mergeIdentities({
          targetIdentityId: target.identity.id,
          sourceIdentityIds: [source.identity.id],
          source: 'shared-space-evidence',
        });

        expect(await getLinkedIdentityIds(ctx, source.assetFaceIds)).toEqual(new Set([target.identity.id]));
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('does not apply the embedding guard to manual merges', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      try {
        const target = await newPersonalIdentityCluster(ctx, sut, {
          ownerId: user.id,
          embedding: axisEmbedding('first'),
          faceCount: 3,
        });
        const source = await newOrphanIdentityCluster(ctx, {
          ownerId: user.id,
          embedding: axisEmbedding('second'),
          faceCount: 3,
        });

        await sut.mergeIdentities({
          targetIdentityId: target.identity.id,
          sourceIdentityIds: [source.identity.id],
          source: 'manual',
        });

        expect(await getLinkedIdentityIds(ctx, source.assetFaceIds)).toEqual(new Set([target.identity.id]));
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('merges only the embedding-consistent source when one call mixes consistent and distinct sources', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      try {
        const target = await newPersonalIdentityCluster(ctx, sut, {
          ownerId: user.id,
          embedding: axisEmbedding('first'),
          faceCount: 3,
        });
        const consistentSource = await newOrphanIdentityCluster(ctx, {
          ownerId: user.id,
          embedding: axisEmbedding('first'),
          faceCount: 3,
        });
        const distinctSource = await newOrphanIdentityCluster(ctx, {
          ownerId: user.id,
          embedding: axisEmbedding('second'),
          faceCount: 3,
        });

        await sut.mergeIdentities({
          targetIdentityId: target.identity.id,
          sourceIdentityIds: [consistentSource.identity.id, distinctSource.identity.id],
          source: 'shared-space-evidence',
        });

        // Per-source filtering, not all-or-nothing: the consistent source merges, the distinct one is left alone.
        expect(await getLinkedIdentityIds(ctx, consistentSource.assetFaceIds)).toEqual(new Set([target.identity.id]));
        expect(await getLinkedIdentityIds(ctx, distinctSource.assetFaceIds)).toEqual(
          new Set([distinctSource.identity.id]),
        );
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('allows an automatic merge when the source has no embedded faces (cannot assess)', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      try {
        const target = await newPersonalIdentityCluster(ctx, sut, {
          ownerId: user.id,
          embedding: axisEmbedding('first'),
          faceCount: 3,
        });
        const source = await newOrphanIdentityCluster(ctx, { ownerId: user.id, faceCount: 3 });

        await sut.mergeIdentities({
          targetIdentityId: target.identity.id,
          sourceIdentityIds: [source.identity.id],
          source: 'shared-space-evidence',
        });

        expect(await getLinkedIdentityIds(ctx, source.assetFaceIds)).toEqual(new Set([target.identity.id]));
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('allows an automatic merge when the target has no embedded faces (cannot assess)', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      try {
        // Target identity exists with faces but no face_search rows, so its centroid is unknowable.
        const target = await newOrphanIdentityCluster(ctx, { ownerId: user.id, faceCount: 3 });
        const source = await newOrphanIdentityCluster(ctx, {
          ownerId: user.id,
          embedding: axisEmbedding('second'),
          faceCount: 3,
        });

        await sut.mergeIdentities({
          targetIdentityId: target.identity.id,
          sourceIdentityIds: [source.identity.id],
          source: 'shared-space-evidence',
        });

        expect(await getLinkedIdentityIds(ctx, source.assetFaceIds)).toEqual(new Set([target.identity.id]));
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('merges a source just inside the 0.5 centroid threshold but refuses one just outside it', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      try {
        const target = await newPersonalIdentityCluster(ctx, sut, {
          ownerId: user.id,
          embedding: axisEmbedding('first'),
          faceCount: 3,
        });
        const insideSource = await newOrphanIdentityCluster(ctx, {
          ownerId: user.id,
          embedding: blendedEmbedding(140, 116), // centroid distance ~0.453 (< 0.5)
          faceCount: 3,
        });
        const outsideSource = await newOrphanIdentityCluster(ctx, {
          ownerId: user.id,
          embedding: blendedEmbedding(116, 140), // centroid distance ~0.547 (> 0.5)
          faceCount: 3,
        });

        await sut.mergeIdentities({
          targetIdentityId: target.identity.id,
          sourceIdentityIds: [insideSource.identity.id, outsideSource.identity.id],
          source: 'shared-space-evidence',
        });

        expect(await getLinkedIdentityIds(ctx, insideSource.assetFaceIds)).toEqual(new Set([target.identity.id]));
        expect(await getLinkedIdentityIds(ctx, outsideSource.assetFaceIds)).toEqual(
          new Set([outsideSource.identity.id]),
        );
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });
  });

  describe('personal identity repair embedding guard', () => {
    it('does not move a face onto a person it does not resemble during personal backfill', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      try {
        // Person A: a clean axis-A cluster.
        const personA = await newPersonalIdentityCluster(ctx, sut, {
          ownerId: user.id,
          embedding: axisEmbedding('first'),
          faceCount: 3,
        });
        // Person B owns a single axis-B face that is (corruptly) linked to A's identity — the state a bad
        // automatic merge leaves behind. Repair would otherwise follow the identity link and move it to A.
        const { person: personB } = await ctx.newPerson({ ownerId: user.id });
        const identityB = await sut.ensurePersonIdentity(personB.personGroupId);
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        const { assetFace: corruptFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: personB.personGroupId });
        await ctx.database
          .insertInto('face_search')
          .values({ faceId: corruptFace.id, embedding: axisEmbedding('second') })
          .execute();
        await sut.linkFace({
          assetFaceId: corruptFace.id,
          identityId: personA.identity.id,
          source: 'shared-space-evidence',
        });

        await sut.backfillPersonalIdentities({ limit: 100 });

        const row = await ctx.database
          .selectFrom('asset_face')
          .select('personId')
          .where('id', '=', corruptFace.id)
          .executeTakeFirstOrThrow();
        expect(row.personId).toBe(personB.personGroupId);

        // The mismatch must be resolved by realigning the kept face's identity to its current person —
        // otherwise person.identityId stays DISTINCT FROM face_identity_face.identityId, getBackfillWork()
        // reports work forever, and handleFaceIdentityBackfill re-queues itself in an infinite loop.
        const link = await ctx.database
          .selectFrom('face_identity_face')
          .select('identityId')
          .where('assetFaceId', '=', corruptFace.id)
          .executeTakeFirstOrThrow();
        expect(link.identityId).toBe(identityB.id);
        const backfillWork = await sut.getBackfillWork();
        expect(backfillWork.hasPersonalIdentityWork).toBe(false);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('realigns a face whose linked identity has no person for the owner', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      try {
        // A face on person B is (corruptly) linked to an identity that NO person of this owner
        // references — the leftover state a scoped/cross-user merge can produce. There is no target
        // person to move the face onto, so repair must realign the link to the face's current person.
        // Skipping it leaves person.identityId DISTINCT FROM face_identity_face.identityId, so
        // getBackfillWork() reports work forever and handleFaceIdentityBackfill re-queues in an
        // endless loop of full-table passes.
        const { person } = await ctx.newPerson({ ownerId: user.id });
        const personIdentity = await sut.ensurePersonIdentity(person.personGroupId);
        const foreignIdentity = await ctx.database
          .insertInto('face_identity')
          .values({ type: 'person' })
          .returningAll()
          .executeTakeFirstOrThrow();
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
        await sut.linkFace({
          assetFaceId: assetFace.id,
          identityId: foreignIdentity.id,
          source: 'shared-space-evidence',
        });

        await sut.backfillPersonalIdentities({ limit: 100 });

        const row = await ctx.database
          .selectFrom('asset_face')
          .select('personId')
          .where('id', '=', assetFace.id)
          .executeTakeFirstOrThrow();
        expect(row.personId).toBe(person.personGroupId);

        const link = await ctx.database
          .selectFrom('face_identity_face')
          .select('identityId')
          .where('assetFaceId', '=', assetFace.id)
          .executeTakeFirstOrThrow();
        expect(link.identityId).toBe(personIdentity.id);

        const backfillWork = await sut.getBackfillWork();
        expect(backfillWork.hasPersonalIdentityWork).toBe(false);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('still moves a face that resembles the target person during personal backfill', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      try {
        const personA = await newPersonalIdentityCluster(ctx, sut, {
          ownerId: user.id,
          embedding: axisEmbedding('first'),
          faceCount: 3,
        });
        // Person B owns an axis-A face linked to A's identity: a legitimate consolidation that must proceed.
        const { person: personB } = await ctx.newPerson({ ownerId: user.id });
        await sut.ensurePersonIdentity(personB.personGroupId);
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        const { assetFace: resemblingFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: personB.personGroupId });
        await ctx.database
          .insertInto('face_search')
          .values({ faceId: resemblingFace.id, embedding: axisEmbedding('first') })
          .execute();
        await sut.linkFace({
          assetFaceId: resemblingFace.id,
          identityId: personA.identity.id,
          source: 'shared-space-evidence',
        });

        await sut.backfillPersonalIdentities({ limit: 100 });

        const row = await ctx.database
          .selectFrom('asset_face')
          .select('personId')
          .where('id', '=', resemblingFace.id)
          .executeTakeFirstOrThrow();
        expect(row.personId).toBe(personA.person.personGroupId);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('moves only the resembling faces and realigns the rest when one group mixes both', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      try {
        const personA = await newPersonalIdentityCluster(ctx, sut, {
          ownerId: user.id,
          embedding: axisEmbedding('first'),
          faceCount: 3,
        });
        const { person: personB } = await ctx.newPerson({ ownerId: user.id });
        const identityB = await sut.ensurePersonIdentity(personB.personGroupId);
        // Two faces on B, both linked to A's identity: one resembles A (axis-A), one does not (axis-B).
        const makeBFaceLinkedToA = async (embedding: string) => {
          const { asset } = await ctx.newAsset({ ownerId: user.id });
          const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: personB.personGroupId });
          await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding }).execute();
          await sut.linkFace({
            assetFaceId: assetFace.id,
            identityId: personA.identity.id,
            source: 'shared-space-evidence',
          });
          return assetFace.id;
        };
        const resemblingFaceId = await makeBFaceLinkedToA(axisEmbedding('first'));
        const distinctFaceId = await makeBFaceLinkedToA(axisEmbedding('second'));

        await sut.backfillPersonalIdentities({ limit: 100 });

        const faces = await ctx.database
          .selectFrom('asset_face')
          .select(['id', 'personId'])
          .where('id', 'in', [resemblingFaceId, distinctFaceId])
          .execute();
        const distinctLink = await ctx.database
          .selectFrom('face_identity_face')
          .select('identityId')
          .where('assetFaceId', '=', distinctFaceId)
          .executeTakeFirstOrThrow();

        expect(faces.find((face) => face.id === resemblingFaceId)?.personId).toBe(personA.person.personGroupId);
        expect(faces.find((face) => face.id === distinctFaceId)?.personId).toBe(personB.personGroupId);
        expect(distinctLink.identityId).toBe(identityB.id);
        const backfillWork = await sut.getBackfillWork();
        expect(backfillWork.hasPersonalIdentityWork).toBe(false);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('moves a face just inside the 0.5 distance threshold but refuses one just outside it', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      try {
        const personA = await newPersonalIdentityCluster(ctx, sut, {
          ownerId: user.id,
          embedding: axisEmbedding('first'),
          faceCount: 3,
        });
        const { person: personB } = await ctx.newPerson({ ownerId: user.id });
        await sut.ensurePersonIdentity(personB.personGroupId);
        const makeBFaceLinkedToA = async (embedding: string) => {
          const { asset } = await ctx.newAsset({ ownerId: user.id });
          const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: personB.personGroupId });
          await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding }).execute();
          await sut.linkFace({
            assetFaceId: assetFace.id,
            identityId: personA.identity.id,
            source: 'shared-space-evidence',
          });
          return assetFace.id;
        };
        const insideFaceId = await makeBFaceLinkedToA(blendedEmbedding(140, 116)); // distance ~0.453 (< 0.5)
        const outsideFaceId = await makeBFaceLinkedToA(blendedEmbedding(116, 140)); // distance ~0.547 (> 0.5)

        await sut.backfillPersonalIdentities({ limit: 100 });

        const faces = await ctx.database
          .selectFrom('asset_face')
          .select(['id', 'personId'])
          .where('id', 'in', [insideFaceId, outsideFaceId])
          .execute();
        expect(faces.find((face) => face.id === insideFaceId)?.personId).toBe(personA.person.personGroupId);
        expect(faces.find((face) => face.id === outsideFaceId)?.personId).toBe(personB.personGroupId);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });

    it('does not block a face once the target cluster is already contaminated (documents a known limitation)', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      try {
        // Person A is already 50/50 contaminated: three axis-A faces and three axis-B faces, all on A.
        const { person: personA } = await ctx.newPerson({ ownerId: user.id });
        const identityA = await sut.ensurePersonIdentity(personA.personGroupId);
        const addAFace = async (embedding: string) => {
          const { asset } = await ctx.newAsset({ ownerId: user.id });
          const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: personA.personGroupId });
          await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding }).execute();
          await sut.linkFace({ assetFaceId: assetFace.id, identityId: identityA.id, source: 'owner-person' });
        };
        for (let index = 0; index < 3; index++) {
          await addAFace(axisEmbedding('first'));
        }
        for (let index = 0; index < 3; index++) {
          await addAFace(axisEmbedding('second'));
        }
        // A new pure axis-B face. Against A's MIXED centroid it is only ~0.29 away (< 0.5), so the guard
        // does NOT block it — once a cluster spans two people its centroid no longer represents one person.
        const { person: personB } = await ctx.newPerson({ ownerId: user.id });
        await sut.ensurePersonIdentity(personB.personGroupId);
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        const { assetFace: bFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: personB.personGroupId });
        await ctx.database
          .insertInto('face_search')
          .values({ faceId: bFace.id, embedding: axisEmbedding('second') })
          .execute();
        await sut.linkFace({ assetFaceId: bFace.id, identityId: identityA.id, source: 'shared-space-evidence' });

        await sut.backfillPersonalIdentities({ limit: 100 });

        const row = await ctx.database
          .selectFrom('asset_face')
          .select('personId')
          .where('id', '=', bFace.id)
          .executeTakeFirstOrThrow();
        // Limitation: the guard is strongest at first contamination (clean target) and weaker mid-cascade.
        expect(row.personId).toBe(personA.personGroupId);
      } finally {
        await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      }
    });
  });

  // S7.8 (F13): the cleanup console's `lock` bucket passes assetFaceIds straight through from the request —
  // a client repeating an id (double-click, retry) must not make this call 500. Postgres refuses an
  // ON CONFLICT DO UPDATE that would touch the same row twice in one statement ("cannot affect row a second
  // time", 21000) unless the duplicate is removed before chunking.
  describe('replaceFaceIdentities', () => {
    it('deduplicates repeated assetFaceIds before chunking, writing exactly one row per distinct id', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const identity = await sut.ensurePersonIdentity(person.personGroupId);
      const { asset: assetA } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: faceA } = await ctx.newAssetFace({ assetId: assetA.id, personGroupId: person.personGroupId });
      const { asset: assetB } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: faceB } = await ctx.newAssetFace({ assetId: assetB.id, personGroupId: person.personGroupId });

      // Repeating faceA's id must not raise Postgres 21000.
      await sut.replaceFaceIdentities({
        assetFaceIds: [faceA.id, faceA.id, faceB.id],
        identityId: identity.id,
        source: 'manual',
      });

      const rows = await ctx.database
        .selectFrom('face_identity_face')
        .select('assetFaceId')
        .where('assetFaceId', 'in', [faceA.id, faceB.id])
        .execute();
      // Positive control built in: faceB is a genuinely DIFFERENT id in the same call and must still get its
      // own row — proving the fix only merges the DUPLICATE, not the whole batch.
      expect(rows.map((r) => r.assetFaceId).sort()).toEqual([faceA.id, faceB.id].sort());
    });

    // H5: getEligibleFaceIdsForPerson (the lock bucket's eligibility read) runs OUTSIDE the caller's
    // transaction and calls itself "advisory only". Without a write-time re-check here, a concurrent
    // reassign landing between that read and this write leaves asset_face.personId pointing at the new
    // person while this call still re-points the OLD person's identity onto the face — the same torn
    // state reattributeFaces/detachFaces already guard against at write time.
    it('excludes and does not write a face that moved off the required person between read and write', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person: personP } = await ctx.newPerson({ ownerId: user.id });
      const { person: personQ } = await ctx.newPerson({ ownerId: user.id });
      const identityP = await sut.ensurePersonIdentity(personP.personGroupId);
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      // GIVEN: an eligibility read taken before this call (e.g. getEligibleFaceIdsForPerson) observed this
      // face on personP — the face is created on P to model that stale snapshot.
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: personP.personGroupId });
      // GIVEN: a concurrent reassignment lands between that read and this write, moving the face onto
      // personQ before replaceFaceIdentities runs — the exact race the requirePersonId guard exists to catch.
      await ctx.database
        .updateTable('asset_face')
        .set({ personId: personQ.personGroupId })
        .where('id', '=', assetFace.id)
        .execute();

      // WHEN: the stale plan is written with requirePersonId still pinned to the person the read saw.
      const written = await sut.replaceFaceIdentities({
        assetFaceIds: [assetFace.id],
        identityId: identityP.id,
        source: 'manual',
        requirePersonId: personP.personGroupId,
      });

      // THEN: the raced face is neither returned nor linked to P's identity.
      expect(written).toEqual([]);
      const rows = await ctx.database
        .selectFrom('face_identity_face')
        .select('assetFaceId')
        .where('assetFaceId', '=', assetFace.id)
        .execute();
      expect(rows).toEqual([]);
    });

    // Positive control for the race test above: same call shape, but no concurrent reassignment occurs, so
    // the write must still go through — proves the guard filters on a genuine mismatch, not on
    // requirePersonId being set at all.
    it('writes normally when the face is still on the required person', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const identity = await sut.ensurePersonIdentity(person.personGroupId);
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      // GIVEN: the face is still on `person` — no race occurred.
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });

      // WHEN
      const written = await sut.replaceFaceIdentities({
        assetFaceIds: [assetFace.id],
        identityId: identity.id,
        source: 'manual',
        requirePersonId: person.personGroupId,
      });

      // THEN
      expect(written).toEqual([assetFace.id]);
      const row = await ctx.database
        .selectFrom('face_identity_face')
        .select(['assetFaceId', 'identityId', 'source'])
        .where('assetFaceId', '=', assetFace.id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ assetFaceId: assetFace.id, identityId: identity.id, source: 'manual' });
    });

    // The move path (executeRepair) calls replaceFaceIdentities WITHOUT requirePersonId, because
    // reattributeFaces has already re-pointed asset_face.personId onto the destination person inside the
    // SAME transaction by the time this runs — there is nothing stale left to re-check. Omitting the guard
    // must keep writing unconditionally, or the move path itself would silently stop relinking identities.
    it('writes unconditionally when requirePersonId is omitted, even for a face already reassigned elsewhere', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person: originalPerson } = await ctx.newPerson({ ownerId: user.id });
      const { person: destinationPerson } = await ctx.newPerson({ ownerId: user.id });
      const destinationIdentity = await sut.ensurePersonIdentity(destinationPerson.personGroupId);
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: originalPerson.personGroupId });
      // GIVEN: mirrors the move path — the face's personId has already moved to the destination by the
      // time replaceFaceIdentities runs.
      await ctx.database
        .updateTable('asset_face')
        .set({ personId: destinationPerson.personGroupId })
        .where('id', '=', assetFace.id)
        .execute();

      // WHEN: requirePersonId is omitted, exactly as the move path calls it.
      const written = await sut.replaceFaceIdentities({
        assetFaceIds: [assetFace.id],
        identityId: destinationIdentity.id,
        source: 'manual',
      });

      // THEN: the write happens regardless of asset_face.personId — no eligibility re-check runs.
      expect(written).toEqual([assetFace.id]);
      const row = await ctx.database
        .selectFrom('face_identity_face')
        .select('identityId')
        .where('assetFaceId', '=', assetFace.id)
        .executeTakeFirstOrThrow();
      expect(row.identityId).toBe(destinationIdentity.id);
    });

    it('returns [] for an empty assetFaceIds input without touching the database', async () => {
      const { sut } = setup();

      const written = await sut.replaceFaceIdentities({
        assetFaceIds: [],
        identityId: randomUUID(),
        source: 'manual',
      });

      expect(written).toEqual([]);
    });
  });

  // S10.3 (F20): the unconfirm DTO's assetFaceIds now goes up to MAX_RESOLVE_FACES (25 000), so this write
  // path must chunk its IN-list rather than send one unchunked statement. The filler below is far larger
  // than Postgres's 65 535 bind-parameter ceiling (unrelated, non-existent ids — a NOT/IN's bind count is a
  // function of list length, not of whether rows match) so the test proves the chunking is real: it would
  // fail with a bind-parameter error today, before chunking.
  describe('demoteManualFaceLinks (F20)', () => {
    it('demotes only the requested manual links, chunked, without a bind-parameter error on a huge request', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const identity = await sut.ensurePersonIdentity(person.personGroupId);

      const { asset: assetA } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: manualFaceA } = await ctx.newAssetFace({ assetId: assetA.id, personGroupId: person.personGroupId });
      await sut.linkFace({ assetFaceId: manualFaceA.id, identityId: identity.id, source: 'manual' });

      const { asset: assetB } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: manualFaceB } = await ctx.newAssetFace({ assetId: assetB.id, personGroupId: person.personGroupId });
      await sut.linkFace({ assetFaceId: manualFaceB.id, identityId: identity.id, source: 'manual' });

      // Positive control: a manual link that is NOT in the request — must stay 'manual'.
      const { asset: assetC } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: untouchedManualFace } = await ctx.newAssetFace({ assetId: assetC.id, personGroupId: person.personGroupId });
      await sut.linkFace({ assetFaceId: untouchedManualFace.id, identityId: identity.id, source: 'manual' });

      const filler = Array.from({ length: 70_000 }, () => randomUUID());
      const demoted = await sut.demoteManualFaceLinks([manualFaceA.id, manualFaceB.id, ...filler]);

      expect(demoted).toBe(2);
      const rows = await ctx.database
        .selectFrom('face_identity_face')
        .select(['assetFaceId', 'source'])
        .where('assetFaceId', 'in', [manualFaceA.id, manualFaceB.id, untouchedManualFace.id])
        .execute();
      const sourceOf = Object.fromEntries(rows.map((r) => [r.assetFaceId, r.source]));
      expect(sourceOf[manualFaceA.id]).toBe('ml');
      expect(sourceOf[manualFaceB.id]).toBe('ml');
      expect(sourceOf[untouchedManualFace.id]).toBe('manual'); // positive control: untouched
    });
  });

  // H6: face-verdict.service.ts calls this for every flagged face in a scan, unchunked. minFaces is
  // admin-settable, so a full-library scan can pass every flagged face in the instance — far larger than
  // Postgres's 65 535 bind-parameter ceiling (one id is one bind parameter). Mirrors the
  // demoteManualFaceLinks (F20) test above.
  describe('getManualLinkedFaceIds (H6)', () => {
    it('finds a manually-linked face among an id list far larger than the bind-parameter ceiling', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const identity = await sut.ensurePersonIdentity(person.personGroupId);
      const { asset: manualAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: manualFace } = await ctx.newAssetFace({ assetId: manualAsset.id, personGroupId: person.personGroupId });
      await sut.linkFace({ assetFaceId: manualFace.id, identityId: identity.id, source: 'manual' });

      const { asset: mlAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: mlFace } = await ctx.newAssetFace({ assetId: mlAsset.id, personGroupId: person.personGroupId });
      await sut.linkFace({ assetFaceId: mlFace.id, identityId: identity.id, source: 'ml' });

      const filler = Array.from({ length: 70_000 }, () => randomUUID());
      const linked = await sut.getManualLinkedFaceIds([manualFace.id, mlFace.id, ...filler]);

      expect(linked.has(manualFace.id)).toBe(true);
      expect(linked.has(mlFace.id)).toBe(false); // positive control: an ml-sourced link is not "manual"
    });
  });

  // H6: face-verdict.service.ts calls this for every owner among a scan's suspected owners, unchunked.
  // Same bind-parameter ceiling concern as getManualLinkedFaceIds above.
  describe('getPersonVerdictTokens (H6)', () => {
    it('resolves tokens for a person among a personId list far larger than the bind-parameter ceiling', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const identity = await sut.ensurePersonIdentity(person.personGroupId);
      // Positive control: a person with no identity yet must still resolve to its bare person token,
      // proving the chunk isn't merely returning the FIRST id it sees.
      const { person: personWithoutIdentity } = await ctx.newPerson({ ownerId: user.id });

      const filler = Array.from({ length: 70_000 }, () => randomUUID());
      const tokens = await sut.getPersonVerdictTokens([person.personGroupId, personWithoutIdentity.personGroupId, ...filler]);

      expect(tokens.get(person.personGroupId)).toEqual([`identity:${identity.id}`, `person:${person.personGroupId}`]);
      expect(tokens.get(personWithoutIdentity.personGroupId)).toEqual([`person:${personWithoutIdentity.personGroupId}`]);
    });
  });
});
