import { Injectable } from '@nestjs/common';
import { Expression, ExpressionBuilder, Insertable, Kysely, SqlBool, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import {
  MIGRATION_FILE_TYPE_TO_KIND,
  StorageMigrationFileType,
  StorageRoutingKind,
} from 'src/backends/storage-router.js';
import { AssetFileType } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { StorageMigrationLogTable } from 'src/schema/tables/storage-migration-log.table.js';
import { escapeLikePattern } from 'src/utils/database.js';

export type StorageMigrationDirection = 'toS3' | 'toDisk';

/**
External-library originals live outside the media location and are matched on by the library
scanner (originalPath.startsWith(importPath)). Rewriting the path on migration detaches the
asset from its source file. Every query that touches originals (the stream, `getFileCounts`,
and the size estimate the admin sees alongside those counts) excludes them through this one
predicate so none of them can drift from what a migration would actually move.
*/
const excludeExternalLibraryOriginals = (eb: ExpressionBuilder<DB, keyof DB>): Expression<SqlBool> =>
  eb('asset.libraryId', 'is', null);

/**
Sidecars of an external-library asset are excluded for the same reason as the original itself;
Immich-generated derivatives (thumbnails, previews, fullsize, encoded video) of an external
asset stay migratable since only the source file is scanner-matched. Shared by every query
that filters `asset_file` rows on the sidecar/non-sidecar split.
*/
const excludeExternalLibrarySidecars = (eb: ExpressionBuilder<DB, keyof DB>): Expression<SqlBool> =>
  eb.or([eb('asset_file.type', '!=', AssetFileType.Sidecar), eb('asset.libraryId', 'is', null)]);

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
      .where((eb) => excludeExternalLibraryOriginals(eb))
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
      .where((eb) => excludeExternalLibrarySidecars(eb))
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

  /** Spatial Scene depth maps (specs/2026-10-29-spatial-scene-design.md): derived from the preview, so they move with it. */
  streamDepthMaps(direction: StorageMigrationDirection) {
    return this.db
      .selectFrom('asset_spatial_scene')
      .select(['assetId', 'path'])
      .$if(direction === 'toS3', (qb) => qb.where('path', 'like', '/%'))
      .$if(direction === 'toDisk', (qb) => qb.where('path', 'not like', '/%'))
      .stream();
  }

  /** Data Saver video copies (specs/2026-11-01-data-saver-video-design.md): they move with the encoded videos. */
  streamDataSaverVideos(direction: StorageMigrationDirection) {
    return this.db
      .selectFrom('asset_data_saver_video')
      .select((eb) => ['assetId', eb.ref('path').$castTo<string>().as('path')])
      .where('path', 'is not', null)
      .$if(direction === 'toS3', (qb) => qb.where('path', 'like', '/%'))
      .$if(direction === 'toDisk', (qb) => qb.where('path', 'not like', '/%'))
      .stream();
  }

  /**
  Best frames of video faces (specs/2026-10-31-video-face-frames-design.md): the source person thumbnails are cut
  from, so they move with them.
  */
  streamVideoFaceFrames(direction: StorageMigrationDirection) {
    return this.db
      .selectFrom('asset_face_video_frame')
      .select(['faceId', 'path'])
      .$if(direction === 'toS3', (qb) => qb.where('path', 'like', '/%'))
      .$if(direction === 'toDisk', (qb) => qb.where('path', 'not like', '/%'))
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

  /** whether any asset, trashed or not, has its original stored as an S3 key */
  async hasS3Originals(): Promise<boolean> {
    const row = await this.db
      .selectFrom('asset')
      .select('asset.id')
      .where('asset.originalPath', 'not like', '/%')
      .limit(1)
      .executeTakeFirst();
    return !!row;
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
      .where((eb) => excludeExternalLibraryOriginals(eb))
      .$if(direction === 'toS3', (qb) => qb.where('asset.originalPath', 'like', '/%'))
      .$if(direction === 'toDisk', (qb) => qb.where('asset.originalPath', 'not like', '/%'))
      .executeTakeFirstOrThrow();

    return Number(result.totalSize);
  }

  async getFileCounts(direction: StorageMigrationDirection): Promise<StorageMigrationFileCounts> {
    const pathFilter = direction === 'toS3' ? 'like' : ('not like' as const);
    const pathPattern = '/%';

    const [originals, assetFiles, depthMaps, encodedVideos, personThumbnails, videoFaceFrames, profileImages] =
      await Promise.all([
        this.db
          .selectFrom('asset')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where((eb) => excludeExternalLibraryOriginals(eb))
          .where('originalPath', pathFilter, pathPattern)
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
          .where((eb) => excludeExternalLibrarySidecars(eb))
          .where('asset_file.path', pathFilter, pathPattern)
          .executeTakeFirstOrThrow(),

        this.db
          .selectFrom('asset_spatial_scene')
          .select((eb) => eb.fn.countAll<number>().as('count'))
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
          .selectFrom('asset_face_video_frame')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('path', pathFilter, pathPattern)
          .executeTakeFirstOrThrow(),

        this.db
          .selectFrom('user')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('profileImagePath', '!=', '')
          .where('profileImagePath', pathFilter, pathPattern)
          .executeTakeFirstOrThrow(),
      ]);
    // Data Saver copies move with the encoded videos they sit beside
    const dataSaverVideos = await this.db
      .selectFrom('asset_data_saver_video')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('path', pathFilter, pathPattern)
      .executeTakeFirstOrThrow();

    return {
      originals: originals.count,
      thumbnails: assetFiles.thumbnails,
      // depth maps move with the previews they were made from
      previews: Number(assetFiles.previews) + Number(depthMaps.count),
      fullsize: assetFiles.fullsize,
      sidecars: assetFiles.sidecars,
      encodedVideos: Number(encodedVideos.count) + Number(dataSaverVideos.count),
      // video face frames move with the person thumbnails cut from them
      personThumbnails: Number(personThumbnails.count) + Number(videoFaceFrames.count),
      profileImages: profileImages.count,
    };
  }

  /**
  Per-kind disk/s3 breakdown for the settings page. Built from two `getFileCounts` calls
  (the set of files eligible to move toS3 is exactly the disk-resident set, and vice versa)
  rather than a hand-rolled query, so it shares the exact same predicate, exclusions and
  type groupings as `getFileCounts` and the streams: it cannot drift from what a migration
  would actually move. `MIGRATION_FILE_TYPE_TO_KIND` is the single source of truth for which
  migrator file type rolls up into which routing kind (see storage-router.ts).
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
      counts[kind].disk += Number(disk[fileType]);
      counts[kind].s3 += Number(s3[fileType]);
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

  async updateDepthMapPath(assetId: string, oldPath: string, newPath: string): Promise<boolean> {
    const result = await this.db
      .updateTable('asset_spatial_scene')
      .set({ path: newPath })
      .where('assetId', '=', assetId)
      .where('path', '=', oldPath)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async updateDataSaverVideoPath(assetId: string, oldPath: string, newPath: string): Promise<boolean> {
    const result = await this.db
      .updateTable('asset_data_saver_video')
      .set({ path: newPath })
      .where('assetId', '=', assetId)
      .where('path', '=', oldPath)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async updateVideoFaceFramePath(faceId: string, oldPath: string, newPath: string): Promise<boolean> {
    const result = await this.db
      .updateTable('asset_face_video_frame')
      .set({ path: newPath })
      .where('faceId', '=', faceId)
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
