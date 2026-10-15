/** One UTC calendar day, in milliseconds. Every day the streak counts is a `date` column value, so
 * there is no DST-shortened day here to make this untrue. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `YYYY-MM-DD` to a whole number of days since the epoch.
 *
 * `Date.parse` reads the date-only form as UTC midnight (ECMA-262 §21.4.3.2), which is the whole
 * reason the days arrive as strings rather than as Dates run through a local-zone formatter: on a
 * server west of UTC that formatter renames every day to the one before it, and the streak would
 * break for players who did nothing wrong.
 */
const toEpochDay = (day: string): number => Date.parse(day) / DAY_MS;

export type Streak = { current: number; best: number };

/**
 * The current and best run of consecutive UTC days among the days a player completed the daily on.
 *
 * Pure arithmetic over `YYYY-MM-DD` strings - what makes a day *count* (every round guessed) is the
 * repository query's business, and is deliberately not re-litigated here.
 *
 * The current streak survives a `today` that has not been played yet: it ends at the most recent
 * played day as long as that day is today or yesterday. A streak must not break merely because the
 * day is not over - the player still has until UTC midnight to defend it, and showing 0 while it is
 * still savable is the one wrong answer here.
 *
 * @param playedDays UTC calendar days, in any order, duplicates allowed.
 * @param today The UTC calendar day to measure the current streak against.
 */
export const computeStreak = (playedDays: string[], today: string): Streak => {
  // Deduplicated before sorting: two rows for one day are not two days of a streak. The repository
  // cannot produce them (one daily per owner per day, by unique index), but a caller that
  // aggregated differently must not be able to inflate a streak by repeating a date.
  const days = [...new Set(playedDays)].map((day) => toEpochDay(day)).sort((a, b) => a - b);

  let best = 0;
  let run = 0;
  let previous: number | undefined;
  for (const day of days) {
    run = previous !== undefined && day - previous === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }

  // `run` is now the run ending at the most recent played day, which is the only run that can still
  // be the current one.
  const lastPlayed = days.at(-1);
  const current = lastPlayed !== undefined && toEpochDay(today) - lastPlayed <= 1 ? run : 0;

  return { current, best };
};
