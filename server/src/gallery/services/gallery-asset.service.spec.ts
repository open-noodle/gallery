import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssetType, JobName } from 'src/enum.js';
import { GalleryAssetService } from 'src/gallery/services/gallery-asset.service.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const video = (overrides: Record<string, unknown> = {}) => ({
  type: AssetType.Video,
  livePhotoVideoId: null,
  originalPath: '/data/library/video.mp4',
  duration: 30_000,
  startTime: null,
  endTime: null,
  ...overrides,
});
const image = (overrides: Record<string, unknown> = {}) => ({
  type: AssetType.Image,
  livePhotoVideoId: null,
  originalPath: '/data/library/photo.jpg',
  originalFileName: 'photo.jpg',
  exifImageWidth: 1920,
  exifImageHeight: 1080,
  orientation: null,
  projectionType: null,
  ...overrides,
});
const videoStream = { videoStreams: [{}], audioStreams: [{}], format: {} } as any;

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

  describe('getSpaces', () => {
    it("groups the caller's spaces by asset, keeping the assets it can read", async () => {
      const auth = AuthFactory.create();
      const [readable, unreadable, inNoSpace] = [newUuid(), newUuid(), newUuid()];
      const [family, trips] = [newUuid(), newUuid()];
      mocks.sharedSpace.getMemberSpaceIdsByAssetIds.mockResolvedValue([
        { assetId: readable, spaceId: family },
        { assetId: readable, spaceId: trips },
        { assetId: unreadable, spaceId: family },
      ]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([readable]));

      const result = await sut.getSpaces(auth, { assetIds: [readable, unreadable, inNoSpace] });

      expect(mocks.sharedSpace.getMemberSpaceIdsByAssetIds).toHaveBeenCalledWith(auth.user.id, [
        readable,
        unreadable,
        inNoSpace,
      ]);
      expect(mocks.access.asset.checkOwnerAccess).toHaveBeenCalledWith(
        auth.user.id,
        new Set([readable, unreadable]),
        undefined,
      );
      expect(result).toEqual({ assets: [{ assetId: readable, spaceIds: [family, trips] }] });
    });

    it('checks no access when no asset is in a space', async () => {
      const auth = AuthFactory.create();
      mocks.sharedSpace.getMemberSpaceIdsByAssetIds.mockResolvedValue([]);

      await expect(sut.getSpaces(auth, { assetIds: [newUuid()] })).resolves.toEqual({ assets: [] });
      expect(mocks.access.asset.checkOwnerAccess).not.toHaveBeenCalled();
    });

    it("never lists a shared link owner's spaces", async () => {
      const auth = AuthFactory.from().sharedLink().build();

      await expect(sut.getSpaces(auth, { assetIds: [newUuid()] })).resolves.toEqual({ assets: [] });
      expect(mocks.sharedSpace.getMemberSpaceIdsByAssetIds).not.toHaveBeenCalled();
    });
  });

  describe('video trim', () => {
    let assetId: string;
    beforeEach(() => {
      assetId = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    });

    describe('setTrim', () => {
      it('stores the trim, marks the asset edited and queues the edit job', async () => {
        mocks.videoTrim.getForTrim.mockResolvedValue(video());
        mocks.media.probe.mockResolvedValue(videoStream);

        await expect(sut.setTrim(authStub.admin, assetId, { startTime: 5, endTime: 25 })).resolves.toEqual({
          startTime: 5,
          endTime: 25,
          originalDuration: 30,
        });

        expect(mocks.videoTrim.upsert).toHaveBeenCalledWith(assetId, 5, 25);
        expect(mocks.asset.update).toHaveBeenCalledWith({ id: assetId, isEdited: true });
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.AssetEditThumbnailGeneration,
          data: { id: assetId },
        });
      });

      it('requires edit access', async () => {
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());

        await expect(sut.setTrim(authStub.admin, assetId, { startTime: 5, endTime: 25 })).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(mocks.videoTrim.upsert).not.toHaveBeenCalled();
      });

      it('validates against the original duration, so a re-trim may widen an earlier trim', async () => {
        mocks.videoTrim.getForTrim.mockResolvedValue(video({ startTime: 10, endTime: 20 }));
        mocks.media.probe.mockResolvedValue(videoStream);

        await sut.setTrim(authStub.admin, assetId, { startTime: 5, endTime: 25 });

        expect(mocks.videoTrim.upsert).toHaveBeenCalledWith(assetId, 5, 25);
      });

      it('removes an existing trim when given the full range, like DELETE', async () => {
        mocks.videoTrim.getForTrim.mockResolvedValue(video({ startTime: 10, endTime: 20 }));
        mocks.videoTrim.delete.mockResolvedValue(true);

        await expect(sut.setTrim(authStub.admin, assetId, { startTime: 0, endTime: 30 })).resolves.toEqual({
          startTime: 0,
          endTime: 30,
          originalDuration: 30,
        });

        expect(mocks.media.probe).not.toHaveBeenCalled();
        expect(mocks.videoTrim.upsert).not.toHaveBeenCalled();
        expect(mocks.videoTrim.delete).toHaveBeenCalledWith(assetId);
        expect(mocks.asset.update).toHaveBeenCalledWith({ id: assetId, isEdited: false });
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.AssetEditThumbnailGeneration,
          data: { id: assetId },
        });
      });

      it.each([
        ['an image', video({ type: AssetType.Image }), 'Trim is only supported for video assets'],
        ['a live photo', video({ livePhotoVideoId: newUuid() }), 'Trimming live photos is not supported'],
        [
          'an external library video',
          video({ originalPath: '/mnt/external/video.mp4' }),
          'Video trimming is not available for external library videos',
        ],
        ['a video without a duration', video({ duration: null }), 'Video duration is not available'],
        ['a video under 2 seconds', video({ duration: 1500 }), 'Video is too short to trim (minimum 2 seconds)'],
      ])('rejects %s', async (_, asset, message) => {
        mocks.videoTrim.getForTrim.mockResolvedValue(asset);

        await expect(sut.setTrim(authStub.admin, assetId, { startTime: 0, endTime: 1 })).rejects.toThrow(message);
        expect(mocks.media.probe).not.toHaveBeenCalled();
        expect(mocks.videoTrim.upsert).not.toHaveBeenCalled();
      });

      it('rejects an end time past the original duration', async () => {
        mocks.videoTrim.getForTrim.mockResolvedValue(video());

        await expect(sut.setTrim(authStub.admin, assetId, { startTime: 0, endTime: 60 })).rejects.toThrow(
          'End time exceeds video duration',
        );
      });

      it('rejects a first trim that keeps the whole video', async () => {
        mocks.videoTrim.getForTrim.mockResolvedValue(video());

        await expect(sut.setTrim(authStub.admin, assetId, { startTime: 0, endTime: 30 })).rejects.toThrow(
          'Trim must actually remove content',
        );
      });

      it('rejects an audio-only file', async () => {
        mocks.videoTrim.getForTrim.mockResolvedValue(video({ duration: 180_000 }));
        mocks.media.probe.mockResolvedValue({ videoStreams: [], audioStreams: [{}], format: {} } as any);

        await expect(sut.setTrim(authStub.admin, assetId, { startTime: 10, endTime: 60 })).rejects.toThrow(
          'Cannot trim audio-only files',
        );
      });

      it('probes a disk video by its path, without presigning', async () => {
        mocks.videoTrim.getForTrim.mockResolvedValue(video());
        mocks.media.probe.mockResolvedValue(videoStream);

        await sut.setTrim(authStub.admin, assetId, { startTime: 5, endTime: 25 });

        expect(mocks.media.probe).toHaveBeenCalledWith('/data/library/video.mp4');
      });

      it('probes an S3 video through a presigned url', async () => {
        const getReadableUrl = vi.fn().mockResolvedValue('https://bucket.s3/key?X-Amz-Signature=abc');
        const { StorageService } = await import('src/services/storage.service.js');
        vi.spyOn(StorageService, 'backendFor').mockReturnValue({ getReadableUrl } as any);
        mocks.videoTrim.getForTrim.mockResolvedValue(video({ originalPath: 'upload/admin/ab/cd/video.mp4' }));
        mocks.media.probe.mockResolvedValue(videoStream);

        await sut.setTrim(authStub.admin, assetId, { startTime: 5, endTime: 25 });

        expect(getReadableUrl).toHaveBeenCalledWith('upload/admin/ab/cd/video.mp4');
        expect(mocks.media.probe).toHaveBeenCalledWith('https://bucket.s3/key?X-Amz-Signature=abc');
        vi.restoreAllMocks();
      });

      it('never surfaces the presigned url when the probe fails', async () => {
        const getReadableUrl = vi.fn().mockResolvedValue('https://bucket.s3/key?X-Amz-Signature=SECRET');
        const { StorageService } = await import('src/services/storage.service.js');
        vi.spyOn(StorageService, 'backendFor').mockReturnValue({ getReadableUrl } as any);
        mocks.videoTrim.getForTrim.mockResolvedValue(video({ originalPath: 'upload/admin/ab/cd/video.mp4' }));
        mocks.media.probe.mockRejectedValue(new Error('https://bucket.s3/key?X-Amz-Signature=SECRET: Invalid data'));

        const error = await sut
          .setTrim(authStub.admin, assetId, { startTime: 5, endTime: 25 })
          .catch((error_: unknown) => error_);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as Error).message).not.toContain('X-Amz-Signature');
        expect(mocks.logger.error).not.toHaveBeenCalledWith(expect.stringContaining('X-Amz-Signature'));
        vi.restoreAllMocks();
      });

      it('logs a cross-owner trim as a space edit', async () => {
        const auth = AuthFactory.create();
        const spaceId = newUuid();
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
        mocks.access.spaceAsset.checkSpaceEditAccess.mockResolvedValue(new Set([assetId]));
        mocks.sharedSpace.findSpaceForAssetAndUser.mockResolvedValue({ spaceId } as any);
        mocks.videoTrim.getForTrim.mockResolvedValue(video());
        mocks.media.probe.mockResolvedValue(videoStream);

        await sut.setTrim(auth, assetId, { startTime: 5, endTime: 25 });

        expect(mocks.sharedSpace.logActivity).toHaveBeenCalledWith(
          expect.objectContaining({ spaceId, userId: auth.user.id, data: { count: 1, assetIds: [assetId] } }),
        );
      });
    });

    describe('getTrim', () => {
      it('returns the kept range and the original length in seconds', async () => {
        mocks.videoTrim.getForTrim.mockResolvedValue(video({ startTime: 5, endTime: 25 }));

        await expect(sut.getTrim(authStub.admin, assetId)).resolves.toEqual({
          startTime: 5,
          endTime: 25,
          originalDuration: 30,
        });
      });

      it('responds not found for an untrimmed video', async () => {
        mocks.videoTrim.getForTrim.mockResolvedValue(video());

        await expect(sut.getTrim(authStub.admin, assetId)).rejects.toBeInstanceOf(NotFoundException);
      });
    });

    describe('removeTrim', () => {
      it('deletes the trim, clears isEdited and queues the edit job', async () => {
        mocks.videoTrim.delete.mockResolvedValue(true);

        await sut.removeTrim(authStub.admin, assetId);

        expect(mocks.videoTrim.delete).toHaveBeenCalledWith(assetId);
        expect(mocks.asset.update).toHaveBeenCalledWith({ id: assetId, isEdited: false });
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.AssetEditThumbnailGeneration,
          data: { id: assetId },
        });
      });

      it('leaves isEdited alone when the video was not trimmed', async () => {
        mocks.videoTrim.delete.mockResolvedValue(false);

        await sut.removeTrim(authStub.admin, assetId);

        expect(mocks.asset.update).not.toHaveBeenCalled();
        expect(mocks.job.queue).toHaveBeenCalled();
      });

      it('requires edit-delete access', async () => {
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());

        await expect(sut.removeTrim(authStub.admin, assetId)).rejects.toBeInstanceOf(BadRequestException);
        expect(mocks.videoTrim.delete).not.toHaveBeenCalled();
      });
    });
  });

  describe('image adjust', () => {
    let assetId: string;
    const adjust = { exposure: 20, contrast: -10, saturation: 0, invert: true };

    beforeEach(() => {
      assetId = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    });

    describe('getAdjust', () => {
      it('returns the stored adjustment', async () => {
        mocks.imageAdjust.get.mockResolvedValue(adjust);

        await expect(sut.getAdjust(authStub.admin, assetId)).resolves.toEqual(adjust);
      });

      it('returns neutral values for an unadjusted image', async () => {
        mocks.imageAdjust.get.mockResolvedValue(void 0);

        await expect(sut.getAdjust(authStub.admin, assetId)).resolves.toEqual({
          exposure: 0,
          contrast: 0,
          saturation: 0,
          invert: false,
        });
      });

      it('requires read access', async () => {
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());

        await expect(sut.getAdjust(authStub.admin, assetId)).rejects.toBeInstanceOf(BadRequestException);
        expect(mocks.imageAdjust.get).not.toHaveBeenCalled();
      });
    });

    describe('setAdjust', () => {
      it('stores the adjustment and queues the edit job, without touching asset_edit', async () => {
        mocks.asset.getForEdit.mockResolvedValue(image());

        await expect(sut.setAdjust(authStub.admin, assetId, adjust)).resolves.toEqual(adjust);

        expect(mocks.imageAdjust.upsert).toHaveBeenCalledWith(assetId, adjust);
        expect(mocks.assetEdit.replaceAll).not.toHaveBeenCalled();
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.AssetEditThumbnailGeneration,
          data: { id: assetId },
        });
      });

      it('removes the adjustment when every value is neutral, like DELETE', async () => {
        mocks.imageAdjust.delete.mockResolvedValue(true);

        await expect(
          sut.setAdjust(authStub.admin, assetId, { exposure: 0, contrast: 0, saturation: 0, invert: false }),
        ).resolves.toEqual({ exposure: 0, contrast: 0, saturation: 0, invert: false });

        expect(mocks.imageAdjust.upsert).not.toHaveBeenCalled();
        expect(mocks.imageAdjust.delete).toHaveBeenCalledWith(assetId);
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.AssetEditThumbnailGeneration,
          data: { id: assetId },
        });
      });

      it('requires edit access', async () => {
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());

        await expect(sut.setAdjust(authStub.admin, assetId, adjust)).rejects.toBeInstanceOf(BadRequestException);
        expect(mocks.imageAdjust.upsert).not.toHaveBeenCalled();
      });

      it.each([
        { label: 'a missing asset', asset: undefined, message: 'Asset not found' },
        { label: 'a video', asset: image({ type: AssetType.Video }), message: 'Only images can be adjusted' },
        { label: 'a live photo', asset: image({ livePhotoVideoId: newUuid() }), message: 'live photos' },
        { label: 'a panorama', asset: image({ projectionType: 'EQUIRECTANGULAR' }), message: 'panorama' },
        { label: 'a GIF', asset: image({ originalPath: '/data/a.GIF' }), message: 'GIF or SVG' },
        { label: 'an SVG', asset: image({ originalPath: '/data/a.svg' }), message: 'GIF or SVG' },
      ])('rejects $label, as Immich rejects editing it', async ({ asset, message }) => {
        mocks.asset.getForEdit.mockResolvedValue(asset as any);

        await expect(sut.setAdjust(authStub.admin, assetId, adjust)).rejects.toThrow(message);
        expect(mocks.imageAdjust.upsert).not.toHaveBeenCalled();
        expect(mocks.job.queue).not.toHaveBeenCalled();
      });

      it('logs a cross-owner adjustment as a space edit', async () => {
        const auth = AuthFactory.create();
        const spaceId = newUuid();
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
        mocks.access.spaceAsset.checkSpaceEditAccess.mockResolvedValue(new Set([assetId]));
        mocks.sharedSpace.findSpaceForAssetAndUser.mockResolvedValue({ spaceId } as any);
        mocks.asset.getForEdit.mockResolvedValue(image());

        await sut.setAdjust(auth, assetId, adjust);

        expect(mocks.sharedSpace.logActivity).toHaveBeenCalledWith(
          expect.objectContaining({ spaceId, userId: auth.user.id, data: { count: 1, assetIds: [assetId] } }),
        );
      });
    });

    describe('removeAdjust', () => {
      it('deletes the adjustment and queues the edit job', async () => {
        mocks.imageAdjust.delete.mockResolvedValue(true);

        await sut.removeAdjust(authStub.admin, assetId);

        expect(mocks.imageAdjust.delete).toHaveBeenCalledWith(assetId);
        expect(mocks.assetEdit.replaceAll).not.toHaveBeenCalled();
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.AssetEditThumbnailGeneration,
          data: { id: assetId },
        });
      });

      it('requires edit-delete access', async () => {
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());

        await expect(sut.removeAdjust(authStub.admin, assetId)).rejects.toBeInstanceOf(BadRequestException);
        expect(mocks.imageAdjust.delete).not.toHaveBeenCalled();
      });
    });
  });
});
