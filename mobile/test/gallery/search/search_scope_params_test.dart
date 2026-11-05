import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/library_view.model.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';

import 'search_test_utils.dart';

// Slice 2 "Scope parameters": each scope sends exactly its parameters and nothing else, through the real generated
// client. One case per row of the scope table; each asserts the whole options body, /timeline/buckets query and
// /search/smart body, so a stray `withSharedSpaces`, `spaceId` or `visibility` fails.

const me = '11111111-1111-4111-8111-111111111111';
const album = '22222222-2222-4222-8222-222222222222';
const space = '33333333-3333-4333-8333-333333333333';
const person = '44444444-4444-4444-8444-444444444444';
const spacePerson = '55555555-5555-4555-8555-555555555555';

class ScopeCase {
  final String name;
  final SearchScope scope;
  final Map<String, Object?> optionsBrowse;
  final Map<String, List<String>> timeline;
  final Map<String, Object?> smart;

  /// The server declares `searchFavoritesAcrossSpaces`.
  final bool favoritesAcrossSpaces;

  const ScopeCase(
    this.name,
    this.scope, {
    required this.optionsBrowse,
    required this.timeline,
    required this.smart,
    this.favoritesAcrossSpaces = false,
  });
}

const photosBrowse = {'visibility': 'timeline', 'withSharedSpaces': true, 'withPartners': true};
const photosTimeline = {
  'visibility': ['timeline'],
  'withSharedSpaces': ['true'],
  'withPartners': ['true'],
};
const photosQuery = {'visibility': 'timeline', 'withSharedSpaces': true};

final cases = [
  const ScopeCase(
    'Photos',
    PhotosSearchScope(),
    optionsBrowse: photosBrowse,
    timeline: photosTimeline,
    smart: photosQuery,
  ),
  // #1038: browsing narrows to the library view; a text or similar-photo search spans every photo.
  for (final view in [LibraryViewMode.personal, LibraryViewMode.spaces])
    ScopeCase(
      'Photos under the ${view.name} library view',
      PhotosSearchScope(libraryView: view),
      optionsBrowse: {...photosBrowse, 'libraryView': view.name},
      timeline: {
        ...photosTimeline,
        'libraryView': [view.name],
      },
      smart: photosQuery,
    ),
  const ScopeCase(
    'album: albumIds to search, albumId to the timeline; no withSharedSpaces, no spaceId',
    AlbumSearchScope(album),
    optionsBrowse: {
      'albumIds': [album],
    },
    timeline: {
      'albumId': [album],
    },
    smart: {
      'albumIds': [album],
    },
  ),
  const ScopeCase(
    'space album: the album only, never spaceId; visibility unset',
    SpaceAlbumSearchScope(album),
    optionsBrowse: {
      'albumIds': [album],
    },
    timeline: {
      'albumId': [album],
    },
    smart: {
      'albumIds': [album],
    },
  ),
  const ScopeCase(
    'space',
    SpaceSearchScope(space),
    optionsBrowse: {'spaceId': space},
    timeline: {
      'spaceId': [space],
    },
    smart: {'spaceId': space},
  ),
  const ScopeCase(
    'personal person: a bare personIds, no withSharedSpaces',
    PersonalPersonSearchScope(person),
    optionsBrowse: {
      'personIds': [person],
    },
    timeline: {
      'personIds': [person],
    },
    smart: {
      'personIds': [person],
    },
  ),
  const ScopeCase(
    'space person: spaceId + spacePersonIds',
    SpacePersonSearchScope(spaceId: space, spacePersonId: spacePerson),
    optionsBrowse: {
      'spaceId': space,
      'spacePersonIds': [spacePerson],
    },
    timeline: {
      'spaceId': [space],
      'spacePersonIds': [spacePerson],
    },
    smart: {
      'spaceId': space,
      'spacePersonIds': [spacePerson],
    },
  ),
  const ScopeCase(
    'place: the city within Photos',
    PlaceSearchScope('Kyoto'),
    optionsBrowse: {...photosBrowse, 'city': 'Kyoto'},
    timeline: {
      ...photosTimeline,
      'city': ['Kyoto'],
    },
    smart: {...photosQuery, 'city': 'Kyoto'},
  ),
  const ScopeCase(
    'favorites: my favourites with partners and every member space, visibility unset (timeline + my archive)',
    FavoritesSearchScope(),
    favoritesAcrossSpaces: true,
    optionsBrowse: {'isFavorite': true, 'withSharedSpaces': true, 'withPartners': true},
    timeline: {
      'isFavorite': ['true'],
      'withSharedSpaces': ['true'],
      'withPartners': ['true'],
    },
    smart: {'isFavorite': true, 'withSharedSpaces': true},
  ),
  const ScopeCase(
    'favorites on a server without searchFavoritesAcrossSpaces: my own favourites, visibility unset',
    FavoritesSearchScope(),
    optionsBrowse: {'isFavorite': true},
    timeline: {
      'isFavorite': ['true'],
    },
    smart: {'isFavorite': true},
  ),
  const ScopeCase(
    'archive: visibility archive, owner me',
    ArchiveSearchScope(me),
    optionsBrowse: {'visibility': 'archive', 'ownerId': me},
    timeline: {
      'visibility': ['archive'],
      'ownerId': [me],
    },
    smart: {'visibility': 'archive', 'ownerId': me},
  ),
  const ScopeCase(
    'videos: type VIDEO within Photos',
    VideosSearchScope(),
    optionsBrowse: {...photosBrowse, 'type': 'VIDEO'},
    timeline: {
      ...photosTimeline,
      'type': ['VIDEO'],
    },
    smart: {...photosQuery, 'type': 'VIDEO'},
  ),
  const ScopeCase(
    'recently added: owner me, visibility unset, browse by upload date',
    RecentlyAddedSearchScope(me),
    optionsBrowse: {'ownerId': me},
    timeline: {
      'ownerId': [me],
      'orderBy': ['createdAt'],
    },
    smart: {'ownerId': me},
  ),
  const ScopeCase(
    'recently taken: owner me, timeline visibility',
    RecentlyTakenSearchScope(me),
    optionsBrowse: {'visibility': 'timeline', 'ownerId': me},
    timeline: {
      'visibility': ['timeline'],
      'ownerId': [me],
    },
    smart: {'visibility': 'timeline', 'ownerId': me},
  ),
];

void main() {
  final now = DateTime(2026, 10, 23);

  for (final c in cases) {
    group(c.name, () {
      test('options (browse) send exactly the scope', () async {
        final api = RecordingApi();
        final params = buildSearchParams(
          c.scope,
          const SearchState(),
          now: now,
          localTakenRange: true,
          favoritesAcrossSpaces: c.favoritesAcrossSpaces,
        );
        await api.repository.options(params);
        expect(api.requests.single.path, '/api/search/options');
        expect(api.requests.single.body, {
          ...c.optionsBrowse,
          'dimensions': ['availability'],
        });
      });

      test('/timeline/buckets sends exactly the scope', () async {
        final api = RecordingApi();
        final params = buildSearchParams(
          c.scope,
          const SearchState(),
          now: now,
          localTakenRange: true,
          favoritesAcrossSpaces: c.favoritesAcrossSpaces,
        );
        await api.repository.timeBuckets(
          params,
          sort: SearchSort.newest,
          byUploadDate: c.scope is RecentlyAddedSearchScope,
        );
        expect(api.requests.single.path, '/api/timeline/buckets');
        expect(api.requests.single.query, c.timeline);
      });

      test('query mode: /search/smart and options send exactly the scope plus the query', () async {
        final api = RecordingApi();
        const state = SearchState(query: SearchQuery.text('beach'), sort: SearchSort.relevance);
        final params = buildSearchParams(
          c.scope,
          state,
          now: now,
          localTakenRange: true,
          favoritesAcrossSpaces: c.favoritesAcrossSpaces,
        );
        await api.repository.smart(params, page: 1, sort: state.sort);
        await api.repository.options(params);
        expect(api.requests[0].path, '/api/search/smart');
        expect(api.requests[0].body, {...c.smart, 'query': 'beach', 'page': 1, 'size': 100});
        expect(api.requests[1].body, {
          ...c.smart,
          'query': 'beach',
          'dimensions': ['availability'],
        });
      });
    });
  }

  group('a filter the scope fixes is ignored', () {
    final state = const SearchState().copyWith(
      filters: const SearchFilters(
        place: SearchPlace(country: 'Japan', city: 'Osaka'),
        favoritesOnly: true,
        mediaType: SearchMediaType.image,
        album: SearchAlbumFilter.notInAlbum,
        archivedOnly: true,
      ),
    );

    test('place keeps its city, favorites its isFavorite, videos its type, album drops album filters', () {
      final place = buildSearchParams(const PlaceSearchScope('Kyoto'), state, now: now, localTakenRange: true);
      expect((place.city, place.country), ('Kyoto', null));
      final videos = buildSearchParams(const VideosSearchScope(), state, now: now, localTakenRange: true);
      expect(videos.type, SearchMediaType.video);
      final albumParams = buildSearchParams(const AlbumSearchScope(album), state, now: now, localTakenRange: true);
      expect((albumParams.isNotInAlbum, albumParams.isInAlbum), (null, null));
      final archive = buildSearchParams(const ArchiveSearchScope(me), state, now: now, localTakenRange: true);
      expect((archive.visibility, archive.ownerId), (SearchVisibility.archive, me));
    });
  });

  test(
    'archived only on Photos drops shared spaces, partners and the library view, which only exist on the timeline',
    () async {
      final api = RecordingApi();
      final state = const SearchState().copyWith(filters: const SearchFilters(archivedOnly: true));
      final params = buildSearchParams(
        const PhotosSearchScope(libraryView: LibraryViewMode.spaces),
        state,
        now: now,
        localTakenRange: true,
      );
      await api.repository.options(params);
      expect(api.requests.single.body, {
        'visibility': 'archive',
        'dimensions': ['availability'],
      });
    },
  );

  group('people ids come from filterId / primaryProfile, never the response id', () {
    test('options: filterId, even when the response id differs', () async {
      final api = RecordingApi(
        respond: (_, _) => {
          'people': [
            {
              'id': 'identity-1',
              'filterId': 'person:$person',
              'name': 'Anna',
              'count': 3,
              'isSelected': false,
              'primaryProfile': {'id': person, 'type': 'user-person'},
            },
          ],
        },
      );
      final part = await api.repository.options(const SearchParams(), dimensions: {SearchDimension.people});
      expect(part.people!.single.filterId, 'person:$person');
      expect(part.people!.single.profileType, 'user-person');
    });

    test('older server suggestions: the profile token, never the identity id', () async {
      final api = RecordingApi(
        respond: (method, path) => path == '/api/search/suggestions/filters'
            ? {
                ...defaultResponse(method, path)! as Map<String, Object?>,
                'people': [
                  {
                    'id': 'identity-1',
                    'name': 'Pia',
                    'primaryProfile': {'id': spacePerson, 'type': 'space-person', 'spaceId': space},
                  },
                  {
                    'id': 'identity-2',
                    'name': 'Anna',
                    'primaryProfile': {'id': person, 'type': 'user-person'},
                  },
                ],
              }
            : defaultResponse(method, path),
      );
      final photos = await api.repository.fallbackOptions(const PhotosSearchScope().baseParams(SearchMode.browse));
      expect(photos.people!.map((p) => p.filterId), ['space-person:$spacePerson', 'person:$person']);
      final inSpace = await api.repository.fallbackOptions(const SpaceSearchScope(space).baseParams(SearchMode.browse));
      expect(inSpace.people!.map((p) => p.filterId), [spacePerson, person]);
      expect(api.requests.last.query, {
        'spaceId': [space],
      });
    });
  });

  group('people ids', () {
    const anna = SearchPersonRef(filterId: 'person:$person', name: 'Anna');
    final withAnna = const SearchState().copyWith(filters: const SearchFilters(people: [anna]));

    test('Photos sends the filterId token as personIds', () {
      final params = buildSearchParams(const PhotosSearchScope(), withAnna, now: now, localTakenRange: true);
      expect(params.personIds, ['person:$person']);
      expect(params.spacePersonIds, isNull);
    });

    test('a space sends selected space people as spacePersonIds, after the scope person', () async {
      const pia = SearchPersonRef(filterId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Pia');
      final api = RecordingApi();
      final state = const SearchState().copyWith(filters: const SearchFilters(people: [pia]));
      final params = buildSearchParams(
        const SpacePersonSearchScope(spaceId: space, spacePersonId: spacePerson),
        state,
        now: now,
        localTakenRange: true,
      );
      await api.repository.timeBuckets(params, sort: SearchSort.newest);
      expect(api.requests.single.query, {
        'spaceId': [space],
        'spacePersonIds': [spacePerson, pia.filterId],
      });
    });

    test('a personal person page keeps its person and adds the selected one', () {
      const ben = SearchPersonRef(filterId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Ben');
      final state = const SearchState().copyWith(filters: const SearchFilters(people: [ben]));
      final params = buildSearchParams(const PersonalPersonSearchScope(person), state, now: now, localTakenRange: true);
      expect(params.personIds, [person, ben.filterId]);
      expect(params.withSharedSpaces, isNull);
    });
  });

  group('filters on the wire', () {
    test('untagged is tagIds: null on POST bodies', () async {
      final api = RecordingApi();
      final state = const SearchState().copyWith(filters: const SearchFilters(untagged: true));
      final params = buildSearchParams(const AlbumSearchScope(album), state, now: now, localTakenRange: true);
      await api.repository.options(params);
      expect(api.requests.single.body, {
        'albumIds': [album],
        'tagIds': null,
        'dimensions': ['availability'],
      });
    });

    test('every browse filter reaches /timeline/buckets', () async {
      final api = RecordingApi();
      const state = SearchState(
        sort: SearchSort.oldest,
        filters: SearchFilters(
          tags: [
            SearchTagRef(id: 't1', value: 'beach'),
            SearchTagRef(id: 't2', value: 'food'),
          ],
          place: SearchPlace(country: 'Japan', city: 'Kyoto'),
          camera: SearchCamera(make: 'Fujifilm', model: 'X-T5'),
          minRating: 3,
          mediaType: SearchMediaType.image,
          favoritesOnly: true,
          album: SearchAlbumFilter.inAlbum,
          text: SearchText(ocr: 'menu', fileName: 'IMG', description: 'dinner'),
          date: SearchDate.month(2024, 6),
        ),
      );
      final params = buildSearchParams(const PhotosSearchScope(), state, now: now, localTakenRange: true);
      await api.repository.timeBuckets(params, sort: state.sort);
      expect(api.requests.single.query, {
        ...photosTimeline,
        'tagIds': ['t1', 't2'],
        'country': ['Japan'],
        'city': ['Kyoto'],
        'make': ['Fujifilm'],
        'model': ['X-T5'],
        'rating': ['3'],
        'type': ['IMAGE'],
        'isFavorite': ['true'],
        'isInAlbum': ['true'],
        'ocr': ['menu'],
        'originalFileName': ['IMG'],
        'description': ['dinner'],
        'takenAfter': ['2024-06-01T00:00:00.000Z'],
        'takenBefore': ['2024-07-01T00:00:00.000Z'],
        'order': ['asc'],
      });
    });

    test('query mode drops description and file name, which /search/smart cannot filter', () {
      const state = SearchState(
        query: SearchQuery.text('beach'),
        filters: SearchFilters(
          text: SearchText(ocr: 'menu', fileName: 'IMG', description: 'dinner'),
        ),
      );
      final params = buildSearchParams(const PhotosSearchScope(), state, now: now, localTakenRange: true);
      expect((params.ocr, params.description, params.originalFileName), ('menu', null, null));
    });
  });
}
