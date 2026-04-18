import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';
import 'package:immich_mobile/providers/photos_filter/time_buckets.provider.dart';
import 'package:immich_mobile/providers/photos_filter/when_picker.provider.dart';

/// Full-screen year accordion for [WhenPickerPage].
///
/// Reads [whenPickerFilteredYearsProvider] (years matching the current search
/// query + filter context) and renders each as an [InkWell] row; tapping
/// expands an inline 4×3 month grid (with fill-bars) and collapses any
/// previously-expanded year.
///
/// The host passes:
///   - [yearKeyFor]: a factory that returns a stable [GlobalKey] per year.
///     Used by the decade-anchor strip and typed-search handler to call
///     [Scrollable.ensureVisible].
///   - [expandedYear] + [onExpandYear]: lift state to the page so the parent
///     can auto-expand on a typed query.
class WhenPickerYearAccordion extends ConsumerWidget {
  final GlobalKey Function(int year) yearKeyFor;
  final int? expandedYear;
  final ValueChanged<int?> onExpandYear;

  const WhenPickerYearAccordion({
    super.key,
    required this.yearKeyFor,
    required this.expandedYear,
    required this.onExpandYear,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(whenPickerFilteredYearsProvider);
    final filter = ref.watch(photosFilterProvider);
    final bucketsAsync = ref.watch(timeBucketsProvider(filter));
    final buckets = bucketsAsync.valueOrNull ?? const <BucketLite>[];

    return async.when(
      loading: () => const SizedBox.shrink(),
      error: (e, st) => const SizedBox.shrink(),
      data: (years) {
        if (years.isEmpty) return const SizedBox.shrink();
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final year in years)
              _YearRow(
                key: yearKeyFor(year.year),
                year: year,
                buckets: buckets,
                expanded: expandedYear == year.year,
                onToggle: () => onExpandYear(expandedYear == year.year ? null : year.year),
              ),
          ],
        );
      },
    );
  }
}

class _YearRow extends StatelessWidget {
  final YearCount year;
  final List<BucketLite> buckets;
  final bool expanded;
  final VoidCallback onToggle;

  const _YearRow({
    super.key,
    required this.year,
    required this.buckets,
    required this.expanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          key: Key('when-year-${year.year}'),
          onTap: () {
            HapticFeedback.selectionClick();
            onToggle();
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    year.year.toString(),
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: expanded ? FontWeight.w600 : FontWeight.w500,
                      color: expanded ? theme.colorScheme.primary : theme.colorScheme.onSurface,
                    ),
                  ),
                ),
                Text(
                  year.count.toString(),
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
                ),
                const SizedBox(width: 8),
                Icon(
                  expanded ? Icons.keyboard_arrow_up_rounded : Icons.keyboard_arrow_down_rounded,
                  color: theme.colorScheme.outline,
                ),
              ],
            ),
          ),
        ),
        if (expanded) _MonthGrid(buckets: buckets, year: year.year),
      ],
    );
  }
}

class _MonthGrid extends StatelessWidget {
  final List<BucketLite> buckets;
  final int year;
  const _MonthGrid({required this.buckets, required this.year});

  @override
  Widget build(BuildContext context) {
    final months = getMonthsForYear(buckets, year);
    final maxCount = months.fold<int>(0, (a, m) => m.count > a ? m.count : a);
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 16),
      child: GridView.count(
        key: Key('when-month-grid-$year'),
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisCount: 4,
        mainAxisSpacing: 10,
        crossAxisSpacing: 10,
        // Cells need room for a month label + a 4px fill bar, so we run a
        // taller aspect ratio than the compact WhenAccordionSection (2.2).
        childAspectRatio: 1.6,
        children: [for (final m in months) _MonthCell(year: year, month: m, maxCount: maxCount)],
      ),
    );
  }
}

const _monthKeys = <String>[
  'filter_sheet_deep_when_month_jan',
  'filter_sheet_deep_when_month_feb',
  'filter_sheet_deep_when_month_mar',
  'filter_sheet_deep_when_month_apr',
  'filter_sheet_deep_when_month_may',
  'filter_sheet_deep_when_month_jun',
  'filter_sheet_deep_when_month_jul',
  'filter_sheet_deep_when_month_aug',
  'filter_sheet_deep_when_month_sep',
  'filter_sheet_deep_when_month_oct',
  'filter_sheet_deep_when_month_nov',
  'filter_sheet_deep_when_month_dec',
];

class _MonthCell extends ConsumerWidget {
  final int year;
  final MonthCount month;
  final int maxCount;
  const _MonthCell({required this.year, required this.month, required this.maxCount});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final start = DateTime(year, month.month, 1);
    final end = DateTime(year, month.month + 1, 0, 23, 59, 59);
    final isSelected = ref.watch(
      photosFilterProvider.select((f) => f.date.takenAfter == start && f.date.takenBefore == end),
    );
    final hasData = month.count > 0;
    final fillRatio = maxCount == 0 ? 0.0 : (month.count / maxCount).clamp(0.0, 1.0);

    return InkWell(
      key: Key('when-month-$year-${month.month}'),
      borderRadius: BorderRadius.circular(10),
      onTap: () {
        HapticFeedback.selectionClick();
        final notifier = ref.read(photosFilterProvider.notifier);
        if (isSelected) {
          notifier.setDateRange(start: null, end: null);
        } else {
          notifier.setDateRange(start: start, end: end);
        }
      },
      child: Container(
        padding: const EdgeInsets.all(6),
        decoration: BoxDecoration(
          color: isSelected ? theme.colorScheme.primary.withValues(alpha: 0.12) : null,
          border: Border.all(
            color: isSelected ? theme.colorScheme.primary : theme.colorScheme.outlineVariant,
            width: isSelected ? 1.4 : 1,
          ),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              _monthKeys[month.month - 1].tr(),
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.labelMedium?.copyWith(
                color: isSelected
                    ? theme.colorScheme.primary
                    : (hasData ? theme.colorScheme.onSurface : theme.colorScheme.onSurface.withValues(alpha: 0.45)),
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
            if (hasData) ...[
              const SizedBox(height: 4),
              SizedBox(
                key: Key('when-month-fill-$year-${month.month}'),
                height: 4,
                child: FractionallySizedBox(
                  alignment: Alignment.centerLeft,
                  widthFactor: fillRatio,
                  child: Container(
                    decoration: BoxDecoration(
                      color: isSelected ? theme.colorScheme.primary : theme.colorScheme.primary.withValues(alpha: 0.5),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
