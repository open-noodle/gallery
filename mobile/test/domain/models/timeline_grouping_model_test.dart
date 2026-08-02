import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';

void main() {
  group('normalizeGridGrouping', () {
    test('L-1: day stays day', () {
      expect(normalizeGridGrouping(GroupAssetsBy.day), GroupAssetsBy.day);
    });

    test('L-2: month stays month', () {
      expect(normalizeGridGrouping(GroupAssetsBy.month), GroupAssetsBy.month);
    });

    test('L-4: auto falls back to day', () {
      expect(normalizeGridGrouping(GroupAssetsBy.auto), GroupAssetsBy.day);
    });

    test('L-5: none falls back to day as a persisted setting value', () {
      expect(normalizeGridGrouping(GroupAssetsBy.none), GroupAssetsBy.day);
    });

    test('year, left behind by the removed Year option, falls back to day', () {
      expect(normalizeGridGrouping(GroupAssetsBy.year), GroupAssetsBy.day);
    });
  });

  group('TimelineOverviewMode', () {
    test('has exactly the three selector positions', () {
      expect(TimelineOverviewMode.values, [
        TimelineOverviewMode.years,
        TimelineOverviewMode.months,
        TimelineOverviewMode.all,
      ]);
    });
  });
}
