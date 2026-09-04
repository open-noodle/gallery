import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import SpaceAlbumFolderNameModal from '$lib/modals/SpaceAlbumFolderNameModal.svelte';

// Drain bits-ui Modal's deferred body-scroll-lock cleanup before happy-dom tears
// down `document`. Otherwise CI can report an unhandled `document is not defined`
// after all assertions in this file have passed.
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500));
});

describe('SpaceAlbumFolderNameModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves onClose with the entered name on submit', async () => {
    const onClose = vi.fn();
    render(SpaceAlbumFolderNameModal, { title: 'space_album_folder_new', onClose });

    await userEvent.type(screen.getByRole('textbox'), 'Trips');
    await userEvent.click(screen.getByRole('button', { name: 'save' }));

    expect(onClose).toHaveBeenCalledWith('Trips');
  });

  // Load-bearing for Task 10: it decides from the resolved value whether a
  // create/rename request fires at all, so surrounding whitespace must not survive.
  it('trims surrounding whitespace before resolving', async () => {
    const onClose = vi.fn();
    render(SpaceAlbumFolderNameModal, { title: 'space_album_folder_new', onClose });

    await userEvent.type(screen.getByRole('textbox'), '  Trips  ');
    await userEvent.click(screen.getByRole('button', { name: 'save' }));

    expect(onClose).toHaveBeenCalledWith('Trips');
  });

  it('resolves undefined, not an empty string, for a whitespace-only entry', async () => {
    const onClose = vi.fn();
    render(SpaceAlbumFolderNameModal, { title: 'space_album_folder_new', onClose });

    await userEvent.type(screen.getByRole('textbox'), ' '.repeat(3));
    await userEvent.click(screen.getByRole('button', { name: 'save' }));

    expect(onClose).toHaveBeenCalledWith(undefined);
  });

  // The rename path pre-fills the current name; renaming with no edits must still submit it.
  it('pre-fills the input with initialName', () => {
    render(SpaceAlbumFolderNameModal, {
      title: 'space_album_folder_rename',
      initialName: 'Trips',
      onClose: vi.fn(),
    });

    expect(screen.getByRole('textbox')).toHaveValue('Trips');
  });
});
