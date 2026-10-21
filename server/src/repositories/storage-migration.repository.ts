import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { AssetFileType } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { StorageMigrationLogTable } from 'src/schema/tables/storage-migration-log.table.js';
import { escapeLikePattern } from 'src/utils/database.js';

export type StorageMigrationDirection = 'toS3' | 'toDisk';

export interface StorageMigrationFileCounts {
  originals: number;
  thumbnails: number;
  previews: number;
  fullsize: number;
  sidecars: number;
  encodedVideos: number;
  personThumbnails: number;
  profileImages: number;
}

@Injectable()
export class StorageMigrationRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  // --- Streaming queries ---

  streamOriginals(direction: StorageMigrationDirection) {
    return this.db
      .selectFrom('asset')
      .select(['id', 'originalPath'])
      .$if(direction === 'toS3', (qb) => qb.where('originalPath', 'like', '/%'))
      .$if(direction === 'toDisk', (qb) => qb.where('originalPath', 'not like', '/%'))
      .stream();
  }

  streamAssetFiles(direction: StorageMigrationDirection, fileTypes: AssetFileType[]) {
    return this.db
      .selectFrom('asset_file')
      .innerJoin('asset', 'asset.id', 'asset_file.assetId')
      .select(['asset_file.id', 'asset_file.assetId', 'asset_file.path', 'asset_file.type'])
      .where('asset_file.type', 'in', fileTypes)
      .$if(direction === 'toS3', (qb) => qb.where('asset_file.path', 'like', '/%'))
      .$if(direction === 'toDisk', (qb) => qb.where('asset_file.path', 'not like', '/%'))
      .stream();
  }

  streamEncodedVideos(direction: StorageMigrationDirection) {
    return this.db
      .selectFrom('asset_file')
      .innerJoin('asset', 'asset.id', 'asset_file.assetId')
      .select(['asset_file.id', 'asset_file.assetId', 'asset_file.path', 'asset_file.type'])
      .where('asset_file.type', '=', AssetFileType.EncodedVideo)
      .$if(direction === 'toS3', (qb) => qb.where('asset_file.path', 'like', '/%'))
      .$if(direction === 'toDisk', (qb) => qb.where('asset_file.path', 'not like', '/%'))
      .stream();
  }

  streamPersonThumbnails(direction: StorageMigrationDirection) {
    return this.db
      .selectFrom('person')
      .select(['personGroupId', 'thumbnailPath'])
      .where('thumbnailPath', '!=', '')
      .$if(direction === 'toS3', (qb) => qb.where('thumbnailPath', 'like', '/%'))
      .$if(direction === 'toDisk', (qb) => qb.where('thumbnailPath', 'not like', '/%'))
      .stream();
  }

  streamProfileImages(direction: StorageMigrationDirection) {
    return this.db
      .selectFrom('user')
      .select(['id', 'profileImagePath'])
      .where('profileImagePath', '!=', '')
      .$if(direction === 'toS3', (qb) => qb.where('profileImagePath', 'like', '/%'))
      .$if(direction === 'toDisk', (qb) => qb.where('profileImagePath', 'not like', '/%'))
      .stream();
  }

  /** assets holding a non-edited derivative under a storage-backend key, otherwise filtered as streamForMigrationJob */
  streamAssetsWithBackendDerivatives() {
    return this.db
      .selectFrom('asset')
      .select(['asset.id'])
      .where('asset.deletedAt', 'is', null)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.id')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', 'in', [
              AssetFileType.Thumbnail,
              AssetFileType.Preview,
              AssetFileType.FullSize,
              AssetFileType.EncodedVideo,
            ])
            .where('asset_file.isEdited', '=', false)
            .where('asset_file.path', 'not like', '/%'),
        ),
      )
      .stream();
  }

  /** whether any asset, trashed or not, has its original stored as a storage-backend key */
  async hasBackendOriginals(): Promise<boolean> {
    const row = await this.db
      .selectFrom('asset')
      .select('asset.id')
      .where('asset.originalPath', 'not like', '/%')
      .limit(1)
      .executeTakeFirst();
    return !!row;
  }

  /** people whose thumbnail is a storage-backend key */
  streamPeopleWithBackendThumbnails() {
    return this.db
      .selectFrom('person')
      .select(['ownerId', 'personGroupId'])
      .where('thumbnailPath', '!=', '')
      .where('thumbnailPath', 'not like', '/%')
      .stream();
  }

  /** whether an asset not owned by ownerId has its original, or a file of its own (a sidecar), under the key prefix */
  async hasOtherOwnerFilesUnderPrefix(prefix: string, ownerId: string): Promise<boolean> {
    // a storage label may contain the LIKE wildcards _ and %, which must match only themselves
    const likePrefix = `${escapeLikePattern(prefix)}%`;
    const pattern = sql<string>`${likePrefix} escape '\\'`;
    const { found } = await this.db
      .selectNoFrom((eb) =>
        eb
          .or([
            eb.exists(
              eb
                .selectFrom('asset')
                .select('asset.id')
                .where('asset.ownerId', '!=', ownerId)
                .where('asset.originalPath', 'like', pattern),
            ),
            eb.exists(
              eb
                .selectFrom('asset_file')
                .innerJoin('asset', 'asset.id', 'asset_file.assetId')
                .select('asset_file.id')
                .where('asset.ownerId', '!=', ownerId)
                .where('asset_file.path', 'like', pattern),
            ),
          ])
          .as('found'),
      )
      .executeTakeFirstOrThrow();

    return !!found;
  }

  // --- Estimate queries ---

  async getOriginalsSizeEstimate(direction: StorageMigrationDirection): Promise<number> {
    const result = await this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('asset_exif.fileSizeInByte'), eb.lit(0)).as('totalSize'))
      .$if(direction === 'toS3', (qb) => qb.where('asset.originalPath', 'like', '/%'))
      .$if(direction === 'toDisk', (qb) => qb.where('asset.originalPath', 'not like', '/%'))
      .executeTakeFirstOrThrow();

    return Number(result.totalSize);
  }

  async getFileCounts(direction: StorageMigrationDirection): Promise<StorageMigrationFileCounts> {
    const pathFilter = direction === 'toS3' ? 'like' : ('not like' as const);
    const pathPattern = '/%';

    const [originals, assetFiles, encodedVideos, personThumbnails, profileImages] = await Promise.all([
      this.db
        .selectFrom('asset')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('originalPath', pathFilter, pathPattern)
        .executeTakeFirstOrThrow(),

      this.db
        .selectFrom('asset_file')
        .select((eb) => [
          eb.fn.countAll<number>().filterWhere('type', '=', AssetFileType.Thumbnail).as('thumbnails'),
          eb.fn.countAll<number>().filterWhere('type', '=', AssetFileType.Preview).as('previews'),
          eb.fn.countAll<number>().filterWhere('type', '=', AssetFileType.FullSize).as('fullsize'),
          eb.fn.countAll<number>().filterWhere('type', '=', AssetFileType.Sidecar).as('sidecars'),
        ])
        .where('path', pathFilter, pathPattern)
        .executeTakeFirstOrThrow(),

      this.db
        .selectFrom('asset_file')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('type', '=', AssetFileType.EncodedVideo)
        .where('path', pathFilter, pathPattern)
        .executeTakeFirstOrThrow(),

      this.db
        .selectFrom('person')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('thumbnailPath', '!=', '')
        .where('thumbnailPath', pathFilter, pathPattern)
        .executeTakeFirstOrThrow(),

      this.db
        .selectFrom('user')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('profileImagePath', '!=', '')
        .where('profileImagePath', pathFilter, pathPattern)
        .executeTakeFirstOrThrow(),
    ]);

    return {
      originals: originals.count,
      thumbnails: assetFiles.thumbnails,
      previews: assetFiles.previews,
      fullsize: assetFiles.fullsize,
      sidecars: assetFiles.sidecars,
      encodedVideos: encodedVideos.count,
      personThumbnails: personThumbnails.count,
      profileImages: profileImages.count,
    };
  }

  // --- Optimistic update methods ---

  async updateAssetOriginalPath(assetId: string, oldPath: string, newPath: string): Promise<boolean> {
    const result = await this.db
      .updateTable('asset')
      .set({ originalPath: newPath })
      .where('id', '=', assetId)
      .where('originalPath', '=', oldPath)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async updateAssetEncodedVideoPath(assetId: string, oldPath: string, newPath: string): Promise<boolean> {
    const result = await this.db
      .updateTable('asset_file')
      .set({ path: newPath })
      .where('assetId', '=', assetId)
      .where('type', '=', AssetFileType.EncodedVideo)
      .where('path', '=', oldPath)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async updateAssetFilePath(fileId: string, oldPath: string, newPath: string): Promise<boolean> {
    const result = await this.db
      .updateTable('asset_file')
      .set({ path: newPath })
      .where('id', '=', fileId)
      .where('path', '=', oldPath)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async updatePersonThumbnailPath(personId: string, oldPath: string, newPath: string): Promise<boolean> {
    const result = await this.db
      .updateTable('person')
      .set({ thumbnailPath: newPath })
      .where('personGroupId', '=', personId)
      .where('thumbnailPath', '=', oldPath)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async updateUserProfileImagePath(userId: string, oldPath: string, newPath: string): Promise<boolean> {
    const result = await this.db
      .updateTable('user')
      .set({ profileImagePath: newPath })
      .where('id', '=', userId)
      .where('profileImagePath', '=', oldPath)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  // --- Migration log CRUD ---

  async createLogEntry(entry: Insertable<StorageMigrationLogTable>) {
    return this.db.insertInto('storage_migration_log').values(entry).returningAll().executeTakeFirstOrThrow();
  }

  async getLogEntriesByBatch(batchId: string) {
    return this.db.selectFrom('storage_migration_log').selectAll().where('batchId', '=', batchId).execute();
  }

  async deleteLogEntriesByBatch(batchId: string) {
    return this.db.deleteFrom('storage_migration_log').where('batchId', '=', batchId).execute();
  }
}
