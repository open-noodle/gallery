import SpaceHero from '$lib/components/spaces/space-hero.svelte';
import type { SharedSpaceResponseDto } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';

const makeSpace = (overrides: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto => ({
  id: 'space-1',
  name: 'Family Trip',
  description: null,
  createdById: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  thumbnailAssetId: null,
  ...overrides,
});

describe('SpaceHero component', () => {
  it('should render the space name', () => {
    render(SpaceHero, { space: makeSpace({ name: 'Alps Hiking' }), memberCount: 3, assetCount: 42 });
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Alps Hiking');
  });

  it('should render cover image when thumbnailAssetId is set', () => {
    render(SpaceHero, { space: makeSpace({ thumbnailAssetId: 'asset-1' }), memberCount: 3, assetCount: 42 });
    expect(screen.getByTestId('hero-cover-image')).toBeInTheDocument();
    expect(screen.queryByTestId('hero-gradient')).not.toBeInTheDocument();
  });

  it('should render gradient background when no cover photo', () => {
    render(SpaceHero, {
      space: makeSpace({ thumbnailAssetId: null }),
      memberCount: 3,
      assetCount: 42,
      gradientClass: 'from-blue-400 to-blue-600',
    });
    expect(screen.getByTestId('hero-gradient')).toBeInTheDocument();
    expect(screen.queryByTestId('hero-cover-image')).not.toBeInTheDocument();
  });

  it('should display asset count', () => {
    render(SpaceHero, { space: makeSpace(), memberCount: 3, assetCount: 99 });
    expect(screen.getByTestId('hero-photo-count')).toHaveTextContent('99');
  });

  it('should display member count', () => {
    render(SpaceHero, { space: makeSpace(), memberCount: 7, assetCount: 0 });
    expect(screen.getByTestId('hero-member-count')).toHaveTextContent('7');
  });

  it('should display role badge when currentRole is provided', () => {
    render(SpaceHero, { space: makeSpace(), memberCount: 1, assetCount: 0, currentRole: 'editor' });
    expect(screen.getByTestId('hero-role-badge')).toHaveTextContent('Editor');
  });

  it('should not display role badge when currentRole is not provided', () => {
    render(SpaceHero, { space: makeSpace(), memberCount: 1, assetCount: 0 });
    expect(screen.queryByTestId('hero-role-badge')).not.toBeInTheDocument();
  });

  it('should display description when present', () => {
    render(SpaceHero, { space: makeSpace({ description: 'A lovely trip' }), memberCount: 1, assetCount: 0 });
    expect(screen.getByTestId('hero-description')).toHaveTextContent('A lovely trip');
  });

  it('should show "Show more" for long descriptions', () => {
    const longDesc = 'A'.repeat(200);
    render(SpaceHero, { space: makeSpace({ description: longDesc }), memberCount: 1, assetCount: 0 });
    expect(screen.getByTestId('hero-show-more')).toBeInTheDocument();
  });
});
