import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { mapAsset } from 'src/dtos/asset-response.dto';
import { SearchSuggestionType } from 'src/dtos/search.dto';
import { AssetOrder, AssetType, AssetVisibility } from 'src/enum';
import { isActiveDistanceThreshold } from 'src/repositories/search.repository';
import { SearchService } from 'src/services/search.service';
import { clearConfigCache } from 'src/utils/config';
import { AssetFactory } from 'test/factories/asset.factory';
import { AuthFactory } from 'test/factories/auth.factory';
import { authStub } from 'test/fixtures/auth.stub';
import { getForAsset } from 'test/mappers';
import { newUuid } from 'test/small.factory';
import { newTestService, ServiceMocks } from 'test/utils';
import { beforeEach, describe, expect, it, vitest } from 'vitest';

vitest.useFakeTimers();

describe(SearchService.name, () => {
  let sut: SearchService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(SearchService));
    mocks.partner.getAll.mockResolvedValue([]);
    (mocks.faceIdentity as any).resolveScopedPersonTokens ??= vitest.fn();
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
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);
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

    // #867: the Explore "Places" strip was owner-scoped, so a space member saw no tile for a city
    // that only exists on assets shared with them. Scope it like every other home surface: own
    // assets plus the spaces the member kept in their timeline.
    it('scopes explore cities to the viewer plus their timeline-enabled shared spaces', async () => {
      const auth = AuthFactory.create();
      const spaceId = newUuid();
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
      mocks.asset.getAssetIdByCity.mockResolvedValue({ fieldName: 'exifInfo.city', items: [] });
      mocks.asset.getRecentlyCreatedAssetIds.mockResolvedValue({ fieldName: 'createdAt', items: [] });
      mocks.asset.getByIdsWithAllRelationsButStacks.mockResolvedValue([]);

      await sut.getExploreData(auth);

      expect(mocks.sharedSpace.getSpaceIdsForTimeline).toHaveBeenCalledWith(auth.user.id);
      expect(mocks.asset.getAssetIdByCity).toHaveBeenCalledWith(
        auth.user.id,
        expect.objectContaining({ timelineSpaceIds: [spaceId] }),
      );
    });

    it('leaves the city scope owner-only when the viewer has no timeline-enabled spaces', async () => {
      const auth = AuthFactory.create();
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);
      mocks.asset.getAssetIdByCity.mockResolvedValue({ fieldName: 'exifInfo.city', items: [] });
      mocks.asset.getRecentlyCreatedAssetIds.mockResolvedValue({ fieldName: 'createdAt', items: [] });
      mocks.asset.getByIdsWithAllRelationsButStacks.mockResolvedValue([]);

      await sut.getExploreData(auth);

      expect(mocks.asset.getAssetIdByCity).toHaveBeenCalledWith(auth.user.id, {
        maxFields: 12,
        minAssetsPerField: 5,
        timelineSpaceIds: undefined,
      });
    });

    // The "recently added" strip stays owner-scoped on purpose — it answers "what did *I* just
    // add", and /recently-added itself is an owner surface.
    it('leaves the recently-added strip owner-scoped', async () => {
      const auth = AuthFactory.create();
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId: newUuid() }]);
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

    it('resolves scoped person tokens before global search suggestions', async () => {
      const spaceId = newUuid();
      const token = `space-person:${newUuid()}`;
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
      (mocks.faceIdentity as any).resolveScopedPersonTokens.mockResolvedValue({
        identityIds: ['00000000-0000-4000-8000-000000000010'],
        legacyPersonIds: [],
        legacySpacePersonIds: [],
        hasInaccessibleToken: false,
      });
      mocks.search.getCities.mockResolvedValue(['Berlin']);

      await sut.getSearchSuggestions(authStub.user1, {
        includeNull: false,
        type: SearchSuggestionType.CITY,
        withSharedSpaces: true,
        personIds: [token],
      });

      expect((mocks.faceIdentity as any).resolveScopedPersonTokens).toHaveBeenCalledWith({
        userId: authStub.user1.user.id,
        tokens: [token],
        scope: { withSharedSpaces: true, timelineSpaceIds: [spaceId], spaceId: undefined },
      });
      expect(mocks.search.getCities).toHaveBeenCalledWith(
        [authStub.user1.user.id],
        expect.objectContaining({
          identityIds: ['00000000-0000-4000-8000-000000000010'],
          personIds: [],
        }),
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
        mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);
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

      it('checks album access and passes timelineSpaceIds to getSearchSuggestions', async () => {
        const albumId = newUuid();
        const spaceId = newUuid();
        mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
        mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([albumId]));
        mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
        mocks.search.getCountries.mockResolvedValue(['Germany']);

        await sut.getSearchSuggestions(authStub.user1, { type: SearchSuggestionType.COUNTRY, albumId });

        expect(mocks.sharedSpace.getSpaceIdsForTimeline).toHaveBeenCalledWith(authStub.user1.user.id);
        expect(mocks.search.getCountries).toHaveBeenCalledWith(
          [authStub.user1.user.id],
          expect.objectContaining({ albumId, timelineSpaceIds: [spaceId] }),
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

      it('should fetch timeline space IDs when withSharedSpaces is true', async () => {
        const spaceId1 = newUuid();
        const spaceId2 = newUuid();
        mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId: spaceId1 }, { spaceId: spaceId2 }]);
        mocks.search.getCountries.mockResolvedValue(['Germany', 'France']);

        const result = await sut.getSearchSuggestions(authStub.user1, {
          type: SearchSuggestionType.COUNTRY,
          withSharedSpaces: true,
        });

        expect(result).toEqual(['Germany', 'France']);
        expect(mocks.sharedSpace.getSpaceIdsForTimeline).toHaveBeenCalledWith(authStub.user1.user.id);
        expect(mocks.search.getCountries).toHaveBeenCalledWith(
          [authStub.user1.user.id],
          expect.objectContaining({ timelineSpaceIds: [spaceId1, spaceId2] }),
        );
      });

      it('should fall back to owner-only when withSharedSpaces is true but user has no spaces', async () => {
        mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);
        mocks.search.getCountries.mockResolvedValue(['USA']);

        const result = await sut.getSearchSuggestions(authStub.user1, {
          type: SearchSuggestionType.COUNTRY,
          withSharedSpaces: true,
        });

        expect(result).toEqual(['USA']);
        expect(mocks.search.getCountries).toHaveBeenCalledWith(
          [authStub.user1.user.id],
          expect.objectContaining({ timelineSpaceIds: undefined }),
        );
      });

      it('should preserve existing behavior when withSharedSpaces is absent', async () => {
        mocks.search.getCountries.mockResolvedValue(['USA']);

        await sut.getSearchSuggestions(authStub.user1, {
          type: SearchSuggestionType.COUNTRY,
        });

        expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
      });

      it('should preserve existing behavior when withSharedSpaces is explicitly false', async () => {
        mocks.search.getCountries.mockResolvedValue(['USA']);

        await sut.getSearchSuggestions(authStub.user1, {
          type: SearchSuggestionType.COUNTRY,
          withSharedSpaces: false,
        });

        expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
      });

      it('should pass timelineSpaceIds through to camera make suggestions', async () => {
        const spaceId1 = newUuid();
        mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId: spaceId1 }]);
        mocks.search.getCameraMakes.mockResolvedValue(['Nikon']);

        await sut.getSearchSuggestions(authStub.user1, {
          type: SearchSuggestionType.CAMERA_MAKE,
          withSharedSpaces: true,
        });

        expect(mocks.search.getCameraMakes).toHaveBeenCalledWith(
          [authStub.user1.user.id],
          expect.objectContaining({ timelineSpaceIds: [spaceId1] }),
        );
      });
    });
  });

  describe('new shape routing', () => {
    it('should route a filter request to the V3 search and a flat request to the legacy search', async () => {
      const auth = AuthFactory.create();

      mocks.search.searchMetadataV3.mockResolvedValue({ hasNextPage: false, items: [] });
      await sut.searchMetadata(auth, { size: 250, filter: {} });
      expect(mocks.search.searchMetadataV3).toHaveBeenCalled();
      expect(mocks.search.searchMetadata).not.toHaveBeenCalled();

      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });
      await sut.searchMetadata(auth, { size: 250, city: 'Oslo' });
      expect(mocks.search.searchMetadata).toHaveBeenCalled();
    });

    it('should route statistics, random, and smart filter requests to their V3 search', async () => {
      const auth = AuthFactory.create();

      mocks.search.searchStatisticsV3.mockResolvedValue({ total: 0 });
      await expect(sut.searchStatistics(auth, { filter: {} })).resolves.toEqual({ total: 0 });

      mocks.search.searchRandomV3.mockResolvedValue([]);
      await expect(sut.searchRandom(auth, { size: 250, filter: {} })).resolves.toEqual([]);

      mocks.search.searchSmartV3.mockResolvedValue({ hasNextPage: false, items: [] });
      mocks.machineLearning.encodeText.mockResolvedValue('[1, 2, 3]');
      await sut.searchSmart(auth, { size: 100, filter: {}, query: 'test' });
      expect(mocks.search.searchSmartV3).toHaveBeenCalledWith(
        { take: 100 },
        expect.objectContaining({ embedding: '[1, 2, 3]' }),
        expect.objectContaining({ lockedOwnerId: expect.any(String) }),
      );
    });

    it('should reject an invalid cursor', async () => {
      await expect(sut.searchMetadata(AuthFactory.create(), { size: 250, cursor: '???' })).rejects.toThrowError(
        new BadRequestException('Invalid cursor'),
      );
    });

    it('should reject an unelevated session whose filter could match locked assets', async () => {
      const filter = { visibility: { in: [AssetVisibility.Locked, AssetVisibility.Timeline] } };
      await expect(sut.searchMetadata(AuthFactory.create(), { size: 250, filter })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('should reject a shared link whose filter is not confined to albums everywhere', async () => {
      const auth = AuthFactory.from().sharedLink().build();
      const albumId = newUuid();

      await expect(sut.searchMetadata(auth, { size: 250, filter: {} })).rejects.toThrowError(
        new BadRequestException('Shared link access is only allowed in combination with an albumIds filter'),
      );

      await expect(
        sut.searchMetadata(auth, {
          size: 250,
          filter: { or: [{ albumIds: { any: [albumId] } }, { city: { eq: 'Oslo' } }] },
        }),
      ).rejects.toThrowError(
        new BadRequestException('Shared link access is only allowed in combination with an albumIds filter'),
      );
    });

    it('should allow a shared link when every branch is confined to a covered album', async () => {
      const auth = AuthFactory.from().sharedLink().build();
      const albumId = newUuid();

      mocks.access.album.checkSharedLinkAccess.mockResolvedValue(new Set([albumId]));
      mocks.search.searchMetadataV3.mockResolvedValue({ hasNextPage: false, items: [] });

      await expect(
        sut.searchMetadata(auth, { size: 250, filter: { or: [{ albumIds: { any: [albumId] } }] } }),
      ).resolves.toBeDefined();
      expect(mocks.search.searchMetadataV3).toHaveBeenCalled();
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
      await sut.searchSmart(authStub.user1, { query: 'test' });
      await sut.searchSmart(authStub.user1, { query: 'test' });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledTimes(1);
    });

    it('should not use cache for different queries', async () => {
      await sut.searchSmart(authStub.user1, { query: 'test1' });
      await sut.searchSmart(authStub.user1, { query: 'test2' });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledTimes(2);
    });

    // Regression guard: searchSmart must read config from cache, not rebuild it per
    // request. The uncached path runs class-transformer + class-validator over the
    // full nested SystemConfigDto and adds ~1-3s per call on slower CPUs.
    it('should read system config from cache across requests', async () => {
      await sut.searchSmart(authStub.user1, { query: 'test1' });
      await sut.searchSmart(authStub.user1, { query: 'test2' });
      await sut.searchSmart(authStub.user1, { query: 'test3' });

      expect(mocks.systemMetadata.get).toHaveBeenCalledTimes(1);
    });

    it('should search by queryAssetId instead of query', async () => {
      const assetId = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      mocks.search.getEmbedding.mockResolvedValue('[4, 5, 6]');

      await sut.searchSmart(authStub.user1, { queryAssetId: assetId });

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

      await expect(sut.searchSmart(authStub.user1, { queryAssetId: assetId })).rejects.toThrow(
        `Asset ${assetId} has no embedding`,
      );
    });

    it('should throw if neither query nor queryAssetId is set', async () => {
      await expect(sut.searchSmart(authStub.user1, {})).rejects.toThrow('Either `query` or `queryAssetId` must be set');
    });

    it('should return nextPage when there are more results', async () => {
      mocks.search.searchSmart.mockResolvedValue({ hasNextPage: true, items: [] });

      const result = await sut.searchSmart(authStub.user1, { query: 'test', page: 1 });

      expect(result.assets.nextPage).toEqual('2');
    });

    it('should return null nextPage when there are no more results', async () => {
      mocks.search.searchSmart.mockResolvedValue({ hasNextPage: false, items: [] });

      const result = await sut.searchSmart(authStub.user1, { query: 'test' });

      expect(result.assets.nextPage).toBeNull();
    });

    describe('shared space access (spaceId)', () => {
      it('should check shared space access when spaceId is provided', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));

        await sut.searchSmart(authStub.user1, { query: 'test', spaceId });

        expect(mocks.access.sharedSpace.checkMemberAccess).toHaveBeenCalledWith(
          authStub.user1.user.id,
          new Set([spaceId]),
        );
      });

      it('should pass spaceId through to search repository', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));

        await sut.searchSmart(authStub.user1, { query: 'test', spaceId });

        expect(mocks.search.searchSmart).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ spaceId }));
      });

      it('should not check space access when spaceId is not provided', async () => {
        await sut.searchSmart(authStub.user1, { query: 'test' });

        expect(mocks.access.sharedSpace.checkMemberAccess).not.toHaveBeenCalled();
      });

      it('should throw when user is not a space member', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set());

        await expect(sut.searchSmart(authStub.user1, { query: 'test', spaceId })).rejects.toThrow();
      });

      it('should reject spacePersonIds when spaceId is not set', async () => {
        await expect(sut.searchSmart(authStub.user1, { query: 'test', spacePersonIds: [newUuid()] })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should pass spacePersonIds through to repository', async () => {
        const spaceId = newUuid();
        const spacePersonIds = [newUuid(), newUuid()];
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));

        await sut.searchSmart(authStub.user1, { query: 'test', spaceId, spacePersonIds });

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
          sut.searchSmart(authStub.user1, {
            query: 'test',
            spaceId: newUuid(),
            withSharedSpaces: true,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          sut.searchSmart(authStub.user1, {
            query: 'test',
            spaceId: newUuid(),
            withSharedSpaces: true,
          }),
        ).rejects.toThrow('Cannot use both spaceId and withSharedSpaces');
      });

      it('should fetch timeline space IDs and pass them through when withSharedSpaces is true', async () => {
        const spaceId1 = newUuid();
        const spaceId2 = newUuid();
        mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId: spaceId1 }, { spaceId: spaceId2 }]);

        await sut.searchSmart(authStub.user1, { query: 'test', withSharedSpaces: true });

        expect(mocks.sharedSpace.getSpaceIdsForTimeline).toHaveBeenCalledWith(authStub.user1.user.id);
        expect(mocks.search.searchSmart).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ timelineSpaceIds: [spaceId1, spaceId2] }),
        );
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
        mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);

        await sut.searchSmart(authStub.user1, { queryAssetId: assetId, withSharedSpaces: true });

        expect(mocks.search.getEmbedding).toHaveBeenCalledWith(assetId);
        expect(mocks.search.searchSmart).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ embedding: '[4, 5, 6]', timelineSpaceIds: [spaceId] }),
        );
      });

      it('should fall back to owner-only when withSharedSpaces is true but user has no spaces', async () => {
        mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);

        await sut.searchSmart(authStub.user1, { query: 'test', withSharedSpaces: true });

        expect(mocks.sharedSpace.getSpaceIdsForTimeline).toHaveBeenCalledWith(authStub.user1.user.id);
        expect(mocks.search.searchSmart).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ timelineSpaceIds: undefined }),
        );
      });

      it('should not call getSpaceIdsForTimeline when withSharedSpaces is absent', async () => {
        await sut.searchSmart(authStub.user1, { query: 'test' });

        expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
      });

      it('should not call getSpaceIdsForTimeline when withSharedSpaces is explicitly false', async () => {
        await sut.searchSmart(authStub.user1, { query: 'test', withSharedSpaces: false });

        expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
      });

      it('should not call getSpaceIdsForTimeline when spaceId is set', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));

        await sut.searchSmart(authStub.user1, { query: 'test', spaceId });

        expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
      });

      it('should still reject spacePersonIds without spaceId when withSharedSpaces is true', async () => {
        await expect(
          sut.searchSmart(authStub.user1, {
            query: 'test',
            withSharedSpaces: true,
            spacePersonIds: [newUuid()],
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('resolves scoped person tokens before smart search', async () => {
        const spaceId = newUuid();
        const token = `space-person:${newUuid()}`;
        mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
        (mocks.faceIdentity as any).resolveScopedPersonTokens.mockResolvedValue({
          identityIds: ['00000000-0000-4000-8000-000000000030'],
          legacyPersonIds: [],
          legacySpacePersonIds: [],
          hasInaccessibleToken: false,
        });

        await sut.searchSmart(authStub.user1, { query: 'test', withSharedSpaces: true, personIds: [token] });

        expect(mocks.search.searchSmart).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            identityIds: ['00000000-0000-4000-8000-000000000030'],
            personIds: [],
          }),
        );
      });

      it('fetches timeline space IDs when albumIds are set for smart search', async () => {
        const albumId = newUuid();
        const spaceId = newUuid();
        mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);

        await sut.searchSmart(authStub.user1, { query: 'test', albumIds: [albumId] });

        expect(mocks.sharedSpace.getSpaceIdsForTimeline).toHaveBeenCalledWith(authStub.user1.user.id);
        expect(mocks.search.searchSmart).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ albumIds: [albumId], timelineSpaceIds: [spaceId] }),
        );
      });
    });

    it('should pass orderDirection when order is set', async () => {
      await sut.searchSmart(authStub.user1, { query: 'test', order: AssetOrder.Desc });

      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        { page: 1, size: 100 },
        expect.objectContaining({ orderDirection: AssetOrder.Desc }),
      );
    });

    it('should not pass orderDirection when order is not set', async () => {
      await sut.searchSmart(authStub.user1, { query: 'test' });

      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        { page: 1, size: 100 },
        expect.objectContaining({ orderDirection: undefined }),
      );
    });

    it('should pass maxDistance from config to repository', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { clip: { maxDistance: 0.75 } },
      });

      await sut.searchSmart(authStub.user1, { query: 'test' });

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

      await sut.searchSmart(authStub.user1, { queryAssetId: assetId });

      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxDistance: 0.75 }),
      );
    });

    it('should pass maxDistance 0 (disabled) by default', async () => {
      await sut.searchSmart(authStub.user1, { query: 'test' });

      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxDistance: 0 }),
      );
    });

    it('should pass maxDistance 2 from config to repository', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { clip: { maxDistance: 2 } },
      });

      await sut.searchSmart(authStub.user1, { query: 'test' });

      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxDistance: 2 }),
      );
    });

    it('should pass maxDistance with orderDirection when both are set', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { clip: { maxDistance: 0.75 } },
      });

      await sut.searchSmart(authStub.user1, { query: 'test', order: AssetOrder.Desc });

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

      await sut.searchSmart(authStub.user1, { query: 'test' });
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

    it('passes timeline shared spaces when withSharedSpaces is true', async () => {
      const spaceId1 = newUuid();
      const spaceId2 = newUuid();
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId: spaceId1 }, { spaceId: spaceId2 }]);

      await sut.searchSmartFacets(authStub.user1, { query: 'test', withSharedSpaces: true });

      expect(mocks.sharedSpace.getSpaceIdsForTimeline).toHaveBeenCalledWith(authStub.user1.user.id);
      expect(mocks.search.getSmartSearchFacets).toHaveBeenCalledWith(
        expect.objectContaining({ timelineSpaceIds: [spaceId1, spaceId2] }),
      );
    });

    it('resolves inaccessible scoped tokens to an empty smart-facet result set', async () => {
      const token = `space-person:${newUuid()}`;
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);
      (mocks.faceIdentity as any).resolveScopedPersonTokens.mockResolvedValue({
        identityIds: [],
        legacyPersonIds: [],
        legacySpacePersonIds: [],
        hasInaccessibleToken: true,
      });

      await sut.searchSmartFacets(authStub.user1, { query: 'test', withSharedSpaces: true, personIds: [token] });

      expect(mocks.search.getSmartSearchFacets).toHaveBeenCalledWith(
        expect.objectContaining({ forceEmptyResult: true }),
      );
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
    it('should search metadata with default pagination', async () => {
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

      const result = await sut.searchMetadata(authStub.user1, {});

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

      const result = await sut.searchMetadata(authStub.user1, { page: 2 });

      expect(result.assets.nextPage).toEqual('3');
    });

    it('should decode hex checksum', async () => {
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });
      const hexChecksum = 'abcdef1234567890abcdef1234567890abcdef12';

      await sut.searchMetadata(authStub.user1, { checksum: hexChecksum });

      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ checksum: Buffer.from(hexChecksum, 'hex') }),
      );
    });

    it('should decode base64 checksum (28 characters)', async () => {
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });
      // SHA1 hash in base64 is exactly 28 characters
      const base64Checksum = 'q83vEjRWeJCrze8SNFZ4kKvN7xI=';

      await sut.searchMetadata(authStub.user1, { checksum: base64Checksum });

      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ checksum: Buffer.from(base64Checksum, 'base64') }),
      );
    });

    it('should throw for locked visibility without elevated permission', async () => {
      const auth = AuthFactory.create();

      await expect(sut.searchMetadata(auth, { visibility: AssetVisibility.Locked })).rejects.toThrow(
        'Elevated permission is required',
      );
    });

    describe('shared space access (spaceId)', () => {
      it('should check shared space access when spaceId is provided', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
        mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

        await sut.searchMetadata(authStub.user1, { spaceId });

        expect(mocks.access.sharedSpace.checkMemberAccess).toHaveBeenCalledWith(
          authStub.user1.user.id,
          new Set([spaceId]),
        );
      });

      it('should pass spaceId through to search repository', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
        mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

        await sut.searchMetadata(authStub.user1, { spaceId });

        expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ spaceId }),
        );
      });

      it('should not check space access when spaceId is not provided', async () => {
        mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

        await sut.searchMetadata(authStub.user1, {});

        expect(mocks.access.sharedSpace.checkMemberAccess).not.toHaveBeenCalled();
      });

      it('should throw when user is not a space member', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set());

        await expect(sut.searchMetadata(authStub.user1, { spaceId })).rejects.toThrow();
      });
    });

    it('passes timelineSpaceIds for album-scoped searchMetadata', async () => {
      const albumId = newUuid();
      const spaceId = newUuid();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

      await sut.searchMetadata(authStub.user1, { albumIds: [albumId] });

      expect(mocks.sharedSpace.getSpaceIdsForTimeline).toHaveBeenCalledWith(authStub.user1.user.id);
      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ albumIds: [albumId], timelineSpaceIds: [spaceId] }),
      );
    });

    // testq-4: the test above was rebased-in with checkOwnerAccess granting the actor OWNER access to
    // the album (needed to satisfy #29352's requireAccess(AlbumRead) gate), which lost coverage of the
    // space-MEMBER path (checkSharedAlbumAccess, not checkOwnerAccess) — the actor who most needs the
    // person-filter guard below, since they don't own the album's assets. A member combining albumIds
    // with personIds must not be able to bypass person-filter RBAC: resolveScopedPersonFilters routes
    // every personIds token through faceIdentityRepository.resolveScopedPersonTokens whenever albumIds
    // is set (isGlobalSharedScope), and an inaccessible token forces the whole search empty.
    it('forces an empty result for a space-member actor who person-filters an album-scoped search with an inaccessible token', async () => {
      const albumId = newUuid();
      const spaceId = newUuid();
      const personId = newUuid();
      // Member access via the album's own share grant, NOT ownership.
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([albumId]));
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });
      (mocks.faceIdentity as any).resolveScopedPersonTokens.mockResolvedValue({
        identityIds: [],
        legacyPersonIds: [],
        legacySpacePersonIds: [],
        hasInaccessibleToken: true,
      });

      await sut.searchMetadata(authStub.user1, { albumIds: [albumId], personIds: [personId] });

      expect(mocks.access.album.checkSharedAlbumAccess).toHaveBeenCalled();
      expect((mocks.faceIdentity as any).resolveScopedPersonTokens).toHaveBeenCalledWith({
        userId: authStub.user1.user.id,
        tokens: [personId],
        scope: { withSharedSpaces: true, timelineSpaceIds: [spaceId], spaceId: undefined },
      });
      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ forceEmptyResult: true }),
      );
    });

    it('deduplicates resolved scoped person filters before repository search', async () => {
      const token = `person:${newUuid()}`;
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });
      (mocks.faceIdentity as any).resolveScopedPersonTokens.mockResolvedValue({
        identityIds: ['00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000010'],
        legacyPersonIds: ['00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000020'],
        legacySpacePersonIds: ['00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000030'],
        hasInaccessibleToken: false,
      });

      await sut.searchMetadata(authStub.user1, { withSharedSpaces: true, personIds: [token, token] });

      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          identityIds: ['00000000-0000-4000-8000-000000000010'],
          personIds: ['00000000-0000-4000-8000-000000000020'],
          spacePersonIds: ['00000000-0000-4000-8000-000000000030'],
        }),
      );
    });

    // ownerId is a narrowing contributor filter (searchAssetBuilder applies it as a standalone AND
    // on asset.ownerId). It must reach the repository as its own field and must NOT be merged into
    // userIds, which is the owner SCOPING predicate — merging it there would widen the result set
    // (a data leak) instead of narrowing it.
    it('passes ownerId through to the search repository as its own field, not merged into userIds', async () => {
      const ownerId = newUuid();
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

      await sut.searchMetadata(authStub.user1, { ownerId });

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

    it('passes timelineSpaceIds for album-scoped searchStatistics', async () => {
      const albumId = newUuid();
      const spaceId = newUuid();
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
      mocks.search.searchStatistics.mockResolvedValue({ total: 0 } as any);

      await sut.searchStatistics(authStub.user1, { albumIds: [albumId] });

      expect(mocks.search.searchStatistics).toHaveBeenCalledWith(
        expect.objectContaining({ albumIds: [albumId], timelineSpaceIds: [spaceId] }),
      );
    });
  });

  describe('searchRandom', () => {
    it('should search random assets', async () => {
      const asset = AssetFactory.from().build();
      mocks.search.searchRandom.mockResolvedValue([asset as any]);

      const result = await sut.searchRandom(authStub.user1, {});

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

      await sut.searchRandom(auth, {});

      const opts = mocks.search.searchRandom.mock.calls[0][1];
      expect(opts.visibility).toBe('not-locked');
    });

    it('resolves visibility to undefined for an elevated session', async () => {
      const auth = AuthFactory.from().session({ hasElevatedPermission: true }).build();
      mocks.search.searchRandom.mockResolvedValue([]);

      await sut.searchRandom(auth, {});

      const opts = mocks.search.searchRandom.mock.calls[0][1];
      expect(opts).toHaveProperty('visibility');
      expect(opts.visibility).toBeUndefined();
    });

    it('passes an explicit visibility through unchanged', async () => {
      const auth = AuthFactory.from().session().build();
      mocks.search.searchRandom.mockResolvedValue([]);

      await sut.searchRandom(auth, { visibility: AssetVisibility.Archive });

      const opts = mocks.search.searchRandom.mock.calls[0][1];
      expect(opts.visibility).toBe(AssetVisibility.Archive);
    });

    it('treats a no-session auth (api key / shared link) as not-locked', async () => {
      const auth = AuthFactory.create();
      mocks.search.searchRandom.mockResolvedValue([]);

      await sut.searchRandom(auth, {});

      const opts = mocks.search.searchRandom.mock.calls[0][1];
      expect(opts.visibility).toBe('not-locked');
    });

    it('should throw for locked visibility without elevated permission', async () => {
      const auth = AuthFactory.create();

      await expect(sut.searchRandom(auth, { visibility: AssetVisibility.Locked })).rejects.toThrow(
        'Elevated permission is required',
      );
    });

    describe('shared space access (spaceId)', () => {
      it('should check shared space access when spaceId is provided', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
        mocks.search.searchRandom.mockResolvedValue([]);

        await sut.searchRandom(authStub.user1, { spaceId });

        expect(mocks.access.sharedSpace.checkMemberAccess).toHaveBeenCalledWith(
          authStub.user1.user.id,
          new Set([spaceId]),
        );
        expect(mocks.search.searchRandom).toHaveBeenCalledWith(250, expect.objectContaining({ spaceId }));
      });

      it('should not check space access when spaceId is not provided', async () => {
        mocks.search.searchRandom.mockResolvedValue([]);

        await sut.searchRandom(authStub.user1, {});

        expect(mocks.access.sharedSpace.checkMemberAccess).not.toHaveBeenCalled();
      });

      it('should throw when user is not a space member', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set());

        await expect(sut.searchRandom(authStub.user1, { spaceId })).rejects.toThrow();
      });
    });

    it('passes timelineSpaceIds for album-scoped searchRandom', async () => {
      const albumId = newUuid();
      const spaceId = newUuid();
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
      mocks.search.searchRandom.mockResolvedValue([]);

      await sut.searchRandom(authStub.user1, { albumIds: [albumId] });

      expect(mocks.search.searchRandom).toHaveBeenCalledWith(
        250,
        expect.objectContaining({ albumIds: [albumId], timelineSpaceIds: [spaceId] }),
      );
    });
  });

  describe('searchLargeAssets', () => {
    it('should search large assets', async () => {
      const asset = AssetFactory.from().build();
      mocks.search.searchLargeAssets.mockResolvedValue([asset as any]);

      const result = await sut.searchLargeAssets(authStub.user1, {});

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

      await expect(sut.searchLargeAssets(auth, { visibility: AssetVisibility.Locked })).rejects.toThrow(
        'Elevated permission is required',
      );
    });

    describe('shared space access (spaceId)', () => {
      it('should check shared space access when spaceId is provided', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
        mocks.search.searchLargeAssets.mockResolvedValue([]);

        await sut.searchLargeAssets(authStub.user1, { spaceId });

        expect(mocks.access.sharedSpace.checkMemberAccess).toHaveBeenCalledWith(
          authStub.user1.user.id,
          new Set([spaceId]),
        );
        expect(mocks.search.searchLargeAssets).toHaveBeenCalledWith(250, expect.objectContaining({ spaceId }));
      });

      it('should not check space access when spaceId is not provided', async () => {
        mocks.search.searchLargeAssets.mockResolvedValue([]);

        await sut.searchLargeAssets(authStub.user1, {});

        expect(mocks.access.sharedSpace.checkMemberAccess).not.toHaveBeenCalled();
      });

      it('should throw when user is not a space member', async () => {
        const spaceId = newUuid();
        mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set());

        await expect(sut.searchLargeAssets(authStub.user1, { spaceId })).rejects.toThrow();
      });
    });

    it('passes timelineSpaceIds for album-scoped searchLargeAssets', async () => {
      const albumId = newUuid();
      const spaceId = newUuid();
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
      mocks.search.searchLargeAssets.mockResolvedValue([]);

      await sut.searchLargeAssets(authStub.user1, { albumIds: [albumId] });

      expect(mocks.search.searchLargeAssets).toHaveBeenCalledWith(
        250,
        expect.objectContaining({ albumIds: [albumId], timelineSpaceIds: [spaceId] }),
      );
    });
  });

  describe('H-1: trash / offline params rejected under a shared-space scope', () => {
    const runners: Array<{ name: string; run: (dto: Record<string, unknown>) => Promise<unknown> }> = [
      { name: 'searchMetadata', run: (dto) => sut.searchMetadata(authStub.user1, dto) },
      { name: 'searchRandom', run: (dto) => sut.searchRandom(authStub.user1, dto) },
      { name: 'searchLargeAssets', run: (dto) => sut.searchLargeAssets(authStub.user1, dto) },
      { name: 'searchStatistics', run: (dto) => sut.searchStatistics(authStub.user1, dto) },
      { name: 'searchSmart', run: (dto) => sut.searchSmart(authStub.user1, { query: 'test', ...dto }) },
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

      await expect(sut.searchMetadata(authStub.user1, { spaceId })).resolves.toBeDefined();
    });

    it('does not reject withDeleted outside a space scope (searchMetadata)', async () => {
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

      await expect(sut.searchMetadata(authStub.user1, { withDeleted: true })).resolves.toBeDefined();
    });

    it('does not over-block isOffline=false under a space scope (searchMetadata)', async () => {
      const spaceId = newUuid();
      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

      await expect(sut.searchMetadata(authStub.user1, { spaceId, isOffline: false })).resolves.toBeDefined();
    });
  });

  describe('getAssetsByCity', () => {
    it('should get assets by city', async () => {
      const asset = AssetFactory.from().build();
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);
      mocks.search.getAssetsByCity.mockResolvedValue([asset as any]);

      const result = await sut.getAssetsByCity(authStub.user1);

      expect(mocks.search.getAssetsByCity).toHaveBeenCalledWith([authStub.user1.user.id], undefined);
      expect(result).toHaveLength(1);
    });

    // #867: /places is the "view all" of the same Explore strip, so it gets the same scope.
    it('scopes the places page to the viewer plus their timeline-enabled shared spaces', async () => {
      const spaceId = newUuid();
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
      mocks.search.getAssetsByCity.mockResolvedValue([]);

      await sut.getAssetsByCity(authStub.user1);

      expect(mocks.sharedSpace.getSpaceIdsForTimeline).toHaveBeenCalledWith(authStub.user1.user.id);
      expect(mocks.search.getAssetsByCity).toHaveBeenCalledWith([authStub.user1.user.id], [spaceId]);
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
    };

    it('should return filter suggestions', async () => {
      const auth = AuthFactory.create();
      mocks.partner.getAll.mockResolvedValue([]);
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);
      mocks.search.getFilterSuggestions.mockResolvedValue({
        countries: ['Germany', 'France'],
        cameraMakes: ['Canon'],
        tags: [{ id: 't1', value: 'Vacation' }],
        people: [{ id: 'p1', name: 'Alice' }],
        ratings: [4, 5],
        mediaTypes: ['IMAGE', 'VIDEO'],
        hasUnnamedPeople: false,
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
      const spaceId = newUuid();
      const auth = AuthFactory.create();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([albumId]));
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
      mocks.search.getFilterSuggestions.mockResolvedValue({
        countries: ['Germany'],
        cameraMakes: ['Canon'],
        tags: [{ id: 'tag-1', value: 'Vacation' }],
        people: [{ id: 'person-1', name: 'Alice' }],
        ratings: [5],
        mediaTypes: ['IMAGE'],
        hasUnnamedPeople: false,
      });

      const result = await sut.getFilterSuggestions(auth, { albumId });

      expect(result.countries).toEqual(['Germany']);
      expect(mocks.access.album.checkOwnerAccess).toHaveBeenCalled();
      expect(mocks.access.album.checkSharedAlbumAccess).toHaveBeenCalled();
      expect(mocks.sharedSpace.getSpaceIdsForTimeline).toHaveBeenCalledWith(auth.user.id);
      expect(mocks.search.getFilterSuggestions).toHaveBeenCalledWith(
        [auth.user.id],
        expect.objectContaining({ albumId, timelineSpaceIds: [spaceId] }),
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

    it('validates album scoped space-person tokens using timeline-enabled shared-space scope', async () => {
      const auth = AuthFactory.create();
      const albumId = newUuid();
      const spaceId = newUuid();
      const token = `space-person:${newUuid()}`;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
      mocks.search.getFilterSuggestions.mockResolvedValue(emptyResult);
      (mocks.faceIdentity as any).resolveScopedPersonTokens.mockResolvedValue({
        identityIds: [],
        legacyPersonIds: [],
        legacySpacePersonIds: [],
        hasInaccessibleToken: true,
      });

      await sut.getFilterSuggestions(auth, { albumId, personIds: [token] });

      expect((mocks.faceIdentity as any).resolveScopedPersonTokens).toHaveBeenCalledWith({
        userId: auth.user.id,
        tokens: [token],
        scope: { withSharedSpaces: true, timelineSpaceIds: [spaceId], spaceId: undefined },
      });
      expect(mocks.search.getFilterSuggestions).toHaveBeenCalledWith(
        [auth.user.id],
        expect.objectContaining({ forceEmptyResult: true }),
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

    it('should resolve timelineSpaceIds when withSharedSpaces is set', async () => {
      const auth = AuthFactory.create();
      const spaceId = newUuid();
      mocks.partner.getAll.mockResolvedValue([]);
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
      mocks.search.getFilterSuggestions.mockResolvedValue(emptyResult);

      await sut.getFilterSuggestions(auth, { withSharedSpaces: true });

      expect(mocks.search.getFilterSuggestions).toHaveBeenCalledWith(
        [auth.user.id],
        expect.objectContaining({ timelineSpaceIds: [spaceId] }),
      );
    });

    it('resolves scoped person tokens before global filter suggestions', async () => {
      const auth = AuthFactory.create();
      const spaceId = newUuid();
      const token = `space-person:${newUuid()}`;
      mocks.partner.getAll.mockResolvedValue([]);
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
      (mocks.faceIdentity as any).resolveScopedPersonTokens.mockResolvedValue({
        identityIds: ['00000000-0000-4000-8000-000000000020'],
        legacyPersonIds: [],
        legacySpacePersonIds: [],
        hasInaccessibleToken: false,
      });
      (mocks.faceIdentity as any).getAccessiblePersonFilterSuggestions.mockResolvedValue({
        people: [{ id: token, name: 'Alice' }],
        hasUnnamedPeople: false,
      });
      mocks.search.getFilterSuggestions.mockResolvedValue(emptyResult);

      await sut.getFilterSuggestions(auth, { withSharedSpaces: true, personIds: [token] });

      expect((mocks.faceIdentity as any).resolveScopedPersonTokens).toHaveBeenCalledWith({
        userId: auth.user.id,
        tokens: [token],
        scope: { withSharedSpaces: true, timelineSpaceIds: [spaceId], spaceId: undefined },
      });
      expect(mocks.search.getFilterSuggestions).toHaveBeenCalledWith(
        [auth.user.id],
        expect.objectContaining({
          identityIds: ['00000000-0000-4000-8000-000000000020'],
          personIds: [],
        }),
      );
    });

    it('keeps bare UUID person filters as legacy personal person ids', async () => {
      const auth = AuthFactory.create();
      const personId = newUuid();
      mocks.partner.getAll.mockResolvedValue([]);
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);
      (mocks.faceIdentity as any).resolveScopedPersonTokens.mockResolvedValue({
        identityIds: [],
        legacyPersonIds: [personId],
        legacySpacePersonIds: [],
        hasInaccessibleToken: false,
      });
      (mocks.faceIdentity as any).getAccessiblePersonFilterSuggestions.mockResolvedValue({
        people: [],
        hasUnnamedPeople: false,
      });
      mocks.search.getFilterSuggestions.mockResolvedValue(emptyResult);

      await sut.getFilterSuggestions(auth, { withSharedSpaces: true, personIds: [personId] });

      expect(mocks.search.getFilterSuggestions).toHaveBeenCalledWith(
        [auth.user.id],
        expect.objectContaining({ personIds: [personId] }),
      );
    });

    it('returns empty people-filtered results for inaccessible scoped tokens', async () => {
      const auth = AuthFactory.create();
      const token = `space-person:${newUuid()}`;
      mocks.partner.getAll.mockResolvedValue([]);
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);
      (mocks.faceIdentity as any).resolveScopedPersonTokens.mockResolvedValue({
        identityIds: [],
        legacyPersonIds: [],
        legacySpacePersonIds: [],
        hasInaccessibleToken: true,
      });
      (mocks.faceIdentity as any).getAccessiblePersonFilterSuggestions.mockResolvedValue({
        people: [],
        hasUnnamedPeople: false,
      });
      mocks.search.getFilterSuggestions.mockResolvedValue(emptyResult);

      await sut.getFilterSuggestions(auth, { withSharedSpaces: true, personIds: [token] });

      expect(mocks.search.getFilterSuggestions).toHaveBeenCalledWith(
        [auth.user.id],
        expect.objectContaining({ forceEmptyResult: true }),
      );
    });

    it('does not resolve another users private person token through a shared identity', async () => {
      const auth = AuthFactory.create();
      const token = `person:${newUuid()}`;
      mocks.partner.getAll.mockResolvedValue([]);
      mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);
      (mocks.faceIdentity as any).resolveScopedPersonTokens.mockResolvedValue({
        identityIds: [],
        legacyPersonIds: [],
        legacySpacePersonIds: [],
        hasInaccessibleToken: true,
      });
      (mocks.faceIdentity as any).getAccessiblePersonFilterSuggestions.mockResolvedValue({
        people: [],
        hasUnnamedPeople: false,
      });
      mocks.search.getFilterSuggestions.mockResolvedValue(emptyResult);

      await sut.getFilterSuggestions(auth, { withSharedSpaces: true, personIds: [token] });

      expect(mocks.search.getFilterSuggestions).toHaveBeenCalledWith(
        [auth.user.id],
        expect.objectContaining({ forceEmptyResult: true }),
      );
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

      await sut.searchMetadata(authStub.user1, {});

      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ userIds: [authStub.user1.user.id, partnerId] }),
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
