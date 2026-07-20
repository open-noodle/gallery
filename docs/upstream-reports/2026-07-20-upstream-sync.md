# Upstream Sync Report — 2026-07-20

Rolling branch: `rebase/upstream-rolling-v3.0.3`

## Summary

- **Upstream commits pulled**: 6 (batches 16–18, `12fc8bac18..4a4d468aa2`)
- **Fork commits synced from `origin/main`**: 6 (`e60a6616a0..fad32a018f`)
- **Conflict stops resolved**: 7, across 3 distinct files
- **Risk level**: MEDIUM — one real reconciliation (openapi-generator v7.23.0 vs the fork's civil-date codegen patch)
- **Recommendation**: PROCEED — rolling branch only. This is **not** a cutover to `main`.

Post-rebase position: **0 commits behind `upstream/main`**, 941 fork commits ahead.

## Per-Batch Product-Direction Gate

Applied to all three batches before rebasing. **Gate did not fire.** None of the six
upstream commits changes where a feature is going: no sharing-model rework, no sync
contract change, no access/RBAC reshape, no new first-class entity. The two commits with
trigger-adjacent subjects were read in full and cleared:

- `f2b0b696f6` "long press **share** quality override" — the OS share-sheet action button, not the sharing/permission model.
- `b5401eb120` "update **album** creation to use user-defined name" — a dialog-name bugfix in `album_selector.widget.dart`, not the album model the fork's space-albums extend.

## Incoming Upstream Changes

| SHA          | Summary                                              | Area    | Risk to Fork                                                          | Notes                                                    |
| ------------ | ---------------------------------------------------- | ------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| `b5401eb120` | mobile: album creation uses user-defined dialog name | mobile  | LOW                                                                   | One widget; no album-model change                        |
| `f2b0b696f6` | long-press share quality override preference         | mobile  | LOW                                                                   | OS share sheet; +117 lines of tests                      |
| `00cb50cc67` | docs: remove ref to synology channel                 | docs    | LOW — conflicted with fork docs rebranding                            | Resolved; see below                                      |
| `3adc3920fb` | **bump openapi-generator to v7.23.0**                | codegen | **MEDIUM/HIGH** — gutted the patch carrying the fork's civil-date fix | The one real reconciliation; see below                   |
| `522def1ed6` | web: align ContextMenu z-index with design token     | web     | LOW                                                                   | Single token change; fork re-skin token layer unaffected |
| `4a4d468aa2` | web: refresh folder view after asset deletion        | web     | LOW                                                                   | 3 lines in the folders route                             |

### High-Risk Change (detailed): openapi-generator v7.22.0 → v7.23.0 (`3adc3920fb`)

**What upstream changed.** Generator v7.23.0 handles three-state `Optional` DTO fields
natively, so upstream deleted ~265 lines of now-redundant codegen patches, including 152
lines from `open-api/templates/mobile/serialization/native/native_class.mustache.patch`
and the whole of `open-api/patch/time_bucket_asset_response_dto.dart.patch`.

**Why it was risky for the fork.** That same patch file also carried the fork's civil-date
fix (#584 and its follow-up `e970c82154`): every `{{#isDate}}` branch must serialize with
`_dateFormatter.format(value)` rather than `_dateFormatter.format(value.toUtc())`. Civil
dates are not instants, so UTC-shifting them moves a birthday by a day for anyone west or
east of UTC. Accepting upstream's gutted patch wholesale — which is what a clean conflict
resolution looks like — silently reintroduces that bug.

**This regression is structurally invisible to CI.** GitHub runners are UTC, so
`mobile/test/openapi/person_update_dto_test.dart` passes under UTC whether or not the fix
is present. It only fails off-UTC. This is why the reconciliation had to be done by
reading the patch rather than by trusting a green pipeline.

**What was verified** (commit `473087f32c`):

- The three-state scaffolding was correctly allowed to die — v7.23.0 does it natively.
- The civil-date hunks were re-derived against the raw v7.23.0 template and re-applied at
  `@@ -82,10 @@` (the `x-is-optional` date branch) and `@@ -120,10 @@` (the plain branch).
- Both the reconciled patch and the fork-only `native_class_nullable_items_in_arrays.patch`
  apply to v7.23.0 with **zero fuzz**.
- Generated client: **0** occurrences of `_dateFormatter.format(...toUtc())` remain, while
  the **144** genuine `isDateTime` fields still UTC-normalise via `toUtc().toIso8601String()`.
- `person_update_dto_test.dart` passes under **`TZ=America/New_York`**, plus 26 related
  serialization tests.

**Behaviour change to be aware of.** The regenerated client now emits `json[key] = null`
instead of omitting the key for null non-`Optional` fields, across 46 DTOs. The omission
came from a single fork commit (#584) that rewrote the whole patch file — it was an
incidental artifact of that rewrite, never a deliberate fork decision, and `upstream/main`
emits the explicit null (34 files). Realigning reduces fork divergence, and the affected
DTO tests pass. Flagged here because it is a wire-format change rather than a no-op.

## Conflict Resolutions

### 1. `docs/docs/install/synology.md` (batch 16)

- **Fork side**: rebranding commit had rewritten the Immich Discord link to the Gallery Discord link.
- **Upstream side**: removed the Discord-channel reference entirely — the channel does not exist.
- **Resolution**: took upstream's replacement sentence. It carries no Immich branding, so nothing needed rebranding, and the claim about a non-existent channel is equally false for Gallery.
- **Risk**: LOW. **Verified**: no `Immich`/`immich` branding leak introduced in the note block.

### 2. `open-api/templates/mobile/serialization/native/native_class.mustache.patch` (batch 17, ×3 stops)

- **Fork side**: commits `d4058d4bc3` (#584), `94af2dfe50` (three-state adaptation), `e970c82154` (civil dates in the three-state branch).
- **Upstream side**: patch gutted to a single `upgradeDto` hunk for generator v7.23.0.
- **Resolution**: resolved to upstream's v7.23.0 base, then **re-derived the fork's civil-date hunks against the new template** in a follow-up commit. The three-state scaffolding was deliberately not restored — v7.23.0 supersedes it.
- **Risk**: MEDIUM at resolution time, mitigated to LOW by verification. **Verified**: see the section above.

### 3. `mobile/openapi/lib/model/time_bucket_asset_response_dto.dart` (batch 17, ×3 stops)

- **Fork side**: successive fork regenerations of a fully generated artifact.
- **Upstream side**: regenerated by v7.23.0; upstream also deleted its post-generate patch.
- **Resolution**: took upstream's generated version at each stop, then regenerated the entire Dart client from the spec.
- **Risk**: LOW — no hand-written fork logic lives in this file. **Verified**: full regeneration succeeded and all patches applied.

## Fork Feature Verification

Automated fork audits ran for batches 16, 17 and 18 — all **OK**:

| Check                               | Status | Notes                                                                   |
| ----------------------------------- | ------ | ----------------------------------------------------------------------- |
| Fork-Owned File Survival            | OK     | All literal fork-owned files present                                    |
| Fork Extension Symbol Survival      | OK     | All manifest expected symbols present                                   |
| Gallery Migration Count             | OK     | 48 (expected 48) after manifest reconcile                               |
| Gallery Migration Filename Survival | OK     | No fork migration lost                                                  |
| Gallery Migration Manifest Coverage | OK     | Globs match current files                                               |
| Migration Timestamp Collision Check | OK     | No upstream/Gallery timestamp collision                                 |
| Generated Artifact Review           | OK     | Cleared after the codegen reconciliation                                |
| `fork-patches-check`                | OK     | `@immich/ui` patch metadata consistent                                  |
| `ci-invariants-check`               | OK     | No `PUSH_O_MATIC`; Gallery image names; docs-deploy stays dispatch-only |
| `mobile-drift-rebase-check`         | OK     | schemaVersion, snapshots, callbacks consistent                          |

### Ownership manifest reconcile

The Gallery Migration Count audit failed at 48-vs-34. **No migration was lost** — filename
survival and glob coverage both passed. The explicit `expected_migrations` list in
`docs/fork/ownership.yml` had simply drifted: 14 fork migrations from the space-albums work
(#752 and predecessors) and the PostgreSQL JIT fix (#798) were covered by the glob but never
enumerated. Enumerated in commit `1628c9f4fc`.

## Database Migration Analysis

- **New upstream migrations**: NONE. The six upstream commits touch no
  `server/src/schema/migrations/` file.
- **Timestamp collisions**: NONE.
- **Gallery migrations**: 48, all present.
- **Schema files** (`server/src/schema/tables/`): unchanged by this range.
- **`revert-to-immich.sql` coverage** (step 7i): **PASSES** — the step-7i detector reports
  no `MISSING` entries for either `migrations-gallery/` or post-`v3.0.3` upstream migrations.
- **SQL regeneration**: not required and deliberately **not run**. The incoming range
  changes zero files under `server/src/repositories/` or `server/src/queries/`, and
  `server/src/queries/` is clean against HEAD. Running `mise //:sql` without a live database
  deletes every query file, so it was correctly skipped rather than run speculatively.

## Mobile Drift Migration Analysis

- **New upstream mobile migrations**: NONE — no `schemaVersion` bump, no new snapshot.
- **`schemaVersion`**: 36, unchanged; no renumbering required.
- **Collision check**: no duplicate snapshots, no gaps, callback chain contiguous
  (`mobile-drift-rebase-check` OK on batches 16, 17 and 18).

## Version References

`branding/config.json` `upstream.version` stays **3.0.3**: v3.0.3 is still the latest
tagged Immich release (checked against the GitHub releases API), and the branch carries
post-v3.0.3 _unreleased_ upstream commits, which is the normal state for a rolling branch.
No `README.md` or marketing-site version change is due.

## Local CI Verification

| Check                                     | Status | Notes                                                               |
| ----------------------------------------- | ------ | ------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`          | PASS   | Lockfile already up to date                                         |
| server `pnpm check` (tsc --noEmit)        | PASS   | Clean                                                               |
| web `pnpm check:typescript`               | PASS   | Clean                                                               |
| server `pnpm lint` (`--max-warnings 0`)   | PASS   | Clean                                                               |
| web `pnpm lint`                           | PASS   | 613 warnings, **0 errors** — the tolerated Tailwind class-order set |
| web `pnpm check:svelte`                   | N/A    | Reports `0 FILES` locally (known no-op); covered by CI Lint Web     |
| server unit tests                         | PASS   | 5093 passed, 9 skipped (152 files)                                  |
| web unit tests                            | PASS   | 3657 passed, 2 skipped, 8 todo (282 files)                          |
| `dart analyze --fatal-infos lib test`     | PASS   | No issues found                                                     |
| `mise //mobile:format`                    | PASS   | 791 files, 0 changed                                                |
| mobile serialization tests                | PASS   | 26 tests, incl. civil-date test under `TZ=America/New_York`         |
| OpenAPI regeneration (`mise //:open-api`) | PASS   | Spec byte-identical; Dart client regenerated on v7.23.0             |

`mise.lock` was rewritten by the local `mise` run to strip the Linux platform entries; this
is a macOS-local artifact and was reverted rather than committed, since committing it would
break Linux CI.

## Remote CI Verification

First dispatch, 10 workflows on `7ff472ef0`: 6 green, 4 red. All four were diagnosed from
job logs rather than re-run blindly; **none was caused by the upstream batches themselves**.

| Workflow                            | Result                | Diagnosis                                         |
| ----------------------------------- | --------------------- | ------------------------------------------------- |
| Docker                              | GREEN                 |                                                   |
| Gallery Build Mobile                | GREEN                 |                                                   |
| Gallery ML Smoke                    | GREEN                 |                                                   |
| Gallery Rebase Smoke                | GREEN                 |                                                   |
| Gallery Revert-to-Immich Validation | GREEN                 | Confirms the step-7i coverage gate on branch code |
| Storage Migration E2E (standalone)  | GREEN                 |                                                   |
| Static Code Analysis                | RED → fixed           | Stale drift codegen (`shared_space_album_link`)   |
| Gallery Mobile Smoke                | RED → fixed (codegen) | Same stale drift file (codegen gate)              |
| Test                                | RED → fixed           | `demoLogin` header assertion (Unit Test Mobile)   |
| Storage Migration Tests             | RED → confirmed flake | See second-dispatch analysis below                |

### Stale drift codegen (Static Code Analysis + Gallery Mobile Smoke)

`mobile/lib/infrastructure/entities/shared_space_album_link.entity.drift.dart`, committed
with #752, was generated by an older `drift_dev` than the rolling branch now resolves, so
both codegen-freshness gates failed on a file nobody had edited. Regenerating changes only
how the foreign-key alias is emitted — newer `drift_dev` inlines the precomputed literal
instead of calling `$_aliasNameGenerator`. Same value, no behaviour change. Fixed in
`bc80b481f6`.

Note the local `dart` shim (3.11.5) is older than the SDK the project requires (>= 3.12.0);
`build_runner` must be run with Flutter 3.44.6's bundled Dart (3.12.2), which is what CI uses.

### `demoLogin` header assertion (Test → Unit Test Mobile)

`auth_api_repository_test.dart` asserted `request.headers` equals
`{'content-type': 'text/plain; charset=utf-8'}`. `demoLogin` sends no body and no explicit
content type, so the fork never set that header — older `http` versions auto-added it when
an empty-string body was assigned, and current `http` does not.

Verified this is **not** caused by the openapi-generator bump: the test fails identically
with the pre-regeneration client checked out. Verified it is **not** a functional
regression: `POST /api/auth/demo-login` against the live demo instance returns **201** both
with and without the header. The assertion was relaxed to `isEmpty` rather than deleted, so
it still catches an accidental authorization-header leak on this unauthenticated route.
Fixed in `0739274227`.

### Second dispatch on `2a1587679f` — the three codegen/build fixes verified, three flakes isolated

After committing the three fixes above, the four previously-red workflows were re-dispatched.

- **Static Code Analysis → GREEN.** The drift regen fixed it.
- **Test → Unit Test Mobile GREEN** (the `demoLogin` fix landed), but a **different** job,
  `End-to-End Tests (Web)`, flaked on the maintenance-mode spec:
  `getByText('Temporarily Unavailable')` not visible + `Error: 404`. This job **passed** in
  the first dispatch, nothing in the diff touches maintenance mode, and the signature is a
  timing/404 flake in an inherently timing-sensitive spec (it toggles the whole server into
  maintenance).
- **Gallery Mobile Smoke → the codegen gate now passes**, but the `Android smoke`
  `assembleDebug` step failed on `checkDebugDuplicateClasses` / `JetifyTransform` of the
  **Flutter engine** jars. Root cause: `mobile/android/gradle.properties` sets
  `android.enableJetifier=true`, so Jetifier tries to transform Flutter's own engine jars
  (already AndroidX) and races intermittently — the failing jar even **varied between runs**
  (`arm64_v8a_debug` + `armeabi_v7a_debug` first, `x86_64_debug` on rerun), the signature of
  a transform/cache race rather than a deterministic break. This is a **pre-existing flake in
  this smoke workflow**, not a rebase regression: its own run history alternates pass/fail on
  the _same_ rolling-branch state (e.g. 2026-07-17 went fail → success → fail → success within
  hours; 2026-07-18 green), the rebase touched **zero** Android build config (the diff over
  all `mobile/android/**` + `build.gradle*` + `gradle.properties` is empty), and the full
  `Gallery Build Mobile` workflow built **release** Android on the identical tree and passed.
  Not a rebase blocker. A proper root-cause fix — evaluating whether `enableJetifier` can be
  dropped now that the dependency graph is AndroidX-native — is a separate infra task, logged
  under Follow-up.
- **Storage Migration Tests → flaked at a _different_ point** than the first dispatch: this
  time it got past the Docker build and failed at the `delete-source-false` phase with
  `TypeError: fetch failed / SocketError: other side closed`. Different failure point across
  two runs is the non-determinism signature. Decisive evidence: on `main`'s own cron this
  workflow failed **2 of its last 8 runs** (2026-07-20, 2026-07-16) with no fork change
  involved — a confirmed pre-existing flake. (The standalone `storage-migration-e2e`
  workflow, by contrast, is 8/8 green on main and green here.)

**Causation.** None of the three can stem from this rebase: the entire diff is
mobile codegen + one mobile test + docs + `ownership.yml`, none of which touches web
maintenance mode, the Android Gradle graph, or the storage-migration server E2E. Each was
re-run (`gh run rerun --failed`) to confirm the flake rather than assert it; see the run
history for the confirming green.

## Follow-up

- The null-serialization realignment (46 DTOs, omit-key → explicit-null) is a deliberate
  convergence with upstream, recorded above. Worth a targeted look on the next mobile RC.
- **Android smoke Jetifier flake** — `mobile/android/gradle.properties` still sets
  `android.enableJetifier=true`, which intermittently fails to transform Flutter engine jars.
  Not introduced by this rebase (see above), but a standing infra flake worth fixing at root
  cause by trialling `enableJetifier=false` now that the AndroidX migration is long complete.
- This report covers the **rolling branch only**. Promotion to `main` remains a separate
  cutover decision.
