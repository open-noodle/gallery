import { render, screen } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import SpaceActivityFeed from '$lib/components/spaces/space-activity-feed.svelte';

function renderFeed(props: Record<string, unknown>) {
  return render(TestWrapper as Component<{ component: typeof SpaceActivityFeed; componentProps: typeof props }>, {
    component: SpaceActivityFeed,
    componentProps: props,
  });
}

const makeActivity = (overrides: Record<string, unknown> = {}) => ({
  id: 'act-1',
  type: 'asset_add',
  data: { count: 5, assetIds: ['a1', 'a2'] },
  createdAt: new Date().toISOString(),
  userId: 'u1',
  userName: 'Pierre',
  userEmail: 'pierre@test.com',
  userProfileImagePath: null,
  userAvatarColor: 'primary',
  ...overrides,
});

describe('SpaceActivityFeed', () => {
  beforeAll(async () => {
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  it('should show empty state when no activities', () => {
    renderFeed({ activities: [], spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
    expect(screen.getByTestId('activity-empty-state')).toBeInTheDocument();
  });

  it('should render asset_add event with user name and count', () => {
    const activities = [makeActivity({ type: 'asset_add', data: { count: 5, assetIds: ['a1', 'a2'] } })];
    renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
    expect(screen.getByTestId('activity-item-act-1')).toBeInTheDocument();
    expect(screen.getByTestId('activity-item-act-1')).toHaveTextContent('Pierre added 5 photos');
  });

  it('should render member_join event', () => {
    const activities = [makeActivity({ id: 'act-2', type: 'member_join', data: { role: 'editor' } })];
    renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
    expect(screen.getByTestId('activity-item-act-2')).toBeInTheDocument();
  });

  it('should render space_rename event with compact styling', () => {
    const activities = [
      makeActivity({
        id: 'act-3',
        type: 'space_rename',
        data: { oldName: 'Old', newName: 'New' },
        userName: 'Marie',
      }),
    ];
    renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
    expect(screen.getByTestId('activity-item-act-3')).toBeInTheDocument();
  });

  it('should show day headers', () => {
    const today = new Date().toISOString();
    const activities = [makeActivity({ createdAt: today })];
    renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
    expect(screen.getByTestId('day-header-0')).toBeInTheDocument();
  });

  it('should show load more button when hasMore is true', () => {
    renderFeed({ activities: [makeActivity()], spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: true });
    expect(screen.getByTestId('load-more-button')).toBeInTheDocument();
  });

  it('should NOT show load more button when hasMore is false', () => {
    renderFeed({ activities: [makeActivity()], spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
    expect(screen.queryByTestId('load-more-button')).not.toBeInTheDocument();
  });

  describe('getDescription — new activity types', () => {
    const cases = [
      { type: 'album_link', data: { albumName: 'Trip' }, text: 'linked album "Trip"' },
      { type: 'album_unlink', data: { albumName: 'Trip' }, text: 'unlinked album "Trip"' },
      { type: 'person_update', data: { personName: 'Alice' }, text: 'updated person "Alice"' },
      { type: 'person_delete', data: { personName: 'Alice' }, text: 'deleted person "Alice"' },
      { type: 'person_merge', data: { personName: 'Alice', count: 2 }, text: 'merged 2 people into "Alice"' },
    ];

    for (const { type, data, text } of cases) {
      it(`renders "${type}" with correct description`, () => {
        const id = `act-${type}`;
        const activities = [makeActivity({ id, type, data, userName: 'Bob' })];
        renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
        expect(screen.getByTestId(`activity-item-${id}`)).toHaveTextContent(`Bob ${text}`);
      });
    }

    it('renders unknown type as "performed an action" fallback', () => {
      const activities = [makeActivity({ id: 'act-unknown', type: 'some_future_type', data: {}, userName: 'Bob' })];
      renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
      expect(screen.getByTestId('activity-item-act-unknown')).toHaveTextContent('Bob performed an action');
    });

    it('renders new-type activity with missing name field with empty quotes (no crash)', () => {
      const activities = [makeActivity({ id: 'act-noname', type: 'album_link', data: {}, userName: 'Bob' })];
      renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
      expect(screen.getByTestId('activity-item-act-noname')).toHaveTextContent('Bob linked album ""');
    });
  });
});
