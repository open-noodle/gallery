import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Right-edge A–Z scrubber. Tap OR drag a letter to invoke [onLetter].
/// [letterToIndex] marks which buckets have entries (others render muted
/// and do NOT fire callbacks).
class AlphaScrubber extends StatefulWidget {
  final Map<String, int> letterToIndex; // '#' and 'A'..'Z'
  final ValueChanged<String> onLetter;
  const AlphaScrubber({super.key, required this.letterToIndex, required this.onLetter});

  static const List<String> letters = [
    'A',
    'B',
    'C',
    'D',
    'E',
    'F',
    'G',
    'H',
    'I',
    'J',
    'K',
    'L',
    'M',
    'N',
    'O',
    'P',
    'Q',
    'R',
    'S',
    'T',
    'U',
    'V',
    'W',
    'X',
    'Y',
    'Z',
    '#',
  ];

  @override
  State<AlphaScrubber> createState() => _AlphaScrubberState();
}

class _AlphaScrubberState extends State<AlphaScrubber> {
  String? _currentLetter;

  void _handlePosition(Offset local, Size rail) {
    final idx = (local.dy / rail.height * AlphaScrubber.letters.length)
        .clamp(0, AlphaScrubber.letters.length - 1)
        .floor();
    final letter = AlphaScrubber.letters[idx];
    if (letter == _currentLetter) return;
    setState(() => _currentLetter = letter);
    if (widget.letterToIndex.containsKey(letter)) {
      HapticFeedback.selectionClick();
      widget.onLetter(letter);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        final railSize = Size(constraints.maxWidth, constraints.maxHeight);
        return GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTapDown: (details) => _handlePosition(details.localPosition, railSize),
          onVerticalDragStart: (details) => _handlePosition(details.localPosition, railSize),
          onVerticalDragUpdate: (details) => _handlePosition(details.localPosition, railSize),
          onVerticalDragEnd: (_) => setState(() => _currentLetter = null),
          onVerticalDragCancel: () => setState(() => _currentLetter = null),
          onTapUp: (_) => setState(() => _currentLetter = null),
          onTapCancel: () => setState(() => _currentLetter = null),
          child: Stack(
            children: [
              Column(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  for (final l in AlphaScrubber.letters)
                    Text(
                      l,
                      key: Key('alpha-scrubber-$l'),
                      style: theme.textTheme.labelSmall?.copyWith(
                        fontSize: 10.5,
                        color: widget.letterToIndex.containsKey(l)
                            ? theme.colorScheme.primary
                            : theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.35),
                      ),
                    ),
                ],
              ),
              if (_currentLetter != null)
                Positioned(
                  right: 32,
                  top:
                      (AlphaScrubber.letters.indexOf(_currentLetter!) / AlphaScrubber.letters.length) *
                          railSize.height -
                      24,
                  child: _PreviewBubble(letter: _currentLetter!),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _PreviewBubble extends StatelessWidget {
  final String letter;
  const _PreviewBubble({required this.letter});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return IgnorePointer(
      child: Container(
        key: const Key('alpha-scrubber-preview'),
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: theme.colorScheme.primaryContainer,
          boxShadow: const [BoxShadow(blurRadius: 6, color: Colors.black26)],
        ),
        alignment: Alignment.center,
        child: Text(letter, style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600)),
      ),
    );
  }
}
