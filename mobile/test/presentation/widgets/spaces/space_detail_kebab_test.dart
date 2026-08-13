import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_detail_kebab.widget.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  Future<({List<String> events})> pumpKebab(
    WidgetTester tester, {
    bool canEdit = false,
    bool canDelete = false,
    bool showInTimeline = false,
    bool timelineBusy = false,
    bool showPeople = true,
  }) async {
    final events = <String>[];
    await tester.pumpConsumerWidget(
      SpaceDetailKebab(
        canEdit: canEdit,
        canDelete: canDelete,
        showInTimeline: showInTimeline,
        timelineBusy: timelineBusy,
        showPeople: showPeople,
        onToggleTimeline: () => events.add('timeline'),
        onPeople: () => events.add('people'),
        onMembers: () => events.add('members'),
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

  group('role gating', () {
    testWidgets('a viewer still gets a kebab', (tester) async {
      // The regression this slice guards: the actions a viewer relies on (timeline, People,
      // Members) moved OFF the app bar into this menu. The old rule hid the whole menu unless
      // canEdit, which would leave a viewer with an app bar containing nothing at all.
      await pumpKebab(tester, canEdit: false, canDelete: false);

      expect(find.byKey(const Key('space-detail-kebab')), findsOneWidget);
    });

    testWidgets('a viewer sees the navigation items but neither Edit nor Delete', (tester) async {
      await pumpKebab(tester, canEdit: false, canDelete: false);
      await openMenu(tester);

      expect(find.text('Show in timeline'), findsOneWidget);
      expect(find.text('People'), findsOneWidget);
      expect(find.text('Members'), findsOneWidget);
      expect(find.text('Edit Space'), findsNothing);
      expect(find.text('Delete Space'), findsNothing);
    });

    testWidgets('an editor sees Edit Space but not Delete Space', (tester) async {
      await pumpKebab(tester, canEdit: true, canDelete: false);
      await openMenu(tester);

      expect(find.text('Edit Space'), findsOneWidget);
      expect(find.text('Delete Space'), findsNothing);
    });

    testWidgets('an owner sees both Edit Space and Delete Space', (tester) async {
      await pumpKebab(tester, canEdit: true, canDelete: true);
      await openMenu(tester);

      expect(find.text('Edit Space'), findsOneWidget);
      expect(find.text('Delete Space'), findsOneWidget);
    });
  });

  group('timeline item', () {
    testWidgets('offers to show when the space is hidden from the timeline', (tester) async {
      await pumpKebab(tester, showInTimeline: false);
      await openMenu(tester);

      expect(find.text('Show in timeline'), findsOneWidget);
      expect(find.text('Hide from timeline'), findsNothing);
    });

    testWidgets('offers to hide when the space is shown in the timeline', (tester) async {
      await pumpKebab(tester, showInTimeline: true);
      await openMenu(tester);

      expect(find.text('Hide from timeline'), findsOneWidget);
      expect(find.text('Show in timeline'), findsNothing);
    });

    testWidgets('is inert while a toggle is already in flight', (tester) async {
      // The app bar button used `onPressed: null` to block double-submits; the menu item has to
      // keep that guarantee or a fast double-tap fires two toggles.
      final result = await pumpKebab(tester, timelineBusy: true);
      await openMenu(tester);

      await tester.tap(find.text('Show in timeline'));
      await tester.pumpAndSettle();

      expect(result.events, isEmpty);
    });

    testWidgets('is actionable when no toggle is in flight', (tester) async {
      final result = await pumpKebab(tester, timelineBusy: false);
      await openMenu(tester);

      await tester.tap(find.text('Show in timeline'));
      await tester.pumpAndSettle();

      expect(result.events, ['timeline']);
    });
  });

  group('People item', () {
    testWidgets('is offered when the space has face recognition', (tester) async {
      await pumpKebab(tester, showPeople: true);
      await openMenu(tester);

      expect(find.text('People'), findsOneWidget);
    });

    testWidgets('is withheld when the space has face recognition disabled', (tester) async {
      await pumpKebab(tester, showPeople: false);
      await openMenu(tester);

      expect(find.text('People'), findsNothing);
    });

    testWidgets('withholding People leaves the rest of the menu intact', (tester) async {
      // A space with face recognition off must not lose Members or the timeline toggle with it.
      await pumpKebab(tester, showPeople: false, canEdit: true, canDelete: true);
      await openMenu(tester);

      expect(find.text('Show in timeline'), findsOneWidget);
      expect(find.text('Members'), findsOneWidget);
      expect(find.text('Edit Space'), findsOneWidget);
      expect(find.text('Delete Space'), findsOneWidget);
    });
  });

  group('selection routes to exactly one callback', () {
    testWidgets('selecting People invokes onPeople only', (tester) async {
      final result = await pumpKebab(tester);
      await openMenu(tester);

      await tester.tap(find.text('People'));
      await tester.pumpAndSettle();

      expect(result.events, ['people']);
    });

    testWidgets('selecting Members invokes onMembers only', (tester) async {
      final result = await pumpKebab(tester);
      await openMenu(tester);

      await tester.tap(find.text('Members'));
      await tester.pumpAndSettle();

      expect(result.events, ['members']);
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
  });

  testWidgets('orders the menu with navigation first and Delete Space last', (tester) async {
    // Destructive last, and the order the app bar used left-to-right otherwise, so muscle memory
    // from the icon row survives the move.
    await pumpKebab(tester, canEdit: true, canDelete: true, showInTimeline: true);
    await openMenu(tester);

    final positions = [
      tester.getTopLeft(find.text('Hide from timeline')).dy,
      tester.getTopLeft(find.text('People')).dy,
      tester.getTopLeft(find.text('Members')).dy,
      tester.getTopLeft(find.text('Edit Space')).dy,
      tester.getTopLeft(find.text('Delete Space')).dy,
    ];

    expect(positions, orderedEquals([...positions]..sort()));
  });
}
