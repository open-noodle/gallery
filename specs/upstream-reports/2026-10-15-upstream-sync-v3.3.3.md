# Upstream Sync Report — 2026-10-15 (v3.3.3)

## Summary

- **Branch**: `rebase/upstream-rolling-v3.3.3`, cut fresh from `origin/main` (`44e8470bf9e`), tracking
  `upstream/release/v3.3`. `main` had just taken the four layering PRs as squash commits (#1180, #1181, #1182,
  #1186), so this is the first cycle on the layered fork.
- **Upstream**: `db6e11ecc85` (`v3.3.1`) → **`d2dac658fe1`** = tag **`v3.3.3`** (also the `release/v3.3` head), 6
  commits, batches 01–06, one commit each. 0 behind. There is no v3.3.2 GitHub image; v3.3.3 is published.
- **Fork sync**: none needed. `origin/main` did not move during the cycle (`integratedForkHead` = `44e8470bf9e`).
- **Backups**: `main-backup-2026-10-15` on origin (`44e8470bf9e`, `main` itself untouched); local
  `backup/rolling-pre-v333-b01` … `b06`.
- **Replays**: six, 1653–1654 fork commits each, all commits kept.
- **Product-direction gate**: did not fire. No commit reworks a fork surface; the one people commit changes code the
  fork does not run (see batch 05).
- **Base bump**: `branding/config.json` `upstream.version` 3.3.1 → **3.3.3**. `revert-to-immich.sql` unchanged: v3.3.2
  and v3.3.3 carry no `server/src/schema` change, and the coverage detector is clean in both directions.
- **Risk**: LOW.

## Incoming Upstream Changes

| SHA           | Summary                                            | Area     | Risk | Outcome                                                                                                                   |
| ------------- | -------------------------------------------------- | -------- | ---- | ------------------------------------------------------------------------------------------------------------------------- |
| `762748f9eae` | memories date in every app language (immich-32262) | mobile   | LOW  | Locale argument merged into the fork's `getMemoryTitle` (nullable-year switch kept); upstream's test taken verbatim.      |
| `4aca0ebdf1d` | base-image `202610061109` (immich-32407)           | server   | LOW  | Taken verbatim. Images compared (below).                                                                                  |
| `f6b4699d293` | base-image `202610131110` (immich-32414)           | server   | LOW  | Taken verbatim. Images compared (below).                                                                                  |
| `3dcaa05cd75` | chore: version v3.3.2                              | versions | LOW  | Taken, except the fork-owned `mobile/pubspec.yaml` (`1.0.0+1`) and iOS `Info.plist` (`3.0.0`/`240`).                      |
| `ea1bfcf2485` | improve people query performance (immich-32441)    | server   | none | **No-op for the fork.** It rewrites `getVisiblePeopleQuery`; Gallery's replay-owned `PersonRepository` has no such query. |
| `d2dac658fe1` | chore: version v3.3.3                              | versions | LOW  | Same as v3.3.2.                                                                                                           |

### immich-32441 and the replay-owned person files

Upstream moved the face count of the partner/shared-album people query into a pre-aggregated subquery and dropped the
`faceCount` helper. Neither exists in Gallery: `PersonRepository.getAllForUser` is Gallery's owner-scoped query (person
sharing stays dormant), and `main` has no `getVisiblePeopleQuery`. The batch-05 replay conflicted once (#542, both
person files) and was resolved to the fork side; afterwards the whole tree was **identical to the pre-batch tip**.

Whether the same planner problem affects Gallery's own query is a separate question. `getAllForUser` filters
`person.ownerId` before joining `asset_face`, the shape upstream's comment does not warn about, so nothing was
ported. Worth a look if the People page is slow on a large library.

### Base images

`base-server-dev` `202610021601` vs `202610131110`, both run: Debian trixie, Node 24.21.0, npm 11.19.0, `binaryen`
120-4 installable (the fork's plugin build installs it instead of running `mise install --locked`). No difference
the fork depends on.

## Conflict Resolutions

### Conflict: `mobile/lib/presentation/widgets/memory/memory_title.widget.dart` (batch 01, fork commit `e357eee69ae`)

- **Fork side**: rule-memory branch, and `onThisDay` switching on the nullable `memory.data.year`.
- **Upstream side**: `DateFormat.yMMMMd(resolvedDateTimeLocale())`.
- **Resolution**: fork's switch with upstream's locale argument. Delta vs the pre-batch tip equals upstream's diff.
- **Risk**: LOW. The fork's rule titles already pass a locale (`memory_card_text.dart` `_monthYear`).

### Conflict: `mobile/pubspec.yaml`, `mobile/ios/Runner/Info.plist` (batches 04 and 06)

- **Fork side**: version pinned to `1.0.0+1` / `3.0.0` (the release workflow stamps the real version).
- **Upstream side**: version bumps.
- **Resolution**: fork side, as every earlier version cycle. **Risk**: none.

### Conflict: `server/src/repositories/person.repository.ts`, `server/src/queries/person.repository.sql` (batch 05, #542)

- **Resolution**: fork side (see immich-32441 above). Tree identical to the pre-batch tip. **Risk**: none.

## Fork commits added this cycle

| Commit                                                                    | Why                                                                                                                                                                                                       |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chore(preflight): list the eight wave-3 fork migrations in the manifest` | #1186 added eight `1798…` migrations without listing them in `docs/fork/ownership.yml`, so the post-rebase "Gallery Migration Count" audit read 78 against 70. Pre-existing on `main`, not a replay loss. |
| `chore(rebase): advance the upstream base to Immich v3.3.3`               | `upstream.version`, AGENTS.md, README, the switch-to-Gallery guide and the M8 spec in `tools/upstream-preflight`.                                                                                         |
| this report                                                               |                                                                                                                                                                                                           |

## Verification

- Per batch: the `backup→HEAD` delta of every upstream-touched file equals upstream's own diff (sorted `+`/`-` lines),
  apart from the two fork-pinned version files; no other file changed. `upstream-postrebase-audit`,
  `ci-invariants-check`, `fork-patches-check`, `mobile-drift-rebase-check`: OK. "Generated Artifact Review" flagged the
  OpenAPI spec (version string only, same delta as upstream) and upstream's regenerated `person.repository.sql` (the
  fork's copy is unchanged and matches its source).
- Whole tree vs `main`: 16 files, +37/−18: the upstream delta, the manifest fix and the base bump.
- `make commit-autolink-check`: 1655 messages, clean. `node i18n/gallery/merge.mjs --check`: clean.
- `tools/upstream-preflight` suite: 27 files, 304 passed.
- Not run locally: the server and web suites (no source changed) and the mobile suite (one resolved line); remote
  CI below covers them.

## Layering

- Upstream files whose fork diff grew: none. `memory_title.widget.dart` keeps the same fork hunks.
- `i18n/*.json`: untouched this cycle.

## Remote CI

All ten dispatched workflows green on `3aadeaa4a08` (branch `rebase/upstream-rolling-v3.3.3`):

| Workflow                            | Run         | Attempt | Note                                                                                                                                                                |
| ----------------------------------- | ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test                                | 38651196516 | 2       | attempt 1: GHCR rate limit (medium, e2e) and a runner shutdown (Lint Web)                                                                                           |
| Docker                              | 38651249909 | 2       | attempt 1: GHCR 429 pulling `base-server-dev`                                                                                                                       |
| Static Code Analysis                | 38651031818 | 1       |                                                                                                                                                                     |
| Gallery Build Mobile                | 38651086315 | 1       | iOS + Android                                                                                                                                                       |
| Gallery Mobile Smoke                | 38651140147 | 1       |                                                                                                                                                                     |
| Gallery ML Smoke                    | 38651363418 | 1       |                                                                                                                                                                     |
| Gallery Rebase Smoke                | 38651304344 | 2       | attempt 1: GHCR rate limit                                                                                                                                          |
| Storage Migration Tests             | 38651425602 | 2       | attempt 1: GHCR rate limit                                                                                                                                          |
| Storage Migration E2E               | 38651483105 | 1       |                                                                                                                                                                     |
| Gallery Revert-to-Immich Validation | 38651537635 | 2       | attempt 1: GHCR rate limit; boots stock `immich-server:v3.3.3`. Dispatch tests the `:main` server image, a valid stand-in since this cycle changes no server source |

Every first-attempt failure died pulling an image before any test ran (`toomanyrequests … 44000/minute`), even with
the dispatches 30 s apart; the reruns were spaced 150 s apart. No code fix was needed.

## Landing

Not landed. `main` is backed up as `main-backup-2026-10-15` and left untouched; the branch is ready to be
force-pushed once the maintainer decides to.
