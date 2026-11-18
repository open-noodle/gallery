import { ProjectionType } from '#lib/constants.ts';
import {
  getSpatialSceneActions,
  spatialScenePolling,
  spatialSceneState,
} from '#lib/gallery/spatial/spatial-scene.svelte.ts';
import { eventManager } from '#lib/managers/event-manager.svelte.ts';
import { setSharedLink } from '#lib/utils.ts';
import { AssetTypeEnum, type AssetResponseDto, type ExifResponseDto, type SharedLinkResponseDto } from '@immich/sdk';
import type { ActionEvent, ActionItem } from '@immich/ui';
import type { MessageFormatter } from 'svelte-i18n';

// Spatial Scene per-photo actions (specs/2026-10-29-spatial-scene-design.md, "Per-photo actions").

const mocks = vi.hoisted(() => ({
  sdk: { getAssetInfo: vi.fn(), refreshAssetDepth: vi.fn(), updateAssetSpatialScene: vi.fn() },
  toast: { primary: vi.fn(), warning: vi.fn(), success: vi.fn(), danger: vi.fn(), info: vi.fn() },
  handleError: vi.fn(),
  flags: { valueOrUndefined: { spatialScene: true } as { spatialScene?: boolean } | undefined },
  user: { current: { id: 'owner-1' } as { id: string } | null },
}));

vi.mock('@immich/sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.sdk }));
vi.mock('@immich/ui', () => ({ toastManager: mocks.toast }));
vi.mock('#lib/utils/handle-error.js', () => ({ handleError: mocks.handleError }));
vi.mock('#lib/managers/feature-flags-manager.svelte.js', () => ({ featureFlagsManager: mocks.flags }));
vi.mock('#lib/managers/auth-manager.svelte.js', () => ({
  authManager: {
    params: {},
    get authenticated() {
      return mocks.user.current !== null;
    },
    get user() {
      return mocks.user.current;
    },
  },
}));

const $t = ((key: string) => key) as MessageFormatter;
const run = (action: ActionItem) => action.onAction?.({ action, event: new Event('click') } as ActionEvent<ActionItem>);
const photo = (overrides: Partial<AssetResponseDto> = {}) =>
  ({
    id: 'asset-1',
    ownerId: 'owner-1',
    type: AssetTypeEnum.Image,
    originalPath: '/library/IMG_0001.HEIC',
    isTrashed: false,
    spatialScene: false,
    resolvedSpaceId: 'space-1',
    ...overrides,
  }) as AssetResponseDto;

const visible = (asset: AssetResponseDto) => {
  const { RefreshDepthMap, OfferSpatialScene, StopOfferingSpatialScene, UseAutomaticSpatialScene } =
    getSpatialSceneActions($t, asset);
  return {
    refresh: RefreshDepthMap.$if?.() ?? true,
    offer: OfferSpatialScene.$if?.() ?? true,
    stop: StopOfferingSpatialScene.$if?.() ?? true,
    automatic: UseAutomaticSpatialScene.$if?.() ?? true,
  };
};

describe('Spatial Scene per-photo actions', () => {
  let emit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.flags.valueOrUndefined = { spatialScene: true };
    setSharedLink(undefined);
    mocks.user.current = { id: 'owner-1' };
    mocks.sdk.refreshAssetDepth.mockResolvedValue(undefined);
    mocks.sdk.updateAssetSpatialScene.mockResolvedValue(undefined);
    spatialScenePolling.intervalMs = 1;
    spatialScenePolling.attempts = 3;
    spatialSceneState.hide();
    emit = vi.spyOn(eventManager, 'emit');
  });

  afterEach(() => {
    setSharedLink(undefined);
    vi.restoreAllMocks();
  });

  describe('which actions show', () => {
    it('offers Refresh and Offer on a photo the server does not offer it for', () => {
      expect(visible(photo())).toEqual({ refresh: true, offer: true, stop: false, automatic: false });
    });

    it('offers Refresh and Stop on a photo the server offers it for', () => {
      expect(visible(photo({ spatialScene: true }))).toEqual({
        refresh: true,
        offer: false,
        stop: true,
        automatic: false,
      });
    });

    it.each([
      ['offered', true, { spatialScene: true }],
      ['not offered', false, { spatialScene: false }],
      ['offered, waiting for its depth map', true, { spatialScene: false }],
    ])('offers the automatic choice back on a photo chosen as %s', (_label, choice, overrides) => {
      expect(visible(photo({ ...overrides, spatialSceneChoice: choice }))).toMatchObject({ automatic: true });
    });

    it('does not offer the automatic choice without a choice, or from a server without the field', () => {
      expect(visible(photo({ spatialSceneChoice: null }))).toMatchObject({ automatic: false });
      expect(visible(photo({ spatialSceneChoice: undefined }))).toMatchObject({ automatic: false });
    });

    it('follows the server edit right: a space Editor gets them, a viewer of a shared photo does not', () => {
      expect(visible(photo({ ownerId: 'someone-else', canEdit: true }))).toMatchObject({ refresh: true });
      expect(visible(photo({ ownerId: 'someone-else', canEdit: false }))).toMatchObject({ refresh: false });
      expect(visible(photo({ canEdit: false }))).toMatchObject({ refresh: false });
    });

    it.each([
      ['Spatial Scene is off', () => (mocks.flags.valueOrUndefined = { spatialScene: false })],
      ['the server predates the flag', () => (mocks.flags.valueOrUndefined = {})],
      ['the flags have not loaded', () => (mocks.flags.valueOrUndefined = undefined)],
      ['on a shared link', () => setSharedLink({ id: 'link' } as SharedLinkResponseDto)],
      ['signed out', () => (mocks.user.current = null)],
    ])('shows nothing when %s', (_label, arrange) => {
      arrange();
      expect(visible(photo())).toEqual({ refresh: false, offer: false, stop: false, automatic: false });
    });

    it.each([
      ['a video', photo({ type: AssetTypeEnum.Video })],
      ['a trashed photo', photo({ isTrashed: true })],
      [
        'an equirectangular panorama',
        photo({ exifInfo: { projectionType: ProjectionType.EQUIRECTANGULAR } as ExifResponseDto }),
      ],
      ['an .insp panorama', photo({ originalPath: '/library/IMG_0001.INSP' })],
    ])('shows nothing on %s', (_label, asset) => {
      expect(visible(asset)).toEqual({ refresh: false, offer: false, stop: false, automatic: false });
    });
  });

  describe('Offer', () => {
    it('offers it on a photo with a depth map, and hands the viewer the re-read photo', async () => {
      const updated = photo({ spatialScene: true });
      mocks.sdk.getAssetInfo.mockResolvedValue(updated);

      run(getSpatialSceneActions($t, photo()).OfferSpatialScene);

      await vi.waitFor(() => expect(mocks.toast.primary).toHaveBeenCalledWith('spatial_scene_offered_photo'));
      expect(mocks.sdk.updateAssetSpatialScene).toHaveBeenCalledWith({
        id: 'asset-1',
        spatialSceneOfferDto: { offered: true },
      });
      expect(mocks.sdk.getAssetInfo).toHaveBeenCalledWith({ id: 'asset-1', spaceId: 'space-1' });
      expect(emit).toHaveBeenCalledWith('AssetUpdate', updated);
    });

    it('waits for the depth map of a photo without one, then hands the viewer the Spatial button', async () => {
      const ready = photo({ spatialScene: true });
      mocks.sdk.getAssetInfo.mockResolvedValueOnce(photo()).mockResolvedValueOnce(photo()).mockResolvedValueOnce(ready);

      run(getSpatialSceneActions($t, photo()).OfferSpatialScene);

      await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('AssetUpdate', ready));
      expect(mocks.toast.primary).toHaveBeenCalledWith('spatial_scene_depth_map_queued');
      expect(mocks.sdk.getAssetInfo).toHaveBeenCalledTimes(3);
    });

    it('stops waiting after the last attempt', async () => {
      mocks.sdk.getAssetInfo.mockResolvedValue(photo());

      run(getSpatialSceneActions($t, photo()).OfferSpatialScene);

      await vi.waitFor(() => expect(mocks.sdk.getAssetInfo).toHaveBeenCalledTimes(1 + spatialScenePolling.attempts));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mocks.sdk.getAssetInfo).toHaveBeenCalledTimes(1 + spatialScenePolling.attempts);
    });

    it('reports a refusal and changes nothing in the viewer', async () => {
      mocks.sdk.updateAssetSpatialScene.mockRejectedValue(new Error('400'));

      run(getSpatialSceneActions($t, photo()).OfferSpatialScene);

      await vi.waitFor(() => expect(mocks.handleError).toHaveBeenCalled());
      expect(mocks.handleError.mock.calls[0][1]).toBe('spatial_scene_update_failed');
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('Stop offering', () => {
    it('stops offering it and leaves the Spatial view if it is open on the photo', async () => {
      const asset = photo({ spatialScene: true });
      const updated = photo({ spatialScene: false });
      mocks.sdk.getAssetInfo.mockResolvedValue(updated);
      spatialSceneState.show('asset-1');

      run(getSpatialSceneActions($t, asset).StopOfferingSpatialScene);

      await vi.waitFor(() => expect(mocks.toast.primary).toHaveBeenCalledWith('spatial_scene_not_offered_photo'));
      expect(mocks.sdk.updateAssetSpatialScene).toHaveBeenCalledWith({
        id: 'asset-1',
        spatialSceneOfferDto: { offered: false },
      });
      expect(emit).toHaveBeenCalledWith('AssetUpdate', updated);
      expect(spatialSceneState.isActive(asset)).toBe(false);
    });
  });

  describe('Choose automatically', () => {
    it('removes the choice and leaves the Spatial view when the automatic choice does not offer it', async () => {
      const asset = photo({ spatialScene: true, spatialSceneChoice: true });
      const updated = photo({ spatialScene: false, spatialSceneChoice: null });
      mocks.sdk.getAssetInfo.mockResolvedValue(updated);
      spatialSceneState.show('asset-1');

      run(getSpatialSceneActions($t, asset).UseAutomaticSpatialScene);

      await vi.waitFor(() => expect(mocks.toast.primary).toHaveBeenCalledWith('spatial_scene_automatic_photo'));
      expect(mocks.sdk.updateAssetSpatialScene).toHaveBeenCalledWith({
        id: 'asset-1',
        spatialSceneOfferDto: { offered: null },
      });
      expect(emit).toHaveBeenCalledWith('AssetUpdate', updated);
      expect(spatialSceneState.isActive(asset)).toBe(false);
    });

    it('keeps the Spatial view open when the automatic choice still offers it', async () => {
      const asset = photo({ spatialScene: true, spatialSceneChoice: true });
      mocks.sdk.getAssetInfo.mockResolvedValue(photo({ spatialScene: true, spatialSceneChoice: null }));
      spatialSceneState.show('asset-1');

      run(getSpatialSceneActions($t, asset).UseAutomaticSpatialScene);

      await vi.waitFor(() => expect(mocks.toast.primary).toHaveBeenCalledWith('spatial_scene_automatic_photo'));
      expect(spatialSceneState.isActive(asset)).toBe(true);
    });
  });

  describe('Refresh depth map', () => {
    it('queues a new map, without waiting when the photo already shows the button', async () => {
      run(getSpatialSceneActions($t, photo({ spatialScene: true })).RefreshDepthMap);

      await vi.waitFor(() => expect(mocks.toast.primary).toHaveBeenCalledWith('spatial_scene_refreshing_depth_map'));
      expect(mocks.sdk.refreshAssetDepth).toHaveBeenCalledWith({ id: 'asset-1' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mocks.sdk.getAssetInfo).not.toHaveBeenCalled();
    });

    it('waits for the button on a photo that had none, as a missing map would', async () => {
      const ready = photo({ spatialScene: true });
      mocks.sdk.getAssetInfo.mockResolvedValue(ready);

      run(getSpatialSceneActions($t, photo()).RefreshDepthMap);

      await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('AssetUpdate', ready));
    });

    it('reports a refusal', async () => {
      mocks.sdk.refreshAssetDepth.mockRejectedValue(new Error('400'));

      run(getSpatialSceneActions($t, photo()).RefreshDepthMap);

      await vi.waitFor(() => expect(mocks.handleError).toHaveBeenCalled());
      expect(mocks.toast.primary).not.toHaveBeenCalled();
      expect(mocks.sdk.getAssetInfo).not.toHaveBeenCalled();
    });
  });
});
