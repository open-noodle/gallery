import SpaceAlbumFolderNameModal from '#lib/modals/SpaceAlbumFolderNameModal.svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

describe('SpaceAlbumFolderNameModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves onClose with the entered name on submit', async () => {
    const onClose = vi.fn();
    await render(SpaceAlbumFolderNameModal, { title: 'space_album_folder_new', onClose });

    await userEvent.type(page.getByRole('textbox'), 'Trips');
    await userEvent.click(page.getByRole('button', { name: 'save' }));

    expect(onClose).toHaveBeenCalledWith('Trips');
  });

  // Load-bearing for Task 10: it decides from the resolved value whether a
  // create/rename request fires at all, so surrounding whitespace must not survive.
  it('trims surrounding whitespace before resolving', async () => {
    const onClose = vi.fn();
    await render(SpaceAlbumFolderNameModal, { title: 'space_album_folder_new', onClose });

    await userEvent.type(page.getByRole('textbox'), '  Trips  ');
    await userEvent.click(page.getByRole('button', { name: 'save' }));

    expect(onClose).toHaveBeenCalledWith('Trips');
  });

  it('resolves undefined, not an empty string, for a whitespace-only entry', async () => {
    const onClose = vi.fn();
    await render(SpaceAlbumFolderNameModal, { title: 'space_album_folder_new', onClose });

    await userEvent.type(page.getByRole('textbox'), ' '.repeat(3));
    await userEvent.click(page.getByRole('button', { name: 'save' }));

    expect(onClose).toHaveBeenCalledWith(undefined);
  });

  // The rename path pre-fills the current name; renaming with no edits must still submit it.
  it('pre-fills the input with initialName', async () => {
    await render(SpaceAlbumFolderNameModal, {
      title: 'space_album_folder_rename',
      initialName: 'Trips',
      onClose: vi.fn(),
    });

    await expect.element(page.getByRole('textbox')).toHaveValue('Trips');
  });
});
