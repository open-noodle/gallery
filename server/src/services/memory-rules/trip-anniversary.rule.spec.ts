import { DateTime } from 'luxon';
import { AssetType } from 'src/enum';
import { MemoryAsset, MemoryLocationCluster, MemoryPeriodAsset } from 'src/repositories/asset.repository';
import { recencyBonus } from 'src/services/memory-rules/curation.util';
import {
  MAX_COUNT_BONUS,
  MAX_YEAR_BONUS,
  OnThisDayPlaceMemoryRule,
  SCORE_BASE as PLACE_SCORE_BASE,
} from 'src/services/memory-rules/on-this-day-place.rule';
import {
  ASSET_CAP,
  MAX_CANDIDATES,
  MAX_PROBE_YEARS,
  MIN_PROBE_ASSETS,
  MIN_PROBE_DOMINANCE,
  MIN_TRIP_ASSETS,
  MIN_TRIP_DAYS,
  SCORE_BASE as TRIP_SCORE_BASE,
  TripAnniversaryMemoryRule,
} from 'src/services/memory-rules/trip-anniversary.rule';

const TARGET = DateTime.fromISO('2026-06-10', { zone: 'utc' });

let seq = 0;

/** On-this-day probe fixture: `count` assets in `year` for `city`/`country`, on TARGET's or a given target's month/day. */
const probeCityAssets = (
  target: DateTime,
  year: number,
  city: string | null,
  count: number,
  country: string | null = 'Italy',
): MemoryPeriodAsset[] =>
  Array.from({ length: count }, () => ({
    id: `probe-${city ?? 'none'}-${year}-${seq++}`,
    localDateTime: target.set({ year }).plus({ minutes: seq }).toJSDate(),
    year,
    country,
    city,
    isFavorite: false,
    type: AssetType.Image,
    duration: null,
  }));

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

const locationAsset = (id: string, iso: string): MemoryAsset => ({ id, localDateTime: new Date(iso) });

const germanyHome = (): MemoryLocationCluster =>
  cluster('Germany', 'Berlin', 20, 10, '2020-03-15T00:00:00Z', '2020-06-01T00:00:00Z');

/** A trip cluster starting exactly on `year`-06-10 (TARGET's anniversary), meeting both trip thresholds by default. */
const romeTrip = (
  year: number,
  { assetCount = 8, dayCount = 3 }: { assetCount?: number; dayCount?: number } = {},
): MemoryLocationCluster =>
  cluster(
    'Italy',
    'Rome',
    assetCount,
    dayCount,
    `${year}-06-10T09:00:00Z`,
    DateTime.fromISO(`${year}-06-10T09:00:00Z`, { zone: 'utc' })
      .plus({ days: dayCount - 1 })
      .toISO()!,
  );

interface FakeAssetRepository {
  getMemoryAssetsForPeriod: ReturnType<typeof vi.fn>;
  getMemoryLocationClusters: ReturnType<typeof vi.fn>;
  getMemoryAssetsForLocation: ReturnType<typeof vi.fn>;
}

const ruleWith = (
  probeAssets: MemoryPeriodAsset[],
): { rule: TripAnniversaryMemoryRule; assetRepository: FakeAssetRepository } => {
  const assetRepository: FakeAssetRepository = {
    getMemoryAssetsForPeriod: vi.fn().mockResolvedValue(probeAssets),
    getMemoryLocationClusters: vi.fn(),
    getMemoryAssetsForLocation: vi.fn().mockResolvedValue([]),
  };
  return { rule: new TripAnniversaryMemoryRule(assetRepository as never), assetRepository };
};

describe(TripAnniversaryMemoryRule.name, () => {
  beforeEach(() => {
    seq = 0;
  });

  describe('given a probe with one dominant city in 2023, a different-country home, and a trip cluster on the anniversary', () => {
    it('fires exactly one candidate with the pinned title/subtitle/score/memoryAt/visibleForDays/dedupeKey', async () => {
      const { rule, assetRepository } = ruleWith(probeCityAssets(TARGET, 2023, 'Rome', 6));
      assetRepository.getMemoryLocationClusters
        .mockResolvedValueOnce([germanyHome()])
        .mockResolvedValueOnce([romeTrip(2023, { assetCount: 8, dayCount: 3 })]);
      assetRepository.getMemoryAssetsForLocation.mockResolvedValue([
        locationAsset('rome-1', '2023-06-10T09:00:00Z'),
        locationAsset('rome-2', '2023-06-11T09:00:00Z'),
        locationAsset('rome-3', '2023-06-12T09:00:00Z'),
      ]);

      const result = await rule.evaluate({ ownerId: 'user-1', target: TARGET });

      expect(result).toHaveLength(1);
      const [candidate] = result;
      expect(candidate).toMatchObject({
        ruleId: 'trip_anniversary',
        dedupeKey: 'place_day:2023-06-10:italy:rome',
        score: 287, // 260 + 3*4 + min(8,20) + recencyBonus(2023,2026)=7 -> 260+12+8+7
        visibleForDays: 3,
      });
      expect(candidate.title).toBeUndefined();
      expect(candidate.subtitle).toBeUndefined();
      expect(candidate.memoryAt.toISO()).toBe('2023-06-10T09:00:00.000Z');
      expect(candidate.assetIds).toEqual(['rome-1', 'rome-2', 'rome-3']);
      expect(candidate.context).toEqual({
        year: 2023,
        yearsAgo: 3,
        placeKey: 'italy:rome',
        placeLabel: 'Rome, Italy',
        country: 'Italy',
        city: 'Rome',
        assetCount: 8,
        dayCount: 3,
        tripStart: new Date('2023-06-10T09:00:00Z').toISOString(),
        tripEnd: new Date('2023-06-12T09:00:00Z').toISOString(),
      });

      expect(assetRepository.getMemoryLocationClusters).toHaveBeenNthCalledWith(1, 'user-1', {
        takenAfter: new Date('2023-03-12T00:00:00.000Z'),
        takenBefore: new Date('2023-06-04T23:59:59.999Z'),
      });
      expect(assetRepository.getMemoryLocationClusters).toHaveBeenNthCalledWith(2, 'user-1', {
        takenAfter: new Date('2023-06-05T00:00:00.000Z'),
        takenBefore: new Date('2023-07-01T23:59:59.999Z'),
      });
      expect(assetRepository.getMemoryAssetsForLocation).toHaveBeenCalledWith('user-1', {
        country: 'Italy',
        city: 'Rome',
        takenAfter: new Date('2023-06-10T09:00:00Z'),
        takenBefore: new Date('2023-06-12T09:00:00Z'),
      });
    });
  });

  describe('shared-key contract with OnThisDayPlaceMemoryRule', () => {
    it("trip_anniversary's dedupeKey equals on_this_day_place's REAL output for the same probe fixture", async () => {
      // on_this_day_place needs the place in two past years before it emits anything; the key it
      // then produces is anchored to the most recent of them, which is the year the trip card
      // for this anniversary is also anchored to.
      const probeAssets = [...probeCityAssets(TARGET, 2023, 'Rome', 6), ...probeCityAssets(TARGET, 2021, 'Rome', 5)];

      const placeRule = new OnThisDayPlaceMemoryRule({
        getMemoryAssetsForPeriod: vi.fn().mockResolvedValue(probeAssets),
      } as never);
      const [placeCandidate] = await placeRule.evaluate({ ownerId: 'user-1', target: TARGET });

      const { rule: tripRule, assetRepository } = ruleWith(probeAssets);
      assetRepository.getMemoryLocationClusters
        .mockResolvedValueOnce([germanyHome()])
        .mockResolvedValueOnce([romeTrip(2023)])
        // The probe now yields 2021 as well (newest first), which needs its own home lookup;
        // returning nothing leaves 2023 as the only trip candidate.
        .mockResolvedValue([]);
      const [tripCandidate] = await tripRule.evaluate({ ownerId: 'user-1', target: TARGET });

      expect(placeCandidate.dedupeKey).toBe('place_day:2023-06-10:italy:rome');
      expect(tripCandidate.dedupeKey).toBe(placeCandidate.dedupeKey);
    });
  });

  describe('scoring invariant: trip_anniversary at its minimum outscores on_this_day_place at its maximum', () => {
    it('derives both bounds from the two rules exported constants, and the trip score wins', async () => {
      // trip_anniversary minimum: MIN_TRIP_DAYS, MIN_TRIP_ASSETS, oldest year (recencyBonus -> 0).
      const tripYear = 2016; // target.year - 10 -> recencyBonus(2016, 2026) = max(0, 10-10) = 0
      const { rule: tripRule, assetRepository: tripRepo } = ruleWith(
        probeCityAssets(TARGET, tripYear, 'Rome', MIN_PROBE_ASSETS),
      );
      tripRepo.getMemoryLocationClusters
        .mockResolvedValueOnce([germanyHome()])
        .mockResolvedValueOnce([romeTrip(tripYear, { assetCount: MIN_TRIP_ASSETS, dayCount: MIN_TRIP_DAYS })]);
      const [tripCandidate] = await tripRule.evaluate({ ownerId: 'user-1', target: TARGET });

      // on_this_day_place maximum: count >= 30 (capped), most recent past year (recencyBonus -> 9),
      // and enough recurring years to saturate MAX_YEAR_BONUS.
      const placeYear = 2025; // target.year - 1 -> recencyBonus(2025, 2026) = 9
      const placeRule = new OnThisDayPlaceMemoryRule({
        getMemoryAssetsForPeriod: vi.fn().mockResolvedValue([
          ...probeCityAssets(TARGET, placeYear, 'Lisbon', 30, 'Portugal'),
          // eight further years, far more than MAX_YEAR_BONUS / YEAR_BONUS can reward
          ...Array.from({ length: 8 }, (_, index) =>
            probeCityAssets(TARGET, placeYear - 1 - index, 'Lisbon', 5, 'Portugal'),
          ).flat(),
        ]),
      } as never);
      const [placeCandidate] = await placeRule.evaluate({ ownerId: 'user-1', target: TARGET });

      const expectedTripMinScore =
        TRIP_SCORE_BASE + MIN_TRIP_DAYS * 4 + Math.min(MIN_TRIP_ASSETS, 20) + recencyBonus(tripYear, TARGET.year);
      const expectedPlaceMaxScore =
        PLACE_SCORE_BASE + MAX_COUNT_BONUS * 3 + recencyBonus(placeYear, TARGET.year) + MAX_YEAR_BONUS;

      expect(tripCandidate.score).toBe(expectedTripMinScore);
      expect(placeCandidate.score).toBe(expectedPlaceMaxScore);
      expect(tripCandidate.score).toBeGreaterThan(placeCandidate.score);
    });
  });

  describe('probe short-circuit', () => {
    it('returns [] and never calls getMemoryLocationClusters when no past year has a dominant city', async () => {
      const { rule, assetRepository } = ruleWith([
        ...probeCityAssets(TARGET, 2023, 'Rome', 2, 'Italy'),
        ...probeCityAssets(TARGET, 2023, 'Paris', 2, 'France'),
      ]);

      const result = await rule.evaluate({ ownerId: 'user-1', target: TARGET });

      expect(result).toEqual([]);
      expect(assetRepository.getMemoryLocationClusters).not.toHaveBeenCalled();
    });
  });

  describe('ambiguous home', () => {
    it('returns [] and never calls getMemoryAssetsForLocation even though the probe and trip would otherwise qualify', async () => {
      const { rule, assetRepository } = ruleWith(probeCityAssets(TARGET, 2023, 'Rome', 6));
      const ambiguousHome = germanyHome(); // assetCount 20
      const ambiguousRunnerUp = cluster('France', 'Paris', 16, 8, '2020-04-01T00:00:00Z', '2020-04-08T00:00:00Z'); // 20/1.25 = 16
      assetRepository.getMemoryLocationClusters
        .mockResolvedValueOnce([ambiguousHome, ambiguousRunnerUp])
        .mockResolvedValueOnce([romeTrip(2023)]); // would otherwise qualify -- must never be consumed

      const result = await rule.evaluate({ ownerId: 'user-1', target: TARGET });

      expect(result).toEqual([]);
      expect(assetRepository.getMemoryLocationClusters).toHaveBeenCalledTimes(1);
      expect(assetRepository.getMemoryAssetsForLocation).not.toHaveBeenCalled();
    });
  });

  describe('mid-stay rejection', () => {
    it('returns [] and never fetches assets when the trip cluster started the day before the anniversary', async () => {
      const { rule, assetRepository } = ruleWith(probeCityAssets(TARGET, 2023, 'Rome', 6));
      const midStayTrip = cluster('Italy', 'Rome', 8, 3, '2023-06-09T09:00:00Z', '2023-06-11T09:00:00Z');
      assetRepository.getMemoryLocationClusters
        .mockResolvedValueOnce([germanyHome()])
        .mockResolvedValueOnce([midStayTrip]);

      const result = await rule.evaluate({ ownerId: 'user-1', target: TARGET });

      expect(result).toEqual([]);
      expect(assetRepository.getMemoryAssetsForLocation).not.toHaveBeenCalled();
    });
  });

  describe('boundary pairs', () => {
    it('rejects dayCount 1 and accepts dayCount 2 (assetCount fixed at MIN_TRIP_ASSETS)', async () => {
      const rejected = ruleWith(probeCityAssets(TARGET, 2023, 'Rome', 6));
      rejected.assetRepository.getMemoryLocationClusters
        .mockResolvedValueOnce([germanyHome()])
        .mockResolvedValueOnce([romeTrip(2023, { assetCount: MIN_TRIP_ASSETS, dayCount: 1 })]);
      expect(await rejected.rule.evaluate({ ownerId: 'user-1', target: TARGET })).toEqual([]);
      expect(rejected.assetRepository.getMemoryAssetsForLocation).not.toHaveBeenCalled();

      const accepted = ruleWith(probeCityAssets(TARGET, 2023, 'Rome', 6));
      accepted.assetRepository.getMemoryLocationClusters
        .mockResolvedValueOnce([germanyHome()])
        .mockResolvedValueOnce([romeTrip(2023, { assetCount: MIN_TRIP_ASSETS, dayCount: 2 })]);
      expect(await accepted.rule.evaluate({ ownerId: 'user-1', target: TARGET })).toHaveLength(1);
    });

    it('rejects assetCount 6 and accepts assetCount 7 (dayCount fixed at MIN_TRIP_DAYS)', async () => {
      const rejected = ruleWith(probeCityAssets(TARGET, 2023, 'Rome', 6));
      rejected.assetRepository.getMemoryLocationClusters
        .mockResolvedValueOnce([germanyHome()])
        .mockResolvedValueOnce([romeTrip(2023, { assetCount: 6, dayCount: MIN_TRIP_DAYS })]);
      expect(await rejected.rule.evaluate({ ownerId: 'user-1', target: TARGET })).toEqual([]);
      expect(rejected.assetRepository.getMemoryAssetsForLocation).not.toHaveBeenCalled();

      const accepted = ruleWith(probeCityAssets(TARGET, 2023, 'Rome', 6));
      accepted.assetRepository.getMemoryLocationClusters
        .mockResolvedValueOnce([germanyHome()])
        .mockResolvedValueOnce([romeTrip(2023, { assetCount: 7, dayCount: MIN_TRIP_DAYS })]);
      expect(await accepted.rule.evaluate({ ownerId: 'user-1', target: TARGET })).toHaveLength(1);
    });

    it('rejects a probe dominance ratio of 0.5 and accepts exactly MIN_PROBE_DOMINANCE (0.6), without ever calling downstream queries on rejection', async () => {
      expect(MIN_PROBE_DOMINANCE).toBe(0.6);

      const rejected = ruleWith([
        ...probeCityAssets(TARGET, 2023, 'Rome', 5, 'Italy'),
        ...probeCityAssets(TARGET, 2023, 'Paris', 5, 'France'),
      ]);
      expect(await rejected.rule.evaluate({ ownerId: 'user-1', target: TARGET })).toEqual([]);
      expect(rejected.assetRepository.getMemoryLocationClusters).not.toHaveBeenCalled();

      const accepted = ruleWith([
        ...probeCityAssets(TARGET, 2023, 'Rome', 6, 'Italy'),
        ...probeCityAssets(TARGET, 2023, 'Paris', 4, 'France'),
      ]);
      accepted.assetRepository.getMemoryLocationClusters
        .mockResolvedValueOnce([germanyHome()])
        .mockResolvedValueOnce([romeTrip(2023)]);
      expect(await accepted.rule.evaluate({ ownerId: 'user-1', target: TARGET })).toHaveLength(1);
    });

    it('rejects a probe items.length of 2 and accepts exactly MIN_PROBE_ASSETS (3), without ever calling downstream queries on rejection', async () => {
      expect(MIN_PROBE_ASSETS).toBe(3);

      const rejected = ruleWith(probeCityAssets(TARGET, 2023, 'Rome', 2));
      expect(await rejected.rule.evaluate({ ownerId: 'user-1', target: TARGET })).toEqual([]);
      expect(rejected.assetRepository.getMemoryLocationClusters).not.toHaveBeenCalled();

      const accepted = ruleWith(probeCityAssets(TARGET, 2023, 'Rome', 3));
      accepted.assetRepository.getMemoryLocationClusters
        .mockResolvedValueOnce([germanyHome()])
        .mockResolvedValueOnce([romeTrip(2023)]);
      expect(await accepted.rule.evaluate({ ownerId: 'user-1', target: TARGET })).toHaveLength(1);
    });
  });

  describe('leap year', () => {
    const leapTarget = DateTime.fromISO('2024-02-29', { zone: 'utc' });

    it('skips a qualifying 2023 trip (Luxon clamps Feb 29 -> Feb 28) but still fires for a qualifying 2020 (leap) trip', async () => {
      const { rule, assetRepository } = ruleWith([
        ...probeCityAssets(leapTarget, 2023, 'Rome', 6),
        ...probeCityAssets(leapTarget, 2020, 'Rome', 6),
      ]);
      // 2023 is skipped before any cluster query (invalid anniversary day), so only 2020's home+trip
      // pair is ever consumed.
      assetRepository.getMemoryLocationClusters
        .mockResolvedValueOnce([germanyHome()])
        .mockResolvedValueOnce([cluster('Italy', 'Rome', 8, 3, '2020-02-29T09:00:00Z', '2020-03-02T09:00:00Z')]);

      const result = await rule.evaluate({ ownerId: 'user-1', target: leapTarget });

      expect(result).toHaveLength(1);
      expect(result[0].context).toMatchObject({ year: 2020 });
      expect(assetRepository.getMemoryLocationClusters).toHaveBeenCalledTimes(2);
    });
  });

  describe('current and future years', () => {
    it('skips the current year and future-dated assets, keeping only the qualifying past year', async () => {
      const { rule, assetRepository } = ruleWith([
        ...probeCityAssets(TARGET, 2026, 'Rome', 6), // current year (target.year) -- must be skipped
        ...probeCityAssets(TARGET, 2028, 'Rome', 6), // future year -- must be skipped
        ...probeCityAssets(TARGET, 2023, 'Rome', 6), // qualifying past year
      ]);
      assetRepository.getMemoryLocationClusters
        .mockResolvedValueOnce([germanyHome()])
        .mockResolvedValueOnce([romeTrip(2023)]);

      const result = await rule.evaluate({ ownerId: 'user-1', target: TARGET });

      expect(result).toHaveLength(1);
      expect(result[0].context).toMatchObject({ year: 2023 });
      // exactly one probe year was processed -> exactly one home+trip pair
      expect(assetRepository.getMemoryLocationClusters).toHaveBeenCalledTimes(2);
    });
  });

  describe('caps', () => {
    it('caps candidates at MAX_CANDIDATES (2), keeping the two highest-scoring years', async () => {
      expect(MAX_CANDIDATES).toBe(2);

      const { rule, assetRepository } = ruleWith([
        ...probeCityAssets(TARGET, 2024, 'Rome', 6),
        ...probeCityAssets(TARGET, 2023, 'Rome', 6),
        ...probeCityAssets(TARGET, 2020, 'Rome', 6),
      ]);
      assetRepository.getMemoryAssetsForLocation.mockResolvedValue([locationAsset('a1', '2023-06-10T09:00:00Z')]);
      // processed in probe-year desc order: 2024, 2023, 2020 -- each a home+trip pair.
      assetRepository.getMemoryLocationClusters
        .mockResolvedValueOnce([germanyHome()]) // 2024 home
        .mockResolvedValueOnce([romeTrip(2024, { assetCount: 7, dayCount: 2 })]) // 2024 trip -> score 283
        .mockResolvedValueOnce([germanyHome()]) // 2023 home
        .mockResolvedValueOnce([romeTrip(2023, { assetCount: 10, dayCount: 3 })]) // 2023 trip -> score 289
        .mockResolvedValueOnce([germanyHome()]) // 2020 home
        .mockResolvedValueOnce([romeTrip(2020, { assetCount: 7, dayCount: 2 })]); // 2020 trip -> score 279

      const result = await rule.evaluate({ ownerId: 'user-1', target: TARGET });

      expect(result).toHaveLength(2);
      expect(result.map((c) => c.context?.year)).toEqual([2023, 2024]); // sorted desc by score: 289, 283 (2020's 279 dropped)
    });

    it('caps assets at ASSET_CAP (10), matching curateTripAssets own ceiling', async () => {
      expect(ASSET_CAP).toBe(10);

      const { rule, assetRepository } = ruleWith(probeCityAssets(TARGET, 2023, 'Rome', 6));
      assetRepository.getMemoryLocationClusters
        .mockResolvedValueOnce([germanyHome()])
        .mockResolvedValueOnce([romeTrip(2023, { assetCount: 12, dayCount: 6 })]);
      // 12 well-spaced assets across 6 distinct days -> curateTripAssets ladder tops out at 10.
      const bigAssetList: MemoryAsset[] = [];
      for (let day = 0; day < 6; day++) {
        bigAssetList.push(
          locationAsset(`rome-${day}-a`, `2023-06-${String(10 + day).padStart(2, '0')}T09:00:00Z`),
          locationAsset(`rome-${day}-b`, `2023-06-${String(10 + day).padStart(2, '0')}T15:00:00Z`),
        );
      }
      assetRepository.getMemoryAssetsForLocation.mockResolvedValue(bigAssetList);

      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target: TARGET });

      expect(candidate.assetIds).toHaveLength(10);
      expect(new Set(candidate.assetIds).size).toBe(10);
    });
  });

  describe('MAX_PROBE_YEARS', () => {
    it('evaluates at most MAX_PROBE_YEARS (4) years, asserted via the cluster-query call count', async () => {
      expect(MAX_PROBE_YEARS).toBe(4);

      const { rule, assetRepository } = ruleWith([
        ...probeCityAssets(TARGET, 2025, 'Rome', 6),
        ...probeCityAssets(TARGET, 2024, 'Rome', 6),
        ...probeCityAssets(TARGET, 2023, 'Rome', 6),
        ...probeCityAssets(TARGET, 2022, 'Rome', 6),
        ...probeCityAssets(TARGET, 2021, 'Rome', 6),
        ...probeCityAssets(TARGET, 2020, 'Rome', 6),
      ]);

      let callCount = 0;
      assetRepository.getMemoryLocationClusters.mockImplementation(() => {
        const isHomeCall = callCount % 2 === 0;
        callCount++;
        return Promise.resolve(isHomeCall ? [germanyHome()] : []); // trip window always empty -> just counting calls
      });

      await rule.evaluate({ ownerId: 'user-1', target: TARGET });

      // 6 qualifying probe years exist, but only the most recent 4 are evaluated -> 2 cluster calls each = 8.
      expect(assetRepository.getMemoryLocationClusters).toHaveBeenCalledTimes(8);
    });
  });

  describe('yearsAgo', () => {
    it('reads 1 for a trip one year back and 3 for a trip three years back', async () => {
      const oneYearAgo = ruleWith(probeCityAssets(TARGET, 2025, 'Rome', 6));
      oneYearAgo.assetRepository.getMemoryLocationClusters
        .mockResolvedValueOnce([germanyHome()])
        .mockResolvedValueOnce([romeTrip(2025)]);
      const [candidate1] = await oneYearAgo.rule.evaluate({ ownerId: 'user-1', target: TARGET });
      expect(candidate1.context).toMatchObject({ yearsAgo: 1, assetCount: 8, dayCount: 3 });

      const threeYearsAgo = ruleWith(probeCityAssets(TARGET, 2023, 'Rome', 6));
      threeYearsAgo.assetRepository.getMemoryLocationClusters
        .mockResolvedValueOnce([germanyHome()])
        .mockResolvedValueOnce([romeTrip(2023)]);
      const [candidate3] = await threeYearsAgo.rule.evaluate({ ownerId: 'user-1', target: TARGET });
      expect(candidate3.context).toMatchObject({ yearsAgo: 3, assetCount: 8, dayCount: 3 });
    });
  });

  describe('city null', () => {
    it('falls back to a country-only placeLabel when the trip cluster has no city', async () => {
      const { rule, assetRepository } = ruleWith(probeCityAssets(TARGET, 2023, 'Rome', 6));
      assetRepository.getMemoryLocationClusters
        .mockResolvedValueOnce([germanyHome()])
        .mockResolvedValueOnce([cluster('Italy', null, 8, 3, '2023-06-10T09:00:00Z', '2023-06-12T09:00:00Z')]);

      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target: TARGET });

      expect(candidate.title).toBeUndefined();
      expect(candidate.context).toMatchObject({ placeLabel: 'Italy', city: null });
      expect(candidate.dedupeKey).toBe('place_day:2023-06-10:italy:');
    });
  });

  describe('zero assets', () => {
    it('returns [] without throwing when the probe returns no assets', async () => {
      const { rule, assetRepository } = ruleWith([]);

      await expect(rule.evaluate({ ownerId: 'user-1', target: TARGET })).resolves.toEqual([]);
      expect(assetRepository.getMemoryLocationClusters).not.toHaveBeenCalled();
    });
  });
});
