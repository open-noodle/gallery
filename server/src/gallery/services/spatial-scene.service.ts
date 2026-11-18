import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants.js';
import { OnEvent, OnJob } from 'src/decorators.js';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import {
  AssetType,
  AssetVisibility,
  CacheControl,
  ImmichWorker,
  JobName,
  JobStatus,
  Permission,
  QueueName,
} from 'src/enum.js';
import type { SpatialSceneChoicesResponseDto, SpatialSceneOfferDto } from 'src/gallery/dtos/spatial-scene.dto.js';
import { requireAssetEditAccess } from 'src/gallery/utils/access-grants.js';
import { depthMapPath, isSpatialSceneEnabled } from 'src/gallery/utils/spatial-scene.js';
import type { ArgOf } from 'src/repositories/event.repository.js';
import { BaseService } from 'src/services/base.service.js';
import { StorageService } from 'src/services/storage.service.js';
import type { JobItem, JobOf } from 'src/types.js';
import { isPanorama } from 'src/utils/asset.util.js';
import type { ImmichMediaResponse } from 'src/utils/file.js';

/** Spatial Scene: a depth map per photo, computed after upload (specs/2026-10-29-spatial-scene-design.md). */
@Injectable()
export class SpatialSceneService extends BaseService {
  // Chained off JobSuccess, as PetDetectionService is, so upstream's follow-up list in JobService.onDone stays
  // untouched. An upload queues the first map; an edit queues a new one, because a crop or rotation changes the
  // geometry the map must line up with.
  @OnEvent({ name: 'JobSuccess' })
  async onJobSuccess({ job, response }: ArgOf<'JobSuccess'>) {
    if (response !== JobStatus.Success && response !== JobStatus.Skipped) {
      return;
    }
    const uploaded = job.name === JobName.AssetGenerateThumbnails && (job.data.notify || job.data.source === 'upload');
    if (!uploaded && job.name !== JobName.AssetEditThumbnailGeneration) {
      return;
    }
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (isSpatialSceneEnabled(machineLearning)) {
      await this.jobRepository.queue({ name: JobName.SpatialScene, data: { id: job.data.id } });
    }
  }

  // A new model makes every stored map stale. Turning the feature on does not backfill on its own, as with pet
  // detection: the admin runs the job for missing photos.
  @OnEvent({ name: 'ConfigUpdate', workers: [ImmichWorker.Microservices], server: true })
  async onConfigUpdate({ oldConfig, newConfig }: ArgOf<'ConfigUpdate'>) {
    const before = oldConfig.machineLearning.spatialScene;
    const after = newConfig.machineLearning.spatialScene;
    if (!isSpatialSceneEnabled(newConfig.machineLearning) || before.modelName === after.modelName) {
      return;
    }

    this.logger.log(`Spatial Scene model changed from ${before.modelName} to ${after.modelName}, reprocessing`);
    await this.jobRepository.queue({ name: JobName.SpatialSceneQueueAll, data: { force: true } });
  }

  // The cascade has already removed the row, so the file is found by its deterministic path. Checked first, since
  // the disk backend warns on a missing file and most photos of most libraries have no depth map.
  @OnEvent({ name: 'AssetDelete' })
  async onAssetDelete({ assetId, userId }: ArgOf<'AssetDelete'>) {
    const backend = StorageService.getWriteBackend();
    const path = depthMapPath({ id: assetId, ownerId: userId }, backend);
    if (await backend.exists(path)) {
      await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [path] } });
    }
  }

  @OnJob({ name: JobName.SpatialSceneQueueAll, queue: QueueName.SpatialScene })
  async handleQueueSpatialScene({ force }: JobOf<JobName.SpatialSceneQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isSpatialSceneEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    let jobs: JobItem[] = [];
    for await (const asset of this.spatialSceneRepository.streamForQueue(force)) {
      jobs.push({ name: JobName.SpatialScene, data: { id: asset.id } });
      if (!(jobs.length >= JOBS_ASSET_PAGINATION_SIZE)) {
        continue;
      }

      await this.jobRepository.queueAll(jobs);
      jobs = [];
    }
    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.SpatialScene, queue: QueueName.SpatialScene })
  async handleSpatialScene({ id }: JobOf<JobName.SpatialScene>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isSpatialSceneEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    // Queued without re-reading the asset, so one deleted since is skipped, not failed.
    const asset = await this.spatialSceneRepository.getForJob(id);
    if (!asset || !isProcessable(asset)) {
      return JobStatus.Skipped;
    }
    if (!asset.previewPath) {
      return JobStatus.Failed;
    }

    const { modelName } = machineLearning.spatialScene;
    try {
      const depth = await this.galleryMachineLearningRepository.estimateDepth(asset.previewPath, { modelName });

      // The ML call can outlast a model switch, whose ConfigUpdate has already queued a forced run under the new
      // model: a map from the old one must not be stored over it.
      const current = await this.getConfig({ withCache: true });
      if (
        !isSpatialSceneEnabled(current.machineLearning) ||
        current.machineLearning.spatialScene.modelName !== modelName
      ) {
        return JobStatus.Skipped;
      }

      const backend = StorageService.getWriteBackend();
      const path = depthMapPath(asset, backend);
      await backend.put(path, Buffer.from(depth.depth, 'base64'), { contentType: 'image/png' });
      await this.spatialSceneRepository.upsert({
        assetId: asset.id,
        path,
        width: depth.width,
        height: depth.height,
        boundarySharpness: depth.boundarySharpness,
        edgeDensity: depth.edgeDensity,
        foregroundRatio: depth.foregroundRatio,
        focus: depth.focus,
        modelName,
      });
      return JobStatus.Success;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Spatial Scene failed for asset ${id}: ${message}`);
      return JobStatus.Failed;
    }
  }

  // The two per-photo actions in the viewer (specs/2026-10-29-spatial-scene-design.md, "Per-photo actions"). Both
  // need the edit access of the viewer's other job actions (Refresh faces and the like): the owner, or an Owner or
  // Editor of a space the photo is in. The choice changes the photo for everyone who can see it.

  /** Queues a new depth map for one photo, as an upload or an edit does. */
  async refreshDepthMap(auth: AuthDto, id: string): Promise<void> {
    await this.requireActionable(auth, id);
    await this.jobRepository.queue({ name: JobName.SpatialScene, data: { id } });
  }

  /** Offers Spatial Scene on one photo or stops offering it; a photo without a depth map gets one queued. */
  async setOffer(auth: AuthDto, id: string, { offered }: SpatialSceneOfferDto): Promise<void> {
    await this.requireActionable(auth, id);
    await this.spatialSceneRepository.setOffer(id, offered);
    if (offered && !(await this.spatialSceneRepository.get(id))) {
      await this.jobRepository.queue({ name: JobName.SpatialScene, data: { id } });
    }
  }

  // The admin's view of the choices (specs/2026-10-29-spatial-scene-design.md, "Per-photo actions"). Admin-only by the
  // route guard, and allowed while Spatial Scene is off: clearing them is housekeeping, not a use of the feature.

  async getChoices(): Promise<SpatialSceneChoicesResponseDto> {
    return { count: await this.spatialSceneRepository.countOffers() };
  }

  async clearChoices(auth: AuthDto): Promise<SpatialSceneChoicesResponseDto> {
    const count = await this.spatialSceneRepository.deleteOffers();
    this.logger.log(`User ${auth.user.id} cleared ${count} Spatial Scene per-photo choices`);
    return { count };
  }

  private async requireActionable(auth: AuthDto, id: string) {
    await requireAssetEditAccess(this.accessRepository, { auth, ids: [id] });
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isSpatialSceneEnabled(machineLearning)) {
      throw new BadRequestException('Spatial Scene is disabled');
    }
    const asset = await this.spatialSceneRepository.getForJob(id);
    if (!asset || !isProcessable(asset)) {
      throw new BadRequestException('Spatial Scene is not available for this asset');
    }
  }

  /** The depth map, readable by anyone who can view the photo, shared links included. */
  async getDepthMap(auth: AuthDto, id: string): Promise<ImmichMediaResponse> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [id] });
    const scene = await this.spatialSceneRepository.get(id);
    if (!scene) {
      throw new NotFoundException('Asset has no depth map');
    }
    return this.backendMedia.serveFromBackend(scene.path, 'image/png', CacheControl.PrivateWithCache);
  }
}

/** What the depth job processes: photos, not hidden, not panoramas. */
const isProcessable = (asset: {
  type: AssetType;
  visibility: AssetVisibility;
  projectionType: string | null;
  originalPath: string;
}) =>
  asset.type === AssetType.Image &&
  asset.visibility !== AssetVisibility.Hidden &&
  !isPanorama({ projectionType: asset.projectionType, originalFileName: asset.originalPath });
