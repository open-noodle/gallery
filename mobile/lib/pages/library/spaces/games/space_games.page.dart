import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/challenge_card.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/challenge_create_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/daily_challenge_card.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/standings_section.widget.dart';
import 'package:immich_mobile/providers/game/game.provider.dart';
import 'package:immich_mobile/providers/game/hidden_daily_banner.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';

/// The space Challenges page — composes the daily slot, the standings section and the custom
/// challenge list, with create behind a `+` for editors.
///
/// [gameChallengesProvider] is the only provider that gates the body: the challenge list is this
/// page's reason to exist, so a load failure there earns a dedicated retry control. Everything
/// else this page reads — the space itself (for `dailyChallengeEnabled`), the monthly standings
/// and today's leaderboard — is read through `.valueOrNull`/`.orElse(null)` rather than
/// `.requireValue`/`.when`, so a slow network or a transient failure on any one of them just hides
/// that section instead of throwing and blanking the whole page.
///
/// `HookConsumerWidget` rather than plain `ConsumerWidget`: the standings section needs a stable
/// [GlobalKey] and the list needs a [ScrollController] that both survive rebuilds without being
/// recreated on every provider change — `useMemoized`/`useScrollController` give that, matching the
/// pattern already used by `space_link_album.page.dart`/`space_albums.page.dart` in this directory.
@RoutePage()
class SpaceGamesPage extends HookConsumerWidget {
  const SpaceGamesPage({super.key, required this.spaceId, required this.canEdit});

  final String spaceId;
  final bool canEdit;

  /// Creating is slow — the server runs the candidate queries and a CLIP encode, measured at ~9.6s
  /// cold on a real library — so [creating] drives a visible placeholder for the whole await.
  /// Before it existed the page sat unchanged for ten seconds and the challenge simply appeared.
  ///
  /// It also shuts the create control for the duration: a second tap during that silence submitted
  /// a second challenge.
  Future<void> _create(BuildContext context, WidgetRef ref, ValueNotifier<bool> creating) async {
    final choice = await ChallengeCreateSheet.show(context);
    if (choice == null) return;
    creating.value = true;
    try {
      await ref
          .read(gameApiRepositoryProvider)
          .createChallenge(spaceId, roundCount: choice.roundCount, type: choice.type);
      ref.invalidate(gameChallengesProvider(spaceId));
    } catch (_) {
      if (context.mounted) {
        ImmichToast.show(
          context: context,
          msg: 'game_create_failed'.t(context: context),
          toastType: ToastType.error,
        );
      }
    } finally {
      // In `finally`, so a failure clears it too rather than leaving the placeholder spinning for
      // a create that is never coming. Guarded because the page can be popped mid-flight, and
      // writing to a disposed hook's notifier throws.
      if (context.mounted) {
        creating.value = false;
      }
    }
  }

  Future<void> _delete(BuildContext context, WidgetRef ref, String challengeId) async {
    try {
      await ref.read(gameApiRepositoryProvider).deleteChallenge(challengeId);
      ref.invalidate(gameChallengesProvider(spaceId));
    } catch (_) {
      if (context.mounted) {
        ImmichToast.show(
          context: context,
          msg: 'game_delete_failed'.t(context: context),
          toastType: ToastType.error,
        );
      }
    }
  }

  /// Same shape as [_create]/[_delete]: this is wired into `DailySlot.onDecide`, a
  /// `void Function(bool)`, so the Future is dropped at the call site — without the catch a failed
  /// PATCH would be an unhandled async error and the prompt would just sit there unchanged.
  Future<void> _decideDaily(BuildContext context, WidgetRef ref, bool enabled) async {
    try {
      await ref.read(sharedSpaceApiRepositoryProvider).update(spaceId, dailyChallengeEnabled: enabled);
      ref.invalidate(sharedSpaceProvider(spaceId));
      ref.invalidate(gameDailyProvider(spaceId));
    } catch (_) {
      if (context.mounted) {
        ImmichToast.show(
          context: context,
          msg: 'game_daily_toggle_failed'.t(context: context),
          toastType: ToastType.error,
        );
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scrollController = useScrollController();
    final creating = useState(false);

    final space = ref.watch(sharedSpaceProvider(spaceId));
    final challenges = ref.watch(gameChallengesProvider(spaceId));
    final standings = ref.watch(gameStandingsProvider(spaceId));
    final daily = ref.watch(gameDailyProvider(spaceId));
    final currentUserId = ref.watch(currentUserProvider)?.id ?? '';

    // Playing changes the daily's answered count, this list's progress and the month's standings,
    // and the pop lands straight back on all three. They are cached FutureProviders, so without
    // this refresh the page redraws the pre-play snapshot.
    Future<void> play(String challengeId) async {
      await context.pushRoute(GamePlayRoute(challengeId: challengeId));
      if (!context.mounted) return;
      invalidateSpaceGames(ref, spaceId);
    }

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
    // Deliberately NOT gated on `monthStandings != null`: `shouldShowStandings` only needs the
    // entries when `enabled == false` (checking for pre-opt-in history); when `enabled == true` it
    // returns true unconditionally, which is exactly the case where DailySlot's `daily-standings`
    // button can appear — that button must always have a section to scroll to, even mid-load or on
    // a standings error, not just once the data resolves.
    final showStandings = shouldShowStandings(enabled, [
      for (final entry in monthStandings?.entries ?? const []) entry.daysPlayed,
    ]);

    // Offered to VIEWERS as well as editors, unlike every other control on this page: this is a
    // personal display choice about one reader's own space timeline, not a change to the space.
    // Only where there is a banner to act on, though — the timeline shows one solely for an
    // opted-in space, so a declined or still-un-asked space would get an item that changes
    // nothing visible. Same predicate the sliver gates on, so the two cannot disagree.
    final bannerExists = DailySlot.showsOnTimeline(dailyChallengeEnabled: enabled);
    final bannerHidden = ref.watch(hiddenDailyBannerProvider).contains(spaceId);

    return Scaffold(
      appBar: AppBar(
        title: Text('game_challenges'.t(context: context)),
        actions: [
          if (bannerExists)
            PopupMenuButton<void>(
              key: const Key('space-games-daily-banner-menu'),
              icon: const Icon(Icons.more_vert),
              itemBuilder: (context) => [
                PopupMenuItem<void>(
                  // Keyed by what the tap will DO, not by the control, so a test reads the current
                  // state without going through the translated label.
                  key: Key(bannerHidden ? 'space-games-daily-banner-show' : 'space-games-daily-banner-hide'),
                  onTap: () => ref.read(hiddenDailyBannerProvider.notifier).setHidden(spaceId, !bannerHidden),
                  child: Text(
                    (bannerHidden ? 'game_daily_show_in_space' : 'game_daily_hide_in_space').t(context: context),
                  ),
                ),
              ],
            ),
        ],
      ),
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
          controller: scrollController,
          padding: const EdgeInsets.all(12),
          children: [
            DailySlot(
              spaceId: spaceId,
              dailyChallengeEnabled: enabled,
              canEdit: canEdit,
              // The one surface that carries the opt-in prompt.
              allowPrompt: true,
              onDecide: (value) => _decideDaily(context, ref, value),
              onPlay: () => unawaited(play(dailyChallenge!.id)),
              // No route to offer: this page already shows the board, immediately below.
              onStandings: null,
            ),
            const SizedBox(height: 16),
            if (showStandings) ...[
              standings.when(
                loading: () => const Padding(
                  key: Key('standings-loading'),
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(child: CircularProgressIndicator()),
                ),
                error: (_, _) => Center(
                  child: FilledButton(
                    key: const Key('standings-retry'),
                    onPressed: () => ref.invalidate(gameStandingsProvider(spaceId)),
                    child: Text('retry'.t(context: context)),
                  ),
                ),
                data: (month) => StandingsSection(
                  today: todayBoard?.valueOrNull,
                  todayRoundCount: dailyChallenge?.roundCount.toInt() ?? 0,
                  month: month,
                  currentUserId: currentUserId,
                ),
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
                    onPressed: creating.value ? null : () => unawaited(_create(context, ref, creating)),
                  ),
              ],
            ),
            // Sits at the top of the list, the same size as a real card, so the wait appears
            // exactly where the finished challenge will land instead of somewhere unrelated.
            if (creating.value)
              const Padding(
                padding: EdgeInsets.only(bottom: 12),
                child: SizedBox(
                  key: Key('space-games-creating'),
                  height: 100,
                  child: Card(
                    child: Center(
                      child: SizedBox(height: 24, width: 24, child: CircularProgressIndicator.adaptive(strokeWidth: 2)),
                    ),
                  ),
                ),
              ),
            if (list.isEmpty && !creating.value)
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
                      onTap: () => unawaited(play(challenge.id)),
                      onDelete: () => _delete(context, ref, challenge.id),
                    ),
                  ),
                ),
          ],
        ),
      ),
    );
  }
}
