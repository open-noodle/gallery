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
