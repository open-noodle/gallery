import { SystemConfig } from 'src/config';
import { PET_RECOGNITION_MODEL_NAMES } from 'src/constants';
import { JobName, JobStatus, QueueName, SystemMetadataKey, VectorIndex } from 'src/enum';
import { PetRecognitionService } from 'src/services/pet-recognition.service';
import { makeStream, newTestService, ServiceMocks } from 'test/utils';

// Mirrors person.service.spec.ts's `recognitionCounts` for the sibling FacialRecognition queue —
// used to stub QueueName.PetRecognition's own job counts for the non-force pending-work skip.
const petRecognitionCounts = (
  overrides: Partial<{
    active: number;
    waiting: number;
    delayed: number;
    paused: number;
    completed: number;
    failed: number;
  }> = {},
) => ({
  active: 1,
  waiting: 0,
  delayed: 0,
  paused: 0,
  completed: 0,
  failed: 0,
  ...overrides,
});

const enabledConfig = {
  machineLearning: {
    enabled: true,
    petRecognition: { enabled: true, modelName: 'pet-recognition-base', maxDistance: 0.55, minFaces: 1 },
  },
};

// Full config shape (petDetection + petRecognition) for the model-switch hook tests: onConfigInit /
// onConfigUpdate receive the event payload directly (not via getConfig), so unlike enabledConfig
// above these must not rely on the defaults merge to fill in petDetection.
const makeConfig = ({
  recognitionEnabled = true,
  detectionEnabled = true,
  modelName = 'pet-recognition-base',
  minFaces = 1,
}: {
  recognitionEnabled?: boolean;
  detectionEnabled?: boolean;
  modelName?: string;
  minFaces?: number;
} = {}): SystemConfig =>
  ({
    machineLearning: {
      enabled: true,
      petDetection: { enabled: detectionEnabled, modelName: 'yolo11n', minScore: 0.6 },
      petRecognition: { enabled: recognitionEnabled, modelName, maxDistance: 0.55, minFaces },
    },
  }) as SystemConfig;

const makePetFace = (overrides: Record<string, unknown> = {}) => ({
  id: 'face-id',
  assetId: 'asset-id',
  personId: null,
  asset: { ownerId: 'owner-id' },
  petSearch: { faceId: 'face-id', embedding: '[1,2,3]', species: null },
  ...overrides,
});

const makePerson = (overrides: Record<string, unknown> = {}) => ({
  id: 'person-id',
  identityId: null,
  ownerId: 'owner-id',
  name: '',
  type: 'pet',
  species: 'dog',
  createdAt: new Date(),
  updatedAt: new Date(),
  updateId: 'update-id',
  birthDate: null,
  color: null,
  faceAssetId: null,
  isFavorite: false,
  isHidden: false,
  thumbnailPath: '',
  ...overrides,
});

describe(PetRecognitionService.name, () => {
  let sut: PetRecognitionService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(PetRecognitionService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('onConfigValidate', () => {
    it('R5.1 throws for an unknown pet recognition model', () => {
      expect(() =>
        sut.onConfigValidate({
          newConfig: { machineLearning: { petRecognition: { modelName: 'pet-recognition-huge' } } } as SystemConfig,
          oldConfig: {} as SystemConfig,
        }),
      ).toThrow('Unknown pet recognition model: pet-recognition-huge');
    });

    it.each(PET_RECOGNITION_MODEL_NAMES)('R5.1 allows the whitelisted model %s', (modelName) => {
      expect(() =>
        sut.onConfigValidate({
          newConfig: { machineLearning: { petRecognition: { modelName } } } as SystemConfig,
          oldConfig: {} as SystemConfig,
        }),
      ).not.toThrow();
    });
  });

  describe('model switch (onConfigInit / onConfigUpdate)', () => {
    it('R5.2 live switch with recognition and detection both on: empties both pet queues, scoped purge, stamps state, requeues detection force', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ modelName: 'pet-recognition-base' });
      mocks.person.purgePetRecognitionArtifacts.mockResolvedValue();

      await sut.onConfigUpdate({
        oldConfig: makeConfig({ modelName: 'pet-recognition-base' }),
        newConfig: makeConfig({ modelName: 'pet-recognition-large' }),
      });

      expect(mocks.job.empty).toHaveBeenCalledWith(QueueName.PetRecognition, true);
      expect(mocks.job.empty).toHaveBeenCalledWith(QueueName.PetDetection, true);
      expect(mocks.person.purgePetRecognitionArtifacts).toHaveBeenCalled();
      expect(mocks.person.deleteAllPets).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.PetRecognitionState, {
        lastRun: expect.any(String),
        modelName: 'pet-recognition-large',
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PetDetectionQueueAll, data: { force: true } });
    });

    it('R5.3 config change without a model change: no purge, no requeue', async () => {
      mocks.systemMetadata.get.mockResolvedValue(null);

      await sut.onConfigUpdate({
        oldConfig: makeConfig({ minFaces: 1 }),
        newConfig: makeConfig({ minFaces: 2 }),
      });

      expect(mocks.person.purgePetRecognitionArtifacts).not.toHaveBeenCalled();
      expect(mocks.job.empty).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
    });

    it('R5.4 idempotency: a second onConfigUpdate delivery carrying the same stale oldConfig no-ops once state is stamped', async () => {
      // Simulates two ConfigUpdate deliveries (e.g. multiple non-API workers) racing the same
      // switch: both carry the same (stale) oldConfig, but state was already stamped by the first.
      mocks.systemMetadata.get.mockResolvedValue({ modelName: 'pet-recognition-large' });

      await sut.onConfigUpdate({
        oldConfig: makeConfig({ modelName: 'pet-recognition-base' }),
        newConfig: makeConfig({ modelName: 'pet-recognition-large' }),
      });

      expect(mocks.person.purgePetRecognitionArtifacts).not.toHaveBeenCalled();
      expect(mocks.job.empty).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
    });

    it('R5.5 switch with recognition on / detection off: scoped purge, pendingReprocess stamped, no requeue, warns about a force run', async () => {
      mocks.systemMetadata.get.mockResolvedValue(null);
      mocks.person.purgePetRecognitionArtifacts.mockResolvedValue();

      await sut.onConfigUpdate({
        oldConfig: makeConfig({ modelName: 'pet-recognition-base', detectionEnabled: false }),
        newConfig: makeConfig({ modelName: 'pet-recognition-large', detectionEnabled: false }),
      });

      expect(mocks.person.purgePetRecognitionArtifacts).toHaveBeenCalled();
      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.PetRecognitionState, {
        lastRun: expect.any(String),
        modelName: 'pet-recognition-large',
        pendingReprocess: true,
      });
      expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.PetDetectionQueueAll }));
      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('force'));
    });

    it('R5.6 detection re-enabled while pendingReprocess is set: requeues detection force and clears the flag', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        modelName: 'pet-recognition-large',
        lastRun: '2026-07-01T00:00:00.000Z',
        pendingReprocess: true,
      });

      await sut.onConfigUpdate({
        oldConfig: makeConfig({ modelName: 'pet-recognition-large', detectionEnabled: false }),
        newConfig: makeConfig({ modelName: 'pet-recognition-large', detectionEnabled: true }),
      });

      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.PetRecognitionState, {
        modelName: 'pet-recognition-large',
        lastRun: '2026-07-01T00:00:00.000Z',
        pendingReprocess: false,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PetDetectionQueueAll, data: { force: true } });
      expect(mocks.person.purgePetRecognitionArtifacts).not.toHaveBeenCalled();
    });

    it('R5.7 switch with recognition off: scoped purge runs (not the full deleteAllPets purge), no requeue, no pendingReprocess flag', async () => {
      mocks.systemMetadata.get.mockResolvedValue(null);
      mocks.person.purgePetRecognitionArtifacts.mockResolvedValue();

      await sut.onConfigUpdate({
        oldConfig: makeConfig({ modelName: 'pet-recognition-base', recognitionEnabled: false }),
        newConfig: makeConfig({ modelName: 'pet-recognition-large', recognitionEnabled: false }),
      });

      // The scoped purge runs (species buckets are protected by its SQL — proven at the medium
      // layer, R5.13); the point at THIS layer is that it is the scoped purge, not the full one.
      expect(mocks.person.purgePetRecognitionArtifacts).toHaveBeenCalled();
      expect(mocks.person.deleteAllPets).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.PetRecognitionState, {
        lastRun: expect.any(String),
        modelName: 'pet-recognition-large',
      });
      expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.PetDetectionQueueAll }));
      expect(mocks.logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('force'));
    });

    it('R5.8 ConfigInit with no prior state and recognition enabled: adopts the current model as reference, no purge, no requeue', async () => {
      mocks.systemMetadata.get.mockResolvedValue(null);

      await sut.onConfigInit({ newConfig: makeConfig({ modelName: 'pet-recognition-base' }) });

      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.PetRecognitionState, {
        modelName: 'pet-recognition-base',
      });
      expect(mocks.person.purgePetRecognitionArtifacts).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('R5.8 ConfigInit with no prior state and recognition disabled: full no-op', async () => {
      mocks.systemMetadata.get.mockResolvedValue(null);

      await sut.onConfigInit({
        newConfig: makeConfig({ modelName: 'pet-recognition-base', recognitionEnabled: false }),
      });

      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
      expect(mocks.person.purgePetRecognitionArtifacts).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('R5.9 ConfigInit detects an offline drift against stored state: scoped purge + gated requeue', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ modelName: 'pet-recognition-base' });
      mocks.person.purgePetRecognitionArtifacts.mockResolvedValue();

      await sut.onConfigInit({ newConfig: makeConfig({ modelName: 'pet-recognition-large' }) });

      expect(mocks.person.purgePetRecognitionArtifacts).toHaveBeenCalled();
      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.PetRecognitionState, {
        lastRun: expect.any(String),
        modelName: 'pet-recognition-large',
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PetDetectionQueueAll, data: { force: true } });
    });
  });

  describe('handleQueuePetRecognition', () => {
    it('should skip when pet recognition is disabled (default)', async () => {
      expect(await sut.handleQueuePetRecognition({ force: false })).toEqual(JobStatus.Skipped);

      expect(mocks.person.deleteAllPets).not.toHaveBeenCalled();
      expect(mocks.person.getUnassignedPetFaces).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
    });

    it('should skip when machine learning is disabled even if pet recognition is enabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: false, petRecognition: { enabled: true } },
      });

      expect(await sut.handleQueuePetRecognition({ force: false })).toEqual(JobStatus.Skipped);
    });

    describe('when pet recognition is enabled', () => {
      beforeEach(() => {
        mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
        mocks.sharedSpace.deleteAllPets.mockResolvedValue(void 0);
        // Default: no pending work on the PetRecognition queue, so pre-existing non-force tests
        // that don't care about queue state keep reaching the fan-out (R6.16 overrides this).
        mocks.job.getJobCounts.mockResolvedValue(petRecognitionCounts());
      });

      it('force: true purges pet people, space copies and pet_search, then requeues detection with force (6.1, R5.11)', async () => {
        expect(await sut.handleQueuePetRecognition({ force: true })).toEqual(JobStatus.Success);

        // R5.11: the PetRecognition queue is drained before the (full, bucket-inclusive) purge —
        // otherwise a job queued before the reset could still run against faces about to be deleted.
        expect(mocks.job.empty).toHaveBeenCalledWith(QueueName.PetRecognition, true);
        expect(mocks.person.deleteAllPets).toHaveBeenCalled();
        expect(mocks.sharedSpace.deleteAllPets).toHaveBeenCalled();
        expect(mocks.person.deleteAllPetSearch).toHaveBeenCalled();
        expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PetDetectionQueueAll, data: { force: true } });
        expect(mocks.person.getUnassignedPetFaces).not.toHaveBeenCalled();

        // The force purge is deliberately the FULL purge (buckets included, rebuilt by the
        // requeue) — distinct from a model-switch's scoped purge, which never touches deleteAllPets.
        expect(mocks.job.empty.mock.invocationCallOrder[0]).toBeLessThan(
          mocks.person.deleteAllPets.mock.invocationCallOrder[0],
        );
      });

      it('force: false queues PetRecognition only for embedded, unassigned pet faces (6.2)', async () => {
        mocks.person.getUnassignedPetFaces.mockReturnValue(makeStream([{ id: 'face-1' }, { id: 'face-2' }]));

        expect(await sut.handleQueuePetRecognition({ force: false })).toEqual(JobStatus.Success);

        expect(mocks.job.queueAll).toHaveBeenCalledWith([
          { name: JobName.PetRecognition, data: { id: 'face-1', deferred: false } },
          { name: JobName.PetRecognition, data: { id: 'face-2', deferred: false } },
        ]);
        expect(mocks.person.deleteAllPets).not.toHaveBeenCalled();
        expect(mocks.person.deleteAllPetSearch).not.toHaveBeenCalled();
        expect(mocks.job.queue).not.toHaveBeenCalledWith(
          expect.objectContaining({ name: JobName.PetDetectionQueueAll }),
        );
      });

      it('nightly: true skips without queueing when lastRun is newer than the newest pet face (6.3)', async () => {
        const lastRun = new Date('2026-07-20T00:00:00.000Z');
        // Hygiene: key systemMetadata.get by argument rather than one shared blob, so config reads
        // and PetRecognitionState reads can't accidentally leak into each other.
        mocks.systemMetadata.get.mockImplementation((key: SystemMetadataKey) => {
          if (key === SystemMetadataKey.SystemConfig) {
            return Promise.resolve(enabledConfig as any);
          }
          if (key === SystemMetadataKey.PetRecognitionState) {
            return Promise.resolve({ lastRun: lastRun.toISOString() } as any);
          }
          return Promise.resolve(null);
        });
        mocks.person.getLatestPetDate.mockResolvedValue(new Date(lastRun.getTime() - 1000));

        expect(await sut.handleQueuePetRecognition({ force: false, nightly: true })).toEqual(JobStatus.Skipped);

        expect(mocks.person.getUnassignedPetFaces).not.toHaveBeenCalled();
        expect(mocks.job.queueAll).not.toHaveBeenCalled();
        expect(mocks.job.queue).not.toHaveBeenCalled();
        expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
      });

      it('nightly: true with an older lastRun queues work (6.4)', async () => {
        const lastRun = new Date('2026-07-20T00:00:00.000Z');
        mocks.systemMetadata.get.mockImplementation((key: SystemMetadataKey) => {
          if (key === SystemMetadataKey.SystemConfig) {
            return Promise.resolve(enabledConfig as any);
          }
          if (key === SystemMetadataKey.PetRecognitionState) {
            return Promise.resolve({ lastRun: lastRun.toISOString() } as any);
          }
          return Promise.resolve(null);
        });
        mocks.person.getLatestPetDate.mockResolvedValue(new Date(lastRun.getTime() + 1000));
        mocks.person.getUnassignedPetFaces.mockReturnValue(makeStream([{ id: 'face-1' }]));

        expect(await sut.handleQueuePetRecognition({ force: false, nightly: true })).toEqual(JobStatus.Success);

        expect(mocks.job.queueAll).toHaveBeenCalledWith([
          { name: JobName.PetRecognition, data: { id: 'face-1', deferred: false } },
        ]);
      });

      it('R5.10 nightly drift check runs before the date-skip: a drifted state still switches even with no new pets', async () => {
        const lastRun = new Date('2026-07-20T00:00:00.000Z');
        const driftedConfig = {
          machineLearning: {
            enabled: true,
            petDetection: { enabled: true, modelName: 'yolo11n', minScore: 0.6 },
            petRecognition: { enabled: true, modelName: 'pet-recognition-base', maxDistance: 0.55, minFaces: 1 },
          },
        };
        mocks.systemMetadata.get.mockImplementation((key: SystemMetadataKey) => {
          if (key === SystemMetadataKey.SystemConfig) {
            return Promise.resolve(driftedConfig as any);
          }
          if (key === SystemMetadataKey.PetRecognitionState) {
            return Promise.resolve({ modelName: 'pet-recognition-small', lastRun: lastRun.toISOString() } as any);
          }
          return Promise.resolve(null);
        });
        // If the date-skip ran first it would fire here (no new pet since lastRun) and mask the drift.
        mocks.person.getLatestPetDate.mockResolvedValue(new Date(lastRun.getTime() - 1000));
        mocks.person.purgePetRecognitionArtifacts.mockResolvedValue();

        expect(await sut.handleQueuePetRecognition({ force: false, nightly: true })).toEqual(JobStatus.Success);

        expect(mocks.person.purgePetRecognitionArtifacts).toHaveBeenCalled();
        expect(mocks.person.getLatestPetDate).not.toHaveBeenCalled();
        expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PetDetectionQueueAll, data: { force: true } });
      });

      it('nightly: true with no prior lastRun queues work (first-ever nightly run)', async () => {
        mocks.systemMetadata.get.mockImplementation((key: SystemMetadataKey) => {
          if (key === SystemMetadataKey.SystemConfig) {
            return Promise.resolve(enabledConfig as any);
          }
          return Promise.resolve(null);
        });
        mocks.person.getLatestPetDate.mockResolvedValue(new Date('2026-07-20T00:00:00.000Z'));
        mocks.person.getUnassignedPetFaces.mockReturnValue(makeStream([{ id: 'face-1' }]));

        expect(await sut.handleQueuePetRecognition({ force: false, nightly: true })).toEqual(JobStatus.Success);

        expect(mocks.job.queueAll).toHaveBeenCalledWith([
          { name: JobName.PetRecognition, data: { id: 'face-1', deferred: false } },
        ]);
      });

      it('records lastRun and modelName in system metadata after a run (6.5)', async () => {
        mocks.person.getUnassignedPetFaces.mockReturnValue(makeStream([]));

        expect(await sut.handleQueuePetRecognition({ force: false })).toEqual(JobStatus.Success);

        expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.PetRecognitionState, {
          lastRun: expect.any(String),
          modelName: 'pet-recognition-base',
        });
      });

      it('records lastRun and modelName on a force run too', async () => {
        expect(await sut.handleQueuePetRecognition({ force: true })).toEqual(JobStatus.Success);

        expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.PetRecognitionState, {
          lastRun: expect.any(String),
          modelName: 'pet-recognition-base',
        });
      });

      it.each([
        ['waiting jobs', { waiting: 5 }],
        ['delayed jobs', { delayed: 3 }],
        ['paused jobs', { paused: 2 }],
        ['another active job besides the coordinator', { active: 2 }],
      ] as const)('R6.16 skips non-force pet recognition queueing when the queue has %s', async (_label, counts) => {
        mocks.job.getJobCounts.mockResolvedValue(petRecognitionCounts(counts));

        expect(await sut.handleQueuePetRecognition({ force: false })).toEqual(JobStatus.Skipped);

        expect(mocks.person.getUnassignedPetFaces).not.toHaveBeenCalled();
        expect(mocks.job.queueAll).not.toHaveBeenCalled();
        expect(mocks.database.prewarm).not.toHaveBeenCalled();
        expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
        expect(mocks.logger.debug).toHaveBeenCalledWith(expect.stringContaining('pending'));
      });

      it('R6.16 the drift check still runs ahead of the pending-work skip: a drifted state switches even while recognition work is pending', async () => {
        // Composes with R5.10: pending-work must never gate the drift check, which sits earlier
        // in the precedence chain (enabled -> drift -> nightly date-skip -> pending-work -> prewarm).
        // Full config shape (petDetection explicitly on) so handleModelSwitch's requeue gate isn't
        // starved by the defaults merge filling in a disabled petDetection.
        const driftedConfig = {
          machineLearning: {
            enabled: true,
            petDetection: { enabled: true, modelName: 'yolo11n', minScore: 0.6 },
            petRecognition: { enabled: true, modelName: 'pet-recognition-base', maxDistance: 0.55, minFaces: 1 },
          },
        };
        mocks.systemMetadata.get.mockImplementation((key: SystemMetadataKey) => {
          if (key === SystemMetadataKey.SystemConfig) {
            return Promise.resolve(driftedConfig as any);
          }
          if (key === SystemMetadataKey.PetRecognitionState) {
            return Promise.resolve({ modelName: 'pet-recognition-small' } as any);
          }
          return Promise.resolve(null);
        });
        mocks.job.getJobCounts.mockResolvedValue(petRecognitionCounts({ waiting: 5 }));
        mocks.person.purgePetRecognitionArtifacts.mockResolvedValue();

        expect(await sut.handleQueuePetRecognition({ force: false })).toEqual(JobStatus.Success);

        expect(mocks.person.purgePetRecognitionArtifacts).toHaveBeenCalled();
        expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PetDetectionQueueAll, data: { force: true } });
        expect(mocks.person.getUnassignedPetFaces).not.toHaveBeenCalled();
      });

      it('R6.17 prewarms the pet vector index before fanning out (mirrors facial recognition)', async () => {
        mocks.person.getUnassignedPetFaces.mockReturnValue(makeStream([{ id: 'face-1' }]));

        expect(await sut.handleQueuePetRecognition({ force: false })).toEqual(JobStatus.Success);

        expect(mocks.database.prewarm).toHaveBeenCalledWith(VectorIndex.Pet);
        expect(mocks.database.prewarm.mock.invocationCallOrder[0]).toBeLessThan(
          mocks.job.queueAll.mock.invocationCallOrder[0],
        );
      });
    });
  });

  describe('handlePetRecognition', () => {
    it('should skip when pet recognition is disabled (default) and not touch the repositories', async () => {
      expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Skipped);

      expect(mocks.person.getPetFaceForRecognition).not.toHaveBeenCalled();
      expect(mocks.search.searchPets).not.toHaveBeenCalled();
    });

    it('should skip when machine learning is disabled even if pet recognition is enabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: false, petRecognition: { enabled: true } },
      });

      expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Skipped);
      expect(mocks.search.searchPets).not.toHaveBeenCalled();
    });

    describe('when pet recognition is enabled', () => {
      beforeEach(() => {
        mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
      });

      it('fails when the face is not found', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(void 0);

        expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Failed);
        expect(mocks.search.searchPets).not.toHaveBeenCalled();
      });

      it('should skip and not throw when the face has no embedding row (5.8)', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace({ petSearch: null }));

        expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Skipped);
        expect(mocks.search.searchPets).not.toHaveBeenCalled();
      });

      it('should skip and not search when the face already has a person assigned (5.7)', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(
          makePetFace({ personId: 'existing-person', assetId: 'asset-1' }),
        );
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-id' } as any);
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Skipped);

        expect(mocks.search.searchPets).not.toHaveBeenCalled();
        expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith('existing-person');
        expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
          assetFaceId: 'face-id',
          identityId: 'identity-id',
          source: 'owner-person',
        });
        expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
      });

      it('R6.18 queues shared-space face matching for the asset when the face is already assigned (F10)', async () => {
        // The space may have been created or linked after the face was originally recognized, so
        // the already-assigned branch still runs the reconciliation pass — mirrors
        // handleRecognizeFaces's identical divergence guard (person.service.ts).
        mocks.person.getPetFaceForRecognition.mockResolvedValue(
          makePetFace({ personId: 'existing-person', assetId: 'asset-1' }),
        );
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-id' } as any);
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([{ spaceId: 'space-1' }, { spaceId: 'space-2' }]);

        expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Skipped);

        expect(mocks.sharedSpace.getSpaceIdsForAsset).toHaveBeenCalledWith('asset-1');
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.SharedSpaceFaceMatch,
          data: { spaceId: 'space-1', assetId: 'asset-1' },
        });
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.SharedSpaceFaceMatch,
          data: { spaceId: 'space-2', assetId: 'asset-1' },
        });
      });

      it('creates a new pet person with the detected species when there is no match (5.5)', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Success);

        expect(mocks.person.create).toHaveBeenCalledWith({
          ownerId: 'owner-id',
          type: 'pet',
          species: 'dog',
          name: '',
        });
        expect(mocks.person.reassignFaces).toHaveBeenCalledWith({ faceIds: ['face-id'], newPersonId: 'new-person' });
      });

      it('R4.3 falls back to the stored pet_search species when the job carries no label', async () => {
        // The queue-all and nightly fan-outs have no label in their job data (F8) — the species
        // persisted at embed time is the only thing that can stamp the new person.
        mocks.person.getPetFaceForRecognition.mockResolvedValue(
          makePetFace({ petSearch: { faceId: 'face-id', embedding: '[1,2,3]', species: 'cat' } }),
        );
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person', species: 'cat' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Success);

        expect(mocks.person.create).toHaveBeenCalledWith(expect.objectContaining({ species: 'cat' }));
      });

      it('R4.4 pin: an explicit job label still wins over the stored species', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(
          makePetFace({ petSearch: { faceId: 'face-id', embedding: '[1,2,3]', species: 'cat' } }),
        );
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Success);

        expect(mocks.person.create).toHaveBeenCalledWith(expect.objectContaining({ species: 'dog' }));
      });

      it('assigns to a person already matched by search without creating a new person (5.6)', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets.mockResolvedValue([
          { id: 'face-id', personId: null, distance: 0 },
          { id: 'other-face', personId: 'matched-person', distance: 0.1 },
        ]);
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'matched-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'matched-person', faceAssetId: 'existing-face' }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Success);

        expect(mocks.person.create).not.toHaveBeenCalled();
        expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
          faceIds: ['face-id'],
          newPersonId: 'matched-person',
        });
        // matched-person already has a representative face, so no update/thumbnail job.
        expect(mocks.person.update).not.toHaveBeenCalled();
      });

      it('requeues with deferred:true and does not create a person when not core (5.9)', async () => {
        mocks.systemMetadata.get.mockResolvedValue({
          machineLearning: {
            enabled: true,
            petRecognition: { enabled: true, modelName: 'pet-recognition-base', maxDistance: 0.55, minFaces: 2 },
          },
        });
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets.mockResolvedValue([{ id: 'face-id', personId: null, distance: 0 }]);

        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Skipped);

        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.PetRecognition,
          data: { id: 'face-id', deferred: true, label: 'dog' },
        });
        expect(mocks.person.create).not.toHaveBeenCalled();
        expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
      });

      it('does not requeue a second time when already deferred and still not core (5.10)', async () => {
        mocks.systemMetadata.get.mockResolvedValue({
          machineLearning: {
            enabled: true,
            petRecognition: { enabled: true, modelName: 'pet-recognition-base', maxDistance: 0.55, minFaces: 2 },
          },
        });
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([]);

        expect(await sut.handlePetRecognition({ id: 'face-id', deferred: true, label: 'dog' })).toEqual(
          JobStatus.Skipped,
        );

        expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.PetRecognition }));
        expect(mocks.person.create).not.toHaveBeenCalled();
      });

      it('links face_identity with type pet (via ensurePersonIdentity) and source owner-person when assigning (5.11)', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Success);

        // ensurePersonIdentity derives face_identity.type from person.type ('pet' — see
        // FaceIdentityRepository.ensurePersonIdentity), so calling it on a type:'pet' person is
        // what stamps the identity as type='pet'.
        expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith('new-person');
        expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
          assetFaceId: 'face-id',
          identityId: 'new-identity',
          source: 'owner-person',
        });
      });

      it('queues SharedSpaceFaceMatch for the asset after assignment (5.12)', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace({ assetId: 'asset-1' }));
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([{ spaceId: 'space-1' }, { spaceId: 'space-2' }]);

        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Success);

        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.SharedSpaceFaceMatch,
          data: { spaceId: 'space-1', assetId: 'asset-1' },
        });
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.SharedSpaceFaceMatch,
          data: { spaceId: 'space-2', assetId: 'asset-1' },
        });
      });

      it('passes maxDistance through to searchPets (5.13)', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Success);

        expect(mocks.search.searchPets).toHaveBeenCalledWith(expect.objectContaining({ maxDistance: 0.55 }));
        expect(mocks.person.create).toHaveBeenCalledWith(expect.objectContaining({ species: 'dog' }));
      });

      it('sets the representative face and queues PersonGenerateThumbnail when the resolved person has none', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Success);

        expect(mocks.person.update).toHaveBeenCalledWith({ id: 'new-person', faceAssetId: 'face-id' });
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.PersonGenerateThumbnail,
          data: { id: 'new-person' },
        });
      });

      it('pin: fails when the face has no owning asset', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace({ asset: null }));

        expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Failed);

        expect(mocks.search.searchPets).not.toHaveBeenCalled();
      });

      it('pin: the hasPerson fallback search asks for exactly one already-matched face and uses its personId', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([{ id: 'other-face', personId: 'fallback-person', distance: 0.2 }]);
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'fallback-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'fallback-person', faceAssetId: 'existing-face' }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Success);

        expect(mocks.search.searchPets).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ hasPerson: true, numResults: 1 }),
        );
        expect(mocks.person.create).not.toHaveBeenCalled();
        expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
          faceIds: ['face-id'],
          newPersonId: 'fallback-person',
        });
      });

      it('pin: the first (core-window) search asks for Math.max(minFaces, 1) results even when minFaces is 0', async () => {
        mocks.systemMetadata.get.mockResolvedValue({
          machineLearning: {
            enabled: true,
            petRecognition: { enabled: true, modelName: 'pet-recognition-base', maxDistance: 0.55, minFaces: 0 },
          },
        });
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Success);

        expect(mocks.search.searchPets).toHaveBeenNthCalledWith(1, expect.objectContaining({ numResults: 1 }));
      });

      it('pin: treats matches.length === minFaces as core (inclusive boundary)', async () => {
        mocks.systemMetadata.get.mockResolvedValue({
          machineLearning: {
            enabled: true,
            petRecognition: { enabled: true, modelName: 'pet-recognition-base', maxDistance: 0.55, minFaces: 2 },
          },
        });
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets
          .mockResolvedValueOnce([
            { id: 'face-id', personId: null, distance: 0 },
            { id: 'sibling-face', personId: null, distance: 0.1 },
          ])
          .mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        // Not deferred: matches.length (2) === minFaces (2) must resolve immediately as core, not defer.
        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Success);

        expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.PetRecognition }));
        expect(mocks.person.create).toHaveBeenCalledWith(expect.objectContaining({ species: 'dog' }));
      });

      it('pin: deferred-then-core creates a person once the re-queued core window has enough matches', async () => {
        mocks.systemMetadata.get.mockResolvedValue({
          machineLearning: {
            enabled: true,
            petRecognition: { enabled: true, modelName: 'pet-recognition-base', maxDistance: 0.55, minFaces: 2 },
          },
        });
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets
          .mockResolvedValueOnce([
            { id: 'face-id', personId: null, distance: 0 },
            { id: 'sibling-face', personId: null, distance: 0.1 },
          ])
          .mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id', deferred: true, label: 'dog' })).toEqual(
          JobStatus.Success,
        );

        expect(mocks.person.create).toHaveBeenCalledWith(expect.objectContaining({ species: 'dog' }));
        expect(mocks.person.reassignFaces).toHaveBeenCalledWith({ faceIds: ['face-id'], newPersonId: 'new-person' });
        expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.PetRecognition }));
      });

      it('pin: deferred-then-fallback assigns to a person found by the hasPerson fallback without creating one', async () => {
        mocks.systemMetadata.get.mockResolvedValue({
          machineLearning: {
            enabled: true,
            petRecognition: { enabled: true, modelName: 'pet-recognition-base', maxDistance: 0.55, minFaces: 2 },
          },
        });
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([{ id: 'other-face', personId: 'fallback-person', distance: 0.3 }]);
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'fallback-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'fallback-person', faceAssetId: 'existing-face' }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id', deferred: true, label: 'dog' })).toEqual(
          JobStatus.Success,
        );

        expect(mocks.person.create).not.toHaveBeenCalled();
        expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
          faceIds: ['face-id'],
          newPersonId: 'fallback-person',
        });
        expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.PetRecognition }));
      });

      it('pin: an already-deferred face with no matches at all resolves Skipped via the final no-person exit', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

        expect(await sut.handlePetRecognition({ id: 'face-id', deferred: true, label: 'dog' })).toEqual(
          JobStatus.Skipped,
        );

        expect(mocks.person.create).not.toHaveBeenCalled();
        expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
        expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.PetRecognition }));
      });

      it('pin: dedupes duplicate spaceId rows before queuing shared-space face matches (exactly one job per space)', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace({ assetId: 'asset-1' }));
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([{ spaceId: 'space-1' }, { spaceId: 'space-1' }]);

        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Success);

        const spaceMatchCalls = mocks.job.queue.mock.calls.filter(([job]) => job.name === JobName.SharedSpaceFaceMatch);
        expect(spaceMatchCalls).toHaveLength(1);
        expect(spaceMatchCalls[0][0]).toEqual({
          name: JobName.SharedSpaceFaceMatch,
          data: { spaceId: 'space-1', assetId: 'asset-1' },
        });
      });
    });
  });
});
