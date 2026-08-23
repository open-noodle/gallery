# Asset Viewer Contextual Filters — Design Spec

**Date:** 2026-07-12
**Branch:** `worktree-feat+asset-viewer-contextual-filters`
**Closes:** #767 (partially — see §7)

## 1. Summary

The asset-viewer info panel is informational today. Two of its fields (camera make/model, lens
model) link to the deprecated `/search` page; one (location) conflates its value with its Edit
button. This spec turns the panel into a **filtering surface**: clicking any metadata value filters
the timeline **you are currently in** — the space, the album, or `/photos` — while every action that
exists today remains reachable.

The enabling idea is architectural: **make the URL the single source of truth for filter state on
all four timeline surfaces** (`/photos`, `/spaces/{id}`, `/albums/{id}`, `/map`). Once filters live
in the URL everywhere, "filter in the current context" reduces to _read the URL, merge one field,
write it back, navigate_ — and the space→map filter bug (#767) falls out as a side effect, because
the map link becomes an ordinary filter URL.

## 2. Goals

- Clicking a metadata value in the info panel filters the **current** context (space / album /
  photos / map), not a deprecated global search page.
- Every action available today remains available via an explicit secondary affordance.
- Retire both `Route.search(...)` links from the asset viewer.
- Fix #767: filters applied in a Space carry over to the map view.

## 3. Non-goals

- **Mobile (Flutter).** Web only. Mobile keeps its current asset-viewer behavior.
- **Smart-search (`q`) on the map.** The map-markers endpoint has no embedding search; see §7.
- **Filter-panel dropdowns for `lens` / `state`.** They are settable from the asset viewer, round-trip
  through the URL, and are removable as chips — but they get **no dropdown** in the filter panel.
  Deliberate follow-up. **Note:** this is cheaper than it looks — the suggestion repository _already_
  supports both fields (`getExifField` is typed
  `'city' | 'state' | 'country' | 'make' | 'model' | 'lensModel'`; `getStates()` at
  `search.repository.ts:1042` and `getCameraLensModels()` at `:1088` already exist). Only the
  _timeline filter_ side is missing. Scoped out for size, not difficulty.
- **Retiring the `/search` page itself.** This spec removes the asset viewer's _links_ to it.
- Making `/albums/{id}` a ⌘K "searchable page". `getSearchablePageBasePath` is deliberately left
  alone so ⌘K's behavior does not change.

## 4. Background: three incompatible filter mechanisms

> **STATUS (as of slice 5b).** This section describes the state of the world **before** slices 3 and 4. Both have landed: `/albums/{id}` and `/map` are **URL-backed now**, exactly like `/photos` and
> `/spaces`. The table below is kept as the problem statement — read it as history, not as current
> behaviour.

| Surface                   | Filter state lived in                         | Now                                                                       |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| `/photos`, `/spaces/{id}` | ✅ URL params                                 | unchanged (`web/src/lib/utils/searchable-page-search.ts`)                 |
| `/albums/{id}`            | ❌ component-local `$state`                   | ✅ URL-backed (Slice 3) — hydrate ⇄ write ⇄ react, via `filter-target.ts` |
| `/map`                    | ❌ component-local `$state`, **always empty** | ✅ URL-backed (Slice 4) — same loop, plus the viewport hash               |

`/photos` and `/spaces` already implemented the full loop we want — hydrate from URL, write back on
change, react to URL changes (`photos/…/+page.svelte:434-452` and `:506-534`). Slices 3 and 4 made
albums and the map do the same thing; the write half is `buildFilterStateUrl` /
`isFilterStateUrlUnchanged` / `withoutAtParam` (§5.4).

### 4.1 What the timeline query already supports

`TimeBucketQueryBaseSchema` (`server/src/dtos/time-bucket.dto.ts:20+`) already accepts `city`,
`country`, `make`, `model`, `rating`, `type`, `description`, `ocr`, `originalFileName`, `personIds`,
`spacePersonIds`, `tagIds`, `isFavorite`, `isInAlbum`/`isNotInAlbum`, `albumId`, `spaceId`,
`takenAfter`/`takenBefore`.

It did **not** support `lensModel`, `state`, or an owner filter. **All three shipped in Slice 1** —
on the timeline DTO, on metadata search, and on the filtered map markers (`ownerId` as a genuine
contributor `AND`, never merged into `userIds`; see the trap below).

### 4.2 Three traps found while verifying (do not re-derive these)

- **`userId` is NOT an owner filter.** `timeline.service.ts:67-91` maps `dto.userId` →
  `userIds = [userId, ...partnerIds]`, and `withTimeBucketAssetFilters:359-373` **OR**s that against
  `timelineSpaceIds`. It expresses _timeline composition_ ("my assets **or** my spaces' assets").
  Reusing it as a contributor filter inside a Space would **widen** the result set, not narrow it.
  Contributor filtering therefore needs a genuinely new `ownerId` option that AND-s
  `asset.ownerId = X`.
- **`albumId` already takes precedence over `isInAlbum`/`isNotInAlbum`** — both are guarded with
  `&& !options.albumId` (`asset.repository.ts:321,326`). The URL codec must never emit both.
- **The two array filters have OPPOSITE semantics.** `personIds` → `hasPeople`
  (`database.ts:259-277`) uses `HAVING count(DISTINCT personId) = ids.length` → **ALL / AND**
  (adding a person _narrows_). `tagIds` → `withAnyTagId` (`database.ts:535-545`) uses
  `id_ancestor = ANY(tagIds)` → **ANY / OR** (adding a tag _widens_). This is why §5.6 mandates
  **replace, never append**.
  _(Note: `TimeBucketQueryBaseSchema` documents `personIds` as "containing **any** of these persons" —
  the description contradicts the `HAVING` clause. Pre-existing; not fixed here.)_

### 4.3 No migration is required

`city`/`country`/`make`/`model` are plain exact-match `=` predicates on `asset_exif`
(`asset.repository.ts:288-299`). Only the ILIKE fields (`description`, `ocr`, `originalFileName`)
needed trigram indexes back in #723. `lensModel` and `state` are exact-match too, and both columns
already exist (`asset-exif.table.ts:56,77`).

**Consequence: no `migrations-gallery/` migration, and therefore no `revert-to-immich.sql` CI gate.**

### 4.4 RBAC: non-owners MUST be able to filter assets they do not own

**Requirement:** a Space viewer or editor filtering by camera / lens / state / location must see
matching assets **contributed by other members**, not just their own. This fork has already shipped
this exact bug class once — see the comment at `search.repository.ts:1210-1213`: _"Dropping the
participant cases would give viewers empty People/Location/Camera/Tag facets for assets owned by the
album owner (issue #655)."_ The same trap is live for spaces, so it is a **first-class test target**,
not an assumption.

#### Verified: both paths are ownership-agnostic under a Space scope

**Filter path** — `buildSpaceTimelineOptions` (`space-filter-options.ts:5-6`) sends
`{ spaceId, withStacked }` and **no `userId`**. So the `userIds` narrowing at
`withTimeBucketAssetFilters:359` never fires, and the sole scope is the `spaceId` predicate
(`shared_space_asset` OR `shared_space_library`, `:331-348`). The new `make`/`model`/`lensModel`/
`state` conditions are exact-match `AND`s on an `asset_exif` inner join — they carry no ownership
predicate, so they narrow _within_ the space without re-scoping to the viewer. ✅

**Suggestion path** — `applySuggestionScope` (`search.repository.ts:1199-1295`) has three branches:

| Branch       | Condition          | Ownership predicate                                                        |
| ------------ | ------------------ | -------------------------------------------------------------------------- |
| `:1254-1256` | no album, no space | `asset.ownerId = ANY(userIds)` — **owner-scoped** (correct for `/photos`)  |
| `:1257-1274` | `spaceId` set      | **none** — space membership only ✅                                        |
| `:1217-1253` | `albumId` set      | in-album AND (owner OR album participant OR timeline space) — the #655 fix |

Access control itself is enforced upstream:
`requireAccess({ permission: Permission.SharedSpaceRead, ids: [dto.spaceId] })`
(`search.service.ts:388-389`).

#### The new `ownerId` filter must narrow, never widen

`ownerId` is added as a plain `AND asset.ownerId = X`. It composes _inside_ the existing scope, so it
can only ever shrink the result set:

- In a Space: `spaceId` scope AND `ownerId=<member>` → that member's contributions to that space. ✅
- On `/photos`: `ownerId = ANY(me, partners)` AND `ownerId=<stranger>` → **empty**. No leak. ✅

This is the one place in this spec where a mistake could create a **data leak** rather than merely a
broken filter (E20, E21).

## 5. Architecture

### 5.1 `FilterState` additions

```ts
export interface FilterState {
  // … existing …
  lensModel?: string; // NEW — exact match
  state?: string; // NEW — exact match (EXIF "state/province")
  albumId?: string; // NEW — asset is in this album
  ownerId?: string; // NEW — asset.ownerId
}
```

`createFilterState()`, `clearFilters()` and `getActiveFilterCount()` must all account for all four.

### 5.2 Shared filter-URL codec — `web/src/lib/utils/filter-url.ts` (new)

Extract the `FilterState ⇄ URLSearchParams` codec that currently lives inside
`searchable-page-search.ts` (`getSearchablePageFilterState` / `appendSearchablePageFilterParams`)
into a standalone module so all four surfaces share one implementation.

New URL params:

| Web URL param | `FilterState` field | Server DTO field | Notes                                                           |
| ------------- | ------------------- | ---------------- | --------------------------------------------------------------- |
| `lens`        | `lensModel`         | `lensModel`      |                                                                 |
| `state`       | `state`             | `state`          |                                                                 |
| `albumId`     | `albumId`           | `albumId`        | Distinct from the existing `album` param, which is `has`/`none` |
| `owner`       | `ownerId`           | `ownerId`        | **Web param is `owner`; server field is `ownerId`.** Not a typo |

**Naming note (avoids a real trap):** the web URL param is deliberately short (`owner`) while the
server DTO field is `ownerId`. There is precedent — web `filename` ⇄ server `originalFileName`. Use
`owner` in URLs and `ownerId` in API calls; never mix them.

**Codec invariant:** when `albumId` is set, the encoder MUST NOT emit `album=has` / `album=none`
(mirrors the server precedence in §4.2). The decoder must likewise drop `isInAlbum`/`isNotInAlbum`
if `albumId` is present.

`searchable-page-search.ts` keeps its public API and delegates to the codec — `/photos` and
`/spaces` must not change behavior.

**Update (Slice 5b): `year` and `month` are in the codec too.** The temporal picker's
`selectedYear` / `selectedMonth` used to be transient, URL-less state, which forced every URL-backed
surface to carry them by hand across a URL write (a `pendingFilterUrlSync` carry-over on the album
and map pages). They are encoded now — `?year=2023&month=6` — with the same precedence the query
builder applies: `from`/`to` **wins**, so a year is never emitted (or decoded) beside an explicit
date range, and a month is never emitted without a year. **The `pendingFilterUrlSync` carry-over has
been deleted**; rebuilding `FilterState` from the URL alone is now lossless, which is what makes a
picked year survive a reload, Back, and a shared link.

### 5.3 Filter target resolution — `web/src/lib/utils/filter-target.ts` (new)

```ts
type FilterTarget =
  | { kind: 'photos'; basePath: '/photos' }
  | { kind: 'space'; basePath: string; spaceId: string }
  | { kind: 'album'; basePath: string; albumId: string }
  | { kind: 'map'; basePath: '/map'; spaceId?: string };

function resolveFilterTarget(url: URL): FilterTarget | null;
```

Deliberately **separate** from `getSearchablePageBasePath` (which drives ⌘K and stays unchanged).
Returns `null` for `/favorites`, `/archive`, `/trash`, `/folders`, `/memories`, person pages, tag
pages, `/search`, and shared links.

**`/map` is a filter target** (E23): an asset viewer opened from the map (`/map/photos/{assetId}`)
resolves to `kind: 'map'`, and a filter click lands back on `/map` with the filter applied.

### 5.4 Applying a filter — the URL builders in `filter-target.ts`

A pure URL builder plus a thin navigating wrapper, so the interesting logic is unit-testable:

```ts
// pure — SHIPPED in Slice 2
function buildContextualFilterUrl(url: URL, patch: Partial<FilterState>, opts?: { global?: boolean }): string;
// side-effecting — SHIPPED in Slice 7 (Task 1)
function applyContextualFilter(patch: Partial<FilterState>, opts?: { global?: boolean }): void; // → goto()
// the person patch, which is a function of the TARGET — SHIPPED in Slice 7 (Task 5). See E4.
function buildPersonFilterPatch(url: URL, person: { id: string; spacePersonId?: string }): Partial<FilterState> | null;
// the 🗺️ pin's map URL, carrying the current scope + filters — SHIPPED in Slice 7 (Task 3). See E10.
function buildContextualMapUrl(url: URL, point?: { lat: number; lng: number; zoom?: number }): string | null;
```

> ✅ **`applyContextualFilter` now exists** (`filter-target.ts`), and every filterable DetailPanel row
> calls it. This paragraph used to say it had not been written — that was true up to Slice 7 Task 1
> and is not any more.

Semantics of `buildContextualFilterUrl`:

1. Resolve the target from `page.url`. If `null` → **fall back to `/photos`** (authenticated contexts
   only). If `authManager.isSharedLink` → the affordance is not rendered at all.
2. `opts.global === true` forces the `/photos` target regardless of context (the 🔍 icon), and
   carries **nothing** over — not the filters, not `q`, not `sort`.
3. Decode current filters from the URL, apply the patch per §5.6, re-encode. (Since Slice 5b put
   `year`/`month` in the codec, an active year is **preserved** by a contextual click, like any other
   filter.)
4. Drop the `at` param (one-shot grid scroll target — see `searchable-page-search.ts:122-128`).
5. The resulting URL is the target's **base path**, which does not include the `assetId`. So a single
   `goto()` both closes the asset viewer and applies the filter.

**The write half — added by Slices 3/4, not in the original design.** `/albums/{id}` and `/map` are
not "searchable pages" (`getSearchablePageBasePath` returns `null` for both), so they cannot reuse
`buildSearchablePageUrl`. `filter-target.ts` therefore also exports:

| Function                    | Purpose                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildFilterStateUrl`       | Writes a **complete** `FilterState` into the current URL. **Replaces, never merges** (every filter param is deleted, then re-emitted from the state) — otherwise a cleared filter could never leave the URL. Keeps the current pathname (the panel can write while the asset viewer is open), preserves non-filter params and the hash, drops `at`. |
| `isFilterStateUrlUnchanged` | The no-op guard for that write. **Not** a string compare: `buildFilterStateUrl` re-appends the filter params last, so `/map?make=Apple&spaceId=s1` rebuilds re-ordered. Compares path + hash verbatim and the query as a canonicalised param set.                                                                                                   |
| `withoutAtParam`            | The token guard for the hydrate half. `replaceScrollTarget` writes `?at=<assetId>` when the asset viewer closes; that must not read as a filter change and re-hydrate.                                                                                                                                                                              |

### 5.5 Per-field filter patches

| Row                     | Patch produced                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| Camera                  | `{ make, model }`                                                                                             |
| Lens                    | `{ lensModel }`                                                                                               |
| Location — city line    | `{ city, country }` (country included to disambiguate same-named cities)                                      |
| Location — state line   | `{ state, country }`                                                                                          |
| Location — country line | `{ country }`                                                                                                 |
| Date                    | `{ dateAfter: D, dateBefore: D }` where `D` = the asset's **local** date (`YYYY-MM-DD`), not a UTC conversion |
| Filename                | `{ originalFileName: <basename without extension> }` — surfaces RAW/JPEG pairs and edited variants            |
| Tag chip                | `{ tagIds: [tag.id] }` — **replaces** the array (§5.6)                                                        |
| Person chip             | `buildPersonFilterPatch(page.url, person)` — **target-dependent**, see below and E4                           |
| Shared by               | `{ ownerId: asset.ownerId }`                                                                                  |
| Rating (icon)           | `{ rating: asset.exifInfo.rating }` — server semantics are `>= N`                                             |
| Description (icon)      | `{ description: <description text, truncated to 200 chars> }`                                                 |
| Appears-in album (icon) | `{ albumId: album.id }` — **not offered for the album you are already in** (E9)                               |

⚠️ **The person patch is a function of the TARGET, not just of the person.** An earlier draft of this
section said it always carries the scoped token (`space-person:<uuid>`). **That is wrong, and it is a
400 rather than a wrong result set** — see E4. What shipped:

| Target                                                            | `personIds` value                                                                                                                                                                                           |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `space`, or `map` **with** a `spaceId`                            | **bare** `person.spacePersonId`. If it is missing → **render no affordance** (nothing honest to filter by: the owner's person uuid is not a `shared_space_person` row, so the Space would come back empty). |
| `photos`, `album`, `map` without `spaceId`, or `{ global: true }` | `person.spacePersonId ? `space-person:${person.spacePersonId}` : person.id`                                                                                                                                 |

⚠️ **Do not call `getPhotosPersonFilterId` on an asset-viewer person.** It is built for the filter
**suggestion** DTO shape (`filterId` / `primaryProfile`), and `mapPerson` (`person.dto.ts`) sets
neither on an asset-viewer person — the asset path only adds `spacePersonId` (`asset.service.ts`). It
would therefore fall through to `person.id`, the **owner's** person uuid, which a viewer of a
shared-space asset cannot resolve on `/photos` → empty result → **P1 violated on the very row P1
exists to protect**.

### 5.6 Merge semantics — set the patched fields, preserve the rest; **arrays replace, never append**

Fields named in the patch are **set**. Every other active filter is **preserved**. So clicking the
camera while a `people` filter is active yields _both_ filters.

For the two array fields (`personIds`, `tagIds`), the patch **replaces the whole array** — it never
appends. This is not arbitrary: per §4.2 the server treats the two arrays **oppositely**
(`personIds` = AND/narrowing, `tagIds` = OR/widening), so "append" would make two adjacent rows of the
same panel move the result set in **opposite directions**. Replace gives both rows one mental model:
_"filter by the thing I clicked."_ The filter panel remains the place to build up multi-select.

**P1 — the universal invariant (property test).** For every filterable row, on every surface:

> After clicking a metadata value on asset _A_, the resulting filtered result set **contains _A_**.

Replace satisfies P1 by construction. Append would violate it — OR-ing a second tag can drop _A_ from
the result set. P1 is a cheap, high-value property test across all row types (§9, Slice 7).

**Idempotency (E24).** Clicking the same value twice produces the identical URL, so the second click
is a **no-op** — it does not toggle the filter off. Removal is the chip's `✕`.

## 6. Interaction grammar

**Primary — click the value → filter the current context. Secondary — icon buttons → today's action.**

| Row                                               | Click value →                         | Icons →                                 |
| ------------------------------------------------- | ------------------------------------- | --------------------------------------- |
| Camera `Apple iPhone 17 Pro Max`                  | `make` + `model`                      | 🔍 filter across whole library          |
| Lens                                              | `lensModel`                           | 🔍                                      |
| Location `Berlin` / `State of Berlin` / `Germany` | `city` / `state` / `country`          | 🗺️ full map (carries context) · ✏️ edit |
| Date                                              | that day                              | ✏️ edit date                            |
| Filename                                          | `originalFileName`                    | ⓘ toggle path → folder                  |
| Tags (chips)                                      | `tagIds`                              | ↗ `/tags/{path}`                        |
| People (chips)                                    | `personIds`                           | ↗ person page                           |
| Shared by                                         | `ownerId`                             | —                                       |
| ISO, exposure, ƒ, focal, MP, dims, size           | _plain text — no filter field exists_ | —                                       |

**Three justified exceptions** (the value is already an interactive control, so filtering becomes the
icon):

| Row                    | Primary stays                    | Filter via     |
| ---------------------- | -------------------------------- | -------------- |
| Rating ⭐              | stars **set** the rating (owner) | ⚗️ filter icon |
| Description            | textarea **edits**               | ⚗️ filter icon |
| Appears-in album cards | card **opens the album**         | ⚗️ filter icon |

**The 🔍 "search everywhere" icon** replaces the deprecated `Route.search(...)` link: it applies the
same patch against `/photos` globally. It is **hidden when the current target is already `/photos`**
(E5).

## 7. #767 — map ignores active filters

Three distinct bugs:

| Half  | Bug                                                                                                              | This spec                   |
| ----- | ---------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **a** | `space-map.svelte:13` builds `/map?spaceId=<id>` — drops `q` and every filter param                              | ✅ Slice 4                  |
| **b** | Map page never hydrates filters from the URL (`map/…/+page.svelte:72`)                                           | ✅ Slice 4                  |
| **c** | Map markers **cannot do smart search** — `buildMapMarkerOptions` has no `query`; `/map/markers` is metadata-only | ⚠️ Slice 5 (honest failure) |

Half (c) is the reporter's exact repro (`?q=ski`). The conclusion below (be honest instead of
pretending) is right — but **the mechanism assumed here was wrong, and the fix that shipped is not
the one described**. Corrected, because the difference matters for anyone reasoning about `q` on the
map:

- The map page **already had a client-side `q` intersection loop** (shipped with #412): it pages
  `searchSmart` and keeps the markers whose ids come back. `q` was never simply "dropped".
- Smart search does **not** return the whole library. What it returns is a **ranked** result set; the
  CLIP-distance predicate is only applied when `machineLearning.clip.maxDistance` is configured in
  `(0, 2)`. Without that cutoff nothing is _excluded_ from the ranking, so the intersection loop had
  nothing to narrow — and it paged the ranked list **to exhaustion** (one request per 100 assets),
  matched every marker, and rendered them all. `maxDistance` defaults to `0`, so that was the
  default experience.
- **Slice 5 therefore shipped a server feature-flag GATE on that loop**, not a "carry `q` + notice"
  redesign: `ServerFeaturesDto` publishes a derived `smartSearchHasCutoff` (the client cannot read
  admin config), the map runs the intersection **only** when it is true, and otherwise applies every
  structured filter and renders the notice saying the smart-search term is not applied here.

Do not reintroduce the claim that smart search "returns the whole library" — it does not, and a fix
built on that premise would be aimed at the wrong component. The `q`-on-map gap (server-side
geotagged smart search) remains a follow-up.

## 8. Edge-case matrix

| #       | Edge case                                                                                        | Expected behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1      | `albumId` + `isInAlbum`/`isNotInAlbum` both present                                              | Codec drops `album=has\|none`; `albumId` wins (mirrors server)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| E2      | Asset viewer open on a **shared link**                                                           | No filter affordances rendered at all (no `/photos` to reach)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| E3      | Filter clicked from `/favorites`, `/archive`, `/trash`, `/folders`, `/memories`, person/tag page | Falls back to `/photos` with the filter applied                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| E4      | Person clicked inside a **Space**                                                                | Patch carries the **BARE** `spacePersonId` — **never** the scoped token. A Space sends `FilterState.personIds` as **`spacePersonIds`** (`space-filter-options.ts`, `map-filter-options.ts`), which the server validates as `z.array(z.uuidv4())` (`time-bucket.dto.ts`): a `space-person:<uuid>` token is a zod reject → **400** → the whole Space timeline errors out. Only `personIds` (i.e. `/photos`, an album, the global map) accepts the scoped token, and there it is **required** — the owner's person uuid is invisible to a viewer of a shared-space asset. See §5.5 for the full table, and P1 for the test that pins the shape per surface. _(This row previously said "scoped token, not a bare uuid" — exactly inverted.)_ |
| E5      | Already on `/photos`                                                                             | 🔍 "search everywhere" icon is hidden (would duplicate the primary click)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| E6      | Asset has no EXIF                                                                                | Camera/lens/location rows absent — nothing to click                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| E7      | Empty / whitespace-only metadata value (`make: ''`)                                              | Not rendered as clickable; no filter emitted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| E8      | Non-owner viewing an asset in a Space                                                            | Can filter; **cannot** edit (✏️ stays owner-gated as today)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| E9      | `albumId` filter param while already on `/albums/{id}`                                           | **Ignored.** Not merely redundant — the server's `albumId` is a **scalar** driving one inner join, so a second album cannot be AND-ed. Album∩album is impossible without a server change. **Shipped:** the ⚗️ icon is not offered for the album you are already in (`scopedAlbumId`, from `currentAlbum?.id` or the album target)                                                                                                                                                                                                                                                                                                                                                                                                         |
| E10     | Location pin (🗺️) from within a Space                                                            | Map URL carries `spaceId` **and** the active filters, centered on the asset. **Shipped decision for the surfaces E10 did not name:** `/photos` and `/map` carry their filters to the global map; on an **album** there is **no pin at all** — `AlbumMap` is a modal, there is no album-map URL, so a pin could only land on the **global** map carrying the album's filters but not its scope (a silent widening). `buildContextualMapUrl` returns `null` there and the caller renders nothing. The same rule now governs the DetailPanel's embedded-map "open in map view" control, which used to drop the Space scope and every active filter (#767 class)                                                                              |
| E11     | `Route.map` — query support (**SHIPPED in Slice 4**; it emitted only `/map` + a hash before)     | `Route.map` **takes a query now** and emits `/map?<filters>#<zoom>/<lat>/<lng>`. Nothing left to do here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| E12     | Metadata value with URL-special characters (`/`, `+`, `&` in a lens name)                        | Round-trips through `URLSearchParams` intact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| E13     | Very long description used as a filter                                                           | Emitted `description` param truncated to **200 chars** to bound URL length                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| E14     | Date filter across a timezone boundary                                                           | Uses the asset's **local** date as displayed; no UTC re-bucketing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| E15     | Rating chip label                                                                                | Must read "≥ N stars", not "N stars". **This corrects an existing mislabel** — an intentional fix, not covered by E16                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| E16     | Existing `/photos` + `/spaces` **filter behavior**                                               | **Unchanged** — codec extraction is a pure refactor (regression-tested)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **E17** | **Space viewer** (non-owner) filters by camera/lens/state                                        | Sees matching assets **owned by other members**. The #655 bug class — must not re-scope to the viewer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **E18** | **Space editor** (non-owner) filters by camera/lens/state                                        | Same as E17                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **E19** | **Camera (make/model)** suggestions inside a Space                                               | Include values from **non-owned** assets (`applySuggestionScope:1257-1274`). **Scoped to camera only** — `lens`/`state` have no dropdown in this spec (§3), so there is nothing to suggest                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **E20** | `owner=<user who is not a member of this space>`                                                 | Returns **empty**. Narrows, never widens. No leak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **E21** | `/photos?owner=<stranger>`                                                                       | Returns **empty** (owner-scope `AND` stranger = ∅). No leak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| E22     | **Album viewer** filters by camera on an album owned by someone else                             | Sees the album owner's matching assets (the `:1217-1253` participant branch)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| E23     | Asset viewer opened **from `/map`** (`/map/photos/{assetId}`)                                    | `/map` **is** a filter target — the click lands back on `/map` with the filter applied                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| E24     | Clicking the **same** value twice                                                                | Identical URL → **no-op**. Not a toggle. Removal is the chip's `✕`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| E25     | Clicking a person/tag while a person/tag filter is already active                                | Array is **replaced**, never appended (§5.6). Guarantees **P1**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **P1**  | **Property, all rows, all surfaces**                                                             | After filtering by a value on asset _A_, the result set **contains _A_**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 9. Slices

Each slice is independently shippable and **strictly test-first: write the failing test (RED), then
the code (GREEN).** Every slice lists its BDD scenarios.

**Dependency order.** Slices 1 and 2 are independent and may run in parallel. Slice 2 blocks 3, 4, 6
and 7. Slice 4 blocks 5. Slice 8 requires all.

```
1 (server) ─────────────────────────────────┐
2 (pure web) ──┬── 3 (album) ──┐            ├── 8 (e2e)
               ├── 4 (map) ── 5 (q notice) ─┤
               ├── 6 (chips) ───────────────┤
               └── 7 (panel) ───────────────┘
```

---

### Slice 1 — Server: `lensModel`, `state`, `ownerId`

**Files:** `server/src/dtos/time-bucket.dto.ts`, `server/src/repositories/asset.repository.ts`

**BDD**

```gherkin
Scenario: Filter a timeline by lens model
  Given assets taken with the "iPhone 17 Pro Max back triple camera" lens
  When I request a time bucket with lensModel="iPhone 17 Pro Max back triple camera"
  Then only assets with that lens are returned

Scenario: Filter a timeline by EXIF state
  When I request a time bucket with state="State of Berlin"
  Then only assets whose asset_exif.state equals "State of Berlin" are returned

Scenario: The owner filter narrows within a Space
  Given Space "Fotos Berlin" contains assets owned by Anna and by Ben
  When I request the Space timeline with ownerId=<Anna>
  Then only Anna's contributions to that Space are returned
    And Ben's assets are NOT returned
    And nothing of Anna's outside the Space is returned

Scenario: A Space VIEWER filters by a camera they do not own   # E17 — the #655 bug class
  Given Space "Fotos Berlin" contains Anna's iPhone assets and Ben's Canon assets
    And I am a VIEWER of the Space and own neither
  When I request the Space timeline with make="Apple"
  Then Anna's iPhone assets ARE returned
    And the result is NOT re-scoped to assets I own

Scenario: A Space EDITOR filters by a lens they do not own     # E18
  Given I am an EDITOR of a Space containing another member's assets
  When I filter the Space timeline by that member's lensModel
  Then their matching assets are returned

Scenario: Camera suggestions in a Space include other members' cameras   # E19
  Given a Space contains Anna's iPhone assets and Ben's Canon assets
    And I am a viewer who owns neither
  When I request filter suggestions for that Space
  Then both "Apple" and "Canon" appear in cameraMakes

Scenario: The owner filter cannot leak a non-member's library   # E20/E21
  Given "Carol" is not a member of any Space I belong to
  When I request a time bucket with ownerId=<Carol>
  Then the result is EMPTY
    And no asset of Carol's is disclosed

Scenario: An album viewer filters by the album owner's camera   # E22
  Given an album shared with me, owned by Anna, containing Anna's assets
  When I filter that album by Anna's camera make
  Then Anna's matching assets are returned
```

**TDD steps**

1. **RED** — unit tests in the asset-repository suite asserting the generated SQL for `lensModel`,
   `state` and `ownerId`.
2. **GREEN** —
   - Add the three fields to `TimeBucketQueryBaseSchema` and `TimeBucketOptions`.
   - In `withTimeBucketAssetFilters`: extend the `asset_exif` inner-join `$if` predicate (`:267-274`)
     to include `lensModel` and `state`; add exact-match `=` conditions alongside `make`/`model`.
   - Add `ownerId` as a **separate top-level** condition:
     `.$if(!!options.ownerId, (qb) => qb.where('asset.ownerId', '=', asUuid(options.ownerId!)))`.
     **Do not** route it through `userIds` (§4.2).
3. **RED → GREEN, RBAC medium tests (E17–E22) — the highest-value tests in this spec.**
   They require a **two-owner Space fixture** (Anna + Ben both contributing to one Space; the acting
   user is a member who owns neither). **A single-owner fixture passes vacuously** and would hide both
   the #655 bug class and the `ownerId`/`userIds` trap.
4. `pnpm build && pnpm sync:open-api && make open-api`.

**Done when:** timeline queries honor the three new fields; **non-owners can filter assets they do
not own inside a Space**; `ownerId` provably narrows and never widens; SDK regenerated; **no migration
added**.

---

### Slice 2 — Web: shared filter-URL codec + `resolveFilterTarget` (pure functions, no UI)

**Files:** `web/src/lib/utils/filter-url.ts` (new), `web/src/lib/utils/filter-target.ts` (new),
`web/src/lib/components/filter-panel/filter-panel.ts`, `web/src/lib/utils/searchable-page-search.ts`

This slice carries most of the edge-case burden — everything here is a plain function, so the cases
are cheap unit tests rather than component tests.

**BDD**

```gherkin
Scenario: Every filter field round-trips through the URL
  Given a FilterState with every field populated
  When it is encoded to URL params and decoded back
  Then the decoded FilterState equals the original

Scenario: The codec never emits albumId together with album=has|none   # E1
  Given a FilterState with albumId=<A> AND isInAlbum=true
  When it is encoded
  Then the params contain "albumId=<A>"
    And the params do NOT contain "album=has" or "album=none"

Scenario: Empty and whitespace-only values emit no param            # E7
  Given a FilterState with make="   "
  When it is encoded
  Then no "make" param is emitted

Scenario: Values with URL-special characters round-trip intact       # E12
  Given a lens model "FE 24-70mm F2.8 GM / II + adapter & hood"
  When it is encoded and decoded
  Then the decoded lensModel equals the original exactly

Scenario: A long description is truncated                            # E13
  Given a description of 500 characters
  When it is encoded
  Then the "description" param is exactly 200 characters

Scenario: Resolving a filter target from each surface
  Given the URL "/photos/<assetId>"          Then the target is photos
  Given the URL "/spaces/<id>/photos/<a>"    Then the target is space with that spaceId
  Given the URL "/albums/<id>/photos/<a>"    Then the target is album with that albumId
  Given the URL "/map/photos/<assetId>"      Then the target is map            # E23
  Given the URL "/favorites/<assetId>"       Then the target is null           # E3

Scenario: A filter patch merges with, rather than replaces, active filters
  Given the URL "/spaces/<id>?people=<anna>"
  When I build a contextual filter URL with patch { make: "Apple" }
  Then the result contains BOTH "people=<anna>" AND "make=Apple"

Scenario: Array patches REPLACE rather than append                   # E25
  Given the URL "/photos?tags=<beach>"
  When I build a contextual filter URL with patch { tagIds: ["<sunset>"] }
  Then the result contains "tags=<sunset>"
    And it does NOT contain "<beach>"

Scenario: The global option escapes the current context
  Given the URL "/spaces/<id>/photos/<assetId>"
  When I build a contextual filter URL with { global: true }
  Then the result base path is "/photos", not the space

Scenario: The one-shot scroll target is dropped
  Given the URL "/photos?at=<assetId>"
  When I build any contextual filter URL
  Then the result contains no "at" param

Scenario: Clicking the same value twice is a no-op                   # E24
  Given the URL "/photos?make=Apple&model=iPhone%2017%20Pro%20Max"
  When I build a contextual filter URL with the same { make, model } patch
  Then the resulting URL is identical to the current URL

Scenario: Existing photos/spaces behavior is unchanged               # E16
  Given the codec has been extracted into filter-url.ts
  Then every pre-existing searchable-page-search test still passes unmodified
```

**TDD steps**

1. **RED** — port the existing `searchable-page-search` tests as-is (they must pass **unmodified** —
   that is the E16 regression guard), then add the new scenarios above as failing tests.
2. **GREEN** — extract the codec; add `lens`/`state`/`albumId`/`owner`; add the four `FilterState`
   fields; update `createFilterState`, `clearFilters`, `getActiveFilterCount`.
3. **RED → GREEN** — `resolveFilterTarget(url)`.
4. **RED → GREEN** — `buildContextualFilterUrl(url, patch, opts)`.

**Done when:** the pure layer is fully covered and `/photos` + `/spaces` behave identically.

---

### Slice 3 — Web: album page becomes URL-backed

**Files:** `albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte`

**BDD**

```gherkin
Scenario: Album filters survive a reload
  Given I am on an album filtered to make=Apple
  When I reload the page
  Then the camera filter is still active

Scenario: Album filters are shareable
  When I open "/albums/<id>?make=Apple" directly
  Then the album timeline is filtered to make=Apple
    And the filter panel shows the camera filter as active

Scenario: Browser back/forward steps through album filter states
  Given I apply a camera filter, then a rating filter, on an album
  When I press Back
  Then only the camera filter is active

Scenario: An albumId filter param on its own album page is ignored   # E9
  When I open "/albums/<A>?albumId=<B>"
  Then the albumId param is ignored and the album <A> timeline renders normally
```

**TDD steps**

1. **RED** — page tests for hydrate-from-URL, write-to-URL, and react-to-URL-change.
2. **GREEN** — mirror the photos page loop exactly: hydrate `albumFilters` from the codec on load,
   `syncFilterUrl` on change, and a `$effect` reacting to URL changes
   (`photos/…/+page.svelte:434-452`, `:506-534`). **Copy the `lastHandledSearchState` token guard
   (`:508-513`) verbatim** or you will create a `goto` → `$effect` → `goto` loop.

**Done when:** an album's filters survive reload, back/forward, and a shared URL. E9.

---

### Slice 4 — Web: map page becomes URL-backed + map links carry filters (#767 a+b)

**Files:** `map/…/+page.svelte`, `map/…/MapTimelinePanel.svelte`,
`web/src/lib/utils/map-filter-options.ts`, `web/src/lib/components/spaces/space-map.svelte`,
`web/src/lib/components/album-page/AlbumMap.svelte`, `web/src/lib/route.ts`, **plus the server half
of the album map:** `server/src/services/shared-space.service.ts` and
`e2e/src/specs/server/api/gallery-map.e2e-spec.ts`.

> **The album-map RBAC fix is issue #656, not #655.** (#655 is the album-suggestions bug quoted in
> §4.4; this spec says "#655" throughout, which is the wrong number for the map half.) Scoping the
> album map's markers by asset OWNER hid the album owner's pins from a viewer of a shared album; the
> server must let album **access** be the scope — check `AlbumRead`, leave `userIds` unset so the
> query takes its album branch — exactly as the album grid does. That is server work, and it needs
> an e2e that a non-owner sees the owner's pins.

**BDD**

```gherkin
Scenario: Structured filters carry from a Space to the map          # E10
  Given I am on Space "Fotos Berlin" filtered to make=Apple
  When I click the map icon in the top bar
  Then the map URL carries spaceId AND make=Apple
    And the map shows only geotagged assets in that Space with make=Apple

Scenario: Map filters round-trip through the URL
  When I open "/map?spaceId=X&make=Apple" directly
  Then the map's filter panel shows the camera filter as active

Scenario: The album map MODAL honours the album's active filters
  # NB: AlbumMap is a modal rendered over the album page — there is no album-map URL and no
  # "album map link". It fetches filtered markers for the album scope directly.
  Given I am on an album filtered to rating>=4
  When I open the album map
  Then the modal shows only that album's geotagged assets with rating>=4

Scenario: A viewer of a shared album sees the OWNER's pins           # #656
  Given I am a non-owner viewer of an album
  When I open the album map
  Then I see pins for the album owner's geotagged assets

Scenario: Route.map emits query params AND a hash                   # E11
  When I build a map route with filters and a centre point
  Then the URL is "/map?<filters>#<zoom>/<lat>/<lng>"
```

**TDD steps**

1. **RED** — tests: `/map?spaceId=X&make=Apple` hydrates the camera filter; `space-map.svelte`'s link
   carries active filters; `AlbumMap.svelte` (the modal) fetches markers for the album scope **with**
   the album's active filters; `Route.map` emits query + hash together (E11); a non-owner viewer gets
   the album owner's pins (#656, e2e + service unit test).
2. **GREEN** —
   - Extend `Route.map` to accept filter params (`route.ts:89-90` currently emits hash only).
   - Hydrate the map's `filters` from the codec, replacing the always-empty `createFilterState()`
     (`map/…/+page.svelte:72`), and write them back with `buildFilterStateUrl` behind the
     `isFilterStateUrlUnchanged` / `withoutAtParam` guards (§5.4).
   - Build `space-map.svelte`'s `mapUrl` from live filter state instead of the hardcoded
     `/map?spaceId=<id>` (`:13`). `AlbumMap.svelte` is a **modal**, not a link — pass it the album's
     live `FilterState` and have it call the filtered-marker endpoint with an album scope.
   - Server: scope album markers by album **access**, not by asset owner (#656).

**Done when:** #767 (a) and (b) are fixed, and a shared-album viewer sees the owner's pins. E10, E11.

---

### Slice 5 — Web: honest `q` handling on the map (#767 c)

**Files:** `map/…/+page.svelte`, `i18n/en.json`, **and the server flag the gate reads:**
`server/src/dtos/server.dto.ts` (`ServerFeaturesDto.smartSearchHasCutoff`),
`server/src/services/server.service.ts` (derives it from `machineLearning.clip.maxDistance`), plus an
**SDK regeneration** (`make open-api`) — the web client cannot read admin config, so the flag has to
travel through the features endpoint. See the corrected §7(c): the deliverable is a **gate on the
existing client-side intersection loop**, not a new "carry `q`" mechanism.

**BDD**

```gherkin
Scenario: The map is honest about a smart search it cannot apply
  Given the instance has NO CLIP distance cutoff (machineLearning.clip.maxDistance = 0)
    And I am on a Space with an active smart search "?q=ski"
  When I switch to the map view
  Then every structured filter IS applied
    And an explicit notice states the smart-search term is not applied on the map
    And the client-side intersection loop does NOT run (it could not narrow anything,
        and it would page the ranked result set to exhaustion)

Scenario: The intersection still runs on an instance that CAN narrow
  Given the instance has a CLIP distance cutoff (smartSearchHasCutoff = true)
    And I am on the map with "?q=ski"
  Then the markers are intersected with the smart-search result ids
    And NO notice is shown — the term genuinely was applied

Scenario: No notice when there is no smart search
  Given I am on the map with only structured filters
  Then no smart-search notice is shown
```

**TDD steps**

1. **RED** — component tests: with `q` and **no** cutoff, the notice renders, the structured filters
   still apply and `searchSmart` is **never called**; with `q` and a cutoff, the markers are
   intersected and no notice renders; without `q`, no notice.
2. **GREEN** — publish `smartSearchHasCutoff` on `ServerFeaturesDto` (derived in `server.service.ts`
   from `machineLearning.clip.maxDistance ∈ (0, 2)`), regenerate the SDK, gate the existing
   intersection loop on it, and render the notice otherwise. Add the i18n key to **`i18n/en.json`
   only** (other locales fall back — see the shared web+mobile `i18n/` dir).

**Done when:** the reporter's `?q=ski` repro shows filtered results plus a clear explanation, and the
default (cutoff-less) instance no longer pages the whole ranked result set to exhaustion only to
render every marker anyway.

---

### Slice 6 — Web: active-filter chips for the new dimensions

**Files:** `web/src/lib/components/filter-panel/active-filters-bar.svelte`,
`web/src/lib/utils/photos-filter-options.ts`, **`web/src/lib/utils/space-filter-options.ts`**,
their two spec files, `i18n/en.json`

> ⚠️ **There are TWO remove handlers**, not one: `handlePhotosRemoveFilter`
> (`photos-filter-options.ts:115`, used by `/photos`, `/albums` and `/map`) **and**
> `handleSpaceRemoveFilter` (`space-filter-options.ts:63`, used by `/spaces`). **Both** need the new
> cases, or the new chips will be **unremovable inside a Space**.

**BDD**

```gherkin
Scenario: The new dimensions render as removable chips
  Given a filter with lens, albumId and owner active
  Then a chip is shown for each, with a resolved display name (not a raw UUID)

Scenario: Removing a chip clears its filter — on /photos AND in a Space
  Given a lens filter is active
  When I click the chip's ✕ on /photos
  Then the lens filter is cleared
  And likewise when I click it inside a Space

Scenario: The location chip clears city, state AND country together
  Given city, state and country are all active
  When I remove the location chip
  Then all three are cleared

Scenario: The rating chip reads "≥ N stars"                          # E15
  Given a rating filter of 4
  Then the chip label reads "≥ 4 stars", not "4 stars"
```

**TDD steps**

1. **RED** — chip-rendering tests + removal tests against **both** handler spec files
   (`photos-filter-options.spec.ts` and `space-filter-options.spec.ts`).
2. **GREEN** — add chips for `lens`, `albumId`, `owner`; fold `state` into the existing `location`
   chip (which already clears `city` + `country` together — it now clears all three, matching how the
   `camera` chip clears `make` + `model`). Add album/owner name resolution following the existing
   `personNames` / `tagNames` map pattern. Fix the rating label (E15). New i18n keys in `en.json`.

---

### Slice 7 — Web: the DetailPanel grammar (4 sub-slices)

Component tests for every row: correct patch emitted, correct target URL, owner vs non-owner,
shared-link suppression (E2), and **P1** (the result contains the source asset).

**7a — Camera + lens.** Replace both `Route.search(...)` links (`DetailPanel.svelte:225,259`) with
value→filter plus the 🔍 global icon. Hide 🔍 on `/photos` (E5).

**7b — Location.** Rewrite `DetailPanelLocation.svelte`. It is currently a single `<button>` wrapping
both the value and the pencil; split it into three clickable value lines (city / state / country), a
🗺️ pin, and an owner-gated ✏️. E8, E10.

**7c — Date + filename.** Local date for the date row (E14); basename-without-extension for filename.

**7d — Tags, people, shared-by, and the three inverted rows** (rating, description, appears-in).
Array patches **replace** (E25). The person patch is **target-dependent** — a bare `spacePersonId` inside a
Space, the scoped token elsewhere (E4, §5.5).

**BDD**

```gherkin
Scenario: Filter a Space by camera from the asset viewer
  Given I am viewing an asset inside Space "Fotos Berlin"
    And the asset was taken with an "Apple iPhone 17 Pro Max"
  When I click the camera value in the info panel
  Then the asset viewer closes
    And I land on the Space timeline
    And the URL contains make=Apple and model=iPhone 17 Pro Max
    And a removable "camera" chip is shown

Scenario: Search everywhere escapes the current context
  Given I am viewing an asset inside a Space
  When I click the 🔍 icon on the camera row
  Then I land on /photos filtered by that camera, not on the Space

Scenario: The search-everywhere icon is hidden where redundant     # E5
  Given I am viewing an asset opened from /photos
  Then the camera row shows no 🔍 icon

Scenario: Fallback from a non-filterable context                   # E3
  Given I am viewing an asset opened from /favorites
  When I click the camera value
  Then I land on /photos filtered by that camera

Scenario: Shared links expose no filter affordances                # E2
  Given I am viewing an asset via a shared link
  Then no metadata value in the info panel is clickable as a filter

Scenario: Clicking the city filters the current context
  Given an asset located in Berlin, Germany, viewed inside a Space
  When I click "Berlin"
  Then the Space timeline is filtered to city=Berlin AND country=Germany

Scenario: The map pin opens the map, carrying context and filters  # E10
  Given I am viewing an asset in a Space with a person filter active
  When I click the 🗺️ pin on the location row
  Then I land on /map centered on the asset's coordinates
    And the map URL carries the spaceId AND the person filter

Scenario: The pencil still edits the location
  Given I own the asset
  When I click the ✏️ on the location row
  Then the geolocation picker modal opens

Scenario: Non-owners cannot edit but can filter                    # E8
  Given I do NOT own the asset
  Then the ✏️ is not shown
    And clicking "Berlin" still filters the current context

Scenario: A row with no filter field is not clickable              # E6/E7
  Given an asset with no EXIF, or with an empty make
  Then the camera row is absent, or its value is not clickable

Scenario: Rating stars still set the rating
  Given I own the asset
  When I click the 4th star
  Then the asset's rating is set to 4 (unchanged behavior)

Scenario: The rating filter icon filters by rating
  When I click the ⚗️ icon on the rating row
  Then the context is filtered to rating >= the asset's rating

Scenario: Album cards still navigate
  Given the asset appears in album "Holiday"
  When I click the "Holiday" card
  Then I open the Holiday album (unchanged behavior)
  But when I click the ⚗️ icon on that card
  Then the context is filtered to albumId=<Holiday>

Scenario: Person filters inside a Space use the BARE space-person id  # E4
  Given I am viewing an asset inside a Space
  When I click a person chip
  Then the emitted filter uses the bare "<uuid>" of the space person
  And it does NOT use the "space-person:<uuid>" token, which the Space
      timeline would send as spacePersonIds and the server would reject (400)

Scenario: The same person on /photos uses the scoped token            # E4
  Given I am viewing a shared-space asset on /photos
  When I click a person chip
  Then the emitted filter uses the "space-person:<uuid>" token
  And not the owner's person uuid, which I cannot resolve there

Scenario: Clicking a tag replaces the active tag filter            # E25
  Given the context is filtered to tag "beach"
  When I click the "sunset" tag on an asset
  Then the context is filtered to "sunset" only

Scenario Outline: P1 — the result always contains the source asset  # P1
  Given I am viewing asset A on any surface
  When I click the <row> value
  Then the resulting filtered result set contains A
  And the emitted ids have the shape the server accepts for that surface
      (spacePersonIds: a bare uuid; personIds: uuid | person:uuid | space-person:uuid)
  Examples: | row |
            | camera | lens | city | state | country | date | filename |
            | tag | person | owner | rating | description | album |
```

---

### Slice 8 — e2e (Playwright)

Against the `make e2e` stack on **:2285** (not the dev `:2283` stack).

**BDD**

```gherkin
Scenario: Filter within a Space, an Album, and /photos
  Given an asset open in a Space / an Album / /photos
  When I click its camera value
  Then that surface's timeline is filtered and a camera chip is shown
    And on /photos, no 🔍 icon is present

Scenario: The location pin reaches the map with context
  When I click the 🗺️ pin on an asset inside a Space
  Then /map opens centered on the asset, carrying the spaceId

Scenario: A filtered Space carries its filter to the map           # #767
  Given a Space filtered to make=Apple
  When I click the map icon
  Then the map is filtered to make=Apple

Scenario: RBAC — a viewer filters by another member's camera       # E17, MUST NOT be cut
  Given I am a VIEWER of a Space containing another member's assets
  When I open one of THEIR assets and click its camera value
  Then THEIR matching assets are shown
```

The RBAC scenario is the end-to-end proof of §4.4 and **must not be dropped for time**.

## 10. Coverage traceability

| Case     | Covered by                  | Test type              |
| -------- | --------------------------- | ---------------------- |
| E1       | Slice 2                     | unit (codec)           |
| E2       | Slice 7 (all sub-slices)    | component              |
| E3       | Slice 2, Slice 7            | unit + component       |
| E4       | Slice 7d                    | component              |
| E5       | Slice 2, Slice 7a, Slice 8  | unit + component + e2e |
| E6, E7   | Slice 2, Slice 7            | unit + component       |
| E8       | Slice 7b                    | component              |
| E9       | Slice 3                     | page                   |
| E10      | Slice 4, Slice 7b, Slice 8  | unit + component + e2e |
| E11      | Slice 4                     | unit (`Route.map`)     |
| E12, E13 | Slice 2                     | unit (codec)           |
| E14      | Slice 7c                    | component              |
| E15      | Slice 6                     | component              |
| E16      | Slice 2                     | unit (regression)      |
| E17–E19  | **Slice 1** + Slice 8 (E17) | **medium** + e2e       |
| E20–E22  | **Slice 1**                 | **medium**             |
| E23      | Slice 2                     | unit (target)          |
| E24      | Slice 2                     | unit                   |
| E25      | Slice 2, Slice 7d           | unit + component       |
| **P1**   | Slice 7 (scenario outline)  | component (property)   |

## 11. Testing strategy

- **Strictly TDD.** Every slice starts with a failing test; no production code before RED.
- **The pure layer (Slice 2) carries the edge-case burden** — the codec, target resolution and URL
  merge are plain functions, so most cases are cheap unit tests rather than component tests.
- **RBAC (§4.4) is the highest-risk area** — medium tests in Slice 1 (E17–E22) plus one e2e in
  Slice 8. Both **require a two-owner Space fixture**; with a single owner every RBAC assertion
  passes vacuously and the #655 bug class stays invisible.
- **P1 is a property test** across every filterable row — the cheapest possible guard against a whole
  class of merge bugs.
- **Regression:** the pre-existing `searchable-page-search` tests must pass **unmodified** after the
  codec extraction.

## 12. Verification gates

- Server: `cd server && pnpm test`, `pnpm test:medium`, `make check-server`, `make lint-server`
  (**zero warnings** — server only).
- Web: `cd web && pnpm check:typescript && pnpm lint`. Web lint has **no** `--max-warnings 0`; the
  ~650 pre-existing `better-tailwindcss` warnings are expected — **do not** `eslint --fix` them here.
  `check:svelte` reports 0 files locally; rely on CI Lint/Test Web.
- E2E: the `:2285` `make e2e` stack.
- OpenAPI: `make open-api` after Slice 1; commit the regenerated SDK + Dart client.
- Docs: `prettier --write` on this file (CI Docs Build runs `--check` over all of `docs/`).

## 13. Risks

| Risk                                                                                     | Mitigation                                                                                   |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Non-owners silently get empty results when filtering in a Space (the #655 bug class)** | §4.4; E17–E22 medium tests + an e2e, all on a **two-owner Space fixture**                    |
| **`ownerId` widens instead of narrows → data leak**                                      | §4.4; `ownerId` is a plain AND inside the existing scope; E20/E21 assert empty for strangers |
| **Array append would make people narrow and tags widen**                                 | §5.6 mandates replace; **P1** property test catches any regression                           |
| **New chips unremovable in a Space** (only the photos handler updated)                   | Slice 6 explicitly covers **both** `handlePhotosRemoveFilter` and `handleSpaceRemoveFilter`  |
| Codec extraction silently changes `/photos`/`/spaces` behavior                           | Slice 2 replays the existing tests **unmodified** before adding any new param                |
| Album/map URL-backing introduces a `goto` → `$effect` → `goto` loop                      | Copy the photos page's `lastHandledSearchState` token guard verbatim (`:508-513`)            |
| Icon clutter in the location row (pin + pencil)                                          | Accepted                                                                                     |
| Users expect album cards to navigate                                                     | Kept as an exception (§6)                                                                    |

## 14. Follow-ups (explicitly out of scope)

1. Smart-search (`q`) support on `/map/markers` — the remaining half of #767.
2. Filter-panel dropdowns for `lens` / `state` (suggestion repo support already exists — see §3).
3. Mobile (Flutter) asset-viewer parity.
4. Retiring the `/search` page itself.
5. Correcting the `personIds` DTO description, which says "any" but implements "all" (§4.2).
