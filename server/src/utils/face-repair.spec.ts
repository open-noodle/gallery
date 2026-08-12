import {
  ClassifyContext,
  ClassifyPersonInput,
  ReattributionNeighbor,
  ReattributionTally,
  applyVerdictFilters,
  classifyFlaggedPerson,
  decideReattribution,
  findOverlappingIds,
  findUnresolvableIds,
  isSubset,
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

const ctx = (over: Partial<ClassifyContext> = {}): ClassifyContext => ({
  reviewOnlyPersonIds: new Set<string>(),
  largeClusterThreshold: 50,
  ...over,
});

const person = (over: Partial<ClassifyPersonInput> = {}): ClassifyPersonInput => ({
  personId: 'person-1',
  personName: null,
  faceCount: 10,
  suspectedOwnerIds: ['owner-1'],
  ...over,
});

describe('classifyFlaggedPerson', () => {
  it('confident: unnamed, small, single clean owner', () => {
    expect(classifyFlaggedPerson(person(), ctx())).toEqual({ recommendation: 'confident', reviewReasons: [] });
  });

  it('review-first: named person (even with one clean owner)', () => {
    expect(classifyFlaggedPerson(person({ personName: 'Jula' }), ctx())).toEqual({
      recommendation: 'review-first',
      reviewReasons: ['named'],
    });
  });

  it('treats empty / whitespace name as unnamed', () => {
    expect(classifyFlaggedPerson(person({ personName: '' }), ctx()).reviewReasons).toEqual([]);
    expect(classifyFlaggedPerson(person({ personName: ' '.repeat(3) }), ctx()).reviewReasons).toEqual([]);
  });

  it('large-cluster boundary: 50 is confident, 51 is review-first', () => {
    expect(classifyFlaggedPerson(person({ faceCount: 50 }), ctx()).recommendation).toBe('confident');
    expect(classifyFlaggedPerson(person({ faceCount: 51 }), ctx())).toEqual({
      recommendation: 'review-first',
      reviewReasons: ['large-cluster'],
    });
  });

  it('uses the ctx largeClusterThreshold, not a hard-coded 50', () => {
    const c = ctx({ largeClusterThreshold: 10 });
    expect(classifyFlaggedPerson(person({ faceCount: 10 }), c).recommendation).toBe('confident');
    expect(classifyFlaggedPerson(person({ faceCount: 11 }), c).reviewReasons).toEqual(['large-cluster']);
  });

  it('review-first: more than one distinct suspected owner', () => {
    expect(classifyFlaggedPerson(person({ suspectedOwnerIds: ['owner-1', 'owner-2'] }), ctx()).reviewReasons).toEqual([
      'multiple-owners',
    ]);
  });

  it('does NOT flag multiple-owners when the same owner repeats', () => {
    expect(
      classifyFlaggedPerson(person({ suspectedOwnerIds: ['owner-1', 'owner-1', 'owner-1'] }), ctx()).reviewReasons,
    ).toEqual([]);
  });

  it('review-first: suspected owner is itself in reviewOnlyPersonIds (bad-target)', () => {
    const c = ctx({ reviewOnlyPersonIds: new Set(['owner-1']) });
    expect(classifyFlaggedPerson(person(), c).reviewReasons).toEqual(['bad-target']);
  });

  it('review-first: the person itself is over-cap (own id in reviewOnlyPersonIds)', () => {
    const c = ctx({ reviewOnlyPersonIds: new Set(['person-1']) });
    expect(classifyFlaggedPerson(person(), c)).toEqual({
      recommendation: 'review-first',
      reviewReasons: ['over-cap'],
    });
  });

  it('over-cap: a fully-contaminated unnamed small cluster is never confident', () => {
    // 100% flagged toward ONE clean owner used to classify confident (auto-selected) — approving it would
    // empty the cluster. The person's own over-cap status must force review-first.
    const c = ctx({ reviewOnlyPersonIds: new Set(['person-1']) });
    const result = classifyFlaggedPerson(person({ personName: null, faceCount: 8 }), c);
    expect(result.recommendation).toBe('review-first');
    expect(result.reviewReasons).toContain('over-cap');
  });

  it('accumulates reasons in deterministic order (named + large + multi + bad-target)', () => {
    const c = ctx({ reviewOnlyPersonIds: new Set(['person-1', 'owner-2']) });
    const result = classifyFlaggedPerson(
      person({ personName: 'Jula', faceCount: 99, suspectedOwnerIds: ['owner-1', 'owner-2'] }),
      c,
    );
    expect(result).toEqual({
      recommendation: 'review-first',
      reviewReasons: ['over-cap', 'named', 'large-cluster', 'multiple-owners', 'bad-target'],
    });
  });
});

const f = (assetFaceId: string, currentPersonId: string, suspectedOwnerId: string) => ({
  assetFaceId,
  currentPersonId,
  suspectedOwnerId,
});

describe('isSubset', () => {
  it('true when every element is present', () => {
    expect(isSubset(new Set(['a']), new Set(['a', 'b']))).toBe(true);
  });
  it('false when an element is missing', () => {
    expect(isSubset(new Set(['a', 'c']), new Set(['a', 'b']))).toBe(false);
  });
});

describe('applyVerdictFilters', () => {
  it('drops a face declined toward its current suspected owner', () => {
    const flagged = new Map([['P', [f('face1', 'P', 'Q'), f('face2', 'P', 'Q')]]]);
    applyVerdictFilters(flagged, {
      negativeFaceTargets: new Map([['face1', new Set(['person:Q'])]]),
      mutedPersons: new Map(),
    });
    expect(flagged.get('P')!.map((x) => x.assetFaceId)).toEqual(['face2']);
  });

  it('keeps a declined face if a DIFFERENT owner is now suspected (evidence changed)', () => {
    const flagged = new Map([['P', [f('face1', 'P', 'R')]]]);
    applyVerdictFilters(flagged, {
      negativeFaceTargets: new Map([['face1', new Set(['person:Q'])]]),
      mutedPersons: new Map(),
    });
    expect(flagged.get('P')!.map((x) => x.assetFaceId)).toEqual(['face1']);
  });

  it('drops a whole dismissed person when its suspected set is a subset of the fingerprint', () => {
    const flagged = new Map([['P', [f('face1', 'P', 'Q'), f('face2', 'P', 'Q')]]]);
    applyVerdictFilters(flagged, {
      negativeFaceTargets: new Map(),
      mutedPersons: new Map([['P', new Set(['Q', 'R'])]]),
    });
    expect(flagged.get('P')).toEqual([]);
  });

  it('re-surfaces a dismissed person when a NEW suspected owner appears', () => {
    const flagged = new Map([['P', [f('face1', 'P', 'Q'), f('face2', 'P', 'S')]]]);
    applyVerdictFilters(flagged, {
      negativeFaceTargets: new Map(),
      mutedPersons: new Map([['P', new Set(['Q'])]]),
    });
    expect(flagged.get('P')!.map((x) => x.assetFaceId)).toEqual(['face1', 'face2']);
  });

  it('applies face-level before person-level (a re-flagged new-owner face keeps the person)', () => {
    const flagged = new Map([['P', [f('face1', 'P', 'Q'), f('face2', 'P', 'S')]]]);
    applyVerdictFilters(flagged, {
      negativeFaceTargets: new Map([['face1', new Set(['person:Q'])]]),
      mutedPersons: new Map([['P', new Set(['Q'])]]),
    });
    // face1 dropped (declined); face2 toward NEW owner S keeps the person on the board
    expect(flagged.get('P')!.map((x) => x.assetFaceId)).toEqual(['face2']);
  });

  // U1 (Slice 3): a locked face is dropped for EVERY suspected owner — owner-agnostic, independent of the
  // decline map — unlike a decline, which only mutes one specific (face, suspectedOwner) pairing.
  it('drops a locked face regardless of its suspected owner, whether or not it is also declined', () => {
    const flagged = new Map([['P', [f('face1', 'P', 'Q'), f('face1', 'P', 'R'), f('face2', 'P', 'Q')]]]);
    applyVerdictFilters(flagged, {
      negativeFaceTargets: new Map(),
      mutedPersons: new Map(),
      manualLinkedFaceIds: new Set(['face1']),
    });
    expect(flagged.get('P')!.map((x) => x.assetFaceId)).toEqual(['face2']);
  });

  // U1 (temporal-consistency hardening design, Slice 4, E12): a regression lock proving the scoped-load
  // change (Step 2 scopes buildRepairPlan's getDeclineMaps read to the flagged set) cannot change what gets
  // dropped — applyVerdictFilters itself is agnostic to how its maps were populated, so feeding it a full
  // (unscoped) DeclineMaps or one pre-filtered down to only the flagged set's own ids must produce identical
  // results, as long as the scope actually covers every id the flagged set touches.
  it('produces identical drops whether fed full (unscoped) maps or maps scoped to the flagged set', () => {
    const buildFlagged = () =>
      new Map([
        ['P', [f('face1', 'P', 'Q'), f('face2', 'P', 'Q'), f('face3', 'P', 'R')]],
        ['S', [f('face4', 'S', 'T')]],
      ]);

    // The FULL (unscoped) table contents: face1/face2/S are relevant to the flagged set above; face5/face6/X
    // are entirely OUTSIDE it — the kind of unrelated row an unscoped read pulls in that a scoped read, built
    // from the flagged set's own face/person ids, would never fetch.
    const fullMaps = {
      negativeFaceTargets: new Map([
        ['face1', new Set(['person:Q'])],
        ['face5', new Set(['person:Z'])],
      ]),
      mutedPersons: new Map([
        ['S', new Set(['T'])],
        ['X', new Set(['Z'])],
      ]),
      manualLinkedFaceIds: new Set(['face2', 'face6']),
    };

    // A scoped read only ever returns rows for the flagged assetFaceIds/personIds — simulate that by
    // filtering fullMaps down to exactly the flagged set's own ids, mirroring what a real scoped
    // buildVerdictMaps({ assetFaceIds, personIds, suspectedOwnerIds }) call returns.
    const flaggedFaceIds = new Set(['face1', 'face2', 'face3', 'face4']);
    const flaggedPersonIds = new Set(['P', 'S']);
    const scopedMaps = {
      negativeFaceTargets: new Map([...fullMaps.negativeFaceTargets].filter(([faceId]) => flaggedFaceIds.has(faceId))),
      mutedPersons: new Map([...fullMaps.mutedPersons].filter(([personId]) => flaggedPersonIds.has(personId))),
      manualLinkedFaceIds: fullMaps.manualLinkedFaceIds.intersection(flaggedFaceIds),
    };

    const withFull = buildFlagged();
    applyVerdictFilters(withFull, fullMaps);

    const withScoped = buildFlagged();
    applyVerdictFilters(withScoped, scopedMaps);

    const asPlainObject = (m: Map<string, { assetFaceId: string }[]>) =>
      Object.fromEntries([...m].map(([id, faces]) => [id, faces.map((x) => x.assetFaceId)]));
    expect(asPlainObject(withScoped)).toEqual(asPlainObject(withFull));

    // Sanity: something was actually dropped by both — not a vacuous no-op comparison.
    expect(withFull.get('P')!.map((x) => x.assetFaceId)).toEqual(['face3']);
    expect(withScoped.get('P')!.map((x) => x.assetFaceId)).toEqual(['face3']);
    expect(withFull.get('S')).toEqual([]);
    expect(withScoped.get('S')).toEqual([]);
  });
});

describe('findOverlappingIds', () => {
  it('returns [] when every bucket is disjoint', () => {
    expect(findOverlappingIds([['a', 'b'], ['c'], [], ['d']])).toEqual([]);
  });

  it('flags an id present in two different buckets (E7)', () => {
    expect(
      findOverlappingIds([
        ['a', 'b'],
        ['b', 'c'],
      ]),
    ).toEqual(['b']);
  });

  it('flags an id present in three buckets only once', () => {
    expect(findOverlappingIds([['a'], ['a'], ['a']])).toEqual(['a']);
  });

  it('does not flag a duplicate id within the SAME bucket', () => {
    expect(findOverlappingIds([['a', 'a'], ['b']])).toEqual([]);
  });

  // F14: resolveFaces used to flatten every moveToPerson group's faceIds into ONE bucket before calling this,
  // which made a face routed to two different destinations invisible to the check below (both occurrences
  // collapsed into the same bucket's within-bucket de-duplication). The fix is entirely at the CALLER — pass
  // one bucket per move group — so this function needed no change; this test documents that it already
  // supports that shape as long as the caller stops flattening.
  it('flags a face present in two different moveToPerson groups, each passed as its own bucket (F14)', () => {
    const groupToQ = ['face-1', 'face-2'];
    const groupToR = ['face-1', 'face-3'];
    expect(findOverlappingIds([groupToQ, groupToR, [], [], []])).toEqual(['face-1']);
  });

  // Positive control for the above: a face that only ever appears in ONE move group must NOT be flagged,
  // proving the detection is genuinely about cross-group membership and not, say, "any face in a multi-group
  // request".
  it('does not flag a face that appears in only one of several moveToPerson groups', () => {
    const groupToQ = ['face-1', 'face-2'];
    const groupToR = ['face-3'];
    expect(findOverlappingIds([groupToQ, groupToR, [], [], []])).toEqual([]);
  });
});

describe('findUnresolvableIds', () => {
  it('returns [] when every id is in the resolvable set', () => {
    expect(findUnresolvableIds(['a', 'b'], new Set(['a', 'b', 'c']))).toEqual([]);
  });

  it('returns ids not present in the resolvable set (E15)', () => {
    expect(findUnresolvableIds(['a', 'x', 'b', 'y'], new Set(['a', 'b']))).toEqual(['x', 'y']);
  });

  it('returns [] for an empty input', () => {
    expect(findUnresolvableIds([], new Set(['a']))).toEqual([]);
  });
});
