import { Injectable } from '@nestjs/common';
import { Insertable, Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { AssetFileType } from 'src/enum';
import { DB } from 'src/schema';
import { StorageMigrationLogTable } from 'src/schema/tables/storage-migration-log.table';

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
      .select(['id', 'thumbnailPath'])
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

  // --- S3-only streaming queries (enable-encryption-in-place migration) ---
  //
  // These are written as their own queries, not `streamOriginals('toDisk')` etc. (which happen
  // to use the same `not like '/%'` filter, since a relative key means "currently on S3"),
  // because reusing the disk<->S3 migration's direction parameter to mean "give me S3 keys" here
  // would be a confusing, easily-broken coupling if that filter's meaning ever changes.

  streamS3Originals() {
    return this.db.selectFrom('asset').select(['id', 'originalPath']).where('originalPath', 'not like', '/%').stream();
  }

  streamS3AssetFiles(fileTypes: AssetFileType[]) {
    return this.db
      .selectFrom('asset_file')
      .select(['id', 'assetId', 'path', 'type'])
      .where('type', 'in', fileTypes)
      .where('path', 'not like', '/%')
      .stream();
  }

  streamS3EncodedVideos() {
    return this.db
      .selectFrom('asset_file')
      .select(['id', 'assetId', 'path', 'type'])
      .where('type', '=', AssetFileType.EncodedVideo)
      .where('path', 'not like', '/%')
      .stream();
  }

  streamS3PersonThumbnails() {
    return this.db
      .selectFrom('person')
      .select(['id', 'thumbnailPath'])
      .where('thumbnailPath', '!=', '')
      .where('thumbnailPath', 'not like', '/%')
      .stream();
  }

  streamS3ProfileImages() {
    return this.db
      .selectFrom('user')
      .select(['id', 'profileImagePath'])
      .where('profileImagePath', '!=', '')
      .where('profileImagePath', 'not like', '/%')
      .stream();
  }

  async getS3FileCounts(): Promise<StorageMigrationFileCounts> {
    const pathPattern = '/%';

    const [originals, assetFiles, encodedVideos, personThumbnails, profileImages] = await Promise.all([
      this.db
        .selectFrom('asset')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('originalPath', 'not like', pathPattern)
        .executeTakeFirstOrThrow(),

      this.db
        .selectFrom('asset_file')
        .select((eb) => [
          eb.fn.countAll<number>().filterWhere('type', '=', AssetFileType.Thumbnail).as('thumbnails'),
          eb.fn.countAll<number>().filterWhere('type', '=', AssetFileType.Preview).as('previews'),
          eb.fn.countAll<number>().filterWhere('type', '=', AssetFileType.FullSize).as('fullsize'),
          eb.fn.countAll<number>().filterWhere('type', '=', AssetFileType.Sidecar).as('sidecars'),
        ])
        .where('path', 'not like', pathPattern)
        .executeTakeFirstOrThrow(),

      this.db
        .selectFrom('asset_file')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('type', '=', AssetFileType.EncodedVideo)
        .where('path', 'not like', pathPattern)
        .executeTakeFirstOrThrow(),

      this.db
        .selectFrom('person')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('thumbnailPath', '!=', '')
        .where('thumbnailPath', 'not like', pathPattern)
        .executeTakeFirstOrThrow(),

      this.db
        .selectFrom('user')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('profileImagePath', '!=', '')
        .where('profileImagePath', 'not like', pathPattern)
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
      .where('id', '=', personId)
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

  /**
   * Idempotency check for the enable-encryption migration: unlike the disk<->S3 migration
   * (idempotent via `targetBackend.exists(targetPath)`, since the object moves to a new
   * location), reencryptInPlace's source and destination key are the same, and re-running
   * CopyObject on an object that's already SSE-C encrypted fails (S3 needs decrypt headers for
   * an encrypted source, which reencryptInPlace deliberately does not send). So completion is
   * tracked via this log table instead of by querying object state.
   */
  async isS3EncryptionLogged(direction: string, key: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('storage_migration_log')
      .select('id')
      .where('direction', '=', direction)
      .where('newPath', '=', key)
      .executeTakeFirst();
    return !!row;
  }
}
