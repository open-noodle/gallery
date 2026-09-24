import {
  AssetTypeEnum,
  CleanupBurstSource,
  CleanupQueue,
  type CleanupAssetDto,
  type CleanupBurstGroupDto,
} from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { addMessages } from 'svelte-i18n';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import BurstsQueue from './BurstsQueue.svelte';
import SelectQueue from './SelectQueue.svelte';
import SpaceHogsQueue from './SpaceHogsQueue.svelte';

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
vi.mock('$lib/utils/navigation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  navigate: mocks.navigate,
}));
vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: mocks.auth }));

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

const page = (items: CleanupAssetDto[], groups: CleanupBurstGroupDto[] = []) => ({ items, groups, nextCursor: null });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderWrapped = (component: Component<any>, componentProps: Record<string, unknown>) =>
  render(TestWrapper as Component<{ component: typeof component; componentProps: typeof componentProps }>, {
    component,
    componentProps,
  });

const item = (id: string) => screen.getByTestId(`cleanup-item-${id}`);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.authenticated = false;
  mocks.sdk.getCleanupQueueCount.mockResolvedValue({ count: 3, bytes: 300 });
  mocks.sdk.getCleanupAssetsInSpaces.mockResolvedValue({ assetIds: [] });
  mocks.sdk.commitCleanup.mockImplementation(({ cleanupCommitDto }) =>
    Promise.resolve({ trashed: cleanupCommitDto.trashIds ?? [], kept: 0, favorited: 0, skipped: [] }),
  );
  mocks.sdk.restoreAssets.mockResolvedValue(undefined);
  mocks.showDialog.mockResolvedValue(true);
});

describe('blurry queue', () => {
  const renderBlurry = () => renderWrapped(SelectQueue, { queue: 'blurry', title: 'cleanup_queue_blurry' });

  it('loads the first page and the per-reason counts with the default filters', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(page([asset('a')]));
    renderBlurry();

    await waitFor(() => expect(item('a')).toBeInTheDocument());
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
    expect(screen.getByTestId('cleanup-hide-faces')).toBeChecked();
  });

  it('resets the list and the selection when a filter changes', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValueOnce(page([asset('a')])).mockResolvedValueOnce(page([asset('b')]));
    renderBlurry();
    await waitFor(() => expect(item('a')).toBeInTheDocument());
    await fireEvent.click(item('a'));

    await fireEvent.click(screen.getByTestId('cleanup-reason-dark'));

    await waitFor(() => expect(item('b')).toBeInTheDocument());
    expect(screen.queryByTestId('cleanup-item-a')).toBeNull();
    expect(mocks.sdk.getCleanupQueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'dark', cursor: undefined }),
    );
    expect(screen.getByTestId('cleanup-trash-selected')).toBeDisabled();
  });

  it('trashes the selection, removes it and puts it back on undo', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(page([asset('a'), asset('b'), asset('c')]));
    renderBlurry();
    await waitFor(() => expect(item('a')).toBeInTheDocument());
    await fireEvent.click(item('a'));
    await fireEvent.click(item('c'));

    await fireEvent.click(screen.getByTestId('cleanup-trash-selected'));

    await waitFor(() => expect(screen.queryByTestId('cleanup-item-a')).toBeNull());
    expect(mocks.sdk.getCleanupAssetsInSpaces).toHaveBeenCalledWith({ cleanupInSpacesDto: { assetIds: ['a', 'c'] } });
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: { queue: CleanupQueue.Blurry, trashIds: ['a', 'c'] },
    });

    const [toast] = mocks.toast.primary.mock.calls[0];
    await toast.button.onclick();
    await waitFor(() => expect(item('a')).toBeInTheDocument());
    expect(screen.getAllByTestId(/^cleanup-item-/).map((el) => el.dataset.assetId)).toEqual(['a', 'b', 'c']);
  });

  it('keeps nothing and trashes nothing when the Space warning is cancelled', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(page([asset('a')]));
    mocks.sdk.getCleanupAssetsInSpaces.mockResolvedValue({ assetIds: ['a'] });
    mocks.showDialog.mockResolvedValue(false);
    renderBlurry();
    await waitFor(() => expect(item('a')).toBeInTheDocument());
    await fireEvent.click(item('a'));

    await fireEvent.click(screen.getByTestId('cleanup-trash-selected'));

    await waitFor(() => expect(mocks.showDialog).toHaveBeenCalled());
    expect(mocks.sdk.commitCleanup).not.toHaveBeenCalled();
    expect(item('a')).toHaveAttribute('data-selected', 'true');
  });

  it('keeps the selection with "Not a problem"', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(page([asset('a'), asset('b')]));
    renderBlurry();
    await waitFor(() => expect(item('a')).toBeInTheDocument());
    await fireEvent.click(item('b'));

    await fireEvent.click(screen.getByTestId('cleanup-keep-selected'));

    await waitFor(() => expect(screen.queryByTestId('cleanup-item-b')).toBeNull());
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: { queue: CleanupQueue.Blurry, keepIds: ['b'] },
    });
  });

  it('selects all with A, clears with Escape and trashes the selection with Delete', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(page([asset('a'), asset('b')]));
    renderBlurry();
    await waitFor(() => expect(item('a')).toBeInTheDocument());

    await fireEvent.keyDown(document, { key: 'a' });
    expect(item('a')).toHaveAttribute('data-selected', 'true');
    expect(item('b')).toHaveAttribute('data-selected', 'true');
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(item('a')).toHaveAttribute('data-selected', 'false');

    await fireEvent.click(item('b'));
    await fireEvent.keyDown(document, { key: 'Delete' });
    await waitFor(() =>
      expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
        cleanupCommitDto: { queue: CleanupQueue.Blurry, trashIds: ['b'] },
      }),
    );
  });

  it('ignores the shortcuts while a modal is open', async () => {
    mocks.isModalOpen.mockReturnValue(true);
    mocks.sdk.getCleanupQueue.mockResolvedValue(page([asset('a')]));
    renderBlurry();
    await waitFor(() => expect(item('a')).toBeInTheDocument());

    await fireEvent.keyDown(document, { key: 'a' });

    expect(item('a')).toHaveAttribute('data-selected', 'false');
  });

  it('opens the focused photo in the viewer with Space', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(page([asset('a'), asset('b')]));
    renderBlurry();
    await waitFor(() => expect(item('b')).toBeInTheDocument());
    await fireEvent.focus(item('b'));

    await fireEvent.keyDown(document, { key: ' ' });

    expect(mocks.navigate).toHaveBeenCalledWith({ targetRoute: 'current', assetId: 'b' });
  });
});

describe('screenshots queue', () => {
  it('has no reason chips, slider or faces toggle', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(page([asset('a')]));
    renderWrapped(SelectQueue, { queue: 'screenshots', title: 'cleanup_queue_screenshots' });

    await waitFor(() => expect(item('a')).toBeInTheDocument());
    expect(screen.queryByTestId('cleanup-blurry-toolbar')).toBeNull();
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
    mocks.sdk.getCleanupQueue.mockResolvedValue(page(hogs));
    mocks.sdk.getCleanupQueueCount.mockResolvedValue({ count: 2, bytes: 600 });
    renderWrapped(SpaceHogsQueue, { title: 'cleanup_queue_space_hogs' });

    await waitFor(() => expect(screen.getByTestId('cleanup-hog-row-a')).toBeInTheDocument());
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
    await waitFor(() =>
      expect(screen.getByTestId('cleanup-queue-subtitle')).toHaveTextContent(
        'Your 2 largest files take up 600 B, 50% of your library',
      ),
    );
  });

  it('drops the percentage when the usage is unknown', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(page(hogs));
    renderWrapped(SpaceHogsQueue, { title: 'cleanup_queue_space_hogs' });

    await waitFor(() =>
      expect(screen.getByTestId('cleanup-queue-subtitle')).toHaveTextContent('cleanup_space_hogs_subtitle_no_percent'),
    );
  });

  it('trashes and keeps single rows', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(page(hogs));
    renderWrapped(SpaceHogsQueue, { title: 'cleanup_queue_space_hogs' });
    await waitFor(() => expect(screen.getByTestId('cleanup-hog-row-a')).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId('cleanup-hog-trash-a'));
    await waitFor(() => expect(screen.queryByTestId('cleanup-hog-row-a')).toBeNull());
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: { queue: CleanupQueue.SpaceHogs, trashIds: ['a'] },
    });

    await fireEvent.click(screen.getByTestId('cleanup-hog-keep-b'));
    await waitFor(() => expect(screen.queryByTestId('cleanup-hog-row-b')).toBeNull());
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: { queue: CleanupQueue.SpaceHogs, keepIds: ['b'] },
    });
  });

  it('reloads from the first page when the type or minimum size changes', async () => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(page(hogs));
    renderWrapped(SpaceHogsQueue, { title: 'cleanup_queue_space_hogs' });
    await waitFor(() => expect(screen.getByTestId('cleanup-hog-row-a')).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId('cleanup-hog-type-all'));
    await waitFor(() =>
      expect(mocks.sdk.getCleanupQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ $type: 'all', cursor: undefined }),
      ),
    );

    await fireEvent.change(screen.getByTestId('cleanup-hog-min-size'), { target: { value: '1073741824' } });
    await waitFor(() =>
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

  const renderBursts = (groups: CleanupBurstGroupDto[]) => {
    mocks.sdk.getCleanupQueue.mockResolvedValue(page([], groups));
    return renderWrapped(BurstsQueue, { title: 'cleanup_queue_bursts' });
  };

  it('resolves a group with the current marks in one commit', async () => {
    renderBursts([group('g1', ['a', 'b', 'c'], 'b')]);
    await waitFor(() => expect(item('a')).toBeInTheDocument());
    await fireEvent.click(item('c'));

    await fireEvent.click(screen.getByTestId('cleanup-burst-resolve'));

    await waitFor(() => expect(screen.queryByTestId('cleanup-burst-g1')).toBeNull());
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: { queue: CleanupQueue.Bursts, trashIds: ['a'], keepIds: ['b', 'c'] },
    });
  });

  it('keeps every photo of a group with "Keep all"', async () => {
    renderBursts([group('g1', ['a', 'b'], 'a')]);
    await waitFor(() => expect(item('a')).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId('cleanup-burst-keep-all'));

    await waitFor(() => expect(screen.queryByTestId('cleanup-burst-g1')).toBeNull());
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: { queue: CleanupQueue.Bursts, keepIds: ['a', 'b'] },
    });
    expect(mocks.toast.primary).not.toHaveBeenCalled();
  });

  it('stacks a group with the suggested pick as the primary', async () => {
    mocks.sdk.createStack.mockResolvedValue({ id: 's', primaryAssetId: 'b', assets: [] });
    renderBursts([group('g1', ['a', 'b', 'c'], 'b')]);
    await waitFor(() => expect(item('a')).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId('cleanup-burst-stack'));

    await waitFor(() => expect(screen.queryByTestId('cleanup-burst-g1')).toBeNull());
    expect(mocks.sdk.createStack).toHaveBeenCalledWith({ stackCreateDto: { assetIds: ['b', 'a', 'c'] } });
    expect(mocks.sdk.commitCleanup).not.toHaveBeenCalled();
  });

  it('accepts the suggestions of every group on the page in one commit, and undo brings back what can be a burst', async () => {
    renderBursts([group('g1', ['a', 'b', 'c'], 'a'), group('g2', ['d', 'e'], 'e')]);
    await waitFor(() => expect(item('d')).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId('cleanup-bursts-accept-suggestions'));

    await waitFor(() => expect(screen.queryByTestId('cleanup-burst-g1')).toBeNull());
    expect(screen.queryByTestId('cleanup-burst-g2')).toBeNull();
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledTimes(1);
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: { queue: CleanupQueue.Bursts, trashIds: ['b', 'c', 'd'], keepIds: ['a', 'e'] },
    });

    const [toast] = mocks.toast.primary.mock.calls[0];
    await toast.button.onclick();
    expect(mocks.sdk.restoreAssets).toHaveBeenCalledWith({ bulkIdsDto: { ids: ['b', 'c', 'd'] } });
    // g1 still has two restored photos; g2 has only one, so it is no longer a burst.
    await waitFor(() => expect(screen.getByTestId('cleanup-burst-g1')).toBeInTheDocument());
    expect(screen.queryByTestId('cleanup-item-a')).toBeNull();
    expect(item('b')).toBeInTheDocument();
    expect(screen.queryByTestId('cleanup-burst-g2')).toBeNull();
  });

  it('marks the focused photo with the keyboard', async () => {
    renderBursts([group('g1', ['a', 'b'], 'a')]);
    await waitFor(() => expect(item('b')).toBeInTheDocument());
    await fireEvent.focus(item('b'));

    await fireEvent.keyDown(document, { key: 'k' });
    expect(item('b')).toHaveAttribute('data-mark', 'keep');

    await fireEvent.keyDown(document, { key: 'Delete' });
    expect(item('b')).toHaveAttribute('data-mark', 'trash');
  });
});
