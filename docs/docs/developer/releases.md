# Releases

Gallery uses **git tags as the single source of truth** for versioning. Mobile and server are released **independently** through two manual workflows. Versions are always supplied by hand — there is no automatic version bump and no push-to-`main` trigger.

## The two release workflows

Both are manual (`Actions → Run workflow`, or `gh workflow run`) and must be triggered from `main`.

### Release Mobile

Workflow: `gallery-release-mobile.yml`. Input: a required `version` (e.g. `v5.0.0`).

1. Builds + signs the Android AAB/APK and the iOS IPA at the commit that dispatched the run.
2. Uploads the Android AAB to the Play Store **internal** track and the iOS IPA to **TestFlight**.
3. Keeps the signed APK as the `gallery-apk` workflow artifact (for sideloading).
4. Records the **version** and the **commit SHA** it built from in the run summary.

It does **not** create a GitHub Release or a git tag. Promote the Play internal build to production and submit the App Store for review manually.

### Release Gallery Server

Workflow: `gallery-release-server-only.yml`. Inputs: a required `version` and an optional `commit`.

- `commit` defaults to the HEAD of the triggering branch. Supplying it pins the release to that exact commit ("release up to this commit"); the commit must already be merged on the branch.
- To ship a server build that matches a mobile release, pass the **same version** and the **commit SHA** the mobile run recorded in its summary.

It builds and pushes multi-arch Docker images to `ghcr.io/open-noodle/`, moves three git tags, creates the GitHub Release (with auto-generated changelog noting the upstream Immich version), and flips the version endpoint that self-hosted instances poll.

The three git tags:

- `vX.Y.Z` — the specific version (e.g. `v5.0.0`)
- `vX` — floats to the latest release in that major (e.g. `v5`)
- `release` — always points to the latest server release

## Keeping mobile and server in sync (optional)

The workflows are decoupled by design — a server bugfix can ship without waiting on app-store review, and vice versa. When you _do_ want them aligned (e.g. a coordinated version):

1. Run **Release Mobile** with the target version. Note the commit SHA it records.
2. Promote the store builds and wait for them to go live.
3. Run **Release Gallery Server** with the same version and that commit SHA.

If you don't need parity, just run **Release Gallery Server** from `main` with no `commit`.

## Version in source files

Source files (`package.json`, `pubspec.yaml`, `pyproject.toml`) contain the **upstream Immich version** — not the Gallery version. This avoids merge conflicts during upstream rebases. The branding script (`branding/scripts/apply-branding.sh`) overwrites these at build time with the Gallery version passed into the release workflow.

In local development, the server reports the upstream Immich version. This is expected — branding only runs during CI builds.

## Docker image tags

Users pin their deployments with the `IMMICH_VERSION` env var in `docker-compose.yml`:

| Tag              | Example   | Behavior                  |
| ---------------- | --------- | ------------------------- |
| Specific version | `v5.0.0`  | Pinned to exact release   |
| Major version    | `v5`      | Floats to latest `v5.x.x` |
| `release`        | `release` | Always latest build       |

## Upstream tracking

The upstream Immich version is recorded in `branding/config.json` under `upstream.version`. This is updated during rebases and included in GitHub Release notes.

## Mobile version compatibility

The mobile app checks that its major version matches the server's major version at login. Since branding stamps the same Gallery version into both the server `package.json` and the mobile `pubspec.yaml`, this check passes for production builds. In local dev, both report the upstream version, so the check also passes.

The mobile `versionCode` (Play Store) / `CFBundleVersion` (iOS) is computed in `gallery-build-mobile.yml` as the commit count on the built ref plus a re-run offset (`git rev-list --count HEAD + GITHUB_RUN_ATTEMPT - 1`), so it increases monotonically across builds and retries.
