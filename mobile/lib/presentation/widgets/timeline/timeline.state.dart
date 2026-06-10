import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
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
  final args = ref.watch(timelineArgsProvider);
  final columnCount = args.columnCount;
  final spacing = args.spacing;
  final availableTileWidth = args.maxWidth - (spacing * (columnCount - 1));
  final tileExtent = math.max(0, availableTileWidth) / columnCount;

  final GroupAssetsBy groupBy = args.groupBy ?? ref.watch(timelineGroupingProvider);

  final timelineService = ref.watch(timelineServiceProvider);
  yield* timelineService.watchBuckets().map((buckets) {
    // A date-less bucket source (e.g. relevance-sorted search, or a `fromAssets` timeline) cannot
    // render the year/month overview — fall back to the flat grid regardless of the grouping setting.
    final isDateless = buckets.isNotEmpty && buckets.first is! TimeBucket;
    final effectiveGroupBy = isDateless ? GroupAssetsBy.day : groupBy;
    if (effectiveGroupBy == GroupAssetsBy.year || effectiveGroupBy == GroupAssetsBy.month) {
      return TimelineOverviewSegmentBuilder(buckets: buckets, groupBy: effectiveGroupBy).generate();
    }

    return FixedSegmentBuilder(
      buckets: buckets,
      tileHeight: tileExtent,
      columnCount: columnCount,
      spacing: spacing,
      groupBy: effectiveGroupBy,
    ).generate();
  });
  // timelineGroupingProvider must be listed so the auto-scoped copy of this provider
  // inside a TimelineRouteScope resolves the ROUTE-LOCAL grouping override; without it
  // the copy reads the root (persisted) grouping and detail routes silently render
  // the persisted grouping instead of their own.
}, dependencies: [timelineServiceProvider, timelineArgsProvider, timelineGroupingProvider]);

final timelineStateProvider = NotifierProvider<TimelineStateNotifier, TimelineState>(TimelineStateNotifier.new);
