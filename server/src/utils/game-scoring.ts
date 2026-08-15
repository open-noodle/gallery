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
