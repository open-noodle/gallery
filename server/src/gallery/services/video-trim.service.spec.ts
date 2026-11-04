import { Reflector } from '@nestjs/core';
import { OutputInfo } from 'sharp';
import type { RawImageInfo } from 'src/types.js';
import { AssetFileType, AssetType, JobName, JobStatus, MetadataKey, QueueName } from 'src/enum.js';
import { VideoTrimService } from 'src/gallery/services/video-trim.service.js';
import {
  getEditedEncodedVideoPath,
  getRelativeEditedEncodedVideoPath,
  getRelativeEncodedVideoPath,
} from 'src/gallery/utils/storage-keys.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { videoInfoStub } from 'test/fixtures/media.stub.js';
import { getForGenerateThumbnail } from 'test/mappers.js';
import { ServiceMocks, makeStream, newTestService } from 'test/utils.js';

const rawBuffer = Buffer.from('raw image data');
const fullsizeBuffer = Buffer.from('embedded image data');

describe(VideoTrimService.name, () => {
  let sut: VideoTrimService;
  let mocks: ServiceMocks;
  let rawInfo: RawImageInfo;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(VideoTrimService));
    rawInfo = { width: 100, height: 100, channels: 3 };
    mocks.person.getFaces.mockResolvedValue([]);
    mocks.ocr.getByAssetId.mockResolvedValue([]);
    mocks.media.decodeImage.mockImplementation((input) =>
      Promise.resolve(
        typeof input === 'string'
          ? { data: rawBuffer, info: rawInfo as OutputInfo } // string implies original file
          : { data: fullsizeBuffer, info: rawInfo as OutputInfo }, // buffer implies embedded image extracted
      ),
    );
    mocks.media.getImageMetadata.mockResolvedValue({ width: 100, height: 100, isTransparent: false });
  });

  it('should run as the AssetVideoTrimGenerate job on the editor queue', () => {
    const config = new Reflector().get(MetadataKey.JobConfig, sut.handleVideoTrimGenerate);

    expect(config).toEqual({ name: JobName.AssetVideoTrimGenerate, queue: QueueName.Editor });
  });

  it('should fail for an asset that is not found', async () => {
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(void 0);

    await expect(sut.handleVideoTrimGenerate({ id: 'missing' })).resolves.toBe(JobStatus.Failed);
    expect(mocks.videoTrim.trim).not.toHaveBeenCalled();
  });

  it('should trim a video that has a trim', async () => {
    const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
    mocks.videoTrim.get.mockResolvedValue({ startTime: 5, endTime: 25 });
    mocks.media.probe.mockResolvedValue({
      ...videoInfoStub.noAudioStreams,
      format: { ...videoInfoStub.noAudioStreams.format, duration: 20 },
    });
    mocks.media.decodeImage.mockResolvedValue({ data: rawBuffer, info: rawInfo as OutputInfo });
    mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

    await sut.handleVideoTrimGenerate({ id: asset.id });

    expect(mocks.videoTrim.trim).toHaveBeenCalledWith(expect.any(String), expect.any(String), 5, 20);
  });

  it('always trims the original, even if an encoded video row is present', async () => {
    const asset = AssetFactory.from({ type: AssetType.Video })
      .exif()
      .files([{ type: AssetFileType.EncodedVideo, isEdited: false, path: 'encoded-video/owner/ab/cd/video.mp4' }])
      .build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
    mocks.videoTrim.get.mockResolvedValue({ startTime: 5, endTime: 25 });
    mocks.media.probe.mockResolvedValue({
      ...videoInfoStub.noAudioStreams,
      format: { ...videoInfoStub.noAudioStreams.format, duration: 20 },
    });
    mocks.media.decodeImage.mockResolvedValue({ data: rawBuffer, info: rawInfo as OutputInfo });
    mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

    await sut.handleVideoTrimGenerate({ id: asset.id });

    // The encoded video is never a valid ffmpeg input: on S3 its path is a relative key.
    // The original is both readable and higher quality.
    expect(mocks.videoTrim.trim).toHaveBeenCalledWith(asset.originalPath, expect.any(String), 5, 20);
  });

  it('should record the trimmed duration after trimming', async () => {
    const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
    mocks.videoTrim.get.mockResolvedValue({ startTime: 5, endTime: 25 });
    mocks.media.probe.mockResolvedValue({
      ...videoInfoStub.noAudioStreams,
      format: { ...videoInfoStub.noAudioStreams.format, duration: 19.5 },
    });
    mocks.media.decodeImage.mockResolvedValue({ data: rawBuffer, info: rawInfo as OutputInfo });
    mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

    await sut.handleVideoTrimGenerate({ id: asset.id });

    expect(mocks.videoTrim.setDuration).toHaveBeenCalledWith(asset.id, 19_500);
  });

  it('should generate thumbnails from extracted frame after trim', async () => {
    const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
    mocks.videoTrim.get.mockResolvedValue({ startTime: 0, endTime: 10 });
    mocks.media.probe.mockResolvedValue({
      ...videoInfoStub.noAudioStreams,
      format: { ...videoInfoStub.noAudioStreams.format, duration: 10 },
    });
    mocks.media.decodeImage.mockResolvedValue({ data: rawBuffer, info: rawInfo as OutputInfo });
    mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

    await sut.handleVideoTrimGenerate({ id: asset.id });

    expect(mocks.videoTrim.extractFrame).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/\.frame-[\w-]+\.jpg$/),
      expect.any(Number),
    );
    expect(mocks.media.generateThumbnail).toHaveBeenCalled();
  });

  it('should return failed when trim ffmpeg errors', async () => {
    const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
    mocks.videoTrim.get.mockResolvedValue({ startTime: 5, endTime: 25 });
    mocks.videoTrim.trim.mockRejectedValue(new Error('FFmpeg error'));

    const result = await sut.handleVideoTrimGenerate({ id: asset.id });

    expect(result).toBe(JobStatus.Failed);
  });

  it('should serialize concurrent trim jobs for the same asset', async () => {
    // Rapid re-trims race: the second job overwrites `{id}_edited.mp4` while the
    // first may still read it, and the first job's temp-frame cleanup deletes the
    // frame the second just extracted (issue #743 item 2).
    const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
    mocks.videoTrim.get.mockResolvedValue({ startTime: 1, endTime: 3 });
    mocks.media.probe.mockResolvedValue({
      ...videoInfoStub.noAudioStreams,
      format: { ...videoInfoStub.noAudioStreams.format, duration: 2 },
    });
    mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

    const order: string[] = [];
    let releaseFirstTrim!: () => void;
    mocks.videoTrim.trim
      .mockImplementationOnce(async () => {
        order.push('trim1:start');
        await new Promise<void>((resolve) => (releaseFirstTrim = resolve));
        order.push('trim1:end');
      })
      .mockImplementationOnce(() => {
        order.push('trim2:start');
        return Promise.resolve();
      });

    const first = sut.handleVideoTrimGenerate({ id: asset.id });
    await vi.waitFor(() => expect(order).toContain('trim1:start'));

    const second = sut.handleVideoTrimGenerate({ id: asset.id });
    // Give the second job time to (incorrectly) reach ffmpeg — it must block instead.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(['trim1:start']);

    releaseFirstTrim();
    await Promise.all([first, second]);
    expect(order).toEqual(['trim1:start', 'trim1:end', 'trim2:start']);
  });

  it('should use a distinct temp frame path per trim invocation', async () => {
    // The in-process lock does not cover overlapping trims in different worker
    // processes — with a fixed frame name, one job's temp-frame cleanup unlinks
    // the frame another job is still reading (issue #743 item 2).
    const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
    mocks.videoTrim.get.mockResolvedValue({ startTime: 1, endTime: 3 });
    mocks.media.probe.mockResolvedValue({
      ...videoInfoStub.noAudioStreams,
      format: { ...videoInfoStub.noAudioStreams.format, duration: 2 },
    });
    mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

    await sut.handleVideoTrimGenerate({ id: asset.id });
    await sut.handleVideoTrimGenerate({ id: asset.id });

    const framePaths = mocks.videoTrim.extractFrame.mock.calls.map(([, framePath]) => framePath);
    expect(framePaths).toHaveLength(2);
    expect(framePaths[0]).not.toBe(framePaths[1]);
  });

  it('should trim to a temporary path and rename into place', async () => {
    // ffmpeg writing `{id}_edited.mp4` in place lets a concurrent reader (probe /
    // frame extraction in another worker process) see a partial file; an atomic
    // rename means readers only ever open a complete video (issue #743 item 2).
    const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
    mocks.videoTrim.get.mockResolvedValue({ startTime: 1, endTime: 3 });
    mocks.media.probe.mockResolvedValue({
      ...videoInfoStub.noAudioStreams,
      format: { ...videoInfoStub.noAudioStreams.format, duration: 2 },
    });
    mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

    await sut.handleVideoTrimGenerate({ id: asset.id });

    const [, trimOutputPath] = mocks.videoTrim.trim.mock.calls[0];
    expect(trimOutputPath).not.toMatch(/_edited\.mp4$/);
    expect(mocks.storage.rename).toHaveBeenCalledWith(trimOutputPath, expect.stringMatching(/_edited\.mp4$/));
  });

  it('cleans up the trimmed video when a post-trim step fails', async () => {
    const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
    mocks.videoTrim.get.mockResolvedValue({ startTime: 5, endTime: 25 });
    mocks.media.probe.mockResolvedValue({
      ...videoInfoStub.noAudioStreams,
      format: { ...videoInfoStub.noAudioStreams.format, duration: 20 },
    });
    // trim() succeeds, but a later step (frame extraction) throws. The locally-written
    // trimmed video must not be left behind — on S3 outputPath is a pod-local temp.
    mocks.videoTrim.extractFrame.mockRejectedValue(new Error('bad frame'));

    await expect(sut.handleVideoTrimGenerate({ id: asset.id })).rejects.toThrow('bad frame');

    const outputPath = getEditedEncodedVideoPath(asset as any);
    expect(mocks.storage.unlink).toHaveBeenCalledWith(outputPath);
  });

  it('should handle video undo by cleaning up edited files', async () => {
    const asset = AssetFactory.from({ type: AssetType.Video })
      .exif()
      .files([
        { type: AssetFileType.EncodedVideo, isEdited: true, path: '/edited-video.mp4' },
        { type: AssetFileType.Preview, isEdited: true, path: '/edited-preview.jpg' },
      ])
      .build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));

    const result = await sut.handleVideoTrimGenerate({ id: asset.id });

    expect(result).toBe(JobStatus.Success);
    expect(mocks.job.queue).toHaveBeenCalledWith({
      name: JobName.AssetGenerateThumbnails,
      data: { id: asset.id },
    });
  });

  it('deletes the edited encoded video when the trim is undone', async () => {
    const asset = AssetFactory.from({ type: AssetType.Video })
      .exif()
      .files([{ type: AssetFileType.Preview, isEdited: true, path: '/data/preview_edited.jpeg' }])
      .build();
    // no edits => the undo path
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue({
      ...getForGenerateThumbnail(asset),
      edits: [],
    } as any);
    mocks.galleryAsset.getEditedEncodedVideo.mockResolvedValue({
      id: 'file-id-1',
      path: 'encoded-video/owner/ab/cd/video_edited.mp4',
    });

    await sut.handleVideoTrimGenerate({ id: asset.id });

    // Without this, getForVideo (isEdited DESC) keeps serving the TRIMMED video after an undo.
    expect(mocks.asset.deleteFiles).toHaveBeenCalledWith([expect.objectContaining({ id: 'file-id-1' })]);
    expect(mocks.job.queue).toHaveBeenCalledWith({
      name: JobName.FileDelete,
      data: { files: ['encoded-video/owner/ab/cd/video_edited.mp4'] },
    });
  });

  it('undoes cleanly when there is no edited encoded video', async () => {
    // No edited files at all — unlike U1, this isolates the assertion to the
    // getEditedEncodedVideo guard: an unrelated edited Preview row would also
    // produce a deleteFiles call via syncFiles' own cleanup, which would make
    // the "no deleteFiles call" assertion below pass/fail for the wrong reason.
    const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue({
      ...getForGenerateThumbnail(asset),
      edits: [],
    } as any);
    mocks.galleryAsset.getEditedEncodedVideo.mockResolvedValue(void 0);

    const result = await sut.handleVideoTrimGenerate({ id: asset.id });

    expect(result).toBe(JobStatus.Success);
    expect(mocks.asset.deleteFiles).not.toHaveBeenCalled();
  });

  describe('trim video persistence (S3)', () => {
    afterEach(() => {
      // vitest.config.mjs sets no restoreMocks and there are no setupFiles, so a
      // getWriteBackend spy would leak into every later test in this file and
      // silently run the disk-mode tests against S3.
      vi.restoreAllMocks();
    });

    it('uploads the trimmed video under the _edited key and stores that key (S3)', async () => {
      const put = vi.fn().mockResolvedValue(void 0);
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put } as any);
      mocks.storage.createPlainReadStream.mockReturnValue(makeStream([Buffer.from('mp4')]) as any);

      const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
      mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
      mocks.videoTrim.get.mockResolvedValue({ startTime: 5, endTime: 25 });
      mocks.media.probe.mockResolvedValue({
        ...videoInfoStub.noAudioStreams,
        format: { ...videoInfoStub.noAudioStreams.format, duration: 20 },
      });
      mocks.media.decodeImage.mockResolvedValue({ data: rawBuffer, info: rawInfo as OutputInfo });
      mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

      await sut.handleVideoTrimGenerate({ id: asset.id });

      const editedKey = getRelativeEditedEncodedVideoPath(asset as any);
      expect(put).toHaveBeenCalledWith(editedKey, expect.anything(), { contentType: 'video/mp4' });
      expect(mocks.asset.upsertFiles).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: AssetFileType.EncodedVideo, isEdited: true, path: editedKey }),
        ]),
      );
    });

    it('does not commit the trimmed duration when persisting the video fails (S3)', async () => {
      // Upload fails part-way. The new duration must NOT already be committed, or the DB would
      // report the trimmed length while getForVideo still serves the full-length original.
      const put = vi.fn().mockRejectedValue(new Error('s3 down'));
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put } as any);
      mocks.storage.createPlainReadStream.mockReturnValue(makeStream([Buffer.from('mp4')]) as any);

      const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
      mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
      mocks.videoTrim.get.mockResolvedValue({ startTime: 5, endTime: 25 });
      mocks.media.probe.mockResolvedValue({
        ...videoInfoStub.noAudioStreams,
        format: { ...videoInfoStub.noAudioStreams.format, duration: 20 },
      });
      mocks.media.decodeImage.mockResolvedValue({ data: rawBuffer, info: rawInfo as OutputInfo });
      mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

      await expect(sut.handleVideoTrimGenerate({ id: asset.id })).rejects.toThrow('s3 down');

      expect(mocks.asset.update).not.toHaveBeenCalledWith(expect.objectContaining({ duration: expect.anything() }));
    });

    it('never uploads the trimmed video over the transcoded original (S3)', async () => {
      const put = vi.fn().mockResolvedValue(void 0);
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put } as any);
      mocks.storage.createPlainReadStream.mockReturnValue(makeStream([Buffer.from('mp4')]) as any);

      const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
      mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
      mocks.videoTrim.get.mockResolvedValue({ startTime: 5, endTime: 25 });
      mocks.media.probe.mockResolvedValue({
        ...videoInfoStub.noAudioStreams,
        format: { ...videoInfoStub.noAudioStreams.format, duration: 20 },
      });
      mocks.media.decodeImage.mockResolvedValue({ data: rawBuffer, info: rawInfo as OutputInfo });
      mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

      await sut.handleVideoTrimGenerate({ id: asset.id });

      const nonEditedKey = getRelativeEncodedVideoPath(asset as any);
      const keys = put.mock.calls.map((call) => call[0]);
      expect(keys).not.toContain(nonEditedKey);
    });

    it('uploads the trimmed video only after the thumbnail frame is extracted (S3)', async () => {
      const put = vi.fn().mockResolvedValue(void 0);
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put } as any);
      mocks.storage.createPlainReadStream.mockReturnValue(makeStream([Buffer.from('mp4')]) as any);

      const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
      mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
      mocks.videoTrim.get.mockResolvedValue({ startTime: 5, endTime: 25 });
      mocks.media.probe.mockResolvedValue({
        ...videoInfoStub.noAudioStreams,
        format: { ...videoInfoStub.noAudioStreams.format, duration: 20 },
      });
      mocks.media.decodeImage.mockResolvedValue({ data: rawBuffer, info: rawInfo as OutputInfo });
      mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

      await sut.handleVideoTrimGenerate({ id: asset.id });

      // persistFile unlinks the local file after upload, so extractFrame MUST run first.
      const extractOrder = mocks.videoTrim.extractFrame.mock.invocationCallOrder[0];
      const putOrder = put.mock.invocationCallOrder[0];
      expect(extractOrder).toBeLessThan(putOrder);
    });

    it('does not delete the edited video it just re-uploaded when re-trimming (S3)', async () => {
      const put = vi.fn().mockResolvedValue(void 0);
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put } as any);
      mocks.storage.createPlainReadStream.mockReturnValue(makeStream([Buffer.from('mp4')]) as any);

      const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
      const editedKey = getRelativeEditedEncodedVideoPath(asset as any);
      const withExistingEdit = {
        ...getForGenerateThumbnail(asset),
        files: [
          {
            type: AssetFileType.EncodedVideo,
            isEdited: true,
            path: editedKey,
            isProgressive: false,
            isTransparent: false,
          },
        ],
      };
      mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(withExistingEdit as any);
      mocks.videoTrim.get.mockResolvedValue({ startTime: 5, endTime: 25 });
      mocks.media.probe.mockResolvedValue({
        ...videoInfoStub.noAudioStreams,
        format: { ...videoInfoStub.noAudioStreams.format, duration: 20 },
      });
      mocks.media.decodeImage.mockResolvedValue({ data: rawBuffer, info: rawInfo as OutputInfo });
      mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

      await sut.handleVideoTrimGenerate({ id: asset.id });

      // The key is deterministic, so the re-trim overwrote the same object. syncFiles must
      // NOT then queue a delete for it — that would erase what we just uploaded.
      const deletedFiles = mocks.job.queue.mock.calls
        .filter(([job]) => job.name === JobName.FileDelete)
        .flatMap(([job]) => (job as any).data.files as string[]);
      expect(deletedFiles).not.toContain(editedKey);
    });

    it('uploads the trim thumbnails under _edited keys and stores those keys (S3)', async () => {
      const put = vi.fn().mockResolvedValue(void 0);
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put } as any);
      mocks.storage.createPlainReadStream.mockReturnValue(makeStream([Buffer.from('data')]) as any);

      const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
      mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
      mocks.videoTrim.get.mockResolvedValue({ startTime: 5, endTime: 25 });
      mocks.media.probe.mockResolvedValue({
        ...videoInfoStub.noAudioStreams,
        format: { ...videoInfoStub.noAudioStreams.format, duration: 20 },
      });
      mocks.media.decodeImage.mockResolvedValue({ data: rawBuffer, info: rawInfo as OutputInfo });
      mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

      await sut.handleVideoTrimGenerate({ id: asset.id });

      const putKeys = put.mock.calls.map((call) => call[0] as string);
      const thumbnailKeys = putKeys.filter((key) => key.startsWith('thumbs/'));

      // preview + thumbnail at minimum (fullsize too, when the config generates one)
      expect(thumbnailKeys.length).toBeGreaterThanOrEqual(2);
      for (const key of thumbnailKeys) {
        expect(key).toContain('_edited');
      }

      // and the keys — not local paths — are what get written to the DB
      const upserted = mocks.asset.upsertFiles.mock.calls.flatMap(([files]) => files as any[]);
      const upsertedThumbs = upserted.filter((file) => file.type !== AssetFileType.EncodedVideo);
      expect(upsertedThumbs.length).toBeGreaterThanOrEqual(2);
      for (const file of upsertedThumbs) {
        expect(file.path.startsWith('/')).toBe(false);
        expect(file.path).toContain('_edited');
      }
    });

    it('never overwrites the non-edited preview or thumbnail objects (S3)', async () => {
      const put = vi.fn().mockResolvedValue(void 0);
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put } as any);
      mocks.storage.createPlainReadStream.mockReturnValue(makeStream([Buffer.from('data')]) as any);

      const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
      mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
      mocks.videoTrim.get.mockResolvedValue({ startTime: 5, endTime: 25 });
      mocks.media.probe.mockResolvedValue({
        ...videoInfoStub.noAudioStreams,
        format: { ...videoInfoStub.noAudioStreams.format, duration: 20 },
      });
      mocks.media.decodeImage.mockResolvedValue({ data: rawBuffer, info: rawInfo as OutputInfo });
      mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

      await sut.handleVideoTrimGenerate({ id: asset.id });

      // A trim must not clobber the asset's normal preview/thumbnail objects: every
      // image key it writes carries the _edited marker.
      //
      // Asserted without a bare for-of over a filtered array: with zero thumbnail uploads
      // such a loop never executes and the test passes with no assertions at all.
      const putKeys = put.mock.calls.map((call) => call[0] as string);
      const thumbnailKeys = putKeys.filter((key) => key.startsWith('thumbs/'));

      expect(thumbnailKeys.length).toBeGreaterThanOrEqual(2);
      expect(thumbnailKeys.every((key) => key.includes('_edited'))).toBe(true);

      // and specifically not the non-edited keys, which belong to the untrimmed asset.
      // Derived from the edited keys themselves, so this cannot pass by comparing against
      // a key string that was never a real target.
      for (const editedKey of thumbnailKeys) {
        expect(putKeys).not.toContain(editedKey.replace('_edited', ''));
      }
    });

    it('keeps disk-mode trim paths absolute and uploads nothing (regression guard)', async () => {
      // No getWriteBackend spy: StorageService.diskBackend is undefined in this spec file,
      // so persistFile takes its disk branch. Nothing here may become a relative key.
      const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
      mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
      mocks.videoTrim.get.mockResolvedValue({ startTime: 5, endTime: 25 });
      mocks.media.probe.mockResolvedValue({
        ...videoInfoStub.noAudioStreams,
        format: { ...videoInfoStub.noAudioStreams.format, duration: 20 },
      });
      mocks.media.decodeImage.mockResolvedValue({ data: rawBuffer, info: rawInfo as OutputInfo });
      mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

      await sut.handleVideoTrimGenerate({ id: asset.id });

      const upserted = mocks.asset.upsertFiles.mock.calls.flatMap(([files]) => files);
      expect(upserted.length).toBeGreaterThanOrEqual(3); // edited video + preview + thumbnail
      for (const file of upserted) {
        expect(file.path.startsWith('/')).toBe(true);
      }
      expect(mocks.storage.createPlainReadStream).not.toHaveBeenCalled();
    });
  });
});
