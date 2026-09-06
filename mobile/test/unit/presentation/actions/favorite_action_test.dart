import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/presentation/actions/favorite.action.dart';
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

  tearDown(() {
    context.dispose();
  });

  RemoteAsset owned({bool isFavorite = false}) =>
      RemoteAssetFactory.create(ownerId: context.currentUser.id, isFavorite: isFavorite);

  RemoteAsset notOwned({bool isFavorite = false}) => RemoteAssetFactory.create(isFavorite: isFavorite);

  group('FavoriteAction', () {
    testWidgets('favorites the eligible owned assets', (tester) async {
      final asset = owned();

      await tester.pumpTestAction(context, FavoriteAction(assets: [asset]));

      verify(() => assetService.updateFavorite([asset.id], true)).called(1);
    });

    testWidgets('unfavorite the eligible owned assets', (tester) async {
      final asset = owned(isFavorite: true);

      await tester.pumpTestAction(context, FavoriteAction(assets: [asset]));

      verify(() => assetService.updateFavorite([asset.id], false)).called(1);
    });

    // #763: favorites are per-user, not owner-gated — read access to a shared-space asset
    // (implied by it being in the local mirror) is sufficient to favorite it. This inverts the
    // pre-#763 "ignores assets owned by someone else" expectation.
    testWidgets('includes assets owned by someone else (un-gated)', (tester) async {
      final mine = owned();
      final theirs = notOwned();

      await tester.pumpTestAction(context, FavoriteAction(assets: [mine, theirs]));

      verify(() => assetService.updateFavorite([mine.id, theirs.id], true)).called(1);
    });

    testWidgets('is visible and actionable for a non-owned-only selection', (tester) async {
      final theirs = notOwned();

      await tester.pumpTestAction(context, FavoriteAction(assets: [theirs]));

      verify(() => assetService.updateFavorite([theirs.id], true)).called(1);
    });

    // #763 (E32): the direction must derive from the SAME candidate set the action mutates.
    // Before the fix, the direction flag was computed over the raw (unfiltered) selection while the
    // mutation set was owner-filtered — a non-owned asset could flip the direction while being
    // excluded from the mutation, leaving an empty mutation set sent to the service.
    testWidgets('E32: mixed ownership keeps direction and mutation set coherent', (tester) async {
      final mineFavorited = owned(isFavorite: true);
      final theirsUnfavorited = notOwned();

      final action = FavoriteAction(assets: [mineFavorited, theirsUnfavorited]);
      // Direction: theirsUnfavorited is not favorited yet -> favorite.
      expect(action.favorite, isTrue);

      await tester.pumpTestAction(context, action);

      // Mutation set: exactly the candidate not already in the target state (theirsUnfavorited).
      // Pre-fix, the owner filter would have dropped it, sending an empty id list.
      verify(() => assetService.updateFavorite([theirsUnfavorited.id], true)).called(1);
    });

    testWidgets('batches every eligible owned asset into a single call', (tester) async {
      final first = owned();
      final second = owned();

      await tester.pumpTestAction(context, FavoriteAction(assets: [first, second]));

      verify(() => assetService.updateFavorite([first.id, second.id], true)).called(1);
    });

    testWidgets('skips owned assets already in the target state', (tester) async {
      final stale = owned();
      final alreadyFavorite = owned(isFavorite: true);

      await tester.pumpTestAction(context, FavoriteAction(assets: [stale, alreadyFavorite]));

      verify(() => assetService.updateFavorite([stale.id], true)).called(1);
    });

    testWidgets('shows a confirmation snackbar on success', (tester) async {
      await tester.pumpTestAction(context, FavoriteAction(assets: [owned()]));
      await tester.pumpUntilFound(find.byType(SnackBar));

      expect(find.byType(SnackBar), findsOneWidget);
    });
  });
}
