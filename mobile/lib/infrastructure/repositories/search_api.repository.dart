import 'dart:convert';

import 'package:immich_mobile/data/server/api_repository.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart' hide AssetVisibility;
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:immich_mobile/utils/option.dart';
import 'package:openapi/api.dart' hide SearchFilter;

class SearchApiRepository extends ApiRepository {
  final ApiService _apiService;

  SearchApiRepository(this._apiService);

  SearchApi get _api => _apiService.searchApi;

  List<String> _tagIdsForSearch(SearchFilter filter) => filter.tagIds ?? const <String>[];

  AssetOrder? _order(SearchFilter filter) => switch (filter.sort) {
    SearchSortOrder.relevance => null,
    SearchSortOrder.newest => AssetOrder.desc,
    SearchSortOrder.oldest => AssetOrder.asc,
  };

  Future<SearchResponseDto?> search(SearchFilter filter, int page) {
    AssetTypeEnum? type;
    if (filter.mediaType.index == AssetType.image.index) {
      type = AssetTypeEnum.IMAGE;
    } else if (filter.mediaType.index == AssetType.video.index) {
      type = AssetTypeEnum.VIDEO;
    }

    if ((filter.context != null && filter.context!.isNotEmpty) ||
        (filter.assetId != null && filter.assetId!.isNotEmpty)) {
      final dto = SmartSearchDto(
        query: filter.context == null ? const Optional.absent() : Optional.present(filter.context),
        queryAssetId: filter.assetId == null ? const Optional.absent() : Optional.present(filter.assetId),
        language: filter.language == null ? const Optional.absent() : Optional.present(filter.language),
        country: filter.location.country == null ? const Optional.absent() : Optional.present(filter.location.country),
        state: filter.location.state == null ? const Optional.absent() : Optional.present(filter.location.state),
        city: filter.location.city == null ? const Optional.absent() : Optional.present(filter.location.city),
        make: filter.camera.make == null ? const Optional.absent() : Optional.present(filter.camera.make),
        model: filter.camera.model == null ? const Optional.absent() : Optional.present(filter.camera.model),
        takenAfter: filter.date.takenAfter == null ? const Optional.absent() : Optional.present(filter.date.takenAfter),
        takenBefore: filter.date.takenBefore == null
            ? const Optional.absent()
            : Optional.present(filter.date.takenBefore),
        visibility: Optional.present(filter.display.isArchive ? AssetVisibility.archive : AssetVisibility.timeline),
        rating: filter.rating.rating.toOptional(),
        isFavorite: filter.display.isFavorite ? const Optional.present(true) : const Optional.absent(),
        isNotInAlbum: filter.display.isNotInAlbum ? const Optional.present(true) : const Optional.absent(),
        personIds: Optional.present(filter.people.map((e) => e.id).toList()),
        tagIds: Optional.present(_tagIdsForSearch(filter)),
        type: type == null ? const Optional.absent() : Optional.present(type),
        order: _order(filter) == null ? const Optional.absent() : Optional.present(_order(filter)),
        page: Optional.present(page),
        size: const Optional.present(100),
        // Include shared-space assets so a viewer's selected facet returns results (and a
        // space-person token resolves). Gated on favourite — favourites are owner-only, mirroring
        // web buildPhotosTimelineOptions (`includeSharedTimelineAssets = isFavorite === undefined`).
        withSharedSpaces: filter.display.isFavorite ? const Optional.absent() : const Optional.present(true),
      );
      return _api.searchSmart(filter.display.isUntagged ? _ExplicitNullTagIdsSmartSearchDto(dto) : dto);
    }

    final dto = MetadataSearchDto(
      originalFileName: filter.filename != null && filter.filename!.isNotEmpty
          ? Optional.present(filter.filename)
          : const Optional.absent(),
      country: filter.location.country == null ? const Optional.absent() : Optional.present(filter.location.country),
      description: filter.description != null && filter.description!.isNotEmpty
          ? Optional.present(filter.description)
          : const Optional.absent(),
      ocr: filter.ocr != null && filter.ocr!.isNotEmpty ? Optional.present(filter.ocr) : const Optional.absent(),
      state: filter.location.state == null ? const Optional.absent() : Optional.present(filter.location.state),
      city: filter.location.city == null ? const Optional.absent() : Optional.present(filter.location.city),
      make: filter.camera.make == null ? const Optional.absent() : Optional.present(filter.camera.make),
      model: filter.camera.model == null ? const Optional.absent() : Optional.present(filter.camera.model),
      takenAfter: filter.date.takenAfter == null ? const Optional.absent() : Optional.present(filter.date.takenAfter),
      takenBefore: filter.date.takenBefore == null
          ? const Optional.absent()
          : Optional.present(filter.date.takenBefore),
      visibility: Optional.present(filter.display.isArchive ? AssetVisibility.archive : AssetVisibility.timeline),
      rating: filter.rating.rating.toOptional(),
      isFavorite: filter.display.isFavorite ? const Optional.present(true) : const Optional.absent(),
      isNotInAlbum: filter.display.isNotInAlbum ? const Optional.present(true) : const Optional.absent(),
      personIds: Optional.present(filter.people.map((e) => e.id).toList()),
      tagIds: Optional.present(_tagIdsForSearch(filter)),
      type: type == null ? const Optional.absent() : Optional.present(type),
      order: _order(filter) == null ? const Optional.absent() : Optional.present(_order(filter)),
      page: Optional.present(page),
      size: const Optional.present(1000),
      // Include shared-space assets so a viewer's selected facet returns results (and a
      // space-person token resolves). Gated on favourite — favourites are owner-only, mirroring
      // web buildPhotosTimelineOptions (`includeSharedTimelineAssets = isFavorite === undefined`).
      withSharedSpaces: filter.display.isFavorite ? const Optional.absent() : const Optional.present(true),
    );
    return _api.searchAssets(filter.display.isUntagged ? _ExplicitNullTagIdsMetadataSearchDto(dto) : dto);
  }

  Future<List<String>?> getSearchSuggestions(
    SearchSuggestionType type, {
    String? country,
    String? state,
    String? make,
    String? model,
  }) async {
    final response = await _api.getSearchSuggestionsWithHttpInfo(
      type,
      country: country,
      state: state,
      make: make,
      model: model,
    );

    if (response.body.isEmpty) {
      return const [];
    }

    return List<String>.from(jsonDecode(utf8.decode(response.bodyBytes)) as List);
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
