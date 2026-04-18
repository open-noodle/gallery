import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';
import 'package:immich_mobile/providers/photos_filter/time_buckets.provider.dart';
import 'package:immich_mobile/providers/photos_filter/when_picker.provider.dart';

void main() {
  group('parseWhenQuery', () {
    test('4-digit year', () {
      expect(parseWhenQuery('2024'), const WhenQuery.year(2024));
      expect(parseWhenQuery('1999'), const WhenQuery.year(1999));
    });

    test('2-digit decade suffix', () {
      expect(parseWhenQuery('20s'), const WhenQuery.decade(2020));
      expect(parseWhenQuery('00s'), const WhenQuery.decade(2000));
    });

    test('4-digit decade', () {
      expect(parseWhenQuery('2020s'), const WhenQuery.decade(2020));
      expect(parseWhenQuery('1990s'), const WhenQuery.decade(1990));
    });

    test('decade with whitespace', () {
      expect(parseWhenQuery(' 2020s '), const WhenQuery.decade(2020));
      expect(parseWhenQuery('  20s'), const WhenQuery.decade(2020));
    });

    test('case-insensitive decade suffix', () {
      expect(parseWhenQuery('20S'), const WhenQuery.decade(2020));
      expect(parseWhenQuery('2020S'), const WhenQuery.decade(2020));
    });

    test('rejects 3-digit', () {
      expect(parseWhenQuery('202'), const WhenQuery.none());
      expect(parseWhenQuery('202s'), const WhenQuery.none());
    });

    test('rejects 5-digit', () {
      expect(parseWhenQuery('20248'), const WhenQuery.none());
      expect(parseWhenQuery('20248s'), const WhenQuery.none());
    });

    test('rejects non-decade-start 4-digit with s', () {
      expect(parseWhenQuery('2025s'), const WhenQuery.none());
      expect(parseWhenQuery('2021s'), const WhenQuery.none());
    });

    test('empty and garbage return none', () {
      expect(parseWhenQuery(''), const WhenQuery.none());
      expect(parseWhenQuery('   '), const WhenQuery.none());
      expect(parseWhenQuery('apples'), const WhenQuery.none());
      expect(parseWhenQuery('2024apples'), const WhenQuery.none());
    });

    test('WhenQuery equality', () {
      expect(const WhenQuery.year(2024), const WhenQuery.year(2024));
      expect(const WhenQuery.year(2024), isNot(const WhenQuery.year(2023)));
      expect(const WhenQuery.decade(2020), const WhenQuery.decade(2020));
      expect(const WhenQuery.none(), const WhenQuery.none());
      expect(const WhenQuery.year(2024), isNot(const WhenQuery.decade(2020)));
    });
  });

  group('WhenQueryAccess extension', () {
    test('yearValue returns int for year query, null otherwise', () {
      expect(const WhenQuery.year(2024).yearValue, 2024);
      expect(const WhenQuery.year(1999).yearValue, 1999);
      expect(const WhenQuery.decade(2020).yearValue, isNull);
      expect(const WhenQuery.none().yearValue, isNull);
    });

    test('decadeStartValue returns int for decade query, null otherwise', () {
      expect(const WhenQuery.decade(2020).decadeStartValue, 2020);
      expect(const WhenQuery.decade(1990).decadeStartValue, 1990);
      expect(const WhenQuery.year(2024).decadeStartValue, isNull);
      expect(const WhenQuery.none().decadeStartValue, isNull);
    });
  });

  group('whenPickerParsedProvider', () {
    test('reacts to whenPickerQueryProvider', () {
      final c = ProviderContainer();
      addTearDown(c.dispose);
      expect(c.read(whenPickerParsedProvider), const WhenQuery.none());

      c.read(whenPickerQueryProvider.notifier).state = '2024';
      expect(c.read(whenPickerParsedProvider), const WhenQuery.year(2024));

      c.read(whenPickerQueryProvider.notifier).state = '20s';
      expect(c.read(whenPickerParsedProvider), const WhenQuery.decade(2020));
    });
  });

  group('whenPickerFilteredYearsProvider', () {
    ProviderContainer buildContainer(List<BucketLite> buckets) {
      return ProviderContainer(overrides: [timeBucketsProvider.overrideWith((ref, filter) => Future.value(buckets))]);
    }

    test('empty query → all years', () async {
      final c = buildContainer(const [(timeBucket: '2024-06-01', count: 12), (timeBucket: '2020-03-01', count: 3)]);
      addTearDown(c.dispose);
      final result = await c.read(whenPickerFilteredYearsProvider.future);
      expect(result.map((y) => y.year), [2024, 2020]);
    });

    test('year query filters to matching year', () async {
      final c = buildContainer(const [(timeBucket: '2024-06-01', count: 12), (timeBucket: '2020-03-01', count: 3)]);
      addTearDown(c.dispose);
      c.read(whenPickerQueryProvider.notifier).state = '2024';
      final result = await c.read(whenPickerFilteredYearsProvider.future);
      expect(result.map((y) => y.year), [2024]);
    });

    test('year query with no match → empty', () async {
      final c = buildContainer(const [(timeBucket: '2024-06-01', count: 12)]);
      addTearDown(c.dispose);
      c.read(whenPickerQueryProvider.notifier).state = '1800';
      final result = await c.read(whenPickerFilteredYearsProvider.future);
      expect(result, isEmpty);
    });

    test('decade query filters to years in [start, start+10)', () async {
      final c = buildContainer(const [
        (timeBucket: '2024-01-01', count: 1),
        (timeBucket: '2020-01-01', count: 1),
        (timeBucket: '2018-01-01', count: 1),
        (timeBucket: '2029-01-01', count: 1),
        (timeBucket: '2030-01-01', count: 1),
      ]);
      addTearDown(c.dispose);
      c.read(whenPickerQueryProvider.notifier).state = '2020s';
      final result = await c.read(whenPickerFilteredYearsProvider.future);
      final years = result.map((y) => y.year).toList()..sort();
      expect(years, [2020, 2024, 2029]);
    });

    test('garbage query (parses as none, non-empty) → empty', () async {
      final c = buildContainer(const [(timeBucket: '2024-06-01', count: 12)]);
      addTearDown(c.dispose);
      c.read(whenPickerQueryProvider.notifier).state = 'apples';
      final result = await c.read(whenPickerFilteredYearsProvider.future);
      expect(result, isEmpty);
    });
  });
}
