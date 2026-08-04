import { AssetEditAction, getAssetInfo, type AssetEditActionItemDto, type AssetResponseDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { vitest } from 'vitest';
import { authManager } from '$lib/managers/auth-manager.svelte';
import AssetAddToCollectionModal from '$lib/modals/AssetAddToCollectionModal.svelte';
import {
  getAssetActions,
  getAssetBulkActions,
  handleDownloadAsset,
  mergeRotation,
  normalizeAngle,
} from '$lib/services/asset.service';
import { setSharedLink } from '$lib/utils';
import { getFormatter } from '$lib/utils/i18n';
import { assetFactory } from '@test-data/factories/asset-factory';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { sharedLinkFactory } from '@test-data/factories/shared-link-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';

const { downloadUrlMock } = vitest.hoisted(() => ({
  downloadUrlMock: vitest.fn(),
}));

vitest.mock('@immich/ui', () => ({
  toastManager: {
    primary: vitest.fn(),
  },
  modalManager: { show: vitest.fn() },
}));

vitest.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({
  assetMultiSelectManager: { assets: [{ id: 'x1' }, { id: 'x2' }] },
}));

vitest.mock('$lib/utils/i18n', () => ({
  getFormatter: vitest.fn(),
  getPreferredLocale: vitest.fn(),
}));

vitest.mock('@immich/sdk', async () => {
  const originalModule = await vitest.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return {
    ...originalModule,
    getAssetInfo: vitest.fn(),
  };
});

vitest.mock('$lib/managers/asset-viewer-manager.svelte', () => ({
  assetViewerManager: {
    setAsset: vitest.fn(),
  },
}));

vitest.mock('$lib/utils', async () => {
  const originalModule = await vitest.importActual('$lib/utils');
  return {
    ...originalModule,
    sleep: vitest.fn(),
    downloadUrl: downloadUrlMock,
  };
});

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), function () {
  return {
    featureFlagsManager: { init: vi.fn(), loadFeatureFlags: vi.fn(), value: {} } as never,
  };
});

describe('AssetService', () => {
  describe('getAssetActions', () => {
    beforeEach(() => {
      authManager.setPreferences(preferencesFactory.build());
    });

    it('should allow shared link downloads if the user owns the asset and shared link downloads are disabled', () => {
      const ownerId = 'owner';
      const user = userAdminFactory.build({ id: ownerId });
      const asset = assetFactory.build({ ownerId });
      authManager.setUser(user);
      setSharedLink(sharedLinkFactory.build({ allowDownload: false }));
      const assetActions = getAssetActions(() => '', asset);
      expect(assetActions.SharedLinkDownload.$if?.()).toStrictEqual(true);
    });

    it('should not allow shared link downloads if the user does not own the asset and shared link downloads are disabled', () => {
      const ownerId = 'owner';
      const user = userAdminFactory.build({ id: 'non-owner' });
      const asset = assetFactory.build({ ownerId });
      authManager.setUser(user);
      setSharedLink(sharedLinkFactory.build({ allowDownload: false }));
      const assetActions = getAssetActions(() => '', asset);
      expect(assetActions.SharedLinkDownload.$if?.()).toStrictEqual(false);
    });

    it('should allow shared link downloads if shared link downloads are enabled regardless of user', () => {
      const asset = assetFactory.build();
      setSharedLink(sharedLinkFactory.build({ allowDownload: true }));
      const assetActions = getAssetActions(() => '', asset);
      expect(assetActions.SharedLinkDownload.$if?.()).toStrictEqual(true);
    });

    it('should offer the share action if the user owns the asset', () => {
      const ownerId = 'owner';
      authManager.setUser(userAdminFactory.build({ id: ownerId }));
      setSharedLink(undefined);
      const asset = assetFactory.build({ ownerId });
      const assetActions = getAssetActions(() => '', asset);
      expect(assetActions.Share.$if?.()).toStrictEqual(true);
    });

    it('should offer the share action if a shared link stripped the asset owner', () => {
      // A `showMetadata: false` shared link returns SanitizedAssetResponseDto, which omits `ownerId`
      // altogether, so ownership is unknowable client-side. The owner still has to get the button.
      authManager.setUser(userAdminFactory.build({ id: 'owner' }));
      setSharedLink(sharedLinkFactory.build({ allowDownload: false }));
      const { ownerId: _, ...sanitized } = assetFactory.build();
      const assetActions = getAssetActions(() => '', sanitized as AssetResponseDto);
      expect(assetActions.Share.$if?.()).toStrictEqual(true);
    });

    it('should not offer the share action if the user does not own the asset', () => {
      // Server-side `Permission.AssetShare` is owner ∪ partner only — album or space membership
      // grants no share access, so a shared-album/space viewer would get
      // "Not found or no asset.share access" from POST /shared-links (#871).
      authManager.setUser(userAdminFactory.build({ id: 'non-owner' }));
      setSharedLink(undefined);
      const asset = assetFactory.build({ ownerId: 'owner' });
      const assetActions = getAssetActions(() => '', asset);
      expect(assetActions.Share.$if?.()).toStrictEqual(false);
    });
  });

  describe('normalizeAngle', () => {
    it('should return 0 for 0', () => {
      expect(normalizeAngle(0)).toBe(0);
    });

    it('should return 90 for 90', () => {
      expect(normalizeAngle(90)).toBe(90);
    });

    it('should convert -90 to 270', () => {
      expect(normalizeAngle(-90)).toBe(270);
    });

    it('should convert 360 to 0', () => {
      expect(normalizeAngle(360)).toBe(0);
    });

    it('should convert 450 to 90', () => {
      expect(normalizeAngle(450)).toBe(90);
    });

    it('should convert -180 to 180', () => {
      expect(normalizeAngle(-180)).toBe(180);
    });
  });

  describe('mergeRotation', () => {
    it('should add rotation to empty edits', () => {
      const result = mergeRotation([], 90);
      expect(result).toEqual([{ action: AssetEditAction.Rotate, parameters: { angle: 90 } }]);
    });

    it('should merge rotation with existing rotation', () => {
      const existing: AssetEditActionItemDto[] = [{ action: AssetEditAction.Rotate, parameters: { angle: 90 } }];
      const result = mergeRotation(existing, 90);
      expect(result).toEqual([{ action: AssetEditAction.Rotate, parameters: { angle: 180 } }]);
    });

    it('should remove rotation when merged angle is 0 (full circle)', () => {
      const existing: AssetEditActionItemDto[] = [{ action: AssetEditAction.Rotate, parameters: { angle: 270 } }];
      const result = mergeRotation(existing, 90);
      expect(result).toEqual([]);
    });

    it('should preserve other edit actions when merging', () => {
      const existing: AssetEditActionItemDto[] = [
        { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 100, height: 100 } },
        { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
      ];
      const result = mergeRotation(existing, 90);
      expect(result).toEqual([
        { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 100, height: 100 } },
        { action: AssetEditAction.Rotate, parameters: { angle: 180 } },
      ]);
    });

    it('should preserve other edit actions when rotation cancels out', () => {
      const existing: AssetEditActionItemDto[] = [
        { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 100, height: 100 } },
        { action: AssetEditAction.Rotate, parameters: { angle: 270 } },
      ];
      const result = mergeRotation(existing, 90);
      expect(result).toEqual([{ action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 100, height: 100 } }]);
    });

    it('should handle rotate left (270 degrees)', () => {
      const result = mergeRotation([], 270);
      expect(result).toEqual([{ action: AssetEditAction.Rotate, parameters: { angle: 270 } }]);
    });

    it('should handle 180 degree rotation', () => {
      const result = mergeRotation([], 180);
      expect(result).toEqual([{ action: AssetEditAction.Rotate, parameters: { angle: 180 } }]);
    });

    it('should handle multiple successive rotations correctly', () => {
      let edits: AssetEditActionItemDto[] = [];
      edits = mergeRotation(edits, 90); // 90
      edits = mergeRotation(edits, 90); // 180
      edits = mergeRotation(edits, 90); // 270
      expect(edits).toEqual([{ action: AssetEditAction.Rotate, parameters: { angle: 270 } }]);
      edits = mergeRotation(edits, 90); // 360 -> 0 -> removed
      expect(edits).toEqual([]);
    });
  });

  describe('handleDownloadAsset', () => {
    it('should use the asset originalFileName when showing toasts', async () => {
      const $t = vitest.fn().mockReturnValue('formatter');
      vitest.mocked(getFormatter).mockResolvedValue($t);
      const asset = assetFactory.build({ originalFileName: 'asset.heic' });
      await handleDownloadAsset(asset, { edited: false });
      expect($t).toHaveBeenNthCalledWith(1, 'downloading_asset_filename', { values: { filename: 'asset.heic' } });
      expect(toastManager.primary).toHaveBeenCalledWith('formatter');
    });

    it('should use the motion asset originalFileName when showing toasts', async () => {
      const $t = vitest.fn().mockReturnValue('formatter');
      vitest.mocked(getFormatter).mockResolvedValue($t);
      const motionAsset = assetFactory.build({ originalFileName: 'asset.mov' });
      vitest.mocked(getAssetInfo).mockResolvedValue(motionAsset);
      const asset = assetFactory.build({ originalFileName: 'asset.heic', livePhotoVideoId: '1' });
      await handleDownloadAsset(asset, { edited: false });
      expect($t).toHaveBeenNthCalledWith(1, 'downloading_asset_filename', { values: { filename: 'asset.heic' } });
      expect($t).toHaveBeenNthCalledWith(2, 'downloading_asset_filename', { values: { filename: 'asset-motion.mov' } });
      expect(toastManager.primary).toHaveBeenCalledWith('formatter');
    });

    it('should request attachment disposition for single-asset downloads', async () => {
      downloadUrlMock.mockClear();
      const $t = vitest.fn().mockReturnValue('formatter');
      vitest.mocked(getFormatter).mockResolvedValue($t);
      const asset = assetFactory.build({ id: 'asset-1', originalFileName: 'asset.jpg', thumbhash: 'cache-1' });

      await handleDownloadAsset(asset, { edited: false });

      expect(downloadUrlMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/assets/asset-1/original'),
        'asset.jpg',
      );
      expect(downloadUrlMock.mock.calls[0][0]).toContain('download=true');
      expect(downloadUrlMock.mock.calls[0][0]).toContain('edited=false');
      expect(downloadUrlMock.mock.calls[0][0]).toContain('c=cache-1');
    });
  });
});

describe('add to album/space entry points', () => {
  beforeEach(() => vitest.mocked(modalManager.show).mockClear());

  it('timeline bulk "+" opens the unified collection modal with the selected ids', () => {
    const action = getAssetBulkActions(((k: string) => k) as never).AddToAlbum;
    action.onAction(action);
    expect(modalManager.show).toHaveBeenCalledWith(AssetAddToCollectionModal, {
      assetIds: ['x1', 'x2'],
      restrictToSpaceId: undefined,
    });
  });

  it('bulk "+" carries the space restriction through to the modal when the selection is not all-owned', () => {
    const action = getAssetBulkActions(((k: string) => k) as never, { restrictToSpaceId: 'space-1' }).AddToAlbum;
    action.onAction(action);
    expect(modalManager.show).toHaveBeenCalledWith(AssetAddToCollectionModal, {
      assetIds: ['x1', 'x2'],
      restrictToSpaceId: 'space-1',
    });
  });

  it('single-photo viewer "+" opens the unified collection modal with the one id', () => {
    const asset = assetFactory.build({ id: 'single-1' });
    const action = getAssetActions(() => '', asset).AddToAlbum;
    action.onAction(action);
    expect(modalManager.show).toHaveBeenCalledWith(AssetAddToCollectionModal, { assetIds: ['single-1'] });
  });

  // #889: the viewer used to offer every personal album for a space photo the caller does not own.
  // The server can only ever accept those as #764 contributions into an album linked to the space,
  // so an unrestricted picker guaranteed "assets cannot be added to the album".
  describe('single-photo viewer "+" on a space surface', () => {
    // `authManager.authenticated` — and with it the ownership check — is false unless BOTH the
    // user and the preferences are set, so setting only the user would make every case look
    // non-owned and the assertions unfalsifiable.
    beforeEach(() => authManager.setPreferences(preferencesFactory.build()));
    afterEach(() => authManager.reset());

    it('narrows the picker to the space when a space editor opens a photo they do not own', () => {
      authManager.setUser(userAdminFactory.build({ id: 'editor-1' }));
      const asset = assetFactory.build({ id: 'not-mine', ownerId: 'someone-else' });

      const action = getAssetActions(() => '', asset, { space: { id: 'space-1', canWrite: true } }).AddToAlbum;
      action.onAction(action);

      expect(action.$if?.()).toBe(true);
      expect(modalManager.show).toHaveBeenCalledWith(AssetAddToCollectionModal, {
        assetIds: ['not-mine'],
        restrictToSpaceId: 'space-1',
      });
    });

    it('leaves the picker unrestricted for a photo the space editor owns', () => {
      authManager.setUser(userAdminFactory.build({ id: 'editor-1' }));
      const asset = assetFactory.build({ id: 'mine', ownerId: 'editor-1' });

      const action = getAssetActions(() => '', asset, { space: { id: 'space-1', canWrite: true } }).AddToAlbum;
      action.onAction(action);

      expect(action.$if?.()).toBe(true);
      expect(modalManager.show).toHaveBeenCalledWith(AssetAddToCollectionModal, {
        assetIds: ['mine'],
        restrictToSpaceId: undefined,
      });
    });

    it('hides the action for a space viewer looking at a photo they do not own', () => {
      authManager.setUser(userAdminFactory.build({ id: 'viewer-1' }));
      const asset = assetFactory.build({ id: 'not-mine', ownerId: 'someone-else' });

      const action = getAssetActions(() => '', asset, { space: { id: 'space-1', canWrite: false } }).AddToAlbum;

      expect(action.$if?.()).toBe(false);
    });

    it('keeps the action off a space surface for a photo the user does not own', () => {
      // Partner-shared assets legitimately reach the caller's own album through
      // Permission.AssetShare, which the viewer cannot evaluate — so it must not gate on ownership
      // outside a space.
      authManager.setUser(userAdminFactory.build({ id: 'partner-of-owner' }));
      const asset = assetFactory.build({ id: 'partners-photo', ownerId: 'the-partner' });

      const action = getAssetActions(() => '', asset).AddToAlbum;
      action.onAction(action);

      expect(action.$if?.()).toBe(true);
      expect(modalManager.show).toHaveBeenCalledWith(AssetAddToCollectionModal, {
        assetIds: ['partners-photo'],
        restrictToSpaceId: undefined,
      });
    });
  });
});
