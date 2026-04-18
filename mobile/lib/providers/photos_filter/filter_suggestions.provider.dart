// photosFilterSuggestionsProvider — wraps SearchApi.getFilterSuggestions.
//
// Debouncing intentionally lives at the consumer (Timeline / filter sheet) in PR 1.2.
// Keep this provider stateless: each new SearchFilter family-key triggers a fresh
// request via family.autoDispose; no Timer or throttle inside.

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/photos_filter/asset_type_mapper.dart';
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
    mediaType: mapAssetType(filter.mediaType),
    model: filter.camera.model,
    personIds: filter.people.isEmpty ? null : filter.people.map((p) => p.id).toList(),
    rating: filter.rating.rating,
    tagIds: filter.tagIds,
    takenAfter: filter.date.takenAfter,
    takenBefore: filter.date.takenBefore,
  );
  return response ?? FilterSuggestionsResponseDto(hasUnnamedPeople: false);
});
