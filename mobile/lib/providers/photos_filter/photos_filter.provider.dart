import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/entities/asset.entity.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';

final photosFilterProvider =
    NotifierProvider<PhotosFilterNotifier, SearchFilter>(PhotosFilterNotifier.new);

class PhotosFilterNotifier extends Notifier<SearchFilter> {
  @override
  SearchFilter build() => SearchFilter.empty();

  void reset() => state = SearchFilter.empty();

  // SearchFilter.copyWith null-coalesces, so use cascade to set nullable fields.
  void setText(String text) =>
      state = state.copyWith()..context = text.isEmpty ? null : text;

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
    state = state.copyWith()..tagIds = current.isEmpty ? null : current;
  }

  void setLocation(SearchLocationFilter? location) =>
      state = state.copyWith(location: location ?? SearchLocationFilter());

  void setDateRange({DateTime? start, DateTime? end}) =>
      state = state.copyWith(date: SearchDateFilter(takenAfter: start, takenBefore: end));

  void setRating(int? rating) =>
      state = state.copyWith(rating: SearchRatingFilter(rating: rating));

  void setMediaType(AssetType? type) =>
      state = state.copyWith(mediaType: type ?? AssetType.other);

  void setFavouritesOnly(bool v) =>
      state = state.copyWith(display: state.display.copyWith(isFavorite: v));

  void setArchivedIncluded(bool v) =>
      state = state.copyWith(display: state.display.copyWith(isArchive: v));

  void setNotInAlbum(bool v) =>
      state = state.copyWith(display: state.display.copyWith(isNotInAlbum: v));

  void clearPeople() => state = state.copyWith(people: const {});

  void clearTags() => state = state.copyWith()..tagIds = null;
}
