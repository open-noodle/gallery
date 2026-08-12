import { FaceRepairService } from 'src/services/face-repair.service';
import { newTestService, ServiceMocks } from 'test/utils';

describe(FaceRepairService.name, () => {
  let sut: FaceRepairService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(FaceRepairService));
    mocks.systemMetadata.get.mockResolvedValue(null);
  });

  describe('getPersonFlaggedFaces', () => {
    it("reads the latest scan's stored flagged faces (no recompute / no KNN)", async () => {
      const planSpy = vi.spyOn(sut, 'buildRepairPlan');
      mocks.faceRepairScan.getLatestScan.mockResolvedValue({ id: 'scan-1' } as any);
      mocks.faceRepairScan.getScanFlaggedFaces.mockResolvedValue([
        { assetFaceId: 'f1', suspectedOwnerId: 'q1' },
        { assetFaceId: 'f2', suspectedOwnerId: 'q2' },
      ]);
      mocks.faceRepairDecline.getClusterMuteMap.mockResolvedValue(new Map());
      mocks.faceIdentity.getManualLinkedFaceIds.mockResolvedValue(new Set());
      mocks.facePersonVerdict.getNegativeVerdictTokens.mockResolvedValue(new Map());
      mocks.faceIdentity.getPersonVerdictTokens.mockResolvedValue(new Map());

      const result = await sut.getPersonFlaggedFaces('p1');

      expect(mocks.faceRepairScan.getScanFlaggedFaces).toHaveBeenCalledWith('scan-1', 'p1');
      expect(result).toEqual({
        personId: 'p1',
        flaggedFaces: [
          { assetFaceId: 'f1', suspectedOwnerId: 'q1' },
          { assetFaceId: 'f2', suspectedOwnerId: 'q2' },
        ],
      });
      expect(planSpy).not.toHaveBeenCalled(); // E9: no recompute
      expect(mocks.search.searchFaces).not.toHaveBeenCalled(); // E9: no KNN
    });

    it('filters faces declined since the scan (E3)', async () => {
      mocks.faceRepairScan.getLatestScan.mockResolvedValue({ id: 'scan-1' } as any);
      mocks.faceRepairScan.getScanFlaggedFaces.mockResolvedValue([
        { assetFaceId: 'f1', suspectedOwnerId: 'q1' },
        { assetFaceId: 'f2', suspectedOwnerId: 'q2' },
      ]);
      mocks.faceRepairDecline.getClusterMuteMap.mockResolvedValue(new Map());
      mocks.faceIdentity.getManualLinkedFaceIds.mockResolvedValue(new Set());
      mocks.faceIdentity.getPersonVerdictTokens.mockResolvedValue(new Map());
      // A user rejected f1 for q1 — the cleanup queue must honour that verdict.
      mocks.facePersonVerdict.getNegativeVerdictTokens.mockResolvedValue(new Map([['f1', new Set(['person:q1'])]]));

      const result = await sut.getPersonFlaggedFaces('p1');
      expect(result.flaggedFaces).toEqual([{ assetFaceId: 'f2', suspectedOwnerId: 'q2' }]);
    });

    it('returns empty when there is no scan (E6)', async () => {
      mocks.faceRepairScan.getLatestScan.mockResolvedValue(undefined);
      const result = await sut.getPersonFlaggedFaces('p1');
      expect(result).toEqual({ personId: 'p1', flaggedFaces: [] });
      expect(mocks.faceRepairScan.getScanFlaggedFaces).not.toHaveBeenCalled();
    });
  });
});
