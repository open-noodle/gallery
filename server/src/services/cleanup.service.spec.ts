import { AssetStatus, AssetType, AssetVisibility, CleanupQueue, JobName, JobStatus } from 'src/enum.js';
import { CleanupAssetRow } from 'src/repositories/cleanup.repository.js';
import { CleanupService } from 'src/services/cleanup.service.js';
import { BurstRow, CLEANUP_BURST_WINDOW } from 'src/utils/cleanup.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const toCleanupRow = (row: BurstRow): CleanupAssetRow => ({
  id: row.id,
  type: AssetType.Image,
  originalFileName: `${row.id}.jpg`,
  localDateTime: row.localDateTime,
  thumbhash: null,
  width: 100,
  height: 100,
  duration: null,
  fileSize: row.fileSize,
  isFavorite: false,
  inAlbum: false,
  city: null,
  kept: false,
});

const hydrateFromRows = (mocks: ServiceMocks, rows: BurstRow[]) => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  mocks.cleanup.getCleanupAssets.mockImplementation((_userId: string, ids: string[]) =>
    Promise.resolve(ids.map((id) => toCleanupRow(byId.get(id)!))),
  );
};

describe(CleanupService.name, () => {
  let sut: CleanupService;
  let mocks: ServiceMocks;
  beforeEach(() => {
    ({ sut, mocks } = newTestService(CleanupService));
  });

  describe('commit', () => {
    const userId = authStub.user1.user.id;
    const row = (
      id: string,
      over: Partial<{
        ownerId: string;
        deletedAt: Date | null;
        visibility: AssetVisibility;
        isOffline: boolean;
        libraryId: string | null;
      }> = {},
    ) => ({
      id,
      ownerId: userId,
      deletedAt: null,
      visibility: AssetVisibility.Timeline,
      isOffline: false,
      libraryId: null,
      ...over,
    });

    it('trashes eligible ids and reports the rest as skipped without failing', async () => {
      mocks.cleanup.getCommitCandidates.mockResolvedValue([
        row('a'),
        row('b', { deletedAt: new Date() }),
        row('c', { ownerId: 'someone-else' }),
        row('d', { visibility: AssetVisibility.Locked }),
        row('e', { libraryId: 'lib' }),
        row('f', { isOffline: true }),
      ]);
      const res = await sut.commit(authStub.user1, {
        queue: CleanupQueue.Rewind,
        trashIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        favoriteIds: [],
        keepIds: [],
      });
      expect(mocks.asset.updateAll).toHaveBeenCalledWith(
        ['a'],
        expect.objectContaining({ status: AssetStatus.Trashed }),
      );
      expect(mocks.event.emit).toHaveBeenCalledWith('AssetTrashAll', { assetIds: ['a'], userId });
      expect(res.trashed).toEqual(['a']);
      expect(res.skipped).toEqual(
        expect.arrayContaining([
          { id: 'b', reason: 'already_trashed' },
          { id: 'c', reason: 'not_found' },
          { id: 'd', reason: 'out_of_scope' },
          { id: 'e', reason: 'out_of_scope' },
          { id: 'f', reason: 'out_of_scope' },
          { id: 'g', reason: 'not_found' },
        ]),
      );
    });

    it('does not emit or update when nothing is eligible', async () => {
      mocks.cleanup.getCommitCandidates.mockResolvedValue([]);
      await sut.commit(authStub.user1, { queue: CleanupQueue.Blurry, trashIds: ['x'], favoriteIds: [], keepIds: [] });
      expect(mocks.asset.updateAll).not.toHaveBeenCalled();
      expect(mocks.event.emit).not.toHaveBeenCalled();
    });

    it('treats favourites as keeps and completes the day only when asked', async () => {
      mocks.cleanup.getCommitCandidates.mockResolvedValue([row('a'), row('b')]);
      const res = await sut.commit(authStub.user1, {
        queue: CleanupQueue.Rewind,
        trashIds: [],
        favoriteIds: ['a'],
        keepIds: ['b'],
        completeMonthDay: 923,
      });
      expect(mocks.asset.updateAll).toHaveBeenCalledWith(['a'], { isFavorite: true });
      expect(mocks.cleanup.upsertDecisions).toHaveBeenCalledWith(
        userId,
        CleanupQueue.Rewind,
        expect.arrayContaining(['a', 'b']),
      );
      expect(mocks.cleanup.upsertDayReview).toHaveBeenCalledWith(userId, 923, expect.any(Date));
      expect(res).toMatchObject({ favorited: 1, kept: 2 });
    });

    it('never upserts a day review without completeMonthDay', async () => {
      mocks.cleanup.getCommitCandidates.mockResolvedValue([row('a')]);
      await sut.commit(authStub.user1, { queue: CleanupQueue.Rewind, trashIds: [], favoriteIds: [], keepIds: ['a'] });
      expect(mocks.cleanup.upsertDayReview).not.toHaveBeenCalled();
    });

    it('does not let one id be both trashed and kept (trash wins)', async () => {
      mocks.cleanup.getCommitCandidates.mockResolvedValue([row('a')]);
      const res = await sut.commit(authStub.user1, {
        queue: CleanupQueue.Rewind,
        trashIds: ['a'],
        favoriteIds: ['a'],
        keepIds: ['a'],
      });
      expect(res.trashed).toEqual(['a']);
      expect(res.kept).toBe(0);
      expect(res.favorited).toBe(0);
    });
  });

  describe('getCalendar', () => {
    it('returns 366 days, merges counts and reviews, and computes the streak', async () => {
      vi.useFakeTimers().setSystemTime(new Date('2026-09-23T10:00:00Z'));
      mocks.cleanup.getCalendarCounts.mockResolvedValue([
        { monthDay: 923, assetCount: 4 },
        { monthDay: 922, assetCount: 1 },
      ]);
      mocks.cleanup.getDayReviews.mockResolvedValue([
        { monthDay: 922, reviewedAt: new Date('2026-09-22T09:00:00Z') },
        { monthDay: 101, reviewedAt: new Date('2026-09-23T09:00:00Z') },
      ]);
      const res = await sut.getCalendar(authStub.user1, 'UTC');
      expect(res.days).toHaveLength(366);
      expect(res.days.find((d) => d.monthDay === 923)).toEqual({ monthDay: 923, assetCount: 4, reviewedAt: null });
      expect(res.days.find((d) => d.monthDay === 922)!.reviewedAt).toBe('2026-09-22T09:00:00.000Z');
      expect(res.daysReviewed).toBe(1); // 101 has no photos -> not counted
      expect(res.streak).toBe(2);
      vi.useRealTimers();
    });
  });

  describe('handleQualityAnalysis', () => {
    it('skips when there is no preview yet', async () => {
      mocks.cleanup.getForQualityAnalysis.mockResolvedValue({
        id: 'a',
        ownerId: 'u',
        type: 'IMAGE',
        originalFileName: 'a.jpg',
        libraryId: null,
        visibility: AssetVisibility.Timeline,
        deletedAt: null,
        previewPath: null,
        make: null,
        model: null,
        width: 100,
        height: 100,
      } as never);
      await expect(sut.handleQualityAnalysis({ id: 'a' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.cleanup.upsertQuality).not.toHaveBeenCalled();
    });
    it('skips external-library and missing assets', async () => {
      mocks.cleanup.getForQualityAnalysis.mockResolvedValue(undefined);
      await expect(sut.handleQualityAnalysis({ id: 'a' })).resolves.toBe(JobStatus.Skipped);
      mocks.cleanup.getForQualityAnalysis.mockResolvedValue({ libraryId: 'lib' } as never);
      await expect(sut.handleQualityAnalysis({ id: 'a' })).resolves.toBe(JobStatus.Skipped);
    });
    it('writes only the screenshot flag for videos', async () => {
      mocks.cleanup.getForQualityAnalysis.mockResolvedValue({
        id: 'v',
        ownerId: 'u',
        type: 'VIDEO',
        originalFileName: 'Screen Recording 1.mov',
        libraryId: null,
        visibility: AssetVisibility.Timeline,
        deletedAt: null,
        previewPath: '/p.jpg',
        make: null,
        model: null,
        width: 1,
        height: 1,
      } as never);
      await sut.handleQualityAnalysis({ id: 'v' });
      expect(mocks.cleanup.upsertQuality).toHaveBeenCalledWith(
        expect.objectContaining({ isScreenshot: true, sharpness: null, brightness: null }),
      );
    });
    it('scores an image from its preview and cleans up the temp file', async () => {
      const cleanup = vi.fn();
      vi.spyOn(sut as any, 'ensureLocalFile').mockResolvedValue({ localPath: '/tmp/x', cleanup });
      const px = new Uint8Array(25);
      px[12] = 255;
      mocks.media.getGreyscalePixels.mockResolvedValue({ data: Buffer.from(px), width: 5, height: 5 });
      mocks.cleanup.getForQualityAnalysis.mockResolvedValue({
        id: 'a',
        ownerId: 'u',
        type: 'IMAGE',
        originalFileName: 'a.jpg',
        libraryId: null,
        visibility: AssetVisibility.Timeline,
        deletedAt: null,
        previewPath: 'upload/p.jpg',
        make: 'x',
        model: 'y',
        width: 1,
        height: 1,
      } as never);
      await expect(sut.handleQualityAnalysis({ id: 'a' })).resolves.toBe(JobStatus.Success);
      expect(mocks.media.getGreyscalePixels).toHaveBeenCalledWith('/tmp/x', 512);
      expect(mocks.cleanup.upsertQuality).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: 'a',
          isScreenshot: false,
          version: 1,
          sharpness: expect.any(Number),
          brightness: expect.any(Number),
        }),
      );
      expect(cleanup).toHaveBeenCalled();
    });
    it('records null scores and does not throw when decoding fails, and always cleans up', async () => {
      const cleanup = vi.fn();
      vi.spyOn(sut as any, 'ensureLocalFile').mockResolvedValue({ localPath: '/tmp/x', cleanup });
      mocks.media.getGreyscalePixels.mockRejectedValue(new Error('corrupt'));
      mocks.cleanup.getForQualityAnalysis.mockResolvedValue({
        id: 'a',
        ownerId: 'u',
        type: 'IMAGE',
        originalFileName: 'a.jpg',
        libraryId: null,
        visibility: AssetVisibility.Timeline,
        deletedAt: null,
        previewPath: 'upload/p.jpg',
        make: 'x',
        model: 'y',
        width: 1,
        height: 1,
      } as never);
      await expect(sut.handleQualityAnalysis({ id: 'a' })).resolves.toBe(JobStatus.Success);
      expect(mocks.cleanup.upsertQuality).toHaveBeenCalledWith(expect.objectContaining({ sharpness: null }));
      expect(cleanup).toHaveBeenCalled();
    });
  });

  describe('handleQualityQueueAll', () => {
    it('queues in batches and resets on force', async () => {
      mocks.cleanup.streamAssetsForQualityAnalysis.mockReturnValue(
        (function* () {
          yield { id: 'a' };
          yield { id: 'b' };
        })() as never,
      );
      await sut.handleQualityQueueAll({ force: true });
      expect(mocks.cleanup.resetQualityAnalyzedAt).toHaveBeenCalled();
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.AssetAnalyzeQuality, data: { id: 'a' } },
        { name: JobName.AssetAnalyzeQuality, data: { id: 'b' } },
      ]);
    });
  });

  describe('getQueueCount', () => {
    it('reports analysedPercent for blurry and screenshots only', async () => {
      mocks.cleanup.countQueue.mockResolvedValue({ count: 3, bytes: 30 });
      mocks.cleanup.getAnalysedPercent.mockResolvedValue(72);
      await expect(sut.getQueueCount(authStub.user1, 'blurry', {})).resolves.toEqual({
        count: 3,
        bytes: 30,
        analysedPercent: 72,
      });
      mocks.cleanup.countDuplicates.mockResolvedValue({ count: 1, bytes: 5 });
      await expect(sut.getQueueCount(authStub.user1, 'duplicates', {})).resolves.toEqual({ count: 1, bytes: 5 });
    });
  });

  describe('getQueue("bursts")', () => {
    const t0 = new Date('2024-01-01T00:00:00.000Z');
    const at = (ms: number) => new Date(t0.getTime() + ms);

    const burstRow = (id: string, localDateTime: Date, over: Partial<BurstRow> = {}): BurstRow => ({
      id,
      localDateTime,
      autoStackId: null,
      sharpness: 0,
      fileSize: 100,
      ...over,
    });

    it('groups a burstId run without a CLIP check and a timeWindow run that passes it', async () => {
      // burstId group: same autoStackId, no CLIP check needed.
      const g1a = burstRow('g1a', at(0), { autoStackId: 'stack1', sharpness: 10, fileSize: 100 });
      const g1b = burstRow('g1b', at(1000), { autoStackId: 'stack1', sharpness: 20, fileSize: 50 });
      // timeWindow group: no autoStackId, must pass the CLIP check.
      const g2a = burstRow('g2a', at(4000), { sharpness: 5, fileSize: 200 });
      const g2b = burstRow('g2b', at(5000), { sharpness: 15, fileSize: 80 });
      // lone row: never forms a group (groupBursts drops singletons).
      const lone = burstRow('lone', at(15_000));

      const rows = [g1a, g1b, g2a, g2b, lone];
      mocks.cleanup.getBurstWindow.mockResolvedValueOnce(rows);
      mocks.cleanup.getBurstClipDistances.mockResolvedValue(
        new Map<string, number>([
          [g2a.id, 0],
          [g2b.id, 0.05],
        ]),
      );
      hydrateFromRows(mocks, rows);

      const res = await sut.getQueue(authStub.user1, 'bursts', {});

      expect(mocks.cleanup.getBurstClipDistances).toHaveBeenCalledWith([[g2a.id, g2b.id]]);
      expect(res.groups).toHaveLength(2);
      expect(res.groups[0]).toMatchObject({ groupId: 'g1a', source: 'burstId', suggestedKeepId: 'g1b' });
      expect(res.groups[0].assets.map((a) => a.id)).toEqual(['g1a', 'g1b']);
      expect(res.groups[1]).toMatchObject({ groupId: 'g2a', source: 'timeWindow', suggestedKeepId: 'g2b' });
      expect(res.groups[1].assets.map((a) => a.id)).toEqual(['g2a', 'g2b']);
      expect(res.nextCursor).toBeNull();
    });

    it('drops a timeWindow group with a distance over the threshold or a missing embedding', async () => {
      const a = burstRow('a', at(0), { sharpness: 5 });
      const b = burstRow('b', at(1000), { sharpness: 15 });
      const c = burstRow('c', at(4000), { sharpness: 5 });
      const d = burstRow('d', at(5000), { sharpness: 15 });

      const rows = [a, b, c, d];
      mocks.cleanup.getBurstWindow.mockResolvedValueOnce(rows);
      // group [a, b] fails: b's distance is over the max. group [c, d] fails: d has no embedding at all.
      mocks.cleanup.getBurstClipDistances.mockResolvedValue(
        new Map<string, number>([
          [a.id, 0],
          [b.id, 0.5],
          [c.id, 0],
        ]),
      );
      hydrateFromRows(mocks, rows);

      const res = await sut.getQueue(authStub.user1, 'bursts', {});

      expect(res.groups).toHaveLength(0);
      expect(res.nextCursor).toBeNull();
    });

    it('extends a group split across the window boundary and stops at the limit', async () => {
      const rows: BurstRow[] = [];
      for (let i = 0; i < CLEANUP_BURST_WINDOW; i++) {
        rows.push(burstRow(`w${i}`, at(i), { sharpness: i }));
      }
      const continuation = [
        burstRow('c0', at(CLEANUP_BURST_WINDOW), { sharpness: 9999 }),
        burstRow('c1', at(CLEANUP_BURST_WINDOW + 1), { sharpness: 1 }),
      ];

      mocks.cleanup.getBurstWindow.mockResolvedValueOnce(rows).mockResolvedValueOnce(continuation);
      mocks.cleanup.getBurstClipDistances.mockImplementation((groups: string[][]) => {
        const map = new Map<string, number>();
        for (const group of groups) {
          for (const id of group) {
            map.set(id, 0);
          }
        }
        return Promise.resolve(map);
      });
      hydrateFromRows(mocks, [...rows, ...continuation]);

      const res = await sut.getQueue(authStub.user1, 'bursts', { limit: 1 });

      expect(mocks.cleanup.getBurstWindow).toHaveBeenCalledTimes(2);
      expect(res.groups).toHaveLength(1);
      expect(res.groups[0].assets).toHaveLength(CLEANUP_BURST_WINDOW + continuation.length);
      expect(res.groups[0].assets.at(-1)!.id).toBe('c1');
      expect(res.nextCursor).not.toBeNull();
    });
  });
});
