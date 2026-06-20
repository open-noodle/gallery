# Merged Filter Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the timeline grouping control (Years / Months / All) and the active-filters chip bar into a single toolbar row across every route that shows them, with the grouping pill on the left, the result count + filter chips next, and "Clear all" on the right.

**Architecture:** Introduce one layout primitive, `FilterToolbar.svelte`, that renders a single responsive flex row: `TimelineGroupingControl` (left, desktop-only) → vertical hairline → an embedded `ActiveFiltersBar` (fills remaining width). `ActiveFiltersBar` gains an `embedded` mode that drops its own band/border/padding so it can live inside the toolbar. The existing combiner `TimelineRouteGroupingBar` is refactored to delegate to `FilterToolbar` (covering ~9 routes for free); the three hand-composed routes (spaces, photos, albums) and the map are migrated to the same primitive.

**Tech Stack:** SvelteKit, Svelte 5 runes (`$props`, `$derived`, snippets), `@immich/ui` (`Icon`), `@mdi/js`, Tailwind CSS 4, `tailwind-merge`, Vitest + `@testing-library/svelte`.

## Global Constraints

- Stay within existing `@immich/ui` / Tailwind theme tokens — no new color system (chip fill `bg-gray-100` / `dark:bg-white/[0.06]`, hairline `border-gray-200/60` / `dark:border-white/10`, `immich-primary` / `immich-dark-primary`). Verbatim from `docs/superpowers/specs/2026-06-17-filter-panel-redesign-design.md`.
- Prettier: 120-char line width, single quotes, trailing commas, semicolons. Run `make format-web` before each commit if unsure.
- ESLint zero-warnings policy (`--max-warnings 0`); `no-floating-promises` / `no-misused-promises` enforced. Defer the slow full `make lint-web` to the final gate (Task 8); use `make check-web` in the loop.
- Web unit tests run with `cd web && pnpm test -- --run <file>` (Vitest). The path filter currently runs the full suite regardless — that is expected; "all green" is the bar.
- **Responsive contract that MUST be preserved:** the grouping control is desktop-only (`md:flex`); the active-filters bar is visible on **all** screen sizes today in spaces/photos/albums/map. Merging must not hide the filters bar on mobile.
- **Prerequisite (already applied, uncommitted):** `active-filters-bar.svelte` was restyled (type icons via `sectionIcons`, `mdiClose` close buttons, soft filled pills, leading count + dot separator, band→hairline) and `__tests__/active-filters-bar.spec.ts` updated (rating chip now `"3+"` with a leading star icon). This plan builds on that working tree. Do **not** revert it.

---

## File Structure

**New files:**

- `web/src/lib/components/filter-panel/filter-toolbar.svelte` — the single-row toolbar layout primitive (grouping + embedded filters bar). One responsibility: lay out the two controls responsively.
- `web/src/lib/components/filter-panel/__tests__/filter-toolbar.spec.ts` — unit tests for the primitive.

**Modified files:**

- `web/src/lib/components/filter-panel/active-filters-bar.svelte` — add `embedded` prop.
- `web/src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts` — add an `embedded`-mode test.
- `web/src/lib/components/timeline/TimelineRouteGroupingBar.svelte` — delegate to `FilterToolbar`.
- `web/src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts` — update structural assertions.
- `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte` — replace two rows with one `FilterToolbar`.
- `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte` — same.
- `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts` — preserve testids / adjust.
- `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte` — browse mode merges; picker mode stays standalone.
- `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts` — adjust.
- `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte` — add a readable backdrop to the floating bar wrapper (fixes the transparent-over-map regression from the restyle).

**Unchanged (covered transitively via `TimelineRouteGroupingBar`):** archive, trash, locked, favorites, tags, partners, spaces/people, people/[personId], `MapTimelinePanel.svelte`, `gallery-viewer.svelte`. They pass only `grouping`/`hidden`/`onGroupingChange` (except `MapTimelinePanel`, which also passes `filters`/`resultCount`/`onClearTemporalFilter`), so refactoring `TimelineRouteGroupingBar` updates all of them at once.

---

### Task 1: ActiveFiltersBar — `embedded` mode

**Files:**

- Modify: `web/src/lib/components/filter-panel/active-filters-bar.svelte`
- Test: `web/src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts`

**Interfaces:**

- Produces: `ActiveFiltersBar` gains prop `embedded?: boolean` (default `false`). When `true`, the root element omits `border-b border-gray-200/60 px-4 py-2.5 dark:border-white/10` (host toolbar supplies spacing/seam); when `false`, behavior is unchanged.

- [ ] **Step 1: Write the failing test**

Add to `__tests__/active-filters-bar.spec.ts` inside the `describe('ActiveFiltersBar', …)` block:

```ts
it('omits its own band and padding in embedded mode', () => {
  const filters = createFilterState();
  filters.country = 'Germany';

  // embedded: no self-drawn seam/padding (the host toolbar supplies them)
  const embedded = render(ActiveFiltersBar, {
    props: { filters, onRemoveFilter: () => {}, onClearAll: () => {}, embedded: true },
  });
  const embeddedBar = embedded.getByTestId('active-filters-bar');
  expect(embeddedBar.className).not.toContain('border-b');
  expect(embeddedBar.className).not.toContain('px-4');

  // standalone (default): keeps the seam + padding
  const standalone = render(ActiveFiltersBar, {
    props: { filters, onRemoveFilter: () => {}, onClearAll: () => {}, embedded: false },
  });
  const standaloneBar = standalone.getByTestId('active-filters-bar');
  expect(standaloneBar.className).toContain('border-b');
  expect(standaloneBar.className).toContain('px-4');
});
```

> Two separate `render` calls (not `rerender`) — each scopes `getByTestId` to its own container, avoiding a duplicate-testid clash and the `rerender` promise dance. Both patterns exist in the suite (`Image.spec.ts` uses `rerender`); two renders is simpler here.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts`
Expected: FAIL — `embedded` prop not yet handled, so the root still contains `border-b`/`px-4` and the first assertions fail (or `embedded` is an unknown prop).

- [ ] **Step 3: Add the prop**

In the `interface Props` block of `active-filters-bar.svelte`, add after `onClearSearch?: () => void;`:

```ts
    embedded?: boolean;
```

And in the destructuring (`let { … }: Props = $props();`), add `embedded = false,` (e.g. after `onClearSearch,`).

- [ ] **Step 4: Make the root class conditional**

Replace the root element's opening tag:

```svelte
<div
  class="flex flex-wrap items-center gap-2 border-b border-gray-200/60 px-4 py-2.5 dark:border-white/10"
  data-testid="active-filters-bar"
>
```

with:

```svelte
<div
  class="flex flex-wrap items-center gap-2 {embedded ? '' : 'border-b border-gray-200/60 px-4 py-2.5 dark:border-white/10'}"
  data-testid="active-filters-bar"
>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts`
Expected: PASS — all existing tests plus the new embedded test.

- [ ] **Step 6: Type check**

Run: `cd web && pnpm check:typescript` (or `make check-web` from repo root)
Expected: no new errors referencing `active-filters-bar.svelte`.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/components/filter-panel/active-filters-bar.svelte web/src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts
git commit -m "feat(web): add embedded mode to active filters bar"
```

---

### Task 2: `FilterToolbar.svelte` — the single-row primitive

**Files:**

- Create: `web/src/lib/components/filter-panel/filter-toolbar.svelte`
- Test: `web/src/lib/components/filter-panel/__tests__/filter-toolbar.spec.ts`

**Interfaces:**

- Consumes: `TimelineGroupingControl` (`web/src/lib/components/timeline/TimelineGroupingControl.svelte`), props `grouping`, `onGroupingChange`, `disabled`.
- Produces: `FilterToolbar` with props:
  - `grouping: TimelineGrouping`
  - `onGroupingChange: (grouping: TimelineGrouping) => void`
  - `groupingDisabled?: boolean` (default `false`)
  - `showGrouping?: boolean` (default `true`) — render the grouping pill (desktop-only)
  - `showFilters?: boolean` (default `false`) — render the `filters` snippet + the separator
  - `filters?: Snippet` — the embedded `ActiveFiltersBar` (caller supplies it with `embedded` set)
  - `class?: string` — merged onto the row container
  - Renders nothing when `!showGrouping && !showFilters`.
  - Container is `flex` when `showFilters` (visible on all sizes so the bar shows on mobile) and `hidden md:flex` when grouping-only (desktop-only, matching today).
  - The grouping pill is wrapped in a `hidden md:flex` element carrying `data-testid="timeline-desktop-grouping-control"` (preserves existing route-test selectors). The separator is also desktop-only.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/components/filter-panel/__tests__/filter-toolbar.spec.ts`:

```ts
import '@testing-library/jest-dom';
import { render } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { createRawSnippet } from 'svelte';
import FilterToolbar from '../filter-toolbar.svelte';

beforeAll(async () => {
  register('en-US', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

const filtersSnippet = createRawSnippet(() => ({
  render: () => `<div data-testid="bar-content">chips</div>`,
}));

describe('FilterToolbar', () => {
  it('renders the grouping control (desktop wrapper) and no filters by default', () => {
    const { getByTestId, queryByTestId } = render(FilterToolbar, {
      props: { grouping: 'day', onGroupingChange: () => {} },
    });
    expect(getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    expect(getByTestId('timeline-grouping-control')).toBeInTheDocument();
    expect(queryByTestId('filter-toolbar-separator')).toBeNull();
  });

  it('renders the filters snippet and separator when showFilters is set', () => {
    const { getByTestId } = render(FilterToolbar, {
      props: {
        grouping: 'day',
        onGroupingChange: () => {},
        showGrouping: true,
        showFilters: true,
        filters: filtersSnippet,
      },
    });
    expect(getByTestId('bar-content')).toBeInTheDocument();
    expect(getByTestId('filter-toolbar-separator')).toBeInTheDocument();
  });

  it('omits the grouping wrapper (and separator) when showGrouping is false', () => {
    const { queryByTestId, getByTestId } = render(FilterToolbar, {
      props: {
        grouping: 'day',
        onGroupingChange: () => {},
        showGrouping: false,
        showFilters: true,
        filters: filtersSnippet,
      },
    });
    expect(queryByTestId('timeline-desktop-grouping-control')).toBeNull();
    expect(queryByTestId('filter-toolbar-separator')).toBeNull();
    expect(getByTestId('bar-content')).toBeInTheDocument();
  });

  it('renders nothing when neither grouping nor filters are shown', () => {
    const { container } = render(FilterToolbar, {
      props: { grouping: 'day', onGroupingChange: () => {}, showGrouping: false, showFilters: false },
    });
    expect(container.querySelector('[data-testid="timeline-grouping-control"]')).toBeNull();
  });

  // --- responsive contract (the riskiest part of the merge) ---

  it('is visible on mobile (flex, never hidden) when filters are shown', () => {
    const { getByTestId } = render(FilterToolbar, {
      props: {
        grouping: 'day',
        onGroupingChange: () => {},
        showGrouping: true,
        showFilters: true,
        filters: filtersSnippet,
      },
    });
    // the grouping wrapper's parent IS the toolbar root
    const root = getByTestId('timeline-desktop-grouping-control').parentElement!;
    expect(root.className).toContain('flex');
    expect(root.className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });

  it('is desktop-only (hidden md:flex) when only grouping is shown', () => {
    const { getByTestId } = render(FilterToolbar, {
      props: { grouping: 'day', onGroupingChange: () => {}, showGrouping: true, showFilters: false },
    });
    const root = getByTestId('timeline-desktop-grouping-control').parentElement!;
    expect(root.className).toContain('hidden');
    expect(root.className).toContain('md:flex');
  });
});
```

> These two cases pin the contract that broke would be silent and only visible at runtime on a phone: with active filters the chip bar must show on mobile (`flex`), while the grouping-only state stays desktop-only (`hidden md:flex`). The embedded bar fills via `min-w-0 flex-1`, so its `Clear all` (`ml-auto`) lands at the row's right edge and chips wrap rather than overflow — verified visually in Task 8, not unit-tested.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-toolbar.spec.ts`
Expected: FAIL — `../filter-toolbar.svelte` does not exist (import/resolve error).

- [ ] **Step 3: Create the component**

Create `web/src/lib/components/filter-panel/filter-toolbar.svelte`:

```svelte
<script lang="ts">
  import TimelineGroupingControl from '$lib/components/timeline/TimelineGroupingControl.svelte';
  import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
  import type { Snippet } from 'svelte';
  import { twMerge } from 'tailwind-merge';

  interface Props {
    grouping: TimelineGrouping;
    onGroupingChange: (grouping: TimelineGrouping) => void;
    groupingDisabled?: boolean;
    showGrouping?: boolean;
    showFilters?: boolean;
    filters?: Snippet;
    class?: string;
  }

  let {
    grouping,
    onGroupingChange,
    groupingDisabled = false,
    showGrouping = true,
    showFilters = false,
    filters,
    class: className = '',
  }: Props = $props();
</script>

{#if showGrouping || showFilters}
  <!--
    Root display is responsive-by-intent:
    - showFilters → `flex` (visible on ALL sizes, so the chip bar still shows on mobile)
    - grouping-only → `hidden md:flex` (desktop-only, matching today's behavior)
    `bg-transparent` keeps the toolbar a hairline surface on the content background (never the old gray band).
    A caller MAY pass `class="hidden md:flex"` to force desktop-only even when showFilters is true
    (TimelineRouteGroupingBar does this); twMerge lets the later display utility win.
  -->
  <div
    class={twMerge(
      'shrink-0 items-center gap-3 bg-transparent px-4 py-2 dark:bg-transparent',
      showFilters ? 'flex' : 'hidden md:flex',
      className,
    )}
  >
    {#if showGrouping}
      <div class="hidden md:flex md:items-center" data-testid="timeline-desktop-grouping-control">
        <TimelineGroupingControl {grouping} {onGroupingChange} disabled={groupingDisabled} />
      </div>
    {/if}

    {#if showFilters}
      {#if showGrouping}
        <span
          class="hidden h-5 w-px shrink-0 bg-gray-200/70 md:block dark:bg-white/10"
          data-testid="filter-toolbar-separator"
          aria-hidden="true"
        ></span>
      {/if}
      <div class="min-w-0 flex-1">
        {@render filters?.()}
      </div>
    {/if}
  </div>
{/if}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-toolbar.spec.ts`
Expected: PASS — all four cases.

- [ ] **Step 5: Type check**

Run: `cd web && pnpm check:typescript`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/components/filter-panel/filter-toolbar.svelte web/src/lib/components/filter-panel/__tests__/filter-toolbar.spec.ts
git commit -m "feat(web): add FilterToolbar single-row layout primitive"
```

---

### Task 3: Refactor `TimelineRouteGroupingBar` to delegate to `FilterToolbar`

This updates ~9 consumers at once (archive, trash, locked, favorites, tags, partners, spaces/people, people/[personId], `MapTimelinePanel`, `gallery-viewer`). Only `MapTimelinePanel` passes `filters`/`resultCount` → it gets the real merge; the rest are grouping-only.

**Files:**

- Modify: `web/src/lib/components/timeline/TimelineRouteGroupingBar.svelte`
- Test: `web/src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts`

**Interfaces:**

- Consumes: `FilterToolbar` (Task 2), `ActiveFiltersBar` with `embedded` (Task 1).
- Produces: unchanged public props (`grouping`, `filters?`, `resultCount?`, `hidden?`, `class?`, `onGroupingChange`, `onClearTemporalFilter?`).

This is a behavior-preserving refactor: the existing `TimelineRouteGroupingBar.spec.ts` is the safety net. Confirmed-relevant assertions (verified against the file): it preserves the `timeline-desktop-grouping-control` testid (`:16`), the transparent surface with no gray band (`:23–33`), the clearable temporal chip + result count when temporal filters are active (`:54–73`), no chips for non-temporal filters (`:76–95`), and empty output when `hidden` (`:98–112`). All of these stay green if `FilterToolbar` keeps the testid, carries `bg-transparent`, and gates the bar on `hasActiveTemporalFilters` — which it does.

- [ ] **Step 1: Confirm green baseline**

Run: `cd web && pnpm test -- --run src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts`
Expected: PASS (baseline before refactor).

- [ ] **Step 2: Rewrite the markup**

Replace the entire `{#if !hidden} … {/if}` template block (lines ~46–61) in `TimelineRouteGroupingBar.svelte` with:

```svelte
{#if !hidden}
  <FilterToolbar
    {grouping}
    {onGroupingChange}
    showFilters={hasActiveTemporalFilters}
    class={twMerge('hidden md:flex', className)}
  >
    {#snippet filters()}
      <ActiveFiltersBar
        embedded
        filters={temporalFilters}
        {resultCount}
        onRemoveFilter={removeTemporalFilter}
        onClearAll={() => onClearTemporalFilter?.()}
      />
    {/snippet}
  </FilterToolbar>
{/if}
```

Update the imports at the top of the `<script>`: remove the now-unused `TimelineGroupingControl` import and add:

```ts
import FilterToolbar from '$lib/components/filter-panel/filter-toolbar.svelte';
```

Keep `ActiveFiltersBar`, `buildFilterContext`, `createFilterState`, `twMerge`, the `temporalFilters`/`hasActiveTemporalFilters` deriveds, and `removeTemporalFilter` as-is.

> **Why the spec stays green:** `FilterToolbar` keeps `timeline-desktop-grouping-control`; its root carries `bg-transparent dark:bg-transparent`, so `:23–33` (parent has `bg-transparent`, lacks `bg-gray-50`/`border-b`) still holds. The embedded bar renders only when `hasActiveTemporalFilters`, satisfying `:76–95` and `:98–112`. `class={twMerge('hidden md:flex', className)}` keeps this component desktop-only: even though `FilterToolbar` defaults to `flex` when `showFilters` is true, this later `hidden md:flex` className wins in twMerge — intended, since these are desktop routes and the route bar was desktop-only before. (Follow-up, out of scope: if `MapTimelinePanel`'s temporal bar should appear on mobile, stop forcing `hidden md:flex` for it.)

- [ ] **Step 3: Run the spec — expect all green, no edits needed**

Run: `cd web && pnpm test -- --run src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts`
Expected: PASS, unchanged. If `:31` fails on `bg-transparent`, you omitted `bg-transparent dark:bg-transparent` on the `FilterToolbar` root (Task 2) — add it and re-run.

- [ ] **Step 4: Tidy one now-stale test name**

The test `'keeps the route grouping surface transparent instead of drawing a full-width toolbar'` still asserts the right thing (transparent surface, no gray band) but the name is misleading now that we intentionally draw a transparent toolbar row. Rename it to `'keeps the toolbar surface transparent (no gray band)'`; leave its assertions unchanged.

- [ ] **Step 5: Type check**

Run: `cd web && pnpm check:typescript`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/components/timeline/TimelineRouteGroupingBar.svelte web/src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts
git commit -m "refactor(web): TimelineRouteGroupingBar renders one merged toolbar row"
```

---

### Task 4: Migrate the spaces route

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte` (grouping div at ~1061–1068, filters div at ~1071–1084)
- Test: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts`

**Interfaces:**

- Consumes: `FilterToolbar` (Task 2). Add import `import FilterToolbar from '$lib/components/filter-panel/filter-toolbar.svelte';`.

TDD shape: the old `space-active-filters-bar-spacing` wrapper is removed and grouping+bar move into one `FilterToolbar` row. Write that expectation first (RED), then implement (GREEN). Symbols below are verified present in `+page.svelte`: `handleRemoveFilter` (`:421`), `handleClearAllFilters` (`:867`), `clearSearch` (`:796`), `committedSearchQuery` (`:776`), `getActiveFilterCount` (import `:10`), `handleTimelineGroupingChange` (`:861`), `smartFacetTotal`/`totalAssetCount`.

- [ ] **Step 1: Confirm green baseline + see what the spec asserts**

Run: `cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts"` (expect PASS), then
`cd web && grep -nE "timeline-desktop-grouping-control|space-active-filters-bar-spacing|active-filters" "src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts"`
Note which assertions reference the spacing wrapper — those are the ones the refactor will turn RED.

- [ ] **Step 2: Write the failing merge assertion (RED)**

Add to `spaces-page.spec.ts` (in the view-mode-with-active-filters context the spec already sets up; reuse its existing render/setup helper):

```ts
it('shows grouping and the filters bar in one merged toolbar (no separate spacing wrapper)', async () => {
  // ...arrange: view mode, a country/person filter active (reuse the spec's existing setup)...
  expect(await screen.findByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
  expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument();
  expect(screen.queryByTestId('space-active-filters-bar-spacing')).toBeNull();
});
```

Run: `cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts"`
Expected: FAIL — `space-active-filters-bar-spacing` still exists (and grouping/bar are in separate rows).

- [ ] **Step 3: Replace the two blocks with one toolbar**

Replace both the grouping block and the active-filters block (the `{#if viewMode === 'view' && !showSearchResults && …}` grouping div and the `{#if viewMode === 'view' && (getActiveFilterCount(filters) > 0 || committedSearchQuery.trim().length > 0)}` filters div) with:

```svelte
      {#if viewMode === 'view'}
        <FilterToolbar
          class="mb-2"
          grouping={timelineGrouping}
          onGroupingChange={handleTimelineGroupingChange}
          showGrouping={!showSearchResults && !assetMultiSelectManager.selectionActive}
          showFilters={getActiveFilterCount(filters) > 0 || committedSearchQuery.trim().length > 0}
        >
          {#snippet filters()}
            <ActiveFiltersBar
              embedded
              {filters}
              resultCount={showSearchResults ? smartFacetTotal : totalAssetCount}
              {personNames}
              {tagNames}
              onRemoveFilter={handleRemoveFilter}
              onClearAll={handleClearAllFilters}
              searchQuery={committedSearchQuery}
              onClearSearch={clearSearch}
            />
          {/snippet}
        </FilterToolbar>
      {/if}
```

- [ ] **Step 4: Run — the new assertion goes GREEN, structural ones go RED**

Run: `cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts"`
Expected: the Step 2 test now PASSES; any pre-existing assertions referencing `space-active-filters-bar-spacing` now FAIL.

- [ ] **Step 5: Update the now-stale assertions**

For each assertion using `getByTestId('space-active-filters-bar-spacing')`, switch to `getByTestId('active-filters-bar')` (the chip bar) or `getByTestId('timeline-desktop-grouping-control')` (grouping presence), preserving the original present/absent intent.

- [ ] **Step 6: Run again to verify all pass**

Run: `cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte" "web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts"
git commit -m "feat(web): merge grouping + filters into one toolbar on spaces page"
```

---

### Task 5: Migrate the photos route

**Files:**

- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte` (grouping at ~540–546, filters at ~548–560)
- Test: `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts` (grouping testid assertions at ~816–880; `active-filters-bar-stub` at ~632–692)

**Interfaces:**

- Consumes: `FilterToolbar`. Add its import.
- Note: `photos-page.spec.ts` mocks `ActiveFiltersBar` as `active-filters-bar-stub` and asserts grouping presence via `timeline-desktop-grouping-control`. Both selectors survive: the stub is still rendered (now inside the toolbar snippet, gated by `showFilters`), and `FilterToolbar` keeps the grouping testid on its desktop wrapper.

TDD shape mirrors Task 4. `photos-page.spec.ts` mocks `ActiveFiltersBar` as `active-filters-bar-stub` and gates grouping via `timeline-desktop-grouping-control` (`:816–880`) and the stub via `photos-active-filters-bar-spacing` (`:632–692`). Both selectors survive the merge: the stub renders inside `FilterToolbar`'s `filters` snippet (gated by `showFilters={hasActiveFilters}`), and the grouping testid lives on `FilterToolbar`'s desktop wrapper. Symbols verified in `+page.svelte`: `hasActiveFilters` (`:340`), `committedQuery` (`:122`, **not** `committedSearchQuery`), `clearSearch` (`:398`), `handleRemoveActiveFilter` (`:461`), `handleClearAllFilters` (`:470`), `smartFacetTotal` (`:152`), `showSearchResults` (`:128`), `personNames`/`tagNames` (`:136–137`).

- [ ] **Step 1: Confirm green baseline**

Run: `cd web && pnpm test -- --run "src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts"`
Expected: PASS.

- [ ] **Step 2: Write the failing merge assertion (RED)**

Add to `photos-page.spec.ts` (reuse the spec's existing render helper that puts the page in browse mode with an active filter):

```ts
it('shows grouping and the filter bar in one merged toolbar (no separate spacing wrapper)', async () => {
  // ...arrange: browse mode + an active filter (reuse the spec's setup)...
  expect(await screen.findByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
  expect(screen.getByTestId('active-filters-bar-stub')).toBeInTheDocument();
  expect(screen.queryByTestId('photos-active-filters-bar-spacing')).toBeNull();
});
```

Run: `cd web && pnpm test -- --run "src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts"`
Expected: FAIL — `photos-active-filters-bar-spacing` still exists.

- [ ] **Step 3: Replace the two blocks**

Replace the grouping `{#if !showSearchResults && !assetMultiSelectManager.selectionActive}` div and the `{#if hasActiveFilters}` filters div with:

```svelte
      {#snippet photoFiltersBar()}
        <ActiveFiltersBar
          embedded
          {filters}
          searchQuery={committedQuery}
          onClearSearch={clearSearch}
          resultCount={showSearchResults ? smartFacetTotal : totalAssetCount}
          {personNames}
          {tagNames}
          onRemoveFilter={handleRemoveActiveFilter}
          onClearAll={handleClearAllFilters}
        />
      {/snippet}
      <FilterToolbar
        class="mb-2"
        grouping={timelineGrouping}
        onGroupingChange={handleTimelineGroupingChange}
        showGrouping={!showSearchResults && !assetMultiSelectManager.selectionActive}
        showFilters={hasActiveFilters}
        filters={photoFiltersBar}
      />

> ⚠️ **Name the snippet, don't call it `filters`.** A `{#snippet filters()}` inside `<FilterToolbar>` shadows this page's own `filters: FilterState` in Svelte 5, so `{filters}` in the snippet body (and `getActiveFilterCount(filters)`) resolves to the snippet, not the state — it crashes at render. Declare the snippet as a sibling named `photoFiltersBar` and pass `filters={photoFiltersBar}` (the `filters` prop on `FilterToolbar` is the snippet slot; the value you pass is the named snippet). Discovered while implementing Task 4.
```

Add `import FilterToolbar from '$lib/components/filter-panel/filter-toolbar.svelte';` to the script imports.

- [ ] **Step 4: Run — new assertion GREEN, structural ones may go RED**

Run: `cd web && pnpm test -- --run "src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts"`
Expected: the Step 2 test PASSES. Grouping-presence (`:816–880`) and stub-presence (`:632–692`) tests should also pass (selectors preserved). Only assertions that pinned a specific DOM nesting or the `photos-active-filters-bar-spacing` wrapper go RED.

- [ ] **Step 5: Update any DOM-structural assertions**

Change structural queries to testid queries: `findByTestId('timeline-desktop-grouping-control')` for grouping, `queryByTestId('active-filters-bar-stub')` for the bar, and replace `photos-active-filters-bar-spacing` lookups accordingly. Keep present/absent intent identical to before.

- [ ] **Step 6: Run again to verify all pass**

Run: `cd web && pnpm test -- --run "src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte" "web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts"
git commit -m "feat(web): merge grouping + filters into one toolbar on photos page"
```

---

### Task 6: Migrate the albums route (browse merges; picker stays standalone)

**Files:**

- Modify: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte` (grouping at ~510–516; picker bar at ~519–531; browse bar at ~532–549)
- Test: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts`

**Interfaces:**

- Consumes: `FilterToolbar`. Add its import.
- The grouping control only renders in browse-timeline mode (`isBrowseTimeline && !selectionActive`). The **picker** bar (`viewMode === AlbumPageViewMode.SELECT_ASSETS`) has no grouping → keep it as a standalone `ActiveFiltersBar` (it already gets the restyle). Only the **browse** bar merges.

Verified in `+page.svelte`: `isBrowseTimeline = $derived(viewMode === AlbumPageViewMode.VIEW)` (`:335`) — so it is **false** during `SELECT_ASSETS` (picker), confirming grouping never shows in picker and the browse/picker branches are mutually exclusive. Other symbols confirmed: `albumFilters` (`:112`), `pickerFilters` (`:113`), `clearAlbumTemporalFilter` (`:410`), `temporalAnchor` (`:115`), `handlePhotosRemoveFilter` (import `:68`), `clearFilters` (import `:14`), `getActiveFilterCount` (import `:16`), `albumPersonNames`/`albumTagNames`/`pickerPersonNames`/`pickerTagNames` (`:116–119`), `handleTimelineGroupingChange` (`:390`).

- [ ] **Step 1: Confirm green baseline**

Run: `cd web && pnpm test -- --run "src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts"`
Expected: PASS.

- [ ] **Step 2: Write the failing merge assertion (RED)**

Add to `page.route.spec.ts` (reuse the spec's browse-mode setup with an active album filter):

```ts
it('merges grouping and the filter bar into one toolbar row in browse mode', async () => {
  // ...arrange: browse (VIEW) mode + an active albumFilter (reuse the spec's setup)...
  const grouping = await screen.findByTestId('timeline-desktop-grouping-control');
  const bar = screen.getByTestId('active-filters-bar');
  // grouping wrapper and the bar's flex-1 column share the FilterToolbar root
  expect(grouping.parentElement).toBe(bar.parentElement?.parentElement);
});
```

Run: `cd web && pnpm test -- --run "src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts"`
Expected: FAIL — grouping and the bar are still in separate rows (different parents).

- [ ] **Step 3: Replace the grouping div + browse bar with a toolbar; keep the picker bar standalone**

Remove the grouping `{#if isBrowseTimeline && !assetMultiSelectManager.selectionActive}` div. Restructure the filters `{#if … SELECT_ASSETS …}{:else if …}` so the picker branch renders a standalone bar and the browse branch renders the toolbar:

```svelte
          {#if viewMode === AlbumPageViewMode.SELECT_ASSETS && getActiveFilterCount(pickerFilters) > 0}
            <ActiveFiltersBar
              filters={pickerFilters}
              resultCount={totalAssetCount}
              personNames={pickerPersonNames}
              tagNames={pickerTagNames}
              onRemoveFilter={(type, id) => {
                pickerFilters = handlePhotosRemoveFilter(pickerFilters, type, id);
              }}
              onClearAll={() => {
                pickerFilters = clearFilters(pickerFilters);
              }}
            />
          {:else if viewMode !== AlbumPageViewMode.SELECT_ASSETS}
            {#snippet albumFiltersBar()}
              <ActiveFiltersBar
                embedded
                filters={albumFilters}
                resultCount={totalAssetCount}
                personNames={albumPersonNames}
                tagNames={albumTagNames}
                onRemoveFilter={(type, id) => {
                  if (type === 'timeline') {
                    clearAlbumTemporalFilter();
                  } else {
                    albumFilters = handlePhotosRemoveFilter(albumFilters, type, id);
                  }
                }}
                onClearAll={() => {
                  albumFilters = clearFilters(albumFilters);
                  temporalAnchor = undefined;
                }}
              />
            {/snippet}
            <FilterToolbar
              class="mb-2"
              grouping={timelineGrouping}
              onGroupingChange={handleTimelineGroupingChange}
              showGrouping={isBrowseTimeline && !assetMultiSelectManager.selectionActive}
              showFilters={getActiveFilterCount(albumFilters) > 0}
              filters={albumFiltersBar}
            />
          {/if}
```

Add `import FilterToolbar from '$lib/components/filter-panel/filter-toolbar.svelte';` to the imports.

> The browse toolbar renders whenever browse mode is active and either grouping is visible or album filters exist (`FilterToolbar` self-hides when both are false), so the `{:else if viewMode !== SELECT_ASSETS}` branch is safe. The picker bar (`SELECT_ASSETS`) keeps no grouping and stays a standalone `ActiveFiltersBar`.

- [ ] **Step 4: Run — new assertion GREEN, structural ones may go RED**

Run: `cd web && pnpm test -- --run "src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts"`
Expected: the Step 2 test PASSES; assertions that pinned the old separate grouping div / DOM nesting go RED.

- [ ] **Step 5: Update the now-stale assertions**

Switch grouping assertions to `getByTestId('timeline-desktop-grouping-control')` and bar assertions to `getByTestId('active-filters-bar')`. Preserve present/absent intent for picker (bar, no grouping) vs browse (toolbar with both).

- [ ] **Step 6: Run again to verify all pass**

Run: `cd web && pnpm test -- --run "src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte" "web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts"
git commit -m "feat(web): merge grouping + filters toolbar on albums browse view"
```

---

### Task 7: Map — restore a readable backdrop for the floating bar

The map main page floats `ActiveFiltersBar` over the map (`absolute inset-x-0 top-0 z-10`) and has **no grouping control** there, so it stays a standalone bar (not merged). The restyle made the bar transparent; over map tiles it is now unreadable. Give its wrapper a backdrop. (The map's _panel_ grouping+temporal bar is already merged via Task 3's `MapTimelinePanel` → `TimelineRouteGroupingBar`.)

**Files:**

- Modify: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte` (~282–298)
- Test: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts`

- [ ] **Step 1: Add a backdrop to the floating wrapper**

Change the wrapper div:

```svelte
          <div class="absolute inset-x-0 top-0 z-10">
```

to:

```svelte
          <div class="absolute inset-x-0 top-0 z-10 bg-light/95 backdrop-blur-sm">
```

(Leave the `ActiveFiltersBar` invocation unchanged — it keeps its standalone band/hairline; the wrapper now supplies an opaque-enough backing over the map.)

- [ ] **Step 2: Run the map page test**

Run: `cd web && pnpm test -- --run "src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts"`
Expected: PASS (this is a class-only change; no behavioral assertion should break).

- [ ] **Step 3: Manual visual check (no green checkmark — verify by eye)**

With `make dev` running, open `/map`, apply a location/country filter, and confirm the chip bar is legible over the map tiles in both light and dark themes.

- [ ] **Step 4: Commit**

```bash
git add "web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte"
git commit -m "fix(web): keep map floating filter bar readable with a backdrop"
```

---

### Task 8: Final verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full web type + svelte check**

Run: `make check-web`
Expected: 0 errors. (If `svelte-check` reports `0 FILES`, run `cd web && pnpm svelte-kit sync` first, then re-run.)

- [ ] **Step 2: Full web unit tests**

Run: `cd web && pnpm test -- --run`
Expected: all test files pass (3151+ tests). The `ECONNREFUSED :3000` lines from an unrelated suite are pre-existing noise, not failures.

- [ ] **Step 3: Lint (deferred full pass)**

Run: `make lint-web`
Expected: 0 warnings/errors. Fix any and re-run.

- [ ] **Step 4: Manual cross-route visual sweep (verify by eye, not CI)**

With `make dev`, confirm the single merged toolbar on: photos, albums (browse), spaces, and a `TimelineRouteGroupingBar` route (e.g. favorites — grouping-only, desktop). Toggle the OS "Reduce motion" setting and a narrow (mobile) viewport: the grouping pill disappears below `md`, the chip bar still shows on mobile, and "Clear all" sits at the right edge.

- [ ] **Step 5: Final commit (if any lint/format fixes were made)**

```bash
git add -A
git commit -m "chore(web): lint + format pass for merged filter toolbar"
```

---

## Self-Review

**Spec coverage:**

- Merge grouping + filters into one row → Tasks 2 (primitive), 3–6 (consumers). ✓
- "Everywhere" scope → Task 3 covers the ~9 `TimelineRouteGroupingBar` routes; Tasks 4–6 cover the 3 hand-composed routes; Task 7 covers the map. ✓
- Count leads chips, Clear all far right → delivered by the already-applied `ActiveFiltersBar` restyle + embedded `flex-1` (clear-all `ml-auto`). ✓
- Mobile contract (filters bar visible on mobile, grouping desktop-only) → `FilterToolbar` container is `flex` when `showFilters`, grouping wrapper is `hidden md:flex`. ✓
- Map transparency regression → Task 7. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N"; every code step shows full code. The route-spec update steps say exactly which selector to switch (`*-spacing` → `active-filters-bar` / `timeline-desktop-grouping-control`). ✓

**Type consistency:** `FilterToolbar` prop names (`showGrouping`, `showFilters`, `groupingDisabled`, `filters` snippet) are used identically in Tasks 3–6. `ActiveFiltersBar` `embedded` (Task 1) is passed in Tasks 3–6. `TimelineGrouping` type imported from `$lib/managers/timeline-manager/types` (matches `TimelineGroupingControl`). ✓

**Codebase verification (done before finalizing):** every identifier used in the route-migration code (Tasks 4–6) was grepped in its `+page.svelte` and confirmed, with line numbers cited in each task — notably photos uses `committedQuery` (not `committedSearchQuery`) and `hasActiveFilters` (`:340`); spaces uses `committedSearchQuery`/`handleRemoveFilter`; albums' `isBrowseTimeline === VIEW` (`:335`) guarantees the picker/browse branches are mutually exclusive. `createRawSnippet` (Task 2 test) and `rerender` both have suite precedent. ✓

**TDD / test-API correctness:** Task 1's embedded test uses two `render` calls (not the `rerender` promise) to avoid a duplicate-testid clash. Task 2 adds two responsive-contract cases (mobile-visible-with-filters, desktop-only-when-grouping-only) — the merge's only runtime-only failure mode. Task 3 is a refactor guarded by the existing `TimelineRouteGroupingBar.spec.ts`, which stays green because `FilterToolbar` carries `bg-transparent` and preserves the `timeline-desktop-grouping-control` testid + `hasActiveTemporalFilters` gating (assertions at `:16,:23–33,:54–73,:76–95,:98–112` all hold). Tasks 4–6 each start with a green baseline, then a test-first RED assertion (old `*-spacing` wrapper gone / grouping+bar share the toolbar row) before the markup change. ✓

**Open follow-up (out of scope, noted):** if `MapTimelinePanel`'s temporal bar should show on mobile, drop the `hidden md:flex` passed from `TimelineRouteGroupingBar` — left for a separate change.
