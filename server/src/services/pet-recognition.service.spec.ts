import { JobStatus } from 'src/enum';
import { PetRecognitionService } from 'src/services/pet-recognition.service';
import { newTestService, ServiceMocks } from 'test/utils';

describe(PetRecognitionService.name, () => {
  let sut: PetRecognitionService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(PetRecognitionService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('handleQueuePetRecognition', () => {
    it('should skip when pet recognition is disabled (default)', async () => {
      expect(await sut.handleQueuePetRecognition({ force: false })).toEqual(JobStatus.Skipped);
    });

    it('should skip when machine learning is disabled even if pet recognition is enabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: false, petRecognition: { enabled: true } },
      });

      expect(await sut.handleQueuePetRecognition({ force: false })).toEqual(JobStatus.Skipped);
    });
  });

  describe('handlePetRecognition', () => {
    it('should skip when pet recognition is disabled (default) and not call the search repository', async () => {
      expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Skipped);

      // searchPets lands in Slice 4; searchFaces stands in as the repository-untouched proxy for now.
      expect(mocks.search.searchFaces).not.toHaveBeenCalled();
    });

    it('should skip when machine learning is disabled even if pet recognition is enabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: false, petRecognition: { enabled: true } },
      });

      expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Skipped);
      expect(mocks.search.searchFaces).not.toHaveBeenCalled();
    });
  });
});
