# Search-palette contextual routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Person and Place results in the search palette filter the timeline you are already looking at, instead of navigating away to `/people/<id>` and `/map`.

**Architecture:** `global-search-manager.svelte.ts` already routes tags and field searches to the current searchable page through two near-identical private methods. Task 1 extracts those into one `navigateToFilteredResults` funnel; Tasks 2–4 add person and place on top of it. Task 5 restores one-click access to the person management page from the preview pane. Task 6 adds two regression guards.

**Tech Stack:** SvelteKit + Svelte 5 runes, TypeScript strict, vitest + `@testing-library/svelte` + happy-dom.

Spec: `docs/superpowers/specs/2026-08-03-search-palette-contextual-routing-design.md`

## Global Constraints

- **Web only.** No server, DTO, OpenAPI or SQL change. Do not run `make open-api` or `make sql`.
- **Run a single test file with `npx vitest run <path>` from `web/`.** `pnpm test -- --run <path>` silently drops the path filter and runs all 300 files — it is not a valid verification of one file.
- **`clearMocks` is not configured in this repo.** Mock call history leaks between tests within a file. Every new `describe` block resets what it asserts on in `beforeEach`, following the existing `describe('tag activation navigation')` block.
- **`$t()` returns raw translation keys** in specs that do not call `init()`/`waitLocale()`. Assert on `'cmdk_open_person_page'`, never on `'Open person page'`.
- **New i18n keys go in `i18n/en.json` only** — `i18n/` is shared by web and mobile, and en is the source locale; other locales come from Weblate.
- **ESLint runs with `--max-warnings 0`,** and `prettier --check` is a separate CI gate from eslint. Both must pass.
- **`svelte/prefer-svelte-reactivity`** flags plain `Map`/`URL` construction. The existing code disables it inline with a comment explaining the value is ephemeral; copy that pattern where the code below shows it — **but eslint also reports _unused_ disable directives as warnings, and `--max-warnings 0` turns those into failures.** The rule only fires inside the exported class, not on module-level functions. If eslint says a directive is unused, delete it; do not keep a directive the plan shows just because the plan shows it. (Verified in Task 1: the disable the plan originally placed on `withoutEmptyLabels` was unused and had to go.)
- **Baseline on this branch: 4092 passing web tests across 300 files.** Every task ends green against the full suite or the touched files, as stated per task.
- **Commit trailers:** do not add `Co-Authored-By` or `Generated with` trailers.
- **Every URL string asserted in this plan was computed by running the real `buildSearchablePageUrl`, `getSearchablePageBasePath`, `getPhotosPersonFilterId`, `Route.map` and `getGlobalPersonHref`** — they are not guesses. Notably: `URLSearchParams` encodes `:` as `%3A` and `,` as `%2C`; `Route.map` emits a Leaflet hash (`/map#12/48.8566/2.3522`), not a query string; and `getSearchablePageBasePath` returns `null` for `/albums/x`, `/map` **and** `/spaces/<id>/albums/<id>`. If an assertion fails during implementation, re-derive it rather than assuming the plan is right.

---

## File Structure

| File                                                                    | Responsibility                                                                                                           | Task   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------ |
| `web/src/lib/utils/photos-filter-options.ts`                            | export the `PhotosPersonFilterReference` type so the manager can accept both a full DTO and a reconstructed recent entry | 2      |
| `web/src/lib/managers/global-search-manager.svelte.ts`                  | the routing funnel + person/place destinations                                                                           | 1–4    |
| `web/src/lib/managers/global-search-manager.svelte.spec.ts`             | person/place routing behaviour, destination table guard                                                                  | 2–4, 6 |
| `web/src/lib/components/global-search/previews/person-preview.svelte`   | "Open person page" escape hatch                                                                                          | 5      |
| `web/src/lib/components/global-search/__tests__/person-preview.spec.ts` | preview button behaviour                                                                                                 | 5      |
| `i18n/en.json`                                                          | `cmdk_open_person_page`                                                                                                  | 5      |
| `web/src/lib/route.spec.ts`                                             | `Route.search` call-site allowlist guard                                                                                 | 6      |

---

### Task 1: Extract the `navigateToFilteredResults` funnel

Pure refactor — no behaviour change, no new tests. The existing `describe('tag activation navigation')` and field-search blocks in `global-search-manager.svelte.spec.ts` are the safety net: they must stay green without modification.

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts` (`navigateToFieldResults` ~1624-1655, `navigateToTagResults` ~1665-1686)
- Test: `web/src/lib/managers/global-search-manager.svelte.spec.ts` (existing tests only)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `private navigateToFilteredResults(options: { applyFilter: (filters: FilterState) => FilterState; target?: URL; names?: { personNames?: Map<string, string>; tagNames?: Map<string, string> } }): void`
  - module-level `function withoutEmptyLabels(names?: Map<string, string>): Map<string, string>`

- [ ] **Step 1: Run the existing routing tests to record the green baseline**

Run from `web/`:

```bash
npx vitest run src/lib/managers/global-search-manager.svelte.spec.ts
```

Expected: PASS. Note the test count — it must be identical at the end of this task.

- [ ] **Step 2: Add the `withoutEmptyLabels` module helper**

Add just above `function getPersonRoute(...)` (~line 157) in `global-search-manager.svelte.ts`:

```ts
/**
 * Drop `id -> ''` pairs before they reach the typed-search name cache. `active-filters-bar` falls
 * back to rendering the raw id only for a *missing* entry, so caching an empty string renders a
 * blank chip instead.
 */
function withoutEmptyLabels(names?: Map<string, string>): Map<string, string> {
  // Ephemeral map, serialized into sessionStorage by storeTypedSearchNames; nothing reads it
  // reactively, so a plain Map is correct here.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  return new Map([...(names ?? [])].filter(([, label]) => label.trim() !== ''));
}
```

- [ ] **Step 3: Add the funnel method**

Insert immediately before `private navigateToFieldResults(...)`:

```ts
  /**
   * Single funnel for "palette result -> filter the surface you're on".
   *
   * Every row that maps onto a filter-panel filter (tag, person, place) and every field-search
   * mode routes through here so they cannot drift apart. The rule: AND the new filter into
   * whatever the current searchable page is already filtered by and stay put; if the current page
   * is not searchable, fall back to /photos.
   *
   * `target` overrides the base page for the case where the current surface *cannot express* the
   * filter (a space-scoped person id means nothing on /photos and vice versa). Passing it also
   * drops the current surface's filters: leaving the surface leaves its filter state behind,
   * because those ids are scoped to the surface we are leaving.
   *
   * `buildSearchDestination` deliberately does NOT use this — it owns the smart-search `/map?q=`
   * special case, which would silently drop a filter if inherited here.
   *
   * `names` seeds the typed-search name cache so a freshly added chip reads "Alice" rather than a
   * raw uuid. Passing it at all — even with empty maps — writes an entry; omitting it writes
   * nothing, which is what the field modes want, as their chips carry their own text.
   */
  private navigateToFilteredResults(options: {
    applyFilter: (filters: FilterState) => FilterState;
    target?: URL;
    names?: { personNames?: Map<string, string>; tagNames?: Map<string, string> };
  }): void {
    const current = options.target
      ? createFilterState()
      : (this.searchablePageFiltersProvider?.() ?? createFilterState());
    const filters = options.applyFilter({ ...current });
    // Ephemeral URL object for destination construction only; no reactive state is retained.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const fallback = new URL('/photos', page.url);
    const base = options.target ?? (getSearchablePageBasePath(page.url.pathname) ? page.url : fallback);
    const destination = buildSearchablePageUrl(base, '', this.searchSortOrder, filters) ?? '/photos';
    if (options.names) {
      storeTypedSearchNames(destination, {
        personNames: withoutEmptyLabels(options.names.personNames),
        tagNames: withoutEmptyLabels(options.names.tagNames),
      });
    }
    void goto(destination);
  }
```

- [ ] **Step 4: Rewrite `navigateToFieldResults` to use the funnel**

Replace the whole method body. Keep the docstring above it unchanged.

The early `if (mode === 'smart') return;` preserves the old no-navigation behaviour. **This repo's TypeScript _does_ carry that narrowing into the closure** (`mode` is a parameter that is never reassigned), so inside `applyFilter` the type is already `'metadata' | 'description' | 'ocr'` and the three-case switch is exhaustive. Do **not** add a `case 'smart'` — it is a hard `TS2678: Type '"smart"' is not comparable to type '"description" | "metadata" | "ocr"'`. (Verified in Task 1 by adding the branch back and running `tsc --noEmit`.)

```ts
  private navigateToFieldResults(text: string, mode: SearchMode): void {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    if (mode === 'smart') {
      // Unreachable: navigateToFieldResults is only called for field modes.
      return;
    }
    this.navigateToFilteredResults({
      applyFilter: (filters: FilterState): FilterState => {
        switch (mode) {
          case 'metadata': {
            return { ...filters, originalFileName: trimmed };
          }
          case 'description': {
            return { ...filters, description: trimmed };
          }
          case 'ocr': {
            return { ...filters, ocr: trimmed };
          }
          case 'smart': {
            // Unreachable — guarded above. Present so the switch is exhaustive over SearchMode.
            return filters;
          }
        }
      },
    });
  }
```

- [ ] **Step 5: Rewrite `navigateToTagResults` to use the funnel**

Replace the whole method body, keeping its docstring:

```ts
  private navigateToTagResults(tagId: string, tagName: string): void {
    this.navigateToFilteredResults({
      applyFilter: (filters) => ({
        ...filters,
        tagIds: filters.tagIds.includes(tagId) ? filters.tagIds : [...filters.tagIds, tagId],
      }),
      // Ephemeral map, serialized into sessionStorage by storeTypedSearchNames; an empty tag name
      // is stripped by withoutEmptyLabels so the chip falls back to the id, not a blank label.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      names: { tagNames: new Map([[tagId, tagName]]) },
    });
  }
```

- [ ] **Step 6: Run the manager suite — same tests, still green**

Run from `web/`:

```bash
npx vitest run src/lib/managers/global-search-manager.svelte.spec.ts
```

Expected: PASS, with the same test count as Step 1. In particular these four must pass untouched, proving the refactor preserved behaviour:

- `'caches the tag name for the destination so the filter chip is not a raw id'`
- `'caches no name for a nameless tag so the chip falls back to the id, not a blank label'`
- `'stays on a space timeline so the tag filters the space'`
- `'does not duplicate a tag that is already filtering the page'`

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/managers/global-search-manager.svelte.ts
git commit -m "refactor(web): funnel palette filter navigation through one helper"
```

---

### Task 2: Person results filter the current surface

**Files:**

- Modify: `web/src/lib/utils/photos-filter-options.ts:7` (export the type)
- Modify: `web/src/lib/managers/global-search-manager.svelte.ts` (delete `getPersonRoute`, add `getCurrentSpaceTimelineId` + `navigateToPersonResults`, rewire `activate('person')`)
- Test: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Interfaces:**

- Consumes: `navigateToFilteredResults` from Task 1.
- Produces:
  - `export type PhotosPersonFilterReference` from `$lib/utils/photos-filter-options`
  - module-level `function getCurrentSpaceTimelineId(pathname: string): string | undefined`
  - `private navigateToPersonResults(person: PhotosPersonFilterReference & { name?: string }): void`

- [ ] **Step 1a: Rewrite the three existing tests that pin the old destination**

Do this **before** implementing. Three tests in the `describe('activate(...)')` block near line 1083 assert the old `/people/:id` navigation — they pin the bug. Rewriting them first means Step 2 shows every expectation of the new behaviour going red at once. Do not delete them: they also assert the recent-entry side effects, which this task does not change.

Replace the test at ~line 1083:

```ts
it('activate("person", item) filters the timeline and records recent entry', () => {
  const m = new GlobalSearchManager();
  m.open();
  m.activate('person', { id: 'p1', name: 'Alice' });
  // No primaryProfile and no filterId, so getPhotosPersonFilterId falls through to the raw id.
  expect(goto).toHaveBeenCalledWith('/photos?people=p1');
  const entries = getEntries();
  expect(entries[0]).toMatchObject({ kind: 'person', personId: 'p1', label: 'Alice' });
});
```

Replace the test at ~line 1092:

```ts
it('activate("person", item) filters by the scoped filterId for an identity-backed space person', () => {
  const m = new GlobalSearchManager();
  m.open();
  m.activate('person', {
    id: 'space-person-1',
    name: 'Alice',
    primaryProfile: { type: 'space-person', id: 'space-person-1', spaceId: 'space-1' },
    filterId: 'space-person:space-person-1',
  });

  // On /photos (not that space's timeline), so the prefixed id is the correct encoding.
  expect(goto).toHaveBeenCalledWith('/photos?people=space-person%3Aspace-person-1');
  expect(getEntries()).toHaveLength(0);
});
```

Replace the test at ~line 1105:

```ts
it('activate("person", item) reconstructs the prefixed id for a legacy space person', () => {
  const m = new GlobalSearchManager();
  m.open();
  m.activate('person', {
    id: 'space-person-1',
    name: 'Alice',
    primaryProfile: { type: 'space-person', id: 'space-person-1', spaceId: 'space-1' },
  });
  expect(goto).toHaveBeenCalledWith('/photos?people=space-person%3Aspace-person-1');
  expect(getEntries()).toHaveLength(0);
});
```

- [ ] **Step 1b: Write the new failing tests**

Append this `describe` block to `web/src/lib/managers/global-search-manager.svelte.spec.ts`, immediately after the closing `});` of `describe('tag activation navigation')`:

```ts
describe('person activation navigation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    resetRecentStore();
    mockPage.url = new URL('https://gallery.test/photos');
  });

  const lastGoto = () => vi.mocked(goto).mock.calls.at(-1)?.[0] as string | undefined;

  const userPerson = (overrides: Partial<PersonResponseDto> = {}) =>
    ({
      id: 'p1',
      name: 'Alice',
      primaryProfile: { id: 'p1', type: 'user-person' },
      ...overrides,
    }) as PersonResponseDto;

  const spacePerson = (spaceId: string, overrides: Partial<PersonResponseDto> = {}) =>
    ({
      id: 'sp1',
      name: 'Bob',
      primaryProfile: { id: 'profile-1', type: 'space-person', spaceId },
      ...overrides,
    }) as PersonResponseDto;

  it('filters the timeline instead of opening the person management page', () => {
    const m = new GlobalSearchManager();

    m.activate('person', userPerson());

    expect(lastGoto()).toBe('/photos?people=person%3Ap1');
  });

  it('preserves the filters already on the page (AND)', () => {
    const m = new GlobalSearchManager();
    m.registerSearchablePageFilters(() => ({ ...createFilterState(), tagIds: ['t1'], rating: 4 }));

    m.activate('person', userPerson());

    const dest = lastGoto();
    expect(dest).toContain('tags=t1');
    expect(dest).toContain('rating=4');
    expect(dest).toContain('people=person%3Ap1');
  });

  it('drops a stale smart query so the person filter is the only constraint', () => {
    const m = new GlobalSearchManager();
    // Matches the existing tag behaviour — buildSearchablePageUrl is called with an empty query,
    // which deletes both `q` and a non-explicit `sort`.
    mockPage.url = new URL('https://gallery.test/photos?q=sunset&sort=asc');

    m.activate('person', userPerson());

    expect(lastGoto()).toBe('/photos?people=person%3Ap1');
  });

  it('does not duplicate a person already filtering the page', () => {
    const m = new GlobalSearchManager();
    m.registerSearchablePageFilters(() => ({ ...createFilterState(), personIds: ['person:p1'] }));

    m.activate('person', userPerson());

    expect(lastGoto()).toBe('/photos?people=person%3Ap1');
  });

  it('appends to people already filtering the page', () => {
    const m = new GlobalSearchManager();
    m.registerSearchablePageFilters(() => ({ ...createFilterState(), personIds: ['person:p0'] }));

    m.activate('person', userPerson());

    expect(lastGoto()).toBe('/photos?people=person%3Ap0%2Cperson%3Ap1');
  });

  it('stays on a space timeline and uses the bare profile id for that space person', () => {
    const m = new GlobalSearchManager();
    mockPage.url = new URL('https://gallery.test/spaces/space-1');

    m.activate('person', spacePerson('space-1'));

    expect(lastGoto()).toBe('/spaces/space-1?people=profile-1');
  });

  it('stays on the /photos sub-route of a space timeline', () => {
    const m = new GlobalSearchManager();
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

    m.activate('person', spacePerson('space-1'));

    expect(lastGoto()).toBe('/spaces/space-1/photos?people=profile-1');
  });

  it('leaves the space for /photos when the person belongs to a different space', () => {
    const m = new GlobalSearchManager();
    mockPage.url = new URL('https://gallery.test/spaces/space-1');

    m.activate('person', spacePerson('space-2'));

    expect(lastGoto()).toBe('/photos?people=space-person%3Aprofile-1');
  });

  it('leaves the space for /photos for a personal person', () => {
    const m = new GlobalSearchManager();
    mockPage.url = new URL('https://gallery.test/spaces/space-1');

    m.activate('person', userPerson());

    expect(lastGoto()).toBe('/photos?people=person%3Ap1');
  });

  it('drops the space surface filters when it leaves the space', () => {
    const m = new GlobalSearchManager();
    mockPage.url = new URL('https://gallery.test/spaces/space-1');
    // Space-scoped person ids are bare profile ids and mean nothing on /photos, so carrying the
    // space's filter state across would produce a garbage query.
    m.registerSearchablePageFilters(() => ({ ...createFilterState(), personIds: ['space-profile-9'] }));

    m.activate('person', userPerson());

    expect(lastGoto()).toBe('/photos?people=person%3Ap1');
  });

  it('uses the prefixed id for a space person while on /photos', () => {
    const m = new GlobalSearchManager();

    m.activate('person', spacePerson('space-2'));

    expect(lastGoto()).toBe('/photos?people=space-person%3Aprofile-1');
  });

  it('targets /photos from a space page that is not a timeline', () => {
    const m = new GlobalSearchManager();
    mockPage.url = new URL('https://gallery.test/spaces/space-1/albums/album-1');

    m.activate('person', spacePerson('space-1'));

    expect(lastGoto()).toBe('/photos?people=space-person%3Aprofile-1');
  });

  it('targets /photos from a non-searchable page', () => {
    const m = new GlobalSearchManager();
    mockPage.url = new URL('https://gallery.test/albums/album-1');

    m.activate('person', userPerson());

    expect(lastGoto()).toBe('/photos?people=person%3Ap1');
  });

  it('targets /photos from the map, matching the tag precedent', () => {
    const m = new GlobalSearchManager();
    mockPage.url = new URL('https://gallery.test/map');

    m.activate('person', userPerson());

    expect(lastGoto()).toBe('/photos?people=person%3Ap1');
  });

  it('stays on /recently-added', () => {
    const m = new GlobalSearchManager();
    mockPage.url = new URL('https://gallery.test/recently-added');

    m.activate('person', userPerson());

    expect(lastGoto()).toBe('/recently-added?people=person%3Ap1');
  });

  it('prefers the server-supplied filterId', () => {
    const m = new GlobalSearchManager();

    m.activate('person', userPerson({ filterId: 'person:identity-7' }));

    expect(lastGoto()).toBe('/photos?people=person%3Aidentity-7');
  });

  it('falls back to person:<id> when there is no primaryProfile', () => {
    const m = new GlobalSearchManager();

    m.activate('person', { id: 'p9', name: 'Zoe' } as PersonResponseDto);

    expect(lastGoto()).toBe('/photos?people=p9');
  });

  it('drops a stale ?at= scroll target from the destination', () => {
    const m = new GlobalSearchManager();
    mockPage.url = new URL('https://gallery.test/photos?at=asset-1');

    m.activate('person', userPerson());

    expect(lastGoto()).toBe('/photos?people=person%3Ap1');
  });

  it('caches the person name so the filter chip is not a raw id', () => {
    const m = new GlobalSearchManager();

    m.activate('person', userPerson());

    expect(storeTypedSearchNames).toHaveBeenCalledWith('/photos?people=person%3Ap1', {
      personNames: new Map([['person:p1', 'Alice']]),
      tagNames: new Map(),
    });
  });

  it('caches the bare profile id as the key for an in-space person', () => {
    const m = new GlobalSearchManager();
    mockPage.url = new URL('https://gallery.test/spaces/space-1');

    m.activate('person', spacePerson('space-1'));

    expect(storeTypedSearchNames).toHaveBeenCalledWith('/spaces/space-1?people=profile-1', {
      personNames: new Map([['profile-1', 'Bob']]),
      tagNames: new Map(),
    });
  });

  it('caches no name for a nameless person so the chip falls back to the id', () => {
    const m = new GlobalSearchManager();

    m.activate('person', userPerson({ name: '' }));

    expect(storeTypedSearchNames).toHaveBeenCalledWith('/photos?people=person%3Ap1', {
      personNames: new Map(),
      tagNames: new Map(),
    });
  });

  it('closes the palette after navigating', () => {
    const m = new GlobalSearchManager();
    m.open();

    m.activate('person', userPerson());

    expect(m.isOpen).toBe(false);
  });

  it('records a recent entry for a personal person', () => {
    const m = new GlobalSearchManager();

    m.activate('person', userPerson());

    expect(getEntries().some((e) => e.kind === 'person' && e.id === 'person:p1')).toBe(true);
  });

  it('records no recent entry for a space person', () => {
    const m = new GlobalSearchManager();

    m.activate('person', spacePerson('space-1'));

    expect(getEntries().some((e) => e.kind === 'person')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the whole file from `web/` — both the rewritten tests and the new block must be red:

```bash
npx vitest run src/lib/managers/global-search-manager.svelte.spec.ts
```

Expected: FAIL with **24 red tests** — the 3 rewritten ones plus 21 of the 24 new ones. Each reports a `/people/...` destination where a `/photos?people=...` (or `/spaces/...?people=...`) one was expected, because `activate('person')` still calls `goto(getPersonRoute(p))`.

Three of the new tests pass already, and that is correct: `'closes the palette after navigating'`, `'records a recent entry for a personal person'` and `'records no recent entry for a space person'` assert side effects this task does not change. They are there to pin that the rewire does not regress them.

If anything outside those 24 is red, Task 1's refactor broke something — fix that before continuing.

- [ ] **Step 3: Export the filter-reference type**

In `web/src/lib/utils/photos-filter-options.ts`, change line 7 from `type PhotosPersonFilterReference = {` to:

```ts
export type PhotosPersonFilterReference = {
```

- [ ] **Step 4: Add the space-timeline helper to the manager**

In `global-search-manager.svelte.ts`, add this module-level function next to `getPersonRoute` (~line 157). `getPersonRoute` and its `getGlobalPersonHref` import stay for now — they are deleted in Step 7, once their only caller is gone, so the file keeps type-checking between steps.

```ts
/**
 * The space id of the current page when that page is a space *timeline* (`/spaces/<id>` or
 * `/spaces/<id>/photos`). Deliberately not a `pathname.startsWith('/spaces/')` test:
 * `/spaces/<id>/albums/<albumId>` is a space page but not a searchable one, so no filter can be
 * applied in place there.
 */
function getCurrentSpaceTimelineId(pathname: string): string | undefined {
  const base = getSearchablePageBasePath(pathname);
  if (!base?.startsWith('/spaces/')) {
    return undefined;
  }
  return base.split('/').filter(Boolean)[1];
}
```

- [ ] **Step 5: Add the filter-id import**

Add to the imports in `global-search-manager.svelte.ts`:

```ts
import { getPhotosPersonFilterId, type PhotosPersonFilterReference } from '$lib/utils/photos-filter-options';
```

Exact placement does not matter — `prettier-plugin-organize-imports` sorts and dedupes the block on `prettier --write` (Task 7).

- [ ] **Step 6: Add `navigateToPersonResults`**

Insert immediately after `navigateToTagResults`:

```ts
  /**
   * Navigate to the current surface filtered by `person`.
   *
   * The filter-id encoding is scope-dependent, and getting it wrong yields a silently empty
   * timeline: a space timeline forwards `personIds` to the API as `spacePersonIds` — bare profile
   * ids scoped to that space (space-filter-options.ts) — while /photos and /recently-added forward
   * them prefixed, `person:` / `space-person:` (photos-filter-options.ts). So a space person can
   * only filter in place on its OWN space; every other combination targets /photos with the
   * prefixed id. This mirrors `getPersonFilterId(person, scope)` in the typed-search resolver,
   * which already splits on exactly this distinction.
   */
  private navigateToPersonResults(person: PhotosPersonFilterReference & { name?: string }): void {
    const spaceId = getCurrentSpaceTimelineId(page.url.pathname);
    const profile = person.primaryProfile;
    const spaceProfileId =
      spaceId !== undefined && profile?.type === 'space-person' && profile.spaceId === spaceId ? profile.id : undefined;
    const filterId = spaceProfileId ?? getPhotosPersonFilterId(person);
    // Ephemeral URL object for destination construction only; no reactive state is retained.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const target = spaceId !== undefined && spaceProfileId === undefined ? new URL('/photos', page.url) : undefined;
    this.navigateToFilteredResults({
      target,
      applyFilter: (filters) => ({
        ...filters,
        personIds: filters.personIds.includes(filterId) ? filters.personIds : [...filters.personIds, filterId],
      }),
      // Ephemeral map, serialized into sessionStorage by storeTypedSearchNames; an empty name is
      // stripped by withoutEmptyLabels so the chip falls back to the id, not a blank label.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      names: { personNames: new Map([[filterId, person.name ?? '']]) },
    });
  }
```

- [ ] **Step 7: Rewire `activate('person')`**

In `activate()`, replace `void goto(getPersonRoute(p));` with `this.navigateToPersonResults(p);`. The `addEntry` block above it is unchanged. The case now reads:

```ts
      case 'person': {
        const p = item as PersonResponseDto;
        if (p.primaryProfile?.type !== 'space-person') {
          const personId = p.primaryProfile?.id ?? p.id;
          addEntry({
            kind: 'person',
            id: `person:${personId}`,
            personId,
            label: p.name ?? '',
            lastUsed: now,
          });
        }
        this.navigateToPersonResults(p);
        break;
      }
```

`getPersonRoute` now has no callers. Delete the function (~line 157) and its import:

```ts
import { getGlobalPersonHref } from '$lib/utils/global-person-route';
```

Both must go, or eslint `--max-warnings 0` fails on the unused symbols. `getGlobalPersonHref` itself stays in `$lib/utils/global-person-route` — `/people`, `/explore` and Task 5's preview button all use it.

- [ ] **Step 8: Run the tests to verify they pass**

Run from `web/`:

```bash
npx vitest run src/lib/managers/global-search-manager.svelte.spec.ts
```

Expected: PASS — the new block plus every pre-existing test in the file, with nothing left red. This task changes `activate()` only, so the recents test `'person entry navigates and closes'` (~line 2648) still asserts `/people/p1` and still passes; Task 3 updates it.

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts web/src/lib/utils/photos-filter-options.ts
git commit -m "fix(web): filter the current timeline from a palette person result (#922)"
```

---

### Task 3: Person recents replay to the same destination

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts` (`activateRecent`, `case 'person'` ~line 1969)
- Test: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Interfaces:**

- Consumes: `navigateToPersonResults` from Task 2.
- Produces: nothing new.

- [ ] **Step 1a: Rewrite the existing recents test that pins the old destination**

Do this **before** implementing, so Step 2 shows the whole expectation going red at once. The test `'person entry navigates and closes'` (~line 2648, in the recents `describe`) asserts `/people/p1`. Rewrite it — it also asserts the palette closes, which is unchanged:

```ts
it('person entry filters the timeline and closes', () => {
  const m = new GlobalSearchManager();
  m.open();
  m.activateRecent({ kind: 'person', id: 'person:p1', personId: 'p1', label: 'Alice', lastUsed: 1 });
  expect(goto).toHaveBeenCalledWith('/photos?people=person%3Ap1');
  expect(m.isOpen).toBe(false);
});
```

- [ ] **Step 1b: Write the new failing tests**

Append to the `describe('person activation navigation')` block from Task 2, before its closing `});`:

```ts
it('routes a recent person entry to the filtered timeline too', () => {
  const m = new GlobalSearchManager();

  m.activateRecent({ kind: 'person', id: 'person:p1', personId: 'p1', label: 'Alice', lastUsed: 1 });

  expect(lastGoto()).toBe('/photos?people=person%3Ap1');
  expect(storeTypedSearchNames).toHaveBeenCalledWith('/photos?people=person%3Ap1', {
    personNames: new Map([['person:p1', 'Alice']]),
    tagNames: new Map(),
  });
});

it('routes a recent person entry onto the space timeline it is replayed from', () => {
  const m = new GlobalSearchManager();
  mockPage.url = new URL('https://gallery.test/spaces/space-1');

  // Recents only ever hold personal people, so replaying one inside a space leaves the space.
  m.activateRecent({ kind: 'person', id: 'person:p1', personId: 'p1', label: 'Alice', lastUsed: 1 });

  expect(lastGoto()).toBe('/photos?people=person%3Ap1');
});

it('ignores a corrupt person recent without navigating', () => {
  const m = new GlobalSearchManager();
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  m.activateRecent({ kind: 'person', id: 'person:broken', label: 'Alice', lastUsed: 1 } as never);

  expect(goto).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the whole file from `web/`:

```bash
npx vitest run src/lib/managers/global-search-manager.svelte.spec.ts
```

Expected: FAIL with **3 red tests** — the rewritten `'person entry filters the timeline and closes'` plus the two new routing tests. Each reports `/people/p1`, because `activateRecent` still calls `goto(Route.viewPerson(...))`.

`'ignores a corrupt person recent without navigating'` passes already — `isValidRecentEntry` bails before the switch, and this task does not change that. It is there to pin that the rewire does not bypass the guard.

- [ ] **Step 3: Rewire the recent case**

In `activateRecent`, replace:

```ts
      case 'person': {
        void goto(Route.viewPerson({ id: entry.personId }));
        break;
      }
```

with:

```ts
      case 'person': {
        // Recents only ever hold non-space people — activate('person') skips the addEntry for a
        // space person — and the server builds filterId as `person:<profileId>`
        // (face-identity.repository.ts), so this reconstruction is exact and a replayed recent
        // lands exactly where a fresh pick lands.
        this.navigateToPersonResults({
          id: entry.personId,
          filterId: `person:${entry.personId}`,
          name: entry.label,
        });
        break;
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `web/`:

```bash
npx vitest run src/lib/managers/global-search-manager.svelte.spec.ts
```

Expected: PASS, whole file, nothing left red.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "fix(web): replay a recent person into the filtered timeline (#922)"
```

---

### Task 4: Place results filter the current surface, except on the map

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts` (`activate('place')` ~line 1817, `activateRecent` `case 'place'` ~line 1973)
- Test: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Interfaces:**

- Consumes: `navigateToFilteredResults` from Task 1.
- Produces: `private navigateToPlaceResults(place: { name?: string; latitude: number; longitude: number }): void`

- [ ] **Step 1a: Rewrite the two existing tests that pin the old destination**

Do this **before** implementing. Replace the test at ~line 1118 (`describe('activate(...)')`):

```ts
it('activate("place", item) filters the timeline by city and records recent entry', () => {
  const m = new GlobalSearchManager();
  m.open();
  m.activate('place', { name: 'Paris', latitude: 48.8566, longitude: 2.3522 });
  expect(goto).toHaveBeenCalledWith('/photos?city=Paris');
  const entries = getEntries();
  expect(entries[0]).toMatchObject({ kind: 'place', id: 'place:48.8566:2.3522', label: 'Paris' });
});
```

Replace the test at ~line 2656 (the recents `describe`):

```ts
it('place entry filters the timeline by city and closes', () => {
  const m = new GlobalSearchManager();
  m.open();
  m.activateRecent({
    kind: 'place',
    id: 'place:48.8566:2.3522',
    latitude: 48.8566,
    longitude: 2.3522,
    label: 'Paris',
    lastUsed: 1,
  });
  expect(goto).toHaveBeenCalledWith('/photos?city=Paris');
  expect(m.isOpen).toBe(false);
});
```

- [ ] **Step 1b: Write the new failing tests**

Append this `describe` block after the `describe('person activation navigation')` block:

```ts
describe('place activation navigation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    resetRecentStore();
    mockPage.url = new URL('https://gallery.test/photos');
  });

  const lastGoto = () => vi.mocked(goto).mock.calls.at(-1)?.[0] as string | undefined;
  const paris = { name: 'Paris', latitude: 48.8566, longitude: 2.3522 };
  // Route.map builds a Leaflet-style hash, not a query string: `/map#<zoom>/<lat>/<lng>`.
  const PARIS_MAP = '/map#12/48.8566/2.3522';

  it('filters the timeline by city instead of jumping to the map', () => {
    const m = new GlobalSearchManager();

    m.activate('place', paris);

    expect(lastGoto()).toBe('/photos?city=Paris');
  });

  it('stays on a space timeline', () => {
    const m = new GlobalSearchManager();
    mockPage.url = new URL('https://gallery.test/spaces/space-1');

    m.activate('place', paris);

    expect(lastGoto()).toBe('/spaces/space-1?city=Paris');
  });

  it('targets /photos from a non-searchable page', () => {
    const m = new GlobalSearchManager();
    mockPage.url = new URL('https://gallery.test/albums/album-1');

    m.activate('place', paris);

    expect(lastGoto()).toBe('/photos?city=Paris');
  });

  it('stays on /recently-added', () => {
    const m = new GlobalSearchManager();
    mockPage.url = new URL('https://gallery.test/recently-added');

    m.activate('place', paris);

    expect(lastGoto()).toBe('/recently-added?city=Paris');
  });

  it('recentres the map when the user is already on the map', () => {
    const m = new GlobalSearchManager();
    mockPage.url = new URL('https://gallery.test/map');

    m.activate('place', paris);

    expect(lastGoto()).toBe(PARIS_MAP);
  });

  it('replaces a city already filtering the page rather than accumulating', () => {
    const m = new GlobalSearchManager();
    m.registerSearchablePageFilters(() => ({ ...createFilterState(), city: 'Berlin' }));

    m.activate('place', paris);

    expect(lastGoto()).toBe('/photos?city=Paris');
  });

  it('preserves the other filters already on the page and drops a stale smart query', () => {
    const m = new GlobalSearchManager();
    mockPage.url = new URL('https://gallery.test/photos?q=beach');
    m.registerSearchablePageFilters(() => ({ ...createFilterState(), personIds: ['person:p1'] }));

    m.activate('place', paris);

    const dest = lastGoto();
    expect(dest).toContain('people=person%3Ap1');
    expect(dest).toContain('city=Paris');
    expect(dest).not.toContain('q=beach');
  });

  it('recentres the map for a nameless place, which cannot produce a city filter', () => {
    const m = new GlobalSearchManager();

    m.activate('place', { latitude: 48.8566, longitude: 2.3522 });

    expect(lastGoto()).toBe(PARIS_MAP);
  });

  it('records a recent entry and closes the palette', () => {
    const m = new GlobalSearchManager();
    m.open();

    m.activate('place', paris);

    expect(getEntries().some((e) => e.kind === 'place')).toBe(true);
    expect(m.isOpen).toBe(false);
  });

  it('routes a recent place entry to the filtered timeline too', () => {
    const m = new GlobalSearchManager();

    m.activateRecent({
      kind: 'place',
      id: 'place:48.8566:2.3522',
      latitude: 48.8566,
      longitude: 2.3522,
      label: 'Paris',
      lastUsed: 1,
    });

    expect(lastGoto()).toBe('/photos?city=Paris');
  });

  it('falls back to recentring the map for a recent place with no label', () => {
    const m = new GlobalSearchManager();

    m.activateRecent({
      kind: 'place',
      id: 'place:48.8566:2.3522',
      latitude: 48.8566,
      longitude: 2.3522,
      label: '',
      lastUsed: 1,
    });

    expect(lastGoto()).toBe(PARIS_MAP);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the whole file from `web/`:

```bash
npx vitest run src/lib/managers/global-search-manager.svelte.spec.ts
```

Expected: FAIL with **9 red tests** — the 2 rewritten ones plus 7 of the 11 new ones. Each reports `/map#12/48.8566/2.3522` where a `?city=Paris` destination was expected.

Four of the new tests pass already, correctly: `'recentres the map when the user is already on the map'` and `'recentres the map for a nameless place…'` describe behaviour that is unchanged, and `'records a recent entry and closes the palette'` plus `'falls back to recentring the map for a recent place with no label'` assert side effects and the map fallback. They pin that the rewire does not regress them.

- [ ] **Step 3: Add `navigateToPlaceResults`**

Insert immediately after `navigateToPersonResults`:

```ts
  /**
   * Navigate to the current surface filtered by `place`.
   *
   * PlacesResponseDto carries name / lat / lng / admin1name / admin2name. Of those only `name`
   * maps onto a searchable-page param (`city`) — there is no `state` filter — and it is already
   * what place-preview searches by, so the preview and the destination agree.
   *
   * /map is the exception: it is a place's own contextual surface, and it is not a searchable
   * page, so the filter path would bounce the user off the map they were reading. A nameless
   * place cannot produce a city filter at all, so it recentres too.
   */
  private navigateToPlaceResults(place: { name?: string; latitude: number; longitude: number }): void {
    const city = place.name?.trim();
    if (!city || page.url.pathname.startsWith('/map')) {
      void goto(Route.map({ zoom: 12, lat: place.latitude, lng: place.longitude }));
      return;
    }
    this.navigateToFilteredResults({
      // `city` is single-valued, so a new place replaces whatever city was filtering the page.
      applyFilter: (filters) => ({ ...filters, city }),
    });
  }
```

- [ ] **Step 4: Rewire `activate('place')`**

Replace `void goto(Route.map({ zoom: 12, lat: p.latitude, lng: p.longitude }));` with `this.navigateToPlaceResults(p);`. The `addEntry` block above it is unchanged.

- [ ] **Step 5: Rewire the place recent**

In `activateRecent`, replace:

```ts
      case 'place': {
        void goto(Route.map({ zoom: 12, lat: entry.latitude, lng: entry.longitude }));
        break;
      }
```

with:

```ts
      case 'place': {
        this.navigateToPlaceResults({ name: entry.label, latitude: entry.latitude, longitude: entry.longitude });
        break;
      }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run from `web/`:

```bash
npx vitest run src/lib/managers/global-search-manager.svelte.spec.ts
```

Expected: PASS, whole file, nothing left red.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "fix(web): filter the current timeline from a palette place result (#922)"
```

---

### Task 5: "Open person page" button in the preview pane

**Files:**

- Modify: `i18n/en.json:977` (new key after `cmdk_open`)
- Modify: `web/src/lib/components/global-search/previews/person-preview.svelte`
- Test: `web/src/lib/components/global-search/__tests__/person-preview.spec.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: i18n key `cmdk_open_person_page`.

- [ ] **Step 1: Write the failing tests**

`person-preview.spec.ts` does not currently mock `$app/navigation`; this is the first test in the palette preview specs that needs it. Add the mock at module scope, directly under the existing `vi.mock('@immich/sdk', ...)` block:

```ts
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
```

and add `import { goto } from '$app/navigation';` to the imports.

Then append these tests inside `describe('person-preview')`:

```ts
it('offers a button to the person management page', () => {
  render(PersonPreview, { props: { person: { id: 'p1', name: 'Alice' } as never } });

  // This spec does not init svelte-i18n, so $t() returns the raw key.
  expect(screen.getByText('cmdk_open_person_page')).toBeInTheDocument();
});

it('navigates to the person page for a personal person', async () => {
  render(PersonPreview, {
    props: { person: { id: 'p1', name: 'Alice', primaryProfile: { id: 'p1', type: 'user-person' } } as never },
  });

  await fireEvent.click(screen.getByText('cmdk_open_person_page'));

  expect(goto).toHaveBeenCalledWith('/people/p1');
});

it('navigates to the profile id for a space person', async () => {
  render(PersonPreview, {
    props: {
      person: {
        id: 'sp1',
        name: 'Bob',
        primaryProfile: { id: 'profile-1', type: 'space-person', spaceId: 'space-1' },
      } as never,
    },
  });

  await fireEvent.click(screen.getByText('cmdk_open_person_page'));

  expect(goto).toHaveBeenCalledWith('/people/profile-1');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `web/`:

```bash
npx vitest run src/lib/components/global-search/__tests__/person-preview.spec.ts
```

Expected: FAIL with `Unable to find an element with the text: cmdk_open_person_page` — the button does not exist yet.

- [ ] **Step 3: Add the i18n key**

In `i18n/en.json`, insert after the `"cmdk_open"` line (keys in this file are alphabetical):

```json
  "cmdk_open_person_page": "Open person page",
```

Only `en.json` — the other locales are managed by Weblate.

- [ ] **Step 4: Add the button to the preview**

In `person-preview.svelte`, extend the script imports:

```ts
import { goto } from '$app/navigation';
import { Button } from '@immich/ui';
import { getGlobalPersonHref } from '$lib/utils/global-person-route';
```

and add this block as the last child of the root `<div data-cmdk-preview-person …>`, after the `{#if loaded && photos.length > 0}` block:

```svelte
  <div class="flex gap-2">
    <Button variant="ghost" size="small" onclick={() => goto(getGlobalPersonHref(person))}>
      {$t('cmdk_open_person_page')}
    </Button>
  </div>
```

Enter on the row now filters the timeline; this button is the path to rename / merge / hide / birthday. The palette dismisses itself on navigation via `close-palette-on-navigate`, so no explicit `close()` is needed.

- [ ] **Step 5: Run the tests to verify they pass**

Run from `web/`:

```bash
npx vitest run src/lib/components/global-search/__tests__/person-preview.spec.ts
```

Expected: PASS, including the three pre-existing tests in the file.

- [ ] **Step 6: Verify no other locale file was touched**

```bash
git status --porcelain i18n/
```

Expected: only `i18n/en.json` listed.

- [ ] **Step 7: Commit**

```bash
git add i18n/en.json web/src/lib/components/global-search/previews/person-preview.svelte web/src/lib/components/global-search/__tests__/person-preview.spec.ts
git commit -m "feat(web): open the person page from the palette preview pane"
```

---

### Task 6: Regression guards

Two guards: a destination table over every palette result kind, and an allowlist that stops new `Route.search` call sites from appearing.

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts` (destination table)
- Modify: `web/src/lib/route.spec.ts` (allowlist)

**Interfaces:**

- Consumes: everything from Tasks 2–4.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the destination-table guard**

Append after `describe('place activation navigation')`:

```ts
describe('palette destination table', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    resetRecentStore();
    mockPage.url = new URL('https://gallery.test/spaces/space-1');
  });

  const lastGoto = () => vi.mocked(goto).mock.calls.at(-1)?.[0] as string | undefined;

  // Pinned from /spaces/space-1 so any result kind that silently starts navigating off the
  // surface the user was reading shows up as a diff here. Album / space / photo / nav are
  // destinations rather than filters and are expected to leave.
  it.each([
    ['tag', { id: 't1', name: 'beach' }, '/spaces/space-1?tags=t1'],
    [
      'person',
      { id: 'p1', name: 'Alice', primaryProfile: { id: 'p1', type: 'user-person' } },
      '/photos?people=person%3Ap1',
    ],
    ['place', { name: 'Paris', latitude: 48.8566, longitude: 2.3522 }, '/spaces/space-1?city=Paris'],
    ['photo', { id: 'a1', originalFileName: 'IMG_1.jpg' }, '/photos/a1'],
  ])('activate(%s) lands on %s', (kind, item, expected) => {
    const m = new GlobalSearchManager();

    m.activate(kind as 'tag' | 'person' | 'place' | 'photo', item);

    expect(lastGoto()).toBe(expected);
  });

  it.each([
    [{ kind: 'tag', id: 'tag:t1', tagId: 't1', label: 'beach', lastUsed: 1 }, '/spaces/space-1?tags=t1'],
    [{ kind: 'person', id: 'person:p1', personId: 'p1', label: 'Alice', lastUsed: 1 }, '/photos?people=person%3Ap1'],
    [
      { kind: 'place', id: 'place:48.8566:2.3522', latitude: 48.8566, longitude: 2.3522, label: 'Paris', lastUsed: 1 },
      '/spaces/space-1?city=Paris',
    ],
    [{ kind: 'photo', id: 'photo:a1', assetId: 'a1', label: 'IMG_1.jpg', lastUsed: 1 }, '/photos/a1'],
  ])('activateRecent(%o) lands on %s', (entry, expected) => {
    const m = new GlobalSearchManager();

    m.activateRecent(entry as RecentEntry);

    expect(lastGoto()).toBe(expected);
  });

  it('never routes a palette result to the deprecated /search page', () => {
    const m = new GlobalSearchManager();

    m.activate('tag', { id: 't1', name: 'beach' });
    m.activate('person', { id: 'p1', name: 'Alice' });
    m.activate('place', { name: 'Paris', latitude: 48.8566, longitude: 2.3522 });
    m.activate('photo', { id: 'a1' });

    const destinations = vi.mocked(goto).mock.calls.map((c) => String(c[0]));
    expect(destinations).toHaveLength(4);
    expect(destinations.filter((d) => d.startsWith('/search'))).toEqual([]);
  });
});
```

Add `type RecentEntry` to the existing `$lib/stores/cmdk-recent` import at the top of the file:

```ts
import { addEntry, getEntries, __resetForTests as resetRecentStore, type RecentEntry } from '$lib/stores/cmdk-recent';
```

- [ ] **Step 2: Run it — expect PASS**

Run from `web/`:

```bash
npx vitest run src/lib/managers/global-search-manager.svelte.spec.ts -t "palette destination table"
```

Expected: PASS. This guard characterises behaviour Tasks 2–4 already implemented, so it is not expected to go red first. If any row fails, the earlier task is wrong — fix that, not the table.

A guard that cannot fail is worthless, so prove it bites: temporarily change the `person` row's expected value to `'/people/p1'`, re-run, and confirm it FAILS on that row only. Restore it and re-run to confirm PASS.

- [ ] **Step 3: Write the failing `Route.search` allowlist guard**

Append to `web/src/lib/route.spec.ts`. Model follows `navigation-items.spec.ts`, which already scans source files this way.

```ts
describe('Route.search call sites', () => {
  // web/src/lib/ -> up 1 -> web/src
  const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  // Every in-app link to the deprecated /search page. The page itself is kept as a landing page
  // for old bookmarks, but nothing new may point at it: a palette/search-bar result belongs on
  // the surface it has context of (#922). This is a SUBSET assertion, so PRs that remove a call
  // site (#778 for the info panel, #884 for the Explore/Places tiles) do not have to edit it.
  const ALLOWED = new Set([
    'lib/components/asset-viewer/DetailPanel.svelte',
    'lib/services/asset.service.ts',
    'routes/(user)/explore/+page.svelte',
    'routes/(user)/places/PlacesCardGroup.svelte',
    'routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  ]);

  function walk(dir: string, found: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full, found);
        continue;
      }
      if (!/\.(ts|svelte)$/.test(name) || /\.spec\.ts$/.test(name)) {
        continue;
      }
      if (readFileSync(full, 'utf8').includes('Route.search')) {
        found.push(relative(SRC_ROOT, full));
      }
    }
    return found;
  }

  it('are a subset of the allowlist', () => {
    const unexpected = walk(SRC_ROOT).filter((file) => !ALLOWED.has(file));

    expect(unexpected).toEqual([]);
  });
});
```

`route.spec.ts` currently imports only `$lib/constants` and `$lib/route` — vitest globals are enabled, so `describe`/`it`/`expect` need no import. Add these three at the top:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
```

- [ ] **Step 4: Run it — verify it passes, then verify it can fail**

Run from `web/`:

```bash
npx vitest run src/lib/route.spec.ts
```

Expected: PASS.

A guard that cannot fail is worthless, so prove it bites. Temporarily delete one entry from `ALLOWED` (e.g. `'lib/services/asset.service.ts'`), re-run, and confirm it FAILS listing that file. Restore the entry and re-run to confirm PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/managers/global-search-manager.svelte.spec.ts web/src/lib/route.spec.ts
git commit -m "test(web): guard palette destinations and Route.search call sites"
```

---

### Task 7: Full gates

**Files:** none modified unless a gate fails.

- [ ] **Step 1: Full web unit suite**

Run from `web/`:

```bash
pnpm test
```

Expected: PASS. Baseline was 4092 tests / 300 files; expect ~4130+ tests and 300 files (no new spec files were created — all new tests were appended to existing ones).

- [ ] **Step 2: Type check**

Run from `web/`:

```bash
pnpm check:typescript
```

Expected: PASS, no errors.

- [ ] **Step 3: Svelte check**

Run from `web/`:

```bash
pnpm check:svelte
```

Expected: PASS. Note this can scan zero files in a fresh worktree; if it reports 0 files it has told you nothing, and CI is the real gate.

- [ ] **Step 4: Lint**

Run from `web/`:

```bash
pnpm lint
```

Expected: PASS with zero warnings. Most likely failure: an unused `Route` or `getGlobalPersonHref` import left in the manager after Tasks 2–4.

- [ ] **Step 5: Prettier**

Run from the repo root — eslint passing does not imply prettier passing; they are separate CI gates, and the docs gate covers `docs/superpowers/`:

```bash
npx prettier --check web/src i18n/en.json docs/superpowers
```

Expected: `All matched files use Prettier code style!` If not, run the same command with `--write` and commit.

- [ ] **Step 6: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore(web): formatting"
```

Skip if there is nothing to commit.

---

## Manual verification

Run `make dev` and open `http://localhost:2283`.

1. On `/photos`, apply a tag filter. Press ⌘K, type a person's name, press Enter. **Expect:** URL becomes `/photos?tags=…&people=person:…`, the tag chip and a named person chip are both in the filter bar, and the grid is the justified, selectable layout.
2. Press ⌘K again, arrow to the same person, click **Open person page** in the preview pane. **Expect:** `/people/<id>`, the management view with rename/merge available.
3. Open a shared space timeline. ⌘K, pick a person who is a member of that space. **Expect:** you stay on `/spaces/<id>?people=<profileId>` and the space timeline filters in place.
4. From the same space, pick a _personal_ person. **Expect:** you land on `/photos?people=person:…` — the space's own filters are not carried over.
5. On `/photos`, ⌘K, pick a Place. **Expect:** `/photos?city=<name>` with a city chip.
6. Navigate to `/map`, ⌘K, pick a Place. **Expect:** the map recentres — it does not bounce you to `/photos`.
7. Reopen ⌘K with no query and replay the person and place recents. **Expect:** the same destinations as steps 1 and 5.
