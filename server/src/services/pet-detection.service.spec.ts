import { AssetVisibility, ImmichWorker, JobName, JobStatus } from 'src/enum';
import { PetDetectionService } from 'src/services/pet-detection.service';
import { AssetFactory } from 'test/factories/asset.factory';
import { systemConfigStub } from 'test/fixtures/system-config.stub';
import { makeStream, newTestService, ServiceMocks } from 'test/utils';

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

    it('should queue assets for pet detection', async () => {
      const asset = AssetFactory.create();
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: true, petDetection: { enabled: true } },
      });
      mocks.assetJob.streamForPetDetectionJob.mockReturnValue(makeStream([asset]));

      expect(await sut.handleQueuePetDetection({ force: false })).toEqual(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.PetDetection, data: { id: asset.id } },
      ]);
      expect(mocks.assetJob.streamForPetDetectionJob).toHaveBeenCalledWith(false);
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
  });

  describe('handlePetDetection', () => {
    it('should skip if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.machineLearningDisabled);

      expect(await sut.handlePetDetection({ id: '123' })).toEqual(JobStatus.Skipped);

      expect(mocks.machineLearning.detectPets).not.toHaveBeenCalled();
    });

    it('should skip if pet detection is disabled (default)', async () => {
      expect(await sut.handlePetDetection({ id: '123' })).toEqual(JobStatus.Skipped);

      expect(mocks.machineLearning.detectPets).not.toHaveBeenCalled();
    });

    it('should fail if asset not found', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: true, petDetection: { enabled: true } },
      });
      mocks.assetJob.getForPetDetection.mockResolvedValue(void 0);

      expect(await sut.handlePetDetection({ id: 'non-existent' })).toEqual(JobStatus.Failed);

      expect(mocks.machineLearning.detectPets).not.toHaveBeenCalled();
    });

    it('should fail if asset has no preview file', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: true, petDetection: { enabled: true } },
      });
      mocks.assetJob.getForPetDetection.mockResolvedValue({
        ownerId: 'owner-id',
        visibility: AssetVisibility.Timeline,
        previewFile: null,
      });

      expect(await sut.handlePetDetection({ id: '123' })).toEqual(JobStatus.Failed);

      expect(mocks.machineLearning.detectPets).not.toHaveBeenCalled();
    });

    it('should skip hidden assets', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: true, petDetection: { enabled: true } },
      });
      mocks.assetJob.getForPetDetection.mockResolvedValue({
        ownerId: 'owner-id',
        visibility: AssetVisibility.Hidden,
        previewFile: '/uploads/user-id/thumbs/path.jpg',
      });

      expect(await sut.handlePetDetection({ id: '123' })).toEqual(JobStatus.Skipped);

      expect(mocks.machineLearning.detectPets).not.toHaveBeenCalled();
    });

    it('should detect pets and store results', async () => {
      const asset = AssetFactory.create();
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: true, petDetection: { enabled: true, modelName: 'yolov8n-animals', minScore: 0.6 } },
      });
      mocks.machineLearning.detectPets.mockResolvedValue({
        imageHeight: 100,
        imageWidth: 200,
        pets: [
          {
            boundingBox: { x1: 10, y1: 20, x2: 30, y2: 40 },
            score: 0.9,
            label: 'dog',
          },
        ],
      });
      mocks.person.create.mockResolvedValue({
        id: 'person-id',
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
      });

      expect(await sut.handlePetDetection({ id: asset.id })).toEqual(JobStatus.Success);

      expect(mocks.machineLearning.detectPets).toHaveBeenCalledWith(
        '/uploads/user-id/thumbs/path.jpg',
        expect.objectContaining({ modelName: 'yolov8n-animals', minScore: 0.6 }),
      );
      expect(mocks.person.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'dog', type: 'pet', species: 'dog' }),
      );
      expect(mocks.person.createAssetFace).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: asset.id,
          personId: 'person-id',
          boundingBoxX1: 10,
          boundingBoxY1: 20,
          boundingBoxX2: 30,
          boundingBoxY2: 40,
        }),
      );
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith(
        expect.objectContaining({ assetId: asset.id, petsDetectedAt: expect.any(Date) }),
      );
    });
  });
});
