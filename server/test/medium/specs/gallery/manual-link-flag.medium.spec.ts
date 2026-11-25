/**
Manual links are recorded (#1317, specs/2026-11-22-cross-account-identity-joins-design.md 5a).

The cross-owner repair detaches a personal person that sits on another account's identity with no shared photo
behind it, unless a human linked it there. The merge engine records that by stamping `person_identity.manualLinkAt`
on every personal person a request names, but only when the request also names a space person. (The engine's
personal merge resolves only the actor's own people, so a request never names another owner's person.) A merge of two of the actor's own people says nothing about another account, and space
editor merges name only space people. Detaching a person clears the stamp.
*/
import { Kysely } from 'kysely';
import { SharedSpaceRole } from 'src/enum.js';
import { GalleryPersonRepository } from 'src/gallery/repositories/gallery-person.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { IdentityMergePropagationService, MergeAuthorizer } from 'src/services/identity-merge-propagation.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const ALLOW_MERGE: MergeAuthorizer = () => Promise.resolve();

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [DatabaseRepository, FaceIdentityRepository, PersonRepository, SharedSpaceRepository],
    mock: [JobRepository, LoggingRepository],
  });
  const jobRepository = ctx.getMock(JobRepository);
  jobRepository.queue.mockResolvedValue();
  const sut = new IdentityMergePropagationService({
    databaseRepository: ctx.get(DatabaseRepository),
    faceIdentityRepository: ctx.get(FaceIdentityRepository),
    jobRepository,
    logger: ctx.getMock(LoggingRepository),
    personRepository: ctx.get(PersonRepository),
    galleryPersonRepository: ctx.get(GalleryPersonRepository),
    sharedSpaceRepository: ctx.get(SharedSpaceRepository),
  });
  return { ctx, sut, faceIdentity: ctx.get(FaceIdentityRepository) };
};

type Ctx = ReturnType<typeof setup>['ctx'];

/** A member, a space with face recognition, the owner's person on a space identity, and the member's own person. */
const buildWorld = async () => {
  const { ctx, sut, faceIdentity } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });

  const { person: ownerPerson } = await ctx.newPerson({ ownerId: owner.id, name: 'Sam' });
  const ownerIdentity = await faceIdentity.ensurePersonIdentity(ownerPerson.personGroupId);
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({ spaceId: space.id, identityId: ownerIdentity.id, name: 'Sam', type: 'person' })
    .returningAll()
    .executeTakeFirstOrThrow();
  const { person: memberPerson } = await ctx.newPerson({ ownerId: member.id, name: 'Uncle Sam' });
  await faceIdentity.ensurePersonIdentity(memberPerson.personGroupId);

  return { ctx, sut, faceIdentity, owner, member, space, ownerPerson, spacePerson, memberPerson };
};

const manualLinkAt = (ctx: Ctx, personGroupId: string) =>
  ctx.database
    .selectFrom('person_identity')
    .select('manualLinkAt')
    .where('personGroupId', '=', personGroupId)
    .executeTakeFirst()
    .then((row) => row?.manualLinkAt ?? null);

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

afterAll(async () => {
  await defaultDatabase.destroy();
});

describe('manual link stamp (#1317)', () => {
  it('stamps the member person linked by hand to a space person (space person as target)', async () => {
    const { ctx, sut, member, space, spacePerson, memberPerson } = await buildWorld();

    await sut.mergeScopedProfiles(factory.auth({ user: member }), {
      target: { type: 'space-person', id: spacePerson.id, spaceId: space.id },
      sources: [{ type: 'person', id: memberPerson.personGroupId }],
    });

    await expect(manualLinkAt(ctx, memberPerson.personGroupId)).resolves.not.toBeNull();
  });

  it('stamps the member person linked by hand to a space person (member person as target)', async () => {
    const { ctx, sut, member, space, spacePerson, memberPerson } = await buildWorld();

    await sut.mergeScopedProfiles(factory.auth({ user: member }), {
      target: { type: 'person', id: memberPerson.personGroupId },
      sources: [{ type: 'space-person', id: spacePerson.id, spaceId: space.id }],
    });

    await expect(manualLinkAt(ctx, memberPerson.personGroupId)).resolves.not.toBeNull();
  });

  it('stamps the person that survives when the named person is merged into one already on the identity', async () => {
    const { ctx, sut, faceIdentity, member, space, spacePerson, memberPerson } = await buildWorld();
    // The member already has a person on the space person's identity; the merge keeps that one.
    const { person: onIdentity } = await ctx.newPerson({ ownerId: member.id, name: 'Sam' });
    await faceIdentity.ensurePersonIdentity(onIdentity.personGroupId);
    await ctx.database
      .updateTable('person_identity')
      .set({ identityId: spacePerson.identityId! })
      .where('personGroupId', '=', onIdentity.personGroupId)
      .execute();

    await sut.mergeScopedProfiles(factory.auth({ user: member }), {
      target: { type: 'space-person', id: spacePerson.id, spaceId: space.id },
      sources: [{ type: 'person', id: memberPerson.personGroupId }],
    });

    const survivors = await ctx.database
      .selectFrom('person_identity')
      .select(['personGroupId', 'manualLinkAt'])
      .where('ownerId', '=', member.id)
      .where('identityId', '=', spacePerson.identityId!)
      .execute();
    expect(survivors).toHaveLength(1);
    expect(survivors[0].manualLinkAt).not.toBeNull();
  });

  it('keeps the stamp when a linked person is merged into another of the actor own people', async () => {
    const { ctx, sut, faceIdentity, member, space, spacePerson, memberPerson } = await buildWorld();
    await sut.mergeScopedProfiles(factory.auth({ user: member }), {
      target: { type: 'space-person', id: spacePerson.id, spaceId: space.id },
      sources: [{ type: 'person', id: memberPerson.personGroupId }],
    });
    const { person: other } = await ctx.newPerson({ ownerId: member.id, name: 'Sam again' });
    await faceIdentity.ensurePersonIdentity(other.personGroupId);

    await sut.mergePersonalPeople(factory.auth({ user: member }), other.personGroupId, [memberPerson.personGroupId]);

    await expect(manualLinkAt(ctx, other.personGroupId)).resolves.not.toBeNull();
  });

  it('does not stamp a merge of two of the actor own people', async () => {
    const { ctx, sut, faceIdentity, member, memberPerson } = await buildWorld();
    const { person: second } = await ctx.newPerson({ ownerId: member.id, name: 'Sam again' });
    await faceIdentity.ensurePersonIdentity(second.personGroupId);

    await sut.mergePersonalPeople(factory.auth({ user: member }), memberPerson.personGroupId, [second.personGroupId]);

    await expect(manualLinkAt(ctx, memberPerson.personGroupId)).resolves.toBeNull();
  });

  it('does not stamp personal people during a space editor merge of space people', async () => {
    const { ctx, sut, faceIdentity, member, space, ownerPerson, spacePerson, memberPerson } = await buildWorld();
    const memberIdentity = await faceIdentity.ensurePersonIdentity(memberPerson.personGroupId);
    const memberSpacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId: space.id, identityId: memberIdentity.id, name: '', type: 'person' })
      .returningAll()
      .executeTakeFirstOrThrow();

    await sut.mergeSpacePeople(
      factory.auth({ user: member }),
      space.id,
      spacePerson.id,
      [memberSpacePerson.id],
      ALLOW_MERGE,
    );

    await expect(manualLinkAt(ctx, memberPerson.personGroupId)).resolves.toBeNull();
    await expect(manualLinkAt(ctx, ownerPerson.personGroupId)).resolves.toBeNull();
  });

  it('clears the stamp when the person is detached', async () => {
    const { ctx, sut, faceIdentity, member, space, spacePerson, memberPerson } = await buildWorld();
    await sut.mergeScopedProfiles(factory.auth({ user: member }), {
      target: { type: 'space-person', id: spacePerson.id, spaceId: space.id },
      sources: [{ type: 'person', id: memberPerson.personGroupId }],
    });

    await faceIdentity.detachScopedProfile({ type: 'person', id: memberPerson.personGroupId });

    await expect(manualLinkAt(ctx, memberPerson.personGroupId)).resolves.toBeNull();
  });

  // Every public merge entry point of the engine is covered above. A new one fails here until this file says whether
  // it stamps manual links.
  it('covers every merge entry point of the engine', () => {
    const covered = ['mergePersonalPeople', 'mergeScopedProfiles', 'mergeSpacePeople'];
    const entryPoints = Object.getOwnPropertyNames(IdentityMergePropagationService.prototype).filter((name) =>
      /^merge[A-Z]/.test(name),
    );
    expect(entryPoints.toSorted()).toEqual(covered.toSorted());
  });
});
