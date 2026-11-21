import { Injectable } from '@nestjs/common';
import { Kysely, Transaction, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetFileType, AssetType, AssetVisibility } from 'src/enum.js';
import { storedPlace } from 'src/gallery/utils/asset-version-names.js';
import { SAME_TIME_LIMIT } from 'src/gallery/utils/asset-version-rules.js';
import { READ_PARSER_VERSION, type FileRead } from 'src/gallery/utils/asset-version-signature.js';
import { restoredState } from 'src/gallery/utils/asset-version-undo.js';
import { DB } from 'src/schema/index.js';
import type { AssetVersionKind } from 'src/schema/tables/asset-version.table.js';
import { asUuid } from 'src/utils/database.js';
import { mimeTypes } from 'src/utils/mime-types.js';

export type PairInput = {
  photoId: string;
  versionId: string;
  kind: AssetVersionKind;
  source: string | null;
  rule: string;
  /** The base photo's own file: what it is, what made it, and what was read from it (its row is made if missing). */
  photo: { kind: AssetVersionKind; source: string | null; read: FileRead | null };
  /** What was read from the file going behind. */
  read: FileRead | null;
};

/** A read of a file, to keep: on its row, if it has one, and as the "read" stamp of the Versions job. */
export type StoredRead = { assetId: string; read: FileRead; kind: AssetVersionKind; source: string | null };

export type PairOutcome = { paired: true; priorVisibility: AssetVisibility } | { paired: false; reason: string };

const SHOWN = [AssetVisibility.Timeline, AssetVisibility.Archive];

/**
The most files one search by name returns. A name normally finds two or three; this only bounds an odd one (a file
called `1.jpg` in a burst). A search that reaches it is not complete, and the job decides nothing on a part.
*/
export const NAME_SEARCH_LIMIT = 50;

/** A file name that ends in a RAW extension, as a case-insensitive pattern, from the list Immich keeps. */
const RAW_EXTENSIONS = mimeTypes
  .getSupportedFileExtensions()
  .filter((extension) => mimeTypes.isRaw(`name${extension}`))
  .map((extension) => extension.slice(1));
const RAW_FILE_NAME = String.raw`\.(${RAW_EXTENSIONS.join('|')})$`;

/** `%` and `_` mean "anything" in a LIKE pattern: a file name is matched as it is written. */
const escapeLike = (name: string) => name.replaceAll(/[\\%_]/g, (char) => `\\${char}`);
const containing = (name: string) => `%${escapeLike(name)}%`;

// Asset versions (specs/2026-11-07-asset-versions-design.md).
@Injectable()
export class AssetVersionRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  async isVersion(id: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('asset_version')
      .select('versionAssetId')
      .where('versionAssetId', '=', asUuid(id))
      .where('role', '=', 'version')
      .executeTakeFirst();
    return !!row;
  }

  /** Whether other files are behind this asset: it is the base photo of a shot. */
  @GenerateSql({ params: [DummyValue.UUID] })
  async hasVersions(id: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('asset_version')
      .select('versionAssetId')
      .where('assetId', '=', asUuid(id))
      .where('role', '=', 'version')
      .limit(1)
      .executeTakeFirst();
    return !!row;
  }

  /**
  Of these assets, the photos whose shot includes an edit: one behind them, or themselves an edit with other files
  behind. Such a photo is left out of duplicate detection (asset-version-duplicates.ts); a camera file with only
  its RAW behind it is not among them.
  */
  @GenerateSql({ params: [[DummyValue.UUID]] })
  async getPhotosWithEdits(ids: string[]): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }
    const { rows } = await sql<{ id: string }>`SELECT "asset"."id" FROM "asset"
WHERE "asset"."id" = ANY(${ids}::uuid[]) AND ${SHOT_HAS_EDIT}`.execute(this.db);
    return rows.map(({ id }) => id);
  }

  /** Takes a photo whose shot includes an edit out of the duplicate group it was in. Writes nothing otherwise. */
  async leaveDuplicates(photoId: string): Promise<void> {
    await sql`UPDATE "asset" SET "duplicateId" = NULL
WHERE "asset"."id" = ${photoId}::uuid AND "asset"."duplicateId" IS NOT NULL AND ${SHOT_HAS_EDIT}`.execute(this.db);
  }

  /** What the detection job needs about the asset it was queued for. */
  @GenerateSql({ params: [DummyValue.UUID] })
  getForDetection(id: string) {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_version as v', 'v.versionAssetId', 'asset.id')
      .select([
        'asset.id',
        'asset.ownerId',
        'asset.libraryId',
        'asset.type',
        'asset.originalPath',
        'asset.originalFileName',
        'asset.localDateTime',
        'asset.deletedAt',
        'v.read',
      ])
      .where('asset.id', '=', asUuid(id))
      .executeTakeFirst();
  }

  /**
  An image with what detection needs about it: its state, whether it is combined already, what hangs on it, and
  what was read from it when it is part of a combined shot (a file that is not has to be read). One row per image.
  Includes files that are behind a photo (hidden), so a new edit finds its RAW.
  */
  private candidates() {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_version as v', 'v.versionAssetId', 'asset.id')
      .select([
        'asset.id',
        'asset.ownerId',
        'asset.libraryId',
        'asset.originalPath',
        'asset.originalFileName',
        'asset.createdAt',
        'asset.checksum',
        'asset.visibility',
        'asset.deletedAt',
        'asset.isOffline',
        'asset.livePhotoVideoId',
        'asset.fileModifiedAt',
        'asset.localDateTime',
        sql<string | null>`case when "v"."role" = 'version' then "v"."assetId" end`.as('versionOf'),
        sql<boolean>`exists (select 1 from "asset_version" "behind" where "behind"."assetId" = "asset"."id" and "behind"."role" = 'version')`.as(
          'hasVersions',
        ),
        sql<boolean>`exists (select 1 from "asset" "still" where "still"."livePhotoVideoId" = "asset"."id")`.as(
          'isMotionPart',
        ),
        // the same keys `attachmentsOf` gives: `pair` checks them again under its lock
        sql<string[]>`array(${attachmentKeys(sql.ref('asset.id'))})`.as('attachments'),
        'v.read',
      ])
      .where('asset.type', '=', AssetType.Image);
  }

  /**
  The owner's images in one library whose name contains one of these names and that were taken between two times.
  The time is the capture time on the camera's clock as Immich stores it for every file (`localDateTime`), so a
  file is found whether detection has read it or not.
  */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, [DummyValue.STRING], DummyValue.DATE, DummyValue.DATE] })
  getCandidatesByName(ownerId: string, libraryId: string | null, names: string[], from: Date, to: Date) {
    return this.candidates()
      .where('asset.deletedAt', 'is', null)
      .where('asset.ownerId', '=', asUuid(ownerId))
      .where((eb) => (libraryId ? eb('asset.libraryId', '=', asUuid(libraryId)) : eb('asset.libraryId', 'is', null)))
      .where('asset.localDateTime', '>=', from)
      .where('asset.localDateTime', '<=', to)
      .where((eb) =>
        eb.or(
          names.map(
            (name) => sql<boolean>`f_unaccent("asset"."originalFileName") ilike f_unaccent(${containing(name)})`,
          ),
        ),
      )
      .orderBy('asset.id')
      .limit(NAME_SEARCH_LIMIT)
      .execute();
  }

  /**
  The owner's images in one library stored in the same folder as this path under the same name, only the extension
  differing (the folder rule, `storedPlace`). No time: a scan and its export have no capture time, and the time
  Immich stores for them is the file's date. First the original name, as the file of this path has it (`stem.*`, in
  Immich's trigram index: the files of one shot came with one name, also where the storage template stored them
  under another); then the stored path itself, exactly, in its own case, and directly in that folder. An upload
  stored under its id matches nothing.
  */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, DummyValue.STRING, DummyValue.STRING] })
  getCandidatesInFolder(ownerId: string, libraryId: string | null, originalPath: string, originalFileName: string) {
    const { folder, stem } = storedPlace(originalPath);
    const originalStem = storedPlace(originalFileName).stem;
    const prefix = `${folder}/${stem}.`;
    return this.candidates()
      .where('asset.deletedAt', 'is', null)
      .where('asset.ownerId', '=', asUuid(ownerId))
      .where((eb) => (libraryId ? eb('asset.libraryId', '=', asUuid(libraryId)) : eb('asset.libraryId', 'is', null)))
      .where(sql<boolean>`f_unaccent("asset"."originalFileName") ilike f_unaccent(${`${escapeLike(originalStem)}.%`})`)
      .where(sql<boolean>`starts_with("asset"."originalPath", ${prefix})`)
      .where(sql<boolean>`substr("asset"."originalPath", length(${prefix}) + 1) !~ '[./]'`)
      .where('asset.originalPath', '!=', originalPath)
      .orderBy('asset.id')
      .limit(NAME_SEARCH_LIMIT)
      .execute();
  }

  /**
  For the search around files about to be paired (`findAroundPairings`): the ids the two searches above find, by
  name in that window and at exactly that time, without what the rules need of each file (read once the job knows
  which files are new). The same limits: a search by name that reaches `NAME_SEARCH_LIMIT` is cut off, and so many
  files at one time mean nothing.
  */
  @GenerateSql({
    params: [DummyValue.UUID, DummyValue.UUID, [DummyValue.STRING], DummyValue.DATE, DummyValue.DATE, DummyValue.DATE],
  })
  async getIdsAround(ownerId: string, libraryId: string | null, names: string[], from: Date, to: Date, time: Date) {
    const own = () =>
      this.db
        .selectFrom('asset')
        .select('asset.id')
        .where('asset.type', '=', AssetType.Image)
        .where('asset.deletedAt', 'is', null)
        .where('asset.ownerId', '=', asUuid(ownerId))
        .where((eb) => (libraryId ? eb('asset.libraryId', '=', asUuid(libraryId)) : eb('asset.libraryId', 'is', null)));
    const byName = await own()
      .where('asset.localDateTime', '>=', from)
      .where('asset.localDateTime', '<=', to)
      .where((eb) =>
        eb.or(
          names.map(
            (name) => sql<boolean>`f_unaccent("asset"."originalFileName") ilike f_unaccent(${containing(name)})`,
          ),
        ),
      )
      .orderBy('asset.id')
      .limit(NAME_SEARCH_LIMIT)
      .execute();
    const atTime = await own()
      .where('asset.localDateTime', '=', time)
      .orderBy('asset.id')
      .limit(SAME_TIME_LIMIT)
      .execute();
    return {
      byName: byName.map(({ id }) => id),
      atTime: atTime.length >= SAME_TIME_LIMIT ? [] : atTime.map(({ id }) => id),
    };
  }

  /**
  The owner's images in one library taken at exactly one time, to the millisecond: an edit and the file it was made
  from, whatever their names. At most `limit` rows: the caller reads that many as "this time means nothing".
  */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, DummyValue.DATE, DummyValue.NUMBER] })
  getCandidatesAtTime(ownerId: string, libraryId: string | null, time: Date, limit: number) {
    return this.candidates()
      .where('asset.deletedAt', 'is', null)
      .where('asset.ownerId', '=', asUuid(ownerId))
      .where((eb) => (libraryId ? eb('asset.libraryId', '=', asUuid(libraryId)) : eb('asset.libraryId', 'is', null)))
      .where('asset.localDateTime', '=', time)
      .orderBy('asset.id')
      .limit(limit)
      .execute();
  }

  /**
  These images, the photos they are behind, and every file behind those photos: what is combined stays together.
  A photo that is in the trash comes too, so that its shot waits for it and its files do not look like a shot of
  their own.
  */
  @GenerateSql({ params: [[DummyValue.UUID]] })
  getCandidatesWithTheirShots(ids: string[]) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    const photos = sql<string>`(
  SELECT "id" FROM "asset" WHERE "id" = ANY(${ids}::uuid[])
  UNION SELECT "assetId" FROM "asset_version"
  WHERE "versionAssetId" = ANY(${ids}::uuid[]) AND "role" = 'version' AND "assetId" IS NOT NULL
)`;
    return this.candidates()
      .where((eb) =>
        eb.or([
          eb('asset.id', 'in', photos),
          eb(
            'asset.id',
            'in',
            sql<string>`(SELECT "versionAssetId" FROM "asset_version" WHERE "role" = 'version' AND "assetId" IN ${photos})`,
          ),
        ]),
      )
      .orderBy('asset.id')
      .execute();
  }

  /**
  The owner's images in one library, not RAW, whose name contains one of these names and whose metadata Immich has
  not read yet: their date is still the file's date on disk, or the one the app sent, so a search by time does not
  find them. What the job has already, and RAW files, are left out before the limit: they must not use it up.
  */
  @GenerateSql({
    params: [DummyValue.UUID, DummyValue.UUID, [DummyValue.STRING], [DummyValue.UUID], DummyValue.NUMBER],
  })
  getNotYetReadByName(ownerId: string, libraryId: string | null, names: string[], known: string[], limit: number) {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_job_status as status', 'status.assetId', 'asset.id')
      .select(['asset.id', 'asset.ownerId', 'asset.originalPath', 'asset.originalFileName'])
      .where('asset.type', '=', AssetType.Image)
      .where('asset.deletedAt', 'is', null)
      .where('asset.ownerId', '=', asUuid(ownerId))
      .where((eb) => (libraryId ? eb('asset.libraryId', '=', asUuid(libraryId)) : eb('asset.libraryId', 'is', null)))
      .where('status.metadataExtractedAt', 'is', null)
      .$if(known.length > 0, (qb) => qb.where('asset.id', 'not in', known))
      .where(sql<boolean>`"asset"."originalFileName" !~* ${RAW_FILE_NAME}`)
      .where((eb) =>
        eb.or(
          names.map(
            (name) => sql<boolean>`f_unaccent("asset"."originalFileName") ilike f_unaccent(${containing(name)})`,
          ),
        ),
      )
      .orderBy('asset.id')
      .limit(limit)
      .execute();
  }

  /**
  Keeps reads of files: the "read" stamp of every file read (the Versions job's "Missing" run goes by it), and the
  read itself on the row of a file that is part of a combined shot. A base photo's row also takes what the read says
  the file is. A file without a row gets none here: a row is made only by `pair`.
  */
  async storeReads(reads: StoredRead[]): Promise<void> {
    if (reads.length === 0) {
      return;
    }
    await this.db
      .insertInto('asset_job_status_gallery')
      .values(
        reads.map(({ assetId, read }) => ({
          assetId,
          versionsReadAt: new Date(read.readAt),
          versionsParserVersion: read.parserVersion,
        })),
      )
      .onConflict((oc) =>
        oc.column('assetId').doUpdateSet((eb) => ({
          versionsReadAt: eb.ref('excluded.versionsReadAt'),
          versionsParserVersion: eb.ref('excluded.versionsParserVersion'),
        })),
      )
      .execute();
    for (const { assetId, read, kind, source } of reads) {
      await this.db
        .updateTable('asset_version')
        .set((eb) => ({
          read,
          kind: eb.case().when('role', '=', 'base_photo').then(kind).else(eb.ref('kind')).end(),
          source: eb.case().when('role', '=', 'base_photo').then(source).else(eb.ref('source')).end(),
        }))
        .where('versionAssetId', '=', asUuid(assetId))
        .execute();
    }
  }

  /** Images never read for versions, or read by an older parser; every image with `force`. */
  @GenerateSql({ params: [], stream: true })
  streamForQueue(force?: boolean) {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_job_status_gallery as status', 'status.assetId', 'asset.id')
      .select(['asset.id'])
      .where('asset.type', '=', AssetType.Image)
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', 'in', [...SHOWN, AssetVisibility.Hidden])
      .$if(!force, (qb) =>
        qb.where((eb) =>
          eb.or([
            eb('status.versionsParserVersion', 'is', null),
            eb('status.versionsParserVersion', '<', READ_PARSER_VERSION),
          ]),
        ),
      )
      .stream();
  }

  /** The base photo of a version, or nothing when the asset is no version. */
  @GenerateSql({ params: [DummyValue.UUID] })
  getPhotoOf(versionId: string) {
    return this.db
      .selectFrom('asset_version')
      .select(['assetId'])
      .where('versionAssetId', '=', asUuid(versionId))
      .where('role', '=', 'version')
      .executeTakeFirst();
  }

  /** The files behind a photo, with what their cards show. */
  @GenerateSql({ params: [DummyValue.UUID] })
  getVersions(photoId: string) {
    return this.db
      .selectFrom('asset_version as v')
      .innerJoin('asset', 'asset.id', 'v.versionAssetId')
      .leftJoin('asset_exif as exif', 'exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'v.kind',
        'v.source',
        'v.rule',
        'asset.originalFileName',
        'asset.fileCreatedAt',
        'asset.fileModifiedAt',
        'asset.width',
        'asset.height',
        'asset.thumbhash',
        'asset.isOffline',
        'exif.fileSizeInByte',
      ])
      .where('v.assetId', '=', asUuid(photoId))
      .where('v.role', '=', 'version')
      .orderBy('asset.id')
      .execute();
  }

  /**
  The base photo's own file as a row of its Versions list, what it is (from its row: a RAW, an edit or a camera file;
  none when it has no row), the file its picture is rendered from (if any) and whether Gallery's own editor has
  changed it.
  */
  @GenerateSql({ params: [DummyValue.UUID] })
  getPhoto(photoId: string) {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_exif as exif', 'exif.assetId', 'asset.id')
      .leftJoin('asset_version as base', (join) =>
        join.onRef('base.versionAssetId', '=', 'asset.id').on('base.role', '=', sql.lit('base_photo')),
      )
      .select([
        'asset.id',
        'asset.originalFileName',
        'asset.fileCreatedAt',
        'asset.fileModifiedAt',
        'asset.width',
        'asset.height',
        'asset.thumbhash',
        'asset.isOffline',
        'exif.fileSizeInByte',
        'exif.exifImageWidth',
        'exif.exifImageHeight',
        'exif.orientation',
        'base.kind',
        'base.source',
        sql<boolean>`"base"."lookUpdatedAt" is not null`.as('hasLook'),
        'base.lookSourceAssetId as lookSourceId',
        'base.lookSourceModifiedAt as lookSourceModifiedAt',
        sql<boolean>`exists (select 1 from "asset_edit" "e" where "e"."assetId" = "asset"."id")`.as('hasEditorEdits'),
      ])
      .where('asset.id', '=', asUuid(photoId))
      .executeTakeFirst();
  }

  /**
  Gives the photo the tags of every file behind it, again. A photo's tags are rebuilt from its own file whenever
  its metadata is read (MetadataService.applyTagList), which drops the ones copied from its versions; detection
  runs after every metadata read, and puts them back. A tag removed from the photo by hand comes back the same way.
  */
  async copyTags(photoId: string): Promise<void> {
    await sql`INSERT INTO "tag_asset" ("tagId", "assetId")
SELECT DISTINCT t."tagId", v."assetId" FROM "asset_version" v JOIN "tag_asset" t ON t."assetId" = v."versionAssetId"
WHERE v."assetId" = ${photoId}::uuid AND v."role" = 'version'
ON CONFLICT DO NOTHING`.execute(this.db);
  }

  /**
  Records which file a base photo's picture has just been rendered from (and that file's date), marks the photo
  edited (its edited thumbnails are that picture) and gives it the picture's size. Called by the edit job once the
  picture exists (asset-version-look.ts), never before: the record is what the files hold. Like
  `ImageAdjustRepository.upsert`. Under the photo's lock, which pairing and the reset take too. A photo whose row was
  removed meanwhile (an undo, then a reset that finished first) gets a row again: its files do hold that picture,
  and the next reset removes it.
  */
  async setLook(
    assetId: string,
    source: { id: string; modifiedAt: Date },
    dimensions?: { width: number; height: number },
  ): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      await lockVersion(tx, assetId);
      await tx
        .updateTable('asset')
        .set({ isEdited: true, ...dimensions })
        .where('id', '=', asUuid(assetId))
        .execute();
      // `lookUpdatedAt` says which render the row is about, and that the photo shows another file's picture
      const look = {
        lookSourceAssetId: source.id,
        lookSourceModifiedAt: source.modifiedAt,
        lookUpdatedAt: sql<Date>`clock_timestamp()`,
        lookQueuedAt: null,
      };
      // a row made here (a render that finished after the reset removed it) has no file behind it: the cleanup finds
      // its look outdated and the reset removes it again, so what it says the photo is does not matter
      await tx
        .insertInto('asset_version')
        .values({ versionAssetId: assetId, assetId, role: 'base_photo', kind: 'original', rule: 'photo', ...look })
        .onConflict((oc) =>
          oc.column('versionAssetId').doUpdateSet(look).where('asset_version.role', '=', 'base_photo'),
        )
        .execute();
    });
  }

  /**
  The base photo shows its own file again, if it still has nothing else to show (`nothingToShow`, asked under the
  photo's lock: a pairing may have put an edit behind it since the edit job looked). It stays marked edited while
  Gallery's editor, a colour adjustment or a video trim still applies to it. Its row goes when no file is behind it
  any more. Returns `refused` when the photo has something to show after all, `cleared` when a look was removed, and
  `none` when there was none.
  */
  async clearLook(
    assetId: string,
    nothingToShow: () => Promise<boolean> = () => Promise.resolve(true),
  ): Promise<'refused' | 'cleared' | 'none'> {
    return this.db.transaction().execute(async (tx) => {
      await lockVersion(tx, assetId);
      if (!(await nothingToShow())) {
        return 'refused';
      }
      const cleared = await tx
        .updateTable('asset_version')
        .set({ lookSourceAssetId: null, lookSourceModifiedAt: null, lookUpdatedAt: null, lookQueuedAt: null })
        .where('versionAssetId', '=', asUuid(assetId))
        .where('role', '=', 'base_photo')
        .where('lookUpdatedAt', 'is not', null)
        .returning('versionAssetId')
        .executeTakeFirst();
      await pruneBasePhoto(tx, assetId);
      if (!cleared) {
        return 'none';
      }
      await sql`UPDATE "asset" SET "isEdited" = false
WHERE "id" = ${assetId}::uuid AND "isEdited"
  AND NOT EXISTS (SELECT 1 FROM "asset_edit" e WHERE e."assetId" = "asset"."id")
  AND NOT EXISTS (SELECT 1 FROM "asset_image_adjust" j WHERE j."assetId" = "asset"."id")
  AND NOT EXISTS (SELECT 1 FROM "asset_video_trim" t WHERE t."assetId" = "asset"."id")`.execute(tx);
      return 'cleared';
    });
  }

  /**
  Base photos whose picture is not the one it should be, a page at a time: rendered from a file that has since been
  deleted, or written again (exported over itself), or that is no longer the one to show (a newer edit whose render
  failed); with no edited files to show it (a reset that removed them as a render finished); with no file behind it
  any more; or showing its own file when it should show another (a first render that failed). Which file it should
  show is `chooseLook`'s answer in SQL, ties included. They are rendered again (or reset to their own file). Left
  out: photos changed in Gallery's own editor, whose edits make the picture, and those queued in the last hour (a
  render that keeps failing is tried once an hour at most).
  */
  @GenerateSql({ params: [DummyValue.UUID] })
  getOutdatedLooks(after?: string) {
    // to the millisecond: dates that have been through JavaScript keep no more than that
    const desired = sql<string | null>`coalesce(
  (select case when "base"."kind" = 'edit'
      and (date_trunc('milliseconds', "photo"."fileModifiedAt"), "photo"."id") > (date_trunc('milliseconds', "a"."fileModifiedAt"), "a"."id")
    then null else "a"."id" end
   from "asset_version" "v" inner join "asset" "a" on "a"."id" = "v"."versionAssetId"
   where "v"."assetId" = "base"."versionAssetId" and "v"."role" = 'version' and "v"."kind" = 'edit'
   order by date_trunc('milliseconds', "a"."fileModifiedAt") desc, "a"."id" desc limit 1),
  (select "v"."versionAssetId" from "asset_version" "v"
   where "base"."kind" = 'raw' and "v"."assetId" = "base"."versionAssetId" and "v"."role" = 'version' and "v"."kind" = 'original'
   order by "v"."versionAssetId"::text limit 1)
)`;
    return this.db
      .selectFrom('asset_version as base')
      .innerJoin('asset as photo', 'photo.id', 'base.versionAssetId')
      .leftJoin('asset as source', 'source.id', 'base.lookSourceAssetId')
      .select(['base.versionAssetId as assetId'])
      .where('base.role', '=', 'base_photo')
      .where(sql<boolean>`not exists (select 1 from "asset_edit" "e" where "e"."assetId" = "base"."versionAssetId")`)
      .where((eb) =>
        eb.or([
          eb('base.lookQueuedAt', 'is', null),
          eb('base.lookQueuedAt', '<', sql<Date>`now() - interval '1 hour'`),
        ]),
      )
      .where((eb) =>
        eb.or([
          eb.and([
            eb('base.lookUpdatedAt', 'is not', null),
            eb.or([
              eb('base.lookSourceAssetId', 'is', null),
              eb('base.lookSourceModifiedAt', 'is', null),
              sql<boolean>`date_trunc('milliseconds', "source"."fileModifiedAt") <> date_trunc('milliseconds', "base"."lookSourceModifiedAt")`,
              sql<boolean>`"base"."lookSourceAssetId" is distinct from ${desired}`,
              sql<boolean>`not exists (select 1 from "asset_file" "f" where "f"."assetId" = "base"."versionAssetId" and "f"."isEdited" and "f"."type" = 'preview')`,
            ]),
          ]),
          eb.and([eb('base.lookUpdatedAt', 'is', null), sql<boolean>`${desired} is not null`]),
        ]),
      )
      .$if(!!after, (qb) => qb.where('base.versionAssetId', '>', asUuid(after!)))
      .orderBy('base.versionAssetId')
      .limit(1000)
      .execute();
  }

  /** The cleanup has queued the render of these photos: they wait an hour before it queues them again. */
  async markLookQueued(photoIds: string[]): Promise<void> {
    if (photoIds.length === 0) {
      return;
    }
    await this.db
      .updateTable('asset_version')
      .set({ lookQueuedAt: sql<Date>`now()` })
      .where(
        'versionAssetId',
        'in',
        photoIds.map((id) => asUuid(id)),
      )
      .where('role', '=', 'base_photo')
      .execute();
  }

  /** Base photos with no file behind them and no picture from another: what is left of a shot, to be removed. */
  @GenerateSql({ params: [] })
  getEmptyBasePhotos() {
    return this.db
      .selectFrom('asset_version as base')
      .select(['base.versionAssetId as assetId'])
      .where('base.role', '=', 'base_photo')
      .where('base.lookUpdatedAt', 'is', null)
      .where(
        sql<boolean>`not exists (select 1 from "asset_version" "v" where "v"."assetId" = "base"."versionAssetId" and "v"."role" = 'version')`,
      )
      .limit(1000)
      .execute();
  }

  /** Removes a base photo's row if no file is behind it and it shows its own picture, under the photo's lock. */
  async removeEmptyBasePhoto(assetId: string): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      await lockVersion(tx, assetId);
      await pruneBasePhoto(tx, assetId);
    });
  }

  /** The XMP sidecars of these files, by file: where programs write a RAW's metadata, its instructions too. */
  @GenerateSql({ params: [[DummyValue.UUID]] })
  async getSidecarPaths(assetIds: string[]): Promise<Map<string, string>> {
    if (assetIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .selectFrom('asset_file')
      .select(['asset_file.assetId', 'asset_file.path'])
      .where('asset_file.assetId', 'in', assetIds)
      .where('asset_file.type', '=', AssetFileType.Sidecar)
      .execute();
    return new Map(rows.map((row) => [row.assetId, row.path]));
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getVersionFile(versionId: string, type: AssetFileType) {
    return this.db
      .selectFrom('asset_file')
      .select(['asset_file.path'])
      .where('asset_file.assetId', '=', asUuid(versionId))
      .where('asset_file.type', '=', type)
      .where('asset_file.isEdited', '=', false)
      .executeTakeFirst();
  }

  /**
  Versions whose photo was deleted, for the cleanup to delete. One queued an hour ago or less is left out, so repeated
  cleanups during a bulk deletion do not queue the same deletion again and again.
  */
  @GenerateSql({ params: [] })
  getOrphans() {
    return this.db
      .selectFrom('asset_version as v')
      .innerJoin('asset', 'asset.id', 'v.versionAssetId')
      .select(['asset.id', 'asset.libraryId'])
      .where('v.role', '=', 'version')
      .where('v.assetId', 'is', null)
      .where((eb) =>
        eb.or([
          eb('v.cleanupQueuedAt', 'is', null),
          eb('v.cleanupQueuedAt', '<', sql<Date>`now() - interval '1 hour'`),
        ]),
      )
      .limit(1000)
      .execute();
  }

  async markCleanupQueued(ids: string[]) {
    if (ids.length > 0) {
      await this.db
        .updateTable('asset_version')
        .set({ cleanupQueuedAt: sql`now()` })
        .where('versionAssetId', 'in', ids)
        .execute();
    }
  }

  /** Pairings whose follow-up (the sync tombstones) has not completed, a page at a time in id order. */
  @GenerateSql({ params: [DummyValue.UUID] })
  getUnsynced(after?: string) {
    return this.db
      .selectFrom('asset_version as v')
      .select(['v.versionAssetId'])
      .where('v.role', '=', 'version')
      .where('v.syncedAt', 'is', null)
      .$if(!!after, (qb) => qb.where('v.versionAssetId', '>', after!))
      .orderBy('v.versionAssetId')
      .limit(1000)
      .execute();
  }

  /**
  Runs a pairing's follow-up while it is still pending, under the version's lock, then marks it done: of two runs of
  one follow-up (the pairing's own and the cleanup's replay) the second finds it done. Returns false when there was
  nothing to do.
  */
  async syncPending(versionId: string, apply: () => Promise<void>): Promise<boolean> {
    return this.db.transaction().execute(async (tx) => {
      await lockVersion(tx, versionId);
      const row = await tx
        .selectFrom('asset_version')
        .select('versionAssetId')
        .where('versionAssetId', '=', versionId)
        .where('role', '=', 'version')
        .where('assetId', 'is not', null)
        .where('syncedAt', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!row) {
        return false;
      }
      await apply();
      await tx
        .updateTable('asset_version')
        .set({ syncedAt: sql`now()` })
        .where('versionAssetId', '=', versionId)
        .execute();
      return true;
    });
  }

  /** Versions missing a thumbnail or a preview (all versions with `force`), for the Versions job to generate. */
  @GenerateSql({ params: [], stream: true })
  streamForThumbnails(force?: boolean) {
    return this.db
      .selectFrom('asset_version as v')
      .select(['v.versionAssetId as id'])
      .where('v.role', '=', 'version')
      .where('v.assetId', 'is not', null)
      .$if(!force, (qb) =>
        qb.where((eb) =>
          eb.or(
            [AssetFileType.Thumbnail, AssetFileType.Preview].map((type) =>
              eb.not(
                eb.exists(
                  eb
                    .selectFrom('asset_file')
                    .select('asset_file.id')
                    .whereRef('asset_file.assetId', '=', 'v.versionAssetId')
                    .where('asset_file.type', '=', type),
                ),
              ),
            ),
          ),
        ),
      )
      .stream();
  }

  /** Some photos that have versions behind them: the undo takes them a few at a time until none is left. */
  @GenerateSql({ params: [100] })
  getPhotosWithVersions(limit: number) {
    return this.db
      .selectFrom('asset_version')
      .select('assetId')
      .distinct()
      .where('role', '=', 'version')
      .where('assetId', 'is not', null)
      .limit(limit)
      .$narrowType<{ assetId: string }>()
      .execute();
  }

  /**
  Makes every version of a photo a photo of its own again, in one transaction (the undo, while versions are off):
  each is shown and stacked as `restoredState` says (asset-version-undo.ts), their rows are removed, and what was
  read about these files is forgotten (their "read" stamps too), so that a later run of the Versions job looks at them
  afresh. What hung on a version before it went behind its photo (an album, a favourite) is not put back: it was on
  the photo too, and still is. The base photo's row goes, unless its picture still comes from another file: then it
  stays, marked stale, until the reset of that picture (the cleanup has it rendered again if the job stops before it
  asks for that itself) removes it. Duplicate detection forgets these files, which it left out while an edit was
  behind the photo. Returns the photo's owner, the versions and how each is shown now.
  */
  async undo(
    photoId: string,
  ): Promise<{ ownerId: string | null; restored: Array<{ id: string; visibility: AssetVisibility }> }> {
    return this.db.transaction().execute(async (tx) => {
      // the lock a pairing of this photo takes: one in flight finishes first, or waits and then finds versions off
      await lockVersion(tx, photoId);
      const photo = await tx
        .selectFrom('asset')
        .select(['id', 'ownerId', 'visibility', 'deletedAt', 'status', 'stackId'])
        .where('id', '=', photoId)
        .forUpdate()
        .executeTakeFirst();
      const versions = await tx
        .selectFrom('asset_version as v')
        .innerJoin('asset', 'asset.id', 'v.versionAssetId')
        .select(['asset.id', 'asset.deletedAt', 'asset.status', 'v.priorVisibility', 'v.wasStacked'])
        .where('v.assetId', '=', photoId)
        .where('v.role', '=', 'version')
        .orderBy('asset.id')
        .forUpdate('asset')
        .execute();
      if (!photo || versions.length === 0) {
        return { ownerId: null, restored: [] };
      }

      let stackId = photo.stackId;
      const restored: Array<{ id: string; visibility: AssetVisibility }> = [];
      for (const version of versions) {
        const state = restoredState(photo, { ...version, priorVisibility: version.priorVisibility ?? '' });
        if (state.stackedWithPhoto && !stackId) {
          // the stack it left was dissolved when it was left with the photo alone: a new one, the photo on top
          const stack = await tx
            .insertInto('stack')
            .values({ primaryAssetId: photoId, ownerId: photo.ownerId })
            .returning('id')
            .executeTakeFirstOrThrow();
          stackId = stack.id;
          await tx.updateTable('asset').set({ stackId }).where('id', '=', photoId).execute();
        }
        await tx
          .updateTable('asset')
          .set({
            visibility: state.visibility,
            deletedAt: state.deletedAt,
            status: state.status,
            stackId: state.stackedWithPhoto ? stackId : null,
          })
          .where('id', '=', version.id)
          .execute();
        restored.push({ id: version.id, visibility: state.visibility });
      }
      const files = [photoId, ...versions.map(({ id }) => id)];
      await tx.deleteFrom('asset_version').where('assetId', '=', photoId).where('role', '=', 'version').execute();
      await tx
        .updateTable('asset_version')
        .set({ lookSourceModifiedAt: null })
        .where('versionAssetId', '=', photoId)
        .where('role', '=', 'base_photo')
        .execute();
      await pruneBasePhoto(tx, photoId);
      await tx
        .updateTable('asset_job_status_gallery')
        .set({ versionsReadAt: null, versionsParserVersion: null })
        .where('assetId', 'in', files)
        .execute();
      await tx
        .updateTable('asset_job_status')
        .set({ duplicatesDetectedAt: null })
        .where('assetId', 'in', files)
        .execute();
      return { ownerId: photo.ownerId, restored };
    });
  }

  /**
  Puts `versionId` behind `photoId` in one transaction. Nothing is moved: the file goes behind only when the photo
  already has everything that hangs on it (re-checked here, under a lock), so its own entries are duplicates and are
  removed. Its tags are the exception: they come from the keywords in the file, stay on it, and are copied to the
  photo (here, and again on every detection run: `copyTags`). An
  album or Space cover it was becomes the photo. It leaves its stack (a stack left with one asset is dissolved;
  that it was stacked with its photo is remembered) and is hidden. The only way back is for all of them at once: undoing versions while they are off (`undo`, above), or the revert.
  */
  async pair(input: PairInput, stillOn?: () => Promise<boolean>): Promise<PairOutcome> {
    const { photoId, versionId } = input;
    return this.db.transaction().execute(async (tx) => {
      await lockPair(tx, photoId, versionId);
      // an undo of this photo holds the same lock: a pairing that waited for it finds versions switched off
      if (stillOn && !(await stillOn())) {
        return { paired: false, reason: 'switched-off' } as const;
      }
      const rows = await tx
        .selectFrom('asset')
        .leftJoin('asset_version as v', 'v.versionAssetId', 'asset.id')
        .select([
          'asset.id',
          'asset.ownerId',
          'asset.visibility',
          'asset.stackId',
          'asset.deletedAt',
          'v.role',
          (eb) => eb.case().when('v.role', '=', 'version').then(eb.ref('v.assetId')).else(null).end().as('versionOf'),
        ])
        .where('asset.id', 'in', [photoId, versionId])
        .forUpdate('asset')
        .execute();
      const photo = rows.find((row) => row.id === photoId);
      const version = rows.find((row) => row.id === versionId);
      if (!photo || !version || photoId === versionId) {
        return { paired: false, reason: 'not-found' } as const;
      }
      if (photo.ownerId !== version.ownerId) {
        return { paired: false, reason: 'different-owners' } as const;
      }
      if (photo.deletedAt || version.deletedAt) {
        return { paired: false, reason: 'not-eligible' } as const;
      }
      if (version.versionOf || photo.versionOf) {
        return {
          paired: false,
          reason: version.versionOf === photoId ? 'already-paired' : 'version-of-another-photo',
        } as const;
      }
      if (!SHOWN.includes(photo.visibility) || !SHOWN.includes(version.visibility)) {
        return { paired: false, reason: 'not-eligible' } as const;
      }
      // a file that others are behind is the base photo of its shot, and stays that; one that still shows another
      // file's picture waits until that is reset
      if (version.role === 'base_photo') {
        const behind = await tx
          .selectFrom('asset_version')
          .select('versionAssetId')
          .where('assetId', '=', versionId)
          .where('role', '=', 'version')
          .limit(1)
          .executeTakeFirst();
        return { paired: false, reason: behind ? 'two-photos' : 'not-eligible' } as const;
      }
      // re-checked under the lock: someone may have commented on it or added it to an album since the job read it
      const attachments = await attachmentsOf(tx, [photoId, versionId]);
      const onPhoto = attachments.get(photoId) ?? new Set<string>();
      if ([...(attachments.get(versionId) ?? [])].some((key) => !onPhoto.has(key))) {
        return { paired: false, reason: 'has-own-attachments' } as const;
      }

      await copyTagsOf(tx, photoId, versionId);
      await sql`UPDATE "album" SET "albumThumbnailAssetId" = ${photoId}::uuid
WHERE "albumThumbnailAssetId" = ${versionId}::uuid`.execute(tx);
      await sql`UPDATE "shared_space" SET "thumbnailAssetId" = ${photoId}::uuid
WHERE "thumbnailAssetId" = ${versionId}::uuid`.execute(tx);
      // what is left on the file is on the photo too (or made by Gallery itself, like memories): a hidden file keeps
      // none of it, or it would still show in shared albums and through shared links
      for (const table of VERSION_ENTRY_TABLES) {
        await sql`DELETE FROM ${sql.table(table)} WHERE "assetId" = ${versionId}::uuid`.execute(tx);
      }

      if (version.stackId) {
        await leaveStack(tx, versionId, version.stackId, photoId);
      }

      await tx.updateTable('asset').set({ visibility: AssetVisibility.Hidden }).where('id', '=', versionId).execute();
      // the base photo's row, made with its first file behind it; one kept for its picture keeps its look
      const base = { kind: input.photo.kind, source: input.photo.source, read: input.photo.read };
      await tx
        .insertInto('asset_version')
        .values({ versionAssetId: photoId, assetId: photoId, role: 'base_photo', rule: 'photo', ...base })
        .onConflict((oc) =>
          oc.column('versionAssetId').doUpdateSet(base).where('asset_version.role', '=', 'base_photo'),
        )
        .execute();
      await tx
        .insertInto('asset_version')
        .values({
          versionAssetId: versionId,
          assetId: photoId,
          role: 'version',
          kind: input.kind,
          source: input.source,
          rule: input.rule,
          priorVisibility: version.visibility,
          // read before it left the stack, above
          wasStacked: !!version.stackId && version.stackId === photo.stackId,
          read: input.read,
        })
        .execute();
      return { paired: true, priorVisibility: version.visibility } as const;
    });
  }
}

/**
Every table that points at an asset, and what happens to a file's rows in it when the file goes behind a photo.
asset-version-tables.spec.ts fails when a table that points at an asset is missing here: a new one needs an answer.
- `same-on-photo`: the file goes behind only if the photo has the same entry (see `attachmentsOf`); the file's is
  then a duplicate and is removed.
- `keeps-apart`: a file with rows here is never put behind (they cannot be "on the photo too").
- `copied`: stays on the file, and is copied to the photo (when it goes behind, and on every detection run).
- `removed`: made by Gallery itself; removed from the file.
- `cover`: the photo takes the file's place as the cover.
- `left`: the file leaves it (its stack; see `leaveStack`).
- `stays`: about the file itself (what was read from it, its thumbnails, faces, search data, job state), and stays
  with it.
*/
export const VERSION_TABLE_POLICY: Record<
  string,
  'same-on-photo' | 'keeps-apart' | 'copied' | 'removed' | 'cover' | 'left' | 'stays'
> = {
  activity: 'keeps-apart',
  album: 'cover',
  album_asset: 'same-on-photo',
  album_space_asset: 'same-on-photo',
  // its live-photo video: a live photo is never combined at all (asset-version-rules.ts)
  asset: 'stays',
  asset_data_saver_video: 'stays',
  asset_duplicate_checksum: 'stays',
  asset_edit: 'keeps-apart',
  // except a caption or rating the user wrote in Gallery: `attachmentsOf` compares those
  asset_exif: 'stays',
  // except a face drawn or named by hand: `attachmentsOf` keys it by the file
  asset_face: 'stays',
  asset_favorite: 'same-on-photo',
  asset_file: 'stays',
  asset_image_adjust: 'keeps-apart',
  asset_job_status: 'stays',
  asset_job_status_gallery: 'stays',
  asset_metadata: 'stays',
  asset_ocr: 'stays',
  asset_quality: 'stays',
  asset_spatial_scene: 'stays',
  // a file that others are behind, or whose picture comes from another, is a base photo and never goes behind
  asset_version: 'stays',
  // videos have no versions
  asset_video_trim: 'stays',
  cleanup_decision: 'stays',
  integrity_report: 'stays',
  memory_asset: 'removed',
  ocr_search: 'stays',
  shared_link_asset: 'same-on-photo',
  shared_space: 'cover',
  shared_space_asset: 'same-on-photo',
  shared_space_face_match_backfill_target: 'stays',
  smart_search: 'stays',
  stack: 'left',
  tag_asset: 'copied',
  video_stream_session: 'stays',
};

/** For a row of "asset": other files are behind it, and one of them is an edit, or it is an edit itself. */
const SHOT_HAS_EDIT = sql`(
  EXISTS (SELECT 1 FROM "asset_version" v WHERE v."assetId" = "asset"."id" AND v."role" = 'version')
  AND EXISTS (SELECT 1 FROM "asset_version" v WHERE v."assetId" = "asset"."id" AND v."kind" = 'edit')
)`;

/** The tables whose entries of a file are removed when it goes behind its photo (the photo has the same ones). */
export const VERSION_ENTRY_TABLES = [
  'album_asset',
  'album_space_asset',
  'shared_space_asset',
  'asset_favorite',
  'shared_link_asset',
  'memory_asset',
] as const;

/**
The one definition of what hangs on a file (see `attachmentsOf`): a query giving its keys, one per row, for the
file whose id is `id`. The candidate searches read it as a column and `pair` reads it again under its lock, so the
plan and the final check cannot disagree about what counts. The same key can come twice (two comments): the keys
are compared as a set.
*/
const attachmentKeys = (id: ReturnType<typeof sql.ref>) => sql<{ key: string }>`
SELECT 'album:' || "albumId" AS "key" FROM "album_asset" WHERE "assetId" = ${id}
UNION ALL SELECT 'favorite:' || "userId" FROM "asset_favorite" WHERE "assetId" = ${id}
UNION ALL SELECT 'link:' || "sharedLinkId" FROM "shared_link_asset" WHERE "assetId" = ${id}
UNION ALL SELECT 'space:' || "spaceId" FROM "shared_space_asset" WHERE "assetId" = ${id}
UNION ALL SELECT 'contribution:' || "albumId" || ':' || "spaceId" FROM "album_space_asset" WHERE "assetId" = ${id}
UNION ALL SELECT 'activity:' || "assetId" FROM "activity" WHERE "assetId" = ${id}
UNION ALL SELECT 'editor:' || "assetId" FROM "asset_edit" WHERE "assetId" = ${id}
UNION ALL SELECT 'editor:' || "assetId" FROM "asset_image_adjust" WHERE "assetId" = ${id}
UNION ALL SELECT 'face:' || "id" FROM "asset_face"
  WHERE "assetId" = ${id} AND "sourceType" = 'manual' AND "deletedAt" IS NULL
UNION ALL SELECT 'face:' || i."assetFaceId" FROM "face_identity_face" i
  INNER JOIN "asset_face" f ON f."id" = i."assetFaceId"
  WHERE f."assetId" = ${id} AND i."source" = 'manual' AND f."deletedAt" IS NULL
UNION ALL SELECT 'caption:' || md5("description") FROM "asset_exif"
  WHERE "assetId" = ${id} AND 'description' = ANY("lockedProperties") AND "description" <> ''
UNION ALL SELECT 'rating:' || "rating" FROM "asset_exif"
  WHERE "assetId" = ${id} AND 'rating' = ANY("lockedProperties") AND "rating" IS NOT NULL
`;

/**
What hangs on each file, as keys that compare between files: the albums it is in, who favourited it, the shared
links and Spaces it is in, its contributions to Space albums. Comments and likes, edits made in Gallery's own
editor, and faces someone drew or named by hand, are keyed by the file itself: they can never be "on the photo too",
so a file that has them is either the photo or stays separate. (A face drawn or named on a file that went behind its
photo would be on no visible photo, and its person could lose the only photo they are on.) A caption or a rating the user wrote in Gallery (not one read from the file) counts by its
value: the same on both is no difference. Tags and memories are left out on purpose (see `pair`). A file with
nothing has no entry.
*/
export const attachmentsOf = async (
  db: Kysely<DB> | Transaction<DB>,
  ids: string[],
): Promise<Map<string, Set<string>>> => {
  const result = new Map<string, Set<string>>();
  if (ids.length === 0) {
    return result;
  }
  const { rows } = await sql<{ assetId: string; key: string }>`
SELECT "file"."id" AS "assetId", "hangs"."key"
FROM "asset" "file" CROSS JOIN LATERAL (${attachmentKeys(sql.ref('file.id'))}) AS "hangs"
WHERE "file"."id" = ANY(${ids}::uuid[])
`.execute(db);
  for (const { assetId, key } of rows) {
    result.set(assetId, (result.get(assetId) ?? new Set<string>()).add(key));
  }
  return result;
};

const copyTagsOf = (tx: Transaction<DB>, photoId: string, versionId: string) =>
  sql`INSERT INTO "tag_asset" ("tagId", "assetId")
SELECT "tagId", ${photoId}::uuid FROM "tag_asset" WHERE "assetId" = ${versionId}::uuid
ON CONFLICT DO NOTHING`.execute(tx);

const lockVersion = async (tx: Transaction<DB>, id: string) => {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${'asset-version:' + id}))`.execute(tx);
};

// one lock per pair, taken in id order, so two jobs pairing the same assets never interleave
const lockPair = async (tx: Transaction<DB>, a: string, b: string) => {
  for (const id of [a, b].toSorted()) {
    await lockVersion(tx, id);
  }
};

/** Takes an asset out of its stack; a stack left with fewer than two assets is dissolved. */
const leaveStack = async (tx: Transaction<DB>, assetId: string, stackId: string, preferredPrimaryId: string) => {
  await tx.updateTable('asset').set({ stackId: null }).where('id', '=', assetId).execute();
  // only members still shown count: a trashed or hidden member must not become the stack's face
  const remaining = await tx
    .selectFrom('asset')
    .select('id')
    .where('stackId', '=', stackId)
    .where('deletedAt', 'is', null)
    .where('visibility', 'in', SHOWN)
    .orderBy('id')
    .execute();
  if (remaining.length < 2) {
    await tx.updateTable('asset').set({ stackId: null }).where('stackId', '=', stackId).execute();
    await tx.deleteFrom('stack').where('id', '=', stackId).execute();
    return;
  }
  const stack = await tx.selectFrom('stack').select('primaryAssetId').where('id', '=', stackId).executeTakeFirst();
  if (stack?.primaryAssetId !== assetId) {
    return;
  }
  const next = remaining.find(({ id }) => id === preferredPrimaryId)?.id ?? remaining[0].id;
  await tx.updateTable('stack').set({ primaryAssetId: next }).where('id', '=', stackId).execute();
};

/**
Removes a base photo's row when no file is behind it and its picture is its own: what is left of a shot. The caller
holds the photo's lock (pairing takes it too, so no file goes behind meanwhile).
*/
const pruneBasePhoto = async (tx: Transaction<DB>, assetId: string) => {
  await sql`DELETE FROM "asset_version" "base"
WHERE "base"."versionAssetId" = ${assetId}::uuid AND "base"."role" = 'base_photo' AND "base"."lookUpdatedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "asset_version" "v" WHERE "v"."assetId" = "base"."versionAssetId" AND "v"."role" = 'version')`.execute(
    tx,
  );
};
