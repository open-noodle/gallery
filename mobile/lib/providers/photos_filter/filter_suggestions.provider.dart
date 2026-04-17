// photosFilterSuggestionsProvider — wraps SearchApi.getFilterSuggestions.
//
// Debouncing intentionally lives at the consumer (Timeline / filter sheet) in PR 1.2.
// Keep this provider stateless: each new SearchFilter family-key triggers a fresh
// request via family.autoDispose; no Timer or throttle inside.

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/entities/asset.entity.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:openapi/api.dart';

final photosFilterSuggestionsProvider = FutureProvider.autoDispose.family<FilterSuggestionsResponseDto, SearchFilter>((
  ref,
  filter,
) async {
  final api = ref.watch(apiServiceProvider).searchApi;
  final response = await api.getFilterSuggestions(
    city: filter.location.city,
    country: filter.location.country,
    isFavorite: filter.display.isFavorite ? true : null,
    make: filter.camera.make,
    mediaType: _mapMediaType(filter.mediaType),
    model: filter.camera.model,
    personIds: filter.people.isEmpty ? null : filter.people.map((p) => p.id).toList(),
    rating: filter.rating.rating,
    tagIds: filter.tagIds,
    takenAfter: filter.date.takenAfter,
    takenBefore: filter.date.takenBefore,
  );
  return response ?? FilterSuggestionsResponseDto(hasUnnamedPeople: false);
});

// Mirrors SearchApiRepository.search() inline conversion. AssetType.other → null
// means "no server-side media-type constraint" (match all).
AssetTypeEnum? _mapMediaType(AssetType type) {
  if (type.index == AssetType.image.index) return AssetTypeEnum.IMAGE;
  if (type.index == AssetType.video.index) return AssetTypeEnum.VIDEO;
  if (type.index == AssetType.audio.index) return AssetTypeEnum.AUDIO;
  return null;
}
