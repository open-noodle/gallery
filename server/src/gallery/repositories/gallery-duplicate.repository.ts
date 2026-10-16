import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetStatus } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { asUuid } from 'src/utils/database.js';

@Injectable()
export class GalleryDuplicateRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  // Unlike get, sees trashed, stacked, hidden, locked and exif-less assets: any of them can rejoin the group later.
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async hasOtherOwner(duplicateId: string, userId: string): Promise<boolean> {
    const result = await this.db
      .selectFrom('asset')
      .select('id')
      .where('duplicateId', '=', asUuid(duplicateId))
      .where('ownerId', '!=', asUuid(userId))
      .limit(1)
      .executeTakeFirst();
    return !!result;
  }

  @GenerateSql({
    params: [[{ assetId: DummyValue.UUID, ownerId: DummyValue.UUID, checksum: DummyValue.BUFFER }]],
  })
  async createChecksumTombstones(items: { assetId: string; ownerId: string; checksum: Buffer }[]): Promise<void> {
    if (items.length === 0) {
      return;
    }

    await this.db
      .insertInto('asset_duplicate_checksum')
      .values(
        items.map(({ assetId, ownerId, checksum }) => ({
          assetId: asUuid(assetId),
          ownerId: asUuid(ownerId),
          checksum,
        })),
      )
      .onConflict((oc) =>
        oc.columns(['ownerId', 'checksum']).doUpdateSet({ assetId: (eb) => eb.ref('excluded.assetId') }),
      )
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async deleteConflictingTombstones(ownerId: string, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    await this.db
      .deleteFrom('asset_duplicate_checksum')
      .where('ownerId', '=', asUuid(ownerId))
      .where(
        'checksum',
        'in',
        this.db
          .selectFrom('asset')
          .select('checksum')
          .where(
            'id',
            'in',
            assetIds.map((id) => asUuid(id)),
          ),
      )
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async deleteConflictingTombstonesForUser(ownerId: string): Promise<void> {
    await this.db
      .deleteFrom('asset_duplicate_checksum')
      .where('ownerId', '=', asUuid(ownerId))
      .where(
        'checksum',
        'in',
        this.db
          .selectFrom('asset')
          .select('checksum')
          .where('ownerId', '=', asUuid(ownerId))
          .where('status', '=', AssetStatus.Active),
      )
      .execute();
  }
}
