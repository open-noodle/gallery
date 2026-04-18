import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';
import 'package:immich_mobile/providers/photos_filter/time_buckets.provider.dart';

/// Parsed "When picker" search query.
///
/// The search field accepts year tokens like `2024` and decade tokens like
/// `2020s` or `20s`. Unparseable / empty strings fall back to [WhenQuery.none].
sealed class WhenQuery {
  const WhenQuery();
  const factory WhenQuery.year(int year) = _YearQuery;
  const factory WhenQuery.decade(int decadeStart) = _DecadeQuery;
  const factory WhenQuery.none() = _NoneQuery;
}

class _YearQuery extends WhenQuery {
  final int year;
  const _YearQuery(this.year);
  @override
  bool operator ==(Object other) => other is _YearQuery && other.year == year;
  @override
  int get hashCode => year.hashCode;
  @override
  String toString() => 'WhenQuery.year($year)';
}

class _DecadeQuery extends WhenQuery {
  final int decadeStart;
  const _DecadeQuery(this.decadeStart);
  @override
  bool operator ==(Object other) => other is _DecadeQuery && other.decadeStart == decadeStart;
  @override
  int get hashCode => decadeStart.hashCode;
  @override
  String toString() => 'WhenQuery.decade($decadeStart)';
}

class _NoneQuery extends WhenQuery {
  const _NoneQuery();
  @override
  bool operator ==(Object other) => other is _NoneQuery;
  @override
  int get hashCode => 0;
  @override
  String toString() => 'WhenQuery.none()';
}

/// Accepted tokens (case-insensitive, whitespace trimmed):
///   - 4-digit year:        `2024`          → [WhenQuery.year(2024)]
///   - 2-digit decade:      `20s` / `20S`   → [WhenQuery.decade(2020)]
///   - 4-digit decade:      `2020s`         → [WhenQuery.decade(2020)]
///   - empty / garbage:                     → [WhenQuery.none()]
///
/// 2-digit decade heuristic: `Xs` where X in 00..99 means "20Xs" (the 2000-2099
/// range). Gallery photos are almost entirely 2000-onward; the ambiguity is
/// resolved in the common direction.
///
/// 3-digit prefixes before `s` (e.g. `202s`) and non-decade-start 4-digit
/// years with `s` (e.g. `2025s`) are rejected as [WhenQuery.none].
WhenQuery parseWhenQuery(String raw) {
  final s = raw.trim().toLowerCase();
  if (s.isEmpty) return const WhenQuery.none();

  // 4-digit year
  if (RegExp(r'^\d{4}$').hasMatch(s)) {
    return WhenQuery.year(int.parse(s));
  }

  // 4-digit decade: 2020s (only accept decade-start years, last digit 0)
  final mDec4 = RegExp(r'^(\d{4})s$').firstMatch(s);
  if (mDec4 != null) {
    final year = int.parse(mDec4.group(1)!);
    if (year % 10 == 0) return WhenQuery.decade(year);
    return const WhenQuery.none();
  }

  // 2-digit decade: 20s → 2020s. Range 00..99.
  final mDec2 = RegExp(r'^(\d{2})s$').firstMatch(s);
  if (mDec2 != null) {
    final suffix = int.parse(mDec2.group(1)!);
    return WhenQuery.decade(2000 + suffix);
  }

  return const WhenQuery.none();
}

/// Public read-access to the private [WhenQuery] subtypes.
///
/// External consumers (e.g. page state that reacts to parsed queries) cannot
/// pattern-match on [_YearQuery] / [_DecadeQuery] since those are private to
/// this file. This extension exposes the underlying values through nullable
/// getters so callers can branch with `if (next.yearValue case final int y)`.
extension WhenQueryAccess on WhenQuery {
  /// Returns the year if this is a [WhenQuery.year], else null.
  int? get yearValue => switch (this) {
    _YearQuery(:final year) => year,
    _ => null,
  };

  /// Returns the decade start year if this is a [WhenQuery.decade], else null.
  int? get decadeStartValue => switch (this) {
    _DecadeQuery(:final decadeStart) => decadeStart,
    _ => null,
  };
}

/// Live query string. `StateProvider` so the TextField can write and the
/// parser/filter providers can react.
final whenPickerQueryProvider = StateProvider<String>((ref) => '');

/// Pure derivation of [WhenQuery] from [whenPickerQueryProvider].
final whenPickerParsedProvider = Provider<WhenQuery>((ref) {
  return parseWhenQuery(ref.watch(whenPickerQueryProvider));
});

/// The list of years with photos matching the current parsed query + the
/// sheet's broader filter context.
///
/// Filter semantics:
/// - [WhenQuery.year] n → years containing exactly n (0 or 1 entry).
/// - [WhenQuery.decade] d → years in [d, d+10).
/// - [WhenQuery.none] with empty query → all years from time buckets.
/// - [WhenQuery.none] with non-empty query (garbage input) → empty list.
final whenPickerFilteredYearsProvider = FutureProvider.autoDispose<List<YearCount>>((ref) async {
  final filter = ref.watch(photosFilterProvider);
  final buckets = await ref.watch(timeBucketsProvider(filter).future);
  final parsed = ref.watch(whenPickerParsedProvider);
  final query = ref.watch(whenPickerQueryProvider).trim();
  final allYears = aggregateYears(buckets);

  return switch (parsed) {
    _YearQuery(:final year) => allYears.where((y) => y.year == year).toList(),
    _DecadeQuery(:final decadeStart) =>
      allYears.where((y) => y.year >= decadeStart && y.year < decadeStart + 10).toList(),
    _NoneQuery() when query.isEmpty => allYears,
    _NoneQuery() => <YearCount>[],
  };
});
