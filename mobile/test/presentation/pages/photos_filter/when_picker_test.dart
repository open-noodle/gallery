import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/when_picker.page.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';
import 'package:immich_mobile/providers/photos_filter/time_buckets.provider.dart';
import 'package:immich_mobile/providers/photos_filter/when_picker.provider.dart';

import '../../../widget_tester_extensions.dart';

void _setSize(WidgetTester tester, {double width = 400, double height = 1200}) {
  tester.view.physicalSize = Size(width * tester.view.devicePixelRatio, height * tester.view.devicePixelRatio);
  addTearDown(() {
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });
}

void main() {
  group('WhenPickerPage', () {
    testWidgets('renders AppBar with back icon, title key, and Done button', (tester) async {
      await tester.pumpConsumerWidget(const WhenPickerPage());
      expect(find.byIcon(Icons.arrow_back_rounded), findsOneWidget);
      expect(find.text('filter_sheet_picker_when_title'), findsOneWidget);
      expect(find.byKey(const Key('when-picker-done')), findsOneWidget);
    });

    testWidgets('Done button meets 48pt tap target', (tester) async {
      await tester.pumpConsumerWidget(const WhenPickerPage());
      expectTapTargetMin(tester, find.byKey(const Key('when-picker-done')));
    });

    testWidgets('Done button pops the navigator stack', (tester) async {
      await tester.pumpConsumerWidget(
        Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                key: const Key('open-when-picker'),
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const WhenPickerPage())),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('open-when-picker')));
      await tester.pumpAndSettle();
      expect(find.byType(WhenPickerPage), findsOneWidget);

      await tester.tap(find.byKey(const Key('when-picker-done')));
      await tester.pumpAndSettle();
      expect(find.byType(WhenPickerPage), findsNothing);
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(const WhenPickerPage());
      expect(find.byType(WhenPickerPage), findsOneWidget);
    });
  });

  group('WhenPickerPage search', () {
    testWidgets('typing updates whenPickerQueryProvider', (tester) async {
      await tester.pumpConsumerWidget(
        const WhenPickerPage(),
        overrides: [
          whenPickerFilteredYearsProvider.overrideWith(
            (ref) async => const <YearCount>[YearCount(year: 2024, count: 12)],
          ),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(WhenPickerPage)));
      await tester.enterText(find.byKey(const Key('when-picker-search-field')), '2024');
      await tester.pump();

      expect(container.read(whenPickerQueryProvider), '2024');
    });

    testWidgets('non-matching query renders No results panel + Clear search, tapping clears', (tester) async {
      await tester.pumpConsumerWidget(
        const WhenPickerPage(),
        overrides: [whenPickerFilteredYearsProvider.overrideWith((ref) async => const <YearCount>[])],
      );
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('when-picker-search-field')), '1800');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('when-picker-clear-search')), findsOneWidget);

      final container = ProviderScope.containerOf(tester.element(find.byType(WhenPickerPage)));
      await tester.tap(find.byKey(const Key('when-picker-clear-search')));
      await tester.pumpAndSettle();

      expect(container.read(whenPickerQueryProvider), '');
      expect(find.byKey(const Key('when-picker-clear-search')), findsNothing);
    });
  });

  group('WhenPickerPage integration', () {
    testWidgets('renders the year accordion when years are present', (tester) async {
      _setSize(tester);
      await tester.pumpConsumerWidget(
        const WhenPickerPage(),
        overrides: [
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future.value(const <BucketLite>[
              (timeBucket: '2024-06-01', count: 10),
              (timeBucket: '2023-03-01', count: 3),
            ]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('when-year-2024')), findsOneWidget);
      expect(find.byKey(const Key('when-year-2023')), findsOneWidget);
      // Nothing expanded by default.
      expect(find.byKey(const Key('when-month-grid-2024')), findsNothing);
    });

    testWidgets('typing "2024" auto-expands the 2024 year row', (tester) async {
      _setSize(tester);
      await tester.pumpConsumerWidget(
        const WhenPickerPage(),
        overrides: [
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future.value(const <BucketLite>[
              (timeBucket: '2024-06-01', count: 10),
              (timeBucket: '2023-03-01', count: 3),
            ]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('when-month-grid-2024')), findsNothing);

      await tester.enterText(find.byKey(const Key('when-picker-search-field')), '2024');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('when-month-grid-2024')), findsOneWidget);
    });

    testWidgets('typing a decade does not auto-expand any year', (tester) async {
      _setSize(tester);
      await tester.pumpConsumerWidget(
        const WhenPickerPage(),
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

      await tester.enterText(find.byKey(const Key('when-picker-search-field')), '2020s');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('when-year-2024')), findsOneWidget);
      expect(find.byKey(const Key('when-year-2020')), findsOneWidget);
      // No year expanded — decade selection alone doesn't force an expansion.
      expect(find.byKey(const Key('when-month-grid-2024')), findsNothing);
      expect(find.byKey(const Key('when-month-grid-2020')), findsNothing);
    });

    // Plan §C4 test 3: "Tapping a decade chip scrolls the year accordion to
    // the decade's newest year." Integration test — lives here because the
    // accordion (C5) + page scroll plumbing is required.
    testWidgets('tapping a decade chip scrolls the accordion to that decade\'s newest year', (tester) async {
      _setSize(tester, width: 400, height: 800);
      await tester.pumpConsumerWidget(
        const WhenPickerPage(),
        overrides: [
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future.value(const <BucketLite>[
              // Recent decade first (2020s) — ends up near the top.
              (timeBucket: '2024-06-01', count: 10),
              (timeBucket: '2022-01-01', count: 5),
              // Older decade (2000s) — without scroll, lives past the fold.
              (timeBucket: '2008-06-01', count: 3),
              (timeBucket: '2003-01-01', count: 1),
            ]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      // 2008 should exist in the tree (mounted), but may be below the
      // viewport before we tap the decade chip.
      expect(find.byKey(const Key('when-year-2008')), findsOneWidget);

      await tester.tap(find.byKey(const Key('when-decade-2000')));
      await tester.pumpAndSettle();

      // The newest year in the 2000s decade is 2008 — assert its row is
      // now inside the viewport (near the top).
      final rect = tester.getRect(find.byKey(const Key('when-year-2008')));
      expect(rect.top, lessThan(800));
      expect(rect.bottom, greaterThan(0));
    });
  });
}
