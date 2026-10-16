import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { isUndefined, omitBy } from 'lodash-es';
import { DateTime, Duration } from 'luxon';
import type { AssetFile } from 'src/database.js';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import type { JobItem, JobOf } from 'src/types.js';
import { isDiskPath } from 'src/backends/disk-storage.backend.js';
import { OnJob } from 'src/decorators.js';
import { AssetResponseDto, SanitizedAssetResponseDto, mapAsset } from 'src/dtos/asset-response.dto.js';
import {
  AssetBulkDeleteDto,
  AssetBulkUpdateDto,
  AssetCopyDto,
  AssetJobName,
  AssetJobsDto,
  AssetMetadataBulkDeleteDto,
  AssetMetadataBulkResponseDto,
  AssetMetadataBulkUpsertDto,
  AssetMetadataResponseDto,
  AssetMetadataUpsertDto,
  AssetStatsDto,
  UpdateAssetDto,
  mapStats,
} from 'src/dtos/asset.dto.js';
import {
  AssetEditAction,
  type AssetEditActionItem,
  AssetEditsCreateDto,
  AssetEditsResponseDto,
} from 'src/dtos/editing.dto.js';
import { AssetOcrResponseDto } from 'src/dtos/ocr.dto.js';
import {
  AssetFileType,
  AssetStatus,
  AssetType,
  AssetVisibility,
  JobName,
  JobStatus,
  Permission,
  QueueName,
} from 'src/enum.js';
import { requireAssetEditAccess } from 'src/gallery/utils/access-grants.js';
import { applyAssetResponseOverlay } from 'src/gallery/utils/asset-response-overlay.js';
import { afterAssetUpdate, beforeAssetUpdate, beforeAssetUpdateAll } from 'src/gallery/utils/asset-update-hooks.js';
import { logCrossOwnerEdit } from 'src/gallery/utils/cross-owner-edit.js';
import { BaseService } from 'src/services/base.service.js';
import { requireElevatedPermission } from 'src/utils/access.js';
import {
  getAssetFiles,
  getDimensions,
  isPanorama,
  onAfterUnlink,
  onBeforeLink,
  onBeforeUnlink,
} from 'src/utils/asset.util.js';
import { isDeadlockError, retryOnDeadlock, updateLockedColumns } from 'src/utils/database.js';
import { extractTimeZone } from 'src/utils/date.js';
import { favoriteViewerId } from 'src/utils/favorite.js';
import { batched, findOrFail } from 'src/utils/misc.js';
import { transformOcrBoundingBox } from 'src/utils/transform.js';

@Injectable()
export class AssetService extends BaseService {
  async getStatistics(auth: AuthDto, dto: AssetStatsDto) {
    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    const stats = await this.assetRepository.getStatistics(auth.user.id, dto);
    return mapStats(stats);
  }

  async get(auth: AuthDto, id: string, spaceId?: string): Promise<AssetResponseDto | SanitizedAssetResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [id] });

    // #763: the isFavoriteForUser overlay is resolved for the CALLER. A shared-link session has no
    // caller of its own — auth.user is the link OWNER — so favoriteViewerId returns undefined there
    // and the response reports false rather than the owner's private favorites.
    const asset = await this.assetRepository.getById(
      id,
      {
        exifInfo: true,
        owner: true,
        faces: { person: true, viewingUserId: auth.user.id },
        stack: { assets: true },
        edits: true,
        tags: true,
      },
      favoriteViewerId(auth),
    );

    if (!asset) {
      throw new BadRequestException('Asset not found');
    }

    if (auth.sharedLink && !auth.sharedLink.showExif) {
      return mapAsset(asset, { stripMetadata: true, withStack: true, auth });
    }

    const data = mapAsset(asset, { withStack: true, auth });

    if (auth.sharedLink) {
      delete data.owner;
    }

    if (auth.sharedLink) {
      data.people = [];
    }

    await applyAssetResponseOverlay(
      {
        access: this.accessRepository,
        faceIdentity: this.faceIdentityRepository,
        sharedSpace: this.sharedSpaceRepository,
      },
      { auth, id, spaceId, data, faces: asset.faces ?? [] },
    );

    return data;
  }

  async update(auth: AuthDto, id: string, dto: UpdateAssetDto): Promise<AssetResponseDto> {
    await requireAssetEditAccess(this.accessRepository, { auth, ids: [id] });

    // rbac-3: visibility AND livePhotoVideoId are owner-only structural writes (see updateAll). A space editor
    // holds edit access over other members' assets via checkSpaceEditAccess, but must not flip their visibility
    // (fleet-wide tombstone) or re-link their motion video. Reject if either is set on an asset the caller does
    // not own; other metadata (description/rating/…) stays editor-allowed. Runs BEFORE the livePhotoVideoId
    // link/unlink side-effects and the visibility transition helper below.
    //
    // isFavorite is NOT owner-gated (#763): it writes only the caller's own asset_favorite row via
    // updateFavorites, never the owner's state.
    if (dto.visibility !== undefined || dto.livePhotoVideoId !== undefined) {
      const ownedIds = await this.checkAccess({ auth, permission: Permission.AssetDelete, ids: [id] });
      if (!ownedIds.has(id)) {
        throw new ForbiddenException('Visibility and live-photo linkage can only be changed on assets you own');
      }
    }

    const { description, dateTimeOriginal, latitude, longitude, rating, isFavorite: _isFavorite, ...rest } = dto;
    const repos = { asset: this.assetRepository, event: this.eventRepository };

    let previousMotion: { id: string } | null = null;
    if (rest.livePhotoVideoId) {
      await onBeforeLink(repos, { userId: auth.user.id, livePhotoVideoId: rest.livePhotoVideoId });
    } else if (rest.livePhotoVideoId === null) {
      const asset = await this.findOrFail(id);
      if (asset.livePhotoVideoId) {
        previousMotion = await onBeforeUnlink(repos, { livePhotoVideoId: asset.livePhotoVideoId });
      }
    }

    const wroteMetadata = await this.updateExif({ id, description, dateTimeOriginal, latitude, longitude, rating });

    const priorVisibilities = await beforeAssetUpdate(this.assetUpdateRepositories, auth, id, dto);

    // #763: auth.user.id is the CALLER — this endpoint requires Permission.AssetUpdate (never
    // sharedLink: true, see asset.controller.ts), so auth.user.id is always a genuine caller here.
    const asset = await this.assetRepository.update({ id, ...rest }, auth.user.id);

    if (previousMotion && asset) {
      await onAfterUnlink(repos, {
        userId: auth.user.id,
        livePhotoVideoId: previousMotion.id,
        visibility: asset.visibility,
      });
    }

    if (!asset) {
      throw new BadRequestException('Asset not found');
    }

    await afterAssetUpdate(this.assetUpdateRepositories, auth, [id], dto, priorVisibilities);

    if (!wroteMetadata) {
      this.websocketRepository.clientSend('on_asset_update', auth.user.id, mapAsset(asset, { auth }));
    }

    return this.get(auth, id) as Promise<AssetResponseDto>;
  }

  async updateAll(auth: AuthDto, dto: AssetBulkUpdateDto): Promise<void> {
    const {
      ids,
      visibility,
      dateTimeOriginal,
      latitude,
      longitude,
      rating,
      description,
      duplicateId,
      dateTimeRelative,
      timeZone,
    } = dto;
    await requireAssetEditAccess(this.accessRepository, { auth, ids });

    // rbac-3: `visibility` is destructive — flipping an asset to Locked/Hidden strips it from the owner's
    // albums (removeAssetsFromAll) and #757-tombstones it off every member device. Edit access grants a space
    // EDITOR that power over OTHER members' direct+library+album assets (checkSpaceEditAccess), which would let
    // an editor wipe another member's asset fleet-wide. Restrict visibility to OWNED ids: reject the whole request
    // if visibility is set on any id the caller does not own. This guard MUST run before the write and the
    // applyVisibilityTransitionSideEffects cascade below, or the destructive side-effects fire before the guard.
    // AssetDelete == the pure owner arm (checkOwnerAccess, same hasElevatedPermission as the AssetUpdate gate's
    // isOwner sub-check); a library-backed asset owned by another user is correctly NOT returned as owned.
    //
    // duplicateId takes the same guard: it is the owner's own duplicate clean-up, and an editor must not pull a
    // member's asset into or out of a duplicate group. isFavorite is NOT owner-gated (#763): it writes only the
    // caller's own asset_favorite row via updateFavorites, never the owner's state.
    if (visibility !== undefined || duplicateId !== undefined) {
      const ownedIds = await this.checkAccess({ auth, permission: Permission.AssetDelete, ids });
      if (ownedIds.size !== new Set(ids).size) {
        throw new ForbiddenException('Visibility and duplicate grouping can only be changed on assets you own');
      }
    }

    const priorVisibilities = await beforeAssetUpdateAll(this.assetUpdateRepositories, auth, dto);

    const assetDto = omitBy({ visibility, duplicateId }, isUndefined);

    // When latitude/longitude are updated in bulk, reverse-geocode once so country/state/city
    // stay in sync across all selected assets. See updateExif() for the rationale.
    let geo: { country: string | null; state: string | null; city: string | null } | undefined;
    if (latitude !== undefined && longitude !== undefined) {
      geo = await this.mapRepository.reverseGeocode({ latitude, longitude });
    }

    const exifDto = omitBy(
      {
        latitude,
        longitude,
        rating,
        description,
        dateTimeOriginal,
        ...geo,
      },
      isUndefined,
    );

    let shouldWriteSidecar = false;
    if (Object.keys(exifDto).length > 0) {
      await this.assetRepository.updateAllExif(ids, exifDto);
      shouldWriteSidecar = true;
    }

    const extractedTimeZone = extractTimeZone(dateTimeOriginal);

    if (
      (dateTimeRelative !== undefined && dateTimeRelative !== 0) ||
      timeZone !== undefined ||
      extractedTimeZone?.type === 'fixed'
    ) {
      await this.assetRepository.updateDateTimeOriginal(ids, dateTimeRelative, timeZone ?? extractedTimeZone?.name);
      shouldWriteSidecar = true;
    }

    if (Object.keys(assetDto).length > 0) {
      await this.assetRepository.updateAll(ids, assetDto);
    }

    await afterAssetUpdate(this.assetUpdateRepositories, auth, ids, dto, priorVisibilities);

    if (shouldWriteSidecar) {
      await this.jobRepository.queueAll(ids.map((id) => ({ name: JobName.SidecarWrite, data: { id } })));
    } else {
      const assets = await this.assetRepository.getByIds(ids, auth.user.id);
      for (const asset of assets) {
        this.websocketRepository.clientSend('on_asset_update', auth.user.id, mapAsset(asset, { auth }));
      }
    }
  }

  async copy(
    auth: AuthDto,
    {
      sourceId,
      targetId,
      albums = true,
      sidecar = true,
      sharedLinks = true,
      stack = true,
      favorite = true,
    }: AssetCopyDto,
  ) {
    await this.requireAccess({ auth, permission: Permission.AssetCopy, ids: [sourceId, targetId] });
    const sourceAsset = await this.assetRepository.getForCopy(sourceId);
    const targetAsset = await this.assetRepository.getForCopy(targetId);

    if (!sourceAsset || !targetAsset) {
      throw new BadRequestException('Both assets must exist');
    }

    if (sourceId === targetId) {
      throw new BadRequestException('Source and target id must be distinct');
    }

    if (albums) {
      await this.albumRepository.copyAlbums({ sourceAssetId: sourceId, targetAssetId: targetId });
    }

    if (sharedLinks) {
      await this.sharedLinkAssetRepository.copySharedLinks({ sourceAssetId: sourceId, targetAssetId: targetId });
    }

    if (stack) {
      await this.copyStack({ sourceAsset, targetAsset });
    }

    if (favorite) {
      await this.assetRepository.update({ id: targetId, isFavorite: sourceAsset.isFavorite });
    }

    if (sidecar) {
      await this.copySidecar({ sourceAsset, targetAsset });
    }
  }

  private async copyStack({
    sourceAsset,
    targetAsset,
  }: {
    sourceAsset: { id: string; stackId: string | null };
    targetAsset: { id: string; stackId: string | null };
  }) {
    if (!sourceAsset.stackId) {
      return;
    }

    if (targetAsset.stackId) {
      await this.stackRepository.merge({ sourceId: sourceAsset.stackId, targetId: targetAsset.stackId });
      await this.stackRepository.delete(sourceAsset.stackId);
    } else {
      await this.assetRepository.update({ id: targetAsset.id, stackId: sourceAsset.stackId });
    }
  }

  private async copySidecar({
    sourceAsset,
    targetAsset,
  }: {
    sourceAsset: { files: AssetFile[] };
    targetAsset: { id: string; files: AssetFile[]; originalPath: string };
  }) {
    const { sidecarFile: sourceFile } = getAssetFiles(sourceAsset.files);
    if (!sourceFile?.path) {
      return;
    }

    // Safe-by-invariant: AssetService.copy rejects sourceId === targetId, so distinct
    // assets guarantee sourceFile.path !== targetSidecarPath.
    const targetSidecarPath = `${targetAsset.originalPath}.xmp`;

    const { localPath, cleanup } = await this.backendMedia.ensureLocalFile(sourceFile.path);
    try {
      if (isDiskPath(targetSidecarPath)) {
        this.storageCore.ensureFolders(targetSidecarPath);
        await this.storageRepository.copyFile(localPath, targetSidecarPath);
      } else {
        const backend = await this.backendMedia.backendFor(targetSidecarPath);
        const stream = this.storageRepository.createPlainReadStream(localPath);
        await backend.put(targetSidecarPath, stream, { contentType: 'application/xml' });
      }
    } finally {
      await cleanup();
    }

    await this.assetRepository.upsertFile({
      assetId: targetAsset.id,
      path: targetSidecarPath,
      type: AssetFileType.Sidecar,
    });
    await this.jobRepository.queue({ name: JobName.AssetExtractMetadata, data: { id: targetAsset.id } });
  }

  @OnJob({ name: JobName.AssetDeleteCheck, queue: QueueName.BackgroundTask })
  async handleAssetDeletionCheck(): Promise<JobStatus> {
    const config = await this.getConfig({ withCache: false });
    const trashedDays = config.trash.enabled ? config.trash.days : 0;
    const trashedBefore = DateTime.now()
      .minus(Duration.fromObject({ days: trashedDays }))
      .toJSDate();

    let count = 0;
    for await (const assets of batched(this.assetJobRepository.streamForDeletedJob(trashedBefore))) {
      await this.jobRepository.queueAll(
        assets.map(({ id, isOffline }) => ({ name: JobName.AssetDelete, data: { id, deleteOnDisk: !isOffline } })),
      );
      count += assets.length;
    }
    if (count > 0) {
      this.logger.log(`Automatically queued ${count} expired trash asset(s) for deletion`);
    }

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetDelete, queue: QueueName.BackgroundTask })
  async handleAssetDeletion(job: JobOf<JobName.AssetDelete>): Promise<JobStatus> {
    const { id, deleteOnDisk } = job;

    const asset = await this.assetJobRepository.getForAssetDeletion(id);

    if (!asset) {
      return JobStatus.Failed;
    }

    if (asset.stack) {
      // asset.stack.assets only includes timeline visible assets and excludes the primary asset
      const remainingStackAssetIds = asset.stack.assets.map((a) => a.id).filter((assetId) => assetId !== id);

      // the primary survives unless it is the asset being deleted
      let remainingCount = remainingStackAssetIds.length;
      if (asset.stack.primaryAssetId !== id) {
        remainingCount++;
      }

      if (remainingCount < 2) {
        // 0 or 1 asset would remain: dissolve the stack so it does not linger as a single-asset stack
        await this.stackRepository.delete(asset.stack.id);
      } else if (asset.stack.primaryAssetId === id) {
        // the primary is being deleted but others remain: promote a new primary
        await this.stackRepository.update(asset.stack.id, {
          id: asset.stack.id,
          primaryAssetId: remainingStackAssetIds[0],
        });
      }
    }

    // Capture affected shared-space (spaceId, personId) pairs BEFORE the asset row and its
    // DB cascade (asset_face → shared_space_person_face) are deleted.  The onAssetDelete
    // handler in SharedSpaceService receives this data and recounts/cleans up after the delete.
    const affectedSpacePersons = await this.sharedSpaceRepository.getSpacePersonsForAsset(id);

    // The delete cascades into asset_face, which makes Postgres lock shared_space_person rows to
    // null out representativeFaceId. Those locks are taken in face order, so they can cycle against
    // a concurrent space-people recount. Re-drive the victim rather than lose the deletion (#864).
    try {
      await retryOnDeadlock(() => this.assetRepository.remove(asset));
    } catch (error) {
      if (!isDeadlockError(error)) {
        throw error;
      }

      // Still contended after the whole budget. The asset is already soft-deleted, so dropping it
      // here would leave it behind until the trash sweep runs days later. Re-queue instead: the
      // job goes to the back of the queue, by which point the delete storm has usually drained.
      this.logger.warn(`Re-queueing deletion of asset ${id}: still deadlocking after repeated retries`);
      await this.jobRepository.queue({ name: JobName.AssetDelete, data: { id, deleteOnDisk } });
      return JobStatus.Skipped;
    }
    if (!asset.libraryId) {
      await this.userRepository.updateUsage(asset.ownerId, -(asset.exifInfo?.fileSizeInByte || 0));
    }

    await this.eventRepository.emit('AssetDelete', { assetId: id, userId: asset.ownerId, affectedSpacePersons });

    // delete the motion if it is not used by another asset
    if (asset.livePhotoVideoId) {
      const count = await this.assetRepository.getLivePhotoCount(asset.livePhotoVideoId);
      if (count === 0) {
        await this.jobRepository.queue({
          name: JobName.AssetDelete,
          data: { id: asset.livePhotoVideoId, deleteOnDisk },
        });
      }
    }

    const assetFiles = getAssetFiles(asset.files ?? []);
    const files = [
      assetFiles.thumbnailFile?.path,
      assetFiles.previewFile?.path,
      assetFiles.fullsizeFile?.path,
      assetFiles.editedFullsizeFile?.path,
      assetFiles.editedPreviewFile?.path,
      assetFiles.editedThumbnailFile?.path,
      assetFiles.encodedVideoFile?.path,
    ];

    if (deleteOnDisk && !asset.isOffline) {
      files.push(assetFiles.sidecarFile?.path, asset.originalPath);
    }

    await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: files.filter(Boolean) } });

    return JobStatus.Success;
  }

  async deleteAll(auth: AuthDto, dto: AssetBulkDeleteDto): Promise<void> {
    const { ids, force } = dto;

    await this.requireAccess({ auth, permission: Permission.AssetDelete, ids });
    await this.assetRepository.updateAll(ids, {
      deletedAt: new Date(),
      status: force ? AssetStatus.Deleted : AssetStatus.Trashed,
    });
    await this.eventRepository.emit(force ? 'AssetDeleteAll' : 'AssetTrashAll', {
      assetIds: ids,
      userId: auth.user.id,
    });
  }

  async getMetadata(auth: AuthDto, id: string): Promise<AssetMetadataResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [id] });
    return this.assetRepository.getMetadata(id);
  }

  async getOcr(auth: AuthDto, id: string): Promise<AssetOcrResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [id] });
    const ocr = await this.ocrRepository.getByAssetId(id);
    const asset = await this.assetRepository.getForOcr(id);

    if (!asset) {
      throw new BadRequestException('Asset not found');
    }

    const dimensions = getDimensions({
      exifImageHeight: asset.exifImageHeight,
      exifImageWidth: asset.exifImageWidth,
      orientation: asset.orientation,
    });

    return ocr.map((item) => transformOcrBoundingBox(item, asset.edits, dimensions));
  }

  async upsertBulkMetadata(auth: AuthDto, dto: AssetMetadataBulkUpsertDto): Promise<AssetMetadataBulkResponseDto[]> {
    await requireAssetEditAccess(this.accessRepository, { auth, ids: dto.items.map((item) => item.assetId) });

    const uniqueKeys = new Set<string>();
    for (const item of dto.items) {
      const key = `(${item.assetId}, ${item.key})`;
      if (uniqueKeys.has(key)) {
        throw new BadRequestException(`Duplicate items are not allowed: "${key}"`);
      }

      uniqueKeys.add(key);
    }

    return this.assetRepository.upsertBulkMetadata(dto.items);
  }

  async upsertMetadata(auth: AuthDto, id: string, dto: AssetMetadataUpsertDto): Promise<AssetMetadataResponseDto[]> {
    await requireAssetEditAccess(this.accessRepository, { auth, ids: [id] });

    const uniqueKeys = new Set<string>();
    for (const { key } of dto.items) {
      if (uniqueKeys.has(key)) {
        throw new BadRequestException(`Duplicate items are not allowed: "${key}"`);
      }

      uniqueKeys.add(key);
    }

    return this.assetRepository.upsertMetadata(id, dto.items);
  }

  async getMetadataByKey(auth: AuthDto, id: string, key: string): Promise<AssetMetadataResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [id] });

    const item = await this.assetRepository.getMetadataByKey(id, key);
    if (!item) {
      throw new BadRequestException(`Metadata with key "${key}" not found for asset with id "${id}"`);
    }
    return item;
  }

  async deleteMetadataByKey(auth: AuthDto, id: string, key: string): Promise<void> {
    await requireAssetEditAccess(this.accessRepository, { auth, ids: [id] });
    return this.assetRepository.deleteMetadataByKey(id, key);
  }

  async deleteBulkMetadata(auth: AuthDto, dto: AssetMetadataBulkDeleteDto) {
    await requireAssetEditAccess(this.accessRepository, { auth, ids: dto.items.map((item) => item.assetId) });
    await this.assetRepository.deleteBulkMetadata(dto.items);
  }

  async run(auth: AuthDto, dto: AssetJobsDto) {
    await requireAssetEditAccess(this.accessRepository, { auth, ids: dto.assetIds });

    const jobs: JobItem[] = [];

    for (const id of dto.assetIds) {
      switch (dto.name) {
        case AssetJobName.REFRESH_FACES: {
          jobs.push({ name: JobName.AssetDetectFaces, data: { id } });
          break;
        }

        case AssetJobName.REFRESH_METADATA: {
          jobs.push({ name: JobName.AssetExtractMetadata, data: { id } });
          break;
        }

        case AssetJobName.REGENERATE_THUMBNAIL: {
          jobs.push({ name: JobName.AssetGenerateThumbnails, data: { id } });
          break;
        }

        case AssetJobName.TRANSCODE_VIDEO: {
          jobs.push({ name: JobName.AssetEncodeVideo, data: { id } });
          break;
        }
      }
    }

    await this.jobRepository.queueAll(jobs);
  }

  private findOrFail(id: string) {
    return findOrFail(() => this.assetRepository.getById(id), 'Asset');
  }

  private async updateExif(dto: {
    id: string;
    description?: string;
    dateTimeOriginal?: string;
    latitude?: number;
    longitude?: number;
    rating?: number | null;
  }) {
    const { id, description, dateTimeOriginal, latitude, longitude, rating } = dto;

    // When latitude/longitude are updated manually, reverse-geocode them so country/state/city
    // stay in sync. Otherwise the asset shows on the map (which only needs lat/lon) but is
    // missing from location-based filters and search (which scope by country/city).
    let geo: { country: string | null; state: string | null; city: string | null } | undefined;
    if (latitude !== undefined && longitude !== undefined) {
      geo = await this.mapRepository.reverseGeocode({ latitude, longitude });
    }

    const writes = omitBy(
      {
        description,
        dateTimeOriginal,
        timeZone: extractTimeZone(dateTimeOriginal)?.name,
        latitude,
        longitude,
        rating,
        ...geo,
      },
      isUndefined,
    );

    if (Object.keys(writes).length === 0) {
      return false;
    }

    await this.assetRepository.upsertExif({
      exif: updateLockedColumns({
        assetId: id,
        ...writes,
      }),
      lockedPropertiesBehavior: 'append',
    });
    await this.jobRepository.queue({ name: JobName.SidecarWrite, data: { id } });
    return true;
  }

  async getAssetEdits(auth: AuthDto, id: string): Promise<AssetEditsResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [id] });
    const edits = await this.assetEditRepository.getAll(id);

    return {
      assetId: id,
      edits,
    };
  }

  async editAsset(auth: AuthDto, id: string, dto: AssetEditsCreateDto): Promise<AssetEditsResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetEditCreate, ids: [id] });

    const asset = await this.assetRepository.getForEdit(id);
    if (!asset) {
      throw new BadRequestException('Asset not found');
    }

    if (asset.type !== AssetType.Image) {
      throw new BadRequestException('Only images can be edited');
    }

    if (asset.livePhotoVideoId) {
      throw new BadRequestException('Editing live photos is not supported');
    }

    if (isPanorama(asset)) {
      throw new BadRequestException('Editing panorama images is not supported');
    }

    if (asset.originalPath?.toLowerCase().endsWith('.gif')) {
      throw new BadRequestException('Editing GIF images is not supported');
    }

    if (asset.originalPath?.toLowerCase().endsWith('.svg')) {
      throw new BadRequestException('Editing SVG images is not supported');
    }

    // check that crop parameters will not go out of bounds
    const { width: assetWidth, height: assetHeight } = getDimensions(asset);

    if (!assetWidth || !assetHeight) {
      throw new BadRequestException('Asset dimensions are not available for editing');
    }

    const edits = dto.edits as AssetEditActionItem[];
    const crop = edits.find((e) => e.action === AssetEditAction.Crop);
    if (crop) {
      if (edits[0].action !== AssetEditAction.Crop) {
        throw new BadRequestException('Crop action must be the first edit action');
      }

      // check that crop parameters will not go out of bounds
      const { width: assetWidth, height: assetHeight } = getDimensions(asset);

      if (!assetWidth || !assetHeight) {
        throw new BadRequestException('Asset dimensions are not available for editing');
      }

      const { x, y, width, height } = crop.parameters;
      if (x + width > assetWidth || y + height > assetHeight) {
        throw new BadRequestException('Crop parameters are out of bounds');
      }
    }

    const newEdits = await this.assetEditRepository.replaceAll(id, edits);
    await this.jobRepository.queue({ name: JobName.AssetEditThumbnailGeneration, data: { id } });

    // #734: after the write succeeds — a rejected write must log nothing.
    await logCrossOwnerEdit(this.accessRepository, this.sharedSpaceRepository, this.logger, auth, [id]);

    // Return the asset and its applied edits
    return {
      assetId: id,
      edits: newEdits,
    };
  }

  async removeAssetEdits(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.AssetEditDelete, ids: [id] });

    const asset = await this.assetRepository.getById(id);
    if (!asset) {
      throw new BadRequestException('Asset not found');
    }

    await this.assetEditRepository.replaceAll(id, []);
    await this.jobRepository.queue({ name: JobName.AssetEditThumbnailGeneration, data: { id } });

    // #734: after the write succeeds — a rejected write must log nothing.
    await logCrossOwnerEdit(this.accessRepository, this.sharedSpaceRepository, this.logger, auth, [id]);
  }
}
