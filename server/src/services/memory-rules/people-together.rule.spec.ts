import { DateTime } from 'luxon';
import { MemoryPeriodFace } from 'src/repositories/asset.repository';
import { PeopleTogetherMemoryRule } from 'src/services/memory-rules/people-together.rule';

const target = DateTime.fromISO('2026-06-20', { zone: 'utc' });

let seq = 0;

const face = (assetId: string, personId: string, personName: string, iso: string): MemoryPeriodFace => {
  const localDateTime = DateTime.fromISO(iso, { zone: 'utc' });
  return { assetId, personId, personName, localDateTime: localDateTime.toJSDate(), year: localDateTime.year };
};

/**
 * One row-pair (both subjects on the same asset) per entry in `days` (a day-of-month string),
 * so `days.length` controls the photo count and the number of *distinct* entries controls
 * `distinctDays`.
 */
const pairRows = (
  year: number,
  a: { id: string; name: string },
  b: { id: string; name: string },
  days: string[],
): MemoryPeriodFace[] => {
  const rows: MemoryPeriodFace[] = [];
  for (const day of days) {
    const assetId = `asset-${seq++}`;
    const iso = `${year}-06-${day}T10:00:00`;
    rows.push(face(assetId, a.id, a.name, iso), face(assetId, b.id, b.name, iso));
  }
  return rows;
};

const ruleWith = (rows: MemoryPeriodFace[]) => {
  const assetRepository = { getMemoryFacesForPeriod: vi.fn().mockResolvedValue(rows) };
  return { rule: new PeopleTogetherMemoryRule(assetRepository as never), assetRepository };
};

const anna = { id: 'p1', name: 'Anna' };
const ben = { id: 'p2', name: 'Ben' };

describe(PeopleTogetherMemoryRule.name, () => {
  beforeEach(() => {
    seq = 0;
  });

  it('given target.day !== 20, then returns [] and does not call the repository', async () => {
    const wrongDay = DateTime.fromISO('2026-06-19', { zone: 'utc' });
    const { rule, assetRepository } = ruleWith([]);
    const result = await rule.evaluate({ ownerId: 'user-1', target: wrongDay });
    expect(result).toEqual([]);
    expect(assetRepository.getMemoryFacesForPeriod).not.toHaveBeenCalled();
  });

  it('given day 20 and a qualifying pair (6 photos, 2 days) in 2023, then emits one candidate matching the spec', async () => {
    const rows = pairRows(2023, anna, ben, ['10', '10', '10', '11', '11', '11']);
    const { rule, assetRepository } = ruleWith(rows);
    const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });

    expect(assetRepository.getMemoryFacesForPeriod).toHaveBeenCalledWith('user-1', {
      months: [6],
      takenBefore: target.endOf('day').toJSDate(),
    });
    expect(candidate).toMatchObject({
      ruleId: 'people_together',
      dedupeKey: 'people_together:p1:p2:2023-06',
      score: 125, // 100 + 6*3 + recencyBonus(2023,2026)=7
      visibleForDays: 7,
      context: {
        year: 2023,
        month: 6,
        personAId: 'p1',
        personAName: 'Anna',
        personBId: 'p2',
        personBName: 'Ben',
        count: 6,
      },
    });
    expect(candidate.title).toBeUndefined();
    expect(candidate.subtitle).toBeUndefined();
    expect(candidate.assetIds).toHaveLength(6);
    // memoryAt is the median moment of the pair's shared assets (three on 06-10, three on 06-11 → lower-middle is 06-10).
    expect(candidate.memoryAt.toISODate()).toBe('2023-06-10');
  });

  it('given exactly 6 photos across exactly 2 days, then the year qualifies (inclusive boundary)', async () => {
    const rows = pairRows(2023, anna, ben, ['10', '10', '10', '11', '11', '11']);
    const { rule } = ruleWith(rows);
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toHaveLength(1);
  });

  it('given only 5 co-occurring photos, then that year is skipped (MIN_ASSETS)', async () => {
    const rows = pairRows(2023, anna, ben, ['10', '10', '10', '11', '11']);
    const { rule } = ruleWith(rows);
    expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
  });

  it('given 6 photos all on one day, then that year is skipped (MIN_DISTINCT_DAYS)', async () => {
    const rows = pairRows(2023, anna, ben, ['10', '10', '10', '10', '10', '10']);
    const { rule } = ruleWith(rows);
    expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
  });

  it('given two competing pairs in the same year, then the higher-count pair wins that year', async () => {
    const carl = { id: 'p3', name: 'Carl' };
    const dana = { id: 'p4', name: 'Dana' };
    const rows = [
      ...pairRows(2023, anna, ben, ['10', '10', '10', '11', '11', '11']), // 6 photos
      ...pairRows(2023, carl, dana, ['12', '12', '12', '13', '13', '13', '14']), // 7 photos
    ];
    const { rule } = ruleWith(rows);
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toHaveLength(1);
    expect(result[0].context).toMatchObject({ personAName: 'Carl', personBName: 'Dana' });
  });

  it('given qualifying pairs across 3 prior years, then only the top MAX_YEARS (2) survive, score-sorted', async () => {
    const rows = [
      ...pairRows(2021, anna, ben, ['10', '10', '10', '11', '11', '11']), // 6 photos
      ...pairRows(2022, anna, ben, ['10', '10', '10', '11', '11', '11', '12']), // 7 photos
      ...pairRows(2023, anna, ben, ['10', '10', '10', '11', '11', '11', '12', '12']), // 8 photos
    ];
    const { rule } = ruleWith(rows);
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.context?.year)).toEqual([2023, 2022]);
  });

  it('given only current/future-year rows, then returns [] (prior years only)', async () => {
    const rows = [
      ...pairRows(2026, anna, ben, ['10', '10', '10', '11', '11', '11']),
      ...pairRows(2027, anna, ben, ['10', '10', '10', '11', '11', '11']),
    ];
    const { rule } = ruleWith(rows);
    expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
  });

  it('given a pet-pet pair and a person-pet pair each above threshold, then both qualify', async () => {
    const rex = { id: 'p5', name: 'Rex' };
    const whiskers = { id: 'p6', name: 'Whiskers' };
    const rows = [
      ...pairRows(2022, rex, whiskers, ['10', '10', '10', '11', '11', '11']), // pet-pet, 2022
      ...pairRows(2023, anna, rex, ['10', '10', '10', '11', '11', '11']), // person-pet, 2023
    ];
    const { rule } = ruleWith(rows);
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toHaveLength(2);
    expect(
      result
        .map(
          (c) =>
            `${(c.context as { personAName: string }).personAName} & ${(c.context as { personBName: string }).personBName}`,
        )
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(['Anna & Rex', 'Rex & Whiskers']);
  });

  it('given more than 8 co-occurring photos, then assetIds is capped at 8', async () => {
    const rows = pairRows(2023, anna, ben, ['10', '11', '12', '13', '14', '15', '16', '17', '18', '19']);
    const { rule } = ruleWith(rows);
    const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
    expect(candidate.assetIds).toHaveLength(8);
  });

  it('given the pair rows in reversed input order, then the dedupeKey/person order are identical', async () => {
    const rows = pairRows(2023, anna, ben, ['10', '10', '10', '11', '11', '11']);
    const { rule } = ruleWith(rows.toReversed());
    const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
    expect(candidate).toMatchObject({
      dedupeKey: 'people_together:p1:p2:2023-06',
      context: { personAName: 'Anna', personBName: 'Ben' },
    });
  });

  it('given equal counts in a newer and an older year, then the newer year scores higher', async () => {
    const rows = [
      ...pairRows(2022, anna, ben, ['10', '10', '10', '11', '11', '11']),
      ...pairRows(2023, anna, ben, ['10', '10', '10', '11', '11', '11']),
    ];
    const { rule } = ruleWith(rows);
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toHaveLength(2);
    expect(result[0].context).toMatchObject({ year: 2023 });
    expect(result[0].score).toBe(125); // 100 + 18 + recencyBonus(2023,2026)=7
    expect(result[1].context).toMatchObject({ year: 2022 });
    expect(result[1].score).toBe(124); // 100 + 18 + recencyBonus(2022,2026)=6
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it('given no rows, then returns []', async () => {
    const { rule } = ruleWith([]);
    expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
  });
});
