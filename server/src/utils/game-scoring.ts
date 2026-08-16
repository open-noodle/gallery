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

/** Number of random pairs sampled when estimating a pool's scale. */
const DEFAULT_SAMPLE_COUNT = 4000;

/** Percentile of the pairwise distribution used as the pool scale. */
const SCALE_PERCENTILE = 0.9;

/** Small, fast, seedable PRNG. Deterministic generation beats Math.random here. */
export const mulberry32 = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    // eslint-disable-next-line unicorn/prefer-math-trunc
    state = (state + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    // eslint-disable-next-line unicorn/operator-assignment
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
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

/**
 * The error of a date guess, in days, graded at the granularity the player actually chose.
 *
 * A date round is answered by picking a year and a month, so grading on the exact day made a
 * perfect score unreachable: whatever the player picked, the emitted date still missed the real
 * capture day by up to half a month, and against a single-trip pool's day-gap scale that alone
 * could zero the round. Naming the right month is therefore worth the full score, and a miss is
 * measured from the nearest edge of the month that was picked.
 *
 * Kept in DAYS rather than months so `offsetDays` - the stored column, the response field and the
 * "you were N days off" result line - keeps meaning exactly what it did, and so a one-day miss
 * stays distinguishable from a two-month one instead of both reading as "1 month".
 */
export const monthOffsetDays = (guess: Date, answer: Date): number => {
  const monthStart = Date.UTC(guess.getUTCFullYear(), guess.getUTCMonth(), 1);
  // Day 0 of the following month is the last day of this one, so this handles month lengths and
  // leap Februaries without a table.
  const monthEnd = Date.UTC(guess.getUTCFullYear(), guess.getUTCMonth() + 1, 0);
  // Normalised to a UTC calendar day for the same reason toUtcDayIndex does it: the answer carries
  // a real capture time, and 23:00 on the last day of the month is still inside that month.
  const answerDay = Date.UTC(answer.getUTCFullYear(), answer.getUTCMonth(), answer.getUTCDate());

  if (answerDay < monthStart) {
    return (monthStart - answerDay) / MS_PER_DAY;
  }
  if (answerDay > monthEnd) {
    return (answerDay - monthEnd) / MS_PER_DAY;
  }
  return 0;
};

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

/**
 * Steepness of the rank-biased draw in `tryFill`. Location candidates arrive from
 * `GameRepository.getLocationCandidates` in CLIP scene-gate rank order - best "picture of a
 * place" first - and this is what makes that ranking actually change which photos become
 * rounds.
 *
 * It exists because a uniform draw over the handed-in list made the scene gate INERT: the
 * repository's only remaining effect was the `LIMIT` cutoff, so for any space whose gated pool
 * fits inside that limit (the design doc's own reference space is ~95 photos) portraits entered
 * location rounds at exactly the naive rate. Design §2 calls the scene gate mandatory.
 *
 * `u ** 3` puts the expected pick at the 25th percentile of the ranking: the top fifth of the
 * ranking takes ~58% of draws (uniform: 20%) and the bottom fifth ~7% (uniform: 20%). A BIAS,
 * not a cutoff - design §7.1 requires rank-based selection and explicitly rules out an absolute
 * threshold, and keeping the tail reachable is also what stops a large space from replaying the
 * same handful of top-ranked photos forever.
 */
export const RANK_BIAS_EXPONENT = 3;

/**
 * Index into a rank-ordered candidate list, biased toward the front. `random()` is in [0, 1),
 * so the product can never reach `length`; the clamp is belt-and-braces against a future PRNG
 * that returns 1.
 */
export const rankBiasedIndex = (length: number, random: () => number): number =>
  Math.min(length - 1, Math.floor(random() ** RANK_BIAS_EXPONENT * length));

export const geoCellKey = (point: LatLon, cellKm: number): string => {
  const size = Math.max(cellKm, 0.05);
  const latSize = size / KM_PER_DEGREE;

  // A degree of longitude spans 111km only at the equator; it shrinks with
  // latitude and vanishes at the poles. Without this correction a "50km" cell is
  // ~40% too narrow at 52N and collapses entirely in the arctic. The clamp keeps
  // the divisor away from zero at the pole itself.
  const lonKmPerDegree = Math.max(KM_PER_DEGREE * Math.cos(toRadians(point.lat)), 0.1);
  const lonSize = size / lonKmPerDegree;

  // Wrap the longitude bucket around the globe so points either side of the
  // antimeridian land in the same cell rather than opposite extremes.
  const bucketsAround = Math.max(1, Math.round(360 / lonSize));
  const lonBucket = ((Math.round(point.lon / lonSize) % bucketsAround) + bucketsAround) % bucketsAround;

  return `${Math.round(point.lat / latSize)}:${lonBucket}`;
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
    // Rank-biased, NOT uniform - `candidates` is in CLIP scene-gate order and a uniform draw
    // here is what made that gate inert. See RANK_BIAS_EXPONENT.
    const next = candidates[rankBiasedIndex(candidates.length, random)];
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
 * `candidates` MUST arrive in scene-gate rank order (best "picture of a place" first, as
 * `GameRepository.getLocationCandidates` returns them): the draw is rank-biased, so reordering
 * the input silently downgrades the CLIP gate to noise. See RANK_BIAS_EXPONENT.
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
