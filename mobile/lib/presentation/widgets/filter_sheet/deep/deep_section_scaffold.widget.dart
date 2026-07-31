import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/collapsible_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';

/// Shared shell for Deep filter-sheet sections — title + optional trailing header
/// + loading skeleton / error retry / empty caption / childBuilder output.
///
/// Caches the last-seen data list so that when the upstream family provider is
/// swapped (filter changed → fresh AsyncLoading), we keep rendering stale data
/// instead of flashing a skeleton. Skeleton only shows on true first-load.
/// On AsyncError with cached data present, we also keep rendering the cache
/// (no retry button) — per-section failure recovery stays silent.
class DeepSectionScaffold<T> extends StatefulWidget {
  final FilterSectionId sectionId;
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
    required this.sectionId,
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

    final cache = _lastData;
    final isEmpty = cache != null && cache.isEmpty;

    Widget body;
    if (cache != null) {
      // Body is hidden by CollapsibleSection when empty; isEmpty drives the "(0)" + disabled header.
      // widget.emptyCaptionKey is kept on the constructor for callers, but its caption is
      // unreachable while isEmpty is true, so we skip building it here.
      body = cache.isEmpty
          ? const SizedBox.shrink()
          : Padding(padding: const EdgeInsets.symmetric(horizontal: 20), child: widget.childBuilder(cache));
    } else if (items is AsyncError) {
      body = _DeepRetry(onRetry: widget.onRetry);
    } else {
      body = const _DeepSkeleton();
    }

    return CollapsibleSection(
      key: const Key('deep-section-scaffold'),
      sectionId: widget.sectionId,
      titleKey: widget.titleKey,
      isEmpty: isEmpty,
      trailingHeader: isEmpty ? null : widget.trailingHeader,
      child: body,
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
