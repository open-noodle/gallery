import type { SharedSpaceAlbumFolderDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import { fireEvent, screen } from '@testing-library/svelte';
import SpaceAlbumFolderCard from '$lib/components/spaces/space-album-folder-card.svelte';
import {
  getActiveDragPayload,
  readDragPayload,
  setActiveDragPayload,
  writeDragPayload,
} from '$lib/utils/space-album-folder-dnd';
import { renderWithTooltips } from '$tests/helpers';

const folder = {
  id: 'trips',
  spaceId: 'space-1',
  parentId: null,
  name: 'Trips',
  createdById: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as SharedSpaceAlbumFolderDto;

const otherFolder = { ...folder, id: 'family', name: 'Family' };

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

const defaults = {
  folder,
  albumCount: 12,
  previewAssetIds: ['a1', 'a2', 'a3', 'a4'],
  canManage: true,
};

describe('SpaceAlbumFolderCard', () => {
  // $t() returns RAW KEYS in web unit tests — assert on keys, never on English.
  beforeEach(() => {
    vi.clearAllMocks();
    // getActiveDragPayload is bare module state (no clearMocks equivalent resets it) — a payload
    // left active by one test would otherwise let a later dragover test "accept" a drop it never
    // actually simulated dragging.
    setActiveDragPayload(null);
  });

  it('renders the folder name', () => {
    renderWithTooltips(SpaceAlbumFolderCard, defaults);

    expect(screen.getByText('Trips')).toBeInTheDocument();
  });

  // SpaceCollage renders alt="" images, so queryByRole('img') against it can never fail.
  // Count the elements directly, exactly as space-collage.spec.ts does.
  it('renders one collage image per preview asset', () => {
    const { container } = renderWithTooltips(SpaceAlbumFolderCard, defaults);

    expect(container.querySelectorAll('img')).toHaveLength(4);
  });

  it('renders the collage empty state for a folder with no previews', () => {
    const { container } = renderWithTooltips(SpaceAlbumFolderCard, { ...defaults, previewAssetIds: [], albumCount: 0 });

    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.querySelector('[data-testid="collage-empty"]')).toBeInTheDocument();
  });

  // W-11: viewers get no management affordances at all.
  it('W-11: renders no kebab menu and is not draggable for a viewer', () => {
    const { container } = renderWithTooltips(SpaceAlbumFolderCard, { ...defaults, canManage: false });

    expect(container.querySelector('[data-testid="space-album-folder-card-menu"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="space-album-folder-card"]')).toHaveAttribute('draggable', 'false');
  });

  it('W-11: renders the kebab menu and is draggable for an editor', () => {
    const { container } = renderWithTooltips(SpaceAlbumFolderCard, defaults);

    expect(container.querySelector('[data-testid="space-album-folder-card-menu"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="space-album-folder-card"]')).toHaveAttribute('draggable', 'true');
  });

  // W-20: no hardcoded English anywhere. $t() returns the raw key, so the key IS the
  // rendered text — if a literal string were used instead, this assertion would fail.
  it('W-20: renders the album count through i18n rather than a hardcoded string', () => {
    renderWithTooltips(SpaceAlbumFolderCard, defaults);

    expect(screen.getByTestId('space-album-folder-card-count')).toHaveTextContent('space_album_folder_albums_count');
  });

  it('dragstart writes the folder payload onto the DataTransfer and the active-drag slot', async () => {
    const { container } = renderWithTooltips(SpaceAlbumFolderCard, defaults);
    const card = container.querySelector('[data-testid="space-album-folder-card"]')!;
    const dataTransfer = makeDataTransfer();

    expect(getActiveDragPayload()).toBeNull();

    await fireEvent.dragStart(card, { dataTransfer });

    expect(readDragPayload(dataTransfer)).toEqual({ kind: 'folder', id: folder.id });
    expect(getActiveDragPayload()).toEqual({ kind: 'folder', id: folder.id });

    await fireEvent.dragEnd(card);

    expect(getActiveDragPayload()).toBeNull();
  });

  describe('as a drop target', () => {
    // dragover/dragenter see the DataTransfer in the browser's "protected mode" (getData()
    // returns '' there in real Chrome/Firefox), so the card reads the payload for its dragover
    // check off the module-level active-drag slot instead of the DataTransfer — this is what
    // setActiveDragPayload simulates here.
    it('does not preventDefault or highlight when no drag is active', async () => {
      const { container } = renderWithTooltips(SpaceAlbumFolderCard, {
        ...defaults,
        folders: [folder, otherFolder],
        albums: [album('a1')],
      });
      const card = container.querySelector('[data-testid="space-album-folder-card"]')!;

      const notPrevented = await fireEvent.dragOver(card);

      expect(notPrevented).toBe(true); // preventDefault was NOT called
      expect(card).not.toHaveClass('ring-2');
    });

    it('does not preventDefault or highlight for an illegal target (dropping a folder on itself)', async () => {
      const { container } = renderWithTooltips(SpaceAlbumFolderCard, {
        ...defaults,
        folders: [folder, otherFolder],
        albums: [],
      });
      const card = container.querySelector('[data-testid="space-album-folder-card"]')!;

      setActiveDragPayload({ kind: 'folder', id: folder.id });
      const notPrevented = await fireEvent.dragOver(card);

      expect(notPrevented).toBe(true);
      expect(card).not.toHaveClass('ring-2');
    });

    it('a viewer never accepts a drop, even for an otherwise legal target', async () => {
      const { container } = renderWithTooltips(SpaceAlbumFolderCard, {
        ...defaults,
        canManage: false,
        folders: [folder, otherFolder],
        albums: [album('a1')],
      });
      const card = container.querySelector('[data-testid="space-album-folder-card"]')!;

      setActiveDragPayload({ kind: 'album', id: 'a1' });
      const notPrevented = await fireEvent.dragOver(card);

      expect(notPrevented).toBe(true);
      expect(card).not.toHaveClass('ring-2');
    });

    it('preventDefaults and highlights for a legal target, and calls onDropItem on drop', async () => {
      const onDropItem = vi.fn();
      const { container } = renderWithTooltips(SpaceAlbumFolderCard, {
        ...defaults,
        folders: [folder, otherFolder],
        albums: [album('a1')],
        onDropItem,
      });
      const card = container.querySelector('[data-testid="space-album-folder-card"]')!;

      setActiveDragPayload({ kind: 'album', id: 'a1' });
      const notPrevented = await fireEvent.dragOver(card);

      expect(notPrevented).toBe(false); // preventDefault WAS called
      expect(card).toHaveClass('ring-2');

      const dataTransfer = makeDataTransfer();
      writeDragPayload(dataTransfer, { kind: 'album', id: 'a1' });
      await fireEvent.drop(card, { dataTransfer });

      expect(onDropItem).toHaveBeenCalledWith({ kind: 'album', id: 'a1' }, folder.id);
    });
  });
});
