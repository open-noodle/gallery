/// Pure helpers for aggregating time-bucket data into year/month/decade
/// structures consumed by the `WhenAccordionSection` widget.
///
/// Buckets arrive as a list of `(timeBucket: 'YYYY-MM-DD', count: int)` tuples
/// from `TimelineApi.getTimeBuckets`. The helpers below never touch the API
/// and can be exercised without any test binding.
library;

class YearCount {
  final int year;
  final int count;
  const YearCount({required this.year, required this.count});
}

class MonthCount {
  final int month; // 1..12
  final int count;
  const MonthCount({required this.month, required this.count});
}

class DecadeBucket {
  final int decadeStart; // 2020 for the 2020s
  final int count;
  const DecadeBucket({required this.decadeStart, required this.count});
}

typedef BucketLite = ({String timeBucket, int count});

/// Aggregates per-month buckets into per-year totals, sorted descending.
List<YearCount> aggregateYears(List<BucketLite> buckets) {
  final byYear = <int, int>{};
  for (final b in buckets) {
    final year = int.parse(b.timeBucket.substring(0, 4));
    byYear[year] = (byYear[year] ?? 0) + b.count;
  }
  final entries = byYear.entries.toList()..sort((a, b) => b.key.compareTo(a.key));
  return [for (final e in entries) YearCount(year: e.key, count: e.value)];
}

/// Returns 12 `MonthCount`s (Jan..Dec) with counts for [year]. Months with no
/// matching bucket in [buckets] return count=0.
List<MonthCount> getMonthsForYear(List<BucketLite> buckets, int year) {
  final counts = List<int>.filled(12, 0);
  for (final b in buckets) {
    if (!b.timeBucket.startsWith('$year-')) continue;
    final month = int.parse(b.timeBucket.substring(5, 7));
    counts[month - 1] += b.count;
  }
  return [for (var i = 0; i < 12; i++) MonthCount(month: i + 1, count: counts[i])];
}

/// Collapses a list of `YearCount` into per-decade totals, sorted descending.
List<DecadeBucket> peekDecadesForYears(List<YearCount> years) {
  final byDecade = <int, int>{};
  for (final y in years) {
    final d = (y.year ~/ 10) * 10;
    byDecade[d] = (byDecade[d] ?? 0) + y.count;
  }
  final entries = byDecade.entries.toList()..sort((a, b) => b.key.compareTo(a.key));
  return [for (final e in entries) DecadeBucket(decadeStart: e.key, count: e.value)];
}
