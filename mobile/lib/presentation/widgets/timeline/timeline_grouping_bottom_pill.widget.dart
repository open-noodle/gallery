import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/dock/gallery_dock.widget.dart';
import 'package:immich_mobile/gallery/dock/gallery_dock_grouping.widget.dart';
import 'package:immich_mobile/gallery/dock/gallery_dock_style.dart';
import 'package:immich_mobile/gallery/search/search_timeline_hooks.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';

/// Floating bottom pill on detail timelines: the Photos dock's grouping row ([GalleryGroupingRow] on a
/// [GalleryGlass]), with search at the end on screens that have one, so it looks and moves exactly like the dock.
///
/// Always visible on detail timelines (the scrolls-away top header it replaces was the bug);
/// hides only for multiselect (the selection bottom sheet takes the bottom edge) and while
/// the keyboard is up.
class TimelineGroupingBottomPill extends ConsumerWidget {
  const TimelineGroupingBottomPill({super.key});

  /// Height reserved by the pill; the timeline derives its bottom content clearance from this.
  static const double pillHeight = GalleryDock.groupingHeight;
  static const double bottomFloat = 26.0;

  static const double _keyboardThreshold = 80.0;
  static const Duration _hideAnimation = Duration(milliseconds: 200);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mq = MediaQuery.of(context);
    final hiddenForMultiSelect = ref.watch(multiSelectProvider.select((s) => s.isEnabled || s.forceEnable));
    final keyboardUp = mq.viewInsets.bottom > _keyboardThreshold;
    final hiding = hiddenForMultiSelect || keyboardUp;
    // The search entry on screens with a search (lib/gallery/search).
    final searchable = TimelinePillSearchButton.visible(ref);
    final duration = mq.disableAnimations ? Duration.zero : _hideAnimation;
    final bottomInset = GalleryDockStyle.bottomInset(context);

    return TweenAnimationBuilder<double>(
      key: const Key('timeline-grouping-bottom-pill-slide'),
      tween: Tween<double>(end: hiding ? 12.0 : 0.0),
      duration: duration,
      curve: Curves.easeOutCubic,
      builder: (_, slide, child) => Transform.translate(offset: Offset(0, slide), child: child),
      child: AnimatedOpacity(
        key: const Key('timeline-grouping-bottom-pill-opacity'),
        duration: duration,
        opacity: hiding ? 0 : 1,
        child: IgnorePointer(
          ignoring: hiding,
          child: Align(
            alignment: Alignment.bottomCenter,
            child: Padding(
              padding: EdgeInsets.only(
                left: GalleryDockStyle.sideInset,
                right: GalleryDockStyle.sideInset,
                bottom: bottomInset,
              ),
              child: SizedBox(
                key: const Key('timeline-grouping-bottom-pill'),
                height: pillHeight,
                child: GalleryGlass(
                  child: GalleryGroupingRow(trailing: const TimelinePillSearchButton(), showTrailing: searchable),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
