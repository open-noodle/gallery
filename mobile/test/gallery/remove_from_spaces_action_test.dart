import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/gallery/remove_from_spaces.action.dart';
import 'package:immich_mobile/gallery/space_removal.dart';
import 'package:immich_mobile/gallery/space_remove.provider.dart';
import 'package:immich_mobile/presentation/actions/action.widget.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/widgets/spaces/space_collage.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' show UserAvatarColor;

import '../unit/factories/remote_asset_factory.dart';
import '../unit/presentation/presentation_context.dart';

class MockSpaceRemovalService extends Mock implements SpaceRemovalService {}

void main() {
  late PresentationContext context;
  late MockSpaceRemovalService removal;

  final a1 = RemoteAssetFactory.create();
  final a2 = RemoteAssetFactory.create();
  final a3 = RemoteAssetFactory.create();
  final family = (id: 'family', name: 'Family', color: UserAvatarColor.pink, assetIds: [a1.id, a2.id]);
  final trips = (id: 'trips', name: 'Trips', color: UserAvatarColor.blue, assetIds: [a3.id]);

  setUp(() async {
    context = await PresentationContext.create();
    removal = MockSpaceRemovalService();
    when(() => removal.remove(any(), any())).thenAnswer(
      (invocation) async =>
          (removed: invocation.positionalArguments[1] as List<String>, kept: 0, albumNames: const <String>[]),
    );
  });

  tearDown(() => context.dispose());

  Future<void> pump(
    WidgetTester tester, {
    required FutureOr<List<RemovableSpace>> spaces,
    TimelineOrigin origin = TimelineOrigin.main,
    ActionSource source = .timeline,
  }) => tester.pumpTestWidget(
    context,
    ActionColumnButton(action: RemoveFromSpacesAction(source: source)),
    expectSettle: false,
    overrides: [
      ...context.selected({a1, a2, a3}),
      removableSpacesProvider.overrideWith((ref) => spaces),
      spaceRemovalServiceProvider.overrideWithValue(removal),
      timelineServiceProvider.overrideWithValue(
        TimelineService((
          assetSource: (_, _) async => const [],
          bucketSource: () => Stream.value(const []),
          origin: origin,
        )),
      ),
    ],
  );

  // Something on the test screen animates forever, so pumpAndSettle never returns: let the sheet animate in or out.
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }
  }

  Set<BaseAsset> selection(WidgetTester tester) => ProviderScope.containerOf(
    tester.element(find.byType(ActionColumnButton)),
  ).read(multiSelectProvider).selectedAssets;

  testWidgets('is hidden outside the Photos timeline, in the viewer, and with no space to remove from', (tester) async {
    for (final (origin, source, spaces) in [
      (TimelineOrigin.person, ActionSource.timeline, [family]),
      (TimelineOrigin.favorite, ActionSource.timeline, [family]),
      (TimelineOrigin.main, ActionSource.viewer, [family]),
      (TimelineOrigin.main, ActionSource.timeline, <RemovableSpace>[]),
    ]) {
      await pump(tester, spaces: spaces, origin: origin, source: source);
      await tester.pump();
      expect(find.byIcon(Icons.remove_circle_outline), findsNothing, reason: '$origin $source ${spaces.length}');
    }
  });

  testWidgets('is hidden while the spaces of the selection are not known yet', (tester) async {
    await pump(tester, spaces: Completer<List<RemovableSpace>>().future);
    await tester.pump();

    expect(find.byIcon(Icons.remove_circle_outline), findsNothing);
  });

  testWidgets('names the one space and removes its photos without asking', (tester) async {
    await pump(tester, spaces: [family]);
    await tester.pump();
    final before = selection(tester);
    expect(before, hasLength(3));

    await tester.tap(find.text('Remove from Family'));
    await tester.pumpUntilFound(find.byType(SnackBar));

    expect(find.byType(BottomSheet), findsNothing, reason: 'no choice and no confirmation on mobile');
    verify(() => removal.remove('family', [a1.id, a2.id])).called(1);
    expect(find.text('Removed 2 assets'), findsOneWidget);
  });

  testWidgets('acts only on photos still selected, even with an answer from the previous selection', (tester) async {
    // The query for the new selection has not answered yet: the spaces still list a deselected photo.
    final stale = (id: 'family', name: 'Family', color: UserAvatarColor.pink, assetIds: [a1.id, a2.id, 'deselected']);
    await pump(tester, spaces: [stale]);
    await tester.pump();

    await tester.tap(find.text('Remove from Family'));
    await tester.pumpUntilFound(find.byType(SnackBar));

    verify(() => removal.remove('family', [a1.id, a2.id])).called(1);
  });

  testWidgets('asks which space when there are several, then removes from that one', (tester) async {
    await pump(tester, spaces: [family, trips]);
    await tester.pump();

    await tester.tap(find.text('Remove from a space…'));
    await settle(tester);

    expect(find.text('Remove from space'), findsOneWidget, reason: 'the picker title');
    expect(find.text('2 items'), findsOneWidget);
    expect(find.text('1 item'), findsOneWidget);
    // The dark end of the space card's gradient, which reads on the sheet.
    final familyIcon = tester.widget<Icon>(
      find.descendant(of: find.byKey(const Key('space-remove-family')), matching: find.byIcon(Icons.workspaces)),
    );
    expect(familyIcon.color, spaceGradientColors(UserAvatarColor.pink).last);

    await tester.tap(find.text('Trips'));
    await tester.pumpUntilFound(find.byType(SnackBar));

    verify(() => removal.remove('trips', [a3.id])).called(1);
    verifyNever(() => removal.remove('family', any()));
  });

  testWidgets('removes nothing when the picker is dismissed', (tester) async {
    await pump(tester, spaces: [family, trips]);
    await tester.pump();

    await tester.tap(find.text('Remove from a space…'));
    await settle(tester);
    expect(find.text('Remove from space'), findsOneWidget);
    await tester.tapAt(const Offset(10, 10));
    await settle(tester);

    expect(find.text('Remove from space'), findsNothing, reason: 'the picker is gone');
    verifyNever(() => removal.remove(any(), any()));
  });

  testWidgets('shows the error and keeps the selection when the server refuses', (tester) async {
    when(() => removal.remove(any(), any())).thenThrow(Exception('403'));
    await pump(tester, spaces: [family]);
    await tester.pump();

    await tester.tap(find.text('Remove from Family'));
    await tester.pumpUntilFound(find.byType(SnackBar));

    expect(find.text('Error occurred'), findsOneWidget);
    expect(selection(tester), hasLength(3));
  });

  testWidgets('clears the selection once the photos are removed', (tester) async {
    await pump(tester, spaces: [family]);
    await tester.pump();
    final container = ProviderScope.containerOf(tester.element(find.byType(ActionColumnButton)));

    await tester.tap(find.text('Remove from Family'));
    await tester.pumpUntilFound(find.byType(SnackBar));

    expect(container.read(multiSelectProvider).selectedAssets, isEmpty);
  });
}
