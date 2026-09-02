# Upstream Sync Report — 2026-09-02 (batches 213-ext-2 … 216)

## Summary

- **Upstream commits pulled**: 4 (`7211efa6cb9` → `fa8a191aaa7`)
- **Fork commits synced from `origin/main`**: 2 (#1044, #1031)
- **Conflicts resolved**: 1
- **Fork-side repairs bundled**: 3 commits (OpenAPI number formats, the branding
  app-download patcher, the mobile fallout of the retyped Dart client)
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED

Two of the four upstream commits broke fork code with **zero conflicts**, and both
were found by the pre-rebase gates rather than by CI. Neither needed a product
decision; both are the "the fork depends on upstream by reference, not by text
overlap" shape, and both were repaired in this cycle.

## Incoming Upstream Changes

| SHA           | Summary                                                    | Area      | Risk to Fork | Notes                                                                                                                                                                                                                                                 |
| ------------- | ---------------------------------------------------------- | --------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a68937cee76` | fix: fdroid link (immich-31219)                            | web, docs | **HIGH**     | Turned the F-Droid `<a>` badge into a `<Button>`. `apply-branding.sh`'s block rewrite terminated on `</a>` and ran on to the Play Store anchor, deleting that badge from every branded build.                                                         |
| `2c53b76400e` | chore: require number format (immich-31222)                | server    | **HIGH**     | `patchOpenAPI` now throws on any `type: number` property without a `format`, recursing into array items. 32 fork-owned properties failed it.                                                                                                          |
| `b48266c3bb2` | fix: don't force builds on release-base PRs (immich-31225) | CI        | LOW          | Drops `\|\| startsWith(github.base_ref, 'release/')` from two job gates in `docker.yml`. Applied with no conflict; the fork's own `release/`-aware skip jobs are untouched.                                                                           |
| `fa8a191aaa7` | fix: incorrect edit's openapi type (immich-31218)          | open-api  | LOW          | Adds `patch/asset_edit_action_item_response_dto.dart.patch` and one line to `generate-dart-sdk.sh`. Merged around the fork's own additions to that script; the patch file is byte-identical to upstream's and applies cleanly during Dart generation. |

### Product-direction gate

Did not fire. None of the four changes where a feature is going: a store-link
tweak, a validation/codegen hygiene rule, a CI job gate, and a generator patch.

## Conflict Resolutions

### Conflict: `docs/docs/partials/_mobile-app-download.md`

- **Fork side**: the fork's docs rebrand (#167) reduces this partial to two
  entries — the Noodle Gallery Play Store listing and the fork's GitHub releases.
- **Upstream side**: immich-31219 rewrote the F-Droid bullet from
  `[F-Droid](https://app.futo.org/fdroid/repo/)` to
  `[FUTO F-Droid](https://get.immich.app/fdroid)`.
- **Resolution**: took the fork's version verbatim. The line upstream edited is
  one the fork deletes outright, so there is nothing to reconcile.
- **Risk**: LOW.
- **Verification**: `git show <fork tip>:<path>` compared byte-for-byte against
  the resolved file.

## Zero-Conflict Breaks Found and Repaired

### 1. immich-31219 deleted the Google Play badge from every branded build

`patch_app_download_modal()` swaps the element carrying `id="fdroid-link"` for a
GitHub-releases link, because there is no Noodle Gallery F-Droid app. The rewrite
is an awk block anchored `/id="fdroid-link"/ … skip && /<\/a>/`. immich-31219
replaced the anchor with a `<Button>`, which contains no `</a>`, so the block ran
to the **next** `</a>` — the Play Store anchor's closer — and consumed that badge
with it. Running the real patcher against upstream's post-31219 file produced a
modal with only the GitHub link and the App Store badge, plus three dead imports
(`Button`, `mdiOpenInNew`, `playStoreBadge`).

Repair (`c3fa8bcc634`):

- terminate the block on `</a>` **or** `</Button>`. Upstream has now used both
  forms for this one link (immich-30527 the anchor, immich-31219 the Button), so
  matching only the current one is exactly what caused this.
- extend the dead-import cleanup to `Button` and `mdiOpenInNew`, and re-guard
  every case (including the pre-existing `fdroidBadge` and `Constants` ones) on
  the symbol being unreferenced in the **markup** rather than absent from the file.
- assert the three links survive and fail the branding pass if not. Every rewrite
  in this function matches markup upstream owns, so any of them can silently go
  no-op — or over-consume — on the next restructure. Proven to fire against a
  hypothetical single-line `<Button … />` form the terminator does not match.

**Correction to the rebase skill's "is it in CI?" detector.** The documented
check (`grep -rq "$(basename "$f")" .github/workflows/`) reports
`test-app-download-branding.sh` as NOT IN CI, and this report initially repeated
that. It is wrong: `test.yml`'s **Test Branding** job runs
`gallery-branding-check.sh`, which invokes the four regression tests and
`verify-branding.sh` by path, and `verify-branding.sh` in turn calls
`verify-mobile-assets.sh`. Resolved transitively, **all eight**
`branding/scripts/*.sh` are reachable from CI — only three of them by name. The
skill has been corrected with a fixed-point version of the check; the "six of
eight unreachable" note it carried is the 2026-08-04 state, since repaired by the
umbrella script. The gate was red before this fix and green after.

### 2. immich-31222 turned OpenAPI generation into a gate the fork failed 32 times

`patchOpenAPI` previously threw only on `format: float`. It now also throws when
a `type: number` property carries **no** format at all, and it unwraps array
items first. Upstream fixed every offender it owns; the fork's did not exist as
far as that change was concerned. Simulating the new check against the fork's
spec listed 32 properties across eight fork-owned DTOs — every `SharedSpace*`
counter, the whole `FaceRepair*` family, `TrimParameters`, `AlbumNameDto`, the
`ratings` facets on both search-suggestion DTOs, `TimeBucketCoverResponseDto` and
`AdminConfigMemoriesDto`. Left alone, `sync-open-api` throws and the **OpenAPI
Clients** job goes red.

Repair (`5ed2ec87372`) follows upstream's own convention rather than inventing a
third: `z.int()` for counts and bounded integers, `.meta({ format: 'double' })`
for genuine reals. `SharedSpaceResponseDto.thumbnailCropY` becomes `z.int()` to
match the sibling _update_ schema, which already declared it
`z.int().min(0).max(100)`.

The regenerated spec diff is exactly 23 properties `number → integer` (with zod's
safe-integer bounds) and 9 gaining `format: double` — 32, with nothing else.

Nested inline objects (`FaceRepairResponseDto.report.totals`, the scan person
rows) are deliberately untouched: upstream's check only walks a registered
schema's own top-level properties, so those sit outside the gate and changing
them would churn the generated Dart client for no benefit. That blind spot is
upstream's, and worth remembering if a later commit closes it.

### 3. The retyped Dart client broke seven mobile call sites

`mobile/` is byte-identical to the last CI-green tip, so the tree-identity scan
marks it unchanged — but the Dart OpenAPI client is **generated** from the spec
that just changed, and it is gitignored, so nothing in the diff hints at it.
Regenerating it retypes `num` to `int` or `double` and `dart analyze
--fatal-infos` is the first gate that sees the result.

Repair (`f704dcda186`), split by cause:

- **upstream's half** — `exif.converter.dart` and `test/unit/utils/editor_test.dart`
  are both byte-identical to upstream. The first coerces latitude, longitude,
  fNumber and focalLength with `?.toDouble()`, now a no-op that
  `noop_primitive_operations` makes fatal. The second builds
  `RotateParameters(angle:)` — now `int` — from `NormalizedTransform.rotation`, a
  double recovered from an affine matrix, so `.round()` rather than `.toInt()`:
  `acos`/`asin` can land at 89.999… for a quarter turn and truncation would send
  89 to the server. Upstream will need the same two edits; the fork's are derived
  from `edit.page.dart`'s canonical form.
- **the fork's half** — drop `.toInt()` from the space card's asset/member/new
  counts, the collection section's `albumCount`, and the space-person
  `assetCount`; retype the two `List<num> ratings` test helpers to `List<int>`.

Also cleared here, and **not** caused by this cycle: a stale gitignored
`mobile/test/drift/main/generated/` was missing `schema_v32…v36.dart`, which
presents as five `uri_does_not_exist` errors that look like a botched merge.
Regenerating it produced byte-identical snapshots — pure local staleness, as the
prior cycle recorded.

## Fork Feature Verification

| Feature                    | Status | Notes                                                                                                   |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| Shared Spaces              | OK     | Counter DTOs retyped to `z.int()`; mobile call sites follow; `flutter test` green                       |
| Storage Migration          | OK     | Untouched by this batch                                                                                 |
| Pet Detection              | OK     | Untouched                                                                                               |
| Image Editing / video trim | OK     | `TrimParameters` start/end now carry `format: double`; `RotateParameters.angle` is upstream's `z.int()` |
| Face Repair                | OK     | 19 properties formatted; unit suite green                                                               |
| Branding                   | OK     | Repaired; full `gallery-branding-check.sh` passes                                                       |
| Google Photos Import       | OK     | Untouched                                                                                               |
| Search V3 coexistence      | OK     | `search-v3-not-dispatched` invariant passes                                                             |

## CI and Infrastructure Verification

| Check                                   | Status | Notes                                                          |
| --------------------------------------- | ------ | -------------------------------------------------------------- |
| Workflow files (no upstream collisions) | OK     | Only `docker.yml`, applied cleanly                             |
| Docker image references (`gallery-*`)   | OK     | `gallery-release-image-names` invariant passes                 |
| Branding (no upstream-name leaks)       | OK     | i18n branding-override detector clean; branding umbrella green |
| Fork CI modifications intact            | OK     | `ci-invariants-check` 5/5, `fork-patches-check` OK             |
| `.github` formatting gate               | OK     | `npx prettier --check .` clean                                 |
| Commit autolinks                        | OK     | 1409 messages scanned, fork PR ceiling 1057, none cross-repo   |

## Database Migration Analysis

No upstream migrations in this batch. Gallery migration count 62 (expected 62);
filename survival, manifest coverage and timestamp-collision checks all OK across
batches 213–216. `postbuild` synced 62 migrations plus 1 compatibility alias.
`revert-to-immich.sql` coverage detector reports nothing missing.

## Mobile Drift Migration Analysis

No upstream mobile migrations. `mobile-drift-rebase-check` OK — schemaVersion,
snapshots and Gallery callbacks consistent. `drift_dev make-migrations`
regenerates the newest snapshot byte-identical.

## Inconsistencies Found

- **`docs/docs/partials/_mobile-app-download.md` omits the iOS app** — the fork's
  rebranded partial lists only Google Play and GitHub releases, while
  `branding/config.json` has carried an App Store URL
  (`apps.apple.com/us/app/noodle-gallery/id6761776289`) since the iOS release.
  Pre-existing, unrelated to this batch, and left alone here; worth a small docs
  PR.
- **The skill's "NOT IN CI" branding detector under-reports** — see the
  correction under repair 1.

## Pattern Propagation

| Refactor                            | Old → New Pattern                                             | Fork Files Affected                           | Decision | Commit                       |
| ----------------------------------- | ------------------------------------------------------------- | --------------------------------------------- | -------- | ---------------------------- |
| immich-31222 OpenAPI number formats | bare `z.number()` → `z.int()` / `.meta({ format: 'double' })` | 8 server DTOs (32 properties), 7 mobile files | Bundled  | `5ed2ec87372`, `f704dcda186` |

## Local CI Verification

Scoped by tree identity against the pre-cycle tip. `machine-learning`, `packages`,
`i18n`, `docker`, `deployment`, `e2e`, `docs` and `mobile` were byte-identical;
`mobile` was gated anyway because its generated OpenAPI client is derived from the
spec that changed.

| Check                                            | Status | Notes                                                                                                                                                                                  |
| ------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server pnpm build` (+ postbuild migration sync) | PASS   | 62 migrations, 1 alias                                                                                                                                                                 |
| `server pnpm check` (tsc)                        | PASS   |                                                                                                                                                                                        |
| `server pnpm lint`                               | PASS   |                                                                                                                                                                                        |
| `server prettier --check`                        | PASS   |                                                                                                                                                                                        |
| Server unit tests                                | PASS   | 198 files, 6130 tests. First run showed 2 failures in `tag.controller.spec.ts` under full-suite load; green on re-run and 3/3 in isolation — contention flake, unrelated to this batch |
| `web check:typescript`                           | PASS   |                                                                                                                                                                                        |
| `web check:svelte`                               | PASS   | 627 files, 0 errors, 0 warnings                                                                                                                                                        |
| web eslint (`tscompat` off)                      | PASS   |                                                                                                                                                                                        |
| Web unit tests                                   | PASS   | 373 files, 5982 tests                                                                                                                                                                  |
| `.github` prettier                               | PASS   |                                                                                                                                                                                        |
| Branding pipeline (`gallery-branding-check.sh`)  | PASS   | 4 regression tests + apply + verify + mobile assets                                                                                                                                    |
| OpenAPI spec regeneration                        | PASS   | 0 offending number properties                                                                                                                                                          |
| TypeScript SDK regeneration                      | PASS   | No diff — `number` in TS either way                                                                                                                                                    |
| Dart client regeneration                         | PASS   | All 5 patches apply, including immich-31218's new one                                                                                                                                  |
| `dart analyze --fatal-infos`                     | PASS   | No issues found                                                                                                                                                                        |
| `dart format`                                    | PASS   | Only gitignored generated files reformat                                                                                                                                               |
| `flutter test`                                   | PASS   | 3494 passed, 1 skipped                                                                                                                                                                 |
| `make upstream-postrebase-audit` × 4             | PASS   | Two informational Generated Artifact Review entries, both verified below                                                                                                               |
| `make ci-invariants-check`                       | PASS   | 5/5                                                                                                                                                                                    |
| `make fork-patches-check`                        | PASS   |                                                                                                                                                                                        |
| `make mobile-drift-rebase-check`                 | PASS   |                                                                                                                                                                                        |
| `make commit-autolink-check`                     | PASS   |                                                                                                                                                                                        |
| `revert-to-immich.sql` coverage                  | PASS   |                                                                                                                                                                                        |

The two `ISSUE: Generated Artifact Review` entries were verified rather than
waved off: `open-api/patch/asset_edit_action_item_response_dto.dart.patch` is
byte-identical to upstream's, `generate-dart-sdk.sh` carries upstream's new patch
line alongside both fork additions, and the spec's only delta beyond upstream is
the fork's own schemas plus this cycle's 32 format additions.

## Remote CI Verification

- **Test branch**: `rebase/upstream-rolling-v3.1.1-b216`
- **Commit validated**: `f704dcda1869a9c641a7afb6f42ae3d2f51f960b`

| Workflow                                  | Status  | Run | Notes |
| ----------------------------------------- | ------- | --- | ----- |
| `test.yml`                                | PENDING |     |       |
| `docker.yml`                              | PENDING |     |       |
| `static_analysis.yml`                     | PENDING |     |       |
| `gallery-build-mobile.yml`                | PENDING |     |       |
| `gallery-rebase-smoke.yml`                | PENDING |     |       |
| `storage-migration-tests.yml`             | PENDING |     |       |
| `storage-migration-e2e.yml`               | PENDING |     |       |
| `gallery-revert-to-immich-validation.yml` | PENDING |     |       |
| `gallery-ml-smoke.yml`                    | PENDING |     |       |
| `gallery-mobile-smoke.yml`                | PENDING |     |       |

## Post-Rebase Verification

- Fork commits ahead of upstream: 1410
- Commits behind upstream: 0
- Fork diff clean: YES — the whole-tree diff against the pre-cycle tip is exactly
  the four upstream commits' content plus the three bundled repairs, with every
  file accounted for.

## Landing

**Staying off `main`.** Upstream's latest _stable_ tag is still `v3.1.0`;
`v3.2.0-rc.0/1/2` are release candidates, not a tag. Rule 1 of the standing
landing rule is unmet, so there is nothing to decide.
