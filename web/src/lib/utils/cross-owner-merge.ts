import { isHttpError, mergeScopedPeople, type MergeScopedPeopleDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { mdiAlertOutline } from '@mdi/js';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';

/**
 * Machine-readable error codes returned by the server when a people-merge would destructively reach past what
 * the actor controls (issue #733). Mirrors `CROSS_OWNER_MERGE_ERROR_CODE` in the server's merge policy.
 */
export const CrossOwnerMergeErrorCode = {
  /** The merge would collapse another user's people, or people in a space the actor can't edit, and the
   * instance toggle is off. An administrator can enable it. */
  Blocked: 'cross_owner_merge_blocked',
  /** The instance toggle is on: the merge is permitted but must be explicitly confirmed first. */
  ConfirmationRequired: 'cross_owner_merge_confirmation_required',
} as const;

/**
 * Other terminal merge error codes (issue #733 review, L7). Each maps to a localized message so the merge flows
 * surface a clean toast instead of the raw, truncated "(… Server Error)" server sentence.
 */
const TERMINAL_MERGE_ERROR_MESSAGE = {
  merge_not_accessible: 'merge_error_not_accessible',
  merge_conflict: 'merge_error_conflict',
} as const;

/** Read the machine-readable cross-owner merge error code from a thrown SDK error, if present. */
export const getCrossOwnerMergeErrorCode = (error: unknown): string | undefined => {
  if (!isHttpError(error)) {
    return undefined;
  }

  // errors for endpoints without return types (e.g. /people/same-person) aren't parsed as json
  let data = error.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      // Not a JSON string
    }
  }

  return (data as { code?: string } | undefined)?.code;
};

export interface CrossOwnerMergeHandlers {
  /** Ask the user to confirm a destructive cross-boundary merge. Resolves true to proceed. */
  confirmCrossOwner: () => Promise<boolean>;
  /** Tell the user the merge is blocked and an administrator can enable it (localized, never a raw server string). */
  onBlocked: () => void;
}

/**
 * The standard cross-owner merge handlers shared by every scoped-merge entry point (the people
 * detail page, the space people detail page, and the merge-suggestion modal): a strong danger
 * confirmation dialog and a localized blocked-merge toast, all using i18n.
 */
export const createCrossOwnerMergeHandlers = (): CrossOwnerMergeHandlers => ({
  confirmCrossOwner: () => {
    const $t = get(t);
    return modalManager.showDialog({
      title: $t('merge_people_across_owners'),
      prompt: $t('merge_people_across_owners_confirmation'),
      confirmText: $t('merge'),
      confirmColor: 'danger',
      icon: mdiAlertOutline,
    });
  },
  onBlocked: () => {
    const $t = get(t);
    toastManager.danger($t('merge_people_across_owners_blocked'));
  },
});

/**
 * Run any people-merge call, transparently handling the destructive cross-boundary case (issue #733):
 * - a `blocked` response invokes `handlers.onBlocked` (a localized "an admin can enable this" toast);
 * - a `confirmationRequired` response asks `handlers.confirmCrossOwner`, and — only if accepted —
 *   re-runs `merge` with `confirmCrossOwner: true` so the server commits it.
 *
 * `merge` is called once with no argument, and — on a confirmed retry — once more with `true`. It
 * is the caller's responsibility to fold that flag into whichever merge request body it sends
 * (`MergePersonDto`, `MergeScopedPeopleDto`, `SharedSpacePersonMergeDto` all carry it).
 *
 * Returns `true` when the merge committed, `false` when it was blocked or the user declined. Any
 * other error propagates to the caller.
 */
export const runMergeWithCrossOwnerConfirmation = async (
  merge: (confirmCrossOwner?: boolean) => Promise<unknown>,
  handlers: CrossOwnerMergeHandlers,
): Promise<boolean> => {
  try {
    await merge();
    return true;
  } catch (error) {
    const code = getCrossOwnerMergeErrorCode(error);

    // A terminal block: the merge would destructively collapse another owner's or an un-editable space's people
    // and the instance toggle is off. Surface a localized "an administrator can enable this" toast; never retry.
    if (code === CrossOwnerMergeErrorCode.Blocked) {
      handlers.onBlocked();
      return false;
    }

    if (code !== CrossOwnerMergeErrorCode.ConfirmationRequired) {
      // Other known terminal merge errors (not-accessible, self-merge, a concurrent-change conflict) get a
      // localized toast instead of the raw truncated server sentence (#733 review L7). Anything we don't
      // recognise is re-thrown to the caller's generic error handling.
      const messageKey =
        code && code in TERMINAL_MERGE_ERROR_MESSAGE
          ? TERMINAL_MERGE_ERROR_MESSAGE[code as keyof typeof TERMINAL_MERGE_ERROR_MESSAGE]
          : undefined;
      if (messageKey) {
        toastManager.danger(get(t)(messageKey));
        return false;
      }
      throw error;
    }

    if (!(await handlers.confirmCrossOwner())) {
      return false;
    }

    await merge(true);
    return true;
  }
};

/**
 * Thin wrapper over {@link runMergeWithCrossOwnerConfirmation} for the scoped merge endpoint
 * (`POST /people/same-person`).
 */
export const runScopedMergeWithCrossOwnerConfirmation = (
  mergeScopedPeopleDto: MergeScopedPeopleDto,
  handlers: CrossOwnerMergeHandlers,
): Promise<boolean> =>
  runMergeWithCrossOwnerConfirmation(
    (confirmCrossOwner) =>
      mergeScopedPeople({
        mergeScopedPeopleDto: confirmCrossOwner
          ? { ...mergeScopedPeopleDto, confirmCrossOwner: true }
          : mergeScopedPeopleDto,
      }),
    handlers,
  );
