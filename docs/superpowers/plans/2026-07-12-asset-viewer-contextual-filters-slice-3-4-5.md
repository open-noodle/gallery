# Asset Viewer Contextual Filters — Slices 3, 4 & 5 (Web: album + map become URL-backed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the URL the single source of truth for filter state on the two surfaces that still keep it in component-local `$state` — `/albums/{id}` and `/map` — then make every map link carry the filters that are active where it was clicked (#767 a+b), and stop the map from silently rendering the whole library when a smart-search term cannot be honored (#767 c).

**Architecture:** Slice 2 already shipped the pure layer (`filter-url.ts` codec, `filter-target.ts`). This plan adds one more pure function (`buildFilterStateUrl`) and then wires the album page and the map page into the same **hydrate → write → react** loop `/photos` and `/spaces` already run: hydrate `FilterState` from the URL on load, `goto()` a rewritten URL when the panel changes, and re-hydrate from a `$effect` guarded by a `lastHandled…` token so the write cannot re-trigger itself. Once both surfaces are URL-backed, "carry the filters to the map" reduces to building an ordinary filter URL: `Route.map` gains query-param support and `space-map.svelte` / `AlbumMap.svelte` build from live filter state instead of a hard-coded string.

**Tech Stack:** SvelteKit, Svelte 5 runes, TypeScript (strict), Vitest + @testing-library/svelte (happy-dom). One small NestJS/Kysely change (Task 3, Step 1) — no DTO change, so **no SDK regeneration**.

**Spec:** `docs/superpowers/specs/2026-07-12-asset-viewer-contextual-filters-design.md` (§7, §8 E9/E10/E11, §9 Slices 3, 4, 5)

---

## Reality check — four places the spec and the task brief disagree with the live code

Read this before writing any code. All four were verified against the working tree; three of them change what the tasks below actually do.

### R1 — `AlbumMap.svelte` is a **modal**, not a link, and pointing an album query at `/gallery/map/markers` walks straight into #656

`web/src/lib/components/album-page/AlbumMap.svelte` has **no URL at all**. It is an `IconButton` that fetches `getAlbumMapMarkers({ ...authManager.params, id: album.id })` (`:44`) and opens `MapModal` (`:52`). It is rendered from **two** places: the album detail page (`+page.svelte:781`) **and** `AlbumViewer.svelte:147`, which is the **shared-link** album view.

And the map-markers endpoint the map page uses (`getFilteredMapMarkers` → `GET /gallery/map/markers` → `SharedSpaceService.getFilteredMapMarkers`, `server/src/services/shared-space.service.ts:718`) is **owner-scoped** when no `spaceId` is given: it passes `userIds: [auth.user.id]` (`:740`). So an `albumId`-filtered marker query returns **only your own pins** and hides the album owner's. `AlbumService.getMapMarkers` (`server/src/services/album.service.ts:112-123`) carries a comment naming this exact bug:

> _"Do not scope by asset owner here; doing so hid the owner's pins from viewers of a shared album (#656)."_

**The bug is NOT reachable today — this slice is what makes it reachable.** An earlier draft of this plan claimed otherwise; that was wrong. `buildMapMarkerOptions` does forward `filters.albumId` (`map-filter-options.ts:64-66`), but nothing ever populates it: the map page's `filters` is a fresh `createFilterState()` (`map/…/+page.svelte:72`) that never reads the URL, the filter panel's `albums` section is has/none only (`filter-panel.svelte:648, :840` — no album picker anywhere; `grep -rn "albumId" web/src/lib/components/filter-panel/*.svelte` returns nothing), and `buildContextualFilterUrl` has **zero call sites** so far (Slice 2 shipped the pure layer only). Task 3's URL hydration is what first lets `albumId` into a live `FilterState`, and Step 5 is what first sends an album query from `AlbumMap`. The server fix is therefore **mandatory in this slice** — it just is not a pre-existing production leak.

**Consequences:**

- The fix needs **no DTO change**: `searchAssetBuilder` already has a purpose-built branch for exactly this — `.$if(!!options.albumIds?.length && !options.userIds, (qb) => albumSharedSpaceScope(qb, options.timelineSpaceIds))` (`server/src/utils/database.ts:713`). So the server has to **check `AlbumRead`, stop passing `userIds`, and compute `timelineSpaceIds`** when `albumId` is set. That is Task 3, Step 1 — and all three halves are load-bearing, see R4.
- `AlbumMap` keeps its modal (no UX change, no shared-link breakage). It gains a `filters` prop and, when it has one, sources markers from the filtered endpoint instead. The shared-link path keeps `getAlbumMapMarkers` untouched (E2: no filter affordances on shared links).

### R2 — The map page **does** have a `q` code path; it is a no-op-by-construction that pages the entire library

The brief says "`buildMapMarkerOptions` has no `query`, so `?q=ski` cannot be honoured, and the map silently renders the entire library." The **conclusion is right**; the **mechanism is not**, and the difference decides what Task 4 must do.

`map/…/+page.svelte:157-205` (added by #412) already intersects markers with smart-search results client-side: it fetches all structured-filter markers, then pages `searchSmart` 100 at a time, breaking when `unmatchedMarkerIds.size === 0`, and keeps only markers whose ids appeared.

**Be precise about what is and isn't broken here — the imprecise version of this claim is wrong and misleading.**

**Smart search itself is fine without `maxDistance`.** A `searchSmart` call is `LIMIT size + 1 OFFSET …` over a distance-**ordered** result set (`:443`, `:499`), so one call returns 100 ranked hits, best first. A cutoff makes results tighter; its absence does not break search and does not dump the library on the user. Any claim like "smart search returns the whole library" is **false** — do not write it, and do not let the notice copy imply it.

**What is broken is the map's paging loop**, and only because of an interaction:

- `search.repository.ts:434-436` — the `(embedding <=> …) <= maxDistance` predicate is the **only** relevance `WHERE`, and it is applied `$if(hasDistanceThreshold, …)`.
- `search.repository.ts:303-304` — `isActiveDistanceThreshold(maxDistance)` is `(maxDistance ?? 0) > 0 && … < 2`.
- `config.ts:334-338` — **`machineLearning.clip.maxDistance` defaults to `0`.**

So with no cutoff, nothing is _excluded_: the ordered result set is the whole scoped library, sorted by distance. The map does not take page 1 and stop — it pages `while (nextPage !== null)` until `unmatchedMarkerIds.size === 0`, and `hasNextPage = items.length > take` (`utils/pagination.ts:12`) keeps `nextPage` advancing until the library is exhausted. Every marker's asset therefore surfaces sooner or later, `matchingIds` ends up ⊇ every marker, and `markers.filter(…)` keeps **all** of them — after up to `library_size / 100` search requests.

The bug is **"the map walks the ranked list to exhaustion, so its intersection cannot narrow"** — not "smart search is broken". Same user-visible symptom as the reporter's #767 ("map shows everything"), plus a request storm; entirely different sentence.

**Two edges this also explains** (do not regress them, but do not scope-creep onto them either): assets with no `smart_search` row never appear in the results at all (`innerJoin`, `:432`), so under today's loop their markers are silently **dropped** while embeddings are still being generated — and with ML disabled outright the loop yields an empty result set and the map goes **blank** under a `q`. The gate below removes both, since the loop stops running in exactly those configurations.

**Consequence — the loop is _conditionally_ correct, so Task 4 gates it rather than deleting it.** On an instance that _has_ configured `clip.maxDistance ∈ (0, 2)`, `searchSmart` genuinely returns only assets inside the cutoff, the loop terminates on real matches, and the intersection is the feature working as intended. On a default instance it narrows nothing and costs `library_size / 100` requests. Deleting it outright would fix the default install by regressing the configured one.

So the server publishes **one derived boolean** and the client obeys it:

- The client cannot compute this itself — `machineLearning.clip.maxDistance` is admin-only config, and the map is a user page.
- The boolean is `smartSearchHasCutoff`, derived exactly like the existing `smartSearch` / `facialRecognition` flags: `isSmartSearchEnabled(machineLearning) && isActiveDistanceThreshold(machineLearning.clip.maxDistance)`. ML off ⇒ no cutoff ⇒ `false`, which is correct (there is nothing to intersect against).
- It goes on **`ServerFeaturesDto`**, not `ServerConfigDto`: `ServerFeatures` is already a bag of config-derived booleans (`server.service.ts:126-130`), and the map page **already** imports `featureFlagsManager` (`+page.svelte:17`) — so the web side needs no new store wiring. (An earlier draft put it on `ServerConfigDto` beside `minFaces`; same precedent, strictly more plumbing.)
- `smartSearchHasCutoff === true` ⇒ run the intersection loop, no notice. `false` ⇒ skip the loop entirely (no request storm) and render an explicit notice that the term is not applied.

The notice therefore appears **exactly when it is telling the truth**, and no instance loses working behaviour. Carrying `q` honestly on every instance (server-side `query` on `/map/markers`) remains the spec's follow-up (§14.1) and would retire both branches.

### R3 — Album and map are **not** "searchable pages", so `buildSearchablePageUrl` cannot serve them

`getSearchablePageBasePath` (`searchable-page-search.ts:37-56`) returns a base path **only** for `/photos` and `/spaces/{id}`; everything else is `null`, and `buildSearchablePageUrl` returns `null` for a `null` base path (`:87-90`). That is why Task 1 exists — and it is also why `getSearchablePageBasePath` must be left alone (it drives ⌘K; spec §3).

### R4 — Dropping `userIds` is only HALF the server fix: for an album query, `timelineSpaceIds` is an RBAC **gate**, not a widener

This is the trap that turns the #656 fix into a different, quieter bug. Read `albumSharedSpaceScope` (`server/src/utils/database.ts:608-618`) before touching the service:

<!-- prettier-ignore -->
```text
albumSharedSpaceScope(qb, timelineSpaceIds) => qb.where(
  OR [
    (a) AND [ asset has NO shared_space_asset row,
              asset.libraryId has NO shared_space_library row ],

    (b) …only present when timelineSpaceIds is set…
        asset has a shared_space_asset row with spaceId IN (timelineSpaceIds),
        asset.libraryId has a shared_space_library row with spaceId IN (timelineSpaceIds),
  ]
)
```

With `timelineSpaceIds === undefined` the `(b)` arms **do not exist** and only `(a)` survives: an album asset is visible **only if it lives in no shared space at all**. So if you drop `userIds` but leave `timelineSpaceIds` unset, every album asset that also sits in a shared space silently loses its pin — and if the user shared a whole **library** into a space, the album map goes **completely empty**. That is a worse failure than #656 (it hits the album **owner** too, not just viewers) and no mock-argument test can see it.

`getFilteredMapMarkers` computes `timelineSpaceIds` only under `!dto.spaceId && dto.withSharedSpaces && dto.isFavorite !== true` (`shared-space.service.ts:723-729`), and `buildAlbumMapMarkerOptions` deliberately sends **no** `withSharedSpaces` — so without the fix in Task 3 Step 1b, `timelineSpaceIds` is exactly `undefined` on every album query.

The canonical shape is already in the codebase — `SearchService.searchMetadata` (`search.service.ts:140-152`) does all three halves together:

```ts
if (dto.albumIds && dto.albumIds.length > 0) {
  await this.requireAccess({ auth, ids: dto.albumIds, permission: Permission.AlbumRead });
} else if (auth.sharedLink) {
  throw new BadRequestException('Shared link access is only allowed in combination with an albumIds filter');
} else {
  userIds = await this.getUserIdsToSearch(auth, dto.visibility);
}
// …
const timelineSpaceIds = await this.getTimelineSpaceIds(auth, dto.withSharedSpaces || !!dto.albumIds?.length);
```

Copy it: **AlbumRead + no `userIds` + `timelineSpaceIds` computed whenever an album is in play.**

---

## Global Constraints

- **Web lint has NO `--max-warnings 0`.** `pnpm lint` prints ≈640 pre-existing `better-tailwindcss` warnings and **exits 0**. Required: **0 errors**. **Never run `eslint --fix` across the package** — it rewrites dozens of unrelated files.
- **`pnpm check:svelte` reports 0 files locally** (a known no-op). Use `pnpm check:typescript` and rely on CI Lint/Test Web for svelte-check.
- Run web commands from `web/`. The test command is **`pnpm test --run <path>`** (not `-- --run`).
- **Do not edit `web/src/lib/utils/__tests__/searchable-page-search.spec.ts`.** It is the E16 regression guard from Slice 2 and must keep passing unmodified.
- **Do not touch `getSearchablePageBasePath` / `getSearchablePageState` / `buildSearchablePageUrl`.** `/photos` and `/spaces` must not change behavior in this plan at all.
- **`selectedYear` / `selectedMonth` are transient and are NOT in the URL codec** — but they _do_ drive `takenAfter`/`takenBefore` through `buildFilterContext` (`filter-panel.ts:210-218`). Any page that round-trips its `FilterState` through the URL therefore **must** carry them across the round trip with `pendingFilterUrlSync` + `preserveTransientTemporalFilters`, exactly like `/photos` (`photos/…/+page.svelte:128-130, 434-452, 508-524`).
  **Be precise about when this bites** (an earlier draft of this plan overstated it): picking a year **alone** writes nothing to the URL, so `syncAlbumFilterUrl` early-returns, no `goto` fires, no re-hydrate happens, and the picker keeps its year. The album's existing temporal test (`page.route.spec.ts:331-354`) therefore does **not** go red without the carry-over. It bites when a year is combined with a **URL-encoded** filter: pick 2024, then pick a person → the URL write fires → the `$effect` re-hydrates from `decodeFilterParams`, which knows nothing about `selectedYear` → the year (and its `takenAfter`/`takenBefore`) silently vanishes. That combination has **no existing test**, so Task 2 adds one (Step 1, "carries a transient year across a URL-writing filter change") — otherwise `pendingFilterUrlSync` ships unexercised.
- **Copy the `lastHandledSearchState` token guard** (`photos/…/+page.svelte:508-513`) into every new URL `$effect`. Without it: `goto` → `$effect` → `goto` → infinite loop.
- **i18n: add new keys to `i18n/en.json` ONLY.** The repo-root `i18n/` directory is **shared by web and mobile** (web aliases `$i18n` to it); other locales fall back to English.
- Server (Task 3, Step 1 only): `pnpm lint` there **is** zero-warning, and `pnpm format` (prettier `--check`) is a CI gate — run `pnpm format:fix` before committing.
- **No `Co-Authored-By` or `Generated-with` trailers in commits.**

## File Structure

| File                                                             | Change     | Responsibility                                                                       |
| ---------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| `web/src/lib/utils/filter-target.ts`                             | Modify     | Add `buildFilterStateUrl(url, filters)` + `isFilterStateUrlUnchanged(url, next)`     |
| `web/src/lib/utils/__tests__/filter-target.spec.ts`              | Modify     | Tests for both new functions                                                         |
| `web/src/test-data/mocks/reactive-page.mock.svelte.ts`           | **Create** | A `$state`-backed `page` stand-in, so a URL `$effect` can actually be tested         |
| `web/src/routes/(user)/albums/[albumId=id]/…/+page.svelte`       | Modify     | Album filters hydrate from / write to the URL (Slice 3, E9)                          |
| `web/src/routes/(user)/albums/[albumId=id]/…/page.route.spec.ts` | Modify     | `$app/state` + `$app/navigation` mocks; hydrate / write / back-forward / E9          |
| `server/src/services/shared-space.service.ts`                    | Modify     | `albumId` ⇒ `AlbumRead` + no owner scope + `timelineSpaceIds` (#656 class, R4)       |
| `server/src/services/shared-space.service.spec.ts`               | Modify     | Unit tests for the album scope on `/gallery/map/markers`                             |
| `e2e/src/specs/server/api/gallery-map.e2e-spec.ts`               | Modify     | **Behavioural** album-scope tests: viewer sees owner pins; space asset keeps its pin |
| `web/src/lib/route.ts`                                           | Modify     | `Route.map` gains query params → `/map?<filters>#<zoom>/<lat>/<lng>` (E11)           |
| `web/src/lib/route.spec.ts`                                      | Modify     | `Route.map` query + hash tests (E11)                                                 |
| `web/src/routes/(user)/map/…/+page.svelte`                       | Modify     | Map filters hydrate from / write to the URL (Slice 4b); gated `q` notice (Slice 5)   |
| `web/src/routes/(user)/map/…/map-page.spec.ts`                   | Modify     | Hydrate / write tests; **re-point** the two intersection tests at the gate; notice   |
| `web/src/lib/components/spaces/space-map.svelte`                 | Modify     | Build the map URL from the space's live filter state (#767 a, E10)                   |
| `web/src/lib/components/spaces/space-map.spec.ts`                | Modify     | Link carries `spaceId` + `q` + filters                                               |
| `web/src/routes/(user)/spaces/[spaceId]/…/+page.svelte`          | Modify     | Pass `filters` + `searchQuery` into `<SpaceMap>` (`:994`)                            |
| `web/src/lib/utils/map-filter-options.ts`                        | Modify     | Add `buildAlbumMapMarkerOptions(albumId, filters)`                                   |
| `web/src/lib/utils/__tests__/map-filter-options.spec.ts`         | Modify     | Tests for the album marker options                                                   |
| `web/src/lib/components/album-page/AlbumMap.svelte`              | Modify     | Optional `filters` prop → filtered markers + abort/stale guards                      |
| `web/src/lib/components/album-page/__tests__/AlbumMap.spec.ts`   | **Create** | Filtered vs shared-link marker source; no toast on a superseded request              |
| `server/src/dtos/server.dto.ts`                                  | Modify     | `ServerFeaturesSchema` gains `smartSearchHasCutoff` (Slice 5)                        |
| `server/src/services/server.service.ts`                          | Modify     | Derive `smartSearchHasCutoff` in `getFeatures()` (Slice 5)                           |
| `server/src/services/server.service.spec.ts`                     | Modify     | `smartSearchHasCutoff` true/false/ML-off cases (Slice 5)                             |
| `open-api/…` (generated)                                         | Regenerate | SDK carries the new feature flag (`make open-api`)                                   |
| `i18n/en.json`                                                   | Modify     | `map_smart_search_not_applied` (Slice 5)                                             |

---

### Task 1: `buildFilterStateUrl(url, filters)` — write a COMPLETE `FilterState` into the current URL

**Files:**

- Modify: `web/src/lib/utils/filter-target.ts`
- Modify: `web/src/lib/utils/__tests__/filter-target.spec.ts`

**Interfaces:**

- Consumes: `clearFilterParams`, `encodeFilterParams` from `$lib/utils/filter-url` (already imported in `filter-target.ts:2`).
- Produces: `buildFilterStateUrl(url: URL, filters: FilterState): string` and `isFilterStateUrlUnchanged(url: URL, nextUrl: string): boolean` — both consumed by Tasks 2 and 3.

**Why this is a separate function and not `buildContextualFilterUrl(url, filters)`:** `buildContextualFilterUrl` decodes the URL and merges (`filter-target.ts:70-74`). Passing a full state as the "patch" would still merge it onto the decoded URL — so any field the caller **cleared** (`undefined` in `filters`) would silently survive from the URL and could never be removed. `buildFilterStateUrl` is a **replace**, not a merge: it deletes every filter param and re-emits from `filters` alone.

**Why `isFilterStateUrlUnchanged` exists (and why the no-op guard cannot be a string compare):** `buildFilterStateUrl` **re-orders** params — it copies the current `URLSearchParams`, `delete`s the filter keys, then re-appends them at the end. So `/map?make=Apple&spaceId=s1` rebuilds as `/map?spaceId=s1&make=Apple`: a different **string** with identical **meaning**. A raw `nextUrl === pathname + search + hash` guard would see "changed", fire a `goto`, and burn one spurious `replaceState` (and one extra `$effect` pass) on the first panel interaction after landing on such a URL. Compare canonicalised param **sets** instead.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/utils/__tests__/filter-target.spec.ts`. Extend the existing import line to pull in the new functions and the `FilterState` helpers:

```ts
import {
  buildContextualFilterUrl,
  buildFilterStateUrl,
  isFilterStateUrlUnchanged,
  resolveFilterTarget,
} from '$lib/utils/filter-target';
import { createFilterState, type FilterState } from '$lib/components/filter-panel/filter-panel';
```

Then add the new describe block at the end of the file:

```ts
describe('buildFilterStateUrl', () => {
  const state = (overrides: Partial<FilterState> = {}): FilterState => ({ ...createFilterState(), ...overrides });

  it('writes the complete state into the current path', () => {
    const url = buildFilterStateUrl(new URL('https://g.test/albums/al1'), state({ make: 'Apple', rating: 4 }));

    expect(url).toContain('/albums/al1');
    expect(url).toContain('make=Apple');
    expect(url).toContain('rating=4');
  });

  // THE anti-merge test. buildContextualFilterUrl would keep `rating=4` here, because it decodes
  // the URL first and merges. A complete state must REPLACE: a field the caller cleared has to
  // disappear from the URL, or a filter could never be removed.
  it('drops filter params that are absent from the state (replace, never merge)', () => {
    const url = buildFilterStateUrl(new URL('https://g.test/albums/al1?make=Apple&rating=4'), state({ make: 'Apple' }));

    expect(url).toContain('make=Apple');
    expect(url).not.toContain('rating');
  });

  it('clears every filter param for an empty state', () => {
    const url = buildFilterStateUrl(new URL('https://g.test/albums/al1?make=Apple&people=person:p1'), state());

    expect(url).toBe('/albums/al1');
  });

  it('keeps non-filter params (q, sort, spaceId, view)', () => {
    const url = buildFilterStateUrl(
      new URL('https://g.test/map?spaceId=s1&q=ski&sort=asc&view=timeline'),
      state({ make: 'Apple' }),
    );

    expect(url).toContain('spaceId=s1');
    expect(url).toContain('q=ski');
    expect(url).toContain('sort=asc');
    expect(url).toContain('view=timeline');
    expect(url).toContain('make=Apple');
  });

  it('drops the one-shot `at` scroll target', () => {
    const url = buildFilterStateUrl(new URL('https://g.test/albums/al1?at=asset-9'), state({ make: 'Apple' }));

    expect(url).not.toContain('at=');
  });

  // The map stores its viewport in the hash. Losing it re-centres the map on every filter change.
  it('preserves the hash', () => {
    const url = buildFilterStateUrl(new URL('https://g.test/map?spaceId=s1#12.5/52.52/13.4'), state({ make: 'Apple' }));

    expect(url).toBe('/map?spaceId=s1&make=Apple#12.5/52.52/13.4');
  });

  // The write-back loop can fire while the asset viewer is open; it must not close it. (This is the
  // deliberate difference from buildContextualFilterUrl, which targets the BASE path precisely so a
  // single goto() both closes the viewer and applies the filter.)
  it('keeps the current path, including an open asset viewer', () => {
    const url = buildFilterStateUrl(new URL('https://g.test/albums/al1/photos/asset-1'), state({ make: 'Apple' }));

    expect(url).toBe('/albums/al1/photos/asset-1?make=Apple');
  });

  it('is idempotent', () => {
    const filters = state({ make: 'Apple', model: 'iPhone 17 Pro Max', tagIds: ['t1'] });
    const once = buildFilterStateUrl(new URL('https://g.test/albums/al1?rating=4'), filters);
    const twice = buildFilterStateUrl(new URL(`https://g.test${once}`), filters);

    expect(twice).toBe(once);
  });
});

describe('isFilterStateUrlUnchanged', () => {
  const state = (overrides: Partial<FilterState> = {}): FilterState => ({ ...createFilterState(), ...overrides });

  it('is true when the rebuilt URL is identical', () => {
    const url = new URL('https://g.test/map?spaceId=s1&make=Apple');

    expect(isFilterStateUrlUnchanged(url, buildFilterStateUrl(url, state({ make: 'Apple' })))).toBe(true);
  });

  // THE reason this function exists. buildFilterStateUrl deletes the filter params and re-appends
  // them last, so `?make=Apple&spaceId=s1` comes back as `?spaceId=s1&make=Apple` — a different
  // string with the same meaning. A raw string compare would report "changed" and burn a spurious
  // replaceState on the first panel interaction.
  it('is true when only the param ORDER differs', () => {
    const url = new URL('https://g.test/map?make=Apple&spaceId=s1');
    const next = buildFilterStateUrl(url, state({ make: 'Apple' }));

    expect(next).toBe('/map?spaceId=s1&make=Apple'); // re-ordered, on purpose
    expect(next).not.toBe(url.pathname + url.search + url.hash); // …so a string compare would lie
    expect(isFilterStateUrlUnchanged(url, next)).toBe(true);
  });

  it('is false when a filter param is added, changed or removed', () => {
    const url = new URL('https://g.test/map?spaceId=s1&make=Apple');

    expect(isFilterStateUrlUnchanged(url, '/map?spaceId=s1&make=Apple&rating=4')).toBe(false);
    expect(isFilterStateUrlUnchanged(url, '/map?spaceId=s1&make=Canon')).toBe(false);
    expect(isFilterStateUrlUnchanged(url, '/map?spaceId=s1')).toBe(false);
  });

  // `at` is dropped by buildFilterStateUrl. That IS a change worth navigating for — the one-shot
  // scroll target must not survive a filter change.
  it('is false when the one-shot `at` param is dropped', () => {
    const url = new URL('https://g.test/albums/al1?at=asset-9&make=Apple');

    expect(isFilterStateUrlUnchanged(url, buildFilterStateUrl(url, state({ make: 'Apple' })))).toBe(false);
  });

  it('is false when the path or the hash differs', () => {
    const url = new URL('https://g.test/map?spaceId=s1#12/52.52/13.4');

    expect(isFilterStateUrlUnchanged(url, '/albums/al1?spaceId=s1#12/52.52/13.4')).toBe(false);
    expect(isFilterStateUrlUnchanged(url, '/map?spaceId=s1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify RED**

```bash
cd web && pnpm test --run src/lib/utils/__tests__/filter-target.spec.ts
```

Expected: **FAIL** — `buildFilterStateUrl` / `isFilterStateUrlUnchanged` are not exported from `$lib/utils/filter-target` (`TypeError: buildFilterStateUrl is not a function`, and `pnpm check:typescript` would report `has no exported member`).

- [ ] **Step 3: Implement `buildFilterStateUrl`**

Append to `web/src/lib/utils/filter-target.ts` (below `buildContextualFilterUrl`):

```ts
/**
 * Write a COMPLETE FilterState into the current URL and return the URL to navigate to.
 *
 * This is the WRITE half of the hydrate → write → react loop on the surfaces that are not
 * "searchable pages" — /albums/{id} and /map. `getSearchablePageBasePath` returns null for both
 * (searchable-page-search.ts:37-56), so `buildSearchablePageUrl` returns null there and cannot be
 * reused.
 *
 * Semantics, and how they differ from buildContextualFilterUrl:
 * - It REPLACES rather than merges. Every filter param is deleted, then re-emitted from `filters`
 *   alone. Do NOT reimplement this by passing a full FilterState as buildContextualFilterUrl's
 *   `patch`: that function decodes the URL first, so any key absent from the object would silently
 *   survive and the filter could never be cleared.
 * - It keeps the CURRENT pathname (including an open asset viewer), because the panel can write
 *   while the viewer is open. buildContextualFilterUrl deliberately targets the base path instead,
 *   so that one goto() both closes the viewer and applies the filter.
 * - Non-filter params (q, sort, spaceId, view, …) are preserved; the hash is preserved (the map
 *   keeps its viewport there); the one-shot `at` grid scroll target is dropped.
 */
export function buildFilterStateUrl(url: URL, filters: FilterState): string {
  const params = new URLSearchParams(url.searchParams);

  // `at` is a one-shot grid scroll target left behind by closing the asset viewer. It must not
  // survive a filter change, or the timeline re-scrolls to a now-filtered-out asset.
  params.delete('at');
  clearFilterParams(params);
  encodeFilterParams(params, filters);

  const search = params.toString();
  return url.pathname + (search ? `?${search}` : '') + url.hash;
}

/** Order-insensitive canonical form of a query string: `a=1&b=2` and `b=2&a=1` collapse to one. */
function canonicalizeParams(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([keyA, valueA], [keyB, valueB]) => keyA.localeCompare(keyB) || valueA.localeCompare(valueB))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

/**
 * Would navigating to `nextUrl` actually change anything?
 *
 * This is the no-op guard for the write half of the hydrate → write → react loop, and it must NOT
 * be a raw string compare: buildFilterStateUrl deletes the filter params and re-appends them last,
 * so `/map?make=Apple&spaceId=s1` rebuilds as `/map?spaceId=s1&make=Apple` — same meaning, different
 * string. A string compare would report "changed" and fire a pointless replaceState (plus an extra
 * $effect pass) the first time the panel is touched on such a URL.
 *
 * Path and hash are compared verbatim; the query is compared as a canonicalised param set, so a
 * dropped `at` or any added/changed/removed filter still reads as a real change.
 */
export function isFilterStateUrlUnchanged(url: URL, nextUrl: string): boolean {
  const next = new URL(nextUrl, url);

  return (
    next.pathname === url.pathname &&
    next.hash === url.hash &&
    canonicalizeParams(next.searchParams) === canonicalizeParams(url.searchParams)
  );
}
```

- [ ] **Step 4: Run to verify GREEN**

```bash
cd web && pnpm test --run src/lib/utils/__tests__/filter-target.spec.ts src/lib/utils/__tests__/filter-url.spec.ts src/lib/utils/__tests__/searchable-page-search.spec.ts
```

Expected: **PASS**, all three files (the last one **unmodified** — E16).

- [ ] **Step 5: Typecheck**

```bash
cd web && pnpm check:typescript
```

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/utils/filter-target.ts web/src/lib/utils/__tests__/filter-target.spec.ts
git commit -m "feat(web): add buildFilterStateUrl for URL-backed filter surfaces

Writes a COMPLETE FilterState into the current URL: keeps the path (including an
open asset viewer) and every non-filter param, preserves the hash for the map's
viewport, drops the one-shot 'at' scroll target, and REPLACES all filter params.

Deliberately not buildContextualFilterUrl(url, fullState): that one decodes the
URL and merges, so a field the caller cleared would survive and could never be
removed. /albums and /map are not searchable pages (getSearchablePageBasePath
returns null), so buildSearchablePageUrl cannot serve them either.

Ships with isFilterStateUrlUnchanged: rebuilding a URL re-orders its params
(filter keys are deleted and re-appended last), so ?make=Apple&spaceId=s1 comes
back as ?spaceId=s1&make=Apple. The write-back no-op guard therefore compares
canonicalised param sets, not raw strings, or it would fire a spurious
replaceState on the first panel interaction."
```

---

### Task 2: The album page becomes URL-backed (Slice 3)

**Files:**

- Create: `web/src/test-data/mocks/reactive-page.mock.svelte.ts`
- Modify: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts`

**Interfaces:**

- Consumes: `buildFilterStateUrl` + `isFilterStateUrlUnchanged` (Task 1), `decodeFilterParams` (`$lib/utils/filter-url`), `preserveTransientTemporalFilters` + `type SearchablePageTransientTemporalState` (`$lib/utils/searchable-page-search`).

**What changes and what does not:**

- `albumFilters` (`:115`) becomes URL-backed. **`pickerFilters` (`:116`) stays component-local** — it filters the _asset picker_ (`SELECT_ASSETS` mode), not the album timeline, and must never reach the URL.
- E9: a stray `?albumId=` is **dropped at hydrate**. `buildAlbumTimelineOptions` already refuses to forward it (`album-filter-options.ts:48-51`), but if it lived in `FilterState` it would still count toward `getActiveFilterCount`, render a chip in Slice 6, and be re-emitted on the next write. The route's album is the scope; the server's `albumId` is a scalar driving one inner join, so album ∩ album is impossible.

**Testing note — the existing `page` mocks are NOT reactive, and this task needs one that is.**
`photos-page.spec.ts:14-43` and `map-page.spec.ts:10-26` mock `$app/state` with a **plain object** built in `vi.hoisted`. That is enough for the two things those specs test — hydrate-on-mount (set `mockPage.url`, _then_ render) and the `goto` arguments — but a Svelte 5 `$effect` that reads `page.url.search` registers **no signal** on a plain object, so reassigning `mockPage.url` after mount never re-runs it. No spec in the repo currently exercises a URL `$effect`, and there is no reactive page helper to copy.

Two of this task's requirements are unreachable without one: (1) re-hydrate on back/forward, and (2) the `pendingFilterUrlSync` carry-over — which is a **round trip** (write → URL changes → re-hydrate) and is therefore _untestable_ against a frozen URL. Worse, a carry-over test written against a frozen URL would **pass vacuously**: with no re-hydrate, `selectedYear` simply survives in component state and the assertion proves nothing.

So this plan builds the reactive mock (option (a)) rather than dropping the tests (option (b)). It is ~15 lines, it uses the same `$state`-in-a-`.svelte.ts` pattern the managers already use (`$lib/managers/*.svelte.ts`), and it makes the mock strictly **more** faithful than the plain object (real `page.url` _is_ reactive). The map spec (Task 3) keeps its existing plain mock — its new tests are hydrate-on-load plus `goto` arguments, which need no reactivity, and rewriting its 14 passing tests would be churn for nothing.

- [ ] **Step 1: Create the reactive `page` mock**

Create `web/src/test-data/mocks/reactive-page.mock.svelte.ts` (the `.svelte.ts` suffix is what makes the Svelte compiler process the runes in it):

```ts
/**
 * A REACTIVE stand-in for `$app/state`'s `page`.
 *
 * The plain `vi.hoisted({ mockPage: { url: new URL(…) } })` object used by photos-page.spec.ts and
 * map-page.spec.ts pins hydrate-on-mount and goto() arguments, but it registers no signal: a Svelte
 * 5 `$effect` reading `page.url.search` never re-runs when a test reassigns `mockPage.url`. A page
 * whose filters are URL-backed has an $effect exactly like that (re-hydrate on back/forward, plus
 * the pendingFilterUrlSync round trip), so testing it needs `url` to be `$state`.
 *
 * Real `page` from $app/state IS reactive, so this is the faithful mock, not a convenience one.
 */
class ReactivePageMock {
  url = $state(new URL('https://gallery.test/'));
  route = $state<{ id: string | null }>({ id: null });
  params = $state<Record<string, string>>({});

  reset(url: string, options: { routeId?: string | null; params?: Record<string, string> } = {}) {
    this.url = new URL(url);
    this.route = { id: options.routeId ?? null };
    this.params = options.params ?? {};
  }
}

export const reactivePageMock = new ReactivePageMock();
```

- [ ] **Step 2: Write the failing page tests**

`page.route.spec.ts` currently mocks neither `$app/state` nor `$app/navigation` (the page never reads `page`, and nothing in the suite triggers a `goto`). Add both. Note the album page imports **three** things from `$app/navigation` (`+page.svelte:2` — `goto, invalidate, onNavigate`), so all three must be provided or the module mock breaks the page.

At the top of the file, after the existing imports:

```ts
import { reactivePageMock as mockPage } from '@test-data/mocks/reactive-page.mock.svelte';

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));

vi.mock('$app/navigation', () => ({
  goto: gotoMock,
  invalidate: vi.fn().mockResolvedValue(undefined),
  onNavigate: vi.fn(),
}));
// The mock module and the spec import the SAME singleton, so assigning mockPage.url in a test is
// what the page's $effect sees.
vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('@test-data/mocks/reactive-page.mock.svelte');
  return { page: reactivePageMock };
});
```

`vi.clearAllMocks()` in the existing `beforeEach` (`:113`) wipes `gotoMock`'s implementation, so re-arm it and reset the URL there. **`goto` simulates the navigation it is asked for** — that is what closes the hydrate → write → react loop, and it is the only way the round-trip tests below can be load-bearing:

```ts
beforeEach(() => {
  vi.clearAllMocks();
  // Stand in for SvelteKit: a goto() actually changes page.url, which re-runs the page's URL
  // $effect. If the effect's lastHandled token guard is ever broken, this turns goto -> $effect ->
  // goto into a real loop and the test times out — which is the correct, loud failure.
  gotoMock.mockImplementation((href: string) => {
    mockPage.url = new URL(href, 'https://gallery.test');
    return Promise.resolve();
  });
  mockPage.reset('https://gallery.test/albums/album-1', {
    routeId: '/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]',
    params: { albumId: 'album-1' },
  });
  assetMultiSelectManager.clear();
  Element.prototype.animate = getAnimateMock();
});
```

Then append this describe block at the end of the file:

```ts
describe('album detail filters are URL-backed', () => {
  const album1 = () => albumFactory.build({ id: 'album-1', assetCount: 2 });

  it('hydrates the album timeline filters from the URL', async () => {
    mockPage.url = new URL('https://gallery.test/albums/album-1?make=Apple&rating=4&lens=RF24-70mm');
    renderPage(album1());

    const options = await screen.findByTestId('timeline-options');
    await waitFor(() => {
      expect(options.textContent).toContain('"make":"Apple"');
      expect(options.textContent).toContain('"rating":4');
      expect(options.textContent).toContain('"lensModel":"RF24-70mm"');
    });
    expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument();
  });

  it('writes a filter chosen in the panel back to the URL', async () => {
    renderPage(album1());
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('people-item-person-view')).toBeInTheDocument());
    await user.click(screen.getByTestId('people-item-person-view'));

    await waitFor(() =>
      expect(gotoMock).toHaveBeenCalledWith('/albums/album-1?people=person-view', {
        replaceState: true,
        keepFocus: true,
        noScroll: true,
      }),
    );
  });

  it('writes chip removal back to the URL', async () => {
    mockPage.url = new URL('https://gallery.test/albums/album-1?make=Apple');
    renderPage(album1());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'filter_remove_chip' }));

    await waitFor(() =>
      expect(gotoMock).toHaveBeenCalledWith('/albums/album-1', {
        replaceState: true,
        keepFocus: true,
        noScroll: true,
      }),
    );
  });

  // Back/forward: SvelteKit swaps page.url without remounting the page component. The $effect must
  // notice and re-hydrate — this is the same code path a reload and a shared URL take.
  it('re-hydrates when the URL changes underneath it (back/forward)', async () => {
    mockPage.url = new URL('https://gallery.test/albums/album-1?make=Apple&rating=4');
    renderPage(album1());

    await waitFor(() => expect(screen.getByTestId('timeline-options').textContent).toContain('"rating":4'));

    // The browser Back button: no remount, just a new URL.
    mockPage.url = new URL('https://gallery.test/albums/album-1?make=Apple');

    await waitFor(() => {
      const options = screen.getByTestId('timeline-options');
      expect(options.textContent).toContain('"make":"Apple"');
      expect(options.textContent).not.toContain('"rating"');
    });
  });

  // THE pendingFilterUrlSync test. selectedYear is transient: it drives takenAfter/takenBefore
  // through buildFilterContext but has NO url param. Picking a year alone writes nothing (the
  // rebuilt URL is unchanged, so syncAlbumFilterUrl early-returns). Picking a year and THEN a
  // URL-encoded filter does write — and the re-hydrate that follows rebuilds FilterState from
  // decodeFilterParams, which has never heard of selectedYear. Without the carry-over the year
  // silently vanishes and the timeline quietly widens back to "all time".
  it('carries a transient year across a URL-writing filter change', async () => {
    renderPage(album1());
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('year-btn-2024'));
    await waitFor(() =>
      expect(screen.getByTestId('timeline-options').textContent).toContain('"takenAfter":"2024-01-01T00:00:00.000Z"'),
    );
    // A year is transient — it is not in the URL codec, so it must not have triggered a write.
    expect(gotoMock).not.toHaveBeenCalled();

    await user.click(await screen.findByTestId('people-item-person-view'));

    await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/albums/album-1?people=person-view', expect.anything()));
    await waitFor(() => {
      const options = screen.getByTestId('timeline-options').textContent ?? '';
      expect(options).toContain('"personIds":["person-view"]');
      // survived the round trip
      expect(options).toContain('"takenAfter":"2024-01-01T00:00:00.000Z"');
      expect(options).toContain('"takenBefore":"2025-01-01T00:00:00.000Z"');
    });
    expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2024');
  });

  // E9 — the route already scopes the query to this album, and the server's albumId is a SCALAR
  // driving one inner join, so a second album cannot be AND-ed. A stray param must be IGNORED,
  // not merely redundant.
  it('E9: ignores a stray albumId param and keeps its own album scope', async () => {
    mockPage.url = new URL('https://gallery.test/albums/album-1?albumId=album-2&make=Apple');
    renderPage(album1());

    const options = await screen.findByTestId('timeline-options');
    await waitFor(() => expect(options.textContent).toContain('"make":"Apple"'));
    expect(options.textContent).toContain('"albumId":"album-1"');
    expect(options.textContent).not.toContain('album-2');
  });

  // The picker filters the asset PICKER, not the album timeline. They must never reach the URL.
  it('does not write picker filters to the URL', async () => {
    renderPage(album1());
    const user = userEvent.setup();

    await fireEvent.click(screen.getByLabelText('add_photos'));
    await waitFor(() => expect(screen.getByTestId('people-item-person-picker')).toBeInTheDocument());
    gotoMock.mockClear();
    await user.click(screen.getByTestId('people-item-person-picker'));

    expect(screen.getByTestId('active-chip')).toHaveTextContent('Picker Person');
    expect(gotoMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify RED**

```bash
cd web && pnpm test --run "src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts"
```

Expected: **FAIL** — the hydration tests fail because `albumFilters` starts as `createFilterState()` (`+page.svelte:115`), so `timeline-options` carries no `make`/`rating`/`lensModel`; the write tests fail because nothing calls `goto` (`expect(gotoMock).toHaveBeenCalledWith(…)` → "number of calls: 0"); the carry-over test fails at its **first** `goto` assertion for the same reason. The **pre-existing** tests in the file must still pass — if any of them break, the `$app/*` mocks are wrong, not the page.

- [ ] **Step 4: Wire the album page into the hydrate → write → react loop**

All edits in `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte`.

**4a. Imports.** Add `page`, the codec, the URL builder, the transient-temporal helper, and `untrack`:

```ts
import { page } from '$app/state';
import { buildFilterStateUrl, isFilterStateUrlUnchanged } from '$lib/utils/filter-target';
import { decodeFilterParams } from '$lib/utils/filter-url';
import {
  preserveTransientTemporalFilters,
  type SearchablePageTransientTemporalState,
} from '$lib/utils/searchable-page-search';
```

and widen the existing `svelte` import (`:114` — `import { onDestroy } from 'svelte';`):

```ts
import { onDestroy, untrack } from 'svelte';
```

**4b. Replace the component-local state (`:115`).**

```ts
/**
 * E9 — the route already scopes the timeline to this album, and the server's `albumId` is a
 * SCALAR driving one inner join, so album ∩ album is impossible. A stray `?albumId=` must be
 * IGNORED: dropping it here keeps it out of the active-filter count, out of the chip bar, and
 * out of the next URL write. buildAlbumTimelineOptions already refuses to forward it.
 */
const hydrateAlbumFilters = (url: URL): FilterState => ({
  ...createFilterState(),
  ...decodeFilterParams(url),
  albumId: undefined,
});

let albumFilters = $state<FilterState>(hydrateAlbumFilters(page.url));
// Token guard for the URL $effect below. Copied in spirit from photos/…/+page.svelte:508-513:
// without it, our own goto() re-runs the effect, which re-runs goto(), forever.
let lastHandledFilterSearch = $state(page.url.search);
// selectedYear/selectedMonth are NOT in the URL codec but DO drive takenAfter/takenBefore via
// buildFilterContext. Carry them across our own round trip, or the temporal picker resets itself
// on every unrelated filter change.
let pendingFilterUrlSync = $state<
  { search: string; transientTemporal?: SearchablePageTransientTemporalState } | undefined
>();
```

**4c. The write half.** Add next to the other handlers (e.g. above `clearAlbumTemporalFilter`, `:419`):

```ts
function syncAlbumFilterUrl(nextFilters: FilterState) {
  const nextUrl = buildFilterStateUrl(page.url, nextFilters);
  // NOT a string compare: buildFilterStateUrl re-appends the filter params last, so an unchanged
  // state on `?make=Apple&at=…`-style URLs can come back re-ordered. See filter-target.ts.
  if (isFilterStateUrlUnchanged(page.url, nextUrl)) {
    return;
  }
  pendingFilterUrlSync = {
    search: new URL(nextUrl, page.url).search,
    transientTemporal: {
      selectedYear: nextFilters.selectedYear,
      selectedMonth: nextFilters.selectedMonth,
    },
  };
  void goto(nextUrl, { replaceState: true, keepFocus: true, noScroll: true });
}

function handleAlbumFiltersChange(nextFilters: FilterState) {
  syncAlbumFilterUrl(nextFilters);
}
```

**4d. The react half.** Add a `$effect` next to the existing ones:

```ts
$effect(() => {
  const nextSearch = page.url.search;
  if (nextSearch === lastHandledFilterSearch) {
    return;
  }

  untrack(() => {
    const transientTemporal =
      pendingFilterUrlSync?.search === nextSearch ? pendingFilterUrlSync.transientTemporal : undefined;
    albumFilters = {
      ...createFilterState(),
      ...preserveTransientTemporalFilters(hydrateAlbumFilters(page.url), transientTemporal),
    };
    if (pendingFilterUrlSync?.search === nextSearch) {
      pendingFilterUrlSync = undefined;
    }
    lastHandledFilterSearch = nextSearch;
  });
});
```

**4e. Album-change reset (`:261-277`).** Replace the `albumFilters = createFilterState();` line (`:264`) with a hydrate, and re-arm the token, so that navigating straight from `/albums/A` to a shared `/albums/B?make=Apple` does not race the two effects into an empty state:

```ts
album = data.album;
albumFilters = hydrateAlbumFilters(page.url);
lastHandledFilterSearch = page.url.search;
pendingFilterUrlSync = undefined;
pickerFilters = createFilterState();
```

(Leave the rest of that effect — the name caches, multi-select, view mode, grouping, anchor, `oldAt` — untouched.)

**4f. Every place that mutates `albumFilters` must now also write the URL.**

- The album `FilterPanel` (`:507-515`) gains the callback — the picker one (`:497-505`) **must not**:

```svelte
          {#key `album-${album.id}`}
            <FilterPanel
              config={albumFilterConfig}
              bind:filters={albumFilters}
              {timeBuckets}
              storageKey="gallery-filter-visible-sections-album-detail"
              hidden={isTimelineEmpty}
              onFiltersChange={handleAlbumFiltersChange}
            />
          {/key}
```

- `clearAlbumTemporalFilter` (`:419-422`):

```ts
function clearAlbumTemporalFilter() {
  albumFilters = clearTimelineTemporalFilter(albumFilters);
  temporalAnchor = undefined;
  syncAlbumFilterUrl(albumFilters);
}
```

- The album `ActiveFiltersBar` snippet (`:533-553`):

```svelte
                onRemoveFilter={(type, id) => {
                  if (type === 'timeline') {
                    clearAlbumTemporalFilter();
                  } else {
                    albumFilters = handlePhotosRemoveFilter(albumFilters, type, id);
                    syncAlbumFilterUrl(albumFilters);
                  }
                }}
                onClearAll={() => {
                  albumFilters = clearFilters(albumFilters);
                  temporalAnchor = undefined;
                  syncAlbumFilterUrl(albumFilters);
                }}
```

- The "Clear all filters" button inside the filtered empty state (`:571-581`) — its `else` branch:

```svelte
                  } else {
                    albumFilters = clearFilters(albumFilters);
                    temporalAnchor = undefined;
                    syncAlbumFilterUrl(albumFilters);
                  }
```

- [ ] **Step 5: Run to verify GREEN**

```bash
cd web && pnpm test --run "src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts"
```

Expected: **PASS** — the seven new tests **and** all 22 pre-existing ones, including `explicit album timeline filters still show chips and clear without changing grouping` (`:331`) and `resets both filter states and label caches when navigating to another album` (`:375`). A **hang/timeout** rather than a failure means the `lastHandledFilterSearch` token guard (4b/4d) is wrong: `goto` now really moves `page.url`, so a missing guard is an infinite `goto → $effect → goto` loop.

- [ ] **Step 6: Typecheck and lint**

```bash
cd web && pnpm check:typescript && pnpm lint
```

Expected: typecheck clean; lint **0 errors** (≈640 `better-tailwindcss` warnings are pre-existing and expected).

- [ ] **Step 7: Commit**

```bash
git add web/src/test-data/mocks/reactive-page.mock.svelte.ts \
        "web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte" \
        "web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts"
git commit -m "feat(web): make album filters URL-backed

The album timeline's filters now hydrate from the URL, are written back on every
change, and re-hydrate when the URL changes underneath the page — so they survive
a reload, browser back/forward, and a shared link, exactly like /photos.

The photos page's lastHandled token guard is copied verbatim in spirit (goto ->
\$effect -> goto would otherwise loop), as is its pendingFilterUrlSync carry-over:
selectedYear/selectedMonth are not in the URL codec but do drive takenAfter/
takenBefore, so picking a year and then any URL-encoded filter would silently
reset the temporal picker on the re-hydrate.

Testing a URL \$effect needs a page mock whose url is \$state — the plain hoisted
object the other page specs use registers no signal, so a reassigned url never
re-runs the effect (and a carry-over test written against it would pass
vacuously). Hence test-data/mocks/reactive-page.mock.svelte.ts.

A stray ?albumId= on an album page is dropped at hydrate (E9): the route already
scopes the query, and the server's albumId is a scalar driving one inner join, so
album-intersect-album is impossible. Picker filters stay component-local."
```

---

### Task 3: The map becomes URL-backed and every map link carries the filters (Slice 4 = #767 a+b)

**Files:**

- Modify: `server/src/services/shared-space.service.ts`, `server/src/services/shared-space.service.spec.ts`
- Modify: `e2e/src/specs/server/api/gallery-map.e2e-spec.ts`
- Modify: `web/src/lib/route.ts`, `web/src/lib/route.spec.ts`
- Modify: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte`, `…/map-page.spec.ts`
- Modify: `web/src/lib/components/spaces/space-map.svelte`, `…/space-map.spec.ts`, `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/lib/utils/map-filter-options.ts`, `web/src/lib/utils/__tests__/map-filter-options.spec.ts`
- Modify: `web/src/lib/components/album-page/AlbumMap.svelte`; Create: `web/src/lib/components/album-page/__tests__/AlbumMap.spec.ts`
- Modify: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte` + `…/page.route.spec.ts` (the `<AlbumMap filters>` call site, Step 5)

**Interfaces:**

- Consumes: `buildFilterStateUrl` + `isFilterStateUrlUnchanged` (Task 1), `encodeFilterParams` / `decodeFilterParams`.
- Produces: `Route.map({ zoom?, lat?, lng?, spaceId?, query?, filters? })`; `buildAlbumMapMarkerOptions(albumId, filters)`; `SpaceMap` props `{ spaceId, filters, searchQuery? }`; `AlbumMap` prop `filters?`.

#### Step 1 (SERVER — not in the original brief, but mandatory: see Reality checks R1 + R4)

**Decision — `?spaceId=S&albumId=A` is REJECTED, not "handled".** Once `albumId` can reach the map from the URL (Step 3), that combination becomes typeable. It is **guaranteed empty** by construction: the space scope requires the asset to be in `shared_space_asset` for `S`, while `albumSharedSpaceScope` — which runs because `albumIds && !userIds` — is called with `timelineSpaceIds === undefined` (a `spaceId` query never computes it) and so requires the asset to be in **no** shared space at all. A contradiction. There is no coherent semantics to "handle" here ("assets in album A **and** in space S" is not a scope the endpoint models), so:

- the **server** throws `BadRequestException('Cannot use both spaceId and albumId')` — the same shape as `SearchService`'s existing `Cannot use both spaceId and withSharedSpaces` guard (`search.service.ts:122-124`). Silently returning `[]` would be a third lie on a page this slice is explicitly de-lying.
- the **web** map page drops `albumId` at hydrate whenever `spaceId` is present (Step 3b), so the UI never produces the combination and a hand-typed URL degrades to a plain space map instead of an error.

- [ ] **Step 1a: Write the failing server tests**

`server/src/services/shared-space.service.spec.ts` already has `describe('getFilteredMapMarkers', …)` (`:9326`). Add four tests inside it:

```ts
it('scopes an albumId query by album ACCESS, not by asset owner (issue #656 class)', async () => {
  const albumId = factory.uuid();
  const auth = factory.auth();
  mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);
  mocks.sharedSpace.getFilteredMapMarkers.mockResolvedValue([]);

  await sut.getFilteredMapMarkers(auth, { albumId, withSharedSpaces: true });

  expect(mocks.sharedSpace.getFilteredMapMarkers).toHaveBeenCalledWith(
    expect.objectContaining({
      albumIds: [albumId],
      // The whole point: with userIds unset, searchAssetBuilder takes its album branch
      // (`albumIds && !userIds` -> albumSharedSpaceScope, database.ts:713). Owner-scoping an album
      // query hides the album owner's pins from a viewer of a shared album — issue #656.
      userIds: undefined,
    }),
  );
});

// R4 — the OTHER half of the fix. albumSharedSpaceScope's "…or it's in a space you can see" arms
// only exist when timelineSpaceIds is set; with it undefined the gate keeps ONLY assets that are in
// no shared space at all. So an album query must compute timelineSpaceIds even though the album map
// sends no withSharedSpaces — otherwise every album asset that also lives in a space loses its pin.
// (This is a shape assertion; the behaviour it protects is pinned by the e2e test in Step 1c.)
it('computes timelineSpaceIds for an albumId query even without withSharedSpaces', async () => {
  const albumId = factory.uuid();
  const spaceId = newUuid();
  const auth = factory.auth();
  mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
  mocks.sharedSpace.getFilteredMapMarkers.mockResolvedValue([]);

  await sut.getFilteredMapMarkers(auth, { albumId });

  expect(mocks.sharedSpace.getSpaceIdsForTimeline).toHaveBeenCalledWith(auth.user.id);
  expect(mocks.sharedSpace.getFilteredMapMarkers).toHaveBeenCalledWith(
    expect.objectContaining({ albumIds: [albumId], userIds: undefined, timelineSpaceIds: [spaceId] }),
  );
});

it('rejects an albumId the caller cannot read', async () => {
  const albumId = factory.uuid();
  const auth = factory.auth();
  mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
  mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set());

  await expect(sut.getFilteredMapMarkers(auth, { albumId })).rejects.toThrow(BadRequestException);
  expect(mocks.sharedSpace.getFilteredMapMarkers).not.toHaveBeenCalled();
});

// spaceId ∩ albumId is unsatisfiable by construction (see the decision note above): the space scope
// demands membership in shared_space_asset, albumSharedSpaceScope (timelineSpaceIds unset under a
// spaceId query) demands the opposite. Fail loudly instead of returning a silently empty map.
it('rejects spaceId together with albumId', async () => {
  const auth = factory.auth();

  await expect(sut.getFilteredMapMarkers(auth, { spaceId: newUuid(), albumId: factory.uuid() })).rejects.toThrow(
    BadRequestException,
  );
  expect(mocks.sharedSpace.getFilteredMapMarkers).not.toHaveBeenCalled();
});
```

(`BadRequestException`, `factory`, `newUuid` are all already imported by the spec — `:1`, `:27`.)

**Do not touch the two pre-existing `timelineSpaceIds` tests in that describe** (`:9492` "should resolve timelineSpaceIds when withSharedSpaces is true and no spaceId" and `:9509` "should NOT call getSpaceIdsForTimeline when spaceId is set"). Both must stay green: the new `needsTimelineSpaceIds` condition changes behaviour **only** when `albumId` is set.

Run:

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts -t getFilteredMapMarkers
```

Expected: **FAIL** — test 1 reports `userIds: [ '<auth user id>' ]` where `undefined` was expected (`shared-space.service.ts:740`); test 2 reports `timelineSpaceIds: undefined` (`:723-729` never runs without `withSharedSpaces`); tests 3 and 4 resolve instead of throwing, because no album access check and no mutual-exclusion guard exist yet.

- [ ] **Step 1b: Make the album scope RBAC-correct**

In `server/src/services/shared-space.service.ts`, `getFilteredMapMarkers` (`:718`).

Replace the guard + `timelineSpaceIds` block (`:719-729`):

```ts
  async getFilteredMapMarkers(auth: AuthDto, dto: FilteredMapMarkerDto): Promise<MapMarkerResponseDto[]> {
    // A space and an album are two different scopes, and their AND is unsatisfiable: the space scope
    // requires the asset to be in shared_space_asset for this space, while albumSharedSpaceScope —
    // which runs for any `albumIds && !userIds` query — is handed no timelineSpaceIds under a spaceId
    // query and therefore requires the asset to be in NO shared space at all. Return a loud 400
    // rather than a silently empty map. (Mirrors search.service.ts:122-124.)
    if (dto.spaceId && dto.albumId) {
      throw new BadRequestException('Cannot use both spaceId and albumId');
    }

    if (dto.spaceId) {
      await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
    }

    // An album query is scoped by album ACCESS, never by asset owner (see userIds below).
    if (dto.albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [dto.albumId] });
    }

    // timelineSpaceIds plays TWO different roles and both are needed here:
    //  - for a plain (non-album) query it WIDENS the result to shared-space assets in the caller's
    //    timeline — skipped for a favorites-only query, whose favorites are the caller's own;
    //  - for an album query it is the RBAC GATE inside albumSharedSpaceScope (database.ts:608-618).
    //    That gate's "…or the asset is in a space you can see" arms EXIST ONLY when timelineSpaceIds
    //    is set; leave it undefined and the gate keeps only assets that are in no shared space at
    //    all — so every album asset that also lives in a space silently loses its pin, and an album
    //    over a space-shared library goes completely empty. So compute it for ANY album query,
    //    regardless of withSharedSpaces or isFavorite. Same rule as searchMetadata
    //    (search.service.ts:152: `dto.withSharedSpaces || !!dto.albumIds?.length`).
    const needsTimelineSpaceIds =
      !dto.spaceId && (!!dto.albumId || (dto.withSharedSpaces === true && dto.isFavorite !== true));

    let timelineSpaceIds: string[] | undefined;
    if (needsTimelineSpaceIds) {
      const spaceRows = await this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id);
      if (spaceRows.length > 0) {
        timelineSpaceIds = spaceRows.map((row) => row.spaceId);
      }
    }
```

Then stop owner-scoping an album query (`:740`):

```ts
      // Album ACCESS is the scope (checked above), never asset ownership: leaving userIds set would
      // hide the album owner's pins from a viewer of a shared album — the issue #656 bug class, which
      // album.service.ts:112-123 calls out by name. With userIds unset, searchAssetBuilder takes its
      // album branch (`albumIds && !userIds` -> albumSharedSpaceScope, database.ts:713), which is what
      // keeps space assets the caller cannot reach out of the result — provided timelineSpaceIds is
      // computed above.
      userIds: dto.spaceId || dto.albumId ? undefined : [auth.user.id],
```

`Permission` and `BadRequestException` are already imported in this file.

- [ ] **Step 1c: Write the BEHAVIOURAL test (e2e) — the unit tests above cannot catch R4**

The Step 1a tests assert **mock arguments**. By construction they cannot see a wrong SQL scope: a `timelineSpaceIds`-shaped hole in the very same call is exactly the kind of defect an argument assertion is blind to (the argument would just be `undefined`, which some other reading might call correct). The #656 class and the R4 regression both need a query that actually runs against Postgres.

`e2e/src/specs/server/api/gallery-map.e2e-spec.ts` is the home for this — it already boots the stack, uploads geotagged fixtures, and has `utils.createAlbum` / `utils.createSpace` / `utils.addSpaceMember` / `utils.addSpaceAssets` wired. Append a new describe **inside** the top-level `describe('/gallery/map/markers')` (after the `spaceId scoping (T19)` block), using **two distinct** GPS fixtures — uploads are deduplicated per owner by checksum, so the same file cannot be uploaded twice by the same user:

```ts
describe('albumId scoping (#656 class)', () => {
  // A shared album is scoped by album ACCESS, not by asset ownership. `albumViewer` owns nothing:
  // every pin they see here belongs to `albumOwner`.
  let albumOwner: LoginResponseDto;
  let albumViewer: LoginResponseDto;
  let outsider: LoginResponseDto;
  let albumId: string;
  let plainAssetId: string; // in the album only
  let spaceAssetId: string; // in the album AND in a shared space both users can see

  beforeAll(async () => {
    [albumOwner, albumViewer, outsider] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('t20-album-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('t20-album-viewer')),
      utils.userSetup(admin.accessToken, createUserDto.create('t20-outsider')),
    ]);

    const ownerWebsocket = await utils.connectWebsocket(albumOwner.accessToken);
    const upload = async (input: string) => {
      const filepath = join(testAssetDir, input);
      const { id } = await utils.createAsset(albumOwner.accessToken, {
        assetData: { bytes: await readFile(filepath), filename: basename(filepath) },
      });
      await utils.waitForWebsocketEvent({ event: 'assetUpload', id });
      return id;
    };

    // Two DIFFERENT geotagged fixtures — same-checksum re-uploads return the existing asset id.
    plainAssetId = await upload('formats/heic/IMG_2682.heic');
    spaceAssetId = await upload('metadata/dates/datetimeoriginal-gps.jpg');
    utils.disconnectWebsocket(ownerWebsocket);

    // The space asset lives in a space BOTH users have in their timeline (showInTimeline defaults
    // to true — shared-space-member.table.ts:74-75).
    const space = await utils.createSpace(albumOwner.accessToken, { name: 't20 space' });
    await utils.addSpaceMember(albumOwner.accessToken, space.id, {
      userId: albumViewer.userId,
      role: SharedSpaceRole.Viewer,
    });
    await utils.addSpaceAssets(albumOwner.accessToken, space.id, [spaceAssetId]);

    const album = await utils.createAlbum(albumOwner.accessToken, {
      albumName: 't20 shared album',
      assetIds: [plainAssetId, spaceAssetId],
      albumUsers: [{ userId: albumViewer.userId, role: AlbumUserRole.Viewer }],
    });
    albumId = album.id;
  });

  it('a viewer of a shared album sees the OWNER pins (#656)', async () => {
    // Before the fix this returned [] — userIds was hard-coded to [caller], and the viewer owns
    // no assets at all.
    const { status, body } = await request(app)
      .get(`/gallery/map/markers?albumId=${albumId}`)
      .set(asBearerAuth(albumViewer.accessToken));

    expect(status).toBe(200);
    expect((body as Array<{ id: string }>).map((m) => m.id)).toContain(plainAssetId);
  });

  it('an album asset that also lives in a shared space KEEPS its pin (R4 regression)', async () => {
    // The R4 hole: drop userIds but leave timelineSpaceIds undefined and albumSharedSpaceScope
    // degenerates to "the asset must be in no shared space at all" — this pin disappears for the
    // viewer AND for the owner.
    for (const actor of [albumViewer, albumOwner]) {
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?albumId=${albumId}`)
        .set(asBearerAuth(actor.accessToken));

      expect(status).toBe(200);
      const ids = (body as Array<{ id: string }>).map((m) => m.id);
      expect(ids).toContain(spaceAssetId);
      expect(ids).toContain(plainAssetId);
    }
  });

  it('a user with no access to the album gets 400', async () => {
    const { status } = await request(app)
      .get(`/gallery/map/markers?albumId=${albumId}`)
      .set(asBearerAuth(outsider.accessToken));

    expect(status).toBe(400);
  });

  it('rejects spaceId together with albumId', async () => {
    const space = await utils.createSpace(albumOwner.accessToken, { name: 't20 combo space' });
    const { status } = await request(app)
      .get(`/gallery/map/markers?spaceId=${space.id}&albumId=${albumId}`)
      .set(asBearerAuth(albumOwner.accessToken));

    expect(status).toBe(400);
  });
});
```

Add `AlbumUserRole` to the `@immich/sdk` import at the top of that file (`SharedSpaceRole`, `AssetVisibility` and `LoginResponseDto` are already imported).

Run (needs the e2e stack; `make e2e` first, or let the vitest global setup bring it up):

```bash
cd e2e && pnpm test src/specs/server/api/gallery-map.e2e-spec.ts
```

Expected **before Step 1b**: `a viewer of a shared album sees the OWNER pins` fails with `[]` (owner-scoped), and `a user with no access to the album gets 400` fails with `200`. Expected **with only half of Step 1b** (userIds dropped, `timelineSpaceIds` left as-is): the R4 regression test fails — `spaceAssetId` is missing for **both** actors. Expected **after Step 1b**: all four PASS.

- [ ] **Step 1d: Verify GREEN + full server gate**

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts && pnpm check && pnpm format:fix && pnpm lint
cd ../e2e && pnpm check && pnpm lint && pnpm format
```

Expected: PASS; typecheck clean; lint clean with **zero warnings**. **No DTO change ⇒ no `mise open-api`, no SDK commit** (`albumId` is already on `FilteredMapMarkerDto` and in the SDK: `packages/sdk/src/fetch-client.ts:5685-5686`).

- [ ] **Step 1e: Commit the server fix**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts \
        e2e/src/specs/server/api/gallery-map.e2e-spec.ts
git commit -m "fix(map): scope albumId map markers by album access, not asset owner

GET /gallery/map/markers passed userIds: [caller] unconditionally when no spaceId
was given, so filtering the map by an album would show only the caller's own pins
and hide the album owner's — the issue #656 bug class that album.service.getMapMarkers
already guards against by name. Slice 3/4 is what first lets an albumId reach this
endpoint, so the fix ships with it.

An albumId query now requires AlbumRead and drops the owner scope, which lets
searchAssetBuilder take its album branch (albumIds && !userIds ->
albumSharedSpaceScope). That branch is ALSO why timelineSpaceIds is now computed for
any album query, not just a withSharedSpaces one: its 'or the asset is in a space you
can see' arms only exist when timelineSpaceIds is set, so leaving it undefined would
have traded #656 for a silent under-inclusion — every album asset that also lives in a
shared space loses its pin, and an album over a space-shared library goes empty.

spaceId + albumId is now a 400: their AND is unsatisfiable by construction, and a
silently empty map is not an answer.

Covered by e2e (a viewer of a shared album sees the owner's pins; a space-shared album
asset keeps its pin) — a mock-argument unit test cannot see either. No DTO change:
albumId already existed on FilteredMapMarkerDto."
```

#### Step 2: `Route.map` gains query params (E11)

- [ ] **Step 2a: Write the failing route tests**

Append to `web/src/lib/route.spec.ts`:

```ts
describe(Route.map.name, () => {
  it('emits a bare /map with no arguments', () => {
    expect(Route.map()).toBe('/map');
  });

  it('emits only the viewport hash when given a point', () => {
    expect(Route.map({ zoom: 12, lat: 52.52, lng: 13.4 })).toBe('/map#12/52.52/13.4');
  });

  // E11 — query AND hash together. The map keeps its viewport in the hash and its scope/filters in
  // the query; before this, Route.map could only emit the hash.
  it('E11: emits query params and the viewport hash together', () => {
    const url = Route.map({
      zoom: 12,
      lat: 52.52,
      lng: 13.4,
      spaceId: 'space-1',
      query: 'ski',
      filters: { ...createFilterState(), make: 'Apple', rating: 4 },
    });

    expect(url).toBe('/map?spaceId=space-1&q=ski&make=Apple&rating=4#12/52.52/13.4');
  });

  // E10 — a pin dropped from inside a Space carries the space AND the active filters.
  it('E10: carries spaceId and filters without a point', () => {
    const url = Route.map({ spaceId: 'space-1', filters: { ...createFilterState(), personIds: ['space-person:p1'] } });

    expect(url).toBe('/map?spaceId=space-1&people=space-person%3Ap1');
  });

  it('omits an empty query and an empty filter state', () => {
    expect(Route.map({ spaceId: 'space-1', query: '   ', filters: createFilterState() })).toBe('/map?spaceId=space-1');
  });
});
```

Add the import at the top of the file:

```ts
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
```

Run:

```bash
cd web && pnpm test --run src/lib/route.spec.ts
```

Expected: **FAIL** — `Route.map` accepts only `{ zoom, lat, lng }` (`route.ts:89-90`), so the object literal is a type error and, at runtime, every query param is dropped (`'/map#12/52.52/13.4'` where `'/map?spaceId=…#…'` was expected).

- [ ] **Step 2b: Extend `Route.map`**

In `web/src/lib/route.ts`, replace `:88-90`:

```ts
  // map
  //
  // Emits `/map?<scope+filters>#<zoom>/<lat>/<lng>` (E11). The map keeps its VIEWPORT in the hash
  // (`<Map hash>` on the map page) and its SCOPE + FILTERS in the query, so both halves have to be
  // buildable from one call — a map link that drops the caller's filters is bug #767.
  map: (params?: {
    zoom?: number;
    lat?: number;
    lng?: number;
    spaceId?: string;
    query?: string;
    filters?: FilterState;
  }) => {
    const search = new URLSearchParams();
    if (params?.spaceId) {
      search.set(QueryParameter.SPACE_ID, params.spaceId);
    }
    const query = params?.query?.trim();
    if (query) {
      search.set('q', query);
    }
    if (params?.filters) {
      encodeFilterParams(search, params.filters);
    }

    const point =
      params?.zoom !== undefined && params?.lat !== undefined && params?.lng !== undefined
        ? `#${params.zoom}/${params.lat}/${params.lng}`
        : '';

    return '/map' + (search.size > 0 ? `?${search}` : '') + point;
  },
```

and add the imports at the top of `route.ts` (it already imports from `$lib/constants` — extend that line):

```ts
import type { FilterState } from '$lib/components/filter-panel/filter-panel';
import { OpenQueryParam, QueryParameter, type SharedLinkTab } from '$lib/constants';
import { encodeFilterParams } from '$lib/utils/filter-url';
```

No import cycle: `filter-url.ts` imports only the `FilterState` **type** from `filter-panel.ts` and nothing from `route.ts`.

All **five** existing callers keep working unchanged (every new field is optional, and the old `point` shape is a strict subset of the new params):

| Caller                                 | Call                                      | Result after the change |
| -------------------------------------- | ----------------------------------------- | ----------------------- |
| `commands.ts:87`                       | `Route.map()`                             | `/map`                  |
| `UserSidebar.svelte:67`                | `Route.map()`                             | `/map`                  |
| `DetailPanel.svelte:312`               | `Route.map({ ...latlng, zoom: 12.5 })`    | `/map#12.5/<lat>/<lng>` |
| `global-search-manager.svelte.ts:1737` | `Route.map({ zoom: 12, lat: …, lng: … })` | `/map#12/<lat>/<lng>`   |
| `global-search-manager.svelte.ts:1877` | `Route.map({ zoom: 12, lat: …, lng: … })` | `/map#12/<lat>/<lng>`   |

(Making the DetailPanel pin carry the current context's filters is Slice 7b's job, not this task's. The two `global-search-manager` call sites are "jump to this place" links from ⌘K and are deliberately filter-free.)

- [ ] **Step 2c: Verify GREEN**

```bash
cd web && pnpm test --run src/lib/route.spec.ts
```

#### Step 3: The map page hydrates from / writes to the URL (#767 b)

- [ ] **Step 3a: Write the failing map-page tests**

Append to `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts`:

```ts
describe('Map page filters are URL-backed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    gotoMock.mockResolvedValue(undefined);
    mockPage.url = new URL('https://gallery.test/map');
    sdkMock.getTimeBuckets.mockResolvedValue([]);
    sdkMock.getFilteredMapMarkers.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates the filters from the URL into the marker query', async () => {
    mockPage.url = new URL('https://gallery.test/map?spaceId=space-1&make=Apple&rating=4&lens=RF24-70mm');

    renderPage();
    await flushQueryDebounce();

    await waitFor(() =>
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: 'space-1', make: 'Apple', rating: 4, lensModel: 'RF24-70mm' }),
      ),
    );
    expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument();
  });

  // NB: the panel stub's `filter-panel-set-year` is deliberately NOT used here. It sets only the
  // transient selectedYear, which encodeFilterParams does not emit — so the rebuilt URL would be
  // identical, the no-op guard would fire, and goto would never be called. Use a stub button that
  // sets a URL-ENCODED filter: `filter-panel-set-country` (bindable-filter-panel.stub.svelte:112-122,
  // sets country: 'Germany' -> `country=Germany`).
  it('writes a filter change back to the URL, preserving spaceId, q and the viewport hash', async () => {
    mockPage.url = new URL('https://gallery.test/map?spaceId=space-1&q=ski#12/48.85/2.35');

    renderPage();
    await fireEvent.click(screen.getByTestId('filter-panel-set-country'));

    await waitFor(() => expect(gotoMock).toHaveBeenCalled());
    const [target] = gotoMock.mock.calls.at(-1) as [string];
    expect(target).toContain('/map?');
    expect(target).toContain('spaceId=space-1');
    expect(target).toContain('q=ski');
    expect(target).toContain('country=Germany');
    expect(target).toContain('#12/48.85/2.35');
  });

  // The transient-only case, from the other side: a year is not a URL param, so the rebuilt URL is
  // unchanged and the guard must swallow the write rather than churn history. (The full year +
  // URL-filter round trip is pinned on the album page, which has a reactive page mock — Task 2.)
  it('does not write the URL for a transient-only (year) filter change', async () => {
    mockPage.url = new URL('https://gallery.test/map?spaceId=space-1');

    renderPage();
    await fireEvent.click(screen.getByTestId('filter-panel-set-year'));

    await waitFor(() => expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015'));
    expect(gotoMock).not.toHaveBeenCalled();
  });

  // The NIT decision, client side: a space and an album are two different scopes and the server
  // rejects their combination with a 400. Drop the album at hydrate so a hand-typed URL degrades to
  // a plain space map instead of an error.
  it('drops a stray albumId when the map is scoped to a space', async () => {
    mockPage.url = new URL('https://gallery.test/map?spaceId=space-1&albumId=album-9&make=Apple');

    renderPage();
    await flushQueryDebounce();

    await waitFor(() => expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalled());
    const [options] = sdkMock.getFilteredMapMarkers.mock.calls.at(-1) as [Record<string, unknown>];
    expect(options).toMatchObject({ spaceId: 'space-1', make: 'Apple' });
    expect(options.albumId).toBeUndefined();
  });

  // …but WITHOUT a space, an albumId IS a legitimate map scope (that is what the server-side album
  // access fix in Step 1 is for).
  it('keeps an albumId scope on the global map', async () => {
    mockPage.url = new URL('https://gallery.test/map?albumId=album-9');

    renderPage();
    await flushQueryDebounce();

    await waitFor(() =>
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledWith(expect.objectContaining({ albumId: 'album-9' })),
    );
  });
});
```

Run:

```bash
cd web && pnpm test --run "src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts"
```

Expected: **FAIL** — `filters` is `createFilterState()` and never reads the URL (`+page.svelte:72`), so `getFilteredMapMarkers` is called with `{ spaceId, withSharedSpaces }` only (no `make`/`rating`/`lensModel`/`albumId`); and no `goto` is issued on a panel change. (`does not write the URL for a transient-only (year) filter change` passes trivially today — it is a guard against the write half being wired to the wrong comparison later.)

- [ ] **Step 3b: Wire the map page**

In `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte` (`page` and `goto` are already imported, `:2-3`).

Add imports:

```ts
import { buildFilterStateUrl, isFilterStateUrlUnchanged } from '$lib/utils/filter-target';
import { decodeFilterParams } from '$lib/utils/filter-url';
import {
  preserveTransientTemporalFilters,
  type SearchablePageTransientTemporalState,
} from '$lib/utils/searchable-page-search';
import { untrack } from 'svelte';
```

(`onDestroy, onMount` are already imported from `svelte` — extend that line rather than adding a second import.)

Replace `let filters = $state<FilterState>(createFilterState());` (`:72`) with:

```ts
// #767(b): this used to be an always-empty createFilterState(), so every filter active on the
// surface you came from was dropped the moment you reached the map. The URL is the source of
// truth now.
//
// Unlike the album page, the map KEEPS an albumId filter — /map?albumId=X is a legitimate scope
// (that is what the server-side album-access fix in this slice exists for) — EXCEPT when the map is
// already scoped to a space. Space ∩ album is unsatisfiable (the space scope demands the asset be
// in the space; albumSharedSpaceScope, run with no timelineSpaceIds under a spaceId query, demands
// it be in no space at all) and the server 400s it. Dropping it here means a hand-typed
// /map?spaceId=S&albumId=A degrades to the space map instead of erroring.
const hydrateMapFilters = (url: URL): FilterState => {
  const decoded = decodeFilterParams(url);
  const spaceId = url.searchParams.get(QueryParameter.SPACE_ID) || undefined;
  return { ...createFilterState(), ...decoded, albumId: spaceId ? undefined : decoded.albumId };
};

let filters = $state<FilterState>(hydrateMapFilters(page.url));
let lastHandledFilterSearch = $state(page.url.search);
let pendingFilterUrlSync = $state<
  { search: string; transientTemporal?: SearchablePageTransientTemporalState } | undefined
>();
```

(`QueryParameter` is already imported on the map page, `:14`.)

Add the write half and the react half, next to `clearCommittedQuery` (`:222`):

```ts
function syncMapFilterUrl(nextFilters: FilterState) {
  const nextUrl = buildFilterStateUrl(page.url, nextFilters);
  // NOT a string compare — buildFilterStateUrl re-appends the filter params last, so a URL like
  // /map?make=Apple&spaceId=s1 rebuilds re-ordered. See filter-target.ts.
  if (isFilterStateUrlUnchanged(page.url, nextUrl)) {
    return;
  }
  pendingFilterUrlSync = {
    search: new URL(nextUrl, page.url).search,
    transientTemporal: {
      selectedYear: nextFilters.selectedYear,
      selectedMonth: nextFilters.selectedMonth,
    },
  };
  void goto(nextUrl, { replaceState: true, keepFocus: true, noScroll: true });
}

$effect(() => {
  const nextSearch = page.url.search;
  if (nextSearch === lastHandledFilterSearch) {
    return;
  }

  untrack(() => {
    const transientTemporal =
      pendingFilterUrlSync?.search === nextSearch ? pendingFilterUrlSync.transientTemporal : undefined;
    filters = {
      ...createFilterState(),
      ...preserveTransientTemporalFilters(hydrateMapFilters(page.url), transientTemporal),
    };
    if (pendingFilterUrlSync?.search === nextSearch) {
      pendingFilterUrlSync = undefined;
    }
    lastHandledFilterSearch = nextSearch;
  });
});
```

Wire the mutation sites:

- **Both** `FilterPanel` instances — desktop (`:289-296`) and the mobile overlay (`:306-313`) — get `onFiltersChange={syncMapFilterUrl}`. Miss the mobile one and filters silently stop persisting on phones.
- The `ActiveFiltersBar` handlers (`:326-331`):

```svelte
              onRemoveFilter={(type, id) => {
                filters = handlePhotosRemoveFilter(filters, type, id);
                syncMapFilterUrl(filters);
              }}
              onClearAll={() => {
                filters = clearFilters(filters);
                syncMapFilterUrl(filters);
              }}
```

Leave `<MapTimelinePanel bind:filters>` (`:371`) as it is: it does not drive the timeline's URL state today, and widening its contract is out of scope.

- [ ] **Step 3c: Verify GREEN**

```bash
cd web && pnpm test --run "src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts"
```

Expected: the five new tests pass and every pre-existing test in the file still passes — in particular the four that drive `filter-panel-set-year` / `clear-all-btn` (`:239`, `:250`, `:260`, `:195`): the write half must swallow a transient-only change (unchanged URL) and must not disturb `clearCommittedQuery`'s existing `goto`. (The two smart-search intersection tests still pass here — Task 4 deletes them.)

#### Step 4: `space-map.svelte` carries the space's live filters (#767 a, E10)

- [ ] **Step 4a: Write the failing component test**

Rewrite `web/src/lib/components/spaces/space-map.spec.ts`:

```ts
import { render, screen } from '@testing-library/svelte';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import SpaceMap from './space-map.svelte';

describe('SpaceMap', () => {
  it('links to /map with the spaceId when no filters are active', () => {
    render(SpaceMap, { spaceId: 'space-123', filters: createFilterState() });

    expect(screen.getByRole('link', { name: 'map' })).toHaveAttribute('href', '/map?spaceId=space-123');
  });

  // #767 / E10 — the link used to be a hard-coded `/map?spaceId=<id>`, so every filter and the
  // active search term were dropped on the way to the map.
  it('carries the space filters and the search query to the map', () => {
    render(SpaceMap, {
      spaceId: 'space-123',
      searchQuery: 'ski',
      filters: { ...createFilterState(), make: 'Apple', personIds: ['space-person:p1'] },
    });

    const href = screen.getByRole('link', { name: 'map' }).getAttribute('href') ?? '';
    expect(href).toContain('spaceId=space-123');
    expect(href).toContain('q=ski');
    expect(href).toContain('make=Apple');
    expect(href).toContain('people=space-person%3Ap1');
  });
});
```

Run:

```bash
cd web && pnpm test --run src/lib/components/spaces/space-map.spec.ts
```

Expected: **FAIL** — `SpaceMap` takes only `spaceId` (`space-map.svelte:7-11`) and hard-codes the href (`:13`), so the second test's `href` is `/map?spaceId=space-123` and every `toContain` after the first fails.

- [ ] **Step 4b: Build the link from live filter state**

Replace the script block of `web/src/lib/components/spaces/space-map.svelte`:

```svelte
<script lang="ts">
  import type { FilterState } from '$lib/components/filter-panel/filter-panel';
  import { Route } from '$lib/route';
  import { Icon } from '@immich/ui';
  import { mdiMapOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    spaceId: string;
    /**
     * The space's LIVE filter state. Required on purpose: this link used to be a hard-coded
     * `/map?spaceId=<id>`, which silently dropped every active filter and the search term on the
     * way to the map (#767a). Making the prop required means a new call site cannot re-introduce
     * that by simply forgetting it.
     */
    filters: FilterState;
    searchQuery?: string;
  }

  let { spaceId, filters, searchQuery }: Props = $props();

  const mapUrl = $derived(Route.map({ spaceId, query: searchQuery, filters }));
</script>
```

(The `QueryParameter` import goes away — `Route.map` owns the param name now. Leave the markup below the script untouched.)

- [ ] **Step 4c: Update the space page's call site**

In `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte:994`:

```svelte
        <SpaceMap spaceId={space.id} {filters} searchQuery={committedSearchQuery} />
```

Both `filters` (`:188`) and `committedSearchQuery` (`:799`) already exist on that page. Nothing else on the space page changes.

- [ ] **Step 4d: Verify GREEN**

```bash
cd web && pnpm test --run src/lib/components/spaces/space-map.spec.ts "src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts"
```

Expected: PASS. (`spaces-page.spec.ts:117` mocks `space-map.svelte`, so the new required prop cannot break it.)

#### Step 5: `AlbumMap.svelte` honors the album's active filters

- [ ] **Step 5a: Write the failing tests**

First, the options builder. Append to `web/src/lib/utils/__tests__/map-filter-options.spec.ts`:

```ts
describe('buildAlbumMapMarkerOptions', () => {
  it('scopes to the album and forwards the active filters', () => {
    const options = buildAlbumMapMarkerOptions('album-1', {
      ...createFilterState(),
      make: 'Apple',
      rating: 4,
      lensModel: 'RF24-70mm',
    });

    expect(options).toMatchObject({ albumId: 'album-1', make: 'Apple', rating: 4, lensModel: 'RF24-70mm' });
  });

  it('sends the album scope alone — no spaceId, no withSharedSpaces, no owner scope', () => {
    // The server derives everything else from albumId: it checks AlbumRead, leaves userIds unset,
    // and computes timelineSpaceIds itself so albumSharedSpaceScope can keep unreachable space
    // assets out (R4). The client must NOT try to help by adding withSharedSpaces — that flag also
    // changes how person tokens are resolved (resolveScopedMapPersonFilters), which is not what an
    // album query wants.
    expect(buildAlbumMapMarkerOptions('album-1', createFilterState())).toEqual({ albumId: 'album-1' });
  });
});
```

(Import `buildAlbumMapMarkerOptions` alongside the builders already imported in that file, and `createFilterState` if it is not imported yet.)

Then the component. Create `web/src/lib/components/album-page/__tests__/AlbumMap.spec.ts`:

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import { albumFactory } from '@test-data/factories/album-factory';
import AlbumMap from '../AlbumMap.svelte';

const { handleErrorMock, modalShowMock } = vi.hoisted(() => ({
  handleErrorMock: vi.fn(),
  modalShowMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/utils/handle-error', () => ({ handleError: handleErrorMock }));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: { isSharedLink: false, params: {} },
}));

vi.mock('@immich/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/ui')>();
  return { ...actual, modalManager: { show: modalShowMock } };
});

describe('AlbumMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modalShowMock.mockResolvedValue(undefined);
    sdkMock.getAlbumMapMarkers.mockResolvedValue([]);
    sdkMock.getFilteredMapMarkers.mockResolvedValue([]);
  });

  it('fetches album-scoped markers honouring the active filters', async () => {
    const album = albumFactory.build({ id: 'album-1' });

    render(AlbumMap, { album, filters: { ...createFilterState(), make: 'Apple' } });

    await vi.waitFor(() =>
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledWith(
        expect.objectContaining({ albumId: 'album-1', make: 'Apple' }),
        expect.anything(),
      ),
    );
    expect(sdkMock.getAlbumMapMarkers).not.toHaveBeenCalled();
    expect(screen.getByLabelText('map')).toBeInTheDocument();
  });

  it('refetches when the album filters change', async () => {
    const album = albumFactory.build({ id: 'album-1' });
    const { rerender } = render(AlbumMap, { album, filters: { ...createFilterState(), make: 'Apple' } });

    await vi.waitFor(() => expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledTimes(1));

    await rerender({ album, filters: { ...createFilterState(), make: 'Canon' } });

    await vi.waitFor(() =>
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenLastCalledWith(
        expect.objectContaining({ albumId: 'album-1', make: 'Canon' }),
        expect.anything(),
      ),
    );
  });

  // Markers now load from an $effect, not once from onMount — so every filter change aborts the
  // in-flight request, and the superseded promise REJECTS. Without a guard that rejection reaches
  // handleError and the user gets an error toast for every character they type into a filter.
  it('does not surface an error when a filter change aborts the in-flight request', async () => {
    const album = albumFactory.build({ id: 'album-1' });
    let rejectFirst: (error: unknown) => void = () => {};
    sdkMock.getFilteredMapMarkers
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectFirst = reject;
        }) as never,
      )
      .mockResolvedValueOnce([{ id: 'asset-2', lat: 1, lon: 2 }] as never);

    const { rerender } = render(AlbumMap, { album, filters: { ...createFilterState(), make: 'Apple' } });
    await vi.waitFor(() => expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledTimes(1));

    await rerender({ album, filters: { ...createFilterState(), make: 'Canon' } });
    await vi.waitFor(() => expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledTimes(2));

    // …and only now does the aborted first request settle.
    rejectFirst(new DOMException('The operation was aborted.', 'AbortError'));
    await vi.waitFor(() => expect(handleErrorMock).not.toHaveBeenCalled());

    // The second response is the one on the map.
    await userEvent.setup().click(screen.getByLabelText('map'));
    expect(modalShowMock).toHaveBeenCalledWith(expect.anything(), {
      mapMarkers: [{ id: 'asset-2', lat: 1, lon: 2 }],
    });
  });

  // The other half of the same race: a superseded request that RESOLVES late must not clobber the
  // markers of the request that replaced it.
  it('ignores a stale response that resolves after a newer one', async () => {
    const album = albumFactory.build({ id: 'album-1' });
    let resolveFirst: (markers: unknown) => void = () => {};
    sdkMock.getFilteredMapMarkers
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }) as never,
      )
      .mockResolvedValueOnce([{ id: 'fresh', lat: 1, lon: 2 }] as never);

    const { rerender } = render(AlbumMap, { album, filters: { ...createFilterState(), make: 'Apple' } });
    await vi.waitFor(() => expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledTimes(1));

    await rerender({ album, filters: { ...createFilterState(), make: 'Canon' } });
    await vi.waitFor(() => expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledTimes(2));

    resolveFirst([{ id: 'stale', lat: 9, lon: 9 }]);
    await vi.waitFor(() => expect(handleErrorMock).not.toHaveBeenCalled());

    await userEvent.setup().click(screen.getByLabelText('map'));
    expect(modalShowMock).toHaveBeenCalledWith(expect.anything(), { mapMarkers: [{ id: 'fresh', lat: 1, lon: 2 }] });
  });

  // AlbumViewer.svelte (the SHARED-LINK album view) renders AlbumMap with no filters. That path
  // must keep using the album endpoint: /gallery/map/markers has no shared-link auth, and E2 says
  // shared links get no filter affordances at all.
  it('falls back to the album endpoint when no filters are provided', async () => {
    render(AlbumMap, { album: albumFactory.build({ id: 'album-1' }) });

    await vi.waitFor(() =>
      expect(sdkMock.getAlbumMapMarkers).toHaveBeenCalledWith({ id: 'album-1' }, expect.anything()),
    );
    expect(sdkMock.getFilteredMapMarkers).not.toHaveBeenCalled();
  });
});
```

Finally, the album page must actually **pass** its filters to `<AlbumMap>` — the component test above would happily pass while the page still rendered `<AlbumMap {album} />`. Add this to `page.route.spec.ts`. The album spec mocks the feature flags off (`page.route.spec.ts:32-38`, `value: { map: false }`), so `AlbumMap` never renders there today; make that mock a **hoisted, mutable** object first:

```ts
const { registerAlbumContextMock, registerSelectionContextMock, mockFeatureFlagsManager } = vi.hoisted(() => ({
  registerAlbumContextMock: vi.fn(),
  registerSelectionContextMock: vi.fn(),
  mockFeatureFlagsManager: { init: vi.fn(), loadFeatureFlags: vi.fn(), value: { map: false } },
}));

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: mockFeatureFlagsManager as never,
}));
```

and reset it in the existing `beforeEach` (`vi.clearAllMocks()` does not touch a plain object):

```ts
mockFeatureFlagsManager.value.map = false;
```

Then the test:

```ts
it('passes the album filters to the album map', async () => {
  mockFeatureFlagsManager.value.map = true;
  sdkMock.getFilteredMapMarkers.mockResolvedValue([]);
  mockPage.url = new URL('https://gallery.test/albums/album-1?make=Apple');

  renderPage(albumFactory.build({ id: 'album-1', assetCount: 2 }));

  await waitFor(() =>
    expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledWith(
      expect.objectContaining({ albumId: 'album-1', make: 'Apple' }),
      expect.anything(),
    ),
  );
});
```

Run:

```bash
cd web && pnpm test --run src/lib/utils/__tests__/map-filter-options.spec.ts \
  src/lib/components/album-page/__tests__/AlbumMap.spec.ts \
  "src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts"
```

Expected: **FAIL** — `buildAlbumMapMarkerOptions` does not exist; `AlbumMap` has no `filters` prop, so it always calls `getAlbumMapMarkers` (`AlbumMap.svelte:44`), never refetches (markers load once in `onMount`, `:23-25`) and toasts through `handleError` on the aborted request (`:45-48`); and the album page renders `<AlbumMap {album} />` with no filters (`+page.svelte:781`).

- [ ] **Step 5b: Add the album marker-options builder**

Append to `web/src/lib/utils/map-filter-options.ts`:

```ts
/**
 * Markers for ONE album, honouring that album's active filters.
 *
 * No `withSharedSpaces` and no owner scope: album ACCESS is the scope. The server checks AlbumRead
 * and then leaves `userIds` unset so searchAssetBuilder takes its album branch — owner-scoping an
 * album query hides the album owner's pins from a viewer of a shared album (issue #656).
 */
export function buildAlbumMapMarkerOptions(albumId: string, filters: FilterState): Record<string, unknown> {
  const base = applyCommonMapFilters({ albumId }, filters);

  if (filters.lensModel) {
    base.lensModel = filters.lensModel;
  }
  if (filters.state) {
    base.state = filters.state;
  }
  if (filters.ownerId) {
    base.ownerId = filters.ownerId;
  }

  if (filters.mediaType !== 'all') {
    base.$type = filters.mediaType === 'image' ? MapMediaType.Image : MapMediaType.Video;
  }

  return base;
}
```

(`filters.albumId` is deliberately not read — the album argument is the scope.)

- [ ] **Step 5c: Make `AlbumMap` filter-aware**

In `web/src/lib/components/album-page/AlbumMap.svelte`, extend the props and the fetch:

```ts
import { buildAlbumMapMarkerOptions } from '$lib/utils/map-filter-options';
import type { FilterState } from '$lib/components/filter-panel/filter-panel';
import {
  getAlbumMapMarkers,
  getFilteredMapMarkers,
  type AlbumResponseDto,
  type MapMarkerResponseDto,
} from '@immich/sdk';

interface Props {
  album: AlbumResponseDto;
  /**
   * The album's LIVE filter state. Absent on the shared-link album view (AlbumViewer.svelte),
   * which must keep using the album endpoint: /gallery/map/markers takes no shared-link key, and
   * a shared link exposes no filter affordances anyway (E2).
   */
  filters?: FilterState;
}

let { album, filters }: Props = $props();
```

and replace `loadMapMarkers` (`:39-49`) — note this is where the **abort + stale guards** go:

```ts
let requestToken = 0;

/**
 * Markers now reload on every filter change (see the $effect below), which means each new load
 * ABORTS the one in flight — and an aborted fetch REJECTS. Under the old onMount-only load that
 * could never happen, so the catch fed straight into handleError; keep that and the user gets an
 * error toast every time they touch a filter. Two guards:
 *  - `controller.signal.aborted` → this request was superseded on purpose; say nothing.
 *  - `token !== requestToken`    → a newer request already answered; do not clobber its markers
 *                                  with this stale response (an abort does not un-send a request
 *                                  that is already coming back).
 */
const loadMapMarkers = async () => {
  cancelable?.abort();
  const controller = new AbortController();
  cancelable = controller;
  const token = ++requestToken;

  try {
    const markers =
      filters && !authManager.isSharedLink
        ? await getFilteredMapMarkers(buildAlbumMapMarkerOptions(album.id, filters), {
            signal: controller.signal,
          })
        : await getAlbumMapMarkers({ ...authManager.params, id: album.id }, { signal: controller.signal });

    if (token !== requestToken) {
      return;
    }
    mapMarkers = markers;
  } catch (error) {
    if (controller.signal.aborted || token !== requestToken) {
      return;
    }
    handleError(error, $t('errors.something_went_wrong'));
  }
};
```

Markers are loaded in `onMount` (`:23-25`); make them reload when the filters change, so the map reflects what the user is looking at:

```ts
$effect(() => {
  // Explicit dependency: `filters` is undefined on the shared-link path, where the rest of the
  // reads below would not touch it at all.
  void filters;
  void loadMapMarkers();
});
```

and delete the now-redundant `onMount` block (keep `onDestroy` — it still aborts the in-flight request — and drop `onMount` from the `svelte` import). `loadMapMarkers` now assigns `mapMarkers` itself, so it no longer returns them.

Update the album page's call site (`albums/…/+page.svelte:781`):

```svelte
              <AlbumMap {album} filters={albumFilters} />
```

`AlbumViewer.svelte:147` stays `<AlbumMap {album} />` — unchanged.

- [ ] **Step 5d: Verify GREEN and run the whole web gate for this task**

```bash
cd web && pnpm test --run src/lib/route.spec.ts src/lib/utils src/lib/components/spaces/space-map.spec.ts \
  src/lib/components/album-page "src/routes/(user)/map" "src/routes/(user)/albums" "src/routes/(user)/spaces" \
  && pnpm check:typescript && pnpm lint
```

Expected: all PASS; typecheck clean; lint **0 errors**.

- [ ] **Step 6: Commit the web half**

```bash
git add web/src/lib/route.ts web/src/lib/route.spec.ts \
        web/src/lib/utils/map-filter-options.ts web/src/lib/utils/__tests__/map-filter-options.spec.ts \
        web/src/lib/components/spaces/space-map.svelte web/src/lib/components/spaces/space-map.spec.ts \
        web/src/lib/components/album-page/AlbumMap.svelte web/src/lib/components/album-page/__tests__/AlbumMap.spec.ts \
        "web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte" \
        "web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts" \
        "web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte" \
        "web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte" \
        "web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts"
git commit -m "fix(map): carry active filters to the map (#767 a+b)

The map page's filter state was a component-local createFilterState() that was
always empty, and the space map link was a hard-coded /map?spaceId=<id> that
dropped the search term and every filter param. Both are fixed by making the map
URL-backed and building every map link from live filter state:

- Route.map now emits /map?<scope+filters>#<zoom>/<lat>/<lng> (E11); it could
  only emit the hash before. All five existing callers keep their old output.
- The map page hydrates its filters from the URL, writes them back on change, and
  re-hydrates on back/forward — with the photos page's token guard and its
  transient selectedYear/selectedMonth carry-over. A space-scoped map drops a
  stray albumId at hydrate: the server rejects that combination, because the two
  scopes cannot both hold.
- SpaceMap takes the space's live filters (E10); AlbumMap takes the album's and
  fetches album-scoped markers, while the shared-link view keeps the album
  endpoint. AlbumMap's markers now load from an \$effect, so it guards against the
  abort and the stale response a filter change produces."
```

---

### Task 4: The map is honest about a smart search it cannot apply (Slice 5 = #767 c)

**Files:**

- Modify: `server/src/dtos/server.dto.ts`, `server/src/services/server.service.ts`, `server/src/services/server.service.spec.ts`
- Regenerate: OpenAPI + SDK (`make open-api`)
- Modify: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte`, `…/map-page.spec.ts`
- Modify: `i18n/en.json`

**Read Reality check R2 first.** The map's existing `q` handling is a client-side intersection against `searchSmart` (`+page.svelte:157-205`). It is **conditionally correct**: with `machineLearning.clip.maxDistance ∈ (0, 2)` it genuinely narrows; with the default `0` it has no relevance cutoff, so it pages the whole library and keeps every marker — costing `library_size / 100` requests to render the same full map.

The client cannot tell which world it is in (`maxDistance` is admin-only config). So the **server publishes the fact** and the map obeys it:

- Cutoff configured ⇒ run the loop exactly as today. **No behaviour change, no regression.**
- No cutoff (the default) ⇒ **skip the loop entirely** (no request storm) and say plainly that the smart-search term is not applied.

This is a **gate**, not a deletion: the loop, `buildSmartSearchParams`, `SvelteSet`, the `searchSmart` import and the two existing tests that pin the loop all **stay**. Do not delete them.

**Interfaces:**

- Produces: `ServerFeaturesDto.smartSearchHasCutoff: boolean`; i18n key `map_smart_search_not_applied`.
- Consumes: `featureFlagsManager` — **already imported** by the map page (`+page.svelte:17`, used at `:242` / `:260`), so no new store wiring.
- `committedQuery` (`+page.svelte:50`) already reads `?q=` and `ActiveFiltersBar` already renders it as a clearable chip (`:321-325`) — that chip is what makes today's silence dishonest, and it stays.

- [ ] **Step 1a: Server — failing test for the derived flag**

In `server/src/services/server.service.spec.ts`, inside the existing `describe('getFeatures', …)`, append:

```ts
it('reports a smart-search cutoff when clip.maxDistance is an active threshold', async () => {
  mocks.systemMetadata.get.mockResolvedValue({
    machineLearning: { enabled: true, clip: { enabled: true, maxDistance: 1.2 } },
  });

  await expect(sut.getFeatures()).resolves.toMatchObject({ smartSearchHasCutoff: true });
});

it('reports no smart-search cutoff on the default maxDistance of 0', async () => {
  mocks.systemMetadata.get.mockResolvedValue({
    machineLearning: { enabled: true, clip: { enabled: true, maxDistance: 0 } },
  });

  await expect(sut.getFeatures()).resolves.toMatchObject({ smartSearchHasCutoff: false });
});

it('reports no smart-search cutoff when machine learning is disabled entirely', async () => {
  mocks.systemMetadata.get.mockResolvedValue({
    machineLearning: { enabled: false, clip: { enabled: true, maxDistance: 1.2 } },
  });

  await expect(sut.getFeatures()).resolves.toMatchObject({ smartSearchHasCutoff: false });
});
```

Match the surrounding tests' arrangement style for `mocks.systemMetadata.get` — read the existing `getFeatures` block first and mirror it rather than copying the shape above verbatim; a partial config mock must still merge over `defaults`.

Run:

```bash
cd server && pnpm test -- --run src/services/server.service.spec.ts
```

Expected: **FAIL** — three failures, each `smartSearchHasCutoff: undefined` not matching the expected boolean.

- [ ] **Step 1b: Server — add the flag**

In `server/src/dtos/server.dto.ts`, add to `ServerFeaturesSchema` (`:132-…`), keeping it beside the other machine-learning booleans:

```ts
smartSearch: z.boolean().describe('Whether smart search is enabled'),
smartSearchHasCutoff: z
  .boolean()
  .describe('Whether smart search has an active relevance cutoff (clip.maxDistance)'),
```

In `server/src/services/server.service.ts`, `getFeatures()` (`:126-130`) — derive it exactly like its neighbours:

```ts
smartSearch: isSmartSearchEnabled(machineLearning),
smartSearchHasCutoff:
  isSmartSearchEnabled(machineLearning) && isActiveDistanceThreshold(machineLearning.clip.maxDistance),
```

Import `isActiveDistanceThreshold` from `src/repositories/search.repository` (it is already exported at `:303`; server forbids relative imports). Reusing it — rather than re-writing `maxDistance > 0` inline — is the point: the flag and the query predicate must never drift apart.

Run the same command.

Expected: **PASS** — the three new tests and the whole existing `server.service.spec.ts`.

- [ ] **Step 1c: Regenerate the SDK**

```bash
cd server && pnpm build && pnpm sync:open-api && cd .. && make open-api
```

Then confirm the flag reached the TypeScript SDK (the web build consumes it):

```bash
grep -rn "smartSearchHasCutoff" open-api/typescript-sdk/src/fetch-client.ts
```

Expected: it appears on `ServerFeaturesDto`. Commit the regenerated `open-api/` output with the rest (this branch already carries one SDK regen, `fd40935e4f`).

- [ ] **Step 2: Web — write the failing tests**

In `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts`:

**Keep both intersection tests** — `it('intersects map markers with paginated searchSmart ids when q is present', …)` (`:152-176`) and `it('stops paging once every currently fetched marker id has been matched', …)` (`:178-193`). They now describe the **cutoff-configured** instance, which is a real supported configuration. Arrange them onto it explicitly (see the mock below): set `smartSearchHasCutoff: true` in their `beforeEach`, or per-test if the file's structure makes that cleaner. Do **not** leave them relying on an ambient default — the whole point of this task is that the two worlds are now distinguishable, so each test must say which one it is in.

The map page reads `featureFlagsManager.value` (`:17`, `:242`, `:260`), so the spec must already stub it. **Find that existing stub and extend it** with `smartSearchHasCutoff`; do not add a second competing mock. If the stub is a shared object, give it a per-test override, e.g.:

```ts
// alongside the file's existing featureFlagsManager mock
featureFlagsMock.value = { ...featureFlagsMock.value, map: true, smartSearchHasCutoff: false };
```

Note `featureFlagsManager.value` is a **throwing getter** when unloaded (`feature-flags-manager.svelte.ts:17-22`) — an under-specified mock fails loudly rather than silently defaulting, which is what we want.

Then append:

```ts
describe('Map page smart-search honesty (#767c)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    gotoMock.mockResolvedValue(undefined);
    mockPage.url = new URL('https://gallery.test/map');
    sdkMock.getTimeBuckets.mockResolvedValue([]);
    sdkMock.getFilteredMapMarkers.mockResolvedValue([]);
    // Default instance: clip.maxDistance = 0 ⇒ smart search cannot narrow anything.
    featureFlagsMock.value = { ...featureFlagsMock.value, map: true, smartSearchHasCutoff: false };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies every structured filter and says the smart-search term is not applied', async () => {
    mockPage.url = new URL('https://gallery.test/map?q=ski&make=Apple&rating=4');
    sdkMock.getFilteredMapMarkers.mockResolvedValue([{ id: 'asset-1', lat: 1, lon: 2 } as never]);

    renderPage();
    await flushQueryDebounce();

    await waitFor(() => {
      // the structured half of the filter IS honoured…
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledWith(expect.objectContaining({ make: 'Apple', rating: 4 }));
      // …the smart-search half is not, and the map says so instead of pretending
      expect(screen.getByTestId('map-smart-search-notice')).toBeInTheDocument();
    });

    // The loop that pages the entire library and narrows nothing never runs here (R2).
    expect(sdkMock.searchSmart).not.toHaveBeenCalled();
    // The markers matching the structured filters are still shown — not a silent full library, and
    // not a silently empty map either.
    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-marker-ids', 'asset-1');
  });

  it('intersects and shows NO notice when the instance has a smart-search cutoff', async () => {
    // The regression guard for the configured instance: this is the test that fails if someone
    // "simplifies" the gate away by deleting the loop.
    featureFlagsMock.value = { ...featureFlagsMock.value, smartSearchHasCutoff: true };
    mockPage.url = new URL('https://gallery.test/map?q=ski');
    sdkMock.getFilteredMapMarkers.mockResolvedValue([
      { id: 'asset-1', lat: 1, lon: 2 } as never,
      { id: 'asset-2', lat: 3, lon: 4 } as never,
    ]);
    sdkMock.searchSmart.mockResolvedValue({
      assets: { items: [{ id: 'asset-2' }], nextPage: null },
    } as never);

    renderPage();
    await flushQueryDebounce();

    await waitFor(() => expect(sdkMock.searchSmart).toHaveBeenCalled());
    // Narrowed to the semantic match…
    await waitFor(() => expect(screen.getByTestId('map-stub')).toHaveAttribute('data-marker-ids', 'asset-2'));
    // …and no notice, because the term genuinely WAS applied.
    expect(screen.queryByTestId('map-smart-search-notice')).not.toBeInTheDocument();
  });

  it('shows no notice when there is no smart-search term', async () => {
    mockPage.url = new URL('https://gallery.test/map?make=Apple');
    sdkMock.getFilteredMapMarkers.mockResolvedValue([{ id: 'asset-1', lat: 1, lon: 2 } as never]);

    renderPage();
    await flushQueryDebounce();

    await waitFor(() => expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalled());
    expect(screen.queryByTestId('map-smart-search-notice')).not.toBeInTheDocument();
  });

  it('shows no notice for a whitespace-only q', async () => {
    mockPage.url = new URL('https://gallery.test/map?q=%20%20');

    renderPage();
    await flushQueryDebounce();

    expect(screen.queryByTestId('map-smart-search-notice')).not.toBeInTheDocument();
  });
});
```

Run:

```bash
cd web && pnpm test --run "src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts"
```

Expected: **FAIL** — `map-smart-search-notice` does not exist (`Unable to find an element by: [data-testid="map-smart-search-notice"]`), and `expect(sdkMock.searchSmart).not.toHaveBeenCalled()` fails in the first test because the loop still runs unconditionally. The cutoff-enabled test should already **pass** (it describes today's behaviour) — if it fails, the `featureFlagsMock` stub is wrong and must be fixed before proceeding, not worked around.

- [ ] **Step 3: Add the i18n key**

In `i18n/en.json` (**English only** — other locales fall back; the directory is shared with mobile). Top-level keys are alphabetical, so the key belongs among the existing `map_*` block (`:1902-1920`), **not** after `maintenance_title`: insert it between `"map_settings_theme_settings"` (`:1920`) and `"mark_all_as_read"` (`:1921`) — `map_se…` < `map_sm…` < `mark…`.

```json
  "map_settings_theme_settings": "Map Theme",
  "map_smart_search_not_applied": "Smart search isn't applied on the map. The map shows every photo matching your other filters.",
  "mark_all_as_read": "Mark all as read",
```

- [ ] **Step 4: Gate the intersection loop and render the notice**

In `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte`.

**Do not restructure the `$effect`.** The whole change is a gate on the existing early-return, plus a derived flag and the notice markup. The loop, `buildSmartSearchParams`, `SvelteSet` and the `searchSmart` import all **stay** — they are live code on a cutoff-configured instance. There are no unused imports to remove.

**4a.** In the marker-fetch `$effect` (`:136-220`), read the flag alongside the other tracked values (`:139-141`) so the effect re-runs if it resolves late:

```ts
const options = mapMarkerOptions;
const currentSpaceId = spaceId;
const query = committedQuery.trim();
// Admin-only config: only the server can tell us whether smart search actually narrows
// anything (clip.maxDistance). Without a cutoff the ranked result set is the whole scoped
// library, so the loop below would page it to exhaustion and match every marker — see R2.
const canApplySmartSearch = featureFlagsManager.value.smartSearchHasCutoff;
```

Then widen the existing early return (`:157-160`) — this is the entire behavioural change:

```ts
if (!query || !canApplySmartSearch) {
  mapMarkers = markers;
  return;
}
```

Everything below it (the `markers.length === 0` guard, the paging loop, the final `markers.filter`) is untouched.

**4b.** Add the derived flag next to `hasActiveFilters` (`:95`):

```ts
const hasUnappliedSmartSearch = $derived(
  committedQuery.trim().length > 0 && !featureFlagsManager.value.smartSearchHasCutoff,
);
```

**4c.** Render the notice. Put it directly under the `ActiveFiltersBar` overlay (`:317-335`), inside the same absolutely-positioned column, so it sits with the chip that shows the search term:

```svelte
        {#if hasUnappliedSmartSearch}
          <div
            class="absolute inset-x-0 top-0 z-10 mt-12 px-4"
            data-testid="map-smart-search-notice"
            role="status"
          >
            <p class="rounded-lg bg-warning/90 px-4 py-2 text-sm text-dark shadow">
              {$t('map_smart_search_not_applied')}
            </p>
          </div>
        {/if}
```

Keep the existing `noResults` overlay (`:351-359`) as is.

- [ ] **Step 5: Verify GREEN**

```bash
cd web && pnpm test --run "src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts"
```

Expected: **PASS** — the four new tests **and** both pre-existing intersection tests (now explicitly arranged onto a cutoff-configured instance), plus everything else in the file.

- [ ] **Step 6: Full gate (server + web)**

```bash
cd server && pnpm test -- --run src/services/server.service.spec.ts && pnpm check
cd ../web && pnpm test --run && pnpm check:typescript && pnpm lint
```

Expected: server tests + typecheck clean; the whole web suite passes; typecheck clean; lint **0 errors** (≈640 pre-existing `better-tailwindcss` warnings). Do **not** `eslint --fix`.

- [ ] **Step 7: Commit**

```bash
git add server/src/dtos/server.dto.ts server/src/services/server.service.ts \
        server/src/services/server.service.spec.ts open-api \
        "web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte" \
        "web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts" \
        i18n/en.json
git commit -m "fix(map): only intersect ?q= when smart search can actually narrow (#767c)

The map applied ?q= by paging searchSmart and keeping the markers whose ids came
back. That intersection only narrows when a CLIP distance threshold is active:
the distance predicate is applied conditionally, so without a cutoff nothing is
excluded and the ranked result set is the whole scoped library. The loop paged it
to exhaustion, matched every marker, and rendered them all anyway — at one request
per 100 assets. machineLearning.clip.maxDistance defaults to 0, so that was the
default experience.

Smart search itself is unaffected and works fine without a cutoff; this was only
ever about the map's client-side intersection.

ServerFeaturesDto now publishes smartSearchHasCutoff (derived, like the other ML
feature flags — the client cannot read admin config). The map intersects only when
it is true, and otherwise applies every structured filter and states plainly that
the smart-search term is not applied, instead of silently showing everything.
Instances with a cutoff configured keep the behaviour they had.

Carrying q to /map/markers on every instance needs server-side embedding support
and remains the spec's follow-up."
```

---

## Done When

- `buildFilterStateUrl` writes a complete `FilterState` into a URL — replacing, never merging — preserving non-filter params and the map's viewport hash, and dropping `at`; `isFilterStateUrlUnchanged` makes the write-back no-op guard order-insensitive, so a rebuilt-but-equivalent URL does not churn history.
- Album filters survive a **reload**, **back/forward** and a **shared URL**; a transient year survives a URL-writing filter change (`pendingFilterUrlSync` is exercised, not just present); a stray `?albumId=` on an album page is ignored (E9); picker filters stay out of the URL.
- The map page hydrates its filters from the URL and writes them back; `Route.map` emits `/map?<filters>#<zoom>/<lat>/<lng>` (E11) and all five existing callers still resolve to their old output; the space map link carries `spaceId` **and** the active filters **and** `q` (E10, #767a); the album map honors the album's filters, refetches when they change, and neither toasts nor renders stale markers when a request is superseded.
- `/gallery/map/markers?albumId=…` is scoped by album **access**, not asset owner — and an **e2e** test proves it: a viewer of a shared album sees the owner's pins (#656 class), and an album asset that also lives in a shared space keeps its pin (the R4 regression). `spaceId` + `albumId` is a 400, and the map page never sends the combination.
- `ServerFeaturesDto.smartSearchHasCutoff` is derived from `isSmartSearchEnabled(ml) && isActiveDistanceThreshold(ml.clip.maxDistance)` and reaches the SDK.
- On an instance **with** a cutoff, the map still intersects `?q=` exactly as before and shows **no** notice — no regression, and a test pins it.
- On an instance **without** one (the default), the map applies every structured filter, never fires the paging loop, and an explicit notice says the smart-search term is not applied. With no `q`, no notice renders. The map never silently shows the full library, and never silently blanks under a `q` because embeddings are missing.
- `web/src/lib/utils/__tests__/searchable-page-search.spec.ts` is untouched and green; `/photos` and `/spaces` behave exactly as before.
