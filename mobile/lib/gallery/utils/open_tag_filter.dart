import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/tag.model.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_ui.providers.dart';
import 'package:immich_mobile/providers/asset_viewer/asset_viewer.provider.dart';
import 'package:immich_mobile/routing/router.dart';

/// Opens the main timeline in search mode, filtered to [tag]. Gallery's search replaces upstream's search page, so a
/// tag tapped in the asset details lands there instead of on `SearchRoute`. Synchronous like `SimilarPhotosAction`:
/// search mode must be set before navigating, or the timeline opens unfiltered.
void openTagInPhotosFilter(BuildContext context, WidgetRef ref, Tag tag) {
  ref.invalidate(assetViewerProvider);
  ref.read(searchFieldControllerProvider).clear();
  ref.read(searchStateProvider.notifier)
    ..reset()
    ..toggleTag(SearchTagRef(id: tag.id, value: tag.value));
  ref.read(searchModeProvider.notifier).enter();
  unawaited(context.navigateTo(const MainTimelineRoute()));
}
