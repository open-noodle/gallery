// AssetAddToCollectionModal.spec.ts
import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import type { AlbumResponseDto } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import AssetAddToCollectionModal from './AssetAddToCollectionModal.svelte';

const { mockUser, mockAdd } = vi.hoisted(() => ({
  mockUser: { current: { id: 'me', isAdmin: false } },
  mockAdd: vi.fn(),
}));
vi.mock('#lib/services/collection.service.js', () => ({ addAssetsToCollections: mockAdd }));
vi.mock('#lib/managers/auth-manager.svelte.js', () => ({
  authManager: {
    get authenticated() {
      return mockUser.current !== null;
    },
    get user() {
      return mockUser.current;
    },
  },
}));

const album = (id: string, name: string): AlbumResponseDto =>
  ({
    id,
    albumName: name,
    assetCount: 1,
    albumThumbnailAssetId: null,
    shared: false,
    updatedAt: '2024-01-01T00:00:00Z',
  }) as unknown as AlbumResponseDto;

beforeEach(() => {
  vi.resetAllMocks();
  mockUser.current = { id: 'me', isAdmin: false };
  mockAdd.mockResolvedValue(true);
  sdkMock.getAllAlbums.mockImplementation(({ isShared }: { isShared?: boolean }) =>
    Promise.resolve(isShared ? [] : [album('a1', 'Trip')]),
  );
  sdkMock.getAllSpaces.mockResolvedValue([]);
});

describe('AssetAddToCollectionModal', () => {
  it('dispatches to the chosen collection and closes on success', async () => {
    const onClose = vi.fn();
    await render(AssetAddToCollectionModal, { assetIds: ['1', '2'], onClose });
    await page.getByRole('button', { name: /Trip/ }).first().click();
    expect(mockAdd).toHaveBeenCalledWith([expect.objectContaining({ id: 'a1', kind: 'album' })], ['1', '2'], {
      contributionMode: false,
    });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('restricts the picker to the space and dispatches in contribution mode when given restrictToSpaceId', async () => {
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([{ ...album('sa1', 'Space Trip'), ownerId: 'them' }] as never);
    const onClose = vi.fn();
    await render(AssetAddToCollectionModal, { assetIds: ['1', '2'], onClose, restrictToSpaceId: 'space-1' });

    await page
      .getByRole('button', { name: /Space Trip/ })
      .first()
      .click();

    expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledWith({ id: 'space-1' });
    expect(mockAdd).toHaveBeenCalledWith([expect.objectContaining({ id: 'sa1', kind: 'album' })], ['1', '2'], {
      contributionMode: true,
    });
  });

  it('closes without dispatching when the picker is dismissed', async () => {
    const onClose = vi.fn();
    await render(AssetAddToCollectionModal, { assetIds: ['1'], onClose });
    await page.getByRole('button', { name: 'Close' }).first().click();
    expect(mockAdd).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stays open when the dispatch reports failure', async () => {
    mockAdd.mockResolvedValue(false);
    const onClose = vi.fn();
    await render(AssetAddToCollectionModal, { assetIds: ['1'], onClose });
    await page.getByRole('button', { name: /Trip/ }).first().click();
    await vi.waitFor(() => expect(mockAdd).toHaveBeenCalledOnce());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores a second confirm while the first dispatch is pending (no duplicate add)', async () => {
    let resolveAdd!: (value: boolean) => void;
    mockAdd.mockReturnValue(new Promise<boolean>((resolve) => (resolveAdd = resolve)));
    const onClose = vi.fn();
    await render(AssetAddToCollectionModal, { assetIds: ['1'], onClose });
    const row = page.getByRole('button', { name: /Trip/ }).first();
    await expect.element(row).toBeInTheDocument();
    const element = row.element();
    // two clicks back to back, the second while the first dispatch is still pending
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(mockAdd).toHaveBeenCalledTimes(1);
    resolveAdd(true);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});
