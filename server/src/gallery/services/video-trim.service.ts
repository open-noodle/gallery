import { Injectable } from '@nestjs/common';
import AsyncLock from 'async-lock';
import { randomUUID } from 'node:crypto';
import type { JobOf } from 'src/types.js';
import { OnJob } from 'src/decorators.js';
import { SystemConfig } from 'src/dtos/config.dto.js';
import { AssetFileType, JobName, JobStatus, QueueName } from 'src/enum.js';
import { getEditedEncodedVideoPath, getRelativeEditedEncodedVideoPath } from 'src/gallery/utils/storage-keys.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { MediaService } from 'src/services/media.service.js';

type ThumbnailAsset = NonNullable<Awaited<ReturnType<AssetJobRepository['getForGenerateThumbnailJob']>>>;

/**
 * The video trim job: writes the trimmed encode (`{id}_edited.mp4`) and the edited poster and thumbnails for a video
 * with a row in `asset_video_trim`, or removes them once the trim is gone. GalleryAssetService queues it on every trim
 * write; MediaService hands it the videos the edit-thumbnail job gets. It extends MediaService for its protected
 * thumbnail and file-sync steps; only its own handler is registered (the job and event discovery read a service's
 * own prototype).
 */
@Injectable()
export class VideoTrimService extends MediaService {
  // Serializes video trims per asset id. Rapid re-trims otherwise race: the second
  // job overwrites `{id}_edited.mp4` while the first may still be probing/reading it,
  // and both share the trim output as thumbnail input (issue #743 item 2).
  private videoTrimLock = new AsyncLock();

  @OnJob({ name: JobName.AssetVideoTrimGenerate, queue: QueueName.Editor })
  async handleVideoTrimGenerate({ id }: JobOf<JobName.AssetVideoTrimGenerate>): Promise<JobStatus> {
    const asset = await this.assetJobRepository.getForGenerateThumbnailJob(id);
    const config = await this.getConfig({ withCache: true });

    if (!asset) {
      this.logger.warn(`Thumbnail generation failed for asset ${id}: not found in database or missing metadata`);
      return JobStatus.Failed;
    }

    const trim = await this.videoTrimRepository.get(asset.id);
    if (!trim) {
      return this.removeTrimmedFiles(asset);
    }

    // For S3 assets, download the original to a local temp file for processing
    await using original = await this.backendMedia.ensureLocalFile(asset.originalPath);
    const { localPath } = original;

    return await this.videoTrimLock.acquire(asset.id, () => this.trimVideo(asset, config, trim, localPath));
  }

  // Trim undo: clean up edited files and regenerate thumbnails from the original
  private async removeTrimmedFiles(asset: ThumbnailAsset): Promise<JobStatus> {
    await this.syncFiles(
      asset.files.filter((file) => file.isEdited),
      [],
    );

    // asset.files never contains EncodedVideo rows (getForGenerateThumbnailJob only loads
    // thumbnail/preview/fullsize), so syncFiles cannot see the trimmed video. Without this,
    // getForVideo (isEdited DESC) would keep serving the trimmed video after an undo.
    const editedVideo = await this.galleryAssetRepository.getEditedEncodedVideo(asset.id);
    if (editedVideo) {
      await this.assetRepository.deleteFiles([editedVideo]);
      await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [editedVideo.path] } });
    }

    await this.jobRepository.queue({ name: JobName.AssetGenerateThumbnails, data: { id: asset.id } });
    return JobStatus.Success;
  }

  private async trimVideo(
    asset: ThumbnailAsset,
    config: SystemConfig,
    params: { startTime: number; endTime: number },
    localPath: string,
  ): Promise<JobStatus> {
    const duration = params.endTime - params.startTime;

    // ffmpeg always reads the original. The asset's encoded video is not a candidate:
    // getForGenerateThumbnailJob never loads EncodedVideo rows (asset-job.repository.ts),
    // and on S3 its path would be a relative key ffmpeg cannot open anyway.
    const inputPath = localPath;

    // Output path for edited encoded video in EncodedVideo directory
    const outputPath = getEditedEncodedVideoPath(asset);
    this.storageCore.ensureFolders(outputPath);

    // Trim to a unique temp path and atomically rename into place — ffmpeg writing
    // the final path in place would let a concurrent reader (probe / frame extraction
    // in another worker process) open a partial file (issue #743 item 2).
    const trimTempPath = `${outputPath}.tmp-${randomUUID()}.mp4`;
    try {
      await this.videoTrimRepository.trim(inputPath, trimTempPath, params.startTime, duration);
      await this.storageRepository.rename(trimTempPath, outputPath);
    } catch (error) {
      this.logger.error(`FFmpeg trim failed for asset ${asset.id}: ${error}`);
      await this.storageRepository.unlink(trimTempPath).catch(() => {});
      return JobStatus.Failed;
    }

    // outputPath is now a locally-written trimmed video. Every step below can throw; on failure
    // the catch removes it (and the extracted frame) so an S3-mode error doesn't leak temps on
    // the pod's local disk — persistFile is what hands ownership of outputPath to the write backend.
    //
    // The frame path is unique per invocation: the in-process trim lock does not cover other
    // worker processes, and a fixed name would let one job's cleanup unlink the frame another
    // job is still reading (issue #743 item 2).
    const framePath = `${outputPath}.frame-${randomUUID()}.jpg`;
    try {
      // Re-probe for the actual trimmed duration. It is committed to the DB only after the
      // trimmed video is durably persisted (below), so a mid-op failure can't leave the trim's
      // duration pointing at a video that was never stored.
      const probeResult = await this.mediaRepository.probe(outputPath);
      const probedDuration = probeResult.format.duration;
      let newDuration: number;
      if (probedDuration && probedDuration > 0) {
        newDuration = Math.round(probedDuration * 1000);
        this.logger.debug(`Trim: updating duration from probe: ${newDuration} (${probedDuration}s)`);
      } else {
        // Probe didn't return duration — use calculated duration from trim parameters
        newDuration = Math.round((params.endTime - params.startTime) * 1000);
        this.logger.debug(`Trim: probe duration unavailable, using calculated: ${newDuration}`);
      }

      // Extract a frame at ~10% into the trimmed video for thumbnail generation
      const frameTime = duration * 0.1;
      await this.videoTrimRepository.extractFrame(outputPath, framePath, frameTime);

      // Generate thumbnail/preview/fullsize from extracted frame
      const thumbnailResult = await this.generateImageThumbnails(
        { ...asset, originalPath: framePath },
        config,
        true,
        framePath,
      );

      // Clean up temp frame
      await this.storageRepository.unlink(framePath).catch(() => {});

      // Persist output files to S3 if needed
      await this.backendMedia.persistImageFiles(asset, thumbnailResult.files);

      // persistFile unlinks the local file after uploading, so this must come AFTER
      // probe() and extractFrame() have read outputPath.
      const editedVideoPath = await this.backendMedia.persistFile(
        outputPath,
        getRelativeEditedEncodedVideoPath(asset),
        'video/mp4',
      );

      // Sync both edited encoded video and edited thumbnail files
      const editedVideoFile = {
        assetId: asset.id,
        type: AssetFileType.EncodedVideo,
        path: editedVideoPath,
        isEdited: true,
        isProgressive: false,
        isTransparent: false,
      };
      const newFiles = [editedVideoFile, ...thumbnailResult.files];

      await this.syncFiles(
        asset.files.filter((file) => file.isEdited),
        newFiles,
      );

      // Commit the new duration only now that the trimmed video + files are persisted.
      await this.videoTrimRepository.setDuration(asset.id, newDuration);

      if (
        thumbnailResult.thumbhash &&
        (!asset.thumbhash || Buffer.compare(asset.thumbhash, thumbnailResult.thumbhash) !== 0)
      ) {
        await this.assetRepository.update({ id: asset.id, thumbhash: thumbnailResult.thumbhash });
      }

      return JobStatus.Success;
    } catch (error) {
      // A post-trim step failed. Remove the local trimmed video + extracted frame so an S3-mode
      // failure doesn't leak temps on local disk (persistFile may already have removed outputPath
      // on the S3 happy path — unlink is best-effort). Rethrow so the job fails and BullMQ retries.
      this.logger.error(`Trim post-processing failed for asset ${asset.id}: ${error}`);
      await this.storageRepository.unlink(outputPath).catch(() => {});
      await this.storageRepository.unlink(framePath).catch(() => {});
      throw error;
    }
  }
}
