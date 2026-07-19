# Space Albums — full albums-page parity (search / create / sort / group / list-covers)

**Date:** 2026-07-05
**Status:** Design — approved architecture; reviewed against `space-albums-onto-main`; structured for `/impl-loop`
**Target branch:** `space-albums-onto-main` (PR #747 baseline — the linked-albums endpoint exists here)
**Scope:** One implementation plan, delivered as 8 TDD vertical slices. No mobile.

> File paths/line numbers are **indicative** (verified against `space-albums-onto-main` on
> 2026-07-05); each slice's `/impl-loop` plan-review step re-confirms them before execution.

## 1. Problem & goal

The main albums page (`/albums`) has a rich toolbar — search, create album, sort, group-by,
expand/collapse, and a cover/list view toggle. The **Albums tab inside a shared space**
(`/spaces/{spaceId}/albums`) has none of it: just a "N albums" count, a "Link album" button, and a
hand-rolled grid of `space-album-card.svelte`.

**Goal:** bring the main albums-page functionality into the space Albums tab by **reusing the
existing albums logic** (sort/group helpers, server album mapping, the `AlbumCover` thumbnail) rather
than reimplementing it — while keeping the fork's rebase path clean.

Requested capabilities: **Search**, **Create album** (new — spaces today only _link_ existing
albums), **Sort**, **Group by** (None / Year / Linked by / Owner), **List vs. Covers** toggle.

## 2. Non-goals (YAGNI)

- **No "All / Owned / Shared" filter tabs** — they don't map to a space (every album here is linked).
- **No mobile / Flutter work.** Web only.
- **No new "create-and-link" server endpoint** — compose the two existing calls client-side.
- **No pagination.** Spaces hold tens of albums; the main page doesn't paginate either.
- **No DB migration** — the enrichment reads existing columns only. Nothing for
  `scripts/revert-to-immich/`.
- **No auto-deletion of empty albums in the space** (unlike `/albums` — see §4.1).
- **No change to the album _detail_ page** inside a space.

## 3. Design principle: fork-isolated reuse

This fork rebases onto upstream Immich regularly. The albums-page components upstream evolves are
coupled to the global `albumViewSettings` singleton and to hardcoded personal-album routing — the
exact things we'd need to change. So we **reuse the leaf logic that isn't coupled** and **fork the
rendering/orchestration shells**, keeping upstream `.svelte` files untouched (one deliberate exception
in Slice 8).

**What we actually reuse** (the hard parts): the sort/group **logic + metadata** (`album-utils.ts`),
the server album **mapping** (`mapAlbum`, `AlbumResponseSchema`, `getMetadataForIds`), and the
`AlbumCover` **thumbnail** component. The toolbar, list, table rows, and cards are fork — because the
upstream equivalents are coupled (see below).

### Reused as-is (import only — no upstream edits)

| File                                                  | Reused                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/lib/components/album-page/AlbumCover.svelte` | Thumbnail (data-driven off `albumThumbnailAssetId`, has `NoCover` fallback) — used inside `SpaceAlbumCard` and fork table rows                                                                                                                 |
| `web/src/lib/utils/album-utils.ts`                    | `sortAlbums`, `sortOptionsMetadata`, `findSortOptionMetadata`, `groupOptionsMetadata` (option metadata only), `getSelectedAlbumGroupOption`, `isAlbumGroupCollapsed(settings, id)` (reader — takes a settings arg), `stringToSortOrder`, types |
| `web/src/lib/stores/preferences.store.ts`             | Enums `SortOrder`, `AlbumViewMode`, `AlbumSortBy`; interface `AlbumViewSettings`                                                                                                                                                               |
| `server/src/dtos/album.dto.ts`                        | `AlbumResponseSchema`, `mapAlbum`                                                                                                                                                                                                              |
| `server/src/repositories/album.repository.ts`         | `getMetadataForIds` (bulk assetCount + date range)                                                                                                                                                                                             |

**NOT reusable — must be fork** (verified 2026-07-05):

- `AlbumsControls.svelte`, `AlbumsList.svelte`, `AlbumsTable.svelte`, `AlbumCard.svelte`,
  `AlbumCardGroup.svelte` — read/write the global `albumViewSettings` singleton, hardcode personal
  routing / personal create.
- **`AlbumsTableRow.svelte`** — navigation is **hardcoded** `goto(Route.viewAlbum(album))` →
  `/albums/{id}` (`:36`); only its context menu is prop-driven. Can't route to the space album.
- **`AlbumsTableHeader.svelte`** — reads/writes the **global** `albumViewSettings` directly (`:12‑19`).
- The `album-utils` **collapse/expand mutators** (`collapseAllAlbumGroups`, `expandAllAlbumGroups`,
  `toggleAlbumGroupCollapsing`) mutate the **global** store via `get()`/`update()` — not pointable at
  the space store. (Only the `isAlbumGroupCollapsed(settings, id)` reader is parameterized.)
- The Year/Owner **bucketing logic** lives in `AlbumsList.svelte:70‑77` (not a reusable helper).

### New fork-only files (isolated — never conflict on rebase)

| File                                                         | Role                                                                                                                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/lib/components/spaces/space-albums-controls.svelte` | Toolbar (search / sort / group / view toggle / collapse-expand / Create + Link)                                                                                        |
| `web/src/lib/components/spaces/space-albums-list.svelte`     | Orchestrator: search → sort (`sortAlbums`) → group (fork bucketing) → render (cover grid or list)                                                                      |
| `web/src/lib/components/spaces/space-albums-table.svelte`    | List-mode: **fork rows** (route to the space album, show space actions, reuse `AlbumCover`) + **fork sort headers** (write the space store). Reuses `AlbumCover` only. |
| `web/src/lib/stores/space-album-view-settings.store.ts`      | Fork persisted store + `SpaceAlbumGroupBy` enum + **fork** collapse/expand mutators + group-by metadata (incl. "Linked by")                                            |

### Modified fork-only files

| File                                                         | Change                                                                                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/lib/components/spaces/space-album-card.svelte`      | Consume enriched DTO (`id`, not `albumId`); render `AlbumCover`; keep show-in-timeline dim + unlink/timeline menu                             |
| `web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte` | Replace bespoke grid with `<SpaceAlbumsControls/>` + `<SpaceAlbumsList/>`; wire Create + Link; `linkedAlbumIds` maps `a.id` (was `a.albumId`) |
| `server/src/dtos/shared-space.dto.ts`                        | Enrich `SharedSpaceLinkedAlbumSchema`                                                                                                         |
| `server/src/repositories/shared-space.repository.ts`         | Rich `getLinkedAlbums`; drop per-album `getAlbumAssetCount` N+1; regenerate `queries/shared.space.repository.sql`                             |
| `server/src/services/shared-space.service.ts`                | Reuse `getMetadataForIds` + `mapAlbum`; remove N+1 loop                                                                                       |

> `SpaceLinkAlbumModal.svelte` needs **no change** — it takes `linkedAlbumIds: string[]` and links by
> `album.id` of full `AlbumResponseDto`s from `getAllAlbums`; it never reads a linked-album `albumId`.

### The one shared file touched (feature)

`web/src/lib/i18n/en.json` — new strings ("Create album", "Linked by", "Owner", "Unknown", "No date",
"No matching albums", search placeholder). Additive, low-conflict. Other locales via Weblate.

### Honest cost

The space feature needs **zero upstream `.svelte`/`.ts` edits** (one additive shared JSON). The list
being un-reusable (C1 above) actually _reduces_ upstream coupling — the fork owns its rendering. If
upstream later adds a grouping mode or toolbar control, we mirror it into the space toolbar by hand —
a rare ~10-line copy, **not a merge conflict every rebase.**

**One deliberate exception (Slice 8):** to keep `/albums` and the space page visually consistent, we
reorder the `/albums` toolbar (`AlbumsControls.svelte`) into the same functional-split arrangement —
a small, localized template reorder (moving the Create button into the right-hand action cluster), no
behavior change. Some rebase-conflict risk on that one file, consciously traded for cross-page
consistency, kept minimal so any conflict is trivial to resolve.

## 4. UX spec

### Toolbar (`space-albums-controls.svelte`) — functional-split layout

Two clusters: **shape/browse the set** (left) and **add albums** (right, the primary CTA cluster).
The controls use the same `@immich/ui` primitives as `/albums`, so the visual style matches. `/albums`
is reordered into this same arrangement (Slice 8). The space page uses the **same control style**, with
space-specific differences: it **adds** a "Linked by" grouping option and a **Link** action, and
**omits** the All/Owned/Shared filter tabs.

```
 🔍 Search…   [Sort ▾]  [Group ▾]  [⤢]   [▦|≣]        [＋ Create album]  [🔗 Link]
 └────────── shape the view ──────────┘                └────── add albums ──────┘
```

- **Search** — `SearchBar` bound to a local `searchQuery`. Filters by album name (case-insensitive
  substring) and `description` when non-null. Filtering lives in `space-albums-list.svelte`.
- **Sort** — `Dropdown` over reused `sortOptionsMetadata`: **Title, Item count, Date modified, Date
  created, Most recent photo (default), Oldest photo**, with the same sort-direction control `/albums`
  uses. (Verified fields: Most-recent-photo sorts on `endDate`, Oldest-photo on `startDate`.)
- **Group by** — `Dropdown`: **None / Year / Linked by / Owner.** `Year` disabled when sort is
  `DateCreated`/`DateModified` (upstream rule).
- **Collapse / expand all** — a single toggle `IconButton`, shown **only when grouping ≠ None**,
  docked next to Group by. Operates on the space store (fork mutators).
- **View toggle** — Cover ↔ List, same toggle style as `/albums`.
- **Create album** — editor+ only, **filled primary** button. Creates a new album owned by the actor,
  auto-links it, navigates to the space album detail for naming (§4.1).
- **Link album** — editor+ only, **secondary/subtle** button. Opens `SpaceLinkAlbumModal` (unchanged).

**Visual hierarchy:** Create is the emphasized primary path; Link is a quieter secondary action next
to it. The standalone "N albums" count is dropped — the Albums tab badge already shows it.

**Viewer (read-only):** Create + Link hidden; search/sort/group/view fully usable.

**Responsive:** on narrow widths, Sort/Group collapse to icon-only triggers and Link folds into an
overflow if needed, mirroring the main page's mobile fallback; Create stays visible.

### 4.1 Create + Link flow (client-side compose)

1. `createAlbum({ albumName: '' })` → new album owned by the actor. **Reuse `album-utils` `createAlbum`
   (name empty, matching `/albums`), NOT `createAlbumAndRedirect`** — the latter redirects to
   `/albums/{id}`, the wrong route.
2. `linkAlbum({ id: spaceId, albumId: newAlbum.id })`.
3. On success: `goto('/spaces/{spaceId}/albums/{newAlbum.id}')` + refresh list.

Actor is the album owner, so they satisfy `linkAlbum`'s `AlbumUpdate` + editor requirement. **No new
endpoint.**

**Failure handling:** if create succeeds but link fails → error toast, **do not** navigate, reload the
list. The orphaned personal album still exists in the actor's `/albums` (recoverable).

**Empty-album handling (decision):** the created album has an empty name until the user names it on the
detail page (same as `/albums`). Unlike `/albums`, the space list does **not** auto-delete empty
untitled albums (deleting a user's album from a shared-space view is risky and out of scope). An
abandoned freshly-created album therefore remains linked (a user-owned artifact they can unlink or
delete). If a stronger UX is wanted later (name-first dialog, or default name), that's a follow-up.

### 4.2 Grouping semantics (implemented in the fork list)

- **Year** — bucket by the album's date year: **`startDate` when sorted by Oldest photo, otherwise
  `endDate`** (mirrors the main page's rule in `AlbumsList.svelte:70‑77`; the fork list replicates it —
  it is not a reusable helper). Albums with no date → **"No date"** bucket.
- **Owner** — bucket by the album owner (from `albumUsers`, owner-first); show owner name.
- **Linked by** — bucket by `addedById` resolved to the space member's display name via the `members`
  list from the space layout. Null `addedById`, or an `addedById` not in the current members (linker
  left the space), → **"Unknown"** bucket.
- Group ordering direction (`groupOrder`) applies to bucket order (year desc/asc; name asc/desc).

### 4.3 Empty vs. no-results states

- **0 linked albums** → existing empty-state CTA; sort/group/search controls hidden.
- **Albums exist but search matches 0** → distinct "No matching albums" message; controls stay visible
  so the query can be cleared.

### 4.4 View-settings scope

The space uses its **own** persisted store (`space-album-view-settings`, key distinct from
`album-view-settings`), shared across all spaces. Changing sort/group/view in a space does **not**
bleed into `/albums`, and vice-versa. Asserted behavior (§9).

## 5. Web architecture & data flow

```
+layout.ts  ──getSharedSpaceAlbums(id)──▶  data.linkedAlbums: SharedSpaceLinkedAlbumDto[]  (enriched)
     │                                          (+ data.members for Linked-by name resolution)
     ▼
albums/+page.svelte
     ├─ <SpaceAlbumsControls  bind:searchQuery  {isEditor}  onCreate  onLink />
     └─ <SpaceAlbumsList  {albums} {searchQuery} {members} {isEditor}
                          settings = spaceAlbumViewSettings />
                 ├─ derive: filter(search) → sort(sortAlbums) → group (fork: None/Year/LinkedBy/Owner)
                 ├─ Cover mode → grid of <SpaceAlbumCard> (fork; reuses <AlbumCover>)
                 └─ List  mode → <SpaceAlbumsTable> (fork rows + headers; reuses <AlbumCover>)
```

The enriched DTO is `AlbumResponseDto`-shaped (`id`, `albumName`, `assetCount`, `startDate`, `endDate`,
`albumUsers`, `updatedAt`, `createdAt`), so `AlbumCover` and `sortAlbums` consume it directly. Sorting
reuses `sortAlbums`; **grouping and list-mode rows/headers are fork** (the upstream ones are coupled —
§3).

## 6. Server architecture

### 6.1 DTO enrichment (`shared-space.dto.ts`)

These are `nestjs-zod` schema DTOs — reconcile at the **schema** level, not class `extends`:

```ts
export const SharedSpaceLinkedAlbumSchema = AlbumResponseSchema.extend({
  showInTimeline: z.boolean(),
  addedById: z.string().nullable(), // who linked it (labelled "Linked by" in the UI) — matches current type
  linkedAt: z.string(), // link-creation timestamp (was `createdAt`)
});
```

Collisions handled:

- **`id` vs `albumId`** — use inherited `id` (album id); **drop `albumId`.** Web callers migrate
  `albumId` → `id` (fork files only: `+page.svelte`, `space-album-card.svelte`, their specs).
- **`createdAt`** — inherited `createdAt` = _album_ created; the _link_ timestamp is renamed
  **`linkedAt`**, removing the current overload.
- `albumName`, `assetCount`, `albumThumbnailAssetId` — compatible, inherited.

The DTO thus also gains `description`, `updatedAt`, `startDate`, `endDate`, `albumUsers`, `shared`,
`order`, `lastModifiedAssetTimestamp` — everything sort/group/search need.

### 6.2 Repository (`shared-space.repository.ts`)

Rich `getLinkedAlbums` returning `MapAlbumDto`-shaped rows **+** space fields (`addedById`,
`showInTimeline`, `linkedAt`): join `shared_space_album` ⋈ `album`, `.selectAll('album')`, add
album-users + shared-link selectors. **`withAlbumUsers`/`withSharedLink` are module-private in
`album.repository.ts` (not exported) — replicate the small `jsonArrayFrom` selectors in the fork repo;
do not edit upstream to export them.** Keep `album.deletedAt is null`. Add
`ORDER BY album.createdAt DESC, album.id` (the current query has none — deterministic order for tests).
Remove `getAlbumAssetCount` once unused (§6.3).

**`getLinkedAlbums` is `@GenerateSql`-decorated** → changing it **requires** `make sql` (with a running
DB) to regenerate `server/src/queries/shared.space.repository.sql`.

### 6.3 Service (`shared-space.service.ts`)

Mirror `AlbumService.getAll` to kill the N+1:

1. Membership check (unchanged — non-member → `ForbiddenException`).
2. `rows = sharedSpaceRepository.getLinkedAlbums(spaceId)`; if empty, return `[]` early (skip step 3).
3. `metadata = albumRepository.getMetadataForIds(rows.map(r => r.id))` — **one** bulk query.
4. Map each row: `{ ...mapAlbum(row), startDate, endDate, assetCount, lastModifiedAssetTimestamp
(from metadata), showInTimeline, addedById, linkedAt }` — `mapAlbum` gives no `startDate`/`endDate`
   /`assetCount` without hydrated `assets`, so these are overridden from `getMetadataForIds` (exactly
   as `AlbumService.getAll` does).

Reuses upstream `mapAlbum` + `getMetadataForIds` — no bespoke mapping, no per-album loop.

## 7. TDD discipline (applies to every slice)

**Strict red → green → refactor.** For each behavior: write the failing test **first**, run it, confirm
the **expected red** failure, then implement the **minimum** (the slice's "Implementation" items) to go
**green**, then refactor with tests staying green. In each slice below the **tests are authored before**
the implementation items regardless of listing order; the `/impl-loop` plan must preserve every listed
test/edge case and require red→green evidence from implementers. A test that passes on its first run
(when it should be red) is a red flag to investigate, not accept.

Stacks & fixtures (verified on this branch):

- **Server unit:** `newTestService(SharedSpaceService)` (`server/test/utils.ts`), auto-mocked repos
  (`mocks.sharedSpace`, `mocks.album`); fixtures via `server/test/small.factory.ts`
  (`factory.sharedSpace`, `factory.album`) and `server/test/factories/album.factory.ts` (`AlbumFactory`).
- **Server medium (real DB):** `server/test/medium.factory.ts` `newRealRepository` registers
  `SharedSpaceRepository`, `AlbumRepository`, `AlbumUserRepository`, `AssetRepository`; config
  `server/test/vitest.config.medium.mjs`.
- **Web:** `@testing-library/svelte` + happy-dom, `sdkMock` (`web/src/lib/__mocks__/sdk.mock`),
  `renderWithTooltips`/`TestWrapper`; web album factory `web/src/test-data/factories/album-factory.ts`.
- **E2E:** API vitest `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts`; Playwright
  `e2e/src/specs/web/spaces-albums.e2e-spec.ts`; helpers in `e2e/src/utils.ts`.

## 8. Vertical slice plan (for `/impl-loop`)

Eight slices — Slices 1–7 build the space feature (dependency-ordered); Slice 8 is an independent
consistency reorder of `/albums`. Each slice = red-first tests + minimal implementation + green +
commit + push, each producing working, testable software.

---

### Slice 1 — Server: enriched linked-albums endpoint (+ SDK, + keep web green)

**Goal:** `GET /shared-spaces/:id/albums` returns `AlbumResponseDto`-shaped data plus space fields
(`showInTimeline`, `addedById`, `linkedAt`), N+1 removed. Existing web consumers migrated to the
renamed fields so the app builds and all tests stay green (no UI features yet).

**Tests first (update + add):**

- **Update** `shared-space.service.spec.ts` `getLinkedAlbums` (`describe` ~`:8010`; current assertion
  `getAlbumAssetCount` toHaveBeenCalledWith ~`:8049`): drop that; assert `mocks.album.getMetadataForIds`
  called **once** with all ids; assert `getAlbumAssetCount` **never** called; assert enriched fields.
- **Add** unit cases: enriched shape (`id`, `albumName`, `description`, album `createdAt` **distinct
  from** `linkedAt`, `updatedAt`, `startDate`/`endDate`, `albumUsers` owner-first, owner name, `shared`,
  `assetCount`, `albumThumbnailAssetId`, `showInTimeline`, `addedById`); empty space → `[]`
  (`getMetadataForIds` not called); non-member → `ForbiddenException`; 0-asset album → `assetCount:0`,
  dates null; shared album → `shared:true`, multiple `albumUsers`; null `addedById` preserved;
  `showInTimeline` true/false preserved; null `albumThumbnailAssetId` preserved.
- **Add** medium spec `shared-space.service.medium.spec.ts` (real DB): seed space + members + albums
  (some with assets, one empty, one owned by another member, one soft-deleted); assert correct
  per-album `assetCount`/`startDate`/`endDate`, owner in `albumUsers`, soft-deleted excluded,
  deterministic order.
- **Update** e2e-api `shared-space-album.e2e-spec.ts` shape assertion (`:228‑244`) to the enriched
  fields (`id`, album `createdAt`, `updatedAt`, `startDate`/`endDate`, `description`, owner/`albumUsers`,
  `shared`, `linkedAt`, `showInTimeline`, `addedById`, `assetCount`); **keep** the "absorbed invariant"
  (`:247‑254`, linked album absent from a plain member's `GET /albums`); **add** an album-with-assets
  `assetCount`/date-range assertion.

**Implementation:** enrich `SharedSpaceLinkedAlbumSchema` (§6.1); rich `getLinkedAlbums` repo query with
replicated album-user/shared-link selectors + `ORDER BY` (§6.2); service reuse of `getMetadataForIds` +
`mapAlbum` (§6.3); **`make sql`** regen of `queries/shared.space.repository.sql`; SDK regen (`pnpm build`

- `pnpm sync:open-api` + `make open-api-typescript`); field renames (`albumId`→`id`,
  `createdAt`→`linkedAt`) in `space-album-card.svelte`, `spaces/[spaceId]/albums/+page.svelte`, and their
  existing specs (`space-albums-page.spec.ts`, `space-album-card.spec.ts`). `SpaceLinkAlbumModal` untouched.

**Exit criteria:** `cd server && pnpm test` (incl. new medium spec) + `pnpm check` + lint green;
`cd web && pnpm test` + `pnpm check:typescript` + lint green (renames only); `cd e2e && pnpm test`
green; `make sql` + SDK regenerated and committed.

---

### Slice 2 — Web: space-scoped store + reuse-based rendering with cover/list toggle

**Goal:** the tab renders albums via fork components that reuse `AlbumCover` — cover grid and a fork
list-mode table — with a working **Cover/List toggle**, state in a **space-scoped store isolated from
the global one**. Existing per-card actions (show-in-timeline, unlink) preserved.

**Tests first:**

- **Add** `space-album-view-settings.store.spec.ts`: default values; persistence key **≠**
  `album-view-settings`; view getter/setter.
- **Add** `space-albums-list.spec.ts`: renders `SpaceAlbumCard`s in Cover mode; renders
  `SpaceAlbumsTable` in List mode; toggling `view` switches rendering; **global `album-view-settings`
  is never written** (isolation).
- **Add** `space-albums-table.spec.ts`: renders a row per album; each row reuses `AlbumCover`, links to
  `/spaces/{spaceId}/albums/{id}` (**not** `/albums/{id}`), and exposes the space context menu
  (timeline toggle + unlink).
- **Update** `space-album-card.spec.ts`: enriched shape; routes to `/spaces/{spaceId}/albums/{id}`;
  `AlbumCover` renders; `showInTimeline:false` dims; manage-menu only when `canManage`; **unlink +
  toggle-timeline callbacks still fire** (regression).
- **Update** `space-albums-page.spec.ts`: renders controls + list; existing empty-state preserved.

**Implementation:** `space-album-view-settings.store.ts` (store + view field); `space-albums-list.svelte`
(view switch); `space-albums-table.svelte` (fork rows routing to the space album + fork headers reusing
`AlbumCover`); modify `space-album-card.svelte` (reuse `AlbumCover`, enriched DTO); swap the bespoke grid
in `+page.svelte` for controls + list; `en.json` view labels.

**Exit criteria:** web unit + `check:typescript` + lint green; view toggle works; isolation asserted.

---

### Slice 3 — Sort

**Goal:** sort dropdown drives album order.

**Tests first:**

- **Add/extend** `space-albums-controls.spec.ts`: sort dropdown lists the six options; selecting one
  writes `sortBy`/`sortOrder` to the space store (not the global one).
- **Extend** `space-albums-list.spec.ts`: correct ordering for **each** option — Title (asc/desc), Item
  count, Date created, Date modified, **Most recent photo = `endDate`**, **Oldest photo = `startDate`**;
  **albums with null dates sort last** (deterministic) under date sorts; stable order for equal keys.

**Implementation:** sort dropdown in controls; apply `sortAlbums` in the list; store `sortBy`/`sortOrder`.

**Exit criteria:** web unit + check + lint green; sorting works.

---

### Slice 4 — Group by + collapse/expand

**Goal:** group dropdown (None / Year / Linked by / Owner) with collapse/expand.

**Tests first:**

- **Extend** `space-albums-controls.spec.ts`: group dropdown lists **None/Year/Linked by/Owner**; `Year`
  disabled under Date-created/modified sort; collapse/expand buttons only shown when grouping ≠ None and
  write the space store.
- **Extend** `space-albums-list.spec.ts`: None → flat; Year → correct buckets **(by `startDate` under
  Oldest-photo sort, else `endDate`)** + **"No date"** bucket for date-less albums; Owner → owner-name
  buckets; Linked by → member-name buckets, with **"Unknown"** for null `addedById` **and** for an
  `addedById` not in the current members (linker left the space); `groupOrder` direction respected;
  collapsing a group hides its cards; expand/collapse-all toggles all; state in the space store only.
- **Extend** store spec: fork collapse/expand/toggle mutators mutate only the space store.

**Implementation:** group dropdown + collapse/expand buttons in controls; fork bucketing in the list
(replicating the Year rule from `AlbumsList`, plus Owner/Linked-by); `SpaceAlbumGroupBy` enum + fork
collapse/expand mutators + group metadata in the store; collapse state in `space-albums-table.svelte`;
`en.json` group labels + "Unknown"/"No date".

**Exit criteria:** web unit + check + lint green; grouping + collapse work.

---

### Slice 5 — Search

**Goal:** search box filters the list; distinct empty vs. no-results states.

**Tests first:**

- **Extend** `space-albums-controls.spec.ts`: search input binds `searchQuery`.
- **Extend** `space-albums-list.spec.ts`: filters by name (case-insensitive substring) and `description`;
  **null `description` doesn't throw**; 0 matches → "No matching albums" (distinct from the 0-albums
  empty state); clearing the query restores the full list; search composes with active sort/group.

**Implementation:** `SearchBar` in controls; filter in list; bind `searchQuery` in `+page.svelte`;
`en.json` (placeholder, "No matching albums").

**Exit criteria:** web unit + check + lint green; search works.

---

### Slice 6 — Create + Link toolbar (+ role gating)

**Goal:** Create (create → link → navigate, with failure handling) and Link buttons, gated to editor+;
viewer read-only.

**Tests first:**

- **Extend** `space-albums-controls.spec.ts`: editor sees Create + Link; **viewer sees neither** but
  still sees search/sort/group/view; Create click invokes the handler, Link click opens the modal.
- **Extend** `space-albums-page.spec.ts`: create+link happy path → creates via `createAlbum` (empty
  name), links, navigates to `/spaces/{spaceId}/albums/{newId}`, reloads; **create-succeeds /
  link-fails → toast + no navigation + reload**; viewer role hides Create/Link; **an abandoned empty
  created album is NOT auto-deleted** (documents §4.1's decision).

**Implementation:** Create + Link buttons + editor gate in controls; create+link handler (reusing
`createAlbum`, then `linkAlbum`, then space-route `goto`) + toast + reload in `+page.svelte`; `en.json`
"Create album".

**Exit criteria:** web unit + check + lint green; creating an album in a space works.

---

### Slice 7 — E2E web journeys + final verification gate

**Goal:** Playwright coverage of the whole tab + final full-gate sweep + i18n complete.

**Tests first (Playwright journeys against a seeded space with several linked albums):**

- Search narrows the grid; clearing restores it.
- Changing sort reorders cards.
- Group-by renders headers (Year, Linked by, Owner); collapse hides a group.
- View toggle switches cover ↔ list (list rows link to the space album route).
- **Create album** → new album appears and lands on the space album route; **Link existing** modal
  still works.
- Viewer sees no Create/Link controls but can search/sort/group.

**Implementation:** extend `e2e/src/specs/web/spaces-albums.e2e-spec.ts`; finalize `en.json`; re-sync
SDK/openapi/sql if anything drifted.

**Exit criteria:** `cd e2e && pnpm test:web` green; the full cross-cutting gate (§10) green.

---

### Slice 8 — Consistency: reorder the `/albums` toolbar to match (upstream)

**Goal:** bring the main albums page into the same functional-split arrangement so `/albums` and the
space page read identically. **Independent of Slices 1–7**; sequenced last so the space feature isn't
blocked, but may be done anytime.

**Scope:** `web/src/routes/(user)/albums/AlbumsControls.svelte` — **reorder only**: move the "Create
album" button (currently between search and Sort, `:130‑139`) to the right-hand end (after the
Cover/List toggle, `:199‑219`), leaving the All/Owned/Shared filter + search on the left and
Sort/Group/collapse/view in the middle. No behavior, prop, or option changes. `en.json` untouched.

**Tests first:**

- If the `AlbumsControls`/albums-page test asserts control **presence**, confirm it still passes; if it
  asserts DOM **order**, update it to the new order first (red), then reorder the markup (green).
- **Add/extend** a test asserting the Create button renders **after** the view-toggle control in the DOM.
- Verify no regression to Create-album behavior (still calls `createAlbumAndRedirect`).

**Edge cases:** filter tabs + search stay left-aligned; the mobile fallback (`xl:hidden` block in
`albums/+page.svelte`) is unaffected; keyboard tab-order follows the new visual order.

**Exit criteria:** `cd web && pnpm test` + `check:typescript` + lint green; `/albums` matches the space
page's control order; upstream diff limited to the reorder.

## 9. Consolidated edge-case checklist (each must have a test)

| #   | Edge case                                                                            | Slice                          |
| --- | ------------------------------------------------------------------------------------ | ------------------------------ |
| 1   | 0 linked albums → empty CTA, controls hidden                                         | 2                              |
| 2   | Albums exist but search → 0 results → "No matching albums"                           | 5                              |
| 3   | Album with 0 assets → `assetCount:0`, dates null                                     | 1                              |
| 4   | Soft-deleted album excluded                                                          | 1                              |
| 5   | Album owned by another member → Owner grouping + `showOwner`                         | 1, 4                           |
| 6   | Shared album (`shared:true`, multiple `albumUsers`)                                  | 1                              |
| 7   | Null `addedById` → "Unknown" bucket                                                  | 1, 4                           |
| 8   | `addedById` set but linker no longer a space member → "Unknown"                      | 4                              |
| 9   | Year group with date-less albums → "No date" bucket                                  | 4                              |
| 10  | Year bucket uses `startDate` under Oldest-photo sort, else `endDate`                 | 4                              |
| 11  | `Year` group disabled under date-created/modified sort                               | 4                              |
| 12  | `MostRecentPhoto`=`endDate`, `OldestPhoto`=`startDate` sort                          | 3                              |
| 13  | Null-date albums sort last (deterministic) under date sorts                          | 3                              |
| 14  | Null `albumThumbnailAssetId` → `AlbumCover` `NoCover` fallback                       | 1, 2                           |
| 15  | Null `description` in search → no throw                                              | 5                              |
| 16  | Create succeeds + link fails → toast, no navigation, reload                          | 6                              |
| 17  | Abandoned empty created album not auto-deleted (documented)                          | 6                              |
| 18  | Space view settings isolated from global (both directions)                           | 2                              |
| 19  | Deterministic server ordering (`ORDER BY`, no flaky medium/e2e)                      | 1                              |
| 20  | Member (viewer) can READ the enriched list; write ops (link/create) gated to editor+ | 1 (read+write server), 6 (web) |
| 21  | Existing unlink + show-in-timeline card actions still work                           | 2                              |
| 22  | List-mode rows route to `/spaces/{id}/albums/{id}` (not `/albums/{id}`)              | 2                              |
| 23  | Album `createdAt` distinct from link `linkedAt`                                      | 1                              |
| 24  | N+1 removed (single `getMetadataForIds` call, `getAlbumAssetCount` never)            | 1                              |
| 25  | `/albums` reorder: Create renders after the view toggle; existing tests pass         | 8                              |

## 10. Cross-cutting verification gate (final)

- `cd server && pnpm test` (+ medium spec), `pnpm check`, `pnpm lint`.
- `cd web && pnpm test`, `pnpm check:typescript`, `pnpm lint`.
- `cd e2e && pnpm test` (API) and `pnpm test:web` (Playwright).
- OpenAPI + SQL: server DTO/query changed → `pnpm build` + `pnpm sync:open-api` +
  `make open-api-typescript` (SDK `SharedSpaceLinkedAlbumDto` gains the new fields); **`make sql`
  required** (with a running DB — `getLinkedAlbums` is `@GenerateSql`), regenerating
  `server/src/queries/shared.space.repository.sql`.
- Per `feedback_impl_loop_subagent_gaps_vs_gates`: the controlling session runs the **full** gate itself
  — subagent "green" reports are not sufficient.

## 11. Rebase safety summary

| Layer                                   | Files                                                                     | Upstream?                                               |
| --------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| Server DTO / repo / service / query SQL | `shared-space.*`, `queries/shared.space.repository.sql`                   | **Fork-only** ✅                                        |
| Web orchestration + store               | `space-albums-*.svelte`, `space-album-view-settings.store.ts`             | **Fork-only** ✅                                        |
| Web page / card                         | `spaces/[spaceId]/albums/*`, `space-album-card.svelte`                    | **Fork-only** ✅                                        |
| Reused leaves/helpers                   | `AlbumCover`, `album-utils.ts` (helpers), `mapAlbum`, `getMetadataForIds` | Upstream — **imported, not edited** ✅                  |
| Strings                                 | `en.json`                                                                 | Shared — additive only ⚠️                               |
| `/albums` toolbar reorder (Slice 8)     | `AlbumsControls.svelte`                                                   | Upstream — **edited: deliberate, localized reorder** ⚠️ |

## 12. Open decisions (resolved)

- Create vs. Link → **both, side by side** (create auto-links + opens).
- Group-by → **None / Year / Linked by / Owner**.
- Sort → **mirror main page** (Title, ItemCount, DateModified, DateCreated, MostRecentPhoto,
  OldestPhoto).
- Architecture → **fork-isolated reuse** (§3): reuse the sort/group logic + server mapping + `AlbumCover`;
  fork the toolbar, list, table rows/headers, and cards (the upstream ones are coupled to the global
  store / hardcoded personal routing).
- View settings → **space-scoped store**, isolated from the main page.
- Field naming → keep `addedById` (UI label "Linked by"); rename link timestamp `createdAt` →
  `linkedAt`; use inherited `id`, drop `albumId`.
- Empty-album on create → match `/albums` (empty name, name on detail page); **no auto-delete** in the
  space (§4.1).
- Toolbar layout → **functional split on both pages** (shape-the-view controls left; add-album action(s)
  as the primary CTA cluster right); Create = filled primary, Link = secondary; standalone "N albums"
  count dropped (space page only). `/albums` is reordered to match (Slice 8 — a deliberate, localized
  upstream edit); the space page uses the same control **style** (with space-specific Linked-by grouping
  - Link action, and no filter tabs).

## 13. Running via `/impl-loop`

This spec is structured for `/impl-loop` (§8 slices are numbered and independently testable). The loop:
review this spec → for each slice create a plan under `docs/superpowers/plans/` via
`superpowers:writing-plans` → review the plan against this spec → execute with
`superpowers:subagent-driven-development` (red→green evidence required) → push → babysit CI.

**Model policy** (the local `impl-loop` skill was updated 2026-07-05): controller session on **Opus
4.8**; implementation subagents on **Sonnet 4.6** by default; **Opus 4.8** for the final
spec-compliance / code-quality review gate or a hard escalation. Specs and plans are authored by the
Opus controller, never a subagent.
