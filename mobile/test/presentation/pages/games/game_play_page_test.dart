import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/map/map_state.model.dart';
import 'package:immich_mobile/pages/games/game_play.page.dart';
import 'package:immich_mobile/presentation/widgets/games/date_round.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/location_round.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/standings_section.widget.dart';
import 'package:immich_mobile/providers/game/daily_reminder.provider.dart';
import 'package:immich_mobile/providers/locale_provider.dart';
import 'package:immich_mobile/providers/map/map_state.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../test_helpers/wire_dates.dart';
import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

class _MockGameApiRepository extends Mock implements GameApiRepository {}

class _MockDailyReminderController extends Mock implements DailyReminderController {}

class _MockUserService extends Mock implements UserService {}

/// Test-local stand-in for the real [CurrentUserProvider] — the completion screen reads it to bold
/// the player's own leaderboard row. Copied from `space_games_page_test.dart`: the real notifier's
/// constructor calls `tryGetMyUser()`/`watchMyUser()` on a `UserService` backed by Isar/Drift,
/// which this widget test never stands up, and a bare unstubbed mock crashes on `watchMyUser()`'s
/// non-nullable `Stream<UserDto?>` return type.
class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier([UserDto? initial]) : super(_noopUserService()) {
    state = initial;
  }

  static UserService _noopUserService() {
    final service = _MockUserService();
    when(() => service.tryGetMyUser()).thenReturn(null);
    when(() => service.watchMyUser()).thenAnswer((_) => const Stream<UserDto?>.empty());
    return service;
  }
}

UserDto _user(String id) => UserDto(id: id, email: '$id@example.com', name: id, profileChangedAt: DateTime(2024));

/// `GamePlayPage` renders `LocationRound` for a location round, which embeds `GuessMap` and wraps
/// in `MapThemeOverride`. That reads `mapStateNotifierProvider`, whose real `build()` reaches
/// `appConfigProvider` (`SettingsRepository.instance`) and `serverInfoProvider` — neither of which
/// this widget test wants to stand up. Overriding the notifier's `build()` sidesteps that whole
/// chain, exactly as `location_round_test.dart` does.
class _FakeMapStateNotifier extends MapStateNotifier {
  @override
  MapState build() => const MapState(themeMode: ThemeMode.light, lightStyleFetched: AsyncData('mock-style'));
}

GameChallengeDetailResponseDto _challenge(GameRoundType type) => GameChallengeDetailResponseDto(
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
  rounds: [GameRoundDetailResponseDto(index: 0, type: type)],
);

// Every round already carries a score, so `firstUnansweredIndex` finds nothing and
// `GameSessionController.build()` resumes straight into `GamePhase.finished` with
// `currentIndex == rounds.length` — `currentRound` is therefore null from the very first frame,
// with no guess or reveal step in between. Exercises the resume-already-finished path, distinct
// from `next()` reaching `finished` in-session (covered by the provider's own unit tests).
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
  rounds: [GameRoundDetailResponseDto(index: 0, type: GameRoundType.location, score: const Optional.present(100))],
);

// A DAILY challenge (non-null `dailyOn`), single round, so one guess reaches `finished`. The
// `answered` flag models the pre- vs post-guess refetch inside `_reveal` — `getChallenge` is
// called twice per guess, unanswered then answered, mirroring `daily_reminder_triggers_test.dart`.
GameChallengeDetailResponseDto _dailyChallenge({required bool answered}) => GameChallengeDetailResponseDto(
  id: 'c1',
  spaceId: 's1',
  ownerId: null,
  name: 'Daily',
  roundCount: 1,
  scaleKm: 1,
  scaleDays: 1,
  createdAt: DateTime.utc(2026, 8, 18),
  closedAt: null,
  dailyOn: wireDateOnly('2026-08-18'),
  rounds: [
    GameRoundDetailResponseDto(
      index: 0,
      type: GameRoundType.location,
      score: answered ? const Optional.present(10) : const Optional.absent(),
    ),
  ],
);

void main() {
  // getGameRoundImageUrl (used by both round surfaces) reads Store.get(StoreKey.serverEndpoint),
  // which throws unless the Store is initialized (mirrors location_round_test.dart /
  // round_reveal_test.dart). The location round additionally needs MapThemeOverride's
  // SettingsRepository wiring.
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

  /// `ImmichToast` schedules a 3s fluttertoast Timer outside the frame scheduler, so a plain
  /// `pumpAndSettle()` leaves it pending and teardown fails with "A Timer is still pending". Pump
  /// past its lifetime instead. Mirrors `space_edit_sheet_test.dart`.
  Future<void> settleToast(WidgetTester tester) async {
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
  }

  Future<void> pump(WidgetTester tester, {List<Override> extraOverrides = const []}) {
    return tester.pumpConsumerWidget(
      const GamePlayPage(challengeId: 'c1'),
      overrides: [
        gameApiRepositoryProvider.overrideWithValue(repository),
        mapStateNotifierProvider.overrideWith(_FakeMapStateNotifier.new),
        localeProvider.overrideWithValue(const Locale('en')),
        currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(_user('u1'))),
        ...extraOverrides,
      ],
    );
  }

  testWidgets('a location round renders the location surface', (tester) async {
    when(() => repository.getChallenge('c1')).thenAnswer((_) async => _challenge(GameRoundType.location));

    await pump(tester);

    expect(find.byType(LocationRound), findsOneWidget);
    expect(find.byType(DateRound), findsNothing);

    // Proves the page wires currentIndex/rounds.length into LocationRound's roundNumber/roundCount
    // correctly, not just that LocationRound itself can resolve 'game_round_progress' in isolation
    // (already covered by location_round_test.dart) — a swapped or off-by-one arg here would still
    // render SOME text, just the wrong one, since .t() only falls back to the raw key on a wrong
    // arg NAME, not a wrong arg VALUE.
    expect(find.text('Round 1 of 1'), findsOneWidget);
  });

  testWidgets('a date round renders the wheel surface', (tester) async {
    when(() => repository.getChallenge('c1')).thenAnswer((_) async => _challenge(GameRoundType.date));

    await pump(tester);

    expect(find.byType(DateRound), findsOneWidget);
    expect(find.byType(LocationRound), findsNothing);
  });

  testWidgets('a challenge with every round already answered shows the completion screen', (tester) async {
    when(() => repository.getChallenge('c1')).thenAnswer((_) async => _finishedChallenge());
    when(() => repository.getLeaderboard('c1')).thenAnswer((_) async => GameLeaderboardResponseDto(entries: []));

    await pump(tester);

    // `GamePhase.finished` always implies `currentRound == null` (both the resume path and
    // `next()` move `currentIndex` past the last round) -- the page branches on the null round,
    // not the phase enum, so this proves that branch actually renders the completion text rather
    // than re-showing a guess surface for the round just answered.
    expect(find.text('Completed'), findsOneWidget);
    expect(find.byType(LocationRound), findsNothing);
    expect(find.byType(DateRound), findsNothing);
  });

  testWidgets('the completion screen renders the leaderboard the session already fetched', (tester) async {
    when(() => repository.getChallenge('c1')).thenAnswer((_) async => _finishedChallenge());
    when(() => repository.getLeaderboard('c1')).thenAnswer(
      (_) async => GameLeaderboardResponseDto(
        entries: [
          GameLeaderboardResponseDtoEntriesInner(userId: 'u1', name: 'Alice', total: 4200, answered: 1),
          GameLeaderboardResponseDtoEntriesInner(userId: 'u2', name: 'Bob', total: 4200, answered: 1),
          GameLeaderboardResponseDtoEntriesInner(userId: 'u3', name: 'Cy', total: 0, answered: 0),
        ],
      ),
    );

    await pump(tester);

    // The provider has stored `leaderboard` since task 3; until now nothing read it, so the
    // completion screen was a bare "Completed" line with the fetched board thrown away.
    expect(find.byKey(const Key('game-leaderboard-row-u1')), findsOneWidget);
    expect(find.byKey(const Key('game-leaderboard-row-u2')), findsOneWidget);
    expect(find.byKey(const Key('game-leaderboard-row-u3')), findsOneWidget);
    expect(find.byType(StandingsRow), findsNWidgets(3));

    final rows = tester.widgetList(find.byType(StandingsRow)).cast<StandingsRow>().toList();
    expect(rows.map((row) => row.userId), ['u1', 'u2', 'u3'], reason: 'A client-side re-sort would disturb this');
    expect(rows.map((row) => row.rank), [1, 1, 3], reason: 'Tied totals share a place');
    expect(rows.singleWhere((row) => row.isMe).userId, 'u1');
    // A player who never turned up shows a dash, not a zero score.
    expect(rows.last.value, '—');
    // Proves the {score}/{answered}/{total} placeholders resolved rather than `.t()` silently
    // falling back to the raw key on a wrong arg name.
    expect(find.text('4200 pts'), findsNWidgets(2));
    expect(find.text('1 of 1 rounds answered'), findsNWidgets(2));
  });

  testWidgets('a completion with no leaderboard still shows the completion line', (tester) async {
    when(() => repository.getChallenge('c1')).thenAnswer((_) async => _finishedChallenge());
    // `_safeLeaderboard` swallows the failure, leaving `leaderboard` null: the completion screen
    // must degrade to the bare line rather than throwing on a null board.
    when(() => repository.getLeaderboard('c1')).thenThrow(Exception('offline'));

    await pump(tester);

    expect(find.text('Completed'), findsOneWidget);
    expect(find.byType(StandingsRow), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a load failure shows a retry rather than an endless spinner', (tester) async {
    when(() => repository.getChallenge('c1')).thenThrow(Exception('offline'));

    await pump(tester);

    expect(find.byKey(const Key('game-play-retry')), findsOneWidget);
  });

  testWidgets('a failed guess surfaces lastError as a visible message rather than a dead button', (tester) async {
    when(() => repository.getChallenge('c1')).thenAnswer((_) async => _challenge(GameRoundType.location));
    when(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).thenThrow(Exception('offline'));

    await pump(tester);

    tester.state<LocationRoundState>(find.byType(LocationRound)).debugSetPin(lat: 48.85, lon: 2.35);
    await tester.pump();

    await tester.tap(find.byKey(const Key('location-round-guess')));
    await tester.pumpAndSettle();

    // Proves the message came from the localized 'game_guess_failed' key resolving, not from the
    // raw key rendering because of a wrong args name (.t() swallows a MessageFormat failure
    // silently and would otherwise leave the raw key on screen unnoticed).
    expect(find.text('Could not submit your guess'), findsOneWidget);

    // The round stays guessable: a failed guess must not strand the player mid-round.
    expect(find.byType(LocationRound), findsOneWidget);

    await settleToast(tester);
  });

  // The rest of this file drives GamePlayPage entirely through gameApiRepositoryProvider/
  // mapStateNotifierProvider — it never touches `dailyReminderProvider`, so it stays silent about
  // whether the page wires `GameSessionController.onDailyCompleted` at all. This test is the one
  // that would go red if that wiring (game_play.page.dart, the `ref.read(...).onDailyCompleted =
  // ...` line) were ever deleted: unlike daily_reminder_triggers_test.dart, it does NOT assign
  // `onDailyCompleted` itself — only the page may do that — so a call to `recordDailyCompleted`
  // proves the page's own wiring ran, not the controller's callback contract in isolation.
  testWidgets('finishing a daily reports its completion to the reminder', (tester) async {
    final reminder = _MockDailyReminderController();
    when(() => reminder.recordDailyCompleted(any(), isSolo: any(named: 'isSolo'))).thenAnswer((_) async {});

    var fetches = 0;
    when(() => repository.getChallenge('c1')).thenAnswer((_) async {
      fetches++;
      return _dailyChallenge(answered: fetches > 1);
    });
    when(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).thenAnswer(
      (_) async => GameGuessResponseDto(
        roundId: 'r',
        userId: 'u',
        score: 10,
        distanceKm: null,
        guessDate: null,
        guessLat: null,
        guessLon: null,
        offsetDays: null,
      ),
    );
    when(() => repository.getLeaderboard('c1')).thenAnswer((_) async => GameLeaderboardResponseDto(entries: []));

    await pump(tester, extraOverrides: [dailyReminderProvider.overrideWithValue(reminder)]);

    tester.state<LocationRoundState>(find.byType(LocationRound)).debugSetPin(lat: 48.85, lon: 2.35);
    await tester.pump();

    await tester.tap(find.byKey(const Key('location-round-guess')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('round-reveal-next')));
    await tester.pumpAndSettle();

    // _dailyChallenge above sets spaceId: 's1', so this is a SPACE daily, not solo.
    verify(() => reminder.recordDailyCompleted(wireDateOnly('2026-08-18'), isSolo: false)).called(1);
  });
}
