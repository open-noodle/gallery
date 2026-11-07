import { Injectable, NotFoundException } from '@nestjs/common';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend.js';
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
  TranscodeHardwareAcceleration,
  TranscodePolicy,
  TranscodeTarget,
} from 'src/enum.js';
import {
  dataSaverSettings,
  dataSaverVideoDiskPath,
  dataSaverVideoPath,
  isDataSaverCopyNeeded,
} from 'src/gallery/utils/data-saver-video.js';
import type { ArgOf } from 'src/repositories/event.repository.js';
import { BaseService } from 'src/services/base.service.js';
import { StorageService } from 'src/services/storage.service.js';
import type { JobItem, JobOf, VideoInterfaces } from 'src/types.js';
import type { ImmichMediaResponse } from 'src/utils/file.js';
import { BaseConfig } from 'src/utils/media.js';
import { mimeTypes } from 'src/utils/mime-types.js';

/** Data Saver video: a small extra copy per video for the mobile app on mobile data (specs/2026-11-01-data-saver-video-design.md). */
@Injectable()
export class DataSaverVideoService extends BaseService {
  videoInterfaces: VideoInterfaces = { dri: [], mali: false };

  // Also backfills on start. A config file never fires ConfigUpdate (the server reads it at boot and refuses saves),
  // so turning the feature on there, or changing its settings, would otherwise only reach new uploads. The queue-all
  // selects only missing or stale copies, so a restart with everything current encodes nothing.
  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Microservices] })
  async onBootstrap() {
    this.videoInterfaces = await this.storageCore.getVideoInterfaces();

    const { ffmpeg } = await this.getConfig({ withCache: false });
    if (ffmpeg.dataSaver.enabled) {
      await this.jobRepository.queue({ name: JobName.AssetEncodeDataSaverVideoQueueAll, data: { force: false } });
    }
  }

  // Chained off JobSuccess, as Spatial Scene is, so upstream's follow-up list in JobService.onDone stays untouched.
  // A skipped encode still gets a copy: an original in an accepted codec gets no encode, and a 4K HEVC original is
  // the file a phone should least stream over LTE. An edit (a trim, or undoing one) changes the source, so it forces a
  // new copy. The queue-all chain lets the Video Conversion panel buttons backfill copies too.
  @OnEvent({ name: 'JobSuccess' })
  async onJobSuccess({ job, response }: ArgOf<'JobSuccess'>) {
    if (response !== JobStatus.Success && response !== JobStatus.Skipped) {
      return;
    }

    let next: JobItem;
    switch (job.name) {
      case JobName.AssetEncodeVideo: {
        next = { name: JobName.AssetEncodeDataSaverVideo, data: { id: job.data.id } };
        break;
      }
      case JobName.AssetEditThumbnailGeneration: {
        next = { name: JobName.AssetEncodeDataSaverVideo, data: { id: job.data.id, force: true } };
        break;
      }
      case JobName.AssetEncodeVideoQueueAll: {
        next = { name: JobName.AssetEncodeDataSaverVideoQueueAll, data: { force: job.data.force } };
        break;
      }
      default: {
        return;
      }
    }

    const { ffmpeg } = await this.getConfig({ withCache: true });
    if (ffmpeg.dataSaver.enabled) {
      await this.jobRepository.queue(next);
    }
  }

  // Turning the feature on, or changing what a copy is made with, backfills. The queue-all selects only videos with
  // no copy or one made with other settings, so saving the page unchanged encodes nothing.
  @OnEvent({ name: 'ConfigUpdate', workers: [ImmichWorker.Microservices], server: true })
  async onConfigUpdate({ oldConfig, newConfig }: ArgOf<'ConfigUpdate'>) {
    const before = oldConfig.ffmpeg.dataSaver;
    const after = newConfig.ffmpeg.dataSaver;
    if (!after.enabled || (before.enabled && dataSaverSettings(before) === dataSaverSettings(after))) {
      return;
    }

    await this.jobRepository.queue({ name: JobName.AssetEncodeDataSaverVideoQueueAll, data: { force: false } });
  }

  // The cascade has already removed the row, so the file is found by its deterministic path. Checked first, since the
  // disk backend warns on a missing file and most videos are small enough to need no copy.
  @OnEvent({ name: 'AssetDelete' })
  async onAssetDelete({ assetId, userId }: ArgOf<'AssetDelete'>) {
    const backend = StorageService.getWriteBackend();
    const path = dataSaverVideoPath({ id: assetId, ownerId: userId }, backend);
    if (await backend.exists(path)) {
      await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [path] } });
    }
  }

  @OnJob({ name: JobName.AssetEncodeDataSaverVideoQueueAll, queue: QueueName.VideoConversion })
  async handleQueueDataSaverVideo({ force }: JobOf<JobName.AssetEncodeDataSaverVideoQueueAll>): Promise<JobStatus> {
    const { ffmpeg } = await this.getConfig({ withCache: false });
    if (!ffmpeg.dataSaver.enabled) {
      return JobStatus.Skipped;
    }

    let jobs: JobItem[] = [];
    for await (const asset of this.dataSaverVideoRepository.streamForQueue(
      dataSaverSettings(ffmpeg.dataSaver),
      force,
    )) {
      jobs.push({ name: JobName.AssetEncodeDataSaverVideo, data: { id: asset.id, force } });
      if (jobs.length < JOBS_ASSET_PAGINATION_SIZE) {
        continue;
      }

      await this.jobRepository.queueAll(jobs);
      jobs = [];
    }
    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetEncodeDataSaverVideo, queue: QueueName.VideoConversion })
  async handleDataSaverVideo({ id, force }: JobOf<JobName.AssetEncodeDataSaverVideo>): Promise<JobStatus> {
    const { ffmpeg } = await this.getConfig({ withCache: true });
    if (!ffmpeg.dataSaver.enabled) {
      return JobStatus.Skipped;
    }

    // Queued without re-reading the asset, so one deleted since is skipped, not failed. A live photo's motion part is
    // hidden and never viewed on its own.
    const asset = await this.dataSaverVideoRepository.getForJob(id);
    if (!asset || asset.type !== AssetType.Video || asset.visibility === AssetVisibility.Hidden) {
      return JobStatus.Skipped;
    }

    const settings = dataSaverSettings(ffmpeg.dataSaver);
    if (!force && asset.settings === settings) {
      return JobStatus.Skipped;
    }

    const video = await this.assetJobRepository.getForVideoConversion(id);
    if (!video?.videoStream?.width || !video.videoStream.height) {
      this.logger.warn(`Skipped the Data Saver copy of asset ${id}: missing metadata; re-run extraction first`);
      return JobStatus.Failed;
    }

    const backend = StorageService.getWriteBackend();
    const fromEdited = !!asset.editedVideoPath;
    if (!isDataSaverCopyNeeded(ffmpeg.dataSaver, video.videoStream, video.format)) {
      await this.dataSaverVideoRepository.upsert({ assetId: id, path: null, settings, fromEdited });
      await this.deleteStale(asset.path, null);
      return JobStatus.Success;
    }

    // The copy follows a trim: it is made from the trimmed file when there is one, as /video/playback serves it.
    await using source = await this.backendMedia.ensureLocalFile(asset.editedVideoPath ?? video.originalPath);
    const finalPath = dataSaverVideoPath(asset, backend);
    // ffmpeg writes to the disk path either way; on S3 the file is uploaded under the relative key afterwards
    const localPath = dataSaverVideoDiskPath(asset);
    this.storageCore.ensureFolders(localPath);

    const config = {
      ...ffmpeg,
      targetVideoCodec: ffmpeg.dataSaver.targetVideoCodec,
      targetResolution: ffmpeg.dataSaver.targetResolution,
      maxBitrate: ffmpeg.dataSaver.maxBitrate,
      transcode: TranscodePolicy.All,
      twoPass: false,
    };
    const audioStream = video.audioStream ?? undefined;
    try {
      await this.transcode(source.localPath, localPath, config, video.videoStream, audioStream);
    } catch (error: any) {
      this.logger.error(`Data Saver copy of asset ${id} failed: ${error?.message ?? error}`);
      return JobStatus.Failed;
    }

    if (!(backend instanceof DiskStorageBackend)) {
      await backend.put(finalPath, this.storageRepository.createPlainReadStream(localPath), {
        contentType: 'video/mp4',
      });
      await this.storageRepository.unlink(localPath).catch(() => {
        /* ignore */
      });
    }

    await this.dataSaverVideoRepository.upsert({ assetId: id, path: finalPath, settings, fromEdited });
    await this.deleteStale(asset.path, finalPath);
    this.logger.log(`Made the Data Saver copy of asset ${id}`);
    return JobStatus.Success;
  }

  /**
  The Data Saver copy, readable by anyone who can view the video, shared links included. Without one it serves what
  /video/playback would, so the app can always ask here first; that response is revalidated rather than cached, so
  the copy is picked up once it lands.
  */
  async playbackDataSaverVideo(auth: AuthDto, id: string, range?: string): Promise<ImmichMediaResponse> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [id] });

    const asset = await this.assetRepository.getForVideo(id);
    if (!asset) {
      throw new NotFoundException('Asset not found or asset is not a video');
    }

    const copy = await this.dataSaverVideoRepository.get(id);
    const path = copy?.path ?? asset.encodedVideoPath ?? asset.originalPath;
    const cacheControl = copy?.path ? CacheControl.PrivateWithCache : CacheControl.PrivateWithoutCache;
    return this.backendMedia.serveFromBackend(
      path,
      mimeTypes.lookup(path) || 'video/mp4',
      cacheControl,
      undefined,
      'inline',
      {
        range,
        acceptsRanges: true,
      },
    );
  }

  // The same fallback order as MediaService.handleVideoConversion: hardware decoding off first, then software.
  private async transcode(
    input: string,
    output: string,
    config: Parameters<typeof BaseConfig.create>[0],
    videoStream: Parameters<BaseConfig['getCommand']>[1],
    audioStream: Parameters<BaseConfig['getCommand']>[2],
  ) {
    const run = (ffmpeg: typeof config) =>
      this.mediaRepository.transcode(
        input,
        output,
        BaseConfig.create(ffmpeg, this.videoInterfaces).getCommand(TranscodeTarget.All, videoStream, audioStream),
      );

    try {
      await run(config);
      return;
    } catch (error) {
      if (config.accel === TranscodeHardwareAcceleration.Disabled) {
        throw error;
      }
    }

    if (config.accelDecode) {
      try {
        await run({ ...config, accelDecode: false });
        return;
      } catch {
        // fall through to software encoding
      }
    }
    await run({ ...config, accel: TranscodeHardwareAcceleration.Disabled });
  }

  private async deleteStale(previous: string | null | undefined, current: string | null) {
    if (previous && previous !== current) {
      await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [previous] } });
    }
  }
}
