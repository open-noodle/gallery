import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/timeline_temporal_filter.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';
import 'package:immich_mobile/utils/option.dart';

void main() {
  group('applyTimelineTemporalScope', () {
    test('none returns the original filter instance', () {
      final filter = SearchFilter.empty();

      final result = applyTimelineTemporalScope(filter, const TimelineTemporalScope.none());

      expect(result, same(filter));
    });

    test('year scope applies year boundaries without mutating the base filter', () {
      final filter = SearchFilter.empty().copyWith(context: 'paris');

      final result = applyTimelineTemporalScope(filter, const TimelineTemporalScope.year(2025));

      expect(filter.date.takenAfter, isNull);
      expect(filter.date.takenBefore, isNull);
      expect(result.context, 'paris');
      expect(result.date.takenAfter, DateTime(2025));
      expect(result.date.takenBefore, DateTime(2025, 12, 31, 23, 59, 59));
    });

    test('month scope applies leap-month boundaries', () {
      final result = applyTimelineTemporalScope(
        SearchFilter.empty(),
        TimelineTemporalScope.month(year: 2024, month: 2),
      );

      expect(result.date.takenAfter, DateTime(2024, 2));
      expect(result.date.takenBefore, DateTime(2024, 2, 29, 23, 59, 59));
    });

    test('scope intersects an existing user date range', () {
      final filter = SearchFilter.empty().copyWith(
        date: SearchDateFilter(takenAfter: DateTime(2025, 3, 5), takenBefore: DateTime(2025, 9, 10)),
      );

      final result = applyTimelineTemporalScope(filter, const TimelineTemporalScope.year(2025));

      expect(result.date.takenAfter, DateTime(2025, 3, 5));
      expect(result.date.takenBefore, DateTime(2025, 9, 10));
    });

    test('non-time filters survive temporal scope composition', () {
      final filter = SearchFilter.empty().copyWith(
        tagIds: ['tag-1'],
        rating: SearchRatingFilter(rating: const Option.some(4)),
        mediaType: AssetType.image,
      )..context = 'mountains';

      final result = applyTimelineTemporalScope(filter, const TimelineTemporalScope.year(2025));

      expect(result.context, 'mountains');
      expect(result.tagIds, ['tag-1']);
      expect(result.rating.rating.unwrapOrNull, 4);
      expect(result.mediaType, AssetType.image);
      expect(result.date.takenAfter, DateTime(2025));
    });
  });

  group('photosTimelineEffectiveFilterProvider', () {
    late ProviderContainer container;

    setUp(() {
      container = ProviderContainer();
      addTearDown(container.dispose);
    });

    test('combines current Photos filter with temporal scope', () {
      container.read(photosFilterProvider.notifier).setText('paris');
      container.read(timelineTemporalScopeProvider.notifier).setYear(2025);

      final filter = container.read(photosTimelineEffectiveFilterProvider);

      expect(filter.context, 'paris');
      expect(filter.date.takenAfter, DateTime(2025));
      expect(filter.date.takenBefore, DateTime(2025, 12, 31, 23, 59, 59));
    });

    test('clearing temporal scope keeps non-time Photos filters intact', () {
      container.read(photosFilterProvider.notifier).setText('paris');
      container.read(timelineTemporalScopeProvider.notifier).setMonth(year: 2025, month: 3);
      expect(container.read(photosTimelineEffectiveFilterProvider).date.takenAfter, DateTime(2025, 3));

      container.read(timelineTemporalScopeProvider.notifier).clear();

      final filter = container.read(photosTimelineEffectiveFilterProvider);
      expect(filter.context, 'paris');
      expect(filter.date.takenAfter, isNull);
      expect(filter.date.takenBefore, isNull);
    });
  });
}
