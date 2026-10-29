import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_session_state.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck_card.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/gallery/motion/celebrate.dart';
import 'package:immich_mobile/gallery/motion/entrance.dart';
import 'package:immich_mobile/gallery/motion/gallery_tile.dart';
import 'package:immich_mobile/gallery/motion/motion_host.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/pop.dart';
import 'package:immich_mobile/gallery/motion/spring_curve.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/haptic_feedback.provider.dart';
import 'package:immich_mobile/utils/bytes_units.dart';
import 'package:openapi/api.dart';

// The end of a session (specs/2026-10-29-mobile-library-cleanup-design.md, "Rewind" → "Finishing at any point", and
// "Celebrating a finished day"; mockup `5-grid-and-finish.html`, right): what was marked, how far the user got, and the
// ways to finish. Then, once a day is finished, the celebration.

/// What the finish screen sums up.
class LibraryCleanupFinishSummary {
  const LibraryCleanupFinishSummary({
    required this.decided,
    required this.total,
    required this.kept,
    required this.favorites,
    required this.trash,
  });

  final int decided;
  final int total;
  final int kept;
  final int favorites;

  /// The photos marked for trash, in deck order.
  final List<CleanupAssetDto> trash;

  bool get allDecided => decided >= total;
  int get trashBytes => trash.fold(0, (sum, asset) => sum + asset.fileSize.round());
}

/// The finish screen: the counts, "16 of 42 gone through" while unfinished, and the actions.
class LibraryCleanupFinishView extends StatefulWidget {
  const LibraryCleanupFinishView({
    super.key,
    required this.title,
    required this.summary,
    required this.applying,
    required this.onApplyAndStop,
    required this.onKeepTheRest,
    required this.onFinish,
    required this.onKeepGoing,
    required this.onRescue,
    this.trashIconKey,
  });

  final String title;
  final LibraryCleanupFinishSummary summary;
  final LibraryCleanupApplyProgress? applying;

  /// Unfinished: commit what was marked, the day stays open.
  final VoidCallback onApplyAndStop;

  /// Unfinished: keep every untouched photo and finish the day.
  final VoidCallback onKeepTheRest;

  /// Every photo decided: commit and finish.
  final VoidCallback onFinish;
  final VoidCallback onKeepGoing;

  /// "Review the N first": a tap takes a photo off the trash pile.
  final ValueChanged<CleanupAssetDto> onRescue;

  /// On the trash count's icon, where the trashed photos fly when the day finishes.
  final Key? trashIconKey;

  @override
  State<LibraryCleanupFinishView> createState() => _LibraryCleanupFinishViewState();
}

class _LibraryCleanupFinishViewState extends State<LibraryCleanupFinishView> {
  bool _reviewing = false;

  @override
  void didUpdateWidget(LibraryCleanupFinishView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.summary.trash.isEmpty) {
      _reviewing = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final theme = Theme.of(context);
    final summary = widget.summary;
    final busy = widget.applying != null;
    final reduced = GalleryMotion.reduced(context);
    final trashCount = summary.trash.length;

    Widget rise(int step, Widget child) =>
        GalleryEntrance(delay: const Duration(milliseconds: 50) * step, enabled: !reduced, child: child);

    if (_reviewing) {
      return _Review(
        trash: summary.trash,
        onRescue: widget.onRescue,
        onClose: () => setState(() => _reviewing = false),
      );
    }

    final applying = widget.applying;
    return ListView(
      key: const Key('cleanup-finish'),
      padding: EdgeInsets.fromLTRB(20, 24, 20, 24 + MediaQuery.paddingOf(context).bottom),
      children: [
        rise(0, Text(widget.title, textAlign: TextAlign.center, style: theme.textTheme.headlineSmall)),
        if (!summary.allDecided)
          rise(
            0,
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                t.cleanup_finish_gone_through(done: summary.decided, total: summary.total),
                key: const Key('cleanup-finish-gone-through'),
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ),
          ),
        const SizedBox(height: 20),
        rise(
          1,
          Row(
            children: [
              _Stat(
                label: t.cleanup_day_done_kept,
                value: summary.kept,
                color: libraryCleanupKeepColor,
                keyName: 'kept',
              ),
              const SizedBox(width: 8),
              _Stat(
                label: t.favorites,
                value: summary.favorites,
                color: libraryCleanupFavoriteColor,
                keyName: 'favorites',
              ),
              const SizedBox(width: 8),
              _Stat(
                label: t.cleanup_finish_to_trash,
                value: trashCount,
                color: libraryCleanupTrashColor,
                keyName: 'trash',
                detail: trashCount > 0 ? formatBytes(summary.trashBytes) : null,
                iconKey: widget.trashIconKey,
              ),
            ],
          ),
        ),
        if (trashCount > 0) ...[const SizedBox(height: 14), rise(2, _TrashStrip(trash: summary.trash))],
        const SizedBox(height: 22),
        if (applying != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Column(
              children: [
                LinearProgressIndicator(value: applying.total == 0 ? null : applying.done / applying.total),
                const SizedBox(height: 6),
                Text(
                  t.cleanup_finish_applying(done: applying.done, total: math.max(applying.total, 1)),
                  key: const Key('cleanup-finish-applying'),
                ),
              ],
            ),
          ),
        if (summary.allDecided)
          rise(
            3,
            FilledButton(
              key: const Key('cleanup-finish-day'),
              onPressed: busy ? null : widget.onFinish,
              child: Text(trashCount > 0 ? t.cleanup_finish_move_and_finish(count: trashCount) : t.cleanup_finish_day),
            ),
          )
        else ...[
          rise(
            3,
            FilledButton(
              key: const Key('cleanup-finish-apply-and-stop'),
              onPressed: busy || (summary.kept + summary.favorites + trashCount == 0) ? null : widget.onApplyAndStop,
              child: Text(t.cleanup_finish_apply_and_stop),
            ),
          ),
          const SizedBox(height: 8),
          rise(
            4,
            OutlinedButton(
              key: const Key('cleanup-finish-keep-rest'),
              onPressed: busy ? null : widget.onKeepTheRest,
              child: Text(t.cleanup_finish_keep_rest),
            ),
          ),
        ],
        if (trashCount > 0) ...[
          const SizedBox(height: 8),
          rise(
            5,
            TextButton(
              key: const Key('cleanup-finish-review'),
              onPressed: busy ? null : () => setState(() => _reviewing = true),
              child: Text(t.cleanup_finish_review_first(count: trashCount)),
            ),
          ),
        ],
        rise(
          6,
          TextButton(
            key: const Key('cleanup-finish-keep-going'),
            onPressed: busy ? null : widget.onKeepGoing,
            child: Text(t.cleanup_finish_keep_going),
          ),
        ),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({
    required this.label,
    required this.value,
    required this.color,
    required this.keyName,
    this.detail,
    this.iconKey,
  });

  final String label;
  final int value;
  final Color color;
  final String keyName;
  final String? detail;
  final Key? iconKey;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
        decoration: BoxDecoration(color: theme.colorScheme.surfaceContainer, borderRadius: BorderRadius.circular(14)),
        child: Column(
          children: [
            if (iconKey != null) Icon(Icons.delete_outline_rounded, key: iconKey, size: 16, color: color),
            Text(
              '$value',
              key: Key('cleanup-finish-$keyName'),
              style: theme.textTheme.titleLarge?.copyWith(color: color, fontWeight: FontWeight.w700),
            ),
            Text(label, style: theme.textTheme.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
            if (detail != null) Text(detail!, style: theme.textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}

/// The trash pile as small thumbnails, which lift off and fly away when the marks are applied.
class _TrashStrip extends StatelessWidget {
  const _TrashStrip({required this.trash});

  final List<CleanupAssetDto> trash;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 52,
    child: ListView.separated(
      scrollDirection: Axis.horizontal,
      itemCount: trash.length,
      separatorBuilder: (_, _) => const SizedBox(width: 6),
      itemBuilder: (context, index) => ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: SizedBox.square(
          dimension: 52,
          child: GalleryTile(
            remoteId: trash[index].id,
            child: Image(
              image: libraryCleanupThumbnail(trash[index]),
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => const ColoredBox(color: Colors.black26),
            ),
          ),
        ),
      ),
    ),
  );
}

/// "Review the N first": only the photos marked for trash; a tap keeps one instead.
class _Review extends StatelessWidget {
  const _Review({required this.trash, required this.onRescue, required this.onClose});

  final List<CleanupAssetDto> trash;
  final ValueChanged<CleanupAssetDto> onRescue;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      key: const Key('cleanup-finish-review-grid'),
      children: [
        ListTile(
          leading: IconButton(
            key: const Key('cleanup-review-close'),
            icon: const Icon(Icons.arrow_back),
            onPressed: onClose,
          ),
          title: Text(context.t.cleanup_finish_review_first(count: trash.length)),
          subtitle: Text(context.t.cleanup_finish_review_hint),
        ),
        Expanded(
          child: GridView.builder(
            padding: const EdgeInsets.all(8),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 3,
              crossAxisSpacing: 4,
              mainAxisSpacing: 4,
            ),
            itemCount: trash.length,
            itemBuilder: (context, index) {
              final asset = trash[index];
              return GestureDetector(
                key: Key('cleanup-review-${asset.id}'),
                onTap: () => onRescue(asset),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      ColorFiltered(
                        colorFilter: const ColorFilter.matrix([
                          0.33, 0.33, 0.33, 0, 0, //
                          0.33, 0.33, 0.33, 0, 0,
                          0.33, 0.33, 0.33, 0, 0,
                          0, 0, 0, 1, 0,
                        ]),
                        child: Image(
                          image: libraryCleanupThumbnail(asset),
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => ColoredBox(color: theme.colorScheme.surfaceContainerHighest),
                        ),
                      ),
                      Positioned(
                        left: 4,
                        bottom: 4,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                          decoration: BoxDecoration(
                            color: libraryCleanupTrashColor,
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(context.t.trash, style: const TextStyle(color: Colors.white, fontSize: 10)),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

/// What a finished day shows.
class LibraryCleanupDayDoneData {
  const LibraryCleanupDayDoneData({
    required this.date,
    required this.kept,
    required this.favorites,
    required this.trashed,
    required this.freedBytes,
    required this.streakBefore,
    this.nextLabel,
  });

  final String date;
  final int kept;
  final int favorites;
  final int trashed;
  final int freedBytes;
  final int streakBefore;

  /// "Next day: April 11", or null when every day is done.
  final String? nextLabel;
}

/// A finished day, celebrated once (only after the user pressed finish, never for "Apply and stop"):
///
/// 1. The trashed photos fly into the trash (started by the page, from the finish screen's strip, as this replaces it).
/// 2. The ring fills on the gentle spring while the counts count up.
/// 3. As the ring closes: a success haptic and confetti from its centre.
/// 4. The streak line pops and its number ticks up.
/// 5. The Next and Back buttons rise in last.
///
/// With [celebrate] false (a day finished again, or this screen shown a second time) or reduced motion, it shows the
/// end state: the ring and counts filled, no confetti. Reduced motion still plays the haptic.
class LibraryCleanupDayDone extends ConsumerStatefulWidget {
  const LibraryCleanupDayDone({
    super.key,
    required this.data,
    required this.streak,
    required this.celebrate,
    required this.onHub,
    this.onNext,
  });

  final LibraryCleanupDayDoneData data;

  /// The streak once the server has counted this day (it arrives with the calendar).
  final int streak;
  final bool celebrate;
  final VoidCallback onHub;
  final VoidCallback? onNext;

  /// How long the ring takes to fill (the gentle spring's shape, slowed to read as a fill).
  static const ringDuration = Duration(milliseconds: 1500);

  /// After the ring closes: the streak pops, then the buttons rise.
  static const streakDelay = Duration(milliseconds: 120);
  static const buttonsDelay = Duration(milliseconds: 280);

  @override
  ConsumerState<LibraryCleanupDayDone> createState() => _LibraryCleanupDayDoneState();
}

class _LibraryCleanupDayDoneState extends ConsumerState<LibraryCleanupDayDone> with SingleTickerProviderStateMixin {
  static final _spring = GallerySpringCurve(GalleryMotion.gentle);
  late final AnimationController _ring = AnimationController(vsync: this, duration: LibraryCleanupDayDone.ringDuration);
  final _ringKey = GlobalKey();
  bool _closed = false;
  bool _streakShown = false;
  bool _buttonsShown = false;
  bool _started = false;
  final List<Timer> _timers = [];

  bool get _animated => widget.celebrate && !GalleryMotion.reduced(context);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    if (!_animated) {
      _ring.value = 1;
      _closed = _streakShown = _buttonsShown = true;
      if (widget.celebrate) {
        // Reduced motion: the end state, and the haptic.
        ref.read(hapticFeedbackProvider.notifier).mediumImpact();
      }
      return;
    }
    _ring.addListener(_onRing);
    unawaited(_ring.forward());
  }

  void _onRing() {
    if (_closed || _spring.transform(_ring.value) < 0.999) {
      return;
    }
    _closed = true;
    ref.read(hapticFeedbackProvider.notifier).mediumImpact();
    final box = _ringKey.currentContext?.findRenderObject();
    final overlay = GalleryMotionHost.overlayBox;
    final origin = box is RenderBox && box.hasSize && overlay != null
        ? overlay.globalToLocal(box.localToGlobal(box.size.center(Offset.zero)))
        : null;
    GalleryCelebrate.dayComplete(
      origin: origin,
      colors: [
        Theme.of(context).colorScheme.primary,
        libraryCleanupKeepColor,
        libraryCleanupFavoriteColor,
        libraryCleanupTrashColor,
      ],
    );
    _timers
      ..add(Timer(LibraryCleanupDayDone.streakDelay, () => _set(() => _streakShown = true)))
      ..add(Timer(LibraryCleanupDayDone.buttonsDelay, () => _set(() => _buttonsShown = true)));
  }

  void _set(VoidCallback change) {
    if (mounted) {
      setState(change);
    }
  }

  @override
  void dispose() {
    for (final timer in _timers) {
      timer.cancel();
    }
    _ring.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final theme = Theme.of(context);
    final data = widget.data;
    final animated = _animated;

    Widget count(int value, String key, TextStyle? style) => animated
        ? LibraryCleanupCountUp(
            value: value,
            builder: (context, shown) => Text('$shown', key: Key(key), style: style),
          )
        : Text('$value', key: Key(key), style: style);

    final stat = theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700);
    return ListView(
      key: const Key('cleanup-day-done'),
      padding: EdgeInsets.fromLTRB(20, 40, 20, 24 + MediaQuery.paddingOf(context).bottom),
      children: [
        Center(
          child: SizedBox.square(
            key: _ringKey,
            dimension: 112,
            child: AnimatedBuilder(
              animation: _ring,
              builder: (context, _) {
                final fill = animated ? _spring.transform(_ring.value) : 1.0;
                return CustomPaint(
                  key: const Key('cleanup-day-done-ring'),
                  painter: _RingPainter(
                    fill: fill,
                    color: libraryCleanupKeepColor,
                    track: theme.colorScheme.surfaceContainerHighest,
                  ),
                  child: Center(
                    child: Opacity(
                      opacity: fill.clamp(0.0, 1.0),
                      child: const Icon(Icons.check_rounded, size: 46, color: libraryCleanupKeepColor),
                    ),
                  ),
                );
              },
            ),
          ),
        ),
        const SizedBox(height: 18),
        Text(
          t.cleanup_day_done_title(date: data.date),
          key: const Key('cleanup-day-done-title'),
          textAlign: TextAlign.center,
          style: theme.textTheme.headlineSmall,
        ),
        const SizedBox(height: 18),
        Row(
          children: [
            _DoneStat(label: t.cleanup_day_done_kept, child: count(data.kept, 'cleanup-day-done-kept', stat)),
            const SizedBox(width: 8),
            _DoneStat(
              label: t.favorites,
              child: count(
                data.favorites,
                'cleanup-day-done-favorites',
                stat?.copyWith(color: libraryCleanupFavoriteColor),
              ),
            ),
            const SizedBox(width: 8),
            _DoneStat(
              label: t.cleanup_day_done_trashed,
              child: count(data.trashed, 'cleanup-day-done-trashed', stat?.copyWith(color: libraryCleanupTrashColor)),
            ),
          ],
        ),
        if (data.freedBytes > 0)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Text(
              libraryCleanupMessage(context, 'cleanup_day_done_freed', {'size': formatBytes(data.freedBytes)}),
              key: const Key('cleanup-day-done-freed'),
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium,
            ),
          ),
        const SizedBox(height: 10),
        SizedBox(
          height: 28,
          child: !_streakShown || widget.streak <= 0
              ? null
              : GalleryPop(
                  onMount: animated,
                  child: TweenAnimationBuilder<double>(
                    tween: Tween(
                      begin: animated ? data.streakBefore.toDouble() : widget.streak.toDouble(),
                      end: widget.streak.toDouble(),
                    ),
                    duration: animated ? GalleryMotion.slow : Duration.zero,
                    builder: (context, shown, _) => Text(
                      '🔥 ${t.cleanup_streak(count: shown.round())}',
                      key: const Key('cleanup-day-done-streak'),
                      textAlign: TextAlign.center,
                      style: theme.textTheme.titleSmall,
                    ),
                  ),
                ),
        ),
        const SizedBox(height: 18),
        if (_buttonsShown) ...[
          if (widget.onNext != null && data.nextLabel != null)
            GalleryEntrance(
              enabled: animated,
              child: FilledButton.icon(
                key: const Key('cleanup-day-done-next'),
                onPressed: widget.onNext,
                icon: const Icon(Icons.arrow_forward_rounded),
                label: Text(data.nextLabel!),
              ),
            ),
          const SizedBox(height: 8),
          GalleryEntrance(
            enabled: animated,
            delay: const Duration(milliseconds: 70),
            child: OutlinedButton(
              key: const Key('cleanup-day-done-hub'),
              onPressed: widget.onHub,
              child: Text(t.cleanup_day_done_hub),
            ),
          ),
        ],
      ],
    );
  }
}

class _DoneStat extends StatelessWidget {
  const _DoneStat({required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(color: theme.colorScheme.surfaceContainer, borderRadius: BorderRadius.circular(14)),
        child: Column(
          children: [
            child,
            Text(label, style: theme.textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter({required this.fill, required this.color, required this.track});

  final double fill;
  final Color color;
  final Color track;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = (Offset.zero & size).deflate(5);
    canvas
      ..drawCircle(rect.center, rect.width / 2, Paint()..color = color.withValues(alpha: 0.12))
      ..drawArc(
        rect,
        0,
        2 * math.pi,
        false,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 7
          ..color = track,
      )
      ..drawArc(
        rect,
        -math.pi / 2,
        2 * math.pi * fill.clamp(0.0, 1.0),
        false,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeCap = StrokeCap.round
          ..strokeWidth = 7
          ..color = color,
      );
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.fill != fill || old.color != color || old.track != track;
}
