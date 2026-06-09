import 'dart:async';
import 'dart:math' as math;

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';

const timelineGroupingSelectorGroups = <GroupAssetsBy>[GroupAssetsBy.year, GroupAssetsBy.month, GroupAssetsBy.day];

GroupAssetsBy normalizeTimelineGrouping(GroupAssetsBy groupBy) {
  return switch (groupBy) {
    GroupAssetsBy.year || GroupAssetsBy.month || GroupAssetsBy.day => groupBy,
    GroupAssetsBy.auto || GroupAssetsBy.none => GroupAssetsBy.day,
  };
}

GroupAssetsBy timelineGroupingFromSettingIndex(int index) {
  if (index < 0 || index >= GroupAssetsBy.values.length) {
    return GroupAssetsBy.day;
  }

  return normalizeTimelineGrouping(GroupAssetsBy.values[index]);
}

class TimelineGroupingSelector extends ConsumerWidget {
  const TimelineGroupingSelector({super.key, this.enabled = true}) : compact = false;

  const TimelineGroupingSelector.compact({super.key, this.enabled = true}) : compact = true;

  static const double _maxWidth = 218;
  static const double _height = 48;
  // Wide enough for the longest label ("Months") at the default text scale; larger text scales
  // down via FittedBox rather than truncating.
  static const double _compactWidth = 112;
  static const double _compactHeight = 40;

  final bool enabled;
  final bool compact;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(
      appConfigProvider.select((config) => normalizeTimelineGrouping(config.timeline.groupAssetsBy)),
    );
    final theme = Theme.of(context);
    final colors = theme.colorScheme;

    if (compact) {
      return _TimelineGroupingCompactSelector(
        selected: selected,
        enabled: enabled,
        onSelected: (groupBy) async {
          unawaited(HapticFeedback.selectionClick());
          await ref.read(settingsProvider).write(.timelineGroupAssetsBy, groupBy);
        },
      );
    }

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
                color: colors.surfaceContainerHighest.withValues(
                  alpha: theme.brightness == Brightness.dark ? 0.74 : 0.9,
                ),
                shape: StadiumBorder(side: BorderSide(color: colors.outlineVariant.withValues(alpha: 0.7))),
                clipBehavior: Clip.antiAlias,
                child: Row(
                  children: [
                    for (final groupBy in timelineGroupingSelectorGroups)
                      Expanded(
                        child: _TimelineGroupingSegment(
                          groupBy: groupBy,
                          selected: selected == groupBy,
                          enabled: enabled,
                          onTap: () async {
                            unawaited(HapticFeedback.selectionClick());
                            await ref.read(settingsProvider).write(.timelineGroupAssetsBy, groupBy);
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

/// Bounce direction of the compact timeline-grouping chip: `true` means the next tap zooms in
/// toward "All", `false` means it zooms out toward "Years". Kept in a provider rather than widget
/// State because the timeline tears down and rebuilds the app-bar subtree on every segment reload
/// (a grouping change flashes the loading state). Storing the direction in ephemeral State reset
/// it on each reload, trapping the chip between "Months" and "All" so it never bounced back to
/// "Years". The extremes are self-correcting (a tap on Years/All forces the direction), so only
/// the ambiguous middle ("Months") relies on this surviving recreation.
final timelineGroupingZoomingInProvider = StateProvider<bool>((ref) => true);

class _TimelineGroupingCompactSelector extends ConsumerWidget {
  const _TimelineGroupingCompactSelector({required this.selected, required this.enabled, required this.onSelected});

  final GroupAssetsBy selected;
  final bool enabled;
  final Future<void> Function(GroupAssetsBy groupBy) onSelected;

  Future<void> _selectNext(WidgetRef ref) async {
    final direction = ref.read(timelineGroupingZoomingInProvider.notifier);
    final GroupAssetsBy next;
    switch (selected) {
      case GroupAssetsBy.year:
        next = GroupAssetsBy.month;
        direction.state = true; // continue zooming in toward All
      case GroupAssetsBy.month:
        if (direction.state) {
          next = GroupAssetsBy.day;
          direction.state = false; // reached the zoom-in extreme (All); bounce back up next
        } else {
          next = GroupAssetsBy.year;
          direction.state = true; // reached the zoom-out extreme (Years); bounce back down next
        }
      case GroupAssetsBy.day || GroupAssetsBy.auto || GroupAssetsBy.none:
        next = GroupAssetsBy.month;
        direction.state = false; // continue zooming out toward Years
    }
    await onSelected(next);
  }

  Future<void> _showMenu(BuildContext context) async {
    final renderBox = context.findRenderObject()! as RenderBox;
    final overlay = Overlay.of(context).context.findRenderObject()! as RenderBox;
    final offset = renderBox.localToGlobal(Offset.zero, ancestor: overlay);
    final position = RelativeRect.fromRect(offset & renderBox.size, Offset.zero & overlay.size);
    final selectedGroupBy = await showMenu<GroupAssetsBy>(
      context: context,
      position: position,
      items: [
        for (final groupBy in timelineGroupingSelectorGroups)
          PopupMenuItem<GroupAssetsBy>(
            key: Key('timeline-grouping-menu-${groupBy.name}'),
            value: groupBy,
            child: Text(_label(context, groupBy)),
          ),
      ],
    );

    if (selectedGroupBy != null && context.mounted) {
      await onSelected(selectedGroupBy);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final label = _label(context, selected);
    final foreground = enabled ? colors.onPrimary : colors.onSurface.withValues(alpha: 0.5);

    return Semantics(
      key: const Key('timeline-grouping-compact-selector'),
      container: true,
      button: true,
      enabled: enabled,
      label: _translated('timeline_grouping_selector', 'Timeline grouping'),
      value: label,
      onTap: enabled ? () => unawaited(_selectNext(ref)) : null,
      onLongPress: enabled ? () => unawaited(_showMenu(context)) : null,
      child: ExcludeSemantics(
        child: Opacity(
          opacity: enabled ? 1 : 0.45,
          child: SizedBox(
            width: TimelineGroupingSelector._compactWidth,
            height: TimelineGroupingSelector._compactHeight,
            child: Material(
              color: enabled ? colors.primary : colors.surfaceContainerHighest,
              shape: StadiumBorder(
                side: BorderSide(
                  color: enabled
                      ? colors.primary.withValues(alpha: 0.42)
                      : colors.outlineVariant.withValues(alpha: 0.7),
                ),
              ),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: enabled ? () => unawaited(_selectNext(ref)) : null,
                onLongPress: enabled ? () => unawaited(_showMenu(context)) : null,
                borderRadius: BorderRadius.circular(999),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  child: Center(
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(
                        label,
                        maxLines: 1,
                        softWrap: false,
                        style: theme.textTheme.labelLarge?.copyWith(color: foreground, fontWeight: FontWeight.w700),
                      ),
                    ),
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

class _TimelineGroupingSegment extends StatelessWidget {
  const _TimelineGroupingSegment({
    required this.groupBy,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  final GroupAssetsBy groupBy;
  final bool selected;
  final bool enabled;
  final Future<void> Function() onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final foreground = selected ? colors.onPrimary : colors.onSurface.withValues(alpha: 0.86);
    final duration = MediaQuery.disableAnimationsOf(context) ? Duration.zero : Durations.short3;
    final label = _label(context, groupBy);
    final canTap = enabled && !selected;

    return Semantics(
      key: Key('timeline-grouping-${groupBy.name}'),
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
// platforms read identically. Both the inline segments and the compact app-bar chip use
// these; the chip is sized to fit the widest label ("Months") to avoid truncation.
String _label(BuildContext context, GroupAssetsBy groupBy) {
  return switch (groupBy) {
    GroupAssetsBy.year => _translated('timeline_grouping_years', 'Years'),
    GroupAssetsBy.month => _translated('timeline_grouping_months', 'Months'),
    GroupAssetsBy.day => _translated('timeline_grouping_all', 'All'),
    GroupAssetsBy.auto || GroupAssetsBy.none => _translated('timeline_grouping_all', 'All'),
  };
}

String _translated(String key, String fallback) {
  final value = key.tr();
  return value == key ? fallback : value;
}
