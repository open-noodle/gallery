import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:openapi/api.dart';

enum GamePhase { guessing, revealing, finished }

/// Everything the reveal needs, assembled from the guess response and the post-guess refetch.
///
/// [guess] is null on the 409 recovery path: that request never reached the server, so there is no
/// guess of ours to plot. The reveal is still informative without it.
class RoundResult {
  final GameRoundType type;
  final int score;
  final double? distanceKm;
  final int? offsetDays;
  final GameRoundDetailResponseDtoAnswer? answer;
  final ({double lat, double lon})? guess;

  const RoundResult({
    required this.type,
    required this.score,
    this.distanceKm,
    this.offsetDays,
    this.answer,
    this.guess,
  });
}

class GameSessionState {
  final GameChallengeDetailResponseDto challenge;
  final int currentIndex;
  final GamePhase phase;
  final RoundResult? result;
  final bool submitting;
  final GameLeaderboardResponseDto? leaderboard;

  const GameSessionState({
    required this.challenge,
    required this.currentIndex,
    required this.phase,
    this.result,
    this.submitting = false,
    this.leaderboard,
  });

  /// Looked up by the round's own `index`, not by array position. Correct either way only because
  /// the server orders rounds over a contiguous 0..N-1 set; looking it up keeps that invariant
  /// local rather than leaning on it silently at every call site.
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
    bool clearResult = false,
  }) => GameSessionState(
    challenge: challenge ?? this.challenge,
    currentIndex: currentIndex ?? this.currentIndex,
    phase: phase ?? this.phase,
    result: clearResult ? null : (result ?? this.result),
    submitting: submitting ?? this.submitting,
    leaderboard: leaderboard ?? this.leaderboard,
  );
}

final gameSessionProvider = AsyncNotifierProvider.autoDispose.family<GameSessionController, GameSessionState, String>(
  GameSessionController.new,
);

class GameSessionController extends AutoDisposeFamilyAsyncNotifier<GameSessionState, String> {
  /// Called with the daily's `dailyOn` when a DAILY challenge is completed. The reminder wires this;
  /// nothing sets it here, and a custom challenge never invokes it.
  void Function(DateTime dailyOn)? onDailyCompleted;

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

  Future<void> guessDate(DateTime utcMonthStart) =>
      _submit((current) => _repository.guessDate(arg, current, utcMonthStart: utcMonthStart));

  Future<void> _submit(
    Future<GameGuessResponseDto> Function(int index) send, {
    ({double lat, double lon})? guess,
  }) async {
    final current = state.valueOrNull;
    // A real guard, not styling: a double tap's second guess would 409 and overwrite a complete
    // reveal with a degraded one.
    if (current == null || current.submitting || current.phase != GamePhase.guessing) return;

    state = AsyncData(current.copyWith(submitting: true));
    try {
      final response = await send(current.currentIndex);
      await _reveal(
        score: response.score.toInt(),
        distanceKm: response.distanceKm?.toDouble(),
        offsetDays: response.offsetDays?.toInt(),
        guess: guess,
      );
    } on ApiException catch (error) {
      if (error.code == 409) {
        // Not a failure: the first guess stands. Re-read it and reveal without our own pin.
        await _reveal(score: null, guess: null);
        return;
      }
      state = AsyncData(state.requireValue.copyWith(submitting: false));
      rethrow;
    } catch (_) {
      state = AsyncData(state.requireValue.copyWith(submitting: false));
    }
  }

  /// The guess response carries score/distance/offset but never the answer, so the answer can only
  /// come from a refetched challenge.
  Future<void> _reveal({
    required int? score,
    double? distanceKm,
    int? offsetDays,
    ({double lat, double lon})? guess,
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
          type: round?.type ?? GameRoundType.location,
          score: score ?? round?.score.orElse(null)?.toInt() ?? 0,
          distanceKm: distanceKm,
          offsetDays: offsetDays,
          answer: round?.answer.orElse(null),
          guess: guess,
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

    state = AsyncData(current.copyWith(phase: GamePhase.finished, clearResult: true));
    _finish(current.challenge);
  }

  Future<void> _finish(GameChallengeDetailResponseDto challenge) async {
    final dailyOn = challenge.dailyOn;
    if (dailyOn != null) {
      onDailyCompleted?.call(dailyOn);
    }
    final leaderboard = await _safeLeaderboard(arg);
    final current = state.valueOrNull;
    if (leaderboard != null && current != null) {
      state = AsyncData(current.copyWith(leaderboard: leaderboard));
    }
  }
}
