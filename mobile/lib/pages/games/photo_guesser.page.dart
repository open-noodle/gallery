import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/challenge_card.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/challenge_create_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/round_photo_placeholder.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/game/daily_reminder.provider.dart';
import 'package:immich_mobile/providers/game/solo_game.provider.dart';
import 'package:immich_mobile/repositories/solo_game_api.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:openapi/api.dart';

/// Height of the daily hero.
///
/// Fixed rather than intrinsic because the card is a [Stack] over a photo, which has no height of
/// its own to grow from. Every label inside it is a short fixed-length string in each shipped
/// locale, and the ones that are not fixed-length are capped to one line and ellipsised, so this
/// cannot overflow.
const double _kSoloDailyHeight = 120;

/// PhotoGuesser played solo — today's daily, free play, the player's stats and their game history.
///
/// Reads nothing space-scoped. A player who is in no shared space at all still gets this whole
/// surface, which is the point of the solo scope: `SpaceGamesPage` is the space equivalent and
/// this must not quietly become a second view of it.
///
/// `HookConsumerWidget` for the history paging: "load more" appends to state that has to survive
/// the rebuild every provider refresh causes.
@RoutePage()
class PhotoGuesserPage extends HookConsumerWidget {
  const PhotoGuesserPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final creating = useState(false);
    // Pages 2..n. Page 1 stays in `soloHistoryProvider` so that playing a game refreshes it for
    // free; these are held here because a provider family keyed by page would cache each page
    // independently and go stale one row at a time.
    final extraHistory = useState(const <GameSoloHistoryItemResponseDto>[]);
    final nextHistoryPage = useState(2);
    // Null until a later page has been fetched, at which point that page's flag is the current
    // truth — page 1's `hasNextPage` only ever described the end of page 1.
    final moreAfterExtras = useState<bool?>(null);
    final loadingMore = useState(false);

    // The reminder needs to know when the solo daily is confirmed unavailable (the player's
    // library cannot fill one today), and this is the ONLY place that reads it — reading it again
    // just to check would be the exact GENERATING call the reminder file avoids everywhere else.
    // `previous == null` on the FIRST resolution also reports, which is correct: a cold-started
    // reminder schedule was built without knowing today's answer yet.
    //
    // `next is AsyncData`, not `next.hasValue`: AsyncLoading and AsyncError both RETAIN the
    // previous value, so once this has resolved null once, hasValue would stay true (with value
    // still null) through a later failed refetch — offline, a server error — and a network blip
    // would get recorded as a confirmed unavailability, costing the player that day's reminder for
    // a reason that has nothing to do with their library.
    //
    // `!next.isLoading` on top of that: a REFRESH over existing data (invalidateSoloGames, or a
    // manual retry) represents its in-flight phase as `AsyncData(isLoading: true, value: <the
    // RETAINED previous value>)`, not as `AsyncLoading` — so `next is AsyncData` alone still
    // matches while yesterday's null is only sitting there because nothing has come back yet. Only
    // a SETTLED AsyncData (not mid-refresh) is a genuine resolution.
    ref.listen(soloDailyProvider, (previous, next) {
      if (next is AsyncData<GameChallengeListItemResponseDto?> && !next.isLoading && next.value == null) {
        unawaited(ref.read(dailyReminderProvider).recordSoloDailyUnavailable());
      }
    });

    final daily = ref.watch(soloDailyProvider);
    final stats = ref.watch(soloStatsProvider);
    final history = ref.watch(soloHistoryProvider);

    void resetHistoryPaging() {
      extraHistory.value = const [];
      nextHistoryPage.value = 2;
      moreAfterExtras.value = null;
    }

    Future<void> play(String challengeId) async {
      await context.pushRoute(GamePlayRoute(challengeId: challengeId));
      if (!context.mounted) return;
      invalidateSoloGames(ref);
      // The appended pages were cut from a list that no longer starts where it did: the game just
      // played is history's newest row now, so every page after the first shifts by one and the
      // seam would repeat a row. Refetching page 1 is the provider's job; dropping the rest is
      // this.
      resetHistoryPaging();
    }

    Future<void> startFreePlay() async {
      final choice = await ChallengeCreateSheet.show(context);
      if (choice == null || !context.mounted) return;

      creating.value = true;
      String? challengeId;
      try {
        final challenge = await ref
            .read(soloGameApiRepositoryProvider)
            .create(roundCount: choice.roundCount, type: choice.type);
        challengeId = challenge.id;
        // A thin pool builds a SHORTER game rather than failing, so a player who asked for 10
        // rounds can silently get 3. Without this the only clue is the round counter on the first
        // screen, which reads as a bug. Matches what web says on the same outcome.
        //
        // `game_solo_rounds_fewer_than_requested`, not the space key: that one reads "This space's
        // photos filled…", and several of its translations hard-code the product noun, so it would
        // tell a solo player — who may belong to no space at all — about photos in a space.
        //
        // Info rather than error: the game is playable and about to open, and the toast rides over
        // it. Shown before `play()` pushes the route, since fluttertoast outlives the navigation.
        if (challenge.roundCount < choice.roundCount && context.mounted) {
          ImmichToast.show(
            context: context,
            msg: 'game_solo_rounds_fewer_than_requested'.t(
              context: context,
              args: {'actual': '${challenge.roundCount}', 'requested': '${choice.roundCount}'},
            ),
          );
        }
      } catch (error) {
        if (context.mounted) {
          ImmichToast.show(
            context: context,
            msg: soloCreateFailureKey(error).t(context: context),
            toastType: ToastType.error,
          );
        }
      } finally {
        // Cleared BEFORE the play route is pushed, not after it pops: the control would otherwise
        // sit disabled for the whole game and read as broken on the way back. Guarded because the
        // page can be popped mid-create, and writing to a disposed hook's notifier throws.
        if (context.mounted) creating.value = false;
      }

      if (challengeId != null && context.mounted) await play(challengeId);
    }

    Future<void> loadMoreHistory() async {
      if (loadingMore.value) return;
      loadingMore.value = true;
      try {
        final next = await ref
            .read(soloGameApiRepositoryProvider)
            .getHistory(page: nextHistoryPage.value, size: kSoloHistoryPageSize);
        if (!context.mounted) return;
        extraHistory.value = [...extraHistory.value, ...next.items];
        moreAfterExtras.value = next.hasNextPage;
        nextHistoryPage.value += 1;
      } catch (_) {
        if (context.mounted) {
          ImmichToast.show(
            context: context,
            msg: 'scaffold_body_error_occurred'.t(context: context),
            toastType: ToastType.error,
          );
        }
      } finally {
        if (context.mounted) loadingMore.value = false;
      }
    }

    final soloStats = stats.valueOrNull;

    return Scaffold(
      appBar: AppBar(title: Text('photoguesser'.t(context: context))),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          // The daily leads the page: it is the reason to come back, and it is the only game that
          // feeds the streak.
          SizedBox(
            height: _kSoloDailyHeight,
            child: daily.when(
              loading: () => const Card(child: Center(child: CircularProgressIndicator())),
              // A failure earns a retry; the null below does not. A null challenge is not a failed
              // fetch — the player's library genuinely cannot fill a daily today — so re-fetching
              // it would return the same null.
              error: (_, _) => Card(
                key: const Key('solo-daily-error'),
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'game_challenge_load_failed'.t(context: context),
                        textAlign: TextAlign.center,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      TextButton(
                        key: const Key('solo-daily-retry'),
                        onPressed: () => ref.invalidate(soloDailyProvider),
                        child: Text('retry'.t(context: context)),
                      ),
                    ],
                  ),
                ),
              ),
              data: (challenge) => challenge == null
                  ? const _SoloDailyUnavailable()
                  : _SoloDailyCard(challenge: challenge, onPlay: () => unawaited(play(challenge.id))),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            key: const Key('solo-start-free-play'),
            icon: const Icon(Icons.add),
            // Disabled for the whole create, which the server measures in seconds — long enough
            // that without this a second tap lands during the silence and buys a second game.
            onPressed: creating.value ? null : () => unawaited(startFreePlay()),
            label: Text('game_solo_start_free_play'.t(context: context)),
          ),
          if (creating.value)
            const Padding(
              padding: EdgeInsets.only(top: 12),
              child: Center(
                child: SizedBox(
                  key: Key('solo-creating'),
                  height: 24,
                  width: 24,
                  child: CircularProgressIndicator.adaptive(strokeWidth: 2),
                ),
              ),
            ),
          const SizedBox(height: 24),
          // Stats degrade to nothing rather than blanking the page. No retry, deliberately: the
          // panel is five numbers with no empty state of their own, so a half-drawn version of it
          // — a heading over a retry button — says less than the space it takes, and the daily
          // above is what the player came for. History is different, and gets the full treatment
          // below: it is a list whose emptiness is meaningful, so silence there would read as
          // "you have played nothing" when the truth is "the request failed".
          if (soloStats != null) ...[_SoloStats(stats: soloStats), const SizedBox(height: 24)],
          Text('game_solo_history'.t(context: context), style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          history.when(
            loading: () => const Padding(
              key: Key('solo-history-loading'),
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator()),
            ),
            // The heading above stays put in every branch, so a failure reads as "this section
            // could not load" rather than as a section that does not exist.
            error: (_, _) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Column(
                children: [
                  Text('scaffold_body_error_occurred'.t(context: context), textAlign: TextAlign.center),
                  TextButton(
                    key: const Key('solo-history-retry'),
                    onPressed: () {
                      // The appended pages were cut from the list this refetch replaces, so they
                      // go with it — same reasoning as the reset after a game.
                      resetHistoryPaging();
                      ref.invalidate(soloHistoryProvider);
                    },
                    child: Text('retry'.t(context: context)),
                  ),
                ],
              ),
            ),
            data: (firstPage) => _SoloHistory(
              items: [...firstPage.items, ...extraHistory.value],
              hasNextPage: moreAfterExtras.value ?? firstPage.hasNextPage,
              loading: loadingMore.value,
              onLoadMore: () => unawaited(loadMoreHistory()),
              onOpen: (id) => unawaited(play(id)),
            ),
          ),
        ],
      ),
    );
  }
}

/// The daily slot when the player's library cannot fill one today.
///
/// Deliberately NOT `game_daily_unavailable` (which says "to this space" — a solo player may be in
/// no space at all) and deliberately NOT `game_solo_no_photos`, the free-play copy. That sentence
/// offers the create sheet's source toggles as the remedy, and those are a per-game override; the
/// daily is generated server-side from the STORED preference. A player who followed it would get a
/// playable free-play game and this same card, unchanged, forever.
class _SoloDailyUnavailable extends StatelessWidget {
  const _SoloDailyUnavailable();

  @override
  Widget build(BuildContext context) {
    return Card(
      key: const Key('solo-daily-unavailable'),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Text(
            'game_solo_daily_unavailable'.t(context: context),
            textAlign: TextAlign.center,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ),
    );
  }
}

class _SoloDailyCard extends StatelessWidget {
  const _SoloDailyCard({required this.challenge, required this.onPlay});

  final GameChallengeListItemResponseDto challenge;
  final VoidCallback onPlay;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final answered = challenge.answered.toInt();
    final total = challenge.roundCount.toInt();
    final played = answered >= total;

    return Card(
      key: const Key('solo-daily-card'),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        // The whole card, so a finished daily still opens — on its completion screen — instead of
        // being a dead panel until tomorrow.
        onTap: onPlay,
        child: Stack(
          children: [
            // Round 0's image is already a generic, EXIF-free preview keyed by (challenge, index),
            // so using it as a backdrop leaks nothing the player would not see on entering the
            // round. Same call ChallengeCard makes.
            Positioned.fill(
              child: Image(
                image: RemoteImageProvider(url: getGameRoundImageUrl(challenge.id, 0)),
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => const RoundPhotoPlaceholder(),
              ),
            ),
            // Dark at the left behind the text, clear by the right where only the button sits (and
            // that carries its own fill). Tinting the whole card toward the theme surface keeps
            // theme ink legible but washes the photo out, so the card reads as faded rather than
            // as a photo.
            const Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.centerLeft,
                    end: Alignment.centerRight,
                    colors: [Colors.black87, Colors.black45, Colors.transparent],
                    stops: [0.0, 0.45, 1.0],
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'game_daily_challenge'.t(context: context),
                          // White, not theme ink: this sits on the photo, and the scrim above is
                          // what it reads against in either theme.
                          style: theme.textTheme.titleMedium?.copyWith(
                            color: Colors.white,
                            fontWeight: FontWeight.w600,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (played)
                          Text(
                            'game_daily_next_in'.t(
                              context: context,
                              args: {'time': timeUntilNextDaily(DateTime.now().toUtc())},
                            ),
                            style: theme.textTheme.bodySmall?.copyWith(color: Colors.white.withValues(alpha: 0.85)),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Row(
                            children: [
                              for (var i = 0; i < total; i++)
                                ChallengePip(key: Key('solo-daily-pip-$i'), filled: i < answered),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  // A finished daily shows the countdown beside it instead of a button that would
                  // promise a game there is no more of today.
                  if (!played)
                    FilledButton(
                      key: const Key('solo-daily-play'),
                      onPressed: onPlay,
                      child: Text('game_play'.t(context: context)),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The stats panel.
///
/// Two labelled groups, not one grid of five: the halves count DIFFERENT games. The streaks count
/// only fully played dailies; everything else counts every game with a guess in it, free play
/// included. Five tiles under one heading would read as one population and make "Best score" look
/// like "best daily score".
class _SoloStats extends StatelessWidget {
  const _SoloStats({required this.stats});

  final GameSoloStatsResponseDto stats;

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const Key('solo-stats'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SoloStatGroup(
          key: const Key('solo-stats-daily'),
          heading: 'game_daily_challenge',
          tiles: [
            (name: 'current-streak', label: 'game_solo_current_streak', value: stats.currentStreak),
            (name: 'best-streak', label: 'game_solo_best_streak', value: stats.bestStreak),
          ],
        ),
        const SizedBox(height: 16),
        _SoloStatGroup(
          key: const Key('solo-stats-all'),
          heading: 'game_solo_all_games',
          tiles: [
            (name: 'best-score', label: 'game_solo_best_score', value: stats.bestScore),
            (name: 'average-score', label: 'game_solo_average_score', value: stats.averageScore),
            (name: 'games-played', label: 'game_solo_games_played', value: stats.gamesPlayed),
          ],
        ),
      ],
    );
  }
}

class _SoloStatGroup extends StatelessWidget {
  const _SoloStatGroup({super.key, required this.heading, required this.tiles});

  final String heading;
  final List<({String name, String label, num value})> tiles;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          heading.t(context: context),
          style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final tile in tiles)
              Container(
                key: Key('solo-stat-${tile.name}'),
                constraints: const BoxConstraints(minWidth: 104),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerLow,
                  borderRadius: const BorderRadius.all(Radius.circular(16)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // The server returns zeroes, never nulls, for a player with no games — there
                    // is nothing to special-case, and a blank tile would invent an empty state the
                    // data does not have.
                    Text(
                      formatGameScore(tile.value),
                      style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    Text(
                      tile.label.t(context: context),
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _SoloHistory extends StatelessWidget {
  const _SoloHistory({
    required this.items,
    required this.hasNextPage,
    required this.loading,
    required this.onLoadMore,
    required this.onOpen,
  });

  /// Newest first, in the order the server returned them — this list does not re-sort.
  final List<GameSoloHistoryItemResponseDto> items;
  final bool hasNextPage;
  final bool loading;
  final VoidCallback onLoadMore;
  final void Function(String challengeId) onOpen;

  /// A daily's `name` is the raw UTC date the server stores only to keep the column non-null, so
  /// titling a row with it would show "2026-08-19" in every language. Its date still has to appear
  /// somewhere or every daily row looks identical — that is what the subtitle is for.
  String _title(BuildContext context, GameSoloHistoryItemResponseDto item) =>
      item.dailyOn == null ? item.name : 'game_daily_challenge'.t(context: context);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // No heading here: the page owns it, so it survives the loading and error branches this
    // widget is never built for.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (items.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 24),
            child: Text(
              'game_solo_no_games'.t(context: context),
              key: const Key('solo-history-empty'),
              textAlign: TextAlign.center,
            ),
          )
        else
          for (final item in items)
            ListTile(
              key: Key('solo-history-row-${item.id}'),
              contentPadding: EdgeInsets.zero,
              title: Text(_title(context, item), maxLines: 1, overflow: TextOverflow.ellipsis),
              subtitle: Text(
                // Two formatters, not one: `createdAt` is a UTC instant and `dailyOn` is a
                // date-only value that arrives as LOCAL midnight, so converting the second
                // one the way the first needs would date every daily a day early east of
                // Greenwich. See formatDailyDate.
                '${item.dailyOn == null ? formatGameDate(item.createdAt) : formatDailyDate(item.dailyOn!)} · '
                '${'game_rounds_answered'.t(context: context, args: {'answered': '${item.answered}', 'total': '${item.roundCount}'})}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              trailing: Text(
                'game_points'.t(context: context, args: {'score': formatGameScore(item.total)}),
                style: theme.textTheme.titleSmall?.copyWith(color: theme.colorScheme.primary),
              ),
              onTap: () => onOpen(item.id),
            ),
        // `hasNextPage` is the only signal that history is truncated; without this the player never
        // sees anything past the first page.
        if (hasNextPage)
          Center(
            child: TextButton(
              key: const Key('solo-history-load-more'),
              onPressed: loading ? null : onLoadMore,
              child: Text('load_more'.t(context: context)),
            ),
          ),
      ],
    );
  }
}
