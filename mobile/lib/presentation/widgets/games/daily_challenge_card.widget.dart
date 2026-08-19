import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/daily_challenge_prompt.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/game/game.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:immich_mobile/widgets/spaces/space_collage.dart';

/// Height reserved for the opted-in card (played or unplayed).
///
/// The sliver must declare its height BEFORE the daily arrives — the scrubber consumes it
/// synchronously at layout time — so this is a constant rather than a measurement. The played and
/// unplayed cards are the same height for the same reason.
///
/// Kept separate from [kDailyPromptHeight]: this card's labels are fixed-length strings across
/// every shipped locale (a short title, an optional "next in Xh Ym" line, a one-word button), so a
/// constant is safe here. The opt-in prompt's free-form description is not — see
/// [kDailyPromptHeight] and `DailyChallengePrompt`.
const double kDailyCardHeight = 108;

/// Height reserved for the opt-in prompt shown to editors of an un-asked space.
///
/// Deliberately a *different* constant from [kDailyCardHeight]: the prompt carries a full
/// localised sentence (`game_daily_enable_description`) whose length varies a lot by locale — the
/// same "no overflow, ever" requirement as the card, but the card's fixed-length labels can share
/// one height while this can't safely share it with them. This value is sized generously enough
/// for every locale measured against a 360dp phone (see the widget test's narrow-phone/German
/// group), but it is not itself what makes overflow impossible — `DailyChallengePrompt` caps the
/// title and description to `maxLines` + ellipsis, wraps its whole column in a
/// `SingleChildScrollView`, and lays the decline/enable buttons out in an `OverflowBar` (which
/// stacks them instead of overflowing horizontally when they don't fit — the failure this height
/// alone cannot prevent, since it's a width problem). A future locale longer than any of these
/// degrades or scrolls; it does not throw.
const double kDailyPromptHeight = 132;

/// The tri-state daily slot.
///
/// | dailyChallengeEnabled | editor  | viewer  |
/// | null                  | prompt  | nothing |
/// | true                  | card    | card    |
/// | false                 | nothing | nothing |
class DailySlot extends ConsumerWidget {
  const DailySlot({
    super.key,
    required this.spaceId,
    required this.dailyChallengeEnabled,
    required this.canEdit,
    required this.onDecide,
    required this.onPlay,
    required this.onStandings,
  });

  final String spaceId;
  final bool? dailyChallengeEnabled;
  final bool canEdit;
  final void Function(bool enabled) onDecide;
  final VoidCallback onPlay;
  final VoidCallback onStandings;

  /// The height to reserve. Depends only on values the page already holds synchronously, never on
  /// the daily provider's async state.
  static double reservedHeight({required bool? dailyChallengeEnabled, required bool canEdit}) {
    if (dailyChallengeEnabled == null) return canEdit ? kDailyPromptHeight : 0;
    return dailyChallengeEnabled ? kDailyCardHeight : 0;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (dailyChallengeEnabled == null) {
      return canEdit
          ? SizedBox(
              height: kDailyPromptHeight,
              child: DailyChallengePrompt(onDecide: onDecide),
            )
          : const SizedBox.shrink();
    }
    if (!dailyChallengeEnabled!) return const SizedBox.shrink();

    // Only reached for an opted-in space: reading this generates the daily server-side.
    final daily = ref.watch(gameDailyProvider(spaceId));

    return SizedBox(
      height: kDailyCardHeight,
      child: daily.when(
        loading: () => const Card(child: Center(child: CircularProgressIndicator())),
        // A failure earns a retry, like the challenge list's and the standings section's. Only
        // this branch gets one: a null challenge below is not a failure — the space genuinely has
        // no daily to fetch today — so re-fetching it would just fail the same way again.
        // Structured like DailyChallengePrompt (capped lines, scrollable) so a long locale
        // degrades instead of overflowing the fixed-height slot.
        error: (_, _) => Card(
          key: const Key('daily-card-error'),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'game_daily_unavailable'.t(context: context),
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  TextButton(
                    key: const Key('daily-retry'),
                    onPressed: () => ref.invalidate(gameDailyProvider(spaceId)),
                    child: Text('retry'.t(context: context)),
                  ),
                ],
              ),
            ),
          ),
        ),
        data: (challenge) {
          if (challenge == null) {
            return Card(
              child: Center(child: Text('game_daily_unavailable'.t(context: context))),
            );
          }
          final played = challenge.answered >= challenge.roundCount;
          final theme = Theme.of(context);

          // The space's own cover, not a round image. A round preview is the wrong picture for a
          // space-level bar, and it costs a full preview (120-800KB measured) to decorate a
          // 108px strip -- a cover thumbnail is ~20KB.
          //
          // Both fields are `Optional<...>`: reading `.value` while ABSENT throws, so these must
          // stay `.orElse(null)`. Same trap as `dailyChallengeEnabled` on the Challenges page.
          final space = ref.watch(sharedSpaceProvider(spaceId)).valueOrNull;
          final coverAssetId = space?.thumbnailAssetId.orElse(null);
          final gradient = spaceGradientColors(space?.color.orElse(null));

          // A space with no cover (and a cover that fails to load) falls back to the space's own
          // colour, matching SpaceCollage's empty state.
          Widget gradientFill() => DecoratedBox(
            key: const Key('daily-card-gradient'),
            decoration: BoxDecoration(
              gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: gradient),
            ),
          );

          return Card(
            key: const Key('daily-card'),
            clipBehavior: Clip.antiAlias,
            child: Stack(
              children: [
                Positioned.fill(
                  child: coverAssetId == null
                      ? gradientFill()
                      : Image(
                          key: const Key('daily-card-cover'),
                          image: RemoteImageProvider(url: getThumbnailUrlForRemoteId(coverAssetId)),
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => gradientFill(),
                        ),
                ),
                // Scrim tinted to the card surface rather than plain black: it keeps the theme's
                // own text colours legible over any cover, in light and dark alike.
                Positioned.fill(child: ColoredBox(color: theme.colorScheme.surface.withValues(alpha: 0.6))),
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
                              style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            if (played)
                              Text(
                                'game_daily_next_in'.t(
                                  context: context,
                                  args: {'time': timeUntilNextDaily(DateTime.now().toUtc())},
                                ),
                                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                          ],
                        ),
                      ),
                      played
                          ? FilledButton(
                              key: const Key('daily-standings'),
                              onPressed: onStandings,
                              child: Text('game_leaderboard'.t(context: context)),
                            )
                          : FilledButton(
                              key: const Key('daily-play'),
                              onPressed: onPlay,
                              child: Text('game_play'.t(context: context)),
                            ),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
