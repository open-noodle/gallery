# Shared-space photos on the personal map — design

**Date:** 2026-04-17
**Branch:** `feat/space-map-markers`
**Scope:** server + web + mobile (remote API path)

## Summary

Photos from shared spaces the user belongs to already appear on `/photos` (the personal timeline) via the existing `withSharedSpaces` flag and the per-space `showInTimeline` member preference. The personal map has no matching support — its two endpoints (`GET /map/markers` and `GET /gallery-map/markers/filtered`) only return the member's own, partner, and shared-album content. This design wires the same inclusion logic into both map endpoints, and into the mobile app's remote map fetch, with a narrow exception for `isFavorite` (per-owner state that doesn't generalize across members).

## Key decisions

1. **Mirror the timeline** — reuse `sharedSpaceRepository.getSpaceIdsForTimeline(userId)` and the existing `showInTimeline` member pref. No new pref, no new UI toggle.
2. **Hardcode the flag at callers** — a `withSharedSpaces?: boolean` flag is added to both map DTOs for symmetry with timeline/search and for testability, but web and mobile callers pass `true` unconditionally.
3. **`isFavorite=true` drops space content** — silent narrowing, no `400`. `isFavorite` is per-owner state and doesn't generalize.
4. **`isArchived=true` keeps space content, but only `visibility=Timeline`** — the `isArchived` map toggle is a union ("also include Archive"), and members should not see owner-archived space content. Achieved with an inner `asset.visibility = Timeline` constraint inside the space EXISTS subqueries on the basic endpoint.
5. **Space-scoped contexts unchanged** — when `spaceId` is set on the filtered endpoint, `getSpaceIdsForTimeline` is not called (explicit double-scope guard).
6. **Mobile in scope** — remote API path only. Local Drift DB path already handles space visibility via `viewerVisibilityPredicate` (pre-existing from the 2026-04-12 mobile-timeline-space-visibility design).

## Non-goals

- New user preference (e.g., a `showOnMap` member toggle separate from `showInTimeline`).
- New UI toggle on `MapSettingsModal` or mobile map settings.
- Feature flag / phased rollout.
- DB migration.
- Fixing pre-existing offline-mode inconsistencies in mobile's local Drift predicate (`onlyFavorites` and `includeArchived` aren't applied per-owner in the local path — tracked as a follow-up).
- Mobile filter-panel parity (no filter panel on mobile today).
- `utilities/geolocation` tool behavior (intentionally scoped to user's own missing coordinates).

## Architecture

### Endpoint 1: `GET /map/markers` (basic personal map)

Call chain today:

```
MapController → MapService.getMapMarkers(auth, dto)
              → MapRepository.getMapMarkers(ownerIds, albumIds, options)
```

`MapRepository.getMapMarkers` uses hand-written Kysely SQL (not `searchAssetBuilder`).

**Changes:**

- `server/src/dtos/map.dto.ts` — add `withSharedSpaces?: boolean` to `MapMarkerDto`.
- `server/src/repositories/map.repository.ts` — add optional `spaceIds?: string[]` to the `MapMarkerSearchOptions` interface (**not** a new positional arg — avoids breaking existing signatures and specs). In the existing `eb.or(expression)` block, push two more EXISTS clauses when `options.spaceIds?.length > 0`:
  - `EXISTS (shared_space_asset WHERE assetId = asset.id AND spaceId IN options.spaceIds) AND asset.visibility = AssetVisibility.Timeline`
  - `EXISTS (shared_space_library WHERE libraryId = asset.libraryId AND spaceId IN options.spaceIds) AND asset.visibility = AssetVisibility.Timeline`
- `server/src/services/map.service.ts` — when `dto.withSharedSpaces === true && dto.isFavorite !== true`, call `this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id)` and populate `options.spaceIds`. No `isArchived` guard (the visibility clause inside the EXISTS handles it).

### Endpoint 2: `GET /gallery-map/markers/filtered` (filter-panel view)

Call chain today:

```
GalleryMapController → SharedSpaceService.getFilteredMapMarkers(auth, dto)
                     → SharedSpaceRepository.getFilteredMapMarkers(options)
                       (uses searchAssetBuilder)
```

`searchAssetBuilder` already handles `timelineSpaceIds` (see `server/src/utils/database.ts:380-398`), including the global `.where('asset.visibility', '=', visibility)` which is hardcoded to `Timeline` for this endpoint. No repo-layer change needed.

**Changes:**

- `server/src/dtos/gallery-map.dto.ts` — add `withSharedSpaces?: boolean` to `FilteredMapMarkerDto`.
- `server/src/services/shared-space.service.ts#getFilteredMapMarkers` — in the `!dto.spaceId` branch, when `dto.withSharedSpaces === true && dto.isFavorite !== true`, resolve `timelineSpaceIds` and pass into options. **Guard:** when `dto.spaceId` is present, `getSpaceIdsForTimeline` must not be called (prevents double-scoping / cross-space union).

`FilteredMapMarkerDto` has no `isArchived` field — it always queries `AssetVisibility.Timeline`. Only the `isFavorite` guard applies there.

### Web changes

- `web/src/lib/components/shared-components/map/map.svelte#loadMapMarkers` (around line 231) — pass `withSharedSpaces: true` to `getMapMarkers(...)` when `!spaceId`. Space-scoped branch (which calls `getSpaceMapMarkers`) unchanged.
- `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte` filter-panel effect (around line 110) — pass `withSharedSpaces: true` to `getFilteredMapMarkers(...)` when `spaceId` is undefined. Matches the pattern already in `map-filter-config.ts:31` (which threads `withSharedSpaces: true` to suggestion endpoints).
- No change to `MapSettingsModal.svelte` or `preferences.store.ts#MapSettings` — no user-facing toggle.

### Mobile changes

- `mobile/lib/services/map.service.dart#getMapMarkers` — add `bool? withSharedSpaces` param, pass through to `_apiService.mapApi.getMapMarkers(...)`.
- `mobile/lib/providers/map/map_marker.provider.dart` (around line 26) — pass `withSharedSpaces: true` unconditionally.
- Local Drift path (`mobile/lib/infrastructure/repositories/map.repository.dart` + `viewer_visibility.dart`) — no change; already respects `showInTimeline`.

### Archive / favorite interaction

| `isFavorite` | `isArchived`      | Space content included?                                                 | Notes                                                               |
| ------------ | ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| undefined    | undefined / false | yes (Timeline visibility only)                                          | default view                                                        |
| undefined    | true              | yes (Timeline visibility only; owner-archived space assets stay hidden) | inner visibility clause on EXISTS                                   |
| true         | any               | no                                                                      | `getSpaceIdsForTimeline` not called; space EXISTS clauses not added |

### SDK / code-generation

After server changes:

```
cd server
pnpm build
pnpm sync:open-api
cd ..
make open-api   # regenerates TS + Dart SDK for new DTO fields
```

`MapRepository.getMapMarkers` is `@GenerateSql`-decorated, so `make sql` needs to run (requires DB). Per `feedback_sql_query_regen.md`, apply the CI diff manually if no local DB.

## Permission matrix (test assertions)

Viewer roles (V), asset states (S), filters (F), endpoints (E). Combinations exercised in tests:

### Positive (marker must be returned)

| #   | Viewer                                                            | State                              | Filter            | Endpoint                            | Notes                                                             |
| --- | ----------------------------------------------------------------- | ---------------------------------- | ----------------- | ----------------------------------- | ----------------------------------------------------------------- |
| 1   | Space member (direct `shared_space_asset`, `showInTimeline=true`) | Owner visibility=Timeline, GPS set | defaults          | `GET /map/markers`                  | Standard inclusion                                                |
| 2   | Same                                                              | Same                               | defaults          | `GET /gallery-map/markers/filtered` | Filtered endpoint inclusion                                       |
| 3   | Space member (library-linked via `shared_space_library`)          | Same                               | defaults          | Basic                               | Library inheritance                                               |
| 4   | Same                                                              | Same                               | defaults          | Filtered                            | Library inheritance on filtered                                   |
| 5   | Direct-inclusion member                                           | Timeline, GPS                      | `isArchived=true` | Basic                               | Archive toggle is additive; Timeline space content still included |
| 6   | Asset owner                                                       | any                                | any               | any                                 | Owner always sees own asset                                       |

### Negative (marker must NOT be returned)

| #   | Viewer                             | State                     | Filter                   | Endpoint                  | Reason                                                                                                                           |
| --- | ---------------------------------- | ------------------------- | ------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 7   | Member with `showInTimeline=false` | Timeline, GPS             | defaults                 | Basic / Filtered          | Opted out of space in personal views                                                                                             |
| 8   | Non-member stranger                | Timeline, GPS             | defaults                 | Any                       | No access                                                                                                                        |
| 9   | Former member (removed)            | Timeline, GPS             | defaults                 | Any                       | Membership revoked                                                                                                               |
| 10  | Direct-inclusion member            | Owner visibility=Archive  | defaults                 | Basic                     | Owner archived; default is Timeline-only                                                                                         |
| 11  | Same                               | Owner visibility=Archive  | `isArchived=true`        | Basic                     | **Critical**: owner-archived space content stays hidden even with member's `isArchived=true` (inner visibility clause on EXISTS) |
| 12  | Direct-inclusion member            | No GPS                    | defaults                 | Basic                     | Excluded from map regardless                                                                                                     |
| 13  | Same                               | Trashed (`deletedAt`)     | defaults                 | Basic                     | Excluded                                                                                                                         |
| 14  | Same                               | Owner visibility=Locked   | defaults                 | Basic                     | Excluded                                                                                                                         |
| 15  | Same                               | Timeline, GPS             | `isFavorite=true`        | Basic                     | Per-owner state; space content dropped                                                                                           |
| 16  | Same                               | Timeline, GPS             | `withSharedSpaces=false` | Basic / Filtered          | Explicit opt-out; test path                                                                                                      |
| 17  | Member of space A                  | Timeline, GPS, in space A | defaults                 | Filtered with `spaceId=B` | Space-scoped context must not union in timeline spaces                                                                           |

### Cross-scope

| #   | Scenario                                                                                              | Expected                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 18  | Library L in space A (`showInTimeline=true`) and space B (`showInTimeline=false`) for the same member | Marker visible via A; toggling B doesn't hide L's assets                                                    |
| 19  | Member of spaces A and B; queries filtered endpoint with `spaceId=B`; asset only in A                 | Marker NOT visible (no cross-space leak)                                                                    |
| 20  | `dto.spaceId` + `dto.withSharedSpaces=true` on filtered endpoint                                      | `getSpaceIdsForTimeline` is NOT called (unit-level assertion)                                               |
| 21  | `personIds` filter on filtered endpoint with `withSharedSpaces=true` (no `spaceId`)                   | Resolves as global `personIds`, not `spacePersonIds` (existing branch at `shared-space.service.ts:596-597`) |

### Test distribution

- **Server unit** (`server/src/services/map.service.spec.ts`, `shared-space.service.spec.ts`): cases 5, 7, 15, 16, 17, 20, 21.
- **Server medium** (new `server/src/repositories/map.repository.spec.ts`): cases 1, 3, 10, 11, 12, 13, 14, 18.
- **E2E web** (new spec under `e2e/src/web/specs/`): cases 1, 3, 7, 9 via the full membership lifecycle.
- **Flutter unit** (new file under `mobile/test/`): assert `withSharedSpaces: true` reaches `ApiService.mapApi.getMapMarkers`.

## Risks and trade-offs

- **Query cost** — two added EXISTS subqueries on the basic endpoint; both inner tables (`shared_space_asset`, `shared_space_library`) are small and indexed. Same pattern as `searchAssetBuilder` in production. Monitor slow-query logs post-deploy.
- **Marker count inflation** — users in populated spaces see many more markers. Intentional; parity with timeline.
- **Pref naming drift** — `showInTimeline` now also gates map. Acceptable; rename to `showInPersonalViews` is a trivial follow-up if it causes confusion.

## Rollout

- No feature flag — additive change.
- Server + web + mobile + SDK ship together in one PR.
- No DB migration.

## Follow-ups (explicitly out of scope)

- Mobile local Drift path: apply per-owner `onlyFavorites` / `includeArchived` filtering to space content (pre-existing inconsistency from the 2026-04-12 mobile visibility work, not introduced here).
- Rename `showInTimeline` → `showInPersonalViews` if UX research surfaces confusion.
- `utilities/geolocation` tool — continues to scope to user's own assets only.
- Docs update at `docs/docs/` on the shared-spaces page if user-facing behavior warrants a line.

## Final manual QA (outside automated tests)

- **Web** — `make dev`; sign in as a space member; confirm markers from a geo-tagged owner asset (direct + library-linked) appear on `/map` and on `/map` with filter panel values set. Toggle `showInTimeline=false` on the space via API; confirm markers disappear on reload.
- **Mobile** — build and run on a physical device or simulator; open the map screen while signed in as a member; confirm same expected visibility. (The assistant cannot run this from its environment.)
