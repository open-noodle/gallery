import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/presentation/actions/action.widget.dart';
import 'package:immich_mobile/presentation/actions/remove_from_space.action.dart';
import 'package:immich_ui/immich_ui.dart';
import 'package:mocktail/mocktail.dart';

import '../../../service.mocks.dart';
import '../../factories/local_asset_factory.dart';
import '../../factories/remote_asset_factory.dart';
import '../presentation_context.dart';

void main() {
  late PresentationContext context;
  late MockActionService actionService;

  const spaceId = 'space-1';

  setUp(() async {
    context = await PresentationContext.create();
    actionService = context.service.action.service;
  });

  tearDown(() => context.dispose());

  RemoteAsset mine() => RemoteAssetFactory.create(ownerId: context.currentUser.id);
  RemoteAsset theirs() => RemoteAssetFactory.create();

  Future<void> pump(WidgetTester tester, Set<BaseAsset> selection, {VoidCallback? onComplete}) => tester.pumpTestAction(
    context,
    RemoveFromSpaceAction(source: .timeline, spaceId: spaceId, onComplete: onComplete),
    overrides: context.selected(selection),
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

      final captured =
          verify(() => actionService.removeFromSpace(captureAny(), spaceId)).captured.single as List<String>;
      expect(captured, containsAll([a.id, b.id]), reason: 'a space editor may remove another member\'s photo');
    });

    testWidgets("threads the action's own spaceId through to the service, not a different one", (tester) async {
      const otherSpaceId = 'space-2';

      await tester.pumpTestAction(
        context,
        const RemoveFromSpaceAction(source: .timeline, spaceId: otherSpaceId),
        overrides: context.selected({mine()}),
      );
      await tester.pumpAndSettle();

      verify(() => actionService.removeFromSpace(any(), otherSpaceId)).called(1);
      verifyNever(() => actionService.removeFromSpace(any(), spaceId));
    });

    testWidgets('shows a snackbar with the removed count on success', (tester) async {
      when(() => actionService.removeFromSpace(any(), any())).thenAnswer((_) async => 2);

      await pump(tester, {mine()});
      await tester.pumpUntilFound(find.byType(SnackBar));

      expect(find.text('2 photos removed from space'), findsOneWidget);
    });

    testWidgets('surfaces a translated error toast on failure, without throwing', (tester) async {
      when(() => actionService.removeFromSpace(any(), any())).thenThrow(Exception('boom'));

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
      when(() => actionService.removeFromSpace(any(), any())).thenAnswer((_) async => 5);

      await pump(tester, {mine()});
      await tester.pumpUntilFound(find.byType(SnackBar));

      expect(tester.takeException(), isNull);
      // A null onComplete must be a no-op, not a crash that gets routed to
      // the generic error toast — pin the actual success toast, since
      // `takeException()` alone stays null either way (the action's own
      // try/catch swallows a bad null-check on onComplete and would surface
      // it as the same "no exception thrown" outcome).
      expect(find.text('5 photos removed from space'), findsOneWidget);
    });
  });
}
