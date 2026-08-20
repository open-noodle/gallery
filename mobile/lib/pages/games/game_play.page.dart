import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/date_round.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/location_round.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/round_reveal.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/standings_section.widget.dart';
import 'package:immich_mobile/providers/game/daily_reminder.provider.dart';
import 'package:immich_mobile/providers/game/game_session.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/utils/debug_print.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:openapi/api.dart';

/// The play surface for a single game session.
///
/// Watches [gameSessionProvider] and renders whichever child the current [GamePhase] calls for: a
/// guess surface (location or date), the round reveal, or a completion screen once every round is
/// answered.
@RoutePage()
class GamePlayPage extends ConsumerWidget {
  const GamePlayPage({super.key, required this.challengeId});

  final String challengeId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // A failed guess never throws (see GameSessionState.lastError's doc comment) — it resets
    // `submitting` and records the failure on `lastError` instead, leaving the round guessable
    // again. Without surfacing it here, a failed tap on Guess would look like a dead button. This
    // fires once per NEW failure rather than once per rebuild: `lastError` is cleared back to null
    // the moment a guess is retried, so state always passes back through null between one failure
    // and the next — `previous == null` is enough to catch each occurrence exactly once.
    ref.listen(gameSessionProvider(challengeId), (previous, next) {
      final error = next.valueOrNull?.lastError;
      if (error != null && previous?.valueOrNull?.lastError == null) {
        ImmichToast.show(
          context: context,
          msg: 'game_guess_failed'.t(context: context),
          toastType: ToastType.error,
        );
      }
    });

    // The session owns the state machine; the reminder owns the schedule. This is the one line
    // that connects them, and it fires only for a DAILY — a custom challenge never satisfies a
    // reminder (see GameSessionController.onDailyCompleted's doc comment).
    ref.read(gameSessionProvider(challengeId).notifier).onDailyCompleted = (dailyOn) =>
        ref.read(dailyReminderProvider).recordDailyCompleted(dailyOn);

    final session = ref.watch(gameSessionProvider(challengeId));

    return Scaffold(
      appBar: AppBar(title: Text('game_play'.t(context: context))),
      body: session.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) {
          dPrint(() => 'Error loading game session $challengeId: $error');
          return _ErrorState(onRetry: () => ref.invalidate(gameSessionProvider(challengeId)));
        },
        data: (state) => _body(context, ref, state),
      ),
    );
  }

  Widget _body(BuildContext context, WidgetRef ref, GameSessionState state) {
    final controller = ref.read(gameSessionProvider(challengeId).notifier);

    if (state.phase == GamePhase.revealing && state.result != null) {
      return RoundReveal(
        challengeId: challengeId,
        index: state.currentIndex,
        result: state.result!,
        onNext: controller.next,
      );
    }

    // `currentRound` is null exactly when `phase == GamePhase.finished` — both the resume path and
    // `next()` move `currentIndex` past the last round precisely so this stays the single signal
    // this page needs to tell "still playing" from "done" apart (see the getter's doc comment).
    // Branching here rather than on the phase enum keeps that one check doing double duty: it also
    // guards the `.type` dispatch below, which needs a non-null round anyway.
    final round = state.currentRound;
    if (round == null) {
      return _Completed(
        leaderboard: state.leaderboard,
        roundCount: state.challenge.rounds.length,
        currentUserId: ref.watch(currentUserProvider)?.id ?? '',
      );
    }

    final roundNumber = state.currentIndex + 1;
    final roundCount = state.challenge.rounds.length;

    if (round.type == GameRoundType.location) {
      return LocationRound(
        challengeId: challengeId,
        index: state.currentIndex,
        roundNumber: roundNumber,
        roundCount: roundCount,
        onGuess: ({required lat, required lon}) => controller.guessLocation(lat: lat, lon: lon),
      );
    }

    return DateRound(
      challengeId: challengeId,
      index: state.currentIndex,
      // No round in the payload carries a pool date to derive a lower bound from — the answer is
      // withheld until guessed — so the minimum is fixed, matching web.
      minYear: 1970,
      maxYear: state.challenge.createdAt.toUtc().year,
      roundNumber: roundNumber,
      roundCount: roundCount,
      onGuess: controller.guessDate,
    );
  }
}

/// The completion screen.
///
/// [GameSessionController] already fetches the challenge's leaderboard on finishing (and on
/// resuming an already-finished challenge) — rendering it here is what makes that fetch worth
/// anything, and it mirrors what web puts on the same screen.
///
/// Rows are NOT filtered against the space's member list. Unlike web, [StandingsRow] shows no
/// avatar — a rank, the name the server already sent, and the score — so a member lookup would buy
/// nothing here except the chance to silently drop a real player whose membership row happened not
/// to load. Same reasoning as `StandingsSection`.
class _Completed extends StatelessWidget {
  const _Completed({required this.leaderboard, required this.roundCount, required this.currentUserId});

  final GameLeaderboardResponseDto? leaderboard;
  final int roundCount;
  final String currentUserId;

  @override
  Widget build(BuildContext context) {
    // Never re-sorted: the server already applied its own comparator, and re-sorting by total
    // would break the rule that a player who scored zero still outranks one who never turned up.
    final entries = leaderboard?.entries ?? const <GameLeaderboardResponseDtoEntriesInner>[];
    final ranks = competitionRanks([for (final entry in entries) entry.total]);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          'game_completed'.t(context: context),
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        if (entries.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text('game_leaderboard'.t(context: context), style: Theme.of(context).textTheme.titleMedium),
          for (var i = 0; i < entries.length; i++)
            StandingsRow(
              key: Key('game-leaderboard-row-${entries[i].userId}'),
              userId: entries[i].userId,
              rank: ranks[i],
              name: entries[i].name,
              detail: entries[i].answered == 0
                  ? 'game_not_played'.t(context: context)
                  : 'game_rounds_answered'.t(
                      context: context,
                      args: {'answered': '${entries[i].answered}', 'total': '$roundCount'},
                    ),
              value: entries[i].answered == 0
                  ? '—'
                  : 'game_points'.t(context: context, args: {'score': '${entries[i].total}'}),
              isMe: entries[i].userId == currentUserId,
            ),
        ],
      ],
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, size: 48),
          const SizedBox(height: 16),
          Text('game_challenge_load_failed'.t(context: context), textAlign: TextAlign.center),
          const SizedBox(height: 16),
          FilledButton(
            key: const Key('game-play-retry'),
            onPressed: onRetry,
            child: Text('retry'.t(context: context)),
          ),
        ],
      ),
    );
  }
}
