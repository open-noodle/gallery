import { Kysely } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { AssetFileType, AssetVisibility, JobName, SharedSpaceRole, SourceType, SystemMetadataKey } from 'src/enum.js';
import { FaceSearchRepository } from 'src/gallery/repositories/face-search.repository.js';
import { FaceDissolveRepository } from 'src/gallery/repositories/face-dissolve.repository.js';
import { QueueMaintenanceRepository } from 'src/gallery/repositories/queue-maintenance.repository.js';
import { FaceDissolveService } from 'src/gallery/services/face-dissolve.service.js';
import { DissolveScope } from 'src/gallery/utils/face-dissolve.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository.js';
import { FaceRepairRepository } from 'src/repositories/face-repair.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { DB } from 'src/schema/index.js';
import { PersonService } from 'src/services/person.service.js';
import { SharedSpaceService } from 'src/services/shared-space.service.js';
import { clearConfigCache } from 'src/utils/config.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

// Revision 2 of specs/2026-09-06-dissolve-person-design.md: the guarantee issue #1228 asked for. A dissolved junk
// person must not rebuild itself, and its faces must not drift into the people next to it, when recognition and
// detection run again with the same settings that built it.

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

const CONFIG = { machineLearning: { facialRecognition: { enabled: true, minFaces: 3, maxDistance: 0.5 } } };

/** A unit vector at `degrees` in one plane: cosine distance between two is 1 - cos(angle between them). */
const embeddingAt = (degrees: number) => {
  const radians = (degrees * Math.PI) / 180;
  const vector = Array.from({ length: 512 }, () => 0);
  vector[0] = Math.cos(radians);
  vector[1] = Math.sin(radians);
  return `[${vector.join(',')}]`;
};

const setup = () => {
  clearConfigCache();
  const metadata = (ctx: { getMock: (repository: typeof SystemMetadataRepository) => any }) => {
    const mock = ctx.getMock(SystemMetadataRepository);
    mock.get.mockImplementation((key: SystemMetadataKey) =>
      Promise.resolve(key === SystemMetadataKey.SystemConfig ? CONFIG : undefined),
    );
    mock.set.mockResolvedValue();
  };

  const person = newMediumService(PersonService, {
    database: db,
    real: [
      AccessRepository,
      AssetRepository,
      AssetJobRepository,
      ConfigRepository,
      CryptoRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      FacePersonVerdictRepository,
      FaceSearchRepository,
      PersonRepository,
      SearchRepository,
      SharedSpaceRepository,
    ],
    mock: [JobRepository, LoggingRepository, MachineLearningRepository, StorageRepository, SystemMetadataRepository],
  });
  metadata(person.ctx);
  const jobs = person.ctx.getMock(JobRepository);
  jobs.waitForQueueCompletion.mockResolvedValue();
  jobs.queue.mockResolvedValue();
  jobs.queueAll.mockResolvedValue();
  jobs.getJobCounts.mockResolvedValue({ active: 1, waiting: 0, delayed: 0, paused: 0, completed: 0, failed: 0 });

  const dissolve = newMediumService(FaceDissolveService, {
    database: db,
    real: [
      ConfigRepository,
      DatabaseRepository,
      FaceDissolveRepository,
      FacePersonVerdictRepository,
      FaceRepairRepository,
      PersonRepository,
    ],
    mock: [JobRepository, LoggingRepository, SystemMetadataRepository],
  });
  metadata(dissolve.ctx);
  const dissolveJobs = dissolve.ctx.getMock(JobRepository);
  dissolveJobs.isActive.mockResolvedValue(false);
  dissolveJobs.queue.mockResolvedValue();
  dissolveJobs.queueAll.mockResolvedValue();

  return { recognition: person.sut, ctx: person.ctx, jobs, dissolver: dissolve.sut };
};

type Setup = ReturnType<typeof setup>;

/** Runs every FacialRecognition job the service queued, including the deferred pass, until none are left. */
const drainRecognition = async ({ recognition, jobs }: Setup) => {
  let queueAllSeen = 0;
  let queueSeen = 0;
  for (let round = 0; round < 10; round++) {
    const pending = [
      ...jobs.queueAll.mock.calls.slice(queueAllSeen).flatMap(([batch]) => batch),
      ...jobs.queue.mock.calls.slice(queueSeen).map(([job]) => job),
    ].filter((job) => job.name === JobName.FacialRecognition);
    queueAllSeen = jobs.queueAll.mock.calls.length;
    queueSeen = jobs.queue.mock.calls.length;
    if (pending.length === 0) {
      return;
    }
    for (const job of pending) {
      await recognition.handleRecognizeFaces(job.data as never);
    }
  }
  throw new Error('recognition did not settle');
};

const queuedFaceIds = ({ jobs }: Setup) =>
  jobs.queueAll.mock.calls
    .flatMap(([batch]) => batch)
    .filter((job) => job.name === JobName.FacialRecognition)
    .map((job) => (job.data as { id: string }).id);

const seedFace = async ({ ctx }: Setup, input: { ownerId: string; personGroupId: string | null; degrees: number }) => {
  const { asset } = await ctx.newAsset({ ownerId: input.ownerId, visibility: AssetVisibility.Timeline });
  await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: `/preview/${asset.id}.webp` });
  await ctx.newExif({ assetId: asset.id, exifImageHeight: 10, exifImageWidth: 10 });
  const { assetFace } = await ctx.newAssetFace({
    assetId: asset.id,
    personGroupId: input.personGroupId,
    sourceType: SourceType.MachineLearning,
  });
  await ctx.database
    .insertInto('face_search')
    .values({ faceId: assetFace.id, embedding: embeddingAt(input.degrees) })
    .execute();
  return { asset, face: assetFace };
};

const faceCount = (personGroupId: string) =>
  db
    .selectFrom('asset_face')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('personGroupId', '=', personGroupId)
    .executeTakeFirstOrThrow()
    .then((row) => Number(row.count));

const peopleOf = (ownerId: string) =>
  db
    .selectFrom('person')
    .select('personGroupId')
    .where('ownerId', '=', ownerId)
    .execute()
    .then((rows) => rows.map((row) => row.personGroupId));

/**
 * A junk person of six detected faces right next to a real person of six. Every junk face is within maxDistance of
 * the real person's faces, so a bare unassign would file them all under the real person on the next run.
 */
const seedJunkBesideRealPerson = async (setup: Setup) => {
  const { user } = await setup.ctx.newUser();
  const { person: junk } = await setup.ctx.newPerson({ ownerId: user.id, name: 'Junk' });
  const { person: real } = await setup.ctx.newPerson({ ownerId: user.id, name: 'Real' });
  const junkFaces = [];
  for (const degrees of [8, 16, 24, 32, 40, 48]) {
    junkFaces.push((await seedFace(setup, { ownerId: user.id, personGroupId: junk.personGroupId, degrees })).face);
  }
  for (let index = 0; index < 6; index++) {
    await seedFace(setup, { ownerId: user.id, personGroupId: real.personGroupId, degrees: 0 });
  }
  return { user, junk, real, junkFaces };
};

const dissolveAll = (setup: Setup, ownerId: string, personGroupId: string, faces: number) =>
  setup.dissolver.apply(factory.auth({ user: { id: ownerId } }), personGroupId, {
    scope: DissolveScope.All,
    expectedFaceCount: faces,
  });

describe('a dissolved person stays gone', () => {
  it('no-recluster: recognition does not rebuild it or hand its faces to the person next to it', async () => {
    const context = setup();
    const { user, junk, real, junkFaces } = await seedJunkBesideRealPerson(context);
    const peopleBefore = await peopleOf(user.id);

    await dissolveAll(context, user.id, junk.personGroupId, junkFaces.length);
    await context.recognition.handleQueueRecognizeFaces({ force: false });
    // Also run any stale job a queue might still hold for these faces.
    for (const face of junkFaces) {
      await context.recognition.handleRecognizeFaces({ id: face.id, deferred: false });
    }
    await drainRecognition(context);

    const rows = await db
      .selectFrom('asset_face')
      .select(['personGroupId', 'deletedAt'])
      .where(
        'id',
        'in',
        junkFaces.map((face) => face.id),
      )
      .execute();
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.personGroupId).toBeNull();
      expect(row.deletedAt).toBeInstanceOf(Date);
    }
    expect(await faceCount(real.personGroupId)).toBe(6);
    expect((await peopleOf(user.id)).sort()).toEqual(peopleBefore.filter((id) => id !== junk.personGroupId).sort());
  });

  it('nightly-skips: the nightly recognition pass queues none of the hidden faces', async () => {
    const context = setup();
    const { user, junk, junkFaces } = await seedJunkBesideRealPerson(context);
    await dissolveAll(context, user.id, junk.personGroupId, junkFaces.length);
    // A new face since the last run, so the nightly pass does not skip itself.
    const fresh = await seedFace(context, { ownerId: user.id, personGroupId: null, degrees: 180 });

    await context.recognition.handleQueueRecognizeFaces({ nightly: true });

    const queued = queuedFaceIds(context);
    expect(queued).toContain(fresh.face.id);
    for (const face of junkFaces) {
      expect(queued).not.toContain(face.id);
    }
  });

  it('redetect-keeps-tombstone: re-scanning the photo finds the same box and adds no face', async () => {
    const context = setup();
    const { user, junk, junkFaces } = await seedJunkBesideRealPerson(context);
    await dissolveAll(context, user.id, junk.personGroupId, junkFaces.length);
    const hidden = await db
      .selectFrom('asset_face')
      .selectAll()
      .where('id', '=', junkFaces[0].id)
      .executeTakeFirstOrThrow();

    context.ctx.getMock(MachineLearningRepository).detectFaces.mockResolvedValue({
      imageWidth: hidden.imageWidth,
      imageHeight: hidden.imageHeight,
      faces: [
        {
          boundingBox: {
            x1: hidden.boundingBoxX1,
            y1: hidden.boundingBoxY1,
            x2: hidden.boundingBoxX2,
            y2: hidden.boundingBoxY2,
          },
          embedding: embeddingAt(8),
          score: 0.99,
        },
      ],
    });
    await context.recognition.handleDetectFaces({ id: hidden.assetId });

    const faces = await db
      .selectFrom('asset_face')
      .select(['id', 'deletedAt', 'personGroupId'])
      .where('assetId', '=', hidden.assetId)
      .execute();
    expect(faces).toHaveLength(1);
    expect(faces[0]).toMatchObject({ id: hidden.id, personGroupId: null });
    expect(faces[0].deletedAt).toBeInstanceOf(Date);
  });

  it('not-a-neighbour: a new face close only to hidden faces joins no one', async () => {
    const context = setup();
    const { user } = await context.ctx.newUser();
    const { person: junk } = await context.ctx.newPerson({ ownerId: user.id, name: 'Junk' });
    const junkFaces = [];
    for (let index = 0; index < 6; index++) {
      junkFaces.push(
        (await seedFace(context, { ownerId: user.id, personGroupId: junk.personGroupId, degrees: 90 })).face,
      );
    }
    await dissolveAll(context, user.id, junk.personGroupId, junkFaces.length);

    const fresh = await seedFace(context, { ownerId: user.id, personGroupId: null, degrees: 90 });
    await context.recognition.handleRecognizeFaces({ id: fresh.face.id, deferred: false });
    await drainRecognition(context);

    const row = await db
      .selectFrom('asset_face')
      .select('personGroupId')
      .where('id', '=', fresh.face.id)
      .executeTakeFirstOrThrow();
    expect(row.personGroupId).toBeNull();
    expect(await peopleOf(user.id)).toEqual([]);
  });

  // A guard, not a discriminator: Space matching also leaves a merely-unassigned face alone in this fixture, so
  // this test pins the hidden case only. getAssetFacesForMatching's `deletedAt IS NULL` is what it protects.
  it('space-match-no-relink: matching a Space photo again does not link a hidden face', async () => {
    const context = setup();
    const { user, junk, junkFaces } = await seedJunkBesideRealPerson(context);
    const { space } = await context.ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await context.ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
    const hidden = await db
      .selectFrom('asset_face')
      .select('assetId')
      .where('id', '=', junkFaces[0].id)
      .executeTakeFirstOrThrow();
    await context.ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: hidden.assetId, addedById: user.id });
    // A Space person right next to the junk face, so matching has somewhere to put it if it is not hidden.
    const neighbour = await seedFace(context, { ownerId: user.id, personGroupId: null, degrees: 8 });
    await context.ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: neighbour.asset.id, addedById: user.id });
    const spacePerson = await db
      .insertInto('shared_space_person')
      .values({ spaceId: space.id, name: 'Neighbour', representativeFaceId: neighbour.face.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('shared_space_person_face')
      .values({ personId: spacePerson.id, assetFaceId: neighbour.face.id })
      .execute();
    await dissolveAll(context, user.id, junk.personGroupId, junkFaces.length);

    clearConfigCache();
    const spaces = newMediumService(SharedSpaceService, {
      database: db,
      real: [
        AssetRepository,
        ConfigRepository,
        DatabaseRepository,
        FaceIdentityRepository,
        FacePersonVerdictRepository,
        FaceSearchRepository,
        PersonRepository,
        SearchRepository,
        SharedSpaceRepository,
        StackRepository,
        SystemMetadataRepository,
      ],
      mock: [LoggingRepository, JobRepository, QueueMaintenanceRepository],
    });
    spaces.ctx.getMock(JobRepository).queue.mockResolvedValue();
    spaces.ctx.getMock(JobRepository).queueAll.mockResolvedValue();
    spaces.ctx.getMock(QueueMaintenanceRepository).hasInFlightDedupChain.mockResolvedValue(false);

    await spaces.sut.handleSharedSpaceFaceMatch({ spaceId: space.id, assetId: hidden.assetId });

    const links = await db
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('assetFaceId', '=', junkFaces[0].id)
      .execute();
    expect(links).toEqual([]);
  });
});
