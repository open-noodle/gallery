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
import 'package:immich_mobile/pages/games/game_round_review.page.dart';
import 'package:immich_mobile/presentation/widgets/games/round_reveal.widget.dart';
import 'package:immich_mobile/providers/locale_provider.dart';
import 'package:immich_mobile/providers/map/map_state.provider.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

class _MockGameApiRepository extends Mock implements GameApiRepository {}

/// `GameRoundReviewPage` re-renders `RoundReveal`, which for a location round embeds `RevealMap`
/// wrapped in `MapThemeOverride`. That reads `mapStateNotifierProvider`, whose real `build()`
/// reaches `appConfigProvider` (`SettingsRepository.instance`) and `serverInfoProvider` — neither
/// of which this widget test wants to stand up. Overriding the notifier's `build()` sidesteps that
/// whole chain, mirroring `round_reveal_test.dart` / `game_play_page_test.dart`.
class _FakeMapStateNotifier extends MapStateNotifier {
  @override
  MapState build() => const MapState(themeMode: ThemeMode.light, lightStyleFetched: AsyncData('mock-style'));
}

GameChallengeDetailResponseDto _finishedChallenge() => GameChallengeDetailResponseDto(
  id: 'c1',
  spaceId: 's1',
  ownerId: null,
  name: 'Challenge 1',
  roundCount: 1,
  scaleKm: 1,
  scaleDays: 1,
  createdAt: DateTime.utc(2026, 8, 18),
  closedAt: null,
  dailyOn: null,
  rounds: [
    GameRoundDetailResponseDto(
      index: 0,
      type: GameRoundType.location,
      assetId: const Optional.present('asset-1'),
      score: const Optional.present(4182),
      answer: Optional.present(GameRoundDetailResponseDtoAnswer(date: null, lat: 41.15, lon: -8.61)),
      guess: Optional.present(
        GameRoundDetailResponseDtoGuess(lat: 38.72, lon: -9.14, date: null, distanceKm: 412.3, offsetDays: null),
      ),
    ),
  ],
);

void main() {
  // getGameRoundImageUrl / getGameRoundImageUrl-backed RemoteImageProvider (used by the reveal's
  // photo/map summary) reads Store.get(StoreKey.serverEndpoint), which throws unless the Store is
  // initialized. The location reveal additionally needs MapThemeOverride's SettingsRepository
  // wiring. Mirrors game_play_page_test.dart / round_reveal_test.dart.
  late Drift db;
  late _MockGameApiRepository repository;

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
    repository = _MockGameApiRepository();
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  Future<void> pump(WidgetTester tester, {int index = 0}) {
    return tester.pumpConsumerWidget(
      GameRoundReviewPage(challengeId: 'c1', index: index),
      overrides: [
        gameApiRepositoryProvider.overrideWithValue(repository),
        mapStateNotifierProvider.overrideWith(_FakeMapStateNotifier.new),
        localeProvider.overrideWithValue(const Locale('en')),
      ],
    );
  }

  testWidgets('a resolved session renders the reveal for the requested round', (tester) async {
    when(() => repository.getChallenge('c1')).thenAnswer((_) async => _finishedChallenge());

    await pump(tester);

    expect(find.byType(RoundReveal), findsOneWidget);
    // Proves the round that was actually requested (index 0) is what got mapped through
    // RoundResult.fromRound, not merely that SOME reveal rendered.
    expect(find.byKey(const Key('round-reveal-score')), findsOneWidget);
    expect(find.text('4182 pts'), findsOneWidget);
    expect(find.byKey(const Key('round-review-retry')), findsNothing);
  });

  testWidgets('a failed session renders the retry control rather than spinning forever', (tester) async {
    when(() => repository.getChallenge('c1')).thenThrow(Exception('offline'));

    await pump(tester);

    expect(find.byKey(const Key('round-review-retry')), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.byType(RoundReveal), findsNothing);
  });

  testWidgets('tapping retry re-runs the fetch', (tester) async {
    var calls = 0;
    when(() => repository.getChallenge('c1')).thenAnswer((_) async {
      calls++;
      if (calls == 1) throw Exception('offline');
      return _finishedChallenge();
    });

    await pump(tester);

    expect(find.byKey(const Key('round-review-retry')), findsOneWidget);

    await tester.tap(find.byKey(const Key('round-review-retry')));
    await tester.pumpAndSettle();

    expect(calls, 2);
    expect(find.byType(RoundReveal), findsOneWidget);
    expect(find.byKey(const Key('round-review-retry')), findsNothing);
  });
}
