import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';

/// Where app-wide motion (bursts, throws) is drawn, and where the user last touched the screen.
///
/// The app shell attaches the root overlay once it is on screen, so effects triggered from services
/// and actions need no `BuildContext` of their own. Effects start or end at the last pointer press,
/// so a favourite bursts from the heart that was tapped and trashed photos fly into the button that
/// trashed them (web's rule 3, "start from the user").
abstract final class GalleryMotionHost {
  static OverlayState? _overlay;
  static Offset? _lastPointerDown;
  static bool _tracking = false;

  /// Registers [overlay] as the drawing surface and starts following pointer presses.
  static void attach(OverlayState overlay) {
    _overlay = overlay;
    if (!_tracking) {
      GestureBinding.instance.pointerRouter.addGlobalRoute(_onPointer);
      _tracking = true;
    }
  }

  static void _onPointer(PointerEvent event) {
    if (event is PointerDownEvent) {
      _lastPointerDown = event.position;
    }
  }

  /// The attached overlay, while it is still mounted.
  static OverlayState? get overlay {
    final overlay = _overlay;
    return overlay != null && overlay.mounted ? overlay : null;
  }

  /// The overlay's render box, for converting global positions into overlay coordinates.
  static RenderBox? get overlayBox {
    final box = overlay?.context.findRenderObject();
    return box is RenderBox && box.attached && box.hasSize ? box : null;
  }

  /// The last pointer press in overlay coordinates, or null before the first one.
  static Offset? get lastPointerDown {
    final position = _lastPointerDown;
    final box = overlayBox;
    return position == null || box == null ? null : box.globalToLocal(position);
  }

  /// True when the OS asks for reduced motion (read from the overlay's context).
  static bool get reduced {
    final overlay = GalleryMotionHost.overlay;
    return overlay != null && (MediaQuery.maybeDisableAnimationsOf(overlay.context) ?? false);
  }

  @visibleForTesting
  static void debugReset() {
    if (_tracking) {
      GestureBinding.instance.pointerRouter.removeGlobalRoute(_onPointer);
    }
    _tracking = false;
    _overlay = null;
    _lastPointerDown = null;
  }
}
