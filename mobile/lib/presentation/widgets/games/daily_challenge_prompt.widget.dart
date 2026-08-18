import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';

/// Asked once per space, of editors only. Declining is sticky and reversible.
class DailyChallengePrompt extends StatelessWidget {
  const DailyChallengePrompt({super.key, required this.onDecide});

  final void Function(bool enabled) onDecide;

  @override
  Widget build(BuildContext context) {
    return Card(
      key: const Key('daily-prompt'),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text('game_daily_enable_title'.t(context: context)),
            Text('game_daily_enable_description'.t(context: context)),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  key: const Key('daily-prompt-decline'),
                  onPressed: () => onDecide(false),
                  child: Text('game_daily_decline'.t(context: context)),
                ),
                FilledButton(
                  key: const Key('daily-prompt-enable'),
                  onPressed: () => onDecide(true),
                  child: Text('game_daily_enable'.t(context: context)),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
