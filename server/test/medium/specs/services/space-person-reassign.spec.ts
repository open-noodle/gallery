import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { AssetVisibility, JobName, SharedSpaceRole } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { SharedSpaceService } from 'src/services/shared-space.service';
import { newMediumService } from 'test/medium.factory';
import { factory, newEmbedding } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';
import { Mocked } from 'vitest';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const authFor = (user: { id: string; name: string; email: string; isAdmin?: boolean }) =>
  factory.auth({ user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin } });

const setupSharedSpace = (db?: Kysely<DB>) => {
  const { ctx, sut } = newMediumService(SharedSpaceService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AssetRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      PersonRepository,
      SearchRepository,
      SharedSpaceRepository,
      SystemMetadataRepository,
    ],
    mock: [JobRepository, LoggingRepository],
  });
  const jobs = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  jobs.queue.mockResolvedValue();
  jobs.queueAll.mockResolvedValue();
  jobs.hasInFlightDedupChain.mockResolvedValue(false);
  return { ctx, sut, faceIdentityRepository: ctx.get(FaceIdentityRepository), jobs };
};

// A face already recognized (owner-side) as a distinct global person, projected into a space. Standing
// in for "an existing photo whose face got matched to the wrong person" — the starting state #765 needs.
const createIdentityBackedFace = async (
  ctx: ReturnType<typeof setupSharedSpace>['ctx'],
  faceIdentityRepository: FaceIdentityRepository,
  input: { ownerId: string; personName: string; spaceId?: string; assetAdderId?: string },
) => {
  const { result: person } = await ctx.newPerson({ ownerId: input.ownerId, name: input.personName });
  const { asset } = await ctx.newAsset({ ownerId: input.ownerId, visibility: AssetVisibility.Timeline });
  if (input.spaceId) {
    await ctx.newSharedSpaceAsset({
      spaceId: input.spaceId,
      assetId: asset.id,
      addedById: input.assetAdderId ?? input.ownerId,
    });
  }
  const { result: faceId } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
  await ctx.database.insertInto('face_search').values({ faceId, embedding: newEmbedding() }).execute();
  const identity = await faceIdentityRepository.ensurePersonIdentity(person.id);
  await faceIdentityRepository.linkFace({ assetFaceId: faceId, identityId: identity.id, source: 'owner-person' });
  return { asset, faceId, identity, person };
};

// A second face joining an ALREADY-established identity/person — used so a space person keeps at least
// one correctly-matched face after the misassigned one is reassigned away (distinguishing "no longer
// shows THIS face" from "the person was emptied", which is asserted separately).
const addFaceToIdentity = async (
  ctx: ReturnType<typeof setupSharedSpace>['ctx'],
  faceIdentityRepository: FaceIdentityRepository,
  input: { ownerId: string; personId: string; identityId: string; spaceId?: string; assetAdderId?: string },
) => {
  const { asset } = await ctx.newAsset({ ownerId: input.ownerId, visibility: AssetVisibility.Timeline });
  if (input.spaceId) {
    await ctx.newSharedSpaceAsset({
      spaceId: input.spaceId,
      assetId: asset.id,
      addedById: input.assetAdderId ?? input.ownerId,
    });
  }
  const { result: faceId } = await ctx.newAssetFace({ assetId: asset.id, personId: input.personId });
  await ctx.database.insertInto('face_search').values({ faceId, embedding: newEmbedding() }).execute();
  await faceIdentityRepository.linkFace({ assetFaceId: faceId, identityId: input.identityId, source: 'owner-person' });
  return { asset, faceId };
};

const spacePersonFacesFor = (
  ctx: ReturnType<typeof setupSharedSpace>['ctx'],
  input: { spaceId: string; assetFaceId: string },
) =>
  ctx.database
    .selectFrom('shared_space_person_face')
    .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
    .select(['shared_space_person.id as personId', 'shared_space_person.identityId as identityId'])
    .where('shared_space_person_face.assetFaceId', '=', input.assetFaceId)
    .where('shared_space_person.spaceId', '=', input.spaceId)
    .execute();

const spacePersonsForIdentity = (
  ctx: ReturnType<typeof setupSharedSpace>['ctx'],
  input: { spaceId: string; identityId: string },
) =>
  ctx.database
    .selectFrom('shared_space_person')
    .select(['id', 'identityId'])
    .where('spaceId', '=', input.spaceId)
    .where('identityId', '=', input.identityId)
    .execute();

// A reassign only ever queues the targeted per-asset SharedSpaceFaceMatch job (never the *All/*Page
// rebuild jobs) — mirrors people-identity-rbac.spec.ts's drainReassignFaceMatchJobs. Deliberately does
// NOT drain SharedSpacePersonDedup/SharedSpaceIdentityReconciliation: those follow-ups could paper over
// a defect this suite exists to catch (e.g. silently merging away a wrongly-minted duplicate person).
const drainQueuedFaceMatchJobs = async (sharedSpaceService: SharedSpaceService, jobs: Mocked<JobRepository>) => {
  for (const [job] of jobs.queue.mock.calls) {
    if (job.name === JobName.SharedSpaceFaceMatch) {
      await sharedSpaceService.handleSharedSpaceFaceMatch(job.data);
    }
  }
};

// `owner` owns the misassigned face's asset; Editor performs the reassign on another member's asset (the
// literal #765 scenario); Viewer is present for the permission guard (AC3). `spaceCreator` is a SEPARATE
// user who creates the space and holds the Owner role — kept distinct from `owner` so ownership
// assertions (e.g. "the new person belongs to the asset's owner") can't pass vacuously just because the
// asset owner and the space creator/owner-role member happen to be the same person. With `retainedFace:
// true` the source space person keeps a second, correctly-matched face so it survives the reassign
// (distinguishing "this face left" from "the person was emptied", asserted separately by the reap test).
const setupSingleFaceFixture = async (options?: { retainedFace?: boolean }) => {
  const { ctx, sut: sharedSpaceService, faceIdentityRepository, jobs } = setupSharedSpace();
  const { user: spaceCreator } = await ctx.newUser();
  const { user: owner } = await ctx.newUser();
  const { user: editor } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: spaceCreator.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: spaceCreator.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Viewer });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });

  const wrong = await createIdentityBackedFace(ctx, faceIdentityRepository, {
    ownerId: owner.id,
    personName: 'Wrong Match',
    spaceId: space.id,
  });
  await sharedSpaceService.handleSharedSpaceFaceMatch({ spaceId: space.id, assetId: wrong.asset.id });

  let retained: { asset: { id: string }; faceId: string } | undefined;
  if (options?.retainedFace) {
    retained = await addFaceToIdentity(ctx, faceIdentityRepository, {
      ownerId: owner.id,
      personId: wrong.person.id,
      identityId: wrong.identity.id,
      spaceId: space.id,
    });
    await sharedSpaceService.handleSharedSpaceFaceMatch({ spaceId: space.id, assetId: retained.asset.id });
  }

  const sourcePerson = await ctx.database
    .selectFrom('shared_space_person')
    .selectAll()
    .where('spaceId', '=', space.id)
    .where('identityId', '=', wrong.identity.id)
    .executeTakeFirstOrThrow();

  jobs.queue.mockClear();

  return {
    ctx,
    sharedSpaceService,
    faceIdentityRepository,
    jobs,
    spaceCreator,
    owner,
    editor,
    viewer,
    space,
    wrong,
    retained,
    sourcePerson,
  };
};

// AC2 fixture: 'Grandma' is a space person whose identity was established from a DIFFERENT member's own
// photo (grandmaOwner), not the asset owner's. Reassigning the misassigned face (which lives on OWNER's
// asset) to Grandma therefore must resolve-or-create an owner-aligned person from scratch — exactly the
// path the identity-link trap (see reassignSpaceFacesToTarget's comment) lives in. As in
// setupSingleFaceFixture, `spaceCreator` is kept SEPARATE from `owner` (the misassigned asset's owner) so
// the owner-aligned-person lookup below pins the asset owner specifically, not whoever happens to have
// created the space.
const setupCrossOwnerReassignFixture = async () => {
  const { ctx, sut: sharedSpaceService, faceIdentityRepository, jobs } = setupSharedSpace();
  const { user: spaceCreator } = await ctx.newUser();
  const { user: owner } = await ctx.newUser();
  const { user: grandmaOwner } = await ctx.newUser();
  const { user: editor } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: spaceCreator.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: spaceCreator.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Viewer });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: grandmaOwner.id, role: SharedSpaceRole.Viewer });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: SharedSpaceRole.Editor });

  const grandma = await createIdentityBackedFace(ctx, faceIdentityRepository, {
    ownerId: grandmaOwner.id,
    personName: 'Grandma',
    spaceId: space.id,
  });
  await sharedSpaceService.handleSharedSpaceFaceMatch({ spaceId: space.id, assetId: grandma.asset.id });
  const grandmaSpacePerson = await ctx.database
    .selectFrom('shared_space_person')
    .selectAll()
    .where('spaceId', '=', space.id)
    .where('identityId', '=', grandma.identity.id)
    .executeTakeFirstOrThrow();

  const wrong = await createIdentityBackedFace(ctx, faceIdentityRepository, {
    ownerId: owner.id,
    personName: 'Wrong Match',
    spaceId: space.id,
  });
  await sharedSpaceService.handleSharedSpaceFaceMatch({ spaceId: space.id, assetId: wrong.asset.id });
  const wrongSpacePerson = await ctx.database
    .selectFrom('shared_space_person')
    .selectAll()
    .where('spaceId', '=', space.id)
    .where('identityId', '=', wrong.identity.id)
    .executeTakeFirstOrThrow();

  jobs.queue.mockClear();

  return {
    ctx,
    sharedSpaceService,
    faceIdentityRepository,
    jobs,
    spaceCreator,
    owner,
    grandmaOwner,
    editor,
    space,
    grandma,
    grandmaSpacePerson,
    wrong,
    wrongSpacePerson,
  };
};

// The same misassigned asset is a DIRECT member of two spaces so a single reassign must refresh both
// spaces' projections, not just the one the reassign was called against.
const setupTwoSpaceFixture = async () => {
  const { ctx, sut: sharedSpaceService, faceIdentityRepository, jobs } = setupSharedSpace();
  const { user: owner } = await ctx.newUser();
  const { user: editor } = await ctx.newUser();
  const { space: spaceA } = await ctx.newSharedSpace({ createdById: owner.id });
  const { space: spaceB } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: editor.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: editor.id, role: SharedSpaceRole.Editor });

  const wrong = await createIdentityBackedFace(ctx, faceIdentityRepository, {
    ownerId: owner.id,
    personName: 'Wrong Match',
  });
  await ctx.newSharedSpaceAsset({ spaceId: spaceA.id, assetId: wrong.asset.id, addedById: owner.id });
  await ctx.newSharedSpaceAsset({ spaceId: spaceB.id, assetId: wrong.asset.id, addedById: owner.id });

  await sharedSpaceService.handleSharedSpaceFaceMatch({ spaceId: spaceA.id, assetId: wrong.asset.id });
  await sharedSpaceService.handleSharedSpaceFaceMatch({ spaceId: spaceB.id, assetId: wrong.asset.id });

  const sourcePersonA = await ctx.database
    .selectFrom('shared_space_person')
    .selectAll()
    .where('spaceId', '=', spaceA.id)
    .where('identityId', '=', wrong.identity.id)
    .executeTakeFirstOrThrow();
  const sourcePersonB = await ctx.database
    .selectFrom('shared_space_person')
    .selectAll()
    .where('spaceId', '=', spaceB.id)
    .where('identityId', '=', wrong.identity.id)
    .executeTakeFirstOrThrow();

  jobs.queue.mockClear();

  return {
    ctx,
    sharedSpaceService,
    faceIdentityRepository,
    jobs,
    owner,
    editor,
    spaceA,
    spaceB,
    wrong,
    sourcePersonA,
    sourcePersonB,
  };
};

describe('Shared space person face reassign (#765)', () => {
  // #765: an Editor uses "Fix incorrect match" on a misassigned face and the flow appears to succeed —
  // but the photo reappears under the original (wrong) person immediately afterward. These tests exercise
  // the real endpoint delegate (SharedSpaceService.reassignSpacePersonFaces) end to end against a real DB.

  it('AC1: reassign-to-new never lets the face reappear under the original space person', async () => {
    const fx = await setupSingleFaceFixture({ retainedFace: true });

    // Pre-condition: the misassigned face is actually projected under the source person before the
    // reassign runs, so the post-call `toEqual([])` below can't pass vacuously (e.g. a fixture change
    // that never projected it there in the first place).
    const beforeCall = await spacePersonFacesFor(fx.ctx, { spaceId: fx.space.id, assetFaceId: fx.wrong.faceId });
    expect(beforeCall).toEqual([expect.objectContaining({ personId: fx.sourcePerson.id })]);

    const result = await fx.sharedSpaceService.reassignSpacePersonFaces(
      authFor(fx.editor),
      fx.space.id,
      fx.sourcePerson.id,
      { assetIds: [fx.wrong.asset.id], target: { type: 'new' } },
    );
    expect(result).toEqual({ reassigned: 1 });

    // asset_face.personId changed.
    const faceRow = await fx.ctx.database
      .selectFrom('asset_face')
      .select(['personId'])
      .where('id', '=', fx.wrong.faceId)
      .executeTakeFirstOrThrow();
    expect(faceRow.personId).not.toBe(fx.wrong.person.id);
    const newPersonId = faceRow.personId!;

    // The new global person is owned by the ASSET'S OWNER — not the acting editor, and not the
    // space's creator/owner-role member either (a distinct third user in this fixture, so this can't
    // pass by accident of the fixture conflating the two).
    const newPerson = await fx.ctx.database
      .selectFrom('person')
      .select(['id', 'ownerId'])
      .where('id', '=', newPersonId)
      .executeTakeFirstOrThrow();
    expect(newPerson.ownerId).toBe(fx.owner.id);
    expect(newPerson.ownerId).not.toBe(fx.editor.id);
    expect(newPerson.ownerId).not.toBe(fx.spaceCreator.id);

    // Synchronous half: evicted from the original space person immediately, before any job runs.
    const afterCall = await spacePersonFacesFor(fx.ctx, { spaceId: fx.space.id, assetFaceId: fx.wrong.faceId });
    expect(afterCall, 'face must leave the wrong space person synchronously').toEqual([]);
    expect(fx.jobs.queue.mock.calls.map(([job]) => job)).toContainEqual({
      name: JobName.SharedSpaceFaceMatch,
      data: { spaceId: fx.space.id, assetId: fx.wrong.asset.id },
    });

    // Async half: after draining, the face re-projects under a brand-new space person.
    await drainQueuedFaceMatchJobs(fx.sharedSpaceService, fx.jobs);
    const afterDrain = await spacePersonFacesFor(fx.ctx, { spaceId: fx.space.id, assetFaceId: fx.wrong.faceId });
    expect(afterDrain).toHaveLength(1);
    expect(afterDrain[0].personId).not.toBe(fx.sourcePerson.id);

    // The literal #765 regression guard: re-reading the ORIGINAL space person still does not show it,
    // through both a direct projection query and the read API a client would call.
    const originalFaces = await fx.ctx.database
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('personId', '=', fx.sourcePerson.id)
      .execute();
    expect(
      originalFaces.map((row) => row.assetFaceId),
      'the #765 regression: reassigned face must not reappear under the original space person',
    ).not.toContain(fx.wrong.faceId);
    expect(originalFaces.map((row) => row.assetFaceId)).toContain(fx.retained!.faceId);

    const originalPersonPage = await fx.sharedSpaceService.getSpacePersonFaces(
      authFor(fx.owner),
      fx.space.id,
      fx.sourcePerson.id,
      { page: 1, size: 50 },
    );
    // Positive control: the page isn't just empty for an unrelated reason (getSpacePersonFaces reads
    // through isVisible/asset.visibility/deletedAt/isOffline filters) — it does still show the retained,
    // correctly-matched face on this same person.
    expect(originalPersonPage.faces.map((face) => face.id)).toContain(fx.retained!.faceId);
    expect(
      originalPersonPage.faces.map((face) => face.id),
      'the #765 regression via the public read API: reassigned face must not reappear under the original space person',
    ).not.toContain(fx.wrong.faceId);
  });

  it('AC2: reassign-to-existing cross-owner space person joins the target identity without minting a duplicate', async () => {
    const fx = await setupCrossOwnerReassignFixture();

    await fx.sharedSpaceService.reassignSpacePersonFaces(
      authFor(fx.editor),
      fx.space.id,
      // The space person the misassigned face currently sits under.
      fx.wrongSpacePerson.id,
      {
        assetIds: [fx.wrong.asset.id],
        target: {
          type: 'existing',
          profile: { type: 'space-person', id: fx.grandmaSpacePerson.id, spaceId: fx.space.id },
        },
      },
    );

    // The face joins the TARGET identity — face_identity_face repointed.
    const link = await fx.ctx.database
      .selectFrom('face_identity_face')
      .select(['identityId', 'source'])
      .where('assetFaceId', '=', fx.wrong.faceId)
      .executeTakeFirstOrThrow();
    expect(link.identityId).toBe(fx.grandma.identity.id);
    expect(link.source).toBe('manual');

    // An owner-aligned person carrying that identity is resolved-or-created (the asset owner had none).
    // Use .execute() rather than .executeTakeFirst(): if production wrongly minted TWO owner-aligned
    // people on this identity, executeTakeFirst would pick one non-deterministically and could mask the
    // duplicate entirely.
    const ownerAlignedPeople = await fx.ctx.database
      .selectFrom('person')
      .select(['id', 'ownerId', 'identityId'])
      .where('ownerId', '=', fx.owner.id)
      .where('identityId', '=', fx.grandma.identity.id)
      .execute();
    expect(ownerAlignedPeople).toHaveLength(1);
    const ownerAlignedPerson = ownerAlignedPeople[0];

    const faceRow = await fx.ctx.database
      .selectFrom('asset_face')
      .select('personId')
      .where('id', '=', fx.wrong.faceId)
      .executeTakeFirstOrThrow();
    expect(faceRow.personId).toBe(ownerAlignedPerson.id);

    // Synchronous half: evicted from the wrong space person immediately, before any job runs — #765's
    // sync-eviction requirement applies to reassign-to-existing too, not just reassign-to-new (AC1).
    const afterCallSync = await spacePersonFacesFor(fx.ctx, { spaceId: fx.space.id, assetFaceId: fx.wrong.faceId });
    expect(afterCallSync, 'face must leave the wrong space person synchronously').toEqual([]);

    await drainQueuedFaceMatchJobs(fx.sharedSpaceService, fx.jobs);

    // The identity-link trap guard: exactly ONE space person carries this identity in the space, and it
    // is the TARGET — not a newly minted duplicate.
    const spacePeopleForIdentity = await spacePersonsForIdentity(fx.ctx, {
      spaceId: fx.space.id,
      identityId: fx.grandma.identity.id,
    });
    expect(spacePeopleForIdentity).toHaveLength(1);
    expect(spacePeopleForIdentity[0].id).toBe(fx.grandmaSpacePerson.id);

    const projected = await spacePersonFacesFor(fx.ctx, { spaceId: fx.space.id, assetFaceId: fx.wrong.faceId });
    expect(projected).toEqual([expect.objectContaining({ personId: fx.grandmaSpacePerson.id })]);
  });

  it('AC3: rejects a viewer performing the reassign and leaves the projection unchanged', async () => {
    const fx = await setupSingleFaceFixture();

    await expect(
      fx.sharedSpaceService.reassignSpacePersonFaces(authFor(fx.viewer), fx.space.id, fx.sourcePerson.id, {
        assetIds: [fx.wrong.asset.id],
        target: { type: 'new' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const faceRow = await fx.ctx.database
      .selectFrom('asset_face')
      .select('personId')
      .where('id', '=', fx.wrong.faceId)
      .executeTakeFirstOrThrow();
    expect(faceRow.personId).toBe(fx.wrong.person.id);

    const projected = await spacePersonFacesFor(fx.ctx, { spaceId: fx.space.id, assetFaceId: fx.wrong.faceId });
    expect(projected).toEqual([expect.objectContaining({ personId: fx.sourcePerson.id })]);

    expect(fx.jobs.queue).not.toHaveBeenCalled();
  });

  it('reaps the source space person once the reassign empties it', async () => {
    const fx = await setupSingleFaceFixture();

    await fx.sharedSpaceService.reassignSpacePersonFaces(authFor(fx.editor), fx.space.id, fx.sourcePerson.id, {
      assetIds: [fx.wrong.asset.id],
      target: { type: 'new' },
    });

    const remaining = await fx.ctx.database
      .selectFrom('shared_space_person')
      .select('id')
      .where('id', '=', fx.sourcePerson.id)
      .executeTakeFirst();
    expect(remaining).toBeUndefined();

    // Pin the rejection to the reaped-person path specifically, not just any BadRequestException —
    // getSpacePerson throws the same class for other guards (e.g. pets-disabled) too.
    const reapedLookup = fx.sharedSpaceService.getSpacePerson(authFor(fx.owner), fx.space.id, fx.sourcePerson.id);
    await expect(reapedLookup).rejects.toBeInstanceOf(BadRequestException);
    await expect(reapedLookup).rejects.toThrow('Person not found');
  });

  it('refreshes both projections when the misassigned asset is shared into two spaces', async () => {
    const fx = await setupTwoSpaceFixture();

    // Pre-condition: the misassigned face is actually projected under each space's source person before
    // the reassign runs, so the post-call `toEqual([])` assertions below can't pass vacuously. This
    // fixture has no other test covering it, so it matters most here.
    expect(await spacePersonFacesFor(fx.ctx, { spaceId: fx.spaceA.id, assetFaceId: fx.wrong.faceId })).toEqual([
      expect.objectContaining({ personId: fx.sourcePersonA.id }),
    ]);
    expect(await spacePersonFacesFor(fx.ctx, { spaceId: fx.spaceB.id, assetFaceId: fx.wrong.faceId })).toEqual([
      expect.objectContaining({ personId: fx.sourcePersonB.id }),
    ]);

    await fx.sharedSpaceService.reassignSpacePersonFaces(authFor(fx.editor), fx.spaceA.id, fx.sourcePersonA.id, {
      assetIds: [fx.wrong.asset.id],
      target: { type: 'new' },
    });

    // Synchronous eviction happens in BOTH spaces, not just the one the reassign was called against.
    expect(
      await spacePersonFacesFor(fx.ctx, { spaceId: fx.spaceA.id, assetFaceId: fx.wrong.faceId }),
      'face must leave spaceA synchronously',
    ).toEqual([]);
    expect(
      await spacePersonFacesFor(fx.ctx, { spaceId: fx.spaceB.id, assetFaceId: fx.wrong.faceId }),
      'face must leave spaceB synchronously (the reassign was only called against spaceA)',
    ).toEqual([]);

    await drainQueuedFaceMatchJobs(fx.sharedSpaceService, fx.jobs);

    const afterA = await spacePersonFacesFor(fx.ctx, { spaceId: fx.spaceA.id, assetFaceId: fx.wrong.faceId });
    const afterB = await spacePersonFacesFor(fx.ctx, { spaceId: fx.spaceB.id, assetFaceId: fx.wrong.faceId });
    expect(afterA).toHaveLength(1);
    expect(afterB).toHaveLength(1);
    expect(afterA[0].personId).not.toBe(fx.sourcePersonA.id);
    expect(afterB[0].personId).not.toBe(fx.sourcePersonB.id);
    // Same face, same target identity in both spaces.
    expect(afterA[0].identityId).toBe(afterB[0].identityId);
  });

  // The two avatar repairs the global reassign path already performs (PersonService.reassignFaces ->
  // createNewFeaturePhoto) plus the space-side equivalent on shared_space_person.representativeFaceId.
  // Without them the face that just LEFT a person is still what that person shows as its avatar — to
  // the source person's owner (a different member) and to everyone browsing the space.

  it("re-points the source global person's feature photo when the reassigned face was its avatar", async () => {
    const fx = await setupSingleFaceFixture({ retainedFace: true });
    await fx.ctx.database
      .updateTable('person')
      .set({ faceAssetId: fx.wrong.faceId })
      .where('id', '=', fx.wrong.person.id)
      .execute();

    await fx.sharedSpaceService.reassignSpacePersonFaces(authFor(fx.editor), fx.space.id, fx.sourcePerson.id, {
      assetIds: [fx.wrong.asset.id],
      target: { type: 'new' },
    });

    const sourcePerson = await fx.ctx.database
      .selectFrom('person')
      .select('faceAssetId')
      .where('id', '=', fx.wrong.person.id)
      .executeTakeFirstOrThrow();
    // The moved face now belongs to someone else — its old person must not still advertise it.
    expect(sourcePerson.faceAssetId).not.toBe(fx.wrong.faceId);
    expect(sourcePerson.faceAssetId).toBe(fx.retained!.faceId);
    expect(fx.jobs.queue.mock.calls.map(([job]) => job)).toContainEqual({
      name: JobName.PersonGenerateThumbnail,
      data: { id: fx.wrong.person.id },
    });
  });

  it('leaves the source global person feature photo alone when a different face was its avatar', async () => {
    const fx = await setupSingleFaceFixture({ retainedFace: true });
    await fx.ctx.database
      .updateTable('person')
      .set({ faceAssetId: fx.retained!.faceId })
      .where('id', '=', fx.wrong.person.id)
      .execute();

    await fx.sharedSpaceService.reassignSpacePersonFaces(authFor(fx.editor), fx.space.id, fx.sourcePerson.id, {
      assetIds: [fx.wrong.asset.id],
      target: { type: 'new' },
    });

    const sourcePerson = await fx.ctx.database
      .selectFrom('person')
      .select('faceAssetId')
      .where('id', '=', fx.wrong.person.id)
      .executeTakeFirstOrThrow();
    expect(sourcePerson.faceAssetId).toBe(fx.retained!.faceId);
  });

  it("clears the source space person's representative face when the reassigned face was it", async () => {
    const fx = await setupSingleFaceFixture({ retainedFace: true });
    await fx.ctx.database
      .updateTable('shared_space_person')
      .set({ representativeFaceId: fx.wrong.faceId, representativeFaceSource: 'auto' })
      .where('id', '=', fx.sourcePerson.id)
      .execute();

    await fx.sharedSpaceService.reassignSpacePersonFaces(authFor(fx.editor), fx.space.id, fx.sourcePerson.id, {
      assetIds: [fx.wrong.asset.id],
      target: { type: 'new' },
    });

    const after = await fx.ctx.database
      .selectFrom('shared_space_person')
      .select(['representativeFaceId', 'representativeFaceSource'])
      .where('id', '=', fx.sourcePerson.id)
      .executeTakeFirstOrThrow();
    // Neither repair helper covers this case (repairInvalidRepresentativeFaces only inspects manual
    // picks, repairOrphanedRepresentativeFaces only fills NULLs), so nothing else would fix it.
    expect(after.representativeFaceId).not.toBe(fx.wrong.faceId);
    expect(after.representativeFaceId).toBe(fx.retained!.faceId);
    expect(after.representativeFaceSource).toBe('auto');
  });

  it('degrades a manual representative face to auto when the reassign takes that face away', async () => {
    const fx = await setupSingleFaceFixture({ retainedFace: true });
    await fx.ctx.database
      .updateTable('shared_space_person')
      .set({ representativeFaceId: fx.wrong.faceId, representativeFaceSource: 'manual' })
      .where('id', '=', fx.sourcePerson.id)
      .execute();

    await fx.sharedSpaceService.reassignSpacePersonFaces(authFor(fx.editor), fx.space.id, fx.sourcePerson.id, {
      assetIds: [fx.wrong.asset.id],
      target: { type: 'new' },
    });

    const after = await fx.ctx.database
      .selectFrom('shared_space_person')
      .select(['representativeFaceId', 'representativeFaceSource'])
      .where('id', '=', fx.sourcePerson.id)
      .executeTakeFirstOrThrow();
    expect(after.representativeFaceId).toBe(fx.retained!.faceId);
    // Same degrade repairInvalidRepresentativeFaces applies: the manual choice is gone, so the person
    // goes back to picking automatically rather than pinning a face it no longer holds.
    expect(after.representativeFaceSource).toBe('auto');
  });

  it('keeps a representative face that points at a face the reassign did not touch', async () => {
    const fx = await setupSingleFaceFixture({ retainedFace: true });
    await fx.ctx.database
      .updateTable('shared_space_person')
      .set({ representativeFaceId: fx.retained!.faceId, representativeFaceSource: 'manual' })
      .where('id', '=', fx.sourcePerson.id)
      .execute();

    await fx.sharedSpaceService.reassignSpacePersonFaces(authFor(fx.editor), fx.space.id, fx.sourcePerson.id, {
      assetIds: [fx.wrong.asset.id],
      target: { type: 'new' },
    });

    const after = await fx.ctx.database
      .selectFrom('shared_space_person')
      .select(['representativeFaceId', 'representativeFaceSource'])
      .where('id', '=', fx.sourcePerson.id)
      .executeTakeFirstOrThrow();
    expect(after.representativeFaceId).toBe(fx.retained!.faceId);
    expect(after.representativeFaceSource).toBe('manual');
  });

  it('is idempotent when the same reassign-to-new is submitted twice back to back', async () => {
    // retainedFace: true keeps the source space person alive across both calls — modeling a real
    // double-submit race (the second click still targets a person that exists), not an edge case where
    // the person was already reaped between calls.
    const fx = await setupSingleFaceFixture({ retainedFace: true });

    const first = await fx.sharedSpaceService.reassignSpacePersonFaces(
      authFor(fx.editor),
      fx.space.id,
      fx.sourcePerson.id,
      {
        assetIds: [fx.wrong.asset.id],
        target: { type: 'new' },
      },
    );
    expect(first.reassigned).toBe(1);

    // The source→face relation the second call would key off was already evicted synchronously above, so
    // this is exactly the double-submit-before-refresh race a real double click would produce.
    const second = await fx.sharedSpaceService.reassignSpacePersonFaces(
      authFor(fx.editor),
      fx.space.id,
      fx.sourcePerson.id,
      {
        assetIds: [fx.wrong.asset.id],
        target: { type: 'new' },
      },
    );
    expect(second.reassigned).toBe(0);

    await drainQueuedFaceMatchJobs(fx.sharedSpaceService, fx.jobs);

    const createdPeople = await fx.ctx.database
      .selectFrom('person')
      .select(['id'])
      .where('ownerId', '=', fx.owner.id)
      .where('id', '!=', fx.wrong.person.id)
      .execute();
    expect(createdPeople).toHaveLength(1);

    const faceRows = await fx.ctx.database
      .selectFrom('shared_space_person_face')
      .select(['personId'])
      .where('assetFaceId', '=', fx.wrong.faceId)
      .execute();
    expect(faceRows).toHaveLength(1);
  });
});
