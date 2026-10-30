import 'package:flutter/widgets.dart';
import 'package:immich_mobile/gallery/motion/flight.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';

// Swipe ↔ Grid in every cleanup (specs/2026-10-29-mobile-library-cleanup-design.md, "Motion" → "Swipe ↔ Grid"): the
// current card shrinks into its tile, the other tiles settle in on a short stagger, and Grid → Swipe grows the first
// undecided tile back into the card. Reduced motion: a crossfade, nothing flies. The rewind, the photo queues and the
// series queues all switch through this one mixin, so the motion cannot drift apart between them.

/// A grid the deck's card can land in: it can say where a photo's tile is and bring one into view.
abstract interface class LibraryCleanupFlightGrid {
  /// Where [id]'s tile is on screen (global), if it is laid out.
  Rect? tileRect(String id);

  /// Scrolls [id]'s tile into view at once.
  void reveal(String id);
}

/// Where the first widget keyed with one of [keys] under [context] is on screen (global), if it is laid out.
Rect? libraryCleanupRectOf(BuildContext context, Set<Key> keys) {
  RenderBox? found;
  void visit(Element element) {
    if (found != null) {
      return;
    }
    final box = element.renderObject;
    if (keys.contains(element.widget.key) && box is RenderBox && box.attached && box.hasSize) {
      found = box;
      return;
    }
    element.visitChildElements(visit);
  }

  if (context.mounted) {
    (context as Element).visitChildElements(visit);
  }
  final box = found;
  return box == null ? null : box.localToGlobal(Offset.zero) & box.size;
}

/// The page side of the switch: holds the grid's key, the tile a card is landing in ([landingId], kept empty until it
/// lands) and whether the grid plays its entrance ([gridEntrance]).
mixin LibraryCleanupViewFlight<T extends StatefulWidget> on State<T> {
  /// A new key each time the grid is shown, so a grid still fading out never shares one with the grid fading in.
  GlobalKey gridKey = GlobalKey();
  String? landingId;
  bool gridEntrance = false;

  LibraryCleanupFlightGrid? get _grid => switch (gridKey.currentState) {
    final LibraryCleanupFlightGrid grid => grid,
    _ => null,
  };

  void _afterLayout(VoidCallback callback) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        callback();
      }
    });
    WidgetsBinding.instance.scheduleFrame();
  }

  /// Switches the view with [commit] (which saves the choice and rebuilds) and flies [id] between its card and its tile.
  /// [cardRect] finds the deck's card for an id; [picture] is what flies.
  void switchViewWithFlight({
    required bool toGrid,
    required String? id,
    required Rect? Function(String id) cardRect,
    required Widget Function(String id) picture,
    required VoidCallback commit,
    double cardRadius = 0,
    double tileRadius = 0,
  }) {
    final reduced = GalleryMotion.reduced(context);
    void fly(String id, Rect from, Rect to, double fromRadius, double toRadius) => GalleryFlight.fly(
      from: from,
      to: to,
      fromRadius: fromRadius,
      toRadius: toRadius,
      child: picture(id),
      onLand: () {
        if (mounted && landingId == id) {
          setState(() => landingId = null);
        }
      },
    );

    if (toGrid) {
      final from = id == null || reduced ? null : cardRect(id);
      setState(() {
        gridKey = GlobalKey();
        gridEntrance = !reduced;
        landingId = from == null ? null : id;
      });
      commit();
      if (id == null) {
        return;
      }
      _afterLayout(() {
        _grid?.reveal(id);
        _afterLayout(() {
          final to = _grid?.tileRect(id);
          if (from == null || to == null) {
            setState(() => landingId = null);
            return;
          }
          fly(id, from, to, cardRadius, tileRadius);
        });
      });
    } else {
      final from = id == null || reduced ? null : _grid?.tileRect(id);
      setState(() {
        gridEntrance = false;
        landingId = null;
      });
      commit();
      if (from == null || id == null) {
        return;
      }
      _afterLayout(() {
        final to = cardRect(id);
        if (to != null) {
          fly(id, from, to, tileRadius, cardRadius);
        }
      });
    }
  }
}
