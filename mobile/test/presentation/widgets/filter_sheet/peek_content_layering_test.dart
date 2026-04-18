import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/peek_content.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/bottom_nav_height.provider.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  testWidgets('peek rail bottom padding = navHeight + 8 when nav visible', (tester) async {
    await tester.pumpConsumerWidget(
      PeekContent(scrollController: ScrollController()),
      overrides: [bottomNavHeightProvider.overrideWith((_) => 64)],
    );
    await tester.pumpAndSettle();

    final padding = tester.widget<Padding>(find.byKey(const Key('peek-content-bottom-pad')));
    expect(padding.padding.resolve(TextDirection.ltr).bottom, 72);
  });

  testWidgets('peek rail bottom padding = 0 when nav hidden', (tester) async {
    await tester.pumpConsumerWidget(
      PeekContent(scrollController: ScrollController()),
      overrides: [bottomNavHeightProvider.overrideWith((_) => 0)],
    );
    await tester.pumpAndSettle();

    final padding = tester.widget<Padding>(find.byKey(const Key('peek-content-bottom-pad')));
    expect(padding.padding.resolve(TextDirection.ltr).bottom, 0);
  });

  testWidgets('no-op height write does not rebuild height consumer', (tester) async {
    int buildCount = 0;
    final container = ProviderContainer(overrides: [bottomNavHeightProvider.overrideWith((_) => 64)]);
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          home: Material(
            child: Consumer(
              builder: (_, ref, _) {
                buildCount++;
                ref.watch(bottomNavHeightProvider);
                return PeekContent(scrollController: ScrollController());
              },
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final firstCount = buildCount;

    // Writer uses the equality-guarded pattern from §5.6:
    if (container.read(bottomNavHeightProvider) != 64) {
      container.read(bottomNavHeightProvider.notifier).state = 64;
    }
    await tester.pumpAndSettle();

    expect(buildCount, firstCount, reason: 'equality-guard suppresses the redundant write');

    // Changing value does cause rebuild.
    if (container.read(bottomNavHeightProvider) != 80) {
      container.read(bottomNavHeightProvider.notifier).state = 80;
    }
    await tester.pumpAndSettle();
    expect(buildCount, greaterThan(firstCount));
  });
}
