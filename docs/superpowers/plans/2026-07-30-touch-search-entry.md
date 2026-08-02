# Touch Search Entry + `/` Shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give touch devices a working, honest way into the search palette (issue #862), and make `/` open it.

**Architecture:** Tapping the nav search bar with a finger opens the modal palette instead of the cramped inline dropdown, decided per event via `PointerEvent.pointerType`. The `Ctrl+K` chip is hidden when the pointer is coarse. `/` becomes an alias for the existing `Ctrl+K` path, replacing the old `/` → Explore binding, with its guard and descriptors extracted into a small pure module so they are directly testable.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, TypeScript, `bits-ui` Command, `@immich/ui` shortcut actions, Vitest 4 + happy-dom + `@testing-library/svelte` + `@testing-library/user-event` 14.

**Spec:** `docs/superpowers/specs/2026-07-30-touch-search-entry-design.md`

## Global Constraints

- All work happens in `web/`. Run every command from `web/` unless stated otherwise.
- `@immich/sdk` must be built before tests will run: `pnpm --filter @immich/sdk build` from the repo root. Already done in this worktree; redo it if `Failed to resolve import "@immich/sdk"` appears.
- Baseline before any change: `pnpm test` → **4001 passed | 2 skipped | 8 todo, 0 failures**. An `ECONNREFUSED ::1:3000` block in the output is expected background noise, not a failure.
- Import shortcut helpers from `$lib/actions/shortcut`, **never** from `@immich/ui` directly. That barrel re-exports `matchesShortcut`, `shortcut`, `shortcuts`, `shouldIgnoreEvent`, `Shortcut`, and `ShortcutOptions`, and is the established convention in this codebase.
- Test environment is **happy-dom**, not jsdom. `matchMedia` is globally stubbed in `src/test-data/setup.ts` to always return `matches: false`, so every `MediaQuery` reads `false` unless the module is mocked.
- Mock media queries with the hoisted-state `vi.mock` pattern already used in `src/lib/components/global-search/__tests__/global-search.spec.ts`. Do not use `vi.spyOn(mediaQueryManager, ...)`.
- Never add a `Co-Authored-By: Claude` trailer or "Generated with Claude Code" line to any commit.
- `GalleryViewer.svelte` and `TimelineKeyboardActions.svelte` are upstream files. Changes there must be pure deletions — no reformatting, renaming, or reordering.

## Verified Environment Facts

These were confirmed empirically in this worktree. Do not re-litigate them; build on them.

| Fact                                                                                                 | Evidence                                                  |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `user.pointer({ keys: '[TouchA]', target })` dispatches `pointerdown` with `pointerType === 'touch'` | probed, passing                                           |
| An **unprevented** touch tap **focuses** the input                                                   | probed, passing — this is why the guard matters           |
| `preventDefault()` on a touch `pointerdown` **suppresses** that focus                                | probed, passing — `not.toHaveFocus()` is a real assertion |
| `user.click(target)` dispatches `pointerdown` with `pointerType === 'mouse'`                         | probed, passing                                           |
| `PointerEvent` constructor exists and carries `pointerType`                                          | probed, passing                                           |
| `fireEvent.pointerDown(el, { pointerType: 'pen' })` delivers `'pen'`                                 | probed, passing                                           |
| `fireEvent.pointerDown(el)` yields `pointerType === ''`                                              | probed, passing                                           |

**The plan itself was dry-run before being finalised.** Task 1's tests were applied against unmodified source and produced exactly the failures Step 2 claims (`3 failed | 20 passed`). Task 3's module and spec were written and run in full (`20 passed`). Both were then reverted, so the tree is clean and every task still starts from RED. Every line number, code block, and expected tally below is copied from that run — not estimated.

## File Structure

| File                                                                                      | Responsibility                                                                                                             |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/components/global-search/global-search.svelte` (modify)                          | Route touch taps to the modal; hold the "focus never downgrades an open modal" invariant; hide the chip on coarse pointers |
| `src/lib/components/global-search/__tests__/global-search-input-trigger.spec.ts` (modify) | Cover pointer routing and chip visibility                                                                                  |
| `src/lib/utils/search-shortcut.ts` (create)                                               | The `/` descriptors and the editable-target guard — pure, no Svelte                                                        |
| `src/lib/utils/search-shortcut.spec.ts` (create)                                          | Cover the descriptors against the real matcher, and the guard                                                              |
| `src/routes/+layout.svelte` (modify)                                                      | Wire the `/` descriptors into the existing `use:shortcuts` array                                                           |
| `src/lib/components/timeline/actions/TimelineKeyboardActions.svelte` (modify)             | Remove `/` → Explore and its now-unused imports                                                                            |
| `src/lib/components/shared-components/gallery-viewer/GalleryViewer.svelte` (modify)       | Remove `/` → Explore                                                                                                       |
| `src/lib/modals/ShortcutsModal.svelte` (modify)                                           | Document `/`                                                                                                               |

---

### Task 1: Route touch taps to the modal palette

**Files:**

- Modify: `web/src/lib/components/global-search/global-search.svelte:485-489` (the `openDropdown` function) and `:631-651` (the dropdown `Command.Input`)
- Test: `web/src/lib/components/global-search/__tests__/global-search-input-trigger.spec.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: no exported symbols. Behaviour later tasks rely on: `globalSearchManager.presentation === 'modal'` after a touch tap, and `openDropdown` refusing to run while a modal is open.

- [ ] **Step 1: Write the failing tests**

Append these five tests inside the existing `describe('global-search-input-trigger', ...)` block, after the test named `'switches from dropdown to modal presentation on the keyboard launcher shortcut'`.

Add `fireEvent` to the existing import on line 1 so it reads:

```ts
import { fireEvent, render, screen } from '@testing-library/svelte';
```

```ts
it('opens the modal palette when the search field is tapped', async () => {
  const openSpy = vi.spyOn(globalSearchManager, 'open');
  const user = userEvent.setup();

  render(GlobalSearchInputTrigger);

  const input = screen.getByRole('combobox', { name: 'cmdk_placeholder' });
  await user.pointer({ keys: '[TouchA]', target: input });

  expect(openSpy).toHaveBeenCalledWith('modal');
  expect(globalSearchManager.presentation).toBe('modal');
  expect(document.querySelector('[data-cmdk-dropdown-panel]')).toBeNull();
});

it('does not focus the search field when it is tapped', async () => {
  const user = userEvent.setup();

  render(GlobalSearchInputTrigger);

  const input = screen.getByRole('combobox', { name: 'cmdk_placeholder' });
  await user.pointer({ keys: '[TouchA]', target: input });

  expect(input).not.toHaveFocus();
});

it('opens the inline dropdown for pen input rather than the modal', async () => {
  const user = userEvent.setup();

  render(GlobalSearchInputTrigger);

  const input = screen.getByRole('combobox', { name: 'cmdk_placeholder' });
  await fireEvent.pointerDown(input, { pointerType: 'pen' });
  await user.click(input);

  expect(globalSearchManager.presentation).toBe('dropdown');
});

it('opens the inline dropdown when a pointerdown carries no pointer type', async () => {
  const user = userEvent.setup();

  render(GlobalSearchInputTrigger);

  const input = screen.getByRole('combobox', { name: 'cmdk_placeholder' });
  await fireEvent.pointerDown(input);
  await user.click(input);

  expect(globalSearchManager.presentation).toBe('dropdown');
});

it('does not let focus downgrade an open modal to the inline dropdown', async () => {
  render(GlobalSearchInputTrigger);

  globalSearchManager.open('modal');

  const input = screen.getByRole('combobox', { name: 'cmdk_placeholder' });
  await fireEvent.focus(input);

  expect(globalSearchManager.presentation).toBe('modal');
  expect(document.querySelector('[data-cmdk-dropdown-panel]')).toBeNull();
});
```

- [ ] **Step 2: Run the tests and confirm they fail for the right reason**

Run: `pnpm exec vitest run src/lib/components/global-search/__tests__/global-search-input-trigger.spec.ts`

Expected — this exact tally, confirmed by running it: **`Tests  3 failed | 20 passed (23)`**

- `opens the modal palette when the search field is tapped` — `AssertionError: expected "open" to be called with arguments: [ 'modal' ]`. The touch tap focuses the input, `openDropdown` fires, and `presentation` is `'dropdown'`.
- `does not focus the search field when it is tapped` — fails because nothing prevents the tap's default.
- `does not let focus downgrade an open modal to the inline dropdown` — `AssertionError: expected 'dropdown' to be 'modal'`.

The two `pointerType` tests (`pen`, none) **pass already** — they pin behaviour that must survive the change. If either fails here, stop and re-read the file; something else is wrong.

- [ ] **Step 3: Add the touch handler and the modal guard**

In `global-search.svelte`, replace the existing `openDropdown` function (currently at `:485-489`):

```ts
function openDropdown() {
  if (!showDropdownPanel) {
    manager.open('dropdown');
  }
}
```

with:

```ts
function openDropdown() {
  // Focus must never downgrade an open modal to the inline dropdown.
  // `showDropdownPanel` is false while the modal is open, so without this the
  // next focus event would call open('dropdown') and clobber the presentation.
  if (manager.isOpen && manager.presentation === 'modal') {
    return;
  }
  if (!showDropdownPanel) {
    manager.open('dropdown');
  }
}

function openModalOnTouch(event: PointerEvent) {
  if (event.pointerType !== 'touch') {
    return;
  }
  // preventDefault is load-bearing: it suppresses the focus this tap would
  // otherwise produce on pointer release, and it stops iOS raising the soft
  // keyboard against an input the modal is about to cover.
  event.preventDefault();
  manager.open('modal');
}
```

- [ ] **Step 4: Wire the handler to the dropdown input**

In the `variant === 'dropdown'` branch, add `onpointerdown` to `Command.Input` immediately after the existing `onfocus` line (currently `:636`):

```svelte
          onfocus={openDropdown}
          onpointerdown={openModalOnTouch}
```

Leave every other attribute on that element untouched.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm exec vitest run src/lib/components/global-search/__tests__/global-search-input-trigger.spec.ts`

Expected: PASS, all tests in the file including the pre-existing ones.

- [ ] **Step 6: Check for regressions in the sibling suite**

Run: `pnpm exec vitest run src/lib/components/global-search`

Expected: PASS. The palette suite is large and exercises both presentations; a failure here means the guard is too broad.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/global-search/global-search.svelte src/lib/components/global-search/__tests__/global-search-input-trigger.spec.ts
git commit -m "fix(web): open the modal palette when the search bar is tapped (#862)"
```

---

### Task 2: Hide the hotkey chip on coarse pointers

**Files:**

- Modify: `web/src/lib/components/global-search/global-search.svelte:652-656` (the `<kbd>` block)
- Test: `web/src/lib/components/global-search/__tests__/global-search-input-trigger.spec.ts`

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: no exported symbols.

- [ ] **Step 1: Add the media query mock to the spec file**

This spec file does not currently mock the media query manager. Add the mock below the existing `vi.mock('$app/state', ...)` line. It must supply **both** getters — `global-search.svelte:310` reads `minLg` and the trigger reads it too, so omitting one breaks unrelated tests.

```ts
const { mediaState } = vi.hoisted(() => ({ mediaState: { pointerCoarse: false, minLg: false } }));

vi.mock('$lib/stores/media-query-manager.svelte', () => ({
  mediaQueryManager: {
    get pointerCoarse() {
      return mediaState.pointerCoarse;
    },
    get minLg() {
      return mediaState.minLg;
    },
  },
}));
```

Then reset it in the existing `beforeEach`, after `sessionStorage.clear();`:

```ts
mediaState.pointerCoarse = false;
mediaState.minLg = false;
```

- [ ] **Step 2: Run the suite to confirm the mock changed nothing**

Run: `pnpm exec vitest run src/lib/components/global-search/__tests__/global-search-input-trigger.spec.ts`

Expected: PASS, same count as after Task 1. The mock's defaults match the global `matchMedia` stub, so this step is a no-op by design. If anything fails, the mock is missing a getter the component reads.

- [ ] **Step 3: Write the failing tests**

Append inside the same `describe` block:

```ts
it('hides the keyboard hint when the pointer is coarse', () => {
  mediaState.pointerCoarse = true;

  render(GlobalSearchInputTrigger);

  expect(screen.queryByText(/^(⌘K|Ctrl\+K)$/)).not.toBeInTheDocument();
});

it('keeps the search field usable when the keyboard hint is hidden', () => {
  mediaState.pointerCoarse = true;

  render(GlobalSearchInputTrigger);

  const input = screen.getByRole('combobox', { name: 'cmdk_placeholder' });
  expect(input).toBeInTheDocument();
  expect(screen.getByTestId('cmdk-input-trigger')).toBeInTheDocument();
});

it('shows the keyboard hint when the pointer is not coarse', () => {
  mediaState.pointerCoarse = false;

  render(GlobalSearchInputTrigger);

  expect(screen.getByText(/^(⌘K|Ctrl\+K)$/)).toBeInTheDocument();
});
```

- [ ] **Step 4: Run the tests and confirm the first one fails**

Run: `pnpm exec vitest run src/lib/components/global-search/__tests__/global-search-input-trigger.spec.ts`

Expected: 1 failure — `hides the keyboard hint when the pointer is coarse`, because the chip renders unconditionally. The other two pass already.

- [ ] **Step 5: Wrap the chip**

In `global-search.svelte`, wrap the `<kbd>` block in the dropdown branch. Keep the class list byte-identical — only the `{#if}` wrapper and indentation change:

```svelte
        {#if !mediaQueryManager.pointerCoarse}
          <kbd
            class="hidden shrink-0 rounded-lg border border-gray-300 bg-white px-2 py-1 font-mono text-[11px] font-semibold tracking-wide text-gray-500 sm:inline-block dark:border-immich-dark-gray dark:bg-immich-dark-bg dark:text-gray-300"
          >
            {hotkeyLabel}
          </kbd>
        {/if}
```

`mediaQueryManager` is already imported at `:24` — do not add a second import.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `pnpm exec vitest run src/lib/components/global-search/__tests__/global-search-input-trigger.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/global-search/global-search.svelte src/lib/components/global-search/__tests__/global-search-input-trigger.spec.ts
git commit -m "fix(web): hide the Ctrl+K hint on touch devices (#862)"
```

**Note on scope:** per-platform label assertions (`⌘K` on Apple, `Ctrl+K` elsewhere) are deliberately not tested. `isApplePlatform` is a module-scope `const` at `global-search.svelte:44`, evaluated once at import, so stubbing `navigator.platform` in a test has no effect without `vi.resetModules()` plus a dynamic import. That behaviour predates this change and is untouched by it. The regex above accepts either label.

---

### Task 3: Create the `/` shortcut module

**Files:**

- Create: `web/src/lib/utils/search-shortcut.ts`
- Test: `web/src/lib/utils/search-shortcut.spec.ts`

**Interfaces:**

- Consumes: `matchesShortcut` and the `ShortcutOptions` type from `$lib/actions/shortcut`.
- Produces:
  - `isEditableTarget(element: Element | null): boolean`
  - `searchShortcuts(open: () => void): ShortcutOptions[]` — returns exactly two descriptors, `{ key: '/' }` and `{ key: '/', shift: true }`, in that order. Task 4 spreads the result into `use:shortcuts`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/utils/search-shortcut.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { matchesShortcut } from '$lib/actions/shortcut';
import { isEditableTarget, searchShortcuts } from './search-shortcut';

const keydown = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

const countMatches = (event: KeyboardEvent) =>
  searchShortcuts(() => {}).filter((option) => matchesShortcut(event, option.shortcut)).length;

const fire = (open: () => void, event: KeyboardEvent) => {
  for (const option of searchShortcuts(open)) {
    if (matchesShortcut(event, option.shortcut)) {
      option.onShortcut(event as KeyboardEvent & { currentTarget: HTMLElement });
    }
  }
};

const focusHtml = (html: string) => {
  document.body.innerHTML = html;
  const element = document.body.firstElementChild as HTMLElement;
  element.focus();
  return element;
};

describe('isEditableTarget', () => {
  it.each([
    ['a text input', '<input type="text" />'],
    ['a search input', '<input type="search" />'],
    ['a number input', '<input type="number" />'],
    ['a textarea', '<textarea></textarea>'],
    ['a select', '<select></select>'],
    ['a contenteditable element', '<div contenteditable="true"></div>'],
  ])('treats %s as editable', (_name, html) => {
    document.body.innerHTML = html;

    expect(isEditableTarget(document.body.firstElementChild)).toBe(true);
  });

  it('treats an element nested inside a contenteditable region as editable', () => {
    document.body.innerHTML = '<div contenteditable="true"><span id="inner">hi</span></div>';

    expect(isEditableTarget(document.querySelector('#inner'))).toBe(true);
  });

  it('does not treat an explicitly non-editable region as editable', () => {
    document.body.innerHTML = '<div contenteditable="false"></div>';

    expect(isEditableTarget(document.body.firstElementChild)).toBe(false);
  });

  it('does not treat an ordinary element as editable', () => {
    document.body.innerHTML = '<div></div>';

    expect(isEditableTarget(document.body.firstElementChild)).toBe(false);
  });

  it('returns false for null rather than throwing', () => {
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('searchShortcuts', () => {
  it('registers a bare slash and a shifted slash, in that order', () => {
    expect(searchShortcuts(() => {}).map((option) => option.shortcut)).toEqual([
      { key: '/' },
      { key: '/', shift: true },
    ]);
  });

  it('matches a bare slash exactly once', () => {
    expect(countMatches(keydown({ key: '/' }))).toBe(1);
  });

  it('matches a shifted slash exactly once, for layouts where slash needs shift', () => {
    expect(countMatches(keydown({ key: '/', shiftKey: true }))).toBe(1);
  });

  it('leaves question mark to the keyboard shortcuts modal', () => {
    expect(countMatches(keydown({ key: '?', shiftKey: true }))).toBe(0);
  });

  it('leaves ctrl+slash to the search mode cycle', () => {
    expect(countMatches(keydown({ key: '/', ctrlKey: true }))).toBe(0);
  });

  it('ignores slash with alt or meta held', () => {
    expect(countMatches(keydown({ key: '/', altKey: true }))).toBe(0);
    expect(countMatches(keydown({ key: '/', metaKey: true }))).toBe(0);
  });

  it('opens search when nothing is being edited', () => {
    document.body.innerHTML = '';
    const open = vi.fn();

    fire(open, keydown({ key: '/' }));

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('opens search from a shifted slash when nothing is being edited', () => {
    document.body.innerHTML = '';
    const open = vi.fn();

    fire(open, keydown({ key: '/', shiftKey: true }));

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('does not open search while typing in a search input', () => {
    const field = focusHtml('<input type="search" />');
    expect(document.activeElement).toBe(field);
    const open = vi.fn();

    fire(open, keydown({ key: '/' }));

    expect(open).not.toHaveBeenCalled();
  });

  it('does not open search while typing in a textarea', () => {
    const field = focusHtml('<textarea></textarea>');
    expect(document.activeElement).toBe(field);
    const open = vi.fn();

    fire(open, keydown({ key: '/' }));

    expect(open).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm exec vitest run src/lib/utils/search-shortcut.spec.ts`

Expected: FAIL — the whole suite errors with `Failed to resolve import "./search-shortcut"`.

- [ ] **Step 3: Write the module**

Create `web/src/lib/utils/search-shortcut.ts`:

```ts
import type { ShortcutOptions } from '$lib/actions/shortcut';

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** True when the element is, or sits inside, something the user can type into. */
export const isEditableTarget = (element: Element | null): boolean =>
  element !== null && element.closest(EDITABLE_SELECTOR) !== null;

/**
 * Descriptors binding `/` to the global search palette.
 *
 * Two of them, because `matchesShortcut` compares modifiers strictly
 * (`Boolean(shortcut.shift) === event.shiftKey`) and several common layouts
 * produce `/` with Shift held — QWERTZ and Spanish use Shift+7, AZERTY Shift+:.
 * A lone `{ key: '/' }` would be dead for all of them. There is no clash with
 * `?`, which arrives as `event.key === '?'` on US layouts.
 */
export const searchShortcuts = (open: () => void): ShortcutOptions[] => {
  const openUnlessEditing = () => {
    // `shouldIgnoreEvent` in @immich/ui only skips a fixed list of input types
    // (textarea, text, date, datetime-local, email, password), so `type="search"`
    // and `type="number"` fields would otherwise swallow a typed `/`.
    if (isEditableTarget(document.activeElement)) {
      return;
    }
    open();
  };

  return [
    { shortcut: { key: '/' }, onShortcut: openUnlessEditing },
    { shortcut: { key: '/', shift: true }, onShortcut: openUnlessEditing },
  ];
};
```

Write the null check as `element !== null && …`, not `element?.closest(…) !== null` — the optional-chaining form yields `undefined !== null`, which is `true`, so it would report `null` as editable and silently kill the shortcut. The `isEditableTarget(null)` test catches exactly that.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm exec vitest run src/lib/utils/search-shortcut.spec.ts`

Expected — confirmed by running it: **`Tests  20 passed (20)`**. (Twenty, not fourteen: the `it.each` block expands to six.) happy-dom applies focus correctly here, so the two `expect(document.activeElement).toBe(field)` sanity assertions pass as written.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/search-shortcut.ts src/lib/utils/search-shortcut.spec.ts
git commit -m "feat(web): add / shortcut descriptors for global search"
```

---

### Task 4: Wire `/` in, remove `/` → Explore, and document it

**Files:**

- Modify: `web/src/routes/+layout.svelte:4` (import) and `:279-307` (the `use:shortcuts` array, closing `]}` on 307)
- Modify: `web/src/lib/components/timeline/actions/TimelineKeyboardActions.svelte:2`, `:17`, `:119`
- Modify: `web/src/lib/components/shared-components/gallery-viewer/GalleryViewer.svelte:274`
- Modify: `web/src/lib/modals/ShortcutsModal.svelte:35`

**Interfaces:**

- Consumes: `searchShortcuts(open: () => void): ShortcutOptions[]` from Task 3.
- Produces: nothing.

This task has no unit test of its own. It is wiring plus two deletions; the logic it wires was fully covered in Task 3, and the verification is type-check, lint, and the full suite. Do not invent a `+layout.svelte` test — there is no spec file for it and no precedent in the codebase.

- [ ] **Step 1: Wire the shortcuts into the layout**

In `web/src/routes/+layout.svelte`, add the import next to the existing shortcut import at `:4`:

```ts
import { searchShortcuts } from '$lib/utils/search-shortcut';
```

Then add a single spread as the **last** element of the `use:shortcuts` array, after the `{ ctrl: true, key: '/' }` entry's closing `},`:

```svelte
    ...searchShortcuts(openModalSearch),
  ]}
```

`openModalSearch` is already defined at `:235` and carries the feature-flag guard and `toggle('modal')` semantics. Pass it by reference — do not wrap or reimplement it.

- [ ] **Step 2: Remove `/` → Explore from the gallery viewer**

In `web/src/lib/components/shared-components/gallery-viewer/GalleryViewer.svelte`, delete line 274 in full:

```svelte
        { shortcut: { key: '/' }, onShortcut: () => goto(Route.explore()) },
```

Leave the imports alone — `goto` and `Route` each have another use in this file.

- [ ] **Step 3: Remove `/` → Explore from the timeline**

In `web/src/lib/components/timeline/actions/TimelineKeyboardActions.svelte`, delete line 119 in full:

```svelte
      { shortcut: { key: '/' }, onShortcut: () => goto(Route.explore()) },
```

That was the only use of both imports in this file, so also delete line 2:

```ts
import { goto } from '$app/navigation';
```

and line 17:

```ts
import { Route } from '$lib/route';
```

Change nothing else in either file.

- [ ] **Step 4: Document the shortcut**

In `web/src/lib/modals/ShortcutsModal.svelte`, add a row directly after line 35:

```svelte
        { key: ['Ctrl', 'k'], action: $t('shortcut_open_global_search') },
        { key: ['/'], action: $t('shortcut_open_global_search') },
```

Reusing `shortcut_open_global_search` keeps the change to zero new i18n strings — the key already exists at `i18n/en.json:2608`. Listing the same action twice under different keys is intentional; they are aliases.

- [ ] **Step 5: Type-check and lint**

Run from the repo root:

```bash
make check-web
make lint-web
```

Expected: both clean. This is the step that catches the unused `goto` / `Route` imports if Step 3 was done partially.

- [ ] **Step 6: Run the full web suite**

Run from `web/`: `pnpm test`

Expected: **0 failures**, and a total at or above the 4001-passed baseline. No existing test asserts `/` → Explore, so the deletions should not move any count downward.

- [ ] **Step 7: Commit**

```bash
git add src/routes/+layout.svelte \
  src/lib/components/timeline/actions/TimelineKeyboardActions.svelte \
  src/lib/components/shared-components/gallery-viewer/GalleryViewer.svelte \
  src/lib/modals/ShortcutsModal.svelte
git commit -m "feat(web): open global search with /"
```

- [ ] **Step 8: Manual verification**

Start the dev stack (`make dev` from the repo root) and confirm by hand, since these paths have no automated coverage:

1. Press `/` on the timeline — the modal palette opens, and you do **not** land on Explore.
2. Open a photo in the asset viewer and press `/` — the palette opens over the viewer. This is the intended change from the old behaviour, where `/` was suppressed there.
3. Focus the space albums search field (`type="search"`) and type `/` — the character is inserted and the palette stays closed.
4. Press `?` — the keyboard shortcuts modal opens and lists `/` for Open global search.
5. In responsive device mode with touch emulation, tap the nav search bar — the modal palette opens and the `Ctrl+K` chip is absent.

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: decision 1 and 4 → Task 1; decision 5 and 7 → Task 2; decisions 2 and 3 plus both edge-case fixes (shift layouts, `type="search"`) → Tasks 3 and 4; the `openDropdown` invariant → Task 1; the ShortcutsModal entry and both upstream deletions → Task 4. Decision 6 (iPad modal keeps its current size) is a deliberate no-op and needs no task.

**Deviations from the spec, and why.**

1. The spec said to import `matchesShortcut` / `ShortcutOptions` from `@immich/ui`. The codebase actually routes these through the fork-local barrel `$lib/actions/shortcut`, which is what `TimelineKeyboardActions.svelte` uses. The plan follows the codebase.
2. The spec described the test environment as jsdom and proposed `vi.spyOn(mediaQueryManager, 'pointerCoarse', 'get')`. It is happy-dom, `matchMedia` is globally stubbed to `matches: false`, and the codebase's established pattern is a hoisted-state `vi.mock`. The plan uses that pattern.
3. The spec left the per-platform `⌘K` / `Ctrl+K` label rows as optional-if-brittle. The plan drops them, with the reason recorded in Task 2, and keeps a label-agnostic regex.

**Placeholder scan.** No TBDs, no "handle edge cases", no "similar to Task N". Every code step carries the literal code.

**Type consistency.** `isEditableTarget(element: Element | null): boolean` and `searchShortcuts(open: () => void): ShortcutOptions[]` are declared in Task 3's Interfaces block, defined in Task 3 Step 3, and consumed in Task 4 Step 1 under exactly those names. `openModalOnTouch` and `openDropdown` are local to `global-search.svelte` and referenced only within Task 1.
