import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { tick } from 'svelte';
import { getResizeObserverMock } from '$lib/__mocks__/resize-observer.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { compileUtilities } from '@test-data/tailwind';
import TagFilterRowNonDefaultProvider from '../tag-filter-row-non-default-provider.test-wrapper.svelte';
import TagFilterRowToggleChecked from '../tag-filter-row-toggle-checked.test-wrapper.svelte';
import TagFilterRow from '../tag-filter-row.svelte';

const LONG_NAME = 'Events/2024/Italy Summer Trip Rome Colosseum And Vatican Museums';

// The only two non-closed values bits-ui's tooltip state machine produces (tooltip.svelte.js:
// #stateAttr returns "delayed-open" or "instant-open" whenever the trigger is open). Asserting
// membership in this set is real coverage; `.not.toBe('closed')` would also pass if `data-state`
// were absent entirely (undefined !== 'closed'), which is why it is avoided below.
const OPEN_STATES = ['delayed-open', 'instant-open'];

/**
 * happy-dom reports 0 for both metrics, so overflow is simulated on the prototype — the action reads
 * them during mount, before a test could reach the individual element.
 *
 * Defining on HTMLElement.prototype only *shadows* happy-dom, which defines both as getters on
 * Element.prototype (verified in happy-dom's Element.d.ts). The afterEach delete therefore removes
 * only this shadow and restores happy-dom's own behaviour — it does not clobber it process-wide.
 *
 * The getters read through a mutable `heightMetrics` object rather than closing over the values
 * passed to stubHeights directly, so a test can change the reported heights mid-test (R17) without
 * re-running Object.defineProperties or losing the shadow already installed for the current test.
 */
const heightMetrics = { scrollHeight: 0, clientHeight: 0 };

function stubHeights(scrollHeight: number, clientHeight: number) {
  heightMetrics.scrollHeight = scrollHeight;
  heightMetrics.clientHeight = clientHeight;
  // One defineProperties call, not two defineProperty calls: eslint's
  // unicorn/prefer-object-define-properties is an ERROR here and CI runs bare `pnpm lint`.
  Object.defineProperties(HTMLElement.prototype, {
    scrollHeight: { configurable: true, get: () => heightMetrics.scrollHeight },
    clientHeight: { configurable: true, get: () => heightMetrics.clientHeight },
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

// Renders TagFilterRow under bits-ui's own Tooltip.Provider (default options — no
// disableCloseOnTriggerClick), instead of the app's @immich/ui TooltipProvider. Only R16 uses this;
// see tag-filter-row-non-default-provider.test-wrapper.svelte for why.
function renderNonDefaultProviderRow(props: Partial<RowProps> = {}) {
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
    ...render(TagFilterRowNonDefaultProvider as Component<RowProps>, { props: componentProps }),
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

// R7 ("opens the tooltip immediately on keyboard focus") was removed: @immich/ui's shared
// TooltipProvider sets `ignoreNonKeyboardFocus`, so bits-ui only opens on focus when
// `:focus-visible` matches. @testing-library/dom's fireEvent.focus only dispatches a synthetic
// FocusEvent — it never calls the native `.focus()` method, so document.activeElement is never
// updated and `:focus-visible` never matches under happy-dom. Confirmed with a real `.focus()`
// call in isolation (matches `:focus-visible`) vs. fireEvent.focus (does not) — this is not
// fixable from the component side. Moved to manual verification (Task 4).
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
    expect('tooltipTrigger' in getByTestId('tags-item-t1').dataset).toBe(true);
  });

  it('R5: attaches no tooltip when the label fits', async () => {
    stubHeights(40, 40);
    const { getByTestId } = renderRow();
    await tick();
    expect('tooltipTrigger' in getByTestId('tags-item-t1').dataset).toBe(false);
  });

  it('R6: opens the tooltip on non-touch hover after the 700ms delay', async () => {
    // Only timers — faking requestAnimationFrame too can stall bits-ui/floating-ui during mount.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      stubHeights(100, 40);
      const { getByTestId } = renderRow();
      await tick();
      const row = getByTestId('tags-item-t1');
      expect(row.dataset.state).toBe('closed');

      await fireEvent.pointerEnter(row, { pointerType: 'mouse' });
      vi.advanceTimersByTime(700);
      await tick();

      expect(OPEN_STATES).toContain(row.dataset.state);
    } finally {
      vi.useRealTimers();
    }
  });

  it('R8: toggles selection when a clipped row is clicked, and the tooltip stays open', async () => {
    // Only timers — faking requestAnimationFrame too can stall bits-ui/floating-ui during mount.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      stubHeights(100, 40);
      const { getByTestId, onToggle } = renderRow({ id: 't7' });
      await tick();
      const row = getByTestId('tags-item-t7');
      expect(row.dataset.state).toBe('closed');

      // Open via the hover path proven in R6 — focus-open cannot be exercised under happy-dom
      // (see the note above the describe block explaining R7's removal).
      await fireEvent.pointerEnter(row, { pointerType: 'mouse' });
      vi.advanceTimersByTime(700);
      await tick();
      expect(OPEN_STATES).toContain(row.dataset.state);

      await fireEvent.click(row);
      await tick();

      expect(onToggle).toHaveBeenCalledWith('t7');
      // @immich/ui's shared TooltipProvider sets disableCloseOnTriggerClick app-wide, so bits-ui's
      // own onclick handler (which would otherwise close the tooltip) is a no-op here — staying
      // open is correct, not a regression. This pins that selection still works on a tooltip-bearing
      // row under the REAL app provider. It does NOT by itself prove {...props}'s onclick is composed
      // rather than replaced — bits-ui's onclick is inert here either way, so this assertion would
      // pass identically even if handleClick dropped triggerProps.onclick entirely. See R16, which
      // uses a provider where that handler is live, for the test that can actually tell the two apart.
      expect(OPEN_STATES).toContain(row.dataset.state);
    } finally {
      vi.useRealTimers();
    }
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

  it('R12: attaches a tooltip whenever clampOverflow reports overflow, regardless of the name shape', async () => {
    // stubHeights(100, 40) forces the overflow verdict independent of the name it is given, so the
    // 'A'.repeat(120) unbreakable token here is inert as far as this assertion goes — this test would
    // pass unchanged even if the wrap utility were deleted from the component. It pins only that an
    // overflowing row always gets a tooltip. The actual "the wrap utility makes an unbreakable token
    // overflow vertically instead of clipping horizontally" claim cannot be proven under happy-dom
    // (no layout engine); it is proven only by the real-browser probe recorded in the design spec's
    // "Hazard: an unbreakable token defeats height-based detection" section. R14 below covers the
    // half of it that *is* automatable — that the label's utility compiles to a real `overflow-wrap`
    // declaration rather than silently to nothing.
    stubHeights(100, 40);
    const { getByTestId } = renderRow({ name: 'A'.repeat(120) });
    await tick();
    expect('tooltipTrigger' in getByTestId('tags-item-t1').dataset).toBe(true);
  });

  it('R13: renders the dimmed variant', () => {
    stubHeights(0, 0);
    const { getByTestId } = renderRow({ checked: true, dimmed: true });
    const row = getByTestId('tags-item-t1');
    expect(row.className).toContain('opacity-50');
    expect(row.className).toContain('font-medium');
  });

  it('R14: allows mid-word breaks on the label', async () => {
    // Asserts the *compiled* result, not the class string. A name-only assertion cannot fail for a
    // utility that does not exist (see compileUtilities above), which is how the label shipped with
    // no `overflow-wrap` declaration at all. The class list is read off the rendered label rather
    // than hard-coded, so this checks what the component actually emits.
    //
    // `overflow-wrap` (rather than the exact declaration) is the right assertion: both utilities
    // that would satisfy the requirement produce it — `wrap-break-word` emits
    // `overflow-wrap: break-word`, `wrap-anywhere` emits `overflow-wrap: anywhere` plus a
    // `break-word` fallback — and this pins the behaviour rather than one spelling of it. It also
    // genuinely fails when absent: none of the label's other utilities emit `overflow-wrap`
    // (verified against Tailwind 4.3.2 — `line-clamp-2` emits only `overflow`, `display`,
    // `-webkit-box-orient` and `-webkit-line-clamp`), and neither does Tailwind's base layer.
    stubHeights(0, 0);
    const { getByTestId } = renderRow();
    const label = getByTestId('tags-item-t1').querySelector('span');
    const classes = (label?.className ?? '').split(/\s+/).filter(Boolean);
    expect(classes.length).toBeGreaterThan(0);

    const css = await compileUtilities(classes);

    expect(css).toContain('overflow-wrap');
  });

  it('R15: shows the complete tag name in the open tooltip content', async () => {
    // Queries the portalled tooltip content directly instead of via aria-describedby. bits-ui does
    // portal the content and render the full name under happy-dom (confirmed with a full DOM dump
    // during investigation). bits-ui DOES generate a content id for this wiring — tooltip-content.svelte
    // sets `id = createId(uid)`, and the trigger reads `root?.contentNode?.id` for aria-describedby — so
    // this is not bits-ui failing to thread an id through. Here, though, the trigger's aria-describedby
    // stays an empty string regardless of extra tick()/microtask flushes. That is a happy-dom
    // limitation, most likely `contentNode` resolving to the popper wrapper element rather than the
    // inner content div that actually carries the id, not a gap in bits-ui's own behaviour.
    // [data-tooltip-content] is bits-ui's own stable marker for the content element (derived from its
    // "tooltip" component name), so this sidesteps the issue entirely.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      stubHeights(100, 40);
      const { getByTestId } = renderRow();
      await tick();
      const row = getByTestId('tags-item-t1');

      await fireEvent.pointerEnter(row, { pointerType: 'mouse' });
      vi.advanceTimersByTime(700);
      await tick();

      const content = document.querySelector('[data-tooltip-content]');
      expect(content?.textContent).toContain(LONG_NAME);
    } finally {
      vi.useRealTimers();
    }
  });

  it('R16: composes the trigger onclick under a provider where bits-ui actually closes on click', async () => {
    // Deliberately NOT the app's real @immich/ui TooltipProvider — it hard-codes
    // disableCloseOnTriggerClick, which makes bits-ui's own onclick handler a permanent no-op (see
    // R8's comment). Rendered here under bits-ui's own Tooltip.Provider with DEFAULT options instead
    // (see tag-filter-row-non-default-provider.test-wrapper.svelte), so bits-ui's onclick genuinely
    // calls handleClose. This is the one test in the suite that actually distinguishes
    // handleClick composing triggerProps.onclick from handleClick dropping it and replacing it —
    // under the real app's provider both variants are indistinguishable, since the dropped handler
    // was inert either way. If handleClick stops calling triggerProps.onclick, this test fails
    // because the tooltip never closes.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      stubHeights(100, 40);
      const { getByTestId, onToggle } = renderNonDefaultProviderRow({ id: 't16' });
      await tick();
      const row = getByTestId('tags-item-t16');
      expect(row.dataset.state).toBe('closed');

      await fireEvent.pointerEnter(row, { pointerType: 'mouse' });
      vi.advanceTimersByTime(700);
      await tick();
      expect(OPEN_STATES).toContain(row.dataset.state);

      await fireEvent.click(row);
      await tick();

      expect(onToggle).toHaveBeenCalledWith('t16');
      expect(row.dataset.state).toBe('closed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('R17: re-measures when `checked` flips, because selecting a row changes its font weight', async () => {
    // Selecting a row swaps its class from `text-gray-500 dark:text-gray-300` (font-weight 400) to
    // `font-medium` (500). That cascades into the label and can change how many lines the text wraps
    // to WITHOUT changing the label's border box (fixed width, height clamped to 2 lines) — so
    // ResizeObserver never fires — and if the action's `key` is just `name`, `update()` never runs
    // either, since `checked` isn't one of its dependencies. Measured in real Chrome at this row's
    // true geometry (200px wide, font-size 0.875rem, line-height 1.25rem, overflow-wrap: break-word):
    // "Events/2024/Italy Summer Trip Roma Vatican Museum Tour" is 2 lines at weight 400 and 3 lines at
    // weight 500 — an unselected borderline tag can correctly show no tooltip, then need one the
    // instant it is selected (and, symmetrically, deselecting can leave a stale tooltip).
    //
    // This is driven through TagFilterRowToggleChecked, not renderRow()/rerender(): rerender() would
    // replace TagFilterRow's whole props object as one shallow `$state.raw` box (see that wrapper's
    // own comment), over-invalidating every prop together and masking the exact per-prop dependency
    // gap this test exists to catch. The wrapper instead gives TagFilterRow a real, independently
    // reactive `checked` prop, flipped by a click the wrapper handles itself — the same shape of
    // update TagFilterRow gets from its real parent, tags-filter.svelte.
    stubHeights(40, 40); // fits at the unchecked (400) weight
    const onToggle = vi.fn();
    const { getByTestId } = render(TagFilterRowToggleChecked, {
      props: { id: 't17', name: LONG_NAME, initialChecked: false, onToggle },
    });
    await tick();
    expect('tooltipTrigger' in getByTestId('tags-item-t17').dataset).toBe(false);

    // Now overflows, standing in for the extra line the heavier weight would introduce.
    heightMetrics.scrollHeight = 60;
    await fireEvent.click(getByTestId('toggle-checked'));
    await tick();

    expect('tooltipTrigger' in getByTestId('tags-item-t17').dataset).toBe(true);
  });
});
