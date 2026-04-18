import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/quick_ranges_row.widget.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../../widget_tester_extensions.dart';

/// Force a logical MediaQuery size by overriding the test view's physical size.
/// `tester.binding.setSurfaceSize` is a no-op under the current Flutter test
/// binding — setting the view's physical size directly (at fixed 3.0 dpr) is
/// the working API. Required so all 4 quick-range pills fit on-screen without
/// the horizontal ListView lazily dropping the trailing ones.
void _setLogicalSize(WidgetTester tester, Size logical, {double dpr = 3.0}) {
  tester.view.devicePixelRatio = dpr;
  tester.view.physicalSize = Size(logical.width * dpr, logical.height * dpr);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  group('QuickRangesRow', () {
    testWidgets('renders 4 preset pills (Today / Week / Month / Year)', (tester) async {
      _setLogicalSize(tester, const Size(1600, 600));
      await tester.pumpConsumerWidget(const QuickRangesRow());
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('when-picker-pill-today')), findsOneWidget);
      expect(find.byKey(const Key('when-picker-pill-week')), findsOneWidget);
      expect(find.byKey(const Key('when-picker-pill-month')), findsOneWidget);
      expect(find.byKey(const Key('when-picker-pill-year')), findsOneWidget);
    });

    testWidgets('tap Today sets date range around now', (tester) async {
      _setLogicalSize(tester, const Size(1600, 600));
      await tester.pumpConsumerWidget(const QuickRangesRow());
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(QuickRangesRow)));
      await tester.tap(find.byKey(const Key('when-picker-pill-today')));
      await tester.pumpAndSettle();

      final range = container.read(photosFilterProvider).date;
      expect(range.takenAfter, isNotNull);
      expect(range.takenBefore, isNotNull);
      final now = DateTime.now();
      expect(range.takenAfter!.year, now.year);
      expect(range.takenAfter!.month, now.month);
      expect(range.takenAfter!.day, now.day);
    });

    testWidgets('tap Year sets Jan 1 → now', (tester) async {
      _setLogicalSize(tester, const Size(1600, 600));
      await tester.pumpConsumerWidget(const QuickRangesRow());
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(QuickRangesRow)));
      await tester.tap(find.byKey(const Key('when-picker-pill-year')));
      await tester.pumpAndSettle();

      final range = container.read(photosFilterProvider).date;
      expect(range.takenAfter, isNotNull);
      final now = DateTime.now();
      expect(range.takenAfter!.year, now.year);
      expect(range.takenAfter!.month, 1);
      expect(range.takenAfter!.day, 1);
    });

    testWidgets('selection highlight: pill shows primary tinted color when filter matches', (tester) async {
      _setLogicalSize(tester, const Size(1600, 600));
      await tester.pumpConsumerWidget(const QuickRangesRow());
      await tester.pumpAndSettle();

      // Tap Today, then verify Today pill renders with primary-tinted background.
      // Selected color = theme.colorScheme.primary.withValues(alpha: 0.14) — alpha < 1.0.
      await tester.tap(find.byKey(const Key('when-picker-pill-today')));
      await tester.pumpAndSettle();

      final todayMaterial = tester.widget<Material>(find.byKey(const Key('when-picker-pill-today')));
      expect(todayMaterial.color, isNotNull);
      expect(todayMaterial.color!.a, lessThan(1.0));
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      _setLogicalSize(tester, const Size(1600, 600));
      await tester.pumpConsumerWidgetDark(const QuickRangesRow());
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('when-picker-pill-today')), findsOneWidget);
    });
  });
}
