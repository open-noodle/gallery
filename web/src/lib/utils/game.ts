/** Points a perfect guess earns. Mirrors MAX_ROUND_SCORE on the server. */
export const MAX_ROUND_SCORE = 5000;

/**
 * Human-readable distance. Precision shrinks as distance grows: metres are
 * meaningful for a near-miss, decimals are noise at continental scale.
 */
export const formatDistanceKm = (km: number): string => {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  if (km < 10) {
    return `${km.toFixed(1)} km`;
  }
  return `${Math.round(km).toLocaleString()} km`;
};

/** Score as a 0-100 bar width, clamped so a bad value cannot overflow the bar. */
export const scorePercent = (score: number): number =>
  Math.max(0, Math.min(100, Math.round((100 * score) / MAX_ROUND_SCORE)));

export const yearFromIso = (iso: string): number => new Date(iso).getUTCFullYear();
