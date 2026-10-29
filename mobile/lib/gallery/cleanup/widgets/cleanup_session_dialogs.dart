import 'dart:async';

import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck_card.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// What the user chose when closing a session with pending marks.
enum LibraryCleanupCloseChoice { apply, discard, keepGoing }

/// Asked when a session with pending marks is closed (‹, Android back): apply them and stop, discard them, or keep
/// going. Dismissing the dialog keeps going.
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

/// The first session's short lesson, over the first card: a hand shows right = keep, left = trash, up = favourite, and
/// one line says nothing is deleted until Done. A tap anywhere closes it.
class LibraryCleanupGestureOverlay extends StatefulWidget {
  const LibraryCleanupGestureOverlay({super.key, required this.onDismiss});

  final VoidCallback onDismiss;

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

  Offset _handAt(double t) {
    // Six legs of the loop; each eases out and back.
    final leg = (t * 6).floor().clamp(0, 5);
    final local = GalleryMotion.standard.transform(t * 6 - leg);
    const reach = 70.0;
    final target = switch (leg ~/ 2) {
      0 => const Offset(reach, 0),
      1 => const Offset(-reach, 0),
      _ => const Offset(0, -reach),
    };
    return leg.isEven ? target * local : target * (1 - local);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.t;
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
              Text('↑  ${t.favorite}', style: label.copyWith(color: libraryCleanupFavoriteColor)),
              const SizedBox(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('${t.trash}  ←', style: label.copyWith(color: libraryCleanupTrashColor)),
                  SizedBox(
                    width: 150,
                    height: 120,
                    child: AnimatedBuilder(
                      animation: _hand,
                      builder: (context, child) => Transform.translate(offset: _handAt(_hand.value), child: child),
                      child: const Icon(Icons.touch_app_rounded, size: 56, color: Colors.white),
                    ),
                  ),
                  Text('→  ${t.keep}', style: label.copyWith(color: libraryCleanupKeepColor)),
                ],
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
