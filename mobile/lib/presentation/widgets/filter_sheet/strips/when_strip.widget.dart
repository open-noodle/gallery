import 'dart:async';

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

Future<void> _openPicker(BuildContext context, WidgetRef ref) async {
  final now = DateTime.now();
  final range = await showDateRangePicker(context: context, firstDate: DateTime(1970), lastDate: now);
  if (range == null) return;
  unawaited(HapticFeedback.selectionClick());
  ref.read(photosFilterProvider.notifier).setDateRange(start: range.start, end: range.end);
}

class WhenStrip extends ConsumerWidget {
  const WhenStrip({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final now = DateTime.now();
    final filter = ref.watch(photosFilterProvider);

    final presets = <_WhenPreset>[
      _WhenPreset(
        key: 'when-pill-today',
        label: 'filter_sheet_when_today',
        start: DateTime(now.year, now.month, now.day),
        end: DateTime(now.year, now.month, now.day, 23, 59, 59),
      ),
      _WhenPreset(
        key: 'when-pill-week',
        label: 'filter_sheet_when_week',
        start: DateTime(now.year, now.month, now.day - now.weekday + 1),
        end: now,
      ),
      _WhenPreset(
        key: 'when-pill-month',
        label: 'filter_sheet_when_month',
        start: DateTime(now.year, now.month, 1),
        end: now,
      ),
      _WhenPreset(key: 'when-pill-year', label: 'filter_sheet_when_year', start: DateTime(now.year, 1, 1), end: now),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 12),
          child: Text(
            'filter_sheet_when'.tr().toUpperCase(),
            style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 2, color: theme.colorScheme.outline),
          ),
        ),
        SizedBox(
          height: 44,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 20),
            itemCount: presets.length + 1,
            separatorBuilder: (_, _) => const SizedBox(width: 8),
            itemBuilder: (ctx, i) {
              if (i == presets.length) {
                return _CustomPill();
              }
              final preset = presets[i];
              final selected = _matches(filter.date, preset);
              return _WhenPill(preset: preset, selected: selected);
            },
          ),
        ),
      ],
    );
  }

  bool _matches(SearchDateRange date, _WhenPreset preset) {
    final a = date.takenAfter;
    final b = date.takenBefore;
    if (a == null || b == null) return false;
    bool sameDay(DateTime x, DateTime y) => x.year == y.year && x.month == y.month && x.day == y.day;
    return sameDay(a, preset.start) && sameDay(b, preset.end);
  }
}

typedef SearchDateRange = dynamic; // see SearchDateFilter; dynamic to avoid an import alias

class _WhenPreset {
  final String key;
  final String label;
  final DateTime start;
  final DateTime end;
  _WhenPreset({required this.key, required this.label, required this.start, required this.end});
}

class _WhenPill extends ConsumerWidget {
  final _WhenPreset preset;
  final bool selected;
  const _WhenPill({required this.preset, required this.selected});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Material(
      key: Key(preset.key),
      color: selected ? theme.colorScheme.primary.withValues(alpha: 0.14) : theme.colorScheme.surfaceContainer,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: selected ? theme.colorScheme.primary : theme.colorScheme.outlineVariant),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () {
          HapticFeedback.selectionClick();
          ref.read(photosFilterProvider.notifier).setDateRange(start: preset.start, end: preset.end);
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Text(
            preset.label.tr(),
            style: theme.textTheme.labelLarge?.copyWith(
              color: selected ? theme.colorScheme.primary : theme.colorScheme.onSurface,
            ),
          ),
        ),
      ),
    );
  }
}

class _CustomPill extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Material(
      key: const Key('when-pill-custom'),
      color: theme.colorScheme.surfaceContainer,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: theme.colorScheme.outlineVariant),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () {
          unawaited(_openPicker(context, ref));
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Text('filter_sheet_when_custom'.tr(), style: theme.textTheme.labelLarge),
        ),
      ),
    );
  }
}
