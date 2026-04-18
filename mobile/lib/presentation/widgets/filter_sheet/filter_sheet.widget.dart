import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/browse_content.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep_content.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/peek_content.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// The single draggable sheet owning peek / browse / deep snaps.
///
/// Mount gate: iff `photosFilterSheetProvider != hidden`. Programmatic snap
/// changes (tap rail → browse, Done → hidden, etc.) animate the
/// `DraggableScrollableController` to the target extent.
class FilterSheet extends ConsumerStatefulWidget {
  const FilterSheet({super.key});

  @override
  ConsumerState<FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends ConsumerState<FilterSheet> {
  final _controller = DraggableScrollableController();

  static const _snapPeek = 0.15;
  static const _snapBrowse = 0.62;
  static const _snapDeep = 0.95;
  static const _snapTolerance = 0.02;

  double _targetExtent(FilterSheetSnap snap) => switch (snap) {
    FilterSheetSnap.peek => _snapPeek,
    FilterSheetSnap.browse => _snapBrowse,
    FilterSheetSnap.deep => _snapDeep,
    FilterSheetSnap.hidden => _snapPeek,
  };

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  bool _onNotification(DraggableScrollableNotification n) {
    final mapping = <double, FilterSheetSnap>{
      _snapPeek: FilterSheetSnap.peek,
      _snapBrowse: FilterSheetSnap.browse,
      _snapDeep: FilterSheetSnap.deep,
    };
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
    final isEmpty = ref.read(photosFilterProvider).isEmpty;
    final snap = ref.read(photosFilterSheetProvider);
    final next = switch (snap) {
      FilterSheetSnap.deep => FilterSheetSnap.browse,
      FilterSheetSnap.browse => isEmpty ? FilterSheetSnap.hidden : FilterSheetSnap.peek,
      FilterSheetSnap.peek => FilterSheetSnap.hidden,
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
        SemanticsService.announce('filter panel ${next.name}', Directionality.of(context));
      }
    });

    final theme = Theme.of(context);
    final scrimVisible = snap == FilterSheetSnap.browse || snap == FilterSheetSnap.deep;

    return Stack(
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
            minChildSize: _snapPeek,
            maxChildSize: _snapDeep,
            snap: true,
            snapSizes: const [_snapPeek, _snapBrowse, _snapDeep],
            builder: (context, scrollController) => _snapChild(snap, scrollController),
          ),
        ),
      ],
    );
  }

  Widget _snapChild(FilterSheetSnap snap, ScrollController scrollController) {
    switch (snap) {
      case FilterSheetSnap.peek:
        return PeekContent(scrollController: scrollController);
      case FilterSheetSnap.browse:
        return BrowseContent(scrollController: scrollController);
      case FilterSheetSnap.deep:
        return DeepContent(scrollController: scrollController);
      case FilterSheetSnap.hidden:
        return const SizedBox.shrink();
    }
  }
}
