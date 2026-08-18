import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/daily_challenge_prompt.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/game/game.provider.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';

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
        error: (_, _) => Card(
          child: Center(child: Text('game_daily_unavailable'.t(context: context))),
        ),
        data: (challenge) {
          if (challenge == null) {
            return Card(
              child: Center(child: Text('game_daily_unavailable'.t(context: context))),
            );
          }
          final played = challenge.answered >= challenge.roundCount;
          return Card(
            key: const Key('daily-card'),
            clipBehavior: Clip.antiAlias,
            child: Stack(
              children: [
                // Round 0's image is already a generic, EXIF-free preview keyed by (challenge,
                // index), so using it as a backdrop leaks nothing the player would not see on
                // entering the round.
                Positioned.fill(
                  child: Image(
                    image: RemoteImageProvider(url: getGameRoundImageUrl(challenge.id, 0)),
                    fit: BoxFit.cover,
                    opacity: const AlwaysStoppedAnimation(0.45),
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
                            Text('game_daily_challenge'.t(context: context)),
                            if (played)
                              Text(
                                'game_daily_next_in'.t(
                                  context: context,
                                  args: {'time': timeUntilNextDaily(DateTime.now().toUtc())},
                                ),
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
