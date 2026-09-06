import { dissolvePerson, previewDissolvePerson } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import PersonDissolveModal from '$lib/modals/PersonDissolveModal.svelte';

vi.mock('@immich/sdk', () => ({
  previewDissolvePerson: vi.fn(),
  dissolvePerson: vi.fn(),
}));

const counts = {
  faces: 3180,
  exif: 3180,
  mlWithEmbedding: 0,
  mlWithoutEmbedding: 0,
  softDeleted: 14,
  assets: 2874,
  sharedAssets: 1861,
  notRedetectable: 44,
};

describe('PersonDissolveModal', () => {
  beforeEach(() => {
    vi.mocked(previewDissolvePerson).mockResolvedValue({
      personId: 'p1',
      counts,
      expectedFaceCount: 3180,
      warnings: [{ code: 'not-redetectable', count: 44 }],
    } as never);
    vi.mocked(dissolvePerson).mockResolvedValue({
      personId: 'p1',
      counts,
      expectedFaceCount: 3180,
      warnings: [],
    } as never);
  });

  const open = () => render(PersonDissolveModal, { personId: 'p1', personName: 'Oma Krüger', onClose: vi.fn() });

  it('keeps the destructive action disabled until the name is typed exactly', async () => {
    open();
    const apply = await screen.findByRole('button', { name: /delete/i });
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
    await userEvent.click(await screen.findByRole('button', { name: /delete/i }));

    expect(dissolvePerson).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: 'p1',
        dissolveRequestDto: expect.objectContaining({ expectedFaceCount: 3180 }),
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

  it('forces redetect on for a delete outcome', async () => {
    open();
    const redetect = await screen.findByRole('checkbox');
    expect(redetect).toBeChecked();
    expect(redetect).toBeDisabled();
  });
});
