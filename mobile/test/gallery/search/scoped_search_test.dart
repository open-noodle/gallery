import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search.repository.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/widgets/search_header.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/widgets/common/remote_album_sliver_app_bar.dart';
import 'package:openapi/api.dart' as api;

import 'scoped_pages_harness.dart';
import 'search_mode_harness.dart';

// Slice 6 behaviours (specs/2026-10-23-mobile-search-redesign-design.md, "Slice 6 — Scoped search: albums, spaces,
// people"), on the real album, space, space album and person pages: the grouping pill's search button, each screen's
// placeholder and scope, the person a person page fixes, and sheets that read the screen's own search. Each scope has
// its own fake library, so a request or a sheet that reads the wrong scope shows the wrong photos.

const ids = ScopedPageIds();

FakeAsset _asset(
  String id,
  DateTime taken, {
  List<String> people = const [],
  String? country,
  String? city,
  bool inAlbum = false,
  bool archived = false,
}) => FakeAsset(id, taken, people: people, country: country, city: city, inAlbum: inAlbum, archived: archived);

final _albumLibrary = FakeLibrary(
  people: const [FakePerson('carla', 'Carla'), FakePerson('dan', 'Dan')],
  assets: [
    _asset('trip-1', DateTime(2024, 6, 3), people: const ['carla'], country: 'Japan', city: 'Kyoto', inAlbum: true),
    _asset('trip-2', DateTime(2024, 2, 1), people: const ['dan'], country: 'Germany', city: 'Berlin'),
    _asset('trip-3', DateTime(2023, 5, 1), people: const ['carla', 'dan'], country: 'Japan', city: 'Osaka'),
  ],
);

final _spaceLibrary = FakeLibrary(
  people: const [FakePerson('pia', 'Pia'), FakePerson('quinn', 'Quinn')],
  assets: [
    _asset('space-1', DateTime(2024, 6, 4), people: const ['pia'], country: 'Japan', city: 'Kyoto'),
    _asset('space-2', DateTime(2024, 6, 5), people: const ['pia', 'quinn'], country: 'Japan', city: 'Kyoto'),
    _asset('space-3', DateTime(2023, 8, 1), people: const ['quinn'], country: 'Portugal', city: 'Porto'),
  ],
);

final _spaceAlbumLibrary = FakeLibrary(
  assets: [
    _asset('madrid-1', DateTime(2023, 7, 1), country: 'Spain', city: 'Madrid'),
    _asset('madrid-2', DateTime(2023, 7, 2), country: 'Spain', city: 'Madrid'),
    _asset('madrid-archived', DateTime(2023, 7, 3), country: 'Spain', city: 'Madrid', archived: true),
  ],
);

final _personLibrary = FakeLibrary(
  people: const [FakePerson('anna', 'Anna'), FakePerson('ben', 'Ben')],
  assets: [
    _asset('anna-1', DateTime(2024, 6, 3), people: const ['anna', 'ben'], country: 'Japan', city: 'Kyoto'),
    _asset('anna-2', DateTime(2024, 6, 2), people: const ['anna'], country: 'Japan', city: 'Kyoto'),
    _asset('anna-3', DateTime(2023, 9, 10), people: const ['anna'], country: 'Portugal', city: 'Lisbon'),
  ],
);

/// One fake library per scope, picked from each request's scope parameters as the server would scope it. Outside
/// Photos, people options carry bare ids as the server's do (`personIds` / `spacePersonIds`), space people as
/// `space-person` profiles.
class ScopedFakeRepository implements GallerySearchRepository {
  final photos = FakeSearchRepository(FakeLibrary.standard);
  final album = FakeSearchRepository(_albumLibrary);
  final space = FakeSearchRepository(_spaceLibrary);
  final spaceAlbum = FakeSearchRepository(_spaceAlbumLibrary);
  final person = FakeSearchRepository(_personLibrary);

  /// Every request: `options`, `buckets`, `bucket`, `smart`, with its parameters.
  final requests = <(String, SearchParams)>[];

  FakeSearchRepository _for(SearchParams p) {
    if (p.albumId == ids.albumId) {
      return album;
    }
    if (p.albumId == ids.spaceAlbumId) {
      return spaceAlbum;
    }
    if (p.spaceId == ids.spaceId) {
      return space;
    }
    if (p.withSharedSpaces == true) {
      return photos;
    }
    return person;
  }

  /// The fake matches people on `personIds`; a space scope's are its space people.
  static SearchParams _people(SearchParams p) => p.spacePersonIds == null ? p : p.copyWith(personIds: p.spacePersonIds);

  bool _bare(FakeSearchRepository repository) => !identical(repository, photos);

  @override
  Future<SearchServerCapabilities> capabilities() => photos.capabilities();

  @override
  Future<SearchOptionsPart> options(SearchParams p, {Set<SearchDimension> dimensions = const {}}) async {
    requests.add(('options', p));
    final repository = _for(p);
    final part = await repository.options(_people(p), dimensions: dimensions);
    if (!_bare(repository) || part.people == null) {
      return part;
    }
    final spaceScope = identical(repository, space);
    return SearchOptionsPart(
      availability: part.availability,
      total: part.total,
      months: part.months,
      hasUnnamedPeople: part.hasUnnamedPeople,
      people: [
        for (final option in part.people!)
          SearchPersonOption(
            filterId: option.profileId!,
            name: option.name,
            count: option.count,
            isSelected: option.isSelected,
            profileId: option.profileId,
            profileType: spaceScope ? 'space-person' : 'user-person',
            profileSpaceId: spaceScope ? ids.spaceId : null,
          ),
      ],
    );
  }

  @override
  Future<List<api.TimeBucketsResponseDto>> timeBuckets(
    SearchParams p, {
    required SearchSort sort,
    bool byUploadDate = false,
  }) {
    requests.add(('buckets', p));
    return _for(p).timeBuckets(_people(p), sort: sort, byUploadDate: byUploadDate);
  }

  @override
  Future<api.TimeBucketAssetResponseDto?> timeBucket(
    SearchParams p,
    String timeBucket, {
    required SearchSort sort,
    bool byUploadDate = false,
  }) {
    requests.add(('bucket', p));
    return _for(p).timeBucket(_people(p), timeBucket, sort: sort, byUploadDate: byUploadDate);
  }

  @override
  Future<api.SearchResponseDto?> smart(SearchParams p, {required int page, required SearchSort sort, int size = 100}) {
    requests.add(('smart', p));
    return _for(p).smart(_people(p), page: page, sort: sort, size: size);
  }

  @override
  Future<api.SearchResponseDto?> metadata(
    SearchParams p, {
    required int page,
    required SearchSort sort,
    int size = 100,
  }) => smart(p, page: page, sort: sort, size: size);

  @override
  Future<int?> statistics(SearchParams p) => _for(p).statistics(_people(p));

  @override
  Future<api.AssetResponseDto?> assetInfo(String id) => photos.assetInfo(id);

  @override
  Future<SearchOptionsPart> fallbackOptions(SearchParams p) => options(p, dimensions: SearchDimension.values.toSet());

  @override
  Future<List<SearchCityOption>> fallbackCities(SearchParams p, String country) async => const [];
}

void main() {
  final database = SearchModeDatabase();

  setUpAll(database.setUpAll);
  tearDownAll(database.tearDownAll);

  late ScopedFakeRepository repository;
  late ProviderContainer container;

  Future<void> pump(WidgetTester tester, ScopedPage page) async {
    await database.setUp();
    repository = ScopedFakeRepository();
    container = scopedPagesContainer(db: database.db, repository: repository);
    await pumpScopedPage(tester, container, scopedPage(page, ids));
  }

  Future<void> tapKey(WidgetTester tester, String key) async {
    await tester.ensureVisible(find.byKey(Key(key)));
    await tester.pump();
    await tester.tap(find.byKey(Key(key)));
    await settleFrames(tester);
  }

  SearchState state(WidgetTester tester) => routeContainer(tester).read(searchStateProvider);
  String totalText(WidgetTester tester) => tester.widget<Text>(find.byKey(const Key('search-mode-total'))).data!;
  List<String> resultIds(WidgetTester tester) {
    final service = ProviderScope.containerOf(tester.element(find.byType(Timeline))).read(timelineServiceProvider);
    return [for (final asset in service.getAssets(0, service.totalAssets)) asset.remoteId!];
  }

  /// Every request search mode sent on this screen, apart from the Photos ones a sheet reading the root would send.
  List<SearchParams> sent([String? kind]) => [
    for (final (call, params) in repository.requests)
      if (kind == null || call == kind) params,
  ];

  tearDown(() => container.dispose());

  group('the grouping pill', () {
    testWidgets('its search button enters search mode on the screen, replacing the app bar with the search header', (
      tester,
    ) async {
      await pump(tester, ScopedPage.album);
      expect(find.byType(RemoteAlbumSliverAppBar), findsOneWidget);
      expect(find.byType(SearchHeader), findsNothing);

      await tapPillSearch(tester);

      expect(routeContainer(tester).read(searchModeProvider), isTrue);
      expect(find.byType(SearchHeader), findsOneWidget);
      expect(find.byType(RemoteAlbumSliverAppBar), findsNothing);
      // Search mode is on: the pill keeps Years/Months and drops the button.
      expect(find.byKey(const Key('timeline-grouping-bottom-pill')), findsOneWidget);
      expect(find.byKey(const Key('timeline-pill-search')), findsNothing);
      // Photos' own search was never touched.
      expect(container.read(searchModeProvider), isFalse);
    });

    for (final page in ScopedPage.values) {
      testWidgets('${page.name} offers it', (tester) async {
        await pump(tester, page);
        expect(find.byKey(const Key('timeline-pill-search')), findsOneWidget);
      });
    }
  });

  group('placeholder', () {
    for (final (page, hint) in [
      (ScopedPage.album, 'Search in Japan 2023'),
      (ScopedPage.space, 'Search in Family'),
      (ScopedPage.spaceAlbum, 'Search in Space trip'),
      (ScopedPage.personalPerson, "Search Anna's photos"),
      (ScopedPage.spacePerson, "Search Pia's photos"),
    ]) {
      testWidgets('${page.name} names the screen', (tester) async {
        await pump(tester, page);
        await tapPillSearch(tester);
        expect(find.text(hint), findsOneWidget);
        expect(find.text('Search, @person, #tag, place'), findsNothing);
      });
    }
  });

  group('album', () {
    testWidgets('requests carry the album scope only, and the Albums section is hidden', (tester) async {
      await pump(tester, ScopedPage.album);
      await tapPillSearch(tester);
      await tapKey(tester, 'search-chip-places');
      await tapKey(tester, 'search-place-city-Kyoto');
      await tapKey(tester, 'search-sheet-show');

      expect(resultIds(tester), ['trip-1']);
      expect(sent(), isNotEmpty);
      for (final p in sent()) {
        expect(
          (p.albumId, p.spaceId, p.withSharedSpaces, p.withPartners, p.visibility),
          (ids.albumId, null, null, null, null),
        );
      }
      expect(sent('buckets').last.city, 'Kyoto');

      await tapKey(tester, 'search-chip-filters');
      expect(find.byKey(const Key('search-filter-section-text')), findsOneWidget);
      expect(find.byKey(const Key('search-filter-section-albums')), findsNothing);
    });

    testWidgets("a chip sheet shows the album's options, not Photos'", (tester) async {
      await pump(tester, ScopedPage.album);
      await tapPillSearch(tester);
      await tapKey(tester, 'search-chip-people');

      expect(find.byKey(const Key('search-sheet-person-carla')), findsOneWidget);
      expect(find.byKey(const Key('search-sheet-person-dan')), findsOneWidget);
      expect(find.byKey(const Key('search-sheet-person-person:anna')), findsNothing);
      expect(repository.photos.calls, isEmpty, reason: 'nothing asked for the Photos scope');

      // Picking in the sheet changes the album's search.
      await tapKey(tester, 'search-sheet-person-dan');
      expect(state(tester).filters.people.map((p) => p.filterId), ['dan']);
      expect(container.read(searchStateProvider).isEmpty, isTrue);
      expect(sent('buckets').last.personIds, ['dan']);
    });

    testWidgets('← restores the album: its app bar, its own timeline and its scroll position', (tester) async {
      await pump(tester, ScopedPage.album);
      final scroll = timelineController(tester)..jumpTo(1200);
      await settleFrames(tester);

      await tapPillSearch(tester);
      await tapKey(tester, 'search-chip-places');
      await tapKey(tester, 'search-place-city-Kyoto');
      await tapKey(tester, 'search-sheet-show');
      expect(resultIds(tester), ['trip-1']);

      await tapKey(tester, 'search-mode-back');

      expect(routeContainer(tester).read(searchModeProvider), isFalse);
      expect(state(tester).isEmpty, isTrue);
      expect(find.byType(SearchHeader), findsNothing);
      expect(find.byType(RemoteAlbumSliverAppBar), findsOneWidget);
      expect(find.byKey(const Key('timeline-pill-search')), findsOneWidget);
      expect(resultIds(tester).first, 'own-0');
      expect(scroll.offset, 1200);
    });
  });

  group('space', () {
    testWidgets("People offers the space's people; picking one sends its bare space-person id", (tester) async {
      await pump(tester, ScopedPage.space);
      await tapPillSearch(tester);
      await tapKey(tester, 'search-chip-people');

      expect(find.byKey(const Key('search-sheet-person-pia')), findsOneWidget);
      expect(find.byKey(const Key('search-sheet-person-quinn')), findsOneWidget);
      await tapKey(tester, 'search-sheet-person-pia');
      await tapKey(tester, 'search-sheet-show');

      expect(resultIds(tester), ['space-2', 'space-1']);
      final last = sent('buckets').last;
      expect((last.spaceId, last.spacePersonIds?.join(','), last.personIds), (ids.spaceId, 'pia', null));
      for (final p in sent()) {
        expect((p.spaceId, p.albumId, p.withSharedSpaces), (ids.spaceId, null, null));
      }
    });

    testWidgets("the space's own header and albums step aside while results show", (tester) async {
      await pump(tester, ScopedPage.space);
      expect(find.byKey(const Key('space-albums-shelf')), findsOneWidget);
      await tapPillSearch(tester);
      expect(find.byKey(const Key('space-albums-shelf')), findsOneWidget, reason: 'no filter yet: the space as is');

      routeContainer(tester).read(searchStateProvider.notifier).setPlace(const SearchPlace(country: 'Japan'));
      await settleFrames(tester);
      expect(find.byKey(const Key('space-albums-shelf')), findsNothing);
    });
  });

  group('space album', () {
    testWidgets('the album only, never the space, and its archived photos stay in', (tester) async {
      await pump(tester, ScopedPage.spaceAlbum);
      await tapPillSearch(tester);
      await tapKey(tester, 'search-chip-places');
      await tapKey(tester, 'search-place-city-Madrid');
      await tapKey(tester, 'search-sheet-show');

      expect(resultIds(tester), ['madrid-archived', 'madrid-2', 'madrid-1']);
      expect(totalText(tester), '3 matches');
      for (final p in sent()) {
        expect((p.albumId, p.spaceId, p.withSharedSpaces, p.visibility), (ids.spaceAlbumId, null, null, null));
      }

      await tapKey(tester, 'search-chip-filters');
      expect(find.byKey(const Key('search-filter-section-albums')), findsNothing);
    });
  });

  group('personal person', () {
    testWidgets('the person is selected and fixed; adding another narrows to photos with both', (tester) async {
      await pump(tester, ScopedPage.personalPerson);
      await tapPillSearch(tester);

      expect(
        find.descendant(of: find.byKey(const Key('search-chip-people')), matching: find.text('Anna')),
        findsOneWidget,
      );
      await tapKey(tester, 'search-chip-people');
      expect(find.byKey(const Key('search-sheet-fixed-anna')), findsOneWidget);
      expect(find.text('Always included'), findsOneWidget);
      expect(find.byKey(const Key('search-sheet-person-anna')), findsNothing, reason: 'not offered a second time');

      // Tapping the fixed person does nothing.
      await tapKey(tester, 'search-sheet-fixed-anna');
      expect(state(tester).isEmpty, isTrue);
      expect(find.byKey(const Key('search-sheet-fixed-anna')), findsOneWidget);

      await tapKey(tester, 'search-sheet-person-ben');
      await tapKey(tester, 'search-sheet-show');

      expect(resultIds(tester), ['anna-1']);
      expect(sent('buckets').last.personIds, ['anna', 'ben']);
      for (final p in sent()) {
        expect((p.personIds?.first, p.withSharedSpaces, p.spaceId, p.spacePersonIds), ('anna', null, null, null));
      }
      expect(
        find.descendant(of: find.byKey(const Key('search-chip-people')), matching: find.text('Anna, Ben')),
        findsOneWidget,
      );

      // Clear all clears what was added; the page's person stays.
      routeContainer(tester).read(searchStateProvider.notifier).reset();
      await settleFrames(tester);
      expect(sent('options').last.personIds, ['anna']);
    });

    testWidgets("picking the page's person from the field adds nothing", (tester) async {
      await pump(tester, ScopedPage.personalPerson);
      await tapPillSearch(tester);
      await tester.tap(find.byKey(const Key('search-mode-field')));
      await tester.pump();
      await tester.enterText(find.byKey(const Key('search-mode-field')), '@an');
      await settleFrames(tester);
      await tapKey(tester, 'search-suggestion-person-anna');

      expect(state(tester).filters.people, isEmpty);
    });
  });

  group('space person', () {
    testWidgets('requests carry the space and that space person', (tester) async {
      await pump(tester, ScopedPage.spacePerson);
      await tapPillSearch(tester);
      await tapKey(tester, 'search-chip-people');
      expect(find.byKey(const Key('search-sheet-fixed-pia')), findsOneWidget);
      await tapKey(tester, 'search-sheet-show');

      await tapKey(tester, 'search-chip-places');
      await tapKey(tester, 'search-place-city-Kyoto');
      await tapKey(tester, 'search-sheet-show');

      expect(resultIds(tester), ['space-2', 'space-1']);
      for (final p in sent()) {
        expect(
          (p.spaceId, p.spacePersonIds?.join(','), p.personIds, p.withSharedSpaces),
          (ids.spaceId, 'pia', null, null),
        );
      }
    });
  });
}
