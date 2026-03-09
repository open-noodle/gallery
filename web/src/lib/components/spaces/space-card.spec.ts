import SpaceCard from '$lib/components/spaces/space-card.svelte';
import type { SharedSpaceMemberResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import { Role } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';

const makeMember = (overrides: Partial<SharedSpaceMemberResponseDto> = {}): SharedSpaceMemberResponseDto => ({
  userId: 'user-1',
  name: 'Alice',
  email: 'alice@test.com',
  role: Role.Editor,
  joinedAt: '2026-01-01T00:00:00.000Z',
  showInTimeline: false,
  ...overrides,
});

const makeSpace = (overrides: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto => ({
  id: 'space-1',
  name: 'Family Photos',
  description: 'Our family memories',
  createdById: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  memberCount: 3,
  assetCount: 42,
  thumbnailAssetId: null,
  members: [],
  ...overrides,
});

describe('SpaceCard component', () => {
  it('should render space name', () => {
    render(SpaceCard, { space: makeSpace() });
    expect(screen.getByTestId('space-name')).toHaveTextContent('Family Photos');
  });

  it('should render asset and member counts', () => {
    render(SpaceCard, { space: makeSpace({ assetCount: 42, memberCount: 3 }) });
    const details = screen.getByTestId('space-details');
    expect(details).toHaveTextContent('42');
    expect(details).toHaveTextContent('3');
  });

  it('should render thumbnail image when thumbnailAssetId is set', () => {
    render(SpaceCard, { space: makeSpace({ thumbnailAssetId: 'asset-123' }) });
    const img = screen.getByTestId('album-image');
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('src')).toContain('asset');
  });

  it('should render empty state when no thumbnailAssetId', () => {
    render(SpaceCard, { space: makeSpace({ thumbnailAssetId: null }) });
    const img = screen.queryByTestId('album-image');
    expect(img).toBeNull();
  });

  it('should render member avatars when members are provided', () => {
    const members = [
      makeMember({ userId: 'u1', name: 'Alice' }),
      makeMember({ userId: 'u2', name: 'Bob' }),
    ];
    render(SpaceCard, { space: makeSpace({ members }) });
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('should show overflow badge when more than 4 members', () => {
    const members = [
      makeMember({ userId: 'u1', name: 'Alice' }),
      makeMember({ userId: 'u2', name: 'Bob' }),
      makeMember({ userId: 'u3', name: 'Carol' }),
      makeMember({ userId: 'u4', name: 'Dan' }),
      makeMember({ userId: 'u5', name: 'Eve' }),
      makeMember({ userId: 'u6', name: 'Frank' }),
    ];
    render(SpaceCard, { space: makeSpace({ members }) });
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('should have link to space detail page', () => {
    render(SpaceCard, { space: makeSpace({ id: 'space-42' }) });
    const link = screen.getByRole('link');
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toContain('space-42');
  });
});
