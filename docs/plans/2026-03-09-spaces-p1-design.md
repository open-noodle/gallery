# Spaces P1: Collage Cards, Hero Section & Sort Controls

## Overview

Three medium-effort, high-impact improvements building on P0's visual identity work (colors, gradients, stat chips, role badges). P1 makes space cards visually distinct from albums, gives the detail page a strong first impression, and adds basic list organization.

## 1. Schema & Data Layer

### Migration: `lastActivityAt` column

Add `lastActivityAt` (timestamp, nullable, default null) to `shared_space`. Updated in the service layer:

- **Asset add**: Set to `NOW()`
- **Asset remove**: Recompute as `MAX(shared_space_asset.addedAt)`, or null if space is empty

No schema change for collage — asset IDs are computed at query time.

### Repository: `getRecentAssets(spaceId, limit)`

New method on `SharedSpaceRepository`. Queries `shared_space_asset` joined with `asset` (for thumbhash), ordered by `addedAt DESC`, limited to 4. Returns `{ id: string, thumbhash: string | null }[]`.

### DTO changes

`SharedSpaceResponseDto` gains three new fields:

```typescript
lastActivityAt?: string | null;            // ISO timestamp
recentAssetIds?: string[];                 // up to 4 asset IDs for collage
recentAssetThumhashes?: (string | null)[]; // parallel array of thumbhashes
```

### Service changes

- `create()` — set `lastActivityAt: null` (no assets yet)
- `addAssets()` — after adding, set `lastActivityAt = new Date()`
- `removeAssets()` — after removing, recompute `lastActivityAt` from `MAX(addedAt)` or set null if empty
- `getAll()` / `get()` — fetch recent assets per space, include in response
- `mapSpace()` — thread new fields through

## 2. Web — Collage Card Component

### `SpaceCollage` component

Replaces the single `AssetCover` in `space-card.svelte`. Three layout variants based on asset count:

**1 asset** — single full image (`aspect-square rounded-xl`)

**2-3 assets** — asymmetric split:
```
┌─────────┬──────┐
│         │  B   │
│    A    ├──────┤
│         │  C   │
└─────────┴──────┘
```
A takes ~60% width, B and C stack on the right. For 2 assets, C is omitted (A 60%, B 40% full height).

**4+ assets** — 2x2 grid with 2px gap:
```
┌──────┬──────┐
│  A   │  B   │
├──────┼──────┤
│  C   │  D   │
└──────┴──────┘
```

**0 assets** — P0 gradient placeholder (unchanged)

### Props

```typescript
interface Props {
  assets: { id: string; thumbhash: string | null }[];
  gradientClass?: string;  // P0 gradient fallback for 0 assets
  preload?: boolean;
}
```

### Data flow

`getAll()` response includes `recentAssetIds` + `recentAssetThumhashes`. `space-card.svelte` zips them into an `assets` array and passes to `SpaceCollage`. Each cell uses `getAssetMediaUrl({ id })` with thumbhash blur-up.

### Key decisions

- **Always collage on cards** — cover photo is reserved for the detail page hero section
- **Max 4 assets shown** — 5+ assets still render a 2x2 grid using the first 4
- Layout variants identified by `data-testid`: `collage-single`, `collage-asymmetric`, `collage-grid`

## 3. Web — Hero Section

### Detail page header redesign

Replace the flat title + icon button row with a hero banner.

**When cover photo is set:**
Full-width banner (~250px) with cover photo as `object-cover` background. Gradient overlay fades from transparent at top to page background color at bottom. Space name, description, stat chips (P0), and role badge (P0) overlaid at bottom-left.

```
┌──────────────────────────────────────────────┐
│                                              │
│          [Cover Photo — full width]          │
│                                              │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░ Family Trip to Japan                   ░  │
│  ░ [📷 342 photos]  [👥 5 members]        ░  │
│  ░ [Editor]                               ░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
├──────────────────────────────────────────────┤
│  [Add Photos] [Map] [Eye] [Members] [Delete] │
```

**When no cover photo:**
Same layout with the space's color gradient (from P0) as the banner background.

### `SpaceHero` component

```typescript
interface Props {
  space: SharedSpaceResponseDto;
  memberCount: number;
  assetCount: number;
  currentRole?: string;
}
```

Action buttons remain in the parent page below the hero (not overlaid — avoids z-index issues).

### Description handling

First 2 lines shown, "Show more" / "Show less" toggle for longer descriptions.

## 4. Web — Sort Dropdown

### `SpacesControls` component

Minimal toolbar at the top of the space list page, right-aligned above the grid.

### Sort options

| Label | Field | Default order |
|-------|-------|---------------|
| Name | `name` | A → Z |
| Last Activity | `lastActivityAt` | Newest first |
| Date Created | `createdAt` | Newest first |
| Asset Count | `assetCount` | Highest first |

Clicking the active sort option flips order (asc ↔ desc). Switching options uses that option's default. Arrow icon indicates direction.

### Implementation

Client-side sort — `getAll()` response sorted in JS. Space lists are typically small (<50).

### State persistence

Persisted store `spaceViewSettings` (same pattern as `albumViewSettings`):

```typescript
interface SpaceViewSettings {
  sortBy: 'name' | 'lastActivityAt' | 'createdAt' | 'assetCount';
  sortOrder: 'asc' | 'desc';
}
```

Default: `{ sortBy: 'lastActivityAt', sortOrder: 'desc' }`.

### Props

```typescript
interface Props {
  spaces: SharedSpaceResponseDto[];
  onSorted: (sorted: SharedSpaceResponseDto[]) => void;
}
```

## 5. TDD Strategy & Test Plan

### Philosophy

Every server change follows strict TDD — failing test first, then implement, then green. Web components get unit tests alongside implementation. E2E validates the full stack.

### Server unit tests (vitest) — written BEFORE implementation

**`lastActivityAt` tracking:**
- `create()` sets `lastActivityAt` to null
- `addAssets()` updates `lastActivityAt` to current time
- `addAssets()` with empty array doesn't update `lastActivityAt`
- `removeAssets()` recomputes `lastActivityAt` from remaining assets
- `removeAssets()` sets `lastActivityAt` to null when space becomes empty

**Collage data:**
- `getAll()` includes `recentAssetIds` array (up to 4)
- `getAll()` includes `recentAssetThumhashes` parallel array
- `getAll()` returns empty arrays for spaces with no assets
- `get()` includes same collage fields
- Assets ordered by `addedAt` descending

**Existing behavior preserved:**
- All existing tests continue passing
- `update()`, `delete()`, member management unaffected

### Web component unit tests (vitest + @testing-library/svelte)

**SpaceCollage (~8 tests):**
- Single image layout for 1 asset
- Asymmetric layout for 2 assets
- Asymmetric layout for 3 assets
- 2x2 grid for 4 assets
- 2x2 grid for 5+ assets (first 4 shown)
- Gradient placeholder for 0 assets
- Preload passthrough
- Correct `data-testid` per variant

**SpaceHero (~8 tests):**
- Cover photo renders when `thumbnailAssetId` set
- Gradient background when no cover
- Correct gradient class from `space.color`
- Displays space name
- Displays stat chips
- Displays role badge
- Truncates long description with "Show more"
- Expands description on click

**SpacesControls (~12 tests):**
- Sort by name ascending/descending
- Sort by last activity newest/oldest first
- Sort by date created newest/oldest first
- Sort by asset count highest/lowest first
- Flips order on active sort click
- Default order on sort switch
- Null `lastActivityAt` sorts to end
- Persists preference across renders

**space-card.svelte (modified, ~2 new tests):**
- Passes collage data to SpaceCollage
- Handles missing `recentAssetIds` gracefully

### E2E tests (Playwright)

New file: `e2e/src/web/specs/spaces-p1.e2e-spec.ts`

**Collage cards:**
- Create space, add 1 asset → single image layout
- Add 2-3 assets → asymmetric layout
- Add 4+ assets → 2x2 grid layout
- 0 assets → gradient placeholder

**Hero section:**
- Space with cover photo → hero shows cover image
- Space without cover → hero shows gradient
- Hero displays name, stat chips, role badge
- Long description truncated with "Show more"

**Sort:**
- Name sort reorders alphabetically
- Last activity sort reflects recency
- Asset count sort orders by count
- Sort preference persists after page reload

### Execution order

1. Write failing server unit tests → implement → green
2. Regen OpenAPI
3. Write web component tests + implement components → green
4. Write E2E tests → verify full stack → green
5. Lint/format/typecheck passes

## Files Touched

| Change | Files |
|--------|-------|
| `lastActivityAt` migration | `server/src/schema/migrations/`, `server/src/schema/tables/shared-space.table.ts`, `server/src/database.ts` |
| Repository method | `server/src/repositories/shared-space.repository.ts` |
| DTOs | `server/src/dtos/shared-space.dto.ts` |
| Service logic + tests | `server/src/services/shared-space.service.ts`, `server/src/services/shared-space.service.spec.ts` |
| Test factory | `server/test/small.factory.ts` |
| OpenAPI regen | `open-api/`, `mobile/openapi/` |
| Collage component | `web/src/lib/components/spaces/space-collage.svelte` (new) |
| Space card update | `web/src/lib/components/spaces/space-card.svelte` |
| Hero component | `web/src/lib/components/spaces/space-hero.svelte` (new) |
| Detail page update | `web/src/routes/(user)/spaces/[spaceId]/.../+page.svelte` |
| Sort controls | `web/src/lib/components/spaces/spaces-controls.svelte` (new) |
| Sort store | `web/src/lib/stores/space-view.store.ts` (new) |
| List page update | `web/src/routes/(user)/spaces/+page.svelte` |
| E2E tests | `e2e/src/web/specs/spaces-p1.e2e-spec.ts` (new) |

## Out of Scope

- Server-side sort parameter (client-side is sufficient for now)
- Filter tabs (All/My Spaces/Shared with Me)
- Group-by, list view toggle
- Activity feeds, recency badges, member contribution cards
- Inline editable title
- Slide-out members panel
