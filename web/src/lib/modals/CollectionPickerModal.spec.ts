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
// #965: a space with linked albums expands into "Add to space" plus one row per
// linked album, so a specific space album is reachable from every surface — the
// same accordion mobile's SpaceCollectionSection already offers.
// ---------------------------------------------------------------------------

describe('CollectionPickerModal — expanding a space into its albums', () => {
  const spaceWithAlbums = (id: string, name: string, albumCount: number) =>
    ({ ...space(id, name), albumCount }) as unknown as SharedSpaceResponseDto;
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

  // A space shows up in both RECENT and All, so every row lookup takes the first occurrence.
  const expandSpace = async (id: string) => {
    const rows = await screen.findAllByTestId(`row-space-${id}`);
    await fireEvent.click(within(rows[0]).getByTestId('space-row'));
  };

  it('marks a space with linked albums expandable without fetching them up front', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 2)]);
    render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });

    const rows = await screen.findAllByTestId('row-space-s1');
    expect(within(rows[0]).getByTestId('space-row').getAttribute('aria-expanded')).toBe('false');
    // The whole point of the accordion: albumCount already says it is expandable.
    expect(sdkMock.getSharedSpaceAlbums).not.toHaveBeenCalled();
  });

  it('fetches and lists the linked albums plus the pool child on expand', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 2)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Holiday'), linkedAlbum('sa2', 'Birthday')]);
    render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });

    await expandSpace('s1');

    await waitFor(() => expect(screen.getAllByTestId('row-album-sa1').length).toBeGreaterThan(0));
    expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledWith({ id: 's1' });
    expect(screen.getAllByTestId('row-album-sa2').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('space-pool-child-s1').length).toBeGreaterThan(0);
  });

  it('confirms with the linked album when one is chosen', async () => {
    const onClose = vi.fn();
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 1)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Holiday')]);
    render(CollectionPickerModal, { assetCount: 3, onClose });

    await expandSpace('s1');
    const albumRows = await screen.findAllByTestId('row-album-sa1');
    await fireEvent.click(within(albumRows[0]).getByRole('button', { name: /Holiday/ }));

    expect(onClose).toHaveBeenCalledWith([expect.objectContaining({ kind: 'album', id: 'sa1' })]);
  });

  it('confirms with the space itself when the pool child is chosen', async () => {
    const onClose = vi.fn();
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 1)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Holiday')]);
    render(CollectionPickerModal, { assetCount: 3, onClose });

    await expandSpace('s1');
    const poolRows = await screen.findAllByTestId('space-pool-child-s1');
    await fireEvent.click(poolRows[0]);

    expect(onClose).toHaveBeenCalledWith([expect.objectContaining({ kind: 'space', id: 's1' })]);
  });

  it('keeps one space open at a time and does not re-fetch a space it already loaded', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 1), spaceWithAlbums('s2', 'Friends', 1)]);
    sdkMock.getSharedSpaceAlbums.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(id === 's1' ? [linkedAlbum('sa1', 'Holiday')] : [linkedAlbum('sa2', 'Birthday')]),
    );
    render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });

    await expandSpace('s1');
    await waitFor(() => expect(screen.getAllByTestId('row-album-sa1').length).toBeGreaterThan(0));

    await expandSpace('s2');
    await waitFor(() => expect(screen.getAllByTestId('row-album-sa2').length).toBeGreaterThan(0));
    expect(screen.queryAllByTestId('row-album-sa1')).toHaveLength(0);

    await expandSpace('s1');
    await waitFor(() => expect(screen.getAllByTestId('row-album-sa1').length).toBeGreaterThan(0));
    expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledTimes(2); // s1 and s2, once each
  });

  it('collapses again on a second click', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 1)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Holiday')]);
    render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });

    await expandSpace('s1');
    await waitFor(() => expect(screen.getAllByTestId('row-album-sa1').length).toBeGreaterThan(0));
    await expandSpace('s1');
    await waitFor(() => expect(screen.queryAllByTestId('row-album-sa1')).toHaveLength(0));
  });

  it('still adds straight to the pool for a space with no linked albums', async () => {
    const onClose = vi.fn();
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 0)]);
    render(CollectionPickerModal, { assetCount: 3, onClose });

    await expandSpace('s1');

    expect(sdkMock.getSharedSpaceAlbums).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith([expect.objectContaining({ kind: 'space', id: 's1' })]);
  });

  // The caret is an index into a row list that changes shape when a space opens. Clearing it
  // (or leaving it pointing at a shifted row) stranded a keyboard user: they could open a space
  // and then had no way to arrow into the children they had just revealed.
  it('keeps the keyboard caret on the space row across expand and collapse', async () => {
    const onClose = vi.fn();
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 1)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Holiday')]);
    render(CollectionPickerModal, { assetCount: 3, onClose });
    await screen.findAllByTestId('row-space-s1');
    const search = screen.getByPlaceholderText('search');

    // NewAlbum, NewSpace, then the RECENT occurrence of the space.
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    await fireEvent.keyDown(search, { key: 'Enter' }); // expand
    await waitFor(() => expect(screen.getAllByTestId('row-album-sa1').length).toBeGreaterThan(0));

    // The very next ArrowDown must reach the pool child, not jump back to the top of the list.
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    await fireEvent.keyDown(search, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledWith([expect.objectContaining({ kind: 'space', id: 's1' })]);
  });

  it('reports a failed album load and leaves the row collapsed', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 2)]);
    sdkMock.getSharedSpaceAlbums.mockRejectedValue(new Error('boom'));
    render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });

    await expandSpace('s1');

    await waitFor(() => expect(mockHandleError).toHaveBeenCalledOnce());
    const rows = screen.getAllByTestId('row-space-s1');
    expect(within(rows[0]).getByTestId('space-row').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByTestId('space-pool-child-s1')).toHaveLength(0);
  });

  // A space-linked album owned by another member has no `album_user` row for the caller, so
  // `getAllAlbums` never returns it — it exists only in the expand-time cache. Resolving
  // multi-select keys against the album list alone dropped it and closed the modal as a cancel.
  it('multi-selects a linked album and actually submits it', async () => {
    const onClose = vi.fn();
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 1)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Holiday')]);
    render(CollectionPickerModal, { assetCount: 3, onClose });

    await expandSpace('s1');
    const albumRows = await screen.findAllByTestId('row-album-sa1');
    const albumRow = albumRows[0];
    await fireEvent.mouseEnter(within(albumRow).getByRole('group'));
    await fireEvent.click(within(albumRow).getByRole('checkbox'));
    await fireEvent.click(await screen.findByTestId('add-collections-button'));

    expect(onClose).toHaveBeenCalledWith([expect.objectContaining({ kind: 'album', id: 'sa1' })]);
  });

  it('multi-selects the pool child, and shows the tick on it', async () => {
    const onClose = vi.fn();
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 1)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Holiday')]);
    render(CollectionPickerModal, { assetCount: 3, onClose });

    await expandSpace('s1');
    const poolChildren = await screen.findAllByTestId('space-pool-child-s1');
    const poolRow = poolChildren[0].closest('[role="group"]') as HTMLElement;
    await fireEvent.mouseEnter(poolRow);
    await fireEvent.click(within(poolRow).getByRole('checkbox'));

    // The pool carries the space's own key, so the tick must be visible on the child too —
    // not merely computed in the row model.
    expect(within(poolRow).getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(await screen.findByTestId('add-collections-button'));
    expect(onClose).toHaveBeenCalledWith([expect.objectContaining({ kind: 'space', id: 's1' })]);
  });

  it('does not fire a second request when re-expanded while the first is still in flight', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 1)]);
    let resolveFetch: (albums: never[]) => void = () => {};
    sdkMock.getSharedSpaceAlbums.mockReturnValue(
      new Promise<never[]>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });

    await expandSpace('s1'); // fetch starts
    await expandSpace('s1'); // collapse
    await expandSpace('s1'); // re-expand before the first response lands
    resolveFetch([linkedAlbum('sa1', 'Holiday')]);

    await waitFor(() => expect(screen.getAllByTestId('row-album-sa1').length).toBeGreaterThan(0));
    expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledTimes(1);
  });

  it('says so when an expanded space turns out to have no linked albums', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 2)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([]);
    render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });

    await expandSpace('s1');

    // Raw i18n key in unit tests.
    await waitFor(() => expect(screen.getAllByText('no_albums_in_space_yet').length).toBeGreaterThan(0));
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
