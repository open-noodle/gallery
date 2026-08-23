# Unified album + space picker from the timeline

**Date:** 2026-06-16
**Status:** Approved design — ready for implementation plan
**Area:** `web/` (frontend only — no server, SDK, or DB changes)

## Problem

When a user selects photos in the timeline and presses the **"+"** ("Add to album")
button, the picker lists **albums only**. Shared spaces — a first-class,
fork-only way to collect photos — are reachable only through the command palette
or a space's own page. Users who think of a space as "just another place to put
photos" can't add to one from the place they most naturally would.

We want the timeline picker (and the equivalent single-photo action) to show
**albums and spaces in one list**, with a clear visual differentiator so that an
album and a space with the same name are never confused.

## Goals

- One picker lists both albums and writable spaces, searchable together.
- A per-row visual differentiator (badge on the thumbnail) distinguishes albums
  from spaces — robust even for identically-named items.
- Preserve **everything** the album picker does today: search, "Recent"
  section, inline "New album" creation, `Ctrl`-click multi-select, keyboard
  navigation, and the keyboard-hint footer.
- Add inline **"New space"** creation alongside "New album".
- `Ctrl`-click multi-select works **across types** — any mix of albums and
  spaces added in one action.
- A larger modal so more rows are visible without scrolling.

## Non-goals

- No backend, SDK, or schema changes. Adding assets to spaces
  (`POST /shared-spaces/:id/assets`) and to albums already exist and are reused
  as-is.
- No change to how spaces are created in full (members, color, libraries). Inline
  "New space" creates a name-only space; richer setup stays on the space page.
- No change to the space detail page's own "Add photos to this space" flow.
- No mobile (Flutter) changes — this is the web timeline picker only.

## Current behavior (what exists today)

**Albums (upstream Immich files):**

- Timeline "+" → `getAssetBulkActions` `AddToAlbum` action
  (`web/src/lib/services/asset.service.ts:65`, shortcut `l`, icon `mdiPlus`) →
  opens `AssetAddToAlbumModal`.
- Single-photo viewer → a second `AddToAlbum` action in the same file
  (`asset.service.ts:167`, used at `:321`) → same modal with one asset id.
- `AssetAddToAlbumModal.svelte` wraps `AlbumPickerModal.svelte` and, on close,
  calls `addAssetsToAlbums(albumIds, assetIds, { notify })`
  (`web/src/lib/services/album.service.ts:95`).
- `AlbumPickerModal.svelte` loads `getAllAlbums({shared:false})` +
  `getAllAlbums({shared:true})`, builds rows via `AlbumModalRowConverter`
  (`web/src/lib/components/shared-components/album-selection/album-selection-utils.ts`),
  renders `NewAlbumListItem` + `AlbumListItem`, supports `Ctrl` multi-select,
  arrow/enter keyboard nav, and a `size="small"` modal with `max-h-100` list.
- `addAssetsToAlbums` calls `addAssetsToAlbum` for a single album (per-asset
  `BulkIdResponseDto`, distinguishes duplicates) or `addAssetsToAlbums` for many,
  toasts a summary with a "View album" button, and emits `AlbumAddAssets`.

**Spaces (fork-only files):**

- `SpacePickerModal.svelte` loads `getAllSpaces()`, filters to **writable**
  (Owner/Editor) spaces, simple search + keyboard nav, returns one space.
- `AssetAddToSpaceModal.svelte` wraps it and calls
  `addAssetsToSpace(spaceId, assetIds, { notify })`
  (`web/src/lib/services/space.service.ts:10`) → `addAssets` SDK →
  toasts with a "View space" button and emits `SpaceAddAssets`.
- Surfaced only via the command palette `handleAddSelectedToSpace`
  (`web/src/lib/managers/selection-command-handlers.ts:66`) and on space pages.
- `MAX_SPACE_ASSETS_PER_REQUEST = 10_000` (`web/src/lib/constants.ts:77`).
- `SharedSpaceResponseDto` carries everything the row needs: `name`, `color`,
  `recentAssetThumbhashes` / `recentAssetIds` (for the collage cover),
  `memberCount`, `assetCount`, `lastActivityAt`, `members`, `createdById`.

So the data path for both is complete. This feature is a **frontend
presentation merge**, not new plumbing.

## Design

### Visual (approved mockup)

A single modal titled **"Add to album or space"**:

```
┌───────────────────────────────────────────┐
│ ◐ Add to album or space                  ✕ │
├───────────────────────────────────────────┤
│  Search                                     │   ← search input (existing style)
│                                             │
│  +  New Album                               │   ← create rows, both always shown
│  +  New Space                               │
│                                             │
│  RECENT                                     │   ← hidden when searching
│  [img]⊞ USA Trip            216 items       │   ← album: blue photo-stack badge
│  [img]⊞ Sicily trip 2024    1,085 items     │
│  [▦▦]◔ Family Trip   4 members · 320 items  │   ← space: pink people badge + collage
│                                             │
│  ALL                                        │
│  … alphabetical, albums + spaces …          │
├───────────────────────────────────────────┤
│  [Add to 2]   (shown only when multi-select)│
│  ↵ to select      CTRL to multi-select      │   ← footer hint (existing)
└───────────────────────────────────────────┘
```

- **Album rows** carry a small blue photo-stack badge on the bottom corner of
  their (single) thumbnail and read `N items` (today's `AlbumListItem`).
- **Space rows** carry a small pink people badge and a 4-tile collage cover
  built from `recentAssetThumbhashes`; subtitle reads
  `N members · N items` (or just `N members` when the count is unknown).
- The badge is always visible (survives search), so a same-name
  "Tuscany 2024" album/space pair is unambiguous at a glance.
- Modal grows from `size="small"` to `size="medium"` and the list container's
  `max-h-100` is raised so more rows show before scrolling.

### Architecture — keep spaces logic in fork-only files

The album picker, its row item, its row-converter, and `album.service.ts` are
**upstream Immich** files; spaces are **fork-only**. To keep the upstream rebase
path clean (per `CLAUDE.md`), we do **not** rewrite the upstream album picker to
know about spaces. Instead we add a thin fork-only **collection** layer that
composes the existing pieces.

New fork-only files (`web/src/lib/...`):

| File                                                                | Responsibility                                                                                                                                                                                                                |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modals/CollectionPickerModal.svelte`                               | The unified modal: loads albums + writable spaces, builds rows, renders create rows + collection rows, owns search / multi-select / keyboard nav, larger size. Returns the chosen collection(s).                              |
| `modals/AssetAddToCollectionModal.svelte`                           | Wrapper: receives `assetIds`, shows `CollectionPickerModal`, on close splits the selection by type and dispatches adds (see below). Replaces both `AssetAddToAlbumModal` and `AssetAddToSpaceModal` as the entry-point modal. |
| `components/.../collection-selection/collection-selection-utils.ts` | `CollectionModalRowConverter` + types: the fork analogue of `AlbumModalRowConverter`, producing a unified row list (create rows, RECENT, ALL, messages) over a discriminated `PickerCollection` union.                        |
| `components/.../collection-selection/space-list-item.svelte`        | Space row: collage cover (thumbhashes) + name (with search highlight) + `members · items` subtitle + multi-select checkmark, mirroring `AlbumListItem`'s interaction affordances.                                             |

Reused as-is or near-as-is:

- `NewAlbumListItem` (the "+ New Album" row) — reused unchanged. A sibling
  **`NewSpaceListItem`** (or a `kind` prop on a generalized component) renders
  "+ New Space"; it is a trivial copy differing only in label/handler.
- `AlbumListItem` renders album rows. To place the **badge on the album
  thumbnail**, add a single **optional, additive** prop (e.g. `badgeIcon?:
string`) defaulted to undefined so existing upstream callers are unaffected.
  This is the one small upstream touch; the alternative (a fully duplicated
  fork album-row component) avoids it entirely at the cost of duplicating the
  longpress / search-highlight / checkmark logic. **Recommendation: the additive
  prop** — smallest rebase footprint, no logic duplication. The implementation
  plan should confirm the prop threads cleanly through `AlbumListItemDetails`.
- `addAssetsToAlbums` (album.service) and `addAssetsToSpace` (space.service)
  are the add primitives — unchanged.

The discriminated union the fork layer works in:

```ts
type PickerCollection =
  | { kind: 'album'; id: string; name: string; album: AlbumResponseDto }
  | { kind: 'space'; id: string; name: string; space: SharedSpaceResponseDto };
```

### Data loading

On mount, in parallel:

- Albums: `getAllAlbums({shared:false})` + `getAllAlbums({shared:true})` (as today).
- Spaces: `getAllSpaces()`, then filter to **writable** spaces using the same
  Owner/Editor predicate `SpacePickerModal` uses today (`createdById === me` or
  member role ∈ {Owner, Editor}).

Both loads run under a single `Promise.allSettled`; the skeleton shows until both
settle (no flash of an albums-only list that spaces then shove around). A failure
loading one type degrades gracefully: render the other, surface a non-blocking
error toast for the failed one (reuse `failed_to_load_spaces`; albums already
toast via `handleError`). If **both** fail, the list is empty but the two create
rows remain.

**Search normalization is unified.** Both album and space names are filtered and
highlighted with the same `normalizeSearchString` util the album row uses today
(diacritic- and case-insensitive). The current `SpacePickerModal` uses a plainer
`toLowerCase().includes`; the unified converter must standardize on
`normalizeSearchString` so "Tuscany" matches "Tüscany" for spaces too — otherwise
search behaves inconsistently across the two types in one list.

### Row order

- **Create rows** "New Album" then "New Space" are pinned at the top, always.
- **RECENT** (only when search is empty): the 3 most-recently-active collections
  across both types, by `album.updatedAt` vs `space.lastActivityAt` (falling back
  to the space's `updatedAt`/`createdAt` when null). Mirrors today's 3-item recent
  albums, now interleaved.
- **ALL** (`ALL` when no search, results when searching): albums + writable
  spaces merged, sorted **case-insensitively by name ascending**. Alphabetical
  ordering is a deliberate choice: it is predictable and places same-name
  album/space pairs adjacent, showcasing the badge differentiator. (Today's
  album-only sort preference does not generalize cleanly to a mixed list; RECENT
  already covers recency.)
- When searching, both create rows become "New Album **<query>**" / "New Space
  **<query>**" exactly as the album row does today.
- **Create-name validation differs by type.** "New Album" with an empty search
  creates an unnamed album today (server allows it) — keep that behavior. A
  **space name is required** (server schema: 1–100 chars), so "New Space" with an
  empty/whitespace search must be guarded: the row is non-actionable until the
  search box has a non-empty name (and the name is sent trimmed). Over-long names
  (>100) are clamped/blocked client-side to avoid a 400. This asymmetry is
  deliberate, not an oversight.
- Empty states: no matches → message "No albums or spaces with that name"; truly
  empty library → message but create rows still present.

### Selection, multi-select, and keyboard

Generalize the existing `AlbumPickerModal` interaction model:

- Selectable rows = New Album, New Space, and every collection row.
- Plain click on a collection (no multi-select active) → confirm immediately with
  that one collection.
- `Ctrl`-click (or longpress on touch) toggles a collection into the multi-select
  set, keyed by `{kind, id}`. The set may freely mix albums and spaces.
- While multi-select is active, an **"Add to {count}"** button appears (replacing
  today's "Add to albums ({count})"); clicking it confirms the whole set.
- Arrow up/down move a focus index across selectable rows; `Enter` confirms the
  focused row (or submits the multi-select set if active); `Ctrl` toggles the
  focused row — same shape as today, extended to the unified row list. **Note the
  focus-index offset changes: today's converter hard-codes a single create-row
  offset of 1; the unified converter has _two_ create rows, so the offset is 2.**
  This is the most likely off-by-one regression and must be pinned by a converter
  test.
- **Over-cap hides spaces.** When the asset selection exceeds
  `MAX_SPACE_ASSETS_PER_REQUEST` (10,000), spaces and the "New Space" row are
  omitted from the list entirely and a one-line notice explains why; albums stay
  fully usable (they have no equivalent cap). Hiding rather than disabling keeps
  the keyboard-offset math simple, and a >10k timeline selection is a rare safety
  valve. In this state the create-row offset is 1 (only "New Album"); the
  converter takes the cap state as input so this is covered by a converter test.
- **Double-submit guard.** Once a confirm/add is dispatched, the confirm button
  and rows are disabled until the add promise settles, so a fast second click or
  `Enter` cannot fire a duplicate add.
- Footer hint ("↵ to select · CTRL to multi-select") is preserved.

### Add dispatch (the wrapper)

`AssetAddToCollectionModal` receives the chosen `PickerCollection[]` and splits
into `albumIds` and `spaceIds`, then:

- **Exactly one album** → `addAssetsToAlbums([albumId], assetIds, {notify:true})`
  — preserves today's rich per-asset toast with duplicate handling + "View album".
- **Exactly one space** → `addAssetsToSpace(spaceId, assetIds, {notify:true})`
  — preserves today's toast + "View space".
- **Any multi / mixed selection** → call each primitive with `{notify:false}`,
  `await` **all** with `Promise.allSettled` (one slow/failing target must not
  abort the others), then show **one aggregate success toast** "Added to {count}
  collections" (new key) where `count` = collections that succeeded. The aggregate
  toast has **no** "View" button (there is no single target to navigate to) — the
  per-target "View album/space" button only appears in the single-selection paths
  above. When **nothing** succeeds, no aggregate toast is shown.

Failures surface through each primitive's own error toast. `addAssetsToAlbums` /
`addAssetsToSpace` call `handleError` unconditionally on failure (it is **not**
gated by `notify` — only the _success_ toast is), so a failed target already
tells the user exactly what failed. The aggregate therefore reports successes
only and does **not** add a redundant "M of N" warning, which would double-toast.

Events stay correct under partial failure: each primitive emits its event
(`AlbumAddAssets` / `SpaceAddAssets`) **only on its own success** (they emit then
return `true`, or call `handleError` and return `false` on error), so the UI never
reacts to an add that didn't happen.

This keeps the familiar single-target experience and adds a coherent summary for
the new mixed case, rather than firing N separate toasts.

The 10,000-asset space cap is enforced at the **selection** layer (over-cap space
rows are non-selectable — see above), so the dispatch never builds a space call
that exceeds it. The dispatch still defensively skips any space target whose asset
count is over the cap rather than throwing.

### Entry points to repoint

1. `asset.service.ts:65` (`getAssetBulkActions` `AddToAlbum`, timeline "+") →
   open `AssetAddToCollectionModal`. Keep icon `mdiPlus`, shortcut `l`. The
   action/title may be renamed to "Add to album or space".
2. `asset.service.ts:167` / `:321` (single-photo viewer `AddToAlbum`) →
   `AssetAddToCollectionModal` with the single asset id.
3. Command palette (`selection-command-handlers.ts`): point
   `handleAddSelectedToAlbum` **and** `handleAddSelectedToSpace` at
   `AssetAddToCollectionModal`, so searching either "album" or "space" opens the
   unified picker. `canAddSelectedToAlbum` / `canAddSelectedToSpace` predicates
   and the separate "add to current space" command are unchanged.

`AssetAddToAlbumModal` and `AssetAddToSpaceModal` become unused by these paths;
leave them in place only if some other caller still needs them (a grep at
implementation time confirms — current greps show no other callers), otherwise
remove to avoid dead code.

### i18n

New keys (add to `i18n/en.json`; because these are **fork-only** strings, also
add **German and French** translations per project convention):

- `add_to_album_or_space` → "Add to album or space" (modal + action title)
- `new_space` → "New Space"
- `all_albums_and_spaces` → "All" (the ALL section header for the merged list)
- `add_to_collections_count` → "Add to {count}" (multi-submit button)
- `added_to_collections_count` → "Added to {count, plural, one {# collection} other {# collections}}"
- `no_albums_or_spaces_with_name` → "No albums or spaces with that name"
- `no_albums_or_spaces_yet` → "You don't have any albums or spaces yet"
- `spaces_hidden_too_many_assets` → "Spaces are hidden — too many photos selected (max {count})" (over-cap notice)

Reuse existing keys where possible: `new_album`, `recent`, `to_select`,
`to_multi_select`, `view_space`, `view_album`, `failed_to_load_spaces`,
`spaces_no_writable_spaces`.

All new keys are **fork-only strings**, so each must also get German (`de.json`)
and French (`fr.json`) entries per project convention, and stay in the same
alphabetical position the repo's i18n lint expects.

## Error handling & edge cases

Every row below must be addressed by the implementation; the **Addressed by**
column points at the test or design decision that covers it.

| Edge case                                           | Behavior                                                                                                                                                              | Addressed by                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Albums load fails                                   | Render spaces only + error toast                                                                                                                                      | `Promise.allSettled` load; converter test with empty albums |
| Spaces load fails                                   | Render albums only + `failed_to_load_spaces` toast                                                                                                                    | same                                                        |
| Both load fail                                      | Empty list, create rows still present                                                                                                                                 | converter test: no albums + no spaces                       |
| User has **no writable spaces**                     | Albums only; "New Space" row still present (lets them create their first)                                                                                             | converter test                                              |
| User has spaces but **all read-only** (Viewer)      | Same as none-writable                                                                                                                                                 | writable-filter unit test                                   |
| Space with **< 4 thumbhashes** (or 0)               | Collage fills available tiles; missing tiles render a neutral placeholder (no broken/empty grid)                                                                      | space-list-item render test (0, 1, 4 thumbhashes)           |
| Space missing `assetCount`                          | Subtitle shows "N members" only, no "· N items"                                                                                                                       | space-list-item render test                                 |
| **Same name, album vs space**                       | Both rows show; badges + collage disambiguate                                                                                                                         | converter test asserts both present with distinct `kind`    |
| **Same name within one type** (two albums "Family") | Pre-existing behavior unchanged; badge does **not** disambiguate same-type dupes (out of scope)                                                                       | noted; no regression                                        |
| Selection **> 10,000 assets**                       | Spaces + "New Space" hidden with a one-line notice; albums unaffected; dispatch defensively skips over-cap spaces                                                     | converter test + dispatch test                              |
| Duplicate assets already in album                   | Single-album path keeps duplicate-aware toast; aggregate counts as success                                                                                            | dispatch unit test                                          |
| Duplicate assets already in space                   | Server `onConflict doNothing`; space add is **not** per-asset duplicate-aware, so toast says "added" (no dup breakdown) — acceptable, documented                      | dispatch unit test                                          |
| Adding **non-owned/partner assets** to a space      | Server enforces `AssetRead`; a forbidden asset fails the whole space call → error toast for that target                                                               | dispatch error-path test                                    |
| "New Space" with empty/whitespace name              | Row non-actionable until a name is typed; name sent trimmed                                                                                                           | create-guard unit test                                      |
| "New Space" name > 100 chars                        | Clamped/blocked client-side before the call                                                                                                                           | create-guard unit test                                      |
| Rapid double confirm / `Enter`                      | Disabled-while-pending guard prevents duplicate add                                                                                                                   | component test                                              |
| Mixed add, one target fails                         | Other targets still complete (`allSettled`); failed target's own error toast fires; aggregate success toast counts only successes; only succeeded targets emit events | dispatch partial-failure test                               |
| Two create rows shift keyboard offset               | Focus index offset = 2, not 1                                                                                                                                         | converter focus-offset test                                 |
| Touch device                                        | Longpress toggles multi-select on both album and space rows                                                                                                           | component/touch test                                        |

## Testing

**This feature is built test-first (TDD).** Each unit below starts as a failing
test that pins the behavior, then the implementation makes it pass, then refactor
— per `superpowers:test-driven-development`. The implementation plan
(`writing-plans` step) sequences the work as test → code → refactor slices, not
code-then-test. The pure logic (`CollectionModalRowConverter`, the add-dispatch
splitter) is extracted specifically so it can be tested without DOM, and is
written before any Svelte wiring. No implementation task is "done" without its
test green and the full `web` suite + `pnpm check` passing.

The tables above are the source of truth: **every edge-case row maps to a named
test here.**

**Unit — `CollectionModalRowConverter` (`web`, vitest), no DOM:**

- Create rows ("New Album", "New Space") always present and always first.
- `kind` discrimination: an album and a space with the same name both appear,
  each tagged with the correct `kind` and `id`.
- RECENT: interleaves both types by recency (`updatedAt` / `lastActivityAt`),
  capped at 3; hidden when a search is active; recency tie-break is deterministic.
- ALL: merged albums + writable spaces sorted case-insensitively by name asc;
  same-name pairs land adjacent.
- Search: filters **both** types via `normalizeSearchString` (diacritic/case
  insensitive — explicit "Tüscany" vs "Tuscany" case); create rows reflect the
  query.
- **Focus-index offset = 2** (two create rows) — guards the off-by-one.
- Messages: no-match → "No albums or spaces with that name"; empty library →
  empty-library message, create rows still present.
- Writable filter: Owner/Editor included, Viewer excluded, creator always
  included (mirrors `SpacePickerModal`).
- Create-name guard: "New Space" not actionable on empty/whitespace; name > 100
  blocked; album empty-name still allowed.

**Unit — add-dispatch splitter (`web`, vitest):**

- Single album → `addAssetsToAlbums([id], …, {notify:true})`, no aggregate toast.
- Single space → `addAssetsToSpace(id, …, {notify:true})`, no aggregate toast.
- Mixed multi → each primitive called with `{notify:false}`; one aggregate toast
  with the success count; no "View" button.
- Partial failure (one target rejects) → others still called (`allSettled`);
  warning toast "M of N"; only succeeded targets' events asserted emitted.
- Over-cap space target skipped defensively; album in the same set still added.

**Component — `space-list-item.svelte` (@testing-library/svelte, happy-dom):**

- Renders the pink people badge; album row renders the blue photo-stack badge.
- Collage with 0, 1, and 4 thumbhashes (placeholder tiles for the missing ones).
- Subtitle: "N members · N items", and "N members" when `assetCount` is absent.
- Search-term highlight on the space name (same 3-part split as `AlbumListItem`).
- Multi-select checkmark toggles via click and via longpress (touch).
- a11y: `role="checkbox"` + `aria-checked` on the select affordance; row is a
  button with an accessible name.

**Component — `CollectionPickerModal.svelte`:**

- `Ctrl`-click selects a mix of one album + one space; "Add to {count}" button
  appears and submits the mixed set.
- Keyboard arrow/enter nav traverses create rows + collection rows correctly
  (exercises the offset-2 path end-to-end).
- Over-cap selection disables space rows + "New Space" while albums stay active.
- Disabled-while-pending: a second `Enter`/click during the in-flight add is a
  no-op.
- Both-loads-fail and one-load-fails render states.

**E2E — Playwright web (`e2e`, _recommended, not optional_):** this changes a
core, high-traffic timeline flow, so it warrants a browser test. From the
timeline, select photos → "+" → (a) add to an existing album, (b) add to an
existing space, (c) `Ctrl`-select one of each and add to both; assert the toast,
that the assets actually land in the album and the space (via API), and that a
same-name album/space pair is visually distinguishable. Also assert the
single-photo viewer "+" opens the same unified picker.

## Approaches considered

- **Evolve the upstream album picker in place** to also handle spaces. Rejected:
  heavy edits to upstream `AlbumPickerModal` / `AlbumListItem` /
  `album-selection-utils` / `album.service` create recurring rebase conflicts and
  leak fork-only concepts into upstream files.
- **Grouped sections (Albums / Spaces headers) instead of badges.** Rejected by
  the user during brainstorming: a mixed search result shows both headers and the
  per-row identity is what matters for same-name collisions. Badges win;
  grouping can be revisited as a future enhancement.
- **Fork-only collection layer composing existing pieces** (chosen): isolates
  fork code, reuses album-row interaction logic, one tiny additive upstream prop.

## Out of scope / future

- Sorting controls for the unified "ALL" list (respecting per-type sort prefs).
- Showing read-only spaces (greyed, non-selectable) for discoverability.
- Mobile parity (Flutter) for the unified picker.
