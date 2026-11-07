import TestWrapper from '#lib/components/TestWrapper.svelte';
import {
  AssetTypeEnum,
  CleanupBurstSource,
  CleanupQueue,
  type CleanupAssetDto,
  type CleanupBurstGroupDto,
} from '@immich/sdk';
import { tick, type Component } from 'svelte';
import { addMessages } from 'svelte-i18n';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import BurstsQueue from './BurstsQueue.svelte';
import SelectQueue from './SelectQueue.svelte';
import SpaceHogsQueue from './SpaceHogsQueue.svelte';

/** Fires a keydown on the document as a key press would, then lets Svelte flush. */
const keyDown = async (init: KeyboardEventInit) => {
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  await tick();
};

const mocks = vi.hoisted(() => ({
  sdk: {
    getCleanupQueue: vi.fn(),
    getCleanupQueueCount: vi.fn(),
    commitCleanup: vi.fn(),
    getCleanupAssetsInSpaces: vi.fn(),
    restoreAssets: vi.fn(),
    createStack: vi.fn(),
  },
  navigate: vi.fn(),
  toast: { primary: vi.fn(), success: vi.fn(), warning: vi.fn(), danger: vi.fn(), info: vi.fn() },
  showDialog: vi.fn(),
  isModalOpen: vi.fn(),
  auth: { authenticated: false, user: { quotaUsageInBytes: 0 } },
  flags: { value: { trash: true } },
}));

vi.mock('@immich/sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.sdk }));
vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    toastManager: mocks.toast,
    modalManager: { ...original.modalManager, showDialog: mocks.showDialog },
    isModalOpen: mocks.isModalOpen,
  };
});
vi.mock('#lib/utils/navigation.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  navigate: mocks.navigate,
}));
vi.mock('#lib/managers/auth-manager.svelte.js', () => ({ authManager: mocks.auth }));
vi.mock('#lib/managers/feature-flags-manager.svelte.js', () => ({ featureFlagsManager: mocks.flags }));
vi.mock('#lib/managers/AssetCacheManager.svelte.js', () => ({
  assetCacheManager: { getAsset: () => Promise.resolve(undefined) },
}));

const asset = (id: string, overrides: Partial<CleanupAssetDto> = {}): CleanupAssetDto => ({
  id,
  city: null,
  duration: null,
  fileSize: 100,
  height: 100,
  width: 100,
  inAlbum: false,
  isFavorite: false,
  kept: false,
  localDateTime: '2024-08-12T14:03:21.000Z',
  originalFileName: `${id}.jpg`,
  thumbhash: null,
  type: AssetTypeEnum.Image,
  ...overrides,
});

const pageOf = (items: CleanupAssetDto[], groups: CleanupBurstGroupDto[] = []) => ({ items, groups, nextCursor: null });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderWrapped = async (component: Component<any>, componentProps: Record<string, unknown>) =>
  await render(TestWrapper as Component<{ component: typeof component; componentProps: typeof componentProps }>, {
    component,
    componentProps,
  });

const item = (id: string) => page.getByTestId(`cleanup-item-${id}`);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.authenticated = false;
  mocks.sdk.getCleanupQueueCount.mockResolvedValue({ count: 3, bytes: 300 });
  mocks.sdk.getCleanupAssetsInSpaces.mockResolvedValue({ assetIds: [], externalAssetIds: [] });
  mocks.sdk.commitCleanup.mockImplementation(({ cleanupCommitDto }) =>
    Promise.resolve({ trashed: cleanupCommitDto.trashIds ?? [], kept: 0, favorited: 0, skipped: [] }),
  );
  mocks.sdk.restoreAssets.mockResolvedValue(undefined);
  mocks.showDialog.mockResolvedValue(true);
  mocks.flags.value.trash = true;
});

describe('blurry queue', () => {
  const renderBlurry = async () => renderWrapped(SelectQueue, { queue: 'blurry', title: 'cleanup_queue_blurry' });

  it('loads the first page and the per-reason counts with the default filters', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(pageOf([asset('a')]));
    await renderBlurry();

    await expect.element(item('a')).toBeInTheDocument();
    expect(mocks.sdk.getCleanupQueue).toHaveBeenCalledWith({
      queue: 'blurry',
      cursor: undefined,
      limit: 100,
      reason: 'all',
      strictness: 'balanced',
      hideFaces: true,
    });
    const reasons = mocks.sdk.getCleanupQueueCount.mock.calls.map(([query]) => query.reason);
    expect(reasons).toEqual(expect.arrayContaining(['all', 'blurry', 'bright', 'dark']));
    expect(reasons).toHaveLength(4);
    await expect.element(page.getByTestId('cleanup-hide-faces')).toBeChecked();
  });

  it('resets the list and the selection when a filter changes', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValueOnce(pageOf([asset('a')])).mockResolvedValueOnce(pageOf([asset('b')]));
    await renderBlurry();
    await expect.element(item('a')).toBeInTheDocument();
    await userEvent.click(item('a'));

    await userEvent.click(page.getByTestId('cleanup-reason-dark'));

    await expect.element(item('b')).toBeInTheDocument();
    expect(page.getByTestId('cleanup-item-a').query()).toBeNull();
    expect(mocks.sdk.getCleanupQueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'dark', cursor: undefined }),
    );
    await expect.element(page.getByTestId('cleanup-trash-selected')).toBeDisabled();
  });

  it('trashes the selection, removes it and puts it back on undo', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(pageOf([asset('a'), asset('b'), asset('c')]));
    await renderBlurry();
    await expect.element(item('a')).toBeInTheDocument();
    await userEvent.click(item('a'));
    await userEvent.click(item('c'));

    await userEvent.click(page.getByTestId('cleanup-trash-selected'));

    expect(page.getByTestId('cleanup-item-a').query()).toBeNull();
    expect(mocks.sdk.getCleanupAssetsInSpaces).toHaveBeenCalledWith({ cleanupInSpacesDto: { assetIds: ['a', 'c'] } });
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: { queue: CleanupQueue.Blurry, trashIds: ['a', 'c'] },
    });

    const [toast] = mocks.toast.primary.mock.calls[0];
    await toast.button.onclick();
    await expect.element(item('a')).toBeInTheDocument();
    expect(
      page
        .getByTestId(/^cleanup-item-/)
        .elements()
        .map((el) => el.dataset.assetId),
    ).toEqual(['a', 'b', 'c']);
  });

  it('keeps nothing and trashes nothing when the Space warning is cancelled', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(pageOf([asset('a')]));
    mocks.sdk.getCleanupAssetsInSpaces.mockResolvedValue({ assetIds: ['a'], externalAssetIds: [] });
    mocks.showDialog.mockResolvedValue(false);
    await renderBlurry();
    await expect.element(item('a')).toBeInTheDocument();
    await userEvent.click(item('a'));

    await userEvent.click(page.getByTestId('cleanup-trash-selected'));

    await vi.waitFor(() => expect(mocks.showDialog).toHaveBeenCalled());
    expect(mocks.sdk.commitCleanup).not.toHaveBeenCalled();
    await expect.element(item('a')).toHaveAttribute('data-selected', 'true');
  });

  it('keeps the selection with "Not a problem"', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(pageOf([asset('a'), asset('b')]));
    await renderBlurry();
    await expect.element(item('a')).toBeInTheDocument();
    await userEvent.click(item('b'));

    await userEvent.click(page.getByTestId('cleanup-keep-selected'));

    expect(page.getByTestId('cleanup-item-b').query()).toBeNull();
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: { queue: CleanupQueue.Blurry, keepIds: ['b'] },
    });
  });

  it('selects all with A, clears with Escape and trashes the selection with Delete', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(pageOf([asset('a'), asset('b')]));
    await renderBlurry();
    await expect.element(item('a')).toBeInTheDocument();

    await keyDown({ key: 'a' });
    await expect.element(item('a')).toHaveAttribute('data-selected', 'true');
    await expect.element(item('b')).toHaveAttribute('data-selected', 'true');
    await keyDown({ key: 'Escape' });
    await expect.element(item('a')).toHaveAttribute('data-selected', 'false');

    await userEvent.click(item('b'));
    await keyDown({ key: 'Delete' });
    await vi.waitFor(() =>
      expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
        cleanupCommitDto: { queue: CleanupQueue.Blurry, trashIds: ['b'] },
      }),
    );
  });

  it('ignores the shortcuts while a modal is open', async () => {
    mocks.isModalOpen.mockReturnValue(true);
    mocks.sdk.getCleanupQueue.mockResolvedValue(pageOf([asset('a')]));
    await renderBlurry();
    await expect.element(item('a')).toBeInTheDocument();

    await keyDown({ key: 'a' });

    await expect.element(item('a')).toHaveAttribute('data-selected', 'false');
  });

  it('opens the focused photo in the photo window with Space, and in the viewer on double-click', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(pageOf([asset('a'), asset('b')]));
    await renderBlurry();
    await expect.element(item('b')).toBeInTheDocument();
    (item('b').element() as HTMLElement).focus();

    await keyDown({ key: ' ' });

    await expect.element(page.getByTestId('cleanup-photo-window')).toBeInTheDocument();
    expect(page.getByTestId('cleanup-photo-window-photo').element().dataset.assetId).toBe('b');
    expect(mocks.navigate).not.toHaveBeenCalled();

    // The photo window now covers the grid; fire the double-click on the tile itself, as the old test did.
    item('a')
      .element()
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ targetRoute: 'current', assetId: 'a' }));
  });

  it('keeps the page shortcuts off while the photo window is open', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(pageOf([asset('a'), asset('b')]));
    await renderBlurry();
    await expect.element(item('b')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('cleanup-expand-b'));
    await expect.element(page.getByTestId('cleanup-photo-window')).toBeInTheDocument();

    await keyDown({ key: 'a' });

    await expect.element(item('a')).toHaveAttribute('data-selected', 'false');
  });

  it('remembers the tile size per queue', async () => {
    localStorage.clear();
    mocks.sdk.getCleanupQueue.mockResolvedValue(pageOf([asset('a')]));
    await renderBlurry();
    await expect.element(item('a')).toBeInTheDocument();

    await userEvent.click(page.getByTestId('cleanup-tile-size-large'));

    await expect.element(page.getByTestId('cleanup-tile-size-large')).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('cleanup.queue.blurry.tile-size')).toBe('large');
  });
});

describe('screenshots queue', () => {
  it('has no reason chips, slider or faces toggle', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(pageOf([asset('a')]));
    await renderWrapped(SelectQueue, { queue: 'screenshots', title: 'cleanup_queue_screenshots' });

    await expect.element(item('a')).toBeInTheDocument();
    expect(page.getByTestId('cleanup-blurry-toolbar').query()).toBeNull();
    expect(mocks.sdk.getCleanupQueue).toHaveBeenCalledWith({ queue: 'screenshots', cursor: undefined, limit: 100 });
    expect(mocks.sdk.getCleanupQueueCount).toHaveBeenCalledWith({ queue: 'screenshots' });
  });
});

describe('space hogs queue', () => {
  const hogs = [
    asset('a', { fileSize: 400, type: AssetTypeEnum.Video }),
    asset('b', { fileSize: 200, type: AssetTypeEnum.Video }),
  ];

  beforeAll(() => {
    addMessages('dev', {
      cleanup_space_hogs_subtitle:
        'Your {count, plural, one {largest file takes} other {# largest files take}} up <b>{size}</b>, {percent}% of your library',
    });
  });

  it('defaults to videos over 100 MiB and shows the share of the library', async () => {
    mocks.auth.authenticated = true;
    mocks.auth.user.quotaUsageInBytes = 1200;
    mocks.sdk.getCleanupQueue.mockResolvedValue(pageOf(hogs));
    mocks.sdk.getCleanupQueueCount.mockResolvedValue({ count: 2, bytes: 600 });
    await renderWrapped(SpaceHogsQueue, { title: 'cleanup_queue_space_hogs' });

    await expect.element(page.getByTestId('cleanup-hog-row-a')).toBeInTheDocument();
    expect(mocks.sdk.getCleanupQueue).toHaveBeenCalledWith({
      queue: 'space_hogs',
      cursor: undefined,
      limit: 100,
      $type: 'video',
      minSize: 104_857_600,
    });
    expect(mocks.sdk.getCleanupQueueCount).toHaveBeenCalledWith({
      queue: 'space_hogs',
      $type: 'video',
      minSize: 104_857_600,
    });
    await expect
      .element(page.getByTestId('cleanup-queue-subtitle'))
      .toMatchTextContent('Your 2 largest files take up 600 B, 50% of your library');
  });

  it('drops the percentage when the usage is unknown', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(pageOf(hogs));
    await renderWrapped(SpaceHogsQueue, { title: 'cleanup_queue_space_hogs' });

    await expect
      .element(page.getByTestId('cleanup-queue-subtitle'))
      .toMatchTextContent('cleanup_space_hogs_subtitle_no_percent');
  });

  it('trashes and keeps single rows', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(pageOf(hogs));
    await renderWrapped(SpaceHogsQueue, { title: 'cleanup_queue_space_hogs' });
    await expect.element(page.getByTestId('cleanup-hog-row-a')).toBeInTheDocument();

    await userEvent.click(page.getByTestId('cleanup-hog-trash-a'));
    expect(page.getByTestId('cleanup-hog-row-a').query()).toBeNull();
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: { queue: CleanupQueue.SpaceHogs, trashIds: ['a'] },
    });

    await userEvent.click(page.getByTestId('cleanup-hog-keep-b'));
    expect(page.getByTestId('cleanup-hog-row-b').query()).toBeNull();
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: { queue: CleanupQueue.SpaceHogs, keepIds: ['b'] },
    });
  });

  it('asks for a permanent delete, and offers no Undo, when the trash is turned off', async () => {
    mocks.flags.value.trash = false;
    mocks.sdk.getCleanupQueue.mockResolvedValue(pageOf(hogs));
    await renderWrapped(SpaceHogsQueue, { title: 'cleanup_queue_space_hogs' });
    await expect.element(page.getByTestId('cleanup-hog-row-a')).toBeInTheDocument();

    await userEvent.click(page.getByTestId('cleanup-hog-trash-a'));

    expect(page.getByTestId('cleanup-hog-row-a').query()).toBeNull();
    expect(mocks.showDialog).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'cleanup_permanent_delete_prompt', confirmText: 'permanently_delete' }),
    );
    expect(mocks.toast.primary).toHaveBeenCalledExactlyOnceWith('permanently_deleted_assets_count');
  });

  it('reloads from the first page when the type or minimum size changes', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(pageOf(hogs));
    await renderWrapped(SpaceHogsQueue, { title: 'cleanup_queue_space_hogs' });
    await expect.element(page.getByTestId('cleanup-hog-row-a')).toBeInTheDocument();

    await userEvent.click(page.getByTestId('cleanup-hog-type-all'));
    await vi.waitFor(() =>
      expect(mocks.sdk.getCleanupQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ $type: 'all', cursor: undefined }),
      ),
    );

    await userEvent.selectOptions(page.getByTestId('cleanup-hog-min-size'), '1073741824');
    await vi.waitFor(() =>
      expect(mocks.sdk.getCleanupQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ $type: 'all', minSize: 1_073_741_824 }),
      ),
    );
  });
});

describe('bursts queue', () => {
  const group = (groupId: string, ids: string[], suggestedKeepId: string): CleanupBurstGroupDto => ({
    groupId,
    source: CleanupBurstSource.BurstId,
    suggestedKeepId,
    assets: ids.map((id, i) => asset(id, { localDateTime: `2024-08-12T14:03:2${i}.000Z` })),
  });

  const renderBursts = async (groups: CleanupBurstGroupDto[]) => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(pageOf([], groups));
    return renderWrapped(BurstsQueue, { title: 'cleanup_queue_bursts' });
  };

  it('resolves a group with the current marks in one commit', async () => {
    await renderBursts([group('g1', ['a', 'b', 'c'], 'b')]);
    await expect.element(item('a')).toBeInTheDocument();
    await userEvent.click(item('c'));

    await userEvent.click(page.getByTestId('cleanup-burst-resolve'));

    expect(page.getByTestId('cleanup-burst-g1').query()).toBeNull();
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: { queue: CleanupQueue.Bursts, trashIds: ['a'], keepIds: ['b', 'c'] },
    });
  });

  it('keeps every photo of a group with "Keep all"', async () => {
    await renderBursts([group('g1', ['a', 'b'], 'a')]);
    await expect.element(item('a')).toBeInTheDocument();

    await userEvent.click(page.getByTestId('cleanup-burst-keep-all'));

    expect(page.getByTestId('cleanup-burst-g1').query()).toBeNull();
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: { queue: CleanupQueue.Bursts, keepIds: ['a', 'b'] },
    });
    expect(mocks.toast.primary).not.toHaveBeenCalled();
  });

  it('stacks a group with the suggested pick as the primary', async () => {
    mocks.sdk.createStack.mockResolvedValue({ id: 's', primaryAssetId: 'b', assets: [] });
    await renderBursts([group('g1', ['a', 'b', 'c'], 'b')]);
    await expect.element(item('a')).toBeInTheDocument();

    await userEvent.click(page.getByTestId('cleanup-burst-stack'));

    expect(page.getByTestId('cleanup-burst-g1').query()).toBeNull();
    expect(mocks.sdk.createStack).toHaveBeenCalledWith({ stackCreateDto: { assetIds: ['b', 'a', 'c'] } });
    expect(mocks.sdk.commitCleanup).not.toHaveBeenCalled();
  });

  it('accepts the suggestions of every group on the page in one commit, and undo brings back what can be a burst', async () => {
    await renderBursts([group('g1', ['a', 'b', 'c'], 'a'), group('g2', ['d', 'e'], 'e')]);
    await expect.element(item('d')).toBeInTheDocument();

    await userEvent.click(page.getByTestId('cleanup-bursts-accept-suggestions'));

    expect(page.getByTestId('cleanup-burst-g1').query()).toBeNull();
    expect(page.getByTestId('cleanup-burst-g2').query()).toBeNull();
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledTimes(1);
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: { queue: CleanupQueue.Bursts, trashIds: ['b', 'c', 'd'], keepIds: ['a', 'e'] },
    });

    const [toast] = mocks.toast.primary.mock.calls[0];
    await toast.button.onclick();
    expect(mocks.sdk.restoreAssets).toHaveBeenCalledWith({ bulkIdsDto: { ids: ['b', 'c', 'd'] } });
    // g1 still has two restored photos; g2 has only one, so it is no longer a burst.
    await expect.element(page.getByTestId('cleanup-burst-g1')).toBeInTheDocument();
    expect(page.getByTestId('cleanup-item-a').query()).toBeNull();
    await expect.element(item('b')).toBeInTheDocument();
    expect(page.getByTestId('cleanup-burst-g2').query()).toBeNull();
  });

  describe('when the server ends a page early at its scan cap', () => {
    // The footer sentinel stays in view, as it does when the page above it is short or empty.
    class AlwaysVisible {
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ isIntersecting: true, target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
      disconnect() {}
      unobserve() {}
    }

    beforeEach(() => {
      vi.stubGlobal('IntersectionObserver', AlwaysVisible);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('keeps loading through empty pages that carry a cursor, and stops at the end', async () => {
      mocks.sdk.getCleanupQueue
        .mockResolvedValueOnce({ items: [], groups: [], nextCursor: 'c1' })
        .mockResolvedValueOnce({ items: [], groups: [], nextCursor: 'c2' })
        .mockResolvedValueOnce({ items: [], groups: [group('g1', ['a', 'b'], 'a')], nextCursor: null });
      await renderWrapped(BurstsQueue, { title: 'cleanup_queue_bursts' });

      await expect.element(page.getByTestId('cleanup-burst-g1')).toBeInTheDocument();
      expect(mocks.sdk.getCleanupQueue).toHaveBeenCalledTimes(3);
      expect(mocks.sdk.getCleanupQueue).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: 'c1' }));
      expect(mocks.sdk.getCleanupQueue).toHaveBeenNthCalledWith(3, expect.objectContaining({ cursor: 'c2' }));
      expect(page.getByTestId('cleanup-queue-empty').query()).toBeNull();
      expect(page.getByTestId('cleanup-queue-sentinel').query()).toBeNull();
    });

    it('shows the empty state only once the last page says there is nothing more', async () => {
      mocks.sdk.getCleanupQueue
        .mockResolvedValueOnce({ items: [], groups: [], nextCursor: 'c1' })
        .mockResolvedValueOnce({ items: [], groups: [], nextCursor: null });
      await renderWrapped(BurstsQueue, { title: 'cleanup_queue_bursts' });

      await expect.element(page.getByTestId('cleanup-queue-empty')).toBeInTheDocument();
      expect(mocks.sdk.getCleanupQueue).toHaveBeenCalledTimes(2);
      // Give any runaway reload a chance to show up before asserting there was none.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mocks.sdk.getCleanupQueue).toHaveBeenCalledTimes(2);
    });
  });

  it('marks a frame from the photo window without committing anything', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(pageOf([], [group('g1', ['a', 'b'], 'a')]));
    await renderWrapped(BurstsQueue, { title: 'cleanup_queue_bursts' });
    await expect.element(item('a')).toBeInTheDocument();

    await userEvent.click(page.getByTestId('cleanup-expand-a'));
    await expect.element(page.getByTestId('cleanup-photo-window')).toBeInTheDocument();
    await keyDown({ key: 'Delete' });

    await expect.element(item('a')).toHaveAttribute('data-mark', 'trash');
    expect(mocks.sdk.commitCleanup).not.toHaveBeenCalled();
    expect(page.getByTestId('cleanup-photo-window-photo').element().dataset.assetId).toBe('a');
  });

  it('marks the focused photo with the keyboard', async () => {
    await renderBursts([group('g1', ['a', 'b'], 'a')]);
    await expect.element(item('b')).toBeInTheDocument();
    (item('b').element() as HTMLElement).focus();

    await keyDown({ key: 'k' });
    await expect.element(item('b')).toHaveAttribute('data-mark', 'keep');

    await keyDown({ key: 'Delete' });
    await expect.element(item('b')).toHaveAttribute('data-mark', 'trash');
  });
});
