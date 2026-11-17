import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

/// Whether the tab shell's dock is folded into one row (specs/2026-11-17-mobile-nav-dock-design.md). Scrolling down a
/// tab's content folds it, scrolling up or reaching the top unfolds it, and switching tab unfolds it.
final galleryDockFoldedProvider = StateProvider<bool>((_) => false);

/// Folds and unfolds the dock from the vertical scrolls under [child]. The shell wraps its tab content in it, so the
/// active tab's scrollable drives the dock without the tab pages knowing about it.
class GalleryDockScrollListener extends ConsumerStatefulWidget {
  final Widget child;

  const GalleryDockScrollListener({super.key, required this.child});

  /// Travel in one direction before the dock reacts, so a jittery finger does not flap it.
  static const double travel = 24;

  /// Within this distance of the top the dock is always unfolded.
  static const double nearTop = 30;

  @override
  ConsumerState<GalleryDockScrollListener> createState() => _GalleryDockScrollListenerState();
}

class _GalleryDockScrollListenerState extends ConsumerState<GalleryDockScrollListener> {
  double _run = 0;

  void _fold(bool folded) {
    if (ref.read(galleryDockFoldedProvider) != folded) {
      ref.read(galleryDockFoldedProvider.notifier).state = folded;
    }
  }

  bool _onScroll(ScrollUpdateNotification notification) {
    final metrics = notification.metrics;
    // Horizontal rows (the memory lane, an albums strip) never fold the dock.
    if (metrics.axis != Axis.vertical) {
      return false;
    }
    final delta = notification.scrollDelta ?? 0;
    if (metrics.pixels - metrics.minScrollExtent < GalleryDockScrollListener.nearTop) {
      _run = 0;
      _fold(false);
      return false;
    }
    // The bounce past the end scrolls back up by itself; that is not the user asking for the dock.
    if (metrics.pixels >= metrics.maxScrollExtent - 4) {
      return false;
    }
    if (delta == 0) {
      return false;
    }
    if (delta.sign != _run.sign) {
      _run = 0;
    }
    _run += delta;
    if (_run > GalleryDockScrollListener.travel) {
      _fold(true);
    } else if (_run < -GalleryDockScrollListener.travel) {
      _fold(false);
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    return NotificationListener<ScrollUpdateNotification>(onNotification: _onScroll, child: widget.child);
  }
}
