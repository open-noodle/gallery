import 'package:flutter/widgets.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/gallery/motion/pressable.dart';

/// Wraps a photo in the grid: it squishes slightly under a resting finger, and it can be found by
/// remote asset id so a removal (trash, archive, delete) can lift a copy of it off the screen.
///
/// Wrapped around the thumbnail inside the tile's `Hero`, so the hero flight and selection padding
/// work exactly as before.
class GalleryTile extends StatefulWidget {
  final BaseAsset? asset;

  /// The remote id when there is no [BaseAsset] (a cleanup photo, which comes from the server only).
  final String? remoteId;
  final Widget child;

  const GalleryTile({super.key, this.asset, this.remoteId, required this.child});

  String? get _id => remoteId ?? asset?.remoteId;

  /// Tiles currently mounted for [remoteId]. The same photo can be in several timelines at once.
  static Iterable<GalleryTileHandle> live(String remoteId) => _live[remoteId] ?? const [];

  static final Map<String, Set<_GalleryTileState>> _live = {};

  @override
  State<GalleryTile> createState() => _GalleryTileState();
}

/// What a removal needs from a tile on screen.
abstract interface class GalleryTileHandle {
  /// The tile's rect in [ancestor]'s coordinates, or null when it is not on screen: its page is
  /// covered or going away, or it is scrolled out of view.
  Rect? visibleRect(RenderBox ancestor);

  /// A fresh copy of the thumbnail, to draw in the overlay.
  Widget get picture;

  /// Calls [callback] once, when this tile stops showing its photo: the timeline dropped it (the
  /// change synced) or reused it for another photo. May run mid-build.
  void onLeave(VoidCallback callback);
}

class _GalleryTileState extends State<GalleryTile> implements GalleryTileHandle {
  String? _registeredId;
  ModalRoute<Object?>? _route;
  final List<VoidCallback> _leaveCallbacks = [];

  @override
  void initState() {
    super.initState();
    _register();
  }

  @override
  void didUpdateWidget(GalleryTile oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget._id != widget._id) {
      _unregister();
      _register();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _route = ModalRoute.of(context);
  }

  @override
  void dispose() {
    _unregister();
    super.dispose();
  }

  void _register() {
    final id = widget._id;
    if (id != null) {
      (GalleryTile._live[id] ??= {}).add(this);
      _registeredId = id;
    }
  }

  void _unregister() {
    final id = _registeredId;
    if (id != null) {
      final tiles = GalleryTile._live[id];
      tiles?.remove(this);
      if (tiles != null && tiles.isEmpty) {
        GalleryTile._live.remove(id);
      }
    }
    _registeredId = null;
    final callbacks = List.of(_leaveCallbacks);
    _leaveCallbacks.clear();
    for (final callback in callbacks) {
      callback();
    }
  }

  @override
  Rect? visibleRect(RenderBox ancestor) {
    if (!mounted || !(_route?.isCurrent ?? false) || !TickerMode.valuesOf(context).enabled) {
      return null;
    }
    final box = context.findRenderObject();
    if (box is! RenderBox || !box.attached || !box.hasSize) {
      return null;
    }
    final rect = box.localToGlobal(Offset.zero, ancestor: ancestor) & box.size;
    return rect.overlaps(Offset.zero & ancestor.size) ? rect : null;
  }

  @override
  Widget get picture => widget.child;

  @override
  void onLeave(VoidCallback callback) => _leaveCallbacks.add(callback);

  @override
  Widget build(BuildContext context) {
    return GalleryPressable(pressedScale: 0.95, pressDelay: const Duration(milliseconds: 70), child: widget.child);
  }
}
