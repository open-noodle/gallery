import { Injectable } from '@nestjs/common';
import { ExpressionBuilder, Insertable, Kysely, Selectable, ShallowDehydrateObject, sql, Updateable } from 'kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import _ from 'lodash';
import { InjectKysely } from 'nestjs-kysely';
import { Album, columns } from 'src/database';
import { ChunkedArray, DummyValue, GenerateSql } from 'src/decorators';
import { AlbumUserRole, SharedLinkType } from 'src/enum';
import { DB } from 'src/schema';
import { AssetExifTable } from 'src/schema/tables/asset-exif.table';
import { AssetTable } from 'src/schema/tables/asset.table';
import { SharedLinkTable } from 'src/schema/tables/shared-link.table';
import { asBaseEb, sharedLinkAssetIsServable, sharedLinkCreatorCanPublish } from 'src/utils/shared-link-space-tether';
import { spaceVisibilityGate } from 'src/utils/shared-space-album-scope';

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

const withAlbumOwner = (eb: ExpressionBuilder<DB, 'album'>) => {
  return eb
    .selectFrom('user')
    .select(columns.user)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('album_user')
          .where('album_user.role', '=', sql.lit(AlbumUserRole.Owner))
          .whereRef('album_user.albumId', '=', 'album.id')
          .whereRef('album_user.userId', '=', 'user.id'),
      ),
    )
    .where('user.deletedAt', 'is', null)
    .as('owner');
};

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
      .selectAll('shared_link')
      .select((eb) =>
        jsonArrayFrom(
          withSharedAssets(eb)
            .innerJoinLateral(withExifInfo, (join) => join.onTrue())
            .select((eb) => eb.fn.toJson('exifInfo').as('exifInfo')),
        ).as('assets'),
      )
      .leftJoinLateral(
        (eb) =>
          withSharedLinkAlbum(eb)
            // #1018: album contents = the album's own rows ∪ the cross-owner contributions (#764)
            // made to the space this link was created from. LATERAL so the contributed arm can
            // correlate to `shared_link.spaceId`; a link with no space matches no contribution and
            // this collapses back to the pre-#1018 `album_asset` join. UNION (not ALL) dedupes an
            // asset that is both an album row and a retained contribution.
            .leftJoinLateral(
              (eb) =>
                eb
                  .selectFrom('album_asset')
                  .select('album_asset.assetId as assetId')
                  .whereRef('album_asset.albumId', '=', 'album.id')
                  .union(
                    eb
                      .selectFrom('album_space_asset')
                      .innerJoin('shared_space_album', (join) =>
                        join
                          .onRef('shared_space_album.albumId', '=', 'album_space_asset.albumId')
                          .onRef('shared_space_album.spaceId', '=', 'album_space_asset.spaceId'),
                      )
                      // The contributed arm returns another member's asset, so it carries the space
                      // visibility gate: archive + timeline only, never hidden or locked. The album's
                      // own rows above keep plain album semantics and are deliberately not gated.
                      .innerJoin('asset', 'asset.id', 'album_space_asset.assetId')
                      .where((eb) => spaceVisibilityGate(eb))
                      .select('album_space_asset.assetId as assetId')
                      .whereRef('album_space_asset.albumId', '=', 'album.id')
                      .whereRef('album_space_asset.spaceId', '=', 'shared_link.spaceId')
                      .where((eb) => sharedLinkCreatorCanPublish(asBaseEb(eb))),
                  )
                  .as('album_members'),
              (join) => join.onTrue(),
            )
            .leftJoinLateral(
              (eb) =>
                eb
                  .selectFrom('asset')
                  .selectAll('asset')
                  .whereRef('album_members.assetId', '=', 'asset.id')
                  .where('asset.deletedAt', 'is', null)
                  .innerJoinLateral(withExifInfo, (join) => join.onTrue())
                  .select((eb) => eb.fn.toJson(eb.table('exifInfo')).as('exifInfo'))
                  .orderBy('asset.fileCreatedAt', 'asc')
                  .as('assets'),
              (join) => join.onTrue(),
            )
            .innerJoinLateral(withAlbumOwner, (join) => join.onTrue())
            .select((eb) =>
              eb.fn
                .coalesce(
                  eb.fn
                    .jsonAgg('assets')
                    .orderBy('assets.fileCreatedAt', 'asc')
                    .filterWhere('assets.id', 'is not', null),

                  sql`'[]'`,
                )
                .as('assets'),
            )
            .select((eb) => eb.fn.toJson('owner').as('owner'))
            .groupBy(['album.id', sql`"owner".*`])
            .as('album'),
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
      .selectAll('shared_link')
      .select((eb) => jsonArrayFrom(withSharedAssets(eb).limit(1)).as('assets'))
      .where('shared_link.userId', '=', userId)
      .leftJoinLateral(
        (eb) =>
          withSharedLinkAlbum(eb)
            .innerJoinLateral(withAlbumOwner, (join) => join.onTrue())
            .select((eb) => eb.fn.toJson('owner').as('owner'))
            .as('album'),
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
      .where('album.deletedAt', 'is', null)
      .select((eb) => [
        'shared_link.id',
        'shared_link.userId',
        'shared_link.albumId',
        'shared_link.spaceId',
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

  async create(entity: Insertable<SharedLinkTable> & { assetIds?: string[] }) {
    const { id } = await this.db
      .insertInto('shared_link')
      .values(_.omit(entity, 'assetIds'))
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

  async update(entity: Updateable<SharedLinkTable> & { id: string; assetIds?: string[] }) {
    const { id } = await this.db
      .updateTable('shared_link')
      .set(_.omit(entity, 'assets', 'album', 'assetIds'))
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
