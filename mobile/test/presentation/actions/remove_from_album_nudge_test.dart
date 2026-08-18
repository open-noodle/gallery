import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/constants/locales.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/generated/codegen_loader.g.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/space_album.repository.dart';
import 'package:immich_mobile/presentation/actions/action.widget.dart';
import 'package:immich_mobile/presentation/actions/remove_from_album.action.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/remote_album_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.state.dart';
import 'package:immich_mobile/providers/asset_viewer/asset_viewer.provider.dart';
import 'package:immich_mobile/providers/background_sync.provider.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart';
import 'package:immich_mobile/providers/routes.provider.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/asset_media.repository.dart';
import 'package:immich_mobile/repositories/drift_album_api_repository.dart';
import 'package:immich_mobile/services/action.service.dart';
import 'package:immich_mobile/services/cleanup.service.dart';
import 'package:immich_mobile/services/foreground_upload.service.dart';
import 'package:immich_mobile/services/gcast.service.dart';
import 'package:immich_mobile/services/server_info.service.dart';
import 'package:immich_mobile/utils/action_button.utils.dart';
import 'package:immich_ui/immich_ui.dart';
import 'package:mocktail/mocktail.dart';

import '../../infrastructure/repository.mock.dart';
import '../../unit/factories/remote_asset_factory.dart';
import '../../unit/presentation/presentation_context.dart';

class MockSpaceAlbumRepository extends Mock implements SpaceAlbumRepository {}

/// The viewer kebab resolves its asset from [assetViewerProvider], not from the
/// multiselect. Without this the action's `create()` returns null and renders a
/// zero-size `SizedBox` — which a finder still matches but a tap cannot hit.
class _StubAssetViewerNotifier extends AssetViewerStateNotifier {
  _StubAssetViewerNotifier(this._asset);

  final BaseAsset _asset;

  @override
  AssetViewerState build() => AssetViewerState(currentAsset: _asset);
}

/// Pins the Space-albums sync nudge on the two remove-from-album surfaces that were
/// migrated onto upstream's [RemoveFromAlbumAction] during the action-model adoption.
///
/// Both silently lost the nudge in that migration (2026-08-05 full-branch review):
/// upstream's action calls `remoteAlbumServiceProvider.removeAssets` directly and has no
/// completion hook. The fix put the nudge INSIDE that provider, so what these tests must
/// prove is that each surface still routes through it.
///
/// These tests deliberately do NOT override [remoteAlbumServiceProvider] — only its
/// dependencies — so the real provider is built and deleting the nudge in production
/// code fails them. That is also why they do not reuse `PresentationContext.overrides`:
/// it mocks that provider out, and inside that harness a nudge assertion cannot fail.
void main() {
  late PresentationContext ctx;
  late MockSpaceAlbumRepository spaceAlbumRepo;

  const albumId = 'album-1';
  late RemoteAsset asset;

  RemoteAlbum album() => RemoteAlbum(
    id: albumId,
    name: 'Ski trip',
    ownerId: ctx.currentUser.id,
    description: '',
    createdAt: DateTime(2026, 1, 1),
    updatedAt: DateTime(2026, 1, 1),
    isActivityEnabled: false,
    order: AlbumAssetOrder.desc,
    assetCount: 1,
    ownerName: 'owner',
    isShared: false,
  );

  setUp(() async {
    ctx = await PresentationContext.create();
    asset = RemoteAssetFactory.create(ownerId: ctx.currentUser.id);
    spaceAlbumRepo = MockSpaceAlbumRepository();

    when(
      () => ctx.repository.albumApi.removeAssets(any(), any()),
    ).thenAnswer((_) async => (removed: <String>[asset.id], failed: <String>[]));
    when(() => ctx.repository.remoteAlbum.removeAssets(any(), any())).thenAnswer((_) async {});
    when(() => ctx.service.backgroundSync.syncRemote()).thenAnswer((_) async => true);
    when(() => spaceAlbumRepo.isAlbumLinked(any())).thenAnswer((_) async => true);
    // The sheet renders AlbumSelector, which refreshes the album list on init.
    when(
      () => ctx.repository.remoteAlbum.getAll(currentUserId: any(named: 'currentUserId')),
    ).thenAnswer((_) async => <RemoteAlbum>[]);
  });

  tearDown(() => ctx.dispose());

  /// Stubs the Drift accessors this test's real `remoteAlbumServiceProvider` reaches.
  Drift mockDrift() {
    final drift = MockDrift();
    when(() => drift.remoteAssetRepository).thenReturn(ctx.repository.remoteAsset.repo);
    when(() => drift.remoteAlbumRepository).thenReturn(ctx.repository.remoteAlbum);
    return drift;
  }

  /// Mirrors `PresentationContext.overrides` MINUS `remoteAlbumServiceProvider`, plus the
  /// providers the real one reaches. Keep in step with that list if it grows.
  List<Override> overridesFor(Set<BaseAsset> selection) => [
    currentUserProvider.overrideWith((ref) => CurrentUserProvider(ctx.service.user.service)),
    assetServiceProvider.overrideWithValue(ctx.service.asset.service),
    cleanupServiceProvider.overrideWithValue(ctx.service.cleanup.service),
    actionServiceProvider.overrideWithValue(ctx.service.action.service),
    foregroundUploadServiceProvider.overrideWithValue(ctx.service.upload),
    partnerServiceProvider.overrideWithValue(ctx.service.partner.service),
    gCastServiceProvider.overrideWithValue(ctx.service.cast),
    serverInfoServiceProvider.overrideWithValue(ctx.service.serverInfo),
    inLockedViewProvider.overrideWithValue(false),
    // Upstream #30693 collapsed the per-repository providers into accessors on Drift, so the
    // repositories are now stubbed on a mocked Drift rather than overridden individually —
    // same approach as PresentationContext.mockDrift().
    driftProvider.overrideWithValue(mockDrift()),
    assetMediaRepositoryProvider.overrideWithValue(ctx.repository.assetMedia.api),
    // Dependencies of the REAL remoteAlbumServiceProvider (deliberately not overridden);
    // remoteAlbumRepository is stubbed on the mocked Drift above.
    driftAlbumApiRepositoryProvider.overrideWithValue(ctx.repository.albumApi),
    spaceAlbumRepositoryProvider.overrideWithValue(spaceAlbumRepo),
    backgroundSyncProvider.overrideWithValue(ctx.service.backgroundSync),
    timelineStateProvider.overrideWith(TimelineStateNotifier.new),
    assetViewerProvider.overrideWith(() => _StubAssetViewerNotifier(asset)),
    multiSelectProvider.overrideWith(
      () => MultiSelectNotifier(MultiSelectState(selectedAssets: selection, lockedSelectionAssets: const {})),
    ),
  ];

  Future<void> pump(WidgetTester tester, Widget widget) async {
    await tester.pumpWidget(
      EasyLocalization(
        supportedLocales: locales.values.toList(),
        path: translationsPath,
        startLocale: locales.values.first,
        fallbackLocale: locales.values.first,
        saveLocale: false,
        useFallbackTranslations: true,
        assetLoader: const CodegenLoader(),
        child: ProviderScope(
          overrides: overridesFor({asset}),
          child: Builder(
            builder: (context) => MaterialApp(
              debugShowCheckedModeBanner: false,
              scaffoldMessengerKey: scaffoldMessengerKey,
              localizationsDelegates: context.localizationDelegates,
              supportedLocales: context.supportedLocales,
              locale: context.locale,
              home: Scaffold(body: widget),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Finder removeAction() => find.byWidgetPredicate((w) => w is ActionWidget && w.action is RemoveFromAlbumAction);

  Future<void> tapRemove(WidgetTester tester) async {
    expect(removeAction(), findsOneWidget);
    // The bottom sheet lays its actions out in a horizontally scrolling Row and
    // remove-from-album sits near the end — without this the tap silently misses.
    await tester.ensureVisible(removeAction());
    await tester.pumpAndSettle();
    await tester.tap(removeAction());
    await tester.pumpAndSettle();
  }

  ActionButtonContext viewerContext() => ActionButtonContext(
    asset: asset,
    isOwner: true,
    isArchived: false,
    isTrashEnabled: true,
    isStacked: false,
    isInLockedView: false,
    currentAlbum: album(),
    advancedTroubleshooting: false,
    source: ActionSource.viewer,
  );

  group('remove-from-album nudges the Space sync', () {
    testWidgets('from the viewer kebab menu', (tester) async {
      await pump(tester, ActionButtonType.removeFromAlbum.buildButton(viewerContext()));
      await tapRemove(tester);

      verify(() => ctx.repository.albumApi.removeAssets(albumId, any())).called(1);
      verify(() => ctx.service.backgroundSync.syncRemote()).called(1);
    });

    testWidgets('from the album detail multiselect sheet', (tester) async {
      await pump(tester, RemoteAlbumBottomSheet(album: album()));
      await tapRemove(tester);

      verify(() => ctx.repository.albumApi.removeAssets(albumId, any())).called(1);
      verify(() => ctx.service.backgroundSync.syncRemote()).called(1);
    });

    testWidgets('but stays quiet when the album is linked to no space', (tester) async {
      when(() => spaceAlbumRepo.isAlbumLinked(any())).thenAnswer((_) async => false);

      await pump(tester, ActionButtonType.removeFromAlbum.buildButton(viewerContext()));
      await tapRemove(tester);

      verify(() => ctx.repository.albumApi.removeAssets(albumId, any())).called(1);
      verifyNever(() => ctx.service.backgroundSync.syncRemote());
    });
  });
}
