// A verdict target is addressed by one or more opaque tokens. A verdict recorded against an identity and a
// suspicion aimed at a person of that identity must match, which a bare id comparison cannot express — hence
// tokens rather than ids. Keep the prefixes stable: they are compared across engines.
export interface VerdictTarget {
  personGroupId?: string | null;
  spacePersonId?: string | null;
  identityId?: string | null;
}

export function targetTokens(target: VerdictTarget): string[] {
  const tokens: string[] = [];
  if (target.identityId) {
    tokens.push(`identity:${target.identityId}`);
  }
  if (target.personGroupId) {
    tokens.push(`person:${target.personGroupId}`);
  }
  if (target.spacePersonId) {
    tokens.push(`space-person:${target.spacePersonId}`);
  }
  return tokens;
}

export interface VerdictMaps {
  // Faces a human has already placed (face_identity_face.source='manual'). Owner-agnostic: a placed face is
  // dropped no matter which owner is suspected — this is what makes the age-gap childhood-photo case stop
  // re-flagging, and what stops a user's confirmed suggestion from being re-proposed to an admin.
  manualLinkedFaceIds?: Set<string>;
  // assetFaceId -> the target tokens a human has said this face does NOT belong to.
  negativeFaceTargets: Map<string, Set<string>>;
  // suspectedOwnerId -> that owner's tokens. Absent entries fall back to the bare person token, which is
  // what a caller that has no identity information should produce.
  ownerTokens?: Map<string, string[]>;
  // currentPersonId -> the suspected-owner fingerprint the console muted this cluster against.
  mutedPersons: Map<string, Set<string>>;
}

export interface ReattributionNeighbor {
  assetFaceId: string;
  personGroupId: string | null;
  distance: number;
}

export interface ReattributionTally {
  ownCount: number;
  ownNearest: number | null;
  topOtherPersonId: string | null;
  topOtherCount: number;
  topOtherNearest: number | null;
}

// Tally a face's already-self-excluded, within-maxDistance assigned neighbors by person.
export const tallyReattribution = (currentPersonId: string, neighbors: ReattributionNeighbor[]): ReattributionTally => {
  const byPerson = new Map<string, { count: number; nearest: number }>();
  for (const neighbor of neighbors) {
    if (!neighbor.personGroupId) {
      continue;
    }
    const entry = byPerson.get(neighbor.personGroupId);
    if (entry) {
      entry.count += 1;
      entry.nearest = Math.min(entry.nearest, neighbor.distance);
    } else {
      byPerson.set(neighbor.personGroupId, { count: 1, nearest: neighbor.distance });
    }
  }

  let topOtherPersonId: string | null = null;
  let topOtherCount = 0;
  let topOtherNearest: number | null = null;
  for (const [personGroupId, { count, nearest }] of byPerson) {
    if (personGroupId === currentPersonId) {
      continue;
    }
    const wins =
      count > topOtherCount ||
      (count === topOtherCount && nearest < (topOtherNearest ?? Infinity)) ||
      (count === topOtherCount && nearest === topOtherNearest && personGroupId < topOtherPersonId!);
    if (wins) {
      topOtherPersonId = personGroupId;
      topOtherCount = count;
      topOtherNearest = nearest;
    }
  }

  const own = byPerson.get(currentPersonId);
  return {
    ownCount: own?.count ?? 0,
    ownNearest: own?.nearest ?? null,
    topOtherPersonId,
    topOtherCount,
    topOtherNearest,
  };
};

export interface FlagParams {
  minFaces: number;
  voteMargin: number;
  maxAttributionDistance: number;
}

export interface FlagDecision {
  flagged: boolean;
  suspectedOwnerId: string | null;
}

// Decide whether a face should be re-attributed away from its current person. Flag only when a confident
// external owner Q exists — Q has >= minFaces neighbors of F AND Q's nearest neighbor is within
// maxAttributionDistance (absolute resemblance guard, measured to Q so co-located contamination on P cannot
// suppress it) — AND Q either out-votes P by voteMargin or P does not claim F (ownCount < minFaces). The vote
// margin is the family guard for genuine faces; the current-person distance is intentionally NOT used.
export const decideReattribution = (tally: ReattributionTally, params: FlagParams): FlagDecision => {
  const { topOtherPersonId, topOtherCount, topOtherNearest, ownCount } = tally;

  const confidentOther =
    topOtherPersonId !== null &&
    topOtherNearest !== null &&
    topOtherCount >= params.minFaces &&
    topOtherNearest <= params.maxAttributionDistance;
  if (!confidentOther) {
    return { flagged: false, suspectedOwnerId: null };
  }

  const flagged = topOtherCount - ownCount >= params.voteMargin || ownCount < params.minFaces;
  return { flagged, suspectedOwnerId: flagged ? topOtherPersonId : null };
};

// `resolve` (E7): a face may appear in at most one bucket (moveToPerson's flattened faceIds, stay, lock,
// detach). Returns the ids that appear in more than one bucket, so the caller can 400. Pure/reusable across
// slices — only moveToPerson carries real ids in Slice 1, but stay/lock/detach are already validated for
// disjointness so Slices 2/3/5 don't need to revisit this check.
export function findOverlappingIds(buckets: string[][]): string[] {
  const seenInBuckets = new Map<string, number>();
  for (const bucket of buckets) {
    for (const id of new Set(bucket)) {
      seenInBuckets.set(id, (seenInBuckets.get(id) ?? 0) + 1);
    }
  }
  return [...seenInBuckets].filter(([, count]) => count > 1).map(([id]) => id);
}

// `resolve` (E15): stay/lock/detach/moveToPerson ids must be members of the person's stored flagged-face
// snapshot (a rest-of-cluster face has no suspected owner and no "keep/lock/detach/move-to-owner" meaning).
// Returns the ids from `ids` that are NOT present in `resolvableIds`, so the caller can 400.
export function findUnresolvableIds(ids: string[], resolvableIds: ReadonlySet<string>): string[] {
  return ids.filter((id) => !resolvableIds.has(id));
}

export function isSubset(subset: Set<string>, superset: Set<string>): boolean {
  for (const value of subset) {
    if (!superset.has(value)) {
      return false;
    }
  }
  return true;
}

interface FlaggedLike {
  assetFaceId: string;
  currentPersonId: string;
  suspectedOwnerId: string;
}

// Is this (face, suspected owner) pairing already settled by a human? The single decision both face engines
// consult, kept pure so it is testable without a database.
//
//   - a human placement drops the face for EVERY suspected owner;
//   - a negative verdict drops it only for the owner it was recorded against, so a face kept away from Bob
//     can still be flagged toward Carol. Getting that scope wrong silently destroys the console's semantics.
export function isSettledForOwner(
  face: { assetFaceId: string; suspectedOwnerId: string },
  maps: Pick<VerdictMaps, 'manualLinkedFaceIds' | 'negativeFaceTargets' | 'ownerTokens'>,
): boolean {
  if (maps.manualLinkedFaceIds?.has(face.assetFaceId)) {
    return true;
  }
  const negatives = maps.negativeFaceTargets.get(face.assetFaceId);
  if (!negatives || negatives.size === 0) {
    return false;
  }
  const tokens = maps.ownerTokens?.get(face.suspectedOwnerId) ?? [`person:${face.suspectedOwnerId}`];
  return tokens.some((token) => negatives.has(token));
}

// Mutates flaggedByPerson in place. (0)+(1) drop every face already settled for its suspected owner — a human
// placement (owner-agnostic) or a negative verdict aimed at that owner. (2) person-level: if the cluster was
// muted and its REMAINING suspected-owner set is a subset of the stored fingerprint (no new evidence), drop
// the whole person. Per-face filtering runs before the person-level mute so a face re-flagged toward a NEW
// owner keeps its person surfaced.
export function applyVerdictFilters<T extends FlaggedLike>(flaggedByPerson: Map<string, T[]>, maps: VerdictMaps): void {
  for (const [personGroupId, faces] of flaggedByPerson) {
    const kept = faces.filter((face) => !isSettledForOwner(face, maps));
    const fingerprint = maps.mutedPersons.get(personGroupId);
    if (fingerprint && kept.length > 0) {
      const currentOwners = new Set(kept.map((face) => face.suspectedOwnerId));
      if (isSubset(currentOwners, fingerprint)) {
        flaggedByPerson.set(personGroupId, []);
        continue;
      }
    }
    flaggedByPerson.set(personGroupId, kept);
  }
}

export type ClassifyRecommendation = 'confident' | 'review-first';
export type ClassifyReason = 'over-cap' | 'named' | 'large-cluster' | 'multiple-owners' | 'bad-target';

export interface ClassifyPersonInput {
  personGroupId: string;
  personName: string | null; // null or '' (whitespace-only) = unnamed
  faceCount: number;
  suspectedOwnerIds: string[]; // owner person ids for this person's flagged faces (may repeat)
}

export interface ClassifyContext {
  reviewOnlyPersonIds: ReadonlySet<string>;
  largeClusterThreshold: number;
}

export interface ClassifyDecision {
  recommendation: ClassifyRecommendation;
  reviewReasons: ClassifyReason[];
}

// A flagged person is "review-first" if ANY reason applies; otherwise "confident". Reason order is fixed
// (over-cap → named → large-cluster → multiple-owners → bad-target) so output is deterministic.
// `over-cap` covers the person's OWN over-cap status: most/all of its faces are leaving, so approving it can
// empty the cluster — that must never happen via silent auto-select, only via explicit per-person review.
export const classifyFlaggedPerson = (person: ClassifyPersonInput, ctx: ClassifyContext): ClassifyDecision => {
  const reviewReasons: ClassifyReason[] = [];

  if (ctx.reviewOnlyPersonIds.has(person.personGroupId)) {
    reviewReasons.push('over-cap');
  }
  if (person.personName !== null && person.personName.trim() !== '') {
    reviewReasons.push('named');
  }
  if (person.faceCount > ctx.largeClusterThreshold) {
    reviewReasons.push('large-cluster');
  }
  const distinctOwners = new Set(person.suspectedOwnerIds);
  if (distinctOwners.size > 1) {
    reviewReasons.push('multiple-owners');
  }
  if ([...distinctOwners].some((ownerId) => ctx.reviewOnlyPersonIds.has(ownerId))) {
    reviewReasons.push('bad-target');
  }

  return { recommendation: reviewReasons.length > 0 ? 'review-first' : 'confident', reviewReasons };
};
