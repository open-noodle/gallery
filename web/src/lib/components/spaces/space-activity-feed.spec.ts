import TestWrapper from '#lib/components/TestWrapper.svelte';
import SpaceActivityFeed from '#lib/components/spaces/space-activity-feed.svelte';
import type { Component } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

async function renderFeed(props: Record<string, unknown>) {
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
    register('en-US', () => import('#i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  it('should show empty state when no activities', async () => {
    await renderFeed({ activities: [], spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
    expect(page.getByTestId('activity-empty-state').element()).toBeInTheDocument();
  });

  it('should render asset_add event with user name and count', async () => {
    const activities = [makeActivity({ type: 'asset_add', data: { count: 5, assetIds: ['a1', 'a2'] } })];
    await renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
    expect(page.getByTestId('activity-item-act-1').element()).toBeInTheDocument();
    expect(page.getByTestId('activity-item-act-1').element()).toMatchTextContent('Pierre added 5 photos');
  });

  it('should render member_join event', async () => {
    const activities = [makeActivity({ id: 'act-2', type: 'member_join', data: { role: 'editor' } })];
    await renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
    expect(page.getByTestId('activity-item-act-2').element()).toBeInTheDocument();
  });

  it('should name the inviter when member_join carries invitedByName', async () => {
    const activities = [
      makeActivity({
        id: 'act-4',
        type: 'member_join',
        userName: 'Ben',
        data: { role: 'viewer', invitedByName: 'Anna' },
      }),
    ];
    await renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
    expect(page.getByTestId('activity-item-act-4').element()).toMatchTextContent('Anna added Ben as viewer');
  });

  it('should fall back to the joined-as line when member_join has no invitedByName', async () => {
    const activities = [makeActivity({ id: 'act-5', type: 'member_join', userName: 'Ben', data: { role: 'viewer' } })];
    await renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
    expect(page.getByTestId('activity-item-act-5').element()).toMatchTextContent('Ben joined as viewer');
  });

  it('should render space_rename event with compact styling', async () => {
    const activities = [
      makeActivity({
        id: 'act-3',
        type: 'space_rename',
        data: { oldName: 'Old', newName: 'New' },
        userName: 'Marie',
      }),
    ];
    await renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
    expect(page.getByTestId('activity-item-act-3').element()).toBeInTheDocument();
  });

  it('should show day headers', async () => {
    const today = new Date().toISOString();
    const activities = [makeActivity({ createdAt: today })];
    await renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
    expect(page.getByTestId('day-header-0').element()).toBeInTheDocument();
  });

  it('should show load more button when hasMore is true', async () => {
    await renderFeed({ activities: [makeActivity()], spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: true });
    expect(page.getByTestId('load-more-button').element()).toBeInTheDocument();
  });

  it('should NOT show load more button when hasMore is false', async () => {
    await renderFeed({ activities: [makeActivity()], spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
    expect(page.getByTestId('load-more-button').query()).not.toBeInTheDocument();
  });

  describe('getDescription — new activity types', () => {
    const cases = [
      { type: 'album_link', data: { albumName: 'Trip' }, text: 'linked album "Trip"' },
      { type: 'album_unlink', data: { albumName: 'Trip' }, text: 'unlinked album "Trip"' },
      { type: 'person_update', data: { personName: 'Alice' }, text: 'updated person "Alice"' },
      { type: 'person_delete', data: { personName: 'Alice' }, text: 'deleted person "Alice"' },
      { type: 'person_merge', data: { personName: 'Alice', count: 2 }, text: 'merged 2 people into "Alice"' },
      { type: 'asset_edit', data: { count: 3 }, text: 'edited 3 photos' },
      { type: 'asset_edit', data: { count: 1 }, text: 'edited 1 photo' },
    ];

    for (const { type, data, text } of cases) {
      it(`renders "${type}" with correct description`, async () => {
        const id = `act-${type}`;
        const activities = [makeActivity({ id, type, data, userName: 'Bob' })];
        await renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
        expect(page.getByTestId(`activity-item-${id}`).element()).toMatchTextContent(`Bob ${text}`);
      });
    }

    it('renders unknown type as "performed an action" fallback', async () => {
      const activities = [makeActivity({ id: 'act-unknown', type: 'some_future_type', data: {}, userName: 'Bob' })];
      await renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
      expect(page.getByTestId('activity-item-act-unknown').element()).toMatchTextContent('Bob performed an action');
    });

    it('renders new-type activity with missing name field with empty quotes (no crash)', async () => {
      const activities = [makeActivity({ id: 'act-noname', type: 'album_link', data: {}, userName: 'Bob' })];
      await renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
      expect(page.getByTestId('activity-item-act-noname').element()).toMatchTextContent('Bob linked album ""');
    });

    // F-24/F-25 (spec §6.7): the two new face-attribution types render their translated string.
    it('renders "person_face_assign" with correct description', async () => {
      const activities = [
        makeActivity({ id: 'act-assign', type: 'person_face_assign', data: { count: 1 }, userName: 'Bob' }),
      ];
      await renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
      expect(page.getByTestId('activity-item-act-assign').element()).toMatchTextContent('Bob named 1 face');
    });

    it('renders "person_face_assign" with plural count', async () => {
      const activities = [
        makeActivity({ id: 'act-assign-plural', type: 'person_face_assign', data: { count: 3 }, userName: 'Bob' }),
      ];
      await renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
      expect(page.getByTestId('activity-item-act-assign-plural').element()).toMatchTextContent('Bob named 3 faces');
    });

    it('renders "person_face_detach" with correct description', async () => {
      const activities = [
        makeActivity({ id: 'act-detach', type: 'person_face_detach', data: { count: 1 }, userName: 'Bob' }),
      ];
      await renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
      expect(page.getByTestId('activity-item-act-detach').element()).toMatchTextContent('Bob removed 1 face');
    });
  });

  describe('face-attribution activity impact tier', () => {
    // person_face_assign/detach must sit in MEDIUM_TYPES: a row with an avatar and a left
    // border accent (`border-l-2`, unique to the medium branch), never the high-impact card
    // wrapper (`rounded-lg`, unique to asset_add/asset_remove) and never the low-tier dot row
    // (no avatar `<figure>` at all).
    it('renders "person_face_assign" in the medium-impact tier', async () => {
      const activities = [
        makeActivity({ id: 'act-assign-tier', type: 'person_face_assign', data: { count: 1 }, userName: 'Bob' }),
      ];
      await renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
      const item = page.getByTestId('activity-item-act-assign-tier').element();
      expect(item.className).toContain('border-l-2');
      expect(item.className).not.toContain('rounded-lg');
      expect(item.querySelector('figure')).not.toBeNull();
    });

    it('renders "person_face_detach" in the medium-impact tier', async () => {
      const activities = [
        makeActivity({ id: 'act-detach-tier', type: 'person_face_detach', data: { count: 1 }, userName: 'Bob' }),
      ];
      await renderFeed({ activities, spaceColor: 'primary', onLoadMore: vi.fn(), hasMore: false });
      const item = page.getByTestId('activity-item-act-detach-tier').element();
      expect(item.className).toContain('border-l-2');
      expect(item.className).not.toContain('rounded-lg');
      expect(item.querySelector('figure')).not.toBeNull();
    });
  });
});
