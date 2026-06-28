# Upstream Sync Report — 2026-06-28 (batches 291–297)

## Summary

- **Upstream commits pulled**: 9 (`688241a462..6e1143e799`)
- **Fork commits synced**: 0 (`origin/main` already integrated — `integratedForkHead == 7dbd29113`)
- **Conflicts resolved**: 10 (across 5 distinct files)
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED (pending CI on the test branch)

Upstream tagged **v3.0.0-rc.3** in this range. The fork stays on its tagged base
`branding/config.json.upstream.version = 2.7.5` (unchanged — the rolling branch is
untagged v3-dev; server/web/sdk/root `package.json` carry `3.0.0-rc.3`, mobile keeps `1.0.0+1`).

Collapsed the planner's 7 batches (291–297) into a single `git rebase 6e1143e799`
(one fork-delta replay, identical end state) per the disjoint-batch efficiency rule, then
ran each gate against the cumulative HEAD.

## Incoming Upstream Changes

| Batch | SHA         | PR     | Summary                                 | Area           | Risk to Fork | Notes                                                                                                                            |
| ----- | ----------- | ------ | --------------------------------------- | -------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 291   | `a876d4a9f` | #29308 | small typo in openapi-spec              | server/openapi | LOW          | 2-line const + spec; regen no-op                                                                                                 |
| 292   | `953ef5c04` | #29258 | webhook workflow action                 | server         | MEDIUM       | New migration `AddPluginMethodAllowedHosts` (additive col on v3-native `plugin_method`); DTO field; revert-to-immich entry added |
| 293a  | `b16cc496b` | #29289 | MS SMTP docs guide                      | docs           | LOW          | docs-only (+webp)                                                                                                                |
| 293b  | `d85e599ad` | #29340 | ultimate plugin type safety             | plugin-sdk     | LOW          | `plugin-core`/`plugin-sdk` src; fork has zero divergence — clean                                                                 |
| 293c  | `29949bebe` | #29236 | mobile: toggle backup from switch only  | mobile         | LOW          | upstream-owned file, clean replay                                                                                                |
| 294   | `6507b1f94` | #29331 | pump doc references (release tooling)   | CI/build       | MEDIUM       | Relocated release tooling `misc/release/*` → `packages/scripts`; **dropped per fork policy** (see below)                         |
| 295   | `23d1dbcb2` | #29290 | update translations (Weblate)           | i18n           | MEDIUM       | 75 locales, deletion-heavy; `eu.json` refilled; disclosure + keep-both handling                                                  |
| 296   | `09d4a6815` | —      | chore: version v3.0.0-rc.3              | version        | LOW          | Version-only; mobile kept at 1.0.0+1                                                                                             |
| 297   | `6e1143e79` | #29012 | mobile: hide video thumbnail when ready | mobile         | LOW          | upstream-owned file, clean replay                                                                                                |

## Conflict Resolutions (10)

### 1. `pnpm-lock.yaml` (squash commit)

- **Fork side**: fork S3/AWS deps on old upstream base.
- **Upstream side**: rc.3 + #29331's `packages/scripts` + lockfile reshape.
- **Resolution**: took fork (`--theirs`) + rerere, per established pattern. Post-rebase verification showed the lockfile is **byte-identical to the last CI-green tip** (`920f3ced77`) and needs no regeneration — the dependency graph is unchanged this batch (only version fields moved), and `@immich/scripts` was correctly absent (dropped — see #6).
- **Risk**: LOW. Verified: `@aws-sdk/client-s3` present, `@faker-js/faker@10.3.0` + `nanoid@3.3.12` pins intact, `@immich/sdk` uses `link:` form, no `@immich/scripts`.

### 2. `mobile/pubspec.yaml` (fork #121)

- **Resolution**: kept fork version `1.0.0+1` over upstream's `3.0.0-rc.3+3051` (fork owns mobile versioning).
- **Risk**: LOW.

### 3. `.github/workflows/prepare-release.yml` (fork #207, modify/delete)

- **Resolution**: kept the deletion (recurring rule — fork uses `gallery-release.yml`).
- **Risk**: LOW.

### 4. `docs/docs/developer/directories.md` (fork #360)

- **Fork side**: Gallery link/image rebrand + widened table.
- **Upstream side**: `misc/release/` row → `packages/scripts` row.
- **Resolution**: kept fork rebrand; the `packages/scripts` row was later removed with the #29331 drop (#6).
- **Risk**: LOW.

### 5. `i18n/kn.json` (fork location-disclosure commit)

- **Fork side**: branded `map_no_location_permission_content`.
- **Upstream side**: #29290 reworded it (unbranded) and dropped `map_zoom_to_see_photos`.
- **Resolution**: applied the fork's branded disclosure onto upstream's current state (kept branded disclosure, followed upstream's drop of the zoom key).
- **Risk**: LOW. Validated JSON; disclosure policy scan passes.

### 6. `.github/workflows/test.yml` (fork #516 + fork #28922)

- **Fork side**: `upstream-preflight` job (replacing `root-unit-tests`); #28922 dropped the `root`/`misc` filter.
- **Upstream side**: #29331 renamed `root-unit-tests` → `script-unit-tests` (+ `scripts` filter) for the new `@immich/scripts` package.
- **Resolution**: kept the fork's `upstream-preflight` job + filter; **removed the upstream `script-unit-tests` job + `scripts` filter** per the fork's documented #28922 policy (the fork strips upstream release-version tooling — see Pattern/Policy below). All other upstream jobs preserved.
- **Risk**: LOW. Verified test.yml retains every upstream job except `script-unit-tests`; no orphaned `needs:` references; no PUSH_O_MATIC.

### 7–9. `i18n/de.json` + `i18n/fr.json` (fork #697, #705, #708)

- **Fork side**: additive German/French translations for fork-only strings (#697: 447 keys; #705: 161 keys; #708: 11 keys — all pure additions).
- **Upstream side**: #29290 reorganized + removed stale keys from de/fr.json.
- **Resolution**: deterministic **en.json-aware union** — start from HEAD (upstream's current de/fr state), add the fork's translation for any key that is **live in the current `en.json`** and missing from HEAD; never re-add keys upstream removed from en.json. This correctly preserved 15 fork-used keys per file that upstream removed from de/fr but the fork keeps in en.json (`backup_all`, `repair`, `manage_shared_links`, …). Verified: 0 HEAD keys dropped, 0 non-live keys in result.
- **Risk**: LOW. Both files validated as JSON + prettier-formatted.

## Pattern / Policy: dropped upstream #29331 release-version tooling

Upstream #29331 relocated the release version-pump tooling from `misc/release/*` to a
new `@immich/scripts` package (`packages/scripts/`) plus a `mise.toml [tasks.release]`
task and a `script-unit-tests` CI job. The fork removed upstream's release machinery in
**#207 / #28922** — it versions from git tags via `gallery-release.yml` and does not use
the pump tooling. #28922's commit message documents this policy explicitly ("remove the
now-unused root test.yml filter and its PUSH_O_MATIC job").

Continuing that policy, this rebase drops #29331's additions in a dedicated commit
(`497915e1`): removed `packages/scripts/`, the `mise.toml [tasks.release]` task, the
`script-unit-tests` job + `scripts` filter, and the `directories.md` row. The fork lockfile
already lacked `@immich/scripts`, so the drop is the consistent state (no regen needed).

> **Reviewer decision point**: this drops an upstream package per fork precedent. If you'd
> rather carry `packages/scripts` untested instead, revert `497915e1` (and re-add the CI
> job/filter). Recommended: keep the drop (consistent with #207/#28922).

## Database Migration Analysis

| Timestamp     | Migration                            | Tables          | Risk | Notes                                                                                                                                                 |
| ------------- | ------------------------------------ | --------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1782414436633 | AddPluginMethodAllowedHosts (#29258) | `plugin_method` | LOW  | Additive `allowedHosts varchar[] NOT NULL DEFAULT '{}'` on a v3-native upstream table the fork does not extend. No collision with Gallery migrations. |

- **Gallery migration count**: 33 / 33 (postrebase-audit). No timestamp collisions.
- **`revert-to-immich.sql`**: added `'1782414436633-AddPluginMethodAllowedHosts'` to the
  post-v2.7.5 `kysely_migrations` DELETE list; schema reversal already covered by the
  existing `DROP TABLE plugin_method CASCADE` (commented). Coverage detector passes.
- **Mobile Drift**: no upstream `schemaVersion` change; mobile-drift-rebase-check OK.

## i18n Handling

- **Location-disclosure scan**: `eu.json` (Basque, refilled by #29290) carried 3 unbranded
  disclosure keys; deleted them so they fall back to `en.json`'s branded copy
  (`location_disclosure_copy_test` policy). All locales now branded-or-absent.
- **Completeness**: `en.json` is unchanged vs the last-green tip — no fork-used keys dropped.

## Fork Feature Verification

| Feature                        | Status | Notes                                          |
| ------------------------------ | ------ | ---------------------------------------------- |
| Shared Spaces / User Groups    | OK     | postrebase-audit: fork files + symbols survive |
| Storage Migration              | OK     | no upstream overlap                            |
| Pet Detection / Classification | OK     | no upstream overlap                            |
| Command Palette / Smart Search | OK     | i18n keep-both preserved fork keys             |
| Branding                       | OK     | ci-invariants + branding config (2.7.5) intact |
| Mobile shared-space Drift sync | OK     | schemaVersion 24, callbacks intact             |

## CI and Infrastructure Verification

| Check                             | Status | Notes                                                                                     |
| --------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `ci-invariants-check`             | OK     | no PUSH_O_MATIC, gallery images, docs-deploy disabled                                     |
| `fork-patches-check`              | OK     | `@immich/ui` patch consistent                                                             |
| `mobile-drift-rebase-check` (297) | OK     | schemaVersion/snapshots/callbacks consistent                                              |
| `upstream-postrebase-audit` (297) | OK     | fork files/symbols survive, migrations 33/33, no collisions, no generated-artifact review |
| Workflow files                    | OK     | all upstream test.yml jobs present minus `script-unit-tests` (intentional)                |

## Local Verification

| Check                                          | Status        | Notes                                                                                      |
| ---------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------ |
| `mise //:open-api` (build + spec + SDK + Dart) | PASS          | regen **no-op** (specs already correct); server `dist/main.js` rebuilt                     |
| `server pnpm check` (tsc)                      | PASS          | —                                                                                          |
| `web check:typescript`                         | PASS          | —                                                                                          |
| `web check:svelte`                             | PASS          | 0 errors                                                                                   |
| `pnpm-lock.yaml`                               | PASS          | byte-identical to last-green; pins intact                                                  |
| `mise //:sql`                                  | SKIPPED       | no fork-extended `@GenerateSql` repo changed; plugin/workflow `.sql` identical to upstream |
| Server/web lint, unit tests                    | DEFERRED → CI | eslint config unchanged; server changes are upstream-only                                  |
| Mobile (`dart analyze`, build)                 | DEFERRED → CI | impossible locally (worktree flutter pin)                                                  |

## Post-Rebase Verification

- Fork commits ahead of upstream: 829 (incl. report + the 2 new chore/fix commits)
- Commits behind upstream: 0
- Conflict markers tree-wide: 0
- Rolling status: 297/297 upstream batches complete; 0 fork pending
