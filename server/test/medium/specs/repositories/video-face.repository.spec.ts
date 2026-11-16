import { Kysely } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { AssetType, AssetVisibility } from 'src/enum.js';
import { VideoFaceRepository } from 'src/gallery/repositories/video-face.repository.js';
import { VIDEO_FACE_SAMPLER_VERSION } from 'src/gallery/utils/video-faces.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { StorageMigrationRepository } from 'src/repositories/storage-migration.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { newEmbedding, newUuid } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const box = {
  imageWidth: 1920,
  imageHeight: 1080,
  boundingBoxX1: 100,
  boundingBoxY1: 200,
  boundingBoxX2: 160,
  boundingBoxY2: 270,
};

const frame = (faceId: string, overrides: Record<string, unknown> = {}) => ({
  faceId,
  path: `thumbs/owner/aa/bb/asset_faces/${faceId}.jpeg`,
  timeSeconds: 3.25,
  quality: 0.4,
  sightings: [{ t: 3.25, x1: 100, y1: 200, x2: 160, y2: 270, score: 0.81 }],
  version: 2,
  ...overrides,
});

const setup = async () => {
  const { ctx } = newMediumService(BaseService, { database: defaultDatabase, real: [], mock: [LoggingRepository] });
  const { user } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
  return { ctx, user, asset, sut: ctx.get(VideoFaceRepository) };
};

const facesOf = (assetId: string) =>
  defaultDatabase
    .selectFrom('asset_face')
    .leftJoin('asset_face_video_frame', 'asset_face_video_frame.faceId', 'asset_face.id')
    .leftJoin('face_search', 'face_search.faceId', 'asset_face.id')
    .select([
      'asset_face.id',
      'asset_face.boundingBoxX1',
      'asset_face_video_frame.timeSeconds',
      'asset_face_video_frame.path',
      'face_search.embedding',
    ])
    .where('asset_face.assetId', '=', assetId)
    .orderBy('asset_face.boundingBoxX1')
    .execute();

const unsampled = async (sut: VideoFaceRepository) => {
  const ids: string[] = [];
  for await (const { id } of sut.streamUnsampled()) {
    ids.push(id);
  }
  return ids;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(VideoFaceRepository.name, () => {
  describe('getForDetect', () => {
    it('returns the video with its trim and live faces, with embedding, frame and pet flag', async () => {
      const { ctx, asset, sut } = await setup();
      await defaultDatabase
        .insertInto('asset_video_trim')
        .values({ assetId: asset.id, startTime: 2, endTime: 9, duration: 7 })
        .execute();
      const faceId = newUuid();
      const embedding = newEmbedding();
      await sut.apply({
        insert: [{ id: faceId, assetId: asset.id, ...box }],
        update: [],
        deleteIds: [],
        embeddings: [{ faceId, embedding }],
        frames: [frame(faceId)],
      });
      await ctx.newAssetFace({ assetId: asset.id, deletedAt: new Date() });

      const found = await sut.getForDetect(asset.id);

      expect(found).toMatchObject({ id: asset.id, type: AssetType.Video, trimStart: 2, trimEnd: 9 });
      expect(found?.faces).toEqual([
        expect.objectContaining({
          id: faceId,
          boundingBoxX1: 100,
          imageWidth: 1920,
          framePath: frame(faceId).path,
          isPet: false,
          embedding: expect.any(String),
        }),
      ]);
    });

    it('returns a video never sampled with no trim and its single-frame faces', async () => {
      const { ctx, asset, sut } = await setup();
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id });

      const found = await sut.getForDetect(asset.id);

      expect(found).toMatchObject({ trimStart: null, trimEnd: null });
      expect(found?.faces).toEqual([expect.objectContaining({ id: assetFace.id, framePath: null, embedding: null })]);
    });

    it('returns nothing for a trashed or missing video', async () => {
      const { ctx, user, sut } = await setup();
      const { asset } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video, deletedAt: new Date() });

      await expect(sut.getForDetect(asset.id)).resolves.toBeUndefined();
      await expect(sut.getForDetect(newUuid())).resolves.toBeUndefined();
    });
  });

  describe('apply', () => {
    it('inserts faces with their embedding and best frame', async () => {
      const { asset, sut } = await setup();
      const faceId = newUuid();

      await sut.apply({
        insert: [{ id: faceId, assetId: asset.id, ...box }],
        update: [],
        deleteIds: [],
        embeddings: [{ faceId, embedding: newEmbedding() }],
        frames: [frame(faceId)],
      });

      const [face] = await facesOf(asset.id);
      expect(face).toMatchObject({ id: faceId, timeSeconds: 3.25, path: frame(faceId).path });
      expect(face.embedding).not.toBeNull();
      const row = await defaultDatabase
        .selectFrom('asset_face_video_frame')
        .select(['sightings', 'version'])
        .where('faceId', '=', faceId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ sightings: frame(faceId).sightings, version: 2 });
    });

    it('moves a kept face to its new frame, replaces its embedding, and deletes the faces that went', async () => {
      const { asset, sut } = await setup();
      const kept = newUuid();
      const gone = newUuid();
      const first = newEmbedding();
      await sut.apply({
        insert: [
          { id: kept, assetId: asset.id, ...box },
          { id: gone, assetId: asset.id, ...box, boundingBoxX1: 900, boundingBoxX2: 960 },
        ],
        update: [],
        deleteIds: [],
        embeddings: [
          { faceId: kept, embedding: first },
          { faceId: gone, embedding: newEmbedding() },
        ],
        frames: [frame(kept), frame(gone)],
      });

      await sut.apply({
        insert: [],
        update: [{ id: kept, ...box, boundingBoxX1: 120, boundingBoxX2: 180 }],
        deleteIds: [gone],
        embeddings: [{ faceId: kept, embedding: newEmbedding() }],
        frames: [frame(kept, { timeSeconds: 7.5, path: 'thumbs/owner/aa/bb/asset_faces/new.jpeg', version: 3 })],
      });

      const faces = await facesOf(asset.id);
      expect(faces).toEqual([
        expect.objectContaining({
          id: kept,
          boundingBoxX1: 120,
          timeSeconds: 7.5,
          path: 'thumbs/owner/aa/bb/asset_faces/new.jpeg',
        }),
      ]);
      expect(faces[0].embedding).not.toEqual(first);
      // The frame row went with its face.
      const frames = await defaultDatabase
        .selectFrom('asset_face_video_frame')
        .select('faceId')
        .where('faceId', '=', gone)
        .execute();
      expect(frames).toEqual([]);
    });

    it('writes nothing when any part fails, so a video never shows half of a re-scan', async () => {
      const { asset, sut } = await setup();
      const faceId = newUuid();

      await expect(
        sut.apply({
          insert: [{ id: faceId, assetId: asset.id, ...box }],
          update: [],
          deleteIds: [],
          embeddings: [],
          // A frame for a face that does not exist breaks the foreign key.
          frames: [frame(faceId), frame(newUuid())],
        }),
      ).rejects.toThrow();

      await expect(facesOf(asset.id)).resolves.toEqual([]);
    });
  });

  describe('frame lookups', () => {
    it('finds a face’s frame, and a person’s through their representative face', async () => {
      const { ctx, user, asset, sut } = await setup();
      const faceId = newUuid();
      await sut.apply({
        insert: [{ id: faceId, assetId: asset.id, ...box }],
        update: [],
        deleteIds: [],
        embeddings: [],
        frames: [frame(faceId)],
      });
      const { person } = await ctx.newPerson({ ownerId: user.id, faceAssetId: faceId });
      const { person: other } = await ctx.newPerson({ ownerId: user.id });

      await expect(sut.getFramePath(faceId)).resolves.toBe(frame(faceId).path);
      await expect(sut.getFramePath(newUuid())).resolves.toBeUndefined();
      await expect(
        sut.getRepresentativeFramePath({ ownerId: user.id, personGroupId: person.personGroupId! }),
      ).resolves.toBe(frame(faceId).path);
      await expect(
        sut.getRepresentativeFramePath({ ownerId: user.id, personGroupId: other.personGroupId! }),
      ).resolves.toBeUndefined();
      await expect(sut.getPeopleRepresentedBy([faceId, newUuid()])).resolves.toEqual([
        { ownerId: user.id, personGroupId: person.personGroupId },
      ]);
      await expect(sut.getPathsByPaths([frame(faceId).path, 'thumbs/other.jpeg'])).resolves.toEqual([
        { path: frame(faceId).path },
      ]);
    });
  });

  describe('getSightings', () => {
    it("returns a face's sightings with the video's current trim and original", async () => {
      const { asset, sut } = await setup();
      const faceId = newUuid();
      const sightings = [
        { t: 3.25, x1: 100, y1: 200, x2: 160, y2: 270, score: 0.81 },
        { t: 7.5, x1: 300, y1: 200, x2: 360, y2: 270, score: 0.6 },
      ];
      await sut.apply({
        insert: [{ id: faceId, assetId: asset.id, ...box }],
        update: [],
        deleteIds: [],
        embeddings: [],
        frames: [frame(faceId, { sightings })],
      });

      await expect(sut.getSightings(faceId)).resolves.toEqual({
        sightings,
        timeSeconds: 3.25,
        framePath: `thumbs/owner/aa/bb/asset_faces/${faceId}.jpeg`,
        assetId: asset.id,
        imageWidth: 1920,
        imageHeight: 1080,
        originalPath: asset.originalPath,
        trimStart: null,
        trimEnd: null,
      });

      await defaultDatabase
        .insertInto('asset_video_trim')
        .values({ assetId: asset.id, startTime: 2, endTime: 9, duration: 7 })
        .execute();
      await expect(sut.getSightings(faceId)).resolves.toMatchObject({ trimStart: 2, trimEnd: 9 });
    });

    it('returns nothing for a face without a frame, an unknown face, or one on a trashed video', async () => {
      const { ctx, user, asset, sut } = await setup();
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id });
      const { asset: trashed } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video, deletedAt: new Date() });
      const trashedFaceId = newUuid();
      await sut.apply({
        insert: [{ id: trashedFaceId, assetId: trashed.id, ...box }],
        update: [],
        deleteIds: [],
        embeddings: [],
        frames: [frame(trashedFaceId)],
      });

      await expect(sut.getSightings(assetFace.id)).resolves.toBeUndefined();
      await expect(sut.getSightings(newUuid())).resolves.toBeUndefined();
      await expect(sut.getSightings(trashedFaceId)).resolves.toBeUndefined();
    });
  });

  describe('setSightings', () => {
    it("writes the sightings, and with a new best view moves the face's box and best time in one go", async () => {
      const { asset, sut } = await setup();
      const faceId = newUuid();
      const kept = { t: 3.25, x1: 100, y1: 200, x2: 160, y2: 270, score: 0.81 };
      const next = { t: 7.5, x1: 300, y1: 220, x2: 360, y2: 290, score: 0.6 };
      await sut.apply({
        insert: [{ id: faceId, assetId: asset.id, ...box }],
        update: [],
        deleteIds: [],
        embeddings: [],
        frames: [frame(faceId, { sightings: [kept, next] })],
      });

      await sut.setSightings(faceId, [{ ...kept, removed: true }, next]);
      await expect(sut.getSightings(faceId)).resolves.toMatchObject({
        sightings: [{ ...kept, removed: true }, next],
        timeSeconds: 3.25,
      });

      await sut.setSightings(faceId, [{ ...kept, removed: true, wasBest: true }, next], {
        timeSeconds: 7.5,
        box: { boundingBoxX1: 300, boundingBoxY1: 220, boundingBoxX2: 360, boundingBoxY2: 290 },
      });
      await expect(sut.getSightings(faceId)).resolves.toMatchObject({ timeSeconds: 7.5 });
      const face = await defaultDatabase
        .selectFrom('asset_face')
        .select(['boundingBoxX1', 'boundingBoxY1', 'boundingBoxX2', 'boundingBoxY2', 'imageWidth'])
        .where('id', '=', faceId)
        .executeTakeFirstOrThrow();
      expect(face).toEqual({
        boundingBoxX1: 300,
        boundingBoxY1: 220,
        boundingBoxX2: 360,
        boundingBoxY2: 290,
        imageWidth: 1920,
      });
    });
  });

  describe('splitSighting', () => {
    it('moves a sighting into a new unassigned face made by hand, with its frame and embedding', async () => {
      const { asset, sut } = await setup();
      const faceId = newUuid();
      const newFaceId = newUuid();
      const kept = { t: 3.25, x1: 100, y1: 200, x2: 160, y2: 270, score: 0.81 };
      const moved = { t: 7.5, x1: 300, y1: 220, x2: 360, y2: 290, score: 0.6 };
      await sut.apply({
        insert: [{ id: faceId, assetId: asset.id, ...box }],
        update: [],
        deleteIds: [],
        embeddings: [],
        frames: [frame(faceId, { sightings: [kept, moved] })],
      });

      await sut.splitSighting({
        faceId,
        sightings: [kept, { ...moved, removed: true }],
        face: {
          id: newFaceId,
          assetId: asset.id,
          imageWidth: 1920,
          imageHeight: 1080,
          boundingBoxX1: 300,
          boundingBoxY1: 220,
          boundingBoxX2: 360,
          boundingBoxY2: 290,
        },
        frame: frame(newFaceId, { timeSeconds: 7.5, quality: 0, sightings: [moved] }),
        embedding: `[${Array.from({ length: 512 }, () => 0.01).join(',')}]`,
      });

      await expect(sut.getSightings(faceId)).resolves.toMatchObject({ sightings: [kept, { ...moved, removed: true }] });
      await expect(sut.getSightings(newFaceId)).resolves.toMatchObject({ sightings: [moved], timeSeconds: 7.5 });
      const face = await defaultDatabase
        .selectFrom('asset_face')
        .leftJoin('face_search', 'face_search.faceId', 'asset_face.id')
        .select([
          'asset_face.sourceType',
          'asset_face.personGroupId',
          'asset_face.boundingBoxX1',
          'face_search.faceId as searchFaceId',
        ])
        .where('asset_face.id', '=', newFaceId)
        .executeTakeFirstOrThrow();
      expect(face).toEqual({ sourceType: 'manual', personGroupId: null, boundingBoxX1: 300, searchFaceId: newFaceId });
    });
  });

  describe('moveSightings', () => {
    it('writes both faces, repoints a person shown by a deleted face, and deletes it with its frame row', async () => {
      const { ctx, user, asset, sut } = await setup();
      const kept = newUuid();
      const gone = newUuid();
      const a = { t: 3.25, x1: 100, y1: 200, x2: 160, y2: 270, score: 0.81 };
      const b = { t: 7.5, x1: 300, y1: 220, x2: 360, y2: 290, score: 0.6 };
      await sut.apply({
        insert: [
          { id: kept, assetId: asset.id, ...box },
          { id: gone, assetId: asset.id, ...box, boundingBoxX1: 300, boundingBoxX2: 360 },
        ],
        update: [],
        deleteIds: [],
        embeddings: [],
        frames: [frame(kept, { sightings: [a] }), frame(gone, { timeSeconds: 7.5, sightings: [b] })],
      });
      const { person } = await ctx.newPerson({ ownerId: user.id, faceAssetId: gone });

      const repointed = await sut.moveSightings({
        faces: [{ faceId: kept, sightings: [a, b] }],
        faceId: kept,
        deleteFaceIds: [gone],
      });

      expect(repointed).toEqual([{ ownerId: user.id, personGroupId: person.personGroupId }]);
      await expect(sut.getSightings(kept)).resolves.toMatchObject({ sightings: [a, b] });
      await expect(sut.getSightings(gone)).resolves.toBeUndefined();
      const cover = await defaultDatabase
        .selectFrom('person')
        .select('faceAssetId')
        .where('ownerId', '=', user.id)
        .where('personGroupId', '=', person.personGroupId)
        .executeTakeFirstOrThrow();
      expect(cover.faceAssetId).toBe(kept);
      const left = await defaultDatabase.selectFrom('asset_face').select('id').where('id', '=', gone).execute();
      expect(left).toEqual([]);
    });
  });

  describe('storage migration', () => {
    it('streams, counts and re-points best frames with the person thumbnails', async () => {
      const { asset, sut } = await setup();
      const migration = new StorageMigrationRepository(defaultDatabase);
      const onDisk = newUuid();
      const onS3 = newUuid();
      const diskPath = `/data/thumbs/owner/aa/bb/${asset.id}_faces/${onDisk}.jpeg`;
      const before = await migration.getFileCounts('toS3');
      await sut.apply({
        insert: [
          { id: onDisk, assetId: asset.id, ...box },
          { id: onS3, assetId: asset.id, ...box, boundingBoxX1: 300, boundingBoxX2: 360 },
        ],
        update: [],
        deleteIds: [],
        embeddings: [],
        frames: [frame(onDisk, { path: diskPath }), frame(onS3)],
      });

      const toS3: string[] = [];
      for await (const row of migration.streamVideoFaceFrames('toS3')) {
        toS3.push(row.faceId);
      }
      expect(toS3).toContain(onDisk);
      expect(toS3).not.toContain(onS3);
      await expect(migration.getFileCounts('toS3')).resolves.toMatchObject({
        personThumbnails: before.personThumbnails + 1,
      });

      await expect(migration.updateVideoFaceFramePath(onDisk, '/elsewhere.jpeg', 'moved.jpeg')).resolves.toBe(false);
      await expect(migration.updateVideoFaceFramePath(onDisk, diskPath, 'moved.jpeg')).resolves.toBe(true);
      await expect(sut.getFramePath(onDisk)).resolves.toBe('moved.jpeg');
    });
  });

  describe('streamUnsampled', () => {
    it('lists visible videos face detection has been through but this sampler has not, until marked sampled', async () => {
      const { ctx, user, asset, sut } = await setup();
      await ctx.newJobStatus({ assetId: asset.id });
      const { asset: photo } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Image });
      await ctx.newJobStatus({ assetId: photo.id });
      const { asset: hidden } = await ctx.newAsset({
        ownerId: user.id,
        type: AssetType.Video,
        visibility: AssetVisibility.Hidden,
      });
      await ctx.newJobStatus({ assetId: hidden.id });
      const { asset: trashed } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video, deletedAt: new Date() });
      await ctx.newJobStatus({ assetId: trashed.id });
      // Not through face detection yet: its first run samples it anyway.
      const { asset: fresh } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });

      const before = await unsampled(sut);
      expect(before).toContain(asset.id);
      expect(before).not.toContain(photo.id);
      expect(before).not.toContain(hidden.id);
      expect(before).not.toContain(trashed.id);
      expect(before).not.toContain(fresh.id);

      await sut.markSampled(asset.id);
      await sut.markSampled(asset.id);

      await expect(unsampled(sut)).resolves.not.toContain(asset.id);
    });

    it('lists a sampled video again while any of its faces comes from an older sampler (issue 1306)', async () => {
      const { ctx, asset, sut } = await setup();
      await ctx.newJobStatus({ assetId: asset.id });
      const faceId = newUuid();
      await sut.apply({
        insert: [{ id: faceId, assetId: asset.id, ...box }],
        update: [],
        deleteIds: [],
        embeddings: [{ faceId, embedding: newEmbedding() }],
        frames: [frame(faceId, { version: VIDEO_FACE_SAMPLER_VERSION - 1 })],
      });
      await sut.markSampled(asset.id);

      await expect(unsampled(sut)).resolves.toContain(asset.id);

      await sut.apply({
        insert: [],
        update: [{ id: faceId, ...box }],
        deleteIds: [],
        embeddings: [],
        frames: [frame(faceId, { version: VIDEO_FACE_SAMPLER_VERSION })],
      });

      await expect(unsampled(sut)).resolves.not.toContain(asset.id);
    });

    it('keeps the other columns of the gallery job status row when marking a video sampled', async () => {
      const { asset, sut } = await setup();
      const petsDetectedAt = new Date('2026-01-01T00:00:00Z');
      await defaultDatabase
        .insertInto('asset_job_status_gallery')
        .values({ assetId: asset.id, petsDetectedAt })
        .execute();

      await sut.markSampled(asset.id);

      const row = await defaultDatabase
        .selectFrom('asset_job_status_gallery')
        .select(['petsDetectedAt', 'videoFacesSampledAt'])
        .where('assetId', '=', asset.id)
        .executeTakeFirstOrThrow();
      expect(row.petsDetectedAt).toEqual(petsDetectedAt);
      expect(row.videoFacesSampledAt).not.toBeNull();
    });
  });

  describe('isVideoFace', () => {
    it('tells a video face from a photo face', async () => {
      const { ctx, user, asset, sut } = await setup();
      const { asset: photo } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Image });
      const { assetFace: videoFace } = await ctx.newAssetFace({ assetId: asset.id });
      const { assetFace: photoFace } = await ctx.newAssetFace({ assetId: photo.id });

      await expect(sut.isVideoFace(videoFace.id)).resolves.toBe(true);
      await expect(sut.isVideoFace(photoFace.id)).resolves.toBe(false);
      await expect(sut.isVideoFace(newUuid())).resolves.toBe(false);
    });
  });
});
