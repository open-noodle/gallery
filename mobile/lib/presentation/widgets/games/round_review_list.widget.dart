import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/round_photo_placeholder.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/game/game_session.provider.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:openapi/api.dart';

/// The rounds of a finished challenge, newest game's own order, one row each.
///
/// Only guessed rounds appear: a round with no guess has no photo, no answer and no score, so a
/// placeholder row would be untappable and read as a bug. When nothing was guessed the whole
/// section disappears rather than leaving a heading over an empty list.
class RoundReviewList extends StatelessWidget {
  const RoundReviewList({super.key, required this.challengeId, required this.rounds, required this.onRoundTap});

  final String challengeId;
  final List<GameRoundDetailResponseDto> rounds;
  final void Function(int index) onRoundTap;

  @override
  Widget build(BuildContext context) {
    // `score` is the answered marker and is `Optional<num?>` — `.value` THROWS, so this must stay
    // `.orElse(null)`. A score of 0 is a real result and counts as guessed.
    final played = rounds.where((round) => round.score.orElse(null) != null).toList();
    if (played.isEmpty) return const SizedBox.shrink();

    return Column(
      key: const Key('round-review-list'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 24, 4, 8),
          child: Text('game_review_your_rounds'.t(context: context), style: Theme.of(context).textTheme.titleMedium),
        ),
        for (final round in played)
          _ReviewRow(
            key: Key('round-review-row-${round.index.toInt()}'),
            challengeId: challengeId,
            round: round,
            onTap: () => onRoundTap(round.index.toInt()),
          ),
      ],
    );
  }
}

class _ReviewRow extends StatelessWidget {
  const _ReviewRow({super.key, required this.challengeId, required this.round, required this.onTap});

  final String challengeId;
  final GameRoundDetailResponseDto round;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final index = round.index.toInt();
    final result = RoundResult.fromRound(round);
    final isLocation = result.type == GameRoundType.location;

    final miss = isLocation
        ? 'game_review_distance_off'.t(context: context, args: {'distance': formatDistanceKm(result.distanceKm ?? 0)})
        : 'game_review_days_off'.t(context: context, args: {'count': '${result.offsetDays ?? 0}'});

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      leading: ClipRRect(
        borderRadius: BorderRadius.circular(9),
        // getRoundImage 404s for a deleted asset and for one that is merely no longer eligible,
        // so this WILL fail for older challenges. Same recovery the live reveal already uses:
        // RoundPhotoPlaceholder. The row's real content is the miss and the score.
        child: SizedBox(
          width: 46,
          height: 46,
          child: Image(
            image: RemoteImageProvider(url: getGameRoundImageUrl(challengeId, index)),
            fit: BoxFit.cover,
            errorBuilder: (_, _, _) => const RoundPhotoPlaceholder(),
          ),
        ),
      ),
      title: Text(
        '${'game_review_round'.t(context: context, args: {'index': '${index + 1}'})} · '
        '${(isLocation ? 'game_review_type_place' : 'game_review_type_date').t(context: context)}',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(miss, maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(formatGameScore(result.score), style: Theme.of(context).textTheme.labelLarge),
          const Icon(Icons.chevron_right),
        ],
      ),
      onTap: onTap,
    );
  }
}
