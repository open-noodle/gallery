import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';

// What search mode's widgets read beyond the Slice 2 core.

/// The search field's text. It outlives one header instance: the timeline rebuilds its app-bar sliver whenever its
/// data source switches between the screen's own timeline and the results.
final searchFieldControllerProvider = Provider<TextEditingController>((ref) {
  final controller = TextEditingController();
  ref.onDispose(controller.dispose);
  return controller;
}, dependencies: const []);

/// #910 needs two answers per section: is it empty for the whole scope (hide it), or only because of the other active
/// filters (grey it)? The options answer the second. The first is the availability of the unfiltered state, which is
/// what the options hold whenever the state is empty, so the chip row keeps it for the search session
/// ([SearchModeNotifier.scopeAvailability]). Only widgets read the options, so nothing keeps them alive (and asking the
/// server) once search mode closes.
SearchAvailability? searchScopeAvailability(WidgetRef ref, SearchState state, SearchOptions options) {
  final mode = ref.read(searchModeProvider.notifier);
  final availability = options.availability;
  if (availability != null && state.isEmpty) {
    mode.scopeAvailability = availability;
  }
  return mode.scopeAvailability;
}

/// The People sheet's Recent row: the 7 most recently updated people, read from the local database (no request). Only
/// those the narrowed options still offer are shown, so they carry counts and respect the other filters.
final searchRecentPersonIdsProvider = FutureProvider.autoDispose<List<String>>((ref) async {
  final people = await ref.watch(getAllPeopleProvider(PeopleSortBy.name).future);
  final recent = people.where((p) => p.updatedAt != null).toList()
    ..sort((a, b) => b.updatedAt!.compareTo(a.updatedAt!));
  return [for (final person in recent.take(7)) person.id];
});

/// The raw profile id a person option stands for (its thumbnail profile, else its token without the prefix).
String searchPersonProfileId(String filterId, String? profileId) {
  if (profileId != null) {
    return profileId;
  }
  final colon = filterId.indexOf(':');
  return colon < 0 ? filterId : filterId.substring(colon + 1);
}

/// Leaving search mode: every filter and the query clear, the screen's own timeline comes back at the scroll position it
/// had. Once the header is gone the options and results are dropped, so nothing is requested for a screen that is no
/// longer searching (their pending debounced round dies with them).
void leaveSearchMode(BuildContext context, WidgetRef ref, {ScrollController? scrollController}) {
  final container = ProviderScope.containerOf(context, listen: false);
  final mode = ref.read(searchModeProvider.notifier);
  final offset = mode.savedScrollOffset;
  mode.leave();
  ref.read(searchStateProvider.notifier).reset();
  ref.read(searchFieldControllerProvider).clear();
  WidgetsBinding.instance.addPostFrameCallback((_) {
    if (!container.read(searchModeProvider)) {
      container
        ..invalidate(searchOptionsProvider)
        ..invalidate(searchResultsProvider);
    }
  });
  if (scrollController != null && offset != null) {
    restoreScrollOffset(scrollController, offset);
  }
}

/// The filters beyond People, When, Places and Tags, shown as their own chips with ✕ (the Filters sheet sets them).
enum SearchExtraFilter { favorites, mediaType, rating, camera, album, text, dateRange, archived, untagged }

List<SearchExtraFilter> activeExtraFilters(SearchFilters filters, SearchScope scope) {
  final fixed = scope.fixedSections;
  bool open(SearchSection section) => !fixed.contains(section);
  return [
    if (filters.favoritesOnly && open(SearchSection.favorites)) SearchExtraFilter.favorites,
    if (filters.mediaType != SearchMediaType.all && open(SearchSection.mediaType)) SearchExtraFilter.mediaType,
    if (filters.minRating != null) SearchExtraFilter.rating,
    if (filters.camera != null) SearchExtraFilter.camera,
    if (filters.album != SearchAlbumFilter.any && open(SearchSection.albums)) SearchExtraFilter.album,
    if (!filters.text.isEmpty) SearchExtraFilter.text,
    if (filters.date is SearchDateCustom) SearchExtraFilter.dateRange,
    if (filters.archivedOnly && open(SearchSection.archived)) SearchExtraFilter.archived,
    if (filters.untagged && filters.tags.isEmpty) SearchExtraFilter.untagged,
  ];
}

/// Removes one extra filter (its chip's ✕).
void clearExtraFilter(WidgetRef ref, SearchExtraFilter filter) {
  final notifier = ref.read(searchStateProvider.notifier);
  switch (filter) {
    case SearchExtraFilter.favorites:
      notifier.setFavoritesOnly(false);
    case SearchExtraFilter.mediaType:
      notifier.setMediaType(SearchMediaType.all);
    case SearchExtraFilter.rating:
      notifier.setMinRating(null);
    case SearchExtraFilter.camera:
      notifier.setCamera(null);
    case SearchExtraFilter.album:
      notifier.setAlbumFilter(SearchAlbumFilter.any);
    case SearchExtraFilter.text:
      notifier.setText(const SearchText());
    case SearchExtraFilter.dateRange:
      notifier.setDate(null);
    case SearchExtraFilter.archived:
      notifier.setArchivedOnly(false);
    case SearchExtraFilter.untagged:
      notifier.setUntagged(false);
  }
}

/// How many filters are active, the query included: "Clear all" shows from two.
int activeFilterCount(SearchState state, SearchScope scope) {
  final filters = state.filters;
  final fixed = scope.fixedSections;
  return [
        filters.people.isNotEmpty,
        filters.date != null && filters.date is! SearchDateCustom,
        filters.place != null && !fixed.contains(SearchSection.places),
        filters.tags.isNotEmpty,
        state.isQueryMode,
      ].where((active) => active).length +
      activeExtraFilters(filters, scope).length;
}
