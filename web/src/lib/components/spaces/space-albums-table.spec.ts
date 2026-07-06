import type { SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import { render, screen, waitFor } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import SpaceAlbumsTable from '$lib/components/spaces/space-albums-table.svelte';
import { SpaceAlbumGroupBy, spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
import { toggleSpaceAlbumGroupCollapsing } from '$lib/utils/space-album-grouping';
import { renderWithTooltips } from '$tests/helpers';

function makeAlbum(overrides: Partial<SharedSpaceLinkedAlbumDto> = {}): SharedSpaceLinkedAlbumDto {
  return {
    id: 'album-1',
    albumName: 'Vacation',
    assetCount: 5,
    albumThumbnailAssetId: null,
    showInTimeline: true,
    addedById: null,
    linkedAt: '2026-01-01T00:00:00.000Z',
    albumUsers: [],
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
    render(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1, a2], canManage: false });
    expect(screen.getByTestId(`space-album-row-${a1.id}`)).toHaveAttribute('href', '/spaces/s-1/albums/a-1');
    expect(screen.getByText('Vacation')).toBeInTheDocument();
    expect(screen.getByText(/5 items/i)).toBeInTheDocument();
  });

  it('shows the manage menu only when canManage', () => {
    renderWithTooltips(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: true });
    expect(screen.getByTestId(`space-album-row-menu-${a1.id}`)).toBeInTheDocument();
  });

  it('does not show manage menu when canManage is false', () => {
    render(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: false });
    expect(screen.queryByTestId(`space-album-row-menu-${a1.id}`)).not.toBeInTheDocument();
  });

  it('renders all albums as rows', () => {
    render(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1, a2], canManage: false });
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
      render(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1, a2], canManage: false, groups, grouped: true });
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
      render(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1, a2], canManage: false, groups, grouped: true });
      expect(screen.getByTestId('space-album-group-header-2024')).toHaveAttribute('aria-expanded', 'true');
      toggleSpaceAlbumGroupCollapsing('2024');
      await waitFor(() =>
        expect(screen.getByTestId('space-album-group-header-2024')).toHaveAttribute('aria-expanded', 'false'),
      );
    });
  });
});
