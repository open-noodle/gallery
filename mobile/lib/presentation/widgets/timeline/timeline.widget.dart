import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/events.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/utils/event_stream.dart';
import 'package:immich_mobile/extensions/asyncvalue_extensions.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/download_status_floating_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/general_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/constants.dart';
import 'package:immich_mobile/presentation/widgets/timeline/multi_select_status_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/scroll_drain.dart';
import 'package:immich_mobile/presentation/widgets/timeline/scrubber.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/sliver_segmented_list.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.state.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_drag_selection.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_pinch_zoom.dart';
import 'package:immich_mobile/providers/asset_viewer/scroll_to_date_notifier.provider.dart';
import 'package:immich_mobile/providers/infrastructure/readonly_mode.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/routing/app_navigation_observer.dart';
import 'package:immich_mobile/utils/debounce.dart';
import 'package:immich_mobile/widgets/common/immich_loading_indicator.dart';
import 'package:immich_mobile/widgets/common/immich_sliver_app_bar.dart';
import 'package:immich_mobile/widgets/common/mesmerizing_sliver_app_bar.dart';
import 'package:immich_mobile/widgets/common/selection_sliver_app_bar.dart';

class Timeline extends ConsumerWidget {
  const Timeline({
    super.key,
    this.topSliverWidget,
    this.topSliverWidgetHeight,
    this.bottomSliverWidget,
    this.showStorageIndicator = false,
    this.withStack = false,
    this.appBar = const ImmichSliverAppBar(floating: true, pinned: false, snap: false),
    this.bottomSheet = const GeneralBottomSheet(minChildSize: 0.23),
    this.groupBy,
    this.withScrubber = true,
    this.snapToMonth = true,
    this.readOnly = false,
    this.persistentBottomBar = false,
    this.loadingWidget,
  });

  final Widget? topSliverWidget;
  final double? topSliverWidgetHeight;
  final Widget? bottomSliverWidget;
  final bool showStorageIndicator;
  final Widget? appBar;
  final Widget? bottomSheet;
  final bool withStack;
  final GroupAssetsBy? groupBy;
  final bool withScrubber;
  final bool snapToMonth;
  final bool readOnly;
  final bool persistentBottomBar;
  final Widget? loadingWidget;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final columnCount = ref.watch(appConfigProvider.select((config) => config.timeline.tilesPerRow));
    return LayoutBuilder(
      builder: (_, constraints) {
        return ProviderScope(
          overrides: [
            // overrideWithValue keeps the scoped args in sync with the latest constraints on rebuilds,
            // a function override would stay locked to the first frame's constraints for the whole session
            timelineArgsProvider.overrideWithValue(
              TimelineArgs(
                maxWidth: constraints.maxWidth,
                maxHeight: constraints.maxHeight,
                columnCount: columnCount,
                showStorageIndicator: showStorageIndicator,
                withStack: withStack,
                groupBy: groupBy,
              ),
            ),
            if (readOnly) readonlyModeProvider.overrideWith(() => _AlwaysReadOnlyNotifier()),
          ],
          child: _SliverTimeline(
            topSliverWidget: topSliverWidget,
            topSliverWidgetHeight: topSliverWidgetHeight,
            bottomSliverWidget: bottomSliverWidget,
            appBar: appBar,
            bottomSheet: bottomSheet,
            withScrubber: withScrubber,
            persistentBottomBar: persistentBottomBar,
            snapToMonth: snapToMonth,
            maxWidth: constraints.maxWidth,
            loadingWidget: loadingWidget,
          ),
        );
      },
    );
  }
}

class _AlwaysReadOnlyNotifier extends ReadOnlyModeNotifier {
  @override
  bool build() => true;

  @override
  void setReadonlyMode(bool value) {}

  @override
  void toggleReadonlyMode() {}
}

class _SliverTimeline extends ConsumerStatefulWidget {
  const _SliverTimeline({
    this.topSliverWidget,
    this.topSliverWidgetHeight,
    this.bottomSliverWidget,
    this.appBar,
    this.bottomSheet,
    this.withScrubber = true,
    this.persistentBottomBar = false,
    this.snapToMonth = true,
    this.maxWidth,
    this.loadingWidget,
  });

  final Widget? topSliverWidget;
  final double? topSliverWidgetHeight;
  final Widget? bottomSliverWidget;
  final Widget? appBar;
  final Widget? bottomSheet;
  final bool withScrubber;
  final bool persistentBottomBar;
  final bool snapToMonth;
  final double? maxWidth;
  final Widget? loadingWidget;

  @override
  ConsumerState createState() => _SliverTimelineState();
}

class _SliverTimelineState extends ConsumerState<_SliverTimeline> with WidgetsBindingObserver {
  late final ScrollController _scrollController;
  StreamSubscription? _eventSubscription;

  int? _restoreAssetIndex;

  final Debouncer _fastScrollDebouncer = Debouncer(interval: const Duration(milliseconds: 100));

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _scrollController = ScrollController(onAttach: _restoreAssetPosition);
    _eventSubscription = EventStream.shared.listen(_onEvent);

    ref.listenManual(multiSelectProvider.select((s) => s.isEnabled), _onMultiSelectionToggled);

    // Drain any pending "view in timeline" request. It is latched in
    // [scrollToDateNotifierProvider] so it survives this timeline being mounted
    // fresh by the navigation (e.g. coming from a memory or a notification)
    // before its segments have loaded and laid out.
    scrollToDateNotifierProvider.addListener(_requestScrollDrain);
    ref.listenManual(timelineSegmentProvider, (_, __) => _requestScrollDrain());
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _requestScrollDrain();
    });
  }

  @override
  void didUpdateWidget(covariant _SliverTimeline oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.maxWidth != oldWidget.maxWidth) {
      // The updated args already regenerate the segments, only remember the scroll position to restore it afterwards
      final segments = ref.read(timelineSegmentProvider).valueOrNull;
      if (segments != null && _scrollController.hasClients) {
        _restoreAssetIndex = _getCurrentAssetIndex(segments);
      }
    }
  }

  // Capture iOS status bar tap
  @override
  void handleStatusBarTap() {
    // Routes may be pushed non-opaquely on top of the timeline (such as the asset viewer), or the timeline
    // may be in a background tab. In either case, `handleStatusBarTap()` still fires
    // Make sure the timeline is the primary route before scrolling to the top
    final routeData = context.findAncestorWidgetOfExactType<RouteDataScope>()?.routeData;
    // The tap is generated async, so it can arrive after a route pop has started (due to a back button or similar)
    // Check if route is alive and not exiting before taking action
    final observers = Navigator.maybeOf(context)?.widget.observers ?? const <NavigatorObserver>[];
    final isRouteTransitioning = observers.whereType<TransitioningRouteObserver>().any(
      (observer) => observer.hasTransitioningRoute,
    );

    if (ModalRoute.of(context)?.isCurrent == true && routeData?.isActive == true && !isRouteTransitioning) {
      _scrollToTop();
    }
  }

  void _onEvent(Event event) {
    switch (event) {
      case ScrollToTopEvent():
        _scrollToTop();
      case TimelineReloadEvent():
        setState(() {});
      default:
        break;
    }
  }

  void _restoreAssetPosition(_) {
    if (_restoreAssetIndex == null) {
      return;
    }

    final asyncSegments = ref.read(timelineSegmentProvider);
    asyncSegments.whenData((segments) {
      final targetSegment = segments.lastWhereOrNull((segment) => segment.firstAssetIndex <= _restoreAssetIndex!);
      if (targetSegment != null) {
        final assetIndexInSegment = _restoreAssetIndex! - targetSegment.firstAssetIndex;
        final newColumnCount = ref.read(timelineArgsProvider).columnCount;
        final rowIndexInSegment = (assetIndexInSegment / newColumnCount).floor();
        final targetRowIndex = targetSegment.firstIndex + 1 + rowIndexInSegment;
        final targetOffset = targetSegment.indexToLayoutOffset(targetRowIndex);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            _scrollController.jumpTo(targetOffset.clamp(0.0, _scrollController.position.maxScrollExtent));
          }
        });
      }
    });
    _restoreAssetIndex = null;
  }

  void _onMultiSelectionToggled(_, bool isEnabled) {
    EventStream.shared.emit(MultiSelectToggleEvent(isEnabled));
  }

  int? _getCurrentAssetIndex(List<Segment> segments) {
    final currentOffset = _scrollController.offset.clamp(0.0, _scrollController.position.maxScrollExtent);
    final segment = segments.findByOffset(currentOffset) ?? segments.lastOrNull;
    int? targetAssetIndex;
    if (segment != null) {
      final rowIndex = segment.getMinChildIndexForScrollOffset(currentOffset);
      if (rowIndex > segment.firstIndex) {
        final rowIndexInSegment = rowIndex - (segment.firstIndex + 1);
        final assetsPerRow = ref.read(timelineArgsProvider).columnCount;
        final assetIndexInSegment = rowIndexInSegment * assetsPerRow;
        targetAssetIndex = segment.firstAssetIndex + assetIndexInSegment;
      } else {
        targetAssetIndex = segment.firstAssetIndex;
      }
    }
    return targetAssetIndex;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _fastScrollDebouncer.dispose();
    scrollToDateNotifierProvider.removeListener(_requestScrollDrain);
    _scrollController.dispose();
    unawaited(_eventSubscription?.cancel());
    super.dispose();
  }

  /// Track whether the timeline is moving fast enough to defer per-row asset loading
  bool _onScrollVelocityNotification(ScrollNotification notification) {
    // Only consider the primary timeline ScrollView (no nested views) and update events
    if (notification.depth != 0 || notification is! ScrollUpdateNotification) {
      return false;
    }

    // Use Flutter's built in fast velocity tracking
    if (_scrollController.position.recommendDeferredLoading(context)) {
      ref.read(timelineStateProvider.notifier).setRecommendDeferredLoading(true);

      // We cannot rely on scroll end events, as the timeline scrubber jumps from position
      // to position, resulting in large spikes in velocity followed by low velocity
      _fastScrollDebouncer.run(() => ref.read(timelineStateProvider.notifier).setRecommendDeferredLoading(false));
    }
    return false;
  }

  void _scrollToTop() {
    if (!_scrollController.hasClients) {
      return;
    }

    _scrollController.animateTo(0, duration: const Duration(milliseconds: 250), curve: Curves.easeInOut);
  }

  bool _scrollDrainScheduled = false;
  int _scrollDrainAttempts = 0;
  static const int _maxScrollDrainAttempts = 180;

  /// Ensures a single retry loop is running to apply a pending scroll request.
  void _requestScrollDrain() {
    if (scrollToDateNotifierProvider.value == null) return;
    if (_scrollDrainScheduled) return;
    _scrollDrainScheduled = true;
    _scrollDrainAttempts = 0;
    _attemptScrollDrain();
  }

  /// Retries every frame until the timeline can actually scroll to the latched
  /// date (segments loaded, scroll view attached and laid out, matching segment
  /// present), then consumes the request. This survives the timeline being
  /// reloaded fresh by the navigation, where the scroll view is not yet laid out
  /// for several frames (so an early scroll would clamp to the top).
  void _attemptScrollDrain() {
    if (!mounted) {
      _scrollDrainScheduled = false;
      return;
    }

    final date = scrollToDateNotifierProvider.value;
    final segments = ref.read(timelineSegmentProvider).valueOrNull;
    final laidOut = _scrollController.hasClients && _scrollController.position.hasContentDimensions;
    final matched = date != null && segments != null && _findSegmentForDate(segments, date) != null;

    final action = decideScrollDrain(
      hasPending: date != null,
      segmentsLoaded: segments != null,
      laidOut: laidOut,
      segmentMatched: matched,
      attempts: _scrollDrainAttempts,
      maxAttempts: _maxScrollDrainAttempts,
    );

    switch (action) {
      case ScrollDrainAction.idle:
        _scrollDrainScheduled = false;
      case ScrollDrainAction.scroll:
        _scrollToDate(date!, segments!);
        scrollToDateNotifierProvider.consume();
        _scrollDrainScheduled = false;
      case ScrollDrainAction.giveUp:
        // Budget exhausted: drop the request so it cannot leak into a later timeline.
        scrollToDateNotifierProvider.consume();
        _scrollDrainScheduled = false;
      case ScrollDrainAction.retry:
        _scrollDrainAttempts++;
        WidgetsBinding.instance.addPostFrameCallback((_) => _attemptScrollDrain());
    }
  }

  Segment? _findSegmentForDate(List<Segment> segments, DateTime date) {
    final dates = segments
        .map((segment) => segment.bucket is TimeBucket ? (segment.bucket as TimeBucket).date : null)
        .toList(growable: false);
    final index = findMatchingSegmentIndex(dates, date);
    return index == null ? null : segments[index];
  }

  void _scrollToDate(DateTime date, List<Segment> segments) {
    final segment = _findSegmentForDate(segments, date);
    if (segment == null) return;

    final maxExtent = _scrollController.position.maxScrollExtent;
    final targetOffset = (segment.startOffset - 50).clamp(0.0, maxExtent);
    _scrollController.animateTo(targetOffset, duration: const Duration(milliseconds: 500), curve: Curves.easeInOut);
  }

  @override
  Widget build(BuildContext _) {
    final asyncSegments = ref.watch(timelineSegmentProvider);
    final maxHeight = ref.watch(timelineArgsProvider.select((args) => args.maxHeight));
    final isSelectionMode = ref.watch(multiSelectProvider.select((s) => s.forceEnable));
    final isMultiSelectEnabled = ref.watch(multiSelectProvider.select((s) => s.isEnabled));
    final isMultiSelectStatusVisible = !isSelectionMode && isMultiSelectEnabled;
    final isBottomWidgetVisible =
        widget.bottomSheet != null && (isMultiSelectStatusVisible || widget.persistentBottomBar);

    return PopScope(
      canPop: !isMultiSelectEnabled,
      onPopInvokedWithResult: (_, _) {
        if (isMultiSelectEnabled) {
          ref.read(multiSelectProvider.notifier).reset();
        }
      },
      child: BackButtonListener(
        onBackButtonPressed: () async {
          if (!isMultiSelectEnabled) {
            return false;
          }
          ref.read(multiSelectProvider.notifier).reset();
          return true;
        },
        child: PrimaryScrollController(
          controller: _scrollController,
          child: Scaffold(
            // This removes the built in Scaffold `handleStatusBarTap` implementation, preventing duplicate
            // events when we provide our own
            primary: false,
            resizeToAvoidBottomInset: false,
            floatingActionButton: const DownloadStatusFloatingButton(),
            body: asyncSegments.widgetWhen(
              onLoading: () =>
                  widget.loadingWidget ??
                  CustomScrollView(
                    slivers: [
                      if (widget.appBar != null) widget.appBar!,
                      const SliverFillRemaining(
                        hasScrollBody: false,
                        child: Center(child: ImmichLoadingIndicator()),
                      ),
                    ],
                  ),
              onData: (segments) {
                final childCount = (segments.lastOrNull?.lastIndex ?? -1) + 1;
                final double appBarExpandedHeight = widget.appBar != null && widget.appBar is MesmerizingSliverAppBar
                    ? 200
                    : 0;
                final topPadding = context.padding.top + (widget.appBar == null ? 0 : kToolbarHeight) + 10;

                const bottomSheetOpenModifier = 120.0;
                final contentBottomPadding =
                    context.padding.bottom + (isMultiSelectEnabled ? bottomSheetOpenModifier : 0);
                final scrubberBottomPadding = contentBottomPadding + kScrubberThumbHeight;

                return TimelinePinchZoom(
                  onColumnCountWillChange: () {
                    final targetAssetIndex = _getCurrentAssetIndex(segments);
                    setState(() {
                      _restoreAssetIndex = targetAssetIndex;
                    });
                  },
                  child: TimelineDragSelection(
                    builder: (physics) {
                      final grid = CustomScrollView(
                        primary: true,
                        physics: physics,
                        scrollCacheExtent: .pixels(maxHeight * 2),
                        slivers: [
                          if (isSelectionMode)
                            const SelectionSliverAppBar()
                          else if (widget.appBar != null)
                            widget.appBar!,
                          if (widget.topSliverWidget != null) widget.topSliverWidget!,
                          SliverSegmentedList(
                            segments: segments,
                            delegate: SliverChildBuilderDelegate(
                              (ctx, index) {
                                if (index >= childCount) {
                                  return null;
                                }
                                final segment = segments.findByIndex(index);
                                return segment?.builder(ctx, index) ?? const SizedBox.shrink();
                              },
                              childCount: childCount,
                              addAutomaticKeepAlives: false,
                              // We add repaint boundary around tiles, so skip the auto boundaries
                              addRepaintBoundaries: false,
                            ),
                          ),
                          if (widget.bottomSliverWidget != null) widget.bottomSliverWidget!,
                          SliverPadding(padding: EdgeInsets.only(bottom: contentBottomPadding)),
                        ],
                      );

                      final Widget timeline;
                      if (widget.withScrubber) {
                        timeline = Scrubber(
                          snapToMonth: widget.snapToMonth,
                          layoutSegments: segments,
                          timelineHeight: maxHeight,
                          topPadding: topPadding,
                          bottomPadding: scrubberBottomPadding,
                          monthSegmentSnappingOffset: widget.topSliverWidgetHeight ?? 0 + appBarExpandedHeight,
                          hasAppBar: widget.appBar != null,
                          child: grid,
                        );
                      } else {
                        timeline = grid;
                      }

                      return Stack(
                        clipBehavior: Clip.none,
                        children: [
                          NotificationListener<ScrollNotification>(
                            onNotification: _onScrollVelocityNotification,
                            child: timeline,
                          ),
                          if (isBottomWidgetVisible)
                            Positioned(
                              top: MediaQuery.paddingOf(context).top,
                              left: 25,
                              child: const SizedBox(
                                height: kToolbarHeight,
                                child: Center(child: MultiSelectStatusButton()),
                              ),
                            ),
                          if (isBottomWidgetVisible) widget.bottomSheet!,
                        ],
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}
