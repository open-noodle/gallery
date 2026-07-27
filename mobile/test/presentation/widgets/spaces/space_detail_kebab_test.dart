import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_detail_kebab.widget.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  Future<({List<String> events})> pumpKebab(
    WidgetTester tester, {
    required bool canEdit,
    required bool canDelete,
  }) async {
    final events = <String>[];
    await tester.pumpConsumerWidget(
      SpaceDetailKebab(
        canEdit: canEdit,
        canDelete: canDelete,
        onEdit: () => events.add('edit'),
        onDelete: () => events.add('delete'),
      ),
    );
    return (events: events);
  }

  Future<void> openMenu(WidgetTester tester) async {
    await tester.tap(find.byKey(const Key('space-detail-kebab')));
    await tester.pumpAndSettle();
  }

  testWidgets('an owner sees both Edit Space and Delete Space', (tester) async {
    await pumpKebab(tester, canEdit: true, canDelete: true);
    await openMenu(tester);

    expect(find.text('Edit Space'), findsOneWidget);
    expect(find.text('Delete Space'), findsOneWidget);
  });

  testWidgets('an editor sees Edit Space but not Delete Space', (tester) async {
    // The regression this slice fixes: editors previously saw no kebab at all.
    await pumpKebab(tester, canEdit: true, canDelete: false);
    await openMenu(tester);

    expect(find.text('Edit Space'), findsOneWidget);
    expect(find.text('Delete Space'), findsNothing);
  });

  testWidgets('a viewer sees no kebab at all', (tester) async {
    await pumpKebab(tester, canEdit: false, canDelete: false);

    expect(find.byKey(const Key('space-detail-kebab')), findsNothing);
  });

  testWidgets('selecting Edit Space invokes onEdit only', (tester) async {
    final result = await pumpKebab(tester, canEdit: true, canDelete: true);
    await openMenu(tester);

    await tester.tap(find.text('Edit Space'));
    await tester.pumpAndSettle();

    expect(result.events, ['edit']);
  });

  testWidgets('selecting Delete Space invokes onDelete only', (tester) async {
    final result = await pumpKebab(tester, canEdit: true, canDelete: true);
    await openMenu(tester);

    await tester.tap(find.text('Delete Space'));
    await tester.pumpAndSettle();

    expect(result.events, ['delete']);
  });
}
