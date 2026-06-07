# Timeline Zoom Navigation Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared web zoom activation helper that returns grouping and anchor only, without converting route call sites yet.

**Architecture:** Keep the existing filter-drilldown helper in place for unmigrated routes, and add a new `getTimelineBucketZoomTarget()` helper beside it in `timeline-filter-navigation.ts`. The new helper accepts only an `ActivatableTimelineBucket` and returns only `{ grouping, anchor }`, so later route slices can adopt it without touching `FilterState`.

**Tech Stack:** TypeScript, SvelteKit web app, Vitest.

---

### Task 1: Add Shared Web Zoom Helper

**Files:**

- Modify: `web/src/lib/utils/__tests__/timeline-filter-navigation.spec.ts`
- Modify: `web/src/lib/utils/timeline-filter-navigation.ts`

- [ ] **Step 1: Write the failing tests**

In `web/src/lib/utils/__tests__/timeline-filter-navigation.spec.ts`, add `getTimelineBucketZoomTarget` to the import list:

```ts
import {
  activateTimelineBucket,
  clearTimelineTemporalFilter,
  getTimelineBucketZoomTarget,
  getTimelineManagerTimeBuckets,
} from '../timeline-filter-navigation';
```

Add these tests near the top of `describe('timeline filter navigation helpers', () => {`, before the legacy filter-drilldown tests:

```ts
it('zooms a year bucket to month grouping without requiring filters', () => {
  expect(
    getTimelineBucketZoomTarget({
      grouping: 'year',
      date: { year: 2015 },
    }),
  ).toEqual({
    grouping: 'month',
    anchor: { year: 2015 },
  });
});

it('zooms a month bucket to detailed day grouping without requiring filters', () => {
  expect(
    getTimelineBucketZoomTarget({
      grouping: 'month',
      date: { year: 2015, month: 8 },
    }),
  ).toEqual({
    grouping: 'day',
    anchor: { year: 2015, month: 8 },
  });
});

it('does not zoom day buckets', () => {
  expect(
    getTimelineBucketZoomTarget({
      grouping: 'day',
      date: { year: 2015, month: 8, day: 23 },
    }),
  ).toBeUndefined();
});

it('does not zoom malformed month buckets without a month number', () => {
  expect(
    getTimelineBucketZoomTarget({
      grouping: 'month',
      date: { year: 2015 },
    }),
  ).toBeUndefined();
});
```

Keep the existing `activateTimelineBucket()` tests unchanged in this slice. They document legacy behavior for routes that have not migrated yet.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --dir web test --run src/lib/utils/__tests__/timeline-filter-navigation.spec.ts
```

Expected: FAIL before implementation because `timeline-filter-navigation.ts` does not export `getTimelineBucketZoomTarget`.

Acceptable red failure examples:

```text
SyntaxError: The requested module '../timeline-filter-navigation' does not provide an export named 'getTimelineBucketZoomTarget'
```

or:

```text
TypeError: getTimelineBucketZoomTarget is not a function
```

If the test passes before implementation, stop and inspect why the new tests are not exercising the missing helper.

- [ ] **Step 3: Implement the minimal helper**

In `web/src/lib/utils/timeline-filter-navigation.ts`, keep the existing imports and legacy helper. Add this type after `type TimelineBucketActivationResult`:

```ts
export type TimelineZoomActivationResult = {
  grouping: TimelineGrouping;
  anchor: TimelineTemporalAnchor;
};
```

Add this function after `clearTimelineTemporalFilter()` and before the existing legacy `activateTimelineBucket()` function:

```ts
export function getTimelineBucketZoomTarget(
  bucket: ActivatableTimelineBucket,
): TimelineZoomActivationResult | undefined {
  if (bucket.grouping === 'year') {
    return {
      grouping: 'month',
      anchor: { year: bucket.date.year },
    };
  }

  if (bucket.grouping === 'month') {
    if (bucket.date.month === undefined) {
      return;
    }

    return {
      grouping: 'day',
      anchor: { year: bucket.date.year, month: bucket.date.month },
    };
  }
}
```

Do not change `activateTimelineBucket()` yet. Do not update route or GalleryViewer call sites in this slice.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --dir web test --run src/lib/utils/__tests__/timeline-filter-navigation.spec.ts
```

Expected: PASS, all tests in `timeline-filter-navigation.spec.ts` pass with no failures.

- [ ] **Step 5: Run TypeScript verification**

Run:

```bash
pnpm --dir web check:typescript
```

Expected: PASS, no TypeScript errors. This confirms the new exported type/function do not break existing route call sites and that the legacy helper still type-checks for unmigrated routes.

- [ ] **Step 6: Confirm this slice did not migrate future route call sites**

Run:

```bash
git diff -- web/src | rg -n "activateTimelineBucket|getTimelineBucketZoomTarget|result\\.filters|syncFilterUrl"
```

Expected:

- Diff includes the new helper and its tests.
- Diff does not include route files under `web/src/routes/`.
- Diff does not include `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.svelte`.
- Existing `activateTimelineBucket()` call sites are unchanged.

- [ ] **Step 7: Commit Slice 1**

Run:

```bash
git add web/src/lib/utils/timeline-filter-navigation.ts web/src/lib/utils/__tests__/timeline-filter-navigation.spec.ts
git commit -m "feat(web): add timeline zoom activation helper"
```

Expected: one commit containing only the shared helper and focused helper tests.
