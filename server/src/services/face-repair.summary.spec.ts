import { RepairPlan } from 'src/services/face-repair.service';
import { summarizeRepairPlan } from 'src/services/face-repair.summary';

const plan: RepairPlan = {
  toRepair: [
    { assetFaceId: 'f1', currentPersonId: 'A', suspectedOwnerId: 'K' },
    { assetFaceId: 'f2', currentPersonId: 'A', suspectedOwnerId: 'K' },
  ],
  reviewOnlyFaces: [
    { assetFaceId: 'f3', currentPersonId: 'D', suspectedOwnerId: 'X', reason: 'over-cap' },
    { assetFaceId: 'f4', currentPersonId: 'E', suspectedOwnerId: 'Y', reason: 'bad-target' },
  ],
  reviewOnlyPersonIds: ['D'],
  unAttributableFaces: [{ assetFaceId: 'f5', currentPersonId: 'F' }],
  perPerson: [
    { personGroupId: 'A', eligible: 10, flagged: 2, flaggedFraction: 0.2 },
    { personGroupId: 'D', eligible: 4, flagged: 1, flaggedFraction: 0.25 },
    { personGroupId: 'E', eligible: 5, flagged: 1, flaggedFraction: 0.2 },
    { personGroupId: 'K', eligible: 50, flagged: 0, flaggedFraction: 0 },
  ],
};

describe('summarizeRepairPlan', () => {
  it('aggregates totals across the plan', () => {
    const r = summarizeRepairPlan(plan);
    expect(r.totals).toEqual({
      eligibleFaces: 69,
      flaggedFaces: 4,
      toRepair: 2,
      reviewOnlyFaces: 2,
      reviewOnlyPersons: 1,
      affectedPersons: 3,
      reviewOnlyByReason: { overCap: 1, badTarget: 1, unAttributable: 1 },
    });
  });

  it('reports per-person suspected owners and review-only flag, only for persons with flagged faces', () => {
    const r = summarizeRepairPlan(plan);
    const ids = r.persons.map((p) => p.personId).toSorted();
    expect(ids).toEqual(['A', 'D', 'E']); // K has 0 flagged -> omitted
    const a = r.persons.find((p) => p.personId === 'A')!;
    expect(a.reviewOnly).toBe(false);
    expect(a.suspectedOwners).toEqual([{ ownerPersonId: 'K', count: 2 }]);
    const d = r.persons.find((p) => p.personId === 'D')!;
    expect(d.reviewOnly).toBe(true);
    expect(d.suspectedOwners).toEqual([{ ownerPersonId: 'X', count: 1 }]);
  });

  it('reviewOnlyByReason breaks down counts by reason and includes unAttributable', () => {
    const r = summarizeRepairPlan(plan);
    expect(r.totals.reviewOnlyByReason).toEqual({ overCap: 1, badTarget: 1, unAttributable: 1 });
  });
});
