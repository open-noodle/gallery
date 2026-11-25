/**
The cross-owner repair (#1317, specs/2026-11-22-cross-account-identity-joins-design.md 5b).

Before #1317 a member's personal person could be joined to another account's identity, or to a space person's, on
faces the space never saw. The repair detaches a personal person when its identity is shared (another owner's person
or any space person sits on it), the person is not backed (no live face of its owner bound to the identity, on an
asset that a space holding a space person on the identity can see), and no human linked it there by hand
(`person_identity.manualLinkAt`). Backing does not require space membership: a linked library or album reaches
assets of people who never joined.

World: owner A's person PA on identity I, with a face on A's photo in space S, and space person SP on I. Member B.
*/
import { Kysely } from 'kysely';
import { Mocked } from 'vitest';
import { AssetVisibility, JobName, JobStatus, SharedSpaceRole } from 'src/enum.js';
import { FaceSearchRepository } from 'src/gallery/repositories/face-search.repository.js';
import { FilterSuggestionRepository } from 'src/gallery/repositories/filter-suggestion.repository.js';
import { GalleryAssetRepository } from 'src/gallery/repositories/gallery-asset.repository.js';
import { GalleryPersonRepository } from 'src/gallery/repositories/gallery-person.repository.js';
import { QueueMaintenanceRepository } from 'src/gallery/repositories/queue-maintenance.repository.js';
import { SmartFacetRepository } from 'src/gallery/repositories/smart-facet.repository.js';
import {
  FACE_IDENTITY_CROSS_OWNER_REPAIR_PAGE_SIZE,
  FaceIdentityMaintenanceService,
} from 'src/gallery/services/face-identity-maintenance.service.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { DB } from 'src/schema/index.js';
import { IdentityMergePropagationService } from 'src/services/identity-merge-propagation.service.js';
import { SharedSpaceService } from 'src/services/shared-space.service.js';
import { JobItem } from 'src/types.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory, newEmbedding } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx, sut: spaces } = newMediumService(SharedSpaceService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AssetRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      FacePersonVerdictRepository,
      FaceSearchRepository,
      FilterSuggestionRepository,
      GalleryAssetRepository,
      PersonRepository,
      SearchRepository,
      SharedSpaceRepository,
      SmartFacetRepository,
      SystemMetadataRepository,
    ],
    mock: [JobRepository, LoggingRepository, QueueMaintenanceRepository],
  });
  const jobs = ctx.getMock(JobRepository);
  jobs.queue.mockResolvedValue();
  jobs.queueAll.mockResolvedValue();
  ctx.getMock(QueueMaintenanceRepository).hasInFlightDedupChain.mockResolvedValue(false);
  const sut = FaceIdentityMaintenanceService.createFor(spaces);
  return { ctx, sut, spaces, jobs, faceIdentity: ctx.get(FaceIdentityRepository) };
};

type Fx = Awaited<ReturnType<typeof buildWorld>>;

const embedding = newEmbedding();

const buildWorld = async () => {
  const fx = setup();
  const { ctx, faceIdentity } = fx;
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });

  const { person: ownerPerson } = await ctx.newPerson({ ownerId: owner.id, name: 'Sam' });
  const identity = await faceIdentity.ensurePersonIdentity(ownerPerson.personGroupId);
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({ spaceId: space.id, identityId: identity.id, name: 'Sam', type: 'person' })
    .returningAll()
    .executeTakeFirstOrThrow();

  const world = { ...fx, owner, member, space, ownerPerson, identityId: identity.id, spacePerson };
  const { faceId } = await addFace(world, {
    ownerId: owner.id,
    personGroupId: ownerPerson.personGroupId,
    inSpace: true,
  });
  // The space projection and representative face, as face matching writes them; reconciliation reads both.
  await ctx.database
    .insertInto('shared_space_person_face')
    .values({ personId: spacePerson.id, assetFaceId: faceId })
    .execute();
  await ctx.database
    .updateTable('shared_space_person')
    .set({ representativeFaceId: faceId })
    .where('id', '=', spacePerson.id)
    .execute();
  return world;
};

/** A face of `personGroupId` on a new photo of `ownerId`, bound to `identityId` (default: the world's identity). */
const addFace = async (
  fx: Pick<Fx, 'ctx' | 'faceIdentity' | 'space' | 'identityId'>,
  input: {
    ownerId: string;
    personGroupId: string;
    identityId?: string;
    inSpace?: boolean;
    libraryId?: string;
    visibility?: AssetVisibility;
  },
) => {
  const { asset } = await fx.ctx.newAsset({
    ownerId: input.ownerId,
    libraryId: input.libraryId,
    visibility: input.visibility ?? AssetVisibility.Timeline,
  });
  if (input.inSpace) {
    await fx.ctx.newSharedSpaceAsset({ spaceId: fx.space.id, assetId: asset.id, addedById: input.ownerId });
  }
  const { assetFace } = await fx.ctx.newAssetFace({ assetId: asset.id, personGroupId: input.personGroupId });
  await fx.ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding }).execute();
  await fx.faceIdentity.linkFace({
    assetFaceId: assetFace.id,
    identityId: input.identityId ?? fx.identityId,
    source: 'shared-space-evidence',
  });
  return { assetId: asset.id, faceId: assetFace.id };
};

/** The member's person, joined to `identityId` the way pre-#1317 reconciliation joined it. */
const joinMemberPerson = async (fx: Fx, input: { ownerId?: string; name?: string; identityId?: string } = {}) => {
  const ownerId = input.ownerId ?? fx.member.id;
  const { person } = await fx.ctx.newPerson({ ownerId, name: input.name ?? 'Uncle Sam' });
  await fx.faceIdentity.ensurePersonIdentity(person.personGroupId);
  await fx.ctx.database
    .updateTable('person_identity')
    .set({ identityId: input.identityId ?? fx.identityId })
    .where('personGroupId', '=', person.personGroupId)
    .execute();
  return person;
};

const identityOf = (fx: Pick<Fx, 'ctx'>, personGroupId: string) =>
  fx.ctx.database
    .selectFrom('person_identity')
    .select('identityId')
    .where('personGroupId', '=', personGroupId)
    .executeTakeFirstOrThrow()
    .then(({ identityId }) => identityId);

const spacePersonIdentity = (fx: Fx) =>
  fx.ctx.database
    .selectFrom('shared_space_person')
    .select('identityId')
    .where('id', '=', fx.spacePerson.id)
    .executeTakeFirstOrThrow()
    .then(({ identityId }) => identityId);

const queuedJobs = (jobs: Mocked<JobRepository>, from = 0) =>
  jobs.queue.mock.calls.slice(from).map(([job]) => job as JobItem);

/** Runs the repair and every page it queues, as the FacialRecognition queue would. Returns the jobs queued. */
const runRepair = async (fx: Fx) => {
  const from = fx.jobs.queue.mock.calls.length;
  await expect(fx.sut.handleFaceIdentityCrossOwnerRepair({})).resolves.toBe(JobStatus.Success);
  let cursor = from;
  while (cursor < fx.jobs.queue.mock.calls.length) {
    const queued = queuedJobs(fx.jobs, cursor);
    cursor = fx.jobs.queue.mock.calls.length;
    for (const job of queued) {
      if (job.name === JobName.FaceIdentityCrossOwnerRepair) {
        await fx.sut.handleFaceIdentityCrossOwnerRepair(job.data);
      }
    }
  }
  return queuedJobs(fx.jobs, from);
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

afterAll(async () => {
  await defaultDatabase.destroy();
});

describe('cross-owner identity repair (#1317)', () => {
  it('detaches a member joined from private photos', async () => {
    const fx = await buildWorld();
    const memberPerson = await joinMemberPerson(fx);
    await addFace(fx, { ownerId: fx.member.id, personGroupId: memberPerson.personGroupId });

    await runRepair(fx);

    await expect(identityOf(fx, memberPerson.personGroupId)).resolves.not.toBe(fx.identityId);
    await expect(identityOf(fx, fx.ownerPerson.personGroupId)).resolves.toBe(fx.identityId);
    await expect(spacePersonIdentity(fx)).resolves.toBe(fx.identityId);
  });

  it('keeps a member backed by a shared photo', async () => {
    const fx = await buildWorld();
    const memberPerson = await joinMemberPerson(fx);
    await addFace(fx, { ownerId: fx.member.id, personGroupId: memberPerson.personGroupId, inSpace: true });
    await addFace(fx, { ownerId: fx.member.id, personGroupId: memberPerson.personGroupId });

    await runRepair(fx);

    await expect(identityOf(fx, memberPerson.personGroupId)).resolves.toBe(fx.identityId);
  });

  it("picks the joined member when the marker sits on the owner's side", async () => {
    // B's shared face started the space person on B's identity; A's reconciliation then merged A into it.
    const fx = await buildWorld();
    const memberPerson = await joinMemberPerson(fx);
    const { assetId } = await addFace(fx, {
      ownerId: fx.member.id,
      personGroupId: memberPerson.personGroupId,
      inSpace: true,
    });
    // B removes the shared photo: B's person no longer has a photo in the space, A's still does.
    await fx.ctx.database.deleteFrom('shared_space_asset').where('assetId', '=', assetId).execute();

    await runRepair(fx);

    await expect(identityOf(fx, memberPerson.personGroupId)).resolves.not.toBe(fx.identityId);
    await expect(identityOf(fx, fx.ownerPerson.personGroupId)).resolves.toBe(fx.identityId);
  });

  it('detaches a member who removed their shared photo', async () => {
    const fx = await buildWorld();
    const memberPerson = await joinMemberPerson(fx);
    const { assetId } = await addFace(fx, {
      ownerId: fx.member.id,
      personGroupId: memberPerson.personGroupId,
      inSpace: true,
    });
    await addFace(fx, { ownerId: fx.member.id, personGroupId: memberPerson.personGroupId });
    await runRepair(fx);
    await expect(identityOf(fx, memberPerson.personGroupId)).resolves.toBe(fx.identityId);

    await fx.ctx.database.deleteFrom('shared_space_asset').where('assetId', '=', assetId).execute();
    await runRepair(fx);

    await expect(identityOf(fx, memberPerson.personGroupId)).resolves.not.toBe(fx.identityId);
  });

  it.each([
    ['trashed', { deletedAt: new Date() }],
    ['moved to the Locked Folder', { visibility: AssetVisibility.Locked }],
  ] as const)('stays detached after the backfill when the only shared photo is %s', async (_state, change) => {
    const fx = await buildWorld();
    const person = await joinMemberPerson(fx);
    const { assetId, faceId } = await addFace(fx, {
      ownerId: fx.member.id,
      personGroupId: person.personGroupId,
      inSpace: true,
    });
    await fx.ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: fx.spacePerson.id, assetFaceId: faceId })
      .execute();
    await fx.ctx.database.updateTable('asset').set(change).where('id', '=', assetId).execute();

    await fx.sut.handleFaceIdentityCrossOwnerRepair({});
    const detached = await identityOf(fx, person.personGroupId);
    expect(detached).not.toBe(fx.identityId);

    await fx.faceIdentity.backfillSpacePersonIdentities({ limit: 100 });
    await fx.spaces.handleSharedSpaceIdentityReconciliation({ spaceId: fx.space.id });

    await expect(identityOf(fx, person.personGroupId)).resolves.toBe(detached);
    const onDetached = await fx.ctx.database
      .selectFrom('shared_space_person')
      .select('id')
      .where('spaceId', '=', fx.space.id)
      .where('identityId', '=', detached)
      .execute();
    expect(onDetached).toEqual([]);
  });

  it('keeps a member whose only shared photo is offline, so an unmounted library undoes no link', async () => {
    const fx = await buildWorld();
    const person = await joinMemberPerson(fx);
    const { assetId } = await addFace(fx, {
      ownerId: fx.member.id,
      personGroupId: person.personGroupId,
      inSpace: true,
    });
    await fx.ctx.database.updateTable('asset').set({ isOffline: true }).where('id', '=', assetId).execute();

    await fx.sut.handleFaceIdentityCrossOwnerRepair({});

    await expect(identityOf(fx, person.personGroupId)).resolves.toBe(fx.identityId);
  });

  it('keeps a member who left the space while their directly added photo stays', async () => {
    const fx = await buildWorld();
    const memberPerson = await joinMemberPerson(fx);
    await addFace(fx, { ownerId: fx.member.id, personGroupId: memberPerson.personGroupId, inSpace: true });
    const sharedSpaces = fx.ctx.get(SharedSpaceRepository);
    await sharedSpaces.removeMember(fx.space.id, fx.member.id);
    await sharedSpaces.removeOwnedAlbumLinksAddedBy(fx.space.id, fx.member.id);

    await runRepair(fx);

    await expect(identityOf(fx, memberPerson.personGroupId)).resolves.toBe(fx.identityId);
  });

  it('detaches a member whose only backing photo was in an album they owned, after they leave', async () => {
    const fx = await buildWorld();
    const memberPerson = await joinMemberPerson(fx);
    const { assetId } = await addFace(fx, { ownerId: fx.member.id, personGroupId: memberPerson.personGroupId });
    const { album } = await fx.ctx.newAlbum({ ownerId: fx.member.id, albumName: 'Trip' }, [assetId]);
    await fx.ctx.newSharedSpaceAlbum({ spaceId: fx.space.id, albumId: album.id, addedById: fx.member.id });

    await runRepair(fx);
    await expect(identityOf(fx, memberPerson.personGroupId)).resolves.toBe(fx.identityId);

    const sharedSpaces = fx.ctx.get(SharedSpaceRepository);
    await sharedSpaces.removeMember(fx.space.id, fx.member.id);
    await sharedSpaces.removeOwnedAlbumLinksAddedBy(fx.space.id, fx.member.id);
    await runRepair(fx);

    await expect(identityOf(fx, memberPerson.personGroupId)).resolves.not.toBe(fx.identityId);
  });

  it('keeps a non-member face owner whose photo the space reaches through a linked library', async () => {
    const fx = await buildWorld();
    const { user: outsider } = await fx.ctx.newUser();
    const { library } = await fx.ctx.newLibrary({ ownerId: outsider.id });
    await fx.ctx.newSharedSpaceLibrary({ spaceId: fx.space.id, libraryId: library.id, addedById: fx.owner.id });
    const outsiderPerson = await joinMemberPerson(fx, { ownerId: outsider.id });
    await addFace(fx, { ownerId: outsider.id, personGroupId: outsiderPerson.personGroupId, libraryId: library.id });

    await runRepair(fx);

    await expect(identityOf(fx, outsiderPerson.personGroupId)).resolves.toBe(fx.identityId);
  });

  it('keeps a person linked by hand without a shared photo', async () => {
    const fx = await buildWorld();
    const { person: memberPerson } = await fx.ctx.newPerson({ ownerId: fx.member.id, name: 'Uncle Sam' });
    const memberIdentity = await fx.faceIdentity.ensurePersonIdentity(memberPerson.personGroupId);
    await addFace(fx, {
      ownerId: fx.member.id,
      personGroupId: memberPerson.personGroupId,
      identityId: memberIdentity.id,
    });
    const merge = new IdentityMergePropagationService({
      databaseRepository: fx.ctx.get(DatabaseRepository),
      faceIdentityRepository: fx.faceIdentity,
      jobRepository: fx.jobs,
      logger: fx.ctx.getMock(LoggingRepository),
      personRepository: fx.ctx.get(PersonRepository),
      galleryPersonRepository: fx.ctx.get(GalleryPersonRepository),
      sharedSpaceRepository: fx.ctx.get(SharedSpaceRepository),
    });
    await merge.mergeScopedProfiles(factory.auth({ user: fx.member }), {
      target: { type: 'space-person', id: fx.spacePerson.id, spaceId: fx.space.id },
      sources: [{ type: 'person', id: memberPerson.personGroupId }],
    });
    await expect(identityOf(fx, memberPerson.personGroupId)).resolves.toBe(fx.identityId);

    await runRepair(fx);

    await expect(identityOf(fx, memberPerson.personGroupId)).resolves.toBe(fx.identityId);
  });

  it('is a no-op after reconciliation, and reconciliation is a no-op after it', async () => {
    const fx = await buildWorld();
    const { person: memberPerson } = await fx.ctx.newPerson({ ownerId: fx.member.id, name: '' });
    const memberIdentity = await fx.faceIdentity.ensurePersonIdentity(memberPerson.personGroupId);
    await addFace(fx, {
      ownerId: fx.member.id,
      personGroupId: memberPerson.personGroupId,
      identityId: memberIdentity.id,
      inSpace: true,
    });
    await addFace(fx, {
      ownerId: fx.member.id,
      personGroupId: memberPerson.personGroupId,
      identityId: memberIdentity.id,
    });
    await fx.spaces.handleSharedSpaceIdentityReconciliation({ spaceId: fx.space.id, userId: fx.member.id });
    await expect(identityOf(fx, memberPerson.personGroupId)).resolves.toBe(fx.identityId);

    await runRepair(fx);
    await expect(identityOf(fx, memberPerson.personGroupId)).resolves.toBe(fx.identityId);

    await fx.spaces.handleSharedSpaceIdentityReconciliation({ spaceId: fx.space.id, userId: fx.member.id });
    await expect(identityOf(fx, memberPerson.personGroupId)).resolves.toBe(fx.identityId);
    await expect(fx.faceIdentity.hasCrossOwnerRepairWork()).resolves.toBe(false);
  });

  it('changes nothing on a second run', async () => {
    const fx = await buildWorld();
    const memberPerson = await joinMemberPerson(fx);
    await addFace(fx, { ownerId: fx.member.id, personGroupId: memberPerson.personGroupId });
    await expect(fx.faceIdentity.hasCrossOwnerRepairWork()).resolves.toBe(true);

    await runRepair(fx);
    const detachedTo = await identityOf(fx, memberPerson.personGroupId);
    await expect(fx.faceIdentity.hasCrossOwnerRepairWork()).resolves.toBe(false);
    await runRepair(fx);

    await expect(identityOf(fx, memberPerson.personGroupId)).resolves.toBe(detachedTo);
    await expect(identityOf(fx, fx.ownerPerson.personGroupId)).resolves.toBe(fx.identityId);
  });

  it('pages through candidates and queues one metadata backfill after the last page', async () => {
    const fx = await buildWorld();
    const memberPerson = await joinMemberPerson(fx);
    await addFace(fx, { ownerId: fx.member.id, personGroupId: memberPerson.personGroupId });

    const queued = await runRepair(fx);

    expect(queued.filter((job) => job.name === JobName.SharedSpacePersonMetadataBackfill)).toEqual([
      { name: JobName.SharedSpacePersonMetadataBackfill, data: {} },
    ]);
  });

  it('resets an inherited name and birthday after the detach', async () => {
    const fx = await buildWorld();
    await fx.ctx.database
      .updateTable('person')
      .set({ name: '' })
      .where('personGroupId', '=', fx.ownerPerson.personGroupId)
      .execute();
    await fx.ctx.database
      .updateTable('shared_space_person')
      .set({ name: 'Uncle Sam', birthDate: '1960-01-01', nameSource: 'inherited', birthDateSource: 'inherited' })
      .where('id', '=', fx.spacePerson.id)
      .execute();
    const memberPerson = await joinMemberPerson(fx, { name: 'Uncle Sam' });
    await fx.ctx.database
      .updateTable('person')
      .set({ birthDate: '1960-01-01' })
      .where('personGroupId', '=', memberPerson.personGroupId)
      .execute();
    await addFace(fx, { ownerId: fx.member.id, personGroupId: memberPerson.personGroupId });

    const queued = await runRepair(fx);
    for (const job of queued) {
      if (job.name === JobName.SharedSpacePersonMetadataBackfill) {
        await fx.spaces.handleSharedSpacePersonMetadataBackfill(job.data);
      }
    }

    const spacePerson = await fx.ctx.database
      .selectFrom('shared_space_person')
      .select(['name', 'birthDate'])
      .where('id', '=', fx.spacePerson.id)
      .executeTakeFirstOrThrow();
    expect(spacePerson).toEqual({ name: '', birthDate: null });
  });

  // The identity backfill writes the per-face identity rows; until it does, a face can lack one. The nightly sweep
  // queues the repair without waiting for the backfill, so backing must not depend on those rows.
  it('keeps a member backed by a shared photo whose face has no per-face identity row yet', async () => {
    const fx = await buildWorld();
    const memberPerson = await joinMemberPerson(fx);
    const { faceId } = await addFace(fx, {
      ownerId: fx.member.id,
      personGroupId: memberPerson.personGroupId,
      inSpace: true,
    });
    await fx.ctx.database.deleteFrom('face_identity_face').where('assetFaceId', '=', faceId).execute();
    await expect(fx.faceIdentity.hasBackfillWork()).resolves.toBe(true);

    await expect(fx.faceIdentity.hasCrossOwnerRepairWork()).resolves.toBe(false);
    await runRepair(fx);

    await expect(identityOf(fx, memberPerson.personGroupId)).resolves.toBe(fx.identityId);
  });

  it('keeps a person the member links by hand after the page was listed', async () => {
    const fx = await buildWorld();
    // The member's person sits on its own identity, which a third account's person was joined to from private photos.
    const { person: memberPerson } = await fx.ctx.newPerson({ ownerId: fx.member.id, name: 'Uncle Sam' });
    const memberIdentity = await fx.faceIdentity.ensurePersonIdentity(memberPerson.personGroupId);
    await addFace(fx, {
      ownerId: fx.member.id,
      personGroupId: memberPerson.personGroupId,
      identityId: memberIdentity.id,
    });
    const { user: third } = await fx.ctx.newUser();
    const thirdPerson = await joinMemberPerson(fx, {
      ownerId: third.id,
      name: 'Stranger',
      identityId: memberIdentity.id,
    });
    await addFace(fx, { ownerId: third.id, personGroupId: thirdPerson.personGroupId, identityId: memberIdentity.id });
    const merge = new IdentityMergePropagationService({
      databaseRepository: fx.ctx.get(DatabaseRepository),
      faceIdentityRepository: fx.faceIdentity,
      jobRepository: fx.jobs,
      logger: fx.ctx.getMock(LoggingRepository),
      personRepository: fx.ctx.get(PersonRepository),
      galleryPersonRepository: fx.ctx.get(GalleryPersonRepository),
      sharedSpaceRepository: fx.ctx.get(SharedSpaceRepository),
    });
    const listCandidates = fx.faceIdentity.getCrossOwnerRepairCandidates.bind(fx.faceIdentity);
    vi.spyOn(fx.faceIdentity, 'getCrossOwnerRepairCandidates').mockImplementationOnce(async (input) => {
      const page = await listCandidates(input);
      expect(page.map(({ personGroupId }) => personGroupId)).toContain(memberPerson.personGroupId);
      // The member links their person to the space person by hand while the page is being processed.
      await merge.mergeScopedProfiles(factory.auth({ user: fx.member }), {
        target: { type: 'space-person', id: fx.spacePerson.id, spaceId: fx.space.id },
        sources: [{ type: 'person', id: memberPerson.personGroupId }],
      });
      return page;
    });

    await runRepair(fx);

    const row = await fx.ctx.database
      .selectFrom('person_identity')
      .select(['identityId', 'manualLinkAt'])
      .where('personGroupId', '=', memberPerson.personGroupId)
      .executeTakeFirstOrThrow();
    expect(row.identityId).toBe(fx.identityId);
    expect(row.manualLinkAt).not.toBeNull();
  });

  it('detaches every candidate across more than one page', async () => {
    const fx = await buildWorld();
    const people = [];
    for (let index = 0; index <= FACE_IDENTITY_CROSS_OWNER_REPAIR_PAGE_SIZE; index++) {
      // An owner has at most one person per identity, so each candidate belongs to its own account.
      const { user } = await fx.ctx.newUser();
      const person = await joinMemberPerson(fx, { ownerId: user.id, name: `Member ${index}` });
      await addFace(fx, { ownerId: user.id, personGroupId: person.personGroupId });
      people.push(person);
    }

    const queued = await runRepair(fx);

    expect(queued.filter((job) => job.name === JobName.FaceIdentityCrossOwnerRepair)).toHaveLength(1);
    expect(queued.filter((job) => job.name === JobName.SharedSpacePersonMetadataBackfill)).toHaveLength(1);
    for (const person of people) {
      await expect(identityOf(fx, person.personGroupId)).resolves.not.toBe(fx.identityId);
    }
    await expect(fx.faceIdentity.hasCrossOwnerRepairWork()).resolves.toBe(false);
  });

  // §1: reconciliation reads only the member's faces the space can see.
  it('reconciliation leaves a member whose matching face is private, and joins them once that photo is shared', async () => {
    const fx = await buildWorld();
    const { person: memberPerson } = await fx.ctx.newPerson({ ownerId: fx.member.id, name: 'Uncle Sam' });
    const memberIdentity = await fx.faceIdentity.ensurePersonIdentity(memberPerson.personGroupId);
    const { assetId } = await addFace(fx, {
      ownerId: fx.member.id,
      personGroupId: memberPerson.personGroupId,
      identityId: memberIdentity.id,
    });

    await fx.spaces.handleSharedSpaceIdentityReconciliation({ spaceId: fx.space.id, userId: fx.member.id });
    await expect(identityOf(fx, memberPerson.personGroupId)).resolves.toBe(memberIdentity.id);

    await fx.ctx.newSharedSpaceAsset({ spaceId: fx.space.id, assetId, addedById: fx.member.id });
    await fx.spaces.handleSharedSpaceIdentityReconciliation({ spaceId: fx.space.id, userId: fx.member.id });
    await expect(identityOf(fx, memberPerson.personGroupId)).resolves.toBe(fx.identityId);
  });
});
