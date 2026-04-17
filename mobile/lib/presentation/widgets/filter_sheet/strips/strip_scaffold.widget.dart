import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

/// Shared shell for Browse strips — title + loading skeleton + error + empty.
class StripScaffold extends ConsumerWidget {
  final String titleKey;
  final AsyncValue<List<dynamic>> items;
  final double height;
  final Widget Function(List<dynamic>) childBuilder;
  final VoidCallback? onRetry;

  const StripScaffold({
    super.key,
    required this.titleKey,
    required this.items,
    required this.height,
    required this.childBuilder,
    this.onRetry,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Empty-data → entire strip collapses.
    final data = items.valueOrNull;
    if (items is AsyncData && data != null && data.isEmpty) {
      return const SizedBox.shrink();
    }

    final theme = Theme.of(context);
    final title = Padding(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 12),
      child: Text(
        titleKey.tr().toUpperCase(),
        style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 2, color: theme.colorScheme.outline),
      ),
    );

    Widget body;
    if (items is AsyncLoading) {
      body = _Skeleton(height: height);
    } else if (items is AsyncError) {
      body = _Retry(height: height, onRetry: onRetry);
    } else {
      body = SizedBox(height: height, child: childBuilder(data ?? const []));
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [title, body],
    );
  }
}

class _Skeleton extends StatelessWidget {
  final double height;
  const _Skeleton({required this.height});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 20),
        itemCount: 3,
        separatorBuilder: (_, _) => const SizedBox(width: 10),
        itemBuilder: (_, _) => Container(
          width: 80,
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(14),
          ),
        ),
      ),
    );
  }
}

class _Retry extends StatelessWidget {
  final double height;
  final VoidCallback? onRetry;
  const _Retry({required this.height, this.onRetry});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: Center(
        child: TextButton.icon(
          onPressed: onRetry,
          icon: const Icon(Icons.refresh_rounded),
          label: Text('filter_sheet_load_error_retry'.tr()),
        ),
      ),
    );
  }
}
