import { Injectable } from '@nestjs/common';
import { Insertable } from 'kysely';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { OnJob } from 'src/decorators';
import { AssetVisibility, JobName, JobStatus, QueueName } from 'src/enum';
import { DetectedPet } from 'src/repositories/machine-learning.repository';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';
import { isPetDetectionEnabled, isPetRecognitionEnabled, isRecognizablePetSpecies } from 'src/utils/misc';

@Injectable()
export class PetDetectionService extends BaseService {
  @OnJob({ name: JobName.PetDetectionQueueAll, queue: QueueName.PetDetection })
  async handleQueuePetDetection({ force }: JobOf<JobName.PetDetectionQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });

    if (force) {
      // A reset must clear existing pet people/faces so stale labels disappear immediately,
      // rather than lingering throughout the reprocessing window (and duplicating on re-detect).
      //
      // This runs *before* the enabled check on purpose (#718): users turn pet detection off
      // precisely so detected pets stop coming back, then hit Reset to wipe the ones already
      // there. The confirmation dialog promises that deletion, so the purge must happen even
      // when detection is disabled — only the reprocessing requeue below is gated on it.
      await this.personRepository.deleteAllPets();
      // Pets also propagate into shared spaces as their own person rows, so clear those copies
      // too — otherwise the pets linger in every space's People view after a reset.
      await this.sharedSpaceRepository.deleteAllPets();
    }

    if (!isPetDetectionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    let jobs: JobItem[] = [];
    const assets = this.assetJobRepository.streamForPetDetectionJob(force);

    for await (const asset of assets) {
      jobs.push({ name: JobName.PetDetection, data: { id: asset.id } });

      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.PetDetection, queue: QueueName.PetDetection })
  async handlePetDetection({ id }: JobOf<JobName.PetDetection>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isPetDetectionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const asset = await this.assetJobRepository.getForPetDetection(id);
    if (!asset || !asset.previewFile) {
      return JobStatus.Failed;
    }

    if (asset.visibility === AssetVisibility.Hidden) {
      return JobStatus.Skipped;
    }

    try {
      const recognitionEnabled = isPetRecognitionEnabled(machineLearning);
      const { pets, imageHeight, imageWidth } = await this.machineLearningRepository.detectPets(
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
        const bucketed = pets.filter((pet) => !isRecognizablePetSpecies(pet.label));
        await this.writeDetectedPetsForRecognition({
          assetId: id,
          imageHeight,
          imageWidth,
          pets: pets.filter((pet) => isRecognizablePetSpecies(pet.label)),
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

      await this.assetRepository.upsertJobStatus({ assetId: id, petsDetectedAt: new Date() });

      this.logger.debug(`Detected ${pets.length} pet(s) for ${id}`);
      return JobStatus.Success;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Pet detection failed for asset ${id}: ${message}`);
      return JobStatus.Failed;
    }
  }

  /**
   * Species-bucket pipeline: put each detected pet under a per-(owner, species) person, exactly as
   * before individual pet recognition existed. This must stay byte-for-byte identical to the
   * pre-recognition pipeline — upgrading users with recognition off see no change (Slice 5 test 5.1
   * is the regression guard for that).
   *
   * Receives every detected pet when recognition is disabled, and only the species the re-ID model
   * cannot identify (everything outside RECOGNIZABLE_PET_SPECIES) when it is enabled.
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
      let personId = speciesCache.get(pet.label);

      if (!personId) {
        const existing = await this.personRepository.getByOwnerAndSpecies(ownerId, pet.label);
        if (existing) {
          personId = existing.id;
        } else {
          const person = await this.personRepository.create({
            ownerId,
            name: pet.label,
            type: 'pet',
            species: pet.label,
          });
          personId = person.id;
        }
        speciesCache.set(pet.label, personId);
      }

      const faceId = await this.personRepository.createAssetFace({
        assetId,
        personId,
        imageHeight,
        imageWidth,
        boundingBoxX1: pet.boundingBox.x1,
        boundingBoxY1: pet.boundingBox.y1,
        boundingBoxX2: pet.boundingBox.x2,
        boundingBoxY2: pet.boundingBox.y2,
      });

      const person = await this.personRepository.getById(personId);
      if (person && !person.faceAssetId) {
        await this.personRepository.update({ id: personId, faceAssetId: faceId });
        thumbnailJobs.push({ name: JobName.PersonGenerateThumbnail, data: { id: personId } });
      }
    }

    await this.jobRepository.queueAll(thumbnailJobs);
  }

  /**
   * Individual-pet pipeline (pet recognition enabled): write faces + embeddings, and queue one
   * PetRecognition job per detected pet that has an embedding. No species-bucket person is
   * created here — clustering into individuals happens in
   * PetRecognitionService.handlePetRecognition (Slice 5 Part B).
   *
   * Only receives species in RECOGNIZABLE_PET_SPECIES; the caller routes the rest to
   * writeDetectedPetsAsSpeciesBuckets. The ML service still embeds every detected pet in the same
   * request, so the discarded embeddings are wasted work — cheap next to detection, and not worth
   * teaching the ML pipeline a species allow-list to avoid.
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
    pets: DetectedPet[];
  }): Promise<void> {
    // Positional pairing: PersonRepository.refreshPetFaces pairs embeddingsToAdd[i] with
    // facesToAdd[i], and a shorter embeddingsToAdd only drops TRAILING entries (see its
    // docstring). Pets missing an embedding (defensive path — older ML service) are ordered last
    // so the pairing stays correct for the pets that do have one.
    const withEmbedding = pets.filter((pet): pet is DetectedPet & { embedding: string } => !!pet.embedding);
    const withoutEmbedding = pets.filter((pet) => !pet.embedding);
    const orderedPets = [...withEmbedding, ...withoutEmbedding];

    const facesToAdd: (Insertable<AssetFaceTable> & { assetId: string })[] = orderedPets.map((pet) => ({
      assetId,
      imageHeight,
      imageWidth,
      boundingBoxX1: pet.boundingBox.x1,
      boundingBoxY1: pet.boundingBox.y1,
      boundingBoxX2: pet.boundingBox.x2,
      boundingBoxY2: pet.boundingBox.y2,
    }));
    const embeddingsToAdd = withEmbedding.map((pet) => pet.embedding);

    const faceIds =
      orderedPets.length > 0 ? await this.personRepository.refreshPetFaces(facesToAdd, embeddingsToAdd) : [];

    const jobs: JobItem[] = withEmbedding.map((pet, index) => ({
      name: JobName.PetRecognition,
      data: { id: faceIds[index], deferred: false, label: pet.label },
    }));

    for (let index = withEmbedding.length; index < orderedPets.length; index++) {
      this.logger.warn(`Pet face ${faceIds[index]} for asset ${assetId} has no embedding; skipping recognition`);
    }

    await this.jobRepository.queueAll(jobs);
  }
}
