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
 * Trashing an owned photo that is also in a shared space removes it for the space's members too.
 * Asks the server which of `ids` are in a space and, if any are, asks the user to confirm.
 * Resolves to true when the trash may go ahead. Throws when the lookup fails, so callers never
 * trash without having checked.
 */
export const confirmTrashInSpaces = async (ids: string[]): Promise<boolean> => {
  if (ids.length === 0) {
    return true;
  }

  let count = 0;
  for (const assetIds of chunk(ids, CLEANUP_MAX_IDS)) {
    const response = await getCleanupAssetsInSpaces({ cleanupInSpacesDto: { assetIds } });
    count += response.assetIds.length;
  }
  if (count === 0) {
    return true;
  }

  const $t = get(t);
  return modalManager.showDialog({
    prompt: $t('cleanup_space_warning', { values: { count } }),
    confirmText: $t('trash'),
    confirmColor: 'danger',
  });
};

const showTrashedToast = (trashed: string[], onRestored: OnIds) => {
  const $t = get(t);
  toastManager.primary(
    {
      description: $t('assets_trashed_count', { values: { count: trashed.length } }),
      button: {
        label: $t('undo'),
        color: 'secondary',
        onclick: async () => {
          try {
            await restoreAssets({ bulkIdsDto: { ids: trashed } });
            onRestored(trashed);
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
 * `onRemoved` with a 5-second Undo toast that restores exactly the ids the server trashed.
 *
 * Resolves to undefined when the user cancels the Space warning or the check itself fails; in both
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
    if (!(await confirmTrashInSpaces(trashIds))) {
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
    showTrashedToast(result.trashed, onRestored);
  }
  if (result.skipped.length > 0) {
    toastManager.warning($t('cleanup_skipped_count', { values: { count: result.skipped.length } }));
  }

  return result;
};

/** Trashes `ids` from a queue page, after the Space warning, with an Undo toast. */
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
