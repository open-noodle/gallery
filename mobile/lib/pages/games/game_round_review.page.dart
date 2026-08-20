import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/round_reveal.widget.dart';
import 'package:immich_mobile/providers/game/game_session.provider.dart';

/// One round of a finished challenge, re-opened read-only.
///
/// Reuses the live reveal rather than a second rendering of the same facts: everything it needs is
/// on the round once the caller has guessed it, and `RoundResult.fromRound` is the one mapping.
@RoutePage()
class GameRoundReviewPage extends ConsumerWidget {
  const GameRoundReviewPage({super.key, required this.challengeId, required this.index});

  final String challengeId;
  final int index;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(gameSessionProvider(challengeId));
    final rounds = session.valueOrNull?.challenge.rounds;
    final round = rounds != null && index < rounds.length ? rounds[index] : null;

    // `hasError` is checked separately from `round == null`: a failed load would otherwise spin
    // forever, which is the same dead-end the play page gives a retry for.
    if (session.hasError && round == null) {
      return Scaffold(
        appBar: AppBar(title: Text('game_play'.t(context: context))),
        body: Center(
          child: FilledButton(
            key: const Key('round-review-retry'),
            onPressed: () => ref.invalidate(gameSessionProvider(challengeId)),
            child: Text('retry'.t(context: context)),
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: Text('game_play'.t(context: context))),
      body: round == null
          ? const Center(child: CircularProgressIndicator())
          : RoundReveal(
              challengeId: challengeId,
              index: index,
              result: RoundResult.fromRound(round),
              reviewing: true,
              onNext: () => unawaited(context.maybePop()),
            ),
    );
  }
}
