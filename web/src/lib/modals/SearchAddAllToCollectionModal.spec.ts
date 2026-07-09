import type { AlbumResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import '$lib/__mocks__/sdk.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import SearchAddAllToCollectionModal from './SearchAddAllToCollectionModal.svelte';

const { mockUser, mockAdd, mockCollect, mockHandleError } = vi.hoisted(() => ({
  mockUser: { current: { id: 'me', isAdmin: false } },
  mockAdd: vi.fn(),
  mockCollect: vi.fn(),
  mockHandleError: vi.fn(),
}));
vi.mock('$lib/services/collection.service', () => ({ addAssetsToCollections: mockAdd }));
vi.mock('$lib/services/search.service', () => ({ collectSearchResultAssetIds: mockCollect }));
vi.mock('$lib/utils/handle-error', () => ({ handleError: mockHandleError }));
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

const baseProps = (overrides = {}) => ({
  terms: {},
  total: 3,
  smartSearchEnabled: false,
  language: 'en',
  ...overrides,
});

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
  vi.stubGlobal('visualViewport', getVisualViewportMock());
  Element.prototype.animate = getAnimateMock();
  vi.resetAllMocks();
  mockUser.current = { id: 'me', isAdmin: false };
  mockAdd.mockResolvedValue(true);
  mockCollect.mockResolvedValue(['1', '2', '3']);
  sdkMock.getAllAlbums.mockImplementation(({ isShared }: { isShared?: boolean }) =>
    Promise.resolve(isShared ? [] : [album('a1', 'Trip')]),
  );
  sdkMock.getAllSpaces.mockResolvedValue([]);
});

afterAll(async () => {
  await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'));
});

describe('SearchAddAllToCollectionModal', () => {
  it('collects all matching ids then dispatches to the chosen collection and closes', async () => {
    const onClose = vi.fn();
    render(SearchAddAllToCollectionModal, { ...baseProps({ terms: { isFavorite: true } }), onClose });

    const trip = await screen.findAllByRole('button', { name: /Trip/ });
    await fireEvent.click(trip[0]);

    await waitFor(() =>
      expect(mockCollect).toHaveBeenCalledWith({ isFavorite: true }, { smartSearchEnabled: false, language: 'en' }),
    );
    expect(mockAdd).toHaveBeenCalledWith([expect.objectContaining({ id: 'a1', kind: 'album' })], ['1', '2', '3']);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('shows the preparing indicator while collecting', async () => {
    let resolveCollect!: (ids: string[]) => void;
    mockCollect.mockReturnValue(new Promise<string[]>((resolve) => (resolveCollect = resolve)));
    render(SearchAddAllToCollectionModal, { ...baseProps(), onClose: vi.fn() });

    const trip = await screen.findAllByRole('button', { name: /Trip/ });
    await fireEvent.click(trip[0]);

    await screen.findByTestId('preparing-indicator');
    resolveCollect(['1']);
  });

  it('closes without collecting or adding when dismissed', async () => {
    const onClose = vi.fn();
    render(SearchAddAllToCollectionModal, { ...baseProps(), onClose });

    const close = await screen.findAllByRole('button', { name: 'Close' });
    await fireEvent.click(close[0]);

    expect(mockCollect).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stays open when the add reports failure', async () => {
    mockAdd.mockResolvedValue(false);
    const onClose = vi.fn();
    render(SearchAddAllToCollectionModal, { ...baseProps(), onClose });

    const trip = await screen.findAllByRole('button', { name: /Trip/ });
    await fireEvent.click(trip[0]);

    await waitFor(() => expect(mockAdd).toHaveBeenCalledOnce());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('surfaces an error via handleError and stays open when collection fails', async () => {
    mockCollect.mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();
    render(SearchAddAllToCollectionModal, { ...baseProps(), onClose });

    const trip = await screen.findAllByRole('button', { name: /Trip/ });
    await fireEvent.click(trip[0]);

    await waitFor(() => expect(mockHandleError).toHaveBeenCalled());
    expect(mockAdd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('hides spaces and shows the over-cap notice when total exceeds the cap', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([{ id: 's1', name: 'Family' } as unknown as SharedSpaceResponseDto]);
    render(SearchAddAllToCollectionModal, { ...baseProps({ total: 50_001 }), onClose: vi.fn() });

    await screen.findByTestId('spaces-hidden-notice');
  });
});
