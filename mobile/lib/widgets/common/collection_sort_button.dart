import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';

/// A single option offered by a [CollectionSortButton]: a sort mode paired
/// with the i18n key used to render its label.
typedef CollectionSortOption<T> = ({T mode, String label});

/// A reusable "Sort: `mode`" pill that opens a menu of sort modes and, when
/// re-tapped on the already-selected mode, reverses its direction.
///
/// Tapping a **different** option reports `onChanged(option, false)` (sort
/// order resets to its default direction when switching mode). Tapping the
/// **current** option reports `onChanged(current, !isReverse)`.
class CollectionSortButton<T> extends StatelessWidget {
  const CollectionSortButton({
    super.key,
    required this.options,
    required this.current,
    required this.isReverse,
    required this.onChanged,
  });

  final List<CollectionSortOption<T>> options;
  final T current;
  final bool isReverse;
  final void Function(T mode, bool isReverse) onChanged;

  void _onOptionTapped(CollectionSortOption<T> option) {
    if (option.mode == current) {
      onChanged(current, !isReverse);
    } else {
      onChanged(option.mode, false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final currentOption = options.firstWhere((option) => option.mode == current, orElse: () => options.first);

    return MenuAnchor(
      style: MenuStyle(
        elevation: const WidgetStatePropertyAll(1),
        shape: WidgetStateProperty.all(
          const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(24))),
        ),
        padding: const WidgetStatePropertyAll(EdgeInsets.all(4)),
      ),
      consumeOutsideTap: true,
      menuChildren: options.map((option) => _menuItem(context, option)).toList(),
      builder: (context, controller, child) {
        return GestureDetector(
          key: const Key('collection-sort-button-pill'),
          onTap: () {
            if (controller.isOpen) {
              controller.close();
            } else {
              controller.open();
            }
          },
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'sort_by_label'.t(
                  context: context,
                  args: {'label': currentOption.label.t(context: context)},
                ),
                style: context.textTheme.labelLarge?.copyWith(color: context.colorScheme.onSurface.withAlpha(225)),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _menuItem(BuildContext context, CollectionSortOption<T> option) {
    final isSelected = option.mode == current;

    return MenuItemButton(
      leadingIcon: Icon(Icons.check_rounded, color: isSelected ? context.colorScheme.onPrimary : Colors.transparent),
      trailingIcon: isSelected
          ? Icon(isReverse ? Icons.arrow_upward : Icons.arrow_downward, size: 18, color: context.colorScheme.onPrimary)
          : null,
      onPressed: () => _onOptionTapped(option),
      style: ButtonStyle(
        padding: WidgetStateProperty.all(const EdgeInsets.fromLTRB(12, 12, 24, 12)),
        backgroundColor: WidgetStateProperty.all(isSelected ? context.colorScheme.primary : Colors.transparent),
        shape: WidgetStateProperty.all(
          const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
        ),
      ),
      child: Text(
        option.label.t(context: context),
        style: context.textTheme.labelLarge?.copyWith(
          color: isSelected ? context.colorScheme.onPrimary : context.colorScheme.onSurface.withAlpha(185),
        ),
      ),
    );
  }
}
