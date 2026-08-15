import {
  type GameCandidate,
  geoCellKey,
  haversineKm,
  type LatLon,
  MAX_ROUND_SCORE,
  MIN_SCALE,
  mulberry32,
  poolScaleDays,
  poolScaleKm,
  scoreFromError,
  selectLocationRounds,
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
  // eslint-disable-next-line unicorn/consistent-function-scoping
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
      { lat: 40.7, lon: -74 },
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
      [...cityPool(), { lat: 47.9, lon: 106.9 }, { lat: -33.9, lon: 18.4 }, { lat: 40.7, lon: -74 }],
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

const candidate = (id: string, lat: number, lon: number, country: string): GameCandidate => ({
  assetId: id,
  lat,
  lon,
  takenAt: new Date(2020, 0, 1),
  country,
});

describe('geoCellKey', () => {
  it('puts nearby points in the same cell', () => {
    expect(geoCellKey({ lat: 52.5, lon: 13.4 }, 50)).toBe(geoCellKey({ lat: 52.51, lon: 13.41 }, 50));
  });

  it('puts distant points in different cells', () => {
    expect(geoCellKey({ lat: 52.5, lon: 13.4 }, 50)).not.toBe(geoCellKey({ lat: 48.9, lon: 2.4 }, 50));
  });

  it('keeps nearby high-latitude points in the same cell despite converging meridians', () => {
    // At 89N, 10 degrees of longitude is only ~19km - well inside a 50km cell.
    expect(geoCellKey({ lat: 89, lon: 0 }, 50)).toBe(geoCellKey({ lat: 89, lon: 10 }, 50));
  });

  it('puts points either side of the antimeridian in the same cell', () => {
    expect(geoCellKey({ lat: 60, lon: 179.99 }, 50)).toBe(geoCellKey({ lat: 60, lon: -179.99 }, 50));
  });
});

describe('selectLocationRounds', () => {
  const spread: GameCandidate[] = [
    candidate('a', 52.5, 13.4, 'Germany'),
    candidate('b', -33.9, 18.4, 'South Africa'),
    candidate('c', 40.7, -74, 'United States'),
    candidate('d', 47.9, 106.9, 'Mongolia'),
    candidate('e', 41.9, 12.5, 'Italy'),
    candidate('f', 45.8, 15.9, 'Croatia'),
  ];

  it('returns the requested number of distinct assets', () => {
    const picked = selectLocationRounds(spread, 5, 15_000, mulberry32(1));
    expect(picked).toHaveLength(5);
    expect(new Set(picked.map((p) => p.assetId)).size).toBe(5);
  });

  it('never picks two answers closer than the minimum separation', () => {
    const scaleKm = 15_000;
    const minSeparation = scaleKm / 75;
    const picked = selectLocationRounds(spread, 5, scaleKm, mulberry32(2));
    for (let i = 0; i < picked.length; i++) {
      for (let j = i + 1; j < picked.length; j++) {
        const a = { lat: picked[i].lat!, lon: picked[i].lon! };
        const b = { lat: picked[j].lat!, lon: picked[j].lon! };
        expect(haversineKm(a, b)).toBeGreaterThanOrEqual(minSeparation);
      }
    }
  });

  it('caps how many rounds share a country when alternatives exist', () => {
    const germanHeavy: GameCandidate[] = [
      ...Array.from({ length: 20 }, (_, i) => candidate(`de${i}`, 48 + i * 0.3, 8 + i * 0.3, 'Germany')),
      candidate('za', -33.9, 18.4, 'South Africa'),
      candidate('us', 40.7, -74, 'United States'),
      candidate('mn', 47.9, 106.9, 'Mongolia'),
    ];
    const picked = selectLocationRounds(germanHeavy, 5, 15_000, mulberry32(3));
    const germanCount = picked.filter((p) => p.country === 'Germany').length;
    expect(germanCount).toBeLessThanOrEqual(2);
  });

  // A clustered pool must still yield a playable set - relaxing beats failing.
  it('relaxes constraints rather than returning an empty set', () => {
    const clustered = Array.from({ length: 12 }, (_, i) => candidate(`c${i}`, 52.5 + i * 0.01, 13.4, 'Germany'));
    const picked = selectLocationRounds(clustered, 5, 20, mulberry32(4));
    expect(picked.length).toBeGreaterThan(0);
    expect(new Set(picked.map((p) => p.assetId)).size).toBe(picked.length);
  });

  it('returns fewer rounds than requested when the pool is genuinely too small', () => {
    expect(selectLocationRounds(spread.slice(0, 2), 5, 15_000, mulberry32(5))).toHaveLength(2);
  });

  it('is deterministic for a given seed', () => {
    const a = selectLocationRounds(spread, 5, 15_000, mulberry32(9)).map((p) => p.assetId);
    const b = selectLocationRounds(spread, 5, 15_000, mulberry32(9)).map((p) => p.assetId);
    expect(a).toEqual(b);
  });
});
