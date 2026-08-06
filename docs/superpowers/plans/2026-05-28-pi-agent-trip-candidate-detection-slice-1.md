# Pi Agent Trip Candidate Detection Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the reusable recent-trip detection core into `TripCandidateService` while preserving current recent-trip memory behavior.

**Architecture:** Slice 1 creates a standalone domain service that detects one-city recent trip candidates from the existing memory location cluster repositories. `RecentTripMemoryRule` consumes that service but keeps memory-specific cooldown, daily cap interaction, title/dedupe formatting, and representative memory asset selection.

**Tech Stack:** TypeScript, Luxon, Vitest, existing Gallery server service/repository patterns.

---

## Scope

Spec: `docs/superpowers/specs/2026-05-28-pi-agent-trip-candidate-detection-design.md`

Slice 1 only implements the "Trip Candidate Service Extraction" tests from the spec:

- Detects a single non-home trip using baseline and recent location buckets.
- Returns no high-confidence trip for home-only recent assets.
- Handles ambiguous home baseline by lowering confidence instead of crashing.
- Generates stable dedupe keys for the same trip window.
- Keeps `RecentTripMemoryRule` conservative: low-confidence candidates are not converted into memory cards.
- Preserves recent-trip memory cooldown and daily cap behavior.

Out of scope for this slice:

- Multi-day date-window merging beyond the existing `country + city` cluster behavior.
- Multi-country trips.
- Album-ready duplicate/stack exclusion.
- `findTripCandidates` MCP tool.
- Pi runner prompt changes.

## Files

- Create: `server/src/services/trip-candidate.service.ts`
- Create: `server/src/services/trip-candidate.service.spec.ts`
- Modify: `server/src/services/memory-rules/recent-trip.rule.ts`
- Modify: `server/src/services/memory-rules/recent-trip.rule.spec.ts`

## Baseline Command

- [ ] **Step 1: Verify focused recent-trip rule baseline**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/memory-rules/recent-trip.rule.spec.ts --run
```

Expected: `src/services/memory-rules/recent-trip.rule.spec.ts` passes. If the broad server suite shows the pre-existing `agent-runner-flow.integration.spec.ts` invoice OCR failure, do not fix it in this slice.

## Task 1: Add TripCandidateService Tests

**Files:**

- Create: `server/src/services/trip-candidate.service.spec.ts`

- [ ] **Step 1: Write failing service tests**

Create `server/src/services/trip-candidate.service.spec.ts`:

```ts
import { DateTime } from 'luxon';
import { TripCandidateService } from 'src/services/trip-candidate.service';

const cluster = ({
  country,
  city,
  assetCount,
  dayCount,
  firstDate = '2026-04-15T00:00:00Z',
  lastDate = '2026-04-17T00:00:00Z',
}: {
  country: string | null;
  city: string | null;
  assetCount: number;
  dayCount: number;
  firstDate?: string;
  lastDate?: string;
}) => ({
  country,
  city,
  assetCount,
  dayCount,
  firstDate: new Date(firstDate),
  lastDate: new Date(lastDate),
});

const setup = () => {
  const assetRepository = {
    getMemoryLocationClusters: vi.fn(),
  };
  return { assetRepository, sut: new TripCandidateService(assetRepository as never) };
};

describe(TripCandidateService.name, () => {
  it('detects a high-confidence non-home trip from baseline and recent clusters', async () => {
    const { assetRepository, sut } = setup();
    assetRepository.getMemoryLocationClusters
      .mockResolvedValueOnce([cluster({ country: 'Germany', city: 'Berlin', assetCount: 20, dayCount: 12 })])
      .mockResolvedValueOnce([cluster({ country: 'France', city: 'Paris', assetCount: 9, dayCount: 3 })]);

    const [candidate] = await sut.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
      lookbackDays: 30,
      maxCandidates: 3,
    });

    expect(assetRepository.getMemoryLocationClusters).toHaveBeenCalledWith('user-1', {
      takenAfter: new Date('2025-12-24T00:00:00.000Z'),
      takenBefore: new Date('2026-03-23T23:59:59.999Z'),
    });
    expect(assetRepository.getMemoryLocationClusters).toHaveBeenCalledWith('user-1', {
      takenAfter: new Date('2026-03-24T00:00:00.000Z'),
      takenBefore: new Date('2026-04-23T23:59:59.999Z'),
    });
    expect(candidate).toMatchObject({
      dedupeKey: 'trip:france:paris:2026-04-15:2026-04-17',
      title: 'Recent trip to Paris, France',
      subtitle: '9 photos over 3 days',
      countries: ['France'],
      states: [],
      cities: ['Paris'],
      assetCount: 9,
      albumAssetCount: 9,
      excludedDuplicateCount: 0,
      dayCount: 3,
      confidence: 'high',
      placeKey: 'france:paris',
      placeLabel: 'Paris, France',
      source: {
        kind: 'tripCandidate',
        dedupeKey: 'trip:france:paris:2026-04-15:2026-04-17',
        takenAfter: new Date('2026-04-15T00:00:00Z'),
        takenBefore: new Date('2026-04-17T00:00:00Z'),
        places: [{ country: 'France', city: 'Paris' }],
        placeLabels: ['Paris, France'],
      },
    });
    expect(candidate?.score).toBe(74);
  });

  it('returns no candidates for home-only recent clusters', async () => {
    const { assetRepository, sut } = setup();
    assetRepository.getMemoryLocationClusters
      .mockResolvedValueOnce([cluster({ country: 'Germany', city: 'Berlin', assetCount: 20, dayCount: 12 })])
      .mockResolvedValueOnce([cluster({ country: 'Germany', city: 'Berlin', assetCount: 11, dayCount: 4 })]);

    await expect(
      sut.findRecentTripCandidates({
        ownerId: 'user-1',
        targetDate: new Date('2026-04-23T12:00:00Z'),
        lookbackDays: 30,
      }),
    ).resolves.toEqual([]);
  });

  it('returns low-confidence candidates instead of failing when the home baseline is ambiguous', async () => {
    const { assetRepository, sut } = setup();
    assetRepository.getMemoryLocationClusters
      .mockResolvedValueOnce([
        cluster({ country: 'Germany', city: 'Berlin', assetCount: 10, dayCount: 6 }),
        cluster({ country: 'Austria', city: 'Vienna', assetCount: 9, dayCount: 6 }),
      ])
      .mockResolvedValueOnce([cluster({ country: 'France', city: 'Paris', assetCount: 8, dayCount: 2 })]);

    const [candidate] = await sut.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
      lookbackDays: 30,
    });

    expect(candidate).toMatchObject({
      title: 'Recent trip to Paris, France',
      confidence: 'low',
      score: 48,
    });
  });

  it('generates stable dedupe keys from place and trip window rather than evaluation date', async () => {
    const { assetRepository, sut } = setup();
    assetRepository.getMemoryLocationClusters
      .mockResolvedValue([cluster({ country: 'Germany', city: 'Berlin', assetCount: 20, dayCount: 12 })])
      .mockResolvedValueOnce([cluster({ country: 'Germany', city: 'Berlin', assetCount: 20, dayCount: 12 })])
      .mockResolvedValueOnce([
        cluster({
          country: 'France',
          city: 'Paris',
          assetCount: 9,
          dayCount: 3,
          firstDate: '2026-04-15T00:00:00Z',
          lastDate: '2026-04-17T00:00:00Z',
        }),
      ])
      .mockResolvedValueOnce([cluster({ country: 'Germany', city: 'Berlin', assetCount: 20, dayCount: 12 })])
      .mockResolvedValueOnce([
        cluster({
          country: 'France',
          city: 'Paris',
          assetCount: 9,
          dayCount: 3,
          firstDate: '2026-04-15T00:00:00Z',
          lastDate: '2026-04-17T00:00:00Z',
        }),
      ]);

    const first = await sut.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
      lookbackDays: 30,
    });
    const second = await sut.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-24T12:00:00Z'),
      lookbackDays: 30,
    });

    expect(first[0]?.dedupeKey).toBe('trip:france:paris:2026-04-15:2026-04-17');
    expect(second[0]?.dedupeKey).toBe('trip:france:paris:2026-04-15:2026-04-17');
  });
});
```

- [ ] **Step 2: Run service tests red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/trip-candidate.service.spec.ts --run
```

Expected: FAIL because `src/services/trip-candidate.service` does not exist.

## Task 2: Implement TripCandidateService

**Files:**

- Create: `server/src/services/trip-candidate.service.ts`

- [ ] **Step 1: Add the minimal service implementation**

Create `server/src/services/trip-candidate.service.ts`:

```ts
import { DateTime } from 'luxon';
import { AssetRepository, MemoryLocationCluster } from 'src/repositories/asset.repository';

type TripCandidateConfidence = 'high' | 'medium' | 'low';

export interface TripCandidateRequest {
  ownerId: string;
  targetDate?: Date;
  lookbackDays?: number;
  baselineDays?: number;
  maxCandidates?: number;
}

export interface TripCandidateSource {
  kind: 'tripCandidate';
  dedupeKey: string;
  takenAfter: Date;
  takenBefore: Date;
  places: Array<{
    country: string;
    state?: string | null;
    city?: string | null;
  }>;
  placeLabels: string[];
}

export interface TripCandidate {
  dedupeKey: string;
  title: string;
  subtitle: string;
  countries: string[];
  states: string[];
  cities: string[];
  takenAfter: Date;
  takenBefore: Date;
  assetCount: number;
  albumAssetCount: number;
  excludedDuplicateCount: number;
  dayCount: number;
  score: number;
  confidence: TripCandidateConfidence;
  source: TripCandidateSource;
  placeKey: string;
  placeLabel: string;
}

type HomeBaseline =
  | { status: 'confident'; home: MemoryLocationCluster }
  | { status: 'ambiguous'; home?: MemoryLocationCluster };

export class TripCandidateService {
  private static readonly HOME_DOMINANCE_RATIO = 1.25;
  private static readonly DEFAULT_LOOKBACK_DAYS = 30;
  private static readonly DEFAULT_BASELINE_DAYS = 90;
  private static readonly DEFAULT_MAX_CANDIDATES = 3;

  constructor(private assetRepository: Pick<AssetRepository, 'getMemoryLocationClusters'>) {}

  async findRecentTripCandidates({
    ownerId,
    targetDate,
    lookbackDays = TripCandidateService.DEFAULT_LOOKBACK_DAYS,
    baselineDays = TripCandidateService.DEFAULT_BASELINE_DAYS,
    maxCandidates = TripCandidateService.DEFAULT_MAX_CANDIDATES,
  }: TripCandidateRequest): Promise<TripCandidate[]> {
    const target = DateTime.fromJSDate(targetDate ?? new Date(), { zone: 'utc' }).endOf('day');
    const recentFrom = target.minus({ days: lookbackDays }).startOf('day');
    const baselineFrom = recentFrom.minus({ days: baselineDays });
    const baselineTo = recentFrom.minus({ days: 1 }).endOf('day');

    const [baseline, recent] = await Promise.all([
      this.assetRepository.getMemoryLocationClusters(ownerId, {
        takenAfter: baselineFrom.toJSDate(),
        takenBefore: baselineTo.toJSDate(),
      }),
      this.assetRepository.getMemoryLocationClusters(ownerId, {
        takenAfter: recentFrom.toJSDate(),
        takenBefore: target.toJSDate(),
      }),
    ]);

    const homeBaseline = this.resolveHomeBaseline(baseline);
    return recent
      .filter((item) => this.isCandidateLocation(item, homeBaseline))
      .map((item) => this.mapCandidate(item, homeBaseline.status === 'confident' ? 'high' : 'low'))
      .toSorted((left, right) => right.score - left.score)
      .slice(0, maxCandidates);
  }

  private resolveHomeBaseline(baseline: MemoryLocationCluster[]): HomeBaseline {
    const [home, runnerUp] = baseline;
    if (!home?.country) {
      return { status: 'ambiguous', home };
    }

    const isAmbiguous =
      !!runnerUp &&
      runnerUp.country !== home.country &&
      runnerUp.assetCount >= home.assetCount / TripCandidateService.HOME_DOMINANCE_RATIO;

    return isAmbiguous ? { status: 'ambiguous', home } : { status: 'confident', home };
  }

  private isCandidateLocation(item: MemoryLocationCluster, homeBaseline: HomeBaseline): boolean {
    if (!item.country || item.assetCount < 7 || item.dayCount < 2) {
      return false;
    }

    if (homeBaseline.status === 'ambiguous') {
      return true;
    }

    const { home } = homeBaseline;
    if (item.country !== home.country) {
      return true;
    }

    return !!home.city && !!item.city && item.city !== home.city;
  }

  private mapCandidate(item: MemoryLocationCluster, confidence: TripCandidateConfidence): TripCandidate {
    const placeKey = `${item.country}:${item.city ?? ''}`.toLowerCase();
    const placeLabel = item.city ? `${item.city}, ${item.country}` : item.country!;
    const dedupeKey = `trip:${placeKey}:${this.dayKey(item.firstDate)}:${this.dayKey(item.lastDate)}`;
    const score = this.scoreCandidate(item, confidence);

    return {
      dedupeKey,
      title: `Recent trip to ${placeLabel}`,
      subtitle: `${item.assetCount} photos over ${item.dayCount} days`,
      countries: [item.country!],
      states: [],
      cities: item.city ? [item.city] : [],
      takenAfter: item.firstDate,
      takenBefore: item.lastDate,
      assetCount: item.assetCount,
      albumAssetCount: item.assetCount,
      excludedDuplicateCount: 0,
      dayCount: item.dayCount,
      score,
      confidence,
      source: {
        kind: 'tripCandidate',
        dedupeKey,
        takenAfter: item.firstDate,
        takenBefore: item.lastDate,
        places: [{ country: item.country!, city: item.city }],
        placeLabels: [placeLabel],
      },
      placeKey,
      placeLabel,
    };
  }

  private scoreCandidate(item: MemoryLocationCluster, confidence: TripCandidateConfidence): number {
    const base = 50 + item.dayCount * 5 + Math.min(item.assetCount, 20);
    return confidence === 'low' ? Math.max(1, base - 20) : base;
  }

  private dayKey(value: Date): string {
    return DateTime.fromJSDate(value, { zone: 'utc' }).toFormat('yyyy-MM-dd');
  }
}
```

- [ ] **Step 2: Run service tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/trip-candidate.service.spec.ts --run
```

Expected: PASS for all `TripCandidateService` tests.

## Task 3: Refactor RecentTripMemoryRule To Use TripCandidateService

**Files:**

- Modify: `server/src/services/memory-rules/recent-trip.rule.spec.ts`
- Modify: `server/src/services/memory-rules/recent-trip.rule.ts`

- [ ] **Step 1: Add failing memory-rule integration tests**

Append these tests inside `describe(RecentTripMemoryRule.name, () => { ... })` in `server/src/services/memory-rules/recent-trip.rule.spec.ts`:

```ts
it('uses TripCandidateService and keeps memory cards limited to high-confidence candidates', async () => {
  const assetRepository = {
    getMemoryLocationClusters: vi.fn(),
    getMemoryAssetsForLocation: vi.fn(),
  };
  const memoryRepository = { search: vi.fn().mockResolvedValue([]) };
  const tripCandidateService = {
    findRecentTripCandidates: vi.fn().mockResolvedValue([
      {
        confidence: 'low',
        country: 'France',
        city: 'Paris',
        placeKey: 'france:paris',
        placeLabel: 'Paris, France',
        title: 'Recent trip to Paris, France',
        subtitle: '8 photos over 2 days',
        score: 68,
        assetCount: 8,
        dayCount: 2,
        takenAfter: new Date('2026-04-15T00:00:00Z'),
        takenBefore: new Date('2026-04-16T00:00:00Z'),
        source: {
          places: [{ country: 'France', city: 'Paris' }],
        },
      },
    ]),
  };

  const rule = new RecentTripMemoryRule(
    assetRepository as never,
    memoryRepository as never,
    tripCandidateService as never,
  );
  await expect(
    rule.evaluate({
      ownerId: 'user-1',
      target: DateTime.fromISO('2026-04-23', { zone: 'utc' }),
    }),
  ).resolves.toEqual([]);

  expect(tripCandidateService.findRecentTripCandidates).toHaveBeenCalledWith({
    ownerId: 'user-1',
    targetDate: new Date('2026-04-23T00:00:00.000Z'),
    lookbackDays: 30,
    maxCandidates: 3,
  });
  expect(assetRepository.getMemoryAssetsForLocation).not.toHaveBeenCalled();
});

it('preserves recent-trip memory output while using a high-confidence trip candidate', async () => {
  const assetRepository = {
    getMemoryLocationClusters: vi.fn(),
    getMemoryAssetsForLocation: vi
      .fn()
      .mockResolvedValue([
        makeAsset('asset-1', '2026-04-15T09:00:00Z'),
        makeAsset('asset-2', '2026-04-16T09:00:00Z'),
        makeAsset('asset-3', '2026-04-17T09:00:00Z'),
      ]),
  };
  const memoryRepository = { search: vi.fn().mockResolvedValue([]) };
  const tripCandidateService = {
    findRecentTripCandidates: vi.fn().mockResolvedValue([
      {
        confidence: 'high',
        placeKey: 'france:paris',
        placeLabel: 'Paris, France',
        title: 'Recent trip to Paris, France',
        subtitle: '9 photos over 3 days',
        score: 85,
        assetCount: 9,
        dayCount: 3,
        takenAfter: new Date('2026-04-15T00:00:00Z'),
        takenBefore: new Date('2026-04-17T00:00:00Z'),
        source: {
          places: [{ country: 'France', city: 'Paris' }],
        },
      },
    ]),
  };

  const rule = new RecentTripMemoryRule(
    assetRepository as never,
    memoryRepository as never,
    tripCandidateService as never,
  );
  const [candidate] = await rule.evaluate({
    ownerId: 'user-1',
    target: DateTime.fromISO('2026-04-23', { zone: 'utc' }),
  });

  expect(memoryRepository.search).toHaveBeenCalledWith('user-1', {
    type: MemoryType.Rule,
    size: 20,
    order: AssetOrder.Desc,
  });
  expect(assetRepository.getMemoryAssetsForLocation).toHaveBeenCalledWith('user-1', {
    country: 'France',
    city: 'Paris',
    takenAfter: new Date('2026-03-24T00:00:00.000Z'),
    takenBefore: new Date('2026-04-23T23:59:59.999Z'),
  });
  expect(candidate).toMatchObject({
    ruleId: 'recent_trip',
    dedupeKey: 'recent_trip:france:paris:2026-04-23',
    title: 'Recent trip to Paris, France',
    subtitle: '9 photos over 3 days',
    score: 85,
    assetIds: ['asset-1', 'asset-2', 'asset-3'],
    context: {
      placeKey: 'france:paris',
      placeLabel: 'Paris, France',
      country: 'France',
      city: 'Paris',
      assetCount: 9,
      dayCount: 3,
    },
  });
});

it('keeps the same-place cooldown after trip candidate extraction', async () => {
  const assetRepository = {
    getMemoryLocationClusters: vi.fn(),
    getMemoryAssetsForLocation: vi.fn(),
  };
  const memoryRepository = {
    search: vi.fn().mockResolvedValue([
      {
        type: MemoryType.Rule,
        memoryAt: new Date('2026-04-10T00:00:00Z'),
        data: { ruleId: 'recent_trip', context: { placeKey: 'france:paris' } },
      },
    ]),
  };
  const tripCandidateService = {
    findRecentTripCandidates: vi.fn().mockResolvedValue([
      {
        confidence: 'high',
        placeKey: 'france:paris',
        placeLabel: 'Paris, France',
        title: 'Recent trip to Paris, France',
        subtitle: '9 photos over 3 days',
        score: 85,
        assetCount: 9,
        dayCount: 3,
        takenAfter: new Date('2026-04-15T00:00:00Z'),
        takenBefore: new Date('2026-04-17T00:00:00Z'),
        source: {
          places: [{ country: 'France', city: 'Paris' }],
        },
      },
    ]),
  };

  const rule = new RecentTripMemoryRule(
    assetRepository as never,
    memoryRepository as never,
    tripCandidateService as never,
  );

  await expect(
    rule.evaluate({
      ownerId: 'user-1',
      target: DateTime.fromISO('2026-04-23', { zone: 'utc' }),
    }),
  ).resolves.toEqual([]);
  expect(assetRepository.getMemoryAssetsForLocation).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run memory-rule tests red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/memory-rules/recent-trip.rule.spec.ts --run
```

Expected: FAIL because `RecentTripMemoryRule` does not call the injected `TripCandidateService`.

- [ ] **Step 3: Refactor RecentTripMemoryRule**

Modify `server/src/services/memory-rules/recent-trip.rule.ts`:

```ts
import { DateTime } from 'luxon';
import { AssetOrderWithRandom, MemoryType } from 'src/enum';
import { AssetRepository, MemoryAsset } from 'src/repositories/asset.repository';
import { MemoryRepository } from 'src/repositories/memory.repository';
import { MemoryRule, MemoryRuleCandidate, MemoryRuleContext } from 'src/services/memory-rules/memory-rule.interface';
import { TripCandidateService } from 'src/services/trip-candidate.service';
```

Update the class constants and constructor:

```ts
export class RecentTripMemoryRule implements MemoryRule {
  readonly id = 'recent_trip';
  private static readonly BURST_WINDOW_MS = 2 * 60 * 1000;
  private static readonly SMALL_TRIP_MAX = 6;

  constructor(
    private assetRepository: Pick<AssetRepository, 'getMemoryLocationClusters' | 'getMemoryAssetsForLocation'>,
    private memoryRepository: Pick<MemoryRepository, 'search'>,
    private tripCandidateService = new TripCandidateService(assetRepository),
  ) {}
```

Replace the first half of `evaluate()` with:

```ts
  async evaluate({ ownerId, target }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> {
    const recentFrom = target.minus({ days: 30 }).startOf('day');
    const recentTo = target.endOf('day');

    const [tripCandidates, recentRuleMemories] = await Promise.all([
      this.tripCandidateService.findRecentTripCandidates({
        ownerId,
        targetDate: target.startOf('day').toJSDate(),
        lookbackDays: 30,
        maxCandidates: 3,
      }),
      this.memoryRepository.search(ownerId, {
        type: MemoryType.Rule,
        size: 20,
        order: AssetOrderWithRandom.Desc,
      }),
    ]);

    const candidate = tripCandidates.find((item) => item.confidence === 'high');
    if (!candidate) {
      return [];
    }

    const isCoolingDown = recentRuleMemories.some((memory) => {
      const data = memory.data as Record<string, unknown>;
      if (data.ruleId !== this.id) {
        return false;
      }

      const context = data.context as Record<string, unknown> | undefined;
      const seenPlaceKey = typeof context?.placeKey === 'string' ? context.placeKey : undefined;
      return seenPlaceKey === candidate.placeKey && DateTime.fromJSDate(memory.memoryAt) >= target.minus({ days: 30 });
    });

    if (isCoolingDown) {
      return [];
    }

    const [place] = candidate.source.places;
    if (!place?.country) {
      return [];
    }

    const locationAssets = await this.assetRepository.getMemoryAssetsForLocation(ownerId, {
      country: place.country,
      city: place.city ?? null,
      takenAfter: recentFrom.toJSDate(),
      takenBefore: recentTo.toJSDate(),
    });
    const assetIds = this.curateTripAssets(locationAssets);
```

Replace the returned candidate object with:

```ts
    return [
      {
        ruleId: this.id,
        dedupeKey: `recent_trip:${candidate.placeKey}:${target.toFormat('yyyy-MM-dd')}`,
        title: candidate.title,
        subtitle: candidate.subtitle,
        score: candidate.score,
        assetIds,
        memoryAt: target,
        context: {
          placeKey: candidate.placeKey,
          placeLabel: candidate.placeLabel,
          country: place.country,
          city: place.city ?? null,
          assetCount: candidate.assetCount,
          dayCount: candidate.dayCount,
          tripWindowStart: candidate.takenAfter.toISOString(),
          tripWindowEnd: candidate.takenBefore.toISOString(),
        },
      },
    ];
  }
```

Remove the old `HOME_DOMINANCE_RATIO` constant and the private `isTripCandidate()` method from `RecentTripMemoryRule`. Keep `curateTripAssets`, `collapseBurstAssets`, `groupAssetsByDay`, `getTripTargetSize`, `pickDayCoverage`, and `pickEvenlySpaced` in the memory rule.

- [ ] **Step 4: Run memory-rule tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/memory-rules/recent-trip.rule.spec.ts --run
```

Expected: PASS for all `RecentTripMemoryRule` tests.

## Task 4: Verify Slice 1 And Commit

**Files:**

- Verify all files from Tasks 1-3.

- [ ] **Step 1: Run focused Slice 1 tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/trip-candidate.service.spec.ts src/services/memory-rules/recent-trip.rule.spec.ts --run
```

Expected: PASS for both spec files.

- [ ] **Step 2: Run memory service regression tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/memory.service.spec.ts --run
```

Expected: PASS. This verifies the daily rule cap and config gating still work after `RecentTripMemoryRule` consumes `TripCandidateService`.

- [ ] **Step 3: Run TypeScript check for server**

Run:

```bash
pnpm --dir server check
```

Expected: PASS.

- [ ] **Step 4: Run diff whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Commit Slice 1**

Run:

```bash
git add server/src/services/trip-candidate.service.ts server/src/services/trip-candidate.service.spec.ts server/src/services/memory-rules/recent-trip.rule.ts server/src/services/memory-rules/recent-trip.rule.spec.ts
git commit -m "feat: extract trip candidate detection service"
```

Expected: one commit containing only Slice 1 implementation and tests.

## Plan Self-Review

- Spec coverage: Slice 1 requirements are covered by service tests plus memory-rule regression tests. Later slices are not implemented.
- TDD: Each behavior starts with failing tests, red command, minimal implementation, green command.
- Edge cases covered in this slice: home-only recent assets, ambiguous home baseline, stable dedupe key, low-confidence memory suppression, cooldown preservation via existing tests.
- Type consistency: `TripCandidateService`, `TripCandidate`, and `TripCandidateSource` are defined before `RecentTripMemoryRule` consumes them.
- Placeholder scan: no placeholder terms remain.
