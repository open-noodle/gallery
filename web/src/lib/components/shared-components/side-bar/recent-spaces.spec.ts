import { UserAvatarColor } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import RecentSpaces from '$lib/components/shared-components/side-bar/recent-spaces.svelte';
import { recentSpaceAlbumsExpanded } from '$lib/stores/preferences.store';
import { pinnedSpaceIds } from '$lib/stores/space-view.store';
import { userInteraction } from '$lib/stores/user.svelte';
import { handleError } from '$lib/utils/handle-error';
import { sharedSpaceFactory } from '@test-data/factories/shared-space-factory';
import { sharedSpaceLinkedAlbumFactory } from '@test-data/factories/shared-space-linked-album-factory';

const mockPage = vi.hoisted(() => ({ url: new URL('https://gallery.test/photos') }));
vi.mock('$app/state', () => ({ page: mockPage }));

vi.mock('$lib/utils/handle-error', () => ({
  handleError: vi.fn(),
}));

vi.mock('$lib/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils')>()),
  getAssetMediaUrl: vi.fn(({ id }: { id: string }) => `/api/assets/${id}/thumbnail?edited=true`),
}));

describe('RecentSpaces component', () => {
  beforeAll(async () => {
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
    userInteraction.recentSpaces = undefined;
    pinnedSpaceIds.set([]);
    recentSpaceAlbumsExpanded.set({});
    userInteraction.spaceAlbums = undefined;
    mockPage.url = new URL('https://gallery.test/photos');
  });

  const renderAndFlush = async () => {
    render(RecentSpaces);
    await tick();
    await tick();
  };

  describe('core behavior', () => {
    it('calls getAllSpaces on mount when cache is empty', async () => {
      sdkMock.getAllSpaces.mockResolvedValueOnce([]);
      await renderAndFlush();
      expect(sdkMock.getAllSpaces).toHaveBeenCalledTimes(1);
    });

    it('does not call getAllSpaces when cache is populated', async () => {
      userInteraction.recentSpaces = [sharedSpaceFactory.build()];
      await renderAndFlush();
      expect(sdkMock.getAllSpaces).not.toHaveBeenCalled();
    });

    it('sorts pinned spaces first, then by lastActivityAt descending', async () => {
      const pinned = sharedSpaceFactory.build({
        id: 'pinned-1',
        name: 'Pinned',
        lastActivityAt: '2024-01-01T00:00:00Z',
      });
      const recent = sharedSpaceFactory.build({
        id: 'recent-1',
        name: 'Recent',
        lastActivityAt: '2024-06-01T00:00:00Z',
      });
      const old = sharedSpaceFactory.build({ id: 'old-1', name: 'Old', lastActivityAt: '2024-03-01T00:00:00Z' });

      pinnedSpaceIds.set(['pinned-1']);
      sdkMock.getAllSpaces.mockResolvedValueOnce([recent, old, pinned]);
      await renderAndFlush();

      const links = screen.getAllByRole('link');
      expect(links).toHaveLength(3);
      expect(links[0]).toHaveAttribute('href', '/spaces/pinned-1');
      expect(links[1]).toHaveAttribute('href', '/spaces/recent-1');
      expect(links[2]).toHaveAttribute('href', '/spaces/old-1');
    });

    it('takes only top 3 spaces', async () => {
      const spaces = Array.from({ length: 5 }, (_, i) =>
        sharedSpaceFactory.build({ lastActivityAt: `2024-0${5 - i}-01T00:00:00Z` }),
      );

      sdkMock.getAllSpaces.mockResolvedValueOnce(spaces);
      await renderAndFlush();

      const links = screen.getAllByRole('link');
      expect(links).toHaveLength(3);
    });

    it('links to Route.viewSpace for each space', async () => {
      const space = sharedSpaceFactory.build({ id: 'abc-123' });
      sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
      await renderAndFlush();

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', '/spaces/abc-123');
    });

    it('renders nothing when API returns zero spaces', async () => {
      sdkMock.getAllSpaces.mockResolvedValueOnce([]);
      await renderAndFlush();

      expect(screen.queryAllByRole('link')).toHaveLength(0);
    });
  });

  // The sidebar always identifies a space by its thumbnail. New-activity is still surfaced on the
  // Spaces page (space card / table) and by the in-timeline new-assets divider, so the sidebar
  // doesn't trade the space's identity for an activity dot.
  describe('space thumbnail', () => {
    it('shows the space thumbnail when there are no new assets', async () => {
      const space = sharedSpaceFactory.build({
        id: 'thumb-1',
        newAssetCount: 0,
        thumbnailAssetId: 'asset-thumb-1',
      });
      sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
      await renderAndFlush();

      const thumbnail = screen.getByTestId('sidebar-space-thumbnail-thumb-1');
      expect(thumbnail).toHaveClass('h-6', 'w-6', 'bg-cover');
      expect(thumbnail.getAttribute('style')).toContain(
        'background-image: url("/api/assets/asset-thumb-1/thumbnail?edited=true")',
      );
    });

    it('keeps showing the thumbnail when the space has new assets', async () => {
      const space = sharedSpaceFactory.build({
        id: 'thumb-2',
        newAssetCount: 5,
        color: UserAvatarColor.Blue,
        thumbnailAssetId: 'asset-thumb-2',
      });
      sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
      await renderAndFlush();

      const thumbnail = screen.getByTestId('sidebar-space-thumbnail-thumb-2');
      expect(thumbnail.getAttribute('style')).toContain(
        'background-image: url("/api/assets/asset-thumb-2/thumbnail?edited=true")',
      );
      expect(screen.queryByTestId('sidebar-space-dot-thumb-2')).not.toBeInTheDocument();
    });

    it('never renders an activity dot, whatever the space colour', async () => {
      const spaces = [
        sharedSpaceFactory.build({ id: 'blue-1', newAssetCount: 3, color: UserAvatarColor.Blue }),
        sharedSpaceFactory.build({ id: 'red-1', newAssetCount: 3, color: UserAvatarColor.Red }),
        sharedSpaceFactory.build({ id: 'null-color', newAssetCount: 2, color: null }),
      ];
      sdkMock.getAllSpaces.mockResolvedValueOnce(spaces);
      await renderAndFlush();

      expect(screen.queryAllByTestId(/^sidebar-space-dot-/)).toHaveLength(0);
      expect(screen.queryAllByTestId(/^sidebar-space-thumbnail-/)).toHaveLength(3);
    });

    it('falls back to the placeholder square when the space has no thumbnail asset', async () => {
      const space = sharedSpaceFactory.build({ id: 'no-thumb', newAssetCount: 4, thumbnailAssetId: null });
      sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
      await renderAndFlush();

      const thumbnail = screen.getByTestId('sidebar-space-thumbnail-no-thumb');
      expect(thumbnail.getAttribute('style')).toBeFalsy();
      expect(screen.queryByTestId('sidebar-space-dot-no-thumb')).not.toBeInTheDocument();
    });
  });

  describe('sorting edge cases', () => {
    it('sorts null lastActivityAt to the end', async () => {
      const recent = sharedSpaceFactory.build({ id: 'recent', lastActivityAt: '2024-06-01T00:00:00Z' });
      const nullActivity = sharedSpaceFactory.build({ id: 'null-activity', lastActivityAt: null });

      sdkMock.getAllSpaces.mockResolvedValueOnce([nullActivity, recent]);
      await renderAndFlush();

      const links = screen.getAllByRole('link');
      expect(links[0]).toHaveAttribute('href', '/spaces/recent');
      expect(links[1]).toHaveAttribute('href', '/spaces/null-activity');
    });

    it('pinned space with old activity appears before unpinned with recent activity', async () => {
      const pinnedOld = sharedSpaceFactory.build({ id: 'pinned-old', lastActivityAt: '2020-01-01T00:00:00Z' });
      const unpinnedRecent = sharedSpaceFactory.build({
        id: 'unpinned-recent',
        lastActivityAt: '2024-12-01T00:00:00Z',
      });

      pinnedSpaceIds.set(['pinned-old']);
      sdkMock.getAllSpaces.mockResolvedValueOnce([unpinnedRecent, pinnedOld]);
      await renderAndFlush();

      const links = screen.getAllByRole('link');
      expect(links[0]).toHaveAttribute('href', '/spaces/pinned-old');
      expect(links[1]).toHaveAttribute('href', '/spaces/unpinned-recent');
    });

    it('preserves input order when all spaces have same lastActivityAt (stable sort)', async () => {
      const sameTime = '2024-06-01T00:00:00Z';
      const a = sharedSpaceFactory.build({ id: 'a', lastActivityAt: sameTime });
      const b = sharedSpaceFactory.build({ id: 'b', lastActivityAt: sameTime });
      const c = sharedSpaceFactory.build({ id: 'c', lastActivityAt: sameTime });

      sdkMock.getAllSpaces.mockResolvedValueOnce([a, b, c]);
      await renderAndFlush();

      const links = screen.getAllByRole('link');
      expect(links).toHaveLength(3);
      expect(links[0]).toHaveAttribute('href', '/spaces/a');
      expect(links[1]).toHaveAttribute('href', '/spaces/b');
      expect(links[2]).toHaveAttribute('href', '/spaces/c');
    });

    it('fills all 3 slots with pinned spaces when 3+ are pinned', async () => {
      const spaces = Array.from({ length: 5 }, (_, i) =>
        sharedSpaceFactory.build({ id: `s${i}`, lastActivityAt: `2024-0${5 - i}-01T00:00:00Z` }),
      );

      pinnedSpaceIds.set(['s0', 's1', 's2', 's3']);
      sdkMock.getAllSpaces.mockResolvedValueOnce(spaces);
      await renderAndFlush();

      const links = screen.getAllByRole('link');
      expect(links).toHaveLength(3);
      // All 3 should be pinned spaces (sorted by activity desc among pinned)
      const hrefs = links.map((l) => l.getAttribute('href'));
      expect(hrefs.every((h) => ['s0', 's1', 's2', 's3'].some((id) => h === `/spaces/${id}`))).toBe(true);
    });
  });

  describe('error handling', () => {
    it('renders nothing when getAllSpaces rejects', async () => {
      sdkMock.getAllSpaces.mockRejectedValueOnce(new Error('Network error'));
      await renderAndFlush();

      expect(screen.queryAllByRole('link')).toHaveLength(0);
    });

    it('calls handleError on API failure', async () => {
      const error = new Error('Network error');
      sdkMock.getAllSpaces.mockRejectedValueOnce(error);
      await renderAndFlush();

      expect(handleError).toHaveBeenCalledWith(error, expect.any(String));
    });
  });

  describe('album drill-down chevron', () => {
    it('shows a chevron when albumCount > 0', async () => {
      const space = sharedSpaceFactory.build({ id: 'has-albums', albumCount: 2 });
      sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
      await renderAndFlush();

      expect(screen.getByTestId('sidebar-space-chevron-has-albums')).toBeInTheDocument();
    });

    it('shows no chevron when albumCount is 0', async () => {
      const space = sharedSpaceFactory.build({ id: 'no-albums', albumCount: 0 });
      sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
      await renderAndFlush();

      expect(screen.queryByTestId('sidebar-space-chevron-no-albums')).not.toBeInTheDocument();
    });

    it('sizes the chevron like the NavbarItem chevron it sits under', async () => {
      const space = sharedSpaceFactory.build({ id: 'space-a', albumCount: 2 });
      sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
      await renderAndFlush();

      // @immich/ui's NavbarItem renders its own expand/collapse chevron at size="1em"; the Spaces
      // chevron sits directly above this one, so anything larger reads as a mismatched pair.
      const icon = screen.getByTestId('sidebar-space-chevron-space-a').querySelector('svg');
      expect(icon).toHaveAttribute('width', '1em');
      expect(icon).toHaveAttribute('height', '1em');
    });

    it('shows no chevron when albumCount is undefined', async () => {
      const space = sharedSpaceFactory.build({ id: 'undef-albums' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (space as any).albumCount = undefined;
      sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
      await renderAndFlush();

      expect(screen.queryByTestId('sidebar-space-chevron-undef-albums')).not.toBeInTheDocument();
    });
  });

  describe('pin reactivity', () => {
    it('re-sorts when pinnedSpaceIds changes', async () => {
      const a = sharedSpaceFactory.build({ id: 'a', lastActivityAt: '2024-01-01T00:00:00Z' });
      const b = sharedSpaceFactory.build({ id: 'b', lastActivityAt: '2024-06-01T00:00:00Z' });

      sdkMock.getAllSpaces.mockResolvedValueOnce([a, b]);
      await renderAndFlush();

      // Initially: b first (more recent), a second
      let links = screen.getAllByRole('link');
      expect(links[0]).toHaveAttribute('href', '/spaces/b');
      expect(links[1]).toHaveAttribute('href', '/spaces/a');

      // Pin 'a' — should now appear first
      pinnedSpaceIds.set(['a']);
      await tick();
      await tick();

      links = screen.getAllByRole('link');
      expect(links[0]).toHaveAttribute('href', '/spaces/a');
      expect(links[1]).toHaveAttribute('href', '/spaces/b');
    });
  });

  describe('album drill-down list', () => {
    const buildSpaceWithAlbums = (albums: number) =>
      sharedSpaceFactory.build({ id: 'space-a', albumCount: albums, newAssetCount: 0 });

    it('fetches albums once on first expand and caches on the second', async () => {
      const space = buildSpaceWithAlbums(2);
      const albums = sharedSpaceLinkedAlbumFactory.buildList(2);
      sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
      sdkMock.getSharedSpaceAlbums.mockResolvedValue(albums);
      await renderAndFlush();

      await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
      await tick();
      await tick();
      expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledTimes(1);
      expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledWith({ id: 'space-a' });

      // collapse then expand again — served from cache, no second call
      await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
      await tick();
      await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
      await tick();
      await tick();
      expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledTimes(1);
    });

    it('renders albums sorted by linkedAt descending, sliced to three', async () => {
      const space = buildSpaceWithAlbums(4);
      const albums = [
        sharedSpaceLinkedAlbumFactory.build({ id: 'old', albumName: 'Old', linkedAt: '2024-01-01T00:00:00Z' }),
        sharedSpaceLinkedAlbumFactory.build({ id: 'new', albumName: 'New', linkedAt: '2024-06-01T00:00:00Z' }),
        sharedSpaceLinkedAlbumFactory.build({ id: 'mid', albumName: 'Mid', linkedAt: '2024-03-01T00:00:00Z' }),
        sharedSpaceLinkedAlbumFactory.build({ id: 'older', albumName: 'Older', linkedAt: '2023-01-01T00:00:00Z' }),
      ];
      sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
      sdkMock.getSharedSpaceAlbums.mockResolvedValue(albums);
      await renderAndFlush();

      await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
      await tick();
      await tick();

      const rows = screen.getAllByTestId(/^sidebar-space-album-/);
      expect(rows.map((r) => r.getAttribute('href'))).toEqual([
        '/spaces/space-a/albums/new',
        '/spaces/space-a/albums/mid',
        '/spaces/space-a/albums/old',
      ]);
    });

    it('renders nothing when the fetch resolves empty despite a stale albumCount > 0', async () => {
      const space = buildSpaceWithAlbums(2); // stale count says 2...
      sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
      sdkMock.getSharedSpaceAlbums.mockResolvedValue([]); // ...but the space actually has none now
      await renderAndFlush();

      await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
      await tick();
      await tick();

      // No album rows, no "See all", no crash — the derived `expanded` collapses on an empty result.
      expect(screen.queryAllByTestId(/^sidebar-space-album-/)).toHaveLength(0);
      expect(screen.queryByTestId('sidebar-space-see-all-space-a')).not.toBeInTheDocument();
      // Cached empty → a second expand does not refetch.
      await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
      await tick();
      await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
      await tick();
      await tick();
      expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledTimes(1);
    });

    it('toasts and collapses on fetch failure', async () => {
      const space = buildSpaceWithAlbums(1);
      sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
      sdkMock.getSharedSpaceAlbums.mockRejectedValueOnce(new Error('nope'));
      await renderAndFlush();

      await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
      await tick();
      await tick();

      expect(handleError).toHaveBeenCalledWith(expect.any(Error), expect.any(String));
      expect(screen.queryAllByTestId(/^sidebar-space-album-/)).toHaveLength(0);
    });

    it('shows no "See all" row at exactly three albums', async () => {
      const space = sharedSpaceFactory.build({ id: 'space-a', albumCount: 3, newAssetCount: 0 });
      sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
      sdkMock.getSharedSpaceAlbums.mockResolvedValue(sharedSpaceLinkedAlbumFactory.buildList(3));
      await renderAndFlush();

      await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
      await tick();
      await tick();

      expect(screen.queryByTestId('sidebar-space-see-all-space-a')).not.toBeInTheDocument();
    });

    it('shows a "See all (N)" row above three albums using the fetched length', async () => {
      const space = sharedSpaceFactory.build({ id: 'space-a', albumCount: 3, newAssetCount: 0 }); // stale count
      sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
      sdkMock.getSharedSpaceAlbums.mockResolvedValue(sharedSpaceLinkedAlbumFactory.buildList(5)); // fetched truth
      await renderAndFlush();

      await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
      await tick();
      await tick();

      const seeAll = screen.getByTestId('sidebar-space-see-all-space-a');
      expect(seeAll).toHaveAttribute('href', '/spaces/space-a/albums');
      expect(seeAll.textContent).toContain('5');
    });

    it('auto-loads albums on mount for a persisted-expanded space without a click', async () => {
      const space = buildSpaceWithAlbums(2);
      const albums = sharedSpaceLinkedAlbumFactory.buildList(2);
      recentSpaceAlbumsExpanded.set({ 'space-a': true });
      sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
      sdkMock.getSharedSpaceAlbums.mockResolvedValue(albums);

      await renderAndFlush();
      await tick();
      await tick();

      expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledTimes(1);
      expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledWith({ id: 'space-a' });
      expect(screen.getAllByTestId(/^sidebar-space-album-/)).toHaveLength(2);
    });

    // Only one row in the tree should read as selected at a time. Opening an album hands the
    // selection down from the space to that album; the space keeps it everywhere else, including
    // its own albums *list* page, which has no row of its own.
    describe('selected row', () => {
      const renderExpanded = async () => {
        const space = sharedSpaceFactory.build({ id: 'space-a', albumCount: 4, newAssetCount: 0 });
        sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
        sdkMock.getSharedSpaceAlbums.mockResolvedValue([
          sharedSpaceLinkedAlbumFactory.build({ id: 'album-1', linkedAt: '2024-03-01T00:00:00Z' }),
          sharedSpaceLinkedAlbumFactory.build({ id: 'album-2', linkedAt: '2024-02-01T00:00:00Z' }),
        ]);
        recentSpaceAlbumsExpanded.set({ 'space-a': true });
        await renderAndFlush();
        await tick();
        await tick();
      };

      it('selects the space row on the space page', async () => {
        mockPage.url = new URL('https://gallery.test/spaces/space-a');
        await renderExpanded();

        expect(screen.getByTestId('sidebar-space-space-a')).toHaveAttribute('aria-current', 'page');
        expect(screen.getByTestId('sidebar-space-album-album-1')).not.toHaveAttribute('aria-current');
      });

      it('hands the selection to the album row on an album page', async () => {
        mockPage.url = new URL('https://gallery.test/spaces/space-a/albums/album-1');
        await renderExpanded();

        expect(screen.getByTestId('sidebar-space-album-album-1')).toHaveAttribute('aria-current', 'page');
        expect(screen.getByTestId('sidebar-space-space-a')).not.toHaveAttribute('aria-current');
      });

      it('selects only the open album, not its siblings', async () => {
        mockPage.url = new URL('https://gallery.test/spaces/space-a/albums/album-2');
        await renderExpanded();

        expect(screen.getByTestId('sidebar-space-album-album-2')).toHaveAttribute('aria-current', 'page');
        expect(screen.getByTestId('sidebar-space-album-album-1')).not.toHaveAttribute('aria-current');
      });

      it('keeps the album row selected while viewing a photo inside it', async () => {
        mockPage.url = new URL('https://gallery.test/spaces/space-a/albums/album-1/photos/asset-1');
        await renderExpanded();

        expect(screen.getByTestId('sidebar-space-album-album-1')).toHaveAttribute('aria-current', 'page');
        expect(screen.getByTestId('sidebar-space-space-a')).not.toHaveAttribute('aria-current');
      });

      it('keeps the space row selected on its albums list page, which has no row of its own', async () => {
        mockPage.url = new URL('https://gallery.test/spaces/space-a/albums');
        await renderExpanded();

        expect(screen.getByTestId('sidebar-space-space-a')).toHaveAttribute('aria-current', 'page');
      });
    });

    it('keeps the chevron anchored to the space row when expanded', async () => {
      const space = sharedSpaceFactory.build({ id: 'space-a', albumCount: 4, newAssetCount: 0 });
      sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
      sdkMock.getSharedSpaceAlbums.mockResolvedValue(sharedSpaceLinkedAlbumFactory.buildList(4));
      await renderAndFlush();

      await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
      await tick();
      await tick();

      // The chevron is absolutely positioned and vertically centred (top-1/2 + -translate-y-1/2),
      // so its containing block decides what it centres against. That block must wrap the space
      // row alone — if the expanded album rows share the positioning context, the chevron drifts
      // down to the middle of the whole expanded group instead of sitting beside the space name.
      const chevron = screen.getByTestId('sidebar-space-chevron-space-a');
      const positioningContext = chevron.offsetParent ?? chevron.closest('.relative');
      expect(positioningContext).not.toBeNull();
      expect(positioningContext).toContainElement(screen.getByTestId('sidebar-space-space-a'));

      for (const albumRow of screen.getAllByTestId(/^sidebar-space-album-/)) {
        expect(positioningContext).not.toContainElement(albumRow);
      }
      expect(positioningContext).not.toContainElement(screen.getByTestId('sidebar-space-see-all-space-a'));
    });
  });
});
