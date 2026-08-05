# Filter Section Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Filter panel's row of ten icon-only section toggles with a cog in the panel header that opens a worded checkbox popover.

**Architecture:** A new self-contained `filter-section-menu.svelte` owns the trigger, its open state and the list; it takes plain props and reads no storage. `filter-panel.svelte` keeps `visibleSections`, `toggleSection()`, `showAllSections()` and its persistence effect exactly as they are, and simply renders the menu instead of the row.

**Tech Stack:** Svelte 5 runes, Tailwind 4, `@immich/ui` `Icon`, vitest + `@testing-library/svelte` with happy-dom.

**Spec:** `docs/superpowers/specs/2026-08-04-filter-section-menu-design.md`

## Global Constraints

- Run every command from `web/`. `pnpm test -- --run <path>` silently drops the path filter — use `pnpm test --run <path>`.
- Prettier: 120 char width, single quotes, trailing commas. ESLint runs with zero errors tolerated.
- New i18n keys go in `i18n/en.json` only (repo root, shared with mobile). Never delete a key without grepping both `web/` and `mobile/`.
- Tailwind classes must use logical properties for inline positioning — `inset-s-*` / `inset-e-*`, never `left-*` / `right-*`. `sidebar-shell.spec.ts` asserts this convention.
- The existing testids `section-toggle-{section}` and `section-toggle-dot-{section}` MUST survive onto the menu rows. They are what makes this a migration rather than a test rewrite.
- Never add `Co-Authored-By` or "Generated with" trailers to commits.
- **A closed menu is asserted via `aria-expanded`, never via DOM removal.** The popover carries `transition:slide`, and `web/src/test-data/setup.ts:42-46` mocks `Element.prototype.animate` down to `{ cancel, finished }`. Svelte 5 drives transitions through the Web Animations API, so under that mock an outro never signals completion and **a transitioned element is never removed from the DOM in this test environment** — `waitFor` cannot rescue it either. The state itself is correct: a probe confirmed `aria-expanded` flips to `false` on close while the element stays mounted. So every "the menu is closed" assertion checks `expect(cog).toHaveAttribute('aria-expanded', 'false')`, which is both synchronous and the actual ARIA contract. Do not remove the transition to make removal assertable — that trades real UX for a harness limitation, and `filter-section.svelte` already ships the same pattern.

**Deviation from the spec, deliberate:** the spec puts the aggregate `anyHiddenActiveFilter` derived in `filter-panel.svelte`. This plan instead passes one `hasActiveFilter` predicate into the menu and derives **both** cues (per-row marker and cog dot) inside the component, so the two cannot drift apart. Same behaviour, one predicate instead of two.

---

## File Structure

| File                                                                        | Responsibility                                                                                                   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `web/src/lib/components/filter-panel/filter-section-menu.svelte`            | **New.** Cog trigger, open state, worded checkbox list, `Show all`. No storage, no filter knowledge.             |
| `web/src/lib/components/filter-panel/__tests__/filter-section-menu.spec.ts` | **New.** The component in isolation — plain props, no localStorage or SDK mocks.                                 |
| `web/src/lib/components/filter-panel/filter-panel.svelte`                   | **Modify.** Header gains the cog; the icon row and `sectionIcons` are deleted; forces the menu shut on collapse. |
| `web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`        | **Modify.** `openSectionMenu()` helper; 25 tests gain one line; 3 assertions reshaped; new cog tests.            |
| `web/src/lib/components/filter-panel/__tests__/filter-sections.spec.ts`     | **Modify.** 2 call sites gain the helper.                                                                        |
| `i18n/en.json`                                                              | **Modify.** Add `filter_manage_sections`; reword `filter_show_sections_hint`.                                    |

---

### Task 1: The menu component, in isolation

Nothing outside these two new files is touched. The full suite stays green throughout this task.

**Files:**

- Create: `web/src/lib/components/filter-panel/filter-section-menu.svelte`
- Test: `web/src/lib/components/filter-panel/__tests__/filter-section-menu.spec.ts`

**Interfaces:**

- Consumes: `FilterSection` type from `web/src/lib/components/filter-panel/filter-panel.ts` (exported as `FilterSection`; note `filter-panel.svelte` imports it aliased as `FilterSectionType` because a child component shares the name — the new file has no such clash and imports it unaliased).
- Produces: a default-export Svelte component with props

  ```ts
  {
    sections: FilterSection[];
    visible: Set<FilterSection>;
    titles: Record<string, string>;
    toggleLabels: Record<string, string>;
    hasActiveFilter: (section: FilterSection) => boolean;
    onToggle: (section: FilterSection) => void;
    onShowAll: () => void;
    open?: boolean; // bindable
  }
  ```

  Testids it renders: `section-menu-btn`, `section-menu-dot`, `section-menu`, `section-toggle-{section}`, `section-toggle-dot-{section}`, `section-menu-show-all`.

- [ ] **Step 1: Write the failing test file**

Create `web/src/lib/components/filter-panel/__tests__/filter-section-menu.spec.ts`:

```ts
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import type { FilterSection } from '../filter-panel';
import FilterSectionMenu from '../filter-section-menu.svelte';

beforeAll(async () => {
  register('en-US', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

const SECTIONS: FilterSection[] = ['timeline', 'people', 'location'];

const TITLES = { timeline: 'Timeline', people: 'People', location: 'Location' };

// Mirrors filter-panel.svelte's own `sectionToggleLabels`, which deliberately differs from the
// visible title for one section so browser automation cannot confuse it with the asset action.
const TOGGLE_LABELS = { ...TITLES, people: 'People filter section' };

function renderMenu(overrides: Record<string, unknown> = {}) {
  const onToggle = vi.fn();
  const onShowAll = vi.fn();
  const result = render(FilterSectionMenu, {
    props: {
      sections: SECTIONS,
      visible: new Set<FilterSection>(SECTIONS),
      titles: TITLES,
      toggleLabels: TOGGLE_LABELS,
      hasActiveFilter: () => false,
      onToggle,
      onShowAll,
      ...overrides,
    },
  });
  return { ...result, onToggle, onShowAll };
}

const cog = () => screen.getByTestId('section-menu-btn');
const openMenu = () => fireEvent.click(cog());

describe('filter-section-menu', () => {
  it('renders a closed cog and no list', () => {
    renderMenu();

    expect(cog()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('section-menu')).toBeNull();
  });

  // svelte-i18n returns the key itself for a missing translation, so without this a typo'd or
  // unregistered key would leave the cog's only accessible name as "filter_manage_sections" and
  // every other test here would still pass.
  it('names the cog from a real translation', () => {
    renderMenu();

    expect(cog()).toHaveAccessibleName('Show or hide sections');
  });

  it('opens on click with one row per configured section', async () => {
    renderMenu();

    await openMenu();

    expect(cog()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('section-menu')).toBeTruthy();
    for (const section of SECTIONS) {
      expect(screen.getByTestId(`section-toggle-${section}`)).toBeTruthy();
    }
    // The words are the point of the whole change - assert the visible label, not just the row.
    expect(screen.getByTestId('section-toggle-timeline')).toHaveTextContent('Timeline');
  });

  it('drives each row from the visible prop rather than local state', async () => {
    renderMenu({ visible: new Set<FilterSection>(['timeline']) });

    await openMenu();

    expect(screen.getByTestId('section-toggle-timeline')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('section-toggle-people')).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps a row accessible name that differs from its visible title', async () => {
    renderMenu();

    await openMenu();

    expect(screen.getByTestId('section-toggle-people')).toHaveAttribute('aria-label', 'People filter section');
  });

  // The wrapper carries clickOutside, whose onOutclick early-returns for clicks inside it. If that
  // guard ever stopped working a row click would fire onToggle AND close the menu.
  it('calls onToggle once per row click', async () => {
    const { onToggle } = renderMenu();

    await openMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));

    expect(onToggle).toHaveBeenCalledExactlyOnceWith('people');
  });

  // The premise of the whole design: hiding three sections is three clicks.
  it('stays open across consecutive row clicks', async () => {
    const { onToggle } = renderMenu();

    await openMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    await fireEvent.click(screen.getByTestId('section-toggle-location'));

    expect(screen.getByTestId('section-menu')).toBeTruthy();
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('closes on a second cog click', async () => {
    renderMenu();

    await openMenu();
    await openMenu();

    expect(cog()).toHaveAttribute('aria-expanded', 'false');
  });

  // clickOutside listens for mousedown on document, not click.
  it('closes on an outside mousedown', async () => {
    renderMenu();

    await openMenu();
    await fireEvent.mouseDown(document.body);

    expect(cog()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on Escape and returns focus to the cog', async () => {
    renderMenu();

    await openMenu();
    const row = screen.getByTestId('section-toggle-people');
    row.focus();
    await fireEvent.keyDown(row, { key: 'Escape' });

    expect(cog()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(cog());
  });

  // Why clickOutside sits on a wrapper enclosing the cog, not on the popover: the action binds
  // keydown to its own node, so on the popover alone this case would do nothing.
  it('closes on Escape while focus is on the cog itself', async () => {
    renderMenu();

    await openMenu();
    cog().focus();
    await fireEvent.keyDown(cog(), { key: 'Escape' });

    expect(cog()).toHaveAttribute('aria-expanded', 'false');
  });

  it('calls onShowAll once', async () => {
    const { onShowAll } = renderMenu();

    await openMenu();
    await fireEvent.click(screen.getByTestId('section-menu-show-all'));

    expect(onShowAll).toHaveBeenCalledOnce();
  });

  it('marks only hidden rows that still hold an active filter', async () => {
    renderMenu({
      visible: new Set<FilterSection>(['timeline']),
      hasActiveFilter: (section: FilterSection) => section === 'people',
    });

    await openMenu();

    expect(screen.getByTestId('section-toggle-dot-people')).toBeTruthy();
    // Hidden but not filtering.
    expect(screen.queryByTestId('section-toggle-dot-location')).toBeNull();
  });

  it('marks a filtering section that is still visible with no dot', async () => {
    renderMenu({
      visible: new Set<FilterSection>(SECTIONS),
      hasActiveFilter: () => true,
    });

    await openMenu();

    expect(screen.queryByTestId('section-toggle-dot-people')).toBeNull();
  });

  // The dot's entire purpose is being visible while the menu is shut.
  it('shows a dot on the cog when any hidden section is filtering, without opening', () => {
    renderMenu({
      visible: new Set<FilterSection>(['timeline']),
      hasActiveFilter: (section: FilterSection) => section === 'people',
    });

    expect(screen.getByTestId('section-menu-dot')).toBeTruthy();
  });

  it('shows no dot on the cog when every filtering section is visible', () => {
    renderMenu({ visible: new Set<FilterSection>(SECTIONS), hasActiveFilter: () => true });

    expect(screen.queryByTestId('section-menu-dot')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test --run src/lib/components/filter-panel/__tests__/filter-section-menu.spec.ts`

Expected: FAIL — the file `../filter-section-menu.svelte` does not resolve.

- [ ] **Step 3: Write the component**

Create `web/src/lib/components/filter-panel/filter-section-menu.svelte`:

```svelte
<script lang="ts">
  import { clickOutside } from '$lib/actions/click-outside';
  import { mediaQueryManager } from '$lib/stores/media-query-manager.svelte';
  import { Icon } from '@immich/ui';
  import { mdiCheck, mdiCog } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { slide } from 'svelte/transition';
  import type { FilterSection } from './filter-panel';
  import { slideMotion } from './motion';

  interface Props {
    sections: FilterSection[];
    visible: Set<FilterSection>;
    titles: Record<string, string>;
    toggleLabels: Record<string, string>;
    hasActiveFilter: (section: FilterSection) => boolean;
    onToggle: (section: FilterSection) => void;
    onShowAll: () => void;
    open?: boolean;
  }

  let {
    sections,
    visible,
    titles,
    toggleLabels,
    hasActiveFilter,
    onToggle,
    onShowAll,
    open = $bindable(false),
  }: Props = $props();

  let trigger = $state<HTMLButtonElement>();

  const MENU_ID = 'filter-section-menu';

  // One predicate, both cues: a section is "filtering out of sight" when it is hidden and still
  // holds a value. The row marker is the per-section answer, the cog dot the aggregate - deriving
  // them separately is how the two drift apart.
  const isHiddenAndFiltering = (section: FilterSection) => !visible.has(section) && hasActiveFilter(section);
  const anyHiddenAndFiltering = $derived(sections.some((section) => isHiddenAndFiltering(section)));

  // Escape dismisses and hands focus back; an outside click leaves focus wherever the user put it.
  const closeAndRefocus = () => {
    open = false;
    trigger?.focus();
  };
</script>

<!--
  clickOutside goes on this wrapper, enclosing BOTH the cog and the popover, not on the popover
  alone. The action binds keydown to its own node rather than the document, so on the popover alone
  Escape would be dead whenever focus sat on the trigger. It also early-returns from onOutclick for
  clicks inside the node, which is why a second cog click closes via the button's own handler below
  and there is no double-handling to guard against.
-->
<div class="relative" use:clickOutside={{ onOutclick: () => (open = false), onEscape: closeAndRefocus }}>
  <button
    type="button"
    bind:this={trigger}
    class="relative flex size-6 items-center justify-center rounded-full text-gray-500 hover:bg-subtle dark:text-gray-400"
    onclick={() => (open = !open)}
    aria-expanded={open}
    aria-controls={MENU_ID}
    aria-label={$t('filter_manage_sections')}
    title={$t('filter_manage_sections')}
    data-testid="section-menu-btn"
  >
    <Icon icon={mdiCog} size="16" />
    {#if anyHiddenAndFiltering}
      <span
        class="absolute -inset-e-0.5 -top-0.5 size-2 rounded-full border-[1.5px] border-light bg-immich-primary dark:bg-immich-dark-primary"
        data-testid="section-menu-dot"
      ></span>
    {/if}
  </button>

  {#if open}
    <!-- Anchored with logical inset so the popover lands correctly in both writing directions. It
         renders inside the header, which is sticky, because the panel body is overflow-y-auto and
         would clip anything absolutely positioned within it. z-10 clears the header's own z-5. -->
    <div
      id={MENU_ID}
      class="absolute inset-s-0 top-full z-10 mt-1 w-56 rounded-lg border border-gray-200 bg-light py-1 shadow-lg dark:border-gray-700"
      data-testid="section-menu"
      transition:slide|local={slideMotion(mediaQueryManager.reducedMotion)}
    >
      {#each sections as section (section)}
        <button
          type="button"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-subtle"
          onclick={() => onToggle(section)}
          aria-pressed={visible.has(section)}
          aria-label={toggleLabels[section]}
          data-testid="section-toggle-{section}"
        >
          <span class="flex size-4 shrink-0 items-center justify-center text-primary">
            {#if visible.has(section)}
              <Icon icon={mdiCheck} size="14" />
            {/if}
          </span>
          <span class="flex-1 truncate text-start">{titles[section]}</span>
          {#if isHiddenAndFiltering(section)}
            <span
              class="size-2 shrink-0 rounded-full bg-immich-primary dark:bg-immich-dark-primary"
              data-testid="section-toggle-dot-{section}"
            ></span>
          {/if}
        </button>
      {/each}

      <div class="my-1 border-t border-gray-200 dark:border-gray-700"></div>

      <button
        type="button"
        class="w-full px-3 py-1.5 text-start text-sm font-medium text-primary hover:bg-subtle"
        onclick={onShowAll}
        data-testid="section-menu-show-all"
      >
        {$t('filter_show_all_sections')}
      </button>
    </div>
  {/if}
</div>
```

- [ ] **Step 4: Add the new i18n key**

The component reads `filter_manage_sections`, which does not exist yet. In `i18n/en.json` keys are alphabetical, so it belongs between `filter_invalid_to_date` and `filter_name_people_hint` (currently lines 1469 and 1470):

```json
  "filter_manage_sections": "Show or hide sections",
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test --run src/lib/components/filter-panel/__tests__/filter-section-menu.spec.ts`

Expected: PASS, 16 tests.

- [ ] **Step 6: Confirm nothing else moved**

Run: `pnpm test --run src/lib/components/filter-panel/`

Expected: PASS — the component is not yet referenced anywhere, so every existing filter-panel test is untouched.

- [ ] **Step 7: Lint, format, typecheck**

```bash
npx prettier --write src/lib/components/filter-panel/filter-section-menu.svelte src/lib/components/filter-panel/__tests__/filter-section-menu.spec.ts
npx eslint src/lib/components/filter-panel/
pnpm check:typescript
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/components/filter-panel/filter-section-menu.svelte \
        web/src/lib/components/filter-panel/__tests__/filter-section-menu.spec.ts \
        i18n/en.json
git commit -m "feat(web): add a worded section menu for the filter panel

A cog trigger and a checkbox popover listing each filter section by name,
built standalone against plain props - nothing renders it yet. clickOutside
sits on a wrapper enclosing both the cog and the popover because the action
binds Escape to its own node, so on the popover alone Escape would be dead
whenever focus sat on the trigger."
```

---

### Task 2: Swap the icon row for the cog

The breaking step, deliberately one commit: the 25 existing tests target markup that ceases to exist here, so they migrate alongside it.

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.svelte` (delete `:330-341`, edit header `:707-720`, delete row `:722-750`)
- Modify: `web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`
- Modify: `web/src/lib/components/filter-panel/__tests__/filter-sections.spec.ts` (`:1318`, `:1334`)
- Modify: `i18n/en.json`

**Interfaces:**

- Consumes: `filter-section-menu.svelte` from Task 1, with the exact props listed there.
- Produces: `openSectionMenu()` test helper in `filter-panel.spec.ts`, used by Tasks 3 and 4.

- [ ] **Step 1: Write the failing panel-level tests**

Add to `filter-panel.spec.ts`, inside the `describe` that owns `renderPanel` (the one at `:492`), directly after the `// --- Rendering ---` marker:

```ts
// The cog replaces the old icon row. It is gated exactly as that row was, on the page having
// configured sections at all.
it('renders the section cog when sections are configured', () => {
  renderPanel(['people', 'rating']);

  expect(screen.getByTestId('section-menu-btn')).toBeTruthy();
});

it('renders no section cog when the config has no sections', () => {
  renderPanel([]);

  expect(screen.queryByTestId('section-menu-btn')).toBeNull();
});

it('renders no section cog once the panel is collapsed', async () => {
  renderPanel(['people', 'rating']);

  await fireEvent.click(screen.getByTestId('collapse-panel-btn'));

  expect(screen.queryByTestId('section-menu-btn')).toBeNull();
  expect(screen.getByTestId('collapsed-icon-strip')).toBeTruthy();
});

// Boundary of the gate: one section is still enough to warrant the control, and hiding it
// leaves the panel on its empty state rather than blank.
it('renders the cog for a single configured section and lands on the empty state when hidden', async () => {
  renderPanel(['people']);

  await openSectionMenu();
  await fireEvent.click(screen.getByTestId('section-toggle-people'));

  expect(screen.getByTestId('show-all-sections')).toBeTruthy();
});

// Two independent routes back from "everything hidden"; neither may shadow the other.
it('restores every section from the menu reset', async () => {
  renderPanel(['people', 'rating']);

  await openSectionMenu();
  await fireEvent.click(screen.getByTestId('section-toggle-people'));
  await fireEvent.click(screen.getByTestId('section-toggle-rating'));
  await fireEvent.click(screen.getByTestId('section-menu-show-all'));

  expect(screen.getByTestId('filter-section-people')).toBeTruthy();
  expect(screen.getByTestId('filter-section-rating')).toBeTruthy();
});

it('restores every section from the empty-state link', async () => {
  renderPanel(['people', 'rating']);

  await openSectionMenu();
  await fireEvent.click(screen.getByTestId('section-toggle-people'));
  await fireEvent.click(screen.getByTestId('section-toggle-rating'));
  await fireEvent.click(screen.getByTestId('show-all-sections'));

  expect(screen.getByTestId('filter-section-people')).toBeTruthy();
  expect(screen.getByTestId('filter-section-rating')).toBeTruthy();
});

// Show all with nothing hidden must not toggle anything off, and must leave the menu usable.
it('leaves everything visible when Show all is used with nothing hidden', async () => {
  renderPanel(['people', 'rating']);

  await openSectionMenu();
  await fireEvent.click(screen.getByTestId('section-menu-show-all'));

  expect(screen.getByTestId('filter-section-people')).toBeTruthy();
  expect(screen.getByTestId('filter-section-rating')).toBeTruthy();
  expect(screen.getByTestId('section-menu')).toBeTruthy();
});

// The toggles MOVED - they are not also still sitting in the header. Without this, leaving the old
// row in place would satisfy every other test in this file: they all find a toggle either way, and
// testing-library only throws on duplicate testids.
it('keeps the section toggles out of the DOM until the menu is opened', async () => {
  renderPanel(['people', 'rating']);

  expect(screen.queryByTestId('section-toggle-people')).toBeNull();

  await openSectionMenu();

  expect(screen.getByTestId('section-toggle-people')).toBeTruthy();
});

// The aggregate dot is the only thing on screen saying "something is filtering out of sight" while
// the menu is shut, so it is asserted with the menu closed. `personIds` is the field the existing
// per-section dot tests at `:660-684` use.
it('shows a dot on the cog when a hidden section still holds a filter', async () => {
  const filters = createFilterState();
  filters.personIds = ['person-1'];
  renderPanel(['people', 'rating'], filters);

  await openSectionMenu();
  await fireEvent.click(screen.getByTestId('section-toggle-people'));
  await fireEvent.keyDown(screen.getByTestId('section-menu-btn'), { key: 'Escape' });

  expect(screen.getByTestId('section-menu-btn')).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByTestId('section-menu-dot')).toBeTruthy();
});

it('shows no dot on the cog when the hidden section holds no filter', async () => {
  renderPanel(['people', 'rating']);

  await openSectionMenu();
  await fireEvent.click(screen.getByTestId('section-toggle-people'));

  expect(screen.queryByTestId('section-menu-dot')).toBeNull();
});

// Derived, not latched: showing the section again clears the cue.
it('clears the cog dot when the hidden section is shown again', async () => {
  const filters = createFilterState();
  filters.personIds = ['person-1'];
  renderPanel(['people', 'rating'], filters);

  await openSectionMenu();
  await fireEvent.click(screen.getByTestId('section-toggle-people'));
  expect(screen.getByTestId('section-menu-dot')).toBeTruthy();

  await fireEvent.click(screen.getByTestId('section-toggle-people'));

  expect(screen.queryByTestId('section-menu-dot')).toBeNull();
});
```

And add the helper immediately below `renderPanel` (`:492-505`):

```ts
// The section toggles now live inside the cog's popover, so anything that clicks or queries one
// has to open it first.
async function openSectionMenu() {
  await fireEvent.click(screen.getByTestId('section-menu-btn'));
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`

Expected: the 11 tests just added FAIL with `Unable to find an element by: [data-testid="section-menu-btn"]`, and every pre-existing test in the file still passes. Run the whole file rather than filtering by name — the new tests do not share a keyword, so any `-t` pattern would silently skip some of them and report green.

The one exception is `renders no section cog when the config has no sections`, which passes already because nothing renders a cog yet. That is expected; it becomes meaningful once the cog exists.

- [ ] **Step 3: Render the cog in the panel header**

In `filter-panel.svelte`, import the component alongside the existing `FilterSection` import (`:29`):

```svelte
  import FilterSectionMenu from './filter-section-menu.svelte';
```

Add the open-state rune next to the other panel state (near `visibleSections` at `:449`):

```ts
let sectionMenuOpen = $state(false);
```

Replace the header block at `:707-720` with:

```svelte
        <div
          class="sticky top-0 z-5 flex items-center justify-between border-b border-gray-200 bg-light px-4 py-2.5 dark:border-gray-700"
        >
          <div class="flex items-center gap-1">
            <span class="text-sm font-medium">{$t('filters')}</span>
            {#if config.sections.length > 0}
              <FilterSectionMenu
                bind:open={sectionMenuOpen}
                sections={config.sections}
                visible={visibleSections}
                titles={sectionTitles}
                toggleLabels={sectionToggleLabels}
                {hasActiveFilter}
                onToggle={toggleSection}
                onShowAll={showAllSections}
              />
            {/if}
          </div>
          <button
            type="button"
            class="flex size-6 items-center justify-center rounded-full text-gray-500 hover:bg-subtle dark:text-gray-400"
            onclick={() => (collapsed = true)}
            data-testid="collapse-panel-btn"
            aria-label={$t('collapse')}
          >
            <Icon icon={mdiClose} size="16" />
          </button>
        </div>
```

- [ ] **Step 4: Delete the icon row and its icon map**

Delete the whole `{#if config.sections.length > 0}` block that renders `data-testid="section-toggle-row"` (`:722-750`).

Delete `sectionIcons` (`:330-341`) — the deleted row was its only consumer.

Remove the now-unused icon imports from the `@mdi/js` import at `:7-19`, keeping `mdiClose` and `mdiTune`, which are still used by the collapsed strip: drop `mdiCalendar`, `mdiAccount`, `mdiMapMarker`, `mdiCamera`, `mdiTag`, `mdiStar`, `mdiImage`, `mdiHeart`, `mdiImageAlbum`, `mdiTextSearch`.

- [ ] **Step 5: Reword the empty-state hint**

In `i18n/en.json`, `filter_show_sections_hint` currently reads `"Click an icon above to show filters"` — it names the row just deleted. Change it to:

```json
  "filter_show_sections_hint": "Use the cog above to show filters",
```

The key keeps its name so no other locale file is orphaned. `filter-panel.svelte:878` is its only consumer; nothing in `mobile/` reads it.

- [ ] **Step 6: Reshape the three `section-toggle-row` assertions**

In `filter-panel.spec.ts`, the row no longer exists. Replace each:

At `:516` — "should render toggle row with icons for all configured sections". Rename and rewrite:

```ts
it('should list every configured section in the menu', async () => {
  renderPanel();
  await openSectionMenu();
  for (const section of allSections) {
    expect(screen.getByTestId(`section-toggle-${section}`)).toBeTruthy();
  }
});
```

At `:554` — "should not render toggle row in collapsed panel state" is now covered by the new "renders no section cog once the panel is collapsed" test from Step 1. Delete the old test.

At `:561` — "should not crash and not render toggle row with empty sections config" is covered by the new "renders no section cog when the config has no sections". Delete the old test.

- [ ] **Step 7: Migrate the remaining call sites**

Find every test still touching a toggle:

```bash
grep -n "section-toggle" src/lib/components/filter-panel/__tests__/filter-panel.spec.ts \
                        src/lib/components/filter-panel/__tests__/filter-sections.spec.ts
```

For each test containing one, insert `await openSectionMenu();` as the first line after its `renderPanel(...)` call, and make the test `async` if it is not already. The rule is mechanical: a `section-toggle-*` testid is only in the DOM while the menu is open.

Two wrinkles it does not cover, both of which appear in the localStorage-persistence tests:

- **A test that renders more than once needs one `openSectionMenu()` per render.** Each render starts with the menu closed; the previous render's open state does not carry over.
- **A test that unmounts and re-renders to assert persistence** must open the menu again before querying `aria-pressed`, and it is asserting `visibleSections` — which this change does not touch — so its expectations stay exactly as they are.

`filter-sections.spec.ts` (`:1318`, `:1334`) has its own render helper and no `openSectionMenu`. Add the same helper to that file's describe block:

```ts
async function openSectionMenu() {
  await fireEvent.click(screen.getByTestId('section-menu-btn'));
}
```

- [ ] **Step 8: Run the full filter-panel suite**

Run: `pnpm test --run src/lib/components/filter-panel/`

Expected: PASS. Any remaining failure naming `section-toggle-*` is a test Step 7 missed — add the helper call.

- [ ] **Step 9: Lint, format, typecheck**

```bash
npx prettier --write src/lib/components/filter-panel/
npx eslint src/lib/components/filter-panel/
pnpm check:typescript
```

Expected: no errors. `pnpm check:typescript` catches the deleted `sectionIcons` if any reference survives.

- [ ] **Step 10: Commit**

```bash
git add web/src/lib/components/filter-panel/ i18n/en.json
git commit -m "feat(web): put filter section show/hide behind a cog menu

The row of ten icon-only toggles said nothing about what it did or that the
icons were toggles, and repeated the words already printed on the section
headers below it. A cog in the panel header now opens a worded checkbox list.

The section-toggle testids move onto the menu rows unchanged, so the existing
coverage migrates by opening the menu first rather than being rewritten. Two
assertions that checked for the absence of the row are replaced by ones that
check the cog's actual render gate.

filter_show_sections_hint named the deleted row, so its copy changes with it."
```

---

### Task 3: Close the menu when the panel collapses

Only reachable in `externalToggle` mode, where the panel stays mounted at `w-0` instead of unmounting. Its own task because it is the one behaviour the design does not get for free, and it is invisible in the built-in mode every other test uses.

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.svelte`
- Modify: `web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`

**Interfaces:**

- Consumes: `sectionMenuOpen` state and the `bind:open` wiring from Task 2.

- [ ] **Step 1: Write the failing test**

Add to `filter-panel.spec.ts` beside the other `externalToggle` test (`:339`):

```ts
// Built-in collapse unmounts the panel body, taking any open menu with it. externalToggle does
// not - the panel stays mounted at w-0, clipped and inert - so an open menu survives the
// collapse and is still open on reopen unless it is explicitly closed.
it('closes an open section menu when collapsed in externalToggle mode', async () => {
  const { rerender } = render(FilterPanel, {
    props: {
      config: { sections: ['timeline', 'people'], providers: {} },
      timeBuckets: [],
      externalToggle: true,
      collapsed: false,
    },
  });

  await fireEvent.click(screen.getByTestId('section-menu-btn'));
  expect(screen.getByTestId('section-menu')).toBeTruthy();

  await rerender({
    config: { sections: ['timeline', 'people'], providers: {} },
    timeBuckets: [],
    externalToggle: true,
    collapsed: true,
  });

  expect(screen.getByTestId('section-menu-btn')).toHaveAttribute('aria-expanded', 'false');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts -t "externalToggle mode"`

Expected: FAIL — the menu is still in the DOM after the collapse.

- [ ] **Step 3: Force the menu shut on collapse**

In `filter-panel.svelte`, beside the other effects (near `:490`):

```ts
// externalToggle keeps this panel mounted at w-0 while collapsed rather than unmounting it, so
// an open menu would survive the collapse and still be open on reopen - and in the meantime is
// a popover painting out of a zero-width, inert box.
$effect(() => {
  if (collapsed) {
    sectionMenuOpen = false;
  }
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm test --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts -t "externalToggle mode"`

Expected: PASS.

- [ ] **Step 5: Run the whole filter-panel suite**

Run: `pnpm test --run src/lib/components/filter-panel/`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/components/filter-panel/
git commit -m "fix(web): close the filter section menu when the panel collapses

externalToggle mode keeps the panel mounted at w-0 while collapsed rather
than unmounting it, so a menu left open survived the collapse and was still
open on reopen - and in between was a popover painting out of a zero-width
inert box. The built-in collapse never showed this because it unmounts the
whole body."
```

---

### Task 4: Full verification

No new behaviour and no new tests — every one is already written and green by the end of Task 3. This task exists because two of the design's claims cannot be checked by any unit test, and because `filter-panel.svelte` renders inside every timeline page's spec, so the blast radius is wider than the folder that was edited.

**Files:** none modified unless a gate fails.

- [ ] **Step 1: Run every gate**

```bash
pnpm test --run
pnpm check:typescript
npx prettier --check src/lib/components/filter-panel/ ../i18n/en.json
npx eslint src/lib/components/filter-panel/
```

Expected: all green. The full suite matters here because `filter-panel.svelte` is rendered by every timeline page's spec.

- [ ] **Step 2: Verify in a browser — this cannot be unit tested**

happy-dom has no layout and no cascade, so nothing above proves the popover escapes `overflow-y-auto` clipping or wins against the header's `z-5`. Both are load-bearing claims in the spec's Positioning section and both are invisible to vitest.

Start the dev stack, then on `/photos`:

1. Open the filter panel and click the cog. Confirm the menu is fully visible, not cut off by the panel's `overflow-y-auto`, and drawn above the header rather than behind it.
2. Shrink the window until the panel scrolls, scroll it, and reopen the menu. Confirm it is still anchored to the cog.
3. Hide two sections in one visit to the menu — it must stay open between clicks.
4. Hide a section that has an active filter, close the menu, and confirm the dot on the cog.
5. Switch to a page using `externalToggle` (any album detail page), open the menu, collapse the panel, reopen it. The menu must be shut.
6. Set the OS to reduce motion and confirm the popover appears instantly.

- [ ] **Step 3: Commit only if a gate forced a change**

If every gate and every browser check passed, there is nothing to commit — Tasks 1 to 3 already landed the work. Commit only fixes this task provoked, describing what actually broke rather than restating the feature:

```bash
git add web/src/lib/components/filter-panel/
git commit -m "fix(web): <what the verification pass actually turned up>"
```

---

## Self-Review

**Spec coverage**

| Spec requirement                                    | Task                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| New `filter-section-menu.svelte` with listed props  | 1                                                                                |
| Cog in the header beside the `Filters` label        | 2                                                                                |
| Worded checkbox popover                             | 1                                                                                |
| `Show all` reset in the menu                        | 1 (renders), 2 (wired)                                                           |
| Dot on the cog, marker on the row                   | 1 (both derived), 2 (wired + pinned through the panel)                           |
| `clickOutside` on a wrapper enclosing cog + popover | 1                                                                                |
| Stays open across toggles                           | 1                                                                                |
| Escape returns focus to the cog                     | 1                                                                                |
| `aria-pressed` buttons, not `role="menu"`           | 1                                                                                |
| Logical-property anchoring                          | 1                                                                                |
| Reduced motion via `slideMotion()`                  | 1                                                                                |
| Renders inside the sticky header, z above 5         | 1 (class), 4 Step 2 (verified visually)                                          |
| `filter_manage_sections` added                      | 1                                                                                |
| `filter_show_sections_hint` reworded                | 2                                                                                |
| Row + `sectionIcons` deleted                        | 2                                                                                |
| Testids preserved                                   | 1 (rendered), 2 (migration)                                                      |
| 25 tests gain `openSectionMenu()`                   | 2                                                                                |
| 3 row assertions reshaped                           | 2                                                                                |
| Zero / one / all-hidden section boundaries          | 2                                                                                |
| Both restore routes                                 | 2                                                                                |
| `externalToggle` auto-close                         | 3                                                                                |
| Dot clears when its filter clears                   | 2                                                                                |
| `localStorage` unavailable                          | Untouched — the existing `try`/`catch` at `:490-498` is not modified by any task |
| No e2e churn                                        | No task — nothing under `e2e/` references these testids                          |

**Placeholder scan:** none. Every code step carries the code. Task 4 Step 3's commit message is intentionally open — it fires only if verification turns something up, and prescribing its wording would be prescribing the bug.

**Type consistency:** the prop set in Task 1's Interfaces block matches the component in Step 3 and the call site in Task 2 Step 3 — `sections`, `visible`, `titles`, `toggleLabels`, `hasActiveFilter`, `onToggle`, `onShowAll`, `open`. `hasActiveFilter` is passed by shorthand `{hasActiveFilter}` and matches the panel's own `function hasActiveFilter(section: string): boolean` at `:621`. `openSectionMenu()` is defined in Task 2 Step 1 and used in Tasks 2, 3 and 4. The type is imported as `FilterSection` in the new file, matching `filter-panel.ts:35`.
