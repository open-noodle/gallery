// CollectionPickerModal.spec.ts — follows the house pattern (sdk.mock + Modal global stubs)
import { type AlbumResponseDto, type SharedSpaceResponseDto } from '@immich/sdk';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import '$lib/__mocks__/sdk.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import CollectionPickerModal from './CollectionPickerModal.svelte';

const { mockUser, mockHandleError } = vi.hoisted(() => ({
  mockUser: { current: { id: 'me', isAdmin: false } },
  mockHandleError: vi.fn(),
}));
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
vi.mock('$lib/utils/handle-error', () => ({ handleError: mockHandleError }));

const album = (id: string, name: string): AlbumResponseDto =>
  ({
    id,
    albumName: name,
    assetCount: 1,
    albumThumbnailAssetId: null,
    shared: false,
    updatedAt: '2024-01-01T00:00:00Z',
  }) as unknown as AlbumResponseDto;
const space = (id: string, name: string): SharedSpaceResponseDto =>
  ({
    id,
    name,
    createdById: 'me',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    members: [],
    memberCount: 1,
    assetCount: 1,
    recentAssetIds: [],
  }) as unknown as SharedSpaceResponseDto;
const withAlbum = () =>
  sdkMock.getAllAlbums.mockImplementation(({ isShared }: { isShared?: boolean }) =>
    Promise.resolve(isShared ? [] : [album('a1', 'Trip')]),
  );

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
  vi.stubGlobal('visualViewport', getVisualViewportMock());
  Element.prototype.animate = getAnimateMock();
  vi.resetAllMocks();
  mockUser.current = { id: 'me', isAdmin: false };
  sdkMock.getAllAlbums.mockResolvedValue([]); // both shared:false and shared:true resolve to []
  sdkMock.getAllSpaces.mockResolvedValue([]);
});

afterAll(async () => {
  await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'));
});

describe('CollectionPickerModal', () => {
  it('renders album rows (with badge) and space rows after load', async () => {
    withAlbum();
    sdkMock.getAllSpaces.mockResolvedValue([space('s1', 'Family')]);
    render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });
    // Albums and spaces appear in both RECENT and All sections, so use getAllByTestId.
    await waitFor(() => expect(screen.getAllByTestId('row-album-a1').length).toBeGreaterThan(0));
    expect(screen.getAllByTestId('row-space-s1').length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId('collection-row-badge').length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId('space-row-badge').length).toBeGreaterThan(0);
    // The album appears in BOTH Recent and All → proves RECENT section is rendered.
    expect(screen.getAllByTestId('row-album-a1')).toHaveLength(2);
  });

  it('clicking an album row confirms with that single collection', async () => {
    const onClose = vi.fn();
    withAlbum();
    render(CollectionPickerModal, { assetCount: 3, onClose });
    // Album appears in both Recent and All sections; click the first occurrence.
    const rows = await screen.findAllByRole('button', { name: /Trip/ });
    await fireEvent.click(rows[0]);
    expect(onClose).toHaveBeenCalledWith([expect.objectContaining({ kind: 'album', id: 'a1' })]);
  });

  it('Ctrl/checkbox multi-select mixes album + space and submits all at once', async () => {
    const onClose = vi.fn();
    withAlbum();
    sdkMock.getAllSpaces.mockResolvedValue([space('s1', 'Family')]);
    render(CollectionPickerModal, { assetCount: 3, onClose });
    // hover reveals each row's multi-select checkbox, then toggle both.
    // Album and space each appear in both Recent and All; use the first occurrence.
    const albumRows = await screen.findAllByTestId('row-album-a1');
    const albumRow = albumRows[0];
    await fireEvent.mouseEnter(within(albumRow).getByRole('group'));
    await fireEvent.click(within(albumRow).getByRole('checkbox'));
    const spaceRow = screen.getAllByTestId('row-space-s1')[0];
    await fireEvent.mouseEnter(within(spaceRow).getByRole('group'));
    await fireEvent.click(within(spaceRow).getByRole('checkbox'));
    await fireEvent.click(await screen.findByTestId('add-collections-button'));
    expect(onClose).toHaveBeenCalledTimes(1);
    const selected = onClose.mock.calls[0][0] as Array<{ kind: string }>;
    expect(selected).toHaveLength(2);
    expect(selected.map((c) => c.kind).sort()).toEqual(['album', 'space']);
  });

  it('hides spaces and shows a notice when over the cap', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([space('s1', 'Family')]);
    render(CollectionPickerModal, { assetCount: 50_001, onClose: vi.fn() });
    await waitFor(() => expect(screen.getByTestId('spaces-hidden-notice')).toBeTruthy());
    expect(screen.queryByTestId('row-space-s1')).toBeNull();
    expect(screen.queryByTestId('new-space-row')).toBeNull();
  });

  it('reports an error and still renders albums when spaces fail to load', async () => {
    withAlbum();
    sdkMock.getAllSpaces.mockRejectedValue(new Error('boom'));
    render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });
    await waitFor(() => expect(screen.getAllByTestId('row-album-a1').length).toBeGreaterThan(0));
    expect(mockHandleError).toHaveBeenCalledOnce();
  });

  it('reports both errors and still shows the create rows when both loads fail', async () => {
    sdkMock.getAllAlbums.mockRejectedValue(new Error('albums down'));
    sdkMock.getAllSpaces.mockRejectedValue(new Error('spaces down'));
    render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });
    await waitFor(() => expect(screen.getByTestId('new-space-row')).toBeTruthy());
    expect(mockHandleError).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('row-album-a1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Restricted mode: the selection contains assets the user does not own, so the
// only targets that can accept the whole selection are albums linked to THIS
// space (#764 contribution). Everything else is filtered out rather than
// offered and silently half-applied.
// ---------------------------------------------------------------------------

describe('CollectionPickerModal — restricted to a space', () => {
  const linkedAlbum = (id: string, name: string) =>
    ({
      id,
      albumName: name,
      assetCount: 2,
      albumThumbnailAssetId: null,
      shared: true,
      updatedAt: '2024-01-01T00:00:00Z',
      ownerId: 'someone-else',
      showInTimeline: true,
      addedById: 'me',
      linkedAt: '2024-01-01T00:00:00Z',
    }) as never;

  const renderRestricted = (onClose = vi.fn()) =>
    render(CollectionPickerModal, { assetCount: 3, onClose, restrictToSpaceId: 'space-1' });

  it('lists the albums linked to that space instead of the user’s own albums', async () => {
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Space Trip')]);
    renderRestricted();

    await waitFor(() => expect(screen.getAllByTestId('row-album-sa1').length).toBeGreaterThan(0));
    expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledWith({ id: 'space-1' });
    expect(sdkMock.getAllAlbums).not.toHaveBeenCalled();
  });

  it('never offers spaces — no space pool accepts an asset the caller does not own', async () => {
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Space Trip')]);
    sdkMock.getAllSpaces.mockResolvedValue([space('s1', 'Family')]);
    renderRestricted();

    await waitFor(() => expect(screen.getAllByTestId('row-album-sa1').length).toBeGreaterThan(0));
    expect(sdkMock.getAllSpaces).not.toHaveBeenCalled();
    expect(screen.queryByTestId('row-space-s1')).toBeNull();
  });

  it('hides both create rows — a brand-new album is not space-linked, so contributions could not land in it', async () => {
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Space Trip')]);
    renderRestricted();

    await waitFor(() => expect(screen.getAllByTestId('row-album-sa1').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('new-album-row')).toBeNull();
    expect(screen.queryByTestId('new-space-row')).toBeNull();
  });

  it('explains why the list is narrowed', async () => {
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Space Trip')]);
    renderRestricted();

    await waitFor(() => expect(screen.getByTestId('restricted-to-space-notice')).toBeTruthy());
  });

  it('confirms with the chosen linked album', async () => {
    const onClose = vi.fn();
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Space Trip')]);
    renderRestricted(onClose);

    const rows = await screen.findAllByRole('button', { name: /Space Trip/ });
    await fireEvent.click(rows[0]);
    expect(onClose).toHaveBeenCalledWith([expect.objectContaining({ kind: 'album', id: 'sa1' })]);
  });

  it('explains the empty state in space terms when the space has no linked albums', async () => {
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([]);
    renderRestricted();

    // Rendered as the raw i18n key in unit tests. The default wording ("no albums or spaces")
    // names a collection type that is never on offer in this mode.
    await waitFor(() => expect(screen.getByText('no_albums_in_space_yet')).toBeTruthy());
    expect(screen.queryByText('no_albums_or_spaces_yet')).toBeNull();
  });

  it('reports an error when the space albums fail to load', async () => {
    sdkMock.getSharedSpaceAlbums.mockRejectedValue(new Error('boom'));
    renderRestricted();

    await waitFor(() => expect(mockHandleError).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('new-album-row')).toBeNull();
  });
});
