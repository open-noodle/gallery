import 'dart:async';
import 'dart:math' as math;

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';

const timelineOverviewModeSelectorOrder = <TimelineOverviewMode>[
  TimelineOverviewMode.years,
  TimelineOverviewMode.months,
  TimelineOverviewMode.all,
];

class TimelineGroupingSelector extends ConsumerWidget {
  const TimelineGroupingSelector({super.key, this.enabled = true, this.bare = false});

  static const double _maxWidth = 218;
  static const double _height = 48;

  final bool enabled;

  /// When true the selector renders with a transparent Material and no stadium side,
  /// because the host widget (e.g. [TimelineGroupingBottomPill]) already paints the pill surface
  /// and outline ring. Keeping both would produce a double border on device. Defaults to false so
  /// a standalone selector keeps its own surface and border. The transparent Material and
  /// stadium shape must stay even when bare: the segments' InkWells need a Material ancestor, and
  /// the shape clips their ripples to the pill.
  final bool bare;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(timelineOverviewModeProvider);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth.isFinite ? math.min(constraints.maxWidth, _maxWidth) : _maxWidth;

        return Semantics(
          key: const Key('timeline-grouping-selector'),
          container: true,
          label: _translated('timeline_grouping_selector', 'Timeline grouping'),
          child: Opacity(
            opacity: enabled ? 1 : 0.45,
            child: SizedBox(
              width: width,
              height: _height,
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
                child: Row(
                  children: [
                    for (final mode in timelineOverviewModeSelectorOrder)
                      Expanded(
                        child: _TimelineGroupingSegment(
                          mode: mode,
                          selected: selected == mode,
                          enabled: enabled,
                          onTap: () async {
                            unawaited(HapticFeedback.selectionClick());
                            await ref.read(timelineOverviewModeProvider.notifier).set(mode);
                          },
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _TimelineGroupingSegment extends StatelessWidget {
  const _TimelineGroupingSegment({
    required this.mode,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  final TimelineOverviewMode mode;
  final bool selected;
  final bool enabled;
  final Future<void> Function() onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final foreground = selected ? colors.onPrimary : colors.onSurface.withValues(alpha: 0.86);
    final duration = MediaQuery.disableAnimationsOf(context) ? Duration.zero : Durations.short3;
    final label = timelineGroupingLabel(mode);
    final canTap = enabled && !selected;

    return Semantics(
      key: Key('timeline-grouping-${mode.name}'),
      button: true,
      selected: selected,
      enabled: enabled,
      label: label,
      onTap: canTap ? () => unawaited(onTap()) : null,
      child: ExcludeSemantics(
        child: InkWell(
          onTap: canTap ? () => unawaited(onTap()) : null,
          borderRadius: BorderRadius.circular(999),
          child: AnimatedContainer(
            duration: duration,
            curve: Curves.easeOutCubic,
            height: double.infinity,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: selected ? colors.primary : Colors.transparent,
              borderRadius: BorderRadius.circular(999),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 6),
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.fade,
              softWrap: false,
              style: theme.textTheme.labelLarge?.copyWith(
                color: foreground,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
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
