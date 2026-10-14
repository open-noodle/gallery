import { BadRequestException } from '@nestjs/common';
import { GalleryAssetService } from 'src/gallery/services/gallery-asset.service.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe(GalleryAssetService.name, () => {
  let sut: GalleryAssetService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(GalleryAssetService));
    mocks.assetFavorite.addAll.mockResolvedValue(void 0);
    mocks.assetFavorite.removeAll.mockResolvedValue(void 0);
  });

  describe('updateFavorites', () => {
    it('rejects a shared-link session outright — no repository write happens (E6, §5.1)', async () => {
      const auth = AuthFactory.from().sharedLink().build();

      await expect(sut.updateFavorites(auth, { ids: ['asset-1'], isFavorite: true })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(mocks.access.asset.checkOwnerAccess).not.toHaveBeenCalled();
      expect(mocks.assetFavorite.addAll).not.toHaveBeenCalled();
      expect(mocks.assetFavorite.removeAll).not.toHaveBeenCalled();
    });

    it('requires read access to every id — denial creates no row', async () => {
      const auth = AuthFactory.create();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.updateFavorites(auth, { ids: ['asset-1'], isFavorite: true })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(mocks.assetFavorite.addAll).not.toHaveBeenCalled();
    });

    it('calls addAll for the CALLER only when isFavorite is true', async () => {
      const auth = AuthFactory.create();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1', 'asset-2']));

      await sut.updateFavorites(auth, { ids: ['asset-1', 'asset-2'], isFavorite: true });

      expect(mocks.assetFavorite.addAll).toHaveBeenCalledWith(auth.user.id, ['asset-1', 'asset-2']);
      expect(mocks.assetFavorite.removeAll).not.toHaveBeenCalled();
    });

    it('calls removeAll for the CALLER only when isFavorite is false', async () => {
      const auth = AuthFactory.create();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));

      await sut.updateFavorites(auth, { ids: ['asset-1'], isFavorite: false });

      expect(mocks.assetFavorite.removeAll).toHaveBeenCalledWith(auth.user.id, ['asset-1']);
      expect(mocks.assetFavorite.addAll).not.toHaveBeenCalled();
    });

    it('favorites an asset the caller only has space-read (not owner/editor) access to (E3)', async () => {
      const auth = AuthFactory.create();
      mocks.access.spaceAsset.checkSpaceAccess.mockResolvedValue(new Set(['asset-1']));

      await sut.updateFavorites(auth, { ids: ['asset-1'], isFavorite: true });

      expect(mocks.assetFavorite.addAll).toHaveBeenCalledWith(auth.user.id, ['asset-1']);
    });

    it('elevated session permission does not change WHO the write is attributed to (E7)', async () => {
      const auth = AuthFactory.from().session({ hasElevatedPermission: true }).build();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));

      await sut.updateFavorites(auth, { ids: ['asset-1'], isFavorite: true });

      // Still always the caller — elevated permission only ever widens the caller's OWN read
      // access (e.g. their own Locked assets), never lets them write on someone else's behalf.
      expect(mocks.assetFavorite.addAll).toHaveBeenCalledWith(auth.user.id, ['asset-1']);
    });
  });

  describe('getEditable (#734)', () => {
    it('S-33: returns only the editable subset', async () => {
      const auth = AuthFactory.create();
      const mine = newUuid();
      const editable = newUuid();
      const forbidden = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([mine]));
      mocks.access.spaceAsset.checkSpaceEditAccess.mockResolvedValue(new Set([editable]));

      const result = await sut.getEditable(auth, { assetIds: [mine, editable, forbidden] });

      expect(new Set(result.editableAssetIds)).toEqual(new Set([mine, editable]));
    });

    it('S-34: handles an empty request without error', async () => {
      const auth = AuthFactory.create();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.spaceAsset.checkSpaceEditAccess.mockResolvedValue(new Set());

      await expect(sut.getEditable(auth, { assetIds: [] })).resolves.toEqual({ editableAssetIds: [] });
    });

    it('S-35: silently excludes an unknown id rather than 404ing', async () => {
      const auth = AuthFactory.create();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.spaceAsset.checkSpaceEditAccess.mockResolvedValue(new Set());

      await expect(sut.getEditable(auth, { assetIds: [newUuid()] })).resolves.toEqual({ editableAssetIds: [] });
    });
  });
});
