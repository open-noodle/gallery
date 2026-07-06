import { Kysely } from 'kysely';
import { AccessRepository } from 'src/repositories/access.repository';
import { AlbumUserRepository } from 'src/repositories/album-user.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { SharedSpaceService } from 'src/services/shared-space.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const result = newMediumService(SharedSpaceService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      AlbumUserRepository,
      AssetRepository,
      SharedSpaceRepository,
      UserRepository,
    ],
    mock: [EventRepository, LoggingRepository, JobRepository, StorageRepository],
  });
  result.ctx.getMock(JobRepository).queue.mockResolvedValue();
  return result;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const authFromUser = (actor: { id: string; email: string }) =>
  factory.auth({ user: { id: actor.id, email: actor.email } });

describe('SharedSpaceService.getLinkedAlbums — rich AlbumResponseDto shape', () => {
  it('returns non-deleted linked albums only', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { result: activeAlbum } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Active' });
    const { result: deletedAlbum } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Deleted' });

    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: activeAlbum.id, addedById: owner.id });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: deletedAlbum.id, addedById: owner.id });
    await ctx.softDeleteAlbum(deletedAlbum.id);

    const auth = authFromUser(owner);
    const result = await sut.getLinkedAlbums(auth, space.id);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(activeAlbum.id);
  });

  it('album with 2 assets has assetCount === 2 and non-null startDate/endDate', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'TwoAssets' });
    const { asset: a1 } = await ctx.newAsset({ ownerId: owner.id });
    const { asset: a2 } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a2.id });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const result = await sut.getLinkedAlbums(authFromUser(owner), space.id);

    expect(result).toHaveLength(1);
    expect(result[0].assetCount).toBe(2);
    expect(result[0].startDate).toBeDefined();
    expect(result[0].endDate).toBeDefined();
  });

  it('empty album has assetCount === 0 and undefined startDate/endDate', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Empty' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const result = await sut.getLinkedAlbums(authFromUser(owner), space.id);

    expect(result).toHaveLength(1);
    expect(result[0].assetCount).toBe(0);
    expect(result[0].startDate).toBeUndefined();
    expect(result[0].endDate).toBeUndefined();
  });

  it('returns albumUsers with album owner user id', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: otherUser } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    // Album owned by otherUser, linked to space
    const { result: album } = await ctx.newAlbum({ ownerId: otherUser.id, albumName: 'OtherOwner' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const result = await sut.getLinkedAlbums(authFromUser(owner), space.id);

    expect(result).toHaveLength(1);
    expect(result[0].albumUsers[0].user.id).toBe(otherUser.id);
  });

  it('results are in album.createdAt DESC order', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    // Create albums with distinct timestamps so ordering is deterministic
    const { result: albumA } = await ctx.newAlbum({
      ownerId: owner.id,
      albumName: 'OlderAlbum',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    });
    const { result: albumB } = await ctx.newAlbum({
      ownerId: owner.id,
      albumName: 'NewerAlbum',
      createdAt: new Date('2024-06-01T00:00:00.000Z'),
    });

    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: albumA.id, addedById: owner.id });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: albumB.id, addedById: owner.id });

    const result = await sut.getLinkedAlbums(authFromUser(owner), space.id);

    expect(result).toHaveLength(2);
    // Newer album should come first (DESC order)
    expect(result[0].id).toBe(albumB.id);
    expect(result[1].id).toBe(albumA.id);
  });

  it('linkedAt equals the link row created timestamp and differs from album createdAt', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { result: album } = await ctx.newAlbum({
      ownerId: owner.id,
      albumName: 'TimestampAlbum',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    // Get the raw link row to compare timestamps
    const rawLinks = await ctx.get(SharedSpaceRepository).getLinkedAlbums(space.id);
    const rawLink = rawLinks.find((l) => l.id === album.id)!;

    const result = await sut.getLinkedAlbums(authFromUser(owner), space.id);

    expect(result).toHaveLength(1);
    expect(typeof result[0].linkedAt).toBe('string');
    expect(typeof result[0].createdAt).toBe('string');
    // linkedAt should be the link row's createdAt (shared_space_album.createdAt)
    expect(result[0].linkedAt).toBe((rawLink.linkedAt as unknown as Date).toISOString());
    // They should differ since the album was created before the link
    expect(result[0].linkedAt).not.toBe(result[0].createdAt);
  });
});
