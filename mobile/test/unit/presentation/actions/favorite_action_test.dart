import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/presentation/actions/action.widget.dart';
import 'package:immich_mobile/presentation/actions/favorite.action.dart';
import 'package:immich_ui/immich_ui.dart';
import 'package:mocktail/mocktail.dart';

import '../../../service.mocks.dart';
import '../../factories/remote_asset_factory.dart';
import '../presentation_context.dart';

void main() {
  late PresentationContext context;
  late MockAssetService assetService;

  setUp(() async {
    context = await PresentationContext.create();
    assetService = context.service.asset.service;
  });

  tearDown(() async {
    await context.dispose();
  });

  RemoteAsset owned({bool isFavorite = false}) =>
      RemoteAssetFactory.create(ownerId: context.currentUser.id, isFavorite: isFavorite);

  RemoteAsset notOwned({bool isFavorite = false}) => RemoteAssetFactory.create(isFavorite: isFavorite);

  Future<void> pumpFavorite(WidgetTester tester, Set<BaseAsset> selection) =>
      tester.pumpTestAction(context, const FavoriteAction(source: .timeline), overrides: context.selected(selection));

  group('FavoriteAction', () {
    testWidgets('favorites the eligible assets', (tester) async {
      final asset = owned();

      await pumpFavorite(tester, {asset});

      verify(() => assetService.updateFavorite([asset.id], true)).called(1);
    });

    testWidgets('unfavorite the eligible assets', (tester) async {
      final asset = owned(isFavorite: true);

      await pumpFavorite(tester, {asset});

      verify(() => assetService.updateFavorite([asset.id], false)).called(1);
    });

    // #763: favorites are per-user, not owner-gated — read access to a shared-space asset
    // (implied by it being in the local mirror) is sufficient to favorite it. This inverts the
    // pre-#763 "ignores assets owned by someone else" expectation.
    testWidgets('includes assets owned by someone else (un-gated)', (tester) async {
      final mine = owned();
      final theirs = notOwned();

      await pumpFavorite(tester, {mine, theirs});

      verify(() => assetService.updateFavorite([mine.id, theirs.id], true)).called(1);
    });

    testWidgets('is actionable for a non-owned-only selection', (tester) async {
      final theirs = notOwned();

      await pumpFavorite(tester, {theirs});

      verify(() => assetService.updateFavorite([theirs.id], true)).called(1);
    });

    // #763 (E32): the direction must derive from the SAME candidate set the action mutates.
    // Before the fix, the direction flag was computed over the raw (unfiltered) selection while the
    // mutation set was owner-filtered — a non-owned asset could flip the direction while being
    // excluded from the mutation, leaving an empty mutation set sent to the service.
    testWidgets('E32: mixed ownership keeps direction and mutation set coherent', (tester) async {
      final mineFavorited = owned(isFavorite: true);
      final theirsUnfavorited = notOwned();

      await pumpFavorite(tester, {mineFavorited, theirsUnfavorited});

      // Mutation set: exactly the candidate not already in the target state (theirsUnfavorited).
      // Pre-fix, the owner filter would have dropped it, sending an empty id list.
      verify(() => assetService.updateFavorite([theirsUnfavorited.id], true)).called(1);
    });

    testWidgets('batches every eligible asset into a single call', (tester) async {
      final first = owned();
      final second = owned();

      await pumpFavorite(tester, {first, second});

      verify(() => assetService.updateFavorite([first.id, second.id], true)).called(1);
    });

    testWidgets('skips assets already in the target state', (tester) async {
      final stale = owned();
      final alreadyFavorite = owned(isFavorite: true);

      await pumpFavorite(tester, {stale, alreadyFavorite});

      verify(() => assetService.updateFavorite([stale.id], true)).called(1);
    });

    testWidgets('shows a confirmation snackbar on success', (tester) async {
      await pumpFavorite(tester, {owned()});
      await tester.pumpUntilFound(find.byType(SnackBar));

      expect(find.byType(SnackBar), findsOneWidget);
    });

    testWidgets('clears the selection once the update succeeds', (tester) async {
      await pumpFavorite(tester, {owned()});
      await tester.pumpAndSettle();

      expect(find.byType(ImmichIconButton), findsNothing, reason: 'an empty selection hides the action');
    });

    // #763: inverted from the pre-#763 "hidden when none of the selected assets are owned".
    testWidgets('is visible when none of the selected assets are owned', (tester) async {
      await tester.pumpTestWidget(
        context,
        const ActionIconButton(action: FavoriteAction(source: .timeline)),
        overrides: context.selected({RemoteAssetFactory.create()}),
      );

      expect(find.byType(ImmichIconButton), findsOneWidget);
    });
  });
}
