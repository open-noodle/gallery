import { AssetTypeEnum, type AssetResponseDto } from '@immich/sdk';
import type { ActionItem } from '@immich/ui';
import { mdiCube, mdiCubeOutline } from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { createUrl } from '$lib/utils';

// Spatial Scene (specs/2026-10-29-spatial-scene-design.md): the viewer's Spatial toggle.

/**
 * Which photo the Spatial view is on. Keyed by asset id rather than a plain flag, so moving to another photo leaves it
 * without any effect having to reset it.
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

export const getDepthMapUrl = (asset: Pick<AssetResponseDto, 'id' | 'thumbhash'>) =>
  createUrl(`/assets/${asset.id}/depth`, { ...authManager.params, c: asset.thumbhash });

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

  return { ShowSpatialScene, HideSpatialScene };
};
