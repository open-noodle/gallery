import { dissolvePerson, previewDissolvePerson } from '@immich/sdk';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import PersonDissolveModal from '$lib/modals/PersonDissolveModal.svelte';

vi.mock('@immich/sdk', () => ({
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
    open();
    const apply = await screen.findByRole('button', { name: /dissolve_apply/ });
    expect(apply).toBeDisabled();

    const field = screen.getByRole('textbox');
    await userEvent.type(field, 'Oma');
    expect(apply).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, 'Oma Krüger');
    expect(apply).toBeEnabled();
  });

  it('sends the previewed expectedFaceCount back on apply', async () => {
    open();
    await userEvent.type(screen.getByRole('textbox'), 'Oma Krüger');
    await userEvent.click(await screen.findByRole('button', { name: /dissolve_apply/ }));

    expect(dissolvePerson).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: 'p1',
        dissolveRequestDto: expect.objectContaining({ expectedFaceCount: 3175 }),
      }),
    );
  });

  it('renders the warning that some photos can never be re-detected', async () => {
    open();
    expect(await screen.findByText(/44/)).toBeVisible();
    // Added to the brief's assertion: with no dictionary loaded, `$t` renders bare keys and interpolates
    // nothing, so the sentence itself carries no digits — /44/ alone is satisfied by the counts grid and
    // would still pass with the warning list deleted. This pins the warning row itself.
    expect(screen.getByTestId('dissolve-warning-not-redetectable')).toBeVisible();
  });

  it('tells the admin which hand-drawn faces are kept and unassigned', async () => {
    withCounts({ keep: 2 }, [{ code: 'hand-drawn-kept', count: 2 }]);
    open();
    // Pinned by test id, not text: with no dictionary loaded `$t` renders the bare key. An unmapped code
    // renders nothing at all, so this fails if the code-to-key map loses the entry.
    expect(await screen.findByTestId('dissolve-warning-hand-drawn-kept')).toHaveTextContent(
      'admin.face_cleanup_dissolve_warn_hand_drawn_kept',
    );
  });

  // Reported from production: the counts panel kept showing the PREVIOUS scope's numbers under the newly
  // selected chip, so the dialog described a different face set than the button would delete. The component
  // holds the last successful preview in `preview`, so a preview that never lands leaves those numbers on
  // screen. Nothing may be rendered that does not describe the current selection.
  it("never shows the previous scope's counts when the new scope's preview fails", async () => {
    open();
    // The `all` preview lands: its numbers are on screen.
    await waitFor(() => expect(screen.getByTestId('dissolve-count-faces')).toHaveTextContent(/3\D?180/));
    expect(screen.getByTestId('dissolve-warning-not-redetectable')).toBeVisible();

    // Selecting another scope, whose preview then fails.
    vi.mocked(previewDissolvePerson).mockRejectedValue(new Error('boom'));
    const scopes = screen.getByTestId('dissolve-scopes');
    await userEvent.click(within(scopes).getByRole('button', { name: /no_embedding/i }));

    // The stale numbers must be gone rather than re-labelled under the new chip.
    await waitFor(() => expect(screen.getByTestId('dissolve-count-faces')).toHaveTextContent('—'));
    expect(screen.queryByTestId('dissolve-warning-not-redetectable')).not.toBeInTheDocument();
    // And the irreversible action stays shut.
    expect(screen.getByRole('button', { name: /dissolve_apply/ })).toBeDisabled();
  });

  it('sends only the scope and the previewed expectedFaceCount', async () => {
    open();
    await userEvent.type(screen.getByRole('textbox'), 'Oma Krüger');
    await userEvent.click(await screen.findByRole('button', { name: /dissolve_apply/ }));
    expect(dissolvePerson).toHaveBeenCalledWith({
      personId: 'p1',
      dissolveRequestDto: { scope: 'exif', expectedFaceCount: 3175 },
    });
  });

  it('has no outcome or re-detect control', async () => {
    open();
    await waitFor(() => expect(screen.getByTestId('dissolve-count-faces')).toHaveTextContent(/3\D?180/));
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it("states each treatment's count, and only the treatments that apply", async () => {
    open();
    await waitFor(() => expect(screen.getByTestId('dissolve-count-hide')).toHaveTextContent(/3\D?000/));
    expect(screen.getByTestId('dissolve-count-delete')).toHaveTextContent('180');
    expect(screen.getByTestId('dissolve-treatment-hide')).toHaveTextContent('admin.face_cleanup_dissolve_hide_count');
    expect(screen.getByTestId('dissolve-treatment-delete')).toHaveTextContent(
      'admin.face_cleanup_dissolve_delete_count',
    );
    expect(screen.queryByTestId('dissolve-treatment-unassign')).not.toBeInTheDocument();
  });

  it('says the person will be removed', async () => {
    open();
    expect(await screen.findByTestId('dissolve-person-outcome')).toHaveTextContent(
      'admin.face_cleanup_dissolve_person_removed',
    );
  });

  it('says how many faces the person keeps when it survives', async () => {
    withCounts({ remainingFaces: 12, personRemoved: false });
    open();
    expect(await screen.findByTestId('dissolve-person-outcome')).toHaveTextContent(
      'admin.face_cleanup_dissolve_person_kept',
    );
  });

  it('warns that some Space persons remain', async () => {
    withCounts({ spacePersonsKept: 2, spacesKept: 1 }, [{ code: 'space-persons-kept', count: 2 }]);
    open();
    expect(await screen.findByTestId('dissolve-warning-space-persons-kept')).toHaveTextContent(
      'admin.face_cleanup_dissolve_warn_space_persons_kept',
    );
  });

  it('tells the admin to move real faces out first', async () => {
    open();
    expect(await screen.findByTestId('dissolve-real-faces-note')).toHaveTextContent(
      'admin.face_cleanup_dissolve_real_faces_note',
    );
  });
});
