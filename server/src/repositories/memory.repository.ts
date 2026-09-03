import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, OrderByDirection, sql, Updateable } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { DateTime } from 'luxon';
import { InjectKysely } from 'nestjs-kysely';
import { Chunked, ChunkedSet, DummyValue, GenerateSql } from 'src/decorators';
import { MemorySearchDto } from 'src/dtos/memory.dto';
import { AssetOrderWithRandom, AssetVisibility, MemoryType } from 'src/enum';
import { DB } from 'src/schema';
import { MemoryTable } from 'src/schema/tables/memory.table';
import { IBulkAsset } from 'src/types';
import { spaceAlbumAssetExists } from 'src/utils/shared-space-album-scope';

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
                    .innerJoin('person', 'person.id', 'asset_face.personId')
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

  /**
   * Memories of one owner whose visible window overlaps `window`, with the asset ids they
   * actually render. The asset filters MUST stay identical to `search` — floors are measured
   * over what the card shows, and an asset carrying a hidden person's face is not shown.
   */
  @GenerateSql({ params: [DummyValue.UUID, { from: DummyValue.DATE, to: DummyValue.DATE }] })
  getForOverlapReconcile(ownerId: string, window: { from: Date; to: Date }) {
    return this.db
      .selectFrom('memory')
      .select(['memory.id', 'memory.type', 'memory.data', 'memory.isSaved', 'memory.showAt', 'memory.hideAt'])
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('asset')
            .select(['asset.id'])
            .innerJoin('memory_asset', 'asset.id', 'memory_asset.assetId')
            .whereRef('memory_asset.memoriesId', '=', 'memory.id')
            .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
            .where('asset.deletedAt', 'is', null)
            .where((eb) =>
              eb.not(
                eb.exists(
                  eb
                    .selectFrom('asset_face')
                    .innerJoin('person', 'person.id', 'asset_face.personId')
                    .select((eb) => eb.val(1).as('one'))
                    .whereRef('asset_face.assetId', '=', 'asset.id')
                    .where('person.isHidden', '=', true),
                ),
              ),
            )
            .orderBy('asset.localDateTime', 'asc'),
        ).as('assets'),
      )
      .where('memory.ownerId', '=', ownerId)
      .where('memory.deletedAt', 'is', null)
      .where((eb) => eb.or([eb('memory.showAt', 'is', null), eb('memory.showAt', '<=', window.to)]))
      .where((eb) => eb.or([eb('memory.hideAt', 'is', null), eb('memory.hideAt', '>=', window.from)]))
      .orderBy('memory.id')
      .execute();
  }

  /**
   * Earliest day any memory becomes visible, across all owners — the start of the one-off
   * overlap backfill. `coalesce` mirrors `cleanup`, so a memory with no `showAt` still counts.
   */
  @GenerateSql()
  async getOldestMemoryDate(): Promise<Date | null> {
    const row = await this.db
      .selectFrom('memory')
      .select(sql<Date | null>`min(coalesce("showAt", "createdAt"))`.as('oldest'))
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    return row?.oldest ?? null;
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
                    .innerJoin('person', 'person.id', 'asset_face.personId')
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

  /**
   * Remove the plain `on_this_day` memory a rule memory has just superseded. Scoped to one
   * owner, one trigger day and one year, and never touches a saved memory.
   *
   * Written as an unconditional DELETE ... WHERE rather than a read-then-delete: when the
   * owner has `on_this_day` disabled, or retention already removed the row, there is simply
   * nothing to match. That keeps correctness independent of whether the on-this-day loop has
   * run for the day — it only decides whether this has any effect. (In practice it always
   * has: the on-this-day loop writes up to 3 days ahead and runs first inside the same lock,
   * so the row exists before any rule for that day is evaluated.)
   */
  @GenerateSql({ params: [{ ownerId: DummyValue.UUID, year: DummyValue.NUMBER, showAt: DummyValue.DATE }] })
  async deleteOnThisDay({ ownerId, year, showAt }: { ownerId: string; year: number; showAt: Date }) {
    await this.db
      .deleteFrom('memory')
      .where('ownerId', '=', ownerId)
      .where('type', '=', MemoryType.OnThisDay)
      .where('isSaved', '=', false)
      .where('showAt', '=', showAt)
      .where(sql<string>`memory.data->>'year'`, '=', String(year))
      .execute();
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
