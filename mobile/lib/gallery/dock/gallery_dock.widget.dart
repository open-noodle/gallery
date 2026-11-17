import 'dart:ui' as ui;

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/pressable.dart';
import 'package:immich_mobile/gallery/motion/spring_curve.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_nav_destination.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';

/// What the dock shows (specs/2026-11-17-mobile-nav-dock-design.md, "States").
enum GalleryDockMode {
  /// Grouping row above the tab bar (the row only on Photos).
  unfolded,

  /// One row: the active tab's circle, the grouping control, the search circle.
  folded,

  /// Photos search mode: the tab circle and the grouping row; the field lives in the top header.
  search,
}

/// The tab shell's bottom dock: the tab bar with search, and on Photos the Years / Months / All row above it. Every
/// piece is placed against the dock's own bottom edge, and all geometry moves on one spring, so folding reads as the
/// tab bar shrinking into a circle while the grouping row drops into the gap.
class GalleryDock extends StatelessWidget {
  final List<GalleryTabEnum> slots;
  final GalleryTabEnum activeTab;
  final Set<GalleryTabEnum> disabledTabs;
  final GalleryDockMode mode;

  /// Whether the grouping row shows (the Photos tab).
  final bool showGrouping;
  final bool searchEnabled;
  final ValueChanged<GalleryTabEnum> onTabTap;
  final VoidCallback onSearchTap;

  /// The tab circle while folded or searching: unfold, or leave search.
  final VoidCallback onCircleTap;

  const GalleryDock({
    super.key,
    required this.slots,
    required this.activeTab,
    required this.mode,
    required this.showGrouping,
    required this.onTabTap,
    required this.onSearchTap,
    required this.onCircleTap,
    this.disabledTabs = const {},
    this.searchEnabled = true,
  });

  static const double tabBarHeight = 64;
  static const double groupingHeight = 52;
  static const double rowGap = 10;
  static const double circle = 56;

  /// The height the dock keeps for itself whatever its state, so folding never moves the content under it.
  static double reservedHeight({required bool showGrouping}) =>
      showGrouping ? tabBarHeight + rowGap + groupingHeight : tabBarHeight;

  /// The prototype's "springy" motion: a small overshoot that settles in about 0.6 s.
  static final GallerySpringCurve spring = GallerySpringCurve(
    const SpringDescription(mass: 1, stiffness: 240, damping: 21),
  );

  static Duration get springDuration => Duration(milliseconds: (spring.settleSeconds * 1000).round());

  @override
  Widget build(BuildContext context) {
    final reduced = GalleryMotion.reduced(context);
    final motion = _Motion(
      duration: reduced ? const Duration(milliseconds: 150) : springDuration,
      curve: reduced ? Curves.easeOut : spring,
    );
    final rtl = Directionality.of(context) == ui.TextDirection.rtl;

    return SizedBox(
      key: const Key('gallery-dock'),
      height: reservedHeight(showGrouping: showGrouping),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth;
          final geometry = _DockGeometry.of(mode, width, rtl: rtl);
          final activeSlot = slots.indexOf(activeTab);

          return Stack(
            clipBehavior: Clip.none,
            children: [
              _place(
                motion,
                geometry.grouping,
                IgnorePointer(
                  ignoring: !showGrouping,
                  child: AnimatedOpacity(
                    duration: motion.half,
                    opacity: showGrouping ? 1 : 0,
                    child: AnimatedSlide(
                      duration: motion.duration,
                      curve: motion.curve,
                      offset: showGrouping ? Offset.zero : const Offset(0, 0.25),
                      child: const _Glass(
                        key: Key('gallery-dock-grouping'),
                        child: Padding(
                          padding: EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                          child: Center(child: TimelineGroupingSelector(bare: true)),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              _place(
                motion,
                geometry.tabs,
                _TabBar(
                  slots: slots,
                  activeSlot: activeSlot,
                  disabledTabs: disabledTabs,
                  mode: mode,
                  slotWidth: geometry.slotWidth,
                  rtl: rtl,
                  motion: motion,
                  onTabTap: onTabTap,
                  onCircleTap: onCircleTap,
                ),
              ),
              _place(
                motion,
                geometry.search,
                _SearchSlot(mode: mode, enabled: searchEnabled, motion: motion, onTap: onSearchTap),
              ),
            ],
          );
        },
      ),
    );
  }

  static Widget _place(_Motion motion, Rect rect, Widget child) {
    return AnimatedPositioned(
      duration: motion.duration,
      curve: motion.curve,
      left: rect.left,
      bottom: rect.top,
      width: rect.width,
      height: rect.height,
      child: child,
    );
  }
}

class _Motion {
  final Duration duration;
  final Curve curve;

  const _Motion({required this.duration, required this.curve});

  /// Fades run on half the spring's time, so a piece is gone before it lands.
  Duration get half => duration ~/ 2;
}

/// Where each piece sits. Rects are measured from the dock's bottom-left: `top` holds the distance from the bottom.
class _DockGeometry {
  final Rect tabs;
  final Rect grouping;
  final Rect search;
  final double slotWidth;

  const _DockGeometry({required this.tabs, required this.grouping, required this.search, required this.slotWidth});

  factory _DockGeometry.of(GalleryDockMode mode, double width, {required bool rtl}) {
    const c = GalleryDock.circle;
    const gap = GalleryDock.rowGap;
    final slot = width / 4;
    Rect r(double x, double bottom, double w, double h) => Rect.fromLTWH(rtl ? width - x - w : x, bottom, w, h);

    return switch (mode) {
      GalleryDockMode.unfolded => _DockGeometry(
        tabs: r(0, 0, width, GalleryDock.tabBarHeight),
        grouping: r(0, GalleryDock.tabBarHeight + gap, width, GalleryDock.groupingHeight),
        search: r(3 * slot, 0, slot, GalleryDock.tabBarHeight),
        slotWidth: slot,
      ),
      GalleryDockMode.folded => _DockGeometry(
        tabs: r(0, 0, c, c),
        grouping: r(c + gap, 0, width - 2 * (c + gap), c),
        search: r(width - c, 0, c, c),
        slotWidth: slot,
      ),
      GalleryDockMode.search => _DockGeometry(
        tabs: r(0, 0, c, c),
        grouping: r(c + gap, 0, width - c - gap, c),
        search: r(width - c, 0, c, c),
        slotWidth: slot,
      ),
    };
  }
}

/// The frosted stadium every piece of the dock sits on, matching the nav's earlier pill surface.
class _Glass extends StatelessWidget {
  final Widget child;

  /// The surface alone fades, so the search slot can sit bare inside the tab bar and grow its own circle when it
  /// detaches.
  final double surfaceOpacity;
  final Duration fade;

  const _Glass({super.key, required this.child, this.surfaceOpacity = 1, this.fade = Duration.zero});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    const shape = StadiumBorder();
    return Stack(
      fit: StackFit.expand,
      children: [
        AnimatedOpacity(
          duration: fade,
          opacity: surfaceOpacity,
          child: DecoratedBox(
            decoration: ShapeDecoration(
              shape: shape,
              shadows: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: dark ? 0.45 : 0.18),
                  offset: const Offset(0, 10),
                  blurRadius: 28,
                  spreadRadius: -8,
                ),
              ],
            ),
            child: ClipPath(
              clipper: const ShapeBorderClipper(shape: shape),
              child: BackdropFilter(
                filter: ui.ImageFilter.blur(sigmaX: 28, sigmaY: 28),
                child: DecoratedBox(
                  decoration: ShapeDecoration(
                    color: dark
                        ? theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.62)
                        : theme.colorScheme.surface.withValues(alpha: 0.88),
                    shape: StadiumBorder(
                      side: BorderSide(color: theme.colorScheme.outlineVariant.withValues(alpha: 0.55)),
                    ),
                  ),
                  child: DecoratedBox(
                    decoration: ShapeDecoration(
                      shape: shape,
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.center,
                        colors: [theme.colorScheme.onSurface.withValues(alpha: 0.05), Colors.transparent],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        ClipPath(
          clipper: const ShapeBorderClipper(shape: shape),
          child: child,
        ),
      ],
    );
  }
}

class _TabBar extends StatelessWidget {
  final List<GalleryTabEnum> slots;
  final int activeSlot;
  final Set<GalleryTabEnum> disabledTabs;
  final GalleryDockMode mode;
  final double slotWidth;
  final bool rtl;
  final _Motion motion;
  final ValueChanged<GalleryTabEnum> onTabTap;
  final VoidCallback onCircleTap;

  const _TabBar({
    required this.slots,
    required this.activeSlot,
    required this.disabledTabs,
    required this.mode,
    required this.slotWidth,
    required this.rtl,
    required this.motion,
    required this.onTabTap,
    required this.onCircleTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final unfolded = mode == GalleryDockMode.unfolded;
    const c = GalleryDock.circle;
    // Slots run start to end; under RTL the bar's own width is the full dock width only while unfolded.
    double slotLeft(int i) => rtl ? (slots.length - i) * slotWidth : i * slotWidth;

    final children = <Widget>[
      // The highlight under the active tab, sliding between slots and fading out as the bar folds.
      AnimatedPositioned(
        key: const Key('gallery-dock-highlight'),
        duration: motion.duration,
        curve: motion.curve,
        left: unfolded ? slotLeft(activeSlot) + 4 : 4,
        top: 4,
        width: unfolded ? slotWidth - 8 : c - 8,
        height: unfolded ? GalleryDock.tabBarHeight - 8 : c - 8,
        child: AnimatedOpacity(
          duration: motion.half,
          opacity: unfolded && activeSlot >= 0 ? 1 : 0,
          child: DecoratedBox(
            decoration: ShapeDecoration(
              shape: const StadiumBorder(),
              color: theme.colorScheme.primary.withValues(alpha: theme.brightness == Brightness.dark ? 0.16 : 0.2),
            ),
          ),
        ),
      ),
      for (var i = 0; i < slots.length; i++)
        AnimatedPositioned(
          key: Key('gallery-dock-tab-${slots[i].name}'),
          duration: motion.duration,
          curve: motion.curve,
          left: unfolded ? slotLeft(i) : 0,
          top: 0,
          width: unfolded ? slotWidth : c,
          height: unfolded ? GalleryDock.tabBarHeight : c,
          child: _TabItem(
            tab: slots[i],
            active: i == activeSlot,
            disabled: disabledTabs.contains(slots[i]),
            mode: mode,
            motion: motion,
            onTap: () => onTabTap(slots[i]),
          ),
        ),
      // Folded or searching, the whole circle is one target.
      if (!unfolded)
        Positioned.fill(
          child: Semantics(
            key: const Key('gallery-dock-circle'),
            button: true,
            label: mode == GalleryDockMode.search || activeSlot < 0
                ? context.t.back
                : GalleryNavDestination.forTab(slots[activeSlot]).labelKey.tr(),
            child: GestureDetector(behavior: HitTestBehavior.opaque, onTap: onCircleTap),
          ),
        ),
    ];

    return GalleryPressable(
      key: const Key('gallery-dock-tabs'),
      enabled: !unfolded,
      pressedScale: 0.92,
      child: _Glass(
        child: Stack(clipBehavior: Clip.none, children: children),
      ),
    );
  }
}

class _TabItem extends StatelessWidget {
  final GalleryTabEnum tab;
  final bool active;
  final bool disabled;
  final GalleryDockMode mode;
  final _Motion motion;
  final VoidCallback onTap;

  const _TabItem({
    required this.tab,
    required this.active,
    required this.disabled,
    required this.mode,
    required this.motion,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final destination = GalleryNavDestination.forTab(tab);
    final unfolded = mode == GalleryDockMode.unfolded;
    // Folded, only the active tab stays: the others shrink into the circle and fade.
    final visible = unfolded || active;
    final color = active ? theme.colorScheme.primary : theme.colorScheme.onSurface.withValues(alpha: 0.72);

    return IgnorePointer(
      ignoring: !unfolded || disabled,
      child: AnimatedOpacity(
        duration: motion.half,
        opacity: visible ? (disabled ? 0.3 : 1) : 0,
        child: AnimatedScale(
          duration: motion.duration,
          curve: motion.curve,
          scale: visible ? 1 : 0.5,
          child: Semantics(
            container: true,
            button: true,
            selected: active,
            enabled: !disabled,
            label: destination.labelKey.tr(),
            excludeSemantics: true,
            child: GalleryPressable(
              enabled: unfolded && !disabled,
              pressedScale: 0.88,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: onTap,
                child: _IconAndLabel(
                  icon: active ? destination.activeIcon : destination.idleIcon,
                  label: destination.labelKey.tr(),
                  color: color,
                  showLabel: unfolded,
                  motion: motion,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// An icon over its label while unfolded; folded, the label fades down and the icon settles into the centre.
class _IconAndLabel extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final bool showLabel;
  final _Motion motion;

  const _IconAndLabel({
    required this.icon,
    required this.label,
    required this.color,
    required this.showLabel,
    required this.motion,
  });

  static const double _iconSize = 25;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final height = constraints.maxHeight;
        return Stack(
          clipBehavior: Clip.none,
          children: [
            AnimatedPositioned(
              duration: motion.duration,
              curve: motion.curve,
              left: 0,
              right: 0,
              top: showLabel ? 9 : (height - _iconSize) / 2,
              height: _iconSize,
              child: Icon(icon, size: _iconSize, color: color),
            ),
            Positioned(
              left: 4,
              right: 4,
              bottom: 8,
              child: AnimatedOpacity(
                duration: motion.half,
                opacity: showLabel ? 1 : 0,
                child: AnimatedSlide(
                  duration: motion.duration,
                  curve: motion.curve,
                  offset: showLabel ? Offset.zero : const Offset(0, 0.5),
                  // Long localized labels shrink to fit their slot instead of pushing search off-screen (#909).
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      label,
                      maxLines: 1,
                      style: TextStyle(color: color, fontSize: 11.5, fontWeight: FontWeight.w600, height: 1.1),
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _SearchSlot extends StatelessWidget {
  final GalleryDockMode mode;
  final bool enabled;
  final _Motion motion;
  final VoidCallback onTap;

  const _SearchSlot({required this.mode, required this.enabled, required this.motion, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final unfolded = mode == GalleryDockMode.unfolded;
    final searching = mode == GalleryDockMode.search;
    final color = theme.colorScheme.onSurface.withValues(alpha: 0.85);

    return IgnorePointer(
      ignoring: searching || !enabled,
      child: AnimatedOpacity(
        duration: motion.half,
        opacity: searching ? 0 : (enabled ? 1 : 0.3),
        child: Semantics(
          key: const Key('gallery-dock-search'),
          container: true,
          button: true,
          enabled: enabled,
          label: context.t.nav_search_photos_hint,
          excludeSemantics: true,
          child: GalleryPressable(
            pressedScale: 0.88,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: onTap,
              // Inside the unfolded tab bar the slot is bare; it grows its own glass when it detaches.
              child: _Glass(
                surfaceOpacity: unfolded ? 0 : 1,
                fade: motion.half,
                child: _IconAndLabel(
                  icon: Icons.search_rounded,
                  label: context.t.search,
                  color: color,
                  showLabel: unfolded,
                  motion: motion,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
