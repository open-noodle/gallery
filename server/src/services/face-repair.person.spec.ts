import { FaceRepairService } from 'src/services/face-repair.service';
import { newTestService, ServiceMocks } from 'test/utils';

// #1061: getScanFlaggedFaces now carries photo context alongside each stored face. These tests are about
// verdict-filtering behaviour (E3/E6/E9), not about the context fields themselves, so this fixture supplies
// a fixed, realistic context and assertions below match on it with expect.objectContaining.
const stored = (assetFaceId: string, suspectedOwnerId: string) => ({
  assetFaceId,
  suspectedOwnerId,
  localDateTime: new Date('2019-07-04T10:30:00.000Z'),
  boundingBoxX1: 10,
  boundingBoxY1: 20,
  boundingBoxX2: 30,
  boundingBoxY2: 40,
  imageWidth: 400,
  imageHeight: 300,
});

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
      mocks.faceRepairScan.getScanFlaggedFaces.mockResolvedValue([stored('f1', 'q1'), stored('f2', 'q2')]);
      mocks.faceRepairDecline.getClusterMuteMap.mockResolvedValue(new Map());
      mocks.faceIdentity.getManualLinkedFaceIds.mockResolvedValue(new Set());
      mocks.facePersonVerdict.getNegativeVerdictTokens.mockResolvedValue(new Map());
      mocks.faceIdentity.getPersonVerdictTokens.mockResolvedValue(new Map());

      const result = await sut.getPersonFlaggedFaces('p1');

      expect(mocks.faceRepairScan.getScanFlaggedFaces).toHaveBeenCalledWith('scan-1', 'p1');
      expect(result).toEqual({
        personId: 'p1',
        flaggedFaces: [
          expect.objectContaining({ assetFaceId: 'f1', suspectedOwnerId: 'q1' }),
          expect.objectContaining({ assetFaceId: 'f2', suspectedOwnerId: 'q2' }),
        ],
      });
      expect(planSpy).not.toHaveBeenCalled(); // E9: no recompute
      expect(mocks.search.searchFaces).not.toHaveBeenCalled(); // E9: no KNN
    });

    it('filters faces declined since the scan (E3)', async () => {
      mocks.faceRepairScan.getLatestScan.mockResolvedValue({ id: 'scan-1' } as any);
      mocks.faceRepairScan.getScanFlaggedFaces.mockResolvedValue([stored('f1', 'q1'), stored('f2', 'q2')]);
      mocks.faceRepairDecline.getClusterMuteMap.mockResolvedValue(new Map());
      mocks.faceIdentity.getManualLinkedFaceIds.mockResolvedValue(new Set());
      mocks.faceIdentity.getPersonVerdictTokens.mockResolvedValue(new Map());
      // A user rejected f1 for q1 — the cleanup queue must honour that verdict.
      mocks.facePersonVerdict.getNegativeVerdictTokens.mockResolvedValue(new Map([['f1', new Set(['person:q1'])]]));

      const result = await sut.getPersonFlaggedFaces('p1');
      expect(result.flaggedFaces).toEqual([expect.objectContaining({ assetFaceId: 'f2', suspectedOwnerId: 'q2' })]);
    });

    it('returns empty when there is no scan (E6)', async () => {
      mocks.faceRepairScan.getLatestScan.mockResolvedValue(undefined);
      const result = await sut.getPersonFlaggedFaces('p1');
      expect(result).toEqual({ personId: 'p1', flaggedFaces: [] });
      expect(mocks.faceRepairScan.getScanFlaggedFaces).not.toHaveBeenCalled();
    });
  });
});
