// The shape the scan reports for one place a cluster's flagged faces could go. `count` and `ownerFaceCount`
// are different numbers and the console must never print one under the other's label — see
// specs/2026-07-29-face-review-destination-identity-design.md (D4).
export interface SuspectedOwner {
  ownerPersonId: string;
  ownerName: string | null;
  thumbnailFaceId: string | null;
  /** Flagged faces on the reviewed cluster routing here (scan-time). */
  count: number;
  /** This destination's own face count (live). */
  ownerFaceCount: number;
  /** The destination person row is gone — deleted or merged since the scan ran. */
  ownerMissing: boolean;
}

/** Largest routing share first. Ties break on id so card order never shuffles between re-renders. */
export const sortDestinations = (owners: SuspectedOwner[]): SuspectedOwner[] =>
  [...owners].sort((a, b) => b.count - a.count || a.ownerPersonId.localeCompare(b.ownerPersonId));

/** Destinations an admin can actually be sent to. A deleted person guarantees a failed resolve. */
export const selectableDestinations = (owners: SuspectedOwner[]): SuspectedOwner[] =>
  sortDestinations(owners).filter((o) => !o.ownerMissing);
