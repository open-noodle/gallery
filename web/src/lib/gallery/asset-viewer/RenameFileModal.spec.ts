import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import type { AssetRenameCheckResponseDto, AssetResponseDto } from '@immich/sdk';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

// Loaded after the sdk mock above: in browser mode a static import would link the modal to the real SDK first.
let RenameFileModal: typeof import('./RenameFileModal.svelte').default;
beforeAll(async () => {
  const module = await import('./RenameFileModal.svelte');
  RenameFileModal = module.default;
});

// The enum values as the server sends them; a value import of the enum would link the real SDK before the mock.
const checked = (state: 'free' | 'exists') => ({ state }) as AssetRenameCheckResponseDto;

const asset = (overrides: Partial<AssetResponseDto> = {}) =>
  ({ id: 'asset-1', originalFileName: 'IMG_0007.JPEG', libraryId: 'library-1', ...overrides }) as AssetResponseDto;

const input = () => page.getByTestId('rename-file-input');
const renameButton = () => page.getByRole('button', { name: 'rename', exact: true });
const diskCheckbox = () => page.getByLabelText('rename_file_on_disk');

beforeEach(() => {
  sdkMock.renameAsset.mockReset();
  sdkMock.renameAsset.mockResolvedValue({ originalFileName: 'Beach.jpg', originalPath: '/library/Beach.jpg' });
  sdkMock.getAssetInfo.mockReset();
  sdkMock.getAssetInfo.mockResolvedValue(asset());
  sdkMock.checkAssetRename.mockReset();
  sdkMock.checkAssetRename.mockResolvedValue(checked('free'));
});

afterEach(() => vi.useRealTimers());

describe('RenameFileModal', () => {
  it('shows the name without its extension, and the extension as the server will write it', async () => {
    await render(RenameFileModal, { props: { asset: asset(), onClose: vi.fn() } });

    await expect.element(input()).toHaveValue('IMG_0007');
    await expect.element(page.getByText('.jpg')).toBeInTheDocument();
  });

  it('keeps Rename off until the name is new and valid', async () => {
    await render(RenameFileModal, { props: { asset: asset(), onClose: vi.fn() } });

    await expect.element(renameButton()).toBeDisabled();

    await input().fill('a/b');
    await expect.element(renameButton()).toBeDisabled();

    await input().fill('Beach');
    await expect.element(renameButton()).toBeEnabled();
  });

  it('offers the rename on disk for an external library file only', async () => {
    await render(RenameFileModal, { props: { asset: asset(), onClose: vi.fn() } });
    await expect.element(diskCheckbox()).toBeInTheDocument();
  });

  it('offers no rename on disk for an upload, and renames the name only', async () => {
    const onClose = vi.fn();
    await render(RenameFileModal, { props: { asset: asset({ libraryId: null }), onClose } });

    expect(diskCheckbox().query()).toBeNull();

    await input().fill('Beach');
    await renameButton().click();

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(sdkMock.renameAsset).toHaveBeenCalledWith({ id: 'asset-1', assetRenameDto: { fileName: 'Beach' } });
    expect(sdkMock.checkAssetRename).not.toHaveBeenCalled();
  });

  it('does not check the name until the box is ticked', async () => {
    await render(RenameFileModal, { props: { asset: asset(), onClose: vi.fn() } });

    await input().fill('Beach');
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(sdkMock.checkAssetRename).not.toHaveBeenCalled();

    await diskCheckbox().click();
    await vi.waitFor(() =>
      expect(sdkMock.checkAssetRename).toHaveBeenCalledExactlyOnceWith({ id: 'asset-1', fileName: 'Beach' }),
    );
  });

  it('blocks a name held by a file, with the red message, and frees it when the name changes', async () => {
    sdkMock.checkAssetRename.mockResolvedValue(checked('exists'));
    await render(RenameFileModal, { props: { asset: asset(), onClose: vi.fn() } });

    await diskCheckbox().click();
    await input().fill('IMG_0008');

    await expect.element(page.getByTestId('rename-file-exists')).toBeInTheDocument();
    await expect.element(renameButton()).toBeDisabled();

    sdkMock.checkAssetRename.mockResolvedValue(checked('free'));
    await input().fill('Beach');

    await expect.element(renameButton()).toBeEnabled();
    expect(page.getByTestId('rename-file-exists').query()).toBeNull();
  });

  it('renames on disk when the box is ticked', async () => {
    const onClose = vi.fn();
    await render(RenameFileModal, { props: { asset: asset(), onClose } });

    await diskCheckbox().click();
    await input().fill('Beach');
    await vi.waitFor(() => expect(sdkMock.checkAssetRename).toHaveBeenCalled());
    await renameButton().click();

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(sdkMock.renameAsset).toHaveBeenCalledWith({
      id: 'asset-1',
      assetRenameDto: { fileName: 'Beach', renameOnDisk: true },
    });
  });

  it('closes without renaming on Escape', async () => {
    const onClose = vi.fn();
    await render(RenameFileModal, { props: { asset: asset(), onClose } });

    await userEvent.keyboard('{Escape}');

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledWith(false));
    expect(sdkMock.renameAsset).not.toHaveBeenCalled();
  });
});
