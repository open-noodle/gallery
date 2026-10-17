import 'package:immich_mobile/models/search/search_filter.model.dart';

/// The photos filter's id view of upstream's `SearchFilter.tags`: the API, the chips and the pickers all key on
/// the tag id, so they read this rather than mapping the set at every call site. Insertion order is kept, as
/// `tags` is a LinkedHashSet.
extension SearchFilterTagIds on SearchFilter {
  List<String>? get tagIds => tags?.map((tag) => tag.id).toList();
}
