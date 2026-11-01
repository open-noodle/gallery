import { writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetType, AssetVisibility, JobName, JobStatus, SourceType } from 'src/enum.js';
import { BackendMediaServer } from 'src/gallery/utils/backend-media-server.js';
import { normalize, serializeEmbedding } from 'src/gallery/utils/video-faces.js';
import { VideoFrameReader } from 'src/gallery/utils/video-frames.js';
import { PersonService } from 'src/services/person.service.js';
import { StorageService } from 'src/services/storage.service.js';
import { ServiceMocks, makeStream, newTestService } from 'test/utils.js';

const alice = normalize([1, 0, 0, 0]);
const bob = normalize([0, 0, 1, 0]);
const blurred = normalize([0, 1, 0, 0]);

const face = (embedding: number[], x1: number, size = 150, score = 0.9) => ({
  boundingBox: { x1, y1: 300, x2: x1 + size, y2: 300 + size },
  embedding: serializeEmbedding(embedding),
  score,
});

/** A face the detector is unsure of: below the photo threshold, above the low one. */
const unsure = (x1: number, score: number, size = 60) => face(alice, x1, size, score);

const videoConfig = {
  machineLearning: {
    facialRecognition: { video: { enabled: true, sampleInterval: 2, sceneDetection: false, maxFrames: 1800 } },
  },
};

const video = (overrides: Record<string, unknown> = {}) => ({
  id: 'asset-id',
  ownerId: 'owner-id',
  type: AssetType.Video,
  visibility: AssetVisibility.Timeline,
  originalPath: '/data/library/video.mp4',
  trimStart: null,
  trimEnd: null,
  faces: [],
  ...overrides,
});

const existingFace = (overrides: Record<string, unknown>) => ({
  id: 'existing-face',
  personGroupId: null,
  sourceType: SourceType.MachineLearning,
  imageWidth: 1920,
  imageHeight: 1080,
  boundingBoxX1: 0,
  boundingBoxY1: 0,
  boundingBoxX2: 10,
  boundingBoxY2: 10,
  embedding: null,
  framePath: null,
  isPet: false,
  ...overrides,
});

/** Everything logged at the `log` level, in order. */
const loggedMessages = (mocks: ServiceMocks): string[] => mocks.logger.log.mock.calls.map(([message]) => message);

/** The times the detector extracted frames at, in order. */
const sampledTimes = () => vi.mocked(VideoFrameReader.prototype.extractFrame).mock.calls.map((call) => call[2]);

describe('VideoFaceDetector', () => {
  let sut: PersonService;
  let mocks: ServiceMocks;
  let backend: { put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  let ids: number;

  beforeEach(() => {
    vi.restoreAllMocks();
    ({ sut, mocks } = newTestService(PersonService));
    ids = 0;
    mocks.crypto.randomUUID.mockImplementation(() => `new-face-${++ids}`);
    mocks.systemMetadata.get.mockResolvedValue(videoConfig);
    mocks.assetJob.getForDetectFacesJob.mockResolvedValue({
      id: 'asset-id',
      visibility: AssetVisibility.Timeline,
      previewFile: { path: '/data/thumbs/preview.jpeg' },
      faces: [],
    } as any);
    mocks.videoFace.getForDetect.mockResolvedValue(video() as any);
    mocks.videoFace.getPeopleRepresentedBy.mockResolvedValue([]);
    mocks.media.probe.mockResolvedValue({
      format: { duration: 66, bitrate: 0 },
      videoStreams: [{ index: 0, width: 1920, height: 1080 } as any],
      audioStreams: [],
    });

    backend = { put: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue(backend as any);
    vi.spyOn(BackendMediaServer.prototype, 'ensureLocalFile').mockResolvedValue({
      localPath: '/data/library/video.mp4',
      cleanup: () => Promise.resolve(),
      [Symbol.asyncDispose]: () => Promise.resolve(),
    });
    vi.spyOn(BackendMediaServer.prototype, 'backendFor').mockResolvedValue(backend as any);
    vi.spyOn(VideoFrameReader.prototype, 'findSceneCuts').mockResolvedValue([]);
    vi.spyOn(VideoFrameReader.prototype, 'extractFrame').mockImplementation(async (_input, output, t) => {
      await writeFile(output, `frame at ${t}`);
    });
    vi.spyOn(VideoFrameReader.prototype, 'getDimensions').mockResolvedValue({ width: 1920, height: 1080 });
    vi.spyOn(VideoFrameReader.prototype, 'measureSharpness').mockResolvedValue(300);
    vi.spyOn(VideoFrameReader.prototype, 'extractTile').mockImplementation(async (_frame, output) => {
      await writeFile(output, 'tile');
    });
    // Frames nobody is set up to appear in are empty.
    mocks.machineLearning.detectFaces.mockResolvedValue({ imageWidth: 1920, imageHeight: 1080, faces: [] });
  });

  /** ML responses for the first sampled frames, in order (66 s at a 2 s interval samples 1, 3, 5, ... 65). */
  const framesShow = (...frames: ReturnType<typeof face>[][]) => {
    for (const faces of frames) {
      mocks.machineLearning.detectFaces.mockResolvedValueOnce({ imageWidth: 1920, imageHeight: 1080, faces });
    }
  };

  it('leaves videos to upstream single-frame detection when the feature is off', async () => {
    mocks.systemMetadata.get.mockResolvedValue({});
    mocks.machineLearning.detectFaces.mockResolvedValue({ imageWidth: 1920, imageHeight: 1080, faces: [] });

    await sut.handleDetectFaces({ id: 'asset-id' });

    expect(mocks.videoFace.getForDetect).not.toHaveBeenCalled();
    expect(mocks.machineLearning.detectFaces).toHaveBeenCalledWith('/data/thumbs/preview.jpeg', expect.anything());
  });

  it('leaves photos to upstream detection', async () => {
    mocks.videoFace.getForDetect.mockResolvedValue(video({ type: AssetType.Image }) as any);
    mocks.machineLearning.detectFaces.mockResolvedValue({ imageWidth: 1920, imageHeight: 1080, faces: [] });

    await sut.handleDetectFaces({ id: 'asset-id' });

    expect(mocks.machineLearning.detectFaces).toHaveBeenCalledTimes(1);
    expect(mocks.machineLearning.detectFaces).toHaveBeenCalledWith('/data/thumbs/preview.jpeg', expect.anything());
    expect(mocks.videoFace.apply).not.toHaveBeenCalled();
  });

  describe('face detection queue jobs', () => {
    beforeEach(() => {
      mocks.assetJob.streamForDetectFacesJob.mockReturnValue(makeStream([]));
      mocks.videoFace.streamUnsampled.mockReturnValue(makeStream([{ id: 'old-video-1' }, { id: 'old-video-2' }]));
    });

    it('adds videos not yet sampled across the whole video to the Missing job', async () => {
      await sut.handleQueueDetectFaces({ force: false });

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.AssetDetectFaces, data: { id: 'old-video-1' } },
        { name: JobName.AssetDetectFaces, data: { id: 'old-video-2' } },
      ]);
    });

    it('adds nothing to Missing while the feature is off', async () => {
      mocks.systemMetadata.get.mockResolvedValue({});

      await sut.handleQueueDetectFaces({ force: false });

      expect(mocks.videoFace.streamUnsampled).not.toHaveBeenCalled();
    });

    it('adds nothing to Reset or Refresh, which already queue every asset', async () => {
      mocks.person.getAllWithoutFaces.mockResolvedValue([]);
      mocks.sharedSpace.deleteAllOrphanedPersons.mockResolvedValue(void 0 as any);

      await sut.handleQueueDetectFaces({ force: true });
      await sut.handleQueueDetectFaces({});

      expect(mocks.videoFace.streamUnsampled).not.toHaveBeenCalled();
    });
  });

  it('falls back to the poster when the video has no readable stream, stamped so Missing does not retry it', async () => {
    mocks.media.probe.mockResolvedValue({ format: { duration: 6, bitrate: 0 }, videoStreams: [], audioStreams: [] });
    mocks.machineLearning.detectFaces.mockResolvedValue({ imageWidth: 1920, imageHeight: 1080, faces: [] });

    await sut.handleDetectFaces({ id: 'asset-id' });

    expect(mocks.machineLearning.detectFaces).toHaveBeenCalledWith('/data/thumbs/preview.jpeg', expect.anything());
    expect(mocks.videoFace.apply).not.toHaveBeenCalled();
    expect(mocks.videoFace.markSampled).toHaveBeenCalledWith('asset-id');
  });

  it('finds everyone across the video, one face per person, boxed in their best frame', async () => {
    framesShow([face(alice, 100, 60)], [face(alice, 120, 200)], [face(alice, 140, 80), face(bob, 900)]);

    await expect(sut.handleDetectFaces({ id: 'asset-id' })).resolves.toBe(JobStatus.Success);

    expect(VideoFrameReader.prototype.extractFrame).toHaveBeenCalledTimes(33);
    expect(sampledTimes().slice(0, 3)).toEqual([1, 3, 5]);
    expect(mocks.machineLearning.detectFaces).not.toHaveBeenCalledWith('/data/thumbs/preview.jpeg', expect.anything());
    expect(mocks.person.refreshFaces).not.toHaveBeenCalled();

    const changes = mocks.videoFace.apply.mock.calls[0][0];
    expect(changes.insert).toEqual([
      expect.objectContaining({ id: 'new-face-1', assetId: 'asset-id', boundingBoxX1: 120, boundingBoxX2: 320 }),
      expect.objectContaining({ id: 'new-face-2', assetId: 'asset-id', boundingBoxX1: 900 }),
    ]);
    expect(changes.insert[0]).toMatchObject({ imageWidth: 1920, imageHeight: 1080 });
    expect(changes.frames).toEqual([
      expect.objectContaining({
        faceId: 'new-face-1',
        timeSeconds: 3,
        path: 'thumbs/owner-id/as/se/asset-id_faces/new-face-1.jpeg',
        sightings: [
          expect.objectContaining({ t: 1 }),
          expect.objectContaining({ t: 3 }),
          expect.objectContaining({ t: 5 }),
        ],
      }),
      expect.objectContaining({ faceId: 'new-face-2', timeSeconds: 5 }),
    ]);
    expect(changes.embeddings.map(({ faceId }) => faceId)).toEqual(['new-face-1', 'new-face-2']);
    expect(changes.deleteIds).toEqual([]);

    // Each face's best frame is stored: alice's from 3 s, bob's from 5 s.
    expect(backend.put).toHaveBeenCalledWith(
      'thumbs/owner-id/as/se/asset-id_faces/new-face-1.jpeg',
      Buffer.from('frame at 3'),
      { contentType: 'image/jpeg' },
    );
    expect(backend.put).toHaveBeenCalledWith(
      'thumbs/owner-id/as/se/asset-id_faces/new-face-2.jpeg',
      Buffer.from('frame at 5'),
      { contentType: 'image/jpeg' },
    );

    expect(mocks.job.queueAll).toHaveBeenCalledWith([
      { name: JobName.FacialRecognitionQueueAll, data: { force: false } },
      { name: JobName.FacialRecognition, data: { id: 'new-face-1' } },
      { name: JobName.FacialRecognition, data: { id: 'new-face-2' } },
    ]);
    expect(mocks.videoFace.markSampled).toHaveBeenCalledWith('asset-id');
    expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
      assetId: 'asset-id',
      facesRecognizedAt: expect.any(Date),
    });
  });

  it('samples only inside a trim', async () => {
    mocks.videoFace.getForDetect.mockResolvedValue(video({ trimStart: 2, trimEnd: 4 }) as any);
    framesShow([]);

    await sut.handleDetectFaces({ id: 'asset-id' });

    // Two seconds is a short clip, sampled every second.
    expect(sampledTimes()).toEqual([2.5, 3.5]);
  });

  it('adds a sample after each scene cut when scene detection is on', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: {
        facialRecognition: { video: { ...videoConfig.machineLearning.facialRecognition.video, sceneDetection: true } },
      },
    });
    mocks.media.probe.mockResolvedValue({
      format: { duration: 12, bitrate: 0 },
      videoStreams: [{ index: 0, width: 1920, height: 1080 } as any],
      audioStreams: [],
    });
    vi.mocked(VideoFrameReader.prototype.findSceneCuts).mockResolvedValue([7.8]);
    mocks.machineLearning.detectFaces.mockResolvedValue({ imageWidth: 1920, imageHeight: 1080, faces: [] });

    await sut.handleDetectFaces({ id: 'asset-id' });

    expect(sampledTimes()).toContain(8);
  });

  it('marks a video without faces as sampled, so a later toggle does not rescan it', async () => {
    framesShow([], [], []);

    await expect(sut.handleDetectFaces({ id: 'asset-id' })).resolves.toBe(JobStatus.Success);

    expect(mocks.videoFace.apply).toHaveBeenCalledWith({
      insert: [],
      update: [],
      deleteIds: [],
      embeddings: [],
      frames: [],
    });
    expect(mocks.job.queueAll).not.toHaveBeenCalled();
    expect(mocks.videoFace.markSampled).toHaveBeenCalledWith('asset-id');
  });

  describe('re-scanning a video that already has faces', () => {
    it('keeps a named face by embedding, moves it to its best frame, and refreshes its person thumbnail', async () => {
      mocks.videoFace.getForDetect.mockResolvedValue(
        video({
          faces: [
            existingFace({ id: 'alice-face', personGroupId: 'alice-person', embedding: serializeEmbedding(alice) }),
          ],
        }) as any,
      );
      mocks.videoFace.getPeopleRepresentedBy.mockResolvedValue([
        { ownerId: 'owner-id', personGroupId: 'alice-person' },
      ]);
      framesShow([face(alice, 100)], [], []);

      await sut.handleDetectFaces({ id: 'asset-id' });

      const changes = mocks.videoFace.apply.mock.calls[0][0];
      expect(changes.insert).toEqual([]);
      expect(changes.update).toEqual([expect.objectContaining({ id: 'alice-face', boundingBoxX1: 100 })]);
      expect(changes.frames[0]).toMatchObject({ faceId: 'alice-face' });
      expect(mocks.videoFace.getPeopleRepresentedBy).toHaveBeenCalledWith(['alice-face']);
      // A named face is not re-recognised; only its person's thumbnail is redone.
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.PersonGenerateThumbnail, data: { ownerId: 'owner-id', personGroupId: 'alice-person' } },
      ]);
    });

    it('matches an old poster face by position, and re-recognises it when it was unnamed', async () => {
      mocks.videoFace.getForDetect.mockResolvedValue(
        video({
          faces: [
            existingFace({
              id: 'poster-face',
              embedding: serializeEmbedding(blurred),
              imageWidth: 1440,
              imageHeight: 810,
              boundingBoxX1: 75,
              boundingBoxY1: 225,
              boundingBoxX2: 187,
              boundingBoxY2: 337,
            }),
          ],
        }) as any,
      );
      framesShow([face(alice, 100)], [], []);

      await sut.handleDetectFaces({ id: 'asset-id' });

      const changes = mocks.videoFace.apply.mock.calls[0][0];
      expect(changes.update).toEqual([expect.objectContaining({ id: 'poster-face' })]);
      expect(changes.deleteIds).toEqual([]);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.FacialRecognitionQueueAll, data: { force: false } },
        { name: JobName.FacialRecognition, data: { id: 'poster-face' } },
      ]);
    });

    it('drops an unmatched unnamed face with its frame, keeps an unmatched named one, and never touches pets or manual faces', async () => {
      mocks.videoFace.getForDetect.mockResolvedValue(
        video({
          faces: [
            existingFace({ id: 'gone', embedding: serializeEmbedding(bob), framePath: 'thumbs/old/gone.jpeg' }),
            existingFace({ id: 'named', personGroupId: 'someone', embedding: serializeEmbedding(blurred) }),
            existingFace({ id: 'pet', isPet: true }),
            existingFace({ id: 'manual', sourceType: SourceType.Manual }),
          ],
        }) as any,
      );
      framesShow([face(alice, 100)], [], []);

      await sut.handleDetectFaces({ id: 'asset-id' });

      const changes = mocks.videoFace.apply.mock.calls[0][0];
      expect(changes.deleteIds).toEqual(['gone']);
      expect(changes.update).toEqual([]);
      expect(changes.insert).toEqual([expect.objectContaining({ id: 'new-face-1' })]);
      expect(mocks.faceIdentity.unlinkFaces).toHaveBeenCalledWith(['gone']);
      expect(backend.delete).toHaveBeenCalledWith('thumbs/old/gone.jpeg');
    });

    it('re-runs recognition for everything after a forced detection', async () => {
      framesShow([face(alice, 100)], [], []);

      await sut.handleDetectFaces({ id: 'asset-id', force: true });

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.FacialRecognitionQueueAll, data: { force: true } },
      ]);
    });
  });

  it('samples a short clip at least once a second', async () => {
    mocks.media.probe.mockResolvedValue({
      format: { duration: 6, bitrate: 0 },
      videoStreams: [{ index: 0, width: 1920, height: 1080 } as any],
      audioStreams: [],
    });

    await sut.handleDetectFaces({ id: 'asset-id' });

    expect(sampledTimes()).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5]);
  });

  describe('per-person confidence', () => {
    it('searches frames below the photo threshold', async () => {
      await sut.handleDetectFaces({ id: 'asset-id' });

      expect(mocks.machineLearning.detectFaces).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ minScore: 0.45 }),
      );
    });

    it('keeps a person never confident in one frame but seen consistently', async () => {
      framesShow([unsure(100, 0.5)], [unsure(104, 0.55)], [unsure(108, 0.48)], [unsure(112, 0.6)]);

      await sut.handleDetectFaces({ id: 'asset-id' });

      expect(mocks.videoFace.apply.mock.calls[0][0].insert).toHaveLength(1);
    });

    it('drops a low-confidence face seen only once or twice', async () => {
      framesShow([unsure(100, 0.6)], [unsure(104, 0.6)]);

      await sut.handleDetectFaces({ id: 'asset-id' });

      expect(mocks.videoFace.apply.mock.calls[0][0].insert).toEqual([]);
    });

    it('drops a consistent low-confidence face too small to recognise', async () => {
      framesShow([unsure(100, 0.6, 20)], [unsure(104, 0.6, 20)], [unsure(108, 0.6, 20)], [unsure(112, 0.6, 20)]);

      await sut.handleDetectFaces({ id: 'asset-id' });

      expect(mocks.videoFace.apply.mock.calls[0][0].insert).toEqual([]);
    });
  });

  describe('tiled detection', () => {
    beforeEach(() => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          facialRecognition: {
            video: { ...videoConfig.machineLearning.facialRecognition.video, tiledDetection: true },
          },
        },
      });
      mocks.media.probe.mockResolvedValue({
        format: { duration: 66, bitrate: 0 },
        videoStreams: [{ index: 0, width: 1920, height: 1080 } as any],
        audioStreams: [],
      });
      mocks.videoFace.getForDetect.mockResolvedValue(video() as any);
    });

    it('searches the whole frame and four overlapping quarters, with boxes moved into frame pixels', async () => {
      // Whole frame: nothing. Bottom-right quarter: a face at (100, 100) of the quarter.
      mocks.machineLearning.detectFaces
        .mockResolvedValueOnce({ imageWidth: 1920, imageHeight: 1080, faces: [] })
        .mockResolvedValueOnce({ imageWidth: 1104, imageHeight: 621, faces: [] })
        .mockResolvedValueOnce({ imageWidth: 1104, imageHeight: 621, faces: [] })
        .mockResolvedValueOnce({ imageWidth: 1104, imageHeight: 621, faces: [] })
        .mockResolvedValueOnce({ imageWidth: 1104, imageHeight: 621, faces: [face(alice, 100)] });

      await sut.handleDetectFaces({ id: 'asset-id' });

      expect(VideoFrameReader.prototype.extractTile).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
        left: 816,
        top: 459,
        width: 1104,
        height: 621,
      });
      // 33 frames, each searched whole and as four quarters.
      expect(mocks.machineLearning.detectFaces).toHaveBeenCalledTimes(33 * 5);
      expect(mocks.videoFace.apply.mock.calls[0][0].insert).toEqual([
        expect.objectContaining({ boundingBoxX1: 916, boundingBoxY1: 759 }),
      ]);
    });

    it('counts a face found both whole and in a quarter once', async () => {
      const whole = face(alice, 100);
      mocks.machineLearning.detectFaces
        .mockResolvedValueOnce({ imageWidth: 1920, imageHeight: 1080, faces: [whole] })
        .mockResolvedValueOnce({ imageWidth: 1104, imageHeight: 621, faces: [face(alice, 102)] });

      await sut.handleDetectFaces({ id: 'asset-id' });

      const { frames } = mocks.videoFace.apply.mock.calls[0][0];
      expect(frames).toHaveLength(1);
      expect(frames[0].sightings).toHaveLength(1);
    });

    it('does not tile a frame already small enough for the detector', async () => {
      vi.mocked(VideoFrameReader.prototype.getDimensions).mockResolvedValue({ width: 640, height: 480 });

      await sut.handleDetectFaces({ id: 'asset-id' });

      expect(VideoFrameReader.prototype.extractTile).not.toHaveBeenCalled();
      expect(mocks.machineLearning.detectFaces).toHaveBeenCalledTimes(33);
    });
  });

  describe('logging', () => {
    it('logs only a start and a finish line for a short video', async () => {
      framesShow([face(alice, 100, 60)], [face(alice, 120, 200)], [face(alice, 140, 80), face(bob, 900)]);

      await sut.handleDetectFaces({ id: 'asset-id' });

      expect(loggedMessages(mocks).filter((message) => message.includes('video asset-id'))).toEqual([
        'Sampling 33 frames across 1m, 6s of video asset-id (about every 2s, 0 scene cuts)',
        expect.stringMatching(
          /^Found 2 people \(of 2 candidates\) in 33 frames of video asset-id in \d+s \(2 new, 0 kept, 0 removed\)$/,
        ),
      ]);
    });

    it('logs progress every 10% for a long video, as transcoding does', async () => {
      mocks.media.probe.mockResolvedValue({
        format: { duration: 400, bitrate: 0 },
        videoStreams: [{ index: 0, width: 1920, height: 1080 } as any],
        audioStreams: [],
      });
      mocks.machineLearning.detectFaces.mockResolvedValue({
        imageWidth: 1920,
        imageHeight: 1080,
        faces: [face(alice, 100)],
      });

      await sut.handleDetectFaces({ id: 'asset-id' });

      const progress = loggedMessages(mocks).filter((message) => message.startsWith('Video faces'));
      expect(progress).toHaveLength(9);
      expect(progress[0]).toMatch(
        /^Video faces 10% done \(20 of 200 frames, 1 faces tracked so far\), estimated \S+ remaining for video asset-id$/,
      );
      expect(progress.at(-1)).toMatch(/^Video faces 90% done \(180 of 200 frames/);
    });

    it('counts frames that could not be read in the finish line', async () => {
      vi.mocked(VideoFrameReader.prototype.extractFrame).mockImplementation(async (_input, output, t) => {
        if (t === 3) {
          throw new Error('decode error');
        }
        await writeFile(output, `frame at ${t}`);
      });
      framesShow([face(alice, 100)], []);

      await sut.handleDetectFaces({ id: 'asset-id' });

      expect(loggedMessages(mocks)).toContainEqual(
        expect.stringMatching(/\(1 new, 0 kept, 0 removed, 1 frames unreadable\)$/),
      );
    });
  });

  it('keeps only frames that are somebody’s best view while sampling', async () => {
    framesShow([face(alice, 100, 60)], [face(alice, 100, 200)], [face(alice, 100, 80)]);

    await sut.handleDetectFaces({ id: 'asset-id' });

    expect(backend.put).toHaveBeenCalledTimes(1);
    expect(backend.put).toHaveBeenCalledWith(expect.any(String), Buffer.from('frame at 3'), expect.anything());
  });
});
