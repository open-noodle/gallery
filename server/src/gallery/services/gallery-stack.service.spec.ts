import { GalleryStackService } from 'src/gallery/services/gallery-stack.service.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const asset = (id: string, stackId: string | null) => ({ id, stackId }) as never;
const stack = (id: string, memberIds: string[]) =>
  ({ id, assets: memberIds.map((memberId) => ({ id: memberId })) }) as never;

describe(GalleryStackService.name, () => {
  let sut: GalleryStackService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(GalleryStackService));
    mocks.stack.update.mockResolvedValue({} as never);
  });

  describe('onAssetsTrash (#1187)', () => {
    it('promotes the first remaining member when the cover is trashed', async () => {
      mocks.asset.getByIds.mockResolvedValue([asset('cover', 'stack-1')]);
      mocks.stack.getForAssetRemoval.mockResolvedValue({ id: 'stack-1', primaryAssetId: 'cover' });
      // getById lists members outside the trash, oldest first.
      mocks.stack.getById.mockResolvedValue(stack('stack-1', ['b', 'c']));

      await sut.onAssetsTrash({ assetIds: ['cover'], userId: 'user-1' });

      expect(mocks.stack.update).toHaveBeenCalledWith('stack-1', { id: 'stack-1', primaryAssetId: 'b' });
    });

    it('skips members trashed in the same batch', async () => {
      mocks.asset.getByIds.mockResolvedValue([asset('cover', 'stack-1'), asset('b', 'stack-1')]);
      mocks.stack.getForAssetRemoval.mockResolvedValue({ id: 'stack-1', primaryAssetId: 'cover' });
      mocks.stack.getById.mockResolvedValue(stack('stack-1', ['b', 'c']));

      await sut.onAssetsTrash({ assetIds: ['cover', 'b'], userId: 'user-1' });

      expect(mocks.stack.update).toHaveBeenCalledTimes(1);
      expect(mocks.stack.update).toHaveBeenCalledWith('stack-1', { id: 'stack-1', primaryAssetId: 'c' });
    });

    it('leaves the stack alone when a non-cover member is trashed', async () => {
      mocks.asset.getByIds.mockResolvedValue([asset('b', 'stack-1')]);
      mocks.stack.getForAssetRemoval.mockResolvedValue({ id: 'stack-1', primaryAssetId: 'cover' });

      await sut.onAssetsTrash({ assetIds: ['b'], userId: 'user-1' });

      expect(mocks.stack.getById).not.toHaveBeenCalled();
      expect(mocks.stack.update).not.toHaveBeenCalled();
    });

    it('does nothing for assets outside a stack', async () => {
      mocks.asset.getByIds.mockResolvedValue([asset('loose', null)]);

      await sut.onAssetsTrash({ assetIds: ['loose'], userId: 'user-1' });

      expect(mocks.stack.getForAssetRemoval).not.toHaveBeenCalled();
      expect(mocks.stack.update).not.toHaveBeenCalled();
    });

    it('keeps the cover when every member is in the trash', async () => {
      mocks.asset.getByIds.mockResolvedValue([asset('cover', 'stack-1')]);
      mocks.stack.getForAssetRemoval.mockResolvedValue({ id: 'stack-1', primaryAssetId: 'cover' });
      mocks.stack.getById.mockResolvedValue(stack('stack-1', []));

      await sut.onAssetsTrash({ assetIds: ['cover'], userId: 'user-1' });

      expect(mocks.stack.update).not.toHaveBeenCalled();
    });
  });
});
