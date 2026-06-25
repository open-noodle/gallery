import { Injectable } from '@nestjs/common';
import { ExpressionBuilder, Insertable, Kysely, sql, Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { Chunked, ChunkedSet, DummyValue, GenerateSql } from 'src/decorators';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { TagAssetTable } from 'src/schema/tables/tag-asset.table';
import { TagTable } from 'src/schema/tables/tag.table';
import { asUuid } from 'src/utils/database';

@Injectable()
export class TagRepository {
  constructor(
    @InjectKysely() private db: Kysely<DB>,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(TagRepository.name);
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  get(id: string) {
    return this.db.selectFrom('tag').select(columns.tag).where('id', '=', id).executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  getByValue(userId: string, value: string) {
    return this.db
      .selectFrom('tag')
      .select(columns.tag)
      .where('userId', '=', userId)
      .where('value', '=', value)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [{ userId: DummyValue.UUID, value: DummyValue.STRING, parentId: DummyValue.UUID }] })
  async upsertValue({ userId, value, parentId: _parentId }: { userId: string; value: string; parentId?: string }) {
    const parentId = _parentId ?? null;
    return this.db.transaction().execute(async (tx) => {
      const tag = await tx
        .insertInto('tag')
        .values({ userId, value, parentId })
        .onConflict((oc) => oc.columns(['userId', 'value']).doUpdateSet({ parentId }))
        .returning(columns.tag)
        .executeTakeFirstOrThrow();

      // update closure table
      await tx
        .insertInto('tag_closure')
        .values({ id_ancestor: tag.id, id_descendant: tag.id })
        .onConflict((oc) => oc.doNothing())
        .execute();

      if (parentId) {
        await tx
          .insertInto('tag_closure')
          .columns(['id_ancestor', 'id_descendant'])
          .expression(
            tx
              .selectFrom('tag_closure')
              .select(['id_ancestor', sql.raw<string>(`'${tag.id}'`).as('id_descendant')])
              .where('id_descendant', '=', parentId),
          )
          .onConflict((oc) => oc.doNothing())
          .execute();
      }

      return tag;
    });
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getAll(userId: string) {
    return this.db
      .selectFrom('tag')
      .select(columns.tag)
      .where((eb) => this.ownedOrSpaceAccessible(eb, userId))
      .orderBy('value')
      .execute();
  }

  // The tag explorer lists tags for assets a user can actually see: their own tags,
  // plus tags on any asset reachable through a shared space they are a member of —
  // either added to the space directly or via a library linked to the space. Mirrors
  // the access rules in AccessRepository/ViewRepository so non-admin space members are
  // not stuck with an empty tag tree (issue #647).
  private ownedOrSpaceAccessible(eb: ExpressionBuilder<DB, 'tag'>, userId: string) {
    return eb.or([
      eb('tag.userId', '=', asUuid(userId)),
      eb.exists(
        eb
          .selectFrom('tag_asset')
          .innerJoin('asset', 'asset.id', 'tag_asset.assetId')
          .innerJoin('shared_space_asset', 'shared_space_asset.assetId', 'asset.id')
          .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_asset.spaceId')
          .whereRef('tag_asset.tagId', '=', 'tag.id')
          .where('asset.deletedAt', 'is', null)
          .where('shared_space_member.userId', '=', asUuid(userId)),
      ),
      eb.exists(
        eb
          .selectFrom('tag_asset')
          .innerJoin('asset', 'asset.id', 'tag_asset.assetId')
          .innerJoin('shared_space_library', 'shared_space_library.libraryId', 'asset.libraryId')
          .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_library.spaceId')
          .whereRef('tag_asset.tagId', '=', 'tag.id')
          .where('asset.deletedAt', 'is', null)
          .where('shared_space_member.userId', '=', asUuid(userId)),
      ),
      eb.exists(
        eb
          .selectFrom('tag_asset')
          .innerJoin('asset', 'asset.id', 'tag_asset.assetId')
          .innerJoin('album_asset', 'album_asset.assetId', 'asset.id')
          .innerJoin('shared_space_album', 'shared_space_album.albumId', 'album_asset.albumId')
          .innerJoin('album', (j) =>
            j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
          )
          .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_album.spaceId')
          .whereRef('tag_asset.tagId', '=', 'tag.id')
          .where('asset.deletedAt', 'is', null)
          .where('shared_space_member.userId', '=', asUuid(userId)),
      ),
    ]);
  }

  @GenerateSql({ params: [{ userId: DummyValue.UUID, color: DummyValue.STRING, value: DummyValue.STRING }] })
  create(tag: Insertable<TagTable>) {
    return this.db.insertInto('tag').values(tag).returningAll().executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID, { color: DummyValue.STRING }] })
  update(id: string, dto: Updateable<TagTable>) {
    return this.db.updateTable('tag').set(dto).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async delete(id: string) {
    await this.db.deleteFrom('tag').where('id', '=', id).execute();
  }

  @ChunkedSet({ paramIndex: 1 })
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async getAssetIds(tagId: string, assetIds: string[]): Promise<Set<string>> {
    if (assetIds.length === 0) {
      return new Set();
    }

    const results = await this.db
      .selectFrom('tag_asset')
      .select(['assetId as assetId'])
      .where('tagId', '=', tagId)
      .where('assetId', 'in', assetIds)
      .execute();

    return new Set(results.map(({ assetId }) => assetId));
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  @Chunked({ paramIndex: 1 })
  async addAssetIds(tagId: string, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    await this.db
      .insertInto('tag_asset')
      .values(assetIds.map((assetId) => ({ tagId, assetId })))
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  @Chunked({ paramIndex: 1 })
  async removeAssetIds(tagId: string, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    await this.db.deleteFrom('tag_asset').where('tagId', '=', tagId).where('assetId', 'in', assetIds).execute();
  }

  @GenerateSql({ params: [[{ assetId: DummyValue.UUID, tagIds: DummyValue.UUID }]] })
  @Chunked()
  upsertAssetIds(items: Insertable<TagAssetTable>[]) {
    if (items.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .insertInto('tag_asset')
      .values(items)
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  @Chunked({ paramIndex: 1 })
  replaceAssetTags(assetId: string, tagIds: string[]) {
    return this.db.transaction().execute(async (tx) => {
      await tx.deleteFrom('tag_asset').where('assetId', '=', assetId).execute();

      if (tagIds.length === 0) {
        return;
      }

      return tx
        .insertInto('tag_asset')
        .values(tagIds.map((tagId) => ({ tagId, assetId })))
        .onConflict((oc) => oc.doNothing())
        .returningAll()
        .execute();
    });
  }

  async deleteEmptyTags() {
    const result = await this.db
      .deleteFrom('tag')
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('tag_closure')
              .whereRef('tag.id', '=', 'tag_closure.id_ancestor')
              .innerJoin('tag_asset', 'tag_closure.id_descendant', 'tag_asset.tagId'),
          ),
        ),
      )
      .executeTakeFirst();

    const deletedRows = Number(result.numDeletedRows);
    if (deletedRows > 0) {
      this.logger.log(`Deleted ${deletedRows} empty tags`);
    }
  }
}
