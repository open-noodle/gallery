import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/toggles_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/photos_filter/collapsed_sections.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../../service.mocks.dart';
import '../../../../widget_tester_extensions.dart';

class _FakePrefs implements FilterSectionPrefs {
  final Set<FilterSectionId> collapsed;
  _FakePrefs(this.collapsed);
  @override
  Set<FilterSectionId> loadCollapsed() => collapsed;
  @override
  Future<void> saveCollapsed(Set<FilterSectionId> ids) async {}
}

List<Override> _prefs() => [filterSectionPrefsProvider.overrideWithValue(_FakePrefs({}))];

void main() {
  group('TogglesSection', () {
    testWidgets('4 switches rendered: favourites / archived / not-in-album / untagged', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: TogglesSection()), overrides: _prefs());
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('toggle-favourites')), findsOneWidget);
      expect(find.byKey(const Key('toggle-archived')), findsOneWidget);
      expect(find.byKey(const Key('toggle-not-in-album')), findsOneWidget);
      expect(find.byKey(const Key('toggle-untagged')), findsOneWidget);
    });

    testWidgets('favourites toggle flips independently', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: TogglesSection()), overrides: _prefs());
      final container = ProviderScope.containerOf(tester.element(find.byType(TogglesSection)));

      await tester.tap(find.byKey(const Key('toggle-favourites')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).display.isFavorite, isTrue);
      expect(container.read(photosFilterProvider).display.isArchive, isFalse);
      expect(container.read(photosFilterProvider).display.isNotInAlbum, isFalse);
    });

    testWidgets('archived toggle flips independently', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: TogglesSection()), overrides: _prefs());
      final container = ProviderScope.containerOf(tester.element(find.byType(TogglesSection)));

      await tester.tap(find.byKey(const Key('toggle-archived')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).display.isArchive, isTrue);
      expect(container.read(photosFilterProvider).display.isFavorite, isFalse);
    });

    testWidgets('not-in-album toggle flips independently', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: TogglesSection()), overrides: _prefs());
      final container = ProviderScope.containerOf(tester.element(find.byType(TogglesSection)));

      await tester.tap(find.byKey(const Key('toggle-not-in-album')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).display.isNotInAlbum, isTrue);
    });

    testWidgets('untagged toggle flips independently', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: TogglesSection()), overrides: _prefs());
      final container = ProviderScope.containerOf(tester.element(find.byType(TogglesSection)));

      await tester.tap(find.byKey(const Key('toggle-untagged')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).display.isUntagged, isTrue);
      expect(container.read(photosFilterProvider).display.isFavorite, isFalse);
      expect(container.read(photosFilterProvider).display.isArchive, isFalse);
      expect(container.read(photosFilterProvider).display.isNotInAlbum, isFalse);
    });

    // The escape hatch that keeps a switch reachable while it holds a filter, even when its facet
    // says the library has nothing left to match — otherwise the user could set the filter but never
    // clear it. Untested before #910's fix-wave (deleting `|| display.isFavorite` kept the suite
    // green).
    testWidgets('keeps the favourites switch when its facet is empty but the filter is already active', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: TogglesSection()),
        overrides: [
          ..._prefs(),
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              FilterSuggestionsResponseDto(
                hasUnnamedPeople: false,
                hasFavorites: false,
                hasAssetsInAlbum: false,
                hasAssetsNotInAlbum: false,
              ),
            ),
          ),
        ],
      );
      final container = ProviderScope.containerOf(tester.element(find.byType(TogglesSection)));
      container.read(photosFilterProvider.notifier).setFavouritesOnly(true);
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('toggle-favourites')), findsOneWidget);
    });

    testWidgets('keeps the not-in-album switch when its facet is empty but the filter is already active', (
      tester,
    ) async {
      await tester.pumpConsumerWidget(
        const Material(child: TogglesSection()),
        overrides: [
          ..._prefs(),
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              FilterSuggestionsResponseDto(
                hasUnnamedPeople: false,
                hasFavorites: false,
                hasAssetsInAlbum: false,
                hasAssetsNotInAlbum: false,
              ),
            ),
          ),
        ],
      );
      final container = ProviderScope.containerOf(tester.element(find.byType(TogglesSection)));
      container.read(photosFilterProvider.notifier).setNotInAlbum(true);
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('toggle-not-in-album')), findsOneWidget);
    });

    testWidgets('initial switch state reflects provider', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: TogglesSection()), overrides: _prefs());
      final container = ProviderScope.containerOf(tester.element(find.byType(TogglesSection)));
      container.read(photosFilterProvider.notifier).setFavouritesOnly(true);
      await tester.pumpAndSettle();

      final favSwitch = tester.widget<SwitchListTile>(find.byKey(const Key('toggle-favourites')));
      expect(favSwitch.value, isTrue);
    });

    testWidgets('each switch tile meets 48pt tap target', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: TogglesSection()), overrides: _prefs());
      await tester.pumpAndSettle();
      expectTapTargetMin(tester, find.byKey(const Key('toggle-favourites')));
      expectTapTargetMin(tester, find.byKey(const Key('toggle-archived')));
      expectTapTargetMin(tester, find.byKey(const Key('toggle-not-in-album')));
      expectTapTargetMin(tester, find.byKey(const Key('toggle-untagged')));
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(const Material(child: TogglesSection()), overrides: _prefs());
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('toggle-favourites')), findsOneWidget);
      expect(find.byKey(const Key('toggle-archived')), findsOneWidget);
      expect(find.byKey(const Key('toggle-not-in-album')), findsOneWidget);
      expect(find.byKey(const Key('toggle-untagged')), findsOneWidget);
    });

    // #910 fix-wave finding 1: this widget's own facets watch must key on the debounced filter too
    // (sectionAvailabilityProvider is only one of the two flagged call sites). A burst of rapid,
    // discrete filter changes settles to exactly one NEW facets request, not one per change.
    testWidgets('coalesces a burst of rapid filter changes into a single new facets request', (tester) async {
      final mockApiService = MockApiService();
      final mockSearchApi = MockSearchApi();
      when(() => mockApiService.searchApi).thenReturn(mockSearchApi);
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
      ).thenAnswer(
        (_) async => FilterSuggestionsResponseDto(
          hasUnnamedPeople: false,
          hasFavorites: true,
          hasAssetsInAlbum: true,
          hasAssetsNotInAlbum: true,
        ),
      );

      await tester.pumpConsumerWidget(
        const Material(child: TogglesSection()),
        overrides: [..._prefs(), apiServiceProvider.overrideWithValue(mockApiService)],
      );
      final container = ProviderScope.containerOf(tester.element(find.byType(TogglesSection)));
      // The initial (empty-filter) mount request is not what this test is about; only the burst is.
      clearInteractions(mockSearchApi);

      // Three discrete taps in quick succession — each well inside the 250 ms debounce window
      // measured from the previous one.
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.togglePerson(const PersonDto(id: 'p1', name: 'A', isHidden: false, thumbnailPath: ''));
      await tester.pump(const Duration(milliseconds: 50));
      notifier.togglePerson(const PersonDto(id: 'p2', name: 'B', isHidden: false, thumbnailPath: ''));
      await tester.pump(const Duration(milliseconds: 50));
      notifier.togglePerson(const PersonDto(id: 'p3', name: 'C', isHidden: false, thumbnailPath: ''));

      // Still within the window measured from the last change: no new request yet.
      await tester.pump(const Duration(milliseconds: 100));
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
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pumpAndSettle();

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
}
