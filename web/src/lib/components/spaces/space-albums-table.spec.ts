import type { SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import { fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import SpaceAlbumsTable from '$lib/components/spaces/space-albums-table.svelte';
import { SpaceAlbumGroupBy, spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
import { toggleSpaceAlbumGroupCollapsing } from '$lib/utils/space-album-grouping';
import { renderWithTooltips } from '$tests/helpers';

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

describe('SpaceAlbumsTable', () => {
  beforeAll(async () => {
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  const a1 = makeAlbum({ id: 'a-1', albumName: 'Vacation', assetCount: 5 });
  const a2 = makeAlbum({ id: 'a-2', albumName: 'Road Trip', assetCount: 10 });

  it('renders a linking row per album to the space album route', () => {
    renderWithTooltips(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1, a2], canManage: false });
    expect(screen.getByTestId(`space-album-row-${a1.id}`)).toHaveAttribute('href', '/spaces/s-1/albums/a-1');
    expect(screen.getByText('Vacation')).toBeInTheDocument();
    expect(screen.getByText(/5 items/i)).toBeInTheDocument();
  });

  it('shows the row menu for both an editor and a viewer (the "my timeline" item is not editor-gated)', () => {
    renderWithTooltips(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: true });
    expect(screen.getByTestId(`space-album-row-menu-${a1.id}`)).toBeInTheDocument();
  });

  it('still shows the row menu when canManage is false — just without the editor-only items', () => {
    renderWithTooltips(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: false });
    expect(screen.getByTestId(`space-album-row-menu-${a1.id}`)).toBeInTheDocument();
  });

  it('when canManage=false, only the my-timeline item is present — the editor-only items are hidden', async () => {
    renderWithTooltips(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: false });
    const menu = screen.getByTestId(`space-album-row-menu-${a1.id}`);
    await fireEvent.click(within(menu).getByLabelText(/more/i));
    expect(await screen.findByText('Hide this album from my timeline')).toBeInTheDocument();
    expect(screen.queryByText("Hide this album from the space's photos")).not.toBeInTheDocument();
    expect(screen.queryByText('Unlink album')).not.toBeInTheDocument();
  });

  it('renders all albums as rows', () => {
    renderWithTooltips(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1, a2], canManage: false });
    expect(screen.getByTestId('space-album-row-a-1')).toBeInTheDocument();
    expect(screen.getByTestId('space-album-row-a-2')).toBeInTheDocument();
  });

  describe('grouped rendering', () => {
    beforeEach(() => {
      localStorage.clear();
      spaceAlbumViewSettings.reset();
    });

    it('renders a collapsible header per group with name and count', () => {
      spaceAlbumViewSettings.update((s) => ({ ...s, groupBy: SpaceAlbumGroupBy.Year }));
      const groups = [
        { id: '2024', name: '2024', albums: [a1] },
        { id: '2020', name: '2020', albums: [a2] },
      ];
      renderWithTooltips(SpaceAlbumsTable, {
        spaceId: 's-1',
        albums: [a1, a2],
        canManage: false,
        groups,
        grouped: true,
      });
      const header2024 = screen.getByTestId('space-album-group-header-2024');
      expect(header2024).toHaveTextContent('2024');
      expect(header2024).toHaveTextContent('1');
      expect(screen.getByTestId('space-album-group-header-2020')).toHaveTextContent('2020');
      expect(screen.getByTestId('space-album-row-a-1')).toBeInTheDocument();
      expect(screen.getByTestId('space-album-row-a-2')).toBeInTheDocument();
    });

    it('collapsing a group marks its header collapsed and hides its rows', async () => {
      spaceAlbumViewSettings.update((s) => ({ ...s, groupBy: SpaceAlbumGroupBy.Year }));
      const groups = [
        { id: '2024', name: '2024', albums: [a1] },
        { id: '2020', name: '2020', albums: [a2] },
      ];
      renderWithTooltips(SpaceAlbumsTable, {
        spaceId: 's-1',
        albums: [a1, a2],
        canManage: false,
        groups,
        grouped: true,
      });
      expect(screen.getByTestId('space-album-group-header-2024')).toHaveAttribute('aria-expanded', 'true');
      toggleSpaceAlbumGroupCollapsing('2024');
      await waitFor(() =>
        expect(screen.getByTestId('space-album-group-header-2024')).toHaveAttribute('aria-expanded', 'false'),
      );
    });
  });

  it('labels the item-count column with a proper header, not a stripped plural', () => {
    render(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: false });

    const headerTexts = screen.getAllByRole('columnheader').map((header) => header.textContent?.trim());

    expect(headerTexts).toContain('Number of items');
    // The bug rendered the bare fragment; assert on the exact string so a
    // substring match cannot pass against it.
    expect(headerTexts).not.toContain('items');
  });

  it('gives the item-count column header a base width so the longer label does not wrap', () => {
    render(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: false });

    const header = screen
      .getAllByRole('columnheader')
      .find((candidate) => candidate.textContent?.trim() === 'Number of items');

    expect(header).toBeDefined();
    expect(header?.className).toContain('w-4/12');
  });
});
