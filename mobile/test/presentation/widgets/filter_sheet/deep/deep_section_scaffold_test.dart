import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_section_scaffold.widget.dart';

import '../../../../widget_tester_extensions.dart';

Future<ValueNotifier<AsyncValue<List<int>>>> _pump(
  WidgetTester tester, {
  required AsyncValue<List<int>> initial,
  VoidCallback? onRetry,
  String emptyKey = 'empty_caption_key',
}) async {
  final notifier = ValueNotifier<AsyncValue<List<int>>>(initial);
  addTearDown(notifier.dispose);
  await tester.pumpConsumerWidget(
    ValueListenableBuilder<AsyncValue<List<int>>>(
      valueListenable: notifier,
      builder: (_, value, __) => DeepSectionScaffold<int>(
        titleKey: 'filter_sheet_deep_people_section',
        emptyCaptionKey: emptyKey,
        items: value,
        onRetry: onRetry,
        childBuilder: (data) => Wrap(children: [for (final d in data) Text('item:$d')]),
      ),
    ),
  );
  return notifier;
}

void main() {
  testWidgets('AsyncLoading (no cache) → skeleton visible', (tester) async {
    await _pump(tester, initial: const AsyncLoading<List<int>>());
    await tester.pump();
    expect(find.byKey(const Key('deep-section-skeleton')), findsOneWidget);
  });

  testWidgets('AsyncData(non-empty) → childBuilder output', (tester) async {
    await _pump(tester, initial: const AsyncData<List<int>>([1, 2]));
    await tester.pumpAndSettle();
    expect(find.text('item:1'), findsOneWidget);
    expect(find.text('item:2'), findsOneWidget);
    expect(find.byKey(const Key('deep-section-skeleton')), findsNothing);
  });

  testWidgets('AsyncData([]) → empty caption text', (tester) async {
    await _pump(tester, initial: const AsyncData<List<int>>([]));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('deep-section-empty')), findsOneWidget);
  });

  testWidgets('AsyncError → retry button visible, tapping fires onRetry', (tester) async {
    var retried = 0;
    await _pump(
      tester,
      initial: const AsyncError<List<int>>('network down', StackTrace.empty),
      onRetry: () => retried++,
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('deep-section-retry')), findsOneWidget);
    await tester.tap(find.byKey(const Key('deep-section-retry')));
    expect(retried, 1);
  });

  testWidgets('AsyncData then AsyncLoading keeps cached data (no flash)', (tester) async {
    final notifier = await _pump(tester, initial: const AsyncData<List<int>>([9]));
    await tester.pumpAndSettle();
    notifier.value = const AsyncLoading<List<int>>();
    await tester.pump();
    expect(find.text('item:9'), findsOneWidget, reason: 'stale data retained across refetch');
    expect(find.byKey(const Key('deep-section-skeleton')), findsNothing);
  });
}
