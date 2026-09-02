import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep_content.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';

/// The draggable sheet holding the filter panel.
///
/// Mount gate: iff `photosFilterSheetProvider != hidden`. The sheet has a
/// single resting extent — full height. A downward drag either settles below
/// [_dismissThreshold] and closes the sheet, or springs back to full; there is
/// no intermediate half-height state to land on.
class FilterSheet extends ConsumerStatefulWidget {
  const FilterSheet({super.key});

  @override
  ConsumerState<FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends ConsumerState<FilterSheet> {
  /// The sheet's only resting extent. Deliberately short of 1.0 so a strip of
  /// dimmed timeline stays visible above it: that strip is the scrim's tap
  /// target, and it keeps the panel reading as a layer over the photos rather
  /// than a screen of its own.
  static const _snapFull = 0.95;

  /// Lowest extent the sheet can be dragged to before it dismisses.
  /// Below this, we set state → hidden and the sheet unmounts.
  static const _dismissThreshold = 0.5;

  /// Allow drag to go below [_snapFull] so the dismiss gesture is reachable.
  static const _minExtent = 0.3;

  /// A live drag fires a `DraggableScrollableNotification` on every frame of
  /// motion, so a "half" swipe can dip below the dismiss threshold well before
  /// the user's thumb comes to rest — e.g. on its way back up after an
  /// overshoot. Committing the dismiss on one of those transient extents
  /// unmounts `DeepContent` and, with it, the sheet itself while the drag is
  /// still live — losing the notification stream and, further up, the pointer
  /// routing for the rest of that same gesture (#1002). Debounce so only the
  /// extent the drag actually *settles* on (no further motion for
  /// [_settleDelay]) commits.
  static const _settleDelay = Duration(milliseconds: 160);
  Timer? _settleTimer;

  @override
  void dispose() {
    _settleTimer?.cancel();
    super.dispose();
  }

  bool _onNotification(DraggableScrollableNotification n) {
    final extent = n.extent;
    _settleTimer?.cancel();
    _settleTimer = Timer(_settleDelay, () => _commitSettledExtent(extent));
    return false;
  }

  void _commitSettledExtent(double extent) {
    if (!mounted || extent >= _dismissThreshold) return;
    if (ref.read(photosFilterSheetProvider) != FilterSheetVisibility.hidden) {
      ref.read(photosFilterSheetProvider.notifier).state = FilterSheetVisibility.hidden;
    }
  }

  void _close() => ref.read(photosFilterSheetProvider.notifier).state = FilterSheetVisibility.hidden;

  @override
  Widget build(BuildContext context) {
    // Resolved here rather than inside the listener below: an inherited-widget
    // lookup belongs in build, not in a callback that runs at an arbitrary
    // point in the element's life cycle.
    final accessibleNavigation = MediaQuery.accessibleNavigationOf(context);
    final view = View.of(context);
    final textDirection = Directionality.of(context);

    // Registered before the mount gate below, so it also sees hidden → visible.
    // (Inside the gate it would only be registered on builds where the sheet is
    // already up, and so would never fire for the transition that opens it.)
    ref.listen<FilterSheetVisibility>(photosFilterSheetProvider, (prev, next) {
      if (next == FilterSheetVisibility.hidden || !accessibleNavigation) return;
      SemanticsService.sendAnnouncement(view, 'filter panel opened', textDirection);
    });

    if (ref.watch(photosFilterSheetProvider) == FilterSheetVisibility.hidden) return const SizedBox.shrink();

    final theme = Theme.of(context);

    return PopScope(
      // While the sheet is visible, intercept system back to close it. Only
      // once the sheet is hidden does back propagate up to the tab shell / app.
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        _close();
      },
      child: Stack(
        children: [
          Positioned.fill(
            child: GestureDetector(
              key: const Key('filter-sheet-scrim'),
              behavior: HitTestBehavior.opaque,
              onTap: _close,
              child: ColoredBox(color: theme.colorScheme.scrim.withValues(alpha: 0.32)),
            ),
          ),
          NotificationListener<DraggableScrollableNotification>(
            onNotification: _onNotification,
            child: DraggableScrollableSheet(
              initialChildSize: _snapFull,
              minChildSize: _minExtent,
              maxChildSize: _snapFull,
              snap: true,
              // One snap target: a drag that does not go far enough to dismiss
              // springs back to full height instead of resting half-way.
              snapSizes: const [_snapFull],
              builder: (context, scrollController) => DeepContent(scrollController: scrollController),
            ),
          ),
        ],
      ),
    );
  }
}
