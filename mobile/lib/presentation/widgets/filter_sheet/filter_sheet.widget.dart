import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/browse_content.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep_content.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';

/// The single draggable sheet owning browse / deep snaps.
///
/// Mount gate: iff `photosFilterSheetProvider != hidden`. Programmatic snap
/// changes animate the `DraggableScrollableController` to the target extent.
class FilterSheet extends ConsumerStatefulWidget {
  const FilterSheet({super.key});

  @override
  ConsumerState<FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends ConsumerState<FilterSheet> {
  final _controller = DraggableScrollableController();

  static const _snapBrowse = 0.62;
  static const _snapDeep = 0.95;
  static const _snapTolerance = 0.02;

  /// Lowest extent the sheet can be dragged to before it dismisses.
  /// Below this, we set state → hidden and the sheet unmounts.
  static const _dismissThreshold = 0.5;

  /// Allow drag to go below `_snapBrowse` so the dismiss gesture is reachable.
  static const _minExtent = 0.3;

  double _targetExtent(FilterSheetSnap snap) => switch (snap) {
    FilterSheetSnap.browse => _snapBrowse,
    FilterSheetSnap.deep => _snapDeep,
    FilterSheetSnap.hidden => _snapBrowse,
  };

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  bool _onNotification(DraggableScrollableNotification n) {
    if (n.extent < _dismissThreshold) {
      final current = ref.read(photosFilterSheetProvider);
      if (current != FilterSheetSnap.hidden) {
        ref.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.hidden;
      }
      return false;
    }
    final mapping = <double, FilterSheetSnap>{_snapBrowse: FilterSheetSnap.browse, _snapDeep: FilterSheetSnap.deep};
    for (final entry in mapping.entries) {
      if ((n.extent - entry.key).abs() < _snapTolerance) {
        final current = ref.read(photosFilterSheetProvider);
        if (current != entry.value) {
          ref.read(photosFilterSheetProvider.notifier).state = entry.value;
        }
        return false;
      }
    }
    return false;
  }

  void _onScrimTap() {
    final snap = ref.read(photosFilterSheetProvider);
    final next = switch (snap) {
      FilterSheetSnap.deep => FilterSheetSnap.browse,
      FilterSheetSnap.browse => FilterSheetSnap.hidden,
      FilterSheetSnap.hidden => FilterSheetSnap.hidden,
    };
    ref.read(photosFilterSheetProvider.notifier).state = next;
  }

  @override
  Widget build(BuildContext context) {
    final snap = ref.watch(photosFilterSheetProvider);
    if (snap == FilterSheetSnap.hidden) return const SizedBox.shrink();

    ref.listen<FilterSheetSnap>(photosFilterSheetProvider, (prev, next) {
      if (next == FilterSheetSnap.hidden || !_controller.isAttached) return;
      final target = _targetExtent(next);
      if ((_controller.size - target).abs() < 0.01) return;
      _controller.animateTo(target, duration: const Duration(milliseconds: 280), curve: Curves.easeOutCubic);
      if (MediaQuery.of(context).accessibleNavigation) {
        SemanticsService.sendAnnouncement(View.of(context), 'filter panel ${next.name}', Directionality.of(context));
      }
    });

    final theme = Theme.of(context);
    final scrimVisible = snap == FilterSheetSnap.browse || snap == FilterSheetSnap.deep;

    return PopScope(
      // While the sheet is visible, intercept system back: collapse
      // deep → browse, or close browse → hidden. Only once the sheet is
      // hidden does back propagate up to the tab shell / app.
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        ref.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.hidden;
      },
      child: Stack(
        children: [
          Positioned.fill(
            child: IgnorePointer(
              ignoring: !scrimVisible,
              child: AnimatedOpacity(
                duration: const Duration(milliseconds: 150),
                opacity: scrimVisible ? 1 : 0,
                child: GestureDetector(
                  key: const Key('filter-sheet-scrim'),
                  behavior: HitTestBehavior.opaque,
                  onTap: _onScrimTap,
                  child: ColoredBox(color: theme.colorScheme.scrim.withValues(alpha: 0.32)),
                ),
              ),
            ),
          ),
          NotificationListener<DraggableScrollableNotification>(
            onNotification: _onNotification,
            child: DraggableScrollableSheet(
              controller: _controller,
              initialChildSize: _targetExtent(snap),
              minChildSize: _minExtent,
              maxChildSize: _snapDeep,
              snap: true,
              snapSizes: const [_snapBrowse, _snapDeep],
              builder: (context, scrollController) => _snapChild(snap, scrollController),
            ),
          ),
        ],
      ),
    );
  }

  Widget _snapChild(FilterSheetSnap snap, ScrollController scrollController) {
    switch (snap) {
      case FilterSheetSnap.browse:
        return BrowseContent(scrollController: scrollController);
      case FilterSheetSnap.deep:
        return DeepContent(scrollController: scrollController);
      case FilterSheetSnap.hidden:
        return const SizedBox.shrink();
    }
  }
}
