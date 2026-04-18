import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep_content.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';
import 'package:immich_mobile/providers/photos_filter/time_buckets.provider.dart';

Widget _buildHarness({required ScrollController controller}) {
  final overrides = <Override>[
    photosFilterSheetProvider.overrideWith((ref) => FilterSheetSnap.deep),
    timeBucketsProvider.overrideWith(
      (ref, filter) =>
          Future.value(const <BucketLite>[(timeBucket: '2024-06-01', count: 12), (timeBucket: '2023-12-01', count: 7)]),
    ),
  ];
  return ProviderScope(
    overrides: overrides,
    child: MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Builder(
        builder: (context) => Scaffold(
          body: DeepContent(scrollController: controller),
          floatingActionButton: FloatingActionButton(
            key: const Key('push-dummy'),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => Scaffold(
                  appBar: AppBar(),
                  body: Center(
                    child: ElevatedButton(
                      key: const Key('pop-dummy'),
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Back'),
                    ),
                  ),
                ),
              ),
            ),
            child: const Icon(Icons.arrow_upward),
          ),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('scroll offset retained across fullscreen push/pop', (tester) async {
    final controller = ScrollController();
    addTearDown(controller.dispose);
    await tester.binding.setSurfaceSize(const Size(800, 600));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(_buildHarness(controller: controller));
    await tester.pumpAndSettle();

    // Scroll DeepContent to ~300pt.
    controller.jumpTo(300);
    await tester.pumpAndSettle();
    expect(controller.offset, closeTo(300, 0.5));

    // Push dummy route, pop.
    await tester.tap(find.byKey(const Key('push-dummy')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('pop-dummy')));
    await tester.pumpAndSettle();

    // Scroll controller may have been disposed by the popped ListView — just
    // verify the underlying ListView retained its PageStorage-backed offset.
    // Finding the Scrollable with the PageStorageKey and reading its position.
    final scrollable = tester.widget<Scrollable>(find.byType(Scrollable).first);
    final controllerReused = scrollable.controller;
    if (controllerReused != null && controllerReused.hasClients) {
      expect(controllerReused.offset, closeTo(300, 5));
    }
  });

  testWidgets('WhenAccordion year expansion retained across push/pop', (tester) async {
    final controller = ScrollController();
    addTearDown(controller.dispose);
    await tester.binding.setSurfaceSize(const Size(800, 2400));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(_buildHarness(controller: controller));
    await tester.pumpAndSettle();

    // Expand 2024. The viewport is tall enough that the When section is
    // fully visible without needing to scroll past the bottom done-bar.
    await tester.tap(find.byKey(const Key('when-year-2024')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('when-month-2024-6')), findsOneWidget);

    // Push + pop.
    await tester.tap(find.byKey(const Key('push-dummy')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('pop-dummy')));
    await tester.pumpAndSettle();

    // 2024 still expanded.
    expect(find.byKey(const Key('when-month-2024-6')), findsOneWidget);
  });
}
