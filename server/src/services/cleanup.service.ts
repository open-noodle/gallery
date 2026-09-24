import { BadRequestException, Injectable } from '@nestjs/common';
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
  CLEANUP_BLURRY_DEFAULTS,
  CLEANUP_BURST_CLIP_MAX_DISTANCE,
  CLEANUP_BURST_GAP_MS,
  CLEANUP_BURST_MAX_EXTENSIONS,
  CLEANUP_BURST_MAX_WINDOWS_PER_PAGE,
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
  isCleanupCursorTimestamp,
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

/**
 * `decodeCursor` only validates the generic on-the-wire shape (an array of strings/numbers). Each
 * queue's keyset cursor has its own concrete shape, and a cursor that satisfies the generic check but
 * not the concrete one would otherwise reach a repository query as `NaN`/`Invalid Date` and fail with
 * a 500 instead of a 400. These re-validate per queue and throw `BadRequestException` on a mismatch.
 */
const decodeDateIdCursor = (raw: string): CleanupCursor => {
  const cursor = decodeCursor(raw);
  const [date, id] = cursor.v;
  if (cursor.v.length !== 2 || typeof date !== 'string' || typeof id !== 'string' || !isCleanupCursorTimestamp(date)) {
    throw new BadRequestException('Invalid cursor');
  }
  return cursor;
};

const decodeSizeIdCursor = (raw: string): CleanupCursor => {
  const cursor = decodeCursor(raw);
  const [size, id] = cursor.v;
  if (cursor.v.length !== 2 || typeof size !== 'number' || typeof id !== 'string') {
    throw new BadRequestException('Invalid cursor');
  }
  return cursor;
};

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

    if (queue === 'bursts') {
      const cursor = query.cursor ? decodeDateIdCursor(query.cursor) : undefined;
      return this.getBurstQueue(userId, cursor, limit);
    }

    let page: { items: CleanupAssetRow[]; next: CleanupCursor | null };
    switch (queue) {
      case 'space_hogs': {
        const cursor = query.cursor ? decodeSizeIdCursor(query.cursor) : undefined;
        page = await this.cleanupRepository.getSpaceHogs(userId, {
          cursor,
          limit,
          type: query.type ?? 'all',
          minSize: query.minSize ?? CLEANUP_SPACE_HOG_DEFAULT_MIN_SIZE,
        });
        break;
      }
      case 'screenshots': {
        const cursor = query.cursor ? decodeDateIdCursor(query.cursor) : undefined;
        page = await this.cleanupRepository.getScreenshots(userId, { cursor, limit });
        break;
      }
      case 'blurry': {
        const cursor = query.cursor ? decodeDateIdCursor(query.cursor) : undefined;
        page = await this.cleanupRepository.getBlurry(userId, {
          cursor,
          limit,
          strictness: query.strictness ?? CLEANUP_BLURRY_DEFAULTS.strictness,
          reason: query.reason ?? CLEANUP_BLURRY_DEFAULTS.reason,
          hideFaces: query.hideFaces ?? CLEANUP_BLURRY_DEFAULTS.hideFaces,
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
   *
   * When the extension probe finds a real gap, its rows are exactly the next window (same cursor,
   * same limit), so they are returned as `lookahead` and the caller passes them back in instead of
   * fetching them again — halving the queries per bursts page at 500k assets.
   *
   * Safety net: at most `CLEANUP_BURST_MAX_EXTENSIONS` extra windows are appended (a pathological
   * run of photos under 2 s apart would otherwise read the whole library into one page; such a run is
   * split at the cap instead), and a returned row equal to the cursor row is dropped.
   *
   * `stats.queries` counts the window queries run, for the caller's per-page cap.
   */
  private async fetchBurstWindow(
    userId: string,
    after: { cursorT?: string; id?: string },
    lookahead: BurstRow[] | undefined,
    stats: { queries: number },
  ): Promise<{ rows: BurstRow[]; reachedEnd: boolean; lookahead?: BurstRow[] }> {
    const query = (options: { cursorT?: string; id?: string }) => {
      stats.queries++;
      return this.cleanupRepository.getBurstWindow(userId, {
        afterLocalDateTime: options.cursorT,
        afterId: options.id,
        limit: CLEANUP_BURST_WINDOW,
      });
    };

    let window = lookahead ?? (await query(after));

    if (window.length < CLEANUP_BURST_WINDOW) {
      return { rows: window, reachedEnd: true };
    }

    for (let extensions = 0; extensions < CLEANUP_BURST_MAX_EXTENSIONS; extensions++) {
      const last = window.at(-1)!;
      const fetched = await query({ cursorT: last.cursorT, id: last.id });
      const more = fetched.filter((row) => row.id !== last.id);

      if (more.length === 0) {
        return { rows: window, reachedEnd: fetched.length < CLEANUP_BURST_WINDOW };
      }

      const gap = more[0].localDateTime.getTime() - last.localDateTime.getTime();
      if (gap > CLEANUP_BURST_GAP_MS) {
        return { rows: window, reachedEnd: false, lookahead: more };
      }

      window = [...window, ...more];
      if (fetched.length < CLEANUP_BURST_WINDOW) {
        return { rows: window, reachedEnd: true };
      }
    }

    return { rows: window, reachedEnd: false };
  }

  private async getBurstQueue(
    userId: string,
    cursor: CleanupCursor | undefined,
    limit: number,
  ): Promise<CleanupQueuePageDto> {
    let after: { cursorT?: string; id?: string } = cursor
      ? { cursorT: String(cursor.v[0]), id: String(cursor.v[1]) }
      : {};

    const groups: BurstGroup[] = [];
    let nextCursor: CleanupCursor | null = null;
    let reachedEnd = false;
    let lookahead: BurstRow[] | undefined;
    const stats = { queries: 0 };

    while (groups.length < limit) {
      // Cap the scan per page (a library with few bursts would otherwise read to its end here).
      // Stopping between windows keeps every group whole; `nextCursor` already points past the last
      // processed window, so the next page resumes exactly there. A held `lookahead` is dropped and
      // refetched by that next page.
      if (stats.queries >= CLEANUP_BURST_MAX_WINDOWS_PER_PAGE) {
        break;
      }

      const fetched = await this.fetchBurstWindow(userId, after, lookahead, stats);
      const { rows: window, reachedEnd: windowReachedEnd } = fetched;
      lookahead = fetched.lookahead;
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
        nextCursor = { v: [lastRow.cursorT, lastRow.id] };
        if (groups.length >= limit) {
          hitLimit = true;
          break;
        }
      }

      if (hitLimit) {
        break;
      }

      const lastWindowRow = window.at(-1)!;
      after = { cursorT: lastWindowRow.cursorT, id: lastWindowRow.id };
      nextCursor = { v: [lastWindowRow.cursorT, lastWindowRow.id] };

      if (windowReachedEnd) {
        reachedEnd = true;
        break;
      }
    }

    const ids = groups.flatMap((group) => group.assets.map((asset) => asset.id));
    const hydrated = ids.length > 0 ? await this.cleanupRepository.getCleanupAssets(userId, ids) : [];
    const byId = new Map(hydrated.map((row) => [row.id, row]));

    // A member can vanish between grouping and hydration (trashed, restored out of scope, etc. by a
    // concurrent request). Drop the missing member rather than crash, and drop the whole group if
    // fewer than 2 members survive — a "group" of 1 is not a burst.
    const dtoGroups: CleanupQueuePageDto['groups'] = [];
    for (const group of groups) {
      const assets = group.assets.filter((asset) => byId.has(asset.id));
      if (assets.length < 2) {
        continue;
      }
      dtoGroups.push({
        groupId: assets[0].id,
        source: group.source,
        assets: assets.map((asset) => mapAsset(byId.get(asset.id)!)),
        suggestedKeepId: suggestKeep(assets),
      });
    }

    return {
      items: [],
      groups: dtoGroups,
      nextCursor: reachedEnd || !nextCursor ? null : encodeCursor(nextCursor),
    };
  }

  async commit(auth: AuthDto, dto: CleanupCommitDto): Promise<CleanupCommitResponseDto> {
    const userId = auth.user.id;
    // Dedupe each incoming list first, so a client-side double-submit (or a duplicate id sent across
    // trash/favourite/keep) never produces a duplicate in `trashed[]`, the `AssetTrashAll` event, or
    // `favorited`.
    const trashIds = [...new Set(dto.trashIds)];
    const trashSet = new Set(trashIds);
    const favoriteIds = [...new Set(dto.favoriteIds).difference(trashSet)];
    const keepIds = [...new Set(dto.keepIds).difference(trashSet)];
    const all = [...new Set([...trashIds, ...favoriteIds, ...keepIds])];
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

    const trash = partition(trashIds);
    const favorite = partition(favoriteIds);
    const keep = partition(keepIds);

    // Step 1-2: trash + its event, ahead of and independent from the transaction below — a trashed
    // asset should land even if the (unrelated) day-review write below fails.
    // With the trash disabled there is nothing to recover from, so — like the duplicates utility and
    // `AssetService.deleteAll` with `force` — the delete is permanent rather than a soft-delete the
    // nightly job would purge anyway. The web asks for a "permanently delete" confirmation first.
    if (trash.length > 0) {
      const { trash: trashConfig } = await this.getConfig({ withCache: true });
      const isForce = !trashConfig.enabled;
      await this.assetRepository.updateAll(trash, {
        deletedAt: new Date(),
        status: isForce ? AssetStatus.Deleted : AssetStatus.Trashed,
      });
      await this.eventRepository.emit(isForce ? 'AssetDeleteAll' : 'AssetTrashAll', { assetIds: trash, userId });
    }

    // Steps 3-5 (favourite, keep, complete-the-day) share one database transaction.
    const keepAll = [...new Set([...favorite, ...keep])];
    if (favorite.length > 0 || keepAll.length > 0 || dto.completeMonthDay !== undefined) {
      await this.cleanupRepository.applyCommitDecisions(userId, dto.queue, {
        favoriteIds: favorite,
        keepIds: keep,
        completeMonthDay: dto.completeMonthDay,
      });
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
