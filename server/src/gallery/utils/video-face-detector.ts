import { Duration } from 'luxon';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SystemConfig } from 'src/dtos/config.dto.js';
import type { VideoFaceChanges, VideoFaceRepository } from 'src/gallery/repositories/video-face.repository.js';
import type { BackendMediaServer } from 'src/gallery/utils/backend-media-server.js';
import type { AssetRepository } from 'src/repositories/asset.repository.js';
import type { CryptoRepository } from 'src/repositories/crypto.repository.js';
import type { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import type { JobRepository } from 'src/repositories/job.repository.js';
import type { LoggingRepository } from 'src/repositories/logging.repository.js';
import type { BoundingBox, MachineLearningRepository } from 'src/repositories/machine-learning.repository.js';
import type { MediaRepository } from 'src/repositories/media.repository.js';
import type { JobItem } from 'src/types.js';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend.js';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { AssetType, JobName, JobStatus, SourceType, StorageFolder } from 'src/enum.js';
import {
  type Detection,
  type ExistingVideoFace,
  FaceTracker,
  VIDEO_FACE_LOW_SCORE,
  VIDEO_FACE_SAMPLER_VERSION,
  acceptTrack,
  matchExistingFaces,
  mergeDetections,
  parseEmbedding,
  planSampleTimes,
  planTiles,
  sampleIntervalFor,
  serializeEmbedding,
  sightingQuality,
  trackEmbedding,
} from 'src/gallery/utils/video-faces.js';
import { VideoFrameReader } from 'src/gallery/utils/video-frames.js';
import { StorageBackend } from 'src/interfaces/storage-backend.interface.js';

type VideoFaceDetectorDependencies = {
  assetRepository: AssetRepository;
  cryptoRepository: CryptoRepository;
  faceIdentityRepository: FaceIdentityRepository;
  jobRepository: JobRepository;
  machineLearningRepository: MachineLearningRepository;
  mediaRepository: MediaRepository;
  videoFaceRepository: VideoFaceRepository;
  backendMedia: BackendMediaServer;
  logger: LoggingRepository;
  getConfig: (options: { withCache: boolean }) => Promise<SystemConfig>;
  frames?: VideoFrameReader;
};

/** Where a video's best frames live: one folder per video beside its thumbnails, so AssetDelete can find it. */
export const videoFaceFrameFolder = (asset: { id: string; ownerId: string }, backend: StorageBackend) => {
  const folderName = `${asset.id}_faces`;
  return backend instanceof DiskStorageBackend
    ? StorageCore.getNestedPath(StorageFolder.Thumbnails, asset.ownerId, folderName)
    : StorageCore.getRelativeNestedPath(StorageFolder.Thumbnails, asset.ownerId, folderName);
};

/**
 * A video sampled from at least this many frames logs its progress every 10%, as transcoding does: one this long can
 * hold a face detection slot for many minutes, and without it a busy job looks like a stuck one. Shorter videos log
 * only their start and finish, so a library of phone clips does not flood the log.
 */
const PROGRESS_MIN_FRAMES = 100;
const PROGRESS_STEP_PERCENT = 10;

const humanDuration = (ms: number) =>
  Duration.fromMillis(Math.max(1000, Math.round(ms / 1000) * 1000))
    .rescale()
    .toHuman({ unitDisplay: 'narrow' });

const roundBox = ({ x1, y1, x2, y2 }: BoundingBox) => ({
  x1: Math.round(x1),
  y1: Math.round(y1),
  x2: Math.round(x2),
  y2: Math.round(y2),
});

// Plain class built once in BaseService, like BackendMediaServer: face detection for videos across the whole video
// (specs/2026-10-31-video-face-frames-design.md). PersonService.handleDetectFaces hands every asset to `detect` first;
// it returns undefined for anything it does not handle, and upstream's single-frame detection runs as before.
export class VideoFaceDetector {
  private frames: VideoFrameReader;

  constructor(private deps: VideoFaceDetectorDependencies) {
    this.frames = deps.frames ?? new VideoFrameReader();
  }

  /**
   * Face detection's Missing job also queues the videos detected before this sampler was on, or by an older Gallery:
   * a library is rescanned only when an admin asks for it, never just because the setting was turned on. Reset and
   * Refresh already queue every asset.
   */
  async queueMissing(machineLearning: SystemConfig['machineLearning'], force?: boolean): Promise<void> {
    if (force !== false || !machineLearning.facialRecognition.video?.enabled) {
      return;
    }

    let jobs: JobItem[] = [];
    for await (const asset of this.deps.videoFaceRepository.streamUnsampled()) {
      jobs.push({ name: JobName.AssetDetectFaces, data: { id: asset.id } });
      if (!(jobs.length >= JOBS_ASSET_PAGINATION_SIZE)) {
        continue;
      }

      await this.deps.jobRepository.queueAll(jobs);
      jobs = [];
    }
    await this.deps.jobRepository.queueAll(jobs);
  }

  async detect(
    id: string,
    machineLearning: SystemConfig['machineLearning'],
    force?: boolean,
  ): Promise<JobStatus | undefined> {
    const { facialRecognition } = machineLearning;
    const options = facialRecognition.video;
    if (!options?.enabled) {
      return;
    }

    const asset = await this.deps.videoFaceRepository.getForDetect(id);
    if (!asset || asset.type !== AssetType.Video) {
      return;
    }

    const { ffmpeg } = await this.deps.getConfig({ withCache: true });
    await using original = await this.deps.backendMedia.ensureLocalFile(asset.originalPath);
    const { format, videoStreams } = await this.deps.mediaRepository.probe(original.localPath);
    const videoStream = videoStreams[0];
    const start = asset.trimStart ?? 0;
    const end = asset.trimEnd ?? format.duration;
    if (!videoStream || !(end > start)) {
      this.deps.logger.warn(`Video ${id} has no readable video stream, detecting faces on its poster instead`);
      // Stamped all the same, so face detection's Missing job does not retry it on every run.
      await this.deps.videoFaceRepository.markSampled(id);
      return;
    }

    let cuts: number[] = [];
    if (options.sceneDetection) {
      try {
        cuts = await this.frames.findSceneCuts(original.localPath);
      } catch (error) {
        this.deps.logger.warn(`Scene detection failed for video ${id}, sampling at intervals only: ${error}`);
      }
    }
    const sampleInterval = sampleIntervalFor(end - start, options.sampleInterval);
    const times = planSampleTimes({ start, end, interval: sampleInterval, maxFrames: options.maxFrames, cuts });
    const interval = Math.max(sampleInterval, (end - start) / options.maxFrames);
    this.deps.logger.log(
      `Sampling ${times.length} frames across ${humanDuration((end - start) * 1000)} of video ${id} ` +
        `(about every ${Math.round(interval * 10) / 10}s, ${cuts.length} scene cuts` +
        `${options.tiledDetection ? ', tiled' : ''})`,
    );
    // Frames are searched at a lower score than photos; acceptTrack then keeps a person who was either confident once
    // or consistent across frames.
    const detectOptions = {
      ...facialRecognition,
      minScore: Math.min(facialRecognition.minScore, VIDEO_FACE_LOW_SCORE),
    };
    const startedAt = Date.now();

    const tempDir = await mkdtemp(join(tmpdir(), 'gallery-video-faces-'));
    try {
      const tracker = new FaceTracker(facialRecognition.maxDistance);
      const framePaths = new Map<number, string>();
      let frameSize: { width: number; height: number } | undefined;

      const extract = async (index: number) => {
        const path = join(tempDir, `${index}.jpeg`);
        try {
          await this.frames.extractFrame(original.localPath, path, times[index], { ffmpeg, videoStream });
          return path;
        } catch (error) {
          this.deps.logger.debug(`Could not extract frame at ${times[index]}s of video ${id}: ${error}`);
          return;
        }
      };

      let reportedPercent = 0;
      let unreadable = 0;
      const reportProgress = (done: number) => {
        const percent = Math.floor((done / times.length) * 100);
        if (times.length < PROGRESS_MIN_FRAMES || done === 0 || percent < reportedPercent + PROGRESS_STEP_PERCENT) {
          return;
        }
        reportedPercent = percent - (percent % PROGRESS_STEP_PERCENT);
        const elapsed = Date.now() - startedAt;
        const remaining = humanDuration((elapsed / done) * (times.length - done));
        this.deps.logger.log(
          `Video faces ${reportedPercent}% done (${done} of ${times.length} frames, ` +
            `${tracker.peopleSoFar()} faces tracked so far), estimated ${remaining} remaining for video ${id}`,
        );
      };

      // The next frame is extracted while the ML service works on this one.
      let next = times.length > 0 ? extract(0) : undefined;
      for (const [index, t] of times.entries()) {
        reportProgress(index);
        const path = await next;
        next = index + 1 < times.length ? extract(index + 1) : undefined;
        if (!path) {
          unreadable++;
          continue;
        }

        frameSize ??= await this.frames.getDimensions(path);
        const faces = await this.detectInFrame(path, frameSize, detectOptions, !!options.tiledDetection);
        const detections: Detection[] = [];
        for (const { boundingBox, embedding, score } of faces) {
          const sharpness = await this.frames.measureSharpness(path, boundingBox, frameSize);
          detections.push({
            box: boundingBox,
            score,
            embedding: parseEmbedding(embedding),
            quality: sightingQuality({ score, box: boundingBox, sharpness }),
          });
        }
        tracker.addFrame(t, index, detections);
        framePaths.set(index, path);

        // Only the frames someone is best seen in are kept, so the folder never holds the whole video.
        const keep = tracker.bestFrameIndexes();
        for (const [frameIndex, framePath] of framePaths) {
          if (keep.has(frameIndex)) {
            continue;
          }

          framePaths.delete(frameIndex);
          await unlink(framePath).catch(() => {});
        }
      }
      await next;

      if (!frameSize) {
        this.deps.logger.warn(`No frame of video ${id} could be read, detecting faces on its poster instead`);
        await this.deps.videoFaceRepository.markSampled(id);
        return;
      }

      const candidates = tracker.finish();
      const tracks = candidates.filter((track) => acceptTrack(track, facialRecognition.minScore));
      const { added, kept, removed } = await this.applyTracks(asset, tracks, framePaths, frameSize, {
        maxDistance: facialRecognition.maxDistance,
        start,
        force,
      });
      this.deps.logger.log(
        `Found ${tracks.length} people (of ${candidates.length} candidates) in ${times.length} frames of video ${id} in ` +
          `${humanDuration(Date.now() - startedAt)} (${added} new, ${kept} kept, ${removed} removed` +
          `${unreadable > 0 ? `, ${unreadable} frames unreadable` : ''})`,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    return JobStatus.Success;
  }

  /**
   * The faces in one frame. With tiled detection, a frame larger than the detector's input is also searched as four
   * overlapping quarters, which show small faces at about twice the size, and the finds are merged; the whole frame is
   * still searched too, for faces larger than the overlap between quarters.
   */
  private async detectInFrame(
    path: string,
    frameSize: { width: number; height: number },
    options: SystemConfig['machineLearning']['facialRecognition'],
    tiled: boolean,
  ) {
    const { faces } = await this.deps.machineLearningRepository.detectFaces(path, options);
    const tiles = tiled ? planTiles(frameSize) : [];
    if (tiles.length === 0) {
      return faces;
    }

    const found = [...faces];
    for (const [index, tile] of tiles.entries()) {
      const tilePath = `${path}.tile-${index}.jpeg`;
      try {
        await this.frames.extractTile(path, tilePath, tile);
        const { faces: tileFaces } = await this.deps.machineLearningRepository.detectFaces(tilePath, options);
        for (const face of tileFaces) {
          const { x1, y1, x2, y2 } = face.boundingBox;
          found.push({
            ...face,
            boundingBox: { x1: x1 + tile.left, y1: y1 + tile.top, x2: x2 + tile.left, y2: y2 + tile.top },
          });
        }
      } finally {
        await unlink(tilePath).catch(() => {});
      }
    }
    return mergeDetections(found);
  }

  private async applyTracks(
    asset: NonNullable<Awaited<ReturnType<VideoFaceRepository['getForDetect']>>>,
    tracks: ReturnType<FaceTracker['finish']>,
    framePaths: Map<number, string>,
    frameSize: { width: number; height: number },
    { maxDistance, start, force }: { maxDistance: number; start: number; force?: boolean },
  ) {
    // Pets and manual faces belong to other jobs and to the user; only this job's own kind of face is replaced.
    const replaceable = asset.faces.filter((face) => face.sourceType === SourceType.MachineLearning && !face.isPet);
    const existing: ExistingVideoFace[] = replaceable.map((face) => ({
      id: face.id,
      embedding: face.embedding ? parseEmbedding(face.embedding) : undefined,
      hasFrame: !!face.framePath,
      imageWidth: face.imageWidth,
      imageHeight: face.imageHeight,
      box: { x1: face.boundingBoxX1, y1: face.boundingBoxY1, x2: face.boundingBoxX2, y2: face.boundingBoxY2 },
    }));
    const matches = matchExistingFaces(existing, tracks, { maxDistance, frame: frameSize, start });

    const { StorageService } = await import('../../services/storage.service.js');
    const backend = StorageService.getWriteBackend();
    const folder = videoFaceFrameFolder(asset, backend);

    const changes: VideoFaceChanges = { insert: [], update: [], deleteIds: [], embeddings: [], frames: [] };
    const toRecognize: string[] = [];
    const matchedIds: string[] = [];
    for (const [index, track] of tracks.entries()) {
      const matchedId = matches.get(index);
      const faceId = matchedId ?? this.deps.cryptoRepository.randomUUID();
      const { x1, y1, x2, y2 } = roundBox(track.best.box);
      const box = {
        imageWidth: frameSize.width,
        imageHeight: frameSize.height,
        boundingBoxX1: x1,
        boundingBoxY1: y1,
        boundingBoxX2: x2,
        boundingBoxY2: y2,
      };

      if (matchedId) {
        changes.update.push({ id: faceId, ...box });
        matchedIds.push(faceId);
        if (!replaceable.find((face) => face.id === faceId)?.personGroupId) {
          toRecognize.push(faceId);
        }
      } else {
        changes.insert.push({ id: faceId, assetId: asset.id, ...box });
        toRecognize.push(faceId);
      }

      const path = join(folder, `${faceId}.jpeg`);
      await backend.put(path, await readFile(framePaths.get(track.best.frameIndex)!), { contentType: 'image/jpeg' });
      changes.embeddings.push({ faceId, embedding: serializeEmbedding(trackEmbedding(track)) });
      changes.frames.push({
        faceId,
        path,
        timeSeconds: track.best.t,
        quality: track.best.quality,
        sightings: track.sightings.map((sighting) => ({
          t: sighting.t,
          ...roundBox(sighting.box),
          score: Math.round(sighting.score * 1000) / 1000,
        })),
        version: VIDEO_FACE_SAMPLER_VERSION,
      });
    }

    // An unmatched face nobody named goes, as upstream drops faces below the detection threshold. A named one stays:
    // losing a name the user gave is worse than a duplicate face, which face cleanup can resolve.
    const matched = new Set(matchedIds);
    const removed = replaceable.filter((face) => !matched.has(face.id) && !face.personGroupId);
    changes.deleteIds = removed.map((face) => face.id);

    await this.deps.videoFaceRepository.apply(changes);
    if (changes.deleteIds.length > 0) {
      await this.deps.faceIdentityRepository.unlinkFaces(changes.deleteIds);
    }
    for (const { framePath } of removed) {
      if (!framePath) {
        continue;
      }

      const owner = await this.deps.backendMedia.backendFor(framePath);
      await owner.delete(framePath).catch(() => {});
    }

    const jobs: JobItem[] = [];
    if (toRecognize.length > 0) {
      if (force) {
        jobs.push({ name: JobName.FacialRecognitionQueueAll, data: { force: true } });
      } else {
        jobs.push(
          { name: JobName.FacialRecognitionQueueAll, data: { force: false } },
          ...toRecognize.map((faceId) => ({ name: JobName.FacialRecognition, data: { id: faceId } }) as const),
        );
      }
    }
    if (matchedIds.length > 0) {
      for (const person of await this.deps.videoFaceRepository.getPeopleRepresentedBy(matchedIds)) {
        jobs.push({ name: JobName.PersonGenerateThumbnail, data: person });
      }
    }
    if (jobs.length > 0) {
      await this.deps.jobRepository.queueAll(jobs);
    }

    await this.deps.videoFaceRepository.markSampled(asset.id);
    await this.deps.assetRepository.upsertJobStatus({ assetId: asset.id, facesRecognizedAt: new Date() });

    return { added: changes.insert.length, kept: changes.update.length, removed: changes.deleteIds.length };
  }
}
