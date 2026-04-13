# Attach Android APK to GitHub Release

**Status:** Design approved 2026-04-13
**Scope:** CI/workflow only — no application code.

## Problem

`gallery-release.yml` produces a GitHub Release via `gh release create` but attaches no binary assets. The mobile build currently produces only an Android App Bundle (AAB), which is uploaded to the Play Store internal track but never exposed to users who want to sideload.

Goal: publish a signed, universal Android APK as an asset on every GitHub Release, so users who don't want the Play Store (F-Droid-style sideload, direct download) can install Gallery directly.

## Decisions

| Decision                  | Choice                                     | Rationale                                                                                                     |
| ------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| APK format                | Universal (one fat APK)                    | Audience is small; UX of "one file" beats bandwidth savings.                                                  |
| Signing                   | Same keystore as the AAB (`KEY_JKS`)       | Users can move between sideload and Play Store in place. Standard for projects publishing both channels.      |
| When to build             | Release runs only (`inputs.version != ''`) | Smoke builds already verify the AAB compiles; a parallel APK build adds minutes to PR CI for no benefit.      |
| Filename                  | `gallery-<version>.apk`                    | Unambiguous when users archive downloads or link to specific versions.                                        |
| iOS IPA                   | Not attached                               | iOS sideload is impractical for most users.                                                                   |
| Supply-chain (SHA256SUMS) | Not included                               | GitHub download URLs are sufficient for this user base; supply chain integrity is a bigger, separate problem. |

## Architecture

Two-file change:

1. **`.github/workflows/gallery-build-mobile.yml`** — `build-sign-android` job gains a second Flutter build (`flutter build apk --release`) and a matching `upload-artifact` step, both gated on `inputs.version != ''`.
2. **`.github/workflows/gallery-release.yml`** — `tag` job downloads the APK artifact and attaches it to the existing `gh release create` call as a positional arg.

Flow:

```
version ─▶ build-mobile (AAB artifact + APK artifact) ─▶ tag (downloads APK, creates release with APK attached)
```

The `tag` job already declares `needs: [version, merge-server, merge-ml, build-mobile]`, so ordering is guaranteed. Reusable-workflow artifacts are visible to sibling jobs in the parent run, so no repository passthrough is needed.

## Gradle signing

`mobile/android/app/build.gradle`:

```groovy
signingConfigs {
  release { ... reads ALIAS / ANDROID_KEY_PASSWORD / ANDROID_STORE_PASSWORD from env ... }
}

buildTypes {
  release {
    signingConfig signingConfigs.release
    ...
  }
}
```

`signingConfigs.release` is bound to `buildTypes.release`, which covers both `bundleRelease` (AAB) and `assembleRelease` (APK). `flutter build apk --release` picks up the same keystore the existing AAB build uses. **No gradle change required.**

## Step placement in `build-sign-android`

The new APK build lands **between** the AAB artifact upload and the fastlane Play Store upload:

1. Build AAB
2. Upload AAB artifact
3. **Build APK** (new)
4. **Upload APK artifact** (new)
5. Setup Ruby for fastlane
6. Write Play Store key
7. Fastlane internal upload
8. Remove Play Store key
9. Save gradle cache

Reasons:

- If the APK build fails, fastlane doesn't run, so no Play Store internal-track version code is consumed on a broken release.
- If fastlane fails, the APK is already built, but the whole `build-mobile` job still fails — so the `tag` job never runs and no half-release ships. Fail-fast preserved.
- Gradle cache restore is above both builds; the APK and AAB share the warm cache. Sequential within the same job — no race.

## Diff

### `.github/workflows/gallery-build-mobile.yml`

After the existing "Publish Android App Bundle artifact" step, before "Setup Ruby":

```yaml
- name: Build signed Android APK
  if: inputs.version != ''
  working-directory: ./mobile
  env:
    ALIAS: ${{ secrets.ALIAS }}
    ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
    ANDROID_STORE_PASSWORD: ${{ secrets.ANDROID_STORE_PASSWORD }}
    VERSION_NAME: ${{ steps.build-meta.outputs.version_name }}
    VERSION_CODE: ${{ steps.build-meta.outputs.version_code }}
    VERSION: ${{ inputs.version }}
  run: |
    flutter build apk --release \
      --build-name="$VERSION_NAME" \
      --build-number="$VERSION_CODE"
    mv build/app/outputs/flutter-apk/app-release.apk \
       "build/app/outputs/flutter-apk/gallery-${VERSION}.apk"

- name: Publish Android APK artifact
  if: inputs.version != ''
  uses: actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f # v7.0.0
  with:
    name: gallery-apk
    path: mobile/build/app/outputs/flutter-apk/gallery-${{ inputs.version }}.apk
    if-no-files-found: error
```

`if-no-files-found: error` + the `if:` guard together mean: the upload is skipped entirely on smoke builds, and the error gate only fires in release mode where the file must exist.

### `.github/workflows/gallery-release.yml`

In the `tag` job, before "Create GitHub Release":

```yaml
- name: Download APK artifact
  uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
  with:
    name: gallery-apk
    path: ${{ runner.temp }}/apk
```

In the same job's "Create GitHub Release" step, modify the existing `gh release create` call to attach the APK as a positional arg:

```bash
gh release create "$VERSION" "$RUNNER_TEMP/apk/gallery-${VERSION}.apk" \
  --title "$VERSION" --latest -n "$notes"
```

`$RUNNER_TEMP` is injected by the runner as a bash env var in every `run:` step; it matches the `runner.temp` path used by the download step. Using the bash form matches the style of the rest of that heredoc.

## Filename agreement

Both ends of the handoff resolve the filename from the same source:

- `gallery-release.yml`'s `version` job → `needs.version.outputs.version` (e.g. `v4.48.5`).
- Passed to `gallery-build-mobile.yml` via `with: version:` → `inputs.version` → filename `gallery-v4.48.5.apk`.
- `tag` job reads `needs.version.outputs.version` into `VERSION` env → reconstructs the same filename for `gh release create`.

Single source of truth; no drift risk.

## Permissions

- `build-sign-android` — `permissions: contents: read` (unchanged). Artifact upload needs no extra permission.
- `tag` — `permissions: contents: write` (unchanged). `gh release create` with an attached file uses `GH_TOKEN` (already set). Artifact download needs no extra permission.

No changes to workflow permissions required.

## Testing / validation

1. **Manual workflow dispatch** of `Release Gallery` after merge. Confirm APK appears as an asset on the new GitHub release at the expected filename.
2. **Physical install** of the released APK on an Android device. Verify app launches and can connect to a Gallery server.
3. **Signature verification:** `apksigner verify --print-certs gallery-v*.apk` — confirm the signing-certificate fingerprint matches the Play Store version so users can move between sideload and Play Store without uninstall/reinstall.

## Out of scope (YAGNI)

- No `SHA256SUMS` file or signing of the filelist.
- No split-per-ABI APKs (`arm64-v8a` / `armeabi-v7a` / `x86_64`).
- No IPA attachment — iOS sideload is impractical for most users and the ad-hoc/TestFlight path stays the only supported iOS distribution.
- No change to smoke-build behavior — PR mobile builds stay exactly as they are.
- No gradle changes — signing already applies to both AAB and APK targets via `buildTypes.release`.
- No release-notes text change advertising the APK — the asset list on the Releases page is sufficient discovery.

## Risks & mitigations

| Risk                                                        | Mitigation                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `flutter build apk` fails and no artifact exists            | `if-no-files-found: error` on upload; failure propagates; `tag` job never runs; no broken release shipped.       |
| Artifact download fails in `tag` job                        | Step fails; `gh release create` never runs; no tag pushed → release is a clean no-op retryable state.            |
| APK build adds minutes to every release run                 | Acceptable — releases are manual-only; one incremental flutter build on top of a warm gradle cache is small.     |
| Signing-config divergence between AAB and APK in the future | Both targets flow through `buildTypes.release`; any future signing change covers both. Noted in this design doc. |
