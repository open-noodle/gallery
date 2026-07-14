import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:logging/logging.dart';
import 'package:openapi/api.dart';

/// The redirect URI this build asks the OAuth provider to send the user back to.
///
/// Branding rewrites this line at release-build time (branding/config.json →
/// mobile.oauth_callback). It MUST stay in sync with the scheme registered in
/// AndroidManifest.xml and with the server's MOBILE_REDIRECT — verify-branding.sh
/// enforces that. iOS needs no registration: ASWebAuthenticationSession intercepts
/// the scheme itself.
const String kOAuthCallbackUri = 'app.immich:///oauth-callback';

/// The scheme half of [kOAuthCallbackUri], e.g. `app.immich`.
String get oAuthCallbackScheme => kOAuthCallbackUri.split(':').first;

final _callbackPattern = RegExp(
  r'^(?!https?:)([a-z][a-z0-9+.\-]*):/{1,3}oauth-callback(?=[?#]|$)',
  caseSensitive: false,
);

/// Collapses a callback URL onto the 3-slash form the server expects, for any scheme.
///
/// Providers echo back whatever slash count they were given, so we may receive
/// `scheme:/oauth-callback`, `scheme://oauth-callback` or `scheme:///oauth-callback`.
String normalizeOAuthCallback(String url) {
  final match = _callbackPattern.firstMatch(url);
  if (match == null) {
    return url;
  }
  return url.replaceFirst(_callbackPattern, '${match.group(1)}:///oauth-callback');
}

class OAuthService {
  final ApiService _apiService;
  final log = Logger('OAuthService');
  OAuthService(this._apiService);

  Future<String?> getOAuthServerUrl(String serverUrl, String state, String codeChallenge) async {
    // Resolve API server endpoint from user provided serverUrl
    await _apiService.resolveAndSetEndpoint(serverUrl);
    log.info("Starting OAuth flow with redirect URI: $kOAuthCallbackUri");

    final dto = await _apiService.oAuthApi.startOAuth(
      OAuthConfigDto(
        redirectUri: kOAuthCallbackUri,
        state: Optional.present(state),
        codeChallenge: Optional.present(codeChallenge),
      ),
    );

    final authUrl = dto?.url;
    log.info('Received Authorization URL: $authUrl');

    return authUrl;
  }

  Future<LoginResponseDto?> oAuthLogin(String oauthUrl, String state, String codeVerifier) async {
    final result = normalizeOAuthCallback(
      await FlutterWebAuth2.authenticate(url: oauthUrl, callbackUrlScheme: oAuthCallbackScheme),
    );

    log.info('Received OAuth callback: $result');

    return await _apiService.oAuthApi.finishOAuth(
      OAuthCallbackDto(url: result, state: Optional.present(state), codeVerifier: Optional.present(codeVerifier)),
    );
  }
}
