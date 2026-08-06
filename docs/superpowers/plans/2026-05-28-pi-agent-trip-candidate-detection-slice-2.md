# Pi Agent Trip Candidate Detection Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace one-cluster trip detection with contiguous day/place trip windows that can represent multi-city and multi-country trips.

**Architecture:** Add a repository query that returns location buckets per UTC day and place. `TripCandidateService` keeps Slice 1 cluster fallback behavior for tests and older mocks, but uses day buckets when the repository provides them, then merges travel buckets into candidate windows with a one no-photo day gap allowance. Album materialization, place-hint filtering, MCP responses, and Pi prompt integration stay out of scope.

**Tech Stack:** TypeScript, Luxon, Kysely/Postgres, Vitest unit tests, existing medium repository tests and generated SQL snapshots.

---

## Scope

Spec: `docs/superpowers/specs/2026-05-28-pi-agent-trip-candidate-detection-design.md`

Slice 2 implements:

- Day/place bucketing for previewable timeline assets.
- Window merging for adjacent travel days.
- One no-photo-day gap inside a trip window.
- Separate candidates for clearly separated trips, including repeated trips to the same place.
- Multi-country candidate shape for continuous cross-border trips.
- Deduplicated country/city/place label summaries.

Out of scope:

- `placeHint` request handling and place-hint score boosts. Slice 4 owns label normalization and hint filtering.
- Album-ready duplicate/stack exclusion and selection handles. Slice 3 owns materialization counts.
- MCP tool responses and Pi runner behavior.

## Files

- Modify: `server/src/repositories/asset.repository.ts`
- Modify: `server/src/queries/asset.repository.sql`
- Modify: `server/test/repositories/asset.repository.mock.ts`
- Modify: `server/test/medium/specs/repositories/asset.repository.spec.ts`
- Modify: `server/src/services/trip-candidate.service.ts`
- Modify: `server/src/services/trip-candidate.service.spec.ts`

## Baseline Commands

- [ ] **Step 1: Verify Slice 1 focused baseline**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/trip-candidate.service.spec.ts src/services/memory-rules/recent-trip.rule.spec.ts --run
```

Expected: PASS, 16 tests.

- [ ] **Step 2: Verify repository baseline**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/asset.repository.spec.ts --run
```

Expected: PASS. If the local medium-test database is unavailable, report the blocker before implementation.

## Task 1: Add Day/Place Bucket Repository Coverage

**Files:**

- Modify: `server/test/medium/specs/repositories/asset.repository.spec.ts`

- [ ] **Step 1: Write the failing repository test**

Append this `describe` block after `getMemoryLocationClusters` and before `getMemoryAssetsForLocation`:

```ts
describe('getMemoryLocationDayBuckets', () => {
  it('should group previewable timeline assets by UTC day, country, state, and city', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    const addAsset = async ({
      localDateTime,
      country,
      state = null,
      city,
      visibility = AssetVisibility.Timeline,
      withPreview = true,
    }: {
      localDateTime: Date;
      country: string | null;
      state?: string | null;
      city: string | null;
      visibility?: AssetVisibility;
      withPreview?: boolean;
    }) => {
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility, localDateTime });
      await Promise.all([
        ctx.newExif({ assetId: asset.id, country, state, city }),
        withPreview
          ? ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: `${asset.id}.jpg` })
          : null,
      ]);
    };

    await addAsset({
      localDateTime: new Date('2026-04-15T09:00:00Z'),
      country: 'France',
      state: 'Ile-de-France',
      city: 'Paris',
    });
    await addAsset({
      localDateTime: new Date('2026-04-15T17:00:00Z'),
      country: 'France',
      state: 'Ile-de-France',
      city: 'Paris',
    });
    await addAsset({
      localDateTime: new Date('2026-04-16T10:00:00Z'),
      country: 'France',
      state: 'Auvergne-Rhone-Alpes',
      city: 'Lyon',
    });
    await addAsset({
      localDateTime: new Date('2026-04-17T10:00:00Z'),
      country: 'Italy',
      state: 'Lazio',
      city: 'Rome',
    });
    await addAsset({
      localDateTime: new Date('2026-04-18T10:00:00Z'),
      country: 'France',
      city: 'Paris',
      withPreview: false,
    });
    await addAsset({
      localDateTime: new Date('2026-04-19T10:00:00Z'),
      country: null,
      city: null,
    });
    await addAsset({
      localDateTime: new Date('2026-04-20T10:00:00Z'),
      country: 'France',
      city: 'Nice',
      visibility: AssetVisibility.Archive,
    });

    await expect(
      sut.getMemoryLocationDayBuckets(user.id, {
        takenAfter: new Date('2026-04-01T00:00:00Z'),
        takenBefore: new Date('2026-04-30T23:59:59Z'),
      }),
    ).resolves.toEqual([
      {
        localDate: new Date('2026-04-15T00:00:00.000Z'),
        country: 'France',
        state: 'Ile-de-France',
        city: 'Paris',
        assetCount: 2,
        firstDate: new Date('2026-04-15T09:00:00.000Z'),
        lastDate: new Date('2026-04-15T17:00:00.000Z'),
      },
      {
        localDate: new Date('2026-04-16T00:00:00.000Z'),
        country: 'France',
        state: 'Auvergne-Rhone-Alpes',
        city: 'Lyon',
        assetCount: 1,
        firstDate: new Date('2026-04-16T10:00:00.000Z'),
        lastDate: new Date('2026-04-16T10:00:00.000Z'),
      },
      {
        localDate: new Date('2026-04-17T00:00:00.000Z'),
        country: 'Italy',
        state: 'Lazio',
        city: 'Rome',
        assetCount: 1,
        firstDate: new Date('2026-04-17T10:00:00.000Z'),
        lastDate: new Date('2026-04-17T10:00:00.000Z'),
      },
    ]);
  });
});
```

- [ ] **Step 2: Run repository test red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/asset.repository.spec.ts --run
```

Expected: FAIL because `AssetRepository.getMemoryLocationDayBuckets` does not exist.

## Task 2: Implement Day/Place Bucket Repository Method

**Files:**

- Modify: `server/src/repositories/asset.repository.ts`
- Modify: `server/test/repositories/asset.repository.mock.ts`
- Modify: `server/src/queries/asset.repository.sql`

- [ ] **Step 1: Add the repository interface and method**

In `server/src/repositories/asset.repository.ts`, add this interface after `MemoryLocationCluster`:

```ts
export interface MemoryLocationDayBucket {
  localDate: Date;
  country: string | null;
  state: string | null;
  city: string | null;
  assetCount: number;
  firstDate: Date;
  lastDate: Date;
}
```

Add this method immediately after `getMemoryLocationClusters`:

```ts
  @GenerateSql({ params: [DummyValue.UUID, { takenAfter: DummyValue.DATE, takenBefore: DummyValue.DATE }] })
  getMemoryLocationDayBuckets(
    ownerId: string,
    { takenAfter, takenBefore }: { takenAfter: Date; takenBefore: Date },
  ): Promise<MemoryLocationDayBucket[]> {
    const localDate = sql<Date>`date_trunc('day', asset."localDateTime" at time zone 'UTC') at time zone 'UTC'`;

    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        localDate.as('localDate'),
        'asset_exif.country as country',
        'asset_exif.state as state',
        'asset_exif.city as city',
        sql<number>`count(*)::int`.as('assetCount'),
        sql<Date>`min(asset."localDateTime")`.as('firstDate'),
        sql<Date>`max(asset."localDateTime")`.as('lastDate'),
      ])
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '>=', takenAfter)
      .where('asset.localDateTime', '<=', takenBefore)
      .where('asset_exif.country', 'is not', null)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .groupBy([localDate, 'asset_exif.country', 'asset_exif.state', 'asset_exif.city'])
      .orderBy('localDate', 'asc')
      .orderBy('assetCount', 'desc')
      .execute();
  }
```

In `server/test/repositories/asset.repository.mock.ts`, add:

```ts
    getMemoryLocationDayBuckets: vitest.fn(),
```

immediately after `getMemoryLocationClusters`.

- [ ] **Step 2: Regenerate SQL snapshot**

Run:

```bash
pnpm --dir server build
pnpm --dir server sync:sql
```

Expected: `server/src/queries/asset.repository.sql` gains an `AssetRepository.getMemoryLocationDayBuckets` query.

- [ ] **Step 3: Run repository test green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/asset.repository.spec.ts --run
```

Expected: PASS, including the new bucket test.

## Task 3: Add Trip Window Service Tests

**Files:**

- Modify: `server/src/services/trip-candidate.service.spec.ts`

- [ ] **Step 1: Update service test helpers for day buckets**

Add this helper below the existing `cluster` helper:

```ts
const dayBucket = ({
  localDate,
  country,
  state = null,
  city,
  assetCount,
  firstDate = `${localDate}T09:00:00Z`,
  lastDate = `${localDate}T17:00:00Z`,
}: {
  localDate: string;
  country: string | null;
  state?: string | null;
  city: string | null;
  assetCount: number;
  firstDate?: string;
  lastDate?: string;
}) => ({
  localDate: new Date(`${localDate}T00:00:00Z`),
  country,
  state,
  city,
  assetCount,
  firstDate: new Date(firstDate),
  lastDate: new Date(lastDate),
});

const setup = () => {
  const assetRepository = {
    getMemoryLocationClusters: vi.fn(),
    getMemoryLocationDayBuckets: vi.fn(),
  };

  return { assetRepository, service: new TripCandidateService(assetRepository) };
};
```

Then update existing tests to use `setup()` and make recent data come from `getMemoryLocationDayBuckets`. For the first high-confidence test, keep the existing baseline assertion and replace the recent assertion with:

```ts
expect(assetRepository.getMemoryLocationDayBuckets).toHaveBeenCalledWith('user-1', {
  takenAfter: new Date('2026-03-24T00:00:00.000Z'),
  takenBefore: new Date('2026-04-23T23:59:59.999Z'),
});
```

Use these recent day buckets for the existing service tests so their current assertions remain meaningful:

```ts
// Existing high-confidence non-home trip test
assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
  cluster({ country: 'Germany', city: 'Berlin', assetCount: 20, dayCount: 12 }),
]);
assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
  dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 3 }),
  dayBucket({ localDate: '2026-04-16', country: 'France', city: 'Paris', assetCount: 3 }),
  dayBucket({ localDate: '2026-04-17', country: 'France', city: 'Paris', assetCount: 3 }),
]);

// Existing home-only test
assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
  cluster({ country: 'Germany', city: 'Berlin', assetCount: 20, dayCount: 12 }),
]);
assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
  dayBucket({ localDate: '2026-04-15', country: 'Germany', city: 'Berlin', assetCount: 4 }),
  dayBucket({ localDate: '2026-04-16', country: 'Germany', city: 'Berlin', assetCount: 4 }),
  dayBucket({ localDate: '2026-04-17', country: 'Germany', city: 'Berlin', assetCount: 3 }),
]);

// Existing ambiguous-home test
assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
  cluster({ country: 'Germany', city: 'Berlin', assetCount: 10, dayCount: 6 }),
  cluster({ country: 'Austria', city: 'Vienna', assetCount: 9, dayCount: 6 }),
]);
assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
  dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 4 }),
  dayBucket({ localDate: '2026-04-16', country: 'France', city: 'Paris', assetCount: 4 }),
]);

// Existing stable-dedupe test: mock two service calls.
assetRepository.getMemoryLocationClusters
  .mockResolvedValueOnce([cluster({ country: 'Germany', city: 'Berlin', assetCount: 20, dayCount: 12 })])
  .mockResolvedValueOnce([cluster({ country: 'Germany', city: 'Berlin', assetCount: 20, dayCount: 12 })]);
assetRepository.getMemoryLocationDayBuckets
  .mockResolvedValueOnce([
    dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 3 }),
    dayBucket({ localDate: '2026-04-16', country: 'France', city: 'Paris', assetCount: 3 }),
    dayBucket({ localDate: '2026-04-17', country: 'France', city: 'Paris', assetCount: 3 }),
  ])
  .mockResolvedValueOnce([
    dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 3 }),
    dayBucket({ localDate: '2026-04-16', country: 'France', city: 'Paris', assetCount: 3 }),
    dayBucket({ localDate: '2026-04-17', country: 'France', city: 'Paris', assetCount: 3 }),
  ]);
```

Add this fallback regression test after the existing high-confidence test:

```ts
it('falls back to recent location clusters when day buckets are unavailable', async () => {
  const assetRepository = {
    getMemoryLocationClusters: vi
      .fn()
      .mockResolvedValueOnce([cluster({ country: 'Germany', city: 'Berlin', assetCount: 20, dayCount: 12 })])
      .mockResolvedValueOnce([cluster({ country: 'France', city: 'Paris', assetCount: 9, dayCount: 3 })]),
  };
  const service = new TripCandidateService(assetRepository);

  const [candidate] = await service.findRecentTripCandidates({
    ownerId: 'user-1',
    targetDate: new Date('2026-04-23T12:00:00Z'),
    lookbackDays: 30,
  });

  expect(assetRepository.getMemoryLocationClusters).toHaveBeenNthCalledWith(2, 'user-1', {
    takenAfter: new Date('2026-03-24T00:00:00.000Z'),
    takenBefore: new Date('2026-04-23T23:59:59.999Z'),
  });
  expect(candidate).toMatchObject({
    dedupeKey: 'trip:france:paris:2026-04-15:2026-04-17',
    title: 'Recent trip to Paris, France',
    subtitle: '9 photos over 3 days',
    confidence: 'high',
    placeKey: 'france:paris',
  });
});
```

- [ ] **Step 2: Add failing window tests**

Append these tests to `TripCandidateService.name`:

```ts
it('merges adjacent travel days into one multi-city candidate with deduplicated labels', async () => {
  const { assetRepository, service } = setup();
  assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
    cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
  ]);
  assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
    dayBucket({ localDate: '2026-04-15', country: 'France', state: 'Ile-de-France', city: 'Paris', assetCount: 3 }),
    dayBucket({
      localDate: '2026-04-16',
      country: 'France',
      state: 'Auvergne-Rhone-Alpes',
      city: 'Lyon',
      assetCount: 4,
    }),
    dayBucket({ localDate: '2026-04-17', country: 'France', state: 'Ile-de-France', city: 'Paris', assetCount: 2 }),
  ]);

  const [candidate] = await service.findRecentTripCandidates({
    ownerId: 'user-1',
    targetDate: new Date('2026-04-23T12:00:00Z'),
  });

  expect(candidate).toMatchObject({
    dedupeKey: 'trip:france:paris+france:lyon:2026-04-15:2026-04-17',
    title: 'Recent trip to France',
    subtitle: '9 photos over 3 days',
    countries: ['France'],
    states: ['Ile-de-France', 'Auvergne-Rhone-Alpes'],
    cities: ['Paris', 'Lyon'],
    assetCount: 9,
    dayCount: 3,
    placeKey: 'france:paris+france:lyon',
    placeLabel: 'France',
    source: {
      places: [
        { country: 'France', state: 'Ile-de-France', city: 'Paris' },
        { country: 'France', state: 'Auvergne-Rhone-Alpes', city: 'Lyon' },
      ],
      placeLabels: ['Paris, France', 'Lyon, France'],
    },
  });
  expect(candidate?.takenAfter).toEqual(new Date('2026-04-15T09:00:00Z'));
  expect(candidate?.takenBefore).toEqual(new Date('2026-04-17T17:00:00Z'));
});

it('allows one no-photo day inside one cross-border trip', async () => {
  const { assetRepository, service } = setup();
  assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
    cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
  ]);
  assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
    dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 4 }),
    dayBucket({ localDate: '2026-04-17', country: 'Italy', city: 'Rome', assetCount: 4 }),
  ]);

  const [candidate] = await service.findRecentTripCandidates({
    ownerId: 'user-1',
    targetDate: new Date('2026-04-23T12:00:00Z'),
  });

  expect(candidate).toMatchObject({
    dedupeKey: 'trip:france:paris+italy:rome:2026-04-15:2026-04-17',
    title: 'Recent trip to France and Italy',
    subtitle: '8 photos over 2 days',
    countries: ['France', 'Italy'],
    cities: ['Paris', 'Rome'],
    assetCount: 8,
    dayCount: 2,
    placeKey: 'france:paris+italy:rome',
    placeLabel: 'France and Italy',
    source: {
      places: [
        { country: 'France', state: null, city: 'Paris' },
        { country: 'Italy', state: null, city: 'Rome' },
      ],
      placeLabels: ['Paris, France', 'Rome, Italy'],
    },
  });
});

it('keeps source places distinct when the same city and country appear in different states', async () => {
  const { assetRepository, service } = setup();
  assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
    cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
  ]);
  assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
    dayBucket({
      localDate: '2026-04-15',
      country: 'USA',
      state: 'Illinois',
      city: 'Springfield',
      assetCount: 4,
    }),
    dayBucket({
      localDate: '2026-04-16',
      country: 'USA',
      state: 'Massachusetts',
      city: 'Springfield',
      assetCount: 4,
    }),
  ]);

  const [candidate] = await service.findRecentTripCandidates({
    ownerId: 'user-1',
    targetDate: new Date('2026-04-23T12:00:00Z'),
  });

  expect(candidate).toMatchObject({
    dedupeKey: 'trip:usa:illinois:springfield+usa:massachusetts:springfield:2026-04-15:2026-04-16',
    states: ['Illinois', 'Massachusetts'],
    cities: ['Springfield'],
    placeKey: 'usa:illinois:springfield+usa:massachusetts:springfield',
    source: {
      places: [
        { country: 'USA', state: 'Illinois', city: 'Springfield' },
        { country: 'USA', state: 'Massachusetts', city: 'Springfield' },
      ],
      placeLabels: ['Springfield, Illinois, USA', 'Springfield, Massachusetts, USA'],
    },
  });
});

it('does not treat an in-window home photo day as a no-photo gap', async () => {
  const { assetRepository, service } = setup();
  assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
    cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
  ]);
  assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
    dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 4 }),
    dayBucket({ localDate: '2026-04-16', country: 'Germany', city: 'Berlin', assetCount: 6 }),
    dayBucket({ localDate: '2026-04-17', country: 'Italy', city: 'Rome', assetCount: 4 }),
    dayBucket({ localDate: '2026-04-18', country: 'Italy', city: 'Rome', assetCount: 4 }),
  ]);

  const candidates = await service.findRecentTripCandidates({
    ownerId: 'user-1',
    targetDate: new Date('2026-04-23T12:00:00Z'),
    maxCandidates: 3,
  });

  expect(candidates.map((candidate) => candidate.dedupeKey)).toEqual(['trip:italy:rome:2026-04-17:2026-04-18']);
});

it('keeps clearly separate trips as separate candidates', async () => {
  const { assetRepository, service } = setup();
  assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
    cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
  ]);
  assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
    dayBucket({ localDate: '2026-04-01', country: 'France', city: 'Paris', assetCount: 4 }),
    dayBucket({ localDate: '2026-04-02', country: 'France', city: 'Paris', assetCount: 4 }),
    dayBucket({ localDate: '2026-04-08', country: 'Italy', city: 'Rome', assetCount: 4 }),
    dayBucket({ localDate: '2026-04-09', country: 'Italy', city: 'Rome', assetCount: 4 }),
  ]);

  const candidates = await service.findRecentTripCandidates({
    ownerId: 'user-1',
    targetDate: new Date('2026-04-23T12:00:00Z'),
    maxCandidates: 3,
  });

  expect(candidates).toHaveLength(2);
  expect(candidates.map((candidate) => candidate.dedupeKey)).toEqual([
    'trip:italy:rome:2026-04-08:2026-04-09',
    'trip:france:paris:2026-04-01:2026-04-02',
  ]);
});

it('separates trips to the same place when a larger date gap divides them', async () => {
  const { assetRepository, service } = setup();
  assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
    cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
  ]);
  assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
    dayBucket({ localDate: '2026-04-01', country: 'France', city: 'Paris', assetCount: 4 }),
    dayBucket({ localDate: '2026-04-02', country: 'France', city: 'Paris', assetCount: 4 }),
    dayBucket({ localDate: '2026-04-10', country: 'France', city: 'Paris', assetCount: 5 }),
    dayBucket({ localDate: '2026-04-11', country: 'France', city: 'Paris', assetCount: 4 }),
  ]);

  const candidates = await service.findRecentTripCandidates({
    ownerId: 'user-1',
    targetDate: new Date('2026-04-23T12:00:00Z'),
    maxCandidates: 3,
  });

  expect(candidates.map((candidate) => candidate.dedupeKey)).toEqual([
    'trip:france:paris:2026-04-10:2026-04-11',
    'trip:france:paris:2026-04-01:2026-04-02',
  ]);
});
```

- [ ] **Step 3: Run service tests red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/trip-candidate.service.spec.ts --run
```

Expected: FAIL because `TripCandidateService` still maps one location cluster to one candidate and does not consume day buckets.

## Task 4: Implement Trip Window Merging

**Files:**

- Modify: `server/src/services/trip-candidate.service.ts`

- [ ] **Step 1: Update imports and repository type**

Change the repository import and add a local repository type:

```ts
import { DateTime } from 'luxon';
import { AssetRepository, MemoryLocationCluster, MemoryLocationDayBucket } from 'src/repositories/asset.repository';

type TripCandidateRepository = Pick<AssetRepository, 'getMemoryLocationClusters'> &
  Partial<Pick<AssetRepository, 'getMemoryLocationDayBuckets'>>;
```

Update the constructor:

```ts
  constructor(private assetRepository: TripCandidateRepository) {}
```

- [ ] **Step 2: Add window helper types and constants**

Inside `TripCandidateService`, add constants and private helper types near the top of the class:

```ts
  private static readonly MAX_NO_PHOTO_GAP_DAYS = 1;
```

Add these file-local types above the class:

```ts
type HomeBaseline = { cluster?: MemoryLocationCluster; ambiguous: boolean };

type TravelWindow = {
  buckets: MemoryLocationDayBucket[];
  dayKeys: Set<string>;
  assetCount: number;
  firstDate: Date;
  lastDate: Date;
  places: Array<{ country: string; state: string | null; city: string | null }>;
};
```

- [ ] **Step 3: Fetch recent day buckets when available**

In `findRecentTripCandidates`, replace the existing `Promise.all` with:

```ts
const recentRange = {
  takenAfter: recentFrom.toJSDate(),
  takenBefore: target.toJSDate(),
};
const recentPromise = this.assetRepository.getMemoryLocationDayBuckets
  ? this.assetRepository.getMemoryLocationDayBuckets(ownerId, recentRange)
  : this.assetRepository.getMemoryLocationClusters(ownerId, recentRange);

const [baseline, recent] = await Promise.all([
  this.assetRepository.getMemoryLocationClusters(ownerId, {
    takenAfter: baselineFrom.toJSDate(),
    takenBefore: baselineTo.toJSDate(),
  }),
  recentPromise,
]);

const home = this.resolveHomeBaseline(baseline);
const candidates = this.assetRepository.getMemoryLocationDayBuckets
  ? this.findWindowCandidates(recent as MemoryLocationDayBucket[], home)
  : this.findClusterCandidates(recent as MemoryLocationCluster[], home);

return candidates
  .toSorted((left, right) => right.score - left.score || right.takenAfter.getTime() - left.takenAfter.getTime())
  .slice(0, maxCandidates);
```

- [ ] **Step 4: Preserve Slice 1 cluster fallback**

Move the existing cluster filtering into this method:

```ts
  private findClusterCandidates(recent: MemoryLocationCluster[], home: HomeBaseline): TripCandidate[] {
    return recent
      .filter((item) => this.isQualifyingCluster(item))
      .filter((item) => !home.cluster || home.ambiguous || this.isAwayFromHome(item, home.cluster))
      .map((item) => this.toClusterTripCandidate(item, home.ambiguous ? 'low' : 'high'));
  }
```

Rename `isQualifyingTrip` to `isQualifyingCluster`, and rename `toTripCandidate` to `toClusterTripCandidate`.

Also loosen `isAwayFromHome` so both clusters and day buckets can use it:

```ts
  private isAwayFromHome(
    item: { country: string | null; city: string | null },
    home: { country: string | null; city: string | null },
  ) {
```

- [ ] **Step 5: Add day-bucket window creation**

Add these methods:

```ts
  private findWindowCandidates(recent: MemoryLocationDayBucket[], home: HomeBaseline): TripCandidate[] {
    const qualifyingBuckets = recent
      .filter((item) => this.isQualifyingTravelBucket(item))
      .toSorted((left, right) => left.localDate.getTime() - right.localDate.getTime() || right.assetCount - left.assetCount);
    const blockedGapDayKeys = new Set<string>();
    const travelBuckets = qualifyingBuckets.filter((item) => {
      if (this.isTravelBucket(item, home)) {
        return true;
      }

      blockedGapDayKeys.add(this.dayKey(item.localDate));
      return false;
    });

    return this.buildTravelWindows(travelBuckets, blockedGapDayKeys)
      .filter((window) => window.assetCount >= 7 && window.dayKeys.size >= 2)
      .map((window) => this.toWindowTripCandidate(window, home.ambiguous ? 'low' : 'high'));
  }

  private isQualifyingTravelBucket(item: MemoryLocationDayBucket) {
    return !!item.country && item.assetCount > 0;
  }

  private isTravelBucket(item: MemoryLocationDayBucket, home: HomeBaseline) {
    return !home.cluster || home.ambiguous || this.isAwayFromHome(item, home.cluster);
  }

  private buildTravelWindows(buckets: MemoryLocationDayBucket[], blockedGapDayKeys = new Set<string>()): TravelWindow[] {
    const windows: TravelWindow[] = [];
    let current: TravelWindow | undefined;
    let lastDay: DateTime | undefined;

    for (const bucket of buckets) {
      const bucketDay = DateTime.fromJSDate(bucket.localDate, { zone: 'utc' }).startOf('day');
      const gapDays = lastDay ? bucketDay.diff(lastDay, 'days').days - 1 : 0;

      if (
        !current ||
        gapDays > TripCandidateService.MAX_NO_PHOTO_GAP_DAYS ||
        this.hasBlockedGapDay(lastDay, bucketDay, blockedGapDayKeys)
      ) {
        current = this.createWindow(bucket);
        windows.push(current);
      } else {
        this.addBucketToWindow(current, bucket);
      }

      lastDay = bucketDay;
    }

    return windows;
  }

  private hasBlockedGapDay(lastDay: DateTime | undefined, bucketDay: DateTime, blockedGapDayKeys: Set<string>) {
    if (!lastDay || blockedGapDayKeys.size === 0) {
      return false;
    }

    for (let day = lastDay.plus({ days: 1 }); day < bucketDay; day = day.plus({ days: 1 })) {
      if (blockedGapDayKeys.has(day.toFormat('yyyy-MM-dd'))) {
        return true;
      }
    }

    return false;
  }

  private createWindow(bucket: MemoryLocationDayBucket): TravelWindow {
    const window: TravelWindow = {
      buckets: [],
      dayKeys: new Set<string>(),
      assetCount: 0,
      firstDate: bucket.firstDate,
      lastDate: bucket.lastDate,
      places: [],
    };

    this.addBucketToWindow(window, bucket);
    return window;
  }

  private addBucketToWindow(window: TravelWindow, bucket: MemoryLocationDayBucket) {
    window.buckets.push(bucket);
    window.assetCount += bucket.assetCount;
    window.dayKeys.add(this.dayKey(bucket.localDate));
    window.firstDate = new Date(Math.min(window.firstDate.getTime(), bucket.firstDate.getTime()));
    window.lastDate = new Date(Math.max(window.lastDate.getTime(), bucket.lastDate.getTime()));

    if (bucket.country) {
      const place = { country: bucket.country, state: bucket.state ?? null, city: bucket.city ?? null };
      const key = this.sourcePlaceKey(place);
      if (!window.places.some((item) => this.sourcePlaceKey(item) === key)) {
        window.places.push(place);
      }
    }
  }
```

- [ ] **Step 6: Add summary mapping for windows**

Add these methods:

```ts
  private toWindowTripCandidate(window: TravelWindow, confidence: TripCandidateConfidence): TripCandidate {
    const countries = this.uniqueValues(window.places.map((place) => place.country));
    const states = this.uniqueValues(window.places.map((place) => place.state).filter((value): value is string => !!value));
    const cities = this.uniqueValues(window.places.map((place) => place.city).filter((value): value is string => !!value));
    const placeLabels = this.uniqueValues(
      window.places.map((place) => this.labelPlace(place, this.needsStateDisambiguation(place, window.places))),
    );
    const placeKey = this.placeKey(window.places);
    const placeLabel = this.labelWindow(countries, cities);
    const firstDate = this.dayKey(window.firstDate);
    const lastDate = this.dayKey(window.lastDate);
    const dedupeKey = `trip:${placeKey}:${firstDate}:${lastDate}`;
    const dayCount = window.dayKeys.size;
    const score = this.scoreCandidate({ assetCount: window.assetCount, dayCount }, confidence);

    return {
      dedupeKey,
      title: `Recent trip to ${placeLabel}`,
      subtitle: `${window.assetCount} photos over ${dayCount} days`,
      countries,
      states,
      cities,
      takenAfter: window.firstDate,
      takenBefore: window.lastDate,
      assetCount: window.assetCount,
      albumAssetCount: window.assetCount,
      excludedDuplicateCount: 0,
      dayCount,
      score,
      confidence,
      source: {
        kind: 'tripCandidate',
        dedupeKey,
        takenAfter: window.firstDate,
        takenBefore: window.lastDate,
        places: window.places,
        placeLabels,
      },
      placeKey,
      placeLabel,
    };
  }

  private labelWindow(countries: string[], cities: string[]): string {
    if (countries.length === 1 && cities.length === 1) {
      return `${cities[0]}, ${countries[0]}`;
    }

    return this.joinLabels(countries);
  }

  private labelPlace(place: { country: string; state?: string | null; city?: string | null }, includeState = false) {
    if (place.city && includeState && place.state) {
      return `${place.city}, ${place.state}, ${place.country}`;
    }

    if (place.city) {
      return `${place.city}, ${place.country}`;
    }

    if (includeState && place.state) {
      return `${place.state}, ${place.country}`;
    }

    return place.country;
  }

  private placeKey(places: Array<{ country: string; state?: string | null; city?: string | null }>) {
    return places
      .map((place) => {
        const baseKey = `${place.country}:${place.city ?? ''}`;
        if (place.state && this.needsStateDisambiguation(place, places)) {
          return `${place.country}:${place.state}:${place.city ?? ''}`.toLowerCase();
        }

        return baseKey.toLowerCase();
      })
      .join('+');
  }

  private sourcePlaceKey(place: { country: string; state?: string | null; city?: string | null }) {
    return `${place.country}:${place.state ?? ''}:${place.city ?? ''}`.toLowerCase();
  }

  private needsStateDisambiguation(
    place: { country: string; state?: string | null; city?: string | null },
    places: Array<{ country: string; state?: string | null; city?: string | null }>,
  ) {
    const cityKey = `${place.country}:${place.city ?? ''}`.toLowerCase();
    return places.filter((item) => `${item.country}:${item.city ?? ''}`.toLowerCase() === cityKey).length > 1;
  }

  private joinLabels(values: string[]) {
    if (values.length <= 2) {
      return values.join(' and ');
    }

    return `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;
  }

  private uniqueValues(values: string[]) {
    return [...new Set(values)];
  }
```

Update the cluster mapper to use `this.dayKey`, `this.scoreCandidate`, `this.placeKey`, and `this.labelPlace` so single-place Slice 1 output stays unchanged.

Make `scoreCandidate` accept `{ assetCount: number; dayCount: number }` instead of `MemoryLocationCluster`.

- [ ] **Step 7: Run service tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/trip-candidate.service.spec.ts --run
```

Expected: PASS for all TripCandidateService tests.

## Task 5: Verify Slice 2 And Commit

**Files:**

- Verify all files from Tasks 1-4.

- [ ] **Step 1: Run focused service and memory rule tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/trip-candidate.service.spec.ts src/services/memory-rules/recent-trip.rule.spec.ts --run
```

Expected: PASS.

- [ ] **Step 2: Run memory service regression tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/memory.service.spec.ts --run
```

Expected: PASS.

- [ ] **Step 3: Run repository medium tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/asset.repository.spec.ts --run
```

Expected: PASS.

- [ ] **Step 4: Run TypeScript and whitespace checks**

Run:

```bash
pnpm --dir server check
git diff --check
```

Expected: PASS and no whitespace output.

- [ ] **Step 5: Commit Slice 2**

Run:

```bash
git add server/src/repositories/asset.repository.ts server/src/queries/asset.repository.sql server/test/repositories/asset.repository.mock.ts server/test/medium/specs/repositories/asset.repository.spec.ts server/src/services/trip-candidate.service.ts server/src/services/trip-candidate.service.spec.ts
git commit -m "feat: merge trip candidate travel windows"
```

Expected: one commit containing only Slice 2 implementation and tests.

## Plan Self-Review

- Spec coverage: Slice 2 tests cover adjacent-day merging, one no-photo-day gaps, home-photo days that must split trips, separated trips, multi-country windows, state-disambiguated same-city places, deduplicated labels, same-place trips separated by larger gaps, and fallback to Slice 1 location clusters when a minimal repository does not expose day buckets.
- Scope control: This plan intentionally does not implement `placeHint` request behavior because Slice 4 owns place matching and validation. The public score formula remains compatible with Slice 1; recency is used as a deterministic sort tie-breaker until the place-hint and recommendation slices add broader scoring policy.
- TDD: Repository behavior and service window behavior start with failing tests before implementation.
- Type consistency: `TripCandidateSource.places` already supports `state`; `MemoryLocationDayBucket` adds `state` from EXIF for summarization.
- Placeholder scan: no TBD/TODO placeholders remain.
