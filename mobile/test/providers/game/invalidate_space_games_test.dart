import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/game/game.provider.dart';
import 'package:openapi/api.dart';

/// Finishing a round changes three things at once, and every one of them is read by a surface the
/// player lands back on: the daily card's Play/Leaderboard state, the challenge list's answered
/// counts, and the month's standings. Invalidating a subset is the bug this pins — the card that
/// still said "Play" after a completed daily was exactly this, with zero of the three refreshed.
void main() {
  GameStandingsResponseDto standings() => GameStandingsResponseDto(month: '2026-08', entries: []);

  testWidgets('invalidateSpaceGames re-fetches the daily, the challenge list and the standings', (tester) async {
    var dailyFetches = 0;
    var challengeFetches = 0;
    var standingsFetches = 0;

    late WidgetRef captured;

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          gameDailyProvider('s1').overrideWith((ref) async {
            dailyFetches++;
            return null;
          }),
          gameChallengesProvider('s1').overrideWith((ref) async {
            challengeFetches++;
            return <GameChallengeListItemResponseDto>[];
          }),
          gameStandingsProvider('s1').overrideWith((ref) async {
            standingsFetches++;
            return standings();
          }),
        ],
        child: MaterialApp(
          home: Consumer(
            builder: (context, ref, _) {
              captured = ref;
              // All three must be watched, or invalidating an unlistened provider is a no-op and
              // the test would pass without proving anything.
              ref.watch(gameDailyProvider('s1'));
              ref.watch(gameChallengesProvider('s1'));
              ref.watch(gameStandingsProvider('s1'));
              return const SizedBox.shrink();
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect([dailyFetches, challengeFetches, standingsFetches], [1, 1, 1], reason: 'initial load');

    invalidateSpaceGames(captured, 's1');
    await tester.pumpAndSettle();

    expect([dailyFetches, challengeFetches, standingsFetches], [2, 2, 2]);
  });

  testWidgets('invalidateSpaceGames leaves another space alone', (tester) async {
    var otherFetches = 0;
    late WidgetRef captured;

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          gameDailyProvider('s1').overrideWith((ref) async => null),
          gameChallengesProvider('s1').overrideWith((ref) async => <GameChallengeListItemResponseDto>[]),
          gameStandingsProvider('s1').overrideWith((ref) async => standings()),
          gameDailyProvider('s2').overrideWith((ref) async {
            otherFetches++;
            return null;
          }),
        ],
        child: MaterialApp(
          home: Consumer(
            builder: (context, ref, _) {
              captured = ref;
              ref.watch(gameDailyProvider('s2'));
              return const SizedBox.shrink();
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(otherFetches, 1);

    invalidateSpaceGames(captured, 's1');
    await tester.pumpAndSettle();

    expect(otherFetches, 1, reason: 'the families are keyed by spaceId; s2 must not be refetched');
  });
}
