import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AssetFace } from 'src/database';
import { OnJob } from 'src/decorators';
import { FaceRepairResolveRequest, FaceRepairResolveResponse, FaceRepairScanParams } from 'src/dtos/face-repair.dto';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { RepairScanPerson, RepairScanRow, ScanInProgressError } from 'src/repositories/face-repair-scan.repository';
import { OwnerPersonRow, PersonMetadataRow } from 'src/repositories/face-repair.repository';
import { BaseService } from 'src/services/base.service';
import { RepairReport, summarizeRepairPlan } from 'src/services/face-repair.summary';
import { JobOf } from 'src/types';
import {
  FlagParams,
  ReattributionTally,
  VerdictMaps,
  applyVerdictFilters,
  classifyFlaggedPerson,
  decideReattribution,
  findOverlappingIds,
  findUnresolvableIds,
  tallyReattribution,
} from 'src/utils/face-repair';
import { ImmichMediaResponse } from 'src/utils/file';
import { spaceVisibleAssetVisibilities } from 'src/utils/shared-space-album-scope';

export interface ReattributionCandidate extends ReattributionTally {
  assetFaceId: string;
  currentPersonId: string;
}

export interface FlaggedFace {
  assetFaceId: string;
  currentPersonId: string;
  suspectedOwnerId: string;
  // B2: whether this move writes the durable `manual` identity link. OMITTED MEANS TRUE — the scan's own
  // auto-repair path builds FlaggedFace without it and has always been durable. The interactive resolve
  // path threads the caller's MoveGroup.lock, which defaults to false. A `manual` link is the strongest
  // verdict in the system (both engines exclude such a face permanently), so writing it unconditionally
  // made every move a one-way door while the response reported `locked: 0`.
  lock?: boolean;
}

export type ReviewOnlyReason = 'over-cap' | 'bad-target';

export interface RepairPlan {
  toRepair: FlaggedFace[];
  reviewOnlyFaces: (FlaggedFace & { reason: ReviewOnlyReason })[];
  reviewOnlyPersonIds: string[];
  unAttributableFaces: { assetFaceId: string; currentPersonId: string }[];
  perPerson: { personId: string; eligible: number; flagged: number; flaggedFraction: number }[];
}

// Stable reason codes carried alongside a resolve's 400 message, for the failures an admin can genuinely hit
// through the console — every one of them means "the library moved under the page you are looking at".
// The message stays exactly as it was (English, developer-facing, asserted by tests); the code is what the web
// client keys its TRANSLATED banner off, so a German admin is not shown an English sentence. Codes are a
// contract with the client: rename one only together with `REASON_KEY_BY_CODE` in the review page.
// Failures the UI cannot produce (malformed buckets, cross-owner destinations) deliberately get no code — the
// client falls back to showing the raw server text, which is the right treatment for a client bug.
export const FaceRepairResolveErrorCode = {
  PersonNotFound: 'face-repair:person-not-found',
  DestinationMissing: 'face-repair:destination-missing',
  FacesNotInSnapshot: 'face-repair:faces-not-in-snapshot',
  FacesNotEligible: 'face-repair:faces-not-eligible',
} as const;

const DEFAULT_VOTE_WINDOW = 200;
const DEFAULT_VOTE_MARGIN = 2;
const DEFAULT_MAX_ATTRIBUTION_DISTANCE = 0.35;
const DEFAULT_MAX_FLAGGED_FRACTION = 0.5;
export const DEFAULT_LARGE_CLUSTER_THRESHOLD = 50;
// Page size for the move-to-chosen-person picker's owner-scoped people search (admin-scale, not tunable).
const OWNER_PEOPLE_PAGE_SIZE = 20;

const SCAN_PROGRESS_INTERVAL = 200;
// Keyset page size for the eligible-face scan (B6: paged, not a single streaming cursor) and the number of
// per-face ANN searches run concurrently within a page (B2: the scan was strictly serial — one round-trip per
// face with the DB core idle in between). 8 stays comfortably under the pg pool cap (max 10) with headroom for
// the page query and any concurrent work.
const SCAN_PAGE_SIZE = 500;
const SCAN_SEARCH_CONCURRENCY = 8;

// Map over items with a bounded number of concurrent workers, preserving input order in the result. Small local
// helper (no p-limit dependency) used to fan out the scan's per-face vector searches.
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const runWorker = async () => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return results;
}
// In-flight scans whose last heartbeat is older than this are considered lost (worker crash, Redis failure
// between row insert and enqueue) and failed, so they can't block new scans and applies forever.
const STALE_SCAN_TIMEOUT_MS = 30 * 60 * 1000;

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

export interface RepairExecution {
  moved: number;
  skipped: number;
  // Temporal-consistency hardening, Slice 3 (move-and-lock): every face id that ACTUALLY moved (i.e. was still
  // on its source person at write time — the same set `moved` counts), across every route. resolveFaces uses
  // this to lock only the faces a moveToPerson `lock: true` group actually moved, never a stale one that
  // turned out to have moved off the source before this call (M8) — an orphan lock on an untouched face would
  // be meaningless (locks are keyed to the destination the face is confirmed on).
  movedFaceIds: string[];
}

export interface RunRepairResult {
  dryRun: boolean;
  mutated: boolean;
  report: RepairReport;
  executed?: RepairExecution;
}

export { RepairReport } from 'src/services/face-repair.summary';

@Injectable()
export class FaceRepairService extends BaseService {
  // Delegates to the shared FaceVerdictService (Slice 3 extraction) — the suggestion engine's scan handlers
  // consult the SAME method via `this.faceVerdictService`, so a face a user confirmed or rejected is never
  // re-proposed to an admin, and vice versa. See FaceVerdictService.buildVerdictMaps for the implementation.
  private buildVerdictMaps(scope: {
    assetFaceIds: string[];
    personIds: string[];
    suspectedOwnerIds: string[];
  }): Promise<VerdictMaps> {
    return this.faceVerdictService.buildVerdictMaps(scope);
  }

  async buildRepairPlan(
    options: {
      ownerId?: string;
      personId?: string;
      personIds?: string[];
      approvedPersonIds?: string[];
      maxDistance: number;
      voteWindow: number;
      maxFlaggedFraction: number;
      onProgress?: (scanned: number) => Promise<void> | void;
    } & FlagParams,
  ): Promise<RepairPlan> {
    const eligibleByPerson = new Map<string, number>();
    const flaggedByPerson = new Map<string, FlaggedFace[]>();
    const unAttributableFaces: { assetFaceId: string; currentPersonId: string }[] = [];

    let scanned = 0;
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
      scanned++;
      await options.onProgress?.(scanned);
    }

    // Slice 4 (temporal-consistency hardening, req 5): bound the decline/lock load to exactly the faces/
    // persons this scan just flagged — an unscoped read re-fetches the whole (ever-growing) decline/lock
    // tables on every scan pass. Scope must be built from the pre-filter flaggedByPerson (not the post-filter
    // toRepair/reviewOnlyFaces below) so a decline/lock on any candidate face is still fetched even though its
    // whole purpose is to drop that very face.
    const flaggedFaceIds = flaggedByPerson
      .values()
      .toArray()
      .flat()
      .map((f) => f.assetFaceId);
    const flaggedPersonIds = flaggedByPerson.keys().toArray();
    const verdictMaps = await this.buildVerdictMaps({
      assetFaceIds: flaggedFaceIds,
      personIds: flaggedPersonIds,
      suspectedOwnerIds: flaggedByPerson
        .values()
        .toArray()
        .flat()
        .map((f) => f.suspectedOwnerId),
    });
    applyVerdictFilters(flaggedByPerson, verdictMaps);

    const reviewOnlyPersonIds = new Set<string>();
    for (const [personId, eligible] of eligibleByPerson) {
      const flagged = flaggedByPerson.get(personId)?.length ?? 0;
      if (eligible > 0 && flagged / eligible > options.maxFlaggedFraction) {
        reviewOnlyPersonIds.add(personId);
      }
    }

    const approved = new Set(options.approvedPersonIds);
    const toRepair: FlaggedFace[] = [];
    const reviewOnlyFaces: (FlaggedFace & { reason: ReviewOnlyReason })[] = [];
    for (const [personId, faces] of flaggedByPerson) {
      if (approved.has(personId)) {
        for (const face of faces) {
          toRepair.push(face); // approved: exempt from over-cap AND bad-target
        }
        continue;
      }
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

  // Directly re-attribute each flagged face to its detector-determined suspected owner, with a `manual`
  // identity link. This is the durable, intent-faithful move: it writes the destination the admin approved
  // (recognition never overrides a manual face, so it cannot boomerang back), and never re-queues
  // FacialRecognition (whose nearest-neighbour re-clustering routed unassigned faces straight back to the
  // original wrong person on contaminated clusters). A suspected owner deleted/merged since the scan is
  // skipped (never written), so a stale destination can never corrupt the apply.
  async executeRepair(plan: RepairPlan): Promise<RepairExecution> {
    // Group by (source person → destination owner) so the write-time re-check (still-on-source) holds per route.
    // The lock flag is part of the route key: a batch mixing locked and unlocked faces on the same
    // (from, to) pair must produce two writes, or one bucket silently inherits the other's durability.
    const routes = new Map<string, { from: string; to: string; lock: boolean; faceIds: string[] }>();
    for (const face of plan.toRepair) {
      const lock = face.lock ?? true;
      const key = `${face.currentPersonId}|${face.suspectedOwnerId}|${lock}`;
      const route = routes.get(key) ?? { from: face.currentPersonId, to: face.suspectedOwnerId, lock, faceIds: [] };
      route.faceIds.push(face.assetFaceId);
      routes.set(key, route);
    }

    let moved = 0;
    let skipped = 0;
    const movedFaceIds: string[] = [];
    const affectedPersonIds = new Set<string>();
    // Cache each person's owner (undefined = person no longer exists). Used both to skip a route whose
    // destination was deleted/merged since the plan was built AND to enforce the same-owner invariant below.
    const ownerOf = new Map<string, string | undefined>();
    const resolveOwner = async (id: string): Promise<string | undefined> => {
      if (!ownerOf.has(id)) {
        const person = await this.personRepository.getById(id);
        ownerOf.set(id, person?.ownerId);
      }
      return ownerOf.get(id);
    };

    for (const { from, to, lock, faceIds } of routes.values()) {
      const toOwner = await resolveOwner(to);
      if (toOwner === undefined) {
        skipped += faceIds.length; // destination person deleted/merged since the plan was built
        continue;
      }
      // C6 (defense-in-depth): never move a face across owners. resolveFaces already guards every interactive
      // destination up-front, but the write layer independently refuses a cross-owner route so no caller —
      // present or future (e.g. a shared-space-aware neighbour search) — can silently collapse two owners'
      // identities here. Every current caller is same-owner by construction, so this never fires today.
      const fromOwner = await resolveOwner(from);
      if (fromOwner !== toOwner) {
        skipped += faceIds.length;
        continue;
      }

      // Wrap the re-attribution and its identity relink in one transaction (A1). Without this a crash between
      // the two writes leaves a face on `to` still carrying `from`'s identity, which a later FaceIdentityBackfill
      // can resolve back to `from` and silently revert the approved move. One transaction makes the pair atomic.
      // Slice 9 (D14): the pending-queue drain for these faces is IN the same transaction — a moved face that
      // rolls back must not leave its suggestion queue row drained (and vice versa: a committed move must never
      // leave a stale pending row behind for a face that just left `from`).
      const movedIds = await this.databaseRepository.transaction(async (trx) => {
        const ids = await this.faceRepairRepository.reattributeFaces(from, to, faceIds, trx);
        if (ids.length > 0) {
          const identity = await this.faceIdentityRepository.ensurePersonIdentity(to, trx);
          await this.faceIdentityRepository.replaceFaceIdentities(
            // B2: the relink always happens — leaving the face on `to` while it still carries `from`'s
            // identity is the torn state FaceIdentityBackfill resolves back to `from`. Only the STRENGTH
            // is conditional: `manual` is the durable lock, `owner-person` is an ordinary placement that a
            // later scan may still question.
            { assetFaceIds: ids, identityId: identity.id, source: lock ? 'manual' : 'owner-person' },
            trx,
          );
          await this.facePersonVerdictRepository.drainPendingForFaces(ids, trx);
          // Slice 8 (F15): the move just stated a fact ("these faces ARE this person") that contradicts any
          // durable rejected/ignored row for this SAME destination (e.g. an earlier decline against `to`,
          // now overridden by this move). Scoped to `to` only — see clearNegativeForTarget.
          await this.facePersonVerdictRepository.clearNegativeForTarget(
            { personId: to, identityId: identity.id },
            ids,
            trx,
          );
        }
        return ids;
      });
      skipped += faceIds.length - movedIds.length;
      if (movedIds.length === 0) {
        continue;
      }
      moved += movedIds.length;
      movedFaceIds.push(...movedIds);
      affectedPersonIds.add(from);
      affectedPersonIds.add(to);
    }

    if (affectedPersonIds.size > 0) {
      const repointedIds = await this.faceRepairRepository.reconcileRepresentativeFaces([...affectedPersonIds]);
      // Regenerate thumbnails for persons whose representative face changed — without this the source person's
      // card keeps showing the crop of a face that just moved away (the very artifact this console fixes).
      if (repointedIds.length > 0) {
        await this.jobRepository.queueAll(
          repointedIds.map((id) => ({ name: JobName.PersonGenerateThumbnail, data: { id } })),
        );
      }
    }

    // Leak 3, batch path: a moved face is now assigned elsewhere, so any outstanding suggestion for it is
    // void. Drained per-route, inside each route's transaction above (Slice 9) — not here, and not
    // aggregated, so a route that rolls back never loses its drain and a route that commits never keeps one.

    return { moved, skipped, movedFaceIds };
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

    let executed: RepairExecution | undefined;
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
    personIds?: string[];
    maxDistance: number;
    voteWindow: number;
  }): AsyncIterableIterator<ReattributionCandidate> {
    // Keyset-paginate the eligible set (B6) and fan the per-face ANN searches out with bounded concurrency (B2)
    // rather than streaming a single cursor and awaiting one search at a time. Each page releases its DB
    // connection before the searches run, and the searches within a page run ~SCAN_SEARCH_CONCURRENCY at a time.
    let afterId: string | undefined;
    for (;;) {
      const page = await this.faceRepairRepository.getEligibleFacePage({
        ownerId: options.ownerId,
        personId: options.personId,
        personIds: options.personIds,
        afterId,
        limit: SCAN_PAGE_SIZE,
      });
      if (page.length === 0) {
        return;
      }
      const candidates = await mapWithConcurrency(page, SCAN_SEARCH_CONCURRENCY, async (face) => {
        const matches = await this.searchRepository.searchFaces({
          userIds: [face.ownerId],
          embedding: face.embedding,
          maxDistance: options.maxDistance,
          numResults: options.voteWindow,
          hasPerson: true,
          visibility: spaceVisibleAssetVisibilities,
        });
        // searchFaces includes the query face itself — drop it by id.
        const neighbors = matches
          .filter((match) => match.id !== face.assetFaceId)
          .map((match) => ({ assetFaceId: match.id, personId: match.personId, distance: match.distance }));
        return {
          assetFaceId: face.assetFaceId,
          currentPersonId: face.personId,
          ...tallyReattribution(face.personId, neighbors),
        };
      });
      for (const candidate of candidates) {
        yield candidate;
      }
      afterId = page.at(-1)!.assetFaceId;
      if (page.length < SCAN_PAGE_SIZE) {
        return;
      }
    }
  }

  async runScan(scanId: string): Promise<void> {
    await this.faceRepairScanRepository.updateScanProgress(scanId, { status: 'running', startedAt: new Date() });

    try {
      // Step 2: read stored scan params; fall back to config defaults if none
      const storedScan = await this.faceRepairScanRepository.getScanById(scanId);
      const { machineLearning } = await this.getConfig({ withCache: true });
      const recognition = machineLearning.facialRecognition;

      const storedParams = storedScan?.params as
        | {
            ownerId?: string;
            maxDistance?: number;
            minFaces?: number;
            voteWindow?: number;
            voteMargin?: number;
            maxAttributionDistance?: number;
            maxFlaggedFraction?: number;
            largeClusterThreshold?: number;
          }
        | undefined;

      const ownerId = storedParams?.ownerId;
      const maxDistance = storedParams?.maxDistance ?? recognition.maxDistance;
      const minFaces = storedParams?.minFaces ?? recognition.minFaces;
      const voteWindow = storedParams?.voteWindow ?? DEFAULT_VOTE_WINDOW;
      const voteMargin = storedParams?.voteMargin ?? DEFAULT_VOTE_MARGIN;
      const maxAttributionDistance = storedParams?.maxAttributionDistance ?? DEFAULT_MAX_ATTRIBUTION_DISTANCE;
      const maxFlaggedFraction = storedParams?.maxFlaggedFraction ?? DEFAULT_MAX_FLAGGED_FRACTION;
      const largeClusterThreshold = storedParams?.largeClusterThreshold ?? DEFAULT_LARGE_CLUSTER_THRESHOLD;

      // Step 3: count eligible faces for progress tracking
      const total = await this.faceRepairRepository.countEligibleFaces({ ownerId });

      // Step 4: build plan with progress callback (throttled every SCAN_PROGRESS_INTERVAL + final update)
      let lastReported = 0;
      const onProgress = async (scanned: number) => {
        if (!(scanned - lastReported >= SCAN_PROGRESS_INTERVAL || scanned >= total)) {
          return;
        }

        lastReported = scanned;
        await this.faceRepairScanRepository.updateScanProgress(scanId, { progress: { scanned, total } });
      };

      const plan = await this.buildRepairPlan({
        ownerId,
        maxDistance,
        voteWindow,
        minFaces,
        voteMargin,
        maxAttributionDistance,
        maxFlaggedFraction,
        onProgress,
      });

      // Final progress update after stream ends (fires even when total candidates < SCAN_PROGRESS_INTERVAL)
      const streamedCount = plan.perPerson.reduce((sum, p) => sum + p.eligible, 0);
      if (streamedCount !== lastReported) {
        await this.faceRepairScanRepository.updateScanProgress(scanId, {
          progress: { scanned: streamedCount, total },
        });
      }

      // Step 5: reviewOnlyPersonIds set
      const reviewOnlyPersonIds = new Set(plan.reviewOnlyPersonIds);

      // Step 6: group flagged faces by person to build suspectedOwnerIds per flagged person
      const allFlaggedFaces = [...plan.toRepair, ...plan.reviewOnlyFaces];
      const suspectedOwnersByPerson = new Map<string, string[]>();
      for (const face of allFlaggedFaces) {
        const owners = suspectedOwnersByPerson.get(face.currentPersonId) ?? [];
        owners.push(face.suspectedOwnerId);
        suspectedOwnersByPerson.set(face.currentPersonId, owners);
      }

      const enrichInput = plan.perPerson
        .filter((p) => p.flagged > 0)
        .map((p) => ({
          personId: p.personId,
          eligible: p.eligible,
          flagged: p.flagged,
          flaggedFraction: p.flaggedFraction,
          suspectedOwnerIds: suspectedOwnersByPerson.get(p.personId) ?? [],
        }));

      // Step 7: enrich with person metadata
      const enriched = await this.faceRepairScanRepository.enrichReportPersons(enrichInput);

      // Step 8: classify each flagged person and overwrite placeholder recommendation/reviewReasons
      for (const p of enriched) {
        const decision = classifyFlaggedPerson(
          {
            personId: p.personId,
            personName: p.personName,
            faceCount: p.faceCount,
            suspectedOwnerIds: p.suspectedOwners.map((o) => o.ownerPersonId),
          },
          { reviewOnlyPersonIds, largeClusterThreshold },
        );
        p.recommendation = decision.recommendation;
        p.reviewReasons = decision.reviewReasons;
      }

      // Step 9: compute totals
      const { totals } = summarizeRepairPlan(plan);

      // Step 10: persist flagged faces then mark scan completed
      await this.faceRepairScanRepository.replaceScanFlaggedFaces(
        scanId,
        allFlaggedFaces.map((f) => ({
          assetFaceId: f.assetFaceId,
          personId: f.currentPersonId,
          suspectedOwnerId: f.suspectedOwnerId,
        })),
      );
      await this.faceRepairScanRepository.completeScan(scanId, { totals, persons: enriched });

      // Step 11: prune old scans
      await this.faceRepairScanRepository.pruneSupersededScans();
    } catch (error) {
      await this.faceRepairScanRepository.failScan(scanId, String(error));
      throw error;
    }
  }

  @OnJob({ name: JobName.FaceRepairScan, queue: QueueName.BackgroundTask })
  async handleFaceRepairScan({ scanId }: JobOf<JobName.FaceRepairScan>): Promise<JobStatus> {
    await this.runScan(scanId);
    return JobStatus.Success;
  }

  async triggerScan(requestedBy: string, overrides?: FaceRepairScanParams): Promise<{ scanId: string }> {
    if (await this.jobRepository.isActive(QueueName.FacialRecognition)) {
      throw new ConflictException('Refusing to scan while facial recognition is active');
    }
    await this.faceRepairScanRepository.failStaleScans(STALE_SCAN_TIMEOUT_MS);
    const { machineLearning } = await this.getConfig({ withCache: true });
    const recognition = machineLearning.facialRecognition;
    const params = {
      maxDistance: overrides?.maxDistance ?? recognition.maxDistance,
      minFaces: overrides?.minFaces ?? recognition.minFaces,
      voteWindow: overrides?.voteWindow ?? DEFAULT_VOTE_WINDOW,
      voteMargin: overrides?.voteMargin ?? DEFAULT_VOTE_MARGIN,
      maxAttributionDistance: overrides?.maxAttributionDistance ?? DEFAULT_MAX_ATTRIBUTION_DISTANCE,
      maxFlaggedFraction: overrides?.maxFlaggedFraction ?? DEFAULT_MAX_FLAGGED_FRACTION,
      largeClusterThreshold: overrides?.largeClusterThreshold ?? DEFAULT_LARGE_CLUSTER_THRESHOLD,
    };
    let scan;
    try {
      scan = await this.faceRepairScanRepository.createScan({ requestedBy, params });
    } catch (error) {
      if (error instanceof ScanInProgressError) {
        throw new ConflictException(error.message);
      }
      throw error; // real DB failures must not masquerade as "scan already in progress"
    }
    await this.jobRepository.queue({ name: JobName.FaceRepairScan, data: { scanId: scan.id } });
    return { scanId: scan.id };
  }

  async getScanDefaults(): Promise<{ maxDistance: number; minFaces: number; maxFlaggedFraction: number }> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    const recognition = machineLearning.facialRecognition;
    return {
      maxDistance: recognition.maxDistance,
      minFaces: recognition.minFaces,
      maxFlaggedFraction: DEFAULT_MAX_FLAGGED_FRACTION,
    };
  }

  async getLatestScanStatus() {
    const scan = await this.faceRepairScanRepository.getLatestScan();
    if (!scan) {
      return null;
    }
    // Refresh display names/thumbnails from the live person table — people get named after a scan and the
    // persisted report is only a snapshot. Keeps the console legible without an expensive full re-scan.
    //
    // withCurrentNames adds ownerFaceCount/ownerMissing to each suspected owner; withLiveFlaggedCounts below
    // carries them through only via its `{ ...owner }` spread when it rebuilds suspectedOwners. Expanding
    // that spread into an explicit literal silently drops both fields (verified by hand: swapping the call
    // order alone does NOT reproduce the drop, because withCurrentNames re-adds the fields unconditionally
    // whichever pass runs last — the spread, not the order, is the load-bearing piece). Pinned by
    // face-repair.scan.spec.ts ("carries the destination overlay through the live flagged-count recompute").
    const withNames = await this.faceRepairScanRepository.withCurrentNames(scan);
    return this.withLiveFlaggedCounts(withNames);
  }

  // D12 (Slice 9): the persisted scan report's flagged counts are a point-in-time snapshot. A verdict
  // recorded AFTER the scan — a suggestion-side confirm/reject, or a cleanup keep-here/lock/detach on a
  // DIFFERENT person's review — never touches the scan row, so without this the dashboard would keep
  // showing an already-settled face as flagged until the next full re-scan. Recompute each person's
  // flagged/flaggedFraction/suspectedOwners[].count live by re-applying the exact same verdict filters
  // getPersonFlaggedFaces uses for a single person's review page, fanned out over every person the scan
  // flagged — one batched query plus one batched buildVerdictMaps per dashboard poll (R2: measured cheaper
  // than option (b), decrementing the persisted JSON counts at every verdict-write call site, which has no
  // reusable per-face-decrement primitive and would touch far more call sites than this one read path).
  // `eligible` (the denominator) is frozen at scan time — only how many of those eligible faces are STILL
  // flagged changes here.
  private async withLiveFlaggedCounts(scan: RepairScanRow): Promise<RepairScanRow> {
    const persons = (scan.persons ?? []) as unknown as RepairScanPerson[];
    if (persons.length === 0) {
      return scan;
    }

    const personIds = persons.map((p) => p.personId);
    const stored = await this.faceRepairScanRepository.getScanFlaggedFacesForPersons(scan.id, personIds);
    const verdictMaps = await this.buildVerdictMaps({
      personIds,
      assetFaceIds: stored.map((face) => face.assetFaceId),
      suspectedOwnerIds: stored.map((face) => face.suspectedOwnerId),
    });

    const byPerson = new Map<string, FlaggedFace[]>(personIds.map((id) => [id, []]));
    for (const face of stored) {
      byPerson.get(face.personId)?.push({
        assetFaceId: face.assetFaceId,
        currentPersonId: face.personId,
        suspectedOwnerId: face.suspectedOwnerId,
      });
    }
    applyVerdictFilters(byPerson, verdictMaps);

    const refreshed = persons
      .map((p) => {
        const surviving = byPerson.get(p.personId) ?? [];
        const countByOwner = new Map<string, number>();
        for (const face of surviving) {
          countByOwner.set(face.suspectedOwnerId, (countByOwner.get(face.suspectedOwnerId) ?? 0) + 1);
        }
        return {
          ...p,
          flagged: surviving.length,
          flaggedFraction: p.eligible > 0 ? surviving.length / p.eligible : 0,
          // `...owner` is what preserves the overlay fields withCurrentNames added (ownerFaceCount,
          // ownerMissing). Do not expand this into an explicit object literal — face-repair.scan.spec.ts
          // ("carries the destination overlay through the live flagged-count recompute") fails with
          // `ownerFaceCount: undefined` if this ever regresses.
          suspectedOwners: p.suspectedOwners
            .map((owner) => ({ ...owner, count: countByOwner.get(owner.ownerPersonId) ?? 0 }))
            .filter((owner) => owner.count > 0),
        };
      })
      .filter((p) => p.flagged > 0);

    return { ...scan, persons: refreshed as unknown as RepairScanRow['persons'] };
  }

  getClusterFaces(
    personId: string,
    options: { excludeFaceIds: string[]; page: number; size: number },
  ): Promise<{ faces: { assetFaceId: string }[]; total: number; hasMore: boolean }> {
    return this.faceRepairRepository.getClusterFacePage(personId, {
      excludeFaceIds: options.excludeFaceIds,
      limit: options.size,
      offset: options.page * options.size,
    });
  }

  async getPersonFlaggedFaces(
    personId: string,
  ): Promise<{ personId: string; flaggedFaces: { assetFaceId: string; suspectedOwnerId: string }[] }> {
    const latest = await this.faceRepairScanRepository.getLatestScan();
    if (!latest) {
      return { personId, flaggedFaces: [] };
    }
    const stored = await this.faceRepairScanRepository.getScanFlaggedFaces(latest.id, personId);
    const verdictMaps = await this.buildVerdictMaps({
      personIds: [personId],
      assetFaceIds: stored.map((s) => s.assetFaceId),
      suspectedOwnerIds: stored.map((s) => s.suspectedOwnerId),
    });
    const byPerson = new Map([
      [
        personId,
        stored.map((s) => ({
          assetFaceId: s.assetFaceId,
          currentPersonId: personId,
          suspectedOwnerId: s.suspectedOwnerId,
        })),
      ],
    ]);
    applyVerdictFilters(byPerson, verdictMaps);
    const flaggedFaces = (byPerson.get(personId) ?? []).map((f) => ({
      assetFaceId: f.assetFaceId,
      suspectedOwnerId: f.suspectedOwnerId,
    }));
    return { personId, flaggedFaces };
  }

  // Slice 3 (manual face review): the manual review page has no scan to derive personName/ownerId from, and
  // ownerId is what scopes the move-picker. Admin-gated at the controller; not owner-scoped here by design —
  // an admin must be able to look up any person, not just their own.
  async getPersonMetadata(personId: string): Promise<PersonMetadataRow> {
    const person = await this.faceRepairRepository.getPersonMetadata(personId);
    if (!person) {
      throw new NotFoundException('Person not found');
    }
    return person;
  }

  async createDeclines(input: {
    persons?: { personId: string; suspectedOwnerIds: string[] }[];
    declinedBy: string;
  }): Promise<{ created: number }> {
    const created = await this.faceRepairDeclineRepository.createClusterMutes(input);
    // Drain the muted persons from the latest scan snapshot so a dashboard reload no longer resurfaces them
    // (mirrors resolveFaces's unconditional drop-on-resolution).
    if (input.persons?.length) {
      await this.faceRepairScanRepository.removePersonsFromLatestScan(input.persons.map((p) => p.personId));
    }
    return { created };
  }

  async listDeclines() {
    const rows = await this.faceRepairDeclineRepository.listDeclines();
    return { declines: rows };
  }

  async removeDeclines(input: { ids?: string[] }): Promise<{ removed: number }> {
    const removed = await this.faceRepairDeclineRepository.removeClusterMutes(input);
    return { removed };
  }

  // Slice 7 (unified resolutions manage page): the union of every soft-decline AND lock, each tagged `kind` so
  // The resolutions manage page lists NEGATIVE verdicts only, from both engines — an admin's "keep here"
  // and a user's "that isn't Anna" are the same fact and are equally undoable here. Human PLACEMENTS are not
  // listed: the record is `face_identity_face.source='manual'`, which every ordinary face-editor reassignment
  // also writes, so a global list of them would be unbounded and meaningless. Un-confirming a placement is
  // offered per-person on the cleanup review page instead, where the set is bounded and the admin is actually
  // asking "why did this face disappear from my queue?".
  // Slice 11 (F23): unscoped (no owner/person filter), so this now paginates — see
  // FacePersonVerdictRepository.listNegativeVerdicts.
  async listResolutions(opts: { page: number; size: number }) {
    const { total, items } = await this.facePersonVerdictRepository.listNegativeVerdicts(opts);
    return { total, resolutions: items };
  }

  async removeResolutions(input: { verdictIds?: string[]; clusterMuteIds?: string[] }): Promise<{ removed: number }> {
    const [verdictRemoved, muteRemoved] = await Promise.all([
      (input.verdictIds?.length ?? 0) > 0
        ? this.facePersonVerdictRepository.removeVerdicts(input.verdictIds!)
        : Promise.resolve(0),
      (input.clusterMuteIds?.length ?? 0) > 0
        ? this.faceRepairDeclineRepository.removeClusterMutes({ ids: input.clusterMuteIds })
        : Promise.resolve(0),
    ]);
    return { removed: verdictRemoved + muteRemoved };
  }

  // Un-confirm a human placement so the next scan may flag the face again: downgrade its identity link from
  // 'manual' back to 'ml'. The link itself (which identity the face belongs to) is untouched — only the claim
  // that a human put it there.
  async unconfirmFaces(assetFaceIds: string[]): Promise<{ removed: number }> {
    if (assetFaceIds.length === 0) {
      return { removed: 0 };
    }
    const removed = await this.faceIdentityRepository.demoteManualFaceLinks(assetFaceIds);
    return { removed };
  }

  // Slice 1 of the full per-face resolution (docs/plans/2026-07-10-face-cleanup-full-resolution-design.md):
  // replaces the 2-state `apply` for a single reviewed person. Slice 2 wires the `stay` (soft-decline) bucket
  // on top of Slice 1's move-to-owner path; Slice 3 wires `lock` (durable, owner-agnostic confirm) on the same
  // raw-snapshot membership check; Slice 5 wires `detach` ("Not a face" — unassign + strip the identity link)
  // on the same raw-snapshot membership check; Slice 6 wires `entireCluster` (server-enumerated whole-cluster
  // move, mutually exclusive with the per-face buckets) — the old `apply` endpoint has since been retired.
  async resolveFaces(input: FaceRepairResolveRequest, resolvedBy: string): Promise<FaceRepairResolveResponse> {
    const { personId, moveToPerson, stay, lock, detach, unknown, entireCluster } = input;
    const moveFaceIds = moveToPerson.flatMap((group) => group.faceIds);

    // E12/M13: entireCluster (server-enumerated whole-cluster move) is mutually exclusive with every per-face
    // bucket — combining them is ambiguous (which wins for a face requested both ways?), so reject outright.
    // Pure input validation, so it runs before the person is ever touched.
    if (
      entireCluster &&
      (moveFaceIds.length > 0 || stay.length > 0 || lock.length > 0 || detach.length > 0 || unknown.length > 0)
    ) {
      throw new BadRequestException('entireCluster cannot be combined with per-face resolution buckets');
    }

    // E16/M19: an empty resolve (nothing to move/stay/lock/detach/unknown, and no entireCluster) must be
    // rejected outright rather than silently falling through to an unconditional drain — a plain 400, no side
    // effects. Pure input validation, so it runs before the person is ever touched (concurrency guards included).
    if (
      moveFaceIds.length === 0 &&
      stay.length === 0 &&
      lock.length === 0 &&
      detach.length === 0 &&
      unknown.length === 0 &&
      !entireCluster
    ) {
      throw new BadRequestException('Resolve request has no faces to act on');
    }

    // Guards reused verbatim from the now-retired applyRepair (C5), before any snapshot read.
    if (await this.jobRepository.isActive(QueueName.FacialRecognition)) {
      throw new ConflictException('Refusing to apply while facial recognition is active');
    }
    await this.faceRepairScanRepository.failStaleScans(STALE_SCAN_TIMEOUT_MS);
    const latest = await this.faceRepairScanRepository.getLatestScan();
    if (latest && (latest.status === 'pending' || latest.status === 'running')) {
      throw new ConflictException('Refusing to apply while a scan is in progress');
    }

    // E7/F14: a face may resolve only one way in a single request. Each moveToPerson group is its OWN bucket
    // here — flattening every group's faceIds into one bucket (as this used to) hides a face routed to two
    // different destinations, because findOverlappingIds only reports ids that repeat ACROSS buckets, and its
    // within-bucket de-duplication would silently absorb the collision into a single flattened bucket.
    const overlapping = findOverlappingIds([
      ...moveToPerson.map((group) => group.faceIds),
      stay,
      lock,
      detach,
      unknown,
    ]);
    if (overlapping.length > 0) {
      throw new BadRequestException('A face cannot be resolved more than one way in the same request');
    }

    // Slice 4 (M12/M20, E11/E18): every requested moveToPerson destination must exist and be owned by the
    // SAME user as the reviewed cluster — validated before any snapshot read or mutation, so a stale
    // (deleted/merged since the scan) or cross-owner destination 400s the whole resolve rather than
    // partially committing. The picker only ever lists the cluster owner's own people, but the server
    // independently re-validates: a destination can go stale between scan and resolve, and this also covers
    // any client that bypasses the picker. Slice 6 (M13) extends the same guard to entireCluster's
    // destination — it is just another destination the reviewed cluster's faces get routed to.
    if (moveToPerson.length > 0 || entireCluster) {
      const reviewedPerson = await this.personRepository.getById(personId);
      if (!reviewedPerson) {
        throw new BadRequestException({
          message: 'Reviewed person not found',
          code: FaceRepairResolveErrorCode.PersonNotFound,
        });
      }
      const destinationIds = new Set(moveToPerson.map((group) => group.destinationPersonId));
      if (entireCluster) {
        destinationIds.add(entireCluster.destinationPersonId);
      }
      for (const destinationId of destinationIds) {
        const destination = await this.personRepository.getById(destinationId);
        if (!destination) {
          throw new BadRequestException({
            message: `Destination person ${destinationId} does not exist`,
            code: FaceRepairResolveErrorCode.DestinationMissing,
          });
        }
        if (destination.ownerId !== reviewedPerson.ownerId) {
          throw new BadRequestException(`Destination person ${destinationId} is owned by a different user`);
        }
      }
    }

    // Read this person's stored flagged-face snapshot (per-face suspected owner) and apply the same
    // declined-since-scan filtering the review page uses (and the now-retired applyRepair used to).
    const stored = latest
      ? await this.faceRepairScanRepository.getScanFlaggedFacesForPersons(latest.id, [personId])
      : [];
    // Raw snapshot membership (E15/M14) — a face that was genuinely never flagged for this person has no
    // suspected owner and no keep/lock/detach meaning, and is rejected. This is intentionally NOT
    // decline-filtered: a face already declined toward its stored suspected owner is still a legitimate
    // re-stay target (M22/E20, idempotent via `createDeclines`'s ON CONFLICT DO NOTHING) — only moveToPerson
    // needs the decline-filtered view below, to silently skip rather than re-apply a declined pairing.
    const flaggedIds = new Set(stored.map((face) => face.assetFaceId));
    const snapshotOwnerByFace = new Map(stored.map((face) => [face.assetFaceId, face.suspectedOwnerId]));
    const verdictMaps = await this.buildVerdictMaps({
      personIds: [personId],
      assetFaceIds: stored.map((face) => face.assetFaceId),
      suspectedOwnerIds: stored.map((face) => face.suspectedOwnerId),
    });
    const byPerson = new Map<string, FlaggedFace[]>([
      [
        personId,
        stored.map((face) => ({
          assetFaceId: face.assetFaceId,
          currentPersonId: face.personId,
          suspectedOwnerId: face.suspectedOwnerId,
        })),
      ],
    ]);
    applyVerdictFilters(byPerson, verdictMaps);
    const resolvable = new Set((byPerson.get(personId) ?? []).map((face) => face.assetFaceId));

    // E15: only `stay` is snapshot-gated. It writes a negative verdict against the face's SUSPECTED owner,
    // read from the snapshot via snapshotOwnerByFace.get(id)! — with no snapshot row there is no owner to
    // record against, and the non-null assertion would yield undefined (500 / FK violation). lock, detach
    // and unknown are all meaningful for any face on this person (manual review): lock is gated on
    // eligibility instead (slice 1), and detach/unknown are person-scoped at the write layer.
    const unresolvable = findUnresolvableIds([...stay], flaggedIds);
    if (unresolvable.length > 0) {
      throw new BadRequestException({
        message: 'Some faces are not in the flagged snapshot for this person',
        code: FaceRepairResolveErrorCode.FacesNotInSnapshot,
      });
    }

    // `lock` writes through replaceFaceIdentities, which is keyed only by assetFaceId — no person scope and
    // an unconditional ON CONFLICT DO UPDATE. Snapshot membership used to prove the face was on this person;
    // with that gate lifted the check must be explicit, or a lock could re-point any face in the database
    // (including another user's) onto this person's identity.
    if (lock.length > 0) {
      const eligible = await this.faceRepairRepository.getEligibleFaceIdsForPerson(personId, lock);
      const ineligible = lock.filter((id) => !eligible.has(id));
      if (ineligible.length > 0) {
        throw new BadRequestException({
          message: 'Some faces are not eligible for this person',
          code: FaceRepairResolveErrorCode.FacesNotEligible,
        });
      }
    }

    // moveToPerson: a requested face no longer flagged here — moved off since the scan, or declined since
    // (E1/M9) — is silently skipped rather than rejected; executeRepair's own still-on-source re-check at
    // write time covers any remaining race between this read and the write.
    const toRepair: FlaggedFace[] = [];
    let preSkipped = 0;
    for (const group of moveToPerson) {
      for (const assetFaceId of group.faceIds) {
        const isFlagged = flaggedIds.has(assetFaceId);
        // Pre-skip a flagged face only when this move re-applies a pairing the admin already settled: the face
        // is locked (owner-agnostic confirm), or it was declined toward THIS SAME destination. A face declined
        // toward a different owner is a NEW pairing — the admin deliberately picked another destination — and
        // must be honored. (Keying the skip on "declined at all" silently swallowed such deliberate moves.)
        const destinationTokens = verdictMaps.ownerTokens?.get(group.destinationPersonId) ?? [
          `person:${group.destinationPersonId}`,
        ];
        const negatives = verdictMaps.negativeFaceTargets.get(assetFaceId);
        const declinedTowardDestination = destinationTokens.some((token) => negatives?.has(token) ?? false);
        const locked = verdictMaps.manualLinkedFaceIds?.has(assetFaceId) ?? false;
        if (isFlagged && (locked || declinedTowardDestination)) {
          preSkipped++;
        } else {
          // Either an actionable flagged face, or a non-flagged rest-of-cluster face (§5.3: moveToPerson
          // accepts any eligible face currently on personId). executeRepair's still-on-source re-check at
          // write time skips anything not actually on personId, so no separate eligibility check is needed here.
          toRepair.push({
            assetFaceId,
            currentPersonId: personId,
            suspectedOwnerId: group.destinationPersonId,
            lock: group.lock,
          });
        }
      }
    }

    // entireCluster (Slice 6, M13/E12): enumerate every eligible face of `personId` server-side — no client
    // paging — and route each to destinationPersonId. Not gated on the flagged snapshot/`resolvable` set above:
    // a whole-cluster move also drains rest-of-cluster faces the admin never had individually flagged. This is
    // exclusive with the per-face buckets (rejected above), so `toRepair` is still empty at this point.
    if (entireCluster) {
      const clusterFaceIds = await this.collectClusterFaceIds(personId);
      for (const assetFaceId of clusterFaceIds) {
        // `entireCluster` carries no lock field by design — PersonPicker hides the toggle for a whole-cluster
        // move "rather than showing a toggle its request cannot carry". Omitting `lock` falls through to the
        // durable default, preserving today's behaviour; only buckets whose caller expressed a preference change.
        toRepair.push({ assetFaceId, currentPersonId: personId, suspectedOwnerId: entireCluster.destinationPersonId });
      }
    }

    const result = await this.executeRepair({
      toRepair,
      reviewOnlyFaces: [],
      reviewOnlyPersonIds: [],
      unAttributableFaces: [],
      perPerson: [],
    });

    // Move-and-lock: nothing extra to persist. For a group that asked to lock, executeRepair already wrote
    // the moved faces' `face_identity_face` link with `source='manual'`, and that link IS the lock —
    // owner-agnostic, keyed by identity so it survives a merge, and replaced (never duplicated) if a human
    // moves the face again. B2: a group with `lock: false` gets `source='owner-person'` instead and is
    // deliberately NOT counted here, so this tally reflects durable locks only.
    const movedSet = new Set(result.movedFaceIds);
    const moveLocked = moveToPerson
      .filter((group) => group.lock)
      .reduce((total, group) => total + group.faceIds.filter((id) => movedSet.has(id)).length, 0);

    // Soft-stay (M4, state 3): write a durable decline against each stayed face's OWN stored suspected owner
    // (never one shared owner — a mixed cluster can point faces at different owners). `createDeclines` is
    // idempotent via its `(assetFaceId, suspectedOwnerId)` ON CONFLICT DO NOTHING, so re-staying an
    // already-declined pairing is a no-op here (M22/E20) rather than a unique-violation.
    // A stay face whose scan-suggested owner was deleted or merged away since the scan carries a dangling
    // suspectedOwnerId (the flagged snapshot stores it as a bare uuid, no person FK). Writing a decline against
    // it would violate the decline table's person FK (23503) and 500 the whole resolve — after any moveToPerson
    // faces above already committed. Such a face is already effectively "kept": the owner it would have moved to
    // is gone, so it can never be re-flagged toward that owner. Drop it from the decline write; it still counts
    // as settled for the drain check below (settledFaceIds includes the raw `stay` bucket).
    let declined = 0;
    if (stay.length > 0) {
      const liveOwnerIds = new Set<string>();
      for (const ownerId of new Set(stay.map((assetFaceId) => snapshotOwnerByFace.get(assetFaceId)!))) {
        if (await this.personRepository.getById(ownerId)) {
          liveOwnerIds.add(ownerId);
        }
      }
      const declineFaces = stay
        .map((assetFaceId) => ({ assetFaceId, suspectedOwnerId: snapshotOwnerByFace.get(assetFaceId)! }))
        .filter((face) => liveOwnerIds.has(face.suspectedOwnerId));
      // "Keep here" states a fact about a (face, human) pairing, so it goes in the shared verdict layer where
      // the suggestion engine can see it too: if this face is later unassigned, it must not be proposed as
      // that same person.
      const ownerTokens = await this.faceIdentityRepository.getPersonVerdictTokens([...liveOwnerIds]);
      // Slice 7 (F12): the decline write and its pending-queue drain are wrapped in one transaction — this
      // bucket used to be two separate autocommit statements, so a failure between them (or mid-chunk inside
      // markRejectedMany's own chunk loop) could record a partial "keep here". Same shape as `lock` and
      // `detach` below. `markRejectedMany` threads `trx` through every one of its internal chunks, so the
      // whole multi-chunk write is one atomic unit, not just its last statement.
      await this.databaseRepository.transaction(async (trx) => {
        // One chunked multi-row upsert, not one round-trip per face: `stay` is bounded by the resolve DTO's
        // 25 000-face cap, and a per-face loop at that size is a request that times out rather than applies.
        declined = await this.facePersonVerdictRepository.markRejectedMany(
          declineFaces.map((face) => ({
            personId: face.suspectedOwnerId,
            assetFaceId: face.assetFaceId,
            identityId:
              ownerTokens
                .get(face.suspectedOwnerId)
                ?.find((token) => token.startsWith('identity:'))
                ?.slice('identity:'.length) ?? null,
          })),
          { source: 'cleanup', actorId: resolvedBy },
          trx,
        );
        // Slice 9 (D14/leak 3): a stayed face is settled — drain ANY still-pending suggestion row for it
        // (not just the (suspectedOwnerId, face) pairing markRejected above just resolved), same as the
        // aggregate drain used to before it was split per-bucket. Scoped to the raw `stay` bucket, not
        // `declineFaces` — a dangling-owner stay still counts as settled even though no decline was written
        // for it (see the comment above).
        await this.facePersonVerdictRepository.drainPendingForFaces(stay, trx);
      });
    }

    // Confirm/lock (Slice 3, state 4): durably, owner-agnostically lock each `lock`-bucket face to this
    // reviewed person. `insertLocks` is idempotent via the plain unique index on assetFaceId — re-locking an
    // already-locked face (even one whose flaggedIds membership above passed via a stale/declined snapshot row)
    // is a silent no-op, never a unique-violation. Summed with `moveLocked` (temporal-consistency hardening,
    // Slice 3): a single resolve can both stand-alone-lock some faces AND move-and-lock others.
    // Confirm/lock (state 4): re-affirm the face's CURRENT placement as a human one. The face already sits on
    // `personId`; marking its identity link `source='manual'` records that a human confirmed it there, which
    // is exactly what stops every future scan from suspecting it toward any owner — the age-gap case. Same
    // record a move writes, so there is one notion of "settled", not two.
    // Slice 9 (D14): the identity relink and its pending-queue drain are wrapped in one transaction — this
    // bucket was previously unwrapped (a torn-pair gap of the same class A1/executeRepair already closes): a
    // crash between the two writes could leave a face locked without its stale suggestion drained, or (were
    // the write ORDER ever reversed) a drained face without its lock link. Same shape as executeRepair's
    // per-route transaction and `detach` below.
    let locked = moveLocked;
    if (lock.length > 0) {
      const lockedIds = await this.databaseRepository.transaction(async (trx) => {
        const identity = await this.faceIdentityRepository.ensurePersonIdentity(personId, trx);
        // H5: `requirePersonId` re-checks placement INSIDE this transaction. getEligibleFaceIdsForPerson
        // ran outside it and calls itself advisory; without a write-time guard a concurrent reassign left
        // the face on the other person while its identity was re-pointed here — the exact torn state the
        // move and detach paths transact against.
        const writtenIds = await this.faceIdentityRepository.replaceFaceIdentities(
          {
            assetFaceIds: lock,
            identityId: identity.id,
            source: 'manual',
            requirePersonId: personId,
          },
          trx,
        );
        // Scoped to what was actually written: a face that raced away must not have its queue drained or
        // its negatives cleared for a lock that never happened.
        await this.facePersonVerdictRepository.drainPendingForFaces(writtenIds, trx);
        // Slice 8 (F15): the lock just re-affirmed a fact ("these faces ARE this reviewed person") that
        // contradicts any durable rejected/ignored row for this SAME person — see clearNegativeForTarget.
        await this.facePersonVerdictRepository.clearNegativeForTarget(
          { personId, identityId: identity.id },
          writtenIds,
          trx,
        );
        return writtenIds;
      });
      // Count rows actually written, not ids requested — a duplicate id or a raced face used to inflate this.
      locked += lockedIds.length;
    }

    // Detach (Slice 5, state 5, "Not a face"): unassign each detached face from this person AND strip its
    // identity link, atomically — wrapped in one transaction so a crash between the two writes can never leave
    // a stripped-identity face still on this person (which a later FaceIdentityBackfill would silently re-link
    // right back onto it, the E4 regression). Placed BEFORE the empty-unnamed cleanup below: detaching every
    // remaining face can itself empty the person, and that cleanup must see the post-detach state.
    // Slice 9 (D14): the pending-queue drain joins the same transaction — a detached face's stale suggestion
    // must clear iff the detach itself commits.
    const detachedIds =
      detach.length > 0
        ? await this.databaseRepository.transaction(async (trx) => {
            const ids = await this.faceRepairRepository.detachFaces(personId, detach, trx);
            if (ids.length > 0) {
              await this.facePersonVerdictRepository.drainPendingForFaces(ids, trx);
            }
            return ids;
          })
        : [];
    if (detachedIds.length > 0) {
      const repointedIds = await this.faceRepairRepository.reconcileRepresentativeFaces([personId]);
      // E19/M21: regenerate the person's thumbnail if the detached crop was its representative face — mirrors
      // executeRepair's own representative-thumbnail regen for the move path, so a detached "not a face" crop
      // never lingers as the person's avatar.
      if (repointedIds.length > 0) {
        await this.jobRepository.queueAll(
          repointedIds.map((id) => ({ name: JobName.PersonGenerateThumbnail, data: { id } })),
        );
      }
    }

    // "Unknown person" (state 6): the admin knows the face does not belong to this cluster but cannot name whose
    // it is — the standard case when an admin reviews someone else's library and hits a friend of the family.
    // Park each such face in a FRESH unnamed person of its own and lock it there.
    //
    // Why a new person rather than simply unassigning the face back to the "unknown pool" the admin has in mind?
    // Because that pool is not a parking lot — it is the input queue of the very clustering that mis-assigned the
    // face. PersonService.queueRecognizeFaces streams every `personId IS NULL` face back through
    // FacialRecognition, which re-matches it by embedding and assigns it to its nearest neighbour that HAS a
    // person; for a face being pulled out of a mixed cluster, that neighbour is very often the cluster it just
    // left. A bare unassign would therefore boomerang. Giving the face a person of its own is what makes the
    // decision stick: handleRecognizeFaces early-returns on a face that already has a person, and the lock stops
    // the next cleanup scan re-flagging it. The face still surfaces as an unnamed cluster on the People page, so
    // the library's owner — or face-recognition suggestions — can name or merge it later, which is exactly the
    // decision the admin is deferring.
    //
    // One new cluster per resolve, not one per face: the admin selects the faces they believe are the same
    // unknown person and parks them together, so they can be named in a single go later.
    let unknownParked = 0;
    let unknownSkipped = 0;
    if (unknown.length > 0) {
      const reviewedPerson = await this.personRepository.getById(personId);
      if (!reviewedPerson) {
        throw new BadRequestException({
          message: 'Reviewed person not found',
          code: FaceRepairResolveErrorCode.PersonNotFound,
        });
      }
      const cluster = await this.personRepository.create({ ownerId: reviewedPerson.ownerId });
      try {
        const parked = await this.executeRepair({
          toRepair: unknown.map((assetFaceId) => ({
            assetFaceId,
            currentPersonId: personId,
            suspectedOwnerId: cluster.id,
          })),
          reviewOnlyFaces: [],
          reviewOnlyPersonIds: [],
          unAttributableFaces: [],
          perPerson: [],
        });
        unknownParked = parked.moved;
        unknownSkipped = parked.skipped;
        // The reattribution onto the new cluster already wrote each moved face's identity link with
        // source='manual', which is the settled record — no separate lock write is needed.
        if (parked.movedFaceIds.length === 0) {
          // Every requested face turned out stale (moved off this person between the snapshot read and the
          // write), so executeRepair moved nothing and the cluster we just created would linger as an empty,
          // nameless person on the People page.
          await this.personRepository.delete([cluster.id]);
        }
      } catch (error) {
        // The cluster is created BEFORE the faces are moved into it, so any failure in between (a dropped
        // connection mid-reattribution, a lock insert that blows up) would otherwise strand a nameless, faceless
        // person on the owner's People page — permanently, since nothing else ever cleans it up.
        //
        // Only remove it if it is genuinely EMPTY. `asset_face.personId` is ON DELETE SET NULL, so deleting a
        // cluster that did receive faces would unassign them — dumping them straight back into the recognition
        // pool this action exists to keep them out of. A partially-succeeded park leaves the faces safely on the
        // cluster and the error surfaces to the admin, who can retry.
        const parkedFaces = await this.faceRepairRepository.countAllFaces(cluster.id);
        if (parkedFaces === 0) {
          await this.personRepository.delete([cluster.id]);
        }
        throw error;
      }
    }

    // Empty-unnamed cleanup, reused from the now-retired applyRepair's manual-move cleanup (A2): only delete a
    // source with ZERO remaining faces of any kind, and only when it was never named.
    const remaining = await this.faceRepairRepository.countEligibleFaces({ personId });
    if (remaining === 0) {
      const source = await this.personRepository.getById(personId);
      if (source && (!source.name || source.name.trim().length === 0)) {
        const remainingAll = await this.faceRepairRepository.countAllFaces(personId);
        if (remainingAll === 0) {
          await this.personRepository.delete([personId]);
        }
      }
    }

    // Drop-on-SETTLED-resolution (C5, E13). A committed resolve drains the person from the console even when
    // every flagged face was kept/stayed (zero moves) — the M11 stay-only case — because a kept face IS a
    // settled face. What it must NOT do is drain on a resolve that settled *none* of the flagged snapshot: a
    // move of rest-of-cluster faces alone (faces the scan never flagged) would otherwise drop the person while
    // every flagged face was still awaiting a decision, silently discarding the admin's staged review and
    // handing the same faces back on the next scan. `entireCluster` always drains — it moves the whole cluster,
    // flagged faces included. moveToPerson destinations only ever gain faces from this call, so there is no
    // destination to additionally drain.
    const settledFaceIds = new Set([...moveFaceIds, ...stay, ...lock, ...detach, ...unknown]);

    // Leak 3: a terminally-resolved face must leave no stale pending suggestion behind. A moved face is now
    // assigned elsewhere, a detached face is tombstoned, a confirmed/kept face is settled — in every case an
    // outstanding "is this <face> <person>?" suggestion is void. Slice 9 (D14): drained per-bucket, inside
    // each bucket's own transaction, above — `move`/`unknown` via executeRepair's per-route transaction,
    // `stay` alongside its decline write, `lock` and `detach` alongside their identity-link writes — rather
    // than aggregated here after the fact, so a bucket that rolls back never loses its drain and a bucket
    // that commits never keeps a stale one. (Slice 7/F12: `stay` used to be two separate autocommit
    // statements despite this comment already claiming otherwise — it is now genuinely wrapped, above.)
    // Compare against `resolvable` (the decline/lock-filtered pending set the review page shows), NOT the raw
    // `flaggedIds`: a face declined or locked in a PRIOR resolve is already settled and is filtered out of the
    // review UI, so the admin can never re-submit it here — measuring the drain against the raw snapshot would
    // strand a partially-resolved person in the console with a nonzero flagged count that can never clear.
    const settlesFlaggedSnapshot = [...resolvable].every((assetFaceId) => settledFaceIds.has(assetFaceId));
    if (entireCluster || settlesFlaggedSnapshot) {
      await this.faceRepairScanRepository.removePersonsFromLatestScan([personId]);
    }

    return {
      moved: result.moved,
      declined,
      locked,
      detached: detachedIds.length,
      unknown: unknownParked,
      skipped: result.skipped + preSkipped + unknownSkipped,
    };
  }

  // Owner-scoped people search for the move-to-chosen-person picker (Slice 4, M17). `ownerId` comes from the
  // route (the reviewed cluster's owner), never from the calling admin — Immich's own `getAllPeople` is
  // self-scoped and cannot serve an admin browsing another user's people.
  async searchOwnerPeople(
    ownerId: string,
    options: { query?: string; page: number },
  ): Promise<{ people: OwnerPersonRow[]; total: number; hasMore: boolean }> {
    return this.faceRepairRepository.searchOwnerPeople(ownerId, {
      query: options.query,
      page: options.page,
      size: OWNER_PEOPLE_PAGE_SIZE,
    });
  }

  // Create a new person under `ownerId` for the move-to-chosen-person picker's "Create new person" row
  // (Slice 4, M18). The returned id is immediately usable as a `moveToPerson[].destinationPersonId` for a
  // face owned by the same user — it passes the cross-owner guard above by construction.
  async createOwnerPerson(ownerId: string, name: string): Promise<{ id: string }> {
    const person = await this.personRepository.create({ ownerId, name });
    return { id: person.id };
  }

  // Slice 7 (D7): admin cleanup + resolutions surfaces render face crops for clusters the admin does not own.
  // Join-free, tombstone-inclusive read — no person join, no ownership check (the whole controller is
  // admin-gated by design). Serves the crop for ANY asset_face row, including tombstoned ones (the "not a
  // face" action sets deletedAt but keeps boundingBox/dims, and resolutions history must still render them).
  async getAdminFaceThumbnail(assetFaceId: string): Promise<ImmichMediaResponse> {
    let face: AssetFace;
    try {
      face = await this.personRepository.getFaceByIdIncludingTombstoned(assetFaceId);
    } catch {
      throw new NotFoundException();
    }

    const sourcePath = await this.getFaceThumbnailSource(face.assetId);
    if (!sourcePath) {
      throw new NotFoundException();
    }

    return this.generateFaceThumbnailResponse(face, sourcePath);
  }

  private async collectClusterFaceIds(personId: string): Promise<string[]> {
    const ids: string[] = [];
    for await (const row of this.faceRepairRepository.streamEligibleFaces({ personId })) {
      ids.push(row.assetFaceId);
    }
    return ids;
  }
}
