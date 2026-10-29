import { getAssetSpaces, getSharedSpaceAssetLinkedAlbums, removeAssets, SharedSpaceRole } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { eventManager } from '$lib/managers/event-manager.svelte';
import { handleError } from '$lib/utils/handle-error';
import { sharedSpaceFactory } from '@test-data/factories/shared-space-factory';
import { canRemoveFrom, fetchSelectionSpaces, removableSpaces, removeFromSpace } from './space-removal';

vi.mock('@immich/sdk', async (orig) => ({
  ...(await orig<typeof import('@immich/sdk')>()),
  getAssetSpaces: vi.fn(),
  removeAssets: vi.fn(),
  getSharedSpaceAssetLinkedAlbums: vi.fn(),
}));
vi.mock('@immich/ui', async (orig) => ({
  ...(await orig<typeof import('@immich/ui')>()),
  modalManager: { showDialog: vi.fn() },
  toastManager: { primary: vi.fn(), danger: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('$lib/utils/handle-error', () => ({ handleError: vi.fn() }));

// The test locale returns each message's key: the assertions name the message chosen.

const member = (userId: string, role: SharedSpaceRole) => ({ userId, role }) as never;
const space = (
  id: string,
  name: string,
  members: unknown[] = [member('me', SharedSpaceRole.Editor)],
  createdById = 'other',
) => sharedSpaceFactory.build({ id, name, createdById, members: members as never });

describe('canRemoveFrom', () => {
  it('lets the creator, an owner and an editor remove, not a viewer or a stranger', () => {
    expect(canRemoveFrom(space('a', 'A', [], 'me'), 'me')).toBe(true);
    expect(canRemoveFrom(space('a', 'A', [member('me', SharedSpaceRole.Owner)]), 'me')).toBe(true);
    expect(canRemoveFrom(space('a', 'A', [member('me', SharedSpaceRole.Editor)]), 'me')).toBe(true);
    expect(canRemoveFrom(space('a', 'A', [member('me', SharedSpaceRole.Viewer)]), 'me')).toBe(false);
    expect(canRemoveFrom(space('a', 'A', [member('someone', SharedSpaceRole.Owner)]), 'me')).toBe(false);
  });
});

describe('removableSpaces', () => {
  it('groups the selected assets by space, keeps the spaces the user may remove from, and puts the fullest first', () => {
    const spaces = [
      space('gamma', 'Gamma'),
      space('beta', 'Beta'),
      space('alpha', 'Alpha'),
      space('viewed', 'Viewed', [member('me', SharedSpaceRole.Viewer)]),
    ];
    const answers = [
      { assetId: 'a1', spaceIds: ['beta', 'viewed'] },
      { assetId: 'a2', spaceIds: ['beta'] },
      { assetId: 'a3', spaceIds: ['gamma', 'alpha', 'unknown'] },
    ];

    expect(removableSpaces(answers, spaces, 'me').map(({ space, assetIds }) => [space.id, assetIds])).toEqual([
      ['beta', ['a1', 'a2']],
      ['alpha', ['a3']],
      ['gamma', ['a3']],
    ]);
  });
});

describe('fetchSelectionSpaces', () => {
  beforeEach(() => {
    vi.mocked(getAssetSpaces).mockReset();
    vi.mocked(getAssetSpaces).mockImplementation(({ assetSpacesDto }) =>
      Promise.resolve({ assets: [{ assetId: assetSpacesDto.assetIds[0], spaceIds: ['family'] }] }),
    );
  });

  it('asks in batches of 1000 and merges the answers', async () => {
    const ids = Array.from({ length: 2500 }, (_, index) => `a${index}`);

    const answers = await fetchSelectionSpaces(ids);

    expect(vi.mocked(getAssetSpaces).mock.calls.map(([{ assetSpacesDto }]) => assetSpacesDto.assetIds.length)).toEqual([
      1000, 1000, 500,
    ]);
    expect(answers.map(({ assetId }) => assetId)).toEqual(['a0', 'a1000', 'a2000']);
  });

  it('stops after the current batch once aborted', async () => {
    const controller = new AbortController();
    vi.mocked(getAssetSpaces).mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve({ assets: [] });
    });

    await fetchSelectionSpaces(
      Array.from({ length: 2500 }, (_, index) => `a${index}`),
      controller.signal,
    );

    expect(getAssetSpaces).toHaveBeenCalledOnce();
  });
});

describe('removeFromSpace', () => {
  let emit: ReturnType<typeof vi.spyOn>;
  let clear: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(modalManager.showDialog).mockResolvedValue(true);
    vi.mocked(getSharedSpaceAssetLinkedAlbums).mockResolvedValue([]);
    emit = vi.spyOn(eventManager, 'emit');
    clear = vi.spyOn(assetMultiSelectManager, 'clear').mockImplementation(() => {});
  });

  afterEach(() => {
    emit.mockRestore();
    clear.mockRestore();
  });

  it('removes nothing when the user declines', async () => {
    vi.mocked(modalManager.showDialog).mockResolvedValue(false);

    expect(await removeFromSpace('family', ['a1'])).toEqual([]);
    expect(removeAssets).not.toHaveBeenCalled();
  });

  it('removes, tells the badges and the timelines, and clears the selection', async () => {
    vi.mocked(removeAssets).mockResolvedValue(['a1', 'a2']);

    expect(await removeFromSpace('family', ['a1', 'a2'])).toEqual(['a1', 'a2']);

    expect(removeAssets).toHaveBeenCalledWith({ id: 'family', sharedSpaceAssetRemoveDto: { assetIds: ['a1', 'a2'] } });
    expect(emit).toHaveBeenCalledWith('SpaceRemoveAssets', { assetIds: ['a1', 'a2'], spaceId: 'family' });
    expect(toastManager.success).toHaveBeenCalledWith('assets_removed_count');
    expect(clear).toHaveBeenCalledOnce();
  });

  it('unselects the photos it removed and keeps the ones left on a partial removal', async () => {
    const unselect = vi.spyOn(assetMultiSelectManager, 'removeAssetFromMultiselectGroup').mockImplementation(() => {});
    vi.mocked(removeAssets).mockResolvedValue(['a1']);

    await removeFromSpace('family', ['a1', 'a2']);

    expect(unselect).toHaveBeenCalledExactlyOnceWith('a1');
    expect(clear).not.toHaveBeenCalled();
    unselect.mockRestore();
  });

  it('names the linked album of a photo it could not remove, and keeps the selection', async () => {
    vi.mocked(removeAssets).mockResolvedValue(['a1']);
    vi.mocked(getSharedSpaceAssetLinkedAlbums).mockResolvedValue([{ albumId: 'trip', albumName: 'Trip' }]);

    await removeFromSpace('family', ['a1', 'a2']);

    expect(getSharedSpaceAssetLinkedAlbums).toHaveBeenCalledWith({
      id: 'family',
      sharedSpaceAssetRemoveDto: { assetIds: ['a2'] },
    });
    expect(toastManager.warning).toHaveBeenCalledWith('remove_from_space_album_blocked');
    expect(clear).not.toHaveBeenCalled();
  });

  it('explains a photo that a linked library brings', async () => {
    vi.mocked(removeAssets).mockResolvedValue([]);

    await removeFromSpace('family', ['a1', 'a2']);

    expect(toastManager.warning).toHaveBeenCalledWith('remove_from_space_library_blocked');
    expect(emit).not.toHaveBeenCalledWith('SpaceRemoveAssets', expect.anything());
  });

  it('falls back to the general explanation when the album lookup fails', async () => {
    vi.mocked(removeAssets).mockResolvedValue([]);
    vi.mocked(getSharedSpaceAssetLinkedAlbums).mockRejectedValue(new Error('offline'));

    await removeFromSpace('family', ['a1']);

    expect(toastManager.warning).toHaveBeenCalledWith('no_assets_removed_from_space');
  });

  it('reports a refusal and removes nothing', async () => {
    vi.mocked(removeAssets).mockRejectedValue(new Error('403'));

    expect(await removeFromSpace('family', ['a1'])).toEqual([]);

    expect(handleError).toHaveBeenCalledOnce();
    expect(emit).not.toHaveBeenCalledWith('SpaceRemoveAssets', expect.anything());
  });
});
