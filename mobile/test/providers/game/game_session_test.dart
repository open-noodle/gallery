import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/game/game_session.provider.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class _MockGameApiRepository extends Mock implements GameApiRepository {}

GameRoundDetailResponseDto _round(int index, {GameRoundType type = GameRoundType.location, num? score, num? lat}) =>
    GameRoundDetailResponseDto(
      index: index,
      type: type,
      score: score == null ? const Optional.absent() : Optional.present(score),
      answer: score == null
          ? const Optional.absent()
          : Optional.present(GameRoundDetailResponseDtoAnswer(date: null, lat: lat ?? 1, lon: 2)),
    );

GameChallengeDetailResponseDto _challenge(
  List<GameRoundDetailResponseDto> rounds, {
  DateTime? dailyOn,
  String? spaceId = 'space-1',
}) => GameChallengeDetailResponseDto(
  id: 'challenge-1',
  spaceId: spaceId,
  ownerId: null,
  name: 'Challenge 1',
  roundCount: rounds.length,
  scaleKm: 100,
  scaleDays: 100,
  createdAt: DateTime.utc(2026, 8, 18),
  closedAt: null,
  dailyOn: dailyOn,
  rounds: rounds,
);

// GameGuessResponseDto has several other required-but-nullable fields (guessDate, guessLat,
// guessLon, offsetDays) that the individual tests below do not care about — this fills them with
// null so each call site can stay focused on the fields the assertions actually check.
GameGuessResponseDto _guessResponse({required num score, num? distanceKm, num? offsetDays}) => GameGuessResponseDto(
  roundId: 'r0',
  userId: 'u',
  score: score,
  distanceKm: distanceKm,
  offsetDays: offsetDays,
  guessDate: null,
  guessLat: null,
  guessLon: null,
);

// Every test below drives `gameSessionProvider('challenge-1')` purely through `container.read`,
// never `container.listen`. A bare `read` does not keep an autoDispose provider alive: Riverpod
// schedules disposal (via a zero-duration Timer, see ProviderScheduler.scheduleProviderDispose)
// the moment a read leaves zero listeners. That timer never fires while a test's awaits all
// resolve on microtasks, but a real event-loop gap — `await Future<void>.delayed(Duration.zero)`,
// used below to let `next()`'s un-awaited `_finish()` tail settle — is exactly the kind of gap
// that lets it run, disposing the notifier and silently rebuilding it (a fresh `AsyncLoading`)
// on the next read. Pinning a no-op listener keeps the same instance alive for the test's
// lifetime, matching how a real widget tree (which always has a listener) would behave.
ProviderContainer _container(GameApiRepository repository) {
  final container = ProviderContainer(overrides: [gameApiRepositoryProvider.overrideWithValue(repository)]);
  addTearDown(container.dispose);
  container.listen(gameSessionProvider('challenge-1'), (_, __) {});
  return container;
}

void main() {
  late _MockGameApiRepository repository;

  setUp(() {
    repository = _MockGameApiRepository();
    when(() => repository.getLeaderboard(any())).thenAnswer((_) async => GameLeaderboardResponseDto(entries: []));
  });

  test('starts at round 0 when nothing is answered', () async {
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async => _challenge([_round(0), _round(1)]));

    final container = _container(repository);
    final state = await container.read(gameSessionProvider('challenge-1').future);

    expect(state.currentIndex, 0);
    expect(state.phase, GamePhase.guessing);
  });

  test('resumes at the first unanswered round', () async {
    when(
      () => repository.getChallenge('challenge-1'),
    ).thenAnswer((_) async => _challenge([_round(0, score: 10), _round(1, score: 20), _round(2)]));

    final container = _container(repository);
    final state = await container.read(gameSessionProvider('challenge-1').future);

    expect(state.currentIndex, 2);
  });

  test('a fully answered challenge opens finished, with the leaderboard loaded', () async {
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async => _challenge([_round(0, score: 10)]));

    final container = _container(repository);
    final state = await container.read(gameSessionProvider('challenge-1').future);

    expect(state.phase, GamePhase.finished);
    expect(state.leaderboard, isNotNull);
  });

  test('a date guess carries the picked month through to the reveal', () async {
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      return _challenge([
        if (fetches == 1)
          _round(0, type: GameRoundType.date)
        else
          GameRoundDetailResponseDto(
            index: 0,
            type: GameRoundType.date,
            score: const Optional.present(3640),
            answer: Optional.present(
              GameRoundDetailResponseDtoAnswer(date: DateTime.utc(2019, 12, 1), lat: null, lon: null),
            ),
          ),
      ]);
    });
    when(
      () => repository.guessDate(any(), any(), utcMonthStart: any(named: 'utcMonthStart')),
    ).thenAnswer((_) async => _guessResponse(score: 3640, offsetDays: 150));

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);

    await container.read(gameSessionProvider('challenge-1').notifier).guessDate(DateTime.utc(2019, 7, 1));
    final result = container.read(gameSessionProvider('challenge-1')).requireValue.result!;

    // Without this the reveal has only the offset — a number with nothing to check it against.
    expect(result.guessDate, DateTime.utc(2019, 7, 1));
    expect(result.answer!.date, DateTime.utc(2019, 12, 1));
    expect(result.offsetDays, 150);
  });

  test('an empty round list is finished rather than out of range', () async {
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async => _challenge([]));

    final container = _container(repository);
    final state = await container.read(gameSessionProvider('challenge-1').future);

    expect(state.phase, GamePhase.finished);
    expect(state.currentRound, isNull);
  });

  test('a guess reveals the answer from the refetch, not from the guess response', () async {
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      // The second fetch is the post-guess one, where round 0 has become scored.
      return _challenge([if (fetches == 1) _round(0) else _round(0, score: 4200, lat: 48.85), _round(1)]);
    });
    when(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).thenAnswer((_) async => _guessResponse(score: 4200, distanceKm: 38));

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    final controller = container.read(gameSessionProvider('challenge-1').notifier);

    await controller.guessLocation(lat: 48.0, lon: 2.0);
    final state = container.read(gameSessionProvider('challenge-1')).requireValue;

    expect(state.phase, GamePhase.revealing);
    expect(state.result!.score, 4200);
    expect(state.result!.distanceKm, 38);
    expect(state.result!.answer!.lat, 48.85);
    expect(state.result!.guess, isNotNull);
  });

  test('the resume index does not move when the refetch scores the current round', () async {
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      return _challenge([if (fetches == 1) _round(0) else _round(0, score: 4200), _round(1)]);
    });
    when(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).thenAnswer((_) async => _guessResponse(score: 4200));

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    await container.read(gameSessionProvider('challenge-1').notifier).guessLocation(lat: 1, lon: 1);

    // Recomputing from the refreshed payload would jump to 1 and skip round 0's own reveal.
    expect(container.read(gameSessionProvider('challenge-1')).requireValue.currentIndex, 0);
  });

  test('a second guess while one is in flight does not reach the server', () async {
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async => _challenge([_round(0), _round(1)]));
    when(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).thenAnswer((_) async {
      await Future<void>.delayed(const Duration(milliseconds: 30));
      return _guessResponse(score: 100);
    });

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    final controller = container.read(gameSessionProvider('challenge-1').notifier);

    await Future.wait([controller.guessLocation(lat: 1, lon: 1), controller.guessLocation(lat: 2, lon: 2)]);

    verify(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).called(1);
  });

  test('a 409 duplicate reveals the answer without a guess pin instead of erroring', () async {
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      return _challenge([if (fetches == 1) _round(0) else _round(0, score: 900, lat: 10), _round(1)]);
    });
    when(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).thenThrow(ApiException(409, 'Already guessed'));

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    await container.read(gameSessionProvider('challenge-1').notifier).guessLocation(lat: 1, lon: 1);

    final state = container.read(gameSessionProvider('challenge-1')).requireValue;
    expect(state.phase, GamePhase.revealing);
    expect(state.result!.score, 900);
    expect(state.result!.guess, isNull, reason: 'That request never reached the server');
  });

  // A guess that was already recorded server-side (409) previously revealed with no pin, because
  // the client could not recover its own guess. The refetched detail now carries it.
  test('the 409 recovery reveal plots the guess the server already had', () async {
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      return _challenge([
        if (fetches == 1)
          _round(0)
        else
          GameRoundDetailResponseDto(
            index: 0,
            type: GameRoundType.location,
            score: const Optional.present(900),
            answer: Optional.present(GameRoundDetailResponseDtoAnswer(date: null, lat: 10, lon: 2)),
            guess: Optional.present(
              GameRoundDetailResponseDtoGuess(
                lat: 38.72,
                lon: -9.14,
                date: null,
                distanceKm: 412.3,
                offsetDays: null,
              ),
            ),
          ),
        _round(1),
      ]);
    });
    when(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).thenThrow(ApiException(409, 'Already guessed'));

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    final controller = container.read(gameSessionProvider('challenge-1').notifier);

    await controller.guessLocation(lat: 38.72, lon: -9.14);

    final result = container.read(gameSessionProvider('challenge-1')).valueOrNull?.result;
    expect(result?.guess?.lat, 38.72);
    expect(result?.distanceKm, 412.3);
  });

  test('an offline guess, wrapped by the client as ApiException(400), leaves the round guessable '
      'again', () async {
    // The generated client wraps SocketException/TlsException/IOException/ClientException into
    // ApiException(400, ...) (see openapi/lib/api_client.dart) -- this is the shape a real offline
    // guess actually takes, not a bare Exception.
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async => _challenge([_round(0), _round(1)]));
    when(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).thenThrow(ApiException(400, 'Socket operation failed'));

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    await container.read(gameSessionProvider('challenge-1').notifier).guessLocation(lat: 1, lon: 1);

    final state = container.read(gameSessionProvider('challenge-1')).requireValue;
    expect(state.phase, GamePhase.guessing);
    expect(state.submitting, isFalse);
    expect(state.lastError, isNotNull);
  });

  test('a non-ApiException guess failure also leaves the round guessable again', () async {
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async => _challenge([_round(0), _round(1)]));
    when(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).thenThrow(Exception('unexpected'));

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    await container.read(gameSessionProvider('challenge-1').notifier).guessLocation(lat: 1, lon: 1);

    final state = container.read(gameSessionProvider('challenge-1')).requireValue;
    expect(state.phase, GamePhase.guessing);
    expect(state.submitting, isFalse);
    expect(state.lastError, isNotNull);
  });

  test('lastError clears on a subsequent successful guess', () async {
    var fetches = 0;
    var attempts = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      return _challenge([if (fetches == 1) _round(0) else _round(0, score: 1), _round(1)]);
    });
    when(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).thenAnswer((_) async {
      attempts++;
      // The first attempt fails; the retry (same round, still `guessing`) succeeds.
      if (attempts == 1) {
        throw ApiException(400, 'Socket operation failed');
      }
      return _guessResponse(score: 1);
    });

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    final controller = container.read(gameSessionProvider('challenge-1').notifier);

    await controller.guessLocation(lat: 1, lon: 1);
    expect(container.read(gameSessionProvider('challenge-1')).requireValue.lastError, isNotNull);

    await controller.guessLocation(lat: 1, lon: 1);
    final state = container.read(gameSessionProvider('challenge-1')).requireValue;
    expect(state.lastError, isNull, reason: 'A stale error banner must not survive a later successful guess');
    expect(state.phase, GamePhase.revealing);
  });

  test('next advances exactly one round even when tapped twice', () async {
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      return _challenge([if (fetches == 1) _round(0) else _round(0, score: 1), _round(1), _round(2)]);
    });
    when(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).thenAnswer((_) async => _guessResponse(score: 1));

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    final controller = container.read(gameSessionProvider('challenge-1').notifier);
    await controller.guessLocation(lat: 1, lon: 1);

    controller.next();
    controller.next();

    expect(container.read(gameSessionProvider('challenge-1')).requireValue.currentIndex, 1);
  });

  test('next on the final round finishes and loads the leaderboard', () async {
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      return _challenge([if (fetches == 1) _round(0) else _round(0, score: 1)]);
    });
    when(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).thenAnswer((_) async => _guessResponse(score: 1));

    final container = _container(repository);
    // Start unanswered so the session opens in `guessing`, then guess and advance.
    await container.read(gameSessionProvider('challenge-1').future);
    final controller = container.read(gameSessionProvider('challenge-1').notifier);
    await controller.guessLocation(lat: 1, lon: 1);
    controller.next();
    await Future<void>.delayed(Duration.zero);

    final state = container.read(gameSessionProvider('challenge-1')).requireValue;
    expect(state.phase, GamePhase.finished);
    expect(
      state.currentRound,
      isNull,
      reason:
          'finished must imply no current round, or Task 9 re-renders the guessing surface for an already-answered round',
    );
    verify(() => repository.getLeaderboard('challenge-1')).called(1);
  });

  test('completing a daily reports its dailyOn date and that it was a SPACE daily', () async {
    final reported = <(DateTime, bool)>[];
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      return _challenge([if (fetches == 1) _round(0) else _round(0, score: 1)], dailyOn: DateTime.utc(2026, 8, 18));
    });
    when(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).thenAnswer((_) async => _guessResponse(score: 1));

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    final controller = container.read(gameSessionProvider('challenge-1').notifier)
      ..onDailyCompleted = (dailyOn, {required isSolo}) => reported.add((dailyOn, isSolo));
    await controller.guessLocation(lat: 1, lon: 1);
    controller.next();
    await Future<void>.delayed(Duration.zero);

    expect(reported, [(DateTime.utc(2026, 8, 18), false)]);
  });

  // The solo counterpart of the test above: `spaceId: null` is what `_finish` reads to decide
  // `isSolo`, and getting this wrong makes `recordDailyCompleted` write the OTHER daily's
  // last-played key — silently suppressing the reminder for whichever one was actually unplayed.
  test('completing a solo daily reports isSolo true', () async {
    final reported = <(DateTime, bool)>[];
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      return _challenge(
        [if (fetches == 1) _round(0) else _round(0, score: 1)],
        dailyOn: DateTime.utc(2026, 8, 18),
        spaceId: null,
      );
    });
    when(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).thenAnswer((_) async => _guessResponse(score: 1));

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    final controller = container.read(gameSessionProvider('challenge-1').notifier)
      ..onDailyCompleted = (dailyOn, {required isSolo}) => reported.add((dailyOn, isSolo));
    await controller.guessLocation(lat: 1, lon: 1);
    controller.next();
    await Future<void>.delayed(Duration.zero);

    expect(reported, [(DateTime.utc(2026, 8, 18), true)]);
  });

  test('completing a custom (non-daily) challenge reports nothing', () async {
    final reported = <(DateTime, bool)>[];
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      // dailyOn stays null: a player-created challenge, not a daily.
      return _challenge([if (fetches == 1) _round(0) else _round(0, score: 1)]);
    });
    when(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).thenAnswer((_) async => _guessResponse(score: 1));

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    final controller = container.read(gameSessionProvider('challenge-1').notifier)
      ..onDailyCompleted = (dailyOn, {required isSolo}) => reported.add((dailyOn, isSolo));
    await controller.guessLocation(lat: 1, lon: 1);
    controller.next();
    await Future<void>.delayed(Duration.zero);

    expect(reported, isEmpty);
  });

  group('RoundResult.fromRound', () {
    test('maps a guessed location round', () {
      final result = RoundResult.fromRound(
        GameRoundDetailResponseDto(
          index: 0,
          type: GameRoundType.location,
          assetId: const Optional.present('asset-1'),
          score: const Optional.present(1842),
          answer: Optional.present(GameRoundDetailResponseDtoAnswer(lat: 41.15, lon: -8.61, date: null)),
          guess: Optional.present(
            GameRoundDetailResponseDtoGuess(lat: 38.72, lon: -9.14, date: null, distanceKm: 412.3, offsetDays: null),
          ),
        ),
      );

      expect(result.type, GameRoundType.location);
      expect(result.score, 1842);
      expect(result.guess?.lat, 38.72);
      expect(result.distanceKm, 412.3);
      expect(result.guessDate, isNull);
    });

    test('maps a guessed date round', () {
      final result = RoundResult.fromRound(
        GameRoundDetailResponseDto(
          index: 1,
          type: GameRoundType.date,
          assetId: const Optional.present('asset-2'),
          score: const Optional.present(2410),
          answer: Optional.present(
            GameRoundDetailResponseDtoAnswer(lat: null, lon: null, date: DateTime.utc(2024, 6, 4)),
          ),
          guess: Optional.present(
            GameRoundDetailResponseDtoGuess(
              lat: null,
              lon: null,
              date: DateTime.utc(2024, 6, 1),
              distanceKm: null,
              offsetDays: 3,
            ),
          ),
        ),
      );

      expect(result.guess, isNull);
      expect(result.guessDate, DateTime.utc(2024, 6, 1));
      expect(result.offsetDays, 3);
    });

    // guessDate is `timestamp with time zone` and arrives as a full ISO instant, so it must survive
    // as one — unlike `dailyOn`, which is date-only and must NOT be converted. Getting those two
    // confused has already shipped twice on this branch. The assertion is on `isUtc` rather than on
    // a rendered string because CI runs UTC, where a wrong conversion is invisible; Task 10 runs the
    // game tests once under a non-UTC TZ to cover the rendering side.
    test('keeps the guessed date as the instant it arrived as', () {
      final result = RoundResult.fromRound(
        GameRoundDetailResponseDto(
          index: 1,
          type: GameRoundType.date,
          score: const Optional.present(2410),
          guess: Optional.present(
            GameRoundDetailResponseDtoGuess(
              lat: null,
              lon: null,
              date: DateTime.utc(2024, 6, 1, 12, 30),
              distanceKm: null,
              offsetDays: 3,
            ),
          ),
        ),
      );

      expect(result.guessDate!.isUtc, isTrue);
      expect(result.guessDate, DateTime.utc(2024, 6, 1, 12, 30));
    });

    // Absent, NOT present(null): `.value` on an Absent THROWS, and only the absent form
    // reproduces the wire shape of an unguessed round. A factory that reads `.value`
    // errors here instead of failing an assertion.
    test('tolerates an unguessed round, whose fields are absent', () {
      // NOT `const`: the generated constructor is not a const constructor.
      final result = RoundResult.fromRound(
        GameRoundDetailResponseDto(index: 2, type: GameRoundType.location),
      );

      expect(result.score, 0);
      expect(result.guess, isNull);
      expect(result.answer, isNull);
    });
  });

  test('a failed post-guess refetch still shows the score rather than sticking in guessing', () async {
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      if (fetches > 1) throw Exception('offline');
      return _challenge([_round(0), _round(1)]);
    });
    when(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).thenAnswer((_) async => _guessResponse(score: 2500, distanceKm: 12));

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    await container.read(gameSessionProvider('challenge-1').notifier).guessLocation(lat: 1, lon: 1);

    final state = container.read(gameSessionProvider('challenge-1')).requireValue;
    expect(state.phase, GamePhase.revealing);
    expect(state.result!.score, 2500);
    expect(state.result!.answer, isNull, reason: 'The answer was never retrieved');
  });
}
