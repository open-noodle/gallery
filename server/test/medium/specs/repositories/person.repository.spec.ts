import { Kysely, sql } from 'kysely';
import { AssetFileType, AssetVisibility, SharedSpaceRole, SourceType } from 'src/enum';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { newEmbedding } from 'test/small.factory';
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

// Slice 5 (F9) helpers, shared across the getAllFaces describe block below.
const collectFaceIds = async (stream: AsyncIterable<{ id: string }>) => {
  const ids: string[] = [];
  for await (const face of stream) {
    ids.push(face.id);
  }
  return ids;
};

const linkManually = async (ctx: ReturnType<typeof setup>['ctx'], input: { ownerId: string; assetFaceId: string }) => {
  const faceIdentityRepository = ctx.get(FaceIdentityRepository);
  const { person } = await ctx.newPerson({ ownerId: input.ownerId });
  const identity = await faceIdentityRepository.ensurePersonIdentity(person.id);
  await faceIdentityRepository.replaceFaceIdentity({
    assetFaceId: input.assetFaceId,
    identityId: identity.id,
    source: 'manual',
  });
  return { person, identity };
};

// Slice 9 (F17) helper, shared across the getScannablePeopleWithUnassignedFaces describe block
// below: being scannable requires the person to have their own reference face (an assigned, live,
// visible face with an embedding — mirrors getAssignedFaceEmbeddings) in addition to the owner
// having a reviewable unassigned ML candidate somewhere. This gives a person that reference face.
const giveOwnFace = async (ctx: ReturnType<typeof setup>['ctx'], assetId: string, personId: string) => {
  const { result: faceId } = await ctx.newAssetFace({ assetId, personId });
  await ctx.database.insertInto('face_search').values({ faceId, embedding: newEmbedding() }).execute();
  return faceId;
};

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

  describe('getByName', () => {
    it('matches names case-insensitively', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'bob' });

      const result = await sut.getByName(user.id, 'Bob', { withHidden: false });

      expect(result.map((person) => person.id)).toContain(person.id);
    });
  });

  describe('getPeopleOverviewStatistics', () => {
    it('counts visible and hidden personal people and all detected timeline faces in owned assets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { asset: otherAsset } = await ctx.newAsset({ ownerId: otherUser.id, visibility: AssetVisibility.Timeline });
      const { person: visiblePerson } = await ctx.newPerson({ ownerId: user.id, isHidden: false });
      const { person: hiddenPerson } = await ctx.newPerson({ ownerId: user.id, isHidden: true });
      const { person: otherPerson } = await ctx.newPerson({ ownerId: otherUser.id });

      await ctx.newAssetFace({ assetId: asset.id, personId: visiblePerson.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: hiddenPerson.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: null });
      await ctx.newAssetFace({ assetId: otherAsset.id, personId: otherPerson.id });

      await expect(sut.getPeopleOverviewStatistics(user.id)).resolves.toEqual({
        total: 2,
        hidden: 1,
        detectedFaceCount: 3,
      });
    });

    it('returns zero visible people when all personal people are hidden', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { person } = await ctx.newPerson({ ownerId: user.id, isHidden: true });

      await ctx.newAssetFace({ assetId: asset.id, personId: person.id });

      const result = await sut.getPeopleOverviewStatistics(user.id);

      expect(result).toEqual({ total: 1, hidden: 1, detectedFaceCount: 1 });
      expect(result.total - result.hidden).toBe(0);
    });

    it('includes archived assets but excludes other out-of-scope assets and non-visible or deleted faces from detectedFaceCount', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: validAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { person } = await ctx.newPerson({ ownerId: user.id, isHidden: false });

      await ctx.newAssetFace({ assetId: validAsset.id, personId: person.id });

      const { asset: deletedAsset } = await ctx.newAsset({
        ownerId: user.id,
        visibility: AssetVisibility.Timeline,
        deletedAt: new Date(),
      });
      const { asset: offlineAsset } = await ctx.newAsset({
        ownerId: user.id,
        visibility: AssetVisibility.Timeline,
        isOffline: true,
      });
      const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      const { asset: archiveAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });

      await ctx.newAssetFace({ assetId: deletedAsset.id, personId: person.id });
      await ctx.newAssetFace({ assetId: offlineAsset.id, personId: person.id });
      await ctx.newAssetFace({ assetId: lockedAsset.id, personId: person.id });
      await ctx.newAssetFace({ assetId: archiveAsset.id, personId: person.id });
      await ctx.newAssetFace({ assetId: validAsset.id, personId: person.id, isVisible: false });
      await ctx.newAssetFace({ assetId: validAsset.id, personId: person.id, deletedAt: new Date() });

      await expect(sut.getPeopleOverviewStatistics(user.id)).resolves.toEqual({
        total: 1,
        hidden: 0,
        detectedFaceCount: 2,
      });
    });

    it('excludes people whose only faces are on offline or non-owned assets from personal totals', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();
      const { asset: validAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { asset: offlineAsset } = await ctx.newAsset({
        ownerId: user.id,
        visibility: AssetVisibility.Timeline,
        isOffline: true,
      });
      const { asset: otherOwnerAsset } = await ctx.newAsset({
        ownerId: otherUser.id,
        visibility: AssetVisibility.Timeline,
      });
      const { person: validPerson } = await ctx.newPerson({ ownerId: user.id });
      const { person: offlineOnlyPerson } = await ctx.newPerson({ ownerId: user.id, isHidden: true });
      const { person: otherOwnerAssetOnlyPerson } = await ctx.newPerson({ ownerId: user.id });

      await ctx.newAssetFace({ assetId: validAsset.id, personId: validPerson.id });
      await ctx.newAssetFace({ assetId: offlineAsset.id, personId: offlineOnlyPerson.id });
      await ctx.newAssetFace({ assetId: otherOwnerAsset.id, personId: otherOwnerAssetOnlyPerson.id });

      await expect(sut.getPeopleOverviewStatistics(user.id)).resolves.toEqual({
        total: 1,
        hidden: 0,
        detectedFaceCount: 1,
      });
    });

    it('returns zeroes for an empty personal library', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      await expect(sut.getPeopleOverviewStatistics(user.id)).resolves.toEqual({
        total: 0,
        hidden: 0,
        detectedFaceCount: 0,
      });
    });

    it('counts only people eligible for the personal people list when minimumFaceCount is set', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { person: belowThreshold } = await ctx.newPerson({ ownerId: user.id, name: '' });
      const { person: eligibleUnnamed } = await ctx.newPerson({ ownerId: user.id, name: '' });
      const { person: eligibleNamedHidden } = await ctx.newPerson({ ownerId: user.id, name: 'Hidden', isHidden: true });

      await ctx.newAssetFace({ assetId: asset.id, personId: belowThreshold.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: belowThreshold.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: eligibleUnnamed.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: eligibleUnnamed.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: eligibleUnnamed.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: eligibleNamedHidden.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: null });

      await expect(sut.getNumberOfPeople(user.id, { minimumFaceCount: 3 })).resolves.toEqual({
        total: 2,
        hidden: 1,
      });
      await expect(sut.getPeopleOverviewStatistics(user.id, { minimumFaceCount: 3 })).resolves.toEqual({
        total: 2,
        hidden: 1,
        detectedFaceCount: 7,
      });
    });
  });

  describe('getPeopleFaceStatistics', () => {
    it('splits owned timeline faces into visible, hidden, and unassigned buckets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { person: visiblePerson } = await ctx.newPerson({ ownerId: user.id, isHidden: false });
      const { person: hiddenPerson } = await ctx.newPerson({ ownerId: user.id, isHidden: true });

      await ctx.newAssetFace({ assetId: asset.id, personId: visiblePerson.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: visiblePerson.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: hiddenPerson.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: null });
      await ctx.newAssetFace({ assetId: asset.id, personId: null });

      const details = await sut.getPeopleFaceStatistics(user.id);
      const overview = await sut.getPeopleOverviewStatistics(user.id);

      expect(details).toEqual({
        detectedFaceCount: 5,
        assignedVisibleFaceCount: 2,
        namedVisiblePersonCount: 1,
        assignedHiddenFaceCount: 1,
        unassignedFaceCount: 2,
      });
      expect(details.detectedFaceCount).toBe(overview.detectedFaceCount);
      expect(details.detectedFaceCount).toBe(
        details.assignedVisibleFaceCount + details.assignedHiddenFaceCount + details.unassignedFaceCount,
      );
    });

    it('returns all personal faces as unassigned when no eligible people are assigned and is deterministic', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });

      await ctx.newAssetFace({ assetId: asset.id, personId: null });
      await ctx.newAssetFace({ assetId: asset.id, personId: null });

      await expect(sut.getPeopleOverviewStatistics(user.id)).resolves.toEqual({
        total: 0,
        hidden: 0,
        detectedFaceCount: 2,
      });

      const first = await sut.getPeopleFaceStatistics(user.id);
      const second = await sut.getPeopleFaceStatistics(user.id);

      expect(first).toEqual({
        detectedFaceCount: 2,
        assignedVisibleFaceCount: 0,
        namedVisiblePersonCount: 0,
        assignedHiddenFaceCount: 0,
        unassignedFaceCount: 2,
      });
      expect(second).toEqual(first);
    });

    it('returns zeroes for an empty personal library', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      await expect(sut.getPeopleFaceStatistics(user.id)).resolves.toEqual({
        detectedFaceCount: 0,
        assignedVisibleFaceCount: 0,
        namedVisiblePersonCount: 0,
        assignedHiddenFaceCount: 0,
        unassignedFaceCount: 0,
      });
    });

    it('includes archived assets but excludes deleted assets, offline assets, locked assets, non-visible faces, and deleted faces', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, isHidden: false });
      const { asset: validAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { asset: deletedAsset } = await ctx.newAsset({
        ownerId: user.id,
        visibility: AssetVisibility.Timeline,
        deletedAt: new Date(),
      });
      const { asset: offlineAsset } = await ctx.newAsset({
        ownerId: user.id,
        visibility: AssetVisibility.Timeline,
        isOffline: true,
      });
      const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      const { asset: archivedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });

      await ctx.newAssetFace({ assetId: validAsset.id, personId: person.id });
      await ctx.newAssetFace({ assetId: deletedAsset.id, personId: person.id });
      await ctx.newAssetFace({ assetId: offlineAsset.id, personId: person.id });
      await ctx.newAssetFace({ assetId: lockedAsset.id, personId: person.id });
      await ctx.newAssetFace({ assetId: archivedAsset.id, personId: person.id });
      await ctx.newAssetFace({ assetId: validAsset.id, personId: person.id, isVisible: false });
      await ctx.newAssetFace({ assetId: validAsset.id, personId: person.id, deletedAt: new Date() });

      await expect(sut.getPeopleFaceStatistics(user.id)).resolves.toEqual({
        detectedFaceCount: 2,
        assignedVisibleFaceCount: 2,
        namedVisiblePersonCount: 1,
        assignedHiddenFaceCount: 0,
        unassignedFaceCount: 0,
      });
    });

    it("treats a face assigned to another user's person on the current user's owned asset as unassigned", async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { person: otherPerson } = await ctx.newPerson({ ownerId: otherUser.id, isHidden: false });

      await ctx.newAssetFace({ assetId: asset.id, personId: otherPerson.id });

      await expect(sut.getPeopleFaceStatistics(user.id)).resolves.toEqual({
        detectedFaceCount: 1,
        assignedVisibleFaceCount: 0,
        namedVisiblePersonCount: 0,
        assignedHiddenFaceCount: 0,
        unassignedFaceCount: 1,
      });
    });

    it('counts distinct named visible people with eligible visible faces', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { asset: archivedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
      const { asset: otherAsset } = await ctx.newAsset({ ownerId: otherUser.id, visibility: AssetVisibility.Timeline });
      const { person: namedVisible } = await ctx.newPerson({ ownerId: user.id, name: 'Alice', isHidden: false });
      const { person: duplicateNamedVisible } = await ctx.newPerson({
        ownerId: user.id,
        name: 'Alice Duplicate',
        isHidden: false,
      });
      const { person: hiddenNamed } = await ctx.newPerson({ ownerId: user.id, name: 'Hidden', isHidden: true });
      const { person: unnamedVisible } = await ctx.newPerson({ ownerId: user.id, name: '', isHidden: false });
      const { person: whitespaceVisible } = await ctx.newPerson({
        ownerId: user.id,
        name: ' '.repeat(3),
        isHidden: false,
      });
      const { person: outOfScopeNamed } = await ctx.newPerson({ ownerId: user.id, name: 'Archived', isHidden: false });
      const { person: otherNamed } = await ctx.newPerson({ ownerId: otherUser.id, name: 'Other', isHidden: false });

      await ctx.newAssetFace({ assetId: asset.id, personId: namedVisible.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: namedVisible.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: duplicateNamedVisible.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: hiddenNamed.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: unnamedVisible.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: whitespaceVisible.id });
      await ctx.newAssetFace({ assetId: archivedAsset.id, personId: outOfScopeNamed.id });
      await ctx.newAssetFace({ assetId: otherAsset.id, personId: otherNamed.id });

      await expect(sut.getPeopleFaceStatistics(user.id)).resolves.toMatchObject({
        namedVisiblePersonCount: 3,
      });
    });

    it('counts a current-user unnamed person below the minimum face threshold as unassigned', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { person } = await ctx.newPerson({ ownerId: user.id, name: '', isHidden: false });

      await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: person.id });

      await expect(sut.getPeopleFaceStatistics(user.id, { minimumFaceCount: 3 })).resolves.toEqual({
        detectedFaceCount: 2,
        assignedVisibleFaceCount: 0,
        namedVisiblePersonCount: 0,
        assignedHiddenFaceCount: 0,
        unassignedFaceCount: 2,
      });
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

  describe('getStatistics', () => {
    it('counts distinct visible timeline assets and visible faces for a personal person', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { assetFace: firstFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: person.id, isVisible: false });

      await expect(sut.getStatistics(person.id)).resolves.toEqual({ assets: 1, faces: 2 });
      expect(firstFace.personId).toBe(person.id);
    });

    it('returns zero asset and face counts for a personal person with no accessible faces', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Empty' });

      await expect(sut.getStatistics(person.id)).resolves.toEqual({ assets: 0, faces: 0 });
    });

    // L3: memberUserId scopes the count to what a space-only reader can actually reach, instead of
    // the owner's entire Timeline-visible library for that person.
    it('scopes the count to space-reachable assets when memberUserId is provided (L3)', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: reader } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: owner.id, name: 'Shared' });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: reader.id, role: SharedSpaceRole.Viewer });

      // Asset shared into the space — reachable by `reader`, should count.
      const { asset: sharedAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      await ctx.newAssetFace({ assetId: sharedAsset.id, personId: person.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: sharedAsset.id });

      // Asset NOT shared into any space `reader` belongs to — unreachable, must not count.
      const { asset: privateAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      await ctx.newAssetFace({ assetId: privateAsset.id, personId: person.id });

      // Unscoped (owner) count sees both assets.
      await expect(sut.getStatistics(person.id)).resolves.toEqual({ assets: 2, faces: 2 });

      // memberUserId-scoped count only sees the space-reachable asset.
      await expect(sut.getStatistics(person.id, { memberUserId: reader.id })).resolves.toEqual({
        assets: 1,
        faces: 1,
      });
    });
  });

  describe('getAssignedFaceEmbeddings', () => {
    let personId: string;
    let personWithNoFacesId: string;
    let ctx: ReturnType<typeof setup>['ctx'];
    let sut: ReturnType<typeof setup>['sut'];

    beforeAll(async () => {
      ({ ctx, sut } = setup());
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      // Person A: 3 visible+embedded faces, 1 isVisible=false face, 1 deletedAt face
      const { person: personA } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      personId = personA.id;

      // 3 visible faces with embeddings
      for (let i = 0; i < 3; i++) {
        const { result: faceId } = await ctx.newAssetFace({ assetId: asset.id, personId: personA.id });
        await ctx.database.insertInto('face_search').values({ faceId, embedding: newEmbedding() }).execute();
      }

      // 1 isVisible=false face with embedding (should be excluded)
      const { result: hiddenFaceId } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: personA.id,
        isVisible: false,
      });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: hiddenFaceId, embedding: newEmbedding() })
        .execute();

      // 1 soft-deleted face with embedding (should be excluded)
      const { result: deletedFaceId } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: personA.id,
        deletedAt: new Date(),
      });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: deletedFaceId, embedding: newEmbedding() })
        .execute();

      // Person B: zero faces
      const { person: personB } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
      personWithNoFacesId = personB.id;
    });

    it('returns at most `limit` embeddings for visible, non-deleted faces', async () => {
      const rows = await sut.getAssignedFaceEmbeddings(personId, 2);
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect(r.embedding).toBeTruthy();
      }
    });

    it('samples assigned face embeddings in deterministic face id order', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Carol' });
      const faces: Array<{ id: string; embedding: string }> = [];

      for (let i = 0; i < 4; i++) {
        const { result: faceId } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
        const embedding = newEmbedding();
        faces.push({ id: faceId, embedding });
        await ctx.database.insertInto('face_search').values({ faceId, embedding }).execute();
      }

      const rows = await sut.getAssignedFaceEmbeddings(person.id, 2);
      const expected = await ctx.database
        .selectFrom('face_search')
        .select('embedding')
        .where(
          'faceId',
          'in',
          faces
            .toSorted((a, b) => a.id.localeCompare(b.id))
            .slice(0, 2)
            .map((face) => face.id),
        )
        .orderBy('faceId', 'asc')
        .execute();

      expect(rows.map((row) => row.embedding)).toEqual(expected.map((row) => row.embedding));
    });

    it('excludes isVisible=false and deleted faces', async () => {
      const rows = await sut.getAssignedFaceEmbeddings(personId, 10);
      // Person A has 3 visible non-deleted faces; isVisible=false and deletedAt faces are excluded
      expect(rows).toHaveLength(3);
    });

    it('returns empty for a person with no assigned faces', async () => {
      const rows = await sut.getAssignedFaceEmbeddings(personWithNoFacesId, 20);
      expect(rows).toEqual([]);
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

    // M1: a non-owner (space-granted) caller must only see faces on assets reachable through a space
    // they belong to AND that pass the shareable-visibility gate — never the owner's Hidden/never-shared
    // faces. The owner (no scope) keeps the full, unscoped list.
    it('scopes non-owner callers to space-reachable, shareable-visibility faces only', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: owner.id });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });

      // A1: Timeline, added to the space the viewer belongs to -> space-reachable + shareable.
      const { asset: spaceAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: spaceAsset.id, addedById: owner.id });
      const { result: spaceFaceId } = await ctx.newAssetFace({ assetId: spaceAsset.id, personId: person.id });

      // A2: added to the SAME space (so it is space-reachable) but Hidden -> fails spaceVisibilityGate.
      const { asset: hiddenAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: hiddenAsset.id, addedById: owner.id });
      const { result: hiddenFaceId } = await ctx.newAssetFace({ assetId: hiddenAsset.id, personId: person.id });

      // A3: Timeline (shareable visibility) but never added to any space -> not space-reachable.
      const { asset: neverSharedAsset } = await ctx.newAsset({
        ownerId: owner.id,
        visibility: AssetVisibility.Timeline,
      });
      const { result: neverSharedFaceId } = await ctx.newAssetFace({
        assetId: neverSharedAsset.id,
        personId: person.id,
      });

      const scopedFaces = await sut.getRepresentativeFaces({
        personId: person.id,
        take: 50,
        skip: 0,
        scope: { memberUserId: viewer.id },
      });
      expect(scopedFaces.map((face) => face.id)).toEqual([spaceFaceId]);
      expect(scopedFaces.map((face) => face.id)).not.toContain(hiddenFaceId);
      expect(scopedFaces.map((face) => face.id)).not.toContain(neverSharedFaceId);

      // Regression: the unscoped (owner) path is unchanged and still returns all three.
      const ownerFaces = await sut.getRepresentativeFaces({ personId: person.id, take: 50, skip: 0 });
      expect(new Set(ownerFaces.map((face) => face.id))).toEqual(
        new Set([spaceFaceId, hiddenFaceId, neverSharedFaceId]),
      );
    });

    it('excludes cross-user identity-fan-out faces from a scoped (non-owner) caller', async () => {
      const { ctx, sut } = setup();
      const faceIdentityRepository = ctx.get(FaceIdentityRepository);
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: owner.id });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });

      // Give `person` a shared identity, with its own (space-reachable) face.
      const identity = await faceIdentityRepository.ensurePersonIdentity(person.id);
      const { asset: ownAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: ownAsset.id, addedById: owner.id });
      const { assetFace: ownFace } = await ctx.newAssetFace({ assetId: ownAsset.id, personId: person.id });
      await faceIdentityRepository.linkFace({ assetFaceId: ownFace.id, identityId: identity.id, source: 'manual' });

      // A DIFFERENT user's own person shares the same identity (e.g. a merged identity), with a face on
      // that other user's own asset -- never shared into any space the viewer belongs to.
      const { person: otherPerson } = await ctx.newPerson({ ownerId: otherUser.id });
      await ctx.database
        .updateTable('person')
        .set({ identityId: identity.id })
        .where('id', '=', otherPerson.id)
        .execute();
      const { asset: otherAsset } = await ctx.newAsset({ ownerId: otherUser.id, visibility: AssetVisibility.Timeline });
      const { assetFace: otherFace } = await ctx.newAssetFace({ assetId: otherAsset.id, personId: otherPerson.id });
      await faceIdentityRepository.linkFace({ assetFaceId: otherFace.id, identityId: identity.id, source: 'manual' });

      // Owner (unscoped) sees both -- the identity fan-out is intentional for the owner's own picker.
      const ownerFaces = await sut.getRepresentativeFaces({ personId: person.id, take: 50, skip: 0 });
      expect(new Set(ownerFaces.map((face) => face.id))).toEqual(new Set([ownFace.id, otherFace.id]));

      // The space viewer must NOT see the other user's face pulled in via the shared identity.
      const scopedFaces = await sut.getRepresentativeFaces({
        personId: person.id,
        take: 50,
        skip: 0,
        scope: { memberUserId: viewer.id },
      });
      expect(scopedFaces.map((face) => face.id)).toEqual([ownFace.id]);
      expect(scopedFaces.map((face) => face.id)).not.toContain(otherFace.id);
    });
  });

  describe('refreshFaces', () => {
    it('deletes only requested ML faces, cascades only those identity links, and preserves manual and EXIF evidence', async () => {
      const { ctx, sut } = setup();
      const faceIdentityRepository = ctx.get(FaceIdentityRepository);
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { person: mlPerson } = await ctx.newPerson({ ownerId: user.id, name: 'ML' });
      const { person: retainedMlPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Retained ML' });
      const { person: manualPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Manual' });
      const { person: exifPerson } = await ctx.newPerson({ ownerId: user.id, name: 'EXIF' });
      const { result: mlFaceId } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: mlPerson.id,
        sourceType: SourceType.MachineLearning,
      });
      const { result: retainedMlFaceId } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: retainedMlPerson.id,
        sourceType: SourceType.MachineLearning,
      });
      const { result: manualFaceId } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: manualPerson.id,
        sourceType: SourceType.Manual,
      });
      const { result: exifFaceId } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: exifPerson.id,
        sourceType: SourceType.Exif,
      });
      const mlIdentity = await faceIdentityRepository.ensurePersonIdentity(mlPerson.id);
      const retainedMlIdentity = await faceIdentityRepository.ensurePersonIdentity(retainedMlPerson.id);
      const manualIdentity = await faceIdentityRepository.ensurePersonIdentity(manualPerson.id);
      const exifIdentity = await faceIdentityRepository.ensurePersonIdentity(exifPerson.id);
      await faceIdentityRepository.replaceFaceIdentity({
        assetFaceId: mlFaceId,
        identityId: mlIdentity.id,
        source: 'ml',
      });
      await faceIdentityRepository.replaceFaceIdentity({
        assetFaceId: retainedMlFaceId,
        identityId: retainedMlIdentity.id,
        source: 'ml',
      });
      await faceIdentityRepository.replaceFaceIdentity({
        assetFaceId: manualFaceId,
        identityId: manualIdentity.id,
        source: 'manual',
      });
      await faceIdentityRepository.replaceFaceIdentity({
        assetFaceId: exifFaceId,
        identityId: exifIdentity.id,
        source: 'import',
      });
      const newFaceId = '11111111-1111-4111-8111-111111111111';
      const embedding = newEmbedding();

      await sut.refreshFaces(
        [
          {
            id: newFaceId,
            assetId: asset.id,
            imageWidth: 200,
            imageHeight: 200,
            boundingBoxX1: 10,
            boundingBoxY1: 10,
            boundingBoxX2: 60,
            boundingBoxY2: 60,
          },
        ],
        [mlFaceId],
        [{ faceId: newFaceId, embedding }],
      );

      const faceRows = await ctx.database
        .selectFrom('asset_face')
        .select(['id', 'sourceType'])
        .where('assetId', '=', asset.id)
        .execute();
      expect(faceRows).toEqual(
        expect.arrayContaining([
          { id: retainedMlFaceId, sourceType: SourceType.MachineLearning },
          { id: manualFaceId, sourceType: SourceType.Manual },
          { id: exifFaceId, sourceType: SourceType.Exif },
          { id: newFaceId, sourceType: SourceType.MachineLearning },
        ]),
      );
      expect(faceRows).toHaveLength(4);
      expect(faceRows.map((face) => face.id)).not.toContain(mlFaceId);

      const links = await ctx.database
        .selectFrom('face_identity_face')
        .select(['assetFaceId', 'identityId', 'source'])
        .where('assetFaceId', 'in', [mlFaceId, retainedMlFaceId, manualFaceId, exifFaceId])
        .execute();
      expect(links).toEqual(
        expect.arrayContaining([
          { assetFaceId: retainedMlFaceId, identityId: retainedMlIdentity.id, source: 'ml' },
          { assetFaceId: manualFaceId, identityId: manualIdentity.id, source: 'manual' },
          { assetFaceId: exifFaceId, identityId: exifIdentity.id, source: 'import' },
        ]),
      );
      expect(links).toHaveLength(3);
      expect(links.map((link) => link.assetFaceId)).not.toContain(mlFaceId);

      await expect(
        ctx.database
          .selectFrom('face_search')
          .select(['faceId', sql<number>`vector_dims(embedding)`.as('dimensions')])
          .where('faceId', '=', newFaceId)
          .executeTakeFirst(),
      ).resolves.toEqual({ faceId: newFaceId, dimensions: 512 });
      const embeddingDistance = await ctx.database
        .selectFrom('face_search')
        .select(sql<number>`face_search.embedding <-> ${embedding}`.as('distance'))
        .where('faceId', '=', newFaceId)
        .executeTakeFirstOrThrow();
      expect(embeddingDistance.distance).toBeCloseTo(0);
    });

    it('does not mutate face rows when refreshFaces receives no inserts, removals, or embeddings', async () => {
      const { ctx, sut } = setup();
      const faceIdentityRepository = ctx.get(FaceIdentityRepository);
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { result: manualFaceId } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: person.id,
        sourceType: SourceType.Manual,
      });
      const identity = await faceIdentityRepository.ensurePersonIdentity(person.id);
      await faceIdentityRepository.replaceFaceIdentity({
        assetFaceId: manualFaceId,
        identityId: identity.id,
        source: 'manual',
      });

      const before = {
        faces: await ctx.database
          .selectFrom('asset_face')
          .select(['id', 'sourceType'])
          .where('assetId', '=', asset.id)
          .execute(),
        links: await ctx.database
          .selectFrom('face_identity_face')
          .select(['assetFaceId', 'identityId', 'source'])
          .where('assetFaceId', '=', manualFaceId)
          .execute(),
        embeddings: await ctx.database.selectFrom('face_search').select(['faceId']).execute(),
      };

      await sut.refreshFaces([], [], []);

      await expect(
        ctx.database.selectFrom('asset_face').select(['id', 'sourceType']).where('assetId', '=', asset.id).execute(),
      ).resolves.toEqual(before.faces);
      await expect(
        ctx.database
          .selectFrom('face_identity_face')
          .select(['assetFaceId', 'identityId', 'source'])
          .where('assetFaceId', '=', manualFaceId)
          .execute(),
      ).resolves.toEqual(before.links);
      await expect(ctx.database.selectFrom('face_search').select(['faceId']).execute()).resolves.toEqual(
        before.embeddings,
      );
    });
  });

  describe('deleteAllPets', () => {
    it('deletes pet people and their faces while preserving human people and faces', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      // Pet detection result: a 'pet'-typed person with a detected face.
      const { person: pet } = await ctx.newPerson({ ownerId: user.id, name: 'dog', type: 'pet', species: 'dog' });
      await ctx.newAssetFace({ assetId: asset.id, personId: pet.id });

      // Human face/person from facial recognition — must survive a pet reset.
      const { person: human } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      const { result: humanFaceId } = await ctx.newAssetFace({ assetId: asset.id, personId: human.id });

      await sut.deleteAllPets();

      const people = await ctx.database
        .selectFrom('person')
        .select(['id', 'type'])
        .where('ownerId', '=', user.id)
        .execute();
      const faces = await ctx.database
        .selectFrom('asset_face')
        .select(['id', 'personId'])
        .where('assetId', '=', asset.id)
        .execute();

      expect(people).toEqual([expect.objectContaining({ id: human.id })]);
      expect(faces).toEqual([expect.objectContaining({ id: humanFaceId, personId: human.id })]);
    });
  });

  describe('getScannablePeopleWithUnassignedFaces', () => {
    it('streams only named, non-hidden, type=person people with their own reference face whose owner has an unassigned ML face', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();

      const { person: named } = await ctx.newPerson({ ownerId: user.id, name: 'Alice', isHidden: false });
      const { person: unnamed } = await ctx.newPerson({ ownerId: user.id, name: '', isHidden: false });
      const { person: hidden } = await ctx.newPerson({ ownerId: user.id, name: 'Hidden', isHidden: true });
      const { person: pet } = await ctx.newPerson({ ownerId: user.id, name: 'Rex', isHidden: false, type: 'pet' });
      const { person: otherOwner } = await ctx.newPerson({ ownerId: otherUser.id, name: 'Bob', isHidden: false });

      // user owns an unassigned ML face, and `named` has their own reference face → `named` is eligible
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await giveOwnFace(ctx, asset.id, named.id);
      await ctx.newAssetFace({ assetId: asset.id, personId: null });
      // otherUser has NO unassigned face → `otherOwner` excluded
      const { asset: a2 } = await ctx.newAsset({ ownerId: otherUser.id });
      await ctx.newAssetFace({ assetId: a2.id, personId: otherOwner.id });

      const ids: string[] = [];
      for await (const p of sut.getScannablePeopleWithUnassignedFaces()) {
        ids.push(p.id);
      }

      expect(ids).toContain(named.id);
      expect(ids).not.toContain(unnamed.id);
      expect(ids).not.toContain(hidden.id);
      expect(ids).not.toContain(pet.id);
      expect(ids).not.toContain(otherOwner.id);
    });

    it('excludes a named person whose owner has only assigned/deleted/invisible faces', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Carol', isHidden: false });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await giveOwnFace(ctx, asset.id, person.id); // Carol has her own reference face (also the "assigned" face)
      await ctx.newAssetFace({ assetId: asset.id, personId: null, deletedAt: new Date() }); // deleted
      await ctx.newAssetFace({ assetId: asset.id, personId: null, isVisible: false }); // invisible

      const ids: string[] = [];
      for await (const p of sut.getScannablePeopleWithUnassignedFaces()) {
        ids.push(p.id);
      }
      expect(ids).not.toContain(person.id);
    });

    it('excludes a named person whose owner has only non-ML (manual) unassigned faces', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Dave', isHidden: false });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await giveOwnFace(ctx, asset.id, person.id);
      // Create an unassigned face with non-ML sourceType
      await ctx.newAssetFace({ assetId: asset.id, personId: null, sourceType: SourceType.Manual });

      const ids: string[] = [];
      for await (const p of sut.getScannablePeopleWithUnassignedFaces()) {
        ids.push(p.id);
      }
      expect(ids).not.toContain(person.id);
    });

    // S9.1 (BDD) / S9.2 (red proof folded in once green — see slice 9 plan). Before this slice's
    // fix, the EXISTS correlated only on `asset.ownerId = person.ownerId`, so all three named
    // people below streamed (proved by temporarily reverting the person-reference-face EXISTS and
    // re-running this test: it failed with `ids` containing all three ids, not just alice's).
    it('S9.1: given an owner with three named people, only the one with their own reference face is scannable', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice', isHidden: false });
      const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob', isHidden: false });
      const { person: carol } = await ctx.newPerson({ ownerId: user.id, name: 'Carol', isHidden: false });

      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await giveOwnFace(ctx, asset.id, alice.id); // only Alice has a reference face of her own
      await ctx.newAssetFace({ assetId: asset.id, personId: null }); // owner has an unassigned ML candidate

      // This suite's medium DB is not truncated between tests, so scope the equality check to just
      // this test's three people rather than asserting on the raw (file-wide) stream contents.
      const relevantIds = new Set([alice.id, bob.id, carol.id]);
      const ids: string[] = [];
      for await (const p of sut.getScannablePeopleWithUnassignedFaces()) {
        if (relevantIds.has(p.id)) {
          ids.push(p.id);
        }
      }

      expect(ids).toEqual([alice.id]);
      expect(ids).not.toContain(bob.id);
      expect(ids).not.toContain(carol.id);
    });

    it('S9.3: a person whose only unassigned candidate is on a Locked asset is not yielded (Slice 1 composition)', async () => {
      const { ctx, sut } = setup();
      // Owner-scoped gate 2 (an unassigned reviewable ML candidate exists somewhere in the owner's
      // library) is not itself person-specific — so the positive control needs its OWN owner, or its
      // genuine candidate would leak into `locked`'s gate 2 and defeat this test.
      const { user: lockedOwner } = await ctx.newUser();
      const { user: reviewableOwner } = await ctx.newUser();

      const { person: locked } = await ctx.newPerson({ ownerId: lockedOwner.id, name: 'Locked Only', isHidden: false });
      const { asset: lockedAsset } = await ctx.newAsset({
        ownerId: lockedOwner.id,
        visibility: AssetVisibility.Locked,
      });
      await giveOwnFace(ctx, lockedAsset.id, locked.id);
      await ctx.newAssetFace({ assetId: lockedAsset.id, personId: null }); // only candidate is on a Locked asset

      // positive control: a person of a DIFFERENT owner with a reviewable (default timeline) candidate is yielded
      const { person: reviewable } = await ctx.newPerson({
        ownerId: reviewableOwner.id,
        name: 'Reviewable',
        isHidden: false,
      });
      const { asset: timelineAsset } = await ctx.newAsset({ ownerId: reviewableOwner.id });
      await giveOwnFace(ctx, timelineAsset.id, reviewable.id);
      await ctx.newAssetFace({ assetId: timelineAsset.id, personId: null });

      const ids: string[] = [];
      for await (const p of sut.getScannablePeopleWithUnassignedFaces()) {
        ids.push(p.id);
      }

      expect(ids).not.toContain(locked.id);
      expect(ids).toContain(reviewable.id);
    });

    it.each([
      ['soft-deleted', { deletedAt: new Date() }],
      ['invisible', { isVisible: false }],
      ['non-ML', { sourceType: SourceType.Manual }],
    ] as const)('S9.4: a person whose only unassigned candidate is %s is not yielded', async (_label, overrides) => {
      const { ctx, sut } = setup();
      // Same reasoning as S9.3: the control needs its own owner so its genuine candidate cannot
      // leak into the excluded person's (owner-scoped) gate 2.
      const { user: excludedOwner } = await ctx.newUser();
      const { user: controlOwner } = await ctx.newUser();

      const { person: excluded } = await ctx.newPerson({
        ownerId: excludedOwner.id,
        name: 'Excluded',
        isHidden: false,
      });
      const { asset } = await ctx.newAsset({ ownerId: excludedOwner.id });
      await giveOwnFace(ctx, asset.id, excluded.id);
      await ctx.newAssetFace({ assetId: asset.id, personId: null, ...overrides });

      // positive control: a person of a DIFFERENT owner with a live, visible, ML unassigned candidate is yielded
      const { person: control } = await ctx.newPerson({ ownerId: controlOwner.id, name: 'Control', isHidden: false });
      const { asset: controlAsset } = await ctx.newAsset({ ownerId: controlOwner.id });
      await giveOwnFace(ctx, controlAsset.id, control.id);
      await ctx.newAssetFace({ assetId: controlAsset.id, personId: null });

      const ids: string[] = [];
      for await (const p of sut.getScannablePeopleWithUnassignedFaces()) {
        ids.push(p.id);
      }

      expect(ids).not.toContain(excluded.id);
      expect(ids).toContain(control.id);
    });

    it('S9.5 (pin): hidden, unnamed, and pet people remain excluded even with their own reference face and an owner candidate', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { person: hidden } = await ctx.newPerson({ ownerId: user.id, name: 'Hidden', isHidden: true });
      const { person: unnamed } = await ctx.newPerson({ ownerId: user.id, name: '', isHidden: false });
      const { person: pet } = await ctx.newPerson({ ownerId: user.id, name: 'Rex', isHidden: false, type: 'pet' });
      const { person: control } = await ctx.newPerson({ ownerId: user.id, name: 'Control', isHidden: false });

      const { asset } = await ctx.newAsset({ ownerId: user.id });
      for (const person of [hidden, unnamed, pet, control]) {
        await giveOwnFace(ctx, asset.id, person.id);
      }
      await ctx.newAssetFace({ assetId: asset.id, personId: null }); // shared unassigned candidate

      const ids: string[] = [];
      for await (const p of sut.getScannablePeopleWithUnassignedFaces()) {
        ids.push(p.id);
      }

      expect(ids).not.toContain(hidden.id);
      expect(ids).not.toContain(unnamed.id);
      expect(ids).not.toContain(pet.id);
      expect(ids).toContain(control.id);
    });

    it('S9.6: owner A having an unassigned face does not make owner B people scannable', async () => {
      const { ctx, sut } = setup();
      const { user: ownerA } = await ctx.newUser();
      const { user: ownerB } = await ctx.newUser();

      const { person: personA } = await ctx.newPerson({ ownerId: ownerA.id, name: 'Owner A Person', isHidden: false });
      const { person: personB } = await ctx.newPerson({ ownerId: ownerB.id, name: 'Owner B Person', isHidden: false });

      const { asset: assetA } = await ctx.newAsset({ ownerId: ownerA.id });
      await giveOwnFace(ctx, assetA.id, personA.id);
      await ctx.newAssetFace({ assetId: assetA.id, personId: null }); // only owner A has an unassigned candidate

      const { asset: assetB } = await ctx.newAsset({ ownerId: ownerB.id });
      await giveOwnFace(ctx, assetB.id, personB.id); // personB has their own reference face too, but no candidate

      const ids: string[] = [];
      for await (const p of sut.getScannablePeopleWithUnassignedFaces()) {
        ids.push(p.id);
      }

      expect(ids).toContain(personA.id);
      expect(ids).not.toContain(personB.id);
    });
  });

  // Slice 1 (F1): getAdminFaceThumbnail's only production caller wraps this in try/catch → NotFoundException,
  // so the refusal for a non-reviewable asset belongs here, at the query, not in the service. S1.12.
  describe('getFaceByIdIncludingTombstoned', () => {
    it('S1.12: throws for a face on a locked asset, returns it for a face on a timeline asset (control)', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: timelineAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { assetFace: timelineFace } = await ctx.newAssetFace({ assetId: timelineAsset.id, personId: null });

      const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      const { assetFace: lockedFace } = await ctx.newAssetFace({ assetId: lockedAsset.id, personId: null });

      await expect(sut.getFaceByIdIncludingTombstoned(timelineFace.id)).resolves.toMatchObject({
        id: timelineFace.id,
      }); // positive control
      await expect(sut.getFaceByIdIncludingTombstoned(lockedFace.id)).rejects.toThrow();
    });

    it('S1.12 (pin): still returns a tombstoned (deletedAt set) face on a timeline asset', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: timelineAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { assetFace: tombstonedFace } = await ctx.newAssetFace({ assetId: timelineAsset.id, personId: null });
      await ctx.database
        .updateTable('asset_face')
        .set({ deletedAt: new Date() })
        .where('id', '=', tombstonedFace.id)
        .execute();

      await expect(sut.getFaceByIdIncludingTombstoned(tombstonedFace.id)).resolves.toMatchObject({
        id: tombstonedFace.id,
      });
    });
  });

  // Slice 5 (F9): recognition must never re-claim a face a human has already placed. `excludeManuallyPlaced`
  // is the mechanism — a NOT EXISTS anti-join against face_identity_face.source='manual'.
  describe('getAllFaces', () => {
    it('S5.1: excludeManuallyPlaced omits a manually-linked face and yields an unassigned control face with no link', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { assetFace: manualFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: null,
        sourceType: SourceType.MachineLearning,
      });
      await linkManually(ctx, { ownerId: user.id, assetFaceId: manualFace.id });

      const { assetFace: controlFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: null,
        sourceType: SourceType.MachineLearning,
      });

      const ids = await collectFaceIds(
        sut.getAllFaces({ personId: null, sourceType: SourceType.MachineLearning, excludeManuallyPlaced: true }),
      );

      expect(ids).not.toContain(manualFace.id);
      expect(ids).toContain(controlFace.id); // positive control: an ordinary unassigned face IS returned
    });

    it('S5.2 (pin): the same query WITHOUT the option still yields the manually-linked face', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { assetFace: manualFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: null,
        sourceType: SourceType.MachineLearning,
      });
      await linkManually(ctx, { ownerId: user.id, assetFaceId: manualFace.id });

      const { assetFace: controlFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: null,
        sourceType: SourceType.MachineLearning,
      });

      const ids = await collectFaceIds(sut.getAllFaces({ personId: null, sourceType: SourceType.MachineLearning }));

      expect(ids).toContain(manualFace.id); // pin: default-off, manual-linked face still returned
      expect(ids).toContain(controlFace.id); // positive control: the ordinary face is returned too
    });

    it('S5.3 (pin): getAllFaces({ sourceType }) — the force-branch shape — is unchanged', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { assetFace: assignedFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: person.id,
        sourceType: SourceType.MachineLearning,
      });
      const { assetFace: manualFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: null,
        sourceType: SourceType.MachineLearning,
      });
      await linkManually(ctx, { ownerId: user.id, assetFaceId: manualFace.id });

      // The exact shape handleQueueRecognizeFaces's force branch calls: no personId key, no
      // excludeManuallyPlaced. Both an already-assigned face and a manually-linked one must still come back.
      const ids = await collectFaceIds(sut.getAllFaces({ sourceType: SourceType.MachineLearning }));

      expect(ids).toContain(assignedFace.id);
      expect(ids).toContain(manualFace.id); // positive control: force branch is untouched by the new option
    });

    it('S5.7 (pin): a personal confirm is unaffected — it sets asset_face.personId, already excluded by personId: null', async () => {
      const { ctx, sut } = setup();
      const faceIdentityRepository = ctx.get(FaceIdentityRepository);
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });

      // Simulate a personal confirm: asset_face.personId IS set, and a manual link exists.
      const { assetFace: confirmedFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: person.id,
        sourceType: SourceType.MachineLearning,
      });
      const identity = await faceIdentityRepository.ensurePersonIdentity(person.id);
      await faceIdentityRepository.replaceFaceIdentity({
        assetFaceId: confirmedFace.id,
        identityId: identity.id,
        source: 'manual',
      });

      const { assetFace: controlFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: null,
        sourceType: SourceType.MachineLearning,
      });

      // Deliberately WITHOUT excludeManuallyPlaced: isolates the claim to the pre-existing personId
      // filter alone — a discriminating mutation to that filter (not to excludeManuallyPlaced) must be
      // able to turn this red, otherwise this pin proves nothing about which filter is doing the work.
      const ids = await collectFaceIds(sut.getAllFaces({ personId: null, sourceType: SourceType.MachineLearning }));

      expect(ids).not.toContain(confirmedFace.id); // excluded by personId: null alone
      expect(ids).toContain(controlFace.id); // positive control
    });
  });
});
