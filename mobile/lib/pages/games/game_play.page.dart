import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/date_round.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/location_round.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/round_reveal.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/round_review_list.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/standings_section.widget.dart';
import 'package:immich_mobile/providers/game/daily_reminder.provider.dart';
import 'package:immich_mobile/providers/game/game_session.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/solo_game_api.repository.dart';
import 'package:immich_mobile/routing/router.dart';
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
    ref.read(gameSessionProvider(challengeId).notifier).onDailyCompleted = (dailyOn, {required isSolo}) =>
        ref.read(dailyReminderProvider).recordDailyCompleted(dailyOn, isSolo: isSolo);

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
      // Two endings, chosen by scope — the same split web makes between its space route and its
      // solo one. A solo challenge has nobody to rank against: the server's one-row leaderboard
      // exists only so the 404-for-strangers rule is not vacuous, and design §11 explicitly does
      // NOT reuse `game-leaderboard` for it. Rendering it anyway put the player on a podium of one,
      // flagged as themselves, instead of the score and the way into the next game web gives them.
      //
      // `spaceId == null` is the scope discriminator on the row (game_challenge_scope_chk makes
      // exactly one of the two ids non-null), the same test `_finish` uses to pick a streak.
      if (state.challenge.spaceId == null) {
        return _SoloCompleted(challenge: state.challenge);
      }
      return _Completed(
        challenge: state.challenge,
        leaderboard: state.leaderboard,
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

/// The completion screen for a SPACE challenge — the one place a leaderboard belongs, because a
/// space challenge really does have other players on it. See [_SoloCompleted] for the other scope.
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
  const _Completed({required this.challenge, required this.leaderboard, required this.currentUserId});

  final GameChallengeDetailResponseDto challenge;
  final GameLeaderboardResponseDto? leaderboard;
  final String currentUserId;

  @override
  Widget build(BuildContext context) {
    // Never re-sorted: the server already applied its own comparator, and re-sorting by total
    // would break the rule that a player who scored zero still outranks one who never turned up.
    final entries = leaderboard?.entries ?? const <GameLeaderboardResponseDtoEntriesInner>[];
    final ranks = competitionRanks([for (final entry in entries) entry.total]);
    final roundCount = challenge.rounds.length;

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
        RoundReviewList(
          challengeId: challenge.id,
          rounds: challenge.rounds,
          onRoundTap: (index) =>
              unawaited(context.pushRoute(GameRoundReviewRoute(challengeId: challenge.id, index: index))),
        ),
      ],
    );
  }
}

/// The completion screen for a SOLO challenge: what you scored, and a way straight into the next
/// game. Deliberately no leaderboard — see the branch in `_body` for why.
///
/// `ConsumerStatefulWidget` for one flag: creating runs the candidate queries and a CLIP encode
/// server-side, measured at ~9.6s cold, and without shutting the button for that stretch a second
/// tap buys a second game from one intent.
class _SoloCompleted extends ConsumerStatefulWidget {
  const _SoloCompleted({required this.challenge});

  final GameChallengeDetailResponseDto challenge;

  @override
  ConsumerState<_SoloCompleted> createState() => _SoloCompletedState();
}

class _SoloCompletedState extends ConsumerState<_SoloCompleted> {
  bool _startingAgain = false;

  Future<void> _playAgain() async {
    if (_startingAgain) return;
    setState(() => _startingAgain = true);

    String? nextId;
    try {
      // No `sources`: the finished challenge froze its own toggles onto its row and does not report
      // them back, so the stored preference — the player's standing choice — is what a one-click
      // rematch draws from. Mobile never sends an override at all (see SoloGameApiRepository).
      final next = await ref
          .read(soloGameApiRepositoryProvider)
          .create(roundCount: widget.challenge.roundCount.toInt(), type: challengeTypeOf(widget.challenge.rounds));
      nextId = next.id;
    } catch (error) {
      if (context.mounted) {
        ImmichToast.show(
          context: context,
          msg: soloCreateFailureKey(error).t(context: context),
          toastType: ToastType.error,
        );
      }
    } finally {
      // Cleared BEFORE the push, not after it: `pushRoute` does not complete until the pushed route
      // POPS, so clearing it afterwards would leave this button disabled for the whole next game
      // and dead on the way back. Same shape as PhotoGuesserPage's create.
      if (mounted) setState(() => _startingAgain = false);
    }

    // Pushed rather than replaced, matching web's `goto`: PhotoGuesserPage awaits the FIRST push
    // and refreshes its stats and history when it completes, so replacing this route would report
    // that the game was over while the rematch was still being played.
    if (nextId != null && context.mounted) await context.pushRoute(GamePlayRoute(challengeId: nextId));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          'game_completed'.t(context: context),
          textAlign: TextAlign.center,
          style: theme.textTheme.headlineSmall,
        ),
        const SizedBox(height: 16),
        Text(
          // Grouped BEFORE interpolation: `game_points` substitutes {score} verbatim, so a raw
          // number renders "18420 pts".
          'game_points'.t(context: context, args: {'score': formatGameScore(soloTotal(widget.challenge.rounds))}),
          key: const Key('solo-score-total'),
          textAlign: TextAlign.center,
          style: theme.textTheme.displaySmall?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 24),
        FilledButton(
          key: const Key('solo-play-again'),
          onPressed: _startingAgain ? null : () => unawaited(_playAgain()),
          child: _startingAgain
              ? const SizedBox(
                  key: Key('solo-play-again-waiting'),
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator.adaptive(strokeWidth: 2),
                )
              : Text('game_solo_play_again'.t(context: context)),
        ),
        RoundReviewList(
          challengeId: widget.challenge.id,
          rounds: widget.challenge.rounds,
          onRoundTap: (index) =>
              unawaited(context.pushRoute(GameRoundReviewRoute(challengeId: widget.challenge.id, index: index))),
        ),
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
