import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/config/nav_config.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/gallery/search/photos_search.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_timeline.dart';
import 'package:immich_mobile/gallery/search/widgets/search_header.widget.dart';
import 'package:immich_mobile/presentation/pages/dev/main_timeline.page.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_search_blob.widget.dart';
import 'package:immich_mobile/presentation/widgets/memory/memory_lane.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_bottom_pill.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/providers/haptic_feedback.provider.dart';
import 'package:immich_mobile/providers/infrastructure/readonly_mode.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';

import '../../test_helpers/fake_tabs_router.dart';
import '../../widget_tester_extensions.dart';
import 'search_mode_harness.dart';

// Slice 3 behaviours (specs/2026-10-23-mobile-search-redesign-design.md, "Slice 3 — Mobile: search mode on Photos
// (preview)"), on the real Photos page (MainTimelinePage) with the real timeline, search providers and widgets, over a
// fake library whose options and results narrow like the server's (search_mode_harness.dart).

void main() {
  final database = SearchModeDatabase();

  setUpAll(database.setUpAll);
  tearDownAll(database.tearDownAll);

  late FakeSearchRepository repository;
  late ProviderContainer container;

  Future<void> pump(
    WidgetTester tester, {
    int timelineAssets = 0,
    FakeLibrary? library,
    List<String> recent = const [],
    bool memories = false,
    bool realDebounce = false,
  }) async {
    await database.setUp(timelineAssets: timelineAssets);
    repository = FakeSearchRepository(library ?? FakeLibrary.standard);
    container = searchModeContainer(
      db: database.db,
      repository: repository,
      recentPersonIds: recent,
      memories: memories,
      realDebounce: realDebounce,
    );
    await pumpPhotosPage(tester, container);
  }

  SearchFilters filters() => container.read(searchStateProvider).filters;
  String totalText(WidgetTester tester) => tester.widget<Text>(find.byKey(const Key('search-mode-total'))).data!;
  int? resultsTotal() => container.read(searchResultsProvider).total;

  Future<void> tapKey(WidgetTester tester, String key) async {
    // Chips past the right edge and rows further down a sheet scroll into view first, as a user would.
    await tester.ensureVisible(find.byKey(Key(key)));
    await tester.pump();
    await tester.tap(find.byKey(Key(key)));
    await settleFrames(tester);
  }

  Future<void> openChip(WidgetTester tester, String chip) => tapKey(tester, 'search-chip-$chip');

  Future<void> closeSheet(WidgetTester tester) => tapKey(tester, 'search-sheet-show');

  Future<void> typeInField(WidgetTester tester, String text) async {
    await tester.tap(find.byKey(const Key('search-mode-field')));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('search-mode-field')), text);
    await settleFrames(tester);
  }

  group('entering', () {
    testWidgets('the header replaces the app bar, the keyboard stays closed, the whole timeline shows with its exact '
        'total', (tester) async {
      await pump(tester, timelineAssets: 30);
      expect(find.byType(PhotosTimelineAppBar), findsOneWidget);
      expect(find.byType(SearchHeader), findsNothing);

      await enterSearchMode(tester, container);

      expect(find.byType(PhotosTimelineAppBar), findsNothing);
      expect(find.byType(SearchHeader), findsOneWidget);
      for (final chip in ['people', 'when', 'places', 'tags', 'filters']) {
        expect(find.byKey(Key('search-chip-$chip')), findsOneWidget, reason: chip);
      }
      expect(tester.testTextInput.isVisible, isFalse, reason: 'the keyboard opens only when the field is tapped');
      expect(FocusManager.instance.primaryFocus?.debugLabel, isNot('search-field'));
      // The fake library has 7 photos: the bucket sum of the unfiltered results.
      expect(totalText(tester), '7 photos and videos');
      // No filter yet: the grid is still the screen's own timeline (30 local photos), not the search results.
      expect(container.read(searchStateProvider).isEmpty, isTrue);
      expect(repository.calls.where((c) => c.startsWith('bucket ')), isEmpty);

      await disposePhotosPage(tester, container);
    });

    testWidgets('the search button always enters search mode and the bottom nav hides (no preview switch)', (
      tester,
    ) async {
      final navContainer = ProviderContainer(
        overrides: [
          readonlyModeProvider.overrideWith(() => _FakeReadonly()),
          hapticFeedbackProvider.overrideWith((ref) => _NoOpHaptic(ref)),
          appConfigProvider.overrideWithValue(const AppConfig(nav: NavConfig(showSpaces: false))),
          serverSupportsSpacesProvider.overrideWithValue(true),
        ],
      );
      await tester.pumpWidget(
        localizedForTest(
          UncontrolledProviderScope(
            container: navContainer,
            child: MaterialApp(
              home: MediaQuery(
                data: const MediaQueryData(size: Size(400, 900)),
                child: Material(
                  child: GalleryBottomNav(tabsRouter: FakeTabsRouter(initialIndex: GalleryTabEnum.photos.index)),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byType(GallerySearchBlob));
      await tester.pumpAndSettle();

      expect(navContainer.read(searchModeProvider), isTrue);
      final opacity = tester.widget<AnimatedOpacity>(find.byKey(const Key('gallery-bottom-nav-opacity')));
      expect(opacity.opacity, 0, reason: 'search mode hides the bottom nav');
      await tester.pumpWidget(const SizedBox.shrink());
      navContainer.dispose();
    });
  });

  testWidgets(
    'a timeline without a search (an album opened from a result) keeps its own app bar while Photos searches',
    (tester) async {
      await database.setUp(timelineAssets: 3);
      repository = FakeSearchRepository(FakeLibrary.standard);
      container = searchModeContainer(db: database.db, repository: repository);
      container.read(searchModeProvider.notifier).enter();
      await pumpPhotosPage(
        tester,
        container,
        page: const TimelineRouteScope(
          timelineServiceBuilder: buildPhotosTimelineService,
          child: Timeline(appBar: SliverAppBar(key: Key('album-app-bar')), bottomSheet: null),
        ),
      );

      expect(find.byKey(const Key('album-app-bar')), findsOneWidget);
      expect(find.byType(SearchHeader), findsNothing);

      await disposePhotosPage(tester, container);
    },
  );

  testWidgets('the Photos tab warms the search cache once when it first shows', (tester) async {
    await database.setUp();
    repository = FakeSearchRepository(FakeLibrary.standard);
    container = searchModeContainer(db: database.db, repository: repository);
    await pumpPhotosPage(tester, container);
    // Availability, then every list, before search opens.
    expect(repository.calls.first, 'options ');
    expect(repository.calls, hasLength(1 + 8));
    await disposePhotosPage(tester, container);
  });

  group('leaving', () {
    for (final via in ['back arrow', 'Android back']) {
      testWidgets('$via clears every filter and the query, brings the app bar back and restores the scroll position', (
        tester,
      ) async {
        // The app's own debounce: what is still pending when search mode closes must die with it.
        await pump(tester, timelineAssets: 200, realDebounce: true);
        final controller = timelineController(tester);
        controller.jumpTo(1500);
        await settleFrames(tester);
        expect(controller.offset, 1500);

        await enterSearchMode(tester, container);
        container.read(searchStateProvider.notifier)
          ..togglePerson(const SearchPersonRef(filterId: 'person:anna', name: 'Anna', profileId: 'anna'))
          ..submitText('beach');
        await settleFrames(tester);
        expect(controller.offset, 0, reason: 'new filters start the results at the top');
        expect(container.read(searchStateProvider).isEmpty, isFalse);
        final callsBeforeLeaving = repository.calls.length;

        if (via == 'back arrow') {
          await tapKey(tester, 'search-mode-back');
        } else {
          await tester.binding.handlePopRoute();
          await settleFrames(tester);
        }

        expect(container.read(searchModeProvider), isFalse);
        expect(container.read(searchStateProvider).isEmpty, isTrue, reason: 'filters and query cleared');
        expect(find.byType(SearchHeader), findsNothing);
        expect(timelineController(tester).offset, 1500, reason: 'back where the timeline was before searching');
        // The 200 local photos are back (not the 3 results), and so is the app bar above them.
        expect(container.read(searchTimelineFeedProvider), isNull);

        // Nothing is asked of the server for the cleared state: search mode is gone.
        await settleFrames(tester);
        expect(repository.calls.skip(callsBeforeLeaving), isEmpty);

        // The floating app bar scrolled away with the timeline; at the top it is the screen's own again.
        timelineController(tester).jumpTo(0);
        await settleFrames(tester);
        expect(find.byType(PhotosTimelineAppBar), findsOneWidget);
        expect(find.byType(SearchHeader), findsNothing);

        await disposePhotosPage(tester, container);
      });
    }
  });

  group('field', () {
    testWidgets('@a shows only people; picking one fills the People chip, clears the field and narrows the results', (
      tester,
    ) async {
      await pump(tester);
      await enterSearchMode(tester, container);

      await typeInField(tester, '@a');
      expect(find.byKey(const Key('search-mode-suggestions')), findsOneWidget);
      expect(find.byKey(const Key('search-suggestion-person-person:anna')), findsOneWidget);
      expect(find.byKey(const Key('search-suggestion-person-person:alex')), findsOneWidget);
      expect(find.byKey(const Key('search-suggestion-person-person:ben')), findsNothing);
      expect(find.byKey(const Key('search-suggestion-smart')), findsNothing);
      expect(find.textContaining('beach'), findsNothing);

      await tapKey(tester, 'search-suggestion-person-person:anna');

      expect(filters().people.map((p) => p.filterId), ['person:anna']);
      expect(
        find.descendant(of: find.byKey(const Key('search-chip-people')), matching: find.text('Anna')),
        findsOneWidget,
      );
      expect(tester.widget<TextField>(find.byKey(const Key('search-mode-field'))).controller!.text, isEmpty);
      expect(find.byKey(const Key('search-mode-suggestions')), findsNothing);
      // Anna is in kyoto-1, kyoto-2 and lisbon-1.
      expect(totalText(tester), '3 matches');

      await disposePhotosPage(tester, container);
    });

    testWidgets(
      'Enter on "beach" shows a query token and sorts by relevance; backspace in the empty field removes it',
      (tester) async {
        await pump(tester);
        await enterSearchMode(tester, container);

        await typeInField(tester, 'beach');
        expect(find.byKey(const Key('search-suggestion-smart')), findsOneWidget);
        await tester.testTextInput.receiveAction(TextInputAction.search);
        await settleFrames(tester);

        expect(container.read(searchStateProvider).query, const SearchQuery.text('beach'));
        expect(container.read(searchStateProvider).sort, SearchSort.relevance);
        expect(find.byKey(const Key('search-mode-query-token')), findsOneWidget);
        expect(
          find.descendant(of: find.byKey(const Key('search-mode-sort')), matching: find.text('Relevance')),
          findsOneWidget,
        );

        await tester.tap(find.byKey(const Key('search-mode-field')));
        await tester.pump();
        await tester.sendKeyEvent(LogicalKeyboardKey.backspace);
        await settleFrames(tester);

        expect(container.read(searchStateProvider).query, const SearchQuery.none());
        expect(find.byKey(const Key('search-mode-query-token')), findsNothing);
        expect(container.read(searchStateProvider).sort, SearchSort.newest);

        await disposePhotosPage(tester, container);
      },
    );
  });

  group('People sheet', () {
    testWidgets('shows the Recent row and the most photographed with counts', (tester) async {
      await pump(tester, recent: const ['ben']);
      await enterSearchMode(tester, container);
      await openChip(tester, 'people');

      expect(find.byKey(const Key('search-sheet-recent')), findsOneWidget);
      expect(find.byKey(const Key('search-sheet-recent-person:ben')), findsOneWidget);
      expect(find.text('Most photographed'), findsOneWidget);
      final anna = find.byKey(const Key('search-sheet-person-person:anna'));
      expect(anna, findsOneWidget);
      expect(find.descendant(of: anna, matching: find.text('3')), findsOneWidget);
      expect(
        find.descendant(of: find.byKey(const Key('search-sheet-person-person:ben')), matching: find.text('2')),
        findsOneWidget,
      );

      await disposePhotosPage(tester, container);
    });

    testWidgets('search filters the list on the device, with no request per keystroke', (tester) async {
      await pump(tester);
      await enterSearchMode(tester, container);
      await openChip(tester, 'people');
      final calls = repository.calls.length;

      for (final text in ['a', 'al', 'ale']) {
        await tester.enterText(find.byKey(const Key('search-sheet-field')), text);
        await settleFrames(tester, frames: 4);
      }

      expect(find.byKey(const Key('search-sheet-person-person:alex')), findsOneWidget);
      expect(find.byKey(const Key('search-sheet-person-person:anna')), findsNothing);
      expect(find.text('Matches'), findsOneWidget);
      expect(repository.calls.length, calls, reason: 'typing in the sheet sends nothing');

      await disposePhotosPage(tester, container);
    });

    testWidgets('selecting two people narrows the results to photos with both', (tester) async {
      await pump(tester);
      await enterSearchMode(tester, container);
      await openChip(tester, 'people');

      await tapKey(tester, 'search-sheet-person-person:anna');
      await tapKey(tester, 'search-sheet-person-person:ben');

      expect(filters().people.map((p) => p.filterId), ['person:anna', 'person:ben']);
      expect(find.text('Selected · photos with all of them'), findsOneWidget);
      // Only kyoto-1 has Anna and Ben.
      expect(resultsTotal(), 1);
      expect(find.text('Show 1 photo'), findsOneWidget);

      await disposePhotosPage(tester, container);
    });
  });

  group('When sheet', () {
    testWidgets('quick ranges select Today, This week, This month and This year', (tester) async {
      await pump(tester);
      await enterSearchMode(tester, container);
      await openChip(tester, 'when');

      for (final range in SearchQuickRange.values) {
        await tapKey(tester, 'search-when-quick-${range.name}');
        expect(filters().date, SearchDate.quickRange(range), reason: range.name);
      }

      await disposePhotosPage(tester, container);
    });

    testWidgets('a year selects the year; "Months" opens its months at once, with empty months greyed', (tester) async {
      await pump(tester);
      await enterSearchMode(tester, container);
      await openChip(tester, 'when');
      final calls = repository.calls.length;

      await tapKey(tester, 'search-when-year-2024');
      expect(filters().date, const SearchDate.year(2024));

      await tapKey(tester, 'search-when-months-2024');
      expect(find.byKey(const Key('search-when-month-2024-6')), findsOneWidget);
      expect(find.byKey(const Key('search-when-month-2024-1')), findsOneWidget);
      // The months came from the options already loaded: opening them asked for nothing.
      expect(
        repository.calls
            .skip(calls)
            .where((c) => !c.startsWith('options') && c != 'buckets' && !c.startsWith('bucket ')),
        isEmpty,
      );

      // January 2024 has no photos: greyed, and tapping it does nothing.
      await tapKey(tester, 'search-when-month-2024-1');
      expect(filters().date, const SearchDate.year(2024));
      await tapKey(tester, 'search-when-month-2024-6');
      expect(filters().date, const SearchDate.month(2024, 6));

      await disposePhotosPage(tester, container);
    });
  });

  group('Places sheet', () {
    testWidgets('countries and their cities show at once; "lis" leaves Lisbon under Portugal; a country selects all of '
        'it', (tester) async {
      await pump(tester);
      await enterSearchMode(tester, container);
      await openChip(tester, 'places');

      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.byKey(const Key('search-sheet-skeleton')), findsNothing);
      for (final row in ['country-Japan', 'city-Kyoto', 'country-Portugal', 'city-Lisbon', 'city-Porto']) {
        expect(find.byKey(Key('search-place-$row')), findsOneWidget, reason: row);
      }

      await tester.enterText(find.byKey(const Key('search-sheet-field')), 'lis');
      await settleFrames(tester, frames: 4);
      expect(find.byKey(const Key('search-place-country-Portugal')), findsOneWidget);
      expect(find.byKey(const Key('search-place-city-Lisbon')), findsOneWidget);
      expect(find.byKey(const Key('search-place-city-Porto')), findsNothing);
      expect(find.byKey(const Key('search-place-country-Japan')), findsNothing);

      await tapKey(tester, 'search-place-country-Portugal');
      expect(filters().place, const SearchPlace(country: 'Portugal'));
      expect(resultsTotal(), 2);

      await disposePhotosPage(tester, container);
    });
  });

  group('Tags sheet', () {
    testWidgets('selects several tags, says which match applies, and choosing a tag turns Untagged off', (
      tester,
    ) async {
      await pump(tester);
      await enterSearchMode(tester, container);
      container.read(searchStateProvider.notifier).setUntagged(true);
      await settleFrames(tester);
      await openChip(tester, 'tags');

      expect(find.text('Photos with any of these tags'), findsOneWidget);
      await tapKey(tester, 'search-tag-beach');
      expect(filters().untagged, isFalse);
      await tapKey(tester, 'search-tag-food');
      expect(filters().tags.map((t) => t.id), ['beach', 'food']);
      expect(find.byKey(const Key('search-tag-selected-beach')), findsOneWidget);
      expect(find.byKey(const Key('search-tag-selected-food')), findsOneWidget);
      // Browse results match any of the tags: kyoto-1 (both) and porto-1 (food).
      expect(resultsTotal(), 2);

      // With a query the same tags must all match, and the hint says so.
      container.read(searchStateProvider.notifier).submitText('dinner');
      await settleFrames(tester);
      expect(find.text('With a search active, photos with all of these tags'), findsOneWidget);

      await disposePhotosPage(tester, container);
    });
  });

  testWidgets('live sheets: the results behind an open sheet update, and its button shows the exact total', (
    tester,
  ) async {
    // The app's own debounce: results arrive after the selection, while the sheet is open.
    await pump(tester, realDebounce: true);
    await enterSearchMode(tester, container);
    await openChip(tester, 'people');
    expect(find.text('Show 7 photos'), findsOneWidget);

    await tapKey(tester, 'search-sheet-person-person:anna');

    expect(find.text('Show 3 photos'), findsOneWidget);
    // The timeline behind the sheet already shows the 3 results.
    final timeline = ProviderScope.containerOf(tester.element(find.byType(Timeline)));
    expect(timeline.read(searchTimelineFeedProvider)?.latest.total, 3);
    expect(totalText(tester), '3 matches');

    await closeSheet(tester);
    expect(find.byKey(const Key('search-sheet-show')), findsNothing);
    await disposePhotosPage(tester, container);
  });

  group('#910', () {
    testWidgets('a library with no tags hides the Tags chip', (tester) async {
      await pump(tester, library: FakeLibrary.standard.withoutTags());
      await enterSearchMode(tester, container);

      expect(find.byKey(const Key('search-chip-tags')), findsNothing);
      expect(find.byKey(const Key('search-chip-people')), findsOneWidget);

      await disposePhotosPage(tester, container);
    });

    testWidgets('with Kyoto active and no tagged photos in Kyoto, the Tags chip is greyed and cannot be tapped', (
      tester,
    ) async {
      final library = FakeLibrary(
        people: FakeLibrary.standard.people,
        tags: FakeLibrary.standard.tags,
        assets: [
          for (final a in FakeLibrary.standard.assets)
            FakeAsset(
              a.id,
              a.taken,
              people: a.people,
              tags: a.city == 'Kyoto' ? const [] : a.tags,
              country: a.country,
              city: a.city,
              video: a.video,
            ),
        ],
      );
      await pump(tester, library: library);
      await enterSearchMode(tester, container);
      expect(_opacity(tester, 'tags'), 1);

      container.read(searchStateProvider.notifier).setPlace(const SearchPlace(country: 'Japan', city: 'Kyoto'));
      await settleFrames(tester);

      expect(find.byKey(const Key('search-chip-tags')), findsOneWidget, reason: 'greyed, not hidden');
      expect(_opacity(tester, 'tags'), lessThan(1));
      await openChip(tester, 'tags');
      expect(find.byKey(const Key('search-sheet-show')), findsNothing, reason: 'a greyed chip opens nothing');

      await disposePhotosPage(tester, container);
    });
  });

  testWidgets('Clear all appears with two filters and clears them, staying in search mode', (tester) async {
    await pump(tester);
    await enterSearchMode(tester, container);
    final notifier = container.read(searchStateProvider.notifier)
      ..togglePerson(const SearchPersonRef(filterId: 'person:anna', name: 'Anna', profileId: 'anna'));
    await settleFrames(tester);
    expect(find.byKey(const Key('search-chip-clear-all')), findsNothing, reason: 'one filter');

    notifier.setDate(const SearchDate.year(2024));
    await settleFrames(tester);
    expect(find.byKey(const Key('search-chip-clear-all')), findsOneWidget);

    await tapKey(tester, 'search-chip-clear-all');
    expect(container.read(searchStateProvider).isEmpty, isTrue);
    expect(container.read(searchModeProvider), isTrue);
    expect(find.byType(SearchHeader), findsOneWidget);
    expect(find.byKey(const Key('search-chip-clear-all')), findsNothing);

    await disposePhotosPage(tester, container);
  });

  testWidgets(
    'the memory lane hides while a filter is active; the grouping pill stays and Years zoom works on results',
    (tester) async {
      await pump(tester, timelineAssets: 5, memories: true);
      expect(find.byType(MemoryLane), findsOneWidget);
      expect(
        find.byType(TimelineGroupingBottomPill),
        findsNothing,
        reason: 'Photos keeps its app-bar chip outside search',
      );

      await enterSearchMode(tester, container);
      expect(find.byType(TimelineGroupingBottomPill), findsOneWidget);

      container
          .read(searchStateProvider.notifier)
          .togglePerson(const SearchPersonRef(filterId: 'person:anna', name: 'Anna', profileId: 'anna'));
      await settleFrames(tester);
      expect(find.byType(MemoryLane), findsNothing);

      final timeline = ProviderScope.containerOf(tester.element(find.byType(Timeline)));
      await timeline.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.years);
      await settleFrames(tester);
      // Anna's results: two in 2024, one in 2023.
      expect(find.bySemanticsLabel(RegExp(r'^2024, 2 photos')), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp(r'^2023, 1 photo')), findsOneWidget);

      await timeline.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.all);
      await disposePhotosPage(tester, container);
    },
  );
}

double _opacity(WidgetTester tester, String chip) => tester
    .widget<Opacity>(find.descendant(of: find.byKey(Key('search-chip-$chip')), matching: find.byType(Opacity)).first)
    .opacity;

class _FakeReadonly extends ReadOnlyModeNotifier {
  @override
  bool build() => false;

  @override
  void setMode(bool value) {}

  @override
  void setReadonlyMode(bool isEnabled) {}

  @override
  void toggleReadonlyMode() {}
}

class _NoOpHaptic extends HapticNotifier {
  _NoOpHaptic(super.ref);

  @override
  dynamic selectionClick() => null;

  @override
  dynamic mediumImpact() => null;

  @override
  dynamic heavyImpact() => null;
}
