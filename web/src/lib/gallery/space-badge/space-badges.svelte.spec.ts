import { getAllSpaces, getAssetSpaces } from '@immich/sdk';
import { eventManager } from '$lib/managers/event-manager.svelte';
import { userInteraction } from '$lib/stores/user.svelte';
import { sharedSpaceFactory } from '@test-data/factories/shared-space-factory';
import { spaceBadges } from './space-badges.svelte';

vi.mock('@immich/sdk', async (orig) => ({
  ...(await orig<typeof import('@immich/sdk')>()),
  getAssetSpaces: vi.fn(),
  getAllSpaces: vi.fn(),
}));
vi.mock('$lib/utils/handle-error', () => ({ handleError: vi.fn() }));

const family = sharedSpaceFactory.build({ id: 'family', name: 'Family' });
const trips = sharedSpaceFactory.build({ id: 'trips', name: 'Trips' });

const answer = (spaces: Record<string, string[]>) =>
  vi.mocked(getAssetSpaces).mockImplementation(({ assetSpacesDto }) =>
    Promise.resolve({
      assets: assetSpacesDto.assetIds
        .filter((assetId) => spaces[assetId])
        .map((assetId) => ({ assetId, spaceIds: spaces[assetId] })),
    }),
  );

/** Holds the next answer until `release` is called. */
const holdAnswer = (spaces: Record<string, string[]>) => {
  let release = () => {};
  vi.mocked(getAssetSpaces).mockImplementationOnce(
    ({ assetSpacesDto }) =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            assets: assetSpacesDto.assetIds
              .filter((assetId) => spaces[assetId])
              .map((assetId) => ({ assetId, spaceIds: spaces[assetId] })),
          });
      }),
  );
  return () => release();
};

const askedFor = () => vi.mocked(getAssetSpaces).mock.calls.map(([{ assetSpacesDto }]) => assetSpacesDto.assetIds);

const ask = async (...assetIds: string[]) => {
  for (const assetId of assetIds) {
    spaceBadges.request(assetId);
  }
  await vi.runAllTimersAsync();
};

describe('spaceBadges', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getAssetSpaces).mockReset();
    vi.mocked(getAllSpaces).mockReset().mockResolvedValue([family, trips]);
    spaceBadges.reset();
    userInteraction.recentSpaces = [family, trips];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks once for the thumbnails mounted together, and answers from what it learnt', async () => {
    answer({ a: ['family'], b: ['family', 'trips'] });
    for (const assetId of ['a', 'b', 'c', 'a']) {
      spaceBadges.request(assetId);
    }
    expect(spaceBadges.spacesOf('a')).toBeUndefined();

    await vi.runAllTimersAsync();

    expect(askedFor()).toEqual([['a', 'b', 'c']]);
    expect(spaceBadges.spacesOf('a')).toEqual([family]);
    expect(spaceBadges.spacesOf('b')).toEqual([family, trips]);
    expect(spaceBadges.spacesOf('c')).toEqual([]);
    expect([spaceBadges.inSomeSpace('a'), spaceBadges.inSomeSpace('c')]).toEqual([true, false]);

    await ask('b');
    expect(askedFor()).toHaveLength(1);
  });

  it('asks in batches of 500', async () => {
    answer({});
    await ask(...Array.from({ length: 501 }, (_, index) => `asset-${index}`));

    expect(askedFor().map((batch) => batch.length)).toEqual([500, 1]);
  });

  it('keeps the last spaces list while the shared one reloads, and drops a space no longer in it', async () => {
    answer({ a: ['family', 'trips'] });
    await ask('a');

    userInteraction.recentSpaces = undefined;
    expect(spaceBadges.spacesOf('a')).toEqual([family, trips]);

    userInteraction.recentSpaces = [trips];
    expect(spaceBadges.spacesOf('a')).toEqual([trips]);
  });

  it('loads the spaces list only for an asset in a space, and waits after a failure', async () => {
    // A fresh session that has never had the list.
    userInteraction.recentSpaces = undefined;
    spaceBadges.reset();
    answer({ a: [] });
    await ask('a');
    expect(getAllSpaces).not.toHaveBeenCalled();

    vi.mocked(getAllSpaces).mockRejectedValue(new Error('offline'));
    answer({ b: ['family'], c: ['family'], d: ['family'] });
    await ask('b');
    await ask('c');
    expect(getAllSpaces).toHaveBeenCalledTimes(1);
    expect(spaceBadges.spacesOf('b')).toBeUndefined();

    vi.mocked(getAllSpaces).mockResolvedValue([family]);
    await vi.advanceTimersByTimeAsync(60_000);
    await ask('d');
    expect(getAllSpaces).toHaveBeenCalledTimes(2);
    expect(spaceBadges.spacesOf('b')).toEqual([family]);
  });

  it('asks again about the assets a space or album change names, showing the old answer meanwhile', async () => {
    answer({ a: [] });
    await ask('a', 'b');

    answer({ a: ['family'] });
    for (const [event, payload] of [
      ['SpaceAddAssets', { assetIds: ['a'], spaceId: 'family' }],
      ['SpaceRemoveAssets', { assetIds: ['a'], spaceId: 'family' }],
      ['AlbumAddAssets', { assetIds: ['a'], albumIds: ['album'] }],
      ['AlbumRemoveAssets', { assetIds: ['a'], albumIds: ['album'] }],
    ] as const) {
      vi.mocked(getAssetSpaces).mockClear();
      eventManager.emit(event, payload as never);
      userInteraction.recentSpaces = [family, trips];
      await ask('a', 'b');
      expect(askedFor(), event).toEqual([['a']]);
    }
    expect(spaceBadges.spacesOf('a')).toEqual([family]);
  });

  it('asks again about every asset after a change that names none, or on another page', async () => {
    answer({ a: ['family'] });
    await ask('a');

    for (const [event, payload] of [
      ['SpaceLinkAlbum', { spaceId: 'family' }],
      ['SpaceUnlinkAlbum', { spaceId: 'family' }],
      ['AlbumDelete', {}],
      ['AppNavigate', undefined],
    ] as const) {
      vi.mocked(getAssetSpaces).mockClear();
      eventManager.emit(event, payload as never);
      userInteraction.recentSpaces = [family, trips];
      expect(spaceBadges.spacesOf('a'), event).toEqual([family]);
      await ask('a');
      expect(askedFor(), event).toEqual([['a']]);
    }
  });

  it('asks again when a change lands while the answer is on its way', async () => {
    const release = holdAnswer({});
    spaceBadges.request('a');
    await vi.advanceTimersByTimeAsync(50);

    eventManager.emit('SpaceAddAssets', { assetIds: ['a'], spaceId: 'family' });
    release();
    await vi.runAllTimersAsync();
    userInteraction.recentSpaces = [family, trips];

    answer({ a: ['family'] });
    await ask('a');
    expect(askedFor()).toEqual([['a'], ['a']]);
    expect(spaceBadges.spacesOf('a')).toEqual([family]);
  });

  it('drops what the previous session asked on logout', async () => {
    answer({ a: ['family'] });
    await ask('a');
    const release = holdAnswer({ b: ['family'] });
    spaceBadges.request('b');
    await vi.advanceTimersByTimeAsync(50);

    eventManager.emit('AuthLogout');
    release();
    await vi.runAllTimersAsync();

    expect(spaceBadges.spacesOf('a')).toBeUndefined();
    expect(spaceBadges.spacesOf('b')).toBeUndefined();
  });

  it('shows nothing when the server does not answer, and asks again later', async () => {
    vi.mocked(getAssetSpaces).mockRejectedValue(new Error('offline'));
    await ask('a');
    expect(spaceBadges.spacesOf('a')).toBeUndefined();

    answer({ a: ['trips'] });
    await ask('a');
    expect(spaceBadges.spacesOf('a')).toEqual([trips]);
  });
});
