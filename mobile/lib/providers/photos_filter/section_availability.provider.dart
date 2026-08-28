import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:openapi/api.dart' hide SearchFilter;

/// Which deep-sheet sections can actually filter something right now (#910).
///
/// Mirrors web's `filter-availability.ts`, minus its structural/transient split: mobile has no
/// `(0)` grey treatment, so the three verdicts (`available` / `empty` / `unavailable`) collapse to
/// two renderings here — a section is either offered or it isn't.
///
/// This is DERIVED. It is never written to [hiddenSectionsProvider], which is the user's own
/// persisted choice — conflating them would record a section as deliberately hidden the moment its
/// facet went empty, and it would never come back.
///
/// Facets vs. active-filter state (#910 fix-wave finding 1): every facets lookup here is keyed on
/// [photosFilterDebouncedProvider] (250 ms), the same key every other deep-sheet consumer shares —
/// so a burst of discrete taps coalesces into one request instead of firing one per tap on a family
/// key nobody else holds. [hasActiveFilterFor] and any raw `display`/filter read, by contrast, MUST
/// stay on the immediate [photosFilterProvider]: the active-filter escape hatch has to react the
/// instant the user sets or clears a filter, or the control it guards would flicker away for 250 ms
/// before coming back.

/// Whether this section itself currently holds a filter value. Mirrors web's
/// `hasActiveFilter` (`filter-panel.svelte:621-659`) section for section.
bool hasActiveFilterFor(FilterSectionId id, SearchFilter filter) {
  switch (id) {
    case FilterSectionId.people:
      return filter.people.isNotEmpty;
    case FilterSectionId.places:
      return filter.location.country != null || filter.location.state != null || filter.location.city != null;
    case FilterSectionId.tags:
      return (filter.tagIds ?? const []).isNotEmpty;
    case FilterSectionId.camera:
      return filter.camera.make != null || filter.camera.model != null;
    case FilterSectionId.rating:
      return filter.rating.rating.isSome;
    case FilterSectionId.media:
      return filter.mediaType != AssetType.other;
    case FilterSectionId.when:
      return filter.date.takenAfter != null || filter.date.takenBefore != null;
    case FilterSectionId.toggles:
      return filter.display.isFavorite ||
          filter.display.isArchive ||
          filter.display.isNotInAlbum ||
          filter.display.isUntagged;
  }
}

bool _facetEmpty(FilterSectionId id, FilterSuggestionsResponseDto facets) {
  switch (id) {
    case FilterSectionId.people:
      return facets.people.isEmpty && !facets.hasUnnamedPeople;
    case FilterSectionId.places:
      return facets.countries.isEmpty;
    case FilterSectionId.tags:
      return facets.tags.isEmpty;
    case FilterSectionId.camera:
      return facets.cameraMakes.isEmpty;
    case FilterSectionId.rating:
      return facets.ratings.isEmpty;
    case FilterSectionId.media:
      // The control offers All / Photos / Videos, so it needs both of those to discriminate.
      // NOT `length >= 2`: the server returns raw distinct asset.type and AssetType is
      // IMAGE | VIDEO | AUDIO | OTHER, so a photo library with one OTHER asset would pass a
      // length test while the Videos button stays dead. Same rule as web's filter-availability.ts.
      return !(facets.mediaTypes.contains('IMAGE') && facets.mediaTypes.contains('VIDEO'));
    case FilterSectionId.when:
    case FilterSectionId.toggles:
      // `when` mirrors web's Timeline. `toggles` always renders — two of its four switches have no
      // facet at all, so the section as a whole is never useless; per-switch gating is Task 3's.
      return false;
  }
}

Set<FilterSectionId> availableSections(
  FilterSuggestionsResponseDto facets,
  FilterSuggestionsResponseDto? baseline,
  SearchFilter filter,
) {
  bool offered(FilterSectionId id) {
    // Never strand a filter the user cannot then reach to clear.
    if (hasActiveFilterFor(id, filter)) {
      return true;
    }
    if (!_facetEmpty(id, facets)) {
      return true;
    }
    // A section is never hidden on missing information.
    if (baseline == null) {
      return true;
    }
    // Empty under the current filters but not for the whole scope: transient, so keep it.
    return !_facetEmpty(id, baseline);
  }

  return {
    for (final id in FilterSectionId.values)
      if (offered(id)) id,
  };
}

/// Whether a single facet-gated control (e.g. a toggle switch, as opposed to a whole
/// [FilterSectionId] section) should render. Same rule as [availableSections]'s `offered`,
/// generalised down to one boolean facet: never hide a control that clears a filter the user
/// already has on, and otherwise hide it only when the facet is empty under BOTH the current
/// filters and the whole-scope baseline. Missing information (loading/error, i.e. `null`) fails
/// open on both sides, matching `availableSections`'s `baseline == null` early return.
bool toggleAvailable({required bool activeFilter, required bool? currentFacet, required bool? baselineFacet}) {
  if (activeFilter) {
    return true;
  }
  if (currentFacet ?? true) {
    return true;
  }
  return baselineFacet ?? true;
}

/// Whether [filter] is empty with respect to the fields the facets request actually forwards.
///
/// This is deliberately narrower than [SearchFilter.isEmpty]: that getter also counts fields the
/// facets call in filter_suggestions.provider.dart never sends — `context` (the sheet's search-bar
/// text) foremost, plus `filename`/`description`/`ocr`/`language`/`assetId`/`location.state`/
/// `display.isArchive`/`display.isUntagged`. Using [SearchFilter.isEmpty] for the baseline-key
/// decision below meant setting only one of those unforwarded fields (typically the search bar)
/// made the baseline key diverge from the main key even though the outgoing HTTP request for both
/// was byte-identical — firing a second request that told the server nothing new.
///
/// Keep the field list here in lockstep with the parameters passed to `getFilterSuggestions` in
/// filter_suggestions.provider.dart — that's the contract this predicate exists to mirror.
bool _isEmptyForFacets(SearchFilter filter) {
  return filter.location.city == null &&
      filter.location.country == null &&
      filter.camera.make == null &&
      filter.camera.model == null &&
      filter.mediaType == AssetType.other &&
      filter.people.isEmpty &&
      filter.rating.rating.isNone &&
      (filter.tagIds ?? const []).isEmpty &&
      filter.date.takenAfter == null &&
      filter.date.takenBefore == null &&
      filter.display.isFavorite == false &&
      filter.display.isNotInAlbum == false;
}

/// The scope-wide baseline (no filters applied) facets — "could this ever populate?". Keyed on
/// [photosFilterDebouncedProvider] like every other facets lookup (finding 1), and shared by
/// [sectionAvailabilityProvider] and the toggles' gated switches (finding 2) so both consult the
/// same fetch rather than each computing — and requesting — their own.
final baselineFacetsProvider = Provider.autoDispose<AsyncValue<FilterSuggestionsResponseDto>>((ref) {
  final filter = ref.watch(photosFilterDebouncedProvider);

  // Same family, different key — and the SAME key when nothing FACETS-RELEVANT is filtered, so the
  // common case costs no extra request. SearchFilter has value equality, which is what makes that
  // true; [_isEmptyForFacets] (rather than [SearchFilter.isEmpty]) is what makes it true even when
  // an unforwarded field like the search-bar `context` is set.
  final baselineKey = _isEmptyForFacets(filter) ? filter : SearchFilter.empty();
  return ref.watch(photosFilterSuggestionsProvider(baselineKey));
});

final sectionAvailabilityProvider = Provider.autoDispose<Set<FilterSectionId>>((ref) {
  // Immediate: hasActiveFilterFor must react the instant a filter is set or cleared (see the file
  // doc comment) — never debounced.
  final filter = ref.watch(photosFilterProvider);

  // Debounced: shares its family key with every other deep-sheet facets consumer (finding 1).
  final debouncedFilter = ref.watch(photosFilterDebouncedProvider);
  final facets = ref.watch(photosFilterSuggestionsProvider(debouncedFilter));
  final baseline = ref.watch(baselineFacetsProvider);

  // While a request is in flight or has failed, offer everything. A section is never hidden on
  // missing information — including when Task 1b's throw fires.
  return facets.maybeWhen(
    data: (data) => availableSections(data, baseline.valueOrNull, filter),
    orElse: () => FilterSectionId.values.toSet(),
  );
});
