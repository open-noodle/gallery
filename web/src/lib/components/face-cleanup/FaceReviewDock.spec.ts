import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FACE_ACTIONS } from './face-actions';
import Harness from './face-review-dock.test-wrapper.svelte';

// Rendered against the REAL en.json (the convention every face-cleanup COMPONENT spec uses, as opposed to the
// key-echoing mock the PAGE specs use), so a missing or renamed key fails here instead of silently rendering
// the key. The wrapper supplies the `summary` and `apply` snippets, which cannot be passed from a plain object.

beforeAll(async () => {
  register('en', () => import('$i18n/en.json'));
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

describe('FaceReviewDock — summary and actions', () => {
  // D1
  it('shows the page-supplied summary and apply content while nothing is selected', () => {
    renderDock({ selectedCount: 0 });

    expect(screen.getByTestId('harness-summary')).toBeInTheDocument();
    expect(screen.getByTestId('harness-apply')).toBeInTheDocument();
    expect(screen.queryByTestId('face-bulk-bar')).not.toBeInTheDocument();
  });

  // D2
  it('swaps to the action bar once a face is selected', () => {
    renderDock({ selectedCount: 1 });

    expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('harness-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('harness-apply')).not.toBeInTheDocument();
  });

  // D3
  it('reports how many faces the actions will apply to', () => {
    renderDock({ selectedCount: 7 });

    expect(screen.getByTestId('face-bulk-bar')).toHaveTextContent('7 selected');
  });

  // D4
  it('renders one button per action, in the order given, under its own testid', () => {
    renderDock();

    for (const action of GUIDED_ACTIONS) {
      expect(screen.getByTestId(action.testId)).toBeInTheDocument();
    }
    const rendered = screen.getAllByRole('button').map((button) => button.dataset.testid);
    expect(rendered.filter((id) => id?.startsWith('bulk-'))).toEqual(GUIDED_ACTIONS.map((action) => action.testId));
  });

  // D5
  it('labels each button with the harmonised action name', () => {
    renderDock();

    expect(screen.getByTestId('bulk-owner')).toHaveTextContent('Move to owner');
    expect(screen.getByTestId('bulk-stay')).toHaveTextContent('Keep here');
    expect(screen.getByTestId('bulk-lock')).toHaveTextContent('Confirm & lock');
    expect(screen.getByTestId('bulk-other')).toHaveTextContent('Move to person…');
    expect(screen.getByTestId('bulk-unknown')).toHaveTextContent('Unknown person');
    expect(screen.getByTestId('bulk-detach')).toHaveTextContent('Not a face');
  });

  // D6
  it('routes a click to exactly one action', async () => {
    const onAction = vi.fn();
    renderDock({ onAction });

    await fireEvent.click(screen.getByTestId('bulk-lock'));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('lock');
  });

  // D7 — the destructive button's distinctness as an assertable attribute, not a class-list match.
  it('marks only the irreversible action as dangerous', () => {
    renderDock();

    expect(screen.getByTestId('bulk-detach')).toHaveAttribute('data-tone', 'danger');
    expect(screen.getByTestId('bulk-lock')).toHaveAttribute('data-tone', 'default');
  });

  // D8
  it('routes clear and help to their own handlers', async () => {
    const onClear = vi.fn();
    const onHelp = vi.fn();
    renderDock({ onClear, onHelp });

    await fireEvent.click(screen.getByTestId('face-bulk-clear'));
    await fireEvent.click(screen.getByTestId('face-bulk-help'));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onHelp).toHaveBeenCalledTimes(1);
  });

  // D9 — the manual-mode gap being closed: help is never conditional on which subset was passed.
  it('offers clear and help whatever subset of actions it was given', () => {
    renderDock({ actions: [{ id: 'unmark', testId: 'manual-review-bulk-unmark' }] });

    expect(screen.getByTestId('face-bulk-clear')).toBeInTheDocument();
    expect(screen.getByTestId('face-bulk-help')).toBeInTheDocument();
  });

  // D10 — F2's regression guard. Icon identity is observable here because this spec does not stub Icon.
  it('gives every action button its glyph, including unmark, which has no tile colour', () => {
    renderDock({ actions: [{ id: 'unmark', testId: 'manual-review-bulk-unmark' }] });

    const path = screen.getByTestId('manual-review-bulk-unmark').querySelector('path');
    expect(path).toHaveAttribute('d', FACE_ACTIONS.unmark.buttonIcon);
  });
});

describe('FaceReviewDock — hover, focus and the swap', () => {
  // D11
  it('given nothing hovered, shows the neutral hint and no popover', () => {
    renderDock();

    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Nothing is written until you press Apply.');
    expect(screen.queryByTestId('face-bulk-popover')).not.toBeInTheDocument();
  });

  // D12 + D13
  it('given the pointer enters an action, shows its tip in a popover and its effect in the hint row', async () => {
    renderDock();

    await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));

    expect(screen.getByTestId('face-bulk-popover')).toHaveTextContent(
      'Pin these here permanently, so no future scan can flag them.',
    );
    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Confirm & lock');
    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('the face is pinned to this person');
  });

  // D13 (mode arm) — guided resolves the scan-referencing effect copy.
  it('given guided mode, the hint row for a chosen-person move warns about the next scan', async () => {
    renderDock({ mode: 'guided' });

    await fireEvent.mouseEnter(screen.getByTestId('bulk-other'));

    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('the next scan can flag the face again');
  });

  // D13 (mode arm) — manual resolves the scan-free copy for the SAME action id.
  it('given manual mode, the same action’s hint row never mentions a scan', async () => {
    renderDock({ mode: 'manual', actions: [{ id: 'other', testId: 'manual-review-bulk-move' }] });

    await fireEvent.mouseEnter(screen.getByTestId('manual-review-bulk-move'));

    const hint = screen.getByTestId('face-bulk-hint');
    expect(hint).toHaveTextContent('so recognition never routes the face back here later');
    expect(hint).not.toHaveTextContent('the next scan can flag the face again');
  });

  // D14
  it('given the pointer leaves, restores the neutral hint and removes the popover', async () => {
    renderDock();

    await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));
    await fireEvent.mouseLeave(screen.getByTestId('bulk-lock'));

    expect(screen.queryByTestId('face-bulk-popover')).not.toBeInTheDocument();
    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Nothing is written until you press Apply.');
  });

  // D15 — keyboard parity.
  it('given a keyboard user focuses an action, shows the same popover and hint as hovering', async () => {
    renderDock();

    await fireEvent.focusIn(screen.getByTestId('bulk-detach'));

    expect(screen.getByTestId('face-bulk-popover')).toHaveTextContent('Irreversible');
    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Not a face');
  });

  // D16
  it('given focus leaves the action, restores the neutral hint', async () => {
    renderDock();

    await fireEvent.focusIn(screen.getByTestId('bulk-detach'));
    await fireEvent.focusOut(screen.getByTestId('bulk-detach'));

    expect(screen.queryByTestId('face-bulk-popover')).not.toBeInTheDocument();
    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Nothing is written until you press Apply.');
  });

  // D17 — sliding along the bar with no intervening leave.
  it('given the pointer moves straight from one action to another, describes the second', async () => {
    renderDock();

    await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));
    await fireEvent.mouseEnter(screen.getByTestId('bulk-unknown'));

    expect(screen.getByTestId('face-bulk-popover')).toHaveTextContent('Real faces, but not this person');
    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Unknown person');
    expect(screen.getByTestId('face-bulk-hint')).not.toHaveTextContent('pinned to this person');
  });

  // D18
  it('given an action is hovered, exactly one popover exists', async () => {
    renderDock();

    await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));

    expect(screen.getAllByTestId('face-bulk-popover')).toHaveLength(1);
  });

  // D19 — one announcement, and focus reaches the effect text.
  it('given an action is hovered, the popover is hidden from screen readers and the button describes itself', async () => {
    renderDock();

    await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));

    expect(screen.getByTestId('face-bulk-popover')).toHaveAttribute('aria-hidden', 'true');
    const describedBy = screen.getByTestId('bulk-lock').getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.querySelector(`#${describedBy}`)).toBe(screen.getByTestId('face-bulk-hint'));
  });

  // D20
  it('given the pointer enters clear or help, leaves the hint row alone', async () => {
    renderDock();

    await fireEvent.mouseEnter(screen.getByTestId('face-bulk-clear'));
    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Nothing is written until you press Apply.');

    await fireEvent.mouseEnter(screen.getByTestId('face-bulk-help'));
    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Nothing is written until you press Apply.');
  });

  // D21 + D22 — applying an action clears the selection, so the bar unmounts while still hovered.
  it('given the selection is emptied while an action is hovered, the next selection opens with no stale effect', async () => {
    const { rerender } = renderDock({ selectedCount: 2 });

    await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));
    await rerender({ selectedCount: 0 });

    expect(screen.getByTestId('harness-summary')).toBeInTheDocument();

    await rerender({ selectedCount: 3 });

    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Nothing is written until you press Apply.');
    expect(screen.queryByTestId('face-bulk-popover')).not.toBeInTheDocument();
  });

  // D23 — growing the selection must not clear a live hover.
  it('given the selection grows while an action is hovered, keeps describing that action', async () => {
    const { rerender } = renderDock({ selectedCount: 2 });

    await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));
    await rerender({ selectedCount: 5 });

    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Confirm & lock');
  });
});

describe('FaceReviewDock — edge cases', () => {
  // D24
  it('renders the bar shell with no actions at all', () => {
    renderDock({ actions: [] });

    expect(screen.getByTestId('face-bulk-bar')).toHaveTextContent('2 selected');
    expect(screen.getByTestId('face-bulk-clear')).toBeInTheDocument();
    expect(screen.getByTestId('face-bulk-help')).toBeInTheDocument();
    expect(screen.getByTestId('face-bulk-hint')).toBeInTheDocument();
  });

  // D25
  it('renders a single action', () => {
    renderDock({ actions: [{ id: 'detach', testId: 'bulk-detach' }] });

    expect(screen.getByTestId('bulk-detach')).toBeInTheDocument();
  });

  // D26
  it('renders a selection of one as readily as many', () => {
    renderDock({ selectedCount: 1 });

    expect(screen.getByTestId('face-bulk-bar')).toHaveTextContent('1 selected');
  });

  // D27 — the other half of the F2 split: no swatch must not suppress the glyph.
  it('renders the glyph of an action that has no tile colour', () => {
    renderDock({ actions: [{ id: 'unmark', testId: 'manual-review-bulk-unmark' }] });

    expect(FACE_ACTIONS.unmark.swatchColor).toBeUndefined();
    expect(screen.getByTestId('manual-review-bulk-unmark').querySelector('path')).toHaveAttribute(
      'd',
      FACE_ACTIONS.unmark.buttonIcon,
    );
  });

  // D28 — no module-level state leaks between instances (the suite sets no clearMocks). Every testid in the
  // second dock is distinct, INCLUDING `dock`: two elements sharing one testid would make a later
  // `getByTestId('face-dock')` throw "found multiple elements" from an unrelated test.
  it('keeps two docks independent', async () => {
    renderDock({ actions: [{ id: 'lock', testId: 'bulk-lock' }] });
    renderDock({ mode: 'manual', actions: [{ id: 'unmark', testId: 'manual-review-bulk-unmark' }] });

    // Both docks render the same normalised chrome testids, so index the pair rather than aliasing them.
    const hints = screen.getAllByTestId('face-bulk-hint');
    expect(hints).toHaveLength(2);

    await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));

    // The first dock describes what was hovered; the second is untouched by it — no module-level state leak.
    expect(hints[0]).toHaveTextContent('Confirm & lock');
    expect(hints[1]).toHaveTextContent('Nothing is written until you press Apply.');
  });
});
