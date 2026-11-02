import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:openapi/api.dart' hide SearchFilter;

// Gallery's search fields on top of upstream's SmartSearchDto / MetadataSearchDto literals in
// search_api.repository.dart: wall-clock taken ranges, sort order, untagged search and
// shared-space assets.

AssetOrder? _order(SearchFilter filter) => switch (filter.sort) {
  SearchSortOrder.relevance => null,
  SearchSortOrder.newest => AssetOrder.desc,
  SearchSortOrder.oldest => AssetOrder.asc,
};

extension GallerySmartSearchDto on SmartSearchDto {
  SmartSearchDto withGallery(SearchFilter filter, {required bool localTakenRange}) {
    if (filter.date.takenAfter != null) {
      takenAfter = Optional.present(filter.date.takenAfterParam(localTakenRange: localTakenRange));
    }
    if (filter.date.takenBefore != null) {
      takenBefore = Optional.present(filter.date.takenBeforeParam(localTakenRange: localTakenRange));
    }
    tagIds = Optional.present(filter.tagIds ?? const <String>[]);
    order = _order(filter) == null ? const Optional.absent() : Optional.present(_order(filter));
    // Include shared-space assets so a viewer's selected facet returns results (and a
    // space-person token resolves). #763: favorites are per-user, so the server composes
    // shared-space visibility with the favorite filter (slice 4) — no need to suppress it here.
    withSharedSpaces = const Optional.present(true);
    return filter.display.isUntagged ? _ExplicitNullTagIdsSmartSearchDto(this) : this;
  }
}

extension GalleryMetadataSearchDto on MetadataSearchDto {
  MetadataSearchDto withGallery(SearchFilter filter, {required bool localTakenRange}) {
    if (filter.date.takenAfter != null) {
      takenAfter = Optional.present(filter.date.takenAfterParam(localTakenRange: localTakenRange));
    }
    if (filter.date.takenBefore != null) {
      takenBefore = Optional.present(filter.date.takenBeforeParam(localTakenRange: localTakenRange));
    }
    tagIds = Optional.present(filter.tagIds ?? const <String>[]);
    order = _order(filter) == null ? const Optional.absent() : Optional.present(_order(filter));
    // See GallerySmartSearchDto.withGallery.
    withSharedSpaces = const Optional.present(true);
    return filter.display.isUntagged ? _ExplicitNullTagIdsMetadataSearchDto(this) : this;
  }
}

// The generated DTOs omit null fields, but the search API uses explicit
// `tagIds: null` to mean "assets without tags".
class _ExplicitNullTagIdsMetadataSearchDto extends MetadataSearchDto {
  final MetadataSearchDto _delegate;

  _ExplicitNullTagIdsMetadataSearchDto(this._delegate) : super();

  @override
  Map<String, dynamic> toJson() => _delegate.toJson()..[r'tagIds'] = null;
}

class _ExplicitNullTagIdsSmartSearchDto extends SmartSearchDto {
  final SmartSearchDto _delegate;

  _ExplicitNullTagIdsSmartSearchDto(this._delegate) : super();

  @override
  Map<String, dynamic> toJson() => _delegate.toJson()..[r'tagIds'] = null;
}
