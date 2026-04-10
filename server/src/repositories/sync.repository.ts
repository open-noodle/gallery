import { Injectable } from '@nestjs/common';
import { ExpressionBuilder, Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { DB } from 'src/schema';
import { SyncAck } from 'src/types';

export type SyncBackfillOptions = {
  nowId: string;
  afterUpdateId?: string;
  beforeUpdateId: string;
};

const dummyBackfillOptions = {
  nowId: DummyValue.UUID,
  beforeUpdateId: DummyValue.UUID,
  afterUpdateId: DummyValue.UUID,
};

export type SyncCreatedAfterOptions = {
  nowId: string;
  userId: string;
  afterCreateId?: string;
};

const dummyCreateAfterOptions = {
  nowId: DummyValue.UUID,
  userId: DummyValue.UUID,
  afterCreateId: DummyValue.UUID,
};

export type SyncQueryOptions = {
  nowId: string;
  userId: string;
  ack?: SyncAck;
};

const dummyQueryOptions = {
  nowId: DummyValue.UUID,
  userId: DummyValue.UUID,
  ack: {
    updateId: DummyValue.UUID,
  },
};

@Injectable()
export class SyncRepository {
  album: AlbumSync;
  albumAsset: AlbumAssetSync;
  albumAssetExif: AlbumAssetExifSync;
  albumToAsset: AlbumToAssetSync;
  albumUser: AlbumUserSync;
  asset: AssetSync;
  assetExif: AssetExifSync;
  assetEdit: AssetEditSync;
  assetFace: AssetFaceSync;
  assetMetadata: AssetMetadataSync;
  authUser: AuthUserSync;
  memory: MemorySync;
  memoryToAsset: MemoryToAssetSync;
  partner: PartnerSync;
  partnerAsset: PartnerAssetsSync;
  partnerAssetExif: PartnerAssetExifsSync;
  partnerStack: PartnerStackSync;
  person: PersonSync;
  stack: StackSync;
  user: UserSync;
  userMetadata: UserMetadataSync;
  sharedSpace: SharedSpaceSync;
  sharedSpaceMember: SharedSpaceMemberSync;
  sharedSpaceAsset: SharedSpaceAssetSync;
  sharedSpaceAssetExif: SharedSpaceAssetExifSync;
  sharedSpaceToAsset: SharedSpaceToAssetSync;
  library: LibrarySync;
  libraryAsset: LibraryAssetSync;
  libraryAssetExif: LibraryAssetExifSync;
  sharedSpaceLibrary: SharedSpaceLibrarySync;

  constructor(@InjectKysely() private db: Kysely<DB>) {
    this.album = new AlbumSync(this.db);
    this.albumAsset = new AlbumAssetSync(this.db);
    this.albumAssetExif = new AlbumAssetExifSync(this.db);
    this.albumToAsset = new AlbumToAssetSync(this.db);
    this.albumUser = new AlbumUserSync(this.db);
    this.asset = new AssetSync(this.db);
    this.assetExif = new AssetExifSync(this.db);
    this.assetEdit = new AssetEditSync(this.db);
    this.assetFace = new AssetFaceSync(this.db);
    this.assetMetadata = new AssetMetadataSync(this.db);
    this.authUser = new AuthUserSync(this.db);
    this.memory = new MemorySync(this.db);
    this.memoryToAsset = new MemoryToAssetSync(this.db);
    this.partner = new PartnerSync(this.db);
    this.partnerAsset = new PartnerAssetsSync(this.db);
    this.partnerAssetExif = new PartnerAssetExifsSync(this.db);
    this.partnerStack = new PartnerStackSync(this.db);
    this.person = new PersonSync(this.db);
    this.stack = new StackSync(this.db);
    this.user = new UserSync(this.db);
    this.userMetadata = new UserMetadataSync(this.db);
    this.sharedSpace = new SharedSpaceSync(this.db);
    this.sharedSpaceMember = new SharedSpaceMemberSync(this.db);
    this.sharedSpaceAsset = new SharedSpaceAssetSync(this.db);
    this.sharedSpaceAssetExif = new SharedSpaceAssetExifSync(this.db);
    this.sharedSpaceToAsset = new SharedSpaceToAssetSync(this.db);
    this.library = new LibrarySync(this.db);
    this.libraryAsset = new LibraryAssetSync(this.db);
    this.libraryAssetExif = new LibraryAssetExifSync(this.db);
    this.sharedSpaceLibrary = new SharedSpaceLibrarySync(this.db);
  }
}

export class BaseSync {
  constructor(protected db: Kysely<DB>) {}

  protected backfillQuery<T extends keyof DB>(t: T, { nowId, beforeUpdateId, afterUpdateId }: SyncBackfillOptions) {
    const { table, ref } = this.db.dynamic;
    const updateIdRef = ref(`${t}.updateId`);

    return this.db
      .selectFrom(table(t).as(t))
      .where(updateIdRef, '<', nowId)
      .where(updateIdRef, '<=', beforeUpdateId)
      .$if(!!afterUpdateId, (qb) => qb.where(updateIdRef, '>=', afterUpdateId!))
      .orderBy(updateIdRef, 'asc');
  }

  protected auditQuery<T extends keyof DB>(t: T, { nowId, ack }: SyncQueryOptions) {
    const { table, ref } = this.db.dynamic;
    const idRef = ref(`${t}.id`);

    return this.db
      .selectFrom(table(t).as(t))
      .where(idRef, '<', nowId)
      .$if(!!ack, (qb) => qb.where(idRef, '>', ack!.updateId))
      .orderBy(idRef, 'asc');
  }

  protected auditCleanup<T extends keyof DB>(t: T, days: number) {
    const { table, ref } = this.db.dynamic;

    return this.db
      .deleteFrom(table(t).as(t))
      .where(ref(`${t}.deletedAt`), '<', sql.raw(`now() - interval '${days} days'`))
      .execute();
  }

  protected upsertQuery<T extends keyof DB>(t: T, { nowId, ack }: SyncQueryOptions) {
    const { table, ref } = this.db.dynamic;
    const updateIdRef = ref(`${t}.updateId`);

    return this.db
      .selectFrom(table(t).as(t))
      .where(updateIdRef, '<', nowId)
      .$if(!!ack, (qb) => qb.where(updateIdRef, '>', ack!.updateId))
      .orderBy(updateIdRef, 'asc');
  }
}

class AlbumSync extends BaseSync {
  @GenerateSql({ params: [dummyCreateAfterOptions] })
  getCreatedAfter({ nowId, userId, afterCreateId }: SyncCreatedAfterOptions) {
    return this.db
      .selectFrom('album_user')
      .select(['albumId as id', 'createId'])
      .where('userId', '=', userId)
      .$if(!!afterCreateId, (qb) => qb.where('createId', '>=', afterCreateId!))
      .where('createId', '<', nowId)
      .orderBy('createId', 'asc')
      .execute();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('album_audit', options)
      .select(['id', 'albumId'])
      .where('userId', '=', options.userId)
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('album_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    const userId = options.userId;
    return this.upsertQuery('album', options)
      .distinctOn(['album.id', 'album.updateId'])
      .leftJoin('album_user as album_users', 'album.id', 'album_users.albumId')
      .where((eb) => eb.or([eb('album.ownerId', '=', userId), eb('album_users.userId', '=', userId)]))
      .select([
        'album.id',
        'album.ownerId',
        'album.albumName as name',
        'album.description',
        'album.createdAt',
        'album.updatedAt',
        'album.albumThumbnailAssetId as thumbnailAssetId',
        'album.isActivityEnabled',
        'album.order',
        'album.updateId',
      ])
      .stream();
  }
}

class AlbumAssetSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, albumId: string) {
    return this.backfillQuery('album_asset', options)
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .select(columns.syncAsset)
      .select('album_asset.updateId')
      .where('album_asset.albumId', '=', albumId)
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions, { updateId: DummyValue.UUID }], stream: true })
  getUpdates(options: SyncQueryOptions, albumToAssetAck: SyncAck) {
    const userId = options.userId;
    return this.upsertQuery('asset', options)
      .innerJoin('album_asset', 'album_asset.assetId', 'asset.id')
      .select(columns.syncAsset)
      .select('asset.updateId')
      .where('album_asset.updateId', '<=', albumToAssetAck.updateId) // Ensure we only send updates for assets that the client already knows about
      .innerJoin('album', 'album.id', 'album_asset.albumId')
      .leftJoin('album_user', 'album_user.albumId', 'album_asset.albumId')
      .where((eb) => eb.or([eb('album.ownerId', '=', userId), eb('album_user.userId', '=', userId)]))
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getCreates(options: SyncQueryOptions) {
    const userId = options.userId;
    return this.upsertQuery('album_asset', options)
      .select('album_asset.updateId')
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .select(columns.syncAsset)
      .innerJoin('album', 'album.id', 'album_asset.albumId')
      .leftJoin('album_user', 'album_user.albumId', 'album_asset.albumId')
      .where((eb) => eb.or([eb('album.ownerId', '=', userId), eb('album_user.userId', '=', userId)]))
      .stream();
  }
}

class AlbumAssetExifSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, albumId: string) {
    return this.backfillQuery('album_asset', options)
      .innerJoin('asset_exif', 'asset_exif.assetId', 'album_asset.assetId')
      .select(columns.syncAssetExif)
      .select('album_asset.updateId')
      .where('album_asset.albumId', '=', albumId)
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions, { updateId: DummyValue.UUID }], stream: true })
  getUpdates(options: SyncQueryOptions, albumToAssetAck: SyncAck) {
    const userId = options.userId;
    return this.upsertQuery('asset_exif', options)
      .innerJoin('album_asset', 'album_asset.assetId', 'asset_exif.assetId')
      .select(columns.syncAssetExif)
      .select('asset_exif.updateId')
      .where('album_asset.updateId', '<=', albumToAssetAck.updateId) // Ensure we only send exif updates for assets that the client already knows about
      .innerJoin('album', 'album.id', 'album_asset.albumId')
      .leftJoin('album_user', 'album_user.albumId', 'album_asset.albumId')
      .where((eb) => eb.or([eb('album.ownerId', '=', userId), eb('album_user.userId', '=', userId)]))
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getCreates(options: SyncQueryOptions) {
    const userId = options.userId;
    return this.upsertQuery('album_asset', options)
      .select('album_asset.updateId')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'album_asset.assetId')
      .select(columns.syncAssetExif)
      .innerJoin('album', 'album.id', 'album_asset.albumId')
      .leftJoin('album_user', 'album_user.albumId', 'album_asset.albumId')
      .where((eb) => eb.or([eb('album.ownerId', '=', userId), eb('album_user.userId', '=', userId)]))
      .stream();
  }
}

class AlbumToAssetSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, albumId: string) {
    return this.backfillQuery('album_asset', options)
      .select(['album_asset.assetId as assetId', 'album_asset.albumId as albumId', 'album_asset.updateId'])
      .where('album_asset.albumId', '=', albumId)
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    const userId = options.userId;
    return this.auditQuery('album_asset_audit', options)
      .select(['id', 'assetId', 'albumId'])
      .where((eb) =>
        eb(
          'albumId',
          'in',
          eb
            .selectFrom('album')
            .select(['id'])
            .where('ownerId', '=', userId)
            .union((eb) =>
              eb.parens(
                eb
                  .selectFrom('album_user')
                  .select(['album_user.albumId as id'])
                  .where('album_user.userId', '=', userId),
              ),
            ),
        ),
      )
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('album_asset_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    const userId = options.userId;
    return this.upsertQuery('album_asset', options)
      .select(['album_asset.assetId as assetId', 'album_asset.albumId as albumId', 'album_asset.updateId'])
      .innerJoin('album', 'album.id', 'album_asset.albumId')
      .leftJoin('album_user', 'album_user.albumId', 'album_asset.albumId')
      .where((eb) => eb.or([eb('album.ownerId', '=', userId), eb('album_user.userId', '=', userId)]))
      .stream();
  }
}

class AlbumUserSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, albumId: string) {
    return this.backfillQuery('album_user', options)
      .select(columns.syncAlbumUser)
      .select('album_user.updateId')
      .where('albumId', '=', albumId)
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    const userId = options.userId;
    return this.auditQuery('album_user_audit', options)
      .select(['id', 'userId', 'albumId'])
      .where((eb) =>
        eb(
          'albumId',
          'in',
          eb
            .selectFrom('album')
            .select(['id'])
            .where('ownerId', '=', userId)
            .union((eb) =>
              eb.parens(
                eb
                  .selectFrom('album_user')
                  .select(['album_user.albumId as id'])
                  .where('album_user.userId', '=', userId),
              ),
            ),
        ),
      )
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('album_user_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    const userId = options.userId;
    return this.upsertQuery('album_user', options)
      .select(columns.syncAlbumUser)
      .select('album_user.updateId')
      .where((eb) =>
        eb(
          'album_user.albumId',
          'in',
          eb
            .selectFrom('album')
            .select(['id'])
            .where('ownerId', '=', userId)
            .union((eb) =>
              eb.parens(
                eb
                  .selectFrom('album_user as albumUsers')
                  .select(['albumUsers.albumId as id'])
                  .where('albumUsers.userId', '=', userId),
              ),
            ),
        ),
      )
      .stream();
  }
}

class AssetSync extends BaseSync {
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('asset_audit', options)
      .select(['id', 'assetId'])
      .where('ownerId', '=', options.userId)
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('asset_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('asset', options)
      .select(columns.syncAsset)
      .select('asset.updateId')
      .where('ownerId', '=', options.userId)
      .stream();
  }
}

class AuthUserSync extends BaseSync {
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('user', options)
      .select(columns.syncUser)
      .select(['isAdmin', 'pinCode', 'oauthId', 'storageLabel', 'quotaSizeInBytes', 'quotaUsageInBytes'])
      .where('id', '=', options.userId)
      .stream();
  }
}

class PersonSync extends BaseSync {
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('person_audit', options)
      .select(['id', 'personId'])
      .where('ownerId', '=', options.userId)
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('person_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('person', options)
      .select([
        'id',
        'createdAt',
        'updatedAt',
        'ownerId',
        'name',
        'birthDate',
        'isHidden',
        'isFavorite',
        'color',
        'updateId',
        'faceAssetId',
      ])
      .where('ownerId', '=', options.userId)
      .stream();
  }
}

class AssetFaceSync extends BaseSync {
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('asset_face_audit', options)
      .select(['asset_face_audit.id', 'assetFaceId'])
      .leftJoin('asset', 'asset.id', 'asset_face_audit.assetId')
      .where('asset.ownerId', '=', options.userId)
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('asset_face_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('asset_face', options)
      .select([
        'asset_face.id',
        'assetId',
        'personId',
        'imageWidth',
        'imageHeight',
        'boundingBoxX1',
        'boundingBoxY1',
        'boundingBoxX2',
        'boundingBoxY2',
        'sourceType',
        'isVisible',
        'asset_face.deletedAt',
        'asset_face.updateId',
      ])
      .leftJoin('asset', 'asset.id', 'asset_face.assetId')
      .where('asset.ownerId', '=', options.userId)
      .stream();
  }
}

class AssetExifSync extends BaseSync {
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('asset_exif', options)
      .select(columns.syncAssetExif)
      .select('asset_exif.updateId')
      .where('assetId', 'in', (eb) => eb.selectFrom('asset').select('id').where('ownerId', '=', options.userId))
      .stream();
  }
}

class AssetEditSync extends BaseSync {
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('asset_edit_audit', options)
      .select(['asset_edit_audit.id', 'editId'])
      .innerJoin('asset', 'asset.id', 'asset_edit_audit.assetId')
      .where('asset.ownerId', '=', options.userId)
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('asset_edit_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('asset_edit', options)
      .select([...columns.syncAssetEdit, 'asset_edit.updateId'])
      .innerJoin('asset', 'asset.id', 'asset_edit.assetId')
      .where('asset.ownerId', '=', options.userId)
      .stream();
  }
}

class MemorySync extends BaseSync {
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('memory_audit', options)
      .select(['id', 'memoryId'])
      .where('userId', '=', options.userId)
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('memory_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('memory', options)
      .select([
        'id',
        'createdAt',
        'updatedAt',
        'deletedAt',
        'ownerId',
        'type',
        'data',
        'isSaved',
        'memoryAt',
        'seenAt',
        'showAt',
        'hideAt',
      ])
      .select('updateId')
      .where('ownerId', '=', options.userId)
      .stream();
  }
}

class MemoryToAssetSync extends BaseSync {
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('memory_asset_audit', options)
      .select(['id', 'memoryId', 'assetId'])
      .where('memoryId', 'in', (eb) => eb.selectFrom('memory').select('id').where('ownerId', '=', options.userId))
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('memory_asset_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('memory_asset', options)
      .select(['memoriesId as memoryId', 'assetId as assetId'])
      .select('updateId')
      .where('memoriesId', 'in', (eb) => eb.selectFrom('memory').select('id').where('ownerId', '=', options.userId))
      .stream();
  }
}

class PartnerSync extends BaseSync {
  @GenerateSql({ params: [dummyCreateAfterOptions] })
  getCreatedAfter({ nowId, userId, afterCreateId }: SyncCreatedAfterOptions) {
    return this.db
      .selectFrom('partner')
      .select(['sharedById', 'createId'])
      .where('sharedWithId', '=', userId)
      .$if(!!afterCreateId, (qb) => qb.where('createId', '>=', afterCreateId!))
      .where('createId', '<', nowId)
      .orderBy('partner.createId', 'asc')
      .execute();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    const userId = options.userId;
    return this.auditQuery('partner_audit', options)
      .select(['id', 'sharedById', 'sharedWithId'])
      .where((eb) => eb.or([eb('sharedById', '=', userId), eb('sharedWithId', '=', userId)]))
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('partner_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    const userId = options.userId;
    return this.upsertQuery('partner', options)
      .select(['sharedById', 'sharedWithId', 'inTimeline', 'updateId'])
      .where((eb) => eb.or([eb('sharedById', '=', userId), eb('sharedWithId', '=', userId)]))
      .stream();
  }
}

class PartnerAssetsSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, partnerId: string) {
    return this.backfillQuery('asset', options)
      .select(columns.syncAsset)
      .select('asset.updateId')
      .where('ownerId', '=', partnerId)
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('asset_audit', options)
      .select(['id', 'assetId'])
      .where('ownerId', 'in', (eb) =>
        eb.selectFrom('partner').select(['sharedById']).where('sharedWithId', '=', options.userId),
      )
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('asset', options)
      .select(columns.syncAsset)
      .select('asset.updateId')
      .where('ownerId', 'in', (eb) =>
        eb.selectFrom('partner').select(['sharedById']).where('sharedWithId', '=', options.userId),
      )
      .stream();
  }
}

class PartnerAssetExifsSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, partnerId: string) {
    return this.backfillQuery('asset_exif', options)
      .select(columns.syncAssetExif)
      .select('asset_exif.updateId')
      .innerJoin('asset', 'asset.id', 'asset_exif.assetId')
      .where('asset.ownerId', '=', partnerId)
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('asset_exif', options)
      .select(columns.syncAssetExif)
      .select('asset_exif.updateId')
      .where('assetId', 'in', (eb) =>
        eb
          .selectFrom('asset')
          .select('id')
          .where('ownerId', 'in', (eb) =>
            eb.selectFrom('partner').select(['sharedById']).where('sharedWithId', '=', options.userId),
          ),
      )
      .stream();
  }
}

class StackSync extends BaseSync {
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('stack_audit', options)
      .select(['id', 'stackId'])
      .where('userId', '=', options.userId)
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('stack_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('stack', options)
      .select(columns.syncStack)
      .select('updateId')
      .where('ownerId', '=', options.userId)
      .stream();
  }
}

class PartnerStackSync extends BaseSync {
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('stack_audit', options)
      .select(['id', 'stackId'])
      .where('userId', 'in', (eb) =>
        eb.selectFrom('partner').select(['sharedById']).where('sharedWithId', '=', options.userId),
      )
      .stream();
  }

  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, partnerId: string) {
    return this.backfillQuery('stack', options)
      .select(columns.syncStack)
      .select('updateId')
      .where('ownerId', '=', partnerId)
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('stack', options)
      .select(columns.syncStack)
      .select('updateId')
      .where('ownerId', 'in', (eb) =>
        eb.selectFrom('partner').select(['sharedById']).where('sharedWithId', '=', options.userId),
      )
      .stream();
  }
}

class UserSync extends BaseSync {
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('user_audit', options).select(['id', 'userId']).stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('user_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('user', options).select(columns.syncUser).stream();
  }
}

class UserMetadataSync extends BaseSync {
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('user_metadata_audit', options)
      .select(['id', 'userId', 'key'])
      .where('userId', '=', options.userId)
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('user_metadata_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('user_metadata', options)
      .select(['userId', 'key', 'value', 'updateId'])
      .where('userId', '=', options.userId)
      .stream();
  }
}

class AssetMetadataSync extends BaseSync {
  @GenerateSql({ params: [dummyQueryOptions, DummyValue.UUID], stream: true })
  getDeletes(options: SyncQueryOptions, userId: string) {
    return this.auditQuery('asset_metadata_audit', options)
      .select(['asset_metadata_audit.id', 'assetId', 'key'])
      .leftJoin('asset', 'asset.id', 'asset_metadata_audit.assetId')
      .where('asset.ownerId', '=', userId)
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('asset_metadata_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions, DummyValue.UUID], stream: true })
  getUpserts(options: SyncQueryOptions, userId: string) {
    return this.upsertQuery('asset_metadata', options)
      .select(['assetId', 'key', 'value', 'asset_metadata.updateId'])
      .innerJoin('asset', 'asset.id', 'asset_metadata.assetId')
      .where('asset.ownerId', '=', userId)
      .stream();
  }
}

// --- gallery-fork: shared-space sync ---
// `accessibleSpaces` is the source-of-truth scoping subquery used by every
// shared-space sync class to test "does this user have access to this space?".
// A user can access a space via creator path OR membership path. Defining it
// once here prevents the divergence the design doc flags as a risk.
//
// Usage:
//   .where('shared_space.id', 'in', (eb) => accessibleSpaces(eb, userId))
//
// NOTE: owners are also added as `shared_space_member` rows by
// `SharedSpaceService.create`, so iterating via `shared_space_member` for backfill
// enumeration is sufficient — the OR'd creator path here is for query filtering
// only and protects against direct DB inserts that bypass the service.
export function accessibleSpaces(eb: ExpressionBuilder<DB, keyof DB>, userId: string) {
  return eb
    .selectFrom('shared_space')
    .select('shared_space.id')
    .where('shared_space.createdById', '=', userId)
    .union(
      eb
        .selectFrom('shared_space_member')
        .select('shared_space_member.spaceId as id')
        .where('shared_space_member.userId', '=', userId),
    );
}

const SHARED_SPACE_SYNC_COLUMNS = [
  'shared_space.id',
  'shared_space.name',
  'shared_space.description',
  'shared_space.color',
  'shared_space.createdById',
  'shared_space.thumbnailAssetId',
  'shared_space.thumbnailCropY',
  'shared_space.faceRecognitionEnabled',
  'shared_space.petsEnabled',
  'shared_space.lastActivityAt',
  'shared_space.createdAt',
  'shared_space.updatedAt',
  'shared_space.updateId',
] as const;

export class SharedSpaceSync extends BaseSync {
  // Returns spaces accessible to the user, ordered by the user's MEMBERSHIP
  // createId (not the space's createId). This matches the album pattern in
  // AlbumSync.getCreatedAfter — using the membership createId means a user
  // added to a pre-existing space gets a fresh createId past their backfill
  // checkpoint, which triggers the per-space backfill loop in
  // syncSharedSpaceMembersV1 / AssetsV1 / etc. and drains the historical rows.
  //
  // Relies on the SharedSpaceService.create invariant that the creator is
  // always added as a member.
  @GenerateSql({ params: [dummyCreateAfterOptions] })
  getCreatedAfter({ nowId, userId, afterCreateId }: SyncCreatedAfterOptions) {
    return this.db
      .selectFrom('shared_space_member')
      .select(['shared_space_member.spaceId as id', 'shared_space_member.createId'])
      .where('shared_space_member.userId', '=', userId)
      .$if(!!afterCreateId, (qb) => qb.where('shared_space_member.createId', '>=', afterCreateId!))
      .where('shared_space_member.createId', '<', nowId)
      .orderBy('shared_space_member.createId', 'asc')
      .execute();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('shared_space_audit', options)
      .select(['id', 'spaceId'])
      .where('userId', '=', options.userId)
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('shared_space_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('shared_space', options)
      .where('shared_space.id', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .select(SHARED_SPACE_SYNC_COLUMNS)
      .stream();
  }
}

// Columns emitted to mobile clients. Explicitly excludes lastViewedAt — that's a
// per-user UI hint that mobile clients track locally and we don't want to round-trip.
const SHARED_SPACE_MEMBER_SYNC_COLUMNS = [
  'shared_space_member.spaceId',
  'shared_space_member.userId',
  'shared_space_member.role',
  'shared_space_member.joinedAt',
  'shared_space_member.showInTimeline',
  'shared_space_member.updateId',
] as const;

export class SharedSpaceMemberSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, spaceId: string) {
    return this.backfillQuery('shared_space_member', options)
      .select(SHARED_SPACE_MEMBER_SYNC_COLUMNS)
      .where('shared_space_member.spaceId', '=', spaceId)
      .stream();
  }

  // Stream peer-removal events to OTHER members of an accessible space. The
  // current user being removed from a space is signaled separately via
  // SharedSpaceSync.getDeletes (reading shared_space_audit), not this method —
  // by the time this query runs the removed user no longer satisfies
  // accessibleSpaces, so audit rows for them are filtered out. That's the
  // intentional channel split: shared_space_audit handles "you lost access",
  // shared_space_member_audit handles "this peer left".
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('shared_space_member_audit', options)
      .select(['id', 'spaceId', 'userId'])
      .where('spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('shared_space_member_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('shared_space_member', options)
      .select(SHARED_SPACE_MEMBER_SYNC_COLUMNS)
      .where('shared_space_member.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }
}

export class SharedSpaceAssetSync extends BaseSync {
  // Per-space backfill of asset rows joined through shared_space_asset.
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, spaceId: string) {
    return this.backfillQuery('shared_space_asset', options)
      .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
      .select(columns.syncAsset)
      .select('shared_space_asset.updateId')
      .where('shared_space_asset.spaceId', '=', spaceId)
      .stream();
  }

  // Create-side: stream new (space, asset) pairings the user can access. Each
  // shared_space_asset row produces one event (write amplification accepted —
  // mobile dedups by asset id at insert time).
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getCreates(options: SyncQueryOptions) {
    return this.upsertQuery('shared_space_asset', options)
      .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
      .select(columns.syncAsset)
      .select('shared_space_asset.updateId')
      .where('shared_space_asset.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }

  // Update-side: stream asset metadata changes for assets the client has already
  // received. Gated by `shared_space_asset.updateId <= sharedSpaceToAssetAck` to
  // ensure we only emit updates for join rows the client has acked.
  @GenerateSql({ params: [dummyQueryOptions, { updateId: DummyValue.UUID }], stream: true })
  getUpdates(options: SyncQueryOptions, sharedSpaceToAssetAck: SyncAck) {
    return this.upsertQuery('asset', options)
      .innerJoin('shared_space_asset', 'shared_space_asset.assetId', 'asset.id')
      .select(columns.syncAsset)
      .select('asset.updateId')
      .where('shared_space_asset.updateId', '<=', sharedSpaceToAssetAck.updateId)
      .where('shared_space_asset.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }
  // Note: shared_space_asset_audit cleanup is owned by SharedSpaceToAssetSync below,
  // mirroring how AlbumToAssetSync owns album_asset_audit cleanup.
}

export class SharedSpaceAssetExifSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, spaceId: string) {
    return this.backfillQuery('shared_space_asset', options)
      .innerJoin('asset_exif', 'asset_exif.assetId', 'shared_space_asset.assetId')
      .select(columns.syncAssetExif)
      .select('shared_space_asset.updateId')
      .where('shared_space_asset.spaceId', '=', spaceId)
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getCreates(options: SyncQueryOptions) {
    return this.upsertQuery('shared_space_asset', options)
      .innerJoin('asset_exif', 'asset_exif.assetId', 'shared_space_asset.assetId')
      .select(columns.syncAssetExif)
      .select('shared_space_asset.updateId')
      .where('shared_space_asset.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions, { updateId: DummyValue.UUID }], stream: true })
  getUpdates(options: SyncQueryOptions, sharedSpaceToAssetAck: SyncAck) {
    return this.upsertQuery('asset_exif', options)
      .innerJoin('shared_space_asset', 'shared_space_asset.assetId', 'asset_exif.assetId')
      .select(columns.syncAssetExif)
      .select('asset_exif.updateId')
      .where('shared_space_asset.updateId', '<=', sharedSpaceToAssetAck.updateId)
      .where('shared_space_asset.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }
}

// Owns shared_space_asset_audit cleanup. The audit table is shared with
// SharedSpaceAssetSync (which streams full asset rows) and SharedSpaceAssetExifSync
// (which streams exif rows), but only one class should call auditCleanup per table
// — otherwise the schema-driven `should cleanup every table` test counts duplicate
// invocations and fails. The convention (mirrored from AlbumToAssetSync) is that
// the join-row sync class owns cleanup of the join-row audit table.
export class SharedSpaceToAssetSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, spaceId: string) {
    return this.backfillQuery('shared_space_asset', options)
      .select([
        'shared_space_asset.assetId as assetId',
        'shared_space_asset.spaceId as spaceId',
        'shared_space_asset.updateId',
      ])
      .where('shared_space_asset.spaceId', '=', spaceId)
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('shared_space_asset_audit', options)
      .select(['id', 'assetId', 'spaceId'])
      .where('spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('shared_space_asset_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('shared_space_asset', options)
      .select([
        'shared_space_asset.assetId as assetId',
        'shared_space_asset.spaceId as spaceId',
        'shared_space_asset.updateId',
      ])
      .where('shared_space_asset.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }
}

// `accessibleLibraries` is the source-of-truth scoping subquery used by every
// library sync class. A user can access a library via direct ownership OR via
// any space they can access (membership or creator). The UNION naturally
// deduplicates so a user who both owns L and is a member of a space linking L
// gets a single row.
//
// Usage:
//   .where('library.id', 'in', (eb) => accessibleLibraries(eb, userId))
//
// NOTE: soft-deleted libraries (deletedAt IS NOT NULL) are excluded from the
// ownership branch but NOT from the space-link branch — a soft-deleted library
// is still reachable via a linked space and the client should still see it
// until the library is hard-deleted.
export function accessibleLibraries(eb: ExpressionBuilder<DB, keyof DB>, userId: string) {
  return eb
    .selectFrom('library')
    .select('library.id')
    .where('library.ownerId', '=', userId)
    .where('library.deletedAt', 'is', null)
    .union(
      eb
        .selectFrom('shared_space_library')
        .select('shared_space_library.libraryId as id')
        .where('shared_space_library.spaceId', 'in', (eb2) => accessibleSpaces(eb2, userId)),
    );
}

const LIBRARY_SYNC_COLUMNS = [
  'library.id',
  'library.name',
  'library.ownerId',
  'library.createdAt',
  'library.updatedAt',
  'library.updateId',
] as const;

export class LibrarySync extends BaseSync {
  // Queries library_user (a (userId, libraryId) denormalization populated by
  // the library_after_insert / shared_space_member_after_insert_library /
  // shared_space_library_after_insert_user triggers) keyed by the per-user
  // access-grant createId. This mirrors SharedSpaceSync.getCreatedAfter and
  // AlbumSync.getCreatedAfter — each row represents "user U gained access to
  // library L at time createId", so a user rejoining a space or being added
  // to a pre-existing space gets fresh createIds > their checkpoint and the
  // per-library asset backfill loop correctly re-iterates the library.
  //
  // The `library_user.libraryId IN accessibleLibraries(userId)` filter is
  // preserved so that soft-deleted owned libraries are excluded — matching
  // the existing behavior where `accessibleLibraries` drops the ownership
  // branch when `deletedAt IS NOT NULL`, while keeping soft-deleted libraries
  // visible via the space-link branch. Without this filter, an owner who
  // soft-deletes a library would still see its assets re-streamed on every
  // sync.
  //
  // See docs/plans/2026-04-11-library-user-access-backfill-design.md.
  @GenerateSql({ params: [dummyCreateAfterOptions] })
  getCreatedAfter({ nowId, userId, afterCreateId }: SyncCreatedAfterOptions) {
    return this.db
      .selectFrom('library_user')
      .select(['library_user.libraryId as id', 'library_user.createId'])
      .where('library_user.userId', '=', userId)
      .where('library_user.libraryId', 'in', (eb) => accessibleLibraries(eb, userId))
      .$if(!!afterCreateId, (qb) => qb.where('library_user.createId', '>=', afterCreateId!))
      .where('library_user.createId', '<', nowId)
      .orderBy('library_user.createId', 'asc')
      .execute();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('library_audit', options)
      .select(['id', 'libraryId'])
      .where('userId', '=', options.userId)
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('library_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('library', options)
      .where('library.id', 'in', (eb) => accessibleLibraries(eb, options.userId))
      .select(LIBRARY_SYNC_COLUMNS)
      .stream();
  }
}

// Streams library-owned asset rows. The "once-per-asset" correctness property
// comes from filtering `asset.libraryId IN accessibleLibraries(userId)` directly
// on the asset table. A library linked to multiple spaces is still counted ONCE
// in the accessibleLibraries UNION, and each asset has exactly one libraryId,
// so this class never produces the write-amplification that SharedSpaceAssetSync
// accepts for (space, asset) pairs.
//
// Owns library_asset_audit cleanup because this class is the one that streams
// the per-asset delete events derived from that table.
export class LibraryAssetSync extends BaseSync {
  // Per-library backfill of asset rows for a specific library. Triggered by the
  // `syncLibraryAssetsV1` service loop when the client has not yet backfilled a
  // newly-accessible library.
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, libraryId: string) {
    return this.backfillQuery('asset', options)
      .select(columns.syncAsset)
      .select('asset.updateId')
      .where('asset.libraryId', '=', libraryId)
      .stream();
  }

  // Single upsert stream for library assets. Mirrors PartnerAssetsSync.getUpserts
  // — that's the canonical shape for access-scoped sync without a per-pairing
  // join table. We can't split create vs update like SharedSpaceAssetSync does
  // because there's no stable library<->asset join-row updateId to gate on.
  // Both initial syncs and subsequent metadata changes flow through this stream
  // as `LibraryAssetCreateV1` events; the client upserts idempotently.
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('asset', options)
      .select(columns.syncAsset)
      .select('asset.updateId')
      .where('asset.libraryId', 'is not', null)
      .where('asset.libraryId', 'in', (eb) => accessibleLibraries(eb, options.userId))
      .stream();
  }

  // Stream per-asset deletes from library_asset_audit, scoped to libraries the
  // user can still access. The audit table stores both assetId and libraryId
  // (libraryId is captured by the asset_library_delete_audit trigger from the
  // OLD asset row). The libraryId scoping prevents leaking per-asset delete
  // events to clients who never had access to the library.
  //
  // The whole-library revocation path is handled separately by
  // LibrarySync.getDeletes (library_audit scoped per-user) — when a user loses
  // access to a whole library, they receive a LibraryDeleteV1 and the client
  // drops all assets locally without needing per-asset events.
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('library_asset_audit', options)
      .select(['library_asset_audit.id as id', 'library_asset_audit.assetId as assetId'])
      .where('library_asset_audit.libraryId', 'in', (eb) => accessibleLibraries(eb, options.userId))
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('library_asset_audit', daysAgo);
  }
}

// Streams asset_exif rows for library-owned assets. Scoped by
// asset.libraryId IN accessibleLibraries, joined through asset → asset_exif.
// Mirrors AlbumAssetExifSync but uses the library-access boundary instead of
// the album-user boundary. No cleanupAuditTable — there is no dedicated
// exif audit table (consistent with AlbumAssetExifSync).
export class LibraryAssetExifSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, libraryId: string) {
    return this.backfillQuery('asset', options)
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select(columns.syncAssetExif)
      .select('asset.updateId')
      .where('asset.libraryId', '=', libraryId)
      .stream();
  }

  // Single upsert stream — same rationale as LibraryAssetSync.getUpserts.
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('asset_exif', options)
      .select(columns.syncAssetExif)
      .select('asset_exif.updateId')
      .where('assetId', 'in', (eb) =>
        eb
          .selectFrom('asset')
          .select('asset.id')
          .where('asset.libraryId', 'is not', null)
          .where('asset.libraryId', 'in', (eb2) => accessibleLibraries(eb2, options.userId)),
      )
      .stream();
  }
}

const SHARED_SPACE_LIBRARY_SYNC_COLUMNS = [
  'shared_space_library.spaceId',
  'shared_space_library.libraryId',
  'shared_space_library.addedById',
  'shared_space_library.createdAt',
  'shared_space_library.updatedAt',
  'shared_space_library.updateId',
] as const;

// Streams the shared_space_library join rows — the per-space "which libraries
// are linked" mapping. Scoped by accessibleSpaces (NOT accessibleLibraries):
// this is the join row belonging to the space, and the user must have access
// to the space itself to see its link set.
//
// Owns shared_space_library_audit cleanup.
export class SharedSpaceLibrarySync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, spaceId: string) {
    return this.backfillQuery('shared_space_library', options)
      .select(SHARED_SPACE_LIBRARY_SYNC_COLUMNS)
      .where('shared_space_library.spaceId', '=', spaceId)
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('shared_space_library_audit', options)
      .select(['id', 'spaceId', 'libraryId'])
      .where('spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('shared_space_library_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('shared_space_library', options)
      .select(SHARED_SPACE_LIBRARY_SYNC_COLUMNS)
      .where('shared_space_library.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }
}
