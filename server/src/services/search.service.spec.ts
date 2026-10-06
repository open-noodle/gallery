import { BadRequestException } from '@nestjs/common';
import { beforeEach, vitest } from 'vitest';
import { mapAsset } from 'src/dtos/asset-response.dto.js';
import { SearchSuggestionType } from 'src/dtos/search.dto.js';
import { AssetOrder, AssetType, AssetVisibility, SearchOrderField } from 'src/enum.js';
import { isActiveDistanceThreshold } from 'src/repositories/search.repository.js';
import { SearchService } from 'src/services/search.service.js';
import { clearConfigCache } from 'src/utils/config.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { getForAsset } from 'test/mappers.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

vitest.useFakeTimers();

describe(SearchService.name, () => {
  let sut: SearchService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(SearchService));
    mocks.partner.getAll.mockResolvedValue([]);
    vi.spyOn(sut, 'resolveViewerScope').mockResolvedValue({ visibility: 'not-locked' });
    (mocks.faceIdentity as any).getAccessiblePersonFilterSuggestions ??= vitest.fn();
    (mocks.faceIdentity as any).searchAccessiblePeople ??= vitest.fn();
    (mocks.faceIdentity as any).getAccessiblePersonFilterSuggestions.mockResolvedValue({
      people: [],
      hasUnnamedPeople: false,
    });
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('searchPerson', () => {
    it('should pass options to search', async () => {
      const auth = AuthFactory.create();
      const name = 'foo';

      mocks.person.getByName.mockResolvedValue([]);

      await sut.searchPerson(auth, { name, withHidden: false });

      expect(mocks.person.getByName).toHaveBeenCalledWith(auth.user.id, name, { withHidden: false });

      await sut.searchPerson(auth, { name, withHidden: true });

      expect(mocks.person.getByName).toHaveBeenCalledWith(auth.user.id, name, { withHidden: true });
    });

    it('uses identity-grouped people search when shared spaces are included', async () => {
      const auth = AuthFactory.create();
      const people = [
        {
          id: 'space-person-1',
          name: 'Alice',
          birthDate: null,
          thumbnailPath: '',
          isHidden: false,
          primaryProfile: { type: 'space-person', id: 'space-person-1', spaceId: 'space-1' },
          filterId: 'space-person:space-person-1',
        },
      ];
      (mocks.faceIdentity as any).searchAccessiblePeople.mockResolvedValue(people);

      const result = await sut.searchPerson(auth, { name: 'alice', withHidden: false, withSharedSpaces: true });

      expect(result).toEqual(people);
      expect((mocks.faceIdentity as any).searchAccessiblePeople).toHaveBeenCalledWith(auth.user.id, {
        name: 'alice',
        withHidden: false,
        limit: 50,
        minimumFaceCount: 3,
      });
      expect(mocks.person.getByName).not.toHaveBeenCalled();
    });
  });

  describe('searchPlaces', () => {
    it('should search places', async () => {
      mocks.search.searchPlaces.mockResolvedValue([
        {
          id: 42,
          name: 'my place',
          latitude: 420,
          longitude: 69,
          admin1Code: null,
          admin1Name: null,
          admin2Code: null,
          admin2Name: null,
          alternateNames: null,
          countryCode: 'US',
          modificationDate: new Date(),
        },
      ]);

      await sut.searchPlaces({ name: 'place' });
      expect(mocks.search.searchPlaces).toHaveBeenCalledWith('place');
    });
  });

  describe('getExploreData', () => {
    it('should get recent assets and assets by city and tag', async () => {
      const auth = AuthFactory.create();
      const asset = AssetFactory.from()
        .exif({ latitude: 42, longitude: 69, city: 'city', state: 'state', country: 'country' })
        .build();
      mocks.asset.getAssetIdByCity.mockResolvedValue({
        fieldName: 'exifInfo.city',
        items: [{ value: 'city', data: asset.id }],
      });
      mocks.asset.getRecentlyCreatedAssetIds.mockResolvedValue({
        fieldName: 'createdAt',
        items: [{ value: asset.createdAt, data: asset.id }],
      });
      mocks.asset.getByIdsWithAllRelationsButStacks.mockResolvedValue([asset as never]);
      const expectedResponse = [
        { fieldName: 'exifInfo.city', items: [{ value: 'city', data: mapAsset(getForAsset(asset)) }] },
        {
          fieldName: 'createdAt',
          items: [{ value: asset.createdAt.toISOString(), data: mapAsset(getForAsset(asset)) }],
        },
      ];

      const result = await sut.getExploreData(auth);

      expect(result).toEqual(expectedResponse);
    });

    // The "recently added" strip stays owner-scoped on purpose — it answers "what did *I* just
    // add", and /recently-added itself is an owner surface.
    it('leaves the recently-added strip owner-scoped', async () => {
      const auth = AuthFactory.create();
      mocks.asset.getAssetIdByCity.mockResolvedValue({ fieldName: 'exifInfo.city', items: [] });
      mocks.asset.getRecentlyCreatedAssetIds.mockResolvedValue({ fieldName: 'createdAt', items: [] });
      mocks.asset.getByIdsWithAllRelationsButStacks.mockResolvedValue([]);

      await sut.getExploreData(auth);

      expect(mocks.asset.getRecentlyCreatedAssetIds).toHaveBeenCalledWith(auth.user.id, 12);
    });
  });

  describe('getSearchSuggestions', () => {
    it('should return search suggestions for country', async () => {
      mocks.search.getCountries.mockResolvedValue(['USA']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.COUNTRY }),
      ).resolves.toEqual(['USA']);
      expect(mocks.search.getCountries).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for country (including null)', async () => {
      mocks.search.getCountries.mockResolvedValue(['USA']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.COUNTRY }),
      ).resolves.toEqual(['USA', null]);
      expect(mocks.search.getCountries).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for state', async () => {
      mocks.search.getStates.mockResolvedValue(['California']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.STATE }),
      ).resolves.toEqual(['California']);
      expect(mocks.search.getStates).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for state (including null)', async () => {
      mocks.search.getStates.mockResolvedValue(['California']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.STATE }),
      ).resolves.toEqual(['California', null]);
      expect(mocks.search.getStates).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for city', async () => {
      mocks.search.getCities.mockResolvedValue(['Denver']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.CITY }),
      ).resolves.toEqual(['Denver']);
      expect(mocks.search.getCities).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should pass active filters to city suggestions', async () => {
      const personIds = [newUuid()];
      mocks.search.getCities.mockResolvedValue(['Berlin']);

      await sut.getSearchSuggestions(authStub.user1, {
        includeNull: false,
        type: SearchSuggestionType.CITY,
        country: 'Germany',
        personIds,
        rating: 4,
      });

      expect(mocks.search.getCities).toHaveBeenCalledWith(
        [authStub.user1.user.id],
        expect.objectContaining({ country: 'Germany', personIds, rating: 4 }),
      );
    });

    it('should return search suggestions for city (including null)', async () => {
      mocks.search.getCities.mockResolvedValue(['Denver']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.CITY }),
      ).resolves.toEqual(['Denver', null]);
      expect(mocks.search.getCities).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for camera make', async () => {
      mocks.search.getCameraMakes.mockResolvedValue(['Nikon']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.CAMERA_MAKE }),
      ).resolves.toEqual(['Nikon']);
      expect(mocks.search.getCameraMakes).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for camera make (including null)', async () => {
      mocks.search.getCameraMakes.mockResolvedValue(['Nikon']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.CAMERA_MAKE }),
      ).resolves.toEqual(['Nikon', null]);
      expect(mocks.search.getCameraMakes).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for camera model', async () => {
      mocks.search.getCameraModels.mockResolvedValue(['Fujifilm X100VI']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.CAMERA_MODEL }),
      ).resolves.toEqual(['Fujifilm X100VI']);
      expect(mocks.search.getCameraModels).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for camera model (including null)', async () => {
      mocks.search.getCameraModels.mockResolvedValue(['Fujifilm X100VI']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.CAMERA_MODEL }),
      ).resolves.toEqual(['Fujifilm X100VI', null]);
      expect(mocks.search.getCameraModels).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should pass active filters to camera model suggestions (#858)', async () => {
      const personIds = [newUuid()];
      const tagIds = [newUuid()];
      mocks.search.getCameraModels.mockResolvedValue(['Canon EOS R5']);

      await sut.getSearchSuggestions(authStub.user1, {
        includeNull: false,
        type: SearchSuggestionType.CAMERA_MODEL,
        make: 'Canon',
        personIds,
        tagIds,
        rating: 4,
        isFavorite: true,
        city: 'Berlin',
        mediaType: AssetType.Image,
      });

      expect(mocks.search.getCameraModels).toHaveBeenCalledWith(
        [authStub.user1.user.id],
        expect.objectContaining({
          make: 'Canon',
          personIds,
          tagIds,
          rating: 4,
          isFavorite: true,
          city: 'Berlin',
          mediaType: AssetType.Image,
        }),
      );
    });

    it('should return search suggestions for camera lens model', async () => {
      mocks.search.getCameraLensModels.mockResolvedValue(['10-24mm']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.CAMERA_LENS_MODEL }),
      ).resolves.toEqual(['10-24mm']);
      expect(mocks.search.getCameraLensModels).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for camera lens model (including null)', async () => {
      mocks.search.getCameraLensModels.mockResolvedValue(['10-24mm']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.CAMERA_LENS_MODEL }),
      ).resolves.toEqual(['10-24mm', null]);
      expect(mocks.search.getCameraLensModels).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should pass spaceId to country search suggestions', async () => {
      const spaceId = newUuid();
      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
      mocks.search.getCountries.mockResolvedValue(['Germany']);
      mocks.partner.getAll.mockResolvedValue([]);

      const result = await sut.getSearchSuggestions(authStub.user1, {
        type: SearchSuggestionType.COUNTRY,
        spaceId,
      });

      expect(result).toEqual(['Germany']);
      expect(mocks.search.getCountries).toHaveBeenCalledWith(
        [authStub.user1.user.id],
        expect.objectContaining({ spaceId }),
      );
    });

    it('should pass spaceId to state search suggestions', async () => {
      const spaceId = newUuid();
      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
      mocks.search.getStates.mockResolvedValue(['Bavaria']);
      mocks.partner.getAll.mockResolvedValue([]);

      const result = await sut.getSearchSuggestions(authStub.user1, {
        type: SearchSuggestionType.STATE,
        spaceId,
      });

      expect(result).toEqual(['Bavaria']);
      expect(mocks.search.getStates).toHaveBeenCalledWith(
        [authStub.user1.user.id],
        expect.objectContaining({ spaceId }),
      );
    });

    it('should pass temporal fields to country search suggestions', async () => {
      const takenAfter = new Date('2024-01-01');
      const takenBefore = new Date('2024-12-31');
      mocks.search.getCountries.mockResolvedValue(['Germany']);

      await sut.getSearchSuggestions(authStub.user1, {
        type: SearchSuggestionType.COUNTRY,
        takenAfter,
        takenBefore,
      });

      expect(mocks.search.getCountries).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ takenAfter, takenBefore }),
      );
    });

    it('should pass temporal fields to state search suggestions', async () => {
      const takenAfter = new Date('2024-01-01');
      const takenBefore = new Date('2024-12-31');
      mocks.search.getStates.mockResolvedValue(['Bavaria']);

      await sut.getSearchSuggestions(authStub.user1, {
        type: SearchSuggestionType.STATE,
        takenAfter,
        takenBefore,
      });

      expect(mocks.search.getStates).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ takenAfter, takenBefore }),
      );
    });

    it('should pass temporal fields to city search suggestions', async () => {
      const takenAfter = new Date('2024-01-01');
      const takenBefore = new Date('2024-12-31');
      mocks.search.getCities.mockResolvedValue(['Munich']);

      await sut.getSearchSuggestions(authStub.user1, {
        type: SearchSuggestionType.CITY,
        takenAfter,
        takenBefore,
      });

      expect(mocks.search.getCities).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ takenAfter, takenBefore }),
      );
    });

    it('should pass temporal fields to camera make search suggestions', async () => {
      const takenAfter = new Date('2024-01-01');
      const takenBefore = new Date('2024-12-31');
      mocks.search.getCameraMakes.mockResolvedValue(['Nikon']);

      await sut.getSearchSuggestions(authStub.user1, {
        type: SearchSuggestionType.CAMERA_MAKE,
        takenAfter,
        takenBefore,
      });

      expect(mocks.search.getCameraMakes).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ takenAfter, takenBefore }),
      );
    });

    it('should pass temporal fields to camera model search suggestions', async () => {
      const takenAfter = new Date('2024-01-01');
      const takenBefore = new Date('2024-12-31');
      mocks.search.getCameraModels.mockResolvedValue(['X100VI']);

      await sut.getSearchSuggestions(authStub.user1, {
        type: SearchSuggestionType.CAMERA_MODEL,
        takenAfter,
        takenBefore,
      });

      expect(mocks.search.getCameraModels).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ takenAfter, takenBefore }),
      );
    });

    it('should pass temporal fields to camera lens model search suggestions', async () => {
      const takenAfter = new Date('2024-01-01');
      const takenBefore = new Date('2024-12-31');
      mocks.search.getCameraLensModels.mockResolvedValue(['10-24mm']);

      await sut.getSearchSuggestions(authStub.user1, {
        type: SearchSuggestionType.CAMERA_LENS_MODEL,
        takenAfter,
        takenBefore,
      });

      expect(mocks.search.getCameraLensModels).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ takenAfter, takenBefore }),
      );
    });

    it('should pass spaceId and temporal fields together', async () => {
      const spaceId = newUuid();
      const takenAfter = new Date('2024-01-01');
      const takenBefore = new Date('2024-12-31');
      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
      mocks.search.getCountries.mockResolvedValue(['Germany']);

      await sut.getSearchSuggestions(authStub.user1, {
        type: SearchSuggestionType.COUNTRY,
        spaceId,
        takenAfter,
        takenBefore,
      });

      expect(mocks.search.getCountries).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ spaceId, takenAfter, takenBefore }),
      );
    });

    it('should not pass temporal fields when not provided', async () => {
      mocks.search.getCountries.mockResolvedValue(['Germany']);

      await sut.getSearchSuggestions(authStub.user1, {
        type: SearchSuggestionType.COUNTRY,
      });

      const callArg = mocks.search.getCountries.mock.calls[0][1] as Record<string, unknown>;
      expect(callArg).not.toHaveProperty('takenAfter');
      expect(callArg).not.toHaveProperty('takenBefore');
    });

    describe('album access (albumId)', () => {
      it('checks album access and passes albumId to getSearchSuggestions', async () => {
        const albumId = newUuid();
        mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
        mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([albumId]));
        mocks.search.getCountries.mockResolvedValue(['Germany']);

        const result = await sut.getSearchSuggestions(authStub.user1, {
          type: SearchSuggestionType.COUNTRY,
          albumId,
        });

        expect(result).toEqual(['Germany']);
        expect(mocks.access.album.checkOwnerAccess).toHaveBeenCalled();
        expect(mocks.access.album.checkSharedAlbumAccess).toHaveBeenCalled();
        expect(mocks.search.getCountries).toHaveBeenCalledWith(
          [authStub.user1.user.id],
          expect.objectContaining({ albumId }),
        );
      });

      it('rejects albumId mixed with spaceId for getSearchSuggestions', async () => {
        await expect(
          sut.getSearchSuggestions(authStub.user1, {
            type: SearchSuggestionType.COUNTRY,
            albumId: newUuid(),
            spaceId: newUuid(),
          }),
        ).rejects.toThrow('Cannot use albumId with spaceId');
      });

      it('rejects albumId mixed with withSharedSpaces for getSearchSuggestions', async () => {
        await expect(
          sut.getSearchSuggestions(authStub.user1, {
            type: SearchSuggestionType.COUNTRY,
            albumId: newUuid(),
            withSharedSpaces: true,
          }),
        ).rejects.toThrow('Cannot use albumId with withSharedSpaces');
      });
    });

    describe('shared space access (spaceId)', () => {
      it('should check shared space access when spaceId is provided', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
        mocks.search.getCountries.mockResolvedValue(['Germany']);

        await sut.getSearchSuggestions(authStub.user1, {
          type: SearchSuggestionType.COUNTRY,
          spaceId,
        });

        expect(mocks.access.sharedSpace.checkMemberAccess).toHaveBeenCalledWith(
          authStub.user1.user.id,
          new Set([spaceId]),
        );
      });

      it('should pass spaceId through to search repository', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
        mocks.search.getCountries.mockResolvedValue(['Germany']);

        await sut.getSearchSuggestions(authStub.user1, {
          type: SearchSuggestionType.COUNTRY,
          spaceId,
        });

        expect(mocks.search.getCountries).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ spaceId }));
      });

      it('should not check space access when spaceId is not provided', async () => {
        mocks.search.getCountries.mockResolvedValue(['Germany']);

        await sut.getSearchSuggestions(authStub.user1, {
          type: SearchSuggestionType.COUNTRY,
        });

        expect(mocks.access.sharedSpace.checkMemberAccess).not.toHaveBeenCalled();
      });

      it('should throw when user is not a space member', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set());

        await expect(
          sut.getSearchSuggestions(authStub.user1, {
            type: SearchSuggestionType.COUNTRY,
            spaceId,
          }),
        ).rejects.toThrow();
      });

      it('should reject when both spaceId and withSharedSpaces are set', async () => {
        await expect(
          sut.getSearchSuggestions(authStub.user1, {
            type: SearchSuggestionType.COUNTRY,
            spaceId: newUuid(),
            withSharedSpaces: true,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });
  });

  describe('new shape routing', () => {
    // Gallery keeps the four search endpoints on the legacy builder while upstream's V3 stays
    // dormant, and REJECTS the structured shape rather than falling through to legacy: the legacy
    // path ignores `filter` entirely, so a fallthrough would answer with a WIDER set than was asked
    // for. Rationale and switch-over plan: specs/2026-07-23-search-v3-coexistence-design.md.
    //
    // Upstream's own tests for this describe exercise the V3 routing; they are replaced rather than
    // deleted so a rebase that restores upstream's dispatch conflicts here visibly.
    const rejected = new BadRequestException(
      'Structured search (filter/orderBy/cursor) is not supported on this server. Use the flat search fields.',
    );

    it('rejects a structured request on every search endpoint', async () => {
      const auth = AuthFactory.create();

      await expect(sut.searchMetadata(auth, { size: 250, filter: {} })).rejects.toThrowError(rejected);
      await expect(sut.searchStatistics(auth, { filter: {} })).rejects.toThrowError(rejected);
      await expect(sut.searchRandom(auth, { size: 250, filter: {} })).rejects.toThrowError(rejected);
      await expect(sut.searchSmart(auth, { size: 100, filter: {}, query: 'test' })).rejects.toThrowError(rejected);
    });

    it('rejects every new-shape field, not just filter', async () => {
      const auth = AuthFactory.create();

      await expect(sut.searchMetadata(auth, { size: 250, cursor: 'abc' })).rejects.toThrowError(rejected);
      await expect(
        sut.searchMetadata(auth, {
          size: 250,
          orderBy: { field: SearchOrderField.FileCreatedAt, direction: AssetOrder.Desc },
        }),
      ).rejects.toThrowError(rejected);
    });

    it('never reaches the dormant V3 repository methods', async () => {
      const auth = AuthFactory.create();

      await expect(sut.searchMetadata(auth, { size: 250, filter: {} })).rejects.toThrow();
      await expect(sut.searchStatistics(auth, { filter: {} })).rejects.toThrow();
      await expect(sut.searchRandom(auth, { size: 250, filter: {} })).rejects.toThrow();
      await expect(sut.searchSmart(auth, { size: 100, filter: {}, query: 'test' })).rejects.toThrow();

      expect(mocks.search.searchMetadataV3).not.toHaveBeenCalled();
      expect(mocks.search.searchStatisticsV3).not.toHaveBeenCalled();
      expect(mocks.search.searchRandomV3).not.toHaveBeenCalled();
      expect(mocks.search.searchSmartV3).not.toHaveBeenCalled();
    });

    it('still routes a flat request to the legacy search', async () => {
      const auth = AuthFactory.create();
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

      await sut.searchMetadata(auth, { size: 250, city: 'Oslo' });

      expect(mocks.search.searchMetadata).toHaveBeenCalled();
      expect(mocks.search.searchMetadataV3).not.toHaveBeenCalled();
    });
  });

  describe('getTagSuggestions', () => {
    it('should return accessible tags for personal timeline', async () => {
      const tags = [
        { id: 'tag-1', value: 'Vacation' },
        { id: 'tag-2', value: 'Family' },
      ];
      mocks.search.getAccessibleTags.mockResolvedValue(tags);

      const result = await sut.getTagSuggestions(authStub.user1, {});
      expect(result).toEqual(tags);
      expect(mocks.search.getAccessibleTags).toHaveBeenCalledWith([authStub.user1.user.id], {
        timelineSpaceIds: undefined,
        visibility: 'not-locked',
      });
    });

    it('should include partner IDs in user search', async () => {
      mocks.partner.getAll.mockResolvedValue([
        {
          sharedById: 'partner-1',
          sharedBy: { id: 'partner-1' },
          sharedWithId: authStub.user1.user.id,
          sharedWith: { id: authStub.user1.user.id },
          inTimeline: true,
        } as any,
      ]);
      mocks.search.getAccessibleTags.mockResolvedValue([]);

      await sut.getTagSuggestions(authStub.user1, {});
      expect(mocks.search.getAccessibleTags).toHaveBeenCalledWith(
        expect.arrayContaining([authStub.user1.user.id, 'partner-1']),
        { timelineSpaceIds: undefined, visibility: 'not-locked' },
      );
    });

    it('should check space access when spaceId is provided', async () => {
      const spaceId = newUuid();
      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
      mocks.search.getAccessibleTags.mockResolvedValue([]);

      await sut.getTagSuggestions(authStub.user1, { spaceId });
      expect(mocks.search.getAccessibleTags).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ spaceId }),
      );
    });

    it('should pass temporal options through', async () => {
      const takenAfter = new Date('2024-01-01');
      const takenBefore = new Date('2025-01-01');
      mocks.search.getAccessibleTags.mockResolvedValue([]);

      await sut.getTagSuggestions(authStub.user1, { takenAfter, takenBefore });
      expect(mocks.search.getAccessibleTags).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ takenAfter, takenBefore }),
      );
    });
  });

  describe('searchSmart', () => {
    beforeEach(() => {
      mocks.search.searchSmart.mockResolvedValue({ hasNextPage: false, items: [] });
      mocks.machineLearning.encodeText.mockResolvedValue('[1, 2, 3]');
      clearConfigCache();
    });

    it('should raise a BadRequestException if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: false },
      });

      await expect(sut.searchSmart(authStub.user1, { size: 100, query: 'test' })).rejects.toThrowError(
        new BadRequestException('Smart search is not enabled'),
      );
    });

    it('should raise a BadRequestException if smart search is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { clip: { enabled: false } },
      });

      await expect(sut.searchSmart(authStub.user1, { size: 100, query: 'test' })).rejects.toThrowError(
        new BadRequestException('Smart search is not enabled'),
      );
    });

    it('should work', async () => {
      await sut.searchSmart(authStub.user1, { size: 100, query: 'test' });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ modelName: expect.any(String) }),
      );
      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        { page: 1, size: 100 },
        {
          query: 'test',
          size: 100,
          embedding: '[1, 2, 3]',
          userIds: [authStub.user1.user.id],
          viewingUserId: authStub.user1.user.id,
          callerId: authStub.user1.user.id,
          authUserId: authStub.user1.user.id,
          maxDistance: 0,
          visibility: 'not-locked',
        },
      );
    });

    it('should consider page and size parameters', async () => {
      await sut.searchSmart(authStub.user1, { query: 'test', page: 2, size: 50 });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ modelName: expect.any(String) }),
      );
      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        { page: 2, size: 50 },
        expect.objectContaining({ query: 'test', embedding: '[1, 2, 3]', userIds: [authStub.user1.user.id] }),
      );
    });

    it('should use clip model specified in config', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { clip: { modelName: 'ViT-B-16-SigLIP__webli' } },
      });

      await sut.searchSmart(authStub.user1, { size: 100, query: 'test' });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ modelName: 'ViT-B-16-SigLIP__webli' }),
      );
    });

    it('should use language specified in request', async () => {
      await sut.searchSmart(authStub.user1, { size: 100, query: 'test', language: 'de' });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ language: 'de' }),
      );
    });

    it('should cache embedding for the same query', async () => {
      await sut.searchSmart(authStub.user1, { size: 100, query: 'test' });
      await sut.searchSmart(authStub.user1, { size: 100, query: 'test' });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledTimes(1);
    });

    it('should not use cache for different queries', async () => {
      await sut.searchSmart(authStub.user1, { size: 100, query: 'test1' });
      await sut.searchSmart(authStub.user1, { size: 100, query: 'test2' });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledTimes(2);
    });

    // Regression guard: searchSmart must read config from cache, not rebuild it per
    // request. The uncached path runs class-transformer + class-validator over the
    // full nested SystemConfigDto and adds ~1-3s per call on slower CPUs.
    it('should read system config from cache across requests', async () => {
      await sut.searchSmart(authStub.user1, { size: 100, query: 'test1' });
      await sut.searchSmart(authStub.user1, { size: 100, query: 'test2' });
      await sut.searchSmart(authStub.user1, { size: 100, query: 'test3' });

      expect(mocks.systemMetadata.get).toHaveBeenCalledTimes(1);
    });

    it('should search by queryAssetId instead of query', async () => {
      const assetId = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      mocks.search.getEmbedding.mockResolvedValue('[4, 5, 6]');

      await sut.searchSmart(authStub.user1, { size: 100, queryAssetId: assetId });

      expect(mocks.machineLearning.encodeText).not.toHaveBeenCalled();
      expect(mocks.search.getEmbedding).toHaveBeenCalledWith(assetId);
      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        { page: 1, size: 100 },
        expect.objectContaining({ embedding: '[4, 5, 6]', userIds: [authStub.user1.user.id] }),
      );
    });

    it('should throw if queryAssetId has no embedding', async () => {
      const assetId = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      mocks.search.getEmbedding.mockResolvedValue(null);

      await expect(sut.searchSmart(authStub.user1, { size: 100, queryAssetId: assetId })).rejects.toThrow(
        `Asset ${assetId} has no embedding`,
      );
    });

    it('should throw if neither query nor queryAssetId is set', async () => {
      await expect(sut.searchSmart(authStub.user1, { size: 100 })).rejects.toThrow(
        'Either `query` or `queryAssetId` must be set',
      );
    });

    it('should return nextPage when there are more results', async () => {
      mocks.search.searchSmart.mockResolvedValue({ hasNextPage: true, items: [] });

      const result = await sut.searchSmart(authStub.user1, { size: 100, query: 'test', page: 1 });

      expect(result.assets.nextPage).toEqual('2');
    });

    it('should return null nextPage when there are no more results', async () => {
      mocks.search.searchSmart.mockResolvedValue({ hasNextPage: false, items: [] });

      const result = await sut.searchSmart(authStub.user1, { size: 100, query: 'test' });

      expect(result.assets.nextPage).toBeNull();
    });

    // An album detail page searches the album it is showing. Browse mode there scopes by album
    // ACCESS (timeline.service resolves albumSpaceIds from plain membership) and shows every
    // member's photos; query mode kept the owner-scoping `userIds`, so the same album searched
    // returned only the caller's own assets beside a grid that had just shown everyone's.
    // searchMetadata already resolves this the right way — access check instead of userIds, letting
    // `albumSharedSpaceScope` re-gate — and searchSmart now matches it.
    describe('album access (albumIds)', () => {
      it('checks album read access when albumIds is provided', async () => {
        const albumId = newUuid();
        mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
        mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([albumId]));

        await sut.searchSmart(authStub.user1, { size: 100, query: 'test', albumIds: [albumId] });

        expect(mocks.access.album.checkSharedAlbumAccess).toHaveBeenCalled();
      });

      it('throws when the caller cannot read the album', async () => {
        const albumId = newUuid();
        mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
        mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set());
        // Mocked so the ONLY thing that can reject here is the access check. Without it the call
        // throws on an unstubbed repository method instead, and the assertion passes either way.

        await expect(
          sut.searchSmart(authStub.user1, { size: 100, query: 'test', albumIds: [albumId] }),
        ).rejects.toThrow(BadRequestException);
      });

      it('drops the owner scope so a shared album returns every member’s matching photos', async () => {
        const albumId = newUuid();
        mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
        mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([albumId]));

        await sut.searchSmart(authStub.user1, { size: 100, query: 'test', albumIds: [albumId] });

        const [, options] = mocks.search.searchSmart.mock.calls.at(-1)!;
        expect(options.albumIds).toEqual([albumId]);
        expect(options.userIds).toBeUndefined();
      });

      it('keeps the owner scope when no album scope is given', async () => {
        await sut.searchSmart(authStub.user1, { size: 100, query: 'test' });

        const [, options] = mocks.search.searchSmart.mock.calls.at(-1)!;
        expect(options.userIds).toEqual([authStub.user1.user.id]);
      });

      // The facets' people list resolves the VIEWER's identity people, and it used to read that
      // viewer off `userIds[0]`. Under an album scope there is no `userIds`, so the caller has to
      // be carried explicitly or the facets request dereferences undefined.
      it('carries the caller id independently of the owner scope', async () => {
        const albumId = newUuid();
        mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
        mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([albumId]));

        await sut.searchSmart(authStub.user1, { size: 100, query: 'test', albumIds: [albumId] });

        const [, options] = mocks.search.searchSmart.mock.calls.at(-1)!;
        expect(options.callerId).toBe(authStub.user1.user.id);
      });

      it('applies the same album scope to the facets that annotate those results', async () => {
        const albumId = newUuid();
        mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
        mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([albumId]));
        mocks.search.getSmartSearchFacets.mockResolvedValue({ total: 0, timeBuckets: [], people: [] } as never);

        await sut.searchSmartFacets(authStub.user1, { query: 'test', albumIds: [albumId] });

        const [options] = mocks.search.getSmartSearchFacets.mock.calls.at(-1)!;
        expect(options.albumIds).toEqual([albumId]);
        expect(options.userIds).toBeUndefined();
      });
    });

    describe('shared space access (spaceId)', () => {
      it('should check shared space access when spaceId is provided', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));

        await sut.searchSmart(authStub.user1, { size: 100, query: 'test', spaceId });

        expect(mocks.access.sharedSpace.checkMemberAccess).toHaveBeenCalledWith(
          authStub.user1.user.id,
          new Set([spaceId]),
        );
      });

      it('should pass spaceId through to search repository', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));

        await sut.searchSmart(authStub.user1, { size: 100, query: 'test', spaceId });

        expect(mocks.search.searchSmart).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ spaceId }));
      });

      it('should not check space access when spaceId is not provided', async () => {
        await sut.searchSmart(authStub.user1, { size: 100, query: 'test' });

        expect(mocks.access.sharedSpace.checkMemberAccess).not.toHaveBeenCalled();
      });

      it('should throw when user is not a space member', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set());

        await expect(sut.searchSmart(authStub.user1, { size: 100, query: 'test', spaceId })).rejects.toThrow();
      });

      it('should reject spacePersonIds when spaceId is not set', async () => {
        await expect(
          sut.searchSmart(authStub.user1, { size: 100, query: 'test', spacePersonIds: [newUuid()] }),
        ).rejects.toThrow(BadRequestException);
      });

      it('should pass spacePersonIds through to repository', async () => {
        const spaceId = newUuid();
        const spacePersonIds = [newUuid(), newUuid()];
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));

        await sut.searchSmart(authStub.user1, { size: 100, query: 'test', spaceId, spacePersonIds });

        expect(mocks.search.searchSmart).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ spaceId, spacePersonIds }),
        );
      });

      it('should pass combined filters through to repository', async () => {
        const spaceId = newUuid();
        const spacePersonIds = [newUuid()];
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));

        await sut.searchSmart(authStub.user1, {
          size: 100,
          query: 'test',
          spaceId,
          spacePersonIds,
          city: 'Paris',
          rating: 4,
        });

        expect(mocks.search.searchSmart).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ spaceId, spacePersonIds, city: 'Paris', rating: 4 }),
        );
      });
    });

    describe('withSharedSpaces', () => {
      it('should reject when both spaceId and withSharedSpaces are set', async () => {
        await expect(
          sut.searchSmart(authStub.user1, { size: 100, query: 'test', spaceId: newUuid(), withSharedSpaces: true }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          sut.searchSmart(authStub.user1, { size: 100, query: 'test', spaceId: newUuid(), withSharedSpaces: true }),
        ).rejects.toThrow('Cannot use both spaceId and withSharedSpaces');
      });

      // #830: the reference asset for "Show similar photos" is often one the caller reaches only
      // through a Space, so the access check has to clear on space membership rather than
      // ownership, and the space scope has to survive onto the queryAssetId path.
      it('should scope a queryAssetId search to shared spaces for a member who does not own the reference asset', async () => {
        const assetId = newUuid();
        const spaceId = newUuid();
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
        mocks.access.asset.checkAlbumAccess.mockResolvedValue(new Set());
        mocks.access.asset.checkPartnerAccess.mockResolvedValue(new Set());
        mocks.access.asset.checkSpaceAccess.mockResolvedValue(new Set([assetId]));
        mocks.search.getEmbedding.mockResolvedValue('[4, 5, 6]');
        vi.mocked(sut.resolveViewerScope).mockResolvedValue({ timelineSpaceIds: [spaceId] });

        await sut.searchSmart(authStub.user1, { size: 100, queryAssetId: assetId, withSharedSpaces: true });

        expect(mocks.search.getEmbedding).toHaveBeenCalledWith(assetId);
        expect(mocks.search.searchSmart).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ embedding: '[4, 5, 6]', timelineSpaceIds: [spaceId] }),
        );
      });

      it('should still reject spacePersonIds without spaceId when withSharedSpaces is true', async () => {
        await expect(
          sut.searchSmart(authStub.user1, {
            size: 100,
            query: 'test',
            withSharedSpaces: true,
            spacePersonIds: [newUuid()],
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    it('should pass orderDirection when order is set', async () => {
      await sut.searchSmart(authStub.user1, { size: 100, query: 'test', order: AssetOrder.Desc });

      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        { page: 1, size: 100 },
        expect.objectContaining({ orderDirection: AssetOrder.Desc }),
      );
    });

    it('should not pass orderDirection when order is not set', async () => {
      await sut.searchSmart(authStub.user1, { size: 100, query: 'test' });

      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        { page: 1, size: 100 },
        expect.objectContaining({ orderDirection: undefined }),
      );
    });

    it('should pass maxDistance from config to repository', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { clip: { maxDistance: 0.75 } },
      });

      await sut.searchSmart(authStub.user1, { size: 100, query: 'test' });

      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxDistance: 0.75 }),
      );
    });

    it('should pass maxDistance from config when using queryAssetId', async () => {
      const assetId = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      mocks.search.getEmbedding.mockResolvedValue('[4, 5, 6]');
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { clip: { maxDistance: 0.75 } },
      });

      await sut.searchSmart(authStub.user1, { size: 100, queryAssetId: assetId });

      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxDistance: 0.75 }),
      );
    });

    it('should pass maxDistance 0 (disabled) by default', async () => {
      await sut.searchSmart(authStub.user1, { size: 100, query: 'test' });

      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxDistance: 0 }),
      );
    });

    it('should pass maxDistance 2 from config to repository', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { clip: { maxDistance: 2 } },
      });

      await sut.searchSmart(authStub.user1, { size: 100, query: 'test' });

      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxDistance: 2 }),
      );
    });

    it('should pass maxDistance with orderDirection when both are set', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { clip: { maxDistance: 0.75 } },
      });

      await sut.searchSmart(authStub.user1, { size: 100, query: 'test', order: AssetOrder.Desc });

      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxDistance: 0.75, orderDirection: AssetOrder.Desc }),
      );
    });
  });

  describe('searchSmartFacets', () => {
    const facetsResult = {
      total: 3,
      timeBuckets: [{ timeBucket: '2024-01-01', count: 3 }],
      countries: ['Germany'],
      cities: ['Berlin'],
      cameraMakes: ['Sony'],
      cameraModels: ['A7'],
      tags: [{ id: newUuid(), value: 'Travel' }],
      people: [
        { id: newUuid(), name: 'Zoe' },
        { id: newUuid(), name: 'Ada' },
      ],
      ratings: [4, 5],
      mediaTypes: [AssetType.Image],
      hasUnnamedPeople: false,
      hasFavorites: false,
      hasAssetsInAlbum: false,
      hasAssetsNotInAlbum: false,
    };

    beforeEach(() => {
      mocks.search.getSmartSearchFacets.mockResolvedValue(facetsResult);
      mocks.machineLearning.encodeText.mockResolvedValue('[1, 2, 3]');
      clearConfigCache();
    });

    it('raises BadRequestException when smart search is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { clip: { enabled: false } } });

      await expect(sut.searchSmartFacets(authStub.user1, { query: 'test' })).rejects.toThrow(
        'Smart search is not enabled',
      );
    });

    it('encodes text queries using the configured CLIP model and language', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { clip: { modelName: 'ViT-B-16-SigLIP__webli', maxDistance: 0.75 } },
      });

      await sut.searchSmartFacets(authStub.user1, { query: 'test', language: 'de' });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledWith('test', {
        modelName: 'ViT-B-16-SigLIP__webli',
        language: 'de',
      });
      expect(mocks.search.getSmartSearchFacets).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'test',
          embedding: '[1, 2, 3]',
          userIds: [authStub.user1.user.id],
          maxDistance: 0.75,
        }),
      );
    });

    it('reuses the text embedding cache across result and facet calls', async () => {
      mocks.search.searchSmart.mockResolvedValue({ hasNextPage: false, items: [] });

      await sut.searchSmart(authStub.user1, { size: 100, query: 'test' });
      await sut.searchSmartFacets(authStub.user1, { query: 'test' });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledTimes(1);
    });

    it('searches by queryAssetId after checking asset access', async () => {
      const assetId = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      mocks.search.getEmbedding.mockResolvedValue('[4, 5, 6]');

      await sut.searchSmartFacets(authStub.user1, { queryAssetId: assetId });

      expect(mocks.machineLearning.encodeText).not.toHaveBeenCalled();
      expect(mocks.search.getEmbedding).toHaveBeenCalledWith(assetId);
      expect(mocks.search.getSmartSearchFacets).toHaveBeenCalledWith(
        expect.objectContaining({ queryAssetId: assetId, embedding: '[4, 5, 6]' }),
      );
    });

    it('throws when queryAssetId has no embedding', async () => {
      const assetId = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      mocks.search.getEmbedding.mockResolvedValue(null);

      await expect(sut.searchSmartFacets(authStub.user1, { queryAssetId: assetId })).rejects.toThrow(
        `Asset ${assetId} has no embedding`,
      );
    });

    it('throws when neither query nor queryAssetId is set', async () => {
      await expect(sut.searchSmartFacets(authStub.user1, {})).rejects.toThrow(
        'Either `query` or `queryAssetId` must be set',
      );
    });

    it('rejects spaceId mixed with withSharedSpaces', async () => {
      await expect(
        sut.searchSmartFacets(authStub.user1, { query: 'test', spaceId: newUuid(), withSharedSpaces: true }),
      ).rejects.toThrow('Cannot use both spaceId and withSharedSpaces');
    });

    it('checks shared space access and passes space filters through', async () => {
      const spaceId = newUuid();
      const spacePersonIds = [newUuid()];
      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));

      await sut.searchSmartFacets(authStub.user1, { query: 'test', spaceId, spacePersonIds });

      expect(mocks.access.sharedSpace.checkMemberAccess).toHaveBeenCalledWith(
        authStub.user1.user.id,
        new Set([spaceId]),
      );
      expect(mocks.search.getSmartSearchFacets).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId, spacePersonIds }),
      );
    });

    it('rejects spacePersonIds without spaceId', async () => {
      await expect(
        sut.searchSmartFacets(authStub.user1, { query: 'test', spacePersonIds: [newUuid()] }),
      ).rejects.toThrow('spacePersonIds requires spaceId');
    });

    it('does not pass orderDirection to the facets repository call', async () => {
      await sut.searchSmartFacets(authStub.user1, { query: 'test' });

      expect(mocks.search.getSmartSearchFacets).toHaveBeenCalledWith(
        expect.not.objectContaining({ orderDirection: expect.anything() }),
      );
    });

    it('passes rating null through for unrated smart facet filters', async () => {
      await sut.searchSmartFacets(authStub.user1, { query: 'test', rating: null });

      expect(mocks.search.getSmartSearchFacets).toHaveBeenCalledWith(expect.objectContaining({ rating: null }));
    });

    it('sorts people by name before returning the response', async () => {
      const result = await sut.searchSmartFacets(authStub.user1, { query: 'test' });

      expect(result.people.map((person) => person.name)).toEqual(['Ada', 'Zoe']);
    });
  });

  describe('searchMetadata', () => {
    // #763: auth.user is the link owner — neither project nor filter by their favorites.
    it('does not resolve favorites for a shared link session (#763)', async () => {
      mocks.access.album.checkSharedLinkAccess.mockResolvedValue(new Set(['album-1']));
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

      await sut.searchMetadata(authStub.adminSharedLink, { albumIds: ['album-1'], size: 250 });

      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ authUserId: undefined }),
      );
    });

    it('rejects a favorite filter for a shared link session (#763)', async () => {
      mocks.access.album.checkSharedLinkAccess.mockResolvedValue(new Set(['album-1']));

      await expect(
        sut.searchMetadata(authStub.adminSharedLink, { albumIds: ['album-1'], isFavorite: true, size: 250 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.search.searchMetadata).not.toHaveBeenCalled();
    });

    it('should search metadata with default pagination', async () => {
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

      const result = await sut.searchMetadata(authStub.user1, { size: 250 });

      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        { page: 1, size: 250 },
        expect.objectContaining({ userIds: [authStub.user1.user.id], orderDirection: 'desc' }),
      );
      expect(result.assets.nextPage).toBeNull();
    });

    it('should search metadata with custom pagination', async () => {
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

      await sut.searchMetadata(authStub.user1, { page: 3, size: 50 });

      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        { page: 3, size: 50 },
        expect.objectContaining({ userIds: [authStub.user1.user.id] }),
      );
    });

    it('should return nextPage when there are more results', async () => {
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: true, items: [] });

      const result = await sut.searchMetadata(authStub.user1, { size: 250, page: 2 });

      expect(result.assets.nextPage).toEqual('3');
    });

    it('should decode hex checksum', async () => {
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });
      const hexChecksum = 'abcdef1234567890abcdef1234567890abcdef12';

      await sut.searchMetadata(authStub.user1, { size: 250, checksum: hexChecksum });

      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ checksum: Buffer.from(hexChecksum, 'hex') }),
      );
    });

    it('should decode base64 checksum (28 characters)', async () => {
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });
      // SHA1 hash in base64 is exactly 28 characters
      const base64Checksum = 'q83vEjRWeJCrze8SNFZ4kKvN7xI=';

      await sut.searchMetadata(authStub.user1, { size: 250, checksum: base64Checksum });

      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ checksum: Buffer.from(base64Checksum, 'base64') }),
      );
    });

    it('should throw for locked visibility without elevated permission', async () => {
      const auth = AuthFactory.create();

      await expect(sut.searchMetadata(auth, { size: 250, visibility: AssetVisibility.Locked })).rejects.toThrow(
        'Elevated permission is required',
      );
    });

    describe('shared space access (spaceId)', () => {
      it('should check shared space access when spaceId is provided', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
        mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

        await sut.searchMetadata(authStub.user1, { size: 250, spaceId });

        expect(mocks.access.sharedSpace.checkMemberAccess).toHaveBeenCalledWith(
          authStub.user1.user.id,
          new Set([spaceId]),
        );
      });

      it('should pass spaceId through to search repository', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
        mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

        await sut.searchMetadata(authStub.user1, { size: 250, spaceId });

        expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ spaceId }),
        );
      });

      it('should not check space access when spaceId is not provided', async () => {
        mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

        await sut.searchMetadata(authStub.user1, { size: 250 });

        expect(mocks.access.sharedSpace.checkMemberAccess).not.toHaveBeenCalled();
      });

      it('should throw when user is not a space member', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set());

        await expect(sut.searchMetadata(authStub.user1, { size: 250, spaceId })).rejects.toThrow();
      });
    });

    // ownerId is a narrowing contributor filter (searchAssetBuilder applies it as a standalone AND
    // on asset.ownerId). It must reach the repository as its own field and must NOT be merged into
    // userIds, which is the owner SCOPING predicate — merging it there would widen the result set
    // (a data leak) instead of narrowing it.
    it('passes ownerId through to the search repository as its own field, not merged into userIds', async () => {
      const ownerId = newUuid();
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

      await sut.searchMetadata(authStub.user1, { size: 250, ownerId });

      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ownerId, userIds: [authStub.user1.user.id] }),
      );
    });
  });

  describe('searchStatistics', () => {
    it('should search statistics', async () => {
      mocks.search.searchStatistics.mockResolvedValue({ images: 10, videos: 5, total: 15 } as any);

      const result = await sut.searchStatistics(authStub.user1, {});

      expect(mocks.search.searchStatistics).toHaveBeenCalledWith(
        expect.objectContaining({ userIds: [authStub.user1.user.id] }),
      );
      expect(result).toEqual({ images: 10, videos: 5, total: 15 });
    });
  });

  describe('searchRandom', () => {
    it('should search random assets', async () => {
      const asset = AssetFactory.from().build();
      mocks.search.searchRandom.mockResolvedValue([asset as any]);

      const result = await sut.searchRandom(authStub.user1, { size: 250 });

      expect(mocks.search.searchRandom).toHaveBeenCalledWith(
        250,
        expect.objectContaining({ userIds: [authStub.user1.user.id] }),
      );
      expect(result).toHaveLength(1);
    });

    it('should search random assets with custom size', async () => {
      mocks.search.searchRandom.mockResolvedValue([]);

      await sut.searchRandom(authStub.user1, { size: 10 });

      expect(mocks.search.searchRandom).toHaveBeenCalledWith(
        10,
        expect.objectContaining({ userIds: [authStub.user1.user.id] }),
      );
    });

    it('resolves visibility to not-locked for a non-elevated session', async () => {
      const auth = AuthFactory.from().session().build();
      mocks.search.searchRandom.mockResolvedValue([]);

      await sut.searchRandom(auth, { size: 250 });

      const opts = mocks.search.searchRandom.mock.calls[0][1];
      expect(opts.visibility).toBe('not-locked');
    });

    it('resolves visibility to undefined for an elevated session', async () => {
      const auth = AuthFactory.from().session({ hasElevatedPermission: true }).build();
      mocks.search.searchRandom.mockResolvedValue([]);

      await sut.searchRandom(auth, { size: 250 });

      const opts = mocks.search.searchRandom.mock.calls[0][1];
      expect(opts).toHaveProperty('visibility');
      expect(opts.visibility).toBeUndefined();
    });

    it('passes an explicit visibility through unchanged', async () => {
      const auth = AuthFactory.from().session().build();
      mocks.search.searchRandom.mockResolvedValue([]);

      await sut.searchRandom(auth, { size: 250, visibility: AssetVisibility.Archive });

      const opts = mocks.search.searchRandom.mock.calls[0][1];
      expect(opts.visibility).toBe(AssetVisibility.Archive);
    });

    it('treats a no-session auth (api key / shared link) as not-locked', async () => {
      const auth = AuthFactory.create();
      mocks.search.searchRandom.mockResolvedValue([]);

      await sut.searchRandom(auth, { size: 250 });

      const opts = mocks.search.searchRandom.mock.calls[0][1];
      expect(opts.visibility).toBe('not-locked');
    });

    it('should throw for locked visibility without elevated permission', async () => {
      const auth = AuthFactory.create();

      await expect(sut.searchRandom(auth, { size: 250, visibility: AssetVisibility.Locked })).rejects.toThrow(
        'Elevated permission is required',
      );
    });

    describe('shared space access (spaceId)', () => {
      it('should check shared space access when spaceId is provided', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
        mocks.search.searchRandom.mockResolvedValue([]);

        await sut.searchRandom(authStub.user1, { size: 250, spaceId });

        expect(mocks.access.sharedSpace.checkMemberAccess).toHaveBeenCalledWith(
          authStub.user1.user.id,
          new Set([spaceId]),
        );
        expect(mocks.search.searchRandom).toHaveBeenCalledWith(250, expect.objectContaining({ spaceId }));
      });

      it('should not check space access when spaceId is not provided', async () => {
        mocks.search.searchRandom.mockResolvedValue([]);

        await sut.searchRandom(authStub.user1, { size: 250 });

        expect(mocks.access.sharedSpace.checkMemberAccess).not.toHaveBeenCalled();
      });

      it('should throw when user is not a space member', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set());

        await expect(sut.searchRandom(authStub.user1, { size: 250, spaceId })).rejects.toThrow();
      });
    });
  });

  describe('searchLargeAssets', () => {
    it('should search large assets', async () => {
      const asset = AssetFactory.from().build();
      mocks.search.searchLargeAssets.mockResolvedValue([asset as any]);

      const result = await sut.searchLargeAssets(authStub.user1, { size: 250 });

      expect(mocks.search.searchLargeAssets).toHaveBeenCalledWith(
        250,
        expect.objectContaining({ userIds: [authStub.user1.user.id] }),
      );
      expect(result).toHaveLength(1);
    });

    it('should search large assets with custom size', async () => {
      mocks.search.searchLargeAssets.mockResolvedValue([]);

      await sut.searchLargeAssets(authStub.user1, { size: 10 });

      expect(mocks.search.searchLargeAssets).toHaveBeenCalledWith(
        10,
        expect.objectContaining({ userIds: [authStub.user1.user.id] }),
      );
    });

    it('should throw for locked visibility without elevated permission', async () => {
      const auth = AuthFactory.create();

      await expect(sut.searchLargeAssets(auth, { size: 250, visibility: AssetVisibility.Locked })).rejects.toThrow(
        'Elevated permission is required',
      );
    });

    describe('shared space access (spaceId)', () => {
      it('should check shared space access when spaceId is provided', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
        mocks.search.searchLargeAssets.mockResolvedValue([]);

        await sut.searchLargeAssets(authStub.user1, { size: 250, spaceId });

        expect(mocks.access.sharedSpace.checkMemberAccess).toHaveBeenCalledWith(
          authStub.user1.user.id,
          new Set([spaceId]),
        );
        expect(mocks.search.searchLargeAssets).toHaveBeenCalledWith(250, expect.objectContaining({ spaceId }));
      });

      it('should not check space access when spaceId is not provided', async () => {
        mocks.search.searchLargeAssets.mockResolvedValue([]);

        await sut.searchLargeAssets(authStub.user1, { size: 250 });

        expect(mocks.access.sharedSpace.checkMemberAccess).not.toHaveBeenCalled();
      });

      it('should throw when user is not a space member', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set());

        await expect(sut.searchLargeAssets(authStub.user1, { size: 250, spaceId })).rejects.toThrow();
      });
    });
  });

  describe('H-1: trash / offline params rejected under a shared-space scope', () => {
    const runners: Array<{ name: string; run: (dto: Record<string, unknown>) => Promise<unknown> }> = [
      { name: 'searchMetadata', run: (dto) => sut.searchMetadata(authStub.user1, { size: 250, ...dto }) },
      { name: 'searchRandom', run: (dto) => sut.searchRandom(authStub.user1, { size: 250, ...dto }) },
      { name: 'searchLargeAssets', run: (dto) => sut.searchLargeAssets(authStub.user1, { size: 250, ...dto }) },
      { name: 'searchStatistics', run: (dto) => sut.searchStatistics(authStub.user1, dto) },
      { name: 'searchSmart', run: (dto) => sut.searchSmart(authStub.user1, { size: 100, query: 'test', ...dto }) },
    ];

    const trashParams: Array<{ label: string; param: Record<string, unknown>; needsWithDeleted?: boolean }> = [
      { label: 'withDeleted', param: { withDeleted: true }, needsWithDeleted: true },
      { label: 'trashedAfter', param: { trashedAfter: new Date('1970-01-01T00:00:00.000Z') } },
      { label: 'trashedBefore', param: { trashedBefore: new Date('2999-01-01T00:00:00.000Z') } },
      { label: 'isOffline', param: { isOffline: true } },
    ];

    const scopes: Array<{ label: string; scope: Record<string, unknown> }> = [
      { label: 'spaceId', scope: { spaceId: newUuid() } },
      { label: 'withSharedSpaces', scope: { withSharedSpaces: true } },
    ];

    const message = 'Trashed and offline assets are not available when searching a shared space';

    for (const runner of runners) {
      for (const scope of scopes) {
        for (const tp of trashParams) {
          // StatisticsSearchDto has no `withDeleted` field (zod strips it); it can only be reached
          // via the implicit-flip params (trashedAfter/trashedBefore/isOffline), so withDeleted is
          // not a real code path there.
          if (runner.name === 'searchStatistics' && tp.needsWithDeleted) {
            continue;
          }
          it(`${runner.name} rejects ${tp.label} with ${scope.label}`, async () => {
            await expect(runner.run({ ...scope.scope, ...tp.param })).rejects.toThrow(message);
          });
        }
      }
    }

    it('does not reject a plain space search with no trash params (searchMetadata)', async () => {
      const spaceId = newUuid();
      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

      await expect(sut.searchMetadata(authStub.user1, { size: 250, spaceId })).resolves.toBeDefined();
    });

    it('does not reject withDeleted outside a space scope (searchMetadata)', async () => {
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

      await expect(sut.searchMetadata(authStub.user1, { size: 250, withDeleted: true })).resolves.toBeDefined();
    });

    it('does not over-block isOffline=false under a space scope (searchMetadata)', async () => {
      const spaceId = newUuid();
      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

      await expect(sut.searchMetadata(authStub.user1, { size: 250, spaceId, isOffline: false })).resolves.toBeDefined();
    });
  });

  describe('getAssetsByCity', () => {
    it('should get assets by city', async () => {
      const asset = AssetFactory.from().build();
      mocks.search.getAssetsByCity.mockResolvedValue([asset as any]);

      const result = await sut.getAssetsByCity(authStub.user1);

      // #763: getAssetsByCity also threads the caller's id to project isFavoriteForUser; the
      // undefined is #867's timelineSpaceIds, which this stub has none of.
      expect(mocks.search.getAssetsByCity).toHaveBeenCalledWith(
        [authStub.user1.user.id],
        undefined,
        authStub.user1.user.id,
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('getFilterSuggestions', () => {
    const emptyResult = {
      countries: [],
      cameraMakes: [],
      tags: [],
      people: [],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
      hasFavorites: false,
      hasAssetsInAlbum: false,
      hasAssetsNotInAlbum: false,
    };

    // #763: the Favourites section is offered based on a WIDER space scope than every other facet.
    // A favourite survives hiding its space from the timeline, so withholding the section for one
    // would hide a filter that does have results. The other facets keep the timeline-visible scope —
    // widening those would pull a hidden space's cities/tags/people back into the panel.
    it('scopes the favourites probe to every membership while other facets stay timeline-visible (#763)', async () => {
      // Through the real viewer scope: this is the service-level pin on the favourites facet's spaces.
      vi.mocked(sut.resolveViewerScope).mockRestore();
      const auth = AuthFactory.create();
      const visibleSpaceId = newUuid();
      const hiddenSpaceId = newUuid();
      mocks.partner.getAll.mockResolvedValue([]);
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId: visibleSpaceId }]);
      mocks.sharedSpace.getAllMemberSpaceIds.mockResolvedValue([
        { spaceId: visibleSpaceId },
        { spaceId: hiddenSpaceId },
      ]);
      mocks.search.getFilterSuggestions.mockResolvedValue(emptyResult);
      (mocks.faceIdentity as any).getAccessiblePersonFilterSuggestions.mockResolvedValue({
        people: [],
        hasUnnamedPeople: false,
      });

      await sut.getFilterSuggestions(auth, { withSharedSpaces: true });

      expect(mocks.search.getFilterSuggestions).toHaveBeenCalledWith(
        [auth.user.id],
        expect.objectContaining({
          timelineSpaceIds: [visibleSpaceId],
          favoriteSpaceIds: [visibleSpaceId, hiddenSpaceId],
        }),
      );
    });

    it('should return filter suggestions', async () => {
      const auth = AuthFactory.create();
      mocks.partner.getAll.mockResolvedValue([]);
      mocks.search.getFilterSuggestions.mockResolvedValue({
        countries: ['Germany', 'France'],
        cameraMakes: ['Canon'],
        tags: [{ id: 't1', value: 'Vacation' }],
        people: [{ id: 'p1', name: 'Alice' }],
        ratings: [4, 5],
        mediaTypes: ['IMAGE', 'VIDEO'],
        hasUnnamedPeople: false,
        hasFavorites: false,
        hasAssetsInAlbum: false,
        hasAssetsNotInAlbum: false,
      });
      (mocks.faceIdentity as any).getAccessiblePersonFilterSuggestions.mockResolvedValue({
        people: [{ id: 'p1', name: 'Alice' }],
        hasUnnamedPeople: false,
      });

      const result = await sut.getFilterSuggestions(auth, { withSharedSpaces: true });

      expect(result.countries).toEqual(['Germany', 'France']);
      expect(result.people).toEqual([{ id: 'p1', name: 'Alice' }]);
      expect(result.hasUnnamedPeople).toBe(false);
      expect(mocks.search.getFilterSuggestions).toHaveBeenCalledWith(
        [auth.user.id],
        expect.objectContaining({ withSharedSpaces: true }),
      );
    });

    it('should return empty suggestions when no filters match', async () => {
      const auth = AuthFactory.create();
      mocks.partner.getAll.mockResolvedValue([]);
      mocks.search.getFilterSuggestions.mockResolvedValue(emptyResult);

      const result = await sut.getFilterSuggestions(auth, {});

      expect(result).toEqual(emptyResult);
    });

    it('should return hasUnnamedPeople true when unnamed people exist', async () => {
      const auth = AuthFactory.create();
      mocks.partner.getAll.mockResolvedValue([]);
      mocks.search.getFilterSuggestions.mockResolvedValue({
        ...emptyResult,
        hasUnnamedPeople: true,
      });

      const result = await sut.getFilterSuggestions(auth, {});

      expect(result.people).toEqual([]);
      expect(result.hasUnnamedPeople).toBe(true);
    });

    it('should preserve repository ordering for people suggestions', async () => {
      const auth = AuthFactory.create();
      mocks.partner.getAll.mockResolvedValue([]);
      mocks.search.getFilterSuggestions.mockResolvedValue({
        ...emptyResult,
        people: [
          { id: 'p3', name: 'Zelda' },
          { id: 'p1', name: 'Alice' },
          { id: 'p2', name: 'Bob' },
        ],
      });

      const result = await sut.getFilterSuggestions(auth, {});

      expect(result.people).toEqual([
        { id: 'p3', name: 'Zelda' },
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
      ]);
    });

    it('should throw when both spaceId and withSharedSpaces are set', async () => {
      const auth = AuthFactory.create();
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getFilterSuggestions(auth, { spaceId: newUuid(), withSharedSpaces: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('checks album access and passes albumId to getFilterSuggestions', async () => {
      const albumId = newUuid();
      const auth = AuthFactory.create();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([albumId]));
      mocks.search.getFilterSuggestions.mockResolvedValue({
        countries: ['Germany'],
        cameraMakes: ['Canon'],
        tags: [{ id: 'tag-1', value: 'Vacation' }],
        people: [{ id: 'person-1', name: 'Alice' }],
        ratings: [5],
        mediaTypes: ['IMAGE'],
        hasUnnamedPeople: false,
        hasFavorites: false,
        hasAssetsInAlbum: false,
        hasAssetsNotInAlbum: false,
      });

      const result = await sut.getFilterSuggestions(auth, { albumId });

      expect(result.countries).toEqual(['Germany']);
      expect(mocks.access.album.checkOwnerAccess).toHaveBeenCalled();
      expect(mocks.access.album.checkSharedAlbumAccess).toHaveBeenCalled();
      expect(mocks.search.getFilterSuggestions).toHaveBeenCalledWith(
        [auth.user.id],
        expect.objectContaining({ albumId }),
      );
    });

    it('rejects albumId mixed with withSharedSpaces for getFilterSuggestions', async () => {
      const auth = AuthFactory.create();

      await expect(sut.getFilterSuggestions(auth, { albumId: newUuid(), withSharedSpaces: true })).rejects.toThrow(
        'Cannot use albumId with withSharedSpaces',
      );
    });

    it('rejects albumId mixed with spaceId for getFilterSuggestions', async () => {
      const auth = AuthFactory.create();

      await expect(sut.getFilterSuggestions(auth, { albumId: newUuid(), spaceId: newUuid() })).rejects.toThrow(
        'Cannot use albumId with spaceId',
      );
    });

    it('should check space access when spaceId is set', async () => {
      const auth = AuthFactory.create();
      const spaceId = newUuid();
      mocks.partner.getAll.mockResolvedValue([]);
      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
      mocks.search.getFilterSuggestions.mockResolvedValue(emptyResult);

      await sut.getFilterSuggestions(auth, { spaceId });

      expect(mocks.access.sharedSpace.checkMemberAccess).toHaveBeenCalled();
    });

    it('should pass all filter dimensions through to repository', async () => {
      const auth = AuthFactory.create();
      const personId = newUuid();
      const tagId = newUuid();
      const takenAfter = new Date('2024-01-01');
      const takenBefore = new Date('2024-12-31');
      mocks.partner.getAll.mockResolvedValue([]);
      mocks.search.getFilterSuggestions.mockResolvedValue(emptyResult);

      await sut.getFilterSuggestions(auth, {
        country: 'Germany',
        city: 'Munich',
        make: 'Canon',
        model: 'EOS R5',
        personIds: [personId],
        tagIds: [tagId],
        rating: 5,
        mediaType: AssetType.Image,
        isFavorite: true,
        takenAfter,
        takenBefore,
      });

      expect(mocks.search.getFilterSuggestions).toHaveBeenCalledWith(
        [auth.user.id],
        expect.objectContaining({
          country: 'Germany',
          city: 'Munich',
          make: 'Canon',
          model: 'EOS R5',
          personIds: [personId],
          tagIds: [tagId],
          rating: 5,
          mediaType: AssetType.Image,
          isFavorite: true,
          takenAfter,
          takenBefore,
        }),
      );
    });

    it('should pass empty/undefined filters without error', async () => {
      const auth = AuthFactory.create();
      mocks.partner.getAll.mockResolvedValue([]);
      mocks.search.getFilterSuggestions.mockResolvedValue(emptyResult);

      await sut.getFilterSuggestions(auth, {});

      expect(mocks.search.getFilterSuggestions).toHaveBeenCalledWith([auth.user.id], expect.objectContaining({}));
    });
  });

  describe('getUserIdsToSearch (via searchMetadata)', () => {
    it('should include partner ids', async () => {
      const partnerId = newUuid();
      mocks.partner.getAll.mockResolvedValue([
        {
          sharedById: partnerId,
          sharedBy: { id: partnerId } as any,
          sharedWithId: authStub.user1.user.id,
          sharedWith: { id: authStub.user1.user.id } as any,
          inTimeline: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          createId: newUuid(),
          updateId: newUuid(),
        },
      ]);
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

      await sut.searchMetadata(authStub.user1, { size: 250 });

      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ userIds: [authStub.user1.user.id, partnerId] }),
      );
    });
  });

  // What the viewer may see is resolved by src/utils/viewer-scope.ts (table-tested there); every
  // search entry point asks for the `search` surface and hands the resolved scope to its query.
  describe('viewer scope', () => {
    const spaceId = newUuid();
    const scope = {
      timelineSpaceIds: [spaceId],
      visibility: 'not-locked' as const,
      personIds: ['legacy-person'],
      identityIds: ['identity'],
      spacePersonIds: ['space-person'],
      forceEmptyResult: true,
    };
    const dto = { size: 10, withSharedSpaces: true, personIds: [`space-person:${newUuid()}`] };
    const auth = authStub.user1;
    const userIds = [auth.user.id];

    beforeEach(() => {
      vi.mocked(sut.resolveViewerScope).mockResolvedValue(scope);
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });
      mocks.search.searchSmart.mockResolvedValue({ hasNextPage: false, items: [] });
      mocks.search.getSmartSearchFacets.mockResolvedValue({ total: 0, people: [] } as never);
      mocks.search.searchRandom.mockResolvedValue([]);
      mocks.search.searchLargeAssets.mockResolvedValue([]);
      mocks.search.getCameraMakes.mockResolvedValue([]);
      mocks.search.getAccessibleTags.mockResolvedValue([]);
      mocks.search.getAssetsByCity.mockResolvedValue([]);
      mocks.machineLearning.encodeText.mockResolvedValue('[1, 2, 3]');
      clearConfigCache();
    });

    it.each([
      ['searchMetadata', () => sut.searchMetadata(auth, dto), () => mocks.search.searchMetadata, [expect.anything()]],
      ['searchStatistics', () => sut.searchStatistics(auth, dto), () => mocks.search.searchStatistics, []],
      ['searchRandom', () => sut.searchRandom(auth, dto), () => mocks.search.searchRandom, [dto.size]],
      ['searchLargeAssets', () => sut.searchLargeAssets(auth, dto), () => mocks.search.searchLargeAssets, [dto.size]],
      [
        'searchSmart',
        () => sut.searchSmart(auth, { ...dto, query: 'q' }),
        () => mocks.search.searchSmart,
        [expect.anything()],
      ],
      [
        'searchSmartFacets',
        () => sut.searchSmartFacets(auth, { ...dto, query: 'q' }),
        () => mocks.search.getSmartSearchFacets,
        [],
      ],
      [
        'getSearchSuggestions',
        () => sut.getSearchSuggestions(auth, { ...dto, type: SearchSuggestionType.CAMERA_MAKE }),
        () => mocks.search.getCameraMakes,
        [userIds],
      ],
      [
        'getFilterSuggestions',
        () => sut.getFilterSuggestions(auth, dto),
        () => mocks.search.getFilterSuggestions,
        [userIds],
      ],
    ] as const)('%s resolves the search scope and passes it whole', async (_, call, repository, leadingArgs) => {
      await call();

      expect(sut.resolveViewerScope).toHaveBeenCalledWith(auth, 'search', expect.objectContaining(dto));
      expect(repository()).toHaveBeenCalledWith(...leadingArgs, expect.objectContaining(scope));
    });

    it('getTagSuggestions resolves the search scope', async () => {
      await sut.getTagSuggestions(auth, { withSharedSpaces: true });

      expect(sut.resolveViewerScope).toHaveBeenCalledWith(auth, 'search', { withSharedSpaces: true });
      expect(mocks.search.getAccessibleTags).toHaveBeenCalledWith(
        userIds,
        expect.objectContaining({ timelineSpaceIds: [spaceId], visibility: 'not-locked' }),
      );
    });

    it('scopes the Explore places strip and the places page to the viewer’s timeline spaces (#867)', async () => {
      mocks.asset.getAssetIdByCity.mockResolvedValue({ fieldName: 'exifInfo.city', items: [] });
      mocks.asset.getRecentlyCreatedAssetIds.mockResolvedValue({ fieldName: 'createdAt', items: [] });
      mocks.asset.getByIdsWithAllRelationsButStacks.mockResolvedValue([]);

      await sut.getExploreData(auth);
      await sut.getAssetsByCity(auth);

      expect(sut.resolveViewerScope).toHaveBeenCalledWith(auth, 'search', { withSharedSpaces: true });
      expect(mocks.asset.getAssetIdByCity).toHaveBeenCalledWith(auth.user.id, {
        maxFields: 12,
        minAssetsPerField: 5,
        timelineSpaceIds: [spaceId],
      });
      // #763 threads the caller as a third argument so the row can project isFavoriteForUser.
      expect(mocks.search.getAssetsByCity).toHaveBeenCalledWith(userIds, [spaceId], auth.user.id);
    });

    // #763: a favourite-filtered search spans every space the caller belongs to; the call sites opt in.
    it.each([
      ['searchMetadata', () => sut.searchMetadata(auth, { ...dto, isFavorite: true })],
      ['searchStatistics', () => sut.searchStatistics(auth, { ...dto, isFavorite: true })],
      ['searchRandom', () => sut.searchRandom(auth, { ...dto, isFavorite: true })],
      ['searchLargeAssets', () => sut.searchLargeAssets(auth, { ...dto, isFavorite: true })],
      ['searchSmart', () => sut.searchSmart(auth, { ...dto, query: 'q', isFavorite: true })],
    ] as const)('%s asks for every member space on a favourite-filtered search (#763)', async (_, call) => {
      await call();

      expect(sut.resolveViewerScope).toHaveBeenCalledWith(
        auth,
        'search',
        expect.objectContaining({ favoriteScoped: true }),
      );
    });

    it('keeps filter suggestions on the timeline spaces, with the member spaces for the favourites probe (#763)', async () => {
      await sut.getFilterSuggestions(auth, { ...dto, isFavorite: true });

      expect(sut.resolveViewerScope).toHaveBeenCalledWith(
        auth,
        'search',
        expect.objectContaining({ withFavoriteSpaces: true }),
      );
      expect(sut.resolveViewerScope).not.toHaveBeenCalledWith(
        auth,
        'search',
        expect.objectContaining({ favoriteScoped: true }),
      );
    });
  });
});

describe(isActiveDistanceThreshold.name, () => {
  it('should return false for undefined', () => {
    expect(isActiveDistanceThreshold(void 0 as any)).toBe(false);
  });

  it('should return false for 0 (disabled)', () => {
    expect(isActiveDistanceThreshold(0)).toBe(false);
  });

  it('should return false for negative values', () => {
    expect(isActiveDistanceThreshold(-1)).toBe(false);
  });

  it('should return false for 2 (max cosine distance, no-op)', () => {
    expect(isActiveDistanceThreshold(2)).toBe(false);
  });

  it('should return false for values above 2', () => {
    expect(isActiveDistanceThreshold(5)).toBe(false);
  });

  it('should return true for 0.75 (typical threshold)', () => {
    expect(isActiveDistanceThreshold(0.75)).toBe(true);
  });

  it('should return true for 0.001 (very small positive)', () => {
    expect(isActiveDistanceThreshold(0.001)).toBe(true);
  });

  it('should return true for 1.99 (just under boundary)', () => {
    expect(isActiveDistanceThreshold(1.99)).toBe(true);
  });

  it('should return true for 0.5 (strict threshold)', () => {
    expect(isActiveDistanceThreshold(0.5)).toBe(true);
  });

  it('should return true for 1 (permissive threshold)', () => {
    expect(isActiveDistanceThreshold(1)).toBe(true);
  });
});
