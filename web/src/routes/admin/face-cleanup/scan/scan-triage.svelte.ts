import { SvelteSet } from 'svelte/reactivity';
import type { SuspectedOwner } from '../[personId]/destination';

// Moved verbatim from the deleted face-cleanup.svelte.ts model — the row shape the scan snapshot's persons
// deserialise into.
export interface FaceCleanupPerson {
  personId: string;
  ownerId: string;
  personName: string | null;
  faceCount: number;
  thumbnailFaceId: string | null;
  eligible: number;
  flagged: number;
  flaggedFraction: number;
  suspectedOwners: SuspectedOwner[];
  recommendation: 'confident' | 'review-first';
  reviewReasons: string[];
}

export interface ScanTriageModel {
  readonly confident: FaceCleanupPerson[];
  readonly reviewFirst: FaceCleanupPerson[];
  readonly excluded: Set<string>;
  readonly approvedIds: string[];
  readonly approvedCount: number;
  isExcluded(id: string): boolean;
  toggleExcluded(id: string): void;
  reset(): void;
}

export interface ScanTriageModelOptions {
  // The previous model, when rebuilding after a refetch/dismiss: the admin's exclusions carry over,
  // intersected with the confident clusters that survived, so a dismissed/re-homed cluster leaves no
  // dangling exclusion. Widened to `Pick<..., 'excluded'>` (rather than a full ScanTriageModel) because the
  // factory only ever reads `.excluded` — this lets the scan page seed a pseudo-prev from persisted
  // sessionStorage exclusions on a fresh mount (see scan/+page.svelte's setScan), not just from a real prior
  // model held in memory.
  prev?: Pick<ScanTriageModel, 'excluded'> | null;
}

export function createScanTriageModel(persons: FaceCleanupPerson[], options?: ScanTriageModelOptions): ScanTriageModel {
  const confident = persons.filter((p) => p.recommendation === 'confident');
  const reviewFirst = persons.filter((p) => p.recommendation === 'review-first');
  const confidentIds = new SvelteSet(confident.map((p) => p.personId));

  const excluded: SvelteSet<string> = new SvelteSet(
    [...(options?.prev?.excluded ?? [])].filter((id) => confidentIds.has(id)),
  );

  const approvedIds = () => confident.filter((p) => !excluded.has(p.personId)).map((p) => p.personId);

  return {
    confident,
    reviewFirst,
    excluded,
    get approvedIds() {
      return approvedIds();
    },
    get approvedCount() {
      return approvedIds().length;
    },
    isExcluded(id: string): boolean {
      return excluded.has(id);
    },
    toggleExcluded(id: string): void {
      // Only confident clusters can be excluded — review-first is never part of the bulk.
      if (!confidentIds.has(id)) {
        return;
      }
      if (excluded.has(id)) {
        excluded.delete(id);
      } else {
        excluded.add(id);
      }
    },
    reset(): void {
      excluded.clear();
    },
  };
}
