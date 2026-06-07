# Timeline Zoom Navigation Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert web query-backed timeline routes from filter-drilldown bucket activation to zoom-only bucket activation.

**Architecture:** Keep each route's existing grouping state, temporal anchor state, route-owned base options, and explicit temporal-filter clearing path. Replace only bucket-card activation with `getTimelineBucketZoomTarget()`, so activation sets grouping and anchor but never assigns temporal filters, never creates a chip, and never syncs URL state.

**Tech Stack:** SvelteKit, Svelte 5 runes, TypeScript, Vitest, Testing Library.

---

### Task 1: Simple Query Routes

**Files:**

- Modify: `web/src/routes/(user)/favorites/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/favorites/[[photos=photos]]/[[assetId=id]]/favorites-page.spec.ts`
- Modify: `web/src/routes/(user)/archive/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/archive/[[photos=photos]]/[[assetId=id]]/archive-page.spec.ts`
- Modify: `web/src/routes/(user)/locked/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/locked/[[photos=photos]]/[[assetId=id]]/locked-page.spec.ts`
- Modify: `web/src/routes/(user)/trash/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/trash/[[photos=photos]]/[[assetId=id]]/trash-page.spec.ts`
- Modify: `web/src/routes/(user)/partners/[userId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/partners/[userId]/[[photos=photos]]/[[assetId=id]]/partner-page.spec.ts`
- Modify: `web/src/routes/(user)/tags/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/tags/[[photos=photos]]/[[assetId=id]]/tags-page.spec.ts`

- [ ] **Step 1: Write failing tests for simple route bucket activation**

Update each route's bucket activation test so it asserts route-owned constraints, grouping, anchor, and absence of temporal chips or temporal option ranges.

In `favorites-page.spec.ts`, replace `year and month buckets keep favorite options and show temporal chips` with:

```ts
it('year and month buckets keep favorite options without temporal chips', async () => {
  renderPage();

  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"isFavorite":true');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenBefore"');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
  });

  await fireEvent.click(screen.getByTestId('activate-month-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"isFavorite":true');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenBefore"');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015,"month":8}');
  });
});
```

In `archive-page.spec.ts`, replace `year and month buckets keep archive options and show temporal chips` with the same structure, using these route-owned assertions:

```ts
expect(screen.getByTestId('timeline-options')).toHaveTextContent('"visibility":"archive"');
```

In `locked-page.spec.ts`, replace `year and month buckets keep locked options and show temporal chips` with the same structure, using:

```ts
expect(screen.getByTestId('timeline-options')).toHaveTextContent('"visibility":"locked"');
```

In `trash-page.spec.ts`, replace `year and month buckets keep trash options and show temporal chips` with the same structure, using:

```ts
expect(screen.getByTestId('timeline-options')).toHaveTextContent('"isTrashed":true');
```

In `partner-page.spec.ts`, replace `year and month buckets keep partner options and show temporal chips` with the same structure, using:

```ts
expect(screen.getByTestId('timeline-options')).toHaveTextContent('"userId":"partner-user-id"');
```

In `tags-page.spec.ts`, replace `year bucket activation keeps tag scope, switches grouping to month, and shows clearable temporal chip` with:

```ts
it('year bucket activation keeps tag scope and zooms without temporal chips', async () => {
  renderPage({ tags: [makeTag({ id: 'tag-with-assets', value: 'Trips' })] });

  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"tagId":"tag-with-assets"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenBefore"');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
  });
});
```

- [ ] **Step 2: Replace result-count and clear-chip tests that depended on bucket-created temporal filters**

For `favorites-page.spec.ts`, `archive-page.spec.ts`, `locked-page.spec.ts`, `trash-page.spec.ts`, and `partner-page.spec.ts`, replace `singular temporal result count shows 1 result` with:

```ts
it('bucket activation does not render a temporal result count chip', async () => {
  renderPage();

  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
  });
  expect(screen.queryByTestId('result-count')).not.toBeInTheDocument();
  expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
});
```

In `tags-page.spec.ts`, replace `clearing temporal chip preserves grouping and removes ActiveFiltersBar` with:

```ts
it('bucket activation keeps tag scope without rendering ActiveFiltersBar', async () => {
  renderPage({ tags: [makeTag({ id: 'tag-with-assets', value: 'Trips' })] });

  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"tagId":"tag-with-assets"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
  });
});
```

- [ ] **Step 3: Add selection-mode bucket guard tests**

Add this test near each existing selection-mode grouping-control test in `favorites-page.spec.ts`, `archive-page.spec.ts`, `locked-page.spec.ts`, `trash-page.spec.ts`, `partner-page.spec.ts`, and `tags-page.spec.ts`:

```ts
it('ignores bucket activation while selection mode is active', async () => {
  mockAssetMultiSelectManager.selectionActive = true;

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
  expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
});
```

For `tags-page.spec.ts`, call:

```ts
renderPage({ tags: [makeTag({ id: 'tag-with-assets', value: 'Trips' })] });
```

instead of bare `renderPage()`.

- [ ] **Step 4: Run focused simple-route tests and verify RED**

Run:

```bash
pnpm --dir web test --run \
  'src/routes/(user)/favorites/[[photos=photos]]/[[assetId=id]]/favorites-page.spec.ts' \
  'src/routes/(user)/archive/[[photos=photos]]/[[assetId=id]]/archive-page.spec.ts' \
  'src/routes/(user)/locked/[[photos=photos]]/[[assetId=id]]/locked-page.spec.ts' \
  'src/routes/(user)/trash/[[photos=photos]]/[[assetId=id]]/trash-page.spec.ts' \
  'src/routes/(user)/partners/[userId]/[[photos=photos]]/[[assetId=id]]/partner-page.spec.ts' \
  'src/routes/(user)/tags/[[photos=photos]]/[[assetId=id]]/tags-page.spec.ts'
```

Expected: FAIL before production changes because bucket activation still calls `activateTimelineBucket()`, creates temporal filters, renders temporal chips, adds `takenAfter`/`takenBefore`, and is not guarded in selection mode.

- [ ] **Step 5: Convert simple route handlers to zoom-only**

In each of these route files:

```text
web/src/routes/(user)/favorites/[[photos=photos]]/[[assetId=id]]/+page.svelte
web/src/routes/(user)/archive/[[photos=photos]]/[[assetId=id]]/+page.svelte
web/src/routes/(user)/locked/[[photos=photos]]/[[assetId=id]]/+page.svelte
web/src/routes/(user)/trash/[[photos=photos]]/[[assetId=id]]/+page.svelte
web/src/routes/(user)/partners/[userId]/[[photos=photos]]/[[assetId=id]]/+page.svelte
web/src/routes/(user)/tags/[[photos=photos]]/[[assetId=id]]/+page.svelte
```

replace the timeline helper import:

```ts
import {
  activateTimelineBucket,
  clearTimelineTemporalFilter,
  type ActivatableTimelineBucket,
} from '$lib/utils/timeline-filter-navigation';
```

with:

```ts
import {
  clearTimelineTemporalFilter,
  getTimelineBucketZoomTarget,
  type ActivatableTimelineBucket,
} from '$lib/utils/timeline-filter-navigation';
```

Replace each simple route `handleTimelineBucketActivate()` with:

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

Do not assign `timelineFilters` in bucket activation. Do not remove `clearRouteTemporalFilter()`; it remains the explicit temporal-filter clearing path for temporal filters set outside bucket activation.

- [ ] **Step 6: Run focused simple-route tests and verify GREEN**

Run the same command from Step 4.

Expected: PASS for all six simple-route spec files.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add \
  web/src/routes/\(user\)/favorites/\[\[photos=photos\]\]/\[\[assetId=id\]\]/+page.svelte \
  web/src/routes/\(user\)/favorites/\[\[photos=photos\]\]/\[\[assetId=id\]\]/favorites-page.spec.ts \
  web/src/routes/\(user\)/archive/\[\[photos=photos\]\]/\[\[assetId=id\]\]/+page.svelte \
  web/src/routes/\(user\)/archive/\[\[photos=photos\]\]/\[\[assetId=id\]\]/archive-page.spec.ts \
  web/src/routes/\(user\)/locked/\[\[photos=photos\]\]/\[\[assetId=id\]\]/+page.svelte \
  web/src/routes/\(user\)/locked/\[\[photos=photos\]\]/\[\[assetId=id\]\]/locked-page.spec.ts \
  web/src/routes/\(user\)/trash/\[\[photos=photos\]\]/\[\[assetId=id\]\]/+page.svelte \
  web/src/routes/\(user\)/trash/\[\[photos=photos\]\]/\[\[assetId=id\]\]/trash-page.spec.ts \
  web/src/routes/\(user\)/partners/\[userId\]/\[\[photos=photos\]\]/\[\[assetId=id\]\]/+page.svelte \
  web/src/routes/\(user\)/partners/\[userId\]/\[\[photos=photos\]\]/\[\[assetId=id\]\]/partner-page.spec.ts \
  web/src/routes/\(user\)/tags/\[\[photos=photos\]\]/\[\[assetId=id\]\]/+page.svelte \
  web/src/routes/\(user\)/tags/\[\[photos=photos\]\]/\[\[assetId=id\]\]/tags-page.spec.ts
git commit -m "feat(web): zoom scoped timeline buckets without filtering"
```

Expected: one commit scoped to simple query routes and their tests.

### Task 2: Person Query Routes

**Files:**

- Modify: `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts`

- [ ] **Step 1: Write failing person-route tests**

In `person-detail-page.spec.ts`, replace `activating person year and month buckets preserves person scope and sets temporal chips and anchors` with:

```ts
it('activating person year and month buckets preserves person scope without temporal chips', async () => {
  renderPage();

  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));
  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"personIds":["person-1"]');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenBefore"');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
  });

  await fireEvent.click(screen.getByTestId('activate-month-bucket'));
  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"personIds":["person-1"]');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenBefore"');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015,"month":8}');
  });
});
```

Replace `clearing the person temporal chip preserves person scope and current grouping` with:

```ts
it('person bucket activation keeps scope without rendering ActiveFiltersBar', async () => {
  renderPage();

  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"personIds":["person-1"]');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"withSharedSpaces":true');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
  });
});
```

Add this test near the existing selection-mode grouping-control test:

```ts
it('ignores person bucket activation while selection mode is active', async () => {
  mockAssetMultiSelectManager.selectionActive = true;

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
  expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
});
```

In `space-person-detail-page.spec.ts`, replace `activating space person year and month buckets preserves scope and sets temporal chips and anchors` with:

```ts
it('activating space person year and month buckets preserves scope without temporal chips', async () => {
  renderPage();

  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));
  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"spaceId":"space-1"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"spacePersonId":"person-1"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"withStacked":true');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenBefore"');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
  });

  await fireEvent.click(screen.getByTestId('activate-month-bucket'));
  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"spaceId":"space-1"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"spacePersonId":"person-1"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"withStacked":true');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenBefore"');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015,"month":8}');
  });
});
```

Replace `clearing the space person temporal chip preserves scope and current grouping` with:

```ts
it('space person bucket activation keeps scope without rendering ActiveFiltersBar', async () => {
  renderPage();

  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"spaceId":"space-1"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"spacePersonId":"person-1"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"withStacked":true');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
  });
});
```

Add this test near the existing selection-mode grouping-control test:

```ts
it('ignores space person bucket activation while selection mode is active', async () => {
  mockAssetMultiSelectManager.selectionActive = true;

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
  expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused person-route tests and verify RED**

Run:

```bash
pnpm --dir web test --run \
  'src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts' \
  'src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts'
```

Expected: FAIL because bucket activation still creates temporal filters/chips and selection-mode activation is not guarded.

- [ ] **Step 3: Convert person route handlers to zoom-only**

In both person route files, replace:

```ts
import {
  activateTimelineBucket,
  clearTimelineTemporalFilter,
  type ActivatableTimelineBucket,
} from '$lib/utils/timeline-filter-navigation';
```

with:

```ts
import {
  clearTimelineTemporalFilter,
  getTimelineBucketZoomTarget,
  type ActivatableTimelineBucket,
} from '$lib/utils/timeline-filter-navigation';
```

Replace `handleTimelineBucketActivate()` in both files with:

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

Do not assign `timelineFilters` in bucket activation. Keep `clearPersonTemporalFilter()` and `clearSpacePersonTemporalFilter()` unchanged for explicit temporal filters.

- [ ] **Step 4: Run focused person-route tests and verify GREEN**

Run the same command from Step 2.

Expected: PASS for both person route spec files.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add \
  web/src/routes/\(user\)/people/\[personId\]/\[\[photos=photos\]\]/\[\[assetId=id\]\]/+page.svelte \
  web/src/routes/\(user\)/people/\[personId\]/\[\[photos=photos\]\]/\[\[assetId=id\]\]/person-detail-page.spec.ts \
  web/src/routes/\(user\)/spaces/\[spaceId\]/people/\[personId\]/\[\[photos=photos\]\]/\[\[assetId=id\]\]/+page.svelte \
  web/src/routes/\(user\)/spaces/\[spaceId\]/people/\[personId\]/\[\[photos=photos\]\]/\[\[assetId=id\]\]/space-person-detail-page.spec.ts
git commit -m "feat(web): zoom person timeline buckets without filtering"
```

Expected: one commit scoped to person query routes and tests.

### Task 3: Album, Space, And Map Query Routes

**Files:**

- Modify: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts`
- Modify: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/MapTimelinePanel.svelte`
- Modify: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-timeline-panel.spec.ts`

- [ ] **Step 1: Write failing Album tests**

In `page.route.spec.ts`, replace `clicking album year and month buckets syncs the album FilterPanel temporal state` with:

```ts
it('clicking album year and month buckets zooms without temporal chips', async () => {
  renderPage();
  const user = userEvent.setup();

  await user.click(screen.getByTestId('activate-year-bucket'));
  await waitFor(() => expect(screen.getByTestId('timeline-options').textContent).toContain('"grouping":"month"'));
  expect(screen.getByTestId('timeline-options').textContent).toContain('"timelineAlbumId"');
  expect(screen.getByTestId('timeline-options').textContent).not.toContain('"takenAfter"');
  expect(screen.getByTestId('timeline-options').textContent).not.toContain('"takenBefore"');
  expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  expect(screen.getByTestId('timeline-anchor')).toHaveTextContent(JSON.stringify({ year: 2015 }));

  await user.click(screen.getByTestId('activate-month-bucket'));
  await waitFor(() => expect(screen.getByTestId('timeline-options').textContent).toContain('"grouping":"day"'));
  expect(screen.getByTestId('timeline-options').textContent).toContain('"timelineAlbumId"');
  expect(screen.getByTestId('timeline-options').textContent).not.toContain('"takenAfter"');
  expect(screen.getByTestId('timeline-options').textContent).not.toContain('"takenBefore"');
  expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  expect(screen.getByTestId('timeline-anchor')).toHaveTextContent(JSON.stringify({ year: 2015, month: 8 }));
});
```

Replace `clears album temporal chips while preserving non-time album filters and grouping` with:

```ts
it('album bucket activation preserves non-time album filters without adding temporal chips', async () => {
  renderPage();
  const user = userEvent.setup();

  await waitFor(() => expect(screen.getByTestId('people-item-person-view')).toBeInTheDocument());
  await user.click(screen.getByTestId('people-item-person-view'));
  await user.click(screen.getByTestId('activate-year-bucket'));

  await waitFor(() => expect(screen.getByTestId('timeline-options').textContent).toContain('"grouping":"month"'));
  expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('Album Person');
  expect(screen.getByTestId('active-filters-bar')).not.toHaveTextContent('2015');
  expect(screen.getByTestId('timeline-options').textContent).toContain('"timelineAlbumId"');
  expect(screen.getByTestId('timeline-options').textContent).not.toContain('"takenAfter"');
  expect(screen.getByTestId('timeline-options').textContent).not.toContain('"takenBefore"');
  expect(screen.getByTestId('timeline-anchor')).toHaveTextContent(JSON.stringify({ year: 2015 }));
});
```

Add this explicit temporal filter regression after the bucket activation tests:

```ts
it('explicit album timeline filters still show chips and clear without changing grouping', async () => {
  renderPage();
  const user = userEvent.setup();

  await user.click(await screen.findByTestId('timeline-grouping-month'));
  await user.click(await screen.findByTestId('year-btn-2024'));

  await waitFor(() => {
    expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2024');
    expect(screen.getByTestId('timeline-options').textContent).toContain('"takenAfter":"2024-01-01T00:00:00.000Z"');
    expect(screen.getByTestId('timeline-options').textContent).toContain('"takenBefore":"2025-01-01T00:00:00.000Z"');
    expect(screen.getByTestId('timeline-options').textContent).toContain('"grouping":"month"');
  });

  await user.click(screen.getByRole('button', { name: 'Remove 2024 filter' }));

  await waitFor(() => {
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-options').textContent).not.toContain('"takenAfter"');
    expect(screen.getByTestId('timeline-options').textContent).not.toContain('"takenBefore"');
    expect(screen.getByTestId('timeline-options').textContent).toContain('"grouping":"month"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
});
```

If `year-btn-2024` is not initially rendered because the timeline section is collapsed in this test environment, click `section-toggle-timeline` before clicking `year-btn-2024`.

- [ ] **Step 2: Write failing Spaces tests**

In `spaces-page.spec.ts`, replace the two bucket tests with:

```ts
it('clicking a space year bucket zooms without mutating filters or URL state', async () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?people=person-1');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
    expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"spaceId":"space-1"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
  });
  expect(buildSpaceTimelineOptions).toHaveBeenLastCalledWith(
    'space-1',
    expect.objectContaining({
      personIds: ['person-1'],
      selectedYear: undefined,
      selectedMonth: undefined,
      dateAfter: undefined,
      dateBefore: undefined,
    }),
  );
  expect(gotoMock).not.toHaveBeenCalled();
});

it('clicking a space month bucket zooms without mutating filters or URL state', async () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?people=person-1');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-month-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
    expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-month', '');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"spaceId":"space-1"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015,"month":8}');
  });
  expect(buildSpaceTimelineOptions).toHaveBeenLastCalledWith(
    'space-1',
    expect.objectContaining({
      personIds: ['person-1'],
      selectedYear: undefined,
      selectedMonth: undefined,
      dateAfter: undefined,
      dateBefore: undefined,
    }),
  );
  expect(gotoMock).not.toHaveBeenCalled();
});
```

Replace `keeps space temporal state transient across URL sync for non-time filter changes` with:

```ts
it('keeps explicit space temporal filters transient across URL sync for non-time filter changes', async () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

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
  expect(gotoMock).toHaveBeenLastCalledWith('/spaces/space-1/photos?country=Germany', {
    replaceState: true,
    keepFocus: true,
    noScroll: true,
  });
});
```

Replace `lets custom space date range override selected timeline year state` with:

```ts
it('lets explicit custom space date filters apply and clear a pending zoom anchor', async () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

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
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
  expect(buildSpaceTimelineOptions).toHaveBeenLastCalledWith(
    'space-1',
    expect.objectContaining({
      dateAfter: '2024-01-01',
      dateBefore: '2024-12-31',
      selectedYear: undefined,
      selectedMonth: undefined,
    }),
  );
});
```

Replace `clearing the space temporal chip keeps the current grouping and clears the anchor` with:

```ts
it('clearing an explicit space temporal chip keeps the current grouping and clears the anchor', async () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

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
});
```

Add this test near the existing select-assets mode test:

```ts
it('ignores space bucket activation outside view mode', async () => {
  renderPage();

  await fireEvent.click(screen.getByLabelText('add_photos'));
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    const optionsText = screen.getByTestId('timeline-options').textContent ?? '';
    expect(optionsText).not.toContain('"grouping":"month"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
});
```

- [ ] **Step 3: Write failing Map panel tests**

In `map-timeline-panel.spec.ts`, replace `year bucket activation updates panel temporal filters and anchors the map panel` with:

```ts
it('year bucket activation keeps map filters and anchors without temporal filters', async () => {
  renderPanel(createFilterState());

  await fireEvent.click(screen.getByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"assetFilter":{}');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenBefore"');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent(JSON.stringify({ year: 2015 }));
  });
});
```

Replace `month bucket activation switches to day grouping and uses an exclusive month range` with:

```ts
it('month bucket activation keeps map filters and anchors without temporal filters', async () => {
  renderPanel(createFilterState());

  await fireEvent.click(screen.getByTestId('activate-month-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"assetFilter":{}');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenBefore"');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent(JSON.stringify({ year: 2015, month: 8 }));
  });
});
```

Add this explicit temporal filter regression after those tests:

```ts
it('explicit map temporal filters still show chips and clear without changing grouping', async () => {
  renderPanel({ ...createFilterState(), selectedYear: 2015 });

  await waitFor(() => {
    expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2015');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"takenAfter":"2015-01-01T00:00:00.000Z"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"takenBefore":"2016-01-01T00:00:00.000Z"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
  });

  await fireEvent.click(screen.getByRole('button', { name: 'Remove 2015 filter' }));

  await waitFor(() => {
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenBefore"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
});
```

Add this selection-mode guard test:

```ts
it('ignores map bucket activation while selection mode is active', async () => {
  mockAssetMultiSelectManager.selectionActive = true;
  renderPanel(createFilterState());

  await fireEvent.click(screen.getByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
});
```

- [ ] **Step 4: Run focused album/space/map tests and verify RED**

Run:

```bash
pnpm --dir web test --run \
  'src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts' \
  'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts' \
  'src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-timeline-panel.spec.ts'
```

Expected: FAIL because album/space/map bucket activation still writes temporal filters and map/space activation still produces temporal option ranges or URL sync.

- [ ] **Step 5: Convert Album handler to zoom-only**

In `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte`, replace:

```ts
import {
  activateTimelineBucket,
  clearTimelineTemporalFilter,
  type ActivatableTimelineBucket,
  getTimelineManagerTimeBuckets,
} from '$lib/utils/timeline-filter-navigation';
```

with:

```ts
import {
  clearTimelineTemporalFilter,
  getTimelineBucketZoomTarget,
  type ActivatableTimelineBucket,
  getTimelineManagerTimeBuckets,
} from '$lib/utils/timeline-filter-navigation';
```

Replace `handleTimelineBucketActivate()` with:

```ts
function handleTimelineBucketActivate(bucket: ActivatableTimelineBucket) {
  if (!isBrowseTimeline || assetMultiSelectManager.selectionActive) {
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

Do not assign `albumFilters` in bucket activation.

- [ ] **Step 6: Convert Spaces handler to zoom-only**

In `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`, replace the timeline helper import:

```ts
import {
  activateTimelineBucket,
  clearTimelineTemporalFilter,
  type ActivatableTimelineBucket,
  getTimelineManagerTimeBuckets,
} from '$lib/utils/timeline-filter-navigation';
```

with:

```ts
import {
  clearTimelineTemporalFilter,
  getTimelineBucketZoomTarget,
  type ActivatableTimelineBucket,
  getTimelineManagerTimeBuckets,
} from '$lib/utils/timeline-filter-navigation';
```

Normalize optional temporal keys in the initial space filter state, matching the Photos route pattern from Slice 2:

```ts
let filters = $state<FilterState>({
  ...createFilterState(),
  dateAfter: undefined,
  dateBefore: undefined,
  selectedYear: undefined,
  selectedMonth: undefined,
  ...initialFilterState,
  sortOrder: initialSearchState.sortOrder,
});
let filtersBeforePanelChange: FilterState = {
  ...createFilterState(),
  dateAfter: undefined,
  dateBefore: undefined,
  selectedYear: undefined,
  selectedMonth: undefined,
  ...initialFilterState,
  sortOrder: initialSearchState.sortOrder,
};
```

Replace `handleTimelineBucketActivate()` with:

```ts
function handleTimelineBucketActivate(bucket: ActivatableTimelineBucket) {
  if (viewMode !== 'view' || assetMultiSelectManager.selectionActive) {
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

Do not assign `filters` and do not call `syncFilterUrl()` in bucket activation.

- [ ] **Step 7: Convert Map panel handler to zoom-only**

In `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/MapTimelinePanel.svelte`, replace:

```ts
import {
  activateTimelineBucket,
  clearTimelineTemporalFilter,
  type ActivatableTimelineBucket,
} from '$lib/utils/timeline-filter-navigation';
```

with:

```ts
import {
  clearTimelineTemporalFilter,
  getTimelineBucketZoomTarget,
  type ActivatableTimelineBucket,
} from '$lib/utils/timeline-filter-navigation';
```

Replace `handleTimelineBucketActivate` with:

```ts
const handleTimelineBucketActivate = (bucket: ActivatableTimelineBucket) => {
  if (assetMultiSelectManager.selectionActive) {
    return;
  }

  const result = getTimelineBucketZoomTarget(bucket);
  if (!result) {
    return;
  }

  timelineGrouping = result.grouping;
  temporalAnchor = result.anchor;
};
```

Do not assign `filters` in bucket activation.

- [ ] **Step 8: Run focused album/space/map tests and verify GREEN**

Run the same command from Step 4.

Expected: PASS for album, spaces, and map panel specs.

- [ ] **Step 9: Commit Task 3**

Run:

```bash
git add \
  web/src/routes/\(user\)/albums/\[albumId=id\]/\[\[photos=photos\]\]/\[\[assetId=id\]\]/+page.svelte \
  web/src/routes/\(user\)/albums/\[albumId=id\]/\[\[photos=photos\]\]/\[\[assetId=id\]\]/page.route.spec.ts \
  web/src/routes/\(user\)/spaces/\[spaceId\]/\[\[photos=photos\]\]/\[\[assetId=id\]\]/+page.svelte \
  web/src/routes/\(user\)/spaces/\[spaceId\]/\[\[photos=photos\]\]/\[\[assetId=id\]\]/spaces-page.spec.ts \
  web/src/routes/\(user\)/map/\[\[photos=photos\]\]/\[\[assetId=id\]\]/MapTimelinePanel.svelte \
  web/src/routes/\(user\)/map/\[\[photos=photos\]\]/\[\[assetId=id\]\]/map-timeline-panel.spec.ts
git commit -m "feat(web): zoom album space and map timeline buckets"
```

Expected: one commit scoped to album, spaces, map panel, and tests.

### Task 4: Slice 3 Regression Verification

**Files:**

- Verify all Slice 3 modified route files and tests.
- Verify shared helper tests from Slice 1.
- Verify Photos tests from Slice 2.

- [ ] **Step 1: Confirm no web query route still calls legacy filter-drilldown activation**

Run:

```bash
rg -n "activateTimelineBucket\\(" web/src/routes web/src/lib/components/shared-components/gallery-viewer
```

Expected after Slice 3: the only non-test production call site should be GalleryViewer:

```text
web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.svelte:...
```

The legacy helper and its helper tests may remain until Slice 4, because GalleryViewer has not migrated yet.

- [ ] **Step 2: Run all Slice 3 route tests together**

Run:

```bash
pnpm --dir web test --run \
  'src/routes/(user)/favorites/[[photos=photos]]/[[assetId=id]]/favorites-page.spec.ts' \
  'src/routes/(user)/archive/[[photos=photos]]/[[assetId=id]]/archive-page.spec.ts' \
  'src/routes/(user)/locked/[[photos=photos]]/[[assetId=id]]/locked-page.spec.ts' \
  'src/routes/(user)/trash/[[photos=photos]]/[[assetId=id]]/trash-page.spec.ts' \
  'src/routes/(user)/partners/[userId]/[[photos=photos]]/[[assetId=id]]/partner-page.spec.ts' \
  'src/routes/(user)/tags/[[photos=photos]]/[[assetId=id]]/tags-page.spec.ts' \
  'src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts' \
  'src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts' \
  'src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts' \
  'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts' \
  'src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-timeline-panel.spec.ts'
```

Expected: PASS for all listed route specs.

- [ ] **Step 3: Run neighboring regression tests**

Run:

```bash
pnpm --dir web test --run \
  src/lib/utils/__tests__/timeline-filter-navigation.spec.ts \
  'src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts'
```

Expected: PASS. This confirms Slice 1 helper behavior and Slice 2 Photos behavior still hold.

- [ ] **Step 4: Run TypeScript verification**

Run:

```bash
pnpm --dir open-api/typescript-sdk build
pnpm --dir web check:typescript
```

Expected: both commands PASS with no TypeScript errors.

- [ ] **Step 5: Confirm Slice 3 scope**

Run:

```bash
git diff --stat origin/brainstorm/pr625..HEAD
git diff --name-only origin/brainstorm/pr625..HEAD
```

Expected: relative to `origin/brainstorm/pr625`, the diff includes the already committed Slice 3 plan plus these implementation files:

```text
docs/superpowers/plans/2026-05-25-timeline-zoom-navigation-slice-3.md
web/src/routes/(user)/favorites/[[photos=photos]]/[[assetId=id]]/+page.svelte
web/src/routes/(user)/favorites/[[photos=photos]]/[[assetId=id]]/favorites-page.spec.ts
web/src/routes/(user)/archive/[[photos=photos]]/[[assetId=id]]/+page.svelte
web/src/routes/(user)/archive/[[photos=photos]]/[[assetId=id]]/archive-page.spec.ts
web/src/routes/(user)/locked/[[photos=photos]]/[[assetId=id]]/+page.svelte
web/src/routes/(user)/locked/[[photos=photos]]/[[assetId=id]]/locked-page.spec.ts
web/src/routes/(user)/trash/[[photos=photos]]/[[assetId=id]]/+page.svelte
web/src/routes/(user)/trash/[[photos=photos]]/[[assetId=id]]/trash-page.spec.ts
web/src/routes/(user)/partners/[userId]/[[photos=photos]]/[[assetId=id]]/+page.svelte
web/src/routes/(user)/partners/[userId]/[[photos=photos]]/[[assetId=id]]/partner-page.spec.ts
web/src/routes/(user)/tags/[[photos=photos]]/[[assetId=id]]/+page.svelte
web/src/routes/(user)/tags/[[photos=photos]]/[[assetId=id]]/tags-page.spec.ts
web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte
web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts
web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte
web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts
web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte
web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts
web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte
web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts
web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/MapTimelinePanel.svelte
web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-timeline-panel.spec.ts
```

No GalleryViewer, mobile, label/copy, or extra docs changes belong in Slice 3.
