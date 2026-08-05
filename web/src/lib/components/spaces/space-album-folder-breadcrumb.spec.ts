import type { SharedSpaceAlbumFolderDto } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import SpaceAlbumFolderBreadcrumb from '$lib/components/spaces/space-album-folder-breadcrumb.svelte';

const crumb = (id: string, name: string, parentId: string | null = null) =>
  ({
    id,
    spaceId: 'space-1',
    parentId,
    name,
    createdById: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as SharedSpaceAlbumFolderDto;

describe('SpaceAlbumFolderBreadcrumb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a root crumb plus one crumb per path entry', () => {
    render(SpaceAlbumFolderBreadcrumb, {
      path: [crumb('trips', 'Trips'), crumb('y2026', '2026', 'trips')],
      onNavigate: vi.fn(),
    });

    expect(screen.getByText('space_album_folder_root')).toBeInTheDocument();
    expect(screen.getByText('Trips')).toBeInTheDocument();
    expect(screen.getByText('2026')).toBeInTheDocument();
  });

  it('navigates to the space root when the root crumb is clicked', async () => {
    const onNavigate = vi.fn();
    render(SpaceAlbumFolderBreadcrumb, { path: [crumb('trips', 'Trips')], onNavigate });

    await userEvent.click(screen.getByText('space_album_folder_root'));

    expect(onNavigate).toHaveBeenCalledWith(null);
  });

  it('navigates to an ancestor when its crumb is clicked', async () => {
    const onNavigate = vi.fn();
    render(SpaceAlbumFolderBreadcrumb, {
      path: [crumb('trips', 'Trips'), crumb('y2026', '2026', 'trips')],
      onNavigate,
    });

    await userEvent.click(screen.getByText('Trips'));

    expect(onNavigate).toHaveBeenCalledWith('trips');
  });

  // A deep tree must not push the toolbar off-screen on a narrow viewport.
  it('collapses middle crumbs past four levels', () => {
    render(SpaceAlbumFolderBreadcrumb, {
      path: [crumb('a', 'A'), crumb('b', 'B', 'a'), crumb('c', 'C', 'b'), crumb('d', 'D', 'c'), crumb('e', 'E', 'd')],
      onNavigate: vi.fn(),
    });

    expect(screen.getByText('…')).toBeInTheDocument();
    expect(screen.queryByText('C')).not.toBeInTheDocument();
    // First and last are always kept so the trail stays meaningful.
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('E')).toBeInTheDocument();
  });
});
