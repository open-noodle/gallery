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

  Future<void> pump(WidgetTester tester, RoundResult result, {VoidCallback? onNext}) {
    return tester.pumpConsumerWidget(
      RoundReveal(challengeId: 'c1', index: 0, result: result, onNext: onNext ?? () {}),
      overrides: [
        mapStateNotifierProvider.overrideWith(_FakeMapStateNotifier.new),
        localeProvider.overrideWithValue(const Locale('en')),
      ],
    );
  }

  testWidgets('a location reveal shows the map and the distance', (tester) async {
    await pump(
      tester,
      RoundResult(
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
      RoundResult(
        type: GameRoundType.date,
        score: 3640,
        offsetDays: 150,
        answer: GameRoundDetailResponseDtoAnswer(date: DateTime.utc(2019, 12, 1), lat: null, lon: null),
      ),
    );

    expect(find.byKey(const Key('round-reveal-timeline')), findsOneWidget);
    expect(find.byKey(const Key('round-reveal-map')), findsNothing);
    // Proves the {offset} placeholder actually resolved (pre-formatted "150 days").
    expect(find.textContaining('150 days'), findsOneWidget);
  });

  testWidgets('a 409 recovery renders with no guess pin and does not throw', (tester) async {
    await pump(
      tester,
      RoundResult(
        type: GameRoundType.location,
        score: 900,
        answer: GameRoundDetailResponseDtoAnswer(date: null, lat: 10, lon: 20),
      ),
    );

    expect(find.byKey(const Key('round-reveal-score')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Next fires once per tap', (tester) async {
    var taps = 0;
    await pump(
      tester,
      RoundResult(
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
}
