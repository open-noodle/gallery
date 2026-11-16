import { Kysely } from 'kysely';
import { AssetType } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { newEmbedding } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [SearchRepository, PersonRepository],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(SearchRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

// Recognition leaves out the other faces of a video face's own video (src/gallery/utils/video-face-search.ts).
describe('SearchRepository.searchFaces excludeOtherFacesOfVideo', () => {
  it('leaves out the other faces of the same video, keeps the face itself, other videos and photos', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset: video } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
    const { asset: otherVideo } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
    const { asset: photo } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Image });
    const embedding = newEmbedding();
    const faceIn = async (assetId: string) => {
      const { assetFace } = await ctx.newAssetFace({ assetId, personGroupId: null });
      await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding }).execute();
      return assetFace.id;
    };
    const self = await faceIn(video.id);
    const sibling = await faceIn(video.id);
    const elsewhere = await faceIn(otherVideo.id);
    const inPhoto = await faceIn(photo.id);

    const search = (excludeOtherFacesOfVideo?: string) =>
      sut
        .searchFaces({
          clusterGroupId: user.clusterGroupId,
          embedding,
          numResults: 10,
          maxDistance: 2,
          excludeOtherFacesOfVideo,
        })
        .then((matches) => matches.map(({ id }) => id).toSorted());

    await expect(search()).resolves.toEqual([self, sibling, elsewhere, inPhoto].toSorted());
    await expect(search(self)).resolves.toEqual([self, elsewhere, inPhoto].toSorted());
  });

  it('leaves out every face of a person that a face seen together with this one already has', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset: video } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
    const { asset: photo } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Image });
    const { person: together } = await ctx.newPerson({ ownerId: user.id });
    const { person: apart } = await ctx.newPerson({ ownerId: user.id });
    const { person: unrelated } = await ctx.newPerson({ ownerId: user.id });
    const embedding = newEmbedding();
    const faceIn = async (assetId: string, personGroupId: string | null, sightingTimes?: number[]) => {
      const { assetFace } = await ctx.newAssetFace({ assetId, personGroupId });
      await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding }).execute();
      if (sightingTimes) {
        await ctx.database
          .insertInto('asset_face_video_frame')
          .values({
            faceId: assetFace.id,
            path: `thumbs/${assetFace.id}.jpeg`,
            timeSeconds: sightingTimes[0],
            quality: 0.5,
            sightings: sightingTimes.map((t) => ({ t, x1: 0, y1: 0, x2: 10, y2: 10, score: 0.8 })),
            version: 3,
          })
          .execute();
      }
      return assetFace.id;
    };
    const self = await faceIn(video.id, null, [1, 2, 3]);
    // In the same video: one face shares the frame at 2 s with it, one is only ever on screen at other times.
    await faceIn(video.id, together.personGroupId, [2, 4]);
    await faceIn(video.id, apart.personGroupId, [5, 6]);
    const togetherElsewhere = await faceIn(photo.id, together.personGroupId);
    const apartElsewhere = await faceIn(photo.id, apart.personGroupId);
    const unrelatedElsewhere = await faceIn(photo.id, unrelated.personGroupId);
    const unassigned = await faceIn(photo.id, null);

    const matches = await sut.searchFaces({
      clusterGroupId: user.clusterGroupId,
      embedding,
      numResults: 10,
      maxDistance: 2,
      excludeOtherFacesOfVideo: self,
    });

    expect(matches.map(({ id }) => id).toSorted()).toEqual(
      [self, apartElsewhere, unrelatedElsewhere, unassigned].toSorted(),
    );
    expect(matches.map(({ id }) => id)).not.toContain(togetherElsewhere);
  });

  it('changes nothing for a photo face, whose other faces upstream already counts', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset: photo } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Image });
    const embedding = newEmbedding();
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { assetFace } = await ctx.newAssetFace({ assetId: photo.id, personGroupId: null });
      await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding }).execute();
      ids.push(assetFace.id);
    }

    const matches = await sut.searchFaces({
      clusterGroupId: user.clusterGroupId,
      embedding,
      numResults: 10,
      maxDistance: 2,
      excludeOtherFacesOfVideo: ids[0],
    });

    expect(matches.map(({ id }) => id).toSorted()).toEqual(ids.toSorted());
  });
});
