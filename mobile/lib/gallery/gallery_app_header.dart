import 'package:package_info_plus/package_info_plus.dart';

/// Marks a request as coming from the Gallery app, so the server reports the Gallery version instead of the
/// upstream base version it shows stock Immich apps (server/src/gallery/client-version.ts).
const kGalleryAppHeader = 'x-gallery-app';

Future<Map<String, String>> galleryAppHeaders() async => {
  kGalleryAppHeader: (await PackageInfo.fromPlatform()).version,
};
