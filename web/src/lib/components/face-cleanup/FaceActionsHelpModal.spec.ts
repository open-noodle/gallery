import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import FaceActionsHelpModal from './FaceActionsHelpModal.svelte';
import { FACE_ACTIONS } from './face-actions';

// Rendered against the real en.json, like the two modals it replaces.

// Drain bits-ui Modal's deferred body-scroll-lock cleanup before happy-dom tears down `document`.
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500));
});

beforeAll(async () => {
  register('en', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en', initialLocale: 'en' });
  await waitLocale('en');
});

const GUIDED = {
  mode: 'guided',
  actions: ['owner', 'stay', 'lock', 'other', 'unknown', 'detach'],
  introKey: 'admin.face_cleanup_review_help_intro',
  footerKey: 'admin.face_cleanup_review_help_footer',
} as const;

const MANUAL = {
  mode: 'manual',
  actions: ['keep', 'other', 'lock', 'unknown', 'detach', 'unmark'],
  introKey: 'admin.face_cleanup_manual_review_help_intro',
  footerKey: 'admin.face_cleanup_manual_review_help_footer',
  defaultActionId: 'keep',
} as const;

const renderModal = (preset: object, over: object = {}) =>
  render(FaceActionsHelpModal, { props: { ...preset, onClose: vi.fn(), ...over } });

describe('FaceActionsHelpModal — guided', () => {
  // H1 + H7 (from ActionsHelpModal.spec.ts)
  it('titles the modal and frames apply as the point of no return', () => {
    renderModal(GUIDED);

    expect(screen.getByText('What do these actions do?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Nothing changes until you press Apply. Every flagged face has to end in one of these six states — then this person leaves the cleanup queue for good.',
      ),
    ).toBeInTheDocument();
  });

  it('names all six actions, reusing the bulk-bar labels', () => {
    renderModal(GUIDED);

    // Scoped to each action's OWN row (`help-row-<id>`), not the shared `help-actions` container: "Keep
    // here" also appears inside lock's body ("Like Keep here, but permanent…") and "Unknown person" also
    // appears inside detach's effect ("Use Unknown person instead…"), so a container-wide assertion would
    // still pass on a neighbour's copy even if a row's own label vanished.
    for (const [id, name] of [
      ['owner', 'Move to owner'],
      ['stay', 'Keep here'],
      ['lock', 'Confirm & lock'],
      ['other', 'Move to person…'],
      ['unknown', 'Unknown person'],
      ['detach', 'Not a face'],
    ] as const) {
      expect(screen.getByTestId(`help-row-${id}`)).toHaveTextContent(name);
    }
  });

  // H3
  it('explains what each action means', () => {
    renderModal(GUIDED);

    expect(screen.getByText(/the default for every flagged face/)).toBeInTheDocument();
    expect(screen.getByText(/the scan got it wrong/)).toBeInTheDocument();
    expect(screen.getByText(/permanent and owner-agnostic/)).toBeInTheDocument();
    expect(screen.getByText(/instead of the one the scan suggested/)).toBeInTheDocument();
    expect(screen.getByText(/a poster, a statue, a reflection/)).toBeInTheDocument();
    expect(screen.getByText(/you don't know whose it is/)).toBeInTheDocument();
  });

  it('explains what each action does on apply, including the stay-vs-lock durability difference', () => {
    renderModal(GUIDED);

    const effects = screen.getAllByTestId('help-effect');
    expect(effects).toHaveLength(6);
    for (const effect of effects) {
      expect(effect).toHaveTextContent('On apply:');
    }

    expect(screen.getByText(/joins the suspected owner/)).toBeInTheDocument();
    expect(
      screen.getByText(/If a later scan suspects a different person, the face can be flagged again/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no future scan can flag it again, no matter who it comes to resemble/),
    ).toBeInTheDocument();
    expect(screen.getByText(/the next scan can flag the face again/)).toBeInTheDocument();
    expect(screen.getByText(/its identity link is stripped/)).toBeInTheDocument();
    expect(screen.getByText(/move into a new unnamed cluster of their own/)).toBeInTheDocument();
  });

  // H6
  it('warns that Not a face retires the crop rather than returning it to the pool, and points at Unknown person', () => {
    renderModal(GUIDED);

    expect(screen.getByText(/Use Unknown person instead if it IS a real face/)).toBeInTheDocument();
    expect(screen.getByText(/gone from face recognition, not returned to the pool/)).toBeInTheDocument();
  });

  it('tells the admin the resolutions are undoable and that an emptied unnamed person is removed', () => {
    renderModal(GUIDED);

    expect(screen.getByTestId('help-footer')).toHaveTextContent(
      'Declines and locks can be undone from the Resolutions page. If moving or detaching leaves an unnamed person with no faces at all, that empty person is removed.',
    );
  });

  // H4 — guided passes no defaultActionId, so no badge anywhere.
  it('marks no action as the default', () => {
    renderModal(GUIDED);

    expect(screen.queryByTestId('help-default-badge')).not.toBeInTheDocument();
  });
});

describe('FaceActionsHelpModal — manual', () => {
  // H2 (from ManualActionsHelpModal.spec.ts)
  it('titles the modal the same question guided asks', () => {
    renderModal(MANUAL);

    expect(screen.getByText('What do these actions do?')).toBeInTheDocument();
  });

  it('names exactly this mode’s six actions: Keep (default), Move to person…, Confirm & lock, Unknown person, Not a face, Unmark', () => {
    renderModal(MANUAL);

    // Scoped to each action's OWN row, not the shared `help-actions` container: "Keep" also appears inside
    // lock's body ("Like Keep, but permanent…") and "Unknown person" also appears inside detach's effect
    // ("Use Unknown person instead…"), so a container-wide assertion would still pass on a neighbour's copy
    // even if a row's own label vanished.
    for (const [id, name] of [
      ['keep', 'Keep'],
      ['other', 'Move to person…'],
      ['lock', 'Confirm & lock'],
      ['unknown', 'Unknown person'],
      ['detach', 'Not a face'],
      ['unmark', 'Unmark'],
    ] as const) {
      const row = screen.getByTestId(`help-row-${id}`);
      if (id === 'keep') {
        // keep's own effect copy ("Keep is what lets you ignore them") also contains the word "Keep", so a
        // row-wide text match would still pass even if the heading itself vanished — assert against the
        // heading specifically.
        expect(within(row).getByRole('heading')).toHaveTextContent(name);
      } else {
        expect(row).toHaveTextContent(name);
      }
    }
    expect(screen.getByTestId('help-actions')).not.toHaveTextContent('Move to owner');
  });

  it('explains that Keep writes nothing, unlike guided where every face is always stamped', () => {
    renderModal(MANUAL);

    expect(screen.getByText(/there's no button for it, because you never have to select it/)).toBeInTheDocument();
    expect(screen.getByText(/A kept face is never included in the Apply request/)).toBeInTheDocument();
  });

  it('warns Not a face is irreversible and points at Unknown as the opposite case', () => {
    renderModal(MANUAL);

    expect(screen.getByText(/Use Unknown person instead if it IS a real face/)).toBeInTheDocument();
  });

  it('every action explains its effect on apply', () => {
    renderModal(MANUAL);

    const effects = screen.getAllByTestId('help-effect');
    expect(effects).toHaveLength(6);
    for (const effect of effects) {
      expect(effect).toHaveTextContent('On apply:');
    }
  });

  it('tells the admin locks are undoable and an emptied unnamed person is removed', () => {
    renderModal(MANUAL);

    expect(screen.getByTestId('help-footer')).toHaveTextContent(
      'Locks can be undone from the Resolutions page. If moving or detaching leaves an unnamed person with no faces at all, that empty person is removed.',
    );
  });

  // H4
  it('badges Keep as the default, and nothing else', () => {
    renderModal(MANUAL);

    const badges = screen.getAllByTestId('help-default-badge');
    expect(badges).toHaveLength(1);
    expect(screen.getByTestId('help-row-keep')).toContainElement(badges[0]);
  });

  // H5 — signalled by absence, mirroring the untouched tile.
  it('gives a colour rail to the tile states and none to keep or unmark', () => {
    renderModal(MANUAL);

    for (const id of ['other', 'lock', 'unknown', 'detach'] as const) {
      // `toHaveAttribute('style', stringContaining(hex))`, NOT `toHaveStyle({ background: hex })` — happy-dom
      // does not normalise an inline hex the way toHaveStyle expects, so the latter fails on a correct render.
      // Same assertion the spec this replaces used (ManualActionsHelpModal.spec.ts:95).
      expect(screen.getByTestId(`help-swatch-${id}`)).toHaveAttribute(
        'style',
        expect.stringContaining(FACE_ACTIONS[id].swatchColor!),
      );
    }
    expect(screen.queryByTestId('help-swatch-keep')).not.toBeInTheDocument();
    expect(screen.queryByTestId('help-swatch-unmark')).not.toBeInTheDocument();
  });
});

describe('FaceActionsHelpModal — mode-dependent copy', () => {
  // H11 — the F1 guard. A collapse to one variant fails loudly here.
  it('gives the chosen-person move its guided wording under guided and its manual wording under manual', () => {
    const guided = renderModal(GUIDED);
    expect(screen.getByText(/instead of the one the scan suggested/)).toBeInTheDocument();
    expect(screen.getByText(/when you're deliberately overriding the scan/)).toBeInTheDocument();
    guided.unmount();

    renderModal(MANUAL);
    expect(
      screen.getByText(/anyone in this library, or a brand-new person you create on the spot/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/instead of the one the scan suggested/)).not.toBeInTheDocument();
  });

  it('says “their owner” for lock under guided and “this person” under manual', () => {
    const guided = renderModal(GUIDED);
    expect(screen.getByText(/genuinely don't resemble their owner/)).toBeInTheDocument();
    guided.unmount();

    renderModal(MANUAL);
    expect(screen.getByText(/genuinely don't look like this person/)).toBeInTheDocument();
  });

  // H12 — both fully-shared actions (`unknown`, `detach`) must stay shared after the merge.
  it('keeps the shared explanations identical across both modes', () => {
    const guided = renderModal(GUIDED);
    const guidedUnknown = screen.getByText(/you don't know whose it is/).textContent;
    const guidedDetachBody = screen.getByText(/a poster, a statue, a reflection/).textContent;
    const guidedDetachEffect = screen.getByText(/gone from face recognition, not returned to the pool/).textContent;
    guided.unmount();

    renderModal(MANUAL);
    expect(screen.getByText(/you don't know whose it is/).textContent).toBe(guidedUnknown);
    expect(screen.getByText(/a poster, a statue, a reflection/).textContent).toBe(guidedDetachBody);
    expect(screen.getByText(/gone from face recognition, not returned to the pool/).textContent).toBe(
      guidedDetachEffect,
    );
  });

  // H13 — a guard against `mode` being accepted and ignored.
  it('renders differently for the two modes given the same action subset', () => {
    const shared = ['other', 'lock'] as const;

    const guided = renderModal(GUIDED, { actions: [...shared] });
    const guidedText = screen.getByTestId('help-actions').textContent;
    guided.unmount();

    renderModal(MANUAL, { actions: [...shared] });
    expect(screen.getByTestId('help-actions').textContent).not.toBe(guidedText);
  });
});

describe('FaceActionsHelpModal — structure and edges', () => {
  // H9
  it('orders rows by the actions array, not by the registry’s own order', () => {
    renderModal(GUIDED, { actions: ['detach', 'owner'] });

    const rows = screen.getAllByTestId(/^help-row-/).map((row) => row.dataset.testid);
    expect(rows).toEqual(['help-row-detach', 'help-row-owner']);
  });

  // H10
  it('renders intro and footer with no actions at all', () => {
    renderModal(GUIDED, { actions: [] });

    expect(screen.getByTestId('help-actions')).toBeEmptyDOMElement();
    expect(screen.getByTestId('help-footer')).toBeInTheDocument();
  });

  // H8
  it('closes on the close button', async () => {
    const onClose = vi.fn();
    renderModal(GUIDED, { onClose });

    await fireEvent.click(screen.getByTestId('help-close'));

    expect(onClose).toHaveBeenCalled();
  });
});
