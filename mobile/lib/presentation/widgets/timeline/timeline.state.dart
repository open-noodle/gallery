import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/constants.dart';
import 'package:immich_mobile/presentation/widgets/timeline/fixed/segment_builder.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_segment_builder.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment.model.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';

part 'timeline.state.freezed.dart';

@freezed
abstract class TimelineArgs with _$TimelineArgs {
  const factory TimelineArgs({
    required double maxWidth,
    required double maxHeight,
    @Default(kTimelineSpacing) double spacing,
    @Default(kTimelineColumnCount) int columnCount,
    @Default(false) bool showStorageIndicator,
    @Default(false) bool withStack,
    GroupAssetsBy? groupBy,
  }) = _TimelineArgs;
}

class TimelineState {
  final bool isScrolling;

  /// Indicates whether the timeline is scrolling beyond some configured "high" speed,
  /// such as when programmatically scrolling to the top or a really fast user fling
  final bool recommendDeferredLoading;

  const TimelineState({this.isScrolling = false, this.recommendDeferredLoading = false});

  bool get isInteracting => isScrolling || recommendDeferredLoading;

  @override
  bool operator ==(covariant TimelineState other) {
    return isScrolling == other.isScrolling && recommendDeferredLoading == other.recommendDeferredLoading;
  }

  @override
  int get hashCode => isScrolling.hashCode ^ recommendDeferredLoading.hashCode;

  TimelineState copyWith({bool? isScrolling, bool? recommendDeferredLoading}) {
    return TimelineState(
      isScrolling: isScrolling ?? this.isScrolling,
      recommendDeferredLoading: recommendDeferredLoading ?? this.recommendDeferredLoading,
    );
  }
}

class TimelineStateNotifier extends Notifier<TimelineState> {
  void setScrolling(bool isScrolling) {
    state = state.copyWith(isScrolling: isScrolling);
  }

  void setRecommendDeferredLoading(bool recommendDeferredLoading) {
    state = state.copyWith(recommendDeferredLoading: recommendDeferredLoading);
  }

  @override
  TimelineState build() => const TimelineState(isScrolling: false, recommendDeferredLoading: false);
}

// This provider watches the buckets from the timeline service & args and serves the segments.
// It should be used only after the timeline service and timeline args provider is overridden
final timelineSegmentProvider = StreamProvider.autoDispose<List<Segment>>((ref) async* {
  // maxHeight is left out on purpose, a height-only change must not restart the bucket stream
  final (maxWidth, columnCount, spacing, groupByArg) = ref.watch(
    timelineArgsProvider.select((args) => (args.maxWidth, args.columnCount, args.spacing, args.groupBy)),
  );
  final availableTileWidth = maxWidth - (spacing * (columnCount - 1));
  final tileExtent = math.max(0, availableTileWidth) / columnCount;

  // A pinned groupBy (the cleanup preview) always means the flat grid at that granularity.
  final spec = groupByArg != null
      ? (mode: TimelineOverviewMode.all, groupBy: groupByArg)
      : ref.watch(timelineGroupingSpecProvider);

  final timelineService = ref.watch(timelineServiceProvider);
  yield* timelineService.watchBuckets().map((buckets) {
    // A date-less bucket source (relevance-sorted search, or a `fromAssets` timeline) has no
    // dates to group by — fall back to the flat grid regardless of the mode.
    final isDateless = buckets.isNotEmpty && buckets.first is! TimeBucket;
    if (spec.mode != TimelineOverviewMode.all && !isDateless) {
      return TimelineOverviewSegmentBuilder(buckets: buckets, mode: spec.mode).generate();
    }

    return FixedSegmentBuilder(
      buckets: buckets,
      tileHeight: tileExtent,
      columnCount: columnCount,
      spacing: spacing,
      groupBy: isDateless ? GroupAssetsBy.day : spec.groupBy,
    ).generate();
  });
  // timelineGroupingSpecProvider must be listed so the auto-scoped copy of this provider
  // inside a TimelineRouteScope resolves the ROUTE-LOCAL mode rather than the root one.
}, dependencies: [timelineServiceProvider, timelineArgsProvider, timelineGroupingSpecProvider]);

final timelineStateProvider = NotifierProvider<TimelineStateNotifier, TimelineState>(TimelineStateNotifier.new);
