import { Kysely } from 'kysely';
import { SearchSuggestionType } from 'src/dtos/search.dto';
import { AlbumUserRole, AssetOrder, AssetVisibility, SearchOrderField } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PartnerRepository } from 'src/repositories/partner.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { SearchService } from 'src/services/search.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const unitVector = (index: number) => JSON.stringify(Array.from({ length: 512 }, (_, i) => (i === index ? 1 : 0)));

const setup = (db?: Kysely<DB>) => {
  return newMediumService(SearchService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AssetRepository,
      DatabaseRepository,
      SearchRepository,
      SharedSpaceRepository,
      PartnerRepository,
      PersonRepository,
    ],
    mock: [LoggingRepository],
  });
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(SearchService.name, () => {
  it('should work', () => {
    const { sut } = setup();
    expect(sut).toBeDefined();
  });

  it('should return assets', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();

    const assets = [];
    const sizes = [12_334, 599, 123_456];

    for (let i = 0; i < sizes.length; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, fileSizeInByte: sizes[i] });
      assets.push(asset);
    }

    const auth = factory.auth({ user: { id: user.id } });

    await expect(sut.searchLargeAssets(auth, { size: 250 })).resolves.toEqual([
      expect.objectContaining({ id: assets[2].id }),
      expect.objectContaining({ id: assets[0].id }),
      expect.objectContaining({ id: assets[1].id }),
    ]);
  });

  describe('searchStatistics', () => {
    it('should return statistics when filtering by personIds', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { person } = await ctx.newPerson({ ownerId: user.id });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });

      const auth = factory.auth({ user: { id: user.id } });

      const result = await sut.searchStatistics(auth, { personIds: [person.personGroupId] });

      expect(result).toEqual({ total: 1 });
    });

    it('should return zero when no assets match the personIds filter', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });

      const auth = factory.auth({ user: { id: user.id } });

      const result = await sut.searchStatistics(auth, { personIds: [person.personGroupId] });

      expect(result).toEqual({ total: 0 });
    });

    it('should not return locked assets of partner in elevated session', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: partner } = await ctx.newUser();

      await ctx.newPartner({ sharedById: partner.id, sharedWithId: user.id });

      await ctx.newAsset({ ownerId: partner.id, visibility: AssetVisibility.Locked });

      const auth = factory.auth({ user: { id: user.id }, session: { hasElevatedPermission: true } });

      const result = await sut.searchStatistics(auth, { visibility: AssetVisibility.Locked });

      expect(result).toEqual({ total: 0 });
    });
  });

  describe('library-linked space assets', () => {
    it('should include library-linked assets in searchMetadata when filtering by spaceId', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      // Create a library and an asset belonging to that library
      const { library } = await ctx.newLibrary({ ownerId: owner.id });
      const { asset: libraryAsset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });

      // Create a space, add member, link the library
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

      const auth = factory.auth({ user: { id: member.id } });

      const result = await sut.searchMetadata(auth, { spaceId: space.id });

      expect(result.assets.items).toEqual([expect.objectContaining({ id: libraryAsset.id })]);
    });

    it('should include library-linked assets in searchLargeAssets when filtering by spaceId', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      const { library } = await ctx.newLibrary({ ownerId: owner.id });
      const { asset: libraryAsset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
      await ctx.newExif({ assetId: libraryAsset.id, fileSizeInByte: 999_999 });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

      const auth = factory.auth({ user: { id: member.id } });

      const result = await sut.searchLargeAssets(auth, { spaceId: space.id });

      expect(result).toEqual([expect.objectContaining({ id: libraryAsset.id })]);
    });

    it('should include library-linked assets in getSearchSuggestions for countries', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      const { library } = await ctx.newLibrary({ ownerId: owner.id });
      const { asset: libraryAsset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
      await ctx.newExif({ assetId: libraryAsset.id, country: 'Germany' });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

      const auth = factory.auth({ user: { id: member.id } });

      const result = await sut.getSearchSuggestions(auth, {
        type: SearchSuggestionType.COUNTRY,
        spaceId: space.id,
        includeNull: false,
      });

      expect(result).toContain('Germany');
    });

    it('should include library-linked assets in getSearchSuggestions for cities', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      const { library } = await ctx.newLibrary({ ownerId: owner.id });
      const { asset: libraryAsset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
      await ctx.newExif({ assetId: libraryAsset.id, city: 'Berlin', country: 'Germany' });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

      const auth = factory.auth({ user: { id: member.id } });

      const result = await sut.getSearchSuggestions(auth, {
        type: SearchSuggestionType.CITY,
        spaceId: space.id,
        includeNull: false,
      });

      expect(result).toContain('Berlin');
    });

    it('should include library-linked assets in getSearchSuggestions for camera makes', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      const { library } = await ctx.newLibrary({ ownerId: owner.id });
      const { asset: libraryAsset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
      await ctx.newExif({ assetId: libraryAsset.id, make: 'Sony' });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

      const auth = factory.auth({ user: { id: member.id } });

      const result = await sut.getSearchSuggestions(auth, {
        type: SearchSuggestionType.CAMERA_MAKE,
        spaceId: space.id,
        includeNull: false,
      });

      expect(result).toContain('Sony');
    });
  });

  describe('withStacked option', () => {
    it('should exclude stacked assets when withStacked is false', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset: primaryAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: stackedAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: unstackedAsset } = await ctx.newAsset({ ownerId: user.id });

      await ctx.newStack({ ownerId: user.id }, [primaryAsset.id, stackedAsset.id]);

      const auth = factory.auth({ user: { id: user.id } });

      const response = await sut.searchMetadata(auth, { size: 250, withStacked: false });

      expect(response.assets.items.length).toBe(1);
      expect(response.assets.items[0].id).toBe(unstackedAsset.id);
    });

    describe('visibility', () => {
      it('should filter out locked assets in a default session', async () => {
        const { sut, ctx } = setup();
        const { user } = await ctx.newUser();

        await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });

        const auth = factory.auth({ user: { id: user.id } });

        const response = await sut.searchMetadata(auth, { size: 250, withStacked: false });

        expect(response.assets.items.length).toBe(0);
      });

      it('should return locked assets in an elevated session', async () => {
        const { sut, ctx } = setup();
        const { user } = await ctx.newUser();

        await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });

        const auth = factory.auth({ user: { id: user.id }, session: { hasElevatedPermission: true } });

        const response = await sut.searchMetadata(auth, { size: 250, withStacked: false });

        expect(response.assets.items.length).toBe(1);
      });
    });
  });

  describe('albumIds option', () => {
    it('should return assets from shared album', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();

      const { asset } = await ctx.newAsset({ ownerId: otherUser.id });
      const { album } = await ctx.newAlbum({ ownerId: otherUser.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
      await ctx.newAlbumUser({ albumId: album.id, userId: user.id, role: AlbumUserRole.Editor });

      const auth = factory.auth({ user: { id: user.id } });

      const response = await sut.searchMetadata(auth, { size: 250, albumIds: [album.id] });

      expect(response.assets.items.length).toBe(1);
    });

    it('should not return assets for album, a user is not in, when partner sharing is enabled', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();

      await ctx.newPartner({ sharedById: otherUser.id, sharedWithId: user.id });

      const { asset } = await ctx.newAsset({ ownerId: otherUser.id });
      const { album } = await ctx.newAlbum({ ownerId: otherUser.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      const auth = factory.auth({ user: { id: user.id } });

      await expect(sut.searchMetadata(auth, { size: 250, albumIds: [album.id] })).rejects.toThrow(
        'Not found or no album.read access',
      );
    });
  });

  describe('getSearchSuggestions', () => {
    it('should filter out empty search suggestions', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, make: 'Canon' });

      const { asset: assetWithEmptyMake } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: assetWithEmptyMake.id, make: '' });

      const auth = factory.auth({ user: { id: user.id } });
      const suggestions = await sut.getSearchSuggestions(auth, {
        type: SearchSuggestionType.CAMERA_MAKE,
        includeNull: true,
      });

      expect(suggestions).toEqual(['Canon', null]);
    });
  });

  describe('searchRandom', () => {
    it('should filter out locked assets in a default session', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });

      const auth = factory.auth({ user: { id: user.id } });

      const response = await sut.searchRandom(auth, { size: 250 });

      expect(response.length).toBe(0);
    });
  });

  describe('new search shape', () => {
    it('should filter by an exif field and return a cursor-less single page', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, city: 'Oslo' });
      const { asset: other } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: other.id, city: 'Bergen' });

      const auth = factory.auth({ user: { id: user.id } });
      const response = await sut.searchMetadata(auth, { size: 250, filter: { city: { eq: 'Oslo' } } });

      expect(response.assets.items).toEqual([expect.objectContaining({ id: asset.id })]);
      expect(response.assets.nextPage).toBeNull();
      expect(response.assets.nextCursor).toBeNull();
    });

    it('should combine OR branches', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset: oslo } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: oslo.id, city: 'Oslo' });
      const { asset: favorite } = await ctx.newAsset({ ownerId: user.id, isFavorite: true });
      await ctx.newAsset({ ownerId: user.id });

      const auth = factory.auth({ user: { id: user.id } });
      const response = await sut.searchMetadata(auth, {
        size: 250,
        filter: { or: [{ city: { eq: 'Oslo' } }, { isFavorite: { eq: true } }] },
      });

      expect(response.assets.items.map(({ id }) => id).toSorted()).toEqual([oslo.id, favorite.id].toSorted());
    });

    it('should scope a top-level album constraint to the album', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: otherUser.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      const auth = factory.auth({ user: { id: user.id } });
      const response = await sut.searchMetadata(auth, { size: 250, filter: { albumIds: { any: [album.id] } } });

      expect(response.assets.items).toEqual([expect.objectContaining({ id: asset.id })]);
    });

    it('should scope an album-constrained branch to the album', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: otherUser.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      const auth = factory.auth({ user: { id: user.id } });
      const response = await sut.searchMetadata(auth, {
        size: 250,
        filter: { or: [{ albumIds: { any: [album.id] } }] },
      });

      expect(response.assets.items).toEqual([expect.objectContaining({ id: asset.id })]);
    });

    it('should keep the ownership scope for branches without an album constraint', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();
      const { asset: ownOslo } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: ownOslo.id, city: 'Oslo' });
      const { asset: foreignOslo } = await ctx.newAsset({ ownerId: otherUser.id });
      await ctx.newExif({ assetId: foreignOslo.id, city: 'Oslo' });
      const { asset: albumAsset } = await ctx.newAsset({ ownerId: otherUser.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: albumAsset.id });

      const auth = factory.auth({ user: { id: user.id } });
      const response = await sut.searchMetadata(auth, {
        size: 250,
        filter: { or: [{ albumIds: { any: [album.id] } }, { city: { eq: 'Oslo' } }] },
      });

      // the album branch searches the album, the city branch stays confined to the caller's own assets
      expect(response.assets.items.map(({ id }) => id).toSorted()).toEqual([ownOslo.id, albumAsset.id].toSorted());
    });

    it('should reject an inaccessible album anywhere in the filter', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();
      const { album } = await ctx.newAlbum({ ownerId: otherUser.id });

      const auth = factory.auth({ user: { id: user.id } });

      await expect(
        sut.searchMetadata(auth, { size: 250, filter: { or: [{ albumIds: { none: [album.id] } }] } }),
      ).rejects.toThrow('Not found or no album.read access');
    });

    it('should return locked assets only to an elevated session that asks for them', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset: timeline } = await ctx.newAsset({ ownerId: user.id });
      const { asset: locked } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });

      const unelevated = await sut.searchMetadata(factory.auth({ user: { id: user.id } }), { size: 250, filter: {} });
      expect(unelevated.assets.items).toEqual([expect.objectContaining({ id: timeline.id })]);

      const elevatedAuth = factory.auth({ user: { id: user.id }, session: { hasElevatedPermission: true } });
      const elevated = await sut.searchMetadata(elevatedAuth, {
        size: 250,
        filter: { visibility: { eq: AssetVisibility.Locked } },
      });
      expect(elevated.assets.items).toEqual([expect.objectContaining({ id: locked.id })]);
    });

    it('should exclude partner assets from a locked-only search', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: partner } = await ctx.newUser();
      await ctx.newPartner({ sharedById: partner.id, sharedWithId: user.id });
      const { asset: ownLocked } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      await ctx.newAsset({ ownerId: partner.id, visibility: AssetVisibility.Locked });

      const auth = factory.auth({ user: { id: user.id }, session: { hasElevatedPermission: true } });
      const response = await sut.searchMetadata(auth, {
        size: 250,
        filter: { visibility: { eq: AssetVisibility.Locked } },
      });

      expect(response.assets.items).toEqual([expect.objectContaining({ id: ownLocked.id })]);
    });

    it('should never return partner locked assets, even for locked-matching mixed filters', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: partner } = await ctx.newUser();
      await ctx.newPartner({ sharedById: partner.id, sharedWithId: user.id });
      const { asset: ownLocked } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      const { asset: partnerTimeline } = await ctx.newAsset({ ownerId: partner.id });
      await ctx.newAsset({ ownerId: partner.id, visibility: AssetVisibility.Locked });

      const auth = factory.auth({ user: { id: user.id }, session: { hasElevatedPermission: true } });
      const response = await sut.searchMetadata(auth, {
        size: 250,
        filter: { visibility: { in: [AssetVisibility.Locked, AssetVisibility.Timeline] } },
      });

      const ids = response.assets.items.map(({ id }) => id);
      expect(ids.toSorted()).toEqual([ownLocked.id, partnerTimeline.id].toSorted());
    });

    it('should paginate with an opaque cursor', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      for (let i = 0; i < 3; i++) {
        await ctx.newAsset({ ownerId: user.id });
      }

      const auth = factory.auth({ user: { id: user.id } });

      const firstPage = await sut.searchMetadata(auth, { filter: {}, size: 2 });
      expect(firstPage.assets.items.length).toBe(2);
      expect(firstPage.assets.nextPage).toBeNull();
      expect(firstPage.assets.nextCursor).toEqual(expect.any(String));

      const secondPage = await sut.searchMetadata(auth, { cursor: firstPage.assets.nextCursor!, size: 2 });
      expect(secondPage.assets.items.length).toBe(1);
      expect(secondPage.assets.nextCursor).toBeNull();

      const ids = [...firstPage.assets.items, ...secondPage.assets.items].map(({ id }) => id);
      expect(new Set(ids).size).toBe(3);
    });

    it('should order by fileSizeInBytes', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const sizes = [12_334, 599, 123_456];
      const assetIds: string[] = [];
      for (const fileSizeInByte of sizes) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        await ctx.newExif({ assetId: asset.id, fileSizeInByte });
        assetIds.push(asset.id);
      }

      const auth = factory.auth({ user: { id: user.id } });
      const response = await sut.searchMetadata(auth, {
        size: 250,
        orderBy: { field: SearchOrderField.FileSizeInBytes, direction: AssetOrder.Asc },
      });

      expect(response.assets.items.map(({ id }) => id)).toEqual([assetIds[1], assetIds[0], assetIds[2]]);
    });

    it('should order smart search results by embedding distance with cursor offsets', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const searchRepository = ctx.get(SearchRepository);

      const assetIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        await searchRepository.upsert(asset.id, unitVector(i));
        assetIds.push(asset.id);
      }

      const options = { filter: {}, embedding: unitVector(0) };
      const scope = { userIds: [user.id], lockedOwnerId: user.id };
      const firstPage = await searchRepository.searchSmartV3({ take: 2 }, options, scope);
      expect(firstPage.items.length).toBe(2);
      expect(firstPage.items[0].id).toBe(assetIds[0]);
      expect(firstPage.hasNextPage).toBe(true);

      const secondPage = await searchRepository.searchSmartV3({ take: 2, skip: 2 }, options, scope);
      expect(secondPage.items.length).toBe(1);
      expect(secondPage.hasNextPage).toBe(false);
  describe('getFilterSuggestions', () => {
    it('should return countries from the user assets', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, country: 'Germany' });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getFilterSuggestions(auth, {});

      expect(result.countries).toContain('Germany');
    });

    it('should return countries when withSharedSpaces is true and the user has no shared spaces', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, country: 'Germany' });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getFilterSuggestions(auth, { withSharedSpaces: true });

      expect(result.countries).toContain('Germany');
    });

    it('should return tagged people for the user', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      await ctx.newAssetFace({ assetId: asset.id, personId: person.id });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getFilterSuggestions(auth, {});

      expect(result.people.map((p) => p.name)).toContain('Alice');
    });

    it('should return people whose thumbnail has not been generated yet', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Bob', thumbnailPath: '' });
      await ctx.newAssetFace({ assetId: asset.id, personId: person.id });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getFilterSuggestions(auth, {});

      expect(result.people.map((p) => p.name)).toContain('Bob');
    });

    it('should return favorite people before alphabetical matches', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset: favoriteAsset } = await ctx.newAsset({ ownerId: user.id });
      const { person: favoritePerson } = await ctx.newPerson({ ownerId: user.id, name: 'Zelda', isFavorite: true });
      await ctx.newAssetFace({ assetId: favoriteAsset.id, personId: favoritePerson.id });

      const { asset: nonFavoriteAsset } = await ctx.newAsset({ ownerId: user.id });
      const { person: nonFavoritePerson } = await ctx.newPerson({ ownerId: user.id, name: 'Alice', isFavorite: false });
      await ctx.newAssetFace({ assetId: nonFavoriteAsset.id, personId: nonFavoritePerson.id });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getFilterSuggestions(auth, {});

      expect(result.people.map((p) => p.name)).toEqual(['Zelda', 'Alice']);
    });

    it('should not leak owner favorite state into space people ordering', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });

      const { asset: favoriteAsset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: favoriteAsset.id, addedById: owner.id });
      const { person: favoritePerson } = await ctx.newPerson({ ownerId: owner.id, name: 'Zelda', isFavorite: true });
      const { assetFace: favoriteFace } = await ctx.newAssetFace({
        assetId: favoriteAsset.id,
        personId: favoritePerson.id,
      });
      const favoriteSpacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, name: 'Zelda Space', representativeFaceId: favoriteFace.id })
        .returningAll()
        .executeTakeFirstOrThrow();
      await ctx.database
        .insertInto('shared_space_person_face')
        .values({ personId: favoriteSpacePerson.id, assetFaceId: favoriteFace.id })
        .execute();

      const { asset: nonFavoriteAsset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: nonFavoriteAsset.id, addedById: owner.id });
      const { person: nonFavoritePerson } = await ctx.newPerson({
        ownerId: owner.id,
        name: 'Alice',
        isFavorite: false,
      });
      const { assetFace: nonFavoriteFace } = await ctx.newAssetFace({
        assetId: nonFavoriteAsset.id,
        personId: nonFavoritePerson.id,
      });
      const nonFavoriteSpacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, name: 'Alice Space', representativeFaceId: nonFavoriteFace.id })
        .returningAll()
        .executeTakeFirstOrThrow();
      await ctx.database
        .insertInto('shared_space_person_face')
        .values({ personId: nonFavoriteSpacePerson.id, assetFaceId: nonFavoriteFace.id })
        .execute();

      const auth = factory.auth({ user: { id: member.id } });
      const result = await sut.getFilterSuggestions(auth, { spaceId: space.id });

      expect(result.people.map((p) => p.name)).toEqual(['Alice Space', 'Zelda Space']);
    });
  });
});
