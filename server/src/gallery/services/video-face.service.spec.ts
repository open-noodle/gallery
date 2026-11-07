import { BadRequestException, NotFoundException } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoFaceSighting } from 'src/schema/tables/asset-face-video-frame.table.js';
import { VideoFaceService } from 'src/gallery/services/video-face.service.js';
import { StorageService } from 'src/services/storage.service.js';
import { ImmichStreamResponse } from 'src/utils/file.js';
import { AssetFaceFactory } from 'test/factories/asset-face.factory.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

// Sightings in a 1000 x 500 frame, for removing and restoring.
const fraction = (x1: number, y1: number, x2: number, y2: number) => ({
  x1: x1 / 1000,
  y1: y1 / 500,
  x2: x2 / 1000,
  y2: y2 / 500,
});

const storedWith = (sightings: VideoFaceSighting[], timeSeconds = 4) => ({
  sightings,
  timeSeconds,
  imageWidth: 1000,
  imageHeight: 500,
  originalPath: 'upload/owner/video.mp4',
  framePath: 'thumbs/owner/fa/ce/face-1.jpeg',
  trimStart: null,
  trimEnd: null,
});

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
      mocks.galleryPerson.getFaceByIdOnLiveAsset.mockResolvedValue(face as any);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
      mocks.videoFace.getFramePath.mockResolvedValue('/data/thumbs/owner/as/se/asset-1_faces/face-1.jpeg');

      await expectCropFrom('/data/thumbs/owner/as/se/asset-1_faces/face-1.jpeg');
      expect(mocks.videoFace.getFramePath).toHaveBeenCalledWith('face-1');
    });

    it('crops a small sampled video face with its surroundings', async () => {
      const small = {
        ...face,
        imageWidth: 1920,
        imageHeight: 1080,
        boundingBoxX1: 500,
        boundingBoxY1: 300,
        boundingBoxX2: 526,
        boundingBoxY2: 330,
      };
      mocks.galleryPerson.getFaceByIdOnLiveAsset.mockResolvedValue(small as any);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
      mocks.videoFace.getFramePath.mockResolvedValue('/data/thumbs/owner/as/se/asset-1_faces/face-1.jpeg');

      await expectCropFrom('/data/thumbs/owner/as/se/asset-1_faces/face-1.jpeg');

      // The 26 x 30 px face is cropped from a 65 x 75 px region around it.
      const [, options] = mocks.media.generateThumbnail.mock.calls[0];
      const crop = (options.edits as { parameters: { width: number } }[])[0].parameters;
      expect(crop.width).toBeGreaterThanOrEqual(75);
    });

    it('crops any other face from the preview, as the person-keyed crops do', async () => {
      mocks.galleryPerson.getFaceByIdOnLiveAsset.mockResolvedValue(face as any);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
      mocks.videoFace.getFramePath.mockResolvedValue(undefined);
      mocks.asset.getForThumbnail.mockResolvedValue({ path: '/data/thumbs/preview.jpeg' } as any);

      await expectCropFrom('/data/thumbs/preview.jpeg');
    });

    it('requires read access to the asset', async () => {
      mocks.galleryPerson.getFaceByIdOnLiveAsset.mockResolvedValue(face as any);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.getFaceThumbnail(auth, 'face-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.media.generateThumbnail).not.toHaveBeenCalled();
    });

    it('is not found for an unknown face, or one on a trashed asset', async () => {
      mocks.galleryPerson.getFaceByIdOnLiveAsset.mockRejectedValue(new Error('no result'));

      await expect(sut.getFaceThumbnail(auth, 'face-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getSightings', () => {
    const auth = AuthFactory.create();
    const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1' });
    const box = { x1: 10, y1: 10, x2: 50, y2: 50 };

    beforeEach(() => {
      mocks.galleryPerson.getFaceByIdOnLiveAsset.mockResolvedValue(face as any);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
    });

    it("returns the face's sightings on the player timeline", async () => {
      mocks.videoFace.getSightings.mockResolvedValue({
        sightings: [
          { t: 8, score: 0.9, ...box },
          { t: 3, score: 0.6, ...box },
        ],
        timeSeconds: 8,
        imageWidth: 100,
        imageHeight: 200,
        originalPath: '/data/library/video.mp4',
        framePath: 'thumbs/owner/fa/ce/face-1.jpeg',
        trimStart: 2,
        trimEnd: null,
      });

      const fraction = { x1: 0.1, y1: 0.05, x2: 0.5, y2: 0.25 };
      await expect(sut.getSightings(auth, 'face-1')).resolves.toEqual({
        sightings: [
          { time: 1, score: 0.6, isBest: false, box: fraction },
          { time: 6, score: 0.9, isBest: true, box: fraction },
        ],
      });
      expect(mocks.videoFace.getSightings).toHaveBeenCalledWith('face-1');
    });

    it('returns no sightings for a face not sampled from a video', async () => {
      mocks.videoFace.getSightings.mockResolvedValue(undefined);

      await expect(sut.getSightings(auth, 'face-1')).resolves.toEqual({ sightings: [] });
    });

    it('requires read access to the asset', async () => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.getSightings(auth, 'face-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.videoFace.getSightings).not.toHaveBeenCalled();
    });

    it('is not found for an unknown face, or one on a trashed asset', async () => {
      mocks.galleryPerson.getFaceByIdOnLiveAsset.mockRejectedValue(new Error('no result'));

      await expect(sut.getSightings(auth, 'face-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getSightingThumbnail', () => {
    const auth = AuthFactory.create();
    const face = AssetFaceFactory.create({
      id: 'face-1',
      assetId: 'asset-1',
      imageWidth: 2560,
      imageHeight: 1440,
      boundingBoxX1: 1000,
      boundingBoxY1: 500,
      boundingBoxX2: 1200,
      boundingBoxY2: 700,
    });
    const stored = {
      sightings: [
        { t: 4, score: 0.9, x1: 1000, y1: 500, x2: 1200, y2: 700 },
        { t: 9.5, score: 0.7, x1: 200, y1: 100, x2: 400, y2: 300 },
      ],
      timeSeconds: 4,
      imageWidth: 2560,
      imageHeight: 1440,
      originalPath: 'upload/owner/video.mp4',
      framePath: 'thumbs/owner/fa/ce/face-1.jpeg',
      trimStart: 1.5,
      trimEnd: null,
    };
    let extractFrame: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mocks.galleryPerson.getFaceByIdOnLiveAsset.mockResolvedValue(face as any);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
      mocks.videoFace.getSightings.mockResolvedValue(stored);
      mocks.media.probe.mockResolvedValue({ videoStreams: [{ index: 0 }] } as any);
      vi.spyOn((sut as any).backendMedia, 'getProbeInput').mockResolvedValue('https://s3.example/video.mp4?sig');
      extractFrame = vi.fn(async (_input: string, output: string) => {
        await writeFile(output, Buffer.from('frame'));
      });
      (sut as any).frames = { extractFrame };
      mocks.media.decodeImage.mockResolvedValue({
        data: Buffer.from('decoded'),
        info: { width: 2560, height: 1440, channels: 3 },
      } as any);
      mocks.media.generateThumbnail.mockImplementation(async (_input, _options, output) => {
        await writeFile(output, Buffer.from('crop'));
      });
    });

    it('crops the sighting from a frame extracted from the original at its stored time, read in place', async () => {
      const result = await sut.getSightingThumbnail(auth, 'face-1', 8);
      if (result instanceof ImmichStreamResponse) {
        result.stream.destroy();
      }

      expect(mocks.media.probe).toHaveBeenCalledWith('https://s3.example/video.mp4?sig');
      // 8 s on the player is 9.5 s in the original, under a trim from 1.5 s.
      expect(extractFrame).toHaveBeenCalledWith(
        'https://s3.example/video.mp4?sig',
        expect.stringMatching(/frame\.jpeg$/),
        9.5,
        expect.objectContaining({ videoStream: { index: 0 } }),
      );
      const [, options] = mocks.media.generateThumbnail.mock.calls[0];
      const crop = (options.edits as { parameters: { x: number; y: number; width: number } }[])[0].parameters;
      // The crop is around the sighting's box (200-400 x 100-300), not the face's best box.
      expect(crop.x).toBeLessThanOrEqual(200);
      expect(crop.x + crop.width).toBeGreaterThanOrEqual(400);
      expect(crop.x).toBeLessThan(1000);
    });

    it('is not found at a time with no sighting', async () => {
      await expect(sut.getSightingThumbnail(auth, 'face-1', 9.5)).rejects.toBeInstanceOf(NotFoundException);
      expect(extractFrame).not.toHaveBeenCalled();
    });

    it('is not found for a face not sampled from a video', async () => {
      mocks.videoFace.getSightings.mockResolvedValue(undefined);

      await expect(sut.getSightingThumbnail(auth, 'face-1', 0)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('requires read access to the asset', async () => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.getSightingThumbnail(auth, 'face-1', 8)).rejects.toBeInstanceOf(BadRequestException);
      expect(extractFrame).not.toHaveBeenCalled();
    });
  });

  describe('removeSighting and restoreSighting', () => {
    const auth = AuthFactory.create();
    const best = { t: 4, score: 0.9, x1: 100, y1: 100, x2: 200, y2: 200 };
    const other = { t: 6, score: 0.5, x1: 300, y1: 100, x2: 400, y2: 200 };
    const nextBest = { t: 9, score: 0.8, x1: 500, y1: 100, x2: 600, y2: 200 };
    let extractFrame: ReturnType<typeof vi.fn>;
    let put: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set(['face-1']));
      mocks.videoFace.getPeopleRepresentedBy.mockResolvedValue([]);
      mocks.media.probe.mockResolvedValue({ videoStreams: [{ index: 0 }] } as any);
      vi.spyOn((sut as any).backendMedia, 'getProbeInput').mockResolvedValue('/data/upload/owner/video.mp4');
      put = vi.fn().mockResolvedValue(undefined);
      vi.spyOn((sut as any).backendMedia, 'backendFor').mockResolvedValue({ put });
      extractFrame = vi.fn(async (_input: string, output: string) => {
        await writeFile(output, Buffer.from('frame at the new best'));
      });
      (sut as any).frames = { extractFrame };
    });

    it('takes a sighting out, keeping it marked removed, and leaves the best frame alone', async () => {
      mocks.videoFace.getSightings.mockResolvedValue(storedWith([best, other, nextBest]));

      await expect(sut.removeSighting(auth, 'face-1', 6)).resolves.toEqual({
        sightings: [
          { time: 4, score: 0.9, isBest: true, box: fraction(100, 100, 200, 200) },
          { time: 9, score: 0.8, isBest: false, box: fraction(500, 100, 600, 200) },
        ],
      });
      expect(mocks.videoFace.setSightings).toHaveBeenCalledWith(
        'face-1',
        [best, { ...other, removed: true }, nextBest],
        undefined,
      );
      expect(extractFrame).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('makes the highest scoring sighting left the best view when the best one goes', async () => {
      mocks.videoFace.getSightings.mockResolvedValue(storedWith([best, other, nextBest]));
      mocks.videoFace.getPeopleRepresentedBy.mockResolvedValue([{ ownerId: 'owner-1', personGroupId: 'group-1' }]);

      const response = await sut.removeSighting(auth, 'face-1', 4);

      expect(response.sightings.map(({ time, isBest }) => [time, isBest])).toEqual([
        [6, false],
        [9, true],
      ]);
      expect(extractFrame).toHaveBeenCalledWith(
        '/data/upload/owner/video.mp4',
        expect.stringMatching(/frame\.jpeg$/),
        9,
        expect.objectContaining({ videoStream: { index: 0 } }),
      );
      expect(put).toHaveBeenCalledWith('thumbs/owner/fa/ce/face-1.jpeg', Buffer.from('frame at the new best'), {
        contentType: 'image/jpeg',
      });
      expect(mocks.videoFace.setSightings).toHaveBeenCalledWith(
        'face-1',
        [{ ...best, removed: true, wasBest: true }, other, nextBest],
        { timeSeconds: 9, box: { boundingBoxX1: 500, boundingBoxY1: 100, boundingBoxX2: 600, boundingBoxY2: 200 } },
      );
      expect(put.mock.invocationCallOrder[0]).toBeLessThan(mocks.videoFace.setSightings.mock.invocationCallOrder[0]);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: 'PersonGenerateThumbnail', data: { ownerId: 'owner-1', personGroupId: 'group-1' } },
      ]);
    });

    it('keeps the last sighting of a face', async () => {
      mocks.videoFace.getSightings.mockResolvedValue(storedWith([best, { ...other, removed: true }]));

      await expect(sut.removeSighting(auth, 'face-1', 4)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.videoFace.setSightings).not.toHaveBeenCalled();
    });

    it('is not found at a time with no sighting shown, or for a face not sampled from a video', async () => {
      mocks.videoFace.getSightings.mockResolvedValue(storedWith([best, { ...other, removed: true }, nextBest]));
      await expect(sut.removeSighting(auth, 'face-1', 6)).rejects.toBeInstanceOf(NotFoundException);
      await expect(sut.removeSighting(auth, 'face-1', 5)).rejects.toBeInstanceOf(NotFoundException);

      mocks.videoFace.getSightings.mockResolvedValue(undefined);
      await expect(sut.removeSighting(auth, 'face-1', 4)).rejects.toBeInstanceOf(NotFoundException);
      expect(mocks.videoFace.setSightings).not.toHaveBeenCalled();
    });

    it('needs face delete access, for removing and restoring alike', async () => {
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.removeSighting(auth, 'face-1', 4)).rejects.toBeInstanceOf(BadRequestException);
      await expect(sut.restoreSighting(auth, 'face-1', 4)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.videoFace.getSightings).not.toHaveBeenCalled();
    });

    it('brings a removed sighting back without touching the best view', async () => {
      mocks.videoFace.getSightings.mockResolvedValue(storedWith([best, { ...other, removed: true }, nextBest]));

      const response = await sut.restoreSighting(auth, 'face-1', 6);

      expect(response.sightings.map(({ time }) => time)).toEqual([4, 6, 9]);
      expect(mocks.videoFace.setSightings).toHaveBeenCalledWith('face-1', [best, other, nextBest], undefined);
      expect(put).not.toHaveBeenCalled();
    });

    it('brings back a removed best view as the best view again', async () => {
      mocks.videoFace.getSightings.mockResolvedValue(
        storedWith([{ ...best, removed: true, wasBest: true }, other, nextBest], 9),
      );

      const response = await sut.restoreSighting(auth, 'face-1', 4);

      expect(response.sightings.find(({ isBest }) => isBest)?.time).toBe(4);
      expect(extractFrame).toHaveBeenCalledWith(expect.anything(), expect.anything(), 4, expect.anything());
      expect(mocks.videoFace.setSightings).toHaveBeenCalledWith('face-1', [best, other, nextBest], {
        timeSeconds: 4,
        box: { boundingBoxX1: 100, boundingBoxY1: 100, boundingBoxX2: 200, boundingBoxY2: 200 },
      });
    });

    it('is not found when restoring a sighting that was not removed', async () => {
      mocks.videoFace.getSightings.mockResolvedValue(storedWith([best, other]));

      await expect(sut.restoreSighting(auth, 'face-1', 6)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
