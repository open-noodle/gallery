import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

/// Shared shell for Deep filter-sheet sections — title + optional trailing header
/// + loading skeleton / error retry / empty caption / childBuilder output.
///
/// Caches the last-seen data list so that when the upstream family provider is
/// swapped (filter changed → fresh AsyncLoading), we keep rendering stale data
/// instead of flashing a skeleton. Skeleton only shows on true first-load.
/// On AsyncError with cached data present, we also keep rendering the cache
/// (no retry button) — per-section failure recovery stays silent.
class DeepSectionScaffold<T> extends StatefulWidget {
  final String titleKey;
  final String emptyCaptionKey;
  final AsyncValue<List<T>> items;
  final VoidCallback? onRetry;
  final Widget Function(List<T> data) childBuilder;

  /// Optional trailing widget that sits next to the title (sections inject a
  /// "Search N →" affordance here — consumed by Tasks A4 / A7).
  final Widget? trailingHeader;

  const DeepSectionScaffold({
    super.key,
    required this.titleKey,
    required this.emptyCaptionKey,
    required this.items,
    required this.childBuilder,
    this.onRetry,
    this.trailingHeader,
  });

  @override
  State<DeepSectionScaffold<T>> createState() => _DeepSectionScaffoldState<T>();
}

class _DeepSectionScaffoldState<T> extends State<DeepSectionScaffold<T>> {
  List<T>? _lastData;

  @override
  Widget build(BuildContext context) {
    final items = widget.items;
    final data = items.valueOrNull;
    if (data != null) _lastData = data;

    final theme = Theme.of(context);
    final title = Text(
      widget.titleKey.tr().toUpperCase(),
      overflow: TextOverflow.ellipsis,
      style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 2, color: theme.colorScheme.outline),
    );

    final header = Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
      child: Row(
        children: [
          Expanded(child: title),
          if (widget.trailingHeader != null) Flexible(child: widget.trailingHeader!),
        ],
      ),
    );

    Widget body;
    final cache = _lastData;
    if (cache != null) {
      if (cache.isEmpty) {
        body = Padding(
          key: const Key('deep-section-empty'),
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Text(
            widget.emptyCaptionKey.tr(),
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
          ),
        );
      } else {
        body = Padding(padding: const EdgeInsets.symmetric(horizontal: 20), child: widget.childBuilder(cache));
      }
    } else if (items is AsyncError) {
      body = _DeepRetry(onRetry: widget.onRetry);
    } else {
      body = const _DeepSkeleton();
    }

    return Column(
      key: const Key('deep-section-scaffold'),
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [header, body],
    );
  }
}

class _DeepSkeleton extends StatelessWidget {
  const _DeepSkeleton();

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.surfaceContainerHighest;
    Widget bar({required double width, required double height}) => Container(
      width: width,
      height: height,
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(10)),
    );

    return Padding(
      key: const Key('deep-section-skeleton'),
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          bar(width: double.infinity, height: 36),
          const SizedBox(height: 10),
          bar(width: double.infinity, height: 36),
          const SizedBox(height: 10),
          bar(width: 220, height: 36),
        ],
      ),
    );
  }
}

class _DeepRetry extends StatelessWidget {
  final VoidCallback? onRetry;
  const _DeepRetry({this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      child: Center(
        child: TextButton.icon(
          key: const Key('deep-section-retry'),
          onPressed: onRetry,
          icon: const Icon(Icons.refresh_rounded),
          label: Text('filter_sheet_load_error_retry'.tr()),
        ),
      ),
    );
  }
}
