import 'package:auto_route/auto_route.dart';
import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/extensions/asset_extensions.dart';
import 'package:immich_mobile/presentation/widgets/asset_viewer/asset_viewer.page.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:openapi/api.dart';

/// Opens a cleanup photo in the normal asset viewer and completes when the viewer closes. Resolves false when the
/// photo could not be found.
typedef LibraryCleanupOpenInLibrary = Future<bool> Function(BuildContext context, WidgetRef ref, CleanupAssetDto asset);

/// "Open in library", the way the fork's search results open a remote photo (`gallery/search/search_timeline.dart`):
/// the phone's synced row when it has one, else the server's asset (`GET /assets/{id}`) as a remote asset, in a
/// timeline of that one photo. Back returns to the session, which is still on the same card.
final libraryCleanupOpenInLibraryProvider = Provider<LibraryCleanupOpenInLibrary>(
  (ref) => (context, widgetRef, asset) async {
    BaseAsset? found = await widgetRef.read(assetServiceProvider).getRemoteAsset(asset.id);
    if (found == null) {
      try {
        found = (await widgetRef.read(apiServiceProvider).assetsApi.getAssetInfo(asset.id))?.toDto();
      } catch (_) {
        found = null;
      }
    }
    if (found == null || !context.mounted) {
      return false;
    }
    AssetViewer.setAsset(widgetRef, found);
    await context.pushRoute(
      AssetViewerRoute(
        initialIndex: 0,
        timelineService: widgetRef.read(timelineFactoryProvider).fromAssets([found], TimelineOrigin.search),
      ),
    );
    return true;
  },
);

/// Days finished in a rewind that the overview has not shown turning green yet (the web's `finishedDay` handoff). The
/// overview takes a day out once it pops its cell, which it does only while it is the screen on top.
final libraryCleanupFinishedDaysProvider = StateProvider<Set<int>>((ref) => const {});
