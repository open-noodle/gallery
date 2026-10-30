import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck_card.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_queue_card.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_view_flight.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/rewind_grid.dart';
import 'package:immich_mobile/gallery/motion/entrance.dart';
import 'package:immich_mobile/gallery/motion/gallery_tile.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/utils/bytes_units.dart';
import 'package:openapi/api.dart';

// A queue's Grid mode (specs/2026-10-29-mobile-library-cleanup-design.md, "Queues: Blurry, Screenshots, Space hogs";
// mockup `5-grid-and-finish.html`, left): many photos at once. Tap selects, a sideways drag selects a run, Select all
// takes what is loaded, and the floating bar marks the selection. Marks stay local, as in the deck.

const _columns = 3;
const _spacing = 4.0;
const _padding = EdgeInsets.fromLTRB(10, 4, 10, 120);
const _tileRadius = libraryCleanupGridTileRadius;

/// Asks for the next page when the grid is scrolled this close to its end.
const _nearEnd = 600.0;

class LibraryCleanupQueueGrid extends StatefulWidget {
  const LibraryCleanupQueueGrid({
    super.key,
    required this.queue,
    required this.assets,
    required this.marks,
    required this.onMark,
    this.onDetails,
    this.onNearEnd,
    this.showHint = false,
    this.hiddenId,
    this.entrance = false,
  });

  final LibraryCleanupQueue queue;

  /// Every photo loaded so far, marked or not.
  final List<CleanupAssetDto> assets;
  final Map<String, LibraryCleanupMark> marks;

  /// Marks the selection (in grid order), as one undo step.
  final void Function(List<String> ids, LibraryCleanupMark mark) onMark;

  /// A long press on a tile: the details sheet.
  final ValueChanged<CleanupAssetDto>? onDetails;
  final VoidCallback? onNearEnd;

  /// The one-time "Hold a photo for details" hint (one flag for every grid, seen once it shows).
  final bool showHint;

  /// The tile a flight from the deck is landing in, kept empty until it lands.
  final String? hiddenId;

  /// The other tiles fade and settle in on a short stagger (switching from the deck).
  final bool entrance;

  @override
  State<LibraryCleanupQueueGrid> createState() => LibraryCleanupQueueGridState();
}

/// Its state says where a tile is and brings one into view, for the flight between the deck's card and its tile.
class LibraryCleanupQueueGridState extends State<LibraryCleanupQueueGrid> implements LibraryCleanupFlightGrid {
  final _scroll = ScrollController();
  final Set<String> _selected = {};

  // A drag across tiles: where it started, whether it selects or clears, and the selection before it.
  int? _runStart;
  bool _runSelects = true;
  Set<String> _runBase = const {};

  /// The grid's width at its last layout, to find a tile that is not built yet.
  double _width = 0;

  bool get _screenshots => widget.queue == LibraryCleanupQueue.screenshots;

  double get _tileHeight => (_width - _padding.horizontal - _spacing * (_columns - 1)) / _columns / _tileAspect;

  @override
  Rect? tileRect(String id) => libraryCleanupRectOf(context, {Key('cleanup-grid-photo-$id')});

  @override
  void reveal(String id) {
    final index = widget.assets.indexWhere((asset) => asset.id == id);
    if (index < 0 || !_scroll.hasClients || _width <= 0) {
      return;
    }
    // Lazily built, so the row is found by arithmetic and scrolled to the middle of the view.
    final position = _scroll.position;
    final rowTop = _padding.top + (index ~/ _columns) * (_tileHeight + _spacing);
    final target = rowTop - (position.viewportDimension - _tileHeight) / 2;
    position.jumpTo(target.clamp(position.minScrollExtent, position.maxScrollExtent));
  }

  /// Screenshots keep their tall shape; the others are square.
  double get _tileAspect => _screenshots ? 9 / 19.5 : 1;

  @override
  void didUpdateWidget(LibraryCleanupQueueGrid oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Photos that left (applied, or another filter) leave the selection too.
    final present = widget.assets.map((asset) => asset.id).toSet();
    _selected.removeWhere((id) => !present.contains(id));
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  List<String> _inGridOrder(Set<String> ids) => [
    for (final asset in widget.assets)
      if (ids.contains(asset.id)) asset.id,
  ];

  void _toggle(String id) => setState(() => _selected.contains(id) ? _selected.remove(id) : _selected.add(id));

  bool get _allSelected => widget.assets.isNotEmpty && widget.assets.every((asset) => _selected.contains(asset.id));

  void _selectAll() => setState(() {
    if (_allSelected) {
      _selected.clear();
    } else {
      _selected.addAll(widget.assets.map((asset) => asset.id));
    }
  });

  void _mark(LibraryCleanupMark mark) {
    final ids = _inGridOrder(_selected);
    if (ids.isEmpty) {
      return;
    }
    setState(_selected.clear);
    widget.onMark(ids, mark);
  }

  /// The tile under [local] (a position in the grid's viewport), or null between and past tiles.
  int? _indexAt(Offset local, double width) {
    final tileWidth = (width - _padding.horizontal - _spacing * (_columns - 1)) / _columns;
    final tileHeight = tileWidth / _tileAspect;
    final x = local.dx - _padding.left;
    final y = local.dy + (_scroll.hasClients ? _scroll.offset : 0) - _padding.top;
    if (x < 0 || y < 0) {
      return null;
    }
    final column = math.min(x ~/ (tileWidth + _spacing), _columns - 1);
    final index = (y ~/ (tileHeight + _spacing)) * _columns + column;
    return index < widget.assets.length ? index : null;
  }

  void _runFrom(Offset local, double width) {
    final index = _indexAt(local, width);
    if (index == null) {
      _runStart = null;
      return;
    }
    _runStart = index;
    _runSelects = !_selected.contains(widget.assets[index].id);
    _runBase = Set.of(_selected);
    _runTo(local, width);
  }

  void _runTo(Offset local, double width) {
    final start = _runStart;
    final index = _indexAt(local, width);
    if (start == null || index == null) {
      return;
    }
    final run = widget.assets.sublist(math.min(start, index), math.max(start, index) + 1).map((asset) => asset.id);
    setState(() {
      _selected
        ..clear()
        ..addAll(_runBase);
      if (_runSelects) {
        _selected.addAll(run);
      } else {
        _selected.removeAll(run);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final scheme = Theme.of(context).colorScheme;
    final selectedBytes = widget.assets
        .where((asset) => _selected.contains(asset.id))
        .fold(0, (sum, asset) => sum + asset.fileSize.round());
    return Stack(
      key: const Key('cleanup-grid'),
      children: [
        Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 4, 0),
              child: Row(
                children: [
                  Expanded(
                    child: widget.showHint
                        ? Text(
                            t.cleanup_grid_hold_hint,
                            key: const Key('cleanup-grid-hint'),
                            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                          )
                        : const SizedBox.shrink(),
                  ),
                  TextButton(
                    key: const Key('cleanup-grid-select-all'),
                    onPressed: widget.assets.isEmpty ? null : _selectAll,
                    child: Text(_allSelected ? t.deselect_all : t.select_all),
                  ),
                ],
              ),
            ),
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  _width = constraints.maxWidth;
                  return NotificationListener<ScrollNotification>(
                    onNotification: (notification) {
                      if (notification.metrics.extentAfter < _nearEnd) {
                        widget.onNearEnd?.call();
                      }
                      return false;
                    },
                    // A sideways drag selects a run; an up or down drag still scrolls.
                    child: GestureDetector(
                      onHorizontalDragStart: (details) => _runFrom(details.localPosition, constraints.maxWidth),
                      onHorizontalDragUpdate: (details) => _runTo(details.localPosition, constraints.maxWidth),
                      onHorizontalDragEnd: (_) => _runStart = null,
                      child: GridView.builder(
                        key: const Key('cleanup-grid-scroll'),
                        controller: _scroll,
                        padding: _padding,
                        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: _columns,
                          crossAxisSpacing: _spacing,
                          mainAxisSpacing: _spacing,
                          childAspectRatio: _tileAspect,
                        ),
                        itemCount: widget.assets.length,
                        itemBuilder: (context, index) {
                          final asset = widget.assets[index];
                          return GalleryEntrance(
                            delay: Duration(milliseconds: 18 * math.min(index, 14)),
                            enabled: widget.entrance && !GalleryMotion.reduced(context),
                            child: _Tile(
                              key: Key('cleanup-grid-tile-${asset.id}'),
                              asset: asset,
                              queue: widget.queue,
                              mark: widget.marks[asset.id],
                              selected: _selected.contains(asset.id),
                              hidden: widget.hiddenId == asset.id,
                              onTap: () => _toggle(asset.id),
                              onLongPress: widget.onDetails == null ? null : () => widget.onDetails!(asset),
                            ),
                          );
                        },
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
        Positioned(
          left: 10,
          right: 10,
          bottom: 16 + MediaQuery.paddingOf(context).bottom,
          child: AnimatedSwitcher(
            duration: GalleryMotion.reduced(context) ? Duration.zero : GalleryMotion.quick,
            transitionBuilder: (child, animation) => FadeTransition(
              opacity: animation,
              child: SlideTransition(
                position: Tween(begin: const Offset(0, 0.4), end: Offset.zero).animate(animation),
                child: child,
              ),
            ),
            child: _selected.isEmpty
                ? const SizedBox.shrink()
                : _SelectionBar(count: _selected.length, bytes: selectedBytes, onMark: _mark),
          ),
        ),
      ],
    );
  }
}

/// "6 selected · 4.8 MB" with Keep, ♥ and "Trash 6".
class _SelectionBar extends StatelessWidget {
  const _SelectionBar({required this.count, required this.bytes, required this.onMark});

  final int count;
  final int bytes;
  final ValueChanged<LibraryCleanupMark> onMark;

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final scheme = Theme.of(context).colorScheme;
    return Material(
      key: const Key('cleanup-grid-bar'),
      color: scheme.surfaceContainerHigh.withValues(alpha: 0.94),
      elevation: 6,
      borderRadius: BorderRadius.circular(18),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 8, 8, 8),
        child: Row(
          children: [
            Expanded(
              flex: 2,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    t.selected_count(count: count),
                    key: const Key('cleanup-grid-selected-count'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  Text(
                    formatBytes(bytes),
                    key: const Key('cleanup-grid-selected-size'),
                    maxLines: 1,
                    style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            // Long labels (a large count, a long translation) shrink the buttons rather than wrap the bar.
            Flexible(
              flex: 3,
              child: FittedBox(
                fit: BoxFit.scaleDown,
                alignment: AlignmentDirectional.centerEnd,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    OutlinedButton(
                      key: const Key('cleanup-grid-keep'),
                      onPressed: () => onMark(LibraryCleanupMark.keep),
                      child: Text(t.keep),
                    ),
                    IconButton(
                      key: const Key('cleanup-grid-favorite'),
                      tooltip: t.favorite,
                      onPressed: () => onMark(LibraryCleanupMark.favorite),
                      icon: const Icon(Icons.favorite_rounded, color: libraryCleanupFavoriteColor),
                    ),
                    FilledButton(
                      key: const Key('cleanup-grid-trash'),
                      style: FilledButton.styleFrom(
                        backgroundColor: libraryCleanupTrashColor,
                        foregroundColor: Colors.white,
                      ),
                      onPressed: () => onMark(LibraryCleanupMark.trash),
                      child: Text(t.cleanup_trash_selected(count: count)),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One photo: selected shows an outline and a check; keep and favourite a ring and a corner badge; trash a desaturated
/// tile with "Trash", as the rewind grid shows its marks.
class _Tile extends StatelessWidget {
  const _Tile({
    super.key,
    required this.asset,
    required this.queue,
    required this.mark,
    required this.selected,
    required this.onTap,
    required this.onLongPress,
    this.hidden = false,
  });

  final CleanupAssetDto asset;
  final LibraryCleanupQueue queue;
  final LibraryCleanupMark? mark;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;

  /// While a flight lands here, the tile leaves its place empty.
  final bool hidden;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final mark = this.mark;
    Widget image = Image(
      image: libraryCleanupThumbnail(asset),
      fit: BoxFit.cover,
      width: double.infinity,
      height: double.infinity,
      gaplessPlayback: true,
      errorBuilder: (_, _, _) => ColoredBox(color: scheme.surfaceContainerHighest),
    );
    if (queue == LibraryCleanupQueue.screenshots) {
      // Whole, at the screenshot's own shape.
      image = ColoredBox(
        key: Key('cleanup-grid-whole-${asset.id}'),
        color: libraryCleanupWholeBackground,
        child: Center(
          child: AspectRatio(aspectRatio: libraryCleanupAspectRatio(asset), child: image),
        ),
      );
    }
    if (mark == LibraryCleanupMark.trash) {
      image = ColorFiltered(colorFilter: libraryCleanupGreyscale, child: image);
    }
    final reason = queue == LibraryCleanupQueue.blurry ? libraryCleanupReasonLabel(context, asset) : null;
    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Opacity(
        opacity: hidden ? 0 : 1,
        child: ClipRRect(
          key: Key('cleanup-grid-photo-${asset.id}'),
          borderRadius: BorderRadius.circular(_tileRadius),
          child: Stack(
            fit: StackFit.expand,
            children: [
              // Findable by its id, so photos applied from the grid (the close prompt's Apply) fly out of it.
              GalleryTile(remoteId: asset.id, child: image),
              if (reason != null)
                Positioned(
                  top: 4,
                  left: 4,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.55),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(reason, style: const TextStyle(color: Colors.white, fontSize: 10)),
                  ),
                ),
              if (queue == LibraryCleanupQueue.spaceHogs)
                Positioned(
                  right: 4,
                  bottom: 4,
                  child: Text(
                    formatBytes(asset.fileSize.round()),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      shadows: [Shadow(blurRadius: 4)],
                    ),
                  ),
                ),
              // Marked from the bar: the mark fades in and its badge pops, as in the rewind's grid.
              LibraryCleanupMarkLayer(
                id: asset.id,
                mark: mark,
                radius: _tileRadius,
                badgeAlignment: AlignmentDirectional.bottomStart,
              ),
              if (selected) ...[
                ColoredBox(color: Colors.black.withValues(alpha: 0.25)),
                DecoratedBox(
                  decoration: BoxDecoration(
                    border: Border.all(color: scheme.primary, width: 2.5),
                    borderRadius: BorderRadius.circular(_tileRadius),
                  ),
                ),
                Positioned(
                  top: 5,
                  right: 5,
                  child: Container(
                    key: Key('cleanup-grid-selected-${asset.id}'),
                    width: 20,
                    height: 20,
                    decoration: BoxDecoration(color: scheme.primary, shape: BoxShape.circle),
                    child: Icon(Icons.check_rounded, size: 14, color: scheme.onPrimary),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
