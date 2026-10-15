import PersonDissolveModal from '#lib/modals/PersonDissolveModal.svelte';
import { dissolvePerson, previewDissolvePerson } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent, type Locator } from 'vitest/browser';

const findOne = async (locator: Locator) => {
  await expect.element(locator).toBeInTheDocument();
  return locator.element() as HTMLElement;
};

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  previewDissolvePerson: vi.fn(),
  dissolvePerson: vi.fn(),
}));

// `expectedFaceCount` is deliberately NOT `counts.faces`: it is the server's authoritative concurrency guard,
// and the component must round-trip THAT number rather than recompute one off the counts it happens to show.
// With the two equal, a component sending `counts.faces` passed this suite unnoticed.
const counts = {
  faces: 3180,
  hide: 3000,
  delete: 180,
  keep: 0,
  softDeleted: 14,
  assets: 2874,
  rescanAssets: 170,
  sharedAssets: 61,
  notRedetectable: 44,
  remainingFaces: 0,
  personRemoved: true,
  spacePersonsRemoved: 1,
  spacePersonsKept: 0,
  spacesKept: 0,
};

const withCounts = (over: Partial<typeof counts>, warnings: { code: string; count: number }[] = []) =>
  vi.mocked(previewDissolvePerson).mockResolvedValue({
    personId: 'p1',
    counts: { ...counts, ...over },
    expectedFaceCount: 3175,
    warnings,
  } as never);

describe('PersonDissolveModal', () => {
  beforeEach(() => {
    vi.mocked(previewDissolvePerson).mockResolvedValue({
      personId: 'p1',
      counts,
      expectedFaceCount: 3175,
      warnings: [{ code: 'not-redetectable', count: 44 }],
    } as never);
    vi.mocked(dissolvePerson).mockResolvedValue({
      personId: 'p1',
      counts,
      expectedFaceCount: 3175,
      warnings: [],
    } as never);
  });

  const open = () => render(PersonDissolveModal, { personId: 'p1', personName: 'Oma Krüger', onClose: vi.fn() });

  it('keeps the destructive action disabled until the name is typed exactly', async () => {
    await open();
    const apply = await findOne(page.getByRole('button', { name: /dissolve_apply/ }));
    expect(apply).toBeDisabled();

    const field = page.getByRole('textbox').element();
    await userEvent.type(field, 'Oma');
    expect(apply).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, 'Oma Krüger');
    expect(apply).toBeEnabled();
  });

  it('sends the previewed expectedFaceCount back on apply', async () => {
    await open();
    await userEvent.type(page.getByRole('textbox').element(), 'Oma Krüger');
    await userEvent.click(await findOne(page.getByRole('button', { name: /dissolve_apply/ })));

    expect(dissolvePerson).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: 'p1',
        dissolveRequestDto: expect.objectContaining({ expectedFaceCount: 3175 }),
      }),
    );
  });

  it('renders the warning that some photos can never be re-detected', async () => {
    await open();
    expect(await findOne(page.getByText(/44/))).toBeVisible();
    // Added to the brief's assertion: with no dictionary loaded, `$t` renders bare keys and interpolates
    // nothing, so the sentence itself carries no digits — /44/ alone is satisfied by the counts grid and
    // would still pass with the warning list deleted. This pins the warning row itself.
    expect(page.getByTestId('dissolve-warning-not-redetectable').element()).toBeVisible();
  });

  it('tells the admin which hand-drawn faces are kept and unassigned', async () => {
    withCounts({ keep: 2 }, [{ code: 'hand-drawn-kept', count: 2 }]);
    await open();
    // Pinned by test id, not text: with no dictionary loaded `$t` renders the bare key. An unmapped code
    // renders nothing at all, so this fails if the code-to-key map loses the entry.
    expect(await findOne(page.getByTestId('dissolve-warning-hand-drawn-kept'))).toHaveTextContent(
      'admin.face_cleanup_dissolve_warn_hand_drawn_kept',
    );
  });

  // Reported from production: the counts panel kept showing the PREVIOUS scope's numbers under the newly
  // selected chip, so the dialog described a different face set than the button would delete. The component
  // holds the last successful preview in `preview`, so a preview that never lands leaves those numbers on
  // screen. Nothing may be rendered that does not describe the current selection.
  it("never shows the previous scope's counts when the new scope's preview fails", async () => {
    await open();
    // The `all` preview lands: its numbers are on screen.
    await vi.waitFor(() => expect(page.getByTestId('dissolve-count-faces').element().textContent).toMatch(/3\D?180/));
    expect(page.getByTestId('dissolve-warning-not-redetectable').element()).toBeVisible();

    // Selecting another scope, whose preview then fails.
    vi.mocked(previewDissolvePerson).mockRejectedValue(new Error('boom'));
    const scopes = page.getByTestId('dissolve-scopes').element();
    await userEvent.click(
      page
        .elementLocator(scopes)
        .getByRole('button', { name: /no_embedding/i })
        .element(),
    );

    // The stale numbers must be gone rather than re-labelled under the new chip.
    await vi.waitFor(() => expect(page.getByTestId('dissolve-count-faces').element().textContent).toContain('—'));
    expect(page.getByTestId('dissolve-warning-not-redetectable').query()).not.toBeInTheDocument();
    // And the irreversible action stays shut.
    expect(page.getByRole('button', { name: /dissolve_apply/ }).element()).toBeDisabled();
  });

  it('sends only the scope and the previewed expectedFaceCount', async () => {
    await open();
    await userEvent.type(page.getByRole('textbox').element(), 'Oma Krüger');
    await userEvent.click(await findOne(page.getByRole('button', { name: /dissolve_apply/ })));
    expect(dissolvePerson).toHaveBeenCalledWith({
      personId: 'p1',
      dissolveRequestDto: { scope: 'exif', expectedFaceCount: 3175 },
    });
  });

  it('has no outcome or re-detect control', async () => {
    await open();
    await vi.waitFor(() => expect(page.getByTestId('dissolve-count-faces').element().textContent).toMatch(/3\D?180/));
    expect(page.getByRole('radio').query()).not.toBeInTheDocument();
    expect(page.getByRole('checkbox').query()).not.toBeInTheDocument();
  });

  it("states each treatment's count, and only the treatments that apply", async () => {
    await open();
    await vi.waitFor(() => expect(page.getByTestId('dissolve-count-hide').element().textContent).toMatch(/3\D?000/));
    expect(page.getByTestId('dissolve-count-delete').element().textContent).toContain('180');
    expect(page.getByTestId('dissolve-treatment-hide').element()).toHaveTextContent(
      'admin.face_cleanup_dissolve_hide_count',
    );
    expect(page.getByTestId('dissolve-treatment-delete').element()).toHaveTextContent(
      'admin.face_cleanup_dissolve_delete_count',
    );
    expect(page.getByTestId('dissolve-treatment-unassign').query()).not.toBeInTheDocument();
  });

  it('says the person will be removed', async () => {
    await open();
    expect(await findOne(page.getByTestId('dissolve-person-outcome'))).toHaveTextContent(
      'admin.face_cleanup_dissolve_person_removed',
    );
  });

  it('says how many faces the person keeps when it survives', async () => {
    withCounts({ remainingFaces: 12, personRemoved: false });
    await open();
    expect(await findOne(page.getByTestId('dissolve-person-outcome'))).toHaveTextContent(
      'admin.face_cleanup_dissolve_person_kept',
    );
  });

  it('warns that some Space persons remain', async () => {
    withCounts({ spacePersonsKept: 2, spacesKept: 1 }, [{ code: 'space-persons-kept', count: 2 }]);
    await open();
    expect(await findOne(page.getByTestId('dissolve-warning-space-persons-kept'))).toHaveTextContent(
      'admin.face_cleanup_dissolve_warn_space_persons_kept',
    );
  });

  it('tells the admin to move real faces out first', async () => {
    await open();
    expect(await findOne(page.getByTestId('dissolve-real-faces-note'))).toHaveTextContent(
      'admin.face_cleanup_dissolve_real_faces_note',
    );
  });

  // The admin must see, before confirming, exactly which parts of this dissolve a restore can undo and which it
  // cannot. Default fixture: 3000 detected faces hidden, 180 imported faces deleted, the person removed, one Space
  // person removed.
  it('separates what can be undone from what cannot', async () => {
    await open();
    const undoable = await findOne(page.getByTestId('dissolve-undoable'));
    const permanent = page.getByTestId('dissolve-permanent').element();

    expect(page.elementLocator(undoable).getByTestId('dissolve-treatment-hide').element()).toBeVisible();
    expect(page.elementLocator(permanent).getByTestId('dissolve-treatment-delete').element()).toBeVisible();
    expect(page.elementLocator(permanent).getByTestId('dissolve-person-outcome').element()).toHaveTextContent(
      'admin.face_cleanup_dissolve_person_removed',
    );
    expect(page.elementLocator(permanent).getByTestId('dissolve-space-persons-removed').element()).toHaveTextContent(
      'admin.face_cleanup_dissolve_space_persons_removed',
    );
  });

  it('shows no "cannot be undone" section when a restore undoes everything', async () => {
    withCounts({ delete: 0, personRemoved: false, remainingFaces: 4, spacePersonsRemoved: 0 });
    await open();
    expect(await findOne(page.getByTestId('dissolve-undoable'))).toBeVisible();
    expect(page.getByTestId('dissolve-permanent').query()).not.toBeInTheDocument();
  });

  it('shows no "can be undone" section when nothing will be hidden', async () => {
    withCounts({ hide: 0 });
    await open();
    expect(await findOne(page.getByTestId('dissolve-permanent'))).toBeVisible();
    expect(page.getByTestId('dissolve-undoable').query()).not.toBeInTheDocument();
  });

  it('only warns about hiding real faces when faces will be hidden', async () => {
    withCounts({ hide: 0 });
    await open();
    await findOne(page.getByTestId('dissolve-permanent'));
    expect(page.getByTestId('dissolve-real-faces-note').query()).not.toBeInTheDocument();
  });
});
