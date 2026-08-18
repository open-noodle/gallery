import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/challenge_card.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/challenge_create_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/daily_challenge_card.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/standings_section.widget.dart';
import 'package:immich_mobile/providers/game/game.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/game_format.dart';

/// The space Challenges page — composes the daily slot, the standings section and the custom
/// challenge list, with create behind a `+` for editors.
///
/// [gameChallengesProvider] is the only provider that gates the body: the challenge list is this
/// page's reason to exist, so a load failure there earns a dedicated retry control. Everything
/// else this page reads — the space itself (for `dailyChallengeEnabled`), its members, the monthly
/// standings and today's leaderboard — is read through `.valueOrNull`/`.orElse(null)` rather than
/// `.requireValue`/`.when`, so a slow network or a transient failure on any one of them just hides
/// that section instead of throwing and blanking the whole page.
@RoutePage()
class SpaceGamesPage extends ConsumerWidget {
  const SpaceGamesPage({super.key, required this.spaceId, required this.canEdit});

  final String spaceId;
  final bool canEdit;

  Future<void> _create(BuildContext context, WidgetRef ref) async {
    final choice = await ChallengeCreateSheet.show(context);
    if (choice == null) return;
    await ref
        .read(gameApiRepositoryProvider)
        .createChallenge(spaceId, roundCount: choice.roundCount, type: choice.type);
    ref.invalidate(gameChallengesProvider(spaceId));
  }

  Future<void> _delete(WidgetRef ref, String challengeId) async {
    await ref.read(gameApiRepositoryProvider).deleteChallenge(challengeId);
    ref.invalidate(gameChallengesProvider(spaceId));
  }

  Future<void> _decideDaily(WidgetRef ref, bool enabled) async {
    await ref.read(sharedSpaceApiRepositoryProvider).update(spaceId, dailyChallengeEnabled: enabled);
    ref.invalidate(sharedSpaceProvider(spaceId));
    ref.invalidate(gameDailyProvider(spaceId));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final space = ref.watch(sharedSpaceProvider(spaceId));
    final challenges = ref.watch(gameChallengesProvider(spaceId));
    final standings = ref.watch(gameStandingsProvider(spaceId));
    final members = ref.watch(sharedSpaceMembersProvider(spaceId));
    final daily = ref.watch(gameDailyProvider(spaceId));
    final currentUserId = ref.watch(currentUserProvider)?.id ?? '';

    // `dailyChallengeEnabled` is `Optional<bool?>` and `Absent.value` THROWS — this must stay
    // `.orElse(null)`, never `.value`.
    final enabled = space.valueOrNull?.dailyChallengeEnabled.orElse(null);
    final dailyChallenge = daily.valueOrNull;
    // Today's board is the DAILY CHALLENGE's own leaderboard, not part of the standings response —
    // it exists only once there is a daily to have one, so it's watched only then. A failure here
    // (or the daily itself failing above) leaves `todayBoard` null, and StandingsSection falls back
    // to the monthly board with no tabs at all rather than throwing.
    final todayBoard = dailyChallenge == null ? null : ref.watch(gameLeaderboardProvider(dailyChallenge.id));

    final monthStandings = standings.valueOrNull;
    final showStandings =
        monthStandings != null &&
        shouldShowStandings(enabled, [for (final entry in monthStandings.entries) entry.daysPlayed]);

    return Scaffold(
      appBar: AppBar(title: Text('game_challenges'.t(context: context))),
      body: challenges.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, _) => Center(
          child: FilledButton(
            key: const Key('space-games-retry'),
            onPressed: () => ref.invalidate(gameChallengesProvider(spaceId)),
            child: Text('retry'.t(context: context)),
          ),
        ),
        data: (list) => ListView(
          padding: const EdgeInsets.all(12),
          children: [
            DailySlot(
              spaceId: spaceId,
              dailyChallengeEnabled: enabled,
              canEdit: canEdit,
              onDecide: (value) => _decideDaily(ref, value),
              onPlay: () => context.pushRoute(GamePlayRoute(challengeId: dailyChallenge!.id)),
              // The monthly/today board already sits inline below on this same page, so there is
              // nowhere else to navigate to yet.
              onStandings: () {},
            ),
            const SizedBox(height: 16),
            if (showStandings) ...[
              StandingsSection(
                today: todayBoard?.valueOrNull,
                todayRoundCount: dailyChallenge?.roundCount.toInt() ?? 0,
                month: monthStandings,
                members: members.valueOrNull ?? const [],
                currentUserId: currentUserId,
              ),
              const SizedBox(height: 16),
            ],
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('game_your_challenges'.t(context: context), style: Theme.of(context).textTheme.titleMedium),
                if (canEdit)
                  IconButton(
                    key: const Key('space-games-create'),
                    icon: const Icon(Icons.add),
                    tooltip: 'game_new_challenge'.t(context: context),
                    onPressed: () => _create(context, ref),
                  ),
              ],
            ),
            if (list.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Text('game_no_challenges'.t(context: context), textAlign: TextAlign.center),
              )
            else
              for (final challenge in list)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: SizedBox(
                    height: 100,
                    child: ChallengeCard(
                      challenge: challenge,
                      canDelete: canEdit,
                      onTap: () => context.pushRoute(GamePlayRoute(challengeId: challenge.id)),
                      onDelete: () => _delete(ref, challenge.id),
                    ),
                  ),
                ),
          ],
        ),
      ),
    );
  }
}
