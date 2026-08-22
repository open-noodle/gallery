import { Kysely } from 'kysely';
import { JobName, SharedSpaceActivityType, SharedSpaceRole } from 'src/enum';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { FaceIdentityFaceSource } from 'src/schema/tables/face-identity-face.table';
import { BaseService } from 'src/services/base.service';
import { IdentityMergePropagationService, MergeAuthorizer } from 'src/services/identity-merge-propagation.service';
import { asDateString } from 'src/utils/date';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db: Kysely<DB> = defaultDatabase) => {
  const { ctx } = newMediumService(BaseService, {
    database: db,
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
    .where('personGroupId', '=', input.personId)
    .execute();
};

const createPersonProfile = async (
  ctx: ReturnType<typeof setup>['ctx'],
  input: {
    ownerId: string;
    identityId?: string | null;
    name?: string;
    birthDate?: string | null;
    isHidden?: boolean;
    isFavorite?: boolean;
  },
) => {
  const { person } = await ctx.newPerson({
    ownerId: input.ownerId,
    name: input.name ?? 'Person',
    ...(input.birthDate !== undefined && { birthDate: input.birthDate }),
    ...(input.isHidden !== undefined && { isHidden: input.isHidden }),
    ...(input.isFavorite !== undefined && { isFavorite: input.isFavorite }),
  });
  if (input.identityId !== undefined) {
    await setPersonIdentity(ctx.database, { personId: person.personGroupId, identityId: input.identityId });
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
  input: { ownerId: string; identityId: string; personId?: string | null; source?: FaceIdentityFaceSource },
) => {
  const { asset } = await ctx.newAsset({ ownerId: input.ownerId });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: input.personId ?? null });
  await ctx.database
    .insertInto('face_identity_face')
    .values({ assetFaceId: assetFace.id, identityId: input.identityId, source: input.source ?? 'manual' })
    .execute();
  return assetFace;
};

const getPeople = (db: Kysely<DB>, ids: string[]) => {
  return db.selectFrom('person').select(['id', 'identityId']).where('personGroupId', 'in', ids).orderBy('id').execute();
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

// These tests drive the engine DIRECTLY to exercise its propagation mechanics, including destructive cross-owner
// and cross-space collapses. The engine now fails closed on a destructive plan unless an authorizer ran (#733
// review L3), so the destructive-mechanics tests pass this explicit permissive authorizer — the gate itself is
// covered in merge-policy.spec.ts and people-identity-rbac.spec.ts.
const ALLOW_MERGE: MergeAuthorizer = () => Promise.resolve();

describe('IdentityMergePropagationService medium tests', () => {
  // The #733 topology, end to end against a real database: userA's own person and userB's person (from a
  // connected library) BOTH also projected into the shared space. Two profiles of the two identities live in
  // the same space, so the raw merge engine could never commit this — it is exactly the merge the scoped
  // endpoint used to refuse with "Cannot merge people that already have separate profiles in the same scope".
  it('collapses a same-space profile conflict and re-points the other owner (scoped merge)', async () => {
    const { ctx, sut } = setup();
    const { user: actor } = await ctx.newUser();
    const { user: otherOwner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: actor.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: actor.id, role: SharedSpaceRole.Owner });

    const targetIdentity = await createIdentity(ctx.database);
    const sourceIdentity = await createIdentity(ctx.database);
    const myPerson = await createPersonProfile(ctx, {
      ownerId: actor.id,
      identityId: targetIdentity.id,
      name: 'Ada',
    });
    const theirPerson = await createPersonProfile(ctx, {
      ownerId: otherOwner.id,
      identityId: sourceIdentity.id,
      name: 'Ada (theirs)',
    });
    const spaceMine = await createSpacePerson(ctx.database, { spaceId: space.id, identityId: targetIdentity.id });
    const spaceTheirs = await createSpacePerson(ctx.database, { spaceId: space.id, identityId: sourceIdentity.id });

    await expect(
      sut.mergeScopedProfiles(factory.auth({ user: actor }), {
        target: { type: 'person', id: myPerson.personGroupId },
        sources: [{ type: 'space-person', id: spaceTheirs.id, spaceId: space.id }],
      }),
    ).resolves.toBeUndefined();

    // The space keeps exactly one profile for the merged identity: the conflict was collapsed, not refused.
    const spacePeople = await getSpacePeople(ctx.database, [spaceMine.id, spaceTheirs.id]);
    expect(spacePeople).toEqual([{ id: spaceMine.id, identityId: targetIdentity.id }]);

    // The other owner's person survives intact — only its identity moves (a re-point, not a collapse).
    const people = await getPeople(ctx.database, [myPerson.personGroupId, theirPerson.personGroupId]);
    expect(people).toEqual(
      expect.arrayContaining([
        { id: myPerson.personGroupId, identityId: targetIdentity.id },
        { id: theirPerson.personGroupId, identityId: targetIdentity.id },
      ]),
    );
  });

  it('refuses a scoped merge naming a space person the actor may only view', async () => {
    const { ctx, sut } = setup();
    const { user: actor } = await ctx.newUser();
    const { user: spaceOwner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: spaceOwner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: actor.id, role: SharedSpaceRole.Viewer });

    const targetIdentity = await createIdentity(ctx.database);
    const sourceIdentity = await createIdentity(ctx.database);
    const myPerson = await createPersonProfile(ctx, { ownerId: actor.id, identityId: targetIdentity.id });
    const theirSpacePerson = await createSpacePerson(ctx.database, {
      spaceId: space.id,
      identityId: sourceIdentity.id,
    });

    await expect(
      sut.mergeScopedProfiles(factory.auth({ user: actor }), {
        target: { type: 'person', id: myPerson.personGroupId },
        sources: [{ type: 'space-person', id: theirSpacePerson.id, spaceId: space.id }],
      }),
    ).rejects.toThrow('One or more people were not found or are not accessible');

    const people = await getPeople(ctx.database, [myPerson.personGroupId]);
    expect(people).toEqual([{ id: myPerson.personGroupId, identityId: targetIdentity.id }]);
    await expect(getIdentityIds(ctx.database, [sourceIdentity.id])).resolves.toEqual([{ id: sourceIdentity.id }]);
  });

  it('mints an identity for a scoped merge origin that has none', async () => {
    const { ctx, sut } = setup();
    const { user: actor } = await ctx.newUser();
    const target = await createPersonProfile(ctx, { ownerId: actor.id, identityId: null, name: 'Legacy target' });
    const source = await createPersonProfile(ctx, { ownerId: actor.id, identityId: null, name: 'Legacy source' });

    await expect(
      sut.mergeScopedProfiles(factory.auth({ user: actor }), {
        target: { type: 'person', id: target.personGroupId },
        sources: [{ type: 'person', id: source.personGroupId }],
      }),
    ).resolves.toBeUndefined();

    const people = await getPeople(ctx.database, [target.personGroupId, source.personGroupId]);
    expect(people).toHaveLength(1);
    expect(people[0].id).toBe(target.personGroupId);
    expect(people[0].identityId).not.toBeNull();
  });

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

    await expect(sut.mergePersonalPeople(factory.auth({ user }), target.personGroupId, [sourceA.personGroupId, sourceB.personGroupId])).rejects.toThrow(
      'profile merge failed',
    );

    await expect(getPeople(ctx.database, [target.personGroupId, sourceA.personGroupId, sourceB.personGroupId])).resolves.toEqual(
      expect.arrayContaining([
        { id: target.personGroupId, identityId: null },
        { id: sourceA.personGroupId, identityId: null },
        { id: sourceB.personGroupId, identityId: null },
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

    await expect(sut.mergePersonalPeople(factory.auth({ user }), target.personGroupId, [source.personGroupId])).resolves.toEqual([
      { id: source.personGroupId, success: true },
    ]);

    const people = await getPeople(ctx.database, [target.personGroupId, source.personGroupId]);
    expect(people).toEqual([{ id: target.personGroupId, identityId: targetIdentity.id }]);
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
      sut.mergeSpacePeople(factory.auth({ user }), space.id, target.id, [source.id], ALLOW_MERGE),
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

    await sut.mergePersonalPeople(factory.auth({ user }), target.personGroupId, [source.personGroupId]);

    const faceLink = await ctx.database
      .selectFrom('face_identity_face')
      .select(['assetFaceId', 'identityId', 'source'])
      .where('assetFaceId', '=', orphanedSourceFace.id)
      .executeTakeFirstOrThrow();
    expect(faceLink).toEqual({ assetFaceId: orphanedSourceFace.id, identityId: targetIdentity.id, source: 'manual' });
  });

  // Slice 4 / R1 (signed off): a human people-merge re-points identity but must PRESERVE each rode-along
  // face's prior source — never fabricate 'manual' placements on faces a human never touched. This is the
  // "omit source from the write" mechanism (mergeIdentitiesAfterProfileResolution's repo write, and
  // linkPersonFaces's preserveSource branch for the target person's own re-affirmed faces) — NOT the
  // preserve-manual CASE used at the automatic-merge/replace/backfill sites in
  // face-identity.manual-durability.spec.ts. A `CASE ... ELSE input.source` here would degenerate to
  // `ELSE 'manual'` (input.source is always the literal 'manual' on this path) and silently reproduce the bug.
  it("preserves each rode-along face's prior source on a people merge (Slice 4 / R1)", async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const targetIdentity = await createIdentity(ctx.database);
    const sourceIdentity = await createIdentity(ctx.database);
    const target = await createPersonProfile(ctx, { ownerId: user.id, identityId: targetIdentity.id, name: 'Target' });
    const source = await createPersonProfile(ctx, { ownerId: user.id, identityId: sourceIdentity.id, name: 'Source' });

    // Assigned to the source person: moved onto target by mergePersonProfile, then re-keyed by the
    // linkPersonFaces(preserveSource: true) call — exercises the SERVICE-level fix.
    const mlFace = await createIdentityLinkedFace(ctx, {
      ownerId: user.id,
      identityId: sourceIdentity.id,
      personId: source.personGroupId,
      source: 'ml',
    });
    const manualFace = await createIdentityLinkedFace(ctx, {
      ownerId: user.id,
      identityId: sourceIdentity.id,
      personId: source.personGroupId,
      source: 'manual',
    });
    // Not assigned to any person (identity-only evidence): only reachable via
    // mergeIdentitiesAfterProfileResolution's blanket identityId update — exercises the REPO-level fix.
    const ownerPersonFace = await createIdentityLinkedFace(ctx, {
      ownerId: user.id,
      identityId: sourceIdentity.id,
      personId: null,
      source: 'owner-person',
    });

    await sut.mergePersonalPeople(factory.auth({ user }), target.personGroupId, [source.personGroupId]);

    const faceLinks = await ctx.database
      .selectFrom('face_identity_face')
      .select(['assetFaceId', 'identityId', 'source'])
      .where('assetFaceId', 'in', [mlFace.id, manualFace.id, ownerPersonFace.id])
      .execute();
    const bySource = new Map(faceLinks.map((row) => [row.assetFaceId, row]));

    // Every face is re-keyed onto the surviving identity...
    expect(bySource.get(mlFace.id)?.identityId).toBe(targetIdentity.id);
    expect(bySource.get(manualFace.id)?.identityId).toBe(targetIdentity.id);
    expect(bySource.get(ownerPersonFace.id)?.identityId).toBe(targetIdentity.id);
    // ...but the merge does NOT fabricate 'manual' placements: each face's prior source survives untouched.
    expect(bySource.get(mlFace.id)?.source).toBe('ml');
    expect(bySource.get(manualFace.id)?.source).toBe('manual');
    expect(bySource.get(ownerPersonFace.id)?.source).toBe('owner-person');
  });

  it('propagates a personal merge across other owners and all affected spaces', async () => {
    const { ctx, sut } = setup();
    const jobRepository = ctx.getMock(JobRepository);
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
      sut.mergePersonalPeople(factory.auth({ user: actor }), actorTarget.personGroupId, [actorSource.personGroupId], ALLOW_MERGE),
    ).resolves.toEqual([{ id: actorSource.personGroupId, success: true }]);

    await expect(
      getPeople(ctx.database, [actorTarget.personGroupId, actorSource.personGroupId, otherTarget.personGroupId, otherSource.personGroupId]),
    ).resolves.toEqual(
      [
        { id: actorTarget.personGroupId, identityId: targetIdentity.id },
        { id: otherTarget.personGroupId, identityId: targetIdentity.id },
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
    const jobRepository = ctx.getMock(JobRepository);
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
      sut.mergeSpacePeople(
        factory.auth({ user: actor }),
        initiatingSpace.id,
        initiatingTarget.id,
        [initiatingSource.id],
        ALLOW_MERGE,
      ),
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
      getPeople(ctx.database, [otherOwnerTarget.personGroupId, otherOwnerSource.personGroupId, singletonOwnerSource.personGroupId]),
    ).resolves.toEqual(
      [
        { id: otherOwnerTarget.personGroupId, identityId: targetIdentity.id },
        { id: singletonOwnerSource.personGroupId, identityId: targetIdentity.id },
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
        sut.mergePersonalPeople(factory.auth({ user }), target.personGroupId, [source.personGroupId]),
        sut.mergePersonalPeople(factory.auth({ user }), target.personGroupId, [source.personGroupId]),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(fulfilled[0]).toEqual({ status: 'fulfilled', value: [{ id: source.personGroupId, success: true }] });
      expect(rejected[0]).toMatchObject({
        status: 'rejected',
        reason: expect.any(Error),
      });
      await expect(getPeople(ctx.database, [target.personGroupId, source.personGroupId])).resolves.toEqual([
        { id: target.personGroupId, identityId: targetIdentity.id },
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
      const { promise: firstCanFinish, resolve: releaseFirst } = Promise.withResolvers<void>();
      const { promise: firstLockReached, resolve: firstLocked } = Promise.withResolvers<void>();
      let heldFirst = false;
      vi.spyOn(personRepository, 'lockPeopleForMerge').mockImplementation(async (personIds, transaction) => {
        await originalLock(personIds, transaction);
        if (!heldFirst && personIds.includes(personA.personGroupId) && personIds.includes(personB.personGroupId)) {
          heldFirst = true;
          firstLocked();
          await firstCanFinish;
        }
      });

      const first = sut.mergePersonalPeople(factory.auth({ user }), personA.personGroupId, [personB.personGroupId]);
      await firstLockReached;
      const second = sut.mergePersonalPeople(factory.auth({ user }), personB.personGroupId, [personC.personGroupId]);
      await new Promise((resolve) => setTimeout(resolve, 25));
      releaseFirst();

      const results = await Promise.allSettled([first, second]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      await expect(getPeople(ctx.database, [personA.personGroupId, personB.personGroupId, personC.personGroupId])).resolves.toEqual(
        expect.arrayContaining([
          { id: personA.personGroupId, identityId: identityA.id },
          { id: personC.personGroupId, identityId: identityC.id },
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
      const { promise: firstCanFinish, resolve: releaseFirst } = Promise.withResolvers<void>();
      const { promise: firstLockReached, resolve: firstLocked } = Promise.withResolvers<void>();
      let heldFirst = false;
      vi.spyOn(personRepository, 'lockPeopleForMerge').mockImplementation(async (personIds, transaction) => {
        await originalLock(personIds, transaction);
        if (!heldFirst && personIds.includes(personA.personGroupId) && personIds.includes(personB.personGroupId)) {
          heldFirst = true;
          firstLocked();
          await firstCanFinish;
        }
      });

      const first = sut.mergePersonalPeople(factory.auth({ user }), personA.personGroupId, [personB.personGroupId]);
      await firstLockReached;
      const second = sut.mergePersonalPeople(factory.auth({ user }), personB.personGroupId, [personA.personGroupId]);
      await new Promise((resolve) => setTimeout(resolve, 25));
      releaseFirst();

      const results = await Promise.allSettled([first, second]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const people = await getPeople(ctx.database, [personA.personGroupId, personB.personGroupId]);
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
        sut.mergeSpacePeople(factory.auth({ user }), space.id, target.id, [source.id], ALLOW_MERGE),
        sut.mergeSpacePeople(factory.auth({ user }), space.id, target.id, [source.id], ALLOW_MERGE),
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
      const { promise: firstCanFinish, resolve: releaseFirst } = Promise.withResolvers<void>();
      const { promise: firstLockReached, resolve: firstLocked } = Promise.withResolvers<void>();
      let heldFirst = false;
      vi.spyOn(sharedSpaceRepository, 'lockSpacePeopleForMerge').mockImplementation(async (personIds, transaction) => {
        await originalLock(personIds, transaction);
        if (!heldFirst && personIds.includes(personA.id) && personIds.includes(personB.id)) {
          heldFirst = true;
          firstLocked();
          await firstCanFinish;
        }
      });

      const first = sut.mergeSpacePeople(factory.auth({ user }), space.id, personA.id, [personB.id], ALLOW_MERGE);
      await firstLockReached;
      const second = sut.mergeSpacePeople(factory.auth({ user }), space.id, personB.id, [personC.id], ALLOW_MERGE);
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
      const { promise: firstCanFinish, resolve: releaseFirst } = Promise.withResolvers<void>();
      const { promise: firstLockReached, resolve: firstLocked } = Promise.withResolvers<void>();
      let heldFirst = false;
      vi.spyOn(sharedSpaceRepository, 'lockSpacePeopleForMerge').mockImplementation(async (personIds, transaction) => {
        await originalLock(personIds, transaction);
        if (!heldFirst && personIds.includes(personA.id) && personIds.includes(personB.id)) {
          heldFirst = true;
          firstLocked();
          await firstCanFinish;
        }
      });

      const first = sut.mergeSpacePeople(factory.auth({ user }), space.id, personA.id, [personB.id], ALLOW_MERGE);
      await firstLockReached;
      const second = sut.mergeSpacePeople(factory.auth({ user }), space.id, personB.id, [personA.id], ALLOW_MERGE);
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

    await expect(sut.mergePersonalPeople(factory.auth({ user }), target.personGroupId, [source.personGroupId], ALLOW_MERGE)).rejects.toThrow(
      'activity failed',
    );

    await expect(getPeople(ctx.database, [target.personGroupId, source.personGroupId])).resolves.toEqual(
      expect.arrayContaining([
        { id: target.personGroupId, identityId: targetIdentity.id },
        { id: source.personGroupId, identityId: sourceIdentity.id },
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

  // Coverage gap audit (#733 follow-up, plan §5.3/§7 Slice 6): the behaviours below were previously asserted
  // only against the in-memory mocked row store in identity-merge-propagation.service.spec.ts. These drive the
  // same entry points against a real Postgres database.

  // Matrix row T14 — blank-fill: a blank target field is filled from the source, but a target field that
  // already has a value is never overwritten by the source's.
  it('T14: fills a blank target name/birthDate from the source, but never overwrites a non-blank target field', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    // A blank target picks up the source's name and birth date.
    const blankTargetIdentity = await createIdentity(ctx.database);
    const namedSourceIdentity = await createIdentity(ctx.database);
    const blankTarget = await createPersonProfile(ctx, {
      ownerId: user.id,
      identityId: blankTargetIdentity.id,
      name: '',
      birthDate: null,
    });
    const namedSource = await createPersonProfile(ctx, {
      ownerId: user.id,
      identityId: namedSourceIdentity.id,
      name: 'Ada Lovelace',
      birthDate: '1990-01-01',
    });

    await sut.mergePersonalPeople(factory.auth({ user }), blankTarget.personGroupId, [namedSource.personGroupId]);

    const filled = await ctx.database
      .selectFrom('person')
      .select(['name', 'birthDate'])
      .where('personGroupId', '=', blankTarget.personGroupId)
      .executeTakeFirstOrThrow();
    expect(filled.name).toBe('Ada Lovelace');
    expect(asDateString(filled.birthDate)).toBe('1990-01-01');

    // A target that already has a name/birthDate keeps them — the source's values are never applied.
    const namedTargetIdentity = await createIdentity(ctx.database);
    const otherSourceIdentity = await createIdentity(ctx.database);
    const namedTarget = await createPersonProfile(ctx, {
      ownerId: user.id,
      identityId: namedTargetIdentity.id,
      name: 'Original Name',
      birthDate: '1975-05-05',
    });
    const otherSource = await createPersonProfile(ctx, {
      ownerId: user.id,
      identityId: otherSourceIdentity.id,
      name: 'Should Not Apply',
      birthDate: '2000-12-12',
    });

    await sut.mergePersonalPeople(factory.auth({ user }), namedTarget.personGroupId, [otherSource.personGroupId]);

    const kept = await ctx.database
      .selectFrom('person')
      .select(['name', 'birthDate'])
      .where('personGroupId', '=', namedTarget.personGroupId)
      .executeTakeFirstOrThrow();
    expect(kept.name).toBe('Original Name');
    expect(asDateString(kept.birthDate)).toBe('1975-05-05');
  });

  // Matrix row T13 — the survivor always keeps the TARGET's isHidden/isFavorite, regardless of the source's.
  it('T13: the survivor keeps the target isHidden/isFavorite flags, never the source', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    // A visible, non-favorite target merged with a hidden, favorite source stays visible/non-favorite.
    const visibleTargetIdentity = await createIdentity(ctx.database);
    const hiddenSourceIdentity = await createIdentity(ctx.database);
    const visibleTarget = await createPersonProfile(ctx, {
      ownerId: user.id,
      identityId: visibleTargetIdentity.id,
      name: 'Visible Target',
      isHidden: false,
      isFavorite: false,
    });
    const hiddenSource = await createPersonProfile(ctx, {
      ownerId: user.id,
      identityId: hiddenSourceIdentity.id,
      name: 'Hidden Source',
      isHidden: true,
      isFavorite: true,
    });

    await sut.mergePersonalPeople(factory.auth({ user }), visibleTarget.personGroupId, [hiddenSource.personGroupId]);

    await expect(
      ctx.database
        .selectFrom('person')
        .select(['isHidden', 'isFavorite'])
        .where('personGroupId', '=', visibleTarget.personGroupId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ isHidden: false, isFavorite: false });

    // A hidden, favorite target merged with a visible, non-favorite source stays hidden/favorite.
    const hiddenTargetIdentity = await createIdentity(ctx.database);
    const visibleSourceIdentity = await createIdentity(ctx.database);
    const hiddenTarget = await createPersonProfile(ctx, {
      ownerId: user.id,
      identityId: hiddenTargetIdentity.id,
      name: 'Hidden Target',
      isHidden: true,
      isFavorite: true,
    });
    const visibleSource = await createPersonProfile(ctx, {
      ownerId: user.id,
      identityId: visibleSourceIdentity.id,
      name: 'Visible Source',
      isHidden: false,
      isFavorite: false,
    });

    await sut.mergePersonalPeople(factory.auth({ user }), hiddenTarget.personGroupId, [visibleSource.personGroupId]);

    await expect(
      ctx.database
        .selectFrom('person')
        .select(['isHidden', 'isFavorite'])
        .where('personGroupId', '=', hiddenTarget.personGroupId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ isHidden: true, isFavorite: true });
  });

  // Space alias migration: a per-user alias on the losing shared_space_person survives on the winner, and the
  // winner's own alias for that same user is never clobbered by the loser's.
  it('migrates per-user shared-space aliases from the loser to the winner without clobbering the winner’s own alias', async () => {
    const { ctx, sut } = setup();
    const { user: actor } = await ctx.newUser();
    const { user: loserOnlyAliasUser } = await ctx.newUser();
    const { user: winnerOnlyAliasUser } = await ctx.newUser();
    const { user: bothAliasUser } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: actor.id });
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

    await ctx.database
      .insertInto('shared_space_person_alias')
      .values([
        { personId: source.id, userId: loserOnlyAliasUser.id, alias: 'Loser-only alias' },
        { personId: target.id, userId: winnerOnlyAliasUser.id, alias: 'Winner-only alias' },
        { personId: target.id, userId: bothAliasUser.id, alias: 'Winner keeps this' },
        { personId: source.id, userId: bothAliasUser.id, alias: 'Loser must not win' },
      ])
      .execute();

    await sut.mergeSpacePeople(factory.auth({ user: actor }), space.id, target.id, [source.id], ALLOW_MERGE);

    const survivingAliases = await ctx.database
      .selectFrom('shared_space_person_alias')
      .select(['personId', 'userId', 'alias'])
      .where('personId', 'in', [target.id, source.id])
      .orderBy('userId')
      .execute();

    expect(survivingAliases).toEqual(
      [
        { personId: target.id, userId: loserOnlyAliasUser.id, alias: 'Loser-only alias' },
        { personId: target.id, userId: winnerOnlyAliasUser.id, alias: 'Winner-only alias' },
        { personId: target.id, userId: bothAliasUser.id, alias: 'Winner keeps this' },
      ].toSorted((a, b) => a.userId.localeCompare(b.userId)),
    );
  });

  // Counts: after an in-space merge, the surviving shared_space_person's denormalised faceCount/assetCount
  // reflect a real recount rather than a naive sum of the pre-merge values.
  it('recounts the surviving shared-space person’s faceCount/assetCount after an in-space merge', async () => {
    const { ctx, sut } = setup();
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

    const { asset: targetAsset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: targetFace } = await ctx.newAssetFace({ assetId: targetAsset.id });
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: target.id, assetFaceId: targetFace.id })
      .execute();

    // Two faces from the SAME asset on the source: faceCount and assetCount diverge after the merge, which
    // rules out a test that would pass with a naive "sum the old counts" implementation.
    const { asset: sourceAsset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: sourceFaceOne } = await ctx.newAssetFace({ assetId: sourceAsset.id });
    const { assetFace: sourceFaceTwo } = await ctx.newAssetFace({ assetId: sourceAsset.id });
    await ctx.database
      .insertInto('shared_space_person_face')
      .values([
        { personId: source.id, assetFaceId: sourceFaceOne.id },
        { personId: source.id, assetFaceId: sourceFaceTwo.id },
      ])
      .execute();

    // The faces were inserted directly, bypassing recount, so the stored counts start at their column default.
    await expect(
      ctx.database
        .selectFrom('shared_space_person')
        .select(['faceCount', 'assetCount'])
        .where('id', '=', target.id)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ faceCount: 0, assetCount: 0 });

    await sut.mergeSpacePeople(factory.auth({ user }), space.id, target.id, [source.id], ALLOW_MERGE);

    await expect(
      ctx.database
        .selectFrom('shared_space_person')
        .select(['faceCount', 'assetCount'])
        .where('id', '=', target.id)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ faceCount: 3, assetCount: 2 });
  });

  // Multi-source: 3+ sources collapsed in ONE personal-merge call, and every source row is gone afterwards.
  it('collapses 3+ sources in a single personal merge call, deleting every source person and identity', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const targetIdentity = await createIdentity(ctx.database);
    const sourceIdentityA = await createIdentity(ctx.database);
    const sourceIdentityB = await createIdentity(ctx.database);
    const sourceIdentityC = await createIdentity(ctx.database);
    const target = await createPersonProfile(ctx, { ownerId: user.id, identityId: targetIdentity.id, name: 'Target' });
    const sourceA = await createPersonProfile(ctx, {
      ownerId: user.id,
      identityId: sourceIdentityA.id,
      name: 'Source A',
    });
    const sourceB = await createPersonProfile(ctx, {
      ownerId: user.id,
      identityId: sourceIdentityB.id,
      name: 'Source B',
    });
    const sourceC = await createPersonProfile(ctx, {
      ownerId: user.id,
      identityId: sourceIdentityC.id,
      name: 'Source C',
    });

    await expect(
      sut.mergePersonalPeople(factory.auth({ user }), target.personGroupId, [sourceA.personGroupId, sourceB.personGroupId, sourceC.personGroupId]),
    ).resolves.toEqual([
      { id: sourceA.personGroupId, success: true },
      { id: sourceB.personGroupId, success: true },
      { id: sourceC.personGroupId, success: true },
    ]);

    await expect(getPeople(ctx.database, [target.personGroupId, sourceA.personGroupId, sourceB.personGroupId, sourceC.personGroupId])).resolves.toEqual([
      { id: target.personGroupId, identityId: targetIdentity.id },
    ]);
    await expect(
      getIdentityIds(ctx.database, [sourceIdentityA.id, sourceIdentityB.id, sourceIdentityC.id]),
    ).resolves.toEqual([]);
  });

  // Idempotency (§5.2 row 5): naming a source ref whose profile is ALREADY on the target's identity is a
  // harmless no-op — nothing is merged, nothing is deleted, and no exception is thrown.
  it('is a harmless no-op when a scoped source ref already carries the target identity', async () => {
    const { ctx, sut } = setup();
    const { user: actor } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: actor.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: actor.id, role: SharedSpaceRole.Owner });
    const identity = await createIdentity(ctx.database);
    const target = await createPersonProfile(ctx, {
      ownerId: actor.id,
      identityId: identity.id,
      name: 'Already Merged',
    });
    const alreadyFusedSpacePerson = await createSpacePerson(ctx.database, {
      spaceId: space.id,
      identityId: identity.id,
      name: 'Already Fused',
    });

    await expect(
      sut.mergeScopedProfiles(factory.auth({ user: actor }), {
        target: { type: 'person', id: target.personGroupId },
        sources: [{ type: 'space-person', id: alreadyFusedSpacePerson.id, spaceId: space.id }],
      }),
    ).resolves.toBeUndefined();

    await expect(getPeople(ctx.database, [target.personGroupId])).resolves.toEqual([{ id: target.personGroupId, identityId: identity.id }]);
    await expect(getSpacePeople(ctx.database, [alreadyFusedSpacePerson.id])).resolves.toEqual([
      { id: alreadyFusedSpacePerson.id, identityId: identity.id },
    ]);
    await expect(getIdentityIds(ctx.database, [identity.id])).resolves.toEqual([{ id: identity.id }]);
  });

  // Degenerate identity (§5.1): a person with zero faces at all merges cleanly and the source row is deleted.
  it('merges a person with zero faces, deleting the source row and its identity', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const targetIdentity = await createIdentity(ctx.database);
    const sourceIdentity = await createIdentity(ctx.database);
    const target = await createPersonProfile(ctx, { ownerId: user.id, identityId: targetIdentity.id, name: 'Target' });
    const source = await createPersonProfile(ctx, {
      ownerId: user.id,
      identityId: sourceIdentity.id,
      name: 'Zero Face Source',
    });

    await expect(sut.mergePersonalPeople(factory.auth({ user }), target.personGroupId, [source.personGroupId])).resolves.toEqual([
      { id: source.personGroupId, success: true },
    ]);

    await expect(getPeople(ctx.database, [target.personGroupId, source.personGroupId])).resolves.toEqual([
      { id: target.personGroupId, identityId: targetIdentity.id },
    ]);
    await expect(getIdentityIds(ctx.database, [sourceIdentity.id])).resolves.toEqual([]);
  });

  // Feature-face repair (T15): when the merge invalidates the target's faceAssetId (here: the target has none
  // at all), the survivor's faceAssetId is repaired from a reassigned face and a thumbnail job is queued.
  it('repairs the target faceAssetId when the merge invalidates it', async () => {
    const { ctx, sut } = setup();
    const jobRepository = ctx.getMock(JobRepository);
    const { user } = await ctx.newUser();
    const targetIdentity = await createIdentity(ctx.database);
    const sourceIdentity = await createIdentity(ctx.database);
    const target = await createPersonProfile(ctx, { ownerId: user.id, identityId: targetIdentity.id, name: 'Target' });
    const source = await createPersonProfile(ctx, { ownerId: user.id, identityId: sourceIdentity.id, name: 'Source' });
    const sourceFace = await createIdentityLinkedFace(ctx, {
      ownerId: user.id,
      identityId: sourceIdentity.id,
      personId: source.personGroupId,
    });

    await expect(
      ctx.database.selectFrom('person').select('faceAssetId').where('personGroupId', '=', target.personGroupId).executeTakeFirstOrThrow(),
    ).resolves.toEqual({ faceAssetId: null });

    await sut.mergePersonalPeople(factory.auth({ user }), target.personGroupId, [source.personGroupId]);

    await expect(
      ctx.database.selectFrom('person').select('faceAssetId').where('personGroupId', '=', target.personGroupId).executeTakeFirstOrThrow(),
    ).resolves.toEqual({ faceAssetId: sourceFace.id });
    expect(jobRepository.queue).toHaveBeenCalledWith({
      name: JobName.PersonGenerateThumbnail,
      data: { id: target.personGroupId },
    });
  });
});
