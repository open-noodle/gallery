import { Injectable } from '@nestjs/common';
import { shuffle } from 'lodash-es';
import { DateTime } from 'luxon';
import type { SystemConfig } from 'src/config';
import { Memory } from 'src/database.js';
import { OnJob } from 'src/decorators.js';
import { BulkIdResponseDto, BulkIdsDto } from 'src/dtos/asset-ids.response.dto.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  MemoryCreateDto,
  MemoryResponseDto,
  MemorySearchDto,
  MemoryUpdateDto,
  mapMemory,
} from 'src/dtos/memory.dto.js';
import { DatabaseLock, JobName, MemoryType, Permission, QueueName, SystemMetadataKey } from 'src/enum.js';
import { type YearMonthDay } from 'src/repositories/asset.repository.js';
import { BaseService } from 'src/services/base.service.js';
import { BirthdayMemoryRule } from 'src/services/memory-rules/birthday.rule.js';
import type { MemoryRule, MemoryRuleCandidate } from 'src/services/memory-rules/memory-rule.interface.js';
import { RecentTripMemoryRule } from 'src/services/memory-rules/recent-trip.rule.js';
import { addAssets, removeAssets } from 'src/utils/asset.util.js';
import { findOrFail } from 'src/utils/misc.js';

const DAYS = 3;
const DAYS_UNTIL_BIRTHDAY = 3;
const BIRTHDAY_MEMORY_ASSETS_PER_YEAR = 5;
const MEMORY_ASSET_LIMIT = 25;
const RULE_DAILY_LIMIT = 2;

@Injectable()
export class MemoryService extends BaseService {
  @OnJob({ name: JobName.MemoryGenerate, queue: QueueName.BackgroundTask })
  async onMemoriesCreate() {
    const users = await this.userRepository.getList({ withDeleted: false });
    const config = await this.getConfig({ withCache: false });

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
          await Promise.all(users.map((owner) => this.createOnThisDayMemories(owner.id, target)));
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
          await Promise.all(users.map((owner) => this.createRuleMemories(owner.id, target, config.memories)));
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

  private async createBirthdayMemories(ownerId: string, target: DateTime) {
    const people = await this.personRepository.forBirthdayMemories(ownerId, target);
    if (people.length === 0) {
      return;
    }

    const showAt = target.minus({ days: DAYS_UNTIL_BIRTHDAY }).startOf('day').toISO();
    const hideAt = target.endOf('day').toISO();

    await Promise.all(
      people.map(async ({ personGroupId, name: personName, birthDate }) => {
        const assets = await this.getBirthdayAssets(ownerId, personGroupId, birthDate, target);
        if (assets.length === 0) {
          return;
        }

        await this.memoryRepository.create(
          {
            ownerId,
            type: MemoryType.Birthday,
            data: { personId: personGroupId, personName, year: birthDate.year },
            memoryAt: target.startOf('day').toISO()!,
            showAt,
            hideAt,
          },
          new Set(assets.map(({ id }) => id)),
        );
      }),
    );
  }

  private async getBirthdayAssets(
    ownerId: string,
    personGroupId: string,
    birthDate: YearMonthDay,
    until: YearMonthDay,
  ) {
    const years = await this.memoryRepository.getPersonBirthdayYears(ownerId, personGroupId, birthDate, until);
    if (years.length === 0) {
      return [];
    }

    let birthdayYears = years;
    let assetsPerYear = Math.min(BIRTHDAY_MEMORY_ASSETS_PER_YEAR, Math.floor(MEMORY_ASSET_LIMIT / years.length));

    // Select random birthdays if there are more than 25 birthdays with assets
    if (years.length > MEMORY_ASSET_LIMIT) {
      birthdayYears = shuffle(years)
        .slice(0, MEMORY_ASSET_LIMIT)
        .sort((a, b) => b - a);
      assetsPerYear = 1;
    }

    const assets = await Promise.all(
      birthdayYears.map((year) =>
        this.memoryRepository.getPersonAssetsByDate(ownerId, personGroupId, { ...birthDate, year }, assetsPerYear),
      ),
    );

    return assets.flat();
  }

  private getMemoryRules(config: SystemConfig['memories']): MemoryRule[] {
    const rules: MemoryRule[] = [];

    if (config.birthday) {
      rules.push(new BirthdayMemoryRule(this.personRepository, this.assetRepository));
    }

    if (config.recentTrips) {
      rules.push(new RecentTripMemoryRule(this.assetRepository, this.memoryRepository));
    }

    return rules;
  }

  private async createRuleMemories(ownerId: string, target: DateTime, config: SystemConfig['memories']) {
    const existingRuleMemories = await this.memoryRepository.search(ownerId, {
      type: MemoryType.Rule,
      for: target.toJSDate(),
    });
    const remainingSlots = Math.max(0, RULE_DAILY_LIMIT - existingRuleMemories.length);

    if (remainingSlots === 0) {
      return;
    }

    const showAt = target.startOf('day').toJSDate();
    const hideAt = target.endOf('day').toJSDate();
    const seenDedupeKeys = new Set<string>();
    const evaluatedCandidates = await this.evaluateRuleCandidates(ownerId, target, config);
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

      if (await this.memoryRepository.hasRuleMemory(ownerId, candidate.ruleId, candidate.dedupeKey)) {
        continue;
      }

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
      inserted++;
    }
  }

  private async evaluateRuleCandidates(
    ownerId: string,
    target: DateTime,
    config: SystemConfig['memories'],
  ): Promise<MemoryRuleCandidate[]> {
    const candidates: MemoryRuleCandidate[] = [];

    for (const rule of this.getMemoryRules(config)) {
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
    const memories = await this.memoryRepository.search(auth.user.id, dto);
    return memories
      .filter((memory: Memory) => memory.assets && memory.assets.length > 0)
      .map((memory: Memory) => mapMemory(memory, auth));
  }

  statistics(auth: AuthDto, dto: MemorySearchDto) {
    return this.memoryRepository.statistics(auth.user.id, dto);
  }

  async get(auth: AuthDto, id: string): Promise<MemoryResponseDto> {
    await this.requireAccess({ auth, permission: Permission.MemoryRead, ids: [id] });
    const memory = await this.findOrFail(id);
    return mapMemory(memory, auth);
  }

  async create(auth: AuthDto, dto: MemoryCreateDto) {
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
