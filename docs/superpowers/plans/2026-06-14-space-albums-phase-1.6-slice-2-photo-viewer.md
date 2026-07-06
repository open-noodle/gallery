# Space Albums Phase 1.6 — Slice 2: In-Space Album Photo Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening a photo inside a space album must work (no 404). Clicking a photo in the in-space album grid navigates to `/spaces/:spaceId/albums/:albumId/photos/:assetId` and opens the asset viewer in place; next/prev stays within the album; close returns to the album grid; deep-linking the photo URL works.

**Architecture:** Pure SvelteKit route relocation — no new viewer code. The `Timeline` component already navigates to `<pathname>/photos/<assetId>` on click and renders `TimelineAssetViewer` in place when the route ends in `/[[assetId=id]]` (matched generically by `isAssetViewerRoute` in `web/src/lib/utils/navigation.ts`). We move the album detail page down into the optional `[[photos=photos]]/[[assetId=id]]` route (mirroring the global-album and space-root trees) and simplify its load to reuse the `[spaceId]` layout's data.

**Tech Stack:** SvelteKit (Svelte 5 runes), Vitest + @testing-library/svelte, Playwright e2e. Spec: `docs/superpowers/specs/2026-06-14-space-albums-phase-1.6-linked-album-live-sync-and-viewer-design.md` §5 (Slice 2 / Section B).

---

## Key facts (verified)

- `web/src/routes/(user)/spaces/[spaceId]/+layout.ts` already loads and returns `{ space, members, linkedAlbums, meta }`. SvelteKit merges layout data into page `data`, so the relocated page keeps `data.space` / `data.members` without re-fetching them.
- The global-album viewer route is the exact pattern to mirror: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.{svelte,ts}`.
- The space-root viewer route's `+page.ts` is the parent-relying load pattern: `authenticate(url); await parent(); return {}`.
- `isAssetViewerRoute` (navigation.ts:24) matches **any** route id ending `/[[assetId=id]]` with an `assetId` param — no whitelist to touch.
- Current album dir contents (ALL must move together to preserve relative imports): `+page.svelte`, `+page.ts`, `page-load.spec.ts`, `space-album-detail-page.spec.ts`, `mock-active-filters-bar.test-wrapper.svelte`, `mock-asset-select-control-bar.test-wrapper.svelte`, `mock-download-action.test-wrapper.svelte`, `mock-filter-panel.test-wrapper.svelte`, `mock-grouping-control.test-wrapper.svelte`, `mock-timeline-state.ts`, `mock-timeline.test-wrapper.svelte`.
- `+page.svelte`'s only relative import is `./$types` (everything else is `$lib/*` / `@immich/sdk`), so it relocates cleanly; the test/mock files use `./`-relative imports among themselves and to `./+page.svelte`, so moving the whole set keeps them intact. `$types` regenerates for the new location.

Run web commands from `web/`. Run e2e from `e2e/`.

---

## File structure (after this slice)

```
web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/
└── [[photos=photos]]/[[assetId=id]]/
    ├── +page.svelte                 (moved, unchanged except none)
    ├── +page.ts                     (moved + simplified load)
    ├── page-load.spec.ts            (moved + load test rewritten for parent())
    ├── space-album-detail-page.spec.ts (moved; data prop gains space/members from layout)
    └── mock-*.test-wrapper.svelte, mock-timeline-state.ts  (moved)
```

Nothing remains directly under `[albumId=id]/` (optional-param child serves both `/albums/:id` and `/albums/:id/photos/:assetId`), exactly like the global-album tree.

---

## Task 1: Relocate the album route into the optional photos child

**Files:** `git mv` every file from `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/` into `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/`.

- [ ] **Step 1: Create the target dir and move all files (preserve git history)**

```bash
cd web
SRC="src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]"
DST="$SRC/[[photos=photos]]/[[assetId=id]]"
mkdir -p "$DST"
git mv "$SRC/+page.svelte" "$DST/+page.svelte"
git mv "$SRC/+page.ts" "$DST/+page.ts"
git mv "$SRC/page-load.spec.ts" "$DST/page-load.spec.ts"
git mv "$SRC/space-album-detail-page.spec.ts" "$DST/space-album-detail-page.spec.ts"
git mv "$SRC/mock-active-filters-bar.test-wrapper.svelte" "$DST/mock-active-filters-bar.test-wrapper.svelte"
git mv "$SRC/mock-asset-select-control-bar.test-wrapper.svelte" "$DST/mock-asset-select-control-bar.test-wrapper.svelte"
git mv "$SRC/mock-download-action.test-wrapper.svelte" "$DST/mock-download-action.test-wrapper.svelte"
git mv "$SRC/mock-filter-panel.test-wrapper.svelte" "$DST/mock-filter-panel.test-wrapper.svelte"
git mv "$SRC/mock-grouping-control.test-wrapper.svelte" "$DST/mock-grouping-control.test-wrapper.svelte"
git mv "$SRC/mock-timeline-state.ts" "$DST/mock-timeline-state.ts"
git mv "$SRC/mock-timeline.test-wrapper.svelte" "$DST/mock-timeline.test-wrapper.svelte"
```

Then verify nothing else remains directly under `[albumId=id]/`:

```bash
ls -A "$SRC"     # expect ONLY the [[photos=photos]] dir
```

- [ ] **Step 2: Verify routes still resolve (svelte-kit sync + svelte-check)**

Run: `cd web && pnpm run check`
Expected: svelte-check completes; `./$types` resolves in the moved files at the new location. Some errors about the load return shape are expected and fixed in Task 2 — if the ONLY errors are about `data.space`/`data.members`/`album` typing in the moved page (because the load hasn't been simplified yet), proceed to Task 2; otherwise fix path/import breakage now.

- [ ] **Step 3: Commit the move (history-preserving, no content change yet)**

```bash
git add -A "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]"
git commit -m "refactor(web): relocate space-album page into optional photos route (slice 2)"
```

---

## Task 2: Simplify the relocated load to reuse the layout

**Files:** Modify `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.ts`

- [ ] **Step 1: Update the test FIRST (TDD) — rewrite `page-load.spec.ts` for the new load contract**

Read the moved `page-load.spec.ts`. It currently asserts the load calls `getSpace`/`getMembers`/`getSharedSpaceAlbums`/`getAlbumInfo` and redirects when the album isn't linked. Rewrite it to the new contract:

- The load now reads `linkedAlbums` from `parent()` (not `getSharedSpaceAlbums`) and calls only `getAlbumInfo`.
- Provide a fake `parent` returning `{ space, members, linkedAlbums }` and a fake `params`/`url`.
- Keep two cases: (a) album present in `linkedAlbums` → returns `{ album, meta }` and `getAlbumInfo` was called with `params.albumId`; (b) album absent → throws/performs a redirect to `/spaces/:spaceId/albums`.

Use the existing `sdkMock` (`$lib/__mocks__/sdk.mock`) for `getAlbumInfo`. For the redirect case, assert it throws the SvelteKit `redirect` (import `redirect` is internal; assert via `expect(load(...)).rejects` with a `status: 302` / `location` shape as the existing space tests do — match how other `+page.ts` redirect tests in this repo assert, e.g. the current file's existing redirect assertion style).

- [ ] **Step 2: Run the load test to verify it fails against the OLD load**

Run: `cd web && pnpm test -- --run -t "page-load"` (or the spec's describe name).
Expected: FAIL — old load still calls `getSpace`/`getMembers`/`getSharedSpaceAlbums`, so the new `parent()`-based assertions fail.

- [ ] **Step 3: Implement the simplified load**

Replace `+page.ts` contents with:

```typescript
import { getAlbumInfo } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params, url, parent }) => {
  await authenticate(url);
  const { linkedAlbums } = await parent();
  if (!linkedAlbums.find((a) => a.albumId === params.albumId)) {
    redirect(302, `/spaces/${params.spaceId}/albums`);
  }
  const album = await getAlbumInfo({ id: params.albumId });
  return { album, meta: { title: album.albumName } };
}) satisfies PageLoad;
```

(`space` and `members` are no longer returned here — the page reads them from the `[spaceId]` layout data, which SvelteKit merges into `data`.)

- [ ] **Step 4: Run the load test to verify it passes**

Run: `cd web && pnpm test -- --run -t "page-load"`
Expected: PASS.

- [ ] **Step 5: Fix `space-album-detail-page.spec.ts` data prop if needed**

The component reads `data.space` and `data.members`. The page-render test previously got these from the page load's return; now they come from layout data but the test renders the component directly with a `data` prop. Ensure the test's `data` object still includes `space`, `members`, and `album` (the component's `PageData` now sources `space`/`members` from `LayoutData`, but the test supplies a single merged `data` object, so just keep `space`/`members`/`album` keys present in the test's `data`). Run:

Run: `cd web && pnpm test -- --run -t "space album"` (match the spec's describe name)
Expected: PASS (unchanged behavior — the component is identical; only its data source moved).

- [ ] **Step 6: svelte-check + commit**

```bash
cd web && pnpm run check     # expect clean
git add "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]"
git commit -m "feat(web): in-space album photo viewer route + slim load (slice 2)"
```

---

## Task 3: E2E — opening a photo in a space album (infra-gated)

**Files:** Modify `e2e/src/specs/web/spaces-albums.e2e-spec.ts`

> Requires the Playwright e2e stack. If it cannot run in this environment, WRITE the tests, attempt to run, and if infra-unavailable document it in the commit body — do NOT delete or fake.

- [ ] **Step 1: Add viewer tests**

Add a `test.describe('Spaces — Albums photo viewer')` (or extend the existing editor/viewer describes) that, reusing the existing `space` + linked `album` (which already contains one asset) and `utils.setAuthCookies`:

- **owner/editor opens a photo:** navigate to `/spaces/${space.id}/albums/${album.id}`, click the first photo thumbnail in the timeline, assert the URL matches `/spaces/${space.id}/albums/${album.id}/photos/` + an asset id, and the asset viewer is visible (use the same asset-viewer locator the existing album/space viewer e2e tests use — grep the e2e suite for the asset-viewer test id, e.g. `data-testid="asset-viewer"` or the photo-viewer container).
- **close returns to the grid:** press Escape (or click the viewer close control), assert URL is back to `/spaces/${space.id}/albums/${album.id}` and the viewer is gone.
- **non-owner member opens a photo:** with `viewer.accessToken`, navigate and open the photo; assert the viewer is visible (authorization via the Phase 1 album-read predicate). If the image/detail fetch is denied, that signals the viewer needs `spaceId` threaded — see spec §5.3; in that case, report it as a finding (do not silently pass).

Follow the existing spec's conventions: no arbitrary timeouts, await visible elements, `await page.waitForURL(...)`.

- [ ] **Step 2: Run (if infra available)**

Run: `cd e2e && pnpm test:web -- spaces-albums.e2e-spec.ts`
Expected: PASS, or a documented infra-unavailable skip.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/specs/web/spaces-albums.e2e-spec.ts
git commit -m "test(e2e): open/close photos in a space album (slice 2)"
```

---

## Slice 2 completion gate

- [ ] `cd web && pnpm run check` → clean (svelte-check + tsc).
- [ ] `cd web && pnpm test -- --run` → the moved `page-load.spec.ts` and `space-album-detail-page.spec.ts` pass; no other web tests regress.
- [ ] Route exists: `ls "web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte"`.
- [ ] Nothing left directly under `[albumId=id]/` except the `[[photos=photos]]` dir.
- [ ] Push the branch (no merge).

## Edge-case coverage map (spec §5.4 → coverage)

| Spec edge                                                      | Covered by                                                                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner opens photo → viewer; next/prev within album; close→grid | Task 3 e2e (open + close); next/prev is inherent to the album-scoped Timeline (covered by the viewer opening on the album route)                |
| Non-owner member opens photo (authorized)                      | Task 3 e2e (viewer role)                                                                                                                        |
| Deep link / refresh on photos URL                              | Task 1/2 (route exists + load runs for the optional-param URL); add a deep-link e2e step (`page.goto` the photos URL directly → viewer visible) |
| assetId not in album / invalid                                 | existing viewer not-found behavior (unchanged; no new code)                                                                                     |
| Album not linked / no access                                   | Task 2 load redirect to `/spaces/:id/albums` (page-load.spec.ts)                                                                                |
| Browse vs select mode click behavior                           | unchanged `Timeline` behavior (no code change)                                                                                                  |
| Active browse filter preserved across open/close               | unchanged `Timeline` behavior                                                                                                                   |
| Back returns to album grid                                     | Task 3 e2e (close)                                                                                                                              |

> Add the deep-link `page.goto` step to Task 3 so the "refresh on photos URL" edge is explicitly exercised.
