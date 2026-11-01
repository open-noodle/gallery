import { BadRequestException, NotFoundException } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoFaceService } from 'src/gallery/services/video-face.service.js';
import { StorageService } from 'src/services/storage.service.js';
import { ImmichStreamResponse } from 'src/utils/file.js';
import { AssetFaceFactory } from 'test/factories/asset-face.factory.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe(VideoFaceService.name, () => {
  let sut: VideoFaceService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    vi.restoreAllMocks();
    ({ sut, mocks } = newTestService(VideoFaceService));
  });

  describe('onAssetDelete', () => {
    it("deletes the video's frame folder, found by its deterministic path", async () => {
      const deletePrefix = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ deletePrefix } as any);

      await sut.onAssetDelete({ assetId: 'asset-1', userId: 'owner-1' });

      expect(deletePrefix).toHaveBeenCalledWith('thumbs/owner-1/as/se/asset-1_faces/');
    });

    it('does not fail the delete when the folder cannot be removed', async () => {
      const deletePrefix = vi.fn().mockRejectedValue(new Error('denied'));
      vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ deletePrefix } as any);

      await expect(sut.onAssetDelete({ assetId: 'asset-1', userId: 'owner-1' })).resolves.toBeUndefined();
    });
  });

  describe('getFaceThumbnail', () => {
    const auth = AuthFactory.create();
    const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personGroupId: null });

    const expectCropFrom = async (sourcePath: string) => {
      const ensureLocalFile = vi
        .spyOn((sut as any).backendMedia, 'ensureLocalFile')
        .mockResolvedValue({ localPath: sourcePath, cleanup: vi.fn() });
      mocks.media.decodeImage.mockResolvedValue({
        data: Buffer.from('decoded'),
        info: { width: 1920, height: 1080, channels: 3 },
      } as any);
      mocks.media.generateThumbnail.mockImplementation(async (_input, _options, output) => {
        await writeFile(output, Buffer.from('crop'));
      });

      const result = await sut.getFaceThumbnail(auth, 'face-1');

      expect(ensureLocalFile).toHaveBeenCalledWith(sourcePath);
      if (result instanceof ImmichStreamResponse) {
        result.stream.destroy();
      }
    };

    it('crops a sampled video face from its best frame', async () => {
      mocks.person.getFaceByIdOnLiveAsset.mockResolvedValue(face as any);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
      mocks.videoFace.getFramePath.mockResolvedValue('/data/thumbs/owner/as/se/asset-1_faces/face-1.jpeg');

      await expectCropFrom('/data/thumbs/owner/as/se/asset-1_faces/face-1.jpeg');
      expect(mocks.videoFace.getFramePath).toHaveBeenCalledWith('face-1');
    });

    it('crops any other face from the preview, as the person-keyed crops do', async () => {
      mocks.person.getFaceByIdOnLiveAsset.mockResolvedValue(face as any);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
      mocks.videoFace.getFramePath.mockResolvedValue(undefined);
      mocks.asset.getForThumbnail.mockResolvedValue({ path: '/data/thumbs/preview.jpeg' } as any);

      await expectCropFrom('/data/thumbs/preview.jpeg');
    });

    it('requires read access to the asset', async () => {
      mocks.person.getFaceByIdOnLiveAsset.mockResolvedValue(face as any);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.getFaceThumbnail(auth, 'face-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.media.generateThumbnail).not.toHaveBeenCalled();
    });

    it('is not found for an unknown face, or one on a trashed asset', async () => {
      mocks.person.getFaceByIdOnLiveAsset.mockRejectedValue(new Error('no result'));

      await expect(sut.getFaceThumbnail(auth, 'face-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
