import 'dart:async';

import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/asyncvalue_extensions.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:immich_mobile/widgets/map/map_theme_override.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

/// The answer map: the real location, the player's guess, and a line joining them.
///
/// Circles rather than symbols on purpose. `MapMarkers.addMarkerAtLatLng` hardcodes one shared
/// `assets/location-pin.png` image id, so two symbol markers would be visually identical — the flaw
/// `round-result.svelte` documents on web, where a near-miss collapses both pins into one badge.
///
/// [answer] is nullable. A failed post-guess refetch leaves `RoundResult.answer` null while
/// `score`/`guess` stay real (`GameSessionController._reveal` keeps the stale pre-guess challenge on
/// that failure) — a second null-answer path, distinct from the 409-recovery one, which instead
/// nulls out [guess]. Neither may be papered over with a fabricated `(0, 0)`: that would draw the
/// "actual location" circle at Null Island and a join line to it, showing the player a fake answer
/// as the real one. A null point here simply isn't drawn — mirrors `round-result.svelte`'s
/// `answer?.lat != null && answer?.lon != null ? [...] : []`.
class RevealMap extends StatefulWidget {
  const RevealMap({super.key, required this.answer, this.guess});

  final ({double lat, double lon})? answer;
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
    final answer = widget.answer;
    final guess = widget.guess;

    if (answer != null) {
      await controller.addCircle(
        CircleOptions(
          geometry: LatLng(answer.lat, answer.lon),
          circleRadius: 8,
          circleColor: '#EF5350',
          circleStrokeWidth: 2,
        ),
      );
    }
    if (guess != null) {
      await controller.addCircle(
        CircleOptions(
          geometry: LatLng(guess.lat, guess.lon),
          circleRadius: 8,
          circleColor: '#ACCBFA',
          circleStrokeWidth: 2,
        ),
      );
    }

    if (answer != null && guess != null) {
      await controller.addLine(
        LineOptions(
          geometry: [LatLng(guess.lat, guess.lon), LatLng(answer.lat, answer.lon)],
          lineColor: '#FFFFFF',
          lineWidth: 2,
        ),
      );
      // revealBounds, not plain min/max: a guess and answer straddling the antimeridian (e.g.
      // 179.5° / -179.5°, ~110 km apart) must fit the ~1° short arc between them, not the 359°
      // long way round the globe that naive min/max would produce.
      final bounds = revealBounds(answer, guess);
      await controller.animateCamera(
        CameraUpdate.newLatLngBounds(
          LatLngBounds(
            southwest: LatLng(bounds.southLat, bounds.westLon),
            northeast: LatLng(bounds.northLat, bounds.eastLon),
          ),
          left: 40,
          top: 40,
          right: 40,
          bottom: 40,
        ),
      );
      return;
    }

    // Exactly one of answer/guess is present (or, degenerately, neither) — centre on whichever real
    // point exists rather than fitting a bounds box that would need two points.
    final single = answer ?? guess;
    if (single != null) {
      await controller.animateCamera(CameraUpdate.newLatLngZoom(LatLng(single.lat, single.lon), 4));
    }
  }

  @override
  Widget build(BuildContext context) {
    final initial = widget.answer ?? widget.guess;
    return MapThemeOverride(
      mapBuilder: (style) => style.widgetWhen(
        onData: (styleString) => MapLibreMap(
          styleString: styleString,
          initialCameraPosition: initial == null
              ? const CameraPosition(target: LatLng(20, 0), zoom: 0.5)
              : CameraPosition(target: LatLng(initial.lat, initial.lon), zoom: 3),
          onMapCreated: (controller) => _controller = controller,
          onStyleLoadedCallback: () => unawaited(_draw()),
        ),
      ),
    );
  }
}
