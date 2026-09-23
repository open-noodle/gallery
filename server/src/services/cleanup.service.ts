import { Injectable } from '@nestjs/common';
import type { JobOf } from 'src/types.js';
import { OnJob } from 'src/decorators.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  CleanupCalendarResponseDto,
  CleanupCommitDto,
  CleanupCommitResponseDto,
  CleanupDecisionDeleteDto,
  CleanupInSpacesDto,
  CleanupInSpacesResponseDto,
  CleanupQueuePageDto,
  CleanupQueueQueryDto,
  CleanupRewindAssetsResponseDto,
  CleanupRewindYearsResponseDto,
  CleanupTrashResponseDto,
} from 'src/dtos/cleanup.dto.js';
import { AssetStatus, AssetType, AssetVisibility, JobName, JobStatus, QueueName } from 'src/enum.js';
import { CleanupAssetRow } from 'src/repositories/cleanup.repository.js';
import { BaseService } from 'src/services/base.service.js';
import {
  ALL_MONTH_DAYS,
  BurstGroup,
  BurstRow,
  CLEANUP_ANALYSIS_SIZE,
  CLEANUP_BURST_CLIP_MAX_DISTANCE,
  CLEANUP_BURST_GAP_MS,
  CLEANUP_BURST_WINDOW,
  CLEANUP_PAGE_LIMIT,
  CLEANUP_QUALITY_VERSION,
  CLEANUP_SPACE_HOG_DEFAULT_MIN_SIZE,
  CleanupCursor,
  computeStreak,
  decodeCursor,
  encodeCursor,
  exposureStats,
  groupBursts,
  isScreenshotCandidate,
  laplacianVariance,
  suggestKeep,
} from 'src/utils/cleanup.js';
import { mimeTypes } from 'src/utils/mime-types.js';

export type CleanupCountQueue = 'space_hogs' | 'bursts' | 'screenshots' | 'blurry' | 'duplicates';
export type CleanupListQueue = 'space_hogs' | 'bursts' | 'screenshots' | 'blurry';

/** Extra query fields `getQueueCount`/`getQueue` may receive, beyond `cursor`/`limit`. */
type CleanupCountOptions = {
  strictness?: CleanupQueueQueryDto['strictness'];
  reason?: CleanupQueueQueryDto['reason'];
  hideFaces?: boolean;
  minSize?: number;
  type?: CleanupQueueQueryDto['type'];
};

const mapAsset = (row: CleanupAssetRow) => ({ ...row, localDateTime: row.localDateTime.toISOString() });

@Injectable()
export class CleanupService extends BaseService {
  async getQueueCount(auth: AuthDto, queue: CleanupCountQueue, query: CleanupCountOptions) {
    const userId = auth.user.id;

    switch (queue) {
      case 'duplicates': {
        return this.cleanupRepository.countDuplicates(userId);
      }

      case 'bursts': {
        return this.cleanupRepository.countBursts(userId);
      }

      case 'space_hogs': {
        return this.cleanupRepository.countQueue(userId, 'space_hogs', {
          minSize: query.minSize ?? CLEANUP_SPACE_HOG_DEFAULT_MIN_SIZE,
          type: query.type ?? 'all',
        });
      }

      case 'blurry':
      case 'screenshots': {
        const [totals, analysedPercent] = await Promise.all([
          this.cleanupRepository.countQueue(userId, queue, query),
          this.cleanupRepository.getAnalysedPercent(userId, queue === 'blurry' ? 'image' : 'all'),
        ]);
        return { ...totals, analysedPercent };
      }
    }
  }

  async getTrash(auth: AuthDto): Promise<CleanupTrashResponseDto> {
    return this.cleanupRepository.getTrashTotals(auth.user.id);
  }

  async getCalendar(auth: AuthDto, tz: string): Promise<CleanupCalendarResponseDto> {
    const userId = auth.user.id;
    const [counts, reviews] = await Promise.all([
      this.cleanupRepository.getCalendarCounts(userId),
      this.cleanupRepository.getDayReviews(userId),
    ]);

    const countByDay = new Map(counts.map((c) => [c.monthDay, c.assetCount]));
    const reviewByDay = new Map(reviews.map((r) => [r.monthDay, r.reviewedAt]));

    const days = ALL_MONTH_DAYS.map((monthDay) => ({
      monthDay,
      assetCount: countByDay.get(monthDay) ?? 0,
      reviewedAt: reviewByDay.get(monthDay)?.toISOString() ?? null,
    }));

    const daysReviewed = days.filter((day) => reviewByDay.has(day.monthDay) && day.assetCount > 0).length;
    const streak = computeStreak(
      reviews.map((r) => r.reviewedAt),
      tz,
      new Date(),
    );

    return { days, daysReviewed, streak };
  }

  async getRewindYears(auth: AuthDto, monthDay: number): Promise<CleanupRewindYearsResponseDto> {
    const years = await this.cleanupRepository.getRewindYears(auth.user.id, monthDay);
    return { years };
  }

  async getRewindAssets(auth: AuthDto, monthDay: number, year: number): Promise<CleanupRewindAssetsResponseDto> {
    const rows = await this.cleanupRepository.getRewindAssets(auth.user.id, monthDay, year);
    return { assets: rows.map((row) => mapAsset(row)) };
  }

  async getQueue(auth: AuthDto, queue: CleanupListQueue, query: CleanupQueueQueryDto): Promise<CleanupQueuePageDto> {
    const userId = auth.user.id;
    const limit = query.limit ?? CLEANUP_PAGE_LIMIT.default;
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

    if (queue === 'bursts') {
      return this.getBurstQueue(userId, cursor, limit);
    }

    let page: { items: CleanupAssetRow[]; next: CleanupCursor | null };
    switch (queue) {
      case 'space_hogs': {
        page = await this.cleanupRepository.getSpaceHogs(userId, {
          cursor,
          limit,
          type: query.type ?? 'all',
          minSize: query.minSize ?? CLEANUP_SPACE_HOG_DEFAULT_MIN_SIZE,
        });
        break;
      }
      case 'screenshots': {
        page = await this.cleanupRepository.getScreenshots(userId, { cursor, limit });
        break;
      }
      case 'blurry': {
        page = await this.cleanupRepository.getBlurry(userId, {
          cursor,
          limit,
          strictness: query.strictness ?? 'balanced',
          reason: query.reason ?? 'all',
          hideFaces: query.hideFaces ?? true,
        });
        break;
      }
    }

    return {
      items: page.items.map((row) => mapAsset(row)),
      groups: [],
      nextCursor: page.next ? encodeCursor(page.next) : null,
    };
  }

  /**
   * Fetches a window of up to `CLEANUP_BURST_WINDOW` rows after `after`, then extends it with
   * further windows while the boundary falls inside a burst (the last row of the fetched window
   * is within `CLEANUP_BURST_GAP_MS` of the next row) — so a group is never split across a page.
   * `reachedEnd` is true once a fetch comes back short, meaning there is nothing left to scan.
   */
  private async fetchBurstWindow(
    userId: string,
    after: { localDateTime?: Date; id?: string },
  ): Promise<{ rows: BurstRow[]; reachedEnd: boolean }> {
    let window = await this.cleanupRepository.getBurstWindow(userId, {
      afterLocalDateTime: after.localDateTime,
      afterId: after.id,
      limit: CLEANUP_BURST_WINDOW,
    });

    if (window.length < CLEANUP_BURST_WINDOW) {
      return { rows: window, reachedEnd: true };
    }

    for (;;) {
      const last = window.at(-1)!;
      const more = await this.cleanupRepository.getBurstWindow(userId, {
        afterLocalDateTime: last.localDateTime,
        afterId: last.id,
        limit: CLEANUP_BURST_WINDOW,
      });

      if (more.length === 0) {
        return { rows: window, reachedEnd: true };
      }

      const gap = more[0].localDateTime.getTime() - last.localDateTime.getTime();
      if (gap > CLEANUP_BURST_GAP_MS) {
        return { rows: window, reachedEnd: false };
      }

      window = [...window, ...more];
      if (more.length < CLEANUP_BURST_WINDOW) {
        return { rows: window, reachedEnd: true };
      }
    }
  }

  private async getBurstQueue(
    userId: string,
    cursor: CleanupCursor | undefined,
    limit: number,
  ): Promise<CleanupQueuePageDto> {
    let after: { localDateTime?: Date; id?: string } = cursor
      ? { localDateTime: new Date(String(cursor.v[0])), id: String(cursor.v[1]) }
      : {};

    const groups: BurstGroup[] = [];
    let nextCursor: CleanupCursor | null = null;
    let reachedEnd = false;

    while (groups.length < limit) {
      const { rows: window, reachedEnd: windowReachedEnd } = await this.fetchBurstWindow(userId, after);
      if (window.length === 0) {
        reachedEnd = true;
        break;
      }

      const rawGroups = groupBursts(window);
      const timeWindowGroups = rawGroups.filter((g) => g.source === 'timeWindow');
      const distances =
        timeWindowGroups.length > 0
          ? await this.cleanupRepository.getBurstClipDistances(timeWindowGroups.map((g) => g.assets.map((a) => a.id)))
          : new Map<string, number>();

      const validGroups = rawGroups.filter((group) => {
        if (group.source !== 'timeWindow') {
          return true;
        }
        return group.assets.every((asset) => {
          const distance = distances.get(asset.id);
          return distance !== undefined && distance <= CLEANUP_BURST_CLIP_MAX_DISTANCE;
        });
      });

      let hitLimit = false;
      for (const group of validGroups) {
        groups.push(group);
        const lastRow = group.assets.at(-1)!;
        nextCursor = { v: [lastRow.localDateTime.toISOString(), lastRow.id] };
        if (groups.length >= limit) {
          hitLimit = true;
          break;
        }
      }

      if (hitLimit) {
        break;
      }

      const lastWindowRow = window.at(-1)!;
      after = { localDateTime: lastWindowRow.localDateTime, id: lastWindowRow.id };
      nextCursor = { v: [lastWindowRow.localDateTime.toISOString(), lastWindowRow.id] };

      if (windowReachedEnd) {
        reachedEnd = true;
        break;
      }
    }

    const ids = groups.flatMap((group) => group.assets.map((asset) => asset.id));
    const hydrated = ids.length > 0 ? await this.cleanupRepository.getCleanupAssets(userId, ids) : [];
    const byId = new Map(hydrated.map((row) => [row.id, row]));

    return {
      items: [],
      groups: groups.map((group) => ({
        groupId: group.assets[0].id,
        source: group.source,
        assets: group.assets.map((asset) => mapAsset(byId.get(asset.id)!)),
        suggestedKeepId: suggestKeep(group.assets),
      })),
      nextCursor: reachedEnd || !nextCursor ? null : encodeCursor(nextCursor),
    };
  }

  async commit(auth: AuthDto, dto: CleanupCommitDto): Promise<CleanupCommitResponseDto> {
    const userId = auth.user.id;
    const trashSet = new Set(dto.trashIds);
    const favoriteIds = dto.favoriteIds.filter((id) => !trashSet.has(id));
    const keepIds = dto.keepIds.filter((id) => !trashSet.has(id));
    const all = [...new Set([...dto.trashIds, ...favoriteIds, ...keepIds])];
    const candidates = await this.cleanupRepository.getCommitCandidates(all);
    const rows = new Map(candidates.map((r) => [r.id, r]));

    const skipped: Array<{ id: string; reason: 'not_found' | 'out_of_scope' | 'already_trashed' }> = [];
    const eligible = (id: string): true | 'not_found' | 'out_of_scope' | 'already_trashed' => {
      const row = rows.get(id);
      if (!row || row.ownerId !== userId) {
        return 'not_found';
      }
      if (row.deletedAt) {
        return 'already_trashed';
      }
      const inScope =
        (row.visibility === AssetVisibility.Timeline || row.visibility === AssetVisibility.Archive) &&
        !row.isOffline &&
        !row.libraryId;
      if (!inScope) {
        return 'out_of_scope';
      }
      return true;
    };
    const partition = (ids: string[]) =>
      ids.filter((id) => {
        const ok = eligible(id);
        if (ok === true) {
          return true;
        }
        if (skipped.every((s) => s.id !== id)) {
          skipped.push({ id, reason: ok });
        }
        return false;
      });

    const trash = partition(dto.trashIds);
    const favorite = partition(favoriteIds);
    const keep = partition(keepIds);

    if (trash.length > 0) {
      await this.assetRepository.updateAll(trash, { deletedAt: new Date(), status: AssetStatus.Trashed });
      await this.eventRepository.emit('AssetTrashAll', { assetIds: trash, userId });
    }
    if (favorite.length > 0) {
      await this.assetRepository.updateAll(favorite, { isFavorite: true });
    }

    const keepAll = [...new Set([...favorite, ...keep])];
    if (keepAll.length > 0) {
      await this.cleanupRepository.upsertDecisions(userId, dto.queue, keepAll);
    }
    if (dto.completeMonthDay !== undefined) {
      await this.cleanupRepository.upsertDayReview(userId, dto.completeMonthDay, new Date());
    }

    return { trashed: trash, favorited: favorite.length, kept: keepAll.length, skipped };
  }

  async deleteDecisions(auth: AuthDto, dto: CleanupDecisionDeleteDto): Promise<void> {
    await this.cleanupRepository.deleteDecisions(auth.user.id, dto.queue, dto.assetIds);
  }

  async getAssetsInSpaces(auth: AuthDto, dto: CleanupInSpacesDto): Promise<CleanupInSpacesResponseDto> {
    const assetIds = await this.cleanupRepository.getAssetIdsInSpaces(auth.user.id, dto.assetIds);
    return { assetIds };
  }

  @OnJob({ name: JobName.AssetAnalyzeQualityQueueAll, queue: QueueName.QualityAnalysis })
  async handleQualityQueueAll({ force }: JobOf<JobName.AssetAnalyzeQualityQueueAll>): Promise<JobStatus> {
    if (force) {
      await this.cleanupRepository.resetQualityAnalyzedAt();
    }

    let batch: Array<{ name: JobName.AssetAnalyzeQuality; data: { id: string } }> = [];
    for await (const { id } of this.cleanupRepository.streamAssetsForQualityAnalysis(!!force)) {
      batch.push({ name: JobName.AssetAnalyzeQuality, data: { id } });
      if (batch.length >= 1000) {
        await this.jobRepository.queueAll(batch);
        batch = [];
      }
    }
    await this.jobRepository.queueAll(batch);

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetAnalyzeQuality, queue: QueueName.QualityAnalysis })
  async handleQualityAnalysis({ id }: JobOf<JobName.AssetAnalyzeQuality>): Promise<JobStatus> {
    const asset = await this.cleanupRepository.getForQualityAnalysis(id);
    if (!asset || asset.libraryId || asset.deletedAt) {
      return JobStatus.Skipped;
    }

    const isScreenshot = isScreenshotCandidate({
      originalFileName: asset.originalFileName,
      mimeType: mimeTypes.lookup(asset.originalFileName),
      make: asset.make,
      model: asset.model,
      width: asset.width,
      height: asset.height,
    });
    const base = { assetId: asset.id, ownerId: asset.ownerId, isScreenshot, version: CLEANUP_QUALITY_VERSION };

    if (asset.type !== AssetType.Image) {
      await this.cleanupRepository.upsertQuality({
        ...base,
        sharpness: null,
        brightness: null,
        clippedDark: null,
        clippedBright: null,
      });
      return JobStatus.Success;
    }

    if (!asset.previewPath) {
      return JobStatus.Skipped;
    }

    const { localPath, cleanup } = await this.ensureLocalFile(asset.previewPath);
    try {
      const { data, width, height } = await this.mediaRepository.getGreyscalePixels(localPath, CLEANUP_ANALYSIS_SIZE);
      await this.cleanupRepository.upsertQuality({
        ...base,
        sharpness: laplacianVariance(data, width, height),
        ...exposureStats(data),
      });
    } catch (error) {
      this.logger.warn(`Quality analysis could not decode preview for ${asset.id}: ${error}`);
      await this.cleanupRepository.upsertQuality({
        ...base,
        sharpness: null,
        brightness: null,
        clippedDark: null,
        clippedBright: null,
      });
    } finally {
      await cleanup();
    }

    return JobStatus.Success;
  }
}
