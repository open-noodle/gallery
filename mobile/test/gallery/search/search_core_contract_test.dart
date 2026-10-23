import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search.repository.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_state.notifier.dart';
import 'package:openapi/api.dart';

import 'search_contract_server.dart';
import 'search_test_utils.dart';

// Slice 2 end-to-end: the real search providers and the real generated OpenAPI client against the strict contract
// server, which answers only what the real server was recorded answering (e2e/src/specs/server/api/
// gallery-search-contract.e2e-spec.ts records every fixture used here). For every scope: open search (availability,
// then each list), apply two filters, load the results; the options, totals and results must equal the fixtures, and
// any request no fixture matches (a stray `withSharedSpaces` on an album, say) fails the test.

final ids = contractIds();
String idOf(String label) => ids[label] ?? (throw StateError('no fixture names $label'));

const dimensionFiles = [
  'availability',
  'total',
  'time',
  'people',
  'tags',
  'places',
  'cameras',
  'ratings',
  'mediaTypes',
];

class ScopeFlow {
  final String name;
  final SearchScope Function() scope;

  /// The fixture set of the unfiltered options (`<prefix>-<dimension>`).
  final String unfilteredPrefix;

  /// Set before search opens (query mode by reference photo).
  final void Function(SearchStateNotifier state)? before;

  /// The two filters, picked the way a user would: people and tags from the options just loaded.
  final void Function(SearchStateNotifier state, SearchOptions options) filter;
  final bool queryMode;

  ScopeFlow(
    this.name,
    this.scope, {
    String? unfilteredPrefix,
    this.before,
    required this.filter,
    this.queryMode = false,
  }) : unfilteredPrefix = unfilteredPrefix ?? 'scope-$name';
}

SearchPersonRef personNamed(SearchOptions options, String name) {
  final person = options.people!.firstWhere((p) => p.name == name);
  return SearchPersonRef(
    filterId: person.filterId,
    name: person.name,
    profileId: person.profileId,
    profileType: person.profileType,
    profileSpaceId: person.profileSpaceId,
  );
}

SearchTagRef tagNamed(SearchOptions options, String value) {
  final tag = options.tags!.firstWhere((t) => t.value == value);
  return SearchTagRef(id: tag.id, value: tag.value);
}

final flows = [
  ScopeFlow(
    'photos',
    () => const PhotosSearchScope(),
    unfilteredPrefix: 'dimension-photos',
    filter: (s, _) => s
      ..setPlace(const SearchPlace(country: 'Japan', city: 'Kyoto'))
      ..setMinRating(3),
  ),
  ScopeFlow(
    'album',
    () => AlbumSearchScope(idOf('album:trip')),
    filter: (s, _) => s
      ..setMediaType(SearchMediaType.image)
      ..setPlace(const SearchPlace(country: 'Japan')),
  ),
  ScopeFlow(
    'space-album',
    () => SpaceAlbumSearchScope(idOf('album:space-trip')),
    filter: (s, _) => s
      ..setPlace(const SearchPlace(country: 'Spain', city: 'Madrid'))
      ..setMediaType(SearchMediaType.image),
  ),
  ScopeFlow(
    'space',
    () => SpaceSearchScope(idOf('space:family')),
    filter: (s, options) => s
      ..togglePerson(personNamed(options, 'Pia'))
      ..setPlace(const SearchPlace(country: 'Japan', city: 'Kyoto')),
  ),
  ScopeFlow(
    'personal-person',
    () => PersonalPersonSearchScope(idOf('person:anna')),
    filter: (s, options) => s
      ..togglePerson(personNamed(options, 'Ben'))
      ..setPlace(const SearchPlace(country: 'Japan')),
  ),
  ScopeFlow(
    'space-person',
    () => SpacePersonSearchScope(spaceId: idOf('space:family'), spacePersonId: idOf('space-person:pia')),
    filter: (s, _) => s
      ..setCamera(const SearchCamera(make: 'Sony', model: 'A7 IV'))
      ..setMediaType(SearchMediaType.image),
  ),
  ScopeFlow(
    'place',
    () => const PlaceSearchScope('Lisbon'),
    filter: (s, options) => s
      ..togglePerson(personNamed(options, 'Anna'))
      ..setCamera(const SearchCamera(make: 'Apple')),
  ),
  ScopeFlow(
    'favorites',
    () => const FavoritesSearchScope(),
    filter: (s, options) => s
      ..togglePerson(personNamed(options, 'Anna'))
      ..setPlace(const SearchPlace(country: 'Portugal')),
  ),
  ScopeFlow(
    'archive',
    () => ArchiveSearchScope(idOf('user:me')),
    filter: (s, _) => s
      ..setPlace(const SearchPlace(country: 'Japan', city: 'Osaka'))
      ..setMediaType(SearchMediaType.image),
  ),
  ScopeFlow(
    'videos',
    () => const VideosSearchScope(),
    filter: (s, _) => s
      ..setPlace(const SearchPlace(country: 'Germany'))
      ..setDate(const SearchDate.year(2024)),
  ),
  ScopeFlow(
    'recently-added',
    () => RecentlyAddedSearchScope(idOf('user:me')),
    filter: (s, options) => s
      ..toggleTag(tagNamed(options, 'beach'))
      ..setMinRating(5),
  ),
  ScopeFlow(
    'recently-taken',
    () => RecentlyTakenSearchScope(idOf('user:me')),
    filter: (s, _) => s.setText(const SearchText(ocr: 'menu', fileName: 'menu')),
  ),
  ScopeFlow(
    'similar',
    () => const PhotosSearchScope(),
    before: (s) => s.setReferencePhoto(idOf('asset:kyoto-1')),
    filter: (s, _) => s
      ..setPlace(const SearchPlace(country: 'Japan', city: 'Kyoto'))
      ..setCamera(const SearchCamera(make: 'Fujifilm')),
    queryMode: true,
  ),
];

ProviderContainer containerFor(SearchContractServer server, SearchScope scope) {
  final client = ApiClient(basePath: server.endpoint);
  final root = ProviderContainer(
    overrides: [
      gallerySearchRepositoryProvider.overrideWithValue(
        GallerySearchRepository(
          searchApi: SearchApi(client),
          timelineApi: TimelineApi(client),
          serverApi: ServerApi(client),
        ),
      ),
      searchOptionsDebounceProvider.overrideWithValue(Duration.zero),
      searchResultsDebounceProvider.overrideWithValue(Duration.zero),
      searchClockProvider.overrideWithValue(() => DateTime(2026, 10, 23)),
    ],
  );
  addTearDown(root.dispose);
  final route = ProviderContainer(parent: root, overrides: searchRouteOverrides(scope));
  addTearDown(route.dispose);
  return route;
}

Map<String, dynamic> body(String fixture) => contractResponseBody(fixture)! as Map<String, dynamic>;

/// The loaded options equal the recorded per-dimension responses of [prefix].
void expectOptionsEqualFixtures(SearchOptions options, String prefix) {
  final availability = body('$prefix-availability')['availability'] as Map<String, dynamic>;
  final a = options.availability!;
  expect(
    {
      'hasAssets': a.hasAssets,
      'hasAssetsInAlbum': a.hasAssetsInAlbum,
      'hasAssetsNotInAlbum': a.hasAssetsNotInAlbum,
      'hasCameras': a.hasCameras,
      'hasFavorites': a.hasFavorites,
      'hasImages': a.hasImages,
      'hasPeople': a.hasPeople,
      'hasPlaces': a.hasPlaces,
      'hasRatings': a.hasRatings,
      'hasTags': a.hasTags,
      'hasVideos': a.hasVideos,
    },
    availability,
    reason: '$prefix availability',
  );
  expect(options.total, body('$prefix-total')['total'], reason: '$prefix total');
  expect(options.people!.map((p) => [p.filterId, p.name, p.count, p.isSelected]).toList(), [
    for (final p in body('$prefix-people')['people'] as List) [p['filterId'], p['name'], p['count'], p['isSelected']],
  ], reason: '$prefix people');
  expect(options.tags!.map((t) => [t.id, t.value, t.count]).toList(), [
    for (final t in body('$prefix-tags')['tags'] as List) [t['id'], t['value'], t['count']],
  ], reason: '$prefix tags');
  expect(
    options.countries!
        .map(
          (c) => [
            c.country,
            c.count,
            c.cities!.map((x) => [x.city, x.count]).toList(),
          ],
        )
        .toList(),
    [
      for (final c in body('$prefix-places')['countries'] as List)
        [
          c['country'],
          c['count'],
          [
            for (final x in c['cities'] as List) [x['city'], x['count']],
          ],
        ],
    ],
    reason: '$prefix places',
  );
  expect(
    options.cameras!
        .map(
          (m) => [
            m.make,
            m.count,
            m.models!.map((x) => [x.model, x.count]).toList(),
          ],
        )
        .toList(),
    [
      for (final m in body('$prefix-cameras')['cameraMakes'] as List)
        [
          m['make'],
          m['count'],
          [
            for (final x in m['models'] as List) [x['model'], x['count']],
          ],
        ],
    ],
    reason: '$prefix cameras',
  );
  expect(options.ratings!.map((r) => [r.rating, r.count]).toList(), [
    for (final r in body('$prefix-ratings')['ratings'] as List) [r['rating'], r['count']],
  ], reason: '$prefix ratings');
  expect(options.mediaTypes!.map((m) => [m.type, m.count]).toList(), [
    for (final m in body('$prefix-mediaTypes')['mediaTypes'] as List) [m['type'], m['count']],
  ], reason: '$prefix mediaTypes');
  expect(options.months!.map((m) => [m.year, m.month, m.count]).toList(), [
    for (final b in body('$prefix-time')['timeBuckets'] as List)
      [DateTime.parse(b['timeBucket'] as String).year, DateTime.parse(b['timeBucket'] as String).month, b['count']],
  ], reason: '$prefix months');
  expect(options.stale, isFalse);
  expect(options.error, isNull);
}

void main() {
  for (final flow in flows) {
    test('${flow.name}: options, two filters, results', () async {
      final server = await SearchContractServer.start(
        include: (name) => !name.startsWith('older-') && !name.startsWith('stock-'),
      );
      addTearDown(server.close);
      final container = containerFor(server, flow.scope());
      final state = container.read(searchStateProvider.notifier);
      flow.before?.call(state);

      // Search opens: capabilities (2), availability, then the eight lists.
      container.listen(searchOptionsProvider, (_, _) {});
      await server.waitForServed(2 + 9);
      expect(server.served.take(3), ['server-version', 'server-features', '${flow.unfilteredPrefix}-availability']);
      expectOptionsEqualFixtures(container.read(searchOptionsProvider), flow.unfilteredPrefix);

      // Two filters, applied together: one options round for the final state.
      flow.filter(state, container.read(searchOptionsProvider));
      await server.waitForServed(2 + 9 + 9);
      expect(server.served[11], 'scope-${flow.name}-filtered-availability');
      expectOptionsEqualFixtures(container.read(searchOptionsProvider), 'scope-${flow.name}-filtered');

      // Results of the filtered state.
      container.listen(searchResultsProvider, (_, _) {});
      await server.waitForServed(2 + 9 + 9 + 1);
      final results = container.read(searchResultsProvider);
      final filteredTotal = body('scope-${flow.name}-filtered-total')['total'];
      if (flow.queryMode) {
        expect(server.served.last, 'scope-${flow.name}-filtered-smart');
        final smart = body('scope-${flow.name}-filtered-smart');
        expect(results.source, SearchResultsSource.smart);
        expect(results.assets!.map((a) => a.id).toList(), [
          for (final item in (smart['assets'] as Map<String, dynamic>)['items'] as List) item['id'],
        ]);
        expect(container.read(searchTotalProvider), filteredTotal);
      } else {
        expect(server.served.last, 'scope-${flow.name}-filtered-timeline-buckets');
        final buckets = contractResponseBody('scope-${flow.name}-filtered-timeline-buckets')! as List;
        expect(results.source, SearchResultsSource.timeline);
        expect(results.buckets!.map((b) => [b.timeBucket, b.count]).toList(), [
          for (final b in buckets) [b['timeBucket'], b['count']],
        ]);
        expect(results.total, buckets.fold<int>(0, (sum, b) => sum + (b['count'] as int)));
        expect(results.total, filteredTotal, reason: 'results and options agree');

        final bucket = await container
            .read(searchResultsProvider.notifier)
            .loadBucket(results.buckets!.first.timeBucket);
        expect(server.served.last, 'scope-${flow.name}-filtered-timeline-bucket');
        expect(bucket!.id, body('scope-${flow.name}-filtered-timeline-bucket')['id']);
        expect(bucket.id.length, results.buckets!.first.count);
      }

      expect(server.unmatched, isEmpty);
    });
  }

  test('older Gallery server: suggestion lists without counts, cities per country, results unchanged', () async {
    final server = await SearchContractServer.start(
      // older-favorites-* is a newer server than older-* (it has searchOptions): its features would answer first.
      include: (name) =>
          (name.startsWith('older-') && !name.startsWith('older-favorites-')) ||
          name.startsWith('scope-photos-filtered-timeline'),
    );
    addTearDown(server.close);
    final container = containerFor(server, const PhotosSearchScope());

    container.listen(searchOptionsProvider, (_, _) {});
    // version, features, the filter suggestions, then five countries' cities.
    await server.waitForServed(2 + 1 + 5);
    var options = container.read(searchOptionsProvider);
    expect(options.hasCounts, isFalse);
    expect(options.error, isNull);
    final suggestions = body('older-filters-photos');
    expect(options.countries!.map((c) => c.country).toList(), suggestions['countries']);
    expect(options.countries!.every((c) => c.count == null && c.cities != null), isTrue);
    expect(
      options.countries!.firstWhere((c) => c.country == 'Japan').cities!.map((c) => c.city).toList(),
      contractResponseBody('older-cities-photos-japan'),
    );
    expect(options.people!.map((p) => p.filterId).toList(), [
      for (final p in suggestions['people'] as List) 'person:${(p['primaryProfile'] as Map)['id']}',
    ]);
    expect(options.people!.every((p) => p.count == null), isTrue);

    container.read(searchStateProvider.notifier)
      ..setPlace(const SearchPlace(country: 'Japan', city: 'Kyoto'))
      ..setMinRating(3);
    await server.waitForServed(8 + 1 + 3);
    options = container.read(searchOptionsProvider);
    expect(options.countries!.map((c) => c.country).toList(), body('older-filters-photos-kyoto')['countries']);
    expect(options.countries!.firstWhere((c) => c.country == 'Japan').cities!.map((c) => c.city), ['Kyoto']);

    container.listen(searchResultsProvider, (_, _) {});
    await server.waitForServed(12 + 1);
    expect(container.read(searchResultsProvider).total, body('scope-photos-filtered-total')['total']);
    expect(server.requests.where((r) => r.endsWith('/search/options')), isEmpty);
    expect(server.unmatched, isEmpty);
  });

  test('stock Immich server: no facet options, results through metadata search, no fork endpoint', () async {
    final server = await SearchContractServer.start(include: (name) => name.startsWith('stock-'));
    addTearDown(server.close);
    final container = containerFor(server, const PhotosSearchScope());

    container.listen(searchOptionsProvider, (_, _) {});
    await server.waitForServed(2);
    expect(container.read(searchOptionsProvider).facetsSupported, isFalse);

    container.read(searchStateProvider.notifier)
      ..setMediaType(SearchMediaType.image)
      ..setFavoritesOnly(true);
    container.listen(searchResultsProvider, (_, _) {});
    await server.waitForServed(4);

    final results = container.read(searchResultsProvider);
    expect(results.source, SearchResultsSource.metadata);
    expect(results.total, body('stock-search-statistics-photos')['total']);
    expect(results.assets!.map((a) => a.id).toList(), [
      for (final item in (body('stock-search-metadata-photos')['assets'] as Map<String, dynamic>)['items'] as List)
        item['id'],
    ]);
    expect(server.requests.toSet(), {
      'GET /api/server/version',
      'GET /api/server/features',
      'POST /api/search/metadata',
      'POST /api/search/statistics',
    });
    expect(server.unmatched, isEmpty);
  });
}
