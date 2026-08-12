import { ConflictException } from '@nestjs/common';
import { JobName } from 'src/enum';
import { ScanInProgressError } from 'src/repositories/face-repair-scan.repository';
import { EligibleFaceRow } from 'src/repositories/face-repair.repository';
import { FaceRepairService, RepairPlan } from 'src/services/face-repair.service';
import { newTestService, ServiceMocks } from 'test/utils';

/** A single eligible-face page for the progress test mock (keyset scan reads pages, not a cursor). */
const singleFacePage = (): EligibleFaceRow[] => [
  { assetFaceId: 'face-1', ownerId: 'user-1', personId: 'P', embedding: '[0.1,0.2,0.3]' },
];

/** A minimal RepairPlan with one flagged person P → suspected owner Q */
const makePlan = (): RepairPlan => ({
  toRepair: [{ assetFaceId: 'face-1', currentPersonId: 'P', suspectedOwnerId: 'Q' }],
  reviewOnlyFaces: [],
  reviewOnlyPersonIds: [],
  unAttributableFaces: [],
  perPerson: [
    { personId: 'P', eligible: 5, flagged: 1, flaggedFraction: 0.2 },
    { personId: 'Q', eligible: 8, flagged: 0, flaggedFraction: 0 },
  ],
});

describe(FaceRepairService.name, () => {
  let sut: FaceRepairService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(FaceRepairService));

    // Default: no stored scan row → params come from config defaults
    mocks.systemMetadata.get.mockResolvedValue(null);

    mocks.faceRepairScan.getScanById.mockResolvedValue(undefined);
    mocks.faceRepairScan.updateScanProgress.mockResolvedValue();
    mocks.faceRepairScan.completeScan.mockResolvedValue();
    mocks.faceRepairScan.failScan.mockResolvedValue();
    mocks.faceRepairScan.pruneSupersededScans.mockResolvedValue();
    mocks.faceRepairScan.replaceScanFlaggedFaces.mockResolvedValue();

    // Default: facial recognition not active; createScan returns a scan row
    mocks.job.isActive.mockResolvedValue(false);
    mocks.faceRepairScan.createScan.mockResolvedValue({ id: 'scan-1' } as any);
    mocks.job.queue.mockResolvedValue();

    // Default eligible-face count
    mocks.faceRepair.countEligibleFaces.mockResolvedValue(5);

    // Default enriched persons — recommendation placeholder will be OVERWRITTEN by classifier
    mocks.faceRepairScan.enrichReportPersons.mockResolvedValue([
      {
        personId: 'P',
        ownerId: 'user-1',
        personName: 'Jula',
        faceCount: 5,
        thumbnailFaceId: null,
        eligible: 5,
        flagged: 1,
        flaggedFraction: 0.2,
        suspectedOwners: [{ ownerPersonId: 'Q', ownerName: null, thumbnailFaceId: null, count: 1 }],
        recommendation: 'confident', // placeholder — runScan overwrites this
        reviewReasons: [],
      },
    ]);
  });

  describe('runScan', () => {
    it('marks running, builds+classifies+enriches, persists completed, prunes', async () => {
      // Stub buildRepairPlan to return a fixed plan (avoids wiring streamEligibleFaces / searchFaces)
      vi.spyOn(sut, 'buildRepairPlan').mockResolvedValue(makePlan());

      await sut.runScan('scan-1');

      expect(mocks.faceRepairScan.updateScanProgress).toHaveBeenCalledWith(
        'scan-1',
        expect.objectContaining({ status: 'running' }),
      );

      // completeScan called with classified persons — 'Jula' is named → review-first
      expect(mocks.faceRepairScan.completeScan).toHaveBeenCalledWith(
        'scan-1',
        expect.objectContaining({
          totals: expect.any(Object),
          persons: expect.arrayContaining([
            expect.objectContaining({
              personId: 'P',
              recommendation: 'review-first',
              reviewReasons: expect.arrayContaining(['named']),
            }),
          ]),
        }),
      );

      expect(mocks.faceRepairScan.pruneSupersededScans).toHaveBeenCalled();
    });

    it('reports progress at least once during the stream', async () => {
      // Let buildRepairPlan run for real — mock its underlying repos so one candidate flows through.
      // A single-face page (< SCAN_PAGE_SIZE) ends the keyset scan after one page.
      mocks.faceRepair.getEligibleFacePage.mockResolvedValue(singleFacePage());
      mocks.search.searchFaces.mockResolvedValue([]);

      await sut.runScan('scan-1');

      // updateScanProgress should have been called with a progress payload (onProgress fired)
      expect(mocks.faceRepairScan.updateScanProgress).toHaveBeenCalledWith(
        'scan-1',
        expect.objectContaining({ progress: expect.objectContaining({ total: expect.any(Number) }) }),
      );
    });

    it('marks the scan failed and rethrows on error', async () => {
      vi.spyOn(sut, 'buildRepairPlan').mockResolvedValue(makePlan());
      mocks.faceRepairScan.completeScan.mockRejectedValue(new Error('boom'));

      await expect(sut.runScan('scan-1')).rejects.toThrow('boom');

      expect(mocks.faceRepairScan.failScan).toHaveBeenCalledWith('scan-1', expect.stringContaining('boom'));
    });

    it("persists the scan's flagged faces (toRepair + reviewOnlyFaces) before completing", async () => {
      vi.spyOn(sut, 'buildRepairPlan').mockResolvedValue({
        toRepair: [{ assetFaceId: 'face-1', currentPersonId: 'P', suspectedOwnerId: 'Q' }],
        reviewOnlyFaces: [{ assetFaceId: 'face-2', currentPersonId: 'P', suspectedOwnerId: 'R', reason: 'over-cap' }],
        reviewOnlyPersonIds: [],
        unAttributableFaces: [],
        perPerson: [{ personId: 'P', eligible: 5, flagged: 2, flaggedFraction: 0.4 }],
      } as any);

      await sut.runScan('scan-1');

      expect(mocks.faceRepairScan.replaceScanFlaggedFaces).toHaveBeenCalledWith('scan-1', [
        { assetFaceId: 'face-1', personId: 'P', suspectedOwnerId: 'Q' },
        { assetFaceId: 'face-2', personId: 'P', suspectedOwnerId: 'R' },
      ]);
      // persisted before the scan is marked completed
      const persistOrder = mocks.faceRepairScan.replaceScanFlaggedFaces.mock.invocationCallOrder[0];
      const completeOrder = mocks.faceRepairScan.completeScan.mock.invocationCallOrder[0];
      expect(persistOrder).toBeLessThan(completeOrder);
    });
  });

  describe('triggerScan', () => {
    it('throws 409 ConflictException when facial recognition is active (nothing enqueued)', async () => {
      mocks.job.isActive.mockResolvedValue(true);

      await expect(sut.triggerScan('user-1')).rejects.toThrow(ConflictException);

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('rethrows real DB failures instead of masking them as 409 scan-in-progress', async () => {
      mocks.job.isActive.mockResolvedValue(false);
      mocks.faceRepairScan.createScan.mockRejectedValue(new Error('connection refused'));

      await expect(sut.triggerScan('user-1')).rejects.toThrow('connection refused');
      await expect(sut.triggerScan('user-1')).rejects.not.toThrow(ConflictException);
    });

    it('throws 409 ConflictException when createScan rejects (scan already in progress)', async () => {
      mocks.job.isActive.mockResolvedValue(false);
      mocks.faceRepairScan.createScan.mockRejectedValue(new ScanInProgressError());

      await expect(sut.triggerScan('user-1')).rejects.toThrow(ConflictException);

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('happy path: enqueues exactly one FaceRepairScan job and returns { scanId }', async () => {
      mocks.job.isActive.mockResolvedValue(false);
      mocks.faceRepairScan.createScan.mockResolvedValue({ id: 'scan-42' } as any);

      const result = await sut.triggerScan('user-1');

      expect(result).toEqual({ scanId: 'scan-42' });
      expect(mocks.job.queue).toHaveBeenCalledTimes(1);
      expect(mocks.job.queue).toHaveBeenCalledWith(
        expect.objectContaining({ name: JobName.FaceRepairScan, data: { scanId: 'scan-42' } }),
      );
    });

    // S11 (slice 11f): every override the Advanced Scan modal can send must actually reach createScan — a
    // merge that silently falls back to defaults would make the whole modal decorative. All seven values
    // are chosen NON-default so a hardcoded-defaults implementation cannot satisfy this by accident.
    it('passes every scan-override field through to createScan, not the config/constant defaults', async () => {
      mocks.job.isActive.mockResolvedValue(false);
      mocks.faceRepairScan.createScan.mockResolvedValue({ id: 'scan-99' } as any);

      await sut.triggerScan('user-1', {
        maxDistance: 0.42,
        minFaces: 7,
        voteMargin: 3,
        voteWindow: 150,
        maxFlaggedFraction: 0.25,
        largeClusterThreshold: 20,
        maxAttributionDistance: 0.3,
      });

      expect(mocks.faceRepairScan.createScan).toHaveBeenCalledWith(
        expect.objectContaining({
          params: {
            maxDistance: 0.42,
            minFaces: 7,
            voteMargin: 3,
            voteWindow: 150,
            maxFlaggedFraction: 0.25,
            largeClusterThreshold: 20,
            maxAttributionDistance: 0.3,
          },
        }),
      );
    });

    // S11 (slice 11g): the "admin guard" test previously here asserted only
    // `expect(QueueName.FacialRecognition).toBeDefined()` — a constant, always true, discriminating nothing.
    // The real admin guard is proven by face-repair-admin.controller.spec.ts's "should be an authenticated
    // route" tests for both `POST /admin/face-repair/scan` and `GET /admin/face-repair/scan/defaults`, which
    // assert `ctx.authenticate` was called with `adminRoute: true` metadata — deleted here, not duplicated.
  });
});
