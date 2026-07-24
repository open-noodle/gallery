import { Injectable } from '@nestjs/common';
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { JobOf } from 'src/types';
import { isPetRecognitionEnabled } from 'src/utils/misc';

@Injectable()
export class PetRecognitionService extends BaseService {
  @OnJob({ name: JobName.PetRecognitionQueueAll, queue: QueueName.PetRecognition })
  async handleQueuePetRecognition(_data: JobOf<JobName.PetRecognitionQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isPetRecognitionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    // Reprocess-on-force (purge + requeue detection), the nightly skip-if-fresh check, and the
    // fan-out over embedded/unassigned pet faces are implemented in Slice 6 (reprocess, model
    // switch, nightly).
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
