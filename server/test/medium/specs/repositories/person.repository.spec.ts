import { Kysely } from 'kysely';
import { AssetFileType } from 'src/enum';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(PersonRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(PersonRepository.name, () => {
  describe('createAll', () => {
    it('should create people in the groups they were given', async () => {
      const { ctx, sut } = setup();
      const [{ user: user1 }, { user: user2 }] = [await ctx.newUser(), await ctx.newUser()];

      const [group1, group2] = await sut.createGroups([
        { clusterGroupId: user1.clusterGroupId },
        { clusterGroupId: user1.clusterGroupId },
      ]);
      const group3 = await sut.createGroup(user2.id);

      const people = await sut.createAll([
        { ownerId: user1.id, name: 'Alice', personGroupId: group1.id },
        { ownerId: user1.id, name: 'Bob', personGroupId: group2.id },
        { ownerId: user2.id, name: 'Carol', personGroupId: group3.id },
      ]);

      expect(people.map(({ personGroupId }) => personGroupId)).toEqual([group1.id, group2.id, group3.id]);

      const groups = await ctx.database
        .selectFrom('person')
        .innerJoin('person_group', 'person_group.id', 'person.personGroupId')
        .innerJoin('user', 'user.id', 'person.ownerId')
        .select(['person.name', 'person_group.clusterGroupId', 'user.clusterGroupId as ownerClusterGroupId'])
        .where(
          'person.personGroupId',
          'in',
          people.map(({ personGroupId }) => personGroupId),
        )
        .execute();

      expect(groups).toHaveLength(3);
      for (const group of groups) {
        expect(group.clusterGroupId).toBe(group.ownerClusterGroupId);
      }
    });
  });

  describe('createGroup', () => {
    it('should create a group in the owner cluster group', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const group = await sut.createGroup(user.id);

      const owner = await ctx.database
        .selectFrom('person_group')
        .innerJoin('user', 'user.clusterGroupId', 'person_group.clusterGroupId')
        .select('user.id')
        .where('person_group.id', '=', group.id)
        .executeTakeFirstOrThrow();

      expect(owner.id).toBe(user.id);
    });

    it('should put people created with the same group into that group', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const [{ user: user1 }, { user: user2 }] = [await ctx.newUser(), await ctx.newUser()];

      const group = await sut.createGroup(user1.id);
      const person1 = await sut.create({ ownerId: user1.id, name: 'Alice', personGroupId: group.id });
      const person2 = await sut.create({ ownerId: user2.id, name: 'Alice', personGroupId: group.id });

      expect(person1.personGroupId).toBe(group.id);
      expect(person2.personGroupId).toBe(group.id);

      const groups = await ctx.database.selectFrom('person_group').select('person_group.id').execute();
      expect(groups.map(({ id }) => id)).toEqual([group.id]);
    });
  });

  describe('getByGroupId', () => {
    it('should not return a person owned by another user', async () => {
      const { ctx, sut } = setup();
      const [{ user: user1 }, { user: user2 }] = [await ctx.newUser(), await ctx.newUser()];
      const group = await sut.createGroup(user1.id);

      const person1 = await sut.create({ ownerId: user1.id, name: 'Alice', personGroupId: group.id });
      const person2 = await ctx.database
        .insertInto('person')
        .values({ ownerId: user2.id, name: 'Alice', personGroupId: person1.personGroupId })
        .returningAll()
        .executeTakeFirstOrThrow();

      await expect(sut.getByGroupId({ ownerId: user1.id, personGroupId: person1.personGroupId })).resolves.toEqual(
        expect.objectContaining({ personGroupId: person1.personGroupId, ownerId: user1.id }),
      );
      await expect(sut.getByGroupId({ ownerId: user2.id, personGroupId: person1.personGroupId })).resolves.toEqual(
        expect.objectContaining({ personGroupId: person2.personGroupId, ownerId: user2.id }),
      );
    });

    it('should return nothing when the group belongs to another user', async () => {
      const { ctx, sut } = setup();
      const [{ user: user1 }, { user: user2 }] = [await ctx.newUser(), await ctx.newUser()];
      const group = await sut.createGroup(user1.id);

      const person = await sut.create({ ownerId: user1.id, name: 'Alice', personGroupId: group.id });

      await expect(
        sut.getByGroupId({ ownerId: user2.id, personGroupId: person.personGroupId }),
      ).resolves.toBeUndefined();
    });
  });

  describe('deleteEmptyGroups', () => {
    it('should delete groups that no longer have any people', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      const [keptGroup, emptiedGroup] = await sut.createGroups([
        { clusterGroupId: user.clusterGroupId },
        { clusterGroupId: user.clusterGroupId },
      ]);

      const kept = await sut.create({ ownerId: user.id, name: 'Alice', personGroupId: keptGroup.id });
      const emptied = await sut.create({ ownerId: user.id, name: 'Bob', personGroupId: emptiedGroup.id });
      await ctx.database
        .deleteFrom('person')
        .where('person.ownerId', '=', emptied.ownerId)
        .where('person.personGroupId', '=', emptied.personGroupId)
        .execute();

      await expect(sut.deleteEmptyGroups()).resolves.toBe(1);

      const groups = await ctx.database.selectFrom('person_group').select('person_group.id').execute();
      expect(groups.map(({ id }) => id)).toEqual([kept.personGroupId]);
    });
  });

  describe('deleteOrphanedClusterGroups', () => {
    it('should delete cluster groups that no longer belong to a user, along with their people', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const [{ user: kept }, { user: removed }] = [await ctx.newUser(), await ctx.newUser()];
      const keptGroup = await sut.createGroup(kept.id);
      const removedGroup = await sut.createGroup(removed.id);

      const keptPerson = await sut.create({ ownerId: kept.id, name: 'Alice', personGroupId: keptGroup.id });
      await sut.create({ ownerId: removed.id, name: 'Bob', personGroupId: removedGroup.id });
      const { clusterGroupId } = await ctx.database
        .selectFrom('user')
        .select('user.clusterGroupId')
        .where('user.id', '=', kept.id)
        .executeTakeFirstOrThrow();
      await ctx.database.deleteFrom('user').where('user.id', '=', removed.id).execute();

      await expect(sut.deleteOrphanedClusterGroups()).resolves.toBe(1);

      const clusterGroups = await ctx.database.selectFrom('cluster_group').select('cluster_group.id').execute();
      expect(clusterGroups.map(({ id }) => id)).toEqual([clusterGroupId]);

      const groups = await ctx.database.selectFrom('person_group').select('person_group.id').execute();
      expect(groups.map(({ id }) => id)).toEqual([keptPerson.personGroupId]);
    });
  });

  describe('getBirthdaysForDay', () => {
    it('should only return visible named people whose birthday matches the target month and day', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { person: matchingPerson } = await ctx.newPerson({
        ownerId: user.id,
        name: 'Alice',
        birthDate: new Date('1990-04-23T00:00:00Z'),
      });
      await ctx.newPerson({
        ownerId: user.id,
        name: 'Bob',
        birthDate: new Date('1990-04-24T00:00:00Z'),
      });
      await ctx.newPerson({
        ownerId: user.id,
        name: '',
        birthDate: new Date('1990-04-23T00:00:00Z'),
      });
      await ctx.newPerson({
        ownerId: user.id,
        name: 'Hidden Alice',
        isHidden: true,
        birthDate: new Date('1990-04-23T00:00:00Z'),
      });
      await ctx.newPerson({
        ownerId: user.id,
        name: 'Milo',
        type: 'pet',
        birthDate: new Date('1990-04-23T00:00:00Z'),
      });

      const result = await sut.getBirthdaysForDay(user.id, { month: 4, day: 23 });

      expect(result).toEqual([
        expect.objectContaining({
          id: matchingPerson.id,
          name: 'Alice',
          birthDate: new Date('1990-04-23T00:00:00Z'),
        }),
      ]);
    });
  });

  describe('getAllWithoutFaces', () => {
    it('should return persons with no asset_face rows, including named ones', async () => {
      // Regression: the previous query used LEFT JOIN + WHERE on the joined table,
      // which silently converts to INNER JOIN and hides persons with zero asset_face
      // rows entirely. Named zombies (e.g. after force-recognition reset unassigned
      // their faces) accumulated in production. This test pins the correct behavior.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      // Person A: has a visible face → should NOT be returned.
      const { asset: assetA } = await ctx.newAsset({ ownerId: user.id });
      const { person: personA } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      await ctx.newAssetFace({ assetId: assetA.id, personId: personA.id });

      // Person B: named, zero asset_face rows → SHOULD be returned.
      const { person: personB } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });

      // Person C: unnamed, zero asset_face rows → SHOULD be returned.
      const { person: personC } = await ctx.newPerson({ ownerId: user.id });

      const result = await sut.getAllWithoutFaces();
      const ids = result.map((p) => p.id);

      expect(ids).not.toContain(personA.id);
      expect(ids).toContain(personB.id);
      expect(ids).toContain(personC.id);
    });
  });

  describe('getDataForThumbnailGenerationJob', () => {
    it('should not return the edited preview path', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { person } = await ctx.newPerson({ ownerId: user.id });

      const { assetFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personGroupId: person.personGroupId,
        boundingBoxX1: 10,
        boundingBoxY1: 10,
        boundingBoxX2: 90,
        boundingBoxY2: 90,
      });

      // there's a circular dependency between assetFace and person, so we need to update the person after creating the assetFace
      await ctx.database
        .updateTable('person')
        .set({ faceAssetId: assetFace.id })
        .where('ownerId', '=', person.ownerId)
        .where('personGroupId', '=', person.personGroupId)
        .execute();

      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: 'preview_edited.jpg',
        isEdited: true,
      });
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: 'preview_unedited.jpg',
        isEdited: false,
      });

      const result = await sut.getDataForThumbnailGenerationJob({
        ownerId: person.ownerId,
        personGroupId: person.personGroupId,
      });

      expect(result).toEqual(
        expect.objectContaining({
          previewPath: 'preview_unedited.jpg',
        }),
      );
    });
  });

  describe('representative face picker queries', () => {
    it('filters deleted, hidden, and offline representative face candidates', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset: validAsset } = await ctx.newAsset({ ownerId: user.id });
      const { result: validFaceId } = await ctx.newAssetFace({ assetId: validAsset.id, personId: person.id });
      const { asset: offlineAsset } = await ctx.newAsset({ ownerId: user.id, isOffline: true });
      const { result: offlineFaceId } = await ctx.newAssetFace({ assetId: offlineAsset.id, personId: person.id });
      const { asset: deletedAsset } = await ctx.newAsset({ ownerId: user.id, deletedAt: new Date() });
      const { result: deletedAssetFaceId } = await ctx.newAssetFace({
        assetId: deletedAsset.id,
        personId: person.id,
      });
      const { result: hiddenFaceId } = await ctx.newAssetFace({
        assetId: validAsset.id,
        personId: person.id,
        isVisible: false,
      });
      const { result: deletedFaceId } = await ctx.newAssetFace({
        assetId: validAsset.id,
        personId: person.id,
        deletedAt: new Date(),
      });

      const faces = await sut.getRepresentativeFaces({ personId: person.id, take: 20, skip: 0 });

      expect(faces.map((face) => face.id)).toEqual([validFaceId]);
      await expect(
        sut.getRepresentativeFaceForUpdate({ personId: person.id, assetFaceId: offlineFaceId }),
      ).resolves.toBeUndefined();
      await expect(
        sut.getRepresentativeFaceForUpdate({ personId: person.id, assetFaceId: deletedAssetFaceId }),
      ).resolves.toBeUndefined();
      await expect(
        sut.getRepresentativeFaceForUpdate({ personId: person.id, assetFaceId: hiddenFaceId }),
      ).resolves.toBeUndefined();
      await expect(
        sut.getRepresentativeFaceForUpdate({ personId: person.id, assetFaceId: deletedFaceId }),
      ).resolves.toBeUndefined();
    });

    it('rejects a face linked to a different identity', async () => {
      const { ctx, sut } = setup();
      const faceIdentityRepository = ctx.get(FaceIdentityRepository);
      const { user } = await ctx.newUser();
      const { person: targetPerson } = await ctx.newPerson({ ownerId: user.id });
      const { person: otherPerson } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { result: faceId } = await ctx.newAssetFace({ assetId: asset.id, personId: targetPerson.id });
      const otherIdentity = await faceIdentityRepository.ensurePersonIdentity(otherPerson.id);
      await faceIdentityRepository.replaceFaceIdentity({
        assetFaceId: faceId,
        identityId: otherIdentity.id,
        source: 'manual',
      });

      const faces = await sut.getRepresentativeFaces({ personId: targetPerson.id, take: 20, skip: 0 });

      expect(faces.map((face) => face.id)).not.toContain(faceId);
      await expect(
        sut.getRepresentativeFaceForUpdate({ personId: targetPerson.id, assetFaceId: faceId }),
      ).resolves.toBeUndefined();
    });
  });
});
