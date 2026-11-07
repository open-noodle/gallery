// CollectionPickerModal.spec.ts — follows the house pattern (sdk.mock)
import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import { SharedSpaceRole, type AlbumResponseDto, type SharedSpaceResponseDto } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import CollectionPickerModal from './CollectionPickerModal.svelte';

const { mockUser, mockHandleError } = vi.hoisted(() => ({
  mockUser: { current: { id: 'me', isAdmin: false } },
  mockHandleError: vi.fn(),
}));
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
vi.mock('#lib/utils/handle-error.js', () => ({ handleError: mockHandleError }));

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
/** An album owned by someone else that the caller is a member of — `getAllAlbums` returns these too. */
// eslint-disable-next-line unicorn/no-unnecessary-parameters
const albumSharedWithMe = (id: string, name: string): AlbumResponseDto =>
  ({ ...album(id, name), ownerId: 'someone-else', shared: true }) as unknown as AlbumResponseDto;
/** A space created by someone else, with the caller holding `role` (or not a member at all). */
const spaceWhereIAm = (id: string, name: string, role: SharedSpaceRole | null): SharedSpaceResponseDto =>
  ({
    ...space(id, name),
    createdById: 'someone-else',
    members: role === null ? [] : [{ userId: 'me', role }],
  }) as unknown as SharedSpaceResponseDto;
const withAlbum = () =>
  sdkMock.getAllAlbums.mockImplementation(({ isShared }: { isShared?: boolean }) =>
    Promise.resolve(isShared ? [] : [album('a1', 'Trip')]),
  );

beforeEach(() => {
  vi.resetAllMocks();
  mockUser.current = { id: 'me', isAdmin: false };
  sdkMock.getAllAlbums.mockResolvedValue([]); // no albums, whatever the picker asks for
  sdkMock.getAllSpaces.mockResolvedValue([]);
});

describe('CollectionPickerModal', () => {
  it('renders album rows (with badge) and space rows after load', async () => {
    withAlbum();
    sdkMock.getAllSpaces.mockResolvedValue([space('s1', 'Family')]);
    await render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });
    // Albums and spaces appear in both RECENT and All sections, so use getAllByTestId.
    await expect.element(page.getByTestId('row-album-a1').first()).toBeInTheDocument();
    await expect.element(page.getByTestId('row-space-s1').first()).toBeInTheDocument();
    await expect.element(page.getByTestId('collection-row-badge').first()).toBeInTheDocument();
    await expect.element(page.getByTestId('space-row-badge').first()).toBeInTheDocument();
    // The album appears in BOTH Recent and All → proves RECENT section is rendered.
    expect(page.getByTestId('row-album-a1').elements()).toHaveLength(2);
  });

  it('clicking an album row confirms with that single collection', async () => {
    const onClose = vi.fn();
    withAlbum();
    await render(CollectionPickerModal, { assetCount: 3, onClose });
    // Album appears in both Recent and All sections; click the first occurrence.
    await userEvent.click(page.getByRole('button', { name: /Trip/ }).first());
    expect(onClose).toHaveBeenCalledWith([expect.objectContaining({ kind: 'album', id: 'a1' })]);
  });

  it('Ctrl/checkbox multi-select mixes album + space and submits all at once', async () => {
    const onClose = vi.fn();
    withAlbum();
    sdkMock.getAllSpaces.mockResolvedValue([space('s1', 'Family')]);
    await render(CollectionPickerModal, { assetCount: 3, onClose });
    // hover reveals each row's multi-select checkbox, then toggle both.
    // Album and space each appear in both Recent and All; use the first occurrence.
    const albumRow = page.getByTestId('row-album-a1').first();
    await userEvent.hover(albumRow.getByRole('group'));
    await userEvent.click(albumRow.getByRole('checkbox'));
    const spaceRow = page.getByTestId('row-space-s1').first();
    await userEvent.hover(spaceRow.getByRole('group'));
    await userEvent.click(spaceRow.getByRole('checkbox'));
    await userEvent.click(page.getByTestId('add-collections-button'));
    expect(onClose).toHaveBeenCalledTimes(1);
    const selected = onClose.mock.calls[0][0] as Array<{ kind: string }>;
    expect(selected).toHaveLength(2);
    expect(selected.map((c) => c.kind).sort()).toEqual(['album', 'space']);
  });

  it('hides spaces and shows a notice when over the cap', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([space('s1', 'Family')]);
    await render(CollectionPickerModal, { assetCount: 50_001, onClose: vi.fn() });
    await expect.element(page.getByTestId('spaces-hidden-notice')).toBeInTheDocument();
    expect(page.getByTestId('row-space-s1').query()).toBeNull();
    expect(page.getByTestId('new-space-row').query()).toBeNull();
  });

  // #1043: an album you own and have shared with someone matches every album query the picker
  // could make — owned, shared, unfiltered — so a picker that concatenates two of them listed
  // it twice, same thumbnail, same count. Adding an editor to an album must not clone its row.
  it('lists an album that is both owned and shared only once', async () => {
    sdkMock.getAllAlbums.mockImplementation(() => Promise.resolve([album('a1', 'Trip')]));
    await render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });
    await expect.element(page.getByTestId('row-album-a1').first()).toBeInTheDocument();
    // Exactly two rows: once under RECENT, once under All — never twice within a section.
    expect(page.getByTestId('row-album-a1').elements()).toHaveLength(2);
  });

  // The fetch this replaced pulled albums the caller does *not* own in through its second,
  // `isShared` query. The single unfiltered query has to carry them, or a member loses every
  // album they were invited to — the exact set the two queries used to return, minus the double.
  it('lists albums shared with the user alongside the ones they own', async () => {
    // Server semantics: `isOwned` keeps only albums the caller owns, `isShared` only shared
    // ones, and no filter returns both. Narrowing the query back down has to fail this test.
    sdkMock.getAllAlbums.mockImplementation(({ isOwned, isShared }: { isOwned?: boolean; isShared?: boolean }) => {
      const mine = album('a1', 'Trip');
      const theirs = albumSharedWithMe('a2', 'Familie');
      if (isOwned === true) {
        return Promise.resolve([mine]);
      }
      return Promise.resolve(isShared === true ? [theirs] : [mine, theirs]);
    });
    await render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });

    await expect.element(page.getByTestId('row-album-a1').first()).toBeInTheDocument();
    await expect.element(page.getByTestId('row-album-a2').first()).toBeInTheDocument();
  });

  it('asks for albums once, unfiltered — two filtered queries is what double-listed them', async () => {
    withAlbum();
    await render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });

    await expect.element(page.getByTestId('row-album-a1').first()).toBeInTheDocument();
    expect(sdkMock.getAllAlbums).toHaveBeenCalledTimes(1);
    expect(sdkMock.getAllAlbums).toHaveBeenCalledWith({});
  });

  it('shows an owned-and-shared album once when searching, where there is no RECENT section', async () => {
    sdkMock.getAllAlbums.mockImplementation(() => Promise.resolve([album('a1', 'Trip')]));
    await render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });
    await expect.element(page.getByTestId('row-album-a1').first()).toBeInTheDocument();

    await userEvent.fill(page.getByPlaceholder('search'), 'Tri');

    // Searching drops the RECENT section, so All is the only section left: exactly one row.
    await expect.poll(() => page.getByTestId('row-album-a1').elements()).toHaveLength(1);
  });

  // Space write access is decided here, not by the server's rejection after the fact: a space
  // the caller can only view is never a destination, so it must not appear as a row at all.
  it('offers only spaces the user owns or can edit', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([
      space('s1', 'Mine'), // created by me
      spaceWhereIAm('s2', 'Editing', SharedSpaceRole.Editor),
      spaceWhereIAm('s3', 'Co-owned', SharedSpaceRole.Owner),
      spaceWhereIAm('s4', 'Viewing', SharedSpaceRole.Viewer),
      spaceWhereIAm('s5', 'Stranger', null),
    ]);
    await render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });

    await expect.element(page.getByTestId('row-space-s1').first()).toBeInTheDocument();
    await expect.element(page.getByTestId('row-space-s2').first()).toBeInTheDocument();
    await expect.element(page.getByTestId('row-space-s3').first()).toBeInTheDocument();
    expect(page.getByTestId('row-space-s4').query()).toBeNull();
    expect(page.getByTestId('row-space-s5').query()).toBeNull();
  });

  it('reports an error and still renders albums when spaces fail to load', async () => {
    withAlbum();
    sdkMock.getAllSpaces.mockRejectedValue(new Error('boom'));
    await render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });
    await expect.element(page.getByTestId('row-album-a1').first()).toBeInTheDocument();
    expect(mockHandleError).toHaveBeenCalledOnce();
  });

  it('reports both errors and still shows the create rows when both loads fail', async () => {
    sdkMock.getAllAlbums.mockRejectedValue(new Error('albums down'));
    sdkMock.getAllSpaces.mockRejectedValue(new Error('spaces down'));
    await render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });
    await expect.element(page.getByTestId('new-space-row')).toBeInTheDocument();
    expect(mockHandleError).toHaveBeenCalledTimes(2);
    expect(page.getByTestId('row-album-a1').query()).toBeNull();
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
    await userEvent.click(page.getByTestId(`row-space-${id}`).first().getByTestId('space-row'));
  };

  it('marks a space with linked albums expandable without fetching them up front', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 2)]);
    await render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });

    await expect
      .element(page.getByTestId('row-space-s1').first().getByTestId('space-row'))
      .toHaveAttribute('aria-expanded', 'false');
    // The whole point of the accordion: albumCount already says it is expandable.
    expect(sdkMock.getSharedSpaceAlbums).not.toHaveBeenCalled();
  });

  it('fetches and lists the linked albums plus the pool child on expand', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 2)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Holiday'), linkedAlbum('sa2', 'Birthday')]);
    await render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });

    await expandSpace('s1');

    await expect.element(page.getByTestId('row-album-sa1').first()).toBeInTheDocument();
    expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledWith({ id: 's1' });
    await expect.element(page.getByTestId('row-album-sa2').first()).toBeInTheDocument();
    await expect.element(page.getByTestId('space-pool-child-s1').first()).toBeInTheDocument();
  });

  it('finds a linked album by search without expanding its space, fetching it only once (#1114)', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 1)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Sri Lanka New Year Trip')]);
    await render(CollectionPickerModal, { assetCount: 1, onClose: vi.fn() });
    await expect.element(page.getByTestId('row-space-s1').first()).toBeInTheDocument();
    expect(sdkMock.getSharedSpaceAlbums).not.toHaveBeenCalled();

    await userEvent.fill(page.getByPlaceholder('search'), 'Lanka');
    await expect.element(page.getByTestId('row-album-sa1').first()).toBeInTheDocument();

    await userEvent.fill(page.getByPlaceholder('search'), 'Lanka N');
    await expect.element(page.getByTestId('row-album-sa1').first()).toBeInTheDocument();
    expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledTimes(1);
  });

  it('keeps space-linked albums out of the unsearched list (#1114)', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 1)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Holiday')]);
    await render(CollectionPickerModal, { assetCount: 1, onClose: vi.fn() });
    await expect.element(page.getByTestId('row-space-s1').first()).toBeInTheDocument();

    await userEvent.fill(page.getByPlaceholder('search'), 'Holi');
    await expect.element(page.getByTestId('row-album-sa1').first()).toBeInTheDocument();
    await userEvent.fill(page.getByPlaceholder('search'), '');

    await expect.poll(() => page.getByTestId('row-album-sa1').elements()).toHaveLength(0);
  });

  it('confirms with the linked album when one is chosen', async () => {
    const onClose = vi.fn();
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 1)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Holiday')]);
    await render(CollectionPickerModal, { assetCount: 3, onClose });

    await expandSpace('s1');
    await userEvent.click(
      page
        .getByTestId('row-album-sa1')
        .first()
        .getByRole('button', { name: /Holiday/ }),
    );

    expect(onClose).toHaveBeenCalledWith([expect.objectContaining({ kind: 'album', id: 'sa1' })]);
  });

  it('confirms with the space itself when the pool child is chosen', async () => {
    const onClose = vi.fn();
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 1)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Holiday')]);
    await render(CollectionPickerModal, { assetCount: 3, onClose });

    await expandSpace('s1');
    await userEvent.click(page.getByTestId('space-pool-child-s1').first());

    expect(onClose).toHaveBeenCalledWith([expect.objectContaining({ kind: 'space', id: 's1' })]);
  });

  it('keeps one space open at a time and does not re-fetch a space it already loaded', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 1), spaceWithAlbums('s2', 'Friends', 1)]);
    sdkMock.getSharedSpaceAlbums.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(id === 's1' ? [linkedAlbum('sa1', 'Holiday')] : [linkedAlbum('sa2', 'Birthday')]),
    );
    await render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });

    await expandSpace('s1');
    await expect.element(page.getByTestId('row-album-sa1').first()).toBeInTheDocument();

    await expandSpace('s2');
    await expect.element(page.getByTestId('row-album-sa2').first()).toBeInTheDocument();
    expect(page.getByTestId('row-album-sa1').elements()).toHaveLength(0);

    await expandSpace('s1');
    await expect.element(page.getByTestId('row-album-sa1').first()).toBeInTheDocument();
    expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledTimes(2); // s1 and s2, once each
  });

  it('collapses again on a second click', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 1)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Holiday')]);
    await render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });

    await expandSpace('s1');
    await expect.element(page.getByTestId('row-album-sa1').first()).toBeInTheDocument();
    await expandSpace('s1');
    await expect.poll(() => page.getByTestId('row-album-sa1').elements()).toHaveLength(0);
  });

  it('still adds straight to the pool for a space with no linked albums', async () => {
    const onClose = vi.fn();
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 0)]);
    await render(CollectionPickerModal, { assetCount: 3, onClose });

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
    await render(CollectionPickerModal, { assetCount: 3, onClose });
    await expect.element(page.getByTestId('row-space-s1').first()).toBeInTheDocument();
    (page.getByPlaceholder('search').element() as HTMLElement).focus();

    // NewAlbum, NewSpace, then the RECENT occurrence of the space.
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Enter}'); // expand
    await expect.element(page.getByTestId('row-album-sa1').first()).toBeInTheDocument();

    // The very next ArrowDown must reach the pool child, not jump back to the top of the list.
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Enter}');
    expect(onClose).toHaveBeenCalledWith([expect.objectContaining({ kind: 'space', id: 's1' })]);
  });

  it('reports a failed album load and leaves the row collapsed', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 2)]);
    sdkMock.getSharedSpaceAlbums.mockRejectedValue(new Error('boom'));
    await render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });

    await expandSpace('s1');

    await vi.waitFor(() => expect(mockHandleError).toHaveBeenCalledOnce());
    await expect
      .element(page.getByTestId('row-space-s1').first().getByTestId('space-row'))
      .toHaveAttribute('aria-expanded', 'false');
    expect(page.getByTestId('space-pool-child-s1').elements()).toHaveLength(0);
  });

  // A space-linked album owned by another member has no `album_user` row for the caller, so
  // `getAllAlbums` never returns it — it exists only in the expand-time cache. Resolving
  // multi-select keys against the album list alone dropped it and closed the modal as a cancel.
  it('multi-selects a linked album and actually submits it', async () => {
    const onClose = vi.fn();
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 1)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Holiday')]);
    await render(CollectionPickerModal, { assetCount: 3, onClose });

    await expandSpace('s1');
    const albumRow = page.getByTestId('row-album-sa1').first();
    await userEvent.hover(albumRow.getByRole('group'));
    await userEvent.click(albumRow.getByRole('checkbox'));
    await userEvent.click(page.getByTestId('add-collections-button'));

    expect(onClose).toHaveBeenCalledWith([expect.objectContaining({ kind: 'album', id: 'sa1' })]);
  });

  it('multi-selects the pool child, and shows the tick on it', async () => {
    const onClose = vi.fn();
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 1)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Holiday')]);
    await render(CollectionPickerModal, { assetCount: 3, onClose });

    await expandSpace('s1');
    await expect.element(page.getByTestId('space-pool-child-s1').first()).toBeInTheDocument();
    const poolRow = page.elementLocator(
      page.getByTestId('space-pool-child-s1').first().element().closest('[role="group"]') as HTMLElement,
    );
    await userEvent.hover(poolRow);
    await userEvent.click(poolRow.getByRole('checkbox'));

    // The pool carries the space's own key, so the tick must be visible on the child too —
    // not merely computed in the row model.
    await expect.element(poolRow.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(page.getByTestId('add-collections-button'));
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
    await render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });

    await expandSpace('s1'); // fetch starts
    await expandSpace('s1'); // collapse
    await expandSpace('s1'); // re-expand before the first response lands
    resolveFetch([linkedAlbum('sa1', 'Holiday')]);

    await expect.element(page.getByTestId('row-album-sa1').first()).toBeInTheDocument();
    expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledTimes(1);
  });

  it('says so when an expanded space turns out to have no linked albums', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([spaceWithAlbums('s1', 'Family', 2)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([]);
    await render(CollectionPickerModal, { assetCount: 3, onClose: vi.fn() });

    await expandSpace('s1');

    // Raw i18n key in unit tests.
    await expect.element(page.getByText('no_albums_in_space_yet').first()).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Restricted mode: the selection contains assets the user does not own, so the
// only targets that can accept the whole selection are albums linked to THIS
// space (#764 contribution). Everything else is filtered out rather than
// offered and silently half-applied.
// ---------------------------------------------------------------------------

describe('CollectionPickerModal — restricted to a space', () => {
  // eslint-disable-next-line unicorn/no-unnecessary-parameters
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

  const renderRestricted = async (onClose = vi.fn()) =>
    render(CollectionPickerModal, { assetCount: 3, onClose, restrictToSpaceId: 'space-1' });

  it('lists the albums linked to that space instead of the user’s own albums', async () => {
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Space Trip')]);
    await renderRestricted();

    await expect.element(page.getByTestId('row-album-sa1').first()).toBeInTheDocument();
    expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledWith({ id: 'space-1' });
    expect(sdkMock.getAllAlbums).not.toHaveBeenCalled();
  });

  it('never offers spaces — no space pool accepts an asset the caller does not own', async () => {
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Space Trip')]);
    sdkMock.getAllSpaces.mockResolvedValue([space('s1', 'Family')]);
    await renderRestricted();

    await expect.element(page.getByTestId('row-album-sa1').first()).toBeInTheDocument();
    expect(sdkMock.getAllSpaces).not.toHaveBeenCalled();
    expect(page.getByTestId('row-space-s1').query()).toBeNull();
  });

  it('hides both create rows — a brand-new album is not space-linked, so contributions could not land in it', async () => {
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Space Trip')]);
    await renderRestricted();

    await expect.element(page.getByTestId('row-album-sa1').first()).toBeInTheDocument();
    expect(page.getByTestId('new-album-row').query()).toBeNull();
    expect(page.getByTestId('new-space-row').query()).toBeNull();
  });

  it('explains why the list is narrowed', async () => {
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Space Trip')]);
    await renderRestricted();

    await expect.element(page.getByTestId('restricted-to-space-notice')).toBeInTheDocument();
  });

  it('confirms with the chosen linked album', async () => {
    const onClose = vi.fn();
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Space Trip')]);
    await renderRestricted(onClose);

    await userEvent.click(page.getByRole('button', { name: /Space Trip/ }).first());
    expect(onClose).toHaveBeenCalledWith([expect.objectContaining({ kind: 'album', id: 'sa1' })]);
  });

  it('explains the empty state in space terms when the space has no linked albums', async () => {
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([]);
    await renderRestricted();

    // Rendered as the raw i18n key in unit tests. The default wording ("no albums or spaces")
    // names a collection type that is never on offer in this mode.
    await expect.element(page.getByText('no_albums_in_space_yet')).toBeInTheDocument();
    expect(page.getByText('no_albums_or_spaces_yet').query()).toBeNull();
  });

  it('reports an error when the space albums fail to load', async () => {
    sdkMock.getSharedSpaceAlbums.mockRejectedValue(new Error('boom'));
    await renderRestricted();

    await vi.waitFor(() => expect(mockHandleError).toHaveBeenCalledOnce());
    expect(page.getByTestId('new-album-row').query()).toBeNull();
  });
});

describe('CollectionPickerModal — valid targets for a known selection', () => {
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

  const renderWithSelection = async (assetIds: string[]) =>
    render(CollectionPickerModal, { props: { assetCount: assetIds.length, assetIds, onClose: vi.fn() } });

  it('hides albums that accept none of an owned selection, and shows no hint', async () => {
    sdkMock.getAllAlbums.mockResolvedValue([album('a1', 'Trip'), albumSharedWithMe('a2', 'Viewer only')]);
    sdkMock.getAllSpaces.mockResolvedValue([space('s1', 'Family')]);
    sdkMock.getAlbumAddTargets.mockResolvedValue({
      albums: [{ albumId: 'a1', acceptedAssetCount: 1 }],
      shareableAssetCount: 1,
    });

    await renderWithSelection(['mine']);

    await expect.element(page.getByTestId('row-album-a1').first()).toBeInTheDocument();
    expect(page.getByTestId('row-album-a2').query()).toBeNull();
    await expect.element(page.getByTestId('row-space-s1').first()).toBeInTheDocument();
    expect(page.getByTestId('non-owned-space-albums-only-notice').query()).toBeNull();
    expect(sdkMock.getAlbumAddTargets).toHaveBeenCalledWith({
      albumAddTargetsDto: { albumIds: ['a1', 'a2'], assetIds: ['mine'] },
    });
  });

  it("another member's photo: offers only accepting space-linked albums, hides spaces and New album, shows the hint", async () => {
    sdkMock.getAllAlbums.mockResolvedValue([album('personal', 'Personal')]);
    sdkMock.getAllSpaces.mockResolvedValue([spaceWhereIAm('s1', 'Family', SharedSpaceRole.Editor)]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([linkedAlbum('sa1', 'Holiday'), linkedAlbum('sa2', 'Other')]);
    sdkMock.getAlbumAddTargets.mockImplementation(({ albumAddTargetsDto }) =>
      Promise.resolve({
        albums: albumAddTargetsDto.albumIds.includes('sa1') ? [{ albumId: 'sa1', acceptedAssetCount: 1 }] : [],
        shareableAssetCount: 0,
      }),
    );

    await renderWithSelection(['theirs']);

    await expect.element(page.getByTestId('row-album-sa1').first()).toBeInTheDocument();
    expect(page.getByTestId('row-album-sa2').query()).toBeNull();
    expect(page.getByTestId('row-album-personal').query()).toBeNull();
    expect(page.getByTestId('row-space-s1').query()).toBeNull();
    expect(page.getByTestId('new-album-row').query()).toBeNull();
    await expect.element(page.getByTestId('non-owned-space-albums-only-notice')).toBeInTheDocument();
    await expect.element(page.getByText('add_to_collection_non_owned_space_albums_only')).toBeInTheDocument();
  });

  it('mixed selection keeps personal albums that take the owned part, and New album', async () => {
    sdkMock.getAllAlbums.mockResolvedValue([album('personal', 'Personal')]);
    sdkMock.getAllSpaces.mockResolvedValue([]);
    sdkMock.getAlbumAddTargets.mockResolvedValue({
      albums: [{ albumId: 'personal', acceptedAssetCount: 1 }],
      shareableAssetCount: 1,
    });

    await renderWithSelection(['mine', 'theirs']);

    await expect.element(page.getByTestId('non-owned-space-albums-only-notice')).toBeInTheDocument();
    await expect.element(page.getByTestId('row-album-personal').first()).toBeInTheDocument();
    await expect.element(page.getByTestId('new-album-row')).toBeInTheDocument();
  });

  it('falls back to the unfiltered list when the targets request fails', async () => {
    sdkMock.getAllAlbums.mockResolvedValue([album('a1', 'Trip')]);
    sdkMock.getAlbumAddTargets.mockRejectedValue(new Error('old server'));

    await renderWithSelection(['x']);

    await expect.element(page.getByTestId('row-album-a1').first()).toBeInTheDocument();
    expect(page.getByTestId('non-owned-space-albums-only-notice').query()).toBeNull();
  });
});
