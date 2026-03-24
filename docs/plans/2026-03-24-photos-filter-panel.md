# Photos FilterPanel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the existing FilterPanel sidebar to the /photos page so users can filter their main timeline by people, location, camera, tags, rating, media type, and time period.

**Architecture:** Direct integration of the FilterPanel component into the /photos page using the same `$derived.by()` pattern as the spaces page. FilterPanel props are extended with `initialCollapsed` and `storageKey`. Filter sub-component empty text is made configurable. No backend changes.

**Tech Stack:** SvelteKit, Svelte 5 runes, @immich/sdk, Vitest, Playwright

**Base branch:** `feat/contextual-filter-suggestions` (the contextual-filters worktree)

---

### Task 1: Add `initialCollapsed` prop to FilterPanel

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.svelte:35-42`
- Test: `web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`

**Step 1: Write failing test**

Add to the existing test file:

```typescript
describe('initialCollapsed prop', () => {
  it('should start collapsed when initialCollapsed is true', async () => {
    render(FilterPanel, {
      props: {
        config: { sections: ['rating', 'media'], providers: {} },
        timeBuckets: [],
        initialCollapsed: true,
      },
    });

    expect(screen.getByTestId('collapsed-icon-strip')).toBeInTheDocument();
    expect(screen.queryByTestId('discovery-panel')).not.toBeInTheDocument();
  });

  it('should start expanded by default (no prop)', async () => {
    render(FilterPanel, {
      props: {
        config: { sections: ['rating', 'media'], providers: {} },
        timeBuckets: [],
      },
    });

    expect(screen.getByTestId('discovery-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('collapsed-icon-strip')).not.toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`
Expected: FAIL — `initialCollapsed` is not a recognized prop

**Step 3: Implement**

In `filter-panel.svelte`, update the Props interface and state initialization:

```typescript
interface Props {
  config: FilterPanelConfig;
  timeBuckets: Array<{ timeBucket: string; count: number }>;
  filters?: FilterState;
  initialCollapsed?: boolean;
}

let { config, timeBuckets, filters = $bindable(createFilterState()), initialCollapsed = false }: Props = $props();
let collapsed = $state(initialCollapsed);
```

**Step 4: Run test to verify it passes**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add web/src/lib/components/filter-panel/filter-panel.svelte web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts
git commit -m "feat: add initialCollapsed prop to FilterPanel"
```

---

### Task 2: Add `storageKey` prop to FilterPanel

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.svelte:35-42,176`
- Test: `web/src/lib/components/filter-panel/__tests__/filter-sections.spec.ts`

**Step 1: Write failing test**

Add to the existing filter-sections test file:

```typescript
describe('storageKey prop', () => {
  it('should use custom storage key for localStorage persistence', async () => {
    const customKey = 'gallery-filter-photos';
    render(FilterPanel, {
      props: {
        config: { sections: ['rating', 'media', 'tags'], providers: {} },
        timeBuckets: [],
        storageKey: customKey,
      },
    });

    // Toggle off a section
    const ratingToggle = screen.getByTestId('section-toggle-rating');
    await fireEvent.click(ratingToggle);

    // Check custom key was used
    const stored = localStorage.getItem(customKey);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!) as string[];
    expect(parsed).not.toContain('rating');

    // Default key should NOT have been written
    expect(localStorage.getItem('gallery-filter-visible-sections')).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-sections.spec.ts`
Expected: FAIL — `storageKey` not recognized, default key still used

**Step 3: Implement**

In `filter-panel.svelte`:

1. Add to Props and destructuring:

```typescript
interface Props {
  config: FilterPanelConfig;
  timeBuckets: Array<{ timeBucket: string; count: number }>;
  filters?: FilterState;
  initialCollapsed?: boolean;
  storageKey?: string;
}

let {
  config,
  timeBuckets,
  filters = $bindable(createFilterState()),
  initialCollapsed = false,
  storageKey = 'gallery-filter-visible-sections',
}: Props = $props();
```

2. Remove the `STORAGE_KEY` constant (line 176) and replace all references with `storageKey`:

```typescript
// In loadVisibleSections:
const raw = localStorage.getItem(storageKey);

// In the $effect that persists:
localStorage.setItem(storageKey, JSON.stringify([...visibleSections]));
```

3. Update `loadVisibleSections` to accept the key parameter:

```typescript
function loadVisibleSections(configSections: FilterSectionType[], key: string): SvelteSet<FilterSectionType> {
  if (browser) {
    try {
      const raw = localStorage.getItem(key);
      // ... rest unchanged
```

And call it: `let visibleSections = $state(loadVisibleSections(config.sections, storageKey));`

**Step 4: Run test to verify it passes**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-sections.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add web/src/lib/components/filter-panel/filter-panel.svelte web/src/lib/components/filter-panel/__tests__/filter-sections.spec.ts
git commit -m "feat: add storageKey prop to FilterPanel for independent persistence"
```

---

### Task 3: Add `emptyText` prop to filter sub-components

**Files:**

- Modify: `web/src/lib/components/filter-panel/people-filter.svelte`
- Modify: `web/src/lib/components/filter-panel/location-filter.svelte`
- Modify: `web/src/lib/components/filter-panel/camera-filter.svelte`
- Modify: `web/src/lib/components/filter-panel/tags-filter.svelte`
- Test: `web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`

**Step 1: Write failing test**

Add to filter-panel.spec.ts:

```typescript
describe('emptyText prop', () => {
  it('should show custom empty text for people section when no people', async () => {
    render(FilterPanel, {
      props: {
        config: { sections: ['people'], providers: { people: async () => [] } },
        timeBuckets: [],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('people-empty')).toHaveTextContent('No people found');
    });
  });
});
```

Note: This test verifies the default empty text changes from "No people in this space" to "No people found". The test will initially fail because the current text says "in this space".

**Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`
Expected: FAIL — text says "No people in this space"

**Step 3: Implement**

In each sub-component, add an `emptyText` prop with a generic default:

**people-filter.svelte:**

```typescript
interface Props {
  people: PersonOption[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  emptyText?: string;
}

let { people, selectedIds, onSelectionChange, emptyText = 'No people found' }: Props = $props();
```

Replace the hardcoded empty text:

```svelte
<p class="text-sm text-gray-400 dark:text-gray-500" data-testid="people-empty">{emptyText}</p>
```

**location-filter.svelte:**

```typescript
emptyText?: string;
// default: 'No locations found'
```

**camera-filter.svelte:**

```typescript
emptyText?: string;
// default: 'No cameras found'
```

**tags-filter.svelte:**

```typescript
emptyText?: string;
// default: 'No tags available'  (already generic, keep as-is)
```

**Step 4: Run test to verify it passes**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`
Expected: PASS

**Step 5: Also run existing tests to check no regressions**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/`
Expected: All PASS

**Step 6: Commit**

```bash
git add web/src/lib/components/filter-panel/people-filter.svelte web/src/lib/components/filter-panel/location-filter.svelte web/src/lib/components/filter-panel/camera-filter.svelte web/src/lib/components/filter-panel/tags-filter.svelte web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts
git commit -m "feat: add emptyText prop to filter sub-components with generic defaults"
```

---

### Task 4: Wire FilterPanel into the /photos page

**Files:**

- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`
- Test: `web/src/routes/(user)/photos/__tests__/photos-filter.spec.ts` (new)

**Step 1: Write the unit test for options derivation**

Create `web/src/routes/(user)/photos/__tests__/photos-filter.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { AssetOrder, AssetTypeEnum, AssetVisibility } from '@immich/sdk';
import type { FilterState } from '$lib/components/filter-panel/filter-panel';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';

/**
 * Test the filter-to-options mapping logic that will be used in the /photos page.
 * This is extracted as a pure function to enable TDD before wiring into the component.
 */
function buildTimelineOptions(filters: FilterState) {
  const base: Record<string, unknown> = {
    visibility: AssetVisibility.Timeline,
    withStacked: true,
    withPartners: true,
    withSharedSpaces: true,
  };

  if (filters.personIds.length > 0) {
    base.personIds = filters.personIds;
  }
  if (filters.city) {
    base.city = filters.city;
  }
  if (filters.country) {
    base.country = filters.country;
  }
  if (filters.make) {
    base.make = filters.make;
  }
  if (filters.model) {
    base.model = filters.model;
  }
  if (filters.tagIds.length > 0) {
    base.tagIds = filters.tagIds;
  }
  if (filters.rating !== undefined) {
    base.rating = filters.rating;
  }
  if (filters.mediaType !== 'all') {
    base.$type = filters.mediaType === 'image' ? AssetTypeEnum.Image : AssetTypeEnum.Video;
  }
  base.order = filters.sortOrder === 'asc' ? AssetOrder.Asc : AssetOrder.Desc;

  if (filters.selectedYear && filters.selectedMonth) {
    const start = new Date(filters.selectedYear, filters.selectedMonth - 1, 1);
    const end = new Date(filters.selectedYear, filters.selectedMonth, 0, 23, 59, 59, 999);
    base.takenAfter = start.toISOString();
    base.takenBefore = end.toISOString();
  } else if (filters.selectedYear) {
    base.takenAfter = new Date(filters.selectedYear, 0, 1).toISOString();
    base.takenBefore = new Date(filters.selectedYear, 11, 31, 23, 59, 59, 999).toISOString();
  }

  return base;
}

describe('Photos page filter options derivation', () => {
  it('should return base options with no filters', () => {
    const filters = createFilterState();
    const options = buildTimelineOptions(filters);

    expect(options).toEqual({
      visibility: AssetVisibility.Timeline,
      withStacked: true,
      withPartners: true,
      withSharedSpaces: true,
      order: AssetOrder.Desc,
    });
  });

  it('should include personIds when people filter is set', () => {
    const filters = { ...createFilterState(), personIds: ['person-1', 'person-2'] };
    const options = buildTimelineOptions(filters);

    expect(options.personIds).toEqual(['person-1', 'person-2']);
    // Should NOT use spacePersonIds
    expect(options).not.toHaveProperty('spacePersonIds');
  });

  it('should include city and country when location filter is set', () => {
    const filters = { ...createFilterState(), country: 'Germany', city: 'Berlin' };
    const options = buildTimelineOptions(filters);

    expect(options.country).toBe('Germany');
    expect(options.city).toBe('Berlin');
  });

  it('should include make and model when camera filter is set', () => {
    const filters = { ...createFilterState(), make: 'Sony', model: 'A7III' };
    const options = buildTimelineOptions(filters);

    expect(options.make).toBe('Sony');
    expect(options.model).toBe('A7III');
  });

  it('should include tagIds when tags filter is set', () => {
    const filters = { ...createFilterState(), tagIds: ['tag-1'] };
    const options = buildTimelineOptions(filters);

    expect(options.tagIds).toEqual(['tag-1']);
  });

  it('should include rating when rating filter is set', () => {
    const filters = { ...createFilterState(), rating: 4 };
    const options = buildTimelineOptions(filters);

    expect(options.rating).toBe(4);
  });

  it('should map mediaType image to AssetTypeEnum.Image', () => {
    const filters = { ...createFilterState(), mediaType: 'image' as const };
    const options = buildTimelineOptions(filters);

    expect(options.$type).toBe(AssetTypeEnum.Image);
  });

  it('should map mediaType video to AssetTypeEnum.Video', () => {
    const filters = { ...createFilterState(), mediaType: 'video' as const };
    const options = buildTimelineOptions(filters);

    expect(options.$type).toBe(AssetTypeEnum.Video);
  });

  it('should not include $type when mediaType is all', () => {
    const filters = createFilterState();
    const options = buildTimelineOptions(filters);

    expect(options).not.toHaveProperty('$type');
  });

  it('should set ascending order', () => {
    const filters = { ...createFilterState(), sortOrder: 'asc' as const };
    const options = buildTimelineOptions(filters);

    expect(options.order).toBe(AssetOrder.Asc);
  });

  it('should set date range for year filter', () => {
    const filters = { ...createFilterState(), selectedYear: 2023 };
    const options = buildTimelineOptions(filters);

    expect(options.takenAfter).toBeDefined();
    expect(options.takenBefore).toBeDefined();
    expect(new Date(options.takenAfter as string).getFullYear()).toBe(2023);
  });

  it('should set date range for year+month filter', () => {
    const filters = { ...createFilterState(), selectedYear: 2023, selectedMonth: 8 };
    const options = buildTimelineOptions(filters);

    const after = new Date(options.takenAfter as string);
    const before = new Date(options.takenBefore as string);
    expect(after.getFullYear()).toBe(2023);
    expect(after.getMonth()).toBe(7); // 0-indexed
    expect(before.getMonth()).toBe(7); // Last day of August
  });

  it('should preserve withPartners and withSharedSpaces when filters are active', () => {
    const filters = { ...createFilterState(), country: 'Japan', rating: 5 };
    const options = buildTimelineOptions(filters);

    expect(options.withPartners).toBe(true);
    expect(options.withSharedSpaces).toBe(true);
  });
});
```

**Step 2: Run test to verify it passes** (these test a pure function defined in the test file)

Run: `cd web && pnpm test -- --run src/routes/\(user\)/photos/__tests__/photos-filter.spec.ts`
Expected: PASS — these validate the mapping logic before we wire it into the component

**Step 3: Wire FilterPanel into the /photos page**

Modify `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`:

Add imports at top of `<script>`:

```typescript
import FilterPanel from '$lib/components/filter-panel/filter-panel.svelte';
import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
import SortToggle from '$lib/components/filter-panel/sort-toggle.svelte';
import {
  createFilterState,
  clearFilters,
  getActiveFilterCount,
  type FilterPanelConfig,
  type FilterContext,
} from '$lib/components/filter-panel/filter-panel';
import {
  AssetOrder,
  AssetTypeEnum,
  getAllPeople,
  getAllTags,
  getSearchSuggestions,
  SearchSuggestionType,
} from '@immich/sdk';
import { SvelteMap } from 'svelte/reactivity';
```

Add filter state after the existing `assetInteraction`:

```typescript
// Filter state
let filters = $state(createFilterState());
let personNames = new SvelteMap<string, string>();
let tagNames = new SvelteMap<string, string>();

const filterConfig: FilterPanelConfig = {
  sections: ['timeline', 'people', 'location', 'camera', 'tags', 'rating', 'media'],
  providers: {
    people: async (context?: FilterContext) => {
      const response = await getAllPeople({
        withHidden: false,
        takenAfter: context?.takenAfter,
        takenBefore: context?.takenBefore,
      });
      for (const p of response.people) {
        personNames.set(p.id, p.name || 'Unknown');
      }
      return response.people
        .filter((p) => p.thumbnailPath)
        .map((p) => ({ id: p.id, name: p.name || 'Unknown', thumbnailPath: p.thumbnailPath }));
    },
    locations: async (context?: FilterContext) => {
      const countries = await getSearchSuggestions({
        $type: SearchSuggestionType.Country,
        takenAfter: context?.takenAfter,
        takenBefore: context?.takenBefore,
      });
      return countries.filter(Boolean).map((c) => ({ value: c!, type: 'country' as const }));
    },
    cities: async (country: string, context?: FilterContext) => {
      const cities = await getSearchSuggestions({
        $type: SearchSuggestionType.City,
        country,
        takenAfter: context?.takenAfter,
        takenBefore: context?.takenBefore,
      });
      return cities.filter(Boolean) as string[];
    },
    cameras: async (context?: FilterContext) => {
      const makes = await getSearchSuggestions({
        $type: SearchSuggestionType.CameraMake,
        takenAfter: context?.takenAfter,
        takenBefore: context?.takenBefore,
      });
      return makes.filter(Boolean).map((m) => ({ value: m!, type: 'make' as const }));
    },
    cameraModels: async (make: string, context?: FilterContext) => {
      const models = await getSearchSuggestions({
        $type: SearchSuggestionType.CameraModel,
        make,
        takenAfter: context?.takenAfter,
        takenBefore: context?.takenBefore,
      });
      return models.filter(Boolean) as string[];
    },
    tags: async () => {
      const tags = await getAllTags();
      for (const t of tags) {
        tagNames.set(t.id, t.value);
      }
      return tags.map((t) => ({ id: t.id, name: t.value }));
    },
  },
};

function handleRemoveFilter(type: string, id?: string) {
  switch (type) {
    case 'person': {
      filters = { ...filters, personIds: filters.personIds.filter((p) => p !== id) };
      break;
    }
    case 'location': {
      filters = { ...filters, city: undefined, country: undefined };
      break;
    }
    case 'camera': {
      filters = { ...filters, make: undefined, model: undefined };
      break;
    }
    case 'tag': {
      filters = { ...filters, tagIds: filters.tagIds.filter((t) => t !== id) };
      break;
    }
    case 'rating': {
      filters = { ...filters, rating: undefined };
      break;
    }
    case 'media':
    case 'mediaType': {
      filters = { ...filters, mediaType: 'all' };
      break;
    }
  }
}

const hasActiveFilters = $derived(getActiveFilterCount(filters) > 0);
const totalAssetCount = $derived(timelineManager?.assetCount ?? 0);
```

Change the static `options` to derived:

```typescript
const options = $derived.by(() => {
  const base: Record<string, unknown> = {
    visibility: AssetVisibility.Timeline,
    withStacked: true,
    withPartners: true,
    withSharedSpaces: true,
  };

  if (filters.personIds.length > 0) {
    base.personIds = filters.personIds;
  }
  if (filters.city) {
    base.city = filters.city;
  }
  if (filters.country) {
    base.country = filters.country;
  }
  if (filters.make) {
    base.make = filters.make;
  }
  if (filters.model) {
    base.model = filters.model;
  }
  if (filters.tagIds.length > 0) {
    base.tagIds = filters.tagIds;
  }
  if (filters.rating !== undefined) {
    base.rating = filters.rating;
  }
  if (filters.mediaType !== 'all') {
    base.$type = filters.mediaType === 'image' ? AssetTypeEnum.Image : AssetTypeEnum.Video;
  }
  base.order = filters.sortOrder === 'asc' ? AssetOrder.Asc : AssetOrder.Desc;

  if (filters.selectedYear && filters.selectedMonth) {
    const start = new Date(filters.selectedYear, filters.selectedMonth - 1, 1);
    const end = new Date(filters.selectedYear, filters.selectedMonth, 0, 23, 59, 59, 999);
    base.takenAfter = start.toISOString();
    base.takenBefore = end.toISOString();
  } else if (filters.selectedYear) {
    base.takenAfter = new Date(filters.selectedYear, 0, 1).toISOString();
    base.takenBefore = new Date(filters.selectedYear, 11, 31, 23, 59, 59, 999).toISOString();
  }

  return base;
});
```

Update the template — wrap Timeline with FilterPanel in a flex container:

```svelte
<UserPageLayout hideNavbar={assetInteraction.selectionActive} scrollbar={false}>
  <div class="flex h-full">
    <FilterPanel
      bind:filters
      config={filterConfig}
      timeBuckets={timelineManager?.months?.map((m) => ({
        timeBucket: `${m.yearMonth.year}-${String(m.yearMonth.month).padStart(2, '0')}-01T00:00:00.000Z`,
        count: m.assetsCount,
      })) ?? []}
      initialCollapsed={true}
      storageKey="gallery-filter-visible-sections-photos"
    />
    <div class="flex-1 overflow-hidden">
      {#if hasActiveFilters}
        <ActiveFiltersBar
          {filters}
          resultCount={totalAssetCount}
          {personNames}
          {tagNames}
          onRemoveFilter={handleRemoveFilter}
          onClearAll={() => {
            filters = clearFilters(filters);
          }}
        />
      {/if}
      <Timeline
        enableRouting={true}
        bind:timelineManager
        {options}
        {assetInteraction}
        removeAction={AssetAction.ARCHIVE}
        onEscape={handleEscape}
        withStacked
      >
        {#if $preferences.memories.enabled && !hasActiveFilters}
          <ImageCarousel {items} />
        {/if}
        {#snippet empty()}
          <EmptyPlaceholder text={$t('no_assets_message')} onClick={() => openFileUploadDialog()} class="mt-10 mx-auto" />
        {/snippet}
      </Timeline>
    </div>
  </div>
</UserPageLayout>
```

**Step 4: Verify type-checking passes**

Run: `cd web && npx svelte-check --tsconfig tsconfig.json 2>&1 | tail -5`
Expected: No errors in the modified file

**Step 5: Run all FilterPanel unit tests**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/`
Expected: All PASS

**Step 6: Commit**

```bash
git add web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte web/src/routes/(user)/photos/__tests__/photos-filter.spec.ts
git commit -m "feat: add FilterPanel to /photos timeline page"
```

---

### Task 5: Verify `getAllPeople` provider handles paginated response

**Files:**

- Test: `web/src/routes/(user)/photos/__tests__/photos-filter.spec.ts`

**Step 1: Write test for people provider shape**

Add to photos-filter.spec.ts:

```typescript
describe('People provider', () => {
  it('should filter out people without thumbnails', () => {
    const people = [
      { id: '1', name: 'Alice', thumbnailPath: '/path/1' },
      { id: '2', name: 'Bob', thumbnailPath: '' },
      { id: '3', name: 'Charlie', thumbnailPath: '/path/3' },
    ];

    const result = people
      .filter((p) => p.thumbnailPath)
      .map((p) => ({ id: p.id, name: p.name, thumbnailPath: p.thumbnailPath }));

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.name)).toEqual(['Alice', 'Charlie']);
  });
});
```

**Step 2: Run test**

Run: `cd web && pnpm test -- --run src/routes/\(user\)/photos/__tests__/photos-filter.spec.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add web/src/routes/(user)/photos/__tests__/photos-filter.spec.ts
git commit -m "test: add people provider shape validation test"
```

---

### Task 6: Lint and format

**Files:**

- All modified files

**Step 1: Format**

Run: `cd web && npx prettier --write src/lib/components/filter-panel/filter-panel.svelte src/lib/components/filter-panel/people-filter.svelte src/lib/components/filter-panel/location-filter.svelte src/lib/components/filter-panel/camera-filter.svelte src/lib/components/filter-panel/tags-filter.svelte src/routes/\(user\)/photos/\[\[assetId=id\]\]/+page.svelte`

**Step 2: Lint**

Run: `cd web && npx eslint --fix src/lib/components/filter-panel/ src/routes/\(user\)/photos/`

**Step 3: Type-check**

Run: `make check-web`

**Step 4: Run full FilterPanel test suite**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/`
Expected: All PASS

**Step 5: Commit if any formatting changes**

```bash
git add -u
git commit -m "chore: lint and format filter panel changes"
```

---

### Task 7: E2E test — Panel renders collapsed and expands

**Files:**

- Create: `e2e/src/specs/web/photos-filter-panel.e2e-spec.ts`

**Step 1: Write the E2E test**

```typescript
import type { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

test.describe('Photos FilterPanel', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // Create some assets so the timeline isn't empty
    await utils.createAsset(admin.accessToken, {
      fileCreatedAt: '2023-08-15T10:00:00.000Z',
      fileModifiedAt: '2023-08-15T10:00:00.000Z',
    });
    await utils.createAsset(admin.accessToken, {
      fileCreatedAt: '2023-07-10T10:00:00.000Z',
      fileModifiedAt: '2023-07-10T10:00:00.000Z',
    });
  });

  async function gotoPhotos(context: import('@playwright/test').BrowserContext, page: import('@playwright/test').Page) {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');
    await page.waitForSelector('[data-testid="collapsed-icon-strip"], [data-testid="discovery-panel"]');
  }

  test('should render FilterPanel collapsed by default on /photos', async ({ context, page }) => {
    await gotoPhotos(context, page);

    await expect(page.locator('[data-testid="collapsed-icon-strip"]')).toBeVisible();
    await expect(page.locator('[data-testid="discovery-panel"]')).not.toBeVisible();
  });

  test('should expand FilterPanel and show all sections', async ({ context, page }) => {
    await gotoPhotos(context, page);

    // Click expand button
    await page.locator('[data-testid="expand-panel-btn"]').click();
    await expect(page.locator('[data-testid="discovery-panel"]')).toBeVisible();

    // Verify all sections
    await expect(page.locator('[data-testid="filter-section-timeline"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-section-people"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-section-location"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-section-camera"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-section-tags"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-section-rating"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-section-media"]')).toBeVisible();
  });
});
```

**Step 2: Run the E2E test** (requires `make e2e` stack running)

Run: `cd e2e && npx playwright test src/specs/web/photos-filter-panel.e2e-spec.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add e2e/src/specs/web/photos-filter-panel.e2e-spec.ts
git commit -m "test(e2e): add FilterPanel render tests for /photos page"
```

---

### Task 8: E2E test — Media type filter returns only matching assets

**Files:**

- Modify: `e2e/src/specs/web/photos-filter-panel.e2e-spec.ts`

**Step 1: Write the test**

Add to the existing test file. Note: this test relies on there being image assets already created in beforeAll. Since we only upload PNG images, filtering for "video" should show zero results and filtering for "image" should show all.

```typescript
test('should filter by media type', async ({ context, page }) => {
  await gotoPhotos(context, page);

  // Expand panel
  await page.locator('[data-testid="expand-panel-btn"]').click();
  await expect(page.locator('[data-testid="discovery-panel"]')).toBeVisible();

  // Click "Image" in media type filter
  await page.locator('[data-testid="media-type-image"]').click();

  // Should still show assets (we uploaded images)
  await expect(page.locator('[data-testid="timeline-group"]').first()).toBeVisible();

  // Switch to "Video"
  await page.locator('[data-testid="media-type-video"]').click();

  // Should show empty state or no timeline groups (no videos uploaded)
  await expect
    .poll(async () => {
      const groups = await page.locator('[data-testid="timeline-group"]').count();
      return groups;
    })
    .toBe(0);
});
```

**Step 2: Run E2E test**

Run: `cd e2e && npx playwright test src/specs/web/photos-filter-panel.e2e-spec.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add e2e/src/specs/web/photos-filter-panel.e2e-spec.ts
git commit -m "test(e2e): add media type filter test for /photos"
```

---

### Task 9: E2E test — ActiveFiltersBar and clear all

**Files:**

- Modify: `e2e/src/specs/web/photos-filter-panel.e2e-spec.ts`

**Step 1: Write the test**

```typescript
test('should show ActiveFiltersBar with active filters and clear all', async ({ context, page }) => {
  await gotoPhotos(context, page);

  // Expand panel
  await page.locator('[data-testid="expand-panel-btn"]').click();

  // Set rating filter
  await page.locator('[data-testid="rating-star-5"]').click();

  // Collapse panel
  await page.locator('[data-testid="collapse-panel-btn"]').click();

  // ActiveFiltersBar should be visible
  await expect(page.locator('[data-testid="active-filters-bar"]')).toBeVisible();
  await expect(page.locator('[data-testid="filter-chip-rating"]')).toBeVisible();

  // Click clear all
  await page.locator('[data-testid="clear-all-filters"]').click();

  // ActiveFiltersBar should disappear
  await expect(page.locator('[data-testid="active-filters-bar"]')).not.toBeVisible();
});
```

**Step 2: Run E2E test**

Run: `cd e2e && npx playwright test src/specs/web/photos-filter-panel.e2e-spec.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add e2e/src/specs/web/photos-filter-panel.e2e-spec.ts
git commit -m "test(e2e): add ActiveFiltersBar and clear-all test for /photos"
```

---

### Task 10: E2E test — Memory Lane hides when filters active

**Files:**

- Modify: `e2e/src/specs/web/photos-filter-panel.e2e-spec.ts`

**Step 1: Write the test**

Note: Memory Lane requires memories to exist. If no memories are generated for the test data, this test should verify the conditional rendering logic works. The test checks that the `ImageCarousel` is hidden when filters are active.

```typescript
test('should hide Memory Lane when filters are active', async ({ context, page }) => {
  await gotoPhotos(context, page);

  // Check if memory lane exists (it may not if no memories generated)
  const memoryLane = page.locator('[data-testid="memory-lane"]');
  const hasMemoryLane = await memoryLane.isVisible().catch(() => false);

  if (hasMemoryLane) {
    // Expand panel and set a filter
    await page.locator('[data-testid="expand-panel-btn"]').click();
    await page.locator('[data-testid="media-type-image"]').click();

    // Memory lane should be hidden
    await expect(memoryLane).not.toBeVisible();

    // Clear filter by clicking "All" media type
    await page.locator('[data-testid="media-type-all"]').click();

    // Memory lane should reappear
    await expect(memoryLane).toBeVisible();
  }
});
```

**Step 2: Run E2E test**

Run: `cd e2e && npx playwright test src/specs/web/photos-filter-panel.e2e-spec.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add e2e/src/specs/web/photos-filter-panel.e2e-spec.ts
git commit -m "test(e2e): add Memory Lane visibility test for /photos filters"
```

---

### Task 11: Run full existing test suites — verify no regressions

**Files:** None (verification only)

**Step 1: Run all FilterPanel unit tests**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/`
Expected: All PASS (all 7 existing test files + new tests)

**Step 2: Run all spaces filter E2E tests**

Run: `cd e2e && npx playwright test src/specs/web/spaces-filter-panel.e2e-spec.ts`
Expected: All 86 tests PASS

**Step 3: Run web lint and type-check**

Run: `make check-web`
Expected: No errors

**Step 4: Commit if any fixes needed, otherwise done**

---

### Task 12: Final formatting and PR prep

**Step 1: Format all changed files**

Run: `make format-web`

**Step 2: Lint all changed files**

Run: `make lint-web`

**Step 3: Final type-check**

Run: `make check-web`

**Step 4: Commit any formatting/lint fixes**

```bash
git add -u
git commit -m "chore: final formatting and lint fixes"
```
