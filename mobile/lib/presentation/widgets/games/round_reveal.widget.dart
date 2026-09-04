import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/reveal_map.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/round_photo_placeholder.widget.dart';
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
    this.reviewing = false,
  });

  final String challengeId;
  final int index;
  final RoundResult result;
  final VoidCallback onNext;

  /// True when this reveal is a read-only re-render of an already-finished round
  /// (`GameRoundReviewPage`), as opposed to the live play loop advancing to the next one. Swaps
  /// the advance button's label and, via `onNext`, its behaviour — the live loop passes
  /// `controller.next`, review passes a pop. Defaults false so the live loop is unaffected.
  final bool reviewing;

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
    key: const Key('round-reveal-photo'),
    image: RemoteImageProvider(url: getGameRoundImageUrl(challengeId, index)),
    fit: BoxFit.cover,
    color: Colors.black54,
    colorBlendMode: BlendMode.darken,
    errorBuilder: (_, _, _) => const RoundPhotoPlaceholder(),
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
            child: Text((reviewing ? 'done' : 'game_next_round').t(context: context)),
          ),
        ],
      ),
    );
  }
}

/// The date round's answer to the location round's map: a tick strip carrying the player's own
/// guess alongside the real date, each labelled, so the offset above it is something the player
/// can actually check rather than a number with nothing to compare against.
class _DateStrip extends StatelessWidget {
  const _DateStrip({required this.result});

  final RoundResult result;

  @override
  Widget build(BuildContext context) {
    final answerDate = result.answer?.date;
    final guessDate = result.guessDate;
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
        const SizedBox(height: 8),
        const Divider(height: 1),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Both markers are optional for the same reasons the location map's pins are: a 409
            // recovery has no guess of ours to show, and a failed post-guess refetch leaves the
            // answer null. Whichever survives is still worth showing on its own.
            if (guessDate != null)
              _DateMarker(
                key: const Key('round-reveal-date-guess'),
                label: 'game_guess'.t(context: context),
                date: guessDate,
              ),
            if (answerDate != null)
              _DateMarker(
                key: const Key('round-reveal-date-answer'),
                label: 'game_actual'.t(context: context),
                date: answerDate,
              ),
          ],
        ),
      ],
    );
  }
}

/// One labelled tick on the strip.
///
/// Formatted from the UTC date, not the local one: the server grades at month granularity, and
/// formatting in the viewer's zone would show the previous month to anyone west of Greenwich.
class _DateMarker extends StatelessWidget {
  const _DateMarker({super.key, required this.label, required this.date});

  final String label;
  final DateTime date;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.arrow_drop_up, size: 20),
        Text(label, style: Theme.of(context).textTheme.labelSmall),
        Text(DateFormat.yMMMM().format(date.toUtc()), style: Theme.of(context).textTheme.titleMedium),
      ],
    );
  }
}
