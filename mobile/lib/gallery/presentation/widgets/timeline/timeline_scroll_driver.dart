import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/asset_scan.dart';
import 'package:immich_mobile/presentation/widgets/timeline/scroll_drain.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.state.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_anchor.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_scroll_target.dart';
import 'package:immich_mobile/providers/asset_viewer/scroll_to_asset_notifier.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/highlighted_asset.provider.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';

/// The fork's scroll logic for the timeline: the "view in timeline" scroll drain, the
/// zoom-anchor resolution and the grouping-change anchor. It stands in for upstream's
/// [PrimaryScrollController] around the timeline Scaffold, so it lives exactly as long
/// as the timeline state and survives the loading state a grouping change passes through.
class TimelineScrollDriver extends ConsumerStatefulWidget {
  const TimelineScrollDriver({super.key, required this.controller, this.spaceId, required this.child});

  final ScrollController controller;

  /// The space this timeline shows, for timelines scoped to one (see `Timeline.spaceId`).
  final String? spaceId;

  final Widget child;

  @override
  ConsumerState<TimelineScrollDriver> createState() => _TimelineScrollDriverState();
}

class _TimelineScrollDriverState extends ConsumerState<TimelineScrollDriver> {
  TimelineZoomAnchor? _scheduledZoomAnchor;
  TimelineZoomAnchor? _resolvingZoomAnchor;
  List<Segment>? _lastRenderedSegments;

  ScrollController get _scrollController => widget.controller;

  @override
  void initState() {
    super.initState();
    // Drain any pending "view in timeline" request. It is latched in
    // [scrollToAssetNotifierProvider] so it survives this timeline being mounted
    // fresh by the navigation (e.g. coming from a memory or a notification)
    // before its segments have loaded and laid out.
    scrollToAssetNotifierProvider.addListener(_requestScrollDrain);
    ref.listenManual(timelineSegmentProvider, (_, _) => _requestScrollDrain());
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _requestScrollDrain();
      }
    });

    ref.listenManual(timelineOverviewModeProvider, _onGroupingChanged);
  }

  @override
  void dispose() {
    scrollToAssetNotifierProvider.removeListener(_requestScrollDrain);
    _resolvingScrollTarget = null;
    super.dispose();
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
    if (pending == null) {
      return;
    }
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
    final segments = drainableSegments(ref.read(timelineSegmentProvider));
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
      pendingSpaceId: target?.spaceId,
      timelineSpaceId: widget.spaceId,
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
        // Overview modes render cards, not tiles. Drill to the photo grid the same
        // way a card tap does, then keep retrying until the rebuilt segments arrive.
        // `attempts` MUST increment here: if the mode is pinned and set() is a
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
        if (mounted) {
          _requestScrollDrain();
        }
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
            if (mounted) {
              _requestScrollDrain();
            }
          });
        }
        return;
      case ScrollResolveOutcome.abandonStale:
        // A newer request is latched. Release the cycle and let its listener run.
        _scrollDrainScheduled = false;
        _daySwitchRequested = false;
        _drainingTarget = null;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            _requestScrollDrain();
          }
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
    ref.read(timelineStateProvider.notifier).setRecommendDeferredLoading(true);
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
            ref.read(timelineStateProvider.notifier).setRecommendDeferredLoading(false);
          }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final asyncSegments = ref.watch(timelineSegmentProvider);
    // Only the segments the timeline body renders: the same cases `widgetWhen` hands to onData.
    if (asyncSegments.hasValue && !(asyncSegments.isLoading && !asyncSegments.isRefreshing)) {
      final segments = asyncSegments.requireValue;
      _lastRenderedSegments = segments;
      final spec = ref.watch(timelineGroupingSpecProvider);
      final pinnedGroupBy = ref.watch(timelineArgsProvider).groupBy;
      final TimelineOverviewMode activeMode = pinnedGroupBy != null ? TimelineOverviewMode.all : spec.mode;
      final zoomAnchor = ref.watch(timelineZoomAnchorProvider);
      _scheduleZoomAnchorResolution(anchor: zoomAnchor, mode: activeMode, segments: segments);
    }
    return PrimaryScrollController(controller: widget.controller, child: widget.child);
  }
}
