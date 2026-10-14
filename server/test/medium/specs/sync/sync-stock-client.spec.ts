import { Kysely } from 'kysely';
import { AssetType, SyncEntityType, SyncRequestType } from 'src/enum.js';
import { VideoTrimRepository } from 'src/gallery/repositories/video-trim.repository.js';
import { DB } from 'src/schema/index.js';
import { SyncTestContext } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

// A stock Immich client has no notion of pets, so a Gallery server hides them from any request that carries no
// fork-only sync type. Trims are not edits on the wire: every client gets the trimmed duration of the file it plays.

let defaultDatabase: Kysely<DB>;

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

const embedding = '[' + Array.from({ length: 512 }, (_, index) => (index === 0 ? 1 : 0)).join(',') + ']';

const galleryClient = (type: SyncRequestType) => [type, SyncRequestType.SharedSpacesV1];

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('stock Immich client gating', () => {
  it('should send a trimmed video with its trimmed duration and no edit to stock and Gallery clients alike', async () => {
    const { auth, ctx } = await setup();
    const { asset: video } = await ctx.newAsset({ ownerId: auth.user.id, type: AssetType.Video, duration: 10_000 });
    const videoTrimRepo = ctx.get(VideoTrimRepository);
    await videoTrimRepo.upsert(video.id, 1, 5);
    await videoTrimRepo.setDuration(video.id, 4000);

    for (const types of [
      [SyncRequestType.AssetsV2, SyncRequestType.AssetEditsV1],
      [...galleryClient(SyncRequestType.AssetsV2), SyncRequestType.AssetEditsV1],
    ]) {
      const response = await ctx.syncStream(auth, types);
      expect(response.filter(({ type }) => type === SyncEntityType.AssetEditV1)).toEqual([]);
      expect(response).toContainEqual(
        expect.objectContaining({
          type: SyncEntityType.AssetV2,
          data: expect.objectContaining({ id: video.id, duration: 4000, isEdited: true }),
        }),
      );
    }
  });

  it('should not send pet people or their faces to a stock client, and should send them to a Gallery client', async () => {
    const { auth, ctx } = await setup();
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id });
    const { person: human } = await ctx.newPerson({ ownerId: auth.user.id });
    const { person: pet } = await ctx.newPerson({ ownerId: auth.user.id, type: 'pet', species: 'dog' });
    const { assetFace: humanFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: human.personGroupId });
    const { assetFace: unassignedHumanFace } = await ctx.newAssetFace({ assetId: asset.id });
    const { assetFace: petFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: pet.personGroupId });
    // an individually recognised pet's face before it is assigned to a pet person
    const { assetFace: embeddedPetFace } = await ctx.newAssetFace({ assetId: asset.id });
    await ctx.database.insertInto('pet_search').values({ faceId: embeddedPetFace.id, embedding }).execute();

    const people = (response: Awaited<ReturnType<typeof ctx.syncStream>>) =>
      response.filter(({ type }) => type === SyncEntityType.PersonV1).map(({ data }) => (data as any).id);

    expect(people(await ctx.syncStream(auth, [SyncRequestType.PeopleV1]))).toEqual([human.personGroupId]);
    expect(people(await ctx.syncStream(auth, galleryClient(SyncRequestType.PeopleV1)))).toEqual(
      expect.arrayContaining([human.personGroupId, pet.personGroupId]),
    );

    for (const [requestType, entityType] of [
      [SyncRequestType.AssetFacesV2, SyncEntityType.AssetFaceV2],
      [SyncRequestType.AssetFacesV3, SyncEntityType.AssetFaceV3],
    ] as const) {
      const faces = (response: Awaited<ReturnType<typeof ctx.syncStream>>) =>
        response.filter(({ type }) => type === entityType).map(({ data }) => (data as any).id);

      const stock = faces(await ctx.syncStream(auth, [requestType]));
      expect(stock).toHaveLength(2);
      expect(stock).toEqual(expect.arrayContaining([humanFace.id, unassignedHumanFace.id]));

      const gallery = faces(await ctx.syncStream(auth, galleryClient(requestType)));
      expect(gallery).toHaveLength(4);
      expect(gallery).toEqual(
        expect.arrayContaining([humanFace.id, unassignedHumanFace.id, petFace.id, embeddedPetFace.id]),
      );
    }
  });
});
