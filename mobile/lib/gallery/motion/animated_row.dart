import 'package:flutter/widgets.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';

/// A horizontal row whose children grow in when they are added and shrink out when they are removed, so the others
/// slide over instead of jumping. Children are matched by key, so every child needs a unique one. [gap] follows every
/// child and folds away with it.
///
/// With [staggerOnMount], the first children cascade in one after another when the row first appears; without it they
/// are simply there. Reduced motion: children fade, and the room they take opens and closes at once.
class GalleryAnimatedRow extends StatefulWidget {
  final List<Widget> children;
  final double gap;
  final Duration? staggerOnMount;

  const GalleryAnimatedRow({super.key, required this.children, this.gap = 8, this.staggerOnMount});

  @override
  State<GalleryAnimatedRow> createState() => _GalleryAnimatedRowState();
}

class _Entry {
  final Key key;
  Widget widget;
  final AnimationController controller;
  late final CurvedAnimation animation = CurvedAnimation(parent: controller, curve: GalleryMotion.standard);
  bool leaving = false;

  _Entry(this.key, this.widget, this.controller);

  void dispose() {
    animation.dispose();
    controller.dispose();
  }
}

class _GalleryAnimatedRowState extends State<GalleryAnimatedRow> with TickerProviderStateMixin {
  final List<_Entry> _entries = [];

  @override
  void initState() {
    super.initState();
    final stagger = widget.staggerOnMount;
    for (final (index, child) in widget.children.indexed) {
      final entry = _create(child, value: stagger == null ? 1 : 0);
      _entries.add(entry);
      if (stagger != null) {
        _cascadeIn(entry, stagger * index);
      }
    }
  }

  /// Grows [entry] in after [delay]. The wait is part of the controller's run (no timer), and once in, the entry
  /// takes the usual timing and curve, so a later removal shrinks it out normally.
  void _cascadeIn(_Entry entry, Duration delay) {
    final total = delay + GalleryMotion.base;
    entry
      ..controller.duration = total
      ..animation.curve = Interval(delay.inMicroseconds / total.inMicroseconds, 1, curve: GalleryMotion.settle);
    entry.controller.forward().whenCompleteOrCancel(() {
      if (!mounted) {
        return;
      }
      entry
        ..controller.duration = GalleryMotion.base
        ..animation.curve = GalleryMotion.standard;
      setState(() {});
    });
  }

  _Entry _create(Widget child, {required double value}) {
    assert(child.key != null, 'GalleryAnimatedRow children need keys');
    return _Entry(
      child.key!,
      child,
      AnimationController(
        vsync: this,
        duration: GalleryMotion.base,
        reverseDuration: GalleryMotion.quick,
        value: value,
      ),
    );
  }

  @override
  void didUpdateWidget(GalleryAnimatedRow oldWidget) {
    super.didUpdateWidget(oldWidget);
    final byKey = {for (final entry in _entries) entry.key: entry};
    final next = {for (final child in widget.children) child.key!: child};
    final merged = <_Entry>[];
    final placed = <Key>{};
    var cursor = 0;

    void placeUpTo(Key? stop) {
      while (cursor < widget.children.length) {
        final child = widget.children[cursor++];
        final key = child.key!;
        if (placed.add(key)) {
          final existing = byKey[key];
          if (existing != null) {
            existing.widget = child;
            if (existing.leaving) {
              existing.leaving = false;
              existing.controller.forward();
            }
            merged.add(existing);
          } else {
            merged.add(_create(child, value: 0)..controller.forward());
          }
        }
        if (key == stop) {
          return;
        }
      }
    }

    // Walk the old order: a kept child brings along the new ones before it, a removed one stays where it was while it
    // shrinks out.
    for (final entry in _entries) {
      if (next.containsKey(entry.key)) {
        if (!placed.contains(entry.key)) {
          placeUpTo(entry.key);
        }
      } else {
        merged.add(entry);
        if (!entry.leaving) {
          entry.leaving = true;
          entry.controller.reverse().whenCompleteOrCancel(() => _drop(entry));
        }
      }
    }
    placeUpTo(null);
    _entries
      ..clear()
      ..addAll(merged);
  }

  void _drop(_Entry entry) {
    if (!mounted || !entry.leaving) {
      return;
    }
    setState(() => _entries.remove(entry));
    entry.dispose();
  }

  @override
  void dispose() {
    for (final entry in _entries) {
      entry.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduced = GalleryMotion.reduced(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final entry in _entries)
          // Its own key, distinct from the child's: a finder for the child's key still finds exactly one widget.
          KeyedSubtree(
            key: ObjectKey(entry.key),
            child: _RowItem(
              animation: entry.animation,
              reduced: reduced,
              leaving: entry.leaving,
              gap: widget.gap,
              child: entry.widget,
            ),
          ),
      ],
    );
  }
}

class _RowItem extends StatelessWidget {
  final Animation<double> animation;
  final bool reduced;
  final bool leaving;
  final double gap;
  final Widget child;

  const _RowItem({
    required this.animation,
    required this.reduced,
    required this.leaving,
    required this.gap,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    final padded = Padding(
      padding: EdgeInsetsDirectional.only(end: gap),
      child: child,
    );
    // A leaving chip no longer takes taps.
    final body = IgnorePointer(ignoring: leaving, child: padded);
    if (reduced) {
      return FadeTransition(opacity: animation, child: body);
    }
    return SizeTransition(
      axis: Axis.horizontal,
      sizeFactor: animation,
      alignment: AlignmentDirectional.centerStart,
      child: FadeTransition(
        opacity: animation,
        child: ScaleTransition(scale: Tween(begin: 0.85, end: 1.0).animate(animation), child: body),
      ),
    );
  }
}
