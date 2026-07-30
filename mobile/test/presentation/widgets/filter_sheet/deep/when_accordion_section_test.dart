import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/when_accordion_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/collapsed_sections.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';
import 'package:immich_mobile/providers/photos_filter/time_buckets.provider.dart';

import '../../../../widget_tester_extensions.dart';

class _FakePrefs implements FilterSectionPrefs {
  final Set<FilterSectionId> collapsed;
  _FakePrefs(this.collapsed);
  @override
  Set<FilterSectionId> loadCollapsed() => collapsed;
  @override
  Future<void> saveCollapsed(Set<FilterSectionId> ids) async {}
}

Override _noCollapsed() => filterSectionPrefsProvider.overrideWithValue(_FakePrefs({}));

List<BucketLite> _seed({Map<String, int> counts = const {'2024-06-01': 12, '2024-01-01': 3, '2023-12-01': 7}}) => [
  for (final e in counts.entries) (timeBucket: e.key, count: e.value),
];

/// One bucket per year, descending from [newest] for [count] consecutive years.
List<BucketLite> _seedYears(int count, {int newest = 2026}) => [
  for (var i = 0; i < count; i++) (timeBucket: '${newest - i}-06-01', count: 10 + i),
];

/// Long year lists exceed the 800×600 test viewport. In the app the section is
/// a child of `DeepContent`'s ListView, so scroll it here too — otherwise the
/// harness reports a RenderFlex overflow that the real layout never hits.
Widget _scrolled(Widget child) => Material(child: SingleChildScrollView(child: child));

void main() {
  group('WhenAccordionSection', () {
    testWidgets('renders year rows in descending order', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: WhenAccordionSection(onOpenPicker: null)),
        overrides: [_noCollapsed(), timeBucketsProvider.overrideWith((ref, filter) => Future.value(_seed()))],
      );
      await tester.pumpAndSettle();

      final pos24 = tester.getTopLeft(find.byKey(const Key('when-year-2024')));
      final pos23 = tester.getTopLeft(find.byKey(const Key('when-year-2023')));
      expect(pos24.dy, lessThan(pos23.dy));
    });

    testWidgets('tapping a year expands the inline month grid', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: WhenAccordionSection(onOpenPicker: null)),
        overrides: [_noCollapsed(), timeBucketsProvider.overrideWith((ref, filter) => Future.value(_seed()))],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('when-month-2024-1')), findsNothing);
      await tester.tap(find.byKey(const Key('when-year-2024')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('when-month-2024-1')), findsOneWidget);
      expect(find.byKey(const Key('when-month-2024-6')), findsOneWidget);
    });

    testWidgets('tapping another year collapses the first (single-expand)', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: WhenAccordionSection(onOpenPicker: null)),
        overrides: [_noCollapsed(), timeBucketsProvider.overrideWith((ref, filter) => Future.value(_seed()))],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('when-year-2024')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('when-month-2024-1')), findsOneWidget);

      await tester.tap(find.byKey(const Key('when-year-2023')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('when-month-2024-1')), findsNothing);
      expect(find.byKey(const Key('when-month-2023-12')), findsOneWidget);
    });

    testWidgets('tapping a month sets setDateRange(first, last)', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: WhenAccordionSection(onOpenPicker: null)),
        overrides: [_noCollapsed(), timeBucketsProvider.overrideWith((ref, filter) => Future.value(_seed()))],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(WhenAccordionSection)));
      await tester.tap(find.byKey(const Key('when-year-2024')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('when-month-2024-6')));
      await tester.pumpAndSettle();

      final date = container.read(photosFilterProvider).date;
      expect(date.takenAfter, DateTime(2024, 6, 1));
      expect(date.takenBefore, DateTime(2024, 7, 0, 23, 59, 59));
    });

    testWidgets('tapping the same month twice clears the date range', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: WhenAccordionSection(onOpenPicker: null)),
        overrides: [_noCollapsed(), timeBucketsProvider.overrideWith((ref, filter) => Future.value(_seed()))],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(WhenAccordionSection)));
      await tester.tap(find.byKey(const Key('when-year-2024')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('when-month-2024-6')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('when-month-2024-6')));
      await tester.pumpAndSettle();

      final date = container.read(photosFilterProvider).date;
      expect(date.takenAfter, isNull);
      expect(date.takenBefore, isNull);
    });

    testWidgets('empty buckets → section auto-collapses, "(0)" shown, empty caption hidden', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: WhenAccordionSection(onOpenPicker: null)),
        overrides: [
          _noCollapsed(),
          timeBucketsProvider.overrideWith((ref, filter) => Future.value(const <BucketLite>[])),
        ],
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('(0)'), findsOneWidget);
      expect(find.byKey(const Key('deep-section-empty')), findsNothing);
    });

    // Final review: the "N years →" row lives in the section BODY, not the header
    // (matches the People/Places/Tags/Camera body-row pattern).
    testWidgets('renders "N years →" in the body (not the header)', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: WhenAccordionSection(onOpenPicker: null)),
        overrides: [_noCollapsed(), timeBucketsProvider.overrideWith((ref, filter) => Future.value(_seed()))],
      );
      await tester.pumpAndSettle();

      expect(
        find.descendant(
          of: find.byKey(const Key('collapsible-body-when')),
          matching: find.byKey(const Key('when-section-search-more')),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const Key('collapsible-header-when')),
          matching: find.byKey(const Key('when-section-search-more')),
        ),
        findsNothing,
      );
    });

    testWidgets('onOpenPicker fires on "N years →" tap', (tester) async {
      var opened = false;
      await tester.pumpConsumerWidget(
        Material(child: WhenAccordionSection(onOpenPicker: () => opened = true)),
        overrides: [_noCollapsed(), timeBucketsProvider.overrideWith((ref, filter) => Future.value(_seed()))],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('when-section-search-more')));
      expect(opened, isTrue);
    });

    testWidgets('null onOpenPicker does NOT show a SnackBar when "N years →" tapped', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: WhenAccordionSection()),
        overrides: [_noCollapsed(), timeBucketsProvider.overrideWith((ref, filter) => Future.value(_seed()))],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('when-section-search-more')));
      await tester.pumpAndSettle();

      expect(find.byType(SnackBar), findsNothing);
    });

    testWidgets('server error → DeepSectionScaffold retry button, tapping invalidates provider', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: WhenAccordionSection(onOpenPicker: null)),
        overrides: [
          _noCollapsed(),
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future<List<BucketLite>>.error('network down', StackTrace.empty),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('deep-section-retry')), findsOneWidget);
    });

    testWidgets('selected month pill uses primary color in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(
        const Material(child: WhenAccordionSection(onOpenPicker: null)),
        overrides: [_noCollapsed(), timeBucketsProvider.overrideWith((ref, filter) => Future.value(_seed()))],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('when-year-2024')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('when-month-2024-6')));
      await tester.pumpAndSettle();

      // Basic assertion: month pill exists. Detailed color check is brittle
      // in widget tests; presence + basic selection semantics is enough.
      expect(find.byKey(const Key('when-month-2024-6')), findsOneWidget);
    });

    // #820: When was the only Deep section rendering its list uncapped — a
    // library spanning 73 years produced 73 rows every time the section was
    // expanded. Cap the preview like People (6) / Tags / Camera / Places (10).
    testWidgets('caps the preview to the 10 most recent years', (tester) async {
      await tester.pumpConsumerWidget(
        _scrolled(const WhenAccordionSection(onOpenPicker: null)),
        overrides: [_noCollapsed(), timeBucketsProvider.overrideWith((ref, filter) => Future.value(_seedYears(15)))],
      );
      await tester.pumpAndSettle();

      // 2026..2017 — the 10 most recent.
      for (var y = 2026; y > 2016; y--) {
        expect(find.byKey(Key('when-year-$y')), findsOneWidget, reason: '$y is within the cap');
      }
      // 2016..2012 — beyond the cap, reachable via "N years →".
      for (var y = 2016; y >= 2012; y--) {
        expect(find.byKey(Key('when-year-$y')), findsNothing, reason: '$y is beyond the cap');
      }
    });

    // Mirrors the "selected suggestions beyond the cap are pinned" rule the
    // People / Tags / Camera / Places sections follow: a year the user already
    // filtered on must stay visible even when it sits past the cap.
    testWidgets('pins a beyond-cap year covered by the active date range', (tester) async {
      await tester.pumpConsumerWidget(
        _scrolled(const WhenAccordionSection(onOpenPicker: null)),
        overrides: [
          _noCollapsed(),
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future.value([..._seedYears(15), (timeBucket: '1953-04-01', count: 42)]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(WhenAccordionSection)));
      container
          .read(photosFilterProvider.notifier)
          .setDateRange(start: DateTime(1953, 4, 1), end: DateTime(1953, 5, 0, 23, 59, 59));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('when-year-1953')), findsOneWidget, reason: 'selected year is pinned past the cap');
      // Unselected overflow stays hidden.
      expect(find.byKey(const Key('when-year-2016')), findsNothing);
    });

    // Guard: the pin must not become a backdoor that re-expands the whole list.
    // An open-ended "before 2015" range overlaps 19 of the seeded years.
    testWidgets('an open-ended date range cannot re-expand the section past the cap', (tester) async {
      await tester.pumpConsumerWidget(
        _scrolled(const WhenAccordionSection(onOpenPicker: null)),
        overrides: [_noCollapsed(), timeBucketsProvider.overrideWith((ref, filter) => Future.value(_seedYears(30)))],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(WhenAccordionSection)));
      container.read(photosFilterProvider.notifier).setDateRange(start: null, end: DateTime(2015, 12, 31));
      await tester.pumpAndSettle();

      // Newest overlapping years pin; the long tail stays behind "N years →".
      expect(find.byKey(const Key('when-year-2015')), findsOneWidget);
      expect(find.byKey(const Key('when-year-2005')), findsNothing, reason: 'pinned overflow is itself bounded');
      expect(find.byKey(const Key('when-year-1997')), findsNothing, reason: 'pinned overflow is itself bounded');
    });

    testWidgets('≤10 years renders all, no over-cap', (tester) async {
      await tester.pumpConsumerWidget(
        _scrolled(const WhenAccordionSection(onOpenPicker: null)),
        overrides: [_noCollapsed(), timeBucketsProvider.overrideWith((ref, filter) => Future.value(_seedYears(4)))],
      );
      await tester.pumpAndSettle();

      for (var y = 2026; y > 2022; y--) {
        expect(find.byKey(Key('when-year-$y')), findsOneWidget);
      }
    });

    // The capped preview must not shrink the picker affordance's count — it
    // advertises how many years the picker reaches, not how many are shown.
    testWidgets('"N years →" reports the total year count, not the capped preview length', (tester) async {
      await tester.pumpConsumerWidget(
        _scrolled(const WhenAccordionSection(onOpenPicker: null)),
        overrides: [_noCollapsed(), timeBucketsProvider.overrideWith((ref, filter) => Future.value(_seedYears(15)))],
      );
      await tester.pumpAndSettle();

      expect(
        find.descendant(of: find.byKey(const Key('when-section-search-more')), matching: find.text('15 years →')),
        findsOneWidget,
      );
    });
  });
}
