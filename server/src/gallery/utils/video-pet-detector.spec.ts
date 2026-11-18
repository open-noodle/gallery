import { readFile, writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetType, AssetVisibility, ImmichWorker, JobName, JobStatus } from 'src/enum.js';
import { BackendMediaServer } from 'src/gallery/utils/backend-media-server.js';
import { normalize, serializeEmbedding } from 'src/gallery/utils/video-faces.js';
import { VideoFrameReader } from 'src/gallery/utils/video-frames.js';
import { VIDEO_PET_SAMPLER_VERSION } from 'src/gallery/utils/video-pets.js';
import { PetDetectionService } from 'src/services/pet-detection.service.js';
import { StorageService } from 'src/services/storage.service.js';
import { clearConfigCache } from 'src/utils/config.js';
import { ServiceMocks, makeStream, newTestService } from 'test/utils.js';

const rex = normalize([1, 0, 0, 0]);
const fido = normalize([0, 0, 1, 0]);

const dog = (x1: number, embedding = rex, score = 0.8) => ({
  boundingBox: { x1, y1: 200, x2: x1 + 300, y2: 500 },
  score,
  label: 'dog',
  embedding: serializeEmbedding(embedding),
});

const bird = (x1: number, score = 0.7) => ({
  boundingBox: { x1, y1: 100, x2: x1 + 120, y2: 220 },
  score,
  label: 'bird',
});

const videoPets = {
  enabled: true,
  sampleInterval: 2,
  sceneDetection: false,
  maxFrames: 900,
  maxDistance: 0.55,
  minSightings: 1,
};

const config = ({
  recognition = true,
  video = {},
}: { recognition?: boolean; video?: Record<string, unknown> } = {}) => ({
  machineLearning: {
    enabled: true,
    petDetection: { enabled: true, modelName: 'rfdetr-nano', minScore: 0.3, video: { ...videoPets, ...video } },
    petRecognition: { enabled: recognition, modelName: 'pet-recognition-base', maxDistance: 0.55, minFaces: 1 },
  },
});

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

const existingPet = (overrides: Record<string, unknown>) => ({
  id: 'existing-pet',
  personGroupId: null,
  imageWidth: 1920,
  imageHeight: 1080,
  boundingBoxX1: 0,
  boundingBoxY1: 0,
  boundingBoxX2: 10,
  boundingBoxY2: 10,
  embedding: null,
  species: 'dog',
  embedded: true,
  framePath: null,
  ...overrides,
});

const makePerson = (overrides: Record<string, unknown> = {}) =>
  ({
    personGroupId: 'birds',
    ownerId: 'owner-id',
    name: 'bird',
    type: 'pet',
    species: 'bird',
    faceAssetId: null,
    ...overrides,
  }) as any;

describe('VideoPetDetector', () => {
  let sut: PetDetectionService;
  let mocks: ServiceMocks;
  let backend: { put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  let ids: number;

  beforeEach(() => {
    vi.restoreAllMocks();
    clearConfigCache();
    ({ sut, mocks } = newTestService(PetDetectionService));
    ids = 0;
    mocks.config.getWorker.mockReturnValue(ImmichWorker.Microservices);
    mocks.crypto.randomUUID.mockImplementation(() => `new-pet-${++ids}`);
    mocks.systemMetadata.get.mockResolvedValue(config());
    mocks.sharedSpace.deleteAllPets.mockResolvedValue(void 0);
    mocks.petFace.getForPetDetection.mockResolvedValue({
      ownerId: 'owner-id',
      visibility: AssetVisibility.Timeline,
      previewFile: '/data/thumbs/preview.jpeg',
    });
    mocks.petFace.getForVideoPetDetect.mockResolvedValue(video() as any);
    mocks.petFace.applyVideoPets.mockResolvedValue();
    mocks.videoFace.getPeopleRepresentedBy.mockResolvedValue([]);
    mocks.media.probe.mockResolvedValue({
      format: { duration: 10, bitrate: 0 },
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
    mocks.machineLearning.detectPets.mockResolvedValue({ imageWidth: 1920, imageHeight: 1080, pets: [] });
  });

  /** ML responses by frame time; a 10 s clip is sampled once a second, at 0.5, 1.5, ... 9.5. */
  const framesAt = (pets: Record<number, ReturnType<typeof dog | typeof bird>[]>) => {
    mocks.machineLearning.detectPets.mockImplementation(async (path) => {
      const frame = await readFile(path, 'utf8');
      const t = Number(frame.replace('frame at ', ''));
      return { imageWidth: 1920, imageHeight: 1080, pets: pets[t] ?? [] };
    });
  };

  const applied = () => mocks.petFace.applyVideoPets.mock.calls[0][0];

  it('leaves videos to poster detection when video pets are off', async () => {
    mocks.systemMetadata.get.mockResolvedValue(config({ video: { enabled: false } }));

    await expect(sut.handlePetDetection({ id: 'asset-id' })).resolves.toBe(JobStatus.Success);

    expect(mocks.petFace.getForVideoPetDetect).not.toHaveBeenCalled();
    expect(mocks.machineLearning.detectPets).toHaveBeenCalledTimes(1);
    expect(mocks.machineLearning.detectPets.mock.calls[0][0]).toBe('/data/thumbs/preview.jpeg');
  });

  it('leaves photos to poster detection when video pets are on', async () => {
    mocks.petFace.getForVideoPetDetect.mockResolvedValue(video({ type: AssetType.Image }) as any);

    await expect(sut.handlePetDetection({ id: 'asset-id' })).resolves.toBe(JobStatus.Success);

    expect(mocks.machineLearning.detectPets).toHaveBeenCalledTimes(1);
    expect(mocks.machineLearning.detectPets.mock.calls[0][0]).toBe('/data/thumbs/preview.jpeg');
    expect(mocks.petFace.applyVideoPets).not.toHaveBeenCalled();
  });

  it('samples the whole video and stores one dog with its sightings, best frame and embedding', async () => {
    framesAt({ 2.5: [dog(100, rex, 0.6)], 3.5: [dog(400, rex, 0.9)], 7.5: [dog(800, rex, 0.7)] });

    await expect(sut.handlePetDetection({ id: 'asset-id' })).resolves.toBe(JobStatus.Success);

    expect(mocks.machineLearning.detectPets).toHaveBeenCalledTimes(10);
    expect(mocks.machineLearning.detectPets.mock.calls[0][2]).toEqual({ modelName: 'pet-recognition-base' });
    const changes = applied();
    expect(changes.insert).toEqual([
      expect.objectContaining({ id: 'new-pet-1', assetId: 'asset-id', boundingBoxX1: 400, imageWidth: 1920 }),
    ]);
    expect(changes.insert[0]).not.toHaveProperty('personGroupId');
    expect(changes.embeddings).toEqual([{ faceId: 'new-pet-1', embedding: expect.any(String), species: 'dog' }]);
    expect(changes.frames).toEqual([
      expect.objectContaining({
        faceId: 'new-pet-1',
        timeSeconds: 3.5,
        version: VIDEO_PET_SAMPLER_VERSION,
        sightings: [
          expect.objectContaining({ t: 2.5, x1: 100, score: 0.6 }),
          expect.objectContaining({ t: 3.5, x1: 400, score: 0.9 }),
          expect.objectContaining({ t: 7.5, x1: 800, score: 0.7 }),
        ],
      }),
    ]);
    expect(backend.put).toHaveBeenCalledWith(
      expect.stringContaining('asset-id_faces/new-pet-1.jpeg'),
      expect.anything(),
      {
        contentType: 'image/jpeg',
      },
    );
    expect(mocks.job.queueAll).toHaveBeenCalledWith([
      { name: JobName.PetRecognition, data: { id: 'new-pet-1', deferred: false, label: 'dog' } },
    ]);
    expect(mocks.petFace.markVideoPetsSampled).toHaveBeenCalledWith('asset-id');
    // The poster path is not run as well.
    expect(mocks.petFace.refreshPetFaces).not.toHaveBeenCalled();
    expect(mocks.petFace.setPetsDetectedAt).not.toHaveBeenCalled();
  });

  it('keeps two dogs seen together as two pets', async () => {
    framesAt({ 1.5: [dog(100, rex), dog(900, fido)], 2.5: [dog(120, rex), dog(880, fido)] });

    await sut.handlePetDetection({ id: 'asset-id' });

    expect(applied().insert).toHaveLength(2);
    expect(applied().embeddings.map(({ species }) => species)).toEqual(['dog', 'dog']);
  });

  it('puts every bird of the video in one face under the owner bird person, made its cover', async () => {
    framesAt({ 1.5: [bird(100, 0.5), bird(600, 0.9)], 4.5: [bird(300)] });
    mocks.petFace.getByOwnerAndSpecies.mockResolvedValue(void 0);
    mocks.person.createWithGroup.mockResolvedValue(makePerson());
    mocks.person.getByGroupIdOnly.mockResolvedValue(makePerson());
    mocks.person.update.mockResolvedValue({} as any);

    await sut.handlePetDetection({ id: 'asset-id' });

    expect(mocks.person.createWithGroup).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'owner-id', name: 'bird', type: 'pet', species: 'bird' }),
    );
    const changes = applied();
    expect(changes.insert).toEqual([expect.objectContaining({ id: 'new-pet-1', personGroupId: 'birds' })]);
    expect(changes.embeddings).toEqual([]);
    expect(changes.frames[0].sightings!.map(({ t, x1 }) => [t, x1])).toEqual([
      [1.5, 600],
      [4.5, 300],
    ]);
    expect(mocks.person.update).toHaveBeenCalledWith({
      ownerId: 'owner-id',
      personGroupId: 'birds',
      faceAssetId: 'new-pet-1',
    });
    expect(mocks.job.queueAll).toHaveBeenCalledWith([
      { name: JobName.PersonGenerateThumbnail, data: { ownerId: 'owner-id', personGroupId: 'birds' } },
    ]);
  });

  it('buckets dogs too when pet recognition is off, and asks the ML service for no embeddings', async () => {
    mocks.systemMetadata.get.mockResolvedValue(config({ recognition: false }));
    framesAt({ 1.5: [{ ...dog(100), embedding: undefined } as any] });
    mocks.petFace.getByOwnerAndSpecies.mockResolvedValue(makePerson({ personGroupId: 'dogs', faceAssetId: 'cover' }));
    mocks.person.getByGroupIdOnly.mockResolvedValue(makePerson({ personGroupId: 'dogs', faceAssetId: 'cover' }));

    await sut.handlePetDetection({ id: 'asset-id' });

    expect(mocks.machineLearning.detectPets.mock.calls[0][2]).toBeUndefined();
    expect(applied().insert).toEqual([expect.objectContaining({ personGroupId: 'dogs' })]);
    expect(applied().embeddings).toEqual([]);
    expect(mocks.person.update).not.toHaveBeenCalled();
  });

  it('drops pets seen in fewer than minSightings frames', async () => {
    mocks.systemMetadata.get.mockResolvedValue(config({ video: { minSightings: 2 } }));
    framesAt({ 1.5: [dog(100, rex), dog(900, fido)], 2.5: [dog(120, rex)] });

    await sut.handlePetDetection({ id: 'asset-id' });

    expect(applied().insert).toHaveLength(1);
    expect(applied().frames[0].sightings).toHaveLength(2);
  });

  it('keeps a pet seen in every frame of a clip shorter than minSightings', async () => {
    mocks.systemMetadata.get.mockResolvedValue(config({ video: { minSightings: 2 } }));
    mocks.media.probe.mockResolvedValue({
      format: { duration: 1, bitrate: 0 },
      videoStreams: [{ index: 0, width: 1920, height: 1080 } as any],
      audioStreams: [],
    });
    framesAt({ 0.5: [dog(100)] });

    await sut.handlePetDetection({ id: 'asset-id' });

    expect(applied().insert).toHaveLength(1);
  });

  it('keeps a named pet face id on a rescan, and deletes an unassigned pet face it no longer finds', async () => {
    mocks.petFace.getForVideoPetDetect.mockResolvedValue(
      video({
        faces: [
          existingPet({
            id: 'rex-face',
            personGroupId: 'rex',
            embedding: serializeEmbedding(rex),
            framePath: 'old/rex.jpeg',
          }),
          existingPet({ id: 'ghost', embedding: serializeEmbedding(fido), framePath: 'old/ghost.jpeg' }),
        ],
      }) as any,
    );
    mocks.videoFace.getPeopleRepresentedBy.mockResolvedValue([{ ownerId: 'owner-id', personGroupId: 'rex' }]);
    framesAt({ 5.5: [dog(500, rex)] });

    await sut.handlePetDetection({ id: 'asset-id' });

    const changes = applied();
    expect(changes.insert).toEqual([]);
    expect(changes.update).toEqual([expect.objectContaining({ id: 'rex-face', boundingBoxX1: 500 })]);
    expect(changes.deleteIds).toEqual(['ghost']);
    expect(mocks.faceIdentity.unlinkFaces).toHaveBeenCalledWith(['ghost']);
    expect(backend.delete).toHaveBeenCalledWith('old/ghost.jpeg');
    // Rex already has a person: no recognition job, but a new thumbnail from the new best frame.
    expect(mocks.job.queueAll).toHaveBeenCalledWith([
      { name: JobName.PersonGenerateThumbnail, data: { ownerId: 'owner-id', personGroupId: 'rex' } },
    ]);
  });

  it('reuses a species bucket face on a rescan and drops its duplicates in the same bucket', async () => {
    mocks.petFace.getForVideoPetDetect.mockResolvedValue(
      video({
        faces: [
          existingPet({ id: 'poster-bird', species: 'bird', embedded: false, personGroupId: 'birds' }),
          existingPet({ id: 'other-bird', species: 'bird', embedded: false, personGroupId: 'birds' }),
          existingPet({ id: 'named-bird', species: 'bird', embedded: false, personGroupId: 'tweety' }),
        ],
      }) as any,
    );
    framesAt({ 1.5: [bird(100)] });

    await sut.handlePetDetection({ id: 'asset-id' });

    const changes = applied();
    expect(changes.update).toEqual([expect.objectContaining({ id: 'poster-bird' })]);
    expect(changes.insert).toEqual([]);
    expect(changes.deleteIds).toEqual(['other-bird']);
    expect(mocks.person.createWithGroup).not.toHaveBeenCalled();
  });

  it('falls back to the poster for a video without a readable stream, stamped so Missing does not retry it', async () => {
    mocks.media.probe.mockResolvedValue({ format: { duration: 10, bitrate: 0 }, videoStreams: [], audioStreams: [] });
    mocks.machineLearning.detectPets.mockResolvedValue({ imageWidth: 1920, imageHeight: 1080, pets: [] });

    await expect(sut.handlePetDetection({ id: 'asset-id' })).resolves.toBe(JobStatus.Success);

    expect(mocks.petFace.markVideoPetsSampled).toHaveBeenCalledWith('asset-id');
    expect(mocks.machineLearning.detectPets.mock.calls[0][0]).toBe('/data/thumbs/preview.jpeg');
    expect(mocks.petFace.applyVideoPets).not.toHaveBeenCalled();
  });

  it('fails the job, logged and unstamped, when the ML service fails, after the frame being extracted settles', async () => {
    let extractions = 0;
    let settled = 0;
    vi.mocked(VideoFrameReader.prototype.extractFrame).mockImplementation(async (_input, output, t) => {
      extractions++;
      await writeFile(output, `frame at ${t}`);
      settled++;
    });
    mocks.machineLearning.detectPets.mockRejectedValue(new Error('failed for all URLs'));

    await expect(sut.handlePetDetection({ id: 'asset-id' })).resolves.toBe(JobStatus.Failed);

    expect(mocks.logger.error).toHaveBeenCalledWith(expect.stringContaining('failed for all URLs'));
    expect(settled).toBe(extractions);
    expect(mocks.petFace.applyVideoPets).not.toHaveBeenCalled();
    expect(mocks.petFace.markVideoPetsSampled).not.toHaveBeenCalled();
    expect(mocks.petFace.setPetsDetectedAt).not.toHaveBeenCalled();
  });

  it('skips a hidden video', async () => {
    mocks.petFace.getForVideoPetDetect.mockResolvedValue(video({ visibility: AssetVisibility.Hidden }) as any);

    await expect(sut.handlePetDetection({ id: 'asset-id' })).resolves.toBe(JobStatus.Skipped);

    expect(mocks.machineLearning.detectPets).not.toHaveBeenCalled();
  });

  it('writes nothing when the recognition model changed while the video was sampled', async () => {
    framesAt({ 1.5: [dog(100)] });
    mocks.machineLearning.detectPets.mockImplementationOnce(() => {
      clearConfigCache();
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { ...config().machineLearning, petRecognition: { enabled: true, modelName: 'other-model' } },
      });
      return Promise.resolve({ imageWidth: 1920, imageHeight: 1080, pets: [] });
    });

    await expect(sut.handlePetDetection({ id: 'asset-id' })).resolves.toBe(JobStatus.Skipped);

    expect(mocks.petFace.applyVideoPets).not.toHaveBeenCalled();
    expect(mocks.petFace.markVideoPetsSampled).not.toHaveBeenCalled();
  });

  describe('Missing and Reset', () => {
    it('queues videos detected from their poster only when video pets are on', async () => {
      mocks.petFace.streamForPetDetectionJob.mockReturnValue(makeStream([{ id: 'photo' }]));
      mocks.petFace.streamVideosForPetSampling.mockReturnValue(makeStream([{ id: 'old-video' }]));

      await expect(sut.handleQueuePetDetection({ force: false })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: JobName.PetDetection, data: { id: 'photo' } }]);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: JobName.PetDetection, data: { id: 'old-video' } }]);
    });

    it('queues no extra videos when video pets are off, or on a reset that queues every asset', async () => {
      mocks.petFace.streamForPetDetectionJob.mockReturnValue(makeStream([]));
      mocks.systemMetadata.get.mockResolvedValue(config({ video: { enabled: false } }));
      await sut.handleQueuePetDetection({ force: false });

      mocks.systemMetadata.get.mockResolvedValue(config());
      clearConfigCache();
      mocks.petFace.streamForPetDetectionJob.mockReturnValue(makeStream([]));
      await sut.handleQueuePetDetection({ force: true });

      expect(mocks.petFace.streamVideosForPetSampling).not.toHaveBeenCalled();
    });

    it('deletes the frame files of every pet a reset purges', async () => {
      mocks.petFace.getPetFramePaths.mockResolvedValue(['thumbs/a_faces/1.jpeg', 'thumbs/b_faces/2.jpeg']);
      mocks.petFace.streamForPetDetectionJob.mockReturnValue(makeStream([]));

      await sut.handleQueuePetDetection({ force: true });

      expect(mocks.petFace.getPetFramePaths).toHaveBeenCalledWith({ embeddedOnly: false });
      expect(mocks.petFace.getPetFramePaths.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.petFace.deleteAllPets.mock.invocationCallOrder[0],
      );
      expect(backend.delete).toHaveBeenCalledWith('thumbs/a_faces/1.jpeg');
      expect(backend.delete).toHaveBeenCalledWith('thumbs/b_faces/2.jpeg');
    });
  });
});
