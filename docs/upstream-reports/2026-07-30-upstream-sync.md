# Upstream Sync Report — 2026-07-30

Opens the **post-v3.1.0 rolling cycle** (targeting what is expected to become Immich **v3.1.1** — upstream has not tagged it yet).

## Summary

- **Rolling branch**: `rebase/upstream-rolling-v3.1.1` (worktree `.worktrees/rebase-upstream-rolling-v3.1.1`)
- **Fork base**: `f98be57c5b5` (`origin/main`, #880)
- **Upstream base**: `8aa95c67470` — Immich **v3.1.0**
- **Upstream integrated**: `534b8746e49` (batch 11 tip) — **15 commits**
- **Upstream held back**: **22 commits** (batches 12–26, through `aa565f5ca07`) — quarantined, see below
- **Branch HEAD**: `5aa0e1cf518`
- **Conflicts resolved**: 8 (5 by hand, 3 classes auto-resolved under audited rules)
- **Risk level**: MEDIUM for what was integrated; **HIGH** for what was quarantined
- **Recommendation**: PROCEED for batches 01–11. **STOP at batch 12** pending a product/architecture decision.

`branding/config.json` `upstream.version` stays at **3.1.0** — it is only bumped when the fork actually lands on a tagged upstream release, and v3.1.1 does not exist yet.

## Quarantine — batches 12–26 held at the Checkpoint-1 gate

Three upstream commits remove **all committed mobile generated code** and move CI to build-time generation:

| Commit                 | What it removes                                                                   |
| ---------------------- | --------------------------------------------------------------------------------- |
| `27a29b6fabd` (#30297) | Drift generated code (`*.drift.dart`, `test/drift/main/generated/schema_vN.dart`) |
| `6c01b4f5d8e` (#30287) | the entire `mobile/openapi/` generated Dart client                                |
| `9a143f00471` (#30343) | Pigeon generated code (`*.g.dart` / `*.g.swift` / `*.g.kt`)                       |

They also drop `static_analysis.yml`'s 30-line generated-file freshness gate, remove `mobile/openapi` from `test.yml`'s `verify-changed-files`, and delete the `mobile/openapi` `merge=unset` entries from `.gitattributes`.

This inverts a contract the fork depends on:

- `CLAUDE.md` documents that Drift/OpenAPI generated code **is** committed, so `build_runner` is not needed to run mobile tests.
- The fork's `make open-api` regenerates **and commits** the Dart client, including fork-only surfaces (`gallery_map_api.dart`, shared-space APIs).
- The fork owns Drift snapshots **v32–v36** plus their generated `schema_vN.dart` counterparts.
- Three fork-only mobile workflows (`gallery-build-mobile.yml`, `gallery-mobile-smoke.yml`, `gallery-mobile-scale-test.yml`) assume the committed-codegen layout.

Interleaved with them, batches 15/20/24 (`d864a908117` #30370, `858aeadce80` #30373, `e7aace436d2` #30372) enable ~20 new Dart lint rules across 360+ upstream files — `discarded_futures`, `unawaited_futures`, `cast_nullable_to_non_nullable`, `close_sinks`, `cancel_subscriptions`, `use_colored_box`, `sized_box_for_whitespace`, `avoid_unnecessary_containers` and more. The fork's Dart surface is large (spaces pages, the whole `photos_filter` provider/widget tree, people services) and the fork CI gate is `dart analyze --fatal-infos lib test`, so this needs a fork-side sweep of currently unmeasured size.

**Upside of adopting**: it removes the recurring `mobile/openapi` merge conflict that forced a hand-applied fork sync on 2026-07-25.

Decision (Pierre, 2026-07-30): quarantine at batch 12, roll the safe majority now, brainstorm + spec the mobile-codegen adoption and lint propagation before rebasing 12+. Recorded in `rolling-state.json` `quarantineHistory`.

## Incoming upstream changes (integrated: batches 01–11)

| Batch | SHA           | Summary                                                       | Area   | Risk | Notes                                                             |
| ----- | ------------- | ------------------------------------------------------------- | ------ | ---- | ----------------------------------------------------------------- |
| 01    | `cf213c81e31` | make sure iOS memory widget render (#30172)                   | mobile | LOW  | fork has its own memories; widget-render only                     |
| 02    | `6c86d39f6d9` | calendar heatmap permissions (#30310)                         | server | MED  | permission surface the fork's RBAC layers on                      |
| 03    | `4225281f9f9` | mise docker tag → v2026.7.15 (#30301)                         | CI     | MED  | toolchain pin                                                     |
| 04    | `f68815e35f4` | calendar heatmap api key permissions (#30314)                 | server | MED  | as batch 02                                                       |
| 05    | `fbf45354690` | valkey:9 digest → 3acc068 (#30298)                            | CI     | MED  | **conflict** — see CR-1                                           |
| 06    | `e3ecb087115` | update github-actions (#30302)                                | CI     | HIGH | **4 conflicts** — see CR-2…CR-5                                   |
| 07    | `4609adbb6d8` | add cantonese for mobile (#30318)                             | i18n   | LOW  |                                                                   |
| 07    | `b468459b1aa` | test for admin controller permissions (#30316)                | server | MED  | new invariant — verified fork-clean below                         |
| 07    | `8cb5bf92c2a` | clarify contributing guidelines (#30330)                      | docs   | MED  | **conflict** — see CR-6                                           |
| 08    | `1094b69946e` | matplotlib in rootless deployments (#30328)                   | deploy | LOW  | `MPLCONFIGDIR` moved to ML Dockerfile                             |
| 09    | `bcf6e66e26d` | remove old makefiles (#30339)                                 | infra  | HIGH | **conflict** — see CR-7                                           |
| 09    | `04baedcffbb` | privacy policy link (#30344)                                  | docs   | MED  | **conflict** — see CR-8                                           |
| 09    | `3ab09352eb2` | spam rule in CONTRIBUTING genAI section (#30355)              | docs   | LOW  |                                                                   |
| 10    | `af5ff4983ac` | skip release label validation on merge queue PRs (#30361)     | CI     | LOW  | fork has no merge queue                                           |
| 11    | `534b8746e49` | refresh person thumbnail when featured photo changes (#29350) | mobile | HIGH | **3 conflicts** on the fork's #727/#737 people surface — see CR-9 |

### High-risk changes verified rather than assumed

**`b468459b1aa` — new `controllers/index.spec.ts`** asserts every `admin/`-prefixed route declares `admin: true`, against a hardcoded 3-route bootstrap allowlist. The fork adds admin-prefixed routes in two fork-only controllers: `face-repair-admin.controller.ts` (`admin/face-repair`) and `library-manifest.controller.ts` (`admin/users/:id/library-manifest`). **Both already declare `admin: true`** — the new spec passes, and it is a useful invariant to keep honouring for future fork admin routes.

**`a316ba35caf` (batch 17, NOT integrated — quarantined)** makes `AuthGuard.canActivate` **throw** when a route lacks `@Authenticated()` (previously it returned `true`, i.e. public). Checked ahead of time: all **55** routes across the 7 fork-only controllers already carry `@Authenticated()`, so this will be safe when batch 17 is eventually pulled. It also adds `requireSetupAvailable` to `AuthService`/`ControllerContext` and rewrites `automock()` prototype walking in `server/test/utils.ts`, which fork specs share — worth re-checking at integration time.

## Conflict Resolutions

### CR-1 — `e2e/docker-compose.yml` (batch 05)

- **Fork side**: pulls valkey from **GHCR** (`ghcr.io/valkey-io/valkey:9`) to dodge Docker Hub rate limits in CI (commit `44f81f40050`).
- **Upstream side**: bumped the Docker Hub digest to `sha256:3acc0687…`.
- **Resolution**: fork's registry **+** upstream's digest → `ghcr.io/valkey-io/valkey:9@sha256:3acc0687…`.
- **Risk**: LOW. **Verified, not assumed**: queried the GHCR registry API — that digest returns HTTP 200 on `ghcr.io/valkey-io/valkey` and is exactly what the `:9` tag currently resolves to there.

### CR-2 — `.github/workflows/auto-close.yml` (batch 06)

- **Fork side**: deletes the `parse_template` / `close_template` jobs, keeping only `close_llm` (documented fork CI modification — fork PRs are internal and the template bot auto-closed them).
- **Upstream side**: bumped `actions/checkout` v7.0.0 → v7.0.1 **inside `parse_template`**.
- **Resolution**: keep the fork's deletion; upstream's pin bump targets a job the fork does not have.
- **Risk**: LOW. Result is byte-identical to `origin/main`'s copy of the file.

### CR-3 — `.github/workflows/docs-destroy.yml`, `prepare-release.yml` (batch 06)

- **Fork side**: files deleted (Cloudflare/Terraform docs teardown and upstream release prep — infrastructure and `PUSH_O_MATIC` secrets the fork does not have).
- **Upstream side**: action pin bumps inside them.
- **Resolution**: keep deleted. Auto-applied under the audited rule "UD **and** absent from `origin/main`".
- **Risk**: LOW.

### CR-4 — `.github/workflows/build-mobile.yml`, `test.yml` (batch 06)

- **Fork side**: removes the `create-workflow-token` (`PUSH_O_MATIC`) step and uses `${{ github.token }}` — the documented fork CI modification; without it **no CI runs on fork PRs**.
- **Upstream side**: `actions/checkout` v7.0.0 → v7.0.1 in the same step lists.
- **Resolution**: take **upstream's** file (so all other upstream changes land), then re-apply the fork transformation mechanically — drop the `- id: token` block, rewrite `steps.token.outputs.token` → `github.token`. 18 token steps removed from `test.yml`, 1 from `build-mobile.yml`.
- **Risk**: LOW–MEDIUM. Verified: all 36 workflow YAML files still parse; repo-wide grep for `PUSH_O_MATIC` / `create-workflow-token` / `steps.token.outputs.token` across `.github/workflows/` returns **nothing** (except the documented `merge-translations.yml` exception, untouched); `make ci-invariants-check` passes its `no-push-o-matic` invariant.

### CR-5 — `.github/workflows/test.yml`, `script-unit-tests` job (batch 06)

- **Fork side**: fork commit `25c78efff3d` deletes the whole `script-unit-tests` job; an earlier fork commit (`80dabc31c01`, #516) had swapped its `Setup Mise` step for `Setup pnpm` + `Setup Node`.
- **Upstream side**: `actions/checkout` pin bump inside that job.
- **Resolution**: replay both fork commits faithfully — the intermediate state uses pnpm/Node (keeping upstream's newer checkout pin, which merged cleanly), and the later fork commit removes the job entirely. Confirmed against `origin/main`, whose `test.yml` has no `script-unit-tests` job.
- **Risk**: LOW. The single dropped upstream line was a checkout pin inside the deleted job; it is logged in the resolution output.

### CR-6 — `CONTRIBUTING.md` (batch 07)

- **Fork side**: the "Use of Generative AI" section is **inverted** relative to upstream — the fork _actively encourages_ LLM-assisted PRs and instead requires a spec/design document and tests.
- **Upstream side**: added two paragraphs hardening its discouragement of LLM PRs.
- **Resolution**: keep the fork's section. This is a deliberate, standing fork policy divergence, not a merge artifact.
- **Risk**: LOW. Upstream's unrelated "publically" → "publicly" typo fix in the same file **was** kept.

### CR-7 — `Makefile` (batch 09)

- **Fork side**: fork-owned and load-bearing — carries every `upstream-*` rolling target, `storage-migration-*`, `gallery-branding-check`, and the `e2e-*-dev` helpers.
- **Upstream side**: deleted `Makefile` and `mobile/makefile` outright (everything moved to `mise`).
- **Resolution**: keep the fork's `Makefile`. **Accept** upstream's deletion of `mobile/makefile`.
- **Risk**: LOW. `mobile/makefile` was checked before accepting the deletion: on `origin/main` it contains **only** deprecation stubs that print "This command has been removed. Please use: mise …" — zero fork functionality — and a repo-wide grep finds no reference to it (`mobile/makefile`, `make -C mobile`, `cd mobile && make`). Note this deletion arrived **without** a conflict, so it would have passed silently unreviewed.

### CR-8 — `docs/docusaurus.config.js` (batch 09)

- **Fork side**: fork commit `5946da573d2` removes the whole `Miscellaneous` footer section (Roadmap / Cursed Knowledge / Privacy Policy — all `immich.app` links) and renames the next section `Social` → `Community`.
- **Upstream side**: fixed the Privacy Policy link (`to: '/privacy-policy'` → `href: 'https://immich.app/privacy-policy'`) **inside the removed section**.
- **Resolution**: keep the fork's footer. Verified against `origin/main`, whose footer sections are Product / Community / Upstream with no `Miscellaneous`.
- **Risk**: LOW.

### CR-9 — mobile person thumbnails, 3 call sites (batch 11) ← most substantive

- **Fork side** (#737/#738): routes thumbnails per profile scope via `getPersonThumbnailUrl(id, spaceId: …)`. Per `CLAUDE.md`, a Space person's id is a `shared_space_person` id with **no row** in the owner-only `person` table, so `GET /people/{id}/thumbnail` **404s** for it and must go to the membership-gated space endpoint.
- **Upstream side** (#29350): adds cache-busting `updatedAt` to `getFaceThumbnailUrl` so a person's thumbnail refreshes when its featured photo changes.
- **Resolution**: **combine both.** Taking the fork side alone would have silently dropped upstream's bug fix; taking upstream's alone would 404 every shared-space person. Threaded `updatedAt` through the fork's helpers in `mobile/lib/utils/image_url_builder.dart` — `getSpacePersonThumbnailUrl(spaceId, personId, {updatedAt})` now applies the same `?c=<ms>` cache-buster, and `getPersonThumbnailUrl(id, {spaceId, updatedAt})` forwards it down both branches — then updated all three call sites to pass `updatedAt: person.updatedAt`:
  - `mobile/lib/presentation/pages/drift_people_collection.page.dart`
  - `mobile/lib/widgets/common/person_sliver_app_bar.dart`
  - `mobile/lib/presentation/widgets/asset_viewer/asset_details/people_details.widget.dart`
- **Risk**: MEDIUM. `DriftPerson` carries a non-nullable `updatedAt` and a nullable `spaceId`, so both branches are well-typed. Files re-formatted with `dart format --line-length 120`.
- **Verification needed**: shared-space people now get the cache-buster too — a behaviour **improvement** over upstream, but it should be smoke-checked on device that the space thumbnail endpoint tolerates the `?c=` query parameter.
- Upstream also edited `mobile/lib/widgets/search/search_filter/people_picker.dart`; the fork has deleted that legacy picker, so the deletion was kept (same rule as CR-3).

## Fork Feature Verification

| Feature                                  | Status | Notes                                                                                                              |
| ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| Shared Spaces                            | OK     | `make upstream-postrebase-audit` "Fork-Owned File Survival" + "Fork Extension Symbol Survival" pass on every batch |
| Storage Migration                        | OK     | audit clean                                                                                                        |
| Pet Detection                            | OK     | audit clean                                                                                                        |
| Image Editing                            | OK     | audit clean                                                                                                        |
| Branding                                 | OK     | `make fork-patches-check` passes                                                                                   |
| Google Photos Import                     | OK     | audit clean                                                                                                        |
| Mobile shared-space people (#727 family) | OK     | see CR-9 — routing preserved and extended                                                                          |

## CI and Infrastructure Verification

| Check                                    | Status | Notes                                                      |
| ---------------------------------------- | ------ | ---------------------------------------------------------- |
| Workflow files (no upstream collisions)  | OK     | 36 workflow files, all valid YAML                          |
| Docker image references (`gallery-*`)    | OK     | `ci-invariants-check` `gallery-release-image-names` passes |
| No `PUSH_O_MATIC` dependency             | OK     | `ci-invariants-check` `no-push-o-matic` passes             |
| Upstream docs-deploy stays dispatch-only | OK     | `ci-invariants-check` passes                               |
| Fork CI modifications intact             | OK     | CR-2 … CR-5 re-applied                                     |
| Fork `Makefile` retained                 | OK     | CR-7                                                       |

## Database Migration Analysis

- **New upstream migrations in the integrated range**: **none**. (The two `''` → `null` migrations — `9732bebb55a` user password, `6b6058c4631` album description — are in **quarantined** batches 22 and 25.)
- **Gallery migration count**: **49** — unchanged, matching the expected baseline.
- Audit checks pass: Gallery Migration Count, Gallery Migration Filename Survival, Gallery Migration Manifest Coverage, Migration Timestamp Collision Check.
- `revert-to-immich.sql` coverage: unaffected this cycle (no new upstream migrations integrated). **Will need updating at batches 22 and 25.**

## Mobile Drift Migration Analysis

- `make mobile-drift-rebase-check BATCH=11` — **passes**.
- No upstream `schemaVersion` bump in the integrated range; fork-owned snapshots v32–v36 untouched. No renumbering required.
- The quarantined batch 12 (`27a29b6fabd`) is the one that deletes generated Drift code — handled as part of the quarantine decision, not as a migration renumbering.

## Inconsistencies Found

None in the integrated range beyond the conflicts documented above. One near-miss worth recording: **`mobile/makefile` was deleted with no conflict at all** (the fork had not modified it since the merge base), so it never surfaced for review — it was caught only by an explicit post-rebase file-presence check. See CR-7.

## Pattern Propagation

| Refactor                                      | Old → New Pattern                                                                   | Fork Files Affected                                                                      | Decision                                      | Commit / Follow-up                               |
| --------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| Makefile → `mise` tasks                       | `make <target>` → `mise <task>`                                                     | root `Makefile` (fork-owned, kept), `mobile/makefile` (stub-only, deleted)               | Partially adopted                             | CR-7                                             |
| Committed mobile codegen → build-time codegen | committed `*.drift.dart` / `mobile/openapi` / `*.g.*` → `mise //mobile:codegen`     | `CLAUDE.md`, `make open-api`, 3 fork-only mobile workflows, fork Drift snapshots v32–v36 | **Deferred — quarantined at batch 12**        | needs brainstorm + spec                          |
| Stricter Dart lints (~20 rules)               | permissive → `discarded_futures`, `close_sinks`, `cast_nullable_to_non_nullable`, … | fork-only Dart: spaces pages, `photos_filter` tree, people services                      | **Deferred — quarantined (batches 15/20/24)** | scope unmeasured; measure once rules are in tree |

### Follow-up work

1. Brainstorm + spec the **mobile build-time codegen adoption** before rebasing batch 12.
2. Measure and land the **Dart lint propagation** for fork-only mobile code (batches 15/20/24).
3. At batch 17, re-verify `server/test/utils.ts` `automock()` changes against fork specs.
4. At batches 22 and 25, add the two new upstream migrations to `scripts/revert-to-immich.sql` (step 7i) or `gallery-revert-to-immich-validation` will fail on this branch **and every branch based on it**.

## Local Verification

| Check                                            | Status |
| ------------------------------------------------ | ------ |
| `make upstream-postrebase-audit` (batches 01–11) | PASS   |
| `make ci-invariants-check`                       | PASS   |
| `make fork-patches-check`                        | PASS   |
| `make mobile-drift-rebase-check BATCH=11`        | PASS   |
| Workflow YAML parse (36 files)                   | PASS   |

Full build / type-check / lint / unit-test results are recorded when the branch is pushed for remote CI.

## Post-Rebase Verification

- Fork commits replayed: **1026**
- Upstream commits integrated: **15** (batches 01–11)
- Upstream commits deliberately held: **22** (batches 12–26)
- Branch is a descendant of upstream `534b8746e49`: **yes**
