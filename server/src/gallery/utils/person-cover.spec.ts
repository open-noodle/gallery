import {
  PERSON_COVER_MARGIN,
  PERSON_COVER_POOL_SIZE,
  PERSON_COVER_VERSION,
  hasGrownSincePick,
  isCoverProtected,
  isPickStale,
  pickCover,
  scaledRanks,
  selectCoverPool,
  typicality,
  type CoverCandidate,
  type CoverPixels,
} from 'src/gallery/utils/person-cover.js';

const latest = new Date('2026-06-01T12:00:00Z');
const yearsBefore = (years: number) => new Date(latest.getTime() - years * 365 * 86_400_000);

let next = 0;
const candidate = (overrides: Partial<CoverCandidate> = {}): CoverCandidate => {
  next++;
  return {
    faceId: `face-${String(next).padStart(4, '0')}`,
    assetId: `asset-${next}`,
    date: latest,
    trustedDate: true,
    size: 100,
    embedding: [1, 0, 0],
    ...overrides,
  };
};

const good: CoverPixels = { sharpness: 100, brightness: 128, clippedDark: 0 };
const pixelsFor = (candidates: CoverCandidate[], overrides: Record<string, Partial<CoverPixels>> = {}) =>
  new Map(candidates.map(({ faceId }) => [faceId, { ...good, ...overrides[faceId] }]));
const ids = (candidates: CoverCandidate[]) => candidates.map(({ faceId }) => faceId).toSorted();

describe(selectCoverPool.name, () => {
  it('takes the shortest window before the latest trusted date that holds k faces', () => {
    // n = 6 trusted faces, so k = 3: the 3-year window holds 2, the 6-year one holds 3.
    const recent = [candidate({ date: latest }), candidate({ date: yearsBefore(2) })];
    const middle = candidate({ date: yearsBefore(5) });
    const old = [
      candidate({ date: yearsBefore(9) }),
      candidate({ date: yearsBefore(15) }),
      candidate({ date: yearsBefore(30) }),
    ];

    expect(ids(selectCoverPool([...recent, middle, ...old]))).toEqual(ids([...recent, middle]));
  });

  it.each([
    [3, 2.9],
    [6, 5.9],
    [10, 9.9],
    [20, 19.9],
  ])('stops at the %i-year window when it is the first to hold k faces', (years, age) => {
    // Three faces at `age`, three just past the window: k = 3, and the shorter windows hold only the latest.
    const inside = [
      candidate({ date: latest }),
      candidate({ date: yearsBefore(age) }),
      candidate({ date: yearsBefore(age) }),
    ];
    const outside = [1, 2, 3].map(() => candidate({ date: yearsBefore(years + 0.5) }));

    expect(ids(selectCoverPool([...inside, ...outside]))).toEqual(ids(inside));
  });

  it('falls through to all trusted faces when no window holds k of them', () => {
    const faces = [
      candidate({ date: latest }),
      candidate({ date: yearsBefore(25) }),
      candidate({ date: yearsBefore(40) }),
    ];

    expect(ids(selectCoverPool(faces))).toEqual(ids(faces));
  });

  it('needs half of the trusted faces, at least 3 and at most 10', () => {
    // 40 trusted faces: k = 10. Nine are recent, the rest from 4 years back, so the 3-year window is not enough.
    const recent = Array.from({ length: 9 }, () => candidate({ date: latest }));
    const older = Array.from({ length: 31 }, () => candidate({ date: yearsBefore(4) }));
    expect(selectCoverPool([...recent, ...older])).toHaveLength(40);

    // 6 trusted faces: k = 3, and three recent ones are enough.
    const few = [candidate(), candidate(), candidate()];
    expect(ids(selectCoverPool([...few, ...[1, 2, 3].map(() => candidate({ date: yearsBefore(4) }))]))).toEqual(
      ids(few),
    );
  });

  it('uses only trusted dates, and every face when none is trusted', () => {
    const scan = candidate({ trustedDate: false, date: latest });
    const camera = [
      candidate({ date: yearsBefore(8) }),
      candidate({ date: yearsBefore(8) }),
      candidate({ date: yearsBefore(9) }),
    ];
    expect(ids(selectCoverPool([scan, ...camera]))).toEqual(ids(camera));

    const scans = [candidate({ trustedDate: false }), candidate({ trustedDate: false, date: yearsBefore(30) })];
    expect(ids(selectCoverPool(scans))).toEqual(ids(scans));
  });

  it('keeps the largest faces, up to the pool size', () => {
    const faces = Array.from({ length: PERSON_COVER_POOL_SIZE + 5 }, (_, i) => candidate({ size: 10 + i }));

    const pool = selectCoverPool(faces);

    expect(pool).toHaveLength(PERSON_COVER_POOL_SIZE);
    expect(Math.min(...pool.map(({ size }) => size))).toBe(15);
  });

  it('is empty for no candidates', () => {
    expect(selectCoverPool([])).toEqual([]);
  });
});

describe(scaledRanks.name, () => {
  it('scales ranks to 0-1 and gives equal values their average rank', () => {
    expect(scaledRanks([30, 10, 20])).toEqual([1, 0, 0.5]);
    expect(scaledRanks([5, 5, 1, 9])).toEqual([0.5, 0.5, 0, 1]);
    expect(scaledRanks([7])).toEqual([0]);
  });
});

describe(typicality.name, () => {
  it('scores a face far from the others below the rest', () => {
    const faces = [
      candidate({ embedding: [1, 0.1, 0] }),
      candidate({ embedding: [1, 0, 0.1] }),
      candidate({ embedding: [2, 0, 0] }),
      candidate({ embedding: [0, 1, 0] }),
    ];

    const scores = typicality(faces);
    const outlier = scores.get(faces[3].faceId)!;

    expect(Math.max(...[0, 1, 2].map((i) => scores.get(faces[i].faceId)!))).toBeLessThanOrEqual(1);
    for (const i of [0, 1, 2]) {
      expect(scores.get(faces[i].faceId)!).toBeGreaterThan(outlier);
    }
  });
});

// Three faces equal but for their date: the newest beats the current one by half a date rank, 0.075.
const marginFaces = () => {
  const current = candidate({ date: yearsBefore(0.5), size: 100 });
  const slightlyBetter = candidate({ date: latest, size: 100 });
  const worse = candidate({ date: yearsBefore(1), size: 100 });
  const faces = [current, slightlyBetter, worse];
  return { current, slightlyBetter, worse, faces };
};

describe(pickCover.name, () => {
  it('weighs sharpness above size', () => {
    const sharp = candidate({ size: 100 });
    const large = candidate({ size: 200 });

    const pick = pickCover({
      candidates: [sharp, large],
      pixels: pixelsFor([sharp, large], { [sharp.faceId]: { sharpness: 500 }, [large.faceId]: { sharpness: 50 } }),
    });

    expect(pick?.faceId).toBe(sharp.faceId);
  });

  it('leaves out badly exposed faces, unless no face is well exposed', () => {
    const dark = candidate({ size: 300 });
    const bright = candidate({ size: 300 });
    const clipped = candidate({ size: 300 });
    const fine = candidate({ size: 50 });
    const faces = [dark, bright, clipped, fine];
    const exposure = {
      [dark.faceId]: { brightness: 40, sharpness: 900 },
      [bright.faceId]: { brightness: 230, sharpness: 900 },
      [clipped.faceId]: { clippedDark: 0.3, sharpness: 900 },
    };

    expect(pickCover({ candidates: faces, pixels: pixelsFor(faces, exposure) })?.faceId).toBe(fine.faceId);

    const allBad = [dark, bright];
    expect(pickCover({ candidates: allBad, pixels: pixelsFor(allBad, exposure) })).toBeDefined();
  });

  it('prefers the more recent of two otherwise equal faces', () => {
    const older = candidate({ date: yearsBefore(1) });
    const newer = candidate({ date: latest });

    expect(pickCover({ candidates: [older, newer], pixels: pixelsFor([older, newer]) })?.faceId).toBe(newer.faceId);
  });

  it('gives a tie on the score to the more recent face', () => {
    // Newer and larger against older and sharper: 0.20 + 0.15 = 0.35 on each side.
    const newer = candidate({ date: latest, size: 200 });
    const older = candidate({ date: yearsBefore(1), size: 100 });
    const pixels = pixelsFor([newer, older], { [newer.faceId]: { sharpness: 50 }, [older.faceId]: { sharpness: 500 } });

    const pick = pickCover({ candidates: [older, newer], pixels, currentFaceId: older.faceId });

    expect(pick?.faceId).toBe(newer.faceId);
    expect(pick?.score).toBeCloseTo(pick!.currentScore!, 9);
  });

  it('chooses between two candidates', () => {
    const a = candidate();
    const b = candidate();

    const pick = pickCover({ candidates: [a, b], pixels: pixelsFor([a, b], { [b.faceId]: { sharpness: 1000 } }) });

    expect(pick?.faceId).toBe(b.faceId);
  });

  it('leaves out pool faces whose preview could not be read', () => {
    const unreadable = candidate({ size: 500 });
    const read = candidate({ size: 50 });

    expect(pickCover({ candidates: [unreadable, read], pixels: pixelsFor([read]) })?.faceId).toBe(read.faceId);
    expect(pickCover({ candidates: [unreadable], pixels: new Map() })).toBeUndefined();
  });

  describe('margin', () => {
    it('keeps the current cover when the best is less than the margin above it', () => {
      const { current, faces } = marginFaces();

      const pick = pickCover({
        candidates: faces,
        pixels: pixelsFor(faces),
        currentFaceId: current.faceId,
        margin: PERSON_COVER_MARGIN,
      });

      expect(pick?.faceId).toBe(current.faceId);
      expect(pick?.currentScore).toBe(pick?.score);
    });

    it('replaces it when the best is clearly better', () => {
      const { current, slightlyBetter, faces } = marginFaces();

      const pick = pickCover({
        candidates: faces,
        pixels: pixelsFor(faces, { [slightlyBetter.faceId]: { sharpness: 1000 } }),
        currentFaceId: current.faceId,
        margin: PERSON_COVER_MARGIN,
      });

      expect(pick?.faceId).toBe(slightlyBetter.faceId);
      expect(pick!.score - pick!.currentScore!).toBeGreaterThanOrEqual(PERSON_COVER_MARGIN);
    });

    it('takes the best without a margin', () => {
      const { current, slightlyBetter, faces } = marginFaces();

      expect(pickCover({ candidates: faces, pixels: pixelsFor(faces), currentFaceId: current.faceId })?.faceId).toBe(
        slightlyBetter.faceId,
      );
    });

    it('replaces a current cover that is not among the kept faces', () => {
      const { current, slightlyBetter, faces } = marginFaces();

      const darkCurrent = pickCover({
        candidates: faces,
        pixels: pixelsFor(faces, { [current.faceId]: { brightness: 10 } }),
        currentFaceId: current.faceId,
        margin: 1,
      });
      expect(darkCurrent?.faceId).toBe(slightlyBetter.faceId);

      const videoFace = pickCover({
        candidates: faces,
        pixels: pixelsFor(faces),
        currentFaceId: 'not-a-candidate',
        margin: 1,
      });
      expect(videoFace?.faceId).toBe(slightlyBetter.faceId);
    });
  });
});

describe('three-state rule', () => {
  const face = 'face-1';
  const states = {
    none: undefined,
    auto: { source: 'auto' as const, faceId: face },
    manual: { source: 'manual' as const, faceId: face },
    'manual, no longer holding': { source: 'manual' as const, faceId: 'face-gone' },
    unknown: { source: 'unknown' as const, faceId: face },
    'unknown, no longer holding': { source: 'unknown' as const, faceId: 'face-gone' },
  };

  // Truth table from specs/2026-11-21-person-cover-quality-design.md, "Personal people: person_cover".
  const expected: Record<keyof typeof states, Record<'missing' | 'all' | 'action', boolean>> = {
    none: { missing: false, all: false, action: false },
    auto: { missing: false, all: false, action: false },
    manual: { missing: true, all: true, action: false },
    'manual, no longer holding': { missing: false, all: false, action: false },
    unknown: { missing: true, all: false, action: false },
    'unknown, no longer holding': { missing: false, all: false, action: false },
  };

  for (const [state, cover] of Object.entries(states)) {
    for (const mode of ['missing', 'all', 'action'] as const) {
      const protectedCover = expected[state as keyof typeof states][mode];
      it(`${mode} ${protectedCover ? 'keeps' : 'may replace'} a cover that is ${state}`, () => {
        expect(isCoverProtected(cover, face, mode)).toBe(protectedCover);
      });
    }
  }

  it('never protects a row for a person with no cover', () => {
    expect(isCoverProtected({ source: 'manual', faceId: null }, null, 'missing')).toBe(false);
  });
});

describe(isPickStale.name, () => {
  const pick = { faceId: 'face-1', version: PERSON_COVER_VERSION, candidateCount: 8 };

  it('is stale with no pick, a moved cover or an older version', () => {
    expect(isPickStale(undefined, 'face-1', 8)).toBe(true);
    expect(isPickStale(pick, 'face-2', 8)).toBe(true);
    expect(isPickStale({ ...pick, version: PERSON_COVER_VERSION - 1 }, 'face-1', 8)).toBe(true);
    expect(isPickStale({ ...pick, version: null }, 'face-1', 8)).toBe(true);
  });

  it('is fresh until the candidates grow by a quarter', () => {
    expect(isPickStale(pick, 'face-1', 9)).toBe(false);
    expect(isPickStale(pick, 'face-1', 10)).toBe(true);
    expect(isPickStale(pick, 'face-1', 3)).toBe(false);
  });
});

describe(hasGrownSincePick.name, () => {
  it.each([
    [0, 1, true],
    [1, 2, true],
    [2, 3, true],
    [3, 3, false],
    [4, 5, true],
    [8, 9, false],
    [8, 10, true],
    [40, 49, false],
    [40, 50, true],
  ])('%i candidates then %i: %s', (recorded, current, grown) => {
    expect(hasGrownSincePick(recorded, current)).toBe(grown);
  });
});
