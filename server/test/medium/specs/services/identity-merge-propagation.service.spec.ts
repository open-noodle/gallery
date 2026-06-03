import { Kysely } from 'kysely';
import { JobName, SharedSpaceActivityType } from 'src/enum';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { IdentityMergePropagationService } from 'src/services/identity-merge-propagation.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';
import { Mocked } from 'vitest';

let defaultDatabase: Kysely<DB>;

const setup = (db: Kysely<DB> = defaultDatabase) => {
  const { ctx } = newMediumService(BaseService, {
    database: db,
    real: [DatabaseRepository, FaceIdentityRepository, PersonRepository, SharedSpaceRepository],
    mock: [JobRepository, LoggingRepository],
  });
  const jobRepository = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  jobRepository.queue.mockResolvedValue();

  const sut = new IdentityMergePropagationService({
    databaseRepository: ctx.get(DatabaseRepository),
    faceIdentityRepository: ctx.get(FaceIdentityRepository),
    jobRepository,
    logger: ctx.getMock<LoggingRepository, Mocked<LoggingRepository>>(LoggingRepository),
    personRepository: ctx.get(PersonRepository),
    sharedSpaceRepository: ctx.get(SharedSpaceRepository),
  });

  return { ctx, sut };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const createIdentity = (db: Kysely<DB>) => {
  return db.insertInto('face_identity').values({ type: 'person' }).returningAll().executeTakeFirstOrThrow();
};

const setPersonIdentity = async (
  db: Kysely<DB>,
  input: { personId: string; identityId: string | null; faceAssetId?: string | null },
) => {
  await db
    .updateTable('person')
    .set({ identityId: input.identityId, faceAssetId: input.faceAssetId })
    .where('id', '=', input.personId)
    .execute();
};

const createPersonProfile = async (
  ctx: ReturnType<typeof setup>['ctx'],
  input: { ownerId: string; identityId?: string | null; name?: string },
) => {
  const { person } = await ctx.newPerson({ ownerId: input.ownerId, name: input.name ?? 'Person' });
  if (input.identityId !== undefined) {
    await setPersonIdentity(ctx.database, { personId: person.id, identityId: input.identityId });
  }
  return person;
};

const createSpacePerson = async (
  db: Kysely<DB>,
  input: { spaceId: string; identityId?: string | null; name?: string; type?: string },
) => {
  return db
    .insertInto('shared_space_person')
    .values({
      spaceId: input.spaceId,
      identityId: input.identityId ?? null,
      name: input.name ?? 'Space Person',
      type: input.type ?? 'person',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
};

const createIdentityLinkedFace = async (
  ctx: ReturnType<typeof setup>['ctx'],
  input: { ownerId: string; identityId: string; personId?: string | null },
) => {
  const { asset } = await ctx.newAsset({ ownerId: input.ownerId });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: input.personId ?? null });
  await ctx.database
    .insertInto('face_identity_face')
    .values({ assetFaceId: assetFace.id, identityId: input.identityId, source: 'manual' })
    .execute();
  return assetFace;
};

const getPeople = (db: Kysely<DB>, ids: string[]) => {
  return db.selectFrom('person').select(['id', 'identityId']).where('id', 'in', ids).orderBy('id').execute();
};

const getSpacePeople = (db: Kysely<DB>, ids: string[]) => {
  return db
    .selectFrom('shared_space_person')
    .select(['id', 'identityId'])
    .where('id', 'in', ids)
    .orderBy('id')
    .execute();
};

const getIdentityIds = (db: Kysely<DB>, ids: string[]) => {
  return db.selectFrom('face_identity').select('id').where('id', 'in', ids).orderBy('id').execute();
};

describe('IdentityMergePropagationService medium tests', () => {
  it('rolls back all profile and identity changes when one profile merge fails', async () => {
    const { ctx, sut } = setup();
    const personRepository = ctx.get(PersonRepository);
    const { user } = await ctx.newUser();
    const target = await createPersonProfile(ctx, { ownerId: user.id, name: 'Target' });
    const sourceA = await createPersonProfile(ctx, { ownerId: user.id, name: 'Source A' });
    const sourceB = await createPersonProfile(ctx, { ownerId: user.id, name: 'Source B' });
    const originalMerge = personRepository.mergePersonProfile.bind(personRepository);
    vi.spyOn(personRepository, 'mergePersonProfile')
      .mockImplementationOnce((input, db) => originalMerge(input, db))
      .mockRejectedValueOnce(new Error('profile merge failed'));

    await expect(sut.mergePersonalPeople(factory.auth({ user }), target.id, [sourceA.id, sourceB.id])).rejects.toThrow(
      'profile merge failed',
    );

    await expect(getPeople(ctx.database, [target.id, sourceA.id, sourceB.id])).resolves.toEqual(
      expect.arrayContaining([
        { id: target.id, identityId: null },
        { id: sourceA.id, identityId: null },
        { id: sourceB.id, identityId: null },
      ]),
    );
  });

  it('does not violate owner identity uniqueness while collapsing personal duplicates', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const targetIdentity = await createIdentity(ctx.database);
    const sourceIdentity = await createIdentity(ctx.database);
    const target = await createPersonProfile(ctx, { ownerId: user.id, identityId: targetIdentity.id, name: 'Target' });
    const source = await createPersonProfile(ctx, { ownerId: user.id, identityId: sourceIdentity.id, name: 'Source' });

    await expect(sut.mergePersonalPeople(factory.auth({ user }), target.id, [source.id])).resolves.toEqual([
      { id: source.id, success: true },
    ]);

    const people = await getPeople(ctx.database, [target.id, source.id]);
    expect(people).toEqual([{ id: target.id, identityId: targetIdentity.id }]);
  });

  it('does not violate space identity uniqueness while collapsing shared-space duplicates', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const targetIdentity = await createIdentity(ctx.database);
    const sourceIdentity = await createIdentity(ctx.database);
    const target = await createSpacePerson(ctx.database, { spaceId: space.id, identityId: targetIdentity.id });
    const source = await createSpacePerson(ctx.database, { spaceId: space.id, identityId: sourceIdentity.id });

    await expect(
      sut.mergeSpacePeople(factory.auth({ user }), space.id, target.id, [source.id]),
    ).resolves.toBeUndefined();

    const people = await ctx.database
      .selectFrom('shared_space_person')
      .select(['id', 'identityId'])
      .where('id', 'in', [target.id, source.id])
      .execute();
    expect(people).toEqual([{ id: target.id, identityId: targetIdentity.id }]);
  });

  it('collapses identity faces for identities that have no profile in a scope', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const targetIdentity = await createIdentity(ctx.database);
    const sourceIdentity = await createIdentity(ctx.database);
    const target = await createPersonProfile(ctx, { ownerId: user.id, identityId: targetIdentity.id, name: 'Target' });
    const source = await createPersonProfile(ctx, { ownerId: user.id, identityId: sourceIdentity.id, name: 'Source' });
    const orphanedSourceFace = await createIdentityLinkedFace(ctx, { ownerId: user.id, identityId: sourceIdentity.id });

    await sut.mergePersonalPeople(factory.auth({ user }), target.id, [source.id]);

    const faceLink = await ctx.database
      .selectFrom('face_identity_face')
      .select(['assetFaceId', 'identityId', 'source'])
      .where('assetFaceId', '=', orphanedSourceFace.id)
      .executeTakeFirstOrThrow();
    expect(faceLink).toEqual({ assetFaceId: orphanedSourceFace.id, identityId: targetIdentity.id, source: 'manual' });
  });

  it('propagates a personal merge across other owners and all affected spaces', async () => {
    const { ctx, sut } = setup();
    const jobRepository = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
    const { user: actor } = await ctx.newUser();
    const { user: otherOwner } = await ctx.newUser();
    const { space: duplicateSpaceA } = await ctx.newSharedSpace({ createdById: actor.id });
    const { space: duplicateSpaceB } = await ctx.newSharedSpace({ createdById: otherOwner.id });
    const { space: singletonSpace } = await ctx.newSharedSpace({ createdById: otherOwner.id });
    const targetIdentity = await createIdentity(ctx.database);
    const sourceIdentity = await createIdentity(ctx.database);
    const actorTarget = await createPersonProfile(ctx, {
      ownerId: actor.id,
      identityId: targetIdentity.id,
      name: 'Actor Target',
    });
    const actorSource = await createPersonProfile(ctx, {
      ownerId: actor.id,
      identityId: sourceIdentity.id,
      name: 'Actor Source',
    });
    const otherTarget = await createPersonProfile(ctx, {
      ownerId: otherOwner.id,
      identityId: targetIdentity.id,
      name: 'Other Target',
    });
    const otherSource = await createPersonProfile(ctx, {
      ownerId: otherOwner.id,
      identityId: sourceIdentity.id,
      name: 'Other Source',
    });
    const spaceATarget = await createSpacePerson(ctx.database, {
      spaceId: duplicateSpaceA.id,
      identityId: targetIdentity.id,
      name: 'Space A Target',
    });
    const spaceASource = await createSpacePerson(ctx.database, {
      spaceId: duplicateSpaceA.id,
      identityId: sourceIdentity.id,
      name: 'Space A Source',
    });
    const spaceBTarget = await createSpacePerson(ctx.database, {
      spaceId: duplicateSpaceB.id,
      identityId: targetIdentity.id,
      name: 'Space B Target',
    });
    const spaceBSource = await createSpacePerson(ctx.database, {
      spaceId: duplicateSpaceB.id,
      identityId: sourceIdentity.id,
      name: 'Space B Source',
    });
    const singletonSource = await createSpacePerson(ctx.database, {
      spaceId: singletonSpace.id,
      identityId: sourceIdentity.id,
      name: 'Singleton Source',
    });

    await expect(
      sut.mergePersonalPeople(factory.auth({ user: actor }), actorTarget.id, [actorSource.id]),
    ).resolves.toEqual([{ id: actorSource.id, success: true }]);

    await expect(
      getPeople(ctx.database, [actorTarget.id, actorSource.id, otherTarget.id, otherSource.id]),
    ).resolves.toEqual(
      [
        { id: actorTarget.id, identityId: targetIdentity.id },
        { id: otherTarget.id, identityId: targetIdentity.id },
      ].toSorted((a, b) => a.id.localeCompare(b.id)),
    );
    await expect(
      getSpacePeople(ctx.database, [
        spaceATarget.id,
        spaceASource.id,
        spaceBTarget.id,
        spaceBSource.id,
        singletonSource.id,
      ]),
    ).resolves.toEqual(
      [
        { id: singletonSource.id, identityId: targetIdentity.id },
        { id: spaceATarget.id, identityId: targetIdentity.id },
        { id: spaceBTarget.id, identityId: targetIdentity.id },
      ].toSorted((a, b) => a.id.localeCompare(b.id)),
    );
    await expect(getIdentityIds(ctx.database, [targetIdentity.id, sourceIdentity.id])).resolves.toEqual([
      { id: targetIdentity.id },
    ]);
    expect(jobRepository.queue).toHaveBeenCalledWith({
      name: JobName.SharedSpacePersonMetadataBackfill,
      data: { identityId: targetIdentity.id },
    });
    expect(jobRepository.queue).toHaveBeenCalledWith({
      name: JobName.SharedSpacePersonDedup,
      data: { spaceId: duplicateSpaceA.id },
    });
    expect(jobRepository.queue).toHaveBeenCalledWith({
      name: JobName.SharedSpacePersonDedup,
      data: { spaceId: duplicateSpaceB.id },
    });
    expect(jobRepository.queue).toHaveBeenCalledWith({
      name: JobName.SharedSpacePersonDedup,
      data: { spaceId: singletonSpace.id },
    });
  });

  it('propagates a space merge across other spaces and personal people for different owners', async () => {
    const { ctx, sut } = setup();
    const jobRepository = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
    const { user: actor } = await ctx.newUser();
    const { user: otherOwner } = await ctx.newUser();
    const { user: singletonOwner } = await ctx.newUser();
    const { space: initiatingSpace } = await ctx.newSharedSpace({ createdById: actor.id });
    const { space: duplicateSpace } = await ctx.newSharedSpace({ createdById: otherOwner.id });
    const { space: singletonSpace } = await ctx.newSharedSpace({ createdById: singletonOwner.id });
    const targetIdentity = await createIdentity(ctx.database);
    const sourceIdentity = await createIdentity(ctx.database);
    const initiatingTarget = await createSpacePerson(ctx.database, {
      spaceId: initiatingSpace.id,
      identityId: targetIdentity.id,
      name: 'Initiating Target',
    });
    const initiatingSource = await createSpacePerson(ctx.database, {
      spaceId: initiatingSpace.id,
      identityId: sourceIdentity.id,
      name: 'Initiating Source',
    });
    const duplicateSpaceTarget = await createSpacePerson(ctx.database, {
      spaceId: duplicateSpace.id,
      identityId: targetIdentity.id,
      name: 'Other Space Target',
    });
    const duplicateSpaceSource = await createSpacePerson(ctx.database, {
      spaceId: duplicateSpace.id,
      identityId: sourceIdentity.id,
      name: 'Other Space Source',
    });
    const singletonSpaceSource = await createSpacePerson(ctx.database, {
      spaceId: singletonSpace.id,
      identityId: sourceIdentity.id,
      name: 'Singleton Space Source',
    });
    const otherOwnerTarget = await createPersonProfile(ctx, {
      ownerId: otherOwner.id,
      identityId: targetIdentity.id,
      name: 'Other Owner Target',
    });
    const otherOwnerSource = await createPersonProfile(ctx, {
      ownerId: otherOwner.id,
      identityId: sourceIdentity.id,
      name: 'Other Owner Source',
    });
    const singletonOwnerSource = await createPersonProfile(ctx, {
      ownerId: singletonOwner.id,
      identityId: sourceIdentity.id,
      name: 'Singleton Owner Source',
    });

    await expect(
      sut.mergeSpacePeople(factory.auth({ user: actor }), initiatingSpace.id, initiatingTarget.id, [
        initiatingSource.id,
      ]),
    ).resolves.toBeUndefined();

    await expect(
      getSpacePeople(ctx.database, [
        initiatingTarget.id,
        initiatingSource.id,
        duplicateSpaceTarget.id,
        duplicateSpaceSource.id,
        singletonSpaceSource.id,
      ]),
    ).resolves.toEqual(
      [
        { id: duplicateSpaceTarget.id, identityId: targetIdentity.id },
        { id: initiatingTarget.id, identityId: targetIdentity.id },
        { id: singletonSpaceSource.id, identityId: targetIdentity.id },
      ].toSorted((a, b) => a.id.localeCompare(b.id)),
    );
    await expect(
      getPeople(ctx.database, [otherOwnerTarget.id, otherOwnerSource.id, singletonOwnerSource.id]),
    ).resolves.toEqual(
      [
        { id: otherOwnerTarget.id, identityId: targetIdentity.id },
        { id: singletonOwnerSource.id, identityId: targetIdentity.id },
      ].toSorted((a, b) => a.id.localeCompare(b.id)),
    );
    await expect(getIdentityIds(ctx.database, [targetIdentity.id, sourceIdentity.id])).resolves.toEqual([
      { id: targetIdentity.id },
    ]);
    expect(jobRepository.queue).toHaveBeenCalledWith({
      name: JobName.SharedSpacePersonMetadataBackfill,
      data: { identityId: targetIdentity.id },
    });
    expect(jobRepository.queue).toHaveBeenCalledWith({
      name: JobName.SharedSpacePersonDedup,
      data: { spaceId: initiatingSpace.id },
    });
    expect(jobRepository.queue).toHaveBeenCalledWith({
      name: JobName.SharedSpacePersonDedup,
      data: { spaceId: duplicateSpace.id },
    });
    expect(jobRepository.queue).toHaveBeenCalledWith({
      name: JobName.SharedSpacePersonDedup,
      data: { spaceId: singletonSpace.id },
    });
  });

  it('handles concurrent overlapping merges with one success and one clean retry or failure', async () => {
    const db = await getKyselyDB();
    try {
      const { ctx, sut } = setup(db);
      const { user } = await ctx.newUser();
      const targetIdentity = await createIdentity(ctx.database);
      const sourceIdentity = await createIdentity(ctx.database);
      const target = await createPersonProfile(ctx, {
        ownerId: user.id,
        identityId: targetIdentity.id,
        name: 'Target',
      });
      const source = await createPersonProfile(ctx, {
        ownerId: user.id,
        identityId: sourceIdentity.id,
        name: 'Source',
      });
      const results = await Promise.allSettled([
        sut.mergePersonalPeople(factory.auth({ user }), target.id, [source.id]),
        sut.mergePersonalPeople(factory.auth({ user }), target.id, [source.id]),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(fulfilled[0]).toEqual({ status: 'fulfilled', value: [{ id: source.id, success: true }] });
      expect(rejected[0]).toMatchObject({
        status: 'rejected',
        reason: expect.any(Error),
      });
      await expect(getPeople(ctx.database, [target.id, source.id])).resolves.toEqual([
        { id: target.id, identityId: targetIdentity.id },
      ]);
    } finally {
      await db.destroy();
    }
  });

  it('serializes chained personal merges so a deleted target fails cleanly', async () => {
    const db = await getKyselyDB();
    try {
      const { ctx, sut } = setup(db);
      const personRepository = ctx.get(PersonRepository);
      const { user } = await ctx.newUser();
      const identityA = await createIdentity(ctx.database);
      const identityB = await createIdentity(ctx.database);
      const identityC = await createIdentity(ctx.database);
      const personA = await createPersonProfile(ctx, { ownerId: user.id, identityId: identityA.id, name: 'A' });
      const personB = await createPersonProfile(ctx, { ownerId: user.id, identityId: identityB.id, name: 'B' });
      const personC = await createPersonProfile(ctx, { ownerId: user.id, identityId: identityC.id, name: 'C' });
      const originalLock = personRepository.lockPeopleForMerge.bind(personRepository);
      let releaseFirst!: () => void;
      const firstCanFinish = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstLocked!: () => void;
      const firstLockReached = new Promise<void>((resolve) => {
        firstLocked = resolve;
      });
      let heldFirst = false;
      vi.spyOn(personRepository, 'lockPeopleForMerge').mockImplementation(async (personIds, transaction) => {
        await originalLock(personIds, transaction);
        if (!heldFirst && personIds.includes(personA.id) && personIds.includes(personB.id)) {
          heldFirst = true;
          firstLocked();
          await firstCanFinish;
        }
      });

      const first = sut.mergePersonalPeople(factory.auth({ user }), personA.id, [personB.id]);
      await firstLockReached;
      const second = sut.mergePersonalPeople(factory.auth({ user }), personB.id, [personC.id]);
      await new Promise((resolve) => setTimeout(resolve, 25));
      releaseFirst();

      const results = await Promise.allSettled([first, second]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      await expect(getPeople(ctx.database, [personA.id, personB.id, personC.id])).resolves.toEqual(
        expect.arrayContaining([
          { id: personA.id, identityId: identityA.id },
          { id: personC.id, identityId: identityC.id },
        ]),
      );
    } finally {
      await db.destroy();
    }
  });

  it('serializes reversed personal merges before creating missing identities', async () => {
    const db = await getKyselyDB();
    try {
      const { ctx, sut } = setup(db);
      const personRepository = ctx.get(PersonRepository);
      const { user } = await ctx.newUser();
      const personA = await createPersonProfile(ctx, { ownerId: user.id, identityId: null, name: 'A' });
      const personB = await createPersonProfile(ctx, { ownerId: user.id, identityId: null, name: 'B' });
      const originalLock = personRepository.lockPeopleForMerge.bind(personRepository);
      let releaseFirst!: () => void;
      const firstCanFinish = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstLocked!: () => void;
      const firstLockReached = new Promise<void>((resolve) => {
        firstLocked = resolve;
      });
      let heldFirst = false;
      vi.spyOn(personRepository, 'lockPeopleForMerge').mockImplementation(async (personIds, transaction) => {
        await originalLock(personIds, transaction);
        if (!heldFirst && personIds.includes(personA.id) && personIds.includes(personB.id)) {
          heldFirst = true;
          firstLocked();
          await firstCanFinish;
        }
      });

      const first = sut.mergePersonalPeople(factory.auth({ user }), personA.id, [personB.id]);
      await firstLockReached;
      const second = sut.mergePersonalPeople(factory.auth({ user }), personB.id, [personA.id]);
      await new Promise((resolve) => setTimeout(resolve, 25));
      releaseFirst();

      const results = await Promise.allSettled([first, second]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const people = await getPeople(ctx.database, [personA.id, personB.id]);
      expect(people).toHaveLength(1);
      expect(people[0]?.identityId).toBeTruthy();
    } finally {
      await db.destroy();
    }
  });

  it('handles concurrent overlapping shared-space merges with one success and one clean retry or failure', async () => {
    const db = await getKyselyDB();
    try {
      const { ctx, sut } = setup(db);
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const targetIdentity = await createIdentity(ctx.database);
      const sourceIdentity = await createIdentity(ctx.database);
      const target = await createSpacePerson(ctx.database, {
        spaceId: space.id,
        identityId: targetIdentity.id,
        name: 'Target',
      });
      const source = await createSpacePerson(ctx.database, {
        spaceId: space.id,
        identityId: sourceIdentity.id,
        name: 'Source',
      });
      const results = await Promise.allSettled([
        sut.mergeSpacePeople(factory.auth({ user }), space.id, target.id, [source.id]),
        sut.mergeSpacePeople(factory.auth({ user }), space.id, target.id, [source.id]),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        status: 'rejected',
        reason: expect.any(Error),
      });
      await expect(getSpacePeople(ctx.database, [target.id, source.id])).resolves.toEqual([
        { id: target.id, identityId: targetIdentity.id },
      ]);
    } finally {
      await db.destroy();
    }
  });

  it('serializes chained shared-space merges so a deleted target fails cleanly', async () => {
    const db = await getKyselyDB();
    try {
      const { ctx, sut } = setup(db);
      const sharedSpaceRepository = ctx.get(SharedSpaceRepository);
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const identityA = await createIdentity(ctx.database);
      const identityB = await createIdentity(ctx.database);
      const identityC = await createIdentity(ctx.database);
      const personA = await createSpacePerson(ctx.database, { spaceId: space.id, identityId: identityA.id, name: 'A' });
      const personB = await createSpacePerson(ctx.database, { spaceId: space.id, identityId: identityB.id, name: 'B' });
      const personC = await createSpacePerson(ctx.database, { spaceId: space.id, identityId: identityC.id, name: 'C' });
      const originalLock = sharedSpaceRepository.lockSpacePeopleForMerge.bind(sharedSpaceRepository);
      let releaseFirst!: () => void;
      const firstCanFinish = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstLocked!: () => void;
      const firstLockReached = new Promise<void>((resolve) => {
        firstLocked = resolve;
      });
      let heldFirst = false;
      vi.spyOn(sharedSpaceRepository, 'lockSpacePeopleForMerge').mockImplementation(async (personIds, transaction) => {
        await originalLock(personIds, transaction);
        if (!heldFirst && personIds.includes(personA.id) && personIds.includes(personB.id)) {
          heldFirst = true;
          firstLocked();
          await firstCanFinish;
        }
      });

      const first = sut.mergeSpacePeople(factory.auth({ user }), space.id, personA.id, [personB.id]);
      await firstLockReached;
      const second = sut.mergeSpacePeople(factory.auth({ user }), space.id, personB.id, [personC.id]);
      await new Promise((resolve) => setTimeout(resolve, 25));
      releaseFirst();

      const results = await Promise.allSettled([first, second]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      await expect(getSpacePeople(ctx.database, [personA.id, personB.id, personC.id])).resolves.toEqual(
        expect.arrayContaining([
          { id: personA.id, identityId: identityA.id },
          { id: personC.id, identityId: identityC.id },
        ]),
      );
    } finally {
      await db.destroy();
    }
  });

  it('serializes reversed shared-space merges before creating missing identities', async () => {
    const db = await getKyselyDB();
    try {
      const { ctx, sut } = setup(db);
      const sharedSpaceRepository = ctx.get(SharedSpaceRepository);
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const personA = await createSpacePerson(ctx.database, { spaceId: space.id, identityId: null, name: 'A' });
      const personB = await createSpacePerson(ctx.database, { spaceId: space.id, identityId: null, name: 'B' });
      const originalLock = sharedSpaceRepository.lockSpacePeopleForMerge.bind(sharedSpaceRepository);
      let releaseFirst!: () => void;
      const firstCanFinish = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstLocked!: () => void;
      const firstLockReached = new Promise<void>((resolve) => {
        firstLocked = resolve;
      });
      let heldFirst = false;
      vi.spyOn(sharedSpaceRepository, 'lockSpacePeopleForMerge').mockImplementation(async (personIds, transaction) => {
        await originalLock(personIds, transaction);
        if (!heldFirst && personIds.includes(personA.id) && personIds.includes(personB.id)) {
          heldFirst = true;
          firstLocked();
          await firstCanFinish;
        }
      });

      const first = sut.mergeSpacePeople(factory.auth({ user }), space.id, personA.id, [personB.id]);
      await firstLockReached;
      const second = sut.mergeSpacePeople(factory.auth({ user }), space.id, personB.id, [personA.id]);
      await new Promise((resolve) => setTimeout(resolve, 25));
      releaseFirst();

      const results = await Promise.allSettled([first, second]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const people = await getSpacePeople(ctx.database, [personA.id, personB.id]);
      expect(people).toHaveLength(1);
      expect(people[0]?.identityId).toBeTruthy();
    } finally {
      await db.destroy();
    }
  });

  it('rolls back when activity write fails inside the transaction', async () => {
    const { ctx, sut } = setup();
    const sharedSpaceRepository = ctx.get(SharedSpaceRepository);
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const targetIdentity = await createIdentity(ctx.database);
    const sourceIdentity = await createIdentity(ctx.database);
    const target = await createPersonProfile(ctx, { ownerId: user.id, identityId: targetIdentity.id, name: 'Target' });
    const source = await createPersonProfile(ctx, { ownerId: user.id, identityId: sourceIdentity.id, name: 'Source' });
    const spaceTarget = await createSpacePerson(ctx.database, { spaceId: space.id, identityId: targetIdentity.id });
    const spaceSource = await createSpacePerson(ctx.database, { spaceId: space.id, identityId: sourceIdentity.id });
    vi.spyOn(sharedSpaceRepository, 'logActivity').mockRejectedValueOnce(new Error('activity failed'));

    await expect(sut.mergePersonalPeople(factory.auth({ user }), target.id, [source.id])).rejects.toThrow(
      'activity failed',
    );

    await expect(getPeople(ctx.database, [target.id, source.id])).resolves.toEqual(
      expect.arrayContaining([
        { id: target.id, identityId: targetIdentity.id },
        { id: source.id, identityId: sourceIdentity.id },
      ]),
    );
    await expect(
      ctx.database
        .selectFrom('shared_space_person')
        .select(['id', 'identityId'])
        .where('id', 'in', [spaceTarget.id, spaceSource.id])
        .orderBy('id')
        .execute(),
    ).resolves.toEqual(
      expect.arrayContaining([
        { id: spaceTarget.id, identityId: targetIdentity.id },
        { id: spaceSource.id, identityId: sourceIdentity.id },
      ]),
    );
    await expect(
      ctx.database
        .selectFrom('shared_space_activity')
        .select('id')
        .where('spaceId', '=', space.id)
        .where('type', '=', SharedSpaceActivityType.PersonMerge)
        .execute(),
    ).resolves.toEqual([]);
  });
});
