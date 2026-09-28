import { createUrl } from '$lib/utils';

/** Points a perfect guess earns. Mirrors MAX_ROUND_SCORE on the server. */
export const MAX_ROUND_SCORE = 5000;

/**
 * How many past games one page of solo history holds.
 *
 * Lives here rather than in the route's `+page.ts` because SvelteKit rejects any export from a
 * `+page.ts` other than its own reserved ones, and both the loader's first page and the page's
 * "load more" have to ask for the same size or the pages come back different lengths.
 */
export const SOLO_HISTORY_PAGE_SIZE = 10;

/**
 * A round's photo, keyed by challenge + round index only - NEVER by asset id, so the client never
 * learns which asset a round shows until the player has guessed it. Kept in one place because that
 * shape is the security property: every caller must go through this rather than build the URL, or
 * a future one will reach for `/assets/:id` and quietly undo it.
 */
export const roundImageUrl = (challengeId: string, index: number): string =>
  createUrl(`/games/${challengeId}/rounds/${index}/image`);

/**
 * How long until the next daily, as `2h 15m`.
 *
 * Counted to the next UTC midnight, matching the server's `dailyOn` key. Counting to the viewer's
 * LOCAL midnight would promise tomorrow's challenge at the wrong hour for everyone outside UTC -
 * and for anyone east of it, would still be counting down hours after the new daily had appeared.
 */
export const timeUntilNextDaily = (now: Date): string => {
  const nextUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const minutesLeft = Math.max(0, Math.floor((nextUtcMidnight - now.getTime()) / 60_000));
  return `${Math.floor(minutesLeft / 60)}h ${minutesLeft % 60}m`;
};

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

/**
 * Wraps a longitude into the server-accepted [-180, 180] range. maplibre's `lngLat` (from
 * `map.unproject`) is not wrapped — panning across the antimeridian on a world guessing map
 * routinely yields values like 200 or -230 — but the server's longitudeSchema is
 * `z.number().min(-180).max(180)` and 400s on anything outside it.
 */
export const wrapLongitude = (lng: number): number => ((((lng + 180) % 360) + 360) % 360) - 180;

/**
 * Competition ranks - `1, 2, 2, 4` - for a board already sorted best-first.
 *
 * Rank ties on the displayed VALUE only. Two players on 4,200 points share second place even
 * though the ordering put one above the other on a tie-break the board does not show; numbering
 * them 2 and 3 would claim a winner the score does not support.
 */
export const competitionRanks = (totals: number[]): number[] => {
  let lastTotal: number | undefined;
  let lastRank = 0;
  return totals.map((total, index) => {
    if (total !== lastTotal) {
      lastTotal = total;
      lastRank = index + 1;
    }
    return lastRank;
  });
};

/**
 * A `YYYY-MM` standings key as a month name, e.g. `August 2026`.
 *
 * Built with `Date.UTC` rather than `new Date('2026-08')`: the string form is parsed as UTC by
 * spec but formatted in the viewer's zone, so anyone west of Greenwich would be shown the previous
 * month. The server's month is a UTC month; this renders that same month. The `timeZone: 'UTC'`
 * option is enforced by inspection rather than test, because the web vitest suite pins TZ=UTC
 * and therefore cannot distinguish the two code paths.
 */
export const formatStandingsMonth = (month: string, locale?: string): string => {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, monthNumber - 1, 1)),
  );
};

/**
 * A game's day - either a `YYYY-MM-DD` daily key or an ISO timestamp - as a readable date.
 *
 * Formatted in UTC for the same reason formatStandingsMonth is: every day this game keys on is a
 * UTC calendar day (`dailyOn`, and the streak counted off it), so rendering history in the
 * viewer's zone would date a daily to a different day than the streak that counted it. As with
 * formatStandingsMonth, the `timeZone` option is enforced by inspection rather than test, because
 * the web vitest suite pins TZ=UTC and so cannot distinguish the two code paths.
 */
export const formatGameDate = (date: string, locale?: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(date));

/**
 * Whether the monthly standings section belongs on the page.
 *
 * The null branch is not redundant with the others: an un-asked space can already hold daily history
 * (any space where a daily was generated before this setting existed), and the prompt asking whether
 * to turn the feature on must not sit above a populated board. Answering the prompt brings it back,
 * because disabling never deletes anything.
 */
export const shouldShowStandings = (
  dailyChallengeEnabled: boolean | null | undefined,
  entries: { daysPlayed: number }[],
): boolean => {
  if (dailyChallengeEnabled === null || dailyChallengeEnabled === undefined) {
    return false;
  }
  return dailyChallengeEnabled || entries.some((entry) => entry.daysPlayed > 0);
};
