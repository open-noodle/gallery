import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/presentation/widgets/timeline/fixed/segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.state.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';

void main() {
  ProviderContainer containerFor(GroupAssetsBy groupBy) {
    final service = TimelineService((
      assetSource: (offset, count) async => const [],
      bucketSource: () => Stream.value([
        TimeBucket(date: DateTime(2025), assetCount: 2),
        TimeBucket(date: DateTime(2024), assetCount: 1),
      ]),
      origin: TimelineOrigin.main,
    ));

    final container = ProviderContainer(
      overrides: [
        timelineServiceProvider.overrideWithValue(service),
        timelineArgsProvider.overrideWithValue(
          TimelineArgs(maxWidth: 390, maxHeight: 800, columnCount: 3, groupBy: groupBy),
        ),
      ],
    );
    addTearDown(() async {
      container.dispose();
      await service.dispose();
    });
    return container;
  }

  test('year grouping uses overview segments', () async {
    final container = containerFor(GroupAssetsBy.year);

    final segments = await container.read(timelineSegmentProvider.future);

    expect(segments, everyElement(isA<TimelineOverviewSegment>()));
    expect(segments.first.firstAssetIndex, 0);
    expect(segments.last.firstAssetIndex, 2);
  });

  test('month grouping uses overview segments', () async {
    final container = containerFor(GroupAssetsBy.month);

    final segments = await container.read(timelineSegmentProvider.future);

    expect(segments, everyElement(isA<TimelineOverviewSegment>()));
  });

  test('day grouping stays on fixed grid segments', () async {
    final container = containerFor(GroupAssetsBy.day);

    final segments = await container.read(timelineSegmentProvider.future);

    expect(segments, everyElement(isA<FixedSegment>()));
  });
}
