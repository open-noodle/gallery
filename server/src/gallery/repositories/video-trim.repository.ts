import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { DB } from 'src/schema/index.js';
import { asUuid } from 'src/utils/database.js';

@Injectable()
export class VideoTrimRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /** The asset fields trimming validates against, with its current trim (null fields when untrimmed). */
  @GenerateSql({ params: [DummyValue.UUID] })
  getForTrim(assetId: string) {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_video_trim', 'asset_video_trim.assetId', 'asset.id')
      .select([
        'asset.type',
        'asset.livePhotoVideoId',
        'asset.originalPath',
        'asset.duration',
        'asset_video_trim.startTime',
        'asset_video_trim.endTime',
      ])
      .where('asset.id', '=', asUuid(assetId))
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  get(assetId: string) {
    return this.db
      .selectFrom('asset_video_trim')
      .select(['asset_video_trim.startTime', 'asset_video_trim.endTime'])
      .where('asset_video_trim.assetId', '=', asUuid(assetId))
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, 1, 3] })
  async upsert(assetId: string, startTime: number, endTime: number) {
    await this.db
      .insertInto('asset_video_trim')
      .values({ assetId, startTime, endTime })
      .onConflict((oc) => oc.column('assetId').doUpdateSet({ startTime, endTime }))
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async delete(assetId: string): Promise<boolean> {
    const deleted = await this.db
      .deleteFrom('asset_video_trim')
      .where('assetId', '=', asUuid(assetId))
      .returning('assetId')
      .executeTakeFirst();
    return !!deleted;
  }

  /** Records the trimmed file's length and bumps asset.updateId, so clients re-sync the projected duration. */
  @GenerateSql({ params: [DummyValue.UUID, 2000] })
  async setDuration(assetId: string, duration: number) {
    await this.db
      .with('trim', (qb) =>
        qb
          .updateTable('asset_video_trim')
          .set({ duration })
          .where('assetId', '=', asUuid(assetId))
          .returning('assetId'),
      )
      .updateTable('asset')
      .set({ isEdited: true })
      .where('id', 'in', (eb) => eb.selectFrom('trim').select('trim.assetId'))
      .execute();
  }
}
