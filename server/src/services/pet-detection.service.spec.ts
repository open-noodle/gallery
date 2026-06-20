import { AssetVisibility, ImmichWorker, JobName, JobStatus } from 'src/enum';
import { PetDetectionService } from 'src/services/pet-detection.service';
import { AssetFactory } from 'test/factories/asset.factory';
import { systemConfigStub } from 'test/fixtures/system-config.stub';
import { makeStream, newTestService, ServiceMocks } from 'test/utils';

const makePerson = (overrides: Record<string, unknown> = {}) => ({
  id: 'person-id',
  identityId: null,
  ownerId: 'owner-id',
  name: 'dog',
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

const petFaceIsolationJobNames = [
  JobName.AssetDetectFacesQueueAll,
  JobName.FacialRecognitionQueueAll,
  JobName.FaceIdentityBackfill,
  JobName.SharedSpaceFaceMatch,
];

const getQueuedJobNames = (mocks: ServiceMocks) =>
  mocks.job.queueAll.mock.calls.flatMap(([jobs]) => jobs).map((job) => job.name);

const expectNoQueuedJobNames = (mocks: ServiceMocks, names: JobName[]) => {
  const queuedJobNames = getQueuedJobNames(mocks);
  for (const name of names) {
    expect(queuedJobNames).not.toContain(name);
  }
};

describe(PetDetectionService.name, () => {
  let sut: PetDetectionService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(PetDetectionService));

    mocks.config.getWorker.mockReturnValue(ImmichWorker.Microservices);
    mocks.assetJob.getForPetDetection.mockResolvedValue({
      ownerId: 'owner-id',
      visibility: AssetVisibility.Timeline,
      previewFile: '/uploads/user-id/thumbs/path.jpg',
    });
    // SharedSpaceRepository is a strict mock, so the reset path's deleteAllPets needs an implementation.
    mocks.sharedSpace.deleteAllPets.mockResolvedValue(void 0);
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('handleQueuePetDetection', () => {
    it('should skip if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.machineLearningDisabled);

      expect(await sut.handleQueuePetDetection({ force: false })).toEqual(JobStatus.Skipped);
    });

    it('should skip if pet detection is disabled (default)', async () => {
      expect(await sut.handleQueuePetDetection({ force: false })).toEqual(JobStatus.Skipped);
    });

    it('should not queue pet jobs when pet detection is disabled', async () => {
      expect(await sut.handleQueuePetDetection({ force: false })).toEqual(JobStatus.Skipped);

      expect(mocks.assetJob.streamForPetDetectionJob).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('should queue assets for pet detection', async () => {
      const asset = AssetFactory.create();
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: true, petDetection: { enabled: true } },
      });
      mocks.assetJob.streamForPetDetectionJob.mockReturnValue(makeStream([asset]));

      expect(await sut.handleQueuePetDetection({ force: false })).toEqual(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: JobName.PetDetection, data: { id: asset.id } }]);
      expect(mocks.assetJob.streamForPetDetectionJob).toHaveBeenCalledWith(false);
      expectNoQueuedJobNames(mocks, petFaceIsolationJobNames);
    });

    it('should pass force flag when queuing assets', async () => {
      const asset = AssetFactory.create();
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: true, petDetection: { enabled: true } },
      });
      mocks.assetJob.streamForPetDetectionJob.mockReturnValue(makeStream([asset]));

      expect(await sut.handleQueuePetDetection({ force: true })).toEqual(JobStatus.Success);

      expect(mocks.assetJob.streamForPetDetectionJob).toHaveBeenCalledWith(true);
    });

    it('should queue pet detection jobs with force asset selection when force is true', async () => {
      const asset = AssetFactory.create();
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: true, petDetection: { enabled: true } },
      });
      mocks.assetJob.streamForPetDetectionJob.mockReturnValue(makeStream([asset]));

      expect(await sut.handleQueuePetDetection({ force: true })).toEqual(JobStatus.Success);

      expect(mocks.assetJob.streamForPetDetectionJob).toHaveBeenCalledWith(true);
      expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: JobName.PetDetection, data: { id: asset.id } }]);
      expectNoQueuedJobNames(mocks, petFaceIsolationJobNames);
    });

    it('should clear existing pet detections before requeuing when force is true', async () => {
      const asset = AssetFactory.create();
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: true, petDetection: { enabled: true } },
      });
      mocks.assetJob.streamForPetDetectionJob.mockReturnValue(makeStream([asset]));

      expect(await sut.handleQueuePetDetection({ force: true })).toEqual(JobStatus.Success);

      expect(mocks.person.deleteAllPets).toHaveBeenCalledTimes(1);
      // Existing pet labels must be gone before any reprocessing job is queued.
      expect(mocks.person.deleteAllPets.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.job.queueAll.mock.invocationCallOrder[0],
      );
    });

    it('should not clear existing pet detections when force is false', async () => {
      const asset = AssetFactory.create();
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: true, petDetection: { enabled: true } },
      });
      mocks.assetJob.streamForPetDetectionJob.mockReturnValue(makeStream([asset]));

      expect(await sut.handleQueuePetDetection({ force: false })).toEqual(JobStatus.Success);

      expect(mocks.person.deleteAllPets).not.toHaveBeenCalled();
      expect(mocks.sharedSpace.deleteAllPets).not.toHaveBeenCalled();
    });

    it('should also clear pet detections from shared spaces on a force reset', async () => {
      // Pets propagate into shared spaces as shared_space_person rows (#718 follow-up); the
      // personal purge alone leaves them lingering in a space's People view, so the reset must
      // clear the space copies too. Like the personal purge, this is not gated on detection
      // being enabled — here it runs with detection disabled and still clears both.
      expect(await sut.handleQueuePetDetection({ force: true })).toEqual(JobStatus.Skipped);

      expect(mocks.person.deleteAllPets).toHaveBeenCalledTimes(1);
      expect(mocks.sharedSpace.deleteAllPets).toHaveBeenCalledTimes(1);
    });

    it('should clear existing pet detections on a force reset even when pet detection is disabled', async () => {
      // Regression test for #718: a user turns pet detection off (so pets stop
      // reappearing), then clicks Reset. The confirmation dialog promises deletion,
      // so the reset must still purge every detected pet — the deletion cannot be
      // short-circuited by the "pet detection disabled" early return. With detection
      // off there is nothing to reprocess, so no jobs are requeued.
      expect(await sut.handleQueuePetDetection({ force: true })).toEqual(JobStatus.Skipped);

      expect(mocks.person.deleteAllPets).toHaveBeenCalledTimes(1);
      expect(mocks.assetJob.streamForPetDetectionJob).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('should not clear existing pet detections when force is false and pet detection is disabled', async () => {
      // A plain "missing"-style run (force: false) while detection is disabled must
      // remain a no-op: nothing is deleted and nothing is requeued.
      expect(await sut.handleQueuePetDetection({ force: false })).toEqual(JobStatus.Skipped);

      expect(mocks.person.deleteAllPets).not.toHaveBeenCalled();
      expect(mocks.sharedSpace.deleteAllPets).not.toHaveBeenCalled();
      expect(mocks.assetJob.streamForPetDetectionJob).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });
  });

  describe('handlePetDetection', () => {
    const enabledConfig = {
      machineLearning: {
        enabled: true,
        petDetection: { enabled: true, modelName: 'yolo11n', minScore: 0.6 },
      },
    };

    it('should skip if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.machineLearningDisabled);

      expect(await sut.handlePetDetection({ id: '123' })).toEqual(JobStatus.Skipped);

      expect(mocks.machineLearning.detectPets).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.asset.upsertJobStatus).not.toHaveBeenCalled();
    });

    it('should skip if pet detection is disabled (default)', async () => {
      expect(await sut.handlePetDetection({ id: '123' })).toEqual(JobStatus.Skipped);

      expect(mocks.machineLearning.detectPets).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.asset.upsertJobStatus).not.toHaveBeenCalled();
    });

    it('should fail if asset not found', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
      mocks.assetJob.getForPetDetection.mockResolvedValue(void 0);

      expect(await sut.handlePetDetection({ id: 'non-existent' })).toEqual(JobStatus.Failed);

      expect(mocks.machineLearning.detectPets).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.asset.upsertJobStatus).not.toHaveBeenCalled();
    });

    it('should fail if asset has no preview file', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
      mocks.assetJob.getForPetDetection.mockResolvedValue({
        ownerId: 'owner-id',
        visibility: AssetVisibility.Timeline,
        previewFile: null,
      });

      expect(await sut.handlePetDetection({ id: '123' })).toEqual(JobStatus.Failed);

      expect(mocks.machineLearning.detectPets).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.asset.upsertJobStatus).not.toHaveBeenCalled();
    });

    it('should skip hidden assets', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
      mocks.assetJob.getForPetDetection.mockResolvedValue({
        ownerId: 'owner-id',
        visibility: AssetVisibility.Hidden,
        previewFile: '/uploads/user-id/thumbs/path.jpg',
      });

      expect(await sut.handlePetDetection({ id: '123' })).toEqual(JobStatus.Skipped);

      expect(mocks.machineLearning.detectPets).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.asset.upsertJobStatus).not.toHaveBeenCalled();
    });

    it('should create new pet person when none exists for species', async () => {
      const asset = AssetFactory.create();
      mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
      mocks.machineLearning.detectPets.mockResolvedValue({
        imageHeight: 100,
        imageWidth: 200,
        pets: [{ boundingBox: { x1: 10, y1: 20, x2: 30, y2: 40 }, score: 0.9, label: 'dog' }],
      });
      mocks.person.getByOwnerAndSpecies.mockResolvedValue(void 0);
      mocks.person.create.mockResolvedValue(makePerson());
      mocks.person.createAssetFace.mockResolvedValue('face-id');
      mocks.person.getById.mockResolvedValue(makePerson());
      mocks.person.update.mockResolvedValue({} as any);

      expect(await sut.handlePetDetection({ id: asset.id })).toEqual(JobStatus.Success);

      expect(mocks.person.getByOwnerAndSpecies).toHaveBeenCalledWith('owner-id', 'dog');
      expect(mocks.person.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'dog', type: 'pet', species: 'dog' }),
      );
      expect(mocks.person.createAssetFace).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: asset.id,
          personId: 'person-id',
          imageHeight: 100,
          imageWidth: 200,
          boundingBoxX1: 10,
          boundingBoxY1: 20,
          boundingBoxX2: 30,
          boundingBoxY2: 40,
        }),
      );
      expect(mocks.person.update).toHaveBeenCalledWith({ id: 'person-id', faceAssetId: 'face-id' });
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.PersonGenerateThumbnail, data: { id: 'person-id' } },
      ]);
      expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
      expectNoQueuedJobNames(mocks, petFaceIsolationJobNames);
    });

    it('should reuse existing pet person for same species', async () => {
      const asset = AssetFactory.create();
      mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
      mocks.machineLearning.detectPets.mockResolvedValue({
        imageHeight: 100,
        imageWidth: 200,
        pets: [{ boundingBox: { x1: 10, y1: 20, x2: 30, y2: 40 }, score: 0.9, label: 'cat' }],
      });
      mocks.person.getByOwnerAndSpecies.mockResolvedValue(makePerson({ id: 'existing-cat', faceAssetId: 'old-face' }));
      mocks.person.createAssetFace.mockResolvedValue('face-id');
      mocks.person.getById.mockResolvedValue(makePerson({ id: 'existing-cat', faceAssetId: 'old-face' }));

      expect(await sut.handlePetDetection({ id: asset.id })).toEqual(JobStatus.Success);

      expect(mocks.person.create).not.toHaveBeenCalled();
      expect(mocks.person.createAssetFace).toHaveBeenCalledWith(expect.objectContaining({ personId: 'existing-cat' }));
      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).toHaveBeenCalledWith([]);
      expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
    });

    it('should generate the first thumbnail for an existing pet species without a face asset', async () => {
      const asset = AssetFactory.create();
      mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
      mocks.machineLearning.detectPets.mockResolvedValue({
        imageHeight: 100,
        imageWidth: 200,
        pets: [{ boundingBox: { x1: 10, y1: 20, x2: 30, y2: 40 }, score: 0.9, label: 'cat' }],
      });
      mocks.person.getByOwnerAndSpecies.mockResolvedValue(makePerson({ id: 'existing-cat', faceAssetId: null }));
      mocks.person.createAssetFace.mockResolvedValue('new-face-id');
      mocks.person.getById.mockResolvedValue(makePerson({ id: 'existing-cat', faceAssetId: null }));
      mocks.person.update.mockResolvedValue({} as any);

      expect(await sut.handlePetDetection({ id: asset.id })).toEqual(JobStatus.Success);

      expect(mocks.person.create).not.toHaveBeenCalled();
      expect(mocks.person.createAssetFace).toHaveBeenCalledWith(expect.objectContaining({ personId: 'existing-cat' }));
      expect(mocks.person.update).toHaveBeenCalledWith({ id: 'existing-cat', faceAssetId: 'new-face-id' });
      expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.PersonGenerateThumbnail, data: { id: 'existing-cat' } },
      ]);
      expectNoQueuedJobNames(mocks, petFaceIsolationJobNames);
    });

    it('should reuse same person for multiple detections of same species in one photo', async () => {
      const asset = AssetFactory.create();
      mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
      mocks.machineLearning.detectPets.mockResolvedValue({
        imageHeight: 100,
        imageWidth: 200,
        pets: [
          { boundingBox: { x1: 10, y1: 20, x2: 30, y2: 40 }, score: 0.9, label: 'dog' },
          { boundingBox: { x1: 50, y1: 60, x2: 70, y2: 80 }, score: 0.8, label: 'dog' },
        ],
      });
      mocks.person.getByOwnerAndSpecies.mockResolvedValue(void 0);
      mocks.person.create.mockResolvedValue(makePerson());
      mocks.person.createAssetFace.mockResolvedValue('face-id');
      mocks.person.getById.mockResolvedValue(makePerson());
      mocks.person.update.mockResolvedValue({} as any);

      expect(await sut.handlePetDetection({ id: asset.id })).toEqual(JobStatus.Success);

      expect(mocks.person.create).toHaveBeenCalledTimes(1);
      expect(mocks.person.createAssetFace).toHaveBeenCalledTimes(2);
      expect(mocks.person.getByOwnerAndSpecies).toHaveBeenCalledTimes(1);
    });

    it('should create separate persons for different species', async () => {
      const asset = AssetFactory.create();
      mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
      mocks.machineLearning.detectPets.mockResolvedValue({
        imageHeight: 100,
        imageWidth: 200,
        pets: [
          { boundingBox: { x1: 10, y1: 20, x2: 30, y2: 40 }, score: 0.9, label: 'dog' },
          { boundingBox: { x1: 50, y1: 60, x2: 70, y2: 80 }, score: 0.8, label: 'cat' },
        ],
      });
      mocks.person.getByOwnerAndSpecies.mockResolvedValue(void 0);
      mocks.person.create
        .mockResolvedValueOnce(makePerson({ id: 'dog-person' }))
        .mockResolvedValueOnce(makePerson({ id: 'cat-person', name: 'cat', species: 'cat' }));
      mocks.person.createAssetFace.mockResolvedValueOnce('face-1').mockResolvedValueOnce('face-2');
      mocks.person.getById
        .mockResolvedValueOnce(makePerson({ id: 'dog-person' }))
        .mockResolvedValueOnce(makePerson({ id: 'cat-person' }));
      mocks.person.update.mockResolvedValue({} as any);

      expect(await sut.handlePetDetection({ id: asset.id })).toEqual(JobStatus.Success);

      expect(mocks.person.create).toHaveBeenCalledTimes(2);
      expect(mocks.person.getByOwnerAndSpecies).toHaveBeenCalledTimes(2);
      expect(mocks.person.createAssetFace).toHaveBeenCalledTimes(2);
    });

    it('should pass image dimensions from ML response to asset face for thumbnail crop', async () => {
      const asset = AssetFactory.create();
      mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
      mocks.machineLearning.detectPets.mockResolvedValue({
        imageHeight: 1080,
        imageWidth: 1920,
        pets: [{ boundingBox: { x1: 100, y1: 200, x2: 400, y2: 500 }, score: 0.95, label: 'cat' }],
      });
      mocks.person.getByOwnerAndSpecies.mockResolvedValue(void 0);
      mocks.person.create.mockResolvedValue(makePerson({ id: 'cat-person', name: 'cat', species: 'cat' }));
      mocks.person.createAssetFace.mockResolvedValue('face-id');
      mocks.person.getById.mockResolvedValue(makePerson({ id: 'cat-person' }));
      mocks.person.update.mockResolvedValue({} as any);

      await sut.handlePetDetection({ id: asset.id });

      const faceCall = mocks.person.createAssetFace.mock.calls[0][0];
      expect(faceCall.imageHeight).toBe(1080);
      expect(faceCall.imageWidth).toBe(1920);
      expect(faceCall.imageHeight).toBeGreaterThan(0);
      expect(faceCall.imageWidth).toBeGreaterThan(0);
    });

    it('should handle no pets detected', async () => {
      const asset = AssetFactory.create();
      mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
      mocks.machineLearning.detectPets.mockResolvedValue({
        imageHeight: 100,
        imageWidth: 200,
        pets: [],
      });

      expect(await sut.handlePetDetection({ id: asset.id })).toEqual(JobStatus.Success);

      expect(mocks.person.create).not.toHaveBeenCalled();
      expect(mocks.person.createAssetFace).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).toHaveBeenCalledWith([]);
      expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith(
        expect.objectContaining({ assetId: asset.id, petsDetectedAt: expect.any(Date) }),
      );
    });

    describe('error handling', () => {
      it('should handle ML inference errors gracefully', async () => {
        const asset = AssetFactory.create();
        mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
        mocks.machineLearning.detectPets.mockRejectedValue(new Error('ML inference failed'));

        expect(await sut.handlePetDetection({ id: asset.id })).toEqual(JobStatus.Failed);

        expect(mocks.person.create).not.toHaveBeenCalled();
        expect(mocks.person.createAssetFace).not.toHaveBeenCalled();
        expect(mocks.job.queueAll).not.toHaveBeenCalled();
        expect(mocks.asset.upsertJobStatus).not.toHaveBeenCalled();
        expect(mocks.event.emit).not.toHaveBeenCalled();
      });

      it('should handle out of memory errors during inference', async () => {
        const asset = AssetFactory.create();
        mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
        mocks.machineLearning.detectPets.mockRejectedValue(new Error('out of memory'));

        expect(await sut.handlePetDetection({ id: asset.id })).toEqual(JobStatus.Failed);

        expect(mocks.person.create).not.toHaveBeenCalled();
        expect(mocks.job.queueAll).not.toHaveBeenCalled();
        expect(mocks.asset.upsertJobStatus).not.toHaveBeenCalled();
        expect(mocks.event.emit).not.toHaveBeenCalled();
      });

      it('should handle model loading timeout errors', async () => {
        const asset = AssetFactory.create();
        mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
        mocks.machineLearning.detectPets.mockRejectedValue(new Error('model load timeout'));

        expect(await sut.handlePetDetection({ id: asset.id })).toEqual(JobStatus.Failed);

        expect(mocks.job.queueAll).not.toHaveBeenCalled();
        expect(mocks.asset.upsertJobStatus).not.toHaveBeenCalled();
        expect(mocks.event.emit).not.toHaveBeenCalled();
      });
    });
  });
});
