import { FaceRepairService } from 'src/services/face-repair.service';
import { newTestService, ServiceMocks } from 'test/utils';

describe(FaceRepairService.name, () => {
  let sut: FaceRepairService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(FaceRepairService));
  });

  describe('getClusterFaces', () => {
    it('converts page/size to offset/limit and delegates to the repository', async () => {
      const repoResult = { faces: [{ assetFaceId: 'f1' }], total: 7, hasMore: true };
      mocks.faceRepair.getClusterFacePage.mockResolvedValue(repoResult);

      const result = await sut.getClusterFaces('person-1', { excludeFaceIds: ['x'], page: 2, size: 3 });

      expect(mocks.faceRepair.getClusterFacePage).toHaveBeenCalledWith('person-1', {
        excludeFaceIds: ['x'],
        limit: 3,
        offset: 6, // page * size
      });
      expect(result).toBe(repoResult);
    });

    it('computes offset 0 for the first page', async () => {
      mocks.faceRepair.getClusterFacePage.mockResolvedValue({ faces: [], total: 0, hasMore: false });

      await sut.getClusterFaces('person-2', { excludeFaceIds: [], page: 0, size: 50 });

      expect(mocks.faceRepair.getClusterFacePage).toHaveBeenCalledWith('person-2', {
        excludeFaceIds: [],
        limit: 50,
        offset: 0,
      });
    });
  });
});
