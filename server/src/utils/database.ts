import { createPostgres, DatabaseConnectionParams } from '@immich/sql-tools';
import {
  AliasedRawBuilder,
  DeduplicateJoinsPlugin,
  Expression,
  ExpressionBuilder,
  Kysely,
  KyselyConfig,
  NotNull,
  OperandValueExpression,
  ReferenceExpression,
  Selectable,
  SelectQueryBuilder,
  ShallowDehydrateObject,
  sql,
  SqlBool,
} from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { setTimeout as sleep } from 'node:timers/promises';
import { Notice, PostgresError } from 'postgres';
import { columns, lockableProperties, LockableProperty, Person } from 'src/database';
import { DummyValue, GenerateSqlQueries } from 'src/decorators';
import { AssetEditActionItem } from 'src/dtos/editing.dto';
import {
  DEFAULT_SEARCH_ORDER,
  IdsFilter,
  isAlbumConfined,
  SearchFilterBranch,
  SearchOrder,
  StringFilter,
  StringPatternFilter,
} from 'src/dtos/search.dto';
import {
  AssetFileType,
  AssetOrder,
  AssetOrderBy,
  AssetVisibility,
  DatabaseExtension,
  ExifOrientation,
  SearchOrderField,
  TimeBucketSize,
} from 'src/enum';
import {
  AssetSearchBuilderOptions,
  AssetSearchBuilderV3Options,
  AssetSearchScope,
} from 'src/repositories/search.repository';
import { DB } from 'src/schema';
import { AssetExifTable } from 'src/schema/tables/asset-exif.table';
import { AudioStreamInfo, VectorExtension, VideoFormat, VideoPacketInfo, VideoStreamInfo } from 'src/types';
import { fromChecksum } from 'src/utils/request';
import { spaceAssetPathBranches, spaceVisibilityGate } from 'src/utils/shared-space-album-scope';
import { dateTruncUnitForTimeBucketSize } from 'src/utils/timeline-bucket';

export const getKyselyConfig = (connection: DatabaseConnectionParams): KyselyConfig => {
  return {
    dialect: new PostgresJSDialect({
      postgres: createPostgres({
        connection,
        onNotice: (notice: Notice) => {
          if (notice['severity'] !== 'NOTICE') {
            console.warn('Postgres notice:', notice);
          }
        },
      }),
    }),
    log(event) {
      if (event.level !== 'error') {
        return;
      }

      if (isAssetChecksumConstraint(event.error) || isStaleAssetForeignKeyConstraint(event.error)) {
        return;
      }

      console.error('Query failed :', {
        durationMs: event.queryDurationMillis,
        error: event.error,
        sql: event.query.sql,
        params: event.query.parameters,
      });
    },
  };
};

const uniqueIds = (ids: string[]) => [...new Set(ids)];

export const asUuid = (id: string | Expression<string>) => sql<string>`${id}::uuid`;

export const anyUuid = (ids: string[]) => sql<string>`any(${`{${ids}}`}::uuid[])`;

const uniqueTruthyIds = (ids: string[] = []) => [...new Set(ids.filter(Boolean))];

export const unnest = (array: string[]) => sql<Record<string, string>>`unnest(array[${sql.join(array)}]::text[])`;

export const removeUndefinedKeys = <T extends object>(update: T, template: unknown) => {
  for (const key in update) {
    if ((template as T)[key] === undefined) {
      delete update[key];
    }
  }

  return update;
};

export const ASSET_CHECKSUM_CONSTRAINT = 'UQ_assets_owner_checksum';
export const VIDEO_STREAM_SESSION_PK_CONSTRAINT = 'video_stream_session_pkey';

export const isAssetChecksumConstraint = (error: unknown) =>
  (error as PostgresError)?.constraint_name === ASSET_CHECKSUM_CONSTRAINT;

export const isVideoStreamSessionPkConstraint = (error: unknown) =>
  (error as PostgresError)?.constraint_name === VIDEO_STREAM_SESSION_PK_CONSTRAINT;

const STALE_ASSET_FOREIGN_KEY_CONSTRAINTS = new Set(['asset_file_assetId_fkey', 'asset_job_status_assetId_fkey']);

export const isStaleAssetForeignKeyConstraint = (error: unknown) => {
  const postgresError = error as PostgresError;
  return (
    postgresError?.code === '23503' &&
    postgresError.constraint_name !== undefined &&
    STALE_ASSET_FOREIGN_KEY_CONSTRAINTS.has(postgresError.constraint_name)
  );
};

const DEADLOCK_ERROR_CODE = '40P01';

export const isDeadlockError = (error: unknown) => (error as PostgresError)?.code === DEADLOCK_ERROR_CODE;

/**
 * Retry an operation that Postgres aborted as a deadlock victim (#864).
 *
 * Lock ordering alone cannot prevent every cycle here: deleting an asset makes Postgres lock
 * `shared_space_person` rows itself, to satisfy the `representativeFaceId` ON DELETE SET NULL
 * foreign key, and it takes those locks in face-deletion order. No application-level ordering can
 * join that sequence, so the losing transaction has to be re-driven instead.
 */
export const retryOnDeadlock = async <T>(
  operation: () => Promise<T>,
  options?: { attempts?: number; delayMs?: number },
): Promise<T> => {
  // 5, not 3: measured on the library-unmap repro at ~8.7k concurrent asset deletes, a budget of 3
  // still let one delete exhaust its attempts and lose the deletion.
  const attempts = options?.attempts ?? 5;
  const delayMs = options?.delayMs ?? 50;

  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !isDeadlockError(error)) {
        throw error;
      }

      // Jittered backoff — concurrent victims that retry in lockstep just collide again.
      await sleep(delayMs * attempt + Math.random() * delayMs);
    }
  }
};

export function withDefaultVisibility<O>(qb: SelectQueryBuilder<DB, 'asset', O>) {
  return qb.where('asset.visibility', 'in', [sql.lit(AssetVisibility.Archive), sql.lit(AssetVisibility.Timeline)]);
}

/**
 * Escape ILIKE wildcards so user-supplied filter text matches literally — e.g. a filename search for
 * "IMG_2024" must not treat "_" as a single-char wildcard, and "%" must not match everything. Pairs
 * with an `ESCAPE '\'` clause on the ILIKE. Backslash is escaped first so it does not double-escape
 * the wildcard escapes added afterwards. Used by both text-filter paths (the time-bucket queries in
 * asset.repository.ts and searchAssetBuilderLegacy below), which must agree: the map and the timeline
 * read the same filter chips.
 */
export const escapeLikePattern = (value: string): string =>
  value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('%', String.raw`\%`)
    .replaceAll('_', String.raw`\_`);

const selectExifInfo = (eb: AssetExpressionBuilder) =>
  eb.fn
    .toJson(eb.table('asset_exif'))
    .$castTo<ShallowDehydrateObject<Selectable<AssetExifTable>> | null>()
    .as('exifInfo');

// TODO come up with a better query that only selects the fields we need
export function withExif<O>(qb: SelectQueryBuilder<DB, 'asset', O>) {
  return qb.leftJoin('asset_exif', 'asset.id', 'asset_exif.assetId').select(selectExifInfo);
}

export function withExifInner<O>(qb: SelectQueryBuilder<DB, 'asset', O>) {
  return qb
    .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
    .select((eb) => eb.fn.toJson(eb.table('asset_exif')).as('exifInfo'))
    .$narrowType<{ exifInfo: NotNull }>();
}

export const dummy = sql`(select 1)`.as('dummy');

export function withAudioStream(eb: ExpressionBuilder<DB, 'asset_exif' | 'asset_audio'>) {
  return jsonObjectFrom(
    eb
      .selectFrom(dummy)
      .select(['asset_audio.index', 'asset_audio.codecName', 'asset_audio.profile', 'asset_audio.bitrate'])
      .where('asset_audio.assetId', 'is not', sql.lit(null))
      .$castTo<AudioStreamInfo | null>(),
  );
}

export function withVideoStream(eb: ExpressionBuilder<DB, 'asset_exif' | 'asset_video'>) {
  return jsonObjectFrom(
    eb
      .selectFrom(dummy)
      .select((eb) => [
        'asset_video.index',
        'asset_video.codecName',
        'asset_video.profile',
        'asset_video.level',
        'asset_video.bitrate',
        'asset_exif.exifImageWidth as width',
        'asset_exif.exifImageHeight as height',
        'asset_video.pixelFormat',
        'asset_video.frameCount',
        'asset_exif.fps as frameRate',
        'asset_video.timeBase',
        eb
          .case()
          .when('asset_exif.orientation', '=', sql.lit(ExifOrientation.Rotate90CW.toString()))
          .then(sql.lit(-90))
          .when('asset_exif.orientation', '=', sql.lit(ExifOrientation.Rotate270CW.toString()))
          .then(sql.lit(90))
          .when('asset_exif.orientation', '=', sql.lit(ExifOrientation.Rotate180.toString()))
          .then(sql.lit(180))
          .else(0)
          .end()
          .as('rotation'),
        'asset_video.colorPrimaries',
        'asset_video.colorMatrix',
        'asset_video.colorTransfer',
        'asset_video.dvProfile',
        'asset_video.dvLevel',
        'asset_video.dvBlSignalCompatibilityId',
      ])
      .where('asset_video.assetId', 'is not', sql.lit(null)),
  ).$castTo<(VideoStreamInfo & { timeBase: number }) | null>();
}

export function withVideoFormat(eb: ExpressionBuilder<DB, 'asset' | 'asset_video'>) {
  return jsonObjectFrom(
    eb
      .selectFrom(dummy)
      .select(['asset_video.formatName', 'asset_video.formatLongName', 'asset.duration', 'asset_video.bitrate'])
      .where('asset_video.assetId', 'is not', sql.lit(null)),
  ).$castTo<VideoFormat | null>();
}

export function withVideoPackets(eb: ExpressionBuilder<DB, 'asset' | 'asset_keyframe'>) {
  return jsonObjectFrom(
    eb
      .selectFrom(dummy)
      .where('asset_keyframe.assetId', 'is not', sql.lit(null))
      .select([
        'asset_keyframe.pts as keyframePts',
        'asset_keyframe.accDuration as keyframeAccDuration',
        'asset_keyframe.ownDuration as keyframeOwnDuration',
        'asset_keyframe.totalDuration',
        'asset_keyframe.packetCount',
        'asset_keyframe.outputFrames',
      ]),
  ).$castTo<VideoPacketInfo | null>();
}

export function withSmartSearch<O>(qb: SelectQueryBuilder<DB, 'asset', O>) {
  return qb
    .leftJoin('smart_search', 'asset.id', 'smart_search.assetId')
    .select((eb) => jsonObjectFrom(eb.table('smart_search')).as('smartSearch'));
}

export function withFaces(eb: ExpressionBuilder<DB, 'asset'>, withHidden?: boolean, withDeletedFace?: boolean) {
  return jsonArrayFrom(
    eb
      .selectFrom('asset_face')
      .selectAll('asset_face')
      .whereRef('asset_face.assetId', '=', 'asset.id')
      .$if(!withDeletedFace, (qb) => qb.where('asset_face.deletedAt', 'is', null))
      .$if(!withHidden, (qb) => qb.where('asset_face.isVisible', '=', true)),
  ).as('faces');
}

export function withFiles(eb: ExpressionBuilder<DB, 'asset'>, type?: AssetFileType) {
  return jsonArrayFrom(
    eb
      .selectFrom('asset_file')
      .select(columns.assetFiles)
      .whereRef('asset_file.assetId', '=', 'asset.id')
      .$if(!!type, (qb) => qb.where('asset_file.type', '=', type!)),
  ).as('files');
}

export function withFilePath(eb: ExpressionBuilder<DB, 'asset'>, type: AssetFileType, isEdited = false) {
  return eb
    .selectFrom('asset_file')
    .select('asset_file.path')
    .whereRef('asset_file.assetId', '=', 'asset.id')
    .where('asset_file.type', '=', sql.lit(type))
    .where('asset_file.isEdited', '=', sql.lit(isEdited));
}

export type WithFacesAndPeopleOptions = {
  /** whose version of the person to select */
  viewingUserId?: string;
  withHidden?: boolean;
  withDeletedFace?: boolean;
};

export function withFacesAndPeople({ viewingUserId, withHidden, withDeletedFace }: WithFacesAndPeopleOptions) {
  return (eb: ExpressionBuilder<DB, 'asset'>) =>
    jsonArrayFrom(
      eb
        .selectFrom('asset_face')
        .leftJoinLateral(
          (eb) =>
            eb
              .selectFrom('person')
              .selectAll('person')
              .whereRef('person.personGroupId', '=', 'asset_face.personGroupId')
              // Same reasoning as PersonRepository's `withPerson`: upstream hard-filters to the viewer's
              // own row because every member of a cluster group has one. Under Option M the group holds a
              // single row — the asset owner's — so filtering by viewer returns nothing for a shared-album
              // recipient or Space member and the asset's people come back empty. Prefer the viewer's row,
              // fall back to the owner's, and take one.
              .orderBy(
                viewingUserId
                  ? sql`case when "person"."ownerId" = ${viewingUserId} then 0 when "person"."ownerId" = "asset"."ownerId" then 1 else 2 end`
                  : sql`case when "person"."ownerId" = "asset"."ownerId" then 0 else 1 end`,
              )
              .limit(1)
              .as('person'),
          (join) => join.onTrue(),
        )
        .selectAll('asset_face')
        .select((eb) => eb.table('person').$castTo<ShallowDehydrateObject<Person>>().as('person'))
        .whereRef('asset_face.assetId', '=', 'asset.id')
        .$if(!withDeletedFace, (qb) => qb.where('asset_face.deletedAt', 'is', null))
        .$if(!withHidden, (qb) => qb.where('asset_face.isVisible', 'is', true)),
    ).as('faces');
}

export function hasPeople<O>(qb: SelectQueryBuilder<DB, 'asset', O>, personGroupIds: string[]) {
  const ids = uniqueTruthyIds(personGroupIds);
  if (ids.length === 0) {
    return qb;
  }

  return qb.innerJoin(
    (eb) =>
      eb
        .selectFrom('asset_face')
        .select('assetId')
        .where('personGroupId', '=', anyUuid(ids))
        .where('deletedAt', 'is', null)
        .where('isVisible', 'is', true)
        .groupBy('assetId')
        .having((eb) => eb.fn.count('personGroupId').distinct(), '=', ids.length)
        .as('has_people'),
    (join) => join.onRef('has_people.assetId', '=', 'asset.id'),
  );
}

export function inSharedAlbum(eb: ExpressionBuilder<DB, 'asset'>, userId: string) {
  return eb.exists(
    eb
      .selectFrom('album_asset')
      .select(sql.lit(1).as('exists'))
      .innerJoin('album', (join) =>
        join.onRef('album.id', '=', 'album_asset.albumId').on('album.deletedAt', 'is', null),
      )
      .innerJoin('album_user', (join) =>
        join.onRef('album_user.albumId', '=', 'album.id').on('album_user.userId', '=', asUuid(userId)),
      )
      .whereRef('album_asset.assetId', '=', 'asset.id'),
  );
}

export function hasAnyPerson<O>(qb: SelectQueryBuilder<DB, 'asset', O>, personIds: string[]) {
  const ids = uniqueTruthyIds(personIds);
  if (ids.length === 0) {
    return qb;
  }

  return qb.innerJoin(
    (eb) =>
      eb
        .selectFrom('asset_face')
        .select('assetId')
        .where('personGroupId', '=', anyUuid(ids))
        .where('deletedAt', 'is', null)
        .where('isVisible', 'is', true)
        .groupBy('assetId')
        .as('has_any_person'),
    (join) => join.onRef('has_any_person.assetId', '=', 'asset.id'),
  );
}

export function hasFaceIdentities<O>(qb: SelectQueryBuilder<DB, 'asset', O>, identityIds: string[]) {
  const ids = uniqueTruthyIds(identityIds);
  if (ids.length === 0) {
    return qb;
  }

  return qb.innerJoin(
    (eb) =>
      eb
        .selectFrom('asset_face')
        .innerJoin('face_identity_face', 'face_identity_face.assetFaceId', 'asset_face.id')
        .select('asset_face.assetId')
        .where('face_identity_face.identityId', '=', anyUuid(ids))
        .where('asset_face.deletedAt', 'is', null)
        .where('asset_face.isVisible', 'is', true)
        .groupBy('asset_face.assetId')
        .having((eb) => eb.fn.count('face_identity_face.identityId').distinct(), '=', ids.length)
        .as('has_face_identities'),
    (join) => join.onRef('has_face_identities.assetId', '=', 'asset.id'),
  );
}

export function hasAnyFaceIdentity<O>(qb: SelectQueryBuilder<DB, 'asset', O>, identityIds: string[]) {
  const ids = uniqueTruthyIds(identityIds);
  if (ids.length === 0) {
    return qb;
  }

  return qb.innerJoin(
    (eb) =>
      eb
        .selectFrom('asset_face')
        .innerJoin('face_identity_face', 'face_identity_face.assetFaceId', 'asset_face.id')
        .select('asset_face.assetId')
        .where('face_identity_face.identityId', '=', anyUuid(ids))
        .where('asset_face.deletedAt', 'is', null)
        .where('asset_face.isVisible', 'is', true)
        .groupBy('asset_face.assetId')
        .as('has_any_face_identity'),
    (join) => join.onRef('has_any_face_identity.assetId', '=', 'asset.id'),
  );
}

export function hasSpacePerson<O>(qb: SelectQueryBuilder<DB, 'asset', O>, spacePersonId: string) {
  return qb.where((eb) =>
    eb.exists(
      eb
        .selectFrom('shared_space_person_face')
        .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
        .whereRef('asset_face.assetId', '=', 'asset.id')
        .where('asset_face.deletedAt', 'is', null)
        .where('asset_face.isVisible', 'is', true)
        .where('shared_space_person_face.personId', '=', asUuid(spacePersonId)),
    ),
  );
}

export function hasAnySpacePerson<O>(qb: SelectQueryBuilder<DB, 'asset', O>, spacePersonIds: string[]) {
  const ids = uniqueTruthyIds(spacePersonIds);
  if (ids.length === 0) {
    return qb;
  }

  return qb.where((eb) =>
    eb.exists(
      eb
        .selectFrom('shared_space_person_face')
        .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
        .whereRef('asset_face.assetId', '=', 'asset.id')
        .where('asset_face.deletedAt', 'is', null)
        .where('asset_face.isVisible', 'is', true)
        .where('shared_space_person_face.personId', '=', anyUuid(ids)),
    ),
  );
}

export function hasSpacePeople<O>(qb: SelectQueryBuilder<DB, 'asset', O>, spacePersonIds: string[]) {
  const ids = uniqueTruthyIds(spacePersonIds);
  if (ids.length === 0) {
    return qb;
  }

  return qb.where((eb) =>
    eb.and(
      ids.map((spacePersonId) =>
        eb.exists(
          eb
            .selectFrom('shared_space_person_face')
            .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('shared_space_person_face.personId', '=', asUuid(spacePersonId)),
        ),
      ),
    ),
  );
}

type PeopleFilterIds = { personIds?: string[]; identityIds?: string[]; spacePersonIds?: string[] };

export function hasAllPeople<O>(qb: SelectQueryBuilder<DB, 'asset', O>, filters: PeopleFilterIds) {
  const personIds = uniqueTruthyIds(filters.personIds);
  const identityIds = uniqueTruthyIds(filters.identityIds);
  const spacePersonIds = uniqueTruthyIds(filters.spacePersonIds);

  return qb
    .$if(personIds.length > 0, (qb) => hasPeople(qb, personIds))
    .$if(identityIds.length > 0, (qb) => hasFaceIdentities(qb, identityIds))
    .$if(spacePersonIds.length > 0, (qb) => hasSpacePeople(qb, spacePersonIds));
}

export function hasAnyPeople<O>(qb: SelectQueryBuilder<DB, 'asset', O>, filters: PeopleFilterIds) {
  const personIds = uniqueTruthyIds(filters.personIds);
  const identityIds = uniqueTruthyIds(filters.identityIds);
  const spacePersonIds = uniqueTruthyIds(filters.spacePersonIds);

  if (personIds.length === 0 && identityIds.length === 0 && spacePersonIds.length === 0) {
    return qb;
  }

  return qb.where((eb) => {
    const predicates: Expression<SqlBool>[] = [];

    if (personIds.length > 0) {
      predicates.push(
        eb.exists(
          eb
            .selectFrom('asset_face')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('asset_face.personGroupId', '=', anyUuid(personIds)),
        ),
      );
    }

    if (identityIds.length > 0) {
      predicates.push(
        eb.exists(
          eb
            .selectFrom('asset_face')
            .innerJoin('face_identity_face', 'face_identity_face.assetFaceId', 'asset_face.id')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('face_identity_face.identityId', '=', anyUuid(identityIds)),
        ),
      );
    }

    if (spacePersonIds.length > 0) {
      predicates.push(
        eb.exists(
          eb
            .selectFrom('shared_space_person_face')
            .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('shared_space_person_face.personId', '=', anyUuid(spacePersonIds)),
        ),
      );
    }

    return eb.or(predicates);
  });
}

export function inAlbums<O>(
  qb: SelectQueryBuilder<DB, 'asset', O>,
  albumIds: string[],
  // #764: when the viewer has live member-spaces (timelineSpaceIds, resolved from
  // getSpaceIdsForTimeline), cross-owner contributions (`album_space_asset`) tethered to one of those
  // spaces count as album membership too. Gating on timelineSpaceIds — not raw album membership — is
  // the live-membership check: an album owner who has LEFT the space passes AlbumRead on their own
  // album but has no timelineSpaceId for it, so contributions are excluded (no permanent-grant leak).
  timelineSpaceIds?: string[],
) {
  const includeContributions = !!timelineSpaceIds && timelineSpaceIds.length > 0;
  return qb.innerJoin(
    (eb) =>
      eb
        .selectFrom((inner) => {
          const albumAssetMembers = inner
            .selectFrom('album_asset')
            .select(['album_asset.assetId as assetId', 'album_asset.albumId as albumId'])
            .where('album_asset.albumId', '=', anyUuid(albumIds!));
          return (
            includeContributions
              ? albumAssetMembers.unionAll(
                  inner
                    .selectFrom('album_space_asset')
                    .select(['album_space_asset.assetId as assetId', 'album_space_asset.albumId as albumId'])
                    .where('album_space_asset.albumId', '=', anyUuid(albumIds!))
                    .where('album_space_asset.spaceId', '=', anyUuid(timelineSpaceIds!))
                    // Task 9 (D1-b residue): timelineSpaceIds only proves the searcher has a live SPACE
                    // membership — it does not prove this album is still LINKED to that space. A
                    // contribution row survives an unlink (D1-b tombstoning applies to other read arms,
                    // not this row), so without this gate a live member searching with an album filter
                    // still matched a retained contribution of an UNLINKED album, which then 403s on
                    // thumbnail (checkAccess routes through the live-link-gated spaceContributedAssetExists).
                    // Mirrors contributionVisibleToMember (sync.repository.ts) / spaceContributedAssetExists
                    // (shared-space-album-scope.ts): require a live shared_space_album correlated on BOTH
                    // albumId AND spaceId.
                    .where((wb) =>
                      wb.exists(
                        wb
                          .selectFrom('shared_space_album')
                          .whereRef('shared_space_album.albumId', '=', 'album_space_asset.albumId')
                          .whereRef('shared_space_album.spaceId', '=', 'album_space_asset.spaceId')
                          .select(wb.lit(1).as('one')),
                      ),
                    ),
                )
              : albumAssetMembers
          ).as('album_members');
        })
        .select('album_members.assetId')
        .groupBy('album_members.assetId')
        .having((eb) => eb.fn.count('album_members.albumId').distinct(), '=', albumIds.length)
        .as('has_album'),
    (join) => join.onRef('has_album.assetId', '=', 'asset.id'),
  );
}

export function hasTags<O>(qb: SelectQueryBuilder<DB, 'asset', O>, tagIds: string[]) {
  return qb.innerJoin(
    (eb) =>
      eb
        .selectFrom('tag_asset')
        .select('assetId')
        .innerJoin('tag_closure', 'tag_asset.tagId', 'tag_closure.id_descendant')
        .where('tag_closure.id_ancestor', '=', anyUuid(tagIds))
        .groupBy('assetId')
        .having((eb) => eb.fn.count('tag_closure.id_ancestor').distinct(), '>=', tagIds.length)
        .as('has_tags'),
    (join) => join.onRef('has_tags.assetId', '=', 'asset.id'),
  );
}

export function withOwner(eb: ExpressionBuilder<DB, 'asset'>) {
  return jsonObjectFrom(eb.selectFrom('user').select(columns.user).whereRef('user.id', '=', 'asset.ownerId')).as(
    'owner',
  );
}

export function withLibrary(eb: ExpressionBuilder<DB, 'asset'>) {
  return jsonObjectFrom(
    eb.selectFrom('library').selectAll('library').whereRef('library.id', '=', 'asset.libraryId'),
  ).as('library');
}

export function withTags(eb: ExpressionBuilder<DB, 'asset'>) {
  return jsonArrayFrom(
    eb
      .selectFrom('tag')
      .select(columns.tag)
      .innerJoin('tag_asset', 'tag.id', 'tag_asset.tagId')
      .whereRef('asset.id', '=', 'tag_asset.assetId'),
  ).as('tags');
}

export function truncatedDate<O>(
  order: AssetOrderBy = AssetOrderBy.TakenAt,
  bucketSize: TimeBucketSize = TimeBucketSize.Month,
) {
  return sql<O>`date_trunc(${sql.lit(dateTruncUnitForTimeBucketSize(bucketSize))}, ${sql.ref(order === AssetOrderBy.CreatedAt ? 'asset.createdAt' : 'localDateTime')} AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
}

export function withTagId<O>(qb: SelectQueryBuilder<DB, 'asset', O>, tagId: string) {
  return qb.where((eb) =>
    eb.exists(
      eb
        .selectFrom('tag_closure')
        .innerJoin('tag_asset', 'tag_asset.tagId', 'tag_closure.id_descendant')
        .whereRef('tag_asset.assetId', '=', 'asset.id')
        .where('tag_closure.id_ancestor', '=', tagId),
    ),
  );
}

export function withAnyTagId<O>(qb: SelectQueryBuilder<DB, 'asset', O>, tagIds: string[]) {
  return qb.where((eb) =>
    eb.exists(
      eb
        .selectFrom('tag_closure')
        .innerJoin('tag_asset', 'tag_asset.tagId', 'tag_closure.id_descendant')
        .whereRef('tag_asset.assetId', '=', 'asset.id')
        .where('tag_closure.id_ancestor', '=', anyUuid(tagIds)),
    ),
  );
}

const isCJK = (c: number): boolean =>
  (c >= 0x4e_00 && c <= 0x9f_ff) ||
  (c >= 0xac_00 && c <= 0xd7_af) ||
  (c >= 0x30_40 && c <= 0x30_9f) ||
  (c >= 0x30_a0 && c <= 0x30_ff) ||
  (c >= 0x34_00 && c <= 0x4d_bf);

export const tokenizeForSearch = (text: string): string[] => {
  const MAX_SEARCH_LENGTH = 1000;
  const len = Math.min(text.length, MAX_SEARCH_LENGTH);
  /* eslint-disable unicorn/prefer-code-point */
  const tokens: string[] = [];
  let i = 0;
  while (i < len) {
    const c = text.charCodeAt(i);
    if (c <= 32) {
      i++;
      continue;
    }

    const start = i;
    if (isCJK(c)) {
      while (i < len && isCJK(text.charCodeAt(i))) {
        i++;
      }
      if (i - start === 1) {
        tokens.push(text[start]);
      } else {
        for (let k = start; k < i - 1; k++) {
          tokens.push(text[k] + text[k + 1]);
        }
      }
    } else {
      while (i < len && text.charCodeAt(i) > 32 && !isCJK(text.charCodeAt(i))) {
        i++;
      }
      tokens.push(text.slice(start, i));
    }
  }
  return tokens;
};

// needed to properly type the return with the EditActionItem discriminated union type
type AliasedEditActions = AliasedRawBuilder<AssetEditActionItem[], 'edits'>;
export function withEdits(eb: ExpressionBuilder<DB, 'asset'>): AliasedEditActions {
  return jsonArrayFrom(
    eb
      .selectFrom('asset_edit')
      .select(['asset_edit.action', 'asset_edit.parameters'])
      .whereRef('asset_edit.assetId', '=', 'asset.id'),
  ).as('edits') as AliasedEditActions;
}

/**
 * Fork RBAC gate for album-scoped search. Upstream (immich #29352) grants
 * album-scoped searchMetadata access via album.read and leaves userIds unset,
 * which switches off the owner/space scoping in searchAssetBuilder. Re-gate so
 * shared-space content reached through an album is only visible to searchers who
 * can access it via space membership + timeline visibility (timelineSpaceIds).
 * Plain (non-shared-space) album assets stay visible per upstream album access.
 *
 * NOTE (L2 reverted): a Slice-6 change flattened this to a single
 * `spaceVisibilityGate` on the theory that the anti-join + `timelineSpaceIds`
 * re-admission was pure over-restriction vs the album grid. That was WRONG — the
 * `timelineSpaceIds`/showInTimeline gate is LOAD-BEARING: a space member who has
 * hidden a space from their timeline (showInTimeline=false) must not see that
 * space's directly-/library-linked content via album-scoped search or
 * suggestions. Flattening it re-admitted hidden-space content and broke the
 * People-identity RBAC projection tests (`people-identity-rbac.spec.ts`,
 * "album scope excludes ... while the space is hidden from timeline"). Restored
 * the anti-join + timelineSpaceIds arms; H1's `deletedAt IS NULL` (trashed
 * exclusion) is kept on every branch.
 */
export function albumSharedSpaceScope<O>(qb: SelectQueryBuilder<DB, 'asset', O>, timelineSpaceIds?: string[]) {
  return qb.where((eb) =>
    eb.or([
      eb.and([
        // Fork RBAC (Slice 1 / security-1): the plain-album branch (assets NOT reached via a
        // direct shared_space_asset / shared_space_library) had no visibility gate, so a Hidden or
        // Locked asset reachable only through a linked album leaked to album searchers. Gate it flat
        // (Archive+Timeline, no owner exception) to match the album grid's withDefaultVisibility.
        spaceVisibilityGate(eb),
        // Fork RBAC (Slice 1 / H1): album-granted search must never surface the owner's trashed
        // assets, even when the caller flips withDeleted via trashedAfter/trashedBefore/isOffline.
        eb('asset.deletedAt', 'is', null),
        eb.not(eb.exists(eb.selectFrom('shared_space_asset').whereRef('shared_space_asset.assetId', '=', 'asset.id'))),
        eb.not(
          eb.exists(
            eb.selectFrom('shared_space_library').whereRef('shared_space_library.libraryId', '=', 'asset.libraryId'),
          ),
        ),
      ]),
      ...(timelineSpaceIds
        ? [
            // Space-linked assets via direct asset membership: gate on Archive + Timeline
            // (matches the album view's withDefaultVisibility; Hidden/Locked must not
            // surface for viewers who are not the asset owner) + not-deleted (H1).
            eb.and([
              spaceVisibilityGate(eb),
              eb('asset.deletedAt', 'is', null),
              eb.exists(
                eb
                  .selectFrom('shared_space_asset')
                  .whereRef('shared_space_asset.assetId', '=', 'asset.id')
                  .where('shared_space_asset.spaceId', '=', anyUuid(timelineSpaceIds)),
              ),
            ]),
            // Space-linked assets via library membership: same Archive + Timeline + not-deleted gate.
            eb.and([
              spaceVisibilityGate(eb),
              eb('asset.deletedAt', 'is', null),
              eb.exists(
                eb
                  .selectFrom('shared_space_library')
                  .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
                  .where('shared_space_library.spaceId', '=', anyUuid(timelineSpaceIds)),
              ),
            ]),
          ]
        : []),
    ]),
  );
}

const joinDeduplicationPlugin = new DeduplicateJoinsPlugin();
/** TODO: This should only be used for search-related queries, not as a general purpose query builder */
// fork's live search path — carries the owner/space RBAC gate. All fork search call-sites use this,
// NOT the dormant V3 searchAssetBuilder below. See the search V3 coexistence spec.
export function searchAssetBuilderLegacy(kysely: Kysely<DB>, options: AssetSearchBuilderOptions) {
  options.withDeleted ||= !!(options.trashedAfter || options.trashedBefore || options.isOffline);

  // Contributor filter (options.ownerId, applied below): a standalone AND on asset.ownerId.
  // Deliberately NOT merged into the options.userIds clauses elsewhere in this chain, which are the
  // owner SCOPING predicate — merging a contributor filter into userIds would widen the result set
  // instead of narrowing it.
  return (
    kysely
      .withPlugin(joinDeduplicationPlugin)
      .selectFrom('asset')
      // Visibility modes (AssetSearchBuilderOptions.visibility):
      //   - a concrete AssetVisibility  -> exactly that state
      //   - 'not-locked'                -> everything except Locked (STILL admits Hidden)
      //   - 'timeline-or-archive'       -> Archive | Timeline, i.e. what the timeline and the album
      //                                    GRID show (withDefaultVisibility, above). Hidden, Locked
      //                                    and Trashed stay out. Added for the album map (D4), which
      //                                    must match the grid it is reached from; no other caller
      //                                    uses it.
      //   - undefined                   -> no clause at all (admits Hidden AND Locked)
      .$if(!!options.visibility, (qb) => {
        switch (options.visibility) {
          case 'not-locked': {
            return qb.where('asset.visibility', '!=', AssetVisibility.Locked);
          }
          case 'timeline-or-archive': {
            return withDefaultVisibility(qb);
          }
          default: {
            return qb.where('asset.visibility', '=', options.visibility!);
          }
        }
      })
      .$if(!!options.forceEmptyResult, (qb) => qb.where(sql<SqlBool>`false`))
      .$if(!!options.albumIds && options.albumIds.length > 0, (qb) =>
        inAlbums(qb, options.albumIds!, options.timelineSpaceIds),
      )
      .$if(!!options.spaceId && !options.timelineSpaceIds, (qb) =>
        qb.where((eb) =>
          eb.and([
            eb.or(
              spaceAssetPathBranches(eb, {
                correlateAssetId: 'asset.id',
                correlateLibraryId: 'asset.libraryId',
                scope: { spaceId: options.spaceId! },
                requireShowInTimeline: true,
              }),
            ),
            // Fork RBAC (M3/Slice 10): elevation only unlocks the CALLER'S OWN locked/archived
            // folder. The caller's own (and partner) rows follow the resolved visibility applied
            // above; every OTHER space member's row is constrained to Archive+Timeline (matching the
            // browse / timeline gate) — Hidden and Locked are never surfaced for other members.
            eb.or([
              ...(options.userIds ? [eb('asset.ownerId', '=', anyUuid(options.userIds))] : []),
              // Fork RBAC (H-1): the other-members branch must ALSO exclude trashed assets, mirroring
              // albumSharedSpaceScope. Without this, a member (incl. a read-only Viewer) can pull another
              // member's trashed asset by flipping withDeleted — directly or implicitly via
              // trashedAfter/trashedBefore/isOffline (see :676) — because the terminal deletedAt filter
              // (:850) is caller-skippable. The ownerId branch stays unfiltered so a caller keeps
              // own/partner trash search.
              eb.and([spaceVisibilityGate(eb), eb('asset.deletedAt', 'is', null)]),
            ]),
          ]),
        ),
      )
      .$if(!!options.timelineSpaceIds && !!options.userIds, (qb) =>
        qb.where((eb) =>
          eb.or([
            // Caller's own (and partner) rows follow the resolved visibility applied above.
            eb('asset.ownerId', '=', anyUuid(options.userIds!)),
            // Other space members' rows are Archive+Timeline (Slice 10 aligns search with browse;
            // elevation is per-owner, Hidden/Locked never surface for other members).
            eb.and([
              spaceVisibilityGate(eb),
              // Fork RBAC (H-1): not-trashed on the other-members branch too (the ownerId branch above is
              // left unfiltered). Mirrors the spaceId arm and albumSharedSpaceScope; never rely on the
              // caller-skippable terminal deletedAt filter (:850).
              eb('asset.deletedAt', 'is', null),
              eb.or(
                spaceAssetPathBranches(eb, {
                  correlateAssetId: 'asset.id',
                  correlateLibraryId: 'asset.libraryId',
                  scope: { spaceIds: options.timelineSpaceIds! },
                  requireShowInTimeline: true,
                }),
              ),
            ]),
          ]),
        ),
      )
      // albumAccessIsBoundary opts an album query OUT of this re-gate for a caller whose album ACCESS
      // check is already the boundary (see the option's doc comment in search.repository.ts, and the
      // call site in shared-space.service.ts getFilteredMapMarkers — issue #656).
      .$if(!!options.albumIds?.length && !options.userIds && !options.albumAccessIsBoundary, (qb) =>
        albumSharedSpaceScope(qb, options.timelineSpaceIds),
      )
      .$if(!!(options.personIds?.length || options.identityIds?.length || options.spacePersonIds?.length), (qb) =>
        options.personMatchAny ? hasAnyPeople(qb, options) : hasAllPeople(qb, options),
      )
      .$if(!!options.tagIds && options.tagIds.length > 0, (qb) =>
        options.tagMatchAny ? withAnyTagId(qb, options.tagIds!) : hasTags(qb, options.tagIds!),
      )
      .$if(options.tagIds === null, (qb) =>
        qb.where((eb) => eb.not(eb.exists((eb) => eb.selectFrom('tag_asset').whereRef('assetId', '=', 'asset.id')))),
      )
      .$if(!!options.createdBefore, (qb) => qb.where('asset.createdAt', '<=', options.createdBefore!))
      .$if(!!options.createdAfter, (qb) => qb.where('asset.createdAt', '>=', options.createdAfter!))
      .$if(!!options.updatedBefore, (qb) => qb.where('asset.updatedAt', '<=', options.updatedBefore!))
      .$if(!!options.updatedAfter, (qb) => qb.where('asset.updatedAt', '>=', options.updatedAfter!))
      .$if(!!options.trashedBefore, (qb) => qb.where('asset.deletedAt', '<=', options.trashedBefore!))
      .$if(!!options.trashedAfter, (qb) => qb.where('asset.deletedAt', '>=', options.trashedAfter!))
      .$if(!!options.takenBefore, (qb) => qb.where('asset.fileCreatedAt', '<=', options.takenBefore!))
      .$if(!!options.takenAfter, (qb) => qb.where('asset.fileCreatedAt', '>=', options.takenAfter!))
      .$if(options.city !== undefined, (qb) =>
        qb
          .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
          .where('asset_exif.city', options.city === null ? 'is' : '=', options.city!),
      )
      .$if(options.state !== undefined, (qb) =>
        qb
          .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
          .where('asset_exif.state', options.state === null ? 'is' : '=', options.state!),
      )
      .$if(options.country !== undefined, (qb) =>
        qb
          .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
          .where('asset_exif.country', options.country === null ? 'is' : '=', options.country!),
      )
      .$if(options.make !== undefined, (qb) =>
        qb
          .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
          .where('asset_exif.make', options.make === null ? 'is' : '=', options.make!),
      )
      .$if(options.model !== undefined, (qb) =>
        qb
          .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
          .where('asset_exif.model', options.model === null ? 'is' : '=', options.model!),
      )
      .$if(options.lensModel !== undefined, (qb) =>
        qb
          .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
          .where('asset_exif.lensModel', options.lensModel === null ? 'is' : '=', options.lensModel!),
      )
      .$if(options.ownerId !== undefined, (qb) => qb.where('asset.ownerId', '=', asUuid(options.ownerId!)))
      .$if(options.rating !== undefined, (qb) =>
        qb
          .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
          .where(
            'asset_exif.rating',
            options.rating === null ? 'is' : options.ratingIsMinimum ? '>=' : '=',
            options.rating!,
          ),
      )
      .$if(!!options.checksum, (qb) => qb.where('asset.checksum', '=', options.checksum!))
      .$if(!!options.id, (qb) => qb.where('asset.id', '=', asUuid(options.id!)))
      .$if(!!options.libraryId, (qb) => qb.where('asset.libraryId', '=', asUuid(options.libraryId!)))
      .$if(!!options.userIds && !options.spaceId && !options.timelineSpaceIds, (qb) =>
        qb.where('asset.ownerId', '=', anyUuid(options.userIds!)),
      )
      .$if(!!options.encodedVideoPath, (qb) =>
        qb
          .innerJoin('asset_file', (join) =>
            join
              .onRef('asset.id', '=', 'asset_file.assetId')
              .on('asset_file.type', '=', AssetFileType.EncodedVideo)
              .on('asset_file.isEdited', '=', false),
          )
          .where('asset_file.path', '=', options.encodedVideoPath!),
      )
      // The three ILIKE text filters escape their wildcards (escapeLikePattern + `escape '\'`), so a
      // filter of `IMG_0001` matches `_` literally rather than as a single-char wildcard and a `%`
      // matches a literal percent sign. This mirrors the time-bucket path (asset.repository.ts): the
      // map and the timeline are driven by the same filter chips and must agree on what they match.
      // Escaping does not cost the trigram index. OCR (below) is unaffected — it uses the `%>>`
      // trigram operator, not ILIKE.
      .$if(!!options.originalPath, (qb) =>
        qb.where(
          sql`f_unaccent(asset."originalPath")`,
          'ilike',
          sql`'%' || f_unaccent(${escapeLikePattern(options.originalPath!)}) || '%' escape '\\'`,
        ),
      )
      .$if(!!options.originalFileName, (qb) =>
        qb.where(
          sql`f_unaccent(asset."originalFileName")`,
          'ilike',
          sql`'%' || f_unaccent(${escapeLikePattern(options.originalFileName!)}) || '%' escape '\\'`,
        ),
      )
      .$if(!!options.description, (qb) =>
        qb
          .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
          .where(
            sql`f_unaccent(asset_exif.description)`,
            'ilike',
            sql`'%' || f_unaccent(${escapeLikePattern(options.description!)}) || '%' escape '\\'`,
          ),
      )
      .$if(!!options.ocr, (qb) =>
        qb
          .innerJoin('ocr_search', 'asset.id', 'ocr_search.assetId')
          .where(() => sql`f_unaccent(ocr_search.text) %>> f_unaccent(${tokenizeForSearch(options.ocr!).join(' ')})`),
      )
      .$if(!!options.type, (qb) => qb.where('asset.type', '=', options.type!))
      .$if(options.isFavorite !== undefined, (qb) => qb.where('asset.isFavorite', '=', options.isFavorite!))
      .$if(options.isOffline !== undefined, (qb) => qb.where('asset.isOffline', '=', options.isOffline!))
      .$if(options.isEncoded !== undefined, (qb) =>
        qb.where((eb) => {
          const exists = eb.exists((eb) =>
            eb
              .selectFrom('asset_file')
              .whereRef('assetId', '=', 'asset.id')
              .where('type', '=', AssetFileType.EncodedVideo),
          );
          return options.isEncoded ? exists : eb.not(exists);
        }),
      )
      .$if(options.isMotion !== undefined, (qb) =>
        qb.where('asset.livePhotoVideoId', options.isMotion ? 'is not' : 'is', null),
      )
      .$if(!!options.isNotInAlbum && (!options.albumIds || options.albumIds.length === 0), (qb) =>
        qb.where((eb) => eb.not(eb.exists((eb) => eb.selectFrom('album_asset').whereRef('assetId', '=', 'asset.id')))),
      )
      .$if(!!options.isInAlbum && (!options.albumIds || options.albumIds.length === 0), (qb) =>
        qb.where((eb) => eb.exists((eb) => eb.selectFrom('album_asset').whereRef('assetId', '=', 'asset.id'))),
      )
      .$if(options.withStacked === false, (qb) => qb.where('asset.stackId', 'is', null))
      .$if(!!options.withExif, withExifInner)
      .$if(!!(options.withFaces || options.withPeople), (qb) =>
        qb.select(withFacesAndPeople({ viewingUserId: options.viewingUserId! })),
      )
      .$if(!options.withDeleted, (qb) => qb.where('asset.deletedAt', 'is', null))
  );
}

type AssetExpressionBuilder = ExpressionBuilder<DB, 'asset' | 'asset_exif'>;

const albumAssets = (eb: AssetExpressionBuilder) =>
  eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id');

const visibleFaces = (eb: AssetExpressionBuilder) =>
  eb
    .selectFrom('asset_face')
    .whereRef('asset_face.assetId', '=', 'asset.id')
    .where('asset_face.deletedAt', 'is', null)
    .where('asset_face.isVisible', '=', true);

const tagAssets = (eb: AssetExpressionBuilder) =>
  eb.selectFrom('tag_asset').whereRef('tag_asset.assetId', '=', 'asset.id');

// shared any/all/none mechanics; `matchesAll` only receives deduplicated multi-id lists,
// so its `count(distinct id) = ids.length` check stays satisfiable
function idsPredicates(
  eb: AssetExpressionBuilder,
  { any, all, none }: IdsFilter = {},
  ops: {
    matchesAny: (ids: string[]) => Expression<SqlBool>;
    matchesAll: (ids: string[]) => Expression<SqlBool>;
  },
) {
  const predicates: Expression<SqlBool>[] = [];
  if (any) {
    predicates.push(ops.matchesAny(any));
  }
  if (all) {
    const ids = uniqueIds(all);
    predicates.push(ids.length === 1 ? ops.matchesAny(ids) : ops.matchesAll(ids));
  }
  if (none) {
    predicates.push(eb.not(ops.matchesAny(none)));
  }
  return predicates;
}

function albumIdsPredicates(eb: AssetExpressionBuilder, filter?: IdsFilter) {
  const matching = (ids: string[]) => albumAssets(eb).where('album_asset.albumId', '=', anyUuid(ids));
  return idsPredicates(eb, filter, {
    matchesAny: (ids) => eb.exists(matching(ids)),
    matchesAll: (ids) =>
      eb.exists(
        matching(ids)
          .select('album_asset.assetId')
          .groupBy('album_asset.assetId')
          .having((eb) => eb.fn.count('album_asset.albumId').distinct(), '=', ids.length),
      ),
  });
}

function personIdsPredicates(eb: AssetExpressionBuilder, filter?: IdsFilter) {
  const matching = (ids: string[]) => visibleFaces(eb).where('asset_face.personGroupId', '=', anyUuid(ids));
  return idsPredicates(eb, filter, {
    matchesAny: (ids) => eb.exists(matching(ids)),
    matchesAll: (ids) =>
      eb.exists(
        matching(ids)
          .select('asset_face.assetId')
          .groupBy('asset_face.assetId')
          .having((eb) => eb.fn.count('asset_face.personGroupId').distinct(), '=', ids.length),
      ),
  });
}

function tagIdsPredicates(eb: AssetExpressionBuilder, filter?: IdsFilter) {
  const matching = (ids: string[]) =>
    tagAssets(eb)
      .innerJoin('tag_closure', 'tag_asset.tagId', 'tag_closure.id_descendant')
      .where('tag_closure.id_ancestor', '=', anyUuid(ids));
  return idsPredicates(eb, filter, {
    matchesAny: (ids) => eb.exists(matching(ids)),
    matchesAll: (ids) =>
      eb.exists(
        matching(ids)
          .select('tag_asset.assetId')
          .groupBy('tag_asset.assetId')
          .having((eb) => eb.fn.count('tag_closure.id_ancestor').distinct(), '=', ids.length),
      ),
  });
}

type ComparisonFilter<T> = {
  eq?: T | null;
  ne?: T | null;
  lt?: T;
  lte?: T;
  gt?: T;
  gte?: T;
  in?: T[];
  notIn?: T[];
};

// one operator dispatch for every filter shape; the DTO schemas constrain which
// operators (and null literals) each filter can actually carry
function comparisonPredicates<TB extends keyof DB, RE extends ReferenceExpression<DB, TB>>(
  eb: ExpressionBuilder<DB, TB>,
  column: RE,
  filter: ComparisonFilter<OperandValueExpression<DB, TB, RE>> = {},
) {
  const predicates: Expression<SqlBool>[] = [];
  if (filter.eq !== undefined) {
    predicates.push(filter.eq === null ? eb(column, 'is', null) : eb(column, '=', filter.eq));
  }
  if (filter.ne !== undefined) {
    predicates.push(filter.ne === null ? eb(column, 'is not', null) : eb(column, '!=', filter.ne));
  }
  if (filter.lt !== undefined) {
    predicates.push(eb(column, '<', filter.lt));
  }
  if (filter.lte !== undefined) {
    predicates.push(eb(column, '<=', filter.lte));
  }
  if (filter.gt !== undefined) {
    predicates.push(eb(column, '>', filter.gt));
  }
  if (filter.gte !== undefined) {
    predicates.push(eb(column, '>=', filter.gte));
  }
  if (filter.in !== undefined) {
    predicates.push(eb(column, 'in', filter.in));
  }
  if (filter.notIn !== undefined) {
    predicates.push(eb(column, 'not in', filter.notIn));
  }
  return predicates;
}

type StringColumn =
  | 'asset_exif.city'
  | 'asset_exif.state'
  | 'asset_exif.country'
  | 'asset_exif.make'
  | 'asset_exif.model'
  | 'asset_exif.lensModel'
  | 'asset_exif.description'
  | 'asset.originalFileName'
  | 'asset.originalPath';

function stringPatternPredicates(eb: AssetExpressionBuilder, column: StringColumn, filter: StringPatternFilter = {}) {
  const ref = sql.ref(column);
  const predicates = comparisonPredicates(eb, column, filter);
  if (filter.like !== undefined) {
    predicates.push(sql<SqlBool>`f_unaccent(${ref}) ilike ('%' || f_unaccent(${filter.like}) || '%')`);
  }
  if (filter.notLike !== undefined) {
    predicates.push(sql<SqlBool>`f_unaccent(${ref}) not ilike ('%' || f_unaccent(${filter.notLike}) || '%')`);
  }
  if (filter.startsWith !== undefined) {
    predicates.push(sql<SqlBool>`f_unaccent(${ref}) ilike (f_unaccent(${filter.startsWith}) || '%')`);
  }
  if (filter.endsWith !== undefined) {
    predicates.push(sql<SqlBool>`f_unaccent(${ref}) ilike ('%' || f_unaccent(${filter.endsWith}))`);
  }
  return predicates;
}

function checksumPredicates(eb: AssetExpressionBuilder, filter: StringFilter = {}) {
  return comparisonPredicates(eb, 'asset.checksum', {
    eq: filter.eq === undefined ? undefined : fromChecksum(filter.eq),
    ne: filter.ne === undefined ? undefined : fromChecksum(filter.ne),
    in: filter.in?.map((checksum) => fromChecksum(checksum)),
    notIn: filter.notIn?.map((checksum) => fromChecksum(checksum)),
  });
}

const encodedVideoFiles = (eb: AssetExpressionBuilder) =>
  eb
    .selectFrom('asset_file')
    .whereRef('asset_file.assetId', '=', 'asset.id')
    .where('asset_file.type', '=', AssetFileType.EncodedVideo);

function existsPredicates(
  eb: AssetExpressionBuilder,
  filter: { eq: boolean } | undefined,
  subquery: () => Expression<unknown>,
): Expression<SqlBool>[] {
  if (!filter) {
    return [];
  }
  const exists = eb.exists(subquery());
  return [filter.eq ? exists : eb.not(exists)];
}

// predicates are collected as expressions rather than chained `where` calls so the same
// helpers can build each `or` branch, which must compose into eb.and/eb.or
function branchPredicates(eb: AssetExpressionBuilder, branch: SearchFilterBranch) {
  const { encodedVideoPath } = branch;
  return [
    ...comparisonPredicates(eb, 'asset.id', branch.id),
    ...comparisonPredicates(eb, 'asset.libraryId', branch.libraryId),
    ...comparisonPredicates(eb, 'asset.type', branch.type),
    ...comparisonPredicates(eb, 'asset.visibility', branch.visibility),
    ...(branch.isFavorite ? [eb('asset.isFavorite', '=', branch.isFavorite.eq)] : []),
    ...(branch.isOffline ? [eb('asset.isOffline', '=', branch.isOffline.eq)] : []),
    ...(branch.isMotion ? [eb('asset.livePhotoVideoId', branch.isMotion.eq ? 'is not' : 'is', null)] : []),
    ...existsPredicates(eb, branch.isEncoded, () => encodedVideoFiles(eb)),
    ...existsPredicates(eb, branch.hasAlbums, () => albumAssets(eb)),
    ...existsPredicates(eb, branch.hasPeople, () => visibleFaces(eb)),
    ...existsPredicates(eb, branch.hasTags, () => tagAssets(eb)),
    ...comparisonPredicates(eb, 'asset_exif.city', branch.city),
    ...comparisonPredicates(eb, 'asset_exif.state', branch.state),
    ...comparisonPredicates(eb, 'asset_exif.country', branch.country),
    ...comparisonPredicates(eb, 'asset_exif.make', branch.make),
    ...comparisonPredicates(eb, 'asset_exif.model', branch.model),
    ...comparisonPredicates(eb, 'asset_exif.lensModel', branch.lensModel),
    ...stringPatternPredicates(eb, 'asset_exif.description', branch.description),
    ...stringPatternPredicates(eb, 'asset.originalFileName', branch.originalFileName),
    ...stringPatternPredicates(eb, 'asset.originalPath', branch.originalPath),
    ...(branch.ocr
      ? [
          eb.exists(
            eb
              .selectFrom('ocr_search')
              .whereRef('ocr_search.assetId', '=', 'asset.id')
              .where(
                sql<SqlBool>`f_unaccent(ocr_search.text) %>> f_unaccent(${tokenizeForSearch(branch.ocr.matches).join(' ')})`,
              ),
          ),
        ]
      : []),
    ...comparisonPredicates(eb, 'asset_exif.rating', branch.rating),
    ...comparisonPredicates(eb, 'asset_exif.fileSizeInByte', branch.fileSizeInBytes),
    ...comparisonPredicates(eb, 'asset.fileCreatedAt', branch.takenAt),
    ...comparisonPredicates(eb, 'asset.createdAt', branch.createdAt),
    ...comparisonPredicates(eb, 'asset.updatedAt', branch.updatedAt),
    ...comparisonPredicates(eb, 'asset.deletedAt', branch.trashedAt),
    ...albumIdsPredicates(eb, branch.albumIds),
    ...personIdsPredicates(eb, branch.personIds),
    ...tagIdsPredicates(eb, branch.tagIds),
    ...checksumPredicates(eb, branch.checksum),
    ...(encodedVideoPath
      ? [
          eb.exists(
            encodedVideoFiles(eb)
              .where('asset_file.isEdited', '=', false)
              .where((eb) => eb.and(comparisonPredicates(eb, 'asset_file.path', encodedVideoPath))),
          ),
        ]
      : []),
  ];
}

// ─── UPSTREAM SEARCH V3 — DORMANT ───────────────────────────────
// Not wired to any controller/service. The fork's live search uses searchAssetBuilderLegacy
// (above), which carries the owner/space RBAC gate. Do not call this V3 builder from fork code.
// Switch-over plan: docs/superpowers/specs/2026-07-23-search-v3-coexistence-design.md
//
// ordering is deliberately left to the caller so aggregate-only consumers (counts, stats)
// can compose the same filters without stripping an order by
export function searchAssetBuilder(kysely: Kysely<DB>, options: AssetSearchBuilderV3Options, scope: AssetSearchScope) {
  const filter = options.filter ?? {};
  const branches = filter.or ?? [];
  const ownershipPredicate = (eb: AssetExpressionBuilder) => eb('asset.ownerId', '=', anyUuid(scope.userIds));
  // search universe: own+partner assets unless album-confined, which searches the albums instead;
  // ownership lands nowhere (top level confined), per unconfined branch, or hoisted globally
  const topConfined = isAlbumConfined(filter);
  const anyBranchConfined = branches.some((branch) => isAlbumConfined(branch));
  const scopePerBranch = !topConfined && anyBranchConfined;
  const scopeGlobally = !topConfined && !anyBranchConfined;

  return (
    kysely
      .withPlugin(joinDeduplicationPlugin)
      .selectFrom('asset')
      // postgres eliminates the left join when no exif column is referenced, so unused joins are free
      .leftJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
      .$if(!!options.withExif, (qb) => qb.select(selectExifInfo))
      .$if(scopeGlobally, (qb) => qb.where(ownershipPredicate))
      .where((eb) =>
        eb.or([eb('asset.visibility', '!=', AssetVisibility.Locked), eb('asset.ownerId', '=', scope.lockedOwnerId)]),
      )
      .$if(!!(options.withFaces || options.withPeople), (qb) =>
        qb.select(withFacesAndPeople({ viewingUserId: scope.viewingUserId! })),
      )
      .$if(options.withStacked === false, (qb) => qb.where('asset.stackId', 'is', null))
      .where((eb) => {
        const predicates = branchPredicates(eb, filter);
        if (branches.length > 0) {
          predicates.push(
            eb.or(
              branches.map((branch) =>
                eb.and([
                  ...branchPredicates(eb, branch),
                  ...(scopePerBranch && !isAlbumConfined(branch) ? [ownershipPredicate(eb)] : []),
                ]),
              ),
            ),
          );
        }
        return predicates.length > 0 ? eb.and(predicates) : eb.lit(true);
      })
  );
}

const searchOrderColumns = {
  [SearchOrderField.FileCreatedAt]: { column: 'asset.fileCreatedAt', nullable: false },
  [SearchOrderField.LocalDateTime]: { column: 'asset.localDateTime', nullable: false },
  [SearchOrderField.FileSizeInBytes]: { column: 'asset_exif.fileSizeInByte', nullable: true },
  [SearchOrderField.Rating]: { column: 'asset_exif.rating', nullable: true },
} as const;

export function withSearchOrder(qb: ReturnType<typeof searchAssetBuilder>, order?: SearchOrder) {
  const { field, direction } = order ?? DEFAULT_SEARCH_ORDER;
  const { column, nullable } = searchOrderColumns[field];
  return (
    qb
      .orderBy(column, (ob) => {
        const ordered = direction === AssetOrder.Asc ? ob.asc() : ob.desc();
        // nulls last: assets without an asset_exif row would otherwise lead descending results
        return nullable ? ordered.nullsLast() : ordered;
      })
      // id tie-break for deterministic pagination
      .orderBy('asset.id', direction)
  );
}

const scopeExample: AssetSearchScope = { userIds: [DummyValue.UUID], lockedOwnerId: DummyValue.UUID };

export const searchMetadataV3Examples: GenerateSqlQueries[] = [
  { name: 'baseline', params: [{ take: 100 }, {}, scopeExample] },
  {
    name: 'or-mixed-scope',
    params: [
      { take: 100 },
      {
        filter: { or: [{ albumIds: { any: [DummyValue.UUID] } }, { city: { eq: DummyValue.STRING } }] },
      },
      scopeExample,
    ],
  },
  {
    name: 'or-exif-only',
    params: [
      { take: 100 },
      {
        filter: { or: [{ city: { eq: DummyValue.STRING } }] },
      },
      scopeExample,
    ],
  },
  {
    name: 'string-eq-null',
    params: [{ take: 100 }, { filter: { city: { eq: null } } }, scopeExample],
  },
  {
    name: 'string-pattern-like',
    params: [
      { take: 100 },
      {
        filter: { description: { like: DummyValue.STRING } },
      },
      scopeExample,
    ],
  },
  {
    name: 'string-pattern-notLike',
    params: [
      { take: 100 },
      {
        filter: { description: { notLike: DummyValue.STRING } },
      },
      scopeExample,
    ],
  },
  {
    name: 'string-pattern-startsWith',
    params: [
      { take: 100 },
      {
        filter: { originalFileName: { startsWith: DummyValue.STRING } },
      },
      scopeExample,
    ],
  },
  {
    name: 'string-similarity-ocr',
    params: [{ take: 100 }, { filter: { ocr: { matches: DummyValue.STRING } } }, scopeExample],
  },
  {
    name: 'ids-any',
    params: [{ take: 100 }, { filter: { albumIds: { any: [DummyValue.UUID] } } }, scopeExample],
  },
  {
    name: 'ids-all',
    params: [
      { take: 100 },
      {
        filter: { personIds: { all: [DummyValue.UUID, DummyValue.UUID_1] } },
      },
      scopeExample,
    ],
  },
  {
    name: 'ids-all-single',
    params: [{ take: 100 }, { filter: { albumIds: { all: [DummyValue.UUID] } } }, scopeExample],
  },
  {
    name: 'ids-none',
    params: [{ take: 100 }, { filter: { tagIds: { none: [DummyValue.UUID] } } }, scopeExample],
  },
  {
    name: 'ids-tags-all',
    params: [
      { take: 100 },
      {
        filter: { tagIds: { all: [DummyValue.UUID, DummyValue.UUID_1] } },
      },
      scopeExample,
    ],
  },
  {
    name: 'has-albums-false',
    params: [{ take: 100 }, { filter: { hasAlbums: { eq: false } } }, scopeExample],
  },
  {
    name: 'is-encoded',
    params: [{ take: 100 }, { filter: { isEncoded: { eq: true } } }, scopeExample],
  },
  {
    name: 'number-range',
    params: [
      { take: 100 },
      {
        filter: { fileSizeInBytes: { gte: 100, lte: 1000 } },
      },
      scopeExample,
    ],
  },
  {
    name: 'date-eq',
    params: [{ take: 100 }, { filter: { takenAt: { eq: DummyValue.DATE } } }, scopeExample],
  },
  {
    name: 'date-range',
    params: [
      { take: 100 },
      {
        filter: { takenAt: { gte: DummyValue.DATE, lt: DummyValue.DATE } },
      },
      scopeExample,
    ],
  },
  {
    name: 'order-fileSize-noExif',
    params: [
      { take: 100 },
      {
        order: { field: SearchOrderField.FileSizeInBytes, direction: AssetOrder.Desc },
        withExif: false,
      },
      scopeExample,
    ],
  },
  {
    name: 'order-rating-withExif',
    params: [
      { take: 100 },
      {
        order: { field: SearchOrderField.Rating, direction: AssetOrder.Asc },
        withExif: true,
      },
      scopeExample,
    ],
  },
  {
    name: 'or-branches',
    params: [
      { take: 100 },
      {
        filter: {
          or: [{ isFavorite: { eq: true } }, { personIds: { any: [DummyValue.UUID] } }],
        },
      },
      scopeExample,
    ],
  },
  {
    name: 'or-with-top-level',
    params: [
      { take: 100 },
      {
        filter: {
          takenAt: { gte: DummyValue.DATE, lt: DummyValue.DATE },
          or: [{ isFavorite: { eq: true } }, { albumIds: { any: [DummyValue.UUID] } }],
        },
      },
      scopeExample,
    ],
  },
  {
    name: 'cursor-offset',
    params: [{ take: 100, skip: 100 }, { filter: { isFavorite: { eq: true } } }, scopeExample],
  },
];

export const searchRandomV3Examples: GenerateSqlQueries[] = [
  { name: 'baseline', params: [100, {}, scopeExample] },
  {
    name: 'with-filter',
    params: [100, { filter: { isFavorite: { eq: true } } }, scopeExample],
  },
];

export const searchSmartV3Examples: GenerateSqlQueries[] = [
  {
    name: 'baseline',
    params: [{ take: 100 }, { embedding: DummyValue.VECTOR }, scopeExample],
  },
  {
    name: 'with-filter',
    params: [
      { take: 100 },
      {
        embedding: DummyValue.VECTOR,
        filter: { takenAt: { gte: DummyValue.DATE, lt: DummyValue.DATE } },
      },
      scopeExample,
    ],
  },
  {
    name: 'cursor-offset',
    params: [{ take: 100, skip: 100 }, { embedding: DummyValue.VECTOR }, scopeExample],
  },
];

export const searchStatisticsV3Examples: GenerateSqlQueries[] = [
  { name: 'baseline', params: [{}, scopeExample] },
  {
    name: 'with-filter',
    params: [
      {
        filter: {
          takenAt: { gte: DummyValue.DATE, lt: DummyValue.DATE },
          fileSizeInBytes: { gte: 100 },
        },
      },
      scopeExample,
    ],
  },
  {
    name: 'with-or',
    params: [
      {
        filter: {
          or: [{ isFavorite: { eq: true } }, { hasAlbums: { eq: false } }],
        },
      },
      scopeExample,
    ],
  },
];

export type ReindexVectorIndexOptions = { indexName: string; lists?: number };

type VectorIndexQueryOptions = { table: string; vectorExtension: VectorExtension } & ReindexVectorIndexOptions;

export function vectorIndexQuery({ vectorExtension, table, indexName, lists }: VectorIndexQueryOptions): string {
  switch (vectorExtension) {
    case DatabaseExtension.VectorChord: {
      return `
        CREATE INDEX IF NOT EXISTS ${indexName} ON ${table} USING vchordrq (embedding vector_cosine_ops) WITH (options = $$
        residual_quantization = false
        [build.internal]
        lists = [${lists ?? 1}]
        spherical_centroids = true
        build_threads = 4
        sampling_factor = 1024
        $$)`;
    }
    case DatabaseExtension.Vector: {
      return `
        CREATE INDEX IF NOT EXISTS ${indexName} ON ${table}
        USING hnsw (embedding vector_cosine_ops)
        WITH (ef_construction = 300, m = 16)`;
    }
    default: {
      throw new Error(`Unsupported vector extension: '${vectorExtension}'`);
    }
  }
}

export const updateLockedColumns = <T extends Record<string, unknown> & { lockedProperties?: LockableProperty[] }>(
  exif: T,
) => {
  exif.lockedProperties = lockableProperties.filter((property) => Object.hasOwn(exif, property));
  return exif;
};
