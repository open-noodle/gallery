import 'dart:async';
import 'dart:math' as math;

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/physics.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_series.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_series.provider.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck_card.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_session_scaffold.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_view_flight.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/pop.dart';
import 'package:immich_mobile/gallery/motion/pressable.dart';
import 'package:immich_mobile/gallery/motion/swap.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/haptic_feedback.provider.dart';
import 'package:immich_mobile/utils/bytes_units.dart';
import 'package:openapi/api.dart';

// The series card (specs/2026-10-29-mobile-library-cleanup-design.md, "Queues: Bursts and Duplicates"; mockup
// `3-queues.html`, third screen, reworked in `6-bursts-v2.html`): one card per burst or duplicate group, shared by both
// queues so they feel the same. A big frame on black with "Frame i of N" and the suggestion's badge, a header, a
// filmstrip of every frame with its mark, and the selection chips. The rule: the selection changes only by tapping
// frames or a chip, and one primary action applies it, its label always saying exactly what will happen. The deck
// stacks these cards and throws them like the photo deck; the list shows them one under another.

/// Opens the details sheet on one frame; resolves with the frame's new mark (true keep, false trash), or null.
typedef LibraryCleanupFrameDetails = Future<bool?> Function(LibraryCleanupSeries series, CleanupAssetDto frame);

/// How far a sideways drag on the big frame must go to step to the next frame.
const _frameStep = 40.0;

/// The share of the card's width a drag must pass to act, and a throw's speed.
const _horizontalThreshold = 0.28;
const _throwVelocity = 800.0;

/// A vertical drag does nothing (there is no swipe up), so the card follows only part of the finger and springs back.
const _verticalFollow = 0.35;

const _stackColor = Color(0xFF6C8CFF);
const _skipColor = Color(0xFFCFD5E2);

/// The primary button's words, which the swipe-right stamp repeats: "Keep 1 · Trash 5", "Trash all 6", "Stack 6".
String libraryCleanupSeriesApplyLabel(BuildContext context, LibraryCleanupSeriesOutcome outcome) {
  final t = context.t;
  return switch (outcome.kind) {
    LibraryCleanupSeriesOutcomeKind.keepTrash => t.cleanup_series_apply_keep_trash(
      keep: outcome.keep,
      trash: outcome.trash,
    ),
    LibraryCleanupSeriesOutcomeKind.keepAll => t.cleanup_series_apply_keep_all(count: outcome.keep),
    LibraryCleanupSeriesOutcomeKind.trashAll => t.cleanup_series_apply_trash_all(count: outcome.trash),
    LibraryCleanupSeriesOutcomeKind.stack => t.cleanup_series_apply_stack(count: outcome.keep),
    LibraryCleanupSeriesOutcomeKind.dismiss => t.cleanup_series_not_duplicates,
    LibraryCleanupSeriesOutcomeKind.refused => t.cleanup_series_keep_one_copy,
  };
}

IconData _outcomeIcon(LibraryCleanupSeriesOutcomeKind kind) => switch (kind) {
  LibraryCleanupSeriesOutcomeKind.keepTrash => Icons.check_rounded,
  LibraryCleanupSeriesOutcomeKind.keepAll => Icons.done_all_rounded,
  LibraryCleanupSeriesOutcomeKind.trashAll => Icons.delete_outline_rounded,
  LibraryCleanupSeriesOutcomeKind.stack => Icons.layers_outlined,
  LibraryCleanupSeriesOutcomeKind.dismiss => Icons.call_split_rounded,
  LibraryCleanupSeriesOutcomeKind.refused => Icons.error_outline_rounded,
};

/// The stamp's colour: red when it trashes every frame, the stack's blue, else keep's green.
Color _outcomeColor(LibraryCleanupSeriesOutcomeKind kind) => switch (kind) {
  LibraryCleanupSeriesOutcomeKind.trashAll => libraryCleanupTrashColor,
  LibraryCleanupSeriesOutcomeKind.stack => _stackColor,
  _ => libraryCleanupKeepColor,
};

String _locale(BuildContext context) => Localizations.maybeLocaleOf(context)?.toLanguageTag() ?? 'en';

String _format(BuildContext context, String localDateTime, DateFormat Function(String locale) pattern) {
  final parsed = DateTime.tryParse(localDateTime);
  if (parsed == null) {
    return '';
  }
  try {
    return pattern(_locale(context)).format(parsed);
  } catch (_) {
    return pattern('en').format(parsed);
  }
}

/// The header: "3 photos in 2 s · 1 Sep 2023 · Kraków" for a burst, "2 copies · 1 Oct 2023" for duplicates.
String libraryCleanupSeriesHeader(BuildContext context, LibraryCleanupSeries series, {required bool duplicates}) {
  final t = context.t;
  final first = series.assets.first;
  final count = series.assets.length;
  final String what;
  if (duplicates) {
    what = t.cleanup_series_copies(count: count);
  } else {
    final from = DateTime.tryParse(first.localDateTime);
    final to = DateTime.tryParse(series.assets.last.localDateTime);
    final seconds = from == null || to == null ? 0 : (to.difference(from).inMilliseconds / 1000).round();
    what = libraryCleanupMessage(context, 'cleanup_series_burst_header', {'count': count, 'seconds': '$seconds'});
  }
  final city = series.assets.map((asset) => asset.city).nonNulls.firstOrNull;
  return [what, _format(context, first.localDateTime, DateFormat.yMMMd), ?city].where((p) => p.isNotEmpty).join(' · ');
}

/// The size the frames marked for trash would free.
String libraryCleanupSeriesFrees(LibraryCleanupSeries series, bool Function(String id) kept) => formatBytes(
  series.assets.where((asset) => !kept(asset.id)).fold<int>(0, (sum, asset) => sum + asset.fileSize.round()),
);

/// A drag's stamp on the big frame: the exact words of what letting go does, and how far the drag is, 0 to 1.
typedef LibraryCleanupSeriesStamp = ({String text, Color color, double amount});

/// One series card: the big frame, the header, the filmstrip and the selection chips. Tapping the big frame or a
/// thumbnail flips that frame between keep and trash (a thumbnail also shows it); swiping sideways on the big frame
/// steps through the frames; the chips change the selection; ⓘ opens the frame's details. Nothing here applies it.
class LibraryCleanupSeriesCard extends StatefulWidget {
  const LibraryCleanupSeriesCard({
    super.key,
    required this.series,
    required this.duplicates,
    required this.isKept,
    this.instead = false,
    this.onFlip,
    this.onPick,
    this.onDetails,
    this.stamp,
    this.frameHeight,
    this.warning = false,
    this.hidden = false,
  });

  final LibraryCleanupSeries series;
  final bool duplicates;

  /// A frame's mark as the card shows it: kept or marked for trash.
  final bool Function(String frameId) isKept;

  /// The "Stack instead" / "Not duplicates" chip is on.
  final bool instead;
  final ValueChanged<String>? onFlip;
  final ValueChanged<LibraryCleanupSeriesPick>? onPick;
  final ValueChanged<CleanupAssetDto>? onDetails;

  /// The drag's stamp, while one is under way.
  final LibraryCleanupSeriesStamp? stamp;

  /// The big frame's height in the list; null fills what the deck leaves.
  final double? frameHeight;

  /// "Keep at least one copy": a swipe right the duplicate group refused, its every copy marked for trash.
  final bool warning;

  /// While a flight from the deck lands on the big frame, the frame leaves its place empty.
  final bool hidden;

  @override
  State<LibraryCleanupSeriesCard> createState() => _LibraryCleanupSeriesCardState();
}

class _LibraryCleanupSeriesCardState extends State<LibraryCleanupSeriesCard> {
  late int _shown = _suggestedIndex;
  double _drag = 0;

  int get _suggestedIndex =>
      math.max(0, widget.series.assets.indexWhere((asset) => widget.series.suggested.contains(asset.id)));

  @override
  void didUpdateWidget(LibraryCleanupSeriesCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.series.id != widget.series.id) {
      _shown = _suggestedIndex;
    } else if (_shown >= widget.series.assets.length) {
      _shown = widget.series.assets.length - 1;
    }
  }

  void _show(int index) {
    if (index < 0 || index >= widget.series.assets.length || index == _shown) {
      return;
    }
    setState(() => _shown = index);
  }

  /// A thumbnail: shows that frame and flips its mark, as tapping the big frame does.
  void _tapThumb(int index) {
    _show(index);
    widget.onFlip?.call(widget.series.assets[index].id);
  }

  @override
  Widget build(BuildContext context) {
    final series = widget.series;
    final shown = series.assets[_shown];
    final kept = widget.isKept(shown.id);
    final theme = Theme.of(context);
    final t = context.t;
    final reduced = GalleryMotion.reduced(context);

    final frame = GestureDetector(
      key: Key('cleanup-series-frame-${series.id}'),
      behavior: HitTestBehavior.opaque,
      onTap: widget.onFlip == null ? null : () => widget.onFlip!(shown.id),
      onHorizontalDragStart: (_) => _drag = 0,
      onHorizontalDragUpdate: (details) => _drag += details.delta.dx,
      onHorizontalDragEnd: (details) {
        final velocity = details.velocity.pixelsPerSecond.dx;
        if (_drag < -_frameStep || velocity < -_throwVelocity) {
          _show(_shown + 1);
        } else if (_drag > _frameStep || velocity > _throwVelocity) {
          _show(_shown - 1);
        }
      },
      child: Opacity(
        opacity: widget.hidden ? 0 : 1,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: ColoredBox(
            color: Colors.black,
            child: Stack(
              fit: StackFit.expand,
              children: [
                // Changing the big frame crossfades.
                AnimatedSwitcher(
                  duration: reduced ? Duration.zero : GalleryMotion.quick,
                  child: _BigFrame(key: Key('cleanup-series-shown-${shown.id}'), asset: shown, trashed: !kept),
                ),
                if (series.suggested.contains(shown.id))
                  PositionedDirectional(
                    top: 10,
                    start: 10,
                    child: _Badge(
                      key: const Key('cleanup-series-badge'),
                      label: widget.duplicates ? t.cleanup_series_suggested : '★ ${t.cleanup_sharpest}',
                    ),
                  ),
                PositionedDirectional(
                  top: 10,
                  end: 10,
                  child: _MarkPill(key: Key('cleanup-series-shown-mark-${kept ? 'keep' : 'trash'}'), kept: kept),
                ),
                PositionedDirectional(
                  bottom: 10,
                  start: 10,
                  child: _Caption(
                    textKey: const Key('cleanup-series-position'),
                    text: t.cleanup_frame_position(index: _shown + 1, total: series.assets.length),
                  ),
                ),
                if (widget.onDetails != null)
                  PositionedDirectional(
                    bottom: 4,
                    end: 4,
                    child: IconButton(
                      key: const Key('cleanup-series-details'),
                      tooltip: t.details,
                      onPressed: () => widget.onDetails!(shown),
                      icon: const Icon(Icons.info_outline_rounded, color: Colors.white),
                    ),
                  ),
                if (widget.stamp case final stamp? when stamp.amount > 0)
                  Center(
                    child: Opacity(
                      opacity: stamp.amount.clamp(0.0, 1.0),
                      child: _Stamp(text: stamp.text, color: stamp.color),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );

    return Material(
      key: Key('cleanup-series-card-${series.id}'),
      color: theme.colorScheme.surfaceContainer,
      borderRadius: BorderRadius.circular(libraryCleanupCardRadius),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          mainAxisSize: widget.frameHeight == null ? MainAxisSize.max : MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (widget.frameHeight == null)
              Expanded(child: frame)
            else
              SizedBox(height: widget.frameHeight, child: frame),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: Text(
                    libraryCleanupSeriesHeader(context, series, duplicates: widget.duplicates),
                    key: const Key('cleanup-series-header'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                const SizedBox(width: 8),
                // What the frames marked for trash would free; the counts are on the button.
                Icon(Icons.delete_outline_rounded, size: 14, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 2),
                Text(
                  libraryCleanupSeriesFrees(series, widget.isKept),
                  key: const Key('cleanup-series-frees'),
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
            AnimatedSize(
              duration: reduced ? Duration.zero : GalleryMotion.quick,
              child: widget.warning
                  ? Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Row(
                        key: const Key('cleanup-series-keep-one'),
                        children: [
                          Icon(Icons.error_outline_rounded, size: 16, color: theme.colorScheme.error),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              t.cleanup_series_keep_one_copy,
                              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
                            ),
                          ),
                        ],
                      ),
                    )
                  : const SizedBox(width: double.infinity),
            ),
            const SizedBox(height: 8),
            _Filmstrip(
              series: series,
              shown: _shown,
              duplicates: widget.duplicates,
              isKept: widget.isKept,
              onTap: _tapThumb,
            ),
            const SizedBox(height: 8),
            _PickChips(
              series: series,
              duplicates: widget.duplicates,
              instead: widget.instead,
              isKept: widget.isKept,
              onPick: widget.onPick,
            ),
          ],
        ),
      ),
    );
  }
}

/// The frame shown large, uncropped; dimmed while it is marked for trash. The thumbnail sits under the preview until it
/// lands.
class _BigFrame extends StatelessWidget {
  const _BigFrame({super.key, required this.asset, required this.trashed});

  final CleanupAssetDto asset;
  final bool trashed;

  @override
  Widget build(BuildContext context) => AnimatedOpacity(
    duration: GalleryMotion.quick,
    opacity: trashed ? 0.45 : 1,
    child: Image(
      image: libraryCleanupPreview(asset),
      fit: BoxFit.contain,
      gaplessPlayback: true,
      frameBuilder: (context, child, frame, sync) => frame == null && !sync
          ? Image(
              image: libraryCleanupThumbnail(asset),
              fit: BoxFit.contain,
              errorBuilder: (_, _, _) => const SizedBox.expand(),
            )
          : child,
      errorBuilder: (_, _, _) => const SizedBox.expand(),
    ),
  );
}

/// Every frame, with its mark: a green ring and a check when kept, dimmed with ✕ when marked for trash. The outline of
/// the frame shown slides to the new thumbnail. Duplicates add each copy's resolution and size, the highest resolution
/// and the largest file highlighted, so copies can be told apart without opening details.
class _Filmstrip extends StatelessWidget {
  const _Filmstrip({
    required this.series,
    required this.shown,
    required this.duplicates,
    required this.isKept,
    required this.onTap,
  });

  final LibraryCleanupSeries series;
  final int shown;
  final bool duplicates;
  final bool Function(String frameId) isKept;
  final ValueChanged<int> onTap;

  static const _thumb = 56.0;
  static const _gap = 6.0;

  @override
  Widget build(BuildContext context) {
    final assets = series.assets;
    int pixels(CleanupAssetDto asset) => (asset.width ?? 0) * (asset.height ?? 0);
    final largest = assets.map((asset) => asset.fileSize).reduce(math.max);
    final sharpest = assets.map(pixels).reduce(math.max);
    final singleLargest = assets.where((asset) => asset.fileSize == largest).length == 1;
    final singleSharpest = sharpest > 0 && assets.where((asset) => pixels(asset) == sharpest).length == 1;
    final width = assets.length * _thumb + (assets.length - 1) * _gap;
    final reduced = GalleryMotion.reduced(context);
    final scheme = Theme.of(context).colorScheme;

    return SingleChildScrollView(
      key: const Key('cleanup-series-filmstrip'),
      scrollDirection: Axis.horizontal,
      child: SizedBox(
        width: width,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final (index, asset) in assets.indexed) ...[
                  if (index > 0) const SizedBox(width: _gap),
                  SizedBox(
                    width: _thumb,
                    child: Column(
                      children: [
                        _Thumb(asset: asset, kept: isKept(asset.id), onTap: () => onTap(index)),
                        if (duplicates) ...[
                          const SizedBox(height: 4),
                          _CopyLabel(
                            labelKey: Key('cleanup-series-res-${asset.id}'),
                            text: asset.width == null || asset.height == null ? '–' : '${asset.width}×${asset.height}',
                            highlighted: singleSharpest && pixels(asset) == sharpest,
                            highlightKey: Key('cleanup-series-sharpest-${asset.id}'),
                          ),
                          _CopyLabel(
                            labelKey: Key('cleanup-series-size-${asset.id}'),
                            text: formatBytes(asset.fileSize.round()),
                            highlighted: singleLargest && asset.fileSize == largest,
                            highlightKey: Key('cleanup-series-largest-${asset.id}'),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ],
            ),
            AnimatedPositioned(
              duration: reduced ? Duration.zero : GalleryMotion.base,
              curve: GalleryMotion.settle,
              left: shown * (_thumb + _gap) - 3,
              top: -3,
              width: _thumb + 6,
              height: _thumb + 6,
              child: IgnorePointer(
                child: DecoratedBox(
                  key: const Key('cleanup-series-outline'),
                  decoration: BoxDecoration(
                    border: Border.all(color: scheme.primary, width: 2.5),
                    borderRadius: BorderRadius.circular(11),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Thumb extends StatelessWidget {
  const _Thumb({required this.asset, required this.kept, required this.onTap});

  final CleanupAssetDto asset;
  final bool kept;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => GestureDetector(
    key: Key('cleanup-series-thumb-${asset.id}'),
    onTap: onTap,
    child: SizedBox.square(
      dimension: _Filmstrip._thumb,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Stack(
          fit: StackFit.expand,
          children: [
            AnimatedOpacity(
              duration: GalleryMotion.quick,
              opacity: kept ? 1 : 0.4,
              child: Image(
                image: libraryCleanupThumbnail(asset),
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => const ColoredBox(color: Colors.black26),
              ),
            ),
            // The ring fades in and the check pops when a frame turns kept.
            AnimatedOpacity(
              duration: GalleryMotion.quick,
              opacity: kept ? 1 : 0,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  border: Border.all(color: libraryCleanupKeepColor, width: 3),
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
            Positioned(
              top: 3,
              right: 3,
              child: GalleryPop(
                trigger: kept,
                child: Container(
                  key: Key('cleanup-series-mark-${asset.id}-${kept ? 'keep' : 'trash'}'),
                  width: 18,
                  height: 18,
                  decoration: BoxDecoration(
                    color: kept ? libraryCleanupKeepColor : libraryCleanupTrashColor,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(kept ? Icons.check_rounded : Icons.close_rounded, size: 13, color: Colors.white),
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _CopyLabel extends StatelessWidget {
  const _CopyLabel({required this.labelKey, required this.text, required this.highlighted, required this.highlightKey});

  final Key labelKey;
  final String text;
  final bool highlighted;
  final Key highlightKey;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final label = Text(
      text,
      key: labelKey,
      maxLines: 1,
      overflow: TextOverflow.fade,
      softWrap: false,
      style: TextStyle(
        fontSize: 10,
        fontFeatures: const [FontFeature.tabularFigures()],
        fontWeight: highlighted ? FontWeight.w800 : FontWeight.w400,
        color: highlighted ? scheme.primary : scheme.onSurfaceVariant,
      ),
    );
    return highlighted ? KeyedSubtree(key: highlightKey, child: label) : label;
  }
}

class _Badge extends StatelessWidget {
  const _Badge({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(color: const Color(0xFFF59E0B), borderRadius: BorderRadius.circular(6)),
    child: Text(
      label.toUpperCase(),
      style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800),
    ),
  );
}

class _MarkPill extends StatelessWidget {
  const _MarkPill({super.key, required this.kept});

  final bool kept;

  @override
  Widget build(BuildContext context) => GalleryPop(
    trigger: kept,
    child: AnimatedContainer(
      duration: GalleryMotion.quick,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(
        color: kept ? libraryCleanupKeepColor : libraryCleanupTrashColor,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        (kept ? context.t.keep : context.t.trash).toUpperCase(),
        style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700),
      ),
    ),
  );
}

class _Caption extends StatelessWidget {
  const _Caption({required this.textKey, required this.text});

  final Key textKey;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.6), borderRadius: BorderRadius.circular(8)),
    child: Text(
      text,
      key: textKey,
      style: const TextStyle(color: Colors.white, fontSize: 12, fontFeatures: [FontFeature.tabularFigures()]),
    ),
  );
}

/// A drag's stamp on the big frame, as the photo deck's stamps: the exact words of what letting go does.
class _Stamp extends StatelessWidget {
  const _Stamp({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Transform.rotate(
    angle: -0.12,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      decoration: BoxDecoration(
        border: Border.all(color: color, width: 3),
        borderRadius: BorderRadius.circular(10),
        color: Colors.black.withValues(alpha: 0.35),
      ),
      child: Text(
        text,
        key: const Key('cleanup-series-stamp'),
        maxLines: 1,
        style: TextStyle(color: color, fontSize: 22, fontWeight: FontWeight.w900),
      ),
    ),
  );
}

/// The shortcuts under the filmstrip. Each changes the selection and none applies it; the one matching the selection
/// shows selected. Bursts: "★ Best only", "Keep all", "Stack instead". Duplicates: "Suggested only", "Keep all", "Not
/// duplicates". The last is a toggle: tapping a frame or another chip turns it off.
class _PickChips extends StatelessWidget {
  const _PickChips({
    required this.series,
    required this.duplicates,
    required this.instead,
    required this.isKept,
    required this.onPick,
  });

  final LibraryCleanupSeries series;
  final bool duplicates;
  final bool instead;
  final bool Function(String frameId) isKept;
  final ValueChanged<LibraryCleanupSeriesPick>? onPick;

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final allKept = !instead && series.assets.every((asset) => isKept(asset.id));
    final suggested =
        !instead && series.assets.every((asset) => isKept(asset.id) == series.suggested.contains(asset.id));
    final chips = [
      (
        LibraryCleanupSeriesPick.suggested,
        duplicates ? t.cleanup_series_suggested_only : t.cleanup_series_best_only,
        duplicates ? Icons.auto_awesome_rounded : Icons.star_rounded,
        suggested,
      ),
      (LibraryCleanupSeriesPick.all, t.cleanup_keep_all, Icons.done_all_rounded, allKept),
      (
        LibraryCleanupSeriesPick.instead,
        duplicates ? t.cleanup_series_not_duplicates : t.cleanup_stack_instead,
        duplicates ? Icons.call_split_rounded : Icons.layers_outlined,
        instead,
      ),
    ];
    return Wrap(
      key: const Key('cleanup-series-picks'),
      spacing: 6,
      runSpacing: 6,
      children: [
        for (final (pick, label, icon, selected) in chips)
          ChoiceChip(
            key: Key('cleanup-series-pick-${pick.name}'),
            avatar: Icon(icon, size: 16),
            label: Text(label),
            selected: selected,
            showCheckmark: false,
            visualDensity: VisualDensity.compact,
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            onSelected: onPick == null ? null : (_) => onPick!(pick),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The deck
// ---------------------------------------------------------------------------------------------------------------------

/// What the deck and the list need from the session.
class LibraryCleanupSeriesActions {
  const LibraryCleanupSeriesActions({
    required this.apply,
    required this.skip,
    required this.pick,
    required this.flip,
    required this.undo,
    required this.details,
  });

  /// Applies a series' selection as its button says; false when refused (a duplicate group that would lose every copy).
  final bool Function(String seriesId) apply;
  final void Function(String seriesId) skip;
  final void Function(String seriesId, LibraryCleanupSeriesPick pick) pick;
  final void Function(String seriesId, String frameId) flip;
  final VoidCallback undo;
  final void Function(LibraryCleanupSeries series, CleanupAssetDto frame) details;
}

/// The deck's two swipes: right applies the selection (the primary button), left skips.
enum _Swipe { apply, skip }

class _Flight {
  _Flight({required this.series, required this.stamp, required this.from, required this.to, required this.controller});

  final LibraryCleanupSeries series;
  final LibraryCleanupSeriesStamp stamp;
  final Offset from;
  final Offset to;
  final AnimationController controller;
}

/// The series deck: the current series on top, the next behind it. Under it: Undo, the primary button, whose label is
/// what applying the selection does ("Keep 1 · Trash 5", "Trash all 6", "Stack 6"), and Skip. A swipe right on the
/// card is the primary button and its stamp shows the same words; a swipe left is Skip; there is no swipe up. A
/// duplicate group with every copy marked for trash cannot be applied: the button is disabled and the card resists.
/// Only the top and next series are built, so a series' previews load when it is next or on top.
class LibraryCleanupSeriesDeck extends ConsumerStatefulWidget {
  const LibraryCleanupSeriesDeck({super.key, required this.state, required this.actions});

  final LibraryCleanupSeriesState state;
  final LibraryCleanupSeriesActions actions;

  @override
  ConsumerState<LibraryCleanupSeriesDeck> createState() => _LibraryCleanupSeriesDeckState();
}

class _LibraryCleanupSeriesDeckState extends ConsumerState<LibraryCleanupSeriesDeck> with TickerProviderStateMixin {
  late final AnimationController _x = AnimationController.unbounded(vsync: this);
  late final AnimationController _y = AnimationController.unbounded(vsync: this);
  late final AnimationController _fadeIn = AnimationController(vsync: this, duration: GalleryMotion.quick, value: 1);
  final List<_Flight> _flights = [];
  final Set<String> _preloaded = {};
  Size _size = Size.zero;
  _Swipe? _armed;

  /// A refused swipe right (every copy trashed) shows "Keep at least one copy" for a moment.
  Timer? _warningTimer;
  bool _refused = false;

  LibraryCleanupSeriesState get _state => widget.state;
  bool get _duplicates => _state.isDuplicates;
  LibraryCleanupSeries? get _top => _state.undecided.firstOrNull;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _preloadNext();
  }

  @override
  void didUpdateWidget(LibraryCleanupSeriesDeck oldWidget) {
    super.didUpdateWidget(oldWidget);
    final before = oldWidget.state.undecided.firstOrNull;
    final now = _top;
    if (now != null && now.id != before?.id) {
      final was = oldWidget.state.decisions[now.id];
      if (was != null && !_state.decisions.containsKey(now.id)) {
        _comeBack(now, was);
      } else {
        _x.value = 0;
        _y.value = 0;
      }
      _refused = false;
    }
    _preloadNext();
  }

  /// The next series' frame shown first (its suggestion) is fetched before it comes on top.
  void _preloadNext() {
    final next = _state.undecided.elementAtOrNull(1);
    if (next == null || !_preloaded.add(next.id)) {
      return;
    }
    final first = next.assets.where((asset) => next.suggested.contains(asset.id)).firstOrNull ?? next.assets.first;
    unawaited(precacheImage(libraryCleanupPreview(first), context, onError: (_, _) {}));
  }

  @override
  void dispose() {
    _warningTimer?.cancel();
    for (final flight in _flights) {
      flight.controller.dispose();
    }
    _x.dispose();
    _y.dispose();
    _fadeIn.dispose();
    super.dispose();
  }

  Offset get _offset => Offset(_x.value, _y.value);

  _Swipe? _swipeAt(Offset offset) {
    if (_size.isEmpty) {
      return null;
    }
    if (offset.dx.abs() > _size.width * _horizontalThreshold && offset.dx.abs() >= offset.dy.abs()) {
      return offset.dx > 0 ? _Swipe.apply : _Swipe.skip;
    }
    return null;
  }

  /// Skip always goes; applying is refused for a duplicate group whose every copy is marked for trash.
  bool _allowed(_Swipe swipe) {
    final top = _top;
    return top != null && (swipe == _Swipe.skip || _state.canApply(top));
  }

  /// The stamp a swipe shows: the primary button's words for a swipe right, "Skip" for a swipe left.
  LibraryCleanupSeriesStamp _stampFor(_Swipe swipe, LibraryCleanupSeries series, double amount) {
    if (swipe == _Swipe.skip) {
      return (text: context.t.skip.toUpperCase(), color: _skipColor, amount: amount);
    }
    final outcome = _state.outcome(series);
    return (
      text: libraryCleanupSeriesApplyLabel(context, outcome).toUpperCase(),
      color: _outcomeColor(outcome.kind),
      amount: amount,
    );
  }

  void _refuse() {
    ref.read(hapticFeedbackProvider.notifier).heavyImpact();
    _warningTimer?.cancel();
    setState(() => _refused = true);
    _warningTimer = Timer(const Duration(seconds: 3), () {
      if (mounted) {
        setState(() => _refused = false);
      }
    });
  }

  void _onPanStart(DragStartDetails details) {
    _x.stop();
    _y.stop();
  }

  void _onPanUpdate(DragUpdateDetails details) {
    var dx = details.delta.dx;
    // A refused swipe right resists: the card follows a quarter of the finger (rubber band).
    if (_x.value + dx > 0 && !_allowed(_Swipe.apply)) {
      dx *= 0.25;
    }
    _x.value += dx;
    _y.value += details.delta.dy * _verticalFollow;
    final armed = _swipeAt(_offset);
    final usable = armed != null && _allowed(armed) ? armed : null;
    if (usable != null && usable != _armed) {
      ref.read(hapticFeedbackProvider.notifier).selectionClick();
    }
    _armed = usable;
  }

  void _onPanEnd(DragEndDetails details) {
    final velocity = details.velocity.pixelsPerSecond;
    _armed = null;
    var swipe = _swipeAt(_offset);
    if (swipe == null && velocity.dx.abs() > _throwVelocity && velocity.dx.abs() > velocity.dy.abs()) {
      swipe = velocity.dx > 0 ? _Swipe.apply : _Swipe.skip;
    }
    if (swipe != null && !_allowed(swipe)) {
      _refuse();
      swipe = null;
    }
    if (swipe == null) {
      _springBack(velocity);
    } else {
      _throw(swipe, speed: velocity.distance);
    }
  }

  void _springBack(Offset velocity) {
    if (GalleryMotion.reduced(context)) {
      _x.value = 0;
      _y.value = 0;
      return;
    }
    unawaited(_x.animateWith(SpringSimulation(GalleryMotion.bouncy, _x.value, 0, velocity.dx)));
    unawaited(_y.animateWith(SpringSimulation(GalleryMotion.bouncy, _y.value, 0, velocity.dy)));
  }

  /// A button: thrown as its swipe would be, or refused with the rubber band's message.
  void _press(_Swipe swipe) {
    if (!_allowed(swipe)) {
      _refuse();
      if (!GalleryMotion.reduced(context)) {
        // A small nudge towards the refused side, springing back.
        _x.value = 18;
        _springBack(Offset.zero);
      }
      return;
    }
    _throw(swipe);
  }

  void _throw(_Swipe swipe, {double speed = 0}) {
    final top = _top;
    if (top == null) {
      return;
    }
    // The stamp is read before the decision, so the flying card says what was applied.
    final stamp = _stampFor(swipe, top, 1);
    if (swipe == _Swipe.skip) {
      widget.actions.skip(top.id);
    } else if (!widget.actions.apply(top.id)) {
      _refuse();
      _springBack(Offset.zero);
      return;
    }
    final reduced = GalleryMotion.reduced(context);
    final from = _offset;
    final direction = swipe == _Swipe.apply ? 1.0 : -1.0;
    final reach = _size.longestSide * 1.3;
    final to = reduced ? from : Offset(direction * reach + from.dx * 0.2, from.dy * 0.2);
    final distance = (to - from).distance;
    final millis = reduced
        ? GalleryMotion.quick.inMilliseconds
        : (distance / math.max(speed, 1800) * 1000).clamp(180, 340);
    final controller = AnimationController(
      vsync: this,
      duration: Duration(milliseconds: millis.round()),
    );
    final flight = _Flight(series: top, stamp: stamp, from: from, to: to, controller: controller);
    setState(() => _flights.add(flight));
    unawaited(
      controller.forward().whenComplete(() {
        if (mounted) {
          setState(() => _flights.remove(flight));
        }
        controller.dispose();
      }),
    );
    _x.value = 0;
    _y.value = 0;
  }

  /// Undo: the series flies back in from the side it left by.
  void _comeBack(LibraryCleanupSeries series, LibraryCleanupSeriesDecision decision) {
    for (final flight in _flights.where((flight) => flight.series.id == series.id).toList()) {
      flight.controller.stop();
      _flights.remove(flight);
    }
    if (GalleryMotion.reduced(context)) {
      _x.value = 0;
      _y.value = 0;
      _fadeIn.value = 0;
      unawaited(_fadeIn.forward());
      return;
    }
    final direction = decision == LibraryCleanupSeriesDecision.skip ? -1.0 : 1.0;
    final start = direction * _size.longestSide * 1.3;
    _x.value = start;
    _y.value = 0;
    unawaited(_x.animateWith(SpringSimulation(GalleryMotion.gentle, start, 0, 0)));
  }

  LibraryCleanupSeriesStamp? _stampAt(LibraryCleanupSeries top, Offset offset) {
    if (_size.isEmpty || offset.dx == 0 || offset.dx.abs() < offset.dy.abs()) {
      return null;
    }
    final swipe = _swipeAt(offset) ?? (offset.dx > 0 ? _Swipe.apply : _Swipe.skip);
    if (!_allowed(swipe)) {
      return null;
    }
    return _stampFor(swipe, top, (offset.dx.abs() / (_size.width * _horizontalThreshold)).clamp(0.0, 1.0));
  }

  Widget _card(LibraryCleanupSeries series, {bool top = false, LibraryCleanupSeriesStamp? stamp}) =>
      LibraryCleanupSeriesCard(
        key: ValueKey('series-${series.id}'),
        series: series,
        duplicates: _duplicates,
        isKept: (frameId) => _state.shownKept(series, frameId),
        instead: _state.isInstead(series),
        onFlip: top ? (frameId) => widget.actions.flip(series.id, frameId) : null,
        onPick: top ? (pick) => widget.actions.pick(series.id, pick) : null,
        onDetails: top ? (frame) => widget.actions.details(series, frame) : null,
        stamp: stamp,
        warning: top && _refused,
      );

  @override
  Widget build(BuildContext context) {
    final undecided = _state.undecided;
    final top = undecided.firstOrNull;
    final next = undecided.elementAtOrNull(1);
    final reduced = GalleryMotion.reduced(context);
    final t = context.t;
    return Padding(
      padding: libraryCleanupDeckPadding,
      child: Column(
        children: [
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) {
                _size = constraints.biggest;
                return Stack(
                  clipBehavior: Clip.none,
                  children: [
                    if (next != null)
                      Positioned.fill(
                        key: ValueKey('behind-${next.id}'),
                        child: IgnorePointer(
                          child: Transform.translate(
                            offset: const Offset(0, 12),
                            child: Transform.scale(scale: 0.94, child: Opacity(opacity: 0.7, child: _card(next))),
                          ),
                        ),
                      ),
                    if (top != null)
                      Positioned.fill(
                        key: ValueKey('top-${top.id}'),
                        child: FadeTransition(
                          opacity: _fadeIn,
                          child: GestureDetector(
                            key: const Key('cleanup-series-top'),
                            behavior: HitTestBehavior.opaque,
                            dragStartBehavior: DragStartBehavior.down,
                            onPanStart: _onPanStart,
                            onPanUpdate: _onPanUpdate,
                            onPanEnd: _onPanEnd,
                            child: AnimatedBuilder(
                              animation: Listenable.merge([_x, _y]),
                              builder: (context, child) => _Moved(
                                offset: _offset,
                                width: _size.width,
                                rotate: !reduced,
                                child: _card(top, top: true, stamp: _stampAt(top, _offset)),
                              ),
                            ),
                          ),
                        ),
                      ),
                    for (final flight in _flights)
                      Positioned.fill(
                        key: ValueKey('flight-${flight.series.id}-${identityHashCode(flight)}'),
                        child: IgnorePointer(
                          child: AnimatedBuilder(
                            animation: flight.controller,
                            builder: (context, child) {
                              final progress = GalleryMotion.settle.transform(flight.controller.value);
                              return Opacity(
                                opacity: reduced
                                    ? 1 - flight.controller.value
                                    : (flight.controller.value > 0.7 ? (1 - flight.controller.value) / 0.3 : 1),
                                child: _Moved(
                                  offset: Offset.lerp(flight.from, flight.to, progress)!,
                                  width: _size.width,
                                  rotate: !reduced,
                                  child: child!,
                                ),
                              );
                            },
                            child: _card(flight.series, stamp: flight.stamp),
                          ),
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
          const SizedBox(height: libraryCleanupButtonRowGap),
          SizedBox(
            height: libraryCleanupButtonRowHeight,
            child: Row(
              children: [
                _SeriesButton(
                  key: const Key('cleanup-series-undo'),
                  icon: Icons.undo_rounded,
                  label: t.undo,
                  onPressed: _state.canUndo ? widget.actions.undo : null,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _ApplyButton(
                    buttonKey: const Key('cleanup-series-apply'),
                    outcome: top == null ? null : _state.outcome(top),
                    onPressed: top == null || !_state.canApply(top) ? null : () => _press(_Swipe.apply),
                  ),
                ),
                const SizedBox(width: 10),
                OutlinedButton(
                  key: const Key('cleanup-series-skip'),
                  onPressed: top == null ? null : () => _press(_Swipe.skip),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(64, 48),
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    shape: const StadiumBorder(),
                  ),
                  child: Text(t.skip),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Moved extends StatelessWidget {
  const _Moved({required this.offset, required this.width, required this.rotate, required this.child});

  final Offset offset;
  final double width;
  final bool rotate;
  final Widget child;

  @override
  Widget build(BuildContext context) => Transform.translate(
    offset: offset,
    child: rotate && width > 0
        ? Transform.rotate(angle: (offset.dx / width).clamp(-1.5, 1.5) * 0.18, child: child)
        : child,
  );
}

/// The primary button: its label is what applying the selection does, and it changes as frames and chips are tapped
/// (the new words rise into place). Red when it trashes every frame, the stack's blue when it stacks; disabled, with
/// "Keep at least one copy", for a duplicate group whose every copy is marked for trash.
class _ApplyButton extends StatelessWidget {
  const _ApplyButton({required this.buttonKey, required this.outcome, required this.onPressed});

  final Key buttonKey;
  final LibraryCleanupSeriesOutcome? outcome;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final outcome = this.outcome;
    final label = outcome == null ? '' : libraryCleanupSeriesApplyLabel(context, outcome);
    final kind = outcome?.kind ?? LibraryCleanupSeriesOutcomeKind.keepTrash;
    final (background, foreground) = switch (kind) {
      LibraryCleanupSeriesOutcomeKind.trashAll => (libraryCleanupTrashColor, Colors.white),
      LibraryCleanupSeriesOutcomeKind.stack => (_stackColor, Colors.white),
      _ => (scheme.primary, scheme.onPrimary),
    };
    return GalleryPressable(
      enabled: onPressed != null,
      pressedScale: 0.96,
      child: FilledButton(
        key: buttonKey,
        onPressed: onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: background,
          foregroundColor: foreground,
          minimumSize: const Size.fromHeight(48),
          padding: const EdgeInsets.symmetric(horizontal: 12),
          shape: const StadiumBorder(),
        ),
        child: GallerySwap(
          value: label,
          alignment: Alignment.center,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(_outcomeIcon(kind), size: 20),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  label,
                  key: const Key('cleanup-series-apply-label'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w700, fontFeatures: [FontFeature.tabularFigures()]),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SeriesButton extends StatelessWidget {
  const _SeriesButton({super.key, required this.icon, required this.label, required this.onPressed});

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final foreground = onPressed == null ? scheme.onSurface.withValues(alpha: 0.3) : scheme.onSurface;
    return GalleryPressable(
      enabled: onPressed != null,
      pressedScale: 0.86,
      child: Semantics(
        button: true,
        enabled: onPressed != null,
        label: label,
        child: Tooltip(
          message: label,
          child: Material(
            color: scheme.surfaceContainerHigh,
            shape: CircleBorder(side: BorderSide(color: scheme.outlineVariant)),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: onPressed,
              child: SizedBox.square(dimension: 44, child: Icon(icon, color: foreground, size: 20)),
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The list (grid mode)
// ---------------------------------------------------------------------------------------------------------------------

/// Grid mode for the series queues: the series cards one under another, each with its chips and its own apply button
/// (the deck's primary, as a chip that shows selected while the series is applied), and "Keep the suggestion for all",
/// which sets every loaded series with nothing applied to its suggestion and applies it. Built lazily, so a series'
/// previews load as it scrolls in. Its state is a flight grid keyed by series id: the deck's big frame flies into the
/// series' frame here and back.
class LibraryCleanupSeriesList extends StatefulWidget {
  const LibraryCleanupSeriesList({
    super.key,
    required this.state,
    required this.actions,
    required this.onKeepSuggestionForAll,
    this.onNearEnd,
    this.hiddenId,
  });

  final LibraryCleanupSeriesState state;
  final LibraryCleanupSeriesActions actions;
  final VoidCallback onKeepSuggestionForAll;
  final VoidCallback? onNearEnd;

  /// The series a flight is landing on, its frame kept empty until it lands.
  final String? hiddenId;

  @override
  State<LibraryCleanupSeriesList> createState() => _LibraryCleanupSeriesListState();
}

class _LibraryCleanupSeriesListState extends State<LibraryCleanupSeriesList> implements LibraryCleanupFlightGrid {
  final _scroll = ScrollController();

  LibraryCleanupSeriesState get state => widget.state;

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  /// The series' big frame, while it is on screen (a flight never aims off it).
  @override
  Rect? tileRect(String id) {
    final rect = libraryCleanupRectOf(context, {Key('cleanup-series-frame-$id')});
    final view = libraryCleanupRectOf(context, {const Key('cleanup-series-list')});
    return rect == null || view == null || !view.contains(rect.center) ? null : rect;
  }

  @override
  void reveal(String id) {
    final index = state.series.indexWhere((series) => series.id == id);
    if (index < 0 || !_scroll.hasClients) {
      return;
    }
    final row = libraryCleanupRectOf(context, {Key('cleanup-series-row-$id')});
    final position = _scroll.position;
    final double target;
    if (row != null) {
      final view = libraryCleanupRectOf(context, {const Key('cleanup-series-list')})!;
      target = position.pixels + row.top - view.top - (position.viewportDimension - row.height) / 2;
    } else {
      // Not built yet: the rows are about the same height, so the first one built tells where it is.
      final first = libraryCleanupRectOf(context, {Key('cleanup-series-row-${state.series.first.id}')});
      if (first == null) {
        return;
      }
      target = 56 + index * (first.height + 14) - (position.viewportDimension - first.height) / 2;
    }
    position.jumpTo(target.clamp(position.minScrollExtent, position.maxScrollExtent));
  }

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final duplicates = state.isDuplicates;
    final actions = widget.actions;
    final open = state.series.any((series) => !state.isPending(series));
    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (notification.metrics.extentAfter < 800) {
          widget.onNearEnd?.call();
        }
        return false;
      },
      child: ListView.separated(
        key: const Key('cleanup-series-list'),
        controller: _scroll,
        padding: const EdgeInsets.fromLTRB(14, 4, 14, 40),
        itemCount: state.series.length + 1,
        separatorBuilder: (_, _) => const SizedBox(height: 14),
        itemBuilder: (context, index) {
          if (index == 0) {
            return Align(
              alignment: AlignmentDirectional.centerStart,
              child: FilledButton.tonalIcon(
                key: const Key('cleanup-series-keep-suggestion-all'),
                onPressed: open ? widget.onKeepSuggestionForAll : null,
                icon: const Icon(Icons.auto_awesome_rounded, size: 18),
                label: Text(t.cleanup_series_keep_suggestion_all),
              ),
            );
          }
          final series = state.series[index - 1];
          final outcome = state.outcome(series);
          final pending = state.isPending(series);
          return Column(
            key: Key('cleanup-series-row-${series.id}'),
            mainAxisSize: MainAxisSize.min,
            children: [
              LibraryCleanupSeriesCard(
                series: series,
                duplicates: duplicates,
                isKept: (frameId) => state.shownKept(series, frameId),
                instead: state.isInstead(series),
                onFlip: (frameId) => actions.flip(series.id, frameId),
                onPick: (pick) => actions.pick(series.id, pick),
                onDetails: (frame) => actions.details(series, frame),
                frameHeight: 240,
                hidden: widget.hiddenId == series.id,
              ),
              const SizedBox(height: 6),
              ChoiceChip(
                key: Key('cleanup-series-list-apply-${series.id}'),
                avatar: Icon(_outcomeIcon(outcome.kind), size: 18),
                label: GallerySwap(
                  value: libraryCleanupSeriesApplyLabel(context, outcome),
                  child: Text(libraryCleanupSeriesApplyLabel(context, outcome)),
                ),
                selected: pending,
                showCheckmark: false,
                onSelected: state.canApply(series)
                    ? (_) {
                        if (!pending) {
                          actions.apply(series.id);
                        }
                      }
                    : null,
              ),
            ],
          );
        },
      ),
    );
  }
}
