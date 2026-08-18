import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';

/// Asked once per space, of editors only. Declining is sticky and reversible.
///
/// Every piece of text here is free-form localised content with no length guarantee — German's
/// `game_daily_enable_description` ("Spiele täglich eine gemeinsame Herausforderung in diesem
/// Space. Die Punkte zählen für die monatliche Bestenliste.") runs noticeably longer than
/// English, and a narrow phone (~360dp) wraps it to more lines than the 800dp default
/// `flutter_test` surface ever exercises. Two independent overflow risks follow, and both are
/// handled structurally rather than by tuning a height constant against one locale:
///
/// - The title and description could demand more *vertical* space than the fixed-height slot
///   gives them. Both are capped with `maxLines` + `TextOverflow.ellipsis`, and the whole column
///   sits in a [SingleChildScrollView] as a last-resort fallback so a locale that still doesn't
///   fit scrolls instead of throwing a `RenderFlex` overflow.
/// - The decline/enable button pair could demand more *horizontal* space than the row has (this
///   is what actually broke first, even for German's short button labels — the buttons'
///   Material padding alone doesn't fit two of them at 360dp). [OverflowBar] is the standard
///   Material answer: lay the pair out horizontally when they fit, and fall back to stacking them
///   vertically — never overflowing either axis — when they don't.
class DailyChallengePrompt extends StatelessWidget {
  const DailyChallengePrompt({super.key, required this.onDecide});

  final void Function(bool enabled) onDecide;

  @override
  Widget build(BuildContext context) {
    return Card(
      key: const Key('daily-prompt'),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('game_daily_enable_title'.t(context: context), maxLines: 1, overflow: TextOverflow.ellipsis),
              Text('game_daily_enable_description'.t(context: context), maxLines: 2, overflow: TextOverflow.ellipsis),
              OverflowBar(
                alignment: MainAxisAlignment.end,
                overflowAlignment: OverflowBarAlignment.end,
                spacing: 8,
                overflowSpacing: 4,
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
      ),
    );
  }
}
