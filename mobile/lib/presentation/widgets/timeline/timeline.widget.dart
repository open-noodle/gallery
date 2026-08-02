import 'dart:async';
import 'dart:collection';
import 'dart:math' as math;

import 'package:auto_route/auto_route.dart';
import 'package:collection/collection.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/events.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/domain/utils/event_stream.dart';
import 'package:immich_mobile/extensions/asyncvalue_extensions.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/download_status_floating_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/general_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/asset_scan.dart';
import 'package:immich_mobile/presentation/widgets/timeline/constants.dart';
import 'package:immich_mobile/presentation/widgets/timeline/scroll_drain.dart';
import 'package:immich_mobile/presentation/widgets/timeline/scrubber.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.state.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_drag_region.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_anchor.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_bottom_pill.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_scroll_target.dart';
import 'package:immich_mobile/providers/asset_viewer/scroll_to_asset_notifier.provider.dart';
import 'package:immich_mobile/providers/infrastructure/readonly_mode.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/highlighted_asset.provider.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';
import 'package:immich_mobile/routing/app_navigation_observer.dart';
import 'package:immich_mobile/utils/debounce.dart';
import 'package:immich_mobile/widgets/common/immich_loading_indicator.dart';
import 'package:immich_mobile/widgets/common/immich_sliver_app_bar.dart';
import 'package:immich_mobile/widgets/common/mesmerizing_sliver_app_bar.dart';
import 'package:immich_mobile/widgets/common/selection_sliver_app_bar.dart';

double timelineScrubberSnappingOffset({required double? topSliverWidgetHeight, required double appBarExpandedHeight}) {
  return (topSliverWidgetHeight ?? 0) + appBarExpandedHeight;
}

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
    this.emptyWidget,
    this.withGroupingPill = false,
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

  /// Rendered in place of the grid when the timeline resolves to zero assets.
  /// The main Photos page passes a first-run/empty-results state here; detail
  /// timelines that omit it keep the previous (blank) behaviour.
  final Widget? emptyWidget;

  /// Overlay the always-visible Years|Months|All bottom pill and reserve bottom
  /// clearance for it. Detail timelines (album/space/person/...) opt in; the main
  /// Photos page keeps its app-bar chip and stays off.
  final bool withGroupingPill;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final columnCount = ref.watch(appConfigProvider.select((config) => config.timeline.tilesPerRow));
    return LayoutBuilder(
      builder: (_, constraints) {
        final sliverTimeline = _SliverTimeline(
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
          emptyWidget: emptyWidget,
          withGroupingPill: withGroupingPill,
        );
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
          // The pill overlays the whole timeline body — including the loading state — by
          // design: it is the always-visible grouping control, mirroring how the old top
          // header was present while content loaded.
          child: withGroupingPill
              ? Stack(children: [sliverTimeline, const TimelineGroupingBottomPill()])
              : sliverTimeline,
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
    this.emptyWidget,
    this.withGroupingPill = false,
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
  final Widget? emptyWidget;
  final bool withGroupingPill;

  @override
  ConsumerState createState() => _SliverTimelineState();
}

class _SliverTimelineState extends ConsumerState<_SliverTimeline> with WidgetsBindingObserver {
  late final ScrollController _scrollController;
  StreamSubscription? _eventSubscription;

  // Drag selection state
  bool _dragging = false;
  TimelineAssetIndex? _dragAnchorIndex;
  final Set<BaseAsset> _draggedAssets = HashSet();
  ScrollPhysics? _scrollPhysics;

  int _perRow = 4;
  double _scaleFactor = 3.0;
  double _baseScaleFactor = 3.0;
  int? _restoreAssetIndex;
  TimelineZoomAnchor? _scheduledZoomAnchor;
  TimelineZoomAnchor? _resolvingZoomAnchor;
  List<Segment>? _lastRenderedSegments;

  final Debouncer _fastScrollDebouncer = Debouncer(interval: const Duration(milliseconds: 100));

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _scrollController = ScrollController(onAttach: _restoreAssetPosition);
    _eventSubscription = EventStream.shared.listen(_onEvent);

    final currentTilesPerRow = ref.read(appConfigProvider.select((config) => config.timeline.tilesPerRow));
    _perRow = currentTilesPerRow;
    _scaleFactor = 7.0 - _perRow;
    _baseScaleFactor = _scaleFactor;

    ref.listenManual(multiSelectProvider.select((s) => s.isEnabled), _onMultiSelectionToggled);

    // Drain any pending "view in timeline" request. It is latched in
    // [scrollToAssetNotifierProvider] so it survives this timeline being mounted
    // fresh by the navigation (e.g. coming from a memory or a notification)
    // before its segments have loaded and laid out.
    scrollToAssetNotifierProvider.addListener(_requestScrollDrain);
    ref.listenManual(timelineSegmentProvider, (_, __) => _requestScrollDrain());
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _requestScrollDrain();
    });

    ref.listenManual(timelineOverviewModeProvider, _onGroupingChanged);
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

  // When the zoom level changes (e.g. via the grouping selector), anchor the
  // rebuilt timeline to the date currently at the top of the viewport so the
  // user keeps their place instead of jumping to the most recent content.
  void _onGroupingChanged(TimelineOverviewMode? previous, TimelineOverviewMode next) {
    if (previous == null || previous == next) {
      return;
    }
    // A pending "view in timeline" request is about to scroll precisely — including
    // for the grouping change this very drain loop just triggered. Don't overwrite
    // its target with a position-derived anchor.
    if (scrollToAssetNotifierProvider.value != null) {
      return;
    }
    // A card-tap drilldown sets an explicit year/month anchor right before it
    // changes the mode; don't overwrite it with a position-derived anchor.
    if (!ref.read(timelineZoomAnchorProvider).isEmpty) {
      return;
    }
    final segments = _lastRenderedSegments;
    if (segments == null) {
      return;
    }
    final topBucketDate = _currentTopVisibleDate(segments);
    if (topBucketDate == null) {
      return;
    }
    final anchorNotifier = ref.read(timelineZoomAnchorProvider.notifier);
    final resolved = resolveGroupingChangeAnchorDate(
      topBucketDate: topBucketDate,
      previousMode: previous,
      remembered: anchorNotifier.lastPositionDate,
    );
    anchorNotifier.setDate(resolved);
  }

  DateTime? _currentTopVisibleDate(List<Segment> segments) {
    if (segments.isEmpty || !_scrollController.hasClients) {
      return null;
    }
    final offset = _scrollController.offset.clamp(0.0, _scrollController.position.maxScrollExtent);
    final segment = segments.findByOffset(offset) ?? segments.firstOrNull;
    final bucket = segment?.bucket;
    return bucket is TimeBucket ? bucket.date : null;
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
    scrollToAssetNotifierProvider.removeListener(_requestScrollDrain);
    _resolvingScrollTarget = null;
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

    unawaited(_scrollController.animateTo(0, duration: const Duration(milliseconds: 250), curve: Curves.easeInOut));
  }

  bool _scrollDrainScheduled = false;
  int _scrollDrainAttempts = 0;
  static const int _maxScrollDrainAttempts = 180;
  bool _daySwitchRequested = false;

  /// Set once the overview->day switch has actually taken effect, so the wait for the
  /// rebuilt segments gets its own attempt budget rather than the remainder of the one
  /// the grouping write consumed.
  bool _postDaySwitchBudgetReset = false;

  /// The target the currently-open drain cycle is working on, so a NEWER request
  /// arriving mid-cycle gets a fresh attempt budget instead of the old one's remainder.
  TimelineScrollTarget? _drainingTarget;

  /// Non-null while an async index resolution is in flight. Blocks the drain loop
  /// from starting a second concurrent scan.
  TimelineScrollTarget? _resolvingScrollTarget;

  /// Incremented per resolution so a superseded cycle cannot touch shared state
  /// (scrubbing, highlight) after a newer jump has started.
  int _scrollResolveGeneration = 0;

  /// Ensures a single retry loop is running to apply a pending scroll request.
  void _requestScrollDrain() {
    final pending = scrollToAssetNotifierProvider.value;
    if (pending == null) return;
    if (_scrollDrainScheduled) {
      if (pending != _drainingTarget) {
        _drainingTarget = pending;
        _scrollDrainAttempts = 0;
        _daySwitchRequested = false;
        _postDaySwitchBudgetReset = false;
      }
      return;
    }
    _scrollDrainScheduled = true;
    _drainingTarget = pending;
    _scrollDrainAttempts = 0;
    _daySwitchRequested = false;
    _postDaySwitchBudgetReset = false;
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

    // A resolution is already in flight; it will restart the loop when it settles.
    if (_resolvingScrollTarget != null) {
      return;
    }

    final target = scrollToAssetNotifierProvider.value;
    final date = target?.date;
    final segments = ref.read(timelineSegmentProvider).valueOrNull;
    final laidOut = _scrollController.hasClients && _scrollController.position.hasContentDimensions;
    final matched = date != null && segments != null && _findSegmentForDate(segments, date) != null;
    final isOverview = segmentsAreOverview(segments);

    if (_daySwitchRequested && !isOverview && !_postDaySwitchBudgetReset) {
      _postDaySwitchBudgetReset = true;
      _scrollDrainAttempts = 0;
    }

    final action = decideScrollDrain(
      hasPending: date != null,
      segmentsLoaded: segments != null,
      laidOut: laidOut,
      segmentMatched: matched,
      isOverviewTimeline: isOverview,
      attempts: _scrollDrainAttempts,
      maxAttempts: _maxScrollDrainAttempts,
    );

    switch (action) {
      case ScrollDrainAction.idle:
        _scrollDrainScheduled = false;
        _daySwitchRequested = false;
        _drainingTarget = null;
      case ScrollDrainAction.scroll:
        _drainingTarget = null;
        unawaited(_beginScrollToAsset(target!, segments!));
      case ScrollDrainAction.giveUp:
        // Budget exhausted: drop the request so it cannot leak into a later timeline.
        scrollToAssetNotifierProvider.consume();
        _scrollDrainScheduled = false;
        _daySwitchRequested = false;
        _drainingTarget = null;
      case ScrollDrainAction.switchToDayGrouping:
        // Overview groupings render cards, not tiles. Drill to day the same way a
        // card tap does, then keep retrying until the rebuilt segments arrive.
        // `attempts` MUST increment here: if the grouping is pinned and set() is a
        // no-op, the budget is the only thing that ends this loop.
        _scrollDrainAttempts++;
        if (!_daySwitchRequested) {
          _daySwitchRequested = true;
          unawaited(ref.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.all));
        }
        WidgetsBinding.instance.addPostFrameCallback((_) => _attemptScrollDrain());
      case ScrollDrainAction.retry:
        _scrollDrainAttempts++;
        WidgetsBinding.instance.addPostFrameCallback((_) => _attemptScrollDrain());
    }
  }

  Segment? _findSegmentForDate(List<Segment> segments, DateTime date) {
    // findTimelineScrollTargetSegment adds a year-level fallback on top of the
    // day/month match, so a "view in timeline" request still resolves a segment
    // when the timeline is in Years/Months grouping (#625) — not only the day
    // grouping the scroll-drain mechanism (#643) was originally written for.
    return findTimelineScrollTargetSegment(segments, date);
  }

  /// Resolves [target] to its exact row and scrolls there, falling back to the top
  /// of the matched segment when the asset cannot be located.
  ///
  /// Owns the tail of the drain cycle: it consumes the request and releases
  /// `_scrollDrainScheduled` only after the async resolution settles, so a failed
  /// lookup cannot silently drop the request.
  Future<void> _beginScrollToAsset(TimelineScrollTarget target, List<Segment> segments) async {
    final segment = _findSegmentForDate(segments, target.date);
    if (segment == null) {
      // Defensive: decideScrollDrain only returns `scroll` when a segment matched,
      // so this is unreachable today. Release the cycle and re-open it rather than
      // returning bare, which would strand the still-latched request forever.
      _scrollDrainScheduled = false;
      _drainingTarget = null;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _requestScrollDrain();
      });
      return;
    }

    _resolvingScrollTarget = target;
    // Drop any highlight still showing from a previous jump.
    ref.read(timelineHighlightedAssetProvider.notifier).clear();

    final columnCount = ref.read(timelineArgsProvider).columnCount;
    final assetIndex = await findAssetIndex(
      loadAssets: ref.read(timelineServiceProvider).loadAssets,
      firstAssetIndex: segment.firstAssetIndex,
      assetCount: segment.bucket.assetCount,
      target: target.asset,
    );

    // `==` on TimelineScrollTarget compares date + refersToSameAsset, so re-tapping
    // the SAME photo mid-resolution reads as unchanged and is absorbed. That is
    // intended: the destination is identical, and restarting would only re-scan.
    final outcome = decideScrollResolve(
      stillMounted: mounted,
      // `hasContentDimensions` matches the pre-await gate: `maxScrollExtent` below
      // asserts on an attached-but-unlaid-out position in debug builds.
      stillHasClients: _scrollController.hasClients && _scrollController.position.hasContentDimensions,
      targetUnchanged: scrollToAssetNotifierProvider.value == target,
    );
    _resolvingScrollTarget = null;

    switch (outcome) {
      case ScrollResolveOutcome.abandonUnmounted:
        // The controller may have lost its clients while the widget is still alive;
        // in that case re-open the cycle rather than stranding the latched request.
        _scrollDrainScheduled = false;
        _daySwitchRequested = false;
        _drainingTarget = null;
        if (mounted) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) _requestScrollDrain();
          });
        }
        return;
      case ScrollResolveOutcome.abandonStale:
        // A newer request is latched. Release the cycle and let its listener run.
        _scrollDrainScheduled = false;
        _daySwitchRequested = false;
        _drainingTarget = null;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _requestScrollDrain();
        });
        return;
      case ScrollResolveOutcome.proceed:
        break;
    }

    final rowOffset = assetIndex == null
        ? null
        : assetRowOffset(segment: segment, assetIndexInTimeline: assetIndex, columnCount: columnCount);

    // Fallback: the asset is not in this segment (most likely a stack child — the
    // timeline collapses stacks to the primary, memories do not) or the geometry
    // could not be computed. Landing on the correct day beats not moving at all.
    final desiredOffset = rowOffset ?? (segment.startOffset - 50);
    final targetOffset = desiredOffset.clamp(0.0, _scrollController.position.maxScrollExtent);

    scrollToAssetNotifierProvider.consume();
    _scrollDrainScheduled = false;
    _daySwitchRequested = false;
    _drainingTarget = null;

    final timelineState = ref.read(timelineStateProvider.notifier);
    // Bumped here, where the cycle commits to scrolling — NOT on entry. A cycle that
    // bailed earlier never touched the deferred-loading flag, so it must not supersede (and strand the
    // reset of) a cycle that did.
    final generation = ++_scrollResolveGeneration;
    timelineState.setRecommendDeferredLoading(true);
    try {
      await _scrollController.animateTo(
        targetOffset,
        duration: const Duration(milliseconds: 500),
        curve: Curves.easeInOut,
      );
    } catch (_) {
      // An interrupted animation (user scrolls, controller detached, or a newer jump
      // replaced the ScrollActivity) completes with an error. Swallow it: this runs
      // under unawaited(), so an escaping error would surface as an unhandled async
      // error, and the finally below still restores the deferred-loading state.
    } finally {
      // Only the newest resolution may clear the flag. A superseded cycle resumes
      // early when its ScrollActivity is replaced, and must not clear it for an animation
      // that is still running.
      if (mounted && generation == _scrollResolveGeneration) {
        timelineState.setRecommendDeferredLoading(false);
      }
    }

    // Only mark a tile we actually landed on — not the day-level fallback.
    if (mounted && rowOffset != null && generation == _scrollResolveGeneration) {
      ref.read(timelineHighlightedAssetProvider.notifier).highlight(target.asset);
    }
  }

  void _scheduleZoomAnchorResolution({
    required TimelineZoomAnchor anchor,
    required TimelineOverviewMode mode,
    required List<Segment> segments,
  }) {
    if (anchor.isEmpty || _scheduledZoomAnchor == anchor || _resolvingZoomAnchor == anchor) {
      return;
    }

    _scheduledZoomAnchor = anchor;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }

      _scheduledZoomAnchor = null;
      _resolveZoomAnchor(anchor: anchor, mode: mode, segments: segments);
    });
  }

  void _resolveZoomAnchor({
    required TimelineZoomAnchor anchor,
    required TimelineOverviewMode mode,
    required List<Segment> segments,
  }) {
    if (ref.read(timelineZoomAnchorProvider) != anchor || !_scrollController.hasClients) {
      return;
    }

    final TimelineOverviewMode activeMode = ref.read(timelineArgsProvider).groupBy != null
        ? TimelineOverviewMode.all
        : ref.read(timelineOverviewModeProvider);
    if (activeMode != mode) {
      return;
    }

    final targetSegment = findTimelineZoomAnchorSegment(segments, anchor, mode);
    if (targetSegment == null) {
      return;
    }

    final targetOffset = targetSegment.startOffset - 50;
    _resolvingZoomAnchor = anchor;
    ref.read(timelineStateProvider.notifier).setScrubbing(true);
    unawaited(
      _scrollController
          .animateTo(
            targetOffset.clamp(0.0, _scrollController.position.maxScrollExtent),
            duration: const Duration(milliseconds: 500),
            curve: Curves.easeInOut,
          )
          .whenComplete(() {
            if (!mounted) {
              return;
            }

            if (ref.read(timelineZoomAnchorProvider) == anchor) {
              ref.read(timelineZoomAnchorProvider.notifier).clear();
            }
            if (_resolvingZoomAnchor == anchor) {
              _resolvingZoomAnchor = null;
            }
            ref.read(timelineStateProvider.notifier).setScrubbing(false);
          }),
    );
  }

  // Drag selection methods
  void _setDragStartIndex(TimelineAssetIndex index) {
    setState(() {
      _scrollPhysics = const ClampingScrollPhysics();
      _dragAnchorIndex = index;
      _dragging = true;
    });
  }

  void _stopDrag() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // Update the physics post frame to prevent sudden change in physics on iOS.
      if (mounted) {
        setState(() {
          _scrollPhysics = null;
        });
      }
    });
    setState(() {
      _dragging = false;
      _draggedAssets.clear();
    });
    final timelineState = ref.read(timelineStateProvider.notifier);
    Future.delayed(const Duration(milliseconds: 300), () {
      timelineState.setScrolling(false);
    });
  }

  Future<void> _dragScroll(ScrollDirection direction) {
    return _scrollController.animateTo(
      _scrollController.offset + (direction == ScrollDirection.forward ? 175 : -175),
      duration: const Duration(milliseconds: 125),
      curve: Curves.easeOut,
    );
  }

  void _handleDragAssetEnter(TimelineAssetIndex index) {
    if (_dragAnchorIndex == null || !_dragging) {
      return;
    }

    final timelineService = ref.read(timelineServiceProvider);
    final dragAnchorIndex = _dragAnchorIndex!;

    // Calculate the range of assets to select
    final startIndex = math.min(dragAnchorIndex.assetIndex, index.assetIndex);
    final endIndex = math.max(dragAnchorIndex.assetIndex, index.assetIndex);
    final count = endIndex - startIndex + 1;

    // Load the assets in the range
    if (timelineService.hasRange(startIndex, count)) {
      final selectedAssets = timelineService.getAssets(startIndex, count);

      // Clear previous drag selection and add new range
      final multiSelectNotifier = ref.read(multiSelectProvider.notifier);
      for (final asset in _draggedAssets) {
        multiSelectNotifier.deselectAsset(asset);
      }
      _draggedAssets.clear();

      for (final asset in selectedAssets) {
        multiSelectNotifier.selectAsset(asset);
        _draggedAssets.add(asset);
      }
    }
  }

  @override
  Widget build(BuildContext _) {
    final asyncSegments = ref.watch(timelineSegmentProvider);
    final maxHeight = ref.watch(timelineArgsProvider.select((args) => args.maxHeight));
    final isSelectionMode = ref.watch(multiSelectProvider.select((s) => s.forceEnable));
    final isMultiSelectEnabled = ref.watch(multiSelectProvider.select((s) => s.isEnabled));
    final isReadonlyModeEnabled = ref.watch(readonlyModeProvider);
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
                _lastRenderedSegments = segments;
                final spec = ref.watch(timelineGroupingSpecProvider);
                final pinnedGroupBy = ref.watch(timelineArgsProvider).groupBy;
                final TimelineOverviewMode activeMode = pinnedGroupBy != null ? TimelineOverviewMode.all : spec.mode;
                final GroupAssetsBy activeGroupBy = pinnedGroupBy ?? spec.groupBy;
                final zoomAnchor = ref.watch(timelineZoomAnchorProvider);
                _scheduleZoomAnchorResolution(anchor: zoomAnchor, mode: activeMode, segments: segments);
                final childCount = (segments.lastOrNull?.lastIndex ?? -1) + 1;

                // Zero assets: render the caller's empty state (first-run / no-results)
                // instead of a blank grid. The app bar stays so backup/profile remain
                // reachable; the scrubber and grouping pill are naturally skipped.
                if (childCount == 0 && widget.emptyWidget != null && !isSelectionMode) {
                  return CustomScrollView(
                    slivers: [
                      if (widget.appBar != null) widget.appBar!,
                      if (widget.topSliverWidget != null) widget.topSliverWidget!,
                      SliverFillRemaining(hasScrollBody: false, child: widget.emptyWidget),
                    ],
                  );
                }
                final double appBarExpandedHeight = widget.appBar != null && widget.appBar is MesmerizingSliverAppBar
                    ? 200
                    : 0;
                final topPadding = context.padding.top + (widget.appBar == null ? 0 : kToolbarHeight) + 10;

                const bottomSheetOpenModifier = 120.0;
                final pillClearance = widget.withGroupingPill
                    ? TimelineGroupingBottomPill.pillHeight + TimelineGroupingBottomPill.bottomFloat
                    : 0.0;
                final contentBottomPadding =
                    context.padding.bottom + pillClearance + (isMultiSelectEnabled ? bottomSheetOpenModifier : 0);
                final scrubberBottomPadding = contentBottomPadding + kScrubberThumbHeight;

                final grid = CustomScrollView(
                  primary: true,
                  physics: _scrollPhysics,
                  scrollCacheExtent: .pixels(maxHeight * 2),
                  slivers: [
                    if (isSelectionMode) const SelectionSliverAppBar() else if (widget.appBar != null) widget.appBar!,
                    if (widget.topSliverWidget != null) widget.topSliverWidget!,
                    _SliverSegmentedList(
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
                    groupBy: activeGroupBy,
                    layoutSegments: segments,
                    timelineHeight: maxHeight,
                    topPadding: topPadding,
                    bottomPadding: scrubberBottomPadding,
                    monthSegmentSnappingOffset: timelineScrubberSnappingOffset(
                      topSliverWidgetHeight: widget.topSliverWidgetHeight,
                      appBarExpandedHeight: appBarExpandedHeight,
                    ),
                    hasAppBar: widget.appBar != null,
                    child: grid,
                  );
                } else {
                  timeline = grid;
                }

                return RawGestureDetector(
                  gestures: {
                    CustomScaleGestureRecognizer: GestureRecognizerFactoryWithHandlers<CustomScaleGestureRecognizer>(
                      () => CustomScaleGestureRecognizer(),
                      (CustomScaleGestureRecognizer scale) {
                        scale.onStart = (details) {
                          _baseScaleFactor = _scaleFactor;
                        };

                        scale.onUpdate = (details) {
                          final newScaleFactor = math.max(math.min(5.0, _baseScaleFactor * details.scale), 1.0);
                          final newPerRow = 7 - newScaleFactor.toInt();

                          if (newPerRow != _perRow) {
                            final targetAssetIndex = _getCurrentAssetIndex(segments);
                            setState(() {
                              _scaleFactor = newScaleFactor;
                              _perRow = newPerRow;
                              _restoreAssetIndex = targetAssetIndex;
                            });

                            unawaited(ref.read(settingsProvider).write(.timelineTilesPerRow, _perRow));
                          }
                        };
                      },
                    ),
                  },
                  child: TimelineDragRegion(
                    onStart: !isReadonlyModeEnabled ? _setDragStartIndex : null,
                    onAssetEnter: _handleDragAssetEnter,
                    onEnd: !isReadonlyModeEnabled ? _stopDrag : null,
                    onScroll: (direction) => unawaited(_dragScroll(direction)),
                    onScrollStart: () {
                      // Minimize the bottom sheet when drag selection starts
                      ref.read(timelineStateProvider.notifier).setScrolling(true);
                    },
                    child: Stack(
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
                              child: Center(child: _MultiSelectStatusButton()),
                            ),
                          ),
                        if (isBottomWidgetVisible) widget.bottomSheet!,
                      ],
                    ),
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

class _SliverSegmentedList extends SliverMultiBoxAdaptorWidget {
  final List<Segment> _segments;

  const _SliverSegmentedList({required this._segments, required super.delegate});

  @override
  _RenderSliverTimelineBoxAdaptor createRenderObject(BuildContext context) =>
      _RenderSliverTimelineBoxAdaptor(childManager: context as SliverMultiBoxAdaptorElement, segments: _segments);

  @override
  void updateRenderObject(BuildContext context, _RenderSliverTimelineBoxAdaptor renderObject) {
    renderObject.segments = _segments;
  }
}

/// Modified version of [RenderSliverFixedExtentBoxAdaptor] to use precomputed offsets
class _RenderSliverTimelineBoxAdaptor extends RenderSliverMultiBoxAdaptor {
  List<Segment> _segments;

  set segments(List<Segment> updatedSegments) {
    if (_segments.equals(updatedSegments)) {
      return;
    }
    _segments = updatedSegments;
    markNeedsLayout();
  }

  _RenderSliverTimelineBoxAdaptor({required super.childManager, required this._segments});

  int getMinChildIndexForScrollOffset(double offset) =>
      _segments.findByOffset(offset)?.getMinChildIndexForScrollOffset(offset) ?? 0;

  int getMaxChildIndexForScrollOffset(double offset) =>
      _segments.findByOffset(offset)?.getMaxChildIndexForScrollOffset(offset) ?? 0;

  double indexToLayoutOffset(int index) =>
      (_segments.findByIndex(index) ?? _segments.lastOrNull)?.indexToLayoutOffset(index) ?? 0;

  double estimateMaxScrollOffset() => _segments.lastOrNull?.endOffset ?? 0;

  double computeMaxScrollOffset() => _segments.lastOrNull?.endOffset ?? 0;

  @override
  void performLayout() {
    childManager.didStartLayout();
    // Assume initially that we have enough children to fill the viewport/cache area.
    childManager.setDidUnderflow(false);

    final double scrollOffset = constraints.scrollOffset + constraints.cacheOrigin;
    assert(scrollOffset >= 0.0);

    final double remainingExtent = constraints.remainingCacheExtent;
    assert(remainingExtent >= 0.0);

    final double targetScrollOffset = scrollOffset + remainingExtent;

    // Find the index of the first child that should be visible or in the leading cache area.
    final int firstRequiredChildIndex = getMinChildIndexForScrollOffset(scrollOffset);

    // Find the index of the last child that should be visible or in the trailing cache area.
    final int? lastRequiredChildIndex = targetScrollOffset.isFinite
        ? getMaxChildIndexForScrollOffset(targetScrollOffset)
        : null;

    // Remove children that are no longer visible or within the cache area.
    if (firstChild == null) {
      collectGarbage(0, 0);
    } else {
      final int leadingChildrenToRemove = calculateLeadingGarbage(firstIndex: firstRequiredChildIndex);
      final int trailingChildrenToRemove = lastRequiredChildIndex == null
          ? 0
          : calculateTrailingGarbage(lastIndex: lastRequiredChildIndex);
      collectGarbage(leadingChildrenToRemove, trailingChildrenToRemove);
    }

    // If there are currently no children laid out (e.g., initial load),
    // try to add the first child needed for the current scroll offset.
    if (firstChild == null) {
      final double firstChildLayoutOffset = indexToLayoutOffset(firstRequiredChildIndex);
      final bool childAdded = addInitialChild(index: firstRequiredChildIndex, layoutOffset: firstChildLayoutOffset);

      if (!childAdded) {
        // There are either no children, or we are past the end of all our children.
        final double max = firstRequiredChildIndex <= 0 ? 0.0 : computeMaxScrollOffset();
        geometry = SliverGeometry(scrollExtent: max, maxPaintExtent: max);
        childManager.didFinishLayout();
        return;
      }
    }

    // Layout children that might have scrolled into view from the top (before the current firstChild).
    RenderBox? highestLaidOutChild;
    final childConstraints = constraints.asBoxConstraints();

    for (int currentIndex = indexOf(firstChild!) - 1; currentIndex >= firstRequiredChildIndex; --currentIndex) {
      final RenderBox? newLeadingChild = insertAndLayoutLeadingChild(childConstraints);
      if (newLeadingChild == null) {
        // If a child is missing where we expect one, it indicates
        // an inconsistency in offset that needs correction.
        final Segment? segment = _segments.findByIndex(currentIndex) ?? _segments.firstOrNull;
        geometry = SliverGeometry(
          // Request a scroll correction based on where the missing child should have been.
          scrollOffsetCorrection: segment?.indexToLayoutOffset(currentIndex) ?? 0.0,
        );
        // Parent will re-layout everything.
        return;
      }
      final childParentData = newLeadingChild.parentData! as SliverMultiBoxAdaptorParentData;
      childParentData.layoutOffset = indexToLayoutOffset(currentIndex);
      assert(childParentData.index == currentIndex);
      highestLaidOutChild ??= newLeadingChild;
    }

    // If the loop above didn't run (meaning the firstChild was already the correct [firstRequiredChildIndex]),
    // or even if it did, we need to ensure the first visible child is correctly laid out
    // and establish our starting point for laying out trailing children.

    // If [highestLaidOutChild] is still null, it means the loop above didn't add any new leading children.
    // The [firstChild] that existed at the start of performLayout is still the first one we need.
    if (highestLaidOutChild == null) {
      firstChild!.layout(childConstraints);
      final childParentData = firstChild!.parentData! as SliverMultiBoxAdaptorParentData;
      childParentData.layoutOffset = indexToLayoutOffset(firstRequiredChildIndex);
      highestLaidOutChild = firstChild;
    }

    RenderBox? mostRecentlyLaidOutChild = highestLaidOutChild;

    // Starting from the child after [mostRecentlyLaidOutChild], layout subsequent children
    // until we reach the [lastRequiredChildIndex] or run out of children.
    double calculatedMaxScrollOffset = double.infinity;

    for (
      int currentIndex = indexOf(mostRecentlyLaidOutChild!) + 1;
      lastRequiredChildIndex == null || currentIndex <= lastRequiredChildIndex;
      ++currentIndex
    ) {
      RenderBox? child = childAfter(mostRecentlyLaidOutChild!);

      if (child == null || indexOf(child) != currentIndex) {
        child = insertAndLayoutChild(childConstraints, after: mostRecentlyLaidOutChild);
        if (child == null) {
          final Segment? segment = _segments.findByIndex(currentIndex) ?? _segments.lastOrNull;
          calculatedMaxScrollOffset = segment?.indexToLayoutOffset(currentIndex) ?? computeMaxScrollOffset();
          break;
        }
      } else {
        child.layout(childConstraints);
      }

      mostRecentlyLaidOutChild = child;
      final childParentData = mostRecentlyLaidOutChild.parentData! as SliverMultiBoxAdaptorParentData;
      assert(childParentData.index == currentIndex);
      childParentData.layoutOffset = indexToLayoutOffset(currentIndex);
    }

    final int lastLaidOutChildIndex = indexOf(lastChild!);
    final double leadingScrollOffset = indexToLayoutOffset(firstRequiredChildIndex);
    final double trailingScrollOffset = indexToLayoutOffset(lastLaidOutChildIndex + 1);

    assert(
      firstRequiredChildIndex == 0 ||
          (childScrollOffset(firstChild!) ?? -1.0) - scrollOffset <= precisionErrorTolerance,
    );
    assert(debugAssertChildListIsNonEmptyAndContiguous());
    assert(indexOf(firstChild!) == firstRequiredChildIndex);
    assert(lastRequiredChildIndex == null || lastLaidOutChildIndex <= lastRequiredChildIndex);

    calculatedMaxScrollOffset = math.min(calculatedMaxScrollOffset, estimateMaxScrollOffset());

    final double paintExtent = calculatePaintOffset(constraints, from: leadingScrollOffset, to: trailingScrollOffset);

    final double cacheExtent = calculateCacheOffset(constraints, from: leadingScrollOffset, to: trailingScrollOffset);

    final double targetEndScrollOffsetForPaint = constraints.scrollOffset + constraints.remainingPaintExtent;
    final int? targetLastIndexForPaint = targetEndScrollOffsetForPaint.isFinite
        ? getMaxChildIndexForScrollOffset(targetEndScrollOffsetForPaint)
        : null;

    final maxPaintExtent = math.max(paintExtent, calculatedMaxScrollOffset);

    geometry = SliverGeometry(
      scrollExtent: calculatedMaxScrollOffset,
      paintExtent: paintExtent,
      maxPaintExtent: maxPaintExtent,
      // Indicates if there's content scrolled off-screen.
      // This is true if the last child needed for painting is actually laid out,
      // or if the first child is partially visible.
      hasVisualOverflow:
          (targetLastIndexForPaint != null && lastLaidOutChildIndex >= targetLastIndexForPaint) ||
          constraints.scrollOffset > 0.0,
      cacheExtent: cacheExtent,
    );

    // We may have started the layout while scrolled to the end, which would not
    // expose a new child.
    if (calculatedMaxScrollOffset == trailingScrollOffset) {
      childManager.setDidUnderflow(true);
    }

    childManager.didFinishLayout();
  }
}

class _MultiSelectStatusButton extends ConsumerWidget {
  const _MultiSelectStatusButton();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selectCount = ref.watch(multiSelectProvider.select((s) => s.selectedAssets.length));
    return ElevatedButton.icon(
      onPressed: () => ref.read(multiSelectProvider.notifier).reset(),
      icon: Icon(Icons.close_rounded, color: context.colorScheme.onPrimary),
      label: Text(
        selectCount.toString(),
        style: context.textTheme.titleMedium?.copyWith(height: 2.5, color: context.colorScheme.onPrimary),
      ),
    );
  }
}

/// accepts a gesture even though it should reject it (because child won)
class CustomScaleGestureRecognizer extends ScaleGestureRecognizer {
  @override
  void rejectGesture(int pointer) {
    acceptGesture(pointer);
  }
}
