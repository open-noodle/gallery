import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';

/// "Round 2 of 5", over the round photo.
///
/// Shared by both guess surfaces rather than owned by one of them: a mixed challenge alternates
/// location and date rounds, so a HUD that only `LocationRound` drew made the progress indicator
/// vanish on every date round.
class RoundProgressHud extends StatelessWidget {
  const RoundProgressHud({super.key, required this.roundNumber, required this.roundCount});

  final int roundNumber;
  final int roundCount;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(8)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Text(
          'game_round_progress'.t(context: context, args: {'current': '$roundNumber', 'total': '$roundCount'}),
          style: const TextStyle(color: Colors.white),
        ),
      ),
    );
  }
}
