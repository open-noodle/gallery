import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/round_photo_placeholder.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:openapi/api.dart';

class ChallengePip extends StatelessWidget {
  const ChallengePip({super.key, required this.filled});

  final bool filled;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      margin: const EdgeInsets.only(right: 4),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: filled ? Theme.of(context).colorScheme.primary : Theme.of(context).colorScheme.surfaceContainerHighest,
      ),
    );
  }
}

class ChallengeCard extends StatelessWidget {
  const ChallengeCard({
    super.key,
    required this.challenge,
    required this.canDelete,
    required this.onTap,
    required this.onDelete,
  });

  final GameChallengeListItemResponseDto challenge;
  final bool canDelete;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  /// A daily is shared state, not one member's row, and the server refuses to delete it with a 400.
  /// Hiding the control keeps the client from offering an action that cannot succeed.
  bool get _deletable => canDelete && challenge.dailyOn == null;

  Future<void> _confirmDelete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('game_delete_challenge'.t(context: context)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text('cancel'.t(context: context)),
          ),
          TextButton(
            key: const Key('challenge-card-delete-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text('delete'.t(context: context)),
          ),
        ],
      ),
    );
    if (confirmed ?? false) onDelete();
  }

  @override
  Widget build(BuildContext context) {
    final answered = challenge.answered.toInt();
    final total = challenge.roundCount.toInt();

    return InkWell(
      key: Key('challenge-card-${challenge.id}'),
      onTap: onTap,
      child: Stack(
        children: [
          // Round 0's image is already a generic, EXIF-free preview keyed by (challenge, index), so
          // using it as a backdrop leaks nothing the player would not see on entering the round.
          Positioned.fill(
            child: Image(
              image: RemoteImageProvider(url: getGameRoundImageUrl(challenge.id, 0)),
              fit: BoxFit.cover,
              opacity: const AlwaysStoppedAnimation(0.5),
              errorBuilder: (_, _, _) => const RoundPhotoPlaceholder(),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                Text(challenge.name),
                Row(
                  children: [
                    for (var i = 0; i < total; i++)
                      ChallengePip(key: Key('challenge-card-pip-$i'), filled: i < answered),
                  ],
                ),
              ],
            ),
          ),
          if (_deletable)
            Positioned(
              top: 0,
              right: 0,
              child: IconButton(
                key: Key('challenge-card-delete-${challenge.id}'),
                icon: const Icon(Icons.delete_outline),
                onPressed: () => _confirmDelete(context),
              ),
            ),
        ],
      ),
    );
  }
}
