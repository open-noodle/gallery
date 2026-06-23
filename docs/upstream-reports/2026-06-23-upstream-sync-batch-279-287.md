# Upstream Sync Report — 2026-06-23 (batches 279–287)

## Summary

- **Mode**: rolling upstream rebase on `rebase/upstream-rolling-20260509-active` (held off `main`; no `branding.upstream.version` bump).
- **Fork commits synced** (`5089027c1b..79be552a26`, 1): #724 `79be552a26` (layered photo-app re-skin — token-driven). `integratedForkHead` advanced `5089027c1b → 79be552a26`.
- **Upstream commits pulled** (`b24a617142..9d6c219276`, 27): batches **279–287**. Target = `upstream/main` `9d6c219276`.
- **Conflicts resolved**: 8 code/config files + recurring `i18n` files (en.json + locale files), across the squash-base and individual fork commits.
- **New migrations**: 0 — Gallery migration count steady at **33**; mobile Drift schemaVersion unchanged.
- **OpenAPI/SDK/Dart**: full `mise //:open-api` (Java) regen → **no drift** (upstream's regenerated artifacts carried through cleanly).
- **Risk level**: MEDIUM (large batch — actions-architecture refactor overlapped fork asset-viewer/edit surface; sync-backfill on a fork-critical path; TypeScript v6 bump; an i18n cleanup removed 3 strings the fork still uses).
- **Recommendation**: PROCEED — local gate GREEN (server tsc + 4696 server unit; web tsc + 3296 web unit; mobile i18n codegen no-drift; all 7 per-batch audits GREEN ×9). Remote CI dispatch pending.

> **Scope note:** rolling branch only — not pushed to `main`. Now **0 behind / 812 ahead** of `upstream/main` (includes through #29282).

## Incoming Upstream Changes (batches 279–287)

| Batch | Tip          |   # | Risk   | Notable                                                                                                                                                                                                                                    |
| ----- | ------------ | --: | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 279   | `dc7d57ff9a` |   1 | HIGH\* | `fix(docsc): v3 bump` (#29246) — docs; \*flagged for CI-infra path only                                                                                                                                                                    |
| 280   | `a5198e23a8` |   8 | MED    | video-player seeking (#29208), detail-panel people reactivity (#29250), remove map fullscreen btn (#29192), QSV VBR (#29240), integrity ext-lib checksum (#29248), text-white-shadow (#29165), SemVer version msg (#29056), turkish readme |
| 281   | `ec7c0f9ec8` |   1 | HIGH   | **sync backfill (#29267)** — `sync.repository.ts`/`.sql` (fork-critical)                                                                                                                                                                   |
| 282   | `e51c4cb355` |   3 | MED    | mobile-ui snackbar (#29260), icon-button loading (#29263), column button (#29265)                                                                                                                                                          |
| 283   | `7dd02ffbad` |   1 | HIGH   | github-actions bump (#29272) — CI                                                                                                                                                                                                          |
| 284   | `f22836e1bf` |   1 | MED    | server upload-id described as string (#29274) — openapi                                                                                                                                                                                    |
| 285   | `ff2028c4c8` |   1 | HIGH   | prometheus docker digest (#29271)                                                                                                                                                                                                          |
| 286   | `f29f86542c` |  10 | MED    | **TypeScript v6 (#28772)**, simple/mobile/partner **actions refactor** (#29257/#29280/#29281), AssetViewerPage recreation (#29235), i18n cleanup (#29288)/update (#29204), workflow ordering, basque                                       |
| 287   | `9d6c219276` |   1 | MED    | current viewer asset reactivity (#29282)                                                                                                                                                                                                   |

## Conflict Resolutions

### Fork-sync #724 — `web/src/app.css`

- **Fork side**: trivial — #724 adds `@import './styles/gallery-theme.css';` after the `@immich/ui` import; rolling/v3 had a blank line there.
- **Resolution**: kept #724's import (the new `gallery-theme.css` file applied cleanly). **Risk: LOW.**
- Follow-on reconciliation (commit `2b2832321d`): added `web/src/styles/**` to `docs/fork/ownership.yml`, refreshed `last_verified_fork_head → 79be552a26`, and reconciled `@axe-core/playwright` peer to v3's `playwright-core@1.60.0` (pnpm-lock).

### Batch 279 — `docker/example.env`, `docs/docs/install/upgrading.md`

- Upstream #29246 bumped version examples (`:v2`→`:v3`); fork rebrands `Immich`→`Gallery`. **Resolution**: took both (fork's `Gallery`/`v3` example text). rerere recorded `upgrading.md`. **Risk: LOW.**

### Batch 280 — `web/src/lib/components/asset-viewer/DetailPanel.svelte`

- Upstream migrated the map popup to `<Text>`/`<Link>` (@immich/ui); fork replaced the single OpenStreetMap link with a `mapProviderLinks` loop. **Resolution**: kept the fork's loop **rendered via `<Text>`/`<Link>`** (matches upstream's own external-`<Link>` convention — no `target`). **Risk: LOW–MED.**
- `web/src/routes/(user)/people/manage/+page.svelte`: fork #450 replaced the inline people grid with `<PeopleVisibilityModal>`; upstream #29165 only added `text-white-shadow` to the now-deleted inline span. **Resolution**: took the fork's modal. See Pattern Propagation. **Risk: LOW.**

### Batch 282 — `mobile/lib/main.dart`

- Whole-file conflict between the fork's post-"timeline-yeet" analyzer-fix and upstream's snackbar change. Verified via stage diff that `ours = base + 1 line` (snackbar). **Resolution**: took the fork's main.dart and re-applied the single upstream line `scaffoldMessengerKey: scaffoldMessengerKey,` (resolves via the existing `immich_ui` import). **Risk: LOW** (verified the line survived to the final main.dart).

### Batch 286 — actions refactor + TS v6 + i18n

- `web/src/lib/services/asset.service.ts` (×2 commits): upstream's simple-actions refactor added `SetProfilePicture`/`ViewInTimeline`/`ViewSimilar`; fork added `RotateRight`/`RotateLeft`/`Rotate180` (image-edit). **Resolution**: kept **both** sets (action defs + return object); all symbols verified imported. Separately, #708 renamed `AssetAddToAlbumModal → AssetAddToCollectionModal` — kept the rename + the fork's `featureFlagsManager` import (body uses `AssetAddToCollectionModal` ×2, `AssetAddToAlbumModal` 0, file deleted). **Risk: MED** (web tsc + asset.service.spec green).
- `web/src/lib/components/asset-viewer/AssetViewerNavBar.svelte`: import-block conflict. Body uses `Icon`/`mdiPencilOutline` (edited badge) + `mdiVideoOutline`, NOT `mdiCompare`/`mdiImageSearch` (0 uses → upstream's removal correct). Set imports to the actual usage. **Risk: LOW.**
- `mobile/test/domain/service.mock.dart`: upstream added `MockUserService`, fork #639 added `MockBackgroundBackupStatusService` — kept **both**. **Risk: LOW.**
- `i18n/en.json` (many hunks) + locale files `kn/nl/ru/vi.json`: upstream's #29288 cleanup / #29204 update vs fork-added keys + the `dba598255c` location-disclosure rewrite. **Resolution**: kept-both (fork side) for en.json keys; for the 4 locales took the fork's **branded, store-compliant** disclosure text (the point of that commit). **Risk: LOW–MED** — see "Dropped i18n keys" below.

## Dropped i18n keys (post-gate fix — commit `39efb0315a`)

Upstream #29288 ("remove unused i18n strings") removed strings that are **unused in upstream but still used by the fork**. The rebase honored the removal, breaking 2 web unit tests. A completeness scan (every key referenced in `web/src` + `mobile/lib` non-generated vs current `en.json`) found exactly **3** such keys; all restored:

| Key                           | Used by                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| `photos_only` / `videos_only` | `web/src/lib/components/filter-panel/active-filters-bar.svelte` |
| `sharing_page_description`    | `web/src/lib/managers/navigation-items.ts`                      |

Verification: **0 upstream-`main` keys missing** from `en.json` (it remains a strict superset of upstream); mobile `mise //mobile:codegen:translation` regen → **no drift** (the committed `*.g.dart` already retained these getters).

## Fork Feature Verification

All 9 batches passed the 7-check per-batch audit gate (`postrebase-audit`, `mobile-drift-rebase-check`, `ci-invariants-check`, `fork-patches-check`, `rebase-confidence-check`, `gallery-branding-check`, `fork-ownership-coverage-check`).

| Check                                                                 | Status | Notes                                                                                                                                              |
| --------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fork-owned file survival                                              | OK     | all literal fork files present (×9)                                                                                                                |
| Fork extension symbol survival                                        | OK     | incl. fork sync extensions intact after #29267 (128 `library_user`/shared-space refs)                                                              |
| Shared Spaces / Storage / Pet / Image-edit / Branding / Google import | OK     | rotate actions kept in asset.service.ts; map provider links kept; branding-check green ×9                                                          |
| CI invariants                                                         | OK     | github-actions bump (#29272) did NOT revert fork CI mods; no PUSH_O_MATIC (except documented `merge-translations.yml`); gallery image names intact |
| Fork patches                                                          | OK     | @immich/ui patch metadata consistent                                                                                                               |
| Ownership coverage                                                    | OK     | 2581 fork files covered (after `web/src/styles/**`)                                                                                                |

## Database / Mobile Migration Analysis

- New upstream migrations this batch: **0**. Gallery migration count steady at **33**; no timestamp collisions.
- Mobile Drift: `schemaVersion` unchanged; `mobile-drift-rebase-check` GREEN ×9. No renumbering needed.
- `revert-to-immich.sql`: no migration / `revert-to-immich.sql` changes this batch → coverage unchanged from the last CI-green state.

## Generated Artifact Review (soft audit flags — all reviewed-OK)

`postrebase-audit` raised "Generated Artifact Review" on batches 280/281/284 — each is an upstream commit's **own** regenerated artifact carried through the rebase, confirmed consistent with its source change:

| Batch | Artifact                                                                                       | Source                                    |
| ----- | ---------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 280   | `server/src/queries/integrity.repository.sql`                                                  | #29248 (`+ "asset"."isExternal" = false`) |
| 281   | `server/src/queries/sync.repository.sql`                                                       | #29267 sync backfill                      |
| 284   | `open-api/immich-openapi-specs.json`, `mobile/openapi/.../asset_bulk_upload_check_result.dart` | #29274 upload-id-as-string                |

## Pattern Propagation

| Refactor                                             | Old → New                                                                            | Fork files                                                                            | Decision                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @immich/ui icon-button / actions migration           | `<p>`/`<a>` → `<Text>`/`<Link>`; navbar action consolidation into `asset.service.ts` | DetailPanel map popup, AssetViewerNavBar                                              | **Bundled** — fork code adopted the components inline during conflict resolution                                                                                                                                                   |
| `text-white-shadow` on person-name overlays (#29165) | added to upstream person spans                                                       | fork's `people-visibility-modal.svelte` (the refactored successor of `people/manage`) | **Deferred (cosmetic)** — upstream added the shadow to inline code the fork had already extracted into a modal; the fork modal renders its own labels without it. No test depends on it; a one-line cosmetic follow-up if desired. |

## Local Verification

| Check                                                   | Status   | Notes                                                                                                                                 |
| ------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `mise //:open-api` (server build + TS SDK + Dart, Java) | PASS     | no drift                                                                                                                              |
| `mise //:sdk:build`                                     | PASS     |                                                                                                                                       |
| Server `tsc --noEmit`                                   | PASS     | clean                                                                                                                                 |
| Web `check:typescript` (tsc)                            | PASS     | clean (actions-refactor merge type-safe)                                                                                              |
| Server unit (`vitest`)                                  | PASS     | 4696 passed / 9 skipped / 0 failed                                                                                                    |
| Web unit (`vitest`)                                     | PASS     | 3296 (after restoring 3 i18n keys)                                                                                                    |
| `mise //mobile:codegen:translation`                     | PASS     | no drift                                                                                                                              |
| `mise //:sql`                                           | SKIPPED  | local dev DB is v2.7.5-schema (would risk wiping `.sql`); upstream `.sql` changes carried through committed — CI validates on a v3 DB |
| Lint (server/web)                                       | DEFERRED | run via remote CI (`test.yml` Lint Web, server lint)                                                                                  |
| Medium tests / mobile build / e2e                       | DEFERRED | require v3 DB / flutter toolchain — remote CI                                                                                         |

## Remote CI Verification

- **Branch**: `rebase/upstream-rolling-20260509-active` (force-pushed after the rebase).
- Workflows dispatched: `test.yml`, `docker.yml`, `static_analysis.yml`, `gallery-build-mobile.yml`, `gallery-rebase-smoke.yml`, `storage-migration-tests.yml`, `storage-migration-e2e.yml`, `gallery-revert-to-immich-validation.yml`.
- _(filled in during babysitting)_
