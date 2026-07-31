import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/actions/action.dart';
import 'package:immich_mobile/providers/asset_viewer/asset_viewer.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/routing/router.dart';

class SimilarPhotosAction extends ActionBuilder {
  final String assetId;

  const SimilarPhotosAction({required this.assetId});

  @override
  ActionItem? create(BuildContext context, WidgetRef ref) =>
      .new(icon: Icons.compare, label: context.t.view_similar_photos, onAction: () => _showSimilar(context, ref));

  // Synchronous: the filter must be set BEFORE navigating, or the timeline
  // opens unfiltered.
  void _showSimilar(BuildContext context, WidgetRef ref) {
    ref.invalidate(assetViewerProvider);
    ref.read(photosFilterProvider.notifier).setSimilarTo(assetId);
    unawaited(context.navigateTo(const MainTimelineRoute()));
  }
}
