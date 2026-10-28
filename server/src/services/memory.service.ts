import { BadRequestException, Injectable } from '@nestjs/common';
import { shuffle } from 'lodash-es';
import { DateTime } from 'luxon';
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
import {
  getAdminAvailableMemoryTypeKeys,
  isMemoryTypeVisible,
} from 'src/gallery/services/memory-rules/memory-type.metadata.js';
import { getOnThisDayUsers } from 'src/gallery/services/rule-memory.service.js';
import { GallerySyncStreams } from 'src/gallery/utils/gallery-sync.streams.js';
import { type YearMonthDay } from 'src/repositories/asset.repository.js';
import { BaseService } from 'src/services/base.service.js';
import { addAssets, removeAssets } from 'src/utils/asset.util.js';
import { findOrFail } from 'src/utils/misc.js';
import { getPreferences } from 'src/utils/preferences.js';

const DAYS = 3;
const DAYS_UNTIL_BIRTHDAY = 3;
const BIRTHDAY_MEMORY_ASSETS_PER_YEAR = 5;
const MEMORY_ASSET_LIMIT = 25;

@Injectable()
export class MemoryService extends BaseService {
  @OnJob({ name: JobName.MemoryGenerate, queue: QueueName.BackgroundTask })
  async onMemoriesCreate() {
    const users = await this.userRepository.getList({ withDeleted: false });
    // Gallery: on-this-day honours the memory-type toggles; rule memories are their own job (RuleMemoryService).
    const config = await this.getConfig({ withCache: false });
    const onThisDayUsers = getOnThisDayUsers(users, config.memories);

    await this.databaseRepository.withLock(DatabaseLock.MemoryCreation, async () => {
      const state = await this.systemMetadataRepository.get(SystemMetadataKey.MemoriesState);
      const start = DateTime.utc().startOf('day').minus({ days: DAYS });
      const lastOnThisDayDate = state?.lastOnThisDayDate ? DateTime.fromISO(state.lastOnThisDayDate) : start;

      // generate a memory +/- X days from today
      for (let i = 0; i <= DAYS * 2; i++) {
        const target = start.plus({ days: i });
        if (lastOnThisDayDate >= target) {
          continue;
        }

        this.logger.log(`Creating memories for ${target.toISO()}`);
        try {
          await Promise.all(
            users.map((owner) =>
              Promise.all([
                onThisDayUsers.includes(owner) && this.createOnThisDayMemories(owner.id, target),
                this.createBirthdayMemories(owner.id, target),
              ]),
            ),
          );
        } catch (error) {
          this.logger.error(`Failed to create memories for ${target.toISO()}: ${error}`);
        }
        // update system metadata even when there is an error to minimize the chance of duplicates
        await this.systemMetadataRepository.set(SystemMetadataKey.MemoriesState, {
          ...state,
          lastOnThisDayDate: target.toISO(),
        });
      }
    });

    await this.jobRepository.queue({ name: JobName.MemoryRuleGenerate });
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

  @OnJob({ name: JobName.MemoryCleanup, queue: QueueName.BackgroundTask })
  async onMemoriesCleanup() {
    const config = await this.getConfig({ withCache: false });
    await this.memoryRepository.cleanup(config.memories.retentionDays);
  }

  async search(auth: AuthDto, dto: MemorySearchDto) {
    const { hiddenScope, visibleSpaceIds } = await this.resolveViewerScope(auth, 'memories');
    const memories = await this.memoryRepository.searchAccessible(auth.user.id, dto, hiddenScope, visibleSpaceIds);
    const assetIds = memories.flatMap((memory) => memory.assets.map((asset) => asset.id));
    const allowedAssetIds = await this.checkAccess({ auth, permission: Permission.AssetView, ids: assetIds });

    const config = await this.getConfig({ withCache: true });
    const availableTypes = getAdminAvailableMemoryTypeKeys(config.memories);
    const userTypes = getPreferences((await this.userRepository.getMetadata(auth.user.id)) ?? []).memories.types;

    // Gallery: a stock or third-party client gets only the memory types it can decode, as on sync.
    const clientTypes = GallerySyncStreams.syncedMemoryTypes(!auth.stockClient, !auth.legacyGalleryApp);
    return memories
      .filter((memory) => clientTypes.includes(memory.type))
      .filter((memory) => isMemoryTypeVisible(memory, availableTypes, userTypes))
      .map((memory) => ({
        ...memory,
        assets: memory.assets.filter((asset) => allowedAssetIds.has(asset.id)),
      }))
      .filter((memory: Memory) => memory.assets.length > 0)
      .map((memory: Memory) => mapMemory(memory, auth));
  }

  statistics(auth: AuthDto, dto: MemorySearchDto) {
    return this.memoryRepository.statisticsAccessible(
      auth.user.id,
      dto,
      GallerySyncStreams.syncedMemoryTypes(!auth.stockClient, !auth.legacyGalleryApp),
    );
  }

  async get(auth: AuthDto, id: string): Promise<MemoryResponseDto> {
    await this.requireAccess({ auth, permission: Permission.MemoryRead, ids: [id] });
    const memory = await this.findOrFail(auth, id);
    // Gallery: a stock client cannot decode a rule memory. Gallery clients keep reading any type by id.
    if (auth.stockClient && !GallerySyncStreams.syncedMemoryTypes(false, true).includes(memory.type)) {
      throw new BadRequestException('Memory not found');
    }
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
      auth.user.id,
    );

    return mapMemory(memory, auth);
  }

  async update(auth: AuthDto, id: string, dto: MemoryUpdateDto): Promise<MemoryResponseDto> {
    await this.requireAccess({ auth, permission: Permission.MemoryUpdate, ids: [id] });

    const memory = await this.memoryRepository.update(
      id,
      {
        isSaved: dto.isSaved,
        memoryAt: dto.memoryAt,
        seenAt: dto.seenAt,
      },
      auth.user.id,
    );

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

  private async findOrFail(auth: AuthDto, id: string) {
    // #1041 §4: leave the memory's assets hidden from a viewer's own timeline immediately, not just
    // after the next generation pass — see the repository doc comment.
    const { hiddenScope, visibleSpaceIds } = await this.resolveViewerScope(auth, 'memories');
    return findOrFail(() => this.memoryRepository.get(id, auth.user.id, hiddenScope, visibleSpaceIds), 'Memory');
  }
}
