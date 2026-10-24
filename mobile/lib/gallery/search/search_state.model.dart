import 'package:freezed_annotation/freezed_annotation.dart';

part 'search_state.model.freezed.dart';

// The search mode's state (specs/2026-10-23-mobile-search-redesign-design.md, Slice 2): the filters, a text query OR a
// reference photo, and the sort. One instance per screen (see search.providers.dart); the screen's fixed scope lives
// in SearchScope, never here.

/// Newest / Oldest sort by date; Relevance only while a query or reference photo is active.
enum SearchSort { newest, oldest, relevance }

enum SearchMediaType { all, image, video }

/// Albums section of the Filters sheet.
enum SearchAlbumFilter { any, inAlbum, notInAlbum }

/// The When sheet's quick-range row.
enum SearchQuickRange { today, thisWeek, thisMonth, thisYear }

/// A selected person. [filterId] is what the server told us to send: `SearchOptionsPersonDto.filterId` (a
/// `person:` / `space-person:` token in shared scopes, a bare id in owner or space scopes), never the response `id`
/// of an older server's list (see GallerySearchRepository for the fallback). [profileId] / [profileType] /
/// [profileSpaceId] carry the thumbnail profile so a Space person's avatar never reaches the owner-only endpoint.
@freezed
abstract class SearchPersonRef with _$SearchPersonRef {
  const factory SearchPersonRef({
    required String filterId,
    required String name,
    String? profileId,
    String? profileType,
    String? profileSpaceId,
  }) = _SearchPersonRef;
}

@freezed
abstract class SearchTagRef with _$SearchTagRef {
  const factory SearchTagRef({required String id, required String value}) = _SearchTagRef;
}

/// One place at a time: a whole country, or a city (with its country).
@freezed
abstract class SearchPlace with _$SearchPlace {
  const factory SearchPlace({String? country, String? state, String? city}) = _SearchPlace;
}

/// A make alone means "Any `make`".
@freezed
abstract class SearchCamera with _$SearchCamera {
  const factory SearchCamera({required String make, String? model}) = _SearchCamera;
}

/// The Filters sheet's three text inputs; all three may be set at once.
@freezed
abstract class SearchText with _$SearchText {
  const SearchText._();

  const factory SearchText({String? ocr, String? fileName, String? description}) = _SearchText;

  bool get isEmpty => _blank(ocr) && _blank(fileName) && _blank(description);
}

bool _blank(String? value) => value == null || value.trim().isEmpty;

/// One calendar day range, both ends inclusive, as the user chose it (no time of day). A custom range may leave one end
/// open: no first day means "up to and including the last day", no last day means "from the first day on".
class SearchDayRange {
  final DateTime? firstDay;
  final DateTime? lastDay;

  SearchDayRange(DateTime? first, DateTime? last) : firstDay = _day(first), lastDay = _day(last);

  static DateTime? _day(DateTime? value) => value == null ? null : DateTime(value.year, value.month, value.day);

  @override
  bool operator ==(Object other) => other is SearchDayRange && other.firstDay == firstDay && other.lastDay == lastDay;

  @override
  int get hashCode => Object.hash(firstDay, lastDay);

  @override
  String toString() => 'SearchDayRange($firstDay, $lastDay)';
}

/// One period at a time: a year, a month, a decade (typed in the field), a quick range, or a custom range from the
/// Filters sheet. Setting one replaces the other.
@freezed
sealed class SearchDate with _$SearchDate {
  const SearchDate._();

  const factory SearchDate.year(int year) = SearchDateYear;
  const factory SearchDate.month(int year, int month) = SearchDateMonth;
  const factory SearchDate.decade(int start) = SearchDateDecade;
  const factory SearchDate.quickRange(SearchQuickRange range) = SearchDateQuickRange;

  /// The Filters sheet's From/To. At least one end is set; the other may stay open.
  const factory SearchDate.custom({DateTime? from, DateTime? to}) = SearchDateCustom;

  /// The calendar days this period covers. Quick ranges end today, as today's quick-range row does.
  SearchDayRange resolve(DateTime now) => switch (this) {
    SearchDateYear(:final year) => SearchDayRange(DateTime(year), DateTime(year, 12, 31)),
    SearchDateMonth(:final year, :final month) => SearchDayRange(DateTime(year, month), DateTime(year, month + 1, 0)),
    SearchDateDecade(:final start) => SearchDayRange(DateTime(start), DateTime(start + 9, 12, 31)),
    SearchDateQuickRange(:final range) => switch (range) {
      SearchQuickRange.today => SearchDayRange(now, now),
      SearchQuickRange.thisWeek => SearchDayRange(DateTime(now.year, now.month, now.day - now.weekday + 1), now),
      SearchQuickRange.thisMonth => SearchDayRange(DateTime(now.year, now.month), now),
      SearchQuickRange.thisYear => SearchDayRange(DateTime(now.year), now),
    },
    SearchDateCustom(:final from, :final to) => SearchDayRange(from, to),
  };
}

@freezed
abstract class SearchFilters with _$SearchFilters {
  const SearchFilters._();

  const factory SearchFilters({
    @Default(<SearchPersonRef>[]) List<SearchPersonRef> people,
    @Default(<SearchTagRef>[]) List<SearchTagRef> tags,
    @Default(false) bool untagged,
    SearchPlace? place,
    SearchCamera? camera,

    /// "At least N" stars.
    int? minRating,
    @Default(SearchMediaType.all) SearchMediaType mediaType,
    @Default(false) bool favoritesOnly,
    @Default(SearchAlbumFilter.any) SearchAlbumFilter album,
    @Default(false) bool archivedOnly,
    @Default(SearchText()) SearchText text,
    SearchDate? date,
  }) = _SearchFilters;

  bool get isEmpty => this == const SearchFilters();
}

/// A text query or a reference photo, never both.
@freezed
sealed class SearchQuery with _$SearchQuery {
  const factory SearchQuery.none() = SearchQueryNone;
  const factory SearchQuery.text(String text) = SearchQueryText;
  const factory SearchQuery.similarTo(String assetId) = SearchQuerySimilarTo;
}

@freezed
abstract class SearchState with _$SearchState {
  const SearchState._();

  const factory SearchState({
    @Default(SearchFilters()) SearchFilters filters,
    @Default(SearchQuery.none()) SearchQuery query,
    @Default(SearchSort.newest) SearchSort sort,
  }) = _SearchState;

  /// Query mode: results come from smart search.
  bool get isQueryMode => query is! SearchQueryNone;

  bool get isEmpty => filters.isEmpty && !isQueryMode;
}
