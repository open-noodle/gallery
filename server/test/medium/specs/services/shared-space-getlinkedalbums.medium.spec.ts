import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum';
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

  it('does NOT expose albumUsers in the DTO (Slice 7 PII strip)', async () => {
    // albumUsers must not appear — not even an empty array — in getLinkedAlbums output.
    // The web does not use this field; returning it would leak member email addresses.
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: otherUser } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    // Album owned by otherUser (it has an album_user row), linked to space
    const { result: album } = await ctx.newAlbum({ ownerId: otherUser.id, albumName: 'OtherOwner' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const result = await sut.getLinkedAlbums(authFromUser(owner), space.id);

    expect(result).toHaveLength(1);
    // albumUsers must not be present at all
    expect((result[0] as unknown as Record<string, unknown>)['albumUsers']).toBeUndefined();
    // No email anywhere in the serialized payload
    const serialized = JSON.stringify(result[0]);
    expect(serialized).not.toMatch(/"email"\s*:/);
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

  // L17: the raw album.albumThumbnailAssetId can point at an asset that isn't space-visible
  // (Hidden/Locked, or since soft-deleted) — a member's gated thumbnail request for that asset
  // 403s and the web renders a broken cover tile. getLinkedAlbums must substitute a space-visible
  // cover per-viewer instead of returning the raw, possibly-inaccessible thumbnail id verbatim.
  describe('L17 — per-viewer space-visible cover substitution', () => {
    it('substitutes a Hidden cover with the newest space-visible asset still in the album', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

      const { asset: hiddenCover } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
      const { asset: visible } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      const { result: album } = await ctx.newAlbum({
        ownerId: owner.id,
        albumName: 'HiddenCover',
        albumThumbnailAssetId: hiddenCover.id,
      });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: hiddenCover.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: visible.id });
      await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

      const result = await sut.getLinkedAlbums(authFromUser(owner), space.id);

      expect(result).toHaveLength(1);
      expect(result[0].albumThumbnailAssetId).not.toBe(hiddenCover.id);
      expect(result[0].albumThumbnailAssetId).toBe(visible.id);
    });

    it('returns a null cover when the Hidden cover has no space-visible fallback asset', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

      const { asset: hiddenCover } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
      const { result: album } = await ctx.newAlbum({
        ownerId: owner.id,
        albumName: 'OnlyHidden',
        albumThumbnailAssetId: hiddenCover.id,
      });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: hiddenCover.id });
      await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

      const result = await sut.getLinkedAlbums(authFromUser(owner), space.id);

      expect(result).toHaveLength(1);
      expect(result[0].albumThumbnailAssetId).toBeNull();
    });

    it('positive control: leaves a Timeline (space-visible) cover unchanged', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

      const { asset: cover } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      const { result: album } = await ctx.newAlbum({
        ownerId: owner.id,
        albumName: 'VisibleCover',
        albumThumbnailAssetId: cover.id,
      });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: cover.id });
      await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

      const result = await sut.getLinkedAlbums(authFromUser(owner), space.id);

      expect(result).toHaveLength(1);
      expect(result[0].albumThumbnailAssetId).toBe(cover.id);
    });
  });
});

// getAssetLinkedAlbums powers the web "Remove from space" explanation: when a selected asset isn't a
// direct space member the removal is a no-op, and the web names the album(s) the asset is projected
// through so the user knows where to manage it. It must union BOTH album arms (global `album_asset` +
// cross-owner `album_space_asset` contribution) and only surface albums linked to THIS space.
describe('SharedSpaceService.getAssetLinkedAlbums — which linked albums project an asset', () => {
  it('returns the album for an asset present via album_asset (global album membership)', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'USA Trip' });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const result = await sut.getAssetLinkedAlbums(authFromUser(owner), space.id, { assetIds: [asset.id] });

    expect(result).toEqual([{ albumId: album.id, albumName: 'USA Trip' }]);
  });

  it('returns the album for a cross-owner contribution (album_space_asset)', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: contributor } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: contributor.id, role: 'editor' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Shared Album' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    // The contributor bookmarks their own asset into the linked album — an album_space_asset row, NOT a
    // global album_asset row — so only the contributed arm can surface it.
    const { asset } = await ctx.newAsset({ ownerId: contributor.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

    const result = await sut.getAssetLinkedAlbums(authFromUser(contributor), space.id, { assetIds: [asset.id] });

    expect(result).toEqual([{ albumId: album.id, albumName: 'Shared Album' }]);
  });

  it('returns [] for a direct space member that is not in any linked album', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });

    const result = await sut.getAssetLinkedAlbums(authFromUser(owner), space.id, { assetIds: [asset.id] });

    expect(result).toEqual([]);
  });

  it('returns [] when the asset is in an album that is NOT linked to the space', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Unlinked' });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    // Intentionally NOT linked to the space.

    const result = await sut.getAssetLinkedAlbums(authFromUser(owner), space.id, { assetIds: [asset.id] });

    expect(result).toEqual([]);
  });

  it('rejects a non-member (membership-gated)', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { asset } = await ctx.newAsset({ ownerId: owner.id });

    await expect(
      sut.getAssetLinkedAlbums(authFromUser(stranger), space.id, { assetIds: [asset.id] }),
    ).rejects.toThrow();
  });
});

describe('SharedSpaceService.getAll — albumCount', () => {
  it('counts linked albums per space and excludes soft-deleted albums', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { result: a1 } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'One' });
    const { result: a2 } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Two' });
    const { result: trashed } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Trashed' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: a1.id, addedById: owner.id });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: a2.id, addedById: owner.id });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: trashed.id, addedById: owner.id });
    await ctx.softDeleteAlbum(trashed.id);

    const result = await sut.getAll(authFromUser(owner));

    const target = result.find((s) => s.id === space.id);
    expect(target?.albumCount).toBe(2);
  });

  it('returns albumCount 0 for a space with no linked albums', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const result = await sut.getAll(authFromUser(owner));

    expect(result.find((s) => s.id === space.id)?.albumCount).toBe(0);
  });
});
