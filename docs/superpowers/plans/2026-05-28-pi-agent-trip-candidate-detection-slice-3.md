# Pi Agent Trip Candidate Detection Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add album-ready trip asset materialization so trip candidates report how many assets a generic trip album would include after conservative duplicate and stack-child exclusion.

**Architecture:** Keep trip candidate responses handle-ready and model-safe: `TripCandidateService` may materialize asset IDs internally, but `TripCandidate` still exposes only counts and source descriptors. Add repository read queries for trip-source assets and duplicate-group assets, reuse Gallery's duplicate keeper heuristic through a generic utility adapter, and keep selection-handle creation for Slice 5.

**Tech Stack:** TypeScript, Luxon, Kysely/Postgres, Vitest unit tests, existing medium repository tests and generated SQL snapshots.

---

## Scope

Spec: `docs/superpowers/specs/2026-05-28-pi-agent-trip-candidate-detection-design.md`

Slice 3 implements:

- `TripCandidate.albumAssetCount` becomes the count of assets that would be used for a generic trip album.
- `TripCandidate.excludedDuplicateCount` counts known duplicate variants excluded by the album-ready materializer.
- Add `TripCandidate.excludedStackChildCount` for stack-child exclusions.
- Known duplicate groups fully inside the candidate keep one suggested keeper using the existing duplicate keeper heuristic.
- Duplicate groups that only partially overlap the candidate keep all in-candidate assets.
- Stack children are excluded only when their stack primary is also inside the candidate.
- Duplicate-group completeness is proved against the raw source assets, but keeper selection is performed only over post-stack-filtered album-eligible assets.
- No duplicate, stack, asset visibility, or asset records are mutated.

Out of scope:

- No `findTripCandidates` MCP tool or selection handle creation. Slice 5 creates session-scoped handles from this materialization.
- No place-hint filtering. Slice 4 owns that.
- No semantic duplicate detection or duplicate cleanup.

## Files

- Modify: `server/src/utils/duplicate.ts`
- Modify: `server/src/utils/duplicate.spec.ts`
- Modify: `server/src/repositories/asset.repository.ts`
- Modify: `server/src/queries/asset.repository.sql`
- Modify: `server/test/repositories/asset.repository.mock.ts`
- Modify: `server/test/medium/specs/repositories/asset.repository.spec.ts`
- Modify: `server/src/services/trip-candidate.service.ts`
- Modify: `server/src/services/trip-candidate.service.spec.ts`

## Baseline Commands

- [ ] **Step 1: Verify Slice 2 baseline**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/trip-candidate.service.spec.ts src/services/memory-rules/recent-trip.rule.spec.ts --run
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/asset.repository.spec.ts --run
```

Expected: PASS.

## Task 1: Make Duplicate Keeper Heuristic Reusable For Repository Rows

**Files:**

- Modify: `server/src/utils/duplicate.spec.ts`
- Modify: `server/src/utils/duplicate.ts`

- [ ] **Step 1: Add failing utility tests**

In `server/src/utils/duplicate.spec.ts`, update the import to include `suggestDuplicateByMetadata`:

```ts
import {
  getExifCount,
  suggestDuplicate,
  suggestDuplicateByMetadata,
  suggestDuplicateKeepAssetIds,
} from 'src/utils/duplicate';
```

Add this `describe` block after the existing `suggestDuplicate` tests and before `suggestDuplicateKeepAssetIds`:

```ts
describe('suggestDuplicateByMetadata', () => {
  it('keeps the largest file size and uses exif count as a tie breaker for non-DTO rows', () => {
    const rows = [
      { id: 'small-more-exif', fileSizeInByte: 100, exifValueCount: 8 },
      { id: 'large-less-exif', fileSizeInByte: 200, exifValueCount: 1 },
      { id: 'large-more-exif', fileSizeInByte: 200, exifValueCount: 4 },
    ];

    expect(
      suggestDuplicateByMetadata(rows, {
        getFileSizeInByte: (row) => row.fileSizeInByte,
        getExifCount: (row) => row.exifValueCount,
      })?.id,
    ).toBe('large-more-exif');
  });

  it('treats missing file size and exif values as zero', () => {
    const rows = [
      { id: 'empty', fileSizeInByte: null, exifValueCount: null },
      { id: 'with-file-size', fileSizeInByte: 50, exifValueCount: null },
    ];

    expect(
      suggestDuplicateByMetadata(rows, {
        getFileSizeInByte: (row) => row.fileSizeInByte,
        getExifCount: (row) => row.exifValueCount,
      })?.id,
    ).toBe('with-file-size');
  });
});
```

- [ ] **Step 2: Run utility tests red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/utils/duplicate.spec.ts --run
```

Expected: FAIL because `suggestDuplicateByMetadata` is not exported.

- [ ] **Step 3: Add the generic duplicate keeper helper**

In `server/src/utils/duplicate.ts`, add this type and helper above `suggestDuplicate`:

```ts
export interface DuplicateMetadataAccessors<T> {
  getFileSizeInByte: (asset: T) => number | null | undefined;
  getExifCount: (asset: T) => number | null | undefined;
}

export const suggestDuplicateByMetadata = <T>(
  assets: T[],
  { getFileSizeInByte, getExifCount }: DuplicateMetadataAccessors<T>,
): T | undefined => {
  if (assets.length === 0) {
    return undefined;
  }

  let duplicateAssets = [...assets].toSorted((a, b) => (getFileSizeInByte(a) ?? 0) - (getFileSizeInByte(b) ?? 0));
  const largestFileSize = getFileSizeInByte(duplicateAssets.at(-1)!) ?? 0;
  duplicateAssets = duplicateAssets.filter((asset) => (getFileSizeInByte(asset) ?? 0) === largestFileSize);

  if (duplicateAssets.length >= 2) {
    duplicateAssets = duplicateAssets.toSorted((a, b) => (getExifCount(a) ?? 0) - (getExifCount(b) ?? 0));
  }

  return duplicateAssets.at(-1);
};
```

Then replace the body of `suggestDuplicate` with:

```ts
export const suggestDuplicate = (assets: AssetResponseDto[]): AssetResponseDto | undefined => {
  return suggestDuplicateByMetadata(assets, {
    getFileSizeInByte: (asset) => asset.exifInfo?.fileSizeInByte,
    getExifCount,
  });
};
```

- [ ] **Step 4: Run utility tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/utils/duplicate.spec.ts --run
```

Expected: PASS. Existing duplicate utility tests must still pass.

## Task 2: Add Trip Candidate Asset Repository Queries

**Files:**

- Modify: `server/test/medium/specs/repositories/asset.repository.spec.ts`
- Modify: `server/src/repositories/asset.repository.ts`
- Modify: `server/test/repositories/asset.repository.mock.ts`
- Modify: `server/src/queries/asset.repository.sql`

- [ ] **Step 1: Add failing repository medium tests**

Append this `describe` block after `getMemoryLocationDayBuckets` in `server/test/medium/specs/repositories/asset.repository.spec.ts`:

```ts
describe('getTripCandidateAssets', () => {
  it('should materialize previewable timeline assets for trip source places with stack and duplicate metadata', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    const addAsset = async ({
      localDateTime,
      country,
      state = null,
      city,
      duplicateId = null,
      fileSizeInByte = 100,
      exif = {},
      visibility = AssetVisibility.Timeline,
      withPreview = true,
    }: {
      localDateTime: Date;
      country: string | null;
      state?: string | null;
      city: string | null;
      duplicateId?: string | null;
      fileSizeInByte?: number | null;
      exif?: {
        description?: string;
        projectionType?: string;
        rating?: number;
        timeZone?: string;
      };
      visibility?: AssetVisibility;
      withPreview?: boolean;
    }) => {
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility, localDateTime, duplicateId });
      await Promise.all([
        ctx.newExif({ assetId: asset.id, country, state, city, fileSizeInByte, ...exif }),
        withPreview
          ? ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: `${asset.id}.jpg` })
          : null,
      ]);
      return asset;
    };

    const duplicateId = factory.uuid();
    const primary = await addAsset({
      localDateTime: new Date('2026-04-15T09:00:00Z'),
      country: 'France',
      state: 'Ile-de-France',
      city: 'Paris',
      duplicateId,
      fileSizeInByte: 300,
      exif: { description: 'A photo', projectionType: 'EQUIRECTANGULAR', rating: 0, timeZone: 'UTC' },
    });
    const stackChild = await addAsset({
      localDateTime: new Date('2026-04-15T10:00:00Z'),
      country: 'France',
      state: 'Ile-de-France',
      city: 'Paris',
      fileSizeInByte: 200,
    });
    await ctx.newStack({ ownerId: user.id }, [primary.id, stackChild.id]);
    await addAsset({
      localDateTime: new Date('2026-04-16T09:00:00Z'),
      country: 'Italy',
      state: 'Lazio',
      city: 'Rome',
    });
    await addAsset({
      localDateTime: new Date('2026-04-17T09:00:00Z'),
      country: 'France',
      city: 'Paris',
      withPreview: false,
    });
    await addAsset({
      localDateTime: new Date('2026-04-18T09:00:00Z'),
      country: 'France',
      city: 'Nice',
    });
    await addAsset({
      localDateTime: new Date('2026-04-15T09:00:00Z'),
      country: 'France',
      city: 'Paris',
      visibility: AssetVisibility.Archive,
    });

    await expect(
      sut.getTripCandidateAssets(user.id, {
        takenAfter: new Date('2026-04-15T00:00:00Z'),
        takenBefore: new Date('2026-04-16T23:59:59Z'),
        places: [
          { country: 'France', state: 'Ile-de-France', city: 'Paris' },
          { country: 'Italy', state: 'Lazio', city: 'Rome' },
        ],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: primary.id,
        duplicateId,
        stackPrimaryAssetId: primary.id,
        fileSizeInByte: 300,
        exifValueCount: 7,
      }),
      expect.objectContaining({
        id: stackChild.id,
        stackPrimaryAssetId: primary.id,
        fileSizeInByte: 200,
      }),
      expect.objectContaining({
        country: 'Italy',
        state: 'Lazio',
        city: 'Rome',
        stackId: null,
        stackPrimaryAssetId: null,
      }),
    ]);
  });

  it('should support explicit null and omitted optional place filters', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    const addAsset = async (country: string, state: string | null, city: string | null) => {
      const { asset } = await ctx.newAsset({
        ownerId: user.id,
        visibility: AssetVisibility.Timeline,
        localDateTime: new Date('2026-04-15T09:00:00Z'),
      });
      await Promise.all([
        ctx.newExif({ assetId: asset.id, country, state, city, fileSizeInByte: 100 }),
        ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: `${asset.id}.jpg` }),
      ]);
      return asset;
    };

    const franceUnknown = await addAsset('France', null, null);
    await addAsset('France', null, 'Paris');
    const italyRome = await addAsset('Italy', 'Lazio', 'Rome');
    const italyMilan = await addAsset('Italy', 'Lombardy', 'Milan');

    const result = await sut.getTripCandidateAssets(user.id, {
      takenAfter: new Date('2026-04-15T00:00:00Z'),
      takenBefore: new Date('2026-04-15T23:59:59Z'),
      places: [{ country: 'France', state: null, city: null }, { country: 'Italy' }],
    });

    expect(result.map(({ id }) => id).toSorted()).toEqual([franceUnknown.id, italyMilan.id, italyRome.id].toSorted());
  });

  it('should return duplicate group assets for owned timeline previewable assets only', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { user: otherUser } = await ctx.newUser();
    const duplicateId = factory.uuid();

    const addAsset = async (ownerId: string, withPreview = true, visibility = AssetVisibility.Timeline) => {
      const { asset } = await ctx.newAsset({
        ownerId,
        visibility,
        duplicateId,
        localDateTime: new Date('2026-04-15T09:00:00Z'),
      });
      await Promise.all([
        ctx.newExif({ assetId: asset.id, country: 'France', city: 'Paris', fileSizeInByte: 100 }),
        withPreview
          ? ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: `${asset.id}.jpg` })
          : null,
      ]);
      return asset;
    };

    const first = await addAsset(user.id);
    const second = await addAsset(user.id);
    const stackedPrimary = await addAsset(user.id);
    const { asset: stackChild } = await ctx.newAsset({
      ownerId: user.id,
      visibility: AssetVisibility.Timeline,
      localDateTime: new Date('2026-04-15T10:00:00Z'),
    });
    await Promise.all([
      ctx.newExif({ assetId: stackChild.id, country: 'France', city: 'Paris', fileSizeInByte: 90 }),
      ctx.newAssetFile({ assetId: stackChild.id, type: AssetFileType.Preview, path: `${stackChild.id}.jpg` }),
    ]);
    await ctx.newStack({ ownerId: user.id }, [stackedPrimary.id, stackChild.id]);
    await addAsset(user.id, false);
    await addAsset(user.id, true, AssetVisibility.Archive);
    await addAsset(otherUser.id);

    const result = await sut.getDuplicateGroupAssets(user.id, [duplicateId]);

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, duplicateId }),
        expect.objectContaining({ id: second.id, duplicateId }),
        expect.objectContaining({
          id: stackedPrimary.id,
          duplicateId,
          stackPrimaryAssetId: stackedPrimary.id,
        }),
      ]),
    );
    expect(result).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run repository tests red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/asset.repository.spec.ts --run
```

Expected: FAIL because `getTripCandidateAssets` and `getDuplicateGroupAssets` do not exist.

- [ ] **Step 3: Add repository types and read methods**

In `server/src/repositories/asset.repository.ts`, add these interfaces after `MemoryLocationDayBucket`:

```ts
export interface TripCandidateAssetPlace {
  country: string;
  state?: string | null;
  city?: string | null;
}

export interface TripCandidateAssetSource {
  takenAfter: Date;
  takenBefore: Date;
  places: TripCandidateAssetPlace[];
}

export interface TripCandidateAssetRow {
  id: string;
  localDateTime: Date;
  country: string | null;
  state: string | null;
  city: string | null;
  duplicateId: string | null;
  stackId: string | null;
  stackPrimaryAssetId: string | null;
  fileSizeInByte: number | null;
  exifValueCount: number;
}
```

Add a private helper near other top-level helpers:

```ts
const tripCandidateExifValueCount = sql<number>`(
  (nullif(asset_exif.make, '') is not null)::int +
  (nullif(asset_exif.model, '') is not null)::int +
  ((asset_exif."exifImageWidth" is not null) and (asset_exif."exifImageWidth" <> 0))::int +
  ((asset_exif."exifImageHeight" is not null) and (asset_exif."exifImageHeight" <> 0))::int +
  ((asset_exif."fileSizeInByte" is not null) and (asset_exif."fileSizeInByte" <> 0))::int +
  (nullif(asset_exif.orientation, '') is not null)::int +
  (asset_exif."dateTimeOriginal" is not null)::int +
  (asset_exif."modifyDate" is not null)::int +
  (nullif(asset_exif."timeZone", '') is not null)::int +
  (nullif(asset_exif."lensModel", '') is not null)::int +
  ((asset_exif."fNumber" is not null) and (asset_exif."fNumber" <> 0))::int +
  ((asset_exif."focalLength" is not null) and (asset_exif."focalLength" <> 0))::int +
  ((asset_exif.iso is not null) and (asset_exif.iso <> 0))::int +
  (nullif(asset_exif."exposureTime", '') is not null)::int +
  ((asset_exif.latitude is not null) and (asset_exif.latitude <> 0))::int +
  ((asset_exif.longitude is not null) and (asset_exif.longitude <> 0))::int +
  (nullif(asset_exif.city, '') is not null)::int +
  (nullif(asset_exif.state, '') is not null)::int +
  (nullif(asset_exif.country, '') is not null)::int +
  (nullif(asset_exif.description, '') is not null)::int +
  (nullif(asset_exif."projectionType", '') is not null)::int +
  ((asset_exif.rating is not null) and (asset_exif.rating <> 0))::int
)::int`;
```

Add these methods after `getMemoryLocationDayBuckets`:

```ts
  @GenerateSql({
    params: [
      DummyValue.UUID,
      {
        takenAfter: DummyValue.DATE,
        takenBefore: DummyValue.DATE,
        places: [{ country: DummyValue.STRING, state: DummyValue.STRING, city: DummyValue.STRING }],
      },
    ],
  })
  getTripCandidateAssets(ownerId: string, { takenAfter, takenBefore, places }: TripCandidateAssetSource) {
    if (places.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .leftJoin('stack', 'stack.id', 'asset.stackId')
      .select([
        'asset.id',
        'asset.localDateTime',
        'asset_exif.country',
        'asset_exif.state',
        'asset_exif.city',
        'asset.duplicateId',
        'asset.stackId',
        'stack.primaryAssetId as stackPrimaryAssetId',
        sql<number | null>`asset_exif."fileSizeInByte"::float8`.as('fileSizeInByte'),
        tripCandidateExifValueCount.as('exifValueCount'),
      ])
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '>=', takenAfter)
      .where('asset.localDateTime', '<=', takenBefore)
      .where((eb) =>
        eb.or(
          places.map((place) =>
            eb.and([
              eb('asset_exif.country', '=', place.country),
              ...(place.state === undefined
                ? []
                : [place.state === null ? eb('asset_exif.state', 'is', null) : eb('asset_exif.state', '=', place.state)]),
              ...(place.city === undefined
                ? []
                : [place.city === null ? eb('asset_exif.city', 'is', null) : eb('asset_exif.city', '=', place.city)]),
            ]),
          ),
        ),
      )
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .orderBy('asset.localDateTime', 'asc')
      .orderBy('asset.id', 'asc')
      .execute() as Promise<TripCandidateAssetRow[]>;
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  getDuplicateGroupAssets(ownerId: string, duplicateIds: string[]) {
    if (duplicateIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .leftJoin('stack', 'stack.id', 'asset.stackId')
      .select([
        'asset.id',
        'asset.localDateTime',
        'asset_exif.country',
        'asset_exif.state',
        'asset_exif.city',
        'asset.duplicateId',
        'asset.stackId',
        'stack.primaryAssetId as stackPrimaryAssetId',
        sql<number | null>`asset_exif."fileSizeInByte"::float8`.as('fileSizeInByte'),
        tripCandidateExifValueCount.as('exifValueCount'),
      ])
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where('asset.duplicateId', 'in', duplicateIds)
      .where('asset.duplicateId', 'is not', null)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .orderBy('asset.localDateTime', 'asc')
      .orderBy('asset.id', 'asc')
      .execute() as Promise<TripCandidateAssetRow[]>;
  }
```

In `server/test/repositories/asset.repository.mock.ts`, add:

```ts
    getTripCandidateAssets: vitest.fn().mockResolvedValue([]),
    getDuplicateGroupAssets: vitest.fn().mockResolvedValue([]),
```

immediately after `getMemoryLocationDayBuckets`.

- [ ] **Step 4: Regenerate SQL snapshot and run repository tests green**

Run:

```bash
pnpm --dir server build
pnpm --dir server sync:sql
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/asset.repository.spec.ts --run
```

Expected: PASS. `server/src/queries/asset.repository.sql` contains the two new generated queries.

## Task 3: Add Album-Ready Selection Service Tests

**Files:**

- Modify: `server/src/services/trip-candidate.service.spec.ts`

- [ ] **Step 1: Add failing service tests**

Add this helper below `dayBucket`:

```ts
const tripAsset = ({
  id,
  localDateTime = '2026-04-15T09:00:00Z',
  country = 'France',
  state = null,
  city = 'Paris',
  duplicateId = null,
  stackId = null,
  stackPrimaryAssetId = null,
  fileSizeInByte = 100,
  exifValueCount = 1,
}: {
  id: string;
  localDateTime?: string;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  duplicateId?: string | null;
  stackId?: string | null;
  stackPrimaryAssetId?: string | null;
  fileSizeInByte?: number | null;
  exifValueCount?: number;
}) => ({
  id,
  localDateTime: new Date(localDateTime),
  country,
  state,
  city,
  duplicateId,
  stackId,
  stackPrimaryAssetId,
  fileSizeInByte,
  exifValueCount,
});
```

Add this setup helper after `setup`:

```ts
const setupWithAlbumReady = () => {
  const assetRepository = {
    getMemoryLocationClusters: vi.fn(),
    getMemoryLocationDayBuckets: vi.fn(),
    getTripCandidateAssets: vi.fn().mockResolvedValue([]),
    getDuplicateGroupAssets: vi.fn().mockResolvedValue([]),
  };

  return { assetRepository, service: new TripCandidateService(assetRepository) };
};
```

Append these tests to `TripCandidateService.name`:

```ts
it('exposes album-ready counts on generic trip candidates without returning asset ids', async () => {
  const { assetRepository, service } = setupWithAlbumReady();
  assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
    cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
  ]);
  assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
    dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 4 }),
    dayBucket({ localDate: '2026-04-16', country: 'France', city: 'Paris', assetCount: 4 }),
  ]);
  assetRepository.getTripCandidateAssets.mockResolvedValueOnce([
    tripAsset({ id: 'asset-1' }),
    tripAsset({ id: 'asset-2' }),
    tripAsset({ id: 'asset-3' }),
    tripAsset({ id: 'asset-4' }),
    tripAsset({ id: 'asset-5' }),
    tripAsset({ id: 'asset-6' }),
    tripAsset({ id: 'asset-7' }),
    tripAsset({ id: 'asset-8' }),
  ]);

  const [candidate] = await service.findRecentTripCandidates({
    ownerId: 'user-1',
    targetDate: new Date('2026-04-23T12:00:00Z'),
  });

  expect(candidate).toMatchObject({
    assetCount: 8,
    albumAssetCount: 8,
    excludedDuplicateCount: 0,
    excludedStackChildCount: 0,
  });
  expect(candidate).not.toHaveProperty('assetIds');
});

it('leaves generic candidate counts unchanged when album asset hydration returns a non-array', async () => {
  const { assetRepository, service } = setupWithAlbumReady();
  assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
    cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
  ]);
  assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
    dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 4 }),
    dayBucket({ localDate: '2026-04-16', country: 'France', city: 'Paris', assetCount: 4 }),
  ]);
  assetRepository.getTripCandidateAssets.mockResolvedValueOnce(undefined);

  const [candidate] = await service.findRecentTripCandidates({
    ownerId: 'user-1',
    targetDate: new Date('2026-04-23T12:00:00Z'),
  });

  expect(candidate).toMatchObject({
    assetCount: 8,
    albumAssetCount: 8,
    excludedDuplicateCount: 0,
    excludedStackChildCount: 0,
  });
});

it('keeps all duplicate variants when duplicate group hydration is unavailable', async () => {
  const assetRepository = {
    getMemoryLocationClusters: vi.fn(),
    getTripCandidateAssets: vi
      .fn()
      .mockResolvedValue([
        tripAsset({ id: 'small', duplicateId: 'dup-1', fileSizeInByte: 100 }),
        tripAsset({ id: 'large', duplicateId: 'dup-1', fileSizeInByte: 200 }),
      ]),
  };
  const service = new TripCandidateService(assetRepository);
  const source = {
    kind: 'tripCandidate' as const,
    dedupeKey: 'trip:france:paris:2026-04-15:2026-04-16',
    takenAfter: new Date('2026-04-15T00:00:00Z'),
    takenBefore: new Date('2026-04-16T23:59:59Z'),
    places: [{ country: 'France', city: 'Paris' }],
    placeLabels: ['Paris, France'],
  };

  await expect(service.materializeAlbumReadySelection('user-1', source)).resolves.toEqual({
    assetIds: ['small', 'large'],
    assetCount: 2,
    albumAssetCount: 2,
    excludedDuplicateCount: 0,
    excludedStackChildCount: 0,
    hydrated: true,
  });
});

it('materializes album-ready selections by keeping one duplicate variant when the full group is inside the trip', async () => {
  const { assetRepository, service } = setupWithAlbumReady();
  const source = {
    kind: 'tripCandidate' as const,
    dedupeKey: 'trip:france:paris:2026-04-15:2026-04-16',
    takenAfter: new Date('2026-04-15T00:00:00Z'),
    takenBefore: new Date('2026-04-16T23:59:59Z'),
    places: [{ country: 'France', city: 'Paris' }],
    placeLabels: ['Paris, France'],
  };
  const duplicateRows = [
    tripAsset({ id: 'small', duplicateId: 'dup-1', fileSizeInByte: 100, exifValueCount: 8 }),
    tripAsset({ id: 'large', duplicateId: 'dup-1', fileSizeInByte: 200, exifValueCount: 1 }),
  ];
  assetRepository.getTripCandidateAssets.mockResolvedValueOnce([
    ...duplicateRows,
    tripAsset({ id: 'asset-3' }),
    tripAsset({ id: 'asset-4' }),
  ]);
  assetRepository.getDuplicateGroupAssets.mockResolvedValueOnce(duplicateRows);

  await expect(service.materializeAlbumReadySelection('user-1', source)).resolves.toEqual({
    assetIds: ['large', 'asset-3', 'asset-4'],
    assetCount: 4,
    albumAssetCount: 3,
    excludedDuplicateCount: 1,
    excludedStackChildCount: 0,
    hydrated: true,
  });
});

it('keeps partial-overlap duplicate groups intact unless the full group is inside the trip', async () => {
  const { assetRepository, service } = setupWithAlbumReady();
  const source = {
    kind: 'tripCandidate' as const,
    dedupeKey: 'trip:france:paris:2026-04-15:2026-04-16',
    takenAfter: new Date('2026-04-15T00:00:00Z'),
    takenBefore: new Date('2026-04-16T23:59:59Z'),
    places: [{ country: 'France', city: 'Paris' }],
    placeLabels: ['Paris, France'],
  };
  assetRepository.getTripCandidateAssets.mockResolvedValueOnce([
    tripAsset({ id: 'in-trip', duplicateId: 'dup-1', fileSizeInByte: 100 }),
    tripAsset({ id: 'asset-2' }),
  ]);
  assetRepository.getDuplicateGroupAssets.mockResolvedValueOnce([
    tripAsset({ id: 'in-trip', duplicateId: 'dup-1', fileSizeInByte: 100 }),
    tripAsset({ id: 'outside-trip', duplicateId: 'dup-1', fileSizeInByte: 300 }),
  ]);

  await expect(service.materializeAlbumReadySelection('user-1', source)).resolves.toEqual({
    assetIds: ['in-trip', 'asset-2'],
    assetCount: 2,
    albumAssetCount: 2,
    excludedDuplicateCount: 0,
    excludedStackChildCount: 0,
    hydrated: true,
  });
});

it('excludes stack children only when the stack primary is inside the trip', async () => {
  const { assetRepository, service } = setupWithAlbumReady();
  const source = {
    kind: 'tripCandidate' as const,
    dedupeKey: 'trip:france:paris:2026-04-15:2026-04-16',
    takenAfter: new Date('2026-04-15T00:00:00Z'),
    takenBefore: new Date('2026-04-16T23:59:59Z'),
    places: [{ country: 'France', city: 'Paris' }],
    placeLabels: ['Paris, France'],
  };
  assetRepository.getTripCandidateAssets.mockResolvedValueOnce([
    tripAsset({ id: 'primary', stackId: 'stack-1', stackPrimaryAssetId: 'primary' }),
    tripAsset({ id: 'child', stackId: 'stack-1', stackPrimaryAssetId: 'primary' }),
    tripAsset({ id: 'orphan-child', stackId: 'stack-2', stackPrimaryAssetId: 'outside-primary' }),
  ]);

  await expect(service.materializeAlbumReadySelection('user-1', source)).resolves.toEqual({
    assetIds: ['primary', 'orphan-child'],
    assetCount: 3,
    albumAssetCount: 2,
    excludedDuplicateCount: 0,
    excludedStackChildCount: 1,
    hydrated: true,
  });
});

it('distinguishes duplicate and stack-child exclusion counts without mutating assets', async () => {
  const { assetRepository, service } = setupWithAlbumReady();
  const source = {
    kind: 'tripCandidate' as const,
    dedupeKey: 'trip:france:paris:2026-04-15:2026-04-16',
    takenAfter: new Date('2026-04-15T00:00:00Z'),
    takenBefore: new Date('2026-04-16T23:59:59Z'),
    places: [{ country: 'France', city: 'Paris' }],
    placeLabels: ['Paris, France'],
  };
  const duplicateRows = [
    tripAsset({ id: 'dup-small', duplicateId: 'dup-1', fileSizeInByte: 100 }),
    tripAsset({ id: 'dup-large', duplicateId: 'dup-1', fileSizeInByte: 200 }),
  ];
  assetRepository.getTripCandidateAssets.mockResolvedValueOnce([
    ...duplicateRows,
    tripAsset({ id: 'primary', stackId: 'stack-1', stackPrimaryAssetId: 'primary' }),
    tripAsset({ id: 'child', stackId: 'stack-1', stackPrimaryAssetId: 'primary' }),
  ]);
  assetRepository.getDuplicateGroupAssets.mockResolvedValueOnce(duplicateRows);

  await expect(service.materializeAlbumReadySelection('user-1', source)).resolves.toMatchObject({
    assetIds: ['dup-large', 'primary'],
    excludedDuplicateCount: 1,
    excludedStackChildCount: 1,
    hydrated: true,
  });
  expect(assetRepository.getTripCandidateAssets).toHaveBeenCalledTimes(1);
  expect(assetRepository.getDuplicateGroupAssets).toHaveBeenCalledWith('user-1', ['dup-1']);
});

it('deduplicates stack primaries after excluding stack children from a full duplicate group', async () => {
  const { assetRepository, service } = setupWithAlbumReady();
  const source = {
    kind: 'tripCandidate' as const,
    dedupeKey: 'trip:france:paris:2026-04-15:2026-04-16',
    takenAfter: new Date('2026-04-15T00:00:00Z'),
    takenBefore: new Date('2026-04-16T23:59:59Z'),
    places: [{ country: 'France', city: 'Paris' }],
    placeLabels: ['Paris, France'],
  };
  const duplicateRows = [
    tripAsset({
      id: 'stack-primary',
      duplicateId: 'dup-1',
      stackId: 'stack-1',
      stackPrimaryAssetId: 'stack-primary',
      fileSizeInByte: 300,
    }),
    tripAsset({
      id: 'stack-child',
      duplicateId: 'dup-1',
      stackId: 'stack-1',
      stackPrimaryAssetId: 'stack-primary',
      fileSizeInByte: 500,
    }),
    tripAsset({ id: 'standalone', duplicateId: 'dup-1', fileSizeInByte: 200 }),
  ];
  assetRepository.getTripCandidateAssets.mockResolvedValueOnce(duplicateRows);
  assetRepository.getDuplicateGroupAssets.mockResolvedValueOnce(duplicateRows);

  await expect(service.materializeAlbumReadySelection('user-1', source)).resolves.toEqual({
    assetIds: ['stack-primary'],
    assetCount: 3,
    albumAssetCount: 1,
    excludedDuplicateCount: 1,
    excludedStackChildCount: 1,
    hydrated: true,
  });
});
```

- [ ] **Step 2: Run service tests red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/trip-candidate.service.spec.ts --run
```

Expected: FAIL because `materializeAlbumReadySelection` and `excludedStackChildCount` do not exist, and candidates still report raw counts.

## Task 4: Implement Album-Ready Selection In TripCandidateService

**Files:**

- Modify: `server/src/services/trip-candidate.service.ts`

- [ ] **Step 1: Update imports and types**

Update the repository import and add the duplicate helper import:

```ts
import {
  AssetRepository,
  MemoryLocationCluster,
  MemoryLocationDayBucket,
  TripCandidateAssetRow,
} from 'src/repositories/asset.repository';
import { suggestDuplicateByMetadata } from 'src/utils/duplicate';
```

Update `TripCandidateRepository`:

```ts
type TripCandidateRepository = Pick<AssetRepository, 'getMemoryLocationClusters'> &
  Partial<Pick<AssetRepository, 'getMemoryLocationDayBuckets' | 'getTripCandidateAssets' | 'getDuplicateGroupAssets'>>;
```

Add:

```ts
export interface TripCandidateAlbumSelection {
  assetIds: string[];
  assetCount: number;
  albumAssetCount: number;
  excludedDuplicateCount: number;
  excludedStackChildCount: number;
  hydrated: boolean;
}
```

Add `excludedStackChildCount: number;` to `TripCandidate`.

- [ ] **Step 2: Hydrate candidate album counts**

After building candidates in `findRecentTripCandidates`, replace the return block with:

```ts
const albumReadyCandidates = await Promise.all(
  candidates.map((candidate) => this.withAlbumReadyCounts(ownerId, candidate)),
);

return albumReadyCandidates
  .toSorted((left, right) => right.score - left.score || right.takenAfter.getTime() - left.takenAfter.getTime())
  .slice(0, maxCandidates);
```

Add:

```ts
  private async withAlbumReadyCounts(ownerId: string, candidate: TripCandidate): Promise<TripCandidate> {
    if (!this.assetRepository.getTripCandidateAssets) {
      return candidate;
    }

    const selection = await this.materializeAlbumReadySelection(ownerId, candidate.source);
    if (!selection.hydrated) {
      return candidate;
    }

    return {
      ...candidate,
      albumAssetCount: selection.albumAssetCount,
      excludedDuplicateCount: selection.excludedDuplicateCount,
      excludedStackChildCount: selection.excludedStackChildCount,
    };
  }
```

- [ ] **Step 3: Add the materializer**

Add these methods before label helpers:

```ts
  async materializeAlbumReadySelection(ownerId: string, source: TripCandidateSource): Promise<TripCandidateAlbumSelection> {
    if (!this.assetRepository.getTripCandidateAssets) {
      return {
        assetIds: [],
        assetCount: 0,
        albumAssetCount: 0,
        excludedDuplicateCount: 0,
        excludedStackChildCount: 0,
        hydrated: false,
      };
    }

    const sourceAssets = await this.assetRepository.getTripCandidateAssets(ownerId, {
      takenAfter: source.takenAfter,
      takenBefore: source.takenBefore,
      places: source.places,
    });
    if (!Array.isArray(sourceAssets)) {
      return {
        assetIds: [],
        assetCount: 0,
        albumAssetCount: 0,
        excludedDuplicateCount: 0,
        excludedStackChildCount: 0,
        hydrated: false,
      };
    }

    const sourceIds = new Set(sourceAssets.map(({ id }) => id));
    const { assets: stackFilteredAssets, excludedStackChildCount } = this.excludeStackChildren(sourceAssets, sourceIds);
    const { assetIds, excludedDuplicateCount } = await this.excludeDuplicateVariants(
      ownerId,
      stackFilteredAssets,
      sourceIds,
    );

    return {
      assetIds,
      assetCount: sourceAssets.length,
      albumAssetCount: assetIds.length,
      excludedDuplicateCount,
      excludedStackChildCount,
      hydrated: true,
    };
  }

  private excludeStackChildren(assets: TripCandidateAssetRow[], sourceIds: Set<string>) {
    const kept: TripCandidateAssetRow[] = [];
    let excludedStackChildCount = 0;

    for (const asset of assets) {
      const isStackChild =
        !!asset.stackId && !!asset.stackPrimaryAssetId && asset.id !== asset.stackPrimaryAssetId;
      if (isStackChild && sourceIds.has(asset.stackPrimaryAssetId!)) {
        excludedStackChildCount++;
        continue;
      }

      kept.push(asset);
    }

    return { assets: kept, excludedStackChildCount };
  }

  private async excludeDuplicateVariants(ownerId: string, assets: TripCandidateAssetRow[], sourceIds: Set<string>) {
    const duplicateIds = this.uniqueValues(
      assets.map((asset) => asset.duplicateId).filter((duplicateId): duplicateId is string => !!duplicateId),
    );
    if (!this.assetRepository.getDuplicateGroupAssets || duplicateIds.length === 0) {
      return { assetIds: assets.map(({ id }) => id), excludedDuplicateCount: 0 };
    }

    const groupAssets = await this.assetRepository.getDuplicateGroupAssets(ownerId, duplicateIds);
    if (!Array.isArray(groupAssets)) {
      return { assetIds: assets.map(({ id }) => id), excludedDuplicateCount: 0 };
    }

    const assetsByDuplicateId = this.groupByDuplicateId(assets);
    const fullGroupsByDuplicateId = this.groupByDuplicateId(groupAssets);
    const excludedIds = new Set<string>();

    for (const [duplicateId, candidateGroup] of assetsByDuplicateId) {
      const fullGroup = fullGroupsByDuplicateId.get(duplicateId) ?? [];
      if (
        candidateGroup.length <= 1 ||
        fullGroup.length <= 1 ||
        !this.isFullDuplicateGroupInsideSource(fullGroup, sourceIds)
      ) {
        continue;
      }

      const keeper = suggestDuplicateByMetadata(candidateGroup, {
        getFileSizeInByte: (asset) => asset.fileSizeInByte,
        getExifCount: (asset) => asset.exifValueCount,
      });
      if (!keeper) {
        continue;
      }

      for (const asset of candidateGroup) {
        if (asset.id !== keeper.id) {
          excludedIds.add(asset.id);
        }
      }
    }

    return {
      assetIds: assets.filter(({ id }) => !excludedIds.has(id)).map(({ id }) => id),
      excludedDuplicateCount: excludedIds.size,
    };
  }

  private groupByDuplicateId(assets: TripCandidateAssetRow[]) {
    const groups = new Map<string, TripCandidateAssetRow[]>();
    for (const asset of assets) {
      if (!asset.duplicateId) {
        continue;
      }

      groups.set(asset.duplicateId, [...(groups.get(asset.duplicateId) ?? []), asset]);
    }

    return groups;
  }

  private isFullDuplicateGroupInsideSource(fullGroup: TripCandidateAssetRow[], sourceIds: Set<string>) {
    return fullGroup.every(({ id }) => sourceIds.has(id));
  }
```

- [ ] **Step 4: Initialize stack exclusion counts in mappers**

In both `toClusterTripCandidate` and `toWindowTripCandidate`, add:

```ts
      excludedStackChildCount: 0,
```

next to `excludedDuplicateCount: 0`.

- [ ] **Step 5: Run service tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/trip-candidate.service.spec.ts --run
```

Expected: PASS.

## Task 5: Verify Slice 3 And Commit

**Files:**

- Verify all files from Tasks 1-4.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/utils/duplicate.spec.ts src/services/trip-candidate.service.spec.ts src/services/memory-rules/recent-trip.rule.spec.ts --run
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

- [ ] **Step 5: Commit Slice 3**

Run:

```bash
git add server/src/utils/duplicate.ts server/src/utils/duplicate.spec.ts server/src/repositories/asset.repository.ts server/src/queries/asset.repository.sql server/test/repositories/asset.repository.mock.ts server/test/medium/specs/repositories/asset.repository.spec.ts server/src/services/trip-candidate.service.ts server/src/services/trip-candidate.service.spec.ts
git commit -m "feat: materialize album-ready trip selections"
```

Expected: one commit containing only Slice 3 implementation and tests.

## Plan Self-Review

- Spec coverage: Slice 3 tests cover album-ready count, duplicate keeper selection, EXIF count parity with the existing truthy DTO heuristic, optional place filters, partial duplicate overlap, stack child exclusion, stacked duplicate groups, fallback for missing/unconfigured album hydration methods, distinct duplicate/stack counts, and no mutation by using read-only repository methods.
- Scope control: This does not create MCP DTOs, operation plans, or selection handles. The materializer returns internal asset IDs only for later server-side handle creation.
- TDD: Utility, repository, and service behaviors all start with failing tests.
- Type consistency: `TripCandidateSource.places` maps to repository `TripCandidateAssetPlace`; `TripCandidate` adds only one count field, `excludedStackChildCount`.
- Placeholder scan: no TBD/TODO placeholders remain.
