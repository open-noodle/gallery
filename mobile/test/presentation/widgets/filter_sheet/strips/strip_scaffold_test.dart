import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/strip_scaffold.widget.dart';

import '../../../../widget_tester_extensions.dart';

/// Harness: feeds a mutable AsyncValue into StripScaffold via ValueNotifier so
/// tests can flip between loading / data / error transitions while preserving
/// the same StripScaffold element (and therefore its cached _lastData state).
Future<ValueNotifier<AsyncValue<List<dynamic>>>> _pumpHarness(
  WidgetTester tester, {
  required AsyncValue<List<dynamic>> initial,
  VoidCallback? onRetry,
}) async {
  final notifier = ValueNotifier<AsyncValue<List<dynamic>>>(initial);
  addTearDown(notifier.dispose);
  await tester.pumpConsumerWidget(
    ValueListenableBuilder<AsyncValue<List<dynamic>>>(
      valueListenable: notifier,
      builder: (_, value, _) => StripScaffold(
        titleKey: 'test_strip_title',
        items: value,
        height: 84,
        onRetry: onRetry,
        childBuilder: (data) => ListView(
          scrollDirection: Axis.horizontal,
          children: [for (final d in data) Text('item:$d')],
        ),
      ),
    ),
  );
  return notifier;
}

final _scaffoldKey = const Key('strip-scaffold');
final _skeletonKey = const Key('strip-skeleton');
final _retryKey = const Key('strip-retry');

void main() {
  testWidgets('first load (AsyncLoading, no cache) → skeleton visible, no content', (tester) async {
    await _pumpHarness(tester, initial: const AsyncLoading<List<dynamic>>());
    await tester.pump();

    expect(find.byKey(_scaffoldKey), findsOneWidget);
    expect(find.byKey(_skeletonKey), findsOneWidget);
    expect(find.textContaining('item:'), findsNothing);
  });

  testWidgets('AsyncData with items renders childBuilder output, no skeleton', (tester) async {
    await _pumpHarness(tester, initial: const AsyncData<List<dynamic>>(['A', 'B']));
    await tester.pumpAndSettle();

    expect(find.text('item:A'), findsOneWidget);
    expect(find.text('item:B'), findsOneWidget);
    expect(find.byKey(_skeletonKey), findsNothing);
  });

  testWidgets('AsyncData with empty list → scaffold collapses (SizedBox.shrink)', (tester) async {
    await _pumpHarness(tester, initial: const AsyncData<List<dynamic>>([]));
    await tester.pumpAndSettle();

    expect(find.byKey(_scaffoldKey), findsNothing);
    expect(find.byKey(_skeletonKey), findsNothing);
    expect(find.textContaining('item:'), findsNothing);
  });

  testWidgets('AsyncData → AsyncLoading: cached non-empty data still rendered, no skeleton flash', (tester) async {
    final notifier = await _pumpHarness(tester, initial: const AsyncData<List<dynamic>>(['A']));
    await tester.pumpAndSettle();
    expect(find.text('item:A'), findsOneWidget);

    notifier.value = const AsyncLoading<List<dynamic>>();
    await tester.pump();

    expect(find.text('item:A'), findsOneWidget, reason: 'stale data retained through refetch');
    expect(find.byKey(_skeletonKey), findsNothing, reason: 'no skeleton flash when cache has data');
  });

  testWidgets('cached-empty → AsyncLoading: scaffold stays collapsed (no push-down)', (tester) async {
    final notifier = await _pumpHarness(tester, initial: const AsyncData<List<dynamic>>([]));
    await tester.pumpAndSettle();
    expect(find.byKey(_scaffoldKey), findsNothing);

    notifier.value = const AsyncLoading<List<dynamic>>();
    await tester.pump();

    expect(find.byKey(_scaffoldKey), findsNothing, reason: 'cached empty → still collapsed during refetch');
    expect(find.byKey(_skeletonKey), findsNothing, reason: 'no skeleton push-down');
  });

  testWidgets('AsyncData → AsyncLoading → AsyncData: transitions smoothly, no flash', (tester) async {
    final notifier = await _pumpHarness(tester, initial: const AsyncData<List<dynamic>>(['A']));
    await tester.pumpAndSettle();

    notifier.value = const AsyncLoading<List<dynamic>>();
    await tester.pump();
    expect(find.text('item:A'), findsOneWidget);
    expect(find.byKey(_skeletonKey), findsNothing);

    notifier.value = const AsyncData<List<dynamic>>(['B', 'C']);
    await tester.pumpAndSettle();
    expect(find.text('item:A'), findsNothing);
    expect(find.text('item:B'), findsOneWidget);
    expect(find.text('item:C'), findsOneWidget);
  });

  testWidgets('AsyncError with no cache → retry button', (tester) async {
    await _pumpHarness(tester, initial: AsyncError<List<dynamic>>('boom', StackTrace.current));
    await tester.pumpAndSettle();

    expect(find.byKey(_retryKey), findsOneWidget);
    expect(find.byIcon(Icons.refresh_rounded), findsOneWidget);
  });

  testWidgets('AsyncError after cached data → keeps rendering cached data, no retry button', (tester) async {
    final notifier = await _pumpHarness(tester, initial: const AsyncData<List<dynamic>>(['A']));
    await tester.pumpAndSettle();

    notifier.value = AsyncError<List<dynamic>>('boom', StackTrace.current);
    await tester.pump();

    expect(find.byKey(_retryKey), findsNothing);
    expect(find.text('item:A'), findsOneWidget);
  });

  testWidgets('onRetry called when retry button tapped', (tester) async {
    var called = 0;
    await _pumpHarness(
      tester,
      initial: AsyncError<List<dynamic>>('boom', StackTrace.current),
      onRetry: () => called++,
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.refresh_rounded));
    expect(called, 1);
  });
}
