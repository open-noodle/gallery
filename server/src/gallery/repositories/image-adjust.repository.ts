import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import type { ImageAdjust } from 'src/gallery/dtos/image-adjust.dto.js';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { DB } from 'src/schema/index.js';
import { asUuid } from 'src/utils/database.js';

@Injectable()
export class ImageAdjustRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  get(assetId: string): Promise<ImageAdjust | undefined> {
    return this.db
      .selectFrom('asset_image_adjust')
      .select(['exposure', 'contrast', 'saturation', 'invert'])
      .where('assetId', '=', asUuid(assetId))
      .executeTakeFirst();
  }

  /** Stores the adjustment and marks the asset edited: its adjusted thumbnails are the edited ones. */
  @GenerateSql({ params: [DummyValue.UUID, { exposure: 10, contrast: 0, saturation: 0, invert: false }] })
  async upsert(assetId: string, adjust: ImageAdjust): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('asset_image_adjust')
        .values({ assetId, ...adjust })
        .onConflict((oc) => oc.column('assetId').doUpdateSet(adjust))
        .execute();
      await tx
        .updateTable('asset')
        .set({ isEdited: true })
        .where('id', '=', asUuid(assetId))
        .where('isEdited', '=', false)
        .execute();
    });
  }

  /**
   * The adjustment the edit job renders into an image's edited outputs, keeping the image marked edited while it has
   * one (see `markEdited`).
   */
  async getForRender(assetId: string): Promise<ImageAdjust | undefined> {
    const adjust = await this.get(assetId);
    if (adjust) {
      await this.markEdited(assetId);
    }
    return adjust;
  }

  /**
   * Sets isEdited back on an adjusted asset. Removing its last crop/rotate/mirror clears the flag through Immich's
   * asset_edit_delete trigger, which does not know about the adjustment. Writes nothing when the flag is already set.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  async markEdited(assetId: string): Promise<void> {
    await this.db
      .updateTable('asset')
      .set({ isEdited: true })
      .where('id', '=', asUuid(assetId))
      .where('isEdited', '=', false)
      .execute();
  }

  /**
   * Removes the adjustment. The asset stays edited while asset_edit (crop, rotate, mirror) or a video trim still
   * applies to it; returns whether there was an adjustment to remove.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  async delete(assetId: string): Promise<boolean> {
    return await this.db.transaction().execute(async (tx) => {
      const deleted = await tx
        .deleteFrom('asset_image_adjust')
        .where('assetId', '=', asUuid(assetId))
        .returning('assetId')
        .executeTakeFirst();
      if (!deleted) {
        return false;
      }

      await tx
        .updateTable('asset')
        .set({ isEdited: false })
        .where('id', '=', asUuid(assetId))
        .where('isEdited', '=', true)
        .where((eb) =>
          eb.not(
            eb.or([
              eb.exists(
                eb
                  .selectFrom('asset_edit')
                  .select('asset_edit.assetId')
                  .whereRef('asset_edit.assetId', '=', 'asset.id'),
              ),
              eb.exists(
                eb
                  .selectFrom('asset_video_trim')
                  .select('asset_video_trim.assetId')
                  .whereRef('asset_video_trim.assetId', '=', 'asset.id'),
              ),
            ]),
          ),
        )
        .execute();
      return true;
    });
  }
}
