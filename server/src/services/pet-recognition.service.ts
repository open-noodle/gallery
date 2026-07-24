import { Injectable } from '@nestjs/common';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, QueueName, SystemMetadataKey } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';
import { isPetRecognitionEnabled } from 'src/utils/misc';

@Injectable()
export class PetRecognitionService extends BaseService {
  @OnJob({ name: JobName.PetRecognitionQueueAll, queue: QueueName.PetRecognition })
  async handleQueuePetRecognition({ force, nightly }: JobOf<JobName.PetRecognitionQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isPetRecognitionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    if (nightly) {
      const [state, latestPetDate] = await Promise.all([
        this.systemMetadataRepository.get(SystemMetadataKey.PetRecognitionState),
        this.personRepository.getLatestPetDate(),
      ]);

      if (state?.lastRun && latestPetDate && state.lastRun > latestPetDate) {
        this.logger.debug('Skipping pet recognition nightly since no pet has been added since the last run');
        return JobStatus.Skipped;
      }
    }

    if (force) {
      // Purge pet people (and their shared-space copies) plus every stored pet embedding, then
      // requeue detection so assets are re-detected and re-embedded with the *current* model. This
      // is the explicit, order-independent reset for enabling recognition or switching model:
      // deleteAllPets() removes the pet asset_face rows via CASCADE from their people, and the
      // pet_search truncate is a belt-and-braces guarantee independent of that delete order.
      await this.personRepository.deleteAllPets();
      await this.sharedSpaceRepository.deleteAllPets();
      await this.personRepository.deleteAllPetSearch();
      await this.jobRepository.queue({ name: JobName.PetDetectionQueueAll, data: { force: true } });
    } else {
      let jobs: JobItem[] = [];
      for await (const face of this.personRepository.getUnassignedPetFaces()) {
        jobs.push({ name: JobName.PetRecognition, data: { id: face.id, deferred: false } });

        if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
          await this.jobRepository.queueAll(jobs);
          jobs = [];
        }
      }
      await this.jobRepository.queueAll(jobs);
    }

    // Recording the model name (not just lastRun) is what lets a future run detect a model switch
    // and decide to force-reprocess.
    await this.systemMetadataRepository.set(SystemMetadataKey.PetRecognitionState, {
      lastRun: new Date().toISOString(),
      modelName: machineLearning.petRecognition.modelName,
    });

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.PetRecognition, queue: QueueName.PetRecognition })
  async handlePetRecognition({ id, deferred, label }: JobOf<JobName.PetRecognition>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isPetRecognitionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const face = await this.personRepository.getPetFaceForRecognition(id);
    if (!face || !face.asset) {
      this.logger.warn(`Pet face ${id} not found`);
      return JobStatus.Failed;
    }

    if (!face.petSearch?.embedding) {
      this.logger.warn(`Pet face ${id} does not have an embedding`);
      return JobStatus.Skipped;
    }

    if (face.personId) {
      this.logger.debug(`Pet face ${id} already has a person assigned`);
      await this.linkFaceIdentity(face.personId, face.id);
      return JobStatus.Skipped;
    }

    const { maxDistance, minFaces } = machineLearning.petRecognition;
    const embedding = face.petSearch.embedding;
    const ownerId = face.asset.ownerId;

    const matches = await this.searchRepository.searchPets({
      userIds: [ownerId],
      embedding,
      maxDistance,
      numResults: Math.max(minFaces, 1),
    });

    this.logger.debug(`Pet face ${id} has ${matches.length} matches`);

    let personId = matches.find((match) => match.personId)?.personId ?? undefined;
    const isCore = matches.length >= minFaces;

    if (!isCore && !deferred) {
      this.logger.debug(`Deferring non-core pet face ${id} for later processing`);
      await this.jobRepository.queue({
        name: JobName.PetRecognition,
        data: { id, deferred: true, ...(label === undefined ? {} : { label }) },
      });
      return JobStatus.Skipped;
    }

    if (!personId) {
      // The core-window search above can be too narrow to surface an already-labelled match — at
      // the shipped default (minFaces: 1, numResults: 1) the face's own row is always the closest
      // result (distance 0 to itself), so it alone fills the window and a genuinely matching
      // sibling face is never returned. Mirrors handleRecognizeFaces's second, hasPerson-scoped
      // search (person.service.ts), which exists for exactly this reason.
      const matchWithPerson = await this.searchRepository.searchPets({
        userIds: [ownerId],
        embedding,
        maxDistance,
        numResults: 1,
        hasPerson: true,
      });
      personId = matchWithPerson[0]?.personId ?? undefined;
    }

    if (!personId && isCore) {
      this.logger.log(`Creating new pet person for face ${id}`);
      const person = await this.personRepository.create({
        ownerId,
        type: 'pet',
        species: label ?? null,
        name: '',
      });
      personId = person.id;
    }

    if (!personId) {
      this.logger.debug(`Pet face ${id} did not resolve to a person, skipping`);
      return JobStatus.Skipped;
    }

    this.logger.debug(`Assigning pet face ${id} to person ${personId}`);
    await this.personRepository.reassignFaces({ faceIds: [id], newPersonId: personId });
    await this.linkFaceIdentity(personId, id);
    await this.setRepresentativeFaceIfMissing(personId, id);
    await this.queueSharedSpaceFaceMatchesForAsset(face.assetId);

    return JobStatus.Success;
  }

  /**
   * `ensurePersonIdentity` derives `face_identity.type` from `person.type` (see
   * FaceIdentityRepository.ensurePersonIdentity), so calling this on a `type: 'pet'` person
   * stamps the identity `type: 'pet'` — this is what activates the existing shared-space pet
   * propagation path in shared-space.service.ts (`getPetFacesForAsset` + `processSpaceFaceMatch`).
   */
  private async linkFaceIdentity(personId: string, assetFaceId: string): Promise<void> {
    const identity = await this.faceIdentityRepository.ensurePersonIdentity(personId);
    await this.faceIdentityRepository.replaceFaceIdentity({
      assetFaceId,
      identityId: identity.id,
      source: 'owner-person',
    });
  }

  private async setRepresentativeFaceIfMissing(personId: string, faceId: string): Promise<void> {
    const person = await this.personRepository.getById(personId);
    if (person && !person.faceAssetId) {
      await this.personRepository.update({ id: personId, faceAssetId: faceId });
      await this.jobRepository.queue({ name: JobName.PersonGenerateThumbnail, data: { id: personId } });
    }
  }

  private async queueSharedSpaceFaceMatchesForAsset(assetId: string): Promise<void> {
    const spaceIds = await this.sharedSpaceRepository.getSpaceIdsForAsset(assetId);
    const queuedSpaceIds = new Set<string>();
    for (const { spaceId } of spaceIds) {
      if (queuedSpaceIds.has(spaceId)) {
        continue;
      }
      queuedSpaceIds.add(spaceId);
      await this.jobRepository.queue({ name: JobName.SharedSpaceFaceMatch, data: { spaceId, assetId } });
    }
  }
}
