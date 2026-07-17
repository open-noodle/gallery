/**
 * Machine-readable error codes for people-merge failures that are not the cross-owner boundary (issue #733 review,
 * L7). Returned in the exception body so the web client can map them to localized messages instead of echoing a
 * raw, truncated server sentence. The cross-owner boundary codes live in `merge-policy.ts`.
 *
 * This module has no imports on purpose, so both the merge engine and the person/shared-space services can share
 * it without any import cycle.
 */
export const MERGE_ERROR_CODE = {
  /** A named target/source ref is not the actor's own person, nor a space person they can repair. */
  notAccessible: 'merge_not_accessible',
  /** A concurrent recognition/dedup/detach change collided with the merge; the caller should retry. */
  conflict: 'merge_conflict',
} as const;
