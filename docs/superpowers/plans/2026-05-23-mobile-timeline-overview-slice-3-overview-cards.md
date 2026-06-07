# Mobile Timeline Overview Slice 3 Overview Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render compact year/month overview cards from existing timeline buckets, including labels, counts, fallback surfaces, and one representative asset loaded only for visible cards.

**Architecture:** Keep `Days` on the existing `FixedSegmentBuilder`. Add a separate overview-card segment path for `GroupAssetsBy.year` and `GroupAssetsBy.month`, where each time bucket maps to one sliver child whose representative image is the first asset in that bucket. The representative lookup goes through the existing `TimelineService` buffer/batched `loadAssets` API, so this slice does not add repository APIs or unbounded one-query-per-bucket behavior.

**Tech Stack:** Flutter, Dart, Riverpod, EasyLocalization, existing `TimelineService`, `Segment`/`SegmentBuilder`, widget tests, provider tests.

---

## Scope Boundaries

In scope:

- Add a reusable `TimelineOverviewCard` widget for year/month overview rows.
- Add an overview segment model and builder that maps each `TimeBucket` to a single compact card row.
- Load one representative asset per visible overview segment through `TimelineService`.
- Wire `timelineSegmentProvider` so `GroupAssetsBy.year` and `GroupAssetsBy.month` use overview segments while `day`, `auto`, and `none` keep the fixed segment path.
- Add an English photo-count string for the overview badge.
- Test labels, counts, stable card height, fallback state, representative loading, segment offsets, and day-mode compatibility.

Out of scope:

- Tapping cards to drill down.
- Temporal chips or active-filter subheaders.
- Photos app-bar replacement beyond the Slice 1 selector.
- Shared route placement and cover-photo guardrails.
- Accessibility semantics polish beyond keeping the card structure compatible with Slice 6.

## File Map

- Create: `mobile/lib/presentation/widgets/timeline/overview/overview_card.dart`
  - Compact visual card with cover thumbnail/fallback, gradient overlay, label, and count badge.
- Create: `mobile/lib/presentation/widgets/timeline/overview/overview_segment.model.dart`
  - `Segment` implementation that builds one overview card for one time bucket and loads the representative asset by `firstAssetIndex`.
- Create: `mobile/lib/presentation/widgets/timeline/overview/overview_segment_builder.dart`
  - Maps year/month buckets to `TimelineOverviewSegment` rows with cumulative asset offsets.
- Modify: `mobile/lib/presentation/widgets/timeline/timeline.state.dart`
  - Selects overview segments for `GroupAssetsBy.year` and `GroupAssetsBy.month`; keeps fixed segments for other modes.
- Modify: `i18n/en.json`
  - Adds `timeline_overview_photo_count`.
- Create: `mobile/test/presentation/widgets/timeline/overview/timeline_overview_card_test.dart`
- Create: `mobile/test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart`
- Create: `mobile/test/presentation/widgets/timeline/timeline_segment_provider_test.dart`

## Task 1: Overview Card Widget

**Files:**

- Modify: `i18n/en.json`
- Create: `mobile/test/presentation/widgets/timeline/overview/timeline_overview_card_test.dart`
- Create: `mobile/lib/presentation/widgets/timeline/overview/overview_card.dart`

- [ ] **Step 1: Write failing widget tests**

Create `mobile/test/presentation/widgets/timeline/overview/timeline_overview_card_test.dart`:

```dart
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_card.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../../test_utils.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() async {
    SharedPreferences.setMockInitialValues({});
    await EasyLocalization.ensureInitialized();
    await initializeDateFormatting('en');
  });

  Widget wrap(Widget child) {
    return EasyLocalization(
      supportedLocales: const [Locale('en')],
      path: '../i18n',
      fallbackLocale: const Locale('en'),
      child: MaterialApp(home: Scaffold(body: Center(child: child))),
    );
  }

  testWidgets('year card renders compact label, count, and representative thumbnail', (tester) async {
    final asset = TestUtils.createRemoteAsset(id: 'asset-1', width: 200, height: 100);

    await tester.pumpWidget(
      wrap(
        TimelineOverviewCard(
          bucket: TimeBucket(date: DateTime(2025), assetCount: 1),
          groupBy: GroupAssetsBy.year,
          representativeAsset: asset,
        ),
      ),
    );

    expect(find.text('2025'), findsOneWidget);
    expect(find.text('1 photo'), findsOneWidget);
    expect(find.byType(Thumbnail), findsOneWidget);

    final sizedBox = tester.widget<SizedBox>(find.byKey(const ValueKey('timeline-overview-card-size')));
    expect(sizedBox.height, kTimelineOverviewCardHeight);
  });

  testWidgets('month card includes month and year with plural photo count', (tester) async {
    await tester.pumpWidget(
      wrap(
        TimelineOverviewCard(
          bucket: TimeBucket(date: DateTime(2025, 3), assetCount: 4),
          groupBy: GroupAssetsBy.month,
        ),
      ),
    );

    expect(find.text('Mar 2025'), findsOneWidget);
    expect(find.text('4 photos'), findsOneWidget);
  });

  testWidgets('fallback surface keeps label and count visible without a thumbnail', (tester) async {
    await tester.pumpWidget(
      wrap(
        TimelineOverviewCard(
          bucket: TimeBucket(date: DateTime(2024), assetCount: 2),
          groupBy: GroupAssetsBy.year,
        ),
      ),
    );

    expect(find.byKey(const ValueKey('timeline-overview-card-fallback')), findsOneWidget);
    expect(find.text('2024'), findsOneWidget);
    expect(find.text('2 photos'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run widget tests and verify red**

Run:

```bash
cd mobile
mise exec -- flutter test test/presentation/widgets/timeline/overview/timeline_overview_card_test.dart
```

Expected red failure:

- Import failure for missing `overview_card.dart`.

- [ ] **Step 3: Add the English overview count string**

Modify `i18n/en.json` by adding this key near the other `timeline_*` keys:

```json
"timeline_overview_photo_count": "{count, plural, one {# photo} other {# photos}}"
```

- [ ] **Step 4: Implement the overview card**

Create `mobile/lib/presentation/widgets/timeline/overview/overview_card.dart`:

```dart
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';

const double kTimelineOverviewCardHeight = 144.0;
const double kTimelineOverviewCardVerticalPadding = 6.0;
const double kTimelineOverviewCardHorizontalPadding = 12.0;
const double kTimelineOverviewSegmentExtent =
    kTimelineOverviewCardHeight + (kTimelineOverviewCardVerticalPadding * 2);

class TimelineOverviewCard extends StatelessWidget {
  const TimelineOverviewCard({
    super.key,
    required this.bucket,
    required this.groupBy,
    this.representativeAsset,
    this.onTap,
  });

  final TimeBucket bucket;
  final GroupAssetsBy groupBy;
  final BaseAsset? representativeAsset;
  final VoidCallback? onTap;

  String _label(BuildContext context) {
    final locale = context.locale.toLanguageTag();
    return switch (groupBy) {
      GroupAssetsBy.year => DateFormat.y(locale).format(bucket.date),
      GroupAssetsBy.month => DateFormat.yMMM(locale).format(bucket.date),
      GroupAssetsBy.day || GroupAssetsBy.auto || GroupAssetsBy.none => DateFormat.yMMMEd(locale).format(bucket.date),
    };
  }

  @override
  Widget build(BuildContext context) {
    final label = _label(context);
    final countLabel = 'timeline_overview_photo_count'.tr(namedArgs: {'count': bucket.assetCount.toString()});
    final representativeAsset = this.representativeAsset;

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: kTimelineOverviewCardHorizontalPadding,
        vertical: kTimelineOverviewCardVerticalPadding,
      ),
      child: SizedBox(
        key: const ValueKey('timeline-overview-card-size'),
        height: kTimelineOverviewCardHeight,
        width: double.infinity,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(8),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (representativeAsset != null)
                    Thumbnail.fromAsset(asset: representativeAsset, fit: BoxFit.cover, size: const Size(640, 320))
                  else
                    DecoratedBox(
                      key: const ValueKey('timeline-overview-card-fallback'),
                      decoration: BoxDecoration(color: context.colorScheme.surfaceContainerHighest),
                    ),
                  const DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [Colors.transparent, Color(0xCC000000)],
                        stops: [0.35, 1.0],
                      ),
                    ),
                  ),
                  Positioned(
                    left: 16,
                    right: 16,
                    bottom: 14,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: context.textTheme.headlineSmall?.copyWith(
                            color: Colors.white,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 4),
                        DecoratedBox(
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.88),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                            child: Text(
                              countLabel,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: context.textTheme.labelMedium?.copyWith(
                                color: Colors.black,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 5: Format and run widget tests**

Run:

```bash
cd mobile
mise exec -- dart format lib/presentation/widgets/timeline/overview/overview_card.dart test/presentation/widgets/timeline/overview/timeline_overview_card_test.dart
mise exec -- flutter test test/presentation/widgets/timeline/overview/timeline_overview_card_test.dart
```

Expected green result:

- All overview card tests pass.

## Task 2: Overview Segment Builder

**Files:**

- Create: `mobile/test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart`
- Create: `mobile/lib/presentation/widgets/timeline/overview/overview_segment.model.dart`
- Create: `mobile/lib/presentation/widgets/timeline/overview/overview_segment_builder.dart`

- [ ] **Step 1: Write failing segment tests**

Create `mobile/test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_card.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_segment_builder.dart';

void main() {
  test('year overview maps each bucket to one compact segment with cumulative representative offsets', () {
    final segments = TimelineOverviewSegmentBuilder(
      buckets: [
        TimeBucket(date: DateTime(2025), assetCount: 5),
        TimeBucket(date: DateTime(2024), assetCount: 2),
      ],
      groupBy: GroupAssetsBy.year,
    ).generate();

    expect(segments, hasLength(2));
    expect(segments, everyElement(isA<TimelineOverviewSegment>()));
    expect(segments[0].firstIndex, 0);
    expect(segments[0].lastIndex, 0);
    expect(segments[0].firstAssetIndex, 0);
    expect(segments[0].startOffset, 0);
    expect(segments[0].endOffset, kTimelineOverviewSegmentExtent);
    expect(segments[0].header, HeaderType.year);
    expect(segments[1].firstIndex, 1);
    expect(segments[1].firstAssetIndex, 5);
    expect(segments[1].startOffset, kTimelineOverviewSegmentExtent);
    expect(segments[1].endOffset, kTimelineOverviewSegmentExtent * 2);
  });

  test('month overview uses month headers and keeps one child per bucket', () {
    final segments = TimelineOverviewSegmentBuilder(
      buckets: [TimeBucket(date: DateTime(2025, 3), assetCount: 4)],
      groupBy: GroupAssetsBy.month,
    ).generate();

    expect(segments.single.firstIndex, 0);
    expect(segments.single.lastIndex, 0);
    expect(segments.single.header, HeaderType.month);
    expect(segments.single.getMinChildIndexForScrollOffset(20), 0);
    expect(segments.single.getMaxChildIndexForScrollOffset(120), 0);
    expect(segments.single.indexToLayoutOffset(0), 0);
  });

  test('builder rejects non-overview grouping modes', () {
    expect(
      () => TimelineOverviewSegmentBuilder(
        buckets: [TimeBucket(date: DateTime(2025), assetCount: 1)],
        groupBy: GroupAssetsBy.day,
      ).generate(),
      throwsArgumentError,
    );
  });
}
```

- [ ] **Step 2: Run segment tests and verify red**

Run:

```bash
cd mobile
mise exec -- flutter test test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart
```

Expected red failure:

- Import failure for missing overview segment files.

- [ ] **Step 3: Implement overview segment model**

Create `mobile/lib/presentation/widgets/timeline/overview/overview_segment.model.dart`:

```dart
import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_card.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment.model.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';

class TimelineOverviewSegment extends Segment {
  const TimelineOverviewSegment({
    required super.firstIndex,
    required super.lastIndex,
    required super.startOffset,
    required super.endOffset,
    required super.firstAssetIndex,
    required super.bucket,
    required this.groupBy,
    super.headerExtent = 0,
    super.spacing = 0,
    required super.header,
  });

  final GroupAssetsBy groupBy;

  @override
  int getMinChildIndexForScrollOffset(double scrollOffset) => firstIndex;

  @override
  int getMaxChildIndexForScrollOffset(double scrollOffset) => lastIndex;

  @override
  double indexToLayoutOffset(int index) => startOffset;

  @override
  Widget builder(BuildContext context, int index) {
    return _TimelineOverviewSegmentCard(segment: this);
  }
}

class _TimelineOverviewSegmentCard extends ConsumerWidget {
  const _TimelineOverviewSegmentCard({required this.segment});

  final TimelineOverviewSegment segment;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bucket = segment.bucket;
    if (bucket is! TimeBucket) {
      return const SizedBox.shrink();
    }

    final timelineService = ref.read(timelineServiceProvider);
    BaseAsset? representativeAsset;
    if (timelineService.hasRange(segment.firstAssetIndex, 1)) {
      representativeAsset = timelineService.getAssets(segment.firstAssetIndex, 1).firstOrNull;
    }

    if (representativeAsset != null || bucket.assetCount <= 0) {
      return TimelineOverviewCard(bucket: bucket, groupBy: segment.groupBy, representativeAsset: representativeAsset);
    }

    return FutureBuilder<List<BaseAsset>>(
      future: timelineService.loadAssets(segment.firstAssetIndex, 1),
      builder: (context, snapshot) {
        final assets = snapshot.data ?? const <BaseAsset>[];
        return TimelineOverviewCard(
          bucket: bucket,
          groupBy: segment.groupBy,
          representativeAsset: assets.firstOrNull,
        );
      },
    );
  }
}
```

Also add this import to the file:

```dart
import 'package:collection/collection.dart';
```

- [ ] **Step 4: Implement overview segment builder**

Create `mobile/lib/presentation/widgets/timeline/overview/overview_segment_builder.dart`:

```dart
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_card.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment_builder.dart';

class TimelineOverviewSegmentBuilder extends SegmentBuilder {
  const TimelineOverviewSegmentBuilder({required super.buckets, required super.groupBy});

  List<Segment> generate() {
    if (groupBy != GroupAssetsBy.year && groupBy != GroupAssetsBy.month) {
      throw ArgumentError.value(groupBy, 'groupBy', 'Overview segments support only year and month grouping');
    }

    final segments = <Segment>[];
    var childIndex = 0;
    var assetIndex = 0;
    var startOffset = 0.0;

    for (final bucket in buckets) {
      final endOffset = startOffset + kTimelineOverviewSegmentExtent;
      segments.add(
        TimelineOverviewSegment(
          firstIndex: childIndex,
          lastIndex: childIndex,
          startOffset: startOffset,
          endOffset: endOffset,
          firstAssetIndex: assetIndex,
          bucket: bucket,
          groupBy: groupBy,
          header: groupBy == GroupAssetsBy.year ? HeaderType.year : HeaderType.month,
        ),
      );

      childIndex += 1;
      assetIndex += bucket.assetCount;
      startOffset = endOffset;
    }

    return segments;
  }
}
```

- [ ] **Step 5: Format and run segment tests**

Run:

```bash
cd mobile
mise exec -- dart format \
  lib/presentation/widgets/timeline/overview/overview_segment.model.dart \
  lib/presentation/widgets/timeline/overview/overview_segment_builder.dart \
  test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart
mise exec -- flutter test test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart
```

Expected green result:

- All overview segment builder tests pass.

## Task 3: Timeline Segment Provider Wiring

**Files:**

- Create: `mobile/test/presentation/widgets/timeline/timeline_segment_provider_test.dart`
- Modify: `mobile/lib/presentation/widgets/timeline/timeline.state.dart`

- [ ] **Step 1: Write failing provider tests**

Create `mobile/test/presentation/widgets/timeline/timeline_segment_provider_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/presentation/widgets/timeline/fixed/segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.state.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';

void main() {
  ProviderContainer containerFor(GroupAssetsBy groupBy) {
    final service = TimelineService((
      assetSource: (offset, count) async => const [],
      bucketSource: () => Stream.value([
        TimeBucket(date: DateTime(2025), assetCount: 2),
        TimeBucket(date: DateTime(2024), assetCount: 1),
      ]),
      origin: TimelineOrigin.main,
    ));

    final container = ProviderContainer(
      overrides: [
        timelineServiceProvider.overrideWithValue(service),
        timelineArgsProvider.overrideWithValue(
          TimelineArgs(maxWidth: 390, maxHeight: 800, columnCount: 3, groupBy: groupBy),
        ),
      ],
    );
    addTearDown(() async {
      container.dispose();
      await service.dispose();
    });
    return container;
  }

  test('year grouping uses overview segments', () async {
    final container = containerFor(GroupAssetsBy.year);

    final segments = await container.read(timelineSegmentProvider.future);

    expect(segments, everyElement(isA<TimelineOverviewSegment>()));
    expect(segments.first.firstAssetIndex, 0);
    expect(segments.last.firstAssetIndex, 2);
  });

  test('month grouping uses overview segments', () async {
    final container = containerFor(GroupAssetsBy.month);

    final segments = await container.read(timelineSegmentProvider.future);

    expect(segments, everyElement(isA<TimelineOverviewSegment>()));
  });

  test('day grouping stays on fixed grid segments', () async {
    final container = containerFor(GroupAssetsBy.day);

    final segments = await container.read(timelineSegmentProvider.future);

    expect(segments, everyElement(isA<FixedSegment>()));
  });
}
```

- [ ] **Step 2: Run provider tests and verify red**

Run:

```bash
cd mobile
mise exec -- flutter test test/presentation/widgets/timeline/timeline_segment_provider_test.dart
```

Expected red failure:

- Year/month tests fail because `timelineSegmentProvider` still always uses `FixedSegmentBuilder`.

- [ ] **Step 3: Wire overview segments for year/month only**

Modify `mobile/lib/presentation/widgets/timeline/timeline.state.dart`.

Add this import:

```dart
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_segment_builder.dart';
```

Change the `timelineSegmentProvider` map block from:

```dart
  yield* timelineService.watchBuckets().map((buckets) {
    return FixedSegmentBuilder(
      buckets: buckets,
      tileHeight: tileExtent,
      columnCount: columnCount,
      spacing: spacing,
      groupBy: groupBy,
    ).generate();
  });
```

to:

```dart
  yield* timelineService.watchBuckets().map((buckets) {
    if (groupBy == GroupAssetsBy.year || groupBy == GroupAssetsBy.month) {
      return TimelineOverviewSegmentBuilder(buckets: buckets, groupBy: groupBy).generate();
    }

    return FixedSegmentBuilder(
      buckets: buckets,
      tileHeight: tileExtent,
      columnCount: columnCount,
      spacing: spacing,
      groupBy: groupBy,
    ).generate();
  });
```

- [ ] **Step 4: Format and run provider tests**

Run:

```bash
cd mobile
mise exec -- dart format lib/presentation/widgets/timeline/timeline.state.dart test/presentation/widgets/timeline/timeline_segment_provider_test.dart
mise exec -- flutter test test/presentation/widgets/timeline/timeline_segment_provider_test.dart
```

Expected green result:

- Year and month use `TimelineOverviewSegment`.
- Day remains `FixedSegment`.

## Task 4: Final Slice 3 Verification And Commit

**Files:**

- Verify all Slice 3 files.

- [ ] **Step 1: Run targeted tests together**

Run:

```bash
cd mobile
mise exec -- flutter test \
  test/presentation/widgets/timeline/overview/timeline_overview_card_test.dart \
  test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart \
  test/presentation/widgets/timeline/timeline_segment_provider_test.dart \
  test/presentation/widgets/timeline/fixed_segment_builder_test.dart \
  test/presentation/widgets/timeline/scrubber_segments_test.dart
```

Expected green result:

- All targeted tests pass.

- [ ] **Step 2: Run analyzer on touched production files**

Run:

```bash
cd mobile
mise exec -- dart analyze \
  lib/presentation/widgets/timeline/overview/overview_card.dart \
  lib/presentation/widgets/timeline/overview/overview_segment.model.dart \
  lib/presentation/widgets/timeline/overview/overview_segment_builder.dart \
  lib/presentation/widgets/timeline/timeline.state.dart
```

Expected green result:

- Analyzer exits `0` with no errors or warnings for touched production files.

- [ ] **Step 3: Check diff hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected result:

- `git diff --check` exits `0`.
- `git status --short` shows only intended Slice 3 files.

- [ ] **Step 4: Commit Slice 3**

Run:

```bash
git add \
  i18n/en.json \
  mobile/lib/presentation/widgets/timeline/overview/overview_card.dart \
  mobile/lib/presentation/widgets/timeline/overview/overview_segment.model.dart \
  mobile/lib/presentation/widgets/timeline/overview/overview_segment_builder.dart \
  mobile/lib/presentation/widgets/timeline/timeline.state.dart \
  mobile/test/presentation/widgets/timeline/overview/timeline_overview_card_test.dart \
  mobile/test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart \
  mobile/test/presentation/widgets/timeline/timeline_segment_provider_test.dart
git commit -m "feat(mobile): render timeline overview cards"
```

Expected result:

- Commit succeeds.
- Commit contains only Slice 3 overview-card data path work.

## Plan Self-Review

Spec coverage for Slice 3:

- TDD: every task starts with tests and records the expected red failure before implementation.
- Overview card visuals: tests cover year label, month/year label, singular/plural count, representative thumbnail widget, stable height, and fallback label/count visibility.
- Overview data path: tests cover one card per bucket, cumulative representative `firstAssetIndex`, compact segment extents, and one-child layout behavior.
- Day compatibility: provider test and existing fixed builder test keep day mode on the existing detailed fixed-grid path.
- Representative loading: segment model loads one asset for a visible segment via `TimelineService.hasRange`/`loadAssets`, avoiding a new unbounded repository query path.

Future-slice requirements intentionally not implemented here:

- Card tap drilldown and temporal chips belong to Slice 4.
- Shared route placement and cover-photo guardrails belong to Slice 5.
- Final accessibility semantics and responsive polish belong to Slice 6.
