import { FlaggedFace, RepairPlan } from 'src/services/face-repair.service';

export interface SuspectedOwnerCount {
  ownerPersonId: string;
  count: number;
}

export interface RepairReportPerson {
  personId: string;
  eligible: number;
  flagged: number;
  flaggedFraction: number;
  reviewOnly: boolean;
  suspectedOwners: SuspectedOwnerCount[];
}

export interface RepairReport {
  totals: {
    eligibleFaces: number;
    flaggedFaces: number;
    toRepair: number;
    reviewOnlyFaces: number;
    reviewOnlyPersons: number;
    affectedPersons: number;
    reviewOnlyByReason: { overCap: number; badTarget: number; unAttributable: number };
  };
  persons: RepairReportPerson[];
}

export const summarizeRepairPlan = (plan: RepairPlan): RepairReport => {
  const reviewOnlyPersons = new Set(plan.reviewOnlyPersonIds);
  const allFlagged: FlaggedFace[] = [...plan.toRepair, ...plan.reviewOnlyFaces];

  const ownersByPerson = new Map<string, Map<string, number>>();
  for (const face of allFlagged) {
    const owners = ownersByPerson.get(face.currentPersonId) ?? new Map<string, number>();
    owners.set(face.suspectedOwnerId, (owners.get(face.suspectedOwnerId) ?? 0) + 1);
    ownersByPerson.set(face.currentPersonId, owners);
  }

  const persons: RepairReportPerson[] = plan.perPerson
    .filter((p) => p.flagged > 0)
    .map((p) => ({
      personId: p.personGroupId,
      eligible: p.eligible,
      flagged: p.flagged,
      flaggedFraction: p.flaggedFraction,
      reviewOnly: reviewOnlyPersons.has(p.personGroupId),
      suspectedOwners: [...(ownersByPerson.get(p.personGroupId) ?? new Map<string, number>())].map(
        ([ownerPersonId, count]) => ({ ownerPersonId, count }),
      ),
    }));

  const overCap = plan.reviewOnlyFaces.filter((f) => f.reason === 'over-cap').length;
  const badTarget = plan.reviewOnlyFaces.filter((f) => f.reason === 'bad-target').length;

  return {
    totals: {
      eligibleFaces: plan.perPerson.reduce((sum, p) => sum + p.eligible, 0),
      flaggedFaces: allFlagged.length,
      toRepair: plan.toRepair.length,
      reviewOnlyFaces: plan.reviewOnlyFaces.length,
      reviewOnlyPersons: plan.reviewOnlyPersonIds.length,
      affectedPersons: persons.length,
      reviewOnlyByReason: { overCap, badTarget, unAttributable: plan.unAttributableFaces.length },
    },
    persons,
  };
};
