import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MapRepository } from 'src/repositories/map.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(MapRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(MapRepository.name, () => {
  describe('getMapMarkers', () => {
    it('should include a direct shared_space_asset for a member with showInTimeline=true', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id });
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      await ctx.database
        .insertInto('asset_exif')
        .values({ assetId: asset.id, latitude: 48.8566, longitude: 2.3522, city: 'Paris', state: null, country: 'France' })
        .execute();
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

      const results = await sut.getMapMarkers([member.id], [], { timelineSpaceIds: [space.id] });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ id: asset.id, lat: 48.8566, lon: 2.3522 });
    });

    it('should include a library-linked asset via shared_space_library for a member', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id });
      const { library } = await ctx.newLibrary({ ownerId: owner.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
      const { asset } = await ctx.newAsset({
        ownerId: owner.id,
        libraryId: library.id,
        visibility: AssetVisibility.Timeline,
      });
      await ctx.database
        .insertInto('asset_exif')
        .values({ assetId: asset.id, latitude: 40.7128, longitude: -74.006 })
        .execute();

      const results = await sut.getMapMarkers([member.id], [], { timelineSpaceIds: [space.id] });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(asset.id);
    });
  });
});
