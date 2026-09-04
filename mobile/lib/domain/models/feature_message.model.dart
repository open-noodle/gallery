import 'package:flutter/foundation.dart';
// The batch itself is fork-owned; this file keeps only the type and the two symbol names
// upstream's consumers read. See feature_message_gallery.model.dart.
import 'package:immich_mobile/domain/models/feature_message_gallery.model.dart';
import 'package:immich_mobile/generated/translations.g.dart';

enum FeatureHighlight {
  shareQuality(image: 'assets/feature_message/share_quality.webp'),
  slideshow(image: 'assets/feature_message/slideshow.webp'),
  recentlyAdded(image: 'assets/feature_message/recently_added.webp'),
  ocr(image: 'assets/feature_message/ocr.webp'),
  openInImmich(image: 'assets/feature_message/open_in_immich.webp', platform: [.android]),
  uploadToAlbum(),
  // gallery-fork (#931): the Spaces-in-nav card. Upstream's members above are kept as the
  // catalogue/type; the BATCH that actually renders is galleryFeatureMessageHighlights.
  spacesInNav(image: 'assets/feature_message/spaces_in_nav.webp');

  /// Asset path of the feature screenshot, or null to show a placeholder.
  final String? image;
  final List<TargetPlatform> platform;

  const FeatureHighlight({this.image, this.platform = const [.iOS, .android]});

  bool get isVisibleOnCurrentPlatform => platform.contains(defaultTargetPlatform);

  String title(Translations t) => switch (this) {
    FeatureHighlight.shareQuality => t.share_quality_title,
    FeatureHighlight.slideshow => t.slideshow_title,
    FeatureHighlight.recentlyAdded => t.recently_added_title,
    FeatureHighlight.ocr => t.ocr_title,
    FeatureHighlight.openInImmich => t.open_in_immich_title,
    FeatureHighlight.uploadToAlbum => t.upload_to_album_title,
    FeatureHighlight.spacesInNav => t.spaces_in_nav_title,
  };

  String body(Translations t) => switch (this) {
    FeatureHighlight.shareQuality => t.share_quality_body,
    FeatureHighlight.slideshow => t.slideshow_body,
    FeatureHighlight.recentlyAdded => t.recently_added_body,
    FeatureHighlight.ocr => t.ocr_body,
    FeatureHighlight.openInImmich => t.open_in_immich_body,
    FeatureHighlight.uploadToAlbum => t.upload_to_album_body,
    FeatureHighlight.spacesInNav => t.spaces_in_nav_body,
  };
}

/// The release this batch of highlights was authored for.
///
/// Delegated to the fork-owned batch — see `feature_message_gallery.model.dart` for why the
/// content and the version live there and not here.
const featureMessageRelease = galleryFeatureMessageRelease;

/// Highlights relevant to the current platform.
List<FeatureHighlight> get visibleFeatureMessageHighlights =>
    galleryFeatureMessageHighlights.where((h) => h.isVisibleOnCurrentPlatform).toList();
