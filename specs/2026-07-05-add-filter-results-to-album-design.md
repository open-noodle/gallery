# Add All Filter Results to Album/Space — Design

- **Date:** 2026-07-05
- **Branch:** `worktree-add-filter-results-to-album`
- **Status:** Approved design → ready for implementation plan

## Problem

On the search/filter page, a user can only add photos to an album or space by
selecting them individually. Selection is also bounded by what infinite-scroll
has loaded into memory — "Select all" (button and Ctrl+A) only selects the pages
fetched so far, not the full result set. There is no way to say "add everything
matching this filter to an album/space."

## Goal

Let a user add **all** assets matching the current search/filter to one or more
albums and/or spaces in a single action, without manually selecting them, and
without scrolling the entire result set into view.

## Scope & Non-Goals

- **In scope:** search/filter results page; adding all matching assets to albums
  and/or spaces; realistic result sizes up to ~10,000 (design tolerates larger).
- **Non-goals (deliberately deferred):**
  - No new server-side "search-and-act" endpoint. The add stays client-driven,
    reusing the existing ID-list add path.
  - No chunking / batched-add infrastructure. The existing single-request-per-
    target album path is reused as-is (it works within our size range).
  - No async background job for large space adds (the fork's existing
    `queueBulkAdd` → `SharedSpaceBulkAddAssets` path remains the template if this
    is ever needed).

## Key Findings (current behavior)

- Search page: `web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte`.
  Results load page-by-page via infinite scroll; only fetched assets live in
  memory. The response `SearchAssetResponseDto.total` (full match count) is
  returned by the server but **currently ignored** by the page.
- Add-to-collection path is entirely ID-list based:
  `AssetAddToCollectionModal` (`assetIds: string[]`) → `CollectionPickerModal` →
  `addAssetsToCollections` (`collection.service.ts`) → `addAssetsToAlbums`
  (`album.service.ts`, single `PUT /albums/:id/assets` with `{ ids }`, **no
  cap**) and/or `addAssetsToSpace` (`space.service.ts`).
- Space add cap: `MAX_SPACE_ASSETS_PER_REQUEST = 10_000` in two synced places —
  `server/src/dtos/shared-space.dto.ts:130` (server DTO `.max()`, applied to both
  add and remove schemas) and `web/src/lib/constants.ts:77` (client guard). The
  cap exists (PR #168) to bound a **per-asset face-match job fan-out** that fires
  only when `space.faceRecognitionEnabled` (`shared-space.service.ts:583-590`,
  one `SharedSpaceFaceMatch` job per asset via `queueAll`).
- Server request body limit: `json({ limit: '10mb' })`
  (`server/src/app.common.ts:58`) — the true hard backstop (~250k UUIDs) for the
  uncapped album path.
- `CollectionPickerModal` **already** gates spaces by count:
  `showSpaces = assetCount <= MAX_SPACE_ASSETS_PER_REQUEST`
  (`web/src/lib/modals/CollectionPickerModal.svelte:51`), and shows a
  `spaces_hidden_too_many_assets` notice when over the cap (lines 232-235).

## Design

### 1. Entry point (UI)

A dedicated **"Add all …"** button in the search-results header, showing the live
match count, e.g. `＋ Add all 8,200 to…`.

- Reads `SearchAssetResponseDto.total`, captured into search page state (the page
  ignores it today). Accurate even though only a partial page is loaded.
- Visible only when `total > 0` and the current view is a search/filter result
  (not while an initial load is in flight with no results yet).
- Independent of selection mode — no assets need to be selected first.

### 2. Flow (client-side, reusing the existing add path)

1. Click → open a by-filter picker modal (`SearchAddAllToCollectionModal`, a thin
   sibling of `AssetAddToCollectionModal`) that renders the existing
   `CollectionPickerModal` with `assetCount={total}` (instead of a fixed
   `assetIds` array).
2. Over-cap handling is automatic: because `assetCount = total`, the picker hides
   spaces and shows the `spaces_hidden_too_many_assets` notice when
   `total > 50_000`. Albums remain selectable. No new gating code.
3. User picks target album(s)/space(s) and confirms.
4. **Only then** the modal collects IDs: page through the search with the **same
   filter DTO**, from page 1, `size: 1000`, **`withExif: false`** (IDs only → tiny
   payloads), accumulating every matching asset ID.
5. Hand the collected IDs to the existing `addAssetsToCollections(collections,
ids)` — the unchanged album/space add path.

Collecting _after_ the user commits means a cancel costs nothing; re-paging from
page 1 (rather than trusting the ~partial loaded set) guarantees a complete,
consistent result matching the active filter.

### 3. Cap handling (spaces: 10k → 50k)

- Bump `MAX_SPACE_ASSETS_PER_REQUEST` `10_000 → 50_000` in **both**
  `server/src/dtos/shared-space.dto.ts:130` and `web/src/lib/constants.ts:77`.
  The `.max()` on both space DTOs and the client picker gate pick it up
  automatically.
- Albums stay uncapped (existing behavior). The 10MB body limit (~250k UUIDs) is
  the residual hard backstop; realistically never reached at our sizes and
  covered by the existing error handler.
- `collection.service.ts:12-15` (which drops spaces when `assetIds.length` exceeds
  the cap) stays as a defense-in-depth backstop for non-search callers. For the
  new flow the picker already prevents picking a space over the cap, so this
  branch is not the primary guard.

### 4. Feedback

- During the ID-collection pass and the subsequent add, the modal shows an
  indeterminate **"Preparing assets…"** state (reusing the modal's existing
  `pending` flag; the picker stays mounted so the spinner overlays it).
- On success, the existing toasts fire unchanged (`assets_added_to_album_count`,
  `added_to_space_count`, `added_to_collections_count`). Errors flow through the
  existing `handleError`.
- No progress bar — out of scope per the "reuse album logic" decision.

### 5. Components / files

New / changed:

- `web/.../search/.../+page.svelte` — capture `total` from the search response;
  render the header "Add all …" button + click handler that opens the new modal
  with `{ searchQuery, total }`.
- `web/src/lib/modals/SearchAddAllToCollectionModal.svelte` (new) — thin wrapper:
  renders `CollectionPickerModal assetCount={total}`; on confirm, runs the
  collector then calls `addAssetsToCollections`; owns the `pending` state.
- `web/src/lib/services/*` — a small `collectSearchResultIds(searchQuery)` helper
  (paging loop, `withExif: false`); reuse existing `addAssetsToCollections`.
- `web/src/lib/constants.ts` — `MAX_SPACE_ASSETS_PER_REQUEST = 50_000`.
- `server/src/dtos/shared-space.dto.ts` — `MAX_SPACE_ASSETS_PER_REQUEST = 50_000`.
- `i18n/*.json` — new + backfilled keys (below).

Unchanged / reused: `CollectionPickerModal`, `AssetAddToCollectionModal` (kept
pristine for its existing ID-based callers), `addAssetsToCollections`,
`addAssetsToAlbums`, `addAssetsToSpace`, the album/space server endpoints.

## i18n (all six locales: en, de, fr, it, nl, es)

Source strings authored in `i18n/en.json`; translated values added to the other
five. Proposed new keys (final wording TBD during implementation):

- `add_all_matching_to_album_or_space` — button label, e.g.
  `"Add all {count, plural, one {# result} other {# results}} to…"`.
- `preparing_assets` — collection/add in-progress state, e.g.
  `"Preparing assets…"`.

Reused existing key that must be **backfilled**:

- `spaces_hidden_too_many_assets` — present in en/de/fr, **missing in it/nl/es**
  (they currently fall back to English). Add translated values for it/nl/es so
  the over-cap notice is localized for the required set.

Acceptance: every new/edited key exists with a locale-appropriate value in all
six files; no key left English-only in it/nl/es.

## Edge cases

- **`total === 0`** — button hidden; nothing to do.
- **Filter changes mid-flow** — the collector uses the search DTO captured when
  the modal opened, so it adds the set the user saw, not a later-edited filter.
- **`isNotInAlbum` / `isNotInSpace` filters** — after add, the existing
  `onAlbumAddAssets`/`SpaceAddAssets` handlers already prune added assets from the
  visible grid; behavior is inherited.
- **Result count shifts between opening and collecting** (assets added/deleted
  concurrently) — collector pages to exhaustion (`nextPage`), tolerating small
  drift; the success toast reports actual per-asset results from the server.
- **Over 50k with a space picked** — cannot happen via the picker (spaces hidden);
  albums proceed normally.
- **Over ~250k (album, body limit)** — surfaced via existing error handling; not
  specially designed for (outside realistic scope).

## Testing

- Unit: `collectSearchResultIds` pages correctly (multi-page, single-page, empty),
  sends `withExif: false`, stops at `nextPage === null`.
- Component/integration: header button appears iff `total > 0`; opens picker with
  `assetCount = total`; over-cap hides spaces + shows notice; confirm triggers
  collect + `addAssetsToCollections` with the full ID set.
- Cap change: space add of >10k and ≤50k succeeds; >50k rejected by server DTO.
- i18n: all six locales contain the new/backfilled keys.

## Out of scope / future

- Server-side "add all matching a filter" background job (would remove the
  client paging cost and the body-size ceiling; template exists via
  `queueBulkAdd`).
- Progress bar / chunked adds.
- Prefetching IDs in parallel while the user browses the picker.
