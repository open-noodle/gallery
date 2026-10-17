import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/tag.model.dart';
import 'package:immich_mobile/providers/asset_viewer/asset_viewer.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/routing/router.dart';

/// Opens the main timeline filtered to [tag]. Gallery's photos filter replaces upstream's search page, so a tag
/// tapped in the asset details lands there instead of on `SearchRoute`. Synchronous like `SimilarPhotosAction`:
/// the filter must be set before navigating, or the timeline opens unfiltered.
void openTagInPhotosFilter(BuildContext context, WidgetRef ref, Tag tag) {
  ref.invalidate(assetViewerProvider);
  ref.read(photosFilterProvider.notifier).showTag(tag);
  unawaited(context.navigateTo(const MainTimelineRoute()));
}
