# Space album drill-down in the web sidebar

**Date:** 2026-07-20
**Discussion:** [#816](https://github.com/open-noodle/gallery/discussions/816)
**Related:** [#817](https://github.com/open-noodle/gallery/issues/817) (pre-existing `getAll` N+1, deliberately out of scope)

## Problem

Albums shared into a Space are not discoverable from the left sidebar. In discussion #816, bdillahu reports that a newly shared album never appears anywhere in the navigation and argues that nesting albums under Spaces would be "more obvious and similar to how the rest already works."

Two distinct gaps produce this:

1. **No drill-down.** The sidebar's Spaces dropdown lists spaces only. There is no affordance to reach a space's linked albums.
2. **No promotion.** `linkAlbum` (`server/src/services/shared-space.service.ts:734`) does not bump the space's `lastActivityAt`, unlike `addAssets` (`:675`) and the bulk-add job (`:2481`). The sidebar sorts spaces by `lastActivityAt` descending and slices to three (`web/src/lib/components/shared-components/side-bar/recent-spaces.svelte:33-39`), so a space receiving a freshly shared album does not move at all.

Fixing only the first leaves the feature invisible on a quiet space, which is the exact case in the discussion. Both are in scope.

## Solution overview

Render up to three linked albums beneath each space in the sidebar, behind a chevron that appears only on spaces that actually have linked albums, and make album linking count as space activity.

Target appearance:

```
⌄ 👥 Spaces
    › 🖼  Apple Photos Export
    ⌄ ●  02 Film Scans
         📁 Wedding Rolls        ← most recently linked
         📁 Negatives 1998
         📁 Barn Slides
         See all (8) →
      ●  04 FBC Jonesboro       ← no linked albums, no chevron
🔍 Explore
```

### Decisions

| Decision           | Choice                              | Rationale                                                                                             |
| ------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Default expansion  | Collapsed, persisted per space      | Keeps the sidebar calm; three spaces × three albums would otherwise push Explore/Map/People far down  |
| Album ordering     | `linkedAt` descending               | A newly shared album lands at the top of the drill-down — the discoverability the discussion asks for |
| Overflow           | "See all (N)" when `albumCount > 3` | A silent cut gives no cue that more exist                                                             |
| Chevron visibility | Only when `albumCount > 0`          | No empty disclosure triangles                                                                         |
| Album count source | New `albumCount` on the space DTO   | Chevron correct on first paint, no request-driven pop-in                                              |
| Album detail fetch | Lazy, on first expand               | Collapsed-by-default means most sessions never fetch it                                               |

### Approaches considered

**A. `albumCount` on the DTO plus lazy album fetch (chosen).** One reusable field added to a response the sidebar already loads; album detail deferred to actual drill-down.

**B. Web-only, N requests on mount.** No server change, but three extra round-trips per page load purely for nav chrome, and chevrons pop in after they resolve — visible layout shift on the most-looked-at element on the page.

**C. Dedicated `GET /shared-spaces/sidebar` endpoint.** Single request, but bakes the "top 3" UI decision into the API and duplicates `getAllSpaces` semantics.

**D. Embed top-3 albums in `SharedSpaceResponseDto`.** Never needs a second request, but bloats a DTO consumed by mobile and the spaces list page with sidebar-only data, and again encodes "3" in the API.

A was chosen because it adds the smallest genuinely reusable piece of data and defers the expensive part to the rare case.

## Server changes

### `albumCount` on the space DTO

- **`server/src/repositories/shared-space.repository.ts`** — add `getLinkedAlbumCount(spaceId)`: `COUNT(*)` over `shared_space_album` for the space. Decorate with `@GenerateSql` to match neighbouring methods so `make sql` picks it up.
- **`server/src/dtos/shared-space.dto.ts`** — add `albumCount: z.number().optional()` to `SharedSpaceResponseSchema` (~`:79-103`), alongside `memberCount` and `assetCount`. **Optional, not required:** every sibling count (`memberCount`, `assetCount`, `newAssetCount`) is `.optional()`; matching that keeps the serializer contract uniform and generates a nullable Dart field. The web guards with `space.albumCount && space.albumCount > 0`, mirroring the existing `space.newAssetCount && space.newAssetCount > 0` check in `recent-spaces.svelte`.
- **`server/src/services/shared-space.service.ts`** — in `getAll` (`:133-194`), one additional `await` inside the existing per-space loop; populate `albumCount` on the pushed result.

**`albumCount` counts every linked album**, regardless of `showInTimeline`. `showInTimeline` controls only whether an album's assets appear in the aggregated space timeline; it is orthogonal to navigation. The sidebar list (below) applies the same rule, so the count and the rendered list never disagree about which albums "exist" for a space.

**RBAC:** a plain per-space count is correct. `getLinkedAlbums` (`:820-850`) gates on `requireMembership` alone with no per-album filtering, so every member sees every linked album; and `getAll` only returns spaces via `getAllByUserId`. The count cannot reveal albums the viewer is not entitled to see.

**Out of scope:** `getAll` is already a per-space loop of 6+ sequential queries. This change adds a 7th and deliberately does not restructure it — tracked as #817.

### `lastActivityAt` bump on link

`linkAlbum` (`:734`) gains `await this.sharedSpaceRepository.update(spaceId, { lastActivityAt: new Date() })`, matching `addAssets` (`:675`).

**The bump goes inside the existing `if (result)` block** (`:753`), next to the face-sync queue and the activity log. `addAlbum` returns the inserted row only for a genuinely new link and `undefined` for an idempotent re-link (`onConflict().doNothing()`, `shared-space.repository.ts`). Re-linking an already-linked album must **not** promote the space, so the bump belongs where the other new-link side effects already live.

Two deliberate asymmetries:

- **`unlinkAlbum` does not bump.** Removing content is not activity worth promoting a space for.
- **`linkAlbum` already logs an `AlbumLink` activity** (`:755-761`) — this change does **not** touch that. We are adding only the `lastActivityAt` bump, not a new activity-feed row. (An earlier draft of this spec wrongly claimed links write no activity log; they always have.)

### Migration and SDK

No migration — `albumCount` is computed, not stored.

Adding a DTO field requires regeneration: `pnpm build` (server) → `pnpm sync:open-api` → `make open-api`. The full `make open-api` matters; a TypeScript-only regen leaves the Dart client stale and CI fails.

## Web changes

### Rendering

`recent-spaces.svelte` currently emits plain `<a>` rows at hardcoded `ps-10`, each showing a thumbnail square or a colored activity dot. **The chevron is hand-rolled inside `recent-spaces.svelte`, not delegated to `NavbarItem`.** `@immich/ui`'s `NavbarItem` renders its leading slot from an mdi `icon` prop only (`NavbarItem.svelte:19`, `asIconProps`) and indents at `ps-5` — it has no way to show the space thumbnail/dot. Converting space rows to `NavbarItem` would drop that visual and shift indentation, violating "keep their current appearance exactly." So the existing `<a>` space row stays byte-for-byte, and we add a sibling chevron toggle button that mirrors `NavbarItem`'s own chevron (`mdiChevronRight` collapsed / `mdiChevronDown` expanded, `hidden md:block`), rendered **only** when `space.albumCount > 0`. Spaces without albums keep their current appearance exactly.

**Album row visuals** mirror `RecentAlbums.svelte:34-44`: a `size-6` rounded square showing the album cover via `getAssetMediaUrl({ id: album.albumThumbnailAssetId })`, falling back to a gray square when the album has no thumbnail, then the `albumName` truncated. Album rows are indented one level deeper than the space row (`ps-14` vs the space row's `ps-10`), keeping the drill-down visually consistent with the existing Albums section rather than introducing a new icon vocabulary.

**Active state:** each album row sets `aria-current="page"` on an exact-ish match of the album path (`/spaces/{spaceId}/albums/{albumId}`). Because the space row's active check is `page.url.pathname.startsWith('/spaces/${space.id}')`, viewing an album also keeps its **parent** space highlighted — acceptable and desirable (the album lives under that space).

### Expansion state

`preferences.store.ts:157-158` has `recentSpacesDropdown` as a single persisted boolean. Per-space state needs a keyed structure: a persisted `Record<string, boolean>` under `recent-space-albums-open`, defaulting to collapsed for unknown ids. Entries for spaces no longer in the top three are pruned on write so the key does not grow unbounded as spaces churn.

### Fetching

On first expand, call `getSharedSpaceAlbums({ id })` and cache into `userInteraction.spaceAlbums: Record<string, SharedSpaceLinkedAlbumDto[]>`, following the existing `userInteraction.recentSpaces` cache-once pattern (`user.svelte.ts:12`, reset at `:33`). Sort by `linkedAt` descending, slice to three.

Persisted expansion means a returning user re-fetches once per session on mount for already-open spaces. This is accepted: it keeps the list honest rather than serving a stale album set.

### Cache invalidation on link / unlink

**Problem the first draft missed.** `recentSpaces` (which will carry `albumCount`) is reset only on `SpaceAddAssets` / `SpaceRemoveAssets` / `AuthLogout` (`user.svelte.ts:40-46`). The space albums page links and unlinks by calling the SDK directly with **no** `eventManager` emit. So after a user links an album in the same session, the sidebar's chevron and `albumCount` stay stale until logout or a hard reload — the drill-down would not show the album the user just added.

**Fix, matching the existing asset pattern.** `SpaceAddAssets` is a **local** client emit (`space.service.ts:15`), not a server socket broadcast; the acting client invalidates its own `recentSpaces` and other members refresh on next mount. Mirror that for albums:

- Add `SpaceLinkAlbum` and `SpaceUnlinkAlbum` to `event-manager.svelte.ts` with payload `{ spaceId: string }`. A single `albumId` does not fit: `openLinkAlbumModal` links several albums in one action (`SpaceLinkAlbumModal` loops `linkAlbum`), and the reset handler only needs the space to invalidate. Keep the payload minimal.
- Emit them from **all three** link/unlink outcomes in `albums/+page.svelte`: `handleUnlink` (`:59`, emit `SpaceUnlinkAlbum`), `handleCreateAlbum` (`:93`, emit `SpaceLinkAlbum`), and `openLinkAlbumModal` (`:109`, emit `SpaceLinkAlbum` when `linkedCount` is truthy). Emit after the SDK call resolves, alongside the existing `invalidateAll()`.
- In `user.svelte.ts`, on both events reset `recentSpaces` (so `albumCount` is recomputed by the next `getAllSpaces`) **and** drop the affected space's entry from the `spaceAlbums` cache so a re-expand refetches the new list.

**Cross-user real time is out of scope.** A member whose sidebar is open when _another_ user links an album will not see it until their next mount — exactly today's behavior for cross-user asset adds (local emit only). Matching that limitation is consistent; changing it would require a new server socket event and belongs in a separate change.

### Routing

The space-album URL is currently hardcoded in three places: `space-album-card.svelte:49`, `space-albums-table.svelte:41`, and `albums/+page.svelte:101`. Add `Route.viewSpaceAlbum({ spaceId, albumId })` to `web/src/lib/route.ts` (near `viewSpace` at `:126-128`) and migrate all three call sites plus the new sidebar link. Leaving a fourth hardcoded copy is how that string drifts.

### "See all", and count-vs-list consistency

`albumCount` is a snapshot taken at page load (in `getAll`); the album list is fetched later, on expand. They can diverge if albums are linked/unlinked in between. Rules that keep the row internally consistent:

- **Chevron** uses `albumCount` for first paint (before any list fetch) — this is the whole reason the field exists.
- **Once the list is fetched, the fetched list is the source of truth** for what renders. The three rows come from the fetched list (sorted by `linkedAt` desc, sliced to 3). The "See all (N)" row renders when the fetched list length `> 3`, and **N is the fetched length**, not the stale `albumCount` — so the number always matches reality at expand time.
- **Empty fetch despite `albumCount > 0`** (e.g. the last album was deleted between load and expand — `shared_space_album` cascades on album delete, `shared-space-album.table.ts:40`): render nothing and collapse the row rather than showing an empty expander. The next `getAllSpaces` corrects the stale count.

The "See all" row links to the space's Albums tab (`/spaces/{spaceId}/albums`). Route it through a helper for consistency rather than hardcoding.

### Error handling

A failed `getSharedSpaceAlbums` collapses the row and toasts via the existing `handleError` path. Add a `failed_to_load_albums` key to `i18n/en.json` — English only, per repo convention. Note `i18n/` is shared between web and mobile.

## Testing (test-driven)

Every unit below is written **red first**: the listed test is added and watched to fail before the implementation exists, then made green. The order in "Implementation order" reflects that dependency chain. The lists here are the red checklist, not an afterthought.

### Server — `shared-space.service.spec.ts` (unit, mocked repo)

- `getAll` returns `albumCount: 0` for a space with no linked albums
- `getAll` returns the correct count for a space with several linked albums
- `getAll` reports **per-space** counts independently — two spaces with different link sets return different counts (guards against a missing `WHERE spaceId` in the query)
- `linkAlbum` bumps `lastActivityAt` on a **new** link (asserts the repository `update` call with `{ lastActivityAt }`)
- `linkAlbum` does **not** bump on an **idempotent re-link** — when `addAlbum` returns `undefined`, no `update` fires (the bump lives inside `if (result)`)
- `unlinkAlbum` does **not** bump `lastActivityAt` — asserted explicitly, so a later refactor symmetrizing the two is caught

### Server — medium test (real DB, testcontainers)

`albumCount` is a real SQL aggregate; the unit tests mock the repository and would pass even if the `COUNT` query is wrong. A medium test links N albums into a space and asserts `getAll` returns `albumCount === N`, and that unlinking decrements it. This is the only layer that exercises the actual query and the `WHERE spaceId` scoping.

### Web — `recent-spaces.spec.ts`

Chevron / rendering:

- chevron present iff `albumCount > 0`; absent (unchanged appearance) when `albumCount` is `0` or `undefined`
- album row renders the thumbnail when `albumThumbnailAssetId` is set and the gray fallback when it is not

Fetch / cache:

- expanding a space fires exactly one `getSharedSpaceAlbums({ id })`
- a second expand of the same space fires **zero** further calls (served from the `spaceAlbums` cache)
- a `SpaceLinkAlbum` / `SpaceUnlinkAlbum` event invalidates the cache so the next expand refetches
- fetch failure collapses the row and toasts (`failed_to_load_albums`)

Ordering / overflow:

- albums sorted by `linkedAt` descending (a just-linked album appears first) and sliced to three
- "See all" is **absent** at exactly three albums and **present** at four, showing the fetched length (`See all (4)`)
- fetched list empty while `albumCount > 0` → row collapses, nothing renders, no crash

Persistence:

- expansion state persists per space; a space that drops out of the top three and later returns comes back **collapsed** (its pruned key is gone) — asserts the prune-on-write

### Web — link/unlink invalidation `albums/space-albums-page.spec.ts`

- confirming a link (create-album path and modal path) emits `SpaceLinkAlbum` with `{ spaceId }`
- confirming an unlink emits `SpaceUnlinkAlbum` with `{ spaceId }`
- (extends the existing link/unlink tests at `:215-335`)

New test ids follow the existing convention (`sidebar-space-{id}`, `sidebar-space-dot-{id}`, `sidebar-space-thumbnail-{id}`): `sidebar-space-albums-{spaceId}`, `sidebar-space-album-{albumId}`, `sidebar-space-see-all-{spaceId}`.

### E2E

Skipped. The web component tests cover the logic, and the Playwright web suite against `:2283` serves empty bodies on a dev stack while the `:2285` path needs a full image rebuild per change — a poor trade for sidebar chrome.

## Implementation order (TDD)

Each step is red → green before the next. Server precedes web so the regenerated SDK types are real when the web tests import them.

1. **Server `albumCount`** — red: the three `getAll` count unit tests + the medium test. Green: `getLinkedAlbumCount` repo method, DTO field, `getAll` wiring.
2. **Server `lastActivityAt` bump** — red: the `linkAlbum` new-link-bumps / idempotent-re-link-no-bump / `unlinkAlbum` no-bump tests. Green: the single `update` call inside `linkAlbum`'s `if (result)` block.
3. **SDK regen** — `pnpm build` → `pnpm sync:open-api` → full `make open-api` (TS + Dart). Not test-gated, but the web step depends on the new `albumCount` type.
4. **Route helper** — add `Route.viewSpaceAlbum` and migrate the three hardcoded call sites (their existing tests stay green).
5. **Link/unlink events** — red: the emit tests in `space-albums-page.spec.ts`. Green: the events + emits from all three page handlers + `user.svelte.ts` reset handlers.
6. **Sidebar drill-down** — red: the `recent-spaces.spec.ts` groups above. Green: hand-rolled chevron in `recent-spaces.svelte`, lazy fetch + cache, per-space persisted expansion with prune, album rows, "See all".

## Verification gates

- `pnpm test` in `server/` and `web/`
- `pnpm test:medium` for the `albumCount` aggregate
- `make lint-server`, `make lint-web`
- Type checks: `pnpm check` per package
- `prettier --check` on every modified file — eslint green does not imply prettier green; they are separate CI gates
- Full `make open-api` (TypeScript **and** Dart)
- Mobile `dart analyze --fatal-infos lib test` — the Dart client regenerates with `albumCount`. Additive and expected to be safe, but confirmed rather than assumed.

## Risks

| Risk                                              | Mitigation                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| Sidebar depth pushes nav items below the fold     | Collapsed by default; chevron only where albums exist                           |
| Extra query on a hot path (`getAll`)              | One count added to a loop already doing 6+; #817 tracks the real fix            |
| Stale `albumCount` after in-session link / unlink | New `SpaceLinkAlbum` / `SpaceUnlinkAlbum` events reset the cache (see Fetching) |
| Count vs list divergence / empty fetch            | Fetched list is source of truth once loaded; empty fetch collapses the row      |
| Dart client drift                                 | Full `make open-api` plus the mobile analyze gate                               |

## Out of scope

- Restructuring the `getAll` N+1 (#817)
- Making shared albums appear in the top-level Albums section — the discussion's alternative suggestion, and a separate feature with its own opt-in question
- Mobile sidebar parity
- Activity-feed entries for album links
- Cross-user real-time sidebar updates (another member linking an album) — matches today's local-emit behavior for asset adds; would need a new server socket event
