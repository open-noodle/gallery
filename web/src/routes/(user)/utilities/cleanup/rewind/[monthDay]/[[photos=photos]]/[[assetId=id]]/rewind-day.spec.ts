import { AssetTypeEnum, CleanupQueue, type CleanupAssetDto } from '@immich/sdk';
import type { BeforeNavigate } from '@sveltejs/kit';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component, ComponentProps } from 'svelte';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import RewindDay from './RewindDay.svelte';

const mocks = vi.hoisted(() => ({
  sdk: {
    commitCleanup: vi.fn(),
    restoreAssets: vi.fn(),
    getCleanupCalendar: vi.fn(),
    getCleanupRewindAssets: vi.fn(),
    getCleanupAssetsInSpaces: vi.fn(),
  },
  goto: vi.fn(),
  navigate: vi.fn(),
  beforeNavigate: vi.fn(),
  toast: { primary: vi.fn(), success: vi.fn(), warning: vi.fn(), danger: vi.fn(), info: vi.fn() },
  showDialog: vi.fn(),
  isModalOpen: vi.fn(),
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
vi.mock('$app/navigation', () => ({ goto: mocks.goto, beforeNavigate: mocks.beforeNavigate }));
vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({ featureFlagsManager: mocks.flags }));
vi.mock('$app/state', () => ({
  page: { route: { id: '/(user)/utilities/cleanup/rewind/[monthDay]/[[photos=photos]]/[[assetId=id]]' } },
}));
vi.mock('$lib/utils/navigation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  navigate: mocks.navigate,
}));

const asset = (id: string, overrides: Partial<CleanupAssetDto> = {}): CleanupAssetDto => ({
  id,
  city: 'Lisbon',
  duration: null,
  fileSize: 1000,
  height: 100,
  width: 100,
  inAlbum: false,
  isFavorite: false,
  kept: false,
  localDateTime: `2024-09-23T10:00:0${id.length}.000Z`,
  originalFileName: `${id}.jpg`,
  thumbhash: null,
  type: AssetTypeEnum.Image,
  ...overrides,
});

type DayProps = ComponentProps<typeof RewindDay>;

const renderDay = (assets = [asset('a'), asset('bb'), asset('ccc')]) => {
  const componentProps: DayProps = {
    monthDay: 923,
    years: [{ year: 2024, count: assets.length }],
    firstYear: { year: 2024, assets },
    title: 'cleanup_rewind',
  };
  return render(TestWrapper as Component<{ component: typeof RewindDay; componentProps: DayProps }>, {
    component: RewindDay,
    componentProps,
  });
};

const tile = (id: string) => screen.getByTestId(`cleanup-rewind-tile-${id}`);
const guard = () => mocks.beforeNavigate.mock.calls.at(-1)![0] as (navigation: BeforeNavigate) => void;

const navigation = (
  to: { monthDay: string; assetId?: string } | null,
  extra: { type?: string; delta?: number } = {},
) => {
  const cancel = vi.fn();
  return {
    cancel,
    willUnload: false,
    type: 'link',
    ...extra,
    to: to && {
      url: new URL(`https://gallery.test/utilities/cleanup/rewind/${to.monthDay}`),
      route: { id: '/(user)/utilities/cleanup/rewind/[monthDay]/[[photos=photos]]/[[assetId=id]]' },
      params: to,
    },
  } as unknown as BeforeNavigate & { cancel: typeof cancel };
};

describe('RewindDay', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    mocks.sdk.commitCleanup.mockResolvedValue({ trashed: [], favorited: 0, kept: 0, skipped: [] });
    mocks.sdk.restoreAssets.mockResolvedValue(undefined);
    mocks.goto.mockResolvedValue(undefined);
    mocks.sdk.getCleanupAssetsInSpaces.mockResolvedValue({ assetIds: [] });
    mocks.flags.value.trash = true;
  });

  it('marks the focused tile from the keyboard and moves on to the next one', async () => {
    renderDay();

    await fireEvent.keyDown(document, { key: 'Delete' });
    await fireEvent.keyDown(document, { key: 'k' });

    expect(tile('a')).toHaveAttribute('data-mark', 'trash');
    expect(tile('bb')).toHaveAttribute('data-mark', 'keep');
    expect(tile('ccc')).toHaveAttribute('data-focused', 'true');
  });

  it('moves the trash marks to the trash, removes the tiles and puts them back on undo', async () => {
    mocks.sdk.commitCleanup.mockResolvedValue({ trashed: ['a'], favorited: 0, kept: 0, skipped: [] });
    renderDay();
    await fireEvent.click(tile('a'));
    await fireEvent.click(tile('a'));
    await fireEvent.click(tile('a'));
    await fireEvent.click(tile('bb'));

    await fireEvent.click(screen.getByTestId('cleanup-move-to-trash'));

    await waitFor(() => expect(screen.queryByTestId('cleanup-rewind-tile-a')).toBeNull());
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: { queue: CleanupQueue.Rewind, trashIds: ['a'], favoriteIds: [], keepIds: [] },
    });
    // The keep mark on "bb" stays local until the day is finished.
    expect(tile('bb')).toHaveAttribute('data-mark', 'keep');

    const [toast, options] = mocks.toast.primary.mock.calls[0];
    expect(toast.description).toBe('assets_trashed_count');
    expect(options).toEqual({ timeout: 5000 });
    await toast.button.onclick();

    expect(mocks.sdk.restoreAssets).toHaveBeenCalledWith({ bulkIdsDto: { ids: ['a'] } });
    await waitFor(() => expect(tile('a')).toHaveAttribute('data-mark', 'none'));
    const order = screen.getAllByTestId(/^cleanup-rewind-tile-/).map((el) => el.dataset.assetId);
    expect(order).toEqual(['a', 'bb', 'ccc']);
  });

  it('asks for a permanent delete, with no Undo, when the trash is turned off', async () => {
    mocks.flags.value.trash = false;
    mocks.showDialog.mockResolvedValue(true);
    mocks.sdk.commitCleanup.mockResolvedValue({ trashed: ['a'], favorited: 0, kept: 0, skipped: [] });
    renderDay();
    await fireEvent.keyDown(document, { key: 'Delete' });

    await fireEvent.click(screen.getByTestId('cleanup-move-to-trash'));

    await waitFor(() => expect(screen.queryByTestId('cleanup-rewind-tile-a')).toBeNull());
    expect(mocks.showDialog).toHaveBeenCalledWith({
      title: 'permanently_delete',
      prompt: 'cleanup_permanent_delete_prompt',
      confirmText: 'permanently_delete',
      confirmColor: 'danger',
    });
    expect(mocks.toast.primary).toHaveBeenCalledWith('permanently_deleted_assets_count');
    expect(mocks.toast.primary).not.toHaveBeenCalledWith(expect.objectContaining({ button: expect.anything() }));
  });

  it('commits nothing when the permanent delete is cancelled', async () => {
    mocks.flags.value.trash = false;
    mocks.showDialog.mockResolvedValue(false);
    renderDay();
    await fireEvent.keyDown(document, { key: 'Delete' });
    await fireEvent.keyDown(document, { key: 'k' });

    await fireEvent.click(screen.getByTestId('cleanup-finish-day'));

    await waitFor(() => expect(mocks.showDialog).toHaveBeenCalled());
    expect(mocks.sdk.commitCleanup).not.toHaveBeenCalled();
    expect(mocks.goto).not.toHaveBeenCalled();
    expect(tile('a')).toHaveAttribute('data-mark', 'trash');
  });

  it('reports skipped photos after a commit', async () => {
    mocks.sdk.commitCleanup.mockResolvedValue({
      trashed: [],
      favorited: 0,
      kept: 0,
      skipped: [{ id: 'a', reason: 'already_trashed' }],
    });
    renderDay();
    await fireEvent.keyDown(document, { key: 'Delete' });

    await fireEvent.click(screen.getByTestId('cleanup-move-to-trash'));

    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith('cleanup_skipped_count'));
    expect(mocks.toast.primary).not.toHaveBeenCalled();
  });

  it('finishes the day and moves on to the next date that still needs a review', async () => {
    mocks.sdk.getCleanupCalendar.mockResolvedValue({
      days: [
        { monthDay: 923, assetCount: 3, reviewedAt: null },
        { monthDay: 924, assetCount: 0, reviewedAt: null },
        { monthDay: 925, assetCount: 4, reviewedAt: null },
      ],
      daysReviewed: 0,
      streak: 0,
    });
    renderDay();
    await fireEvent.keyDown(document, { key: 'k' });

    await fireEvent.click(screen.getByTestId('cleanup-finish-day'));

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/utilities/cleanup/rewind/925'));
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: {
        queue: CleanupQueue.Rewind,
        trashIds: [],
        favoriteIds: [],
        keepIds: ['a'],
        completeMonthDay: 923,
      },
    });
    expect(mocks.toast.success).toHaveBeenCalledWith('cleanup_day_complete');
  });

  it('warns about photos in a Space before moving them to the trash, and keeps the marks on cancel', async () => {
    mocks.sdk.getCleanupAssetsInSpaces.mockResolvedValue({ assetIds: ['a'] });
    mocks.showDialog.mockResolvedValue(false);
    renderDay();
    await fireEvent.keyDown(document, { key: 'Delete' });

    await fireEvent.click(screen.getByTestId('cleanup-move-to-trash'));

    await waitFor(() =>
      expect(mocks.showDialog).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'cleanup_space_warning' })),
    );
    expect(mocks.sdk.getCleanupAssetsInSpaces).toHaveBeenCalledWith({ cleanupInSpacesDto: { assetIds: ['a'] } });
    expect(mocks.sdk.commitCleanup).not.toHaveBeenCalled();
    expect(tile('a')).toHaveAttribute('data-mark', 'trash');
  });

  it('moves Space photos to the trash once the warning is confirmed', async () => {
    mocks.sdk.getCleanupAssetsInSpaces.mockResolvedValue({ assetIds: ['a'] });
    mocks.showDialog.mockResolvedValue(true);
    renderDay();
    await fireEvent.keyDown(document, { key: 'Delete' });

    await fireEvent.click(screen.getByTestId('cleanup-move-to-trash'));

    await waitFor(() => expect(mocks.sdk.commitCleanup).toHaveBeenCalled());
  });

  it('warns about Space photos before finishing a day with trash marks, and stays put on cancel', async () => {
    mocks.sdk.getCleanupAssetsInSpaces.mockResolvedValue({ assetIds: ['a'] });
    mocks.showDialog.mockResolvedValue(false);
    renderDay();
    await fireEvent.keyDown(document, { key: 'Delete' });
    await fireEvent.keyDown(document, { key: 'k' });

    await fireEvent.click(screen.getByTestId('cleanup-finish-day'));

    await waitFor(() => expect(mocks.showDialog).toHaveBeenCalled());
    expect(mocks.sdk.commitCleanup).not.toHaveBeenCalled();
    expect(mocks.goto).not.toHaveBeenCalled();
    expect(tile('a')).toHaveAttribute('data-mark', 'trash');
    expect(tile('bb')).toHaveAttribute('data-mark', 'keep');
  });

  it('does not ask about Spaces when finishing a day without trash marks', async () => {
    mocks.sdk.getCleanupCalendar.mockResolvedValue({ days: [], daysReviewed: 0, streak: 0 });
    renderDay();
    await fireEvent.keyDown(document, { key: 'k' });

    await fireEvent.click(screen.getByTestId('cleanup-finish-day'));

    await waitFor(() => expect(mocks.goto).toHaveBeenCalled());
    expect(mocks.sdk.getCleanupAssetsInSpaces).not.toHaveBeenCalled();
  });

  it('does not finish a date with no photos from the keyboard, just as the button is disabled', async () => {
    renderDay([]);
    expect(screen.getByTestId('cleanup-finish-day')).toBeDisabled();

    await fireEvent.keyDown(document, { key: 'Enter', shiftKey: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.sdk.commitCleanup).not.toHaveBeenCalled();
    expect(mocks.goto).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it('finishes a date with photos from the keyboard', async () => {
    mocks.sdk.getCleanupCalendar.mockResolvedValue({ days: [], daysReviewed: 0, streak: 0 });
    renderDay();

    await fireEvent.keyDown(document, { key: 'Enter', shiftKey: true });

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/utilities/cleanup'));
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: expect.objectContaining({ completeMonthDay: 923 }),
    });
  });

  it('falls back to the hub when no other date needs a review', async () => {
    mocks.sdk.getCleanupCalendar.mockResolvedValue({ days: [], daysReviewed: 0, streak: 0 });
    renderDay();

    await fireEvent.click(screen.getByTestId('cleanup-finish-day'));

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/utilities/cleanup'));
  });

  it('keeps the marks and stays put when finishing fails', async () => {
    mocks.sdk.commitCleanup.mockRejectedValue(new Error('boom'));
    renderDay();
    await fireEvent.keyDown(document, { key: 'k' });

    await fireEvent.click(screen.getByTestId('cleanup-finish-day'));

    await waitFor(() => expect(mocks.sdk.commitCleanup).toHaveBeenCalled());
    expect(mocks.goto).not.toHaveBeenCalled();
    expect(tile('a')).toHaveAttribute('data-mark', 'keep');
  });

  it('asks before leaving the date with unsaved marks, but not when opening the viewer', async () => {
    mocks.showDialog.mockResolvedValue(true);
    renderDay();

    const clean = navigation({ monthDay: '924' });
    guard()(clean);
    expect(clean.cancel).not.toHaveBeenCalled();

    await fireEvent.keyDown(document, { key: 'k' });

    const viewer = navigation({ monthDay: '923', assetId: 'a' });
    guard()(viewer);
    expect(viewer.cancel).not.toHaveBeenCalled();

    const leave = navigation({ monthDay: '924' });
    guard()(leave);
    expect(leave.cancel).toHaveBeenCalled();
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith(leave.to!.url, { replaceState: false }));
    expect(mocks.showDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'cleanup_unsaved_marks_title' }));
  });

  it('stays on the date when the user keeps their marks', async () => {
    mocks.showDialog.mockResolvedValue(false);
    renderDay();
    await fireEvent.keyDown(document, { key: 'k' });

    const leave = navigation({ monthDay: '924' });
    guard()(leave);

    await waitFor(() => expect(mocks.showDialog).toHaveBeenCalled());
    expect(leave.cancel).toHaveBeenCalled();
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('ignores the shortcuts while a modal is open', async () => {
    mocks.isModalOpen.mockReturnValue(true);
    renderDay();

    await fireEvent.keyDown(document, { key: 'k' });
    await fireEvent.keyDown(document, { key: 'Enter', shiftKey: true });

    expect(tile('a')).toHaveAttribute('data-mark', 'none');
    expect(mocks.sdk.commitCleanup).not.toHaveBeenCalled();
  });

  it('replays a confirmed back-button navigation through history instead of pushing a new entry', async () => {
    mocks.showDialog.mockResolvedValue(true);
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    renderDay();
    await fireEvent.keyDown(document, { key: 'k' });

    const back = navigation({ monthDay: '922' }, { type: 'popstate', delta: -1 });
    guard()(back);

    await waitFor(() => expect(go).toHaveBeenCalledWith(-1));
    expect(back.cancel).toHaveBeenCalled();
    expect(mocks.goto).not.toHaveBeenCalled();
    go.mockRestore();
  });

  it('asks the browser to confirm unloading only while marks are unsaved', async () => {
    renderDay();
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
      dispatchEvent(event);
      return event;
    };

    expect(unload().defaultPrevented).toBe(false);
    await fireEvent.keyDown(document, { key: 'k' });
    const event = unload();
    expect(event.defaultPrevented).toBe(true);
    // eslint-disable-next-line tscompat/tscompat
    expect(event.returnValue).toBe('');
  });

  it('opens the focused photo in the viewer with Space', async () => {
    renderDay();

    await fireEvent.keyDown(document, { key: ' ' });

    expect(mocks.navigate).toHaveBeenCalledWith({ targetRoute: 'current', assetId: 'a' });
  });

  it('hides photos kept on an earlier visit until "Hide reviewed" is turned off', async () => {
    renderDay([asset('a'), asset('bb', { kept: true })]);

    expect(screen.queryByTestId('cleanup-rewind-tile-bb')).toBeNull();
    await fireEvent.click(screen.getByTestId('cleanup-hide-reviewed'));

    expect(tile('bb')).toHaveAttribute('data-mark', 'kept');
  });

  it('hints at the Bursts queue in one-at-a-time mode only for a photo taken within 2 s of another', async () => {
    renderDay([
      asset('a', { localDateTime: '2024-09-23T10:00:00.000Z' }),
      asset('bb', { localDateTime: '2024-09-23T10:00:01.500Z' }),
      asset('ccc', { localDateTime: '2024-09-23T18:00:00.000Z' }),
    ]);
    await fireEvent.click(screen.getByTestId('cleanup-mode-one'));

    expect(screen.getByTestId('cleanup-hint-burst')).toBeVisible();

    await fireEvent.click(screen.getByTestId('cleanup-rewind-next-ccc'));
    expect(screen.getByTestId('cleanup-rewind-stage-ccc')).toBeVisible();
    expect(screen.queryByTestId('cleanup-rewind-hints')).toBeNull();
  });

  it('does not hint at the Bursts queue for a photo taken within 2 s of a video only', async () => {
    renderDay([
      asset('a', { localDateTime: '2024-09-23T10:00:00.000Z' }),
      asset('bb', { localDateTime: '2024-09-23T10:00:01.500Z', type: AssetTypeEnum.Video }),
    ]);
    await fireEvent.click(screen.getByTestId('cleanup-mode-one'));

    expect(screen.getByTestId('cleanup-rewind-stage-a')).toBeVisible();
    expect(screen.queryByTestId('cleanup-hint-burst')).toBeNull();
  });

  it('remembers the chosen mode', async () => {
    renderDay();

    await fireEvent.click(screen.getByTestId('cleanup-mode-one'));

    expect(localStorage.getItem('cleanup.rewind.mode')).toBe('one');
    expect(screen.getByTestId('cleanup-rewind-one')).toBeVisible();
    expect(screen.queryByTestId('cleanup-rewind-tile-a')).toBeNull();
  });
});
