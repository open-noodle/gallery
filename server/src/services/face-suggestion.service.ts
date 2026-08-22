import { BadRequestException, Injectable } from '@nestjs/common';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { OnJob } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import { PersonFaceSuggestionPageQueryDto, PersonFaceSuggestionPageResponseDto } from 'src/dtos/person.dto';
import { JobName, JobStatus, Permission, QueueName } from 'src/enum';
import { PersonId } from 'src/repositories/person.repository';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';
import { asDateTimeString } from 'src/utils/date';
import { isFaceSuggestionEnabled } from 'src/utils/misc';
import { spaceVisibleAssetVisibilities } from 'src/utils/shared-space-album-scope';

const PERSON_SUGGESTION_EMBEDDING_SAMPLE = 20;
const PERSON_SUGGESTION_NUM_RESULTS = 100;

/**
 * Slice 13 (fork isolation): the fork's face-suggestion engine, extracted out of `person.service.ts`
 * — the same isolation `face-repair.service.ts`, `classification.service.ts` and
 * `shared-space.service.ts` already get. This code never interleaves with upstream `PersonService`
 * logic, so keeping it here means an upstream rebase touching `person.service.ts` never conflicts
 * with it. Mechanical move only: every route path, DTO and job name is unchanged, and the OpenAPI
 * output is byte-identical to before the move (verified by the zero-diff gate in the slice 13 commit).
 *
 * `person.service.ts` keeps only the genuine in-place hooks this engine needs from upstream code
 * paths it cannot own outright: verdict clearing in `reassignFaces`/`reassignFacesById`, the re-scan
 * queue in `update()`, the backfill-completion queue in `handleFaceIdentityBackfill`, and the
 * bootstrap sweep (`queueInitialFaceSuggestionSweep`, `onConfigValidate`, `onConfigUpdate`).
 */
@Injectable()
export class FaceSuggestionService extends BaseService {
  private async findOrFail(id: string) {
    const person = await this.personRepository.getByGroupIdOnly(id);
    if (!person) {
      throw new BadRequestException('Person not found');
    }
    return person;
  }

  // Duplicated from PersonService.createNewFeaturePhoto (still used there by upstream-adjacent call
  // sites this service does not own) rather than shared, matching the codebase's existing pattern of
  // a private findOrFail per service rather than one shared implementation.
  private async createNewFeaturePhoto(changeFeaturePhoto: PersonId[]) {
    this.logger.debug(
      `Changing feature photos for ${changeFeaturePhoto.length} ${changeFeaturePhoto.length > 1 ? 'people' : 'person'}`,
    );

    const jobs: JobItem[] = [];
    for (const { ownerId, personGroupId } of changeFeaturePhoto) {
      const assetFace = await this.personRepository.getRandomFace(personGroupId);

      if (assetFace) {
        await this.personRepository.update({ ownerId, personGroupId, faceAssetId: assetFace.id });
        jobs.push({ name: JobName.PersonGenerateThumbnail, data: { ownerId, personGroupId } });
      }
    }

    await this.jobRepository.queueAll(jobs);
  }

  async getFaceSuggestions(
    auth: AuthDto,
    id: string,
    dto: PersonFaceSuggestionPageQueryDto,
  ): Promise<PersonFaceSuggestionPageResponseDto> {
    // D6: owner-only. PersonRead also admits shared-space members (see access.ts), which would let a
    // space member read the owner's whole-library pending review queue. PersonUpdate resolves via
    // checkOwnerAccess alone (same idiom as confirm/reject/ignore below), so this stays owner-only.
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [id] });

    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isFaceSuggestionEnabled(machineLearning)) {
      return { total: 0, items: [] };
    }

    const { maxDistance, suggestions } = machineLearning.facialRecognition;
    const { total, items } = await this.facePersonVerdictRepository.getPendingForPerson(id, {
      maxDistance,
      suggestionMaxDistance: suggestions.maxDistance,
      page: dto.page,
      size: dto.size,
    });

    return {
      total,
      items: items.map((item) => ({
        assetFaceId: item.assetFaceId,
        assetId: item.assetId,
        distance: item.distance,
        imageWidth: item.imageWidth,
        imageHeight: item.imageHeight,
        boundingBoxX1: item.boundingBoxX1,
        boundingBoxX2: item.boundingBoxX2,
        boundingBoxY1: item.boundingBoxY1,
        boundingBoxY2: item.boundingBoxY2,
        fileCreatedAt: asDateTimeString(item.fileCreatedAt) ?? undefined,
      })),
    };
  }

  // D14/Slice 9: claim -> reassign -> resolveAssignedFace -> identity-relink is one atomic unit — a crash or
  // failure mid-chain must never leave the face reassigned without its manual identity link (a torn write),
  // the same defect class executeRepair's per-route transaction (A1) already closes for the cleanup engine.
  // Reads (access checks, person/face lookups) happen BEFORE the transaction opens; only the writes are
  // wrapped. This intentionally does NOT delegate to reassignFacesById (the public method, used autocommit
  // by its OTHER callers, e.g. the face-editor reassign endpoint) — confirm gets its own trx-wrapped write
  // chain so that method's signature/behaviour for those callers is untouched.
  //
  // Slice 3 (S3.9): the feature gate runs FIRST, before the access checks, matching the space twin
  // (confirmSpacePersonFaceSuggestion) — a disabled feature is a cheap no-op rather than paying for an
  // access check the result would be discarded anyway. maxDistance/suggestions.maxDistance come from the
  // SAME config read and are threaded into claimPending (F5) so the claim applies the identical eligibility
  // band the read (getFaceSuggestions) already does.
  // S11 (F24): the return value is the acted/no-op signal the controller maps to 200/204 — `true` once the
  // write chain actually ran, `false` for every no-op branch (feature disabled, already resolved). Callers must
  // stop inferring that distinction from a status code (see the controller's HttpCode comment).
  async confirmFaceSuggestion(auth: AuthDto, personId: string, assetFaceId: string): Promise<boolean> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isFaceSuggestionEnabled(machineLearning)) {
      return false;
    }
    const { maxDistance, suggestions } = machineLearning.facialRecognition;

    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personId] });
    await this.requireAccess({ auth, permission: Permission.PersonCreate, ids: [assetFaceId] });

    const person = await this.findOrFail(personId);
    const face = await this.personRepository.getFaceById(assetFaceId, { viewingUserId: auth.user.id });

    // Claim the queue row first so a double-submit resolves exactly once. There is deliberately no
    // 'confirmed' status to write: the durable positive verdict is the face's manual identity link, written
    // below via replaceFaceIdentity(..., 'manual'). That link is what keeps the Face Cleanup scan from
    // re-flagging this face and asking an admin to undo the confirmation. A failure anywhere in the chain
    // rolls the whole transaction back — including the claim — so a retried confirm sees the row still
    // pending (R4: strictly safer than a claimed-but-never-applied row).
    const claimed = await this.databaseRepository.transaction(async (trx) => {
      const claimed = await this.facePersonVerdictRepository.claimPending(
        personId,
        assetFaceId,
        { maxDistance, suggestionMaxDistance: suggestions.maxDistance },
        trx,
      );
      if (claimed === 0) {
        // Idempotent: the row was already resolved (double-submit, or a concurrent scan/auto-assign) while
        // person+face still exist. A CASCADE-deleted person/face never reaches here — the requireAccess
        // checks above already threw 400 (owner-only precedence; edges 9/10 — the client treats that 400 as
        // benign-advance).
        return claimed;
      }

      await this.personRepository.reassignFace(face.id, personId, trx);
      // Drains every OTHER target's still-pending row for this now-assigned face (edge 12).
      await this.facePersonVerdictRepository.resolveAssignedFace(face.id, trx);
      // Inlined (rather than the private replaceFaceIdentity wrapper) so every write here threads the SAME
      // trx explicitly.
      const identity = await this.faceIdentityRepository.ensurePersonIdentity(personId, trx);
      await this.faceIdentityRepository.replaceFaceIdentity(
        { assetFaceId: face.id, identityId: identity.id, source: 'manual' },
        trx,
      );
      // Slice 8 (F15): confirming this suggestion states a fact ("this face IS this person") that
      // contradicts any durable rejected/ignored row for this SAME target. In practice claimPending's own
      // eligibility gate (a few lines up) already refuses the claim whenever such a row exists — it applies
      // the identical personId/identityId match to decide the row is even pending — so this call is
      // defense-in-depth against that gate ever being relaxed independently, not something a fresh confirm
      // can currently observe deleting a row. Scoped to this target only — see clearNegativeForTarget.
      await this.facePersonVerdictRepository.clearNegativeForTarget(
        { personGroupId: personId, identityId: identity.id },
        [face.id],
        trx,
      );
      return claimed;
    });
    if (claimed === 0) {
      return false;
    }

    // Feature-photo refresh is display-only (a job enqueue + a non-identity person column), so it stays
    // OUTSIDE the transaction — mirrors reassignFacesById's own placement of this step.
    if (person.faceAssetId === null) {
      await this.createNewFeaturePhoto([person]);
    }
    if (face.person && face.person.faceAssetId === face.id) {
      await this.createNewFeaturePhoto([face.person]);
    }
    return true;
  }

  // D2: reject/ignore write the target's identity + the acting user, same as a cleanup verdict, so the
  // negative-verdict row answers "not this person" everywhere the identity is checked (not just for this
  // person row) and records who made the call.
  private async verdictOpts(
    auth: AuthDto,
    personId: string,
  ): Promise<{ identityId: string; source: 'suggestion'; actorId: string }> {
    const identity = await this.faceIdentityRepository.ensurePersonIdentity(personId);
    return { identityId: identity.id, source: 'suggestion', actorId: auth.user.id };
  }

  // S11 (F24): returns whether a row was actually written (`markRejected`'s affected-row count) — the
  // acted/no-op signal the controller maps to 200/204.
  async rejectFaceSuggestion(auth: AuthDto, personId: string, assetFaceId: string): Promise<boolean> {
    // Owner-only on BOTH the person and the face — the identical pair confirmFaceSuggestion applies.
    // verdictOpts (below) stamps every row with the target's identity, and face_identity.id is a
    // CROSS-OWNER key (identity-merge-propagation.service.ts assigns one identity to personal people of
    // different owners), and getPendingForPerson's anti-join matches on identityId with no ownership
    // filter. So a row written against a face the caller does not own can suppress another owner's
    // suggestion queue for that same face. The face must be one the caller owns before any row is
    // written. Accepted consequence: rejecting a suggestion whose asset has since been trashed now 400s
    // instead of writing a row nothing can ever read back (every read path filters asset.deletedAt).
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personId] });
    await this.requireAccess({ auth, permission: Permission.PersonCreate, ids: [assetFaceId] });
    const affected = await this.facePersonVerdictRepository.markRejected(
      personId,
      assetFaceId,
      await this.verdictOpts(auth, personId),
    );
    // Face stays unassigned; the Phase-1 conditional upsertPending never resurrects a
    // 'rejected' row, so a later scan will not re-suggest it for this person.
    return affected > 0;
  }

  async ignoreFaceSuggestion(auth: AuthDto, personId: string, assetFaceId: string): Promise<boolean> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personId] });
    await this.requireAccess({ auth, permission: Permission.PersonCreate, ids: [assetFaceId] });
    const affected = await this.facePersonVerdictRepository.markIgnored(
      personId,
      assetFaceId,
      await this.verdictOpts(auth, personId),
    );
    // Face stays unassigned; ignored rows suppress future suggestions without rejecting the match.
    return affected > 0;
  }

  async dismissFaceSuggestion(auth: AuthDto, personId: string, assetFaceId: string): Promise<boolean> {
    return this.rejectFaceSuggestion(auth, personId, assetFaceId);
  }

  @OnJob({ name: JobName.PersonSuggestionScan, queue: QueueName.PeopleBackfill })
  async handlePersonSuggestionScan({ id }: JobOf<JobName.PersonSuggestionScan>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isFaceSuggestionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }
    const { maxDistance, suggestions } = machineLearning.facialRecognition;
    const suggestionMaxDistance = suggestions.maxDistance;

    const person = await this.personRepository.getByGroupIdOnly(id);
    if (!person || person.name === '' || person.isHidden || person.type !== 'person') {
      return JobStatus.Skipped;
    }

    const embeddings = await this.personRepository.getAssignedFaceEmbeddings(id, PERSON_SUGGESTION_EMBEDDING_SAMPLE);
    if (embeddings.length === 0) {
      return JobStatus.Skipped;
    }

    const bestByFace = new Map<string, number>();
    for (const { embedding } of embeddings) {
      const matches = await this.searchRepository.searchFaces({
        userIds: [person.ownerId],
        embedding,
        hasPerson: false,
        maxDistance: suggestionMaxDistance,
        numResults: PERSON_SUGGESTION_NUM_RESULTS,
        visibility: spaceVisibleAssetVisibilities,
      });
      for (const match of matches) {
        if (match.distance <= maxDistance) {
          continue;
        }
        const prev = bestByFace.get(match.id);
        if (prev === undefined || match.distance < prev) {
          bestByFace.set(match.id, match.distance);
        }
      }
    }

    // D3: exclude candidates a human has already settled — a manually-linked face (owner-agnostic), or a
    // face a human has already said "not this person/identity" about, in ANY scope that shares the target's
    // identity. The candidate set is bounded to this scan's own results (never an unscoped read).
    const candidateFaceIds = bestByFace.keys().toArray();
    const { manualLinkedFaceIds, negativeFaceTargets } =
      await this.faceVerdictService.getFaceSettlementInputs(candidateFaceIds);
    const targetTokens = new Set([`person:${id}`, ...(person.identityId ? [`identity:${person.identityId}`] : [])]);
    for (const faceId of candidateFaceIds) {
      const negatives = negativeFaceTargets.get(faceId);
      if (manualLinkedFaceIds.has(faceId) || (negatives && [...negatives].some((token) => targetTokens.has(token)))) {
        bestByFace.delete(faceId);
      }
    }

    const rows = [...bestByFace].map(([assetFaceId, distance]) => ({ personGroupId: id, assetFaceId, distance }));
    await this.facePersonVerdictRepository.upsertPending(rows);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.PersonSuggestionScanQueueAll, queue: QueueName.PeopleBackfill })
  async handlePersonSuggestionScanQueueAll(_data: JobOf<JobName.PersonSuggestionScanQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isFaceSuggestionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    let jobs: { name: JobName.PersonSuggestionScan; data: { id: string } }[] = [];
    for await (const person of this.personRepository.getScannablePeopleWithUnassignedFaces()) {
      jobs.push({ name: JobName.PersonSuggestionScan, data: { id: person.personGroupId } });
      if (jobs.length === JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }
    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.SpacePersonSuggestionScan, queue: QueueName.PeopleBackfill })
  async handleSpacePersonSuggestionScan({ id }: JobOf<JobName.SpacePersonSuggestionScan>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isFaceSuggestionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }
    const { maxDistance, suggestions } = machineLearning.facialRecognition;
    const suggestionMaxDistance = suggestions.maxDistance;

    const person = await this.sharedSpaceRepository.getPersonById(id);
    if (!person || person.name.trim() === '' || person.isHidden || person.type !== 'person') {
      return JobStatus.Skipped;
    }

    const space = await this.sharedSpaceRepository.getById(person.spaceId);
    if (!space?.faceRecognitionEnabled) {
      return JobStatus.Skipped;
    }

    const embeddings = await this.sharedSpaceRepository.getSpacePersonAssignedFaceEmbeddings(
      id,
      PERSON_SUGGESTION_EMBEDDING_SAMPLE,
    );
    if (embeddings.length === 0) {
      return JobStatus.Skipped;
    }

    const bestByFace = new Map<string, number>();
    for (const { embedding } of embeddings) {
      const matches = await this.searchRepository.searchFaces({
        spaceId: person.spaceId,
        embedding,
        hasPerson: false,
        maxDistance: suggestionMaxDistance,
        numResults: PERSON_SUGGESTION_NUM_RESULTS,
        // The space branch already applies spaceVisibilityGate unconditionally (search.repository.ts)
        // so this is redundant there — passed for symmetry with the personal call site above.
        visibility: spaceVisibleAssetVisibilities,
      });
      for (const match of matches) {
        if (match.distance <= maxDistance) {
          continue;
        }
        const prev = bestByFace.get(match.id);
        if (prev === undefined || match.distance < prev) {
          bestByFace.set(match.id, match.distance);
        }
      }
    }

    const assigned = await this.sharedSpaceRepository.getAssignedFaceIdsForSpace(
      person.spaceId,
      bestByFace.keys().toArray(),
    );
    for (const { assetFaceId } of assigned) {
      bestByFace.delete(assetFaceId);
    }

    // D3: same exclusion as the personal scan — a manually-linked face (owner-agnostic), or a face a human
    // has already said "not this person/identity" about, in ANY scope that shares the target's identity.
    const candidateFaceIds = bestByFace.keys().toArray();
    const { manualLinkedFaceIds, negativeFaceTargets } =
      await this.faceVerdictService.getFaceSettlementInputs(candidateFaceIds);
    const targetTokens = new Set([
      `space-person:${id}`,
      ...(person.identityId ? [`identity:${person.identityId}`] : []),
    ]);
    for (const faceId of candidateFaceIds) {
      const negatives = negativeFaceTargets.get(faceId);
      if (manualLinkedFaceIds.has(faceId) || (negatives && [...negatives].some((token) => targetTokens.has(token)))) {
        bestByFace.delete(faceId);
      }
    }

    const rows = [...bestByFace].map(([assetFaceId, distance]) => ({
      spacePersonId: id,
      assetFaceId,
      distance,
    }));
    await this.facePersonVerdictRepository.upsertPendingForSpacePerson(rows);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.SpacePersonSuggestionScanQueueAll, queue: QueueName.PeopleBackfill })
  async handleSpacePersonSuggestionScanQueueAll(
    _data: JobOf<JobName.SpacePersonSuggestionScanQueueAll>,
  ): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isFaceSuggestionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    let jobs: { name: JobName.SpacePersonSuggestionScan; data: { id: string } }[] = [];
    for await (const person of this.sharedSpaceRepository.getScannableSpacePeopleWithUnassignedFaces()) {
      jobs.push({ name: JobName.SpacePersonSuggestionScan, data: { id: person.id } });
      if (jobs.length === JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }
    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }
}
