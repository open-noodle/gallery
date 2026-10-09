import {
  commitCleanup,
  createStack,
  getCleanupAssetsInSpaces,
  restoreAssets,
  type CleanupQueue,
  type CleanupSkippedDto,
} from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import { chunk } from '$lib/utils/cleanup';
import { handleError } from '$lib/utils/handle-error';

/** The server rejects a commit or in-spaces list longer than this. */
export const CLEANUP_MAX_IDS = 1000;

export type CleanupCommitResult = {
  trashed: string[];
  kept: number;
  skipped: CleanupSkippedDto[];
  /** A chunk failed; the chunks before it are still reported above. */
  failed: boolean;
};

type OnIds = (ids: string[]) => void;

/**
 * Whether Cleanup's "trash" is the recoverable trash. With the server's trash turned off, the
 * commit endpoint deletes permanently instead (the duplicates utility does the same), so every
 * trash action asks for a "permanently delete" confirmation and never offers Undo.
 */
export const isTrashEnabled = () => featureFlagsManager.value.trash;

/**
 * Confirms a Cleanup trash before anything is committed.
 *
 * - Trashing an owned photo that is also in a shared space removes it for the space's members too,
 *   so the server is asked which of `ids` are in a space; if any are, the user confirms.
 * - With the trash turned off the delete is permanent, so the user always confirms, with the Space
 *   sentence added when it applies.
 *
 * Resolves to true when the trash may go ahead. Throws when the lookup fails, so callers never
 * trash without having checked.
 */
export const confirmCleanupTrash = async (ids: string[]): Promise<boolean> => {
  if (ids.length === 0) {
    return true;
  }

  let count = 0;
  for (const assetIds of chunk(ids, CLEANUP_MAX_IDS)) {
    const response = await getCleanupAssetsInSpaces({ cleanupInSpacesDto: { assetIds } });
    count += response.assetIds.length;
  }

  const $t = get(t);
  if (!isTrashEnabled()) {
    const sentences = [$t('cleanup_permanent_delete_prompt', { values: { count: ids.length } })];
    if (count > 0) {
      sentences.push($t('cleanup_permanent_delete_space_warning', { values: { count } }));
    }
    return modalManager.showDialog({
      title: $t('permanently_delete'),
      prompt: sentences.join(' '),
      confirmText: $t('permanently_delete'),
      confirmColor: 'danger',
    });
  }

  if (count === 0) {
    return true;
  }

  return modalManager.showDialog({
    prompt: $t('cleanup_space_warning', { values: { count } }),
    confirmText: $t('trash'),
    confirmColor: 'danger',
  });
};

/**
 * Reports what a Cleanup commit removed. A trash gets a 5-second Undo that restores exactly the
 * ids the server trashed; a permanent delete (trash turned off) has nothing to restore, so it gets
 * a plain notice and no Undo.
 */
export const showRemovedToast = (removed: string[], onRestored?: OnIds) => {
  if (removed.length === 0) {
    return;
  }
  const $t = get(t);
  if (!isTrashEnabled()) {
    toastManager.primary($t('permanently_deleted_assets_count', { values: { count: removed.length } }));
    return;
  }
  toastManager.primary(
    {
      description: $t('assets_trashed_count', { values: { count: removed.length } }),
      button: {
        label: $t('undo'),
        color: 'secondary',
        onclick: async () => {
          try {
            await restoreAssets({ bulkIdsDto: { ids: removed } });
            onRestored?.(removed);
          } catch (error) {
            handleError(error, $t('errors.unable_to_restore_assets'));
          }
        },
      },
    },
    { timeout: 5000 },
  );
};

/**
 * Sends one queue decision — photos to trash and photos to keep — through `POST /cleanup/commit`,
 * split into requests of at most 1,000 ids per list. Anything trashed is reported through
 * `onRemoved` and `showRemovedToast`: an Undo toast, or a permanent-delete notice with the trash off.
 *
 * Resolves to undefined when the user cancels the confirmation or the check itself fails; in both
 * cases nothing has been committed.
 */
export const commitWithUndo = async (
  queue: CleanupQueue,
  { trashIds = [], keepIds = [] }: { trashIds?: string[]; keepIds?: string[] },
  onRemoved: OnIds,
  onRestored: OnIds,
): Promise<CleanupCommitResult | undefined> => {
  const $t = get(t);

  try {
    if (!(await confirmCleanupTrash(trashIds))) {
      return;
    }
  } catch (error) {
    handleError(error, $t('errors.unable_to_delete_assets'));
    return;
  }

  const trashChunks = chunk(trashIds, CLEANUP_MAX_IDS);
  const keepChunks = chunk(keepIds, CLEANUP_MAX_IDS);
  const result: CleanupCommitResult = { trashed: [], kept: 0, skipped: [], failed: false };

  for (let i = 0; i < Math.max(trashChunks.length, keepChunks.length); i++) {
    const trashChunk = trashChunks[i] ?? [];
    const keepChunk = keepChunks[i] ?? [];
    try {
      const response = await commitCleanup({
        cleanupCommitDto: {
          queue,
          ...(trashChunk.length > 0 && { trashIds: trashChunk }),
          ...(keepChunk.length > 0 && { keepIds: keepChunk }),
        },
      });
      result.trashed.push(...response.trashed);
      result.kept += response.kept;
      result.skipped.push(...response.skipped);
    } catch (error) {
      result.failed = true;
      handleError(error, $t(trashIds.length > 0 ? 'errors.unable_to_delete_assets' : 'errors.cant_apply_changes'));
      break;
    }
  }

  if (result.trashed.length > 0) {
    onRemoved(result.trashed);
    showRemovedToast(result.trashed, onRestored);
  }
  if (result.skipped.length > 0) {
    toastManager.warning($t('cleanup_skipped_count', { values: { count: result.skipped.length } }));
  }

  return result;
};

/** Trashes `ids` from a queue page after the confirmation; see `showRemovedToast` for the Undo. */
export const trashWithUndo = (queue: CleanupQueue, ids: string[], onRemoved: OnIds, onRestored: OnIds) =>
  commitWithUndo(queue, { trashIds: ids }, onRemoved, onRestored);

/** Records a keep decision so the photos never come back to this queue. Resolves to true on success. */
export const keep = async (queue: CleanupQueue, ids: string[], onRemoved: OnIds): Promise<boolean> => {
  try {
    for (const keepIds of chunk(ids, CLEANUP_MAX_IDS)) {
      await commitCleanup({ cleanupCommitDto: { queue, keepIds } });
    }
    onRemoved(ids);
    return true;
  } catch (error) {
    handleError(error, get(t)('errors.cant_apply_changes'));
    return false;
  }
};

/** Stacks the photos; the first id becomes the stack's primary. Resolves to true on success. */
export const stackGroup = async (orderedIds: string[]): Promise<boolean> => {
  try {
    await createStack({ stackCreateDto: { assetIds: orderedIds } });
    return true;
  } catch (error) {
    handleError(error, get(t)('errors.failed_to_stack_assets'));
    return false;
  }
};
