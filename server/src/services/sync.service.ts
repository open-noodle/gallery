import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Insertable } from 'kysely';
import { DateTime, Duration } from 'luxon';
import { Writable } from 'node:stream';
import { OnJob } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  SyncAckDeleteDto,
  SyncAckSetDto,
  SyncAssetV1,
  syncAlbumV2ToV1,
  SyncAssetV2,
  SyncItem,
  SyncStreamDto,
} from 'src/dtos/sync.dto';
import { JobName, QueueName, SyncEntityType, SyncRequestType } from 'src/enum';
import { SyncQueryOptions } from 'src/repositories/sync.repository';
import { SessionSyncCheckpointTable } from 'src/schema/tables/sync-checkpoint.table';
import { BaseService } from 'src/services/base.service';
import { SyncAck } from 'src/types';
import { hexOrBufferToBase64 } from 'src/utils/bytes';
import { formatSecondsToDuration } from 'src/utils/duration';
import { fromAck, serialize, SerializeOptions, toAck } from 'src/utils/sync';

type CheckpointMap = Partial<Record<SyncEntityType, SyncAck>>;
type AssetLike = Omit<SyncAssetV2, 'checksum' | 'thumbhash'> & {
  checksum: Buffer<ArrayBufferLike>;
  thumbhash: Buffer<ArrayBufferLike> | null;
};

const COMPLETE_ID = 'complete';
const MAX_DAYS = 30;
const MAX_DURATION = Duration.fromObject({ days: MAX_DAYS });

const mapSyncAssetV2 = ({ checksum, thumbhash, ...data }: AssetLike): SyncAssetV2 => ({
  ...data,
  checksum: hexOrBufferToBase64(checksum),
  thumbhash: thumbhash ? hexOrBufferToBase64(thumbhash) : null,
});

const mapSyncAssetV1 = (data: AssetLike): SyncAssetV1 => {
  const asset = mapSyncAssetV2(data);

  return {
    ...asset,
    duration: asset.duration === null ? null : formatSecondsToDuration(asset.duration / 1000),
  };
};

const isEntityBackfillComplete = (createId: string, checkpoint: SyncAck | undefined): boolean =>
  createId === checkpoint?.updateId && checkpoint.extraId === COMPLETE_ID;

const getStartId = (createId: string, checkpoint: SyncAck | undefined): string | undefined =>
  createId === checkpoint?.updateId ? checkpoint?.extraId : undefined;

const send = <T extends keyof SyncItem, D extends SyncItem[T]>(response: Writable, item: SerializeOptions<T, D>) => {
  response.write(serialize(item));
};

const sendEntityBackfillCompleteAck = (response: Writable, ackType: SyncEntityType, id: string) => {
  send(response, { type: SyncEntityType.SyncAckV1, data: {}, ackType, ids: [id, COMPLETE_ID] });
};

export const SYNC_TYPES_ORDER = [
  SyncRequestType.AuthUsersV1,
  SyncRequestType.UsersV1,
  SyncRequestType.PartnersV1,
  SyncRequestType.AssetsV1,
  SyncRequestType.AssetsV2,
  SyncRequestType.StacksV1,
  SyncRequestType.PartnerAssetsV1,
  SyncRequestType.PartnerAssetsV2,
  SyncRequestType.PartnerStacksV1,
  SyncRequestType.AlbumAssetsV1,
  SyncRequestType.AlbumAssetsV2,
  SyncRequestType.AlbumsV1,
  SyncRequestType.AlbumsV2,
  SyncRequestType.AlbumUsersV1,
  SyncRequestType.AlbumToAssetsV1,
  SyncRequestType.AssetExifsV1,
  SyncRequestType.AlbumAssetExifsV1,
  SyncRequestType.PartnerAssetExifsV1,
  SyncRequestType.MemoriesV1,
  SyncRequestType.MemoryToAssetsV1,
  SyncRequestType.PeopleV1,
  SyncRequestType.AssetFacesV1,
  SyncRequestType.AssetFacesV2,
  SyncRequestType.UserMetadataV1,
  SyncRequestType.AssetMetadataV1,
  SyncRequestType.AssetEditsV1,
  // Shared spaces — wired in Task 10. Order: parent metadata before assets, exifs after assets.
  SyncRequestType.SharedSpacesV1,
  SyncRequestType.SharedSpaceMembersV1,
  SyncRequestType.SharedSpaceAssetsV1,
  SyncRequestType.SharedSpaceToAssetsV1,
  SyncRequestType.SharedSpaceAssetExifsV1,
  // Libraries — wired in Task 27. Order: library metadata first, then the
  // shared_space_library link rows (small, tens of rows at most), THEN the
  // bulky library asset rows. The link rows must precede the asset rows so
  // that mobile's space-detail Drift query — which joins shared_space_library
  // with remote_asset on library_id — can emit incremental buckets as the
  // 5000-row library asset batches arrive. Putting the link rows last makes
  // the JOIN return zero buckets until the very end of the sync pass, so on
  // a 40k-asset library the space view looks empty for ~60 s. See mobile
  // space-slowness investigation.
  SyncRequestType.LibrariesV1,
  SyncRequestType.SharedSpaceLibrariesV1,
  SyncRequestType.LibraryAssetsV1,
  SyncRequestType.LibraryAssetExifsV1,
];

const throwSessionRequired = () => {
  throw new ForbiddenException('Sync endpoints cannot be used with API keys');
};

@Injectable()
export class SyncService extends BaseService {
  getAcks(auth: AuthDto) {
    const sessionId = auth.session?.id;
    if (!sessionId) {
      return throwSessionRequired();
    }

    return this.syncCheckpointRepository.getAll(sessionId);
  }

  async setAcks(auth: AuthDto, dto: SyncAckSetDto) {
    const sessionId = auth.session?.id;
    if (!sessionId) {
      return throwSessionRequired();
    }

    const checkpoints: Record<string, Insertable<SessionSyncCheckpointTable>> = {};
    for (const ack of dto.acks) {
      const { type } = fromAck(ack);
      if (type === SyncEntityType.SyncResetV1) {
        await this.sessionRepository.resetSyncProgress(sessionId);
        return;
      }
      // TODO proper ack validation via class validator
      if (!Object.values(SyncEntityType).includes(type)) {
        throw new BadRequestException(`Invalid ack type: ${type}`);
      }

      // TODO pick the latest ack for each type, instead of using the last one
      checkpoints[type] = { sessionId, type, ack };
    }

    await this.syncCheckpointRepository.upsertAll(Object.values(checkpoints));
  }

  async deleteAcks(auth: AuthDto, dto: SyncAckDeleteDto) {
    const sessionId = auth.session?.id;
    if (!sessionId) {
      return throwSessionRequired();
    }

    await this.syncCheckpointRepository.deleteAll(sessionId, dto.types);
  }

  async stream(auth: AuthDto, response: Writable, dto: SyncStreamDto) {
    const session = auth.session;
    if (!session) {
      return throwSessionRequired();
    }

    if (dto.reset) {
      await this.sessionRepository.resetSyncProgress(session.id);
    }

    const isPendingSyncReset = await this.sessionRepository.isPendingSyncReset(session.id);
    if (isPendingSyncReset) {
      send(response, { type: SyncEntityType.SyncResetV1, ids: ['reset'], data: {} });
      response.end();
      return;
    }

    const checkpoints = await this.syncCheckpointRepository.getAll(session.id);
    const checkpointMap: CheckpointMap = Object.fromEntries(checkpoints.map(({ type, ack }) => [type, fromAck(ack)]));

    if (this.needsFullSync(checkpointMap)) {
      send(response, { type: SyncEntityType.SyncResetV1, ids: ['reset'], data: {} });
      response.end();
      return;
    }

    const { nowId } = await this.syncCheckpointRepository.getNow();
    const options: SyncQueryOptions = { nowId, userId: auth.user.id };

    const handlers: Record<SyncRequestType, () => Promise<void>> = {
      // deprecated handlers
      [SyncRequestType.AssetsV1]: () => this.syncAssetsV1(),
      [SyncRequestType.AssetFacesV1]: () => this.syncAssetFacesV1(),
      [SyncRequestType.PartnerAssetsV1]: () => this.syncPartnerAssetsV1(),
      [SyncRequestType.AlbumAssetsV1]: () => this.syncAlbumAssetsV1(),

      [SyncRequestType.AuthUsersV1]: () => this.syncAuthUsersV1(options, response, checkpointMap),
      [SyncRequestType.UsersV1]: () => this.syncUsersV1(options, response, checkpointMap),
      [SyncRequestType.PartnersV1]: () => this.syncPartnersV1(options, response, checkpointMap),
      [SyncRequestType.AssetsV2]: () => this.syncAssetsV2(options, response, checkpointMap),
      [SyncRequestType.AssetExifsV1]: () => this.syncAssetExifsV1(options, response, checkpointMap),
      [SyncRequestType.AssetEditsV1]: () => this.syncAssetEditsV1(options, response, checkpointMap),
      [SyncRequestType.PartnerAssetsV2]: () => this.syncPartnerAssetsV2(options, response, checkpointMap, session.id),
      [SyncRequestType.AssetMetadataV1]: () => this.syncAssetMetadataV1(options, response, checkpointMap, auth),
      [SyncRequestType.PartnerAssetExifsV1]: () =>
        this.syncPartnerAssetExifsV1(options, response, checkpointMap, session.id),
      [SyncRequestType.AlbumsV1]: () => this.syncAlbumsV1(options, response, checkpointMap),
      [SyncRequestType.AlbumsV2]: () => this.syncAlbumsV2(options, response, checkpointMap),
      [SyncRequestType.AlbumUsersV1]: () => this.syncAlbumUsersV1(options, response, checkpointMap, session.id),
      [SyncRequestType.AlbumAssetsV2]: () => this.syncAlbumAssetsV2(options, response, checkpointMap, session.id),
      [SyncRequestType.AlbumToAssetsV1]: () => this.syncAlbumToAssetsV1(options, response, checkpointMap, session.id),
      [SyncRequestType.AlbumAssetExifsV1]: () =>
        this.syncAlbumAssetExifsV1(options, response, checkpointMap, session.id),
      [SyncRequestType.MemoriesV1]: () => this.syncMemoriesV1(options, response, checkpointMap),
      [SyncRequestType.MemoryToAssetsV1]: () => this.syncMemoryAssetsV1(options, response, checkpointMap),
      [SyncRequestType.StacksV1]: () => this.syncStackV1(options, response, checkpointMap),
      [SyncRequestType.PartnerStacksV1]: () => this.syncPartnerStackV1(options, response, checkpointMap, session.id),
      [SyncRequestType.PeopleV1]: () => this.syncPeopleV1(options, response, checkpointMap),
      [SyncRequestType.AssetFacesV2]: () => this.syncAssetFacesV2(options, response, checkpointMap),
      [SyncRequestType.UserMetadataV1]: () => this.syncUserMetadataV1(options, response, checkpointMap),
      // Shared-space sync handlers.
      [SyncRequestType.SharedSpacesV1]: () => this.syncSharedSpacesV1(options, response, checkpointMap),
      [SyncRequestType.SharedSpaceMembersV1]: () =>
        this.syncSharedSpaceMembersV1(options, response, checkpointMap, session.id),
      [SyncRequestType.SharedSpaceAssetsV1]: () =>
        this.syncSharedSpaceAssetsV1(options, response, checkpointMap, session.id),
      [SyncRequestType.SharedSpaceAssetExifsV1]: () =>
        this.syncSharedSpaceAssetExifsV1(options, response, checkpointMap, session.id),
      [SyncRequestType.SharedSpaceToAssetsV1]: () =>
        this.syncSharedSpaceToAssetsV1(options, response, checkpointMap, session.id),
      // Library sync handlers.
      [SyncRequestType.LibrariesV1]: () => this.syncLibrariesV1(options, response, checkpointMap),
      [SyncRequestType.LibraryAssetsV1]: () => this.syncLibraryAssetsV1(options, response, checkpointMap, session.id),
      [SyncRequestType.LibraryAssetExifsV1]: () =>
        this.syncLibraryAssetExifsV1(options, response, checkpointMap, session.id),
      [SyncRequestType.SharedSpaceLibrariesV1]: () =>
        this.syncSharedSpaceLibrariesV1(options, response, checkpointMap, session.id),
    } as const;

    for (const type of SYNC_TYPES_ORDER.filter((type) => dto.types.includes(type))) {
      const handler = handlers[type as keyof typeof handlers];
      await handler();
    }

    send(response, { type: SyncEntityType.SyncCompleteV1, ids: [nowId], data: {} });

    response.end();
  }

  @OnJob({ name: JobName.AuditTableCleanup, queue: QueueName.BackgroundTask })
  async onAuditTableCleanup() {
    const pruneThreshold = MAX_DAYS + 1;

    await this.syncRepository.album.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.albumUser.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.albumToAsset.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.asset.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.assetFace.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.assetMetadata.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.assetEdit.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.memory.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.memoryToAsset.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.partner.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.person.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.stack.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.user.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.userMetadata.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.sharedSpace.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.sharedSpaceMember.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.sharedSpaceToAsset.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.library.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.libraryAsset.cleanupAuditTable(pruneThreshold);
    await this.syncRepository.sharedSpaceLibrary.cleanupAuditTable(pruneThreshold);
  }

  private needsFullSync(checkpointMap: CheckpointMap) {
    const completeAck = checkpointMap[SyncEntityType.SyncCompleteV1];
    if (!completeAck) {
      return false;
    }

    const milliseconds = Number.parseInt(completeAck.updateId.replaceAll('-', '').slice(0, 12), 16);

    return DateTime.fromMillis(milliseconds) < DateTime.now().minus(MAX_DURATION);
  }

  private async syncAuthUsersV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const upsertType = SyncEntityType.AuthUserV1;
    const upserts = this.syncRepository.authUser.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, profileImagePath, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data: { ...data, hasProfileImage: !!profileImagePath } });
    }
  }

  private async syncUsersV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.UserDeleteV1;
    const deletes = this.syncRepository.user.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const upsertType = SyncEntityType.UserV1;
    const upserts = this.syncRepository.user.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, profileImagePath, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data: { ...data, hasProfileImage: !!profileImagePath } });
    }
  }

  private async syncPartnersV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.PartnerDeleteV1;
    const deletes = this.syncRepository.partner.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const upsertType = SyncEntityType.PartnerV1;
    const upserts = this.syncRepository.partner.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private syncAssetsV1(): Promise<void> {
    throw new BadRequestException('SyncRequestType.AssetsV1 is deprecated, use SyncRequestType.AssetsV2 instead');
  }

  private async syncAssetsV2(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.AssetDeleteV1;
    const deletes = this.syncRepository.asset.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const upsertType = SyncEntityType.AssetV2;
    const upserts = this.syncRepository.asset.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data: mapSyncAssetV2(data) });
    }
  }

  private syncPartnerAssetsV1(): Promise<void> {
    throw new BadRequestException(
      'SyncRequestType.PartnerAssetsV1 is deprecated, use SyncRequestType.PartnerAssetsV2 instead',
    );
  }

  private async syncPartnerAssetsV2(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const deleteType = SyncEntityType.PartnerAssetDeleteV1;
    const deletes = this.syncRepository.partnerAsset.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const backfillType = SyncEntityType.PartnerAssetBackfillV2;
    const backfillCheckpoint = checkpointMap[backfillType];
    const partners = await this.syncRepository.partner.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.PartnerAssetV2;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const partner of partners) {
        const createId = partner.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.partnerAsset.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          partner.sharedById,
        );

        for await (const { updateId, ...data } of backfill) {
          send(response, {
            type: backfillType,
            ids: [createId, updateId],
            data: mapSyncAssetV2(data),
          });
        }

        sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (partners.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: partners.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.partnerAsset.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data: mapSyncAssetV2(data) });
    }
  }

  private async syncAssetExifsV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const upsertType = SyncEntityType.AssetExifV1;
    const upserts = this.syncRepository.assetExif.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private async syncAssetEditsV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.AssetEditDeleteV1;
    const deletes = this.syncRepository.assetEdit.getDeletes({ ...options, ack: checkpointMap[deleteType] });

    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }
    const upsertType = SyncEntityType.AssetEditV1;
    const upserts = this.syncRepository.assetEdit.getUpserts({ ...options, ack: checkpointMap[upsertType] });

    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private async syncPartnerAssetExifsV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const backfillType = SyncEntityType.PartnerAssetExifBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const partners = await this.syncRepository.partner.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });

    const upsertType = SyncEntityType.PartnerAssetExifV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const partner of partners) {
        const createId = partner.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.partnerAssetExif.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          partner.sharedById,
        );

        for await (const { updateId, ...data } of backfill) {
          send(response, { type: backfillType, ids: [partner.createId, updateId], data });
        }

        sendEntityBackfillCompleteAck(response, backfillType, partner.createId);
      }
    } else if (partners.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: partners.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.partnerAssetExif.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private async syncAlbumsV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.AlbumDeleteV1;
    const deletes = this.syncRepository.album.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const upsertType = SyncEntityType.AlbumV1;
    const upserts = this.syncRepository.album.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      const albumUsers = await this.syncRepository.album.getAlbumUsers(data.id);
      send(response, { type: upsertType, ids: [updateId], data: syncAlbumV2ToV1(data, albumUsers) });
    }
  }

  private async syncAlbumsV2(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.AlbumDeleteV1;
    const deletes = this.syncRepository.album.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const upsertType = SyncEntityType.AlbumV2;
    const upserts = this.syncRepository.album.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private async syncSharedSpacesV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.SharedSpaceDeleteV1;
    const deletes = this.syncRepository.sharedSpace.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const upsertType = SyncEntityType.SharedSpaceV1;
    const upserts = this.syncRepository.sharedSpace.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private async syncSharedSpaceMembersV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const deleteType = SyncEntityType.SharedSpaceMemberDeleteV1;
    const deletes = this.syncRepository.sharedSpaceMember.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const backfillType = SyncEntityType.SharedSpaceMemberBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const spaces = await this.syncRepository.sharedSpace.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.SharedSpaceMemberV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const space of spaces) {
        const createId = space.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.sharedSpaceMember.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          space.id,
        );

        for await (const { updateId, ...data } of backfill) {
          send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (spaces.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: spaces.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.sharedSpaceMember.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private async syncSharedSpaceAssetsV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const backfillType = SyncEntityType.SharedSpaceAssetBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const spaces = await this.syncRepository.sharedSpace.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const updateType = SyncEntityType.SharedSpaceAssetUpdateV1;
    const createType = SyncEntityType.SharedSpaceAssetCreateV1;
    const updateCheckpoint = checkpointMap[updateType];
    const createCheckpoint = checkpointMap[createType];
    if (createCheckpoint) {
      const endId = createCheckpoint.updateId;

      for (const space of spaces) {
        const createId = space.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.sharedSpaceAsset.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          space.id,
        );

        for await (const { updateId, ...data } of backfill) {
          send(response, { type: backfillType, ids: [createId, updateId], data: mapSyncAssetV1(data) });
        }

        sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (spaces.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: spaces.at(-1)!.createId,
      });
    }

    if (createCheckpoint) {
      const updates = this.syncRepository.sharedSpaceAsset.getUpdates(
        { ...options, ack: updateCheckpoint },
        createCheckpoint,
      );
      for await (const { updateId, ...data } of updates) {
        send(response, { type: updateType, ids: [updateId], data: mapSyncAssetV1(data) });
      }
    }

    const creates = this.syncRepository.sharedSpaceAsset.getCreates({ ...options, ack: createCheckpoint });
    let first = true;
    for await (const { updateId, ...data } of creates) {
      if (first) {
        send(response, {
          type: SyncEntityType.SyncAckV1,
          data: {},
          ackType: SyncEntityType.SharedSpaceAssetUpdateV1,
          ids: [options.nowId],
        });
        first = false;
      }
      send(response, { type: createType, ids: [updateId], data: mapSyncAssetV1(data) });
    }
  }

  private async syncSharedSpaceAssetExifsV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const backfillType = SyncEntityType.SharedSpaceAssetExifBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const spaces = await this.syncRepository.sharedSpace.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const updateType = SyncEntityType.SharedSpaceAssetExifUpdateV1;
    const createType = SyncEntityType.SharedSpaceAssetExifCreateV1;
    const upsertCheckpoint = checkpointMap[updateType];
    const createCheckpoint = checkpointMap[createType];
    if (createCheckpoint) {
      const endId = createCheckpoint.updateId;

      for (const space of spaces) {
        const createId = space.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.sharedSpaceAssetExif.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          space.id,
        );

        for await (const { updateId, ...data } of backfill) {
          send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (spaces.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: spaces.at(-1)!.createId,
      });
    }

    if (createCheckpoint) {
      const updates = this.syncRepository.sharedSpaceAssetExif.getUpdates(
        { ...options, ack: upsertCheckpoint },
        createCheckpoint,
      );
      for await (const { updateId, ...data } of updates) {
        send(response, { type: updateType, ids: [updateId], data });
      }
    }

    const creates = this.syncRepository.sharedSpaceAssetExif.getCreates({ ...options, ack: createCheckpoint });
    let first = true;
    for await (const { updateId, ...data } of creates) {
      if (first) {
        send(response, {
          type: SyncEntityType.SyncAckV1,
          data: {},
          ackType: SyncEntityType.SharedSpaceAssetExifUpdateV1,
          ids: [options.nowId],
        });
        first = false;
      }
      send(response, { type: createType, ids: [updateId], data });
    }
  }

  private async syncSharedSpaceToAssetsV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const deleteType = SyncEntityType.SharedSpaceToAssetDeleteV1;
    const deletes = this.syncRepository.sharedSpaceToAsset.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const backfillType = SyncEntityType.SharedSpaceToAssetBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const spaces = await this.syncRepository.sharedSpace.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.SharedSpaceToAssetV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const space of spaces) {
        const createId = space.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.sharedSpaceToAsset.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          space.id,
        );

        for await (const { updateId, ...data } of backfill) {
          send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (spaces.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: spaces.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.sharedSpaceToAsset.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  // Library sync — streams Library rows the user can access. Mirrors the
  // shape of syncSharedSpacesV1: deletes first (from library_audit where
  // userId = me), then full upserts via LibrarySync.getUpserts.
  private async syncLibrariesV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.LibraryDeleteV1;
    const deletes = this.syncRepository.library.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, libraryId } of deletes) {
      send(response, { type: deleteType, ids: [id], data: { libraryId } });
    }

    const upsertType = SyncEntityType.LibraryV1;
    const upserts = this.syncRepository.library.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  // Library assets — deletes first, then per-library backfill loop keyed by
  // library.createId, then a single upserts stream scoped by accessibleLibraries.
  // Mirrors syncPartnerAssetsV1 (NOT syncSharedSpaceAssetsV1): libraries have no
  // per-pairing join-row updateId to gate a separate Updates stream, so all
  // live changes flow through a single getUpserts via `LibraryAssetCreateV1`.
  // Dedup is enforced at the query level — LibraryAssetSync uses
  // `asset.libraryId IN accessibleLibraries` directly, so a library linked to
  // multiple spaces still produces each asset once.
  private async syncLibraryAssetsV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const deleteType = SyncEntityType.LibraryAssetDeleteV1;
    const deletes = this.syncRepository.libraryAsset.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, assetId } of deletes) {
      send(response, { type: deleteType, ids: [id], data: { assetId } });
    }

    const backfillType = SyncEntityType.LibraryAssetBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const libraries = await this.syncRepository.library.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.LibraryAssetCreateV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const library of libraries) {
        const createId = library.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.libraryAsset.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          library.id,
        );

        for await (const { updateId, ...data } of backfill) {
          send(response, { type: backfillType, ids: [createId, updateId], data: mapSyncAssetV1(data) });
        }

        sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (libraries.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: libraries.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.libraryAsset.getUpserts({ ...options, ack: upsertCheckpoint });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data: mapSyncAssetV1(data) });
    }
  }

  // Library asset exifs — mirrors syncLibraryAssetsV1 shape: backfill per
  // library, then a single getUpserts stream.
  private async syncLibraryAssetExifsV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const backfillType = SyncEntityType.LibraryAssetExifBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const libraries = await this.syncRepository.library.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.LibraryAssetExifCreateV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const library of libraries) {
        const createId = library.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.libraryAssetExif.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          library.id,
        );

        for await (const { updateId, ...data } of backfill) {
          send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (libraries.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: libraries.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.libraryAssetExif.getUpserts({ ...options, ack: upsertCheckpoint });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  // shared_space_library join rows — mirrors syncSharedSpaceMembersV1. Deletes
  // first (from shared_space_library_audit scoped to accessibleSpaces), then
  // per-space backfill, then upserts for any new link rows.
  private async syncSharedSpaceLibrariesV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const deleteType = SyncEntityType.SharedSpaceLibraryDeleteV1;
    const deletes = this.syncRepository.sharedSpaceLibrary.getDeletes({
      ...options,
      ack: checkpointMap[deleteType],
    });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const backfillType = SyncEntityType.SharedSpaceLibraryBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const spaces = await this.syncRepository.sharedSpace.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.SharedSpaceLibraryV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const space of spaces) {
        const createId = space.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.sharedSpaceLibrary.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          space.id,
        );

        for await (const { updateId, ...data } of backfill) {
          send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (spaces.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: spaces.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.sharedSpaceLibrary.getUpserts({
      ...options,
      ack: checkpointMap[upsertType],
    });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private async syncAlbumUsersV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const deleteType = SyncEntityType.AlbumUserDeleteV1;
    const deletes = this.syncRepository.albumUser.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const backfillType = SyncEntityType.AlbumUserBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const albums = await this.syncRepository.album.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.AlbumUserV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const album of albums) {
        const createId = album.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.albumUser.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          album.id,
        );

        for await (const { updateId, ...data } of backfill) {
          send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (albums.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: albums.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.albumUser.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private syncAlbumAssetsV1(): Promise<void> {
    throw new BadRequestException(
      'SyncRequestType.AlbumAssetsV1 is deprecated, use SyncRequestType.AlbumAssetsV2 instead',
    );
  }

  private async syncAlbumAssetsV2(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const backfillType = SyncEntityType.AlbumAssetBackfillV2;
    const backfillCheckpoint = checkpointMap[backfillType];
    const albums = await this.syncRepository.album.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const updateType = SyncEntityType.AlbumAssetUpdateV2;
    const createType = SyncEntityType.AlbumAssetCreateV2;
    const updateCheckpoint = checkpointMap[updateType];
    const createCheckpoint = checkpointMap[createType];
    if (createCheckpoint) {
      const endId = createCheckpoint.updateId;

      for (const album of albums) {
        const createId = album.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.albumAsset.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          album.id,
        );

        for await (const { updateId, ...data } of backfill) {
          send(response, { type: backfillType, ids: [createId, updateId], data: mapSyncAssetV2(data) });
        }

        sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (albums.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: albums.at(-1)!.createId,
      });
    }

    if (createCheckpoint) {
      const updates = this.syncRepository.albumAsset.getUpdates(
        { ...options, ack: updateCheckpoint },
        createCheckpoint,
      );
      for await (const { updateId, ...data } of updates) {
        send(response, { type: updateType, ids: [updateId], data: mapSyncAssetV2(data) });
      }
    }

    const creates = this.syncRepository.albumAsset.getCreates({ ...options, ack: createCheckpoint });
    let first = true;
    for await (const { updateId, ...data } of creates) {
      if (first) {
        send(response, {
          type: SyncEntityType.SyncAckV1,
          data: {},
          ackType: SyncEntityType.AlbumAssetUpdateV2,
          ids: [options.nowId],
        });
        first = false;
      }
      send(response, { type: createType, ids: [updateId], data: mapSyncAssetV2(data) });
    }
  }

  private async syncAlbumAssetExifsV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const backfillType = SyncEntityType.AlbumAssetExifBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const albums = await this.syncRepository.album.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const updateType = SyncEntityType.AlbumAssetExifUpdateV1;
    const createType = SyncEntityType.AlbumAssetExifCreateV1;
    const upsertCheckpoint = checkpointMap[updateType];
    const createCheckpoint = checkpointMap[createType];
    if (createCheckpoint) {
      const endId = createCheckpoint.updateId;

      for (const album of albums) {
        const createId = album.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.albumAssetExif.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          album.id,
        );

        for await (const { updateId, ...data } of backfill) {
          send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (albums.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: albums.at(-1)!.createId,
      });
    }

    if (createCheckpoint) {
      const updates = this.syncRepository.albumAssetExif.getUpdates(
        { ...options, ack: upsertCheckpoint },
        createCheckpoint,
      );
      for await (const { updateId, ...data } of updates) {
        send(response, { type: updateType, ids: [updateId], data });
      }
    }

    const creates = this.syncRepository.albumAssetExif.getCreates({ ...options, ack: createCheckpoint });
    let first = true;
    for await (const { updateId, ...data } of creates) {
      if (first) {
        send(response, {
          type: SyncEntityType.SyncAckV1,
          data: {},
          ackType: SyncEntityType.AlbumAssetExifUpdateV1,
          ids: [options.nowId],
        });
        first = false;
      }
      send(response, { type: createType, ids: [updateId], data });
    }
  }

  private async syncAlbumToAssetsV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const deleteType = SyncEntityType.AlbumToAssetDeleteV1;
    const deletes = this.syncRepository.albumToAsset.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const backfillType = SyncEntityType.AlbumToAssetBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const albums = await this.syncRepository.album.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.AlbumToAssetV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const album of albums) {
        const createId = album.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.albumToAsset.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          album.id,
        );

        for await (const { updateId, ...data } of backfill) {
          send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (albums.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: albums.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.albumToAsset.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private async syncMemoriesV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.MemoryDeleteV1;
    const deletes = this.syncRepository.memory.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const upsertType = SyncEntityType.MemoryV1;
    const upserts = this.syncRepository.memory.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private async syncMemoryAssetsV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.MemoryToAssetDeleteV1;
    const deletes = this.syncRepository.memoryToAsset.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const upsertType = SyncEntityType.MemoryToAssetV1;
    const upserts = this.syncRepository.memoryToAsset.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private async syncStackV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.StackDeleteV1;
    const deletes = this.syncRepository.stack.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const upsertType = SyncEntityType.StackV1;
    const upserts = this.syncRepository.stack.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private async syncPartnerStackV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const deleteType = SyncEntityType.PartnerStackDeleteV1;
    const deletes = this.syncRepository.partnerStack.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const backfillType = SyncEntityType.PartnerStackBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const partners = await this.syncRepository.partner.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.PartnerStackV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const partner of partners) {
        const createId = partner.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.partnerStack.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          partner.sharedById,
        );

        for await (const { updateId, ...data } of backfill) {
          send(response, {
            type: backfillType,
            ids: [createId, updateId],
            data,
          });
        }

        sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (partners.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: partners.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.partnerStack.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private async syncPeopleV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.PersonDeleteV1;
    const deletes = this.syncRepository.person.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const upsertType = SyncEntityType.PersonV1;
    const upserts = this.syncRepository.person.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private syncAssetFacesV1(): Promise<void> {
    throw new BadRequestException(
      'SyncRequestType.AssetFacesV1 is deprecated, use SyncRequestType.AssetFacesV2 instead',
    );
  }

  private async syncAssetFacesV2(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.AssetFaceDeleteV1;
    const deletes = this.syncRepository.assetFace.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const upsertType = SyncEntityType.AssetFaceV2;
    const upserts = this.syncRepository.assetFace.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private async syncUserMetadataV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.UserMetadataDeleteV1;
    const deletes = this.syncRepository.userMetadata.getDeletes({ ...options, ack: checkpointMap[deleteType] });

    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const upsertType = SyncEntityType.UserMetadataV1;
    const upserts = this.syncRepository.userMetadata.getUpserts({ ...options, ack: checkpointMap[upsertType] });

    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private async syncAssetMetadataV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    auth: AuthDto,
  ) {
    const deleteType = SyncEntityType.AssetMetadataDeleteV1;
    const deletes = this.syncRepository.assetMetadata.getDeletes(
      { ...options, ack: checkpointMap[deleteType] },
      auth.user.id,
    );

    for await (const { id, ...data } of deletes) {
      send(response, { type: deleteType, ids: [id], data });
    }

    const upsertType = SyncEntityType.AssetMetadataV1;
    const upserts = this.syncRepository.assetMetadata.getUpserts(
      { ...options, ack: checkpointMap[upsertType] },
      auth.user.id,
    );

    for await (const { updateId, ...data } of upserts) {
      send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  private async upsertBackfillCheckpoint(item: { type: SyncEntityType; sessionId: string; createId: string }) {
    const { type, sessionId, createId } = item;
    await this.syncCheckpointRepository.upsertAll([
      {
        type,
        sessionId,
        ack: toAck({
          type,
          updateId: createId,
          extraId: COMPLETE_ID,
        }),
      },
    ]);
  }
}
