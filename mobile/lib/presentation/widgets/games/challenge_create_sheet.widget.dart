import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:openapi/api.dart';

/// Round-count and type pickers. Returns null if the sheet is dismissed.
class ChallengeCreateSheet extends StatefulWidget {
  const ChallengeCreateSheet({super.key});

  static Future<({int roundCount, GameChallengeType type})?> show(BuildContext context) {
    return showModalBottomSheet<({int roundCount, GameChallengeType type})>(
      context: context,
      builder: (_) => const ChallengeCreateSheet(),
    );
  }

  @override
  State<ChallengeCreateSheet> createState() => _ChallengeCreateSheetState();
}

class _ChallengeCreateSheetState extends State<ChallengeCreateSheet> {
  int _roundCount = 5;
  GameChallengeType _type = GameChallengeType.mixed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('game_round_count'.t(context: context)),
          SegmentedButton<int>(
            segments: [
              for (final count in [3, 5, 10])
                ButtonSegment(
                  value: count,
                  label: Text('$count', key: Key('create-round-count-$count')),
                ),
            ],
            selected: {_roundCount},
            onSelectionChanged: (selection) => setState(() => _roundCount = selection.first),
          ),
          const SizedBox(height: 12),
          Text('game_type'.t(context: context)),
          SegmentedButton<GameChallengeType>(
            segments: [
              ButtonSegment(
                value: GameChallengeType.mixed,
                label: Text('game_type_mixed'.t(context: context), key: const Key('create-type-mixed')),
              ),
              ButtonSegment(
                value: GameChallengeType.location,
                label: Text('game_type_location'.t(context: context), key: const Key('create-type-location')),
              ),
              ButtonSegment(
                value: GameChallengeType.date,
                label: Text('game_type_date'.t(context: context), key: const Key('create-type-date')),
              ),
            ],
            selected: {_type},
            onSelectionChanged: (selection) => setState(() => _type = selection.first),
          ),
          const SizedBox(height: 16),
          FilledButton(
            key: const Key('create-submit'),
            onPressed: () => Navigator.of(context).pop((roundCount: _roundCount, type: _type)),
            child: Text('game_new_challenge'.t(context: context)),
          ),
        ],
      ),
    );
  }
}
