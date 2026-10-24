import { getAllSpaces, getSharedSpaceAlbums, type SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import { get } from 'svelte/store';
import { getAllSpacesQuery, getSpaceAlbumsQuery, spacesQueryKey } from '$lib/gallery/spaces/space.query';
import { eventManager } from '$lib/managers/event-manager.svelte';
import { queryClient } from '$lib/queries/client';
import { recentSpacesDropdown } from '$lib/stores/preferences.store';
import { sharedSpaceFactory } from '@test-data/factories/shared-space-factory';

vi.mock('@immich/sdk', async (orig) => ({
  ...(await orig<typeof import('@immich/sdk')>()),
  getAllSpaces: vi.fn(),
  getSharedSpaceAlbums: vi.fn(),
}));
vi.mock('$lib/utils/handle-error', () => ({ handleError: vi.fn() }));

const isInvalidated = (queryKey: readonly unknown[]) => queryClient.getQueryState(queryKey)?.isInvalidated;

describe('getAllSpacesQuery', () => {
  beforeEach(() => {
    queryClient.removeQueries({ queryKey: spacesQueryKey });
    vi.mocked(getAllSpaces).mockReset();
  });

  it('fetches the spaces list once into the shared cache', async () => {
    const spaces = [sharedSpaceFactory.build()];
    vi.mocked(getAllSpaces).mockResolvedValue(spaces);

    const [first, second] = await Promise.all([
      queryClient.fetchQuery(getAllSpacesQuery()),
      queryClient.fetchQuery(getAllSpacesQuery()),
    ]);
    await queryClient.fetchQuery(getAllSpacesQuery());

    expect(first).toEqual(spaces);
    expect(second).toEqual(spaces);
    expect(getAllSpaces).toHaveBeenCalledTimes(1);
  });

  it('retries on the next read after a failed fetch', async () => {
    const spaces = [sharedSpaceFactory.build()];
    vi.mocked(getAllSpaces).mockRejectedValueOnce(new Error('network')).mockResolvedValue(spaces);

    await expect(queryClient.fetchQuery(getAllSpacesQuery())).rejects.toThrow('network');
    await expect(queryClient.fetchQuery(getAllSpacesQuery())).resolves.toEqual(spaces);

    expect(getAllSpaces).toHaveBeenCalledTimes(2);
  });

  it.each(['SpaceAddAssets', 'SpaceRemoveAssets'] as const)('invalidates the spaces list on %s', (event) => {
    queryClient.setQueryData(spacesQueryKey, [sharedSpaceFactory.build()]);

    eventManager.emit(event, { assetIds: ['a1'], spaceId: 's1' });

    expect(isInvalidated(spacesQueryKey)).toBe(true);
  });

  it.each(['SpaceLinkAlbum', 'SpaceUnlinkAlbum'] as const)(
    "invalidates the spaces list and only that space's albums on %s",
    (event) => {
      queryClient.setQueryData(spacesQueryKey, [sharedSpaceFactory.build()]);
      queryClient.setQueryData(getSpaceAlbumsQuery('s1').queryKey, []);
      queryClient.setQueryData(getSpaceAlbumsQuery('s2').queryKey, []);

      eventManager.emit(event, { spaceId: 's1' });

      expect(isInvalidated(spacesQueryKey)).toBe(true);
      expect(isInvalidated(getSpaceAlbumsQuery('s1').queryKey)).toBe(true);
      expect(isInvalidated(getSpaceAlbumsQuery('s2').queryKey)).toBe(false);
    },
  );
});

describe('getSpaceAlbumsQuery', () => {
  beforeEach(() => {
    queryClient.removeQueries({ queryKey: spacesQueryKey });
  });

  it('lists the newest link first', async () => {
    const album = (id: string, linkedAt: string) => ({ id, linkedAt }) as SharedSpaceLinkedAlbumDto;
    vi.mocked(getSharedSpaceAlbums).mockResolvedValue([album('old', '2026-01-01'), album('new', '2026-02-01')]);

    const { select, ...options } = getSpaceAlbumsQuery('s1');
    const albums = select!(await queryClient.fetchQuery(options));

    expect(albums.map(({ id }) => id)).toEqual(['new', 'old']);
  });
});

describe('recentSpacesDropdown', () => {
  it('defaults to true', () => {
    expect(get(recentSpacesDropdown)).toBe(true);
  });
});
