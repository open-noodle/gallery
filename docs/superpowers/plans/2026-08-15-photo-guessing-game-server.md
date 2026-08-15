# Photo Guessing Game — Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete server side of a GeoGuessr-style guessing game played on a shared space's photos — schema, round generation, scoring, and a leak-proof HTTP API.

**Architecture:** A fork-only NestJS feature in the shape of `shared-space.service.ts`: three new tables in the fork-owned migration directory, one repository, one service, one controller. Pure sampling and scoring logic lives in a dependency-free util so it can be unit-tested without a database. Round answers are denormalised into the round row at generation time so scores stay stable if an asset is later edited or deleted.

**Tech Stack:** TypeScript, NestJS 11, Kysely (not TypeORM), PostgreSQL with pgvector/vectorchord, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-photo-guessing-game-design.md`

## Global Constraints

- **No relative imports in `server/`** — always use the `src/` path alias. Enforced by ESLint.
- **Prettier:** 120 char line width, single quotes, trailing commas, semicolons.
- **ESLint runs with `--max-warnings 0`.** Zero-warning policy.
- **Fork migrations go in `server/src/schema/migrations-gallery/`, never `migrations/`.** The latter is replaced wholesale on upstream rebases. Use a round timestamp; the next free one is `1791000000000`.
- **Unit tests need the `--config` flag.** The server's vitest config is not at the package root, so `pnpm vitest run <path>` starts with no config, no `globals: true`, and every spec dies with `ReferenceError: describe is not defined`. Always: `cd server && pnpm vitest --config test/vitest.config.mjs run <path>`.
- **A fresh worktree must have `@immich/sdk`, `@immich/plugin-sdk` and `@immich/plugin-core` built** before any server test will collect. Already done in this worktree.
- **Reading a suite result:** a healthy server unit run is ~169 files / ~5.7k tests. Vitest **exits 0 even when test files fail to collect**, so read the `Test Files` line, never the exit code.
- **Pool scope is the space's own assets only.** Never widen candidate selection beyond `shared_space_asset` for the target space.
- **Score is computed once at submission and stored.** Never recompute a stored score.

---

## File Structure

**Create:**

- `server/src/utils/game-scoring.ts` — pure scoring, geo maths, pool scale, spread sampling. No NestJS, no DB, no imports from repositories.
- `server/src/utils/game-scoring.spec.ts` — unit tests for the above.
- `server/src/schema/tables/game-challenge.table.ts` — `game_challenge`.
- `server/src/schema/tables/game-round.table.ts` — `game_round`.
- `server/src/schema/tables/game-guess.table.ts` — `game_guess`.
- `server/src/schema/migrations-gallery/1791000000000-AddPhotoGuessingGame.ts` — the migration.
- `server/src/repositories/game.repository.ts` — all Kysely queries.
- `server/src/services/game.service.ts` — challenge lifecycle, generation, guessing, leaderboard.
- `server/src/services/game.service.spec.ts` — service unit tests.
- `server/src/dtos/game.dto.ts` — request/response DTOs.
- `server/src/controllers/game.controller.ts` — HTTP surface.
- `server/src/utils/shared-space-role.ts` — the role hierarchy, extracted so both `SharedSpaceService` and `GameService` can use it.

**Modify:**

- `server/src/schema/index.ts` — register three tables (import, `tables` array, DB interface map).
- `server/src/repositories/index.ts` — register `GameRepository`.
- `server/src/services/base.service.ts` — inject `GameRepository` (constructor **and** both positional lists).
- `server/src/services/index.ts` — register `GameService`.
- `server/src/controllers/index.ts` — register `GameController`.
- `server/test/utils.ts` — register the repository mock (map **and** positional list).
- `server/src/services/shared-space.service.ts` — use the extracted role helper instead of its local copy.

**Design note — why a separate `game-scoring.ts`:** all the logic with real failure modes (scale invariance, outlier-resistant pool scale, spread-rule relaxation) is pure. Isolating it means it is tested exhaustively without a database, and the service becomes thin orchestration.

---

## Task 1: Pure scoring and geo maths

**Files:**

- Create: `server/src/utils/game-scoring.ts`
- Test: `server/src/utils/game-scoring.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `type LatLon = { lat: number; lon: number }`
  - `haversineKm(a: LatLon, b: LatLon): number`
  - `scoreFromError(error: number, scale: number): number`
  - `MAX_ROUND_SCORE: 5000`
  - `SCORE_DECAY: 10`
  - `MIN_SCALE: 0.5`

- [ ] **Step 1: Write the failing test**

Create `server/src/utils/game-scoring.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/utils/game-scoring.spec.ts`

Expected: FAIL — `Failed to resolve import "src/utils/game-scoring"`.

- [ ] **Step 3: Write the minimal implementation**

Create `server/src/utils/game-scoring.ts`:

```ts
export type LatLon = { lat: number; lon: number };

/** Points awarded for a perfect guess. */
export const MAX_ROUND_SCORE = 5000;

/**
 * Decay steepness. With this value an error of one tenth of the pool scale keeps
 * e^-1 (~37%) of the points, matching the curve GeoGuessr uses on its world map.
 */
export const SCORE_DECAY = 10;

/** Floor for the pool scale, so a single-point pool cannot divide by zero. */
export const MIN_SCALE = 0.5;

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const haversineKm = (a: LatLon, b: LatLon): number => {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
};

/**
 * Exponential decay whose characteristic length is the challenge's own pool scale.
 *
 * A fixed constant would only suit one library: measured against a city-sized pool
 * it left 20 points between a perfect player and one who pinned the same spot every
 * round. Deriving the scale from the pool keeps that gap above 2,300 at every size.
 */
export const scoreFromError = (error: number, scale: number): number => {
  const safeScale = Math.max(scale, MIN_SCALE);
  const value = MAX_ROUND_SCORE * Math.exp((-SCORE_DECAY * Math.abs(error)) / safeScale);
  return Math.max(0, Math.round(value));
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/utils/game-scoring.spec.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/game-scoring.ts server/src/utils/game-scoring.spec.ts
git commit -m "feat(game): add scale-invariant round scoring"
```

---

## Task 2: Outlier-resistant pool scale

**Files:**

- Modify: `server/src/utils/game-scoring.ts`
- Test: `server/src/utils/game-scoring.spec.ts`

**Interfaces:**

- Consumes: `LatLon`, `haversineKm` from Task 1.
- Produces:
  - `poolScaleKm(points: LatLon[], random: () => number, sampleCount?: number): number`
  - `poolScaleDays(dates: Date[], random: () => number, sampleCount?: number): number`
  - `mulberry32(seed: number): () => number`

`random` is injected rather than using `Math.random` so generation is reproducible and tests are deterministic.

- [ ] **Step 1: Write the failing test**

Append to `server/src/utils/game-scoring.spec.ts`:

```ts
import { type LatLon, MIN_SCALE, mulberry32, poolScaleDays, poolScaleKm } from 'src/utils/game-scoring';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/utils/game-scoring.spec.ts`

Expected: FAIL — `poolScaleKm is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Append to `server/src/utils/game-scoring.ts`:

```ts
/** Number of random pairs sampled when estimating a pool's scale. */
const DEFAULT_SAMPLE_COUNT = 4000;

/** Percentile of the pairwise distribution used as the pool scale. */
const SCALE_PERCENTILE = 0.9;

/** Small, fast, seedable PRNG. Deterministic generation beats Math.random here. */
export const mulberry32 = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const percentile = (sorted: number[], q: number): number => {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q));
  return sorted[index];
};

const sampledPairwise = <T>(
  items: T[],
  random: () => number,
  sampleCount: number,
  measure: (a: T, b: T) => number,
): number[] => {
  const out: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const a = items[Math.floor(random() * items.length)];
    const b = items[Math.floor(random() * items.length)];
    out.push(measure(a, b));
  }
  return out.sort((x, y) => x - y);
};

/**
 * The challenge's scoring scale, as the 90th percentile of sampled pairwise
 * distances.
 *
 * Deliberately NOT the bounding-box diagonal. That is a min/max statistic: adding
 * five photos from one trip abroad to an otherwise city-sized pool moved the
 * diagonal from 55km to 6,238km, after which a lazy player outscored a good one.
 * A percentile ignores those few pairs and keeps the game sharp.
 */
export const poolScaleKm = (points: LatLon[], random: () => number, sampleCount = DEFAULT_SAMPLE_COUNT): number => {
  if (points.length < 2) {
    return MIN_SCALE;
  }
  const distances = sampledPairwise(points, random, sampleCount, haversineKm);
  return Math.max(MIN_SCALE, percentile(distances, SCALE_PERCENTILE));
};

const MS_PER_DAY = 86_400_000;

/** The date-round equivalent, in days. */
export const poolScaleDays = (dates: Date[], random: () => number, sampleCount = DEFAULT_SAMPLE_COUNT): number => {
  if (dates.length < 2) {
    return 1;
  }
  const offsets = sampledPairwise(
    dates,
    random,
    sampleCount,
    (a, b) => Math.abs(a.getTime() - b.getTime()) / MS_PER_DAY,
  );
  return Math.max(1, Math.round(percentile(offsets, SCALE_PERCENTILE)));
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/utils/game-scoring.spec.ts`

Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/game-scoring.ts server/src/utils/game-scoring.spec.ts
git commit -m "feat(game): derive scoring scale from a robust pool percentile"
```

---

## Task 3: Spread rules and round-set assembly

**Files:**

- Modify: `server/src/utils/game-scoring.ts`
- Test: `server/src/utils/game-scoring.spec.ts`

**Interfaces:**

- Consumes: `LatLon`, `haversineKm`, `poolScaleKm` from Tasks 1–2.
- Produces:
  - `type GameCandidate = { assetId: string; lat: number | null; lon: number | null; takenAt: Date; country: string | null }`
  - `geoCellKey(point: LatLon, cellKm: number): string`
  - `selectLocationRounds(candidates: GameCandidate[], count: number, scaleKm: number, random: () => number): GameCandidate[]`

Relaxation order when constraints cannot be satisfied: country cap → minimum separation → cell uniqueness. Returns fewer than `count` only when the pool genuinely cannot fill it.

- [ ] **Step 1: Write the failing test**

Append to `server/src/utils/game-scoring.spec.ts`:

```ts
import { type GameCandidate, geoCellKey, selectLocationRounds } from 'src/utils/game-scoring';

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
});

describe('selectLocationRounds', () => {
  const spread: GameCandidate[] = [
    candidate('a', 52.5, 13.4, 'Germany'),
    candidate('b', -33.9, 18.4, 'South Africa'),
    candidate('c', 40.7, -74.0, 'United States'),
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
      candidate('us', 40.7, -74.0, 'United States'),
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/utils/game-scoring.spec.ts`

Expected: FAIL — `selectLocationRounds is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Append to `server/src/utils/game-scoring.ts`:

```ts
export type GameCandidate = {
  assetId: string;
  lat: number | null;
  lon: number | null;
  takenAt: Date;
  country: string | null;
};

/** Spread-rule divisors. Both derive from the pool scale rather than being fixed. */
const CELL_DIVISOR = 300;
const SEPARATION_DIVISOR = 75;
const MAX_PER_COUNTRY = 2;

const KM_PER_DEGREE = 111;

export const geoCellKey = (point: LatLon, cellKm: number): string => {
  const size = Math.max(cellKm, 0.05) / KM_PER_DEGREE;
  return `${Math.round(point.lat / size)}:${Math.round(point.lon / size)}`;
};

type Constraints = { enforceCountryCap: boolean; minSeparationKm: number; enforceCellUniqueness: boolean };

const tryFill = (
  candidates: GameCandidate[],
  count: number,
  cellKm: number,
  constraints: Constraints,
  random: () => number,
): GameCandidate[] => {
  const picked: GameCandidate[] = [];
  const usedCells = new Set<string>();
  const usedAssets = new Set<string>();
  const perCountry = new Map<string, number>();

  // Bounded attempts: the pool may be unable to satisfy the constraints at all.
  const maxAttempts = Math.max(1000, candidates.length * 20);
  for (let attempt = 0; attempt < maxAttempts && picked.length < count; attempt++) {
    const next = candidates[Math.floor(random() * candidates.length)];
    if (!next || next.lat === null || next.lon === null || usedAssets.has(next.assetId)) {
      continue;
    }
    const point = { lat: next.lat, lon: next.lon };
    const cell = geoCellKey(point, cellKm);

    if (constraints.enforceCellUniqueness && usedCells.has(cell)) {
      continue;
    }
    if (constraints.minSeparationKm > 0) {
      const tooClose = picked.some(
        (p) => haversineKm({ lat: p.lat!, lon: p.lon! }, point) < constraints.minSeparationKm,
      );
      if (tooClose) {
        continue;
      }
    }
    if (constraints.enforceCountryCap) {
      const country = next.country ?? '(unknown)';
      if ((perCountry.get(country) ?? 0) >= MAX_PER_COUNTRY) {
        continue;
      }
      perCountry.set(country, (perCountry.get(country) ?? 0) + 1);
    }

    usedCells.add(cell);
    usedAssets.add(next.assetId);
    picked.push(next);
  }

  return picked;
};

/**
 * Pick location rounds under spread rules derived from the pool scale.
 *
 * Measurement showed naive sampling already produces decent country variety, but
 * routinely puts two answers under 50km apart, which reads as a bug. Minimum
 * separation is the rule that earns its keep; the country cap stops a
 * home-country-heavy library from rewarding a player who always pins home.
 *
 * When a pool is too clustered to satisfy everything, constraints relax in a fixed
 * order rather than the generator failing: country cap, then minimum separation,
 * then cell uniqueness.
 */
export const selectLocationRounds = (
  candidates: GameCandidate[],
  count: number,
  scaleKm: number,
  random: () => number,
): GameCandidate[] => {
  const usable = candidates.filter((c) => c.lat !== null && c.lon !== null);
  if (usable.length === 0 || count <= 0) {
    return [];
  }

  const cellKm = Math.max(scaleKm / CELL_DIVISOR, 0.05);
  const separation = Math.max(scaleKm / SEPARATION_DIVISOR, 0.05);

  const ladder: Constraints[] = [
    { enforceCountryCap: true, minSeparationKm: separation, enforceCellUniqueness: true },
    { enforceCountryCap: false, minSeparationKm: separation, enforceCellUniqueness: true },
    { enforceCountryCap: false, minSeparationKm: 0, enforceCellUniqueness: true },
    { enforceCountryCap: false, minSeparationKm: 0, enforceCellUniqueness: false },
  ];

  let best: GameCandidate[] = [];
  for (const constraints of ladder) {
    const picked = tryFill(usable, count, cellKm, constraints, random);
    if (picked.length > best.length) {
      best = picked;
    }
    if (best.length === count) {
      break;
    }
  }
  return best;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/utils/game-scoring.spec.ts`

Expected: PASS, 22 tests.

Note: the "never picks two answers closer than the minimum separation" test asserts on a pool that comfortably satisfies the constraint, so no relaxation occurs. The relaxation test deliberately uses a pool that cannot.

- [ ] **Step 5: Run the whole util suite and lint**

Run:

```bash
cd server && pnpm vitest --config test/vitest.config.mjs run src/utils/game-scoring.spec.ts
cd server && pnpm exec eslint src/utils/game-scoring.ts --max-warnings 0
cd server && pnpm exec prettier --check src/utils/game-scoring.ts src/utils/game-scoring.spec.ts
```

Expected: tests PASS, eslint clean, prettier clean.

- [ ] **Step 6: Commit**

```bash
git add server/src/utils/game-scoring.ts server/src/utils/game-scoring.spec.ts
git commit -m "feat(game): add spread rules with ordered constraint relaxation"
```

---

## Task 4: Extract the shared-space role helper

**Files:**

- Create: `server/src/utils/shared-space-role.ts`
- Modify: `server/src/services/shared-space.service.ts:79-85`

**Interfaces:**

- Consumes: `SharedSpaceRole` from `src/enum`.
- Produces:
  - `SHARED_SPACE_ROLE_HIERARCHY: Record<SharedSpaceRole, number>`
  - `getSharedSpaceRoleScore(role: string): number`
  - `hasSharedSpaceRole(role: string, minimum: SharedSpaceRole): boolean`

**Why:** `requireRole` is private on `SharedSpaceService`, and its `ROLE_HIERARCHY` is a module-local const. `GameService` needs the same gate. Extracting the constant is the smallest change that avoids a second, drifting copy of the role ordering. `shared-space.service.ts` is fork-owned, so this does not widen the upstream rebase surface.

- [ ] **Step 1: Read the current definition**

Run: `cd server && sed -n '75,90p' src/services/shared-space.service.ts`

Confirm `ROLE_HIERARCHY` and `getSharedSpaceRoleScore` are defined there, and note their exact values before moving them.

- [ ] **Step 2: Create the shared helper**

Create `server/src/utils/shared-space-role.ts`:

```ts
import { SharedSpaceRole } from 'src/enum';

/**
 * Ordering of shared-space roles. Extracted from shared-space.service.ts so that
 * other fork services (the guessing game) can gate on role without duplicating -
 * and drifting from - the ordering.
 */
export const SHARED_SPACE_ROLE_HIERARCHY: Record<SharedSpaceRole, number> = {
  [SharedSpaceRole.Viewer]: 0,
  [SharedSpaceRole.Editor]: 1,
  [SharedSpaceRole.Owner]: 2,
};

export const getSharedSpaceRoleScore = (role: string): number =>
  SHARED_SPACE_ROLE_HIERARCHY[role as SharedSpaceRole] ?? 0;

export const hasSharedSpaceRole = (role: string, minimum: SharedSpaceRole): boolean =>
  getSharedSpaceRoleScore(role) >= SHARED_SPACE_ROLE_HIERARCHY[minimum];
```

**Verify the numeric values against Step 1** before continuing. If the existing hierarchy differs, copy the existing values — do not change behaviour in this task.

- [ ] **Step 3: Point the existing service at the helper**

In `server/src/services/shared-space.service.ts`, delete the local `ROLE_HIERARCHY` and `getSharedSpaceRoleScore` definitions and import them instead:

```ts
import { getSharedSpaceRoleScore, SHARED_SPACE_ROLE_HIERARCHY as ROLE_HIERARCHY } from 'src/utils/shared-space-role';
```

Aliasing on import keeps every existing `ROLE_HIERARCHY[...]` reference in that file working unchanged, so this task is a pure move with no call-site edits.

- [ ] **Step 4: Run the shared-space suite to prove nothing changed**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/services/shared-space.service.spec.ts`

Expected: PASS, 574 tests — the same count as before the change. A different count means the move altered behaviour.

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/shared-space-role.ts server/src/services/shared-space.service.ts
git commit -m "refactor(spaces): extract the role hierarchy for reuse"
```

---

## Task 5: Schema — tables and migration

**Files:**

- Create: `server/src/schema/tables/game-challenge.table.ts`
- Create: `server/src/schema/tables/game-round.table.ts`
- Create: `server/src/schema/tables/game-guess.table.ts`
- Create: `server/src/schema/migrations-gallery/1791000000000-AddPhotoGuessingGame.ts`
- Modify: `server/src/schema/index.ts`

**Interfaces:**

- Produces: `GameChallengeTable`, `GameRoundTable`, `GameGuessTable`, and the DB interface keys `game_challenge`, `game_round`, `game_guess`.

- [ ] **Step 1: Create the challenge table**

Create `server/src/schema/tables/game-challenge.table.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column, UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { SharedSpaceTable } from 'src/schema/tables/shared-space.table';
import { UserTable } from 'src/schema/tables/user.table';

// One playable challenge: a frozen set of rounds drawn from a single shared space.
//
// scaleKm / scaleDays are FROZEN at generation. Scoring divides by them, so
// recomputing later - as the space gains photos - would silently rewrite the
// meaning of every score already recorded against this challenge.
@Table('game_challenge')
@UpdatedAtTrigger('game_challenge_updatedAt')
export class GameChallengeTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @ForeignKeyColumn(() => SharedSpaceTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', index: true })
  spaceId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  createdById!: string;

  @Column()
  name!: string;

  @Column({ type: 'integer' })
  roundCount!: number;

  @Column({ type: 'double precision' })
  scaleKm!: number;

  @Column({ type: 'integer' })
  scaleDays!: number;

  @Column({ type: 'timestamp with time zone', nullable: true })
  closedAt!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
```

- [ ] **Step 2: Create the round table**

Create `server/src/schema/tables/game-round.table.ts`:

```ts
import { Column, ForeignKeyColumn, Generated, Table, Timestamp, Unique } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';
import { AssetTable } from 'src/schema/tables/asset.table';
import { GameChallengeTable } from 'src/schema/tables/game-challenge.table';

export type GameRoundType = 'location' | 'date';

// One question. The answer is DENORMALISED here rather than joined from asset_exif
// on read: if the asset is deleted or its EXIF edited mid-challenge, every score
// already submitted must remain stable and comparable. assetId is therefore
// nullable with ON DELETE SET NULL - the round survives its photo.
@Table('game_round')
@Unique({ name: 'game_round_challenge_index_uq', columns: ['challengeId', 'index'] })
export class GameRoundTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @ForeignKeyColumn(() => GameChallengeTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', index: true })
  challengeId!: string;

  @Column({ type: 'integer' })
  index!: number;

  @Column()
  type!: GameRoundType;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  assetId!: string | null;

  @Column({ type: 'double precision', nullable: true })
  answerLat!: number | null;

  @Column({ type: 'double precision', nullable: true })
  answerLon!: number | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  answerDate!: Timestamp | null;
}
```

- [ ] **Step 3: Create the guess table**

Create `server/src/schema/tables/game-guess.table.ts`:

```ts
import { Column, CreateDateColumn, ForeignKeyColumn, Generated, Table, Timestamp, Unique } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';
import { GameRoundTable } from 'src/schema/tables/game-round.table';
import { UserTable } from 'src/schema/tables/user.table';

// One player's answer to one round. Final: the unique constraint is what makes
// "you get one guess" a database guarantee rather than a service convention.
// `score` is written once at submission and never recomputed.
@Table('game_guess')
@Unique({ name: 'game_guess_round_user_uq', columns: ['roundId', 'userId'] })
export class GameGuessTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @ForeignKeyColumn(() => GameRoundTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', index: true })
  roundId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', index: true })
  userId!: string;

  @Column({ type: 'double precision', nullable: true })
  guessLat!: number | null;

  @Column({ type: 'double precision', nullable: true })
  guessLon!: number | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  guessDate!: Timestamp | null;

  @Column({ type: 'double precision', nullable: true })
  distanceKm!: number | null;

  @Column({ type: 'integer', nullable: true })
  offsetDays!: number | null;

  @Column({ type: 'integer' })
  score!: number;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
```

- [ ] **Step 4: Register the tables**

In `server/src/schema/index.ts`, make three edits, following how `FacePersonVerdictTable` is registered:

1. Add imports next to the other table imports:

```ts
import { GameChallengeTable } from 'src/schema/tables/game-challenge.table';
import { GameGuessTable } from 'src/schema/tables/game-guess.table';
import { GameRoundTable } from 'src/schema/tables/game-round.table';
```

2. Add all three to the `tables = [ ... ]` array. **Order matters** — `GameChallengeTable` must appear before `GameRoundTable`, which must appear before `GameGuessTable`, because each references the previous.

3. Add to the DB interface map alongside `face_person_verdict`:

```ts
game_challenge: GameChallengeTable;
game_guess: GameGuessTable;
game_round: GameRoundTable;
```

- [ ] **Step 5: Write the migration**

Create `server/src/schema/migrations-gallery/1791000000000-AddPhotoGuessingGame.ts`:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "game_challenge" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "spaceId" uuid NOT NULL,
      "createdById" uuid NOT NULL,
      "name" character varying NOT NULL,
      "roundCount" integer NOT NULL,
      "scaleKm" double precision NOT NULL,
      "scaleDays" integer NOT NULL,
      "closedAt" timestamp with time zone,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      CONSTRAINT "game_challenge_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "game_challenge_spaceId_fkey" FOREIGN KEY ("spaceId")
        REFERENCES "shared_space" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "game_challenge_createdById_fkey" FOREIGN KEY ("createdById")
        REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE
    )`.execute(db);
  await sql`CREATE INDEX "game_challenge_spaceId_idx" ON "game_challenge" ("spaceId")`.execute(db);
  await sql`CREATE INDEX "game_challenge_updateId_idx" ON "game_challenge" ("updateId")`.execute(db);
  await sql`
    CREATE TRIGGER "game_challenge_updatedAt"
    BEFORE UPDATE ON "game_challenge"
    FOR EACH ROW EXECUTE FUNCTION updated_at()`.execute(db);

  await sql`
    CREATE TABLE "game_round" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "challengeId" uuid NOT NULL,
      "index" integer NOT NULL,
      "type" character varying NOT NULL,
      "assetId" uuid,
      "answerLat" double precision,
      "answerLon" double precision,
      "answerDate" timestamp with time zone,
      CONSTRAINT "game_round_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "game_round_challenge_index_uq" UNIQUE ("challengeId", "index"),
      CONSTRAINT "game_round_challengeId_fkey" FOREIGN KEY ("challengeId")
        REFERENCES "game_challenge" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "game_round_assetId_fkey" FOREIGN KEY ("assetId")
        REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE SET NULL
    )`.execute(db);
  await sql`CREATE INDEX "game_round_challengeId_idx" ON "game_round" ("challengeId")`.execute(db);

  await sql`
    CREATE TABLE "game_guess" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "roundId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "guessLat" double precision,
      "guessLon" double precision,
      "guessDate" timestamp with time zone,
      "distanceKm" double precision,
      "offsetDays" integer,
      "score" integer NOT NULL,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "game_guess_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "game_guess_round_user_uq" UNIQUE ("roundId", "userId"),
      CONSTRAINT "game_guess_roundId_fkey" FOREIGN KEY ("roundId")
        REFERENCES "game_round" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "game_guess_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE
    )`.execute(db);
  await sql`CREATE INDEX "game_guess_roundId_idx" ON "game_guess" ("roundId")`.execute(db);
  await sql`CREATE INDEX "game_guess_userId_idx" ON "game_guess" ("userId")`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "game_guess"`.execute(db);
  await sql`DROP TABLE IF EXISTS "game_round"`.execute(db);
  await sql`DROP TABLE IF EXISTS "game_challenge"`.execute(db);
}
```

**Before running anything:** confirm the helper names `immich_uuid_v7()` and `updated_at()` by grepping an existing fork migration that creates a table — `rg -n "immich_uuid_v7|updated_at\(\)" server/src/schema/migrations-gallery/ | head`. If this codebase uses different names, use those.

- [ ] **Step 6: Verify the schema declaration matches the migration**

Run: `cd server && pnpm exec tsc --noEmit`

Expected: no errors.

Then, with Docker running, verify the declared schema and the migration agree:

Run: `cd server && pnpm migrations:generate GameDrift`

Expected: the generated migration is **empty** (no drift). If it contains statements, the table decorators and the hand-written SQL disagree — reconcile them, then delete the generated file. **Do not commit the generated file.**

- [ ] **Step 7: Commit**

```bash
git add server/src/schema/
git commit -m "feat(game): add challenge, round and guess tables"
```

---

## Task 6: Repository

**Files:**

- Create: `server/src/repositories/game.repository.ts`
- Modify: `server/src/repositories/index.ts`
- Modify: `server/src/services/base.service.ts`
- Modify: `server/test/utils.ts`

**Interfaces:**

- Consumes: `GameCandidate` from Task 3; the tables from Task 5.
- Produces `GameRepository` with:
  - `getLocationCandidates(spaceId: string, limit: number): Promise<GameCandidate[]>`
  - `getDateCandidates(spaceId: string, limit: number): Promise<GameCandidate[]>`
  - `getRecentlyUsedAssetIds(spaceId: string, challengeLimit: number): Promise<string[]>`
  - `createChallenge(challenge: Insertable<GameChallengeTable>, rounds: Insertable<GameRoundTable>[]): Promise<string>`
  - `getChallenge(id: string): Promise<GameChallengeRow | undefined>`
  - `getChallengesForSpace(spaceId: string): Promise<GameChallengeRow[]>`
  - `getRounds(challengeId: string): Promise<GameRoundRow[]>`
  - `getRound(challengeId: string, index: number): Promise<GameRoundRow | undefined>`
  - `getGuessesForUser(challengeId: string, userId: string): Promise<GameGuessRow[]>`
  - `createGuess(guess: Insertable<GameGuessTable>): Promise<GameGuessRow>`
  - `getLeaderboard(challengeId: string): Promise<{ userId: string; total: number; answered: number }[]>`
  - `deleteChallenge(id: string): Promise<void>`

**⚠️ Registration trap — this is the part that breaks silently.** Adding a repository touches **four** files, and two of them contain _positional_ lists. A repository added to the constructor but missed in a positional list produces a runtime failure in a completely unrelated service, not a compile error.

- [ ] **Step 1: Write the failing test**

Create `server/src/repositories/game.repository.spec.ts`:

```ts
import { GameRepository } from 'src/repositories/game.repository';

describe('GameRepository', () => {
  it('is constructible and exposes the query surface the service depends on', () => {
    // A cheap guard on the registration trap: if the repository is not exported
    // and importable under its expected name, every downstream task fails in a
    // confusing place instead of here.
    expect(typeof GameRepository).toBe('function');
    for (const method of [
      'getLocationCandidates',
      'getDateCandidates',
      'getRecentlyUsedAssetIds',
      'createChallenge',
      'getChallenge',
      'getChallengesForSpace',
      'getRounds',
      'getRound',
      'getGuessesForUser',
      'createGuess',
      'getLeaderboard',
      'deleteChallenge',
    ]) {
      expect(typeof GameRepository.prototype[method as keyof GameRepository]).toBe('function');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/repositories/game.repository.spec.ts`

Expected: FAIL — cannot resolve `src/repositories/game.repository`.

- [ ] **Step 3: Write the repository**

Create `server/src/repositories/game.repository.ts`. Model the class shell on `server/src/repositories/face-person-verdict.repository.ts` — read it first for the exact `@Injectable()` / `@InjectKysely()` idiom and the `@GenerateSqlQueries` decorator usage.

The candidate query is the only non-obvious one:

```ts
/**
 * Location-round candidates for a space.
 *
 * Two gates, and they are complementary - measurement showed each catches what the
 * other misses:
 *   - face area <= 5% of the frame, so portraits (where the place is background
 *     behind a face) are excluded;
 *   - ranked by CLIP similarity to "a picture of a place", because a face-free
 *     indoor kitchen passes the face gate and carries no location signal.
 *
 * The CLIP term costs nothing extra: smart_search.embedding is already the
 * 512-dim ViT-B-32 image vector with a cosine index, so this is one dot product
 * against a constant prompt vector.
 *
 * Ranked, never thresholded: the measured cosine margin between positive and
 * negative prompts is thin (~0.24 vs ~0.22), so an absolute cutoff would pass
 * everything in one library and nothing in another.
 */
```

Write it as a Kysely query that:

1. joins `shared_space_asset` → `asset` → `asset_exif` for `spaceId`;
2. filters `asset.deletedAt IS NULL`, `asset.type = 'IMAGE'`, `asset.visibility = 'timeline'`;
3. filters `asset_exif.latitude IS NOT NULL AND asset_exif.longitude IS NOT NULL`;
4. left-joins a per-asset face-area aggregate from `asset_face` (`SUM((boundingBoxX2-boundingBoxX1)*(boundingBoxY2-boundingBoxY1)) / (imageWidth*imageHeight)` where `deletedAt IS NULL AND isVisible`), keeping rows where the aggregate is `NULL` or `<= 0.05`;
5. left-joins `smart_search` and orders by cosine distance to the prompt constant ascending;
6. limits to `limit`.

`getDateCandidates` is the same minus steps 3–5, requiring only a non-null `asset.localDateTime`, ordered randomly.

Add the prompt constant to the same file:

```ts
/**
 * CLIP text embedding for "an outdoor photo that shows where it was taken",
 * encoded once with ViT-B-32__openai - the model Gallery's smart search uses.
 *
 * Regenerate with machine-learning/, do not hand-edit:
 *   uv run python -c "from immich_ml.models.clip.textual import OpenClipTextualEncoder; \
 *     m = OpenClipTextualEncoder('ViT-B-32__openai'); m.load(); \
 *     print(m.predict('an outdoor photo that shows where it was taken'))"
 */
export const PLACE_PROMPT_EMBEDDING: number[] = [/* 512 floats - generate with the command above and paste here */];
```

**This constant must be generated, not invented.** Run the command, paste the real 512 floats. A plausible-looking made-up vector would rank candidates randomly and the failure would be invisible.

- [ ] **Step 4: Register the repository in all four places**

1. `server/src/repositories/index.ts` — add the import and add `GameRepository` to the exported repositories array.
2. `server/src/services/base.service.ts` — add `protected gameRepository: GameRepository,` to the constructor, **and** add `gameRepository` to the object literal near line 256, **and** add `ctx.gameRepository` to the positional list near line 285. The positional list must match the constructor order exactly.
3. `server/test/utils.ts` — add `game: GameRepository;` to the repositories type, `game: automock(GameRepository, { strict: false }),` to the mocks object, and `overrides.game || (mocks.game as As<GameRepository>),` to the positional list — **at the same position as in the BaseService constructor**.

- [ ] **Step 5: Run the full server suite**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run`

Expected: `Test Files 169 passed | 1 skipped (170)`, ~5,765+ tests passing.

**If some unrelated service spec now fails with "Unable to create repository instance" or an argument-count error, the positional lists are out of sync.** That is the trap this step exists to catch — fix the ordering, do not modify the failing spec.

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/ server/src/services/base.service.ts server/test/utils.ts
git commit -m "feat(game): add the game repository and register it"
```

---

## Task 7: Challenge generation

**Files:**

- Create: `server/src/services/game.service.ts`
- Create: `server/src/services/game.service.spec.ts`
- Modify: `server/src/services/index.ts`

**Interfaces:**

- Consumes: `GameRepository` (Task 6), `game-scoring` utils (Tasks 1–3), `hasSharedSpaceRole` (Task 4).
- Produces: `GameService.create(auth: AuthDto, spaceId: string, dto: GameCreateDto): Promise<GameChallengeResponseDto>`

**Round type mix:** location rounds are preferred up to 60% of `roundCount`; every remaining round is a date round. When location candidates fall short, date rounds take the slack — this is what keeps a GPS-poor space playable.

- [ ] **Step 1: Write the failing test**

Create `server/src/services/game.service.spec.ts`. Model the harness on an existing service spec — read the top of `server/src/services/shared-space.service.spec.ts` for the `newTestService` idiom first.

```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SharedSpaceRole } from 'src/enum';
import { GameService } from 'src/services/game.service';
import { newTestService, ServiceMocks } from 'test/utils';

describe(GameService.name, () => {
  let sut: GameService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(GameService));
  });

  const authStub = { user: { id: 'user-1' } } as any;

  const locationCandidate = (id: string, lat: number, lon: number, country: string) => ({
    assetId: id,
    lat,
    lon,
    takenAt: new Date(2021, 5, 1),
    country,
  });

  it('rejects a caller who is not a member of the space', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(void 0);
    await expect(sut.create(authStub, 'space-1', { roundCount: 5 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a viewer, because creating a challenge requires the editor role', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
    await expect(sut.create(authStub, 'space-1', { roundCount: 5 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when the space has no usable photos at all', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Editor } as any);
    mocks.game.getLocationCandidates.mockResolvedValue([]);
    mocks.game.getDateCandidates.mockResolvedValue([]);
    mocks.game.getRecentlyUsedAssetIds.mockResolvedValue([]);
    await expect(sut.create(authStub, 'space-1', { roundCount: 5 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('freezes the pool scale onto the challenge', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Editor } as any);
    mocks.game.getLocationCandidates.mockResolvedValue([
      locationCandidate('a', 52.5, 13.4, 'Germany'),
      locationCandidate('b', -33.9, 18.4, 'South Africa'),
      locationCandidate('c', 40.7, -74, 'United States'),
      locationCandidate('d', 47.9, 106.9, 'Mongolia'),
    ]);
    mocks.game.getDateCandidates.mockResolvedValue([locationCandidate('e', 41.9, 12.5, 'Italy')]);
    mocks.game.getRecentlyUsedAssetIds.mockResolvedValue([]);
    mocks.game.createChallenge.mockResolvedValue('challenge-1');

    await sut.create(authStub, 'space-1', { roundCount: 5 });

    const [challenge] = mocks.game.createChallenge.mock.calls[0];
    expect(challenge.scaleKm).toBeGreaterThan(0);
    expect(challenge.scaleDays).toBeGreaterThanOrEqual(1);
  });

  // A GPS-poor space must still produce a playable challenge.
  it('fills the whole set with date rounds when there are no location candidates', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Editor } as any);
    mocks.game.getLocationCandidates.mockResolvedValue([]);
    mocks.game.getDateCandidates.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        assetId: `d${i}`,
        lat: null,
        lon: null,
        takenAt: new Date(2015 + i, 0, 1),
        country: null,
      })),
    );
    mocks.game.getRecentlyUsedAssetIds.mockResolvedValue([]);
    mocks.game.createChallenge.mockResolvedValue('challenge-2');

    await sut.create(authStub, 'space-1', { roundCount: 5 });

    const [, rounds] = mocks.game.createChallenge.mock.calls[0];
    expect(rounds).toHaveLength(5);
    expect(rounds.every((r: any) => r.type === 'date')).toBe(true);
  });

  it('never repeats an asset within a challenge', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Editor } as any);
    mocks.game.getLocationCandidates.mockResolvedValue([
      locationCandidate('a', 52.5, 13.4, 'Germany'),
      locationCandidate('b', -33.9, 18.4, 'South Africa'),
    ]);
    mocks.game.getDateCandidates.mockResolvedValue([
      locationCandidate('a', 52.5, 13.4, 'Germany'),
      locationCandidate('z', 10, 10, 'Kenya'),
    ]);
    mocks.game.getRecentlyUsedAssetIds.mockResolvedValue([]);
    mocks.game.createChallenge.mockResolvedValue('challenge-3');

    await sut.create(authStub, 'space-1', { roundCount: 4 });

    const [, rounds] = mocks.game.createChallenge.mock.calls[0];
    const ids = rounds.map((r: any) => r.assetId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/services/game.service.spec.ts`

Expected: FAIL — cannot resolve `src/services/game.service`.

- [ ] **Step 3: Implement the service**

Create `server/src/services/game.service.ts` extending `BaseService`. It must:

1. `requireRole` privately, via `this.sharedSpaceRepository.getMember(spaceId, auth.user.id)` plus `hasSharedSpaceRole(member.role, SharedSpaceRole.Editor)`, throwing `ForbiddenException('Not a member of this space')` when there is no member and `ForbiddenException('Insufficient role')` when the role is too low.
2. Fetch location candidates, date candidates, and recently-used asset IDs; drop recently-used assets from both candidate lists **unless** doing so would leave too few to fill the challenge.
3. Compute `scaleKm = poolScaleKm(...)` and `scaleDays = poolScaleDays(...)` from the candidate pools, using a seeded `mulberry32`. Derive the seed from something stable and non-random — e.g. a hash of `spaceId` plus the current challenge count — so generation is reproducible; `Math.random` is forbidden here.
4. Pick `Math.min(Math.floor(roundCount * 0.6), locationCandidates.length)` location rounds via `selectLocationRounds`.
5. Fill the remainder with date rounds, excluding any asset already picked.
6. Throw `BadRequestException` when zero rounds can be built, with a message naming the reason.
7. Persist via `createChallenge`, storing `answerLat`/`answerLon` for location rounds and `answerDate` for date rounds, `roundCount` as the **actual** number of rounds built.

Register `GameService` in `server/src/services/index.ts` (import plus the array entry), following how `SharedSpaceService` is registered.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/services/game.service.spec.ts`

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/game.service.ts server/src/services/game.service.spec.ts server/src/services/index.ts
git commit -m "feat(game): generate challenges from a space's photos"
```

---

## Task 8: Guessing, scoring and the leaderboard

**Files:**

- Modify: `server/src/services/game.service.ts`
- Modify: `server/src/services/game.service.spec.ts`

**Interfaces:**

- Consumes: everything from Task 7.
- Produces:
  - `GameService.get(auth: AuthDto, challengeId: string): Promise<GameChallengeDetailResponseDto>`
  - `GameService.guess(auth: AuthDto, challengeId: string, index: number, dto: GameGuessDto): Promise<GameGuessResponseDto>`
  - `GameService.leaderboard(auth: AuthDto, challengeId: string): Promise<GameLeaderboardResponseDto>`
  - `GameService.delete(auth: AuthDto, challengeId: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Append to `server/src/services/game.service.spec.ts`:

```ts
describe('guess', () => {
  const challengeStub = {
    id: 'challenge-1',
    spaceId: 'space-1',
    scaleKm: 15_000,
    scaleDays: 3000,
    roundCount: 5,
  } as any;

  beforeEach(() => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
    mocks.game.getChallenge.mockResolvedValue(challengeStub);
  });

  it('scores a location guess from the distance to the frozen answer', async () => {
    mocks.game.getRound.mockResolvedValue({
      id: 'round-1',
      challengeId: 'challenge-1',
      index: 0,
      type: 'location',
      answerLat: 52.5,
      answerLon: 13.4,
      answerDate: null,
    } as any);
    mocks.game.createGuess.mockImplementation(async (guess: any) => guess);

    const result = await sut.guess(authStub, 'challenge-1', 0, { lat: 52.5, lon: 13.4 });

    expect(result.score).toBe(5000);
    expect(result.distanceKm).toBeCloseTo(0, 5);
  });

  it('scores a date guess from the day offset', async () => {
    mocks.game.getRound.mockResolvedValue({
      id: 'round-2',
      challengeId: 'challenge-1',
      index: 1,
      type: 'date',
      answerLat: null,
      answerLon: null,
      answerDate: new Date(2020, 6, 1),
    } as any);
    mocks.game.createGuess.mockImplementation(async (guess: any) => guess);

    const result = await sut.guess(authStub, 'challenge-1', 1, { date: new Date(2020, 6, 1).toISOString() });

    expect(result.score).toBe(5000);
    expect(result.offsetDays).toBe(0);
  });

  it('rejects a second guess on the same round', async () => {
    mocks.game.getRound.mockResolvedValue({
      id: 'round-1',
      challengeId: 'challenge-1',
      index: 0,
      type: 'location',
      answerLat: 52.5,
      answerLon: 13.4,
      answerDate: null,
    } as any);
    mocks.game.createGuess.mockRejectedValue(
      Object.assign(new Error('duplicate key'), { constraint: 'game_guess_round_user_uq' }),
    );

    await expect(sut.guess(authStub, 'challenge-1', 0, { lat: 1, lon: 1 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a location guess with no coordinates', async () => {
    mocks.game.getRound.mockResolvedValue({ id: 'r', type: 'location', challengeId: 'challenge-1' } as any);
    await expect(sut.guess(authStub, 'challenge-1', 0, {} as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('get', () => {
  it('withholds the answer for a round the caller has not guessed', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
    mocks.game.getChallenge.mockResolvedValue({ id: 'challenge-1', spaceId: 'space-1', roundCount: 2 } as any);
    mocks.game.getRounds.mockResolvedValue([
      { id: 'r0', index: 0, type: 'location', answerLat: 52.5, answerLon: 13.4, answerDate: null, assetId: 'asset-1' },
      {
        id: 'r1',
        index: 1,
        type: 'date',
        answerLat: null,
        answerLon: null,
        answerDate: new Date(),
        assetId: 'asset-2',
      },
    ] as any);
    mocks.game.getGuessesForUser.mockResolvedValue([{ roundId: 'r0', score: 4000 }] as any);

    const result = await sut.get(authStub, 'challenge-1');

    // Guessed: answer present. Unguessed: answer absent - and no asset id, which
    // would otherwise resolve straight back to /api/assets/:id.
    expect(result.rounds[0].answer).toBeDefined();
    expect(result.rounds[1].answer).toBeUndefined();
    expect(JSON.stringify(result.rounds[1])).not.toContain('asset-2');
  });
});
```

Add `ConflictException` to the `@nestjs/common` import at the top of the spec.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/services/game.service.spec.ts`

Expected: FAIL — `sut.guess is not a function`.

- [ ] **Step 3: Implement**

Add to `GameService`:

- `guess` — require membership (any role); load the challenge and round; validate the payload shape matches the round type (`BadRequestException` otherwise); compute `distanceKm` via `haversineKm` or `offsetDays` from the frozen answer; compute `score` via `scoreFromError` using the challenge's frozen `scaleKm`/`scaleDays`; persist; map the unique-violation on `game_guess_round_user_uq` to `ConflictException('Already guessed')`.
- `get` — require membership; load rounds and the caller's guesses; return a round DTO that includes `answer`, `score` and `assetId` **only** for rounds the caller has already guessed. For unguessed rounds emit only `index` and `type`.
- `leaderboard` — require membership; return `getLeaderboard` rows joined to display names.
- `delete` — require the editor role, then `deleteChallenge`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/services/game.service.spec.ts`

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/game.service.ts server/src/services/game.service.spec.ts
git commit -m "feat(game): score guesses and expose the leaderboard"
```

---

## Task 9: DTOs and controller

**Files:**

- Create: `server/src/dtos/game.dto.ts`
- Create: `server/src/controllers/game.controller.ts`
- Modify: `server/src/controllers/index.ts`

**Interfaces:**

- Consumes: `GameService` methods from Tasks 7–8.
- Produces the HTTP surface in §4.3 of the spec.

**Permissions:** reuse `Permission.SharedSpaceRead` for read/play endpoints and `Permission.SharedSpaceUpdate` for create/delete rather than minting new `Permission` values. New values would need cases in the exhaustive switch in `server/src/utils/access.ts` and entries in the API-key permission picker, for no behavioural gain — the space-level gate that actually matters is the editor check inside the service.

- [ ] **Step 1: Write the DTOs**

Create `server/src/dtos/game.dto.ts` with `GameCreateDto` (`roundCount`, validated `@IsInt() @Min(1) @Max(20)`, default 5), `GameGuessDto` (optional `lat`/`lon` as numbers, optional `date` as ISO string), and the response DTOs. The unguessed-round DTO must not carry `assetId`, coordinates, a date, or a filename.

- [ ] **Step 2: Write the controller**

Create `server/src/controllers/game.controller.ts`, modelled on `server/src/controllers/shared-space.controller.ts` — read its first 120 lines for the exact `@Authenticated` / `@Endpoint` / `@Auth()` idiom, then implement the seven routes from the spec. Register it in `server/src/controllers/index.ts`.

- [ ] **Step 3: Verify types and lint**

Run:

```bash
cd server && pnpm exec tsc --noEmit
cd server && pnpm exec eslint src/dtos/game.dto.ts src/controllers/game.controller.ts --max-warnings 0
```

Expected: both clean.

- [ ] **Step 4: Run the full server suite**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run`

Expected: all files pass. Confirm the `Test Files` line, not the exit code.

- [ ] **Step 5: Commit**

```bash
git add server/src/dtos/game.dto.ts server/src/controllers/
git commit -m "feat(game): expose the game HTTP API"
```

---

## Task 10: Leak-proof round image endpoint

**Files:**

- Modify: `server/src/services/game.service.ts`
- Modify: `server/src/controllers/game.controller.ts`
- Modify: `server/src/services/game.service.spec.ts`

**Interfaces:**

- Produces: `GameService.getRoundImage(auth: AuthDto, challengeId: string, index: number): Promise<ImmichFileResponse>`

A round is worthless if the answer is one request away. This endpoint is the only way a round photo reaches a client.

- [ ] **Step 1: Write the failing test**

Append to `server/src/services/game.service.spec.ts`:

```ts
describe('getRoundImage', () => {
  it('serves a thumbnail that is not the original file', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
    mocks.game.getChallenge.mockResolvedValue({ id: 'challenge-1', spaceId: 'space-1' } as any);
    mocks.game.getRound.mockResolvedValue({ id: 'r0', index: 0, type: 'location', assetId: 'asset-1' } as any);
    mocks.asset.getById.mockResolvedValue({
      id: 'asset-1',
      originalPath: '/originals/secret-name.jpg',
      files: [{ type: 'preview', path: '/thumbs/asset-1_preview.jpeg' }],
    } as any);

    const result = await sut.getRoundImage(authStub, 'challenge-1', 0);

    // The preview is already re-encoded and EXIF-free; the original never is.
    expect(result.path).toBe('/thumbs/asset-1_preview.jpeg');
    expect(result.path).not.toContain('secret-name');
  });

  it('refuses a round belonging to a different challenge', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
    mocks.game.getChallenge.mockResolvedValue({ id: 'challenge-1', spaceId: 'space-1' } as any);
    mocks.game.getRound.mockResolvedValue(void 0);

    await expect(sut.getRoundImage(authStub, 'challenge-1', 99)).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/services/game.service.spec.ts`

Expected: FAIL — `sut.getRoundImage is not a function`.

- [ ] **Step 3: Implement**

Serve the asset's existing **preview** file, which is already a re-encoded derivative with no EXIF — do not re-implement stripping. Look up the round by `(challengeId, index)` so the asset ID never appears in the request. Return an `ImmichFileResponse` with a generic `fileName` (e.g. `round-<index>.jpeg`), never the original filename. Wire it to `GET /games/:id/rounds/:index/image` in the controller.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/services/game.service.spec.ts`

Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/game.service.ts server/src/services/game.service.spec.ts server/src/controllers/game.controller.ts
git commit -m "feat(game): serve round images without leaking the answer"
```

---

## Task 11: OpenAPI and SDK regeneration

**Files:**

- Modify: `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/`, `mobile/openapi/` (all generated)

- [ ] **Step 1: Build the server**

Run: `cd server && pnpm build`

Expected: build succeeds.

- [ ] **Step 2: Regenerate the spec and clients**

Run:

```bash
cd server && pnpm sync:open-api
make open-api
```

- [ ] **Step 3: Verify only game endpoints were added**

Run: `git diff --stat open-api/ mobile/openapi/`

Expected: additions describing the game endpoints. **If unrelated endpoints changed, the working tree was stale** — reset the unrelated hunks rather than committing them.

- [ ] **Step 4: Commit**

```bash
git add open-api/ mobile/openapi/
git commit -m "chore(game): regenerate the API clients"
```

---

## Task 12: End-to-end coverage, including a leakage test

**Files:**

- Create: `e2e/src/api/specs/game.e2e-spec.ts`

- [ ] **Step 1: Write the tests**

Model on an existing spec in `e2e/src/api/specs/` — read one first for the setup idiom (`utils.resetDatabase()`, `utils.setupAdmin()`, asset upload helpers).

Cover:

1. An editor creates a challenge in a space with photos; it comes back with rounds.
2. A viewer can play it but cannot create or delete one (403).
3. A non-member gets 403 on every route.
4. Submitting a guess returns a score between 0 and 5000, and a second guess on the same round returns 409.
5. The leaderboard totals match the sum of that player's round scores.
6. **The leakage test.** Fetch `GET /games/:id` before guessing and assert the serialised body contains no coordinate, no date, no asset ID and no original filename for unguessed rounds:

```ts
const { body } = await request(app).get(`/games/${challengeId}`).set('Authorization', `Bearer ${token}`);
const serialised = JSON.stringify(body.rounds.filter((r: any) => !r.answer));
expect(serialised).not.toContain(assetId);
expect(serialised).not.toContain(originalFileName);
expect(serialised).not.toMatch(/answerLat|answerLon|answerDate|latitude|longitude/);
```

- [ ] **Step 2: Run the E2E suite**

Run: `cd e2e && pnpm test game`

Expected: all pass. Requires the E2E stack; see `make e2e`.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/api/specs/game.e2e-spec.ts
git commit -m "test(game): cover the API end to end, including answer leakage"
```

---

## Task 13: Final gate

- [ ] **Step 1: Full verification**

Run each and confirm clean:

```bash
cd server && pnpm vitest --config test/vitest.config.mjs run   # read the "Test Files" line
cd server && pnpm exec tsc --noEmit
make lint-server
make format-server
```

- [ ] **Step 2: Confirm no upstream files were touched unnecessarily**

Run: `git diff --stat main...HEAD`

Expected: new files under `server/src/{utils,schema,repositories,services,controllers,dtos}/game*`, plus the small registration edits and the generated API clients. Any other upstream file in that list needs justifying.

- [ ] **Step 3: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore(game): formatting"
```

---

## Self-Review Notes

**Spec coverage.** §4.1 schema → Task 5. §4.2 server files → Tasks 6–10. §4.3 endpoints → Tasks 9–10. §5 pool scope → Task 6 candidate query. §6 leakage → Tasks 8, 10, 12. §7.1 gates → Task 6. §7.2 pool scale → Task 2. §7.3 spread → Task 3. §7.4 type mix → Task 7. §8 scoring → Tasks 1, 8. §9 error handling → Tasks 7, 8, 10. §10 testing → every task, plus Task 12. §4.4 web is **deliberately out of scope for this plan** and covered by the companion web plan.

**Known gap requiring a real value:** `PLACE_PROMPT_EMBEDDING` in Task 6 must be generated by running the documented command against the ML service. It is the one value in this plan that cannot be written from the plan alone, and it is called out explicitly rather than left as a silent placeholder.
