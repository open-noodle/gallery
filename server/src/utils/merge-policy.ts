import { ConflictException, ForbiddenException } from '@nestjs/common';
import { IdentityMergePropagationPlan, MergeAuthorizer } from 'src/services/identity-merge-propagation.service';

/**
 * Machine-readable error codes for the destructive-merge boundary (issue #733). Returned in the exception body so
 * the web client can render descriptive UX (an enable hint, or a strong confirmation) instead of echoing a raw
 * server string at the user.
 */
export const CROSS_OWNER_MERGE_ERROR_CODE = {
  /**
   * The merge would collapse two people that belong to another user, OR two people in a shared space the actor
   * cannot edit, and the instance toggle is off. An administrator can enable it.
   */
  blocked: 'cross_owner_merge_blocked',
  /** The toggle is on: the merge is permitted, but must be explicitly confirmed before it commits. */
  confirmationRequired: 'cross_owner_merge_confirmation_required',
} as const;

type CollapseCounts = Pick<IdentityMergePropagationPlan, 'collapsedOwnerIds' | 'unrepairableSpaceCollapseIds'>;

const collapsesAnotherBoundary = (plan: CollapseCounts): boolean =>
  plan.collapsedOwnerIds.length > 0 || plan.unrepairableSpaceCollapseIds.length > 0;

/**
 * The one destructive-merge policy, applied by every merge entry point (issue #733).
 *
 * Merging identities reaches past what the actor personally controls in two irreversible ways, and the SAME admin
 * toggle governs both (issue #733 review, P1):
 *
 * - **Collapse of another owner's people**: the actor holds people on both identities for another owner, so
 *   committing merges two of *their* people — one row deleted, its faces moved.
 * - **Collapse in a space the actor cannot edit**: the fan-out would merge two of a shared space's people in a
 *   space where the actor is only a viewer or not a member (see `unrepairableSpaceCollapseIds`).
 *
 * A **re-point** (a lone profile changing identity, nothing deleted) is never gated — the recognition job does
 * that unattended. Only a collapse is destructive, and it needs the instance toggle AND an explicit acknowledgement.
 */
export const assertDestructiveCollapseAllowed = (
  plan: CollapseCounts,
  input: { enabled: boolean; confirmCrossOwner?: boolean },
): void => {
  if (!collapsesAnotherBoundary(plan)) {
    return;
  }

  if (!input.enabled) {
    throw new ForbiddenException({
      code: CROSS_OWNER_MERGE_ERROR_CODE.blocked,
      message:
        'This merge would combine two people that belong to another user, or two people in a shared space you cannot edit, which cannot be undone. An administrator can enable cross-owner merges in the server settings.',
    });
  }

  if (!input.confirmCrossOwner) {
    throw new ConflictException({
      code: CROSS_OWNER_MERGE_ERROR_CODE.confirmationRequired,
      message:
        'This merge will combine two people that belong to another user, or two people in a shared space you cannot edit, and cannot be undone. Confirm to continue.',
      impactedOwnerCount: plan.collapsedOwnerIds.length,
      impactedSpaceCount: plan.unrepairableSpaceCollapseIds.length,
    });
  }
};

/**
 * Builds the authorizer every merge entry point hands to the planner. The caller resolves the instance config
 * BEFORE opening the merge transaction and passes it in as an already-settled `getServerConfig`; the authorizer
 * itself runs inside the transaction (while it holds the instance-wide advisory lock) and must never perform any
 * `this.db` I/O there — a config read on a second pool connection can deadlock every merge (#595 / issue #733).
 * The toggle is only consulted when the plan would actually collapse another owner's or an un-editable space's
 * people, so an ordinary merge ignores it.
 */
export const createCrossOwnerMergeAuthorizer = (
  getServerConfig: () => Promise<{ mergePeopleAcrossOwners: boolean }>,
  dto: { confirmCrossOwner?: boolean },
): MergeAuthorizer => {
  return async (plan) => {
    if (!collapsesAnotherBoundary(plan)) {
      return;
    }

    const server = await getServerConfig();
    assertDestructiveCollapseAllowed(plan, {
      enabled: server.mergePeopleAcrossOwners,
      confirmCrossOwner: dto.confirmCrossOwner,
    });
  };
};
