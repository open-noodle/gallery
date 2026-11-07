import SpaceCard from '#lib/components/spaces/space-card.svelte';
import { SharedSpaceRole, type SharedSpaceMemberResponseDto, type SharedSpaceResponseDto } from '@immich/sdk';
import { init, register, waitLocale } from 'svelte-i18n';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

const makeMember = (overrides: Partial<SharedSpaceMemberResponseDto> = {}): SharedSpaceMemberResponseDto => ({
  userId: 'user-1',
  name: 'Alice',
  email: 'alice@test.com',
  role: SharedSpaceRole.Editor,
  joinedAt: '2026-01-01T00:00:00.000Z',
  showInTimeline: false,
  sharePersonMetadata: true,
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
  recentAssetIds: [],
  recentAssetThumbhashes: [],
  lastActivityAt: null,
  newAssetCount: 0,
  members: [],
  ...overrides,
});

describe('SpaceCard component', () => {
  beforeAll(async () => {
    register('en-US', () => import('#i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  it('should render space name', async () => {
    await render(SpaceCard, { space: makeSpace() });
    expect(page.getByTestId('space-name').element()).toMatchTextContent('Family Photos');
  });

  it('should render asset and member counts', async () => {
    await render(SpaceCard, { space: makeSpace({ assetCount: 42, memberCount: 3 }) });
    const details = page.getByTestId('space-details').element();
    expect(details).toMatchTextContent('42');
    expect(details).toMatchTextContent('3');
  });

  it('should render collage when recentAssetIds are provided', async () => {
    await render(SpaceCard, { space: makeSpace({ recentAssetIds: ['a1', 'a2'], recentAssetThumbhashes: ['', ''] }) });
    expect(page.getByTestId('collage-asymmetric').element()).toBeInTheDocument();
  });

  it('should render empty collage when no recentAssetIds', async () => {
    await render(SpaceCard, { space: makeSpace({ recentAssetIds: [] }) });
    expect(page.getByTestId('collage-empty').element()).toBeInTheDocument();
  });

  it('should render member avatars when members are provided', async () => {
    const members = [makeMember({ userId: 'u1', name: 'Alice' }), makeMember({ userId: 'u2', name: 'Bob' })];
    await render(SpaceCard, { space: makeSpace({ members }) });
    expect(page.getByText('A', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByText('B', { exact: true }).element()).toBeInTheDocument();
  });

  it('should show overflow badge when more than 4 members', async () => {
    const members = [
      makeMember({ userId: 'u1', name: 'Alice' }),
      makeMember({ userId: 'u2', name: 'Bob' }),
      makeMember({ userId: 'u3', name: 'Carol' }),
      makeMember({ userId: 'u4', name: 'Dan' }),
      makeMember({ userId: 'u5', name: 'Eve' }),
      makeMember({ userId: 'u6', name: 'Frank' }),
    ];
    await render(SpaceCard, { space: makeSpace({ members }) });
    expect(page.getByText('+2', { exact: true }).element()).toBeInTheDocument();
  });

  it('should have link to space detail page', async () => {
    await render(SpaceCard, { space: makeSpace({ id: 'space-42' }) });
    const link = page.getByRole('link').element();
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toContain('space-42');
  });

  it('should not render activity dot when newAssetCount is 0', async () => {
    await render(SpaceCard, { space: makeSpace({ newAssetCount: 0 }) });
    expect(page.getByTestId('activity-dot').query()).not.toBeInTheDocument();
  });

  it('should render activity dot when newAssetCount > 0', async () => {
    await render(SpaceCard, { space: makeSpace({ newAssetCount: 3 }) });
    expect(page.getByTestId('activity-dot').element()).toBeInTheDocument();
  });

  it('should show contributor name with count', async () => {
    await render(SpaceCard, {
      space: makeSpace({
        newAssetCount: 3,
        lastContributor: { id: 'user-1', name: 'Pierre' },
      }),
    });
    expect(page.getByTestId('activity-line').element()).toMatchTextContent('Pierre added 3 new');
  });

  it('should show count only without contributor', async () => {
    await render(SpaceCard, { space: makeSpace({ newAssetCount: 5 }) });
    expect(page.getByTestId('activity-line').element()).toMatchTextContent('5 new photos');
  });

  it('should cap display at 99+', async () => {
    await render(SpaceCard, { space: makeSpace({ newAssetCount: 150 }) });
    expect(page.getByTestId('activity-line').element()).toMatchTextContent('99+ new photos');
  });

  describe('pin/unpin context menu', () => {
    it('should not show menu button initially', async () => {
      await render(SpaceCard, { space: makeSpace() });
      expect(page.getByTestId('space-menu-button').query()).not.toBeInTheDocument();
    });

    it('should show menu button on hover', async () => {
      await render(SpaceCard, { space: makeSpace() });
      const card = page.getByTestId('space-card').element();
      await userEvent.hover(card);
      expect(page.getByTestId('space-menu-button').element()).toBeInTheDocument();
    });

    it('should show "Pin to top" when not pinned after hovering and clicking menu', async () => {
      await render(SpaceCard, { space: makeSpace(), isPinned: false });
      const card = page.getByTestId('space-card').element();
      await userEvent.hover(card);
      await userEvent.click(page.getByTestId('space-menu-button'));
      expect(page.getByText('Pin to top', { exact: true }).element()).toBeInTheDocument();
    });

    it('should show "Unpin" when pinned after hovering and clicking menu', async () => {
      await render(SpaceCard, { space: makeSpace(), isPinned: true });
      const card = page.getByTestId('space-card').element();
      await userEvent.hover(card);
      await userEvent.click(page.getByTestId('space-menu-button'));
      expect(page.getByText('Unpin', { exact: true }).element()).toBeInTheDocument();
    });

    it('should call onTogglePin with space id when clicking "Pin to top"', async () => {
      const onTogglePin = vi.fn();
      await render(SpaceCard, { space: makeSpace({ id: 'space-42' }), isPinned: false, onTogglePin });
      const card = page.getByTestId('space-card').element();
      await userEvent.hover(card);
      await userEvent.click(page.getByTestId('space-menu-button'));
      await userEvent.click(page.getByText('Pin to top', { exact: true }));
      expect(onTogglePin).toHaveBeenCalledWith('space-42');
    });

    it('should show pin overlay when isPinned is true', async () => {
      await render(SpaceCard, { space: makeSpace(), isPinned: true });
      expect(page.getByTestId('pin-overlay').element()).toBeInTheDocument();
    });

    it('should not show pin overlay when isPinned is false', async () => {
      await render(SpaceCard, { space: makeSpace(), isPinned: false });
      expect(page.getByTestId('pin-overlay').query()).not.toBeInTheDocument();
    });
  });
});
