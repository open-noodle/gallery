# Upstream Sync Report — 2026-06-19 (batch 276 / 1 upstream + 0 fork)

Fourth same-day sync, on top of `2026-06-19-upstream-sync-batch-275.md`. Single upstream web refactor.

## Summary

- **Mode**: rolling-upstream-rebase on `rebase/upstream-rolling-20260509-active` (v3-cutover branch, held off `main`)
- **Fork commits synced**: 0 — `origin/main` unchanged at #714 `b054b158`.
- **Upstream commits pulled** (`95fc5e9682..62b00a1f26`): 1 — #29211 `62b00a1f` (refactor slideshow + setalbumcover into the actions pattern). Target = `upstream/main` `62b00a1f26`.
- **Conflicts resolved**: 3 — all **import-block** conflicts (no logic conflicts): `asset.service.ts` ×2 + `AssetViewerNavBar.svelte` ×1.
- **New migrations**: 0 — Gallery migration count steady at **33**, mobile Drift unchanged.
- **OpenAPI/SDK**: none — web service refactor, no controller/DTO/spec change.
- **Net content change vs batch 275**: exactly #29211's 5 files (web-only). No server/mobile-Dart/ML source touched.
- **Risk level**: LOW-MEDIUM (web refactor across 3 fork-modified asset-viewer files; clean once imports merged).
- **Recommendation**: PROCEED — local checks GREEN; targeted CI (Test + Docker) dispatched.

> **Scope note:** held rolling branch — not pushed to `main`, no `branding.upstream.version` bump (stays `v2.7.5`). Now **0 behind / 794 ahead** of `upstream/main`.

## Upstream commit (1)

| SHA        | PR     | Area | Risk    | Outcome                                                                                                                                                                                                                                                                                                                                            |
| ---------- | ------ | ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `62b00a1f` | #29211 | web  | MED→LOW | Consolidates two ad-hoc actions into the upstream actions pattern: **SetAlbumCover** (deletes `SetAlbumCoverAction.svelte` → `getAlbumAssetActions()` `SetCover` ActionItem) and **slideshow** (drops `showSlideshow`/`onPlaySlideshow` props → `Actions.PlaySlideshow` in `asset.service.ts`). Same actions pattern the fork's cmdk palette uses. |

## Conflict resolutions

All three were `@mdi/js` / `$lib` **import-block** collisions (alphabetical import lists where both sides added entries) — no behavioural conflicts. Upstream's body changes (slideshow `MenuOption`→`ActionMenuItem`, `SetAlbumCoverAction`→`getAlbumAssetActions`) auto-merged into the fork's versions.

### C1 — `web/src/lib/services/asset.service.ts` (at squash base)

`@mdi/js` import: upstream added `mdiPresentationPlay` (for the new `PlaySlideshow` action); fork added `mdiRotateLeft`/`mdiRotateRight` (rotate editor actions). **Kept all three**, alphabetical. Verified the auto-merged `PlaySlideshow` action landed in the fork's `getAssetActions` and calls `slideshowStore.slideshowState.set(SlideshowState.PlaySlideshow)`.

### C2 — `web/src/lib/components/asset-viewer/AssetViewerNavBar.svelte` (at fork #213)

Upstream **removed** `mdiPresentationPlay` from this file (slideshow MenuOption replaced by `<ActionMenuItem action={Actions.PlaySlideshow}>`); fork #213 **added** `Icon` (`@immich/ui`) + `mdiPencilOutline` (edited badge). **Kept fork's `Icon`/`mdiPencilOutline`, dropped `mdiPresentationPlay`** (verified 0 body references remain; `Icon`/`mdiPencilOutline` used by the edited badge).

### C3 — `web/src/lib/services/asset.service.ts` (at fork #d20, post-rebase test fix)

`$lib/stores` import: upstream side had `slideshowStore` (PlaySlideshow); fork added `waitForWebsocketEvent`. **Kept both.**

## Post-resolution verification (step 7a — no lost upstream content)

| Check                                                                               | Result                                                                                                                        |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `SetAlbumCoverAction.svelte` deleted (upstream)                                     | YES                                                                                                                           |
| Fork refs to deleted `SetAlbumCoverAction` component                                | 0                                                                                                                             |
| Removed `showSlideshow`/`onPlaySlideshow` props referenced                          | only PhotoViewer's own local `s`-shortcut handler + spec's harmless extra prop (matches upstream/main) — no broken fork usage |
| `AssetViewerNavBar` has `getAlbumAssetActions`/`SetCover` + `Actions.PlaySlideshow` | YES                                                                                                                           |
| `AssetViewer.svelte` slideshow props removed                                        | YES (0)                                                                                                                       |
| Fork delta to the 5 files vs `upstream/main`                                        | only `AssetViewerNavBar.svelte` (+19/−2 fork additions); `album.service.ts` = upstream verbatim                               |

## Audits & local verification

| Check                                   | Status  | Notes                                                                                                     |
| --------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| postrebase-audit (276)                  | GREEN\* | fork files/symbols, 33 migrations, no collisions. \*"Generated Artifact Review" review-signal — see below |
| fork-patches-check                      | GREEN   | @immich/ui patch metadata consistent                                                                      |
| ci-invariants-check                     | GREEN   | no PUSH_O_MATIC; gallery images; upstream docs-deploy stays dispatch-only                                 |
| mobile-drift-rebase-check (276)         | GREEN   | schemaVersion / snapshots / Gallery callbacks consistent                                                  |
| SDK build (`tsc`)                       | PASS    | —                                                                                                         |
| Web `check:typescript` / `check:svelte` | PASS    | tsc clean; svelte-check 0 errors / 0 warnings                                                             |
| Web unit tests                          | GREEN   | 3166 passed, 2 skipped, 8 todo, 0 failed (239 files) — incl. AssetViewerNavBar edited-badge specs         |

**"Generated Artifact Review" signal (reviewed, no action):** the audit flags that the tracked upstream range touched `open-api/immich-openapi-specs.json` + `mobile/openapi/README.md`. Those deltas are the **version-string bump from v3.0.0-rc.2 (batch 274)**, already integrated and validated (batch 274 went 7/7 CI green incl. the OpenAPI Clients job). The `95fc5e9682..62b00a1f26` diff for those files is **empty** — #29211 itself touched no generated artifacts and changed no API shape. **No regen needed.**

> **Server unit tests / checks not re-run:** the batch is web-only (5 files, all under `web/src/lib/...`). No server/mobile-Dart/ML source changed, so server results are identical to batch 274's green run.

## Remote CI verification

Dispatched on `rebase/upstream-batch-276` — targeted to the web surface this batch touches:

- **Test** — web unit + Web E2E (exercises the asset viewer) + Lint Web + OpenAPI Clients
- **Docker** — builds the web image (validates the SvelteKit build with the changes)

(Results recorded on completion.)

## Post-rebase state

- Upstream base: `62b00a1f26` (`95fc5e9682..62b00a1f26`); fork commits ahead: **794**; behind: **0**.
- `integratedForkHead`: `b054b158` (unchanged — no fork-sync); `upstreamTargetHead`: `62b00a1f26`.
- Canonical `rebase/upstream-rolling-20260509-active` updated to the rebased tip; not pushed to `main` (held for v3 cutover).
