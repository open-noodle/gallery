# Recently Added — Slice 3: Text / smart-search section — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the tenth (`text`) filter section and the browse↔query mode switch to Recently Added, completing all-10 parity with Photos — with `withSharedSpaces` forced `false` on every search path.

**Architecture:** The filter config gains a query-mode branch, selected by a search-context accessor the route supplies (keeping the config a pure, unit-testable module). The Slice-2 query-capability exclusion is removed, so `/recently-added` becomes genuinely searchable — and because that exclusion is enforced in two places, removing it in one predicate turns both on together. The route mirrors Photos' smart-facet plumbing (AbortController + key cache) with `withSharedSpaces` pinned false.

**Tech Stack:** SvelteKit + Svelte 5 runes, TypeScript (strict), Vitest + @testing-library/svelte, Playwright.

## Global Constraints

- **Scope:** Web only. No server / API / mobile / DTO changes.
- **Do not modify** the Photos page or the shared `filter-panel/` / `Timeline` / `UserPageLayout` / `SmartSearchResults` components.
- **`withSharedSpaces: false` on every search path** — Recently Added stays own + partner in query mode exactly as in browse mode. This is the slice's headline invariant.
- **`orderBy: AssetOrderBy.CreatedAt`** still governs browse mode; nothing here may change it.
- No i18n additions — reuse the search keys Photos already uses.
- The `AssetSelectControlBar` block and the `{#snippet empty()}` block stay unchanged.
- Code style: Prettier (120 char, single quotes, trailing commas, semicolons); no relative imports — use `$lib/`.
- ESLint: no new errors AND no new warnings.

## Baseline: what Slices 1–2 delivered

Committed: the header count; `shouldShowRecentlyAddedCount`; `buildRecentlyAddedTimelineOptions` / `buildRecentlyAddedSuggestionRequest`; `buildRecentlyAddedFilterConfig` (9 sections); `/recently-added` registered in `getSearchablePageBasePath` with query support deliberately withheld by `isQueryCapablePage`; the wired browse filter panel; a route-level spec (6 cases) and 10 passing Playwright scenarios.

## The `'relevance'` sort question — resolved here

Slice 2's review flagged this and deferred it to this slice. `getSortOrder(query, rawSort)` returns `'relevance'` whenever a non-empty `q` is present without an explicit `sort`. Until now that was unreachable on this route.

**Resolution — no special handling needed, and this is deliberate:**

- **In query mode**, results come from `<SmartSearchResults>`, which does its own relevance ordering. `'relevance'` is meaningful there, exactly as on Photos.
- **In browse mode**, `buildRecentlyAddedTimelineOptions` already maps `'relevance'` → `AssetOrder.Desc` (asserted by a Slice-2 unit test: _"maps sortOrder to order without touching orderBy"_), and `orderBy` stays `CreatedAt`. So a stale `relevance` degrades to "newest added first" — the view's natural default.

Task 1 adds a regression test pinning this, so the behaviour is asserted rather than incidental.

---

## Reference: commands

```bash
cd web && pnpm test -- --run src/lib/utils/__tests__/recently-added-filter-config.spec.ts
cd web && pnpm test -- --run "src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/recently-added-page.spec.ts"
```

(`"test": "vitest"` is watch-mode; `--run` is mandatory. The path argument may not isolate to one file — expected.)

E2E — **never use `PLAYWRIGHT_BASE_URL=http://127.0.0.1:2283`** (serves 0-byte page bodies; produces meaningless failures). Use the dedicated e2e stack on `:2285`, which **bakes the web app into its image** — rebuild after any web source change:

```bash
cd e2e && docker compose up --build -d
cd e2e && pnpm exec playwright test --project=web --retries=0 src/specs/web/recently-added-filters.e2e-spec.ts
```

Use `--retries=0` on deliberate red runs (the `web` project sets `retries: 4`).

Prettier is a separate CI gate. A `**/*.svelte` glob does not match inside the `[[…]]` route directory — use the concrete escaped path.

**CI is the only gate that type-checks `.svelte` templates** (`tsc --noEmit` skips them; local `check:svelte` reports 0 FILES). Watch the CI Lint/Test Web run.

---

## File Structure

| File                                                                                                | Status                   | Responsibility                                                                                       |
| --------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `web/src/lib/utils/recently-added-filter-config.ts`                                                 | **Modify** (Task 1)      | Append `'text'`; add the query-mode branch to `suggestionsProvider` and the two dependent providers. |
| `web/src/lib/utils/__tests__/recently-added-filter-config.spec.ts`                                  | **Modify** (Task 1)      | Bump to 10 sections; add search-branch cases.                                                        |
| `web/src/lib/utils/__tests__/recently-added-filter-options.spec.ts`                                 | **Modify** (Task 1)      | Add the `'relevance'`-in-browse-mode regression case.                                                |
| `web/src/lib/utils/searchable-page-search.ts`                                                       | **Modify** (Task 2)      | Remove the `/recently-added` exclusion — the route becomes query-capable.                            |
| `web/src/lib/utils/__tests__/searchable-page-search.spec.ts`                                        | **Modify** (Task 2)      | Flip the Slice-2 assertions to the query-capable end state.                                          |
| `web/src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/recently-added-page.spec.ts` | **Modify** (Tasks 1 & 3) | Task 1 updates the sections case to ten (or the repo lands red); Task 3 adds the query-mode cases.   |
| `e2e/src/specs/web/recently-added-filters.e2e-spec.ts`                                              | **Modify** (Task 4)      | Search acceptance scenarios (red).                                                                   |
| `web/src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/+page.svelte`                | **Modify** (Task 5)      | Query state, smart facets, mode switch (green).                                                      |

## Task order

1. Config + `'relevance'` regression (unit TDD).
2. Flip query capability (unit TDD).
3. Route-level spec for query mode (red).
4. E2E search scenarios (red).
5. Route wiring (turns 3 and 4 green).

Tasks 3 and 4 are only genuinely red before Task 5. Do not reorder.

---

## Task 1: Config gains the `text` section and a query-mode branch

**Files:**

- Modify: `web/src/lib/utils/recently-added-filter-config.ts`
- Test: `web/src/lib/utils/__tests__/recently-added-filter-config.spec.ts`, `web/src/lib/utils/__tests__/recently-added-filter-options.spec.ts`

**Interfaces:**

- Produces: `buildRecentlyAddedFilterConfig(getSearchContext?: () => RecentlyAddedSearchContext | undefined): FilterPanelConfig`, and `export type RecentlyAddedSearchContext = { query: string; language: string; filters: FilterState };`

**Design — why an accessor rather than a plain argument.** The panel's providers are called _later_, during user interaction, and must see the query **and the live filters** as they are at call time. Values captured when the config is built would go stale the moment the user edits either. Photos solves this by defining its config inline in the route, closing over reactive state; keeping ours in a module means the route passes a thunk instead. The parameter is optional and defaults to `() => undefined`, so a caller that never searches keeps exactly the Slice-2 browse behaviour (verified: the route's current bare call site stays correct).

**The context must carry `filters`, not just the query.** Photos builds its dependent-provider facet payloads from the _live_ `FilterState` (`photos/+page.svelte:318`, `:336`):

```ts
filters: { ...filters, country },
```

Do **not** reconstruct a `FilterState` from the panel-supplied `FilterContext`. They are different types: `FilterContext` has no `city` / `make` / `model` / `mediaType` / `description` / `originalFileName` / `ocr` / `sortOrder`, and it carries dates as `takenAfter`/`takenBefore` whereas `buildSmartSearchParams` derives dates by calling `buildFilterContext(filters)` on `dateAfter` / `dateBefore` / `selectedYear`. A `{ ...createFilterState(), ...filterContext }` spread **type-checks but silently drops most of the filter scope**, including all dates — so the city/camera dropdowns would be scoped differently from Photos with nothing to catch it.

**`withSharedSpaces: false` produces NO key.** `buildSmartSearchParams` only sets it when truthy (`space-search.ts:38-40`: `if (withSharedSpaces) { params.withSharedSpaces = true; }`). So assert its **absence** — `expect(dto).not.toHaveProperty('withSharedSpaces')`. An `expect.objectContaining({ withSharedSpaces: false })` can never pass, and chasing it would mean breaking the shared `space-search.ts`. Photos' own spec uses the absence form (`photos-page.spec.ts:528`).

**Facts you need:**

- `buildSmartSearchFacetsParams(args: SmartSearchParamsArgs): SmartSearchFacetsDto` and `mapSmartSearchFacetsToFilterSuggestions(facets, options?)` live in `$lib/utils/space-search`. `mapSmartSearchFacetsToFilterSuggestions` with **no** `spaceId` option resolves people via `getPhotosPersonFilterId` / `getPhotosPersonFilterThumbnailUrl` — which is what we want (no space scoping).
- `searchSmartFacets({ smartSearchFacetsDto }, opts?)` is the SDK call.
- `SmartSearchParamsArgs` takes `{ query, filters, withSharedSpaces, language }`.

- [ ] **Step 1: Write the failing tests**

In `recently-added-filter-config.spec.ts`, **change** the sections case to expect ten:

```ts
it('exposes all ten filter sections in plan order', () => {
  expect(buildRecentlyAddedFilterConfig().sections).toEqual([
    'timeline',
    'people',
    'location',
    'camera',
    'tags',
    'rating',
    'media',
    'favorites',
    'albums',
    'text',
  ]);
});
```

Add `searchSmartFacets` to the `@immich/sdk` mock:

```ts
    searchSmartFacets: vi.fn().mockResolvedValue({
      countries: ['Germany'],
      cities: ['Berlin'],
      cameraMakes: ['Sony'],
      cameraModels: ['A7'],
      tags: [{ id: 'tag-1', value: 'Vacation' }],
      people: [{ id: 'person-1', name: 'Alice' }],
      ratings: [5],
      mediaTypes: ['IMAGE'],
      hasUnnamedPeople: false,
      total: 7,
      timeBuckets: [],
    }),
```

Append the search-branch describe (keep every existing browse case — they are the regression guard that the browse path is untouched):

```ts
describe('buildRecentlyAddedFilterConfig in query mode', () => {
  const searchContext = () => ({ query: 'beach', language: 'en', filters: createFilterState() });

  it('routes suggestions through smart facets, never shared spaces', async () => {
    const config = buildRecentlyAddedFilterConfig(searchContext);

    await config.suggestionsProvider!(createFilterState());

    expect(getFilterSuggestions).not.toHaveBeenCalled();
    expect(searchSmartFacets).toHaveBeenCalledWith(
      expect.objectContaining({ smartSearchFacetsDto: expect.objectContaining({ query: 'beach' }) }),
    );
    // Absence, not `false` — buildSmartSearchParams only sets the key when truthy.
    expect(vi.mocked(searchSmartFacets).mock.calls[0][0].smartSearchFacetsDto).not.toHaveProperty('withSharedSpaces');
  });

  it('maps smart facets to filter suggestions', async () => {
    const result = await buildRecentlyAddedFilterConfig(searchContext).suggestionsProvider!(createFilterState());

    expect(result.tags).toEqual([{ id: 'tag-1', name: 'Vacation' }]);
    expect(result.people[0]).toEqual(expect.objectContaining({ id: 'person-1', name: 'Alice' }));
    expect(result.countries).toEqual(['Germany']);
  });

  it('routes the dependent providers through smart facets without shared spaces', async () => {
    const config = buildRecentlyAddedFilterConfig(searchContext);

    const cities = await config.providers!.cities!('Germany');
    const cameraModels = await config.providers!.cameraModels!('Sony');

    expect(getSearchSuggestions).not.toHaveBeenCalled();
    expect(cities).toEqual(['Berlin']);
    expect(cameraModels).toEqual(['A7']);
    for (const call of vi.mocked(searchSmartFacets).mock.calls) {
      expect(call[0].smartSearchFacetsDto).not.toHaveProperty('withSharedSpaces');
    }
  });

  it('scopes the dependent providers by the live filters, not just the dependent value', async () => {
    // Regression pin: reconstructing a FilterState from the panel's FilterContext type-checks but
    // silently drops city/make/model/mediaType/text filters AND all dates (buildSmartSearchParams
    // derives dates from dateAfter/dateBefore/selectedYear, not takenAfter/takenBefore).
    const config = buildRecentlyAddedFilterConfig(() => ({
      query: 'beach',
      language: 'en',
      filters: { ...createFilterState(), make: 'Sony', rating: 4, selectedYear: 2024 },
    }));

    await config.providers!.cities!('Germany');

    expect(vi.mocked(searchSmartFacets).mock.calls[0][0].smartSearchFacetsDto).toEqual(
      expect.objectContaining({
        country: 'Germany',
        make: 'Sony',
        rating: 4,
        takenAfter: '2024-01-01T00:00:00.000Z',
      }),
    );
  });

  it('reads the query and filters at call time, not at build time', async () => {
    // The panel calls providers during interaction; values captured at build time would go stale
    // the moment the user edits the query or another filter.
    let context = { query: 'beach', language: 'en', filters: createFilterState() };
    const config = buildRecentlyAddedFilterConfig(() => context);

    await config.suggestionsProvider!(createFilterState());
    context = { query: 'sunset', language: 'en', filters: { ...createFilterState(), rating: 5 } };
    await config.suggestionsProvider!(createFilterState());

    expect(vi.mocked(searchSmartFacets).mock.calls[1][0].smartSearchFacetsDto).toEqual(
      expect.objectContaining({ query: 'sunset' }),
    );
  });

  it('falls back to the browse path when the query is blank', async () => {
    const config = buildRecentlyAddedFilterConfig(() => ({
      query: '   ',
      language: 'en',
      filters: createFilterState(),
    }));

    await config.suggestionsProvider!(createFilterState());

    expect(searchSmartFacets).not.toHaveBeenCalled();
    expect(getFilterSuggestions).toHaveBeenCalled();
  });
});
```

Import `searchSmartFacets` from `@immich/sdk` at the top of the spec.

**You must also update the route-level spec in this task**, or this commit lands the repo red. `recently-added-page.spec.ts:256-266` currently pins the Slice-2 state:

```ts
  it("passes the nine sections to the filter panel, and no 'text' section", async () => {
    …
    expect(panel).toHaveAttribute('data-sections', 'timeline,people,location,camera,tags,rating,media,favorites,albums');
    expect(panel.dataset.sections).not.toContain('text');
  });
```

Rewrite it to the ten-section end state:

```ts
  it('passes all ten sections to the filter panel', async () => {
    …
    expect(panel).toHaveAttribute(
      'data-sections',
      'timeline,people,location,camera,tags,rating,media,favorites,albums,text',
    );
  });
```

and include `recently-added-page.spec.ts` in this task's commit. (Task 3 then genuinely starts from 6 passing / 4 failing.)

In `recently-added-filter-options.spec.ts`, append to the `buildRecentlyAddedTimelineOptions` describe:

```ts
it('degrades a relevance sort to newest-added-first in browse mode', () => {
  // A `?q=` in the URL resolves sortOrder to 'relevance'. Browse mode has no relevance ranking,
  // so it must fall back to the view's natural default rather than producing an invalid order.
  const options = buildRecentlyAddedTimelineOptions({ ...createFilterState(), sortOrder: 'relevance' });

  expect(options.order).toBe(AssetOrder.Desc);
  expect(options.orderBy).toBe(AssetOrderBy.CreatedAt);
});
```

- [ ] **Step 2: Run to verify RED**

Run both spec files. Expected: the sections case fails (9 vs 10), and the query-mode cases fail because `buildRecentlyAddedFilterConfig` takes no argument and never calls `searchSmartFacets`. The `'relevance'` case may already pass — Slice 2's implementation covers it; that is fine and expected, it is a pin, not a new behaviour. Paste the output and say which cases were red.

- [ ] **Step 3: Implement**

In `recently-added-filter-config.ts`:

```ts
import {
  getFilterSuggestions,
  getSearchSuggestions,
  searchSmartFacets,
  SearchSuggestionType,
  type SmartSearchFacetsResponseDto,
} from '@immich/sdk';
import type { FilterPanelConfig, FilterState } from '$lib/components/filter-panel/filter-panel';
import { getPhotosPersonFilterId, getPhotosPersonFilterThumbnailUrl } from '$lib/utils/photos-filter-options';
import { buildRecentlyAddedSuggestionRequest } from '$lib/utils/recently-added-filter-options';
import { buildSmartSearchFacetsParams, mapSmartSearchFacetsToFilterSuggestions } from '$lib/utils/space-search';
```

Append `'text'` to `sections` (last, tenth).

Add the search context type and the facet fetcher:

```ts
/**
 * The route's live search state, read at provider call time so it never goes stale.
 * `filters` must be the route's live FilterState — the dependent providers scope their facet
 * query by it, exactly as the Photos page does.
 */
export type RecentlyAddedSearchContext = { query: string; language: string; filters: FilterState };

function fetchFacets(context: RecentlyAddedSearchContext, filters: FilterState): Promise<SmartSearchFacetsResponseDto> {
  return searchSmartFacets({
    smartSearchFacetsDto: buildSmartSearchFacetsParams({
      query: context.query.trim(),
      filters,
      // Recently Added is own + partner in query mode exactly as in browse mode.
      withSharedSpaces: false,
      language: context.language,
    }),
  });
}
```

Change the exported builder to take the accessor and branch on it. Resolve the context **inside** each provider:

```ts
export function buildRecentlyAddedFilterConfig(
  getSearchContext: () => RecentlyAddedSearchContext | undefined = () => undefined,
): FilterPanelConfig {
  // Resolved per call, not per build: the panel invokes these during interaction.
  const activeSearch = (): RecentlyAddedSearchContext | undefined => {
    const context = getSearchContext();
    return context && context.query.trim() ? context : undefined;
  };

  return {
    sections: [...sections],
    suggestionsProvider: async (filters) => {
      const context = activeSearch();
      if (!context) {
        return mapSuggestions(await getFilterSuggestions(buildRecentlyAddedSuggestionRequest(filters)));
      }
      return mapSmartSearchFacetsToFilterSuggestions(await fetchFacets(context, filters));
    },
    providers: {
      cities: async (country, filterContext) => {
        const context = activeSearch();
        if (!context) {
          return getSearchSuggestions({ $type: SearchSuggestionType.City, country, ...filterContext });
        }
        // Scope by the LIVE filters (mirroring Photos' `filters: { ...filters, country }`), not by
        // the panel's FilterContext — see the design note above.
        return (await fetchFacets(context, { ...context.filters, country })).cities;
      },
      cameraModels: async (make, filterContext) => {
        const context = activeSearch();
        if (!context) {
          return getSearchSuggestions({ $type: SearchSuggestionType.CameraModel, make, ...filterContext });
        }
        return (await fetchFacets(context, { ...context.filters, make })).cameraModels;
      },
    },
  };
}
```

Also update the module's stale doc block (`recently-added-filter-config.ts:6-9`), which currently says "Nine of the ten filter sections… `'text'` is intentionally absent until Slice 3 adds the smart-search path alongside it, so the text input is never rendered without a working submit." That rationale is factually wrong: `filter-panel.svelte` renders `'text'` as `<TextFilter>` editing the **description / originalFileName / ocr metadata filters**, which already round-trip through the URL and through `buildRecentlyAddedTimelineOptions`. Replace it with an accurate description of the ten sections.

- [ ] **Step 4: Run to verify GREEN**

Run both spec files. Expected: all cases pass, **including every pre-existing browse case** — that is the proof the browse path is unchanged. Paste the output.

- [ ] **Step 5: Format and commit**

```bash
cd web && pnpm exec prettier --check src/lib/utils/recently-added-filter-config.ts src/lib/utils/__tests__/recently-added-filter-config.spec.ts src/lib/utils/__tests__/recently-added-filter-options.spec.ts "src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/recently-added-page.spec.ts"
cd .. && git add web/src/lib/utils/recently-added-filter-config.ts web/src/lib/utils/__tests__/recently-added-filter-config.spec.ts web/src/lib/utils/__tests__/recently-added-filter-options.spec.ts "web/src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/recently-added-page.spec.ts"
git commit -m "feat(web): text section and smart-facet suggestions for Recently Added (#805)"
```

Before committing, run the **full** unit suite (`cd web && pnpm test -- --run`) and confirm it is green — this task touches a spec the route already satisfies, so a red repo here means the section update above was missed.

---

## Task 2: Make `/recently-added` query-capable

**Files:**

- Modify: `web/src/lib/utils/searchable-page-search.ts`
- Test: `web/src/lib/utils/__tests__/searchable-page-search.spec.ts`

**Why now.** Slice 2 registered the base path but withheld query support via `isQueryCapablePage`, precisely so the text input never existed without a working submit. Task 1 has now added the search path, so the exclusion comes out. Because Slice 2 enforced the predicate in **two** places (`getSearchablePageState`'s `isSearchable`, and `buildSearchablePageUrl`'s refusal to write a `q=`), removing the single exclusion turns both on together — that was the design intent.

- [ ] **Step 1: Update the tests (they invert)**

In `searchable-page-search.spec.ts`, replace the two Slice-2 cases that pinned the withheld state:

```ts
it('is query-capable now that the text section and search path exist', () => {
  const state = getSearchablePageState(new URL('https://gallery.test/recently-added'));

  expect(state.basePath).toBe('/recently-added');
  expect(state.isSearchable).toBe(true);
});

it('builds a query URL for the recently added page', () => {
  expect(buildSearchablePageUrl(new URL('https://gallery.test/recently-added'), 'beach')).toContain('q=beach');
});
```

(These replace `'is not query-capable until the text slice lands'` and `'refuses to build a query URL for a page that cannot answer one'`. Leave every other case — including the filter-only URL case and the Photos/Spaces regression cases — untouched.)

- [ ] **Step 2: Run to verify RED**

```bash
cd web && pnpm test -- --run src/lib/utils/__tests__/searchable-page-search.spec.ts
```

Expected: the two updated cases fail (`isSearchable` is false; the query URL is null). Paste the output.

- [ ] **Step 3: Implement**

Delete the `isQueryCapablePage` function and its two call sites, restoring the original shapes:

- `getSearchablePageState` → `isSearchable: true`
- `buildSearchablePageUrl` → remove the `if (trimmedQuery && !isQueryCapablePage(basePath)) { return null; }` guard.

Delete the whole predicate rather than leaving it always-true — its doc comment explicitly says to remove it in the change that adds the search path.

- [ ] **Step 4: Run to verify GREEN**

Same command. Expected: all cases pass, including the untouched Photos/Spaces regression cases. Paste the output.

- [ ] **Step 5: Commit**

```bash
cd web && pnpm exec prettier --check src/lib/utils/searchable-page-search.ts src/lib/utils/__tests__/searchable-page-search.spec.ts
cd .. && git add web/src/lib/utils/searchable-page-search.ts web/src/lib/utils/__tests__/searchable-page-search.spec.ts
git commit -m "feat(web): enable query mode for Recently Added (#805)"
```

---

## Task 3: Route-level spec for query mode (red-first)

**Files:**

- Modify: `web/src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/recently-added-page.spec.ts`

Keep the six existing cases unchanged (Task 1 already updated the sections one) — they are the browse-mode regression guard. Append a `describe` for query mode with these **six** cases (Task 5 Step 2 checks for twelve passing total):

```
1. renders SmartSearchResults instead of the timeline when the URL carries ?q=
2. does not send shared-space scope to SmartSearchResults
3. stays in browse mode for a blank/whitespace-only query
4. the header count uses the search total in query mode, not timelineManager.assetCount
5. a failed facet fetch falls back to the previous facets (count survives)
6. re-rendering with an unchanged query+filters does not refetch facets (key cache)
```

Cases 5 and 6 transplant almost verbatim from `photos-page.spec.ts` — the rejection fallback at `:581-597` (`sdkMock.searchSmartFacets.mockRejectedValueOnce(...)` → `data-total` still `'12'`) and the call-count dedup at `:517-528` / `:572-577`. Copy them rather than inventing equivalents.

**Harness setup you must add** (case 4 and 5 need a resolved facets payload, or they fail as harness errors rather than assertion failures). The spec already imports `sdkMock` from `$lib/__mocks__/sdk.mock`; seed it, copying `photos-page.spec.ts:244-256`:

```ts
sdkMock.searchSmartFacets.mockResolvedValue({
  total: 12,
  timeBuckets: [{ timeBucket: '2024-01-01', count: 12 }],
  countries: ['Germany'],
  cities: ['Berlin'],
  cameraMakes: ['Sony'],
  cameraModels: ['A7'],
  tags: [{ id: 'tag-1', value: 'Travel' }],
  people: [{ id: 'person-1', name: 'Ada' }],
  ratings: [4],
  mediaTypes: [AssetTypeEnum.Image],
  hasUnnamedPeople: false,
});
```

Mock `$lib/components/search/smart-search-results.svelte` with the existing `@test-data/mocks/smart-search-results.stub.svelte` (the one `photos-page.spec.ts` uses). It exposes received props as `data-*` attributes — `data-total`, `data-with-shared-spaces`, `data-search-query`, `data-language`. Assert against those; do not invent a mechanism.

Note for case 2: the route passes `withSharedSpaces={false}`, so the stub's `data-with-shared-spaces` will read `"false"` — assert that exact value (this is the component prop, unlike the facets DTO where the key is simply absent).

Drive query mode by setting `mockPage.url` to `new URL('https://gallery.test/recently-added?q=beach')`.

- [ ] **Step 1: Write the cases**
- [ ] **Step 2: Run to verify RED** — expected: 6 passed, 6 failed. The six must fail as ASSERTION failures about missing query wiring (no SmartSearchResults rendered, count still from assetCount), **not** harness errors. If you get mock/setup errors, your harness is wrong — fix it and re-run. Paste the output and state the distinction explicitly.
- [ ] **Step 3: Commit** — `test(web): route-level spec for Recently Added query mode (#805)`

---

## Task 4: E2E search scenarios (red-first)

**Files:**

- Modify: `e2e/src/specs/web/recently-added-filters.e2e-spec.ts`

Keep the existing 10 scenarios unchanged. Append a sibling `test.describe('Recently Added text search', …)` with its own `beforeAll`, covering the spec's three BDD scenarios:

```gherkin
Scenario: A text query switches to search results with a total count
  Given the Recently Added view
  When I open it with a text query in the URL (?q=…)
  Then search results are shown instead of the added-date timeline
  And the header shows the search-result total as "N items"

Scenario: Clearing the query returns to the added-date timeline
  Given the Recently Added view showing text-search results
  When I clear the text query
  Then the added-date timeline is shown again with its item count

Scenario: Text search stays within own + partner scope
  Given a shared-space asset that the same query DOES find on /photos
  When I run that text search in Recently Added
  Then search results are shown (not the added-date timeline)
  And the shared-space asset is not among those results
```

**Drive the query via `?q=` deep-link or the navbar global search — NOT "the text filter".** The panel's `'text'` section is `<TextFilter>` editing the description / originalFileName / ocr **metadata** filters; it is not a smart-search box and cannot submit a query. The smart query reaches the route only through the URL or the global search bar. Scenario 1's wording above is corrected accordingly: _"When I open the view with a text query in the URL"_.

**Seeding notes.** Smart search is ML-backed and its ranking is not deterministic in e2e — do **not** assert on which assets match semantically. Assert on the **mode switch, the count source, and the scope**.

**Scenario 3 must assert the REQUEST, not the results — the e2e stack has no ML.** (Discovered during implementation: `e2e/docker-compose.yml` has no `machine-learning` service and `IMMICH_MACHINE_LEARNING_ENABLED=false`, so `searchSmart` errors and `smart-search-results.svelte` falls back to an empty list for _every_ query. `photos-search.e2e-spec.ts:88-91` documents the same limitation.) A result-based scope test is therefore untestable here: nothing is ever found, so absence proves nothing and no positive control can succeed.

Assert what the client **sends** instead. `smart-search-results.svelte:46-52` posts `buildSmartSearchParams({ …, withSharedSpaces, … })` to `POST /api/search/smart`, and `buildSmartSearchParams` sets `withSharedSpaces: true` only when truthy. So intercept the request with Playwright and assert:

- on `/recently-added?q=…` the payload **has no `withSharedSpaces`** (own + partner);
- **positive control:** on `/photos?q=…` the payload **does** carry `withSharedSpaces: true`.

This is deterministic, ML-independent, and tests the invariant directly. Capture with `page.waitForRequest` / `route.request().postDataJSON()`.

It is also genuinely red before Task 5: the unwired route never enters query mode, so no `/api/search/smart` request is issued at all from `/recently-added` and the wait times out.

The shared-space seeding below is no longer needed for scenario 3 — drop it. (Keep it only if you also want a result-level assertion, which cannot pass in this environment.)

<details>
<summary>Superseded: the result-based approach and its seeding requirements (kept for context)</summary>

Asserting only that a shared-space asset is _absent_ passes for a dozen unrelated reasons: never indexed, matched nothing semantically, the member never opted the space into their timeline, or the seeding silently failed. It would have needed:

1. A **second user** owns the asset and adds it to a space the test actor is a member of (this direction, not the reverse).
2. Set the **member-level** timeline opt-in explicitly (`updateMemberTimeline`, imported straight from `@immich/sdk` and called with the **member's own** token — see `space-map-markers.e2e-spec.ts:62-63`), so it is a controlled variable rather than an accidental confound. Note this is _not_ the album-level `showInTimeline` toggle; the two are not interchangeable (`spaces-albums-timeline.e2e-spec.ts:19-23`).
3. **Positive control:** run the identical query on `/photos` (which _is_ `withSharedSpaces: true`) in the same test and assert the asset **is** present there. Only then assert its absence on `/recently-added`.
4. **Assert the mode switch before asserting absence.** On `/recently-added`, first assert that search results are rendered rather than the timeline, _then_ assert the asset is absent **from those results**. Without this the scenario passes before Task 5 too — the unwired route renders an own+partner timeline from which the asset is trivially absent — and it would never demonstrate the invariant it names. With it, Task 4's red gate is genuinely **10 passed, 3 failed**.

Helpers (all in `e2e/src/utils.ts`): `utils.userSetup`, `utils.createSpace(accessToken, dto)` (`:367`), `utils.addSpaceMember(accessToken, spaceId, { userId, role })` (`:370`), `utils.addSpaceAssets(accessToken, spaceId, assetIds)` (`:373`). Closest precedent: `e2e/src/specs/web/space-map-markers.e2e-spec.ts:26-55` — note it calls the SDK directly for the per-member timeline opt-in, because that endpoint needs the **member's own** token, not admin's.

This third `describe` must call `utils.resetDatabase()` in its own `beforeAll` and build its own fixture — it cannot inherit from either existing block, both of which reset the database themselves.

</details>

**Do not try to make the semantic match deterministic — you do not need to, and the obvious workaround does not exist.** The mode switch is guaranteed by the URL carrying `?q=`, whatever it matches; the assertion is that one specific shared-space asset id is absent from the rendered results; and the `/photos` positive control is precisely what proves the query _can_ find it. If the query matches nothing even on `/photos`, the positive control fails loudly — which is the correct outcome, turning semantic non-determinism into a visible failure rather than a silent pass.

(For the record, swapping in an `originalFileName` / `description` / `ocr` filter as a "deterministic discriminator" is not an option: those three are metadata-only. `buildSmartSearchParams` never reads them — grep `space-search.ts`, zero occurrences — so they are silently dropped from the smart-search DTO. And dropping `?q=` would put the page back in browse mode, making the mandated mode-switch assertion unsatisfiable.)

- [ ] **Step 1: Write the scenarios**
- [ ] **Step 2: Run to verify RED** (with `--retries=0`) — expected: 10 passed, 3 failed, failing because the route ignores `?q=` and still renders the timeline. Confirm the failure reason is the missing query wiring, not seeding/auth/stack problems. Paste the output.
- [ ] **Step 3: Commit** — `test(e2e): acceptance scenarios for Recently Added text search (#805)`

---

## Task 5: Wire query mode into the route (turns Tasks 3 and 4 green)

**Files:**

- Modify: `web/src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/+page.svelte`

**Template:** the Photos page's search plumbing — `photos/[[assetId=id]]/+page.svelte` lines `:127-133` (`committedQuery`, `showSearchResults`), `:145-157` (facet state + derived buckets/total), `:216-266` (`loadPhotoSmartFacets` — the AbortController + key-cache loader), `:429-436` (`clearSearch`), the query parts of the URL→filters `$effect` (`:510-543`), and the render switch (`:598-607`).

**Adaptations:**

- `withSharedSpaces` is **`false` everywhere** — in `buildSmartSearchFacetsParams`, in the facet cache key, and on `<SmartSearchResults withSharedSpaces={false}>`. Photos computes `filters.isFavorite === undefined`; we do not. This is the slice's headline invariant.
- Pass the search context into the config — **including `filters`**, which the dependent providers scope their facet query by:
  ```ts
  const filterConfig = withNameCapture(
    buildRecentlyAddedFilterConfig(() => ({ query: committedQuery, language: $lang, filters })),
    personNames,
    tagNames,
  );
  ```
  A thunk, so it reads live state. Omitting `filters` re-opens the silently-dropped-scope defect that Task 1's "scopes the dependent providers by the live filters" case exists to prevent — and because this lives in a `.svelte` `<script>` block, **neither `tsc --noEmit` nor local `check:svelte` would catch it**; it would surface only in CI, or not at all.
- `syncFilterUrl` must now pass `committedQuery` instead of the literal `''`, and restore Photos' full sort conversion (`!committedQuery.trim() && …`) — the Slice-2 simplification assumed no query could exist. Copy Photos' version. **Also rewrite the now-false comment above it** (`+page.svelte:184-185`), which currently ends "…its extra free-text-query guard is query-mode-only and drops out here (this view has no query yet)" — this task is precisely what restores that guard.
- Count: `const count = $derived(showSearchResults ? (smartFacetTotal ?? 0) : (timelineManager?.assetCount ?? 0));` and `hasActiveFilters` becomes `getActiveFilterCount(filters) > 0 || showSearchResults`.
- `timeBuckets` on `<FilterPanel>` becomes `showSearchResults ? (smartFacets?.timeBuckets ?? []) : timelineBuckets`.
- Restore the `{#key}` wrapper around `<FilterPanel>` (Photos `:558`) so the panel remounts on query/lang change.
- Restore `showGrouping={!showSearchResults && !assetMultiSelectManager.selectionActive}` on `<FilterToolbar>`, and give `<ActiveFiltersBar>` `searchQuery={committedQuery}` + `onClearSearch={clearSearch}`. Still **no** `resultCount` / `onAddAllToCollection` — the header keeps the single count.
- Facet-fetch errors: catch → `console.error` → fall back to the last good facets (Photos `:252-257`).
- The `AssetSelectControlBar` and `{#snippet empty()}` blocks stay unchanged.

- [ ] **Step 1: Implement the wiring**
- [ ] **Step 2: Route spec GREEN** — `pnpm test -- --run "…/recently-added-page.spec.ts"` → **12 passed** (6 browse + 6 query). Fast loop; do this before Playwright. Paste output.
- [ ] **Step 3: `cd web && pnpm check:typescript && pnpm lint`** — clean.
- [ ] **Step 4: E2E GREEN** — rebuild the stack (`cd e2e && docker compose up --build -d`), then run the spec → **13 passed**. Paste output.
- [ ] **Step 5: Full gate**

```bash
cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm test -- --run
cd web && pnpm exec prettier --check "src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/+page.svelte"
cd ../e2e && pnpm exec prettier --check src/specs/web/recently-added-filters.e2e-spec.ts
```

- [ ] **Step 6: Commit** — `feat(web): text/smart-search filter for Recently Added (#805)`

---

## Slice 3 Done Gate

- [ ] `check:typescript`, `check:svelte`, `lint` (no errors, no new warnings), full unit suite — all clean
- [ ] Route spec — **12 passed**
- [ ] E2E — **13 passed**
- [ ] Prettier clean on all touched files
- [ ] Red→green evidence for Tasks 1, 2 (unit), 3→5 (route), 4→5 (e2e). The `'relevance'` case is a characterization pin, already green — do NOT count it as red→green evidence.
- [ ] Photos page, `filter-panel/`, `Timeline`, `UserPageLayout`, `SmartSearchResults` unmodified
- [ ] Photos/Spaces search behaviour unchanged — their `searchable-page-search.spec.ts` cases still pass untouched
- [ ] **`withSharedSpaces` is `false`, never `true`, on every search path:** `grep -rn "withSharedSpaces" web/src/lib/utils/recently-added-filter-*.ts "web/src/routes/(user)/recently-added/"` shows only `false` literals and the discarded `_` in the options builder. (The facet DTO simply omits the key — `buildSmartSearchParams` sets it only when truthy — so assert absence in tests, never `false`.)
- [ ] `isQueryCapablePage` is fully deleted, not left always-true
- [ ] Five commits as specified

## Coverage check against the spec

| Spec item (§Slice 3)                                                         | Covered by                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config = 10 sections incl. text                                              | Task 1 sections case                                                                                                                                                                                      |
| Query-mode provider calls `searchSmartFacets` with `withSharedSpaces: false` | Task 1 query-mode cases (suggestions + both dependent providers)                                                                                                                                          |
| Browse-mode provider unchanged                                               | Task 1 — every pre-existing browse case retained and passing                                                                                                                                              |
| Text query → search results + search-total count                             | Task 3 cases 1 & 4; Task 4 scenario 1 (driven via `?q=`)                                                                                                                                                  |
| Clear query → back to added-date timeline                                    | Task 4 scenario 2                                                                                                                                                                                         |
| Search stays own + partner                                                   | Task 1 unit (DTO lacks `withSharedSpaces`) + Task 3 case 2 + Task 4 scenario 3 **with its `/photos` positive control**                                                                                    |
| Empty query submitted → stays browse                                         | Task 1 blank-query fallback case; Task 3 case 3                                                                                                                                                           |
| Smart-facet fetch failure → console.error + fall back to prior facets        | Task 3 case 5 (route-level, copied from Photos `:581-597`)                                                                                                                                                |
| Query then filter change → refetch keyed by query+filters                    | Task 3 case 6 (key-cache dedup, copied from Photos `:517-528`); Task 1 read-at-call-time case. **Abort-in-flight is not separately asserted** — it is carried by the copied Photos loader; dedup ≠ abort. |
| `'relevance'` sort on an added-date timeline                                 | Task 1 regression case (browse degrades to newest-added-first); query mode ranks in `SmartSearchResults`                                                                                                  |
