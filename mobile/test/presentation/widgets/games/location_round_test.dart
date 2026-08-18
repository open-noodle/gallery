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
import 'package:immich_mobile/presentation/widgets/games/guess_map.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/location_round.widget.dart';
import 'package:immich_mobile/providers/locale_provider.dart';
import 'package:immich_mobile/providers/map/map_state.provider.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

/// `LocationRound` embeds `GuessMap`, which wraps in `MapThemeOverride`. That reads
/// `mapStateNotifierProvider`, whose real `build()` reaches `appConfigProvider`
/// (`SettingsRepository.instance`) and `serverInfoProvider` — neither of which this widget test
/// wants to stand up. Overriding the notifier's `build()` sidesteps that whole chain, the same
/// way `test/modules/map/map_theme_override_test.dart` does.
class _FakeMapStateNotifier extends MapStateNotifier {
  @override
  MapState build() => const MapState(themeMode: ThemeMode.light, lightStyleFetched: AsyncData('mock-style'));
}

void main() {
  // getGameRoundImageUrl reads Store.get(StoreKey.serverEndpoint), which throws unless the Store
  // is initialized (mirrors the setup in people_grid_test.dart). MapThemeOverride additionally
  // reads immichThemeProvider, which reaches SettingsRepository.instance, so that needs
  // initializing too (mirrors space_people_page_test.dart).
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

  Future<void> pump(WidgetTester tester, {void Function({required double lat, required double lon})? onGuess}) {
    return tester.pumpConsumerWidget(
      LocationRound(
        challengeId: 'challenge-1',
        index: 1,
        roundNumber: 2,
        roundCount: 5,
        onGuess: onGuess ?? ({required lat, required lon}) {},
      ),
      overrides: [
        mapStateNotifierProvider.overrideWith(_FakeMapStateNotifier.new),
        localeProvider.overrideWithValue(const Locale('en')),
      ],
    );
  }

  testWidgets('opens as a split, with the map already visible', (tester) async {
    await pump(tester);

    expect(find.byKey(const Key('location-round-map')), findsOneWidget);
    expect(find.byKey(const Key('location-round-strip')), findsNothing);
  });

  testWidgets('the dismiss control collapses the map to a strip', (tester) async {
    await pump(tester);

    await tester.tap(find.byKey(const Key('location-round-dismiss')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('location-round-map')), findsNothing);
    expect(find.byKey(const Key('location-round-strip')), findsOneWidget);
  });

  testWidgets('tapping the strip restores the split', (tester) async {
    await pump(tester);
    await tester.tap(find.byKey(const Key('location-round-dismiss')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('location-round-strip')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('location-round-map')), findsOneWidget);
  });

  testWidgets('Guess is genuinely disabled until a pin exists', (tester) async {
    var guesses = 0;
    await pump(tester, onGuess: ({required lat, required lon}) => guesses++);

    final button = tester.widget<FilledButton>(find.byKey(const Key('location-round-guess')));
    expect(button.onPressed, isNull, reason: 'Disabled must mean disabled, not just greyed out');

    await tester.tap(find.byKey(const Key('location-round-guess')));
    await tester.pump();
    expect(guesses, 0);
  });

  testWidgets('a placed pin enables Guess and emits a wrapped longitude', (tester) async {
    double? emittedLon;
    await pump(tester, onGuess: ({required lat, required lon}) => emittedLon = lon);

    // A longitude past the antimeridian, as maplibre reports it when the map is panned.
    tester.state<LocationRoundState>(find.byType(LocationRound)).debugSetPin(lat: 48.85, lon: 200);
    await tester.pump();

    await tester.tap(find.byKey(const Key('location-round-guess')));
    await tester.pump();

    expect(emittedLon, closeTo(-160, 1e-9));
  });

  testWidgets('the round HUD resolves the round-progress placeholders instead of showing the raw key', (tester) async {
    await pump(tester);

    // pump() always passes roundNumber: 2, roundCount: 5. A wrong args key in the widget's
    // 'game_round_progress'.t(args: {...}) call renders the raw key instead of this text — .t()
    // swallows the MessageFormat failure silently.
    expect(find.text('Round 2 of 5'), findsOneWidget);
  });

  testWidgets("the map's own onTap wiring updates the pin — lat and lon land in the right places", (tester) async {
    double? emittedLat;
    double? emittedLon;
    await pump(
      tester,
      onGuess: ({required lat, required lon}) {
        emittedLat = lat;
        emittedLon = lon;
      },
    );

    // Drive the real GuessMap.onTap callback the widget wired up — not the debugSetPin seam — so
    // a dropped or lat/lon-swapped wiring line is caught. Values with different magnitudes so a
    // swap is unambiguous in the assertion below.
    final map = tester.widget<GuessMap>(find.byKey(const Key('location-round-map')));
    map.onTap(12.0, 34.0);
    await tester.pump();

    await tester.tap(find.byKey(const Key('location-round-guess')));
    await tester.pump();

    expect(emittedLat, 12.0);
    expect(emittedLon, 34.0);
  });

  testWidgets('dismissing and re-expanding the map preserves the placed pin', (tester) async {
    await pump(tester);

    tester.state<LocationRoundState>(find.byType(LocationRound)).debugSetPin(lat: 10.5, lon: -20.25);
    await tester.pump();

    await tester.tap(find.byKey(const Key('location-round-dismiss')));
    await tester.pumpAndSettle();

    // GuessMap unmounts while dismissed (it lives inside the if(_mapVisible) branch), so the
    // remounted instance must be freshly seeded from the parent's surviving _pin rather than
    // relying on its own internal state, which resets to nothing on every remount.
    await tester.tap(find.byKey(const Key('location-round-strip')));
    await tester.pumpAndSettle();

    final map = tester.widget<GuessMap>(find.byKey(const Key('location-round-map')));
    expect(map.initialPin, (lat: 10.5, lon: -20.25));
  });
}
