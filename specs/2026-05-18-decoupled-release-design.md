# Decoupled mobile / server release — design

Date: 2026-05-18

Supersedes [2026-04-17-split-mobile-server-release-design.md](./2026-04-17-split-mobile-server-release-design.md).

## Problem with the previous (split phase-1/phase-2) model

The split design linked mobile (phase 1) and server (phase 2) through a **draft GitHub Release** that carried the version (tag), the commit SHA (`target_commitish`), and the APK (asset). Phase 2 discovered that draft to learn what to build.

In practice this coupling caused friction:

- Re-running mobile for an already-published version was awkward — `gh release create` fails when the tag/release already exists, and dupe guards blocked legitimate re-runs (e.g. shipping a fixed build of an already-released version without bumping it).
- The auto-version computation (scan commits since last tag, infer semver bump from prefixes/labels) was a frequent source of surprise and an extra failure mode.
- Server releases could not proceed cleanly while a mobile draft was "pending", and vice versa.

## Goal

Two **fully independent** manual workflows. No draft handoff, no auto-versioning. Version/commit parity between mobile and server is **opt-in**, achieved by passing the same values to both, not enforced by machinery.

## Design

### `gallery-release-mobile.yml` — "Release Mobile"

`workflow_dispatch`, **required** `version` input. Triggered from `main`.

1. `validate` — require `main`, validate `version` matches `^v\d+\.\d+\.\d+$`.
2. `build-mobile` — calls `gallery-build-mobile.yml` (`environment: production`, the given `version`). Builds + signs Android AAB/APK and iOS IPA at `github.sha`, uploads the AAB to Play internal and the IPA to TestFlight, publishes the `gallery-apk` artifact.
3. `record` — writes the `version` and the built commit `github.sha` to the run summary.

No git tag, no GitHub Release. The APK lives only as a workflow artifact; sideload distribution is via that artifact.

### `gallery-release-server-only.yml` — "Release Gallery Server"

`workflow_dispatch`, **required** `version` input, **optional** `commit` input. Triggered from `main` or `release/*`.

1. `guard` — require `main` or `release/*`.
2. `version` (resolve) — validate `version`; resolve the build SHA: `commit` if given (must be a real commit and an ancestor of the triggering ref — "release up to this commit"), else `github.sha`. Output `version`, `major`, `sha`.
3. `build-server` / `merge-server` / `build-ml` / `merge-ml` — unchanged; build + push multi-arch images at the resolved SHA.
4. `tag` — move `vX.Y.Z` / `vX` / `release` to the SHA, create the GitHub Release (auto changelog, docker-compose/env assets).
5. `publish-version-endpoint` — write `version.json` to S3 (unchanged).

The job ids `guard` and `version` are kept so downstream `needs:` references are unchanged; only their internals and display names change.

### `gallery-release.yml` (phase 2)

**Deleted.** Its responsibilities (build server/ML at a pinned SHA, move tags, publish release + version endpoint) are exactly what "Release Gallery Server" now does, with the SHA supplied via the `commit` input instead of discovered from a draft.

### `gallery-build-mobile.yml`

Unchanged behavior. Header comment updated to drop the phase-1/phase-2 language.

## Design properties

1. **No coupling.** Either workflow can run at any time, in any order, any number of times. Re-running a previously released version is normal (mobile re-run just re-uploads; server re-run force-moves tags idempotently).
2. **Manual versions only.** Both workflows take the version verbatim. No commit scanning, no semver inference.
3. **Parity is opt-in.** Run mobile, read the SHA it recorded, pass that `version` + `commit` to the server workflow when (and only when) you want them aligned.
4. **"Release up to commit"** = the server build/tag/release SHA is pinned to `commit`; it must be an ancestor of the triggering ref so only merged commits can ship.
5. **Step ordering invariant in the server workflow** (`merge-server && merge-ml && tag && publish-version-endpoint`) is preserved — images must exist before the version endpoint flips.

## Failure modes & recovery

| Scenario                                  | Recovery                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Mobile rejected by Play / Apple           | Fix, re-run Release Mobile with the same version. `versionCode` auto-increments (commit count + attempt). |
| Need to ship a fixed already-released ver | Re-run Release Mobile with that version — no tag/release collision because it creates neither.            |
| Server build fails                        | Re-run Release Gallery Server (same version, same `commit`). Tag moves are `-f`, so idempotent.           |
| Want server to match a mobile build       | Pass the mobile run's recorded SHA as `commit` and the same `version`.                                    |
| Commits landed after the mobile build     | Excluded only if you pin `commit`; otherwise the server release is from branch HEAD.                      |

## Migration

Single PR: rewrite `gallery-release-mobile.yml`, rework `gallery-release-server-only.yml` (rename display to "Release Gallery Server", required `version`, optional `commit`, drop the auto-version and mobile-draft-guard jobs), delete `gallery-release.yml`, refresh `gallery-build-mobile.yml`'s header comment, and update `CLAUDE.md` + `docs/docs/developer/releases.md`. No data migration. Deploy skills and the `rc-personal` flow are unaffected.
