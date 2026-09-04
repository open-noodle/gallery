/**
 * The two shapes a standings row can take, reduced to what the ordering needs.
 *
 * `played` is whichever count means "this person turned up": rounds answered on today's challenge
 * board, dailies played on the monthly one.
 */
export type StandingsSortable = {
  name: string;
  total: number;
  played: number;
};

/**
 * Ordering shared by both boards.
 *
 * The never-played step is NOT redundant with the total comparison that follows it. A guess can
 * legitimately score 0 - `scoreFromError` floors there - so a member who played and scored nothing
 * holds `total: 0, played: 1`, and the `played` ascending tie-break below would rank them BELOW a
 * member who never opened the game at all. Someone who showed up must never sit under someone who
 * did not.
 */
export const compareStandings = (a: StandingsSortable, b: StandingsSortable): number => {
  if ((a.played === 0) !== (b.played === 0)) {
    return a.played === 0 ? 1 : -1;
  }
  if (a.total !== b.total) {
    return b.total - a.total;
  }
  if (a.played !== b.played) {
    // The same points from fewer rounds is the better performance.
    return a.played - b.played;
  }
  return a.name.localeCompare(b.name);
};
