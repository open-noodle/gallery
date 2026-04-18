import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

/// Shared shell for Browse strips — title + loading skeleton + error + empty.
///
/// Caches the last-seen data list so that when the upstream family provider
/// is swapped out (filter changed → new provider instance → fresh AsyncLoading),
/// we keep rendering stale data instead of flashing a skeleton. Skeleton only
/// shows on true first-load.
class StripScaffold extends ConsumerStatefulWidget {
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
  ConsumerState<StripScaffold> createState() => _StripScaffoldState();
}

class _StripScaffoldState extends ConsumerState<StripScaffold> {
  List<dynamic>? _lastData;

  @override
  Widget build(BuildContext context) {
    final items = widget.items;
    final data = items.valueOrNull;
    if (data != null) _lastData = data;

    // Cached-empty → stay collapsed, including through subsequent refetches.
    // Avoids the skeleton briefly pushing content down only to snap back up.
    if (_lastData != null && _lastData!.isEmpty) {
      return const SizedBox.shrink();
    }

    final theme = Theme.of(context);
    final title = Padding(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 12),
      child: Text(
        widget.titleKey.tr().toUpperCase(),
        style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 2, color: theme.colorScheme.outline),
      ),
    );

    Widget body;
    if (_lastData != null) {
      body = SizedBox(height: widget.height, child: widget.childBuilder(_lastData!));
    } else if (items is AsyncError) {
      body = _Retry(height: widget.height, onRetry: widget.onRetry);
    } else {
      body = _Skeleton(height: widget.height);
    }

    return Column(
      key: const Key('strip-scaffold'),
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
      key: const Key('strip-skeleton'),
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
      key: const Key('strip-retry'),
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
