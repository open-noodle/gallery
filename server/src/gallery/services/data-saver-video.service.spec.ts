import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend.js';
import {
  AssetType,
  AssetVisibility,
  CacheControl,
  ImmichWorker,
  JobName,
  JobStatus,
  TranscodeHardwareAcceleration,
} from 'src/enum.js';
import { DataSaverVideoService } from 'src/gallery/services/data-saver-video.service.js';
import { StorageService } from 'src/services/storage.service.js';
import { clearConfigCache } from 'src/utils/config.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, makeStream, newTestService } from 'test/utils.js';

const dataSaver = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  targetVideoCodec: 'hevc',
  targetResolution: '720',
  maxBitrate: '1500k',
  ...overrides,
});

// A stored config override, as SystemMetadataRepository returns it: partial, and loosely typed like the JSON it is.
const enabled = (overrides: Record<string, unknown> = {}, ffmpeg: Record<string, unknown> = {}) =>
  ({ ffmpeg: { ...ffmpeg, dataSaver: dataSaver(overrides) } }) as any;

const configUpdate = (before: Record<string, unknown>, after: Record<string, unknown>) =>
  ({
    oldConfig: { ffmpeg: { dataSaver: dataSaver(before) } },
    newConfig: { ffmpeg: { dataSaver: dataSaver(after) } },
  }) as any;

const row = {
  id: 'asset-1',
  ownerId: 'owner-1',
  type: AssetType.Video,
  visibility: AssetVisibility.Timeline,
  path: null as string | null,
  settings: null as string | null,
  editedVideoPath: null as string | null,
};

// A 4K iPhone clip: well over the 720p / 1.5 Mbit/s default.
const videoStream = {
  index: 0,
  width: 3840,
  height: 2160,
  rotation: 0,
  codecName: 'hevc',
  profile: null,
  level: null,
  frameCount: 2940,
  frameRate: 30,
  timeBase: 600,
  bitrate: 45_000_000,
  pixelFormat: 'yuv420p',
  colorPrimaries: 'bt709',
  colorMatrix: 'bt709',
  colorTransfer: 'bt709',
};

const video = {
  id: 'asset-1',
  ownerId: 'owner-1',
  originalPath: '/data/library/owner-1/IMG_0001.MOV',
  files: [],
  videoStream,
  audioStream: null,
  format: { formatName: 'mov,mp4,m4a,3gp,3g2,mj2', duration: 98, bitrate: 45_200_000 },
};

describe(DataSaverVideoService.name, () => {
  let sut: DataSaverVideoService;
  let mocks: ServiceMocks;
  let put: ReturnType<typeof vi.fn>;
  let exists: ReturnType<typeof vi.fn>;
  let ensureLocalFile: ReturnType<typeof vi.spyOn>;

  const useDiskBackend = () => {
    const disk = Object.assign(Object.create(DiskStorageBackend.prototype), { put, exists });
    vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue(disk);
  };

  beforeEach(() => {
    clearConfigCache();
    ({ sut, mocks } = newTestService(DataSaverVideoService));
    mocks.config.getWorker.mockReturnValue(ImmichWorker.Microservices);
    put = vi.fn().mockResolvedValue(undefined);
    exists = vi.fn().mockResolvedValue(true);
    // Not a DiskStorageBackend, so dataSaverVideoPath takes the S3 form: a relative key.
    vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put, exists } as any);
    const cleanup = vi.fn(async () => {});
    ensureLocalFile = vi.spyOn(sut['backendMedia'], 'ensureLocalFile').mockImplementation((path: string) =>
      Promise.resolve({
        localPath: `/tmp/staged${path}`,
        cleanup,
        [Symbol.asyncDispose]: cleanup,
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onJobSuccess', () => {
    beforeEach(() => mocks.systemMetadata.get.mockResolvedValue(enabled()));

    it('queues a copy after the video was encoded', async () => {
      await sut.onJobSuccess({
        job: { name: JobName.AssetEncodeVideo, data: { id: 'asset-1' } },
        response: JobStatus.Success,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.AssetEncodeDataSaverVideo,
        data: { id: 'asset-1' },
      });
    });

    it('queues a copy when the encode was skipped, since the original is then what plays', async () => {
      await sut.onJobSuccess({
        job: { name: JobName.AssetEncodeVideo, data: { id: 'asset-1' } },
        response: JobStatus.Skipped,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.AssetEncodeDataSaverVideo,
        data: { id: 'asset-1' },
      });
    });

    it('does not queue after a failed encode', async () => {
      await sut.onJobSuccess({
        job: { name: JobName.AssetEncodeVideo, data: { id: 'asset-1' } },
        response: JobStatus.Failed,
      });
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('forces a new copy after an edit, since a trim changes the source', async () => {
      await sut.onJobSuccess({
        job: { name: JobName.AssetEditThumbnailGeneration, data: { id: 'asset-1' } },
        response: JobStatus.Success,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.AssetEncodeDataSaverVideo,
        data: { id: 'asset-1', force: true },
      });
    });

    it('chains the Video Conversion queue-all, keeping its force flag', async () => {
      await sut.onJobSuccess({
        job: { name: JobName.AssetEncodeVideoQueueAll, data: { force: true } },
        response: JobStatus.Success,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.AssetEncodeDataSaverVideoQueueAll,
        data: { force: true },
      });
    });

    it('ignores other jobs', async () => {
      await sut.onJobSuccess({
        job: { name: JobName.AssetGenerateThumbnails, data: { id: 'asset-1' } },
        response: JobStatus.Success,
      });
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('queues nothing while the feature is off', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled({ enabled: false }));
      await sut.onJobSuccess({
        job: { name: JobName.AssetEncodeVideo, data: { id: 'asset-1' } },
        response: JobStatus.Success,
      });
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  describe('onBootstrap', () => {
    // A config file never fires ConfigUpdate, so the boot is where a feature switched on there gets its backfill.
    it('backfills missing or stale copies when the feature is on', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled());
      await sut.onBootstrap();
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.AssetEncodeDataSaverVideoQueueAll,
        data: { force: false },
      });
    });

    it('queues nothing while the feature is off', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled({ enabled: false }));
      await sut.onBootstrap();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  describe('onConfigUpdate', () => {
    const queueAll = { name: JobName.AssetEncodeDataSaverVideoQueueAll, data: { force: false } };

    it('backfills when the feature is turned on', async () => {
      await sut.onConfigUpdate(configUpdate({ enabled: false }, {}));
      expect(mocks.job.queue).toHaveBeenCalledWith(queueAll);
    });

    it('backfills when a setting changes while it is on', async () => {
      await sut.onConfigUpdate(configUpdate({}, { maxBitrate: '1000k' }));
      expect(mocks.job.queue).toHaveBeenCalledWith(queueAll);
    });

    it('does nothing when the settings are saved unchanged', async () => {
      await sut.onConfigUpdate(configUpdate({}, {}));
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('does nothing when the feature is turned off', async () => {
      await sut.onConfigUpdate(configUpdate({}, { enabled: false }));
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  describe('onAssetDelete', () => {
    it('deletes the copy at its deterministic path', async () => {
      await sut.onAssetDelete({ assetId: 'asset-1', userId: 'owner-1' });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: { files: [expect.stringMatching(/^encoded-video\/owner-1\/.*\/asset-1_ds\.mp4$/)] },
      });
    });

    it('does nothing for a video without a copy', async () => {
      exists.mockResolvedValue(false);
      await sut.onAssetDelete({ assetId: 'asset-1', userId: 'owner-1' });
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  describe('handleQueueDataSaverVideo', () => {
    it('skips while the feature is off', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled({ enabled: false }));
      await expect(sut.handleQueueDataSaverVideo({})).resolves.toBe(JobStatus.Skipped);
      expect(mocks.dataSaverVideo.streamForQueue).not.toHaveBeenCalled();
    });

    it('queues the videos whose copy is missing or stale', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled());
      mocks.dataSaverVideo.streamForQueue.mockReturnValue(makeStream([{ id: 'asset-1' }, { id: 'asset-2' }]));

      await expect(sut.handleQueueDataSaverVideo({ force: false })).resolves.toBe(JobStatus.Success);

      expect(mocks.dataSaverVideo.streamForQueue).toHaveBeenCalledWith('hevc:720:1500k', false);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.AssetEncodeDataSaverVideo, data: { id: 'asset-1', force: false } },
        { name: JobName.AssetEncodeDataSaverVideo, data: { id: 'asset-2', force: false } },
      ]);
    });
  });

  describe('handleDataSaverVideo', () => {
    beforeEach(() => {
      mocks.systemMetadata.get.mockResolvedValue(enabled());
      mocks.dataSaverVideo.getForJob.mockResolvedValue({ ...row });
      mocks.assetJob.getForVideoConversion.mockResolvedValue(video as any);
      mocks.media.transcode.mockResolvedValue();
      mocks.storage.unlink.mockResolvedValue();
    });

    it('skips while the feature is off', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled({ enabled: false }));
      await expect(sut.handleDataSaverVideo({ id: 'asset-1' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.media.transcode).not.toHaveBeenCalled();
    });

    it.each([
      ['a deleted asset', undefined],
      ['a photo', { ...row, type: AssetType.Image }],
      ['a hidden live photo part', { ...row, visibility: AssetVisibility.Hidden }],
    ])('skips %s', async (_, asset) => {
      mocks.dataSaverVideo.getForJob.mockResolvedValue(asset as any);
      await expect(sut.handleDataSaverVideo({ id: 'asset-1' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.media.transcode).not.toHaveBeenCalled();
    });

    it('skips a video whose copy was made with the current settings', async () => {
      mocks.dataSaverVideo.getForJob.mockResolvedValue({ ...row, settings: 'hevc:720:1500k' });
      await expect(sut.handleDataSaverVideo({ id: 'asset-1' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.media.transcode).not.toHaveBeenCalled();
    });

    it('remakes a current copy when forced', async () => {
      mocks.dataSaverVideo.getForJob.mockResolvedValue({ ...row, settings: 'hevc:720:1500k' });
      await expect(sut.handleDataSaverVideo({ id: 'asset-1', force: true })).resolves.toBe(JobStatus.Success);
      expect(mocks.media.transcode).toHaveBeenCalledTimes(1);
    });

    it('fails a video without probed dimensions', async () => {
      mocks.assetJob.getForVideoConversion.mockResolvedValue({
        ...video,
        videoStream: { ...videoStream, width: 0 },
      } as any);
      await expect(sut.handleDataSaverVideo({ id: 'asset-1' })).resolves.toBe(JobStatus.Failed);
    });

    it('records a video already small enough without encoding it', async () => {
      mocks.assetJob.getForVideoConversion.mockResolvedValue({
        ...video,
        videoStream: { ...videoStream, width: 1280, height: 720, bitrate: 1_600_000 },
      } as any);

      await expect(sut.handleDataSaverVideo({ id: 'asset-1' })).resolves.toBe(JobStatus.Success);

      expect(mocks.media.transcode).not.toHaveBeenCalled();
      expect(mocks.dataSaverVideo.upsert).toHaveBeenCalledWith({
        assetId: 'asset-1',
        path: null,
        settings: 'hevc:720:1500k',
        fromEdited: false,
      });
    });

    it('encodes the original with the Data Saver codec, resolution and cap, and uploads it to S3', async () => {
      await expect(sut.handleDataSaverVideo({ id: 'asset-1' })).resolves.toBe(JobStatus.Success);

      expect(ensureLocalFile).toHaveBeenCalledWith('/data/library/owner-1/IMG_0001.MOV');
      expect(mocks.media.transcode).toHaveBeenCalledWith(
        '/tmp/staged/data/library/owner-1/IMG_0001.MOV',
        expect.stringMatching(/\/encoded-video\/owner-1\/.*\/asset-1_ds\.mp4$/),
        expect.objectContaining({
          outputOptions: expect.arrayContaining(['-c:v', 'hevc', '-maxrate', '1500k']),
          twoPass: false,
        }),
      );
      const command = mocks.media.transcode.mock.calls[0][2];
      expect(command.outputOptions.join(' ')).toMatch(/scale=-2:720/);

      const key = expect.stringMatching(/^encoded-video\/owner-1\/.*\/asset-1_ds\.mp4$/);
      expect(put).toHaveBeenCalledWith(key, undefined, { contentType: 'video/mp4' });
      expect(mocks.storage.unlink).toHaveBeenCalledWith(expect.stringMatching(/asset-1_ds\.mp4$/));
      expect(mocks.dataSaverVideo.upsert).toHaveBeenCalledWith({
        assetId: 'asset-1',
        path: key,
        settings: 'hevc:720:1500k',
        fromEdited: false,
      });
    });

    it('keeps the copy where ffmpeg wrote it on disk', async () => {
      useDiskBackend();

      await expect(sut.handleDataSaverVideo({ id: 'asset-1' })).resolves.toBe(JobStatus.Success);

      expect(put).not.toHaveBeenCalled();
      expect(mocks.storage.unlink).not.toHaveBeenCalled();
      expect(mocks.dataSaverVideo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringMatching(/^\/.*\/encoded-video\/owner-1\/.*\/asset-1_ds\.mp4$/) }),
      );
    });

    it('follows a trim: encodes the trimmed file', async () => {
      mocks.dataSaverVideo.getForJob.mockResolvedValue({
        ...row,
        editedVideoPath: '/data/encoded-video/owner-1/as/se/asset-1_edited.mp4',
      });

      await sut.handleDataSaverVideo({ id: 'asset-1', force: true });

      expect(ensureLocalFile).toHaveBeenCalledWith('/data/encoded-video/owner-1/as/se/asset-1_edited.mp4');
      expect(mocks.dataSaverVideo.upsert).toHaveBeenCalledWith(expect.objectContaining({ fromEdited: true }));
    });

    it('deletes the previous copy when the new one lives elsewhere', async () => {
      mocks.dataSaverVideo.getForJob.mockResolvedValue({
        ...row,
        path: '/data/encoded-video/owner-1/as/se/asset-1_ds.mp4',
        settings: 'h264:720:2500k',
      });

      await sut.handleDataSaverVideo({ id: 'asset-1' });

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: { files: ['/data/encoded-video/owner-1/as/se/asset-1_ds.mp4'] },
      });
    });

    it('deletes the previous copy when the video no longer needs one', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled({ targetResolution: '1080', maxBitrate: '60m' }));
      mocks.dataSaverVideo.getForJob.mockResolvedValue({ ...row, path: 'encoded-video/owner-1/as/se/asset-1_ds.mp4' });
      mocks.assetJob.getForVideoConversion.mockResolvedValue({
        ...video,
        videoStream: { ...videoStream, width: 1920, height: 1080 },
      } as any);

      await sut.handleDataSaverVideo({ id: 'asset-1' });

      expect(mocks.media.transcode).not.toHaveBeenCalled();
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: { files: ['encoded-video/owner-1/as/se/asset-1_ds.mp4'] },
      });
    });

    it('fails without storing anything when software encoding fails', async () => {
      mocks.media.transcode.mockRejectedValue(new Error('ffmpeg exited with code 1'));

      await expect(sut.handleDataSaverVideo({ id: 'asset-1' })).resolves.toBe(JobStatus.Failed);

      expect(mocks.media.transcode).toHaveBeenCalledTimes(1);
      expect(mocks.dataSaverVideo.upsert).not.toHaveBeenCalled();
    });

    it('falls back to software decoding, then software encoding, as the normal transcode does', async () => {
      mocks.systemMetadata.get.mockResolvedValue(
        enabled({}, { accel: TranscodeHardwareAcceleration.Nvenc, accelDecode: true }),
      );
      sut.videoInterfaces = { dri: [], mali: false };
      mocks.media.transcode
        .mockRejectedValueOnce(new Error('hardware decode failed'))
        .mockRejectedValueOnce(new Error('hardware encode failed'))
        .mockResolvedValueOnce();

      await expect(sut.handleDataSaverVideo({ id: 'asset-1' })).resolves.toBe(JobStatus.Success);

      expect(mocks.media.transcode).toHaveBeenCalledTimes(3);
      const software = mocks.media.transcode.mock.calls[2][2];
      expect(software.outputOptions).toEqual(expect.arrayContaining(['-c:v', 'hevc']));
      expect(software.outputOptions.join(' ')).not.toMatch(/nvenc/);
    });
  });

  describe('playbackDataSaverVideo', () => {
    const auth = factory.auth({ user: { id: 'owner-1' } });
    let serve: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      serve = vi.spyOn(sut['backendMedia'], 'serveFromBackend').mockResolvedValue({} as any);
    });

    it('requires view access to the video', async () => {
      await expect(sut.playbackDataSaverVideo(auth, 'asset-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.asset.getForVideo).not.toHaveBeenCalled();
    });

    it('responds 404 for an asset that is not a video', async () => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
      mocks.asset.getForVideo.mockResolvedValue(undefined);
      await expect(sut.playbackDataSaverVideo(auth, 'asset-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('serves the copy, cached, with range support', async () => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
      mocks.asset.getForVideo.mockResolvedValue({
        originalPath: '/data/library/owner-1/IMG_0001.MOV',
        encodedVideoPath: '/data/encoded-video/owner-1/as/se/asset-1.mp4',
      });
      mocks.dataSaverVideo.get.mockResolvedValue({
        path: '/data/encoded-video/owner-1/as/se/asset-1_ds.mp4',
        settings: 'hevc:720:1500k',
        fromEdited: false,
      });

      await sut.playbackDataSaverVideo(auth, 'asset-1', 'bytes=0-');

      expect(serve).toHaveBeenCalledWith(
        '/data/encoded-video/owner-1/as/se/asset-1_ds.mp4',
        'video/mp4',
        CacheControl.PrivateWithCache,
        undefined,
        'inline',
        { range: 'bytes=0-', acceptsRanges: true },
      );
    });

    it('falls back to the encoded video, revalidated so a later copy is picked up', async () => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
      mocks.asset.getForVideo.mockResolvedValue({
        originalPath: '/data/library/owner-1/IMG_0001.MOV',
        encodedVideoPath: '/data/encoded-video/owner-1/as/se/asset-1.mp4',
      });
      mocks.dataSaverVideo.get.mockResolvedValue({ path: null, settings: 'hevc:720:1500k', fromEdited: false });

      await sut.playbackDataSaverVideo(auth, 'asset-1');

      expect(serve).toHaveBeenCalledWith(
        '/data/encoded-video/owner-1/as/se/asset-1.mp4',
        'video/mp4',
        CacheControl.PrivateWithoutCache,
        undefined,
        'inline',
        { range: undefined, acceptsRanges: true },
      );
    });

    it('falls back to the original when there is no encode either', async () => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
      mocks.asset.getForVideo.mockResolvedValue({
        originalPath: '/data/library/owner-1/IMG_0001.MOV',
        encodedVideoPath: null,
      });
      mocks.dataSaverVideo.get.mockResolvedValue(undefined);

      await sut.playbackDataSaverVideo(auth, 'asset-1');

      expect(serve).toHaveBeenCalledWith(
        '/data/library/owner-1/IMG_0001.MOV',
        'video/quicktime',
        CacheControl.PrivateWithoutCache,
        undefined,
        'inline',
        { range: undefined, acceptsRanges: true },
      );
    });
  });
});
