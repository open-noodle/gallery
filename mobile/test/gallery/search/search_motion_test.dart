import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_state.notifier.dart';
import 'package:immich_mobile/gallery/search/widgets/search_frame.widget.dart';

import 'search_mode_harness.dart';
import 'search_test_utils.dart';

// Search's motion (specs/2026-10-23-mobile-search-redesign-design.md, "Motion"), on the real Photos page. Each test
// looks at a frame in the middle of the movement, then at the settled frame: the movement happens, and it ends where
// the screen was before the motion existed.

/// How visible [finder] is: the product of every opacity above it.
double visibleOpacity(WidgetTester tester, Finder finder) {
  var opacity = 1.0;
  tester.element(finder).visitAncestorElements((element) {
    final widget = element.widget;
    if (widget is Opacity) {
      opacity *= widget.opacity;
    } else if (widget is FadeTransition) {
      opacity *= widget.opacity.value;
    }
    return true;
  });
  return opacity;
}

/// How much [finder] is scaled: the product of every Transform's scale above it.
double visibleScale(WidgetTester tester, Finder finder) {
  var scale = 1.0;
  tester.element(finder).visitAncestorElements((element) {
    final widget = element.widget;
    if (widget is Transform) {
      // The x scale (the matrix's first entry): Transform.scale leaves the z axis at 1.
      scale *= widget.transform.storage[0];
    }
    return true;
  });
  return scale;
}

const _frame = Duration(milliseconds: 16);

void main() {
  final database = SearchModeDatabase();

  setUpAll(database.setUpAll);
  tearDownAll(database.tearDownAll);

  late FakeSearchRepository repository;
  late ProviderContainer container;

  Future<void> pump(WidgetTester tester) async {
    await database.setUp();
    repository = FakeSearchRepository(FakeLibrary.standard);
    container = searchModeContainer(db: database.db, repository: repository);
    await pumpPhotosPage(tester, container);
  }

  Future<void> tapKey(WidgetTester tester, String key) async {
    await revealPlaceCity(tester, key);
    await tester.ensureVisible(find.byKey(Key(key)));
    await tester.pump();
    await tester.tap(find.byKey(Key(key)));
    await settleFrames(tester);
  }

  SearchStateNotifier search() => container.read(searchStateProvider.notifier);
  Finder byKey(String key) => find.byKey(Key(key));

  group('opening search mode', () {
    testWidgets('the field settles down into place and the chips cascade in, once', (tester) async {
      await pump(tester);
      container.read(searchModeProvider.notifier).enter();
      await tester.pump();
      await tester.pump(_frame);

      final fieldMid = tester.getTopLeft(byKey('search-mode-field')).dy;
      expect(visibleOpacity(tester, byKey('search-mode-field')), lessThan(1), reason: 'the field fades in');
      // The chips start one after another: the last one (Filters) has not started when the first is under way.
      expect(
        visibleOpacity(tester, byKey('search-chip-filters')),
        lessThan(visibleOpacity(tester, byKey('search-chip-people'))),
      );

      await settleFrames(tester);
      expect(
        tester.getTopLeft(byKey('search-mode-field')).dy,
        greaterThan(fieldMid),
        reason: 'it came down from above',
      );
      expect(visibleOpacity(tester, byKey('search-mode-field')), 1);
      expect(visibleOpacity(tester, byKey('search-chip-filters')), 1);

      // A filter rebuilds the header; the entrance does not play again.
      search().setFavoritesOnly(true);
      await tester.pump();
      await tester.pump(_frame);
      expect(visibleOpacity(tester, byKey('search-mode-field')), 1);
      expect(visibleOpacity(tester, byKey('search-chip-people')), 1);

      await disposePhotosPage(tester, container);
    });

    testWidgets('with reduced motion, the header fades in where it stands', (tester) async {
      tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(
        disableAnimations: true,
      );
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      await pump(tester);
      container.read(searchModeProvider.notifier).enter();
      // The entrance's first frame: under reduced motion Flutter runs animations at 5% speed, so later frames are
      // already at rest either way.
      await tester.pump();
      final fieldMid = tester.getTopLeft(byKey('search-mode-field'));

      await settleFrames(tester);
      expect(tester.getTopLeft(byKey('search-mode-field')), fieldMid, reason: 'no movement');

      await disposePhotosPage(tester, container);
    });
  });

  test('the entrance is claimed once per opening, so a header rebuilt while search stays open does not replay it', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final mode = container.read(searchModeProvider.notifier);
    expect(mode.claimEntrance(), isFalse, reason: 'not opened yet');
    mode.enter();
    expect(mode.claimEntrance(), isTrue);
    expect(mode.claimEntrance(), isFalse, reason: 'a second header build in the same opening');
    mode.enter();
    expect(mode.claimEntrance(), isFalse, reason: 'already open: enter does nothing');
    mode
      ..leave()
      ..enter();
    expect(mode.claimEntrance(), isTrue, reason: 'a new opening');
  });

  group('the chip row', () {
    testWidgets('an extra filter chip grows in and shrinks out, and Filters slides over', (tester) async {
      await pump(tester);
      await enterSearchMode(tester, container);
      final before = tester.getTopLeft(byKey('search-chip-filters')).dx;

      search().setFavoritesOnly(true);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 60));
      final during = tester.getTopLeft(byKey('search-chip-filters')).dx;
      await settleFrames(tester);
      final after = tester.getTopLeft(byKey('search-chip-filters')).dx;
      expect(during, greaterThan(before));
      expect(during, lessThan(after), reason: 'Filters slides over while the Favorites chip grows in');

      search().setFavoritesOnly(false);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 40));
      expect(byKey('search-extra-chip-favorites'), findsOneWidget, reason: 'still shrinking out');
      await settleFrames(tester);
      expect(byKey('search-extra-chip-favorites'), findsNothing);
      expect(tester.getTopLeft(byKey('search-chip-filters')).dx, before);

      await disposePhotosPage(tester, container);
    });

    testWidgets("the Filters badge pops when its count changes, and a chip's new label cross-fades in", (tester) async {
      await pump(tester);
      await enterSearchMode(tester, container);
      search().setFavoritesOnly(true);
      await settleFrames(tester);
      expect(visibleScale(tester, byKey('search-chip-filters-badge')), 1);

      search().setMinRating(3);
      await tester.pump();
      await tester.pump(_frame);
      expect(visibleScale(tester, byKey('search-chip-filters-badge')), lessThan(1));
      await settleFrames(tester);
      expect(visibleScale(tester, byKey('search-chip-filters-badge')), closeTo(1, 0.001));

      search().setPlace(const SearchPlace(country: 'Japan', city: 'Kyoto'));
      await tester.pump();
      await tester.pump(_frame);
      final kyoto = find.descendant(of: byKey('search-chip-places'), matching: find.text('Kyoto'));
      expect(visibleOpacity(tester, kyoto), lessThan(1));
      await settleFrames(tester);
      expect(visibleOpacity(tester, kyoto), 1);
      expect(find.descendant(of: byKey('search-chip-places'), matching: find.text('Places')), findsNothing);

      await disposePhotosPage(tester, container);
    });
  });

  group('while a search runs', () {
    testWidgets('the dim over the old photos wipes away when the answer lands, and the total rolls to it', (
      tester,
    ) async {
      await pump(tester);
      await enterSearchMode(tester, container);

      final held = repository.heldResults = Completer<void>();
      search().setPlace(const SearchPlace(country: 'Japan'));
      await settleFrames(tester, frames: 4);
      expect(byKey('search-mode-stale-scrim'), findsOneWidget);
      expect(
        find.descendant(of: find.byType(StaleResultsScrim), matching: find.byType(CustomPaint)),
        findsOneWidget,
        reason: 'the sheen sweeps the dim',
      );

      held.complete();
      repository.heldResults = null;
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(byKey('search-mode-stale-scrim'), findsNothing, reason: 'no longer waiting');
      expect(
        find.descendant(of: find.byType(StaleResultsScrim), matching: find.byType(ShaderMask)),
        findsOneWidget,
        reason: 'the dim is wiping away',
      );
      expect(byKey('search-mode-total'), findsNWidgets(2), reason: '"Searching…" rises out as the count rises in');

      await settleFrames(tester);
      expect(find.descendant(of: find.byType(StaleResultsScrim), matching: find.byType(ShaderMask)), findsNothing);
      expect(byKey('search-mode-total'), findsOneWidget);
      expect(find.text('Searching…'), findsNothing);

      await disposePhotosPage(tester, container);
    });

    testWidgets('with reduced motion, the dim has no sheen', (tester) async {
      tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(
        disableAnimations: true,
      );
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      await pump(tester);
      await enterSearchMode(tester, container);

      final held = repository.heldResults = Completer<void>();
      search().setPlace(const SearchPlace(country: 'Japan'));
      await settleFrames(tester, frames: 4);
      expect(byKey('search-mode-stale-scrim'), findsOneWidget);
      expect(find.descendant(of: find.byType(StaleResultsScrim), matching: find.byType(CustomPaint)), findsNothing);

      held.complete();
      repository.heldResults = null;
      await settleFrames(tester);
      await disposePhotosPage(tester, container);
    });
  });

  group('the field', () {
    testWidgets('a submitted query pops in as a token and shrinks away when removed', (tester) async {
      await pump(tester);
      await enterSearchMode(tester, container);

      search().submitText('beach');
      await tester.pump();
      await tester.pump(_frame);
      expect(visibleScale(tester, byKey('search-mode-query-token')), lessThan(1));
      await settleFrames(tester);
      expect(visibleScale(tester, byKey('search-mode-query-token')), closeTo(1, 0.001));

      search().clearQuery();
      await tester.pump();
      await tester.pump(_frame);
      expect(byKey('search-mode-query-token'), findsOneWidget, reason: 'still shrinking away');
      await settleFrames(tester);
      expect(byKey('search-mode-query-token'), findsNothing);

      await disposePhotosPage(tester, container);
    });

    testWidgets('the suggestions drop in from the field', (tester) async {
      await pump(tester);
      await enterSearchMode(tester, container);

      await tester.tap(byKey('search-mode-field'));
      await tester.pump();
      await tester.enterText(byKey('search-mode-field'), '@a');
      await tester.pump();
      await tester.pump(_frame);
      expect(visibleOpacity(tester, byKey('search-mode-suggestions')), lessThan(1));
      await settleFrames(tester);
      expect(visibleOpacity(tester, byKey('search-mode-suggestions')), 1);

      await disposePhotosPage(tester, container);
    });
  });

  group('the sheets', () {
    testWidgets('a Filters section folds away under its title, and the arrow turns back', (tester) async {
      await pump(tester);
      await enterSearchMode(tester, container);
      await tapKey(tester, 'search-chip-filters');
      final arrow = find.descendant(of: byKey('search-filter-toggle-camera'), matching: find.byType(AnimatedRotation));
      expect(tester.widget<AnimatedRotation>(arrow).turns, 0.5, reason: 'open: pointing up');

      await tester.tap(byKey('search-filter-toggle-camera'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 60));
      expect(byKey('search-filter-make-Apple'), findsOneWidget, reason: 'still folding away');
      expect(tester.widget<AnimatedRotation>(arrow).turns, 0);
      await settleFrames(tester);
      expect(byKey('search-filter-make-Apple'), findsNothing);

      await disposePhotosPage(tester, container);
    });

    testWidgets("a country's cities fold open under it", (tester) async {
      await pump(tester);
      await enterSearchMode(tester, container);
      await tapKey(tester, 'search-chip-places');
      final japan = tester.getBottomLeft(byKey('search-place-country-Japan')).dy;

      await tester.tap(byKey('search-place-cities-Japan'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 60));
      final opening = tester.getSize(byKey('search-place-fold-Japan')).height;
      await settleFrames(tester);
      final open = tester.getSize(byKey('search-place-fold-Japan')).height;
      expect(opening, greaterThan(0));
      expect(opening, lessThan(open), reason: 'the cities grow open');
      expect(tester.getTopLeft(byKey('search-place-fold-Japan')).dy, closeTo(japan, 0.5));

      await disposePhotosPage(tester, container);
    });

    testWidgets('picking a person pops a tick onto their face', (tester) async {
      await pump(tester);
      await enterSearchMode(tester, container);
      await tapKey(tester, 'search-chip-people');
      expect(byKey('search-person-selected-tick'), findsNothing);

      await tester.tap(byKey('search-sheet-person-person:anna'));
      await tester.pump();
      await tester.pump(_frame);
      debugPrint(
        'TICKS ${find.byKey(const Key('search-person-selected-tick')).evaluate().map((e) => visibleScale(tester, find.byElementPredicate((x) => x == e))).toList()}',
      );
      final tick = find.descendant(
        of: byKey('search-sheet-selected-person:anna'),
        matching: byKey('search-person-selected-tick'),
      );
      expect(tick, findsOneWidget);
      expect(visibleScale(tester, tick), lessThan(1));
      await settleFrames(tester);
      expect(visibleScale(tester, tick), closeTo(1, 0.001));

      await disposePhotosPage(tester, container);
    });
  });
}
