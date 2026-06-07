# Timeline Grouping Slice 7 Mobile Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted-index-safe `year` grouping mode to the mobile timeline foundation: settings, bucket queries, headers, scrubber labels/snapping, and scroll targeting.

**Architecture:** This slice extends the existing mobile `GroupAssetsBy` model instead of introducing a new mobile grouping system. Repository year grouping is implemented through the existing Drift date-format helpers and the custom `mergedBucket` query; UI parity is limited to headers and scrubber behavior because mobile representative-card drill-down needs a later route-scoped temporal filter design.

**Tech Stack:** Flutter, Dart, Riverpod, Drift, easy_localization, flutter_test.

---

## Scope Boundaries

In scope:

- Add `GroupAssetsBy.year` without changing the persisted indexes of `day`, `month`, `auto`, or `none`.
- Add `HeaderType.year`.
- Add year grouping to mobile timeline Drift bucket queries.
- Add the `Year` option to mobile asset-list grouping settings.
- Fix the existing stale-value settings bug where changing a radio option writes the previous grouping value.
- Make year grouped mobile timelines show year-only headers, year-only scrubber labels, year matching for scrubber snapping, and year fallback for programmatic scroll-to-date.

Out of scope:

- Mobile representative cards.
- Mobile year/month card click drill-down.
- Mobile temporal filter chip or FilterSheet synchronization.
- Changing mobile `auto` semantics.
- Changing `GroupAssetsBy.none` chunking.

## File Map

- Modify: `mobile/lib/domain/models/timeline.model.dart`
  - Adds `GroupAssetsBy.year` at the end of the enum and `HeaderType.year`.
- Modify: `mobile/lib/infrastructure/repositories/timeline.repository.dart`
  - Adds year formatting/parsing support for all expression-based bucket queries.
- Modify: `mobile/lib/infrastructure/entities/merged_asset.drift`
  - Adds `GroupAssetsBy.year.index` handling to the custom `mergedBucket` SQL.
- Modify/generated: `mobile/lib/infrastructure/entities/merged_asset.drift.dart`
  - Regenerated output for the custom query above.
- Modify: `mobile/lib/widgets/settings/asset_list_settings/asset_list_group_settings.dart`
  - Adds the `Year` radio option and persists the selected value.
- Modify: `mobile/lib/presentation/widgets/timeline/segment_builder.dart`
  - Adds header extent for `HeaderType.year`.
- Modify: `mobile/lib/presentation/widgets/timeline/fixed/segment_builder.dart`
  - Maps `GroupAssetsBy.year` to `HeaderType.year`.
- Modify: `mobile/lib/presentation/widgets/timeline/header.widget.dart`
  - Renders localized year-only headers with existing bulk selection.
- Modify: `mobile/lib/presentation/widgets/timeline/scrubber.widget.dart`
  - Consumes selected grouping, uses year labels/matching in year mode.
- Create: `mobile/lib/presentation/widgets/timeline/scrubber_segments.dart`
  - Testable scrubber segment helpers extracted from `scrubber.widget.dart`.
- Create: `mobile/lib/presentation/widgets/timeline/timeline_scroll_target.dart`
  - Testable exact-day, month, then year fallback helper for scroll-to-date.
- Modify: `mobile/lib/presentation/widgets/timeline/timeline.widget.dart`
  - Passes grouping to `Scrubber` and uses `findTimelineScrollTargetSegment`.
- Test: `mobile/test/domain/models/timeline_grouping_test.dart`
- Test: `mobile/test/infrastructure/repositories/timeline_year_grouping_test.dart`
- Test: `mobile/test/infrastructure/repositories/merged_asset_drift_test.dart`
- Test: `mobile/test/infrastructure/repositories/shared_space_repository_test.dart`
- Test: `mobile/test/widgets/settings/asset_list_group_settings_test.dart`
- Test: `mobile/test/presentation/widgets/timeline/fixed_segment_builder_test.dart`
- Test: `mobile/test/presentation/widgets/timeline/timeline_header_test.dart`
- Test: `mobile/test/presentation/widgets/timeline/scrubber_segments_test.dart`
- Test: `mobile/test/presentation/widgets/timeline/timeline_scroll_target_test.dart`

## Task 1: Mobile Grouping Model And Repository Year Buckets

**Files:**

- Modify: `mobile/lib/domain/models/timeline.model.dart`
- Modify: `mobile/lib/infrastructure/repositories/timeline.repository.dart`
- Modify: `mobile/lib/infrastructure/entities/merged_asset.drift`
- Modify/generated: `mobile/lib/infrastructure/entities/merged_asset.drift.dart`
- Modify: `mobile/lib/presentation/widgets/timeline/header.widget.dart`
- Create: `mobile/test/domain/models/timeline_grouping_test.dart`
- Create: `mobile/test/presentation/widgets/timeline/fixed_segment_builder_test.dart`
- Create: `mobile/test/presentation/widgets/timeline/timeline_header_test.dart`
- Create: `mobile/test/infrastructure/repositories/timeline_year_grouping_test.dart`
- Modify: `mobile/test/infrastructure/repositories/merged_asset_drift_test.dart`
- Modify: `mobile/test/infrastructure/repositories/shared_space_repository_test.dart`

- [ ] **Step 1: Write failing enum-index tests**

Create `mobile/test/domain/models/timeline_grouping_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';

void main() {
  group('mobile timeline grouping model', () {
    test('preserves persisted GroupAssetsBy indexes when adding year', () {
      expect(GroupAssetsBy.day.index, 0);
      expect(GroupAssetsBy.month.index, 1);
      expect(GroupAssetsBy.auto.index, 2);
      expect(GroupAssetsBy.none.index, 3);
      expect(GroupAssetsBy.year.index, 4);
    });

    test('contains a year header type', () {
      expect(HeaderType.values, contains(HeaderType.year));
    });
  });
}
```

- [ ] **Step 2: Run enum-index tests and verify red**

Run:

```bash
cd mobile
flutter test test/domain/models/timeline_grouping_test.dart
```

Expected red failure:

- `Member not found: 'year'` for `GroupAssetsBy.year`
- `Member not found: 'year'` for `HeaderType.year`

- [ ] **Step 3: Write failing Drift custom SQL year tests**

Append tests to `mobile/test/infrastructure/repositories/merged_asset_drift_test.dart`.

Add this test near the other `mergedBucket` tests:

```dart
  test('mergedBucket groups timeline assets by year using the appended year enum index', () async {
    const userId = 'viewer-1';
    await db
        .into(db.userEntity)
        .insert(UserEntityCompanion.insert(id: userId, email: 'viewer@test.dev', name: 'Viewer'));

    Future<void> insertRemote(String id, DateTime date) {
      return db.into(db.remoteAssetEntity).insert(
        RemoteAssetEntityCompanion.insert(
          id: id,
          name: '$id.jpg',
          type: AssetType.image,
          checksum: 'checksum-$id',
          ownerId: userId,
          visibility: AssetVisibility.timeline,
          createdAt: Value(date),
          updatedAt: Value(date),
          localDateTime: Value(date),
        ),
      );
    }

    await insertRemote('remote-2025-a', DateTime(2025, 12, 31, 12));
    await insertRemote('remote-2025-b', DateTime(2025, 1, 1, 12));
    await insertRemote('remote-2024', DateTime(2024, 6, 1, 12));

    final buckets = await db.mergedAssetDrift
        .mergedBucket(groupBy: GroupAssetsBy.year.index, userIds: [userId], currentUserId: userId)
        .get();

    expect(buckets.map((bucket) => bucket.bucketDate), ['2025', '2024']);
    expect(buckets.map((bucket) => bucket.assetCount), [2, 1]);
  });

  test('mergedBucket keeps day and month enum index behavior unchanged', () async {
    expect(GroupAssetsBy.day.index, 0);
    expect(GroupAssetsBy.month.index, 1);
    expect(GroupAssetsBy.auto.index, 2);
    expect(GroupAssetsBy.none.index, 3);
    expect(GroupAssetsBy.year.index, 4);
  });
```

If this file already has a helper for inserting users/assets, reuse the helper instead of duplicating setup.

- [ ] **Step 4: Write failing shared-space repository year tests**

Append this test after the existing `groups by month when GroupAssetsBy.month` test in `mobile/test/infrastructure/repositories/shared_space_repository_test.dart`:

```dart
    test('groups by year when GroupAssetsBy.year', () async {
      final asset1 = await ctx.newRemoteAsset(ownerId: userId, createdAt: DateTime(2026, 12, 31, 12));
      final asset2 = await ctx.newRemoteAsset(ownerId: userId, createdAt: DateTime(2026, 1, 1, 12));
      final asset3 = await ctx.newRemoteAsset(ownerId: userId, createdAt: DateTime(2025, 6, 5, 12));
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset1.id);
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset2.id);
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset3.id);

      final query = sut.sharedSpace(spaceId, GroupAssetsBy.year);
      final buckets = await query.bucketSource().first;

      expect(buckets, [
        TimeBucket(date: DateTime(2026), assetCount: 2),
        TimeBucket(date: DateTime(2025), assetCount: 1),
      ]);
    });
```

Add this boundary test immediately after it:

```dart
    test('year grouping keeps December 31 and January 1 in different buckets', () async {
      final dec31 = await ctx.newRemoteAsset(ownerId: userId, createdAt: DateTime(2025, 12, 31, 12));
      final jan1 = await ctx.newRemoteAsset(ownerId: userId, createdAt: DateTime(2026, 1, 1, 12));
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: dec31.id);
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: jan1.id);

      final query = sut.sharedSpace(spaceId, GroupAssetsBy.year);
      final buckets = await query.bucketSource().first;

      expect(buckets, [
        TimeBucket(date: DateTime(2026), assetCount: 1),
        TimeBucket(date: DateTime(2025), assetCount: 1),
      ]);
    });
```

- [ ] **Step 5: Write failing repository path coverage tests**

Create `mobile/test/infrastructure/repositories/timeline_year_grouping_test.dart`:

```dart
import 'package:drift/drift.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/infrastructure/entities/remote_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import 'package:intl/date_symbol_data_local.dart';

import '../../medium/repository_context.dart';

void main() {
  late MediumRepositoryContext ctx;
  late DriftTimelineRepository sut;

  setUpAll(() async {
    await initializeDateFormatting('en');
  });

  setUp(() {
    ctx = MediumRepositoryContext();
    sut = DriftTimelineRepository(ctx.db);
  });

  tearDown(() async {
    await ctx.dispose();
  });

  test('generic remote buckets group by year', () async {
    final user = await ctx.newUser();
    await ctx.newRemoteAsset(ownerId: user.id, createdAt: DateTime(2026, 4, 1, 12));
    await ctx.newRemoteAsset(ownerId: user.id, createdAt: DateTime(2025, 9, 1, 12));

    final buckets = await sut.remote(user.id, GroupAssetsBy.year).bucketSource().first;

    expect(buckets, [
      TimeBucket(date: DateTime(2026), assetCount: 1),
      TimeBucket(date: DateTime(2025), assetCount: 1),
    ]);
  });

  test('generic remote buckets fall back to createdAt year when localDateTime is null', () async {
    final user = await ctx.newUser();
    final asset = await ctx.newRemoteAsset(ownerId: user.id, createdAt: DateTime(2024, 6, 1, 12));
    await (ctx.db.update(ctx.db.remoteAssetEntity)..where((row) => row.id.equals(asset.id))).write(
      const RemoteAssetEntityCompanion(localDateTime: Value(null)),
    );

    final buckets = await sut.remote(user.id, GroupAssetsBy.year).bucketSource().first;

    expect(buckets, [TimeBucket(date: DateTime(2024), assetCount: 1)]);
  });

  test('remote album buckets group by year', () async {
    final user = await ctx.newUser();
    final album = await ctx.newRemoteAlbum(ownerId: user.id);
    final asset1 = await ctx.newRemoteAsset(ownerId: user.id, createdAt: DateTime(2026, 2, 1, 12));
    final asset2 = await ctx.newRemoteAsset(ownerId: user.id, createdAt: DateTime(2026, 10, 1, 12));
    final asset3 = await ctx.newRemoteAsset(ownerId: user.id, createdAt: DateTime(2025, 2, 1, 12));
    await ctx.insertRemoteAlbumAsset(albumId: album.id, assetId: asset1.id);
    await ctx.insertRemoteAlbumAsset(albumId: album.id, assetId: asset2.id);
    await ctx.insertRemoteAlbumAsset(albumId: album.id, assetId: asset3.id);

    final buckets = await sut.remoteAlbum(album.id, GroupAssetsBy.year).bucketSource().first;

    expect(buckets, [
      TimeBucket(date: DateTime(2026), assetCount: 2),
      TimeBucket(date: DateTime(2025), assetCount: 1),
    ]);
  });

  test('local album buckets group by year', () async {
    final album = await ctx.newLocalAlbum();
    final asset1 = await ctx.newLocalAsset(createdAt: DateTime(2026, 2, 1, 12));
    final asset2 = await ctx.newLocalAsset(createdAt: DateTime(2025, 2, 1, 12));
    await ctx.newLocalAlbumAsset(albumId: album.id, assetId: asset1.id);
    await ctx.newLocalAlbumAsset(albumId: album.id, assetId: asset2.id);

    final buckets = await sut.localAlbum(album.id, GroupAssetsBy.year).bucketSource().first;

    expect(buckets, [
      TimeBucket(date: DateTime(2026), assetCount: 1),
      TimeBucket(date: DateTime(2025), assetCount: 1),
    ]);
  });
}
```

- [ ] **Step 6: Run repository tests and verify red**

Run:

```bash
cd mobile
flutter test \
  test/domain/models/timeline_grouping_test.dart \
  test/infrastructure/repositories/timeline_year_grouping_test.dart \
  test/infrastructure/repositories/merged_asset_drift_test.dart \
  test/infrastructure/repositories/shared_space_repository_test.dart
```

Expected red failures:

- `GroupAssetsBy.year` and `HeaderType.year` are not defined.
- Once enum placeholders are added locally by the compiler, `mergedBucket` returns null/incorrect dates for group index 4 because SQL only handles indexes 0 and 1.
- `truncateDate(GroupAssetsBy.year)` is missing.

- [ ] **Step 7: Write failing segment switch exhaustiveness tests**

Create `mobile/test/presentation/widgets/timeline/fixed_segment_builder_test.dart` now, not in Task 3, because adding enum values makes existing Dart switch expressions non-exhaustive immediately:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/fixed/segment_builder.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment_builder.dart';

void main() {
  group('FixedSegmentBuilder grouping headers', () {
    test('uses year headers for year grouping', () {
      final segments = FixedSegmentBuilder(
        buckets: [
          TimeBucket(date: DateTime(2026), assetCount: 2),
          TimeBucket(date: DateTime(2025), assetCount: 1),
        ],
        tileHeight: 100,
        columnCount: 4,
        groupBy: GroupAssetsBy.year,
      ).generate();

      expect(segments, hasLength(2));
      expect(segments[0].header, HeaderType.year);
      expect(segments[1].header, HeaderType.year);
      expect(segments[0].headerExtent, SegmentBuilder.headerExtent(HeaderType.year));
    });

    test('keeps month headers for month grouping', () {
      final segments = FixedSegmentBuilder(
        buckets: [TimeBucket(date: DateTime(2026, 4), assetCount: 2)],
        tileHeight: 100,
        columnCount: 4,
        groupBy: GroupAssetsBy.month,
      ).generate();

      expect(segments.single.header, HeaderType.month);
    });

    test('keeps month-and-day headers only for the first day of each month in day grouping', () {
      final segments = FixedSegmentBuilder(
        buckets: [
          TimeBucket(date: DateTime(2026, 4, 2), assetCount: 1),
          TimeBucket(date: DateTime(2026, 4, 1), assetCount: 1),
          TimeBucket(date: DateTime(2026, 3, 31), assetCount: 1),
        ],
        tileHeight: 100,
        columnCount: 4,
        groupBy: GroupAssetsBy.day,
      ).generate();

      expect(segments.map((segment) => segment.header), [
        HeaderType.monthAndDay,
        HeaderType.day,
        HeaderType.monthAndDay,
      ]);
    });

    test('keeps none headers for flat grouping', () {
      final segments = FixedSegmentBuilder(
        buckets: const [Bucket(assetCount: 8)],
        tileHeight: 100,
        columnCount: 4,
        groupBy: GroupAssetsBy.none,
      ).generate();

      expect(segments.single.header, HeaderType.none);
      expect(segments.single.headerExtent, 0);
    });
  });
}
```

Run:

```bash
cd mobile
mise exec -- flutter test test/presentation/widgets/timeline/fixed_segment_builder_test.dart
```

Expected red failure:

- `SegmentBuilder.headerExtent` does not handle `HeaderType.year`.
- `FixedSegmentBuilder.generate()` does not handle `GroupAssetsBy.year`.

- [ ] **Step 8: Write failing year header renderer test**

Create `mobile/test/presentation/widgets/timeline/timeline_header_test.dart` now as part of Task 1. Once `FixedSegmentBuilder` emits `HeaderType.year`, the renderer must not leave the reserved header area blank:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/presentation/widgets/timeline/header.widget.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';

void main() {
  testWidgets('renders a year-only header with bulk select affordance', (tester) async {
    final timelineService = TimelineService(
      (
        assetSource: (_, _) async => const [],
        bucketSource: () => Stream.value([TimeBucket(date: DateTime(2025), assetCount: 3)]),
        origin: TimelineOrigin.main,
      ),
    );
    addTearDown(timelineService.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [timelineServiceProvider.overrideWithValue(timelineService)],
        child: MaterialApp(
          home: Material(
            child: TimelineHeader(
              bucket: TimeBucket(date: DateTime(2025), assetCount: 3),
              header: HeaderType.year,
              height: 80,
              assetOffset: 0,
            ),
          ),
        ),
      ),
    );

    expect(find.text('2025'), findsOneWidget);
    expect(find.byType(IconButton), findsOneWidget);
  });
}
```

Run:

```bash
cd mobile
mise exec -- flutter test test/presentation/widgets/timeline/timeline_header_test.dart
```

Expected red failure:

- `TimelineHeader` reserves space but renders no `2025` label for `HeaderType.year`.

- [ ] **Step 9: Implement model, expression-based repository support, exhaustive segment switches, and year header rendering**

Change `mobile/lib/domain/models/timeline.model.dart` to:

```dart
enum GroupAssetsBy { day, month, auto, none, year }

enum HeaderType { none, month, day, monthAndDay, year }
```

Change `mobile/lib/infrastructure/repositories/timeline.repository.dart` date helpers:

```dart
    return switch (groupBy) {
      GroupAssetsBy.day || GroupAssetsBy.auto => localTimeExp.date,
      GroupAssetsBy.month => localTimeExp.strftime("%Y-%m"),
      GroupAssetsBy.year => localTimeExp.strftime("%Y"),
      GroupAssetsBy.none => throw ArgumentError("GroupAssetsBy.none is not supported for date formatting"),
    };
```

and:

```dart
    final format = switch (groupBy) {
      GroupAssetsBy.day || GroupAssetsBy.auto => "y-M-d",
      GroupAssetsBy.month => "y-M",
      GroupAssetsBy.year => "y",
      GroupAssetsBy.none => throw ArgumentError("GroupAssetsBy.none is not supported for date formatting"),
    };
```

- Add immediate exhaustive switch handling for the new enum values. In `mobile/lib/presentation/widgets/timeline/segment_builder.dart`, add:

```dart
    HeaderType.year => kTimelineHeaderExtent,
```

- In `mobile/lib/presentation/widgets/timeline/fixed/segment_builder.dart`, update the switch:

```dart
      final timelineHeader = switch (groupBy) {
        GroupAssetsBy.year => HeaderType.year,
        GroupAssetsBy.month => HeaderType.month,
        GroupAssetsBy.day || GroupAssetsBy.auto =>
          bucket is TimeBucket && bucket.date.month != previousDate?.month ? HeaderType.monthAndDay : HeaderType.day,
        GroupAssetsBy.none => HeaderType.none,
      };
```

- In `mobile/lib/presentation/widgets/timeline/header.widget.dart`, add year formatting and rendering:

```dart
  String _formatYear(BuildContext context, DateTime date) {
    final formatter = DateFormat.y(context.locale.toLanguageTag());
    return formatter.format(date);
  }
```

Then make build treat year as its own header row:

```dart
    final isYearHeader = header == HeaderType.year;
    final isMonthHeader = header == HeaderType.month || header == HeaderType.monthAndDay;
    final isDayHeader = header == HeaderType.day || header == HeaderType.monthAndDay;
```

and add the row before the month row:

```dart
            if (isYearHeader)
              Row(
                children: [
                  Text(
                    _formatYear(context, date),
                    style: context.textTheme.labelLarge?.copyWith(fontSize: 24),
                  ),
                  const Spacer(),
                  _BulkSelectIconButton(bucket: bucket, assetOffset: assetOffset),
                ],
              ),
```

Update the top padding condition:

```dart
      padding: EdgeInsets.only(top: isYearHeader || isMonthHeader ? 8.0 : 0.0, left: 12.0, right: 12.0),
```

- [ ] **Step 10: Implement custom `mergedBucket` SQL year support**

In `mobile/lib/infrastructure/entities/merged_asset.drift`, add a third CASE branch for the appended enum index `4` in both remote and local halves:

```sql
            WHEN :group_by = 4 THEN COALESCE(
                STRFTIME('%Y', rae.local_date_time),
                STRFTIME('%Y', rae.created_at, 'localtime')
            )
```

and:

```sql
            WHEN :group_by = 4 THEN STRFTIME('%Y', lae.created_at, 'localtime')
```

Regenerate Drift output:

```bash
cd mobile
dart run build_runner build --delete-conflicting-outputs
```

Expected generated change:

- `mobile/lib/infrastructure/entities/merged_asset.drift.dart` SQL contains `WHEN ?1 = 4 THEN ... STRFTIME('%Y' ...)` in both query halves.

If code generation is unavailable because of local tooling, patch only the generated `merged_asset.drift.dart` SQL to match the `.drift` query and document the generator failure in the task result.

- [ ] **Step 11: Run repository, segment switch, and header renderer tests and verify green**

Run:

```bash
cd mobile
mise exec -- flutter test \
  test/domain/models/timeline_grouping_test.dart \
  test/presentation/widgets/timeline/fixed_segment_builder_test.dart \
  test/presentation/widgets/timeline/timeline_header_test.dart \
  test/infrastructure/repositories/timeline_year_grouping_test.dart \
  test/infrastructure/repositories/merged_asset_drift_test.dart \
  test/infrastructure/repositories/shared_space_repository_test.dart
```

Expected green:

- New year grouping tests pass.
- Existing month/day/none shared-space tests still pass.
- Existing `mergedBucket` permission/reactivity tests still pass.
- Generic remote, remote album, and local album year grouping paths pass.
- Segment-builder switches are exhaustive for year, month, day, auto, and none.
- TimelineHeader renders year labels and bulk select affordance for `HeaderType.year`.

- [ ] **Step 12: Commit Task 1**

```bash
git add \
  mobile/lib/domain/models/timeline.model.dart \
  mobile/lib/infrastructure/repositories/timeline.repository.dart \
  mobile/lib/infrastructure/entities/merged_asset.drift \
  mobile/lib/infrastructure/entities/merged_asset.drift.dart \
  mobile/lib/presentation/widgets/timeline/segment_builder.dart \
  mobile/lib/presentation/widgets/timeline/fixed/segment_builder.dart \
  mobile/lib/presentation/widgets/timeline/header.widget.dart \
  mobile/test/domain/models/timeline_grouping_test.dart \
  mobile/test/presentation/widgets/timeline/fixed_segment_builder_test.dart \
  mobile/test/presentation/widgets/timeline/timeline_header_test.dart \
  mobile/test/infrastructure/repositories/timeline_year_grouping_test.dart \
  mobile/test/infrastructure/repositories/merged_asset_drift_test.dart \
  mobile/test/infrastructure/repositories/shared_space_repository_test.dart
git commit -m "feat(mobile): add year timeline bucket support"
```

## Task 2: Mobile Grouping Settings Year Option And Persistence Fix

**Files:**

- Modify: `mobile/lib/widgets/settings/asset_list_settings/asset_list_group_settings.dart`
- Create: `mobile/test/widgets/settings/asset_list_group_settings_test.dart`

- [ ] **Step 1: Write failing settings widget tests**

Create `mobile/test/widgets/settings/asset_list_group_settings_test.dart`:

```dart
import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/widgets/settings/asset_list_settings/asset_list_group_settings.dart';

import '../../test_utils.dart';
import '../../widget_tester_extensions.dart';

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db));
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.day.index);
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  testWidgets('renders the year grouping option without offering none', (tester) async {
    await tester.pumpConsumerWidget(const GroupSettings());
    await tester.pumpAndSettle();

    expect(find.text('year'), findsOneWidget);
    expect(find.text('month'), findsOneWidget);
    expect(find.text('asset_list_layout_settings_group_by_month_day'), findsOneWidget);
    expect(find.text('asset_list_layout_settings_group_automatically'), findsOneWidget);
    expect(find.text('none'), findsNothing);
  });

  testWidgets('persists the newly selected year value instead of the previous value', (tester) async {
    await tester.pumpConsumerWidget(const GroupSettings());
    await tester.pumpAndSettle();

    await tester.tap(find.text('year'));
    await tester.pumpAndSettle();

    expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.year.index);
  });

  testWidgets('persists the newly selected month value when switching away from year', (tester) async {
    await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.year.index);

    await tester.pumpConsumerWidget(const GroupSettings());
    await tester.pumpAndSettle();

    await tester.tap(find.text('month'));
    await tester.pumpAndSettle();

    expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.month.index);
  });
}
```

- [ ] **Step 2: Run settings tests and verify red**

Run:

```bash
cd mobile
flutter test test/widgets/settings/asset_list_group_settings_test.dart
```

Expected red failures:

- The `year` radio option is missing.
- The persistence tests fail because `changeGroupValue` calls `updateAppSettings(groupBy)` with the old value.

- [ ] **Step 3: Add Year option and fix stale persistence**

In `mobile/lib/widgets/settings/asset_list_settings/asset_list_group_settings.dart`, change `changeGroupValue`:

```dart
    void changeGroupValue(GroupAssetsBy? value) {
      if (value != null) {
        groupByIndex.value = value.index;
        unawaited(updateAppSettings(value));
      }
    }
```

Add the year option before month:

```dart
            SettingsRadioGroup(
              title: 'year'.t(context: context),
              value: GroupAssetsBy.year,
            ),
```

Keep `GroupAssetsBy.none` out of the settings UI.

- [ ] **Step 4: Run settings tests and verify green**

Run:

```bash
cd mobile
flutter test test/widgets/settings/asset_list_group_settings_test.dart
```

Expected green:

- The settings UI shows Year, Month, Month + day, and Automatic.
- Selecting Year persists `GroupAssetsBy.year.index`.
- Selecting Month from Year persists `GroupAssetsBy.month.index`.

- [ ] **Step 5: Commit Task 2**

```bash
git add \
  mobile/lib/widgets/settings/asset_list_settings/asset_list_group_settings.dart \
  mobile/test/widgets/settings/asset_list_group_settings_test.dart
git commit -m "fix(mobile): persist selected timeline grouping setting"
```

## Task 3: Year Header Verification

**Files:**

- Verify: `mobile/lib/presentation/widgets/timeline/header.widget.dart`
- Verify: `mobile/test/presentation/widgets/timeline/timeline_header_test.dart`

- [ ] **Step 1: Verify segment builder coverage exists**

Task 1 owns `mobile/test/presentation/widgets/timeline/fixed_segment_builder_test.dart`, the exhaustive `HeaderType.year` / `GroupAssetsBy.year` switch handling, and `TimelineHeader` year rendering because those changes are required as soon as the enum values exist and year segments can be emitted. Do not duplicate those tests here.

- [ ] **Step 2: Run header tests and verify green**

Run:

```bash
cd mobile
mise exec -- flutter test \
  test/presentation/widgets/timeline/fixed_segment_builder_test.dart \
  test/presentation/widgets/timeline/timeline_header_test.dart
```

Expected green:

- Year headers render correctly.
- Month/day/none segment tests still pass.

- [ ] **Step 3: No commit unless verification fixes were required**

If the tests in Step 2 fail, fix only the missing header-rendering issue with TDD evidence and commit:

```bash
git add \
  mobile/lib/presentation/widgets/timeline/header.widget.dart \
  mobile/test/presentation/widgets/timeline/timeline_header_test.dart
git commit -m "feat(mobile): render year timeline headers"
```

## Task 4: Scrubber Labels, Snapping, And Scroll-To-Date Year Fallback

**Files:**

- Create: `mobile/lib/presentation/widgets/timeline/scrubber_segments.dart`
- Modify: `mobile/lib/presentation/widgets/timeline/scrubber.widget.dart`
- Create: `mobile/lib/presentation/widgets/timeline/timeline_scroll_target.dart`
- Modify: `mobile/lib/presentation/widgets/timeline/timeline.widget.dart`
- Create: `mobile/test/presentation/widgets/timeline/scrubber_segments_test.dart`
- Create: `mobile/test/presentation/widgets/timeline/timeline_scroll_target_test.dart`

- [ ] **Step 1: Write failing scrubber helper tests**

Create `mobile/test/presentation/widgets/timeline/scrubber_segments_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/fixed/segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/scrubber_segments.dart';

FixedSegment _segment({
  required DateTime date,
  required double startOffset,
  required double endOffset,
  HeaderType header = HeaderType.month,
}) {
  return FixedSegment(
    firstIndex: 0,
    lastIndex: 1,
    startOffset: startOffset,
    endOffset: endOffset,
    firstAssetIndex: 0,
    bucket: TimeBucket(date: date, assetCount: 1),
    tileHeight: 100,
    columnCount: 4,
    headerExtent: 80,
    spacing: 2,
    header: header,
  );
}

void main() {
  group('scrubber segment helpers', () {
    test('builds year-only labels for year grouping', () {
      final segments = buildScrubberSegments(
        layoutSegments: [
          _segment(date: DateTime(2026), startOffset: 0, endOffset: 100, header: HeaderType.year),
          _segment(date: DateTime(2025), startOffset: 100, endOffset: 200, header: HeaderType.year),
        ],
        timelineHeight: 400,
        groupBy: GroupAssetsBy.year,
      );

      expect(segments.map((segment) => segment.scrollLabel), ['2026', '2025']);
      expect(countScrubberSnapSegments(segments, GroupAssetsBy.year), 2);
    });

    test('keeps month labels and month snap counts for month grouping', () {
      final segments = buildScrubberSegments(
        layoutSegments: [
          _segment(date: DateTime(2026, 4), startOffset: 0, endOffset: 100),
          _segment(date: DateTime(2026, 3), startOffset: 100, endOffset: 200),
        ],
        timelineHeight: 400,
        groupBy: GroupAssetsBy.month,
      );

      expect(segments.map((segment) => segment.scrollLabel), ['Apr 2026', 'Mar 2026']);
      expect(countScrubberSnapSegments(segments, GroupAssetsBy.month), 2);
    });

    test('returns empty list for empty and non-time segments', () {
      expect(buildScrubberSegments(layoutSegments: const [], timelineHeight: 400, groupBy: GroupAssetsBy.year), isEmpty);
    });

    test('finds layout segment by year when grouping by year', () {
      final layoutSegments = [
        _segment(date: DateTime(2026), startOffset: 0, endOffset: 100, header: HeaderType.year),
        _segment(date: DateTime(2025), startOffset: 100, endOffset: 200, header: HeaderType.year),
      ];

      expect(
        findScrubberLayoutSegmentIndex(
          layoutSegments: layoutSegments,
          date: DateTime(2025, 8, 12),
          groupBy: GroupAssetsBy.year,
        ),
        1,
      );
    });

    test('finds layout segment by year and month when not grouping by year', () {
      final layoutSegments = [
        _segment(date: DateTime(2026, 4), startOffset: 0, endOffset: 100),
        _segment(date: DateTime(2026, 3), startOffset: 100, endOffset: 200),
      ];

      expect(
        findScrubberLayoutSegmentIndex(
          layoutSegments: layoutSegments,
          date: DateTime(2026, 3, 18),
          groupBy: GroupAssetsBy.month,
        ),
        1,
      );
    });
  });
}
```

- [ ] **Step 2: Write failing scroll target tests**

Create `mobile/test/presentation/widgets/timeline/timeline_scroll_target_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/fixed/segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_scroll_target.dart';

FixedSegment _segment(DateTime date) {
  return FixedSegment(
    firstIndex: 0,
    lastIndex: 1,
    startOffset: date.month.toDouble(),
    endOffset: date.month.toDouble() + 100,
    firstAssetIndex: 0,
    bucket: TimeBucket(date: date, assetCount: 1),
    tileHeight: 100,
    columnCount: 4,
    headerExtent: 80,
    spacing: 2,
    header: HeaderType.month,
  );
}

void main() {
  test('prefers exact day match before month and year fallbacks', () {
    final exact = _segment(DateTime(2026, 8, 12));
    final month = _segment(DateTime(2026, 8));
    final year = _segment(DateTime(2026));

    expect(findTimelineScrollTargetSegment([year, month, exact], DateTime(2026, 8, 12)), exact);
  });

  test('falls back to same month when exact day is absent', () {
    final month = _segment(DateTime(2026, 8));
    final year = _segment(DateTime(2026));

    expect(findTimelineScrollTargetSegment([year, month], DateTime(2026, 8, 12)), month);
  });

  test('falls back to same year when month is absent', () {
    final year = _segment(DateTime(2026));
    final older = _segment(DateTime(2025));

    expect(findTimelineScrollTargetSegment([older, year], DateTime(2026, 8, 12)), year);
  });

  test('returns null when no time bucket matches', () {
    expect(findTimelineScrollTargetSegment([_segment(DateTime(2025))], DateTime(2026, 8, 12)), isNull);
  });
}
```

- [ ] **Step 3: Run scrubber/scroll tests and verify red**

Run:

```bash
cd mobile
flutter test \
  test/presentation/widgets/timeline/scrubber_segments_test.dart \
  test/presentation/widgets/timeline/timeline_scroll_target_test.dart
```

Expected red failures:

- `scrubber_segments.dart` does not exist.
- `timeline_scroll_target.dart` does not exist.
- Current scrubber matching is hard-coded to year+month.

- [ ] **Step 4: Extract scrubber segment helpers**

Create `mobile/lib/presentation/widgets/timeline/scrubber_segments.dart`:

```dart
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment.model.dart';
import 'package:intl/intl.dart';

class ScrubberSegment {
  final DateTime date;
  final double startOffset;
  final String scrollLabel;
  final bool showSegment;

  const ScrubberSegment({
    required this.date,
    required this.startOffset,
    required this.scrollLabel,
    this.showSegment = false,
  });

  ScrubberSegment copyWith({DateTime? date, double? startOffset, String? scrollLabel, bool? showSegment}) {
    return ScrubberSegment(
      date: date ?? this.date,
      startOffset: startOffset ?? this.startOffset,
      scrollLabel: scrollLabel ?? this.scrollLabel,
      showSegment: showSegment ?? this.showSegment,
    );
  }

  @override
  String toString() => 'ScrubberSegment(scrollLabel: $scrollLabel, date: $date)';
}

List<ScrubberSegment> buildScrubberSegments({
  required List<Segment> layoutSegments,
  required double timelineHeight,
  required GroupAssetsBy groupBy,
}) {
  const double offsetThreshold = 40.0;

  if (layoutSegments.isEmpty || layoutSegments.first.bucket is! TimeBucket) {
    return [];
  }

  final formatter = groupBy == GroupAssetsBy.year ? DateFormat.y() : DateFormat.yMMM();
  final segments = <ScrubberSegment>[];
  DateTime? lastDate;
  double lastOffset = -offsetThreshold;

  for (final layoutSegment in layoutSegments) {
    final scrollPercentage = layoutSegment.startOffset / layoutSegments.last.endOffset;
    final startOffset = scrollPercentage * timelineHeight;
    final date = (layoutSegment.bucket as TimeBucket).date;
    final label = formatter.format(date);

    final isNewYear = lastDate == null || date.year != lastDate.year;
    final showSegment = lastOffset + offsetThreshold <= startOffset && isNewYear;

    segments.add(ScrubberSegment(date: date, startOffset: startOffset, scrollLabel: label, showSegment: showSegment));
    lastDate = date;
    if (showSegment) {
      lastOffset = startOffset;
    }
  }

  return segments;
}

int countScrubberSnapSegments(List<ScrubberSegment> segments, GroupAssetsBy groupBy) {
  if (groupBy == GroupAssetsBy.year) {
    return segments.map((segment) => segment.date.year).toSet().length;
  }

  return segments.map((segment) => '${segment.date.month}_${segment.date.year}').toSet().length;
}

int findScrubberLayoutSegmentIndex({
  required List<Segment> layoutSegments,
  required DateTime date,
  required GroupAssetsBy groupBy,
}) {
  return layoutSegments.indexWhere((layoutSegment) {
    if (layoutSegment.bucket is! TimeBucket) {
      return false;
    }

    final bucketDate = (layoutSegment.bucket as TimeBucket).date;
    if (groupBy == GroupAssetsBy.year) {
      return bucketDate.year == date.year;
    }

    return bucketDate.year == date.year && bucketDate.month == date.month;
  });
}
```

- [ ] **Step 5: Wire scrubber to grouping-aware helpers**

In `mobile/lib/presentation/widgets/timeline/scrubber.widget.dart`:

- Import `scrubber_segments.dart`.
- Add `final GroupAssetsBy groupBy;` to `Scrubber`.
- Add `this.groupBy = GroupAssetsBy.day,` to the constructor.
- Replace `List<_Segment> _segments = [];` with `List<ScrubberSegment> _segments = [];`.
- Replace `_buildSegments(...)` calls with:

```dart
    _segments = buildScrubberSegments(
      layoutSegments: widget.layoutSegments,
      timelineHeight: _scrubberHeight,
      groupBy: widget.groupBy,
    );
```

- Replace `getMonthCount()` with:

```dart
  int getSnapSegmentCount() => countScrubberSnapSegments(_segments, widget.groupBy);
```

- Rename `_monthCount` to `_snapSegmentCount` and use it in the existing snap threshold checks:

```dart
        if (_snapSegmentCount >= kMinMonthsToEnableScrubberSnap) {
          _onScrubberDateChanged(nearestMonthSegment.date);
        }
```

and:

```dart
    if (_snapSegmentCount < kMinMonthsToEnableScrubberSnap || !widget.snapToMonth) {
```

- Replace `_findLayoutSegmentIndex` implementation with:

```dart
  int _findLayoutSegmentIndex(ScrubberSegment segment) {
    return findScrubberLayoutSegmentIndex(
      layoutSegments: widget.layoutSegments,
      date: segment.date,
      groupBy: widget.groupBy,
    );
  }
```

- Update `_SegmentWidget` to accept `ScrubberSegment`.
- Delete the private `_Segment` class and private `_buildSegments` function from `scrubber.widget.dart`.

In `mobile/lib/presentation/widgets/timeline/timeline.widget.dart`, pass the selected group to the scrubber:

```dart
              groupBy: ref.watch(timelineArgsProvider).groupBy ??
                  GroupAssetsBy.values[ref.watch(settingsProvider).get(Setting.groupAssetsBy)],
```

Place that argument next to `snapToMonth`.

- [ ] **Step 6: Create scroll target helper and wire it**

Create `mobile/lib/presentation/widgets/timeline/timeline_scroll_target.dart`:

```dart
import 'package:collection/collection.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment.model.dart';

Segment? findTimelineScrollTargetSegment(List<Segment> segments, DateTime date) {
  final exactDay = segments.firstWhereOrNull((segment) {
    if (segment.bucket is! TimeBucket) return false;
    final segmentDate = (segment.bucket as TimeBucket).date;
    return segmentDate.year == date.year && segmentDate.month == date.month && segmentDate.day == date.day;
  });
  if (exactDay != null) return exactDay;

  final sameMonth = segments.firstWhereOrNull((segment) {
    if (segment.bucket is! TimeBucket) return false;
    final segmentDate = (segment.bucket as TimeBucket).date;
    return segmentDate.year == date.year && segmentDate.month == date.month;
  });
  if (sameMonth != null) return sameMonth;

  return segments.firstWhereOrNull((segment) {
    if (segment.bucket is! TimeBucket) return false;
    final segmentDate = (segment.bucket as TimeBucket).date;
    return segmentDate.year == date.year;
  });
}
```

In `mobile/lib/presentation/widgets/timeline/timeline.widget.dart`:

- Import `timeline_scroll_target.dart`.
- Replace the exact-date and month fallback block in `_scrollToDate` with:

```dart
      final fallbackSegment = findTimelineScrollTargetSegment(segments, date);
```

Keep the existing animation block unchanged.

- [ ] **Step 7: Run scrubber/scroll tests and verify green**

Run:

```bash
cd mobile
flutter test \
  test/presentation/widgets/timeline/scrubber_segments_test.dart \
  test/presentation/widgets/timeline/timeline_scroll_target_test.dart
```

Expected green:

- Year grouping labels as `2026`.
- Month grouping keeps labels like `Apr 2026`.
- Empty layout returns no scrubber segments.
- Scrubber matching uses year-only matching only in year grouping.
- Scroll targeting falls back exact day, then month, then year.

- [ ] **Step 8: Commit Task 4**

```bash
git add \
  mobile/lib/presentation/widgets/timeline/scrubber_segments.dart \
  mobile/lib/presentation/widgets/timeline/scrubber.widget.dart \
  mobile/lib/presentation/widgets/timeline/timeline_scroll_target.dart \
  mobile/lib/presentation/widgets/timeline/timeline.widget.dart \
  mobile/test/presentation/widgets/timeline/scrubber_segments_test.dart \
  mobile/test/presentation/widgets/timeline/timeline_scroll_target_test.dart
git commit -m "feat(mobile): align timeline scrubber with year grouping"
```

## Task 5: Slice Verification

**Files:**

- All files touched in Tasks 1-4.

- [ ] **Step 1: Run all focused Slice 7 tests**

Run:

```bash
cd mobile
flutter test \
  test/domain/models/timeline_grouping_test.dart \
  test/infrastructure/repositories/timeline_year_grouping_test.dart \
  test/infrastructure/repositories/merged_asset_drift_test.dart \
  test/infrastructure/repositories/shared_space_repository_test.dart \
  test/widgets/settings/asset_list_group_settings_test.dart \
  test/presentation/widgets/timeline/fixed_segment_builder_test.dart \
  test/presentation/widgets/timeline/timeline_header_test.dart \
  test/presentation/widgets/timeline/scrubber_segments_test.dart \
  test/presentation/widgets/timeline/timeline_scroll_target_test.dart
```

Expected green:

- All focused Slice 7 tests pass.

- [ ] **Step 2: Run mobile static analysis on touched code**

Run:

```bash
cd mobile
dart analyze
```

Expected green:

- No analyzer errors.

- [ ] **Step 3: Run formatting**

Run:

```bash
cd mobile
dart format \
  lib/domain/models/timeline.model.dart \
  lib/infrastructure/repositories/timeline.repository.dart \
  lib/infrastructure/entities/merged_asset.drift.dart \
  lib/widgets/settings/asset_list_settings/asset_list_group_settings.dart \
  lib/presentation/widgets/timeline/segment_builder.dart \
  lib/presentation/widgets/timeline/fixed/segment_builder.dart \
  lib/presentation/widgets/timeline/header.widget.dart \
  lib/presentation/widgets/timeline/scrubber.widget.dart \
  lib/presentation/widgets/timeline/scrubber_segments.dart \
  lib/presentation/widgets/timeline/timeline_scroll_target.dart \
  lib/presentation/widgets/timeline/timeline.widget.dart \
  test/domain/models/timeline_grouping_test.dart \
  test/infrastructure/repositories/timeline_year_grouping_test.dart \
  test/infrastructure/repositories/merged_asset_drift_test.dart \
  test/infrastructure/repositories/shared_space_repository_test.dart \
  test/widgets/settings/asset_list_group_settings_test.dart \
  test/presentation/widgets/timeline/fixed_segment_builder_test.dart \
  test/presentation/widgets/timeline/timeline_header_test.dart \
  test/presentation/widgets/timeline/scrubber_segments_test.dart \
  test/presentation/widgets/timeline/timeline_scroll_target_test.dart
```

Expected:

- Files are formatted. If formatting changes files, rerun focused tests.

- [ ] **Step 4: Final commit if formatting changed files**

If Task 5 produced formatting-only or verification-fix changes, commit them:

```bash
git add \
  mobile/lib/domain/models/timeline.model.dart \
  mobile/lib/infrastructure/repositories/timeline.repository.dart \
  mobile/lib/infrastructure/entities/merged_asset.drift \
  mobile/lib/infrastructure/entities/merged_asset.drift.dart \
  mobile/lib/widgets/settings/asset_list_settings/asset_list_group_settings.dart \
  mobile/lib/presentation/widgets/timeline/segment_builder.dart \
  mobile/lib/presentation/widgets/timeline/fixed/segment_builder.dart \
  mobile/lib/presentation/widgets/timeline/header.widget.dart \
  mobile/lib/presentation/widgets/timeline/scrubber.widget.dart \
  mobile/lib/presentation/widgets/timeline/scrubber_segments.dart \
  mobile/lib/presentation/widgets/timeline/timeline_scroll_target.dart \
  mobile/lib/presentation/widgets/timeline/timeline.widget.dart \
  mobile/test/domain/models/timeline_grouping_test.dart \
  mobile/test/infrastructure/repositories/timeline_year_grouping_test.dart \
  mobile/test/infrastructure/repositories/merged_asset_drift_test.dart \
  mobile/test/infrastructure/repositories/shared_space_repository_test.dart \
  mobile/test/widgets/settings/asset_list_group_settings_test.dart \
  mobile/test/presentation/widgets/timeline/fixed_segment_builder_test.dart \
  mobile/test/presentation/widgets/timeline/timeline_header_test.dart \
  mobile/test/presentation/widgets/timeline/scrubber_segments_test.dart \
  mobile/test/presentation/widgets/timeline/timeline_scroll_target_test.dart
git commit -m "test(mobile): verify timeline year grouping"
```

Do not stage unrelated existing dirty files from earlier slices.

## Edge Cases Covered

- Persisted enum indexes remain stable for existing mobile users.
- `GroupAssetsBy.year` appends at index 4 instead of shifting old values.
- Empty bucket lists do not create scrubber segments.
- Non-time/flat `none` buckets keep no headers and no scrubber segment assumptions.
- `auto` continues to fallback to day in `TimelineFactory`.
- December 31 and January 1 belong to separate year buckets.
- Month and day grouping behavior remains unchanged.
- Custom `mergedBucket` SQL supports year grouping for the main timeline path.
- Expression-based buckets support year grouping for shared-space and generic repository paths.
- Settings radio writes the selected value, not the stale previous value.
- Year headers keep bulk selection semantics for the full bucket.
- Scrubber labels and snapping use year matching only when grouping by year.
- Programmatic scroll-to-date can target a year bucket when exact day and month buckets are absent.
