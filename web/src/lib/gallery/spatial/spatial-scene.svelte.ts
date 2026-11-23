import { ProjectionType } from '#lib/constants.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { eventManager } from '#lib/managers/event-manager.svelte.ts';
import { featureFlagsManager } from '#lib/managers/feature-flags-manager.svelte.ts';
import { createUrl, getSharedLink } from '#lib/utils.ts';
import { canEditAsset } from '#lib/utils/asset-editability.ts';
import { handleError } from '#lib/utils/handle-error.ts';
import {
  AssetTypeEnum,
  getAssetInfo,
  refreshAssetDepth,
  updateAssetSpatialScene,
  type AssetResponseDto,
} from '@immich/sdk';
import { toastManager, type ActionItem } from '@immich/ui';
import { mdiCube, mdiCubeOffOutline, mdiCubeOutline, mdiCubeScan, mdiRestore } from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';

// Spatial Scene (specs/2026-10-29-spatial-scene-design.md): the viewer's Spatial toggle.

/**
Which photo the Spatial view is on. Keyed by asset id rather than a plain flag, so moving to another photo leaves it
without any effect having to reset it.
*/
class SpatialSceneState {
  assetId = $state<string>();

  isActive(asset: Pick<AssetResponseDto, 'id' | 'type'> | undefined) {
    return !!asset && asset.type === AssetTypeEnum.Image && this.assetId === asset.id;
  }

  show(assetId: string) {
    this.assetId = assetId;
  }

  hide() {
    this.assetId = undefined;
  }
}

export const spatialSceneState = new SpatialSceneState();

let webgl2: boolean | undefined;
export const supportsWebGL2 = () => {
  if (webgl2 === undefined) {
    try {
      webgl2 = typeof document !== 'undefined' && !!document.createElement('canvas').getContext('webgl2');
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
};

/**
The browser keeps a depth map for a day. Its URL changes with the photo (thumbhash) and with the map itself
(`spatialSceneDepthMapCreatedAt`), so a map made again by a refresh, a model switch or the job is fetched anew.
*/
export const getDepthMapUrl = (asset: Pick<AssetResponseDto, 'id' | 'thumbhash' | 'spatialSceneDepthMapCreatedAt'>) =>
  createUrl(`/assets/${asset.id}/depth`, {
    ...authManager.params,
    c: asset.thumbhash,
    v: asset.spatialSceneDepthMapCreatedAt,
  });

type DeviceOrientationWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

/** iOS Safari only reports device tilt after a permission prompt, which must come from a tap: the Spatial button. */
const requestTilt = () => {
  const orientation =
    typeof DeviceOrientationEvent === 'undefined'
      ? undefined
      : (DeviceOrientationEvent as DeviceOrientationWithPermission);
  orientation?.requestPermission?.().catch(() => {
    // denied or unavailable: the pointer and the idle sway still move the scene
  });
};

export const getSpatialSceneActions = ($t: MessageFormatter, asset: AssetResponseDto) => {
  const offered = () => asset.type === AssetTypeEnum.Image && !!asset.spatialScene && supportsWebGL2();

  const ShowSpatialScene: ActionItem = {
    title: $t('spatial_scene_show'),
    icon: mdiCubeOutline,
    $if: () => offered() && !spatialSceneState.isActive(asset),
    onAction: () => {
      requestTilt();
      spatialSceneState.show(asset.id);
    },
  };

  const HideSpatialScene: ActionItem = {
    title: $t('spatial_scene_hide'),
    icon: mdiCube,
    $if: () => offered() && spatialSceneState.isActive(asset),
    onAction: () => spatialSceneState.hide(),
  };

  // The per-photo actions (specs/2026-10-29-spatial-scene-design.md, "Per-photo actions"), beside Refresh faces in
  // the viewer's menu and under the same edit access. The server refuses the same photos: videos, panoramas, trash.
  const actionable = () =>
    !!featureFlagsManager.valueOrUndefined?.spatialScene &&
    !getSharedLink() &&
    asset.type === AssetTypeEnum.Image &&
    !asset.isTrashed &&
    asset.exifInfo?.projectionType !== ProjectionType.EQUIRECTANGULAR &&
    !asset.originalPath.toLowerCase().endsWith('.insp') &&
    canEditAsset(asset, { userId: authManager.authenticated ? authManager.user.id : undefined });

  const RefreshDepthMap: ActionItem = {
    title: $t('spatial_scene_refresh_depth_map'),
    icon: mdiCubeScan,
    $if: actionable,
    onAction: () => void handleRefreshDepthMap($t, asset),
  };

  const OfferSpatialScene: ActionItem = {
    title: $t('spatial_scene_offer_photo'),
    icon: mdiCubeOutline,
    $if: () => actionable() && !asset.spatialScene,
    onAction: () => void handleSetOffered($t, asset, true),
  };

  const StopOfferingSpatialScene: ActionItem = {
    title: $t('spatial_scene_stop_offering_photo'),
    icon: mdiCubeOffOutline,
    $if: () => actionable() && !!asset.spatialScene,
    onAction: () => void handleSetOffered($t, asset, false),
  };

  // Only for a photo with a choice. A server without the field leaves it absent, which hides the item.
  const UseAutomaticSpatialScene: ActionItem = {
    title: $t('spatial_scene_use_automatic'),
    icon: mdiRestore,
    $if: () => actionable() && asset.spatialSceneChoice !== null && asset.spatialSceneChoice !== undefined,
    onAction: () => void handleSetOffered($t, asset, null),
  };

  return {
    ShowSpatialScene,
    HideSpatialScene,
    RefreshDepthMap,
    OfferSpatialScene,
    StopOfferingSpatialScene,
    UseAutomaticSpatialScene,
  };
};

/** The asset as the viewer reads it, in the same space, so the people and edit rights it carries stay right. */
const reread = (asset: AssetResponseDto) => getAssetInfo({ id: asset.id, spaceId: asset.resolvedSpaceId });

export const spatialScenePolling = { intervalMs: 3000, attempts: 40 };

/**
A depth map is made by a background job, which can sit behind a library backfill. Re-read the photo for a while and
hand the viewer the Spatial button as soon as the server offers it; after that, opening the photo again shows it.
*/
const watchForSpatialScene = async (asset: AssetResponseDto) => {
  for (let attempt = 0; attempt < spatialScenePolling.attempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, spatialScenePolling.intervalMs));
    try {
      const updated = await reread(asset);
      if (updated.spatialScene) {
        eventManager.emit('AssetUpdate', updated);
        return;
      }
    } catch {
      return;
    }
  }
};

const handleRefreshDepthMap = async ($t: MessageFormatter, asset: AssetResponseDto) => {
  try {
    await refreshAssetDepth({ id: asset.id });
    toastManager.primary($t('spatial_scene_refreshing_depth_map'));
  } catch (error) {
    handleError(error, $t('spatial_scene_update_failed'));
    return;
  }
  if (!asset.spatialScene) {
    await watchForSpatialScene(asset);
  }
};

const handleSetOffered = async ($t: MessageFormatter, asset: AssetResponseDto, offered: boolean | null) => {
  let updated: AssetResponseDto;
  try {
    await updateAssetSpatialScene({ id: asset.id, spatialSceneOfferDto: { offered } });
    updated = await reread(asset);
  } catch (error) {
    handleError(error, $t('spatial_scene_update_failed'));
    return;
  }

  eventManager.emit('AssetUpdate', updated);
  if (!updated.spatialScene && spatialSceneState.assetId === asset.id) {
    spatialSceneState.hide();
  }
  if (offered === null) {
    toastManager.primary($t('spatial_scene_automatic_photo'));
    return;
  }
  if (!offered) {
    toastManager.primary($t('spatial_scene_not_offered_photo'));
    return;
  }
  if (updated.spatialScene) {
    toastManager.primary($t('spatial_scene_offered_photo'));
    return;
  }
  // No depth map yet: the server queued one.
  toastManager.primary($t('spatial_scene_depth_map_queued'));
  await watchForSpatialScene(updated);
};
