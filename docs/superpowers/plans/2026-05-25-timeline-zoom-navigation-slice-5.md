# Timeline Zoom Navigation Slice 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the web timeline grouping copy and accessibility semantics so the UI reads as zoom/navigation instead of filtering.

**Architecture:** Keep the internal `TimelineGrouping` enum unchanged (`'day'` still means detailed mode), and change only user-facing labels and screen-reader copy. The shared `TimelineGroupingControl` provides the `Years / Months / All` product labels for desktop, mobile, and coarse-pointer web surfaces. `TimelineBucketCard` owns representative-card screen-reader action copy, while explicit temporal filter chip copy stays in `ActiveFiltersBar`.

**Tech Stack:** Svelte 5, Testing Library Svelte, Vitest, existing timeline components.

---

## Files

- Modify: `web/src/lib/components/timeline/TimelineGroupingControl.svelte`
  - Change the visible day grouping label from `Days` to `All`.
  - Keep the `grouping: 'day'` value, `timeline-grouping-day` test id, and `aria-pressed` state unchanged.
- Modify: `web/src/lib/components/timeline/TimelineGroupingControl.spec.ts`
  - Update and add tests for `Years / Months / All`, internal `day` emission, arrow-key behavior, disabled state, and floating/mobile variant labels.
- Modify: `web/src/lib/components/timeline/Timeline.svelte`
  - No production change expected.
- Modify: `web/src/lib/components/timeline/Timeline.spec.ts`
  - Add coverage for the actual mobile/coarse-pointer grouping control shell using the shared `All` label and preserving `day` grouping.
- Modify: `web/src/lib/components/timeline/TimelineBucketCard.svelte`
  - Add zoom/navigation action text to `aria-label`: year cards announce `show months`, month cards announce `show all photos from this point`.
  - Do not change visual titles/counts or activation payloads.
- Modify: `web/src/lib/components/timeline/TimelineBucketCard.spec.ts`
  - Add tests for zoom-oriented accessible names, no filter wording, keyboard/pointer activation, disabled state, and representative-image failure fallback.
- Modify: `web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts`
  - Assert representative buckets inherit the new card accessible labels.
- Modify: `web/src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts`
  - Assert the desktop grouping bar uses the `All` label while temporal chips remain filter-specific.
- Modify: `web/src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts`
  - Add guard coverage that temporal chip close buttons use filter copy only for explicit temporal filters.
- Optional static-only verification: `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts`
  - Run this suite because GalleryViewer clicks representative bucket cards by accessible name and should keep passing with the expanded aria labels.

## Acceptance Coverage

- Product label is `Years / Months / All`: Task 1 changes the shared grouping control and verifies inline, floating, desktop route bar, and mobile/coarse-pointer timeline surfaces.
- Internal day grouping remains unchanged: Task 1 asserts clicking `All` emits `'day'` and preserves `timeline-grouping-day`.
- Screen-reader labels describe zoom/navigation actions: Task 2 updates `TimelineBucketCard` aria labels and tests year/month copy.
- Active filter chip copy is reserved for real filters: Task 3 keeps filter chip removal copy in `ActiveFiltersBar` and verifies no bucket-card accessible label contains filter wording.
- Tests cover desktop and mobile/coarse-pointer web grouping controls: Task 1 covers `TimelineGroupingControl`, `TimelineRouteGroupingBar`, and the mobile/coarse shell in `Timeline.svelte`.

## Task 1: Rename Detailed Grouping Label To All Across Web Controls

**Files:**

- Modify: `web/src/lib/components/timeline/TimelineGroupingControl.spec.ts`
- Modify: `web/src/lib/components/timeline/Timeline.spec.ts`
- Modify: `web/src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts`
- Modify: `web/src/lib/components/timeline/TimelineGroupingControl.svelte`

- [ ] **Step 1: Write failing grouping-control label tests**

In `web/src/lib/components/timeline/TimelineGroupingControl.spec.ts`, update the first test name and day-label expectation.

Replace:

```ts
it('renders the three grouping modes with the active mode pressed', () => {
```

with:

```ts
it('renders Years, Months, and All with the active mode pressed', () => {
```

Replace:

```ts
expect(screen.getByTestId('timeline-grouping-day')).toHaveTextContent('Days');
```

with:

```ts
expect(screen.getByTestId('timeline-grouping-day')).toHaveTextContent('All');
expect(screen.getByRole('group', { name: 'Timeline grouping' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
```

Add this test after `emits a grouping change when a different mode is clicked`:

```ts
it('keeps the internal day grouping value when the All button is selected', async () => {
  const changes: TimelineGrouping[] = [];
  render(TimelineGroupingControl, {
    props: {
      grouping: 'month',
      onGroupingChange: (grouping: TimelineGrouping) => changes.push(grouping),
    },
  });

  await fireEvent.click(screen.getByRole('button', { name: 'All' }));

  expect(screen.getByTestId('timeline-grouping-day')).toHaveTextContent('All');
  expect(changes).toEqual(['day']);
});
```

Update existing arrow-key tests only where their expected accessible labels or text mention `Days`; the expected grouping values remain `day`.

In `web/src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts`, add this assertion to `renders a desktop grouping control with the active grouping`:

```ts
expect(screen.getByTestId('timeline-grouping-day')).toHaveTextContent('All');
expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
```

- [ ] **Step 2: Add failing mobile/coarse-pointer grouping-control coverage**

In `web/src/lib/components/timeline/Timeline.spec.ts`, update imports.

Replace:

```ts
import { cleanup, render, screen } from '@testing-library/svelte';
```

with:

```ts
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
```

Add this test after `keeps the mobile grouping control in sync with the timeline manager grouping`:

```ts
it('uses the All label in the mobile grouping control on coarse-pointer web devices', async () => {
  const changes: TimelineGrouping[] = [];
  testState.grouping = 'day';
  testState.maxMd = false;
  testState.pointerCoarse = true;

  renderTimeline({
    onGroupingChange: (grouping: TimelineGrouping) => changes.push(grouping),
  });

  const shell = await screen.findByTestId('timeline-mobile-grouping-control-shell');
  expect(within(shell).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(shell).getByTestId('timeline-grouping-day')).toHaveTextContent('All');

  await fireEvent.click(within(shell).getByRole('button', { name: 'Years' }));

  expect(changes).toEqual(['year']);
});
```

Also add this type import near the top of `Timeline.spec.ts`:

```ts
import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
```

- [ ] **Step 3: Run tests and verify the label failures are red**

Run:

```bash
pnpm --dir web exec vitest run src/lib/components/timeline/TimelineGroupingControl.spec.ts src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts src/lib/components/timeline/Timeline.spec.ts -t "All|grouping control|three grouping modes|mobile grouping"
```

Expected red failures before production changes:

- The control tests fail because `timeline-grouping-day` still renders `Days`.
- The mobile/coarse-pointer test fails because no button named `All` exists.
- Emitted grouping values should still be expected as `'day'`; if a test fails because it expects a different enum, fix the test before production changes.

- [ ] **Step 4: Change the shared grouping-control label**

In `web/src/lib/components/timeline/TimelineGroupingControl.svelte`, replace:

```ts
{ grouping: 'day', label: 'Days' },
```

with:

```ts
{ grouping: 'day', label: 'All' },
```

Do not change the `TimelineGrouping` type, data test ids, `selectGrouping()`, or arrow-key behavior.

- [ ] **Step 5: Run grouping-control tests and static label check**

Run:

```bash
pnpm --dir web exec vitest run src/lib/components/timeline/TimelineGroupingControl.spec.ts src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts src/lib/components/timeline/Timeline.spec.ts
```

Expected green result:

- All selected grouping-control tests pass.
- Mobile/coarse-pointer test uses `All` and emits `'year'` when the user taps `Years`.

Run:

```bash
rg -n "\\bDays\\b" web/src/lib/components/timeline web/src/lib/components/shared-components web/src/routes -g "*.svelte" -g "*.spec.ts"
```

Expected static result:

- No remaining grouping-control product label matches.
- Non-grouping words such as `timelineDays` or unrelated admin settings may appear only if the command is broadened beyond the paths above; do not edit unrelated copy.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add web/src/lib/components/timeline/TimelineGroupingControl.svelte web/src/lib/components/timeline/TimelineGroupingControl.spec.ts web/src/lib/components/timeline/Timeline.spec.ts web/src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts
git commit -m "feat(web): label detailed timeline grouping as all"
```

## Task 2: Add Zoom-Oriented Representative Card Accessibility Copy

**Files:**

- Modify: `web/src/lib/components/timeline/TimelineBucketCard.spec.ts`
- Modify: `web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts`
- Modify: `web/src/lib/components/timeline/TimelineBucketCard.svelte`

- [ ] **Step 1: Write failing bucket-card accessibility tests**

In `web/src/lib/components/timeline/TimelineBucketCard.spec.ts`, add this test after `uses a singular count label for one photo`:

```ts
it('announces representative bucket activation as timeline zoom navigation, not filtering', async () => {
  const { rerender } = render(TimelineBucketCard, {
    bucket: makeBucket(),
    onActivate: vi.fn(),
  });

  const yearCard = screen.getByRole('button', { name: '2015, 438 photos, show months' });
  expect(yearCard).toBeInTheDocument();
  expect(yearCard).not.toHaveAccessibleName(/filter/i);

  await rerender({
    bucket: makeBucket({
      grouping: 'month',
      date: { year: 2015, month: 8 },
      timeBucket: '2015-08-01T00:00:00.000Z',
      count: 23,
    }),
    locale: 'en-US',
    onActivate: vi.fn(),
  });

  const monthCard = screen.getByRole('button', {
    name: 'Aug 2015, 23 photos, show all photos from this point',
  });
  expect(monthCard).toBeInTheDocument();
  expect(monthCard).not.toHaveAccessibleName(/filter/i);
});
```

Add this test after `renders fallback without requesting a URL when no representative asset exists`:

```ts
it('keeps the zoom label and activation when a representative image fails', async () => {
  const user = userEvent.setup();
  const onActivate = vi.fn();

  render(TimelineBucketCard, {
    bucket: makeBucket(),
    onActivate,
  });

  await fireEvent.error(screen.getByTestId('timeline-bucket-card-image'));
  await tick();

  const card = screen.getByRole('button', { name: '2015, 438 photos, show months' });
  expect(card).toHaveAttribute('data-state', 'fallback');

  await user.click(card);

  expect(onActivate).toHaveBeenCalledWith({ grouping: 'year', date: { year: 2015 } });
});
```

Update existing role-name assertions in this file only when they need the expanded accessible name. Regex assertions such as `/2015, 438 photos/i` may remain because they still verify the visible title and count.

In `web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts`, add this assertion to `forwards bucket activation payloads` before the click:

```ts
expect(screen.getByRole('button', { name: /2016, .+ photos, show months/i })).toBeInTheDocument();
```

Add this assertion to `passes locale through to month bucket cards`:

```ts
expect(
  screen.getByRole('button', { name: /Aug\\. 2015, 80 photos, show all photos from this point/i }),
).toBeInTheDocument();
```

- [ ] **Step 2: Run tests and verify the accessibility failures are red**

Run:

```bash
pnpm --dir web exec vitest run src/lib/components/timeline/TimelineBucketCard.spec.ts src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts -t "zoom|activation|locale|representative image fails"
```

Expected red failures before production changes:

- The new exact role queries fail because bucket cards only announce period and count.
- Existing activation tests should still pass, confirming the click/keyboard payload contract is not being changed.

- [ ] **Step 3: Add card action labels**

In `web/src/lib/components/timeline/TimelineBucketCard.svelte`, add these derived values after `countLabel`:

```ts
let actionLabel = $derived.by(() => {
  if (bucket.grouping === 'year') {
    return 'show months';
  }

  if (bucket.grouping === 'month') {
    return 'show all photos from this point';
  }
});

let accessibleLabel = $derived(`${title}, ${countLabel}${actionLabel ? `, ${actionLabel}` : ''}`);
```

Replace:

```svelte
aria-label={`${title}, ${countLabel}`}
```

with:

```svelte
aria-label={accessibleLabel}
```

Do not change visual overlay text, thumbnail rendering, disabled state, or `onActivate()` payloads.

- [ ] **Step 4: Run bucket-card tests and verify green**

Run:

```bash
pnpm --dir web exec vitest run src/lib/components/timeline/TimelineBucketCard.spec.ts src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts
```

Expected green result:

- All selected tests pass.
- Year cards announce `show months`.
- Month cards announce `show all photos from this point`.
- No card accessible label contains `filter`.
- Keyboard and pointer activation still pass the original bucket grouping/date payload.

- [ ] **Step 5: Run downstream card consumers**

Run:

```bash
pnpm --dir web exec vitest run src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts src/lib/components/timeline/Timeline.spec.ts
```

Expected green result:

- GalleryViewer tests still find and activate representative cards with their broader accessible names.
- Timeline representative grouping integration still passes.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add web/src/lib/components/timeline/TimelineBucketCard.svelte web/src/lib/components/timeline/TimelineBucketCard.spec.ts web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts
git commit -m "feat(web): announce timeline bucket zoom actions"
```

## Task 3: Guard Explicit Filter Chip Copy And Run Slice Verification

**Files:**

- Modify: `web/src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts`
- Verify: `web/src/lib/components/timeline/TimelineGroupingControl.svelte`
- Verify: `web/src/lib/components/timeline/TimelineBucketCard.svelte`

- [ ] **Step 1: Add explicit temporal filter chip copy guard**

In `web/src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts`, add this test after `should render chip for year+month timeline filter as "Mon YYYY"`:

```ts
it('should reserve filter removal copy for explicit timeline filter chips', () => {
  const filters = createFilterState();
  filters.selectedYear = 2015;
  filters.selectedMonth = 12;

  const { getByTestId } = render(ActiveFiltersBar, {
    props: {
      filters,
      onRemoveFilter: () => {},
      onClearAll: () => {},
    },
  });

  expect(getByTestId('active-chip')).toHaveTextContent('Dec 2015');
  expect(getByTestId('chip-close')).toHaveAttribute('aria-label', 'Remove Dec 2015 filter');
});
```

This is a guard test for existing explicit-filter behavior. If it already passes before code changes, keep it; this task should not change filter panel production code unless the test exposes an actual regression.

- [ ] **Step 2: Run active filter tests**

Run:

```bash
pnpm --dir web exec vitest run src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts -t "timeline filter|filter removal copy"
```

Expected result:

- The new guard should pass with the current filter panel because explicit temporal chips are still filters.
- If it fails, fix `ActiveFiltersBar` only to preserve explicit filter copy; do not make bucket activation create chips.

- [ ] **Step 3: Run static copy checks**

Run:

```bash
rg -n "\\bDays\\b|filter by|selected year|clear year" web/src/lib/components/timeline web/src/lib/components/shared-components web/src/routes -g "*.svelte" -g "*.spec.ts"
```

Expected static result:

- No `Days` label remains in timeline grouping controls or their tests.
- No bucket-activation copy says `filter by`, `selected year`, or `clear year`.
- Matches in filter-panel files are allowed only when they describe explicit filters; this command intentionally excludes filter-panel production files.

- [ ] **Step 4: Run full Slice 5 test set**

Run:

```bash
pnpm --dir web exec vitest run src/lib/components/timeline/TimelineGroupingControl.spec.ts src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts src/lib/components/timeline/Timeline.spec.ts src/lib/components/timeline/TimelineBucketCard.spec.ts src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts
```

Expected green result:

- All selected tests pass.

- [ ] **Step 5: Run format and type checks**

Run:

```bash
pnpm --dir web exec prettier --check src/lib/components/timeline/TimelineGroupingControl.svelte src/lib/components/timeline/TimelineGroupingControl.spec.ts src/lib/components/timeline/Timeline.svelte src/lib/components/timeline/Timeline.spec.ts src/lib/components/timeline/TimelineBucketCard.svelte src/lib/components/timeline/TimelineBucketCard.spec.ts src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts
```

Expected:

- Prettier reports all matched files use Prettier code style.

Run:

```bash
pnpm --dir web check:typescript
pnpm --dir web check:svelte
```

Expected:

- TypeScript and Svelte checks both pass.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add web/src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts
git commit -m "test(web): guard timeline filter chip copy"
```

If Step 5 required formatting changes in files from Tasks 1 or 2, include those files in this commit only if they are formatting-only changes:

```bash
git add web/src/lib/components/timeline/TimelineGroupingControl.spec.ts web/src/lib/components/timeline/Timeline.spec.ts web/src/lib/components/timeline/TimelineBucketCard.spec.ts web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts web/src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts
git commit -m "style(web): format timeline zoom copy tests"
```

Do not create an empty formatting commit if no formatting changes exist.

## Final Slice Verification

- [ ] **Step 1: Verify labels and copy statically**

Run:

```bash
rg -n "\\bDays\\b|filter by|selected year|clear year" web/src/lib/components/timeline web/src/lib/components/shared-components web/src/routes -g "*.svelte" -g "*.spec.ts"
```

Expected:

- No unwanted copy matches in timeline/grouping surfaces.

- [ ] **Step 2: Verify selected tests**

Run:

```bash
pnpm --dir web exec vitest run src/lib/components/timeline/TimelineGroupingControl.spec.ts src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts src/lib/components/timeline/Timeline.spec.ts src/lib/components/timeline/TimelineBucketCard.spec.ts src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts
```

Expected:

- All selected tests pass.

- [ ] **Step 3: Verify web checks**

Run:

```bash
pnpm --dir web exec prettier --check src/lib/components/timeline/TimelineGroupingControl.svelte src/lib/components/timeline/TimelineGroupingControl.spec.ts src/lib/components/timeline/Timeline.svelte src/lib/components/timeline/Timeline.spec.ts src/lib/components/timeline/TimelineBucketCard.svelte src/lib/components/timeline/TimelineBucketCard.spec.ts src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts
pnpm --dir web check:typescript
pnpm --dir web check:svelte
```

Expected:

- Formatting, TypeScript, and Svelte checks all pass.

- [ ] **Step 4: Push**

Run:

```bash
git status --short --branch
git push
```

Expected:

- Worktree is clean before push.
- Branch pushes to `origin/brainstorm/pr625`.

## Plan Self-Review

- Spec coverage: Every Slice 5 acceptance criterion maps to a task and verification command.
- TDD order: The behavior-changing label and aria-label changes require failing tests before production edits. The filter chip copy guard is test-only because explicit filter chip behavior already exists and must be preserved.
- Edge cases: Desktop inline control, floating/mobile/coarse control, internal `day` grouping value, keyboard navigation, disabled grouping buttons, year/month representative card labels, fallback image failure, keyboard/pointer activation, and explicit temporal chips are covered.
- Type consistency: `TimelineGrouping` values remain `year`, `month`, and `day`; only the day mode's product label becomes `All`.
- Slice boundary: This plan changes web labels/accessibility only. It does not modify route zoom behavior, query options, anchors, mobile Flutter code, or the filter panel's explicit temporal filter model.
