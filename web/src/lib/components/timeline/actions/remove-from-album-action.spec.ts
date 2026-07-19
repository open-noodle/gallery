import { BulkIdErrorReason, getAlbumInfo, removeAssetFromAlbum, type AlbumResponseDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RemoveFromAlbumAction from '$lib/components/timeline/actions/remove-from-album-action.test-wrapper.svelte';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';

vi.mock('@immich/sdk', async (original) => ({
  ...(await original()),
  removeAssetFromAlbum: vi.fn(),
  getAlbumInfo: vi.fn(),
}));

describe('RemoveFromAlbumAction', () => {
  const album = { id: 'album-1', albumName: 'Trip' } as AlbumResponseDto;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(modalManager, 'showDialog').mockResolvedValue(true);
    vi.mocked(getAlbumInfo).mockResolvedValue(album);
    assetMultiSelectManager.clear();
  });

  const clickRemove = async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /remove_from_album/i }));
  };

  it('prunes only the assets the server actually removed', async () => {
    vi.mocked(removeAssetFromAlbum).mockResolvedValue([
      { id: 'a1', success: true },
      { id: 'a2', success: false, error: BulkIdErrorReason.NoPermission },
    ]);
    const onRemove = vi.fn();
    render(RemoveFromAlbumAction, { album, onRemove, assetIds: ['a1', 'a2'] });

    await clickRemove();

    expect(onRemove).toHaveBeenCalledWith(['a1']);
  });

  it('shows a warning, not success, when nothing was removed', async () => {
    vi.mocked(removeAssetFromAlbum).mockResolvedValue([
      { id: 'a1', success: false, error: BulkIdErrorReason.NoPermission },
      { id: 'a2', success: false, error: BulkIdErrorReason.NoPermission },
    ]);
    const warning = vi.spyOn(toastManager, 'warning').mockImplementation(() => ({}) as never);
    const primary = vi.spyOn(toastManager, 'primary').mockImplementation(() => ({}) as never);
    const info = vi.spyOn(toastManager, 'info').mockImplementation(() => ({}) as never);
    render(RemoveFromAlbumAction, { album, onRemove: vi.fn(), assetIds: ['a1', 'a2'] });

    await clickRemove();

    expect(warning).toHaveBeenCalled();
    expect(primary).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('reports a partial removal as info with both counts', async () => {
    vi.mocked(removeAssetFromAlbum).mockResolvedValue([
      { id: 'a1', success: true },
      { id: 'a2', success: false, error: BulkIdErrorReason.NoPermission },
    ]);
    const info = vi.spyOn(toastManager, 'info').mockImplementation(() => ({}) as never);
    const primary = vi.spyOn(toastManager, 'primary').mockImplementation(() => ({}) as never);
    const warning = vi.spyOn(toastManager, 'warning').mockImplementation(() => ({}) as never);
    render(RemoveFromAlbumAction, { album, onRemove: vi.fn(), assetIds: ['a1', 'a2'] });

    await clickRemove();

    expect(info).toHaveBeenCalled();
    expect(primary).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });

  it('keeps the success toast when every asset was removed', async () => {
    vi.mocked(removeAssetFromAlbum).mockResolvedValue([{ id: 'a1', success: true }]);
    const primary = vi.spyOn(toastManager, 'primary').mockImplementation(() => ({}) as never);
    render(RemoveFromAlbumAction, { album, onRemove: vi.fn(), assetIds: ['a1'] });

    await clickRemove();

    expect(primary).toHaveBeenCalled();
  });
});
