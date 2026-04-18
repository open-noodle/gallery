import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_section_scaffold.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';
import 'package:immich_mobile/providers/photos_filter/time_buckets.provider.dart';

/// WhenAccordionSection — Deep-snap section for the "When" filter dimension.
///
/// Lists years (descending) with a trailing count. Tapping a year expands an
/// inline 4×3 month grid below the row. Only one year is expanded at a time —
/// tapping another year collapses the first. Tapping a month sets the date
/// range filter to the whole month; tapping the same month twice clears it.
///
/// The trailing header exposes a "N years →" affordance that delegates to
/// [onOpenPicker] (a full when-picker will be wired in a later task).
class WhenAccordionSection extends ConsumerStatefulWidget {
  final VoidCallback? onOpenPicker;
  const WhenAccordionSection({super.key, this.onOpenPicker});

  @override
  ConsumerState<WhenAccordionSection> createState() => _WhenAccordionSectionState();
}

class _WhenAccordionSectionState extends ConsumerState<WhenAccordionSection> {
  static const _storageId = 'when-accordion-expanded-year';
  int? _expandedYear;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final stored = PageStorage.of(context).readState(context, identifier: _storageId);
      if (stored is int && stored != _expandedYear) {
        setState(() => _expandedYear = stored);
      }
    });
  }

  void _setExpandedYear(int? year) {
    setState(() => _expandedYear = year);
    PageStorage.of(context).writeState(context, year, identifier: _storageId);
  }

  @override
  Widget build(BuildContext context) {
    final filter = ref.watch(photosFilterDebouncedProvider);
    final bucketsAsync = ref.watch(timeBucketsProvider(filter));
    final yearsAsync = bucketsAsync.whenData(aggregateYears);
    final count = yearsAsync.valueOrNull?.length ?? 0;

    return DeepSectionScaffold<YearCount>(
      titleKey: 'filter_sheet_deep_when_section',
      emptyCaptionKey: 'filter_sheet_deep_empty_when',
      items: yearsAsync,
      onRetry: () => ref.invalidate(timeBucketsProvider(filter)),
      trailingHeader: count > 0
          ? TextButton(
              key: const Key('when-section-search-more'),
              onPressed: () {
                HapticFeedback.selectionClick();
                widget.onOpenPicker?.call();
              },
              child: Text(_yearsLabel(count)),
            )
          : null,
      childBuilder: (years) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final year in years)
            _YearRow(
              year: year,
              buckets: bucketsAsync.valueOrNull ?? const [],
              expanded: _expandedYear == year.year,
              onToggle: () => _setExpandedYear(_expandedYear == year.year ? null : year.year),
            ),
        ],
      ),
    );
  }
}

String _yearsLabel(int count) {
  final variant = count == 1 ? 'one' : 'other';
  return 'filter_sheet_deep_search_n_years.$variant'.tr(namedArgs: {'count': '$count'});
}

class _YearRow extends StatelessWidget {
  final YearCount year;
  final List<BucketLite> buckets;
  final bool expanded;
  final VoidCallback onToggle;

  const _YearRow({required this.year, required this.buckets, required this.expanded, required this.onToggle});

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
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    year.year.toString(),
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: expanded ? FontWeight.w600 : FontWeight.w400,
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

class _MonthGrid extends ConsumerWidget {
  final List<BucketLite> buckets;
  final int year;
  const _MonthGrid({required this.buckets, required this.year});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final months = getMonthsForYear(buckets, year);
    return Padding(
      padding: const EdgeInsets.only(top: 4, bottom: 12),
      child: GridView.count(
        key: Key('when-month-grid-$year'),
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisCount: 4,
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
        childAspectRatio: 2.2,
        children: [for (final m in months) _MonthCell(year: year, month: m)],
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
  const _MonthCell({required this.year, required this.month});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final start = DateTime(year, month.month, 1);
    final end = DateTime(year, month.month + 1, 0, 23, 59, 59);
    final isSelected = ref.watch(
      photosFilterProvider.select((f) => f.date.takenAfter == start && f.date.takenBefore == end),
    );
    final hasData = month.count > 0;

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
        decoration: BoxDecoration(
          color: isSelected ? theme.colorScheme.primary.withValues(alpha: 0.12) : null,
          border: Border.all(
            color: isSelected ? theme.colorScheme.primary : theme.colorScheme.outlineVariant,
            width: isSelected ? 1.4 : 1,
          ),
          borderRadius: BorderRadius.circular(10),
        ),
        alignment: Alignment.center,
        child: Text(
          _monthKeys[month.month - 1].tr(),
          style: theme.textTheme.labelMedium?.copyWith(
            color: isSelected
                ? theme.colorScheme.primary
                : (hasData ? theme.colorScheme.onSurface : theme.colorScheme.onSurface.withValues(alpha: 0.45)),
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
          ),
        ),
      ),
    );
  }
}
