import 'dart:async';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/collapsed_sections.provider.dart';

/// Wraps a Deep filter-sheet section with a tappable collapse header + chevron.
/// Expand/collapse state is persisted via [collapsedSectionsProvider]. Empty
/// sections render collapsed + disabled with a "(0)" title affordance.
class CollapsibleSection extends ConsumerWidget {
  final FilterSectionId sectionId;
  final String titleKey;
  final bool isEmpty;
  final Widget? trailingHeader;
  final Widget child;

  const CollapsibleSection({
    super.key,
    required this.sectionId,
    required this.titleKey,
    required this.child,
    this.isEmpty = false,
    this.trailingHeader,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final collapsedByUser = ref.watch(collapsedSectionsProvider).contains(sectionId);
    final expanded = !isEmpty && !collapsedByUser;
    final disableAnimations = MediaQuery.maybeOf(context)?.disableAnimations ?? false;

    final titleText = isEmpty ? '${titleKey.tr().toUpperCase()} (0)' : titleKey.tr().toUpperCase();

    final header = InkWell(
      key: Key('collapsible-header-${sectionId.storageId}'),
      onTap: isEmpty
          ? null
          : () {
              unawaited(HapticFeedback.selectionClick());
              ref.read(collapsedSectionsProvider.notifier).toggle(sectionId);
            },
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
        child: Row(
          children: [
            Expanded(
              child: Text(
                titleText,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 2, color: theme.colorScheme.outline),
              ),
            ),
            if (trailingHeader != null) Flexible(child: trailingHeader!),
            if (!isEmpty)
              Icon(
                expanded ? Icons.keyboard_arrow_up_rounded : Icons.keyboard_arrow_down_rounded,
                color: theme.colorScheme.outline,
              ),
          ],
        ),
      ),
    );

    final bodyContent = expanded
        ? SizedBox(width: double.infinity, key: Key('collapsible-body-${sectionId.storageId}'), child: child)
        : const SizedBox(width: double.infinity, height: 0);

    // AnimatedSize with a zero duration throws (it restarts its controller
    // synchronously from within performLayout); skip the animated wrapper
    // entirely when animations are disabled instead of animating at 0ms.
    final body = disableAnimations
        ? bodyContent
        : AnimatedSize(
            duration: const Duration(milliseconds: 240),
            curve: Curves.easeOutCubic,
            alignment: Alignment.topCenter,
            child: bodyContent,
          );

    return Column(
      key: Key('collapsible-section-${sectionId.storageId}'),
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [header, body],
    );
  }
}
