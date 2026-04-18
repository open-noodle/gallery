import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// Horizontal row of quick date-range preset pills shown inside
/// [WhenPickerPage]. Mirrors the WhenStrip preset logic in
/// `presentation/widgets/filter_sheet/strips/when_strip.widget.dart` but
/// without the Custom pill (picker surface provides a year accordion instead).
class QuickRangesRow extends ConsumerWidget {
  const QuickRangesRow({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final now = DateTime.now();
    final filter = ref.watch(photosFilterProvider);

    final presets = <_WhenPreset>[
      _WhenPreset(
        key: 'when-picker-pill-today',
        label: 'filter_sheet_when_today',
        start: DateTime(now.year, now.month, now.day),
        end: DateTime(now.year, now.month, now.day, 23, 59, 59),
      ),
      _WhenPreset(
        key: 'when-picker-pill-week',
        label: 'filter_sheet_when_week',
        start: DateTime(now.year, now.month, now.day - now.weekday + 1),
        end: now,
      ),
      _WhenPreset(
        key: 'when-picker-pill-month',
        label: 'filter_sheet_when_month',
        start: DateTime(now.year, now.month, 1),
        end: now,
      ),
      _WhenPreset(
        key: 'when-picker-pill-year',
        label: 'filter_sheet_when_year',
        start: DateTime(now.year, 1, 1),
        end: now,
      ),
    ];

    return SizedBox(
      height: 44,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: presets.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final preset = presets[i];
          final selected = _matches(filter.date, preset);
          return _WhenPickerPill(preset: preset, selected: selected);
        },
      ),
    );
  }

  bool _matches(SearchDateFilter date, _WhenPreset preset) {
    final a = date.takenAfter;
    final b = date.takenBefore;
    if (a == null || b == null) return false;
    bool sameDay(DateTime x, DateTime y) => x.year == y.year && x.month == y.month && x.day == y.day;
    return sameDay(a, preset.start) && sameDay(b, preset.end);
  }
}

class _WhenPreset {
  final String key;
  final String label;
  final DateTime start;
  final DateTime end;
  _WhenPreset({required this.key, required this.label, required this.start, required this.end});
}

class _WhenPickerPill extends ConsumerWidget {
  final _WhenPreset preset;
  final bool selected;
  const _WhenPickerPill({required this.preset, required this.selected});

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
