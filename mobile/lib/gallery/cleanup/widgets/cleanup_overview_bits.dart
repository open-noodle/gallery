import 'dart:async';

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_overview.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:intl/message_format.dart';
import 'package:openapi/api.dart';

String _locale(BuildContext context) => Localizations.maybeLocaleOf(context)?.toLanguageTag() ?? 'en';

/// A count with the locale's grouping ("1,204").
String libraryCleanupFormatCount(BuildContext context, int count) {
  try {
    return NumberFormat.decimalPattern(_locale(context)).format(count);
  } catch (_) {
    return '$count';
  }
}

/// A month-day as a date without a year ("15 August"), as the web's `monthDayLabel`. Leap year 2000, so 29 February is a
/// real date.
String libraryCleanupMonthDayLabel(BuildContext context, int monthDay) {
  final date = DateTime(2000, monthDay ~/ 100, monthDay % 100);
  try {
    return DateFormat.MMMMd(_locale(context)).format(date);
  } catch (_) {
    return DateFormat.MMMMd('en').format(date);
  }
}

String libraryCleanupQueueName(BuildContext context, LibraryCleanupQueue queue) => switch (queue) {
  LibraryCleanupQueue.spaceHogs => context.t.cleanup_queue_space_hogs,
  LibraryCleanupQueue.bursts => context.t.cleanup_queue_bursts,
  LibraryCleanupQueue.screenshots => context.t.cleanup_queue_screenshots,
  LibraryCleanupQueue.duplicates => context.t.cleanup_queue_duplicates,
  LibraryCleanupQueue.blurry => context.t.cleanup_queue_blurry,
  LibraryCleanupQueue.rewind => context.t.cleanup_rewind,
};

IconData libraryCleanupQueueIcon(LibraryCleanupQueue queue) => switch (queue) {
  LibraryCleanupQueue.spaceHogs => Icons.storage_rounded,
  LibraryCleanupQueue.bursts => Icons.burst_mode_outlined,
  LibraryCleanupQueue.screenshots => Icons.screenshot_outlined,
  LibraryCleanupQueue.duplicates => Icons.content_copy_outlined,
  LibraryCleanupQueue.blurry => Icons.blur_on_rounded,
  LibraryCleanupQueue.rewind => Icons.history_rounded,
};

/// A quick win's count in its queue's unit, as the web hub words it (`CleanupQuickWins.svelte`): files for Space
/// hogs, "up to" for Bursts (a series can end up kept whole), groups for Duplicates, and "so far" while quality
/// analysis is still running.
String libraryCleanupCountLabel(
  BuildContext context,
  LibraryCleanupQueue queue,
  LibraryCleanupQueueCount count,
  int shown,
) {
  // An int argument is formatted with the locale's grouping, as the web's `toLocaleString`.
  return switch (queue) {
    LibraryCleanupQueue.spaceHogs => context.t.cleanup_queue_count_files(count: shown),
    LibraryCleanupQueue.bursts => context.t.cleanup_up_to_count(count: shown),
    LibraryCleanupQueue.duplicates => context.t.cleanup_queue_count_groups(count: shown),
    _ =>
      count.isAnalysing
          ? context.t.cleanup_queue_count_so_far(count: shown)
          : libraryCleanupFormatCount(context, shown),
  };
}

/// A message whose arguments the generated accessor types wrongly: it guesses `int` from names such as `size` and
/// `year`, but the web passes a formatted size ("12.4 GiB") and a year without grouping ("2019", not "2,019"). Looks the
/// key up and formats it the way the accessor does.
String libraryCleanupMessage(BuildContext context, String key, Map<String, Object> args) {
  try {
    return MessageFormat(key.tr(context: context), locale: Intl.defaultLocale ?? 'en').format(args);
  } catch (_) {
    return key;
  }
}

/// A cleanup photo's thumbnail, from the server.
ImageProvider libraryCleanupThumbnail(CleanupAssetDto asset) =>
    RemoteImageProvider.thumbnail(assetId: asset.id, thumbhash: asset.thumbhash ?? '');

/// Counts [value] up from zero the first time it shows, then eases to later values (the web's `countMotion`). Reduced
/// motion: the figure at once.
class LibraryCleanupCountUp extends StatelessWidget {
  const LibraryCleanupCountUp({super.key, required this.value, required this.builder});

  final int value;
  final Widget Function(BuildContext context, int shown) builder;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: value.toDouble()),
      duration: GalleryMotion.reduced(context) ? Duration.zero : GalleryMotion.slow * 2,
      curve: GalleryMotion.settle,
      builder: (context, shown, _) => builder(context, shown.round()),
    );
  }
}

/// A placeholder in the shape of what is loading, with the timeline skeleton's slow sheen sweeping across
/// (`timeline_skeleton.dart`). Static under reduced motion. Never a spinner.
class LibraryCleanupSkeleton extends StatefulWidget {
  const LibraryCleanupSkeleton({super.key, this.width, required this.height, this.radius = 12, this.onImage = false});

  final double? width;
  final double height;
  final double radius;

  /// Drawn over a photo or a dark scrim: a translucent white instead of the surface colour.
  final bool onImage;

  @override
  State<LibraryCleanupSkeleton> createState() => _LibraryCleanupSkeletonState();
}

class _LibraryCleanupSkeletonState extends State<LibraryCleanupSkeleton> with SingleTickerProviderStateMixin {
  static const _sweep = Duration(milliseconds: 1600);
  late final AnimationController _sheen = AnimationController(vsync: this, duration: _sweep, value: 0.5);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (GalleryMotion.reduced(context)) {
      _sheen
        ..stop()
        ..value = 0.5;
    } else if (!_sheen.isAnimating) {
      unawaited(_sheen.repeat());
    }
  }

  @override
  void dispose() {
    _sheen.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final base = widget.onImage ? Colors.white.withValues(alpha: 0.22) : scheme.surfaceContainer;
    final shine = widget.onImage
        ? Colors.white.withValues(alpha: 0.34)
        : Color.lerp(base, scheme.onSurface, scheme.brightness == Brightness.dark ? 0.07 : 0.05)!;
    return AnimatedBuilder(
      animation: _sheen,
      builder: (context, _) {
        final x = -2.0 + _sheen.value * 4;
        return Container(
          width: widget.width,
          height: widget.height,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(widget.radius),
            gradient: LinearGradient(
              begin: Alignment(x - 1, -0.4),
              end: Alignment(x + 1, 0.4),
              colors: [base, shine, base],
            ),
          ),
        );
      },
    );
  }
}
