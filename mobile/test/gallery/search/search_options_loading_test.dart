import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';

import 'search_mode_harness.dart';
import 'search_test_utils.dart';

// The field's suggestions and the chip sheets while an options list is still on its way, and after its request failed
// (specs/2026-10-23-mobile-search-redesign-design.md, "The search field", "The chip sheets"): a list on its way shows
// a skeleton, never "Nothing left that matches"; a failed one an error with Retry, never an endless skeleton.

void main() {
  final database = SearchModeDatabase();

  setUpAll(database.setUpAll);
  tearDownAll(database.tearDownAll);

  late FakeSearchRepository repository;
  late ProviderContainer container;

  const nothingMatches = 'Nothing left that matches';
  final suggestionsLoading = find.byKey(const Key('search-suggestions-loading'));
  final suggestionsError = find.byKey(const Key('search-suggestions-error'));
  final sheetSkeleton = find.byKey(const Key('search-sheet-skeleton'));
  final sheetError = find.byKey(const Key('search-sheet-error'));

  /// The Photos page with [repository] set up by [prepare] before search mode first asks for options.
  Future<void> pump(WidgetTester tester, {void Function(FakeSearchRepository)? prepare}) async {
    await database.setUp();
    repository = FakeSearchRepository(FakeLibrary.standard);
    container = searchModeContainer(db: database.db, repository: repository);
    await pumpPhotosPage(tester, container);
    prepare?.call(repository);
    await enterSearchMode(tester, container);
  }

  Future<void> typeInField(WidgetTester tester, String text) async {
    await tester.tap(find.byKey(const Key('search-mode-field')));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('search-mode-field')), text);
    await settleFrames(tester);
  }

  Future<void> tapKey(WidgetTester tester, String key) async {
    await revealPlaceCity(tester, key);
    await tester.ensureVisible(find.byKey(Key(key)));
    await tester.pump();
    await tester.tap(find.byKey(Key(key)));
    await settleFrames(tester);
  }

  group('field suggestions while a list is on its way', () {
    testWidgets('@ before the people arrive shows a loading row; the people then appear without more typing', (
      tester,
    ) async {
      final people = Completer<void>();
      await pump(tester, prepare: (r) => r.held[SearchDimension.people] = people);

      await typeInField(tester, '@');
      expect(find.byKey(const Key('search-mode-suggestions')), findsOneWidget);
      expect(suggestionsLoading, findsOneWidget);
      expect(find.text(nothingMatches), findsNothing);

      people.complete();
      await settleFrames(tester);

      expect(find.byKey(const Key('search-suggestion-person-person:anna')), findsOneWidget);
      expect(find.byKey(const Key('search-suggestion-person-person:ben')), findsOneWidget);
      expect(suggestionsLoading, findsNothing);
      expect(find.text(nothingMatches), findsNothing);

      await disposePhotosPage(tester, container);
    });

    testWidgets('@zzz with the people loaded matches nobody: "Nothing left that matches"', (tester) async {
      await pump(tester);

      await typeInField(tester, '@zzz');
      expect(find.text(nothingMatches), findsOneWidget);
      expect(suggestionsLoading, findsNothing);

      await disposePhotosPage(tester, container);
    });

    testWidgets('# before the tags arrive shows a loading row; the tags then appear; #zzz matches none', (
      tester,
    ) async {
      final tags = Completer<void>();
      await pump(tester, prepare: (r) => r.held[SearchDimension.tags] = tags);

      await typeInField(tester, '#');
      expect(suggestionsLoading, findsOneWidget);
      expect(find.text(nothingMatches), findsNothing);

      tags.complete();
      await settleFrames(tester);
      expect(find.byKey(const Key('search-suggestion-tag-beach')), findsOneWidget);
      expect(suggestionsLoading, findsNothing);

      await typeInField(tester, '#zzz');
      expect(find.text(nothingMatches), findsOneWidget);
      expect(suggestionsLoading, findsNothing);

      await disposePhotosPage(tester, container);
    });

    testWidgets('plain text while the lists load offers the smart search at once, with a loading row', (tester) async {
      final people = Completer<void>();
      final places = Completer<void>();
      await pump(
        tester,
        prepare: (r) => r
          ..held[SearchDimension.people] = people
          ..held[SearchDimension.places] = places,
      );

      await typeInField(tester, 'an');
      expect(find.byKey(const Key('search-suggestion-smart')), findsOneWidget);
      expect(suggestionsLoading, findsOneWidget);

      people.complete();
      places.complete();
      await settleFrames(tester);
      expect(find.byKey(const Key('search-suggestion-person-person:anna')), findsOneWidget);
      expect(find.byKey(const Key('search-suggestion-smart')), findsOneWidget);
      expect(suggestionsLoading, findsNothing);

      await disposePhotosPage(tester, container);
    });
  });

  group('failed options requests', () {
    testWidgets('@ after the people request failed shows an error with Retry; Retry brings the people', (tester) async {
      await pump(tester, prepare: (r) => r.failing.add(SearchDimension.people));

      await typeInField(tester, '@');
      expect(suggestionsError, findsOneWidget);
      expect(find.byKey(const Key('search-suggestions-retry')), findsOneWidget);
      expect(suggestionsLoading, findsNothing);
      expect(find.text(nothingMatches), findsNothing);

      repository.failing.clear();
      final asked = repository.calls.length;
      await tester.tap(find.byKey(const Key('search-suggestions-retry')));
      await settleFrames(tester);

      expect(repository.calls.skip(asked), contains('options people'));
      expect(find.byKey(const Key('search-suggestion-person-person:anna')), findsOneWidget);
      expect(suggestionsError, findsNothing);

      await disposePhotosPage(tester, container);
    });

    testWidgets('the When sheet after its request failed shows an error with Retry, not an endless skeleton', (
      tester,
    ) async {
      await pump(tester, prepare: (r) => r.failing.add(SearchDimension.time));

      await tapKey(tester, 'search-chip-when');
      expect(sheetError, findsOneWidget);
      expect(find.byKey(const Key('search-sheet-retry')), findsOneWidget);
      expect(sheetSkeleton, findsNothing);

      repository.failing.clear();
      final asked = repository.calls.length;
      await tapKey(tester, 'search-sheet-retry');

      expect(repository.calls.skip(asked), contains('options time'));
      expect(find.byKey(const Key('search-when-year-2024')), findsOneWidget);
      expect(sheetError, findsNothing);
      expect(sheetSkeleton, findsNothing);

      await disposePhotosPage(tester, container);
    });

    testWidgets('a failed availability request leaves the chip row usable; the sheets offer Retry', (tester) async {
      await pump(tester, prepare: (r) => r.failAvailability = true);

      for (final chip in ['people', 'when', 'places', 'tags', 'filters']) {
        expect(find.byKey(Key('search-chip-$chip')), findsOneWidget, reason: chip);
      }

      await tapKey(tester, 'search-chip-people');
      expect(sheetError, findsOneWidget);
      expect(sheetSkeleton, findsNothing);

      repository.failAvailability = false;
      await tapKey(tester, 'search-sheet-retry');

      expect(find.byKey(const Key('search-sheet-person-person:anna')), findsOneWidget);
      expect(sheetError, findsNothing);
      // The results never failed: the button keeps its count.
      expect(
        find.descendant(of: find.byKey(const Key('search-sheet-show')), matching: find.text('Show 7 photos')),
        findsOneWidget,
      );

      await disposePhotosPage(tester, container);
    });
  });
}
