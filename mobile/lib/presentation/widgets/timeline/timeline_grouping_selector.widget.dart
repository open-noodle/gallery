import 'dart:async';
import 'dart:math' as math;

import 'package:easy_localization/easy_localization.dart' hide TextDirection;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/gallery/dock/gallery_dock_style.dart';
import 'package:immich_mobile/gallery/motion/pressable.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';

const timelineOverviewModeSelectorOrder = <TimelineOverviewMode>[
  TimelineOverviewMode.years,
  TimelineOverviewMode.months,
  TimelineOverviewMode.all,
];

/// The one Years | Months | All control: the Photos dock and the detail pages' bottom pill both render it, so it looks
/// and moves the same everywhere. It fills the width it is given, with a highlight that slides on the dock's spring in
/// the tab bar's colours ([GalleryDockStyle]).
class TimelineGroupingSelector extends ConsumerWidget {
  const TimelineGroupingSelector({super.key, this.enabled = true, this.bare = false});

  /// The width taken when the host leaves it unbounded (an app-bar action slot).
  static const double _unboundedWidth = 218;
  static const double _maxHeight = 48;

  final bool enabled;

  /// When true the selector renders with a transparent Material and no stadium side,
  /// because the host widget (the dock, [TimelineGroupingBottomPill]) already paints the pill surface
  /// and outline ring. Keeping both would produce a double border on device. Defaults to false so
  /// a standalone selector keeps its own surface and border.
  final bool bare;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(timelineOverviewModeProvider);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final (duration, curve) = GalleryDockStyle.motion(context);

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth.isFinite ? constraints.maxWidth : _unboundedWidth;
        final height = math.min(constraints.maxHeight, _maxHeight);

        return Semantics(
          key: const Key('timeline-grouping-selector'),
          container: true,
          label: _translated('timeline_grouping_selector', 'Timeline grouping'),
          child: Opacity(
            opacity: enabled ? 1 : 0.45,
            child: SizedBox(
              width: width,
              height: height,
              child: Material(
                color: bare
                    ? Colors.transparent
                    : colors.surfaceContainerHighest.withValues(
                        alpha: theme.brightness == Brightness.dark ? 0.74 : 0.9,
                      ),
                shape: StadiumBorder(
                  side: bare ? BorderSide.none : BorderSide(color: colors.outlineVariant.withValues(alpha: 0.7)),
                ),
                clipBehavior: Clip.antiAlias,
                child: _Segments(
                  selected: selected,
                  enabled: enabled,
                  duration: duration,
                  curve: curve,
                  onSelect: (mode) async {
                    unawaited(HapticFeedback.selectionClick());
                    await ref.read(timelineOverviewModeProvider.notifier).set(mode);
                  },
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _Segments extends StatelessWidget {
  final TimelineOverviewMode selected;
  final bool enabled;
  final Duration duration;
  final Curve curve;
  final Future<void> Function(TimelineOverviewMode) onSelect;

  const _Segments({
    required this.selected,
    required this.enabled,
    required this.duration,
    required this.curve,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final rtl = Directionality.of(context) == TextDirection.rtl;
    const modes = timelineOverviewModeSelectorOrder;
    final index = modes.indexOf(selected);
    final slot = rtl ? modes.length - 1 - index : index;

    return LayoutBuilder(
      builder: (context, constraints) {
        final segment = constraints.maxWidth / modes.length;
        return Stack(
          children: [
            // The spring animates the slot index, not pixels: a host that resizes the control (the dock folding)
            // would otherwise restart a pixel target on every frame and leave the highlight trailing.
            TweenAnimationBuilder<double>(
              key: const Key('timeline-grouping-highlight'),
              tween: Tween(end: slot.toDouble()),
              duration: duration,
              curve: curve,
              builder: (context, s, child) =>
                  Positioned(left: s * segment, top: 0, bottom: 0, width: segment, child: child!),
              child: DecoratedBox(
                decoration: ShapeDecoration(shape: const StadiumBorder(), color: GalleryDockStyle.highlight(theme)),
              ),
            ),
            Row(
              children: [
                for (final mode in modes)
                  Expanded(
                    child: _Segment(
                      mode: mode,
                      selected: mode == selected,
                      enabled: enabled,
                      duration: duration,
                      onTap: () => unawaited(onSelect(mode)),
                    ),
                  ),
              ],
            ),
          ],
        );
      },
    );
  }
}

class _Segment extends StatelessWidget {
  const _Segment({
    required this.mode,
    required this.selected,
    required this.enabled,
    required this.duration,
    required this.onTap,
  });

  final TimelineOverviewMode mode;
  final bool selected;
  final bool enabled;
  final Duration duration;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final label = timelineGroupingLabel(mode);
    final canTap = enabled && !selected;

    return Semantics(
      key: Key('timeline-grouping-${mode.name}'),
      button: true,
      selected: selected,
      enabled: enabled,
      label: label,
      onTap: canTap ? onTap : null,
      excludeSemantics: true,
      child: GalleryPressable(
        enabled: canTap,
        pressedScale: 0.9,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: canTap ? onTap : null,
          child: Center(
            child: AnimatedDefaultTextStyle(
              duration: duration ~/ 2,
              style: TextStyle(
                color: selected ? GalleryDockStyle.activeForeground(theme) : GalleryDockStyle.idleForeground(theme),
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: FittedBox(fit: BoxFit.scaleDown, child: Text(label, maxLines: 1)),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// Labels mirror the web timeline grouping control (Years / Months / All) so the two
// platforms read identically.
String timelineGroupingLabel(TimelineOverviewMode mode) {
  return switch (mode) {
    TimelineOverviewMode.years => _translated('timeline_grouping_years', 'Years'),
    TimelineOverviewMode.months => _translated('timeline_grouping_months', 'Months'),
    TimelineOverviewMode.all => _translated('timeline_grouping_all', 'All'),
  };
}

String _translated(String key, String fallback) {
  final value = key.tr();
  return value == key ? fallback : value;
}
