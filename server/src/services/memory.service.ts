import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { Memory } from 'src/database';
import { OnJob } from 'src/decorators';
import { BulkIdResponseDto, BulkIdsDto } from 'src/dtos/asset-ids.response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { SystemConfig } from 'src/dtos/config.dto';
import { MemoryCreateDto, MemoryResponseDto, MemorySearchDto, MemoryUpdateDto, mapMemory } from 'src/dtos/memory.dto';
import { DatabaseLock, JobName, MemoryType, Permission, QueueName, SystemMetadataKey } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { MemoryRule, MemoryRuleCandidate } from 'src/services/memory-rules/memory-rule.interface';
import {
  getAdminAvailableMemoryTypeKeys,
  getMemoryTypeKeyForMemory,
  getMemoryTypeMetadata,
  isMemoryTypeEnabledForUser,
} from 'src/services/memory-rules/memory-type.metadata';
import { createMemoryRules } from 'src/services/memory-rules/memory-type.registry';
import { MemoryThemeSearchAdapter } from 'src/services/memory-rules/theme-search.adapter';
import { ThemeSearchPort } from 'src/services/memory-rules/theme-search.port';
import { addAssets, removeAssets } from 'src/utils/asset.util';
import { findOrFail } from 'src/utils/misc';
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
      permission: Permission.AssetUpdate,
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
    const results = await addAssets(auth, repos, {
      parentId: id,
      assetIds: dto.ids,
      permission: Permission.AssetUpdate,
    });

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

  private findOrFail(id: string) {
    return findOrFail(() => this.memoryRepository.get(id), 'Memory');
  }
}
