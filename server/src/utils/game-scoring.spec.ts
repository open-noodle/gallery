import {
  haversineKm,
  type LatLon,
  MAX_ROUND_SCORE,
  MIN_SCALE,
  mulberry32,
  poolScaleDays,
  poolScaleKm,
  scoreFromError,
} from 'src/utils/game-scoring';

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

describe('poolScaleKm', () => {
  const cityPool = (): LatLon[] =>
    Array.from({ length: 200 }, (_, i) => ({ lat: 52.5 + (i % 20) * 0.005, lon: 13.4 + Math.floor(i / 20) * 0.005 }));

  it('returns a small scale for a tightly clustered pool', () => {
    const scale = poolScaleKm(cityPool(), mulberry32(1));
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(30);
  });

  it('returns a large scale for a globe-spanning pool', () => {
    const world: LatLon[] = [
      { lat: 52.5, lon: 13.4 },
      { lat: -33.9, lon: 18.4 },
      { lat: 40.7, lon: -74.0 },
      { lat: 47.9, lon: 106.9 },
      { lat: 41.9, lon: 12.5 },
    ];
    expect(poolScaleKm(world, mulberry32(1))).toBeGreaterThan(5000);
  });

  // The failure that motivated using a percentile: a bounding box is a min/max
  // statistic, so a handful of holiday photos redefine the scale for every local
  // round and the game inverts.
  it('is not hijacked by a few far-away outliers', () => {
    const clean = poolScaleKm(cityPool(), mulberry32(7));
    const polluted = poolScaleKm(
      [...cityPool(), { lat: 47.9, lon: 106.9 }, { lat: -33.9, lon: 18.4 }, { lat: 40.7, lon: -74.0 }],
      mulberry32(7),
    );
    expect(polluted).toBeLessThan(clean * 3);
  });

  it('returns the floor for a pool with fewer than two points', () => {
    expect(poolScaleKm([], mulberry32(1))).toBe(MIN_SCALE);
    expect(poolScaleKm([{ lat: 1, lon: 1 }], mulberry32(1))).toBe(MIN_SCALE);
  });

  it('is deterministic for a given seed', () => {
    expect(poolScaleKm(cityPool(), mulberry32(42))).toBe(poolScaleKm(cityPool(), mulberry32(42)));
  });
});

describe('poolScaleDays', () => {
  it('spans the bulk of the date range', () => {
    const dates = Array.from({ length: 100 }, (_, i) => new Date(2020, 0, 1 + i * 10));
    const scale = poolScaleDays(dates, mulberry32(3));
    expect(scale).toBeGreaterThan(100);
    expect(scale).toBeLessThan(1200);
  });

  it('returns at least one day for a single-date pool', () => {
    expect(poolScaleDays([new Date(2020, 0, 1)], mulberry32(1))).toBeGreaterThanOrEqual(1);
  });
});
