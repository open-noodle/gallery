import { Injectable } from '@nestjs/common';
import {
  type ExpressionBuilder,
  type Insertable,
  type Kysely,
  type Selectable,
  type ShallowDehydrateObject,
  type Updateable,
  sql,
} from 'kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { omit } from 'lodash-es';
import { InjectKysely } from 'nestjs-kysely';
import { Album, columns } from 'src/database.js';
import { ChunkedArray, DummyValue, GenerateSql } from 'src/decorators.js';
import { AlbumUserRole, SharedLinkType } from 'src/enum.js';
import { projectedDuration } from 'src/gallery/utils/projected-duration.js';
import { DB } from 'src/schema/index.js';
import { AssetExifTable } from 'src/schema/tables/asset-exif.table.js';
import { AssetTable } from 'src/schema/tables/asset.table.js';
import { SharedLinkTable } from 'src/schema/tables/shared-link.table.js';
import { dummy } from 'src/utils/database.js';
import { asBaseEb, sharedLinkAssetIsServable } from 'src/utils/shared-link-space-tether.js';

export type SharedLinkSearchOptions = {
  userId: string;
  id?: string;
  albumId?: string;
};

const withSharedAssets = (eb: ExpressionBuilder<DB, 'shared_link'>) => {
  return (
    eb
      .selectFrom('shared_link_asset')
      .whereRef('shared_link.id', '=', 'shared_link_asset.sharedLinkId')
      .innerJoin('asset', 'asset.id', 'shared_link_asset.assetId')
      .where('asset.deletedAt', 'is', null)
      // #1018: the payload must list exactly what the access gate serves, or the visitor's grid
      // renders holes. Assets the creator does not own are tethered to the link's space, so one
      // withdrawn contribution drops out of both at the same moment.
      .where((eb) => sharedLinkAssetIsServable(asBaseEb(eb)))
      .selectAll('asset')
      .select(projectedDuration)
      .orderBy('asset.fileCreatedAt', 'asc')
  );
};

export const withExifInfo = (eb: ExpressionBuilder<DB, 'asset'>) => {
  return eb
    .selectFrom('asset_exif')
    .select(columns.exif)
    .whereRef('asset_exif.assetId', '=', 'asset.id')
    .as('exifInfo');
};

const withAlbumOwner = (eb: ExpressionBuilder<DB, 'album'>) =>
  jsonArrayFrom(
    eb
      .selectFrom('album_user')
      .innerJoin('user', 'user.id', 'album_user.userId')
      .where('album_user.role', '=', sql.lit(AlbumUserRole.Owner))
      .whereRef('album_user.albumId', '=', 'album.id')
      .select('album_user.role')
      .select((eb) => jsonObjectFrom(eb.selectFrom(dummy).select(columns.user)).$notNull().as('user')),
  )
    .$notNull()
    .as('albumUsers');

const withSharedLinkAlbum = (eb: ExpressionBuilder<DB, 'shared_link'>) => {
  return eb
    .selectFrom('album')
    .selectAll('album')
    .whereRef('album.id', '=', 'shared_link.albumId')
    .where('album.deletedAt', 'is', null);
};

@Injectable()
export class SharedLinkRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  get(userId: string, id: string) {
    return this.db
      .selectFrom('shared_link')
      .leftJoin('shared_link_space', 'shared_link_space.sharedLinkId', 'shared_link.id')
      .selectAll('shared_link')
      .select((eb) =>
        jsonArrayFrom(
          withSharedAssets(eb)
            .innerJoinLateral(withExifInfo, (join) => join.onTrue())
            .select((eb) => eb.fn.toJson('exifInfo').as('exifInfo')),
        ).as('assets'),
      )
      .leftJoinLateral(
        (eb) => withSharedLinkAlbum(eb).select(withAlbumOwner).as('album'),
        (join) => join.onTrue(),
      )
      .select((eb) => eb.fn.toJson(eb.table('album')).$castTo<ShallowDehydrateObject<Album> | null>().as('album'))
      .where('shared_link.id', '=', id)
      .where('shared_link.userId', '=', userId)
      .where((eb) => eb.or([eb('shared_link.type', '=', SharedLinkType.Individual), eb('album.id', 'is not', null)]))
      .orderBy('shared_link.createdAt', 'desc')
      .executeTakeFirst();
  }

  @GenerateSql({ params: [{ userId: DummyValue.UUID, albumId: DummyValue.UUID }] })
  getAll({ userId, id, albumId }: SharedLinkSearchOptions) {
    return this.db
      .selectFrom('shared_link')
      .leftJoin('shared_link_space', 'shared_link_space.sharedLinkId', 'shared_link.id')
      .selectAll('shared_link')
      .select((eb) => jsonArrayFrom(withSharedAssets(eb).limit(1)).as('assets'))
      .where('shared_link.userId', '=', userId)
      .leftJoinLateral(
        (eb) => withSharedLinkAlbum(eb).select(withAlbumOwner).as('album'),
        (join) => join.onTrue(),
      )
      .select((eb) => eb.fn.toJson('album').$castTo<ShallowDehydrateObject<Album> | null>().as('album'))
      .where((eb) => eb.or([eb('shared_link.type', '=', SharedLinkType.Individual), eb('album.id', 'is not', null)]))
      .$if(!!albumId, (eb) => eb.where('shared_link.albumId', '=', albumId!))
      .$if(!!id, (eb) => eb.where('shared_link.id', '=', id!))
      .orderBy('shared_link.createdAt', 'desc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.BUFFER] })
  getByKey(key: Buffer) {
    return this.authBuilder().where('shared_link.key', '=', key).executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.BUFFER] })
  getBySlug(slug: string) {
    return this.authBuilder().where('shared_link.slug', '=', slug).executeTakeFirst();
  }

  private authBuilder() {
    return this.db
      .selectFrom('shared_link')
      .leftJoin('album', 'album.id', 'shared_link.albumId')
      .leftJoin('shared_link_space', 'shared_link_space.sharedLinkId', 'shared_link.id')
      .where('album.deletedAt', 'is', null)
      .select((eb) => [
        'shared_link.id',
        'shared_link.userId',
        'shared_link.albumId',
        'shared_link_space.spaceId',
        'shared_link.expiresAt',
        'shared_link.showExif',
        'shared_link.allowUpload',
        'shared_link.allowDownload',
        'shared_link.password',
        jsonObjectFrom(
          eb.selectFrom('user').select(columns.authUser).whereRef('user.id', '=', 'shared_link.userId'),
        ).as('user'),
      ])
      .where((eb) => eb.or([eb('shared_link.type', '=', SharedLinkType.Individual), eb('album.id', 'is not', null)]));
  }

  async create(entity: Insertable<SharedLinkTable> & { assetIds?: string[]; spaceId?: string | null }) {
    // gallery-fork: one transaction, so a failed shared_link_space write cannot leave a space link behind
    // that serves only the creator's assets.
    const { id } = await this.db.transaction().execute(async (trx) => {
      const link = await trx
        .insertInto('shared_link')
        .values(omit(entity, 'assetIds', 'spaceId'))
        .returningAll()
        .executeTakeFirstOrThrow();

      if (entity.spaceId) {
        await trx.insertInto('shared_link_space').values({ sharedLinkId: link.id, spaceId: entity.spaceId }).execute();
      }

      if (entity.assetIds && entity.assetIds.length > 0) {
        await trx
          .insertInto('shared_link_asset')
          .values(entity.assetIds!.map((assetId) => ({ assetId, sharedLinkId: link.id })))
          .execute();
      }

      return link;
    });

    return this.getSharedLinks(id);
  }

  async update(entity: Updateable<SharedLinkTable> & { id: string; assetIds?: string[] }) {
    const { id } = await this.db
      .updateTable('shared_link')
      .set(omit(entity, 'assets', 'album', 'assetIds'))
      .where('shared_link.id', '=', entity.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    if (entity.assetIds && entity.assetIds.length > 0) {
      await this.db
        .insertInto('shared_link_asset')
        .values(entity.assetIds!.map((assetId) => ({ assetId, sharedLinkId: id })))
        .execute();
    }

    return this.getSharedLinks(id);
  }

  async remove(id: string): Promise<void> {
    await this.db.deleteFrom('shared_link').where('shared_link.id', '=', id).execute();
  }

  @ChunkedArray({ paramIndex: 1 })
  async addAssets(id: string, assetIds: string[]) {
    if (assetIds.length === 0) {
      return [];
    }

    return await this.db
      .insertInto('shared_link_asset')
      .values(assetIds.map((assetId) => ({ assetId, sharedLinkId: id })))
      .onConflict((oc) => oc.doNothing())
      .returning(['shared_link_asset.assetId'])
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  private getSharedLinks(id: string) {
    return this.db
      .selectFrom('shared_link')
      .selectAll('shared_link')
      .where('shared_link.id', '=', id)
      .leftJoin('shared_link_asset', 'shared_link_asset.sharedLinkId', 'shared_link.id')
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('asset')
            .whereRef('asset.id', '=', 'shared_link_asset.assetId')
            .selectAll('asset')
            .select(projectedDuration)
            .innerJoinLateral(withExifInfo, (join) => join.onTrue())
            .as('assets'),
        (join) => join.onTrue(),
      )
      .select((eb) =>
        eb.fn
          .coalesce(eb.fn.jsonAgg('assets').filterWhere('assets.id', 'is not', null), sql`'[]'`)
          .$castTo<
            (ShallowDehydrateObject<Selectable<AssetTable>> & {
              exifInfo: ShallowDehydrateObject<Selectable<AssetExifTable>>;
            })[]
          >()
          .as('assets'),
      )
      .groupBy('shared_link.id')
      .executeTakeFirstOrThrow();
  }
}
