import { DateTime } from 'luxon';
import { BirthdayMemoryRule } from 'src/services/memory-rules/birthday.rule.js';

describe(BirthdayMemoryRule.name, () => {
  it('creates a snapshot fallback birthday candidate from four single-year assets', async () => {
    const personRepository = {
      forBirthdayMemories: vi
        .fn()
        .mockResolvedValue([
          { personGroupId: 'person-1', name: 'Pierre', birthDate: new Date('1990-04-24T00:00:00Z') },
        ]),
    };
    const assetRepository = {
      getPetPersonGroupIds: vi.fn().mockResolvedValue(new Set()),
      getMemoryAssetsForPerson: vi.fn().mockResolvedValue([
        { id: 'a-1', localDateTime: new Date('2026-04-01T12:00:00Z') },
        { id: 'a-2', localDateTime: new Date('2026-04-02T12:00:00Z') },
        { id: 'a-3', localDateTime: new Date('2026-04-03T12:00:00Z') },
        { id: 'a-4', localDateTime: new Date('2026-04-04T12:00:00Z') },
      ]),
    };

    const rule = new BirthdayMemoryRule(personRepository as never, assetRepository as never);
    const [candidate] = await rule.evaluate({
      ownerId: 'user-1',
      target: DateTime.fromISO('2026-04-24', { zone: 'utc' }),
    });

    expect(candidate).toMatchObject({
      ruleId: 'birthday',
      dedupeKey: 'birthday:person-1:2026-04-24',
      score: 254,
      assetIds: ['a-4', 'a-3', 'a-2', 'a-1'],
      context: { personId: 'person-1', personName: 'Pierre', variant: 'recent', distinctYears: 1 },
    });
    expect(candidate.title).toBeUndefined();
    expect(candidate.subtitle).toBeUndefined();
  });

  it('skips the snapshot fallback when only three single-year assets qualify', async () => {
    const personRepository = {
      forBirthdayMemories: vi
        .fn()
        .mockResolvedValue([
          { personGroupId: 'person-1', name: 'Pierre', birthDate: new Date('1990-04-24T00:00:00Z') },
        ]),
    };
    const assetRepository = {
      getPetPersonGroupIds: vi.fn().mockResolvedValue(new Set()),
      getMemoryAssetsForPerson: vi.fn().mockResolvedValue([
        { id: 'a-1', localDateTime: new Date('2025-04-01T12:00:00Z') },
        { id: 'a-2', localDateTime: new Date('2025-03-01T12:00:00Z') },
        { id: 'a-3', localDateTime: new Date('2025-02-01T12:00:00Z') },
      ]),
    };

    const rule = new BirthdayMemoryRule(personRepository as never, assetRepository as never);
    await expect(
      rule.evaluate({
        ownerId: 'user-1',
        target: DateTime.fromISO('2026-04-24', { zone: 'utc' }),
      }),
    ).resolves.toEqual([]);
  });

  it('uses the four most recent qualifying assets for the snapshot fallback', async () => {
    const personRepository = {
      forBirthdayMemories: vi
        .fn()
        .mockResolvedValue([
          { personGroupId: 'person-1', name: 'Pierre', birthDate: new Date('1990-04-24T00:00:00Z') },
        ]),
    };
    const assetRepository = {
      getPetPersonGroupIds: vi.fn().mockResolvedValue(new Set()),
      getMemoryAssetsForPerson: vi.fn().mockResolvedValue([
        { id: 'a-1', localDateTime: new Date('2026-04-01T12:00:00Z') },
        { id: 'a-2', localDateTime: new Date('2026-04-02T12:00:00Z') },
        { id: 'a-3', localDateTime: new Date('2026-04-03T12:00:00Z') },
        { id: 'a-4', localDateTime: new Date('2026-04-04T12:00:00Z') },
        { id: 'a-5', localDateTime: new Date('2026-04-05T12:00:00Z') },
      ]),
    };

    const rule = new BirthdayMemoryRule(personRepository as never, assetRepository as never);
    const [candidate] = await rule.evaluate({
      ownerId: 'user-1',
      target: DateTime.fromISO('2026-04-24', { zone: 'utc' }),
    });

    expect(candidate).toMatchObject({
      score: 254,
      assetIds: ['a-5', 'a-4', 'a-3', 'a-2'],
      context: { personName: 'Pierre', variant: 'recent' },
    });
  });

  // Upstream's forBirthdayMemories observes a 29 February birthday on 28 February in a non-leap year, so it needs
  // the target's year as well as its month and day.
  it('asks for the people born on the target day of the target year', async () => {
    const personRepository = { forBirthdayMemories: vi.fn().mockResolvedValue([]) };
    const assetRepository = { getPetPersonGroupIds: vi.fn(), getMemoryAssetsForPerson: vi.fn() };

    const rule = new BirthdayMemoryRule(personRepository as never, assetRepository as never);
    await rule.evaluate({ ownerId: 'user-1', target: DateTime.fromISO('2025-02-28', { zone: 'utc' }) });

    expect(personRepository.forBirthdayMemories).toHaveBeenCalledWith('user-1', { year: 2025, month: 2, day: 28 });
    expect(assetRepository.getPetPersonGroupIds).not.toHaveBeenCalled();
  });

  it('skips pets', async () => {
    const personRepository = {
      forBirthdayMemories: vi.fn().mockResolvedValue([
        { personGroupId: 'pet-1', name: 'Rex', birthDate: { year: 2020, month: 4, day: 24 } },
        { personGroupId: 'person-1', name: 'Pierre', birthDate: { year: 1990, month: 4, day: 24 } },
      ]),
    };
    const assetRepository = {
      getPetPersonGroupIds: vi.fn().mockResolvedValue(new Set(['pet-1'])),
      getMemoryAssetsForPerson: vi.fn().mockResolvedValue([
        { id: 'a-1', localDateTime: new Date('2026-04-01T12:00:00Z') },
        { id: 'a-2', localDateTime: new Date('2026-04-02T12:00:00Z') },
        { id: 'a-3', localDateTime: new Date('2026-04-03T12:00:00Z') },
        { id: 'a-4', localDateTime: new Date('2026-04-04T12:00:00Z') },
      ]),
    };

    const rule = new BirthdayMemoryRule(personRepository as never, assetRepository as never);
    const candidates = await rule.evaluate({
      ownerId: 'user-1',
      target: DateTime.fromISO('2026-04-24', { zone: 'utc' }),
    });

    expect(assetRepository.getPetPersonGroupIds).toHaveBeenCalledWith(['pet-1', 'person-1']);
    expect(candidates.map(({ context }) => context?.personId)).toEqual(['person-1']);
    expect(assetRepository.getMemoryAssetsForPerson).toHaveBeenCalledTimes(1);
  });

  it('prefers the throwback path over the snapshot fallback when multiple years qualify', async () => {
    const personRepository = {
      forBirthdayMemories: vi
        .fn()
        .mockResolvedValue([{ personGroupId: 'person-2', name: 'Alice', birthDate: new Date('1990-04-24T00:00:00Z') }]),
    };
    const assetRepository = {
      getPetPersonGroupIds: vi.fn().mockResolvedValue(new Set()),
      getMemoryAssetsForPerson: vi.fn().mockResolvedValue([
        { id: 'a-1', localDateTime: new Date('2025-04-01T12:00:00Z') },
        { id: 'a-2', localDateTime: new Date('2025-03-01T12:00:00Z') },
        { id: 'a-3', localDateTime: new Date('2024-04-01T12:00:00Z') },
        { id: 'a-4', localDateTime: new Date('2023-04-01T12:00:00Z') },
        { id: 'a-5', localDateTime: new Date('2022-04-01T12:00:00Z') },
        { id: 'a-6', localDateTime: new Date('2021-04-01T12:00:00Z') },
      ]),
    };

    const rule = new BirthdayMemoryRule(personRepository as never, assetRepository as never);
    const candidates = await rule.evaluate({
      ownerId: 'user-1',
      target: DateTime.fromISO('2026-04-24', { zone: 'utc' }),
    });

    expect(candidates).toEqual([
      {
        ruleId: 'birthday',
        dedupeKey: 'birthday:person-2:2026-04-24',
        score: 356,
        assetIds: ['a-1', 'a-2', 'a-3', 'a-4', 'a-5', 'a-6'],
        memoryAt: DateTime.fromISO('2026-04-24', { zone: 'utc' }),
        context: { personId: 'person-2', personName: 'Alice', variant: 'across_years', distinctYears: 5 },
      },
    ]);
  });
});
