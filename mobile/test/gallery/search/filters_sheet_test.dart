import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/widgets/search_header.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/scrubber.widget.dart';

import 'search_mode_harness.dart';

// Slice 4 behaviours (specs/2026-10-23-mobile-search-redesign-design.md, "Slice 4 — Mobile: the Filters sheet
// (preview)"), on the real Photos page with the real search providers and widgets, over the fake library of
// search_mode_harness.dart (favourites, ratings, cameras, albums, OCR text and an archived photo).

void main() {
  final database = SearchModeDatabase();

  setUpAll(database.setUpAll);
  tearDownAll(database.tearDownAll);

  late FakeSearchRepository repository;
  late ProviderContainer container;

  Future<void> pump(WidgetTester tester, {FakeLibrary? library, List<Override> extra = const []}) async {
    await database.setUp(timelineAssets: 0);
    repository = FakeSearchRepository(library ?? FakeLibrary.standard);
    container = searchModeContainer(db: database.db, repository: repository, extra: extra);
    await pumpPhotosPage(tester, container);
    await enterSearchMode(tester, container);
  }

  SearchFilters filters() => container.read(searchStateProvider).filters;
  String totalText(WidgetTester tester) => tester.widget<Text>(find.byKey(const Key('search-mode-total'))).data!;

  Future<void> tapKey(WidgetTester tester, String key) async {
    await tester.ensureVisible(find.byKey(Key(key)));
    await tester.pump();
    await tester.tap(find.byKey(Key(key)));
    await settleFrames(tester);
  }

  Future<void> openFilters(WidgetTester tester) => tapKey(tester, 'search-chip-filters');

  Future<void> closeSheet(WidgetTester tester) => tapKey(tester, 'search-sheet-show');

  Finder section(String name) => find.byKey(Key('search-filter-section-$name'));

  double sectionOpacity(WidgetTester tester, String name) =>
      tester.widget<Opacity>(find.descendant(of: section(name), matching: find.byType(Opacity)).first).opacity;

  bool sectionIgnored(WidgetTester tester, String name) => tester
      .widget<IgnorePointer>(find.descendant(of: section(name), matching: find.byType(IgnorePointer)).first)
      .ignoring;

  testWidgets('the sections show in order: Favorites, Photo or video, Rating, Camera, Albums, Text, Date range, '
      'Archived only, Untagged only', (tester) async {
    await pump(tester);
    await openFilters(tester);

    const order = ['favorites', 'mediaType', 'rating', 'camera', 'albums', 'text', 'dateRange', 'archived', 'untagged'];
    final tops = <double>[];
    for (final name in order) {
      await tester.ensureVisible(section(name));
      await tester.pump();
      tops.add(tester.getTopLeft(section(name)).dy + _scrolled(tester));
    }
    expect(tops, orderedEquals([...tops]..sort()), reason: 'top to bottom in the spec order');

    await disposePhotosPage(tester, container);
  });

  group('Favorites', () {
    testWidgets('the switch narrows the results and a "♥ Favorites ✕" chip appears; ✕ turns it off', (tester) async {
      await pump(tester);
      expect(totalText(tester), '7 photos and videos');
      await openFilters(tester);

      await tapKey(tester, 'search-filter-favorites');
      expect(filters().favoritesOnly, isTrue);
      await closeSheet(tester);

      expect(totalText(tester), '2 matches');
      final chip = find.byKey(const Key('search-extra-chip-favorites'));
      expect(chip, findsOneWidget);
      expect(find.descendant(of: chip, matching: find.text('Favorites')), findsOneWidget);
      expect(find.descendant(of: chip, matching: find.byIcon(Icons.favorite_rounded)), findsOneWidget);
      expect(find.descendant(of: chip, matching: find.byIcon(Icons.close_rounded)), findsOneWidget);

      await tapKey(tester, 'search-extra-chip-favorites');
      expect(filters().favoritesOnly, isFalse);
      expect(find.byKey(const Key('search-extra-chip-favorites')), findsNothing);
      expect(totalText(tester), '7 photos and videos');

      await disposePhotosPage(tester, container);
    });
  });

  group('Photo or video', () {
    testWidgets('All, Photos and Videos always show; with every result a photo, Videos still shows and is not greyed', (
      tester,
    ) async {
      await pump(tester);
      // Kyoto: three photos, no video.
      container.read(searchStateProvider.notifier).setPlace(const SearchPlace(country: 'Japan', city: 'Kyoto'));
      await settleFrames(tester);
      expect(totalText(tester), '3 matches');
      await openFilters(tester);

      for (final option in ['all', 'image', 'video']) {
        expect(find.byKey(Key('search-filter-media-$option')), findsOneWidget, reason: option);
      }
      expect(sectionOpacity(tester, 'mediaType'), 1);
      expect(sectionIgnored(tester, 'mediaType'), isFalse);
      final videos = find.byKey(const Key('search-filter-media-video'));
      expect(
        find.ancestor(of: videos, matching: find.byType(Opacity)).evaluate().map((e) => (e.widget as Opacity).opacity),
        everyElement(1),
      );

      await tapKey(tester, 'search-filter-media-video');
      expect(filters().mediaType, SearchMediaType.video);
      await tapKey(tester, 'search-filter-media-image');
      expect(filters().mediaType, SearchMediaType.image);
      await closeSheet(tester);
      expect(find.byKey(const Key('search-extra-chip-mediaType')), findsOneWidget);

      await disposePhotosPage(tester, container);
    });
  });

  group('Rating', () {
    testWidgets(
      'all five stars show; with the options reporting ratings [5] only, the fourth star selects "at least 4"',
      (tester) async {
        // Only kyoto-1 is rated (5 stars).
        final library = FakeLibrary.standard.withAssets([
          for (final a in FakeLibrary.standard.assets) a.copyWith(rating: () => a.id == 'kyoto-1' ? 5 : null),
        ]);
        await pump(tester, library: library);
        expect(container.read(searchOptionsProvider).ratings!.map((r) => r.rating), [5]);
        await openFilters(tester);

        for (var star = 1; star <= 5; star++) {
          expect(find.byKey(Key('search-filter-star-$star')), findsOneWidget, reason: 'star $star');
        }
        await tapKey(tester, 'search-filter-star-4');

        expect(filters().minRating, 4);
        expect(repository.resultParams.last.minRating, 4);
        expect(find.text('≥ 4 stars'), findsWidgets);
        // Still five stars, the first four filled.
        for (var star = 1; star <= 5; star++) {
          expect(tester.widget<IconButton>(find.byKey(Key('search-filter-star-$star'))).isSelected, star <= 4);
        }
        expect(totalText(tester), '1 match');

        await disposePhotosPage(tester, container);
      },
    );
  });

  group('Camera', () {
    testWidgets('a make opens its models at once; "Any Apple" selects the make and a model selects that model', (
      tester,
    ) async {
      await pump(tester);
      await openFilters(tester);
      expect(find.byKey(const Key('search-filter-camera-any-Apple')), findsNothing);
      final calls = repository.calls.length;

      await tapKey(tester, 'search-filter-make-Apple');
      expect(find.byKey(const Key('search-filter-camera-any-Apple')), findsOneWidget);
      expect(find.text('Any Apple'), findsOneWidget);
      expect(find.byKey(const Key('search-filter-model-Apple-iPhone 15')), findsOneWidget);
      expect(repository.calls.length, calls, reason: 'the models come from options already loaded');
      expect(filters().camera, isNull, reason: 'opening a make selects nothing');

      await tapKey(tester, 'search-filter-camera-any-Apple');
      expect(filters().camera, const SearchCamera(make: 'Apple'));
      expect(repository.resultParams.last.make, 'Apple');
      expect(repository.resultParams.last.model, isNull);
      expect(totalText(tester), '2 matches');

      await tapKey(tester, 'search-filter-make-Fujifilm');
      await tapKey(tester, 'search-filter-model-Fujifilm-X-T5');
      expect(filters().camera, const SearchCamera(make: 'Fujifilm', model: 'X-T5'));
      expect(repository.resultParams.last.model, 'X-T5');
      expect(totalText(tester), '2 matches');

      await disposePhotosPage(tester, container);
    });
  });

  group('Albums', () {
    testWidgets('offers Any, In an album and Not in one', (tester) async {
      await pump(tester);
      await openFilters(tester);
      for (final option in ['any', 'inAlbum', 'notInAlbum']) {
        expect(find.byKey(Key('search-filter-album-$option')), findsOneWidget, reason: option);
      }
      await tapKey(tester, 'search-filter-album-inAlbum');
      expect(filters().album, SearchAlbumFilter.inAlbum);
      expect(totalText(tester), '1 match');
      await tapKey(tester, 'search-filter-album-notInAlbum');
      expect(totalText(tester), '6 matches');

      await disposePhotosPage(tester, container);
    });

    testWidgets('is hidden on an album scope', (tester) async {
      await pump(tester, extra: [searchScopeProvider.overrideWithValue(const AlbumSearchScope('trip'))]);
      await openFilters(tester);
      expect(section('favorites'), findsOneWidget);
      expect(section('albums'), findsNothing);

      await disposePhotosPage(tester, container);
    });
  });

  group('Text', () {
    testWidgets('OCR and file name together send both and narrow to photos matching both', (tester) async {
      await pump(tester);
      await openFilters(tester);

      await tester.enterText(find.byKey(const Key('search-filter-text-ocr')), 'menu');
      await settleFrames(tester);
      expect(totalText(tester), '2 matches', reason: 'kyoto-1 and kyoto-2 say "menu"');
      await tester.enterText(find.byKey(const Key('search-filter-text-fileName')), 'kyoto-1');
      await settleFrames(tester);

      expect(filters().text, const SearchText(ocr: 'menu', fileName: 'kyoto-1'));
      final sent = repository.resultParams.last;
      expect(sent.ocr, 'menu');
      expect(sent.originalFileName, 'kyoto-1');
      expect(totalText(tester), '1 match');

      await closeSheet(tester);
      expect(find.byKey(const Key('search-extra-chip-text')), findsOneWidget);

      await disposePhotosPage(tester, container);
    });

    testWidgets('with a text search active, file name and description are read-only and the sheet says why', (
      tester,
    ) async {
      await pump(tester);
      container.read(searchStateProvider.notifier).submitText('beach');
      await settleFrames(tester);
      await openFilters(tester);

      expect(find.byKey(const Key('search-filter-text-query-hint')), findsOneWidget);
      TextField field(String key) => tester.widget<TextField>(find.byKey(Key('search-filter-text-$key')));
      expect(field('ocr').enabled, isTrue);
      expect(field('fileName').enabled, isFalse);
      expect(field('description').enabled, isFalse);

      await disposePhotosPage(tester, container);
    });
  });

  group('Date range', () {
    testWidgets('one end alone is open-ended: From only means that day onward, To only up to and including that day', (
      tester,
    ) async {
      await pump(tester);
      await openFilters(tester);

      await tapKey(tester, 'search-filter-date-from');
      await tester.tap(find.text('5'));
      await tester.pump();
      await tester.tap(find.text('OK'));
      await settleFrames(tester);
      expect(filters().date, SearchDate.custom(from: DateTime(2026, 10, 5)));
      var params = repository.resultParams.last;
      expect(params.takenAfter, DateTime.utc(2026, 10, 5));
      expect(params.takenBefore, isNull, reason: 'From only sends no end');

      await tapKey(tester, 'search-filter-date-clear');
      await tapKey(tester, 'search-filter-date-to');
      await tester.tap(find.text('20'));
      await tester.pump();
      await tester.tap(find.text('OK'));
      await settleFrames(tester);
      expect(filters().date, SearchDate.custom(to: DateTime(2026, 10, 20)));
      params = repository.resultParams.last;
      expect(params.takenAfter, isNull, reason: 'To only sends no start');
      expect(params.takenBefore, DateTime.utc(2026, 10, 21), reason: 'the 20th is included');
      await closeSheet(tester);
      expect(
        find.descendant(
          of: find.byKey(const Key('search-extra-chip-dateRange')),
          matching: find.text('Until Oct 20, 2026'),
        ),
        findsOneWidget,
      );

      await disposePhotosPage(tester, container);
    });

    testWidgets('a from/to range replaces a When selection, and the reverse', (tester) async {
      await pump(tester);
      final notifier = container.read(searchStateProvider.notifier)..setDate(const SearchDate.year(2024));
      await settleFrames(tester);
      expect(
        find.descendant(of: find.byKey(const Key('search-chip-when')), matching: find.text('2024')),
        findsOneWidget,
      );

      await openFilters(tester);
      await tapKey(tester, 'search-filter-date-from');
      await tester.tap(find.text('5'));
      await tester.pump();
      await tester.tap(find.text('OK'));
      await settleFrames(tester);
      // The clock says 2026-10-23. From alone is open-ended: that day onward, not a one-day range.
      expect(filters().date, SearchDate.custom(from: DateTime(2026, 10, 5)));
      await tapKey(tester, 'search-filter-date-to');
      await tester.tap(find.text('20'));
      await tester.pump();
      await tester.tap(find.text('OK'));
      await settleFrames(tester);
      expect(filters().date, SearchDate.custom(from: DateTime(2026, 10, 5), to: DateTime(2026, 10, 20)));
      await closeSheet(tester);

      expect(find.byKey(const Key('search-extra-chip-dateRange')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('search-chip-when')), matching: find.text('2024')), findsNothing);

      // The reverse: a year in the When sheet replaces the range.
      await tapKey(tester, 'search-chip-when');
      await tapKey(tester, 'search-when-year-2024');
      await closeSheet(tester);
      expect(filters().date, const SearchDate.year(2024));
      expect(find.byKey(const Key('search-extra-chip-dateRange')), findsNothing);
      notifier.setDate(null);
      await settleFrames(tester);

      await disposePhotosPage(tester, container);
    });
  });

  group('Archived only, Untagged only', () {
    testWidgets('Archived only narrows the results to archived photos', (tester) async {
      await pump(tester);
      await openFilters(tester);
      await tapKey(tester, 'search-filter-archived');

      expect(filters().archivedOnly, isTrue);
      expect(repository.resultParams.last.visibility, SearchVisibility.archive);
      expect(totalText(tester), '1 match');

      await disposePhotosPage(tester, container);
    });

    testWidgets('Untagged only narrows the results and clears the tags, and choosing a tag turns it off', (
      tester,
    ) async {
      await pump(tester);
      final notifier = container.read(searchStateProvider.notifier)
        ..toggleTag(const SearchTagRef(id: 'beach', value: 'beach'));
      await settleFrames(tester);
      await openFilters(tester);

      await tapKey(tester, 'search-filter-untagged');
      expect(filters().untagged, isTrue);
      expect(filters().tags, isEmpty);
      expect(repository.resultParams.last.untagged, isTrue);
      // Untagged timeline photos: kyoto-2, kyoto-3, lisbon-1, berlin-1, alex-1.
      expect(totalText(tester), '5 matches');

      notifier.toggleTag(const SearchTagRef(id: 'food', value: 'food'));
      await settleFrames(tester);
      expect(filters().untagged, isFalse);
      expect(
        tester
            .widget<SwitchListTile>(
              find.descendant(
                of: find.byKey(const Key('search-filter-untagged')),
                matching: find.byType(SwitchListTile),
              ),
            )
            .value,
        isFalse,
      );

      await disposePhotosPage(tester, container);
    });
  });

  group('#910 per section', () {
    testWidgets('a section empty for the whole scope is hidden', (tester) async {
      // No favourites, no ratings, no cameras anywhere.
      final library = FakeLibrary.standard.withAssets([
        for (final a in FakeLibrary.standard.assets)
          FakeAsset(a.id, a.taken, people: a.people, tags: a.tags, country: a.country, city: a.city, video: a.video),
      ]);
      await pump(tester, library: library);
      await openFilters(tester);

      expect(section('favorites'), findsNothing);
      expect(section('rating'), findsNothing);
      expect(section('camera'), findsNothing);
      expect(section('mediaType'), findsOneWidget);
      expect(section('text'), findsOneWidget);

      await disposePhotosPage(tester, container);
    });

    testWidgets('a section empty only because of the current filters is greyed and ignores taps', (tester) async {
      await pump(tester);
      // Germany: no favourites, no ratings, no cameras, nothing in an album.
      container.read(searchStateProvider.notifier).setPlace(const SearchPlace(country: 'Germany'));
      await settleFrames(tester);
      await openFilters(tester);

      for (final name in ['favorites', 'rating', 'camera', 'albums']) {
        expect(section(name), findsOneWidget, reason: '$name is greyed, not hidden');
        expect(sectionOpacity(tester, name), lessThan(1), reason: name);
        expect(sectionIgnored(tester, name), isTrue, reason: name);
      }
      expect(sectionOpacity(tester, 'mediaType'), 1);
      // Greyed, yet all five stars still show.
      for (var star = 1; star <= 5; star++) {
        expect(find.byKey(Key('search-filter-star-$star')), findsOneWidget);
      }

      await disposePhotosPage(tester, container);
    });
  });

  testWidgets('the badge counts the active extra filters, and each shows as its own chip', (tester) async {
    await pump(tester);
    expect(find.byKey(const Key('search-chip-filters-badge')), findsNothing);
    container.read(searchStateProvider.notifier)
      ..setFavoritesOnly(true)
      ..setMinRating(3)
      ..setCamera(const SearchCamera(make: 'Fujifilm'));
    await settleFrames(tester);

    final badge = find.byKey(const Key('search-chip-filters-badge'));
    expect(find.descendant(of: badge, matching: find.text('3')), findsOneWidget);
    for (final extra in ['favorites', 'rating', 'camera']) {
      expect(find.byKey(Key('search-extra-chip-$extra')), findsOneWidget, reason: extra);
    }
    expect(find.text('≥ 3 stars'), findsOneWidget);
    expect(find.text('Fujifilm'), findsOneWidget);

    await tapKey(tester, 'search-extra-chip-rating');
    expect(find.descendant(of: badge, matching: find.text('2')), findsOneWidget);
    expect(filters().minRating, isNull);

    await disposePhotosPage(tester, container);
  });

  testWidgets('in search mode the timeline scrubber starts below the taller search header', (tester) async {
    tester.view.padding = const FakeViewPadding(top: 66);
    addTearDown(tester.view.resetPadding);
    await database.setUp(timelineAssets: 200);
    repository = FakeSearchRepository(FakeLibrary.standard);
    container = searchModeContainer(db: database.db, repository: repository);
    await pumpPhotosPage(tester, container);
    final statusBar = MediaQuery.paddingOf(tester.element(timelineFinder)).top;
    final outside = tester.widget<Scrubber>(find.byType(Scrubber)).topPadding;

    await enterSearchMode(tester, container);

    // The header itself still starts right under the status bar.
    expect(tester.getTopLeft(find.byKey(const Key('search-mode-back'))).dy, lessThan(statusBar + 10));
    final headerBottom =
        tester.getBottomLeft(find.byKey(const Key('search-chip-row'))).dy + SearchHeader.resultsRowHeight;
    final topPadding = tester.widget<Scrubber>(find.byType(Scrubber)).topPadding;
    expect(topPadding, greaterThanOrEqualTo(headerBottom));
    expect(topPadding, greaterThan(outside));

    await disposePhotosPage(tester, container);
  });
}

double _scrolled(WidgetTester tester) {
  final list = find.byKey(const Key('search-filters-list'));
  return tester
      .state<ScrollableState>(find.descendant(of: list, matching: find.byType(Scrollable)).first)
      .position
      .pixels;
}
