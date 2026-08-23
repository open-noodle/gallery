# Search palette: every result filters the surface you're on

Design for [#922](https://github.com/open-noodle/gallery/issues/922).

## Problem

Picking a **Person** in the search palette navigates to `/people/<id>` — the person management page — instead of filtering the timeline you were looking at. Picking a **Place** navigates to `/map`. Every other palette result either filters the current surface (tags, typed search, field search) or opens a genuine destination (album, space, asset, nav route).

Two results out of eight break the rule, and both are the ones a user reaches for while browsing a timeline.

### What is _not_ the problem

The issue was filed as "the palette routes to the deprecated `/search` page". It does not. Tags were moved off `/search` for #894, and `buildSearchDestination` has always targeted the searchable page. The palette's navigation catalogue has no `/search` entry. The remaining in-app links to `/search` all live outside the palette:

| Call site                                                     | Status                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `DetailPanel.svelte` — camera make/model, lens                | PR #778 in flight                                                                                             |
| `explore/+page.svelte`, `PlacesCardGroup.svelte` — city tiles | PR #884 in flight                                                                                             |
| `asset.service.ts` — "View similar photos"                    | not covered; out of scope here                                                                                |
| `search/+page.svelte` — the legacy page's own re-navigation   | intentional; the page is kept as a landing page for old bookmarks, with a "use ⌘K" banner pinned by e2e tests |

This design keeps the palette clean and adds a guard so it stays that way. It does not delete the `/search` route.

## Design

### 1. One funnel for "result → filter the surface you're on"

`global-search-manager.svelte.ts` already carries two near-identical private methods, `navigateToTagResults` (from #894) and `navigateToFieldResults`. Both compute a base page, AND a filter into the current filter state, build a searchable-page URL, and `goto` it. Adding person and place would make four copies.

Extract a single helper and fold the existing two into it:

```ts
private navigateToFilteredResults(options: {
  applyFilter: (filters: FilterState) => FilterState;
  /** Override the base page. Used when the current surface cannot express the filter. */
  target?: URL;
  /** Omitted entirely = write nothing to the name cache; present = write, even if empty. */
  names?: { personNames?: Map<string, string>; tagNames?: Map<string, string> };
}): void
```

Behaviour, unchanged from what `navigateToTagResults` does today:

- Base page = `options.target`, else `page.url` when `getSearchablePageBasePath` recognises it, else `new URL('/photos', page.url)`.
- Start from `this.searchablePageFiltersProvider?.() ?? createFilterState()` so filters already on screen survive.
- Build with `buildSearchablePageUrl(base, '', this.searchSortOrder, filters)`, falling back to `'/photos'`. The empty query argument drops a stale `q` (and a non-explicit `sort`) so the newly picked filter is the only constraint — this is existing tag behaviour, pinned by `'drops a stale smart query so the tag filter is the only constraint'`, and person and place inherit it.
- Seed `storeTypedSearchNames(destination, { personNames, tagNames })` so a new chip renders a label rather than a uuid. The helper drops empty labels before storing, so every caller inherits the guard — `active-filters-bar` falls back to the raw id only for a _missing_ entry, so caching `''` renders a blank chip.
- `goto(destination)`.

`buildSearchDestination` (smart/typed search) is deliberately left alone: it has a `/map?q=` special case this helper must not inherit.

### 2. Person → `?people=…`

The filter-id encoding is scope-dependent, and getting it wrong yields a silently empty timeline. A space searchable page sends `personIds` on to the API as `spacePersonIds` — bare profile ids scoped to that space (`space-filter-options.ts`). `/photos` and `/recently-added` send them prefixed, `person:<profileId>` or `space-person:<profileId>` (`photos-filter-options.ts`, `getPhotosPersonFilterId`). The typed-search resolver already splits on exactly this distinction (`getPersonFilterId(person, scope)`), so the palette follows the same rule:

| Current page                                       | Person                      | Destination                             |
| -------------------------------------------------- | --------------------------- | --------------------------------------- |
| `/spaces/<sid>`, `/spaces/<sid>/photos`            | space-person **of `<sid>`** | stay put, `?people=<bare profileId>`    |
| `/spaces/<sid>`, `/spaces/<sid>/photos`            | anything else               | `/photos?people=<prefixed filterId>`    |
| `/photos`, `/recently-added`                       | any                         | stay put, `?people=<prefixed filterId>` |
| anything else (`/albums/x`, `/map`, `/explore`, …) | any                         | `/photos?people=<prefixed filterId>`    |

The space branch requires **both** that the base path is a space searchable page and that the person is a space-person of that same space. `/spaces/<sid>/albums/<aid>` is not a searchable page, so it falls to `/photos` like any other unrecognised surface.

Prefixed ids come from the existing `getPhotosPersonFilterId`, which prefers the server-supplied `filterId` and otherwise reconstructs `<person|space-person>:<primaryProfile.id>` — matching how the server builds it (`face-identity.repository.ts`).

`person.name` is written into `personNames` keyed by the filter id used, so the chip reads the name.

**Recents.** `activate('person')` only records a recent for non-space people, and stores `personId = primaryProfile?.id ?? id`. Replaying a person recent therefore reconstructs `person:${entry.personId}`, which is exact for a user-person. Replay goes through the same helper, so a recent lands where a fresh pick lands.

### 3. Place → `?city=…`, except on `/map`

`PlacesResponseDto` carries `name`, `latitude`, `longitude`, `admin1name`, `admin2name`. Of those only `name` maps to a searchable-page param (`city`); there is no `state` filter. `place-preview.svelte` searches by both `city: place.name` and `state: place.admin1name`, so for two same-named cities in different states the destination is a deliberate superset of what the preview showed.

| Current page                  | Destination                                     |
| ----------------------------- | ----------------------------------------------- |
| `pathname.startsWith('/map')` | `Route.map({ zoom: 12, lat, lng })` (unchanged) |
| any searchable page           | stay put, `?city=<place.name>`                  |
| anything else                 | `/photos?city=<place.name>`                     |

`city` is single-valued, so a new place replaces any city filter already applied rather than accumulating. Place recents replay through the same rule, falling back to map centring when the stored label is empty (an unnamed place cannot produce a `city` filter).

### 4. "Open person page" in the preview pane

With Enter re-pointed at the timeline, the palette loses its one-click path to rename / merge / hide / birthday / fix-incorrect-match. `person-preview.svelte` gains a button in the same slot `photo-preview`, `album-preview` and `space-preview` already use:

```svelte
<div class="flex gap-2">
  <Button variant="ghost" size="small" onclick={() => goto(getGlobalPersonHref(person))}>
    {$t('cmdk_open_person_page')}
  </Button>
</div>
```

A new i18n key rather than the shared `cmdk_open`, because Enter and the button now do different things and "Open" no longer disambiguates. English only — `i18n/en.json` is the source locale.

The palette closes itself on navigation via `close-palette-on-navigate`, so the button needs no explicit `close()`.

### 5. Regression guard

**Destination table.** A table-driven spec enumerating every `activate()` kind and every recent kind against its expected destination, so a result type cannot silently start navigating off-surface again.

**`Route.search` allowlist.** A spec asserting the set of files calling `Route.search` is a **subset** of a listed set (info panel, Explore, Places, "View similar photos", the `/search` page itself). A new call site fails; PRs #778 and #884 removing theirs does not.

## Testing

Test-driven throughout: for each slice below, write the test, watch it fail for the stated reason, then implement. Existing suites in `global-search-manager.svelte.spec.ts` cover the tag and field paths and must stay green across the extraction in §1 — that is the refactor's own safety net, so §1 lands with no new tests and no behaviour change.

Unit tests are vitest + `@testing-library/svelte`. Two traps apply from this repo's history: `clearMocks` is not configured, so mock history leaks within a file and each test must reset what it asserts on; and `$t()` returns raw keys under test, so assert on `cmdk_open_person_page`, not "Open person page".

### Person routing

| #   | Scenario                                        | Expected                                                                                                       |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | personal person, on `/photos`                   | `/photos?people=person:p1`                                                                                     |
| 2   | personal person, on `/photos?tags=t1&rating=4`  | `tags` and `rating` preserved; `people` AND-ed in                                                              |
| 2b  | personal person, on `/photos?q=sunset&sort=asc` | stale `q` and `sort` dropped, as the tag path does                                                             |
| 3   | person already in the active `people` filter    | still navigates; the id appears once, not twice                                                                |
| 4   | space-person of A, on `/spaces/A`               | `/spaces/A?people=<bare profileId>`                                                                            |
| 5   | space-person of A, on `/spaces/A/photos`        | base is `/spaces/A/photos`, bare id                                                                            |
| 6   | space-person of **B**, on `/spaces/A`           | `/photos?people=space-person:<profileId>`                                                                      |
| 7   | personal person, on `/spaces/A`                 | `/photos?people=person:p1`                                                                                     |
| 8   | space-person, on `/photos`                      | `/photos?people=space-person:<profileId>`                                                                      |
| 9   | any person, on `/spaces/A/albums/x`             | `/photos?…` — not a searchable page                                                                            |
| 10  | any person, on `/albums/x`                      | `/photos?…`                                                                                                    |
| 11  | any person, on `/map`                           | `/photos?…` — matches the tag precedent                                                                        |
| 12  | any person, on `/recently-added`                | stays on `/recently-added`, prefixed id                                                                        |
| 13  | person with server-supplied `filterId`          | `filterId` used verbatim                                                                                       |
| 14  | person with no `primaryProfile`                 | `<person.id>` (bare — unlike the typed-search resolver's `getPersonFilterId`, which prefixes an unprefixed id) |
| 15  | person name present                             | `personNames` seeded under the filter id actually used                                                         |
| 16  | person name empty                               | nothing written to `personNames`                                                                               |
| 17  | `?at=<assetId>` on the current URL              | dropped from the destination                                                                                   |
| 18  | any person                                      | palette closes after navigation                                                                                |
| 19  | non-space person                                | recent written, as today                                                                                       |
| 20  | space person                                    | **no** recent written, as today                                                                                |
| 21  | person recent replayed                          | same destination as case 1                                                                                     |
| 22  | recent missing `personId`                       | bails silently, no `goto`                                                                                      |

### Place routing

| #   | Scenario                                     | Expected                                    |
| --- | -------------------------------------------- | ------------------------------------------- |
| 23  | place, on `/photos`                          | `/photos?city=Paris`                        |
| 24  | place, on `/spaces/A`                        | `/spaces/A?city=Paris`                      |
| 25  | place, on `/albums/x`                        | `/photos?city=Paris`                        |
| 25b | place, on `/recently-added`                  | `/recently-added?city=Paris`                |
| 26  | place, on `/map`                             | `/map#12/<lat>/<lng>` — unchanged           |
| 27  | place, on `/photos?city=Berlin`              | city replaced, not accumulated              |
| 28  | place, on `/photos?q=beach&people=person:p1` | `people` preserved, stale `q` dropped       |
| 28b | place with no name                           | falls back to map centring                  |
| 29  | place                                        | recent written and palette closed, as today |
| 30  | place recent replayed, non-empty label       | `?city=<label>`                             |
| 31  | place recent replayed, empty label           | falls back to map centring                  |

### Preview pane

| #   | Scenario        | Expected                                |
| --- | --------------- | --------------------------------------- |
| 32  | personal person | button href/target is `/people/<id>`    |
| 33  | space person    | target is `/people/<primaryProfile.id>` |
| 34  | button clicked  | `goto` called once with that target     |

### Guards

| #   | Scenario                  | Expected                      |
| --- | ------------------------- | ----------------------------- |
| 35  | every `activate()` kind   | matches the destination table |
| 36  | every recent kind         | matches the destination table |
| 37  | `Route.search` call sites | subset of the allowlist       |

### Suite-level gates

`pnpm test` in `web/` (baseline on this branch: 4092 passed, 300 files), plus `check:typescript`, `check:svelte`, `pnpm lint`, and `prettier --check`. `svelte-check` can scan zero files locally in a fresh worktree, so it is treated as a push-only gate.

No server change, so no OpenAPI regeneration and no SQL sync.

### Manual verification

On `/photos` with a tag filter already applied: ⌘K, type a person's name, Enter — the timeline stays on `/photos`, gains a person chip alongside the tag chip, and renders the justified selectable grid. Repeat from `/spaces/<id>` with a space member: the space timeline filters in place. Repeat with a place: a city chip. From `/map`, a place still recentres the map.

## Out of scope

- **"View similar photos"** (`asset.service.ts:310`) — the one in-app `/search` link no open PR covers. Not a palette result. The allowlist guard lists it so it cannot multiply.
- **Photo results** continue to open `/photos/<id>` rather than `/spaces/<sid>/photos/<id>`. The palette's photo provider searches globally, so a hit need not be in the space you are viewing.
- **Deleting or redirecting `/search`** — it is deliberately retained as a landing page for old bookmarks, with e2e tests pinning the banner behaviour.
- **No route to the person page below the 1024px preview-pane breakpoint** — the "Open person page" button lives in the palette's preview pane (`showPreview = $derived(mediaQueryManager.minLg)` in `global-search.svelte`), which only renders at `lg` and above. Below that width the palette has no button to reach person management. Accepted: below 1024px the palette is a quick-jump-to-filtered-timeline tool, and the person page stays reachable via `/people`.
