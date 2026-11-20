import '#lib/gallery/__mocks__/sdk.mock.ts';
import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import type { AlbumResponseDto, PartnerResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import { addMessages } from 'svelte-i18n';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

// The browser links every static import before any module body runs, so a static import of the
// component would load the real @immich/sdk before sdk.mock.ts registers its vi.mock. Loading it
// after that registration gives it the mocked module.
const { default: SearchAddAllToCollectionModal } = await import('./SearchAddAllToCollectionModal.svelte');
const { AssetVisibility, PartnerDirection } = await import('@immich/sdk');

const { mockUser, mockAdd, mockCollect, mockHandleError } = vi.hoisted(() => ({
  mockUser: { current: { id: 'me', isAdmin: false } },
  mockAdd: vi.fn(),
  mockCollect: vi.fn(),
  mockHandleError: vi.fn(),
}));
vi.mock('#lib/services/collection.service.js', () => ({ addAssetsToCollections: mockAdd }));
vi.mock('#lib/services/search.service.js', () => ({ collectSearchResultAssets: mockCollect }));
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

// Unit specs run without message bundles ($t returns the key), so give this key a message that shows the count.
addMessages('dev', { spaces_skipped_unshareable_assets: 'skipped {count}' });

const asset = (id: string, ownerId: string, visibility = AssetVisibility.Timeline) => ({ id, ownerId, visibility });

const family = {
  id: 's1',
  name: 'Family',
  createdById: 'me',
  members: [],
  memberCount: 1,
  assetCount: 1,
  recentAssetIds: [],
} as unknown as SharedSpaceResponseDto;

const pick = async (name: RegExp) => {
  const found = await vi.waitFor(() => {
    const rows = page.getByRole('button', { name }).elements();
    expect(rows.length).toBeGreaterThan(0);
    return rows;
  });
  await userEvent.click(found[0]);
};

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
  mockCollect.mockResolvedValue([asset('1', 'me'), asset('2', 'me'), asset('3', 'me')]);
  vi.spyOn(toastManager, 'warning').mockImplementation(() => ({}) as never);
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
    // No space chosen: nothing is resolved for spaces and the partner list is never loaded.
    expect(mockAdd).toHaveBeenCalledWith([expect.objectContaining({ id: 'a1', kind: 'album' })], ['1', '2', '3'], {
      spaceAssetIds: [],
    });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(sdkMock.getPartners).not.toHaveBeenCalled();
    expect(toastManager.warning).not.toHaveBeenCalled();
  });

  it('shows the preparing indicator while collecting', async () => {
    let resolveCollect!: (assets: unknown[]) => void;
    mockCollect.mockReturnValue(new Promise<unknown[]>((resolve) => (resolveCollect = resolve)));
    await render(SearchAddAllToCollectionModal, { ...baseProps(), onClose: vi.fn() });

    const trip = await vi.waitFor(() => {
      const found = page.getByRole('button', { name: /Trip/ }).elements();
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    await userEvent.click(trip[0]);

    await vi.waitFor(() => page.getByTestId('preparing-indicator').element());
    resolveCollect([asset('1', 'me')]);
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

  it('gives an album every asset, including other users’ ones, without a warning', async () => {
    mockCollect.mockResolvedValue([asset('1', 'me'), asset('2', 'x1')]);
    const onClose = vi.fn();
    await render(SearchAddAllToCollectionModal, { ...baseProps(), onClose });
    await pick(/Trip/);

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mockAdd).toHaveBeenCalledWith([expect.objectContaining({ id: 'a1' })], ['1', '2'], { spaceAssetIds: [] });
    expect(toastManager.warning).not.toHaveBeenCalled();
  });

  it('gives a space the caller’s and partners’ assets, drops the rest, and says how many were left out', async () => {
    // #1259: a stranger's asset (reached through a shared space) made the whole space add fail with a 400.
    mockCollect.mockResolvedValue([
      asset('1', 'me'),
      asset('2', 'x1'),
      asset('3', 'p1'),
      asset('4', 'p1', AssetVisibility.Archive),
      asset('5', 'me', AssetVisibility.Archive),
    ]);
    sdkMock.getPartners.mockResolvedValue([{ id: 'p1' } as PartnerResponseDto]);
    sdkMock.getAllSpaces.mockResolvedValue([family]);
    const onClose = vi.fn();
    await render(SearchAddAllToCollectionModal, { ...baseProps({ total: 5 }), onClose });
    await pick(/Family/);

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(sdkMock.getPartners).toHaveBeenCalledWith({ direction: PartnerDirection.SharedWith });
    expect(mockAdd).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 's1', kind: 'space' })],
      ['1', '2', '3', '4', '5'],
      { spaceAssetIds: ['1', '3', '5'] },
    );
    expect(toastManager.warning).toHaveBeenCalledExactlyOnceWith('skipped 2');
  });

  it('adds own and partner assets to a space without a warning when nothing is left out', async () => {
    mockCollect.mockResolvedValue([asset('1', 'me'), asset('2', 'p1', AssetVisibility.Hidden)]);
    sdkMock.getPartners.mockResolvedValue([{ id: 'p1' } as PartnerResponseDto]);
    sdkMock.getAllSpaces.mockResolvedValue([family]);
    const onClose = vi.fn();
    await render(SearchAddAllToCollectionModal, { ...baseProps({ total: 2 }), onClose });
    await pick(/Family/);

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mockAdd).toHaveBeenCalledWith([expect.objectContaining({ id: 's1' })], ['1', '2'], {
      spaceAssetIds: ['1', '2'],
    });
    expect(toastManager.warning).not.toHaveBeenCalled();
  });

  it('warns instead of closing silently when no asset can go to the space', async () => {
    mockCollect.mockResolvedValue([asset('1', 'x1')]);
    sdkMock.getPartners.mockResolvedValue([]);
    sdkMock.getAllSpaces.mockResolvedValue([family]);
    const onClose = vi.fn();
    await render(SearchAddAllToCollectionModal, { ...baseProps({ total: 1 }), onClose });
    await pick(/Family/);

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mockAdd).toHaveBeenCalledWith([expect.objectContaining({ id: 's1' })], ['1'], { spaceAssetIds: [] });
    expect(toastManager.warning).toHaveBeenCalledExactlyOnceWith('skipped 1');
  });

  it('does not warn when the add itself fails', async () => {
    mockAdd.mockResolvedValue(false);
    mockCollect.mockResolvedValue([asset('1', 'me'), asset('2', 'x1')]);
    sdkMock.getPartners.mockResolvedValue([]);
    sdkMock.getAllSpaces.mockResolvedValue([family]);
    const onClose = vi.fn();
    await render(SearchAddAllToCollectionModal, { ...baseProps({ total: 2 }), onClose });
    await pick(/Family/);

    await vi.waitFor(() => expect(mockAdd).toHaveBeenCalledOnce());
    expect(onClose).not.toHaveBeenCalled();
    expect(toastManager.warning).not.toHaveBeenCalled();
  });
});
