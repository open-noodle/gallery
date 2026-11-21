import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetType, AssetVisibility, ImmichWorker, JobStatus } from 'src/enum.js';
import { BackendMediaServer } from 'src/gallery/utils/backend-media-server.js';
import { VideoFrameReader } from 'src/gallery/utils/video-frames.js';
import { VideoSampleCache, videoSampleCache } from 'src/gallery/utils/video-sample-cache.js';
import { PersonService } from 'src/services/person.service.js';
import { PetDetectionService } from 'src/services/pet-detection.service.js';
import { clearConfigCache } from 'src/utils/config.js';
import { newTestService } from 'test/utils.js';

describe('human and pet video sample sharing', () => {
  let dir: string;
  let cache: VideoSampleCache;

  beforeEach(async () => {
    clearConfigCache();
    dir = await mkdtemp(join(tmpdir(), 'video-detection-cache-spec-'));
    cache = new VideoSampleCache({ root: join(dir, 'cache') });
    vi.spyOn(videoSampleCache, 'materialize').mockImplementation((...args) => cache.materialize(...args));
    vi.spyOn(BackendMediaServer.prototype, 'ensureLocalFile').mockResolvedValue({
      localPath: '/data/video.mp4',
      cleanup: () => Promise.resolve(),
      [Symbol.asyncDispose]: () => Promise.resolve(),
    });
    vi.spyOn(VideoFrameReader.prototype, 'findSceneCuts').mockResolvedValue([]);
    vi.spyOn(VideoFrameReader.prototype, 'extractFrame').mockImplementation((_input, output, t) =>
      writeFile(output, `frame at ${t}`),
    );
    vi.spyOn(VideoFrameReader.prototype, 'getDimensions').mockResolvedValue({ width: 1920, height: 1080 });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    clearConfigCache();
    cache[Symbol.dispose]();
    await rm(dir, { recursive: true, force: true });
  });

  it.each(['human first', 'pets first', 'concurrent'])('extracts once while both models run: %s', async (order) => {
    const human = newTestService(PersonService);
    const pets = newTestService(PetDetectionService);
    const source = {
      id: 'asset',
      ownerId: 'owner',
      type: AssetType.Video,
      visibility: AssetVisibility.Timeline,
      originalPath: '/data/video.mp4',
      checksum: Buffer.from('source video'),
      trimStart: null,
      trimEnd: null,
      faces: [],
    };
    const video = { enabled: true, sampleInterval: 2, sceneDetection: true, maxFrames: 900, tiledDetection: false };
    const config = {
      machineLearning: {
        enabled: true,
        facialRecognition: { enabled: true, video },
        petDetection: { enabled: true, video },
        petRecognition: { enabled: false },
      },
    };
    for (const mocks of [human.mocks, pets.mocks]) {
      mocks.systemMetadata.get.mockResolvedValue(config);
      mocks.config.getWorker.mockReturnValue(ImmichWorker.Microservices);
      mocks.media.probe.mockResolvedValue({
        format: { duration: 4, bitrate: 0 },
        videoStreams: [{ index: 0, width: 1920, height: 1080 } as any],
        audioStreams: [],
      });
    }
    human.mocks.assetJob.getForDetectFacesJob.mockResolvedValue({
      id: source.id,
      visibility: source.visibility,
      previewFile: { path: 'poster.jpeg' },
      faces: [],
    } as any);
    human.mocks.videoFace.getForDetect.mockResolvedValue(source as any);
    human.mocks.machineLearning.detectFaces.mockResolvedValue({ imageWidth: 1920, imageHeight: 1080, faces: [] });
    pets.mocks.petFace.getForPetDetection.mockResolvedValue({
      ownerId: source.ownerId,
      visibility: source.visibility,
      previewFile: null,
    });
    pets.mocks.petFace.getForVideoPetDetect.mockResolvedValue(source as any);
    pets.mocks.machineLearning.detectPets.mockResolvedValue({ imageWidth: 1920, imageHeight: 1080, pets: [] });

    const detectHuman = () => human.sut.handleDetectFaces({ id: source.id });
    const detectPets = () => pets.sut.handlePetDetection({ id: source.id });
    const results =
      order === 'concurrent'
        ? await Promise.all([detectHuman(), detectPets()])
        : order === 'human first'
          ? [await detectHuman(), await detectPets()]
          : [await detectPets(), await detectHuman()];

    expect(results).toEqual([JobStatus.Success, JobStatus.Success]);
    expect(VideoFrameReader.prototype.findSceneCuts).toHaveBeenCalledTimes(1);
    expect(VideoFrameReader.prototype.extractFrame).toHaveBeenCalledTimes(4);
    expect(human.mocks.machineLearning.detectFaces).toHaveBeenCalledTimes(4);
    expect(pets.mocks.machineLearning.detectPets).toHaveBeenCalledTimes(4);
    const reused = [...human.mocks.logger.log.mock.calls, ...pets.mocks.logger.log.mock.calls].map(([message]) =>
      Number(message.match(/\((\d+) frames reused\)/)?.[1] ?? 0),
    );
    expect(reused.reduce((total, count) => total + count, 0)).toBe(4);
    // Each pipeline still persists only its own results.
    expect(human.mocks.petFace.applyVideoPets).not.toHaveBeenCalled();
    expect(pets.mocks.videoFace.apply).not.toHaveBeenCalled();
  });
});
