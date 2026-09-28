import {
  competitionRanks,
  formatDistanceKm,
  formatGameDate,
  formatStandingsMonth,
  MAX_ROUND_SCORE,
  scorePercent,
  shouldShowStandings,
  timeUntilNextDaily,
  wrapLongitude,
  yearFromIso,
} from '$lib/utils/game';

describe('formatDistanceKm', () => {
  it('uses metres below one kilometre', () => {
    expect(formatDistanceKm(0)).toBe('0 m');
    expect(formatDistanceKm(0.42)).toBe('420 m');
  });

  it('uses one decimal between 1 and 10 km', () => {
    expect(formatDistanceKm(1.24)).toBe('1.2 km');
  });

  it('rounds to whole kilometres above 10', () => {
    expect(formatDistanceKm(550.4)).toBe('550 km');
    expect(formatDistanceKm(17_755)).toBe('17,755 km');
  });
});

describe('scorePercent', () => {
  it('maps the score range onto 0-100', () => {
    expect(scorePercent(0)).toBe(0);
    expect(scorePercent(MAX_ROUND_SCORE)).toBe(100);
    expect(scorePercent(2500)).toBe(50);
  });

  it('clamps out-of-range input rather than overflowing the bar', () => {
    expect(scorePercent(-10)).toBe(0);
    expect(scorePercent(99_999)).toBe(100);
  });
});

describe('yearFromIso', () => {
  it('reads the calendar year', () => {
    expect(yearFromIso('2020-07-01T14:23:00.000Z')).toBe(2020);
  });
});

describe('wrapLongitude', () => {
  it('leaves an in-range longitude untouched', () => {
    expect(wrapLongitude(45.5)).toBe(45.5);
    expect(wrapLongitude(-179)).toBe(-179);
  });

  // 180 and -180 are the same meridian; the modulo formula normalises the exact boundary to -180.
  it('normalises the antimeridian boundary to -180', () => {
    expect(wrapLongitude(180)).toBe(-180);
    expect(wrapLongitude(-180)).toBe(-180);
  });

  it('wraps a longitude past the antimeridian back into [-180, 180]', () => {
    expect(wrapLongitude(200)).toBe(-160);
    expect(wrapLongitude(-230)).toBe(130);
  });
});

describe('timeUntilNextDaily', () => {
  it('counts the remaining hours and minutes of the UTC day', () => {
    expect(timeUntilNextDaily(new Date('2026-08-16T21:45:00.000Z'))).toBe('2h 15m');
    expect(timeUntilNextDaily(new Date('2026-08-16T00:00:00.000Z'))).toBe('24h 0m');
    expect(timeUntilNextDaily(new Date('2026-08-16T23:59:00.000Z'))).toBe('0h 1m');
  });

  // The whole point of the UTC choice: the server keys the daily on the UTC calendar day, so a
  // countdown built from local time would run to the wrong instant for every viewer outside UTC -
  // and for one east of it, would still be counting after the new daily had already appeared.
  it('is driven by the UTC day, not the local one', () => {
    // 22:30 UTC on 16 August is already 00:30 on the 17th in UTC+2. A local-day countdown would
    // read ~23h30m here; the UTC answer is 1h30m.
    expect(timeUntilNextDaily(new Date('2026-08-16T22:30:00.000Z'))).toBe('1h 30m');
  });

  // Crossing a month boundary relies on Date.UTC normalising day 32 into the 1st, rather than any
  // month-length arithmetic of our own.
  it('rolls over the end of a month', () => {
    expect(timeUntilNextDaily(new Date('2026-08-31T23:00:00.000Z'))).toBe('1h 0m');
  });
});

describe('competitionRanks', () => {
  it('numbers a strictly descending board 1, 2, 3', () => {
    expect(competitionRanks([9100, 4200, 100])).toEqual([1, 2, 3]);
  });

  it('gives tied totals the same rank and skips the one after, like a race result', () => {
    expect(competitionRanks([9100, 4200, 4200, 100])).toEqual([1, 2, 2, 4]);
  });

  it('ties on the leading position too', () => {
    expect(competitionRanks([4200, 4200, 100])).toEqual([1, 1, 3]);
  });

  it('ties every member of an untouched board at rank 1', () => {
    expect(competitionRanks([0, 0, 0])).toEqual([1, 1, 1]);
  });

  it('returns an empty array for an empty board', () => {
    expect(competitionRanks([])).toEqual([]);
  });

  it('numbers a one-row board 1', () => {
    expect(competitionRanks([4200])).toEqual([1]);
  });

  it('ties a pair that ends the board, with nothing following to renumber', () => {
    expect(competitionRanks([9100, 4200, 4200])).toEqual([1, 2, 2]);
  });
});

describe('formatStandingsMonth', () => {
  it('renders the month name and year from a YYYY-MM key', () => {
    expect(formatStandingsMonth('2026-08', 'en-GB')).toBe('August 2026');
  });

  it('renders in the given locale', () => {
    expect(formatStandingsMonth('2026-08', 'de-DE')).toBe('August 2026');
    expect(formatStandingsMonth('2026-12', 'fr-FR')).toBe('décembre 2026');
  });
});

describe('formatGameDate', () => {
  it('renders a YYYY-MM-DD daily key as a readable date', () => {
    expect(formatGameDate('2026-08-19', 'en-GB')).toBe('19 Aug 2026');
  });

  it('renders in the given locale', () => {
    expect(formatGameDate('2026-08-19', 'de-DE')).toBe('19.08.2026');
  });

  // A free-play game has no dailyOn, so history dates it from its ISO createdAt instead - the same
  // helper has to take both.
  it('renders an ISO timestamp as the same shape of date', () => {
    expect(formatGameDate('2026-08-19T09:00:00.000Z', 'en-GB')).toBe('19 Aug 2026');
  });

  // The game keys every day it cares about - dailyOn, and the streak counted off it - in UTC. A
  // late-evening UTC timestamp must not slide onto the next day, or history would disagree with
  // the streak that counted it. (The suite pins TZ=UTC, so this pins the intent, not the
  // behaviour under a different zone - the timeZone option is what enforces it.)
  it('dates a game by its UTC day rather than the viewer zone', () => {
    expect(formatGameDate('2026-08-19T23:30:00.000Z', 'en-GB')).toBe('19 Aug 2026');
  });
});

describe('shouldShowStandings', () => {
  it('hides the board while nobody has been asked, even when earlier play left scores', () => {
    // A space where a daily was generated during RC testing arrives un-asked WITH history. Showing a
    // populated board directly under a prompt asking whether to switch the feature on reads as a
    // contradiction, so the prompt wins. Nothing is deleted - the board returns once answered.
    expect(shouldShowStandings(null, [{ daysPlayed: 3 }])).toBe(false);
  });

  it('hides the board for a never-asked empty space', () => {
    expect(shouldShowStandings(null, [{ daysPlayed: 0 }])).toBe(false);
  });

  it('shows the board whenever the daily is on, even before anyone plays', () => {
    expect(shouldShowStandings(true, [{ daysPlayed: 0 }])).toBe(true);
  });

  it('keeps the board after the daily is switched off, if members earned something', () => {
    expect(shouldShowStandings(false, [{ daysPlayed: 0 }, { daysPlayed: 2 }])).toBe(true);
  });

  it('hides the board for a declined space nobody played in', () => {
    expect(shouldShowStandings(false, [{ daysPlayed: 0 }, { daysPlayed: 0 }])).toBe(false);
  });

  it('hides the board rather than throwing when there are no entries at all', () => {
    expect(shouldShowStandings(false, [])).toBe(false);
  });

  it('treats an absent field as never-asked', () => {
    // The SDK types the response field as optional, so undefined reaches this helper in practice.
    expect(shouldShowStandings(undefined, [{ daysPlayed: 5 }])).toBe(false);
  });
});
