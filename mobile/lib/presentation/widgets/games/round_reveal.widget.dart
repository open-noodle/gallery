import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/reveal_map.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/game/game_session.provider.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:intl/intl.dart';
import 'package:openapi/api.dart';

/// The reveal. Location rounds get the map, because what a location reveal has to communicate is
/// spatial; date rounds get a tick strip instead of a map they have no use for.
class RoundReveal extends StatelessWidget {
  const RoundReveal({
    super.key,
    required this.challengeId,
    required this.index,
    required this.result,
    required this.onNext,
  });

  final String challengeId;
  final int index;
  final RoundResult result;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) {
    final isLocation = result.type == GameRoundType.location;
    return Column(
      children: [
        Expanded(child: isLocation ? _map() : _photo()),
        _summary(context),
      ],
    );
  }

  Widget _photo() => Image(
    image: RemoteImageProvider(url: getGameRoundImageUrl(challengeId, index)),
    fit: BoxFit.cover,
    color: Colors.black54,
    colorBlendMode: BlendMode.darken,
  );

  // Null, not (0, 0): a failed post-guess refetch leaves `result.answer` null while `score`/`guess`
  // stay real (see `RevealMap`'s doc comment for the full explanation). Fabricating (0, 0) there
  // would draw the "actual location" pin at Null Island as if it were the real answer.
  Widget _map() {
    final answer = result.answer;
    final lat = answer?.lat;
    final lon = answer?.lon;
    return RevealMap(
      key: const Key('round-reveal-map'),
      answer: lat != null && lon != null ? (lat: lat.toDouble(), lon: lon.toDouble()) : null,
      guess: result.guess,
    );
  }

  Widget _summary(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'game_points'.t(context: context, args: {'score': '${result.score}'}),
            key: const Key('round-reveal-score'),
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          LinearProgressIndicator(value: scorePercent(result.score) / 100),
          const SizedBox(height: 8),
          if (result.type == GameRoundType.location && result.distanceKm != null)
            Text('game_you_were_away'.t(context: context, args: {'distance': formatDistanceKm(result.distanceKm!)}))
          else if (result.type == GameRoundType.date)
            _DateStrip(result: result),
          const SizedBox(height: 12),
          FilledButton(
            key: const Key('round-reveal-next'),
            onPressed: onNext,
            child: Text('game_next_round'.t(context: context)),
          ),
        ],
      ),
    );
  }
}

class _DateStrip extends StatelessWidget {
  const _DateStrip({required this.result});

  final RoundResult result;

  @override
  Widget build(BuildContext context) {
    final answerDate = result.answer?.date;
    // `game_you_were_off` takes a single PRE-FORMATTED {offset} with its unit included, mirroring
    // `game_you_were_away`. The day noun comes from the existing generic `cutoff_day` pluraliser
    // rather than a new key — exactly what web's round-result.svelte does.
    final offsetLabel = result.offsetDays == null
        ? null
        : '${result.offsetDays} ${'cutoff_day'.t(context: context, args: {'count': result.offsetDays!})}';

    return Column(
      key: const Key('round-reveal-timeline'),
      children: [
        if (offsetLabel != null) Text('game_you_were_off'.t(context: context, args: {'offset': offsetLabel})),
        if (answerDate != null)
          Text(DateFormat.yMMMM().format(answerDate.toUtc()), style: Theme.of(context).textTheme.titleMedium),
      ],
    );
  }
}
