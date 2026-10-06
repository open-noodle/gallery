import { JobName } from 'src/enum.js';
import { FaceRepairService } from 'src/services/face-repair.service.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const plan = (toRepair: { assetFaceId: string; currentPersonId: string; suspectedOwnerId: string; lock?: boolean }[]) =>
  ({
    toRepair,
    reviewOnlyFaces: [],
    reviewOnlyPersonIds: [],
    unAttributableFaces: [],
    perPerson: [],
  }) as any;

// Both people share owner u1, so executeRepair's cross-owner guard (C6) never fires and the move proceeds.
function arrangeSameOwnerMove(mocks: ServiceMocks) {
  mocks.person.getByGroupIdOnly.mockImplementation((id: string) => Promise.resolve({ id, ownerId: 'u1' } as any));
  mocks.faceRepair.reconcileRepresentativeFaces.mockResolvedValue([]);
}

// S11 (slice 11e): `p1` and `q` resolve to DIFFERENT owners, so the C6 guard must fire and skip the route.
// Every existing test in this file uses arrangeSameOwnerMove (or an equivalent single-value mock), which
// makes fromOwner === toOwner unconditionally — the guard can never fire under any of them.
function arrangeDifferentOwnerMove(mocks: ServiceMocks) {
  mocks.person.getByGroupIdOnly.mockImplementation((id: string) =>
    Promise.resolve({ id, ownerId: id === 'p1' ? 'u1' : 'u2' } as any),
  );
  mocks.faceRepair.reconcileRepresentativeFaces.mockResolvedValue([]);
}

describe(FaceRepairService.name, () => {
  let sut: FaceRepairService;
  let mocks: ServiceMocks;
  // Each route is one call into the face-assignment module, which owns the transaction and the write order
  // (covered against a real database in test/medium/specs/services/face-assignment.service.spec.ts).
  let assignFaces: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(FaceRepairService));
    assignFaces = vi.fn().mockResolvedValue([]);
    (sut as unknown as { faceAssignmentService: { assignFaces: typeof assignFaces } }).faceAssignmentService = {
      assignFaces,
    };
  });

  describe('executeRepair', () => {
    it('direct-assigns each flagged face to its suspected owner with a manual identity link', async () => {
      // executeRepair now also compares the source and destination owners (C6): both p1 and q share owner u1,
      // so the cross-owner guard never fires and the move proceeds.
      mocks.person.getByGroupIdOnly.mockResolvedValue({ id: 'q', ownerId: 'u1' } as any);
      assignFaces.mockResolvedValue(['f1', 'f2']);
      mocks.faceRepair.reconcileRepresentativeFaces.mockResolvedValue([]);

      const r = await sut.executeRepair(
        plan([
          { assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q' },
          { assetFaceId: 'f2', currentPersonId: 'p1', suspectedOwnerId: 'q' },
        ]),
      );

      expect(assignFaces).toHaveBeenCalledTimes(1);
      expect(assignFaces).toHaveBeenCalledWith({
        personGroupId: 'q',
        faceIds: ['f1', 'f2'],
        strength: 'manual',
        from: 'p1',
        movableOnly: true,
      });
      // Never re-queues facial recognition — that is what re-clustered faces back to the wrong person.
      // (queueAll is only used for thumbnail regen, and only when a representative face was repointed.)
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(r).toEqual({ moved: 2, skipped: 0, movedFaceIds: ['f1', 'f2'] });
    });

    it('skips faces whose suspected owner no longer exists (deleted/merged since the scan)', async () => {
      mocks.person.getByGroupIdOnly.mockResolvedValue(undefined);

      const r = await sut.executeRepair(plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'gone' }]));

      expect(assignFaces).not.toHaveBeenCalled();
      expect(r).toEqual({ moved: 0, skipped: 1, movedFaceIds: [] });
    });

    it('reconciles representative faces for both the source and the destination person', async () => {
      // executeRepair now also compares the source and destination owners (C6): both p1 and q share owner u1,
      // so the cross-owner guard never fires and the move proceeds.
      mocks.person.getByGroupIdOnly.mockResolvedValue({ id: 'q', ownerId: 'u1' } as any);
      assignFaces.mockResolvedValue(['f1']);
      mocks.faceRepair.reconcileRepresentativeFaces.mockResolvedValue([]);

      await sut.executeRepair(plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q' }]));

      const reconciled = mocks.faceRepair.reconcileRepresentativeFaces.mock.calls[0][0] as string[];
      expect(reconciled.toSorted()).toEqual(['p1', 'q']);
    });

    it('queues a thumbnail regen for every person whose representative face was repointed', async () => {
      // executeRepair now also compares the source and destination owners (C6): both p1 and q share owner u1,
      // so the cross-owner guard never fires and the move proceeds.
      mocks.person.getByGroupIdOnly.mockResolvedValue({ id: 'q', ownerId: 'u1' } as any);
      assignFaces.mockResolvedValue(['f1']);
      mocks.faceRepair.reconcileRepresentativeFaces.mockResolvedValue([{ ownerId: 'u1', personGroupId: 'p1' }]);

      await sut.executeRepair(plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q' }]));

      // Without this the source person's card keeps showing the crop of the face that just moved away.
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.PersonGenerateThumbnail, data: { ownerId: 'u1', personGroupId: 'p1' } },
      ]);
    });

    // S11 (slice 11e): C6 (defense-in-depth) — a route whose source and destination resolve to DIFFERENT
    // owners must be skipped and nothing written, even though resolveFaces already guards every interactive
    // destination up-front. No prior test in this file could ever exercise this: they all resolve every
    // person to the SAME owner, so the comparison is always true and the guard trivially never fires.
    it('skips a route whose destination resolves to a DIFFERENT owner than the source, writing nothing', async () => {
      arrangeDifferentOwnerMove(mocks);
      assignFaces.mockResolvedValue(['f1']);

      const r = await sut.executeRepair(plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q' }]));

      expect(assignFaces).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(r).toEqual({ moved: 0, skipped: 1, movedFaceIds: [] });
    });
  });

  // B2: `source='manual'` is the strongest verdict in the system — getManualLinkedFaceIds and the
  // pending-eligibility anti-join both exclude such a face from every scan and every suggestion queue,
  // permanently. executeRepair used to write it for EVERY move, so `lock: false` (the MoveGroup default,
  // and what the web client sends for a suggested-owner move) silently made the face unreviewable while
  // the response reported `locked: 0`.
  describe('executeRepair lock durability', () => {
    // GIVEN an admin confirms a move and asks for it to stick
    // WHEN the move is written
    // THEN the identity link is `manual`, so no future scan can question the face again.
    it('writes a manual link for a locked move', async () => {
      arrangeSameOwnerMove(mocks);

      await sut.executeRepair(plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q', lock: true }]));

      expect(assignFaces).toHaveBeenCalledWith(expect.objectContaining({ faceIds: ['f1'], strength: 'manual' }));
    });

    // GIVEN a plain move, which the DTO documents as "undurable unless the caller opts in"
    // WHEN the move is written
    // THEN it is an ordinary (owner-person) placement, so the face stays reviewable.
    it('writes an owner-person link for an unlocked move', async () => {
      arrangeSameOwnerMove(mocks);

      await sut.executeRepair(plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q', lock: false }]));

      expect(assignFaces).toHaveBeenCalledWith(expect.objectContaining({ faceIds: ['f1'], strength: 'owner-person' }));
    });

    // A route whose suspected owner is the current person re-affirms in place, but only over the faces a move
    // would take: a hand-drawn face on an unlocked route must not have its manual link downgraded.
    it('keeps the move filter on a route that stays on the same person', async () => {
      arrangeSameOwnerMove(mocks);

      await sut.executeRepair(
        plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'p1', lock: false }]),
      );

      expect(assignFaces).toHaveBeenCalledWith(
        expect.objectContaining({ personGroupId: 'p1', from: 'p1', movableOnly: true, strength: 'owner-person' }),
      );
    });

    // The scan's own auto-repair path builds FlaggedFace without a lock field and has always been durable.
    it('defaults an omitted lock flag to durable', async () => {
      arrangeSameOwnerMove(mocks);

      await sut.executeRepair(plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q' }]));

      expect(assignFaces).toHaveBeenCalledWith(expect.objectContaining({ strength: 'manual' }));
    });

    // Routes are keyed by (from, to). Without the lock in the key, a mixed batch collapses into one write
    // and one bucket silently inherits the other's durability.
    it('does not collapse locked and unlocked faces on the same route into one write', async () => {
      arrangeSameOwnerMove(mocks);

      await sut.executeRepair(
        plan([
          { assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q', lock: true },
          { assetFaceId: 'f2', currentPersonId: 'p1', suspectedOwnerId: 'q', lock: false },
        ]),
      );

      expect(assignFaces).toHaveBeenCalledWith({
        personGroupId: 'q',
        faceIds: ['f1'],
        strength: 'manual',
        from: 'p1',
        movableOnly: true,
      });
      expect(assignFaces).toHaveBeenCalledWith({
        personGroupId: 'q',
        faceIds: ['f2'],
        strength: 'owner-person',
        from: 'p1',
        movableOnly: true,
      });
    });
  });
});
