import { AssetTypeEnum, CleanupListQueue, type CleanupAssetDto, type CleanupQueuePageDto } from '@immich/sdk';
import { CleanupQueuePager } from '$lib/gallery/cleanup/cleanup-queue-pager.svelte';

const asset = (id: string): CleanupAssetDto => ({
  id,
  city: null,
  duration: null,
  fileSize: 1,
  height: null,
  width: null,
  inAlbum: false,
  isFavorite: false,
  kept: false,
  localDateTime: '2024-01-01T00:00:00.000Z',
  originalFileName: id,
  thumbhash: null,
  type: AssetTypeEnum.Image,
});

const page = (ids: string[], nextCursor: string | null): CleanupQueuePageDto => ({
  items: ids.map((id) => asset(id)),
  groups: [],
  nextCursor,
});

describe('CleanupQueuePager', () => {
  it('walks the keyset cursor with the current filters and stops at the last page', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page(['a'], 'c1'))
      .mockResolvedValueOnce(page(['b'], null));
    const pager = new CleanupQueuePager(CleanupListQueue.SpaceHogs, () => ({ minSize: 5 }), fetch);

    await pager.loadMore();
    await pager.loadMore();
    await pager.loadMore();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, { queue: 'space_hogs', cursor: undefined, limit: 100, minSize: 5 });
    expect(fetch).toHaveBeenNthCalledWith(2, { queue: 'space_hogs', cursor: 'c1', limit: 100, minSize: 5 });
    expect(pager.items.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(pager.done).toBe(true);
  });

  it('drops a page that lands after a reset', async () => {
    let resolve: (value: CleanupQueuePageDto) => void = () => {};
    const fetch = vi
      .fn()
      .mockReturnValueOnce(new Promise((r) => (resolve = r)))
      .mockResolvedValueOnce(page(['new'], null));
    const pager = new CleanupQueuePager(CleanupListQueue.Blurry, () => ({}), fetch);

    const stale = pager.loadMore();
    pager.reset();
    await pager.loadMore();
    resolve(page(['old'], 'c1'));
    await stale;

    expect(pager.items.map(({ id }) => id)).toEqual(['new']);
    expect(pager.done).toBe(true);
  });

  it('puts removed items back where they were', async () => {
    const fetch = vi.fn().mockResolvedValue(page(['a', 'b', 'c', 'd'], null));
    const pager = new CleanupQueuePager(CleanupListQueue.Screenshots, () => ({}), fetch);
    await pager.loadMore();

    const removed = pager.removeItems(['b', 'd']);
    expect(pager.items.map(({ id }) => id)).toEqual(['a', 'c']);

    pager.restoreItems(removed);
    expect(pager.items.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('marks a failed page so the sentinel does not retry in a loop', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('boom'));
    const pager = new CleanupQueuePager(CleanupListQueue.Blurry, () => ({}), fetch);

    await expect(pager.loadMore()).rejects.toThrow('boom');

    expect(pager.failed).toBe(true);
    expect(pager.loading).toBe(false);
  });

  it('lets a second caller wait for the page already loading instead of returning empty-handed', async () => {
    let resolve!: (value: CleanupQueuePageDto) => void;
    const fetch = vi.fn(() => new Promise<CleanupQueuePageDto>((r) => (resolve = r)));
    const pager = new CleanupQueuePager(CleanupListQueue.Blurry, () => ({}), fetch);

    const first = pager.loadMore();
    let secondDone = false;
    const second = pager.loadMore().then(() => (secondDone = true));
    await Promise.resolve();
    expect(secondDone).toBe(false);

    resolve(page(['a', 'b'], null));
    await Promise.all([first, second]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(pager.items.map(({ id }) => id)).toEqual(['a', 'b']);
  });
});
