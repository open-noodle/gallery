import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/guess_map.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';

/// The photo/map split. The map is the resting state, dismissible with the X so a photo that needs
/// a closer look can have nearly the whole screen.
class LocationRound extends StatefulWidget {
  const LocationRound({
    super.key,
    required this.challengeId,
    required this.index,
    required this.roundNumber,
    required this.roundCount,
    required this.onGuess,
  });

  final String challengeId;
  final int index;
  final int roundNumber;
  final int roundCount;
  final void Function({required double lat, required double lon}) onGuess;

  @override
  State<LocationRound> createState() => LocationRoundState();
}

class LocationRoundState extends State<LocationRound> {
  ({double lat, double lon})? _pin;
  bool _mapVisible = true;

  /// Test seam: placing a pin otherwise requires a live MapLibre surface, which a widget test has
  /// no platform view for.
  @visibleForTesting
  void debugSetPin({required double lat, required double lon}) => setState(() => _pin = (lat: lat, lon: lon));

  void _guess() {
    final pin = _pin;
    if (pin == null) return;
    // maplibre does not wrap the longitude it reports; the server 400s outside +/-180.
    widget.onGuess(lat: pin.lat, lon: wrapLongitude(pin.lon));
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          flex: _mapVisible ? 40 : 88,
          child: Stack(
            fit: StackFit.expand,
            children: [
              Image(
                image: RemoteImageProvider(url: getGameRoundImageUrl(widget.challengeId, widget.index)),
                fit: BoxFit.cover,
              ),
              Positioned(
                top: 8,
                right: 8,
                child: _Hud(roundNumber: widget.roundNumber, roundCount: widget.roundCount),
              ),
            ],
          ),
        ),
        if (_mapVisible)
          Expanded(
            flex: 60,
            child: Stack(
              children: [
                // A bare guess map: never DriftMap, which would fetch and render the space's own
                // geotagged assets onto the surface the answer is hidden on.
                GuessMap(
                  key: const Key('location-round-map'),
                  onTap: (lat, lon) => setState(() => _pin = (lat: lat, lon: lon)),
                ),
                Positioned(
                  top: 8,
                  right: 8,
                  child: IconButton.filled(
                    key: const Key('location-round-dismiss'),
                    icon: const Icon(Icons.close),
                    onPressed: () => setState(() => _mapVisible = false),
                  ),
                ),
                Positioned(
                  left: 12,
                  right: 12,
                  bottom: 12,
                  child: FilledButton(
                    key: const Key('location-round-guess'),
                    onPressed: _pin == null ? null : _guess,
                    child: Text('game_guess'.t(context: context)),
                  ),
                ),
              ],
            ),
          )
        else
          GestureDetector(
            key: const Key('location-round-strip'),
            onTap: () => setState(() => _mapVisible = true),
            child: Container(
              height: 44,
              alignment: Alignment.center,
              color: Theme.of(context).colorScheme.surfaceContainer,
              child: Text('game_place_your_pin'.t(context: context)),
            ),
          ),
      ],
    );
  }
}

class _Hud extends StatelessWidget {
  const _Hud({required this.roundNumber, required this.roundCount});

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
