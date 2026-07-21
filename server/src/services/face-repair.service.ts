import { Injectable } from '@nestjs/common';
import { JobName, QueueName } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { RepairReport, summarizeRepairPlan } from 'src/services/face-repair.summary';
import { FlagParams, ReattributionTally, decideReattribution, tallyReattribution } from 'src/utils/face-repair';

export interface ReattributionCandidate extends ReattributionTally {
  assetFaceId: string;
  currentPersonId: string;
}

export interface FlaggedFace {
  assetFaceId: string;
  currentPersonId: string;
  suspectedOwnerId: string;
}

export type ReviewOnlyReason = 'over-cap' | 'bad-target';

export interface RepairPlan {
  toRepair: FlaggedFace[];
  reviewOnlyFaces: (FlaggedFace & { reason: ReviewOnlyReason })[];
  reviewOnlyPersonIds: string[];
  unAttributableFaces: { assetFaceId: string; currentPersonId: string }[];
  perPerson: { personId: string; eligible: number; flagged: number; flaggedFraction: number }[];
}

const DEFAULT_VOTE_WINDOW = 200;
const DEFAULT_VOTE_MARGIN = 2;
const DEFAULT_MAX_ATTRIBUTION_DISTANCE = 0.35;
const DEFAULT_MAX_FLAGGED_FRACTION = 0.5;

export interface RunRepairOptions {
  dryRun?: boolean;
  ownerId?: string;
  personId?: string;
  maxDistance?: number;
  minFaces?: number;
  voteWindow?: number;
  voteMargin?: number;
  maxAttributionDistance?: number;
  maxFlaggedFraction?: number;
}

export interface RunRepairResult {
  dryRun: boolean;
  mutated: boolean;
  report: RepairReport;
  executed?: { unassigned: number; requeued: number };
}

export { RepairReport } from 'src/services/face-repair.summary';

@Injectable()
export class FaceRepairService extends BaseService {
  async buildRepairPlan(
    options: {
      ownerId?: string;
      personId?: string;
      maxDistance: number;
      voteWindow: number;
      maxFlaggedFraction: number;
    } & FlagParams,
  ): Promise<RepairPlan> {
    const eligibleByPerson = new Map<string, number>();
    const flaggedByPerson = new Map<string, FlaggedFace[]>();
    const unAttributableFaces: { assetFaceId: string; currentPersonId: string }[] = [];

    for await (const candidate of this.findReattributionCandidates(options)) {
      eligibleByPerson.set(candidate.currentPersonId, (eligibleByPerson.get(candidate.currentPersonId) ?? 0) + 1);
      const decision = decideReattribution(candidate, options);
      if (decision.flagged && decision.suspectedOwnerId) {
        const list = flaggedByPerson.get(candidate.currentPersonId) ?? [];
        list.push({
          assetFaceId: candidate.assetFaceId,
          currentPersonId: candidate.currentPersonId,
          suspectedOwnerId: decision.suspectedOwnerId,
        });
        flaggedByPerson.set(candidate.currentPersonId, list);
      } else if (
        !decision.flagged &&
        candidate.ownCount < options.minFaces &&
        candidate.topOtherPersonId !== null &&
        candidate.topOtherNearest !== null &&
        candidate.topOtherNearest <= options.maxAttributionDistance
      ) {
        unAttributableFaces.push({ assetFaceId: candidate.assetFaceId, currentPersonId: candidate.currentPersonId });
      }
    }

    const reviewOnlyPersonIds = new Set<string>();
    for (const [personId, eligible] of eligibleByPerson) {
      const flagged = flaggedByPerson.get(personId)?.length ?? 0;
      if (eligible > 0 && flagged / eligible > options.maxFlaggedFraction) {
        reviewOnlyPersonIds.add(personId);
      }
    }

    const toRepair: FlaggedFace[] = [];
    const reviewOnlyFaces: (FlaggedFace & { reason: ReviewOnlyReason })[] = [];
    for (const [personId, faces] of flaggedByPerson) {
      if (reviewOnlyPersonIds.has(personId)) {
        for (const face of faces) {
          reviewOnlyFaces.push({ ...face, reason: 'over-cap' });
        }
        continue;
      }
      for (const face of faces) {
        if (reviewOnlyPersonIds.has(face.suspectedOwnerId)) {
          reviewOnlyFaces.push({ ...face, reason: 'bad-target' });
        } else {
          toRepair.push(face);
        }
      }
    }

    const perPerson = [...eligibleByPerson].map(([personId, eligible]) => {
      const flagged = flaggedByPerson.get(personId)?.length ?? 0;
      return { personId, eligible, flagged, flaggedFraction: eligible > 0 ? flagged / eligible : 0 };
    });

    return { toRepair, reviewOnlyFaces, reviewOnlyPersonIds: [...reviewOnlyPersonIds], unAttributableFaces, perPerson };
  }

  async executeRepair(plan: RepairPlan): Promise<{ unassigned: number; requeued: number }> {
    const byPerson = new Map<string, string[]>();
    for (const face of plan.toRepair) {
      const list = byPerson.get(face.currentPersonId) ?? [];
      list.push(face.assetFaceId);
      byPerson.set(face.currentPersonId, list);
    }

    const unassignedIds: string[] = [];
    for (const [personId, assetFaceIds] of byPerson) {
      const ids = await this.faceRepairRepository.unassignFacesFromPerson(personId, assetFaceIds);
      unassignedIds.push(...ids);
    }

    if (unassignedIds.length === 0) {
      return { unassigned: 0, requeued: 0 };
    }

    await this.faceIdentityRepository.unlinkFaces(unassignedIds);
    await this.faceRepairRepository.reconcileRepresentativeFaces(byPerson.keys().toArray());
    await this.jobRepository.queueAll(
      unassignedIds.map((id) => ({ name: JobName.FacialRecognition, data: { id, deferred: false } })),
    );

    return { unassigned: unassignedIds.length, requeued: unassignedIds.length };
  }

  async runRepair(options: RunRepairOptions = {}): Promise<RunRepairResult> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    const recognition = machineLearning.facialRecognition;
    const dryRun = options.dryRun ?? true;

    const planOptions = {
      ownerId: options.ownerId,
      personId: options.personId,
      maxDistance: options.maxDistance ?? recognition.maxDistance,
      minFaces: options.minFaces ?? recognition.minFaces,
      voteWindow: options.voteWindow ?? DEFAULT_VOTE_WINDOW,
      voteMargin: options.voteMargin ?? DEFAULT_VOTE_MARGIN,
      maxAttributionDistance: options.maxAttributionDistance ?? DEFAULT_MAX_ATTRIBUTION_DISTANCE,
      maxFlaggedFraction: options.maxFlaggedFraction ?? DEFAULT_MAX_FLAGGED_FRACTION,
    };

    const plan = await this.buildRepairPlan(planOptions);

    let executed: { unassigned: number; requeued: number } | undefined;
    if (!dryRun) {
      if (await this.jobRepository.isActive(QueueName.FacialRecognition)) {
        throw new Error('Refusing to run face re-attribution repair while facial recognition is active');
      }
      executed = await this.executeRepair(plan);
    }

    return { dryRun, mutated: !dryRun, report: summarizeRepairPlan(plan), executed };
  }

  async *findReattributionCandidates(options: {
    ownerId?: string;
    personId?: string;
    maxDistance: number;
    voteWindow: number;
  }): AsyncIterableIterator<ReattributionCandidate> {
    for await (const face of this.faceRepairRepository.streamEligibleFaces(options)) {
      const matches = await this.searchRepository.searchFaces({
        userIds: [face.ownerId],
        embedding: face.embedding,
        maxDistance: options.maxDistance,
        numResults: options.voteWindow,
        hasPerson: true,
      });
      // searchFaces includes the query face itself — drop it by id.
      const neighbors = matches
        .filter((match) => match.id !== face.assetFaceId)
        .map((match) => ({ assetFaceId: match.id, personId: match.personId, distance: match.distance }));
      yield {
        assetFaceId: face.assetFaceId,
        currentPersonId: face.personId,
        ...tallyReattribution(face.personId, neighbors),
      };
    }
  }
}
