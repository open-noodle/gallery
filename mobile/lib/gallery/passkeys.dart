import 'package:immich_mobile/platform/passkey_api.g.dart';

/// Whether this Gallery build offers passkey login.
///
/// Upstream's mobile passkeys (immich-33005) need the app associated with the relying party's domain: the iOS
/// `webcredentials:` entitlement and Android's Digital Asset Links. Upstream associates its app with my.immich.app;
/// the Gallery app has no associated domain yet, so a passkey prompt could never complete. Turn this on together
/// with a Gallery `webcredentials:` entitlement and assetlinks.
const galleryPasskeysEnabled = false;

/// The platform passkey API for this build. While passkeys are off it reports them unsupported, which hides the
/// login button and the settings section (`PasskeyStore.enabled`) without touching upstream's passkey code.
PasskeyHostApi galleryPasskeyHostApi() => galleryPasskeysEnabled ? PasskeyHostApi() : GalleryDisabledPasskeyHostApi();

class GalleryDisabledPasskeyHostApi extends PasskeyHostApi {
  @override
  Future<bool> isSupported() async => false;
}
