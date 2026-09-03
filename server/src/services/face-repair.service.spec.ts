import { NotFoundException } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { AssetFileType, CacheControl } from 'src/enum';
import { FaceRepairService } from 'src/services/face-repair.service';
import { ImmichFileResponse, ImmichStreamResponse } from 'src/utils/file';
import { AssetFaceFactory } from 'test/factories/asset-face.factory';
import { getForAssetFace } from 'test/mappers';
import { newTestService, ServiceMocks } from 'test/utils';

// #1061: a stored flagged face carrying the photo context getScanFlaggedFaces now returns.
const stored = (assetFaceId: string) => ({
  assetFaceId,
  suspectedOwnerId: 'owner-1',
  localDateTime: new Date('2019-07-04T10:30:00.000Z'),
  boundingBoxX1: 10,
  boundingBoxY1: 20,
  boundingBoxX2: 30,
  boundingBoxY2: 40,
  imageWidth: 400,
  imageHeight: 300,
});

// Slice 7: admin cleanup + resolutions surfaces need to render face crops for faces the admin does not own.
// getAdminFaceThumbnail is a join-free, tombstone-inclusive read — no person join, no ownership check.
describe(FaceRepairService.name, () => {
  let sut: FaceRepairService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(FaceRepairService));
  });

  // The whole point of getAdminFacePreview is that it is CHEAPER than the crop it sits beside:
  // getFaceThumbnailSource already located a generated preview file, so serving it uncropped is a straight
  // backend serve — no decode, no sharp, no temp dir. T2.2 and T2.8 are the tests that keep it that way.
  const stubServe = () =>
    vi
      .spyOn(sut as any, 'serveFromBackend')
      .mockResolvedValue(
        new ImmichFileResponse({ path: '/preview.jpg', contentType: 'image/jpeg', cacheControl: CacheControl.None }),
      );

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

  describe('getAdminFacePreview', () => {
    it('T2.1/T2.2/T2.7/T2.8: serves another user’s preview uncropped, via the backend, cached', async () => {
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1' });
      mocks.person.getFaceByIdOnLiveAsset.mockResolvedValue(getForAssetFace(face));
      mocks.asset.getForThumbnail.mockResolvedValue({ path: '/preview.jpg' } as any);
      const serve = stubServe();

      await sut.getAdminFacePreview('face-1');

      expect(mocks.person.getFaceByIdOnLiveAsset).toHaveBeenCalledWith('face-1');
      expect(mocks.access.person.checkOwnerAccess).not.toHaveBeenCalled();
      expect(mocks.media.generateThumbnail).not.toHaveBeenCalled(); // uncropped: no sharp pass
      expect(mocks.media.decodeImage).not.toHaveBeenCalled();
      expect(serve).toHaveBeenCalledWith('/preview.jpg', 'image/jpeg', CacheControl.PrivateWithCache);
    });

    it('T2.9: asks for the UNEDITED preview — the box lives in that image’s coordinate space', async () => {
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1' });
      mocks.person.getFaceByIdOnLiveAsset.mockResolvedValue(getForAssetFace(face));
      mocks.asset.getForThumbnail.mockResolvedValue({ path: '/preview.jpg' } as any);
      stubServe();

      await sut.getAdminFacePreview('face-1');

      expect(mocks.asset.getForThumbnail).toHaveBeenCalledWith('asset-1', AssetFileType.Preview, false);
    });

    it('T2.3: falls back to the thumbnail file when there is no preview file', async () => {
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1' });
      mocks.person.getFaceByIdOnLiveAsset.mockResolvedValue(getForAssetFace(face));
      mocks.asset.getForThumbnail
        .mockResolvedValueOnce({ path: null } as any)
        .mockResolvedValueOnce({ path: '/thumb.jpg' } as any);
      const serve = stubServe();

      await sut.getAdminFacePreview('face-1');

      expect(serve).toHaveBeenCalledWith('/thumb.jpg', 'image/jpeg', CacheControl.PrivateWithCache);
    });

    it('T2.6: derives the content type from the file — a webp preview is not served as jpeg', async () => {
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1' });
      mocks.person.getFaceByIdOnLiveAsset.mockResolvedValue(getForAssetFace(face));
      mocks.asset.getForThumbnail.mockResolvedValue({ path: '/preview.webp' } as any);
      const serve = stubServe();

      await sut.getAdminFacePreview('face-1');

      expect(serve).toHaveBeenCalledWith('/preview.webp', 'image/webp', CacheControl.PrivateWithCache);
    });

    it('T2.5: throws NotFound for an unknown, trashed or locked face id — all indistinguishable', async () => {
      mocks.person.getFaceByIdOnLiveAsset.mockRejectedValue(new Error('no rows'));

      await expect(sut.getAdminFacePreview('nope')).rejects.toThrow(NotFoundException);
    });

    it('T2.4: throws NotFound when the asset has neither a preview nor a thumbnail file', async () => {
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1' });
      mocks.person.getFaceByIdOnLiveAsset.mockResolvedValue(getForAssetFace(face));
      mocks.asset.getForThumbnail.mockResolvedValue({ path: null } as any);

      await expect(sut.getAdminFacePreview('face-1')).rejects.toThrow(NotFoundException);
    });
  });

  // #1061: the console needs enough of the source photo to judge a face in context. getPersonFlaggedFaces
  // is the read the person-detail grid hits, so the stored context has to survive verdict filtering intact —
  // and disappear cleanly for a face the filter removes, rather than leaking a stale context row.
  describe('getPersonFlaggedFaces photo context', () => {
    it('T2.10: carries the context of a surviving face through the verdict filter', async () => {
      mocks.faceRepairScan.getLatestScan.mockResolvedValue({ id: 'scan-1' } as any);
      mocks.faceRepairScan.getScanFlaggedFaces.mockResolvedValue([stored('face-1')]);
      vi.spyOn(sut as any, 'buildVerdictMaps').mockResolvedValue({
        manualLinkedFaceIds: new Set(),
        negativeFaceTargets: new Map(),
        ownerTokens: new Map(),
        mutedPersons: new Map(),
      });

      const result = await sut.getPersonFlaggedFaces('person-1');

      expect(result.flaggedFaces).toEqual([expect.objectContaining({ assetFaceId: 'face-1', imageWidth: 400 })]);
    });

    it('T2.11: a face the verdict layer removes contributes no context', async () => {
      mocks.faceRepairScan.getLatestScan.mockResolvedValue({ id: 'scan-1' } as any);
      mocks.faceRepairScan.getScanFlaggedFaces.mockResolvedValue([stored('face-1')]);
      // Settled by a manual link — the same mechanism the dashboard uses to drop a face.
      vi.spyOn(sut as any, 'buildVerdictMaps').mockResolvedValue({
        manualLinkedFaceIds: new Set(['face-1']),
        negativeFaceTargets: new Map(),
        ownerTokens: new Map(),
        mutedPersons: new Map(),
      });

      const result = await sut.getPersonFlaggedFaces('person-1');

      expect(result.flaggedFaces).toEqual([]);
    });
  });
});
