# Timeline Grouping Slice 1 Server API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side timeline bucket granularity for `year`, `month`, and `day`, including representative bucket metadata, while preserving current month behavior as the default.

**Architecture:** Extend the timeline DTO/API contract with `bucketSize`, pass it through `TimelineService` into `AssetRepository`, make the repository's `localDateTime` truncation parameterized, and return representative asset metadata from the same filtered bucket query that computes counts. `/timeline/bucket` uses the same granularity to return assets for the selected bucket only.

**Tech Stack:** NestJS, `nestjs-zod`, Kysely/PostgreSQL, Vitest small and medium tests, Supertest controller tests, generated OpenAPI, generated TypeScript SDK, generated SQL snapshots.

---

## Scope

This slice covers only the server/API foundation:

- Add `bucketSize=year|month|day` to `GET /timeline/buckets`.
- Add `bucketSize=year|month|day` to `GET /timeline/bucket`.
- Default missing `bucketSize` to current month behavior.
- Return `representativeAssetId`, `representativeThumbhash`, and `representativeRatio` from `/timeline/buckets`.
- Keep all existing timeline filters, permission checks, visibility checks, stack behavior, album/space/partner/shared-space behavior, and ordering semantics intact.
- Regenerate OpenAPI, TypeScript SDK, and SQL query snapshots.

This slice does not add the web grouping UI, card rendering, FilterPanel synchronization, or route adoption.

---

## Implementation Tasks

### 1. Add Failing DTO And Controller Tests

- [ ] Edit `server/src/dtos/time-bucket.dto.spec.ts`.
- [ ] Add tests for `TimeBucketDto.schema`:

```ts
it('defaults bucketSize to month', () => {
  const result = TimeBucketDto.schema.safeParse({});

  expect(result.success).toBe(true);
  expect(result.data?.bucketSize).toBe(TimeBucketSize.Month);
});

it.each([TimeBucketSize.Year, TimeBucketSize.Month, TimeBucketSize.Day])('accepts bucketSize=%s', (bucketSize) => {
  const result = TimeBucketDto.schema.safeParse({ bucketSize });

  expect(result.success).toBe(true);
  expect(result.data?.bucketSize).toBe(bucketSize);
});

it('rejects invalid bucketSize', () => {
  const result = TimeBucketDto.schema.safeParse({ bucketSize: 'week' });

  expect(result.success).toBe(false);
});
```

- [ ] Add the same default/accept/reject coverage for `TimeBucketAssetDto.schema` with `timeBucket: '2024-01-01'`.
- [ ] Import `TimeBucketSize` from `src/enum`.
- [ ] Edit `server/src/controllers/timeline.controller.spec.ts`.
- [ ] Add controller tests proving `bucketSize` is parsed and passed through:

```ts
it('passes bucketSize to the service', async () => {
  const { status } = await request(ctx.getHttpServer()).get('/timeline/buckets').query({ bucketSize: 'year' });

  expect(status).toBe(200);
  expect(service.getTimeBuckets).toHaveBeenCalledWith(undefined, expect.objectContaining({ bucketSize: 'year' }));
});
```

```ts
it('passes bucketSize to the singular bucket service', async () => {
  const { status } = await request(ctx.getHttpServer())
    .get('/timeline/bucket')
    .query({ bucketSize: 'day', timeBucket: '2024-02-29' });

  expect(status).toBe(200);
  expect(service.getTimeBucket).toHaveBeenCalledWith(
    undefined,
    expect.objectContaining({ bucketSize: 'day', timeBucket: '2024-02-29' }),
  );
});
```

- [ ] Add invalid query tests for both endpoints:

```ts
const { status, body } = await request(ctx.getHttpServer()).get('/timeline/buckets').query({ bucketSize: 'week' });

expect(status).toBe(400);
expect(body).toEqual(errorDto.badRequest(expect.arrayContaining([expect.stringContaining('bucketSize')]) as any));
```

- [ ] Run the small red test command and confirm the new tests fail because `bucketSize` is not implemented:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs run \
  src/dtos/time-bucket.dto.spec.ts \
  src/controllers/timeline.controller.spec.ts
```

Expected red failure: parsed DTO data has no `bucketSize`, and controller pass-through expectations do not match.

### 2. Add Failing Utility Tests For Bucket Normalization

- [ ] Add `server/src/utils/timeline-bucket.spec.ts`.
- [ ] Cover date validation and bucket-start rules:

```ts
describe('normalizeTimeBucketForBucketSize', () => {
  it('accepts a year bucket at January 1', () => {
    expect(normalizeTimeBucketForBucketSize('2024-01-01', TimeBucketSize.Year)).toBe('2024-01-01');
  });

  it('rejects a year bucket that does not start on January 1', () => {
    expect(() => normalizeTimeBucketForBucketSize('2024-02-01', TimeBucketSize.Year)).toThrow(BadRequestException);
  });

  it('accepts a month bucket on day 1', () => {
    expect(normalizeTimeBucketForBucketSize('2024-02-01', TimeBucketSize.Month)).toBe('2024-02-01');
  });

  it('rejects a month bucket that does not start on day 1', () => {
    expect(() => normalizeTimeBucketForBucketSize('2024-02-10', TimeBucketSize.Month)).toThrow(BadRequestException);
  });

  it('accepts a leap-day day bucket', () => {
    expect(normalizeTimeBucketForBucketSize('2024-02-29', TimeBucketSize.Day)).toBe('2024-02-29');
  });

  it('rejects an invalid leap-day bucket', () => {
    expect(() => normalizeTimeBucketForBucketSize('2023-02-29', TimeBucketSize.Day)).toThrow(BadRequestException);
  });

  it('preserves five-digit years used by existing timeline bucket calls', () => {
    expect(normalizeTimeBucketForBucketSize('012345-01-01', TimeBucketSize.Month)).toBe('012345-01-01');
  });
});
```

- [ ] Cover SQL unit mapping:

```ts
describe('dateTruncUnitForTimeBucketSize', () => {
  it.each([
    [TimeBucketSize.Year, 'YEAR'],
    [TimeBucketSize.Month, 'MONTH'],
    [TimeBucketSize.Day, 'DAY'],
  ])('maps %s to %s', (bucketSize, unit) => {
    expect(dateTruncUnitForTimeBucketSize(bucketSize)).toBe(unit);
  });
});
```

- [ ] Run the red test command:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/utils/timeline-bucket.spec.ts
```

Expected red failure: the utility module and functions do not exist.

### 3. Implement The DTO, Enum, And Pure Helpers

- [ ] Edit `server/src/enum.ts`.
- [ ] Add the shared server enum and schema near `AssetOrder`:

```ts
export enum TimeBucketSize {
  Year = 'year',
  Month = 'month',
  Day = 'day',
}

export const TimeBucketSizeSchema = z
  .enum(TimeBucketSize)
  .describe('Timeline bucket granularity')
  .meta({ id: 'TimeBucketSize' });
```

- [ ] Edit `server/src/dtos/time-bucket.dto.ts`.
- [ ] Import `TimeBucketSize`, `TimeBucketSizeSchema`.
- [ ] Add `bucketSize` to `TimeBucketQueryBaseSchema`:

```ts
bucketSize: TimeBucketSizeSchema.optional()
  .default(TimeBucketSize.Month)
  .describe('Timeline bucket granularity. Defaults to month for backwards compatibility'),
```

- [ ] Extend `TimeBucketsResponseSchema` with optional representative metadata:

```ts
representativeAssetId: z.string().nullable().optional().describe('Representative asset ID for this bucket'),
representativeThumbhash: z.string().nullable().optional().describe('Representative asset thumbhash, base64 encoded'),
representativeRatio: z.number().nullable().optional().describe('Representative asset width/height ratio'),
```

- [ ] Add `server/src/utils/timeline-bucket.ts`.
- [ ] Implement pure helpers:

```ts
import { BadRequestException } from '@nestjs/common';
import { TimeBucketSize } from 'src/enum';

const TIME_BUCKET_PATTERN = /^([+]?\d{4,6})-(\d{2})-(\d{2})$/;

export function dateTruncUnitForTimeBucketSize(bucketSize: TimeBucketSize) {
  return {
    [TimeBucketSize.Year]: 'YEAR',
    [TimeBucketSize.Month]: 'MONTH',
    [TimeBucketSize.Day]: 'DAY',
  }[bucketSize];
}

export function normalizeTimeBucketForBucketSize(timeBucket: string, bucketSize: TimeBucketSize) {
  const match = TIME_BUCKET_PATTERN.exec(timeBucket);
  if (!match) {
    throw new BadRequestException('Invalid time bucket format');
  }

  const yearText = match[1].replace(/^[+]/, '');
  const year = Number(yearText);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = getDaysInMonth(year, month);

  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new BadRequestException('Invalid time bucket format');
  }

  if (bucketSize === TimeBucketSize.Year && (month !== 1 || day !== 1)) {
    throw new BadRequestException('Year time buckets must start on January 1');
  }

  if (bucketSize === TimeBucketSize.Month && day !== 1) {
    throw new BadRequestException('Month time buckets must start on the first day of the month');
  }

  return `${yearText}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getDaysInMonth(year: number, month: number) {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1] ?? 0;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
```

- [ ] Run the small test command and confirm DTO/controller/helper tests pass:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs run \
  src/dtos/time-bucket.dto.spec.ts \
  src/controllers/timeline.controller.spec.ts \
  src/utils/timeline-bucket.spec.ts
```

Expected green result: all added small tests pass.

### 4. Add Failing Service Unit Tests

- [ ] Edit `server/src/services/timeline.service.spec.ts`.
- [ ] Add unit coverage in `describe('getTimeBuckets')`:

```ts
it('passes bucketSize through to the repository', async () => {
  mocks.asset.getTimeBuckets.mockResolvedValue([]);

  await sut.getTimeBuckets(authStub.admin, { bucketSize: TimeBucketSize.Year });

  expect(mocks.asset.getTimeBuckets).toHaveBeenCalledWith(expect.objectContaining({ bucketSize: TimeBucketSize.Year }));
});

it('defaults bucketSize to month before calling the repository', async () => {
  mocks.asset.getTimeBuckets.mockResolvedValue([]);

  await sut.getTimeBuckets(authStub.admin, {});

  expect(mocks.asset.getTimeBuckets).toHaveBeenCalledWith(
    expect.objectContaining({ bucketSize: TimeBucketSize.Month }),
  );
});
```

- [ ] Add unit coverage in `describe('getTimeBucket')`:

```ts
it('passes bucketSize through to getTimeBucket', async () => {
  const json = `{"id":[]}`;
  mocks.asset.getTimeBucket.mockResolvedValue({ assets: json });

  await sut.getTimeBucket(authStub.admin, { bucketSize: TimeBucketSize.Day, timeBucket: '2024-02-29' });

  expect(mocks.asset.getTimeBucket).toHaveBeenCalledWith(
    '2024-02-29',
    expect.objectContaining({ bucketSize: TimeBucketSize.Day }),
    authStub.admin,
  );
});

it('rejects a mismatched bucket start date before querying assets', async () => {
  await expect(
    sut.getTimeBucket(authStub.admin, { bucketSize: TimeBucketSize.Year, timeBucket: '2024-02-01' }),
  ).rejects.toThrow(BadRequestException);

  expect(mocks.asset.getTimeBucket).not.toHaveBeenCalled();
});
```

- [ ] Import `TimeBucketSize` in the spec.
- [ ] Update existing exact `getTimeBuckets` and `getTimeBucket` repository-call expectations in this file to include `bucketSize: TimeBucketSize.Month` or to use `expect.objectContaining(...)` when the assertion is about another option. Do not weaken assertions about access checks, user scoping, or filter normalization.
- [ ] Add bucket-size coverage to existing unsupported-combination checks:
  - `withPartners: true` with `visibility: AssetVisibility.Archive` still rejects for `bucketSize: TimeBucketSize.Year`.
  - `withPartners: true` with `isFavorite: true` still rejects for `bucketSize: TimeBucketSize.Day`.
  - `withSharedSpaces: true` with missing or archive visibility still rejects for `bucketSize: TimeBucketSize.Year`.
  - `visibility: AssetVisibility.Locked` still requires elevated permission with `bucketSize: TimeBucketSize.Day`.
- [ ] Run the red test command:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/services/timeline.service.spec.ts
```

Expected red failure: service does not set default `bucketSize`, does not normalize `timeBucket`, or does not pass the option through.

### 5. Implement Service Pass-Through And Bucket Validation

- [ ] Edit `server/src/services/timeline.service.ts`.
- [ ] Import `TimeBucketSize` and `normalizeTimeBucketForBucketSize`.
- [ ] In `getTimeBucket`, normalize the requested `timeBucket` after `timeBucketChecks` and before calling the repository:

```ts
const bucketSize = dto.bucketSize ?? TimeBucketSize.Month;
const timeBucket = normalizeTimeBucketForBucketSize(dto.timeBucket, bucketSize);
const timeBucketOptions = await this.buildTimeBucketOptions(auth, { ...dto, bucketSize, timeBucket });
const bucket = await this.assetRepository.getTimeBucket(timeBucket, timeBucketOptions, auth);
```

- [ ] In `buildTimeBucketOptions`, default the option before returning:

```ts
return { ...scopedOptions, bucketSize: dto.bucketSize ?? TimeBucketSize.Month, userIds };
```

- [ ] Preserve existing behavior where `timeBucket` remains present in the singular endpoint options object, because existing service tests assert that pass-through.
- [ ] Run service unit tests:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/services/timeline.service.spec.ts
```

Expected green result: new and existing service tests pass.

### 6. Add Failing Medium Tests For Bucket Counts And Representatives

- [ ] Edit `server/test/medium/specs/services/timeline.service.spec.ts`.
- [ ] Update the existing `"should get time buckets by month"` assertion to include representative metadata or to use `expect.objectContaining` for `count` and `timeBucket`, because `/timeline/buckets` now returns additional fields.
- [ ] Add a helper inside the `getTimeBuckets` describe block:

```ts
const createTimelineAsset = async (
  ctx: ReturnType<typeof setup>['ctx'],
  ownerId: string,
  localDateTime: Date,
  options: Partial<Parameters<typeof ctx.newAsset>[0]> = {},
) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    fileCreatedAt: localDateTime,
    localDateTime,
    width: 400,
    height: 200,
    thumbhash: Buffer.from('thumbhash'),
    ...options,
  });
  await ctx.newExif({ assetId: asset.id, make: 'Canon', timeZone: 'UTC' });
  return asset;
};
```

- [ ] Add a medium test for year/month/day counts:

```ts
it('groups time buckets by requested year, month, and day granularity', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const auth = factory.auth({ user });

  await createTimelineAsset(ctx, user.id, new Date('2023-12-31T23:59:59.000Z'));
  await createTimelineAsset(ctx, user.id, new Date('2024-01-01T00:00:00.000Z'));
  await createTimelineAsset(ctx, user.id, new Date('2024-01-31T23:59:59.000Z'));
  await createTimelineAsset(ctx, user.id, new Date('2024-02-01T00:00:00.000Z'));
  await createTimelineAsset(ctx, user.id, new Date('2024-02-29T12:00:00.000Z'));

  await expect(sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Year })).resolves.toEqual([
    expect.objectContaining({ timeBucket: '2024-01-01', count: 4 }),
    expect.objectContaining({ timeBucket: '2023-01-01', count: 1 }),
  ]);

  await expect(sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Month })).resolves.toEqual([
    expect.objectContaining({ timeBucket: '2024-02-01', count: 2 }),
    expect.objectContaining({ timeBucket: '2024-01-01', count: 2 }),
    expect.objectContaining({ timeBucket: '2023-12-01', count: 1 }),
  ]);

  await expect(sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Day })).resolves.toEqual([
    expect.objectContaining({ timeBucket: '2024-02-29', count: 1 }),
    expect.objectContaining({ timeBucket: '2024-02-01', count: 1 }),
    expect.objectContaining({ timeBucket: '2024-01-31', count: 1 }),
    expect.objectContaining({ timeBucket: '2024-01-01', count: 1 }),
    expect.objectContaining({ timeBucket: '2023-12-31', count: 1 }),
  ]);
});
```

- [ ] Add a medium test for representative metadata:

```ts
it('returns representative metadata from the filtered bucket query', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const auth = factory.auth({ user });

  const older = await createTimelineAsset(ctx, user.id, new Date('2024-01-01T12:00:00.000Z'), {
    thumbhash: Buffer.from('older-thumbhash'),
    width: 100,
    height: 50,
  });
  const newer = await createTimelineAsset(ctx, user.id, new Date('2024-01-02T12:00:00.000Z'), {
    thumbhash: Buffer.from('newer-thumbhash'),
    width: 300,
    height: 100,
  });

  await expect(sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Month })).resolves.toEqual([
    expect.objectContaining({
      timeBucket: '2024-01-01',
      count: 2,
      representativeAssetId: newer.id,
      representativeThumbhash: Buffer.from('newer-thumbhash').toString('base64'),
      representativeRatio: 3,
    }),
  ]);

  await expect(sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Month, order: AssetOrder.Asc })).resolves.toEqual([
    expect.objectContaining({
      representativeAssetId: older.id,
      representativeThumbhash: Buffer.from('older-thumbhash').toString('base64'),
      representativeRatio: 2,
    }),
  ]);
});
```

- [ ] Add a medium test for missing thumbnail/dimensions fallback:

```ts
it('falls back cleanly when representative thumbnail data is missing', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const auth = factory.auth({ user });

  const asset = await createTimelineAsset(ctx, user.id, new Date('2024-03-01T12:00:00.000Z'), {
    thumbhash: null,
    width: null,
    height: null,
  });

  await expect(sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Month })).resolves.toEqual([
    expect.objectContaining({
      representativeAssetId: asset.id,
      representativeThumbhash: null,
      representativeRatio: 1,
    }),
  ]);
});
```

- [ ] Add a medium test for filtered representative selection:

```ts
it('chooses representatives only from assets that match filters', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const auth = factory.auth({ user });

  const favorite = await createTimelineAsset(ctx, user.id, new Date('2024-04-02T12:00:00.000Z'), {
    isFavorite: true,
  });
  await createTimelineAsset(ctx, user.id, new Date('2024-04-03T12:00:00.000Z'), {
    isFavorite: false,
  });

  await expect(sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Month, isFavorite: true })).resolves.toEqual([
    expect.objectContaining({ count: 1, representativeAssetId: favorite.id }),
  ]);
});
```

- [ ] Add a medium test for EXIF/location/rating filters affecting both counts and representative metadata:

```ts
it('applies EXIF and rating filters before selecting bucket representatives', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const auth = factory.auth({ user });

  const matching = await createTimelineAsset(ctx, user.id, new Date('2024-04-02T12:00:00.000Z'));
  await ctx.newExif({
    assetId: matching.id,
    city: 'Berlin',
    country: 'Germany',
    make: 'Canon',
    model: 'R5',
    rating: 5,
  });

  const decoy = await createTimelineAsset(ctx, user.id, new Date('2024-04-03T12:00:00.000Z'));
  await ctx.newExif({ assetId: decoy.id, city: 'Paris', country: 'France', make: 'Nikon', model: 'Z6', rating: 2 });

  await expect(
    sut.getTimeBuckets(auth, {
      bucketSize: TimeBucketSize.Year,
      city: 'Berlin',
      country: 'Germany',
      make: 'Canon',
      model: 'R5',
      rating: 5,
    }),
  ).resolves.toEqual([expect.objectContaining({ count: 1, representativeAssetId: matching.id })]);
});
```

- [ ] Add a bbox-specific medium test in `server/test/medium/specs/repositories/asset.repository.spec.ts`, because `bbox` uses the earth-distance path instead of a simple EXIF equality predicate. Create one asset inside the box and one outside it, request `bucketSize: TimeBucketSize.Year` with `bbox`, and assert only the inside asset contributes to `count` and `representativeAssetId`.
- [ ] Add a medium test for an empty result set:

```ts
it('returns an empty list when filters match no assets', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const auth = factory.auth({ user });

  await createTimelineAsset(ctx, user.id, new Date('2024-05-01T12:00:00.000Z'), { isFavorite: false });

  await expect(sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Year, isFavorite: true })).resolves.toEqual([]);
});
```

- [ ] Add a medium test for a video-only bucket:

```ts
it('uses a video asset as the representative when a bucket contains only videos', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const auth = factory.auth({ user });

  const video = await createTimelineAsset(ctx, user.id, new Date('2024-06-01T12:00:00.000Z'), {
    type: AssetType.Video,
    originalPath: '/path/to/video.mp4',
  });

  await expect(sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Month, type: AssetType.Video })).resolves.toEqual([
    expect.objectContaining({ representativeAssetId: video.id, count: 1 }),
  ]);
});
```

- [ ] Add a medium test that `/timeline/bucket` honors year/month/day boundaries:

```ts
it('returns assets only inside the requested bucket granularity', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const auth = factory.auth({ user });

  const jan1 = await createTimelineAsset(ctx, user.id, new Date('2024-01-01T00:00:00.000Z'));
  const jan31 = await createTimelineAsset(ctx, user.id, new Date('2024-01-31T23:59:59.000Z'));
  const feb1 = await createTimelineAsset(ctx, user.id, new Date('2024-02-01T00:00:00.000Z'));

  const year = JSON.parse(await sut.getTimeBucket(auth, { bucketSize: TimeBucketSize.Year, timeBucket: '2024-01-01' }));
  expect(year.id).toEqual([feb1.id, jan31.id, jan1.id]);

  const month = JSON.parse(
    await sut.getTimeBucket(auth, { bucketSize: TimeBucketSize.Month, timeBucket: '2024-01-01' }),
  );
  expect(month.id).toEqual([jan31.id, jan1.id]);

  const day = JSON.parse(await sut.getTimeBucket(auth, { bucketSize: TimeBucketSize.Day, timeBucket: '2024-01-01' }));
  expect(day.id).toEqual([jan1.id]);
});
```

- [ ] Import `AssetOrder`, `AssetType`, and `TimeBucketSize` where needed.
- [ ] Run the red medium test command:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run \
  test/medium/specs/services/timeline.service.spec.ts
```

Expected red failure: repository still hard-codes month truncation and does not return representative fields.

### 7. Add Failing Repository Medium Tests For Edge Scoping

- [ ] Edit `server/test/medium/specs/repositories/asset.repository.spec.ts`.
- [ ] Add a `describe('getTimeBuckets')` block near the existing `getTimeBucket` block.
- [ ] Add repository-level tests for:
  - `bucketSize` defaults to month if omitted.
  - `bucketSize: TimeBucketSize.Year` groups all matching assets in the year.
  - `bucketSize: TimeBucketSize.Day` isolates a single local date.
  - `takenAfter` and `takenBefore` remain inclusive for all bucket sizes.
  - `visibility: AssetVisibility.Archive`, `visibility: AssetVisibility.Locked`, `isTrashed: true`, `withStacked: true`, `assetType: AssetType.Video`, `albumId`, `withPartners`, `withSharedSpaces`, `tagIds`, `personIds`, `spacePersonIds`, `identityIds`, `city`, `country`, `make`, `model`, `rating`, and `bbox` continue to affect bucket counts and representative selection through the same filtered query.
  - `spaceId` counts assets reachable through direct `shared_space_asset` membership and linked `shared_space_library` membership without double-counting an asset that is reachable through both paths.
  - Empty filtered results return `[]` for all bucket sizes.
- [ ] Keep these tests focused by creating only the minimum fixtures per behavior. Prefer one explicit test for each risk rather than one oversized scenario.
- [ ] Run the red repository medium command:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run \
  test/medium/specs/repositories/asset.repository.spec.ts
```

Expected red failure: hard-coded month truncation and missing representative fields.

### 8. Implement Repository Bucket Granularity

- [ ] Edit `server/src/utils/database.ts`.
- [ ] Import `TimeBucketSize` and `dateTruncUnitForTimeBucketSize`.
- [ ] Change `truncatedDate` to accept a bucket size:

```ts
export function truncatedDate<O>(bucketSize = TimeBucketSize.Month) {
  return sql<O>`date_trunc(${sql.lit(dateTruncUnitForTimeBucketSize(bucketSize))}, "localDateTime" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
}
```

- [ ] Edit `server/src/repositories/asset.repository.ts`.
- [ ] Import `TimeBucketSize`.
- [ ] Add `bucketSize?: TimeBucketSize` to `TimeBucketOptions`.
- [ ] Extend `TimeBucketItem`:

```ts
export interface TimeBucketItem {
  timeBucket: string;
  count: number;
  representativeAssetId?: string | null;
  representativeThumbhash?: string | null;
  representativeRatio?: number | null;
}
```

- [ ] In `getTimeBuckets`, compute `const bucketSize = options.bucketSize ?? TimeBucketSize.Month;`.
- [ ] Select all fields needed for count and representative metadata in the filtered CTE:

```ts
.select([
  truncatedDate<Date>(bucketSize).as('timeBucket'),
  'asset.id',
  'asset.localDateTime',
  'asset.fileCreatedAt',
  eb.fn('encode', ['asset.thumbhash', sql.lit('base64')]).as('thumbhash'),
  eb.fn
    .coalesce(
      eb
        .case()
        .when(sql`asset."height" = 0 or asset."width" = 0 or asset."height" is null or asset."width" is null`)
        .then(eb.lit(1))
        .else(sql`round(asset."width"::numeric / asset."height"::numeric, 3)`)
        .end(),
      eb.lit(1),
    )
    .as('ratio'),
])
```

- [ ] Keep every existing filter clause in `getTimeBuckets`; only change selected columns, truncation, and final aggregation.
- [ ] Add a safe internal order direction helper inside the repository file:

```ts
const assetOrderDirection = (order: AssetOrder) => (order === AssetOrder.Asc ? sql.raw('asc') : sql.raw('desc'));
```

- [ ] Update the final grouped select:

```ts
const order = options.order ?? AssetOrder.Desc;
const direction = assetOrderDirection(order);

.select(sql<string>`("timeBucket" AT TIME ZONE 'UTC')::date::text`.as('timeBucket'))
.select((eb) => eb.fn.countAll<number>().as('count'))
.select(sql<string>`(array_agg("id" order by "localDateTime" ${direction}, "fileCreatedAt" ${direction}))[1]`.as('representativeAssetId'))
.select(sql<string | null>`(array_agg("thumbhash" order by "localDateTime" ${direction}, "fileCreatedAt" ${direction}))[1]`.as('representativeThumbhash'))
.select(sql<number>`(array_agg("ratio" order by "localDateTime" ${direction}, "fileCreatedAt" ${direction}))[1]`.as('representativeRatio'))
.groupBy('timeBucket')
.orderBy('timeBucket', order)
```

- [ ] In `getTimeBucket`, compute `const bucketSize = options.bucketSize ?? TimeBucketSize.Month;`.
- [ ] Replace `.where(truncatedDate(), '=', timeBucket.replace(/^[+-]/, ''))` with `.where(truncatedDate(bucketSize), '=', timeBucket)`.
- [ ] Do not loosen or reorder existing permission, visibility, stack, tag, person, shared-space, partner, or temporal filters.
- [ ] Run the repository and service medium tests:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run \
  test/medium/specs/services/timeline.service.spec.ts \
  test/medium/specs/repositories/asset.repository.spec.ts
```

Expected green result: count, representative, boundary, filter, and singular bucket tests pass.

### 9. Add API E2E Smoke Coverage

- [ ] Edit `e2e/src/specs/server/api/timeline.e2e-spec.ts`.
- [ ] Add tests under `GET /timeline/buckets`:
  - `bucketSize=year` returns `200` and each bucket has `timeBucket`, `count`, and representative metadata keys.
  - `bucketSize=month` still returns `200` and preserves existing total count semantics.
  - `bucketSize=day` returns `200`.
  - `bucketSize=week` returns `400`.
- [ ] Add tests under `GET /timeline/bucket`:
  - `bucketSize=year&timeBucket=<currentYear>-01-01` returns asset arrays.
  - `bucketSize=day&timeBucket=<current local day>` returns asset arrays.
  - `bucketSize=year&timeBucket=2000-02-01` returns `400`, independent of the current date.
  - `bucketSize=day&timeBucket=not-a-date` returns `400`.
- [ ] Run the e2e command once before the matching production behavior exists and confirm the new `bucketSize` assertions fail for the expected reason. Rerun it after implementation and confirm it is green:

```bash
pnpm --filter immich-e2e run test -- src/specs/server/api/timeline.e2e-spec.ts
```

Expected green result: timeline API smoke coverage passes against the e2e server harness.

### 10. Update Generated SQL Coverage

- [ ] Edit `server/src/repositories/asset.repository.ts` SQL generation decorators.
- [ ] Change `getTimeBuckets` from one generated case to three generated cases:

```ts
@GenerateSql(
  { params: [{}] },
  { params: [{ bucketSize: TimeBucketSize.Year }] },
  { params: [{ bucketSize: TimeBucketSize.Day }] },
)
```

- [ ] Change `getTimeBucket` to include month compatibility plus year and day cases:

```ts
@GenerateSql(
  { params: [DummyValue.TIME_BUCKET, { withStacked: true }, { user: { id: DummyValue.UUID } }] },
  { params: ['2000-01-01', { bucketSize: TimeBucketSize.Year }, { user: { id: DummyValue.UUID } }] },
  { params: ['2000-01-02', { bucketSize: TimeBucketSize.Day }, { user: { id: DummyValue.UUID } }] },
)
```

- [ ] Build the server and regenerate SQL:

```bash
SHARP_IGNORE_GLOBAL_LIBVIPS=true pnpm --filter immich build
make sql
```

- [ ] Review `server/src/queries/asset.repository.sql` and verify it contains:
  - `date_trunc('MONTH'` for compatibility.
  - `date_trunc('YEAR'` for yearly buckets.
  - `date_trunc('DAY'` for daily buckets.
  - Representative field aggregation in `AssetRepository.getTimeBuckets`.
- [ ] Run or capture `EXPLAIN` output for representative year, month, and day bucket queries against a seeded dev database. If year/day grouping produces an obvious full-scan regression beyond existing timeline behavior, either add the needed expression index/migration in this slice or record a follow-up performance task with the measured query plan.

### 11. Regenerate OpenAPI And TypeScript SDK

- [ ] Run:

```bash
make open-api-typescript
```

- [ ] Confirm generated changes appear in:
  - `open-api/immich-openapi-specs.json`
  - `open-api/typescript-sdk/src/fetch-client.ts`
  - `open-api/typescript-sdk/build/fetch-client.js`
  - `open-api/typescript-sdk/build/fetch-client.d.ts`
- [ ] Verify `getTimeBuckets` and `getTimeBucket` request types include `bucketSize?: TimeBucketSize`.
- [ ] Verify `TimeBucketsResponseDto` includes optional representative metadata fields.
- [ ] If `make open-api-typescript` touches `open-api/typescript-sdk/package.json` or lockfiles due install metadata, inspect the diff and keep only legitimate generated dependency metadata.

### 12. Fix TypeScript Callers And Mocks

- [ ] Run:

```bash
pnpm --filter immich-web run check:typescript
pnpm --filter immich-e2e run check
pnpm --filter @immich/sdk run build
```

- [ ] If generated types make existing hardcoded `TimeBucketsResponseDto` fixtures fail, update those fixtures to include representative fields or keep the schema fields optional so unrelated web slice code remains unchanged.
- [ ] Inspect likely affected files:
  - `web/src/lib/managers/timeline-manager/internal/album-picker-support.ts`
  - `web/src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts`
  - `web/src/lib/utils/timeline-util.spec.ts`
  - `e2e/src/ui/generators/timeline/rest-response.ts`
  - `e2e/src/ui/mock-network/timeline-network.ts`
- [ ] Keep web behavior unchanged in this slice. Any updates here are type/mocking compatibility only.

### 13. Full Verification

- [ ] Run all focused server tests:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs run \
  src/dtos/time-bucket.dto.spec.ts \
  src/controllers/timeline.controller.spec.ts \
  src/services/timeline.service.spec.ts \
  src/utils/timeline-bucket.spec.ts
```

- [ ] Run all focused medium tests:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run \
  test/medium/specs/services/timeline.service.spec.ts \
  test/medium/specs/repositories/asset.repository.spec.ts
```

- [ ] Run server type checks:

```bash
pnpm --filter immich run check
```

- [ ] Run SDK and downstream type checks:

```bash
pnpm --filter @immich/sdk run build
pnpm --filter immich-web run check:typescript
pnpm --filter immich-e2e run check
```

- [ ] Run timeline API e2e smoke:

```bash
pnpm --filter immich-e2e run test -- src/specs/server/api/timeline.e2e-spec.ts
```

- [ ] Run SQL and OpenAPI diff checks by confirming `git diff --check` is clean:

```bash
git diff --check
```

Expected final result: all focused tests and type checks pass, generated SQL/OpenAPI/SDK files are updated, and `git diff --check` reports no whitespace errors.

---

## Acceptance Criteria

- [ ] `GET /timeline/buckets` accepts `bucketSize=year|month|day`.
- [ ] `GET /timeline/bucket` accepts `bucketSize=year|month|day`.
- [ ] Missing `bucketSize` behaves exactly like the current month API.
- [ ] Invalid `bucketSize` returns `400`.
- [ ] Mismatched bucket start dates return `400` for the singular bucket endpoint.
- [ ] Year, month, and day counts use `asset.localDateTime` with the same UTC-compatible semantics as current month buckets.
- [ ] `/timeline/bucket` returns only assets within the requested year/month/day bucket.
- [ ] `/timeline/buckets` and `/timeline/bucket` agree under the same filters.
- [ ] Representative metadata is selected from the same filtered asset set as the count.
- [ ] Representative metadata works when the bucket contains only videos.
- [ ] Missing thumbhash or dimensions degrade to `representativeThumbhash: null` and a stable ratio fallback.
- [ ] Existing filters and access restrictions keep their current behavior for all bucket sizes, including EXIF/location, rating, bbox, person, tag, space, partner, shared-space, album, favorite, trash, visibility, stack, and media-type filters.
- [ ] Generated SQL includes month, year, and day truncation cases.
- [ ] OpenAPI and TypeScript SDK expose the new query parameter and response metadata.

---

## Edge Cases Covered By Tests

- [ ] No matching assets returns an empty bucket list.
- [ ] One bucket with one asset returns count `1` and representative metadata for that asset.
- [ ] Assets at `YYYY-01-01T00:00:00.000Z` are included in that year.
- [ ] Assets at the start of the next year/month/day are excluded from the previous bucket.
- [ ] Leap day `2024-02-29` works in day and month grouping.
- [ ] Invalid leap day `2023-02-29` is rejected.
- [ ] Five-digit years remain accepted for compatibility with existing timeline bucket tests.
- [ ] `takenAfter` and `takenBefore` boundaries remain inclusive.
- [ ] `isFavorite`, `isTrashed`, `visibility`, `assetType`, `personIds`, `spacePersonIds`, `identityIds`, `tagIds`, `spaceId`, `withSharedSpaces`, `withPartners`, `albumId`, `withStacked`, `city`, `country`, `make`, `model`, `rating`, and `bbox` continue to affect counts and representative metadata.
- [ ] Partner/shared-space unsupported combinations still return `400`.
- [ ] Locked visibility still requires elevated permission.
- [ ] Shared-space direct asset and linked library assets are reachable through the existing filters without double-counting.
- [ ] Representative metadata does not leak assets outside permissions or active filters.

---

## Commit Plan

- [ ] Commit after small DTO/controller/helper/service tests and implementation:

```bash
git add server/src/enum.ts server/src/dtos/time-bucket.dto.ts server/src/dtos/time-bucket.dto.spec.ts \
  server/src/controllers/timeline.controller.spec.ts server/src/services/timeline.service.ts \
  server/src/services/timeline.service.spec.ts server/src/utils/timeline-bucket.ts server/src/utils/timeline-bucket.spec.ts
git commit -m "feat(server): add timeline bucket size contract"
```

- [ ] Commit after repository behavior and medium/e2e tests:

```bash
git add server/src/utils/database.ts server/src/repositories/asset.repository.ts \
  server/test/medium/specs/services/timeline.service.spec.ts \
  server/test/medium/specs/repositories/asset.repository.spec.ts \
  e2e/src/specs/server/api/timeline.e2e-spec.ts
git commit -m "feat(server): support timeline year and day buckets"
```

- [ ] Commit generated artifacts and compatibility updates:

```bash
git add server/src/queries/asset.repository.sql open-api/immich-openapi-specs.json \
  open-api/typescript-sdk/src/fetch-client.ts open-api/typescript-sdk/build/fetch-client.js \
  open-api/typescript-sdk/build/fetch-client.d.ts
git add web e2e open-api/typescript-sdk/package.json pnpm-lock.yaml
git commit -m "chore(api): regenerate timeline bucket clients"
```

- [ ] Before each commit, run `git diff --check` and a focused test command matching the changed files.
