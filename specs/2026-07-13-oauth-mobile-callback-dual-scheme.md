# OAuth Mobile Callback — Dual-Scheme Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix OIDC login on the branded Android app (currently broken in every release) without breaking any existing working setup, by making the whole stack accept **both** the legacy `app.immich:///oauth-callback` and the branded `de.opennoodle.gallery:///oauth-callback` callback URIs.

**Architecture:** The root cause is a split-brain between two halves of the same app: `apply-branding.sh` rewrites the scheme the Android app _listens on_ (`app.immich` → `de.opennoodle.gallery`) but nothing rewrites the scheme the app _asks for_ (hardcoded `app.immich` in `oauth.service.dart`). We fix it by (1) registering **both** schemes in the Android manifest, (2) making the server and the mobile client **scheme-agnostic** — they accept any custom-scheme `<scheme>:/{1,3}oauth-callback` — and (3) promoting `branding/config.json` → `mobile.oauth_callback` to the single source of truth for the scheme the app _sends_, wired into the Dart constant, the server constant, and the admin UI hint, with a `verify-branding.sh` assertion that they can never drift apart again.

**Tech Stack:** NestJS 11 + Vitest (server), Flutter/Dart + `flutter_test` (mobile), Bash + `sed` (branding), SvelteKit (admin UI), Docusaurus (docs).

## Global Constraints

- **Zero breakage is the top constraint.** Every admin's IdP today has `app.immich:///oauth-callback` registered (our own docs and admin UI tell them to). After this change, that URI must still work, with no admin action required.
- **`mobile.oauth_callback` is set to `app.immich:///oauth-callback` in this release.** The branded URI becomes fully supported infrastructure — registered, accepted, tested — but the app keeps _sending_ the legacy one so nobody has to touch their IdP. Flipping to branded later is a one-line config change (see "Deferred: Phase 2").
- **Do not commit branded output.** Source keeps upstream Immich references; `apply-branding.sh` rewrites them at Docker/release build time (see `CLAUDE.md`). All branded values are produced by the script, never checked in.
- **Server: no relative imports.** Use the `src/` path alias.
- **The core invariant** (violating it is the bug we are fixing): the scheme the app **sends** == the scheme the server's `MOBILE_REDIRECT` **emits** == a scheme the Android manifest **registers**. `verify-branding.sh` must enforce all three.
- **`http`/`https` URLs must never be rewritten** by the callback-matching logic — the web login flow shares `resolveRedirectUri`.
- Run `pnpm prettier --write` on any markdown under `docs/` before committing — CI Docs Build is strict.

## Task Order (dependencies — do not reorder)

Tasks are **not** independent. Running them out of order fails:

- **Task 3 requires Task 2.** `patch_oauth_callback()` rewrites the literal `kOAuthCallbackUri = 'app.immich:///oauth-callback'`, and `test-oauth-callback-branding.sh` asserts it. That symbol does not exist until Task 2 lands — before then the `sed` is a silent no-op and the test fails on a missing string.
- **Task 5 requires Task 1.** The branded-scheme e2e assertions depend on the scheme-agnostic `MOBILE_CALLBACK_URI`.
- Task 4 (docs) is independent and can run any time.

Order: **1 → 2 → 3 → 4 → 5.**

---

## Background: why it's broken

Verified against the shipped `gallery-v5.1.0.apk`, not just the source:

| Half of the app                         | Value                                       | Source                            |
| --------------------------------------- | ------------------------------------------- | --------------------------------- |
| What it **asks** the IdP to redirect to | `app.immich:///oauth-callback`              | Dart snapshot (`libapp.so`)       |
| What it **registers** with Android      | `de.opennoodle.gallery` + `/oauth-callback` | merged manifest (`aapt2 xmltree`) |

The IdP redirects the browser to `app.immich:///oauth-callback?code=…`, no installed app claims that scheme, and the browser dead-ends on a blank page. `app.immich` occurs **zero** times in the shipped manifest.

Unaffected: **web** (separate https redirect) and **iOS** (`ASWebAuthenticationSession` intercepts the scheme itself, no OS-level registration). It was never caught because dev builds aren't branded, so both halves agree locally and OIDC works fine in development.

Culprit: `branding/scripts/apply-branding.sh:592` rewrites the manifest half only. `branding/config.json`'s `mobile.oauth_callback` key — clearly meant to drive exactly this — is read by nothing.

**Why it happened, systemically:** `apply-branding.sh` currently rewrites **zero** files under `mobile/lib/`. It was built for native/config surfaces (`AndroidManifest.xml`, `Info.plist`, `build.gradle`, `project.pbxproj`) and web. The OAuth callback is the one value that needs a native **and** a Dart change to stay coherent — so only the native half got written. `patch_oauth_callback()` is the script's first Dart-source rewrite, and the invariant check exists because nothing else in the codebase would catch this class of drift.

**Shipping note:** the fix is **app-only**. With the mobile redirect override disabled (the default, and what the reporting user runs), `resolveRedirectUri` is the identity function even on an unpatched server — so a fixed APK logs in against a stock, un-upgraded server. Tasks 1 and 5 harden the server for the branded scheme and for the override path; they are not required to unblock the reporter.

---

## File Structure

**Server (scheme-agnostic matching):**

- Modify `server/src/constants.ts` — add `MOBILE_CALLBACK_URI` regex next to `MOBILE_REDIRECT`.
- Modify `server/src/services/auth.service.ts:644-650` — `resolveRedirectUri` uses the regex instead of the hardcoded `app.immich` literal.
- Test `server/src/services/auth.service.spec.ts` — extend `getMobileRedirect` / `authorize` / `callback` describes.

**Mobile (scheme-agnostic normalization + single source of truth):**

- Modify `mobile/lib/services/oauth.service.dart` — extract two pure, testable helpers; the hardcoded literal becomes one top-level constant that branding rewrites.
- Create `mobile/test/services/oauth_service_test.dart` — first-ever mobile OAuth test.

**Branding (the actual fix + the regression gate):**

- Modify `branding/config.json` — `mobile.oauth_callback` becomes load-bearing.
- Modify `branding/scripts/apply-branding.sh` — new `patch_oauth_callback()` owning every OAuth-scheme rewrite in one place: additive manifest registration + the Dart/server/web callback literals.
- Modify `branding/scripts/verify-branding.sh` — assert the core invariant.
- Create `branding/scripts/test-oauth-callback-branding.sh` — the regression test, following the existing `test-*-branding.sh` harness pattern (source the script, run the real patch against a temp mirror, assert; working tree never mutated).

**E2E (real IdP, the flow that actually broke):**

- Modify `packages/e2e-auth-server/auth-server.ts` — add a `native` client that accepts both custom-scheme callbacks (the mock IdP currently whitelists no custom scheme at all).
- Modify `e2e/src/specs/server/api/oauth.e2e-spec.ts` — cover the custom-scheme flow with the override **disabled**, for both schemes. The existing suite only ever exercises the https-override path.

**Docs / UI:**

- Modify `docs/docs/administration/oauth.md` — all 7 mentions of the callback URI (lines 6, 32, 39, 104, 106, 113, 163); tell admins to register both URIs.
- Modify `web/src/routes/admin/system-settings/AuthSettings.svelte:271` — hint text becomes branding-driven (rewritten by Task 3; no source change).

---

### Task 1: Server accepts any custom-scheme callback

Today `resolveRedirectUri` only recognises `app.immich`. A branded app (or any future scheme) talking to this server would silently skip the mobile-redirect override. Make it scheme-agnostic, while guaranteeing it never touches the web flow's `https` URLs.

**Files:**

- Modify: `server/src/constants.ts:64`
- Modify: `server/src/services/auth.service.ts:644-650`
- Test: `server/src/services/auth.service.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `MOBILE_CALLBACK_URI: RegExp` exported from `src/constants` — matches a custom-scheme mobile OAuth callback prefix, excludes `http`/`https`. `MOBILE_REDIRECT: string` keeps its current name and meaning.

- [ ] **Step 1: Write the failing tests**

Add to `server/src/services/auth.service.spec.ts`, inside the existing top-level `describe(AuthService.name, ...)`:

```ts
describe('resolveRedirectUri (via callback)', () => {
  // Both the legacy and the branded scheme must map onto the https override,
  // so an old app and a new app can both talk to the same server.
  for (const url of [
    'app.immich:/oauth-callback?code=abc123',
    'app.immich://oauth-callback?code=abc123',
    'app.immich:///oauth-callback?code=abc123',
    'de.opennoodle.gallery:/oauth-callback?code=abc123',
    'de.opennoodle.gallery://oauth-callback?code=abc123',
    'de.opennoodle.gallery:///oauth-callback?code=abc123',
    'com.example.fork:///oauth-callback?code=abc123',
  ]) {
    it(`should apply the mobile redirect override to ${url}`, async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithMobileOverride);
      mocks.user.getByOAuthId.mockResolvedValue(UserFactory.create());
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile: OAuthProfileFactory.create() });
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback({ url, state: 'xyz789', codeVerifier: 'foo' }, {}, loginDetails);

      expect(mocks.oauth.getProfileAndOAuthSid).toHaveBeenCalledWith(
        expect.objectContaining({}),
        'http://mobile-redirect?code=abc123',
        'xyz789',
        'foo',
      );
    });
  }

  // The web login flow shares this code path. An https callback must pass through untouched.
  it('should not rewrite an https callback url even when the override is enabled', async () => {
    mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithMobileOverride);
    mocks.user.getByOAuthId.mockResolvedValue(UserFactory.create());
    mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile: OAuthProfileFactory.create() });
    mocks.session.create.mockResolvedValue(SessionFactory.create());

    await sut.callback(
      { url: 'https://gallery.example.com/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
      {},
      loginDetails,
    );

    expect(mocks.oauth.getProfileAndOAuthSid).toHaveBeenCalledWith(
      expect.objectContaining({}),
      'https://gallery.example.com/auth/login?code=abc123',
      'xyz789',
      'foo',
    );
  });

  // A path that merely starts with /oauth-callback must not be partially rewritten.
  it('should not rewrite a lookalike path', async () => {
    mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithMobileOverride);
    mocks.user.getByOAuthId.mockResolvedValue(UserFactory.create());
    mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile: OAuthProfileFactory.create() });
    mocks.session.create.mockResolvedValue(SessionFactory.create());

    await sut.callback(
      { url: 'app.immich:///oauth-callback-not-really?code=abc123', state: 'xyz789', codeVerifier: 'foo' },
      {},
      loginDetails,
    );

    expect(mocks.oauth.getProfileAndOAuthSid).toHaveBeenCalledWith(
      expect.objectContaining({}),
      'app.immich:///oauth-callback-not-really?code=abc123',
      'xyz789',
      'foo',
    );
  });
});

describe('authorize with redirect override', () => {
  it('should send the branded redirect uri straight through when the override is disabled', async () => {
    mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
    mocks.oauth.authorize.mockResolvedValue({ url: 'http://idp/authorize', state: 's', codeVerifier: 'v' });

    await sut.authorize({ redirectUri: 'de.opennoodle.gallery:///oauth-callback' });

    expect(mocks.oauth.authorize).toHaveBeenCalledWith(
      expect.objectContaining({}),
      'de.opennoodle.gallery:///oauth-callback',
      undefined,
      undefined,
    );
  });

  it('should swap a branded redirect uri for the override when it is enabled', async () => {
    mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthWithMobileOverride);
    mocks.oauth.authorize.mockResolvedValue({ url: 'http://idp/authorize', state: 's', codeVerifier: 'v' });

    await sut.authorize({ redirectUri: 'de.opennoodle.gallery:///oauth-callback' });

    expect(mocks.oauth.authorize).toHaveBeenCalledWith(
      expect.objectContaining({}),
      'http://mobile-redirect',
      undefined,
      undefined,
    );
  });
});
```

Extend the existing `describe('getMobileRedirect', ...)` block with the edge cases it is missing:

```ts
it('should preserve every query param, including an error response', () => {
  expect(sut.getMobileRedirect('http://immich.app?error=access_denied&error_description=nope&state=456')).toEqual(
    'app.immich:///oauth-callback?error=access_denied&error_description=nope&state=456',
  );
});

it('should preserve percent-encoded values', () => {
  expect(sut.getMobileRedirect('http://immich.app?code=a%2Fb%3Dc&state=456')).toEqual(
    'app.immich:///oauth-callback?code=a%2Fb%3Dc&state=456',
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && pnpm test -- --run src/services/auth.service.spec.ts
```

Expected: the `de.opennoodle.gallery` / `com.example.fork` override cases FAIL (the URL is passed through unrewritten, because the current regex only matches `app.immich`), and the lookalike-path case FAILS (the current unanchored regex rewrites the `app.immich:///oauth-callback` prefix and leaves `-not-really` dangling). The `app.immich` and `https` cases already pass — that is expected and is what proves we don't regress them.

- [ ] **Step 3: Add the regex to constants**

In `server/src/constants.ts`, directly below the existing `MOBILE_REDIRECT` export:

```ts
export const MOBILE_REDIRECT = 'app.immich:///oauth-callback';

// Matches the custom-scheme mobile OAuth callback of any Gallery/Immich build:
//   app.immich:///oauth-callback             (legacy — every existing IdP config has this)
//   de.opennoodle.gallery:///oauth-callback  (branded)
// Historically the app has emitted 1, 2 or 3 slashes, so all three are accepted.
// The http(s) lookahead is load-bearing: the web login flow shares resolveRedirectUri
// and its callback URL must never be rewritten. The trailing lookahead stops a path
// like /oauth-callback-not-really from being partially replaced.
export const MOBILE_CALLBACK_URI = /^(?!https?:)[a-z][a-z0-9+.-]*:\/{1,3}oauth-callback(?=[?#]|$)/i;
```

- [ ] **Step 4: Use it in the service**

In `server/src/services/auth.service.ts`, update the import on line 8 and the method at 644-650:

```ts
import { LOGIN_URL, MOBILE_CALLBACK_URI, MOBILE_REDIRECT, SALT_ROUNDS } from 'src/constants';
```

```ts
  private resolveRedirectUri(
    { mobileRedirectUri, mobileOverrideEnabled }: { mobileRedirectUri: string; mobileOverrideEnabled: boolean },
    url: string,
  ) {
    if (mobileOverrideEnabled && mobileRedirectUri) {
      return url.replace(MOBILE_CALLBACK_URI, mobileRedirectUri);
    }
    return url;
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd server && pnpm test -- --run src/services/auth.service.spec.ts
```

Expected: PASS, all cases including the pre-existing `app.immich` ones.

- [ ] **Step 6: Commit**

```bash
git add server/src/constants.ts server/src/services/auth.service.ts server/src/services/auth.service.spec.ts
git commit -m "fix(auth): accept any custom-scheme mobile oauth callback, not just app.immich"
```

---

### Task 2: Mobile client normalizes any callback scheme

`oauth.service.dart` hardcodes `app.immich` in three places and has no tests at all. Extract the scheme into one branding-rewritable constant and the URL handling into two pure functions, so both are testable without mocking `FlutterWebAuth2` (whose `authenticate` is a static method and cannot be mocked).

**Files:**

- Modify: `mobile/lib/services/oauth.service.dart`
- Create: `mobile/test/services/oauth_service_test.dart`

**Interfaces:**

- Consumes: `MOBILE_CALLBACK_URI` semantics from Task 1 (same 1-3 slash tolerance, same scheme grammar) — kept deliberately in sync.
- Produces (all top-level in `oauth.service.dart`, importable by tests):
  - `const String kOAuthCallbackUri` — the full redirect URI the app sends. **This is the line `apply-branding.sh` rewrites.**
  - `String get oAuthCallbackScheme` — the scheme half of `kOAuthCallbackUri`.
  - `String normalizeOAuthCallback(String url)` — collapses 1-3 slashes to 3, for _any_ scheme.

- [ ] **Step 1: Write the failing test**

Create `mobile/test/services/oauth_service_test.dart`:

```dart
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
```

- [ ] **Step 2: Run the test to verify it fails**

Use Flutter **3.41.7** (the pinned SDK). From `mobile/`, generate localization/keys once if you haven't (they're gitignored):

```bash
cd mobile
flutter pub get
dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart
flutter test test/services/oauth_service_test.dart
```

Expected: FAIL to compile — `kOAuthCallbackUri`, `oAuthCallbackScheme` and `normalizeOAuthCallback` are not defined.

- [ ] **Step 3: Implement the helpers**

Rewrite `mobile/lib/services/oauth.service.dart`:

```dart
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd mobile && flutter test test/services/oauth_service_test.dart
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Run both CI Dart gates**

CI runs two separate gates; `flutter analyze lib` alone misses test-file lints.

```bash
cd mobile
dart analyze --fatal-infos lib test
dart format --set-exit-if-changed lib test
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/services/oauth.service.dart mobile/test/services/oauth_service_test.dart
git commit -m "fix(mobile): make oauth callback handling scheme-agnostic, add first oauth tests"
```

---

### Task 3: Branding registers both schemes and can no longer drift

This is the actual bug fix and the regression gate. The Android manifest must register **both** schemes, and `verify-branding.sh` must fail loudly if the sent scheme, the registered scheme and the server's emitted scheme ever disagree again.

Note the existing deep-link block at `apply-branding.sh:583-587` is already **additive** — it inserts the branded scheme _alongside_ `immich://`. The OAuth block at line 592 is a **replace**. Making the OAuth block match the deep-link pattern is the fix.

**Files:**

- Modify: `branding/config.json:29`
- Modify: `branding/scripts/apply-branding.sh` — new `patch_oauth_callback()` before `patch_android()` (line 566); delete the destructive OAuth line inside `patch_android()` (line 592); register in `main()` (line 827)
- Modify: `branding/scripts/verify-branding.sh` (new assertion block after the open-in-app one, which ends ~line 226)
- Create: `branding/scripts/test-oauth-callback-branding.sh`

**Interfaces:**

- Consumes: `kOAuthCallbackUri` (Task 2), `MOBILE_REDIRECT` (Task 1) — these are the literals the script rewrites.
- Produces: `patch_oauth_callback()` (sourceable, like every other `patch_*`), plus the `OAUTH_CALLBACK` / `OAUTH_CALLBACK_SCHEME` shell vars, used by `apply-branding.sh`, `verify-branding.sh` and the new test.

- [ ] **Step 1: Set the config to the legacy URI**

The branded value is what we're migrating _towards_; shipping it as the sent URI today would break every admin's IdP. Set `branding/config.json:29` to the legacy URI and record why:

```json
    "deep_link_scheme": "noodle-gallery",
    "_comment_oauth_callback": "The redirect URI the mobile app SENDS. Kept on the legacy app.immich scheme so existing IdP configs keep working; the branded scheme is registered and accepted everywhere, so flipping this to de.opennoodle.gallery:///oauth-callback is a one-line change once admins have had a release to register it.",
    "oauth_callback": "app.immich:///oauth-callback",
```

- [ ] **Step 2: Write the failing verification**

Append to `branding/scripts/verify-branding.sh`, after the open-in-app block. First add the `jq` reads next to the existing ones at the top of the file (after line 11, `DEEP_LINK_SCHEME=…`). Note `verify-branding.sh` currently reads only `NAME`, `UPSTREAM_NAME` and `DEEP_LINK_SCHEME` — **`BUNDLE_ID` is not defined there yet**, and the assertions below need it:

```bash
BUNDLE_ID=$(jq -r '.mobile.bundle_id' "$CONFIG")
OAUTH_CALLBACK=$(jq -r '.mobile.oauth_callback' "$CONFIG")
OAUTH_CALLBACK_SCHEME="${OAUTH_CALLBACK%%:*}"
```

Then the assertion block:

```bash
# OAuth mobile callback: the scheme the app SENDS, the scheme Android REGISTERS and the
# scheme the server EMITS must all agree, and the legacy app.immich scheme must stay
# registered so existing IdP configs keep working. Drift here silently breaks Android
# OIDC login: the browser lands on a scheme no app claims and dead-ends on a blank page.
echo "--- Checking OAuth mobile callback scheme ---"

oauth_dart="$REPO_ROOT/mobile/lib/services/oauth.service.dart"
android_manifest="$REPO_ROOT/mobile/android/app/src/main/AndroidManifest.xml"
server_constants="$REPO_ROOT/server/src/constants.ts"

if [[ -f "$oauth_dart" ]]; then
  if ! grep -q "kOAuthCallbackUri = '${OAUTH_CALLBACK}'" "$oauth_dart"; then
    echo "  FAIL: oauth.service.dart does not send '${OAUTH_CALLBACK}'"
    EXIT_CODE=1
  else
    echo "  OK: app sends ${OAUTH_CALLBACK}"
  fi
else
  echo "  FAIL: oauth.service.dart not found at $oauth_dart"
  EXIT_CODE=1
fi

if [[ -f "$android_manifest" ]]; then
  # The scheme the app sends MUST be registered, or the callback can never reach the app.
  if ! grep -q "android:scheme=\"${OAUTH_CALLBACK_SCHEME}\" android:pathPrefix=\"/oauth-callback\"" "$android_manifest"; then
    echo "  FAIL: AndroidManifest.xml does not register the scheme the app sends (${OAUTH_CALLBACK_SCHEME}) for /oauth-callback"
    EXIT_CODE=1
  # The legacy scheme must stay registered for backwards compatibility.
  elif ! grep -q "android:scheme=\"app.immich\" android:pathPrefix=\"/oauth-callback\"" "$android_manifest"; then
    echo "  FAIL: AndroidManifest.xml missing android:scheme=\"app.immich\" for /oauth-callback (legacy scheme must remain)"
    EXIT_CODE=1
  # The branded scheme must be registered too, so flipping oauth_callback needs no manifest change.
  elif ! grep -q "android:scheme=\"${BUNDLE_ID}\" android:pathPrefix=\"/oauth-callback\"" "$android_manifest"; then
    echo "  FAIL: AndroidManifest.xml missing android:scheme=\"${BUNDLE_ID}\" for /oauth-callback"
    EXIT_CODE=1
  else
    echo "  OK: AndroidManifest.xml registers both app.immich and ${BUNDLE_ID} for /oauth-callback"
  fi
else
  echo "  FAIL: AndroidManifest.xml not found at $android_manifest"
  EXIT_CODE=1
fi

if [[ -f "$server_constants" ]]; then
  if ! grep -q "MOBILE_REDIRECT = '${OAUTH_CALLBACK}'" "$server_constants"; then
    echo "  FAIL: server MOBILE_REDIRECT is not '${OAUTH_CALLBACK}' — the mobile-redirect override would bounce the browser to a scheme the app does not listen on"
    EXIT_CODE=1
  else
    echo "  OK: server MOBILE_REDIRECT emits ${OAUTH_CALLBACK}"
  fi
else
  echo "  FAIL: constants.ts not found at $server_constants"
  EXIT_CODE=1
fi

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "OAuth mobile callback scheme verified"
fi
```

- [ ] **Step 3: Write the failing branding test**

The repo already has a harness pattern for exactly this (`test-email-branding.sh`, `test-app-download-branding.sh`, `test-i18n-branding.sh`): source `apply-branding.sh` to pull in its `patch_*` functions and config globals, mirror only the touched files into a temp `REPO_ROOT`, run the **real** patch function against the mirror, and assert. The working tree is never mutated. Follow it exactly.

Create `branding/scripts/test-oauth-callback-branding.sh`:

```bash
#!/usr/bin/env bash
#
# Regression test for the Android OIDC login bug shipped through v5.1.0.
#
# apply-branding rewrote the scheme the app LISTENS on (AndroidManifest.xml:
# app.immich -> de.opennoodle.gallery) but not the scheme the app ASKS for
# (oauth.service.dart, still app.immich). The IdP then redirected the browser to
# app.immich:///oauth-callback, no installed app claimed that scheme, and the browser
# dead-ended on a blank page — OIDC login was impossible on every branded Android build.
#
# This test runs the REAL patch_oauth_callback() against a throwaway mirror and asserts
# the invariant: the scheme the app SENDS == the scheme the server EMITS == a scheme the
# manifest REGISTERS, with the legacy app.immich scheme always registered for backwards
# compatibility.
#
# The working tree is never mutated (patch runs against a temp mirror), so this is safe
# to run locally and in CI. No image tooling or network access required.
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"

# GNU sed/coreutils on macOS (mirrors .github/actions/apply-branding/action.yml).
if [[ "$(uname)" == "Darwin" ]]; then
  export PATH="/opt/homebrew/opt/gnu-sed/libexec/gnubin:/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"
fi

# Sourcing only defines functions and reads config — main is guarded by BASH_SOURCE.
# shellcheck disable=SC1091
source "$SCRIPT_DIR/apply-branding.sh"
set +e # apply-branding.sh enables `set -e`; a failed grep must not abort the run

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/mobile/lib/services" \
  "$TMP/mobile/android/app/src/main" \
  "$TMP/server/src" \
  "$TMP/web/src/routes/admin/system-settings"
cp "$REPO/mobile/lib/services/oauth.service.dart" "$TMP/mobile/lib/services/"
cp "$REPO/mobile/android/app/src/main/AndroidManifest.xml" "$TMP/mobile/android/app/src/main/"
cp "$REPO/server/src/constants.ts" "$TMP/server/src/"
cp "$REPO/web/src/routes/admin/system-settings/AuthSettings.svelte" "$TMP/web/src/routes/admin/system-settings/"

# Apply the real transformation against the mirror, twice — the branding action runs on a
# fresh checkout, but idempotence keeps a double-apply from duplicating the <data> line.
REPO_ROOT="$TMP" patch_oauth_callback >/dev/null
REPO_ROOT="$TMP" patch_oauth_callback >/dev/null

DART="mobile/lib/services/oauth.service.dart"
MANIFEST="mobile/android/app/src/main/AndroidManifest.xml"
CONSTANTS="server/src/constants.ts"
SETTINGS="web/src/routes/admin/system-settings/AuthSettings.svelte"

fails=0
present() { # <file> <literal> <description>
  if grep -Fq "$2" "$TMP/$1"; then
    echo "  ok:   $3"
  else
    echo "  FAIL: $3 — '$2' missing from $1"
    fails=$((fails + 1))
  fi
}
count_is() { # <file> <literal> <expected> <description>
  local actual
  actual=$(grep -Fc "$2" "$TMP/$1")
  if [[ "$actual" == "$3" ]]; then
    echo "  ok:   $4"
  else
    echo "  FAIL: $4 — expected $3 occurrence(s) of '$2' in $1, found $actual"
    fails=$((fails + 1))
  fi
}

echo "The app sends the configured callback URI:"
present "$DART" "kOAuthCallbackUri = '${OAUTH_CALLBACK}'" "oauth.service.dart sends ${OAUTH_CALLBACK}"

echo "Android registers BOTH schemes for /oauth-callback:"
present "$MANIFEST" "android:scheme=\"${OAUTH_CALLBACK_SCHEME}\" android:pathPrefix=\"/oauth-callback\"" \
  "the scheme the app sends (${OAUTH_CALLBACK_SCHEME}) is registered"
present "$MANIFEST" 'android:scheme="app.immich" android:pathPrefix="/oauth-callback"' \
  "the legacy app.immich scheme is still registered"
present "$MANIFEST" "android:scheme=\"${BUNDLE_ID}\" android:pathPrefix=\"/oauth-callback\"" \
  "the branded ${BUNDLE_ID} scheme is registered"
count_is "$MANIFEST" "android:scheme=\"${BUNDLE_ID}\" android:pathPrefix=\"/oauth-callback\"" 1 \
  "double-apply did not duplicate the branded <data> line"

echo "The server emits the same URI the app sends:"
present "$CONSTANTS" "MOBILE_REDIRECT = '${OAUTH_CALLBACK}'" "server MOBILE_REDIRECT emits ${OAUTH_CALLBACK}"

echo "Admins are shown the same URI:"
present "$SETTINGS" "callback: '${OAUTH_CALLBACK}'" "AuthSettings.svelte shows ${OAUTH_CALLBACK}"

# --- Phase 2 flip simulation -------------------------------------------------
# The plan claims flipping mobile.oauth_callback to the branded URI is a one-line
# change. Prove it: re-run the real patch against a FRESH mirror with OAUTH_CALLBACK
# overridden, and assert the invariant still holds (all four sites agree, and the
# legacy scheme stays registered so older installed app builds keep working).
FLIPPED="${BUNDLE_ID}:///oauth-callback"
TMP2="$(mktemp -d)"
trap 'rm -rf "$TMP" "$TMP2"' EXIT
mkdir -p "$TMP2/mobile/lib/services" \
  "$TMP2/mobile/android/app/src/main" \
  "$TMP2/server/src" \
  "$TMP2/web/src/routes/admin/system-settings"
cp "$REPO/mobile/lib/services/oauth.service.dart" "$TMP2/mobile/lib/services/"
cp "$REPO/mobile/android/app/src/main/AndroidManifest.xml" "$TMP2/mobile/android/app/src/main/"
cp "$REPO/server/src/constants.ts" "$TMP2/server/src/"
cp "$REPO/web/src/routes/admin/system-settings/AuthSettings.svelte" "$TMP2/web/src/routes/admin/system-settings/"

REPO_ROOT="$TMP2" OAUTH_CALLBACK="$FLIPPED" OAUTH_CALLBACK_SCHEME="$BUNDLE_ID" patch_oauth_callback >/dev/null

flipped_present() { # <file> <literal> <description>
  if grep -Fq "$2" "$TMP2/$1"; then
    echo "  ok:   $3"
  else
    echo "  FAIL: $3 — '$2' missing from $1"
    fails=$((fails + 1))
  fi
}

echo "Phase 2 flip (oauth_callback -> ${FLIPPED}) keeps the invariant:"
flipped_present "$DART" "kOAuthCallbackUri = '${FLIPPED}'" "app would send ${FLIPPED}"
flipped_present "$CONSTANTS" "MOBILE_REDIRECT = '${FLIPPED}'" "server would emit ${FLIPPED}"
flipped_present "$SETTINGS" "callback: '${FLIPPED}'" "admins would be shown ${FLIPPED}"
flipped_present "$MANIFEST" "android:scheme=\"${BUNDLE_ID}\" android:pathPrefix=\"/oauth-callback\"" \
  "the flipped scheme is already registered (no manifest change needed)"
flipped_present "$MANIFEST" 'android:scheme="app.immich" android:pathPrefix="/oauth-callback"' \
  "the legacy scheme survives the flip (older installed apps keep working)"

if [[ $fails -gt 0 ]]; then
  echo "FAILED: $fails assertion(s)"
  exit 1
fi
echo "OAuth callback branding verified"
```

Make it executable:

```bash
chmod +x branding/scripts/test-oauth-callback-branding.sh
```

- [ ] **Step 4: Run it to verify it fails**

```bash
./branding/scripts/test-oauth-callback-branding.sh; echo "exit=$?"
```

Expected: **FAIL**, `exit=1`, with `patch_oauth_callback: command not found` — the function does not exist yet. That is the RED state.

- [ ] **Step 5: Add `patch_oauth_callback()` to apply-branding.sh**

Every OAuth-scheme rewrite lives in **one** function. That cohesion is the point: the bug existed because the manifest half and the Dart half were edited in different places by different people at different times.

Add the config reads next to the other `jq` reads at the top of `branding/scripts/apply-branding.sh` (after line 19, `BUNDLE_ID_PROFILE=…`):

```bash
OAUTH_CALLBACK=$(jq -r '.mobile.oauth_callback' "$CONFIG")
OAUTH_CALLBACK_SCHEME="${OAUTH_CALLBACK%%:*}"
```

Then add the function (put it directly before `patch_android()` at line 566):

```bash
# OAuth mobile callback scheme. The invariant, in one place:
#   the URI the app SENDS (oauth.service.dart)
#     == the URI the server EMITS (constants.ts MOBILE_REDIRECT, used by /api/oauth/mobile-redirect)
#     == a scheme Android REGISTERS (AndroidManifest.xml)
#     == the URI shown to admins (AuthSettings.svelte)
# Breaking that invariant is invisible in dev (dev builds aren't branded, so both halves
# agree) and fatal in release: the browser lands on a scheme no app claims and hangs on a
# blank page. verify-branding.sh and test-oauth-callback-branding.sh both enforce it.
#
# The manifest registration is ADDITIVE — app.immich must stay registered because every
# existing IdP config in the wild has app.immich:///oauth-callback as its redirect URI.
patch_oauth_callback() {
  local oauth_dart="$REPO_ROOT/mobile/lib/services/oauth.service.dart"
  local manifest="$REPO_ROOT/mobile/android/app/src/main/AndroidManifest.xml"
  local server_constants="$REPO_ROOT/server/src/constants.ts"
  local auth_settings="$REPO_ROOT/web/src/routes/admin/system-settings/AuthSettings.svelte"

  # The redirect URI the app asks the IdP to send the user back to.
  if [[ -f "$oauth_dart" ]]; then
    sed -i "s|kOAuthCallbackUri = 'app\.immich:///oauth-callback'|kOAuthCallbackUri = '${OAUTH_CALLBACK}'|g" "$oauth_dart"
  fi

  # Register the branded scheme ALONGSIDE app.immich (idempotent, mirrors the deep-link block).
  if [[ -f "$manifest" ]] && ! grep -q "android:scheme=\"${BUNDLE_ID}\" android:pathPrefix=\"/oauth-callback\"" "$manifest"; then
    sed -i "/<data android:scheme=\"app\.immich\" android:pathPrefix=\"\/oauth-callback\" \/>/a\\        <data android:scheme=\"${BUNDLE_ID}\" android:pathPrefix=\"/oauth-callback\" />" "$manifest"
  fi

  # Where /api/oauth/mobile-redirect bounces the browser to. Must equal what the app sends.
  if [[ -f "$server_constants" ]]; then
    sed -i "s|MOBILE_REDIRECT = 'app\.immich:///oauth-callback'|MOBILE_REDIRECT = '${OAUTH_CALLBACK}'|g" "$server_constants"
  fi

  # The callback URI admins copy into their IdP.
  if [[ -f "$auth_settings" ]]; then
    sed -i "s|callback: 'app\.immich:///oauth-callback'|callback: '${OAUTH_CALLBACK}'|g" "$auth_settings"
  fi

  echo "  Patched OAuth callback scheme (${OAUTH_CALLBACK})"
}
```

Delete the old destructive line from `patch_android()` (line 592) — `patch_oauth_callback` owns it now:

```bash
  # AndroidManifest.xml — OAuth callback
  sed -i "s|<data android:scheme=\"app\.immich\"|<data android:scheme=\"${BUNDLE_ID}\"|g" "$manifest"
```

Register the new function in `main()` (line 827), after `patch_ios`:

```bash
  patch_android
  patch_ios
  patch_oauth_callback
  patch_docker
```

- [ ] **Step 6: Run the branding test to verify it passes**

```bash
./branding/scripts/test-oauth-callback-branding.sh; echo "exit=$?"
```

Expected: `exit=0`, every assertion `ok:`, ending in `OAuth callback branding verified` — including `double-apply did not duplicate the branded <data> line`.

- [ ] **Step 7: Run a full apply + verify to check nothing else regressed**

```bash
SCRATCH=$(mktemp -d) && git archive HEAD | tar -x -C "$SCRATCH"
(cd "$SCRATCH" && ./branding/scripts/apply-branding.sh && ./branding/scripts/verify-branding.sh); echo "exit=$?"
grep -A1 'app.immich" android:pathPrefix' "$SCRATCH/mobile/android/app/src/main/AndroidManifest.xml"
```

Expected: `exit=0`, `OAuth mobile callback scheme verified` among the output, and the manifest showing **both** `<data android:scheme="app.immich" …/>` and `<data android:scheme="de.opennoodle.gallery" …/>`. On macOS the script needs GNU sed/coreutils on `PATH` (`brew install gnu-sed coreutils`; the test script above exports them for you, `apply-branding.sh` does not).

- [ ] **Step 8: Commit**

```bash
git add branding/config.json branding/scripts/apply-branding.sh branding/scripts/verify-branding.sh branding/scripts/test-oauth-callback-branding.sh
git commit -m "fix(branding): register both oauth callback schemes, enforce sent==registered==emitted"
```

---

### Task 4: Docs and admin UI tell admins to register both

Our own docs and admin UI are where admins copy the redirect URI from — the Authelia example at `oauth.md:160-163` is almost certainly where the reporting user got theirs. Both must now list **both** URIs so that a future flip to the branded scheme is a no-op for anyone who followed them.

**Files:**

- Modify: `docs/docs/administration/oauth.md` (lines 6, 31-39, 102-113, 160-163)
- Modify: `web/src/routes/admin/system-settings/AuthSettings.svelte:271` — no code change needed; Task 3 rewrites the literal. Verify only.

**Interfaces:**

- Consumes: `OAUTH_CALLBACK` from Task 3.
- Produces: nothing.

- [ ] **Step 1: Update the redirect URI list**

In `docs/docs/administration/oauth.md`, change the mobile bullets (lines 31-39) to list both, and say why:

```markdown
The **Sign-in redirect URIs** should include:

- `app.immich:///oauth-callback` — for logging in with OAuth from the [Mobile App](/features/mobile-app.mdx)
- `de.opennoodle.gallery:///oauth-callback` — the branded mobile callback. Register this **as well**; a future app release will switch to it, and registering it now means that release will Just Work.
```

Apply the same both-URIs treatment to the Authelia `redirect_uris:` example at lines 160-163:

```yaml
redirect_uris:
  - 'https://gallery.example.com/auth/login'
  - 'app.immich:///oauth-callback'
  - 'de.opennoodle.gallery:///oauth-callback'
```

- [ ] **Step 2: Note the Android registration in the Mobile Redirect URI section**

Append to the `## Mobile Redirect URI` section (after line 113):

> The Android app registers **both** `app.immich` and `de.opennoodle.gallery` as callback schemes, and the server accepts a callback on either, so both redirect URIs work. The app currently _sends_ `app.immich:///oauth-callback`; if you enable **Mobile Redirect URI Override**, the server bounces the browser back to that same URI.

- [ ] **Step 3: Format and verify**

```bash
pnpm prettier --write docs/docs/administration/oauth.md
cd web && pnpm check:typescript && pnpm lint
```

Expected: prettier clean (CI Docs Build is strict), web checks pass (~640 pre-existing tailwind warnings are tolerated).

- [ ] **Step 4: Commit**

```bash
git add docs/docs/administration/oauth.md
git commit -m "docs(oauth): register both mobile callback redirect URIs"
```

---

### Task 5: End-to-end coverage of the custom-scheme flow against a real IdP

The e2e suite already runs a **real OIDC provider** (`packages/e2e-auth-server`, `node-oidc-provider`) and has a `loginWithOAuth(sub, redirectUri)` helper that drives authorize → login → consent → callback. But its `describe('mobile redirect override')` block only ever exercises the **https override** path, so the mock IdP's redirect-URI whitelist (`auth-server.ts:99-102`) contains no custom scheme at all — and the exact flow that is broken in production (custom scheme, override **disabled**) has never been tested end-to-end. Close that.

Note `node-oidc-provider` rejects a custom-scheme `redirect_uri` on a client whose `application_type` is `web` (the default) — it throws `invalid_client_metadata` at provider init. Custom schemes require `application_type: 'native'`, which is also how real IdPs model a mobile app. Hence a dedicated client rather than adding URIs to the existing ones.

**Files:**

- Modify: `packages/e2e-auth-server/auth-server.ts:11-15` (enum), `:99-102` (redirect URIs), `:147-171` (clients)
- Modify: `e2e/src/specs/server/api/oauth.e2e-spec.ts`

**Interfaces:**

- Consumes: the scheme-agnostic `resolveRedirectUri` from Task 1.
- Produces: `OAuthClient.MOBILE = 'client-mobile'` — a `native` client accepting both custom-scheme callbacks.

- [ ] **Step 1: Add a native client to the mock IdP**

In `packages/e2e-auth-server/auth-server.ts`, extend the enum:

```ts
export enum OAuthClient {
  DEFAULT = 'client-default',
  RS256_TOKENS = 'client-RS256-tokens',
  RS256_PROFILE = 'client-RS256-profile',
  MOBILE = 'client-mobile',
}
```

Add the custom-scheme URIs and the native client inside `setup()`:

```ts
const redirectUris = ['http://127.0.0.1:2285/auth/login', 'https://photos.immich.app/oauth/mobile-redirect'];

// A mobile app is a native client. node-oidc-provider only permits custom-scheme
// redirect URIs on application_type: 'native' — a 'web' client throws at init.
const mobileRedirectUris = ['app.immich:///oauth-callback', 'de.opennoodle.gallery:///oauth-callback'];
```

and, in the `clients` array:

```ts
      {
        client_id: OAuthClient.MOBILE,
        client_secret: OAuthClient.MOBILE,
        application_type: 'native',
        redirect_uris: mobileRedirectUris,
        grant_types: ['authorization_code'],
        response_types: ['code'],
      },
```

- [ ] **Step 2: Write the failing e2e test**

Add to `e2e/src/specs/server/api/oauth.e2e-spec.ts`, as a sibling of `describe('mobile redirect override')`:

```ts
// The flow that was broken in every branded Android release: a custom-scheme redirect
// URI with the override DISABLED. Both the legacy and the branded scheme must work.
describe('mobile custom scheme (no override)', () => {
  beforeAll(async () => {
    await setupOAuth(admin.accessToken, {
      enabled: true,
      clientId: OAuthClient.MOBILE,
      clientSecret: OAuthClient.MOBILE,
      buttonText: 'Login with Immich',
      storageLabelClaim: 'immich_username',
      mobileOverrideEnabled: false,
      mobileRedirectUri: '',
    });
  });

  for (const redirectUri of ['app.immich:///oauth-callback', 'de.opennoodle.gallery:///oauth-callback']) {
    it(`should pass ${redirectUri} through to the provider untouched`, async () => {
      const { status, body } = await request(app).post('/oauth/authorize').send({ redirectUri });
      expect(status).toBe(201);

      const params = new URL(body.url).searchParams;
      expect(params.get('redirect_uri')).toBe(redirectUri);
    });

    it(`should complete a full login round-trip via ${redirectUri}`, async () => {
      const callbackParams = await loginWithOAuth(`oauth-scheme-${redirectUri.split(':')[0]}`, redirectUri);
      expect(callbackParams.url).toEqual(expect.stringContaining(redirectUri));

      const { status, body } = await request(app).post('/oauth/callback').send(callbackParams);
      expect(status).toBe(201);
      expect(body).toMatchObject({
        accessToken: expect.any(String),
        isAdmin: false,
        name: 'OAuth User',
        userId: expect.any(String),
      });
    });
  }
});
```

- [ ] **Step 3: Run the e2e suite to verify the new tests fail**

Docker is required and available on this machine.

```bash
cd e2e && pnpm test -- --run src/specs/server/api/oauth.e2e-spec.ts
```

Expected: the two new `should pass … through` tests FAIL before Task 1 lands (the server rewrites/mishandles the branded scheme). If Task 1 is already committed, they pass — in that case confirm they fail by temporarily reverting `MOBILE_CALLBACK_URI` to the old `app.immich`-only regex, then restore it. Never accept a test that has not been observed failing.

- [ ] **Step 4: Run it green**

```bash
cd e2e && pnpm test -- --run src/specs/server/api/oauth.e2e-spec.ts
```

Expected: PASS, including every pre-existing test in the file (the `web`-client and `mobile redirect override` blocks must not regress — `resolveRedirectUri` changed underneath them).

- [ ] **Step 5: Commit**

```bash
git add packages/e2e-auth-server/auth-server.ts e2e/src/specs/server/api/oauth.e2e-spec.ts
git commit -m "test(e2e): cover custom-scheme oauth callback for both legacy and branded schemes"
```

---

## Manual Verification (device flow only)

Task 5 covers the custom-scheme flow against a real IdP, and `test-oauth-callback-branding.sh` covers the branding invariant. What no test covers is the **Android intent handoff itself** — whether the browser actually hands the callback to the app. That is precisely where the bug lived, so it must be checked on a device before release:

- [ ] Build a branded Android APK (see `reference_macos_android_branded_build`: JDK21, `gsed`/`grealpath` shim, `adb uninstall` before sideload).
- [ ] Confirm the built manifest registers both schemes:
      `aapt2 dump xmltree app-release.apk --file AndroidManifest.xml | grep -A2 CallbackActivity`
- [ ] Confirm the Dart snapshot still sends the legacy URI:
      `unzip -p app-release.apk lib/arm64-v8a/libapp.so | strings | grep oauth-callback`
- [ ] Sideload, and log in via OIDC against an Authelia instance whose client registers **only** `app.immich:///oauth-callback` (i.e. an unchanged, pre-existing config). The browser must hand back to the app and land you logged in.
- [ ] Repeat with **Mobile Redirect URI Override** enabled, pointing at `https://<server>/api/oauth/mobile-redirect`.
- [ ] Sanity-check that web OIDC and iOS OIDC still work (the shared `resolveRedirectUri` changed).

---

## Deferred: Phase 2 — flip the sent scheme to branded

Out of scope here, but this plan is shaped to make it a one-liner, and `test-oauth-callback-branding.sh` **proves** it with a flip simulation rather than just asserting it. Once a release has shipped with the updated docs and admins have had a cycle to register `de.opennoodle.gallery:///oauth-callback`:

1. Set `branding/config.json` → `mobile.oauth_callback` to `de.opennoodle.gallery:///oauth-callback`.
2. That's it — the manifest already registers the scheme, the server already accepts it, `verify-branding.sh` already checks the invariant, and the tests already cover both schemes.

**Fail-closed only when the override is disabled — silent hang when it's enabled.** With the **Mobile Redirect URI Override disabled**, a mismatched scheme does fail visibly at the provider: `openid-client` sends the same `redirect_uri` it authorized with, the IdP rejects an unregistered one with a `redirect_uri` mismatch, and the user sees an obviously failed login.

With the override **enabled**, that safety net does not exist. Both the authorize request and the callback carry the admin's https override URI, so there is no provider-side redirect-URI check left to catch a mismatch — `resolveRedirectUri` swaps the scheme away before the IdP ever sees it. After a Phase-2 flip, `/api/oauth/mobile-redirect` would emit `de.opennoodle.gallery:///oauth-callback`, while any app installed before the flip still registers its `flutter_web_auth_2` completer under the `app.immich` scheme it was built with. On Android, `CallbackActivity` looks the pending completer up by scheme (`callbacks.remove(url.scheme)`), finds nothing registered under `de.opennoodle.gallery`, and **silently drops the callback** — no error, no toast, the app just hangs forever on the "waiting for browser" screen.

**Phase 2 therefore requires app/server lockstep for admins who use the override**: the server's `MOBILE_REDIRECT` must never be flipped to the branded scheme ahead of the installed app build that sends it. Treat this as a hard prerequisite of Phase 2 — sequence the rollout so the app release lands first and the config flip follows only once the override-using fleet has upgraded — not as a footnote.

**Why flip at all?** While we send `app.immich`, a phone with **both Immich and Gallery installed** has two apps registering that scheme, so Android shows a disambiguation chooser at the callback — and if the user taps Immich, the code lands in an app with no pending auth session and the login dies. Migrating Immich users are exactly the cohort most likely to have both installed.

**Migration cost of the flip:** admins who did _not_ register the branded URI will see OIDC break on mobile (the IdP rejects an unregistered `redirect_uri` before the login screen). Gate the flip on a release note, and keep `app.immich` registered in the manifest indefinitely so older installed app builds keep working.

---

## Alternative considered: runtime negotiation

Rather than a build-time constant, the server could expose an admin setting for which callback URI to use and return it from `POST /api/oauth/authorize`, with the app using the returned scheme for `FlutterWebAuth2.authenticate`. That gives per-instance choice instead of per-build.

Rejected for now: it adds an API field, a config field and an admin toggle to four upstream files (`config.ts`, `system-config.dto.ts`, `auth.service.ts`, `AuthSettings.svelte`) — real rebase surface for a fork that rebases on upstream regularly — and it introduces a footgun: flipping the setting instantly breaks every older installed app, which still declares the old scheme to `ASWebAuthenticationSession` on iOS. The build-time approach keeps app and server in lockstep by construction.
