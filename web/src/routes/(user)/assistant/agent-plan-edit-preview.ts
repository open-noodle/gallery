import { getBaseUrl } from '@immich/sdk';

export type EditActionItem = { action: 'adjust' | 'mirror'; parameters: Record<string, unknown> };

/**
 * Map an agent operation (type + payload) to editor edit actions, or null if it's not a
 * previewable image-edit op (asset.adjust or asset.flip only — crop/rotate not previewed here).
 */
export const editActionsForOperation = (
  operationType: string,
  payload: Record<string, unknown> | undefined,
): EditActionItem[] | null => {
  if (!payload) {
    return null;
  }

  if (operationType === 'asset.adjust') {
    return [{ action: 'adjust', parameters: { ...payload } }];
  }

  if (operationType === 'asset.flip') {
    return [{ action: 'mirror', parameters: { axis: payload.axis } }];
  }

  return null;
};

/**
 * POST the proposed edits to the ephemeral preview endpoint and return an object URL for the
 * rendered image. Revoke the returned object URL when it is no longer needed.
 */
export const fetchEditPreview = async (
  assetId: string,
  edits: EditActionItem[],
  signal?: AbortSignal,
): Promise<string> => {
  const response = await fetch(`${getBaseUrl()}/assets/${assetId}/edits/preview?size=thumbnail`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edits }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Edit preview failed: ${response.status}`);
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
};
