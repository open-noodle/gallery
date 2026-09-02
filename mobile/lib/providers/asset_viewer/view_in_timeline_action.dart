import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/providers/asset_viewer/scroll_to_asset_notifier.provider.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_search_action.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// Jumps from a scoped timeline (search results, a person, a place, an album, a
/// memory, the backup detail list) to [asset]'s place in the global Photos
/// timeline.
///
/// [popViewer] closes the surface the action was invoked from, [goToTimeline]
/// activates the main timeline route. They are injected so the sequencing can be
/// tested without a router.
///
/// Clearing the Photos filter is what makes this work from search results (#898).
/// Unlike web, mobile has no separate search route: `MainTimelinePage` renders the
/// results itself, swapping its `timelineServiceProvider` for a search-backed one
/// while the filter is non-empty. The timeline route is therefore already on screen
/// behind the viewer, so popping and navigating to it lands right back in the same
/// results. The filter — not the route — is what has to change.
///
/// The order is load-bearing:
/// * pop first, because clearing the filter disposes the search `TimelineService`
///   the viewer was handed by value;
/// * latch the scroll target last, so the drain resolves against the global
///   timeline instead of the results it is replacing.
Future<void> viewAssetInTimeline({
  required BaseAsset asset,
  required ProviderReader read,
  required Future<void> Function() popViewer,
  required Future<void> Function() goToTimeline,
}) async {
  await popViewer();
  read(photosFilterProvider.notifier).reset();
  read(photosFilterSheetProvider.notifier).state = FilterSheetVisibility.hidden;
  await goToTimeline();
  scrollToAssetNotifierProvider.scrollToAsset(asset);
}
