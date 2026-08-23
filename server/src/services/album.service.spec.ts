import { BadRequestException } from '@nestjs/common';
import { BulkIdErrorReason } from 'src/dtos/asset-ids.response.dto';
import { AlbumUserRole, AssetOrder, UserMetadataKey } from 'src/enum';
import { AlbumService } from 'src/services/album.service';
import { AlbumUserFactory } from 'test/factories/album-user.factory';
import { AlbumFactory } from 'test/factories/album.factory';
import { AssetFactory } from 'test/factories/asset.factory';
import { AuthFactory } from 'test/factories/auth.factory';
import { UserFactory } from 'test/factories/user.factory';
import { authStub } from 'test/fixtures/auth.stub';
import { getForAlbum } from 'test/mappers';
import { newUuid } from 'test/small.factory';
import { newTestService, ServiceMocks } from 'test/utils';

describe(AlbumService.name, () => {
  let sut: AlbumService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(AlbumService));
    // #764 cross-owner contribution defaults: no denied asset is contributable / already contributed
    // unless a test opts in, so add/remove behave exactly as before for the non-space cases.
    mocks.sharedSpace.getContributableAssetSpaces.mockResolvedValue([]);
    mocks.album.getContributedAssetIds.mockResolvedValue(new Set());
    mocks.album.addContributedAssets.mockResolvedValue();
    mocks.album.removeContributedAssetIds.mockResolvedValue();
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('getNames', () => {
    it('returns owned + shared albums in one list', async () => {
      mocks.album.getOwnedNames.mockResolvedValue([
        {
          id: 'a1',
          albumName: 'Owned',
          albumThumbnailAssetId: null,
          assetCount: 0,
          startDate: null,
          endDate: null,
        },
      ] as any);
      mocks.album.getSharedNames.mockResolvedValue([
        {
          id: 'a2',
          albumName: 'Shared',
          albumThumbnailAssetId: null,
          assetCount: 0,
          startDate: null,
          endDate: null,
        },
      ] as any);

      const result = await sut.getNames(authStub.admin);

      expect(result).toHaveLength(2);
      expect(result.map((a) => a.id).toSorted()).toEqual(['a1', 'a2']);
      expect(mocks.album.getOwnedNames).toHaveBeenCalledWith(authStub.admin.user.id);
      expect(mocks.album.getSharedNames).toHaveBeenCalledWith(authStub.admin.user.id);
    });

    it('does NOT call updateThumbnails', async () => {
      mocks.album.getOwnedNames.mockResolvedValue([]);
      mocks.album.getSharedNames.mockResolvedValue([]);

      await sut.getNames(authStub.admin);

      expect(mocks.album.updateThumbnails).not.toHaveBeenCalled();
    });

    it('hardcodes shared=false on owned records and shared=true on shared records', async () => {
      mocks.album.getOwnedNames.mockResolvedValue([
        {
          id: 'a1',
          albumName: 'Owned',
          albumThumbnailAssetId: null,
          assetCount: 0,
          startDate: null,
          endDate: null,
        },
      ] as any);
      mocks.album.getSharedNames.mockResolvedValue([
        {
          id: 'a2',
          albumName: 'Shared',
          albumThumbnailAssetId: null,
          assetCount: 0,
          startDate: null,
          endDate: null,
        },
      ] as any);

      const result = await sut.getNames(authStub.admin);

      expect(result.find((r) => r.id === 'a1')?.shared).toBe(false);
      expect(result.find((r) => r.id === 'a2')?.shared).toBe(true);
    });
  });

  describe('getStatistics', () => {
    it('should get the album count', async () => {
      mocks.album.getAll.mockResolvedValue([]);
      await expect(sut.getStatistics(authStub.admin)).resolves.toEqual({
        owned: 0,
        shared: 0,
        notShared: 0,
      });

      expect(mocks.album.getAll).toHaveBeenCalledWith(authStub.admin.user.id, { isOwned: true });
      expect(mocks.album.getAll).toHaveBeenCalledWith(authStub.admin.user.id, { isShared: true });
      expect(mocks.album.getAll).toHaveBeenCalledWith(authStub.admin.user.id, { isOwned: true, isShared: false });
    });
  });

  describe('getMapMarkers', () => {
    const albumMarkers = [
      {
        id: '0a8b6c1d-0000-4000-8000-000000000001',
        lat: 48.2082,
        lon: 16.3738,
        city: 'Vienna',
        state: 'Vienna',
        country: 'Austria',
      },
    ];

    // Regression test for #656: a Viewer-role member of a shared album must see
    // pins for every geotagged asset in the album, even though those assets are
    // owned by the album owner (a different user), not the viewer.
    it('returns all album markers for a viewer regardless of asset owner', async () => {
      const auth = AuthFactory.create();
      const albumId = newUuid();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([albumId]));
      mocks.map.getAlbumMapMarkers.mockResolvedValue(albumMarkers);

      await expect(sut.getMapMarkers(auth, albumId)).resolves.toEqual(albumMarkers);

      expect(mocks.map.getAlbumMapMarkers).toHaveBeenCalledWith(albumId);
      expect(mocks.partner.getAll).not.toHaveBeenCalled();
      expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
    });

    it('returns all album markers for the album owner', async () => {
      const auth = AuthFactory.create();
      const albumId = newUuid();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.map.getAlbumMapMarkers.mockResolvedValue(albumMarkers);

      await expect(sut.getMapMarkers(auth, albumId)).resolves.toEqual(albumMarkers);

      expect(mocks.map.getAlbumMapMarkers).toHaveBeenCalledWith(albumId);
      expect(mocks.partner.getAll).not.toHaveBeenCalled();
      expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
    });

    it('throws when the user has no album read access', async () => {
      const auth = AuthFactory.create();
      const albumId = newUuid();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set());

      await expect(sut.getMapMarkers(auth, albumId)).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.map.getAlbumMapMarkers).not.toHaveBeenCalled();
    });

    it('returns an empty list for shared links without showExif', async () => {
      const auth = AuthFactory.from().sharedLink({ showExif: false }).build();
      const albumId = newUuid();
      mocks.access.album.checkSharedLinkAccess.mockResolvedValue(new Set([albumId]));

      await expect(sut.getMapMarkers(auth, albumId)).resolves.toEqual([]);

      expect(mocks.map.getAlbumMapMarkers).not.toHaveBeenCalled();
    });

    it('returns all album markers for shared links with showExif', async () => {
      const auth = AuthFactory.from().sharedLink({ showExif: true }).build();
      const albumId = newUuid();
      mocks.access.album.checkSharedLinkAccess.mockResolvedValue(new Set([albumId]));
      mocks.map.getAlbumMapMarkers.mockResolvedValue(albumMarkers);

      await expect(sut.getMapMarkers(auth, albumId)).resolves.toEqual(albumMarkers);

      expect(mocks.partner.getAll).not.toHaveBeenCalled();
      expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
      expect(mocks.map.getAlbumMapMarkers).toHaveBeenCalledWith(albumId);
    });
  });

  describe('getAll', () => {
    it('gets list of albums for auth user', async () => {
      const album = AlbumFactory.from().albumUser().build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const sharedWithUserAlbum = AlbumFactory.from().owner(owner).albumUser().build();
      mocks.album.getAll.mockResolvedValue([getForAlbum(album), getForAlbum(sharedWithUserAlbum)]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        {
          albumId: album.id,
          assetCount: 0,
          startDate: null,
          endDate: null,
          lastModifiedAssetTimestamp: null,
        },
        {
          albumId: sharedWithUserAlbum.id,
          assetCount: 0,
          startDate: null,
          endDate: null,
          lastModifiedAssetTimestamp: null,
        },
      ]);

      const result = await sut.getAll(AuthFactory.create(owner), {});
      expect(result).toHaveLength(2);
      expect(result[0].id).toEqual(album.id);
      expect(result[1].id).toEqual(sharedWithUserAlbum.id);
      expect(mocks.album.getAll).toHaveBeenCalledWith(owner.id, { isOwned: undefined, isShared: undefined });
    });

    it('gets list of albums that have a specific asset', async () => {
      const album = AlbumFactory.from()
        .owner({ isAdmin: true })
        .albumUser()
        .asset({}, (builder) => builder.exif())
        .asset({}, (builder) => builder.exif())
        .build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getByAssetId.mockResolvedValue([getForAlbum(album)]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        {
          albumId: album.id,
          assetCount: 1,
          startDate: new Date('1970-01-01'),
          endDate: new Date('1970-01-01'),
          lastModifiedAssetTimestamp: new Date('1970-01-01'),
        },
      ]);

      const result = await sut.getAll(AuthFactory.create(owner), { assetId: album.assets[0].id });
      expect(result).toHaveLength(1);
      expect(result[0].id).toEqual(album.id);
      expect(mocks.album.getByAssetId).toHaveBeenCalledTimes(1);
    });

    it('gets list of albums that are shared', async () => {
      const album = AlbumFactory.from().albumUser().build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getAll.mockResolvedValue([getForAlbum(album)]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        {
          albumId: album.id,
          assetCount: 0,
          startDate: null,
          endDate: null,
          lastModifiedAssetTimestamp: null,
        },
      ]);

      const result = await sut.getAll(AuthFactory.create(owner), { isShared: true });
      expect(result).toHaveLength(1);
      expect(result[0].id).toEqual(album.id);
      expect(mocks.album.getAll).toHaveBeenCalledWith(owner.id, expect.objectContaining({ isShared: true }));
    });

    it('gets list of albums that are NOT shared', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getAll.mockResolvedValue([getForAlbum(album)]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        {
          albumId: album.id,
          assetCount: 0,
          startDate: null,
          endDate: null,
          lastModifiedAssetTimestamp: null,
        },
      ]);

      const result = await sut.getAll(AuthFactory.create(owner), { isShared: false });
      expect(result).toHaveLength(1);
      expect(result[0].id).toEqual(album.id);
      expect(mocks.album.getAll).toHaveBeenCalledWith(owner.id, expect.objectContaining({ isShared: false }));
    });

    it('gets only owned albums when isOwned=true', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getAll.mockResolvedValue([getForAlbum(album)]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        { albumId: album.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
      ]);

      const result = await sut.getAll(AuthFactory.create(owner), { isOwned: true });
      expect(result).toHaveLength(1);
      expect(mocks.album.getAll).toHaveBeenCalledWith(owner.id, expect.objectContaining({ isOwned: true }));
    });

    it('gets only shared-with-me albums when isOwned=false', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getAll.mockResolvedValue([getForAlbum(album)]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        { albumId: album.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
      ]);

      const result = await sut.getAll(AuthFactory.create(owner), { isOwned: false });
      expect(result).toHaveLength(1);
      expect(mocks.album.getAll).toHaveBeenCalledWith(owner.id, expect.objectContaining({ isOwned: false }));
    });

    it('gets owned shared-out albums when isOwned=true and isShared=true', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getAll.mockResolvedValue([getForAlbum(album)]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        { albumId: album.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
      ]);

      const result = await sut.getAll(AuthFactory.create(owner), { isOwned: true, isShared: true });
      expect(result).toHaveLength(1);
      expect(mocks.album.getAll).toHaveBeenCalledWith(owner.id, { isOwned: true, isShared: true });
    });

    it('returns empty list when isOwned=false and isShared=false', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getAll.mockResolvedValue([]);

      const result = await sut.getAll(AuthFactory.create(owner), { isOwned: false, isShared: false });
      expect(result).toHaveLength(0);
      expect(mocks.album.getAll).toHaveBeenCalledWith(owner.id, { isOwned: false, isShared: false });
    });
  });

  it('counts assets correctly', async () => {
    const album = AlbumFactory.create();
    const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
    mocks.album.getAll.mockResolvedValue([getForAlbum(album)]);
    mocks.album.getMetadataForIds.mockResolvedValue([
      {
        albumId: album.id,
        assetCount: 1,
        startDate: new Date('1970-01-01'),
        endDate: new Date('1970-01-01'),
        lastModifiedAssetTimestamp: new Date('1970-01-01'),
      },
    ]);

    const result = await sut.getAll(AuthFactory.create(owner), {});
    expect(result).toHaveLength(1);
    expect(result[0].assetCount).toEqual(1);
    expect(mocks.album.getAll).toHaveBeenCalledTimes(1);
  });

  describe('create', () => {
    it('creates album', async () => {
      const assetId = newUuid();
      const albumUser = { userId: newUuid(), role: AlbumUserRole.Editor };
      const album = AlbumFactory.from({ albumName: 'test', description: 'description' })
        .asset({ id: assetId }, (asset) => asset.exif())
        .albumUser(albumUser)
        .build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;

      mocks.album.create.mockResolvedValue(getForAlbum(album));
      mocks.user.get.mockResolvedValue(UserFactory.create(album.albumUsers[0].user));
      mocks.user.getMetadata.mockResolvedValue([]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));

      await sut.create(AuthFactory.create(owner), {
        albumName: 'test',
        albumUsers: [albumUser],
        description: 'description',
        assetIds: [assetId],
      });

      expect(mocks.album.create).toHaveBeenCalledWith(
        {
          albumName: 'test',
          description: 'description',
          order: album.order,
          albumThumbnailAssetId: assetId,
        },
        [assetId],
        [
          { userId: owner.id, role: AlbumUserRole.Owner },
          { userId: albumUser.userId, role: AlbumUserRole.Editor },
        ],
        owner.id,
      );

      expect(mocks.user.get).toHaveBeenCalledWith(albumUser.userId, {});
      expect(mocks.user.getMetadata).toHaveBeenCalledWith(owner.id);
      expect(mocks.access.asset.checkOwnerAccess).toHaveBeenCalledWith(owner.id, new Set([assetId]), false);
      expect(mocks.event.emit).toHaveBeenCalledTimes(1);
      expect(mocks.event.emit).toHaveBeenCalledWith('AlbumInvite', {
        id: album.id,
        userId: albumUser.userId,
        senderName: owner.name,
      });
    });

    it('creates album with assetOrder from user preferences', async () => {
      const assetId = newUuid();
      const albumUser = { userId: newUuid(), role: AlbumUserRole.Editor };
      const album = AlbumFactory.from()
        .asset({ id: assetId }, (asset) => asset.exif())
        .albumUser(albumUser)
        .build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.create.mockResolvedValue(getForAlbum(album));
      mocks.albumUser.create.mockResolvedValue(album.albumUsers[0]);
      mocks.user.get.mockResolvedValue(UserFactory.create(album.albumUsers[1].user));
      mocks.user.getMetadata.mockResolvedValue([
        {
          key: UserMetadataKey.Preferences,
          value: {
            albums: {
              defaultAssetOrder: AssetOrder.Asc,
            },
          },
        },
      ]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));

      await sut.create(AuthFactory.create(owner), {
        albumName: album.albumName,
        albumUsers: [albumUser],
        description: album.description,
        assetIds: [assetId],
      });

      expect(mocks.album.create).toHaveBeenCalledWith(
        {
          albumName: album.albumName,
          description: album.description,
          order: 'asc',
          albumThumbnailAssetId: assetId,
        },
        [assetId],
        [{ userId: owner.id, role: AlbumUserRole.Owner }, albumUser],
        owner.id,
      );

      expect(mocks.user.get).toHaveBeenCalledWith(albumUser.userId, {});
      expect(mocks.user.getMetadata).toHaveBeenCalledWith(owner.id);
      expect(mocks.access.asset.checkOwnerAccess).toHaveBeenCalledWith(owner.id, new Set([assetId]), false);
      expect(mocks.event.emit).toHaveBeenCalledWith('AlbumInvite', {
        id: album.id,
        userId: albumUser.userId,
        senderName: owner.name,
      });
    });

    it('should require valid userIds', async () => {
      mocks.user.get.mockResolvedValue(void 0);
      await expect(
        sut.create(AuthFactory.create(), {
          albumName: 'Empty album',
          albumUsers: [{ userId: 'unknown-user', role: AlbumUserRole.Editor }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.user.get).toHaveBeenCalledWith('unknown-user', {});
      expect(mocks.album.create).not.toHaveBeenCalled();
    });

    it('should only add assets the user is allowed to access', async () => {
      const assetId = newUuid();
      const album = AlbumFactory.from()
        .asset({ id: assetId }, (asset) => asset.exif())
        .albumUser()
        .build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.user.get.mockResolvedValue(album.albumUsers[0].user);
      mocks.album.create.mockResolvedValue(getForAlbum(album));
      mocks.user.getMetadata.mockResolvedValue([]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));

      await sut.create(AuthFactory.create(owner), {
        albumName: album.albumName,
        description: album.description,
        assetIds: [assetId, 'asset-2'],
      });

      expect(mocks.album.create).toHaveBeenCalledWith(
        {
          albumName: album.albumName,
          description: album.description,
          order: 'desc',
          albumThumbnailAssetId: assetId,
        },
        [assetId],
        [{ userId: owner.id, role: AlbumUserRole.Owner }],
        owner.id,
      );
      expect(mocks.access.asset.checkOwnerAccess).toHaveBeenCalledWith(owner.id, new Set([assetId, 'asset-2']), false);
    });

    it('should deduplicate owner from albumUsers on create', async () => {
      const auth = AuthFactory.create();
      const album = AlbumFactory.from().build();
      mocks.album.create.mockResolvedValue(getForAlbum(album));
      mocks.user.getMetadata.mockResolvedValue([]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());

      await sut.create(auth, {
        albumName: 'Empty album',
        albumUsers: [{ userId: auth.user.id, role: AlbumUserRole.Editor }],
      });

      expect(mocks.user.get).not.toHaveBeenCalled();
      expect(mocks.album.create).toHaveBeenCalledWith(
        expect.objectContaining({ albumName: 'Empty album' }),
        [],
        [{ userId: auth.user.id, role: AlbumUserRole.Owner }],
        auth.user.id,
      );
    });
  });

  describe('update', () => {
    it('should prevent updating an album that does not exist', async () => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.album.getById.mockResolvedValue(void 0);

      await expect(
        sut.update(AuthFactory.create(), 'invalid-id', {
          albumName: 'Album',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.album.update).not.toHaveBeenCalled();
    });

    it('should prevent updating a not owned album (shared with auth user)', async () => {
      const album = AlbumFactory.from().albumUser().build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
      await expect(
        sut.update(AuthFactory.create(owner), album.id, { albumName: 'new album name' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should require a valid thumbnail asset id', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValue(new Set());

      await expect(
        sut.update(AuthFactory.create(owner), album.id, { albumThumbnailAssetId: 'not-in-album' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.album.getAssetIds).toHaveBeenCalledWith(album.id, ['not-in-album']);
      expect(mocks.album.update).not.toHaveBeenCalled();
    });

    it('should allow the owner to update the album', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.update.mockResolvedValue(getForAlbum(album));

      await sut.update(AuthFactory.create(owner), album.id, { albumName: 'new album name' });

      expect(mocks.album.update).toHaveBeenCalledTimes(1);
      expect(mocks.album.update).toHaveBeenCalledWith(
        album.id,
        { id: album.id, albumName: 'new album name' },
        owner.id,
      );
    });

    it('should allow the owner to update the album created date', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const createdAt = new Date('1996-06-15T14:30:00.000Z');
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.update.mockResolvedValue(getForAlbum(album));

      await sut.update(AuthFactory.create(owner), album.id, { createdAt });

      expect(mocks.album.update).toHaveBeenCalledWith(album.id, { id: album.id, createdAt }, owner.id);
    });

    it('should update the album name and created date together', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const createdAt = new Date('1996-06-15T14:30:00.000Z');
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.update.mockResolvedValue(getForAlbum(album));

      await sut.update(AuthFactory.create(owner), album.id, { albumName: 'Summer 1996', createdAt });

      expect(mocks.album.update).toHaveBeenCalledWith(
        album.id,
        { id: album.id, albumName: 'Summer 1996', createdAt },
        owner.id,
      );
    });

    it('should leave the created date undefined when the dto omits it', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.update.mockResolvedValue(getForAlbum(album));

      await sut.update(AuthFactory.create(owner), album.id, { albumName: 'Renamed' });

      const [, update] = mocks.album.update.mock.calls[0];
      expect(update.createdAt).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should require permissions', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.delete(AuthFactory.create(owner), album.id)).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.album.delete).not.toHaveBeenCalled();
    });

    it('should not let a shared user delete the album', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.delete(AuthFactory.create(owner), album.id)).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.album.delete).not.toHaveBeenCalled();
    });

    it('should let the owner delete an album', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));

      await sut.delete(AuthFactory.create(owner), album.id);

      expect(mocks.album.delete).toHaveBeenCalledTimes(1);
      expect(mocks.album.delete).toHaveBeenCalledWith(album.id);
    });
  });

  describe('addUsers', () => {
    it('should throw an error if the auth user is not the owner', async () => {
      const album = AlbumFactory.create();
      const user = UserFactory.create();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
      await expect(
        sut.addUsers(AuthFactory.create(user), album.id, { albumUsers: [{ userId: newUuid() }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.album.update).not.toHaveBeenCalled();
    });

    it('should skip if the userId is already added', async () => {
      const userId = newUuid();
      const album = AlbumFactory.from().albumUser({ userId }).build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      await expect(sut.addUsers(AuthFactory.create(owner), album.id, { albumUsers: [{ userId }] })).resolves.toEqual(
        expect.objectContaining({ id: album.id }),
      );
      expect(mocks.album.update).not.toHaveBeenCalled();
      expect(mocks.user.get).not.toHaveBeenCalled();
      expect(mocks.albumUser.create).not.toHaveBeenCalled();
      expect(mocks.event.emit).not.toHaveBeenCalled();
    });

    it('should throw an error if the userId does not exist', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.user.get.mockResolvedValue(void 0);
      await expect(
        sut.addUsers(AuthFactory.create(owner), album.id, { albumUsers: [{ userId: 'unknown-user' }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.album.update).not.toHaveBeenCalled();
      expect(mocks.user.get).toHaveBeenCalledWith('unknown-user', {});
    });

    it('should skip if the userId is the ownerId', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      await expect(
        sut.addUsers(AuthFactory.create(owner), album.id, {
          albumUsers: [{ userId: owner.id }],
        }),
      ).resolves.toEqual(expect.objectContaining({ id: album.id }));
      expect(mocks.album.update).not.toHaveBeenCalled();
      expect(mocks.user.get).not.toHaveBeenCalled();
      expect(mocks.albumUser.create).not.toHaveBeenCalled();
      expect(mocks.event.emit).not.toHaveBeenCalled();
    });

    it('should add valid shared users', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const user = UserFactory.create();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.update.mockResolvedValue(getForAlbum(album));
      mocks.user.get.mockResolvedValue(user);
      mocks.albumUser.create.mockResolvedValue(AlbumUserFactory.from().album(album).user(user).build());

      await sut.addUsers(AuthFactory.create(owner), album.id, { albumUsers: [{ userId: user.id }] });

      expect(mocks.albumUser.create).toHaveBeenCalledWith({
        userId: user.id,
        albumId: album.id,
      });
      expect(mocks.event.emit).toHaveBeenCalledWith('AlbumInvite', {
        id: album.id,
        userId: user.id,
        senderName: owner.name,
      });
    });

    it('should add new users when already-added users are included', async () => {
      const existingUserId = newUuid();
      const album = AlbumFactory.from().albumUser({ userId: existingUserId }).build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const user = UserFactory.create();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.user.get.mockResolvedValue(user);
      mocks.albumUser.create.mockResolvedValue(AlbumUserFactory.from().album(album).user(user).build());

      await sut.addUsers(AuthFactory.create(owner), album.id, {
        albumUsers: [{ userId: existingUserId }, { userId: user.id }],
      });

      expect(mocks.user.get).toHaveBeenCalledTimes(1);
      expect(mocks.user.get).toHaveBeenCalledWith(user.id, {});
      expect(mocks.albumUser.create).toHaveBeenCalledTimes(1);
      expect(mocks.albumUser.create).toHaveBeenCalledWith({
        userId: user.id,
        albumId: album.id,
      });
      expect(mocks.event.emit).toHaveBeenCalledTimes(1);
      expect(mocks.event.emit).toHaveBeenCalledWith('AlbumInvite', {
        id: album.id,
        userId: user.id,
        senderName: owner.name,
      });
    });
  });

  describe('removeUser', () => {
    it('should require a valid album id', async () => {
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['album-1']));
      mocks.album.getById.mockResolvedValue(void 0);
      await expect(sut.removeUser(AuthFactory.create(), 'album-1', 'user-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.album.update).not.toHaveBeenCalled();
    });

    it('should remove a shared user from an owned album', async () => {
      const userId = newUuid();
      const album = AlbumFactory.from().albumUser({ userId }).build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.albumUser.delete.mockResolvedValue();

      await expect(sut.removeUser(AuthFactory.create(owner), album.id, userId)).resolves.toBeUndefined();

      expect(mocks.albumUser.delete).toHaveBeenCalledTimes(1);
      expect(mocks.albumUser.delete).toHaveBeenCalledWith({ albumId: album.id, userId });
      expect(mocks.album.getById).toHaveBeenCalledWith(album.id, { withAssets: false }, owner.id);
    });

    it('should prevent removing a shared user from a not-owned album (shared with auth user)', async () => {
      const user1 = UserFactory.create();
      const user2 = UserFactory.create();
      const album = AlbumFactory.from().albumUser({ userId: user1.id }).albumUser({ userId: user2.id }).build();
      mocks.album.getById.mockResolvedValue(getForAlbum(album));

      await expect(sut.removeUser(AuthFactory.create(user1), album.id, user2.id)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(mocks.albumUser.delete).not.toHaveBeenCalled();
      expect(mocks.access.album.checkOwnerAccess).toHaveBeenCalledWith(user1.id, new Set([album.id]));
    });

    it('should allow a shared user to remove themselves', async () => {
      const user1 = UserFactory.create();
      const album = AlbumFactory.from().albumUser({ userId: user1.id }).build();
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.albumUser.delete.mockResolvedValue();

      await sut.removeUser(AuthFactory.create(user1), album.id, user1.id);

      expect(mocks.albumUser.delete).toHaveBeenCalledTimes(1);
      expect(mocks.albumUser.delete).toHaveBeenCalledWith({ albumId: album.id, userId: user1.id });
    });

    it('should allow a shared user to remove themselves using "me"', async () => {
      const user = UserFactory.create();
      const album = AlbumFactory.from().albumUser({ userId: user.id }).build();
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.albumUser.delete.mockResolvedValue();

      await sut.removeUser(AuthFactory.create(user), album.id, 'me');

      expect(mocks.albumUser.delete).toHaveBeenCalledTimes(1);
      expect(mocks.albumUser.delete).toHaveBeenCalledWith({ albumId: album.id, userId: user.id });
    });

    it('should not allow the owner to be removed', async () => {
      const album = AlbumFactory.from().albumUser().build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getById.mockResolvedValue(getForAlbum(album));

      await expect(sut.removeUser(AuthFactory.create(owner), album.id, owner.id)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(mocks.album.update).not.toHaveBeenCalled();
    });

    it('should throw an error for a user not in the album', async () => {
      const album = AlbumFactory.from().albumUser().build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getById.mockResolvedValue(getForAlbum(album));

      await expect(sut.removeUser(AuthFactory.create(owner), album.id, 'user-3')).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(mocks.album.update).not.toHaveBeenCalled();
    });
  });

  describe('updateUser', () => {
    it('should update user role', async () => {
      const user = UserFactory.create();
      const album = AlbumFactory.from().albumUser({ userId: user.id }).build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.albumUser.update.mockResolvedValue();

      await sut.updateUser(AuthFactory.create(owner), album.id, user.id, { role: AlbumUserRole.Viewer });

      expect(mocks.albumUser.update).toHaveBeenCalledWith(
        { albumId: album.id, userId: user.id },
        { role: AlbumUserRole.Viewer },
      );
    });
  });

  describe('getAlbumInfo', () => {
    it('should get a shared album', async () => {
      const album = AlbumFactory.from().albumUser().build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.sharedSpace.getAlbumSpaceLinks.mockResolvedValue([]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        {
          albumId: album.id,
          assetCount: 1,
          startDate: new Date('1970-01-01'),
          endDate: new Date('1970-01-01'),
          lastModifiedAssetTimestamp: new Date('1970-01-01'),
        },
      ]);

      await sut.get(AuthFactory.create(owner), album.id);

      expect(mocks.album.getById).toHaveBeenCalledWith(album.id, { withAssets: false }, owner.id);
      expect(mocks.access.album.checkOwnerAccess).toHaveBeenCalledWith(owner.id, new Set([album.id]));
    });

    it('should get a shared album via a shared link', async () => {
      const album = AlbumFactory.from().albumUser().build();
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.access.album.checkSharedLinkAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getMetadataForIds.mockResolvedValue([
        {
          albumId: album.id,
          assetCount: 1,
          startDate: new Date('1970-01-01'),
          endDate: new Date('1970-01-01'),
          lastModifiedAssetTimestamp: new Date('1970-01-01'),
        },
      ]);

      const auth = AuthFactory.from().sharedLink().build();
      await sut.get(auth, album.id);

      expect(mocks.album.getById).toHaveBeenCalledWith(album.id, { withAssets: false }, auth.user.id);
      expect(mocks.access.album.checkSharedLinkAccess).toHaveBeenCalledWith(auth.sharedLink!.id, new Set([album.id]));
    });

    // #752 P1-5: pins the `auth.sharedLink ? undefined : auth.user.id` ternary in album.service.ts
    // get() — a future refactor that drops it would leak cross-owner contribution counts to
    // anonymous shared-link viewers (the member-gate for getMetadataForIds's contributed arm).
    it('excludes contributions (forUserId: undefined) from the metadata query for a shared-link viewer', async () => {
      const album = AlbumFactory.from().albumUser().build();
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.access.album.checkSharedLinkAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getMetadataForIds.mockResolvedValue([
        {
          albumId: album.id,
          assetCount: 1,
          startDate: new Date('1970-01-01'),
          endDate: new Date('1970-01-01'),
          lastModifiedAssetTimestamp: new Date('1970-01-01'),
        },
      ]);

      const auth = AuthFactory.from().sharedLink().build();
      await sut.get(auth, album.id);

      expect(mocks.album.getMetadataForIds).toHaveBeenCalledWith([album.id], { forUserId: undefined });
    });

    it('includes contributions (forUserId: <user id>) in the metadata query for a normal authenticated viewer', async () => {
      const album = AlbumFactory.from().albumUser().build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.sharedSpace.getAlbumSpaceLinks.mockResolvedValue([]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        {
          albumId: album.id,
          assetCount: 1,
          startDate: new Date('1970-01-01'),
          endDate: new Date('1970-01-01'),
          lastModifiedAssetTimestamp: new Date('1970-01-01'),
        },
      ]);

      await sut.get(AuthFactory.create(owner), album.id);

      expect(mocks.album.getMetadataForIds).toHaveBeenCalledWith([album.id], { forUserId: owner.id });
    });

    it('should get a shared album via shared with user', async () => {
      const user = UserFactory.create();
      const album = AlbumFactory.from().albumUser({ userId: user.id }).build();
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getMetadataForIds.mockResolvedValue([
        {
          albumId: album.id,
          assetCount: 1,
          startDate: new Date('1970-01-01'),
          endDate: new Date('1970-01-01'),
          lastModifiedAssetTimestamp: new Date('1970-01-01'),
        },
      ]);

      await sut.get(AuthFactory.create(user), album.id);

      expect(mocks.album.getById).toHaveBeenCalledWith(album.id, { withAssets: false }, user.id);
      expect(mocks.access.album.checkSharedAlbumAccess).toHaveBeenCalledWith(
        user.id,
        new Set([album.id]),
        AlbumUserRole.Viewer,
      );
    });

    it('should throw an error for no access', async () => {
      const auth = AuthFactory.create();
      await expect(sut.get(auth, 'album-123')).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.access.album.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set(['album-123']));
      expect(mocks.access.album.checkSharedAlbumAccess).toHaveBeenCalledWith(
        auth.user.id,
        new Set(['album-123']),
        AlbumUserRole.Viewer,
      );
    });

    it('strips albumUsers to the owner (email redacted) when access is via space grant only (security-8)', async () => {
      // spaceViewer is NOT in album.albumUsers — access granted only via checkSpaceLinkedAlbumReadAccess.
      const spaceViewer = UserFactory.create();
      const album = AlbumFactory.from().albumUser().build(); // owner + 1 extra participant
      const otherParticipant = album.albumUsers.find(({ role }) => role !== AlbumUserRole.Owner)!;
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSpaceLinkedAlbumReadAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getMetadataForIds.mockResolvedValue([
        { albumId: album.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
      ]);

      const result = await sut.get(AuthFactory.create(spaceViewer), album.id);

      // Only the owner survives (DTO requires albumUsers.min(1)); other participants are gone.
      expect(result.albumUsers).toHaveLength(1);
      expect(result.albumUsers[0].role).toBe(AlbumUserRole.Owner);
      expect(result.albumUsers.map((u) => u.user.id)).not.toContain(otherParticipant.user.id);
      // Owner display name kept; email still redacted.
      expect(result.albumUsers[0].user.email).toBe('');
    });

    it('does NOT redact emails when the caller is an album participant (album_user)', async () => {
      const user = UserFactory.create();
      const album = AlbumFactory.from().albumUser({ userId: user.id }).build();
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getMetadataForIds.mockResolvedValue([
        {
          albumId: album.id,
          assetCount: 0,
          startDate: null,
          endDate: null,
          lastModifiedAssetTimestamp: null,
        },
      ]);

      const result = await sut.get(AuthFactory.create(user), album.id);

      // Participant should see real emails
      for (const albumUser of result.albumUsers) {
        expect(albumUser.user.email).not.toBe('');
        expect(albumUser.user.email).toContain('@');
      }
    });

    it('does NOT redact emails when the caller is the album owner', async () => {
      const album = AlbumFactory.from().albumUser().build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.sharedSpace.getAlbumSpaceLinks.mockResolvedValue([]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        {
          albumId: album.id,
          assetCount: 0,
          startDate: null,
          endDate: null,
          lastModifiedAssetTimestamp: null,
        },
      ]);

      const result = await sut.get(AuthFactory.create(owner), album.id);

      for (const albumUser of result.albumUsers) {
        expect(albumUser.user.email).not.toBe('');
        expect(albumUser.user.email).toContain('@');
      }
    });
  });

  describe('get — contributorCounts (L1)', () => {
    it('omits contributorCounts for a space-only reader (no direct album access)', async () => {
      // spaceViewer is NOT in album.albumUsers — access granted only via checkSpaceLinkedAlbumReadAccess,
      // mirroring the security-8 "space grant only" fixture above.
      const spaceViewer = UserFactory.create();
      const album = AlbumFactory.from().albumUser().build(); // owner + 1 extra participant -> isShared
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSpaceLinkedAlbumReadAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getMetadataForIds.mockResolvedValue([
        { albumId: album.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
      ]);

      const result = await sut.get(AuthFactory.create(spaceViewer), album.id);

      expect(result.contributorCounts).toBeUndefined();
      expect(mocks.album.getContributorCounts).not.toHaveBeenCalled();
    });

    it('includes contributorCounts for a direct reader (album participant) of a shared album', async () => {
      const user = UserFactory.create();
      const album = AlbumFactory.from().albumUser({ userId: user.id }).build(); // owner + user -> isShared
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getMetadataForIds.mockResolvedValue([
        { albumId: album.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
      ]);
      mocks.album.getContributorCounts.mockResolvedValue([{ userId: user.id, assetCount: 3 }]);

      const result = await sut.get(AuthFactory.create(user), album.id);

      expect(result.contributorCounts).toEqual([{ userId: user.id, assetCount: 3 }]);
      expect(mocks.album.getContributorCounts).toHaveBeenCalledWith(album.id);
    });
  });

  describe('get — sharedSpaceLinks (rbac-6)', () => {
    it('returns sharedSpaceLinks to the album owner', async () => {
      const auth = AuthFactory.create();
      const album = AlbumFactory.from().owner(auth.user).build();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getMetadataForIds.mockResolvedValue([
        { albumId: album.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
      ]);
      mocks.sharedSpace.getAlbumSpaceLinks.mockResolvedValue([
        { spaceId: 'space-1', spaceName: 'Trip', linkedById: 'editor-1', showInTimeline: true },
        { spaceId: 'space-2', spaceName: 'Zoo', linkedById: 'editor-2', showInTimeline: false },
      ]);

      const result = await sut.get(auth, album.id);

      expect(result.sharedSpaceLinks).toEqual([
        { spaceId: 'space-1', spaceName: 'Trip', linkedById: 'editor-1', showInTimeline: true },
        { spaceId: 'space-2', spaceName: 'Zoo', linkedById: 'editor-2', showInTimeline: false },
      ]);
      expect(mocks.sharedSpace.getAlbumSpaceLinks).toHaveBeenCalledWith(album.id);
    });

    it('omits sharedSpaceLinks for a non-owner space-linked reader', async () => {
      const auth = AuthFactory.create();
      const album = AlbumFactory.from().albumUser().build(); // owned by someone else
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set()); // not the owner
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set()); // not a shared album_user
      mocks.access.album.checkSpaceLinkedAlbumReadAccess.mockResolvedValue(new Set([album.id])); // reaches via space
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getMetadataForIds.mockResolvedValue([
        { albumId: album.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
      ]);

      const result = await sut.get(auth, album.id);

      expect(result.sharedSpaceLinks).toBeUndefined();
      expect(mocks.sharedSpace.getAlbumSpaceLinks).not.toHaveBeenCalled();
    });

    it('omits sharedSpaceLinks for a non-owner album EDITOR (owner-only policy)', async () => {
      const auth = AuthFactory.create();
      const album = AlbumFactory.from().albumUser().build();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set()); // not the owner
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([album.id])); // album editor/viewer
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getMetadataForIds.mockResolvedValue([
        { albumId: album.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
      ]);

      const result = await sut.get(auth, album.id);

      expect(result.sharedSpaceLinks).toBeUndefined();
      expect(mocks.sharedSpace.getAlbumSpaceLinks).not.toHaveBeenCalled();
    });

    it('omits sharedSpaceLinks for a shared-link viewer, even though the link resolves to the album owner', async () => {
      // Shared-link AuthDto.user.id is the link creator's real id (the album owner), so
      // checkOwnerAccess alone would resolve true here — the explicit `!auth.sharedLink` guard is
      // what keeps a public link from exposing the owner-only space-link list.
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const auth = AuthFactory.from(owner).sharedLink().build();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.access.album.checkSharedLinkAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getMetadataForIds.mockResolvedValue([
        { albumId: album.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
      ]);

      const result = await sut.get(auth, album.id);

      expect(result.sharedSpaceLinks).toBeUndefined();
      expect(mocks.sharedSpace.getAlbumSpaceLinks).not.toHaveBeenCalled();
    });
  });

  describe('addAssets', () => {
    it('should allow the owner to add assets', async () => {
      const owner = UserFactory.create({ isAdmin: true });
      const album = AlbumFactory.from().owner(owner).build();
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id, asset3.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set());

      await expect(
        sut.addAssets(AuthFactory.create(owner), album.id, { ids: [asset1.id, asset2.id, asset3.id] }),
      ).resolves.toEqual([
        { success: true, id: asset1.id },
        { success: true, id: asset2.id },
        { success: true, id: asset3.id },
      ]);

      expect(mocks.album.update).toHaveBeenCalledWith(
        album.id,
        {
          id: album.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset1.id,
        },
        owner.id,
      );
      expect(mocks.album.addAssetIds).toHaveBeenCalledWith(album.id, [asset1.id, asset2.id, asset3.id]);
    });

    it('should not set the thumbnail if the album has one already', async () => {
      const [asset1, asset2] = [AssetFactory.create(), AssetFactory.create()];
      const album = AlbumFactory.from({ albumThumbnailAssetId: asset1.id }).build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset2.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set());

      await expect(sut.addAssets(AuthFactory.create(owner), album.id, { ids: [asset2.id] })).resolves.toEqual([
        { success: true, id: asset2.id },
      ]);

      expect(mocks.album.update).toHaveBeenCalledWith(
        album.id,
        {
          id: album.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset1.id,
        },
        owner.id,
      );
      expect(mocks.album.addAssetIds).toHaveBeenCalled();
    });

    it('should allow a shared user to add assets', async () => {
      const user = UserFactory.create();
      const album = AlbumFactory.from().albumUser({ userId: user.id, role: AlbumUserRole.Editor }).build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([album.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id, asset3.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set());

      await expect(
        sut.addAssets(AuthFactory.create(user), album.id, { ids: [asset1.id, asset2.id, asset3.id] }),
      ).resolves.toEqual([
        { success: true, id: asset1.id },
        { success: true, id: asset2.id },
        { success: true, id: asset3.id },
      ]);

      expect(mocks.album.update).toHaveBeenCalledWith(
        album.id,
        {
          id: album.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset1.id,
        },
        user.id,
      );
      expect(mocks.album.addAssetIds).toHaveBeenCalledWith(album.id, [asset1.id, asset2.id, asset3.id]);
      expect(mocks.event.emit).toHaveBeenCalledWith('AlbumUpdate', {
        id: album.id,
        userIds: album.albumUsers.map(({ user }) => user.id),
        recipientIds: [owner.id],
      });
    });

    it('should not allow a shared user with viewer access to add assets', async () => {
      const user = UserFactory.create();
      const album = AlbumFactory.from().albumUser({ userId: user.id, role: AlbumUserRole.Viewer }).build();
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set());
      mocks.album.getById.mockResolvedValue(getForAlbum(album));

      await expect(
        sut.addAssets(AuthFactory.create(user), album.id, { ids: [asset1.id, asset2.id, asset3.id] }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.album.update).not.toHaveBeenCalled();
    });

    it('should allow adding assets shared via partner sharing', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const asset = AssetFactory.create();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.access.asset.checkPartnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set());

      await expect(sut.addAssets(AuthFactory.create(owner), album.id, { ids: [asset.id] })).resolves.toEqual([
        { success: true, id: asset.id },
      ]);

      expect(mocks.album.update).toHaveBeenCalledWith(
        album.id,
        {
          id: album.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset.id,
        },
        owner.id,
      );
      expect(mocks.access.asset.checkPartnerAccess).toHaveBeenCalledWith(owner.id, new Set([asset.id]));
    });

    it('should skip duplicate assets', async () => {
      const asset = AssetFactory.create();
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set([asset.id]));

      await expect(sut.addAssets(AuthFactory.create(owner), album.id, { ids: [asset.id] })).resolves.toEqual([
        { success: false, id: asset.id, error: BulkIdErrorReason.DUPLICATE },
      ]);

      expect(mocks.album.update).not.toHaveBeenCalled();
    });

    it('should skip assets not shared with user', async () => {
      const asset = AssetFactory.create();
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set());

      await expect(sut.addAssets(AuthFactory.create(owner), album.id, { ids: [asset.id] })).resolves.toEqual([
        { success: false, id: asset.id, error: BulkIdErrorReason.NO_PERMISSION },
      ]);

      expect(mocks.access.asset.checkOwnerAccess).toHaveBeenCalledWith(owner.id, new Set([asset.id]), false);
      expect(mocks.access.asset.checkPartnerAccess).toHaveBeenCalledWith(owner.id, new Set([asset.id]));
    });

    it('should not allow unauthorized access to the album', async () => {
      const user = UserFactory.create();
      const album = AlbumFactory.create();
      const asset = AssetFactory.create({ ownerId: user.id });
      mocks.album.getById.mockResolvedValue(getForAlbum(album));

      await expect(sut.addAssets(AuthFactory.create(user), album.id, { ids: [asset.id] })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(mocks.access.album.checkOwnerAccess).toHaveBeenCalled();
      expect(mocks.access.album.checkSharedAlbumAccess).toHaveBeenCalled();
    });

    it('should not allow unauthorized shared link access to the album', async () => {
      const album = AlbumFactory.create();
      const asset = AssetFactory.create();
      mocks.album.getById.mockResolvedValue(getForAlbum(album));

      await expect(
        sut.addAssets(AuthFactory.from().sharedLink({ allowUpload: true }).build(), album.id, { ids: [asset.id] }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.access.album.checkSharedLinkAccess).toHaveBeenCalled();
    });
  });

  describe('addAssetsToAlbums', () => {
    it('should allow the owner to add assets', async () => {
      const album1 = AlbumFactory.create();
      const { user: owner } = album1.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const album2 = AlbumFactory.create();
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      mocks.access.album.checkOwnerAccess.mockResolvedValueOnce(new Set([album1.id, album2.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id, asset3.id]));
      mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set()).mockResolvedValueOnce(new Set());

      await expect(
        sut.addAssetsToAlbums(AuthFactory.create(owner), {
          albumIds: [album1.id, album2.id],
          assetIds: [asset1.id, asset2.id, asset3.id],
        }),
      ).resolves.toEqual({ success: true, error: undefined });

      expect(mocks.album.update).toHaveBeenCalledTimes(2);
      expect(mocks.album.update).toHaveBeenNthCalledWith(
        1,
        album1.id,
        {
          id: album1.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset1.id,
        },
        owner.id,
      );
      expect(mocks.album.update).toHaveBeenNthCalledWith(
        2,
        album2.id,
        {
          id: album2.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset1.id,
        },
        owner.id,
      );
      expect(mocks.album.addAssetIdsToAlbums).toHaveBeenCalledWith([
        { albumId: album1.id, assetId: asset1.id },
        { albumId: album1.id, assetId: asset2.id },
        { albumId: album1.id, assetId: asset3.id },
        { albumId: album2.id, assetId: asset1.id },
        { albumId: album2.id, assetId: asset2.id },
        { albumId: album2.id, assetId: asset3.id },
      ]);
    });

    it('should not set the thumbnail if the album has one already', async () => {
      const asset = AssetFactory.create();
      const album1 = AlbumFactory.from({ albumThumbnailAssetId: asset.id }).build();
      const { user: owner } = album1.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const album2 = AlbumFactory.from({ albumThumbnailAssetId: asset.id }).build();
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      mocks.access.album.checkOwnerAccess.mockResolvedValueOnce(new Set([album1.id, album2.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id, asset3.id]));
      mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set()).mockResolvedValueOnce(new Set());

      await expect(
        sut.addAssetsToAlbums(AuthFactory.create(owner), {
          albumIds: [album1.id, album2.id],
          assetIds: [asset1.id, asset2.id, asset3.id],
        }),
      ).resolves.toEqual({ success: true, error: undefined });

      expect(mocks.album.update).toHaveBeenCalledTimes(2);
      expect(mocks.album.update).toHaveBeenNthCalledWith(
        1,
        album1.id,
        {
          id: album1.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset.id,
        },
        owner.id,
      );
      expect(mocks.album.update).toHaveBeenNthCalledWith(
        2,
        album2.id,
        {
          id: album2.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset.id,
        },
        owner.id,
      );
      expect(mocks.album.addAssetIdsToAlbums).toHaveBeenCalledWith([
        { albumId: album1.id, assetId: asset1.id },
        { albumId: album1.id, assetId: asset2.id },
        { albumId: album1.id, assetId: asset3.id },
        { albumId: album2.id, assetId: asset1.id },
        { albumId: album2.id, assetId: asset2.id },
        { albumId: album2.id, assetId: asset3.id },
      ]);
    });

    it('should allow a shared user to add assets', async () => {
      const user = UserFactory.create();
      const album1 = AlbumFactory.from().albumUser({ userId: user.id, role: AlbumUserRole.Editor }).build();
      const { user: owner1 } = album1.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const album2 = AlbumFactory.from().albumUser({ userId: user.id, role: AlbumUserRole.Editor }).build();
      const { user: owner2 } = album2.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValueOnce(new Set([album1.id, album2.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id, asset3.id]));
      mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set()).mockResolvedValueOnce(new Set());

      await expect(
        sut.addAssetsToAlbums(AuthFactory.create(user), {
          albumIds: [album1.id, album2.id],
          assetIds: [asset1.id, asset2.id, asset3.id],
        }),
      ).resolves.toEqual({ success: true, error: undefined });

      expect(mocks.album.update).toHaveBeenCalledTimes(2);
      expect(mocks.album.update).toHaveBeenNthCalledWith(
        1,
        album1.id,
        {
          id: album1.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset1.id,
        },
        user.id,
      );
      expect(mocks.album.update).toHaveBeenNthCalledWith(
        2,
        album2.id,
        {
          id: album2.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset1.id,
        },
        user.id,
      );
      expect(mocks.album.addAssetIdsToAlbums).toHaveBeenCalledWith([
        { albumId: album1.id, assetId: asset1.id },
        { albumId: album1.id, assetId: asset2.id },
        { albumId: album1.id, assetId: asset3.id },
        { albumId: album2.id, assetId: asset1.id },
        { albumId: album2.id, assetId: asset2.id },
        { albumId: album2.id, assetId: asset3.id },
      ]);
      expect(mocks.event.emit).toHaveBeenCalledWith('AlbumUpdate', {
        id: album1.id,
        userIds: album1.albumUsers.map(({ user }) => user.id),
        recipientIds: [owner1.id],
      });
      expect(mocks.event.emit).toHaveBeenCalledWith('AlbumUpdate', {
        id: album2.id,
        userIds: album2.albumUsers.map(({ user }) => user.id),
        recipientIds: [owner2.id],
      });
    });

    it('should not allow a shared user with viewer access to add assets', async () => {
      const user = UserFactory.create();
      const album1 = AlbumFactory.from().albumUser({ userId: user.id, role: AlbumUserRole.Viewer }).build();
      const album2 = AlbumFactory.from().albumUser({ userId: user.id, role: AlbumUserRole.Viewer }).build();
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValueOnce(new Set()).mockResolvedValueOnce(new Set());
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id, asset3.id]));
      mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set()).mockResolvedValueOnce(new Set());

      await expect(
        sut.addAssetsToAlbums(AuthFactory.create(user), {
          albumIds: [album1.id, album2.id],
          assetIds: [asset1.id, asset2.id, asset3.id],
        }),
      ).resolves.toEqual({
        success: false,
        error: BulkIdErrorReason.NO_PERMISSION,
      });

      expect(mocks.album.update).not.toHaveBeenCalled();
    });

    it('should allow adding assets shared via partner sharing', async () => {
      const user = UserFactory.create();
      const album1 = AlbumFactory.create();
      const { user: owner } = album1.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const album2 = AlbumFactory.create();
      const [asset1, asset2, asset3] = [
        AssetFactory.create({ ownerId: user.id }),
        AssetFactory.create({ ownerId: user.id }),
        AssetFactory.create({ ownerId: user.id }),
      ];
      mocks.access.album.checkOwnerAccess.mockResolvedValueOnce(new Set([album1.id, album2.id]));
      mocks.access.asset.checkPartnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id, asset3.id]));
      mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set()).mockResolvedValueOnce(new Set());

      await expect(
        sut.addAssetsToAlbums(AuthFactory.create(owner), {
          albumIds: [album1.id, album2.id],
          assetIds: [asset1.id, asset2.id, asset3.id],
        }),
      ).resolves.toEqual({ success: true, error: undefined });

      expect(mocks.album.update).toHaveBeenCalledTimes(2);
      expect(mocks.album.update).toHaveBeenNthCalledWith(
        1,
        album1.id,
        {
          id: album1.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset1.id,
        },
        owner.id,
      );
      expect(mocks.album.update).toHaveBeenNthCalledWith(
        2,
        album2.id,
        {
          id: album2.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset1.id,
        },
        owner.id,
      );
      expect(mocks.album.addAssetIdsToAlbums).toHaveBeenCalledWith([
        { albumId: album1.id, assetId: asset1.id },
        { albumId: album1.id, assetId: asset2.id },
        { albumId: album1.id, assetId: asset3.id },
        { albumId: album2.id, assetId: asset1.id },
        { albumId: album2.id, assetId: asset2.id },
        { albumId: album2.id, assetId: asset3.id },
      ]);
      expect(mocks.access.asset.checkPartnerAccess).toHaveBeenCalledWith(
        owner.id,
        new Set([asset1.id, asset2.id, asset3.id]),
      );
    });

    it('should skip some duplicate assets', async () => {
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      const album1 = AlbumFactory.create();
      const { user: owner } = album1.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const album2 = AlbumFactory.create();

      mocks.access.album.checkOwnerAccess.mockResolvedValueOnce(new Set([album1.id, album2.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id, asset3.id]));
      mocks.album.getAssetIds
        .mockResolvedValueOnce(new Set([asset1.id, asset2.id, asset3.id]))
        .mockResolvedValueOnce(new Set());
      mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));

      await expect(
        sut.addAssetsToAlbums(AuthFactory.create(owner), {
          albumIds: [album1.id, album2.id],
          assetIds: [asset1.id, asset2.id, asset3.id],
        }),
      ).resolves.toEqual({ success: true, error: undefined });

      expect(mocks.album.update).toHaveBeenCalledTimes(1);
      expect(mocks.album.update).toHaveBeenNthCalledWith(
        1,
        album2.id,
        {
          id: album2.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset1.id,
        },
        owner.id,
      );
      expect(mocks.album.addAssetIdsToAlbums).toHaveBeenCalledWith([
        { albumId: album2.id, assetId: asset1.id },
        { albumId: album2.id, assetId: asset2.id },
        { albumId: album2.id, assetId: asset3.id },
      ]);
    });

    it('should skip all duplicate assets', async () => {
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      const album1 = AlbumFactory.create();
      const { user: owner } = album1.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const album2 = AlbumFactory.create();
      mocks.access.album.checkOwnerAccess
        .mockResolvedValueOnce(new Set([album1.id]))
        .mockResolvedValueOnce(new Set([album2.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id, asset3.id]));
      mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));
      mocks.album.getAssetIds.mockResolvedValue(new Set([asset1.id, asset2.id, asset3.id]));

      await expect(
        sut.addAssetsToAlbums(AuthFactory.create(owner), {
          albumIds: [album1.id, album2.id],
          assetIds: [asset1.id, asset2.id, asset3.id],
        }),
      ).resolves.toEqual({
        success: false,
        error: BulkIdErrorReason.DUPLICATE,
      });

      expect(mocks.album.update).not.toHaveBeenCalled();
      expect(mocks.album.addAssetIds).not.toHaveBeenCalled();
    });

    it('should skip assets not shared with user', async () => {
      const user = UserFactory.create();
      const album1 = AlbumFactory.create();
      const { user: owner } = album1.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const album2 = AlbumFactory.create();
      const [asset1, asset2, asset3] = [
        AssetFactory.create({ ownerId: user.id }),
        AssetFactory.create({ ownerId: user.id }),
        AssetFactory.create({ ownerId: user.id }),
      ];
      mocks.access.album.checkSharedAlbumAccess
        .mockResolvedValueOnce(new Set([album1.id]))
        .mockResolvedValueOnce(new Set([album2.id]));
      mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set()).mockResolvedValueOnce(new Set());

      await expect(
        sut.addAssetsToAlbums(AuthFactory.create(owner), {
          albumIds: [album1.id, album2.id],
          assetIds: [asset1.id, asset2.id, asset3.id],
        }),
      ).resolves.toEqual({
        success: false,
        error: BulkIdErrorReason.NO_PERMISSION,
      });

      expect(mocks.album.update).not.toHaveBeenCalled();
      expect(mocks.album.addAssetIds).not.toHaveBeenCalled();
      expect(mocks.access.asset.checkOwnerAccess).toHaveBeenCalledWith(
        owner.id,
        new Set([asset1.id, asset2.id, asset3.id]),
        false,
      );
      expect(mocks.access.asset.checkPartnerAccess).toHaveBeenCalledWith(
        owner.id,
        new Set([asset1.id, asset2.id, asset3.id]),
      );
    });

    it('should not allow unauthorized access to the albums', async () => {
      const user = UserFactory.create();
      const album1 = AlbumFactory.create();
      const album2 = AlbumFactory.create();
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));

      await expect(
        sut.addAssetsToAlbums(AuthFactory.create(user), {
          albumIds: [album1.id, album2.id],
          assetIds: [asset1.id, asset2.id, asset3.id],
        }),
      ).resolves.toEqual({
        success: false,
        error: BulkIdErrorReason.NO_PERMISSION,
      });

      expect(mocks.album.update).not.toHaveBeenCalled();
      expect(mocks.album.addAssetIds).not.toHaveBeenCalled();
      expect(mocks.access.album.checkOwnerAccess).toHaveBeenCalled();
      expect(mocks.access.album.checkSharedAlbumAccess).toHaveBeenCalled();
    });

    it('should not allow unauthorized shared link access to the album', async () => {
      const album1 = AlbumFactory.create();
      const album2 = AlbumFactory.create();
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));

      await expect(
        sut.addAssetsToAlbums(AuthFactory.from().sharedLink({ allowUpload: true }).build(), {
          albumIds: [album1.id, album2.id],
          assetIds: [asset1.id, asset2.id, asset3.id],
        }),
      ).resolves.toEqual({
        success: false,
        error: BulkIdErrorReason.NO_PERMISSION,
      });

      expect(mocks.access.album.checkSharedLinkAccess).toHaveBeenCalled();
    });
  });

  describe('removeAssets', () => {
    it('should allow the owner to remove assets', async () => {
      const asset = AssetFactory.create();
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValue(new Set([asset.id]));

      await expect(sut.removeAssets(AuthFactory.create(owner), album.id, { ids: [asset.id] })).resolves.toEqual([
        { success: true, id: asset.id },
      ]);

      expect(mocks.album.removeAssetIds).toHaveBeenCalledWith(album.id, [asset.id]);
    });

    it('should skip assets not in the album', async () => {
      const asset = AssetFactory.create();
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValue(new Set());

      await expect(sut.removeAssets(AuthFactory.create(owner), album.id, { ids: [asset.id] })).resolves.toEqual([
        { success: false, id: asset.id, error: BulkIdErrorReason.NOT_FOUND },
      ]);

      expect(mocks.album.update).not.toHaveBeenCalled();
    });

    it('should allow owner to remove all assets from the album', async () => {
      const asset = AssetFactory.create();
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValue(new Set([asset.id]));

      await expect(sut.removeAssets(AuthFactory.create(owner), album.id, { ids: [asset.id] })).resolves.toEqual([
        { success: true, id: asset.id },
      ]);
    });

    it('should reset the thumbnail if it is removed', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      const album = AlbumFactory.from({ albumThumbnailAssetId: asset1.id }).build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValue(new Set([asset1.id, asset2.id]));

      await expect(sut.removeAssets(AuthFactory.create(owner), album.id, { ids: [asset1.id] })).resolves.toEqual([
        { success: true, id: asset1.id },
      ]);

      expect(mocks.album.updateThumbnails).toHaveBeenCalled();
    });
  });

  // // it('removes assets from shared album (shared with auth user)', async () => {
  // //   const albumEntity = _getOwnedSharedAlbum();
  // //   albumRepositoryMock.get.mockImplementation(() => Promise.resolve<AlbumEntity>(albumEntity));
  // //   albumRepositoryMock.removeAssets.mockImplementation(() => Promise.resolve<AlbumEntity>(albumEntity));

  // //   await expect(
  // //     sut.removeAssetsFromAlbum(
  // //       auth,
  // //       {
  // //         ids: ['1'],
  // //       },
  // //       albumEntity.id,
  // //     ),
  // //   ).resolves.toBeUndefined();
  // //   expect(albumRepositoryMock.removeAssets).toHaveBeenCalledTimes(1);
  // //   expect(albumRepositoryMock.removeAssets).toHaveBeenCalledWith(albumEntity, {
  // //     ids: ['1'],
  // //   });
  // // });

  // it('prevents removing assets from a not owned / shared album', async () => {
  //   const albumEntity = _getNotOwnedNotSharedAlbum();

  //   const albumResponse: AddAssetsResponseDto = {
  //     alreadyInAlbum: [],
  //     successfullyAdded: 1,
  //   };

  //   const albumId = albumEntity.id;

  //   albumRepositoryMock.get.mockImplementation(() => Promise.resolve<AlbumEntity>(albumEntity));
  //   albumRepositoryMock.addAssets.mockImplementation(() => Promise.resolve<AddAssetsResponseDto>(albumResponse));

  //   await expect(sut.removeAssets(auth, albumId, { ids: ['1'] })).rejects.toBeInstanceOf(ForbiddenException);
  // });

  describe('AlbumAssets events (space sync)', () => {
    it('addAssets emits AlbumAssetsAdd with the successfully added asset ids', async () => {
      const owner = UserFactory.create({ isAdmin: true });
      const album = AlbumFactory.from().owner(owner).build();
      const [asset1, asset2] = [AssetFactory.create(), AssetFactory.create()];
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set());

      await sut.addAssets(AuthFactory.create(owner), album.id, { ids: [asset1.id, asset2.id] });

      expect(mocks.event.emit).toHaveBeenCalledWith('AlbumAssetsAdd', {
        albumId: album.id,
        assetIds: [asset1.id, asset2.id],
      });
    });

    it('addAssets does not emit AlbumAssetsAdd when nothing was added', async () => {
      const owner = UserFactory.create({ isAdmin: true });
      const album = AlbumFactory.from().owner(owner).build();
      const asset1 = AssetFactory.create();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set([asset1.id])); // already present → no success

      await sut.addAssets(AuthFactory.create(owner), album.id, { ids: [asset1.id] });

      expect(mocks.event.emit).not.toHaveBeenCalledWith('AlbumAssetsAdd', expect.anything());
    });

    it('addAssetsToAlbums emits one AlbumAssetsAdd per album with its added ids', async () => {
      const album1 = AlbumFactory.create();
      const { user: owner } = album1.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const album2 = AlbumFactory.create();
      const [asset1, asset2] = [AssetFactory.create(), AssetFactory.create()];
      mocks.access.album.checkOwnerAccess.mockResolvedValueOnce(new Set([album1.id, album2.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id]));
      mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set()).mockResolvedValueOnce(new Set());

      await sut.addAssetsToAlbums(AuthFactory.create(owner), {
        albumIds: [album1.id, album2.id],
        assetIds: [asset1.id, asset2.id],
      });

      expect(mocks.event.emit).toHaveBeenCalledWith('AlbumAssetsAdd', {
        albumId: album1.id,
        assetIds: [asset1.id, asset2.id],
      });
      expect(mocks.event.emit).toHaveBeenCalledWith('AlbumAssetsAdd', {
        albumId: album2.id,
        assetIds: [asset1.id, asset2.id],
      });
    });

    it('removeAssets emits AlbumAssetsRemove with the removed ids', async () => {
      const owner = UserFactory.create({ isAdmin: true });
      const album = AlbumFactory.from().owner(owner).build();
      const [asset1, asset2] = [AssetFactory.create(), AssetFactory.create()];
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set([asset1.id, asset2.id]));

      await sut.removeAssets(AuthFactory.create(owner), album.id, { ids: [asset1.id, asset2.id] });

      expect(mocks.event.emit).toHaveBeenCalledWith('AlbumAssetsRemove', {
        albumId: album.id,
        assetIds: [asset1.id, asset2.id],
      });
    });

    it('removeAssets does not emit AlbumAssetsRemove when nothing was removed', async () => {
      const owner = UserFactory.create({ isAdmin: true });
      const album = AlbumFactory.from().owner(owner).build();
      const asset1 = AssetFactory.create();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set()); // asset not in album → not removed

      await sut.removeAssets(AuthFactory.create(owner), album.id, { ids: [asset1.id] });

      expect(mocks.event.emit).not.toHaveBeenCalledWith('AlbumAssetsRemove', expect.anything());
    });
  });
});
