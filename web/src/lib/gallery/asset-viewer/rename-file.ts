import { eventManager } from '#lib/managers/event-manager.svelte.ts';
import { handleError } from '#lib/utils/handle-error.ts';
import {
  AssetRenameTargetState,
  checkAssetRename,
  getAssetInfo,
  isHttpError,
  renameAsset,
  type AssetResponseDto,
} from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { mdiDeleteOutline } from '@mdi/js';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';

// The server folds these when it names the file; shown read-only in the dialog (spec decision 2).
const EXTENSION_ALIASES: Record<string, string> = {
  jpeg: 'jpg',
  jpe: 'jpg',
  tif: 'tiff',
  '3gpp': '3gp',
  mpeg: 'mpg',
  mpe: 'mpg',
  m2ts: 'mts',
  m2t: 'mts',
};

export const normalizeExtension = (extension: string) => {
  const lower = extension.toLowerCase();
  return EXTENSION_ALIASES[lower] ?? lower;
};

/** The name without its extension, and the extension with its dot, normalized as the server will write it. */
export const splitFileName = (fileName: string) => {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) {
    return { name: fileName, extension: '' };
  }
  return { name: fileName.slice(0, dot), extension: `.${normalizeExtension(fileName.slice(dot + 1))}` };
};

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u{0}-\u{1F}\u{7F}]/u;

/** The server's name rules (a 400 there); checked here so the button stays off instead of erroring. */
export const isValidRenameName = (name: string, extension = '') => {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.startsWith('.') &&
    !/[/\\]/.test(trimmed) &&
    !CONTROL_CHARACTERS.test(trimmed) &&
    new TextEncoder().encode(trimmed + extension).length <= 255
  );
};

const conflictState = (error: unknown): AssetRenameTargetState | undefined => {
  if (!isHttpError(error) || error.status !== 409) {
    return;
  }

  let data: unknown = error.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return;
    }
  }

  const state = (data as { state?: unknown } | undefined)?.state;
  return Object.values(AssetRenameTargetState).find((value) => value === state);
};

/**
What renaming the file on disk to this name would meet. An older server has no such route and answers 404: nothing is
known then, and the rename itself still refuses a taken name. Any other failure is silent for the same reason.
*/
export const checkRenameState = async (assetId: string, fileName: string) => {
  try {
    const { state } = await checkAssetRename({ id: assetId, fileName });
    return state;
  } catch {
    return;
  }
};

const confirmDeleteTrashed = (name: string) => {
  const $t = get(t);
  return modalManager.showDialog({
    title: $t('rename_file_trashed_title'),
    prompt: $t('rename_file_trashed_prompt', { values: { name } }),
    confirmText: $t('rename_file_trashed_confirm'),
    confirmColor: 'danger',
    icon: mdiDeleteOutline,
  });
};

export type RenameOutcome = 'renamed' | 'cancelled' | 'exists' | 'failed';

/**
Renames the file and refreshes the open asset. `state` is what the live check last reported; a trashed item at the new
name is confirmed before it is deleted, also when the server only finds it at submit time. The caller shows 'exists'
in the dialog, so it is not toasted here.
*/
export const renameFile = async (
  asset: AssetResponseDto,
  { name, extension, renameOnDisk, state }: { name: string; extension: string; renameOnDisk: boolean; state?: string },
): Promise<RenameOutcome> => {
  const $t = get(t);
  const fileName = name.trim();
  let deleteTrashed = false;

  if (renameOnDisk && state === AssetRenameTargetState.Trashed) {
    if (!(await confirmDeleteTrashed(fileName + extension))) {
      return 'cancelled';
    }
    deleteTrashed = true;
  }

  const submit = () =>
    renameAsset({
      id: asset.id,
      assetRenameDto: { fileName, renameOnDisk: renameOnDisk || undefined, deleteTrashed: deleteTrashed || undefined },
    });

  try {
    let result;
    try {
      result = await submit();
    } catch (error) {
      if (conflictState(error) !== AssetRenameTargetState.Trashed || deleteTrashed) {
        throw error;
      }

      // The name was taken by a trashed item after the last check.
      if (!(await confirmDeleteTrashed(fileName + extension))) {
        return 'cancelled';
      }
      deleteTrashed = true;
      result = await submit();
    }

    eventManager.emit('AssetUpdate', await getAssetInfo({ id: asset.id }));
    toastManager.primary($t('rename_file_success', { values: { name: result.originalFileName } }));
    return 'renamed';
  } catch (error) {
    if (conflictState(error) === AssetRenameTargetState.Exists) {
      return 'exists';
    }

    handleError(error, $t('errors.unable_to_rename_file'));
    return 'failed';
  }
};
