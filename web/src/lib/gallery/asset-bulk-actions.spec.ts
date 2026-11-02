import { BulkIdErrorReason, removeAssetFromAlbum, type AlbumResponseDto } from '@immich/sdk';
import { modalManager, toastManager, type ActionItem } from '@immich/ui';
import type { MessageFormatter } from 'svelte-i18n';
import { getGalleryAssetBulkActions, type GalleryAssetBulkActionOptions } from '$lib/gallery/asset-actions';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import type { TimelineAsset } from '$lib/managers/timeline-manager/types';

const { mockUser } = vi.hoisted(() => ({ mockUser: { current: { id: 'me', isAdmin: false } } }));
vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    get authenticated() {
      return mockUser.current !== null;
    },
    get user() {
      return mockUser.current;
    },
  },
}));
vi.mock('@immich/sdk', async (original) => ({
  ...(await original<typeof import('@immich/sdk')>()),
  removeAssetFromAlbum: vi.fn(),
}));

const $t = ((key: string) => key) as MessageFormatter;
const upstreamItem = (title: string): ActionItem => ({ title, icon: 'icon', onAction: vi.fn() });
const upstream = () => ({
  AddToAlbum: upstreamItem('add_to_album'),
  CreateSharedLink: upstreamItem('share'),
  RemoveFromAlbum: { ...upstreamItem('remove_from_album'), $if: () => false },
  Tag: upstreamItem('tag'),
});
const actions = (options?: GalleryAssetBulkActionOptions) => getGalleryAssetBulkActions($t, options, upstream());
const run = (item: ActionItem) => item.onAction({ action: item } as never);

const asset = (id: string, ownerId: string) => ({ id, ownerId }) as TimelineAsset;

beforeEach(() => {
  vi.restoreAllMocks();
  // `show`'s result type is inferred from the modal component, so a bare spy widens to `never`.
  vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
  vi.spyOn(modalManager, 'showDialog').mockResolvedValue(true);
  for (const kind of ['primary', 'info', 'warning'] as const) {
    vi.spyOn(toastManager, kind).mockImplementation(() => ({}) as never);
  }
  mockUser.current = { id: 'me', isAdmin: false };
  assetMultiSelectManager.clear();
});

describe('CreateSharedLink', () => {
  // #1018: on a space surface where the caller is an Owner/Editor, the toolbar passes the space
  // down and the whole selection goes into the link, authorized against the space.
  describe('from a space (#1018)', () => {
    it('sends the whole selection, not just the owned subset', async () => {
      assetMultiSelectManager.selectAssets([asset('mine', 'me'), asset('theirs', 'someone-else')]);
      await run(actions({ shareSpaceId: 'space-1' }).CreateSharedLink);

      expect(modalManager.show).toHaveBeenCalledWith(expect.anything(), {
        assetIds: ['mine', 'theirs'],
        spaceId: 'space-1',
        contributedCount: 1,
      });
    });

    it('opens the modal even when the caller owns none of the selection', async () => {
      assetMultiSelectManager.selectAssets([asset('theirs-1', 'other-1'), asset('theirs-2', 'other-2')]);
      await run(actions({ shareSpaceId: 'space-1' }).CreateSharedLink);

      expect(modalManager.show).toHaveBeenCalledWith(expect.anything(), {
        assetIds: ['theirs-1', 'theirs-2'],
        spaceId: 'space-1',
        contributedCount: 2,
      });
      expect(toastManager.warning).not.toHaveBeenCalled();
    });

    it('still refuses an unauthenticated viewer', async () => {
      mockUser.current = null as never;
      assetMultiSelectManager.selectAssets([asset('a1', 'someone')]);
      await run(actions({ shareSpaceId: 'space-1' }).CreateSharedLink);

      expect(modalManager.show).not.toHaveBeenCalled();
    });
  });

  it('sends only the owned subset on a mixed selection and reports what was left out', async () => {
    assetMultiSelectManager.selectAssets([asset('mine', 'me'), asset('t1', 'other-1'), asset('t2', 'other-2')]);
    await run(actions().CreateSharedLink);

    expect(modalManager.show).toHaveBeenCalledWith(expect.anything(), { assetIds: ['mine'], excludedCount: 2 });
  });

  it('does not open the modal when the user owns none of the selection', async () => {
    assetMultiSelectManager.selectAssets([asset('theirs-1', 'other-1')]);
    await run(actions().CreateSharedLink);

    expect(modalManager.show).not.toHaveBeenCalled();
    expect(toastManager.warning).toHaveBeenCalled();
  });
});

describe('RemoveFromAlbum', () => {
  const album = { id: 'album-1', albumName: 'Trip' } as AlbumResponseDto;

  const remove = async (results: Array<{ id: string; success: boolean }>, onRemove = vi.fn()) => {
    vi.mocked(removeAssetFromAlbum).mockResolvedValue(
      results.map((result) => (result.success ? result : { ...result, error: BulkIdErrorReason.NoPermission })),
    );
    assetMultiSelectManager.selectAssets(results.map(({ id }) => asset(id, 'me')));
    const item = actions({ removeFromAlbum: { album, onRemove } }).RemoveFromAlbum;
    expect(item.$if?.()).toBe(true);
    await run(item);
    return onRemove;
  };

  it('keeps upstream’s item when the toolbar does not allow removing', () => {
    expect(actions().RemoveFromAlbum.$if?.()).toBe(false);
  });

  it('prunes only the assets the server actually removed and reports a partial removal', async () => {
    const onRemove = await remove([
      { id: 'a1', success: true },
      { id: 'a2', success: false },
    ]);

    expect(removeAssetFromAlbum).toHaveBeenCalledWith({ id: 'album-1', bulkIdsDto: { ids: ['a1', 'a2'] } });
    expect(onRemove).toHaveBeenCalledWith(['a1']);
    expect(toastManager.info).toHaveBeenCalled();
    expect(toastManager.primary).not.toHaveBeenCalled();
    expect(assetMultiSelectManager.assets).toHaveLength(0);
  });

  it('shows a warning, not success, when nothing was removed', async () => {
    await remove([{ id: 'a1', success: false }]);

    expect(toastManager.warning).toHaveBeenCalled();
    expect(toastManager.primary).not.toHaveBeenCalled();
  });

  it('keeps the success toast when every asset was removed', async () => {
    await remove([{ id: 'a1', success: true }]);

    expect(toastManager.primary).toHaveBeenCalled();
  });

  it('does nothing when the confirmation is declined', async () => {
    vi.spyOn(modalManager, 'showDialog').mockResolvedValue(false);
    const onRemove = await remove([{ id: 'a1', success: true }]);

    expect(removeAssetFromAlbum).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });
});
