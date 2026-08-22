import { Injectable } from '@nestjs/common';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { OnJob } from 'src/decorators';
import { AssetVisibility, JobName, JobStatus, QueueName } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';
import { isPetDetectionEnabled } from 'src/utils/misc';

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
      const { pets, imageHeight, imageWidth } = await this.machineLearningRepository.detectPets(
        asset.previewFile,
        machineLearning.petDetection,
      );

      const thumbnailJobs: JobItem[] = [];
      const speciesCache = new Map<string, string>();

      for (const pet of pets) {
        let personId = speciesCache.get(pet.label);

        if (!personId) {
          const existing = await this.personRepository.getByOwnerAndSpecies(asset.ownerId, pet.label);
          if (existing) {
            personId = existing.personGroupId;
          } else {
            const person = await this.personRepository.createWithGroup({
              ownerId: asset.ownerId,
              name: pet.label,
              type: 'pet',
              species: pet.label,
            });
            personId = person.personGroupId;
          }
          speciesCache.set(pet.label, personId);
        }

        const faceId = await this.personRepository.createAssetFace({
          assetId: id,
          personId,
          imageHeight,
          imageWidth,
          boundingBoxX1: pet.boundingBox.x1,
          boundingBoxY1: pet.boundingBox.y1,
          boundingBoxX2: pet.boundingBox.x2,
          boundingBoxY2: pet.boundingBox.y2,
        });

        const person = await this.personRepository.getByGroupIdOnly(personId);
        if (person && !person.faceAssetId) {
          await this.personRepository.update({ ownerId: person.ownerId, personGroupId: personId, faceAssetId: faceId });
          thumbnailJobs.push({
            name: JobName.PersonGenerateThumbnail,
            data: { ownerId: person.ownerId, personGroupId: personId },
          });
        }
      }

      await this.jobRepository.queueAll(thumbnailJobs);
      await this.assetRepository.upsertJobStatus({ assetId: id, petsDetectedAt: new Date() });

      this.logger.debug(`Detected ${pets.length} pet(s) for ${id}`);
      return JobStatus.Success;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Pet detection failed for asset ${id}: ${message}`);
      return JobStatus.Failed;
    }
  }
}
