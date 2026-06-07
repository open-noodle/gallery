# Timeline Zoom Navigation Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the main Photos web timeline so year/month bucket activation zooms grouping and anchor only, without creating or clearing temporal filters.

**Architecture:** Reuse the Slice 1 `getTimelineBucketZoomTarget()` helper in the Photos route handler. Keep `FilterState`, active filter chips, and URL sync owned by the filter panel and active filter bar paths; bucket-card activation only sets route-local `timelineGrouping` and `temporalAnchor`.

**Tech Stack:** SvelteKit, Svelte 5 runes, TypeScript, Vitest, Testing Library.

---

### Task 1: Add Photos Zoom Behavior Tests

**Files:**

- Modify: `web/src/test-data/mocks/bindable-filter-panel.stub.svelte`
- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts`

- [ ] **Step 1: Add explicit temporal-filter controls to the filter-panel test stub**

In `web/src/test-data/mocks/bindable-filter-panel.stub.svelte`, add these buttons after the existing `filter-panel-clear-timeline` button and before `filter-panel-set-custom-range`:

```svelte
  <button
    type="button"
    data-testid="filter-panel-set-year"
    onclick={() => {
      if (filters) {
        updateFilters({
          ...filters,
          dateAfter: undefined,
          dateBefore: undefined,
          selectedYear: 2015,
          selectedMonth: undefined,
        });
      }
    }}
  >
    Set year
  </button>
  <button
    type="button"
    data-testid="filter-panel-set-month"
    onclick={() => {
      if (filters) {
        updateFilters({
          ...filters,
          dateAfter: undefined,
          dateBefore: undefined,
          selectedYear: 2015,
          selectedMonth: 8,
        });
      }
    }}
  >
    Set month
  </button>
```

These buttons model explicit filter-panel timeline selection. They are test support only; do not use bucket activation to create explicit temporal filters in the Photos tests.

- [ ] **Step 2: Replace the Photos year bucket test with zoom-only expectations**

In `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts`, replace the test named `clicking a photos year bucket sets temporal filter state, switches to month grouping, and keeps non-time filters` with:

```ts
it('clicking a photos year bucket zooms to month grouping without mutating filters', async () => {
  mockPage.url = new URL('https://gallery.test/photos?people=person-1&city=Berlin');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
    expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-month', '');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
  });
  expect(buildPhotosTimelineOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({
      personIds: ['person-1'],
      city: 'Berlin',
      selectedYear: undefined,
      selectedMonth: undefined,
      dateAfter: undefined,
      dateBefore: undefined,
    }),
  );
  expect(goto).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Replace the Photos month bucket test with zoom-only expectations**

Replace the test named `clicking a photos month bucket sets month temporal state and switches to day grouping` with:

```ts
it('clicking a photos month bucket zooms to day grouping without mutating filters', async () => {
  mockPage.url = new URL('https://gallery.test/photos?people=person-1');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-month-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
    expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-month', '');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015,"month":8}');
  });
  expect(buildPhotosTimelineOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({
      personIds: ['person-1'],
      selectedYear: undefined,
      selectedMonth: undefined,
      dateAfter: undefined,
      dateBefore: undefined,
    }),
  );
  expect(goto).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Replace the transient temporal URL sync test with explicit filter-panel temporal state**

Replace the test named `keeps photos temporal state transient across URL sync for non-time filter changes` with:

```ts
it('keeps explicit photos temporal filters transient across URL sync for non-time filter changes', async () => {
  mockPage.url = new URL('https://gallery.test/photos');

  renderPage();
  await fireEvent.click(screen.getByTestId('filter-panel-set-year'));
  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015');
    expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-year', '2015');
  });

  await fireEvent.click(screen.getByTestId('filter-panel-set-country'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
  expect(buildPhotosTimelineOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({
      country: 'Germany',
      selectedYear: 2015,
      selectedMonth: undefined,
    }),
  );
  expect(goto).toHaveBeenLastCalledWith('/photos?country=Germany', {
    replaceState: true,
    keepFocus: true,
    noScroll: true,
  });
});
```

- [ ] **Step 5: Replace the custom date override test with explicit date-filter regression coverage**

Replace the test named `lets custom photos date range override selected timeline year state` with:

```ts
it('lets an explicit custom photos date range filter apply and clear a pending zoom anchor', async () => {
  mockPage.url = new URL('https://gallery.test/photos?people=person-1');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));
  await waitFor(() => expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}'));

  await fireEvent.click(screen.getByTestId('filter-panel-set-custom-range'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-date-after', '2024-01-01');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-date-before', '2024-12-31');
    expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-date-after', '2024-01-01');
    expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-date-before', '2024-12-31');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
  expect(buildPhotosTimelineOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({
      personIds: ['person-1'],
      dateAfter: '2024-01-01',
      dateBefore: '2024-12-31',
      selectedYear: undefined,
      selectedMonth: undefined,
    }),
  );
  expect(goto).toHaveBeenLastCalledWith('/photos?people=person-1&from=2024-01-01&to=2024-12-31', {
    replaceState: true,
    keepFocus: true,
    noScroll: true,
  });
});
```

- [ ] **Step 6: Replace the temporal chip clearing test so it uses an explicit filter**

Replace the test named `clearing the photos temporal chip keeps non-time filters and the current grouping` with:

```ts
it('clearing an explicit photos temporal chip keeps non-time filters and the current grouping', async () => {
  mockPage.url = new URL('https://gallery.test/photos?people=person-1');

  renderPage();
  await fireEvent.click(await screen.findByTestId('timeline-grouping-month'));
  await fireEvent.click(screen.getByTestId('filter-panel-set-year'));
  await fireEvent.click(await screen.findByTestId('active-filters-remove-timeline'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
  expect(buildPhotosTimelineOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({
      personIds: ['person-1'],
      selectedYear: undefined,
      selectedMonth: undefined,
    }),
  );
});
```

- [ ] **Step 7: Replace the custom date bucket test so bucket activation preserves explicit date filters**

Replace the test named `clicking a photos bucket clears custom date state before applying selected year` with:

```ts
it('clicking a photos bucket preserves an existing explicit custom date filter', async () => {
  mockPage.url = new URL('https://gallery.test/photos?from=2024-01-01&to=2024-12-31&tags=tag-1');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-date-after', '2024-01-01');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-date-before', '2024-12-31');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-date-after', '2024-01-01');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
  });
  expect(buildPhotosTimelineOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({
      tagIds: ['tag-1'],
      dateAfter: '2024-01-01',
      dateBefore: '2024-12-31',
      selectedYear: undefined,
      selectedMonth: undefined,
    }),
  );
  expect(goto).not.toHaveBeenCalled();
});
```

- [ ] **Step 8: Add coverage that bucket activation creates no active filter bar by itself**

Add this test after the month bucket test:

```ts
it('does not show active filter chips when a photos bucket is activated without filters', async () => {
  mockPage.url = new URL('https://gallery.test/photos');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
  });
  expect(screen.queryByTestId('active-filters-bar-stub')).not.toBeInTheDocument();
  expect(goto).not.toHaveBeenCalled();
});
```

- [ ] **Step 9: Add coverage that Photos ignores bucket activation in selection mode**

Add this test near the existing selection-mode grouping-control test:

```ts
it('ignores photos bucket activation while selection mode is active', async () => {
  mockPage.url = new URL('https://gallery.test/photos');
  mockAssetMultiSelectManager.selectionActive = true;

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
  });
  expect(goto).not.toHaveBeenCalled();
});
```

- [ ] **Step 10: Run the focused Photos test and verify RED**

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts'
```

Expected: FAIL before production implementation because `handleTimelineBucketActivate()` still calls `activateTimelineBucket()`.

Expected red failures include these assertions:

```text
Expected element to have attribute:
  data-selected-year=""
Received:
  data-selected-year="2015"
```

and:

```text
expected "...\"grouping\":\"day\"..." to contain "\"grouping\":\"month\""
```

The explicit filter-panel tests may already pass before production changes. The required red signal is that bucket activation still mutates filter state and selection-mode activation is not ignored.

### Task 2: Convert Photos Bucket Activation To Zoom-Only

**Files:**

- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`

- [ ] **Step 1: Replace the legacy helper import**

In `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`, replace this import:

```ts
import {
  activateTimelineBucket,
  type ActivatableTimelineBucket,
  getTimelineManagerTimeBuckets,
} from '$lib/utils/timeline-filter-navigation';
```

with:

```ts
import {
  getTimelineBucketZoomTarget,
  type ActivatableTimelineBucket,
  getTimelineManagerTimeBuckets,
} from '$lib/utils/timeline-filter-navigation';
```

- [ ] **Step 2: Make the handler mutate grouping and anchor only**

Replace `handleTimelineBucketActivate()` with:

```ts
function handleTimelineBucketActivate(bucket: ActivatableTimelineBucket) {
  if (assetMultiSelectManager.selectionActive) {
    return;
  }

  const result = getTimelineBucketZoomTarget(bucket);
  if (!result) {
    return;
  }

  timelineGrouping = result.grouping;
  temporalAnchor = result.anchor;
}
```

Do not assign `filters` in this handler. Do not call `syncFilterUrl()` in this handler. Do not remove `syncFilterUrl()` or `pendingFilterUrlSync`; explicit filter-panel temporal selections still use that path.

- [ ] **Step 3: Run the focused Photos test and verify GREEN**

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts'
```

Expected: PASS, all Photos page tests pass.

### Task 3: Run Neighboring Regression Tests

**Files:**

- Verify: `web/src/lib/utils/__tests__/timeline-filter-navigation.spec.ts`
- Verify: `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts`
- Verify: `web/src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts`
- Verify: `web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`

- [ ] **Step 1: Re-run the shared helper tests**

Run:

```bash
pnpm --dir web test --run src/lib/utils/__tests__/timeline-filter-navigation.spec.ts
```

Expected: PASS. This confirms Slice 1 helper behavior still holds and the legacy helper remains available for unmigrated routes.

- [ ] **Step 2: Run filter-panel temporal regression tests**

Run:

```bash
pnpm --dir web test --run src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts src/lib/components/filter-panel/__tests__/filter-panel.spec.ts
```

Expected: PASS. This confirms explicit year/month/date filters still create chips and remain clearable outside bucket activation.

- [ ] **Step 3: Run TypeScript verification**

Run:

```bash
pnpm --dir open-api/typescript-sdk build
pnpm --dir web check:typescript
```

Expected: both commands PASS with no TypeScript errors.

- [ ] **Step 4: Confirm Slice 2 scope**

Run:

```bash
git diff --stat
git diff --name-only
```

Expected changed files only:

```text
web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte
web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts
web/src/test-data/mocks/bindable-filter-panel.stub.svelte
```

The Slice 2 plan file should already be committed before implementation starts. No album, space, route-family, GalleryViewer, mobile, label/copy, or documentation changes belong in Slice 2.

- [ ] **Step 5: Commit Slice 2**

Run:

```bash
git add web/src/routes/\(user\)/photos/\[\[assetId=id\]\]/+page.svelte \
  web/src/routes/\(user\)/photos/\[\[assetId=id\]\]/photos-page.spec.ts \
  web/src/test-data/mocks/bindable-filter-panel.stub.svelte
git commit -m "feat(web): zoom photos timeline buckets without filtering"
```

Expected: one commit containing only the Photos route change, Photos tests, and Photos test-stub support.
