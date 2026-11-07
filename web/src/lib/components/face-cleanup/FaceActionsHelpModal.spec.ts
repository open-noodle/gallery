import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import FaceActionsHelpModal from './FaceActionsHelpModal.svelte';
import { FACE_ACTIONS } from './face-actions';

// Rendered against the real en.json, like the two modals it replaces.

beforeAll(async () => {
  register('en', () => import('#i18n/en.json'));
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
  it('titles the modal and frames apply as the point of no return', async () => {
    await renderModal(GUIDED);

    await expect.element(page.getByText('What do these actions do?')).toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          'Nothing changes until you press Apply. Every flagged face has to end in one of these six states. Then this person leaves the cleanup queue for good.',
        ),
      )
      .toBeInTheDocument();
  });

  it('names all six actions, reusing the bulk-bar labels', async () => {
    await renderModal(GUIDED);

    // Scoped to each action's OWN row (`help-row-<id>`), not the shared `help-actions` container: "Keep
    // here" also appears inside lock's body ("Like Keep here, but permanent…") and "Unknown person" also
    // appears inside detach's effect ("Use Unknown person instead…"), so a container-wide assertion would
    // still pass on a neighbour's copy even if a row's own label vanished.
    for (const [id, name] of [
      ['owner', 'Move to owner'],
      ['stay', 'Keep here'],
      ['lock', 'Confirm & lock'],
      ['other', 'Move to person...'],
      ['unknown', 'Unknown person'],
      ['detach', 'Not a face'],
    ] as const) {
      await expect.element(page.getByTestId(`help-row-${id}`)).toMatchTextContent(name);
    }
  });

  // H3
  it('explains what each action means', async () => {
    await renderModal(GUIDED);

    await expect.element(page.getByText(/the default for every flagged face/)).toBeInTheDocument();
    await expect.element(page.getByText(/the scan got it wrong/)).toBeInTheDocument();
    await expect.element(page.getByText(/permanent and owner-agnostic/)).toBeInTheDocument();
    await expect.element(page.getByText(/instead of the one the scan suggested/)).toBeInTheDocument();
    await expect.element(page.getByText(/a poster, a statue, a reflection/)).toBeInTheDocument();
    await expect.element(page.getByText(/you don't know whose it is/)).toBeInTheDocument();
  });

  it('explains what each action does on apply, including the stay-vs-lock durability difference', async () => {
    await renderModal(GUIDED);

    const effects = page.getByTestId('help-effect');
    await expect.element(effects.nth(5)).toBeInTheDocument();
    expect(effects.elements()).toHaveLength(6);
    for (const effect of effects.elements()) {
      await expect.element(page.elementLocator(effect)).toMatchTextContent('On apply:');
    }

    await expect.element(page.getByText(/joins the suspected owner/)).toBeInTheDocument();
    await expect
      .element(page.getByText(/If a later scan suspects a different person, the face can be flagged again/))
      .toBeInTheDocument();
    await expect
      .element(page.getByText(/no future scan can flag it again, no matter who it comes to resemble/))
      .toBeInTheDocument();
    await expect.element(page.getByText(/the next scan can flag the face again/)).toBeInTheDocument();
    await expect.element(page.getByText(/loses its identity link/)).toBeInTheDocument();
    await expect.element(page.getByText(/move into a new unnamed cluster of their own/)).toBeInTheDocument();
  });

  // H6
  it('warns that Not a face retires the crop rather than returning it to the pool, and points at Unknown person', async () => {
    await renderModal(GUIDED);

    await expect.element(page.getByText(/If it IS a real face, use Unknown person instead/)).toBeInTheDocument();
    await expect
      .element(page.getByText(/gone from face recognition and never comes back into the pool/))
      .toBeInTheDocument();
  });

  it('tells the admin the resolutions are undoable and that an emptied unnamed person is removed', async () => {
    await renderModal(GUIDED);

    await expect
      .element(page.getByTestId('help-footer'))
      .toMatchTextContent(
        'Declines and locks can be undone from the Resolutions page. If moving or detaching leaves an unnamed person with no faces at all, that empty person is removed.',
      );
  });

  // H4 — guided passes no defaultActionId, so no badge anywhere.
  it('marks no action as the default', async () => {
    await renderModal(GUIDED);

    await expect.element(page.getByTestId('help-default-badge')).not.toBeInTheDocument();
  });
});

describe('FaceActionsHelpModal — manual', () => {
  // H2 (from ManualActionsHelpModal.spec.ts)
  it('titles the modal the same question guided asks', async () => {
    await renderModal(MANUAL);

    await expect.element(page.getByText('What do these actions do?')).toBeInTheDocument();
  });

  it('names exactly this mode’s six actions: Keep (default), Move to person..., Confirm & lock, Unknown person, Not a face, Unmark', async () => {
    await renderModal(MANUAL);

    // Scoped to each action's OWN row, not the shared `help-actions` container: "Keep" also appears inside
    // lock's body ("Like Keep, but permanent…") and "Unknown person" also appears inside detach's effect
    // ("Use Unknown person instead…"), so a container-wide assertion would still pass on a neighbour's copy
    // even if a row's own label vanished.
    for (const [id, name] of [
      ['keep', 'Keep'],
      ['other', 'Move to person...'],
      ['lock', 'Confirm & lock'],
      ['unknown', 'Unknown person'],
      ['detach', 'Not a face'],
      ['unmark', 'Unmark'],
    ] as const) {
      const row = page.getByTestId(`help-row-${id}`);
      if (id === 'keep') {
        // keep's own effect copy ("Keep is what lets you ignore them") also contains the word "Keep", so a
        // row-wide text match would still pass even if the heading itself vanished — assert against the
        // heading specifically.
        await expect.element(row.getByRole('heading')).toMatchTextContent(name);
      } else {
        await expect.element(row).toMatchTextContent(name);
      }
    }
    await expect.element(page.getByTestId('help-actions')).not.toMatchTextContent('Move to owner');
  });

  it('explains that Keep writes nothing, unlike guided where every face is always stamped', async () => {
    await renderModal(MANUAL);

    await expect
      .element(page.getByText(/There's no button for it, because you never have to select it/))
      .toBeInTheDocument();
    await expect.element(page.getByText(/A kept face is never sent with the Apply request/)).toBeInTheDocument();
  });

  it('warns Not a face is irreversible and points at Unknown as the opposite case', async () => {
    await renderModal(MANUAL);

    await expect.element(page.getByText(/If it IS a real face, use Unknown person instead/)).toBeInTheDocument();
  });

  it('every action explains its effect on apply', async () => {
    await renderModal(MANUAL);

    await expect.element(page.getByTestId('help-effect').nth(5)).toBeInTheDocument();
    const effects = page.getByTestId('help-effect').elements();
    expect(effects).toHaveLength(6);
    for (const effect of effects) {
      await expect.element(page.elementLocator(effect)).toMatchTextContent('On apply:');
    }
  });

  it('tells the admin locks are undoable and an emptied unnamed person is removed', async () => {
    await renderModal(MANUAL);

    await expect
      .element(page.getByTestId('help-footer'))
      .toMatchTextContent(
        'Locks can be undone from the Resolutions page. If moving or detaching leaves an unnamed person with no faces at all, that empty person is removed.',
      );
  });

  // H4
  it('badges Keep as the default, and nothing else', async () => {
    await renderModal(MANUAL);

    await expect.element(page.getByTestId('help-default-badge').first()).toBeInTheDocument();
    const badges = page.getByTestId('help-default-badge').elements();
    expect(badges).toHaveLength(1);
    await expect.element(page.getByTestId('help-row-keep')).toContainElement(badges[0]);
  });

  // H5 — signalled by absence, mirroring the untouched tile.
  it('gives a colour rail to the tile states and none to keep or unmark', async () => {
    await renderModal(MANUAL);

    for (const id of ['other', 'lock', 'unknown', 'detach'] as const) {
      // Chromium normalises the inline hex to rgb(), so compare the computed colour.
      await expect
        .element(page.getByTestId(`help-swatch-${id}`))
        .toHaveStyle({ backgroundColor: FACE_ACTIONS[id].swatchColor! });
    }
    await expect.element(page.getByTestId('help-swatch-keep')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('help-swatch-unmark')).not.toBeInTheDocument();
  });
});

describe('FaceActionsHelpModal — mode-dependent copy', () => {
  // H11 — the F1 guard. A collapse to one variant fails loudly here.
  it('gives the chosen-person move its guided wording under guided and its manual wording under manual', async () => {
    const guided = await renderModal(GUIDED);
    await expect.element(page.getByText(/instead of the one the scan suggested/)).toBeInTheDocument();
    await expect.element(page.getByText(/when you're deliberately overriding the scan/)).toBeInTheDocument();
    await guided.unmount();

    await renderModal(MANUAL);
    await expect
      .element(page.getByText(/anyone in this library, or a new person you create on the spot/))
      .toBeInTheDocument();
    await expect.element(page.getByText(/instead of the one the scan suggested/)).not.toBeInTheDocument();
  });

  it('says “their owner” for lock under guided and “this person” under manual', async () => {
    const guided = await renderModal(GUIDED);
    await expect.element(page.getByText(/genuinely don't resemble their owner/)).toBeInTheDocument();
    await guided.unmount();

    await renderModal(MANUAL);
    await expect.element(page.getByText(/genuinely don't look like this person/)).toBeInTheDocument();
  });

  // H12 — both fully-shared actions (`unknown`, `detach`) must stay shared after the merge.
  it('keeps the shared explanations identical across both modes', async () => {
    const guided = await renderModal(GUIDED);
    const guidedUnknownElement = await page.getByText(/you don't know whose it is/).findElement();
    const guidedUnknown = guidedUnknownElement.textContent;
    const guidedDetachBody = page.getByText(/a poster, a statue, a reflection/).element().textContent;
    const guidedDetachEffect = page
      .getByText(/gone from face recognition and never comes back into the pool/)
      .element().textContent;
    await guided.unmount();

    await renderModal(MANUAL);
    const manualUnknownElement = await page.getByText(/you don't know whose it is/).findElement();
    expect(manualUnknownElement.textContent).toBe(guidedUnknown);
    expect(page.getByText(/a poster, a statue, a reflection/).element().textContent).toBe(guidedDetachBody);
    expect(page.getByText(/gone from face recognition and never comes back into the pool/).element().textContent).toBe(
      guidedDetachEffect,
    );
  });

  // H13 — a guard against `mode` being accepted and ignored.
  it('renders differently for the two modes given the same action subset', async () => {
    const shared = ['other', 'lock'] as const;

    const guided = await renderModal(GUIDED, { actions: [...shared] });
    const guidedActions = await page.getByTestId('help-actions').findElement();
    const guidedText = guidedActions.textContent;
    await guided.unmount();

    await renderModal(MANUAL, { actions: [...shared] });
    const manualActions = await page.getByTestId('help-actions').findElement();
    expect(manualActions.textContent).not.toBe(guidedText);
  });
});

describe('FaceActionsHelpModal — structure and edges', () => {
  // H9
  it('orders rows by the actions array, not by the registry’s own order', async () => {
    await renderModal(GUIDED, { actions: ['detach', 'owner'] });

    await expect.element(page.getByTestId(/^help-row-/).first()).toBeInTheDocument();
    const rows = page
      .getByTestId(/^help-row-/)
      .elements()
      .map((row) => row.dataset.testid);
    expect(rows).toEqual(['help-row-detach', 'help-row-owner']);
  });

  // H10
  it('renders intro and footer with no actions at all', async () => {
    await renderModal(GUIDED, { actions: [] });

    await expect.element(page.getByTestId('help-actions')).toBeEmptyDOMElement();
    await expect.element(page.getByTestId('help-footer')).toBeInTheDocument();
  });

  // H8
  it('closes on the close button', async () => {
    const onClose = vi.fn();
    await renderModal(GUIDED, { onClose });

    await userEvent.click(page.getByTestId('help-close'));

    expect(onClose).toHaveBeenCalled();
  });
});
