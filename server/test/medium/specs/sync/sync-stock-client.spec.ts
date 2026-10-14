import { Kysely } from 'kysely';
import { AssetEditAction } from 'src/dtos/editing.dto.js';
import { AssetType, SyncEntityType, SyncRequestType } from 'src/enum.js';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository.js';
import { DB } from 'src/schema/index.js';
import { SyncTestContext } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

// A stock Immich client cannot decode a `trim` edit, and has no notion of pets, so a Gallery server
// hides both from any request that carries no fork-only sync type.

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
  it('should not send a trim edit to a stock client, and should send it to a Gallery client', async () => {
    const { auth, ctx } = await setup();
    const { asset: video } = await ctx.newAsset({ ownerId: auth.user.id, type: AssetType.Video });
    const { asset: image } = await ctx.newAsset({ ownerId: auth.user.id });
    const assetEditRepo = ctx.get(AssetEditRepository);
    await assetEditRepo.replaceAll(video.id, [
      { action: AssetEditAction.Trim, parameters: { startTime: 1, endTime: 2, originalDuration: 10 } as any },
    ]);
    await assetEditRepo.replaceAll(image.id, [
      { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 10, height: 10 } },
    ]);

    const stock = await ctx.syncStream(auth, [SyncRequestType.AssetEditsV1]);
    expect(stock).toEqual([
      expect.objectContaining({
        type: SyncEntityType.AssetEditV1,
        data: expect.objectContaining({ assetId: image.id }),
      }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    const gallery = await ctx.syncStream(auth, galleryClient(SyncRequestType.AssetEditsV1));
    expect(gallery.filter(({ type }) => type === SyncEntityType.AssetEditV1).map(({ data }) => data)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assetId: video.id, action: AssetEditAction.Trim }),
        expect.objectContaining({ assetId: image.id, action: AssetEditAction.Crop }),
      ]),
    );
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
