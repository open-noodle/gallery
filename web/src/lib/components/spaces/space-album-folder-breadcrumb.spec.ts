import type { SharedSpaceAlbumFolderDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import SpaceAlbumFolderBreadcrumb from '$lib/components/spaces/space-album-folder-breadcrumb.svelte';
import { setActiveDragPayload, writeDragPayload } from '$lib/utils/space-album-folder-dnd';

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

const album = (id: string, folderId: string | null = null) =>
  ({ id, albumName: id, folderId }) as SharedSpaceLinkedAlbumDto;

const makeDataTransfer = () => {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    types: [...store.keys()],
  } as unknown as DataTransfer;
};

describe('SpaceAlbumFolderBreadcrumb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // getActiveDragPayload is bare module state — reset so a payload left active by one test
    // can't leak into a later dragover assertion.
    setActiveDragPayload(null);
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

  describe('as a drop target', () => {
    const folders = [crumb('trips', 'Trips')];

    it('does not preventDefault or highlight when no drag is active', async () => {
      render(SpaceAlbumFolderBreadcrumb, {
        path: [crumb('trips', 'Trips')],
        folders,
        albums: [album('a1')],
        canManage: true,
        onNavigate: vi.fn(),
      });

      const notPrevented = await fireEvent.dragOver(screen.getByTestId('breadcrumb-root'));

      expect(notPrevented).toBe(true); // preventDefault was NOT called
      expect(screen.getByTestId('breadcrumb-root')).not.toHaveClass('ring-2');
    });

    it('a viewer (canManage=false) never accepts a drop, even for an otherwise legal target', async () => {
      render(SpaceAlbumFolderBreadcrumb, {
        path: [crumb('trips', 'Trips')],
        folders,
        // a1 sits in "trips" — dropping it on the root crumb WOULD be a legal move if canManage
        // were ignored, so this genuinely exercises the canManage gate rather than tripping the
        // unrelated "already at the target" no-op (which an album already at the root would).
        albums: [album('a1', 'trips')],
        canManage: false,
        onNavigate: vi.fn(),
      });

      setActiveDragPayload({ kind: 'album', id: 'a1' });
      const notPrevented = await fireEvent.dragOver(screen.getByTestId('breadcrumb-root'));

      expect(notPrevented).toBe(true);
      expect(screen.getByTestId('breadcrumb-root')).not.toHaveClass('ring-2');
    });

    it('preventDefaults and highlights the root crumb for a legal target, and calls onDropItem(payload, null) on drop', async () => {
      const onDropItem = vi.fn();
      render(SpaceAlbumFolderBreadcrumb, {
        path: [crumb('trips', 'Trips')],
        folders,
        albums: [album('a1', 'trips')],
        canManage: true,
        onNavigate: vi.fn(),
        onDropItem,
      });
      const rootCrumb = screen.getByTestId('breadcrumb-root');
      const tripsCrumb = screen.getByTestId('breadcrumb-trips');

      setActiveDragPayload({ kind: 'album', id: 'a1' });
      const notPrevented = await fireEvent.dragOver(rootCrumb);

      expect(notPrevented).toBe(false); // preventDefault WAS called
      expect(rootCrumb).toHaveClass('ring-2');
      // Only the crumb actually under the cursor highlights, not every crumb.
      expect(tripsCrumb).not.toHaveClass('ring-2');

      const dataTransfer = makeDataTransfer();
      writeDragPayload(dataTransfer, { kind: 'album', id: 'a1' });
      await fireEvent.drop(rootCrumb, { dataTransfer });

      expect(onDropItem).toHaveBeenCalledWith({ kind: 'album', id: 'a1' }, null);
    });

    it('preventDefaults and highlights a folder crumb, and calls onDropItem(payload, folderId) on drop', async () => {
      const onDropItem = vi.fn();
      render(SpaceAlbumFolderBreadcrumb, {
        path: [crumb('trips', 'Trips')],
        folders,
        albums: [album('a1')],
        canManage: true,
        onNavigate: vi.fn(),
        onDropItem,
      });
      const tripsCrumb = screen.getByTestId('breadcrumb-trips');
      const rootCrumb = screen.getByTestId('breadcrumb-root');

      setActiveDragPayload({ kind: 'album', id: 'a1' });
      const notPrevented = await fireEvent.dragOver(tripsCrumb);

      expect(notPrevented).toBe(false);
      expect(tripsCrumb).toHaveClass('ring-2');
      // Only the crumb actually under the cursor highlights, not every crumb.
      expect(rootCrumb).not.toHaveClass('ring-2');

      const dataTransfer = makeDataTransfer();
      writeDragPayload(dataTransfer, { kind: 'album', id: 'a1' });
      await fireEvent.drop(tripsCrumb, { dataTransfer });

      expect(onDropItem).toHaveBeenCalledWith({ kind: 'album', id: 'a1' }, 'trips');
    });
  });
});
