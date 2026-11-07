import TestWrapper from '#lib/components/TestWrapper.svelte';
import { finishedDay } from '#lib/gallery/cleanup/finished-day.ts';
import { rewindDirection } from '#lib/gallery/cleanup/rewind-direction.ts';
import { pulse } from '#lib/gallery/motion/index.ts';
import { navigate } from '#lib/utils/navigation.ts';
import { setPage } from '#test/unit/mocks/app-state.svelte.ts';
import { AssetTypeEnum, CleanupQueue, type CleanupAssetDto } from '@immich/sdk';
import { tick, type Component, type ComponentProps } from 'svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import type { BeforeNavigate } from '$app/navigation';
import RewindDay from './RewindDay.svelte';

/** Fires a keydown on the document as a key press would, then lets Svelte flush. */
const keyDown = async (init: KeyboardEventInit) => {
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  await tick();
};

const mocks = vi.hoisted(() => ({
  sdk: {
    commitCleanup: vi.fn(),
    restoreAssets: vi.fn(),
    getCleanupCalendar: vi.fn(),
    getCleanupRewindAssets: vi.fn(),
    getCleanupAssetsInSpaces: vi.fn(),
    // The one-at-a-time info panel's lookups; never resolved, the panel just shows its placeholder.
    getAssetInfo: vi.fn(() => new Promise(() => {})),
    getAllAlbums: vi.fn(() => Promise.resolve([])),
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
vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: mocks.goto,
  beforeNavigate: mocks.beforeNavigate,
}));
vi.mock('#lib/managers/feature-flags-manager.svelte.js', () => ({ featureFlagsManager: mocks.flags }));
vi.mock('#lib/gallery/motion/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  pulse: vi.fn(),
  celebrate: vi.fn(),
}));
// Spy mode keeps every real export; spreading importOriginal into a factory hangs browser mode.
vi.mock('#lib/utils/navigation.js', { spy: true });

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

const renderDay = async (assets = [asset('a'), asset('bb'), asset('ccc')]) => {
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

const tile = (id: string) => page.getByTestId(`cleanup-rewind-tile-${id}`);
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
    mocks.sdk.getCleanupAssetsInSpaces.mockResolvedValue({ assetIds: [], externalAssetIds: [] });
    mocks.flags.value.trash = true;
    vi.mocked(navigate).mockImplementation(mocks.navigate);
    setPage({ route: { id: '/(user)/utilities/cleanup/rewind/[monthDay]/[[photos=photos]]/[[assetId=id]]' } });
  });

  it('marks the focused tile from the keyboard and moves on to the next one', async () => {
    await renderDay();

    await keyDown({ key: 'Delete' });
    await keyDown({ key: 'k' });

    await expect.element(tile('a')).toHaveAttribute('data-mark', 'trash');
    await expect.element(tile('bb')).toHaveAttribute('data-mark', 'keep');
    await expect.element(tile('ccc')).toHaveAttribute('data-focused', 'true');
  });

  it('moves the trash marks to the trash, removes the tiles and puts them back on undo', async () => {
    mocks.sdk.commitCleanup.mockResolvedValue({ trashed: ['a'], favorited: 0, kept: 0, skipped: [] });
    await renderDay();
    await userEvent.click(tile('a'));
    await userEvent.click(tile('a'));
    await userEvent.click(tile('a'));
    await userEvent.click(tile('bb'));

    await userEvent.click(page.getByTestId('cleanup-move-to-trash'));

    expect(page.getByTestId('cleanup-rewind-tile-a').query()).toBeNull();
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: { queue: CleanupQueue.Rewind, trashIds: ['a'], favoriteIds: [], keepIds: [] },
    });
    // The keep mark on "bb" stays local until the day is finished.
    await expect.element(tile('bb')).toHaveAttribute('data-mark', 'keep');

    const [toast, options] = mocks.toast.primary.mock.calls[0];
    expect(toast.description).toBe('assets_trashed_count');
    expect(options).toEqual({ timeout: 5000 });
    await toast.button.onclick();

    expect(mocks.sdk.restoreAssets).toHaveBeenCalledWith({ bulkIdsDto: { ids: ['a'] } });
    await expect.element(tile('a')).toHaveAttribute('data-mark', 'none');
    const order = page
      .getByTestId(/^cleanup-rewind-tile-/)
      .elements()
      .map((el) => el.dataset.assetId);
    expect(order).toEqual(['a', 'bb', 'ccc']);
  });

  it('asks for a permanent delete, with no Undo, when the trash is turned off', async () => {
    mocks.flags.value.trash = false;
    mocks.showDialog.mockResolvedValue(true);
    mocks.sdk.commitCleanup.mockResolvedValue({ trashed: ['a'], favorited: 0, kept: 0, skipped: [] });
    await renderDay();
    await keyDown({ key: 'Delete' });

    await userEvent.click(page.getByTestId('cleanup-move-to-trash'));

    expect(page.getByTestId('cleanup-rewind-tile-a').query()).toBeNull();
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
    await renderDay();
    await keyDown({ key: 'Delete' });
    await keyDown({ key: 'k' });

    await userEvent.click(page.getByTestId('cleanup-finish-day'));

    await vi.waitFor(() => expect(mocks.showDialog).toHaveBeenCalled());
    expect(mocks.sdk.commitCleanup).not.toHaveBeenCalled();
    expect(mocks.goto).not.toHaveBeenCalled();
    await expect.element(tile('a')).toHaveAttribute('data-mark', 'trash');
  });

  it('reports skipped photos after a commit', async () => {
    mocks.sdk.commitCleanup.mockResolvedValue({
      trashed: [],
      favorited: 0,
      kept: 0,
      skipped: [{ id: 'a', reason: 'already_trashed' }],
    });
    await renderDay();
    await keyDown({ key: 'Delete' });

    await userEvent.click(page.getByTestId('cleanup-move-to-trash'));

    await vi.waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith('cleanup_skipped_count'));
    expect(mocks.toast.primary).not.toHaveBeenCalled();
  });

  it('finishes the day, shows the success card and waits for the choice of next date', async () => {
    mocks.sdk.getCleanupCalendar.mockResolvedValue({
      days: [
        { monthDay: 923, assetCount: 3, reviewedAt: null },
        { monthDay: 924, assetCount: 0, reviewedAt: null },
        { monthDay: 925, assetCount: 4, reviewedAt: null },
      ],
      daysReviewed: 0,
      streak: 0,
    });
    await renderDay();
    await keyDown({ key: 'k' });

    await userEvent.click(page.getByTestId('cleanup-finish-day'));

    const card = page.getByTestId('cleanup-day-done');
    await expect.element(card).toBeInTheDocument();
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: {
        queue: CleanupQueue.Rewind,
        trashIds: [],
        favoriteIds: [],
        keepIds: ['a'],
        completeMonthDay: 923,
      },
    });
    // The card does not move on by itself.
    expect(mocks.goto).not.toHaveBeenCalled();
    await expect.element(card).toMatchTextContent('cleanup_day_done_title');

    await userEvent.click(page.getByTestId('cleanup-day-done-next'));
    expect(mocks.goto).toHaveBeenCalledWith('/utilities/cleanup/rewind/925');
  });

  it('goes back to the hub from the success card when asked', async () => {
    mocks.sdk.getCleanupCalendar.mockResolvedValue({
      days: [{ monthDay: 925, assetCount: 4, reviewedAt: null }],
      daysReviewed: 0,
      streak: 0,
    });
    await renderDay();

    await userEvent.click(page.getByTestId('cleanup-finish-day'));
    await userEvent.click(page.getByTestId('cleanup-day-done-hub'));

    expect(mocks.goto).toHaveBeenCalledWith('/utilities/cleanup');
  });

  it('warns about photos in a Space before moving them to the trash, and keeps the marks on cancel', async () => {
    mocks.sdk.getCleanupAssetsInSpaces.mockResolvedValue({ assetIds: ['a'], externalAssetIds: [] });
    mocks.showDialog.mockResolvedValue(false);
    await renderDay();
    await keyDown({ key: 'Delete' });

    await userEvent.click(page.getByTestId('cleanup-move-to-trash'));

    await vi.waitFor(() =>
      expect(mocks.showDialog).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'cleanup_space_warning' })),
    );
    expect(mocks.sdk.getCleanupAssetsInSpaces).toHaveBeenCalledWith({ cleanupInSpacesDto: { assetIds: ['a'] } });
    expect(mocks.sdk.commitCleanup).not.toHaveBeenCalled();
    await expect.element(tile('a')).toHaveAttribute('data-mark', 'trash');
  });

  it('moves Space photos to the trash once the warning is confirmed', async () => {
    mocks.sdk.getCleanupAssetsInSpaces.mockResolvedValue({ assetIds: ['a'], externalAssetIds: [] });
    mocks.showDialog.mockResolvedValue(true);
    await renderDay();
    await keyDown({ key: 'Delete' });

    await userEvent.click(page.getByTestId('cleanup-move-to-trash'));

    await vi.waitFor(() => expect(mocks.sdk.commitCleanup).toHaveBeenCalled());
  });

  it('warns about Space photos before finishing a day with trash marks, and stays put on cancel', async () => {
    mocks.sdk.getCleanupAssetsInSpaces.mockResolvedValue({ assetIds: ['a'], externalAssetIds: [] });
    mocks.showDialog.mockResolvedValue(false);
    await renderDay();
    await keyDown({ key: 'Delete' });
    await keyDown({ key: 'k' });

    await userEvent.click(page.getByTestId('cleanup-finish-day'));

    await vi.waitFor(() => expect(mocks.showDialog).toHaveBeenCalled());
    expect(mocks.sdk.commitCleanup).not.toHaveBeenCalled();
    expect(mocks.goto).not.toHaveBeenCalled();
    await expect.element(tile('a')).toHaveAttribute('data-mark', 'trash');
    await expect.element(tile('bb')).toHaveAttribute('data-mark', 'keep');
  });

  it('does not ask about Spaces when finishing a day without trash marks', async () => {
    mocks.sdk.getCleanupCalendar.mockResolvedValue({ days: [], daysReviewed: 0, streak: 0 });
    await renderDay();
    await keyDown({ key: 'k' });

    await userEvent.click(page.getByTestId('cleanup-finish-day'));

    await expect.element(page.getByTestId('cleanup-day-done')).toBeInTheDocument();
    expect(mocks.sdk.getCleanupAssetsInSpaces).not.toHaveBeenCalled();
  });

  it('does not finish a date with no photos from the keyboard, just as the button is disabled', async () => {
    await renderDay([]);
    await expect.element(page.getByTestId('cleanup-finish-day')).toBeDisabled();

    await keyDown({ key: 'Enter', shiftKey: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.sdk.commitCleanup).not.toHaveBeenCalled();
    expect(mocks.goto).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it('finishes a date with photos from the keyboard', async () => {
    mocks.sdk.getCleanupCalendar.mockResolvedValue({ days: [], daysReviewed: 0, streak: 0 });
    await renderDay();

    await keyDown({ key: 'Enter', shiftKey: true });

    await expect.element(page.getByTestId('cleanup-day-done')).toBeInTheDocument();
    expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
      cleanupCommitDto: expect.objectContaining({ completeMonthDay: 923 }),
    });
  });

  it('offers only the way back to the hub when no other date needs a review', async () => {
    mocks.sdk.getCleanupCalendar.mockResolvedValue({ days: [], daysReviewed: 0, streak: 0 });
    await renderDay();

    await userEvent.click(page.getByTestId('cleanup-finish-day'));

    await expect.element(page.getByTestId('cleanup-day-done-hub')).toBeInTheDocument();
    await expect.element(page.getByTestId('cleanup-day-done-next')).not.toBeInTheDocument();
  });

  it('offers Finish again at the end of the day, once every year is loaded', async () => {
    mocks.sdk.getCleanupCalendar.mockResolvedValue({ days: [], daysReviewed: 0, streak: 0 });
    await renderDay();

    const end = page.getByTestId('cleanup-rewind-end');
    await userEvent.click(end.getByRole('button'));

    await expect.element(page.getByTestId('cleanup-day-done')).toBeInTheDocument();
  });

  it('keeps the marks and stays put when finishing fails', async () => {
    mocks.sdk.commitCleanup.mockRejectedValue(new Error('boom'));
    await renderDay();
    await keyDown({ key: 'k' });

    await userEvent.click(page.getByTestId('cleanup-finish-day'));

    await vi.waitFor(() => expect(mocks.sdk.commitCleanup).toHaveBeenCalled());
    expect(mocks.goto).not.toHaveBeenCalled();
    await expect.element(tile('a')).toHaveAttribute('data-mark', 'keep');
  });

  it('asks before leaving the date with unsaved marks, but not when opening the viewer', async () => {
    mocks.showDialog.mockResolvedValue(true);
    await renderDay();

    const clean = navigation({ monthDay: '924' });
    guard()(clean);
    expect(clean.cancel).not.toHaveBeenCalled();

    await keyDown({ key: 'k' });

    const viewer = navigation({ monthDay: '923', assetId: 'a' });
    guard()(viewer);
    expect(viewer.cancel).not.toHaveBeenCalled();

    const leave = navigation({ monthDay: '924' });
    guard()(leave);
    expect(leave.cancel).toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledWith(leave.to!.url, { replace: false }));
    expect(mocks.showDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'cleanup_unsaved_marks_title' }));
  });

  it('stays on the date when the user keeps their marks', async () => {
    mocks.showDialog.mockResolvedValue(false);
    await renderDay();
    await keyDown({ key: 'k' });

    const leave = navigation({ monthDay: '924' });
    guard()(leave);

    await vi.waitFor(() => expect(mocks.showDialog).toHaveBeenCalled());
    expect(leave.cancel).toHaveBeenCalled();
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('ignores the shortcuts while a modal is open', async () => {
    mocks.isModalOpen.mockReturnValue(true);
    await renderDay();

    await keyDown({ key: 'k' });
    await keyDown({ key: 'Enter', shiftKey: true });

    await expect.element(tile('a')).toHaveAttribute('data-mark', 'none');
    expect(mocks.sdk.commitCleanup).not.toHaveBeenCalled();
  });

  it('replays a confirmed back-button navigation through history instead of pushing a new entry', async () => {
    mocks.showDialog.mockResolvedValue(true);
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    await renderDay();
    await keyDown({ key: 'k' });

    const back = navigation({ monthDay: '922' }, { type: 'popstate', delta: -1 });
    guard()(back);

    await vi.waitFor(() => expect(go).toHaveBeenCalledWith(-1));
    expect(back.cancel).toHaveBeenCalled();
    expect(mocks.goto).not.toHaveBeenCalled();
    go.mockRestore();
  });

  it('asks the browser to confirm unloading only while marks are unsaved', async () => {
    await renderDay();
    const unload = () => {
      // A real BeforeUnloadEvent: on a plain Event, returnValue is the legacy boolean, not the prompt string.
      const event = document.createEvent('BeforeUnloadEvent');
      event.initEvent('beforeunload', false, true);
      dispatchEvent(event);
      return event;
    };

    expect(unload().defaultPrevented).toBe(false);
    await keyDown({ key: 'k' });
    const event = unload();
    expect(event.defaultPrevented).toBe(true);
    expect(event.returnValue).toBe('');
  });

  it('opens the focused photo in the viewer with Space', async () => {
    await renderDay();

    await keyDown({ key: ' ' });

    expect(mocks.navigate).toHaveBeenCalledWith({ targetRoute: 'current', assetId: 'a' });
  });

  it('hides photos kept on an earlier visit until "Hide reviewed" is turned off', async () => {
    await renderDay([asset('a'), asset('bb', { kept: true })]);

    expect(page.getByTestId('cleanup-rewind-tile-bb').query()).toBeNull();
    await userEvent.click(page.getByTestId('cleanup-hide-reviewed'));

    await expect.element(tile('bb')).toHaveAttribute('data-mark', 'kept');
  });

  it('hints at the Bursts queue in one-at-a-time mode only for a photo taken within 2 s of another', async () => {
    await renderDay([
      asset('a', { localDateTime: '2024-09-23T10:00:00.000Z' }),
      asset('bb', { localDateTime: '2024-09-23T10:00:01.500Z' }),
      asset('ccc', { localDateTime: '2024-09-23T18:00:00.000Z' }),
    ]);
    await userEvent.click(page.getByTestId('cleanup-mode-one'));

    await expect.element(page.getByTestId('cleanup-hint-burst')).toBeVisible();

    await userEvent.click(page.getByTestId('cleanup-rewind-next-ccc'));
    await expect.element(page.getByTestId('cleanup-rewind-stage-ccc')).toBeVisible();
    expect(page.getByTestId('cleanup-rewind-hints').query()).toBeNull();
  });

  it('does not hint at the Bursts queue for a photo taken within 2 s of a video only', async () => {
    await renderDay([
      asset('a', { localDateTime: '2024-09-23T10:00:00.000Z' }),
      asset('bb', { localDateTime: '2024-09-23T10:00:01.500Z', type: AssetTypeEnum.Video }),
    ]);
    await userEvent.click(page.getByTestId('cleanup-mode-one'));

    await expect.element(page.getByTestId('cleanup-rewind-stage-a')).toBeVisible();
    expect(page.getByTestId('cleanup-hint-burst').query()).toBeNull();
  });

  it('remembers the chosen mode', async () => {
    await renderDay();

    await userEvent.click(page.getByTestId('cleanup-mode-one'));

    expect(localStorage.getItem('cleanup.rewind.mode')).toBe('one');
    await expect.element(page.getByTestId('cleanup-rewind-one')).toBeVisible();
    expect(page.getByTestId('cleanup-rewind-tile-a').query()).toBeNull();
  });

  describe('explainer', () => {
    // The slide-out ends from the animation's onfinish; stub animate so it finishes on the next tick.
    beforeEach(() => {
      vi.spyOn(Element.prototype, 'animate').mockImplementation(() => {
        // Svelte ends a transition from the animation's onfinish, so the stub finishes on the next tick.
        const animation = { cancel: () => {}, finished: Promise.resolve(), onfinish: null as (() => void) | null };
        setTimeout(() => animation.onfinish?.(), 0);
        return animation as unknown as Animation;
      });
    });

    it('shows on the first rewind and not on the second', async () => {
      const first = await renderDay();
      await expect.element(page.getByTestId('cleanup-rewind-explainer')).toBeVisible();
      await expect.element(page.getByTestId('cleanup-rewind-explainer')).toMatchTextContent('cleanup_explainer_title');
      await first.unmount();

      await renderDay();
      await expect.element(page.getByTestId('cleanup-rewind-explainer')).not.toBeInTheDocument();
    });

    it('reopens from the info button and closes with ×', async () => {
      localStorage.setItem('cleanup.rewind.explainer-seen', 'true');
      await renderDay();
      await expect.element(page.getByTestId('cleanup-rewind-explainer')).not.toBeInTheDocument();

      await userEvent.click(page.getByTestId('cleanup-rewind-info'));
      await expect.element(page.getByTestId('cleanup-rewind-explainer')).toBeVisible();

      await userEvent.click(page.getByTestId('cleanup-rewind-explainer-close'));
      await expect.element(page.getByTestId('cleanup-rewind-explainer')).not.toBeInTheDocument();
    });

    it('works when storage throws', async () => {
      // Seen in storage that then becomes unreadable: the explainer must still show, not crash.
      localStorage.setItem('cleanup.rewind.explainer-seen', 'true');
      vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      await renderDay();

      await expect.element(page.getByTestId('cleanup-rewind-explainer')).toBeVisible();
      await userEvent.click(page.getByTestId('cleanup-rewind-explainer-close'));
      await expect.element(page.getByTestId('cleanup-rewind-explainer')).not.toBeInTheDocument();
      vi.restoreAllMocks();
    });

    it('appears in one-at-a-time mode too', async () => {
      localStorage.setItem('cleanup.rewind.mode', 'one');
      await renderDay();

      await expect.element(page.getByTestId('cleanup-rewind-one')).toBeVisible();
      await expect.element(page.getByTestId('cleanup-rewind-explainer')).toBeVisible();
    });
  });

  it('titles the page with the date and says how many photos and years it holds', async () => {
    await renderDay();

    await expect.element(page.getByTestId('cleanup-rewind-heading')).toMatchTextContent('September 23');
    await expect
      .element(page.getByTestId('cleanup-rewind-heading'))
      .toHaveAttribute('data-shared-element', 'cleanup-day-title');
    await expect.element(page.getByTestId('cleanup-rewind-subtitle')).toMatchTextContent('cleanup_rewind_subtitle');
  });

  it('undoes the last mark from the Undo button, for phones without a Z key', async () => {
    await renderDay();
    await keyDown({ key: 'k' });
    await expect.element(tile('a')).toHaveAttribute('data-mark', 'keep');

    await userEvent.click(page.getByTestId('cleanup-rewind-undo'));

    await expect.element(tile('a')).not.toHaveAttribute('data-mark', 'keep');
  });

  it('records the finished date for the hub', async () => {
    mocks.sdk.getCleanupCalendar.mockResolvedValue({ days: [], daysReviewed: 0, streak: 0 });
    finishedDay.take();
    await renderDay();

    await userEvent.click(page.getByTestId('cleanup-finish-day'));

    await expect.element(page.getByTestId('cleanup-day-done')).toBeInTheDocument();
    expect(finishedDay.take()).toBe(923);
  });

  it('pulses "Move to trash" once when the first photo is marked for trash, not on later marks', async () => {
    await renderDay();
    expect(pulse).not.toHaveBeenCalled();

    await keyDown({ key: 'Delete' });
    expect(pulse).toHaveBeenCalledTimes(1);
    expect(pulse).toHaveBeenCalledWith(page.getByTestId('cleanup-move-to-trash').element());

    await keyDown({ key: 'Delete' });
    expect(pulse).toHaveBeenCalledTimes(1);
  });

  it('marks the progress bar complete once every photo is reviewed', async () => {
    await renderDay();
    const bar = page.getByTestId('cleanup-rewind-progress-bar');
    await expect.element(bar).not.toHaveAttribute('data-complete');

    for (let i = 0; i < 3; i++) {
      await keyDown({ key: 'k' });
    }

    await expect.element(bar).toHaveAttribute('data-complete', 'true');
  });

  it('records the direction of travel when moving to the next or previous date', async () => {
    rewindDirection.take();
    await renderDay();
    // The arrows are real links: stop the browser following them, which would navigate the test frame away.
    // This listener runs after the page's own handlers, so they still see an ordinary click.
    const stay = (event: Event) => event.preventDefault();
    document.addEventListener('click', stay);
    onTestFinished(() => document.removeEventListener('click', stay));

    await userEvent.click(page.getByTestId('cleanup-rewind-next'));
    expect(rewindDirection.take()).toBe(1);

    await userEvent.click(page.getByTestId('cleanup-rewind-previous'));
    expect(rewindDirection.take()).toBe(-1);
  });
});
