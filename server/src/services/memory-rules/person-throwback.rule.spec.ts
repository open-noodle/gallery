import { DateTime } from 'luxon';
import { MemoryAsset, MemoryPersonDayCount } from 'src/repositories/asset.repository';
import { DormantPerson } from 'src/repositories/person.repository';
import { DEFAULT_DORMANCY_MONTHS, PersonThrowbackMemoryRule } from 'src/services/memory-rules/person-throwback.rule';

const target = DateTime.fromISO('2026-08-13', { zone: 'utc' });

let seq = 0;

/** One `MemoryPersonDayCount` row per entry in `counts`, on consecutive UTC calendar days starting `startDate`. */
const dailyCounts = (personId: string, startDate: string, counts: number[]): MemoryPersonDayCount[] => {
  const start = DateTime.fromISO(startDate, { zone: 'utc' });
  return counts.map((count, index) => ({ personId, day: start.plus({ days: index }).toJSDate(), count }));
};

/** One asset per unit of `counts[dayIndex]`, spread across the same days as `dailyCounts`, chronological. */
const buildAssets = (startDate: string, counts: number[]): MemoryAsset[] => {
  const start = DateTime.fromISO(startDate, { zone: 'utc' });
  const assets: MemoryAsset[] = [];
  for (const [dayIndex, count] of counts.entries()) {
    for (let hour = 0; hour < count; hour++) {
      assets.push({ id: `asset-${seq++}`, localDateTime: start.plus({ days: dayIndex, hours: hour }).toJSDate() });
    }
  }
  return assets;
};

const person = (id: string, name: string): DormantPerson => ({ id, name });

type WindowAssetsFn = (personId: string) => Promise<MemoryAsset[]>;

const ruleWith = (
  people: DormantPerson[],
  counts: MemoryPersonDayCount[],
  assetsOrFn: MemoryAsset[] | WindowAssetsFn,
  dormancyMonths?: number,
) => {
  const personRepository = { getDormantPeople: vi.fn().mockResolvedValue(people) };
  const resolveAssets: WindowAssetsFn =
    typeof assetsOrFn === 'function' ? assetsOrFn : () => Promise.resolve(assetsOrFn);
  const assetRepository = {
    getMemoryPersonDailyCounts: vi.fn().mockResolvedValue(counts),
    getMemoryAssetsForPersonWindow: vi.fn((_ownerId: string, personId: string) => resolveAssets(personId)),
  };
  return {
    rule: new PersonThrowbackMemoryRule(personRepository as never, assetRepository as never, dormancyMonths),
    personRepository,
    assetRepository,
  };
};

describe(PersonThrowbackMemoryRule.name, () => {
  beforeEach(() => {
    seq = 0;
  });

  it('given target.day is not 13, then returns [] without calling the repository', async () => {
    const { rule, personRepository } = ruleWith([], [], []);
    const before = DateTime.fromISO('2026-08-12', { zone: 'utc' });
    const after = DateTime.fromISO('2026-08-14', { zone: 'utc' });

    await expect(rule.evaluate({ ownerId: 'user-1', target: before })).resolves.toEqual([]);
    await expect(rule.evaluate({ ownerId: 'user-1', target: after })).resolves.toEqual([]);
    expect(personRepository.getDormantPeople).not.toHaveBeenCalled();
  });

  it('given an empty dormant-person pool, then returns [] and never queries daily counts', async () => {
    const { rule, assetRepository } = ruleWith([], [], []);
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toEqual([]);
    expect(assetRepository.getMemoryPersonDailyCounts).not.toHaveBeenCalled();
  });

  it('given a dormant person with a rich chapter, then emits one candidate with the pinned title/subtitle/dedupeKey/score', async () => {
    const counts = [3, 3, 3, 2, 2, 2, 2, 2, 2, 2]; // sums to 23, 10 days (2023-08-01..2023-08-10)
    const days = dailyCounts('p1', '2023-08-01', counts);
    const assets = buildAssets('2023-08-01', counts);
    const { rule } = ruleWith([person('p1', 'Anna')], days, assets);

    const result = await rule.evaluate({ ownerId: 'user-1', target });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      ruleId: 'person_throwback',
      dedupeKey: 'person_throwback:p1',
      title: 'Times with Anna',
      subtitle: '23 photos · August 2023',
      score: 186, // 110 + min(23,30)*3 + recencyBonus(2023,2026)=7 -> 110+69+7
    });
  });

  it('given any run reaching the dormant-person query, then lastSeenBefore is exactly the default 6 months before the trigger day', async () => {
    const { rule, personRepository } = ruleWith([], [], []);
    await rule.evaluate({ ownerId: 'user-1', target });
    const [, options] = personRepository.getDormantPeople.mock.calls[0]!;
    expect((options as { lastSeenBefore: Date }).lastSeenBefore).toEqual(
      target.startOf('day').minus({ months: DEFAULT_DORMANCY_MONTHS }).toJSDate(),
    );
  });

  it('given a configured dormancy window, then lastSeenBefore honours it instead of the default', async () => {
    const { rule, personRepository } = ruleWith([], [], [], 18);
    await rule.evaluate({ ownerId: 'user-1', target });
    const [, options] = personRepository.getDormantPeople.mock.calls[0]!;
    expect((options as { lastSeenBefore: Date }).lastSeenBefore).toEqual(
      target.startOf('day').minus({ months: 18 }).toJSDate(),
    );
  });

  it('given a person included in the dormant pool with a qualifying chapter, then a candidate is produced', async () => {
    const counts = [10];
    const days = dailyCounts('p1', '2024-05-01', counts);
    const assets = buildAssets('2024-05-01', counts);
    const { rule } = ruleWith([person('p1', 'Ben')], days, assets);
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toHaveLength(1);
  });

  it('given a chapter with fewer than MIN_CHAPTER_ASSETS assets, then that person is excluded', async () => {
    const counts = [5];
    const days = dailyCounts('p1', '2024-05-01', counts);
    const { rule } = ruleWith([person('p1', 'Cara')], days, []);
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toEqual([]);
  });

  it('given any run reaching the dormant-person query, then it is called with minAssets 10, limit 10 and the exact cutoff', async () => {
    const { rule, personRepository } = ruleWith([], [], []);
    await rule.evaluate({ ownerId: 'user-1', target });
    expect(personRepository.getDormantPeople).toHaveBeenCalledWith('user-1', {
      lastSeenBefore: target.startOf('day').minus({ months: DEFAULT_DORMANCY_MONTHS }).toJSDate(),
      minAssets: 10,
      limit: 10,
    });
  });

  it('given 7 qualifying people, then exactly 5 candidates are returned, score descending', async () => {
    const counts = [30, 25, 20, 15, 12, 10, 7];
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
    const people = ids.map((id, index) => person(id, `Person ${index}`));
    const days = ids.flatMap((id, index) => dailyCounts(id, '2024-01-10', [counts[index]!]));
    const assetsByPerson = new Map(ids.map((id, index) => [id, buildAssets('2024-01-10', [counts[index]!])]));
    const { rule } = ruleWith(people, days, (personId) => Promise.resolve(assetsByPerson.get(personId) ?? []));

    const result = await rule.evaluate({ ownerId: 'user-1', target });

    expect(result).toHaveLength(5);
    const scores = result.map((c) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('given two people with identical scores, then ties break by personId ascending', async () => {
    const counts = [10];
    const days = [...dailyCounts('pB', '2024-01-10', counts), ...dailyCounts('pA', '2024-01-10', counts)];
    const assetsA = buildAssets('2024-01-10', counts);
    const assetsB = buildAssets('2024-01-10', counts);
    const { rule } = ruleWith([person('pB', 'Bea'), person('pA', 'Adam')], days, (personId) =>
      Promise.resolve(personId === 'pA' ? assetsA : assetsB),
    );
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toHaveLength(2);
    expect(result[0].score).toBe(result[1].score);
    expect(result.map((c) => c.context?.personId)).toEqual(['pA', 'pB']);
  });

  it('given a chapter spanning a month boundary, then the subtitle month/year come from medianTime, not chapter.from', async () => {
    const counts = [1, 1, 1, 2, 2, 2, 2]; // 2019-07-29..07-31, 08-01..08-04, heavier in August, sums to 11
    const days = dailyCounts('p1', '2019-07-29', counts);
    const assets = buildAssets('2019-07-29', counts);
    const { rule } = ruleWith([person('p1', 'Dana')], days, assets);
    const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
    expect(candidate.subtitle).toBe('11 photos · August 2019');
  });

  it('given a single-day chapter of 8 assets, then it is included (no distinct-day minimum)', async () => {
    const counts = [8];
    const days = dailyCounts('p1', '2024-02-01', counts);
    const assets = buildAssets('2024-02-01', counts);
    const { rule } = ruleWith([person('p1', 'Eve')], days, assets);
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toHaveLength(1);
  });

  it('given a chapter dated 4 years back, then recencyBonus contributes 6 to the score', async () => {
    const counts = [10];
    const days = dailyCounts('p1', '2022-03-01', counts);
    const assets = buildAssets('2022-03-01', counts);
    const { rule } = ruleWith([person('p1', 'Finn')], days, assets);
    const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
    expect(candidate.score).toBe(146); // 110 + min(10,30)*3 + recencyBonus(2022,2026)=6 -> 110+30+6
  });

  it('given equal chapters 2 and 8 years back, then the 2-years-back one scores higher', async () => {
    const counts = [10];
    const recentDays = dailyCounts('pRecent', '2024-03-01', counts);
    const oldDays = dailyCounts('pOld', '2018-03-01', counts);
    const recentAssets = buildAssets('2024-03-01', counts);
    const oldAssets = buildAssets('2018-03-01', counts);
    const { rule } = ruleWith(
      [person('pRecent', 'Gia'), person('pOld', 'Hank')],
      [...recentDays, ...oldDays],
      (personId) => Promise.resolve(personId === 'pRecent' ? recentAssets : oldAssets),
    );
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    const recent = result.find((c) => c.context?.personId === 'pRecent')!;
    const old = result.find((c) => c.context?.personId === 'pOld')!;
    expect(recent.score).toBeGreaterThan(old.score);
    expect(recent.score).toBe(148); // 110 + 30 + recencyBonus(2024,2026)=8
    expect(old.score).toBe(142); // 110 + 30 + recencyBonus(2018,2026)=2
  });

  it('given a window with 20 assets, then assetIds is capped at 8, evenly spaced and chronological', async () => {
    const counts = [20];
    const days = dailyCounts('p1', '2019-05-01', counts);
    const assets = buildAssets('2019-05-01', counts);
    const { rule } = ruleWith([person('p1', 'Ivy')], days, assets);
    const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
    expect(candidate.assetIds).toHaveLength(8);
    const indices = candidate.assetIds.map((id) => Number(id.replace('asset-', '')));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('given any candidate, then visibleForDays is 7 and dedupeKey has no year', async () => {
    const counts = [10];
    const days = dailyCounts('p1', '2024-04-01', counts);
    const assets = buildAssets('2024-04-01', counts);
    const { rule } = ruleWith([person('p1', 'Jo')], days, assets);
    const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
    expect(candidate.visibleForDays).toBe(7);
    expect(candidate.dedupeKey).not.toMatch(/\d{4}/);
  });

  it('given every pooled candidate fails the chapter bar, then returns [] without any window query', async () => {
    const days = [
      ...dailyCounts('p1', '2024-01-01', [3]),
      ...dailyCounts('p2', '2024-01-01', [4]),
      ...dailyCounts('p3', '2024-01-01', [5]),
    ];
    const { rule, assetRepository } = ruleWith([person('p1', 'A'), person('p2', 'B'), person('p3', 'C')], days, []);
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toEqual([]);
    expect(assetRepository.getMemoryAssetsForPersonWindow).not.toHaveBeenCalled();
  });

  it('given the window query returns fewer assets than chapter.count but still enough, then the candidate is kept reporting the chapter total', async () => {
    const counts = [3, 3, 3, 2, 2, 2, 2, 2, 2, 2]; // 23
    const days = dailyCounts('p1', '2023-08-01', counts);
    const fewerAssets = buildAssets('2023-08-01', [10]); // only 10, all still within August 2023
    const { rule } = ruleWith([person('p1', 'Anna')], days, fewerAssets);
    const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
    expect(candidate.subtitle).toBe('23 photos · August 2023');
  });

  it('given the window query returns 4 assets, then the candidate is dropped', async () => {
    const counts = [3, 3, 3, 2, 2, 2, 2, 2, 2, 2]; // 23
    const days = dailyCounts('p1', '2023-08-01', counts);
    const fewAssets = buildAssets('2023-08-01', [4]);
    const { rule } = ruleWith([person('p1', 'Anna')], days, fewAssets);
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toEqual([]);
  });

  it('given the window query returns zero assets, then the candidate is dropped', async () => {
    const counts = [3, 3, 3, 2, 2, 2, 2, 2, 2, 2]; // 23
    const days = dailyCounts('p1', '2023-08-01', counts);
    const { rule } = ruleWith([person('p1', 'Anna')], days, []);
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toEqual([]);
  });

  it("given one candidate's window query rejects, then that candidate is dropped and the others still return", async () => {
    const goodCounts = [10];
    const days = [...dailyCounts('pGood', '2024-01-10', goodCounts), ...dailyCounts('pBad', '2024-01-10', goodCounts)];
    const goodAssets = buildAssets('2024-01-10', goodCounts);
    const { rule } = ruleWith([person('pGood', 'Kim'), person('pBad', 'Lee')], days, (personId) => {
      if (personId === 'pBad') {
        throw new Error('boom');
      }
      return Promise.resolve(goodAssets);
    });
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toHaveLength(1);
    expect(result[0].context?.personId).toBe('pGood');
  });
});
