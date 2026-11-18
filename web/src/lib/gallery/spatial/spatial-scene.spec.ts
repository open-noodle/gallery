import {
  getDepthMapUrl,
  getSpatialSceneActions,
  spatialSceneState,
} from '#lib/gallery/spatial/spatial-scene.svelte.ts';
import { AssetTypeEnum, type AssetResponseDto } from '@immich/sdk';
import type { ActionEvent, ActionItem } from '@immich/ui';
import type { MessageFormatter } from 'svelte-i18n';

const $t = ((key: string) => key) as MessageFormatter;
const run = (action: ActionItem) => action.onAction?.({ action, event: new Event('click') } as ActionEvent<ActionItem>);
const photo = (overrides: Partial<AssetResponseDto> = {}) =>
  ({ id: 'asset-1', type: AssetTypeEnum.Image, spatialScene: true, ...overrides }) as AssetResponseDto;

describe('Spatial Scene actions', () => {
  beforeEach(() => {
    spatialSceneState.hide();
    // Headless Chromium's WebGL support depends on the host GPU; the actions only need to know whether a
    // context exists, so pin that
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

describe('getDepthMapUrl', () => {
  it('changes with the photo and with the depth map, so a map made again is not served from the cache', () => {
    const first = getDepthMapUrl({
      id: 'asset-1',
      thumbhash: 'abc',
      spatialSceneDepthMapCreatedAt: '2026-11-17T10:00:00.000Z',
    });
    const remade = getDepthMapUrl({
      id: 'asset-1',
      thumbhash: 'abc',
      spatialSceneDepthMapCreatedAt: '2026-11-18T10:00:00.000Z',
    });
    expect(first).toContain('/assets/asset-1/depth');
    expect(first).toContain('c=abc');
    expect(first).not.toBe(remade);
  });

  it('leaves the version out for a server that does not report it', () => {
    expect(getDepthMapUrl({ id: 'asset-1', thumbhash: 'abc' })).not.toContain('v=');
  });
});
