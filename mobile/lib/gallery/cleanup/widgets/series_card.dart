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
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/pop.dart';
import 'package:immich_mobile/gallery/motion/pressable.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/haptic_feedback.provider.dart';
import 'package:immich_mobile/utils/bytes_units.dart';
import 'package:openapi/api.dart';

// The series card (specs/2026-10-29-mobile-library-cleanup-design.md, "Queues: Bursts and Duplicates"; mockup
// `3-queues.html`, third screen): one card per burst or duplicate group, shared by both queues so they feel the same.
// A big frame on black with "Frame i of N" and the suggestion's badge, a header, and a filmstrip of every frame with its
// mark. The deck stacks these cards and throws them like the photo deck; the list shows them one under another.

/// Opens the details sheet on one frame; resolves with the frame's new mark (true keep, false trash), or null.
typedef LibraryCleanupFrameDetails = Future<bool?> Function(LibraryCleanupSeries series, CleanupAssetDto frame);

/// How far a sideways drag on the big frame must go to step to the next frame.
const _frameStep = 40.0;

/// The share of the card's width (or height, upwards) a drag must pass to decide, and a throw's speed.
const _horizontalThreshold = 0.28;
const _upThreshold = 0.16;
const _throwVelocity = 800.0;

/// Where a decision throws the card: right keeps as set, left trashes all (Bursts), up keeps all or dismisses.
Offset _direction(LibraryCleanupSeriesDecision decision) => switch (decision) {
  LibraryCleanupSeriesDecision.asSet => const Offset(1, 0),
  LibraryCleanupSeriesDecision.trashAll => const Offset(-1, 0),
  LibraryCleanupSeriesDecision.keepAll || LibraryCleanupSeriesDecision.dismiss => const Offset(0, -1),
  LibraryCleanupSeriesDecision.stack => const Offset(0, 1),
};

/// The decision a swipe up makes: keep all for a burst, "not duplicates" for a duplicate group.
LibraryCleanupSeriesDecision _upDecision(bool duplicates) =>
    duplicates ? LibraryCleanupSeriesDecision.dismiss : LibraryCleanupSeriesDecision.keepAll;

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

/// "Keep 1, trash 2 (6.1 KiB)": what the marks would do, with the size the trash frees.
String libraryCleanupSeriesChip(BuildContext context, LibraryCleanupSeries series, bool Function(String id) kept) {
  final keep = series.assets.where((asset) => kept(asset.id)).length;
  final trashBytes = series.assets
      .where((asset) => !kept(asset.id))
      .fold<int>(0, (sum, asset) => sum + asset.fileSize.round());
  return '${context.t.cleanup_keep_n_trash_m(keep: keep, trash: series.assets.length - keep)} (${formatBytes(trashBytes)})';
}

/// One series card: the big frame, the header and the filmstrip. Tap a thumbnail to show it; tap the big frame to flip
/// the shown frame's mark; swipe sideways on the big frame to step through the frames; ⓘ opens its details.
class LibraryCleanupSeriesCard extends StatefulWidget {
  const LibraryCleanupSeriesCard({
    super.key,
    required this.series,
    required this.duplicates,
    required this.isKept,
    this.onFlip,
    this.onDetails,
    this.stamps = const {},
    this.frameHeight,
    this.warning = false,
    this.decision,
  });

  final LibraryCleanupSeries series;
  final bool duplicates;

  /// A frame's mark as it stands: kept or marked for trash.
  final bool Function(String frameId) isKept;
  final ValueChanged<String>? onFlip;
  final ValueChanged<CleanupAssetDto>? onDetails;

  /// How far a drag is towards each decision, 0 to 1.
  final Map<LibraryCleanupSeriesDecision, double> stamps;

  /// The big frame's height in the list; null fills what the deck leaves.
  final double? frameHeight;

  /// "Keep at least one copy": a duplicate group whose marks trash every copy, or a left swipe it refused.
  final bool warning;

  /// The list shows what was decided for the series.
  final LibraryCleanupSeriesDecision? decision;

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
              for (final MapEntry(key: decision, value: amount) in widget.stamps.entries)
                if (amount > 0)
                  Center(
                    child: Opacity(
                      opacity: amount.clamp(0.0, 1.0),
                      child: _Stamp(decision: decision, duplicates: widget.duplicates),
                    ),
                  ),
            ],
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
            Text(
              libraryCleanupSeriesHeader(context, series, duplicates: widget.duplicates),
              key: const Key('cleanup-series-header'),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Flexible(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      libraryCleanupSeriesChip(context, series, widget.isKept),
                      key: const Key('cleanup-series-chip'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.labelMedium?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
                    ),
                  ),
                ),
                if (widget.decision != null) ...[
                  const SizedBox(width: 8),
                  _DecisionChip(decision: widget.decision!, duplicates: widget.duplicates),
                ],
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
              onShow: _show,
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
    required this.onShow,
  });

  final LibraryCleanupSeries series;
  final int shown;
  final bool duplicates;
  final bool Function(String frameId) isKept;
  final ValueChanged<int> onShow;

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
                        _Thumb(asset: asset, kept: isKept(asset.id), onTap: () => onShow(index)),
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

String _decisionLabel(BuildContext context, LibraryCleanupSeriesDecision decision) => switch (decision) {
  LibraryCleanupSeriesDecision.asSet => context.t.cleanup_series_keep_as_set,
  LibraryCleanupSeriesDecision.trashAll => context.t.cleanup_series_trash_all,
  LibraryCleanupSeriesDecision.keepAll || LibraryCleanupSeriesDecision.dismiss => context.t.cleanup_keep_all,
  LibraryCleanupSeriesDecision.stack => context.t.cleanup_stack_instead,
};

Color _decisionColor(LibraryCleanupSeriesDecision decision) => switch (decision) {
  LibraryCleanupSeriesDecision.trashAll => libraryCleanupTrashColor,
  LibraryCleanupSeriesDecision.stack => const Color(0xFF6C8CFF),
  _ => libraryCleanupKeepColor,
};

/// A drag's stamp on the big frame, as the photo deck's stamps.
class _Stamp extends StatelessWidget {
  const _Stamp({required this.decision, required this.duplicates});

  final LibraryCleanupSeriesDecision decision;
  final bool duplicates;

  @override
  Widget build(BuildContext context) {
    final color = _decisionColor(decision);
    return Transform.rotate(
      angle: -0.12,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          border: Border.all(color: color, width: 3),
          borderRadius: BorderRadius.circular(10),
          color: Colors.black.withValues(alpha: 0.35),
        ),
        child: Text(
          _decisionLabel(context, decision).toUpperCase(),
          style: TextStyle(color: color, fontSize: 22, fontWeight: FontWeight.w900),
        ),
      ),
    );
  }
}

class _DecisionChip extends StatelessWidget {
  const _DecisionChip({required this.decision, required this.duplicates});

  final LibraryCleanupSeriesDecision decision;
  final bool duplicates;

  @override
  Widget build(BuildContext context) => GalleryPop(
    onMount: true,
    child: Container(
      key: Key('cleanup-series-decision-${decision.name}'),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: _decisionColor(decision), borderRadius: BorderRadius.circular(999)),
      child: Text(
        _decisionLabel(context, decision),
        style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The deck
// ---------------------------------------------------------------------------------------------------------------------

/// What the deck and the list need from the session.
class LibraryCleanupSeriesActions {
  const LibraryCleanupSeriesActions({
    required this.decide,
    required this.flip,
    required this.undo,
    required this.details,
  });

  /// Decides a series; false when the decision is refused (a duplicate group that would lose every copy).
  final bool Function(String seriesId, LibraryCleanupSeriesDecision decision) decide;
  final void Function(String seriesId, String frameId) flip;
  final VoidCallback undo;
  final void Function(LibraryCleanupSeries series, CleanupAssetDto frame) details;
}

class _Flight {
  _Flight({
    required this.series,
    required this.decision,
    required this.from,
    required this.to,
    required this.controller,
  });

  final LibraryCleanupSeries series;
  final LibraryCleanupSeriesDecision decision;
  final Offset from;
  final Offset to;
  final AnimationController controller;
}

/// The series deck: the current series on top, the next behind it. Swipes on the card outside the big frame decide the
/// whole series (right: as set; left: trash all for a burst, refused for duplicates; up: keep all or "not duplicates"),
/// and the buttons under it do the same. Only the top and next series are built, so a series' previews load when it is
/// next or on top.
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
  LibraryCleanupSeriesDecision? _armed;

  /// A refused decision (every copy trashed) shows "Keep at least one copy" for a moment.
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

  LibraryCleanupSeriesDecision? _decisionAt(Offset offset) {
    if (_size.isEmpty) {
      return null;
    }
    if (offset.dy < -_size.height * _upThreshold && -offset.dy > offset.dx.abs()) {
      return _upDecision(_duplicates);
    }
    if (offset.dx.abs() > _size.width * _horizontalThreshold && offset.dx.abs() >= -offset.dy) {
      return offset.dx > 0 ? LibraryCleanupSeriesDecision.asSet : LibraryCleanupSeriesDecision.trashAll;
    }
    return null;
  }

  /// Whether the top series may take [decision]: duplicates never trash every copy.
  bool _allowed(LibraryCleanupSeriesDecision decision) {
    final top = _top;
    if (top == null) {
      return false;
    }
    if (_duplicates && decision == LibraryCleanupSeriesDecision.trashAll) {
      return false;
    }
    return decision != LibraryCleanupSeriesDecision.asSet || _state.canAcceptAsSet(top);
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
    // A direction the series may not take resists: the card follows a quarter of the finger (rubber band).
    final towards = _x.value + dx;
    final horizontal = towards.abs() >= -_y.value;
    if (horizontal &&
        ((towards < 0 && !_allowed(LibraryCleanupSeriesDecision.trashAll)) ||
            (towards > 0 && !_allowed(LibraryCleanupSeriesDecision.asSet)))) {
      dx *= 0.25;
    }
    _x.value += dx;
    _y.value += details.delta.dy;
    final armed = _decisionAt(_offset);
    final usable = armed != null && _allowed(armed) ? armed : null;
    if (usable != null && usable != _armed) {
      ref.read(hapticFeedbackProvider.notifier).selectionClick();
    }
    _armed = usable;
  }

  void _onPanEnd(DragEndDetails details) {
    final velocity = details.velocity.pixelsPerSecond;
    _armed = null;
    var decision = _decisionAt(_offset);
    if (decision == null) {
      if (velocity.dy < -_throwVelocity && -velocity.dy > velocity.dx.abs()) {
        decision = _upDecision(_duplicates);
      } else if (velocity.dx.abs() > _throwVelocity && velocity.dx.abs() > velocity.dy.abs()) {
        decision = velocity.dx > 0 ? LibraryCleanupSeriesDecision.asSet : LibraryCleanupSeriesDecision.trashAll;
      }
    }
    if (decision != null && !_allowed(decision)) {
      _refuse();
      decision = null;
    }
    if (decision == null) {
      _springBack(velocity);
    } else {
      _throw(decision, speed: velocity.distance);
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

  /// A button's decision: thrown as the swipe would be, or refused with the rubber band's message.
  void _press(LibraryCleanupSeriesDecision decision) {
    if (!_allowed(decision)) {
      _refuse();
      if (!GalleryMotion.reduced(context)) {
        // A small nudge in the refused direction, springing back.
        _x.value = _direction(decision).dx * -18;
        _springBack(Offset.zero);
      }
      return;
    }
    _throw(decision);
  }

  void _throw(LibraryCleanupSeriesDecision decision, {double speed = 0}) {
    final top = _top;
    if (top == null) {
      return;
    }
    if (!widget.actions.decide(top.id, decision)) {
      _refuse();
      _springBack(Offset.zero);
      return;
    }
    final reduced = GalleryMotion.reduced(context);
    final from = _offset;
    final direction = _direction(decision);
    final reach = _size.longestSide * 1.3;
    final to = reduced ? from : Offset(direction.dx * reach + from.dx * 0.2, direction.dy * reach + from.dy * 0.2);
    final distance = (to - from).distance;
    final millis = reduced
        ? GalleryMotion.quick.inMilliseconds
        : (distance / math.max(speed, 1800) * 1000).clamp(180, 340);
    final controller = AnimationController(
      vsync: this,
      duration: Duration(milliseconds: millis.round()),
    );
    final flight = _Flight(series: top, decision: decision, from: from, to: to, controller: controller);
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

  /// Undo: the series flies back in from where it left.
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
    final direction = _direction(decision);
    final reach = _size.longestSide * 1.3;
    final start = Offset(direction.dx * reach, direction.dy * reach);
    _x.value = start.dx;
    _y.value = start.dy;
    unawaited(_x.animateWith(SpringSimulation(GalleryMotion.gentle, start.dx, 0, 0)));
    unawaited(_y.animateWith(SpringSimulation(GalleryMotion.gentle, start.dy, 0, 0)));
  }

  Map<LibraryCleanupSeriesDecision, double> _stampsAt(Offset offset) {
    if (_size.isEmpty || offset == Offset.zero) {
      return const {};
    }
    final decision = _decisionAt(offset) ?? _leaning(offset);
    if (decision == null || !_allowed(decision)) {
      return const {};
    }
    final amount = _direction(decision).dy != 0
        ? -offset.dy / (_size.height * _upThreshold)
        : offset.dx.abs() / (_size.width * _horizontalThreshold);
    return {decision: amount.clamp(0.0, 1.0)};
  }

  LibraryCleanupSeriesDecision? _leaning(Offset offset) {
    if (-offset.dy > offset.dx.abs()) {
      return _upDecision(_duplicates);
    }
    if (offset.dx == 0) {
      return null;
    }
    return offset.dx > 0 ? LibraryCleanupSeriesDecision.asSet : LibraryCleanupSeriesDecision.trashAll;
  }

  Widget _card(LibraryCleanupSeries series, {bool top = false, Map<LibraryCleanupSeriesDecision, double>? stamps}) =>
      LibraryCleanupSeriesCard(
        key: ValueKey('series-${series.id}'),
        series: series,
        duplicates: _duplicates,
        isKept: (frameId) => _state.isKept(series, frameId),
        onFlip: top ? (frameId) => widget.actions.flip(series.id, frameId) : null,
        onDetails: top ? (frame) => widget.actions.details(series, frame) : null,
        stamps: stamps ?? const {},
        warning: top && _duplicates && (_refused || !_state.canAcceptAsSet(series)),
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
                                child: _card(top, top: true, stamps: _stampsAt(_offset)),
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
                            child: _card(flight.series, stamps: {flight.decision: 1}),
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
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _SeriesButton(
                  key: const Key('cleanup-series-undo'),
                  icon: Icons.undo_rounded,
                  label: t.undo,
                  small: true,
                  onPressed: _state.canUndo ? widget.actions.undo : null,
                ),
                _SeriesButton(
                  key: const Key('cleanup-series-trash-all'),
                  icon: Icons.close_rounded,
                  label: _duplicates ? t.cleanup_series_keep_one_copy : t.cleanup_series_trash_all,
                  color: _duplicates ? null : libraryCleanupTrashColor,
                  muted: _duplicates,
                  onPressed: top == null ? null : () => _press(LibraryCleanupSeriesDecision.trashAll),
                ),
                _SeriesButton(
                  key: const Key('cleanup-series-as-set'),
                  icon: Icons.check_rounded,
                  label: t.cleanup_series_keep_as_set,
                  color: libraryCleanupKeepColor,
                  onPressed: top == null || !_state.canAcceptAsSet(top)
                      ? null
                      : () => _press(LibraryCleanupSeriesDecision.asSet),
                ),
                _SeriesButton(
                  key: const Key('cleanup-series-keep-all'),
                  icon: Icons.done_all_rounded,
                  label: t.cleanup_keep_all,
                  color: libraryCleanupKeepColor,
                  onPressed: top == null ? null : () => _press(_upDecision(_duplicates)),
                ),
                if (!_duplicates)
                  _SeriesButton(
                    key: const Key('cleanup-series-stack'),
                    icon: Icons.layers_outlined,
                    label: t.cleanup_stack_instead,
                    small: true,
                    onPressed: top == null ? null : () => _press(LibraryCleanupSeriesDecision.stack),
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

class _SeriesButton extends StatelessWidget {
  const _SeriesButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onPressed,
    this.color,
    this.small = false,
    this.muted = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;
  final Color? color;
  final bool small;

  /// Looks unavailable but still answers a press (Duplicates' left action explains why it does nothing).
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final size = small ? 44.0 : 56.0;
    final foreground = onPressed == null || muted
        ? scheme.onSurface.withValues(alpha: 0.3)
        : (color ?? scheme.onSurface);
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
              child: SizedBox.square(
                dimension: size,
                child: Icon(icon, color: foreground, size: small ? 20 : 26),
              ),
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

/// Grid mode for the series queues: the series cards one under another, each with its actions, and "Keep the
/// suggestion for all" for the loaded series. Built lazily, so a series' previews load as it scrolls in.
class LibraryCleanupSeriesList extends StatelessWidget {
  const LibraryCleanupSeriesList({
    super.key,
    required this.state,
    required this.actions,
    required this.onKeepSuggestionForAll,
    this.onNearEnd,
  });

  final LibraryCleanupSeriesState state;
  final LibraryCleanupSeriesActions actions;
  final VoidCallback onKeepSuggestionForAll;
  final VoidCallback? onNearEnd;

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final duplicates = state.isDuplicates;
    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (notification.metrics.extentAfter < 800) {
          onNearEnd?.call();
        }
        return false;
      },
      child: ListView.separated(
        key: const Key('cleanup-series-list'),
        padding: const EdgeInsets.fromLTRB(14, 4, 14, 40),
        itemCount: state.series.length + 1,
        separatorBuilder: (_, _) => const SizedBox(height: 14),
        itemBuilder: (context, index) {
          if (index == 0) {
            return Align(
              alignment: AlignmentDirectional.centerStart,
              child: FilledButton.tonalIcon(
                key: const Key('cleanup-series-keep-suggestion-all'),
                onPressed: state.undecided.isEmpty ? null : onKeepSuggestionForAll,
                icon: const Icon(Icons.auto_awesome_rounded, size: 18),
                label: Text(t.cleanup_series_keep_suggestion_all),
              ),
            );
          }
          final series = state.series[index - 1];
          final decision = state.decisions[series.id];
          return Column(
            key: Key('cleanup-series-row-${series.id}'),
            mainAxisSize: MainAxisSize.min,
            children: [
              LibraryCleanupSeriesCard(
                series: series,
                duplicates: duplicates,
                isKept: (frameId) => state.willKeep(series, frameId),
                onFlip: (frameId) => actions.flip(series.id, frameId),
                onDetails: (frame) => actions.details(series, frame),
                frameHeight: 240,
                decision: decision,
                warning: duplicates && !state.canAcceptAsSet(series),
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                alignment: WrapAlignment.center,
                children: [
                  if (!duplicates)
                    _ListAction(
                      key: Key('cleanup-series-list-trash-all-${series.id}'),
                      label: t.cleanup_series_trash_all,
                      selected: decision == LibraryCleanupSeriesDecision.trashAll,
                      onPressed: () => actions.decide(series.id, LibraryCleanupSeriesDecision.trashAll),
                    ),
                  _ListAction(
                    key: Key('cleanup-series-list-as-set-${series.id}'),
                    label: t.cleanup_series_keep_as_set,
                    selected: decision == LibraryCleanupSeriesDecision.asSet,
                    onPressed: state.canAcceptAsSet(series)
                        ? () => actions.decide(series.id, LibraryCleanupSeriesDecision.asSet)
                        : null,
                  ),
                  _ListAction(
                    key: Key('cleanup-series-list-keep-all-${series.id}'),
                    label: t.cleanup_keep_all,
                    selected: decision == _upDecision(duplicates),
                    onPressed: () => actions.decide(series.id, _upDecision(duplicates)),
                  ),
                  if (!duplicates)
                    _ListAction(
                      key: Key('cleanup-series-list-stack-${series.id}'),
                      label: t.cleanup_stack_instead,
                      selected: decision == LibraryCleanupSeriesDecision.stack,
                      onPressed: () => actions.decide(series.id, LibraryCleanupSeriesDecision.stack),
                    ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}

class _ListAction extends StatelessWidget {
  const _ListAction({super.key, required this.label, required this.selected, required this.onPressed});

  final String label;
  final bool selected;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) =>
      ChoiceChip(label: Text(label), selected: selected, onSelected: onPressed == null ? null : (_) => onPressed!());
}
