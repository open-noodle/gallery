# Timeline Grouping Slice 4 UI Controls And Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the visible timeline grouping controls and representative year/month cards so users can switch density, inspect photo-forward buckets, and click year/month cards into the slice 3 temporal navigation flow.

**Architecture:** Keep grouping as route-owned display state and render controls as reusable UI components. `Timeline.svelte` owns mobile floating placement and representative bucket rendering because it has viewport, overlay, and selection context; Photos and Spaces own desktop toolbar placement because their header/filter-chip layouts are route-specific. Representative cards consume slice 2 `TimelineBucket` metadata and call the slice 3 `onTimelineBucketActivate(bucket)` contract without loading every asset in a bucket.

**Tech Stack:** Svelte 5 runes, TypeScript, Testing Library Svelte, Vitest, Playwright UI e2e, existing `TimelineManager.timelineBuckets`, existing thumbnail URL utilities, Tailwind utility classes.

---

## Scope

This slice implements:

- Reusable `TimelineGroupingControl` with `Years`, `Months`, and `Days`.
- Reusable `TimelineBucketCard` for year/month representative buckets.
- Representative bucket virtualization inside `Timeline.svelte`.
- Floating mobile grouping control inside `Timeline.svelte`.
- Desktop grouping control placement on Photos and Spaces browse timelines.
- Photos and Spaces route tests proving control clicks update grouping without changing filters or URL params.
- Browser-level Photos flow for `Years -> click year -> Months -> click month -> Days -> clear temporal filter`, plus mobile floating-control visibility.

This slice does not adopt grouping controls across Albums, People, Tags, Archive, Favorites, Trash, Locked, or Map timeline panel. Those surfaces remain slice 5.

## File Map

- Create: `web/src/lib/components/timeline/TimelineGroupingControl.svelte`
  - Segmented control component with inline and floating variants, active state, disabled state, and keyboard navigation.
- Create: `web/src/lib/components/timeline/TimelineGroupingControl.spec.ts`
  - Component tests for rendering, active state, click, keyboard, disabled, and variant styling hooks.
- Create: `web/src/lib/components/timeline/TimelineBucketCard.svelte`
  - Representative year/month bucket card with thumbnail, thumbhash placeholder, fallback, count badge, stable labels, and activation.
- Create: `web/src/lib/components/timeline/TimelineBucketCard.spec.ts`
  - Component tests for date labels, count labels, thumbnail URL usage, thumbhash, fallback, load error, click, and keyboard activation.
- Create: `web/src/lib/components/timeline/TimelineRepresentativeBuckets.svelte`
  - Virtual-positioned representative bucket renderer for non-day grouping modes.
- Create: `web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts`
  - Component tests for representative rendering, viewport overscan, loading fallback, no day-mode rendering, and activation forwarding.
- Modify: `web/src/lib/components/timeline/Timeline.svelte`
  - Render representative buckets in year/month modes; render mobile floating grouping control when it does not conflict with selection or asset viewer overlays.
- Create: `web/src/lib/components/timeline/Timeline.spec.ts`
  - Focused integration test that `Timeline.svelte` renders representative buckets in non-day grouping mode.
- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`
  - Add desktop grouping control placement and pass grouping control props into `Timeline`.
- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts`
  - Route tests for desktop grouping control, grouping-only state changes, and selection/search hiding.
- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  - Add desktop grouping control placement for browse mode and pass grouping control props into `Timeline`.
- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts`
  - Route tests for browse control, select-assets exclusion, grouping-only state changes, and search hiding.
- Modify: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/mock-timeline.test-wrapper.svelte`
  - Expose grouping control props for route tests.
- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/mock-timeline.test-wrapper.svelte`
  - Expose grouping control props for route tests.
- Modify: `e2e/src/ui/mock-network/timeline-network.ts`
  - Teach mocked timeline bucket routes to honor `bucketSize`, `takenAfter`, `takenBefore`, and representative metadata.
- Modify: `e2e/src/ui/generators/timeline/rest-response.ts`
  - Add year/month/day bucket aggregation for UI e2e mocks.
- Create or modify: `e2e/src/ui/generators/timeline/rest-response.spec.ts`
  - Unit coverage for year aggregation, month aggregation inside a temporal range, representative metadata, filtering, and sorting.
- Create: `e2e/src/ui/specs/timeline/timeline-grouping.e2e-spec.ts`
  - Browser-level Photos flow for grouping control, representative cards, temporal chips, day-mode return, and mobile floating-control placement.

## TDD Rules For This Plan

Every behavior-changing task starts with failing tests. Do not edit production code for a behavior until its red test has been run and observed failing for the expected reason. Regression tests that document already-correct behavior may be added alongside red tests, but they must be labeled as regression coverage and must not be used as the red proof for the task.

Do not use screenshots as the only verification for visual behavior. Component tests must assert accessibility and state; Playwright must assert the cross-component Photos flow.

---

## Implementation Tasks

### Task 1: Add Grouping Control Component

**Files:**

- Create: `web/src/lib/components/timeline/TimelineGroupingControl.spec.ts`
- Create: `web/src/lib/components/timeline/TimelineGroupingControl.svelte`

- [ ] **Step 1: Write the failing component tests**

Create `web/src/lib/components/timeline/TimelineGroupingControl.spec.ts`:

```ts
import { fireEvent, render, screen } from '@testing-library/svelte';

import TimelineGroupingControl from './TimelineGroupingControl.svelte';
import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';

describe('TimelineGroupingControl', () => {
  it('renders the three grouping modes with the active mode pressed', () => {
    render(TimelineGroupingControl, {
      props: {
        grouping: 'month',
        onGroupingChange: () => {},
      },
    });

    expect(screen.getByTestId('timeline-grouping-control')).toHaveAttribute('data-variant', 'inline');
    expect(screen.getByTestId('timeline-grouping-year')).toHaveTextContent('Years');
    expect(screen.getByTestId('timeline-grouping-month')).toHaveTextContent('Months');
    expect(screen.getByTestId('timeline-grouping-day')).toHaveTextContent('Days');
    expect(screen.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('timeline-grouping-year')).toHaveAttribute('aria-pressed', 'false');
  });

  it('emits a grouping change when a different mode is clicked', async () => {
    const changes: TimelineGrouping[] = [];
    render(TimelineGroupingControl, {
      props: {
        grouping: 'day',
        onGroupingChange: (grouping) => changes.push(grouping),
      },
    });

    await fireEvent.click(screen.getByTestId('timeline-grouping-year'));

    expect(changes).toEqual(['year']);
  });

  it('does not emit when clicking the already active mode', async () => {
    const changes: TimelineGrouping[] = [];
    render(TimelineGroupingControl, {
      props: {
        grouping: 'day',
        onGroupingChange: (grouping) => changes.push(grouping),
      },
    });

    await fireEvent.click(screen.getByTestId('timeline-grouping-day'));

    expect(changes).toEqual([]);
  });

  it('supports arrow-key navigation between modes', async () => {
    const changes: TimelineGrouping[] = [];
    render(TimelineGroupingControl, {
      props: {
        grouping: 'month',
        onGroupingChange: (grouping) => changes.push(grouping),
      },
    });

    screen.getByTestId('timeline-grouping-month').focus();
    await fireEvent.keyDown(screen.getByTestId('timeline-grouping-month'), { key: 'ArrowRight' });
    await fireEvent.keyDown(screen.getByTestId('timeline-grouping-month'), { key: 'ArrowLeft' });

    expect(changes).toEqual(['day', 'year']);
  });

  it('disables all mode buttons without emitting changes', async () => {
    const changes: TimelineGrouping[] = [];
    render(TimelineGroupingControl, {
      props: {
        grouping: 'day',
        disabled: true,
        onGroupingChange: (grouping) => changes.push(grouping),
      },
    });

    await fireEvent.click(screen.getByTestId('timeline-grouping-year'));

    expect(screen.getByTestId('timeline-grouping-year')).toBeDisabled();
    expect(screen.getByTestId('timeline-grouping-month')).toBeDisabled();
    expect(screen.getByTestId('timeline-grouping-day')).toBeDisabled();
    expect(changes).toEqual([]);
  });

  it('marks the floating variant for mobile placement styling', () => {
    render(TimelineGroupingControl, {
      props: {
        grouping: 'year',
        variant: 'floating',
        onGroupingChange: () => {},
      },
    });

    expect(screen.getByTestId('timeline-grouping-control')).toHaveAttribute('data-variant', 'floating');
    expect(screen.getByTestId('timeline-grouping-control')).toHaveClass('shadow-xl');
  });
});
```

- [ ] **Step 2: Run the red control tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/components/timeline/TimelineGroupingControl.spec.ts
```

Expected: FAIL because `TimelineGroupingControl.svelte` does not exist.

- [ ] **Step 3: Implement the grouping control**

Create `web/src/lib/components/timeline/TimelineGroupingControl.svelte`:

```svelte
<script lang="ts">
  import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
  import type { ClassValue } from 'svelte/elements';

  type Variant = 'inline' | 'floating';

  interface Props {
    grouping: TimelineGrouping;
    variant?: Variant;
    disabled?: boolean;
    class?: ClassValue;
    onGroupingChange: (grouping: TimelineGrouping) => void;
  }

  let {
    grouping,
    variant = 'inline',
    disabled = false,
    class: className = '',
    onGroupingChange,
  }: Props = $props();

  const modes: Array<{ value: TimelineGrouping; label: string }> = [
    { value: 'year', label: 'Years' },
    { value: 'month', label: 'Months' },
    { value: 'day', label: 'Days' },
  ];

  function selectGrouping(nextGrouping: TimelineGrouping) {
    if (disabled || nextGrouping === grouping) {
      return;
    }

    onGroupingChange(nextGrouping);
  }

  function handleKeydown(event: KeyboardEvent, index: number) {
    if (disabled) {
      return;
    }

    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (offset === 0) {
      return;
    }

    event.preventDefault();
    const next = modes[(index + offset + modes.length) % modes.length];
    selectGrouping(next.value);
  }
</script>

<div
  class={[
    'inline-flex items-center rounded-full border border-gray-200 bg-white/95 p-1 text-sm backdrop-blur dark:border-gray-700 dark:bg-gray-900/95',
    variant === 'floating' && 'shadow-xl ring-1 ring-black/5 dark:ring-white/10',
    className,
  ]}
  role="group"
  aria-label="Timeline grouping"
  data-testid="timeline-grouping-control"
  data-variant={variant}
>
  {#each modes as mode, index (mode.value)}
    <button
      type="button"
      class={[
        'min-w-16 rounded-full px-3 py-1.5 text-center font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-immich-primary disabled:cursor-not-allowed disabled:opacity-50',
        grouping === mode.value
          ? 'bg-gray-900 text-white shadow-sm dark:bg-gray-50 dark:text-gray-950'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-950 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white',
      ]}
      aria-pressed={grouping === mode.value}
      disabled={disabled}
      data-testid={`timeline-grouping-${mode.value}`}
      onkeydown={(event) => handleKeydown(event, index)}
      onclick={() => selectGrouping(mode.value)}
    >
      {mode.label}
    </button>
  {/each}
</div>
```

- [ ] **Step 4: Run the green control tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/components/timeline/TimelineGroupingControl.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit grouping control**

```bash
git add \
  web/src/lib/components/timeline/TimelineGroupingControl.svelte \
  web/src/lib/components/timeline/TimelineGroupingControl.spec.ts
git commit -m "feat(web): add timeline grouping control"
```

### Task 2: Add Representative Bucket Card

**Files:**

- Create: `web/src/lib/components/timeline/TimelineBucketCard.spec.ts`
- Create: `web/src/lib/components/timeline/TimelineBucketCard.svelte`

- [ ] **Step 1: Write the failing card tests**

Create `web/src/lib/components/timeline/TimelineBucketCard.spec.ts`:

```ts
import { fireEvent, render, screen } from '@testing-library/svelte';
import { AssetMediaSize } from '@immich/sdk';

import TimelineBucketCard from './TimelineBucketCard.svelte';
import type { ActivatableTimelineBucket } from '$lib/utils/timeline-filter-navigation';

const { getAssetMediaUrl } = vi.hoisted(() => ({
  getAssetMediaUrl: vi.fn(({ id }: { id: string }) => `/thumbnail/${id}`),
}));

vi.mock('$lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils')>();
  return {
    ...actual,
    getAssetMediaUrl,
  };
});

vi.mock('$lib/components/Thumbhash.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

function yearBucket(
  overrides: Partial<
    ActivatableTimelineBucket & {
      count: number;
      timeBucket: string;
      representativeAssetId: string | null;
      representativeThumbhash: string | null;
      representativeRatio: number | null;
    }
  > = {},
) {
  return {
    grouping: 'year' as const,
    timeBucket: '2015-01-01',
    date: { year: 2015 },
    count: 438,
    representativeAssetId: 'asset-2015',
    representativeThumbhash: 'thumbhash-2015',
    representativeRatio: 1.5,
    ...overrides,
  };
}

function monthBucket() {
  return {
    grouping: 'month' as const,
    timeBucket: '2015-08-01',
    date: { year: 2015, month: 8 },
    count: 23,
    representativeAssetId: 'asset-august',
    representativeThumbhash: null,
    representativeRatio: null,
  };
}

describe('TimelineBucketCard', () => {
  beforeEach(() => {
    getAssetMediaUrl.mockClear();
  });

  it('renders a year card with date, count, thumbnail, and accessible name', () => {
    render(TimelineBucketCard, {
      props: {
        bucket: yearBucket(),
        onActivate: () => {},
      },
    });

    expect(screen.getByRole('button', { name: /2015, 438 photos/i })).toBeInTheDocument();
    expect(screen.getByTestId('timeline-bucket-card-title')).toHaveTextContent('2015');
    expect(screen.getByTestId('timeline-bucket-card-count')).toHaveTextContent('438 photos');
    expect(screen.getByTestId('timeline-bucket-card-image')).toHaveAttribute('src', '/thumbnail/asset-2015');
    expect(getAssetMediaUrl).toHaveBeenCalledWith({
      id: 'asset-2015',
      size: AssetMediaSize.Thumbnail,
      cacheKey: 'thumbhash-2015',
    });
  });

  it('renders a month card with localized month and plural count label', () => {
    render(TimelineBucketCard, {
      props: {
        bucket: monthBucket(),
        locale: 'en-US',
        onActivate: () => {},
      },
    });

    expect(screen.getByTestId('timeline-bucket-card-title')).toHaveTextContent('Aug 2015');
    expect(screen.getByTestId('timeline-bucket-card-count')).toHaveTextContent('23 photos');
  });

  it('renders a singular count label for a one-photo bucket', () => {
    render(TimelineBucketCard, {
      props: {
        bucket: yearBucket({ count: 1 }),
        onActivate: () => {},
      },
    });

    expect(screen.getByRole('button', { name: /2015, 1 photo/i })).toBeInTheDocument();
    expect(screen.getByTestId('timeline-bucket-card-count')).toHaveTextContent('1 photo');
  });

  it('activates by click and keyboard with the bucket payload', async () => {
    const activations: ActivatableTimelineBucket[] = [];
    render(TimelineBucketCard, {
      props: {
        bucket: yearBucket(),
        onActivate: (bucket) => activations.push(bucket),
      },
    });

    await fireEvent.click(screen.getByTestId('timeline-bucket-card'));
    await fireEvent.keyDown(screen.getByTestId('timeline-bucket-card'), { key: 'Enter' });
    await fireEvent.keyDown(screen.getByTestId('timeline-bucket-card'), { key: ' ' });

    expect(activations).toEqual([
      { grouping: 'year', date: { year: 2015 } },
      { grouping: 'year', date: { year: 2015 } },
      { grouping: 'year', date: { year: 2015 } },
    ]);
  });

  it('does not activate while disabled', async () => {
    const activations: ActivatableTimelineBucket[] = [];
    render(TimelineBucketCard, {
      props: {
        bucket: yearBucket(),
        disabled: true,
        onActivate: (bucket) => activations.push(bucket),
      },
    });

    await fireEvent.click(screen.getByTestId('timeline-bucket-card'));
    await fireEvent.keyDown(screen.getByTestId('timeline-bucket-card'), { key: 'Enter' });

    expect(screen.getByTestId('timeline-bucket-card')).toBeDisabled();
    expect(activations).toEqual([]);
  });

  it('shows a neutral fallback when no representative asset exists', () => {
    render(TimelineBucketCard, {
      props: {
        bucket: yearBucket({ representativeAssetId: null, representativeThumbhash: null }),
        onActivate: () => {},
      },
    });

    expect(screen.queryByTestId('timeline-bucket-card-image')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-bucket-card-fallback')).toHaveTextContent('2015');
    expect(getAssetMediaUrl).not.toHaveBeenCalled();
  });

  it('shows fallback content after thumbnail load error', async () => {
    render(TimelineBucketCard, {
      props: {
        bucket: yearBucket(),
        onActivate: () => {},
      },
    });

    await fireEvent.error(screen.getByTestId('timeline-bucket-card-image'));

    expect(screen.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'fallback');
    expect(screen.getByTestId('timeline-bucket-card-fallback')).toHaveTextContent('2015');
  });

  it('keeps stable card geometry when the representative ratio is missing', () => {
    render(TimelineBucketCard, {
      props: {
        bucket: yearBucket({ representativeRatio: null }),
        onActivate: () => {},
      },
    });

    expect(screen.getByTestId('timeline-bucket-card')).toHaveClass('aspect-[16/9]');
  });
});
```

- [ ] **Step 2: Run the red card tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/components/timeline/TimelineBucketCard.spec.ts
```

Expected: FAIL because `TimelineBucketCard.svelte` does not exist.

- [ ] **Step 3: Implement the representative bucket card**

Create `web/src/lib/components/timeline/TimelineBucketCard.svelte`:

```svelte
<script lang="ts">
  import Thumbhash from '$lib/components/Thumbhash.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import type { ActivatableTimelineBucket } from '$lib/utils/timeline-filter-navigation';
  import { AssetMediaSize } from '@immich/sdk';

  type RepresentativeBucket = ActivatableTimelineBucket & {
    timeBucket: string;
    count: number;
    representativeAssetId: string | null;
    representativeThumbhash: string | null;
    representativeRatio: number | null;
  };

  interface Props {
    bucket: RepresentativeBucket;
    locale?: string;
    loading?: boolean;
    disabled?: boolean;
    onActivate: (bucket: ActivatableTimelineBucket) => void;
  }

  let { bucket, locale = 'en-US', loading = false, disabled = false, onActivate }: Props = $props();
  let imageFailed = $state(false);
  let imageLoaded = $state(false);

  const title = $derived.by(() => {
    if (bucket.grouping === 'year') {
      return String(bucket.date.year);
    }

    return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(Date.UTC(bucket.date.year, (bucket.date.month ?? 1) - 1, 1)),
    );
  });

  const countLabel = $derived(`${new Intl.NumberFormat(locale).format(bucket.count)} photo${bucket.count === 1 ? '' : 's'}`);
  const hasImage = $derived(Boolean(bucket.representativeAssetId) && !imageFailed && !loading);
  const imageUrl = $derived.by(() =>
    bucket.representativeAssetId
      ? getAssetMediaUrl({
          id: bucket.representativeAssetId,
          size: AssetMediaSize.Thumbnail,
          cacheKey: bucket.representativeThumbhash ?? undefined,
        })
      : undefined,
  );
  const state = $derived(loading ? 'loading' : hasImage ? 'image' : 'fallback');

  function activate() {
    if (disabled) {
      return;
    }

    onActivate({ grouping: bucket.grouping, date: bucket.date });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    activate();
  }
</script>

<button
  type="button"
  class={[
    'group relative block h-full w-full overflow-hidden rounded-lg bg-gray-200 text-left text-white shadow-sm outline-none transition-transform focus-visible:ring-2 focus-visible:ring-immich-primary dark:bg-gray-800',
    bucket.representativeRatio ? 'aspect-auto' : 'aspect-[16/9]',
  ]}
  aria-label={`${title}, ${countLabel}`}
  data-testid="timeline-bucket-card"
  data-state={state}
  disabled={disabled}
  aria-disabled={disabled}
  onclick={activate}
  onkeydown={handleKeydown}
>
  {#if hasImage && imageUrl}
    <img
      src={imageUrl}
      alt=""
      class="absolute inset-0 h-full w-full object-cover"
      data-testid="timeline-bucket-card-image"
      draggable="false"
      onload={() => (imageLoaded = true)}
      onerror={() => (imageFailed = true)}
    />
    {#if bucket.representativeThumbhash && !imageLoaded}
      <Thumbhash base64ThumbHash={bucket.representativeThumbhash} class="absolute inset-0 h-full w-full" />
    {/if}
  {:else}
    <div
      class="absolute inset-0 grid place-items-center bg-gradient-to-br from-gray-300 to-gray-500 text-gray-800 dark:from-gray-700 dark:to-gray-900 dark:text-gray-100"
      data-testid="timeline-bucket-card-fallback"
    >
      <span class="text-3xl font-semibold">{title}</span>
    </div>
  {/if}

  <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent p-4">
    <div class="text-4xl font-semibold leading-none tracking-normal" data-testid="timeline-bucket-card-title">
      {title}
    </div>
    <div
      class="mt-2 inline-flex rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-gray-900"
      data-testid="timeline-bucket-card-count"
    >
      {countLabel}
    </div>
  </div>
</button>
```

- [ ] **Step 4: Run the green card tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/components/timeline/TimelineBucketCard.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit representative card**

```bash
git add \
  web/src/lib/components/timeline/TimelineBucketCard.svelte \
  web/src/lib/components/timeline/TimelineBucketCard.spec.ts
git commit -m "feat(web): add representative timeline bucket card"
```

### Task 3: Add Representative Bucket Renderer

**Files:**

- Create: `web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts`
- Create: `web/src/lib/components/timeline/TimelineRepresentativeBuckets.svelte`

- [x] **Step 1: Write the failing renderer tests**

Create `web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts`:

```ts
import { fireEvent, render, screen } from '@testing-library/svelte';

import TimelineRepresentativeBuckets from './TimelineRepresentativeBuckets.svelte';
import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
import type { ActivatableTimelineBucket } from '$lib/utils/timeline-filter-navigation';

function bucket(year: number, top: number, overrides: Record<string, unknown> = {}) {
  return {
    grouping: 'year' as TimelineGrouping,
    timeBucket: `${year}-01-01`,
    viewId: `year:${year}-01-01`,
    date: { year },
    count: 10,
    top,
    height: 296,
    isLoaded: true,
    representativeAssetId: `asset-${year}`,
    representativeThumbhash: null,
    representativeRatio: 1.5,
    ...overrides,
  };
}

function monthBucket(year: number, month: number, top: number, overrides: Record<string, unknown> = {}) {
  return {
    grouping: 'month' as TimelineGrouping,
    timeBucket: `${year}-${String(month).padStart(2, '0')}-01`,
    viewId: `month:${year}-${String(month).padStart(2, '0')}-01`,
    date: { year, month },
    count: 3,
    top,
    height: 296,
    isLoaded: true,
    representativeAssetId: `asset-${year}-${month}`,
    representativeThumbhash: null,
    representativeRatio: 1.5,
    ...overrides,
  };
}

describe('TimelineRepresentativeBuckets', () => {
  it('renders visible representative buckets at their absolute positions', () => {
    render(TimelineRepresentativeBuckets, {
      props: {
        grouping: 'year',
        buckets: [bucket(2015, 120), bucket(2016, 480)],
        visibleWindow: { top: 0, bottom: 600 },
        onTimelineBucketActivate: () => {},
      },
    });

    expect(screen.getByTestId('timeline-representative-buckets')).toHaveAttribute('data-grouping', 'year');
    expect(screen.getAllByTestId('timeline-bucket-card')).toHaveLength(2);
    expect(screen.getByTestId('timeline-bucket-shell-2015-01-01')).toHaveStyle({
      transform: 'translate3d(0,120px,0)',
      height: '296px',
    });
  });

  it('does not render buckets outside the overscan window', () => {
    render(TimelineRepresentativeBuckets, {
      props: {
        grouping: 'year',
        buckets: [bucket(2015, 120), bucket(2016, 5000)],
        visibleWindow: { top: 0, bottom: 600 },
        onTimelineBucketActivate: () => {},
      },
    });

    expect(screen.getAllByTestId('timeline-bucket-card')).toHaveLength(1);
    expect(screen.queryByText('2016')).not.toBeInTheDocument();
  });

  it('does not render representative buckets in day mode', () => {
    const { container } = render(TimelineRepresentativeBuckets, {
      props: {
        grouping: 'day',
        buckets: [bucket(2015, 120)],
        visibleWindow: { top: 0, bottom: 600 },
        onTimelineBucketActivate: () => {},
      },
    });

    expect(container).toBeEmptyDOMElement();
  });

  it('forwards bucket activation to the timeline contract', async () => {
    const activations: ActivatableTimelineBucket[] = [];
    render(TimelineRepresentativeBuckets, {
      props: {
        grouping: 'year',
        buckets: [bucket(2015, 120)],
        visibleWindow: { top: 0, bottom: 600 },
        onTimelineBucketActivate: (bucket) => activations.push(bucket),
      },
    });

    await fireEvent.click(screen.getByTestId('timeline-bucket-card'));

    expect(activations).toEqual([{ grouping: 'year', date: { year: 2015 } }]);
  });

  it('renders loading fallback for an unloaded bucket', () => {
    render(TimelineRepresentativeBuckets, {
      props: {
        grouping: 'year',
        buckets: [bucket(2015, 120, { isLoaded: false })],
        visibleWindow: { top: 0, bottom: 600 },
        onTimelineBucketActivate: () => {},
      },
    });

    expect(screen.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'loading');
  });

  it('passes locale through to month bucket cards', () => {
    render(TimelineRepresentativeBuckets, {
      props: {
        grouping: 'month',
        buckets: [monthBucket(2015, 8, 120)],
        visibleWindow: { top: 0, bottom: 600 },
        locale: 'de-DE',
        onTimelineBucketActivate: () => {},
      },
    });

    expect(screen.getByTestId('timeline-bucket-card-title')).toHaveTextContent('Aug. 2015');
  });

  it('disables cards without forwarding activation', async () => {
    const activations: ActivatableTimelineBucket[] = [];
    render(TimelineRepresentativeBuckets, {
      props: {
        grouping: 'year',
        buckets: [bucket(2015, 120)],
        visibleWindow: { top: 0, bottom: 600 },
        disabled: true,
        onTimelineBucketActivate: (bucket) => activations.push(bucket),
      },
    });

    await fireEvent.click(screen.getByTestId('timeline-bucket-card'));

    expect(screen.getByTestId('timeline-bucket-card')).toBeDisabled();
    expect(activations).toEqual([]);
  });
});
```

- [x] **Step 2: Run the red renderer tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts
```

Expected: FAIL because `TimelineRepresentativeBuckets.svelte` does not exist.

- [x] **Step 3: Implement the representative renderer**

Create `web/src/lib/components/timeline/TimelineRepresentativeBuckets.svelte`:

```svelte
<script lang="ts">
  import TimelineBucketCard from '$lib/components/timeline/TimelineBucketCard.svelte';
  import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
  import type { ActivatableTimelineBucket } from '$lib/utils/timeline-filter-navigation';

  type VisibleWindow = { top: number; bottom: number };
  type RepresentativeTimelineBucket = ActivatableTimelineBucket & {
    viewId: string;
    timeBucket: string;
    top: number;
    height: number;
    isLoaded: boolean;
    count: number;
    representativeAssetId: string | null;
    representativeThumbhash: string | null;
    representativeRatio: number | null;
  };

  interface Props {
    grouping: TimelineGrouping;
    buckets: RepresentativeTimelineBucket[];
    visibleWindow: VisibleWindow;
    locale?: string;
    disabled?: boolean;
    onTimelineBucketActivate?: (bucket: ActivatableTimelineBucket) => void;
  }

  let { grouping, buckets, visibleWindow, locale = 'en-US', disabled = false, onTimelineBucketActivate }: Props = $props();

  const OVERSCAN_PX = 900;

  function isRenderable(bucket: Pick<RepresentativeTimelineBucket, 'top' | 'height'>) {
    return bucket.top + bucket.height >= visibleWindow.top - OVERSCAN_PX && bucket.top <= visibleWindow.bottom + OVERSCAN_PX;
  }
</script>

{#if grouping !== 'day'}
  <div data-testid="timeline-representative-buckets" data-grouping={grouping}>
    {#each buckets.filter(isRenderable) as bucket (bucket.viewId)}
      <div
        data-testid={`timeline-bucket-shell-${bucket.timeBucket}`}
        style:height={`${bucket.height}px`}
        style:position="absolute"
        style:transform={`translate3d(0,${bucket.top}px,0)`}
        style:width="100%"
      >
        <div class="mx-auto h-full max-w-5xl px-4">
          <TimelineBucketCard
            {bucket}
            {locale}
            loading={!bucket.isLoaded}
            {disabled}
            onActivate={(activation) => onTimelineBucketActivate?.(activation)}
          />
        </div>
      </div>
    {/each}
  </div>
{/if}
```

- [x] **Step 4: Run the green renderer tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts
```

Expected: PASS.

- [x] **Step 5: Commit representative renderer**

```bash
git add \
  web/src/lib/components/timeline/TimelineRepresentativeBuckets.svelte \
  web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts
git commit -m "feat(web): render representative timeline buckets"
```

### Task 4: Integrate Representative Cards Into Timeline

**Files:**

- Create: `web/src/lib/components/timeline/Timeline.spec.ts`
- Modify: `web/src/lib/components/timeline/Timeline.svelte`
- Modify: `web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts`

- [x] **Step 1: Add failing Timeline integration coverage**

Create `web/src/lib/components/timeline/Timeline.spec.ts`:

```ts
import { render, screen } from '@testing-library/svelte';

import Timeline from './Timeline.svelte';

const { representativeBucket } = vi.hoisted(() => ({
  representativeBucket: {
    grouping: 'year' as const,
    timeBucket: '2015-01-01',
    viewId: 'year:2015-01-01',
    date: { year: 2015 },
    count: 1,
    top: 0,
    height: 296,
    isLoaded: true,
    representativeAssetId: null,
    representativeThumbhash: null,
    representativeRatio: null,
  },
}));

vi.mock('$app/navigation', () => ({
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn(),
}));

vi.mock('$app/state', () => ({
  page: {
    url: new URL('https://gallery.test/photos'),
    route: { id: '/(user)/photos' },
  },
}));

vi.mock('$lib/components/timeline/actions/TimelineKeyboardActions.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/elements/HotModuleReload.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/elements/Portal.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/managers/timeline-manager/timeline-manager.svelte', () => ({
  TimelineManager: class TimelineManagerMock {
    grouping = 'day';
    months = [];
    timelineBuckets = [representativeBucket];
    visibleWindow = { top: 0, bottom: 600 };
    isInitialized = true;
    assetCount = 1;
    topSectionHeight = 0;
    bodySectionHeight = 296;
    bottomSectionHeight = 0;
    totalViewerHeight = 296;
    viewportHeight = 600;
    viewportWidth = 390;
    showAssetOwners = false;
    albumAssets = new Set<string>();
    suspendTransitions = false;
    limitedScroll = false;
    maxScroll = 1;
    maxScrollPercent = 1;
    scrollableElement?: HTMLElement;
    destroy = vi.fn();
    updateOptions = vi.fn((options?: { grouping?: 'year' | 'month' | 'day' }) => {
      this.grouping = options?.grouping ?? 'day';
    });
    setLayoutOptions = vi.fn();
    updateSlidingWindow = vi.fn();
    scrollTo = vi.fn();
    loadTimelineMonth = vi.fn();
    getTimelineMonthByAssetId = vi.fn();
    findTimelineMonthForAsset = vi.fn();
    retrieveRange = vi.fn(async () => []);
    getRandomAsset = vi.fn();
  },
}));

function assetInteraction() {
  return {
    selectionActive: false,
    selectedGroup: new Set<string>(),
    assets: [],
    candidates: [],
    hasSelectedAsset: () => false,
    hasSelectionCandidate: () => false,
    addGroupToMultiselectGroup: vi.fn(),
    removeGroupFromMultiselectGroup: vi.fn(),
    addAssetToMultiselectGroup: vi.fn(),
    removeAssetFromMultiselectGroup: vi.fn(),
    selectAsset: vi.fn(),
    clearCandidates: vi.fn(),
    clear: vi.fn(),
    setAssetSelectionStart: vi.fn(),
    setAssetSelectionCandidates: vi.fn(),
  } as never;
}

describe('Timeline representative grouping integration', () => {
  it('renders representative buckets instead of month groups in year mode', async () => {
    render(Timeline, {
      props: {
        enableRouting: false,
        options: { grouping: 'year' },
        grouping: 'year',
        assetInteraction: assetInteraction(),
        onTimelineBucketActivate: () => {},
        onGroupingChange: () => {},
      },
    });

    expect(await screen.findByTestId('timeline-representative-buckets')).toHaveAttribute('data-grouping', 'year');
    expect(screen.getByTestId('timeline-bucket-card-title')).toHaveTextContent('2015');
  });
});
```

- [x] **Step 2: Add renderer regression coverage**

Append this test to `web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts`:

```ts
it('keeps a large bucket list bounded to the viewport overscan', () => {
  const buckets = Array.from({ length: 2500 }, (_, index) => bucket(1900 + index, index * 328));

  render(TimelineRepresentativeBuckets, {
    props: {
      grouping: 'year',
      buckets,
      visibleWindow: { top: 0, bottom: 600 },
      onTimelineBucketActivate: () => {},
    },
  });

  expect(screen.getAllByTestId('timeline-bucket-card').length).toBeLessThan(10);
});
```

- [x] **Step 3: Run the red Timeline integration tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  src/lib/components/timeline/Timeline.spec.ts \
  src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts \
  -t 'representative buckets instead of month groups|large bucket list'
```

Expected: FAIL because `Timeline.svelte` still renders only `timelineManager.months` and does not render `TimelineRepresentativeBuckets`. The bounded-list test is regression coverage and may already pass.

- [x] **Step 4: Update `Timeline.svelte` representative branch**

In `web/src/lib/components/timeline/Timeline.svelte`, import:

```ts
import TimelineGroupingControl from '$lib/components/timeline/TimelineGroupingControl.svelte';
import TimelineRepresentativeBuckets from '$lib/components/timeline/TimelineRepresentativeBuckets.svelte';
import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
import { lang } from '$lib/stores/preferences.store';
```

Extend `Props`:

```ts
    grouping?: TimelineGrouping;
    onGroupingChange?: (grouping: TimelineGrouping) => void;
```

Destructure:

```ts
    grouping = 'day',
    onGroupingChange,
```

Replace the `isEmpty` derived value with:

```ts
const isEmpty = $derived(timelineManager.isInitialized && timelineManager.assetCount === 0);
```

Add:

```ts
const showMobileGroupingControl = $derived(
  Boolean(onGroupingChange) &&
    (maxMd || usingMobileDevice) &&
    !isSelectionMode &&
    !assetInteraction.selectionActive &&
    !assetViewerManager.isViewing,
);
```

Replace the month-only render section inside `#virtual-timeline` by wrapping the existing month loop. Keep the current `Month` component props and thumbnail snippet body unchanged inside the `{:else}` branch; only add the non-day branch:

```svelte
    {#if timelineManager.grouping !== 'day'}
      <TimelineRepresentativeBuckets
        grouping={timelineManager.grouping}
        buckets={timelineManager.timelineBuckets}
        visibleWindow={timelineManager.visibleWindow}
        locale={$lang}
        disabled={isSelectionMode || assetInteraction.selectionActive}
        {onTimelineBucketActivate}
      />
    {:else}
      {#each timelineManager.months as timelineMonth (timelineMonth.viewId)}
        {@const isInOrNearViewport = timelineMonth.isInOrNearViewport}
        {@const absoluteHeight = timelineMonth.top}

        {#if !timelineMonth.isLoaded}
          <div
            style:height={timelineMonth.height + 'px'}
            style:position="absolute"
            style:transform={`translate3d(0,${absoluteHeight}px,0)`}
            style:width="100%"
          >
            <Skeleton {invisible} height={timelineMonth.height} title={timelineMonth.title} />
          </div>
        {:else if isInOrNearViewport}
          <div
            class="timeline-month"
            style:height={timelineMonth.height + 'px'}
            style:position="absolute"
            style:transform={`translate3d(0,${absoluteHeight}px,0)`}
            style:width="100%"
          >
            <Month
              {assetInteraction}
              {customThumbnailLayout}
              {singleSelect}
              {timelineMonth}
              manager={timelineManager}
              onTimelineDaySelect={handleGroupSelect}
            >
              {#snippet thumbnail({ asset, position, timelineDay, groupIndex })}
                {@const isAssetSelectionCandidate = assetInteraction.hasSelectionCandidate(asset.id)}
                {@const isAssetSelected =
                  assetInteraction.hasSelectedAsset(asset.id) || timelineManager.albumAssets.has(asset.id)}
                {@const isAssetDisabled = timelineManager.albumAssets.has(asset.id)}
                <Thumbnail
                  showStackedIcon={withStacked}
                  {showArchiveIcon}
                  {asset}
                  {albumUsers}
                  {groupIndex}
                  onClick={(asset) => {
                    if (typeof onThumbnailClick === 'function') {
                      onThumbnailClick(asset, timelineManager, timelineDay, _onClick);
                    } else {
                      _onClick(timelineManager, timelineDay.getAssets(), timelineDay.groupTitle, asset);
                    }
                  }}
                  onSelect={() => {
                    if (isSelectionMode || assetInteraction.selectionActive) {
                      assetSelectHandler(timelineManager, asset, timelineDay.getAssets(), timelineDay.groupTitle);
                      return;
                    }
                    void onSelectAssets(asset);
                  }}
                  onMouseEvent={() => handleSelectAssetCandidates(asset)}
                  onPreview={isSelectionMode || assetInteraction.selectionActive
                    ? (asset) => void navigate({ targetRoute: 'current', assetId: asset.id })
                    : undefined}
                  selected={isAssetSelected}
                  selectionCandidate={isAssetSelectionCandidate}
                  disabled={isAssetDisabled}
                  thumbnailWidth={position.width}
                  thumbnailHeight={position.height}
                />
              {/snippet}
            </Month>
          </div>
        {/if}
      {/each}
    {/if}
```

This is the current existing month branch moved under `{:else}`. If the source branch has changed by implementation time, preserve the then-current month branch behavior and only add the non-day branch above it.

Add the floating mobile control before the `Portal`:

```svelte
{#if showMobileGroupingControl}
  <div
    class="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-20 flex justify-center px-4 md:hidden"
    data-testid="timeline-mobile-grouping-control-shell"
  >
    <TimelineGroupingControl
      class="pointer-events-auto"
      variant="floating"
      {grouping}
      onGroupingChange={(nextGrouping) => onGroupingChange?.(nextGrouping)}
    />
  </div>
{/if}
```

- [x] **Step 5: Run focused Timeline component tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  src/lib/components/timeline/Timeline.spec.ts \
  src/lib/components/timeline/TimelineGroupingControl.spec.ts \
  src/lib/components/timeline/TimelineBucketCard.spec.ts \
  src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts
```

Expected: PASS.

- [x] **Step 6: Commit Timeline integration**

```bash
git add \
  web/src/lib/components/timeline/Timeline.spec.ts \
  web/src/lib/components/timeline/Timeline.svelte \
  web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts
git commit -m "feat(web): integrate representative timeline cards"
```

### Task 5: Add Photos Desktop Control And Route Tests

**Files:**

- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts`
- Modify: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/mock-timeline.test-wrapper.svelte`

- [x] **Step 1: Add failing Photos route tests**

Append these tests to `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts`:

```ts
it('renders a desktop grouping control on the photos browse timeline', async () => {
  mockPage.url = new URL('https://gallery.test/photos');

  renderPage();

  expect(await screen.findByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
  expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
});

it('changes photos grouping from the desktop control without changing filters or URL params', async () => {
  mockPage.url = new URL('https://gallery.test/photos?people=person-1');

  renderPage();
  await fireEvent.click(await screen.findByTestId('timeline-grouping-year'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"year"');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
  expect(goto).not.toHaveBeenCalledWith(expect.stringContaining('selectedYear'), expect.anything());
});

it('does not show the route empty state for representative year buckets', async () => {
  mockPage.url = new URL('https://gallery.test/photos');

  renderPage();
  await fireEvent.click(await screen.findByTestId('timeline-grouping-year'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"year"');
  });
  expect(screen.queryByText('no_assets_message')).not.toBeInTheDocument();
});

it('does not show the desktop grouping control during photos search results', () => {
  mockPage.url = new URL('https://gallery.test/photos?q=nature');

  renderPage();

  expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
});

it('does not show the desktop grouping control while photos selection mode is active', () => {
  mockPage.url = new URL('https://gallery.test/photos');
  mockAssetMultiSelectManager.selectionActive = true;

  renderPage();

  expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
});

it('passes grouping state and change handler into the photos Timeline for mobile placement', async () => {
  mockPage.url = new URL('https://gallery.test/photos');

  renderPage();

  expect(await screen.findByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
    JSON.stringify({ grouping: 'day', hasHandler: true }),
  );

  await fireEvent.click(screen.getByTestId('timeline-mobile-set-year'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"year"');
    expect(screen.getByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
      JSON.stringify({ grouping: 'year', hasHandler: true }),
    );
  });
});
```

- [x] **Step 2: Run the red Photos control tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts' \
  -t 'desktop grouping control|changes photos grouping|mobile placement|representative year buckets'
```

Expected: FAIL because Photos does not render `TimelineGroupingControl` yet.

- [x] **Step 3: Expose grouping props in the Photos timeline test wrapper**

In `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/mock-timeline.test-wrapper.svelte`, extend `Props`:

```ts
    grouping?: 'year' | 'month' | 'day';
    onGroupingChange?: (grouping: 'year' | 'month' | 'day') => void;
```

Destructure:

```ts
    grouping = 'day',
    onGroupingChange,
```

Add these buttons after the existing `resolve-timeline-anchor` button:

```svelte
<button type="button" data-testid="timeline-mobile-set-year" onclick={() => onGroupingChange?.('year')}>
  Mobile year
</button>
<div data-testid="timeline-mobile-grouping-props">{JSON.stringify({ grouping, hasHandler: Boolean(onGroupingChange) })}</div>
```

- [x] **Step 4: Wire Photos desktop and mobile control props**

In `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`, import:

```ts
import TimelineGroupingControl from '$lib/components/timeline/TimelineGroupingControl.svelte';
```

Add this helper near `handleTimelineBucketActivate`:

```ts
function handleTimelineGroupingChange(grouping: TimelineGrouping) {
  timelineGrouping = grouping;
  temporalAnchor = undefined;
}
```

Render the desktop control above `ActiveFiltersBar` and only on browse timeline:

```svelte
      {#if !showSearchResults && !assetMultiSelectManager.selectionActive}
        <div
          class="hidden shrink-0 items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-900 md:flex"
          data-testid="timeline-desktop-grouping-control"
        >
          <TimelineGroupingControl grouping={timelineGrouping} onGroupingChange={handleTimelineGroupingChange} />
        </div>
      {/if}
```

Pass control props into `Timeline`:

```svelte
          grouping={timelineGrouping}
          onGroupingChange={handleTimelineGroupingChange}
```

- [x] **Step 5: Run the green Photos control tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts' \
  -t 'desktop grouping control|changes photos grouping|mobile placement|representative year buckets'
```

Expected: PASS.

- [x] **Step 6: Commit Photos controls**

```bash
git add \
  web/src/routes/'(user)'/photos/'[[assetId=id]]'/+page.svelte \
  web/src/routes/'(user)'/photos/'[[assetId=id]]'/photos-page.spec.ts \
  web/src/routes/'(user)'/albums/'[albumId=id]'/'[[photos=photos]]'/'[[assetId=id]]'/mock-timeline.test-wrapper.svelte
git commit -m "feat(web): add photos timeline grouping controls"
```

### Task 6: Add Spaces Desktop Control And Route Tests

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/mock-timeline.test-wrapper.svelte`

- [x] **Step 1: Add failing Spaces route tests**

Append these tests to `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts`:

```ts
it('renders a desktop grouping control on the space browse timeline', async () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

  renderPage();

  expect(await screen.findByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
  expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
});

it('changes space grouping from the desktop control without changing filters or URL params', async () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?people=space-person-1');

  renderPage();
  await fireEvent.click(await screen.findByTestId('timeline-grouping-year'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"year"');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
  expect(gotoMock).not.toHaveBeenCalledWith(expect.stringContaining('selectedYear'), expect.anything());
});

it('does not render grouping controls in space select-assets mode', async () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

  renderPage();
  await fireEvent.click(screen.getByLabelText('add_photos'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"grouping"');
  });
  expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
});

it('does not show the desktop grouping control during space search results', () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?q=nature');

  renderPage();

  expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
});

it('passes grouping state and change handler into the space Timeline for mobile placement', async () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

  renderPage();

  expect(await screen.findByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
    JSON.stringify({ grouping: 'day', hasHandler: true }),
  );

  await fireEvent.click(screen.getByTestId('timeline-mobile-set-year'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"year"');
    expect(screen.getByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
      JSON.stringify({ grouping: 'year', hasHandler: true }),
    );
  });
});
```

- [x] **Step 2: Run the red Spaces control tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts' \
  -t 'desktop grouping control|changes space grouping|select-assets mode|space search results|mobile placement'
```

Expected: FAIL because Spaces does not render `TimelineGroupingControl` yet.

- [x] **Step 3: Expose grouping props in the Spaces timeline test wrapper**

In `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/mock-timeline.test-wrapper.svelte`, extend `Props`:

```ts
    grouping?: 'year' | 'month' | 'day';
    onGroupingChange?: (grouping: 'year' | 'month' | 'day') => void;
```

Destructure:

```ts
    grouping = 'day',
    onGroupingChange,
```

Add after `resolve-timeline-anchor`:

```svelte
  <button type="button" data-testid="timeline-mobile-set-year" onclick={() => onGroupingChange?.('year')}>
    Mobile year
  </button>
  <div data-testid="timeline-mobile-grouping-props">{JSON.stringify({ grouping, hasHandler: Boolean(onGroupingChange) })}</div>
```

- [x] **Step 4: Wire Spaces desktop and mobile control props**

In `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`, import:

```ts
import TimelineGroupingControl from '$lib/components/timeline/TimelineGroupingControl.svelte';
```

Add this helper near `handleTimelineBucketActivate`:

```ts
function handleTimelineGroupingChange(grouping: TimelineGrouping) {
  timelineGrouping = grouping;
  temporalAnchor = undefined;
}
```

Render the desktop control above active chips, only in browse mode:

```svelte
      {#if viewMode === 'view' && !showSearchResults && !assetMultiSelectManager.selectionActive}
        <div
          class="hidden shrink-0 items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-900 md:flex"
          data-testid="timeline-desktop-grouping-control"
        >
          <TimelineGroupingControl grouping={timelineGrouping} onGroupingChange={handleTimelineGroupingChange} />
        </div>
      {/if}
```

Pass control props into browse `Timeline`:

```svelte
            grouping={timelineGrouping}
            onGroupingChange={handleTimelineGroupingChange}
```

- [x] **Step 5: Run the green Spaces control tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts' \
  -t 'desktop grouping control|changes space grouping|select-assets mode|space search results|mobile placement'
```

Expected: PASS.

- [x] **Step 6: Commit Spaces controls**

```bash
git add \
  web/src/routes/'(user)'/spaces/'[spaceId]'/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  web/src/routes/'(user)'/spaces/'[spaceId]'/'[[photos=photos]]'/'[[assetId=id]]'/spaces-page.spec.ts \
  web/src/routes/'(user)'/spaces/'[spaceId]'/'[[photos=photos]]'/'[[assetId=id]]'/mock-timeline.test-wrapper.svelte
git commit -m "feat(web): add space timeline grouping controls"
```

### Task 7: Add Browser-Level Photos Grouping Flow

**Files:**

- Modify: `e2e/src/ui/mock-network/timeline-network.ts`
- Modify: `e2e/src/ui/generators/timeline/rest-response.ts`
- Create or modify: `e2e/src/ui/generators/timeline/rest-response.spec.ts`
- Create: `e2e/src/ui/specs/timeline/timeline-grouping.e2e-spec.ts`

- [x] **Step 1: Add failing e2e mock aggregation tests**

Append tests to `e2e/src/ui/generators/timeline/rest-response.spec.ts`. If the file does not exist, create it with the imports below:

```ts
import { TimeBucketSize } from '@immich/sdk';
import { getTimeBuckets } from './rest-response';
import type { Changes } from './rest-response';

const changes: Changes = {
  albumAdditions: [],
  assetDeletions: [],
  assetArchivals: [],
  assetFavorites: [],
};

describe('timeline e2e rest response bucket grouping', () => {
  it('aggregates mock buckets by year with representative metadata', () => {
    const data = {
      buckets: new Map([
        [
          '2015-08',
          [
            {
              id: 'asset-1',
              thumbhash: 'thumb-1',
              ratio: 1.5,
              isTrashed: false,
              visibility: 'timeline',
              isFavorite: false,
            },
            { id: 'asset-2', thumbhash: null, ratio: 0.8, isTrashed: false, visibility: 'timeline', isFavorite: false },
          ],
        ],
        [
          '2015-09',
          [
            {
              id: 'asset-3',
              thumbhash: 'thumb-3',
              ratio: 1,
              isTrashed: false,
              visibility: 'timeline',
              isFavorite: false,
            },
          ],
        ],
      ]),
    } as never;

    expect(getTimeBuckets(data, undefined, undefined, undefined, undefined, changes, TimeBucketSize.Year)).toEqual([
      {
        timeBucket: '2015-01-01',
        count: 3,
        representativeAssetId: 'asset-1',
        representativeThumbhash: 'thumb-1',
        representativeRatio: 1.5,
      },
    ]);
  });

  it('filters mock buckets by selected temporal range before aggregating by month', () => {
    const data = {
      buckets: new Map([
        [
          '2015-08',
          [{ id: 'asset-1', thumbhash: null, ratio: 1, isTrashed: false, visibility: 'timeline', isFavorite: false }],
        ],
        [
          '2016-01',
          [{ id: 'asset-2', thumbhash: null, ratio: 1, isTrashed: false, visibility: 'timeline', isFavorite: false }],
        ],
      ]),
    } as never;

    expect(
      getTimeBuckets(data, undefined, undefined, undefined, undefined, changes, TimeBucketSize.Month, {
        takenAfter: '2015-01-01',
        takenBefore: '2015-12-31',
      }),
    ).toEqual([
      {
        timeBucket: '2015-08-01',
        count: 1,
        representativeAssetId: 'asset-1',
        representativeThumbhash: null,
        representativeRatio: 1,
      },
    ]);
  });

  it('applies asset filters before aggregation and sorts buckets newest first', () => {
    const data = {
      buckets: new Map([
        [
          '2015-08',
          [
            { id: 'asset-1', thumbhash: null, ratio: 1, isTrashed: false, visibility: 'timeline', isFavorite: true },
            { id: 'asset-2', thumbhash: null, ratio: 1, isTrashed: false, visibility: 'timeline', isFavorite: false },
          ],
        ],
        [
          '2016-01',
          [{ id: 'asset-3', thumbhash: null, ratio: 1.25, isTrashed: false, visibility: 'timeline', isFavorite: true }],
        ],
      ]),
    } as never;

    expect(getTimeBuckets(data, undefined, undefined, true, undefined, changes, TimeBucketSize.Year)).toEqual([
      {
        timeBucket: '2016-01-01',
        count: 1,
        representativeAssetId: 'asset-3',
        representativeThumbhash: null,
        representativeRatio: 1.25,
      },
      {
        timeBucket: '2015-01-01',
        count: 1,
        representativeAssetId: 'asset-1',
        representativeThumbhash: null,
        representativeRatio: 1,
      },
    ]);
  });
});
```

- [x] **Step 2: Run the red e2e mock tests**

Run:

```bash
pnpm --filter immich-e2e exec vitest run src/ui/generators/timeline/rest-response.spec.ts
```

Expected: FAIL because mock `getTimeBuckets()` does not accept `bucketSize` and temporal range options yet.

- [x] **Step 3: Update e2e mock aggregation**

In `e2e/src/ui/generators/timeline/rest-response.ts`, update `getTimeBuckets()` signature:

Add `TimeBucketSize` to the existing `@immich/sdk` import list:

```ts
  TimeBucketSize,
```

```ts
export function getTimeBuckets(
  timelineData: MockTimelineData,
  isTrashed: boolean | undefined,
  isArchived: boolean | undefined,
  isFavorite: boolean | undefined,
  albumId: string | undefined,
  changes: Changes,
  bucketSize: TimeBucketSize = TimeBucketSize.Month,
  temporalRange: { takenAfter?: string; takenBefore?: string } = {},
): TimeBucketsResponseDto[] {
```

Add helpers above it:

```ts
function getBucketKey(dateKey: string, bucketSize: TimeBucketSize) {
  const [year, month, day = '01'] = dateKey.split('-');
  if (bucketSize === TimeBucketSize.Year) {
    return `${year}-01-01`;
  }
  if (bucketSize === TimeBucketSize.Month) {
    return `${year}-${month.padStart(2, '0')}-01`;
  }
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function isInsideTemporalRange(dateKey: string, range: { takenAfter?: string; takenBefore?: string }) {
  const bucketDate = DateTime.fromISO(getBucketKey(dateKey, TimeBucketSize.Day));
  return (
    (!range.takenAfter || bucketDate >= DateTime.fromISO(range.takenAfter)) &&
    (!range.takenBefore || bucketDate <= DateTime.fromISO(range.takenBefore))
  );
}
```

Replace `const summary: TimeBucketsResponseDto[] = [];` with a map and local helper:

```ts
const summaryByBucket = new Map<string, TimeBucketsResponseDto>();

function addAssetsToSummary(bucketKey: string, filteredAssets: MockTimelineAsset[]) {
  if (filteredAssets.length === 0 || !isInsideTemporalRange(bucketKey, temporalRange)) {
    return;
  }

  const timeBucket = getBucketKey(bucketKey, bucketSize);
  const existing = summaryByBucket.get(timeBucket);
  const representative = existing?.representativeAssetId ? undefined : filteredAssets[0];

  summaryByBucket.set(timeBucket, {
    timeBucket,
    count: (existing?.count ?? 0) + filteredAssets.length,
    representativeAssetId: existing?.representativeAssetId ?? representative?.id ?? null,
    representativeThumbhash: existing?.representativeThumbhash ?? representative?.thumbhash ?? null,
    representativeRatio: existing?.representativeRatio ?? representative?.ratio ?? null,
  });
}
```

In the album branch, replace the existing `summary.push()` block that uses `albumAssetsInBucket.length` with:

```ts
addAssetsToSummary(bucketKey, albumAssetsInBucket);
```

In the non-album branch, replace the existing `summary.push()` block that uses `filteredAssets.length` with:

```ts
addAssetsToSummary(bucketKey, filteredAssets);
```

Then replace the final sort block with:

```ts
const summary = [...summaryByBucket.values()];

summary.sort((a, b) => {
  const dateA = DateTime.fromISO(a.timeBucket);
  const dateB = DateTime.fromISO(b.timeBucket);
  return dateB.diff(dateA).milliseconds;
});

return summary;
```

- [x] **Step 4: Update e2e network route parsing**

In `e2e/src/ui/mock-network/timeline-network.ts`, import `TimeBucketSize` and parse:

```ts
const bucketSize = (url.searchParams.get('bucketSize') as TimeBucketSize | null) ?? TimeBucketSize.Month;
const takenAfter = url.searchParams.get('takenAfter') ?? undefined;
const takenBefore = url.searchParams.get('takenBefore') ?? undefined;
```

Pass those to `getTimeBuckets()`:

```ts
json: getTimeBuckets(timelineRestData, isTrashed, isArchived, isFavorite, albumId, changes, bucketSize, {
  takenAfter,
  takenBefore,
}),
```

- [x] **Step 5: Add the Playwright flow**

Create `e2e/src/ui/specs/timeline/timeline-grouping.e2e-spec.ts`:

```ts
import { faker } from '@faker-js/faker';
import { expect, test } from '@playwright/test';
import { createDefaultTimelineConfig, generateTimelineData, TimelineData } from 'src/ui/generators/timeline';
import { setupBaseMockApiRoutes } from 'src/ui/mock-network/base-network';
import { setupTimelineMockApiRoutes, TimelineTestContext } from 'src/ui/mock-network/timeline-network';
import { utils } from 'src/utils';

test.describe('Timeline grouping UI', () => {
  let adminUserId: string;
  let timelineRestData: TimelineData;
  const testContext = new TimelineTestContext();
  const changes = {
    albumAdditions: [],
    assetDeletions: [],
    assetArchivals: [],
    assetFavorites: [],
  };

  test.beforeAll(() => {
    test.fail(
      process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS !== '1',
      'This test requires env var: PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1',
    );
    utils.initSdk();
    adminUserId = faker.string.uuid();
    testContext.adminId = adminUserId;
    timelineRestData = generateTimelineData({ ...createDefaultTimelineConfig(), ownerId: adminUserId });
  });

  test.beforeEach(async ({ context }) => {
    await setupBaseMockApiRoutes(context, adminUserId);
    await setupTimelineMockApiRoutes(context, timelineRestData, changes, testContext);
  });

  test('drills from years to months to days and clears the temporal chip on Photos', async ({ page }) => {
    await page.goto('/photos');
    await page.getByTestId('timeline-grouping-year').click();

    const firstYearCard = page.getByTestId('timeline-bucket-card').first();
    await expect(firstYearCard).toBeVisible();
    await firstYearCard.click();

    await expect(page.getByTestId('active-filters-bar')).toContainText(/\d{4}/);
    await expect(page.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');

    const firstMonthCard = page.getByTestId('timeline-bucket-card').first();
    await expect(firstMonthCard).toBeVisible();
    await firstMonthCard.click();

    await expect(page.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-thumbnail-focus-container]').first()).toBeVisible();

    await page.getByTestId('chip-close').click();
    await expect(page.getByTestId('active-filters-bar')).not.toContainText(/\b\\d{4}\b/);
  });

  test('shows the floating grouping control on mobile browse and hides it under the asset viewer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/photos');

    await expect(page.getByTestId('timeline-mobile-grouping-control-shell')).toBeVisible();
    await expect(page.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('[data-thumbnail-focus-container]').first().click();

    await expect(page.getByTestId('timeline-mobile-grouping-control-shell')).not.toBeVisible();
  });
});
```

- [x] **Step 6: Run e2e mock tests green**

Run:

```bash
pnpm --filter immich-e2e exec vitest run src/ui/generators/timeline/rest-response.spec.ts
```

Expected: PASS.

- [x] **Step 7: Run the targeted Playwright test**

Run:

```bash
PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 pnpm --filter immich-e2e exec playwright test src/ui/specs/timeline/timeline-grouping.e2e-spec.ts
```

Expected: PASS. If the local e2e stack is unavailable, record the infrastructure failure and keep the Vitest mock aggregation test as the runnable guard.

- [x] **Step 8: Commit browser coverage**

```bash
git add \
  e2e/src/ui/generators/timeline/rest-response.ts \
  e2e/src/ui/generators/timeline/rest-response.spec.ts \
  e2e/src/ui/mock-network/timeline-network.ts \
  e2e/src/ui/specs/timeline/timeline-grouping.e2e-spec.ts
git commit -m "test(e2e): cover timeline grouping card flow"
```

### Task 8: Final Verification And Coverage Review

**Files:**

- Verify changed files from Tasks 1-7.
- Read: `docs/superpowers/specs/2026-05-19-timeline-grouping-design.md`
- Read: `docs/superpowers/plans/2026-05-20-timeline-grouping-slice-3-filter-navigation.md`

- [ ] **Step 1: Run focused component and route tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  src/lib/components/timeline/Timeline.spec.ts \
  src/lib/components/timeline/TimelineGroupingControl.spec.ts \
  src/lib/components/timeline/TimelineBucketCard.spec.ts \
  src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts \
  'src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts' \
  'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts'
```

Expected: PASS.

- [ ] **Step 2: Run slice 3 regression tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  src/lib/utils/__tests__/timeline-filter-navigation.spec.ts \
  src/lib/managers/timeline-manager/timeline-anchor.spec.ts \
  src/lib/utils/__tests__/photos-filter-options.spec.ts \
  src/lib/utils/__tests__/space-filter-options.spec.ts \
  src/lib/utils/__tests__/searchable-page-search.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run adjacent timeline manager tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts \
  src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run TypeScript verification**

Run:

```bash
pnpm --filter immich-web run check:typescript
```

Expected: PASS.

- [ ] **Step 5: Run targeted ESLint**

Run:

```bash
pnpm --filter immich-web exec eslint \
  src/lib/components/timeline/TimelineGroupingControl.svelte \
  src/lib/components/timeline/TimelineGroupingControl.spec.ts \
  src/lib/components/timeline/TimelineBucketCard.svelte \
  src/lib/components/timeline/TimelineBucketCard.spec.ts \
  src/lib/components/timeline/TimelineRepresentativeBuckets.svelte \
  src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts \
  src/lib/components/timeline/Timeline.svelte \
  src/lib/components/timeline/Timeline.spec.ts \
  src/routes/'(user)'/photos/'[[assetId=id]]'/+page.svelte \
  src/routes/'(user)'/photos/'[[assetId=id]]'/photos-page.spec.ts \
  src/routes/'(user)'/spaces/'[spaceId]'/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  src/routes/'(user)'/spaces/'[spaceId]'/'[[photos=photos]]'/'[[assetId=id]]'/spaces-page.spec.ts \
  --max-warnings 0
```

Expected: PASS.

- [ ] **Step 6: Run targeted e2e verification**

Run:

```bash
pnpm --filter immich-e2e exec vitest run src/ui/generators/timeline/rest-response.spec.ts
PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 pnpm --filter immich-e2e exec playwright test src/ui/specs/timeline/timeline-grouping.e2e-spec.ts
```

Expected: PASS, or record a local e2e infrastructure blocker with the exact failing setup command/output.

- [ ] **Step 7: Run the spec coverage checklist**

Confirm each requirement is covered by tests or explicitly deferred:

```md
- [ ] Grouping control renders `Years`, `Months`, and `Days`.
- [ ] Grouping control click changes grouping without changing temporal filters or URL params.
- [ ] Grouping control keyboard navigation works.
- [ ] Grouping control disabled state does not emit changes.
- [ ] Desktop Photos control renders in browse mode and hides in search/selection mode.
- [ ] Desktop Spaces control renders in browse mode and hides in search/select-assets mode.
- [ ] Mobile floating control renders from `Timeline.svelte` and hides during selection mode or asset viewer overlays.
- [ ] Representative year card renders title, count, thumbnail, thumbhash placeholder, and fallback.
- [ ] Representative month card renders localized month/year title and count.
- [ ] Representative card activates with click, Enter, and Space.
- [ ] Representative card image error falls back to neutral date/count card.
- [ ] Missing representative asset and missing representative ratio degrade without layout shift.
- [ ] Representative bucket renderer does not render thousands of offscreen cards.
- [ ] Timeline year/month modes render representative buckets instead of day `Month` groups.
- [ ] Day mode preserves current detailed timeline behavior.
- [ ] Photos browser flow covers `Years -> click year -> Months -> click month -> Days -> clear temporal filter`.
- [ ] Photos mobile browser flow covers floating control visibility and asset-viewer overlay hiding.
- [ ] Spaces route-level flow covers grouping controls and FilterPanel sync; full browser-level Spaces flow remains deferred to slice 5 route adoption unless implemented here as an additional e2e test.
```

- [ ] **Step 8: Run edge-case checklist**

Confirm these edge cases are covered:

```md
- [ ] Empty representative bucket list shows existing empty state.
- [ ] Single representative bucket with one asset renders `1 photo`.
- [ ] Large bucket list is viewport-bounded.
- [ ] Assets with missing thumbhash still render thumbnail.
- [ ] Assets with missing representative ratio keep stable card geometry.
- [ ] Thumbnail load failure keeps the card activatable.
- [ ] Active person/tag/location filters remain active when a card is clicked.
- [ ] Changing grouping manually does not create selected year/month chips.
- [ ] Clearing temporal chip after card click keeps the current grouping.
- [ ] Search results do not render grouping controls.
- [ ] Selection mode hides desktop and mobile controls.
- [ ] Selection mode disables representative card activation if year/month mode is already active.
- [ ] Asset viewer overlay hides mobile floating control.
- [ ] Spaces select-assets mode does not receive browse grouping state.
- [ ] Reduced-motion users do not rely on animation for state changes.
- [ ] Dark and light mode classes remain legible for control and cards.
```

- [ ] **Step 9: Commit final verification updates if needed**

If Task 8 required fixes, commit them:

```bash
git add <changed-files>
git commit -m "test(web): verify timeline grouping UI coverage"
```

## Design Consistency Notes

- The grouping control is a quiet segmented control, not a filter chip. It never mutates `FilterState` directly.
- Desktop placement is route-owned because Photos and Spaces have different header, chip, and selection layouts.
- Mobile placement is Timeline-owned because `Timeline.svelte` knows selection state, asset viewer state, safe-area placement, and scrubber visibility.
- Cards are photo-forward and use the representative thumbnail as the visual focus; the surrounding UI stays restrained and dense.
- Cards use stable dimensions and absolute positioning from the existing `TimelineBucket.top`/`height` model.
- Representative cards use existing asset thumbnail URLs and thumbhash placeholders; they do not call `/timeline/bucket` or load all assets in the bucket.
- Slice 5 should reuse these components when adopting Albums, People, Tags, Archive, Favorites, Trash, Locked, and Map timeline panel.
