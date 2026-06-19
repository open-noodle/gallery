# Upstream Sync Report — 2026-06-19 (batch 274 / 4 upstream + 0 fork)

Routine sync on top of `2026-06-18-upstream-sync-batch-273.md`. Clean batch — no build-infra churn, one trivial conflict.

## Summary

- **Mode**: rolling-upstream-rebase on `rebase/upstream-rolling-20260509-active` (v3-cutover branch, held off `main`)
- **Fork commits synced**: 0 — `origin/main` unchanged at #710 `679acdd6` (already integrated last batch).
- **Upstream commits pulled** (`9a5e7a8e47..38920fc4ca`): 4 — target = `upstream/main` `38920fc4ca`.
- **Conflicts resolved**: 1 — `mobile/pubspec.yaml` (fork version-pin vs upstream RC bump).
- **New migrations**: 0 — Gallery migration count steady at **33**, mobile Drift unchanged.
- **OpenAPI regen**: none — no endpoint/DTO shape changes (only repo-internal logic + version strings).
- **Risk level**: LOW-MEDIUM (no build-infra changes; the two server changes applied cleanly).
- **Recommendation**: DONE — all local checks + 4 audits GREEN; all 7 dispatched CI workflows GREEN on first pass.

> **Scope note:** held rolling branch — not pushed to `main`, no `branding.upstream.version` bump (stays `v2.7.5`). Now **0 behind / 789 ahead** of `upstream/main`.

## Upstream commits (4)

| SHA        | PR     | Area               | Risk    | Outcome                                                                                                                                                                                                                                                          |
| ---------- | ------ | ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a7195522` | #29194 | server             | MED→LOW | rc version-check: maps `ReleaseChannel.Stable→'stable'` / `ReleaseCandidate→'rc'` in `server-info.repository.ts`. **Applied clean** — fork file was byte-identical to upstream base; fork's version-check override (PR #320) lives in config/env, not this repo. |
| `805bb848` | #29200 | server (migration) | LOW     | defensive album-owner migration: **+1 line** `onConflict(...).doUpdateSet({role: Owner})` to the _existing_ `1776848612954-MigrateAlbumOwnerIdToAlbumUser`. Not a new migration; idempotency only — schema outcome unchanged. **Applied clean.**                 |
| `3abeb4df` | #29162 | i18n               | LOW     | Weblate translation update across 19 locales (be/bg/cs/de/eo/es/eu/gl/hu/it/ko/nb_NO/pt/sk/sl/sv/th/tr/yue). **Applied clean** — `de.json` auto-merged with the fork's German fork-only strings; `en`/`en_GB`/`fr` untouched.                                    |
| `38920fc4` | —      | version            | LOW     | chore: version `v3.0.0-rc.2` — version strings in package.jsons/specs/fetch-client + mobile pubspec. Conflict only on mobile pubspec (see C1). Fork apply-branding overrides versions at build anyway.                                                           |

## Conflict resolutions

### C1 — `mobile/pubspec.yaml` (at fork #121)

`v3.0.0-rc.2` bumped upstream's mobile `version: 3.0.0-rc.1+3049 → 3.0.0-rc.2+3049`; fork commit #121 pins `version: 1.0.0+1` for the initial Play Store release. **Kept the fork's pin** (`1.0.0+1`) — Gallery ships as a separate app with its own versioning, and the release workflows (`gallery-release-mobile.yml` / `gallery-build-mobile.yml`) set the build version at CI time. This is the recurring resolution for every upstream mobile version bump.

## Migrations & revert-to-immich coverage (step 7i)

- **No new migration** this batch. #29200 modifies the _existing_ `1776848612954-MigrateAlbumOwnerIdToAlbumUser`.
- That migration is already covered in `scripts/revert-to-immich.sql`: full schema revert (lines 317–359) + kysely_migrations row deletion (line 613, post-v2.7.5 block).
- #29200's `onConflict` upsert only makes the forward data-copy idempotent; it does **not** change the schema outcome the revert SQL reverses → **no revert-to-immich.sql change needed.** Coverage intact.

## Audits & local verification

| Check                                   | Status | Notes                                                                                    |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| postrebase-audit (274)                  | GREEN  | fork files/symbols, 33 migrations, no timestamp collisions, Generated-Artifact-Review OK |
| fork-patches-check                      | GREEN  | @immich/ui patch metadata consistent                                                     |
| ci-invariants-check                     | GREEN  | no PUSH_O_MATIC; gallery images; upstream docs-deploy stays dispatch-only                |
| mobile-drift-rebase-check (274)         | GREEN  | schemaVersion / snapshots / Gallery callbacks consistent                                 |
| svelte.config.js fork resolution        | INTACT | fork's omit-`version.name` block (line 27)                                               |
| de.json auto-merge                      | OK     | valid JSON (2502 keys); fork German fork-only strings survived                           |
| SDK build (`tsc`)                       | PASS   | —                                                                                        |
| Server `check` (`tsc`)                  | PASS   | #29194 version-check switch compiles                                                     |
| Web `check:typescript` / `check:svelte` | PASS   | tsc clean; svelte-check 0 errors / 0 warnings                                            |
| Server unit tests                       | GREEN  | 4672 passed, 9 skipped, 0 failed (141 files)                                             |
| Web unit tests                          | GREEN  | 3166 passed, 2 skipped, 8 todo, 0 failed (239 files)                                     |

## Remote CI verification

Dispatched on `rebase/upstream-batch-274`. **All 7 GREEN — first pass** (no build-infra changes, so the batch-273 cold-build saga did not recur).

| Workflow                            | Result |
| ----------------------------------- | ------ |
| Test                                | GREEN  |
| Docker                              | GREEN  |
| Static Code Analysis                | GREEN  |
| Gallery Build Mobile                | GREEN  |
| Gallery Rebase Smoke                | GREEN  |
| Storage Migration Tests             | GREEN  |
| Gallery Revert-to-Immich Validation | GREEN  |

## Post-rebase state

- Upstream base: `38920fc4ca` (`9a5e7a8e47..38920fc4ca`); fork commits ahead: **789**; behind: **0**.
- `integratedForkHead`: `679acdd6` (unchanged — no fork-sync); `upstreamTargetHead`: `38920fc4ca`.
- Canonical `rebase/upstream-rolling-20260509-active` updated to the rebased tip; not pushed to `main` (held for v3 cutover).
