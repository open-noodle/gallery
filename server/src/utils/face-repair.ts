export interface ReattributionNeighbor {
  assetFaceId: string;
  personId: string | null;
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
    if (!neighbor.personId) {
      continue;
    }
    const entry = byPerson.get(neighbor.personId);
    if (entry) {
      entry.count += 1;
      entry.nearest = Math.min(entry.nearest, neighbor.distance);
    } else {
      byPerson.set(neighbor.personId, { count: 1, nearest: neighbor.distance });
    }
  }

  let topOtherPersonId: string | null = null;
  let topOtherCount = 0;
  let topOtherNearest: number | null = null;
  for (const [personId, { count, nearest }] of byPerson) {
    if (personId === currentPersonId) {
      continue;
    }
    const wins =
      count > topOtherCount ||
      (count === topOtherCount && nearest < (topOtherNearest ?? Infinity)) ||
      (count === topOtherCount && nearest === topOtherNearest && personId < topOtherPersonId!);
    if (wins) {
      topOtherPersonId = personId;
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
