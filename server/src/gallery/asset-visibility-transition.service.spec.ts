import { AssetVisibilityTransitionService } from 'src/gallery/asset-visibility-transition.service.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe(AssetVisibilityTransitionService.name, () => {
  let sut: AssetVisibilityTransitionService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(AssetVisibilityTransitionService));
    for (const verb of ['Purge', 'Restore'] as const) {
      for (const path of ['Direct', 'Album', 'Library'] as const) {
        mocks.sharedSpace[`emit${path}AssetVisibility${verb}`].mockResolvedValue(void 0);
      }
    }
  });

  describe('onAssetHide / onAssetShow', () => {
    it('purges direct/album/library space paths when a motion asset is hidden (motion bypass)', async () => {
      const assetId = newUuid();
      await sut.onAssetHide({ assetId, userId: newUuid() });
      expect(mocks.sharedSpace.emitDirectAssetVisibilityPurge).toHaveBeenCalledWith([assetId]);
      expect(mocks.sharedSpace.emitAlbumAssetVisibilityPurge).toHaveBeenCalledWith([assetId]);
      expect(mocks.sharedSpace.emitLibraryAssetVisibilityPurge).toHaveBeenCalledWith([assetId]);
    });

    it('restores direct/album space paths when a motion asset is shown again (motion bypass)', async () => {
      const assetId = newUuid();
      await sut.onAssetShow({ assetId, userId: newUuid() });
      expect(mocks.sharedSpace.emitDirectAssetVisibilityRestore).toHaveBeenCalledWith([assetId]);
      expect(mocks.sharedSpace.emitAlbumAssetVisibilityRestore).toHaveBeenCalledWith([assetId]);
      expect(mocks.sharedSpace.emitDirectAssetVisibilityPurge).not.toHaveBeenCalled();
    });
  });
});
