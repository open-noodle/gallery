import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetFileType, AssetType, AssetVisibility } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { AssetDataSaverVideoTable } from 'src/schema/tables/asset-data-saver-video.table.js';
import { asUuid } from 'src/utils/database.js';

// Data Saver video copies (specs/2026-11-01-data-saver-video-design.md).
@Injectable()
export class DataSaverVideoRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /**
   * What the job needs beyond upstream's getForVideoConversion: whether the video is one anybody views on its own, the
   * trimmed file when there is one (the copy follows the trim), and the copy it already has.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  getForJob(id: string) {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_data_saver_video', 'asset_data_saver_video.assetId', 'asset.id')
      .select((eb) => [
        'asset.id',
        'asset.ownerId',
        'asset.type',
        'asset.visibility',
        'asset_data_saver_video.path',
        'asset_data_saver_video.settings',
        eb
          .selectFrom('asset_file')
          .select('asset_file.path')
          .whereRef('asset_file.assetId', '=', 'asset.id')
          .where('asset_file.type', '=', sql.lit(AssetFileType.EncodedVideo))
          .where('asset_file.isEdited', '=', true)
          .limit(1)
          .as('editedVideoPath'),
      ])
      .where('asset.id', '=', asUuid(id))
      .where('asset.deletedAt', 'is', null)
      .executeTakeFirst();
  }

  /** Videos with no copy, or one made with other settings; every video with `force`. */
  @GenerateSql({ params: [DummyValue.STRING], stream: true })
  streamForQueue(settings: string, force?: boolean) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id'])
      .$if(!force, (qb) =>
        qb.where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('asset_data_saver_video')
                .select('asset_data_saver_video.assetId')
                .whereRef('asset_data_saver_video.assetId', '=', 'asset.id')
                .where('asset_data_saver_video.settings', '=', settings),
            ),
          ),
        ),
      )
      .where('asset.type', '=', sql.lit(AssetType.Video))
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', '!=', sql.lit(AssetVisibility.Hidden))
      .stream();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  get(assetId: string) {
    return this.db
      .selectFrom('asset_data_saver_video')
      .select(['path', 'settings', 'fromEdited'])
      .where('assetId', '=', asUuid(assetId))
      .executeTakeFirst();
  }

  /** The copies among `paths`, for IntegrityService: they sit in the encoded-video folder the untracked-file scan walks. */
  @GenerateSql({ params: [DummyValue.STRING] })
  getPathsByPaths(paths: string[]) {
    return this.db
      .selectFrom('asset_data_saver_video')
      .select((eb) => eb.ref('path').$castTo<string>().as('path'))
      .where('path', 'in', paths)
      .execute();
  }

  async upsert(row: Insertable<AssetDataSaverVideoTable>): Promise<void> {
    const { assetId: _, ...update } = row;
    await this.db
      .insertInto('asset_data_saver_video')
      .values(row)
      .onConflict((oc) => oc.column('assetId').doUpdateSet({ ...update, createdAt: sql`now()` }))
      .execute();
  }
}
