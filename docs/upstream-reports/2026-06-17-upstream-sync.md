# Upstream Sync Report — 2026-06-17

## Summary

- **Mode**: rolling-upstream-rebase on `rebase/upstream-rolling-20260509-active` (v3-cutover branch, held off `main`, deployed to staging)
- **Fork commits synced** (origin/main `ca3c09c2..c1387721`): 3 (#699, #704, #705)
- **Upstream commits pulled** (`0f49bcbd27..c9aa9ba711`): 10 (batches 255–261), tip is upstream **`v3.0.0-rc.1`**
- **Conflicts resolved**: 12 distinct sites (1 server, 2 mobile code, 2 mobile/test, 1 i18n, 5 CI workflows, 1 mobile pubspec, generated SDK)
- **Post-rebase fixes**: 1 — adapted #29158's `newMemory` medium-test helper to the fork's `MemoryData(raw)` API (`08a20ac8`); OpenAPI/SDK/Dart regen (no diff — already consistent)
- **New migrations this batch**: 0 (server and mobile) — Gallery migration count steady at **33**, mobile Drift schemaVersion unchanged
- **Risk level**: LOW–MEDIUM (no migrations, no broad refactors, no API breaks; two genuine code reconciliations: mobile timeline scroll-to-date vs unmount-safety, and a cross-feature test-helper merge)
- **Recommendation**: PROCEED — 0 behind upstream; server (4652) and web (3164) unit suites green locally; all structural audits green. Mobile gated on CI (correct flutter toolchain).

> **Scope note (held rolling branch):** Not force-pushed to `main`; pushed to its own remote (`origin/rebase/upstream-rolling-20260509-active`, the staging-deployed branch). The skill's force-push-to-main and `branding.upstream.version` bump steps are intentionally skipped — the revert-to-immich baseline stays at the tagged `v2.7.5`, and the v3 version story (including the `v3.0.0-rc.1` upstream label) is handled at cutover/release time. `branding/config.json` and `README.md` deliberately remain at `Immich v2.7.5` (matching prior rolling batches; setting an RC string would destabilise the release + revert-to-immich tooling).

## Part A — Fork sync (origin/main → rolling branch)

`make upstream-sync-fork-main` (all-or-nothing) threw on the first commit. Resolved by hand per the skill escape hatch, advancing `integratedForkHead` in `rolling-state.json` after each. origin/main advanced twice mid-operation (#704, then #705 landed), so the sync covered **3** commits, not the 2 present at start.

| Source SHA | PR   | Result     | Notes                                                                                      |
| ---------- | ---- | ---------- | ------------------------------------------------------------------------------------------ |
| `8c27f05d` | #699 | `5aac7ab3` | Owner-asset birthday-age fix. Conflict in `asset.service.ts` (see A1).                     |
| `99f58caf` | #704 | `e020f9a2` | Branding purchase/support strings across locales. Clean (auto-merged `apply-branding.sh`). |
| `c1387721` | #705 | `17fce460` | Translate hardcoded strings in fork-feature UIs (67 files). 8 conflicts (see A2).          |

### A1 — `asset.service.ts` (#699 vs v3 `unassignedFaces` removal)

#699 restructures the owner/non-owner branch of `getAssetInfo` to overlay identity-resolved birthday/name for the owner-viewing-own-asset path (`applyResolvedPersonMetadata`). It conflicted because the rolling branch had already dropped fork #437's `data.unassignedFaces = []` clearings — **upstream v3 removed the `unassignedFaces` field from `AssetResponseDto`** (absent in both `upstream/main` and the rolling DTO).

- **Resolution**: applied #699's owner-branch fix (new `else if (data.ownerId === auth.user.id)` + `applyResolvedPersonMetadata`) **without** re-adding the dead `data.unassignedFaces = []` line. #699's imports (`ShallowDehydrateObject`, `AssetFace`, `PersonResponseDto` — all resolve on the rolling tree) and the new method + 2 specs applied clean.
- **Verified**: `getResolvedPersonByIdentityId` exists on the rolling `FaceIdentityRepository`; server unit suite green.
- **Risk**: LOW.

### A2 — #705 (8 conflicts, fork-feature i18n)

| File(s)                                                                                           | Resolution                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `i18n/en.json`, `de.json`, `fr.json`                                                              | Additive keep-both (`choose`+`choose_matching_faces_to_reassign`, `workflow`+`workflow_close_summary`); empty merge-base, valid JSON.                                                                                                 |
| `…/GalleryViewer.spec.ts`, `space-activity-feed/card/search-results.spec.ts`                      | Kept HEAD imports (PascalCase paths, `TestWrapper`) + added #705's `svelte-i18n` import; #705's `beforeAll(register('en-US')/init/waitLocale)` + English-string assertions applied clean below the conflict.                          |
| `…/large-files/.../LargeAssetData.svelte`                                                         | Rename kebab→PascalCase; kept HEAD's v3 Tailwind classes + #705's `{$t('external')}` (the `t` import applied clean).                                                                                                                  |
| `…/utilities/workflows/[workflowId]/{SchemaFormFields,WorkflowJsonEditor,WorkflowSummary}.svelte` | **`git rm`** — upstream's "workflows & plugins" (#26727) was added then removed/relocated upstream; the directory is **absent from current `upstream/main`** and the rolling branch. #705's edits target files that don't exist here. |

- **Test-convention note**: the rolling global `web/src/test-data/setup.ts` inits `fallbackLocale: 'dev'`; #705 specs override to `en-US` in their own `beforeAll` (runs after, wins) and assert English. Vitest file isolation prevents cross-file leakage; non-#705 specs keep the key convention.
- **Verified**: 160 affected web specs (incl. 2 cleanly-applied #705 specs) green; full web suite 3164 green.

## Part B — Upstream rebase (10 commits, batches 255–261)

`0f49bcbd27..c9aa9ba711`. 762 fork commits replayed per batch; 0 behind upstream after batch 261.

| SHA        | PR     | Area    | Risk | Outcome                                                  |
| ---------- | ------ | ------- | ---- | -------------------------------------------------------- |
| `76c042ab` | #29091 | deps    | LOW  | clean (mise.lock maintenance; no pnpm-lock change)       |
| `27cfa0e7` | #29146 | CI      | LOW  | **reconciled** `docker.yml` (B1)                         |
| `3927eb67` | #29151 | Docker  | LOW  | clean (base-image bump; fork apply-branding intact)      |
| `a9d64b30` | #29148 | CI      | LOW  | clean (multi-runner-build; no file content)              |
| `83b4dc17` | #29149 | mobile  | MED  | **reconciled** `timeline.widget.dart` (B2)               |
| `12b7cd06` | #29158 | mobile  | LOW  | **reconciled** `repository_context.dart` (B3) + post-fix |
| `cda499f2` | #29159 | mobile  | LOW  | clean (toast dynamic-island)                             |
| `983a0057` | #29147 | CI      | LOW  | **reconciled** `test.yml` + 2 deletions (B4)             |
| `7cf904ac` | #29036 | i18n    | LOW  | **reconciled** `de.json` (B5)                            |
| `c9aa9ba7` | —      | version | LOW  | **reconciled** `pubspec.yaml` + generated SDK (B6)       |

### B1 — `docker.yml` (#29146 vs fork #217)

Fork #217 drops the ROCm ML build matrix entry; upstream #29146 bumps `multi-runner-build` v3.0.0→v3.1.0. **Resolution**: apply both — dropped the `rocm` device block and kept upstream's `@50dc3a14 # …v3.1.0`.

### B2 — `timeline.widget.dart` (#29149 vs fork #643)

Fork #643 **rewrote** the scroll-to-date subsystem (drain-retry machinery: `_attemptScrollDrain`/`_findSegmentForDate`/2-arg `_scrollToDate`, backed by `scroll_drain.dart` + `scroll_to_date_notifier.provider.dart`). Upstream #29149 added unmount-safety (capture `timelineState` local before async gaps) to the **old** `_scrollToDate` plus `_onEvent`/`_stopDrag`.

- **Resolution**: took #643's rewrite for the (now-deleted) old `_scrollToDate`; **preserved** #29149's `_onEvent` + `_stopDrag` unmount-safety (applied clean, verified present); and **propagated** #29149's captured-`timelineState` pattern into #643's new `_scrollToDate` (the `.whenComplete` previously read `ref` post-animation — the exact bug #29149 fixes). Import merged (`scroll_to_date_notifier.provider` kept; `settings.provider` not duplicated).
- **Risk**: MEDIUM. Mobile compile/test gated on CI (local flutter toolchain is 3.41.6, below the project's required 3.44.1 — see note).

### B3 — `repository_context.dart` (#29158 vs fork #313) + post-fix

Both appended methods to the `MediumRepositoryContext` class: upstream #29158 added `newMemory`/`newMemoryAsset`; fork #313 added shared-space/library helpers. Merge-base empty. **Resolution**: keep both method groups (all imports already present).

- **Post-rebase fix `08a20ac8`**: #29158's `newMemory` constructs `MemoryData(year: …)` (upstream's named-param API), but the fork's model is `MemoryData(Map<String,dynamic> raw)` (year in `raw['year']`). The helper failed to compile on the rolling branch — a latent mis-integration from this batch. Fixed to `MemoryData({'year': …})`. `repository_context.dart` analyzes clean afterward.

### B4 — `test.yml` + workflow deletions (#29147)

#29147 bumps `use-mise` v2.0.2→v3.1.0 across workflows.

- `docs-destroy.yml` (fork #187 delete), `prepare-release.yml` (fork #207 delete): kept the fork **deletions** over upstream's modifications.
- `test.yml`: the fork's `Upstream Rebase Tooling` job (#516) replaces Mise setup with explicit pnpm+Node — **took #516's pnpm+Node** (the `with: node-version-file/cache: pnpm` block belongs to setup-node). All other jobs took upstream's `use-mise@v3.1.0` cleanly.

### B5 — `i18n/de.json` (#29036 vs fork #697)

One additive collision: upstream #29036's `uploads_count` vs fork #697's `upstream_project` at the same alphabetical slot. **Resolution**: keep both (valid JSON). (The bulk of #697's ~490 fork keys integrated cleanly in earlier batches.)

### B6 — version bump (`v3.0.0-rc.1`)

- `mobile/pubspec.yaml`: kept fork `version: 1.0.0+1` (build-time stamped via `FORK_VERSION`) over upstream `3.0.0-rc.1+3049` (re-asserts fork #121).
- `packages/sdk/src/fetch-client.ts` (×2, generated header): resolved version comment to `3.0.0-rc.1`. Fully regenerated afterward (`mise //:open-api` produced **no diff** — the rebased generated artifacts already match a fresh regen, confirming consistency).

## Fork Feature Verification

| Feature                           | Status | Notes                                                                                  |
| --------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| Shared Spaces (server/web/mobile) | OK     | `postrebase-audit` fork-owned-file + symbol survival green; web spaces specs green.    |
| Storage Migration / S3            | OK     | No batch changes to storage backends; ci-invariants green.                             |
| Pet Detection                     | OK     | No batch changes; migration count steady.                                              |
| User Groups                       | OK     | No batch changes.                                                                      |
| Image Editing / Video Trim        | OK     | `asset.service.ts` (#699) resolved; trim duration helpers untouched this batch.        |
| Branding                          | OK     | #704 locale strings synced; `apply-branding` intact; branding-check passes.            |
| Google Photos Import              | OK     | No batch changes.                                                                      |
| Auto-Classification               | OK     | No batch changes.                                                                      |
| Mobile Shared-Space Drift         | OK     | schemaVersion unchanged; #313 helpers merged with #29158; mobile-drift-check green.    |
| Global Search / Filter Panel      | OK     | #705 i18n applied; web suite green.                                                    |
| Owner birthday-age (#699)         | OK     | `applyResolvedPersonMetadata` overlays identity-resolved birthday/name for owner path. |

## Audits & Verification

| Check                                       | Status | Notes                                                                |
| ------------------------------------------- | ------ | -------------------------------------------------------------------- |
| `postrebase-audit` (255–261)                | GREEN  | Fork file/symbol survival, 33 migrations, no timestamp collisions.   |
| `ci-invariants-check`                       | GREEN  | No PUSH_O_MATIC; gallery release images; docs-deploy disabled.       |
| `fork-patches-check`                        | GREEN  | `@immich/ui` patch metadata consistent.                              |
| `mobile-drift-rebase-check`                 | GREEN  | schemaVersion + snapshots + callbacks consistent.                    |
| OpenAPI/SDK/Dart regen (`mise //:open-api`) | GREEN  | **No diff** — artifacts already consistent.                          |
| SQL (`mise //:sql`)                         | N/A    | No server repository/query changes this batch (needs DB; unchanged). |
| Server unit tests                           | GREEN  | 4652 passed, 9 skipped, 0 failed (correct config).                   |
| Web unit tests                              | GREEN  | 3164 passed, 0 failed.                                               |
| Mobile (analyze/test/build)                 | CI     | Local flutter 3.41.6 < required 3.44.1 → deferred to CI mobile jobs. |

> Batch-261 `postrebase-audit` flagged `open-api/immich-openapi-specs.json` + `mobile/openapi/README.md` for review — expected (v3 spec-version bump + #700 endpoint); satisfied by the no-diff regen.

## Post-Rebase State

- Upstream base: `c9aa9ba711` (v3.0.0-rc.1); fork commits ahead: 762; behind upstream: 0.
- `integratedForkHead`: `c1387721` (= origin/main); `upstreamTargetHead`: `c9aa9ba711`.
- Remaining gate: full CI suite on the test branch (Docker, static_analysis, build-mobile, rebase-smoke, storage-migration, revert-to-immich) — mobile is the primary thing local verification could not cover.
