import { Kysely } from 'kysely';
import { SharedSpaceRole, SourceType } from 'src/enum';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { IdentityMergePropagationService, MergeAuthorizer } from 'src/services/identity-merge-propagation.service';
import {
  rekeyVerdictIdentity,
  retargetVerdictPersonId,
  retargetVerdictSpacePersonId,
} from 'src/utils/face-verdict-merge';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

// The engine fails closed on a destructive plan (a same-space collapse) unless an authorizer ran (#733 review
// L3). The space fixtures below always merge within one space with an Editor actor, so the collapse is never
// actually unrepairable — this permissive authorizer is passed purely to match the production call sites,
// which always supply one; RBAC policy itself is covered elsewhere (merge-policy.spec.ts).
const ALLOW_MERGE: MergeAuthorizer = () => Promise.resolve();

let defaultDatabase: Kysely<DB>;

const setup = (db: Kysely<DB> = defaultDatabase) => {
  const { ctx } = newMediumService(BaseService, {
    database: db,
    real: [
      DatabaseRepository,
      FaceIdentityRepository,
      PersonRepository,
      SharedSpaceRepository,
      FacePersonVerdictRepository,
    ],
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
  return {
    ctx,
    sut,
    faceIdentityRepository: ctx.get(FaceIdentityRepository),
    facePersonVerdictRepository: ctx.get(FacePersonVerdictRepository),
  };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const seedFace = async (ctx: Awaited<ReturnType<typeof setup>>['ctx'], ownerId: string) => {
  const { asset } = await ctx.newAsset({ ownerId });
  const { assetFace } = await ctx.newAssetFace({
    assetId: asset.id,
    personId: null,
    sourceType: SourceType.MachineLearning,
  });
  return assetFace.id;
};

const verdictRow = (assetFaceId: string) =>
  defaultDatabase
    .selectFrom('face_person_verdict')
    .select(['id', 'personId', 'spacePersonId', 'identityId', 'status', 'source', 'actorId', 'distance'])
    .where('assetFaceId', '=', assetFaceId)
    .execute();

// Shared band for every getPendingForPerson/getPendingForSpacePerson probe below: every fixture in this file
// that seeds a "still pending" row uses distance 0.4, which must land strictly inside (maxDistance,
// suggestionMaxDistance].
const PENDING_OPTS = { maxDistance: 0.3, suggestionMaxDistance: 0.8, page: 1, size: 10 };

const newSpacePerson = (spaceId: string, name: string) =>
  defaultDatabase
    .insertInto('shared_space_person')
    .values({ spaceId, name, type: 'person' })
    .returningAll()
    .executeTakeFirstOrThrow();

/**
 * Space twin of {@link seedFace}: an editor-owned shared space with a space-reachable asset+face, and Bob/Robert
 * as two space-people in that space. Mirrors the fixture patterns in shared-space-face-suggestions.service.spec.ts
 * (`createSuggestionFixture`) and face-person-verdict.repository.spec.ts's space-person suggestion methods block.
 */
const seedSpaceMergeFixture = async (ctx: Awaited<ReturnType<typeof setup>>['ctx']) => {
  const { user: owner } = await ctx.newUser();
  const { user: editor } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: SharedSpaceRole.Editor });
  const { asset } = await ctx.newAsset({ ownerId: owner.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });
  const { assetFace } = await ctx.newAssetFace({
    assetId: asset.id,
    personId: null,
    sourceType: SourceType.MachineLearning,
  });
  const bob = await newSpacePerson(space.id, 'Bob');
  const robert = await newSpacePerson(space.id, 'Robert');
  return { editor, space, faceId: assetFace.id, bob, robert };
};

describe('face verdict merge durability (D1)', () => {
  it('keep-here verdict survives Bob→Robert person merge, re-keyed to the survivor identity', async () => {
    const { ctx, sut, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: robert } = await ctx.newPerson({ ownerId: user.id, name: 'Robert' });
    const faceId = await seedFace(ctx, user.id);
    const bobIdentity = await faceIdentityRepository.ensurePersonIdentity(bob.id);
    const robertIdentity = await faceIdentityRepository.ensurePersonIdentity(robert.id);
    // cleanup keep-here: (F, Bob, I(Bob), rejected, cleanup)
    await facePersonVerdictRepository.markRejected(bob.id, faceId, {
      identityId: bobIdentity.id,
      source: 'cleanup',
      actorId: user.id,
    });

    await sut.mergePersonalPeople(factory.auth({ user }), robert.id, [bob.id]);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'rejected', personId: robert.id, identityId: robertIdentity.id });
    // honoured identity-first by the shared read
    const tokens = await facePersonVerdictRepository.getNegativeVerdictTokens([faceId]);
    expect([...(tokens.get(faceId) ?? [])]).toContain(`identity:${robertIdentity.id}`);
  });

  it('identity-null suggestion reject survives the merge via personId re-target', async () => {
    const { ctx, sut, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: robert } = await ctx.newPerson({ ownerId: user.id, name: 'Robert' });
    const faceId = await seedFace(ctx, user.id);
    await faceIdentityRepository.ensurePersonIdentity(robert.id);
    // suggestion reject as it is written TODAY (pre-Slice-2): no identity, personId only.
    await facePersonVerdictRepository.markRejected(bob.id, faceId);

    await sut.mergePersonalPeople(factory.auth({ user }), robert.id, [bob.id]);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'rejected', personId: robert.id });
  });

  it('identity-only merge re-keys the verdict instead of destroying it', async () => {
    const { ctx, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const faceId = await seedFace(ctx, user.id);
    const bobIdentity = await faceIdentityRepository.ensurePersonIdentity(bob.id);
    const target = await defaultDatabase
      .insertInto('face_identity')
      .values({ type: 'person' })
      .returningAll()
      .executeTakeFirstOrThrow();
    await facePersonVerdictRepository.markRejected(bob.id, faceId, {
      identityId: bobIdentity.id,
      source: 'cleanup',
      actorId: user.id,
    });

    // 'manual' source merges all sources without the embedding-consistency filter, exercising the
    // identical re-key statement; the shared-space-evidence production path is covered above.
    await faceIdentityRepository.mergeIdentities({
      targetIdentityId: target.id,
      sourceIdentityIds: [bobIdentity.id],
      source: 'manual',
    });

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1);
    expect(rows[0].identityId).toBe(target.id);
    expect(rows[0].status).toBe('rejected');
  });

  // The next two are survivor-wins collision-handling locks (not D1 reproductions): the source row's CASCADE
  // at red masks the bug, so they guard against a naive UPDATE-only retarget rather than reproducing D1.
  it('survivor wins on collision: source verdict dropped, survivor untouched', async () => {
    const { ctx, sut, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: robert } = await ctx.newPerson({ ownerId: user.id, name: 'Robert' });
    const faceId = await seedFace(ctx, user.id);
    const bobIdentity = await faceIdentityRepository.ensurePersonIdentity(bob.id);
    const robertIdentity = await faceIdentityRepository.ensurePersonIdentity(robert.id);
    // Bob IGNORED F, Robert (survivor) REJECTED F. Distinct statuses prove which row survives.
    await facePersonVerdictRepository.markIgnored(bob.id, faceId, {
      identityId: bobIdentity.id,
      source: 'suggestion',
      actorId: user.id,
    });
    await facePersonVerdictRepository.markRejected(robert.id, faceId, {
      identityId: robertIdentity.id,
      source: 'cleanup',
      actorId: user.id,
    });

    await sut.mergePersonalPeople(factory.auth({ user }), robert.id, [bob.id]);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1); // no unique-violation, source row dropped
    // Survivor's row kept untouched: it is Robert's REJECTED row, not Bob's ignored one.
    expect(rows[0]).toMatchObject({ personId: robert.id, identityId: robertIdentity.id, status: 'rejected' });
  });

  it('survivor wins on collision when the survivor holds the negative', async () => {
    const { ctx, sut, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: robert } = await ctx.newPerson({ ownerId: user.id, name: 'Robert' });
    const faceId = await seedFace(ctx, user.id);
    const bobIdentity = await faceIdentityRepository.ensurePersonIdentity(bob.id);
    const robertIdentity = await faceIdentityRepository.ensurePersonIdentity(robert.id);
    // Source (Bob) pending suggestion, survivor (Robert) already rejected — survivor's row wins regardless of status.
    await defaultDatabase
      .insertInto('face_person_verdict')
      .values({ personId: bob.id, assetFaceId: faceId, identityId: bobIdentity.id, status: 'pending', distance: 0.4 })
      .execute();
    await facePersonVerdictRepository.markRejected(robert.id, faceId, {
      identityId: robertIdentity.id,
      source: 'cleanup',
      actorId: user.id,
    });

    await sut.mergePersonalPeople(factory.auth({ user }), robert.id, [bob.id]);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ personId: robert.id, identityId: robertIdentity.id, status: 'rejected' });
  });

  // The dangerous inverse of the case above, and a live defect (Slice 6's red test — do not fix here): source
  // (Bob) holds a human REJECTED verdict, survivor (Robert) only holds a machine PENDING suggestion. The
  // collision delete in face-verdict-merge.ts's retargetVerdictPersonId has no status filter, so today it
  // drops the SOURCE row unconditionally and keeps the survivor's row — meaning the human's rejection is
  // discarded and the machine's mere suggestion survives the merge. This test pins the CORRECT behaviour
  // (the negative must win regardless of which side holds it) and is expected to fail until that's fixed.
  it('a source negative outranks a survivor pending row', async () => {
    const { ctx, sut, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: robert } = await ctx.newPerson({ ownerId: user.id, name: 'Robert' });
    const faceId = await seedFace(ctx, user.id);
    const bobIdentity = await faceIdentityRepository.ensurePersonIdentity(bob.id);
    const robertIdentity = await faceIdentityRepository.ensurePersonIdentity(robert.id);
    // Source (Bob) REJECTED F — a human decision. Survivor (Robert) only has a PENDING suggestion.
    await facePersonVerdictRepository.markRejected(bob.id, faceId, {
      identityId: bobIdentity.id,
      source: 'cleanup',
      actorId: user.id,
    });
    await defaultDatabase
      .insertInto('face_person_verdict')
      .values({
        personId: robert.id,
        assetFaceId: faceId,
        identityId: robertIdentity.id,
        status: 'pending',
        distance: 0.4,
      })
      .execute();
    // Positive control: an unrelated face G with a plain pending suggestion for Robert, untouched by the
    // merge. If getPendingForPerson ever came back empty because of a fixture/gate mistake rather than the
    // promotion logic under test, this assertion is what would catch it.
    const controlFaceId = await seedFace(ctx, user.id);
    await facePersonVerdictRepository.upsertPending([
      { personId: robert.id, assetFaceId: controlFaceId, distance: 0.4 },
    ]);

    await sut.mergePersonalPeople(factory.auth({ user }), robert.id, [bob.id]);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ personId: robert.id, status: 'rejected' });

    const pending = await facePersonVerdictRepository.getPendingForPerson(robert.id, PENDING_OPTS);
    const pendingFaceIds = pending.items.map((item) => item.assetFaceId);
    expect(pendingFaceIds).not.toContain(faceId); // F is not re-proposed to the human who rejected it
    expect(pendingFaceIds).toContain(controlFaceId); // control: an unrelated pending suggestion still surfaces
  });

  // S6.2-S6.10 exercise retargetVerdictPersonId directly rather than through sut.mergePersonalPeople: a full
  // merge also runs mergeIdentitiesAfterProfileResolution afterwards, which re-keys EVERY row that ends up on
  // the source's identity onto the target's — that follow-up step would normalize away the very
  // survivor-vs-source identityId distinctions S6.7/S6.8 exist to pin. Calling the util directly observes the
  // promotion in isolation, exactly as person.repository.ts's mergePersonProfile invokes it, before that
  // later re-key runs. S6.12 below tests the two steps together.
  it("S6.2: the promoted row carries the source verdict's source/actor and clears distance", async () => {
    const { ctx, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { user: actor } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: robert } = await ctx.newPerson({ ownerId: user.id, name: 'Robert' });
    const faceId = await seedFace(ctx, user.id);
    // Source (Bob) rejected with a distinctive source/actor. Survivor (Robert) is a plain pending suggestion
    // (upsertPending's real shape: source='suggestion', actorId=null, distance set).
    await facePersonVerdictRepository.markRejected(bob.id, faceId, { source: 'cleanup', actorId: actor.id });
    await facePersonVerdictRepository.upsertPending([{ personId: robert.id, assetFaceId: faceId, distance: 0.4 }]);

    await retargetVerdictPersonId(defaultDatabase, bob.id, robert.id);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1); // S6.10: exactly one row, no partial-unique-index violation
    expect(rows[0]).toMatchObject({
      personId: robert.id,
      status: 'rejected',
      source: 'cleanup',
      actorId: actor.id,
      distance: null,
    });
  });

  it('S6.3 (pin): a source pending row never overwrites a survivor rejected row', async () => {
    const { ctx, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: robert } = await ctx.newPerson({ ownerId: user.id, name: 'Robert' });
    const faceId = await seedFace(ctx, user.id);
    const robertIdentity = await faceIdentityRepository.ensurePersonIdentity(robert.id);
    await facePersonVerdictRepository.upsertPending([{ personId: bob.id, assetFaceId: faceId, distance: 0.4 }]);
    await facePersonVerdictRepository.markRejected(robert.id, faceId, {
      identityId: robertIdentity.id,
      source: 'cleanup',
      actorId: user.id,
    });

    await retargetVerdictPersonId(defaultDatabase, bob.id, robert.id);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1); // S6.10
    expect(rows[0]).toMatchObject({
      personId: robert.id,
      identityId: robertIdentity.id,
      status: 'rejected',
      source: 'cleanup',
    });
  });

  it('S6.4: a source ignored verdict promotes the survivor to ignored, not rejected', async () => {
    const { ctx, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: robert } = await ctx.newPerson({ ownerId: user.id, name: 'Robert' });
    const faceId = await seedFace(ctx, user.id);
    await facePersonVerdictRepository.markIgnored(bob.id, faceId, { source: 'suggestion', actorId: user.id });
    await facePersonVerdictRepository.upsertPending([{ personId: robert.id, assetFaceId: faceId, distance: 0.4 }]);

    await retargetVerdictPersonId(defaultDatabase, bob.id, robert.id);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1); // S6.10
    expect(rows[0]).toMatchObject({ personId: robert.id, status: 'ignored' });
  });

  it('S6.5: negative-vs-negative is not a promotion — a survivor ignored row beats a source rejected row', async () => {
    const { ctx, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: robert } = await ctx.newPerson({ ownerId: user.id, name: 'Robert' });
    const faceId = await seedFace(ctx, user.id);
    const bobIdentity = await faceIdentityRepository.ensurePersonIdentity(bob.id);
    const robertIdentity = await faceIdentityRepository.ensurePersonIdentity(robert.id);
    // Source (Bob) REJECTED, survivor (Robert) IGNORED — the mirror of the existing "ignored source, rejected
    // survivor" collision test. The promotion predicate only fires when the survivor is `pending`, so this
    // must leave the survivor's ignored row untouched regardless of which side holds which negative status.
    await facePersonVerdictRepository.markRejected(bob.id, faceId, {
      identityId: bobIdentity.id,
      source: 'cleanup',
      actorId: user.id,
    });
    await facePersonVerdictRepository.markIgnored(robert.id, faceId, {
      identityId: robertIdentity.id,
      source: 'suggestion',
      actorId: user.id,
    });

    await retargetVerdictPersonId(defaultDatabase, bob.id, robert.id);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1); // S6.10: no unique-violation, source row dropped
    expect(rows[0]).toMatchObject({
      personId: robert.id,
      identityId: robertIdentity.id,
      status: 'ignored',
      source: 'suggestion',
    });
  });

  it('S6.6 (pin): with no survivor row for the face, retarget just moves the source row', async () => {
    const { ctx, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: robert } = await ctx.newPerson({ ownerId: user.id, name: 'Robert' });
    const faceId = await seedFace(ctx, user.id);
    const bobIdentity = await faceIdentityRepository.ensurePersonIdentity(bob.id);
    await facePersonVerdictRepository.markRejected(bob.id, faceId, {
      identityId: bobIdentity.id,
      source: 'cleanup',
      actorId: user.id,
    });

    await retargetVerdictPersonId(defaultDatabase, bob.id, robert.id);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1); // S6.10
    expect(rows[0]).toMatchObject({
      personId: robert.id,
      identityId: bobIdentity.id,
      status: 'rejected',
      source: 'cleanup',
    });
  });

  it('S6.7: promotion keeps the survivor identity when the source verdict carries none', async () => {
    const { ctx, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: robert } = await ctx.newPerson({ ownerId: user.id, name: 'Robert' });
    const faceId = await seedFace(ctx, user.id);
    const robertIdentity = await faceIdentityRepository.ensurePersonIdentity(robert.id);
    // Source verdict written with no identity at all (bob has none), like a pre-identity suggestion reject.
    await facePersonVerdictRepository.markRejected(bob.id, faceId, { source: 'cleanup', actorId: user.id });
    // Survivor's pending row DOES carry an identity (mirrors a keep-here cleanup-sourced pending row).
    await facePersonVerdictRepository.upsertPending([{ personId: robert.id, assetFaceId: faceId, distance: 0.4 }]);
    await defaultDatabase
      .updateTable('face_person_verdict')
      .set({ identityId: robertIdentity.id })
      .where('personId', '=', robert.id)
      .where('assetFaceId', '=', faceId)
      .execute();

    await retargetVerdictPersonId(defaultDatabase, bob.id, robert.id);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1); // S6.10
    expect(rows[0]).toMatchObject({ personId: robert.id, status: 'rejected', identityId: robertIdentity.id });
  });

  it('S6.8: promotion adopts the source identity when the survivor pending row carries none', async () => {
    const { ctx, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: robert } = await ctx.newPerson({ ownerId: user.id, name: 'Robert' });
    const faceId = await seedFace(ctx, user.id);
    const bobIdentity = await faceIdentityRepository.ensurePersonIdentity(bob.id);
    await facePersonVerdictRepository.markRejected(bob.id, faceId, {
      identityId: bobIdentity.id,
      source: 'cleanup',
      actorId: user.id,
    });
    // Survivor's pending row carries no identity — upsertPending's real production shape.
    await facePersonVerdictRepository.upsertPending([{ personId: robert.id, assetFaceId: faceId, distance: 0.4 }]);

    await retargetVerdictPersonId(defaultDatabase, bob.id, robert.id);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1); // S6.10
    expect(rows[0]).toMatchObject({ personId: robert.id, status: 'rejected', identityId: bobIdentity.id });
  });

  it('S6.9: a three-way merge (two negative sources into one pending survivor) ends in exactly one negative row', async () => {
    const { ctx, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: carol } = await ctx.newPerson({ ownerId: user.id, name: 'Carol' });
    const { person: robert } = await ctx.newPerson({ ownerId: user.id, name: 'Robert' });
    const faceId = await seedFace(ctx, user.id);
    await facePersonVerdictRepository.markRejected(bob.id, faceId, { source: 'cleanup', actorId: user.id });
    await facePersonVerdictRepository.markIgnored(carol.id, faceId, { source: 'suggestion', actorId: user.id });
    await facePersonVerdictRepository.upsertPending([{ personId: robert.id, assetFaceId: faceId, distance: 0.4 }]);

    // Mirrors the production loop: person.repository.ts's mergePersonProfile — and therefore
    // retargetVerdictPersonId — runs once per source, sequentially, inside the same merge transaction.
    await retargetVerdictPersonId(defaultDatabase, bob.id, robert.id);
    await retargetVerdictPersonId(defaultDatabase, carol.id, robert.id);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1); // S6.10: no unique-index violation across two sequential retargets
    expect(rows[0].personId).toBe(robert.id);
    expect(['rejected', 'ignored']).toContain(rows[0].status);
  });

  it('S6.12 (pin): rekeyVerdictIdentity re-keys the promoted row onto the surviving identity', async () => {
    const { ctx, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: robert } = await ctx.newPerson({ ownerId: user.id, name: 'Robert' });
    const faceId = await seedFace(ctx, user.id);
    const bobIdentity = await faceIdentityRepository.ensurePersonIdentity(bob.id);
    const robertIdentity = await faceIdentityRepository.ensurePersonIdentity(robert.id);
    await facePersonVerdictRepository.markRejected(bob.id, faceId, {
      identityId: bobIdentity.id,
      source: 'cleanup',
      actorId: user.id,
    });
    // Survivor's pending row carries no identity of its own (upsertPending's real shape), so the promoted row
    // can only pick one up via the coalesce — which is what rekeyVerdictIdentity must then correct.
    await facePersonVerdictRepository.upsertPending([{ personId: robert.id, assetFaceId: faceId, distance: 0.4 }]);

    await retargetVerdictPersonId(defaultDatabase, bob.id, robert.id);
    // Sanity checkpoint: immediately after retarget and before any identity re-key, the promoted row is keyed
    // to BOB's identity (the coalesce's only option, since the survivor's own row carried none).
    const afterRetarget = await verdictRow(faceId);
    expect(afterRetarget).toHaveLength(1);
    expect(afterRetarget[0].identityId).toBe(bobIdentity.id);

    // Exactly what mergeIdentitiesAfterProfileResolution runs after every profile merge in the real pipeline.
    await rekeyVerdictIdentity(defaultDatabase, [bobIdentity.id], robertIdentity.id);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ personId: robert.id, status: 'rejected', identityId: robertIdentity.id });
  });

  it('GC (deleteUnreferencedIdentities) degrades an identity-only verdict to SET NULL, never deletes', async () => {
    const { ctx, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const faceId = await seedFace(ctx, user.id);
    const bobIdentity = await faceIdentityRepository.ensurePersonIdentity(bob.id);
    await facePersonVerdictRepository.markRejected(bob.id, faceId, {
      identityId: bobIdentity.id,
      source: 'cleanup',
      actorId: user.id,
    });
    // remove the person so only the verdict references the identity, then GC
    await defaultDatabase.deleteFrom('person').where('id', '=', bob.id).execute();
    await faceIdentityRepository.deleteUnreferencedIdentities();

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1); // NOT cascade-deleted
    expect(rows[0].identityId).toBeNull(); // SET NULL degrade
    expect(rows[0].status).toBe('rejected');
  });

  it('space verdict survives a space-person merge, re-targeted to the survivor', async () => {
    const { ctx, sut, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { editor, space, faceId, bob, robert } = await seedSpaceMergeFixture(ctx);
    const bobIdentity = await faceIdentityRepository.ensureSpacePersonIdentity(bob.id);
    const robertIdentity = await faceIdentityRepository.ensureSpacePersonIdentity(robert.id);
    // space-cleanup keep-here: (F, Bob, I(Bob), rejected, cleanup)
    await facePersonVerdictRepository.markRejectedForSpacePerson(bob.id, faceId, {
      identityId: bobIdentity.id,
      source: 'cleanup',
      actorId: editor.id,
    });

    await sut.mergeSpacePeople(factory.auth({ user: editor }), space.id, robert.id, [bob.id], ALLOW_MERGE);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'rejected', spacePersonId: robert.id, identityId: robertIdentity.id });
  });

  it('space collision: survivor wins, source row dropped (red-first)', async () => {
    const { ctx, sut, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { editor, space, faceId, bob, robert } = await seedSpaceMergeFixture(ctx);
    // Bob (source) has NO identity on its verdict row: an identity-null row is not touched by the identity-side
    // rekey/cascade, so if the retarget's survivor-wins delete is the thing that makes this pass, this test
    // is genuinely red without it — not accidentally green via a different removal path.
    await faceIdentityRepository.ensureSpacePersonIdentity(bob.id);
    const robertIdentity = await faceIdentityRepository.ensureSpacePersonIdentity(robert.id);
    await facePersonVerdictRepository.markRejectedForSpacePerson(bob.id, faceId);
    await facePersonVerdictRepository.markRejectedForSpacePerson(robert.id, faceId, {
      identityId: robertIdentity.id,
      source: 'cleanup',
      actorId: editor.id,
    });

    await sut.mergeSpacePeople(factory.auth({ user: editor }), space.id, robert.id, [bob.id], ALLOW_MERGE);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1); // no unique-violation, source row dropped
    expect(rows[0]).toMatchObject({ spacePersonId: robert.id, identityId: robertIdentity.id, status: 'rejected' });
  });

  // S6.11: the space twin of S6.1, S6.3 and S6.9, on retargetVerdictSpacePersonId directly — same rationale
  // as the personal-scope block above for calling the util directly rather than through sut.mergeSpacePeople.
  it('S6.11a (space twin of S6.1): a source negative outranks a survivor pending row, and getPendingForSpacePerson excludes it with a control', async () => {
    const { ctx, facePersonVerdictRepository } = setup();
    const { space, faceId, bob, robert } = await seedSpaceMergeFixture(ctx);
    await facePersonVerdictRepository.markRejectedForSpacePerson(bob.id, faceId, {
      source: 'cleanup',
      actorId: space.createdById,
    });
    await facePersonVerdictRepository.upsertPendingForSpacePerson([
      { spacePersonId: robert.id, assetFaceId: faceId, distance: 0.4 },
    ]);
    // Positive control: a second space-reachable face with a plain pending suggestion for Robert, untouched
    // by the retarget.
    const { asset: controlAsset } = await ctx.newAsset({ ownerId: space.createdById });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: controlAsset.id, addedById: space.createdById });
    const { assetFace: controlFace } = await ctx.newAssetFace({
      assetId: controlAsset.id,
      personId: null,
      sourceType: SourceType.MachineLearning,
    });
    await facePersonVerdictRepository.upsertPendingForSpacePerson([
      { spacePersonId: robert.id, assetFaceId: controlFace.id, distance: 0.4 },
    ]);

    await retargetVerdictSpacePersonId(defaultDatabase, bob.id, robert.id);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ spacePersonId: robert.id, status: 'rejected' });

    const pending = await facePersonVerdictRepository.getPendingForSpacePerson(space.id, robert.id, PENDING_OPTS);
    const pendingFaceIds = pending.items.map((item) => item.assetFaceId);
    expect(pendingFaceIds).not.toContain(faceId); // F is not re-proposed for the space person who rejected it
    expect(pendingFaceIds).toContain(controlFace.id); // control: an unrelated pending suggestion still surfaces
  });

  it('S6.11b (pin, space twin of S6.3): a source pending row never overwrites a survivor rejected row', async () => {
    const { ctx, facePersonVerdictRepository } = setup();
    const { space, faceId, bob, robert } = await seedSpaceMergeFixture(ctx);
    await facePersonVerdictRepository.upsertPendingForSpacePerson([
      { spacePersonId: bob.id, assetFaceId: faceId, distance: 0.4 },
    ]);
    await facePersonVerdictRepository.markRejectedForSpacePerson(robert.id, faceId, {
      source: 'cleanup',
      actorId: space.createdById,
    });

    await retargetVerdictSpacePersonId(defaultDatabase, bob.id, robert.id);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ spacePersonId: robert.id, status: 'rejected', source: 'cleanup' });
  });

  it('S6.11c (space twin of S6.9): a three-way merge into one pending survivor ends in exactly one negative row', async () => {
    const { ctx, facePersonVerdictRepository } = setup();
    const { space, faceId, bob, robert } = await seedSpaceMergeFixture(ctx);
    const carol = await newSpacePerson(space.id, 'Carol');
    await facePersonVerdictRepository.markRejectedForSpacePerson(bob.id, faceId, { source: 'cleanup' });
    await facePersonVerdictRepository.markIgnoredForSpacePerson(carol.id, faceId, { source: 'suggestion' });
    await facePersonVerdictRepository.upsertPendingForSpacePerson([
      { spacePersonId: robert.id, assetFaceId: faceId, distance: 0.4 },
    ]);

    await retargetVerdictSpacePersonId(defaultDatabase, bob.id, robert.id);
    await retargetVerdictSpacePersonId(defaultDatabase, carol.id, robert.id);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1); // no unique-index violation across two sequential retargets
    expect(rows[0].spacePersonId).toBe(robert.id);
    expect(['rejected', 'ignored']).toContain(rows[0].status);
  });
});
