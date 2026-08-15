import { Injectable } from '@nestjs/common';
import { Insertable, Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { MIGRATION_FILE_TYPE_TO_KIND, StorageMigrationFileType, StorageRoutingKind } from 'src/backends/storage-router';
import { AssetFileType } from 'src/enum';
import { DB } from 'src/schema';
import { StorageMigrationLogTable } from 'src/schema/tables/storage-migration-log.table';

export type StorageMigrationDirection = 'toS3' | 'toDisk';

/**
 * Path-shape predicate shared by every stream, `getFileCounts`, and `getRoutingCounts`. A
 * hand-copied second predicate is how the settings page ends up nagging an admin toward a
 * migration that does not actually match what the streams would move.
 */
const pathOperator = (direction: StorageMigrationDirection) => (direction === 'toS3' ? 'like' : ('not like' as const));
const PATH_PATTERN = '/%';

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
    return (
      this.db
        .selectFrom('asset')
        .select(['id', 'originalPath'])
        // External-library originals live outside the media location and are matched on by the
        // library scanner (originalPath.startsWith(importPath)). Rewriting the path on migration
        // detaches the asset from its source file.
        .where('libraryId', 'is', null)
        .where('originalPath', pathOperator(direction), PATH_PATTERN)
        .stream()
    );
  }

  streamAssetFiles(direction: StorageMigrationDirection, fileTypes: AssetFileType[]) {
    return (
      this.db
        .selectFrom('asset_file')
        .innerJoin('asset', 'asset.id', 'asset_file.assetId')
        .select(['asset_file.id', 'asset_file.assetId', 'asset_file.path', 'asset_file.type'])
        .where('asset_file.type', 'in', fileTypes)
        // Sidecars of an external-library asset are excluded for the same reason as the
        // original itself. Immich-generated derivatives (thumbnails, previews, encoded video) of
        // an external asset stay migratable — only the source file is scanner-matched.
        .where((eb) => eb.or([eb('asset_file.type', '!=', AssetFileType.Sidecar), eb('asset.libraryId', 'is', null)]))
        .where('asset_file.path', pathOperator(direction), PATH_PATTERN)
        .stream()
    );
  }

  streamEncodedVideos(direction: StorageMigrationDirection) {
    return this.db
      .selectFrom('asset_file')
      .innerJoin('asset', 'asset.id', 'asset_file.assetId')
      .select(['asset_file.id', 'asset_file.assetId', 'asset_file.path', 'asset_file.type'])
      .where('asset_file.type', '=', AssetFileType.EncodedVideo)
      .where('asset_file.path', pathOperator(direction), PATH_PATTERN)
      .stream();
  }

  streamPersonThumbnails(direction: StorageMigrationDirection) {
    return this.db
      .selectFrom('person')
      .select(['id', 'thumbnailPath'])
      .where('thumbnailPath', '!=', '')
      .where('thumbnailPath', pathOperator(direction), PATH_PATTERN)
      .stream();
  }

  streamProfileImages(direction: StorageMigrationDirection) {
    return this.db
      .selectFrom('user')
      .select(['id', 'profileImagePath'])
      .where('profileImagePath', '!=', '')
      .where('profileImagePath', pathOperator(direction), PATH_PATTERN)
      .stream();
  }

  // --- Estimate queries ---

  async getOriginalsSizeEstimate(direction: StorageMigrationDirection): Promise<number> {
    const result = await this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('asset_exif.fileSizeInByte'), eb.lit(0)).as('totalSize'))
      .where('asset.originalPath', pathOperator(direction), PATH_PATTERN)
      .executeTakeFirstOrThrow();

    return Number(result.totalSize);
  }

  async getFileCounts(direction: StorageMigrationDirection): Promise<StorageMigrationFileCounts> {
    const [originals, assetFiles, encodedVideos, personThumbnails, profileImages] = await Promise.all([
      this.db
        .selectFrom('asset')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        // See streamOriginals: external-library originals are never migrated.
        .where('libraryId', 'is', null)
        .where('originalPath', pathOperator(direction), PATH_PATTERN)
        .executeTakeFirstOrThrow(),

      this.db
        .selectFrom('asset_file')
        .innerJoin('asset', 'asset.id', 'asset_file.assetId')
        .select((eb) => [
          eb.fn.countAll<number>().filterWhere('asset_file.type', '=', AssetFileType.Thumbnail).as('thumbnails'),
          eb.fn.countAll<number>().filterWhere('asset_file.type', '=', AssetFileType.Preview).as('previews'),
          eb.fn.countAll<number>().filterWhere('asset_file.type', '=', AssetFileType.FullSize).as('fullsize'),
          eb.fn.countAll<number>().filterWhere('asset_file.type', '=', AssetFileType.Sidecar).as('sidecars'),
        ])
        // See streamAssetFiles: only sidecars of an external-library asset are excluded;
        // thumbnails/previews/fullsize of an external asset stay migratable.
        .where((eb) => eb.or([eb('asset_file.type', '!=', AssetFileType.Sidecar), eb('asset.libraryId', 'is', null)]))
        .where('asset_file.path', pathOperator(direction), PATH_PATTERN)
        .executeTakeFirstOrThrow(),

      this.db
        .selectFrom('asset_file')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('type', '=', AssetFileType.EncodedVideo)
        .where('path', pathOperator(direction), PATH_PATTERN)
        .executeTakeFirstOrThrow(),

      this.db
        .selectFrom('person')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('thumbnailPath', '!=', '')
        .where('thumbnailPath', pathOperator(direction), PATH_PATTERN)
        .executeTakeFirstOrThrow(),

      this.db
        .selectFrom('user')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('profileImagePath', '!=', '')
        .where('profileImagePath', pathOperator(direction), PATH_PATTERN)
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

  /**
   * Per-kind disk/s3 breakdown for the settings page. Built from two `getFileCounts` calls
   * (the set of files eligible to move toS3 is exactly the disk-resident set, and vice versa)
   * rather than a hand-rolled query, so it shares the exact same predicate, exclusions and
   * type groupings as `getFileCounts` and the streams — it cannot drift from what a migration
   * would actually move. `MIGRATION_FILE_TYPE_TO_KIND` is the single source of truth for which
   * migrator file type rolls up into which routing kind (see storage-router.ts).
   */
  async getRoutingCounts(): Promise<Record<StorageRoutingKind, { disk: number; s3: number }>> {
    const [disk, s3] = await Promise.all([this.getFileCounts('toS3'), this.getFileCounts('toDisk')]);

    const counts: Record<StorageRoutingKind, { disk: number; s3: number }> = {
      [StorageRoutingKind.Originals]: { disk: 0, s3: 0 },
      [StorageRoutingKind.Thumbnails]: { disk: 0, s3: 0 },
      [StorageRoutingKind.EncodedVideo]: { disk: 0, s3: 0 },
    };

    for (const fileType of Object.keys(MIGRATION_FILE_TYPE_TO_KIND) as StorageMigrationFileType[]) {
      const kind = MIGRATION_FILE_TYPE_TO_KIND[fileType];
      counts[kind].disk += disk[fileType];
      counts[kind].s3 += s3[fileType];
    }

    return counts;
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
}
