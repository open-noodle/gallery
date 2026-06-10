# People Sort — Slice 1 (Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User-controlled People-view sort (Name A–Z / Most photos) on the web app, persisted per device, defaulting to Most photos.

**Architecture:** A `PeopleSortBy` preference in the existing localStorage-persisted store (`preferences.store.ts`), a parameterized comparator in `people-utils.ts` (tiers: hidden → favorites → named → unnamed; mode only changes within-tier order), and the existing `Dropdown` element wired into the people page and spaces people page headers. No server/SDK changes — `numberOfAssets` is already populated for every person on the paths these pages use.

**Tech Stack:** SvelteKit + Svelte 5 runes, svelte-persisted-store, @immich/ui, vitest + @testing-library/svelte (happy-dom).

**Spec:** `docs/superpowers/specs/2026-06-10-people-sort-design.md` (read the Sort semantics table and Edge cases matrix before starting).

**Worktree:** all paths relative to repo root. Run web commands from `web/` (pnpm is mise-managed: `export PATH="$HOME/.local/share/mise/shims:$PATH"` if a non-login shell).

**Critical invariants:**

- `sortPeopleForManagement` / `comparePeopleForManagement` (and their `*ByFavoriteAndName` aliases) MUST keep today's name-first semantics — `web/src/lib/managers/cmdk-prefix.ts:31` depends on them. They become thin Name-mode wrappers.
- The persisted store is module-level state: every test file touching it MUST reset it in `beforeEach`.
- Unknown persisted `sortBy` values behave as the default (PhotoCount) — never crash.

---

### Task 1: `PeopleSortBy` preference + parameterized comparator

**Files:**

- Modify: `web/src/lib/stores/preferences.store.ts` (after the `albumViewSettings` export, ~line 122)
- Modify: `web/src/lib/utils/people-utils.ts:19-58`
- Test: `web/src/lib/utils/people-utils.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `web/src/lib/utils/people-utils.spec.ts`, change the people-utils import line (line 3) to:

```ts
import { getBoundingBox, sortPeople, sortPeopleForManagement, zoomImageToBase64 } from '$lib/utils/people-utils';
```

Add below it:

```ts
import { PeopleSortBy, peopleViewSettings } from '$lib/stores/preferences.store';
import { get } from 'svelte/store';
```

Append this describe block after the existing `describe('sortPeopleForManagement', ...)` block (keep that block unchanged — it pins the Name-mode wrapper used by cmdk):

```ts
describe('sortPeople', () => {
  it('defaults the people view preference to Most photos', () => {
    // vitest isolates modules per spec file, so this reads the store's pristine default
    expect(get(peopleViewSettings).sortBy).toBe(PeopleSortBy.PhotoCount);
  });

  const p = (overrides: {
    id: string;
    name?: string | null;
    isFavorite?: boolean;
    numberOfAssets?: number;
    assetCount?: number;
    isHidden?: boolean;
  }) => overrides;

  describe('PhotoCount mode', () => {
    it('sorts named people by count descending with name then id tiebreaks, unnamed last', () => {
      const people = [
        p({ id: 'named-mid', name: 'Zoe', numberOfAssets: 50 }),
        p({ id: 'unnamed-high', name: '', numberOfAssets: 999 }),
        p({ id: 'named-top', name: 'Mara', numberOfAssets: 100 }),
        p({ id: 'tie-b', name: 'bob', numberOfAssets: 10 }),
        p({ id: 'tie-a', name: 'Alice', numberOfAssets: 10 }),
      ];

      expect(sortPeople(people, PeopleSortBy.PhotoCount).map((person) => person.id)).toEqual([
        'named-top',
        'named-mid',
        'tie-a',
        'tie-b',
        'unnamed-high',
      ]);
    });

    it('keeps favorites first, named favorites before unnamed favorites', () => {
      const people = [
        p({ id: 'named-big', name: 'Anna', numberOfAssets: 500 }),
        p({ id: 'fav-unnamed', name: '', isFavorite: true, numberOfAssets: 3 }),
        p({ id: 'fav-named', name: 'Zoe', isFavorite: true, numberOfAssets: 1 }),
      ];

      expect(sortPeople(people, PeopleSortBy.PhotoCount).map((person) => person.id)).toEqual([
        'fav-named',
        'fav-unnamed',
        'named-big',
      ]);
    });

    it('breaks equal-count ties among unnamed people by id, treating whitespace names as unnamed', () => {
      const people = [
        p({ id: 'u-b', name: '', numberOfAssets: 5 }),
        p({ id: 'u-a', name: '  ', numberOfAssets: 5 }),
      ];

      expect(sortPeople(people, PeopleSortBy.PhotoCount).map((person) => person.id)).toEqual(['u-a', 'u-b']);
    });
  });

  describe('Name mode', () => {
    it('sorts named people A–Z case-insensitively ignoring counts, unnamed by count last', () => {
      const people = [
        p({ id: 'unnamed-low', name: '', numberOfAssets: 1 }),
        p({ id: 'named-b', name: 'bob', numberOfAssets: 999 }),
        p({ id: 'unnamed-high', name: '   ', numberOfAssets: 50 }),
        p({ id: 'named-a', name: 'Alice', numberOfAssets: 1 }),
      ];

      expect(sortPeople(people, PeopleSortBy.Name).map((person) => person.id)).toEqual([
        'named-a',
        'named-b',
        'unnamed-high',
        'unnamed-low',
      ]);
    });

    it('treats missing counts as zero', () => {
      const people = [p({ id: 'u-zero', name: '' }), p({ id: 'u-five', name: '', numberOfAssets: 5 })];

      expect(sortPeople(people, PeopleSortBy.Name).map((person) => person.id)).toEqual(['u-five', 'u-zero']);
    });
  });

  it('treats an unknown persisted mode as the default (Most photos)', () => {
    const people = [
      p({ id: 'alpha-first', name: 'Alice', numberOfAssets: 1 }),
      p({ id: 'count-first', name: 'Zoe', numberOfAssets: 99 }),
    ];

    expect(sortPeople(people, 'garbage' as PeopleSortBy).map((person) => person.id)).toEqual([
      'count-first',
      'alpha-first',
    ]);
  });

  it('sorts hidden people last in both modes', () => {
    const people = [
      p({ id: 'hidden-fav', name: 'Aaa', isFavorite: true, isHidden: true, numberOfAssets: 999 }),
      p({ id: 'visible', name: 'Zoe', numberOfAssets: 1 }),
    ];

    for (const mode of [PeopleSortBy.PhotoCount, PeopleSortBy.Name]) {
      expect(sortPeople(people, mode).map((person) => person.id)).toEqual(['visible', 'hidden-fav']);
    }
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
cd web && pnpm test -- --run src/lib/utils/people-utils.spec.ts
```

Expected: FAIL — `sortPeople` is not exported / `PeopleSortBy` is not exported. The existing `sortPeopleForManagement` describe must still PASS.

- [ ] **Step 3: Implement the store preference**

In `web/src/lib/stores/preferences.store.ts`, add directly after the `albumViewSettings` export (ends ~line 122):

```ts
export enum PeopleSortBy {
  PhotoCount = 'photoCount',
  Name = 'name',
}

export interface PeopleViewSettings {
  sortBy: PeopleSortBy;
}

export const peopleViewSettings = persistedObject<PeopleViewSettings>('people-view-settings', {
  sortBy: PeopleSortBy.PhotoCount,
});
```

(`persistedObject` already exists at line 44 and merge-parses defaults for missing keys.)

- [ ] **Step 4: Implement the comparator**

In `web/src/lib/utils/people-utils.ts`, add the import (top of file):

```ts
import { PeopleSortBy } from '$lib/stores/preferences.store';
```

Replace the existing `comparePeopleForManagement` and `sortPeopleForManagement` functions (lines 19–55) with:

```ts
export function comparePeople(a: SortablePerson, b: SortablePerson, sortBy: PeopleSortBy): number {
  if (!!a.isHidden !== !!b.isHidden) {
    return a.isHidden ? 1 : -1;
  }

  if (!!a.isFavorite !== !!b.isFavorite) {
    return a.isFavorite ? -1 : 1;
  }

  const aName = getSortablePersonName(a);
  const bName = getSortablePersonName(b);
  const aHasName = aName.length > 0;
  const bHasName = bName.length > 0;
  if (aHasName !== bHasName) {
    return aHasName ? -1 : 1;
  }

  const nameCompare = aHasName ? aName.localeCompare(bName, undefined, { sensitivity: 'base' }) : 0;
  const countCompare = getSortablePersonCount(b) - getSortablePersonCount(a);

  // Unknown persisted values fall into the count branch, so a corrupt
  // localStorage entry degrades to the default (Most photos) ordering.
  if (aHasName && sortBy === PeopleSortBy.Name) {
    if (nameCompare !== 0) {
      return nameCompare;
    }
  } else {
    if (countCompare !== 0) {
      return countCompare;
    }
    if (nameCompare !== 0) {
      return nameCompare;
    }
  }

  return a.id.localeCompare(b.id);
}

export function sortPeople<T extends SortablePerson>(people: T[], sortBy: PeopleSortBy): T[] {
  return [...people].sort((a, b) => comparePeople(a, b, sortBy));
}

export function comparePeopleForManagement(a: SortablePerson, b: SortablePerson): number {
  return comparePeople(a, b, PeopleSortBy.Name);
}

export function sortPeopleForManagement<T extends SortablePerson>(people: T[]): T[] {
  return sortPeople(people, PeopleSortBy.Name);
}
```

Keep the existing alias lines unchanged (they now inherit Name-mode semantics):

```ts
export const comparePeopleByFavoriteAndName = comparePeopleForManagement;
export const sortPeopleByFavoriteAndName = sortPeopleForManagement;
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd web && pnpm test -- --run src/lib/utils/people-utils.spec.ts
```

Expected: PASS — all `sortPeople` tests AND the untouched `sortPeopleForManagement` tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/stores/preferences.store.ts web/src/lib/utils/people-utils.ts web/src/lib/utils/people-utils.spec.ts
git commit -m "feat(web): add PeopleSortBy preference and parameterized people comparator (#676)"
```

---

### Task 2: People page — sort control, new default, persistence

**Files:**

- Modify: `web/src/routes/(user)/people/+page.svelte`
- Modify: `i18n/en.json` (~line 2592, keep alphabetical order)
- Test: `web/src/routes/(user)/people/people-page.spec.ts`

- [ ] **Step 1: Write/extend the failing tests**

In `web/src/routes/(user)/people/people-page.spec.ts`:

a) Add imports (with the existing imports):

```ts
import { PeopleSortBy, peopleViewSettings } from '$lib/stores/preferences.store';
import { get } from 'svelte/store';
```

b) In the `beforeEach` (line ~134), add as the first line after `vi.resetAllMocks();`:

```ts
peopleViewSettings.set({ sortBy: PeopleSortBy.PhotoCount });
```

c) REPLACE the existing test `'renders favorites first, named people alphabetically, then unnamed people by photo count'` (line ~167) with the new-default expectation (same six people, same dual assertion style):

```ts
it('renders favorites first, then named and unnamed people by photo count by default', () => {
  renderPage([
    makePerson({ id: 'unnamed-low', name: '', isFavorite: false, numberOfAssets: 1 }),
    makePerson({ id: 'named-z', name: 'Zoe', isFavorite: false, numberOfAssets: 99 }),
    makePerson({ id: 'favorite-unnamed', name: '', isFavorite: true, numberOfAssets: 7 }),
    makePerson({ id: 'named-a', name: 'Alice', isFavorite: false, numberOfAssets: 1 }),
    makePerson({ id: 'unnamed-high', name: '', isFavorite: false, numberOfAssets: 12 }),
    makePerson({ id: 'favorite-named', name: 'Anna', isFavorite: true, numberOfAssets: 1 }),
  ]);

  expect(screen.getAllByPlaceholderText('add_a_name').map((input) => (input as HTMLInputElement).value)).toEqual([
    'Anna',
    '',
    'Zoe',
    'Alice',
    '',
    '',
  ]);
  expect(
    [...document.querySelectorAll<HTMLAnchorElement>('a[href^="/people/"]')].map((link) => {
      const url = new URL(link.href);
      return `${url.pathname}${url.search}`;
    }),
  ).toEqual([
    '/people/favorite-named?previousRoute=%2Fpeople',
    '/people/favorite-unnamed?previousRoute=%2Fpeople',
    '/people/named-z?previousRoute=%2Fpeople',
    '/people/named-a?previousRoute=%2Fpeople',
    '/people/unnamed-high?previousRoute=%2Fpeople',
    '/people/unnamed-low?previousRoute=%2Fpeople',
  ]);
});
```

d) Add these new tests after it:

```ts
it('switches to Name ordering via the sort dropdown and persists the choice', async () => {
  const user = userEvent.setup();
  renderPage([
    makePerson({ id: 'named-z', name: 'Zoe', numberOfAssets: 99 }),
    makePerson({ id: 'named-a', name: 'Alice', numberOfAssets: 1 }),
  ]);

  expect(screen.getAllByPlaceholderText('add_a_name').map((input) => (input as HTMLInputElement).value)).toEqual([
    'Zoe',
    'Alice',
  ]);

  // The trigger's accessible name is the selected option's label (@immich/ui Button
  // turns `title` into a hover Tooltip, NOT a title attribute — do not use getByTitle).
  await user.click(screen.getByRole('button', { name: 'sort_people_most_photos' }));
  await user.click(screen.getByRole('button', { name: 'name' }));

  await waitFor(() => {
    expect(screen.getAllByPlaceholderText('add_a_name').map((input) => (input as HTMLInputElement).value)).toEqual([
      'Alice',
      'Zoe',
    ]);
  });
  expect(get(peopleViewSettings).sortBy).toBe(PeopleSortBy.Name);
});

it('hides the sort control when there are no people', () => {
  renderPage([]);

  expect(screen.queryByRole('button', { name: 'sort_people_most_photos' })).toBeNull();
});

it('falls back to the default order when the stored preference is corrupt', () => {
  peopleViewSettings.set({ sortBy: 'garbage' as PeopleSortBy });
  renderPage([
    makePerson({ id: 'named-a', name: 'Alice', numberOfAssets: 1 }),
    makePerson({ id: 'named-z', name: 'Zoe', numberOfAssets: 99 }),
  ]);

  expect(screen.getAllByPlaceholderText('add_a_name').map((input) => (input as HTMLInputElement).value)).toEqual([
    'Zoe',
    'Alice',
  ]);
});

it('sorts searched results with the selected mode', async () => {
  // URL-driven search activation — the same harness the existing global-name-search tests use
  pageStore.setUrl('http://localhost/people?searchedPeople=Ali');
  sdkMock.searchPerson.mockResolvedValue([
    makePerson({ id: 'search-a', name: 'Alice', numberOfAssets: 1 }),
    makePerson({ id: 'search-z', name: 'Zoe', numberOfAssets: 99 }),
  ]);

  renderPage([makePerson({ id: 'p1', name: 'Someone', numberOfAssets: 5 })]);

  await waitFor(() => {
    expect(screen.getAllByPlaceholderText('add_a_name').map((input) => (input as HTMLInputElement).value)).toEqual([
      'Zoe',
      'Alice',
    ]);
  });
});
```

- [ ] **Step 2: Run the page tests to verify the new/changed ones fail**

```bash
cd web && pnpm test -- --run "src/routes/(user)/people/people-page.spec.ts"
```

Expected: FAIL — the replaced default-order test fails (page still sorts alphabetically), the dropdown tests fail (no button named `sort_people_most_photos` exists yet). Pre-existing unrelated tests must still pass.

- [ ] **Step 3: Add the i18n keys**

In `i18n/en.json`, keys are alphabetically sorted. Insert (around line 2592, before `"sort_people_by_similarity"` / after it respectively):

```json
"sort_people_by": "Sort people by...",
```

and after `"sort_people_by_similarity"`:

```json
"sort_people_most_photos": "Most photos",
```

Then run the i18n formatter so CI's Test-i18n gate stays green:

```bash
pnpm --filter immich-i18n format:fix
```

- [ ] **Step 4: Implement the page changes**

In `web/src/routes/(user)/people/+page.svelte`:

a) Imports — add `Dropdown`, extend the stores import (line 21), swap the people-utils import (line 27), extend the `@mdi/js` import block (lines 39–47):

```ts
import Dropdown from '$lib/elements/Dropdown.svelte';
import { locale, PeopleSortBy, peopleViewSettings } from '$lib/stores/preferences.store';
import { sortPeople } from '$lib/utils/people-utils';
```

and add to the `@mdi/js` braces:

```ts
mdiSortAlphabeticalAscending,
mdiSortNumericDescending,
```

b) Script — add next to the other deriveds (around line 272) and replace the `showPeople` derived (line 273):

```ts
const peopleSortOptions = [PeopleSortBy.PhotoCount, PeopleSortBy.Name];
const peopleSortIcons: Record<PeopleSortBy, string> = {
  [PeopleSortBy.PhotoCount]: mdiSortNumericDescending,
  [PeopleSortBy.Name]: mdiSortAlphabeticalAscending,
};
let peopleSortByNames: Record<PeopleSortBy, string> = $derived({
  [PeopleSortBy.PhotoCount]: $t('sort_people_most_photos'),
  [PeopleSortBy.Name]: $t('name'),
});
let peopleSortBy = $derived(
  Object.values(PeopleSortBy).includes($peopleViewSettings.sortBy)
    ? $peopleViewSettings.sortBy
    : PeopleSortBy.PhotoCount,
);
let showPeople = $derived(sortPeople(searchName ? searchedPeopleLocal : visiblePeople, peopleSortBy));
```

c) Markup — inside the `buttons()` snippet (line ~425), between the search `</div>` and the "Show & hide people" `<Button>`:

```svelte
<Dropdown
  title={$t('sort_people_by')}
  options={peopleSortOptions}
  selectedOption={peopleSortBy}
  onSelect={(sortBy) => ($peopleViewSettings.sortBy = sortBy)}
  render={(sortBy) => ({ title: peopleSortByNames[sortBy], icon: peopleSortIcons[sortBy] })}
/>
```

- [ ] **Step 5: Run the page tests to verify they pass**

```bash
cd web && pnpm test -- --run "src/routes/(user)/people/people-page.spec.ts"
```

Expected: PASS — all tests in the file, including pre-existing ones.

- [ ] **Step 6: Commit**

```bash
git add "web/src/routes/(user)/people/+page.svelte" "web/src/routes/(user)/people/people-page.spec.ts" i18n/en.json
git commit -m "feat(web): user-controlled people sort with Most-photos default (#676)"
```

---

### Task 3: Spaces people page — same preference and control

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/+page.svelte`
- Test: `web/src/routes/(user)/spaces/[spaceId]/people/space-people-page.spec.ts`

- [ ] **Step 1: Write/extend the failing tests**

In `space-people-page.spec.ts`:

a) Add imports:

```ts
import { PeopleSortBy, peopleViewSettings } from '$lib/stores/preferences.store';
```

b) In `beforeEach` (line ~137), add after `vi.resetAllMocks();`:

```ts
peopleViewSettings.set({ sortBy: PeopleSortBy.PhotoCount });
```

c) REPLACE the existing test `'renders named people alphabetically before unnamed people sorted by asset count'` (line ~150) with:

```ts
it('renders people by photo count by default, named before unnamed', () => {
  renderPage([
    makeSpacePerson({ id: 'space-person-unnamed-low', name: '', assetCount: 1 }),
    makeSpacePerson({ id: 'space-person-zoe', name: 'Zoe', assetCount: 99 }),
    makeSpacePerson({ id: 'space-person-unnamed-high', name: '', assetCount: 20 }),
    makeSpacePerson({ id: 'space-person-alice', name: 'Alice', assetCount: 1 }),
  ]);

  expect(screen.getAllByPlaceholderText('add_a_name').map((input) => (input as HTMLInputElement).value)).toEqual([
    'Zoe',
    'Alice',
    '',
    '',
  ]);
  expect(
    [...document.querySelectorAll<HTMLAnchorElement>('a[href^="/spaces/space-1/people/"]')].map((link) => {
      const url = new URL(link.href);
      return url.pathname;
    }),
  ).toEqual([
    '/spaces/space-1/people/space-person-zoe',
    '/spaces/space-1/people/space-person-alice',
    '/spaces/space-1/people/space-person-unnamed-high',
    '/spaces/space-1/people/space-person-unnamed-low',
  ]);
});

it('orders people alphabetically when the people sort preference is Name', () => {
  peopleViewSettings.set({ sortBy: PeopleSortBy.Name });
  renderPage([
    makeSpacePerson({ id: 'space-person-zoe', name: 'Zoe', assetCount: 99 }),
    makeSpacePerson({ id: 'space-person-alice', name: 'Alice', assetCount: 1 }),
  ]);

  expect(screen.getAllByPlaceholderText('add_a_name').map((input) => (input as HTMLInputElement).value)).toEqual([
    'Alice',
    'Zoe',
  ]);
});
```

Keep the rest of the original assertions/tests in the file intact; if other existing tests assert alphabetical ordering implicitly, set `peopleViewSettings.set({ sortBy: PeopleSortBy.Name })` at the start of those tests rather than weakening their assertions.

- [ ] **Step 2: Run to verify the changed tests fail**

```bash
cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/people/space-people-page.spec.ts"
```

Expected: FAIL — default is still alphabetical on this page.

- [ ] **Step 3: Implement the spaces page changes**

In `web/src/routes/(user)/spaces/[spaceId]/people/+page.svelte`:

a) Imports — add `Dropdown`, extend stores import (line 17), swap people-utils import (line 21), add the two mdi icons to the `@mdi/js` block (lines 36–44):

```ts
import Dropdown from '$lib/elements/Dropdown.svelte';
import { locale, PeopleSortBy, peopleViewSettings } from '$lib/stores/preferences.store';
import { sortPeople } from '$lib/utils/people-utils';
```

```ts
mdiSortAlphabeticalAscending,
mdiSortNumericDescending,
```

b) Script — add the same block as the people page (place near the `visiblePeople` derived, line ~73) and change `visiblePeople`:

```ts
const peopleSortOptions = [PeopleSortBy.PhotoCount, PeopleSortBy.Name];
const peopleSortIcons: Record<PeopleSortBy, string> = {
  [PeopleSortBy.PhotoCount]: mdiSortNumericDescending,
  [PeopleSortBy.Name]: mdiSortAlphabeticalAscending,
};
let peopleSortByNames: Record<PeopleSortBy, string> = $derived({
  [PeopleSortBy.PhotoCount]: $t('sort_people_most_photos'),
  [PeopleSortBy.Name]: $t('name'),
});
let peopleSortBy = $derived(
  Object.values(PeopleSortBy).includes($peopleViewSettings.sortBy)
    ? $peopleViewSettings.sortBy
    : PeopleSortBy.PhotoCount,
);
const visiblePeople = $derived(
  sortPeople(
    people.filter((p) => !p.isHidden),
    peopleSortBy,
  ),
);
```

c) Markup — in the `buttons()` snippet (line ~440), inside the `{#if hasSearchablePeople}` block, after the search `</div>`:

```svelte
<Dropdown
  title={$t('sort_people_by')}
  options={peopleSortOptions}
  selectedOption={peopleSortBy}
  onSelect={(sortBy) => ($peopleViewSettings.sortBy = sortBy)}
  render={(sortBy) => ({ title: peopleSortByNames[sortBy], icon: peopleSortIcons[sortBy] })}
/>
```

- [ ] **Step 4: Run to verify pass**

```bash
cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/people/space-people-page.spec.ts"
```

Expected: PASS — whole file.

- [ ] **Step 5: Commit**

```bash
git add "web/src/routes/(user)/spaces/[spaceId]/people/+page.svelte" "web/src/routes/(user)/spaces/[spaceId]/people/space-people-page.spec.ts"
git commit -m "feat(web): people sort preference on the spaces people page (#676)"
```

---

### Task 4: Slice verification gate

**Files:** none new — verification only (fix-forward and amend the relevant commit if anything fails).

- [ ] **Step 1: Full web unit-test run for the touched areas**

```bash
cd web && pnpm test -- --run src/lib/utils/people-utils.spec.ts "src/routes/(user)/people/people-page.spec.ts" "src/routes/(user)/spaces/[spaceId]/people/space-people-page.spec.ts"
```

Expected: PASS, zero failures.

- [ ] **Step 2: Type check (run tsc directly — the Makefile target can mask cache issues)**

```bash
cd web && pnpm run check:typescript && pnpm run check:svelte
```

(Both scripts exist in `web/package.json:12-13`.) Expected: 0 errors. Note `check:svelte` runs with `--fail-on-warnings`.

- [ ] **Step 3: Lint only the changed files (CI "Lint Web" is a separate `eslint --max-warnings 0` gate)**

```bash
cd web && pnpm exec eslint --max-warnings 0 \
  src/lib/utils/people-utils.ts src/lib/utils/people-utils.spec.ts \
  src/lib/stores/preferences.store.ts \
  "src/routes/(user)/people/+page.svelte" "src/routes/(user)/people/people-page.spec.ts" \
  "src/routes/(user)/spaces/[spaceId]/people/+page.svelte" \
  "src/routes/(user)/spaces/[spaceId]/people/space-people-page.spec.ts"
```

Expected: 0 problems. Common traps: unused imports after the refactor; `@typescript-eslint/no-floating-promises` on async handlers (prefix `void` only where the codebase already does).

- [ ] **Step 4: i18n format check**

```bash
pnpm --filter immich-i18n format:fix && git diff --exit-code i18n/
```

Expected: no diff (keys already sorted from Task 2).

- [ ] **Step 5: Commit any verification fixes**

Only if Steps 1–4 surfaced fixes:

```bash
git add -A && git commit -m "fix(web): people sort verification fixes (#676)"
```
