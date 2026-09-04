import { screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { renderWithTooltips } from '$tests/helpers';
import SpaceAlbumCard from './space-album-card.svelte';

describe('SpaceAlbumCard', () => {
  beforeAll(async () => {
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  const album = {
    id: 'a-1',
    albumName: 'Trip',
    assetCount: 12,
    albumThumbnailAssetId: null,
    showInTimeline: true,
    hiddenFromMyTimeline: false,
    addedById: null,
    linkedAt: '2026-01-01T00:00:00Z',
    albumUsers: [],
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    shared: false,
    hasSharedLink: false,
    isActivityEnabled: false,
  };

  it('links to the in-space album route', () => {
    renderWithTooltips(SpaceAlbumCard, { spaceId: 's-1', album, canManage: false });
    expect(screen.getByTestId('space-album-card-link')).toHaveAttribute('href', '/spaces/s-1/albums/a-1');
  });

  it('renders album name and count', () => {
    renderWithTooltips(SpaceAlbumCard, { spaceId: 's-1', album, canManage: false });
    expect(screen.getByText('Trip')).toBeInTheDocument();
    expect(screen.getByText(/12 items/i)).toBeInTheDocument();
  });

  it('editor and viewer both see the card menu (the "my timeline" item is not editor-gated)', () => {
    renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album,
      canManage: true,
      onUnlink: vi.fn(),
      onToggleTimeline: vi.fn(),
      onToggleMyTimeline: vi.fn(),
    });
    expect(screen.getByTestId('space-album-card-menu')).toBeInTheDocument();

    renderWithTooltips(SpaceAlbumCard, { spaceId: 's-1', album, canManage: false, onToggleMyTimeline: vi.fn() });
    expect(screen.getAllByTestId('space-album-card-menu')).toHaveLength(2);
  });

  it("shows hidden-from-the-space's-photos sublabel when showInTimeline is false", () => {
    renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album: { ...album, showInTimeline: false },
      canManage: false,
    });
    expect(screen.getByText(/Hidden from the space's photos/)).toBeInTheDocument();
  });

  it('shows hidden-from-your-timeline sublabel when the caller has hidden it from their own timeline', () => {
    renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album: { ...album, hiddenFromMyTimeline: true },
      canManage: false,
    });
    expect(screen.getByText(/Hidden from your timeline/)).toBeInTheDocument();
  });

  // #1041 regression guard: the space-level switch and the album-level "my timeline" switch used
  // to share the literal string "Hide from timeline". They must render DIFFERENT strings now.
  it('the "my timeline" menu item text differs from the space-level switch\'s old shared label', () => {
    renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album,
      canManage: false,
      onToggleMyTimeline: vi.fn(),
    });
    expect(screen.getByText('Hide this album from my timeline')).toBeInTheDocument();
    expect(screen.queryByText('Hide from timeline')).not.toBeInTheDocument();
  });

  it('when canManage=true, the my-timeline item, the space-photos toggle, and unlink are all present', () => {
    renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album,
      canManage: true,
      onUnlink: vi.fn(),
      onToggleTimeline: vi.fn(),
      onToggleMyTimeline: vi.fn(),
    });
    expect(screen.getByText('Hide this album from my timeline')).toBeInTheDocument();
    // album.showInTimeline=true → the editor-only toggle reads "Hide this album from the space's photos"
    expect(screen.getByText("Hide this album from the space's photos")).toBeInTheDocument();
    expect(screen.getByText('Unlink album')).toBeInTheDocument();
  });

  it('when canManage=false, only the my-timeline item is present — the editor-only items are hidden', () => {
    renderWithTooltips(SpaceAlbumCard, { spaceId: 's-1', album, canManage: false, onToggleMyTimeline: vi.fn() });
    expect(screen.getByText('Hide this album from my timeline')).toBeInTheDocument();
    expect(screen.queryByText("Hide this album from the space's photos")).not.toBeInTheDocument();
    expect(screen.queryByText("Show this album in the space's photos")).not.toBeInTheDocument();
    expect(screen.queryByText('Unlink album')).not.toBeInTheDocument();
  });

  it('renders the album cover image when a thumbnail exists', () => {
    renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album: { ...album, id: 'a-1', albumThumbnailAssetId: 'thumb-1', albumName: 'Trip' },
      canManage: false,
    });
    expect(screen.getByAltText('Trip')).toBeInTheDocument();
  });
});
