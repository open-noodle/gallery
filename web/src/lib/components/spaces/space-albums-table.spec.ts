import SpaceAlbumsTable from '#lib/components/spaces/space-albums-table.svelte';
import { SpaceAlbumGroupBy, spaceAlbumViewSettings } from '#lib/stores/space-album-view-settings.store.ts';
import { toggleAlbumGroupCollapsing } from '#lib/utils/album-utils.ts';
import { getSpaceAlbumSortLabels, spaceAlbumSortOptionsMetadata } from '#lib/utils/space-album-sort.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import type { SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import { init, register, t, waitLocale } from 'svelte-i18n';
import { get } from 'svelte/store';
import { page, userEvent } from 'vitest/browser';

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  const { default: MockContextMenuButton } = await import('#lib/gallery/__mocks__/action-context-menu.stub.svelte');
  return { ...original, ContextMenuButton: MockContextMenuButton };
});

function makeAlbum(overrides: Partial<SharedSpaceLinkedAlbumDto> = {}): SharedSpaceLinkedAlbumDto {
  return {
    id: 'album-1',
    ownerId: 'owner-1',
    albumName: 'Vacation',
    assetCount: 5,
    albumThumbnailAssetId: null,
    folderId: null,
    showInTimeline: true,
    hiddenFromMyTimeline: false,
    addedById: null,
    linkedAt: '2026-01-01T00:00:00.000Z',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    shared: false,
    hasSharedLink: false,
    isActivityEnabled: false,
    ...overrides,
  };
}

// The header cells, by element: the header row is `display: flex`, which takes the cells out of
// the role lookup's table structure, so `getByRole('columnheader')` finds none of them.
const columnHeaders = () => [...document.querySelectorAll('thead th')];

describe('SpaceAlbumsTable', () => {
  beforeAll(async () => {
    register('en-US', () => import('#i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  const a1 = makeAlbum({ id: 'a-1', albumName: 'Vacation', assetCount: 5 });
  const a2 = makeAlbum({ id: 'a-2', albumName: 'Road Trip', assetCount: 10 });

  it('renders a linking row per album to the space album route', async () => {
    await renderWithTooltips(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1, a2], canManage: false });
    expect(page.getByTestId(`space-album-row-${a1.id}`).element()).toHaveAttribute('href', '/spaces/s-1/albums/a-1');
    expect(page.getByText('Vacation', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByText(/5 items/i).element()).toBeInTheDocument();
  });

  it('shows the row menu for both an editor and a viewer (the "my timeline" item is not editor-gated)', async () => {
    await renderWithTooltips(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: true });
    expect(page.getByTestId(`space-album-row-menu-${a1.id}`).element()).toBeInTheDocument();
  });

  it('still shows the row menu when canManage is false — just without the editor-only items', async () => {
    await renderWithTooltips(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: false });
    expect(page.getByTestId(`space-album-row-menu-${a1.id}`).element()).toBeInTheDocument();
  });

  it('when canManage=false, only the my-timeline item is present — the editor-only items are hidden', async () => {
    await renderWithTooltips(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: false });
    const menu = page.getByTestId(`space-album-row-menu-${a1.id}`).element();
    await userEvent.click(page.elementLocator(menu).getByLabelText(/more/i));
    expect(
      await vi.waitFor(() => page.getByText('Hide this album from my timeline', { exact: true }).element()),
    ).toBeInTheDocument();
    expect(page.getByText("Hide this album from the space's photos", { exact: true }).query()).not.toBeInTheDocument();
    expect(page.getByText('Unlink album', { exact: true }).query()).not.toBeInTheDocument();
  });

  it('renders all albums as rows', async () => {
    await renderWithTooltips(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1, a2], canManage: false });
    expect(page.getByTestId('space-album-row-a-1').element()).toBeInTheDocument();
    expect(page.getByTestId('space-album-row-a-2').element()).toBeInTheDocument();
  });

  describe('folder rows', () => {
    const folder = (id: string, name: string, parentId: string | null = null) => ({
      id,
      spaceId: 's-1',
      parentId,
      name,
      createdById: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    // The folder row must be reachable the same way an album row is. It used to be a bare
    // `<tr onclick>`: openable with a mouse, invisible to the keyboard and to a screen reader,
    // in a table whose album rows are all anchors.
    it('renders the folder name as a real link to the folder URL', async () => {
      await renderWithTooltips(SpaceAlbumsTable, {
        spaceId: 's-1',
        albums: [],
        allAlbums: [],
        folders: [folder('f-1', 'Trips')],
        currentFolderId: null,
        canManage: false,
      });

      expect(page.getByTestId('space-album-folder-link-f-1').element()).toHaveAttribute(
        'href',
        '/spaces/s-1/albums?folder=f-1',
      );
    });

    it('opens the folder through the callback instead of a full navigation', async () => {
      const onOpenFolder = vi.fn();
      await renderWithTooltips(SpaceAlbumsTable, {
        spaceId: 's-1',
        albums: [],
        allAlbums: [],
        folders: [folder('f-1', 'Trips')],
        currentFolderId: null,
        canManage: false,
        onOpenFolder,
      });

      await userEvent.click(page.getByTestId('space-album-folder-link-f-1'));

      expect(onOpenFolder).toHaveBeenCalledWith(expect.objectContaining({ id: 'f-1' }));
    });

    // The count is recursive: albums filed in a descendant folder still count toward the parent.
    // Reading it from the shared summary map must not change that.
    it('shows the recursive album count, including albums in a nested folder', async () => {
      await renderWithTooltips(SpaceAlbumsTable, {
        spaceId: 's-1',
        albums: [],
        allAlbums: [
          makeAlbum({ id: 'a-1', albumName: 'Rome', folderId: 'f-1' }),
          makeAlbum({ id: 'a-2', albumName: 'Milan', folderId: 'f-2' }),
          makeAlbum({ id: 'a-3', albumName: 'Unfiled', folderId: null }),
        ],
        folders: [folder('f-1', 'Trips'), folder('f-2', '2026', 'f-1')],
        currentFolderId: null,
        canManage: false,
      });

      expect(page.getByText('2 albums', { exact: true }).element()).toBeInTheDocument();
    });
  });

  describe('grouped rendering', () => {
    beforeEach(() => {
      localStorage.clear();
      spaceAlbumViewSettings.reset();
    });

    it('renders a collapsible header per group with name and count', async () => {
      spaceAlbumViewSettings.update((s) => ({ ...s, groupBy: SpaceAlbumGroupBy.Year }));
      const groups = [
        { id: '2024', name: '2024', albums: [a1] },
        { id: '2020', name: '2020', albums: [a2] },
      ];
      await renderWithTooltips(SpaceAlbumsTable, {
        spaceId: 's-1',
        albums: [a1, a2],
        canManage: false,
        groups,
        grouped: true,
      });
      const header2024 = page.getByTestId('space-album-group-header-2024').element();
      expect(header2024).toMatchTextContent('2024');
      expect(header2024).toMatchTextContent('1');
      expect(page.getByTestId('space-album-group-header-2020').element()).toMatchTextContent('2020');
      expect(page.getByTestId('space-album-row-a-1').element()).toBeInTheDocument();
      expect(page.getByTestId('space-album-row-a-2').element()).toBeInTheDocument();
    });

    it('collapsing a group marks its header collapsed and hides its rows', async () => {
      spaceAlbumViewSettings.update((s) => ({ ...s, groupBy: SpaceAlbumGroupBy.Year }));
      const groups = [
        { id: '2024', name: '2024', albums: [a1] },
        { id: '2020', name: '2020', albums: [a2] },
      ];
      await renderWithTooltips(SpaceAlbumsTable, {
        spaceId: 's-1',
        albums: [a1, a2],
        canManage: false,
        groups,
        grouped: true,
      });
      expect(page.getByTestId('space-album-group-header-2024').element()).toHaveAttribute('aria-expanded', 'true');
      toggleAlbumGroupCollapsing('2024', spaceAlbumViewSettings);
      await vi.waitFor(() =>
        expect(page.getByTestId('space-album-group-header-2024').element()).toHaveAttribute('aria-expanded', 'false'),
      );
    });
  });

  it('labels the item-count column with a proper header, not a stripped plural', async () => {
    await renderWithTooltips(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: false });

    const headerTexts = columnHeaders().map((header) => header.textContent?.trim());

    expect(headerTexts).toContain('Number of items');
    // The bug rendered the bare fragment; assert on the exact string so a
    // substring match cannot pass against it.
    expect(headerTexts).not.toContain('items');
  });

  describe('sortable headers (#972)', () => {
    beforeEach(() => {
      spaceAlbumViewSettings.update((settings) => ({ ...settings, sortBy: 'RecentlyLinked', sortOrder: 'desc' }));
    });

    it('renders every sort option as a header button, like /albums', async () => {
      await renderWithTooltips(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: false });

      const buttons = columnHeaders()
        .map((header) => header.querySelector('button')?.textContent?.replaceAll(/[↓↑]/g, '').trim())
        .filter(Boolean);

      // The same labels, in the same order, as the space's sort menu.
      const labels = getSpaceAlbumSortLabels(get(t));
      expect(buttons).toEqual(spaceAlbumSortOptionsMetadata.map(({ id }) => labels[id]));
      expect(buttons).toHaveLength(7);
    });

    it('sorts by a header on click, with its default direction, and flips it on a second click', async () => {
      await renderWithTooltips(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: false });
      const title = page
        .elementLocator(page.getByTestId('space-albums-table-header-Title').element())
        .getByRole('button')
        .element();

      await userEvent.click(title);
      expect(get(spaceAlbumViewSettings)).toMatchObject({ sortBy: 'Title', sortOrder: 'asc' });

      await userEvent.click(title);
      expect(get(spaceAlbumViewSettings)).toMatchObject({ sortBy: 'Title', sortOrder: 'desc' });
    });

    it('marks the active column with its direction', async () => {
      await renderWithTooltips(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: false });

      expect(page.getByTestId('space-albums-table-header-RecentlyLinked').element().textContent).toContain('↓');
      expect(page.getByTestId('space-albums-table-header-Title').element().textContent).not.toMatch(/[↓↑]/);
    });

    it('fills the photo-date columns, with a dash when the album has no photos', async () => {
      const withPhotos = makeAlbum({
        id: 'a-3',
        startDate: '2019-01-01T00:00:00.000Z',
        endDate: '2023-07-01T00:00:00.000Z',
      });
      const empty = makeAlbum({ id: 'a-4', assetCount: 0 });
      await renderWithTooltips(SpaceAlbumsTable, { spaceId: 's-1', albums: [withPhotos, empty], canManage: false });

      const cells = (id: string) =>
        [...page.getByTestId(`space-album-row-${id}`).element().closest('tr')!.querySelectorAll('td')].map((td) =>
          td.textContent?.trim(),
        );
      // Title, items, modified, created, most recent, oldest, linked, menu
      expect(cells('a-3')[4]).toMatch(/2023/);
      expect(cells('a-3')[5]).toMatch(/2019/);
      expect(cells('a-3')[6]).toMatch(/2026/);
      expect(cells('a-4')[4]).toBe('-');
      expect(cells('a-4')[5]).toBe('-');
    });
  });

  it('gives the item-count column header a base width so the longer label does not wrap', async () => {
    await renderWithTooltips(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: false });

    const header = columnHeaders().find((candidate) => candidate.textContent?.trim() === 'Number of items');

    expect(header).toBeDefined();
    expect(header?.className).toContain('w-4/12');
  });
});
