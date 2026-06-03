import { BadRequestException, Injectable } from '@nestjs/common';
import { Kysely, sql, Transaction } from 'kysely';
import { BulkIdResponseDto } from 'src/dtos/asset-ids.response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { JobName, SharedSpaceActivityType } from 'src/enum';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';

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
  ): Promise<BulkIdResponseDto[]> {
    const { plan, followUps } = await this.deps.databaseRepository.transaction(async (db) => {
      await this.lockMergePropagation(db);
      const plan = await this.buildPersonalMergePlan(
        {
          actorUserId: auth.user.id,
          targetPersonId,
          sourcePersonIds,
        },
        db,
      );
      await this.lockPlanForExecution(plan, db);
      return { plan, followUps: await this.executePlanInTransaction(plan, db) };
    });

    await this.queueFollowUpsBestEffort(plan, followUps);

    return sourcePersonIds.map((id) => ({ id, success: true }));
  }

  async mergeSpacePeople(
    auth: AuthDto,
    spaceId: string,
    targetPersonId: string,
    sourcePersonIds: string[],
  ): Promise<void> {
    const { plan, followUps } = await this.deps.databaseRepository.transaction(async (db) => {
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
      await this.lockPlanForExecution(plan, db);
      return { plan, followUps: await this.executePlanInTransaction(plan, db) };
    });

    await this.queueFollowUpsBestEffort(plan, followUps);
  }

  async executePlan(plan: IdentityMergePropagationPlan, _context: { actorUserId: string }): Promise<void> {
    const followUps = await this.deps.databaseRepository.transaction(async (db) => {
      await this.lockMergePropagation(db);
      await this.lockPlanForExecution(plan, db);
      return this.executePlanInTransaction(plan, db);
    });
    await this.queueFollowUpsBestEffort(plan, followUps);
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
    try {
      await this.queueFollowUps(plan, followUps);
    } catch (error: Error | any) {
      this.deps.logger.error(`Failed to queue merge propagation follow-up jobs: ${error}`, error?.stack);
    }
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
    const ensuredTargetProfile = ensuredOriginProfiles[0];
    const ensuredSourceProfiles = ensuredOriginProfiles.slice(1);
    const targetIdentityId = ensuredTargetProfile.identityId;
    if (!targetIdentityId) {
      throw new BadRequestException('Target person identity not found');
    }

    const sourceIdentityIds = [
      ...new Set(
        ensuredSourceProfiles
          .map((profile) => profile.identityId)
          .filter((identityId): identityId is string => !!identityId && identityId !== targetIdentityId),
      ),
    ];
    const planIdentityIds = [targetIdentityId, ...sourceIdentityIds];
    const attachedProfiles = (await this.deps.faceIdentityRepository.getMergePropagationProfiles(
      {
        mode: 'identities',
        identityIds: planIdentityIds,
      },
      db,
    )) as MergeProfile[];

    const personalGroups = this.groupProfiles(attachedProfiles, 'person');
    const spaceGroups = this.groupProfiles(attachedProfiles, 'space-person');
    const personalProfileMerges: PersonalProfileMergeStep[] = [];
    const spaceProfileMerges: SpaceProfileMergeStep[] = [];
    const profileIdentityUpdates: IdentityMergePropagationPlan['profileIdentityUpdates'] = [];
    const affectedOwnerIds = new Set<string>();
    const affectedSpaceIds = new Set<string>();

    for (const [ownerId, profiles] of [...personalGroups.entries()].toSorted(([a], [b]) => a.localeCompare(b))) {
      const survivor = this.chooseSurvivor(profiles, {
        targetIdentityId,
        initiatingTargetProfileId: ownerId === targetProfile.ownerId ? ensuredTargetProfile.id : undefined,
      });
      const sources = this.sortMergeSources(profiles.filter((profile) => profile.id !== survivor.id));

      if (sources.length > 0) {
        personalProfileMerges.push({
          ownerId,
          targetPersonId: survivor.id,
          sourcePersonIds: sources.map(({ id }) => id),
        });
        affectedOwnerIds.add(ownerId);
      } else if (survivor.identityId !== targetIdentityId) {
        profileIdentityUpdates.push({ kind: 'person', profileId: survivor.id, identityId: targetIdentityId });
        affectedOwnerIds.add(ownerId);
      }
    }

    for (const [spaceId, profiles] of [...spaceGroups.entries()].toSorted(([a], [b]) => a.localeCompare(b))) {
      const survivor = this.chooseSurvivor(profiles, { targetIdentityId });
      const sources = this.sortMergeSources(profiles.filter((profile) => profile.id !== survivor.id));

      if (sources.length > 0) {
        spaceProfileMerges.push({ spaceId, targetPersonId: survivor.id, sourcePersonIds: sources.map(({ id }) => id) });
        affectedSpaceIds.add(spaceId);
      } else if (survivor.identityId !== targetIdentityId) {
        profileIdentityUpdates.push({ kind: 'space-person', profileId: survivor.id, identityId: targetIdentityId });
        affectedSpaceIds.add(spaceId);
      }
    }

    const sortedAffectedOwnerIds = [...affectedOwnerIds].toSorted();
    const sortedAffectedSpaceIds = [...affectedSpaceIds].toSorted();
    const plan: IdentityMergePropagationPlan = {
      actorUserId: input.actorUserId,
      origin: {
        type: 'person',
        targetProfileId: ensuredTargetProfile.id,
        sourceProfileIds: sourcePersonIds,
        ownerId: ensuredTargetProfile.ownerId,
      },
      targetIdentityId,
      sourceIdentityIds,
      personalProfileMerges,
      spaceProfileMerges,
      profileIdentityUpdates,
      affectedOwnerIds: sortedAffectedOwnerIds,
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
      userId: input.actorUserId,
      type: SharedSpaceActivityType.PersonMerge,
      data: this.buildActivityPayload(plan, 'propagated', spaceId),
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

      if (source.type !== target.type) {
        throw new BadRequestException('Cannot merge people of different types');
      }

      sourceProfiles.push(this.mapSpacePersonMergeProfile(source));
    }

    const ensuredOriginProfiles = await this.ensureSpaceOriginIdentities([targetProfile, ...sourceProfiles], db);
    const ensuredTargetProfile = ensuredOriginProfiles[0];
    const ensuredSourceProfiles = ensuredOriginProfiles.slice(1);
    const targetIdentityId = ensuredTargetProfile.identityId;
    if (!targetIdentityId) {
      throw new BadRequestException('Target person identity not found');
    }

    const sourceIdentityIds = [
      ...new Set(
        ensuredSourceProfiles
          .map((profile) => profile.identityId)
          .filter((identityId): identityId is string => !!identityId && identityId !== targetIdentityId),
      ),
    ];
    const planIdentityIds = [targetIdentityId, ...sourceIdentityIds];
    const attachedProfiles = (await this.deps.faceIdentityRepository.getMergePropagationProfiles(
      {
        mode: 'identities',
        identityIds: planIdentityIds,
      },
      db,
    )) as MergeProfile[];

    const personalGroups = this.groupProfiles(attachedProfiles, 'person');
    const spaceGroups = this.groupProfiles(attachedProfiles, 'space-person');
    const personalProfileMerges: PersonalProfileMergeStep[] = [];
    const spaceProfileMerges: SpaceProfileMergeStep[] = [];
    const profileIdentityUpdates: IdentityMergePropagationPlan['profileIdentityUpdates'] = [];
    const affectedOwnerIds = new Set<string>();
    const affectedSpaceIds = new Set<string>();

    for (const [ownerId, profiles] of [...personalGroups.entries()].toSorted(([a], [b]) => a.localeCompare(b))) {
      const survivor = this.chooseSurvivor(profiles, { targetIdentityId });
      const sources = this.sortMergeSources(profiles.filter((profile) => profile.id !== survivor.id));

      if (sources.length > 0) {
        personalProfileMerges.push({
          ownerId,
          targetPersonId: survivor.id,
          sourcePersonIds: sources.map(({ id }) => id),
        });
        affectedOwnerIds.add(ownerId);
      } else if (survivor.identityId !== targetIdentityId) {
        profileIdentityUpdates.push({ kind: 'person', profileId: survivor.id, identityId: targetIdentityId });
        affectedOwnerIds.add(ownerId);
      }
    }

    for (const [spaceId, profiles] of [...spaceGroups.entries()].toSorted(([a], [b]) => a.localeCompare(b))) {
      const survivor = this.chooseSurvivor(profiles, {
        targetIdentityId,
        initiatingTargetProfileId: spaceId === input.spaceId ? ensuredTargetProfile.id : undefined,
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

    const sortedAffectedOwnerIds = [...affectedOwnerIds].toSorted();
    const sortedAffectedSpaceIds = [...affectedSpaceIds].toSorted();
    const plan: IdentityMergePropagationPlan = {
      actorUserId: input.actorUserId,
      origin: {
        type: 'space-person',
        targetProfileId: ensuredTargetProfile.id,
        sourceProfileIds: sourcePersonIds,
        spaceId: input.spaceId,
      },
      targetIdentityId,
      sourceIdentityIds,
      personalProfileMerges,
      spaceProfileMerges,
      profileIdentityUpdates,
      affectedOwnerIds: sortedAffectedOwnerIds,
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
      userId: input.actorUserId,
      type: SharedSpaceActivityType.PersonMerge,
      data: this.buildActivityPayload(plan, spaceId === input.spaceId ? 'initiating' : 'propagated', spaceId),
    }));

    return plan;
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
