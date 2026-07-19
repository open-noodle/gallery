import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/widgets/common/collection_sort_button.dart';

import '../../widget_tester_extensions.dart';

/// [CollectionSortButton] sizes to its intrinsic content (as it does when
/// embedded in a `Row` on a real page). `pumpConsumerWidget` places `home`
/// under tight, full-screen constraints, which would otherwise stretch the
/// button's `Row(mainAxisSize: MainAxisSize.min)` to fill the screen and make
/// its true (small) tap target unreachable by `tester.tap`. `Align` restores
/// loose constraints so the button reports — and can be tapped at — its
/// actual on-screen size.
Widget _wrap(Widget child) => Align(alignment: Alignment.topLeft, child: child);

void main() {
  const options = [(mode: 0, label: 'name'), (mode: 1, label: 'sort_photos')];

  final pillFinder = find.byKey(const Key('collection-sort-button-pill'));

  testWidgets('renders "Sort: <current label>"', (tester) async {
    await tester.pumpConsumerWidget(
      _wrap(CollectionSortButton<int>(options: options, current: 0, isReverse: false, onChanged: (_, _) {})),
    );

    expect(find.text('Sort: Name'), findsOneWidget);
  });

  testWidgets('tapping the pill opens a menu listing all options', (tester) async {
    await tester.pumpConsumerWidget(
      _wrap(CollectionSortButton<int>(options: options, current: 0, isReverse: false, onChanged: (_, _) {})),
    );

    await tester.tap(pillFinder);
    await tester.pumpAndSettle();

    expect(find.text('Name'), findsOneWidget);
    expect(find.text('Photos'), findsOneWidget);
  });

  testWidgets('selecting a different mode reports it un-reversed; re-tapping current reverses', (tester) async {
    int? gotMode;
    bool? gotReverse;

    await tester.pumpConsumerWidget(
      _wrap(
        CollectionSortButton<int>(
          options: options,
          current: 0,
          isReverse: false,
          onChanged: (m, r) {
            gotMode = m;
            gotReverse = r;
          },
        ),
      ),
    );

    await tester.tap(pillFinder);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Photos')); // a different mode
    await tester.pumpAndSettle();
    expect(gotMode, 1);
    expect(gotReverse, false);

    await tester.tap(pillFinder);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Name')); // the current mode -> reverse
    await tester.pumpAndSettle();
    expect(gotMode, 0);
    expect(gotReverse, true);
  });

  testWidgets('menu shows a down arrow on the current option by default (isReverse: false)', (tester) async {
    await tester.pumpConsumerWidget(
      _wrap(CollectionSortButton<int>(options: options, current: 0, isReverse: false, onChanged: (_, _) {})),
    );

    await tester.tap(pillFinder);
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.arrow_downward), findsOneWidget);
    expect(find.byIcon(Icons.arrow_upward), findsNothing);
  });

  testWidgets('menu shows an up arrow on the current option when isReverse: true', (tester) async {
    await tester.pumpConsumerWidget(
      _wrap(CollectionSortButton<int>(options: options, current: 0, isReverse: true, onChanged: (_, _) {})),
    );

    await tester.tap(pillFinder);
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.arrow_upward), findsOneWidget);
    expect(find.byIcon(Icons.arrow_downward), findsNothing);
  });
}
