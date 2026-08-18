import 'dart:async';

import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/asyncvalue_extensions.dart';
import 'package:immich_mobile/widgets/map/map_theme_override.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

/// The answer map: the real location, the player's guess, and a line joining them.
///
/// Circles rather than symbols on purpose. `MapMarkers.addMarkerAtLatLng` hardcodes one shared
/// `assets/location-pin.png` image id, so two symbol markers would be visually identical — the flaw
/// `round-result.svelte` documents on web, where a near-miss collapses both pins into one badge.
class RevealMap extends StatefulWidget {
  const RevealMap({super.key, required this.answer, this.guess});

  final ({double lat, double lon}) answer;
  final ({double lat, double lon})? guess;

  @override
  State<RevealMap> createState() => _RevealMapState();
}

class _RevealMapState extends State<RevealMap> {
  MapLibreMapController? _controller;

  /// Drawn from `onStyleLoadedCallback`, never from `onMapCreated`: `addCircle` and `addLine` call
  /// `_ensureManagerInitialized`, which throws while the style is still loading.
  Future<void> _draw() async {
    final controller = _controller;
    if (controller == null) return;
    final answer = LatLng(widget.answer.lat, widget.answer.lon);
    await controller.addCircle(
      CircleOptions(geometry: answer, circleRadius: 8, circleColor: '#EF5350', circleStrokeWidth: 2),
    );

    final guess = widget.guess;
    if (guess == null) {
      await controller.animateCamera(CameraUpdate.newLatLngZoom(answer, 4));
      return;
    }

    final guessPoint = LatLng(guess.lat, guess.lon);
    await controller.addCircle(
      CircleOptions(geometry: guessPoint, circleRadius: 8, circleColor: '#ACCBFA', circleStrokeWidth: 2),
    );
    await controller.addLine(LineOptions(geometry: [guessPoint, answer], lineColor: '#FFFFFF', lineWidth: 2));
    await controller.animateCamera(
      CameraUpdate.newLatLngBounds(
        LatLngBounds(
          southwest: LatLng(
            guess.lat < widget.answer.lat ? guess.lat : widget.answer.lat,
            guess.lon < widget.answer.lon ? guess.lon : widget.answer.lon,
          ),
          northeast: LatLng(
            guess.lat > widget.answer.lat ? guess.lat : widget.answer.lat,
            guess.lon > widget.answer.lon ? guess.lon : widget.answer.lon,
          ),
        ),
        left: 40,
        right: 40,
        top: 40,
        bottom: 40,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return MapThemeOverride(
      mapBuilder: (style) => style.widgetWhen(
        onData: (styleString) => MapLibreMap(
          styleString: styleString,
          initialCameraPosition: CameraPosition(target: LatLng(widget.answer.lat, widget.answer.lon), zoom: 3),
          onMapCreated: (controller) => _controller = controller,
          onStyleLoadedCallback: () => unawaited(_draw()),
        ),
      ),
    );
  }
}
