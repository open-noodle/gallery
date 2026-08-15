import { haversineKm, MAX_ROUND_SCORE, scoreFromError } from 'src/utils/game-scoring';

describe('haversineKm', () => {
  it('returns zero for identical points', () => {
    expect(haversineKm({ lat: 52.52, lon: 13.405 }, { lat: 52.52, lon: 13.405 })).toBe(0);
  });

  it('measures a known distance within 1%', () => {
    // Berlin -> Paris is ~878 km
    const km = haversineKm({ lat: 52.52, lon: 13.405 }, { lat: 48.857, lon: 2.352 });
    expect(km).toBeGreaterThan(869);
    expect(km).toBeLessThan(887);
  });

  it('handles antipodal-ish points without NaN', () => {
    const km = haversineKm({ lat: -33.7, lon: 25.8 }, { lat: 48.9, lon: 8.1 });
    expect(Number.isFinite(km)).toBe(true);
    expect(km).toBeGreaterThan(8000);
  });
});

describe('scoreFromError', () => {
  it('awards the maximum for a perfect guess', () => {
    expect(scoreFromError(0, 10_000)).toBe(MAX_ROUND_SCORE);
  });

  it('decays monotonically as error grows', () => {
    const a = scoreFromError(10, 10_000);
    const b = scoreFromError(100, 10_000);
    const c = scoreFromError(1000, 10_000);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  // The property that makes this work for any library: the same RELATIVE error
  // earns the same score whether the pool spans a planet or a postcode.
  it('is scale invariant', () => {
    expect(scoreFromError(100, 10_000)).toBe(scoreFromError(1, 100));
    expect(scoreFromError(1, 100)).toBe(scoreFromError(0.05, 5));
  });

  it('never returns a negative score or NaN, even for a degenerate scale', () => {
    expect(scoreFromError(500, 0)).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(scoreFromError(500, 0))).toBe(false);
  });
});
