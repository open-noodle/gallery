# Upstream Sync Report — 2026-10-28 (v3.4 rolling)

## Summary

- **Branch**: `rebase/upstream-rolling-v3.4` (tracks `upstream/main`; no v3.4 tag yet, so this does not land)
- **Upstream**: `cf719e733e6` → `11bf8753137`, 42 commits (planned batches 135–161), taken in three replay steps
- **Fork sync**: `e9eb6f68586` → `d9ea8866515` (#1226, #1235, #1236, #1238)
- **Fork commits replayed per step**: 1,758 (+1 sync reconcile); branch is 1,760 commits ahead of `11bf8753137`
- **Risk level**: HIGH (SvelteKit 3 and an RBAC widening); **Recommendation**: PROCEED, pending remote CI
- **Base for branding**: unchanged (`upstream.version` stays 3.3.5 — upstream has not tagged v3.4)

## Checkpoint 1 decisions (Pierre, 2026-10-28)

1. **immich-32609 (album-shared assets → albums, `AssetShare` widened to album members): take upstream as-is**
   for albums, Space rules unchanged. Applying that exactly required a fork change (see "RBAC" below).
2. **SvelteKit 3 / `.js`→`.ts` imports: mandatory propagation only.** `{@const}` → declaration tags and the TanStack
   face-query style were to be deferred; the `{@const}` part turned out to be mandatory (lint), see below.

## Fork sync (#1226, #1235, #1236, #1238)

`make upstream-sync-fork-main` threw on each PR; resolved by hand, `integratedForkHead` advanced manually with an
`appendHistory` entry per PR. The rolling state also needed two repairs before the script would start: the previous
cycle's hand-written history entry had no milliseconds in `at` and no `from`/`to`/`commits`/`checks`.

| PR | Conflict | Resolution |
|---|---|---|
| #1226 S3 backups | `BackupSettings.svelte` imports (rolling removed `systemConfigManager`) | rolling imports + `Text`; the PR's new spec ported to the admin config query + save mutation mocks |
| #1235 web motion | `mise.lock` | block reorder only (content-identical): kept rolling's |
| #1236 mobile motion | `delete.action.dart` (immich-32522 hoisted `message`) | kept `GalleryRemoval.send` before `trash` |
| #1238 mobile search | 20 delete/modify (the old photos-filter stack rolling had re-keyed to `Set<Tag>`), 5 adjacency | took the deletions; adjacency unions |

Reconcile commit (fork sync):

- **Tag tap → search**: rolling's `open_tag_filter.dart` (upstream `TagDetails`) still drove the deleted
  `photosFilterProvider`; it now opens search mode filtered to the tag, like `SimilarPhotosAction`.
- **Favorites screen vs immich-32565**: upstream defaults a partner request with no visibility to the timeline. #1238's
  Favorites screen leaves visibility unset on purpose (the caller's own archive, gated by `withOwnArchiveOnly`).
  `timeline.service.ts` keeps upstream's default except for that one request (own timeline + `withPartners` +
  favourites); another user's timeline still defaults.

## Upstream changes

| SHA | Summary | Risk | Notes |
|---|---|---|---|
| `2576ee28cfb` | SvelteKit 3 (immich-32737) | HIGH | deletes `svelte.config.js`, drops `$lib`; see "SvelteKit 3" |
| `f97c2243fbe` | `.js`→`.ts` imports (immich-32742) | HIGH | mechanical, ~550 files |
| `37c34343e1b` | album-shared assets to albums (immich-32609) | HIGH | `AssetShare` + album arm; see "RBAC" |
| `c6d1e15c77c` | declaration tags instead of `@const` | MED | eslint-plugin-svelte bump makes `{@const}` an error |
| `d26c0eec10f` | bulk (un)archive actions | MED | deletes `ArchiveAction` / `archiveAssets` the fork used |
| `5077a85d5e6` | asset face queries (TanStack) | MED | merged cleanly into `PersonSidePanel`/`FaceEditor` |
| `285552785f1` | svelte builtin id generator | MED | deletes `generateId` (fork `people-face-statistics-info` used it) |
| `9560989cb97` | JXL target format | MED | `decodingTier` now required (fork face crop) |
| `5177913e0a1` | reduce favicon assets | MED | new `icon.svg` = Immich logo (branding) |
| `02a5d4b2060` | inline hashes in helmet CSP | MED | vite plugin + `helmet.json`; fork tile host kept |
| `b3c1b3d260b` | openapi-generator 7.26 | MED | Dart template patches still apply |
| `d073539afdd` | `@immich/ui` 0.91 | MED | fork pnpm patch re-derived; `showDialog` typed `Promise<never>` |
| `a7afb4c9e9d` | update access on motion video | LOW | spec mocks follow the fork's rbac-3 check |
| `adca900fe27` | edited assets in smart search | LOW | fork video branch kept |
| `f7b8ae5da37` | watch asset delete/archive in search (mobile) | LOW | file deleted by the fork (#654) |
| `11bf8753137`, `18f1a44d1b9` | native core codecs crate, srgb cache | LOW | fork workflows reference only `native/mise.toml` |
| ML: `ea7080bd755`, `256eb55dbe9`, `cadb945108d`, `e659fb62f2b` | pillow 13, ML deps, fastapi, RKNN | LOW | ML gates green; still under the v2 pet-model landing blocker |
| rest | deps, CI actions, docs, small fixes | LOW | — |

No server migrations, no Drift migrations, none of the replay-owned person files.

## How the replay was driven

Three steps (each replays ~1,760 fork commits): A = 135–138, B = 139–140, C = 141–161. A gated driver auto-resolved
only known classes and stopped on anything else; every auto-resolution was logged.

| Class | A | B | C |
|---|---|---|---|
| import normaliser (SK3 resolver) | 8 | 278 | 4 |
| saved hand recipes | — | 8 | — |
| fork side kept, upstream diff re-applied after | 3 | — | 23 |
| lockfiles kept, regenerated after | 8 | 1 | 2 |
| fork deletes the path (transient / fork-deleted) | 3 | 13 | 1 |
| upstream deletes it (favicons, `svelte.config.js`) | — | 2 | 24 |
| branded binaries (fork artwork kept) | — | — | 4 |
| hand resolutions at a stop | 3 | — | — |

**The SvelteKit 3 resolver** re-merges a conflicted web file after normalising all three sides with upstream's own
rewrite (`$lib`→`#lib/…ts`, `vi.mock` keeps `.js`, `@test-data`→`#test-data`, the two module renames,
`$app/stores`→`$app/state`, `$app/environment`→`$app/env`) plus prettier with upstream's new import order. Validated
against upstream: it reproduces `f97c2243fbe` from `f7b8ae5da37` exactly for 575 of 606 changed files; the other 31
are SvelteKit 3 API changes it does not attempt.

Per-file audits after A and C: every upstream-touched file equals the 3-way merge (fork tip, old base, new base), except
the files resolved by hand, the lockfiles, the branded icons and generated output — each listed above and reviewed.

## SvelteKit 3 (reconcile `fix(rebase): carry the fork's web code onto SvelteKit 3`)

- ~580 fork web files moved to `#lib/…ts` subpath imports.
- **i18n overlay**: `svelte.config.js` held `writeMergedI18n()` and `$i18n → i18n/gallery/merged`. Now `#i18n/*` points
  at the merged bundle in `web/package.json` imports and `web/tsconfig.json` paths; `vite.config.ts` builds the merge on
  load and web's `prepare` script builds it before `svelte-kit sync`. AGENTS.md and `docs/fork/ownership.yml` updated.
  The `version.name` guard was dropped: upstream's fallback no longer uses `Date.now()`.
- **Lost in the replay, restored**: `utils/server.ts` became `utils/client.ts` upstream; #1180's
  `setHeaders(galleryAppHeader)` (the `x-gallery-app` classifier) followed the rename and was dropped by a resolution
  rule. Without it the server treats the web app as a stock Immich client.
- `page.url` is read-only: fork call sites pass a copy (`currentPageUrl()` in the two `.svelte.ts` managers);
  `goto` `keepFocus/noScroll/replaceState` → `reset:false/replace`, as upstream mapped them; `invalidateAll` left where
  it still works (deprecated, not removed).
- **`{@const}` → declaration tags became mandatory**: the eslint-plugin-svelte bump makes `svelte/no-at-const-tags` an
  error; 73 fork tags converted with eslint's autofix (`{const x = $derived(…)}`, upstream's majority form).
- Specs: `$app/state` mocks gain `navigating` (scroll memory reads it); the people page specs move from a
  `$app/stores` stub to the reactive page mock.
- `tools/upstream-preflight/src/branded-spinner.spec.ts` matched the spinner by its `$lib` literal; updated.

## RBAC

- **Accepted (oracle)**: `asset.share` gains `albumViewer: [ownAsset]` — an album member may add the album's assets to
  their own albums (immich-32609). Snapshot reviewed and updated; the RBAC (read) oracle is unchanged.
- **Kept narrow for Spaces**: Space `addAssets` checked `AssetShare`. Upstream's widening would let an album Viewer add
  the owner's photos into their own Space, where `checkSpaceEditAccess` gives editors `AssetUpdate` over them — the
  read→re-share→write path rbac-2 closed. `SharedSpaceService.addAssets` now checks owner ∪ partner through
  `requireSpaceShareAccess` (`server/src/gallery/utils/access-grants.ts`). The existing rbac-2 spec failed against
  upstream's rule and passes with the fix.
- Fork `AssetShare` users reviewed: `GalleryAlbumService.getAddTargets` mirrors album add, so it follows upstream.

## Other reconciliations (step C reconcile)

- **Bulk archive**: upstream's `handleSetVisibility` gets #1235's `animateRemoval` hook. The fork's filtered timelines
  also update search results on archive, which upstream's event path does not, so the fork's selection toolbar and
  wrapped pages keep a callback-based `ArchiveAction`, now fork-owned in `web/src/lib/gallery/actions/` (upstream's last
  version + the motion hook); `asset-utils.ts` exports `showUndoArchiveToast` (one keyword).
- **JXL**: the fork's face-crop thumbnail sets `decodingTier: THUMBNAIL_DECODING_TIER` like upstream's (zero-conflict
  break, caught by `tsc`); `adjust` stays next to upstream's decoding tiers in `media.service.ts`.
- **Branding**: `web/static/icon.svg` (the new SVG favicon) was upstream's Immich logo; now the Gallery mark. No
  branding gate checks this file.
- **`@immich/ui` 0.91**: the fork patch (palette shortcuts left to Gallery's cmdk, wrapping `ImageCard` titles)
  re-derived as `patches/@immich__ui@0.91.0.patch`; 0.91 types `modalManager.showDialog` as `Promise<never>`, so 40 fork
  spec mocks type it as `Promise<boolean>`.
- `generateId` → `$props.id()` in `SettingSwitch` (fork `labelId` kept) and the fork's face statistics info.
- Docs (RKNN rewording) and the Catalan README take upstream's text with the fork's branding.

## Database / mobile migrations

None upstream. Ledger, `renamedMigrations` and the revert script coverage are unaffected; the migration-ledger medium
spec passes.

## Layering

- New fork code went into fork namespaces (`gallery/actions/`, `gallery/utils/access-grants.ts`).
- Upstream files grew by hooks only: `asset.service.ts` (one motion call), `asset-utils.ts` (`export`),
  `client.ts` (two lines), `vite.config.ts` (overlay), `web/package.json`/`tsconfig.json` (`#i18n` target, `prepare`).
- `i18n/*.json` untouched; `merge.mjs --check` passes; no branding gaps.

## Local verification

| Check | Result |
|---|---|
| server `pnpm check` / lint / prettier | PASS |
| server unit | 7,050 passed |
| web `check:typescript` / `check:svelte` / lint / prettier | PASS (lint after a fresh install; the stale-install TS crash recurred) |
| web unit | 6,723 passed |
| access oracle | 1 reviewed change (above) |
| RBAC oracle, migration ledger | PASS |
| mobile codegen + `dart analyze --fatal-infos` | PASS |
| mobile unit | 3,887 passed |
| ML ruff format / ruff check / mypy --strict / pytest | PASS (259 passed) |
| e2e `pnpm check` | PASS |
| preflight suite, postrebase audit, fork-patches, ci-invariants, autolink, i18n overlay | PASS |
| OpenAPI regen (TS + Dart, generator 7.26) | PASS; SDK gains `ImageFormat.Jxl` |
| `uv lock --check` (uv 0.8.15), `pnpm install --frozen-lockfile` | PASS; no `file:` workspace entries |

## Traps hit this cycle

- A failed resolution script followed by an unchained `git add` staged a wrong file twice; step B was replayed again
  once because of it. Resolutions now run as one `&&` chain.
- My `git add -A` committed a local `mise` rewrite of `mise.lock` (−47 lines); restored to upstream's.
- `REBASE_HEAD` survives a finished rebase; a driver looping on it spins forever.
- A rename (`utils/server.ts` → `utils/client.ts`) carried a fork change onto a path absent at the fork tip; a
  "transient file" rule then dropped it. The rule now also requires the path to be absent upstream.

## Follow-ups

- Converge the fork's archive path onto upstream's event-driven bulk actions (needs the filtered timelines to listen
  for `AssetsArchive`/`AssetsUnarchive`).
- Convert the remaining deprecated SvelteKit APIs in fork code (`invalidateAll`, `replaceState` option).
- Add a branding check for `web/static/icon.svg`.
- Still owed from earlier cycles: ML v2 pet-model validation (landing blocker), Spaces data-layer TanStack port.

## Remote CI

Pending.
