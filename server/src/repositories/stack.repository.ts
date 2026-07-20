import { Injectable } from '@nestjs/common';
import { ExpressionBuilder, Insertable, Kysely, Updateable } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AssetVisibility } from 'src/enum';
import { DB } from 'src/schema';
import { StackTable } from 'src/schema/tables/stack.table';
import { asUuid, withDefaultVisibility } from 'src/utils/database';
import { favoriteExistsFor } from 'src/utils/favorite';

export interface StackSearch {
  ownerId: string;
  primaryAssetId?: string;
}

// #763: authUserId is the CALLER's id, threaded from stack.service.ts (search/create/update/
// getById are all owner-only — see AccessRepository's StackAccess.checkOwnerAccess — so the
// caller and the stack's ownerId are always the same user; still passed explicitly rather than
// read off the entity, per the slice 1 caller-id convention). Optional and only used to project
// `isFavoriteForUser` onto each stack asset for mapAsset (via stack.dto.ts's mapStack).
const withAssets = (eb: ExpressionBuilder<DB, 'stack'>, withTags = false, authUserId?: string) => {
  return jsonArrayFrom(
    eb
      .selectFrom('asset')
      .selectAll('asset')
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('asset_exif')
            .select(columns.exif)
            .whereRef('asset_exif.assetId', '=', 'asset.id')
            .as('exifInfo'),
        (join) => join.onTrue(),
      )
      .$if(withTags, (eb) =>
        eb.select((eb) =>
          jsonArrayFrom(
            eb
              .selectFrom('tag')
              .select(columns.tag)
              .innerJoin('tag_asset', 'tag.id', 'tag_asset.tagId')
              .whereRef('tag_asset.assetId', '=', 'asset.id'),
          ).as('tags'),
        ),
      )
      .select((eb) => eb.fn.toJson('exifInfo').as('exifInfo'))
      // #763: the `eb` here is scoped to `DB & { exifInfo: ... }` (the innerJoinLateral above),
      // which Kysely's ExpressionBuilder generics don't consider assignable to the plain
      // `ExpressionBuilder<DB, keyof DB>` favoriteExistsFor expects, even though the
      // 'asset_favorite' table it queries is unaffected by the extra lateral join in scope. Safe
      // cast (same mechanism as asset.repository.ts's getTimeBucket).
      .$if(!!authUserId, (qb) =>
        qb.select((eb) =>
          favoriteExistsFor(eb as unknown as ExpressionBuilder<DB, keyof DB>, authUserId!).as('isFavoriteForUser'),
        ),
      )
      .where('asset.deletedAt', 'is', null)
      .whereRef('asset.stackId', '=', 'stack.id')
      .$call(withDefaultVisibility),
  ).as('assets');
};

@Injectable()
export class StackRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql(
    { params: [{ ownerId: DummyValue.UUID }] },
    { name: 'with authUserId', params: [{ ownerId: DummyValue.UUID }, DummyValue.UUID] },
  )
  search(query: StackSearch, authUserId?: string) {
    return this.db
      .selectFrom('stack')
      .selectAll('stack')
      .select((eb) => withAssets(eb, false, authUserId))
      .where('stack.ownerId', '=', query.ownerId)
      .$if(!!query.primaryAssetId, (eb) => eb.where('stack.primaryAssetId', '=', query.primaryAssetId!))
      .execute();
  }

  async create(entity: Omit<Insertable<StackTable>, 'primaryAssetId'>, assetIds: string[], authUserId?: string) {
    return this.db.transaction().execute(async (tx) => {
      const stacks = await tx
        .selectFrom('stack')
        .where('stack.ownerId', '=', entity.ownerId)
        .where('stack.primaryAssetId', 'in', assetIds)
        .select('stack.id')
        .select((eb) =>
          jsonArrayFrom(
            eb
              .selectFrom('asset')
              .select('asset.id')
              .whereRef('asset.stackId', '=', 'stack.id')
              .where('asset.deletedAt', 'is', null),
          ).as('assets'),
        )
        .execute();

      const uniqueIds = new Set<string>(assetIds);

      // children
      for (const stack of stacks) {
        if (stack.assets && stack.assets.length > 0) {
          for (const asset of stack.assets) {
            uniqueIds.add(asset.id);
          }
        }
      }

      if (stacks.length > 0) {
        await tx
          .deleteFrom('stack')
          .where(
            'id',
            'in',
            stacks.map((stack) => stack.id),
          )
          .execute();
      }

      const newRecord = await tx
        .insertInto('stack')
        .values({ ...entity, primaryAssetId: assetIds[0] })
        .returning('id')
        .executeTakeFirstOrThrow();

      await tx
        .updateTable('asset')
        .set({
          stackId: newRecord.id,
          updatedAt: new Date(),
        })
        .where('id', 'in', [...uniqueIds])
        .execute();

      return tx
        .selectFrom('stack')
        .selectAll('stack')
        .select((eb) => withAssets(eb, false, authUserId))
        .where('id', '=', newRecord.id)
        .executeTakeFirstOrThrow();
    });
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('stack').where('id', '=', asUuid(id)).execute();
  }

  async deleteAll(ids: string[]): Promise<void> {
    await this.db.deleteFrom('stack').where('id', 'in', ids).execute();
  }

  update(id: string, entity: Updateable<StackTable>, authUserId?: string) {
    return this.db
      .updateTable('stack')
      .set(entity)
      .where('id', '=', asUuid(id))
      .returningAll('stack')
      .returning((eb) => withAssets(eb, true, authUserId))
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] }, { name: 'with authUserId', params: [DummyValue.UUID, DummyValue.UUID] })
  getById(id: string, authUserId?: string) {
    return this.db
      .selectFrom('stack')
      .selectAll()
      .select((eb) => withAssets(eb, true, authUserId))
      .where('id', '=', asUuid(id))
      .executeTakeFirst();
  }

  /**
   * Expand a set of asset ids to include every other (non-deleted) asset that
   * shares a stack with any of them. Assets with no stack map to themselves.
   * Used to keep shared-space membership stack-atomic: adding/removing any
   * member of a stack must add/remove the whole stack, otherwise a stack child
   * can end up contributed to a space while its collapse-primary is not — the
   * asset then counts toward the space but never renders in the (stack-collapsed)
   * timeline. See discussion #751.
   */
  async getStackedAssetIds(assetIds: string[], visibilities?: AssetVisibility[]): Promise<string[]> {
    if (assetIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .selectFrom('asset')
      .select('asset.id')
      .where('asset.deletedAt', 'is', null)
      .$if(!!visibilities && visibilities.length > 0, (qb) => qb.where('asset.visibility', 'in', visibilities!))
      .where((eb) =>
        eb.or([
          eb('asset.id', 'in', assetIds),
          eb(
            'asset.stackId',
            'in',
            eb
              .selectFrom('asset as seed')
              .select('seed.stackId')
              .where('seed.id', 'in', assetIds)
              .where('seed.stackId', 'is not', null),
          ),
        ]),
      )
      .execute();

    return rows.map((row) => row.id);
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getForAssetRemoval(assetId: string) {
    return this.db
      .selectFrom('asset')
      .leftJoin('stack', 'stack.id', 'asset.stackId')
      .select(['stackId as id', 'stack.primaryAssetId'])
      .where('asset.id', '=', assetId)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [{ sourceId: DummyValue.UUID, targetId: DummyValue.UUID }] })
  merge({ sourceId, targetId }: { sourceId: string; targetId: string }) {
    return this.db.updateTable('asset').set({ stackId: targetId }).where('asset.stackId', '=', sourceId).execute();
  }
}
