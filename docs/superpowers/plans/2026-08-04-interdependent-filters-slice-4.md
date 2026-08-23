# Slice 4 — Every surface forwards the new facets, and stops faking empty ones (#910)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Every `suggestionsProvider` in the app returns `hasFavorites`, `hasAssetsInAlbum` and
`hasAssetsNotInAlbum`, and no provider ever resolves with a fabricated all-empty response.

**Architecture:** Four mappers and three page-level providers gain three passthrough fields. Separately,
the `emptyFilterSuggestions()` failure sentinel on the three query-mode pages is deleted in favour of a
rejection, so a failed facet fetch cannot be mistaken for an empty library once slice 5 starts gating on
emptiness.

**Tech Stack:** SvelteKit, TypeScript, Vitest.

- **Spec:** `docs/superpowers/specs/2026-08-04-interdependent-filter-sections-910-design.md` §4.6, §6.4
- **Branch:** `fix/910-interdependent-filter-sections`
- **Depends on:** Slice 2 (the SDK types) and Slice 3 (the widened `FilterSuggestionsResponse`). This slice
  is what makes `check:typescript` green again.
- **Scope:** four web util files, three route files, and their specs. No panel component — that is slice 5.

## Global Constraints

- Prettier: 120-char lines, single quotes, trailing commas, semicolons. `eslint --max-warnings 0`.
- `cd web && pnpm test --run <path>` — `--run` before the path, or the filter is silently dropped.
- Per `reference_web_checks_and_pr_base`, the web gate is three commands: `pnpm check:typescript`,
  `pnpm check:svelte`, `pnpm lint`.
- Per `reference_web_check_svelte_blind_locally`, `check:svelte` can scan zero files locally. Treat a
  suspiciously fast pass as "not actually checked" and rely on CI for it.

## File Structure

| File                                                | Responsibility                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| `web/src/lib/utils/map-filter-config.ts`            | map view provider                                                     |
| `web/src/lib/utils/album-filter-config.ts`          | album detail + asset picker, via `mapSuggestions`                     |
| `web/src/lib/utils/recently-added-filter-config.ts` | Recently Added, via its own `mapSuggestions`                          |
| `web/src/lib/utils/space-search.ts`                 | `mapSmartSearchFacetsToFilterSuggestions` — all smart-search surfaces |
| `routes/(user)/photos/[[assetId=id]]/+page.svelte`  | browse mapper + sentinel removal                                      |
| `routes/(user)/spaces/[spaceId]/…/+page.svelte`     | browse mapper + sentinel removal                                      |
| `routes/(user)/recently-added/…/+page.svelte`       | sentinel removal                                                      |

**Interfaces consumed:** `FilterSuggestionsResponse` from slice 3;
`FilterSuggestionsResponseDto` / `SmartSearchFacetsResponseDto` from slice 2.

**Interfaces produced:** every `FilterPanelConfig.suggestionsProvider` in the app now satisfies the widened
`FilterSuggestionsResponse`, and rejects rather than resolving on a failed facet fetch.

---

## Task 1: The four mappers

**Files:**

- Modify: `web/src/lib/utils/map-filter-config.ts:40-52`
- Modify: `web/src/lib/utils/album-filter-config.ts:24-38` (`mapSuggestions`)
- Modify: `web/src/lib/utils/recently-added-filter-config.ts:14-28` (`mapSuggestions`)
- Modify: `web/src/lib/utils/space-search.ts:116-136` (`mapSmartSearchFacetsToFilterSuggestions`)
- Test: `web/src/lib/utils/__tests__/album-filter-config.spec.ts`,
  `web/src/lib/utils/__tests__/map-filter-config.spec.ts`,
  `web/src/lib/utils/__tests__/recently-added-filter-config.spec.ts`,
  `web/src/lib/utils/__tests__/space-search.spec.ts`

- [ ] **Step 1: Write the failing tests**

One assertion per mapper — **all four**, including `space-search.ts`. That one is the easiest to skip
and the most important to cover: it is the mapper behind all three smart-search surfaces (photos,
spaces and recently-added in query mode), so a missed field there breaks three pages at once.
`space-search.spec.ts:347` already has a `describe('mapSmartSearchFacetsToFilterSuggestions')` block
with literal facet objects — extend those.

For the other three, add to the existing `describe` block in each spec — these files already mock
`@immich/sdk` and already have a populated `getFilterSuggestions` fixture, so extend that fixture rather
than adding a second mock.

In `album-filter-config.spec.ts`, extend the existing `getFilterSuggestions` mock value with
`hasFavorites: true, hasAssetsInAlbum: true, hasAssetsNotInAlbum: false`, then add:

```ts
it('forwards the #910 availability facets', async () => {
  const result = await buildAlbumDetailFilterConfig('album-1').suggestionsProvider!(createFilterState());

  expect(result.hasFavorites).toBe(true);
  expect(result.hasAssetsInAlbum).toBe(true);
  expect(result.hasAssetsNotInAlbum).toBe(false);
});
```

Add the equivalent to `map-filter-config.spec.ts` (using `buildMapFilterConfig()`), to
`recently-added-filter-config.spec.ts` (using `buildRecentlyAddedFilterConfig()`), and to
`space-search.spec.ts` (calling `mapSmartSearchFacetsToFilterSuggestions` directly), extending each
file's existing fixture the same way. Use distinct true/false combinations per file so a copy-paste
mapper bug that hard-codes one value cannot pass all four.

- [ ] **Step 2: Run them to verify they fail**

```bash
cd web && pnpm test --run src/lib/utils/__tests__/album-filter-config.spec.ts \
                          src/lib/utils/__tests__/map-filter-config.spec.ts \
                          src/lib/utils/__tests__/recently-added-filter-config.spec.ts \
                          src/lib/utils/__tests__/space-search.spec.ts
```

Expected: FAIL — `expected undefined to be true`.

- [ ] **Step 3: Forward the fields**

In all four mappers, add three lines after `hasUnnamedPeople`. `map-filter-config.ts`:

```ts
      ratings: response.ratings,
      mediaTypes: response.mediaTypes,
      hasUnnamedPeople: response.hasUnnamedPeople,
      hasFavorites: response.hasFavorites,
      hasAssetsInAlbum: response.hasAssetsInAlbum,
      hasAssetsNotInAlbum: response.hasAssetsNotInAlbum,
    };
```

`album-filter-config.ts` and `recently-added-filter-config.ts` use the same `response.` prefix inside their
`mapSuggestions`. `space-search.ts` uses `facets.`:

```ts
    ratings: facets.ratings,
    mediaTypes: facets.mediaTypes,
    hasUnnamedPeople: facets.hasUnnamedPeople,
    hasFavorites: facets.hasFavorites,
    hasAssetsInAlbum: facets.hasAssetsInAlbum,
    hasAssetsNotInAlbum: facets.hasAssetsNotInAlbum,
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd web && pnpm test --run src/lib/utils/__tests__/album-filter-config.spec.ts \
                          src/lib/utils/__tests__/map-filter-config.spec.ts \
                          src/lib/utils/__tests__/recently-added-filter-config.spec.ts \
                          src/lib/utils/__tests__/space-search.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/utils/
git commit -m "feat(web): forward the availability facets through every filter mapper (#910)"
```

---

## Task 1b: Wire `baselineProvider` on all six surfaces

**Files:** the four mappers from Task 1, plus the photos and spaces page configs.

Slice 3 declared `FilterPanelConfig.baselineProvider` (spec §4.5). This task supplies it. Read §4.5
before starting — the obvious implementation is wrong, and the reason is not visible from the panel.

**Why the panel cannot just call `suggestionsProvider(createFilterState())`.** All three query-mode
pages keep a _single_ `smartFacetInFlight` slot and abort it whenever an incoming request has a
different key (`photos/…/+page.svelte:239-247` and the same shape in spaces `:239-247` and
recently-added `:210-247`). Two concurrent facet requests under different keys therefore kill each
other. Worse, on resolve those pages assign `smartFacets = result`, and `smartFacets` drives the
Timeline buckets and the result count — so an unfiltered baseline response landing in that slot would
make the page display unfiltered data while filters are applied.

- [ ] **Step 1: Write the failing tests**

Two per query-mode page, one per simple surface.

```ts
it('offers a browse-mode baseline computed with no filters (#910)', async () => {
  const config = getRenderedFilterConfig();
  sdkMock.getFilterSuggestions.mockClear();

  const baseline = await config.baselineProvider!();

  expect(baseline).toBeDefined();
  // The whole point: the baseline ignores whatever filters are active.
  expect(sdkMock.getFilterSuggestions).toHaveBeenCalledWith(
    expect.objectContaining({ rating: undefined, personIds: undefined }),
  );
});

it('offers no baseline in query mode, and leaves the page facets alone (#910)', async () => {
  await commitQuery('beach');
  const config = getRenderedFilterConfig();
  sdkMock.searchSmartFacets.mockClear();

  await expect(config.baselineProvider!()).resolves.toBeUndefined();

  // Regression guard for spec §4.5: a baseline request here would abort the in-flight facet
  // fetch and then overwrite smartFacets, corrupting the timeline and the result count.
  expect(sdkMock.searchSmartFacets).not.toHaveBeenCalled();
});
```

`getRenderedFilterConfig` / `commitQuery` are shorthand — reuse whatever the neighbouring smart-search
tests in each file already do rather than inventing helpers.

For `map-filter-config.spec.ts`, `album-filter-config.spec.ts` and
`recently-added-filter-config.spec.ts`, assert only the first shape: those surfaces have no query mode.

- [ ] **Step 2: Run them to verify they fail**

Expected: FAIL — `config.baselineProvider is not a function`.

- [ ] **Step 3: Wire the four mappers**

Each already has a `mapSuggestions` and an SDK call. The baseline is the same call with the filter
arguments dropped, keeping only the scope arguments (`albumId`, `spaceId`, `withSharedSpaces`, …):

```ts
    baselineProvider: async () => mapSuggestions(await getFilterSuggestions({ /* scope args only */ })),
```

- [ ] **Step 4: Wire the two page configs**

Browse mode returns a real baseline; query mode returns `undefined`. On the photos page:

```ts
    // #910: no baseline in query mode. A second concurrent facet request would abort the in-flight
    // one (single `smartFacetInFlight` slot) and then clobber `smartFacets`, which feeds the
    // timeline and the result count. `undefined` means "don't hide anything here" — see spec §4.5.
    baselineProvider: async () => (showSearchResults ? undefined : loadPhotoFilterSuggestions(createFilterState())),
```

The spaces page takes the identical shape with `loadSpaceFilterSuggestions`. The Recently Added page
routes through `recently-added-filter-config.ts`, so it is covered by Step 3 — verify which branch it
actually uses before assuming.

- [ ] **Step 5: Run the tests to verify they pass, then commit**

```bash
git add web/src/lib/utils/ "web/src/routes/(user)/"
git commit -m "feat(web): give each filter surface a no-filters baseline provider (#910)"
```

---

## Task 2: Delete the empty-response sentinel

**Files:**

- Modify: `routes/(user)/photos/[[assetId=id]]/+page.svelte` — `emptyFilterSuggestions` at `:167`, its
  call site at `:302`
- Modify: `routes/(user)/spaces/[spaceId]/…/+page.svelte` — `:172` and `:306`
- Modify: `routes/(user)/recently-added/…/+page.svelte` — `:184` and `:268`

(Line numbers drift; `grep -rn "emptyFilterSuggestions" web/src` gives all six in one shot.)

- Test: the three page spec files alongside those routes

All three pages resolve their provider with every array empty when the smart-facets request fails. Today
that renders empty pickers. Once slice 5 gates on emptiness it would read as "this library has nothing" and
hide every section at once.

**Do not** satisfy `tsc` by adding `hasFavorites: false` to the sentinel. That is the bug. Delete it.

- [ ] **Step 1: Write the failing tests**

One per page. The specs already mock the SDK as `sdkMock`; follow the existing setup at
`photos-page.spec.ts:235-250`.

```ts
it('rejects rather than reporting an empty library when the facet fetch fails (#910)', async () => {
  sdkMock.searchSmartFacets.mockRejectedValue(new Error('boom'));

  // Drive the page into query mode exactly as the neighbouring smart-search tests do, then invoke the
  // provider the panel would call.
  const provider = getRenderedFilterConfig().suggestionsProvider!;

  await expect(provider(createFilterState())).rejects.toThrow('boom');
});
```

`getRenderedFilterConfig()` is shorthand for however the surrounding tests reach the config — read the
neighbouring smart-search test in the same file and use the same mechanism rather than inventing one.

- [ ] **Step 2: Run them to verify they fail**

```bash
cd web && pnpm test --run "src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts"
```

Expected: FAIL — the promise resolves with the empty sentinel instead of rejecting.

- [ ] **Step 3: Remove the sentinel from the photos page**

Delete the `emptyFilterSuggestions` const, then change the provider branch:

```ts
const facets = await loadPhotoSmartFacets(nextFilters);
if (!facets) {
  // #910: never resolve with a fabricated empty response — the panel cannot tell it apart from a
  // genuinely empty library and would hide every section. Rejecting lets the panel keep the last
  // good facets.
  throw new Error('smart-search facets unavailable');
}
```

Apply the identical change to the spaces page and the Recently Added page.

- [ ] **Step 4: Check `loadPhotoSmartFacets`'s own catch**

`loadPhotoSmartFacets` swallows its error and returns the stale `smartFacets` (`:259-264`), which is
`undefined` on a first failure — that is the path reaching the sentinel. Leave that catch as it is: it
correctly keeps the previous facets when they exist, and the new `throw` covers the case where they do
not.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd web && pnpm test --run "src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts" \
                          "src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts" \
                          "src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/recently-added-page.spec.ts"
```

Expected: PASS, including every pre-existing test in those files.

- [ ] **Step 6: Commit**

```bash
git add "web/src/routes/(user)/"
git commit -m "fix(web): reject instead of faking empty filter facets on fetch failure (#910)"
```

---

## Task 3: Browse-path providers, fixtures, and the typecheck gate

**Files:**

- Modify: `routes/(user)/photos/[[assetId=id]]/+page.svelte` — `loadPhotoFilterSuggestions`'s return object
- Modify: `routes/(user)/spaces/[spaceId]/…/+page.svelte` — `loadSpaceFilterSuggestions`'s return object
- Modify: `web/src/lib/utils/__tests__/filter-section-parity.spec.ts:11-20` — the mock
- Modify: any remaining spec fixture `tsc` names

- [ ] **Step 1: Let the compiler enumerate the work**

```bash
cd web && pnpm check:typescript 2>&1 | grep -E "hasFavorites|hasAssetsInAlbum|hasAssetsNotInAlbum"
```

Expected: a list of every object literal still missing the fields. This is the checklist for this task.
Slice 3 deliberately made the interface fields required so this list is complete.

- [ ] **Step 2: Forward them in the two browse-path providers**

Both pages build their response inline rather than through a shared mapper. Add the same three lines used
in Task 1 after `hasUnnamedPeople:`.

- [ ] **Step 3: Update the parity-spec mock**

`filter-section-parity.spec.ts` mocks `getFilterSuggestions` with a literal. Extend it:

```ts
    getFilterSuggestions: vi.fn().mockResolvedValue({
      countries: [],
      cameraMakes: [],
      tags: [],
      people: [],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
      hasFavorites: false,
      hasAssetsInAlbum: false,
      hasAssetsNotInAlbum: false,
    }),
```

This spec guards `config.sections` parity, which this change does not touch. Its assertions must stay
exactly as they are — if one goes red, a mapper edit changed a section list and that is a bug.

- [ ] **Step 4: Update the remaining fixtures**

Work through the Step 1 list. Page specs at `photos-page.spec.ts:235` and `:244` and their siblings need
the fields on both the `getFilterSuggestions` and the `searchSmartFacets` mock values.

- [ ] **Step 5: Full web gate**

```bash
cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm test
```

Expected: all green. `check:typescript` returning clean is the real deliverable of this slice — it proves
no surface was missed.

- [ ] **Step 6: Commit**

```bash
git add web/
git commit -m "feat(web): forward the availability facets from every filter surface (#910)"
```

---

## Done when

- `pnpm check:typescript` is green — no surface still omits a field.
- `pnpm test --run` is green, including `filter-section-parity.spec.ts` with unmodified assertions.
- `grep -rn "emptyFilterSuggestions" web/src` returns nothing.
- `grep -rn "baselineProvider" web/src/lib/utils "web/src/routes/(user)"` returns **six** wiring sites.
  `tsc` cannot check this one for you — the field is optional, so a surface that forgets it silently
  never hides anything (spec §4.5).
- No `baselineProvider` calls `suggestionsProvider(createFilterState())`, and none of the three
  query-mode branches issues a facet request.
- The filter panel component is still untouched.
