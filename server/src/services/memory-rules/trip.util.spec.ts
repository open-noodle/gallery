import { DateTime } from 'luxon';
import { MemoryAsset, MemoryLocationCluster } from 'src/repositories/asset.repository';
import {
  BURST_WINDOW_MS,
  curateTripAssets,
  findTripStartingOn,
  HOME_DOMINANCE_RATIO,
  inferHome,
  isAwayFromHome,
  placeKeyOf,
  SMALL_TRIP_MAX,
  TripThresholds,
} from 'src/services/memory-rules/trip.util';

const cluster = (
  country: string | null,
  city: string | null,
  assetCount: number,
  dayCount: number,
  firstDate: string,
  lastDate: string,
): MemoryLocationCluster => ({
  country,
  city,
  assetCount,
  dayCount,
  firstDate: new Date(firstDate),
  lastDate: new Date(lastDate),
});

const asset = (id: string, iso: string): MemoryAsset => ({ id, localDateTime: new Date(iso) });

// 4 days x 3 assets/day, none within the burst window, so all 12 stay as representatives.
// dayCount=4, representativeCount=12 -> getTripTargetSize ladder = 8.
const buildFourDayAssets = (): MemoryAsset[] => [
  asset('d1a', '2023-08-01T09:00:00Z'),
  asset('d1b', '2023-08-01T12:00:00Z'),
  asset('d1c', '2023-08-01T15:00:00Z'),
  asset('d2a', '2023-08-02T09:00:00Z'),
  asset('d2b', '2023-08-02T12:00:00Z'),
  asset('d2c', '2023-08-02T15:00:00Z'),
  asset('d3a', '2023-08-03T09:00:00Z'),
  asset('d3b', '2023-08-03T12:00:00Z'),
  asset('d3c', '2023-08-03T15:00:00Z'),
  asset('d4a', '2023-08-04T09:00:00Z'),
  asset('d4b', '2023-08-04T12:00:00Z'),
  asset('d4c', '2023-08-04T15:00:00Z'),
];

describe('constants', () => {
  it('exposes the documented values', () => {
    expect(BURST_WINDOW_MS).toBe(2 * 60 * 1000);
    expect(SMALL_TRIP_MAX).toBe(6);
    expect(HOME_DOMINANCE_RATIO).toBe(1.25);
  });
});

describe('placeKeyOf', () => {
  it('lowercases country and city', () => {
    expect(placeKeyOf('Italy', 'Rome')).toBe('italy:rome');
    expect(placeKeyOf('ITALY', 'ROME')).toBe('italy:rome');
  });

  it('handles a null country', () => {
    expect(placeKeyOf(null, 'Rome')).toBe(':rome');
  });

  it('handles a null city', () => {
    expect(placeKeyOf('Italy', null)).toBe('italy:');
  });
});

describe('inferHome', () => {
  it('returns the top cluster when it dominates', () => {
    const home = cluster('Germany', 'Berlin', 20, 12, '2023-01-01T00:00:00Z', '2023-03-20T00:00:00Z');
    const runnerUp = cluster('France', 'Paris', 5, 3, '2023-04-01T00:00:00Z', '2023-04-03T00:00:00Z');
    expect(inferHome([home, runnerUp])).toBe(home);
  });

  it("returns null when the top cluster's country is null", () => {
    const home = cluster(null, null, 20, 12, '2023-01-01T00:00:00Z', '2023-03-20T00:00:00Z');
    expect(inferHome([home])).toBeNull();
  });

  it('returns null when a different-country runner-up is within the dominance ratio', () => {
    const home = cluster('Germany', 'Berlin', 20, 12, '2023-01-01T00:00:00Z', '2023-03-20T00:00:00Z');
    // 20 / 1.25 = 16, runner-up at exactly 16 is ambiguous (>=, not >).
    const runnerUp = cluster('France', 'Paris', 16, 8, '2023-04-01T00:00:00Z', '2023-04-08T00:00:00Z');
    expect(inferHome([home, runnerUp])).toBeNull();
  });

  it('returns the top cluster when the runner-up is same-country (not ambiguous)', () => {
    const home = cluster('Germany', 'Berlin', 20, 12, '2023-01-01T00:00:00Z', '2023-03-20T00:00:00Z');
    const runnerUp = cluster('Germany', 'Munich', 20, 10, '2023-04-01T00:00:00Z', '2023-04-10T00:00:00Z');
    expect(inferHome([home, runnerUp])).toBe(home);
  });

  it('returns null for an empty cluster list', () => {
    expect(inferHome([])).toBeNull();
  });
});

describe('isAwayFromHome', () => {
  const home = cluster('Germany', 'Berlin', 20, 12, '2023-01-01T00:00:00Z', '2023-03-20T00:00:00Z');

  it('returns true for a different country', () => {
    const item = cluster('France', 'Paris', 8, 3, '2023-04-01T00:00:00Z', '2023-04-03T00:00:00Z');
    expect(isAwayFromHome(item, home)).toBe(true);
  });

  it('returns true for the same country with a different non-null city', () => {
    const item = cluster('Germany', 'Munich', 8, 3, '2023-04-01T00:00:00Z', '2023-04-03T00:00:00Z');
    expect(isAwayFromHome(item, home)).toBe(true);
  });

  it('returns false for the same country and the same city', () => {
    const item = cluster('Germany', 'Berlin', 8, 3, '2023-04-01T00:00:00Z', '2023-04-03T00:00:00Z');
    expect(isAwayFromHome(item, home)).toBe(false);
  });

  it('returns false when the home city is null', () => {
    const homeNoCity = cluster('Germany', null, 20, 12, '2023-01-01T00:00:00Z', '2023-03-20T00:00:00Z');
    const item = cluster('Germany', 'Munich', 8, 3, '2023-04-01T00:00:00Z', '2023-04-03T00:00:00Z');
    expect(isAwayFromHome(item, homeNoCity)).toBe(false);
  });

  it('returns false when the candidate city is null', () => {
    const item = cluster('Germany', null, 8, 3, '2023-04-01T00:00:00Z', '2023-04-03T00:00:00Z');
    expect(isAwayFromHome(item, home)).toBe(false);
  });
});

describe('findTripStartingOn', () => {
  const home = cluster('Germany', 'Berlin', 40, 20, '2020-01-01T00:00:00Z', '2020-12-30T00:00:00Z');
  const thresholds: TripThresholds = { minAssets: 7, minDays: 2 };
  const anniversary = DateTime.fromISO('2023-06-14', { zone: 'utc' });

  it('picks a cluster whose firstDate is on the anniversary day and meets both thresholds', () => {
    const trip = cluster('France', 'Paris', 8, 3, '2023-06-14T09:00:00Z', '2023-06-16T00:00:00Z');
    expect(findTripStartingOn([trip], anniversary, home, thresholds)).toBe(trip);
  });

  it('rejects a firstDate one day before the anniversary', () => {
    const trip = cluster('France', 'Paris', 8, 3, '2023-06-13T09:00:00Z', '2023-06-16T00:00:00Z');
    expect(findTripStartingOn([trip], anniversary, home, thresholds)).toBeNull();
  });

  it('rejects a firstDate one day after the anniversary', () => {
    const trip = cluster('France', 'Paris', 8, 3, '2023-06-15T09:00:00Z', '2023-06-16T00:00:00Z');
    expect(findTripStartingOn([trip], anniversary, home, thresholds)).toBeNull();
  });

  it('qualifies a firstDate of 23:30Z on the anniversary day (UTC calendar day, not instant)', () => {
    const trip = cluster('France', 'Paris', 8, 3, '2023-06-14T23:30:00Z', '2023-06-16T00:00:00Z');
    expect(findTripStartingOn([trip], anniversary, home, thresholds)).toBe(trip);
  });

  it('rejects assetCount one below minAssets and accepts exactly minAssets', () => {
    const tooFew = cluster('France', 'Paris', 6, 2, '2023-06-14T09:00:00Z', '2023-06-15T00:00:00Z');
    expect(findTripStartingOn([tooFew], anniversary, home, thresholds)).toBeNull();

    const enough = cluster('France', 'Paris', 7, 2, '2023-06-14T09:00:00Z', '2023-06-15T00:00:00Z');
    expect(findTripStartingOn([enough], anniversary, home, thresholds)).toBe(enough);
  });

  it('rejects dayCount of 1 and accepts dayCount of 2', () => {
    const oneDay = cluster('France', 'Paris', 7, 1, '2023-06-14T09:00:00Z', '2023-06-14T20:00:00Z');
    expect(findTripStartingOn([oneDay], anniversary, home, thresholds)).toBeNull();

    const twoDays = cluster('France', 'Paris', 7, 2, '2023-06-14T09:00:00Z', '2023-06-15T20:00:00Z');
    expect(findTripStartingOn([twoDays], anniversary, home, thresholds)).toBe(twoDays);
  });

  it('rejects a cluster that meets thresholds but is not away from home', () => {
    const sameCity = cluster('Germany', 'Berlin', 8, 3, '2023-06-14T09:00:00Z', '2023-06-16T00:00:00Z');
    expect(findTripStartingOn([sameCity], anniversary, home, thresholds)).toBeNull();
  });

  it('picks the higher assetCount when two clusters qualify the same day', () => {
    const weaker = cluster('France', 'Paris', 8, 2, '2023-06-14T09:00:00Z', '2023-06-15T20:00:00Z');
    const stronger = cluster('Italy', 'Rome', 10, 2, '2023-06-14T09:00:00Z', '2023-06-15T20:00:00Z');
    expect(findTripStartingOn([weaker, stronger], anniversary, home, thresholds)).toBe(stronger);
    expect(findTripStartingOn([stronger, weaker], anniversary, home, thresholds)).toBe(stronger);
  });

  it('breaks equal-assetCount ties by the lower placeKeyOf, regardless of input order', () => {
    const italy = cluster('Italy', 'Rome', 9, 2, '2023-06-14T09:00:00Z', '2023-06-15T20:00:00Z');
    const france = cluster('France', 'Paris', 9, 2, '2023-06-14T09:00:00Z', '2023-06-15T20:00:00Z');
    // placeKeyOf: 'france:paris' < 'italy:rome'
    expect(findTripStartingOn([italy, france], anniversary, home, thresholds)).toBe(france);
    expect(findTripStartingOn([france, italy], anniversary, home, thresholds)).toBe(france);
  });

  it('returns null for an empty cluster list', () => {
    expect(findTripStartingOn([], anniversary, home, thresholds)).toBeNull();
  });
});

describe('curateTripAssets', () => {
  it('collapses assets within the 2-minute burst window into a single representative', () => {
    const assets = [
      asset('a1', '2023-06-01T09:00:00Z'),
      asset('a2', '2023-06-01T09:01:00Z'), // 60s after a1: collapsed
      asset('a3', '2023-06-01T09:02:30Z'), // 90s after a2: collapsed
      asset('a4', '2023-06-01T09:10:00Z'), // 7.5min after a3: kept
      asset('a5', '2023-06-01T09:20:00Z'), // 10min after a4: kept
    ];
    expect(curateTripAssets(assets, 10)).toEqual(['a1', 'a4', 'a5']);
  });

  it('returns all representatives when at or below SMALL_TRIP_MAX after collapsing', () => {
    const assets = [
      asset('b1', '2023-07-01T09:00:00Z'),
      asset('b2', '2023-07-02T09:00:00Z'),
      asset('b3', '2023-07-03T09:00:00Z'),
      asset('b4', '2023-07-04T09:00:00Z'),
      asset('b5', '2023-07-05T09:00:00Z'),
      asset('b6', '2023-07-06T09:00:00Z'),
    ];
    expect(assets).toHaveLength(SMALL_TRIP_MAX);
    expect(curateTripAssets(assets, 10)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6']);
  });

  it('covers every distinct day before topping up remaining slots (cap above the ladder)', () => {
    // ladder = min(cap=10, 8) = 8: one middle-of-day pick per day (4), then 4 more evenly
    // spaced from what's left.
    const result = curateTripAssets(buildFourDayAssets(), 10);
    expect(result).toEqual(['d1a', 'd1b', 'd2a', 'd2b', 'd3b', 'd3c', 'd4b', 'd4c']);
  });

  it('never exceeds the cap argument, even when the cap is below the internal ladder', () => {
    // ladder would be 8, but cap=4 clamps it: one middle-of-day pick per day, no topping up.
    const result = curateTripAssets(buildFourDayAssets(), 4);
    expect(result).toEqual(['d1b', 'd2b', 'd3b', 'd4b']);
    expect(result.length).toBeLessThanOrEqual(4);
  });

  it('produces a chronologically sorted, duplicate-free result', () => {
    const assets = buildFourDayAssets();
    const result = curateTripAssets(assets, 10);
    const times = result.map((id) => assets.find((a) => a.id === id)!.localDateTime.getTime());
    expect(times).toEqual([...times].sort((left, right) => left - right));
    expect(new Set(result).size).toBe(result.length);
  });
});
