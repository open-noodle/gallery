// Video pets sampled across the whole video (specs/2026-11-16-video-pet-detection-design.md): the PetFaceRepository
// reads and writes behind VideoPetDetector, and the face side's handling of pet frame rows.
import { Kysely } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { AssetType, AssetVisibility, SourceType } from 'src/enum.js';
import { PetFaceRepository, type VideoPetChanges } from 'src/gallery/repositories/pet-face.repository.js';
import { VideoFaceRepository } from 'src/gallery/repositories/video-face.repository.js';
import { VIDEO_FACE_SAMPLER_VERSION } from 'src/gallery/utils/video-faces.js';
import { VIDEO_PET_SAMPLER_VERSION } from 'src/gallery/utils/video-pets.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { newEmbedding, newUuid } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let db: Kysely<DB>;

const box = {
  imageWidth: 1920,
  imageHeight: 1080,
  boundingBoxX1: 400,
  boundingBoxY1: 200,
  boundingBoxX2: 700,
  boundingBoxY2: 500,
};

const frame = (faceId: string, overrides: Record<string, unknown> = {}) => ({
  faceId,
  path: `thumbs/owner/aa/bb/asset_faces/${faceId}.jpeg`,
  timeSeconds: 3.5,
  quality: 0.6,
  sightings: [{ t: 3.5, x1: 400, y1: 200, x2: 700, y2: 500, score: 0.9 }],
  version: VIDEO_PET_SAMPLER_VERSION,
  ...overrides,
});

const changes = (overrides: Partial<VideoPetChanges>): VideoPetChanges => ({
  insert: [],
  update: [],
  deleteIds: [],
  embeddings: [],
  frames: [],
  ...overrides,
});

const setup = async () => {
  const { ctx } = newMediumService(BaseService, { database: db, real: [], mock: [LoggingRepository] });
  const { user } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
  return { ctx, user, asset, sut: ctx.get(PetFaceRepository), videoFaces: ctx.get(VideoFaceRepository) };
};

/** An embedded dog sampled from the video, written the way VideoPetDetector writes one. */
const addSampledDog = async (sut: PetFaceRepository, assetId: string, version = VIDEO_PET_SAMPLER_VERSION) => {
  const faceId = newUuid();
  await sut.applyVideoPets(
    changes({
      insert: [{ id: faceId, assetId, ...box }],
      embeddings: [{ faceId, embedding: newEmbedding(), species: 'dog' }],
      frames: [frame(faceId, { version })],
    }),
  );
  return faceId;
};

/** The ids a stream yields. */
const idsOf = async (stream: AsyncIterable<{ id: string }>) => {
  const rows = await Array.fromAsync(stream);
  return rows.map(({ id }) => id);
};

beforeAll(async () => {
  db = await getKyselyDB();
});

describe('PetFaceRepository (video pets)', () => {
  describe('getForVideoPetDetect', () => {
    it("returns the video with its trim and only this job's pet faces: embedded, bucketed and poster", async () => {
      const { ctx, user, asset, sut } = await setup();
      await db
        .insertInto('asset_video_trim')
        .values({ assetId: asset.id, startTime: 1, endTime: 8, duration: 7 })
        .execute();
      const dogFace = await addSampledDog(sut, asset.id);
      const { person: birds } = await ctx.newPerson({ ownerId: user.id, name: 'bird', type: 'pet', species: 'bird' });
      const { assetFace: birdFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: birds.personGroupId });
      // Not this job's: a person's face, a manual pet face, a trashed pet face.
      const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: alice.personGroupId });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: birds.personGroupId, sourceType: SourceType.Manual });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: birds.personGroupId, deletedAt: new Date() });

      const found = await sut.getForVideoPetDetect(asset.id);

      expect(found).toMatchObject({ id: asset.id, ownerId: user.id, type: AssetType.Video, trimStart: 1, trimEnd: 8 });
      expect(found?.faces).toHaveLength(2);
      expect(found?.faces).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: dogFace,
            species: 'dog',
            embedded: true,
            embedding: expect.any(String),
            framePath: frame(dogFace).path,
            boundingBoxX1: 400,
          }),
          expect.objectContaining({
            id: birdFace.id,
            species: 'bird',
            embedded: false,
            embedding: null,
            framePath: null,
            personGroupId: birds.personGroupId,
          }),
        ]),
      );
    });

    it('returns a photo without faces, and nothing for a trashed or missing asset', async () => {
      const { ctx, user, sut } = await setup();
      const { asset: photo } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Image });
      const { asset: trashed } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video, deletedAt: new Date() });

      await expect(sut.getForVideoPetDetect(photo.id)).resolves.toMatchObject({ type: AssetType.Image, faces: [] });
      await expect(sut.getForVideoPetDetect(trashed.id)).resolves.toBeUndefined();
      await expect(sut.getForVideoPetDetect(newUuid())).resolves.toBeUndefined();
    });
  });

  describe('applyVideoPets', () => {
    it('moves a kept pet to its new frame, replaces its embedding, and deletes the pets that went', async () => {
      const { asset, sut } = await setup();
      const kept = await addSampledDog(sut, asset.id);
      const gone = await addSampledDog(sut, asset.id);
      const embedding = newEmbedding();

      await sut.applyVideoPets(
        changes({
          update: [{ id: kept, ...box, boundingBoxX1: 900 }],
          deleteIds: [gone],
          embeddings: [{ faceId: kept, embedding, species: 'dog' }],
          frames: [frame(kept, { timeSeconds: 8.5 })],
        }),
      );

      const rows = await db
        .selectFrom('asset_face')
        .innerJoin('asset_face_video_frame', 'asset_face_video_frame.faceId', 'asset_face.id')
        .innerJoin('pet_search', 'pet_search.faceId', 'asset_face.id')
        .select([
          'asset_face.id',
          'asset_face.boundingBoxX1',
          'asset_face_video_frame.timeSeconds',
          'pet_search.species',
        ])
        .where('asset_face.assetId', '=', asset.id)
        .execute();
      expect(rows).toEqual([{ id: kept, boundingBoxX1: 900, timeSeconds: 8.5, species: 'dog' }]);
    });

    it('writes nothing when any part fails, so a video never shows half of a rescan', async () => {
      const { asset, sut } = await setup();
      const faceId = newUuid();

      await expect(
        sut.applyVideoPets(
          changes({
            insert: [{ id: faceId, assetId: asset.id, ...box }],
            frames: [frame(newUuid())],
          }),
        ),
      ).rejects.toThrow();

      await expect(db.selectFrom('asset_face').select('id').where('id', '=', faceId).execute()).resolves.toEqual([]);
    });
  });

  describe('markVideoPetsSampled and streamVideosForPetSampling', () => {
    it('lists visible videos detected from their poster only, until sampled', async () => {
      const { ctx, user, asset, sut } = await setup();
      await sut.setPetsDetectedAt(asset.id);
      const { asset: photo } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Image });
      await sut.setPetsDetectedAt(photo.id);
      const { asset: hidden } = await ctx.newAsset({
        ownerId: user.id,
        type: AssetType.Video,
        visibility: AssetVisibility.Hidden,
      });
      await sut.setPetsDetectedAt(hidden.id);
      // Not detected at all yet: Missing's own query picks it up.
      const { asset: fresh } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });

      const before = await idsOf(sut.streamVideosForPetSampling());
      expect(before).toContain(asset.id);
      expect(before).not.toContain(photo.id);
      expect(before).not.toContain(hidden.id);
      expect(before).not.toContain(fresh.id);

      await sut.markVideoPetsSampled(asset.id);

      const after = await idsOf(sut.streamVideosForPetSampling());
      expect(after).not.toContain(asset.id);
    });

    it('lists a sampled video again while one of its pets comes from an older pet sampler', async () => {
      const { asset, sut } = await setup();
      await addSampledDog(sut, asset.id, VIDEO_PET_SAMPLER_VERSION - 1);
      await sut.markVideoPetsSampled(asset.id);

      const ids = await idsOf(sut.streamVideosForPetSampling());
      expect(ids).toContain(asset.id);
    });

    it('stamps petsDetectedAt with videoPetsSampledAt, keeps the other columns, and ignores a deleted asset', async () => {
      const { asset, sut, videoFaces } = await setup();
      await videoFaces.markSampled(asset.id);

      await sut.markVideoPetsSampled(asset.id);
      await sut.markVideoPetsSampled(newUuid());

      const row = await db
        .selectFrom('asset_job_status_gallery')
        .select(['petsDetectedAt', 'videoPetsSampledAt', 'videoFacesSampledAt'])
        .where('assetId', '=', asset.id)
        .executeTakeFirstOrThrow();
      expect(row.petsDetectedAt).not.toBeNull();
      expect(row.videoPetsSampledAt).not.toBeNull();
      expect(row.videoFacesSampledAt).not.toBeNull();
    });
  });

  describe('getPetFramePaths', () => {
    it("lists every pet's frame, or only embedded pets' frames, never a person's", async () => {
      const { ctx, user, asset, sut, videoFaces } = await setup();
      const dogFace = await addSampledDog(sut, asset.id);
      const { person: birds } = await ctx.newPerson({ ownerId: user.id, name: 'bird', type: 'pet', species: 'bird' });
      const birdFace = newUuid();
      await sut.applyVideoPets(
        changes({
          insert: [{ id: birdFace, assetId: asset.id, personGroupId: birds.personGroupId, ...box }],
          frames: [frame(birdFace)],
        }),
      );
      const personFace = newUuid();
      await videoFaces.apply({
        insert: [{ id: personFace, assetId: asset.id, ...box }],
        update: [],
        deleteIds: [],
        embeddings: [{ faceId: personFace, embedding: newEmbedding() }],
        frames: [frame(personFace, { version: VIDEO_FACE_SAMPLER_VERSION })],
      });

      const all = await sut.getPetFramePaths({ embeddedOnly: false });
      expect(all).toEqual(expect.arrayContaining([frame(dogFace).path, frame(birdFace).path]));
      expect(all).not.toContain(frame(personFace).path);

      const embedded = await sut.getPetFramePaths({ embeddedOnly: true });
      expect(embedded).toContain(frame(dogFace).path);
      expect(embedded).not.toContain(frame(birdFace).path);
      expect(embedded).not.toContain(frame(personFace).path);
    });
  });
});

describe('VideoFaceRepository with video pets', () => {
  it("face detection's Missing does not rescan a video because of a pet's frame version", async () => {
    const { ctx, asset, sut, videoFaces } = await setup();
    await ctx.newJobStatus({ assetId: asset.id });
    await videoFaces.markSampled(asset.id);
    // The pet sampler's version series is lower than the face sampler's.
    await addSampledDog(sut, asset.id, 1);

    const ids = await idsOf(videoFaces.streamUnsampled());
    expect(ids).not.toContain(asset.id);
  });

  it("reports a sampled pet's species on its sightings, and a person's face as no pet", async () => {
    const { asset, sut, videoFaces } = await setup();
    const dogFace = await addSampledDog(sut, asset.id);
    const personFace = newUuid();
    await videoFaces.apply({
      insert: [{ id: personFace, assetId: asset.id, ...box }],
      update: [],
      deleteIds: [],
      embeddings: [{ faceId: personFace, embedding: newEmbedding() }],
      frames: [frame(personFace, { version: VIDEO_FACE_SAMPLER_VERSION })],
    });

    await expect(videoFaces.getSightings(dogFace)).resolves.toMatchObject({ isPet: true, petSpecies: 'dog' });
    await expect(videoFaces.getSightings(personFace)).resolves.toMatchObject({ isPet: false, petSpecies: null });
  });

  it('splits a pet sighting into a new face with a pet embedding', async () => {
    const { asset, videoFaces } = await setup();
    const source = newUuid();
    await videoFaces.apply({
      insert: [{ id: source, assetId: asset.id, ...box }],
      update: [],
      deleteIds: [],
      embeddings: [],
      frames: [frame(source)],
    });
    const faceId = newUuid();

    await videoFaces.splitSighting({
      faceId: source,
      sightings: [],
      face: { id: faceId, assetId: asset.id, ...box },
      frame: frame(faceId),
      petEmbedding: { embedding: newEmbedding(), species: 'cat' },
    });

    await expect(
      db.selectFrom('pet_search').select('species').where('faceId', '=', faceId).executeTakeFirst(),
    ).resolves.toEqual({ species: 'cat' });
    await expect(
      db.selectFrom('face_search').select('faceId').where('faceId', '=', faceId).executeTakeFirst(),
    ).resolves.toBeUndefined();
  });
});
