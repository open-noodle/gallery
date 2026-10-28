import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/gallery/space_removal.dart';
import 'package:immich_mobile/presentation/actions/action.widget.dart';
import 'package:immich_mobile/presentation/actions/remove_from_space.action.dart';
import 'package:immich_ui/immich_ui.dart';
import 'package:mocktail/mocktail.dart';

import '../../factories/local_asset_factory.dart';
import '../../factories/remote_asset_factory.dart';
import '../presentation_context.dart';

class MockSpaceRemovalService extends Mock implements SpaceRemovalService {}

void main() {
  late PresentationContext context;
  late MockSpaceRemovalService removal;

  const spaceId = 'space-1';

  setUp(() async {
    context = await PresentationContext.create();
    removal = MockSpaceRemovalService();
    when(
      () => removal.remove(any(), any()),
    ).thenAnswer((_) async => (removed: <String>[], kept: 0, albumNames: <String>[]));
  });

  List<Override> scope(Set<BaseAsset> selection) => [
    ...context.selected(selection),
    spaceRemovalServiceProvider.overrideWithValue(removal),
  ];

  tearDown(() => context.dispose());

  RemoteAsset mine() => RemoteAssetFactory.create(ownerId: context.currentUser.id);
  RemoteAsset theirs() => RemoteAssetFactory.create();

  Future<void> pump(WidgetTester tester, Set<BaseAsset> selection, {VoidCallback? onComplete}) => tester.pumpTestAction(
    context,
    RemoveFromSpaceAction(source: .timeline, spaceId: spaceId, onComplete: onComplete),
    overrides: scope(selection),
  );

  group('RemoveFromSpaceAction', () {
    testWidgets('is hidden when the selection is empty', (tester) async {
      await tester.pumpTestWidget(
        context,
        const ActionIconButton(
          action: RemoveFromSpaceAction(source: .timeline, spaceId: spaceId),
        ),
        overrides: context.selected(const {}),
      );

      expect(find.byType(ImmichIconButton), findsNothing);
    });

    testWidgets('is hidden when the selection has no remote assets', (tester) async {
      await tester.pumpTestWidget(
        context,
        const ActionIconButton(
          action: RemoveFromSpaceAction(source: .timeline, spaceId: spaceId),
        ),
        overrides: context.selected({LocalAssetFactory.create()}),
      );

      expect(
        find.byType(ImmichIconButton),
        findsNothing,
        reason: 'a local-only asset was never added to the space, so there is nothing to remove',
      );
    });

    testWidgets('stays visible when every selected asset belongs to another member', (tester) async {
      await tester.pumpTestWidget(
        context,
        const ActionIconButton(
          action: RemoveFromSpaceAction(source: .timeline, spaceId: spaceId),
        ),
        overrides: context.selected({theirs()}),
      );

      expect(
        find.byType(ImmichIconButton),
        findsOneWidget,
        reason:
            'an editor must be able to remove a photo they do not own — the action must not gate visibility on '
            'ownership (ownedAssetsActionProvider would hide it here)',
      );
    });

    testWidgets('removes assets owned by other members, not just my own', (tester) async {
      final a = mine();
      final b = theirs();

      await pump(tester, {a, b});
      await tester.pumpAndSettle();

      final captured = verify(() => removal.remove(spaceId, captureAny())).captured.single as List<String>;
      expect(captured, containsAll([a.id, b.id]), reason: 'a space editor may remove another member\'s photo');
    });

    testWidgets("threads the action's own spaceId through to the service, not a different one", (tester) async {
      const otherSpaceId = 'space-2';

      await tester.pumpTestAction(
        context,
        const RemoveFromSpaceAction(source: .timeline, spaceId: otherSpaceId),
        overrides: scope({mine()}),
      );
      await tester.pumpAndSettle();

      verify(() => removal.remove(otherSpaceId, any())).called(1);
      verifyNever(() => removal.remove(spaceId, any()));
    });

    testWidgets('says how many photos the server removed', (tester) async {
      when(
        () => removal.remove(any(), any()),
      ).thenAnswer((_) async => (removed: ['a', 'b'], kept: 0, albumNames: <String>[]));

      await pump(tester, {mine(), theirs(), mine()});
      await tester.pumpUntilFound(find.byType(SnackBar));

      expect(find.text('Removed 2 assets'), findsOneWidget, reason: 'the server count, not the 3 asked for');
    });

    testWidgets('names the linked album of a photo it could not remove', (tester) async {
      when(
        () => removal.remove(any(), any()),
      ).thenAnswer((_) async => (removed: <String>[], kept: 1, albumNames: ['Trip']));

      await pump(tester, {mine()});
      await tester.pumpUntilFound(find.byType(SnackBar));

      expect(
        find.text(
          'This photo is in the album "Trip", which is linked to this space. Remove it from the album instead.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('explains photos it could not remove because a library brings them', (tester) async {
      when(
        () => removal.remove(any(), any()),
      ).thenAnswer((_) async => (removed: ['a'], kept: 2, albumNames: <String>[]));

      await pump(tester, {mine(), mine(), mine()});
      await tester.pumpUntilFound(find.byType(SnackBar));

      expect(
        find.text(
          "These photos are in a library linked to this space. Remove them from the library's folder, or unlink the library.",
        ),
        findsOneWidget,
      );
    });

    testWidgets('falls back to the general explanation when the album lookup fails, as web does', (tester) async {
      when(
        () => removal.remove(any(), any()),
      ).thenAnswer((_) async => (removed: <String>[], kept: 1, albumNames: null));

      await pump(tester, {mine()});
      await tester.pumpUntilFound(find.byType(SnackBar));

      expect(
        find.text(
          "Photos shared with this space through an album can't be removed here. Remove them from the album instead.",
        ),
        findsOneWidget,
      );
    });

    testWidgets('surfaces a translated error toast on failure, without throwing', (tester) async {
      when(() => removal.remove(any(), any())).thenThrow(Exception('boom'));

      await pump(tester, {mine()});
      await tester.pumpUntilFound(find.byType(SnackBar));

      expect(tester.takeException(), isNull);
      expect(find.byType(SnackBar), findsOneWidget);
      // The resolved translation, not the raw i18n key — a raw
      // 'scaffold_body_error_occurred' key leaking to the UI is the
      // regression this guards against.
      expect(find.text('Error occurred'), findsOneWidget);
      expect(find.text('scaffold_body_error_occurred'), findsNothing);
    });

    testWidgets('fires onComplete once', (tester) async {
      var calls = 0;

      await pump(tester, {mine()}, onComplete: () => calls++);
      await tester.pumpAndSettle();

      expect(calls, 1);
    });

    testWidgets('completes the success path when onComplete is null', (tester) async {
      when(
        () => removal.remove(any(), any()),
      ).thenAnswer((_) async => (removed: ['a', 'b', 'c', 'd', 'e'], kept: 0, albumNames: <String>[]));

      await pump(tester, {mine()});
      await tester.pumpUntilFound(find.byType(SnackBar));

      expect(tester.takeException(), isNull);
      // A null onComplete must be a no-op, not a crash that gets routed to
      // the generic error toast — pin the actual success toast, since
      // `takeException()` alone stays null either way (the action's own
      // try/catch swallows a bad null-check on onComplete and would surface
      // it as the same "no exception thrown" outcome).
      expect(find.text('Removed 5 assets'), findsOneWidget);
    });
  });
}
