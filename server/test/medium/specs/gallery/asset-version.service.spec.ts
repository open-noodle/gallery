/**
Asset versions (specs/2026-11-07-asset-versions-design.md), through AssetVersionService on a real database:
what happens to a file that goes behind its photo (nothing is moved: duplicates go, tags are copied, and a file
with something of its own is refused), automatic detection end to end (a RAW behind its camera file; an edit behind
the photo, whose picture is then rendered from it; the organised file chosen as the photo; each pairing stored and
logged once), the photo's picture (the look), the cleanup of a deleted photo's versions, switching back, and the
role matrix of every version operation (rule 7), whose expectations come from the truth table below and not from
the service.
*/
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AlbumUserRole,
  AssetFileType,
  AssetStatus,
  AssetVisibility,
  JobName,
  JobStatus,
  Permission,
  SharedLinkType,
  SharedSpaceRole,
  SourceType,
  SystemMetadataKey,
} from 'src/enum.js';
import {
  AssetVersionRepository,
  NAME_SEARCH_LIMIT,
  attachmentsOf,
} from 'src/gallery/repositories/asset-version.repository.js';
import { ImageAdjustRepository } from 'src/gallery/repositories/image-adjust.repository.js';
import { AssetVersionService } from 'src/gallery/services/asset-version.service.js';
import { desiredLook } from 'src/gallery/utils/asset-version-look.js';
import { SAME_TIME_LIMIT } from 'src/gallery/utils/asset-version-rules.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumUserRepository } from 'src/repositories/album-user.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MetadataRepository } from 'src/repositories/metadata.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { WebsocketRepository } from 'src/repositories/websocket.repository.js';
import { DB } from 'src/schema/index.js';
import { down } from 'src/schema/migrations-gallery/1800900000000-AddAssetVersionTables.js';
import { checkAccess } from 'src/utils/access.js';
import { clearConfigCache } from 'src/utils/config.js';
import { MediumTestContext, newMediumService } from 'test/medium.factory.js';
import { factory, newUuid } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const setup = ({ enabled = true, detectEdits = true }: { enabled?: boolean; detectEdits?: boolean } = {}) => {
  clearConfigCache();
  const { sut, ctx } = newMediumService(AssetVersionService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      AlbumUserRepository,
      AssetRepository,
      AssetVersionRepository,
      ConfigRepository,
      PartnerRepository,
      SharedLinkRepository,
      SharedSpaceRepository,
      UserRepository,
    ],
    mock: [
      EventRepository,
      JobRepository,
      LoggingRepository,
      MetadataRepository,
      StorageRepository,
      SystemMetadataRepository,
      WebsocketRepository,
    ],
  });
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  ctx.getMock(JobRepository).queueAll.mockResolvedValue();
  ctx.getMock(SystemMetadataRepository).get.mockImplementation((key) => {
    if (key === SystemMetadataKey.SystemConfig) {
      return { server: { assetVersions: { enabled, detectEdits } } } as never;
    }
    return undefined as never;
  });
  return { sut, ctx };
};

const authOf = (user: { id: string; email: string }) => factory.auth({ user: { id: user.id, email: user.email } });

const WHEN = new Date('2026-08-18T00:59:04.600Z');

const newPhoto = async (ctx: MediumTestContext, ownerId: string, originalFileName: string, extra = {}) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    originalFileName,
    // each in a folder of its own: the folder rule takes part only where a test stores files side by side
    originalPath: `/photos/${randomUUID()}/${originalFileName}`,
    fileCreatedAt: WHEN,
    localDateTime: new Date('2026-08-17T20:59:04.600Z'),
    ...extra,
  });
  await ctx.newExif({ assetId: asset.id, make: 'NIKON CORPORATION', model: 'NIKON Z50_2' });
  return asset;
};

const visibilityOf = async (id: string) => {
  const row = await defaultDatabase
    .selectFrom('asset')
    .select(['visibility', 'stackId'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return row;
};

/** The rows of the files behind a photo, of one owner's assets. */
const versionRows = (ownerId: string) =>
  defaultDatabase
    .selectFrom('asset_version')
    .innerJoin('asset', 'asset.id', 'asset_version.versionAssetId')
    .selectAll('asset_version')
    .where('asset.ownerId', '=', ownerId)
    .where('asset_version.role', '=', 'version')
    .execute();

/** The base photo's row of a shot, if it has one. */
const basePhotoRow = (photoId: string) =>
  defaultDatabase
    .selectFrom('asset_version')
    .selectAll()
    .where('versionAssetId', '=', photoId)
    .where('role', '=', 'base_photo')
    .executeTakeFirst();

/** Puts one asset behind another as detection does once the rules have decided: through the repository. */
const pair = async (
  ctx: MediumTestContext,
  photoId: string,
  versionId: string,
  kind: 'raw' | 'original' | 'edit' = 'raw',
) => {
  const outcome = await ctx.get(AssetVersionRepository).pair({
    photoId,
    versionId,
    kind,
    source: kind === 'edit' ? 'lightroom' : 'camera',
    rule: `${kind}:name`,
    photo: PHOTO,
    read: null,
  });
  expect(outcome).toMatchObject({ paired: true });
};

/** The ids in one table's rows of an album, Space, tag, ... (the column that names the asset is `assetId`). */
const assetIdsIn = async (table: string, column: string, id: string) => {
  const rows = await defaultDatabase
    .selectFrom(table as 'album_asset')
    .select('assetId')
    .where(column as 'albumId', '=', id)
    .execute();
  return rows.map(({ assetId }) => assetId).toSorted();
};

const nikon = (extra: Record<string, unknown> = {}) => ({
  Make: 'NIKON CORPORATION',
  Model: 'NIKON Z50_2',
  Software: 'Ver.01.11',
  SerialNumber: 1_234_567,
  ShutterCount: 3196,
  SubSecDateTimeOriginal: { rawValue: '2026:08:17 20:59:04.60-04:00' },
  DateTimeOriginal: { rawValue: '2026:08:17 20:59:04.60-04:00' },
  ...extra,
});

/** A Nikon file taken at that second of 20:59 on 2026-08-17, with no serial and no shot counter. */
const nikonAt = (second: string) =>
  nikon({
    SerialNumber: undefined,
    ShutterCount: undefined,
    SubSecDateTimeOriginal: { rawValue: `2026:08:17 20:59:${second}.00-04:00` },
    DateTimeOriginal: { rawValue: `2026:08:17 20:59:${second}.00-04:00` },
  });

/** Taken at that second of 20:59 on 2026-08-17, on the camera's clock. */
const takenAtSecond = (second: string) => ({ localDateTime: new Date(`2026-08-17T20:59:${second}.000Z`) });

/** An iPhone file taken at that second of 20:59 on 2026-08-17. */
const apple = (second: string) => ({
  Make: 'Apple',
  Model: 'iPhone 15 Pro',
  Software: '18.1',
  SubSecDateTimeOriginal: { rawValue: `2026:08:17 20:59:${second}.12-04:00` },
  DateTimeOriginal: { rawValue: `2026:08:17 20:59:${second}.12-04:00` },
});

/** A Pixel 11 Pro file taken on 2026-10-18 at that time of day: no serial and no shot counter. */
const pixel = (time: string) => ({
  Make: 'Google',
  Model: 'Pixel 11 Pro',
  Software: 'HDR+ 1.0.982810169zd',
  SubSecDateTimeOriginal: { rawValue: `2026:10:18 ${time}+02:00` },
  DateTimeOriginal: { rawValue: `2026:10:18 ${time}+02:00` },
});

/** A Pixel file's capture time on 2026-10-18, as Immich stores it. */
const takenAt = (time: string) => ({ localDateTime: new Date(`2026-10-18T${time}Z`) });

const deletions = (ctx: MediumTestContext, id: string) =>
  ctx
    .getMock(JobRepository)
    .queueAll.mock.calls.flatMap(([items]) => items)
    .filter((item) => item.name === JobName.AssetDelete && (item.data as { id: string }).id === id);

const attempt = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return true;
  } catch (error) {
    if (
      error instanceof ForbiddenException ||
      error instanceof BadRequestException ||
      error instanceof NotFoundException
    ) {
      return false;
    }
    throw error;
  }
};

/** The tags of a Lightroom export of the shot `nikon()` describes, made from the file `name`. */
const lightroom = (name: string, id = 'export') =>
  nikon({
    ShutterCount: undefined,
    ImageNumber: 3196,
    Software: 'Adobe Photoshop Lightroom Classic 15.6 (Macintosh)',
    DocumentID: `xmp.did:${id}`,
    InstanceID: `xmp.iid:${id}`,
    PreservedFileName: name,
    History: [{ Action: 'derived', Parameters: 'converted from image/x-nikon-nef to image/jpeg' }],
  });

const readTagsFrom = (ctx: MediumTestContext, tags: Record<string, Record<string, unknown>>) =>
  ctx.getMock(MetadataRepository).readTags.mockImplementation((path) => Promise.resolve(tags[path] as never));

/** The base photo of `pair` calls made by hand: a camera file, nothing read. */
const PHOTO = { kind: 'original', source: 'camera', read: null } as const;

/** A photo with an edit behind it, showing that edit (rendered). */
const showingAnEdit = async (ctx: MediumTestContext, ownerId: string) => {
  const photo = await newPhoto(ctx, ownerId, 'DSC_31.JPG');
  const edit = await newPhoto(ctx, ownerId, 'DSC_31-Edit.jpg', {
    fileModifiedAt: new Date('2026-10-01T10:00:00Z'),
  });
  await pair(ctx, photo.id, edit.id, 'edit');
  await rendered(ctx, photo.id, edit.id);
  return { photo, edit };
};

/** A pairing made by hand, for the photo and file ids a test fills in. */
const PAIR_INPUT = { kind: 'raw', source: 'camera', rule: 'raw:name', photo: PHOTO, read: null } as const;

/** The files behind a photo. */
const behind = async (photoId: string) => {
  const rows = await defaultDatabase
    .selectFrom('asset_version')
    .select(['versionAssetId', 'kind', 'rule', 'source'])
    .where('assetId', '=', photoId)
    .where('role', '=', 'version')
    .execute();
  return rows.toSorted((a, b) => a.kind.localeCompare(b.kind));
};

/** What the edit job does once it has rendered a photo's picture from that file (asset-version-look.ts). */
const rendered = async (ctx: MediumTestContext, photoId: string, sourceId: string) => {
  const source = await defaultDatabase
    .selectFrom('asset')
    .select('fileModifiedAt')
    .where('id', '=', sourceId)
    .executeTakeFirstOrThrow();
  // as the edit job does: the edited files first, then the look
  await defaultDatabase
    .insertInto('asset_file')
    .values({
      assetId: photoId,
      type: AssetFileType.Preview,
      path: `/thumbs/${photoId}_preview_edited.jpeg`,
      isEdited: true,
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
  await ctx
    .get(AssetVersionRepository)
    .setLook(photoId, { id: sourceId, modifiedAt: new Date(source.fileModifiedAt) }, { width: 400, height: 400 });
};

/** Switches versions on or off for the service under test, as saving the admin settings does. */
const switchVersions = (ctx: MediumTestContext, enabled: boolean) => {
  clearConfigCache();
  ctx.getMock(SystemMetadataRepository).get.mockImplementation((key) => {
    if (key === SystemMetadataKey.SystemConfig) {
      return { server: { assetVersions: { enabled, detectEdits: true } } } as never;
    }
    return undefined as never;
  });
};

/** Whether anything about a file is kept for versions: its "read" stamp, or its row. */
const isRemembered = async (assetId: string) => {
  const stamp = await defaultDatabase
    .selectFrom('asset_job_status_gallery')
    .select('versionsParserVersion')
    .where('assetId', '=', assetId)
    .where('versionsParserVersion', 'is not', null)
    .executeTakeFirst();
  return !!stamp || (await isInAShot(assetId));
};

const isInAShot = async (assetId: string) =>
  !!(await defaultDatabase
    .selectFrom('asset_version')
    .select('versionAssetId')
    .where('versionAssetId', '=', assetId)
    .executeTakeFirst());

const stackOf = async (id: string) => {
  const row = await defaultDatabase
    .selectFrom('asset')
    .leftJoin('stack', 'stack.id', 'asset.stackId')
    .select(['asset.stackId', 'stack.primaryAssetId'])
    .where('asset.id', '=', id)
    .executeTakeFirstOrThrow();
  return row;
};

/** How a file went behind its photo, if it did: the photo, and the rule its row keeps. */
const combinedOf = async (assetId: string) => {
  const row = await defaultDatabase
    .selectFrom('asset_version')
    .select(['assetId', 'rule'])
    .where('versionAssetId', '=', assetId)
    .where('role', '=', 'version')
    .executeTakeFirst();
  return row ? { photoId: row.assetId, rule: row.rule } : undefined;
};

/** The log lines saying a file was left apart. */
const leftApartLines = (ctx: MediumTestContext, assetId: string) =>
  logged(ctx).filter((line) => line.includes(`(${assetId}) not combined`));

const editJobs = (ctx: MediumTestContext, id: string) =>
  ctx
    .getMock(JobRepository)
    .queue.mock.calls.filter(
      ([item]) => item.name === JobName.AssetEditThumbnailGeneration && (item.data as { id: string }).id === id,
    ).length;

const logged = (ctx: MediumTestContext) =>
  ctx
    .getMock(LoggingRepository)
    .log.mock.calls.map(([message]) => message as string)
    .filter((message) => message.startsWith('Versions:'));

describe(AssetVersionService.name, () => {
  describe('a file goes behind its photo', () => {
    it('removes what the photo has too, copies its tags, dissolves a two-asset stack and hides it', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_1.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_1.NEF');
      const { album } = await ctx.newAlbum({ ownerId: user.id, albumThumbnailAssetId: raw.id });
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const { sharedLink } = await ctx.newSharedLink({
        userId: user.id,
        type: SharedLinkType.Individual,
        assetIds: [photo.id, raw.id],
      });
      for (const asset of [photo, raw]) {
        await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
        await defaultDatabase.insertInto('asset_favorite').values({ userId: user.id, assetId: asset.id }).execute();
      }
      // a keyword only the RAW carries
      const { tag } = await ctx.newTag({ userId: user.id, value: 'trip' });
      await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [raw.id] });
      const { stack } = await ctx.newStack({ ownerId: user.id }, [photo.id, raw.id]);

      await pair(ctx, photo.id, raw.id);

      expect(await visibilityOf(raw.id)).toEqual({ visibility: AssetVisibility.Hidden, stackId: null });
      expect(await visibilityOf(photo.id)).toEqual({ visibility: AssetVisibility.Timeline, stackId: null });
      expect(await defaultDatabase.selectFrom('stack').where('id', '=', stack.id).selectAll().execute()).toEqual([]);
      expect(await assetIdsIn('album_asset', 'albumId', album.id)).toEqual([photo.id]);
      expect(await assetIdsIn('shared_space_asset', 'spaceId', space.id)).toEqual([photo.id]);
      expect(await assetIdsIn('shared_link_asset', 'sharedLinkId', sharedLink.id)).toEqual([photo.id]);
      expect(await assetIdsIn('asset_favorite', 'userId', user.id)).toEqual([photo.id]);
      // its keyword is the photo's too now, and stays on the file it came from
      expect(await assetIdsIn('tag_asset', 'tagId', tag.id)).toEqual([photo.id, raw.id].toSorted());
      const cover = await defaultDatabase
        .selectFrom('album')
        .select('albumThumbnailAssetId')
        .where('id', '=', album.id)
        .executeTakeFirstOrThrow();
      expect(cover.albumThumbnailAssetId).toBe(photo.id);
      // how it was shown before, for switching back: in the timeline, and stacked with its photo
      const [row] = await versionRows(user.id);
      expect(row).toMatchObject({
        versionAssetId: raw.id,
        assetId: photo.id,
        priorVisibility: 'timeline',
        wasStacked: true,
      });
      // the list: the photo's own file and the RAW behind it; the photo shows its own file
      const list = await sut.getVersions(authOf(user), photo.id);
      expect(list.versions.map(({ id, kind, shown }) => ({ id, kind, shown }))).toEqual([
        { id: photo.id, kind: 'original', shown: true },
        { id: raw.id, kind: 'raw', shown: false },
      ]);
    });

    it('refuses a file with a face drawn or named on it by hand: it would be on no visible photo', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const repository = ctx.get(AssetVersionRepository);
      const photo = await newPhoto(ctx, user.id, 'DSC_3.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_3.NEF');
      // found by the face job: stays with its file, as on any version
      await ctx.newAssetFace({ assetId: raw.id, sourceType: SourceType.MachineLearning });
      const drawn = await newPhoto(ctx, user.id, 'DSC_4.NEF');
      const other = await newPhoto(ctx, user.id, 'DSC_4.JPG');
      await ctx.newAssetFace({ assetId: drawn.id, sourceType: SourceType.Manual });

      expect(await repository.pair({ ...PAIR_INPUT, photoId: photo.id, versionId: raw.id })).toMatchObject({
        paired: true,
      });
      expect(await repository.pair({ ...PAIR_INPUT, photoId: other.id, versionId: drawn.id })).toEqual({
        paired: false,
        reason: 'has-own-attachments',
      });
      expect(await visibilityOf(drawn.id)).toMatchObject({ visibility: AssetVisibility.Timeline });

      // a face the face job found, whose person someone set by hand: the same
      const named = await newPhoto(ctx, user.id, 'DSC_5.NEF');
      const namedPhoto = await newPhoto(ctx, user.id, 'DSC_5.JPG');
      const { assetFace } = await ctx.newAssetFace({ assetId: named.id, sourceType: SourceType.MachineLearning });
      const identity = await defaultDatabase
        .insertInto('face_identity')
        .defaultValues()
        .returning('id')
        .executeTakeFirstOrThrow();
      await defaultDatabase
        .insertInto('face_identity_face')
        .values({ assetFaceId: assetFace.id, identityId: identity.id, source: 'manual' })
        .execute();
      expect(await repository.pair({ ...PAIR_INPUT, photoId: namedPhoto.id, versionId: named.id })).toEqual({
        paired: false,
        reason: 'has-own-attachments',
      });
    });

    it('refuses a file that has something the photo does not, and changes nothing', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: friend } = await ctx.newUser();
      const repository = ctx.get(AssetVersionRepository);
      const input = { kind: 'raw', source: 'camera', rule: 'raw:name', photo: PHOTO, read: null } as const;
      const refused = { paired: false, reason: 'has-own-attachments' };
      const { album } = await ctx.newAlbum({ ownerId: user.id });

      // in an album the photo is not in
      const photo = await newPhoto(ctx, user.id, 'DSC_2.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_2.NEF');
      await ctx.newAlbumAsset({ albumId: album.id, assetId: raw.id });
      expect(await repository.pair({ ...input, photoId: photo.id, versionId: raw.id })).toEqual(refused);

      // in the same album, but with a comment of its own: it would be deleted with the album entry
      await ctx.newAlbumAsset({ albumId: album.id, assetId: photo.id });
      await defaultDatabase
        .insertInto('activity')
        .values({ albumId: album.id, userId: friend.id, assetId: raw.id, comment: 'lovely', isLiked: false })
        .execute();
      expect(await repository.pair({ ...input, photoId: photo.id, versionId: raw.id })).toEqual(refused);

      // a favourite, or a shared link, of its own
      const other = await newPhoto(ctx, user.id, 'DSC_2b.JPG');
      const favourite = await newPhoto(ctx, user.id, 'DSC_2b.NEF');
      await defaultDatabase.insertInto('asset_favorite').values({ userId: user.id, assetId: favourite.id }).execute();
      expect(await repository.pair({ ...input, photoId: other.id, versionId: favourite.id })).toEqual(refused);
      const linked = await newPhoto(ctx, user.id, 'DSC_2c.NEF');
      await ctx.newSharedLink({ userId: user.id, type: SharedLinkType.Individual, assetIds: [linked.id] });
      expect(await repository.pair({ ...input, photoId: other.id, versionId: linked.id })).toEqual(refused);

      // a caption the user wrote on it in Gallery; the same caption on both is no difference
      const captioned = await newPhoto(ctx, user.id, 'DSC_2d.NEF');
      const caption = { description: 'Granny at the lake', lockedProperties: ['description' as const] };
      await defaultDatabase.updateTable('asset_exif').set(caption).where('assetId', '=', captioned.id).execute();
      expect(await repository.pair({ ...input, photoId: other.id, versionId: captioned.id })).toEqual(refused);
      await defaultDatabase.updateTable('asset_exif').set(caption).where('assetId', '=', other.id).execute();
      expect(await repository.pair({ ...input, photoId: other.id, versionId: captioned.id })).toMatchObject({
        paired: true,
      });

      expect(await versionRows(user.id)).toHaveLength(1);
      expect(await visibilityOf(raw.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
      expect(await assetIdsIn('album_asset', 'albumId', album.id)).toEqual([photo.id, raw.id].toSorted());
      const comments = await defaultDatabase
        .selectFrom('activity')
        .select('assetId')
        .where('albumId', '=', album.id)
        .execute();
      expect(comments).toEqual([{ assetId: raw.id }]);
    });

    it('remembers a stack only when the file shared it with its photo', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      // not stacked at all
      const plainPhoto = await newPhoto(ctx, user.id, 'DSC_60.JPG');
      const plainRaw = await newPhoto(ctx, user.id, 'DSC_60.NEF');
      // the RAW is stacked, with another photo: not with the one it goes behind
      const photo = await newPhoto(ctx, user.id, 'DSC_61.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_61.NEF');
      const other = await newPhoto(ctx, user.id, 'DSC_62.JPG');
      await ctx.newStack({ ownerId: user.id }, [other.id, raw.id]);

      await pair(ctx, plainPhoto.id, plainRaw.id);
      await pair(ctx, photo.id, raw.id);

      const rows = await versionRows(user.id);
      expect(rows.find((row) => row.versionAssetId === plainRaw.id)).toMatchObject({ wasStacked: false });
      expect(rows.find((row) => row.versionAssetId === raw.id)).toMatchObject({ wasStacked: false });
    });

    it('keeps a burst stack and only takes the version out of it', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_3.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_3.NEF');
      const next = await newPhoto(ctx, user.id, 'DSC_4.JPG');
      const { stack } = await ctx.newStack({ ownerId: user.id }, [raw.id, photo.id, next.id]);

      await pair(ctx, photo.id, raw.id);

      const value1 = await visibilityOf(photo.id);
      expect(value1.stackId).toBe(stack.id);
      const value2 = await visibilityOf(next.id);
      expect(value2.stackId).toBe(stack.id);
      const row = await defaultDatabase
        .selectFrom('stack')
        .select('primaryAssetId')
        .where('id', '=', stack.id)
        .executeTakeFirstOrThrow();
      expect(row.primaryAssetId).toBe(photo.id);
    });

    it('never makes a trashed member the face of the stack it leaves', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_32.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_32.NEF');
      const trashed = await newPhoto(ctx, user.id, 'DSC_33.JPG', { deletedAt: new Date() });
      const shown = await newPhoto(ctx, user.id, 'DSC_34.JPG');
      const { stack } = await ctx.newStack({ ownerId: user.id }, [raw.id, trashed.id, shown.id]);

      await pair(ctx, photo.id, raw.id);

      // one shown member left: the stack is dissolved rather than headed by the trashed one
      expect(await defaultDatabase.selectFrom('stack').select('id').where('id', '=', stack.id).execute()).toEqual([]);
      const value8 = await visibilityOf(shown.id);
      expect(value8.stackId).toBeNull();
    });

    it('keeps the photo the photo: a file with versions behind it, or behind another, never goes behind', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_6.JPG');
      const other = await newPhoto(ctx, user.id, 'DSC_7.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_6.NEF');
      await pair(ctx, photo.id, raw.id);
      const repository = ctx.get(AssetVersionRepository);
      const input = { kind: 'raw', source: 'camera', rule: 'raw:name', photo: PHOTO, read: null } as const;

      // the photo of a shot stays the photo
      expect(await repository.pair({ ...input, photoId: other.id, versionId: photo.id })).toEqual({
        paired: false,
        reason: 'two-photos',
      });
      expect(await repository.pair({ ...input, photoId: other.id, versionId: raw.id })).toEqual({
        paired: false,
        reason: 'version-of-another-photo',
      });
      // nothing goes behind a version, or behind itself
      expect(await repository.pair({ ...input, photoId: raw.id, versionId: other.id })).toMatchObject({
        paired: false,
      });
      expect(await repository.pair({ ...input, photoId: other.id, versionId: other.id })).toMatchObject({
        paired: false,
      });
      expect(await versionRows(user.id)).toHaveLength(1);
    });

    it('serves the photo’s own file like a version, and refuses a version id of another photo', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_36.JPG');
      const other = await newPhoto(ctx, user.id, 'DSC_37.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_36.NEF');
      await pair(ctx, photo.id, raw.id);

      await expect(sut.viewImage(authOf(user), other.id, raw.id, 'thumbnail')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(sut.downloadOriginal(authOf(user), other.id, raw.id, true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await ctx.newAssetFile({ assetId: photo.id, type: AssetFileType.Thumbnail, path: '/thumbs/36.webp' });
      expect(await attempt(sut.viewImage(authOf(user), photo.id, photo.id, 'thumbnail'))).toBe(true);
      expect(await attempt(sut.downloadOriginal(authOf(user), photo.id, photo.id, true))).toBe(true);
    });

    it('does not serve the unedited file of a photo that has no versions, to its owner or through a shared link', async () => {
      // a photo cropped in Gallery's editor and shared by link: Immich shows the link only the cropped image, and
      // this route must not be a way around that
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const plain = await newPhoto(ctx, user.id, 'DSC_38.JPG');
      await ctx.newAssetFile({ assetId: plain.id, type: AssetFileType.Preview, path: '/thumbs/38.jpeg' });
      const { sharedLink } = await ctx.newSharedLink({
        userId: user.id,
        type: SharedLinkType.Individual,
        assetIds: [plain.id],
      });
      const viaLink = factory.auth({
        user: { id: user.id, email: user.email },
        sharedLink: { id: sharedLink.id, allowDownload: true, showExif: true },
      });

      for (const auth of [authOf(user), viaLink]) {
        await expect(sut.viewImage(auth, plain.id, plain.id, 'preview')).rejects.toBeInstanceOf(NotFoundException);
        await expect(sut.downloadOriginal(auth, plain.id, plain.id, true)).rejects.toBeInstanceOf(NotFoundException);
        const list = await sut.getVersions(auth, plain.id);
        expect(list.versions).toEqual([]);
      }
    });
  });

  describe('detection', () => {
    it('puts a RAW behind its camera JPEG, and leaves an exported edit alone while edits are off', async () => {
      const { sut, ctx } = setup({ detectEdits: false });
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_9.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_9.NEF');
      const edit = await newPhoto(ctx, user.id, 'DSC_9-Edit.jpg');
      readTagsFrom(ctx, {
        [photo.originalPath]: nikon(),
        [raw.originalPath]: nikon(),
        [edit.originalPath]: lightroom('DSC_9.NEF'),
      });

      await sut.handleDetect({ id: edit.id, force: true });
      await sut.handleDetect({ id: raw.id, force: true });

      expect(await behind(photo.id)).toEqual([
        { versionAssetId: raw.id, kind: 'raw', rule: 'raw:name', source: 'camera' },
      ]);
      expect(await visibilityOf(raw.id)).toMatchObject({ visibility: AssetVisibility.Hidden });
      expect(await visibilityOf(photo.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
      expect(await visibilityOf(edit.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
      expect(await versionRows(user.id)).toHaveLength(1);
      // no edit behind it: its picture is its own
      expect(editJobs(ctx, photo.id)).toBe(0);
    });

    it.each([
      ['the first RAW', 0],
      ['the JPEG', 1],
      ['the second RAW', 2],
    ])('leaves a JPEG between two RAWs of its name apart, whichever job runs first (%s)', async (_, first) => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const rawA = await newPhoto(ctx, user.id, 'DSC_50.NEF', {
        ...takenAtSecond('00'),
      });
      const jpeg = await newPhoto(ctx, user.id, 'DSC_50.JPG', {
        ...takenAtSecond('09'),
      });
      const rawB = await newPhoto(ctx, user.id, 'DSC_50.NEF', {
        ...takenAtSecond('18'),
      });
      readTagsFrom(ctx, {
        [rawA.originalPath]: nikonAt('00'),
        [jpeg.originalPath]: nikonAt('09'),
        [rawB.originalPath]: nikonAt('18'),
      });
      const files = [rawA, jpeg, rawB];

      for (const file of [...files.slice(first), ...files.slice(0, first)]) {
        await sut.handleDetect({ id: file.id, force: true });
      }

      // each stored in a folder of its own: the JPEG is as close to one RAW as to the other, and goes with neither
      expect(await versionRows(user.id)).toEqual([]);
    });

    it('searches around the files it is about to pair: a RAW between two JPEGs of its name goes with neither', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      // an edit at 0 s finds the JPEG (9 s) and the RAW (18 s); the second JPEG (27 s) is beyond its own search
      const edit = await newPhoto(ctx, user.id, 'DSC_60-Edit.jpg', {
        ...takenAtSecond('00'),
      });
      const jpegA = await newPhoto(ctx, user.id, 'DSC_60.JPG', {
        ...takenAtSecond('09'),
      });
      const raw = await newPhoto(ctx, user.id, 'DSC_60.NEF', {
        ...takenAtSecond('18'),
      });
      const jpegB = await newPhoto(ctx, user.id, 'DSC_60.JPG', {
        ...takenAtSecond('27'),
      });
      readTagsFrom(ctx, {
        [edit.originalPath]: {
          ...lightroom('DSC_60.NEF'),
          SubSecDateTimeOriginal: { rawValue: '2026:08:17 20:59:00.00-04:00' },
        },
        [jpegA.originalPath]: nikonAt('09'),
        [raw.originalPath]: nikonAt('18'),
        [jpegB.originalPath]: nikonAt('27'),
      });

      await sut.handleDetect({ id: edit.id, force: true });

      // the RAW is as much the second JPEG's as the first's: it goes behind neither
      const rows = await versionRows(user.id);
      expect(rows).not.toContainEqual(expect.objectContaining({ versionAssetId: raw.id, assetId: jpegA.id }));
      expect(rows).not.toContainEqual(expect.objectContaining({ versionAssetId: raw.id, assetId: jpegB.id }));
      expect(rows).not.toContainEqual(expect.objectContaining({ versionAssetId: jpegA.id }));
    });

    it('combines the files stored side by side under one name, with no capture time, and prefers them to a match in another folder', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      // a film scan's TIFF and a HEIC of it, neither with a capture time, and their dates far apart
      const tif = await newPhoto(ctx, user.id, 'roll12_07.tif', {
        originalPath: '/library/Roll 12/roll12_07.tif',
        localDateTime: new Date('2025-02-01T10:00:00.000Z'),
      });
      const heic = await newPhoto(ctx, user.id, 'roll12_07.heic', {
        originalPath: '/library/Roll 12/roll12_07.heic',
        localDateTime: new Date('2026-06-01T10:00:00.000Z'),
      });
      // a RAW and its JPEG side by side, and a JPEG of the same name and time in another folder
      const raw = await newPhoto(ctx, user.id, 'DSC_70.NEF', {
        originalPath: '/library/Trip/DSC_70.NEF',
        ...takenAtSecond('00'),
      });
      const jpeg = await newPhoto(ctx, user.id, 'DSC_70.JPG', {
        originalPath: '/library/Trip/DSC_70.JPG',
        ...takenAtSecond('00'),
      });
      const copy = await newPhoto(ctx, user.id, 'DSC_70.JPG', {
        originalPath: '/library/Copies/DSC_70.JPG',
        ...takenAtSecond('00'),
      });
      readTagsFrom(ctx, {
        [tif.originalPath]: { Software: 'VueScan 9.8' },
        [heic.originalPath]: { Software: 'Photos 9.0' },
        [raw.originalPath]: nikonAt('00'),
        [jpeg.originalPath]: nikonAt('00'),
        [copy.originalPath]: nikonAt('00'),
      });

      for (const asset of [tif, heic, copy, raw, jpeg]) {
        await sut.handleDetect({ id: asset.id, force: true });
      }

      expect(await behind(heic.id)).toMatchObject([{ versionAssetId: tif.id, kind: 'raw', rule: 'raw:folder' }]);
      expect(await behind(jpeg.id)).toMatchObject([{ versionAssetId: raw.id, kind: 'raw', rule: 'raw:folder' }]);
      expect(await visibilityOf(copy.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
      expect(await behind(copy.id)).toEqual([]);
    });

    it('finds a folder pair whose stored names the storage template changed alike', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      // a template that puts something before the name: both stored as `scan-…`, both arrived as `roll12_08.…`
      const tif = await newPhoto(ctx, user.id, 'roll12_08.tif', {
        originalPath: '/library/2026/scan-roll12_08.tif',
        localDateTime: new Date('2025-02-01T10:00:00.000Z'),
      });
      const heic = await newPhoto(ctx, user.id, 'roll12_08.heic', {
        originalPath: '/library/2026/scan-roll12_08.heic',
        localDateTime: new Date('2026-06-01T10:00:00.000Z'),
      });
      readTagsFrom(ctx, {
        [tif.originalPath]: { Software: 'VueScan 9.8' },
        [heic.originalPath]: { Software: 'Photos 9.0' },
      });

      await sut.handleDetect({ id: tif.id, force: true });

      expect(await behind(heic.id)).toMatchObject([{ versionAssetId: tif.id, kind: 'raw', rule: 'raw:folder' }]);
    });

    it('reads a combined file again in an "All" run before deciding: an instruction given since counts, whichever job comes first', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_80.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_80.NEF');
      const tags: Record<string, Record<string, unknown>> = {
        [photo.originalPath]: nikon(),
        [raw.originalPath]: nikon(),
      };
      readTagsFrom(ctx, tags);
      await sut.handleDetect({ id: raw.id, force: true });
      expect(await behind(photo.id)).toMatchObject([{ versionAssetId: raw.id }]);

      // later, the photo is marked to be kept apart in its sidecar, and an export of the RAW arrives
      const sidecar = `${photo.originalPath}.xmp`;
      await ctx.newAssetFile({ assetId: photo.id, type: AssetFileType.Sidecar, path: sidecar });
      tags[sidecar] = { Instructions: 'noodle-gallery:keep-apart' };
      const edit = await newPhoto(ctx, user.id, 'DSC_80-Edit.jpg');
      tags[edit.originalPath] = lightroom('DSC_80.NEF');
      const readTags = ctx.getMock(MetadataRepository).readTags;
      readTags.mockClear();

      // the run's first job is the export's: the photo's kept read is from before the run
      await sut.handleDetect({ id: edit.id, force: true, runStartedAt: new Date(Date.now() + 60_000).toISOString() });

      expect(readTags.mock.calls.map(([path]) => path)).toContain(sidecar);
      expect(await behind(photo.id)).toMatchObject([{ versionAssetId: raw.id }]);
      expect(await visibilityOf(edit.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
    });

    it('searches at the exact time of a file it is about to pair: an edit that names two sources goes with neither', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      // the JPEG's job finds the edit by its name; the RAW it also names was renamed, and is found only by its time
      const photo = await newPhoto(ctx, user.id, 'DSC_61.JPG', { ...takenAtSecond('00') });
      const edit = await newPhoto(ctx, user.id, 'DSC_61-Edit.jpg', { ...takenAtSecond('09') });
      const renamed = await newPhoto(ctx, user.id, 'renamed.NEF', { ...takenAtSecond('09') });
      readTagsFrom(ctx, {
        [photo.originalPath]: nikonAt('00'),
        [edit.originalPath]: {
          ...lightroom('DSC_61.NEF'),
          RawFileName: 'renamed.NEF',
          SerialNumber: undefined,
          SubSecDateTimeOriginal: { rawValue: '2026:08:17 20:59:09.00-04:00' },
          DateTimeOriginal: { rawValue: '2026:08:17 20:59:09.00-04:00' },
        },
        [renamed.originalPath]: nikonAt('09'),
      });

      await sut.handleDetect({ id: photo.id, force: true });

      // it could have been made from either: it stays a photo of its own
      expect(await behind(photo.id)).not.toContainEqual(expect.objectContaining({ versionAssetId: edit.id }));
    });

    it('puts an iPhone edit behind its photo when the edit arrives first, taken a moment apart', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const edit = await newPhoto(ctx, user.id, 'IMG_E4321.JPG', {
        localDateTime: new Date('2026-08-17T20:59:06.120Z'),
        fileModifiedAt: new Date('2026-09-01T10:00:00Z'),
      });
      readTagsFrom(ctx, { [edit.originalPath]: apple('06') });
      await sut.handleDetect({ id: edit.id, force: true });
      expect(await versionRows(user.id)).toEqual([]);

      // the original arrives later; its own search finds the edited copy
      const photo = await newPhoto(ctx, user.id, 'IMG_4321.HEIC', {
        localDateTime: new Date('2026-08-17T20:59:04.120Z'),
      });
      readTagsFrom(ctx, { [edit.originalPath]: apple('06'), [photo.originalPath]: apple('04') });
      await sut.handleDetect({ id: photo.id, force: true });

      expect(await behind(photo.id)).toEqual([expect.objectContaining({ versionAssetId: edit.id, kind: 'edit' })]);
    });

    it('reads each file once in an "All" run: a file read by another job of the run is not read again', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_19.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_19.NEF');
      readTagsFrom(ctx, { [photo.originalPath]: nikon(), [raw.originalPath]: nikon() });
      const readTags = ctx.getMock(MetadataRepository).readTags;
      const timesRead = (path: string) => readTags.mock.calls.filter(([read]) => read === path).length;

      // an "All" run: the RAW's job reads both files and combines them; the photo's job then finds its own read
      // from this run, kept on its row
      const runStartedAt = new Date().toISOString();
      await sut.handleDetect({ id: raw.id, force: true, runStartedAt });
      expect(await behind(photo.id)).toHaveLength(1);
      await sut.handleDetect({ id: photo.id, force: true, runStartedAt });
      expect(timesRead(raw.originalPath)).toBe(1);
      expect(timesRead(photo.originalPath)).toBe(1);
      // kept as an object on both rows, as the jobs read it back
      const kept = await defaultDatabase
        .selectFrom('asset_version')
        .select(sql<string>`jsonb_typeof("read")`.as('type'))
        .where('versionAssetId', 'in', [photo.id, raw.id])
        .execute();
      expect(kept).toEqual([{ type: 'object' }, { type: 'object' }]);

      // a run that started later reads it again; so does "check this photo again", which has no run
      await sut.handleDetect({ id: photo.id, force: true, runStartedAt: new Date(Date.now() + 1000).toISOString() });
      await sut.handleDetect({ id: photo.id, force: true });
      expect(timesRead(photo.originalPath)).toBe(3);
      expect(await behind(photo.id)).toHaveLength(1);
    });

    it('gives every job of an "All" run the time the run started, and the jobs of a "Missing" run none', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_20.JPG');
      const queueAll = ctx.getMock(JobRepository).queueAll;
      const detectJobsOf = () =>
        queueAll.mock.calls
          .flatMap(([items]) => items)
          .filter((item) => item.name === JobName.AssetVersionDetect && item.data.id === photo.id);

      await sut.handleQueueAll({ force: true });
      const [all] = detectJobsOf();
      expect(all.data).toEqual({ id: photo.id, force: true, runStartedAt: expect.any(String) });

      queueAll.mockClear();
      await sut.handleQueueAll({ force: false });
      expect(detectJobsOf().map(({ data }) => data)).toEqual([{ id: photo.id, force: false, runStartedAt: undefined }]);
    });

    it('follows the two instructions a person can give a file: one names the photo it is a version of, one keeps it apart', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_9.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_9.NEF');
      // two copies of the camera's JPEG with the glare removed, under names of their own
      const fix = await newPhoto(ctx, user.id, 'glare-fix-1.jpg');
      const untagged = await newPhoto(ctx, user.id, 'glare-fix-2.jpg');
      // and an export named after the shot that its owner wants kept as a photo of its own
      const kept = await newPhoto(ctx, user.id, 'DSC_9-Edit.jpg');
      const copy = nikon({ ShutterCount: undefined });
      readTagsFrom(ctx, {
        [photo.originalPath]: nikon(),
        [raw.originalPath]: nikon(),
        [fix.originalPath]: { ...copy, Instructions: 'print 20x30\nnoodle-gallery:version-of=DSC_9.JPG' },
        [untagged.originalPath]: copy,
        [kept.originalPath]: { ...lightroom('DSC_9.NEF'), Instructions: 'noodle-gallery:keep-apart' },
      });

      for (const asset of [fix, untagged, kept, raw, photo]) {
        await sut.handleDetect({ id: asset.id, force: true });
      }

      expect(await behind(photo.id)).toMatchObject([
        { versionAssetId: fix.id, kind: 'edit', rule: 'edit:time' },
        { versionAssetId: raw.id, kind: 'raw', rule: 'raw:name' },
      ]);
      expect(await visibilityOf(untagged.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
      expect(await visibilityOf(kept.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
    });

    it('makes the edit an instruction names the photo when its RAW is not in Gallery, and a RAW added later goes behind it', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      // an export whose RAW is kept elsewhere, and a fix made from it that names it
      const exported = await newPhoto(ctx, user.id, 'DSC_7-Edit.jpg');
      const fix = await newPhoto(ctx, user.id, 'amend-1.jpg');
      const tags: Record<string, Record<string, unknown>> = {
        [exported.originalPath]: lightroom('DSC_7.NEF'),
        [fix.originalPath]: {
          ...lightroom('DSC_7.NEF', 'amend'),
          Instructions: 'noodle-gallery:version-of=DSC_7-Edit.jpg',
        },
      };
      readTagsFrom(ctx, tags);

      await sut.handleDetect({ id: exported.id, force: true });
      await sut.handleDetect({ id: fix.id, force: true });

      expect(await behind(exported.id)).toMatchObject([{ versionAssetId: fix.id, kind: 'edit', rule: 'edit:time' }]);

      // the RAW turns up
      const raw = await newPhoto(ctx, user.id, 'DSC_7.NEF');
      tags[raw.originalPath] = nikon();
      await sut.handleDetect({ id: raw.id, force: true });

      expect(await behind(exported.id)).toMatchObject([
        { versionAssetId: fix.id, kind: 'edit' },
        { versionAssetId: raw.id, kind: 'raw', rule: 'raw:name' },
      ]);
      expect(await visibilityOf(exported.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
    });

    it("reads a file's instructions from its sidecar too, where programs write a RAW's, and never from its keywords", async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      // a RAW its owner marked in Lightroom, which wrote the instruction into the RAW's sidecar
      const photo = await newPhoto(ctx, user.id, 'DSC_5.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_5.NEF');
      const sidecar = `${raw.originalPath}.xmp`;
      await ctx.newAssetFile({ assetId: raw.id, type: AssetFileType.Sidecar, path: sidecar });
      // a JPEG with the instruction as a keyword, which Immich turns into a tag: it says nothing
      const tagged = await newPhoto(ctx, user.id, 'DSC_6.JPG');
      const taggedRaw = await newPhoto(ctx, user.id, 'DSC_6.NEF');
      readTagsFrom(ctx, {
        [photo.originalPath]: nikon(),
        [raw.originalPath]: nikon(),
        [sidecar]: { Instructions: 'noodle-gallery:keep-apart' },
        [tagged.originalPath]: nikon({ Keywords: ['noodle-gallery:keep-apart'] }),
        [taggedRaw.originalPath]: nikon(),
      });

      for (const asset of [raw, photo, taggedRaw, tagged]) {
        await sut.handleDetect({ id: asset.id, force: true });
      }

      expect(await behind(photo.id)).toEqual([]);
      expect(await visibilityOf(raw.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
      expect(await behind(tagged.id)).toMatchObject([{ versionAssetId: taggedRaw.id, kind: 'raw', rule: 'raw:name' }]);
    });

    it('puts an exported edit behind the photo, which keeps its id and everything on it, and has its picture rendered from the edit', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_9.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_9.NEF');
      await pair(ctx, photo.id, raw.id);
      const { album } = await ctx.newAlbum({ ownerId: user.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: photo.id });
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: photo.id, addedById: user.id });
      await defaultDatabase.insertInto('asset_favorite').values({ userId: user.id, assetId: photo.id }).execute();

      // then the edit arrives
      const edit = await newPhoto(ctx, user.id, 'DSC_9-Edit.jpg');
      readTagsFrom(ctx, {
        [photo.originalPath]: nikon(),
        [raw.originalPath]: nikon(),
        [edit.originalPath]: lightroom('DSC_9.NEF'),
      });
      await sut.handleDetect({ id: edit.id, force: true });

      expect(await behind(photo.id)).toEqual([
        { versionAssetId: edit.id, kind: 'edit', rule: 'edit:name', source: 'lightroom' },
        { versionAssetId: raw.id, kind: 'raw', rule: 'raw:name', source: 'camera' },
      ]);
      expect(await visibilityOf(photo.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
      expect(await visibilityOf(edit.id)).toMatchObject({ visibility: AssetVisibility.Hidden });
      // nothing on the photo was touched
      expect(await assetIdsIn('album_asset', 'albumId', album.id)).toEqual([photo.id]);
      expect(await assetIdsIn('shared_space_asset', 'spaceId', space.id)).toEqual([photo.id]);
      expect(await assetIdsIn('asset_favorite', 'userId', user.id)).toEqual([photo.id]);
      // its picture is to be rendered from the edit, by the edit job
      expect(editJobs(ctx, photo.id)).toBe(1);

      // until that has run, the photo shows its own file; then the edit is the one shown
      const before = await sut.getVersions(authOf(user), photo.id);
      expect(before.versions.map(({ id, kind, shown }) => ({ id, kind, shown }))).toEqual([
        { id: edit.id, kind: 'edit', shown: false },
        { id: photo.id, kind: 'original', shown: true },
        { id: raw.id, kind: 'raw', shown: false },
      ]);
      await rendered(ctx, photo.id, edit.id);
      const after = await sut.getVersions(authOf(user), photo.id);
      expect(after.versions.filter(({ shown }) => shown).map(({ id }) => id)).toEqual([edit.id]);

      // running again, from any of the three files, changes nothing and asks for no new render
      await sut.handleDetect({ id: photo.id, force: true });
      await sut.handleDetect({ id: raw.id, force: true });
      expect(await versionRows(user.id)).toHaveLength(2);
      expect(editJobs(ctx, photo.id)).toBe(1);
    });

    it('renders the picture from a later edit again, and not from an older one that arrives late', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_9.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_9.NEF');
      const first = await newPhoto(ctx, user.id, 'first.jpg', { fileModifiedAt: new Date('2026-09-01T10:00:00Z') });
      const tags: Record<string, Record<string, unknown>> = {
        [photo.originalPath]: nikon(),
        [raw.originalPath]: nikon(),
        [first.originalPath]: lightroom('DSC_9.NEF', 'first'),
      };
      readTagsFrom(ctx, tags);
      await sut.handleDetect({ id: first.id, force: true });
      expect(editJobs(ctx, photo.id)).toBe(1);
      await rendered(ctx, photo.id, first.id);

      // a second edit, written later
      const second = await newPhoto(ctx, user.id, 'second.jpg', { fileModifiedAt: new Date('2026-10-01T10:00:00Z') });
      tags[second.originalPath] = lightroom('DSC_9.NEF', 'second');
      await sut.handleDetect({ id: second.id, force: true });
      expect(await visibilityOf(second.id)).toMatchObject({ visibility: AssetVisibility.Hidden });
      expect(editJobs(ctx, photo.id)).toBe(2);
      // a render that finished from the first while the second went behind is caught when it reports success
      await sut.onJobSuccess({
        job: { name: JobName.AssetEditThumbnailGeneration, data: { id: photo.id } },
        response: JobStatus.Success,
      } as never);
      expect(editJobs(ctx, photo.id)).toBe(3);
      await rendered(ctx, photo.id, second.id);

      // an edit written before both, uploaded last: it goes behind, and the picture stays
      const early = await newPhoto(ctx, user.id, 'early.jpg', { fileModifiedAt: new Date('2026-08-20T10:00:00Z') });
      tags[early.originalPath] = lightroom('DSC_9.NEF', 'early');
      await sut.handleDetect({ id: early.id, force: true });
      await sut.onJobSuccess({
        job: { name: JobName.AssetEditThumbnailGeneration, data: { id: photo.id } },
        response: JobStatus.Success,
      } as never);
      expect(await visibilityOf(early.id)).toMatchObject({ visibility: AssetVisibility.Hidden });
      expect(editJobs(ctx, photo.id)).toBe(3);

      // the list: edits newest first, then the photo's own file, then the RAW
      const list = await sut.getVersions(authOf(user), photo.id);
      expect(list.versions.map(({ id, shown }) => ({ id, shown }))).toEqual([
        { id: second.id, shown: true },
        { id: first.id, shown: false },
        { id: early.id, shown: false },
        { id: photo.id, shown: false },
        { id: raw.id, shown: false },
      ]);
      // each edit comes with the time it was written, which is what put it in that order: clients show it
      expect(list.versions.slice(0, 3).map(({ fileModifiedAt }) => fileModifiedAt)).toEqual([
        '2026-10-01T10:00:00.000Z',
        '2026-09-01T10:00:00.000Z',
        '2026-08-20T10:00:00.000Z',
      ]);
      // not the time the photo was taken, which the three edits share
      expect(new Set(list.versions.slice(0, 3).map(({ fileCreatedAt }) => fileCreatedAt)).size).toBe(1);
    });

    it('makes the file that was organised the photo, so nothing moves: an edit in an album, its originals behind it', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_9.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_9.NEF');
      const edit = await newPhoto(ctx, user.id, 'DSC_9-Edit.jpg');
      const { album } = await ctx.newAlbum({ ownerId: user.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: edit.id });
      await defaultDatabase.insertInto('asset_favorite').values({ userId: user.id, assetId: edit.id }).execute();
      readTagsFrom(ctx, {
        [photo.originalPath]: nikon(),
        [raw.originalPath]: nikon(),
        [edit.originalPath]: lightroom('DSC_9.NEF'),
      });

      await sut.handleDetect({ id: photo.id, force: true });

      expect(await behind(edit.id)).toEqual([
        { versionAssetId: photo.id, kind: 'original', rule: 'original:name', source: 'camera' },
        { versionAssetId: raw.id, kind: 'raw', rule: 'raw:name', source: 'camera' },
      ]);
      expect(await visibilityOf(edit.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
      expect(await assetIdsIn('album_asset', 'albumId', album.id)).toEqual([edit.id]);
      expect(await assetIdsIn('asset_favorite', 'userId', user.id)).toEqual([edit.id]);
      // it is the newest edit itself: its picture is its own file, and nothing is rendered
      expect(editJobs(ctx, edit.id)).toBe(0);
      // a shot with an edit in it, for duplicate detection: the photo is the edit itself here
      expect(await ctx.get(AssetVersionRepository).getPhotosWithEdits([edit.id, photo.id, raw.id])).toEqual([edit.id]);
      const list = await sut.getVersions(authOf(user), edit.id);
      expect(list.versions.map(({ id, kind, shown }) => ({ id, kind, shown }))).toEqual([
        { id: edit.id, kind: 'edit', shown: true },
        { id: photo.id, kind: 'original', shown: false },
        { id: raw.id, kind: 'raw', shown: false },
      ]);
    });

    it('logs each decision worth knowing (combined once, left apart each time with the reason) and keeps the rule', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_9.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_9.NEF');
      const edit = await newPhoto(ctx, user.id, 'DSC_9-Edit.jpg');
      // the photo is in two albums, the edit in a third of its own: it is left apart
      for (const assetId of [photo.id, photo.id, edit.id]) {
        const { album } = await ctx.newAlbum({ ownerId: user.id });
        await ctx.newAlbumAsset({ albumId: album.id, assetId });
      }
      readTagsFrom(ctx, {
        [photo.originalPath]: nikon(),
        [raw.originalPath]: nikon(),
        [edit.originalPath]: lightroom('DSC_9.NEF'),
      });

      await sut.handleDetect({ id: photo.id, force: true });

      expect(await combinedOf(raw.id)).toEqual({ photoId: photo.id, rule: 'raw:name' });
      expect(await combinedOf(edit.id)).toBeUndefined();
      expect(await visibilityOf(edit.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
      const lines = logged(ctx);
      expect(lines).toHaveLength(2);
      expect(lines).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^Versions: DSC_9\.NEF \(.+\) is now behind DSC_9\.JPG \(.+\): same file name, taken within 10 seconds$/,
          ),
          expect.stringMatching(
            /^Versions: DSC_9-Edit\.jpg \(.+\) not combined with DSC_9\.JPG \(.+\): it is in an album/,
          ),
        ]),
      );
      // the photo itself had nothing decided about it
      expect(lines.some((line) => line.startsWith(`Versions: DSC_9.JPG (${photo.id})`))).toBe(false);

      // later runs: the pairing is not logged again, the refusal is, each time a job decides it
      await sut.handleDetect({ id: edit.id, force: true });
      await sut.handleDetect({ id: raw.id, force: true });
      expect(logged(ctx).filter((line) => line.includes('is now behind'))).toHaveLength(1);
      expect(leftApartLines(ctx, edit.id).length).toBeGreaterThan(1);

      // a second copy of the camera JPEG turns up: the RAW now matches two files, but it is behind its photo, and
      // stays there
      const copy = await newPhoto(ctx, user.id, 'DSC_9.jpg', { originalPath: '/photos/copies/DSC_9.jpg' });
      readTagsFrom(ctx, {
        [photo.originalPath]: nikon(),
        [raw.originalPath]: nikon(),
        [edit.originalPath]: lightroom('DSC_9.NEF'),
        [copy.originalPath]: nikon(),
      });
      await sut.handleDetect({ id: copy.id, force: true });
      expect(await combinedOf(raw.id)).toEqual({ photoId: photo.id, rule: 'raw:name' });
    });

    it('gives the photo the keywords of the files behind it again after a metadata read has dropped them', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_9.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_9.NEF');
      const { tag } = await ctx.newTag({ userId: user.id, value: 'lake' });
      await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [raw.id] });
      ctx.getMock(MetadataRepository).readTags.mockResolvedValue(nikon() as never);
      await sut.handleDetect({ id: raw.id, force: true });
      expect(await assetIdsIn('tag_asset', 'tagId', tag.id)).toEqual([photo.id, raw.id].toSorted());

      // reading the photo's metadata again rebuilds its tags from its own file, which has none ...
      await defaultDatabase.deleteFrom('tag_asset').where('assetId', '=', photo.id).execute();
      // ... and the detection that follows every such read puts them back
      await sut.handleDetect({ id: photo.id, force: true });

      expect(await assetIdsIn('tag_asset', 'tagId', tag.id)).toEqual([photo.id, raw.id].toSorted());
    });

    it('takes a photo out of its duplicate group once its shot includes an edit, and leaves a RAW + JPEG unit in', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const repository = ctx.get(AssetVersionRepository);
      const inGroup = async (id: string) => {
        const row = await defaultDatabase
          .selectFrom('asset')
          .select('duplicateId')
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        return row.duplicateId !== null;
      };
      // a camera JPEG with its RAW behind it, flagged as the duplicate of a look-alike
      const photo = await newPhoto(ctx, user.id, 'DSC_9.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_9.NEF');
      // (a copy that came through a messenger: another date, so it is no file of this shot)
      const lookAlike = await newPhoto(ctx, user.id, 'IMG-WA0001.jpg', {
        localDateTime: new Date('2026-08-20T09:00:00.000Z'),
      });
      await defaultDatabase
        .updateTable('asset')
        .set({ duplicateId: '11111111-1111-4111-8111-111111111111' })
        .where('id', 'in', [photo.id, lookAlike.id])
        .execute();
      const tags: Record<string, Record<string, unknown>> = {
        [photo.originalPath]: nikon(),
        [raw.originalPath]: nikon(),
      };
      readTagsFrom(ctx, tags);
      await sut.handleDetect({ id: raw.id, force: true });

      // RAW + JPEG is one unit, and can be discarded as a duplicate like any photo
      expect(await repository.getPhotosWithEdits([photo.id, raw.id, lookAlike.id])).toEqual([]);
      expect(await inGroup(photo.id)).toBe(true);

      // an edit arrives and goes behind the photo: the shot is no duplicate of anything any more
      const edit = await newPhoto(ctx, user.id, 'DSC_9-Edit.jpg');
      tags[edit.originalPath] = lightroom('DSC_9.NEF');
      await sut.handleDetect({ id: edit.id, force: true });

      expect(await repository.getPhotosWithEdits([photo.id, raw.id, lookAlike.id])).toEqual([photo.id]);
      expect(await inGroup(photo.id)).toBe(false);
      expect(await inGroup(lookAlike.id)).toBe(true);
    });

    it('pairs each frame of a phone burst with its own RAW by name, reading only the files of that name', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      // two frames a quarter of a second apart
      const frame = async (name: string, time: string) => {
        const asset = await newPhoto(ctx, user.id, name, { localDateTime: new Date(`2026-10-18T${time}Z`) });
        return { asset, tags: pixel(time) };
      };
      const raw1 = await frame('PXL_20261018_205308614.RAW-02.ORIGINAL.dng', '22:53:08.536');
      const jpeg1 = await frame('PXL_20261018_205308614.RAW-01.COVER.jpg', '22:53:08.614');
      const raw2 = await frame('PXL_20261018_205308863.RAW-02.ORIGINAL.dng', '22:53:08.806');
      const jpeg2 = await frame('PXL_20261018_205308863.RAW-01.COVER.jpg', '22:53:08.863');
      const readTags = readTagsFrom(
        ctx,
        Object.fromEntries([raw1, jpeg1, raw2, jpeg2].map(({ asset, tags }) => [asset.originalPath, tags])),
      );

      await sut.handleDetect({ id: raw1.asset.id, force: true });

      // the job read its own file and the one candidate it found by name: not the other frame, a moment away
      expect(readTags.mock.calls.map(([path]) => path).toSorted()).toEqual(
        [raw1.asset.originalPath, jpeg1.asset.originalPath].toSorted(),
      );
      // the first frame is combined; the second waits for the job of one of its own files
      expect(await behind(jpeg1.asset.id)).toMatchObject([{ versionAssetId: raw1.asset.id, rule: 'raw:name' }]);
      expect(await behind(jpeg2.asset.id)).toEqual([]);
      expect(await combinedOf(raw1.asset.id)).toMatchObject({ rule: 'raw:name' });

      await sut.handleDetect({ id: jpeg2.asset.id, force: true });

      expect(await behind(jpeg2.asset.id)).toMatchObject([{ versionAssetId: raw2.asset.id, rule: 'raw:name' }]);
      expect(await behind(jpeg1.asset.id)).toHaveLength(1);
    });

    it('finds nothing by time where ten or more files carry one time, and still combines by name', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_12.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_12.NEF');
      // an export of the shot under a name of its own: only its time could find its source
      const edit = await newPhoto(ctx, user.id, 'lake.jpg');
      // a camera whose clock was never set stamps every file with the same time
      const tags: Record<string, Record<string, unknown>> = {
        [photo.originalPath]: nikon(),
        [raw.originalPath]: nikon(),
        [edit.originalPath]: lightroom('DSC_12.NEF'),
      };
      const others: string[] = [];
      for (let index = 0; index < SAME_TIME_LIMIT - 3; index++) {
        const other = await newPhoto(ctx, user.id, `P101${String(index).padStart(4, '0')}.JPG`);
        tags[other.originalPath] = nikon({ ShutterCount: 4000 + index });
        others.push(other.id);
      }
      const readTags = readTagsFrom(ctx, tags);

      // the RAW's job: the JPEG is found by its name, and nothing else is read
      await sut.handleDetect({ id: raw.id, force: true });
      expect(await behind(photo.id)).toMatchObject([{ versionAssetId: raw.id, rule: 'raw:name' }]);
      expect(readTags.mock.calls.map(([path]) => path).toSorted()).toEqual(
        [raw.originalPath, photo.originalPath].toSorted(),
      );

      // the export's job: its name finds nothing, and the time means nothing here
      readTags.mockClear();
      await sut.handleDetect({ id: edit.id, force: true });
      expect(await behind(photo.id)).toHaveLength(1);
      expect(await visibilityOf(edit.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
      expect(await combinedOf(edit.id)).toBeUndefined();
      expect(readTags.mock.calls.map(([path]) => path)).toEqual([edit.originalPath]);

      // with one file fewer the time finds its source again
      await defaultDatabase.deleteFrom('asset').where('id', '=', others[0]).execute();
      await sut.handleDetect({ id: edit.id, force: true });
      expect(await behind(photo.id)).toMatchObject([
        { versionAssetId: edit.id, kind: 'edit', rule: 'edit:time' },
        { versionAssetId: raw.id, kind: 'raw', rule: 'raw:name' },
      ]);
    });

    it('lets the job of a file that is behind its photo put a newly arrived edit behind the same photo', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_9.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_9.NEF');
      const tags: Record<string, Record<string, unknown>> = {
        [photo.originalPath]: nikon(),
        [raw.originalPath]: nikon(),
      };
      readTagsFrom(ctx, tags);
      await sut.handleDetect({ id: raw.id, force: true });
      expect(await behind(photo.id)).toHaveLength(1);

      const edit = await newPhoto(ctx, user.id, 'DSC_9-Edit.jpg');
      tags[edit.originalPath] = lightroom('DSC_9.NEF');
      // the hidden RAW's metadata is read again, which runs its job
      await sut.handleDetect({ id: raw.id, force: true });

      expect(await behind(photo.id)).toMatchObject([
        { versionAssetId: edit.id, kind: 'edit', rule: 'edit:name' },
        { versionAssetId: raw.id, kind: 'raw', rule: 'raw:name' },
      ]);
      expect(await combinedOf(raw.id)).toMatchObject({ photoId: photo.id });
      expect(editJobs(ctx, photo.id)).toBe(1);
    });

    it('reads the camera JPEG whose date is still provisional before making a RAW the photo with an edit behind it', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const raw = await newPhoto(ctx, user.id, 'DSC_9.NEF');
      const edit = await newPhoto(ctx, user.id, 'lake.jpg');
      // Immich has not read the JPEG yet: its date is the day the file was copied, far from the shot
      const photo = await newPhoto(ctx, user.id, 'DSC_9.JPG', { localDateTime: new Date('2026-11-05T10:00:00.000Z') });
      // a file of the same name from another round of the camera's counter, read long ago: it is no part of this
      const old = await newPhoto(ctx, user.id, 'DSC_9.jpg', {
        originalPath: '/photos/2019/DSC_9.jpg',
        localDateTime: new Date('2019-03-02T10:00:00.000Z'),
      });
      for (const assetId of [raw.id, edit.id, old.id]) {
        await ctx.newJobStatus({ assetId, metadataExtractedAt: new Date() });
      }
      const readTags = readTagsFrom(ctx, {
        [raw.originalPath]: nikon(),
        [edit.originalPath]: lightroom('DSC_9.NEF'),
        [photo.originalPath]: nikon(),
        [old.originalPath]: nikon(),
      });

      // the export's job finds the RAW by its time; the JPEG is found by neither time nor the export's name
      await sut.handleDetect({ id: edit.id, force: true });

      expect(await behind(photo.id)).toMatchObject([
        { versionAssetId: edit.id, kind: 'edit', rule: 'edit:time' },
        { versionAssetId: raw.id, kind: 'raw', rule: 'raw:name' },
      ]);
      expect(await behind(raw.id)).toEqual([]);
      expect(await visibilityOf(photo.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
      // the file from 2019 was not read: its date is final, and it is elsewhere
      expect(readTags.mock.calls.map(([path]) => path)).not.toContain(old.originalPath);
    });

    it('makes the RAW the photo when no camera file of its name is waiting to be read', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const raw = await newPhoto(ctx, user.id, 'DSC_9.NEF');
      const edit = await newPhoto(ctx, user.id, 'DSC_9-Edit.jpg');
      // a JPEG of that name from another year, with its date final
      const old = await newPhoto(ctx, user.id, 'DSC_9.JPG', { localDateTime: new Date('2019-03-02T10:00:00.000Z') });
      for (const assetId of [raw.id, edit.id, old.id]) {
        await ctx.newJobStatus({ assetId, metadataExtractedAt: new Date() });
      }
      readTagsFrom(ctx, {
        [raw.originalPath]: nikon(),
        [edit.originalPath]: lightroom('DSC_9.NEF'),
        [old.originalPath]: nikon({
          SubSecDateTimeOriginal: { rawValue: '2019:03:02 10:00:00.10-05:00' },
          DateTimeOriginal: undefined,
        }),
      });

      await sut.handleDetect({ id: edit.id, force: true });

      expect(await behind(raw.id)).toMatchObject([{ versionAssetId: edit.id, kind: 'edit', rule: 'edit:name' }]);
      expect(await behind(old.id)).toEqual([]);
      expect(await visibilityOf(old.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
    });

    it('finds the camera JPEG that differs in its fraction of a second before making a RAW the photo with an edit behind it', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      // a Pixel's RAW and JPEG, not combined yet (versions were switched on later), with their dates final
      const raw = await newPhoto(ctx, user.id, 'PXL_20261018_205308614.RAW-02.ORIGINAL.dng', takenAt('22:53:08.536'));
      const photo = await newPhoto(ctx, user.id, 'PXL_20261018_205308614.RAW-01.COVER.jpg', takenAt('22:53:08.614'));
      // an export of the RAW under another name: it has the RAW's time
      const edit = await newPhoto(ctx, user.id, 'lake.jpg', takenAt('22:53:08.536'));
      for (const assetId of [raw.id, photo.id, edit.id]) {
        await ctx.newJobStatus({ assetId, metadataExtractedAt: new Date() });
      }
      readTagsFrom(ctx, {
        [raw.originalPath]: pixel('22:53:08.536'),
        [photo.originalPath]: pixel('22:53:08.614'),
        [edit.originalPath]: {
          ...pixel('22:53:08.536'),
          PreservedFileName: 'PXL_20261018_205308614.RAW-02.ORIGINAL.dng',
        },
      });

      // the Versions job happens to take the export first: it finds the RAW by its time, and not the JPEG
      await sut.handleDetect({ id: edit.id, force: true });

      expect(await behind(photo.id)).toMatchObject([
        { versionAssetId: edit.id, kind: 'edit', rule: 'edit:time' },
        { versionAssetId: raw.id, kind: 'raw', rule: 'raw:name' },
      ]);
      expect(await behind(raw.id)).toEqual([]);
      expect(await visibilityOf(photo.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
    });

    it('does not take a file for the only match by time when another file at that time could not be read', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      // two cameras fired in the same instant, at the same number of their counters; an export of one of them
      const one = await newPhoto(ctx, user.id, 'DSC_7001.jpeg');
      const two = await newPhoto(ctx, user.id, 'DSC_7001.JPG');
      const edit = await newPhoto(ctx, user.id, 'lake.jpg');
      const camera = nikon({ SerialNumber: undefined });
      const tags: Record<string, Record<string, unknown>> = {
        [two.originalPath]: camera,
        [edit.originalPath]: { ...camera, PreservedFileName: 'DSC_7001.NEF' },
      };
      const readTags = ctx.getMock(MetadataRepository).readTags;
      readTags.mockImplementation((path) =>
        path in tags ? Promise.resolve(tags[path] as never) : Promise.reject(new Error('unreadable')),
      );

      await sut.handleDetect({ id: edit.id, force: true });

      // the file that could be read is not taken for the edit's source: the other one may be it
      expect(await versionRows(user.id)).toEqual([]);
      expect(await visibilityOf(edit.id)).toMatchObject({ visibility: AssetVisibility.Timeline });

      // once it can be read, the edit fits two shots, and that is what is stored
      tags[one.originalPath] = camera;
      await sut.handleDetect({ id: one.id, force: true });
      await sut.handleDetect({ id: edit.id, force: true });
      expect(await versionRows(user.id)).toEqual([]);
      expect(leftApartLines(ctx, edit.id).at(-1)).toContain('it could have been made from more than one shot');
    });

    it('lets a shot wait for its photo that is in the trash: new edits do not become a photo of their own', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_41.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_41.NEF');
      const tags: Record<string, Record<string, unknown>> = {
        [photo.originalPath]: nikon(),
        [raw.originalPath]: nikon(),
      };
      readTagsFrom(ctx, tags);
      await sut.handleDetect({ id: raw.id, force: true });
      expect(await behind(photo.id)).toHaveLength(1);
      await defaultDatabase
        .updateTable('asset')
        .set({ deletedAt: new Date(), status: AssetStatus.Trashed })
        .where('id', '=', photo.id)
        .execute();

      const first = await newPhoto(ctx, user.id, 'DSC_41-Edit.jpg');
      const second = await newPhoto(ctx, user.id, 'DSC_41-Edit-2.jpg');
      tags[first.originalPath] = lightroom('DSC_41.NEF', 'first');
      tags[second.originalPath] = lightroom('DSC_41.NEF', 'second');
      await sut.handleDetect({ id: first.id, force: true });
      await sut.handleDetect({ id: second.id, force: true });

      // nothing went behind anything: the two edits stay photos, and the RAW stays behind the trashed photo
      expect(await behind(first.id)).toEqual([]);
      expect(await behind(second.id)).toEqual([]);
      expect(await behind(photo.id)).toMatchObject([{ versionAssetId: raw.id }]);
      for (const edit of [first, second]) {
        expect(await visibilityOf(edit.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
        expect(leftApartLines(ctx, edit.id).at(-1)).toContain('one of them is in the trash, offline or locked');
      }
    });

    it('decides nothing when the search by name is cut off: it holds an arbitrary part of the files', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      // a file whose name is contained in every other name around it
      const photo = await newPhoto(ctx, user.id, 'a.jpg');
      const raw = await newPhoto(ctx, user.id, 'a.dng');
      for (let index = 0; index < NAME_SEARCH_LIMIT; index++) {
        await newPhoto(ctx, user.id, `a${index}.jpg`, { localDateTime: new Date('2026-08-17T20:59:07.000Z') });
      }
      const readTags = ctx.getMock(MetadataRepository).readTags.mockResolvedValue(nikon() as never);

      expect(await sut.handleDetect({ id: raw.id, force: true })).toBe(JobStatus.Skipped);

      expect(await versionRows(user.id)).toEqual([]);
      expect(await combinedOf(raw.id)).toBeUndefined();
      expect(ctx.getMock(LoggingRepository).debug).toHaveBeenCalledWith(
        `Versions: a.dng (${raw.id}) left as it is: ${NAME_SEARCH_LIMIT} or more files of its name were taken within 20 seconds of it`,
      );
      // only the file itself was read
      expect(readTags).toHaveBeenCalledTimes(1);
      expect(await visibilityOf(photo.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
    });

    it('decides nothing when the look for a camera file is cut off: the JPEG may be among the files left out', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const raw = await newPhoto(ctx, user.id, 'a.dng');
      // an export under another name: its own search by name is complete, and it finds the RAW by the time
      const edit = await newPhoto(ctx, user.id, 'lake.jpg');
      // the RAW's name is contained in every other name around it
      for (let index = 0; index < NAME_SEARCH_LIMIT; index++) {
        await newPhoto(ctx, user.id, `a${index}.jpg`, { localDateTime: new Date('2026-08-17T20:59:07.000Z') });
      }
      readTagsFrom(ctx, {
        [raw.originalPath]: nikon(),
        [edit.originalPath]: { ...nikon({ ShutterCount: undefined }), PreservedFileName: 'a.dng' },
      });

      expect(await sut.handleDetect({ id: edit.id, force: true })).toBe(JobStatus.Skipped);

      // the RAW did not become the photo
      expect(await versionRows(user.id)).toEqual([]);
      expect(await combinedOf(edit.id)).toBeUndefined();
      expect(ctx.getMock(LoggingRepository).debug).toHaveBeenCalledWith(
        `Versions: lake.jpg (${edit.id}) left as it is: ${NAME_SEARCH_LIMIT} or more files of its shot's names were taken within 20 seconds of it`,
      );
    });

    it('finds the waiting camera JPEG among RAW files of its name that are waiting too', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const raw = await newPhoto(ctx, user.id, 'DSC_9.NEF');
      const edit = await newPhoto(ctx, user.id, 'DSC_9-Edit.jpg');
      for (const assetId of [raw.id, edit.id]) {
        await ctx.newJobStatus({ assetId, metadataExtractedAt: new Date() });
      }
      // files Immich has not read yet, their dates the day they were copied. Ten RAW files of the name from other
      // rounds of the camera's counter come first in the search (it is ordered by id), then the shot's JPEG
      const copied = { localDateTime: new Date('2026-11-05T10:00:00.000Z') };
      const tags: Record<string, Record<string, unknown>> = {
        [raw.originalPath]: nikon(),
        [edit.originalPath]: lightroom('DSC_9.NEF'),
      };
      for (let index = 0; index < 10; index++) {
        const other = await newPhoto(ctx, user.id, 'DSC_9.NEF', {
          ...copied,
          id: `00000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`,
          originalPath: `/photos/20${10 + index}/DSC_9.NEF`,
        });
        // taken in another year, on another round of the counter
        const year = 2010 + index;
        tags[other.originalPath] = nikon({
          ShutterCount: 100 + index,
          SubSecDateTimeOriginal: { rawValue: `${year}:08:17 20:59:04.60-04:00` },
          DateTimeOriginal: { rawValue: `${year}:08:17 20:59:04.60-04:00` },
        });
      }
      const photo = await newPhoto(ctx, user.id, 'DSC_9.JPG', {
        ...copied,
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      });
      tags[photo.originalPath] = nikon();
      readTagsFrom(ctx, tags);

      await sut.handleDetect({ id: edit.id, force: true });

      expect(await behind(photo.id)).toMatchObject([
        { versionAssetId: edit.id, kind: 'edit', rule: 'edit:name' },
        { versionAssetId: raw.id, kind: 'raw', rule: 'raw:name' },
      ]);
      expect(await behind(raw.id)).toEqual([]);
    });

    it('makes each pairing once when the jobs of one shot run at the same moment', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      // several shots, so that the jobs meet each other at more than one point of their run
      for (let shot = 0; shot < 8; shot++) {
        const name = `DSC_70${shot}`;
        const photo = await newPhoto(ctx, user.id, `${name}.JPG`, {
          localDateTime: new Date(Date.UTC(2026, 7, 1 + shot)),
        });
        const raw = await newPhoto(ctx, user.id, `${name}.NEF`, {
          localDateTime: new Date(Date.UTC(2026, 7, 1 + shot)),
        });
        const edit = await newPhoto(ctx, user.id, `${name}-Edit.jpg`, {
          localDateTime: new Date(Date.UTC(2026, 7, 1 + shot)),
        });
        const taken = { rawValue: `2026:08:${String(1 + shot).padStart(2, '0')} 00:00:00.00-04:00` };
        const camera = nikon({ ShutterCount: 7000 + shot, SubSecDateTimeOriginal: taken, DateTimeOriginal: taken });
        readTagsFrom(ctx, {
          [photo.originalPath]: camera,
          [raw.originalPath]: camera,
          [edit.originalPath]: {
            ...lightroom(`${name}.NEF`, name),
            SubSecDateTimeOriginal: taken,
            DateTimeOriginal: taken,
          },
        });
        ctx.getMock(LoggingRepository).log.mockClear();

        // the queue runs one job at a time by default; an administrator can raise that, and then this happens
        const results = await Promise.all([raw, photo, edit].map(({ id }) => sut.handleDetect({ id, force: true })));

        expect(results).toEqual([JobStatus.Success, JobStatus.Success, JobStatus.Success]);
        // one photo, each other file behind it once, none behind another
        expect(await behind(photo.id)).toMatchObject([
          { versionAssetId: edit.id, kind: 'edit' },
          { versionAssetId: raw.id, kind: 'raw' },
        ]);
        expect(await behind(raw.id)).toEqual([]);
        expect(await behind(edit.id)).toEqual([]);
        expect(await visibilityOf(photo.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
        expect(await visibilityOf(raw.id)).toMatchObject({ visibility: AssetVisibility.Hidden });
        expect(await visibilityOf(edit.id)).toMatchObject({ visibility: AssetVisibility.Hidden });
        // each pairing was stored and logged once, whichever job made it
        expect(await combinedOf(raw.id)).toMatchObject({ photoId: photo.id });
        expect(await combinedOf(edit.id)).toMatchObject({ photoId: photo.id });
        expect(logged(ctx).filter((line) => line.includes('is now behind'))).toHaveLength(2);
        expect(logged(ctx).filter((line) => line.includes('not combined'))).toEqual([]);
      }
    });

    it('reads what hangs on a file the same way for planning and for the check under the lock', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_9.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_9.NEF');
      const bare = await newPhoto(ctx, user.id, 'DSC_10.JPG');
      const { album } = await ctx.newAlbum({ ownerId: user.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: photo.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: raw.id });
      await defaultDatabase.insertInto('asset_favorite').values({ assetId: raw.id, userId: user.id }).execute();
      // two comments on one file: the same key twice
      for (const comment of ['one', 'two']) {
        await defaultDatabase
          .insertInto('activity')
          .values({ albumId: album.id, userId: user.id, assetId: photo.id, comment, isLiked: false })
          .execute();
      }
      const repository = ctx.get(AssetVersionRepository);
      const ids = [photo.id, raw.id, bare.id];

      const rows = await repository.getCandidatesWithTheirShots(ids);
      const asColumn = new Map(rows.map((row) => [row.id, new Set(row.attachments)]));
      const underTheLock = await attachmentsOf(defaultDatabase, ids);

      expect(asColumn.get(photo.id)).toEqual(new Set([`album:${album.id}`, `activity:${photo.id}`]));
      expect(asColumn.get(raw.id)).toEqual(new Set([`album:${album.id}`, `favorite:${user.id}`]));
      expect(asColumn.get(bare.id)).toEqual(new Set());
      for (const id of ids) {
        expect(asColumn.get(id)).toEqual(underTheLock.get(id) ?? new Set());
      }
      // one row per file, though one of them has the same key twice
      expect(rows.map((row) => row.id).toSorted()).toEqual(ids.toSorted());
    });

    it('does nothing while disabled', async () => {
      const { sut, ctx } = setup({ enabled: false });
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_10.JPG');
      await newPhoto(ctx, user.id, 'DSC_10.NEF');
      ctx.getMock(MetadataRepository).readTags.mockResolvedValue(nikon() as never);

      await sut.handleDetect({ id: photo.id, force: true });

      expect(await versionRows(user.id)).toEqual([]);
      expect(ctx.getMock(MetadataRepository).readTags).not.toHaveBeenCalled();
    });

    it('leaves another owner’s identical shot alone, and a lone file, with nothing stored or logged', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_11.JPG');
      await newPhoto(ctx, other.id, 'DSC_11.NEF');
      ctx.getMock(MetadataRepository).readTags.mockResolvedValue(nikon() as never);

      await sut.handleDetect({ id: photo.id, force: true });

      expect(await versionRows(user.id)).toEqual([]);
      expect(await combinedOf(photo.id)).toBeUndefined();
      expect(logged(ctx)).toEqual([]);
    });
  });

  describe('the picture of a photo (its look)', () => {
    it('marks the photo edited while it has a look, and lets Gallery’s editor or an adjustment keep it edited after', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_50.JPG');
      const edit = await newPhoto(ctx, user.id, 'DSC_50-Edit.jpg');
      await pair(ctx, photo.id, edit.id, 'edit');
      const repository = ctx.get(AssetVersionRepository);
      const isEdited = async () => {
        const row = await defaultDatabase
          .selectFrom('asset')
          .select('isEdited')
          .where('id', '=', photo.id)
          .executeTakeFirstOrThrow();
        return row.isEdited;
      };

      await rendered(ctx, photo.id, edit.id);
      expect(await isEdited()).toBe(true);
      expect(await repository.clearLook(photo.id)).toBe('cleared');
      expect(await isEdited()).toBe(false);
      expect(await repository.clearLook(photo.id)).toBe('none');

      // a colour adjustment on top: removing either leaves the photo edited by the other
      const adjust = new ImageAdjustRepository(defaultDatabase);
      await rendered(ctx, photo.id, edit.id);
      await adjust.upsert(photo.id, { exposure: 10, contrast: 0, saturation: 0, invert: false });
      expect(await adjust.delete(photo.id)).toBe(true);
      expect(await isEdited()).toBe(true);
      await adjust.upsert(photo.id, { exposure: 10, contrast: 0, saturation: 0, invert: false });
      await repository.clearLook(photo.id);
      expect(await isEdited()).toBe(true);
    });

    it('has the photo rendered again when the edit it shows is exported again over itself, with detection on or off', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_52.JPG');
      const edit = await newPhoto(ctx, user.id, 'DSC_52-Edit.jpg', {
        fileModifiedAt: new Date('2026-09-01T10:00:00Z'),
      });
      await pair(ctx, photo.id, edit.id, 'edit');
      await rendered(ctx, photo.id, edit.id);
      const done = { job: { name: JobName.AssetEditThumbnailGeneration, data: { id: photo.id } } };

      // nothing changed: nothing to do
      await sut.onJobSuccess({ ...done, response: JobStatus.Success } as never);
      expect(editJobs(ctx, photo.id)).toBe(0);

      // the same asset, a new file
      await defaultDatabase
        .updateTable('asset')
        .set({ fileModifiedAt: new Date('2026-10-01T10:00:00Z') })
        .where('id', '=', edit.id)
        .execute();
      // a render that reports failure is not chased (it would be queued again for ever) ...
      await sut.onJobSuccess({ ...done, response: JobStatus.Failed } as never);
      expect(editJobs(ctx, photo.id)).toBe(0);
      // ... a finished one is checked against the file as it is now
      await sut.onJobSuccess({ ...done, response: JobStatus.Success } as never);
      expect(editJobs(ctx, photo.id)).toBe(1);
      // and the cleanup finds it too, which also runs while versions are switched off
      const off = setup({ enabled: false });
      await off.sut.handleCleanup();
      const jobs = off.ctx
        .getMock(JobRepository)
        .queueAll.mock.calls.flatMap(([items]) => items)
        .filter((item) => item.name === JobName.AssetEditThumbnailGeneration);
      expect(jobs).toContainEqual({ name: JobName.AssetEditThumbnailGeneration, data: { id: photo.id } });

      // rendered from the new file: settled
      await rendered(ctx, photo.id, edit.id);
      await sut.onJobSuccess({ ...done, response: JobStatus.Success } as never);
      expect(editJobs(ctx, photo.id)).toBe(1);
    });

    it('gives the photo the size of the picture it shows', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_53.JPG');
      const edit = await newPhoto(ctx, user.id, 'DSC_53-Edit.jpg');
      await pair(ctx, photo.id, edit.id, 'edit');

      await rendered(ctx, photo.id, edit.id);

      const row = await defaultDatabase
        .selectFrom('asset')
        .select(['width', 'height', 'isEdited'])
        .where('id', '=', photo.id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ width: 400, height: 400, isEdited: true });
    });

    it('has the photo rendered again when the edit it shows is deleted', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_51.JPG');
      const edit = await newPhoto(ctx, user.id, 'DSC_51-Edit.jpg');
      await pair(ctx, photo.id, edit.id, 'edit');
      await rendered(ctx, photo.id, edit.id);

      await defaultDatabase.deleteFrom('asset').where('id', '=', edit.id).execute();
      await sut.handleCleanup();

      const jobs = ctx
        .getMock(JobRepository)
        .queueAll.mock.calls.flatMap(([items]) => items)
        .filter((item) => item.name === JobName.AssetEditThumbnailGeneration);
      // the database is shared between these tests: other photos may be due too
      expect(jobs).toContainEqual({ name: JobName.AssetEditThumbnailGeneration, data: { id: photo.id } });
    });
  });

  describe("the base photo's row", () => {
    it('is made with the first file behind the photo, says what the photo is, and is left out of the replay', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_30.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_30.NEF');
      await pair(ctx, photo.id, raw.id);

      expect(await basePhotoRow(photo.id)).toMatchObject({
        assetId: photo.id,
        role: 'base_photo',
        kind: 'original',
        source: 'camera',
        rule: 'photo',
        lookUpdatedAt: null,
      });
      const repository = ctx.get(AssetVersionRepository);
      // the photo is no version of anything
      expect(await repository.isVersion(photo.id)).toBe(false);
      expect(await repository.getPhotoOf(photo.id)).toBeUndefined();
      // only the file behind is replayed: a replay of the photo's row would hide the photo
      const unsynced = await repository.getUnsynced();
      expect(unsynced.map(({ versionAssetId }) => versionAssetId)).toEqual([raw.id]);
    });

    it('outlives the deletion of the edit the picture came from, until the reset; the unedited file is not served then', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { photo, edit } = await showingAnEdit(ctx, user.id);
      const repository = ctx.get(AssetVersionRepository);

      await defaultDatabase.deleteFrom('asset').where('id', '=', edit.id).execute();

      const row = await basePhotoRow(photo.id);
      expect(row).toMatchObject({ lookSourceAssetId: null });
      expect(row?.lookUpdatedAt).not.toBeNull();
      expect(await repository.hasVersions(photo.id)).toBe(false);
      // the shot is gone: its own unedited file is no version to serve, to a shared link or anyone
      const auth = factory.auth({ user: { id: user.id } });
      await expect(sut.viewImage(auth, photo.id, photo.id)).rejects.toThrow(NotFoundException);
      // the cleanup has the picture reset
      await sut.handleCleanup();
      const queued = ctx
        .getMock(JobRepository)
        .queueAll.mock.calls.flatMap(([items]) => items)
        .filter((item) => item.name === JobName.AssetEditThumbnailGeneration);
      expect(queued).toContainEqual({ name: JobName.AssetEditThumbnailGeneration, data: { id: photo.id } });
      // the reset: the photo shows its own file, and what is left of the shot goes
      expect(await repository.clearLook(photo.id)).toBe('cleared');
      expect(await basePhotoRow(photo.id)).toBeUndefined();
      expect(await visibilityOf(photo.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
    });

    it('keeps a stale look after undo until the reset, and the undo does not come back to it', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { photo, edit } = await showingAnEdit(ctx, user.id);
      const repository = ctx.get(AssetVersionRepository);

      const { restored } = await repository.undo(photo.id);

      expect(restored.map(({ id }) => id)).toEqual([edit.id]);
      expect(await basePhotoRow(photo.id)).toMatchObject({ lookSourceModifiedAt: null });
      // (other tests' photos share this database: only this one is looked for)
      const withVersions = await repository.getPhotosWithVersions(1000);
      expect(withVersions.map(({ assetId }) => assetId)).not.toContain(photo.id);
      const outdated = await repository.getOutdatedLooks();
      expect(outdated.map(({ assetId }) => assetId)).toContain(photo.id);
      expect(await repository.clearLook(photo.id)).toBe('cleared');
      expect(await basePhotoRow(photo.id)).toBeUndefined();
      expect(await isInAShot(edit.id)).toBe(false);
      void sut;
    });

    it('is not reset while a pairing has given the photo something to show; a pairing keeps the look it finds', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const { photo, edit } = await showingAnEdit(ctx, user.id);
      const repository = ctx.get(AssetVersionRepository);
      const before = await basePhotoRow(photo.id);

      // the edit job decided "nothing to show"; under the lock it finds otherwise
      expect(await repository.clearLook(photo.id, () => Promise.resolve(false))).toBe('refused');
      expect(await basePhotoRow(photo.id)).toMatchObject({ lookSourceAssetId: edit.id });

      // another file goes behind: the base photo's look stays as it was
      const raw = await newPhoto(ctx, user.id, 'DSC_31.NEF');
      await pair(ctx, photo.id, raw.id);
      expect(await basePhotoRow(photo.id)).toMatchObject({
        lookSourceAssetId: edit.id,
        lookUpdatedAt: before?.lookUpdatedAt,
      });
    });

    it('comes back for a render that finishes after the reset, and is reset again', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const { photo, edit } = await showingAnEdit(ctx, user.id);
      const repository = ctx.get(AssetVersionRepository);
      await repository.undo(photo.id);
      await repository.clearLook(photo.id);
      expect(await basePhotoRow(photo.id)).toBeUndefined();

      // a render of the edit that started before the undo publishes now
      await rendered(ctx, photo.id, edit.id);

      expect(await basePhotoRow(photo.id)).toMatchObject({ lookSourceAssetId: edit.id });
      expect(await repository.hasVersions(photo.id)).toBe(false);
      // nothing is behind the photo: the look is outdated, and the next reset removes the row
      const outdated = await repository.getOutdatedLooks();
      expect(outdated.map(({ assetId }) => assetId)).toContain(photo.id);
      await repository.clearLook(photo.id);
      expect(await basePhotoRow(photo.id)).toBeUndefined();
    });

    it("leaves a file that still shows another file's picture out of a pairing until that is reset", async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const { photo, edit } = await showingAnEdit(ctx, user.id);
      const repository = ctx.get(AssetVersionRepository);
      await repository.undo(photo.id);
      const other = await newPhoto(ctx, user.id, 'DSC_99.JPG');

      expect(await repository.pair({ ...PAIR_INPUT, photoId: other.id, versionId: photo.id })).toEqual({
        paired: false,
        reason: 'not-eligible',
      });
      await repository.clearLook(photo.id);
      expect(await repository.pair({ ...PAIR_INPUT, photoId: other.id, versionId: photo.id })).toMatchObject({
        paired: true,
      });
      void edit;
    });

    it('is found by the cleanup when its first render failed: it should show another file and shows its own', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const repository = ctx.get(AssetVersionRepository);
      const outdated = async () => {
        const rows = await repository.getOutdatedLooks();
        return rows.map(({ assetId }) => assetId);
      };
      const photo = await newPhoto(ctx, user.id, 'DSC_33.JPG');
      const edit = await newPhoto(ctx, user.id, 'DSC_33-Edit.jpg', {
        fileModifiedAt: new Date('2026-10-01T10:00:00Z'),
      });
      await pair(ctx, photo.id, edit.id, 'edit');

      // paired, never rendered
      expect(await outdated()).toContain(photo.id);
      await rendered(ctx, photo.id, edit.id);
      expect(await outdated()).not.toContain(photo.id);

      // a RAW that is the photo should show its camera file; a camera file behind a JPEG gives no look
      const raw = await newPhoto(ctx, user.id, 'DSC_34.NEF');
      const jpeg = await newPhoto(ctx, user.id, 'DSC_34.JPG');
      await defaultDatabase
        .insertInto('asset_version')
        .values([
          { versionAssetId: raw.id, assetId: raw.id, role: 'base_photo', kind: 'raw', source: 'camera', rule: 'photo' },
          {
            versionAssetId: jpeg.id,
            assetId: raw.id,
            role: 'version',
            kind: 'original',
            source: 'camera',
            rule: 'raw:name',
          },
        ])
        .execute();
      expect(await outdated()).toContain(raw.id);
      const other = await newPhoto(ctx, user.id, 'DSC_35.JPG');
      const otherRaw = await newPhoto(ctx, user.id, 'DSC_35.NEF');
      await pair(ctx, other.id, otherRaw.id);
      expect(await outdated()).not.toContain(other.id);

      // an edit made in Gallery's own editor wins: nothing to render from another file
      await defaultDatabase
        .insertInto('asset_edit')
        .values({ assetId: raw.id, action: 'rotate', parameters: { angle: 90 }, sequence: 0 } as never)
        .execute();
      expect(await outdated()).not.toContain(raw.id);
    });

    it('is found by the cleanup when it shows an older edit than it should, or has lost its edited files', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const repository = ctx.get(AssetVersionRepository);
      const outdated = async () => {
        const rows = await repository.getOutdatedLooks();
        return rows.map(({ assetId }) => assetId);
      };
      const { photo } = await showingAnEdit(ctx, user.id);
      expect(await outdated()).not.toContain(photo.id);

      // a newer edit goes behind it, and its render fails: the older picture is still recorded, and is outdated
      const newer = await newPhoto(ctx, user.id, 'DSC_31-Edit-2.jpg', {
        fileModifiedAt: new Date('2026-10-05T10:00:00Z'),
      });
      await pair(ctx, photo.id, newer.id, 'edit');
      expect(await outdated()).toContain(photo.id);
      await rendered(ctx, photo.id, newer.id);
      expect(await outdated()).not.toContain(photo.id);

      // the edited files went (a reset that ran as a render finished): the recorded picture is not there to show
      await defaultDatabase
        .deleteFrom('asset_file')
        .where('assetId', '=', photo.id)
        .where('isEdited', '=', true)
        .execute();
      expect(await outdated()).toContain(photo.id);
    });

    it('breaks a tie of dates as the choice of the picture does: by id', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const repository = ctx.get(AssetVersionRepository);
      const when = new Date('2026-10-01T10:00:00Z');
      // an edit that is the photo, and another edit of the same date behind it
      const [low, high] = [newUuid(), newUuid()].toSorted();
      const photo = await newPhoto(ctx, user.id, 'DSC_47-Edit.jpg', { id: low, fileModifiedAt: when });
      const other = await newPhoto(ctx, user.id, 'DSC_47-Edit-2.jpg', { id: high, fileModifiedAt: when });
      await ctx.get(AssetVersionRepository).pair({
        ...PAIR_INPUT,
        kind: 'edit',
        photo: { ...PHOTO, kind: 'edit' },
        photoId: photo.id,
        versionId: other.id,
      });

      // the higher id wins the tie: the photo should show the other edit, and was never rendered
      const rows = await repository.getOutdatedLooks();
      expect(rows.map(({ assetId }) => assetId)).toContain(photo.id);
      expect(await desiredLook(repository, photo.id)).toMatchObject({ id: other.id });
    });

    it('is queued by the cleanup once an hour at most while its render keeps failing, and again once it succeeds', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_48.JPG');
      const edit = await newPhoto(ctx, user.id, 'DSC_48-Edit.jpg', {
        fileModifiedAt: new Date('2026-10-01T10:00:00Z'),
      });
      await pair(ctx, photo.id, edit.id, 'edit');
      const queueAll = ctx.getMock(JobRepository).queueAll;
      const rendersQueued = () =>
        queueAll.mock.calls
          .flatMap(([items]) => items)
          .filter((item) => item.name === JobName.AssetEditThumbnailGeneration && item.data.id === photo.id).length;

      await sut.handleCleanup();
      await sut.handleCleanup();
      expect(rendersQueued()).toBe(1);

      // the render succeeds; later its edit is deleted, and the next cleanup queues the reset at once
      await rendered(ctx, photo.id, edit.id);
      await defaultDatabase.deleteFrom('asset').where('id', '=', edit.id).execute();
      await sut.handleCleanup();
      expect(rendersQueued()).toBe(2);
    });

    it('is removed by the cleanup when nothing is behind the photo and it shows its own picture', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_32.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_32.NEF');
      await pair(ctx, photo.id, raw.id);
      // the version row goes some other way (here by hand), and leaves the photo's row behind
      await defaultDatabase.deleteFrom('asset_version').where('versionAssetId', '=', raw.id).execute();

      await sut.handleCleanup();

      expect(await basePhotoRow(photo.id)).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it("queues the deletion of a deleted photo's uploaded versions once", async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_12.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_12.NEF');
      await pair(ctx, photo.id, raw.id);

      await defaultDatabase.deleteFrom('asset').where('id', '=', photo.id).execute();
      await sut.handleCleanup();
      await sut.handleCleanup();

      expect(deletions(ctx, raw.id)).toEqual([{ name: JobName.AssetDelete, data: { id: raw.id, deleteOnDisk: true } }]);
    });

    it("never deletes an external library's file", async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { library } = await ctx.newLibrary({ ownerId: user.id });
      const photo = await newPhoto(ctx, user.id, 'DSC_13.JPG', { libraryId: library.id });
      const raw = await newPhoto(ctx, user.id, 'DSC_13.NEF', { libraryId: library.id });
      await pair(ctx, photo.id, raw.id);

      await defaultDatabase.deleteFrom('asset').where('id', '=', photo.id).execute();
      await sut.handleCleanup();

      expect(deletions(ctx, raw.id)).toEqual([
        { name: JobName.AssetDelete, data: { id: raw.id, deleteOnDisk: false } },
      ]);
    });

    it('finishes the follow-up of a pairing that crashed after committing', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_14.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_14.NEF');
      await ctx.get(AssetVersionRepository).pair({
        photoId: photo.id,
        versionId: raw.id,
        kind: 'raw',
        source: 'camera',
        rule: 'raw:name',
        photo: PHOTO,
        read: null,
      });

      await sut.handleCleanup();

      const row = await defaultDatabase
        .selectFrom('asset_version')
        .select('syncedAt')
        .where('versionAssetId', '=', raw.id)
        .executeTakeFirstOrThrow();
      expect(row.syncedAt).not.toBeNull();
    });

    it('regenerates a version whose preview is missing', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_16.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_16.NEF');
      await pair(ctx, photo.id, raw.id);
      await ctx.newAssetFile({ assetId: raw.id, type: AssetFileType.Thumbnail, path: '/thumbs/16.webp' });
      const missing = async () => {
        const ids: string[] = [];
        for await (const { id } of ctx.get(AssetVersionRepository).streamForThumbnails(false)) {
          ids.push(id);
        }
        return ids;
      };

      expect(await missing()).toContain(raw.id);
      await ctx.newAssetFile({ assetId: raw.id, type: AssetFileType.Preview, path: '/thumbs/16.jpeg' });
      expect(await missing()).not.toContain(raw.id);
    });
  });

  describe('while versions are switched off', () => {
    it('shows no versions and serves none; switched on again, they are back', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_79.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_79.NEF');
      await ctx.newAssetFile({ assetId: raw.id, type: AssetFileType.Thumbnail, path: '/thumbs/raw79.webp' });
      await pair(ctx, photo.id, raw.id);
      const auth = authOf(user);
      const listed = async () => {
        const { versions } = await sut.getVersions(auth, photo.id);
        return versions.map(({ id }) => id).toSorted();
      };
      expect(await listed()).toEqual([photo.id, raw.id].toSorted());

      switchVersions(ctx, false);
      expect(await listed()).toEqual([]);
      await expect(sut.viewImage(auth, photo.id, raw.id, 'thumbnail')).rejects.toBeInstanceOf(NotFoundException);
      await expect(sut.downloadOriginal(auth, photo.id, raw.id, true)).rejects.toBeInstanceOf(NotFoundException);
      // the photo's own unedited file is not served as a "version" either
      await expect(sut.downloadOriginal(auth, photo.id, photo.id, true)).rejects.toBeInstanceOf(NotFoundException);
      // nothing was undone: the RAW is still behind its photo
      expect(await visibilityOf(raw.id)).toMatchObject({ visibility: AssetVisibility.Hidden });

      switchVersions(ctx, true);
      expect(await listed()).toEqual([photo.id, raw.id].toSorted());
    });
  });

  describe('undoing versions', () => {
    /** The "missing" runs that analyse the files that were hidden. */
    const ANALYSIS = [
      { name: JobName.SmartSearchQueueAll, data: { force: false } },
      { name: JobName.AssetDetectFacesQueueAll, data: { force: false } },
      { name: JobName.OcrQueueAll, data: { force: false } },
      { name: JobName.AssetDetectDuplicatesQueueAll, data: { force: false } },
    ];

    it('is not done while versions are on', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_80.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_80.NEF');
      await pair(ctx, photo.id, raw.id);

      await expect(sut.handleUndo()).resolves.toBe(JobStatus.Skipped);

      expect(await visibilityOf(raw.id)).toMatchObject({ visibility: AssetVisibility.Hidden });
      expect(await versionRows(user.id)).toHaveLength(1);
    });

    it('makes every version a photo of its own again, shown and stacked the way it was before', async () => {
      const { sut, ctx } = setup({ enabled: false });
      const { user } = await ctx.newUser();
      // stacked with its photo before it went behind it (the stack of two is dissolved then)
      const stackedPhoto = await newPhoto(ctx, user.id, 'DSC_81.JPG');
      const stackedRaw = await newPhoto(ctx, user.id, 'DSC_81.NEF');
      await ctx.newStack({ ownerId: user.id }, [stackedRaw.id, stackedPhoto.id]);
      // two photos of their own, one of them in the archive
      const plainPhoto = await newPhoto(ctx, user.id, 'DSC_82.JPG');
      const plainRaw = await newPhoto(ctx, user.id, 'DSC_82.NEF');
      const archivedPhoto = await newPhoto(ctx, user.id, 'DSC_83.JPG');
      const archivedRaw = await newPhoto(ctx, user.id, 'DSC_83.NEF', { visibility: AssetVisibility.Archive });
      // photos that were archived, locked and trashed after their RAW went behind them
      const laterArchived = await newPhoto(ctx, user.id, 'DSC_84.JPG');
      const laterArchivedRaw = await newPhoto(ctx, user.id, 'DSC_84.NEF');
      const lockedPhoto = await newPhoto(ctx, user.id, 'DSC_85.JPG');
      const lockedRaw = await newPhoto(ctx, user.id, 'DSC_85.NEF');
      await ctx.newStack({ ownerId: user.id }, [lockedPhoto.id, lockedRaw.id]);
      const trashedPhoto = await newPhoto(ctx, user.id, 'DSC_86.JPG');
      const trashedRaw = await newPhoto(ctx, user.id, 'DSC_86.NEF');
      for (const [photo, raw] of [
        [stackedPhoto, stackedRaw],
        [plainPhoto, plainRaw],
        [archivedPhoto, archivedRaw],
        [laterArchived, laterArchivedRaw],
        [lockedPhoto, lockedRaw],
        [trashedPhoto, trashedRaw],
      ]) {
        await pair(ctx, photo.id, raw.id);
      }
      const dissolved = await stackOf(stackedPhoto.id);
      expect(dissolved.stackId).toBeNull();
      const setAsset = (id: string, values: Record<string, unknown>) =>
        defaultDatabase.updateTable('asset').set(values).where('id', '=', id).execute();
      await setAsset(laterArchived.id, { visibility: AssetVisibility.Archive });
      await setAsset(lockedPhoto.id, { visibility: AssetVisibility.Locked });
      const deletedAt = new Date('2026-11-01T00:00:00.000Z');
      await setAsset(trashedPhoto.id, { deletedAt, status: AssetStatus.Trashed });

      await expect(sut.handleUndo()).resolves.toBe(JobStatus.Success);

      expect(await versionRows(user.id)).toEqual([]);
      // back in a stack with its photo, the photo on top
      const stack = await stackOf(stackedRaw.id);
      expect(stack.stackId).not.toBeNull();
      expect(stack.primaryAssetId).toBe(stackedPhoto.id);
      expect(await stackOf(stackedPhoto.id)).toEqual(stack);
      expect(await visibilityOf(stackedRaw.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
      // never stacked: photos of their own, in the timeline or the archive as before
      expect(await visibilityOf(plainRaw.id)).toEqual({ visibility: AssetVisibility.Timeline, stackId: null });
      expect(await visibilityOf(plainPhoto.id)).toEqual({ visibility: AssetVisibility.Timeline, stackId: null });
      expect(await visibilityOf(archivedRaw.id)).toEqual({ visibility: AssetVisibility.Archive, stackId: null });
      // as their photo is now
      expect(await visibilityOf(laterArchivedRaw.id)).toEqual({ visibility: AssetVisibility.Archive, stackId: null });
      expect(await visibilityOf(lockedRaw.id)).toEqual({ visibility: AssetVisibility.Locked, stackId: null });
      const trashed = await defaultDatabase
        .selectFrom('asset')
        .select(['visibility', 'deletedAt', 'status'])
        .where('id', '=', trashedRaw.id)
        .executeTakeFirstOrThrow();
      expect(trashed).toEqual({ visibility: AssetVisibility.Timeline, deletedAt, status: AssetStatus.Trashed });
      // the files that were hidden are analysed like any other photo
      expect(ctx.getMock(JobRepository).queueAll).toHaveBeenCalledWith(ANALYSIS);
      // and the owner's open apps are told, shot by shot, that they are back (not about the locked one)
      const told = ctx
        .getMock(WebsocketRepository)
        .clientSend.mock.calls.filter(([event]) => event === 'on_asset_restore');
      expect(told).toContainEqual(['on_asset_restore', user.id, [plainRaw.id]]);
      expect(told.flatMap((call) => call[2] as string[])).not.toContain(lockedRaw.id);
    });

    it('marks the photo’s picture stale and has duplicate detection look at its files again, with the undo itself', async () => {
      const { ctx } = setup({ enabled: false });
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_90.JPG');
      const edit = await newPhoto(ctx, user.id, 'DSC_90-Edit.jpg');
      await pair(ctx, photo.id, edit.id, 'edit');
      await rendered(ctx, photo.id, edit.id);
      const checkedAt = new Date('2026-11-01T00:00:00.000Z');
      await ctx.newJobStatus({ assetId: photo.id, duplicatesDetectedAt: checkedAt });
      await ctx.newJobStatus({ assetId: edit.id, duplicatesDetectedAt: checkedAt });
      const repository = ctx.get(AssetVersionRepository);

      // the repository step alone, as if the job stopped right after it
      const { ownerId, restored } = await repository.undo(photo.id);

      expect(ownerId).toBe(user.id);
      expect(restored).toEqual([{ id: edit.id, visibility: AssetVisibility.Timeline }]);
      // the cleanup, which every run starts with, finds the stale picture and has it rendered again
      const stale = await repository.getOutdatedLooks();
      expect(stale.map(({ assetId }) => assetId)).toContain(photo.id);
      const statuses = await defaultDatabase
        .selectFrom('asset_job_status')
        .select('duplicatesDetectedAt')
        .where('assetId', 'in', [photo.id, edit.id])
        .execute();
      expect(statuses).toEqual([{ duplicatesDetectedAt: null }, { duplicatesDetectedAt: null }]);
    });

    it('stops when versions are switched on while it runs, and leaves the rest combined', async () => {
      const { sut, ctx } = setup({ enabled: false });
      const { user } = await ctx.newUser();
      for (const number of [91, 92]) {
        const photo = await newPhoto(ctx, user.id, `DSC_${number}.JPG`);
        const raw = await newPhoto(ctx, user.id, `DSC_${number}.NEF`);
        await pair(ctx, photo.id, raw.id);
      }
      // switched on right after the first photo is undone (its owner is told at that moment)
      ctx.getMock(WebsocketRepository).clientSend.mockImplementation(((event: string) => {
        if (event === 'on_asset_restore') {
          switchVersions(ctx, true);
        }
      }) as never);

      await expect(sut.handleUndo()).resolves.toBe(JobStatus.Success);

      expect(await versionRows(user.id)).toHaveLength(1);
    });

    it('does not combine a file whose pairing waited for an undo and finds versions switched off', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_93.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_93.NEF');

      const outcome = await ctx.get(AssetVersionRepository).pair(
        {
          photoId: photo.id,
          versionId: raw.id,
          kind: 'raw',
          source: 'camera',
          rule: 'raw:name',
          photo: PHOTO,
          read: null,
        },
        () => Promise.resolve(false),
      );

      expect(outcome).toEqual({ paired: false, reason: 'switched-off' });
      expect(await visibilityOf(raw.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
      expect(await versionRows(user.id)).toEqual([]);
    });

    it('gives a photo that showed an edit its own picture back', async () => {
      const { sut, ctx } = setup({ enabled: false });
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_87.JPG');
      const edit = await newPhoto(ctx, user.id, 'DSC_87-Edit.jpg');
      await pair(ctx, photo.id, edit.id, 'edit');
      await rendered(ctx, photo.id, edit.id);

      await sut.handleUndo();

      expect(await visibilityOf(edit.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
      // the edit job finds no version to render from, removes the look and the edited files
      expect(editJobs(ctx, photo.id)).toBe(1);
    });

    it('queues the analysis by every run, so one that stopped half way is made good by the next', async () => {
      const { sut, ctx } = setup({ enabled: false });

      // nothing left to undo: the run before did it all and stopped before it queued the analysis
      await expect(sut.handleUndo()).resolves.toBe(JobStatus.Success);

      expect(ctx.getMock(JobRepository).queueAll).toHaveBeenCalledWith(ANALYSIS);
    });

    it('lets the same files be combined again: on, off and undone, on again', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_88.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_88.NEF');
      const edit = await newPhoto(ctx, user.id, 'DSC_88-Edit.jpg');
      const other = await newPhoto(ctx, user.id, 'DSC_89.JPG', takenAt('10:00:00'));
      readTagsFrom(ctx, {
        [photo.originalPath]: nikon(),
        [raw.originalPath]: nikon(),
        [edit.originalPath]: lightroom('DSC_88.NEF'),
        [other.originalPath]: pixel('12:00:00'),
      });
      const ours = new Set([photo.id, raw.id, edit.id, other.id]);
      /** The files of this test that the Versions job takes when run for "missing". */
      const missing = async () => {
        const ids: string[] = [];
        for await (const { id } of ctx.get(AssetVersionRepository).streamForQueue(false)) {
          if (ours.has(id)) {
            ids.push(id);
          }
        }
        return ids.toSorted();
      };
      const detectMissing = async () => {
        for (const id of await missing()) {
          await sut.handleDetect({ id, force: false });
        }
      };

      // on: the Versions job combines the shot
      await detectMissing();
      const combined = await behind(photo.id);
      expect(combined.map(({ versionAssetId, kind }) => [versionAssetId, kind])).toEqual([
        [edit.id, 'edit'],
        [raw.id, 'raw'],
      ]);
      expect(await missing()).toEqual([]);

      // off, and undone: three photos again, and what was decided about them is forgotten
      switchVersions(ctx, false);
      await expect(sut.handleUndo()).resolves.toBe(JobStatus.Success);
      expect(await behind(photo.id)).toEqual([]);
      for (const id of [photo.id, raw.id, edit.id]) {
        expect(await visibilityOf(id)).toEqual({ visibility: AssetVisibility.Timeline, stackId: null });
        expect(await isRemembered(id)).toBe(false);
      }
      // a file that was in no shot keeps what was read from it
      expect(await isRemembered(other.id)).toBe(true);
      // while off, the Versions job combines nothing
      await detectMissing();
      expect(await behind(photo.id)).toEqual([]);

      // on again: "missing" is exactly the files that were undone, and they are combined as before
      switchVersions(ctx, true);
      expect(await missing()).toEqual([photo.id, raw.id, edit.id].toSorted());
      await detectMissing();
      expect(await behind(photo.id)).toEqual(combined);
      expect(await visibilityOf(photo.id)).toMatchObject({ visibility: AssetVisibility.Timeline });
    });
  });

  describe('switching back (down)', () => {
    it('shows versions as their photo is now: trashed with a trashed photo, locked with a locked one', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const trashedPhoto = await newPhoto(ctx, user.id, 'DSC_40.JPG');
      const trashedRaw = await newPhoto(ctx, user.id, 'DSC_40.NEF');
      const lockedPhoto = await newPhoto(ctx, user.id, 'DSC_41.JPG');
      const lockedRaw = await newPhoto(ctx, user.id, 'DSC_41.NEF');
      // the trashed pair was a stack before; the locked one was not
      await ctx.newStack({ ownerId: user.id }, [trashedPhoto.id, trashedRaw.id]);
      await pair(ctx, trashedPhoto.id, trashedRaw.id);
      // and an edit of the same photo that was never in that stack
      const unstackedEdit = await newPhoto(ctx, user.id, 'DSC_40-Edit.jpg');
      await pair(ctx, trashedPhoto.id, unstackedEdit.id, 'edit');
      // two versions whose photo is gone: one was in the archive before, one in the timeline
      const gonePhoto = await newPhoto(ctx, user.id, 'DSC_43.JPG');
      const archivedOrphan = await newPhoto(ctx, user.id, 'DSC_43.NEF', { visibility: AssetVisibility.Archive });
      const orphan = await newPhoto(ctx, user.id, 'DSC_43-Edit.jpg');
      await pair(ctx, gonePhoto.id, archivedOrphan.id);
      await pair(ctx, gonePhoto.id, orphan.id, 'edit');
      await defaultDatabase.deleteFrom('asset').where('id', '=', gonePhoto.id).execute();
      await pair(ctx, lockedPhoto.id, lockedRaw.id);
      // and a photo that shows its edit: it shows its own file again
      const edited = await newPhoto(ctx, user.id, 'DSC_42.JPG');
      const edit = await newPhoto(ctx, user.id, 'DSC_42-Edit.jpg');
      await pair(ctx, edited.id, edit.id, 'edit');
      await rendered(ctx, edited.id, edit.id);
      await ctx.newAssetFile({
        assetId: edited.id,
        type: AssetFileType.Preview,
        path: '/thumbs/42_edited.jpeg',
        isEdited: true,
      });
      // its own file is a portrait 4000 x 6000 (stored sideways); the look gave it the edit's 400 x 400
      await defaultDatabase
        .updateTable('asset_exif')
        .set({ exifImageWidth: 6000, exifImageHeight: 4000, orientation: '6' })
        .where('assetId', '=', edited.id)
        .execute();
      const deletedAt = new Date('2026-11-01T00:00:00.000Z');
      await defaultDatabase
        .updateTable('asset')
        .set({ deletedAt, status: AssetStatus.Trashed })
        .where('id', '=', trashedPhoto.id)
        .execute();
      await defaultDatabase
        .updateTable('asset')
        .set({ visibility: AssetVisibility.Locked })
        .where('id', '=', lockedPhoto.id)
        .execute();

      const rollback = new Error('rollback');
      await expect(
        defaultDatabase.transaction().execute(async (tx) => {
          await down(tx as never);
          const rows = await tx
            .selectFrom('asset')
            .select(['id', 'visibility', 'deletedAt', 'status', 'stackId'])
            .where('id', 'in', [trashedRaw.id, lockedRaw.id])
            .execute();
          const byId = new Map(rows.map((row) => [row.id, row]));
          expect(byId.get(trashedRaw.id)).toMatchObject({
            visibility: AssetVisibility.Timeline,
            deletedAt,
            status: AssetStatus.Trashed,
          });
          // stacked under its photo again, because it was before; the others are photos of their own
          expect(byId.get(trashedRaw.id)!.stackId).not.toBeNull();
          expect(byId.get(lockedRaw.id)!.stackId).toBeNull();
          const orphans = await tx
            .selectFrom('asset')
            .select(['id', 'visibility'])
            .where('id', 'in', [archivedOrphan.id, orphan.id])
            .execute();
          expect(new Map(orphans.map((row) => [row.id, row.visibility]))).toEqual(
            new Map([
              [archivedOrphan.id, AssetVisibility.Archive],
              [orphan.id, AssetVisibility.Timeline],
            ]),
          );
          const beside = await tx
            .selectFrom('asset')
            .select('stackId')
            .where('id', '=', unstackedEdit.id)
            .executeTakeFirstOrThrow();
          expect(beside.stackId).toBeNull();
          const shownEdit = await tx
            .selectFrom('asset')
            .select(['visibility', 'stackId'])
            .where('id', '=', edit.id)
            .executeTakeFirstOrThrow();
          expect(shownEdit).toEqual({ visibility: AssetVisibility.Timeline, stackId: null });
          expect(byId.get(lockedRaw.id)).toMatchObject({
            visibility: AssetVisibility.Locked,
            deletedAt: null,
            status: AssetStatus.Active,
          });
          const photo = await tx
            .selectFrom('asset')
            .select(['isEdited', 'thumbhash', 'width', 'height'])
            .where('id', '=', edited.id)
            .executeTakeFirstOrThrow();
          expect(photo).toEqual({ isEdited: false, thumbhash: null, width: 4000, height: 6000 });
          const files = await tx
            .selectFrom('asset_file')
            .select('path')
            .where('assetId', '=', edited.id)
            .where('isEdited', '=', true)
            .execute();
          expect(files).toEqual([]);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    });
  });

  /**
  Rule 7: every version operation × every actor × the setting. Everyone who can see the photo sees its versions
  (decided 2026-11-07); download follows the photo's download rule. Nobody changes them: there is no write route.
  */
  it('names a version downloaded through a link that hides metadata by its id', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const photo = await newPhoto(ctx, user.id, 'DSC_42.JPG');
    const raw = await newPhoto(ctx, user.id, 'DSC_42.NEF');
    await ctx.get(AssetVersionRepository).pair({ ...PAIR_INPUT, photoId: photo.id, versionId: raw.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: user.id,
      type: SharedLinkType.Individual,
      assetIds: [photo.id],
    });
    const linkAuth = (showExif: boolean) =>
      factory.auth({
        user: { id: user.id, email: user.email },
        sharedLink: { id: sharedLink.id, allowDownload: true, showExif },
      });

    const hidden = await sut.downloadOriginal(linkAuth(false), photo.id, raw.id, true);
    const shown = await sut.downloadOriginal(linkAuth(true), photo.id, raw.id, true);

    expect(hidden).toMatchObject({ fileName: `${raw.id}.NEF` });
    expect(shown).toMatchObject({ fileName: 'DSC_42.NEF' });
  });

  describe('a version is reachable only as its photo is (access matrix)', () => {
    type Actor = 'owner' | 'ownerWithPin' | 'partner' | 'albumViewer' | 'spaceViewer' | 'outsider' | 'adminNonMember';
    type State = 'timeline' | 'archive' | 'locked' | 'trash';
    const ACTORS: Actor[] = [
      'owner',
      'ownerWithPin',
      'partner',
      'albumViewer',
      'spaceViewer',
      'outsider',
      'adminNonMember',
    ];
    const STATES: State[] = ['timeline', 'archive', 'locked', 'trash'];
    const PERMISSIONS = [
      Permission.AssetRead,
      Permission.AssetShare,
      Permission.AssetView,
      Permission.AssetDownload,
      Permission.AssetUpdate,
      Permission.AssetDelete,
      Permission.AssetCopy,
      Permission.AssetEditGet,
      Permission.AssetEditCreate,
      Permission.AssetEditDelete,
    ];
    const PARTNER_SEES = new Set([
      Permission.AssetRead,
      Permission.AssetShare,
      Permission.AssetView,
      Permission.AssetDownload,
    ]);

    // the truth table, written out: a hidden version through Immich's own asset routes, by the state of its photo.
    // The owner reaches it as long as they reach the photo (a locked one only with the PIN, and never to share it);
    // a partner only while the photo is in the timeline (Immich keeps archived and locked photos, and the trash,
    // from partners), and only to look at it; nobody else at all (a version is in no album, Space or link).
    const expected = (actor: Actor, state: State, permission: Permission): boolean => {
      switch (actor) {
        case 'owner': {
          return state !== 'locked';
        }
        case 'ownerWithPin': {
          return state !== 'locked' || permission !== Permission.AssetShare;
        }
        case 'partner': {
          return state === 'timeline' && PARTNER_SEES.has(permission);
        }
        default: {
          return false;
        }
      }
    };

    it('follows the photo for every actor, photo state and permission on assets', async () => {
      const { ctx } = setup();
      const access = ctx.get(AccessRepository);
      const grid: Record<string, Record<string, string>> = {};
      for (const state of STATES) {
        const { user: owner } = await ctx.newUser();
        const { user: partner } = await ctx.newUser();
        const { user: albumViewer } = await ctx.newUser();
        const { user: spaceViewer } = await ctx.newUser();
        const { user: outsider } = await ctx.newUser();
        const { user: admin } = await ctx.newUser({ isAdmin: true });
        await ctx.newPartner({ sharedById: owner.id, sharedWithId: partner.id });
        const photo = await newPhoto(ctx, owner.id, 'DSC_40.JPG');
        const raw = await newPhoto(ctx, owner.id, 'DSC_40.NEF');
        const { album } = await ctx.newAlbum({ ownerId: owner.id });
        await ctx.newAlbumAsset({ albumId: album.id, assetId: photo.id });
        await ctx.newAlbumUser({ albumId: album.id, userId: albumViewer.id, role: AlbumUserRole.Viewer });
        const { space } = await ctx.newSharedSpace({ createdById: owner.id });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: spaceViewer.id, role: SharedSpaceRole.Viewer });
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: photo.id, addedById: owner.id });
        await ctx.get(AssetVersionRepository).pair({ ...PAIR_INPUT, photoId: photo.id, versionId: raw.id });
        // the photo goes where the owner put it; the version stays hidden behind it
        const visibility = {
          timeline: AssetVisibility.Timeline,
          archive: AssetVisibility.Archive,
          locked: AssetVisibility.Locked,
          trash: AssetVisibility.Timeline,
        }[state];
        await defaultDatabase
          .updateTable('asset')
          .set({ visibility, deletedAt: state === 'trash' ? new Date() : null })
          .where('id', '=', photo.id)
          .execute();
        if (state === 'locked') {
          // as locking does (AssetService): a locked photo leaves its albums and Spaces
          await defaultDatabase.deleteFrom('album_asset').where('assetId', '=', photo.id).execute();
          await defaultDatabase.deleteFrom('shared_space_asset').where('assetId', '=', photo.id).execute();
        }
        expect(await visibilityOf(raw.id)).toMatchObject({ visibility: AssetVisibility.Hidden });

        const authFor = (actor: Actor) =>
          ({
            owner: factory.auth({ user: { id: owner.id }, session: { hasElevatedPermission: false } }),
            ownerWithPin: factory.auth({ user: { id: owner.id }, session: { hasElevatedPermission: true } }),
            partner: factory.auth({ user: { id: partner.id } }),
            albumViewer: factory.auth({ user: { id: albumViewer.id } }),
            spaceViewer: factory.auth({ user: { id: spaceViewer.id } }),
            outsider: factory.auth({ user: { id: outsider.id } }),
            adminNonMember: factory.auth({ user: { id: admin.id, isAdmin: true } }),
          })[actor];
        for (const actor of ACTORS) {
          const row: string[] = [];
          for (const permission of PERMISSIONS) {
            const granted = await checkAccess(access, { auth: authFor(actor), permission, ids: [raw.id] });
            expect({ actor, state, permission, granted: granted.has(raw.id) }).toEqual({
              actor,
              state,
              permission,
              granted: expected(actor, state, permission),
            });
            row.push(granted.has(raw.id) ? 'y' : '-');
          }
          grid[`${state} ${actor}`] = { [PERMISSIONS.join(' ')]: row.join(' ') };
        }
      }
      expect(grid).toMatchSnapshot();
    });

    it('denies a version whose photo is gone, until the cleanup deletes it', async () => {
      const { ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: partner } = await ctx.newUser();
      await ctx.newPartner({ sharedById: owner.id, sharedWithId: partner.id });
      const photo = await newPhoto(ctx, owner.id, 'DSC_43.JPG');
      const raw = await newPhoto(ctx, owner.id, 'DSC_43.NEF');
      await ctx.get(AssetVersionRepository).pair({ ...PAIR_INPUT, photoId: photo.id, versionId: raw.id });
      await defaultDatabase.deleteFrom('asset').where('id', '=', photo.id).execute();
      const access = ctx.get(AccessRepository);

      for (const user of [owner, partner]) {
        const auth = factory.auth({ user: { id: user.id } });
        const granted = await checkAccess(access, { auth, permission: Permission.AssetView, ids: [raw.id] });
        expect(granted.has(raw.id)).toBe(false);
      }
    });

    it('applies to a shared link that holds a version: only while it holds the photo too', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_44.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_44.NEF');
      await ctx.get(AssetVersionRepository).pair({ ...PAIR_INPUT, photoId: photo.id, versionId: raw.id });
      // a link given both files after the pairing
      const { sharedLink } = await ctx.newSharedLink({
        userId: user.id,
        type: SharedLinkType.Individual,
        assetIds: [photo.id, raw.id],
      });
      const access = ctx.get(AccessRepository);
      const auth = factory.auth({
        user: { id: user.id, email: user.email },
        sharedLink: { id: sharedLink.id, allowDownload: true, showExif: true },
      });
      const sees = async () => {
        const granted = await checkAccess(access, { auth, permission: Permission.AssetView, ids: [raw.id] });
        return granted.has(raw.id);
      };

      expect(await sees()).toBe(true);
      await defaultDatabase.deleteFrom('shared_link_asset').where('assetId', '=', photo.id).execute();
      expect(await sees()).toBe(false);
    });

    it('applies to the files of a version too: an owner without the PIN gets none of a locked photo’s version', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_45.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_45.NEF');
      await ctx.get(AssetVersionRepository).pair({ ...PAIR_INPUT, photoId: photo.id, versionId: raw.id });
      await ctx.newAssetFile({ assetId: raw.id, type: AssetFileType.Preview, path: '/thumbs/raw.jpeg' });
      const assetFile = await defaultDatabase
        .selectFrom('asset_file')
        .select('id')
        .where('assetId', '=', raw.id)
        .executeTakeFirstOrThrow();
      await defaultDatabase
        .updateTable('asset')
        .set({ visibility: AssetVisibility.Locked })
        .where('id', '=', photo.id)
        .execute();
      const access = ctx.get(AccessRepository);
      const withPin = (pin: boolean) =>
        factory.auth({ user: { id: user.id }, session: { hasElevatedPermission: pin } });

      for (const permission of [Permission.AssetFileRead, Permission.AssetFileDownload, Permission.AssetFileDelete]) {
        const without = await checkAccess(access, { auth: withPin(false), permission, ids: [assetFile.id] });
        const withIt = await checkAccess(access, { auth: withPin(true), permission, ids: [assetFile.id] });
        expect({ permission, without: without.has(assetFile.id), withIt: withIt.has(assetFile.id) }).toEqual({
          permission,
          without: false,
          withIt: true,
        });
      }
    });

    it('takes requests larger than one database chunk', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, 'DSC_46.JPG');
      const raw = await newPhoto(ctx, user.id, 'DSC_46.NEF');
      await ctx.get(AssetVersionRepository).pair({ ...PAIR_INPUT, photoId: photo.id, versionId: raw.id });
      // more ids than one query takes (65,500): the lookup is split, and its answers put together again
      const ids = [raw.id, ...Array.from({ length: 65_500 }, () => newUuid())];
      const auth = factory.auth({ user: { id: user.id } });

      const access = ctx.get(AccessRepository);
      const granted = await checkAccess(access, { auth, permission: Permission.AssetUpdate, ids });

      expect([...granted]).toEqual([raw.id]);
      // and the lookups themselves, across the boundary
      expect(await access.assetVersion.getBasePhotos(ids)).toEqual([{ id: raw.id, photoId: photo.id }]);
      expect(await access.assetVersion.getBasePhotosOfFiles(ids)).toEqual([]);
    });

    it('leaves a hidden file that is no version, and the photo itself, as Immich has them', async () => {
      const { ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: partner } = await ctx.newUser();
      await ctx.newPartner({ sharedById: owner.id, sharedWithId: partner.id });
      const photo = await newPhoto(ctx, owner.id, 'DSC_41.JPG');
      const raw = await newPhoto(ctx, owner.id, 'DSC_41.NEF');
      await ctx.get(AssetVersionRepository).pair({ ...PAIR_INPUT, photoId: photo.id, versionId: raw.id });
      // a hidden asset of the owner that is no version (as a live photo's video is)
      const motion = await newPhoto(ctx, owner.id, 'DSC_41.MOV', { visibility: AssetVisibility.Hidden });
      const access = ctx.get(AccessRepository);
      const auth = factory.auth({ user: { id: partner.id } });

      const granted = await checkAccess(access, {
        auth,
        permission: Permission.AssetView,
        ids: [photo.id, raw.id, motion.id],
      });
      expect([...granted].toSorted()).toEqual([photo.id, raw.id, motion.id].toSorted());
    });
  });

  describe('role matrix', () => {
    type Actor =
      | 'owner'
      | 'partner'
      | 'albumViewer'
      | 'albumEditor'
      | 'albumOwner'
      | 'spaceViewer'
      | 'spaceEditor'
      | 'spaceOwner'
      | 'sharedLink'
      | 'sharedLinkNoDownload'
      | 'sharedLinkNoMetadata'
      | 'outsider'
      | 'adminNonMember';
    type Operation = 'list' | 'thumbnail' | 'original';
    const ACTORS: Actor[] = [
      'owner',
      'partner',
      'albumViewer',
      'albumEditor',
      'albumOwner',
      'spaceViewer',
      'spaceEditor',
      'spaceOwner',
      'sharedLink',
      'sharedLinkNoDownload',
      'sharedLinkNoMetadata',
      'outsider',
      'adminNonMember',
    ];
    const OPERATIONS: Operation[] = ['list', 'thumbnail', 'original'];
    const SEES = new Set<Actor>([
      'owner',
      'partner',
      'albumViewer',
      'albumEditor',
      'albumOwner',
      'spaceViewer',
      'spaceEditor',
      'spaceOwner',
      'sharedLink',
      'sharedLinkNoDownload',
      'sharedLinkNoMetadata',
    ]);
    const DOWNLOADS = new Set<Actor>([...SEES].filter((actor) => actor !== 'sharedLinkNoDownload'));

    type Answer = 'allow' | 'nothing listed' | 'deny';
    // the truth table: written out, not derived from the service. While versions are off, what was combined stays
    // combined and is not shown: whoever may see the photo gets an empty list, and no version's picture or file is
    // served to anyone
    const expected = (actor: Actor, operation: Operation, enabled: boolean): Answer => {
      switch (operation) {
        case 'list': {
          if (!SEES.has(actor)) {
            return 'deny';
          }
          // the list is file names and dates: none for a link that hides metadata
          return enabled && actor !== 'sharedLinkNoMetadata' ? 'allow' : 'nothing listed';
        }
        case 'thumbnail': {
          return enabled && SEES.has(actor) ? 'allow' : 'deny';
        }
        case 'original': {
          return enabled && DOWNLOADS.has(actor) ? 'allow' : 'deny';
        }
      }
    };

    const buildWorld = async (ctx: MediumTestContext) => {
      const { user: owner } = await ctx.newUser();
      const users: Partial<Record<Actor, { id: string; email: string }>> = { owner };
      for (const actor of [
        'partner',
        'albumViewer',
        'albumEditor',
        'albumOwner',
        'spaceViewer',
        'spaceEditor',
        'spaceOwner',
        'outsider',
      ] as const) {
        const { user } = await ctx.newUser();
        users[actor] = user;
      }
      const { user: admin } = await ctx.newUser({ isAdmin: true });
      users.adminNonMember = admin;
      await ctx.newPartner({ sharedById: owner.id, sharedWithId: users.partner!.id });

      const photo = await newPhoto(ctx, owner.id, 'DSC_20.JPG');
      const raw = await newPhoto(ctx, owner.id, 'DSC_20.NEF');
      await ctx.newAssetFile({ assetId: raw.id, type: 'thumbnail' as never, path: '/thumbs/raw.webp' });

      const { album } = await ctx.newAlbum({ ownerId: owner.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: photo.id });
      await ctx.newAlbumUser({ albumId: album.id, userId: users.albumViewer!.id, role: AlbumUserRole.Viewer });
      await ctx.newAlbumUser({ albumId: album.id, userId: users.albumEditor!.id, role: AlbumUserRole.Editor });
      // an album someone else owns, holding the photo (its owner contributed it as an editor)
      const { album: theirs } = await ctx.newAlbum({ ownerId: users.albumOwner!.id });
      await ctx.newAlbumUser({ albumId: theirs.id, userId: owner.id, role: AlbumUserRole.Editor });
      await ctx.newAlbumAsset({ albumId: theirs.id, assetId: photo.id });

      const { space } = await ctx.newSharedSpace({ createdById: users.spaceOwner!.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: users.spaceOwner!.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceMember({
        spaceId: space.id,
        userId: users.spaceEditor!.id,
        role: SharedSpaceRole.Editor,
      });
      await ctx.newSharedSpaceMember({
        spaceId: space.id,
        userId: users.spaceViewer!.id,
        role: SharedSpaceRole.Viewer,
      });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Editor });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: photo.id, addedById: owner.id });

      // paired through the repository, so building the world does not depend on the setting under test
      await ctx.get(AssetVersionRepository).pair({
        photoId: photo.id,
        versionId: raw.id,
        kind: 'raw',
        source: 'camera',
        rule: 'raw:name',
        photo: PHOTO,
        read: null,
      });

      const { sharedLink } = await ctx.newSharedLink({
        userId: owner.id,
        type: SharedLinkType.Individual,
        assetIds: [photo.id],
      });
      const authFor = (actor: Actor) => {
        if (['sharedLink', 'sharedLinkNoDownload', 'sharedLinkNoMetadata'].includes(actor)) {
          return factory.auth({
            user: { id: owner.id, email: owner.email },
            sharedLink: {
              id: sharedLink.id,
              allowDownload: actor !== 'sharedLinkNoDownload',
              showExif: actor !== 'sharedLinkNoMetadata',
            },
          });
        }
        return authOf(users[actor]!);
      };
      return { photo, raw, authFor };
    };

    it.each([true, false])('gates every operation as the truth table says (versions enabled: %s)', async (enabled) => {
      const { sut, ctx } = setup({ enabled });
      const grid: Record<string, Record<string, string>> = {};
      for (const actor of ACTORS) {
        grid[actor] = {};
        for (const operation of OPERATIONS) {
          // a fresh world per cell, so a write that was allowed cannot change the next cell's answer
          const world = await buildWorld(ctx);
          const auth = world.authFor(actor);
          const before = await defaultDatabase
            .selectFrom('asset')
            .select(['id', 'visibility', 'stackId'])
            .where('id', 'in', [world.photo.id, world.raw.id])
            .orderBy('id')
            .execute();
          let listed: number | undefined;
          const run = {
            list: async () => {
              const { versions } = await sut.getVersions(auth, world.photo.id);
              listed = versions.length;
            },
            thumbnail: () => sut.viewImage(auth, world.photo.id, world.raw.id, 'thumbnail'),
            original: () => sut.downloadOriginal(auth, world.photo.id, world.raw.id, true),
          }[operation];
          const ok = await attempt(run());
          const answer: Answer = ok ? (listed === 0 ? 'nothing listed' : 'allow') : 'deny';
          grid[actor][operation] = answer;
          expect({ actor, operation, answer }).toEqual({
            actor,
            operation,
            answer: expected(actor, operation, enabled),
          });
          if (ok) {
            continue;
          }
          const after = await defaultDatabase
            .selectFrom('asset')
            .select(['id', 'visibility', 'stackId'])
            .where('id', 'in', [world.photo.id, world.raw.id])
            .orderBy('id')
            .execute();
          expect(after).toEqual(before);
        }
      }
      expect(grid).toMatchSnapshot();
    });
  });
});
