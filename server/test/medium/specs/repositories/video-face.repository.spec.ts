import { Kysely } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { AssetType, AssetVisibility } from 'src/enum.js';
import { VideoFaceRepository } from 'src/gallery/repositories/video-face.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
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
});
