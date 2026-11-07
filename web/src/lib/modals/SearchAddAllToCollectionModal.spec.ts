import '#lib/gallery/__mocks__/sdk.mock.ts';
import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import type { AlbumResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

// The browser links every static import before any module body runs, so a static import of the
// component would load the real @immich/sdk before sdk.mock.ts registers its vi.mock. Loading it
// after that registration gives it the mocked module.
const { default: SearchAddAllToCollectionModal } = await import('./SearchAddAllToCollectionModal.svelte');

const { mockUser, mockAdd, mockCollect, mockHandleError } = vi.hoisted(() => ({
  mockUser: { current: { id: 'me', isAdmin: false } },
  mockAdd: vi.fn(),
  mockCollect: vi.fn(),
  mockHandleError: vi.fn(),
}));
vi.mock('#lib/services/collection.service.js', () => ({ addAssetsToCollections: mockAdd }));
vi.mock('#lib/services/search.service.js', () => ({ collectSearchResultAssetIds: mockCollect }));
vi.mock('#lib/utils/handle-error.js', () => ({ handleError: mockHandleError }));
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

const baseProps = (overrides = {}) => ({
  terms: {},
  total: 3,
  smartSearchEnabled: false,
  language: 'en',
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  mockUser.current = { id: 'me', isAdmin: false };
  mockAdd.mockResolvedValue(true);
  mockCollect.mockResolvedValue(['1', '2', '3']);
  sdkMock.getAllAlbums.mockImplementation(({ isShared }: { isShared?: boolean }) =>
    Promise.resolve(isShared ? [] : [album('a1', 'Trip')]),
  );
  sdkMock.getAllSpaces.mockResolvedValue([]);
});

describe('SearchAddAllToCollectionModal', () => {
  it('collects all matching ids then dispatches to the chosen collection and closes', async () => {
    const onClose = vi.fn();
    await render(SearchAddAllToCollectionModal, { ...baseProps({ terms: { isFavorite: true } }), onClose });

    const trip = await vi.waitFor(() => {
      const found = page.getByRole('button', { name: /Trip/ }).elements();
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    await userEvent.click(trip[0]);

    await vi.waitFor(() =>
      expect(mockCollect).toHaveBeenCalledWith({ isFavorite: true }, { smartSearchEnabled: false, language: 'en' }),
    );
    expect(mockAdd).toHaveBeenCalledWith([expect.objectContaining({ id: 'a1', kind: 'album' })], ['1', '2', '3']);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('shows the preparing indicator while collecting', async () => {
    let resolveCollect!: (ids: string[]) => void;
    mockCollect.mockReturnValue(new Promise<string[]>((resolve) => (resolveCollect = resolve)));
    await render(SearchAddAllToCollectionModal, { ...baseProps(), onClose: vi.fn() });

    const trip = await vi.waitFor(() => {
      const found = page.getByRole('button', { name: /Trip/ }).elements();
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    await userEvent.click(trip[0]);

    await vi.waitFor(() => page.getByTestId('preparing-indicator').element());
    resolveCollect(['1']);
  });

  it('closes without collecting or adding when dismissed', async () => {
    const onClose = vi.fn();
    await render(SearchAddAllToCollectionModal, { ...baseProps(), onClose });

    const close = await vi.waitFor(() => {
      const found = page.getByRole('button', { name: 'Close', exact: true }).elements();
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    await userEvent.click(close[0]);

    expect(mockCollect).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stays open when the add reports failure', async () => {
    mockAdd.mockResolvedValue(false);
    const onClose = vi.fn();
    await render(SearchAddAllToCollectionModal, { ...baseProps(), onClose });

    const trip = await vi.waitFor(() => {
      const found = page.getByRole('button', { name: /Trip/ }).elements();
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    await userEvent.click(trip[0]);

    await vi.waitFor(() => expect(mockAdd).toHaveBeenCalledOnce());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('surfaces an error via handleError and stays open when collection fails', async () => {
    mockCollect.mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();
    await render(SearchAddAllToCollectionModal, { ...baseProps(), onClose });

    const trip = await vi.waitFor(() => {
      const found = page.getByRole('button', { name: /Trip/ }).elements();
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    await userEvent.click(trip[0]);

    await vi.waitFor(() => expect(mockHandleError).toHaveBeenCalled());
    expect(mockAdd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('hides spaces and shows the over-cap notice when total exceeds the cap', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([{ id: 's1', name: 'Family' } as unknown as SharedSpaceResponseDto]);
    await render(SearchAddAllToCollectionModal, { ...baseProps({ total: 50_001 }), onClose: vi.fn() });

    await vi.waitFor(() => page.getByTestId('spaces-hidden-notice').element());
  });
});
