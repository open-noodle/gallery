import { DateTime } from 'luxon';

/** Meteorological seasons (Northern hemisphere). */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** Calendar months belonging to each season (winter spans the year boundary). */
export const SEASON_MONTHS: Record<Season, number[]> = {
  spring: [3, 4, 5],
  summer: [6, 7, 8],
  autumn: [9, 10, 11],
  winter: [12, 1, 2],
};

/** Human-facing season label used in memory titles. */
export const SEASON_LABEL: Record<Season, string> = {
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
  winter: 'Winter',
};

/** The month (1–12) each season begins on. */
const SEASON_START_MONTH: Record<number, Season> = { 3: 'spring', 6: 'summer', 9: 'autumn', 12: 'winter' };

/** The meteorological season a calendar month belongs to. */
export const seasonOf = (month: number): Season => {
  if ([12, 1, 2].includes(month)) {
    return 'winter';
  }
  if (month >= 3 && month <= 5) {
    return 'spring';
  }
  if (month >= 6 && month <= 8) {
    return 'summer';
  }
  return 'autumn';
};

/**
 * The "season-year" a (month, year) belongs to. For winter, January and February belong to
 * the previous December's winter, so they map to `year - 1`; every other month maps to its
 * own calendar year.
 */
export const seasonYearOf = (month: number, year: number): number => (month === 1 || month === 2 ? year - 1 : year);

/** The season starting on `target`, or `null` if `target` is not a season's first day. */
export const seasonStartingOn = (target: DateTime): Season | null =>
  target.day === 1 ? (SEASON_START_MONTH[target.month] ?? null) : null;

/** Whether `target` is the first day of a meteorological season. */
export const isSeasonStart = (target: DateTime): boolean => seasonStartingOn(target) !== null;
