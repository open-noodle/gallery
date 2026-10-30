import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_overview.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_overview.providers.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/gallery/motion/pop.dart';
import 'package:immich_mobile/gallery/motion/pressable.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/utils/bytes_units.dart';

/// The quick wins: one card per queue in the web's order, scrolling sideways, and the trash line under them when the
/// server's trash is on (the web's `CleanupQuickWins`).
class LibraryCleanupQuickWins extends ConsumerWidget {
  const LibraryCleanupQuickWins({super.key, required this.trashEnabled, required this.onOpen});

  static const cardWidth = 128.0;
  static const cardHeight = 136.0;

  final bool trashEnabled;
  final void Function(LibraryCleanupQueue queue) onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final counts = {
      for (final queue in libraryCleanupQuickWins)
        queue:
            ref.watch(libraryCleanupQueueCountProvider(queue)).valueOrNull ?? const LibraryCleanupQueueCount.loading(),
    };
    final shown = [
      for (final queue in libraryCleanupQuickWins)
        if (!counts[queue]!.hidden) queue,
    ];
    return Column(
      key: const Key('cleanup-quick-wins'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Text(context.t.cleanup_quick_wins, style: Theme.of(context).textTheme.titleSmall),
        ),
        const SizedBox(height: 8),
        // Five cards at most: built at once, so every count and cover loads with the overview, not on scroll.
        SingleChildScrollView(
          key: const Key('cleanup-quick-wins-row'),
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            children: [
              for (final (index, queue) in shown.indexed) ...[
                if (index > 0) const SizedBox(width: 10),
                _QuickWinCard(key: ValueKey(queue), queue: queue, count: counts[queue]!, onTap: () => onOpen(queue)),
              ],
            ],
          ),
        ),
        if (trashEnabled) const _TrashLine(),
      ],
    );
  }
}

class _QuickWinCard extends ConsumerWidget {
  const _QuickWinCard({super.key, required this.queue, required this.count, required this.onTap});

  final LibraryCleanupQueue queue;
  final LibraryCleanupQueueCount count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final value = count.value;
    final wantsCover = libraryCleanupCoverQueues.contains(queue) && value != null && value.count > 0;
    final cover = wantsCover ? ref.watch(libraryCleanupQueueCoverProvider(queue)).valueOrNull : null;
    const white = Colors.white;

    final visual = cover != null
        ? Image(
            key: Key('cleanup-cover-${queue.slug}'),
            image: libraryCleanupThumbnail(cover),
            fit: BoxFit.cover,
            gaplessPlayback: true,
            errorBuilder: (_, _, _) => _IconTile(queue: queue),
          )
        : _IconTile(queue: queue);

    return GalleryPressable(
      pressedScale: 0.94,
      pressDelay: GalleryPressable.scrollingDelay,
      child: Semantics(
        button: true,
        child: GestureDetector(
          key: Key('cleanup-quick-win-${queue.slug}'),
          behavior: HitTestBehavior.opaque,
          onTap: onTap,
          child: Opacity(
            opacity: count.isClear ? 0.7 : 1,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: SizedBox(
                width: LibraryCleanupQuickWins.cardWidth,
                height: LibraryCleanupQuickWins.cardHeight,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    ColoredBox(color: scheme.surfaceContainerHighest),
                    // The cover flies into the queue's first card (Slices 6 and 7).
                    Hero(tag: LibraryCleanupHeroTags.queue(queue), child: visual),
                    const DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          stops: [0.3, 1],
                          colors: [Color(0x00000000), Color(0xD9000000)],
                        ),
                      ),
                    ),
                    Positioned(
                      left: 10,
                      right: 10,
                      bottom: 10,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            libraryCleanupQueueName(context, queue),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: white, fontSize: 13, fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(height: 2),
                          SizedBox(
                            height: 16,
                            child: _CountLine(queue: queue, count: count),
                          ),
                          // Reserved, so a card that is analysing lines up with the others.
                          SizedBox(
                            height: 14,
                            child: count.isAnalysing && !count.isClear
                                ? Text(
                                    context.t.cleanup_analysing_percent(percent: count.analysedPercent!.round()),
                                    key: Key('cleanup-analysing-${queue.slug}'),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(color: Color(0xFFFDE047), fontSize: 10),
                                  )
                                : null,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _IconTile extends StatelessWidget {
  const _IconTile({required this.queue});

  final LibraryCleanupQueue queue;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ColoredBox(
      key: Key('cleanup-icon-${queue.slug}'),
      color: Color.alphaBlend(scheme.primary.withValues(alpha: 0.18), scheme.surfaceContainerHighest),
      child: Align(
        alignment: const Alignment(0, -0.35),
        child: Icon(libraryCleanupQueueIcon(queue), size: 38, color: scheme.primary.withValues(alpha: 0.8)),
      ),
    );
  }
}

class _CountLine extends StatelessWidget {
  const _CountLine({required this.queue, required this.count});

  final LibraryCleanupQueue queue;
  final LibraryCleanupQueueCount count;

  @override
  Widget build(BuildContext context) {
    final value = count.value;
    if (count.isLoading) {
      return const Align(
        alignment: AlignmentDirectional.centerStart,
        child: LibraryCleanupSkeleton(width: 64, height: 10, radius: 4, onImage: true),
      );
    }
    if (value == null) {
      return const SizedBox.shrink();
    }
    const style = TextStyle(color: Color(0xD9FFFFFF), fontSize: 11, fontFeatures: [FontFeature.tabularFigures()]);
    if (count.isClear) {
      return Row(
        key: Key('cleanup-clear-${queue.slug}'),
        children: [
          const GalleryPop(onMount: true, child: Icon(Icons.check_circle_rounded, size: 13, color: Color(0xD9FFFFFF))),
          const SizedBox(width: 4),
          Flexible(
            child: Text(context.t.cleanup_all_clear, maxLines: 1, overflow: TextOverflow.ellipsis, style: style),
          ),
        ],
      );
    }
    return LibraryCleanupCountUp(
      value: value.count,
      builder: (context, shown) => LibraryCleanupCountUp(
        value: value.bytes.round(),
        builder: (context, bytes) => Text.rich(
          TextSpan(
            children: [
              TextSpan(text: libraryCleanupCountLabel(context, queue, count, shown)),
              if (value.bytes > 0)
                TextSpan(
                  text: ' · −${formatBytes(bytes)}',
                  style: const TextStyle(color: Color(0xFF86EFAC), fontWeight: FontWeight.w600),
                ),
            ],
          ),
          key: Key('cleanup-count-${queue.slug}'),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: style,
        ),
      ),
    );
  }
}

/// "Trash: 1.2 GiB" and "Empty trash", under the quick wins. Empty trash asks first, as the Trash page does.
class _TrashLine extends ConsumerWidget {
  const _TrashLine();

  Future<void> _empty(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.t.empty_trash),
        content: Text(context.t.empty_trash_confirmation),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text(context.t.cancel)),
          TextButton(
            key: const Key('cleanup-empty-trash-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(context.t.empty_trash, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      return;
    }
    await ref.read(libraryCleanupEmptyTrashProvider)();
    ref.invalidate(libraryCleanupTrashTotalsProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trash = ref.watch(libraryCleanupTrashTotalsProvider).valueOrNull;
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      key: const Key('cleanup-trash-line'),
      padding: const EdgeInsets.only(left: 16, right: 8, top: 4),
      child: Row(
        children: [
          Icon(Icons.delete_outline_rounded, size: 16, color: scheme.onSurfaceVariant),
          const SizedBox(width: 6),
          Expanded(
            child: trash == null
                ? const Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: LibraryCleanupSkeleton(width: 90, height: 10, radius: 4),
                  )
                : Text(
                    libraryCleanupMessage(context, 'cleanup_trash_holds', {'size': formatBytes(trash.bytes.round())}),
                    key: const Key('cleanup-trash-size'),
                    style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
                  ),
          ),
          TextButton(
            key: const Key('cleanup-empty-trash'),
            onPressed: trash == null || trash.count == 0 ? null : () => _empty(context, ref),
            style: TextButton.styleFrom(foregroundColor: scheme.error),
            child: Text(context.t.empty_trash),
          ),
        ],
      ),
    );
  }
}
