import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';

void main() {
  group('aggregateYears', () {
    test('sums counts across months of the same year', () {
      final buckets = <BucketLite>[
        (timeBucket: '2024-01-01', count: 10),
        (timeBucket: '2024-03-01', count: 5),
        (timeBucket: '2023-12-01', count: 7),
      ];
      final years = aggregateYears(buckets);
      expect(years, hasLength(2));
      expect(years.firstWhere((y) => y.year == 2024).count, 15);
      expect(years.firstWhere((y) => y.year == 2023).count, 7);
    });

    test('sorts descending by year', () {
      final buckets = <BucketLite>[
        (timeBucket: '2019-01-01', count: 1),
        (timeBucket: '2024-01-01', count: 1),
        (timeBucket: '2022-01-01', count: 1),
      ];
      expect(aggregateYears(buckets).map((y) => y.year), [2024, 2022, 2019]);
    });

    test('empty input → empty list', () {
      expect(aggregateYears(const []), isEmpty);
    });
  });

  group('getMonthsForYear', () {
    test('returns 12 entries with counts for the matching year only', () {
      final buckets = <BucketLite>[
        (timeBucket: '2024-01-01', count: 3),
        (timeBucket: '2024-05-01', count: 7),
        (timeBucket: '2023-05-01', count: 42),
      ];
      final months = getMonthsForYear(buckets, 2024);
      expect(months, hasLength(12));
      expect(months[0].count, 3); // January
      expect(months[4].count, 7); // May
      expect(months[11].count, 0); // December not in source → 0
    });
  });

  group('peekDecadesForYears', () {
    test('returns only decades present in the data, descending', () {
      final years = [
        const YearCount(year: 2024, count: 1),
        const YearCount(year: 2021, count: 1),
        const YearCount(year: 2018, count: 1),
        const YearCount(year: 2008, count: 1),
      ];
      final decades = peekDecadesForYears(years);
      expect(decades.map((d) => d.decadeStart), [2020, 2010, 2000]);
    });

    test('empty input → empty list', () {
      expect(peekDecadesForYears(const []), isEmpty);
    });
  });
}
