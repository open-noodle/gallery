/// Builds the `geo:` URI handed to external map apps on Android.
///
/// Follows RFC 5870 / the Android intent form `geo:lat,lng?q=lat,lng&z=zoom`.
/// Building it with `Uri(scheme: 'geo', host: ...)` instead yields
/// `geo://lat,lng?...&q=lat%2Clng` — the `//` authority and the percent-encoded
/// comma are tolerated by Google Maps but make Baidu Maps treat `q` as search
/// text and Amap fail to open the location (#1087).
Uri buildAndroidGeoUri(double latitude, double longitude, {required int zoom}) {
  final coordinates = '$latitude,$longitude';
  return Uri.parse('geo:$coordinates?q=$coordinates&z=$zoom');
}
