import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';

/// Floating bottom pill hosting the full Years | Months | All grouping selector.
///
/// Always visible on detail timelines (the scrolls-away top header it replaces was the bug);
/// hides only for multiselect (the selection bottom sheet takes the bottom edge) and while
/// the keyboard is up. Visual language mirrors [GalleryNavPill]'s blur-surface pill.
class TimelineGroupingBottomPill extends ConsumerWidget {
  const TimelineGroupingBottomPill({super.key});

  /// Height reserved by the pill (surface + vertical padding); Slice 2 derives the
  /// timeline's bottom content clearance from this.
  static const double pillHeight = 58.0;
  static const double bottomFloat = 26.0;

  static const double _keyboardThreshold = 80.0;
  static const Duration _hideAnimation = Duration(milliseconds: 200);
  static const double _pillRadius = 28.0;
  // The selector self-caps at 218 via its own LayoutBuilder; 234 = that cap + the pill's
  // 2×8 horizontal padding, so the surface hugs the selector instead of spanning the screen.
  static const double _pillMaxWidth = 234.0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final mq = MediaQuery.of(context);
    final hiddenForMultiSelect = ref.watch(multiSelectProvider.select((s) => s.isEnabled || s.forceEnable));
    final keyboardUp = mq.viewInsets.bottom > _keyboardThreshold;
    final hiding = hiddenForMultiSelect || keyboardUp;
    final duration = mq.disableAnimations ? Duration.zero : _hideAnimation;
    final bottomInset = mq.padding.bottom > bottomFloat ? mq.padding.bottom : bottomFloat;

    return TweenAnimationBuilder<double>(
      key: const Key('timeline-grouping-bottom-pill-slide'),
      tween: Tween<double>(end: hiding ? 12.0 : 0.0),
      duration: duration,
      curve: Curves.easeOutCubic,
      builder: (_, slide, child) => Transform.translate(offset: Offset(0, slide), child: child),
      child: AnimatedOpacity(
        key: const Key('timeline-grouping-bottom-pill-opacity'),
        duration: duration,
        opacity: hiding ? 0 : 1,
        child: IgnorePointer(
          ignoring: hiding,
          child: Align(
            alignment: Alignment.bottomCenter,
            child: Padding(
              padding: EdgeInsets.only(left: 14, right: 14, bottom: bottomInset),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(_pillRadius),
                child: BackdropFilter(
                  filter: ui.ImageFilter.blur(sigmaX: 28, sigmaY: 28),
                  child: Container(
                    key: const Key('timeline-grouping-bottom-pill'),
                    height: pillHeight,
                    constraints: const BoxConstraints(maxWidth: _pillMaxWidth),
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    decoration: BoxDecoration(
                      // Mirrors GalleryNavPill's surface treatment (dark: translucent elevated
                      // surface; light: high-alpha surface slab over the blur).
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
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.4),
                          offset: const Offset(0, 4),
                          blurRadius: 8,
                        ),
                      ],
                    ),
                    child: const Center(child: TimelineGroupingSelector(bare: true)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
