# Space Albums — Phase 1.5: Immersive In-Space Albums Experience — Design

## Summary

Phase 1 made a linked album's photos appear in the space timeline, search, and map, and gave the
space an "Albums" management tab (link / unlink / show-in-timeline) plus add/remove permission for
space Editors. But it stopped short of letting a member **browse a linked album inside the space** —
the spec's "a new in-space Albums section that lets members browse them like the global albums view,
but only inside the space" goal was only partially delivered.

Phase 1.5 delivers the immersive experience: a dedicated **Albums area** in the space (a grid of the
linked albums), and an **in-space album view** where a member opens an album and browses its photos
within the space chrome — and Editors/Owners **collaborate** (add/remove photos). The space starts to
"feel like a whole Immich instance in one space" — its own timeline, people, and now a real albums
section.

This is **almost entirely web work**. The asset read/write paths already exist from Phase 1; the only
backend addition is a small read grant so a space member can open a linked album's entity + photo
list (today that gates on album-level membership).

## Goals

- A **header "Albums" button** in the space view → a dedicated **Albums grid page**
  (`/spaces/:id/albums`) listing the linked albums as cards, visible to all members.
- Clicking a card opens an **in-space album view** (`/spaces/:id/albums/:albumId`) that browses the
  album's photos within the space chrome (back-to-space, "in {space}" context).
- **Collaboration:** in the in-space album view, space **Editors/Owners** (and album owners/editors)
  can **add and remove** photos; **Viewers** are browse-only. (Server already authorizes this.)
- **Management consolidation:** link / unlink / show-in-timeline controls live on the Albums grid
  page (Editor-only); the Phase-1 side-panel "Albums" tab is removed.
- Consistency: reuse Immich's existing components and design tokens (`UserPageLayout`, `AlbumCover`,
  `Timeline`, `AssetSelectControlBar`, `@immich/ui`); no divergent aesthetic.

## Non-goals

- **No full album-page parity in-space.** The in-space album view is focused browse + collaborate;
  the global album page's filters/map/people/slideshow/album-settings are not re-hosted in the space.
- **No album destroy / rename / settings via the space.** Those stay with the album owner on the
  normal album page (unchanged from Phase 1).
- **No mobile.** Web only (mobile remains Phase 2).
- **No change to the unified space timeline / search / map** (Phase 1 already composes linked-album
  assets there; `showInTimeline` still gates those aggregate surfaces).

## Background: what Phase 1 already provides

- **Asset read** for space members: `AssetAccess.checkSpaceAccess` has a `shared_space_album` branch,
  so members can read/download/thumbnail a linked album's individual assets.
- **Asset write** for space Editors/Owners: `AlbumAccess.checkSpaceLinkedAlbumAccess` (role ≥ Editor)
  is unioned into `Permission.AlbumAssetCreate` / `AlbumAssetDelete`, so space Editors can
  add/remove a linked album's assets via the existing `POST/DELETE /albums/:id/assets`.
- **Aggregate surfaces**: linked-album assets appear in the space timeline, search, and map markers
  (all gated on `shared_space_album.showInTimeline = true`).
- **Management SDK**: `getSharedSpaceAlbums`, `linkAlbum`, `unlinkAlbum`, `updateSharedSpaceAlbum`.

**The gap:** the album **entity** read and the album-filtered **timeline** gate on
`Permission.AlbumRead` (`timeBucketChecks` in `timeline.service.ts` checks `AlbumRead` when `albumId`
is set; `getAlbumInfo` checks `AlbumRead`). A space member who is not an `album_user` fails
`AlbumRead` → cannot open the album. That is the one thing Phase 1.5's backend piece fixes.

## Design overview

Three web surfaces + one small backend grant:

| Piece                                   | Layer  | What                                                              |
| --------------------------------------- | ------ | ----------------------------------------------------------------- |
| Album-read grant for space members      | server | `AlbumRead`/`AlbumDownload` accept a space-member predicate       |
| Header "Albums" button                  | web    | entry point in the space view → the grid page                     |
| Albums grid page `/spaces/:id/albums`   | web    | grid of linked albums + Editor management; replaces the panel tab |
| In-space album view `…/albums/:albumId` | web    | browse the album's photos + Editor collaborate, in space chrome   |

## Backend — album-read grant for space members

The only server change. Mirrors the existing Editor-gated write predicate, but at **any-member**
level for **read**.

- Add `AlbumAccess.checkSpaceLinkedAlbumReadAccess(userId, albumIds: Set<string>)` in
  `server/src/repositories/access.repository.ts` — returns album ids of albums linked to **any
  space the user is a member of** (no role filter), via
  `album ⋈ shared_space_album ⋈ shared_space_member(userId)`, `album.deletedAt is null`. `@GenerateSql`
  - `@ChunkedSet`, mirroring `checkSpaceLinkedAlbumAccess`.
- In `server/src/utils/access.ts`, union it into the **`Permission.AlbumRead`** case (after the
  owner ∪ `album_user`-viewer paths) and the **`Permission.AlbumDownload`** case. Leave
  `AlbumAssetCreate`/`AlbumAssetDelete` (Editor-gated, Phase 1) and `AlbumUpdate`/`AlbumDelete`
  (owner/editor, unchanged) alone.

**Effect:** a linked album becomes fully **readable** by every space member (`getAlbumInfo`, the
album-filtered timeline, download), **writable** by space Editors/Owners (Phase 1), and
destroy/rename/settings stay album-owner-only.

**"Absorbed" invariant preserved:** the album still never appears in a member's personal album
**list** (that query keys off `album_user`/ownership, not `AlbumRead`), and no `album_user` row is
written. Granting `AlbumRead` via a predicate only means a member who navigates to the album (e.g.
the in-space view, or the global `/albums/:id` URL) can read it — which is correct, since it is
shared with them through the space. This is a deliberate, consistent extension of "absorbed = readable
inside the space," not a regression of Grid 7.

## Routes & navigation

Mirror the existing `/spaces/:id/people` sub-page pattern — each space sub-route is independent
(its own `+page.ts` loads space + members, computes the member's role, renders `UserPageLayout` with
a back button to `/spaces/:id`; there is no shared `[spaceId]` layout).

- **`/spaces/:id/albums`** — `+page.svelte` + `+page.ts`. Loads `getSpace`, `getMembers`,
  `getSharedSpaceAlbums`. Computes `isEditor = role ∈ {Owner, Editor}`.
- **`/spaces/:id/albums/:albumId`** — `+page.svelte` + `+page.ts`. Loads `getSpace`, `getMembers`,
  `getAlbumInfo` (now permitted for members via the backend grant). Computes
  `canManage = isEditor(space) || isAlbumOwnerOrEditor(album)`.
- **Header button** in `/spaces/:id/.../+page.svelte` → `goto(/spaces/:id/albums)`.

## Web — header "Albums" button

In the main space view header `buttons` row (the existing ghost/round IconButton group: Add-photos,
Map, Members, ⋯), add — visible to **all** members, between Map and Members:

```svelte
<IconButton
  icon={mdiImageMultipleOutline}
  aria-label={$t('albums')}
  variant="ghost"
  shape="round"
  color="secondary"
  onclick={() => goto(`/spaces/${space.id}/albums`)}
/>
```

## Web — Albums grid page (`/spaces/:id/albums`)

`UserPageLayout` shell mirroring the People page.

```
┌────────────────────────────────────────────────────────────┐
│ ← Albums            3 albums                  [ + Link album ]│  back→/spaces/:id ; "Link album" Editor-only
├────────────────────────────────────────────────────────────┤
│   ┌─────────┐   ┌─────────┐   ┌─────────┐                    │
│   │ ▣ cover │   │ ▣ cover │   │ ▣ cover │   …   ⋯ on hover    │
│   └─────────┘   └─────────┘   └─────────┘ (dim)               │
│   Trip 2024     Family        Wedding ⦸                       │
│   142 photos    88 photos     31 · hidden from timeline       │
└────────────────────────────────────────────────────────────┘
```

- **Header:** `leading` = back `IconButton mdiArrowLeft` → `/spaces/:id`. `title` = `$t('albums')`,
  `description` = album count. `buttons` (Editor only) = a `Button` "Link album"
  (`leadingIcon mdiPlus`) opening the link-picker modal.
- **Grid:** content wrapper `px-4 pt-4`; grid classes matching the People page
  (`grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8`).
- **`space-album-card.svelte`** (new, fork-isolated): reuses `AlbumCover` + `AlbumCard`'s exact
  classes (`rounded-2xl border border-transparent p-5 hover:bg-gray-100 …`, square cover,
  `text-lg font-semibold` title, `text-sm text-gray-500` subtitle = "{assetCount} photos"). Built from
  the `SharedSpaceLinkedAlbumDto` (albumId, albumName, assetCount, albumThumbnailAssetId,
  showInTimeline). Links to `/spaces/:id/albums/:albumId`. We add a thin card rather than modifying
  the shared `AlbumCard`/`AlbumCardGroup` to avoid upstream rebase surface.
  - When `showInTimeline = false`: dim the cover and append a `· hidden from timeline` sublabel so
    Editors see state at a glance.
  - **Editor ⋯ menu** (`ButtonContextMenu mdiDotsVertical`, the on-hover affordance AlbumCard already
    has): "Show in timeline" (toggles via `updateSharedSpaceAlbum`) and "Unlink from space"
    (`unlinkAlbum`, behind a `modalManager.showDialog` confirm). Hidden for Viewers.
- **Link-picker modal** (Editor only): lists albums the current user owns or can edit
  (`getAllAlbums()` filtered to owner or `album_user` Editor) and not already linked; selecting one
  calls `linkAlbum` and refreshes. (Relocates the Phase-1 picker logic.)
- **Empty state:** the People-page inline pattern —
  `flex min-h-[calc(66vh-11rem)] … place-content-center` with `Icon mdiImageMultipleOutline` (3.5em)
  - "No albums linked yet". Editors also get a "Link an album" button; Viewers see only the text.
- **Viewer:** same grid, no "Link album", no card ⋯ menu — pure browse.
- **Loading:** `LoadingSpinner` while `getSharedSpaceAlbums` resolves.

## Web — in-space album view (`/spaces/:id/albums/:albumId`)

`UserPageLayout` + the shared `Timeline` (album-filtered), so it reads like the global album page but
inside the space.

```
┌────────────────────────────────────────────────────────────┐
│ ← Trip 2024        142 photos · in Alps Trip   [ + Add photos]│  back→/spaces/:id/albums ; "in {space}" context
├────────────────────────────────────────────────────────────┤
│  [ Timeline: month-grouped photo grid of the album ]         │
│   ▢ ▢ ▢ ▢ ▢ ▢   …   click → standard asset viewer            │
└────────────────────────────────────────────────────────────┘
   (on select) ⌫ 3 selected   [♥] [⤓]  [⋯  Remove from album]   │  AssetSelectControlBar; Remove = canManage
```

- **Header:** `leading` = back `IconButton` → `/spaces/:id/albums`. `title` = album name.
  `description` = "{count} {photos} · {in} {space name}". `buttons` (when `canManage`) = "Add photos"
  `IconButton mdiImagePlusOutline` → enters select-assets mode.
- **Photo grid:** reuse `Timeline` with the album filter (the same option-builder the global album
  page uses, scoped to `albumId`), month grouping, opening photos in the standard asset viewer. Album
  access is granted to the member via the backend grant, so the `albumId`-filtered
  `timeBucketChecks` (`AlbumRead`) passes.
- **Collaboration (`canManage`):** "Add photos" → select assets → `addAssetsToAlbum`; selecting
  photos shows `AssetSelectControlBar` including **Remove from album**
  (`RemoveFromAlbumAction`/`removeAssetsFromAlbum`). Both are server-authorized for space Editors via
  Phase 1's write predicate; the client gates the affordances on `canManage` to fix the "buttons
  hidden for a space-editor who isn't an album_user" gotcha (the global album page derives `isEditor`
  purely from `album.albumUsers`).
- **Viewer:** browse + open + download only — no Add/Remove.
- **Empty album:** `Timeline` `empty` snippet → centered icon + "No photos yet"; Editors also get
  "Add photos".
- **Loading / not-found / linkage check:** `LoadingSpinner` while loading. The view MUST explicitly
  verify the album is **linked to _this_ space** — i.e. `:albumId` appears in `getSharedSpaceAlbums(:id)`
  — and **not** rely on `getAlbumInfo` returning 4xx. (A user who independently _owns_ an album would
  pass `getAlbumInfo` even when that album is not linked to this space; the "in {space}" framing would
  then be wrong.) If the album is not linked to this space, or `getAlbumInfo` 4xx (no access), redirect
  back to `/spaces/:id/albums` with a toast. Load order: resolve `getSharedSpaceAlbums(:id)` (or a
  membership+linkage check) first; only then load `getAlbumInfo`.

## Removed / changed

- **Remove the side-panel "Albums" tab** from `space-panel.svelte` (and its `SpaceLinkedAlbums`
  usage + the `isEditor` Albums-tab wiring). Management consolidates onto the grid page. The Phase-1
  SDK logic from `space-linked-albums.svelte` (load/link/unlink/toggle/picker) is **refactored into**
  the grid page + `space-album-card.svelte` rather than discarded.

## Permissions & roles (summary)

| Capability                             | Viewer | Editor / Owner          | Mechanism                                           |
| -------------------------------------- | ------ | ----------------------- | --------------------------------------------------- |
| See Albums grid + open album view      | ✅     | ✅                      | new `AlbumRead` space-member grant                  |
| Browse album photos / open / download  | ✅     | ✅                      | `checkSpaceAccess` (assets) + `AlbumDownload`       |
| Add / remove album photos              | ❌     | ✅                      | Phase-1 `checkSpaceLinkedAlbumAccess` (Editor)      |
| Link / unlink / show-in-timeline       | ❌     | ✅                      | Phase-1 `linkAlbum`/`unlinkAlbum`/`updateAlbumLink` |
| Rename / delete album / album settings | ❌     | ❌ (unless album owner) | unchanged — album owner only                        |

## Development methodology: TDD (mandatory)

**This feature is implemented test-first, following `superpowers:test-driven-development`.** Every
unit of behavior is built RED → GREEN → REFACTOR:

1. **RED** — write a failing test pinning the behavior (predicate allow/deny, route loads/redirects,
   component renders/gates a control, SDK called with the right args). Run it; confirm it fails for
   the right reason.
2. **GREEN** — minimum code to pass.
3. **REFACTOR** — clean up with tests green.

The backend read grant is **access-control / security-relevant**, so its permission-matrix cells are
written **before** the predicate code (mirroring Phase 1's matrix discipline). Web behavior (route
gating, role-gated controls, the linkage check) is pinned by component tests written before the
component code. No production code is written before a failing test exists for it.

## Testing strategy (full coverage)

Coverage targets **every** capability in the [Permissions & roles](#permissions--roles-summary) table
and every edge case below.

**Backend (medium + matrix), written FIRST:**

- Extend `shared-space-album-permissions.service.spec.ts` with a **READ-album-entity** grid — space
  Owner/Editor/Viewer can `checkAccess(AlbumRead, [linkedAlbum])` (and likewise `AlbumDownload`);
  `nonMember` and `crossEditor` (member of another space) are **denied**; the unlinked album `B` is
  **denied**; a `showInTimeline = false` linked album is **still readable** (the toggle gates only
  aggregate surfaces, never album-entity read). Confirm the existing Phase-1 write/Editor matrix is
  unchanged (the read grant must not widen write).
- A `checkSpaceLinkedAlbumReadAccess` repo medium test (any member allowed incl. Viewer; non-member
  denied; not-linked denied; **dual-path** — a user who is BOTH a space member AND an `album_user`
  resolves to allowed via either path with no duplication).
- Album-filtered timeline access: a space Viewer can fetch `getTimeBuckets`/`getTimeBucket` with
  `albumId` of a linked album (now passes `timeBucketChecks`' `AlbumRead`); non-member denied.
- Regenerate `access.repository.sql` against a **complete** DB; verify a **scoped** diff (the new
  predicate + the two union branches only — no unrelated churn, per the Phase-1 regen lesson).

**Web (component + e2e):**

- Grid page: renders linked album cards linking to `/spaces/:id/albums/:albumId`; Editor sees
  "Link album" + card ⋯ (toggle/unlink) and Viewer does **not**; empty state (Editor CTA vs Viewer
  text); the `showInTimeline = false` dim + "hidden from timeline" sublabel; link-picker offers only
  owned/editable, not-yet-linked albums; unlink fires a confirm dialog before `unlinkAlbum`.
- In-space album view: renders the album timeline; `canManage` (space-Editor who is **not** an
  `album_user`) shows Add/Remove and a Viewer does **not**; a `showInTimeline = false` album is still
  fully browsable here; **linkage check** — an album NOT linked to this space (incl. one the user
  independently owns) redirects back to `/spaces/:id/albums` with a toast (does not render with a wrong
  "in {space}" header).
- `space-album-card.svelte` unit test (link href targets the in-space route, editor-menu gating,
  hidden-from-timeline visual state).
- Header button renders for all members and navigates to `/spaces/:id/albums`.
- e2e: a space **Viewer** can `GET /albums/:id` (album info) **and** the album-filtered timeline for a
  linked album (proves the read grant) while a **non-member** is denied both; a space **Editor**
  add+removes the linked album's assets via the existing endpoints in the album-view flow.
- Web gates: `pnpm build`, `pnpm check`, `pnpm lint` (0 warnings on new files), component tests.

**Edge cases (each a test):**

- `showInTimeline = false` album → excluded from the space timeline/search/map (Phase 1) but **still**
  listed in the grid and **fully browsable** in the in-space view.
- Album **unlinked while open** → next load redirects to the grid with a toast.
- Album **soft-deleted** → absent from the grid (`getSharedSpaceAlbums` filters `deletedAt`); the
  in-space view 404s → redirect.
- **Non-member** navigating to `/spaces/:id/albums(/:albumId)` → the `getSpace`/`getMembers` load is
  denied (`SharedSpaceRead`) → handled (redirect/403), no album data leaked.
- **URL-tampering** linkage case (above): own-but-not-linked album → redirect, not render.
- **Dual-path** member (space member + `album_user`) → read works; collaboration follows the higher of
  the two (space-Editor or album-editor).

## Rollback

- **Backend** is additive (one predicate + two `Permission` union branches). Reverting the app code
  leaves the predicate unused; no migration. SQL docs regen on revert.
- **Web** is additive routes + a header button + the panel-tab removal. Reverting restores the
  Phase-1 panel-tab management. No data involved.

## Resolved during design / open questions for the implementation plan

- **Album-timeline builder (resolved):** the global album page builds its timeline via
  `buildAlbumTimelineOptions(album.id, …)` + `buildAlbumDetailFilterConfig(album.id)` from
  `web/src/lib/utils/album-filter-options.ts` / `album-filter-config.ts`. The in-space album view
  reuses these verbatim scoped to `albumId` (plus the space chrome) rather than re-deriving filters.
- **`AlbumDownload` grant (resolved → grant it):** the space-member read predicate is unioned into
  both `AlbumRead` and `AlbumDownload`, for parity with the asset-level download `checkSpaceAccess`
  already permits. (If a reviewer wants stricter whole-album-zip behavior, it's a one-line removal.)
- **Open — link-picker modal:** reuse a shared album-selection modal if one cleanly supports
  "albums I own/can edit, excluding already-linked"; otherwise relocate the Phase-1 bespoke picker into
  the grid page. Lean: relocate the Phase-1 picker.
