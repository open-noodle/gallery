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

  it('editor sees the manage menu; viewer does not', () => {
    renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album,
      canManage: true,
      onUnlink: vi.fn(),
      onToggleTimeline: vi.fn(),
    });
    expect(screen.getByTestId('space-album-card-menu')).toBeInTheDocument();
  });

  it('viewer has no manage menu', () => {
    renderWithTooltips(SpaceAlbumCard, { spaceId: 's-1', album, canManage: false });
    expect(screen.queryByTestId('space-album-card-menu')).not.toBeInTheDocument();
  });

  it('shows hidden-from-timeline sublabel when showInTimeline is false', () => {
    renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album: { ...album, showInTimeline: false },
      canManage: false,
    });
    expect(screen.getByText(/hidden from timeline/i)).toBeInTheDocument();
  });

  it('when canManage=true, both the unlink and the toggle menu options are present', () => {
    renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album,
      canManage: true,
      onUnlink: vi.fn(),
      onToggleTimeline: vi.fn(),
    });
    // album.showInTimeline=true → toggle option reads "Hide from timeline"
    expect(screen.getByText('Hide from timeline')).toBeInTheDocument();
    expect(screen.getByText('Unlink album')).toBeInTheDocument();
  });

  it('when canManage=false, neither the unlink nor the toggle menu option is present', () => {
    renderWithTooltips(SpaceAlbumCard, { spaceId: 's-1', album, canManage: false });
    expect(screen.queryByText('Hide from timeline')).not.toBeInTheDocument();
    expect(screen.queryByText('Show in timeline')).not.toBeInTheDocument();
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
