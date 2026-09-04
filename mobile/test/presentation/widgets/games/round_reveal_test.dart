import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/map/map_state.model.dart';
import 'package:immich_mobile/presentation/widgets/games/reveal_map.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/round_photo_placeholder.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/round_reveal.widget.dart';
import 'package:immich_mobile/providers/game/game_session.provider.dart';
import 'package:immich_mobile/providers/locale_provider.dart';
import 'package:immich_mobile/providers/map/map_state.provider.dart';
import 'package:openapi/api.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

/// `RoundReveal` embeds `RevealMap` for location rounds, which wraps in `MapThemeOverride`. That
/// reads `mapStateNotifierProvider`, whose real `build()` reaches `appConfigProvider`
/// (`SettingsRepository.instance`) and `serverInfoProvider` — neither of which this widget test
/// wants to stand up. Overriding the notifier's `build()` sidesteps that whole chain, exactly as
/// `location_round_test.dart` (task 6's sibling map) does.
class _FakeMapStateNotifier extends MapStateNotifier {
  @override
  MapState build() => const MapState(themeMode: ThemeMode.light, lightStyleFetched: AsyncData('mock-style'));
}

void main() {
  // getGameRoundImageUrl (used by the date reveal's dimmed photo) reads
  // Store.get(StoreKey.serverEndpoint), which throws unless the Store is initialized. The location
  // reveal's map additionally needs MapThemeOverride's SettingsRepository wiring. Mirrors
  // location_round_test.dart / date_round_test.dart.
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
    await SettingsRepository.ensureInitialized(db);
  });

  setUp(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  Future<void> pump(WidgetTester tester, {RoundResult? result, bool reviewing = false, VoidCallback? onNext}) {
    return tester.pumpConsumerWidget(
      RoundReveal(
        challengeId: 'c1',
        index: 0,
        // Only the reviewing-mode test omits `result`; every other call still supplies its own.
        result:
            result ??
            RoundResult(
              type: GameRoundType.location,
              score: 900,
              answer: GameRoundDetailResponseDtoAnswer(date: null, lat: 10, lon: 20),
            ),
        reviewing: reviewing,
        onNext: onNext ?? () {},
      ),
      overrides: [
        mapStateNotifierProvider.overrideWith(_FakeMapStateNotifier.new),
        localeProvider.overrideWithValue(const Locale('en')),
      ],
    );
  }

  testWidgets('a location reveal shows the map and the distance', (tester) async {
    await pump(
      tester,
      result: RoundResult(
        type: GameRoundType.location,
        score: 4182,
        distanceKm: 38,
        answer: GameRoundDetailResponseDtoAnswer(date: null, lat: 36.9, lon: -4.5),
        guess: (lat: 37.2, lon: -4.1),
      ),
    );

    expect(find.byKey(const Key('round-reveal-map')), findsOneWidget);
    expect(find.byKey(const Key('round-reveal-timeline')), findsNothing);
    // Proves the {distance} placeholder actually resolved rather than `.t()` silently falling back
    // to the raw 'game_you_were_away' key on a wrong args name.
    expect(find.textContaining('38 km'), findsOneWidget);
  });

  testWidgets('a date reveal shows the timeline strip, not a map it has no use for', (tester) async {
    await pump(
      tester,
      result: RoundResult(
        type: GameRoundType.date,
        score: 3640,
        offsetDays: 150,
        answer: GameRoundDetailResponseDtoAnswer(date: DateTime.utc(2019, 12, 1), lat: null, lon: null),
        guessDate: DateTime.utc(2019, 7, 1),
      ),
    );

    expect(find.byKey(const Key('round-reveal-timeline')), findsOneWidget);
    expect(find.byKey(const Key('round-reveal-map')), findsNothing);
    // Proves the {offset} placeholder actually resolved (pre-formatted "150 days").
    expect(find.textContaining('150 days'), findsOneWidget);
  });

  // The strip used to carry at most the offset and the answer month: the player's own guess was
  // never plumbed onto RoundResult at all, so "150 days off" was a number with nothing to check
  // it against. Both markers, both labelled.
  testWidgets('a date reveal shows the guess and the answer, both labelled', (tester) async {
    await pump(
      tester,
      result: RoundResult(
        type: GameRoundType.date,
        score: 3640,
        offsetDays: 150,
        answer: GameRoundDetailResponseDtoAnswer(date: DateTime.utc(2019, 12, 1), lat: null, lon: null),
        guessDate: DateTime.utc(2019, 7, 1),
      ),
    );

    expect(find.byKey(const Key('round-reveal-date-guess')), findsOneWidget);
    expect(find.byKey(const Key('round-reveal-date-answer')), findsOneWidget);
    expect(find.text('July 2019'), findsOneWidget, reason: 'The month the player picked');
    expect(find.text('December 2019'), findsOneWidget, reason: 'The month the photo was actually taken');
    // The labels come from the existing game_guess/game_actual keys web's reveal already uses;
    // asserting the resolved text catches a raw key left on screen by a bad lookup.
    expect(find.text('Guess'), findsOneWidget);
    expect(find.text('Actual'), findsOneWidget);
  });

  testWidgets('a date reveal with no guess of ours still shows the answer', (tester) async {
    // The 409 recovery path for a date round: that request never reached the server, so there is
    // no guess to mark — the same asymmetry RevealMap handles for location rounds.
    await pump(
      tester,
      result: RoundResult(
        type: GameRoundType.date,
        score: 900,
        answer: GameRoundDetailResponseDtoAnswer(date: DateTime.utc(2019, 12, 1), lat: null, lon: null),
      ),
    );

    expect(find.byKey(const Key('round-reveal-date-guess')), findsNothing);
    expect(find.byKey(const Key('round-reveal-date-answer')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a 409 recovery renders with no guess pin and does not throw', (tester) async {
    await pump(
      tester,
      result: RoundResult(
        type: GameRoundType.location,
        score: 900,
        answer: GameRoundDetailResponseDtoAnswer(date: null, lat: 10, lon: 20),
      ),
    );

    expect(find.byKey(const Key('round-reveal-score')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed post-guess refetch (answer null, guess real) renders without a fabricated answer pin', (
    tester,
  ) async {
    // Distinct from the 409-recovery case above: here `guess` survives and `answer` is the one
    // that's null (GameSessionController._reveal keeps the stale pre-guess challenge when the
    // refetch fails, so the round's answer never arrives). round_reveal.widget.dart must pass
    // that null straight through to RevealMap rather than substituting (0, 0) — substituting
    // would draw the "actual location" circle at Null Island as if it were the real answer.
    await pump(
      tester,
      result: const RoundResult(type: GameRoundType.location, score: 2200, guess: (lat: 48.85, lon: 2.35)),
    );

    expect(find.byKey(const Key('round-reveal-score')), findsOneWidget);
    expect(tester.takeException(), isNull);

    // RevealMap only ever requests an answer-circle draw when `answer` is non-null (see its
    // `_draw()`); asserting the null survived the handoff from RoundReveal is therefore the
    // available proxy for "no answer annotation is requested" — MapLibre's own onMapCreated/
    // onStyleLoadedCallback never fire in this widget-test harness (no real platform view), so
    // `_draw()` itself cannot be exercised or spied on here.
    final map = tester.widget<RevealMap>(find.byKey(const Key('round-reveal-map')));
    expect(map.answer, isNull);
    expect(map.guess, (lat: 48.85, lon: 2.35));
  });

  // The spec requires that a round whose asset was deleted server-side "renders without the photo
  // rather than erroring". Without an errorBuilder the 404 throws into the framework and paints a
  // blank/error area. The builder is invoked directly: RemoteImageProvider's load never resolves
  // (or fails) deterministically inside a widget test, so driving a real 404 here would assert
  // nothing reliable - invoking the callback proves both that it exists and what it paints.
  testWidgets('the date reveal photo falls back to a neutral placeholder when the photo cannot be loaded', (
    tester,
  ) async {
    await pump(
      tester,
      result: RoundResult(
        type: GameRoundType.date,
        score: 3640,
        offsetDays: 150,
        answer: GameRoundDetailResponseDtoAnswer(date: DateTime.utc(2019, 12, 1), lat: null, lon: null),
      ),
    );

    final image = tester.widget<Image>(find.byKey(const Key('round-reveal-photo')));
    expect(image.errorBuilder, isNotNull, reason: 'A deleted asset 404s and would otherwise throw into the framework');

    await tester.pumpWidget(
      MaterialApp(home: Builder(builder: (context) => image.errorBuilder!(context, Exception('404'), null))),
    );
    await tester.pumpAndSettle();

    expect(find.byType(RoundPhotoPlaceholder), findsOneWidget);
    expect(find.byIcon(Icons.image_not_supported_outlined), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Next fires once per tap', (tester) async {
    var taps = 0;
    await pump(
      tester,
      result: RoundResult(
        type: GameRoundType.location,
        score: 10,
        answer: GameRoundDetailResponseDtoAnswer(date: null, lat: 1, lon: 1),
      ),
      onNext: () => taps++,
    );

    await tester.tap(find.byKey(const Key('round-reveal-next')));
    await tester.pump();

    expect(taps, 1);
  });

  testWidgets('review mode offers Done instead of Next round', (tester) async {
    var popped = 0;
    await pump(tester, reviewing: true, onNext: () => popped++);

    expect(find.text('Done'), findsOneWidget);
    expect(find.text('Next round'), findsNothing);

    await tester.tap(find.byKey(const Key('round-reveal-next')));
    await tester.pumpAndSettle();
    expect(popped, 1);
  });
}
