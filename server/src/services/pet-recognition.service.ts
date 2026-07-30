import { Injectable } from '@nestjs/common';
import { SystemConfig } from 'src/config';
import { JOBS_ASSET_PAGINATION_SIZE, PET_RECOGNITION_MODEL_NAMES } from 'src/constants';
import { OnEvent, OnJob } from 'src/decorators';
import { DatabaseLock, ImmichWorker, JobName, JobStatus, QueueName, SystemMetadataKey, VectorIndex } from 'src/enum';
import { ArgOf } from 'src/repositories/event.repository';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';
import { isPetDetectionEnabled, isPetRecognitionEnabled } from 'src/utils/misc';

@Injectable()
export class PetRecognitionService extends BaseService {
  @OnEvent({ name: 'ConfigValidate' })
  onConfigValidate({ newConfig }: ArgOf<'ConfigValidate'>) {
    const modelName = newConfig.machineLearning.petRecognition.modelName;
    if (!(PET_RECOGNITION_MODEL_NAMES as readonly string[]).includes(modelName)) {
      throw new Error(
        `Unknown pet recognition model: ${modelName}. Please check the model name for typos and confirm this is a supported model.`,
      );
    }
  }

  @OnEvent({ name: 'ConfigInit', workers: [ImmichWorker.Microservices] })
  async onConfigInit({ newConfig }: ArgOf<'ConfigInit'>) {
    await this.handleModelSwitch(newConfig);
  }

  @OnEvent({ name: 'ConfigUpdate', workers: [ImmichWorker.Microservices], server: true })
  async onConfigUpdate({ oldConfig, newConfig }: ArgOf<'ConfigUpdate'>) {
    await this.handleModelSwitch(newConfig, oldConfig);
  }

  @OnJob({ name: JobName.PetRecognitionQueueAll, queue: QueueName.PetRecognition })
  async handleQueuePetRecognition({ force, nightly }: JobOf<JobName.PetRecognitionQueueAll>): Promise<JobStatus> {
    const config = await this.getConfig({ withCache: false });
    const { machineLearning } = config;
    if (!isPetRecognitionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    if (force) {
      // F9's force half: drain any PetRecognition jobs queued before the reset — they'd otherwise
      // run against faces the purge below is about to delete, and the requeued detection force run
      // rebuilds everything from scratch anyway.
      await this.jobRepository.empty(QueueName.PetRecognition, true);
      // Purge pet people (and their shared-space copies) plus every stored pet embedding, then
      // requeue detection so assets are re-detected and re-embedded with the *current* model. This
      // is the explicit, order-independent reset for enabling recognition or switching model:
      // deleteAllPets() removes the pet asset_face rows via CASCADE from their people, and the
      // pet_search truncate is a belt-and-braces guarantee independent of that delete order.
      // Deliberately a FULL purge (buckets included, rebuilt by the requeue) — broader than a
      // model switch's scoped purge, because the admin Reset button promises exactly that.
      await this.personRepository.deleteAllPets();
      await this.sharedSpaceRepository.deleteAllPets();
      await this.personRepository.deleteAllPetSearch();
      await this.jobRepository.queue({ name: JobName.PetDetectionQueueAll, data: { force: true } });
    } else {
      const state = await this.systemMetadataRepository.get(SystemMetadataKey.PetRecognitionState);

      // Drift check: the model recorded at the last run differs from the configured one, meaning
      // the switch happened outside the ConfigInit/ConfigUpdate hook (an offline config-file edit,
      // or an event this worker missed) and never got its scoped purge. Placed BEFORE the nightly
      // date-skip below — an idle library (no new pets since state.lastRun) would otherwise mask
      // the drift forever.
      if (state?.modelName && state.modelName !== machineLearning.petRecognition.modelName) {
        this.logger.warn(
          `Pet recognition model changed from ${state.modelName} to ${machineLearning.petRecognition.modelName} outside the config-update hook — reprocessing`,
        );
        await this.handleModelSwitch(config);
        return JobStatus.Success;
      }

      if (nightly) {
        // getLatestPetDate returns a Date directly (F11) — compared against a parsed Date rather
        // than pg-text vs. an ISO-`T` string, which mis-ordered same-day timestamps.
        const latestPetDate = await this.personRepository.getLatestPetDate();
        if (state?.lastRun && latestPetDate && new Date(state.lastRun) > latestPetDate) {
          this.logger.debug('Skipping pet recognition nightly since no pet has been added since the last run');
          return JobStatus.Skipped;
        }
      }

      // Parity with handleQueueRecognizeFaces (person.service.ts): skip when the PetRecognition
      // queue already has pending work, so overlapping queue-all invocations (a manual Start
      // racing the scheduled nightly, or two nightly firings racing a slow run) don't duplicate
      // the fan-out. Placed after the drift check and nightly date-skip above — it must never gate
      // the drift check (F9's non-force half).
      const { active, delayed, paused, waiting } = await this.jobRepository.getJobCounts(QueueName.PetRecognition);
      const hasOtherActivePetRecognitionWork = active > 1;
      const hasPendingPetRecognitionWork = waiting > 0 || delayed > 0 || paused > 0 || hasOtherActivePetRecognitionWork;

      if (hasPendingPetRecognitionWork) {
        this.logger.debug(
          `Skipping pet recognition queueing because recognition work is already pending ` +
            `(${active} active, ${waiting} waiting, ${delayed} delayed, ${paused} paused)`,
        );
        return JobStatus.Skipped;
      }

      await this.databaseRepository.prewarm(VectorIndex.Pet);

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

      // Still queue space face matching because this face may belong to a space
      // that was created or linked after the face was originally recognized.
      await this.queueSharedSpaceFaceMatchesForAsset(face.assetId);

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
        data: { id, deferred: true, ...(label !== undefined && { label }) },
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
        // The job label is only present on the detection fan-out; the queue-all and nightly paths
        // have none, so fall back to the species persisted on the embedding at detect time (F8).
        species: label ?? face.petSearch.species ?? null,
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
   * The model-switch hook shared by {@link onConfigInit} and {@link onConfigUpdate}. `oldConfig` is
   * only available from ConfigUpdate — ConfigInit fires at bootstrap with no prior config.
   *
   * Runs entirely under `DatabaseLock.PetRecognitionModelSwitch`: `withLock` only serializes
   * concurrent callers, it does not dedupe, so the FIRST thing done under the lock is a re-read of
   * the stored state to check idempotency — two ConfigUpdate deliveries (e.g. multiple
   * non-API workers reacting to the same save) both carry the same stale `oldConfig`, and without
   * this re-read they would each purge + requeue, double-detecting every asset (both pet writers
   * are additive).
   */
  private async handleModelSwitch(newConfig: SystemConfig, oldConfig?: SystemConfig): Promise<void> {
    await this.databaseRepository.withLock(DatabaseLock.PetRecognitionModelSwitch, async () => {
      const state = await this.systemMetadataRepository.get(SystemMetadataKey.PetRecognitionState);
      const newModel = newConfig.machineLearning.petRecognition.modelName;
      const recognitionEnabled = isPetRecognitionEnabled(newConfig.machineLearning);
      const detectionEnabled = isPetDetectionEnabled(newConfig.machineLearning);
      const detectionTurnedOn = !!oldConfig && !isPetDetectionEnabled(oldConfig.machineLearning) && detectionEnabled;

      if (state?.modelName === newModel) {
        // Deferred reprocess: the switch already happened while detection was off, and detection
        // has just been turned back on.
        if (detectionTurnedOn && state.pendingReprocess) {
          await this.systemMetadataRepository.set(SystemMetadataKey.PetRecognitionState, {
            ...state,
            pendingReprocess: false,
          });
          await this.jobRepository.queue({ name: JobName.PetDetectionQueueAll, data: { force: true } });
        }
        return;
      }

      const referenceModel = oldConfig?.machineLearning.petRecognition.modelName ?? state?.modelName;
      if (!referenceModel) {
        // Fresh install / ConfigInit before any state exists. Adopt the current model as the
        // reference so a later offline switch is detectable — otherwise the enable→first-nightly
        // window is blind to a switch.
        if (recognitionEnabled) {
          await this.systemMetadataRepository.set(SystemMetadataKey.PetRecognitionState, {
            ...state,
            modelName: newModel,
          });
        }
        return;
      }
      if (referenceModel === newModel) {
        return;
      }

      // Scoped purge (species buckets survive — see PersonRepository.purgePetRecognitionArtifacts).
      // Empty both pet queues first: pending old-model detection jobs would re-embed with mixed
      // state and duplicate faces against the requeued force run below.
      await this.jobRepository.empty(QueueName.PetRecognition, true);
      await this.jobRepository.empty(QueueName.PetDetection, true);
      // empty() drains waiting/delayed jobs; it does NOT kill an ACTIVE one. An in-flight
      // recognition job can still create a person after this purge — it ends up face-less, and
      // generic person cleanup collects it (see R2.6).
      await this.personRepository.purgePetRecognitionArtifacts();

      // Stamp state BEFORE any requeue — this is what makes the idempotency re-read above sound.
      const pendingReprocess = recognitionEnabled && !detectionEnabled;
      await this.systemMetadataRepository.set(SystemMetadataKey.PetRecognitionState, {
        lastRun: new Date().toISOString(),
        modelName: newModel,
        ...(pendingReprocess && { pendingReprocess: true }),
      });

      if (recognitionEnabled && detectionEnabled) {
        await this.jobRepository.queue({ name: JobName.PetDetectionQueueAll, data: { force: true } });
      } else if (recognitionEnabled) {
        this.logger.warn(
          `Pet recognition model changed to ${newModel} but pet detection is disabled. Run a FORCE pet detection once detection is re-enabled — a non-force run skips assets already stamped with petsDetectedAt and would rebuild nothing.`,
        );
      }
      // Recognition off: no requeue and no pendingReprocess flag — the buckets survived the scoped
      // purge, and re-enabling recognition later follows the documented manual-reset flow.
    });
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
