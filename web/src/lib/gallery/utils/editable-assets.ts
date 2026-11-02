import { toastManager } from '@immich/ui';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import type { TimelineAsset } from '$lib/managers/timeline-manager/types';

/**
 * The #734 space-editor counterpart to `getOwnedAssetsWithWarning`: filters `assets` down to
 * `editableAssetIds` (resolved via `resolveEditableAssetIds`/`POST /assets/editable`) instead
 * of ownership, so a space Owner/Editor can bulk-edit a member's assets too. Same shape —
 * narrows the ids to send, and surfaces the skipped count so partial application stays visible.
 */
export const getEditableAssetsWithWarning = (assets: TimelineAsset[], editableAssetIds: string[]): string[] => {
  const editableIds = new Set(editableAssetIds);
  const ids = [...assets].filter((a) => editableIds.has(a.id)).map((a) => a.id);

  const numberOfSkipped = assets.length - ids.length;
  if (numberOfSkipped > 0) {
    const $t = get(t);
    toastManager.warning($t('assets_skipped_not_editable', { values: { count: numberOfSkipped } }));
  }
  return ids;
};
