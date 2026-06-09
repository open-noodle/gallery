import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_card.dart';
import 'package:immich_mobile/presentation/widgets/timeline/segment.model.dart';
import 'package:immich_mobile/providers/timeline/overview_drilldown.provider.dart';
import 'package:immich_mobile/providers/timeline/overview_representative_cache.provider.dart';

class TimelineOverviewSegment extends Segment {
  const TimelineOverviewSegment({
    required super.firstIndex,
    required super.lastIndex,
    required super.startOffset,
    required super.endOffset,
    required super.firstAssetIndex,
    required super.bucket,
    required this.groupBy,
    super.headerExtent = 0,
    super.spacing = 0,
    required super.header,
  });

  final GroupAssetsBy groupBy;

  @override
  int getMinChildIndexForScrollOffset(double scrollOffset) => firstIndex;

  @override
  int getMaxChildIndexForScrollOffset(double scrollOffset) => lastIndex;

  @override
  double indexToLayoutOffset(int index) => index <= firstIndex ? startOffset : endOffset;

  @override
  Widget builder(BuildContext context, int index) {
    return _TimelineOverviewSegmentCard(segment: this);
  }
}

class _TimelineOverviewSegmentCard extends ConsumerWidget {
  const _TimelineOverviewSegmentCard({required this.segment});

  final TimelineOverviewSegment segment;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bucket = segment.bucket;
    if (bucket is! TimeBucket) {
      return const SizedBox.shrink();
    }

    final drilldown = ref.read(timelineOverviewDrilldownProvider);
    final onTap = drilldown != null && bucket.assetCount > 0
        ? () => unawaited(drilldown(bucket, segment.groupBy))
        : null;

    final key = TimelineOverviewRepresentativeCacheNotifier.keyFor(segment.groupBy, bucket.date);

    // Read the cached representative (null if not resolved yet).
    final cachedAsset = ref.watch(timelineOverviewRepresentativeCacheProvider.select((m) => m[key]?.asset));

    // Schedule a (re-)resolve post-frame so we never mutate provider state during build.
    if (bucket.assetCount > 0) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (context.mounted) {
          ref
              .read(timelineOverviewRepresentativeCacheProvider.notifier)
              .ensure(key, segment.firstAssetIndex, bucket.assetCount);
        }
      });
    }

    return TimelineOverviewCard(
      bucket: bucket,
      groupBy: segment.groupBy,
      representativeAsset: cachedAsset,
      onTap: onTap,
    );
  }
}
