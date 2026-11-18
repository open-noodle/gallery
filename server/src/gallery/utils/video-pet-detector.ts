import { Duration } from 'luxon';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SystemConfig } from 'src/dtos/config.dto.js';
import { AssetType, AssetVisibility, JobName, JobStatus } from 'src/enum.js';
import type { GalleryMachineLearningRepository } from 'src/gallery/repositories/gallery-machine-learning.repository.js';
import type { PetFaceRepository, VideoPetChanges } from 'src/gallery/repositories/pet-face.repository.js';
import type { VideoFaceRepository } from 'src/gallery/repositories/video-face.repository.js';
import type { BackendMediaServer } from 'src/gallery/utils/backend-media-server.js';
import { isPetRecognitionEnabled, isRecognizablePetSpecies } from 'src/gallery/utils/misc.js';
import { coverPersonIfMissing, speciesPersonFor } from 'src/gallery/utils/pet-buckets.js';
import { videoFaceFrameFolder } from 'src/gallery/utils/video-face-detector.js';
import {
  parseEmbedding,
  planSampleTimes,
  sampleIntervalFor,
  serializeEmbedding,
  sightingQuality,
  trackEmbedding,
} from 'src/gallery/utils/video-faces.js';
import { VideoFrameReader } from 'src/gallery/utils/video-frames.js';
import {
  PetVideoTracker,
  VIDEO_PET_SAMPLER_VERSION,
  absorbedPets,
  matchExistingPets,
  roundPetBox,
  type ExistingVideoPet,
  type PetDetection,
  type PetTrack,
} from 'src/gallery/utils/video-pets.js';
import type { CryptoRepository } from 'src/repositories/crypto.repository.js';
import type { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import type { JobRepository } from 'src/repositories/job.repository.js';
import type { LoggingRepository } from 'src/repositories/logging.repository.js';
import type { MediaRepository } from 'src/repositories/media.repository.js';
import type { PersonRepository } from 'src/repositories/person.repository.js';
import type { JobItem } from 'src/types.js';

type VideoPetDetectorDependencies = {
  cryptoRepository: CryptoRepository;
  faceIdentityRepository: FaceIdentityRepository;
  galleryMachineLearningRepository: GalleryMachineLearningRepository;
  jobRepository: JobRepository;
  mediaRepository: MediaRepository;
  personRepository: PersonRepository;
  petFaceRepository: PetFaceRepository;
  videoFaceRepository: VideoFaceRepository;
  backendMedia: BackendMediaServer;
  logger: LoggingRepository;
  getConfig: (options: { withCache: boolean }) => Promise<SystemConfig>;
  frames?: VideoFrameReader;
};

type VideoForPets = NonNullable<Awaited<ReturnType<PetFaceRepository['getForVideoPetDetect']>>>;

/** As for video faces: a long video logs its progress every 10%, a short one only its start and finish. */
const PROGRESS_MIN_FRAMES = 100;
const PROGRESS_STEP_PERCENT = 10;

const humanDuration = (ms: number) =>
  Duration.fromMillis(Math.max(1000, Math.round(ms / 1000) * 1000))
    .rescale()
    .toHuman({ unitDisplay: 'narrow' });

/**
Deletes the best-frame files of sampled video pets a purge removed (Reset, a recognition model switch): the cascade
takes their frame rows, not their files. A file that is already gone is fine.
*/
export const deletePetFrameFiles = async (backendMedia: BackendMediaServer, paths: string[]): Promise<void> => {
  for (const path of paths) {
    const backend = await backendMedia.backendFor(path);
    await backend.delete(path).catch(() => {});
  }
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
Pet detection across the whole video (specs/2026-11-16-video-pet-detection-design.md). Plain class built by
PetDetectionService, which hands it every asset first; it returns undefined for anything it does not handle (not a
video, the setting off, a video it cannot read), and the poster detection runs as before. Pets stay the pet job's:
face detection's VideoFaceDetector never touches them, and this never touches people's faces.
*/
export class VideoPetDetector {
  private frames: VideoFrameReader;

  constructor(private deps: VideoPetDetectorDependencies) {
    this.frames = deps.frames ?? new VideoFrameReader();
  }

  /**
  Pet detection's Missing job also queues the videos detected from their poster only, or by an older pet sampler, while
  video pets are on: a library is rescanned only when an admin asks for it. Reset already queues every asset.
  */
  async queueMissing(machineLearning: SystemConfig['machineLearning']): Promise<JobItem[]> {
    if (!machineLearning.petDetection.video?.enabled) {
      return [];
    }

    const jobs: JobItem[] = [];
    for await (const asset of this.deps.petFaceRepository.streamVideosForPetSampling()) {
      jobs.push({ name: JobName.PetDetection, data: { id: asset.id } });
    }
    return jobs;
  }

  async detect(id: string, machineLearning: SystemConfig['machineLearning']): Promise<JobStatus | undefined> {
    const { petDetection } = machineLearning;
    const options = petDetection.video;
    if (!options?.enabled) {
      return;
    }

    const asset = await this.deps.petFaceRepository.getForVideoPetDetect(id);
    if (!asset || asset.type !== AssetType.Video) {
      return;
    }
    if (asset.visibility === AssetVisibility.Hidden) {
      return JobStatus.Skipped;
    }

    const { ffmpeg } = await this.deps.getConfig({ withCache: true });
    await using original = await this.deps.backendMedia.ensureLocalFile(asset.originalPath);
    const { format, videoStreams } = await this.deps.mediaRepository.probe(original.localPath);
    const videoStream = videoStreams[0];
    const start = asset.trimStart ?? 0;
    const end = asset.trimEnd ?? format.duration;
    if (!videoStream || !(end > start)) {
      this.deps.logger.warn(`Video ${id} has no readable video stream, detecting pets on its poster instead`);
      // Stamped all the same, so the Missing job does not retry it on every run.
      await this.deps.petFaceRepository.markVideoPetsSampled(id);
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
      `Sampling ${times.length} frames across ${humanDuration((end - start) * 1000)} of video ${id} for pets ` +
        `(about every ${Math.round(interval * 10) / 10}s, ${cuts.length} scene cuts)`,
    );

    const recognition = isPetRecognitionEnabled(machineLearning)
      ? { modelName: machineLearning.petRecognition.modelName }
      : undefined;
    const startedAt = Date.now();
    const tempDir = await mkdtemp(join(tmpdir(), 'gallery-video-pets-'));
    // The frame being extracted ahead; settled before the folder goes, so ffmpeg never writes into a deleted one.
    let next: Promise<string | undefined> | undefined;
    try {
      const tracker = new PetVideoTracker(options.maxDistance, petDetection.minScore);
      const framePaths = new Map<number, string>();
      let frameSize: { width: number; height: number } | undefined;

      const extract = async (index: number, t: number) => {
        const path = join(tempDir, `${index}.jpeg`);
        try {
          await this.frames.extractFrame(original.localPath, path, t, { ffmpeg, videoStream });
          return path;
        } catch (error) {
          this.deps.logger.debug(`Could not extract frame at ${t}s of video ${id}: ${error}`);
          return;
        }
      };
      const detectionsIn = async (path: string, size: { width: number; height: number }) => {
        const { pets } = await this.deps.galleryMachineLearningRepository.detectPets(path, petDetection, recognition);
        const detections: PetDetection[] = [];
        for (const { boundingBox, score, label, embedding } of pets) {
          const sharpness = await this.frames.measureSharpness(path, boundingBox, size);
          // Only a species pet recognition identifies keeps its embedding, as on photos: the others go to the
          // species person.
          const embeddable = !!recognition && !!embedding && isRecognizablePetSpecies(label);
          detections.push({
            box: boundingBox,
            score,
            label,
            embedding: embeddable ? parseEmbedding(embedding) : undefined,
            quality: sightingQuality({ score, box: boundingBox, sharpness }),
          });
        }
        return detections;
      };

      let reportedPercent = 0;
      let unreadable = 0;
      const reportProgress = (done: number) => {
        const percent = Math.floor((done / times.length) * 100);
        if (times.length < PROGRESS_MIN_FRAMES || done === 0 || percent < reportedPercent + PROGRESS_STEP_PERCENT) {
          return;
        }
        reportedPercent = percent - (percent % PROGRESS_STEP_PERCENT);
        const remaining = humanDuration(((Date.now() - startedAt) / done) * (times.length - done));
        this.deps.logger.log(
          `Video pets ${reportedPercent}% done (${done} of ${times.length} frames, ` +
            `${plural(tracker.petsSoFar(), 'pet')} tracked so far), estimated ${remaining} remaining for video ${id}`,
        );
      };

      // The next frame is extracted while the ML service works on this one.
      next = times.length > 0 ? extract(0, times[0]) : undefined;
      for (const [index, t] of times.entries()) {
        reportProgress(index);
        const path = await next;
        next = index + 1 < times.length ? extract(index + 1, times[index + 1]) : undefined;
        if (!path) {
          unreadable++;
          continue;
        }

        frameSize ??= await this.frames.getDimensions(path);
        tracker.addFrame(t, index, await detectionsIn(path, frameSize));
        framePaths.set(index, path);

        // Only the frames a pet is best seen in are kept, so the folder never holds the whole video.
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
        this.deps.logger.warn(`No frame of video ${id} could be read, detecting pets on its poster instead`);
        await this.deps.petFaceRepository.markVideoPetsSampled(id);
        return;
      }

      // Mid-flight model switch, as on photos (PetDetectionService.handlePetDetection): the switch already purged and
      // requeued detection, so embeddings from the old model must not be written. Recognition turned off counts too.
      if (recognition) {
        const { machineLearning: current } = await this.deps.getConfig({ withCache: true });
        if (!isPetRecognitionEnabled(current) || current.petRecognition.modelName !== recognition.modelName) {
          return JobStatus.Skipped;
        }
      }

      // A clip shorter than the minimum keeps a pet seen in every frame it has, as a photo keeps one seen once.
      const tracks = tracker.finish(Math.min(options.minSightings, times.length - unreadable));
      const { added, updated, removed } = await this.applyTracks(asset, tracks, framePaths, frameSize, {
        maxDistance: options.maxDistance,
        start,
      });
      this.deps.logger.log(
        `Found ${plural(tracks.length, 'pet')} in ${times.length} frames of video ${id} in ` +
          `${humanDuration(Date.now() - startedAt)}: ${added} added, ${updated} updated, ${removed} deleted` +
          (unreadable > 0 ? `, ${plural(unreadable, 'frame')} unreadable` : ''),
      );
    } catch (error) {
      // As on photos (PetDetectionService.handlePetDetection): an ML failure fails this video's job, logged, and leaves
      // it unstamped, so the next Missing run tries it again.
      await next;
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.error(`Pet detection failed for video ${id}: ${message}`);
      return JobStatus.Failed;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    return JobStatus.Success;
  }

  private async applyTracks(
    asset: VideoForPets,
    tracks: PetTrack[],
    framePaths: Map<number, string>,
    frameSize: { width: number; height: number },
    { maxDistance, start }: { maxDistance: number; start: number },
  ) {
    const existing: ExistingVideoPet[] = asset.faces.map((face) => ({
      id: face.id,
      embedding: face.embedding ? parseEmbedding(face.embedding) : undefined,
      hasFrame: !!face.framePath,
      imageWidth: face.imageWidth,
      imageHeight: face.imageHeight,
      box: { x1: face.boundingBoxX1, y1: face.boundingBoxY1, x2: face.boundingBoxX2, y2: face.boundingBoxY2 },
      personGroupId: face.personGroupId,
      species: face.species,
      embedded: !!face.embedded,
    }));
    const matches = matchExistingPets(existing, tracks, { maxDistance, frame: frameSize, start });
    const absorbed = absorbedPets(existing, matches);
    const byId = new Map(existing.map((face) => [face.id, face]));

    const { StorageService } = await import('../../services/storage.service.js');
    const backend = StorageService.getWriteBackend();
    const folder = videoFaceFrameFolder(asset, backend);

    const changes: VideoPetChanges = { insert: [], update: [], deleteIds: [], embeddings: [], frames: [] };
    const toRecognize: { faceId: string; label: string }[] = [];
    const newBucketFaces: { faceId: string; personGroupId: string }[] = [];
    const matchedIds: string[] = [];
    const speciesPeople = new Map<string, string>();
    for (const [index, { label, embeddable, track }] of tracks.entries()) {
      const matchedId = matches.get(index);
      const faceId = matchedId ?? this.deps.cryptoRepository.randomUUID();
      const { x1, y1, x2, y2 } = roundPetBox(track.best.box);
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
        if (embeddable && !byId.get(faceId)?.personGroupId) {
          toRecognize.push({ faceId, label });
        }
      } else if (embeddable) {
        changes.insert.push({ id: faceId, assetId: asset.id, ...box });
        toRecognize.push({ faceId, label });
      } else {
        const personGroupId = await speciesPersonFor(this.deps, asset.ownerId, label, speciesPeople);
        changes.insert.push({ id: faceId, assetId: asset.id, personGroupId, ...box });
        newBucketFaces.push({ faceId, personGroupId });
      }

      if (embeddable) {
        changes.embeddings.push({ faceId, embedding: serializeEmbedding(trackEmbedding(track)), species: label });
      }

      const path = join(folder, `${faceId}.jpeg`);
      await backend.put(path, await readFile(framePaths.get(track.best.frameIndex)!), { contentType: 'image/jpeg' });
      changes.frames.push({
        faceId,
        path,
        timeSeconds: track.best.t,
        quality: track.best.quality,
        sightings: track.sightings.map((sighting) => ({
          t: sighting.t,
          ...roundPetBox(sighting.box),
          score: Math.round(sighting.score * 1000) / 1000,
        })),
        version: VIDEO_PET_SAMPLER_VERSION,
      });
    }

    // An unmatched face without a person goes, as photo detection never keeps one. One with a person stays, as losing a
    // name the user gave is worse than a duplicate face, unless a matched face of the same person took its place.
    const matched = new Set(matchedIds);
    const removed = asset.faces.filter(
      (face) => !matched.has(face.id) && (!face.personGroupId || absorbed.has(face.id)),
    );
    changes.deleteIds = removed.map((face) => face.id);

    await this.deps.petFaceRepository.applyVideoPets(changes);
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

    const jobs: JobItem[] = toRecognize.map(({ faceId, label }) => ({
      name: JobName.PetRecognition,
      data: { id: faceId, deferred: false, label },
    }));
    for (const { faceId, personGroupId } of newBucketFaces) {
      const job = await coverPersonIfMissing(this.deps, personGroupId, faceId);
      if (job) {
        jobs.push(job);
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

    await this.deps.petFaceRepository.markVideoPetsSampled(asset.id);

    return { added: changes.insert.length, updated: changes.update.length, removed: changes.deleteIds.length };
  }
}
