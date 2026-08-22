import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import { AssetEditAction, MirrorAxis } from 'src/dtos/editing.dto';
import { AssetFaceCreateDto } from 'src/dtos/person.dto';
import {
  AssetFileType,
  AssetVisibility,
  JobName,
  JobStatus,
  QueueName,
  SharedSpaceRole,
  SourceType,
  SystemMetadataKey,
} from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository';
import { AssetJobRepository } from 'src/repositories/asset-job.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { FaceSuggestionService } from 'src/services/face-suggestion.service';
import { PersonService } from 'src/services/person.service';
import { clearConfigCache } from 'src/utils/config';
import { newMediumService } from 'test/medium.factory';
import { factory, newEmbedding } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  clearConfigCache();

  const { sut, ctx } = newMediumService(PersonService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      ConfigRepository,
      FaceIdentityRepository,
      FacePersonVerdictRepository,
      DatabaseRepository,
      PersonRepository,
      AssetRepository,
      AssetEditRepository,
      SharedSpaceRepository,
    ],
    mock: [JobRepository, LoggingRepository, StorageRepository, SystemMetadataRepository],
  });

  // mergePerson resolves the cross-owner toggle via getConfig() before opening the merge transaction, so the
  // config plumbing must be present even for a plain own-merge; a bare SystemConfig yields all defaults.
  ctx
    .getMock(SystemMetadataRepository)
    .get.mockImplementation((key) => (key === SystemMetadataKey.SystemConfig ? ({} as any) : (undefined as any)));

  return { sut, ctx };
};

const setupFaceDetection = (db?: Kysely<DB>) => {
  clearConfigCache();

  const { sut, ctx } = newMediumService(PersonService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AssetRepository,
      AssetJobRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      // handleQueueRecognizeFaces collects orphaned verdicts (Slice 8), so this setup needs the repository
      // too — without it the service field is undefined and the call throws at runtime.
      FacePersonVerdictRepository,
      PersonRepository,
      SharedSpaceRepository,
    ],
    mock: [JobRepository, LoggingRepository, MachineLearningRepository, StorageRepository, SystemMetadataRepository],
  });

  ctx.getMock(JobRepository).queue.mockResolvedValue();
  ctx.getMock(JobRepository).queueAll.mockResolvedValue();
  ctx.getMock(SystemMetadataRepository).get.mockImplementation((key) => {
    if (key === SystemMetadataKey.SystemConfig) {
      return { machineLearning: { facialRecognition: { enabled: true, minFaces: 1 } } } as any;
    }
    return undefined as any;
  });

  return { sut, ctx };
};

/** #869 follow-up: one person carrying a face on a timeline asset and a face on a locked asset. */
const seedPersonAcrossVisibilities = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user } = await ctx.newUser();
  const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Vaulted Vera' });
  const { asset: timelineAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
  const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
  await ctx.newAssetFace({ assetId: timelineAsset.id, personGroupId: person.personGroupId });
  await ctx.newAssetFace({ assetId: lockedAsset.id, personGroupId: person.personGroupId });
  return { user, person, timelineAsset, lockedAsset };
};

/**
 * #869 follow-up: seed a person whose representative face (`person.faceAssetId`, which points at an
 * ASSET_FACE row) sits on an asset of the given visibility, so the thumbnail source is reachable as
 * person -> asset_face -> asset.
 */
const seedPersonWithRepresentativeFace = async (
  ctx: ReturnType<typeof setup>['ctx'],
  ownerId: string,
  visibility: AssetVisibility,
  thumbnailPath: string,
) => {
  const { asset } = await ctx.newAsset({ ownerId, visibility });
  const { person } = await ctx.newPerson({ ownerId, name: 'Vaulted Vera', thumbnailPath });
  const { result: faceId } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
  await ctx.get(PersonRepository).update({ personGroupId: person.personGroupId, faceAssetId: faceId });
  return { asset, person };
};

// Slice 1 (S1.14 pin): a setup with SearchRepository real, so handleRecognizeFaces's KNN passes run
// against a real DB rather than a mock.
const setupRecognition = (db?: Kysely<DB>) => {
  clearConfigCache();
  const { sut, ctx } = newMediumService(PersonService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      PersonRepository,
      SearchRepository,
      SharedSpaceRepository,
    ],
    mock: [JobRepository, LoggingRepository, SystemMetadataRepository],
  });
  const metadata = ctx.getMock(SystemMetadataRepository);
  metadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } } as any);
  const jobs = ctx.getMock(JobRepository);
  jobs.queue.mockResolvedValue();
  jobs.queueAll.mockResolvedValue();
  return { sut, ctx };
};

/**
 * #808: reproduces the reported shape against a real database — `person.birthDate` is NULL and the
 * birthday only ever existed on a `shared_space_person` profile reached through the shared
 * `identityId`. This is the payload the asset viewer Info panel renders for the owner, so the age
 * has to survive the trip. The small tests stub the resolver; these prove the real
 * `hydrateAccessiblePeople` query actually returns the space birthday for this shape.
 */
const seedSpaceOnlyBirthday = async (birthDateSource: 'manual' | 'inherited') => {
  const { sut, ctx } = setup();
  const faceIdentityRepository = ctx.get(FaceIdentityRepository);
  const { user } = await ctx.newUser();
  const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Karolin', birthDate: null });
  const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
  await ctx.newExif({ assetId: asset.id, exifImageWidth: 400, exifImageHeight: 500 });
  const { result: faceId } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });

  const identity = await faceIdentityRepository.ensurePersonIdentity(person.personGroupId);
  await faceIdentityRepository.linkFace({ assetFaceId: faceId, identityId: identity.id, source: 'owner-person' });

  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });

  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: space.id,
      name: 'Karolin',
      identityId: identity.id,
      birthDate: '2014-02-14',
      birthDateSource,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('shared_space_person_face')
    .values({ personId: spacePerson.id, assetFaceId: faceId })
    .execute();

  return { sut, ctx, user, person, asset, identity, space };
};

const setupFaceRecognition = (db?: Kysely<DB>) => {
  clearConfigCache();

  const { sut, ctx } = newMediumService(PersonService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AssetRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      // handleQueueRecognizeFaces collects orphaned verdicts (Slice 8) — see setupFaceDetection above.
      FacePersonVerdictRepository,
      PersonRepository,
      SharedSpaceRepository,
    ],
    mock: [JobRepository, LoggingRepository, MachineLearningRepository, StorageRepository, SystemMetadataRepository],
  });

  const jobMock = ctx.getMock(JobRepository);
  jobMock.waitForQueueCompletion.mockResolvedValue();
  jobMock.empty.mockResolvedValue();
  jobMock.queue.mockResolvedValue();
  jobMock.queueAll.mockResolvedValue();
  jobMock.getJobCounts.mockResolvedValue({
    active: 1,
    waiting: 0,
    delayed: 0,
    paused: 0,
    completed: 0,
    failed: 0,
  });

  ctx.getMock(SystemMetadataRepository).get.mockImplementation((key) => {
    if (key === SystemMetadataKey.SystemConfig) {
      return { machineLearning: { facialRecognition: { enabled: true, minFaces: 1 } } } as any;
    }
    return undefined as any;
  });

  ctx.getMock(SystemMetadataRepository).set.mockResolvedValue();

  return { sut, ctx };
};

const getAssetFaces = (ctx: ReturnType<typeof setupFaceDetection>['ctx'], assetId: string) =>
  ctx.database
    .selectFrom('asset_face')
    .select(['id', 'assetId', 'personGroupId', 'sourceType'])
    .where('assetId', '=', assetId)
    .orderBy('id')
    .execute();

const getIdentityLinks = (ctx: ReturnType<typeof setupFaceDetection>['ctx'], faceIds: string[]) =>
  ctx.database
    .selectFrom('face_identity_face')
    .select(['assetFaceId', 'identityId', 'source'])
    .where('assetFaceId', 'in', faceIds)
    .orderBy('assetFaceId')
    .execute();

const getPeopleByIds = (ctx: ReturnType<typeof setupFaceRecognition>['ctx'], ids: string[]) =>
  ctx.database.selectFrom('person').select(['personGroupId', 'name']).where('personGroupId', 'in', ids).orderBy('name').execute();

const getSpacePeople = (ctx: ReturnType<typeof setupFaceRecognition>['ctx'], spaceIds: string[]) =>
  ctx.database
    .selectFrom('shared_space_person')
    .select(['id', 'identityId', 'name', 'spaceId'])
    .where('spaceId', 'in', spaceIds)
    .orderBy('name')
    .execute();

const createAssetReadyForFaceDetection = async (ctx: ReturnType<typeof setupFaceDetection>['ctx'], ownerId: string) => {
  const { asset } = await ctx.newAsset({ ownerId, visibility: AssetVisibility.Timeline, width: 200, height: 200 });
  await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: `/preview/${asset.id}.webp` });
  await ctx.newExif({ assetId: asset.id, exifImageHeight: 200, exifImageWidth: 200 });
  return asset;
};

const createPersonFaceIdentity = async (
  ctx: ReturnType<typeof setupFaceDetection>['ctx'],
  input: {
    ownerId: string;
    assetId: string;
    name: string;
    sourceType: SourceType;
    linkSource: 'ml' | 'manual' | 'import';
  },
) => {
  const faceIdentityRepository = ctx.get(FaceIdentityRepository);
  const { result: person } = await ctx.newPerson({ ownerId: input.ownerId, name: input.name });
  const identity = await faceIdentityRepository.ensurePersonIdentity(person.personGroupId);
  const { assetFace } = await ctx.newAssetFace({
    assetId: input.assetId,
    personGroupId: person.personGroupId,
    sourceType: input.sourceType,
  });
  await faceIdentityRepository.replaceFaceIdentity({
    assetFaceId: assetFace.id,
    identityId: identity.id,
    source: input.linkSource,
  });

  return { person, identity, assetFace };
};

const createSpacePersonFace = async (
  ctx: ReturnType<typeof setupFaceDetection>['ctx'],
  input: { spaceId: string; identityId: string; assetFaceId: string; name: string },
) => {
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: input.spaceId,
      identityId: input.identityId,
      name: input.name,
      type: 'person',
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await ctx.database
    .insertInto('shared_space_person_face')
    .values({ personId: spacePerson.id, assetFaceId: input.assetFaceId })
    .execute();

  return spacePerson;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

/** An owner's asset carrying one named face, shared with `viewer` through an album. */
const albumSharedAsset = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user: owner } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const { person } = await ctx.newPerson({ ownerId: owner.id, name: 'Alice', birthDate: '1990-05-13' });
  const { asset } = await ctx.newAsset({ ownerId: owner.id, width: 100, height: 100 });
  await ctx.newExif({ assetId: asset.id, exifImageHeight: 100, exifImageWidth: 100 });
  await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });

  const { album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Shared Album' });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
  await ctx.newAlbumUser({ albumId: album.id, userId: viewer.id });

  return { owner, viewer, person, asset };
};

describe(PersonService.name, () => {
    // Option M: Gallery does not adopt upstream's cluster-groups FEATURE, so a person_group never
    // holds more than one person row — the unique index `person_personGroupId_key` enforces it. The
    // test(s) removed here deliberately put a second owner's person into an existing group, which is
    // exactly the state Gallery declines to support. Restoring them is part of turning cluster
    // groups on; see docs/superpowers/specs/2026-08-21-cluster-groups-m-landing-plan.md.

  describe('handleQueueDetectFaces safety', () => {
    it('preserves manual and EXIF roots while force face detection removes stale machine-learning state', async () => {
      const { sut, ctx } = setupFaceDetection();
      const jobMock = ctx.getMock(JobRepository);
      const { user } = await ctx.newUser();
      const asset = await createAssetReadyForFaceDetection(ctx, user.id);
      await ctx.newJobStatus({ assetId: asset.id });

      const ml = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Machine',
        sourceType: SourceType.MachineLearning,
        linkSource: 'ml',
      });
      const manual = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Manual',
        sourceType: SourceType.Manual,
        linkSource: 'manual',
      });
      const exif = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Exif',
        sourceType: SourceType.Exif,
        linkSource: 'import',
      });

      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
      const mlSpacePerson = await createSpacePersonFace(ctx, {
        spaceId: space.id,
        identityId: ml.identity.id,
        assetFaceId: ml.assetFace.id,
        name: 'Machine Space',
      });
      const manualSpacePerson = await createSpacePersonFace(ctx, {
        spaceId: space.id,
        identityId: manual.identity.id,
        assetFaceId: manual.assetFace.id,
        name: 'Manual Space',
      });
      const exifSpacePerson = await createSpacePersonFace(ctx, {
        spaceId: space.id,
        identityId: exif.identity.id,
        assetFaceId: exif.assetFace.id,
        name: 'Exif Space',
      });

      await expect(sut.handleQueueDetectFaces({ force: true })).resolves.toBe(JobStatus.Success);

      await expect(getAssetFaces(ctx, asset.id)).resolves.toHaveLength(2);
      await expect(getAssetFaces(ctx, asset.id)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: exif.assetFace.id,
            personId: exif.person.personGroupId,
            sourceType: SourceType.Exif,
          }),
          expect.objectContaining({
            id: manual.assetFace.id,
            personId: manual.person.personGroupId,
            sourceType: SourceType.Manual,
          }),
        ]),
      );
      await expect(
        getIdentityLinks(ctx, [ml.assetFace.id, manual.assetFace.id, exif.assetFace.id]),
      ).resolves.toHaveLength(2);
      await expect(getIdentityLinks(ctx, [ml.assetFace.id, manual.assetFace.id, exif.assetFace.id])).resolves.toEqual(
        expect.arrayContaining([
          { assetFaceId: exif.assetFace.id, identityId: exif.identity.id, source: 'import' },
          { assetFaceId: manual.assetFace.id, identityId: manual.identity.id, source: 'manual' },
        ]),
      );
      await expect(
        ctx.database
          .selectFrom('person')
          .select(['personGroupId', 'name'])
          .where('personGroupId', 'in', [ml.person.personGroupId, manual.person.personGroupId, exif.person.personGroupId])
          .orderBy('name')
          .execute(),
      ).resolves.toEqual([
        { id: exif.person.personGroupId, name: 'Exif' },
        { id: manual.person.personGroupId, name: 'Manual' },
      ]);
      await expect(
        ctx.database
          .selectFrom('shared_space_person')
          .select(['id', 'identityId', 'name'])
          .where('id', 'in', [mlSpacePerson.id, manualSpacePerson.id, exifSpacePerson.id])
          .orderBy('name')
          .execute(),
      ).resolves.toEqual([
        { id: exifSpacePerson.id, identityId: exif.identity.id, name: 'Exif Space' },
        { id: manualSpacePerson.id, identityId: manual.identity.id, name: 'Manual Space' },
      ]);
      await expect(
        ctx.database
          .selectFrom('shared_space_person_face')
          .select(['personId', 'assetFaceId'])
          .where('personId', 'in', [mlSpacePerson.id, manualSpacePerson.id, exifSpacePerson.id])
          .orderBy('personId')
          .execute(),
      ).resolves.toHaveLength(2);
      await expect(
        ctx.database
          .selectFrom('shared_space_person_face')
          .select(['personId', 'assetFaceId'])
          .where('personId', 'in', [mlSpacePerson.id, manualSpacePerson.id, exifSpacePerson.id])
          .orderBy('personId')
          .execute(),
      ).resolves.toEqual(
        expect.arrayContaining([
          { personId: manualSpacePerson.id, assetFaceId: manual.assetFace.id },
          { personId: exifSpacePerson.id, assetFaceId: exif.assetFace.id },
        ]),
      );
      await expect(
        ctx.database
          .selectFrom('shared_space_person_face')
          .select(['personId', 'assetFaceId'])
          .where('personId', '=', mlSpacePerson.id)
          .execute(),
      ).resolves.toEqual([]);
      expect(jobMock.queueAll).toHaveBeenCalledWith([
        { name: JobName.AssetDetectFaces, data: { id: asset.id, force: true } },
      ]);
    });
  });

  describe('handleQueueRecognizeFaces safety', () => {
    it('preserves manual and EXIF identity evidence while force recognition resets ML assignments and queues rebuilds', async () => {
      const db = await getKyselyDB();
      try {
        const { sut, ctx } = setupFaceRecognition(db);
        const jobMock = ctx.getMock(JobRepository);
        const systemMetadataMock = ctx.getMock(SystemMetadataRepository);
        const { user } = await ctx.newUser();
        const asset = await createAssetReadyForFaceDetection(ctx, user.id);

        const ml = await createPersonFaceIdentity(ctx, {
          ownerId: user.id,
          assetId: asset.id,
          name: 'Machine',
          sourceType: SourceType.MachineLearning,
          linkSource: 'ml',
        });
        const manual = await createPersonFaceIdentity(ctx, {
          ownerId: user.id,
          assetId: asset.id,
          name: 'Manual',
          sourceType: SourceType.Manual,
          linkSource: 'manual',
        });
        const exif = await createPersonFaceIdentity(ctx, {
          ownerId: user.id,
          assetId: asset.id,
          name: 'Exif',
          sourceType: SourceType.Exif,
          linkSource: 'import',
        });

        const { space: enabledSpace } = await ctx.newSharedSpace({
          createdById: user.id,
          faceRecognitionEnabled: true,
        });
        const { space: disabledSpace } = await ctx.newSharedSpace({
          createdById: user.id,
          faceRecognitionEnabled: false,
        });
        await ctx.newSharedSpaceMember({ spaceId: enabledSpace.id, userId: user.id, role: SharedSpaceRole.Owner });
        await ctx.newSharedSpaceMember({ spaceId: disabledSpace.id, userId: user.id, role: SharedSpaceRole.Owner });
        await ctx.newSharedSpaceAsset({ spaceId: enabledSpace.id, assetId: asset.id, addedById: user.id });
        await ctx.newSharedSpaceAsset({ spaceId: disabledSpace.id, assetId: asset.id, addedById: user.id });
        await createSpacePersonFace(ctx, {
          spaceId: enabledSpace.id,
          identityId: ml.identity.id,
          assetFaceId: ml.assetFace.id,
          name: 'Machine Enabled Space',
        });
        await createSpacePersonFace(ctx, {
          spaceId: enabledSpace.id,
          identityId: manual.identity.id,
          assetFaceId: manual.assetFace.id,
          name: 'Manual Enabled Space',
        });
        await createSpacePersonFace(ctx, {
          spaceId: disabledSpace.id,
          identityId: exif.identity.id,
          assetFaceId: exif.assetFace.id,
          name: 'Exif Disabled Space',
        });

        await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);

        await expect(getAssetFaces(ctx, asset.id)).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: ml.assetFace.id, personId: null, sourceType: SourceType.MachineLearning }),
            expect.objectContaining({
              id: manual.assetFace.id,
              personId: manual.person.personGroupId,
              sourceType: SourceType.Manual,
            }),
            expect.objectContaining({ id: exif.assetFace.id, personId: exif.person.personGroupId, sourceType: SourceType.Exif }),
          ]),
        );
        await expect(getIdentityLinks(ctx, [ml.assetFace.id, manual.assetFace.id, exif.assetFace.id])).resolves.toEqual(
          expect.arrayContaining([
            { assetFaceId: manual.assetFace.id, identityId: manual.identity.id, source: 'manual' },
            { assetFaceId: exif.assetFace.id, identityId: exif.identity.id, source: 'import' },
          ]),
        );
        await expect(getIdentityLinks(ctx, [ml.assetFace.id])).resolves.toEqual([]);
        await expect(getPeopleByIds(ctx, [ml.person.personGroupId, manual.person.personGroupId, exif.person.personGroupId])).resolves.toEqual([
          { id: exif.person.personGroupId, name: 'Exif' },
          { id: manual.person.personGroupId, name: 'Manual' },
        ]);
        await expect(getSpacePeople(ctx, [enabledSpace.id, disabledSpace.id])).resolves.toEqual([]);

        const queuedJobs = jobMock.queueAll.mock.calls.flatMap(([jobs]) => jobs);
        // The PeopleBackfill wait is a separate, time-bounded call: a suggestion sweep can outlive a
        // forced recognition run, and the unbounded poll used to park that job indefinitely.
        expect(jobMock.waitForQueueCompletion).toHaveBeenCalledWith(
          QueueName.ThumbnailGeneration,
          QueueName.FaceDetection,
        );
        expect(jobMock.waitForQueueCompletion).toHaveBeenCalledWith(
          QueueName.PeopleBackfill,
          expect.objectContaining({ timeoutMs: expect.any(Number) }),
        );
        expect(jobMock.empty).toHaveBeenCalledWith(QueueName.FacialRecognition, true);
        expect(jobMock.queueAll).toHaveBeenCalledWith([
          {
            name: JobName.FacialRecognition,
            data: { id: ml.assetFace.id, deferred: false, skipSharedSpaceMatch: true },
          },
        ]);
        expect(jobMock.queueAll).toHaveBeenCalledWith([
          { name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: enabledSpace.id } },
        ]);
        expect(queuedJobs).not.toContainEqual({
          name: JobName.SharedSpaceFaceMatchAll,
          data: { spaceId: disabledSpace.id },
        });
        expect(jobMock.queue).toHaveBeenCalledWith({
          name: JobName.FaceIdentityMaintenanceAfterRecognition,
          data: {},
        });
        expect(systemMetadataMock.set).toHaveBeenCalledWith(SystemMetadataKey.FacialRecognitionState, {
          lastRun: expect.any(String),
        });
      } finally {
        await db.destroy();
      }
    });

    it('keeps force recognition idempotent over repeated runs with populated manual and EXIF evidence', async () => {
      const db = await getKyselyDB();
      try {
        const { sut, ctx } = setupFaceRecognition(db);
        const jobMock = ctx.getMock(JobRepository);
        const { user } = await ctx.newUser();
        const asset = await createAssetReadyForFaceDetection(ctx, user.id);
        const ml = await createPersonFaceIdentity(ctx, {
          ownerId: user.id,
          assetId: asset.id,
          name: 'Machine',
          sourceType: SourceType.MachineLearning,
          linkSource: 'ml',
        });
        const manual = await createPersonFaceIdentity(ctx, {
          ownerId: user.id,
          assetId: asset.id,
          name: 'Manual',
          sourceType: SourceType.Manual,
          linkSource: 'manual',
        });
        const exif = await createPersonFaceIdentity(ctx, {
          ownerId: user.id,
          assetId: asset.id,
          name: 'Exif',
          sourceType: SourceType.Exif,
          linkSource: 'import',
        });
        const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
        await createSpacePersonFace(ctx, {
          spaceId: space.id,
          identityId: ml.identity.id,
          assetFaceId: ml.assetFace.id,
          name: 'Machine Space',
        });

        await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);
        jobMock.queue.mockClear();
        jobMock.queueAll.mockClear();
        jobMock.empty.mockClear();

        await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);

        await expect(getAssetFaces(ctx, asset.id)).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: ml.assetFace.id, personId: null, sourceType: SourceType.MachineLearning }),
            expect.objectContaining({
              id: manual.assetFace.id,
              personId: manual.person.personGroupId,
              sourceType: SourceType.Manual,
            }),
            expect.objectContaining({ id: exif.assetFace.id, personId: exif.person.personGroupId, sourceType: SourceType.Exif }),
          ]),
        );
        await expect(getIdentityLinks(ctx, [ml.assetFace.id, manual.assetFace.id, exif.assetFace.id])).resolves.toEqual(
          expect.arrayContaining([
            { assetFaceId: manual.assetFace.id, identityId: manual.identity.id, source: 'manual' },
            { assetFaceId: exif.assetFace.id, identityId: exif.identity.id, source: 'import' },
          ]),
        );
        await expect(getIdentityLinks(ctx, [ml.assetFace.id])).resolves.toEqual([]);
        await expect(getSpacePeople(ctx, [space.id])).resolves.toEqual([]);
        expect(jobMock.empty).toHaveBeenCalledTimes(1);
        expect(jobMock.queueAll).toHaveBeenCalledWith([
          {
            name: JobName.FacialRecognition,
            data: { id: ml.assetFace.id, deferred: false, skipSharedSpaceMatch: true },
          },
        ]);
        expect(jobMock.queueAll).toHaveBeenCalledWith([
          { name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: space.id } },
        ]);
        expect(
          jobMock.queue.mock.calls.filter(([job]) => job.name === JobName.FaceIdentityMaintenanceAfterRecognition),
        ).toHaveLength(1);
        expect(jobMock.queue).toHaveBeenCalledWith({
          name: JobName.FaceIdentityMaintenanceAfterRecognition,
          data: {},
        });
      } finally {
        await db.destroy();
      }
    });
  });

  describe('handleDetectFaces face detection safety', () => {
    it('removes stale machine-learning faces without deleting people on non-force no-detected-faces runs', async () => {
      const { sut, ctx } = setupFaceDetection();
      const machineLearningMock = ctx.getMock(MachineLearningRepository);
      const { user } = await ctx.newUser();
      const asset = await createAssetReadyForFaceDetection(ctx, user.id);
      const ml = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Machine',
        sourceType: SourceType.MachineLearning,
        linkSource: 'ml',
      });
      const manual = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Manual',
        sourceType: SourceType.Manual,
        linkSource: 'manual',
      });
      const exif = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Exif',
        sourceType: SourceType.Exif,
        linkSource: 'import',
      });
      machineLearningMock.detectFaces.mockResolvedValue({ imageWidth: 200, imageHeight: 200, faces: [] });

      await expect(sut.handleDetectFaces({ id: asset.id })).resolves.toBe(JobStatus.Success);

      await expect(getAssetFaces(ctx, asset.id)).resolves.toHaveLength(2);
      await expect(getAssetFaces(ctx, asset.id)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: exif.assetFace.id, sourceType: SourceType.Exif }),
          expect.objectContaining({ id: manual.assetFace.id, sourceType: SourceType.Manual }),
        ]),
      );
      await expect(
        ctx.database
          .selectFrom('person')
          .select(['personGroupId', 'name'])
          .where('personGroupId', 'in', [ml.person.personGroupId, manual.person.personGroupId, exif.person.personGroupId])
          .orderBy('name')
          .execute(),
      ).resolves.toEqual([
        { id: exif.person.personGroupId, name: 'Exif' },
        { id: ml.person.personGroupId, name: 'Machine' },
        { id: manual.person.personGroupId, name: 'Manual' },
      ]);
      await expect(
        ctx.database
          .selectFrom('asset_job_status')
          .select('facesRecognizedAt')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ facesRecognizedAt: expect.any(Date) });
    });

    it('preserves manual and EXIF shared-space projections while removing stale machine-learning face links', async () => {
      const { sut, ctx } = setupFaceDetection();
      const machineLearningMock = ctx.getMock(MachineLearningRepository);
      const { user } = await ctx.newUser();
      const asset = await createAssetReadyForFaceDetection(ctx, user.id);
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
      const ml = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Machine',
        sourceType: SourceType.MachineLearning,
        linkSource: 'ml',
      });
      const manual = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Manual',
        sourceType: SourceType.Manual,
        linkSource: 'manual',
      });
      const exif = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Exif',
        sourceType: SourceType.Exif,
        linkSource: 'import',
      });
      const mlSpacePerson = await createSpacePersonFace(ctx, {
        spaceId: space.id,
        identityId: ml.identity.id,
        assetFaceId: ml.assetFace.id,
        name: 'Machine Space',
      });
      const manualSpacePerson = await createSpacePersonFace(ctx, {
        spaceId: space.id,
        identityId: manual.identity.id,
        assetFaceId: manual.assetFace.id,
        name: 'Manual Space',
      });
      const exifSpacePerson = await createSpacePersonFace(ctx, {
        spaceId: space.id,
        identityId: exif.identity.id,
        assetFaceId: exif.assetFace.id,
        name: 'Exif Space',
      });
      machineLearningMock.detectFaces.mockResolvedValue({ imageWidth: 200, imageHeight: 200, faces: [] });

      await expect(sut.handleDetectFaces({ id: asset.id })).resolves.toBe(JobStatus.Success);

      await expect(
        ctx.database.selectFrom('asset_face').select('id').where('id', '=', ml.assetFace.id).execute(),
      ).resolves.toEqual([]);
      await expect(
        ctx.database
          .selectFrom('shared_space_person')
          .select(['id', 'identityId', 'name'])
          .where('id', 'in', [mlSpacePerson.id, manualSpacePerson.id, exifSpacePerson.id])
          .orderBy('name')
          .execute(),
      ).resolves.toEqual([
        { id: exifSpacePerson.id, identityId: exif.identity.id, name: 'Exif Space' },
        { id: mlSpacePerson.id, identityId: ml.identity.id, name: 'Machine Space' },
        { id: manualSpacePerson.id, identityId: manual.identity.id, name: 'Manual Space' },
      ]);
      await expect(
        ctx.database
          .selectFrom('shared_space_person_face')
          .select(['personId', 'assetFaceId'])
          .where('personId', 'in', [mlSpacePerson.id, manualSpacePerson.id, exifSpacePerson.id])
          .orderBy('personId')
          .execute(),
      ).resolves.toHaveLength(2);
      await expect(
        ctx.database
          .selectFrom('shared_space_person_face')
          .select(['personId', 'assetFaceId'])
          .where('personId', 'in', [mlSpacePerson.id, manualSpacePerson.id, exifSpacePerson.id])
          .orderBy('personId')
          .execute(),
      ).resolves.toEqual(
        expect.arrayContaining([
          { personId: manualSpacePerson.id, assetFaceId: manual.assetFace.id },
          { personId: exifSpacePerson.id, assetFaceId: exif.assetFace.id },
        ]),
      );
      await expect(
        ctx.database
          .selectFrom('shared_space_person_face')
          .select(['personId', 'assetFaceId'])
          .where('personId', '=', mlSpacePerson.id)
          .execute(),
      ).resolves.toEqual([]);
    });
  });

  describe('mergePerson', () => {
    it('links reassigned faces to the target identity for identity-filtered timelines', async () => {
      const { sut, ctx } = setup();
      const assetRepo = ctx.get(AssetRepository);
      const faceIdentityRepo = ctx.get(FaceIdentityRepository);
      const { user } = await ctx.newUser();
      const { person: target } = await ctx.newPerson({ ownerId: user.id, name: 'Target' });
      const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Source' });
      const { asset: targetAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: sourceAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: targetFace } = await ctx.newAssetFace({ assetId: targetAsset.id, personGroupId: target.personGroupId });
      const { assetFace: sourceFace } = await ctx.newAssetFace({ assetId: sourceAsset.id, personGroupId: source.personGroupId });
      const existingTargetIdentity = await faceIdentityRepo.ensurePersonIdentity(target.personGroupId);
      await faceIdentityRepo.replaceFaceIdentity({
        assetFaceId: targetFace.id,
        identityId: existingTargetIdentity.id,
        source: 'owner-person',
      });

      await sut.mergePerson(factory.auth({ user }), target.personGroupId, { ids: [source.personGroupId] });

      const targetIdentity = await ctx.database
        .selectFrom('person')
        .select('identityId')
        .where('personGroupId', '=', target.personGroupId)
        .executeTakeFirstOrThrow();

      expect(targetIdentity.identityId).toBe(existingTargetIdentity.id);

      const links = await ctx.database
        .selectFrom('face_identity_face')
        .select(['assetFaceId', 'identityId', 'source'])
        .where('assetFaceId', 'in', [targetFace.id, sourceFace.id])
        .execute();

      expect(links).toEqual(
        expect.arrayContaining([
          { assetFaceId: targetFace.id, identityId: targetIdentity.identityId!, source: 'owner-person' },
          { assetFaceId: sourceFace.id, identityId: targetIdentity.identityId!, source: 'manual' },
        ]),
      );

      const buckets = await assetRepo.getTimeBuckets({
        identityIds: [targetIdentity.identityId!],
        userIds: [user.id],
        visibility: AssetVisibility.Timeline,
      }, factory.auth({ user: { id: user.id } }));

      expect(buckets.reduce((total, bucket) => total + Number(bucket.count), 0)).toBe(2);
    });

    it('repairs previously merged faces when people identity maintenance runs', async () => {
      const { sut, ctx } = setup();
      const assetRepo = ctx.get(AssetRepository);
      const faceIdentityRepo = ctx.get(FaceIdentityRepository);
      const jobMock = ctx.getMock(JobRepository);
      const { user } = await ctx.newUser();
      const { person: target } = await ctx.newPerson({ ownerId: user.id, name: 'Target' });
      const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Source' });
      const { asset: targetAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: sourceAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: targetFace } = await ctx.newAssetFace({ assetId: targetAsset.id, personGroupId: target.personGroupId });
      const { assetFace: sourceFace } = await ctx.newAssetFace({ assetId: sourceAsset.id, personGroupId: source.personGroupId });
      const targetIdentity = await faceIdentityRepo.ensurePersonIdentity(target.personGroupId);
      await faceIdentityRepo.replaceFaceIdentity({
        assetFaceId: targetFace.id,
        identityId: targetIdentity.id,
        source: 'owner-person',
      });
      await ctx.database
        .updateTable('asset_face')
        .set({ personGroupId: target.personGroupId })
        .where('id', '=', sourceFace.id)
        .execute();
      await ctx.database.deleteFrom('person').where('personGroupId', '=', source.personGroupId).execute();

      const bucketsBeforeRepair = await assetRepo.getTimeBuckets({
        identityIds: [targetIdentity.id],
        userIds: [user.id],
        visibility: AssetVisibility.Timeline,
      }, factory.auth({ user: { id: user.id } }));
      expect(bucketsBeforeRepair.reduce((total, bucket) => total + Number(bucket.count), 0)).toBe(1);

      jobMock.queue.mockResolvedValue();
      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      const sourceLink = await ctx.database
        .selectFrom('face_identity_face')
        .select(['identityId', 'source'])
        .where('assetFaceId', '=', sourceFace.id)
        .executeTakeFirstOrThrow();
      expect(sourceLink).toEqual({ identityId: targetIdentity.id, source: 'backfill' });

      const bucketsAfterRepair = await assetRepo.getTimeBuckets({
        identityIds: [targetIdentity.id],
        userIds: [user.id],
        visibility: AssetVisibility.Timeline,
      }, factory.auth({ user: { id: user.id } }));
      expect(bucketsAfterRepair.reduce((total, bucket) => total + Number(bucket.count), 0)).toBe(2);
    });
  });

  describe('delete', () => {
    it('should throw an error when there is no access', async () => {
      const { sut } = setup();
      const auth = factory.auth();
      const personId = factory.uuid();
      await expect(sut.delete(auth, personId)).rejects.toThrow('Not found or no person.delete access');
    });

    it('should delete the person', async () => {
      const { sut, ctx } = setup();
      const personRepo = ctx.get(PersonRepository);
      const jobMock = ctx.getMock(JobRepository);
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const auth = factory.auth({ user });
      jobMock.queue.mockResolvedValue();

      await expect(personRepo.getByGroupId(person)).resolves.toEqual(
        expect.objectContaining({ personGroupId: person.personGroupId }),
      );
      await expect(sut.delete(auth, person.personGroupId)).resolves.toBeUndefined();
      await expect(personRepo.getByGroupId(person)).resolves.toBeUndefined();

      expect(jobMock.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: { files: [person.thumbnailPath] },
      });
    });
  });

  describe('deleteAll', () => {
    it('should throw an error when there is no access', async () => {
      const { sut } = setup();
      const auth = factory.auth();
      const personId = factory.uuid();
      await expect(sut.deleteAll(auth, { ids: [personId] })).rejects.toThrow('Not found or no person.delete access');
    });

    it('should delete the person', async () => {
      const { sut, ctx } = setup();
      const jobMock = ctx.getMock(JobRepository);
      const personRepo = ctx.get(PersonRepository);
      const { user } = await ctx.newUser();
      const { person: person1 } = await ctx.newPerson({ ownerId: user.id });
      const { person: person2 } = await ctx.newPerson({ ownerId: user.id });
      const auth = factory.auth({ user });
      jobMock.queue.mockResolvedValue();

      await expect(
        sut.deleteAll(auth, { ids: [person1.personGroupId, person2.personGroupId] }),
      ).resolves.toBeUndefined();
      await expect(personRepo.getByGroupId(person1)).resolves.toBeUndefined();
      await expect(personRepo.getByGroupId(person2)).resolves.toBeUndefined();

      expect(jobMock.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: { files: [person1.thumbnailPath, person2.thumbnailPath] },
      });
    });
  });

  describe('handleQueueRecognizeFaces', () => {
    it('should delete all people and queue faces for recognition', async () => {
      const { sut, ctx } = setup();
      const jobRepo = ctx.getMock(JobRepository);
      ctx.getMock(StorageRepository).unlink.mockResolvedValue();
      jobRepo.waitForQueueCompletion.mockResolvedValue();
      jobRepo.getJobCounts.mockResolvedValue({ active: 0, waiting: 0, completed: 0, delayed: 0, failed: 0, paused: 0 });
      jobRepo.queueAll.mockResolvedValue();

      const { user } = await ctx.newUser();
      const { user: user1 } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: assetUser1 } = await ctx.newAsset({ ownerId: user1.id });
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { person: personUser1 } = await ctx.newPerson({ ownerId: user1.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const { assetFace: assetFaceUser1 } = await ctx.newAssetFace({
        assetId: assetUser1.id,
        personGroupId: personUser1.personGroupId,
      });

      await sut.handleQueueRecognizeFaces({ force: true });

      await expect(ctx.database.selectFrom('person').selectAll().execute()).resolves.toHaveLength(0);
      expect(jobRepo.queueAll).toHaveBeenCalledWith(
        expect.objectContaining([
          { name: JobName.FacialRecognition, data: { id: assetFace.id, deferred: false } },
          { name: JobName.FacialRecognition, data: { id: assetFaceUser1.id, deferred: false } },
        ]),
      );
    });

    it('should only delete all people of a specified cluster group and queue their faces for recognition', async () => {
      const { sut, ctx } = setup();
      const jobRepo = ctx.getMock(JobRepository);
      ctx.getMock(StorageRepository).unlink.mockResolvedValue();
      jobRepo.waitForQueueCompletion.mockResolvedValue();
      jobRepo.getJobCounts.mockResolvedValue({ active: 0, waiting: 0, completed: 0, delayed: 0, failed: 0, paused: 0 });
      jobRepo.queueAll.mockResolvedValue();

      const { user } = await ctx.newUser();
      const { user: user1 } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: assetUser1 } = await ctx.newAsset({ ownerId: user1.id });
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { person: personUser1 } = await ctx.newPerson({ ownerId: user1.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const { assetFace: assetFaceUser1 } = await ctx.newAssetFace({
        assetId: assetUser1.id,
        personGroupId: personUser1.personGroupId,
      });

      await sut.handleQueueRecognizeFaces({ force: true, clusterGroupId: user.clusterGroupId });

      await expect(ctx.database.selectFrom('person').selectAll().execute()).resolves.toHaveLength(1);
      expect(jobRepo.queueAll).toHaveBeenCalledWith(
        expect.objectContaining([{ name: JobName.FacialRecognition, data: { id: assetFace.id, deferred: false } }]),
      );
      expect(jobRepo.queueAll).not.toHaveBeenCalledWith(
        expect.objectContaining([
          { name: JobName.FacialRecognition, data: { id: assetFace.id, deferred: false } },
          { name: JobName.FacialRecognition, data: { id: assetFaceUser1.id, deferred: false } },
        ]),
      );
    });
  });

  describe('mergePerson', () => {
  });

  describe('createFace', () => {
    it('should store and retrieve the face as-is when there are no edits', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 200, height: 200 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 200, exifImageWidth: 200 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 200,
        imageHeight: 200,
        x: 50,
        y: 50,
        width: 150,
        height: 150,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      // retrieve an asset's faces
      const faces = sut.getFacesById(auth, { id: asset.id });

      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 50,
            boundingBoxY1: 50,
            boundingBoxX2: 200,
            boundingBoxY2: 200,
          }),
        ]),
      );
    });

    it('should properly transform the coordinates when the asset is edited (Crop)', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 150, height: 200 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 200, exifImageWidth: 200 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Crop,
            parameters: {
              x: 50,
              y: 50,
              width: 150,
              height: 200,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 150,
        imageHeight: 200,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      // retrieve an asset's faces
      const faces = sut.getFacesById(auth, { id: asset.id });

      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 0,
            boundingBoxY1: 0,
            boundingBoxX2: 100,
            boundingBoxY2: 100,
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });

      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toHaveLength(1);
      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 50,
            boundingBoxY1: 50,
            boundingBoxX2: 150,
            boundingBoxY2: 150,
          }),
        ]),
      );
    });

    it('should properly transform the coordinates when the asset is edited (Rotate 90)', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 100, height: 200 });
      await ctx.newExif({ assetId: asset.id, exifImageWidth: 200, exifImageHeight: 100 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Rotate,
            parameters: {
              angle: 90,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 100,
        imageHeight: 200,
        x: 25,
        y: 50,
        width: 10,
        height: 10,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      const faces = sut.getFacesById(auth, { id: asset.id });
      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: expect.closeTo(25, 1),
            boundingBoxY1: expect.closeTo(50, 1),
            boundingBoxX2: expect.closeTo(35, 1),
            boundingBoxY2: expect.closeTo(60, 1),
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });
      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 50,
            boundingBoxY1: 65,
            boundingBoxX2: 60,
            boundingBoxY2: 75,
          }),
        ]),
      );
    });

    it('should properly transform the coordinates when the asset is edited (Mirror Horizontal)', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 200, height: 100 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 100, exifImageWidth: 200 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Mirror,
            parameters: {
              axis: MirrorAxis.Horizontal,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 200,
        imageHeight: 100,
        x: 50,
        y: 25,
        width: 100,
        height: 50,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      const faces = sut.getFacesById(auth, { id: asset.id });
      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 50,
            boundingBoxY1: 25,
            boundingBoxX2: 150,
            boundingBoxY2: 75,
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });
      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 50,
            boundingBoxY1: 25,
            boundingBoxX2: 150,
            boundingBoxY2: 75,
          }),
        ]),
      );
    });

    it('should properly transform the coordinates when the asset is edited (Crop + Rotate)', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 200, height: 150 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 200, exifImageWidth: 200 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Crop,
            parameters: {
              x: 50,
              y: 0,
              width: 150,
              height: 200,
            },
          },
          {
            action: AssetEditAction.Rotate,
            parameters: {
              angle: 90,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 200,
        imageHeight: 150,
        x: 50,
        y: 25,
        width: 10,
        height: 20,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      const faces = sut.getFacesById(auth, { id: asset.id });
      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: expect.closeTo(50, 1),
            boundingBoxY1: expect.closeTo(25, 1),
            boundingBoxX2: expect.closeTo(60, 1),
            boundingBoxY2: expect.closeTo(45, 1),
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });
      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 75,
            boundingBoxY1: 140,
            boundingBoxX2: 95,
            boundingBoxY2: 150,
          }),
        ]),
      );
    });

    it('should properly transform the coordinates when the asset is edited (Crop + Mirror)', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 150, height: 100 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 100, exifImageWidth: 200 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Crop,
            parameters: {
              x: 50,
              y: 0,
              width: 150,
              height: 100,
            },
          },
          {
            action: AssetEditAction.Mirror,
            parameters: {
              axis: MirrorAxis.Horizontal,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 150,
        imageHeight: 100,
        x: 25,
        y: 25,
        width: 75,
        height: 50,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      const faces = sut.getFacesById(auth, { id: asset.id });
      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 25,
            boundingBoxY1: 25,
            boundingBoxX2: 100,
            boundingBoxY2: 75,
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });
      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 100,
            boundingBoxY1: 25,
            boundingBoxX2: 175,
            boundingBoxY2: 75,
          }),
        ]),
      );
    });

    it('should properly transform the coordinates when the asset is edited (Rotate + Mirror)', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 200, height: 150 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 200, exifImageWidth: 150 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Rotate,
            parameters: {
              angle: 90,
            },
          },
          {
            action: AssetEditAction.Mirror,
            parameters: {
              axis: MirrorAxis.Horizontal,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 200,
        imageHeight: 150,
        x: 50,
        y: 25,
        width: 15,
        height: 20,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      const faces = sut.getFacesById(auth, { id: asset.id });
      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: expect.closeTo(50, 1),
            boundingBoxY1: expect.closeTo(25, 1),
            boundingBoxX2: expect.closeTo(65, 1),
            boundingBoxY2: expect.closeTo(45, 1),
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });
      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 25,
            boundingBoxY1: 50,
            boundingBoxX2: 45,
            boundingBoxY2: 65,
          }),
        ]),
      );
    });

    it('should properly transform the coordinates when the asset is edited (Crop + Rotate + Mirror)', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 150, height: 100 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 200, exifImageWidth: 200 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Crop,
            parameters: {
              x: 50,
              y: 25,
              width: 100,
              height: 150,
            },
          },
          {
            action: AssetEditAction.Rotate,
            parameters: {
              angle: 270,
            },
          },
          {
            action: AssetEditAction.Mirror,
            parameters: {
              axis: MirrorAxis.Horizontal,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 150,
        imageHeight: 150,
        x: 25,
        y: 50,
        width: 75,
        height: 50,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      const faces = sut.getFacesById(auth, { id: asset.id });
      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 25,
            boundingBoxY1: 49,
            boundingBoxX2: 99,
            boundingBoxY2: 100,
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });
      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 50,
            boundingBoxY1: 75,
            boundingBoxX2: 100,
            boundingBoxY2: 150,
          }),
        ]),
      );
    });

    it('should properly transform the coordinates with multiple mirrors in sequence', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 100, height: 100 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 100, exifImageWidth: 100 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Mirror,
            parameters: {
              axis: MirrorAxis.Horizontal,
            },
          },
          {
            action: AssetEditAction.Mirror,
            parameters: {
              axis: MirrorAxis.Vertical,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 100,
        imageHeight: 100,
        x: 10,
        y: 10,
        width: 80,
        height: 80,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      const faces = sut.getFacesById(auth, { id: asset.id });
      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 10,
            boundingBoxY1: 10,
            boundingBoxX2: 90,
            boundingBoxY2: 90,
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });
      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 10,
            boundingBoxY1: 10,
            boundingBoxX2: 90,
            boundingBoxY2: 90,
          }),
        ]),
      );
    });

    it('should properly handle exif orientation when creating a face on an edited asset', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 100, height: 100 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 200, exifImageWidth: 100, orientation: '6' });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Mirror,
            parameters: {
              axis: MirrorAxis.Horizontal,
            },
          },
          {
            action: AssetEditAction.Mirror,
            parameters: {
              axis: MirrorAxis.Vertical,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 100,
        imageHeight: 100,
        x: 10,
        y: 10,
        width: 80,
        height: 80,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      const faces = sut.getFacesById(auth, { id: asset.id });
      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 110,
            boundingBoxY1: 10,
            boundingBoxX2: 190,
            boundingBoxY2: 90,
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });
      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 10,
            boundingBoxY1: 10,
            boundingBoxX2: 90,
            boundingBoxY2: 90,
          }),
        ]),
      );
    });
  });

  // #796: the asset-viewer info panel renders its People section from GET /faces for any viewer
  // with no space context (shared-album recipient, partner). These pin what that endpoint actually
  // serves a non-owner — the web panel can only display what survives mapFaces' owner check.
  describe('getFacesById (non-owner read access)', () => {
    it('grants a shared-album recipient read access to the faces', async () => {
      const { sut, ctx } = setup();
      const { viewer, asset } = await albumSharedAsset(ctx);

      const faces = await sut.getFacesById(factory.auth({ user: viewer }), { id: asset.id });

      expect(faces).toHaveLength(1);
    });

    it('returns the person identity to a shared-album recipient', async () => {
      const { sut, ctx } = setup();
      const { viewer, asset, person } = await albumSharedAsset(ctx);

      const faces = await sut.getFacesById(factory.auth({ user: viewer }), { id: asset.id });

      // #796: who is in a photo is metadata anyone with read access may see. The access check has
      // already run (Permission.AssetRead), so every face reaching this mapper belongs to an asset
      // the caller is entitled to.
      expect(faces[0].person).toEqual(expect.objectContaining({ id: person.personGroupId, name: 'Alice' }));
    });

    it('includes the person birth date so the viewer sees an age', async () => {
      const { sut, ctx } = setup();
      const { viewer, asset } = await albumSharedAsset(ctx);

      const faces = await sut.getFacesById(factory.auth({ user: viewer }), { id: asset.id });

      expect(faces[0].person?.birthDate).toBe('1990-05-13');
    });

    it('hides a hidden person from a non-owner', async () => {
      const { sut, ctx } = setup();
      const { viewer, asset, person } = await albumSharedAsset(ctx);
      await ctx.database.updateTable('person').set({ isHidden: true }).where('personGroupId', '=', person.personGroupId).execute();

      const faces = await sut.getFacesById(factory.auth({ user: viewer }), { id: asset.id });

      // A person the owner marked hidden must not leak to a viewer. Filtering this client-side
      // would be cosmetic only — the identity would still be on the wire.
      expect(faces).toEqual([]);
    });

    it('still returns a hidden person to the owner', async () => {
      const { sut, ctx } = setup();
      const { owner, asset, person } = await albumSharedAsset(ctx);
      await ctx.database.updateTable('person').set({ isHidden: true }).where('personGroupId', '=', person.personGroupId).execute();

      const faces = await sut.getFacesById(factory.auth({ user: owner }), { id: asset.id });

      expect(faces[0].person).toEqual(expect.objectContaining({ id: person.personGroupId }));
    });

    it('returns the person identity to the owner', async () => {
      const { sut, ctx } = setup();
      const { owner, person, asset } = await albumSharedAsset(ctx);

      const faces = await sut.getFacesById(factory.auth({ user: owner }), { id: asset.id });

      expect(faces[0].person).toEqual(expect.objectContaining({ id: person.personGroupId, name: 'Alice' }));
    });
  });

  describe('getFacesById shared-space birthday resolution', () => {
    it('returns a birthday that only exists on a manual shared-space profile', async () => {
      const { sut, user, person, asset } = await seedSpaceOnlyBirthday('manual');

      const faces = await sut.getFacesById(factory.auth({ user }), { id: asset.id });

      expect(faces).toHaveLength(1);
      expect(faces[0].person).toEqual(
        expect.objectContaining({ id: person.personGroupId, name: 'Karolin', birthDate: '2014-02-14' }),
      );
    });

    it('returns a birthday inherited across spaces from a sibling profile', async () => {
      const { sut, user, asset } = await seedSpaceOnlyBirthday('inherited');

      const faces = await sut.getFacesById(factory.auth({ user }), { id: asset.id });

      expect(faces[0].person?.birthDate).toBe('2014-02-14');
    });

    it('leaves the birthday null when no profile of the identity carries one', async () => {
      const { sut, ctx } = setup();
      const faceIdentityRepository = ctx.get(FaceIdentityRepository);
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Karolin', birthDate: null });
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      await ctx.newExif({ assetId: asset.id, exifImageWidth: 400, exifImageHeight: 500 });
      const { result: faceId } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const identity = await faceIdentityRepository.ensurePersonIdentity(person.personGroupId);
      await faceIdentityRepository.linkFace({ assetFaceId: faceId, identityId: identity.id, source: 'owner-person' });

      const faces = await sut.getFacesById(factory.auth({ user }), { id: asset.id });

      expect(faces[0].person).toEqual(expect.objectContaining({ id: person.personGroupId, birthDate: null }));
    });

    it("does not leak a space birthday to a viewer who cannot see the person's face", async () => {
      const { sut, ctx, asset } = await seedSpaceOnlyBirthday('manual');
      const { user: outsider } = await ctx.newUser();

      // The outsider is not a member of the space and does not own the asset — `mapFaces` must keep
      // returning no person at all rather than an identity-resolved one.
      await expect(sut.getFacesById(factory.auth({ user: outsider }), { id: asset.id })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // #869 follow-up: the representative-face picker (GET /people/:id/faces) runs UNSCOPED for the owner —
  // the space scope that carries the visibility gate is only applied to non-owner callers. So the picker
  // enumerated the owner's Locked Folder faces (asset id, bounding box, capture date) to a session that
  // had never entered the PIN. The crop bytes were already refused by the AssetRead check on the
  // per-face thumbnail route, so this is a metadata leak, but it is the same rule.
  describe('getFacesForPicker locked-folder visibility', () => {
    it('omits faces on locked assets from a non-elevated owner', async () => {
      const { sut, ctx } = setup();
      const { user, person, timelineAsset } = await seedPersonAcrossVisibilities(ctx);

      const result = await sut.getFacesForPicker(factory.auth({ user: { id: user.id } }), person.personGroupId, {
        page: 1,
        size: 50,
      });

      expect(result.faces.map((face) => face.assetId)).toEqual([timelineAsset.id]);
    });

    it('includes faces on locked assets for an elevated owner', async () => {
      const { sut, ctx } = setup();
      const { user, person, timelineAsset, lockedAsset } = await seedPersonAcrossVisibilities(ctx);

      const auth = factory.auth({ user: { id: user.id }, session: { hasElevatedPermission: true } });
      const result = await sut.getFacesForPicker(auth, person.personGroupId, { page: 1, size: 50 });

      expect(result.faces.map((face) => face.assetId).toSorted()).toEqual(
        [timelineAsset.id, lockedAsset.id].toSorted(),
      );
    });
  });

  // #869 follow-up: the person thumbnail is a crop of `person.faceAssetId`. The owner arm of
  // requireThumbnailAccess only proved `person.ownerId = caller`, so a person whose representative face
  // sits in the Locked Folder served that crop over HTTP 200 to a session that had never entered a PIN.
  // (The shared-space arm below it already restricts to Timeline+Archive, so only the owner arm leaked.)
  describe('getThumbnail locked-folder visibility', () => {
    // Serving the bytes needs a bootstrapped StorageService backend, which the medium harness does not
    // have, so the ALLOWED cases seed an empty `thumbnailPath` and assert NotFoundException: the 404 is
    // raised after requireThumbnailAccess returns, so reaching it proves the visibility gate let the
    // request through. A blocked request throws BadRequestException before that point. The byte-serving
    // path itself is covered in src/services/person.service.spec.ts.
    it('refuses the owner a thumbnail cropped from a locked asset while the session is not elevated', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await seedPersonWithRepresentativeFace(
        ctx,
        user.id,
        AssetVisibility.Locked,
        'upload/thumbs/vera.jpeg',
      );

      await expect(sut.getThumbnail(factory.auth({ user: { id: user.id } }), person.personGroupId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('lets an elevated owner past the gate for a locked-asset thumbnail', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await seedPersonWithRepresentativeFace(ctx, user.id, AssetVisibility.Locked, '');

      const auth = factory.auth({ user: { id: user.id }, session: { hasElevatedPermission: true } });

      await expect(sut.getThumbnail(auth, person.personGroupId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets a non-elevated owner past the gate for a timeline-asset thumbnail', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await seedPersonWithRepresentativeFace(ctx, user.id, AssetVisibility.Timeline, '');

      await expect(sut.getThumbnail(factory.auth({ user: { id: user.id } }), person.personGroupId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    // `person.faceAssetId` is `ON DELETE SET NULL`, so a person can keep a thumbnail after losing its
    // representative face row. There is no locked source to leak in that case, and the gate must not
    // start refusing those people.
    it('lets a person with no representative face past the gate', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Faceless Fay', thumbnailPath: '' });

      await expect(sut.getThumbnail(factory.auth({ user: { id: user.id } }), person.personGroupId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    // Regression guard: the locked check runs on the shared-space arm too, so prove the ordinary viewer
    // case still passes it. Without this, tightening the gate could silently break every space thumbnail.
    it('still lets a shared-space viewer past the gate for a timeline-sourced thumbnail', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();

      const { asset, person } = await seedPersonWithRepresentativeFace(ctx, owner.id, AssetVisibility.Timeline, '');
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });

      await expect(sut.getThumbnail(factory.auth({ user: { id: viewer.id } }), person.personGroupId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    // The shared-space arm grants person.read off ANY space-visible face, but the thumbnail is a crop of
    // the representative face specifically. A viewer must never receive a crop of the owner's Locked
    // Folder photo — and unlike the owner, no amount of elevation on the viewer's own session changes that.
    it("refuses a shared-space viewer a thumbnail cropped from the owner's locked asset", async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();

      const { person } = await seedPersonWithRepresentativeFace(
        ctx,
        owner.id,
        AssetVisibility.Locked,
        'upload/thumbs/vera.jpeg',
      );

      // A second, space-shared face is what grants the viewer person.read in the first place.
      const { asset: sharedAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      await ctx.newAssetFace({ assetId: sharedAsset.id, personGroupId: person.personGroupId });
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: sharedAsset.id, addedById: owner.id });

      const auth = factory.auth({ user: { id: viewer.id }, session: { hasElevatedPermission: true } });

      await expect(sut.getThumbnail(auth, person.personGroupId)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // D14/Slice 9: confirm's claim -> reassign -> resolveAssignedFace -> identity-relink chain must be one
  // atomic unit. Before this slice each write autocommitted separately, so a crash/failure between the
  // reassign and the relink left the face pointed at the new person WITHOUT a manual identity link (a torn
  // write) and the claimed pending row gone for good — the exact defect class executeRepair's per-route
  // transaction (A1) already closes for the cleanup engine.
  describe('confirmFaceSuggestion (atomicity)', () => {
    // Slice 3 (S3.9) added an isFaceSuggestionEnabled short-circuit ahead of the transaction, so this test's
    // config must enable suggestions with a valid band — plain setup() defaults leave suggestions disabled,
    // which would resolve confirmFaceSuggestion before it ever reaches the write chain under test.
    const enabled = {
      machineLearning: {
        enabled: true,
        facialRecognition: {
          enabled: true,
          maxDistance: 0.5,
          minFaces: 3,
          suggestions: { enabled: true, maxDistance: 0.8 },
        },
      },
    };

    it('rolls back the reassign when the identity relink fails (no torn write)', async () => {
      const { ctx } = setup();
      // Slice 13: confirmFaceSuggestion moved to FaceSuggestionService. Sharing `ctx`'s exact dependency
      // instances means the spy below (on the real faceIdentityRepo) is observed by this sut exactly the
      // same as it would have been on PersonService before the move.
      const faceSuggestion = ctx.getService(FaceSuggestionService);
      ctx.getMock(SystemMetadataRepository).get.mockResolvedValue(enabled as any);
      const faceIdentityRepo = ctx.get(FaceIdentityRepository);
      const verdictRepo = ctx.get(FacePersonVerdictRepository);
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });

      // P is the suggested target. A real suggestion sits on an UNASSIGNED face — confirm's job is to make
      // the assignment, not to steal the face from someone else.
      const { person: p } = await ctx.newPerson({ ownerId: user.id, name: 'P' });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: face } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: null });
      // distance 0.6 sits strictly inside the open eligibility band (0.5, 0.8] — a valid, claimable row.
      await verdictRepo.upsertPending([{ personId: p.personGroupId, assetFaceId: face.id, distance: 0.6 }]);

      // Positive control: the seeded row really is pending before the confirm call touches anything.
      const seeded = await ctx.database
        .selectFrom('face_person_verdict')
        .select(['status'])
        .where('personId', '=', p.personGroupId)
        .where('assetFaceId', '=', face.id)
        .executeTakeFirstOrThrow();
      expect(seeded.status).toBe('pending');

      // The LAST write in the chain fails.
      vi.spyOn(faceIdentityRepo, 'replaceFaceIdentity').mockRejectedValueOnce(new Error('relink failed'));

      await expect(faceSuggestion.confirmFaceSuggestion(auth, p.personGroupId, face.id)).rejects.toThrow('relink failed');

      // The reassign must have rolled back — the face is still unassigned.
      const reloadedFace = await ctx.database
        .selectFrom('asset_face')
        .select('personGroupId')
        .where('id', '=', face.id)
        .executeTakeFirstOrThrow();
      expect(reloadedFace.personId).toBeNull();

      // No manual identity link was left dangling on the face.
      const identityLink = await ctx.database
        .selectFrom('face_identity_face')
        .select('assetFaceId')
        .where('assetFaceId', '=', face.id)
        .executeTakeFirst();
      expect(identityLink).toBeUndefined();

      // The claim must have rolled back too — the row is still pending (claim-then-work contract, R4).
      const verdict = await ctx.database
        .selectFrom('face_person_verdict')
        .select(['status'])
        .where('personId', '=', p.personGroupId)
        .where('assetFaceId', '=', face.id)
        .executeTakeFirst();
      expect(verdict?.status).toBe('pending');
    });
  });

  // Slice 1 (§4 decision): facial recognition is deliberately OUT of scope for the Locked/Hidden exclusion —
  // it keeps clustering Locked-folder faces into the owner's own people exactly as before this slice. S1.14
  // pins that: a Locked-asset anchor face must still be usable as a recognition neighbor.
  describe('handleRecognizeFaces visibility scoping (Slice 1, S1.14 pin)', () => {
    it('S1.14: a locked-asset anchor face still gets a timeline query face assigned to its person', async () => {
      const { sut, ctx } = setupRecognition();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Anchor' });

      const embedding = newEmbedding();

      // The anchor: an already-assigned ML face on a LOCKED asset.
      const { asset: anchorAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      const { assetFace: anchorFace } = await ctx.newAssetFace({
        assetId: anchorAsset.id,
        personGroupId: person.personGroupId,
        sourceType: SourceType.MachineLearning,
      });
      await ctx.database.insertInto('face_search').values({ faceId: anchorFace.id, embedding }).execute();

      // The query face: unassigned, on a Timeline asset, with the SAME embedding (distance 0 — guaranteed match).
      const { asset: queryAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { assetFace: queryFace } = await ctx.newAssetFace({
        assetId: queryAsset.id,
        personGroupId: null,
        sourceType: SourceType.MachineLearning,
      });
      await ctx.database.insertInto('face_search').values({ faceId: queryFace.id, embedding }).execute();

      await sut.handleRecognizeFaces({ id: queryFace.id, deferred: false });

      const row = await ctx.database
        .selectFrom('asset_face')
        .select('personGroupId')
        .where('id', '=', queryFace.id)
        .executeTakeFirstOrThrow();
      expect(row.personId).toBe(person.personGroupId);
    });
  });
});
