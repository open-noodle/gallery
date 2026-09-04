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
/// activates the destination timeline route. They are injected so the sequencing can be
/// tested without a router.
///
/// [spaceId] names the Space whose timeline [goToTimeline] lands on, and travels with
/// the latched request so only that timeline drains it. A Space timeline is pushed OVER
/// the main one, which stays mounted and listening, so an unscoped request would be
/// taken by whichever is laid out first (#1047).
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
///   timeline instead of the results it is replacing — except for a Space jump,
///   which inverts that step for the reason given on the branch below.
Future<void> viewAssetInTimeline({
  required BaseAsset asset,
  required ProviderReader read,
  required Future<void> Function() popViewer,
  required Future<void> Function() goToTimeline,
  String? spaceId,
}) async {
  await popViewer();
  read(photosFilterProvider.notifier).reset();
  read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.hidden;
  if (spaceId != null) {
    // A Space timeline is PUSHED over the main one, and auto_route's push future
    // completes when the route is POPPED, not when it is pushed (`_addNewPage` returns
    // the pop completer). Waiting for it would latch the request only once the user had
    // already left the Space, so the jump landed on the Space at the top and never
    // scrolled. Latching first is safe precisely because the request names the Space:
    // the main timeline reads a scoped request as `idle` and leaves it alone (#1047).
    scrollToAssetNotifierProvider.scrollToAsset(asset, spaceId: spaceId);
    await goToTimeline();
    return;
  }
  await goToTimeline();
  scrollToAssetNotifierProvider.scrollToAsset(asset);
}
