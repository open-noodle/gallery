import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_nav_segment.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';

class GalleryNavPill extends StatefulWidget {
  final GalleryTabEnum activeTab;
  final void Function(GalleryTabEnum) onTabTap;

  /// Tabs to render at 30 % opacity with pointer events ignored (design §5.3
  /// readonly mode). Defaults to empty.
  final Set<GalleryTabEnum> disabledTabs;

  const GalleryNavPill({super.key, required this.activeTab, required this.onTabTap, this.disabledTabs = const {}});

  @override
  State<GalleryNavPill> createState() => _GalleryNavPillState();
}

class _GalleryNavPillState extends State<GalleryNavPill> {
  static const _pillHeight = 58.0;
  static const _underlayHeight = 46.0;
  static const _pillRadius = 28.0;
  static const _motionCurve = Cubic(0.3, 0.6, 0.2, 1);
  static const _motionDuration = Duration(milliseconds: 280);

  final Map<GalleryTabEnum, GlobalKey> _keys = {
    for (final t in GalleryTabEnum.values) t: GlobalKey(debugLabel: 'gallery-nav-segment-${t.name}'),
  };
  final GlobalKey _pillKey = GlobalKey(debugLabel: 'gallery-nav-pill');
  Map<GalleryTabEnum, Rect> _segmentRects = const {};

  static const double _edgeInset = 6.0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _measure());
  }

  @override
  void didUpdateWidget(covariant GalleryNavPill old) {
    super.didUpdateWidget(old);
    WidgetsBinding.instance.addPostFrameCallback((_) => _measure());
  }

  void _measure() {
    if (!mounted) return;
    final pillBox = _pillKey.currentContext?.findRenderObject() as RenderBox?;
    if (pillBox == null) return;
    final pillOrigin = pillBox.localToGlobal(Offset.zero);

    final rects = <GalleryTabEnum, Rect>{};
    for (final entry in _keys.entries) {
      final ctx = entry.value.currentContext;
      if (ctx == null) continue;
      final box = ctx.findRenderObject() as RenderBox?;
      if (box == null) continue;
      final origin = box.localToGlobal(Offset.zero) - pillOrigin;
      rects[entry.key] = origin & box.size;
    }
    if (rects.length == _keys.length && !_rectsEqual(rects, _segmentRects)) {
      setState(() => _segmentRects = rects);
    }
  }

  bool _rectsEqual(Map<GalleryTabEnum, Rect> a, Map<GalleryTabEnum, Rect> b) {
    if (a.length != b.length) return false;
    for (final entry in a.entries) {
      if (b[entry.key] != entry.value) return false;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final disableAnim = MediaQuery.of(context).disableAnimations;

    final activeRect = _segmentRects[widget.activeTab];
    final underlayLeft = activeRect?.left ?? 0;
    final underlayWidth = activeRect?.width ?? 0;
    const underlayTop = (_pillHeight - _underlayHeight) / 2;

    return ClipRRect(
      borderRadius: BorderRadius.circular(_pillRadius),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 28, sigmaY: 28),
        child: Container(
          height: _pillHeight,
          decoration: BoxDecoration(
            // Dark theme: translucent elevated surface reads as subtle pill on black.
            // Light theme: the same approach goes mushy gray over white — go
            // brighter by stacking a high-alpha `surface` (white/near-white) over
            // the blur so the pill reads as a crisp light slab.
            color: theme.brightness == Brightness.dark
                ? theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.68)
                : theme.colorScheme.surface.withValues(alpha: 0.9),
            borderRadius: BorderRadius.circular(_pillRadius),
            border: Border.all(color: theme.colorScheme.outlineVariant.withValues(alpha: 0.55), width: 1),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.7),
                offset: const Offset(0, 20),
                blurRadius: 44,
                spreadRadius: -14,
              ),
              BoxShadow(color: Colors.black.withValues(alpha: 0.4), offset: const Offset(0, 4), blurRadius: 8),
            ],
          ),
          child: Stack(
            key: _pillKey,
            clipBehavior: Clip.none,
            alignment: Alignment.center,
            children: [
              Positioned.fill(
                key: const Key('gallery-nav-inner-warmth'),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(_pillRadius),
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.center,
                      colors: [theme.colorScheme.onSurface.withValues(alpha: 0.04), Colors.transparent],
                    ),
                  ),
                ),
              ),
              AnimatedPositioned(
                key: const Key('gallery-nav-underlay'),
                duration: disableAnim ? Duration.zero : _motionDuration,
                curve: _motionCurve,
                left: underlayLeft,
                top: underlayTop,
                width: underlayWidth,
                height: _underlayHeight,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primary.withValues(
                      alpha: theme.brightness == Brightness.dark ? 0.16 : 0.22,
                    ),
                    borderRadius: BorderRadius.circular(_underlayHeight / 2),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: _edgeInset),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    for (final tab in GalleryTabEnum.values)
                      KeyedSubtree(
                        key: _keys[tab],
                        child: Opacity(
                          opacity: widget.disabledTabs.contains(tab) ? 0.3 : 1.0,
                          child: IgnorePointer(
                            ignoring: widget.disabledTabs.contains(tab),
                            child: GalleryNavSegment(
                              key: Key('gallery-nav-segment-${tab.name}'),
                              tab: tab,
                              active: widget.activeTab == tab,
                              onTap: () => widget.onTabTap(tab),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
