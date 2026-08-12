import { NotFoundException } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { FaceRepairService } from 'src/services/face-repair.service';
import { ImmichStreamResponse } from 'src/utils/file';
import { AssetFaceFactory } from 'test/factories/asset-face.factory';
import { getForAssetFace } from 'test/mappers';
import { newTestService, ServiceMocks } from 'test/utils';

// Slice 7: admin cleanup + resolutions surfaces need to render face crops for faces the admin does not own.
// getAdminFaceThumbnail is a join-free, tombstone-inclusive read — no person join, no ownership check.
describe(FaceRepairService.name, () => {
  let sut: FaceRepairService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(FaceRepairService));
  });

  describe('getAdminFaceThumbnail', () => {
    it('serves a face crop for a face on another user’s asset, with no ownership check', async () => {
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1' });
      mocks.person.getFaceByIdIncludingTombstoned.mockResolvedValue(getForAssetFace(face));
      mocks.asset.getForThumbnail.mockResolvedValue({ path: '/preview.jpg' } as any);
      vi.spyOn(sut as any, 'ensureLocalFile').mockResolvedValue({ localPath: '/preview.jpg', cleanup: vi.fn() });
      mocks.media.decodeImage.mockResolvedValue({
        data: Buffer.from('img'),
        info: { width: 100, height: 100, channels: 3, format: 'jpeg', size: 0, premultiplied: false },
      } as any);
      mocks.media.generateThumbnail.mockImplementation(async (_input, _options, output) => {
        await writeFile(output, Buffer.from('crop'));
      });

      const result = await sut.getAdminFaceThumbnail('face-1');

      expect(mocks.person.getFaceByIdIncludingTombstoned).toHaveBeenCalledWith('face-1');
      expect(mocks.access.person.checkOwnerAccess).not.toHaveBeenCalled();
      expect(mocks.media.generateThumbnail).toHaveBeenCalled();
      if (result instanceof ImmichStreamResponse) {
        result.stream.destroy();
      }
    });

    it('serves a tombstoned (deletedAt) face — resolutions history still renders', async () => {
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', deletedAt: new Date() });
      mocks.person.getFaceByIdIncludingTombstoned.mockResolvedValue(getForAssetFace(face));
      mocks.asset.getForThumbnail.mockResolvedValue({ path: '/preview.jpg' } as any);
      vi.spyOn(sut as any, 'ensureLocalFile').mockResolvedValue({ localPath: '/preview.jpg', cleanup: vi.fn() });
      mocks.media.decodeImage.mockResolvedValue({
        data: Buffer.from('img'),
        info: { width: 100, height: 100, channels: 3, format: 'jpeg', size: 0, premultiplied: false },
      } as any);
      mocks.media.generateThumbnail.mockImplementation(async (_input, _options, output) => {
        await writeFile(output, Buffer.from('crop'));
      });

      const result = await sut.getAdminFaceThumbnail('face-1');

      expect(mocks.media.generateThumbnail).toHaveBeenCalled();
      if (result instanceof ImmichStreamResponse) {
        result.stream.destroy();
      }
    });

    it('throws NotFound for an unknown face id', async () => {
      mocks.person.getFaceByIdIncludingTombstoned.mockRejectedValue(new Error('no rows'));

      await expect(sut.getAdminFaceThumbnail('nope')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFound when the asset has no thumbnail source', async () => {
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1' });
      mocks.person.getFaceByIdIncludingTombstoned.mockResolvedValue(getForAssetFace(face));
      mocks.asset.getForThumbnail.mockResolvedValue({ path: null } as any);

      await expect(sut.getAdminFaceThumbnail('face-1')).rejects.toThrow(NotFoundException);
    });

    // Slice 1 (F1): the visibility refusal for a Locked-asset face lives in the repository query
    // (getFaceByIdIncludingTombstoned now joins asset and filters on reviewableAssetVisibility — see
    // person.repository.spec.ts for the query-level proof that actually exercises the DB), not in this
    // service — this method has NO service-level change. A Locked-asset id takes the exact same path as
    // the "unknown face id" case above (repository's executeTakeFirstOrThrow throws, caught here as a
    // NotFoundException), which is already covered; adding a second mock-only test for it here would only
    // assert that a mock rejects, not that the real filtering exists — deliberately not duplicated.
  });
});
