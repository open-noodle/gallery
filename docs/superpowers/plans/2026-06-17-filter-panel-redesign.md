# Filter Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Gallery filter panel feel fluid and polished — animated collapse/expand, sliding sections, soft surfaces, and a breathing year grid — with no behavior or feature changes.

**Architecture:** Keep today's structure. Add a shared motion module, animate the panel via a persistent width-transitioning shell (keeping the `{#if collapsed}` content swap so existing presence-based tests stay valid), slide section bodies with Svelte's `transition:slide|local`, and restyle sections/year-grid within the existing theme tokens. Reduced motion is honored via Tailwind `motion-reduce:` (CSS) and a `slideMotion()` helper (JS slide).

**Tech Stack:** SvelteKit + Svelte 5 runes, Tailwind CSS 4, `@immich/ui`, Vitest + `@testing-library/svelte` (happy-dom). Spec: `docs/superpowers/specs/2026-06-17-filter-panel-redesign-design.md`.

## Global Constraints

- Scope is **fork-only** code under `web/src/lib/components/filter-panel/`. No upstream-rebase concern.
- **No behavior or feature changes.** Same filters, same data flow, same persistence.
- **Motion tokens (verbatim, matched to the approved prototype):** CSS easing `cubic-bezier(0.22, 1, 0.36, 1)`; Svelte slide easing `quintOut` from `svelte/easing`. Durations: panel width `420ms`, section slide `300ms`, hover/micro `150ms`.
- **Tailwind arbitrary-easing caveat:** the easing appears in two literal forms that must NOT drift — the Tailwind class is `ease-[cubic-bezier(0.22,1,0.36,1)]` (**spaceless**, or it won't compile) while the JS constant `SETTLE_EASE` is `'cubic-bezier(0.22, 1, 0.36, 1)'` (spaced, for inline styles). This arbitrary easing has no precedent in this repo — Task 5 greps the built CSS to confirm it generated.
- **Reduced motion:** CSS transitions carry `motion-reduce:transition-none`; the section slide uses `slideMotion(mediaQueryManager.reducedMotion)` (duration collapses to `0`).
- **Theme tokens only:** `bg-light`, `bg-subtle`, `text-primary`, `bg-primary/10`, `immich-primary` / `immich-dark-primary`, and the existing `border-gray-200 dark:border-gray-700` grays. No new colors.
- **Widths:** expanded shell `w-64` (256px, unchanged) must equal the inner `discovery-panel` width; collapsed rail `w-14` (56px, up from `w-8`).
- **Preserve every `data-testid`.** The collapse mutual-exclusivity assertions (`collapsed-icon-strip` ⟺ `discovery-panel`) are a regression guard — keep them green, never weaken them.
- **Import paths:** `mediaQueryManager` from `$lib/stores/media-query-manager.svelte`; the new helper from `./motion` (same directory).
- **Lint discipline:** run `pnpm check` (svelte-check/tsc) and the relevant `vitest` file per task; **defer the single full `make lint-web` pass to the final verification gate** (Task 5).
- **TDD:** every behavioral/structural step is red → green → refactor. Aesthetic feel (easing, surfaces, clip-reveal) is verified manually in Task 5 — never asserted with fake tests.

---

### Task 0: Environment setup & green baseline

**Files:** none (setup only).

- [ ] **Step 1: Install workspace dependencies**

Run from the worktree root:

```bash
pnpm install
```

- [ ] **Step 2: Build the TypeScript SDK (web imports depend on it)**

Run:

```bash
make build-sdk
```

- [ ] **Step 3: Confirm the filter-panel tests are green before any change**

Run:

```bash
cd web && pnpm test -- --run \
  src/lib/components/filter-panel/__tests__/filter-panel.spec.ts \
  src/lib/components/filter-panel/__tests__/temporal-picker.spec.ts
```

Expected: PASS (all tests in both files). This is the baseline — do not proceed if red.

---

### Task 1: Shared motion module

**Files:**

- Create: `web/src/lib/components/filter-panel/motion.ts`
- Test: `web/src/lib/components/filter-panel/__tests__/motion.spec.ts`

**Interfaces:**

- Produces:
  - `export const SETTLE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'`
  - `export const PANEL_DURATION_MS = 380`
  - `export const SECTION_DURATION_MS = 240`
  - `export interface SlideMotion { duration: number; easing?: (t: number) => number }`
  - `export function slideMotion(reducedMotion: boolean): SlideMotion`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/components/filter-panel/__tests__/motion.spec.ts`:

```ts
import { quintOut } from 'svelte/easing';
import { describe, expect, it } from 'vitest';
import { PANEL_DURATION_MS, SECTION_DURATION_MS, SETTLE_EASE, slideMotion } from '../motion';

describe('motion tokens', () => {
  it('exposes the agreed durations and settle easing', () => {
    expect(PANEL_DURATION_MS).toBe(420);
    expect(SECTION_DURATION_MS).toBe(300);
    expect(SETTLE_EASE).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
  });
});

describe('slideMotion', () => {
  it('returns an instant (zero-duration) config when reduced motion is requested', () => {
    expect(slideMotion(true)).toEqual({ duration: 0 });
  });

  it('returns the section duration and quintOut easing when motion is allowed', () => {
    const motion = slideMotion(false);
    expect(motion.duration).toBe(SECTION_DURATION_MS);
    expect(motion.easing).toBe(quintOut);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/motion.spec.ts
```

Expected: FAIL — cannot resolve `../motion`.

- [ ] **Step 3: Write the minimal implementation**

Create `web/src/lib/components/filter-panel/motion.ts`:

```ts
import { quintOut } from 'svelte/easing';

/**
 * Decelerating "settle" curve for CSS transitions (panel width, hovers, chips).
 * NOTE: in Tailwind classes this must be written spaceless — `ease-[cubic-bezier(0.22,1,0.36,1)]` —
 * or the class won't compile. This spaced literal is only for JS/inline-style use.
 */
export const SETTLE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Shared animation durations (ms) so the panel feels consistent. */
export const PANEL_DURATION_MS = 420;
export const SECTION_DURATION_MS = 300;

export interface SlideMotion {
  duration: number;
  easing?: (t: number) => number;
}

/**
 * Svelte `slide` config for section expand/collapse. Collapses to an instant
 * (duration 0) when the user prefers reduced motion.
 */
export function slideMotion(reducedMotion: boolean): SlideMotion {
  return reducedMotion ? { duration: 0 } : { duration: SECTION_DURATION_MS, easing: quintOut };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/motion.spec.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/filter-panel/motion.ts web/src/lib/components/filter-panel/__tests__/motion.spec.ts
git commit -m "feat(web): add filter panel motion tokens + slideMotion helper"
```

---

### Task 2: Sliding, soft-surface filter sections

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-section.svelte` (whole file)
- Test: `web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts` (add one test)

**Interfaces:**

- Consumes: `slideMotion` from `./motion`; `mediaQueryManager` from `$lib/stores/media-query-manager.svelte`.
- Produces: no new exports — same `Props` (`title`, `testId`, `children`, `refetching?`, `count?`, `expanded?`, `onToggleExpanded?`).

**Why `transition:slide|local`:** the `filter-section-{testId}` wrapper lives _outside_ the `{#if expanded}` body, and existing tests assert that wrapper appears/disappears synchronously when a section's **visibility** is toggled via the toggle row (the parent `{#if visibleSections.has(section)}`). A non-local transition would replay an outro on that parent removal and keep the wrapper in the DOM, breaking those `toBeNull()` assertions. `|local` restricts the slide to the section's own expand/collapse.

Two correctness notes the implementer must respect:

- The genuinely dangerous test pattern is **asserting `.filter-section-content` is absent immediately after a header _click_** (which flips `isOpen` false and plays the local outro asynchronously). Verified: no such assertion exists today (the header-click tests assert localStorage, and the only content-absence assertions are mount-time from localStorage). Do **not** introduce a post-click absence assertion.
- Default-expanded sections render their body synchronously at mount with **no** intro animation, because `@testing-library/svelte`'s `render()` does not pass `intro: true` and Svelte suppresses intros on first mount. The accordion-persistence tests rely on this — do not enable component-level `intro`.

- [ ] **Step 1: Write the failing test**

Add to `web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts` (inside the top-level `describe`, after the existing imports — `FilterPanel`, `render`, `fireEvent` are already imported in this file):

```ts
it('renders an expanded section on a soft surface without a hard divider', () => {
  const { getByTestId } = render(FilterPanel, {
    props: { config: { sections: ['timeline'], providers: {} }, timeBuckets: [] },
  });
  const section = getByTestId('filter-section-timeline');
  expect(section.className).toContain('bg-subtle');
  expect(section.className).not.toContain('border-b');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts -t "soft surface"
```

Expected: FAIL — current root has `border-b` and no `bg-subtle`.

- [ ] **Step 3: Replace the whole component**

Overwrite `web/src/lib/components/filter-panel/filter-section.svelte` with:

```svelte
<script lang="ts">
  import { mediaQueryManager } from '$lib/stores/media-query-manager.svelte';
  import { Icon } from '@immich/ui';
  import { mdiChevronDown } from '@mdi/js';
  import type { Snippet } from 'svelte';
  import { slide } from 'svelte/transition';
  import { slideMotion } from './motion';

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

  let isEmpty = $derived(count === 0);
  let isOpen = $derived(expanded && !isEmpty);
</script>

<div
  class="mx-1.5 mb-0.5 rounded-xl transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none {isOpen
    ? 'bg-subtle'
    : ''}"
  data-testid="filter-section-{testId}"
>
  <button
    type="button"
    class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-start {isEmpty ? 'opacity-50' : ''} {isOpen
      ? ''
      : 'hover:bg-subtle'}"
    onclick={() => {
      if (!isEmpty && onToggleExpanded) {
        onToggleExpanded();
      }
    }}
    disabled={isEmpty}
  >
    <span class="text-sm font-medium">
      {title}{isEmpty ? ' (0)' : ''}
    </span>
    {#if !isEmpty}
      <Icon
        icon={mdiChevronDown}
        size="16"
        class="text-gray-500 transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none dark:text-gray-400 {expanded
          ? ''
          : '-rotate-90'}"
      />
    {/if}
  </button>
  {#if isOpen}
    <div transition:slide|local={slideMotion(mediaQueryManager.reducedMotion)}>
      <div class="filter-section-content px-3 pb-3.5" class:refetching>
        {@render children()}
      </div>
    </div>
  {/if}
</div>

<style>
  .filter-section-content {
    transition: opacity 0.2s ease 150ms;
  }
  .filter-section-content.refetching {
    opacity: 0.5;
  }
</style>
```

- [ ] **Step 4: Run the new test + the full filter-panel suite to verify pass + no regressions**

Run:

```bash
cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts
```

Expected: PASS (all tests, including the new "soft surface" test and every existing collapse/visibility assertion).

- [ ] **Step 5: Type-check**

Run:

```bash
cd web && pnpm check
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/components/filter-panel/filter-section.svelte web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts
git commit -m "feat(web): slide + soft-surface filter sections"
```

---

### Task 3: Width-eased collapse shell + rail width + toggle polish

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.svelte` (the render block at the end of the file, ~lines 658–854, plus the toggle-row button classes ~lines 713–718)
- Test: `web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts` (add one test)

**Interfaces:**

- Consumes: nothing new (CSS-only motion via Tailwind + `SETTLE_EASE` value inlined as the arbitrary easing).
- Produces: a new wrapper element `data-testid="filter-panel-shell"` that owns the animated width and the right border.

- [ ] **Step 1: Write the failing tests**

Add to `web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`:

```ts
it('animates the panel width via a persistent shell with a reduced-motion guard', async () => {
  const { getByTestId } = render(FilterPanel, {
    props: { config: { sections: ['timeline'], providers: {} }, timeBuckets: [] },
  });
  const shell = getByTestId('filter-panel-shell');
  expect(shell.className).toContain('transition-[width]');
  expect(shell.className).toContain('motion-reduce:transition-none');
  expect(shell.className).toContain('w-64');

  await fireEvent.click(getByTestId('collapse-panel-btn'));
  expect(shell.className).toContain('w-14');
  expect(shell.className).not.toContain('w-64');
});

it('gives the toggle-row pills a press-scale and a reduced-motion guard', () => {
  const { getByTestId } = render(FilterPanel, {
    props: { config: { sections: ['timeline'], providers: {} }, timeBuckets: [] },
  });
  const toggle = getByTestId('section-toggle-timeline');
  expect(toggle.className).toContain('active:scale-90');
  expect(toggle.className).toContain('motion-reduce:transition-none');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts
```

Expected: the two new tests FAIL (no `filter-panel-shell` testid; the toggle button has no `active:scale-90` yet) and **every existing test still PASSES**.

- [ ] **Step 3: Wrap the collapse branches in a persistent shell**

In `web/src/lib/components/filter-panel/filter-panel.svelte`, replace the top of the render block. Find:

```svelte
{#if hidden}
  <!-- FilterPanel hidden: no assets to filter -->
{:else if collapsed}
  <div
    class="flex h-full w-8 flex-shrink-0 flex-col items-center gap-3 border-r border-gray-200 bg-light py-2 dark:border-gray-700"
    data-testid="collapsed-icon-strip"
  >
```

Replace with:

```svelte
{#if hidden}
  <!-- FilterPanel hidden: no assets to filter -->
{:else}
  <div
    class="flex h-full flex-shrink-0 overflow-hidden border-r border-gray-200 bg-light transition-[width] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none dark:border-gray-700 {collapsed
      ? 'w-14'
      : 'w-64'}"
    data-testid="filter-panel-shell"
  >
    {#if collapsed}
      <div
        class="flex h-full w-full flex-shrink-0 flex-col items-center gap-3 py-2"
        data-testid="collapsed-icon-strip"
      >
```

> **Critical boundary (do not skip):** Edit A above ends with the `collapsed-icon-strip` `<div>` _opening_. Everything that currently follows — the expand button, the `{#each config.sections …}` rail buttons, and the strip's **closing `</div>`** (current line ~687) — stays **exactly as it is**. That closing `</div>` now closes the strip inside the new `{#if collapsed}`. The `{:else}` immediately after it is what Step 4 edits next; leave the `</div>{:else}` pair connected.

- [ ] **Step 4: Re-point the expanded branch and close the shell**

Still in `filter-panel.svelte`, find the expanded-branch opening:

```svelte
{:else}
  <div
    class="immich-scrollbar flex w-64 flex-col overflow-y-auto border-r border-gray-200 bg-light dark:border-gray-700"
    data-testid="discovery-panel"
  >
```

Replace with:

```svelte
    {:else}
      <div
        class="immich-scrollbar flex h-full w-64 flex-col overflow-y-auto bg-light"
        data-testid="discovery-panel"
      >
```

> **Critical boundary:** between this `discovery-panel` edit and the closing edit below, the **entire expanded-panel body** — the sticky header, the toggle row, the `{#each}` sections, and the empty-state block — stays **exactly as it is**.

Then find the final closing of the render block:

```svelte
      {/if}
    </div>
  </div>
{/if}
```

Replace with (adds one extra `</div>` to close the new shell, plus closes the inner `{#if collapsed}`):

```svelte
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}
```

> **Note:** indentation in these snippets is illustrative — Svelte ignores it and `make format-web` (Task 5) normalizes it. What matters is the tag/`{/if}` ordering. The final structure must be exactly: `{#if hidden} … {:else} <shell-div> {#if collapsed} <strip>…</strip> {:else} <discovery-panel>…</discovery-panel> {/if} </shell-div> {/if}`. svelte-check (Step 7) catches an _imbalance_ but will NOT catch wrong-but-balanced nesting — re-read this structure before running it.

- [ ] **Step 5: Polish the toggle-row buttons**

Still in `filter-panel.svelte`, find the toggle button class (around line 715):

```svelte
            class="relative flex h-[30px] w-[30px] items-center justify-center rounded-lg transition-colors
              {visibleSections.has(section)
```

Replace the first line with:

```svelte
            class="relative flex h-[30px] w-[30px] items-center justify-center rounded-[10px] transition-all duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100
              {visibleSections.has(section)
```

- [ ] **Step 6: Run the new tests + full file (HARD GATE)**

Run:

```bash
cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts
```

Expected: PASS — both new tests pass AND every existing collapse/expand/visibility/persistence assertion stays green (they still toggle `collapsed-icon-strip` ⟺ `discovery-panel` via the inner `{#if collapsed}`).
**Hard gate:** if any pre-existing test goes red, the shell re-nest is wrong — revert Edits A/B/C and recount the closing tags. **Never** edit an existing assertion to make it pass; those are the regression guard.

- [ ] **Step 7: Type-check**

Run:

```bash
cd web && pnpm check
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/components/filter-panel/filter-panel.svelte web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts
git commit -m "feat(web): width-eased collapse shell + rail width + toggle polish"
```

---

### Task 4: Breathing 3-column year grid

**Files:**

- Modify: `web/src/lib/components/filter-panel/temporal-picker.svelte` (year grid ~lines 226–249; month-grid chip classes ~lines 191–224)
- Test: `web/src/lib/components/filter-panel/__tests__/temporal-picker.spec.ts` (add tests)

**Interfaces:**

- Consumes / Produces: none new. Same props and `data-testid`s (`year-grid`, `year-btn-{year}`, `month-grid`, `month-btn-{month}`).

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe('TemporalPicker component', ...)` block in `web/src/lib/components/filter-panel/__tests__/temporal-picker.spec.ts` (its `buckets` aggregates to years 2022 + 2023):

```ts
it('lays out the year grid in three columns with year buttons as direct grid children', () => {
  const { getByTestId } = render(TemporalPicker, { props: { timeBuckets: buckets } });
  const grid = getByTestId('year-grid');
  expect(grid.className).toContain('grid-cols-3');
  // The old flex-wrap `basis-[...]` classes are gone; buttons are direct grid items.
  expect(grid.querySelectorAll(':scope > [data-testid^="year-btn-"]').length).toBe(2);
});

it('guards the year and month chips against reduced motion', () => {
  const yearView = render(TemporalPicker, { props: { timeBuckets: buckets } });
  expect(yearView.getByTestId('year-btn-2022').className).toContain('motion-reduce:transition-none');

  const monthView = render(TemporalPicker, { props: { timeBuckets: buckets, selectedYear: 2023 } });
  expect(monthView.getByTestId('month-btn-6').className).toContain('motion-reduce:transition-none');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/temporal-picker.spec.ts
```

Expected: the two new tests FAIL (the year grid is `flex flex-wrap`, not `grid-cols-3`; the chips lack `motion-reduce:transition-none`); all existing tests PASS.

- [ ] **Step 3: Convert the year grid to a 3-column grid with polished chips**

In `web/src/lib/components/filter-panel/temporal-picker.svelte`, find the year-grid block:

```svelte
    <!-- Year grid: 4-column flex wrap -->
    <div class="flex flex-wrap gap-1.5" data-testid="year-grid">
      {#each years as y (y.year)}
        <button
          type="button"
          class="year-chip flex min-w-[54px] flex-1 basis-[calc(25%-5px)] flex-col items-center rounded-lg border px-2 py-1.5 transition-all duration-100
            {y.count === 0
            ? 'cursor-default border-gray-200 opacity-30 dark:border-gray-700'
            : 'cursor-pointer border-gray-200 hover:border-immich-primary hover:bg-immich-primary/5 dark:border-gray-700 dark:hover:border-immich-dark-primary dark:hover:bg-immich-dark-primary/5'}"
          onclick={() => handleYearClick(y.year, y.count)}
          data-testid="year-btn-{y.year}"
        >
          <span class="text-xs font-semibold leading-tight">{y.year}</span>
          <span class="text-xs leading-tight text-gray-400 opacity-60 dark:text-gray-500">{y.count}</span>
          <div class="mt-0.5 h-[2px] w-full overflow-hidden rounded-sm bg-gray-200 dark:bg-gray-700">
            <div
              class="h-full rounded-sm bg-immich-primary transition-[width] duration-300 dark:bg-immich-dark-primary"
              style="width: {y.volumePercent}%"
            ></div>
          </div>
        </button>
      {/each}
    </div>
```

Replace with:

```svelte
    <!-- Year grid: 3-column grid -->
    <div class="grid grid-cols-3 gap-1.5" data-testid="year-grid">
      {#each years as y (y.year)}
        <button
          type="button"
          class="year-chip flex flex-col items-center rounded-xl border px-2 py-1.5 transition-all duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none
            {y.count === 0
            ? 'cursor-default border-gray-200 opacity-30 dark:border-gray-700'
            : 'cursor-pointer border-gray-200 hover:-translate-y-0.5 hover:border-immich-primary hover:bg-immich-primary/5 motion-reduce:hover:translate-y-0 dark:border-gray-700 dark:hover:border-immich-dark-primary dark:hover:bg-immich-dark-primary/5'}"
          onclick={() => handleYearClick(y.year, y.count)}
          data-testid="year-btn-{y.year}"
        >
          <span class="text-xs font-semibold leading-tight tabular-nums">{y.year}</span>
          <span class="text-xs leading-tight tabular-nums text-gray-400 opacity-60 dark:text-gray-500">{y.count}</span>
          <div class="mt-1 h-[3px] w-full overflow-hidden rounded-sm bg-gray-200 dark:bg-gray-700">
            <div
              class="year-bar h-full origin-left rounded-sm bg-immich-primary transition-[width] duration-300 dark:bg-immich-dark-primary"
              style="width: {y.volumePercent}%"
            ></div>
          </div>
        </button>
      {/each}
    </div>
```

- [ ] **Step 4: Add the one-time bar-grow animation (reduced-motion safe)**

In the same file, add a `<style>` block at the end of the file (the component currently has none):

```svelte
<style>
  .year-bar {
    animation: year-bar-grow 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  @keyframes year-bar-grow {
    from {
      transform: scaleX(0);
    }
    to {
      transform: scaleX(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .year-bar {
      animation: none;
    }
  }
</style>
```

- [ ] **Step 5: Match the month-grid chips to the year chips (consistency)**

Find the month button class:

```svelte
          class="flex flex-col items-center rounded-lg border px-2 py-2 transition-all duration-100
```

Replace with:

```svelte
          class="flex flex-col items-center rounded-xl border px-2 py-2 transition-all duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none
```

- [ ] **Step 6: Run the tests to verify pass + no regressions**

Run:

```bash
cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/temporal-picker.spec.ts
```

Expected: PASS (all tests in the file).

- [ ] **Step 7: Type-check**

Run:

```bash
cd web && pnpm check
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/components/filter-panel/temporal-picker.svelte web/src/lib/components/filter-panel/__tests__/temporal-picker.spec.ts
git commit -m "feat(web): 3-column breathing year grid in temporal picker"
```

---

### Task 5: Verification gate (full suite, lint, format, manual)

**Files:** none new — this is the deferred full-quality pass plus manual sign-off.

- [ ] **Step 1: Run the full web unit suite**

Run:

```bash
cd web && pnpm test -- --run
```

Expected: PASS (entire web suite). If anything outside the filter panel changed unexpectedly, stop and investigate.

- [ ] **Step 2: Type-check the whole web package**

Run:

```bash
make check-web
```

Expected: 0 errors.

- [ ] **Step 3: Single deferred lint pass**

Run:

```bash
make lint-web
```

Expected: 0 warnings (the repo enforces `--max-warnings 0`). Fix any findings, then re-run.

- [ ] **Step 4: Format**

Run:

```bash
make format-web
```

If prettier rewrites anything, review and stage it.

- [ ] **Step 5: Verify the arbitrary easing class actually compiled**

`ease-[cubic-bezier(0.22,1,0.36,1)]` has no precedent in this repo. Build the web app and confirm Tailwind emitted it (spaceless) into the generated CSS:

```bash
cd web && pnpm build && grep -rl "cubic-bezier(0.22,1,0.36,1)" .svelte-kit build 2>/dev/null | head
```

Expected: at least one CSS file matches. If empty, the class did not compile — confirm it is written spaceless and re-run. (Step 6's manual page check is the visual backstop: a missing easing shows up as a linear/instant transition.)

- [ ] **Step 6: Manual verification (aesthetics — not CI-testable)**

Start the dev stack (`make dev`) and, on the **photos**, **map**, and **spaces** pages, confirm:

- Collapsing the panel **eases its width** down to the icon rail (and back), not a snap.
- Clicking a section header **slides** the body open/closed; the chevron rotates.
- Sections sit on **soft surfaces** with no hard full-width divider ladder.
- The year grid is **3 columns**, chips lift on hover, bars grow on load.
- The toggle-row pills show the tinted active state and press-scale.
- With the OS **"Reduce motion"** setting enabled, every animation above becomes instant (no width ease, no slide, no bar grow, no hover lift), and the panel still works.
- Light **and** dark themes both look right.

- [ ] **Step 7: Commit any formatting/lint fixes**

```bash
git add -A
git commit -m "chore(web): lint + format pass for filter panel redesign" --allow-empty
```

---

## Self-Review

**Spec coverage:**

- Motion tokens / easing / durations → Task 1 (`motion.ts`) + Global Constraints. ✓
- Panel width-eased rail collapse (shell, `w-64` ⟺ `w-14`, clip-reveal, preserve `{#if}` swap) → Task 3. ✓
- Section height-slide via `transition:slide` (matches `setting-accordion`), `|local` to protect visibility tests → Task 2. ✓
- Surfaces over hard rules (drop `border-b`, `bg-subtle` active surface) → Task 2. ✓
- 3-column breathing year grid + chip polish + bar grow → Task 4. ✓
- Toggle-row pill polish → Task 3 Step 5. ✓
- Reduced motion (Tailwind `motion-reduce:` + `slideMotion`) → DOM-asserted on the shell (Task 3), toggle pills (Task 3), and year/month chips (Task 4); `slideMotion` unit-tested (Task 1); manual OS-setting pass (Task 5). ✓
- Theme-token-only, both themes → Global Constraints + Task 5 manual. ✓
- Tests stay green; new red→green TDD tests for every testable change → Tasks 1–4; deferred lint → Task 5. ✓

**Intentional fidelity cuts (from the prototype → production):**

- Durations are matched to the approved prototype (panel 420ms, section 300ms, hover 150ms).
- The prototype's **per-section leading icons** and **count-pill badges** are deliberately NOT carried over: the toggle row already shows the section icons, and surfacing counts as badges would change information display beyond "light polish". The section header keeps today's title + `(0)`-when-empty.
- The prototype's per-year-chip entrance **stagger** is dropped; the volume bars still grow on load.
- Section slide uses Svelte `transition:slide` (codebase convention) rather than the prototype's CSS `grid-template-rows` technique — same visual result.

**Placeholder scan:** none — every code/test step contains full code and exact commands.

**Type consistency:** `slideMotion(reducedMotion: boolean): SlideMotion` is defined in Task 1 and consumed identically in Task 2. `PANEL_DURATION_MS = 420` / `SECTION_DURATION_MS = 300` agree between the `motion.ts` code and its test. The `filter-panel-shell` testid introduced in Task 3 is only referenced by Task 3's own test. Widths (`w-64`, `w-14`) match between Global Constraints, Task 3 code, and Task 3 test. The Tailwind easing is spaceless `cubic-bezier(0.22,1,0.36,1)` everywhere it appears as a class; the spaced `SETTLE_EASE` literal is for JS only.
