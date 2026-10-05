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
 * Resolve the space the People row / face-editing surfaces should treat as "the" space for this
 * asset: an explicit `spaceId` (the surface is already scoped to one space) or else whatever space
 * the asset itself resolved to (`asset.resolvedSpaceId`, set on a single-asset read reached via a
 * space's People/timeline/map). Mirrors `DetailPanel.svelte`'s `effectiveSpaceId`.
 */
export function resolveEffectiveSpaceId(
  asset: { resolvedSpaceId?: string | null },
  spaceId?: string,
): string | undefined {
  return spaceId || asset.resolvedSpaceId || undefined;
}

/**
 * "May this user use the space-flavoured face-editing affordances (name/correct/draw a face)
 * on this asset?" — the sibling of `canEditAsset` for the People row (#734-style, never a
 * widening of `isOwner`; see `DetailPanel.svelte`'s `canEditSpacePeople` doc, which this
 * factors out so `DetailPanel.svelte`, `PhotoViewer.svelte` and `VideoNativeViewer.svelte`
 * cannot drift from one another on the SAME asset).
 *
 * Explicitly narrowed to `!isOwner`: the owner keeps the owner-only face endpoints
 * (`reassignFacesById`, `createPerson`, `deleteFace`, `createFace`) regardless of `canEdit`.
 * Also requires an effective space explicitly — `canEdit` can be true with no space context at
 * all (e.g. a partner/album share whose single-asset read still sets `asset.canEdit`), and the
 * space-flavoured panels have no space to write into there.
 */
export function canEditSpacePeople(
  asset: { ownerId?: string; canEdit?: boolean; resolvedSpaceId?: string | null },
  ctx: { userId?: string; spaceId?: string },
): boolean {
  const isOwner = !!ctx.userId && ctx.userId === asset.ownerId;
  const effectiveSpaceId = resolveEffectiveSpaceId(asset, ctx.spaceId);
  return !!effectiveSpaceId && canEditAsset(asset, { userId: ctx.userId }) && !isOwner;
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
