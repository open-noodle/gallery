import { CleanupQueue, CleanupSkipReason } from '@immich/sdk';
import { RewindSession } from '$lib/managers/rewind-session.svelte';

const ok = (trashed: string[] = []) => ({ trashed, favorited: 0, kept: 0, skipped: [] });

describe('RewindSession', () => {
  it('cycles marks and undoes', () => {
    const s = new RewindSession(923, vi.fn());
    s.cycle('a');
    expect(s.marks.get('a')).toBe('keep');
    s.cycle('a');
    expect(s.marks.get('a')).toBe('fav');
    s.cycle('a');
    expect(s.marks.get('a')).toBe('trash');
    s.undo();
    expect(s.marks.get('a')).toBe('fav');
    s.cycle('a');
    s.cycle('a');
    expect(s.marks.has('a')).toBe(false);
  });

  it('undoes a markMany as a single step', () => {
    const s = new RewindSession(923, vi.fn());
    s.mark('a', 'trash');
    s.markMany(['a', 'b', 'c'], 'keep');
    expect(s.counts).toEqual({ keep: 3, fav: 0, trash: 0 });
    s.undo();
    expect(s.marks.get('a')).toBe('trash');
    expect(s.marks.has('b')).toBe(false);
    expect(s.counts).toEqual({ keep: 0, fav: 0, trash: 1 });
    expect(s.hasUncommitted).toBe(true);
  });

  it('commitTrash sends only trash marks and clears them', async () => {
    const commit = vi.fn().mockResolvedValue(ok(['t']));
    const s = new RewindSession(923, commit);
    s.mark('t', 'trash');
    s.mark('k', 'keep');
    await s.commitTrash();
    expect(commit).toHaveBeenCalledWith({ queue: CleanupQueue.Rewind, trashIds: ['t'], favoriteIds: [], keepIds: [] });
    expect(s.marks.has('t')).toBe(false);
    expect(s.marks.get('k')).toBe('keep');
  });

  it('finishDay chunks by 1000 and sends completeMonthDay only on the last chunk', async () => {
    const commit = vi.fn().mockResolvedValue(ok());
    const s = new RewindSession(923, commit);
    s.markMany(
      Array.from({ length: 2500 }, (_, i) => `id-${i}`),
      'keep',
    );
    await s.finishDay();
    expect(commit).toHaveBeenCalledTimes(3);
    expect(commit.mock.calls[0][0].completeMonthDay).toBeUndefined();
    expect(commit.mock.calls[1][0].completeMonthDay).toBeUndefined();
    expect(commit.mock.calls[2][0].completeMonthDay).toBe(923);
    expect(commit.mock.calls.every((c) => c[0].keepIds.length <= 1000)).toBe(true);
    expect(s.hasUncommitted).toBe(false);
  });

  it('finishDay with no marks still completes the day', async () => {
    const commit = vi.fn().mockResolvedValue(ok());
    await new RewindSession(229, commit).finishDay();
    expect(commit).toHaveBeenCalledWith({
      queue: CleanupQueue.Rewind,
      trashIds: [],
      favoriteIds: [],
      keepIds: [],
      completeMonthDay: 229,
    });
  });

  it('reports skipped totals across chunks', async () => {
    const commit = vi.fn().mockResolvedValue({
      trashed: [],
      favorited: 0,
      kept: 0,
      skipped: [{ id: 'x', reason: CleanupSkipReason.AlreadyTrashed }],
    });
    const s = new RewindSession(923, commit);
    s.mark('x', 'trash');
    await expect(s.commitTrash()).resolves.toEqual({ trashed: [], skipped: 1 });
  });

  it('exposes progress while committing and clears it afterwards', async () => {
    const seen: Array<{ done: number; total: number } | null> = [];
    const s = new RewindSession(
      923,
      vi.fn().mockImplementation(() => {
        seen.push(s.progress);
        return Promise.resolve(ok());
      }),
    );
    s.markMany(
      Array.from({ length: 1500 }, (_, i) => `id-${i}`),
      'trash',
    );
    await s.commitTrash();
    expect(seen).toEqual([
      { done: 0, total: 2 },
      { done: 1, total: 2 },
    ]);
    expect(s.progress).toBeNull();
  });

  it('keeps marks when the commit fails', async () => {
    const s = new RewindSession(923, vi.fn().mockRejectedValue(new Error('boom')));
    s.mark('t', 'trash');
    await expect(s.commitTrash()).rejects.toThrow('boom');
    expect(s.marks.get('t')).toBe('trash');
    expect(s.progress).toBeNull();
  });
});
