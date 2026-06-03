import {
  decideReattribution,
  ReattributionNeighbor,
  ReattributionTally,
  tallyReattribution,
} from 'src/utils/face-repair';

const n = (personId: string | null, distance: number): ReattributionNeighbor => ({
  assetFaceId: `${personId}-${distance}`,
  personId,
  distance,
});

const tally = (over: Partial<ReattributionTally>): ReattributionTally => ({
  ownCount: 0,
  ownNearest: null,
  topOtherPersonId: null,
  topOtherCount: 0,
  topOtherNearest: null,
  ...over,
});
const params = { minFaces: 3, voteMargin: 2, maxAttributionDistance: 0.35 };

describe('decideReattribution', () => {
  it('flags when a confident, close Q out-votes P by the vote margin', () => {
    const d = decideReattribution(
      tally({ ownCount: 1, topOtherPersonId: 'Q', topOtherCount: 8, topOtherNearest: 0.2 }),
      params,
    );
    expect(d).toEqual({ flagged: true, suspectedOwnerId: 'Q' });
  });

  it('flags when P does not claim F (ownCount < minFaces) and Q is confident and close', () => {
    const d = decideReattribution(
      tally({ ownCount: 1, topOtherPersonId: 'Q', topOtherCount: 5, topOtherNearest: 0.2 }),
      params,
    );
    expect(d.flagged).toBe(true);
    expect(d.suspectedOwnerId).toBe('Q');
  });

  it('does NOT flag a within-vote-margin rival when P also claims F', () => {
    const d = decideReattribution(
      tally({ ownCount: 6, topOtherPersonId: 'Q', topOtherCount: 7, topOtherNearest: 0.2 }),
      params,
    );
    expect(d).toEqual({ flagged: false, suspectedOwnerId: null });
  });

  it('does NOT flag when Q is not confident (topOtherCount < minFaces)', () => {
    const d = decideReattribution(
      tally({ ownCount: 0, topOtherPersonId: 'Q', topOtherCount: 2, topOtherNearest: 0.1 }),
      params,
    );
    expect(d.flagged).toBe(false);
  });

  it('enforces the absolute distance floor at the boundary', () => {
    // Q out-votes P, but Q's nearest is 0.40 > floor 0.35 -> NOT flagged
    const tooFar = decideReattribution(
      tally({ ownCount: 0, topOtherPersonId: 'Q', topOtherCount: 9, topOtherNearest: 0.4 }),
      params,
    );
    expect(tooFar.flagged).toBe(false);
    // Q's nearest is 0.30 <= 0.35 -> flagged
    const closeEnough = decideReattribution(
      tally({ ownCount: 0, topOtherPersonId: 'Q', topOtherCount: 9, topOtherNearest: 0.3 }),
      params,
    );
    expect(closeEnough.flagged).toBe(true);
  });

  it('does not use the current person distance (co-located contamination still flags)', () => {
    // ownNearest tiny (a co-located wrong sibling), Q equally close, Q out-votes -> MUST still flag.
    const d = decideReattribution(
      tally({ ownCount: 1, ownNearest: 0.05, topOtherPersonId: 'Q', topOtherCount: 9, topOtherNearest: 0.05 }),
      params,
    );
    expect(d.flagged).toBe(true);
  });

  it('voteMargin exact boundary: topOtherCount - ownCount === voteMargin is flagged (>=); one less is not', () => {
    // ownCount=6, topOtherCount=8, voteMargin=2 → 8-6 === 2 → flagged
    const atBoundary = decideReattribution(
      tally({ ownCount: 6, topOtherPersonId: 'Q', topOtherCount: 8, topOtherNearest: 0.2 }),
      { minFaces: 3, voteMargin: 2, maxAttributionDistance: 0.35 },
    );
    expect(atBoundary.flagged).toBe(true);
    expect(atBoundary.suspectedOwnerId).toBe('Q');

    // ownCount=7, topOtherCount=8, voteMargin=2 → 8-7 === 1 < 2, and ownCount(7)>=minFaces(3) → not flagged
    const oneShort = decideReattribution(
      tally({ ownCount: 7, topOtherPersonId: 'Q', topOtherCount: 8, topOtherNearest: 0.2 }),
      { minFaces: 3, voteMargin: 2, maxAttributionDistance: 0.35 },
    );
    expect(oneShort.flagged).toBe(false);
  });

  it('voteMargin:0 — a tie out-votes when margin is 0 (documents intentional behavior)', () => {
    // ownCount=5, topOtherCount=5, voteMargin=0 → 5-5 === 0 >= 0 → flagged
    const d = decideReattribution(
      tally({ ownCount: 5, topOtherPersonId: 'Q', topOtherCount: 5, topOtherNearest: 0.2 }),
      { minFaces: 3, voteMargin: 0, maxAttributionDistance: 0.35 },
    );
    expect(d.flagged).toBe(true);
    expect(d.suspectedOwnerId).toBe('Q');
  });
});

describe('tallyReattribution', () => {
  it('reports the dominant other owner by neighbor count', () => {
    const tally = tallyReattribution('P', [n('Q', 0.1), n('Q', 0.2), n('Q', 0.3), n('P', 0.4)]);
    expect(tally.ownCount).toBe(1);
    expect(tally.topOtherPersonId).toBe('Q');
    expect(tally.topOtherCount).toBe(3);
    expect(tally.topOtherNearest).toBeCloseTo(0.1);
  });

  it('breaks ties on nearest distance', () => {
    const tally = tallyReattribution('P', [n('Q', 0.5), n('R', 0.2)]);
    expect(tally.topOtherPersonId).toBe('R');
  });

  it('returns no other owner when only the current person is nearby', () => {
    const tally = tallyReattribution('P', [n('P', 0.1), n('P', 0.2)]);
    expect(tally.ownCount).toBe(2);
    expect(tally.topOtherPersonId).toBeNull();
    expect(tally.topOtherCount).toBe(0);
  });

  it('ignores neighbors with no person', () => {
    const tally = tallyReattribution('P', [n(null, 0.1), n('Q', 0.2)]);
    expect(tally.topOtherPersonId).toBe('Q');
    expect(tally.topOtherCount).toBe(1);
  });

  it('breaks ties on personId (lexical) when count and nearest distance are equal — order independent', () => {
    // B inserted before A — without tiebreak, B wins due to insertion order
    const t1 = tallyReattribution('P', [n('B', 0.2), n('A', 0.2)]);
    // A inserted before B
    const t2 = tallyReattribution('P', [n('A', 0.2), n('B', 0.2)]);
    // 'A' < 'B' lexically — A must win regardless of input order
    expect(t1.topOtherPersonId).toBe('A');
    expect(t2.topOtherPersonId).toBe('A');
  });
});
