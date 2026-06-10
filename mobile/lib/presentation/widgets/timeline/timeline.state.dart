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

@freezed
abstract class TimelineState with _$TimelineState {
  const TimelineState._();

  const factory TimelineState({@Default(false) bool isScrubbing, @Default(false) bool isScrolling}) = _TimelineState;

  bool get isInteracting => isScrubbing || isScrolling;
}

class TimelineStateNotifier extends Notifier<TimelineState> {
  void setScrubbing(bool isScrubbing) {
    state = state.copyWith(isScrubbing: isScrubbing);
  }

  void setScrolling(bool isScrolling) {
    state = state.copyWith(isScrolling: isScrolling);
  }

  @override
  TimelineState build() => const TimelineState(isScrubbing: false, isScrolling: false);
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
