import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_ui.providers.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:intl/intl.dart';

String _locale(BuildContext context) => Localizations.maybeLocaleOf(context)?.toLanguageTag() ?? 'en';

DateFormat _format(BuildContext context, DateFormat Function(String locale) build) {
  try {
    return build(_locale(context));
  } catch (_) {
    return build('en');
  }
}

/// A count with the locale's grouping ("1,204").
String formatSearchCount(BuildContext context, int count) {
  try {
    return NumberFormat.decimalPattern(_locale(context)).format(count);
  } catch (_) {
    return '$count';
  }
}

/// Short month name ("Jun") for the When sheet's month grid.
String searchShortMonth(BuildContext context, int month) =>
    _format(context, DateFormat.MMM).format(DateTime(2000, month));

/// One period as a chip or suggestion reads it: "2024", "Jun 2024", "2020s", "Today", "1 Jan – 5 Feb 2024".
String searchDateLabel(BuildContext context, SearchDate date) => switch (date) {
  SearchDateYear(:final year) => '$year',
  SearchDateMonth(:final year, :final month) => _format(context, DateFormat.yMMM).format(DateTime(year, month)),
  SearchDateDecade(:final start) => '${start}s',
  SearchDateQuickRange(:final range) => switch (range) {
    SearchQuickRange.today => context.t.filter_sheet_when_today,
    SearchQuickRange.thisWeek => context.t.filter_sheet_when_week,
    SearchQuickRange.thisMonth => context.t.filter_sheet_when_month,
    SearchQuickRange.thisYear => context.t.filter_sheet_when_year,
  },
  SearchDateCustom(:final from?, :final to?) => context.t.search_filter_date_interval(
    start: _format(context, DateFormat.yMMMd).format(from),
    end: _format(context, DateFormat.yMMMd).format(to),
  ),
  SearchDateCustom(:final from?) => context.t.search_filter_date_since(
    date: _format(context, DateFormat.yMMMd).format(from),
  ),
  SearchDateCustom(:final to?) => context.t.search_filter_date_until(
    date: _format(context, DateFormat.yMMMd).format(to),
  ),
  SearchDateCustom() => '',
};

/// The People chip's value: first names, as the prototype shows them ("Anna, Ben").
/// The search field's placeholder: where you are ("Search in Japan 2023", "Search Anna's photos", "Search favorites"). Photos keeps the
/// field's syntax hint; a screen whose name has not loaded yet reads "Search".
String searchFieldHint(BuildContext context, SearchScope scope, String? name) {
  if (scope is PhotosSearchScope) {
    return context.t.search_mode_field_hint;
  }
  switch (scope) {
    case FavoritesSearchScope():
      return context.t.search_mode_field_hint_favorites;
    case ArchiveSearchScope():
      return context.t.search_mode_field_hint_archive;
    case VideosSearchScope():
      return context.t.search_mode_field_hint_videos;
    case RecentlyAddedSearchScope():
      return context.t.search_mode_field_hint_recently_added;
    case RecentlyTakenSearchScope():
      return context.t.search_mode_field_hint_recently_taken;
    default:
      break;
  }
  final named = name?.trim() ?? '';
  if (scope is PersonalPersonSearchScope || scope is SpacePersonSearchScope) {
    return named.isEmpty
        ? context.t.search_mode_field_hint_person_unnamed
        : context.t.search_mode_field_hint_person(name: named);
  }
  return named.isEmpty ? context.t.search : context.t.search_mode_field_hint_in(name: named);
}

String searchPeopleLabel(List<SearchPersonRef> people) =>
    people.map((p) => p.name.trim().split(RegExp(r'\s+')).first).join(', ');

String searchTagsLabel(List<SearchTagRef> tags) => tags.map((t) => '#${t.value}').join(' ');

String searchPlaceLabel(SearchPlace place) => place.city ?? place.state ?? place.country ?? '';

/// An extra filter's chip label.
String searchExtraLabel(BuildContext context, SearchExtraFilter filter, SearchFilters filters) => switch (filter) {
  SearchExtraFilter.favorites => context.t.favorites,
  SearchExtraFilter.mediaType =>
    filters.mediaType == SearchMediaType.video
        ? context.t.filter_sheet_media_videos
        : context.t.filter_sheet_media_photos,
  SearchExtraFilter.rating => context.t.filter_chip_rating(rating: filters.minRating ?? 0),
  SearchExtraFilter.camera => filters.camera?.model ?? filters.camera?.make ?? '',
  SearchExtraFilter.album =>
    filters.album == SearchAlbumFilter.inAlbum ? context.t.filter_has_album : context.t.filter_has_no_album,
  SearchExtraFilter.text => [
    filters.text.ocr,
    filters.text.fileName,
    filters.text.description,
  ].where((v) => v != null && v.trim().isNotEmpty).map((v) => '“${v!.trim()}”').join(' '),
  SearchExtraFilter.dateRange => filters.date == null ? '' : searchDateLabel(context, filters.date!),
  SearchExtraFilter.archived => context.t.filter_sheet_archived,
  SearchExtraFilter.untagged => context.t.untagged,
};

/// An extra filter's chip icon ("♥ Favorites ✕").
IconData searchExtraIcon(SearchExtraFilter filter, SearchFilters filters) => switch (filter) {
  SearchExtraFilter.favorites => Icons.favorite_rounded,
  SearchExtraFilter.mediaType =>
    filters.mediaType == SearchMediaType.video ? Icons.videocam_outlined : Icons.photo_outlined,
  SearchExtraFilter.rating => Icons.star_rounded,
  SearchExtraFilter.camera => Icons.photo_camera_outlined,
  SearchExtraFilter.album => Icons.photo_album_outlined,
  SearchExtraFilter.text => Icons.text_fields_rounded,
  SearchExtraFilter.dateRange => Icons.date_range_rounded,
  SearchExtraFilter.archived => Icons.archive_outlined,
  SearchExtraFilter.untagged => Icons.label_off_outlined,
};
