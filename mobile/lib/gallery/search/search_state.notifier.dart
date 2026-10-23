import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';

/// The search state of one screen, with the rules today's filter provider applies (photos_filter.provider.dart):
/// - a new text query starts at Relevance;
/// - a reference photo sets Photos only and Relevance;
/// - a query and a reference photo replace each other;
/// - choosing a tag turns Untagged off, and the reverse.
class SearchStateNotifier extends Notifier<SearchState> {
  @override
  SearchState build() => const SearchState();

  @override
  bool updateShouldNotify(SearchState previous, SearchState next) => previous != next;

  SearchFilters get _filters => state.filters;

  void _setFilters(SearchFilters filters) => state = state.copyWith(filters: filters);

  /// Clear all: every filter and the query; search mode stays open.
  void reset() => state = const SearchState();

  /// Enter on plain text. A different query starts over at Relevance (web's search palette does the same); an empty
  /// one clears the query.
  void submitText(String text) {
    final trimmed = text.trim();
    if (trimmed.isEmpty) {
      clearQuery();
      return;
    }
    if (state.query == SearchQuery.text(trimmed)) {
      return;
    }
    state = state.copyWith(query: SearchQuery.text(trimmed), sort: SearchSort.relevance);
  }

  /// "View similar photos": the reference photo replaces any text query, with Photos only and Relevance.
  void setReferencePhoto(String assetId) => state = state.copyWith(
    query: SearchQuery.similarTo(assetId),
    filters: _filters.copyWith(mediaType: SearchMediaType.image),
    sort: SearchSort.relevance,
  );

  /// Removing the query token. Relevance means nothing without a query, so it falls back to Newest.
  void clearQuery() => state = state.copyWith(
    query: const SearchQuery.none(),
    sort: state.sort == SearchSort.relevance ? SearchSort.newest : state.sort,
  );

  /// Relevance is only offered while a query is active.
  void setSort(SearchSort sort) {
    if (sort == SearchSort.relevance && !state.isQueryMode) {
      return;
    }
    state = state.copyWith(sort: sort);
  }

  void togglePerson(SearchPersonRef person) {
    final people = [..._filters.people];
    final index = people.indexWhere((p) => p.filterId == person.filterId);
    if (index >= 0) {
      people.removeAt(index);
    } else {
      people.add(person);
    }
    _setFilters(_filters.copyWith(people: people));
  }

  void clearPeople() => _setFilters(_filters.copyWith(people: const []));

  /// Choosing a tag turns Untagged off.
  void toggleTag(SearchTagRef tag) {
    final tags = [..._filters.tags];
    final index = tags.indexWhere((t) => t.id == tag.id);
    if (index >= 0) {
      tags.removeAt(index);
    } else {
      tags.add(tag);
    }
    _setFilters(_filters.copyWith(tags: tags, untagged: false));
  }

  void clearTags() => _setFilters(_filters.copyWith(tags: const []));

  /// Untagged only clears the chosen tags.
  void setUntagged(bool untagged) =>
      _setFilters(_filters.copyWith(untagged: untagged, tags: untagged ? const [] : _filters.tags));

  void setPlace(SearchPlace? place) => _setFilters(_filters.copyWith(place: place));

  void setCamera(SearchCamera? camera) => _setFilters(_filters.copyWith(camera: camera));

  void setMinRating(int? rating) => _setFilters(_filters.copyWith(minRating: rating));

  void setMediaType(SearchMediaType type) => _setFilters(_filters.copyWith(mediaType: type));

  void setFavoritesOnly(bool value) => _setFilters(_filters.copyWith(favoritesOnly: value));

  void setAlbumFilter(SearchAlbumFilter value) => _setFilters(_filters.copyWith(album: value));

  void setArchivedOnly(bool value) => _setFilters(_filters.copyWith(archivedOnly: value));

  void setText(SearchText text) => _setFilters(_filters.copyWith(text: text));

  /// One period at a time: a year, month, quick range or custom range replaces the previous one.
  void setDate(SearchDate? date) => _setFilters(_filters.copyWith(date: date));
}
