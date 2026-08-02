# Filter-panel full tag names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Long tag names in the Filter panel wrap to two lines instead of being cut off, and the rare name still clipped at two lines reveals itself through a tooltip on hover and keyboard focus.

**Architecture:** A reusable Svelte action (`clampOverflow`) measures whether a node's content exceeds its clamped box and reports the verdict via callback. A new row component (`TagFilterRow`) owns that verdict for one row and passes the tag name to `@immich/ui`'s `Tooltip` only when the row is actually clipped — the `Tooltip` renders its child bare when `text` is falsy, so a fitting row instantiates no tooltip at all. `tags-filter.svelte` then renders that row component for both its orphaned and normal lists, collapsing two near-identical blocks.

**Tech Stack:** Svelte 5 (runes), Tailwind CSS 4, `@immich/ui` (wrapping bits-ui), Vitest + `@testing-library/svelte` + happy-dom.

**Spec:** `docs/superpowers/specs/2026-07-30-filter-panel-tag-full-name-design.md`

## Global Constraints

- **Run all commands from the worktree root** `/Users/pierre/dev/gallery/.claude/worktrees/feat-filter-tag-full-name`, and prefix PATH with mise shims: `export PATH="$HOME/.local/share/mise/shims:$PATH"`.
- **Single-file test command is `pnpm test --run <path>` with NO `--`.** `pnpm test -- --run <path>` silently drops the path filter and runs the whole suite.
- **`data-testid="tags-item-{id}"` must remain on the element that receives the click.** `e2e/src/specs/web/album.e2e-spec.ts` and `e2e/src/specs/web/spaces-filter-panel.e2e-spec.ts` click that selector.
- **No new i18n strings.** The tooltip content is the tag name itself.
- **Scope is tags only.** Do not touch `people-filter.svelte`, `camera-filter.svelte`, or `location-filter.svelte`.
- **Tailwind class order is linted, not formatted.** This repo has no `prettier-plugin-tailwindcss`, so prettier leaves class order alone — but eslint's `better-tailwindcss/enforce-consistent-class-order` enforces it as a warning, and CI runs `pnpm lint --max-warnings 0`. Note it can only order classes it recognises: a misspelt utility is left wherever it sits, so a passing lint is **not** evidence that a class name is real (see the next two constraints).
- **`wrap-break-word` is load-bearing, not cosmetic.** Without it a single unbreakable token overflows horizontally rather than vertically, `scrollHeight === clientHeight`, and the tooltip silently never appears.
- **Mind the singular `word`.** Tailwind v4 renamed v3's `break-words` to `wrap-break-word`, and emits _nothing at all_ for a class name it does not recognise — no error, no warning. The first implementation of this plan shipped `wrap-break-words`, which generated no CSS, so the label never had `overflow-wrap` and pure-underscore tag names clipped horizontally (names containing a space or a hyphen still wrapped on those natural break opportunities, which is why the breakage looked patternless). R14 now compiles the label's classes through the real Tailwind and asserts an `overflow-wrap` declaration is actually produced.
- Server imports use the `src/` alias; **web** imports use `$lib/`. Follow the existing import style.

---

## File Structure

| File                                                                   | Status | Responsibility                                                            |
| ---------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| `web/src/lib/actions/clamp-overflow.ts`                                | Create | Measure vertical overflow of a node; report verdict changes via callback. |
| `web/src/lib/actions/__test__/clamp-overflow.spec.ts`                  | Create | Unit tests for the measurement logic (A1–A10).                            |
| `web/src/lib/components/filter-panel/tag-filter-row.svelte`            | Create | One filter row: checkbox, clamped label, conditional tooltip.             |
| `web/src/lib/components/filter-panel/__tests__/tag-filter-row.spec.ts` | Create | Component tests for the row (R1–R15).                                     |
| `web/src/lib/components/filter-panel/tags-filter.svelte`               | Modify | Render `TagFilterRow` for the orphaned and normal lists.                  |
| `web/src/lib/components/filter-panel/__tests__/tags-filter.spec.ts`    | Modify | Add integration scenarios T1–T5; keep the 18 existing tests green.        |

---

### Task 1: The `clampOverflow` action

**Files:**

- Create: `web/src/lib/actions/clamp-overflow.ts`
- Test: `web/src/lib/actions/__test__/clamp-overflow.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  ```ts
  export interface ClampOverflowParams {
    onChange: (isOverflowing: boolean) => void;
    key?: unknown;
  }
  export function clampOverflow(node: HTMLElement, params: ClampOverflowParams): ActionReturn<ClampOverflowParams>;
  ```
  Task 2 applies this with `use:clampOverflow={{ onChange, key }}`.

**Background the implementer needs:**

- A Svelte action is a plain function called with the DOM node once it is mounted. Returning `{ update, destroy }` lets Svelte notify it when its parameter object changes and when the node unmounts.
- happy-dom implements no layout: every element reports `scrollHeight === 0` and `clientHeight === 0`. Tests therefore define those properties explicitly.
- The repo's shared `getResizeObserverMock()` has a no-op `observe` and does **not** expose the callback. These tests need the callback, so they use a local capturing stub instead.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/actions/__test__/clamp-overflow.spec.ts`:

```ts
import { clampOverflow } from '$lib/actions/clamp-overflow';

/**
 * happy-dom has no layout engine, so heights are supplied by the test.
 *
 * They are driven through a mutable `metrics` object behind getters rather than assigned onto the
 * element: `scrollHeight` is `readonly` in lib.dom.d.ts and happy-dom exposes only a getter, so
 * `node.scrollHeight = 100` fails `pnpm check:typescript` even though it would work at runtime.
 */
function makeNode(scrollHeight: number, clientHeight: number) {
  const node = document.createElement('div');
  const metrics = { scrollHeight, clientHeight };
  // One defineProperties call, not two defineProperty calls: eslint's
  // unicorn/prefer-object-define-properties is an ERROR here and CI runs bare `pnpm lint`.
  Object.defineProperties(node, {
    scrollHeight: { configurable: true, get: () => metrics.scrollHeight },
    clientHeight: { configurable: true, get: () => metrics.clientHeight },
  });
  return { node, metrics };
}

let resizeCallback: (() => void) | undefined;
let observe: ReturnType<typeof vi.fn>;
let disconnect: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resizeCallback = undefined;
  observe = vi.fn();
  disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    vi.fn(function (callback: () => void) {
      resizeCallback = callback;
      return { observe, disconnect, unobserve: vi.fn() };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clampOverflow', () => {
  it('A1: reports overflow on mount', () => {
    const onChange = vi.fn();
    clampOverflow(makeNode(100, 40).node, { onChange });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('A2: reports fit on mount without deduping the first call away', () => {
    const onChange = vi.fn();
    clampOverflow(makeNode(40, 40).node, { onChange });
    expect(onChange).toHaveBeenCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('A3: measures before the observer is even wired up', () => {
    const onChange = vi.fn();
    clampOverflow(makeNode(100, 40).node, { onChange });
    // Ordering, not just occurrence: the mount verdict must not depend on the observer firing.
    expect(onChange.mock.invocationCallOrder[0]).toBeLessThan(observe.mock.invocationCallOrder[0]);
  });

  it('A4: treats content shorter than the box as a fit', () => {
    const onChange = vi.fn();
    clampOverflow(makeNode(39, 40).node, { onChange });
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('A5: observes the node it was applied to', () => {
    const { node } = makeNode(40, 40);
    clampOverflow(node, { onChange: vi.fn() });
    expect(observe).toHaveBeenCalledWith(node);
  });

  it('A6: re-measures when the observer fires', () => {
    const { node, metrics } = makeNode(40, 40);
    const onChange = vi.fn();
    clampOverflow(node, { onChange });
    onChange.mockClear();

    metrics.scrollHeight = 100;
    resizeCallback?.();

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('A7: suppresses unchanged verdicts', () => {
    const onChange = vi.fn();
    clampOverflow(makeNode(100, 40).node, { onChange });

    resizeCallback?.();
    resizeCallback?.();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('A8: re-measures on update, using the updated params', () => {
    const { node, metrics } = makeNode(40, 40);
    const onChange = vi.fn();
    const action = clampOverflow(node, { onChange, key: 'short' });
    onChange.mockClear();

    // A second mock proves update() adopts the new params rather than retaining the mount-time closure.
    const nextOnChange = vi.fn();
    metrics.scrollHeight = 100;
    action.update?.({ onChange: nextOnChange, key: 'a much longer name' });

    expect(nextOnChange).toHaveBeenCalledWith(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('A9: disconnects the observer on destroy', () => {
    const action = clampOverflow(makeNode(40, 40).node, { onChange: vi.fn() });
    action.destroy?.();
    expect(disconnect).toHaveBeenCalled();
  });

  it('A10: tolerates a missing ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const onChange = vi.fn();

    expect(() => clampOverflow(makeNode(100, 40).node, { onChange })).not.toThrow();
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cd web && pnpm test --run src/lib/actions/__test__/clamp-overflow.spec.ts
```

Expected: FAIL — every test errors resolving `$lib/actions/clamp-overflow` ("Failed to resolve import"). Confirm the failure is the missing module, not a typo in the spec.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/actions/clamp-overflow.ts`:

```ts
import type { ActionReturn } from 'svelte/action';

export interface ClampOverflowParams {
  /** Called on mount, then only when the overflow verdict changes. */
  onChange: (isOverflowing: boolean) => void;
  /** Re-measure when this changes (e.g. the label text). */
  key?: unknown;
}

/**
 * Reports whether a node's content overflows its box vertically — the standard way to detect that a
 * `line-clamp` has actually clipped something.
 *
 * Only meaningful when the node also allows mid-word breaks (`wrap-break-word`); without that, an
 * unbreakable token overflows horizontally instead and this reports a false "fits".
 */
export function clampOverflow(node: HTMLElement, params: ClampOverflowParams): ActionReturn<ClampOverflowParams> {
  let current = params;
  // Undefined rather than false: the mount-time verdict must always be reported, even when it is false.
  let previous: boolean | undefined;

  const measure = () => {
    const isOverflowing = node.scrollHeight > node.clientHeight;
    if (isOverflowing === previous) {
      return;
    }

    previous = isOverflowing;
    current.onChange(isOverflowing);
  };

  measure();

  // Guarded so a test missing the global stub fails on its assertion rather than on this constructor.
  const observer = globalThis.ResizeObserver ? new ResizeObserver(() => measure()) : undefined;
  observer?.observe(node);

  return {
    update(next: ClampOverflowParams) {
      current = next;
      measure();
    },
    destroy() {
      observer?.disconnect();
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cd web && pnpm test --run src/lib/actions/__test__/clamp-overflow.spec.ts
```

Expected: PASS — 10 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/actions/clamp-overflow.ts web/src/lib/actions/__test__/clamp-overflow.spec.ts
git commit -m "feat(web): add a clamp-overflow action for detecting clipped text"
```

---

### Task 2: The `TagFilterRow` component

**Files:**

- Create: `web/src/lib/components/filter-panel/tag-filter-row.svelte`
- Test: `web/src/lib/components/filter-panel/__tests__/tag-filter-row.spec.ts`

**Interfaces:**

- Consumes: `clampOverflow` and `ClampOverflowParams` from Task 1.
- Produces: a component with props `{ id: string; name: string; checked: boolean; dimmed?: boolean; onToggle: (id: string) => void }`. Task 3 renders it.

**Background the implementer needs:**

- `@immich/ui`'s `Tooltip` takes `text` plus a `child` snippet. When `text` is falsy it renders `{@render child({ props: {} })}` and never instantiates bits-ui — that is how "no tooltip when it fits" is expressed without conditional markup.
- The `props` handed to the snippet must be spread onto the interactive element. They include `id`, `aria-describedby`, `data-state`, `data-tooltip-trigger`, `tabindex`, and pointer/focus handlers — **and `onclick`**, which bits-ui uses to close the tooltip.
- Because `props` is typed `Record<string, unknown>`, `props.onclick` is `unknown` and must be cast before being called.
- The tooltip trigger carries `data-tooltip-trigger` and `data-state` (`"closed"`, `"delayed-open"`, or `"instant-open"`). These are the deterministic assertions for the tests; they do not depend on the portal or floating-ui rendering.
- Hover is delayed **700 ms** by default; focus opens immediately.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/components/filter-panel/__tests__/tag-filter-row.spec.ts`:

```ts
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { tick } from 'svelte';
import { getResizeObserverMock } from '$lib/__mocks__/resize-observer.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import TagFilterRow from '../tag-filter-row.svelte';

const LONG_NAME = 'Events/2024/Italy Summer Trip Rome Colosseum And Vatican Museums';

/**
 * happy-dom reports 0 for both metrics, so overflow is simulated on the prototype — the action reads
 * them during mount, before a test could reach the individual element.
 *
 * Defining on HTMLElement.prototype only *shadows* happy-dom, which defines both as getters on
 * Element.prototype (verified in happy-dom's Element.d.ts). The afterEach delete therefore removes
 * only this shadow and restores happy-dom's own behaviour — it does not clobber it process-wide.
 */
function stubHeights(scrollHeight: number, clientHeight: number) {
  // One defineProperties call, not two defineProperty calls: eslint's
  // unicorn/prefer-object-define-properties is an ERROR here and CI runs bare `pnpm lint`.
  Object.defineProperties(HTMLElement.prototype, {
    scrollHeight: { configurable: true, get: () => scrollHeight },
    clientHeight: { configurable: true, get: () => clientHeight },
  });
}

type RowProps = {
  id: string;
  name: string;
  checked: boolean;
  dimmed?: boolean;
  onToggle: (id: string) => void;
};

function renderRow(props: Partial<RowProps> = {}) {
  const onToggle = props.onToggle ?? vi.fn();
  const componentProps: RowProps = {
    id: props.id ?? 't1',
    name: props.name ?? LONG_NAME,
    checked: props.checked ?? false,
    dimmed: props.dimmed,
    onToggle,
  };
  return {
    onToggle,
    ...render(TestWrapper as Component<{ component: Component<RowProps>; componentProps: RowProps }>, {
      props: { component: TagFilterRow as Component<RowProps>, componentProps },
    }),
  };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', getResizeObserverMock());
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
  vi.unstubAllGlobals();
});

describe('TagFilterRow', () => {
  it('R1: renders the complete name in the DOM', () => {
    stubHeights(0, 0);
    const { getByTestId } = renderRow();
    expect(getByTestId('tags-item-t1').textContent).toContain(LONG_NAME);
  });

  it('R2: clamps the label rather than truncating it', () => {
    stubHeights(0, 0);
    const { getByTestId } = renderRow();
    const label = getByTestId('tags-item-t1').querySelector('span');
    expect(label?.className).toContain('line-clamp-2');
    expect(label?.className).not.toContain('truncate');
  });

  it('R3: keeps the e2e handle on the clickable element', async () => {
    stubHeights(0, 0);
    const { getByTestId, onToggle } = renderRow({ id: 't1' });
    await fireEvent.click(getByTestId('tags-item-t1'));
    expect(onToggle).toHaveBeenCalledWith('t1');
  });

  it('R4: attaches a tooltip when the label is clipped', async () => {
    stubHeights(100, 40);
    const { getByTestId } = renderRow();
    await tick();
    expect(getByTestId('tags-item-t1').hasAttribute('data-tooltip-trigger')).toBe(true);
  });

  it('R5: attaches no tooltip when the label fits', async () => {
    stubHeights(40, 40);
    const { getByTestId } = renderRow();
    await tick();
    expect(getByTestId('tags-item-t1').hasAttribute('data-tooltip-trigger')).toBe(false);
  });

  it('R6: opens the tooltip on non-touch hover after the 700ms delay', async () => {
    // Only timers — faking requestAnimationFrame too can stall bits-ui/floating-ui during mount.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      stubHeights(100, 40);
      const { getByTestId } = renderRow();
      await tick();
      const row = getByTestId('tags-item-t1');
      expect(row.getAttribute('data-state')).toBe('closed');

      await fireEvent.pointerEnter(row, { pointerType: 'mouse' });
      vi.advanceTimersByTime(700);
      await tick();

      expect(row.getAttribute('data-state')).not.toBe('closed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('R7: opens the tooltip immediately on keyboard focus', async () => {
    stubHeights(100, 40);
    const { getByTestId } = renderRow();
    await tick();
    const row = getByTestId('tags-item-t1');

    await fireEvent.focus(row);
    await tick();

    expect(row.getAttribute('data-state')).not.toBe('closed');
  });

  it('R8: toggles and closes the tooltip when a clipped row is clicked', async () => {
    stubHeights(100, 40);
    const { getByTestId, onToggle } = renderRow({ id: 't7' });
    await tick();
    const row = getByTestId('tags-item-t7');

    await fireEvent.focus(row);
    await tick();
    expect(row.getAttribute('data-state')).not.toBe('closed');

    await fireEvent.click(row);
    await tick();

    expect(onToggle).toHaveBeenCalledWith('t7');
    expect(row.getAttribute('data-state')).toBe('closed');
  });

  it('R9: toggles when the row has no tooltip at all', async () => {
    stubHeights(40, 40);
    const { getByTestId, onToggle } = renderRow({ id: 't9' });
    await tick();

    await fireEvent.click(getByTestId('tags-item-t9'));

    expect(onToggle).toHaveBeenCalledWith('t9');
  });

  it('R10: renders the checked state', () => {
    stubHeights(0, 0);
    const { getByTestId } = renderRow({ checked: true });
    const row = getByTestId('tags-item-t1');
    expect(row.getAttribute('aria-pressed')).toBe('true');
    expect(row.querySelector('svg')).toBeTruthy();
  });

  it('R11: renders the unchecked state', () => {
    stubHeights(0, 0);
    const { getByTestId } = renderRow({ checked: false });
    const row = getByTestId('tags-item-t1');
    expect(row.getAttribute('aria-pressed')).toBe('false');
    expect(row.querySelector('svg')).toBeNull();
  });

  it('R12: still reveals an unbreakable token that overflows two lines', async () => {
    stubHeights(100, 40);
    const { getByTestId } = renderRow({ name: 'A'.repeat(120) });
    await tick();
    expect(getByTestId('tags-item-t1').hasAttribute('data-tooltip-trigger')).toBe(true);
  });

  it('R13: renders the dimmed variant', () => {
    stubHeights(0, 0);
    const { getByTestId } = renderRow({ checked: true, dimmed: true });
    const row = getByTestId('tags-item-t1');
    expect(row.className).toContain('opacity-50');
    expect(row.className).toContain('font-medium');
  });

  it('R14: allows mid-word breaks on the label', async () => {
    stubHeights(0, 0);
    const { getByTestId } = renderRow();
    const label = getByTestId('tags-item-t1').querySelector('span');
    const classes = (label?.className ?? '').split(/\s+/).filter(Boolean);
    expect(classes.length).toBeGreaterThan(0);

    const css = await compileUtilities(classes);

    expect(css).toContain('overflow-wrap');
  });

  it('R15: describes the open tooltip with the full name', async () => {
    stubHeights(100, 40);
    const { getByTestId } = renderRow();
    await tick();
    const row = getByTestId('tags-item-t1');

    await fireEvent.focus(row);
    await tick();

    const describedBy = row.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toContain(LONG_NAME);
  });
});
```

**Known risk on R15 (and only R15):** it is the one assertion that depends on bits-ui's portal actually mounting content under happy-dom. If Step 2 shows R15 failing because `aria-describedby` is absent while R7 passes, that is an environment limitation rather than a product bug. In that case delete R15 and add "tooltip content shows the complete tag name" to the manual verification list in Task 4 — do **not** weaken it into an assertion that cannot fail. R6/R7 already prove the tooltip opens.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cd web && pnpm test --run src/lib/components/filter-panel/__tests__/tag-filter-row.spec.ts
```

Expected: FAIL — every test errors resolving `../tag-filter-row.svelte`. Confirm the failure is the missing component.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/components/filter-panel/tag-filter-row.svelte`:

```svelte
<script lang="ts">
  import { Tooltip } from '@immich/ui';
  import { clampOverflow } from '$lib/actions/clamp-overflow';

  interface Props {
    id: string;
    name: string;
    checked: boolean;
    /** Orphaned selections render faded — selected, but absent from the current suggestions. */
    dimmed?: boolean;
    onToggle: (id: string) => void;
  }

  let { id, name, checked, dimmed = false, onToggle }: Props = $props();

  let isOverflowing = $state(false);

  // The tooltip trigger supplies its own onclick (it closes the tooltip), so both handlers must run —
  // spreading ours over it would break the tooltip, spreading theirs over ours would break selection.
  function handleClick(triggerProps: Record<string, unknown>, event: MouseEvent) {
    (triggerProps.onclick as ((event: MouseEvent) => void) | undefined)?.(event);
    onToggle(id);
  }
</script>

<Tooltip text={isOverflowing ? name : undefined}>
  {#snippet child({ props })}
    <button
      {...props}
      type="button"
      class="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-subtle {checked
        ? 'font-medium'
        : 'text-gray-500 dark:text-gray-300'} {dimmed ? 'opacity-50' : ''}"
      onclick={(event) => handleClick(props, event)}
      aria-pressed={checked}
      data-testid="tags-item-{id}"
    >
      <div
        class="flex size-4 shrink-0 items-center justify-center rounded-sm {checked
          ? 'bg-immich-primary dark:bg-immich-dark-primary'
          : 'border border-gray-300 dark:border-gray-600'}"
      >
        {#if checked}
          <svg viewBox="0 0 24 24" class="size-3 text-white dark:text-black">
            <path fill="currentColor" d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z" />
          </svg>
        {/if}
      </div>

      <!-- wrap-break-word is required, not cosmetic: without it an unbreakable token overflows
           horizontally and clampOverflow reports a false "fits". -->
      <span
        class="wrap-break-word line-clamp-2 flex-1 text-left"
        use:clampOverflow={{ onChange: (overflowing) => (isOverflowing = overflowing), key: name }}
      >
        {name}
      </span>
    </button>
  {/snippet}
</Tooltip>
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cd web && pnpm test --run src/lib/components/filter-panel/__tests__/tag-filter-row.spec.ts
```

Expected: PASS — 15 passed (or 14 with R15 removed per the documented fallback above).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/filter-panel/tag-filter-row.svelte \
        web/src/lib/components/filter-panel/__tests__/tag-filter-row.spec.ts
git commit -m "feat(web): add a tag filter row that wraps long names and tooltips the rest"
```

---

### Task 3: Wire the row into `tags-filter.svelte`

**Files:**

- Modify: `web/src/lib/components/filter-panel/tags-filter.svelte:89-109` (orphaned list) and `:119-146` (normal list)
- Modify: `web/src/lib/components/filter-panel/__tests__/tags-filter.spec.ts`

**Interfaces:**

- Consumes: `TagFilterRow` from Task 2.
- Produces: no new exports. `tags-filter.svelte`'s own props are unchanged.

**Background the implementer needs:**

- The existing 18 tests in `tags-filter.spec.ts` are the regression suite for search, `Show N more`, orphaned rows, and empty states. They must keep passing untouched apart from the `ResizeObserver` stub.
- They render `TagsFilter` directly with no `TooltipProvider`, and that stays correct: nothing overflows under happy-dom, so `Tooltip.Root` is never instantiated and no provider context is needed.
- `toggleTag(id: string)` already exists at `tags-filter.svelte:57` and matches `onToggle` exactly.

- [ ] **Step 1: Write the failing tests**

Add to the top of `web/src/lib/components/filter-panel/__tests__/tags-filter.spec.ts`, alongside the existing imports:

```ts
import { getResizeObserverMock } from '$lib/__mocks__/resize-observer.mock';
```

Add this stub next to the existing `beforeAll`:

```ts
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', getResizeObserverMock());
});

afterEach(() => {
  vi.unstubAllGlobals();
});
```

Append these scenarios inside the existing `describe('TagsFilter', …)` block:

```ts
it('T1: clamps normal rows instead of truncating them', () => {
  const tags = [{ id: 't1', name: 'Events/2024/Italy Summer Trip Rome' }];
  const { getByTestId } = render(TagsFilter, {
    props: { tags, selectedIds: [], onSelectionChange: () => {} },
  });

  const label = getByTestId('tags-item-t1').querySelector('span');
  expect(label?.className).toContain('line-clamp-2');
  expect(label?.className).not.toContain('truncate');
});

it('T2: clamps orphaned rows too', () => {
  const { getByTestId } = render(TagsFilter, {
    props: {
      tags: [{ id: 't1', name: 'Kept' }],
      selectedIds: ['gone'],
      selectedNames: new Map([['gone', 'Events/2024/Removed But Still Selected']]),
      onSelectionChange: () => {},
    },
  });

  const label = getByTestId('tags-item-gone').querySelector('span');
  expect(label?.className).toContain('line-clamp-2');
});

it('T3: keeps orphaned-row styling on the row element', () => {
  const { getByTestId } = render(TagsFilter, {
    props: {
      tags: [{ id: 't1', name: 'Kept' }],
      selectedIds: ['gone'],
      selectedNames: new Map([['gone', 'Removed']]),
      onSelectionChange: () => {},
    },
  });

  const row = getByTestId('tags-item-gone');
  expect(row.className).toContain('opacity-50');
  expect(row.className).toContain('font-medium');
  expect(row.getAttribute('aria-pressed')).toBe('true');
});

it('T4: still reports selection through the row component', async () => {
  const onSelectionChange = vi.fn();
  const { getByTestId } = render(TagsFilter, {
    props: { tags: [{ id: 't1', name: 'Vacation' }], selectedIds: [], onSelectionChange },
  });

  await fireEvent.click(getByTestId('tags-item-t1'));

  expect(onSelectionChange).toHaveBeenCalledWith(['t1']);
});

it('T5: still filters by search, with clamped rows', async () => {
  const tags = [
    { id: 't1', name: 'Vacation' },
    { id: 't2', name: 'Family' },
  ];
  const { getByTestId, queryByTestId } = render(TagsFilter, {
    props: { tags, selectedIds: [], onSelectionChange: () => {} },
  });

  await fireEvent.input(getByTestId('tags-search-input'), { target: { value: 'vac' } });

  expect(queryByTestId('tags-item-t2')).toBeNull();
  expect(getByTestId('tags-item-t1').querySelector('span')?.className).toContain('line-clamp-2');
});
```

- [ ] **Step 2: Run the tests to verify T1–T5 fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cd web && pnpm test --run src/lib/components/filter-panel/__tests__/tags-filter.spec.ts
```

Expected: 18 passed, 5 failed. T1, T2 and T5 fail on `line-clamp-2` not being found (the label still says `truncate`); T3 fails because `font-medium` currently sits on the label, not the row. T4 may already pass — that is fine, it is a regression guard for the refactor in Step 3.

- [ ] **Step 3: Write the implementation**

In `web/src/lib/components/filter-panel/tags-filter.svelte`, add the import beneath the existing `TagOption` import:

```ts
import TagFilterRow from './tag-filter-row.svelte';
```

Replace the whole orphaned-tags block (currently the `{#each orphanedTags …}` loop and its `<button>`) with:

```svelte
<!-- Orphaned tags (selected but no longer in suggestions) -->
{#each orphanedTags as tag (tag.id)}
  <TagFilterRow id={tag.id} name={tag.name} checked dimmed onToggle={toggleTag} />
{/each}
```

Replace the whole normal tags block (currently the `{#each visibleTags …}` loop, its `{@const isActive …}` and its `<button>`) with:

```svelte
<!-- Tags list -->
{#each visibleTags as tag (tag.id)}
  <TagFilterRow id={tag.id} name={tag.name} checked={selectedIds.includes(tag.id)} onToggle={toggleTag} />
{/each}
```

Leave the search input, the empty-search-results paragraph, and the "Show more" button untouched.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cd web && pnpm test --run src/lib/components/filter-panel/__tests__/tags-filter.spec.ts
```

Expected: PASS — 23 passed (18 existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/filter-panel/tags-filter.svelte \
        web/src/lib/components/filter-panel/__tests__/tags-filter.spec.ts
git commit -m "feat(web): wrap long tag names in the filter panel (#881)"
```

---

### Task 4: Full verification gate

**Files:** none created or modified unless a check fails.

**Interfaces:**

- Consumes: everything from Tasks 1–3.
- Produces: evidence that the change is complete.

- [ ] **Step 1: Run the whole filter-panel and actions suites**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cd web && pnpm test --run src/lib/components/filter-panel src/lib/actions
```

Expected: PASS, with no test from the 18 sibling filter-panel spec files regressing.

- [ ] **Step 2: Run the full web unit suite**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cd web && pnpm test --run
```

Expected: PASS. If something unrelated is already red on `origin/main`, confirm that by stashing the change — do not assume.

- [ ] **Step 3: Type-check and lint**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm format
```

Expected: all clean. Two notes: `check:svelte` has been observed scanning 0 files locally while still gating in CI, so a suspiciously instant pass there is not proof; and `pnpm format` is `--check` only — use `pnpm format:fix` to repair.

- [ ] **Step 4: Manual browser verification**

`scrollHeight > clientHeight` against `-webkit-line-clamp` cannot be proven under happy-dom, which has no layout engine. Start the dev stack, open a Filter panel with a deep tag hierarchy, and confirm each of these. Record the actual result — do not assume a pass:

1. A tag path long enough to exceed two lines shows a tooltip on hover.
2. The same row shows the tooltip when reached by keyboard `Tab`.
3. A short tag shows **no** tooltip on hover.
4. A tag wrapping to exactly two lines shows **no** tooltip.
5. Clicking a tag that has a tooltip still toggles the filter, and the tooltip closes.
6. Narrowing the browser window flips a previously-fitting row into showing a tooltip.
7. Orphaned (faded) selected rows wrap and behave identically.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(web): address verification findings for filter-panel tag names (#881)"
```

Skip this step if Steps 1–4 needed no changes.

---

## Self-Review

**Spec coverage:**

| Spec item                                | Task                            |
| ---------------------------------------- | ------------------------------- |
| `clampOverflow` action contract + A1–A10 | Task 1                          |
| `TagFilterRow` + R1–R15                  | Task 2                          |
| Composed `onclick` hazard                | Task 2 (R8, R9)                 |
| `wrap-break-word` hazard                 | Task 2 (R12, R14)               |
| Class unification onto the row element   | Task 2 (R13), Task 3 (T3)       |
| `tags-filter.svelte` wiring + T1–T5      | Task 3                          |
| 18 existing tests stay green             | Task 3 (Step 4)                 |
| e2e `data-testid` preserved              | Task 2 (R3), Global Constraints |
| Manual browser verification              | Task 4 (Step 4)                 |
| No new i18n strings                      | Global Constraints              |
| Tags-only scope                          | Global Constraints              |

**Placeholder scan:** none — every step carries runnable commands or complete code.

**Type consistency:** `ClampOverflowParams` / `clampOverflow` in Task 1 match the `use:clampOverflow={{ onChange, key }}` call in Task 2. `onToggle: (id: string) => void` in Task 2 matches `toggleTag(id: string)` at `tags-filter.svelte:57` used in Task 3. Prop names `{ id, name, checked, dimmed, onToggle }` are identical across Tasks 2 and 3.
