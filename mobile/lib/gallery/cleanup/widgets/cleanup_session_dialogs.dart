import 'dart:async';

import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck_card.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// What the user chose when closing a session with pending marks.
enum LibraryCleanupCloseChoice { apply, discard, keepGoing }

/// Asked when a session with pending marks is closed (‹, Android back, the iOS back swipe): apply them and stop,
/// discard them, or keep going. Dismissing the dialog keeps going.
Future<LibraryCleanupCloseChoice> showLibraryCleanupCloseGuard(
  BuildContext context, {
  required int pending,
  required String applyLabel,
}) async {
  final choice = await showDialog<LibraryCleanupCloseChoice>(
    context: context,
    builder: (context) => AlertDialog(
      key: const Key('cleanup-close-guard'),
      title: Text(context.t.cleanup_close_title(count: pending)),
      content: Text(context.t.cleanup_close_body),
      actionsOverflowDirection: VerticalDirection.up,
      actions: [
        TextButton(
          key: const Key('cleanup-close-keep-going'),
          onPressed: () => Navigator.of(context).pop(LibraryCleanupCloseChoice.keepGoing),
          child: Text(context.t.cleanup_finish_keep_going),
        ),
        TextButton(
          key: const Key('cleanup-close-discard'),
          style: TextButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error),
          onPressed: () => Navigator.of(context).pop(LibraryCleanupCloseChoice.discard),
          child: Text(context.t.cleanup_close_discard),
        ),
        FilledButton(
          key: const Key('cleanup-close-apply'),
          onPressed: () => Navigator.of(context).pop(LibraryCleanupCloseChoice.apply),
          child: Text(applyLabel),
        ),
      ],
    ),
  );
  return choice ?? LibraryCleanupCloseChoice.keepGoing;
}

/// What each swipe does, as the gesture overlay teaches it.
class LibraryCleanupGestures {
  const LibraryCleanupGestures({
    required this.right,
    required this.left,
    this.up,
    this.upColor,
    this.leftRefused = false,
    this.hint,
  });

  /// The photo decks: right keep, left trash, up favourite.
  factory LibraryCleanupGestures.photos(BuildContext context) =>
      LibraryCleanupGestures(right: context.t.keep, left: context.t.trash, up: context.t.favorite);

  /// The series card (Bursts and Duplicates): tapping frames chooses, right does what the button says, left skips, and
  /// up stacks a burst (a duplicate group has no swipe up). [hint] says how the frames are chosen.
  factory LibraryCleanupGestures.series(BuildContext context, {required bool duplicates}) => LibraryCleanupGestures(
    right: context.t.cleanup_series_lesson_right,
    left: context.t.skip,
    up: duplicates ? null : context.t.stack,
    upColor: libraryCleanupStackColor,
    hint: context.t.cleanup_series_frames_hint,
  );

  final String right;
  final String left;

  /// Null: no swipe up, so the lesson shows none.
  final String? up;

  /// The up label's colour; null: favourite's.
  final Color? upColor;

  /// Left decides nothing here: the hand only nudges that way and springs back, and the label is muted.
  final bool leftRefused;
  final String? hint;
}

/// The first session's short lesson, over the first card: a hand shows what right, left and up do ([gestures]: keep,
/// trash and favourite on a photo deck, the series card's own on Bursts and Duplicates), and one line says nothing is
/// deleted until Done. A tap anywhere closes it.
class LibraryCleanupGestureOverlay extends StatefulWidget {
  const LibraryCleanupGestureOverlay({super.key, required this.onDismiss, this.gestures});

  final VoidCallback onDismiss;

  /// Null: the photo decks' gestures.
  final LibraryCleanupGestures? gestures;

  @override
  State<LibraryCleanupGestureOverlay> createState() => _LibraryCleanupGestureOverlayState();
}

class _LibraryCleanupGestureOverlayState extends State<LibraryCleanupGestureOverlay>
    with SingleTickerProviderStateMixin {
  /// One loop: right, back, left, back, up, back.
  late final AnimationController _hand = AnimationController(vsync: this, duration: const Duration(milliseconds: 3600));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (GalleryMotion.reduced(context)) {
      _hand
        ..stop()
        ..value = 0;
    } else if (!_hand.isAnimating) {
      unawaited(_hand.repeat());
    }
  }

  @override
  void dispose() {
    _hand.dispose();
    super.dispose();
  }

  Offset _handAt(double t, {required bool leftRefused, required bool up}) {
    // Six legs of the loop (four with no swipe up); each eases out and back.
    final legs = up ? 6 : 4;
    final leg = (t * legs).floor().clamp(0, legs - 1);
    final local = GalleryMotion.standard.transform(t * legs - leg);
    const reach = 70.0;
    final target = switch (leg ~/ 2) {
      0 => const Offset(reach, 0),
      // A refused left only nudges, as the card's rubber band does.
      1 => Offset(leftRefused ? -reach * 0.25 : -reach, 0),
      _ => const Offset(0, -reach),
    };
    return leg.isEven ? target * local : target * (1 - local);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final gestures = widget.gestures ?? LibraryCleanupGestures.photos(context);
    const label = TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w600);
    return GestureDetector(
      key: const Key('cleanup-gesture-overlay'),
      behavior: HitTestBehavior.opaque,
      onTap: widget.onDismiss,
      child: ColoredBox(
        color: Colors.black.withValues(alpha: 0.62),
        child: SafeArea(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (gestures.up != null) ...[
                Text(
                  '↑  ${gestures.up}',
                  key: const Key('cleanup-gesture-up'),
                  style: label.copyWith(color: gestures.upColor ?? libraryCleanupFavoriteColor),
                ),
                const SizedBox(height: 20),
              ],
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Flexible(
                    child: Text(
                      gestures.leftRefused ? '${gestures.left}  ✕' : '${gestures.left}  ←',
                      key: const Key('cleanup-gesture-left'),
                      textAlign: TextAlign.end,
                      style: label.copyWith(color: gestures.leftRefused ? Colors.white70 : libraryCleanupTrashColor),
                    ),
                  ),
                  SizedBox(
                    width: 150,
                    height: 120,
                    child: AnimatedBuilder(
                      animation: _hand,
                      builder: (context, child) => Transform.translate(
                        offset: _handAt(_hand.value, leftRefused: gestures.leftRefused, up: gestures.up != null),
                        child: child,
                      ),
                      child: const Icon(Icons.touch_app_rounded, size: 56, color: Colors.white),
                    ),
                  ),
                  Flexible(
                    child: Text(
                      '→  ${gestures.right}',
                      key: const Key('cleanup-gesture-right'),
                      style: label.copyWith(color: libraryCleanupKeepColor),
                    ),
                  ),
                ],
              ),
              if (gestures.hint != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(32, 24, 32, 0),
                  child: Text(
                    gestures.hint!,
                    key: const Key('cleanup-gesture-hint'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                  ),
                ),
              const SizedBox(height: 28),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 32),
                child: Text(
                  t.cleanup_overlay_nothing_deleted,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontSize: 16),
                ),
              ),
              const SizedBox(height: 18),
              FilledButton.tonal(
                key: const Key('cleanup-gesture-overlay-ok'),
                onPressed: widget.onDismiss,
                child: Text(t.cleanup_overlay_got_it),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
