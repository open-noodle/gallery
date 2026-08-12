import { describe, expect, it } from 'vitest';
import { createScanTriageModel, type FaceCleanupPerson } from './scan-triage.svelte';

const person = (
  over: Partial<FaceCleanupPerson> & Pick<FaceCleanupPerson, 'personId' | 'recommendation'>,
): FaceCleanupPerson => ({
  ownerId: 'owner-1',
  personName: null,
  faceCount: 10,
  thumbnailFaceId: 'face-1',
  eligible: 10,
  flagged: 3,
  flaggedFraction: 0.3,
  suspectedOwners: [
    {
      ownerPersonId: 'dest-1',
      ownerName: 'Dest',
      thumbnailFaceId: 'f',
      count: 3,
      ownerFaceCount: 3,
      ownerMissing: false,
    },
  ],
  reviewReasons: [],
  ...over,
});

const conf = (id: string) => person({ personId: id, recommendation: 'confident' });
const rev = (id: string) => person({ personId: id, recommendation: 'review-first' });

describe('createScanTriageModel', () => {
  it('splits confident and review-first clusters', () => {
    const m = createScanTriageModel([conf('c1'), rev('r1'), conf('c2')]);
    expect(m.confident.map((p) => p.personId)).toEqual(['c1', 'c2']);
    expect(m.reviewFirst.map((p) => p.personId)).toEqual(['r1']);
  });

  it('approves every confident cluster by default (no exclusions)', () => {
    const m = createScanTriageModel([conf('c1'), conf('c2'), rev('r1')]);
    expect(m.excluded.size).toBe(0);
    expect(m.approvedIds).toEqual(['c1', 'c2']);
    expect(m.approvedCount).toBe(2);
  });

  it('excluding a confident cluster drops it from the approved set and count', () => {
    const m = createScanTriageModel([conf('c1'), conf('c2')]);
    m.toggleExcluded('c1');
    expect(m.isExcluded('c1')).toBe(true);
    expect(m.approvedIds).toEqual(['c2']);
    expect(m.approvedCount).toBe(1);
  });

  it('re-including a previously excluded cluster restores it', () => {
    const m = createScanTriageModel([conf('c1'), conf('c2')]);
    m.toggleExcluded('c1');
    m.toggleExcluded('c1');
    expect(m.isExcluded('c1')).toBe(false);
    expect(m.approvedIds).toEqual(['c1', 'c2']);
  });

  it('never lets a review-first id enter the exclusion set (it is not in the bulk)', () => {
    const m = createScanTriageModel([conf('c1'), rev('r1')]);
    m.toggleExcluded('r1');
    expect(m.excluded.size).toBe(0);
    expect(m.approvedIds).toEqual(['c1']);
  });

  it('reset() clears all exclusions (approve all again)', () => {
    const m = createScanTriageModel([conf('c1'), conf('c2')]);
    m.toggleExcluded('c1');
    m.reset();
    expect(m.excluded.size).toBe(0);
    expect(m.approvedIds).toEqual(['c1', 'c2']);
  });

  it('carries exclusions across a rebuild via prev, dropping ones whose cluster no longer exists', () => {
    const first = createScanTriageModel([conf('c1'), conf('c2'), conf('c3')]);
    first.toggleExcluded('c1');
    first.toggleExcluded('c3');
    // c3 was dismissed/re-homed and is gone from the new snapshot.
    const second = createScanTriageModel([conf('c1'), conf('c2')], { prev: first });
    expect(second.isExcluded('c1')).toBe(true);
    expect([...second.excluded]).toEqual(['c1']); // c3 dropped
    expect(second.approvedIds).toEqual(['c2']);
  });
});
