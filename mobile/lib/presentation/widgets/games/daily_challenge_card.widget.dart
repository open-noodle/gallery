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

/// The tri-state daily slot.
///
/// | dailyChallengeEnabled | editor  | viewer  |
/// | null                  | prompt  | nothing |
/// | true                  | card    | card    |
/// | false                 | nothing | nothing |
///
/// …but only where [allowPrompt] is set. The space TIMELINE passes false, so the prompt row of
/// that table collapses to "nothing" there: an un-asked space shows no banner above its photos at
/// all, and the invitation to turn the daily on lives solely on the Challenges page.
///
/// That split is also what let the prompt stop being fixed-height. It used to be wrapped in a
/// `SizedBox(height: 132)` because the timeline's scrubber needs the sliver's height synchronously
/// — but the prompt carries a full localised sentence and a button pair, and at 360dp the
/// `OverflowBar` stacks those buttons, which alone overran the 132 by 44dp and cut them off. (A
/// 402dp screen fit in 129, which is why this survived review.) Nothing catches it either:
/// `SingleChildScrollView` scrolls the overflow away instead of throwing. Now that the prompt only
/// ever renders in the Challenges page's plain `ListView`, it can size to its content and the
/// whole failure mode is gone rather than re-tuned.
class DailySlot extends ConsumerWidget {
  const DailySlot({
    super.key,
    required this.spaceId,
    required this.dailyChallengeEnabled,
    required this.canEdit,
    required this.onDecide,
    required this.onPlay,
    required this.onStandings,
    this.allowPrompt = false,
  });

  final String spaceId;
  final bool? dailyChallengeEnabled;
  final bool canEdit;
  final void Function(bool enabled) onDecide;
  final VoidCallback onPlay;

  /// Where a played daily sends the reader for the board — or null when the caller has nowhere to
  /// send them, in which case the played card carries no button at all.
  ///
  /// Null on the Challenges page: the standings sit directly beneath this card there, so the
  /// button pointed at something already on screen. Non-null from the space timeline, where it is
  /// the signposted route to that page.
  final VoidCallback? onStandings;

  /// Whether an un-asked space may show the editor opt-in prompt here.
  ///
  /// Only the Challenges page sets it. Defaults to false so the timid choice is the default one:
  /// a new caller shows the card or nothing, never a prompt on a surface that shouldn't carry it.
  final bool allowPrompt;

  /// Whether the SPACE TIMELINE shows a banner at all — which only an opted-in space does.
  ///
  /// Independent of the viewer's role, unlike the Challenges page: the editor opt-in prompt is
  /// deliberately not a timeline surface, so `null` means nothing here for editors and viewers
  /// alike. Two callers besides the sliver need this exact answer — [reservedHeight], and the
  /// Challenges page's "hide the banner in this space" item, which must offer itself only where
  /// there is a banner to hide. Naming it once keeps those three from drifting apart.
  static bool showsOnTimeline({required bool? dailyChallengeEnabled}) => dailyChallengeEnabled == true;

  /// The height the space timeline reserves for this slot, consumed synchronously by the scrubber
  /// before the daily provider resolves.
  ///
  /// [hidden] is the per-device "hide this space's banner" choice and wins over everything else:
  /// the caller drops the slot entirely, so reserving anything would leave a band of empty space
  /// and shift every scrubber offset below it.
  static double reservedHeight({required bool? dailyChallengeEnabled, bool hidden = false}) {
    if (hidden || !showsOnTimeline(dailyChallengeEnabled: dailyChallengeEnabled)) return 0;
    return kDailyCardHeight;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (dailyChallengeEnabled == null) {
      // No fixed height: the only caller that allows the prompt lays it out in a plain ListView,
      // so it sizes to its content in every locale and at every text scale. See the class doc.
      return allowPrompt && canEdit ? DailyChallengePrompt(onDecide: onDecide) : const SizedBox.shrink();
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
                // Anchored where the text is, not spread across the whole card. Tinting the lot
                // toward the theme surface (the first attempt) kept theme ink legible but washed
                // the cover out, so the card read as faded rather than as a photo. Dark at the
                // left behind the title and subtitle, clear by the right where only the button
                // sits — and that carries its own fill.
                const Positioned.fill(
                  child: DecoratedBox(
                    key: Key('daily-card-scrim'),
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
                              // White, not theme ink: this sits on the cover, and the scrim above
                              // is what it reads against in either theme.
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
                          ],
                        ),
                      ),
                      // A played daily with nowhere to send the reader shows no button rather than
                      // a dead one — the countdown beside it is then the card's whole job.
                      played
                          ? (onStandings == null
                                ? const SizedBox.shrink()
                                : FilledButton(
                                    key: const Key('daily-standings'),
                                    onPressed: onStandings,
                                    child: Text('game_leaderboard'.t(context: context)),
                                  ))
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
