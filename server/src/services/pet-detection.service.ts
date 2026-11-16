import { Injectable } from '@nestjs/common';
import { Insertable } from 'kysely';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants.js';
import { OnEvent, OnJob } from 'src/decorators.js';
import { AssetVisibility, JobName, JobStatus, QueueName } from 'src/enum.js';
import { coverPersonIfMissing, speciesPersonFor } from 'src/gallery/utils/pet-buckets.js';
import { VideoPetDetector, deletePetFrameFiles } from 'src/gallery/utils/video-pet-detector.js';
import type { ArgOf } from 'src/repositories/event.repository.js';
import { DetectedPet } from 'src/repositories/machine-learning.repository.js';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table.js';
import { BaseService } from 'src/services/base.service.js';
import { JobItem, type JobOf } from 'src/types.js';
import { isPetDetectionEnabled, isPetRecognitionEnabled, isRecognizablePetSpecies } from 'src/utils/misc.js';

@Injectable()
export class PetDetectionService extends BaseService {
  // Built on first use, after BaseService has set the repositories (specs/2026-11-16-video-pet-detection-design.md).
  private videoPetDetector?: VideoPetDetector;

  private get petBuckets() {
    return { petFaceRepository: this.petFaceRepository, personRepository: this.personRepository };
  }

  private get videoPets(): VideoPetDetector {
    this.videoPetDetector ??= new VideoPetDetector({
      cryptoRepository: this.cryptoRepository,
      faceIdentityRepository: this.faceIdentityRepository,
      galleryMachineLearningRepository: this.galleryMachineLearningRepository,
      jobRepository: this.jobRepository,
      mediaRepository: this.mediaRepository,
      personRepository: this.personRepository,
      petFaceRepository: this.petFaceRepository,
      videoFaceRepository: this.videoFaceRepository,
      backendMedia: this.backendMedia,
      logger: this.logger,
      getConfig: (options) => this.getConfig(options),
    });
    return this.videoPetDetector;
  }

  // Chained off JobSuccess (not JobService.onDone) so upstream's follow-up list stays untouched.
  // Mirrors onDone's gate: only a Success/Skipped thumbnail run for an upload or a notify request.
  @OnEvent({ name: 'JobSuccess' })
  async onJobSuccess({ job, response }: ArgOf<'JobSuccess'>) {
    if (response !== JobStatus.Success && response !== JobStatus.Skipped) {
      return;
    }
    if (job.name !== JobName.AssetGenerateThumbnails || (!job.data.notify && job.data.source !== 'upload')) {
      return;
    }
    await this.jobRepository.queue({ name: JobName.PetDetection, data: job.data });
  }

  @OnJob({ name: JobName.PetDetectionQueueAll, queue: QueueName.PetDetection })
  async handleQueuePetDetection({ force }: JobOf<JobName.PetDetectionQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });

    if (force) {
      // Read before the purge: the cascade removes the frame rows of sampled video pets, not their files.
      const framePaths = await this.petFaceRepository.getPetFramePaths({ embeddedOnly: false });
      // A reset must clear existing pet people/faces so stale labels disappear immediately,
      // rather than lingering throughout the reprocessing window (and duplicating on re-detect).
      //
      // This runs *before* the enabled check on purpose (#718): users turn pet detection off
      // precisely so detected pets stop coming back, then hit Reset to wipe the ones already
      // there. The confirmation dialog promises that deletion, so the purge must happen even
      // when detection is disabled — only the reprocessing requeue below is gated on it.
      await this.petFaceRepository.deleteAllPets();
      // Pets also propagate into shared spaces as their own person rows, so clear those copies
      // too — otherwise the pets linger in every space's People view after a reset.
      await this.sharedSpaceRepository.deleteAllPets();
      await deletePetFrameFiles(this.backendMedia, framePaths);
    }

    if (!isPetDetectionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    let jobs: JobItem[] = [];
    const assets = this.petFaceRepository.streamForPetDetectionJob(force);

    for await (const asset of assets) {
      jobs.push({ name: JobName.PetDetection, data: { id: asset.id } });

      if (!(jobs.length >= JOBS_ASSET_PAGINATION_SIZE)) {
        continue;
      }

      await this.jobRepository.queueAll(jobs);
      jobs = [];
    }

    await this.jobRepository.queueAll(jobs);

    // Videos detected from their poster only, while video pets are on; Reset (force) has queued every asset already.
    if (!force) {
      const videoJobs = await this.videoPets.queueMissing(machineLearning);
      for (let index = 0; index < videoJobs.length; index += JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(videoJobs.slice(index, index + JOBS_ASSET_PAGINATION_SIZE));
      }
    }
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.PetDetection, queue: QueueName.PetDetection })
  async handlePetDetection({ id }: JobOf<JobName.PetDetection>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isPetDetectionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const asset = await this.petFaceRepository.getForPetDetection(id);
    // onJobSuccess queues without re-reading the asset, so one hard-deleted since is skipped, not failed.
    if (!asset) {
      return JobStatus.Skipped;
    }
    // A video is sampled across its whole length when video pets are on; undefined means it was not, and its poster is
    // detected as before.
    const videoStatus = await this.videoPets.detect(id, machineLearning);
    if (videoStatus !== undefined) {
      return videoStatus;
    }

    if (!asset.previewFile) {
      return JobStatus.Failed;
    }

    if (asset.visibility === AssetVisibility.Hidden) {
      return JobStatus.Skipped;
    }

    try {
      const recognitionEnabled = isPetRecognitionEnabled(machineLearning);
      const { pets, imageHeight, imageWidth } = await this.galleryMachineLearningRepository.detectPets(
        asset.previewFile,
        machineLearning.petDetection,
        recognitionEnabled ? { modelName: machineLearning.petRecognition.modelName } : undefined,
      );

      // Only dog/cat go to individual recognition — see RECOGNIZABLE_PET_SPECIES. Everything else
      // the COCO detector emits (bird, horse, elephant, ...) keeps the species-bucket behaviour,
      // so a misfired detection costs one shared bucket rather than a named-able identity per hit.
      // Both writers are additive (refreshPetFaces only inserts), so running both on one asset is
      // safe and order-independent.
      if (recognitionEnabled) {
        // Mid-flight model-switch guard (mirrors SmartInfoService.handleEncodeClip,
        // smart-info.service.ts:132-136): the ML call above may have taken long enough for a
        // ConfigUpdate to land and switch the model. That hook (PetRecognitionService.
        // handleModelSwitch) already purges stale embeddings and requeues detection under the new
        // model, so this in-flight request — still carrying embeddings computed under the OLD
        // model — must be dropped rather than writing mixed-model data. The config cache is
        // invalidated on every worker on ConfigUpdate, so this re-fetch observes the new value.
        //
        // Recognition being switched OFF mid-call is caught by the same guard: nothing purges on a
        // recognition-off toggle, so writing these embeddings would leave individual-pipeline rows
        // behind for a library that is now bucket-only. Skipping before the petsDetectedAt stamp
        // leaves the asset unprocessed, so the next detection run redoes it under the new setting.
        const newConfig = await this.getConfig({ withCache: true });
        if (
          !isPetRecognitionEnabled(newConfig.machineLearning) ||
          newConfig.machineLearning.petRecognition.modelName !== machineLearning.petRecognition.modelName
        ) {
          return JobStatus.Skipped;
        }

        // A pet goes to the individual pipeline only if it is BOTH a recognizable species AND
        // carries an embedding. Everything else buckets: an unassigned face with no pet_search row
        // would match neither arm of petFacePredicate, so the human pipeline could not see it as a
        // pet and would destroy it — the bucket keeps it recorded and protected.
        const embeddable = pets.filter(
          (pet): pet is DetectedPet & { embedding: string } => isRecognizablePetSpecies(pet.label) && !!pet.embedding,
        );
        const bucketed = pets.filter((pet) => !isRecognizablePetSpecies(pet.label) || !pet.embedding);
        await this.writeDetectedPetsForRecognition({
          assetId: id,
          imageHeight,
          imageWidth,
          pets: embeddable,
        });
        if (bucketed.length > 0) {
          await this.writeDetectedPetsAsSpeciesBuckets({
            assetId: id,
            ownerId: asset.ownerId,
            imageHeight,
            imageWidth,
            pets: bucketed,
          });
        }
      } else {
        await this.writeDetectedPetsAsSpeciesBuckets({
          assetId: id,
          ownerId: asset.ownerId,
          imageHeight,
          imageWidth,
          pets,
        });
      }

      await this.petFaceRepository.setPetsDetectedAt(id);

      this.logger.debug(`Detected ${pets.length} pet(s) for ${id}`);
      return JobStatus.Success;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Pet detection failed for asset ${id}: ${message}`);
      return JobStatus.Failed;
    }
  }

  /**
  Species-bucket pipeline: put each detected pet under a per-(owner, species) person, exactly as
  before individual pet recognition existed. This must stay byte-for-byte identical to the
  pre-recognition pipeline — upgrading users with recognition off see no change (Slice 5 test 5.1
  is the regression guard for that).
  
  Receives every detected pet when recognition is disabled, and only the species the re-ID model
  cannot identify (everything outside RECOGNIZABLE_PET_SPECIES) when it is enabled.
  */
  private async writeDetectedPetsAsSpeciesBuckets({
    assetId,
    ownerId,
    imageHeight,
    imageWidth,
    pets,
  }: {
    assetId: string;
    ownerId: string;
    imageHeight: number;
    imageWidth: number;
    pets: DetectedPet[];
  }): Promise<void> {
    const thumbnailJobs: JobItem[] = [];
    const speciesCache = new Map<string, string>();

    for (const pet of pets) {
      const personId = await speciesPersonFor(this.petBuckets, ownerId, pet.label, speciesCache);

      const faceId = await this.personRepository.createAssetFace({
        assetId,
        personGroupId: personId,
        imageHeight,
        imageWidth,
        boundingBoxX1: pet.boundingBox.x1,
        boundingBoxY1: pet.boundingBox.y1,
        boundingBoxX2: pet.boundingBox.x2,
        boundingBoxY2: pet.boundingBox.y2,
      });

      const thumbnailJob = await coverPersonIfMissing(this.petBuckets, personId, faceId);
      if (thumbnailJob) {
        thumbnailJobs.push(thumbnailJob);
      }
    }

    await this.jobRepository.queueAll(thumbnailJobs);
  }

  /**
  Individual-pet pipeline (pet recognition enabled): write faces + embeddings, and queue one
  PetRecognition job per detected pet that has an embedding. No species-bucket person is
  created here — clustering into individuals happens in
  PetRecognitionService.handlePetRecognition (Slice 5 Part B).
  
  Only receives recognizable species that actually carry an embedding; the caller routes
  everything else to writeDetectedPetsAsSpeciesBuckets. The ML service still embeds every
  detected pet in the same request, so the discarded embeddings are wasted work — cheap next to
  detection, and not worth teaching the ML pipeline a species allow-list to avoid.
  */
  private async writeDetectedPetsForRecognition({
    assetId,
    imageHeight,
    imageWidth,
    pets,
  }: {
    assetId: string;
    imageHeight: number;
    imageWidth: number;
    pets: (DetectedPet & { embedding: string })[];
  }): Promise<void> {
    // Ids are generated here, not by the database, so each embedding names the face it belongs to
    // explicitly. The old code paired embeddingsToAdd[i] with the i-th INSERT … RETURNING row,
    // which is only correct while postgres returns rows in insert order (F7).
    const entries = pets.map((pet) => ({ pet, faceId: this.cryptoRepository.randomUUID() }));

    const facesToAdd: (Insertable<AssetFaceTable> & { id: string; assetId: string })[] = entries.map(
      ({ pet, faceId }) => ({
        id: faceId,
        assetId,
        imageHeight,
        imageWidth,
        boundingBoxX1: pet.boundingBox.x1,
        boundingBoxY1: pet.boundingBox.y1,
        boundingBoxX2: pet.boundingBox.x2,
        boundingBoxY2: pet.boundingBox.y2,
      }),
    );
    // species rides along with the embedding so the queue-all and nightly recognition paths, whose
    // job data has no label, can still stamp the species on a newly created pet person (F8).
    const embeddingsToAdd = entries.map(({ pet, faceId }) => ({
      faceId,
      embedding: pet.embedding,
      species: pet.label,
    }));

    if (entries.length > 0) {
      await this.petFaceRepository.refreshPetFaces(facesToAdd, embeddingsToAdd);
    }

    const jobs: JobItem[] = entries.map(({ pet, faceId }) => ({
      name: JobName.PetRecognition,
      data: { id: faceId, deferred: false, label: pet.label },
    }));

    await this.jobRepository.queueAll(jobs);
  }
}
