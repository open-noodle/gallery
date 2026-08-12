# Asset Viewer Contextual Filters — Slice 6 (Web: chips for the new dimensions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four filter dimensions this branch added — `lensModel`, `state`, `albumId`, `ownerId` — **visible and removable** as active-filter chips, on every surface, and fix the rating chip's label (E15).

**Why it is not cosmetic:** `getActiveFilterCount` (`filter-panel.ts:95-117`) **already counts all four** (Slice 2 added them there). No chip renders for any of them. So on this branch today a filtered surface can show a filter-count badge of **1 with no chip to remove** — and `?state=Bavaria` alone renders _nothing at all_ while the badge reads 1. Slice 6 closes the gap Slice 2 opened; Slice 7 (which makes these filters clickable from the DetailPanel) is unusable without it.

**Spec:** `docs/superpowers/specs/2026-07-12-asset-viewer-contextual-filters-design.md` (§9 Slice 6, E15)

---

## Reality check — three things the spec's Slice 6 section gets wrong or leaves open

Verified against the working tree. Read before writing code.

### R1 — The two remove handlers are **byte-for-byte identical**. Do not add the new cases twice.

The spec warns: _"⚠️ There are TWO remove handlers… Both need the new cases, or the new chips will be unremovable inside a Space."_ That is true, but it under-sells it. `handlePhotosRemoveFilter` (`web/src/lib/utils/photos-filter-options.ts:127-177`) and `handleSpaceRemoveFilter` (`web/src/lib/utils/space-filter-options.ts:75-125`) are **the same switch statement, case for case** — I diffed the bodies; the only textual difference is the function name.

`/photos`, `/albums` and `/map` call the photos one; `/spaces` calls the space one. Duplicating four more cases into both is how the spec's own §13 risk row ("New chips unremovable in a Space (only the photos handler updated)") comes true in the first place.

**So Task 1 unifies them**: one shared `handleRemoveFilter(filters, type, id)`, with both existing exported names kept as thin delegates so **no call site changes**. That is a behavior-preserving refactor (identical bodies ⇒ identical behavior), it is provable by the two existing spec files continuing to pass unmodified, and it structurally eliminates the "forgot the other handler" bug class instead of merely warning about it.

### R2 — `state` is the odd one out: it must fold into the **location** chip, not get its own.

`getActiveFilterCount:101` already counts `city || country || state` as **one** location group, and the comment says so. But the location chip (`active-filters-bar.svelte:103-109`) builds its label from `city`/`country` only, and `handle*RemoveFilter`'s `location` case clears `city` + `country` only.

Consequences today: `?state=Bavaria` alone ⇒ count 1, **no chip**. `?city=Munich&state=Bavaria` ⇒ one chip reading "Munich", and removing it leaves `state` set — a filter still narrowing the grid with **nothing in the UI to show it**.

So `state` is not a new chip: it joins the location chip's label and the location case must clear all three. This mirrors how `camera` already clears `make` + `model` together.

### R0 — E15's label change breaks **four Playwright assertions**. They are part of this slice.

The rating label is pinned outside the unit suite too:

- `e2e/src/specs/web/spaces-filter-panel.e2e-spec.ts:897` → `toContainText('5+')`
- `:944`, `:1198` → `toContainText('3+')`
- `:1281` → `.filter({ hasText: '3+' })).toHaveCount(1)`

Changing the chip to "≥ N stars" without updating these turns the **Playwright web suite red**. Update all four in Task 2. (Nothing else in e2e is at risk: no e2e URL carries `lens=`/`state=`/`albumId=`/`owner=`, so the new chips cannot appear there.)

### R3 — `albumId` and `ownerId` are UUIDs, and there is **no suggestions source** to name them. (Spec gap — resolved by decision.)

The spec says: _"Add album/owner name resolution following the existing `personNames` / `tagNames` map pattern."_ That pattern has two feeders, and **neither works for albums/owners**:

1. `FilterSuggestionsResponseDto` (`fetch-client.ts:2296-2311`) carries `people` and `tags` — it has **no** `albums` or `owners` field. There is nothing to piggyback on.
2. `consumeTypedSearchNamesInto` (`typed-search-name-cache.ts:72`) is a **`sessionStorage`** cache keyed by destination URL, written at click time and consumed once. It is empty on a reload and on a link someone else sent you.

The unresolved fallback is `?? id` (`active-filters-bar.svelte:98, 120`) — i.e. **a raw UUID in the chip**.

That fallback is unacceptable _here specifically_, because this entire branch exists to make filter state **URL-backed, shareable and reloadable**. A pasted `/photos?albumId=<uuid>` showing a UUID chip is the feature failing in its headline use case.

**DECIDED (repo owner, 2026-07-13): lazy resolve on the page.** When a chip holds an id it cannot name, fetch the name **once** and fill the map. Costs one request, and only when such a filter is actually active.

**Resolve BY ID, never by listing.** The SDK has id-targeted calls — `getAlbumInfo({ id })` and `getUser({ id })`. Do **not** use `getAllAlbums()` / `searchUsers()`: listing fetches every album to name one, and `getAllAlbums()` only returns albums the viewer owns or is shared on — so a `?albumId=` link to an album reachable another way would fall back to a **UUID**, contradicting this slice's own Done-When. Resolving by id also makes "fetch at most once per id" trivially true.

| Surface     | `ownerId` → name                                                                                              | `albumId` → name       |
| ----------- | ------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `/spaces/…` | **already in scope** — `members` (`SharedSpaceMemberResponseDto{userId,name}`, `+page.svelte:132`). No fetch. | `getAlbumInfo({ id })` |
| `/photos`   | `getUser({ id })`                                                                                             | `getAlbumInfo({ id })` |
| `/map`      | `getUser({ id })`                                                                                             | `getAlbumInfo({ id })` |
| `/albums/…` | `album.albumUsers[].user` — already in scope. No fetch.                                                       | **N/A** — see below    |

**`/albums/{id}` renders no `albumId` chip, by construction.** The album page drops `?albumId=` at hydrate (E9, `+page.svelte:122-131`): the route already scopes the timeline and the server's `albumId` is a scalar driving one inner join, so album ∩ album is impossible. `albumId` is therefore never set in `albumFilters` and no chip can appear. (Its **picker** bar is a separate `pickerFilters` instance — also unaffected.)

---

## Global Constraints

- **Web lint has NO `--max-warnings 0`.** ~641 pre-existing `better-tailwindcss` warnings; it exits 0. Required: **0 errors**. **Never run `eslint --fix` across the package.**
- `svelte/prefer-svelte-reactivity` is a real lint **ERROR**: a bare `new URLSearchParams(...)` inside a `.svelte` file trips it. Keep URL/param surgery in `.ts` utils.
- `pnpm check:svelte` reports 0 files locally (known no-op). Use `pnpm check:typescript`.
- Run web commands from `web/`. Test command is **`pnpm test --run <path>`** (not `-- --run`); quote paths containing brackets.
- **i18n: new keys go in `i18n/en.json` ONLY** (repo root — shared by web AND mobile; other locales fall back to English).
- **Do not touch** `getSearchablePageBasePath` / `getSearchablePageState` / `buildSearchablePageUrl`, or `searchable-page-search.spec.ts`.
- Prettier 120 cols / single quotes / trailing commas. **No `Co-Authored-By` / `Generated-with` trailers.**

## File Structure

| File                                                            | Change | Responsibility                                                        |
| --------------------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| `web/src/lib/utils/filter-remove.ts`                            | Create | The ONE shared `handleRemoveFilter` (R1)                              |
| `web/src/lib/utils/photos-filter-options.ts`                    | Modify | `handlePhotosRemoveFilter` becomes a delegate                         |
| `web/src/lib/utils/space-filter-options.ts`                     | Modify | `handleSpaceRemoveFilter` becomes a delegate                          |
| `web/src/lib/utils/__tests__/filter-remove.spec.ts`             | Create | Cases for lens / state / album / owner + location-clears-three        |
| `web/src/lib/utils/__tests__/photos-filter-options.spec.ts`     | Keep   | **Unmodified** — proves the refactor is behavior-preserving           |
| `web/src/lib/utils/__tests__/space-filter-options.spec.ts`      | Keep   | **Unmodified** — same                                                 |
| `web/src/lib/components/filter-panel/active-filters-bar.svelte` | Modify | Chips for lens / album / owner; state folded into location; E15 label |
| `.../filter-panel/__tests__/active-filters-bar.spec.ts`         | Modify | Chip render + E15 (the existing `"3+"` test must be UPDATED)          |
| `web/src/lib/utils/filter-name-resolution.ts`                   | Create | Lazy album/owner name resolution, **by id** (R3)                      |
| `web/src/lib/utils/__tests__/filter-name-resolution.spec.ts`    | Create | Resolves once, caches, fails soft                                     |
| `e2e/src/specs/web/spaces-filter-panel.e2e-spec.ts`             | Modify | **R0** — 4 assertions pin the old `"3+"`/`"5+"` rating label          |
| the 4 page call sites + their specs                             | Modify | Pass `albumNames` / `ownerNames`; mock the new by-id SDK calls        |
| `i18n/en.json`                                                  | Modify | New chip keys                                                         |

---

### Task 1 — One remove handler, four new cases, location clears three

**TDD:**

> **⚠️ Added by the slice-1-to-5 audit (2026-07-13).** The chip ✕ handlers today leave **sibling fields set**, so removing a chip drops the count while the result set is unchanged — and the orphan field is re-encoded into the URL on the very next sync. This is a live "counted but not applied" lie, and slice 7 makes every one of these one-click reachable:
>
> - `'location'` clears `city` + `country` but **not `state`**
> - `'camera'` clears `make` + `model` but **not `lensModel`**
> - `'albums'` clears the has/none flags but **not `albumId`**
>
> There is also a filter with **no UI at all**: `model` without `make` is forwarded by all eight builders, counted by neither, and chipped by nothing (`/photos?model=iPhone%2017` silently filters the timeline while the bar isn't even rendered).

- [ ] **Step 1 (RED):** create `web/src/lib/utils/__tests__/filter-remove.spec.ts` covering, via the shared `handleRemoveFilter`:
  - `lens` clears `lensModel`; `album` clears `albumId`; `owner` clears `ownerId`.
  - `location` clears **`city` + `state` + `country`** (all three — R2).
  - `camera` clears **`make` + `model` + `lensModel`** (the sibling bug above).
  - `albums` clears **`isInAlbum` + `isNotInAlbum` + `albumId`** (same).
  - each case **preserves every other filter** (follow the existing "preserves other filters" convention, `photos-filter-options.spec.ts:334-340`).
  - an unknown type is a no-op (returns the input unchanged).
    Run it: **FAIL** — `$lib/utils/filter-remove` does not exist.

- [ ] **Step 2 (GREEN):** create `filter-remove.ts` with the shared `handleRemoveFilter(filters, type, id)`: the existing switch **verbatim** (keep every alias — `media`/`mediaType`, `favorites`/`isFavorite`, `albums`/`isNotInAlbum`/`isInAlbum` — dropping one would silently break existing chips), **plus** the `lens` / `album` / `owner` cases, and the sibling-clearing above (`location` → +`state`; `camera` → +`lensModel`; `albums` → +`albumId`).
      Point both `handlePhotosRemoveFilter` and `handleSpaceRemoveFilter` at it as one-line delegates. **Do not change their signatures or their call sites.**

- [ ] **Step 3 (prove the refactor):** run `photos-filter-options.spec.ts` and `space-filter-options.spec.ts` **UNMODIFIED**. Both must pass. That is the behavior-preservation proof — if either fails, the switch was not copied faithfully.

- [ ] **Step 4:** `pnpm check:typescript`; commit.

---

### Task 2 — The chips themselves (+ E15)

**TDD:**

- [ ] **Step 1 (RED):** extend `active-filters-bar.spec.ts`:
  - **`isFavorite === false` renders a chip too** (audit finding). It is counted (`filter-panel.ts:109`) but never chipped (`active-filters-bar.svelte:137` chips only `=== true`), so `/photos?favorite=false` renders "N results" with **zero chips and no Clear-all** — that button is gated on `chips.length > 0` — while the query is filtered. It additionally flips `photos-filter-options.ts:18`, silently dropping `withPartners` + `withSharedSpaces`.
  - a `lensModel` filter renders a chip showing the lens name, removable as type `lens`.
  - an `albumId` filter renders a chip showing the **resolved album name** (via an `albumNames` prop), removable as type `album`; with no map entry it falls back to the id.
  - an `ownerId` filter renders a chip showing the **resolved owner name** (`ownerNames` prop), removable as type `owner`.
  - `state` renders **inside the location chip** — `city + state + country` produce **ONE** chip whose label contains all three, and `state` alone still produces a location chip (today it produces none — R2).
  - **E15:** the rating chip reads **"≥ 4 stars"**, not `"4+"`. ⚠️ The existing test at **`web/src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts:85-100`** (_'should render chip for rating as "3+"'_) pins the OLD label — **update it**, do not leave it asserting the old string. (Note there are **two** `active-filters-bar` spec files; the rating label lives only in the `__tests__/` one. The other — `filter-panel/active-filters-bar.spec.ts` — covers the search chip / add-all and is untouched.)

- [ ] **Step 2 (GREEN):** in `active-filters-bar.svelte`:
  - add `albumNames?: Map<string,string>` / `ownerNames?: Map<string,string>` props beside the existing `personNames` / `tagNames` (`:37-38`), resolving with the same `?? id` fallback.
  - push the three new chips; fold `state` into the location chip's label; fix the rating label.
  - **Append** the new chips rather than reordering the existing ones. (No test asserts cross-group chip order — only two tags _within_ the tag group, `__tests__/active-filters-bar.spec.ts:407-409` — but appending keeps the diff honest and the existing assertions stable.)
  - New i18n keys in `i18n/en.json`. Reuse the existing nouns where they fit (`lens_model:1783`, `owner:2145`, `state:2774`, `album:626` already exist); add a templated rating key for "≥ {rating} stars".

- [ ] **Step 3 (R0 — the e2e assertions):** update the four Playwright assertions that pin the old rating label in `e2e/src/specs/web/spaces-filter-panel.e2e-spec.ts` (`:897` `'5+'`; `:944`, `:1198` `'3+'`; `:1281` `hasText: '3+'`). Typecheck + lint the `e2e` package. **The Playwright suite cannot run locally (no Docker) — it runs first in CI. Say so in the report; do not claim it passed.**

- [ ] **Step 4:** full `active-filters-bar.spec.ts` green; `pnpm check:typescript`; `pnpm lint` (0 errors); commit.

---

### Task 3 — Lazy name resolution, wired per surface (R3)

**TDD:**

**Signature (fix it here so the tests below are writable):**

```ts
// Fills `albumNames` / `ownerNames` in place for any id in `filters` that they do not already hold.
// Resolves BY ID (getAlbumInfo / getUser) — never by listing. Never throws.
export async function resolveFilterNames(
  filters: FilterState,
  names: { albumNames: Map<string, string>; ownerNames: Map<string, string> },
): Promise<void>;
```

- [ ] **Step 1 (RED):** create `filter-name-resolution.spec.ts`, mocking `@immich/sdk`:
  - resolves an album name via **`getAlbumInfo({ id })`** and fills `albumNames`;
  - resolves an owner name via **`getUser({ id })`** and fills `ownerNames`;
  - **fetches at most once per id**: calling it twice for the same `albumId` issues **one** `getAlbumInfo` call (assert the mock's call count — an in-flight//completed id must not refetch on a re-render);
  - **does not fetch at all** when the map already holds the id, **or** when `filters.albumId` / `filters.ownerId` are unset (assert `getAlbumInfo`/`getUser` `not.toHaveBeenCalled()`);
  - **fails soft — pin it on OBSERVABLE state, not on a toast that was never imported.** With `getAlbumInfo` rejecting: `resolveFilterNames` **resolves** (does not reject — an unhandled rejection would break the page), `albumNames` is left **unmodified** (so the chip keeps its `?? id` fallback), and the error-handling module is **explicitly mocked and asserted not-called** (mock `$lib/utils/handle-error`). Without naming that mock the "no toast" claim passes vacuously against any implementation that simply never imports it.

- [ ] **Step 2 (GREEN):** implement `filter-name-resolution.ts` and wire it at the call sites, using the cheapest source per surface (see the R3 table):
  - `/spaces/…` — resolve `ownerId` from the **already-in-scope `members`** array; **no fetch**.
  - `/albums/…` — resolve `ownerId` from the in-scope `album.albumUsers`. **No `albumId` chip exists here** (E9 drops it at hydrate) — do not add one.
  - `/photos`, `/map` — `getAlbumInfo({ id })` / `getUser({ id })`, lazily.
  - **Do NOT wire name maps into `TimelineRouteGroupingBar.svelte`** (the fifth `ActiveFiltersBar` consumer — archive, favorites, trash, tags, people, partners, locked, `MapTimelinePanel`). It builds its `temporalFilters` from `createFilterState()` plus date fields only (`:35-41`), so none of the four new chips can ever appear there.

- [ ] **Step 3 (existing page specs will start fetching — mock it):** `map-page.spec.ts:334` already renders `/map?…&lens=RF24-70mm`, and `:384`/`:398` render `?albumId=album-9`. Once chips exist, those renders trigger name resolution — i.e. **new SDK calls in specs that do not mock them**. Add `getAlbumInfo` / `getUser` mocks to `map-page.spec.ts`, `photos-page.spec.ts`, `spaces-page.spec.ts` and the album `page.route.spec.ts`, and make the resolver tolerate an **auto-mocked `undefined` return**, not just a rejection.

- [ ] **Step 4 (the wiring is where the §13 risk actually lives — test it):** Tasks 1–3 test the util, the component (props injected by hand) and the resolver in isolation. **Nothing yet proves a page passes the maps, or that a chip's ✕ works inside a Space** — which is exactly the spec's BDD (_"And likewise when I click it inside a Space"_, spec:645-649). Add:
  - `spaces-page.spec.ts`: URL `?lens=…` → chip renders → click its ✕ → the lens filter is gone **from the URL**;
  - `photos-page.spec.ts` (or `map-page.spec.ts`): `?albumId=<uuid>` → the chip shows the album **name**, not the UUID.

- [ ] **Step 5 (pin the new cases through the exported names):** after the Step 3 behavior-preservation proof of Task 1, add one assertion to each existing handler spec (e.g. `handleSpaceRemoveFilter(f, 'lens')`, `handlePhotosRemoveFilter(f, 'owner')`) so a future hand-rewritten delegate cannot silently regress the new cases.

- [ ] **Step 6:** run the four page specs + the full web suite. `pnpm check:typescript`; `pnpm lint`; commit.

---

## Done When

- [ ] All four new dimensions render a chip, and **every** chip is removable on `/photos`, `/albums`, `/map` **and** inside a Space.
- [ ] `getActiveFilterCount` and the rendered chip set **agree on every surface** — no badge without a chip (the gap Slice 2 opened is closed).
- [ ] The location chip shows and clears `city` + `state` + `country` together.
- [ ] The rating chip reads "≥ N stars" (E15).
- [ ] Album and owner chips show **names, not UUIDs**, including on a reloaded page and a shared link.
- [ ] `photos-filter-options.spec.ts` and `space-filter-options.spec.ts` pass **unmodified**.
- [ ] Full web suite green; `check:typescript` clean; `lint` 0 errors.
