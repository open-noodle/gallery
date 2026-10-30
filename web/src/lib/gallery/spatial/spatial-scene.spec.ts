import { AssetTypeEnum, type AssetResponseDto } from '@immich/sdk';
import type { ActionEvent, ActionItem } from '@immich/ui';
import type { MessageFormatter } from 'svelte-i18n';
import { getSpatialSceneActions, spatialSceneState } from '$lib/gallery/spatial/spatial-scene.svelte';

const $t = ((key: string) => key) as MessageFormatter;
const run = (action: ActionItem) => action.onAction?.({ action, event: new Event('click') } as ActionEvent<ActionItem>);
const photo = (overrides: Partial<AssetResponseDto> = {}) =>
  ({ id: 'asset-1', type: AssetTypeEnum.Image, spatialScene: true, ...overrides }) as AssetResponseDto;

describe('Spatial Scene actions', () => {
  beforeEach(() => {
    spatialSceneState.hide();
    // happy-dom has no WebGL; the actions only need to know whether a context exists
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as RenderingContext);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers Show on a photo the server offers it for', () => {
    const { ShowSpatialScene, HideSpatialScene } = getSpatialSceneActions($t, photo());
    expect(ShowSpatialScene.$if?.()).toBe(true);
    expect(HideSpatialScene.$if?.()).toBe(false);
  });

  it('offers nothing on a photo the server does not offer it for, or on a video', () => {
    for (const asset of [
      photo({ spatialScene: false }),
      photo({ spatialScene: undefined }),
      photo({ type: AssetTypeEnum.Video }),
    ]) {
      const { ShowSpatialScene, HideSpatialScene } = getSpatialSceneActions($t, asset);
      expect(ShowSpatialScene.$if?.()).toBe(false);
      expect(HideSpatialScene.$if?.()).toBe(false);
    }
  });

  it('switches to Hide once shown, and back', () => {
    const asset = photo();
    const { ShowSpatialScene, HideSpatialScene } = getSpatialSceneActions($t, asset);

    run(ShowSpatialScene);
    expect(spatialSceneState.isActive(asset)).toBe(true);
    expect(ShowSpatialScene.$if?.()).toBe(false);
    expect(HideSpatialScene.$if?.()).toBe(true);

    run(HideSpatialScene);
    expect(spatialSceneState.isActive(asset)).toBe(false);
  });

  it('is not active on the next photo, so moving on leaves the Spatial view', () => {
    spatialSceneState.show('asset-1');
    expect(spatialSceneState.isActive(photo({ id: 'asset-2' }))).toBe(false);
  });

  it('asks iOS for motion access from the tap that shows it', () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission });
    const { ShowSpatialScene } = getSpatialSceneActions($t, photo());

    run(ShowSpatialScene);

    expect(requestPermission).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
