# Timeline Grouping Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two timeline-grouping bugs — (1) the mobile compact grouping control jumps Day→Year instead of bouncing up one level, and (2) year/month overview cover thumbnails are slow because the server computes a representative for every bucket via a full sort on every `getTimeBuckets` call.

**Architecture:** Bug 1 makes the mobile compact selector a stateful ping-pong (Year↔Month↔Day, inverting at each end). Bug 2 stops computing covers inside `getTimeBuckets` (counts only — the upstream hot path) and serves covers from a new, index-friendly, lazily-called `getTimeBucketCovers` endpoint that the web requests only for visible buckets. The new endpoint is added first (additive, safe), the web is switched to it, and only then are covers removed from `getTimeBuckets` so every commit leaves a shippable tree.

**Tech Stack:** Flutter/Dart + Riverpod (mobile), NestJS + Kysely + Postgres (server), SvelteKit + Svelte 5 runes + Vitest (web), Zod DTOs + oazapfts/OpenAPI-generated SDKs, Playwright/Vitest (e2e).

**Spec:** `docs/superpowers/specs/2026-06-08-timeline-grouping-fixes-design.md`

**Reference — enum index map** (`mobile/lib/domain/models/timeline.model.dart:1`): `enum GroupAssetsBy { day, month, auto, none, year }` ⇒ `day.index=0, month.index=1, auto.index=2, none.index=3, year.index=4`.

---

## Phase 1 — Bug 1: mobile drill-up bounce

### Task 1: Compact selector ping-pong

**Files:**

- Modify: `mobile/lib/presentation/widgets/timeline/timeline_grouping_selector.widget.dart:105-198` (`_TimelineGroupingCompactSelector`)
- Test: `mobile/test/presentation/widgets/timeline/timeline_grouping_selector_test.dart:302-330`

- [ ] **Step 1: Flip the existing assertion to RED**

In `timeline_grouping_selector_test.dart`, replace the existing `'compact mode cycles to the next grouping on tap'` test (around line 302) with the buggy-path fix plus the full bounce:

```dart
testWidgets('compact mode steps up one level on tap (Day -> Month)', (tester) async {
  await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.day.index);

  await tester.pumpConsumerWidget(const TimelineGroupingSelector.compact());
  await tester.pumpAndSettle();

  await tester.tap(find.byKey(const Key('timeline-grouping-compact-selector')));
  await tester.pumpAndSettle();

  expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.month.index);
  expect(find.text('Month'), findsOneWidget);
});

testWidgets('compact mode bounces between extremes', (tester) async {
  await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.year.index);
  await tester.pumpConsumerWidget(const TimelineGroupingSelector.compact());
  await tester.pumpAndSettle();

  final selector = find.byKey(const Key('timeline-grouping-compact-selector'));

  // Year -> Month -> Day (heading down)
  await tester.tap(selector);
  await tester.pumpAndSettle();
  expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.month.index);
  await tester.tap(selector);
  await tester.pumpAndSettle();
  expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.day.index);

  // Day -> Month -> Year (direction inverted at Day; preserved through Month)
  await tester.tap(selector);
  await tester.pumpAndSettle();
  expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.month.index);
  await tester.tap(selector);
  await tester.pumpAndSettle();
  expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.year.index);
});
```

Keep the existing long-press menu test (`'compact mode opens menu on long press'`, ~line 316) unchanged as the direct-selection regression guard.

- [ ] **Step 2: Run the tests, verify RED**

Run: `cd mobile && ~/.local/share/mise/installs/flutter/<ver>/bin/flutter test test/presentation/widgets/timeline/timeline_grouping_selector_test.dart`
Expected: FAIL — current code maps `day => year`, so the bounce/step-up assertions fail.

- [ ] **Step 3: Convert the compact selector to a stateful ping-pong**

Replace `class _TimelineGroupingCompactSelector extends StatelessWidget { ... }` (lines 105-198) with a `StatefulWidget`. The `build()` body is unchanged except every `selected`/`enabled`/`onSelected` becomes `widget.selected`/`widget.enabled`/`widget.onSelected`, and `_selectNext`/`_showMenu` move into the State.

```dart
class _TimelineGroupingCompactSelector extends StatefulWidget {
  const _TimelineGroupingCompactSelector({required this.selected, required this.enabled, required this.onSelected});

  final GroupAssetsBy selected;
  final bool enabled;
  final Future<void> Function(GroupAssetsBy groupBy) onSelected;

  @override
  State<_TimelineGroupingCompactSelector> createState() => _TimelineGroupingCompactSelectorState();
}

class _TimelineGroupingCompactSelectorState extends State<_TimelineGroupingCompactSelector> {
  // Direction the next tap moves: true = toward Day (zoom in), false = toward Year (zoom out).
  bool _zoomingIn = true;

  @override
  void initState() {
    super.initState();
    _syncDirectionAtExtreme(widget.selected);
  }

  @override
  void didUpdateWidget(_TimelineGroupingCompactSelector oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selected != widget.selected) {
      _syncDirectionAtExtreme(widget.selected);
    }
  }

  // At the extremes the direction is forced; in the middle (Month) keep whatever it was.
  void _syncDirectionAtExtreme(GroupAssetsBy selected) {
    switch (selected) {
      case GroupAssetsBy.year:
        _zoomingIn = true;
      case GroupAssetsBy.month:
        break;
      case GroupAssetsBy.day || GroupAssetsBy.auto || GroupAssetsBy.none:
        _zoomingIn = false;
    }
  }

  Future<void> _selectNext() async {
    final GroupAssetsBy next;
    switch (widget.selected) {
      case GroupAssetsBy.year:
        next = GroupAssetsBy.month;
        _zoomingIn = true;
      case GroupAssetsBy.month:
        next = _zoomingIn ? GroupAssetsBy.day : GroupAssetsBy.year;
      case GroupAssetsBy.day || GroupAssetsBy.auto || GroupAssetsBy.none:
        next = GroupAssetsBy.month;
        _zoomingIn = false;
    }
    await widget.onSelected(next);
  }

  // ... _showMenu moves here verbatim (it already only references context + widget.onSelected) ...

  @override
  Widget build(BuildContext context) {
    // body identical to the old StatelessWidget build(), with selected -> widget.selected,
    // enabled -> widget.enabled, onSelected -> widget.onSelected.
  }
}
```

Notes:

- `_zoomingIn` is logic-only (does not affect this widget's own render — the label comes from `widget.selected`), so no `setState` is needed when mutating it.
- The `switch` stays exhaustive over `GroupAssetsBy`; `auto`/`none` (never reached after normalisation) fold into the Day branch.

- [ ] **Step 4: Run the tests, verify GREEN**

Run: `cd mobile && ~/.local/share/mise/installs/flutter/<ver>/bin/flutter test test/presentation/widgets/timeline/timeline_grouping_selector_test.dart`
Expected: PASS (all three tests).

- [ ] **Step 5: Analyze (CI gate is `--fatal-infos` over lib + test)**

Run: `cd mobile && ~/.local/share/mise/installs/flutter/<ver>/bin/dart analyze --fatal-infos lib/presentation/widgets/timeline/timeline_grouping_selector.widget.dart test/presentation/widgets/timeline/timeline_grouping_selector_test.dart`
Expected: No issues.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/presentation/widgets/timeline/timeline_grouping_selector.widget.dart \
        mobile/test/presentation/widgets/timeline/timeline_grouping_selector_test.dart
git commit -m "fix(mobile): timeline grouping compact selector bounces instead of wrapping Day->Year"
```

> **Manual verify (before PR):** on an iOS build with the beta/Drift timeline active, confirm the app-bar compact chip is the control reported, and that Day→tap→Month, Month→tap→Year, Year→tap→Month.

---

## Phase 2 — Bug 2 server: add the cover endpoint (additive)

### Task 2: Extract the shared time-bucket asset filter

A behaviour-preserving refactor so `getTimeBuckets` and the new cover query share one filter definition (DRY, prevents divergence).

**Files:**

- Modify: `server/src/repositories/asset.repository.ts:879-1050` (`getTimeBuckets`)

- [ ] **Step 1: Add a filter helper above `getTimeBuckets`**

Move the entire `.$if(...)`/`.where(...)` chain currently inside the `asset` CTE (the chain spanning lines ~905-1016, from `.$if(!!options.forceEmptyResult, ...)` through the `takenBefore` filter) into a standalone helper. It operates on a Kysely `SelectQueryBuilder` over `asset` and returns it with all filters applied:

```ts
// Applies every time-bucket filter (visibility, album, space, person, tag, date, exif, etc.)
// Shared by getTimeBuckets and getTimeBucketCovers so the two never diverge.
function withTimeBucketAssetFilters<DB, TB extends keyof DB, O>(
  qb: SelectQueryBuilder<DB, TB, O>,
  options: TimeBucketOptions,
): SelectQueryBuilder<DB, TB, O> {
  return (
    qb
      .$if(!!options.forceEmptyResult, (qb) => qb.where(sql<SqlBool>`false`))
      // ... move the exact existing chain here, unchanged ...
      .$if(!!options.takenBefore, (qb) => qb.where('asset.localDateTime', '<=', new Date(options.takenBefore!))) as any
  );
}
```

(Match the generic signature used by the existing `withDefaultVisibility`/`hasPeople` helpers in this file; the `as any` casts already present in the moved lines stay.)

- [ ] **Step 2: Call the helper from `getTimeBuckets`**

The `asset` CTE keeps its `.select([...])` and then calls the helper instead of the inline chain:

```ts
.with('asset', (qb) =>
  withTimeBucketAssetFilters(
    qb.selectFrom('asset').select((eb) => [
      truncatedDate<Date>(bucketSize).as('timeBucket'),
      'asset.id',
      'asset.localDateTime',
      'asset.fileCreatedAt',
      'asset.thumbhash',
      eb.fn.coalesce(/* ...existing ratio expression unchanged... */).as('ratio'),
    ]),
    options,
  ),
)
```

- [ ] **Step 3: Run the existing time-bucket tests, verify still GREEN (no behaviour change)**

Run: `cd server && pnpm test -- --run src/repositories/asset.repository.spec.ts src/services/timeline.service.spec.ts`
Expected: PASS (refactor only).

- [ ] **Step 4: Commit**

```bash
git add server/src/repositories/asset.repository.ts
git commit -m "refactor(server): extract shared time-bucket asset filter helper"
```

### Task 3: `getTimeBucketCovers` repository method

**Files:**

- Modify: `server/src/repositories/asset.repository.ts` (add `TimeBucketCoverItem`, `getTimeBucketCovers`)
- Test (medium, real DB): `server/src/repositories/asset.repository.spec.ts` (or the medium suite where `getTimeBuckets` is exercised — match the existing location)

- [ ] **Step 1: Write the failing medium test**

Add a test that inserts assets across two years for one owner and asserts the representative matches the old `DISTINCT ON` pick (newest-in-bucket for DESC), honours a filter, and handles edge inputs:

```ts
it('getTimeBucketCovers returns the newest asset per requested bucket (DESC)', async () => {
  const { user } = await ctx.newUser();
  // 2023: older + newer; 2024: one. (helpers: ctx.newAsset — match existing spec usage)
  const a2023old = await ctx.newAsset({ ownerId: user.id, localDateTime: new Date('2023-02-01') });
  const a2023new = await ctx.newAsset({ ownerId: user.id, localDateTime: new Date('2023-09-01') });
  const a2024 = await ctx.newAsset({ ownerId: user.id, localDateTime: new Date('2024-03-01') });

  const covers = await repo.getTimeBucketCovers({
    bucketSize: TimeBucketSize.Year,
    order: AssetOrder.Desc,
    userIds: [user.id],
    timeBuckets: ['2023-01-01', '2024-01-01'],
  });

  const byBucket = Object.fromEntries(covers.map((c) => [c.timeBucket, c.representativeAssetId]));
  expect(byBucket['2023-01-01']).toBe(a2023new.id);
  expect(byBucket['2024-01-01']).toBe(a2024.id);
});

it('getTimeBucketCovers honours ASC order and returns [] for empty input', async () => {
  // ...same fixtures...
  const asc = await repo.getTimeBucketCovers({
    bucketSize: TimeBucketSize.Year,
    order: AssetOrder.Asc,
    userIds: [user.id],
    timeBuckets: ['2023-01-01'],
  });
  expect(asc[0].representativeAssetId).toBe(a2023old.id);
  expect(
    await repo.getTimeBucketCovers({
      bucketSize: TimeBucketSize.Year,
      order: AssetOrder.Desc,
      userIds: [user.id],
      timeBuckets: [],
    }),
  ).toEqual([]);
});

it('getTimeBucketCovers omits buckets with no matching assets', async () => {
  const covers = await repo.getTimeBucketCovers({
    bucketSize: TimeBucketSize.Year,
    order: AssetOrder.Desc,
    userIds: [user.id],
    timeBuckets: ['1999-01-01'],
  });
  expect(covers.find((c) => c.timeBucket === '1999-01-01')).toBeUndefined();
});
```

- [ ] **Step 2: Run it, verify RED**

Run: `cd server && pnpm test:medium -- --run src/repositories/asset.repository.spec.ts`
Expected: FAIL — `getTimeBucketCovers is not a function`.

- [ ] **Step 3: Implement `getTimeBucketCovers`**

Add the result type near `TimeBucketItem` (asset.repository.ts:~118):

```ts
export interface TimeBucketCoverItem {
  timeBucket: string;
  representativeAssetId: string;
  representativeThumbhash: string | null;
  representativeRatio: number;
}
```

Add `timeBuckets?: string[]` to `TimeBucketOptions`. Implement the method. Semantics (pin these with the test; finalise the Kysely against it):

- Empty `timeBuckets` ⇒ return `[]` without querying.
- Build the same filtered `asset` CTE as `getTimeBuckets` (via `withTimeBucketAssetFilters`), selecting `timeBucket`, `id`, encoded `thumbhash`, `ratio`, `localDateTime`, `fileCreatedAt`.
- **Narrow the scan to the requested buckets** so the work is bounded (not a full-library sort): in the CTE add a range predicate on the indexed date cast `(localDateTime AT TIME ZONE 'UTC')::date >= :minStart AND < :maxEnd`, where `minStart = min(requested bucket starts)` and `maxEnd = max(requested bucket starts) + 1 <unit>` (unit from `bucketSize`).
- Outer query: `.distinctOn('timeBucket').where('timeBucket', 'in', requestedBucketDates).orderBy('timeBucket').orderBy(sql\`("localDateTime" AT TIME ZONE 'UTC')::date\`, order).orderBy('fileCreatedAt', order)`and select`timeBucket::date::text`, `id as representativeAssetId`, encoded thumbhash, `ratio`.

This preserves the exact representative the old `bucket_representatives` CTE picked, but only for requested buckets and over an index-narrowed range. Equivalent SQL:

```sql
WITH asset AS (
  SELECT date_trunc(:unit, "localDateTime" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS "timeBucket",
         id, encode(thumbhash,'base64') AS thumbhash, <ratio> AS ratio, "localDateTime", "fileCreatedAt"
  FROM asset
  WHERE <shared filters>
    AND ("localDateTime" AT TIME ZONE 'UTC')::date >= :minStart
    AND ("localDateTime" AT TIME ZONE 'UTC')::date <  :maxEnd
)
SELECT DISTINCT ON ("timeBucket")
       ("timeBucket" AT TIME ZONE 'UTC')::date::text AS "timeBucket",
       id AS "representativeAssetId", thumbhash AS "representativeThumbhash", ratio AS "representativeRatio"
FROM asset
WHERE "timeBucket" IN (:requestedBuckets)
ORDER BY "timeBucket", ("localDateTime" AT TIME ZONE 'UTC')::date <order>, "fileCreatedAt" <order>;
```

- [ ] **Step 4: Run the medium tests, verify GREEN**

Run: `cd server && pnpm test:medium -- --run src/repositories/asset.repository.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/repositories/asset.repository.ts server/src/repositories/asset.repository.spec.ts
git commit -m "feat(server): add getTimeBucketCovers repository query (per-bucket cover, index-narrowed)"
```

### Task 4: Cover DTOs, service method, controller endpoint

**Files:**

- Modify: `server/src/dtos/time-bucket.dto.ts` (add `TimeBucketCoverDto` + `TimeBucketCoverResponseDto`)
- Modify: `server/src/services/timeline.service.ts` (add `getTimeBucketCovers`)
- Modify: `server/src/controllers/timeline.controller.ts` (add `@Get('bucket-covers')`)
- Test: `server/src/services/timeline.service.spec.ts`

- [ ] **Step 1: Write the failing service test**

```ts
it('getTimeBucketCovers runs access checks and forwards resolved options + buckets', async () => {
  mocks.access.timeline.checkOwnerAccess.mockResolvedValue(new Set(['user-id']));
  mocks.asset.getTimeBucketCovers.mockResolvedValue([]);

  await sut.getTimeBucketCovers(authStub.user1, {
    userId: 'user-id',
    bucketSize: TimeBucketSize.Year,
    timeBuckets: ['2024-01-01'],
  });

  expect(mocks.asset.getTimeBucketCovers).toHaveBeenCalledWith(
    expect.objectContaining({ timeBuckets: ['2024-01-01'], bucketSize: TimeBucketSize.Year, userIds: ['user-id'] }),
  );
});
```

- [ ] **Step 2: Run it, verify RED**

Run: `cd server && pnpm test -- --run src/services/timeline.service.spec.ts`
Expected: FAIL — `sut.getTimeBucketCovers is not a function`.

- [ ] **Step 3: Add the DTOs**

In `time-bucket.dto.ts`, after the existing schemas:

```ts
const TimeBucketCoverSchema = TimeBucketQueryBaseSchema.extend({
  timeBuckets: z
    .preprocess((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]), z.array(z.string()))
    .describe('Time bucket identifiers (YYYY-MM-DD) to resolve covers for'),
}).meta({ id: 'TimeBucketCoverDto' });

export const TimeBucketCoverResponseSchema = z
  .object({
    timeBucket: z.string().meta({ example: '2024-01-01' }),
    representativeAssetId: z.string().nullable().describe('Representative asset ID for this bucket'),
    representativeThumbhash: z.string().nullable().describe('Representative asset thumbhash, base64 encoded'),
    representativeRatio: z.number().nullable().describe('Representative asset width/height ratio'),
  })
  .meta({ id: 'TimeBucketCoverResponseDto' });

export class TimeBucketCoverDto extends createZodDto(TimeBucketCoverSchema) {}
export class TimeBucketCoverResponseDto extends createZodDto(TimeBucketCoverResponseSchema) {}
```

- [ ] **Step 4: Add the service method (reuses the exact same access path as `getTimeBuckets`)**

In `timeline.service.ts`:

```ts
async getTimeBucketCovers(auth: AuthDto, dto: TimeBucketCoverDto): Promise<TimeBucketCoverResponseDto[]> {
  await this.timeBucketChecks(auth, dto);
  const timeBucketOptions = await this.buildTimeBucketOptions(auth, dto);
  return this.assetRepository.getTimeBucketCovers({ ...timeBucketOptions, timeBuckets: dto.timeBuckets });
}
```

(Import `TimeBucketCoverDto`, `TimeBucketCoverResponseDto`. `timeBucketChecks` + `buildTimeBucketOptions` give identical auth/visibility/shared-link/space scoping to `getTimeBuckets`, so no cover can leak for an inaccessible asset.)

- [ ] **Step 5: Add the controller endpoint**

In `timeline.controller.ts`:

```ts
@Get('bucket-covers')
@Authenticated({ permission: Permission.AssetRead, sharedLink: true })
@ApiOkResponse({ type: [TimeBucketCoverResponseDto] })
@Endpoint({
  summary: 'Get time bucket covers',
  description: 'Resolve representative cover assets for the requested time buckets.',
  history: new HistoryBuilder().added('v1').internal('v1'),
})
getTimeBucketCovers(@Auth() auth: AuthDto, @Query() dto: TimeBucketCoverDto) {
  return this.service.getTimeBucketCovers(auth, dto);
}
```

(Import `TimeBucketCoverDto`, `TimeBucketCoverResponseDto`.)

- [ ] **Step 6: Run service tests, verify GREEN; then type-check + lint**

Run: `cd server && pnpm test -- --run src/services/timeline.service.spec.ts`
Expected: PASS.
Run: `cd server && npx tsc --noEmit && pnpm lint` (run `tsc` directly — `make check-server` caches and can mask DTO TS errors).
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/src/dtos/time-bucket.dto.ts server/src/services/timeline.service.ts \
        server/src/controllers/timeline.controller.ts server/src/services/timeline.service.spec.ts
git commit -m "feat(server): add GET /timeline/bucket-covers endpoint"
```

### Task 5: Regenerate the OpenAPI clients (new endpoint)

**Files:**

- Modify (generated): `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/src/fetch-client.ts`, `mobile/openapi/**`

- [ ] **Step 1: Build server spec + regenerate both clients**

Run: `cd server && pnpm build && pnpm sync:open-api && cd .. && make open-api`
(Java is required for the Dart client. `make open-api-typescript` alone leaves Dart stale; the CI "OpenAPI Clients" job runs `generate-open-api.sh` + git-diff and fails on any drift.)

- [ ] **Step 2: Verify the new SDK symbols exist**

Run: `grep -n "getTimeBucketCovers\|TimeBucketCoverResponseDto" open-api/typescript-sdk/src/fetch-client.ts`
Expected: present.

- [ ] **Step 3: Commit**

```bash
git add open-api mobile/openapi
git commit -m "chore(api): regenerate clients for getTimeBucketCovers"
```

---

## Phase 3 — Bug 2 web: lazy cover loading

### Task 6: Cover store + loader on `TimelineManager`; representative fields become reactive

**Files:**

- Modify: `web/src/lib/managers/timeline-manager/timeline-bucket.svelte.ts` (`TimelineBucket` rep fields → `$state`; `aggregateDayBucketsByMonth` drops rep)
- Modify: `web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts` (add `loadCoversForBuckets`, reset on (re)init)
- Test: `web/src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts`, `web/src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts`

- [ ] **Step 1: Update the manager spec to RED (covers come from the new endpoint, lazily)**

In `timeline-manager.svelte.spec.ts`, mock `getTimeBucketCovers` and assert the lazy flow:

```ts
it('loadCoversForBuckets fetches only requested buckets, dedupes, and applies covers', async () => {
  sdkMock.getTimeBuckets.mockResolvedValue([
    { timeBucket: '2024-01-01', count: 3 },
    { timeBucket: '2023-01-01', count: 5 },
  ]);
  sdkMock.getTimeBucketCovers.mockResolvedValue([
    {
      timeBucket: '2024-01-01',
      representativeAssetId: 'a-2024',
      representativeThumbhash: 'h',
      representativeRatio: 1.5,
    },
  ]);
  const manager = await makeManager({ grouping: 'year' });

  await manager.loadCoversForBuckets(['2024-01-01']);
  await manager.loadCoversForBuckets(['2024-01-01']); // second call deduped — no extra request

  expect(sdkMock.getTimeBucketCovers).toHaveBeenCalledTimes(1);
  expect(sdkMock.getTimeBucketCovers).toHaveBeenCalledWith(
    expect.objectContaining({ bucketSize: TimeBucketSize.Year, timeBuckets: ['2024-01-01'] }),
    expect.anything(),
  );
  const bucket = manager.timelineBuckets.find((b) => b.timeBucket === '2024-01-01')!;
  expect(bucket.representativeAssetId).toBe('a-2024');
  expect(bucket.representativeThumbhash).toBe('h');
});
```

Also: in `timeline-manager.svelte.spec.ts` and `timeline-grouping.svelte.spec.ts`, drop any assertion that `getTimeBuckets` returns/propagates `representativeAssetId` into `TimelineBucket` (those move to the cover flow).

- [ ] **Step 2: Run, verify RED**

Run: `cd web && pnpm test -- --run src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts`
Expected: FAIL — `loadCoversForBuckets` undefined.

- [ ] **Step 3: Make `TimelineBucket` representative fields reactive**

In `timeline-bucket.svelte.ts`, change the three readonly rep fields to `$state` (default null) and stop reading them from the response; add a setter:

```ts
representativeAssetId = $state<string | null>(null);
representativeThumbhash = $state<string | null>(null);
representativeRatio = $state<number | null>(null);
```

In the constructor, remove the three `this.representativeX = timeBucket.representativeX ?? null;` lines. Add:

```ts
setRepresentative(cover: { representativeAssetId: string | null; representativeThumbhash: string | null; representativeRatio: number | null }) {
  this.representativeAssetId = cover.representativeAssetId;
  this.representativeThumbhash = cover.representativeThumbhash;
  this.representativeRatio = cover.representativeRatio;
}
```

Update `aggregateDayBucketsByMonth` (lines 45-68) to drop representative handling (those scrubber months never show covers):

```ts
export function aggregateDayBucketsByMonth(
  timeBuckets: TimeBucketsResponseDto[],
  order: AssetOrder = AssetOrder.Desc,
): TimeBucketsResponseDto[] {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const months = new Map<string, TimeBucketsResponseDto>();
  for (const bucket of timeBuckets) {
    const timeBucket = getMonthBucket(bucket.timeBucket);
    const existing = months.get(timeBucket);
    months.set(timeBucket, { timeBucket, count: (existing?.count ?? 0) + bucket.count });
  }
  return [...months.values()].sort((a, b) =>
    order === AssetOrder.Asc ? a.timeBucket.localeCompare(b.timeBucket) : b.timeBucket.localeCompare(a.timeBucket),
  );
}
```

- [ ] **Step 4: Add `loadCoversForBuckets` to the manager**

In `timeline-manager.svelte.ts`, import `getTimeBucketCovers` from `@immich/sdk` and add private state + method. Use a `#coverRequested: Set<string>` (dedupe/memoize) reset whenever buckets re-init (in `#initializeTimelineBuckets`, before assigning `this.timelineBuckets`, do `this.#coverRequested.clear()`). Capture the init sequence so a late response from a stale grouping is dropped (cancel-on-change):

```ts
#coverRequested = new Set<string>();

async loadCoversForBuckets(timeBuckets: string[]) {
  const grouping = this.grouping;
  if (grouping === 'day') return;
  const todo = timeBuckets.filter((tb) => !this.#coverRequested.has(tb));
  if (todo.length === 0) return;
  for (const tb of todo) this.#coverRequested.add(tb);

  const sequence = this.#initSequence;
  const bucketSize = getTimeBucketSizeForGrouping(grouping);
  const requestOptions = toTimeBucketsRequest(this.#options, bucketSize);
  let covers: TimeBucketCoverResponseDto[];
  try {
    covers = await getTimeBucketCovers({ ...authManager.params, ...requestOptions, timeBuckets: todo });
  } catch {
    for (const tb of todo) this.#coverRequested.delete(tb); // allow retry
    return;
  }
  if (this.#destroyed || sequence !== this.#initSequence) return; // grouping/options changed — drop
  const byBucket = new Map(covers.map((c) => [c.timeBucket, c]));
  for (const bucket of this.timelineBuckets) {
    const cover = byBucket.get(bucket.timeBucket);
    if (cover) bucket.setRepresentative(cover);
  }
}
```

(`getTimeBucketCovers`/`TimeBucketCoverResponseDto` from `@immich/sdk`; `toTimeBucketsRequest`, `getTimeBucketSizeForGrouping`, `authManager` already imported in this file.)

- [ ] **Step 5: Run manager specs, verify GREEN**

Run: `cd web && pnpm test -- --run src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/managers/timeline-manager/timeline-bucket.svelte.ts \
        web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts \
        web/src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts \
        web/src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts
git commit -m "feat(web): lazy cover loader on TimelineManager; reactive bucket representatives"
```

### Task 7: Request covers for visible buckets; card renders skeleton → cover

**Files:**

- Modify: `web/src/lib/components/timeline/TimelineRepresentativeBuckets.svelte` (emit visible bucket keys)
- Modify: `web/src/lib/components/timeline/Timeline.svelte:749-753` (wire the callback to the manager)
- Test: `web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts`, `web/src/lib/components/timeline/TimelineBucketCard.spec.ts`

- [ ] **Step 1: Update component specs to RED**

In `TimelineRepresentativeBuckets.spec.ts`, assert the component calls `onRequestCovers` with the visible bucket keys (and not off-screen ones). In `TimelineBucketCard.spec.ts`, assert: with no representative + `loading`, it renders the skeleton/fallback (`data-state="loading"`); once `representativeAssetId` is set, it renders the image (`data-testid="timeline-bucket-card-image"`).

```ts
// TimelineRepresentativeBuckets.spec.ts
it('requests covers for visible buckets only', async () => {
  const onRequestCovers = vi.fn();
  render(TimelineRepresentativeBuckets, {
    grouping: 'year',
    buckets: [visibleBucket, offscreenBucket],
    visibleWindow: { top: 0, bottom: 500 },
    onRequestCovers,
  });
  await tick();
  expect(onRequestCovers).toHaveBeenCalledWith([visibleBucket.timeBucket]);
});
```

- [ ] **Step 2: Run, verify RED**

Run: `cd web && pnpm test -- --run src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts src/lib/components/timeline/TimelineBucketCard.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Emit visible bucket keys from `TimelineRepresentativeBuckets`**

Add an optional prop and an `$effect` that fires when the visible set changes:

```ts
interface Props {
  // ...existing...
  onRequestCovers?: (timeBuckets: string[]) => void;
}
let { /* ...existing..., */ onRequestCovers }: Props = $props();

let visibleBucketKeys = $derived(visibleBuckets.map((b) => b.timeBucket));
$effect(() => {
  if (grouping !== 'day' && visibleBucketKeys.length > 0) {
    onRequestCovers?.(visibleBucketKeys);
  }
});
```

(`onRequestCovers` is an optional prop, so existing call sites are unaffected; the manager already dedupes repeated keys.)

- [ ] **Step 4: Wire it in `Timeline.svelte`**

At the `TimelineRepresentativeBuckets` usage (line ~750), add:

```svelte
<TimelineRepresentativeBuckets
  grouping={activeGrouping}
  buckets={timelineManager.timelineBuckets}
  visibleWindow={timelineManager.visibleWindow}
  onRequestCovers={(timeBuckets) => void timelineManager.loadCoversForBuckets(timeBuckets)}
  ...
```

(`void` prevents the no-misused-promises / floating-promise lint on the async call.)

`TimelineBucketCard.svelte` needs no change — it already renders skeleton when `representativeAssetId` is null/`loading` and swaps to the image (with thumbhash fade) once set; the now-`$state` fields make that reactive.

- [ ] **Step 5: Run, verify GREEN; then svelte-check + lint**

Run: `cd web && pnpm test -- --run src/lib/components/timeline/`
Expected: PASS.
Run: `cd web && pnpm check && pnpm lint` (Lint Web is a separate `eslint --max-warnings 0` job — fix any floating-promise/`$effect` async warnings).
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/components/timeline/TimelineRepresentativeBuckets.svelte \
        web/src/lib/components/timeline/Timeline.svelte \
        web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts \
        web/src/lib/components/timeline/TimelineBucketCard.spec.ts
git commit -m "feat(web): lazily request year/month covers for visible buckets"
```

### Task 8: Album/space overlay covers

The overlay timeline merges two `getTimeBuckets` calls and previously preferred the album representative (`album-picker-support.ts`). Counts-only buckets drop that, so covers for the overlay must be resolved with album-preference.

**Files:**

- Modify: `web/src/lib/managers/timeline-manager/internal/album-picker-support.ts` (`mergeTimeBuckets` drops rep; keep counts merge)
- Modify: `web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts` (`loadCoversForBuckets` also resolves album-scoped covers when an album query is active, album preferred)
- Test: `web/src/lib/managers/timeline-manager/internal/album-picker-support.spec.ts` (if present) + a manager test

- [ ] **Step 1: RED — manager test for album-preferred covers**

```ts
it('prefers the album cover for overlay buckets', async () => {
  // manager configured with timelineAlbumId; getTimeBucketCovers resolves different reps for album vs main filters
  sdkMock.getTimeBucketCovers.mockImplementation(({ albumId }) =>
    Promise.resolve([
      {
        timeBucket: '2024-01-01',
        representativeAssetId: albumId ? 'album-asset' : 'main-asset',
        representativeThumbhash: null,
        representativeRatio: 1,
      },
    ]),
  );
  const manager = await makeManager({ grouping: 'year', timelineAlbumId: 'album-1' });
  await manager.loadCoversForBuckets(['2024-01-01']);
  expect(manager.timelineBuckets.find((b) => b.timeBucket === '2024-01-01')!.representativeAssetId).toBe('album-asset');
});
```

- [ ] **Step 2: Run, verify RED**

Run: `cd web && pnpm test -- --run src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Drop rep from `mergeTimeBuckets`; resolve album-preferred covers**

In `album-picker-support.ts`, `mergeTimeBuckets` keeps the count/union behaviour but no longer carries representative fields (counts-only). In `loadCoversForBuckets`, when `getTimelineAlbumQueryOptions(this.#options, bucketSize)` is non-null, also fetch covers with those album options and prefer them:

```ts
const albumOptions = getTimelineAlbumQueryOptions(this.#options, bucketSize);
const [mainCovers, albumCovers] = await Promise.all([
  getTimeBucketCovers({ ...authManager.params, ...requestOptions, timeBuckets: todo }),
  albumOptions
    ? getTimeBucketCovers({ ...authManager.params, ...albumOptions, timeBuckets: todo })
    : Promise.resolve([]),
]);
const byBucket = new Map(mainCovers.map((c) => [c.timeBucket, c]));
for (const cover of albumCovers) byBucket.set(cover.timeBucket, cover); // album preferred
```

- [ ] **Step 4: Run, verify GREEN; check + lint**

Run: `cd web && pnpm test -- --run src/lib/managers/timeline-manager/ && pnpm check && pnpm lint`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/managers/timeline-manager/internal/album-picker-support.ts \
        web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts \
        web/src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts
git commit -m "feat(web): resolve album/space overlay covers with album preference"
```

---

## Phase 4 — Bug 2: remove covers from `getTimeBuckets` (hot-path fix) + e2e

### Task 9: Remove the representative CTE from `getTimeBuckets`

Now that nothing reads covers from `getTimeBuckets`, drop the expensive sort and the response fields.

**Files:**

- Modify: `server/src/repositories/asset.repository.ts:879-1050` (`getTimeBuckets` → counts only; drop rep from `TimeBucketItem`)
- Modify: `server/src/dtos/time-bucket.dto.ts` (drop rep fields from `TimeBucketsResponseSchema`)
- Test: `server/src/repositories/asset.repository.spec.ts`, `e2e/src/specs/server/api/timeline.e2e-spec.ts`

- [ ] **Step 1: RED — assert counts-only**

Update the repo medium test for `getTimeBuckets` to assert the result has `timeBucket` + `count` and **no** `representativeAssetId`. Update `e2e/src/specs/server/api/timeline.e2e-spec.ts:78-82` to assert the bucket has no `representativeAssetId/Thumbhash/Ratio`, and add a case hitting `GET /timeline/bucket-covers` (happy path + one access-control case: a user requesting covers for another user's buckets gets none).

- [ ] **Step 2: Run, verify RED**

Run: `cd server && pnpm test:medium -- --run src/repositories/asset.repository.spec.ts`
Expected: FAIL (rep still present).

- [ ] **Step 3: Strip the representative CTE**

In `getTimeBuckets`, delete the `.with('bucket_representatives', ...)` CTE and the `.innerJoin('bucket_representatives', ...)` + the three `bucket_representatives.representativeX` selects. The final query becomes `bucket_counts` only:

```ts
.with('asset', (qb) => withTimeBucketAssetFilters(qb.selectFrom('asset').select((eb) => [truncatedDate<Date>(bucketSize).as('timeBucket'), 'asset.id']), options))
.with('bucket_counts', (qb) => qb.selectFrom('asset').select(['timeBucket']).select((eb) => eb.fn.countAll<number>().as('count')).groupBy('timeBucket'))
.selectFrom('bucket_counts')
.select(sql<string>`("bucket_counts"."timeBucket" AT TIME ZONE 'UTC')::date::text`.as('timeBucket'))
.select('bucket_counts.count')
.orderBy('bucket_counts.timeBucket', order)
.execute() as any as Promise<TimeBucketItem[]>;
```

(The `asset` CTE now only needs `timeBucket` + `id`; drop the `localDateTime/thumbhash/ratio/fileCreatedAt` selects there.) Remove `representativeAssetId/Thumbhash/Ratio` from the `TimeBucketItem` interface (asset.repository.ts:118-120). In `time-bucket.dto.ts`, delete the three `representative*` fields from `TimeBucketsResponseSchema`.

- [ ] **Step 4: Run server + e2e, verify GREEN; tsc + lint**

Run: `cd server && pnpm test:medium -- --run src/repositories/asset.repository.spec.ts && npx tsc --noEmit && pnpm lint`
Run (api e2e, needs the e2e stack): `cd e2e && pnpm test -- --run src/specs/server/api/timeline.e2e-spec.ts`
Expected: PASS / clean.

- [ ] **Step 5: Regenerate clients (response shape changed) + commit**

```bash
cd server && pnpm build && pnpm sync:open-api && cd .. && make open-api
git add server/src/repositories/asset.repository.ts server/src/dtos/time-bucket.dto.ts \
        server/src/repositories/asset.repository.spec.ts e2e/src/specs/server/api/timeline.e2e-spec.ts \
        open-api mobile/openapi
git commit -m "perf(server): getTimeBuckets returns counts only; covers moved to bucket-covers endpoint"
```

### Task 10: Update the Playwright UI mock generator

**Files:**

- Modify: `e2e/src/ui/generators/timeline/rest-response.ts:227-234` and `e2e/src/ui/generators/timeline/rest-response.spec.ts`

- [ ] **Step 1: RED — generator no longer inlines representatives**

Update `rest-response.spec.ts` expectations: `getTimeBuckets` mock output is `{ timeBucket, count }` only; add a generator/handler that mocks `GET /timeline/bucket-covers` returning `{ timeBucket, representativeAssetId, representativeThumbhash, representativeRatio }` for requested buckets.

- [ ] **Step 2: Run, verify RED**

Run: `cd e2e && pnpm test -- --run src/ui/generators/timeline/rest-response.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Update the generator**

Remove the `representativeAssetId/Thumbhash/Ratio` fields from the bucket response builder (lines 227-234); add a `bucket-covers` response builder that returns a representative per requested bucket (reuse `filteredAssets[0]` per bucket).

- [ ] **Step 4: Run, verify GREEN**

Run: `cd e2e && pnpm test -- --run src/ui/generators/timeline/rest-response.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the Playwright timeline grouping web suite (if affected)**

Run: `make e2e-web-dev` (or the targeted grouping spec) against a running stack; confirm year/month tiles still show covers.

- [ ] **Step 6: Commit**

```bash
git add e2e/src/ui/generators/timeline/rest-response.ts e2e/src/ui/generators/timeline/rest-response.spec.ts
git commit -m "test(e2e): mock bucket-covers endpoint; getTimeBuckets counts-only"
```

---

## Phase 5 — Verification

### Task 11: Mobile cover path — verify only (no code)

- [ ] **Step 1:** Confirm in source that mobile covers stay lazy + disk-cached: `overview_segment.model.dart` still loads the representative via `FutureBuilder(timelineService.loadAssets(firstAssetIndex, 1))`; remote thumbnails go through the disk-cached providers (iOS `URLSession returnCacheDataElseLoad`, Android OkHttp). No mobile code consumes `representativeAssetId` from `getTimeBuckets` (`grep -rn representativeAssetId mobile/lib` → none).
- [ ] **Step 2:** Note in the PR description that mobile was verified unchanged and that the mobile `mergedBucket` count-query optimization is explicitly out of scope.

### Task 12: Performance validation (EXPLAIN ANALYZE on real data)

- [ ] **Step 1:** Against the personal instance DB (220k+ assets), run `EXPLAIN ANALYZE` for: (a) old `getTimeBuckets` with the representative CTE (baseline, from git stash/main), (b) new `getTimeBuckets` counts-only, (c) `getTimeBucketCovers` for a year view's visible buckets — unfiltered and person-filtered.
- [ ] **Step 2:** If the cover query's filtered case is **not** index-served (no range scan on `asset_localDateTime_idx`), add a supporting index as a fork migration in `server/src/schema/migrations-gallery/` (round timestamp, e.g. `1780000000000`), re-measure, and record before/after timings in the PR. Otherwise note that no new index was needed.

### Task 13: Full-suite gates before PR

- [ ] **Step 1:** `cd server && npx tsc --noEmit && pnpm lint && pnpm test -- --run` (vitest skips tsc/lint — run all three).
- [ ] **Step 2:** `cd web && pnpm check && pnpm lint && pnpm test -- --run`.
- [ ] **Step 3:** `cd mobile && ~/.local/share/mise/installs/flutter/<ver>/bin/dart analyze --fatal-infos lib test` and `flutter test test/presentation/widgets/timeline/`.
- [ ] **Step 4:** Confirm OpenAPI is regen-clean: `make open-api` then `git status --porcelain open-api mobile/openapi` is empty.
- [ ] **Step 5:** Open the PR(s). Bug 1 and Bug 2 are independent and may be split into two PRs (Phase 1 vs Phases 2-5).

---

## Self-review notes

- **Spec coverage:** Bug 1 bounce (Task 1); counts-only `getTimeBuckets` (Task 9); index-friendly cover endpoint (Tasks 3-4); lazy web loading + dedupe/memoize/cancel (Tasks 6-7); album overlay (Task 8); authorization via shared `timeBucketChecks`/`buildTimeBucketOptions` (Task 4) + e2e access case (Task 9); scope boundary — `gallery-viewer-grouping.ts` untouched (not in any task by design); OpenAPI regen (Tasks 5, 9); e2e blast radius (Tasks 9-10); mobile verify-only (Task 11); EXPLAIN ANALYZE (Task 12).
- **Ordering:** new endpoint added (Tasks 3-5) and web switched (Tasks 6-8) _before_ covers are removed from `getTimeBuckets` (Task 9), so every commit is shippable.
- **Type consistency:** `getTimeBucketCovers` (repo/service/SDK), `TimeBucketCoverItem` (repo), `TimeBucketCoverDto`/`TimeBucketCoverResponseDto` (server + SDK), `loadCoversForBuckets`/`setRepresentative` (web), `onRequestCovers` (component) used consistently across tasks.
