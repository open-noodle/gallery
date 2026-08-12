import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository';
import { FaceRepairDeclineRepository } from 'src/repositories/face-repair-decline.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { VerdictMaps } from 'src/utils/face-repair';

export interface FaceVerdictServiceDependencies {
  faceIdentityRepository: FaceIdentityRepository;
  facePersonVerdictRepository: FacePersonVerdictRepository;
  faceRepairDeclineRepository: FaceRepairDeclineRepository;
  logger: LoggingRepository;
}

// Plain class (not @Injectable, not a repository), built once in BaseService's constructor and shared as
// `this.faceVerdictService` — the same cross-service-sharing pattern IdentityMergePropagationService already
// uses. This is the join point of the two face features: the suggestion side's negative verdicts and the
// human-placement record (manual identity links) are consulted here, so a face a user confirmed or rejected
// is never re-proposed to an admin, and vice versa (D3, docs/superpowers/plans/
// 2026-07-23-face-verdict-remediation-slice-3.md).
export class FaceVerdictService {
  constructor(private deps: FaceVerdictServiceDependencies) {}

  // Assemble the shared exclusion inputs for a bounded set of flagged faces. Every source is scoped to the
  // ids this scan actually produced — never an unscoped table read.
  //
  // This is the join point of the two face features: the suggestion side's negative verdicts and the
  // human-placement record are consulted here, so a face a user confirmed or rejected is never re-proposed
  // to an admin, and vice versa. Moved verbatim from FaceRepairService (Slice 3 extraction) — FaceRepairService
  // now delegates to this method, behaviour-neutral.
  async buildVerdictMaps(scope: {
    assetFaceIds: string[];
    personIds: string[];
    suspectedOwnerIds: string[];
  }): Promise<VerdictMaps> {
    const uniqueFaceIds = [...new Set(scope.assetFaceIds)];
    const uniqueOwnerIds = [...new Set(scope.suspectedOwnerIds)];

    const [manualLinkedFaceIds, negativeFaceTargets, ownerTokens, mutedPersons] = await Promise.all([
      this.deps.faceIdentityRepository.getManualLinkedFaceIds(uniqueFaceIds),
      this.deps.facePersonVerdictRepository.getNegativeVerdictTokens(uniqueFaceIds),
      this.deps.faceIdentityRepository.getPersonVerdictTokens(uniqueOwnerIds),
      this.deps.faceRepairDeclineRepository.getClusterMuteMap(scope.personIds),
    ]);

    return { manualLinkedFaceIds, negativeFaceTargets, ownerTokens, mutedPersons };
  }

  // Narrow inputs for the suggestion engine — no cluster-mute / owner-token machinery, just the two checks a
  // scan write needs before proposing a candidate face: is it already placed by a human, and has a human
  // already said "not this person/identity" about it.
  async getFaceSettlementInputs(
    assetFaceIds: string[],
  ): Promise<{ manualLinkedFaceIds: Set<string>; negativeFaceTargets: Map<string, Set<string>> }> {
    const unique = [...new Set(assetFaceIds)];
    if (unique.length === 0) {
      return { manualLinkedFaceIds: new Set(), negativeFaceTargets: new Map() };
    }
    const [manualLinkedFaceIds, negativeFaceTargets] = await Promise.all([
      this.deps.faceIdentityRepository.getManualLinkedFaceIds(unique),
      this.deps.facePersonVerdictRepository.getNegativeVerdictTokens(unique),
    ]);
    return { manualLinkedFaceIds, negativeFaceTargets };
  }
}
