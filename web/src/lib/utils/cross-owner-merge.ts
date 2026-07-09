import { isHttpError, mergeScopedPeople, type MergeScopedPeopleDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { mdiAlertOutline } from '@mdi/js';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { getServerErrorMessage } from '$lib/utils/handle-error';

/**
 * Machine-readable error codes returned by the server when a scoped people-merge crosses an owner
 * boundary (issue #733). Mirrors `CROSS_OWNER_MERGE_ERROR_CODE` in the server's person service.
 */
export const CrossOwnerMergeErrorCode = {
  /** The merge is not permitted because the instance toggle is off. */
  Blocked: 'cross_owner_merge_blocked',
  /** The instance toggle is on: the merge is permitted but must be explicitly confirmed first. */
  ConfirmationRequired: 'cross_owner_merge_confirmation_required',
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
  /** Ask the user to confirm a cross-owner merge. Resolves true to proceed. */
  confirmCrossOwner: () => Promise<boolean>;
  /** Surface the server's descriptive "blocked" message (never the raw truncated string). */
  onBlocked: (message: string | undefined) => void;
}

/**
 * The standard cross-owner merge handlers shared by every scoped-merge entry point (the people
 * detail page, the space people detail page, and the merge-suggestion modal): a strong danger
 * confirmation dialog and a descriptive blocked-merge toast, all using i18n.
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
  onBlocked: (message) => {
    const $t = get(t);
    toastManager.danger(message ?? $t('cannot_merge_people'));
  },
});

/**
 * Run a scoped people-merge, transparently handling the cross-owner boundary (issue #733):
 * - a `blocked` response invokes `onBlocked` with the server's descriptive message;
 * - a `confirmationRequired` response asks `confirmCrossOwner`, and — only if accepted — re-runs the
 *   merge with the acknowledgement so the server commits it.
 *
 * Returns `true` when the merge committed, `false` when it was blocked or the user declined. Any
 * other error propagates to the caller.
 */
export const runScopedMergeWithCrossOwnerConfirmation = async (
  mergeScopedPeopleDto: MergeScopedPeopleDto,
  handlers: CrossOwnerMergeHandlers,
): Promise<boolean> => {
  try {
    await mergeScopedPeople({ mergeScopedPeopleDto });
    return true;
  } catch (error) {
    const code = getCrossOwnerMergeErrorCode(error);

    if (code === CrossOwnerMergeErrorCode.Blocked) {
      handlers.onBlocked(getServerErrorMessage(error));
      return false;
    }

    if (code !== CrossOwnerMergeErrorCode.ConfirmationRequired) {
      throw error;
    }

    if (!(await handlers.confirmCrossOwner())) {
      return false;
    }

    await mergeScopedPeople({ mergeScopedPeopleDto: { ...mergeScopedPeopleDto, confirmCrossOwner: true } });
    return true;
  }
};
