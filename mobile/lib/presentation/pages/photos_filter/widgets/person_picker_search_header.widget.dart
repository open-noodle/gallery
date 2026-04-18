import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';

/// Sticky header for the PersonPickerPage: a search TextField + match count
/// label. Pinned via SliverPersistentHeader so it stays visible while the
/// list beneath scrolls.
class PersonPickerSearchHeader extends StatelessWidget {
  final int count;
  final ValueChanged<String> onChanged;
  final String value;
  final TextEditingController controller;

  const PersonPickerSearchHeader({
    super.key,
    required this.count,
    required this.onChanged,
    required this.value,
    required this.controller,
  });

  @override
  Widget build(BuildContext context) {
    return SliverPersistentHeader(
      pinned: true,
      delegate: _PersonPickerSearchHeaderDelegate(
        count: count,
        onChanged: onChanged,
        value: value,
        controller: controller,
      ),
    );
  }
}

class _PersonPickerSearchHeaderDelegate extends SliverPersistentHeaderDelegate {
  _PersonPickerSearchHeaderDelegate({
    required this.count,
    required this.onChanged,
    required this.value,
    required this.controller,
  });

  final int count;
  final ValueChanged<String> onChanged;
  final String value;
  final TextEditingController controller;

  // Header height = padding(8) + TextField(44) + gap(6) + count(22) + padding(8) = 88.
  @override
  double get minExtent => 88;
  @override
  double get maxExtent => 88;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    final theme = Theme.of(context);
    final hasText = value.isNotEmpty;

    return Container(
      color: theme.colorScheme.surface,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            height: 44,
            child: TextField(
              key: const Key('person-picker-search-field'),
              controller: controller,
              onChanged: onChanged,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                isDense: true,
                hintText: 'filter_sheet_picker_search_people_hint'.tr(),
                prefixIcon: const Icon(Icons.search_rounded, size: 20),
                suffixIcon: hasText
                    ? IconButton(
                        key: const Key('person-picker-search-clear-x'),
                        icon: const Icon(Icons.close_rounded, size: 18),
                        tooltip: 'filter_sheet_picker_clear_search'.tr(),
                        onPressed: () {
                          controller.clear();
                          onChanged('');
                        },
                      )
                    : null,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
                filled: true,
                fillColor: theme.colorScheme.surfaceContainer,
              ),
            ),
          ),
          const SizedBox(height: 6),
          SizedBox(
            key: const Key('person-picker-count-label'),
            height: 22,
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                _peopleCountLabel(count),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _PersonPickerSearchHeaderDelegate oldDelegate) =>
      oldDelegate.count != count ||
      oldDelegate.value != value ||
      oldDelegate.onChanged != onChanged ||
      oldDelegate.controller != controller;
}

/// Plural helper — nested-leaf lookup avoids `.plural()`, which reads a
/// late-initialized locale field and throws in widget tests without an
/// `EasyLocalization` ancestor. Matches the pattern in
/// `people_section.widget.dart` and `match_count_label.widget.dart`.
String _peopleCountLabel(int count) {
  final variant = count == 1 ? 'one' : 'other';
  return 'filter_sheet_picker_people_count.$variant'.tr(namedArgs: {'count': '$count'});
}
