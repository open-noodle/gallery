import { getEditableAssets } from '@immich/sdk';

export interface EditabilityContext {
  userId?: string;
  space?: { canWrite: boolean; members: { userId: string }[] } | null;
}

/**
 * "May this user edit this asset?" — one place, so the rule is never spelled twice.
 *
 * The server is authoritative: when `canEdit` is present (single-asset reads) it wins
 * outright. The fallbacks exist only for surfaces that never resolved it — list responses
 * omit the field deliberately, because resolving it per asset would be an N+1 access check.
 *
 * The space derivation mirrors the server rule (space Owner/Editor, and the asset's owner
 * is a member of that space). It is near-exact on a space surface, because every asset
 * visible there arrived through one of that space's three paths. It is only ever advisory —
 * the server enforces on write regardless.
 */
export function canEditAsset(asset: { ownerId?: string; canEdit?: boolean }, ctx: EditabilityContext = {}): boolean {
  if (asset.canEdit !== undefined) {
    return asset.canEdit;
  }

  const { userId, space } = ctx;
  if (!userId) {
    return false;
  }

  if (asset.ownerId === userId) {
    return true;
  }

  if (!space?.canWrite || !asset.ownerId) {
    return false;
  }

  return space.members.some((member) => member.userId === asset.ownerId);
}

/**
 * Resolve which of `assets` the caller may edit — the batch counterpart to `canEditAsset`,
 * for bulk-selection surfaces where resolving `canEdit` per asset would be an N+1 (#734).
 *
 * `POST /assets/editable` is server-authoritative and wins outright. Only on a rejected
 * request (offline, network error) does this fall back to the client-side `canEditAsset`
 * heuristic — advisory, and only as accurate as `ctx.space.members`.
 */
export async function resolveEditableAssetIds(
  assets: { id: string; ownerId?: string; canEdit?: boolean }[],
  ctx: EditabilityContext = {},
): Promise<string[]> {
  if (assets.length === 0) {
    return [];
  }

  try {
    const { editableAssetIds } = await getEditableAssets({
      assetEditableDto: { assetIds: assets.map((asset) => asset.id) },
    });
    return editableAssetIds;
  } catch {
    return assets.filter((asset) => canEditAsset(asset, ctx)).map((asset) => asset.id);
  }
}
