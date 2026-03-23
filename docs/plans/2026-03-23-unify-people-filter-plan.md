# Unify People Strip with Filter Panel — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the people strip and filter panel share a single `filters` state so clicking a person in the strip updates the filter panel and vice versa.

**Architecture:** Replace FilterPanel's internal filter state with a `$bindable()` prop owned by the page. Change SpacePeopleStrip from single-select (`selectedPersonId`) to multi-select (`selectedPersonIds`). Remove the redundant `selectedPersonId` state from the space page.

**Tech Stack:** Svelte 5 (runes, `$bindable`), Tailwind CSS 4, Vitest + @testing-library/svelte

**Design doc:** `docs/plans/2026-03-23-unify-people-filter-design.md`

---

### Task 1: Update SpacePeopleStrip to multi-select

**Files:**

- Modify: `web/src/lib/components/spaces/space-people-strip.svelte`
- Modify: `web/src/lib/components/spaces/space-people-strip.spec.ts`

**Step 1: Update tests for multi-select prop**

In `space-people-strip.spec.ts`, change the two selection tests and add a multi-select test.

Replace the test at line 53 (`should show selected state with ring when selectedPersonId matches`):

```typescript
it('should show selected state with ring when person is in selectedPersonIds', () => {
  const people = [makePerson({ id: 'p1', name: 'Alice' })];
  render(SpacePeopleStrip, { people, spaceId: 'space-1', selectedPersonIds: ['p1'] });
  const ring = screen.getByTestId('person-ring-p1');
  expect(ring.className).toContain('ring-2');
});
```

Replace the test at line 60 (`should not show ring when not selected`):

```typescript
it('should not show ring when person is not in selectedPersonIds', () => {
  const people = [makePerson({ id: 'p1', name: 'Alice' })];
  render(SpacePeopleStrip, { people, spaceId: 'space-1', selectedPersonIds: [] });
  const ring = screen.getByTestId('person-ring-p1');
  expect(ring.className).not.toContain('ring-2');
});
```

Add a new test after the ring tests:

```typescript
it('should highlight multiple selected people', () => {
  const people = [
    makePerson({ id: 'p1', name: 'Alice' }),
    makePerson({ id: 'p2', name: 'Bob' }),
    makePerson({ id: 'p3', name: 'Carol' }),
  ];
  render(SpacePeopleStrip, { people, spaceId: 'space-1', selectedPersonIds: ['p1', 'p3'] });
  expect(screen.getByTestId('person-ring-p1').className).toContain('ring-2');
  expect(screen.getByTestId('person-ring-p2').className).not.toContain('ring-2');
  expect(screen.getByTestId('person-ring-p3').className).toContain('ring-2');
});
```

**Step 2: Run tests to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/components/spaces/space-people-strip.spec.ts`

Expected: The 3 modified/new tests FAIL (prop `selectedPersonIds` doesn't exist yet).

**Step 3: Update the component**

In `space-people-strip.svelte`:

Change the `Props` interface (line 11):

```typescript
selectedPersonIds?: string[];
```

Change the destructuring (line 15):

```typescript
let { people, spaceId, selectedPersonIds = [], onPersonClick }: Props = $props();
```

Change the ring class (line 39):

```
{selectedPersonIds.includes(person.id) ? 'ring-2 ring-offset-2 ring-immich-primary' : ''}"
```

Change the text class (line 51):

```
class="w-full truncate text-center text-xs {selectedPersonIds.includes(person.id)
  ? 'font-semibold text-immich-primary'
  : 'text-gray-600 dark:text-gray-400'}"
```

**Step 4: Run tests**

Run: `cd web && pnpm test -- --run src/lib/components/spaces/space-people-strip.spec.ts`

Expected: ALL tests pass.

**Step 5: Lint and format**

Run: `cd web && npx prettier --write src/lib/components/spaces/space-people-strip.svelte src/lib/components/spaces/space-people-strip.spec.ts`

**Step 6: Commit**

```bash
git add web/src/lib/components/spaces/space-people-strip.svelte web/src/lib/components/spaces/space-people-strip.spec.ts
git commit -m "refactor: change SpacePeopleStrip to multi-select via selectedPersonIds prop"
```

---

### Task 2: Make FilterPanel use bindable filters prop

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.svelte`
- Modify: `web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`

**Step 1: Update FilterPanel component**

In `filter-panel.svelte`, change the Props interface and state:

Replace lines 25-33:

```typescript
interface Props {
  config: FilterPanelConfig;
  timeBuckets: Array<{ timeBucket: string; count: number }>;
  onFilterChange?: (filters: FilterState) => void;
}

let { config, timeBuckets, onFilterChange }: Props = $props();
let collapsed = $state(false);
let filters = $state(createFilterState());
```

With:

```typescript
interface Props {
  config: FilterPanelConfig;
  timeBuckets: Array<{ timeBucket: string; count: number }>;
  filters?: FilterState;
  onFilterChange?: (filters: FilterState) => void;
}

let { config, timeBuckets, filters = $bindable(createFilterState()), onFilterChange }: Props = $props();
let collapsed = $state(false);
```

This makes `filters` a `$bindable` prop with a default. When used with `bind:filters`, the page and FilterPanel share the same reactive state. The `onFilterChange` callback is kept as optional for backward compatibility but the `notifyFilterChange` function can still call it.

**Step 2: Run existing tests**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`

Expected: ALL existing tests pass (backward compatible — `onFilterChange` still works, internal state still initializes via default).

**Step 3: Lint and format**

Run: `cd web && npx prettier --write src/lib/components/filter-panel/filter-panel.svelte`

**Step 4: Commit**

```bash
git add web/src/lib/components/filter-panel/filter-panel.svelte
git commit -m "refactor: make FilterPanel filters a bindable prop for external state sync"
```

---

### Task 3: Wire everything together in the space page

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`

**Step 1: Remove selectedPersonId state**

Delete line 104:

```typescript
let selectedPersonId = $state<string | null>(null);
```

**Step 2: Change handlePersonClick to toggle in filters.personIds**

Replace lines 282-284:

```typescript
const handlePersonClick = (personId: string) => {
  selectedPersonId = selectedPersonId === personId ? null : personId;
};
```

With:

```typescript
const handlePersonClick = (personId: string) => {
  const current = filters.personIds;
  filters = {
    ...filters,
    personIds: current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId],
  };
};
```

**Step 3: Remove spacePersonId from options derived**

In the `options` derived (line 192), remove lines 197-199:

```typescript
if (selectedPersonId) {
  base.spacePersonId = selectedPersonId;
}
```

The person filtering now only goes through `spacePersonIds` (plural) via `filters.personIds` on lines 201-203.

**Step 4: Update FilterPanel usage to bind:filters**

Replace lines 618-627:

```svelte
<FilterPanel
  config={filterConfig}
  timeBuckets={timelineManager?.months?.map((m) => ({
    timeBucket: `${m.yearMonth.year}-${String(m.yearMonth.month).padStart(2, '0')}-01T00:00:00.000Z`,
    count: m.assetsCount,
  })) ?? []}
  onFilterChange={(f) => {
    filters = { ...f, sortOrder: filters.sortOrder };
  }}
/>
```

With:

```svelte
<FilterPanel
  config={filterConfig}
  bind:filters
  timeBuckets={timelineManager?.months?.map((m) => ({
    timeBucket: `${m.yearMonth.year}-${String(m.yearMonth.month).padStart(2, '0')}-01T00:00:00.000Z`,
    count: m.assetsCount,
  })) ?? []}
/>
```

Note: the `sortOrder` preservation from `onFilterChange` is no longer needed because the page and FilterPanel now share the same `filters` object. The `sortOrder` field is only modified by the `SortToggle` component on the page, and since both sides share the same object, it stays in sync automatically.

**Step 5: Update SpacePeopleStrip usage**

Replace lines 720-725:

```svelte
<SpacePeopleStrip
  people={spacePeople}
  spaceId={space.id}
  {selectedPersonId}
  onPersonClick={handlePersonClick}
/>
```

With:

```svelte
<SpacePeopleStrip
  people={spacePeople}
  spaceId={space.id}
  selectedPersonIds={filters.personIds}
  onPersonClick={handlePersonClick}
/>
```

**Step 6: Format and lint**

Run: `cd web && npx prettier --write "src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte"`

**Step 7: Run type check**

Run: `cd web && npx tsc --noEmit`

Expected: No new type errors.

**Step 8: Commit**

```bash
git add "web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte"
git commit -m "feat: unify people strip selection with filter panel via shared filters state"
```

---

### Task 4: Final verification

**Step 1: Run all space-related tests**

Run: `cd web && pnpm test -- --run src/lib/components/spaces/space-people-strip.spec.ts`

Expected: ALL pass.

**Step 2: Run filter panel tests**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`

Expected: ALL pass.

**Step 3: Run full web test suite**

Run: `cd web && pnpm test`

Expected: All tests pass.

**Step 4: Run lint and type check**

Run: `make lint-web && make check-web`

Expected: Zero warnings, zero errors.

**Step 5: Manual visual verification**

If dev stack is running:

1. Navigate to a space with people — click a face in the strip → filter panel should show that person selected, ActiveFiltersBar shows chip, hero auto-collapses
2. Click another face → both people highlighted in strip, both shown in filter panel
3. Click a selected face → deselects, removed from filter panel
4. Select a person via the filter panel → strip highlights them
5. Remove person chip from ActiveFiltersBar → strip deselects, filter panel deselects
6. Clear all filters → everything deselects
