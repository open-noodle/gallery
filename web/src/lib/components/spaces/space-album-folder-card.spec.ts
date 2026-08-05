import type { SharedSpaceAlbumFolderDto } from '@immich/sdk';
import { screen } from '@testing-library/svelte';
import SpaceAlbumFolderCard from '$lib/components/spaces/space-album-folder-card.svelte';
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
});
