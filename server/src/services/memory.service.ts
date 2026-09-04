import { BadRequestException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { SystemConfig } from 'src/config';
import { Memory } from 'src/database';
import { OnJob } from 'src/decorators';
import { BulkIdResponseDto, BulkIdsDto } from 'src/dtos/asset-ids.response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { mapMemory, MemoryCreateDto, MemoryResponseDto, MemorySearchDto, MemoryUpdateDto } from 'src/dtos/memory.dto';
import { DatabaseLock, JobName, MemoryType, Permission, QueueName, SystemMetadataKey } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { MemoryRule, MemoryRuleCandidate } from 'src/services/memory-rules/memory-rule.interface';
import {
  getAdminAvailableMemoryTypeKeys,
  getMemoryTypeFloor,
  getMemoryTypeKeyForMemory,
  getMemoryTypeMetadata,
  isMemoryTypeEnabledForUser,
} from 'src/services/memory-rules/memory-type.metadata';
import { createMemoryRules } from 'src/services/memory-rules/memory-type.registry';
import { planReservation, ReservableMemory } from 'src/services/memory-rules/reservation.util';
import { MemoryThemeSearchAdapter } from 'src/services/memory-rules/theme-search.adapter';
import { ThemeSearchPort } from 'src/services/memory-rules/theme-search.port';
import { MemoriesState, RuleMemoryData } from 'src/types';
import { addAssets, removeAssets } from 'src/utils/asset.util';
import { getPreferences } from 'src/utils/preferences';

const DAYS = 3;
/**
 * Cap on rule memories *visible* on a given day, so a multi-day recap holds its slot for its
 * whole window. Sized from the worst-case overlap of the current rules: the calendar-fixed
 * windows only ever overlap two deep (e.g. `person_throwback` 13–19 and `favorites_throwback`
 * 15–21), plus `recent_trip` and `trip_anniversary`, which can start on any day — four lingering
 * cards. The remaining two slots keep the date-anchored 1-day rules (`birthday` above all, since
 * a missed one waits a year) from ever being crowded out.
 */
export const RULE_DAILY_LIMIT = 6;

/**
 * Claim-order bands. Offsets are far larger than any real rule score (the highest is `birthday`
 * at ~330), so type always outranks score: an `on_this_day` can never overtake a rule memory,
 * and no rule memory can overtake an unmanaged one. See spec §6.3.
 */
const RANK_UNMANAGED = 2_000_000;
const RANK_RULE = 1_000_000;
const RANK_ON_THIS_DAY = 0;

interface MemoryOverlapRow {
  id: string;
  type: string;
  data: unknown;
  isSaved: boolean;
  showAt: Date | null;
  hideAt: Date | null;
  assets: { id: string }[];
}

const isVisibleOn = (row: Pick<MemoryOverlapRow, 'showAt' | 'hideAt'>, target: DateTime): boolean => {
  const start = target.startOf('day').toJSDate();
  const end = target.endOf('day').toJSDate();
  return (row.showAt === null || row.showAt <= end) && (row.hideAt === null || row.hideAt >= start);
};

@Injectable()
export class MemoryService extends BaseService {
  @OnJob({ name: JobName.MemoryGenerate, queue: QueueName.BackgroundTask })
  async onMemoriesCreate() {
    const users = await this.userRepository.getList({ withDeleted: false });
    const config = await this.getConfig({ withCache: false });

    const availableTypes = getAdminAvailableMemoryTypeKeys(config.memories);
    const userTypesById = new Map(users.map((user) => [user.id, getPreferences(user.metadata ?? []).memories.types]));
    const enabledRuleKeysById = new Map(
      users.map((user) => [
        user.id,
        [...availableTypes].filter(
          (key) =>
            getMemoryTypeMetadata(key)?.kind === 'rule' && isMemoryTypeEnabledForUser(userTypesById.get(user.id), key),
        ),
      ]),
    );
    const onThisDayUsers = availableTypes.has('on_this_day')
      ? users.filter((user) => isMemoryTypeEnabledForUser(userTypesById.get(user.id), 'on_this_day'))
      : [];

    await this.databaseRepository.withLock(DatabaseLock.MemoryCreation, async () => {
      const state = (await this.systemMetadataRepository.get(SystemMetadataKey.MemoriesState)) ?? {};
      const nextState = { ...state };
      const start = DateTime.utc().startOf('day').minus({ days: DAYS });
      const lastOnThisDayDate = nextState.lastOnThisDayDate ? DateTime.fromISO(nextState.lastOnThisDayDate) : start;

      // generate a memory +/- X days from today
      for (let i = 0; i <= DAYS * 2; i++) {
        const target = start.plus({ days: i });
        if (lastOnThisDayDate >= target) {
          continue;
        }

        this.logger.log(`Creating memories for ${target.toISO()}`);
        try {
          await Promise.all(onThisDayUsers.map((owner) => this.createOnThisDayMemories(owner.id, target)));
        } catch (error) {
          this.logger.error(`Failed to create memories for ${target.toISO()}: ${error}`);
        }
        // update system metadata even when there is an error to minimize the chance of duplicates
        nextState.lastOnThisDayDate = target.toISO()!;
        await this.systemMetadataRepository.set(SystemMetadataKey.MemoriesState, {
          ...nextState,
        });
      }

      const today = DateTime.utc().startOf('day');
      const lastRuleDate = nextState.lastRuleDate
        ? DateTime.fromISO(nextState.lastRuleDate).startOf('day')
        : today.minus({ days: 1 });

      for (let target = lastRuleDate.plus({ days: 1 }); target <= today; target = target.plus({ days: 1 })) {
        this.logger.log(`Creating rule memories for ${target.toISO()}`);
        try {
          await Promise.all(
            users.map((owner) => this.createRuleMemories(owner.id, target, enabledRuleKeysById.get(owner.id) ?? [])),
          );
          nextState.lastRuleDate = target.toISO()!;
          await this.systemMetadataRepository.set(SystemMetadataKey.MemoriesState, {
            ...nextState,
          });
        } catch (error) {
          this.logger.error(`Failed to create rule memories for ${target.toISO()}: ${error}`);
        }
      }

      // `today` is already declared above for the rule loop — reuse it rather than introducing a
      // second name for the same value. Wrapped in try/catch to fail soft, matching every other
      // phase in this method: a lookup error here must not block the nightly reconcile pass below.
      try {
        await this.backfillMemoryOverlap(
          users.map(({ id }) => id),
          today,
          nextState,
          availableTypes,
          userTypesById,
        );
      } catch (error) {
        this.logger.error(`Failed to backfill memory overlap: ${error}`);
      }

      const reconcileTo = today.plus({ days: DAYS });
      for (const owner of users) {
        try {
          await this.reconcileMemoryOverlap(
            owner.id,
            today,
            reconcileTo,
            availableTypes,
            userTypesById.get(owner.id) ?? {},
          );
        } catch (error) {
          this.logger.error(`Failed to reconcile memory overlap for ${owner.id}: ${error}`);
        }
      }
    });
  }

  private async createOnThisDayMemories(ownerId: string, target: DateTime) {
    const showAt = target.startOf('day').toISO();
    const hideAt = target.endOf('day').toISO();
    const memories = await this.assetRepository.getByDayOfYear([ownerId], target);
    await Promise.all(
      memories.map(({ year, assets }) =>
        this.memoryRepository.create(
          {
            ownerId,
            type: MemoryType.OnThisDay,
            data: { year },
            memoryAt: target.set({ year }).toISO()!,
            showAt,
            hideAt,
          },
          new Set(assets.map(({ id }) => id)),
        ),
      ),
    );
  }

  /**
   * A memory may be stripped or deleted only when it is unambiguously one this job generated.
   * `MemoryType` has just two values and `POST /memories` accepts both, so a hand-made memory is
   * indistinguishable by type alone — hence the `showAt`/`hideAt` and registry checks. Anything
   * else still claims its assets (otherwise the duplicate survives) but is never modified.
   * See spec §6.2.1.
   */
  private toReservable(row: MemoryOverlapRow, stripped: Map<string, Set<string>>): ReservableMemory {
    const key = getMemoryTypeKeyForMemory(row.type as MemoryType, row.data);
    const isKnownType = key !== undefined && getMemoryTypeMetadata(key) !== undefined;
    const managed = !row.isSaved && row.showAt !== null && row.hideAt !== null && isKnownType;

    const alreadyStripped = stripped.get(row.id);
    const assetIds = row.assets.map(({ id }) => id).filter((id) => !alreadyStripped?.has(id));

    // `data` is untyped JSON from storage — a corrupt/foreign row's `score` need not be a number.
    // Without the `Number.isFinite` guard a non-numeric value yields NaN, which poisons `priority`
    // and makes the comparator degrade silently (NaN comparisons are always false).
    const rawScore = (row.data as RuleMemoryData | null | undefined)?.score;
    const score = typeof rawScore === 'number' && Number.isFinite(rawScore) ? rawScore : 0;

    return {
      id: row.id,
      assetIds,
      managed,
      floor: getMemoryTypeFloor(key),
      priority: managed ? (row.type === MemoryType.Rule ? RANK_RULE + score : RANK_ON_THIS_DAY) : RANK_UNMANAGED,
    };
  }

  /**
   * Reconcile overlap across history, once. The nightly window only reaches `today + DAYS`, but
   * the memories index lists a year of history, so without this the duplicates already on screen
   * would survive until retention expired them. Days outer / users inner, so one cursor makes it
   * resumable — the same shape as `lastOnThisDayDate`.
   */
  private async backfillMemoryOverlap(
    ownerIds: string[],
    today: DateTime,
    state: MemoriesState,
    availableTypes: Set<string>,
    userTypesById: Map<string, Record<string, boolean>>,
  ) {
    if (
      state.overlapBackfilledAt &&
      DateTime.fromISO(state.overlapBackfilledAt, { zone: 'utc' }).startOf('day') >= today
    ) {
      return;
    }

    const oldest = await this.memoryRepository.getOldestMemoryDate();
    if (!oldest) {
      state.overlapBackfilledAt = today.toISO()!;
      await this.systemMetadataRepository.set(SystemMetadataKey.MemoriesState, { ...state });
      return;
    }

    // `{ zone: 'utc' }` is load-bearing: without it fromISO builds a LOCAL DateTime, and
    // startOf('day') then lands on a different instant than the UTC `today` it is compared to.
    // Tests would pass in UTC CI and fail on a machine west of Greenwich.
    const start = state.overlapBackfilledAt
      ? DateTime.fromISO(state.overlapBackfilledAt, { zone: 'utc' }).startOf('day').plus({ days: 1 })
      : DateTime.fromJSDate(oldest, { zone: 'utc' }).startOf('day');

    for (let target = start; target <= today; target = target.plus({ days: 1 })) {
      for (const ownerId of ownerIds) {
        try {
          await this.reconcileMemoryOverlap(ownerId, target, target, availableTypes, userTypesById.get(ownerId) ?? {});
        } catch (error) {
          this.logger.error(`Failed to backfill memory overlap for ${ownerId} on ${target.toISO()}: ${error}`);
        }
      }

      state.overlapBackfilledAt = target.toISO()!;
      await this.systemMetadataRepository.set(SystemMetadataKey.MemoriesState, { ...state });
    }
  }

  /**
   * Make every day in `[from, to]` non-overlapping for one owner: no photo appears in two of that
   * day's memories, and a generated memory left under its floor is deleted. Resolving per day is
   * what keeps it exact — two memories whose windows never overlap are never forced apart.
   */
  private async reconcileMemoryOverlap(
    ownerId: string,
    from: DateTime,
    to: DateTime,
    availableTypes: Set<string>,
    userTypes: Record<string, boolean>,
  ) {
    const allRows = (await this.memoryRepository.getForOverlapReconcile(ownerId, {
      from: from.startOf('day').toJSDate(),
      to: to.endOf('day').toJSDate(),
    })) as MemoryOverlapRow[];

    // A memory whose type is currently invisible to this owner (admin-disabled or user-disabled)
    // must be dropped from consideration entirely — it can neither claim assets nor be stripped
    // or deleted itself. `search` hides these rows but nothing deletes them, so without this
    // filter an invisible memory still ranks and claims, and can end up deleting a *visible*
    // lower-ranked card that lost its assets to something the user can't even see. See spec F1.
    // Reuses `isMemoryTypeVisible` (used by `search`) rather than a second copy that can drift.
    const rows = allRows.filter((row) =>
      this.isMemoryTypeVisible(
        { type: row.type as MemoryType, data: row.data, isSaved: row.isSaved },
        availableTypes,
        userTypes,
      ),
    );

    if (rows.length === 0) {
      return;
    }

    const stripped = new Map<string, Set<string>>();
    const removed = new Set<string>();

    for (let target = from.startOf('day'); target <= to.startOf('day'); target = target.plus({ days: 1 })) {
      const visible = rows.filter((row) => !removed.has(row.id) && isVisibleOn(row, target));
      if (visible.length === 0) {
        continue;
      }

      const plan = planReservation(visible.map((row) => this.toReservable(row, stripped)));

      for (const { memoryId, assetIds } of plan.strip) {
        const set = stripped.get(memoryId) ?? new Set<string>();
        for (const assetId of assetIds) {
          set.add(assetId);
        }
        stripped.set(memoryId, set);
      }

      for (const id of plan.remove) {
        removed.add(id);
      }
    }

    for (const id of removed) {
      stripped.delete(id);
      await this.memoryRepository.delete(id);
    }

    for (const [memoryId, assetIds] of stripped) {
      await this.memoryRepository.removeAssetIds(memoryId, [...assetIds]);
    }
  }

  private themeSearchPort?: ThemeSearchPort;

  /** Overridable seam: the medium test subclasses MemoryService to inject a stub. */
  protected createThemeSearchPort(): ThemeSearchPort {
    return new MemoryThemeSearchAdapter(
      this.machineLearningRepository,
      this.searchRepository,
      () => this.getConfig({ withCache: true }),
      this.logger,
    );
  }

  /**
   * Memoized per-service-instance: the adapter holds the embedding cache, so a theme is encoded
   * once per process rather than once per user per night.
   */
  private getThemeSearchPort(): ThemeSearchPort {
    this.themeSearchPort ??= this.createThemeSearchPort();
    return this.themeSearchPort;
  }

  private getMemoryRules(enabledKeys: Iterable<string>, memories: SystemConfig['memories']): MemoryRule[] {
    return createMemoryRules(enabledKeys, {
      personRepository: this.personRepository,
      assetRepository: this.assetRepository,
      memoryRepository: this.memoryRepository,
      themeSearchPort: this.getThemeSearchPort(),
      memories,
    });
  }

  private async createRuleMemories(ownerId: string, target: DateTime, enabledRuleKeys: Iterable<string>) {
    const existingRuleMemories = await this.memoryRepository.search(ownerId, {
      type: MemoryType.Rule,
      for: target.toJSDate(),
    });
    const remainingSlots = Math.max(0, RULE_DAILY_LIMIT - existingRuleMemories.length);

    if (remainingSlots === 0) {
      return;
    }

    const startOfDay = target.startOf('day');
    const showAt = startOfDay.toJSDate();
    const seenDedupeKeys = new Set<string>();
    // A multi-day (recap) rule may occupy at most one slot per trigger day. Without this, a
    // single recap type that qualifies for several past years could take BOTH daily slots and
    // hold them for its whole 7–10-day window, monthly starving the 1-day rules. 1-day rules
    // are unaffected and may still fill every remaining slot on their own day.
    const insertedMultiDayRuleIds = new Set<string>();
    const evaluatedCandidates = await this.evaluateRuleCandidates(ownerId, target, enabledRuleKeys);
    const candidates = evaluatedCandidates.toSorted((left, right) => right.score - left.score);
    let inserted = 0;

    for (const candidate of candidates) {
      if (inserted >= remainingSlots) {
        break;
      }

      if (seenDedupeKeys.has(candidate.dedupeKey)) {
        continue;
      }

      seenDedupeKeys.add(candidate.dedupeKey);

      const isMultiDay = (candidate.visibleForDays ?? 1) > 1;
      if (isMultiDay && insertedMultiDayRuleIds.has(candidate.ruleId)) {
        continue;
      }

      if (await this.memoryRepository.hasRuleMemory(ownerId, candidate.ruleId, candidate.dedupeKey)) {
        continue;
      }

      const hideAt = startOfDay
        .plus({ days: Math.max(1, candidate.visibleForDays ?? 1) - 1 })
        .endOf('day')
        .toJSDate();

      await this.memoryRepository.create(
        {
          ownerId,
          type: MemoryType.Rule,
          data: {
            ruleId: candidate.ruleId,
            dedupeKey: candidate.dedupeKey,
            title: candidate.title,
            subtitle: candidate.subtitle,
            score: candidate.score,
            context: candidate.context,
          },
          memoryAt: candidate.memoryAt.toJSDate(),
          showAt,
          hideAt,
        },
        new Set(candidate.assetIds),
      );
      // A card that stands in for the day's plain "N years ago" memory replaces it rather than
      // sitting beside it — the two hold substantially the same photos. Safe to run after the
      // insert: the on-this-day loop writes up to DAYS ahead and runs first inside this lock,
      // so that memory already exists, and its cursor only ever moves forward, so it is never
      // recreated afterwards. (Resetting MemoriesState can bring the pair back for a few days;
      // retention clears it.)
      for (const year of candidate.supersedesOnThisDayYears ?? []) {
        await this.memoryRepository.deleteOnThisDay({ ownerId, year, showAt });
      }
      if (isMultiDay) {
        insertedMultiDayRuleIds.add(candidate.ruleId);
      }
      inserted++;
    }
  }

  private async evaluateRuleCandidates(
    ownerId: string,
    target: DateTime,
    enabledRuleKeys: Iterable<string>,
  ): Promise<MemoryRuleCandidate[]> {
    const candidates: MemoryRuleCandidate[] = [];
    const { memories } = await this.getConfig({ withCache: true });

    for (const rule of this.getMemoryRules(enabledRuleKeys, memories)) {
      try {
        candidates.push(...(await rule.evaluate({ ownerId, target })));
      } catch (error) {
        this.logger.error(`Failed to evaluate memory rule ${rule.id} for ${ownerId} on ${target.toISO()}: ${error}`);
      }
    }

    return candidates;
  }

  @OnJob({ name: JobName.MemoryCleanup, queue: QueueName.BackgroundTask })
  async onMemoriesCleanup() {
    const config = await this.getConfig({ withCache: false });
    await this.memoryRepository.cleanup(config.memories.retentionDays);
  }

  async search(auth: AuthDto, dto: MemorySearchDto) {
    const memories = await this.memoryRepository.searchAccessible(auth.user.id, dto);
    const assetIds = memories.flatMap((memory) => memory.assets.map((asset) => asset.id));
    const allowedAssetIds = await this.checkAccess({ auth, permission: Permission.AssetView, ids: assetIds });

    const config = await this.getConfig({ withCache: true });
    const availableTypes = getAdminAvailableMemoryTypeKeys(config.memories);
    const userTypes = getPreferences((await this.userRepository.getMetadata(auth.user.id)) ?? []).memories.types;

    return memories
      .filter((memory) => this.isMemoryTypeVisible(memory, availableTypes, userTypes))
      .map((memory) => ({
        ...memory,
        assets: memory.assets.filter((asset) => allowedAssetIds.has(asset.id)),
      }))
      .filter((memory: Memory) => memory.assets.length > 0)
      .map((memory: Memory) => mapMemory(memory, auth));
  }

  /**
   * A memory is visible unless its type maps to a KNOWN registry key that is currently
   * unavailable (admin) or disabled (user). Saved memories and memories whose type key is
   * unknown/underivable are always shown.
   */
  private isMemoryTypeVisible(
    memory: { type: MemoryType; data: unknown; isSaved: boolean },
    availableTypes: Set<string>,
    userTypes: Record<string, boolean>,
  ): boolean {
    if (memory.isSaved) {
      return true;
    }
    const key = getMemoryTypeKeyForMemory(memory.type, memory.data);
    if (key === undefined || getMemoryTypeMetadata(key) === undefined) {
      return true;
    }
    return availableTypes.has(key) && isMemoryTypeEnabledForUser(userTypes, key);
  }

  statistics(auth: AuthDto, dto: MemorySearchDto) {
    return this.memoryRepository.statisticsAccessible(auth.user.id, dto);
  }

  async get(auth: AuthDto, id: string): Promise<MemoryResponseDto> {
    await this.requireAccess({ auth, permission: Permission.MemoryRead, ids: [id] });
    const memory = await this.findOrFail(id);
    return mapMemory(memory, auth);
  }

  async create(auth: AuthDto, dto: MemoryCreateDto) {
    // TODO validate type/data combination

    const assetIds = dto.assetIds || [];
    const allowedAssetIds = await this.checkAccess({
      auth,
      permission: Permission.AssetShare,
      ids: assetIds,
    });
    const memory = await this.memoryRepository.create(
      {
        ownerId: auth.user.id,
        type: dto.type,
        data: dto.data,
        isSaved: dto.isSaved,
        memoryAt: dto.memoryAt,
        showAt: dto.showAt,
        hideAt: dto.hideAt,
        seenAt: dto.seenAt,
      },
      allowedAssetIds,
    );

    return mapMemory(memory, auth);
  }

  async update(auth: AuthDto, id: string, dto: MemoryUpdateDto): Promise<MemoryResponseDto> {
    await this.requireAccess({ auth, permission: Permission.MemoryUpdate, ids: [id] });

    const memory = await this.memoryRepository.update(id, {
      isSaved: dto.isSaved,
      memoryAt: dto.memoryAt,
      seenAt: dto.seenAt,
    });

    return mapMemory(memory, auth);
  }

  async remove(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.MemoryDelete, ids: [id] });
    await this.memoryRepository.delete(id);
  }

  async addAssets(auth: AuthDto, id: string, dto: BulkIdsDto): Promise<BulkIdResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.MemoryRead, ids: [id] });

    const repos = { access: this.accessRepository, bulk: this.memoryRepository };
    const results = await addAssets(auth, repos, { parentId: id, assetIds: dto.ids });

    const hasSuccess = results.some(({ success }) => success);
    if (hasSuccess) {
      await this.memoryRepository.update(id, { updatedAt: new Date() });
    }

    return results;
  }

  async removeAssets(auth: AuthDto, id: string, dto: BulkIdsDto): Promise<BulkIdResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.MemoryUpdate, ids: [id] });

    const repos = { access: this.accessRepository, bulk: this.memoryRepository };
    const results = await removeAssets(auth, repos, {
      parentId: id,
      assetIds: dto.ids,
      canAlwaysRemove: Permission.MemoryDelete,
    });

    const hasSuccess = results.some(({ success }) => success);
    if (hasSuccess) {
      await this.memoryRepository.update(id, { id, updatedAt: new Date() });
    }

    return results;
  }

  private async findOrFail(id: string) {
    const memory = await this.memoryRepository.get(id);
    if (!memory) {
      throw new BadRequestException('Memory not found');
    }
    return memory;
  }
}
