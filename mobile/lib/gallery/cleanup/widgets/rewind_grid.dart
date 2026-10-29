import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_session_state.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck_card.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_view_flight.dart';
import 'package:immich_mobile/gallery/motion/entrance.dart';
import 'package:immich_mobile/gallery/motion/gallery_tile.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/pop.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:openapi/api.dart';

// The rewind's Grid mode (specs/2026-10-29-mobile-library-cleanup-design.md, "Rewind" → "Grid mode"; mockup
// `5-grid-and-finish.html`): the day's photos in year sections, newest first, each headed "X years ago · city · N
// photos" with "Keep all remaining". A tap cycles a tile's mark none → keep → favourite → trash → none (the web grid's
// order); a long press opens the details sheet. Marks look as on web: keep and favourite a ring and a corner badge,
// trash a desaturated tile labelled "Trash".

const _columns = 3;
const _gap = 4.0;
const _tileRadius = 10.0;

/// The grid's tile radius, for the flight that lands in it.
const libraryCleanupGridTileRadius = _tileRadius;

/// One photo in a cleanup grid, with its mark. Shared by the rewind grid and the finish screen's "Review the N first".
class LibraryCleanupGridTile extends StatelessWidget {
  const LibraryCleanupGridTile({
    super.key,
    required this.asset,
    required this.mark,
    required this.onTap,
    this.onLongPress,
    this.hidden = false,
    this.photoKey,
  });

  final CleanupAssetDto asset;
  final LibraryCleanupMark? mark;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;

  /// While a flight lands here, the tile leaves its place empty.
  final bool hidden;

  /// On the photo, so a flight can find where it lands.
  final Key? photoKey;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final mark = this.mark;
    final image = Image(
      image: libraryCleanupThumbnail(asset),
      fit: BoxFit.cover,
      errorBuilder: (_, _, _) => ColoredBox(color: scheme.surfaceContainerHighest),
    );
    return Semantics(
      button: true,
      label: asset.originalFileName,
      selected: mark != null,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        onLongPress: onLongPress,
        child: Opacity(
          opacity: hidden ? 0 : 1,
          child: ClipRRect(
            key: photoKey,
            borderRadius: BorderRadius.circular(_tileRadius),
            child: Stack(
              fit: StackFit.expand,
              children: [
                ColoredBox(color: scheme.surfaceContainerHighest),
                // Findable by its id, so photos applied from the grid (the close prompt's Apply) fly out of it.
                GalleryTile(
                  remoteId: asset.id,
                  child: mark == LibraryCleanupMark.trash
                      ? ColorFiltered(colorFilter: libraryCleanupGreyscale, child: image)
                      : image,
                ),
                if (asset.type == AssetTypeEnum.VIDEO)
                  const Positioned(
                    left: 4,
                    bottom: 4,
                    child: Icon(Icons.play_circle_fill_rounded, size: 18, color: Colors.white),
                  ),
                LibraryCleanupMarkLayer(id: asset.id, mark: mark, radius: _tileRadius),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The greyscale a photo marked for trash shows in every grid.
const libraryCleanupGreyscale = ColorFilter.matrix([
  0.33, 0.33, 0.33, 0, 0, //
  0.33, 0.33, 0.33, 0, 0,
  0.33, 0.33, 0.33, 0, 0,
  0, 0, 0, 1, 0,
]);

/// A tile's mark, the same in every cleanup grid (the rewind's, a queue's, "Review the N first"): keep and favourite a
/// ring plus a corner badge, trash a red wash labelled "Trash" over the greyed photo (which the tile draws). The mark
/// fades in and its badge pops; under reduced motion both are there at once.
class LibraryCleanupMarkLayer extends StatelessWidget {
  const LibraryCleanupMarkLayer({
    super.key,
    required this.id,
    required this.mark,
    required this.radius,
    this.badgeAlignment = AlignmentDirectional.topEnd,
  });

  final String id;
  final LibraryCleanupMark? mark;
  final double radius;

  /// Where the keep / favourite badge sits: top end in the rewind, bottom start in a queue (whose top end holds the
  /// selection check).
  final AlignmentDirectional badgeAlignment;

  @override
  Widget build(BuildContext context) {
    final mark = this.mark;
    final duration = GalleryMotion.reduced(context) ? Duration.zero : GalleryMotion.quick;
    return Stack(
      fit: StackFit.expand,
      children: [
        AnimatedSwitcher(
          duration: duration,
          child: KeyedSubtree(
            key: ValueKey(mark),
            child: switch (mark) {
              null => const SizedBox.expand(),
              LibraryCleanupMark.trash => ColoredBox(
                key: Key('cleanup-grid-mark-$id-trash'),
                color: libraryCleanupTrashColor.withValues(alpha: 0.35),
                child: Center(
                  child: Text(
                    context.t.trash.toUpperCase(),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.8,
                    ),
                  ),
                ),
              ),
              _ => DecoratedBox(
                key: Key('cleanup-grid-mark-$id-${mark.name}'),
                decoration: BoxDecoration(
                  border: Border.all(color: libraryCleanupMarkColor(mark), width: 3),
                  borderRadius: BorderRadius.circular(radius),
                ),
              ),
            },
          ),
        ),
        Align(
          alignment: badgeAlignment,
          child: Padding(
            padding: const EdgeInsets.all(5),
            child: GalleryPop(
              trigger: mark,
              child: mark == LibraryCleanupMark.keep || mark == LibraryCleanupMark.favorite
                  ? Container(
                      key: Key('cleanup-grid-badge-$id'),
                      width: 22,
                      height: 22,
                      decoration: BoxDecoration(color: libraryCleanupMarkColor(mark!), shape: BoxShape.circle),
                      child: Icon(
                        mark == LibraryCleanupMark.keep ? Icons.check_rounded : Icons.favorite_rounded,
                        size: 14,
                        color: Colors.white,
                      ),
                    )
                  : const SizedBox.shrink(),
            ),
          ),
        ),
      ],
    );
  }
}

/// The rewind grid. Its state can say where a tile is ([tileRect]) and bring one into view ([reveal]), for the flight
/// between the deck's card and its tile.
class LibraryCleanupRewindGrid extends StatefulWidget {
  const LibraryCleanupRewindGrid({
    super.key,
    required this.years,
    required this.marks,
    required this.nowYear,
    required this.onCycle,
    required this.onKeepTheRest,
    required this.onDetails,
    this.hiddenId,
    this.showHint = false,
    this.entrance = false,
  });

  final List<LibraryCleanupRewindYear> years;
  final Map<String, LibraryCleanupMark> marks;

  /// This year, for "X years ago".
  final int nowYear;
  final ValueChanged<String> onCycle;

  /// "Keep all remaining" on one year: every untouched photo of it as keep.
  final ValueChanged<int> onKeepTheRest;
  final ValueChanged<CleanupAssetDto> onDetails;

  /// The tile a flight is landing in, kept empty until it lands.
  final String? hiddenId;

  /// The one-time "Hold a photo for details" hint.
  final bool showHint;

  /// The other tiles fade and settle in on a short stagger (switching from the deck).
  final bool entrance;

  @override
  State<LibraryCleanupRewindGrid> createState() => LibraryCleanupRewindGridState();
}

class LibraryCleanupRewindGridState extends State<LibraryCleanupRewindGrid> implements LibraryCleanupFlightGrid {
  final _scroll = ScrollController();
  final _photoKeys = <String, GlobalKey>{};

  GlobalKey _keyFor(String id) => _photoKeys.putIfAbsent(id, GlobalKey.new);

  @override
  Rect? tileRect(String id) {
    final box = _photoKeys[id]?.currentContext?.findRenderObject();
    if (box is! RenderBox || !box.hasSize) {
      return null;
    }
    return box.localToGlobal(Offset.zero) & box.size;
  }

  @override
  void reveal(String id) {
    final context = _photoKeys[id]?.currentContext;
    if (context != null) {
      Scrollable.ensureVisible(context, alignment: 0.5);
    }
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final reduced = GalleryMotion.reduced(context);
    var index = 0;
    return SingleChildScrollView(
      key: const Key('cleanup-grid'),
      controller: _scroll,
      padding: EdgeInsets.fromLTRB(10, 4, 10, 24 + MediaQuery.paddingOf(context).bottom),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.showHint)
            Container(
              key: const Key('cleanup-grid-hint'),
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: theme.colorScheme.secondaryContainer,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Icon(Icons.touch_app_outlined, size: 18, color: theme.colorScheme.onSecondaryContainer),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      context.t.cleanup_grid_hold_hint,
                      style: TextStyle(color: theme.colorScheme.onSecondaryContainer),
                    ),
                  ),
                ],
              ),
            ),
          for (final year in widget.years)
            if (year.assets.isNotEmpty)
              _YearSection(
                year: year,
                marks: widget.marks,
                yearsAgo: math.max(widget.nowYear - year.year, 0),
                onKeepTheRest: () => widget.onKeepTheRest(year.year),
                tiles: [
                  for (final asset in year.assets)
                    GalleryEntrance(
                      delay: Duration(milliseconds: 18 * math.min(index++, 14)),
                      enabled: widget.entrance && !reduced,
                      child: LibraryCleanupGridTile(
                        key: Key('cleanup-grid-tile-${asset.id}'),
                        photoKey: _keyFor(asset.id),
                        asset: asset,
                        mark: widget.marks[asset.id],
                        hidden: widget.hiddenId == asset.id,
                        onTap: () => widget.onCycle(asset.id),
                        onLongPress: () => widget.onDetails(asset),
                      ),
                    ),
                ],
              ),
        ],
      ),
    );
  }
}

class _YearSection extends StatelessWidget {
  const _YearSection({
    required this.year,
    required this.marks,
    required this.yearsAgo,
    required this.onKeepTheRest,
    required this.tiles,
  });

  final LibraryCleanupRewindYear year;
  final Map<String, LibraryCleanupMark> marks;
  final int yearsAgo;
  final VoidCallback onKeepTheRest;
  final List<Widget> tiles;

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final theme = Theme.of(context);
    final city = year.assets.map((asset) => asset.city?.trim()).nonNulls.where((city) => city.isNotEmpty).firstOrNull;
    final remaining = year.assets.where((asset) => !marks.containsKey(asset.id)).length;
    final meta = [t.cleanup_years_ago(count: yearsAgo), ?city, t.cleanup_photo_count(count: year.count)].join(' · ');
    return Padding(
      key: Key('cleanup-grid-year-${year.year}'),
      padding: const EdgeInsets.only(top: 10, bottom: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${year.year}', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                    Text(
                      meta,
                      key: Key('cleanup-grid-year-meta-${year.year}'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              if (remaining > 0)
                TextButton.icon(
                  key: Key('cleanup-grid-keep-rest-${year.year}'),
                  style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                  onPressed: onKeepTheRest,
                  icon: const Icon(Icons.check_rounded, size: 16),
                  label: Text(t.cleanup_keep_all_remaining),
                )
              else
                GalleryPop(
                  onMount: true,
                  child: Container(
                    key: Key('cleanup-grid-year-reviewed-${year.year}'),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: libraryCleanupKeepColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      t.cleanup_year_reviewed,
                      style: const TextStyle(color: libraryCleanupKeepColor, fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          GridView.count(
            crossAxisCount: _columns,
            crossAxisSpacing: _gap,
            mainAxisSpacing: _gap,
            shrinkWrap: true,
            padding: EdgeInsets.zero,
            physics: const NeverScrollableScrollPhysics(),
            children: tiles,
          ),
        ],
      ),
    );
  }
}

/// The grid's loading state: tiles in their real place, with the sheen.
class LibraryCleanupGridSkeleton extends StatelessWidget {
  const LibraryCleanupGridSkeleton({super.key});

  @override
  Widget build(BuildContext context) => GridView.count(
    key: const Key('cleanup-grid-skeleton'),
    padding: const EdgeInsets.fromLTRB(10, 40, 10, 10),
    crossAxisCount: _columns,
    crossAxisSpacing: _gap,
    mainAxisSpacing: _gap,
    physics: const NeverScrollableScrollPhysics(),
    children: [for (var i = 0; i < 12; i++) const LibraryCleanupSkeleton(height: double.infinity, radius: _tileRadius)],
  );
}
