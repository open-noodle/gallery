import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/decade_anchor_strip.widget.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';
import 'package:immich_mobile/providers/photos_filter/time_buckets.provider.dart';

import '../../../../widget_tester_extensions.dart';

void _setSize(WidgetTester tester, {double width = 900, double height = 600}) {
  tester.view.physicalSize = Size(width * tester.view.devicePixelRatio, height * tester.view.devicePixelRatio);
  addTearDown(() {
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });
}

void main() {
  group('DecadeAnchorStrip', () {
    testWidgets('renders one chip per populated decade', (tester) async {
      _setSize(tester);
      await tester.pumpConsumerWidget(
        DecadeAnchorStrip(onDecade: (_) {}),
        overrides: [
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future.value(const <BucketLite>[
              (timeBucket: '2024-06-01', count: 10),
              (timeBucket: '2020-03-01', count: 3),
              (timeBucket: '2015-01-01', count: 5),
            ]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('when-decade-2020')), findsOneWidget);
      expect(find.byKey(const Key('when-decade-2010')), findsOneWidget);
    });

    testWidgets('buckets in 2008 + 2024 render exactly 2 chips (2000, 2020)', (tester) async {
      _setSize(tester);
      await tester.pumpConsumerWidget(
        DecadeAnchorStrip(onDecade: (_) {}),
        overrides: [
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future.value(const <BucketLite>[
              (timeBucket: '2024-01-01', count: 10),
              (timeBucket: '2008-01-01', count: 5),
            ]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('when-decade-2020')), findsOneWidget);
      expect(find.byKey(const Key('when-decade-2000')), findsOneWidget);
      // No empty decades in between (2010 should NOT render).
      expect(find.byKey(const Key('when-decade-2010')), findsNothing);
    });

    testWidgets('tapping a decade chip fires onDecade with decadeStart', (tester) async {
      _setSize(tester);
      int? tapped;
      await tester.pumpConsumerWidget(
        DecadeAnchorStrip(onDecade: (d) => tapped = d),
        overrides: [
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future.value(const <BucketLite>[
              (timeBucket: '2024-01-01', count: 1),
              (timeBucket: '2008-01-01', count: 1),
            ]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('when-decade-2020')));
      await tester.pumpAndSettle();
      expect(tapped, 2020);
    });

    testWidgets('empty buckets → hidden (SizedBox.shrink)', (tester) async {
      _setSize(tester);
      await tester.pumpConsumerWidget(
        Column(children: [DecadeAnchorStrip(onDecade: (_) {})]),
        overrides: [timeBucketsProvider.overrideWith((ref, filter) => Future.value(const <BucketLite>[]))],
      );
      await tester.pumpAndSettle();

      expect(
        find.byType(Material).evaluate().any((e) {
          final key = e.widget.key;
          return key is ValueKey && key.value.toString().startsWith('when-decade-');
        }),
        isFalse,
      );
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      _setSize(tester);
      await tester.pumpConsumerWidgetDark(
        DecadeAnchorStrip(onDecade: (_) {}),
        overrides: [
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future.value(const <BucketLite>[(timeBucket: '2024-01-01', count: 1)]),
          ),
        ],
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('when-decade-2020')), findsOneWidget);
    });
  });
}
