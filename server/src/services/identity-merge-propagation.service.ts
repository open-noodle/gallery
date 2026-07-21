import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Kysely, sql, Transaction } from 'kysely';
import { BulkIdResponseDto } from 'src/dtos/asset-ids.response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { MergeScopedPeopleDto, ScopedPersonProfileRefDto } from 'src/dtos/person.dto';
import { JobName, SharedSpaceActivityType, SharedSpaceRole } from 'src/enum';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { MERGE_ERROR_CODE } from 'src/utils/merge-error-code';

export type MergeProfileKind = 'person' | 'space-person';

export type MergeProfile = {
  kind: MergeProfileKind;
  id: string;
  ownerId?: string;
  spaceId?: string;
  identityId: string | null;
  type: string;
  name: string;
  faceCount: number;
};

/**
 * The subset of a profile the plan builder needs from an origin: which scope it lives in, and which identity
 * it carries. Survivor selection reads face counts and names from the *attached* profiles, not from these.
 */
export type MergeOriginProfile = Pick<MergeProfile, 'kind' | 'id' | 'ownerId' | 'spaceId' | 'identityId' | 'type'>;

/**
 * Runs against the built plan, inside the merge transaction and before anything is written, so a refusal rolls
 * back even the identities the builder may have minted. Authorization policy (and the config it reads) lives in
 * the calling service — the planner stays an engine.
 */
export type MergeAuthorizer = (plan: IdentityMergePropagationPlan) => Promise<void>;

export type ProfileMergeStep = {
  targetPersonId: string;
  sourcePersonIds: string[];
};

export type PersonalProfileMergeStep = ProfileMergeStep & { ownerId: string };
export type SpaceProfileMergeStep = ProfileMergeStep & { spaceId: string };

export type MergePropagationActivityPayload = {
  originScope: MergeProfileKind;
  actorUserId: string;
  activityRole: 'initiating' | 'propagated';
  originatingSpaceId: string | null;
  targetProfileId: string;
  sourceProfileIds: string[];
  targetIdentityId: string;
  sourceIdentityIds: string[];
  affectedPersonalProfileMergeCount: number;
  affectedSharedSpaceProfileMergeCount: number;
  affectedSpaceIds: string[];
};

export type MergePropagationActivityEvent = {
  spaceId: string;
  userId: string;
  type: SharedSpaceActivityType.PersonMerge;
  data: MergePropagationActivityPayload;
};

export type MergePropagationFollowUpJob =
  | { name: JobName.SharedSpacePersonMetadataBackfill; data: { identityId: string } }
  | { name: JobName.SharedSpacePersonDedup; data: { spaceId: string } }
  | { name: JobName.PersonGenerateThumbnail; data: { id: string } }
  | { name: JobName.FileDelete; data: { files: string[] } };

export type IdentityMergePropagationPlan = {
  actorUserId: string;
  origin: {
    type: MergeProfileKind;
    targetProfileId: string;
    sourceProfileIds: string[];
    ownerId?: string;
    spaceId?: string;
  };
  targetIdentityId: string;
  sourceIdentityIds: string[];
  personalProfileMerges: PersonalProfileMergeStep[];
  spaceProfileMerges: SpaceProfileMergeStep[];
  profileIdentityUpdates: Array<{ kind: MergeProfileKind; profileId: string; identityId: string }>;
  affectedOwnerIds: string[];
  /**
   * Owners other than the actor whose single person on the identity set is merely re-pointed at the surviving
   * identity. Their row keeps its name, faces and thumbnail — nothing is destroyed, and this is precisely what
   * the recognition job already does unattended when it fuses identities across libraries. Ungated.
   */
  repointedOwnerIds: string[];
  /**
   * Owners other than the actor who hold people on BOTH identities, so committing the merge would merge two of
   * THEIR people: one row deleted, its faces moved. That is destructive and irreversible for someone who never
   * asked for it — and the automatic paths refuse to do it. This is what the cross-owner gate exists for.
   */
  collapsedOwnerIds: string[];
  /**
   * Spaces whose profiles this merge would collapse (one row deleted, its faces moved) but where the actor is
   * not an Owner/Editor. Collapsing a space's people is an editor-only action, and the fan-out must not reach it
   * for a viewer or non-member. Populated for every merge path; enforced (toggle-independently) by the policy.
   */
  unrepairableSpaceCollapseIds: string[];
  affectedSpaceIds: string[];
  followUpJobs: MergePropagationFollowUpJob[];
  activityEvents: MergePropagationActivityEvent[];
};

type IdentityMergePropagationDependencies = {
  databaseRepository: DatabaseRepository;
  faceIdentityRepository: FaceIdentityRepository;
  jobRepository: JobRepository;
  logger: LoggingRepository;
  personRepository: PersonRepository;
  sharedSpaceRepository: SharedSpaceRepository;
};

type DbOrTransaction = Kysely<DB> | Transaction<DB>;

type ExecutedPlanFollowUps = {
  deletedThumbnailPaths: string[];
  featureFaceRepairJobs: MergePropagationFollowUpJob[];
};

@Injectable()
export class IdentityMergePropagationService {
  constructor(private deps: IdentityMergePropagationDependencies) {}

  async mergePersonalPeople(
    auth: AuthDto,
    targetPersonId: string,
    sourcePersonIds: string[],
    authorize?: MergeAuthorizer,
  ): Promise<BulkIdResponseDto[]> {
    const { plan, followUps } = await this.runMergeTransaction(async (db) => {
      await this.lockMergePropagation(db);
      const plan = await this.buildPersonalMergePlan(
        {
          actorUserId: auth.user.id,
          targetPersonId,
          sourcePersonIds,
        },
        db,
      );
      await this.authorizePlan(plan, authorize);
      await this.lockPlanForExecution(plan, db);
      return { plan, followUps: await this.executePlanInTransaction(plan, db) };
    });

    await this.queueFollowUpsBestEffort(plan, followUps);

    return sourcePersonIds.map((id) => ({ id, success: true }));
  }

  /**
   * The scoped merge (POST /people/same-person). Same engine as the personal and in-space merges — it is only
   * the origin refs that differ, so a same-scope profile conflict is collapsed here exactly as it is there.
   */
  async mergeScopedProfiles(auth: AuthDto, dto: MergeScopedPeopleDto, authorize?: MergeAuthorizer): Promise<void> {
    const { plan, followUps } = await this.runMergeTransaction(async (db) => {
      await this.lockMergePropagation(db);
      const plan = await this.buildScopedMergePlan(
        {
          actorUserId: auth.user.id,
          target: dto.target,
          sources: dto.sources,
        },
        db,
      );
      await this.authorizePlan(plan, authorize);
      await this.lockPlanForExecution(plan, db);
      return { plan, followUps: await this.executePlanInTransaction(plan, db) };
    });

    await this.queueFollowUpsBestEffort(plan, followUps);
  }

  async mergeSpacePeople(
    auth: AuthDto,
    spaceId: string,
    targetPersonId: string,
    sourcePersonIds: string[],
    authorize?: MergeAuthorizer,
  ): Promise<void> {
    const { plan, followUps } = await this.runMergeTransaction(async (db) => {
      await this.lockMergePropagation(db);
      const plan = await this.buildSpaceMergePlan(
        {
          actorUserId: auth.user.id,
          spaceId,
          targetPersonId,
          sourcePersonIds,
        },
        db,
      );
      await this.authorizePlan(plan, authorize);
      await this.lockPlanForExecution(plan, db);
      return { plan, followUps: await this.executePlanInTransaction(plan, db) };
    });

    await this.queueFollowUpsBestEffort(plan, followUps);
  }

  async executePlan(plan: IdentityMergePropagationPlan, _context: { actorUserId: string }): Promise<void> {
    const followUps = await this.runMergeTransaction(async (db) => {
      await this.lockMergePropagation(db);
      // executePlan has no authorizer to consult, so it may only run non-destructive plans (issue #733 review, L3).
      await this.authorizePlan(plan);
      await this.lockPlanForExecution(plan, db);
      return this.executePlanInTransaction(plan, db);
    });
    await this.queueFollowUpsBestEffort(plan, followUps);
  }

  /**
   * The gate every merge entry point applies before execution. `authorize` is optional so the engine's mechanics
   * can be tested in isolation — but a plan that would DESTRUCTIVELY collapse another owner's people, or people in
   * a space the actor cannot edit, must never execute without one. Failing closed here means a future merge path
   * (or a call to `executePlan`) that forgets the authorizer cannot silently re-open the #733 cross-owner hole; it
   * throws instead. Tests that intentionally exercise destructive execution pass an explicit permissive authorizer.
   */
  /**
   * Runs the merge transaction, translating a concurrency collision into a retriable 409 instead of a 500 (#733
   * review L2). The automatic recognition/dedup/reconciliation and detach paths do NOT take the merge advisory
   * lock, so between this plan's read snapshot and its writes one of them can insert or move a profile on an
   * involved identity. The plan's unguarded identity move then hits the unique (scope, identity) index (23505), or
   * the post-merge conflict re-check (`mergeIdentitiesAfterProfileResolution`) fires. Nothing is lost — the
   * transaction rolls back — but the caller should be told to try again, not shown an internal error.
   */
  private async runMergeTransaction<T>(fn: (db: Transaction<DB>) => Promise<T>): Promise<T> {
    try {
      return await this.deps.databaseRepository.transaction(fn);
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      const message = error instanceof Error ? error.message : '';
      if (code === '23505' || message.includes('unresolved profile conflicts')) {
        throw new ConflictException({
          code: MERGE_ERROR_CODE.conflict,
          message: 'This merge conflicts with a concurrent change to the same people. Please try again.',
        });
      }
      throw error;
    }
  }

  private async authorizePlan(plan: IdentityMergePropagationPlan, authorize?: MergeAuthorizer): Promise<void> {
    if (authorize) {
      await authorize(plan);
      return;
    }

    if (plan.collapsedOwnerIds.length > 0 || plan.unrepairableSpaceCollapseIds.length > 0) {
      throw new Error(
        'Refusing to execute a destructive cross-boundary merge without an authorizer (issue #733). ' +
          'Every merge entry point must pass a MergeAuthorizer that applies the cross-owner policy.',
      );
    }
  }

  private async lockPlanForExecution(plan: IdentityMergePropagationPlan, db: Transaction<DB>): Promise<void> {
    await this.lockMergeIdentities([plan.targetIdentityId, ...plan.sourceIdentityIds], db);

    const personIds = [
      ...plan.personalProfileMerges.flatMap((step) => [step.targetPersonId, ...step.sourcePersonIds]),
      ...plan.profileIdentityUpdates.filter((update) => update.kind === 'person').map((update) => update.profileId),
    ];
    const spacePersonIds = [
      ...plan.spaceProfileMerges.flatMap((step) => [step.targetPersonId, ...step.sourcePersonIds]),
      ...plan.profileIdentityUpdates
        .filter((update) => update.kind === 'space-person')
        .map((update) => update.profileId),
    ];

    await this.deps.personRepository.lockPeopleForMerge(personIds, db);
    await this.deps.sharedSpaceRepository.lockSpacePeopleForMerge(spacePersonIds, db);
  }

  private async lockMergePropagation(db: Transaction<DB>): Promise<void> {
    if (typeof (db as { executeQuery?: unknown }).executeQuery !== 'function') {
      return;
    }

    await sql`select pg_advisory_xact_lock(hashtext('identity-merge-propagation'))`.execute(db);
  }

  private async lockMergeIdentities(identityIds: string[], db: Transaction<DB>): Promise<void> {
    if (typeof (db as { executeQuery?: unknown }).executeQuery !== 'function') {
      return;
    }

    for (const identityId of [...new Set(identityIds)].toSorted()) {
      await sql`select pg_advisory_xact_lock(hashtext('identity-merge-propagation'), hashtext(${identityId}))`.execute(
        db,
      );
    }
  }

  private async executePlanInTransaction(
    plan: IdentityMergePropagationPlan,
    db: Transaction<DB>,
  ): Promise<ExecutedPlanFollowUps> {
    const deletedThumbnailPaths: string[] = [];
    const featureFaceRepairJobs: MergePropagationFollowUpJob[] = [];

    for (const step of plan.personalProfileMerges) {
      let targetNeedsFeatureFaceRepair = false;
      for (const sourcePersonId of step.sourcePersonIds) {
        const { deletedThumbnailPath, targetNeedsFeatureFaceRepair: sourceMergeNeedsFeatureFaceRepair } =
          await this.deps.personRepository.mergePersonProfile(
            {
              sourcePersonId,
              targetPersonId: step.targetPersonId,
              targetIdentityId: plan.targetIdentityId,
            },
            db,
          );
        if (deletedThumbnailPath) {
          deletedThumbnailPaths.push(deletedThumbnailPath);
        }
        targetNeedsFeatureFaceRepair ||= sourceMergeNeedsFeatureFaceRepair;
      }

      await this.deps.faceIdentityRepository.linkPersonFaces(
        { personId: step.targetPersonId, identityId: plan.targetIdentityId, source: 'manual' },
        db,
      );

      if (targetNeedsFeatureFaceRepair) {
        const repairJob = await this.repairMissingPersonalFeatureFace(step.targetPersonId, db);
        if (repairJob) {
          featureFaceRepairJobs.push(repairJob);
        }
      }
    }

    for (const step of plan.spaceProfileMerges) {
      for (const sourcePersonId of step.sourcePersonIds) {
        await this.deps.sharedSpaceRepository.mergeSpacePersonProfile(
          { sourcePersonId, targetPersonId: step.targetPersonId },
          db,
        );
      }
    }

    for (const spaceId of plan.affectedSpaceIds) {
      await this.deps.sharedSpaceRepository.repairInvalidRepresentativeFaces(spaceId, db);
      await this.deps.sharedSpaceRepository.repairOrphanedRepresentativeFaces(spaceId, db);
    }

    for (const update of plan.profileIdentityUpdates) {
      await (update.kind === 'person'
        ? this.deps.personRepository.updatePersonIdentity(
            { personId: update.profileId, identityId: update.identityId },
            db,
          )
        : this.deps.sharedSpaceRepository.updateSpacePersonIdentity(
            { personId: update.profileId, identityId: update.identityId },
            db,
          ));
    }

    await this.deps.faceIdentityRepository.mergeIdentitiesAfterProfileResolution(
      {
        targetIdentityId: plan.targetIdentityId,
        sourceIdentityIds: plan.sourceIdentityIds,
        source: 'manual',
      },
      db,
    );

    for (const event of plan.activityEvents) {
      await this.deps.sharedSpaceRepository.logActivity(event, db);
    }

    return { deletedThumbnailPaths, featureFaceRepairJobs };
  }

  private async queueFollowUpsBestEffort(plan: IdentityMergePropagationPlan, followUps: ExecutedPlanFollowUps) {
    this.auditDestructiveCrossOwnerCollapse(plan);

    try {
      await this.queueFollowUps(plan, followUps);
    } catch (error: Error | any) {
      this.deps.logger.error(`Failed to queue merge propagation follow-up jobs: ${error}`, error?.stack);
    }
  }

  /**
   * Record a committed cross-owner COLLAPSE (issue #733 review A1). Collapsing another owner's two people deletes
   * one of their person rows — an irreversible action on data the actor does not own. A collapse that touches a
   * space leaves a space-activity trace, but a purely-personal one leaves none at all, so log every one here.
   * Runs post-commit (from the best-effort follow-up step), so it only records merges that actually landed.
   */
  private auditDestructiveCrossOwnerCollapse(plan: IdentityMergePropagationPlan): void {
    if (plan.collapsedOwnerIds.length === 0) {
      return;
    }

    this.deps.logger.warn(
      `Cross-owner people merge committed by ${plan.actorUserId}: collapsed people belonging to ` +
        `${plan.collapsedOwnerIds.length} other owner(s) [${plan.collapsedOwnerIds.join(', ')}] into identity ` +
        `${plan.targetIdentityId} — one person per owner deleted, irreversible.`,
    );
  }

  private async queueFollowUps(plan: IdentityMergePropagationPlan, followUps: ExecutedPlanFollowUps) {
    for (const job of this.dedupeFollowUpJobs([...plan.followUpJobs, ...followUps.featureFaceRepairJobs])) {
      await this.deps.jobRepository.queue(job);
    }

    if (followUps.deletedThumbnailPaths.length > 0) {
      await this.deps.jobRepository.queue({
        name: JobName.FileDelete,
        data: { files: [...new Set(followUps.deletedThumbnailPaths)] },
      });
    }
  }

  private async repairMissingPersonalFeatureFace(
    personId: string,
    db: Transaction<DB>,
  ): Promise<MergePropagationFollowUpJob | null> {
    const assetFace = await this.deps.personRepository.getRandomFace(personId, db);
    if (!assetFace) {
      return null;
    }

    await this.deps.personRepository.update({ id: personId, faceAssetId: assetFace.id }, db);

    return { name: JobName.PersonGenerateThumbnail, data: { id: personId } };
  }

  /**
   * Ensures identities for the initiating target/source profiles before loading attached profiles;
   * this may persist newly-created identities.
   */
  async buildPersonalMergePlan(
    input: {
      actorUserId: string;
      targetPersonId: string;
      sourcePersonIds: string[];
    },
    db?: DbOrTransaction,
  ): Promise<IdentityMergePropagationPlan> {
    const sourcePersonIds = [...new Set(input.sourcePersonIds)].filter((id) => id !== input.targetPersonId);
    const originPersonIds = [input.targetPersonId, ...sourcePersonIds];
    await this.deps.personRepository.lockPeopleForMerge(originPersonIds, db);
    const originProfiles = await this.deps.faceIdentityRepository.getMergePropagationProfiles(
      {
        mode: 'profiles',
        personIds: originPersonIds,
      },
      db,
    );
    const originProfilesById = new Map(originProfiles.map((profile) => [profile.id, profile as MergeProfile]));

    const targetProfile = originProfilesById.get(input.targetPersonId);
    if (!targetProfile || targetProfile.kind !== 'person' || targetProfile.ownerId !== input.actorUserId) {
      throw new BadRequestException('Target person not found');
    }

    const sourceProfiles = sourcePersonIds.map((sourcePersonId) => {
      const sourceProfile = originProfilesById.get(sourcePersonId);
      if (!sourceProfile || sourceProfile.kind !== 'person' || sourceProfile.ownerId !== targetProfile.ownerId) {
        throw new BadRequestException('Source person not found');
      }

      return sourceProfile;
    });

    const ensuredOriginProfiles = await this.ensureOriginIdentities([targetProfile, ...sourceProfiles], db);

    return this.buildPlanFromOrigins(
      {
        actorUserId: input.actorUserId,
        ensuredTarget: ensuredOriginProfiles[0],
        ensuredSources: ensuredOriginProfiles.slice(1),
        sourceProfileIds: sourcePersonIds,
      },
      db,
    );
  }

  /**
   * The scoped merge (POST /people/same-person): the target and each source are named by a scoped ref, so a
   * single merge can span the actor's own library and any space they can repair. This is the merge the global
   * People page issues whenever one of the selected people is only visible through a space (issue #733).
   *
   * The refs are RBAC-checked on resolution; everything the identities are *attached* to is then collapsed by
   * the shared tail, exactly as for the personal and in-space merges.
   */
  async buildScopedMergePlan(
    input: {
      actorUserId: string;
      target: ScopedPersonProfileRefDto;
      sources: ScopedPersonProfileRefDto[];
    },
    db?: DbOrTransaction,
  ): Promise<IdentityMergePropagationPlan> {
    const origins = await this.deps.faceIdentityRepository.resolveScopedMergeOrigins(
      input.actorUserId,
      [input.target, ...input.sources],
      db,
    );
    if (!origins) {
      throw new BadRequestException({
        code: MERGE_ERROR_CODE.notAccessible,
        message: 'One or more people were not found or are not accessible',
      });
    }

    const [targetOrigin, ...sourceOrigins] = origins;
    const uniqueSourceOrigins = sourceOrigins.filter(
      (origin, index) =>
        !(origin.kind === targetOrigin.kind && origin.id === targetOrigin.id) &&
        sourceOrigins.findIndex((other) => other.kind === origin.kind && other.id === origin.id) === index,
    );

    const originProfiles = [targetOrigin, ...uniqueSourceOrigins];
    const personIds = originProfiles.filter(({ kind }) => kind === 'person').map(({ id }) => id);
    const spacePersonIds = originProfiles.filter(({ kind }) => kind === 'space-person').map(({ id }) => id);
    if (personIds.length > 0) {
      await this.deps.personRepository.lockPeopleForMerge(personIds, db);
    }
    if (spacePersonIds.length > 0) {
      await this.deps.sharedSpaceRepository.lockSpacePeopleForMerge(spacePersonIds, db);
    }

    const ensuredOriginProfiles: MergeOriginProfile[] = [];
    for (const origin of originProfiles) {
      const identity =
        origin.kind === 'person'
          ? await this.deps.faceIdentityRepository.ensurePersonIdentity(origin.id, db)
          : await this.deps.faceIdentityRepository.ensureSpacePersonIdentity(origin.id, db);
      ensuredOriginProfiles.push({ ...origin, identityId: identity.id });
    }

    return this.buildPlanFromOrigins(
      {
        actorUserId: input.actorUserId,
        ensuredTarget: ensuredOriginProfiles[0],
        ensuredSources: ensuredOriginProfiles.slice(1),
        sourceProfileIds: uniqueSourceOrigins.map(({ id }) => id),
      },
      db,
    );
  }

  /**
   * The shared tail of every merge plan, and the only place profile conflicts are resolved: fan out to every
   * profile attached to the involved identities, group them by scope (owner, space), pick one survivor per
   * scope and collapse the rest into it. A scope may hold only one profile per identity
   * (person_ownerId_identityId_key / shared_space_person_spaceId_identityId_key), so without this collapse the
   * identity merge could not commit at all.
   *
   * The survivor of the actor's *own* scope is pinned to the profile they targeted; every other scope picks by
   * face count, then name, then id.
   */
  /**
   * Of the spaces this merge would collapse, the ones where the actor is not an Owner/Editor. The actor's role
   * is read per space (member spaces only); a space the actor is a viewer of, or not a member of at all, is not
   * repairable and so is returned. The initiating space of an in-space merge is Editor-checked upstream, so it
   * never appears here.
   */
  private async resolveUnrepairableSpaceCollapses(
    actorUserId: string,
    collapsedSpaceIds: string[],
    db?: DbOrTransaction,
  ): Promise<string[]> {
    const roles = await this.deps.sharedSpaceRepository.getActorSpaceRoles(actorUserId, collapsedSpaceIds, db);
    return collapsedSpaceIds
      .filter((spaceId) => {
        const role = roles.get(spaceId);
        return role !== SharedSpaceRole.Owner && role !== SharedSpaceRole.Editor;
      })
      .toSorted();
  }

  private async buildPlanFromOrigins(
    input: {
      actorUserId: string;
      ensuredTarget: MergeOriginProfile;
      ensuredSources: MergeOriginProfile[];
      sourceProfileIds: string[];
    },
    db?: DbOrTransaction,
  ): Promise<IdentityMergePropagationPlan> {
    const { actorUserId, ensuredTarget, ensuredSources, sourceProfileIds } = input;
    const targetIdentityId = ensuredTarget.identityId;
    if (!targetIdentityId) {
      throw new BadRequestException('Target person identity not found');
    }

    const sourceIdentityIds = [
      ...new Set(
        ensuredSources
          .map((profile) => profile.identityId)
          .filter((identityId): identityId is string => !!identityId && identityId !== targetIdentityId),
      ),
    ];
    const attachedProfiles = (await this.deps.faceIdentityRepository.getMergePropagationProfiles(
      {
        mode: 'identities',
        identityIds: [targetIdentityId, ...sourceIdentityIds],
      },
      db,
    )) as MergeProfile[];

    // The scope the merge was initiated from: its survivor is pinned to the profile the actor targeted, and
    // (for a space origin) its activity event is the initiating one.
    const initiatingOwnerId = ensuredTarget.kind === 'person' ? ensuredTarget.ownerId : undefined;
    const initiatingSpaceId = ensuredTarget.kind === 'space-person' ? ensuredTarget.spaceId : undefined;

    const personalGroups = this.groupProfiles(attachedProfiles, 'person');
    const spaceGroups = this.groupProfiles(attachedProfiles, 'space-person');
    const personalProfileMerges: PersonalProfileMergeStep[] = [];
    const spaceProfileMerges: SpaceProfileMergeStep[] = [];
    const profileIdentityUpdates: IdentityMergePropagationPlan['profileIdentityUpdates'] = [];
    const affectedOwnerIds = new Set<string>();
    const affectedSpaceIds = new Set<string>();
    const repointedOwnerIds = new Set<string>();
    const collapsedOwnerIds = new Set<string>();

    for (const [ownerId, profiles] of [...personalGroups].toSorted(([a], [b]) => a.localeCompare(b))) {
      const survivor = this.chooseSurvivor(profiles, {
        targetIdentityId,
        initiatingTargetProfileId: ownerId === initiatingOwnerId ? ensuredTarget.id : undefined,
      });
      const sources = this.sortMergeSources(profiles.filter((profile) => profile.id !== survivor.id));

      if (sources.length > 0) {
        personalProfileMerges.push({
          ownerId,
          targetPersonId: survivor.id,
          sourcePersonIds: sources.map(({ id }) => id),
        });
        affectedOwnerIds.add(ownerId);
        if (ownerId !== actorUserId) {
          collapsedOwnerIds.add(ownerId);
        }
      } else if (survivor.identityId !== targetIdentityId) {
        profileIdentityUpdates.push({ kind: 'person', profileId: survivor.id, identityId: targetIdentityId });
        affectedOwnerIds.add(ownerId);
        if (ownerId !== actorUserId) {
          repointedOwnerIds.add(ownerId);
        }
      }
    }

    for (const [spaceId, profiles] of [...spaceGroups].toSorted(([a], [b]) => a.localeCompare(b))) {
      const survivor = this.chooseSurvivor(profiles, {
        targetIdentityId,
        initiatingTargetProfileId: spaceId === initiatingSpaceId ? ensuredTarget.id : undefined,
      });
      const sources = this.sortMergeSources(profiles.filter((profile) => profile.id !== survivor.id));

      if (sources.length > 0) {
        spaceProfileMerges.push({ spaceId, targetPersonId: survivor.id, sourcePersonIds: sources.map(({ id }) => id) });
        affectedSpaceIds.add(spaceId);
      } else if (survivor.identityId !== targetIdentityId) {
        profileIdentityUpdates.push({ kind: 'space-person', profileId: survivor.id, identityId: targetIdentityId });
        affectedSpaceIds.add(spaceId);
      }
    }

    // Collapsing a space's people is an editor-only action. A merge must not reach that destructive result by
    // fan-out just because the actor owns personal people on the same identities, so any collapsed space where
    // the actor is not an Owner/Editor is flagged for the policy to hard-block (issue #733 follow-up). Re-points
    // (the else-branch above) are non-destructive and never flagged.
    const collapsedSpaceIds = spaceProfileMerges.map((step) => step.spaceId);
    const unrepairableSpaceCollapseIds =
      collapsedSpaceIds.length > 0
        ? await this.resolveUnrepairableSpaceCollapses(actorUserId, collapsedSpaceIds, db)
        : [];

    const sortedAffectedOwnerIds = [...affectedOwnerIds].toSorted();
    const sortedAffectedSpaceIds = [...affectedSpaceIds].toSorted();
    const plan: IdentityMergePropagationPlan = {
      actorUserId,
      origin:
        ensuredTarget.kind === 'person'
          ? {
              type: 'person',
              targetProfileId: ensuredTarget.id,
              sourceProfileIds,
              ownerId: ensuredTarget.ownerId,
            }
          : {
              type: 'space-person',
              targetProfileId: ensuredTarget.id,
              sourceProfileIds,
              spaceId: ensuredTarget.spaceId,
            },
      targetIdentityId,
      sourceIdentityIds,
      personalProfileMerges,
      spaceProfileMerges,
      profileIdentityUpdates,
      affectedOwnerIds: sortedAffectedOwnerIds,
      repointedOwnerIds: [...repointedOwnerIds].toSorted(),
      collapsedOwnerIds: [...collapsedOwnerIds].toSorted(),
      unrepairableSpaceCollapseIds,
      affectedSpaceIds: sortedAffectedSpaceIds,
      followUpJobs: [
        { name: JobName.SharedSpacePersonMetadataBackfill, data: { identityId: targetIdentityId } },
        ...sortedAffectedSpaceIds.map(
          (spaceId): MergePropagationFollowUpJob => ({ name: JobName.SharedSpacePersonDedup, data: { spaceId } }),
        ),
      ],
      activityEvents: [],
    };

    plan.activityEvents = sortedAffectedSpaceIds.map((spaceId) => ({
      spaceId,
      userId: actorUserId,
      type: SharedSpaceActivityType.PersonMerge,
      data: this.buildActivityPayload(plan, spaceId === initiatingSpaceId ? 'initiating' : 'propagated', spaceId),
    }));

    return plan;
  }

  /**
   * Ensures identities for the initiating target/source space profiles before loading attached profiles;
   * this may persist newly-created identities.
   */
  async buildSpaceMergePlan(
    input: {
      actorUserId: string;
      spaceId: string;
      targetPersonId: string;
      sourcePersonIds: string[];
    },
    db?: DbOrTransaction,
  ): Promise<IdentityMergePropagationPlan> {
    const sourcePersonIds = [...new Set(input.sourcePersonIds)].filter((id) => id !== input.targetPersonId);
    const originPersonIds = [input.targetPersonId, ...sourcePersonIds];
    await this.deps.sharedSpaceRepository.lockSpacePeopleForMerge(originPersonIds, db);

    const target = await this.deps.sharedSpaceRepository.getPersonById(input.targetPersonId, db);
    if (!target || target.spaceId !== input.spaceId) {
      throw new BadRequestException('Person not found');
    }

    const targetProfile = this.mapSpacePersonMergeProfile(target);
    const sourceProfiles: MergeProfile[] = [];
    for (const sourcePersonId of sourcePersonIds) {
      const source = await this.deps.sharedSpaceRepository.getPersonById(sourcePersonId, db);
      if (!source || source.spaceId !== input.spaceId) {
        throw new BadRequestException('Source person not found in this space');
      }

      sourceProfiles.push(this.mapSpacePersonMergeProfile(source));
    }

    const ensuredOriginProfiles = await this.ensureSpaceOriginIdentities([targetProfile, ...sourceProfiles], db);

    return this.buildPlanFromOrigins(
      {
        actorUserId: input.actorUserId,
        ensuredTarget: ensuredOriginProfiles[0],
        ensuredSources: ensuredOriginProfiles.slice(1),
        sourceProfileIds: sourcePersonIds,
      },
      db,
    );
  }

  private buildActivityPayload(
    plan: IdentityMergePropagationPlan,
    role: 'initiating' | 'propagated',
    _spaceId: string,
  ): MergePropagationActivityPayload {
    return {
      originScope: plan.origin.type,
      actorUserId: plan.actorUserId,
      activityRole: role,
      originatingSpaceId: plan.origin.type === 'space-person' ? (plan.origin.spaceId ?? null) : null,
      targetProfileId: plan.origin.targetProfileId,
      sourceProfileIds: plan.origin.sourceProfileIds,
      targetIdentityId: plan.targetIdentityId,
      sourceIdentityIds: plan.sourceIdentityIds,
      affectedPersonalProfileMergeCount: plan.personalProfileMerges.length,
      affectedSharedSpaceProfileMergeCount: plan.spaceProfileMerges.length,
      affectedSpaceIds: plan.affectedSpaceIds,
    };
  }

  private async ensureOriginIdentities(profiles: MergeProfile[], db?: DbOrTransaction): Promise<MergeProfile[]> {
    const ensured: MergeProfile[] = [];

    for (const profile of profiles) {
      const identity = await this.deps.faceIdentityRepository.ensurePersonIdentity(profile.id, db);
      ensured.push({ ...profile, identityId: identity.id });
    }

    return ensured;
  }

  private async ensureSpaceOriginIdentities(profiles: MergeProfile[], db?: DbOrTransaction): Promise<MergeProfile[]> {
    const ensured: MergeProfile[] = [];

    for (const profile of profiles) {
      const identity = await this.deps.faceIdentityRepository.ensureSpacePersonIdentity(profile.id, db);
      ensured.push({ ...profile, identityId: identity.id });
    }

    return ensured;
  }

  private mapSpacePersonMergeProfile(person: {
    id: string;
    spaceId: string;
    identityId?: string | null;
    type: string;
    name?: string | null;
    faceCount?: number | null;
  }): MergeProfile {
    return {
      kind: 'space-person',
      id: person.id,
      spaceId: person.spaceId,
      identityId: person.identityId ?? null,
      type: person.type,
      name: person.name ?? '',
      faceCount: Number(person.faceCount ?? 0),
    };
  }

  private groupProfiles(profiles: MergeProfile[], kind: 'person'): Map<string, MergeProfile[]>;
  private groupProfiles(profiles: MergeProfile[], kind: 'space-person'): Map<string, MergeProfile[]>;
  private groupProfiles(profiles: MergeProfile[], kind: MergeProfileKind): Map<string, MergeProfile[]> {
    const groups = new Map<string, MergeProfile[]>();

    for (const profile of profiles) {
      if (profile.kind !== kind) {
        continue;
      }

      const groupId = profile.kind === 'person' ? profile.ownerId : profile.spaceId;
      if (!groupId) {
        continue;
      }

      const group = groups.get(groupId) ?? [];
      group.push(profile);
      groups.set(groupId, group);
    }

    return groups;
  }

  private chooseSurvivor(
    profiles: MergeProfile[],
    options: { targetIdentityId: string; initiatingTargetProfileId?: string },
  ): MergeProfile {
    const initiatingTarget = profiles.find((profile) => profile.id === options.initiatingTargetProfileId);
    if (initiatingTarget) {
      return initiatingTarget;
    }

    const targetIdentityProfile = this.sortMergeSources(
      profiles.filter((profile) => profile.identityId === options.targetIdentityId),
    )[0];
    if (targetIdentityProfile) {
      return targetIdentityProfile;
    }

    return this.sortMergeSources(profiles)[0];
  }

  private sortMergeSources(profiles: MergeProfile[]): MergeProfile[] {
    return profiles.toSorted(
      (a, b) =>
        b.faceCount - a.faceCount || Number(this.hasName(b)) - Number(this.hasName(a)) || a.id.localeCompare(b.id),
    );
  }

  private hasName(profile: MergeProfile): boolean {
    return profile.name.trim().length > 0;
  }

  private dedupeFollowUpJobs(jobs: MergePropagationFollowUpJob[]): MergePropagationFollowUpJob[] {
    const seen = new Set<string>();
    const deduped: MergePropagationFollowUpJob[] = [];

    for (const job of jobs) {
      const key = `${job.name}:${JSON.stringify(job.data)}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      deduped.push(job);
    }

    return deduped;
  }
}
