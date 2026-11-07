import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { FACE_ACTIONS } from './face-actions';
import Harness from './face-review-dock.test-wrapper.svelte';

// Rendered against the REAL en.json (the convention every face-cleanup COMPONENT spec uses, as opposed to the
// key-echoing mock the PAGE specs use), so a missing or renamed key fails here instead of silently rendering
// the key. The wrapper supplies the `summary` and `apply` snippets, which cannot be passed from a plain object.

beforeAll(async () => {
  register('en', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en', initialLocale: 'en' });
  await waitLocale('en');
});

const GUIDED_ACTIONS = [
  { id: 'owner', testId: 'bulk-owner' },
  { id: 'stay', testId: 'bulk-stay' },
  { id: 'lock', testId: 'bulk-lock' },
  { id: 'other', testId: 'bulk-other' },
  { id: 'unknown', testId: 'bulk-unknown' },
  { id: 'detach', testId: 'bulk-detach' },
] as const;

const renderDock = (over: Record<string, unknown> = {}) =>
  render(Harness, {
    props: {
      mode: 'guided',
      selectedCount: 2,
      actions: [...GUIDED_ACTIONS],
      onAction: vi.fn(),
      onHelp: vi.fn(),
      onClear: vi.fn(),
      ...over,
    },
  });

// The dock listens for mouseenter/mouseleave and focusin/focusout on each action. Dispatching them directly
// keeps each case to exactly the events it names (a real pointer move would also fire a leave on whatever
// element the cursor was over before).
const dispatch = (testId: string, event: Event) => page.getByTestId(testId).element().dispatchEvent(event);
const mouseEnter = (testId: string) => dispatch(testId, new MouseEvent('mouseenter'));
const mouseLeave = (testId: string) => dispatch(testId, new MouseEvent('mouseleave'));
// eslint-disable-next-line unicorn/no-unnecessary-parameters
const focusIn = (testId: string) => dispatch(testId, new FocusEvent('focusin', { bubbles: true }));
const focusOut = (testId: string) => dispatch(testId, new FocusEvent('focusout', { bubbles: true }));
// The unit tier loads no stylesheet, so the hover popover renders in normal flow and shifts the buttons
// under a real pointer. These cases are about click routing, so click the element directly.
const click = (testId: string) => (page.getByTestId(testId).element() as HTMLElement).click();

describe('FaceReviewDock — summary and actions', () => {
  // D1
  it('shows the page-supplied summary and apply content while nothing is selected', async () => {
    await renderDock({ selectedCount: 0 });

    await expect.element(page.getByTestId('harness-summary')).toBeInTheDocument();
    await expect.element(page.getByTestId('harness-apply')).toBeInTheDocument();
    await expect.element(page.getByTestId('face-bulk-bar')).not.toBeInTheDocument();
  });

  // D2
  it('swaps to the action bar once a face is selected', async () => {
    await renderDock({ selectedCount: 1 });

    await expect.element(page.getByTestId('face-bulk-bar')).toBeInTheDocument();
    await expect.element(page.getByTestId('harness-summary')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('harness-apply')).not.toBeInTheDocument();
  });

  // D3
  it('reports how many faces the actions will apply to', async () => {
    await renderDock({ selectedCount: 7 });

    await expect.element(page.getByTestId('face-bulk-bar')).toMatchTextContent('7 selected');
  });

  // D4
  it('renders one button per action, in the order given, under its own testid', async () => {
    await renderDock();

    for (const action of GUIDED_ACTIONS) {
      await expect.element(page.getByTestId(action.testId)).toBeInTheDocument();
    }
    const rendered = page
      .getByRole('button')
      .elements()
      .map((button) => button.dataset.testid);
    expect(rendered.filter((id) => id?.startsWith('bulk-'))).toEqual(GUIDED_ACTIONS.map((action) => action.testId));
  });

  // D5
  it('labels each button with the harmonised action name', async () => {
    await renderDock();

    await expect.element(page.getByTestId('bulk-owner')).toMatchTextContent('Move to owner');
    await expect.element(page.getByTestId('bulk-stay')).toMatchTextContent('Keep here');
    await expect.element(page.getByTestId('bulk-lock')).toMatchTextContent('Confirm & lock');
    await expect.element(page.getByTestId('bulk-other')).toMatchTextContent('Move to person...');
    await expect.element(page.getByTestId('bulk-unknown')).toMatchTextContent('Unknown person');
    await expect.element(page.getByTestId('bulk-detach')).toMatchTextContent('Not a face');
  });

  // D6
  it('routes a click to exactly one action', async () => {
    const onAction = vi.fn();
    await renderDock({ onAction });

    click('bulk-lock');

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('lock');
  });

  // D7 — the destructive button's distinctness as an assertable attribute, not a class-list match.
  it('marks only the irreversible action as dangerous', async () => {
    await renderDock();

    await expect.element(page.getByTestId('bulk-detach')).toHaveAttribute('data-tone', 'danger');
    await expect.element(page.getByTestId('bulk-lock')).toHaveAttribute('data-tone', 'default');
  });

  // D8
  it('routes clear and help to their own handlers', async () => {
    const onClear = vi.fn();
    const onHelp = vi.fn();
    await renderDock({ onClear, onHelp });

    click('face-bulk-clear');
    click('face-bulk-help');

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onHelp).toHaveBeenCalledTimes(1);
  });

  // D9 — the manual-mode gap being closed: help is never conditional on which subset was passed.
  it('offers clear and help whatever subset of actions it was given', async () => {
    await renderDock({ actions: [{ id: 'unmark', testId: 'manual-review-bulk-unmark' }] });

    await expect.element(page.getByTestId('face-bulk-clear')).toBeInTheDocument();
    await expect.element(page.getByTestId('face-bulk-help')).toBeInTheDocument();
  });

  // D10 — F2's regression guard. Icon identity is observable here because this spec does not stub Icon.
  it('gives every action button its glyph, including unmark, which has no tile colour', async () => {
    await renderDock({ actions: [{ id: 'unmark', testId: 'manual-review-bulk-unmark' }] });

    const path = page.getByTestId('manual-review-bulk-unmark').element().querySelector('path');
    await expect.element(path).toHaveAttribute('d', FACE_ACTIONS.unmark.buttonIcon);
  });
});

describe('FaceReviewDock — hover, focus and the swap', () => {
  // D11
  it('given nothing hovered, shows the neutral hint and no popover', async () => {
    await renderDock();

    await expect
      .element(page.getByTestId('face-bulk-hint'))
      .toMatchTextContent('Nothing is written until you press Apply.');
    await expect.element(page.getByTestId('face-bulk-popover')).not.toBeInTheDocument();
  });

  // D12 + D13
  it('given the pointer enters an action, shows its tip in a popover and its effect in the hint row', async () => {
    await renderDock();

    mouseEnter('bulk-lock');

    await expect
      .element(page.getByTestId('face-bulk-popover'))
      .toMatchTextContent('Pin these here permanently, so no future scan can flag them.');
    await expect.element(page.getByTestId('face-bulk-hint')).toMatchTextContent('Confirm & lock');
    await expect.element(page.getByTestId('face-bulk-hint')).toMatchTextContent('the face is pinned to this person');
  });

  // D13 (mode arm) — guided resolves the scan-referencing effect copy.
  it('given guided mode, the hint row for a chosen-person move warns about the next scan', async () => {
    await renderDock({ mode: 'guided' });

    mouseEnter('bulk-other');

    await expect
      .element(page.getByTestId('face-bulk-hint'))
      .toMatchTextContent('the next scan can flag the face again');
  });

  // D13 (mode arm) — manual resolves the scan-free copy for the SAME action id.
  it('given manual mode, the same action’s hint row never mentions a scan', async () => {
    await renderDock({ mode: 'manual', actions: [{ id: 'other', testId: 'manual-review-bulk-move' }] });

    mouseEnter('manual-review-bulk-move');

    const hint = page.getByTestId('face-bulk-hint');
    await expect.element(hint).toMatchTextContent('so recognition never routes the face back here later');
    await expect.element(hint).not.toMatchTextContent('the next scan can flag the face again');
  });

  // D14
  it('given the pointer leaves, restores the neutral hint and removes the popover', async () => {
    await renderDock();

    mouseEnter('bulk-lock');
    mouseLeave('bulk-lock');

    await expect.element(page.getByTestId('face-bulk-popover')).not.toBeInTheDocument();
    await expect
      .element(page.getByTestId('face-bulk-hint'))
      .toMatchTextContent('Nothing is written until you press Apply.');
  });

  // D15 — keyboard parity.
  it('given a keyboard user focuses an action, shows the same popover and hint as hovering', async () => {
    await renderDock();

    focusIn('bulk-detach');

    await expect.element(page.getByTestId('face-bulk-popover')).toMatchTextContent('Irreversible');
    await expect.element(page.getByTestId('face-bulk-hint')).toMatchTextContent('Not a face');
  });

  // D16
  it('given focus leaves the action, restores the neutral hint', async () => {
    await renderDock();

    focusIn('bulk-detach');
    focusOut('bulk-detach');

    await expect.element(page.getByTestId('face-bulk-popover')).not.toBeInTheDocument();
    await expect
      .element(page.getByTestId('face-bulk-hint'))
      .toMatchTextContent('Nothing is written until you press Apply.');
  });

  // D17 — sliding along the bar with no intervening leave.
  it('given the pointer moves straight from one action to another, describes the second', async () => {
    await renderDock();

    mouseEnter('bulk-lock');
    mouseEnter('bulk-unknown');

    await expect.element(page.getByTestId('face-bulk-popover')).toMatchTextContent('Real faces, but not this person');
    await expect.element(page.getByTestId('face-bulk-hint')).toMatchTextContent('Unknown person');
    await expect.element(page.getByTestId('face-bulk-hint')).not.toMatchTextContent('pinned to this person');
  });

  // D18
  it('given an action is hovered, exactly one popover exists', async () => {
    await renderDock();

    mouseEnter('bulk-lock');

    await expect.poll(() => page.getByTestId('face-bulk-popover').elements()).toHaveLength(1);
  });

  // D19 — one announcement, and focus reaches the effect text.
  it('given an action is hovered, the popover is hidden from screen readers and the button describes itself', async () => {
    await renderDock();

    mouseEnter('bulk-lock');

    await expect.element(page.getByTestId('face-bulk-popover')).toHaveAttribute('aria-hidden', 'true');
    const describedBy = page.getByTestId('bulk-lock').element().getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.querySelector(`#${describedBy}`)).toBe(page.getByTestId('face-bulk-hint').element());
  });

  // D20
  it('given the pointer enters clear or help, leaves the hint row alone', async () => {
    await renderDock();

    mouseEnter('face-bulk-clear');
    await expect
      .element(page.getByTestId('face-bulk-hint'))
      .toMatchTextContent('Nothing is written until you press Apply.');

    mouseEnter('face-bulk-help');
    await expect
      .element(page.getByTestId('face-bulk-hint'))
      .toMatchTextContent('Nothing is written until you press Apply.');
  });

  // D21 + D22 — applying an action clears the selection, so the bar unmounts while still hovered.
  it('given the selection is emptied while an action is hovered, the next selection opens with no stale effect', async () => {
    const { rerender } = await renderDock({ selectedCount: 2 });

    mouseEnter('bulk-lock');
    await rerender({ selectedCount: 0 });

    await expect.element(page.getByTestId('harness-summary')).toBeInTheDocument();

    await rerender({ selectedCount: 3 });

    await expect
      .element(page.getByTestId('face-bulk-hint'))
      .toMatchTextContent('Nothing is written until you press Apply.');
    await expect.element(page.getByTestId('face-bulk-popover')).not.toBeInTheDocument();
  });

  // D23 — growing the selection must not clear a live hover.
  it('given the selection grows while an action is hovered, keeps describing that action', async () => {
    const { rerender } = await renderDock({ selectedCount: 2 });

    mouseEnter('bulk-lock');
    await rerender({ selectedCount: 5 });

    await expect.element(page.getByTestId('face-bulk-hint')).toMatchTextContent('Confirm & lock');
  });
});

describe('FaceReviewDock — edge cases', () => {
  // D24
  it('renders the bar shell with no actions at all', async () => {
    await renderDock({ actions: [] });

    await expect.element(page.getByTestId('face-bulk-bar')).toMatchTextContent('2 selected');
    await expect.element(page.getByTestId('face-bulk-clear')).toBeInTheDocument();
    await expect.element(page.getByTestId('face-bulk-help')).toBeInTheDocument();
    await expect.element(page.getByTestId('face-bulk-hint')).toBeInTheDocument();
  });

  // D25
  it('renders a single action', async () => {
    await renderDock({ actions: [{ id: 'detach', testId: 'bulk-detach' }] });

    await expect.element(page.getByTestId('bulk-detach')).toBeInTheDocument();
  });

  // D26
  it('renders a selection of one as readily as many', async () => {
    await renderDock({ selectedCount: 1 });

    await expect.element(page.getByTestId('face-bulk-bar')).toMatchTextContent('1 selected');
  });

  // D27 — the other half of the F2 split: no swatch must not suppress the glyph.
  it('renders the glyph of an action that has no tile colour', async () => {
    await renderDock({ actions: [{ id: 'unmark', testId: 'manual-review-bulk-unmark' }] });

    expect(FACE_ACTIONS.unmark.swatchColor).toBeUndefined();
    const button = await page.getByTestId('manual-review-bulk-unmark').findElement();
    const path = button.querySelector('path');
    await expect.element(page.elementLocator(path!)).toHaveAttribute('d', FACE_ACTIONS.unmark.buttonIcon);
  });

  // D28 — no module-level state leaks between instances (the suite sets no clearMocks). Every testid in the
  // second dock is distinct, INCLUDING `dock`: two elements sharing one testid would make a later
  // `getByTestId('face-dock')` throw "found multiple elements" from an unrelated test.
  it('keeps two docks independent', async () => {
    await renderDock({ actions: [{ id: 'lock', testId: 'bulk-lock' }] });
    await renderDock({ mode: 'manual', actions: [{ id: 'unmark', testId: 'manual-review-bulk-unmark' }] });

    // Both docks render the same normalised chrome testids, so index the pair rather than aliasing them.
    const hints = page.getByTestId('face-bulk-hint');
    await expect.poll(() => hints.elements()).toHaveLength(2);

    mouseEnter('bulk-lock');

    // The first dock describes what was hovered; the second is untouched by it — no module-level state leak.
    await expect.element(hints.nth(0)).toMatchTextContent('Confirm & lock');
    await expect.element(hints.nth(1)).toMatchTextContent('Nothing is written until you press Apply.');
  });
});
