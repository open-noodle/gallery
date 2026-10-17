import type { AssetResponseDto } from '@immich/sdk';
import { getViewerSpace } from '$lib/gallery/viewer-space';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { canEditSpacePeople, resolveEffectiveSpaceId } from '$lib/utils/asset-editability';

/**
 * The space a viewer surface acts in for an asset, read from the viewer space context, so call it
 * during component init. `spaceId` is the viewer's space, else the one the asset read resolved to;
 * `canEditSpacePeople` gates the space face-editing affordances (see `canEditSpacePeople`).
 */
export const useAssetSpace = (getAsset: () => Pick<AssetResponseDto, 'ownerId' | 'canEdit' | 'resolvedSpaceId'>) => {
  const getViewer = getViewerSpace();
  return {
    get spaceId() {
      return resolveEffectiveSpaceId(getAsset(), getViewer().spaceId);
    },
    get canEditSpacePeople() {
      const userId = authManager.authenticated ? authManager.user.id : undefined;
      return canEditSpacePeople(getAsset(), { userId, spaceId: getViewer().spaceId });
    },
  };
};
