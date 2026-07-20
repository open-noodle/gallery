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

## Follow-up

- The null-serialization realignment (46 DTOs, omit-key → explicit-null) is a deliberate
  convergence with upstream, recorded above. Worth a targeted look on the next mobile RC.
- This report covers the **rolling branch only**. Promotion to `main` remains a separate
  cutover decision.
