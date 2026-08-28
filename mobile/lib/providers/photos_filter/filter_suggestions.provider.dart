// photosFilterSuggestionsProvider — wraps SearchApi.getFilterSuggestions.
//
// Debouncing intentionally lives at the consumer (Timeline / filter sheet) in PR 1.2.
// Keep this provider stateless: each new SearchFilter family-key triggers a fresh
// request via family.autoDispose; no Timer or throttle inside.

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/photos_filter/asset_type_mapper.dart';
import 'package:openapi/api.dart' hide SearchFilter;

final photosFilterSuggestionsProvider = FutureProvider.autoDispose.family<FilterSuggestionsResponseDto, SearchFilter>((
  ref,
  filter,
) async {
  final api = ref.watch(apiServiceProvider).searchApi;
  final response = await api.getFilterSuggestions(
    city: filter.location.city,
    country: filter.location.country,
    isFavorite: filter.display.isFavorite ? true : null,
    // #910: the albums facet is computed with this filter excluded, but every OTHER facet must still
    // honour it — dropping it here made all of them ignore the not-in-album toggle.
    isNotInAlbum: filter.display.isNotInAlbum ? true : null,
    make: filter.camera.make,
    mediaType: mapAssetType(filter.mediaType),
    model: filter.camera.model,
    personIds: filter.people.isEmpty ? null : filter.people.map((p) => p.id).toList(),
    rating: filter.rating.rating.unwrapOrNull,
    tagIds: filter.tagIds,
    takenAfter: filter.date.takenAfter,
    takenBefore: filter.date.takenBefore,
    // A non-owner viewer owns none of the shared-space assets they see, so an owner-scoped
    // facet query comes up empty. Request shared-space content so the facets populate,
    // mirroring the web filter page (map-filter-config.ts `withSharedSpaces: true`). The
    // server RBAC-projects the result. See issue #727 family (#737 / #738).
    withSharedSpaces: true,
  );
  if (response == null) {
    // #910: never fabricate an empty response. `sectionAvailabilityProvider` cannot tell a fabricated
    // empty from a genuinely empty library and would hide six sections at once; an AsyncValue.error
    // makes it fall back to offering everything. Mirrors web's slice-4 sentinel removal (spec §4.6).
    throw Exception('filter suggestions unavailable');
  }
  return response;
});
