import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:immich_mobile/extensions/asyncvalue_extensions.dart';
import 'package:immich_mobile/widgets/map/map_theme_override.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

/// A bare guessing map: a MapLibre surface with no marker source of its own.
///
/// Deliberately NOT DriftMap. DriftMap fetches asset markers, which on a guessing surface would
/// paint the space's geotagged photos — including the round's own answer — onto the map.
class GuessMap extends StatefulWidget {
  const GuessMap({super.key, required this.onTap, this.initialPin});

  final void Function(double lat, double lon) onTap;

  /// A pin already placed before this widget mounted, e.g. by the location round's own state
  /// surviving a dismiss-to-strip/restore cycle. GuessMap itself is unmounted while dismissed —
  /// _marker, _controller and _styleLoaded all reset on remount — so without this the map would
  /// come back empty even though the parent still holds the coordinates Guess would submit.
  final ({double lat, double lon})? initialPin;

  @override
  State<GuessMap> createState() => _GuessMapState();
}

class _GuessMapState extends State<GuessMap> {
  MapLibreMapController? _controller;
  Symbol? _marker;

  bool _styleLoaded = false;

  Future<void> _onStyleLoaded() async {
    // Mirrors MapMarkers.addMarkerAtLatLng: the "mapMarker" sprite must be registered with the
    // style before a symbol can reference it by name. Only flip _styleLoaded once that
    // registration has actually landed, so a tap that races the style-load callback can't reach
    // addSymbol with an icon name the style doesn't know yet.
    final bytes = await rootBundle.load('assets/location-pin.png');
    await _controller?.addImage('mapMarker', bytes.buffer.asUint8List());
    _styleLoaded = true;

    final pin = widget.initialPin;
    if (pin != null) {
      _marker = await _controller?.addSymbol(
        SymbolOptions(geometry: LatLng(pin.lat, pin.lon), iconImage: 'mapMarker', iconSize: 0.15, iconAnchor: 'bottom'),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return MapThemeOverride(
      mapBuilder: (style) => style.widgetWhen(
        onData: (styleString) => MapLibreMap(
          styleString: styleString,
          initialCameraPosition: const CameraPosition(target: LatLng(20, 0), zoom: 0.5),
          onMapCreated: (controller) => _controller = controller,
          // Annotation managers are only initialised once the style has loaded; adding a symbol
          // before then throws.
          onStyleLoadedCallback: () => unawaited(_onStyleLoaded()),
          onMapClick: (_, coordinates) async {
            widget.onTap(coordinates.latitude, coordinates.longitude);
            if (!_styleLoaded) return;
            if (_marker == null) {
              _marker = await _controller?.addSymbol(
                SymbolOptions(geometry: coordinates, iconImage: 'mapMarker', iconSize: 0.15, iconAnchor: 'bottom'),
              );
            } else {
              await _controller?.updateSymbol(_marker!, SymbolOptions(geometry: coordinates));
            }
          },
        ),
      ),
    );
  }
}
