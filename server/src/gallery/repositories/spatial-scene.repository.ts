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
   * What the depth job needs: the preview the viewer shows (the edited one once the photo is edited, so the map lines
   * up with the crop and rotation) and what decides whether the photo is processed at all.
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

  @GenerateSql({ params: [DummyValue.UUID] })
  get(assetId: string) {
    return this.db
      .selectFrom('asset_spatial_scene')
      .select(['path', 'width', 'height', 'boundarySharpness', 'edgeDensity', 'foregroundRatio', 'focus', 'modelName'])
      .where('assetId', '=', asUuid(assetId))
      .executeTakeFirst();
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
