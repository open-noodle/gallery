import 'package:flutter/foundation.dart';
// The batch itself is fork-owned; this file keeps only the type and the two symbol names
// upstream's consumers read. See feature_message_gallery.model.dart.
import 'package:immich_mobile/domain/models/feature_message_gallery.model.dart';

class FeatureHighlight {
  /// Asset path of the feature screenshot, or null to show a placeholder.
  final String? image;
  final String titleKey;
  final String bodyKey;
  final List<TargetPlatform> platform;

  const FeatureHighlight({
    this.image,
    required this.titleKey,
    required this.bodyKey,
    this.platform = const [.iOS, .android],
  });

  bool get isVisibleOnCurrentPlatform => platform.contains(defaultTargetPlatform);
}

/// The release this batch of highlights was authored for.
///
/// Delegated to the fork-owned batch — see `feature_message_gallery.model.dart` for why the
/// content and the version live there and not here.
const featureMessageRelease = galleryFeatureMessageRelease;

/// Highlights relevant to the current platform.
List<FeatureHighlight> get visibleFeatureMessageHighlights =>
    featureMessageHighlights.where((h) => h.isVisibleOnCurrentPlatform).toList();

/// Delegated to the fork-owned batch — see `feature_message_gallery.model.dart`.
const List<FeatureHighlight> featureMessageHighlights = galleryFeatureMessageHighlights;
