import { Injectable } from '@nestjs/common';
import {
  type ExpressionBuilder,
  type Insertable,
  type Kysely,
  type OrderByDirection,
  type Updateable,
  sql,
} from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { DateTime } from 'luxon';
import { InjectKysely } from 'nestjs-kysely';
import type { IBulkAsset } from 'src/types.js';
import { Chunked, ChunkedSet, DummyValue, GenerateSql } from 'src/decorators.js';
import { MemorySearchDto } from 'src/dtos/memory.dto.js';
import { AssetFileType, AssetOrderWithRandom, AssetVisibility, MemoryType } from 'src/enum.js';
import { type YearMonthDay } from 'src/repositories/asset.repository.js';
import { DB } from 'src/schema/index.js';
import { MemoryTable } from 'src/schema/tables/memory.table.js';
import { spaceAlbumAssetExists } from 'src/utils/shared-space-album-scope.js';

const asMakeDate = (eb: ExpressionBuilder<DB, 'asset'>, { year, month, day }: YearMonthDay) =>
  eb.fn('make_date', [sql`${year}::int`, sql`${month}::int`, sql`${day}::int`]);

@Injectable()
export class MemoryRepository implements IBulkAsset {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async cleanup(retentionDays: number) {
    await this.db
      .deleteFrom('memory_asset')
      .using('asset')
      .whereRef('memory_asset.assetId', '=', 'asset.id')
      .where('asset.visibility', '!=', AssetVisibility.Timeline)
      .execute();

    if (retentionDays === 0) {
      return [];
    }

    return this.db
      .deleteFrom('memory')
      .where(sql<Date>`coalesce("showAt", "createdAt")`, '<', DateTime.now().minus({ days: retentionDays }).toJSDate())
      .where('isSaved', '=', false)
      .execute();
  }

  searchBuilder(ownerId: string, dto: MemorySearchDto) {
    return this.baseSearchBuilder(dto).where('ownerId', '=', ownerId);
  }

  private baseSearchBuilder(dto: MemorySearchDto) {
    const visibleAt = dto.for ?? DateTime.now().toJSDate();

    return this.db
      .selectFrom('memory')
      .$if(dto.isSaved !== undefined, (qb) => qb.where('isSaved', '=', dto.isSaved!))
      .$if(dto.type !== undefined, (qb) => qb.where('type', '=', dto.type!))
      .where((where) => where.or([where('showAt', 'is', null), where('showAt', '<=', visibleAt)]))
      .$if(dto.for !== undefined, (qb) =>
        qb.where((where) => where.or([where('hideAt', 'is', null), where('hideAt', '>=', dto.for!)])),
      )
      .$if(dto.isUpcoming !== undefined, (qb) => {
        const now = DateTime.now().toJSDate();
        return dto.isUpcoming
          ? qb.where('showAt', '>', now)
          : qb.where((where) => where.or([where('showAt', 'is', null), where('showAt', '<=', now)]));
      })
      .where('deletedAt', dto.isTrashed ? 'is not' : 'is', null);
  }

  private accessibleSearchBuilder(userId: string, dto: MemorySearchDto) {
    return this.baseSearchBuilder(dto).where((eb) =>
      eb.or([
        eb('memory.ownerId', '=', userId),
        eb.exists(
          eb
            .selectFrom('memory_asset')
            .innerJoin('asset', 'asset.id', 'memory_asset.assetId')
            .select('memory_asset.assetId')
            .whereRef('memory_asset.memoriesId', '=', 'memory.id')
            .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
            .where('asset.deletedAt', 'is', null)
            .where((eb) =>
              eb.or([
                eb('asset.ownerId', '=', userId),
                eb.exists(
                  eb
                    .selectFrom('partner')
                    .select('partner.sharedById')
                    .where('partner.sharedWithId', '=', userId)
                    .whereRef('partner.sharedById', '=', 'asset.ownerId'),
                ),
                eb.exists(
                  eb
                    .selectFrom('shared_space_asset')
                    .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_asset.spaceId')
                    .select('shared_space_asset.assetId')
                    .where('shared_space_member.userId', '=', userId)
                    .whereRef('shared_space_asset.assetId', '=', 'asset.id'),
                ),
                eb.exists(
                  eb
                    .selectFrom('shared_space_library')
                    .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_library.spaceId')
                    .select('shared_space_library.libraryId')
                    .where('shared_space_member.userId', '=', userId)
                    .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
                    .where('asset.isOffline', '=', false),
                ),
                spaceAlbumAssetExists(eb, {
                  correlateAssetId: 'asset.id',
                  scope: { memberUserId: userId },
                  requireShowInTimeline: true,
                }),
              ]),
            ),
        ),
      ]),
    );
  }

  @GenerateSql(
    { params: [DummyValue.UUID, {}] },
    { name: 'date filter', params: [DummyValue.UUID, { for: DummyValue.DATE }] },
  )
  statistics(ownerId: string, dto: MemorySearchDto) {
    return this.searchBuilder(ownerId, dto)
      .select((qb) => qb.fn.countAll<number>().as('total'))
      .executeTakeFirstOrThrow();
  }

  statisticsAccessible(userId: string, dto: MemorySearchDto) {
    return this.accessibleSearchBuilder(userId, dto)
      .select((qb) => qb.fn.countAll<number>().as('total'))
      .executeTakeFirstOrThrow();
  }

  @GenerateSql(
    { params: [DummyValue.UUID, {}] },
    { name: 'date filter', params: [DummyValue.UUID, { for: DummyValue.DATE }] },
    { name: 'upcoming filter', params: [DummyValue.UUID, { isUpcoming: true }] },
    { name: 'not upcoming filter', params: [DummyValue.UUID, { isUpcoming: false }] },
  )
  search(ownerId: string, dto: MemorySearchDto) {
    return this.searchBuilder(ownerId, dto)
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('asset')
            .selectAll('asset')
            .innerJoin('memory_asset', 'asset.id', 'memory_asset.assetId')
            .whereRef('memory_asset.memoriesId', '=', 'memory.id')
            .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
            .where('asset.deletedAt', 'is', null)
            .where((eb) =>
              eb.not(
                eb.exists(
                  eb
                    .selectFrom('asset_face')
                    .innerJoin('person', (join) =>
                      join
                        .onRef('person.personGroupId', '=', 'asset_face.personGroupId')
                        .onRef('person.ownerId', '=', 'asset.ownerId'),
                    )
                    .select((eb) => eb.val(1).as('one'))
                    .whereRef('asset_face.assetId', '=', 'asset.id')
                    .where('person.isHidden', '=', true),
                ),
              ),
            )
            .orderBy('asset.localDateTime', 'asc'),
        ).as('assets'),
      )
      .selectAll('memory')
      .$call((qb) => {
        if (dto.order === AssetOrderWithRandom.Random) {
          return qb.orderBy(sql`RANDOM()`);
        }

        const direction = (dto.order?.toLowerCase() || 'desc') as OrderByDirection;
        return qb
          .orderBy('showAt', (ob) => (direction === 'asc' ? ob.asc() : ob.desc()).nullsLast())
          .orderBy('memoryAt', direction);
      })
      .$if(dto.id !== undefined, (qb) => qb.where('id', '=', dto.id!))
      .$if(dto.size !== undefined, (qb) => qb.limit(dto.size!))
      .$if(dto.page !== undefined && dto.size !== undefined, (qb) => qb.offset((dto.page! - 1) * dto.size!))
      .execute();
  }

  private personAssets(ownerId: string, personGroupId: string) {
    return this.db
      .selectFrom('asset')
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where((eb) =>
        eb.exists((qb) =>
          qb
            .selectFrom('asset_face')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.personGroupId', '=', personGroupId)
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true),
        ),
      )
      .where((eb) =>
        eb.exists((qb) =>
          qb
            .selectFrom('asset_file')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      );
  }

  @GenerateSql({
    params: [DummyValue.UUID, DummyValue.UUID, { year: 2000, month: 1, day: 1 }, { year: 2025, month: 1, day: 1 }],
  })
  async getPersonBirthdayYears(
    ownerId: string,
    personGroupId: string,
    birthDate: YearMonthDay,
    until: YearMonthDay,
  ): Promise<number[]> {
    const rows = await this.personAssets(ownerId, personGroupId)
      .where(sql`date_part('month', (asset."localDateTime" at time zone 'UTC')::date)::int`, '=', birthDate.month)
      .where(sql`date_part('day', (asset."localDateTime" at time zone 'UTC')::date)::int`, '=', birthDate.day)
      .where((eb) => eb(sql`(asset."localDateTime" at time zone 'UTC')::date`, '>=', asMakeDate(eb, birthDate)))
      .where((eb) => eb(sql`(asset."localDateTime" at time zone 'UTC')::date`, '<', asMakeDate(eb, until)))
      .select(sql<number>`date_part('year', (asset."localDateTime" at time zone 'UTC')::date)::int`.as('year'))
      .distinct()
      .orderBy(sql`year`, 'desc')
      .execute();

    return rows.map(({ year }) => year);
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, { year: 2000, month: 1, day: 1 }, 5] })
  getPersonAssetsByDate(ownerId: string, personGroupId: string, date: YearMonthDay, limit: number) {
    return this.personAssets(ownerId, personGroupId)
      .select(['asset.id'])
      .where((eb) => eb(sql`(asset."localDateTime" at time zone 'UTC')::date`, '=', asMakeDate(eb, date)))
      .orderBy('asset.localDateTime', 'desc')
      .limit(limit)
      .execute();
  }

  searchAccessible(userId: string, dto: MemorySearchDto) {
    return this.accessibleSearchBuilder(userId, dto)
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('asset')
            .selectAll('asset')
            .innerJoin('memory_asset', 'asset.id', 'memory_asset.assetId')
            .whereRef('memory_asset.memoriesId', '=', 'memory.id')
            .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
            .where('asset.deletedAt', 'is', null)
            .where((eb) =>
              eb.not(
                eb.exists(
                  eb
                    .selectFrom('asset_face')
                    .innerJoin('person', 'person.personGroupId', 'asset_face.personGroupId')
                    .select((eb) => eb.val(1).as('one'))
                    .whereRef('asset_face.assetId', '=', 'asset.id')
                    .where('person.isHidden', '=', true),
                ),
              ),
            )
            .orderBy('asset.localDateTime', 'asc'),
        ).as('assets'),
      )
      .selectAll('memory')
      .$call((qb) =>
        dto.order === AssetOrderWithRandom.Random
          ? qb.orderBy(sql`RANDOM()`)
          : qb.orderBy('memoryAt', (dto.order?.toLowerCase() || 'desc') as OrderByDirection),
      )
      .$if(dto.size !== undefined, (qb) => qb.limit(dto.size!))
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  get(id: string) {
    return this.getByIdBuilder(id).executeTakeFirst();
  }

  async create(memory: Insertable<MemoryTable>, assetIds: Set<string>) {
    const id = await this.db.transaction().execute(async (tx) => {
      const { id } = await tx.insertInto('memory').values(memory).returning('id').executeTakeFirstOrThrow();

      if (assetIds.size > 0) {
        const values = [...assetIds].map((assetId) => ({ memoriesId: id, assetId }));
        await tx.insertInto('memory_asset').values(values).execute();
      }

      return id;
    });

    return this.getByIdBuilder(id).executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID, { ownerId: DummyValue.UUID, isSaved: true }] })
  async update(id: string, memory: Updateable<MemoryTable>) {
    await this.db.updateTable('memory').set(memory).where('id', '=', id).execute();
    return this.getByIdBuilder(id).executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async delete(id: string) {
    await this.db.deleteFrom('memory').where('id', '=', id).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING, DummyValue.STRING] })
  async hasRuleMemory(ownerId: string, ruleId: string, dedupeKey: string) {
    const result = await this.db
      .selectFrom('memory')
      .select('id')
      .where('ownerId', '=', ownerId)
      .where('type', '=', MemoryType.Rule)
      .where(sql<string>`memory.data->>'ruleId'`, '=', ruleId)
      .where(sql<string>`memory.data->>'dedupeKey'`, '=', dedupeKey)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    return !!result;
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  @ChunkedSet({ paramIndex: 1 })
  async getAssetIds(id: string, assetIds: string[]) {
    if (assetIds.length === 0) {
      return new Set<string>();
    }

    const results = await this.db
      .selectFrom('memory_asset')
      .select(['assetId'])
      .where('memoriesId', '=', id)
      .where('assetId', 'in', assetIds)
      .execute();

    return new Set(results.map(({ assetId }) => assetId));
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async addAssetIds(id: string, assetIds: string[]) {
    if (assetIds.length === 0) {
      return;
    }

    await this.db
      .insertInto('memory_asset')
      .values(assetIds.map((assetId) => ({ memoriesId: id, assetId })))
      .execute();
  }

  @Chunked({ paramIndex: 1 })
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async removeAssetIds(id: string, assetIds: string[]) {
    if (assetIds.length === 0) {
      return;
    }

    await this.db.deleteFrom('memory_asset').where('memoriesId', '=', id).where('assetId', 'in', assetIds).execute();
  }

  private getByIdBuilder(id: string) {
    return this.db
      .selectFrom('memory')
      .selectAll('memory')
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('asset')
            .selectAll('asset')
            .innerJoin('memory_asset', 'asset.id', 'memory_asset.assetId')
            .whereRef('memory_asset.memoriesId', '=', 'memory.id')
            .orderBy('asset.localDateTime', 'asc')
            .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
            .where('asset.deletedAt', 'is', null),
        ).as('assets'),
      )
      .where('id', '=', id)
      .where('deletedAt', 'is', null);
  }
}
