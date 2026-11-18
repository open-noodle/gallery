import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetFileType, AssetType, AssetVisibility } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { AssetSpatialSceneTable } from 'src/schema/tables/asset-spatial-scene.table.js';
import { asUuid } from 'src/utils/database.js';

// Spatial Scene depth maps (specs/2026-10-29-spatial-scene-design.md).
@Injectable()
export class SpatialSceneRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /**
  What the depth job needs: the preview the viewer shows (the edited one once the photo is edited, so the map lines
  up with the crop and rotation) and what decides whether the photo is processed at all.
  */
  @GenerateSql({ params: [DummyValue.UUID] })
  getForJob(id: string) {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select((eb) => [
        'asset.id',
        'asset.ownerId',
        'asset.type',
        'asset.visibility',
        'asset.originalPath',
        'asset_exif.projectionType',
        eb
          .selectFrom('asset_file')
          .select('asset_file.path')
          .whereRef('asset_file.assetId', '=', 'asset.id')
          .where('asset_file.type', '=', sql.lit(AssetFileType.Preview))
          .whereRef('asset_file.isEdited', '=', 'asset.isEdited')
          .limit(1)
          .as('previewPath'),
      ])
      .where('asset.id', '=', asUuid(id))
      .where('asset.deletedAt', 'is', null)
      .executeTakeFirst();
  }

  /** Photos without a depth map, or every photo with `force`. Panoramas are skipped by the job itself. */
  @GenerateSql({ params: [], stream: true })
  streamForQueue(force?: boolean) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id'])
      .$if(!force, (qb) =>
        qb.where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('asset_spatial_scene')
                .select('asset_spatial_scene.assetId')
                .whereRef('asset_spatial_scene.assetId', '=', 'asset.id'),
            ),
          ),
        ),
      )
      .where('asset.type', '=', sql.lit(AssetType.Image))
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', '!=', sql.lit(AssetVisibility.Hidden))
      .stream();
  }

  /** The photo's depth map, with the per-photo choice (`offered`, null for the automatic one). */
  @GenerateSql({ params: [DummyValue.UUID] })
  get(assetId: string) {
    return this.db
      .selectFrom('asset_spatial_scene')
      .leftJoin('asset_spatial_scene_offer', 'asset_spatial_scene_offer.assetId', 'asset_spatial_scene.assetId')
      .select([
        'asset_spatial_scene.path',
        'asset_spatial_scene.width',
        'asset_spatial_scene.height',
        'asset_spatial_scene.boundarySharpness',
        'asset_spatial_scene.edgeDensity',
        'asset_spatial_scene.foregroundRatio',
        'asset_spatial_scene.focus',
        'asset_spatial_scene.modelName',
        'asset_spatial_scene.createdAt',
        'asset_spatial_scene_offer.offered',
      ])
      .where('asset_spatial_scene.assetId', '=', asUuid(assetId))
      .executeTakeFirst();
  }

  /** The per-photo choice alone, which may be made before the photo has a depth map. */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getOffer(assetId: string): Promise<boolean | null> {
    const row = await this.db
      .selectFrom('asset_spatial_scene_offer')
      .select('offered')
      .where('assetId', '=', asUuid(assetId))
      .executeTakeFirst();
    return row?.offered ?? null;
  }

  /** Records a per-photo choice; null removes it, so the automatic choice applies again. */
  async setOffer(assetId: string, offered: boolean | null): Promise<void> {
    if (offered === null) {
      await this.db.deleteFrom('asset_spatial_scene_offer').where('assetId', '=', asUuid(assetId)).execute();
      return;
    }
    await this.db
      .insertInto('asset_spatial_scene_offer')
      .values({ assetId, offered })
      .onConflict((oc) => oc.column('assetId').doUpdateSet({ offered }))
      .execute();
  }

  /** How many photos have a per-photo choice. */
  @GenerateSql()
  async countOffers(): Promise<number> {
    const { count } = await this.db
      .selectFrom('asset_spatial_scene_offer')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  /** Removes every per-photo choice, so every photo follows the automatic choice; returns how many there were. */
  async deleteOffers(): Promise<number> {
    const result = await this.db.deleteFrom('asset_spatial_scene_offer').executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  /** The depth maps among `paths`, for IntegrityService: they sit in the thumbnail folder the untracked-file scan walks. */
  @GenerateSql({ params: [DummyValue.STRING] })
  getPathsByPaths(paths: string[]) {
    return this.db.selectFrom('asset_spatial_scene').select('path').where('path', 'in', paths).execute();
  }

  async upsert(row: Insertable<AssetSpatialSceneTable>): Promise<void> {
    const { assetId: _, ...update } = row;
    await this.db
      .insertInto('asset_spatial_scene')
      .values(row)
      .onConflict((oc) => oc.column('assetId').doUpdateSet({ ...update, createdAt: sql`now()` }))
      .execute();
  }
}
