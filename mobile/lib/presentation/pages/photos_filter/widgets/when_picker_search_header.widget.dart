import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';

/// Sticky header for the WhenPickerPage: a search TextField only (no count
/// label — total picker height is smaller than people picker). Pinned via
/// SliverPersistentHeader so it stays visible while the body beneath scrolls.
class WhenPickerSearchHeader extends StatelessWidget {
  final ValueChanged<String> onChanged;
  final String value;
  final TextEditingController controller;

  const WhenPickerSearchHeader({super.key, required this.onChanged, required this.value, required this.controller});

  @override
  Widget build(BuildContext context) {
    return SliverPersistentHeader(
      pinned: true,
      delegate: _WhenPickerSearchHeaderDelegate(onChanged: onChanged, value: value, controller: controller),
    );
  }
}

class _WhenPickerSearchHeaderDelegate extends SliverPersistentHeaderDelegate {
  _WhenPickerSearchHeaderDelegate({required this.onChanged, required this.value, required this.controller});

  final ValueChanged<String> onChanged;
  final String value;
  final TextEditingController controller;

  // Header height = padding(8) + TextField(44) + padding(8) = 60.
  @override
  double get minExtent => 60;
  @override
  double get maxExtent => 60;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    final theme = Theme.of(context);
    final hasText = value.isNotEmpty;

    return Container(
      color: theme.colorScheme.surface,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: SizedBox(
        height: 44,
        child: TextField(
          key: const Key('when-picker-search-field'),
          controller: controller,
          onChanged: onChanged,
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            isDense: true,
            hintText: 'filter_sheet_picker_search_when_hint'.tr(),
            prefixIcon: const Icon(Icons.search_rounded, size: 20),
            suffixIcon: hasText
                ? IconButton(
                    key: const Key('when-picker-search-clear-x'),
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
    );
  }

  @override
  bool shouldRebuild(covariant _WhenPickerSearchHeaderDelegate oldDelegate) =>
      oldDelegate.value != value || oldDelegate.onChanged != onChanged || oldDelegate.controller != controller;
}
