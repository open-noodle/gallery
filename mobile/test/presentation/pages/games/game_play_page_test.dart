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
import 'package:immich_mobile/repositories/solo_game_api.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../test_helpers/fake_stack_router.dart';
import '../../../test_helpers/wire_dates.dart';
import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

class _MockGameApiRepository extends Mock implements GameApiRepository {}

class _MockSoloGameApiRepository extends Mock implements SoloGameApiRepository {}

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

// The solo twin of `_finishedChallenge`: `spaceId` null and `ownerId` set, which is the scope
// discriminator the page branches its ending on (game_challenge_scope_chk keeps exactly one of the
// two non-null). Two rounds, both scored, so the total is a sum rather than a single round's score
// — a screen that rendered one round's points would pass on a one-round fixture.
GameChallengeDetailResponseDto _finishedSoloChallenge({GameRoundType type = GameRoundType.location}) =>
    GameChallengeDetailResponseDto(
      id: 'c1',
      spaceId: null,
      ownerId: 'u1',
      name: 'Mixed',
      roundCount: 2,
      scaleKm: 1,
      scaleDays: 1,
      createdAt: DateTime.utc(2026, 8, 18),
      closedAt: null,
      dailyOn: null,
      rounds: [
        GameRoundDetailResponseDto(index: 0, type: type, score: const Optional.present(4200)),
        GameRoundDetailResponseDto(index: 1, type: type, score: const Optional.present(14220)),
      ],
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
    // mocktail needs a fallback instance for a non-primitive type before `any(named: 'type')` can
    // stand in for it.
    registerFallbackValue(GameChallengeType.mixed);
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

  /// [router] is only needed by the solo-ending tests: "Play again" pushes the play route, and
  /// without a router in the tree that push throws into the zone as an unhandled async error
  /// rather than failing on an assertion.
  Future<void> pump(WidgetTester tester, {List<Override> extraOverrides = const [], FakeStackRouter? router}) {
    return tester.pumpConsumerWidget(
      router == null
          ? const GamePlayPage(challengeId: 'c1')
          : withFakeRouter(router, const GamePlayPage(challengeId: 'c1')),
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

  testWidgets('a finished space game lists its rounds under the leaderboard', (tester) async {
    when(() => repository.getChallenge('c1')).thenAnswer((_) async => _finishedChallenge());
    when(() => repository.getLeaderboard('c1')).thenAnswer(
      (_) async => GameLeaderboardResponseDto(
        entries: [GameLeaderboardResponseDtoEntriesInner(userId: 'u1', name: 'Alice', total: 100, answered: 1)],
      ),
    );

    await pump(tester);

    expect(find.byKey(const Key('game-leaderboard-row-u1')), findsOneWidget);
    expect(find.byKey(const Key('round-review-list')), findsOneWidget);
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

  // Design §11 does not reuse `game-leaderboard` for solo, and the server's one-row solo board
  // exists only so the "404 for strangers" rule is not vacuous — the recorded expectation was that
  // no client would render it. Mobile did: "Completed", a Leaderboard heading, and a single row
  // ranked 1 of 1 and flagged as the player themselves. Web gives the same player their total and
  // a way into the next game, and that difference made the two clients different products.
  group('the ending of a solo challenge', () {
    testWidgets('is the score and a rematch, not a podium of one', (tester) async {
      when(() => repository.getChallenge('c1')).thenAnswer((_) async => _finishedSoloChallenge());
      // The board the session fetches anyway. Stubbed with the row the server really returns for a
      // solo challenge — the owner alone — so this proves the screen DECLINES to render it rather
      // than merely having nothing to render.
      when(() => repository.getLeaderboard('c1')).thenAnswer(
        (_) async => GameLeaderboardResponseDto(
          entries: [GameLeaderboardResponseDtoEntriesInner(userId: 'u1', name: 'Alice', total: 18420, answered: 2)],
        ),
      );

      await pump(tester);

      expect(find.text('Completed'), findsOneWidget);
      // 4200 + 14220, grouped: `game_points` interpolates {score} verbatim, so an ungrouped total
      // would render "18420 pts" and a per-round figure would render one of the two scores.
      expect(find.byKey(const Key('solo-score-total')), findsOneWidget);
      expect(find.text('18,420 pts'), findsOneWidget);
      expect(find.byKey(const Key('solo-play-again')), findsOneWidget);
      expect(find.text('Play again'), findsOneWidget);

      expect(find.byType(StandingsRow), findsNothing, reason: 'a solo game has nobody to rank against');
      expect(find.text('Leaderboard'), findsNothing);
    });

    testWidgets('a finished solo game lists its rounds under the score', (tester) async {
      when(() => repository.getChallenge('c1')).thenAnswer((_) async => _finishedSoloChallenge());
      when(() => repository.getLeaderboard('c1')).thenAnswer((_) async => GameLeaderboardResponseDto(entries: []));

      await pump(tester);

      expect(find.byKey(const Key('solo-score-total')), findsOneWidget);
      expect(find.byKey(const Key('round-review-list')), findsOneWidget);
    });

    testWidgets('tapping a round opens its review', (tester) async {
      final router = FakeStackRouter();
      when(() => repository.getChallenge('c1')).thenAnswer((_) async => _finishedSoloChallenge());
      when(() => repository.getLeaderboard('c1')).thenAnswer((_) async => GameLeaderboardResponseDto(entries: []));

      await pump(tester, router: router);

      await tester.tap(find.byKey(const Key('round-review-row-0')));
      await tester.pumpAndSettle();

      expect(router.pushed.single, isA<GameRoundReviewRoute>());
    });

    testWidgets('a space challenge keeps its leaderboard', (tester) async {
      // The other half of the branch: the split is on scope, so this must not have been turned
      // into "no client renders a leaderboard".
      when(() => repository.getChallenge('c1')).thenAnswer((_) async => _finishedChallenge());
      when(() => repository.getLeaderboard('c1')).thenAnswer(
        (_) async => GameLeaderboardResponseDto(
          entries: [GameLeaderboardResponseDtoEntriesInner(userId: 'u1', name: 'Alice', total: 4200, answered: 1)],
        ),
      );

      await pump(tester);

      expect(find.byType(StandingsRow), findsOneWidget);
      expect(find.text('Leaderboard'), findsOneWidget);
      expect(find.byKey(const Key('solo-play-again')), findsNothing);
    });

    testWidgets('Play again asks for another game of the same shape and opens it', (tester) async {
      final router = FakeStackRouter();
      final solo = _MockSoloGameApiRepository();
      when(() => repository.getChallenge('c1')).thenAnswer((_) async => _finishedSoloChallenge());
      when(() => repository.getLeaderboard('c1')).thenAnswer((_) async => GameLeaderboardResponseDto(entries: []));
      when(
        () => solo.create(
          roundCount: any(named: 'roundCount'),
          type: any(named: 'type'),
        ),
      ).thenAnswer(
        (_) async => GameChallengeResponseDto(
          id: 'c2',
          spaceId: null,
          ownerId: 'u1',
          name: 'Mixed',
          roundCount: 2,
          scaleKm: 1,
          scaleDays: 1,
          createdAt: DateTime.utc(2026, 8, 18),
          dailyOn: null,
        ),
      );

      await pump(tester, extraOverrides: [soloGameApiRepositoryProvider.overrideWithValue(solo)], router: router);

      await tester.tap(find.byKey(const Key('solo-play-again')));
      await tester.pumpAndSettle();

      // Same size, and the type the finished game's ROUNDS actually were — a mixed request that
      // could only find location photos produced a places game, so "another one like that" is a
      // places game. Mirrors web's `typeOf`.
      verify(() => solo.create(roundCount: 2, type: GameChallengeType.location)).called(1);
      expect(router.pushed, hasLength(1), reason: 'the rematch has to actually open');
      expect(
        tester.widget<FilledButton>(find.byKey(const Key('solo-play-again'))).onPressed,
        isNotNull,
        reason: 'the push does not complete until the rematch pops, so the button must be live again',
      );
    });

    testWidgets('a rejected rematch says why and leaves the button usable', (tester) async {
      final router = FakeStackRouter();
      final solo = _MockSoloGameApiRepository();
      when(() => repository.getChallenge('c1')).thenAnswer((_) async => _finishedSoloChallenge());
      when(() => repository.getLeaderboard('c1')).thenAnswer((_) async => GameLeaderboardResponseDto(entries: []));
      when(
        () => solo.create(
          roundCount: any(named: 'roundCount'),
          type: any(named: 'type'),
        ),
      ).thenThrow(ApiException(400, '{"message":"no candidates"}'));

      await pump(tester, extraOverrides: [soloGameApiRepositoryProvider.overrideWithValue(solo)], router: router);

      await tester.tap(find.byKey(const Key('solo-play-again')));
      await tester.pumpAndSettle();

      // The mobile copy: no source toggles to offer on this client.
      expect(find.textContaining('No photos available for PhotoGuesser'), findsOneWidget);
      expect(find.textContaining('when you start a game'), findsNothing);
      expect(router.pushed, isEmpty, reason: 'there is no game to open');
      expect(tester.widget<FilledButton>(find.byKey(const Key('solo-play-again'))).onPressed, isNotNull);

      await settleToast(tester);
    });
  });
}
