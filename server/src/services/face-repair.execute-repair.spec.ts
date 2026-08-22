import { JobName } from 'src/enum';
import { FaceRepairService } from 'src/services/face-repair.service';
import { newTestService, ServiceMocks } from 'test/utils';

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
  mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identQ' } as any);
}

// S11 (slice 11e): `p1` and `q` resolve to DIFFERENT owners, so the C6 guard must fire and skip the route.
// Every existing test in this file uses arrangeSameOwnerMove (or an equivalent single-value mock), which
// makes fromOwner === toOwner unconditionally — the guard can never fire under any of them.
function arrangeDifferentOwnerMove(mocks: ServiceMocks) {
  mocks.person.getByGroupIdOnly.mockImplementation((id: string) =>
    Promise.resolve({ id, ownerId: id === 'p1' ? 'u1' : 'u2' } as any),
  );
  mocks.faceRepair.reconcileRepresentativeFaces.mockResolvedValue([]);
  mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identQ' } as any);
}

describe(FaceRepairService.name, () => {
  let sut: FaceRepairService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(FaceRepairService));

    // executeRepair wraps each route's writes in a transaction — run the callback with a stub trx.
    mocks.database.transaction.mockImplementation((cb: any) => cb({}));
  });

  describe('executeRepair', () => {
    it('direct-assigns each flagged face to its suspected owner with a manual identity link', async () => {
      // executeRepair now also compares the source and destination owners (C6): both p1 and q share owner u1,
      // so the cross-owner guard never fires and the move proceeds.
      mocks.person.getByGroupIdOnly.mockResolvedValue({ id: 'q', ownerId: 'u1' } as any);
      mocks.faceRepair.reattributeFaces.mockResolvedValue(['f1', 'f2']);
      mocks.faceRepair.reconcileRepresentativeFaces.mockResolvedValue([]);
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identQ' } as any);

      const r = await sut.executeRepair(
        plan([
          { assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q' },
          { assetFaceId: 'f2', currentPersonId: 'p1', suspectedOwnerId: 'q' },
        ]),
      );

      // Called inside a transaction — the 4th/2nd arg is the trx handle.
      expect(mocks.faceRepair.reattributeFaces).toHaveBeenCalledWith('p1', 'q', ['f1', 'f2'], expect.anything());
      expect(mocks.faceIdentity.replaceFaceIdentities).toHaveBeenCalledWith(
        {
          assetFaceIds: ['f1', 'f2'],
          identityId: 'identQ',
          source: 'manual',
        },
        expect.anything(),
      );
      // Never re-queues facial recognition — that is what re-clustered faces back to the wrong person.
      // (queueAll is only used for thumbnail regen, and only when a representative face was repointed.)
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(r).toEqual({ moved: 2, skipped: 0, movedFaceIds: ['f1', 'f2'] });
      // S11 (slice 11d): the move just stated a fact that contradicts any durable rejected/ignored row for
      // this SAME destination — clear it, scoped to `to`'s identity only.
      expect(mocks.facePersonVerdict.clearNegativeForTarget).toHaveBeenCalledWith(
        { personId: 'q', identityId: 'identQ' },
        ['f1', 'f2'],
        expect.anything(),
      );
    });

    it('skips faces whose suspected owner no longer exists (deleted/merged since the scan)', async () => {
      mocks.person.getByGroupIdOnly.mockResolvedValue(undefined);

      const r = await sut.executeRepair(plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'gone' }]));

      expect(mocks.faceRepair.reattributeFaces).not.toHaveBeenCalled();
      expect(r).toEqual({ moved: 0, skipped: 1, movedFaceIds: [] });
    });

    it('reconciles representative faces for both the source and the destination person', async () => {
      // executeRepair now also compares the source and destination owners (C6): both p1 and q share owner u1,
      // so the cross-owner guard never fires and the move proceeds.
      mocks.person.getByGroupIdOnly.mockResolvedValue({ id: 'q', ownerId: 'u1' } as any);
      mocks.faceRepair.reattributeFaces.mockResolvedValue(['f1']);
      mocks.faceRepair.reconcileRepresentativeFaces.mockResolvedValue([]);
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identQ' } as any);

      await sut.executeRepair(plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q' }]));

      const reconciled = mocks.faceRepair.reconcileRepresentativeFaces.mock.calls[0][0] as string[];
      expect(reconciled.toSorted()).toEqual(['p1', 'q']);
    });

    it('queues a thumbnail regen for every person whose representative face was repointed', async () => {
      // executeRepair now also compares the source and destination owners (C6): both p1 and q share owner u1,
      // so the cross-owner guard never fires and the move proceeds.
      mocks.person.getByGroupIdOnly.mockResolvedValue({ id: 'q', ownerId: 'u1' } as any);
      mocks.faceRepair.reattributeFaces.mockResolvedValue(['f1']);
      mocks.faceRepair.reconcileRepresentativeFaces.mockResolvedValue(['p1']);
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identQ' } as any);

      await sut.executeRepair(plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q' }]));

      // Without this the source person's card keeps showing the crop of the face that just moved away.
      expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: JobName.PersonGenerateThumbnail, data: { id: 'p1' } }]);
    });

    // S11 (slice 11e): C6 (defense-in-depth) — a route whose source and destination resolve to DIFFERENT
    // owners must be skipped and nothing written, even though resolveFaces already guards every interactive
    // destination up-front. No prior test in this file could ever exercise this: they all resolve every
    // person to the SAME owner, so the comparison is always true and the guard trivially never fires.
    it('skips a route whose destination resolves to a DIFFERENT owner than the source, writing nothing', async () => {
      arrangeDifferentOwnerMove(mocks);
      mocks.faceRepair.reattributeFaces.mockResolvedValue(['f1']);

      const r = await sut.executeRepair(plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q' }]));

      expect(mocks.faceRepair.reattributeFaces).not.toHaveBeenCalled();
      expect(mocks.faceIdentity.replaceFaceIdentities).not.toHaveBeenCalled();
      expect(mocks.facePersonVerdict.clearNegativeForTarget).not.toHaveBeenCalled();
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
      mocks.faceRepair.reattributeFaces.mockResolvedValue(['f1']);

      await sut.executeRepair(plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q', lock: true }]));

      expect(mocks.faceIdentity.replaceFaceIdentities).toHaveBeenCalledWith(
        { assetFaceIds: ['f1'], identityId: 'identQ', source: 'manual' },
        expect.anything(),
      );
    });

    // GIVEN a plain move, which the DTO documents as "undurable unless the caller opts in"
    // WHEN the move is written
    // THEN the identity link is re-pointed but NOT manual, so the face stays reviewable.
    it('writes an owner-person link for an unlocked move', async () => {
      arrangeSameOwnerMove(mocks);
      mocks.faceRepair.reattributeFaces.mockResolvedValue(['f1']);

      await sut.executeRepair(plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q', lock: false }]));

      expect(mocks.faceIdentity.replaceFaceIdentities).toHaveBeenCalledWith(
        { assetFaceIds: ['f1'], identityId: 'identQ', source: 'owner-person' },
        expect.anything(),
      );
    });

    // An unlocked move must still RE-POINT the identity. Skipping the relink would leave the face on the
    // destination while still carrying the source person's identity — the torn state FaceIdentityBackfill
    // resolves back to the source, silently reverting the move.
    it('still re-points the identity to the destination on an unlocked move', async () => {
      arrangeSameOwnerMove(mocks);
      mocks.faceRepair.reattributeFaces.mockResolvedValue(['f1']);

      await sut.executeRepair(plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q', lock: false }]));

      expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith('q', expect.anything());
      expect(mocks.faceIdentity.replaceFaceIdentities).toHaveBeenCalledWith(
        expect.objectContaining({ identityId: 'identQ' }),
        expect.anything(),
      );
    });

    // The scan's own auto-repair path builds FlaggedFace without a lock field and has always been durable.
    it('defaults an omitted lock flag to durable', async () => {
      arrangeSameOwnerMove(mocks);
      mocks.faceRepair.reattributeFaces.mockResolvedValue(['f1']);

      await sut.executeRepair(plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q' }]));

      expect(mocks.faceIdentity.replaceFaceIdentities).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'manual' }),
        expect.anything(),
      );
    });

    // Routes are keyed by (from, to). Without the lock in the key, a mixed batch collapses into one write
    // and one bucket silently inherits the other's durability.
    it('does not collapse locked and unlocked faces on the same route into one write', async () => {
      arrangeSameOwnerMove(mocks);
      mocks.faceRepair.reattributeFaces.mockImplementation((_from: string, _to: string, ids: string[]) =>
        Promise.resolve(ids),
      );

      await sut.executeRepair(
        plan([
          { assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q', lock: true },
          { assetFaceId: 'f2', currentPersonId: 'p1', suspectedOwnerId: 'q', lock: false },
        ]),
      );

      expect(mocks.faceIdentity.replaceFaceIdentities).toHaveBeenCalledWith(
        { assetFaceIds: ['f1'], identityId: 'identQ', source: 'manual' },
        expect.anything(),
      );
      expect(mocks.faceIdentity.replaceFaceIdentities).toHaveBeenCalledWith(
        { assetFaceIds: ['f2'], identityId: 'identQ', source: 'owner-person' },
        expect.anything(),
      );
    });
  });
});
