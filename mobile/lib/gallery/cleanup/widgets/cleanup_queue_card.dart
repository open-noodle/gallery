import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck_card.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/utils/bytes_units.dart';
import 'package:openapi/api.dart';

// What a queue adds to a card (specs/2026-10-29-mobile-library-cleanup-design.md, "Queues: Blurry, Screenshots, Space
// hogs"; mockup `3-queues.html`): Blurry's reason badge and sharpness bar, a screenshot shown whole, Space hogs' size.

/// The sharpness at which a photo stops counting as blurry under every strictness (the server's strict threshold,
/// `CLEANUP_BLUR_THRESHOLDS.strict`): the bar is full from here.
const libraryCleanupSharpnessFull = 110.0;

/// Blurry's reason, as the web labels it (`QueueSelectGrid`), or null for none.
String? libraryCleanupReasonLabel(BuildContext context, CleanupAssetDto asset) {
  final reason = asset.reason.isPresent ? asset.reason.value : null;
  return switch (reason) {
    CleanupBlurReason.blurry => context.t.cleanup_reason_blurry,
    CleanupBlurReason.dark => context.t.cleanup_reason_dark,
    CleanupBlurReason.bright => context.t.cleanup_reason_bright,
    _ => null,
  };
}

IconData _reasonIcon(CleanupAssetDto asset) => switch (asset.reason.isPresent ? asset.reason.value : null) {
  CleanupBlurReason.dark => Icons.dark_mode_outlined,
  CleanupBlurReason.bright => Icons.wb_sunny_outlined,
  _ => Icons.blur_on_rounded,
};

/// The card's signal for [queue]: the full date with city and time, plus the queue's own badge and signal.
LibraryCleanupCardInfo libraryCleanupQueueCardInfo(
  BuildContext context,
  LibraryCleanupQueue queue,
  CleanupAssetDto asset,
) {
  final locale = Localizations.maybeLocaleOf(context)?.toLanguageTag() ?? 'en';
  final taken = DateTime.tryParse(asset.localDateTime);
  String format(DateFormat Function(String locale) pattern) {
    if (taken == null) {
      return '';
    }
    try {
      return pattern(locale).format(taken);
    } catch (_) {
      return pattern('en').format(taken);
    }
  }

  final width = asset.width;
  final height = asset.height;
  final detail = [
    ?asset.city,
    format(DateFormat.Hm),
    if (queue == LibraryCleanupQueue.screenshots && width != null && height != null) '$width×$height',
  ].where((part) => part.isNotEmpty).join(' · ');
  final reason = queue == LibraryCleanupQueue.blurry ? libraryCleanupReasonLabel(context, asset) : null;
  final sharpness = asset.sharpness.isPresent ? asset.sharpness.value : null;
  return LibraryCleanupCardInfo(
    headline: format(DateFormat.yMMMd),
    detail: detail.isEmpty ? null : detail,
    badge: reason == null
        ? null
        : LibraryCleanupSignalBadge(
            key: Key('cleanup-card-reason-${asset.id}'),
            icon: _reasonIcon(asset),
            label: reason,
          ),
    signal: switch (queue) {
      LibraryCleanupQueue.blurry when sharpness != null => LibraryCleanupSharpnessBar(
        key: Key('cleanup-card-sharpness-${asset.id}'),
        sharpness: sharpness,
      ),
      LibraryCleanupQueue.spaceHogs => Text(
        formatBytes(asset.fileSize.round()),
        key: Key('cleanup-card-size-${asset.id}'),
        style: const TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.w800, height: 1.1),
      ),
      _ => null,
    },
    whole: queue == LibraryCleanupQueue.screenshots,
  );
}

/// A small translucent pill in the card's corner ("◌ Blurry").
class LibraryCleanupSignalBadge extends StatelessWidget {
  const LibraryCleanupSignalBadge({super.key, required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
    decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.6), borderRadius: BorderRadius.circular(999)),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 13, color: Colors.white),
        const SizedBox(width: 4),
        Text(
          label,
          style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
        ),
      ],
    ),
  );
}

/// Blurry's sharpness bar: full at [libraryCleanupSharpnessFull], so the blurriest photos show the shortest bars.
class LibraryCleanupSharpnessBar extends StatelessWidget {
  const LibraryCleanupSharpnessBar({super.key, required this.sharpness});

  final double sharpness;

  /// How full the bar is, 0 to 1.
  double get fill => (sharpness / libraryCleanupSharpnessFull).clamp(0.0, 1.0);

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      ClipRRect(
        borderRadius: BorderRadius.circular(3),
        child: SizedBox(
          width: 120,
          height: 5,
          child: ColoredBox(
            color: Colors.white.withValues(alpha: 0.2),
            child: FractionallySizedBox(
              alignment: AlignmentDirectional.centerStart,
              widthFactor: fill,
              child: const ColoredBox(color: Color(0xFFFF9F43)),
            ),
          ),
        ),
      ),
      const SizedBox(width: 8),
      Text(context.t.cleanup_sharpness, style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 11)),
    ],
  );
}
