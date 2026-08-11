import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/chip_id.dart';
import 'package:immich_mobile/utils/option.dart';

final photosFilterProvider = NotifierProvider<PhotosFilterNotifier, SearchFilter>(PhotosFilterNotifier.new);

enum Dimension { people, tags, location, date, camera, rating, mediaType, display, text }

class PhotosFilterNotifier extends Notifier<SearchFilter> {
  @override
  SearchFilter build() => SearchFilter.empty();

  @override
  bool updateShouldNotify(SearchFilter previous, SearchFilter next) => previous != next;

  void reset() => state = SearchFilter.empty();

  // SearchFilter.copyWith null-coalesces, so use cascade to set nullable fields.
  void setText(String text) {
    final next = state.copyWith()..context = text.isEmpty ? null : text;
    // Every new query starts over at Relevance, matching web: the search palette
    // resets `searchSortOrder` to relevance when a session opens on an empty query
    // and when the query is cleared (global-search-manager `open()` /
    // `activateSearch('')`). A sort the user picks therefore applies to the results
    // in front of them and is dropped once they search for something else.
    //
    // The sort is deliberately *not* rewritten to a date order for metadata-only
    // filters — relevance degrades to newest-first where it has to (no `order` on
    // the search request, date grouping in the timeline, "Newest first" in the sort
    // sheet). Coercing the stored value instead used to pin the app to Newest first
    // for the rest of the session once a query had been cleared (#902).
    state = next.context == state.context ? next : next.copyWith(sort: SearchSortOrder.relevance);
  }

  void setSort(SearchSortOrder sort) => state = state.copyWith(sort: sort);

  void setSimilarTo(String assetId) =>
      state = SearchFilter.empty().copyWith(assetId: assetId, mediaType: AssetType.image);

  void togglePerson(PersonDto person) {
    final next = Set<PersonDto>.from(state.people);
    if (!next.add(person)) next.remove(person);
    state = state.copyWith(people: next);
  }

  void toggleTag(String tagId) {
    final current = List<String>.from(state.tagIds ?? const []);
    if (current.contains(tagId)) {
      current.remove(tagId);
    } else {
      current.add(tagId);
    }
    state = state.copyWith(display: state.display.copyWith(isUntagged: false))
      ..tagIds = current.isEmpty ? null : current;
  }

  void setLocation(SearchLocationFilter? location) =>
      state = state.copyWith(location: location ?? SearchLocationFilter());

  void setCamera(SearchCameraFilter? camera) => state = state.copyWith(camera: camera ?? SearchCameraFilter());

  void setDateRange({DateTime? start, DateTime? end}) => state = state.copyWith(
    date: SearchDateFilter(takenAfter: start, takenBefore: end),
  );

  void setRating(int? rating) =>
      state = state.copyWith(rating: SearchRatingFilter(rating: Option.fromNullable(rating)));

  void setMediaType(AssetType? type) => state = state.copyWith(mediaType: type ?? AssetType.other);

  void setFavouritesOnly(bool v) => state = state.copyWith(display: state.display.copyWith(isFavorite: v));

  void setArchivedIncluded(bool v) => state = state.copyWith(display: state.display.copyWith(isArchive: v));

  void setNotInAlbum(bool v) => state = state.copyWith(display: state.display.copyWith(isNotInAlbum: v));

  void setUntagged(bool v) {
    final previousTagIds = state.tagIds;
    state = state.copyWith(display: state.display.copyWith(isUntagged: v))..tagIds = v ? null : previousTagIds;
  }

  void clearPeople() => state = state.copyWith(people: const {});

  void clearTags() => state = state.copyWith()..tagIds = null;

  void clearDimension(Dimension d) {
    switch (d) {
      case Dimension.people:
        clearPeople();
      case Dimension.tags:
        clearTags();
      case Dimension.location:
        setLocation(null);
      case Dimension.date:
        setDateRange(start: null, end: null);
      case Dimension.camera:
        state = state.copyWith(camera: SearchCameraFilter());
      case Dimension.rating:
        setRating(null);
      case Dimension.mediaType:
        setMediaType(null);
      case Dimension.display:
        state = state.copyWith(
          display: const SearchDisplayFilters(isFavorite: false, isArchive: false, isNotInAlbum: false),
        );
      case Dimension.text:
        setText('');
    }
  }

  void removeChip(ChipId id) {
    switch (id) {
      case PersonChipId(:final personId):
        state = state.copyWith(people: state.people.where((p) => p.id != personId).toSet());
      case TagChipId(:final tagId):
        final next = List<String>.from(state.tagIds ?? const [])..remove(tagId);
        state = state.copyWith()..tagIds = next.isEmpty ? null : next;
      case LocationChipId():
        setLocation(null);
      case CameraChipId():
        setCamera(null);
      case DateChipId():
        setDateRange(start: null, end: null);
      case RatingChipId():
        setRating(null);
      case MediaTypeChipId():
        setMediaType(null);
      case FavouriteChipId():
        setFavouritesOnly(false);
      case ArchiveChipId():
        setArchivedIncluded(false);
      case NotInAlbumChipId():
        setNotInAlbum(false);
      case UntaggedChipId():
        setUntagged(false);
      case TextChipId():
        setText('');
    }
  }
}
