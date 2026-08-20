import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:openapi/api.dart';

enum GamePhase { guessing, revealing, finished }

/// Everything the reveal needs, assembled from the guess response and the post-guess refetch.
///
/// [guess] is null in two cases, neither of which means an error happened: on the 409 recovery
/// path, where that request never reached the server so there is no guess of ours to plot, and on
/// every date round, where a guess has no lat/lon to plot in the first place. `guess == null` is
/// therefore not, by itself, a signal that a 409 occurred.
///
/// [guessDate] is the date-round counterpart: the month the player picked, so the reveal can show
/// their answer next to the real one rather than only the offset between them. Null on every
/// location round, and on the 409 recovery path for the same reason [guess] is.
class RoundResult {
  final GameRoundType type;
  final int score;
  final double? distanceKm;
  final int? offsetDays;
  final GameRoundDetailResponseDtoAnswer? answer;
  final ({double lat, double lon})? guess;
  final DateTime? guessDate;

  const RoundResult({
    required this.type,
    required this.score,
    this.distanceKm,
    this.offsetDays,
    this.answer,
    this.guess,
    this.guessDate,
  });
}

class GameSessionState {
  final GameChallengeDetailResponseDto challenge;
  final int currentIndex;
  final GamePhase phase;
  final RoundResult? result;
  final bool submitting;
  final GameLeaderboardResponseDto? leaderboard;

  /// The most recent guess failure, or null once cleared. Set on any non-409 guess failure
  /// (`_submit` never rethrows — see its doc comment); cleared when a guess is next attempted and
  /// whenever a reveal completes successfully, including the 409 recovery reveal.
  final Object? lastError;

  const GameSessionState({
    required this.challenge,
    required this.currentIndex,
    required this.phase,
    this.result,
    this.submitting = false,
    this.leaderboard,
    this.lastError,
  });

  /// Looked up by the round's own `index`, not by array position. Correct either way only because
  /// the server orders rounds over a contiguous 0..N-1 set; looking it up keeps that invariant
  /// local rather than leaning on it silently at every call site.
  ///
  /// Null whenever `phase == finished`: `next()` moves `currentIndex` past the last round on
  /// completion (mirroring the web client) precisely so this stays the single signal a page needs
  /// to tell "still playing" from "done" apart — a page that instead branched on `currentIndex ==
  /// rounds.length - 1` would re-render the guessing surface for the round just answered.
  GameRoundDetailResponseDto? get currentRound {
    for (final round in challenge.rounds) {
      if (round.index.toInt() == currentIndex) return round;
    }
    return null;
  }

  GameSessionState copyWith({
    GameChallengeDetailResponseDto? challenge,
    int? currentIndex,
    GamePhase? phase,
    RoundResult? result,
    bool? submitting,
    GameLeaderboardResponseDto? leaderboard,
    Object? lastError,
    bool clearResult = false,
    bool clearLastError = false,
  }) => GameSessionState(
    challenge: challenge ?? this.challenge,
    currentIndex: currentIndex ?? this.currentIndex,
    phase: phase ?? this.phase,
    result: clearResult ? null : (result ?? this.result),
    submitting: submitting ?? this.submitting,
    leaderboard: leaderboard ?? this.leaderboard,
    lastError: clearLastError ? null : (lastError ?? this.lastError),
  );
}

final gameSessionProvider = AsyncNotifierProvider.autoDispose.family<GameSessionController, GameSessionState, String>(
  GameSessionController.new,
);

class GameSessionController extends AutoDisposeFamilyAsyncNotifier<GameSessionState, String> {
  /// Called with the daily's `dailyOn`, and whether it was the SOLO (personal) daily rather than a
  /// space one, when a DAILY challenge is completed. The reminder wires this; nothing sets it here,
  /// and a custom challenge never invokes it. [isSolo] is needed downstream because the space and
  /// solo streaks are independent, computed server-side — recording completion under the wrong one
  /// of the two `gameDaily*LastPlayed` keys would silently suppress the OTHER daily's reminder.
  void Function(DateTime dailyOn, {required bool isSolo})? onDailyCompleted;

  GameApiRepository get _repository => ref.read(gameApiRepositoryProvider);

  @override
  Future<GameSessionState> build(String challengeId) async {
    final challenge = await _repository.getChallenge(challengeId);
    // Computed ONCE, here. Never recomputed: the round just answered becomes scored on the
    // post-guess refetch, and recomputing would skip straight past its own reveal.
    final index = firstUnansweredIndex(challenge.rounds);

    if (index == null) {
      return GameSessionState(
        challenge: challenge,
        currentIndex: challenge.rounds.length,
        phase: GamePhase.finished,
        leaderboard: await _safeLeaderboard(challengeId),
      );
    }
    return GameSessionState(challenge: challenge, currentIndex: index, phase: GamePhase.guessing);
  }

  Future<GameLeaderboardResponseDto?> _safeLeaderboard(String challengeId) async {
    try {
      return await _repository.getLeaderboard(challengeId);
    } catch (_) {
      // A missing leaderboard must not blank the score the player just earned.
      return null;
    }
  }

  Future<void> guessLocation({required double lat, required double lon}) => _submit(
    (current) => _repository.guessLocation(arg, current, lat: lat, lon: lon),
    guess: (lat: lat, lon: lon),
  );

  /// The picked month is carried through to the reveal as [RoundResult.guessDate]. The server
  /// echoes it back on [GameGuessResponseDto.guessDate], but the value we sent is what the player
  /// actually chose and is known even when that echo is absent.
  Future<void> guessDate(DateTime utcMonthStart) =>
      _submit((current) => _repository.guessDate(arg, current, utcMonthStart: utcMonthStart), guessDate: utcMonthStart);

  /// Never rethrows. The generated client wraps `SocketException`/`TlsException`/`IOException`/
  /// `ClientException` into `ApiException(400, ...)` (see `openapi/lib/api_client.dart`), so a real
  /// offline guess takes the same catch branch as any other non-409 failure — and this is called
  /// from a fire-and-forget context (a tap handler), where a rethrow would become an unhandled
  /// async error instead of UI the player can act on. Failures are surfaced on
  /// [GameSessionState.lastError] instead, with the round left guessable again.
  Future<void> _submit(
    Future<GameGuessResponseDto> Function(int index) send, {
    ({double lat, double lon})? guess,
    DateTime? guessDate,
  }) async {
    final current = state.valueOrNull;
    // A real guard, not styling: a double tap's second guess would 409 and overwrite a complete
    // reveal with a degraded one.
    if (current == null || current.submitting || current.phase != GamePhase.guessing) return;
    // `phase == guessing` guarantees a round to guess, so this is never null here.
    final type = current.currentRound!.type;

    state = AsyncData(current.copyWith(submitting: true, clearLastError: true));
    try {
      final response = await send(current.currentIndex);
      await _reveal(
        type: type,
        score: response.score.toInt(),
        distanceKm: response.distanceKm?.toDouble(),
        offsetDays: response.offsetDays?.toInt(),
        guess: guess,
        guessDate: response.guessDate ?? guessDate,
      );
    } on ApiException catch (error) {
      if (error.code == 409) {
        // Not a failure: the first guess stands. Re-read it and reveal without our own pin.
        await _reveal(type: type, score: null, guess: null);
        return;
      }
      state = AsyncData(state.requireValue.copyWith(submitting: false, lastError: error));
    } catch (error) {
      state = AsyncData(state.requireValue.copyWith(submitting: false, lastError: error));
    }
  }

  /// The guess response carries score/distance/offset but never the answer, so the answer can only
  /// come from a refetched challenge. [type] comes from the round as it stood before this refetch —
  /// not from the refetched round — because it is intrinsic to the round (unlike score/answer, it
  /// never changes once guessed) and must stay correct even on the rare refetch that returns a
  /// round the lookup below cannot find.
  Future<void> _reveal({
    required GameRoundType type,
    required int? score,
    double? distanceKm,
    int? offsetDays,
    ({double lat, double lon})? guess,
    DateTime? guessDate,
  }) async {
    final current = state.requireValue;
    GameChallengeDetailResponseDto challenge = current.challenge;
    try {
      challenge = await _repository.getChallenge(arg);
    } catch (_) {
      // Keep the score we already have rather than stranding the player in `guessing`.
    }

    final refreshed = GameSessionState(
      challenge: challenge,
      currentIndex: current.currentIndex,
      phase: GamePhase.revealing,
      submitting: false,
      leaderboard: current.leaderboard,
    );
    final round = refreshed.currentRound;

    state = AsyncData(
      refreshed.copyWith(
        result: RoundResult(
          type: type,
          score: score ?? round?.score.orElse(null)?.toInt() ?? 0,
          distanceKm: distanceKm,
          offsetDays: offsetDays,
          answer: round?.answer.orElse(null),
          guess: guess,
          guessDate: guessDate,
        ),
      ),
    );
  }

  void next() {
    final current = state.valueOrNull;
    // Guarding on `revealing` is what makes a double tap advance exactly one round.
    if (current == null || current.phase != GamePhase.revealing) return;

    final nextIndex = current.currentIndex + 1;
    if (nextIndex < current.challenge.rounds.length) {
      state = AsyncData(current.copyWith(currentIndex: nextIndex, phase: GamePhase.guessing, clearResult: true));
      return;
    }

    // Move currentIndex past the last round (mirroring the web client's `currentIndex += 1`, then
    // `currentIndex >= rounds.length` for "done"), so `finished` always implies `currentRound ==
    // null` — see the doc comment on that getter for why that invariant matters.
    state = AsyncData(
      current.copyWith(currentIndex: current.challenge.rounds.length, phase: GamePhase.finished, clearResult: true),
    );
    _finish(current.challenge);
  }

  Future<void> _finish(GameChallengeDetailResponseDto challenge) async {
    final dailyOn = challenge.dailyOn;
    if (dailyOn != null) {
      // `spaceId` is null for a solo challenge (see GameChallengeDetailResponseDto.spaceId's doc)
      // — reliable here because this branch is already gated on `dailyOn != null`, so a player-
      // created solo game (spaceId null, dailyOn null) never reaches it.
      onDailyCompleted?.call(dailyOn, isSolo: challenge.spaceId == null);
    }
    final leaderboard = await _safeLeaderboard(arg);
    final current = state.valueOrNull;
    if (leaderboard != null && current != null) {
      state = AsyncData(current.copyWith(leaderboard: leaderboard));
    }
  }
}
