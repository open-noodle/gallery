// AssetAddToCollectionModal.spec.ts
import type { AlbumResponseDto } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import '$lib/__mocks__/sdk.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import AssetAddToCollectionModal from './AssetAddToCollectionModal.svelte';

const { mockUser, mockAdd } = vi.hoisted(() => ({
  mockUser: { current: { id: 'me', isAdmin: false } },
  mockAdd: vi.fn(),
}));
vi.mock('$lib/services/collection.service', () => ({ addAssetsToCollections: mockAdd }));
vi.mock('$lib/managers/auth-manager.svelte', () => ({
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
  vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
  vi.stubGlobal('visualViewport', getVisualViewportMock());
  Element.prototype.animate = getAnimateMock();
  vi.resetAllMocks();
  mockUser.current = { id: 'me', isAdmin: false };
  mockAdd.mockResolvedValue(true);
  sdkMock.getAllAlbums.mockImplementation(({ isShared }: { isShared?: boolean }) =>
    Promise.resolve(isShared ? [] : [album('a1', 'Trip')]),
  );
  sdkMock.getAllSpaces.mockResolvedValue([]);
});

afterAll(async () => {
  await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'));
});

describe('AssetAddToCollectionModal', () => {
  it('dispatches to the chosen collection and closes on success', async () => {
    const onClose = vi.fn();
    render(AssetAddToCollectionModal, { assetIds: ['1', '2'], onClose });
    const tripButtons = await screen.findAllByRole('button', { name: /Trip/ });
    await fireEvent.click(tripButtons[0]);
    expect(mockAdd).toHaveBeenCalledWith([expect.objectContaining({ id: 'a1', kind: 'album' })], ['1', '2']);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('closes without dispatching when the picker is dismissed', async () => {
    const onClose = vi.fn();
    render(AssetAddToCollectionModal, { assetIds: ['1'], onClose });
    const closeButtons = await screen.findAllByRole('button', { name: 'Close' });
    await fireEvent.click(closeButtons[0]);
    expect(mockAdd).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stays open when the dispatch reports failure', async () => {
    mockAdd.mockResolvedValue(false);
    const onClose = vi.fn();
    render(AssetAddToCollectionModal, { assetIds: ['1'], onClose });
    const tripButtons = await screen.findAllByRole('button', { name: /Trip/ });
    await fireEvent.click(tripButtons[0]);
    await waitFor(() => expect(mockAdd).toHaveBeenCalledOnce());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores a second confirm while the first dispatch is pending (no duplicate add)', async () => {
    let resolveAdd!: (value: boolean) => void;
    mockAdd.mockReturnValue(new Promise<boolean>((resolve) => (resolveAdd = resolve)));
    const onClose = vi.fn();
    render(AssetAddToCollectionModal, { assetIds: ['1'], onClose });
    const tripButtons = await screen.findAllByRole('button', { name: /Trip/ });
    const row = tripButtons[0];
    await fireEvent.click(row);
    await fireEvent.click(row); // second click while the first dispatch is still pending
    expect(mockAdd).toHaveBeenCalledTimes(1);
    resolveAdd(true);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});
