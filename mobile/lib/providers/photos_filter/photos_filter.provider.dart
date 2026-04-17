import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';

final photosFilterProvider =
    NotifierProvider<PhotosFilterNotifier, SearchFilter>(PhotosFilterNotifier.new);

class PhotosFilterNotifier extends Notifier<SearchFilter> {
  @override
  SearchFilter build() => SearchFilter.empty();

  void reset() => state = SearchFilter.empty();

  void setText(String text) =>
      state = state.copyWith(context: text.isEmpty ? null : text);

  void togglePerson(PersonDto person) {
    final next = Set<PersonDto>.from(state.people);
    if (!next.add(person)) next.remove(person);
    state = state.copyWith(people: next);
  }
}
