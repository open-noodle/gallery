import { CleanupQueue, CleanupSkipReason } from '@immich/sdk';
import { commitWithUndo, confirmTrashInSpaces, keep, stackGroup, trashWithUndo } from '$lib/utils/cleanup-actions';

const mocks = vi.hoisted(() => ({
  sdk: {
    commitCleanup: vi.fn(),
    getCleanupAssetsInSpaces: vi.fn(),
    restoreAssets: vi.fn(),
    createStack: vi.fn(),
  },
  toast: { primary: vi.fn(), warning: vi.fn(), success: vi.fn(), danger: vi.fn(), info: vi.fn() },
  showDialog: vi.fn(),
  handleError: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.sdk }));
vi.mock('@immich/ui', () => ({
  toastManager: mocks.toast,
  modalManager: { showDialog: mocks.showDialog },
}));
vi.mock('$lib/utils/handle-error', () => ({ handleError: mocks.handleError }));

const ids = (count: number, prefix = 'id') => Array.from({ length: count }, (_, i) => `${prefix}-${i}`);

describe('cleanup actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.sdk.getCleanupAssetsInSpaces.mockResolvedValue({ assetIds: [] });
    mocks.sdk.commitCleanup.mockImplementation(({ cleanupCommitDto }) =>
      Promise.resolve({ trashed: cleanupCommitDto.trashIds ?? [], kept: 0, favorited: 0, skipped: [] }),
    );
    mocks.sdk.restoreAssets.mockResolvedValue(undefined);
    mocks.showDialog.mockResolvedValue(true);
  });

  describe('trashWithUndo', () => {
    it('splits 2,500 ids into three commits of at most 1,000', async () => {
      const all = ids(2500);
      const onRemoved = vi.fn();

      await trashWithUndo(CleanupQueue.Blurry, all, onRemoved, vi.fn());

      const sent = mocks.sdk.commitCleanup.mock.calls.map(([{ cleanupCommitDto }]) => cleanupCommitDto);
      expect(sent).toEqual([
        { queue: CleanupQueue.Blurry, trashIds: all.slice(0, 1000) },
        { queue: CleanupQueue.Blurry, trashIds: all.slice(1000, 2000) },
        { queue: CleanupQueue.Blurry, trashIds: all.slice(2000) },
      ]);
      expect(onRemoved).toHaveBeenCalledWith(all);
    });

    it('asks which photos are in a Space before committing anything', async () => {
      await trashWithUndo(CleanupQueue.Screenshots, ['a', 'b'], vi.fn(), vi.fn());

      expect(mocks.sdk.getCleanupAssetsInSpaces).toHaveBeenCalledWith({ cleanupInSpacesDto: { assetIds: ['a', 'b'] } });
      expect(mocks.sdk.getCleanupAssetsInSpaces.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.sdk.commitCleanup.mock.invocationCallOrder[0],
      );
    });

    it('warns about Space photos and commits nothing when the user cancels', async () => {
      mocks.sdk.getCleanupAssetsInSpaces.mockResolvedValue({ assetIds: ['b'] });
      mocks.showDialog.mockResolvedValue(false);
      const onRemoved = vi.fn();

      const result = await trashWithUndo(CleanupQueue.Blurry, ['a', 'b'], onRemoved, vi.fn());

      expect(mocks.showDialog).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'cleanup_space_warning', confirmColor: 'danger' }),
      );
      expect(mocks.sdk.commitCleanup).not.toHaveBeenCalled();
      expect(onRemoved).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('commits after the warning when the user confirms', async () => {
      mocks.sdk.getCleanupAssetsInSpaces.mockResolvedValue({ assetIds: ['b'] });

      await trashWithUndo(CleanupQueue.Blurry, ['a', 'b'], vi.fn(), vi.fn());

      expect(mocks.showDialog).toHaveBeenCalled();
      expect(mocks.sdk.commitCleanup).toHaveBeenCalledTimes(1);
    });

    it('skips the warning when nothing is in a Space', async () => {
      await trashWithUndo(CleanupQueue.Blurry, ['a'], vi.fn(), vi.fn());

      expect(mocks.showDialog).not.toHaveBeenCalled();
      expect(mocks.sdk.commitCleanup).toHaveBeenCalledTimes(1);
    });

    it('restores exactly the ids the server trashed when Undo is pressed', async () => {
      mocks.sdk.commitCleanup.mockResolvedValue({
        trashed: ['a'],
        kept: 0,
        favorited: 0,
        skipped: [{ id: 'b', reason: CleanupSkipReason.AlreadyTrashed }],
      });
      const onRemoved = vi.fn();
      const onRestored = vi.fn();

      await trashWithUndo(CleanupQueue.SpaceHogs, ['a', 'b'], onRemoved, onRestored);

      expect(onRemoved).toHaveBeenCalledWith(['a']);
      const [toast, options] = mocks.toast.primary.mock.calls[0];
      expect(toast.description).toBe('assets_trashed_count');
      expect(options).toEqual({ timeout: 5000 });
      await toast.button.onclick();
      expect(mocks.sdk.restoreAssets).toHaveBeenCalledWith({ bulkIdsDto: { ids: ['a'] } });
      expect(onRestored).toHaveBeenCalledWith(['a']);
    });

    it('reports skipped photos', async () => {
      mocks.sdk.commitCleanup.mockResolvedValue({
        trashed: [],
        kept: 0,
        favorited: 0,
        skipped: [{ id: 'a', reason: CleanupSkipReason.NotFound }],
      });

      await trashWithUndo(CleanupQueue.Blurry, ['a'], vi.fn(), vi.fn());

      expect(mocks.toast.warning).toHaveBeenCalledWith('cleanup_skipped_count');
      expect(mocks.toast.primary).not.toHaveBeenCalled();
    });

    it('still reports the chunks that committed before a later chunk failed', async () => {
      const all = ids(1500);
      mocks.sdk.commitCleanup
        .mockResolvedValueOnce({ trashed: all.slice(0, 1000), kept: 0, favorited: 0, skipped: [] })
        .mockRejectedValueOnce(new Error('boom'));
      const onRemoved = vi.fn();

      const result = await trashWithUndo(CleanupQueue.Blurry, all, onRemoved, vi.fn());

      expect(onRemoved).toHaveBeenCalledWith(all.slice(0, 1000));
      expect(mocks.handleError).toHaveBeenCalled();
      expect(result?.failed).toBe(true);
    });
  });

  describe('commitWithUndo', () => {
    it('resolves a burst group in one commit and only warns about the photos being trashed', async () => {
      await commitWithUndo(CleanupQueue.Bursts, { trashIds: ['b', 'c'], keepIds: ['a'] }, vi.fn(), vi.fn());

      expect(mocks.sdk.getCleanupAssetsInSpaces).toHaveBeenCalledWith({ cleanupInSpacesDto: { assetIds: ['b', 'c'] } });
      expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
        cleanupCommitDto: { queue: CleanupQueue.Bursts, trashIds: ['b', 'c'], keepIds: ['a'] },
      });
    });

    it('does not ask about Spaces when nothing is trashed', async () => {
      await commitWithUndo(CleanupQueue.Bursts, { keepIds: ['a', 'b'] }, vi.fn(), vi.fn());

      expect(mocks.sdk.getCleanupAssetsInSpaces).not.toHaveBeenCalled();
      expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
        cleanupCommitDto: { queue: CleanupQueue.Bursts, keepIds: ['a', 'b'] },
      });
    });
  });

  describe('confirmTrashInSpaces', () => {
    it('checks at most 1,000 ids per request', async () => {
      await confirmTrashInSpaces(ids(1200));

      expect(mocks.sdk.getCleanupAssetsInSpaces).toHaveBeenCalledTimes(2);
    });

    it('proceeds without a request when there is nothing to trash', async () => {
      await expect(confirmTrashInSpaces([])).resolves.toBe(true);
      expect(mocks.sdk.getCleanupAssetsInSpaces).not.toHaveBeenCalled();
    });
  });

  describe('keep', () => {
    it('sends keepIds and removes the kept photos from the view', async () => {
      const onRemoved = vi.fn();

      await keep(CleanupQueue.Blurry, ['a', 'b'], onRemoved);

      expect(mocks.sdk.commitCleanup).toHaveBeenCalledWith({
        cleanupCommitDto: { queue: CleanupQueue.Blurry, keepIds: ['a', 'b'] },
      });
      expect(onRemoved).toHaveBeenCalledWith(['a', 'b']);
    });
  });

  describe('stackGroup', () => {
    it('stacks the photos with the first id as the primary', async () => {
      mocks.sdk.createStack.mockResolvedValue({ id: 's', primaryAssetId: 'b', assets: [] });

      await expect(stackGroup(['b', 'a', 'c'])).resolves.toBe(true);

      expect(mocks.sdk.createStack).toHaveBeenCalledWith({ stackCreateDto: { assetIds: ['b', 'a', 'c'] } });
    });
  });
});
