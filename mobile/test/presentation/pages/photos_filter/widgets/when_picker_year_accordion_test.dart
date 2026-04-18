import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/when_picker_year_accordion.widget.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';
import 'package:immich_mobile/providers/photos_filter/time_buckets.provider.dart';

import '../../../../widget_tester_extensions.dart';

void _setSize(WidgetTester tester, {double width = 400, double height = 900}) {
  tester.view.physicalSize = Size(width * tester.view.devicePixelRatio, height * tester.view.devicePixelRatio);
  addTearDown(() {
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });
}

Widget _harness({required int? expandedYear, required ValueChanged<int?> onExpand}) {
  return WhenPickerYearAccordion(
    yearKeyFor: (year) => GlobalKey(debugLabel: 'y$year'),
    expandedYear: expandedYear,
    onExpandYear: onExpand,
  );
}

void main() {
  group('WhenPickerYearAccordion', () {
    testWidgets('renders year rows from whenPickerFilteredYearsProvider', (tester) async {
      _setSize(tester);
      int? expanded;
      await tester.pumpConsumerWidget(
        SingleChildScrollView(child: _harness(expandedYear: null, onExpand: (y) => expanded = y)),
        overrides: [
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future.value(const <BucketLite>[
              (timeBucket: '2024-06-01', count: 10),
              (timeBucket: '2020-03-01', count: 3),
            ]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('when-year-2024')), findsOneWidget);
      expect(find.byKey(const Key('when-year-2020')), findsOneWidget);
      expect(find.byKey(const Key('when-month-grid-2024')), findsNothing);
      expect(expanded, isNull);
    });

    testWidgets('tapping a year calls onExpandYear with that year', (tester) async {
      _setSize(tester);
      int? expanded;
      await tester.pumpConsumerWidget(
        SingleChildScrollView(child: _harness(expandedYear: null, onExpand: (y) => expanded = y)),
        overrides: [
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future.value(const <BucketLite>[(timeBucket: '2024-06-01', count: 10)]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('when-year-2024')));
      await tester.pumpAndSettle();
      expect(expanded, 2024);
    });

    testWidgets('tapping an already-expanded year calls onExpandYear(null)', (tester) async {
      _setSize(tester);
      int? expanded = 2024;
      await tester.pumpConsumerWidget(
        SingleChildScrollView(child: _harness(expandedYear: 2024, onExpand: (y) => expanded = y)),
        overrides: [
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future.value(const <BucketLite>[(timeBucket: '2024-06-01', count: 10)]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('when-year-2024')));
      await tester.pumpAndSettle();
      expect(expanded, isNull);
    });

    testWidgets('when expandedYear is set, month grid renders inline', (tester) async {
      _setSize(tester);
      await tester.pumpConsumerWidget(
        SingleChildScrollView(child: _harness(expandedYear: 2024, onExpand: (_) {})),
        overrides: [
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future.value(const <BucketLite>[
              (timeBucket: '2024-06-01', count: 10),
              (timeBucket: '2024-11-01', count: 3),
            ]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('when-month-grid-2024')), findsOneWidget);
      expect(find.byKey(const Key('when-month-2024-6')), findsOneWidget);
      expect(find.byKey(const Key('when-month-2024-11')), findsOneWidget);
      // Fill bars present only for months with data.
      expect(find.byKey(const Key('when-month-fill-2024-6')), findsOneWidget);
      expect(find.byKey(const Key('when-month-fill-2024-11')), findsOneWidget);
      expect(find.byKey(const Key('when-month-fill-2024-1')), findsNothing);
    });

    testWidgets('tapping a month sets date range (setDateRange)', (tester) async {
      _setSize(tester);
      await tester.pumpConsumerWidget(
        SingleChildScrollView(child: _harness(expandedYear: 2024, onExpand: (_) {})),
        overrides: [
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future.value(const <BucketLite>[(timeBucket: '2024-06-01', count: 10)]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(WhenPickerYearAccordion)));
      await tester.tap(find.byKey(const Key('when-month-2024-6')));
      await tester.pumpAndSettle();

      final range = container.read(photosFilterProvider).date;
      expect(range.takenAfter, DateTime(2024, 6, 1));
      expect(range.takenBefore, DateTime(2024, 7, 0, 23, 59, 59));
    });

    testWidgets('tapping the same selected month clears the range', (tester) async {
      _setSize(tester);
      await tester.pumpConsumerWidget(
        SingleChildScrollView(child: _harness(expandedYear: 2024, onExpand: (_) {})),
        overrides: [
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future.value(const <BucketLite>[(timeBucket: '2024-06-01', count: 10)]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(WhenPickerYearAccordion)));
      await tester.tap(find.byKey(const Key('when-month-2024-6')));
      await tester.pumpAndSettle();
      expect(container.read(photosFilterProvider).date.takenAfter, isNotNull);

      await tester.tap(find.byKey(const Key('when-month-2024-6')));
      await tester.pumpAndSettle();
      expect(container.read(photosFilterProvider).date.takenAfter, isNull);
      expect(container.read(photosFilterProvider).date.takenBefore, isNull);
    });

    testWidgets('empty years → hidden (SizedBox.shrink)', (tester) async {
      _setSize(tester);
      await tester.pumpConsumerWidget(
        _harness(expandedYear: null, onExpand: (_) {}),
        overrides: [timeBucketsProvider.overrideWith((ref, filter) => Future.value(const <BucketLite>[]))],
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('when-year-2024')), findsNothing);
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      _setSize(tester);
      await tester.pumpConsumerWidgetDark(
        SingleChildScrollView(child: _harness(expandedYear: 2024, onExpand: (_) {})),
        overrides: [
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future.value(const <BucketLite>[(timeBucket: '2024-06-01', count: 10)]),
          ),
        ],
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('when-year-2024')), findsOneWidget);
    });
  });
}
