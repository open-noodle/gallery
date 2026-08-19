import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/round_progress_hud.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/round_photo_placeholder.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:intl/intl.dart';

/// The date guess surface: a month/year wheel over the photo.
///
/// The server grades a date round at month granularity, so this only has to produce a month and a
/// year — nothing finer.
class DateRound extends StatefulWidget {
  const DateRound({
    super.key,
    required this.challengeId,
    required this.index,
    required this.minYear,
    required this.maxYear,
    required this.roundNumber,
    required this.roundCount,
    required this.onGuess,
  });

  final String challengeId;
  final int index;
  final int minYear;
  final int maxYear;
  final int roundNumber;
  final int roundCount;
  final void Function(DateTime utcMonthStart) onGuess;

  @override
  State<DateRound> createState() => DateRoundState();
}

class DateRoundState extends State<DateRound> {
  late int _year = widget.minYear + (widget.maxYear - widget.minYear) ~/ 2;
  int _month = 7;

  List<int> get years => [for (var y = widget.minYear; y <= widget.maxYear; y++) y];

  /// Test seam: driving two ListWheelScrollViews by gesture is slow and brittle, and the behaviour
  /// under test is what gets EMITTED, not how the wheel scrolls.
  @visibleForTesting
  void debugSelect({required int year, required int month}) => setState(() {
    _year = year;
    _month = month;
  });

  /// Midnight UTC, not local: a local-midnight DateTime lands on the previous or next day depending
  /// on the player's zone, which at a month boundary means the previous or next MONTH — a wrong
  /// answer for a player who guessed right.
  void _guess() => widget.onGuess(DateTime.utc(_year, _month, 1));

  @override
  Widget build(BuildContext context) {
    final monthNames = [for (var m = 1; m <= 12; m++) DateFormat.MMMM().format(DateTime.utc(2020, m, 1))];

    return Stack(
      fit: StackFit.expand,
      children: [
        Image(
          image: RemoteImageProvider(url: getGameRoundImageUrl(widget.challengeId, widget.index)),
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => const RoundPhotoPlaceholder(),
        ),
        // The same HUD LocationRound draws. Without it the progress indicator disappeared on every
        // date round of a mixed challenge, even though both parameters were already required here.
        Positioned(
          top: 8,
          right: 8,
          child: RoundProgressHud(roundNumber: widget.roundNumber, roundCount: widget.roundCount),
        ),
        Positioned(
          left: 12,
          right: 12,
          bottom: 12,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DecoratedBox(
                decoration: BoxDecoration(color: Colors.black87, borderRadius: BorderRadius.circular(12)),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Column(
                    children: [
                      Text(
                        'game_when_was_this'.t(context: context),
                        style: const TextStyle(color: Colors.white70),
                      ),
                      SizedBox(
                        height: 120,
                        child: Row(
                          children: [
                            Expanded(
                              child: _Wheel(
                                itemCount: 12,
                                initialItem: _month - 1,
                                labelAt: (i) => monthNames[i],
                                onSelected: (i) => setState(() => _month = i + 1),
                              ),
                            ),
                            Expanded(
                              child: _Wheel(
                                itemCount: years.length,
                                initialItem: years.indexOf(_year),
                                labelAt: (i) => '${years[i]}',
                                onSelected: (i) => setState(() => _year = years[i]),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              FilledButton(
                key: const Key('date-round-guess'),
                onPressed: _guess,
                child: Text(
                  'game_guess_month_year'.t(
                    context: context,
                    args: {'month': monthNames[_month - 1], 'year': '$_year'},
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Stateful only to own its [FixedExtentScrollController].
///
/// Built inside `build`, the controller was reallocated on every frame the wheel scrolled through
/// — roughly a dozen undisposed controllers per full month scroll, each holding a live scroll
/// position. Created once and disposed here instead, which also stops the wheel snapping back to
/// `initialItem` on every rebuild.
class _Wheel extends StatefulWidget {
  const _Wheel({required this.itemCount, required this.initialItem, required this.labelAt, required this.onSelected});

  final int itemCount;
  final int initialItem;
  final String Function(int index) labelAt;
  final void Function(int index) onSelected;

  @override
  State<_Wheel> createState() => _WheelState();
}

class _WheelState extends State<_Wheel> {
  late final FixedExtentScrollController _controller = FixedExtentScrollController(initialItem: widget.initialItem);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListWheelScrollView.useDelegate(
      controller: _controller,
      itemExtent: 30,
      physics: const FixedExtentScrollPhysics(),
      onSelectedItemChanged: widget.onSelected,
      childDelegate: ListWheelChildBuilderDelegate(
        childCount: widget.itemCount,
        builder: (context, index) => Center(
          child: Text(widget.labelAt(index), style: const TextStyle(color: Colors.white)),
        ),
      ),
    );
  }
}
