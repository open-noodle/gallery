import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/widgets/search_header.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';
import 'package:immich_mobile/widgets/common/mesmerizing_sliver_app_bar.dart';
import 'package:openapi/api.dart' as api;

import 'scoped_pages_harness.dart';
import 'search_mode_harness.dart';

// Slice 7 behaviours (specs/2026-10-23-mobile-search-redesign-design.md, "Slice 7 — Scoped search: place, favorites,
// archive, videos, recently taken, recently added"), on the real pages: each screen's pill entry and placeholder, the
// filter it fixes hidden, and its scope on every request. The fake library holds what each scope must leave out (a
// partner's archived photo, my archived video, a member's photo), so a request with the wrong scope shows it.

const _partner = 'user-partner';
const _member = 'user-member';

final _library = FakeLibrary(
  people: const [FakePerson('anna', 'Anna'), FakePerson('ben', 'Ben')],
  assets: [
    FakeAsset('kyoto-1', DateTime(2024, 6, 3, 10), people: const ['anna'], country: 'Japan', city: 'Kyoto', rating: 4),
    // A favourite of mine in a space: another member's photo.
    FakeAsset('member-fav', DateTime(2024, 6, 4, 10), country: 'Japan', city: 'Kyoto', favorite: true, owner: _member),
    FakeAsset('partner-1', DateTime(2024, 5, 1, 10), country: 'France', city: 'Paris', owner: _partner),
    FakeAsset(
      'partner-archived',
      DateTime(2024, 5, 3, 10),
      country: 'France',
      city: 'Nice',
      archived: true,
      owner: _partner,
    ),
    FakeAsset(
      'lisbon-1',
      DateTime(2023, 9, 10, 10),
      people: const ['anna'],
      country: 'Portugal',
      city: 'Lisbon',
      favorite: true,
    ),
    FakeAsset('lisbon-2', DateTime(2023, 9, 11, 10), people: const ['ben'], country: 'Portugal', city: 'Lisbon'),
    // Taken long ago, uploaded last: first on Recently added, last everywhere else.
    FakeAsset(
      'old-scan',
      DateTime(1999, 5, 1, 10),
      country: 'Portugal',
      city: 'Lisbon',
      uploadedAt: DateTime.utc(2025, 3, 1, 10),
    ),
    FakeAsset('clip-1', DateTime(2024, 2, 14, 10), country: 'Germany', city: 'Berlin', video: true),
    FakeAsset(
      'clip-archived',
      DateTime(2024, 2, 15, 10),
      country: 'Germany',
      city: 'Berlin',
      video: true,
      archived: true,
    ),
    FakeAsset(
      'fav-archived',
      DateTime(2022, 12, 1, 10),
      country: 'Japan',
      city: 'Osaka',
      favorite: true,
      archived: true,
    ),
    FakeAsset('archived-1', DateTime(2022, 12, 2, 10), country: 'Japan', city: 'Osaka', archived: true),
  ],
);

/// The fake library, recording every request with its parameters and whether it ordered by upload date.
class _RecordingRepository extends FakeSearchRepository {
  _RecordingRepository() : super(_library);

  /// `options`, `buckets`, `bucket`, `smart`.
  final requests = <(String, SearchParams)>[];
  final byUploadDate = <bool>[];

  @override
  Future<SearchOptionsPart> options(SearchParams p, {Set<SearchDimension> dimensions = const {}}) {
    requests.add(('options', p));
    return super.options(p, dimensions: dimensions);
  }

  @override
  Future<List<api.TimeBucketsResponseDto>> timeBuckets(
    SearchParams p, {
    required SearchSort sort,
    bool byUploadDate = false,
  }) {
    requests.add(('buckets', p));
    this.byUploadDate.add(byUploadDate);
    return super.timeBuckets(p, sort: sort, byUploadDate: byUploadDate);
  }

  @override
  Future<api.TimeBucketAssetResponseDto?> timeBucket(
    SearchParams p,
    String timeBucket, {
    required SearchSort sort,
    bool byUploadDate = false,
  }) {
    requests.add(('bucket', p));
    this.byUploadDate.add(byUploadDate);
    return super.timeBucket(p, timeBucket, sort: sort, byUploadDate: byUploadDate);
  }

  @override
  Future<api.SearchResponseDto?> smart(SearchParams p, {required int page, required SearchSort sort, int size = 100}) {
    requests.add(('smart', p));
    return super.smart(p, page: page, sort: sort, size: size);
  }
}

void main() {
  final database = SearchModeDatabase();

  setUpAll(database.setUpAll);
  tearDownAll(database.tearDownAll);

  late _RecordingRepository repository;
  late ScopedTimelineFactory timelines;
  late ProviderContainer container;

  Future<void> pump(WidgetTester tester, OtherScreen screen) async {
    await database.setUp();
    repository = _RecordingRepository();
    timelines = ScopedTimelineFactory();
    container = scopedPagesContainer(db: database.db, repository: repository, timelines: timelines);
    await pumpScopedPage(tester, container, otherScreenPage(screen));
  }

  Future<void> tapKey(WidgetTester tester, String key) async {
    await tester.ensureVisible(find.byKey(Key(key)));
    await tester.pump();
    await tester.tap(find.byKey(Key(key)));
    await settleFrames(tester);
  }

  /// One filter through its chip sheet.
  Future<void> pick(WidgetTester tester, String chip, String option) async {
    await tapKey(tester, 'search-chip-$chip');
    await tapKey(tester, option);
    await tapKey(tester, 'search-sheet-show');
  }

  ProviderContainer route(WidgetTester tester) => routeContainer(tester);
  String totalText(WidgetTester tester) => tester.widget<Text>(find.byKey(const Key('search-mode-total'))).data!;
  TimelineService service(WidgetTester tester) =>
      ProviderScope.containerOf(tester.element(find.byType(Timeline))).read(timelineServiceProvider);
  List<String> resultIds(WidgetTester tester) {
    final timeline = service(tester);
    return [for (final asset in timeline.getAssets(0, timeline.totalAssets)) asset.remoteId!];
  }

  List<SearchParams> sent([String? kind]) => [
    for (final (call, params) in repository.requests)
      if (kind == null || call == kind) params,
  ];

  tearDown(() => container.dispose());

  group('the grouping pill and the placeholder', () {
    for (final (screen, hint) in [
      (OtherScreen.place, 'Search in Lisbon'),
      (OtherScreen.favorites, 'Search favorites'),
      (OtherScreen.archive, 'Search archive'),
      (OtherScreen.videos, 'Search videos'),
      (OtherScreen.recentlyTaken, 'Search recently taken'),
      (OtherScreen.recentlyAdded, 'Search recently added'),
    ]) {
      testWidgets('${screen.name}: the pill enters search mode, and the field names the screen', (tester) async {
        await pump(tester, screen);
        expect(find.byKey(const Key('timeline-pill-search')), findsOneWidget);
        await tapPillSearch(tester);

        expect(route(tester).read(searchModeProvider), isTrue);
        expect(find.byType(SearchHeader), findsOneWidget);
        expect(find.byType(MesmerizingSliverAppBar), findsNothing);
        expect(find.text(hint), findsOneWidget);
        expect(find.text('Search, @person, #tag, place'), findsNothing);
        expect(container.read(searchModeProvider), isFalse, reason: "Photos' own search is untouched");
      });
    }
  });

  group('place', () {
    testWidgets('the Places chip is hidden, and results stay in that city', (tester) async {
      await pump(tester, OtherScreen.place);
      await tapPillSearch(tester);
      expect(find.byKey(const Key('search-chip-places')), findsNothing);
      expect(find.byKey(const Key('search-chip-people')), findsOneWidget);

      await pick(tester, 'people', 'search-sheet-person-person:anna');

      // Anna is in Kyoto too; only her Lisbon photo is in this city.
      expect(resultIds(tester), ['lisbon-1']);
      expect(sent(), isNotEmpty);
      for (final p in sent()) {
        expect(
          (p.city, p.country, p.withSharedSpaces, p.visibility),
          ('Lisbon', null, true, SearchVisibility.timeline),
        );
      }
    });
  });

  group('favorites', () {
    testWidgets('the Favorites switch is hidden', (tester) async {
      await pump(tester, OtherScreen.favorites);
      await tapPillSearch(tester);
      await tapKey(tester, 'search-chip-filters');

      expect(find.byKey(const Key('search-filter-section-text')), findsOneWidget);
      expect(find.byKey(const Key('search-filter-section-favorites')), findsNothing);
      expect(find.byKey(const Key('search-filter-favorites')), findsNothing);
    });

    // The scope table's row (`isFavorite`, timeline + archive): no request reaches both archived favourites and a
    // space's, since the server takes `withSharedSpaces` only with timeline visibility. A member's photo I favourited
    // in a space therefore stays out, as the recorded server answers (scope-favorites-*).
    testWidgets('results include archived favourites, and the counts agree', (tester) async {
      await pump(tester, OtherScreen.favorites);
      await tapPillSearch(tester);
      route(tester).read(searchStateProvider.notifier).setMediaType(SearchMediaType.image);
      await settleFrames(tester);

      expect(resultIds(tester), ['lisbon-1', 'fav-archived']);
      expect(totalText(tester), '2 matches');
      expect(route(tester).read(searchOptionsProvider).total, 2, reason: 'the options count what the grid shows');
      for (final p in sent()) {
        expect((p.isFavorite, p.visibility, p.ownerId, p.withSharedSpaces), (true, null, null, null));
      }
    });
  });

  group('archive', () {
    testWidgets('the Archived switch is hidden', (tester) async {
      await pump(tester, OtherScreen.archive);
      await tapPillSearch(tester);
      await tapKey(tester, 'search-chip-filters');

      expect(find.byKey(const Key('search-filter-section-text')), findsOneWidget);
      expect(find.byKey(const Key('search-filter-section-archived')), findsNothing);
      expect(find.byKey(const Key('search-filter-archived')), findsNothing);
    });

    testWidgets("only my archived photos: a partner's never appear, in results, options or counts", (tester) async {
      await pump(tester, OtherScreen.archive);
      await tapPillSearch(tester);
      await tapKey(tester, 'search-chip-places');
      expect(find.byKey(const Key('search-place-city-Osaka')), findsOneWidget);
      expect(find.byKey(const Key('search-place-city-Nice')), findsNothing, reason: "the partner's archived photo");
      expect(find.byKey(const Key('search-place-city-Kyoto')), findsNothing, reason: 'not archived');
      await tapKey(tester, 'search-place-city-Osaka');
      await tapKey(tester, 'search-sheet-show');

      expect(resultIds(tester), ['archived-1', 'fav-archived']);
      expect(totalText(tester), '2 matches');
      for (final p in sent()) {
        expect(
          (p.visibility, p.ownerId, p.withSharedSpaces, p.withPartners),
          (SearchVisibility.archive, testUserId, null, null),
        );
      }
    });
  });

  group('videos', () {
    testWidgets('Photo or video is hidden, and results are videos within the Photos scope', (tester) async {
      await pump(tester, OtherScreen.videos);
      await tapPillSearch(tester);
      await tapKey(tester, 'search-chip-filters');
      expect(find.byKey(const Key('search-filter-section-text')), findsOneWidget);
      expect(find.byKey(const Key('search-filter-section-mediaType')), findsNothing);
      await tapKey(tester, 'search-sheet-show');

      await pick(tester, 'places', 'search-place-city-Berlin');

      // The archived clip is outside the Photos scope.
      expect(resultIds(tester), ['clip-1']);
      for (final p in sent()) {
        expect(
          (p.type, p.withSharedSpaces, p.withPartners, p.visibility),
          (SearchMediaType.video, true, true, SearchVisibility.timeline),
        );
      }
    });
  });

  group('recently taken', () {
    testWidgets('my own photos only, timeline visibility', (tester) async {
      await pump(tester, OtherScreen.recentlyTaken);
      await tapPillSearch(tester);
      await pick(tester, 'places', 'search-place-city-Kyoto');

      // The member's Kyoto photo is not mine.
      expect(resultIds(tester), ['kyoto-1']);
      for (final p in sent()) {
        expect(
          (p.ownerId, p.visibility, p.withSharedSpaces, p.withPartners),
          (testUserId, SearchVisibility.timeline, null, null),
        );
      }
    });
  });

  group('recently added', () {
    testWidgets('my own photos, timeline and archive', (tester) async {
      await pump(tester, OtherScreen.recentlyAdded);
      await tapPillSearch(tester);
      await pick(tester, 'places', 'search-place-city-Osaka');

      expect(resultIds(tester), ['archived-1', 'fav-archived']);
      for (final p in sent()) {
        expect((p.ownerId, p.visibility, p.withSharedSpaces, p.withPartners), (testUserId, null, null, null));
      }
    });

    testWidgets('Newest and Oldest go by upload date, grouped by the day of upload', (tester) async {
      await pump(tester, OtherScreen.recentlyAdded);
      await tapPillSearch(tester);
      await pick(tester, 'places', 'search-place-city-Lisbon');

      expect(resultIds(tester), ['old-scan', 'lisbon-2', 'lisbon-1']);
      expect(repository.byUploadDate, isNotEmpty);
      expect(repository.byUploadDate, everyElement(isTrue));
      final buckets = await tester.runAsync(() => service(tester).watchBuckets().first);
      expect(buckets!.whereType<TimeBucket>().first.date, DateTime(2025, 3, 1), reason: 'the day it was uploaded');

      route(tester).read(searchStateProvider.notifier).setSort(SearchSort.oldest);
      await settleFrames(tester);
      expect(resultIds(tester), ['lisbon-1', 'lisbon-2', 'old-scan']);
    });

    testWidgets('a smart query sorts by Relevance, in the same scope', (tester) async {
      await pump(tester, OtherScreen.recentlyAdded);
      await tapPillSearch(tester);
      await tester.tap(find.byKey(const Key('search-mode-field')));
      await tester.pump();
      await tester.enterText(find.byKey(const Key('search-mode-field')), 'beach');
      await settleFrames(tester);
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await settleFrames(tester);

      expect(route(tester).read(searchStateProvider).sort, SearchSort.relevance);
      expect(
        find.descendant(of: find.byKey(const Key('search-mode-sort')), matching: find.text('Relevance')),
        findsOneWidget,
      );
      final smart = sent('smart');
      expect(smart, isNotEmpty);
      expect((smart.last.query, smart.last.ownerId, smart.last.visibility), ('beach', testUserId, null));
    });

    testWidgets('outside search the page is as before: its app bar, its own upload-ordered timeline, and its scroll', (
      tester,
    ) async {
      await pump(tester, OtherScreen.recentlyAdded);
      expect(find.byType(MesmerizingSliverAppBar), findsOneWidget);
      expect(find.byType(SearchHeader), findsNothing);
      expect(timelines.calls, ['recentlyAdded $testUserId day']);
      expect(resultIds(tester).first, 'own-0');

      // The pill's zoom reaches the page's own timeline.
      await route(tester).read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.years);
      await settleFrames(tester);
      expect(timelines.calls.last, 'recentlyAdded $testUserId year');
      await route(tester).read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.all);
      await settleFrames(tester);

      final scroll = timelineController(tester)..jumpTo(1200);
      await settleFrames(tester);
      await tapPillSearch(tester);
      await pick(tester, 'places', 'search-place-city-Lisbon');
      expect(resultIds(tester).first, 'old-scan');

      await tapKey(tester, 'search-mode-back');
      expect(route(tester).read(searchModeProvider), isFalse);
      expect(find.byType(MesmerizingSliverAppBar), findsOneWidget);
      expect(resultIds(tester).first, 'own-0');
      expect(scroll.offset, 1200);
    });
  });
}
