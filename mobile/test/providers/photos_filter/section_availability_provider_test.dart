import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/photos_filter/filter_person.model.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/section_availability.provider.dart';
import 'package:immich_mobile/utils/option.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' hide SearchFilter;

import '../../service.mocks.dart';

FilterSuggestionsResponseDto emptySuggestions() => FilterSuggestionsResponseDto(
  hasUnnamedPeople: false,
  hasFavorites: false,
  hasAssetsInAlbum: false,
  hasAssetsNotInAlbum: false,
);

FilterSuggestionsResponseDto withRatings(List<int> ratings) => FilterSuggestionsResponseDto(
  hasUnnamedPeople: false,
  hasFavorites: false,
  hasAssetsInAlbum: false,
  hasAssetsNotInAlbum: false,
  ratings: ratings,
);

FilterSuggestionsResponseDto withMediaTypes(List<String> mediaTypes) => FilterSuggestionsResponseDto(
  hasUnnamedPeople: false,
  hasFavorites: false,
  hasAssetsInAlbum: false,
  hasAssetsNotInAlbum: false,
  mediaTypes: mediaTypes,
);

const aPerson = FilterPerson(id: 'p1', name: 'Alice');

void main() {
  group('sectionAvailability (#910)', () {
    test('hides a section whose facet is empty in both current and baseline', () {
      final available = availableSections(emptySuggestions(), emptySuggestions(), SearchFilter.empty());

      expect(available.contains(FilterSectionId.rating), isFalse);
      expect(available.contains(FilterSectionId.when), isTrue);
    });

    test('keeps a section available when its facet is populated', () {
      final full = withRatings([5]);
      expect(availableSections(full, full, SearchFilter.empty()).contains(FilterSectionId.rating), isTrue);
    });

    // The parity guard, and the reason mobile has a baseline at all. `rating` holds no filter, so
    // the active-filter rule cannot save it; only the baseline can. Without the baseline watch this
    // test fails and the Rating section vanishes mid-session on web-divergent behaviour (spec §7).
    test('keeps a section whose facet a CROSS-SECTION filter emptied', () {
      final personFilter = SearchFilter.empty().copyWith(people: {aPerson});

      final available = availableSections(emptySuggestions(), withRatings([5]), personFilter);

      expect(available.contains(FilterSectionId.rating), isTrue);
    });

    test('never hides anything while the baseline is unknown', () {
      final available = availableSections(emptySuggestions(), null, SearchFilter.empty());

      expect(available, containsAll(FilterSectionId.values));
    });

    test('keeps people available while unnamed faces exist', () {
      final unnamed = FilterSuggestionsResponseDto(
        hasUnnamedPeople: true,
        hasFavorites: false,
        hasAssetsInAlbum: false,
        hasAssetsNotInAlbum: false,
      );

      expect(availableSections(unnamed, unnamed, SearchFilter.empty()).contains(FilterSectionId.people), isTrue);
    });

    test('needs BOTH photos and videos to keep media available', () {
      bool mediaFor(List<String> types) {
        final f = withMediaTypes(types);
        return availableSections(f, f, SearchFilter.empty()).contains(FilterSectionId.media);
      }

      expect(mediaFor(['IMAGE']), isFalse);
      expect(mediaFor(['VIDEO']), isFalse);
      // A length>=2 rule would wrongly pass this one — AssetType includes AUDIO and OTHER.
      expect(mediaFor(['IMAGE', 'OTHER']), isFalse);
      expect(mediaFor(['IMAGE', 'VIDEO']), isTrue);
      expect(mediaFor(['IMAGE', 'OTHER', 'VIDEO']), isTrue);
    });

    test('never hides a section that holds an active filter', () {
      // `Option<int?>`: none = no filter, some(null) = unrated, some(1-5) = that rating.
      // See search_filter.model.dart:138-140.
      final filter = SearchFilter.empty().copyWith(rating: const SearchRatingFilter(rating: Option.some(5)));

      expect(
        availableSections(emptySuggestions(), emptySuggestions(), filter).contains(FilterSectionId.rating),
        isTrue,
      );
    });

    test('always keeps when and toggles available', () {
      final available = availableSections(emptySuggestions(), emptySuggestions(), SearchFilter.empty());

      expect(available.contains(FilterSectionId.when), isTrue);
      expect(available.contains(FilterSectionId.toggles), isTrue);
    });
  });

  group('sectionAvailabilityProvider (#910)', () {
    late MockApiService mockApiService;
    late MockSearchApi mockSearchApi;

    setUp(() {
      mockApiService = MockApiService();
      mockSearchApi = MockSearchApi();
      when(() => mockApiService.searchApi).thenReturn(mockSearchApi);
    });

    // Locks the "same key when empty" optimisation: SearchFilter.empty() == an already-empty filter,
    // so Riverpod serves one future, not two.
    test('requests no second facet set when nothing is filtered', () async {
      when(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          isNotInAlbum: any(named: 'isNotInAlbum'),
          make: any(named: 'make'),
          mediaType: any(named: 'mediaType'),
          model: any(named: 'model'),
          personIds: any(named: 'personIds'),
          rating: any(named: 'rating'),
          spaceId: any(named: 'spaceId'),
          tagIds: any(named: 'tagIds'),
          takenAfter: any(named: 'takenAfter'),
          takenBefore: any(named: 'takenBefore'),
          withSharedSpaces: any(named: 'withSharedSpaces'),
        ),
      ).thenAnswer((_) async => emptySuggestions());

      final container = ProviderContainer(overrides: [apiServiceProvider.overrideWithValue(mockApiService)]);
      addTearDown(container.dispose);

      container.read(sectionAvailabilityProvider);

      verify(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          isNotInAlbum: any(named: 'isNotInAlbum'),
          make: any(named: 'make'),
          mediaType: any(named: 'mediaType'),
          model: any(named: 'model'),
          personIds: any(named: 'personIds'),
          rating: any(named: 'rating'),
          spaceId: any(named: 'spaceId'),
          tagIds: any(named: 'tagIds'),
          takenAfter: any(named: 'takenAfter'),
          takenBefore: any(named: 'takenBefore'),
          withSharedSpaces: any(named: 'withSharedSpaces'),
        ),
      ).called(1);
    });

    // #910 fix-wave finding 1: the facets lookup must key on photosFilterDebouncedProvider (250 ms),
    // not the raw filter — otherwise every discrete tap fires its own request on a family key nobody
    // else shares. This is the strong form: a burst of rapid, discrete changes settles to exactly one
    // NEW request, not one per change.
    test('coalesces a burst of rapid filter changes into a single new facets request', () {
      fakeAsync((async) {
        when(
          () => mockSearchApi.getFilterSuggestions(
            city: any(named: 'city'),
            country: any(named: 'country'),
            isFavorite: any(named: 'isFavorite'),
            isNotInAlbum: any(named: 'isNotInAlbum'),
            make: any(named: 'make'),
            mediaType: any(named: 'mediaType'),
            model: any(named: 'model'),
            personIds: any(named: 'personIds'),
            rating: any(named: 'rating'),
            spaceId: any(named: 'spaceId'),
            tagIds: any(named: 'tagIds'),
            takenAfter: any(named: 'takenAfter'),
            takenBefore: any(named: 'takenBefore'),
            withSharedSpaces: any(named: 'withSharedSpaces'),
          ),
        ).thenAnswer((_) async => emptySuggestions());

        final container = ProviderContainer(overrides: [apiServiceProvider.overrideWithValue(mockApiService)]);
        addTearDown(container.dispose);

        // Mount and let the at-rest (empty-filter) request settle before starting the burst.
        container.listen(sectionAvailabilityProvider, (_, _) {});
        async.flushMicrotasks();
        clearInteractions(mockSearchApi);

        // Three discrete taps in quick succession — each well inside the 250 ms debounce window
        // measured from the previous one.
        final notifier = container.read(photosFilterProvider.notifier);
        notifier.togglePerson(const FilterPerson(id: 'p1', name: 'A'));
        async.elapse(const Duration(milliseconds: 50));
        notifier.togglePerson(const FilterPerson(id: 'p2', name: 'B'));
        async.elapse(const Duration(milliseconds: 50));
        notifier.togglePerson(const FilterPerson(id: 'p3', name: 'C'));

        // Still within the window measured from the last change: no new request yet.
        async.elapse(const Duration(milliseconds: 100));
        verifyNever(
          () => mockSearchApi.getFilterSuggestions(
            city: any(named: 'city'),
            country: any(named: 'country'),
            isFavorite: any(named: 'isFavorite'),
            isNotInAlbum: any(named: 'isNotInAlbum'),
            make: any(named: 'make'),
            mediaType: any(named: 'mediaType'),
            model: any(named: 'model'),
            personIds: any(named: 'personIds'),
            rating: any(named: 'rating'),
            spaceId: any(named: 'spaceId'),
            tagIds: any(named: 'tagIds'),
            takenAfter: any(named: 'takenAfter'),
            takenBefore: any(named: 'takenBefore'),
            withSharedSpaces: any(named: 'withSharedSpaces'),
          ),
        );

        // Past the debounce window: the burst settles to exactly ONE new request.
        async.elapse(const Duration(milliseconds: 200));
        async.flushMicrotasks();

        verify(
          () => mockSearchApi.getFilterSuggestions(
            city: any(named: 'city'),
            country: any(named: 'country'),
            isFavorite: any(named: 'isFavorite'),
            isNotInAlbum: any(named: 'isNotInAlbum'),
            make: any(named: 'make'),
            mediaType: any(named: 'mediaType'),
            model: any(named: 'model'),
            personIds: any(named: 'personIds'),
            rating: any(named: 'rating'),
            spaceId: any(named: 'spaceId'),
            tagIds: any(named: 'tagIds'),
            takenAfter: any(named: 'takenAfter'),
            takenBefore: any(named: 'takenBefore'),
            withSharedSpaces: any(named: 'withSharedSpaces'),
          ),
        ).called(1);
      });
    });

    // filter_suggestions.provider.dart never forwards the search-bar `context` field to the server,
    // so a session that opens with only the search text set must not diverge the baseline key from
    // the main key: that would fire a second facets request whose actual HTTP params are
    // byte-identical to the first. Setting the text BEFORE anything reads the derived providers is
    // deliberate: it's the case that matters, because it's the only one where neither key has a
    // chance to reuse an already-resolved "empty" cache entry from an earlier at-rest render — a
    // burst starting from an at-rest mount (like the test above) would prime that cache and mask
    // the bug regardless of which baseline-key predicate is used.
    test(
      'requests one facets set, not two, when the sheet opens with only search text set (#910 fix-wave finding 3)',
      () {
        fakeAsync((async) {
          when(
            () => mockSearchApi.getFilterSuggestions(
              city: any(named: 'city'),
              country: any(named: 'country'),
              isFavorite: any(named: 'isFavorite'),
              isNotInAlbum: any(named: 'isNotInAlbum'),
              make: any(named: 'make'),
              mediaType: any(named: 'mediaType'),
              model: any(named: 'model'),
              personIds: any(named: 'personIds'),
              rating: any(named: 'rating'),
              spaceId: any(named: 'spaceId'),
              tagIds: any(named: 'tagIds'),
              takenAfter: any(named: 'takenAfter'),
              takenBefore: any(named: 'takenBefore'),
              withSharedSpaces: any(named: 'withSharedSpaces'),
            ),
          ).thenAnswer((_) async => emptySuggestions());

          final container = ProviderContainer(overrides: [apiServiceProvider.overrideWithValue(mockApiService)]);
          addTearDown(container.dispose);

          container.read(photosFilterProvider.notifier).setText('sunset');

          container.listen(sectionAvailabilityProvider, (_, _) {});
          async.flushMicrotasks();

          verify(
            () => mockSearchApi.getFilterSuggestions(
              city: any(named: 'city'),
              country: any(named: 'country'),
              isFavorite: any(named: 'isFavorite'),
              isNotInAlbum: any(named: 'isNotInAlbum'),
              make: any(named: 'make'),
              mediaType: any(named: 'mediaType'),
              model: any(named: 'model'),
              personIds: any(named: 'personIds'),
              rating: any(named: 'rating'),
              spaceId: any(named: 'spaceId'),
              tagIds: any(named: 'tagIds'),
              takenAfter: any(named: 'takenAfter'),
              takenBefore: any(named: 'takenBefore'),
              withSharedSpaces: any(named: 'withSharedSpaces'),
            ),
          ).called(1);
        });
      },
    );

    // Task 1b makes a null response throw; the sheet must then show everything rather than
    // interpreting the failure as a genuinely empty library.
    test('offers every section while the facets are in error', () async {
      when(
        () => mockSearchApi.getFilterSuggestions(
          city: any(named: 'city'),
          country: any(named: 'country'),
          isFavorite: any(named: 'isFavorite'),
          isNotInAlbum: any(named: 'isNotInAlbum'),
          make: any(named: 'make'),
          mediaType: any(named: 'mediaType'),
          model: any(named: 'model'),
          personIds: any(named: 'personIds'),
          rating: any(named: 'rating'),
          spaceId: any(named: 'spaceId'),
          tagIds: any(named: 'tagIds'),
          takenAfter: any(named: 'takenAfter'),
          takenBefore: any(named: 'takenBefore'),
          withSharedSpaces: any(named: 'withSharedSpaces'),
        ),
      ).thenAnswer((_) async => null);

      final container = ProviderContainer(overrides: [apiServiceProvider.overrideWithValue(mockApiService)]);
      addTearDown(container.dispose);

      // Let the underlying request settle to AsyncError before reading the derived provider —
      // mirrors cameraPickerMakesProvider's test pattern for synchronous derived providers.
      try {
        await container.read(photosFilterSuggestionsProvider(SearchFilter.empty()).future);
      } catch (_) {
        // expected: Task 1b throws on a null response.
      }

      final available = container.read(sectionAvailabilityProvider);

      expect(available, FilterSectionId.values.toSet());
    });
  });
}
