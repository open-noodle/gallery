import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

// Gallery's location-permission disclosure for both MapUtils.checkPermAndGetLocation copies
// (lib/utils/map_utils.dart, lib/presentation/widgets/map/map_utils.dart). Candidate to offer upstream.

/// Shows the disclosure dialog; a dismissed dialog counts as "no" (upstream's untyped
/// `showDialog` result throws on null).
Future<bool> confirmLocationDisclosure(BuildContext context, WidgetBuilder dialog) async =>
    await showDialog<bool>(context: context, builder: dialog) ?? false;

/// Permanently denied: disclose first, open the app settings only when the user agrees.
Future<LocationPermission> discloseBeforeAppSettings(BuildContext context, WidgetBuilder dialog) async {
  if (await confirmLocationDisclosure(context, dialog)) {
    await Geolocator.openAppSettings();
  }
  return LocationPermission.deniedForever;
}
