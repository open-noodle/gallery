import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

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

/// Sticky footer for [WhenPickerPage] showing the current date-range
/// selection on the left and a Done button on the right.
///
/// The selection label is derived from [photosFilterProvider]'s
/// `date.takenAfter` / `date.takenBefore` pair:
///   - Both null           → 'All time'
///   - Same month + year   → 'November 2024'
///   - Same year           → 'Jan – Mar 2024' (en-dash)
///   - Different years     → 'Mar 2023 – May 2024'
///
/// The Done button simply pops the route via `Navigator.maybePop`.
class WhenPickerFooter extends ConsumerWidget {
  const WhenPickerFooter({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final date = ref.watch(photosFilterProvider.select((f) => f.date));
    final label = _formatLabel(date.takenAfter, date.takenBefore);

    return Material(
      color: theme.colorScheme.surface,
      elevation: 8,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  key: const Key('when-picker-footer-label'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w500),
                ),
              ),
              const SizedBox(width: 8),
              Flexible(
                child: FilledButton(
                  key: const Key('when-picker-footer-done'),
                  onPressed: () => Navigator.of(context).maybePop(),
                  child: Text('filter_sheet_picker_done'.tr(), maxLines: 1, overflow: TextOverflow.ellipsis),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Formats the selection label. Pure — tested via the widget's label
  /// `Text.data` assertions. Note that in unit tests `.tr()` returns the
  /// i18n key verbatim (no bundles loaded), so assertions target keys.
  static String _formatLabel(DateTime? start, DateTime? end) {
    if (start == null || end == null) return 'filter_sheet_picker_all_time'.tr();

    final startMonth = _monthKeys[start.month - 1].tr();
    final endMonth = _monthKeys[end.month - 1].tr();

    final sameMonth = start.year == end.year && start.month == end.month;
    final sameYear = start.year == end.year;

    if (sameMonth) {
      return '$startMonth ${start.year}';
    }
    if (sameYear) {
      return '$startMonth – $endMonth ${start.year}';
    }
    return '$startMonth ${start.year} – $endMonth ${end.year}';
  }
}
