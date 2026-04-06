# Filter & Space Hero localStorage Persistence — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist filter panel collapsed state (global), filter section accordion state (global), and space hero collapsed state (per-space) in localStorage so they survive page reloads.

**Architecture:** Inline `localStorage.getItem`/`setItem` with `browser` guard and `try/catch`, following the existing visible-sections pattern in `filter-panel.svelte`. Space hero helpers extracted into a standalone utility for testability.

**Tech Stack:** Svelte 5 (`$state`, `$effect`, `SvelteSet`), SvelteKit (`$app/environment` → `browser`), Vitest, @testing-library/svelte

---

### Task 1: Space Hero Storage Utility — Tests

**Files:**

- Create: `web/src/lib/utils/space-hero-storage.spec.ts`

**Step 1: Write tests for `loadHeroCollapsed` and `persistHeroCollapsed`**

```typescript
import { loadHeroCollapsed, persistHeroCollapsed } from './space-hero-storage';

const STORAGE_KEY = 'gallery-space-hero-collapsed';

describe('space-hero-storage', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  describe('loadHeroCollapsed', () => {
    it('should return false when no localStorage entry exists', () => {
      expect(loadHeroCollapsed('space-1')).toBe(false);
    });

    it('should return stored value for a known spaceId', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'space-1': true }));
      expect(loadHeroCollapsed('space-1')).toBe(true);
    });

    it('should return false for an unknown spaceId in existing record', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'space-1': true }));
      expect(loadHeroCollapsed('space-2')).toBe(false);
    });

    it('should return false when localStorage contains invalid JSON', () => {
      localStorage.setItem(STORAGE_KEY, '{corrupted!!!');
      expect(loadHeroCollapsed('space-1')).toBe(false);
    });
  });

  describe('persistHeroCollapsed', () => {
    it('should create a new record when none exists', () => {
      persistHeroCollapsed('space-1', true);
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, boolean>;
      expect(stored['space-1']).toBe(true);
    });

    it('should update existing record without losing other entries', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'space-1': true }));
      persistHeroCollapsed('space-2', true);
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, boolean>;
      expect(stored['space-1']).toBe(true);
      expect(stored['space-2']).toBe(true);
    });

    it('should overwrite value for existing spaceId', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'space-1': true }));
      persistHeroCollapsed('space-1', false);
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, boolean>;
      expect(stored['space-1']).toBe(false);
    });
  });
});
```

**Step 2: Run tests — verify they fail**

Run: `cd web && pnpm test -- --run src/lib/utils/space-hero-storage.spec.ts`
Expected: FAIL — module `./space-hero-storage` not found

**Step 3: Commit failing test**

```bash
git add web/src/lib/utils/space-hero-storage.spec.ts
git commit -m "test: add failing tests for space hero localStorage utility"
```

---

### Task 2: Space Hero Storage Utility — Implementation

**Files:**

- Create: `web/src/lib/utils/space-hero-storage.ts`

**Step 1: Implement the utility**

```typescript
import { browser } from '$app/environment';

const STORAGE_KEY = 'gallery-space-hero-collapsed';

export function loadHeroCollapsed(spaceId: string): boolean {
  if (browser) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const record = JSON.parse(raw) as Record<string, boolean>;
        return record[spaceId] ?? false;
      }
    } catch {
      /* corrupted JSON — fall through */
    }
  }
  return false;
}

export function persistHeroCollapsed(spaceId: string, collapsed: boolean): void {
  if (browser) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const record: Record<string, boolean> = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
      record[spaceId] = collapsed;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch {
      /* localStorage unavailable */
    }
  }
}
```

**Step 2: Run tests — verify they pass**

Run: `cd web && pnpm test -- --run src/lib/utils/space-hero-storage.spec.ts`
Expected: PASS (7 tests)

**Step 3: Commit**

```bash
git add web/src/lib/utils/space-hero-storage.ts
git commit -m "feat: add space hero localStorage persistence utility"
```

---

### Task 3: Make FilterSection Controlled

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-section.svelte` (entire file, 57 lines)

**Step 1: Update FilterSection to accept `expanded` and `onToggleExpanded` props**

Replace the Props interface and state in `filter-section.svelte`:

```typescript
// Old (lines 6-14):
interface Props {
  title: string;
  testId: string;
  children: Snippet;
  refetching?: boolean;
  count?: number;
}

let { title, testId, children, refetching = false, count }: Props = $props();
let expanded = $state(true);

// New:
interface Props {
  title: string;
  testId: string;
  children: Snippet;
  refetching?: boolean;
  count?: number;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

let { title, testId, children, refetching = false, count, expanded = true, onToggleExpanded }: Props = $props();
```

Update the click handler (line 24-28):

```svelte
<!-- Old: -->
onclick={() => {
  if (!isEmpty) {
    expanded = !expanded;
  }
}}

<!-- New: -->
onclick={() => {
  if (!isEmpty && onToggleExpanded) {
    onToggleExpanded();
  }
}}
```

**Important:** When `onToggleExpanded` is not provided (backwards compat during transition), the section becomes inert — it just shows whatever `expanded` is. This is fine because FilterPanel will always provide both props.

**Step 2: Run existing filter-panel tests to verify no regression**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`
Expected: PASS — FilterSection still defaults `expanded=true` and existing tests don't click section headers

**Step 3: Commit**

```bash
git add web/src/lib/components/filter-panel/filter-section.svelte
git commit -m "refactor: make FilterSection accept controlled expanded prop"
```

---

### Task 4: Filter Panel Collapsed Persistence — Tests

**Files:**

- Modify: `web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`

**Step 1: Replace `initialCollapsed` test block with localStorage persistence tests**

Replace the `describe('initialCollapsed prop')` block (lines 120-143) with:

```typescript
describe('collapsed state persistence', () => {
  const COLLAPSED_KEY = 'gallery-filter-collapsed';

  beforeEach(() => {
    localStorage.removeItem(COLLAPSED_KEY);
  });

  it('should start expanded when no localStorage entry exists (first visit)', () => {
    render(FilterPanel, {
      props: {
        config: { sections: ['rating', 'media'], providers: {} },
        timeBuckets: [],
      },
    });
    expect(screen.getByTestId('discovery-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('collapsed-icon-strip')).not.toBeInTheDocument();
  });

  it('should start collapsed when localStorage has true', () => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(true));
    render(FilterPanel, {
      props: {
        config: { sections: ['rating', 'media'], providers: {} },
        timeBuckets: [],
      },
    });
    expect(screen.getByTestId('collapsed-icon-strip')).toBeInTheDocument();
    expect(screen.queryByTestId('discovery-panel')).not.toBeInTheDocument();
  });

  it('should persist collapsed state to localStorage when user collapses', async () => {
    render(FilterPanel, {
      props: {
        config: { sections: ['rating'], providers: {} },
        timeBuckets: [],
      },
    });
    await fireEvent.click(screen.getByTestId('collapse-panel-btn'));
    expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? 'null')).toBe(true);
  });

  it('should persist expanded state to localStorage when user expands', async () => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(true));
    render(FilterPanel, {
      props: {
        config: { sections: ['rating'], providers: {} },
        timeBuckets: [],
      },
    });
    await fireEvent.click(screen.getByTestId('expand-panel-btn'));
    expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? 'null')).toBe(false);
  });

  it('should not persist collapsed state when persistCollapsed is false', async () => {
    render(FilterPanel, {
      props: {
        config: { sections: ['rating'], providers: {} },
        timeBuckets: [],
        persistCollapsed: false,
      },
    });
    await fireEvent.click(screen.getByTestId('collapse-panel-btn'));
    expect(localStorage.getItem(COLLAPSED_KEY)).toBeNull();
  });

  it('should always start expanded when persistCollapsed is false regardless of localStorage', () => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(true));
    render(FilterPanel, {
      props: {
        config: { sections: ['rating'], providers: {} },
        timeBuckets: [],
        persistCollapsed: false,
      },
    });
    expect(screen.getByTestId('discovery-panel')).toBeInTheDocument();
  });
});
```

Also update the `hidden` test that references `initialCollapsed` (line 218-229):

```typescript
// Old (line 218):
it('should render nothing when hidden and initialCollapsed are both true', () => {
  render(FilterPanel, {
    props: {
      config: { sections: ['rating'], providers: {} },
      timeBuckets: [],
      hidden: true,
      initialCollapsed: true,
    },
  });

// New:
it('should render nothing when hidden and collapsed in localStorage', () => {
  localStorage.setItem('gallery-filter-collapsed', JSON.stringify(true));
  render(FilterPanel, {
    props: {
      config: { sections: ['rating'], providers: {} },
      timeBuckets: [],
      hidden: true,
    },
  });
```

**Step 2: Run tests — verify they fail**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`
Expected: FAIL — `initialCollapsed` prop removed but component still has it; localStorage tests fail because component doesn't read from it yet

**Step 3: Commit**

```bash
git add web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts
git commit -m "test: add failing tests for filter panel collapsed localStorage persistence"
```

---

### Task 5: Filter Panel Collapsed Persistence — Implementation

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.svelte` (lines 37-54)

**Step 1: Update FilterPanel Props and collapsed initialization**

In `filter-panel.svelte`, update the Props interface (lines 37-44):

```typescript
// Old:
interface Props {
  config: FilterPanelConfig;
  timeBuckets: Array<{ timeBucket: string; count: number }>;
  filters?: FilterState;
  initialCollapsed?: boolean;
  storageKey?: string;
  hidden?: boolean;
}

// New:
interface Props {
  config: FilterPanelConfig;
  timeBuckets: Array<{ timeBucket: string; count: number }>;
  filters?: FilterState;
  storageKey?: string;
  hidden?: boolean;
  persistCollapsed?: boolean;
}
```

Update the props destructuring (lines 46-53):

```typescript
// Old:
let {
  config,
  timeBuckets,
  filters = $bindable(createFilterState()),
  initialCollapsed = false,
  storageKey = 'gallery-filter-visible-sections',
  hidden = false,
}: Props = $props();
let collapsed = $state(initialCollapsed);

// New:
const COLLAPSED_KEY = 'gallery-filter-collapsed';

let {
  config,
  timeBuckets,
  filters = $bindable(createFilterState()),
  storageKey = 'gallery-filter-visible-sections',
  hidden = false,
  persistCollapsed = true,
}: Props = $props();

function loadCollapsed(): boolean {
  if (persistCollapsed && browser) {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      if (raw !== null) {
        return JSON.parse(raw) as boolean;
      }
    } catch {
      /* corrupted — fall through */
    }
  }
  return false;
}

let collapsed = $state(loadCollapsed());
```

Add a `$effect` to persist collapsed state. Place it right after the existing `$effect` for `visibleSections` persistence (after line 360):

```typescript
$effect(() => {
  if (persistCollapsed && browser) {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
    } catch {
      /* localStorage unavailable */
    }
  }
});
```

**Step 2: Remove `initialCollapsed` from photos page**

In `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`, line 188, delete:

```
      initialCollapsed={true}
```

**Step 3: Add `persistCollapsed={false}` to map mobile FilterPanel**

In `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte`, the mobile FilterPanel instance (line 205):

```svelte
<!-- Old: -->
<FilterPanel
  bind:filters
  config={filterConfig}
  {timeBuckets}
  storageKey="gallery-filter-visible-sections-map"
/>

<!-- New: -->
<FilterPanel
  bind:filters
  config={filterConfig}
  {timeBuckets}
  storageKey="gallery-filter-visible-sections-map"
  persistCollapsed={false}
/>
```

**Step 4: Run tests — verify they pass**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`
Expected: PASS

**Step 5: Run type check**

Run: `cd web && npx svelte-check --tsconfig tsconfig.json 2>&1 | tail -20`
Expected: No new errors (verifies `initialCollapsed` removal doesn't break anything)

**Step 6: Commit**

```bash
git add web/src/lib/components/filter-panel/filter-panel.svelte \
       web/src/routes/'(user)'/photos/'[[assetId=id]]'/+page.svelte \
       web/src/routes/'(user)'/map/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte
git commit -m "feat: persist filter panel collapsed state in localStorage"
```

---

### Task 6: Filter Section Accordion Persistence — Tests

**Files:**

- Modify: `web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`

**Step 1: Add tests for expanded sections persistence**

Add a new `describe` block at the bottom of the file:

```typescript
describe('Section Accordion Persistence', () => {
  const EXPANDED_KEY = 'gallery-filter-expanded-sections';

  beforeEach(() => {
    localStorage.removeItem(EXPANDED_KEY);
  });

  function renderPanel(
    sections: FilterSection[] = ['timeline', 'people', 'location', 'camera', 'tags', 'rating', 'media'],
  ) {
    return render(FilterPanel, {
      props: {
        config: { sections: [...sections], providers: {} },
        timeBuckets: sections.includes('timeline')
          ? [
              { timeBucket: '2023-06-01', count: 100 },
              { timeBucket: '2023-08-01', count: 200 },
            ]
          : [],
      },
    });
  }

  it('should default all sections to expanded on first visit', () => {
    renderPanel(['people', 'rating']);
    // Section content should be visible (expanded)
    expect(screen.getByTestId('filter-section-people')).toBeTruthy();
    expect(screen.getByTestId('filter-section-rating')).toBeTruthy();
  });

  it('should persist collapsed section to localStorage when header is clicked', async () => {
    renderPanel(['people', 'rating']);
    // Click the section header to collapse
    const peopleHeader = screen.getByTestId('filter-section-people').querySelector('button')!;
    await fireEvent.click(peopleHeader);
    const stored = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[];
    expect(stored).not.toContain('people');
    expect(stored).toContain('rating');
  });

  it('should restore collapsed sections from localStorage on mount', () => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(['rating']));
    renderPanel(['people', 'rating']);
    // People section content should be hidden (collapsed), rating visible
    const peopleContent = screen.getByTestId('filter-section-people').querySelector('.filter-section-content');
    const ratingContent = screen.getByTestId('filter-section-rating').querySelector('.filter-section-content');
    expect(peopleContent).toBeNull();
    expect(ratingContent).toBeTruthy();
  });

  it('should ignore unknown section types in localStorage', () => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(['people', 'nonexistent']));
    renderPanel(['people', 'rating']);
    // People is in the stored list so it's expanded, rating is not so it's collapsed
    const peopleContent = screen.getByTestId('filter-section-people').querySelector('.filter-section-content');
    expect(peopleContent).toBeTruthy();
  });

  it('should fall back to all-expanded when localStorage has invalid JSON', () => {
    localStorage.setItem(EXPANDED_KEY, 'not-valid-json!!!');
    renderPanel(['people', 'rating']);
    const peopleContent = screen.getByTestId('filter-section-people').querySelector('.filter-section-content');
    const ratingContent = screen.getByTestId('filter-section-rating').querySelector('.filter-section-content');
    expect(peopleContent).toBeTruthy();
    expect(ratingContent).toBeTruthy();
  });

  it('should expand a collapsed section when header is clicked again', async () => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(['rating']));
    renderPanel(['people', 'rating']);
    // People is collapsed — click to expand
    const peopleHeader = screen.getByTestId('filter-section-people').querySelector('button')!;
    await fireEvent.click(peopleHeader);
    const stored = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[];
    expect(stored).toContain('people');
    expect(stored).toContain('rating');
  });
});
```

You'll also need to import `FilterSection` type at the top of the test file:

```typescript
import type { FilterSection } from '../filter-panel';
```

**Step 2: Run tests — verify they fail**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`
Expected: FAIL — persistence tests fail because FilterPanel doesn't pass `expanded`/`onToggleExpanded` to FilterSection yet

**Step 3: Commit**

```bash
git add web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts
git commit -m "test: add failing tests for filter section accordion localStorage persistence"
```

---

### Task 7: Filter Section Accordion Persistence — Implementation

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.svelte`

**Step 1: Add expandedSections state and persistence**

After `let visibleSections = $state(...)` (line 336), add:

```typescript
const EXPANDED_SECTIONS_KEY = 'gallery-filter-expanded-sections';

function loadExpandedSections(configSections: FilterSectionType[]): SvelteSet<FilterSectionType> {
  if (browser) {
    try {
      const raw = localStorage.getItem(EXPANDED_SECTIONS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        const valid = parsed.filter((s): s is FilterSectionType => configSections.includes(s as FilterSectionType));
        if (valid.length > 0) {
          return new SvelteSet(valid);
        }
      }
    } catch {
      /* corrupted JSON — fall through to default */
    }
  }
  return new SvelteSet(configSections);
}

let expandedSections = $state(loadExpandedSections(config.sections));

function toggleSectionExpanded(section: FilterSectionType) {
  const next = new SvelteSet(expandedSections);
  if (next.has(section)) {
    next.delete(section);
  } else {
    next.add(section);
  }
  expandedSections = next;
}
```

Add a `$effect` to persist (after the collapsed persistence `$effect`):

```typescript
$effect(() => {
  if (browser) {
    try {
      localStorage.setItem(EXPANDED_SECTIONS_KEY, JSON.stringify([...expandedSections]));
    } catch {
      /* localStorage unavailable */
    }
  }
});
```

**Step 2: Pass `expanded` and `onToggleExpanded` to each FilterSection**

In the template `{#each}` block (around line 559), update the `<FilterSection>` tag:

```svelte
<!-- Old: -->
<FilterSection
  title={sectionTitles[section]}
  testId={section}
  refetching={isRefetching && section !== 'timeline'}
  count={...}
>

<!-- New: -->
<FilterSection
  title={sectionTitles[section]}
  testId={section}
  refetching={isRefetching && section !== 'timeline'}
  count={...}
  expanded={expandedSections.has(section)}
  onToggleExpanded={() => toggleSectionExpanded(section)}
>
```

**Step 3: Run tests — verify they pass**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add web/src/lib/components/filter-panel/filter-panel.svelte
git commit -m "feat: persist filter section accordion state in localStorage"
```

---

### Task 8: Space Hero Persistence — Integration

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`

**Step 1: Import the utility and wire up persistence**

Add import at top of script (with other imports):

```typescript
import { loadHeroCollapsed, persistHeroCollapsed } from '$lib/utils/space-hero-storage';
```

Update state declaration (line 154):

```typescript
// Old:
let heroCollapsed = $state(false);

// New:
let heroCollapsed = $state(loadHeroCollapsed(data.space.id));
```

Update the space navigation sync effect (line 127):

```typescript
// Old:
heroCollapsed = false;

// New:
heroCollapsed = loadHeroCollapsed(data.space.id);
```

Create a named toggle function and update the SpaceHero callback (around line 908-909):

Add this function near `heroCollapsed` declaration:

```typescript
function toggleHeroCollapsed() {
  heroCollapsed = !heroCollapsed;
  persistHeroCollapsed(space.id, heroCollapsed);
}
```

Update the SpaceHero props:

```svelte
<!-- Old: -->
collapsed={heroCollapsed}
onToggleCollapse={() => (heroCollapsed = !heroCollapsed)}

<!-- New: -->
collapsed={heroCollapsed}
onToggleCollapse={toggleHeroCollapsed}
```

The auto-collapse `$effect` (lines 157-163) stays unchanged — it sets `heroCollapsed = true` without calling `persistHeroCollapsed`, so auto-collapse is not persisted.

**Step 2: Run type check**

Run: `cd web && npx svelte-check --tsconfig tsconfig.json 2>&1 | tail -20`
Expected: No errors

**Step 3: Commit**

```bash
git add web/src/routes/'(user)'/spaces/'[spaceId]'/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte
git commit -m "feat: persist space hero collapsed state per-space in localStorage"
```

---

### Task 9: Cleanup and Final Verification

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.ts` (remove unused `FilterViewState`)

**Step 1: Remove unused `FilterViewState` interface**

In `filter-panel.ts` (lines 63-66), delete:

```typescript
// Client-only view state (not sent to server)
export interface FilterViewState {
  collapsed: boolean;
}
```

This interface was never used and is now superseded by the localStorage approach.

**Step 2: Run all filter-panel tests**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`
Expected: PASS (all tests)

**Step 3: Run full web test suite**

Run: `cd web && pnpm test`
Expected: PASS (no regressions)

**Step 4: Run type check**

Run: `cd web && npx svelte-check --tsconfig tsconfig.json 2>&1 | tail -20`
Expected: No errors

**Step 5: Commit**

```bash
git add web/src/lib/components/filter-panel/filter-panel.ts
git commit -m "chore: remove unused FilterViewState interface"
```
