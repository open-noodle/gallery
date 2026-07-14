import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/services/oauth.service.dart';

void main() {
  group('oAuthCallbackScheme', () {
    test('is the scheme half of the callback uri', () {
      expect(oAuthCallbackScheme, kOAuthCallbackUri.split(':').first);
    });

    test('contains no slashes or colons', () {
      expect(oAuthCallbackScheme, isNot(contains(':')));
      expect(oAuthCallbackScheme, isNot(contains('/')));
    });
  });

  group('normalizeOAuthCallback', () {
    // The IdP echoes back whatever slash count it was given, and flutter_web_auth_2
    // hands us the raw string. The server only accepts the 3-slash form.
    test('expands a one-slash legacy callback to three slashes', () {
      expect(
        normalizeOAuthCallback('app.immich:/oauth-callback?code=abc123'),
        'app.immich:///oauth-callback?code=abc123',
      );
    });

    test('expands a two-slash legacy callback to three slashes', () {
      expect(
        normalizeOAuthCallback('app.immich://oauth-callback?code=abc123'),
        'app.immich:///oauth-callback?code=abc123',
      );
    });

    test('leaves an already-normalized legacy callback untouched', () {
      expect(
        normalizeOAuthCallback('app.immich:///oauth-callback?code=abc123'),
        'app.immich:///oauth-callback?code=abc123',
      );
    });

    test('normalizes a branded callback the same way', () {
      expect(
        normalizeOAuthCallback('de.opennoodle.gallery:/oauth-callback?code=abc123'),
        'de.opennoodle.gallery:///oauth-callback?code=abc123',
      );
    });

    test('preserves every query param, including an error response', () {
      expect(
        normalizeOAuthCallback('app.immich:/oauth-callback?error=access_denied&state=456'),
        'app.immich:///oauth-callback?error=access_denied&state=456',
      );
    });

    test('preserves percent-encoded values', () {
      expect(
        normalizeOAuthCallback('app.immich:/oauth-callback?code=a%2Fb%3Dc'),
        'app.immich:///oauth-callback?code=a%2Fb%3Dc',
      );
    });

    test('leaves an unrelated url untouched', () {
      expect(
        normalizeOAuthCallback('https://gallery.example.com/auth/login?code=abc123'),
        'https://gallery.example.com/auth/login?code=abc123',
      );
    });

    test('leaves a lookalike path untouched', () {
      expect(
        normalizeOAuthCallback('app.immich:///oauth-callback-not-really?code=abc123'),
        'app.immich:///oauth-callback-not-really?code=abc123',
      );
    });
  });
}
