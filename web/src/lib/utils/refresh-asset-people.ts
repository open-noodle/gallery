import { getAssetInfo } from '@immich/sdk';
import { eventManager } from '$lib/managers/event-manager.svelte';
import { faceManager } from '$lib/stores/face.svelte';

/**
 * Re-read an asset after its people changed, and push the result everywhere that renders them.
 *
 * Every space face mutation has TWO stale surfaces, and they are refreshed by different means:
 *
 *   - the People row reads `AssetResponseDto.people`, which lives on the asset. `AssetViewer`
 *     derives its asset from `cursor.current`, so a component cannot fix this by assigning its own
 *     `asset` prop -- that only updates its own copy, and the pre-edit people come back the moment
 *     the panel is reopened. Emitting `AssetUpdate` is the route back to the parent.
 *   - the face boxes drawn over the photo read `faceManager`, which has to be reloaded separately.
 *
 * Both callers (the side panel's edit-faces flow and the on-photo face editor) need both halves, so
 * this exists to stop them drifting -- the on-photo editor originally did neither and simply closed
 * itself, which left a newly tagged person invisible until a full page reload.
 *
 * `spaceId` is forwarded so the re-read resolves in the same space the caller is editing in; the
 * server returns `resolvedSpaceId` on that branch, which the People-row edit affordances fall back
 * to when the route itself carries no space.
 */
export async function refreshAssetPeople(assetId: string, spaceId?: string): Promise<void> {
  const refreshed = await getAssetInfo({ id: assetId, spaceId });
  eventManager.emit('AssetUpdate', refreshed);
  faceManager.clear();
  await faceManager.getAssetFaces(assetId);
}
