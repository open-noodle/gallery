import { BadRequestException } from '@nestjs/common';
import { ReactionType } from 'src/dtos/activity.dto';
import { ActivityService } from 'src/services/activity.service';
import { ActivityFactory } from 'test/factories/activity.factory';
import { AuthFactory } from 'test/factories/auth.factory';
import { getForActivity } from 'test/mappers';
import { newUuid, newUuids } from 'test/small.factory';
import { newTestService, ServiceMocks } from 'test/utils';

describe(ActivityService.name, () => {
  let sut: ActivityService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(ActivityService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('getAll', () => {
    it('should get all', async () => {
      const [albumId, assetId, userId] = newUuids();

      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.activity.search.mockResolvedValue([]);

      await expect(sut.getAll(AuthFactory.create({ id: userId }), { assetId, albumId })).resolves.toEqual([]);

      expect(mocks.activity.search).toHaveBeenCalledWith({ assetId, albumId, isLiked: undefined });
    });

    it('should filter by type=like', async () => {
      const [albumId, assetId, userId] = newUuids();

      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.activity.search.mockResolvedValue([]);

      await expect(
        sut.getAll(AuthFactory.create({ id: userId }), { assetId, albumId, type: ReactionType.LIKE }),
      ).resolves.toEqual([]);

      expect(mocks.activity.search).toHaveBeenCalledWith({ assetId, albumId, isLiked: true });
    });

    it('should filter by type=comment', async () => {
      const [albumId, assetId] = newUuids();

      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.activity.search.mockResolvedValue([]);

      await expect(sut.getAll(AuthFactory.create(), { assetId, albumId, type: ReactionType.COMMENT })).resolves.toEqual(
        [],
      );

      expect(mocks.activity.search).toHaveBeenCalledWith({ assetId, albumId, isLiked: false });
    });

    it('drops album-level activity for a space-only reader; keeps asset-level activity on visible assets (C1)', async () => {
      const [albumId, assetId, userId] = newUuids();
      const albumLevel = getForActivity(ActivityFactory.create({ albumId, assetId: null, userId }));
      const assetLevel = getForActivity(ActivityFactory.create({ albumId, assetId, userId }));

      // AlbumRead granted ONLY via the space-linked arm (not owner, not shared album_user).
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSpaceLinkedAlbumReadAccess.mockResolvedValue(new Set([albumId]));
      mocks.activity.search.mockResolvedValue([albumLevel, assetLevel]);

      const result = await sut.getAll(AuthFactory.create({ id: userId }), { albumId });

      expect(result.map((a) => a.assetId)).toEqual([assetId]);
      expect(result.some((a) => a.assetId === null)).toBe(false);
    });

    it('keeps album-level activity for the album owner (direct access wins over the space arm) (C1)', async () => {
      const [albumId, assetId, userId] = newUuids();
      const albumLevel = getForActivity(ActivityFactory.create({ albumId, assetId: null, userId }));
      const assetLevel = getForActivity(ActivityFactory.create({ albumId, assetId, userId }));

      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.activity.search.mockResolvedValue([albumLevel, assetLevel]);

      const result = await sut.getAll(AuthFactory.create({ id: userId }), { albumId });

      expect(result).toHaveLength(2);
      expect(result.some((a) => a.assetId === null)).toBe(true);
    });

    it('keeps album-level activity for a shared album participant who is also a space member (C1)', async () => {
      const [albumId, userId] = newUuids();
      const albumLevel = getForActivity(ActivityFactory.create({ albumId, assetId: null, userId }));

      // Not owner, but a shared album_user (Viewer+) — participant path wins.
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([albumId]));
      mocks.access.album.checkSpaceLinkedAlbumReadAccess.mockResolvedValue(new Set([albumId]));
      mocks.activity.search.mockResolvedValue([albumLevel]);

      const result = await sut.getAll(AuthFactory.create({ id: userId }), { albumId });

      expect(result).toHaveLength(1);
    });

    it('redacts commenter/liker email from asset-level activity for a space-only reader (M5)', async () => {
      const [albumId, assetId, commenterId, likerId, userId] = newUuids();
      const comment = getForActivity(
        ActivityFactory.create({ albumId, assetId, userId: commenterId, comment: 'nice shot' }),
      );
      const like = getForActivity(ActivityFactory.create({ albumId, assetId, userId: likerId, isLiked: true }));

      // AlbumRead granted ONLY via the space-linked arm (not owner, not shared album_user) — same
      // access shape as the C1 space-only-reader test above.
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSpaceLinkedAlbumReadAccess.mockResolvedValue(new Set([albumId]));
      mocks.activity.search.mockResolvedValue([comment, like]);

      const result = await sut.getAll(AuthFactory.create({ id: userId }), { albumId });

      expect(result).toHaveLength(2);
      for (const activity of result) {
        expect(activity.user.email).toBe('');
        expect(activity.user.name).toBeTruthy();
        expect(activity.user.id).toBeTruthy();
        expect(activity.user.avatarColor).toBeTruthy();
      }
    });

    it('keeps the real commenter/liker email for a direct reader (positive control) (M5)', async () => {
      const [albumId, assetId, commenterId, likerId, userId] = newUuids();
      const comment = getForActivity(
        ActivityFactory.create({ albumId, assetId, userId: commenterId, comment: 'nice shot' }),
      );
      const like = getForActivity(ActivityFactory.create({ albumId, assetId, userId: likerId, isLiked: true }));

      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.activity.search.mockResolvedValue([comment, like]);

      const result = await sut.getAll(AuthFactory.create({ id: userId }), { albumId });

      expect(result).toHaveLength(2);
      const commentResult = result.find((a) => a.type === 'comment');
      const likeResult = result.find((a) => a.type === 'like');
      expect(commentResult?.user.email).toBe(comment.user.email);
      expect(likeResult?.user.email).toBe(like.user.email);
    });
  });

  describe('getStatistics', () => {
    it('should get the comment and like count', async () => {
      const [albumId, assetId] = newUuids();

      mocks.activity.getStatistics.mockResolvedValue({ comments: 1, likes: 3 });
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));

      await expect(sut.getStatistics(AuthFactory.create(), { assetId, albumId })).resolves.toEqual({
        comments: 1,
        likes: 3,
      });
    });

    // I2: getStatistics gates on the same AlbumRead as getAll (C1) but returned album-level
    // (assetId null) comment/like counts to space-only readers unconditionally. Scope it the
    // same way C1 scopes content: hasDirectAccess (owner/shared album_user/shared-link) sees
    // album-level counts; a space-only reader does not.
    it('excludes album-level counts for a space-only reader (I2)', async () => {
      const [albumId, userId] = newUuids();

      // AlbumRead granted ONLY via the space-linked arm (not owner, not shared album_user) — same
      // access shape as the C1 space-only-reader test above.
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSpaceLinkedAlbumReadAccess.mockResolvedValue(new Set([albumId]));
      mocks.activity.getStatistics.mockResolvedValue({ comments: 1, likes: 0 });

      await sut.getStatistics(AuthFactory.create({ id: userId }), { albumId });

      expect(mocks.activity.getStatistics).toHaveBeenCalledWith({
        albumId,
        assetId: undefined,
        excludeAlbumLevel: true,
      });
    });

    it('includes album-level counts for a direct reader (positive control) (I2)', async () => {
      const [albumId, assetId] = newUuids();

      mocks.activity.getStatistics.mockResolvedValue({ comments: 1, likes: 3 });
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));

      await sut.getStatistics(AuthFactory.create(), { assetId, albumId });

      expect(mocks.activity.getStatistics).toHaveBeenCalledWith({ albumId, assetId, excludeAlbumLevel: false });
    });
  });

  describe('addComment', () => {
    it('should require access to the album', async () => {
      const [albumId, assetId] = newUuids();

      await expect(
        sut.create(AuthFactory.create(), { albumId, assetId, type: ReactionType.COMMENT, comment: 'comment' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should create a comment', async () => {
      const [albumId, assetId, userId] = newUuids();
      const activity = ActivityFactory.create({ albumId, assetId, userId });

      mocks.access.activity.checkCreateAccess.mockResolvedValue(new Set([albumId]));
      mocks.activity.create.mockResolvedValue(getForActivity(activity));

      await sut.create(AuthFactory.create({ id: userId }), {
        albumId,
        assetId,
        type: ReactionType.COMMENT,
        comment: 'comment',
      });

      expect(mocks.activity.create).toHaveBeenCalledWith({
        userId: activity.userId,
        albumId: activity.albumId,
        assetId: activity.assetId,
        comment: 'comment',
        isLiked: false,
      });
    });

    it('should fail because activity is disabled for the album', async () => {
      const [albumId, assetId] = newUuids();
      const activity = ActivityFactory.create({ albumId, assetId });

      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.activity.create.mockResolvedValue(getForActivity(activity));

      await expect(
        sut.create(AuthFactory.create(), { albumId, assetId, type: ReactionType.COMMENT, comment: 'comment' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should create a like', async () => {
      const [albumId, assetId, userId] = newUuids();
      const activity = ActivityFactory.create({ userId, albumId, assetId, isLiked: true });

      mocks.access.activity.checkCreateAccess.mockResolvedValue(new Set([albumId]));
      mocks.activity.create.mockResolvedValue(getForActivity(activity));
      mocks.activity.search.mockResolvedValue([]);

      await sut.create(AuthFactory.create({ id: userId }), { albumId, assetId, type: ReactionType.LIKE });

      expect(mocks.activity.create).toHaveBeenCalledWith({ userId: activity.userId, albumId, assetId, isLiked: true });
    });

    it('should skip if like exists', async () => {
      const [albumId, assetId] = newUuids();
      const activity = ActivityFactory.create({ albumId, assetId, isLiked: true });

      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.access.activity.checkCreateAccess.mockResolvedValue(new Set([albumId]));
      mocks.activity.search.mockResolvedValue([getForActivity(activity)]);

      await sut.create(AuthFactory.create(), { albumId, assetId, type: ReactionType.LIKE });

      expect(mocks.activity.create).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should require access', async () => {
      await expect(sut.delete(AuthFactory.create(), newUuid())).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.activity.delete).not.toHaveBeenCalled();
    });

    it('should let the activity owner delete a comment', async () => {
      const activity = ActivityFactory.create();

      mocks.access.activity.checkOwnerAccess.mockResolvedValue(new Set([activity.id]));
      mocks.activity.delete.mockResolvedValue();

      await sut.delete(AuthFactory.create(), activity.id);

      expect(mocks.activity.delete).toHaveBeenCalledWith(activity.id);
    });

    it('should let the album owner delete a comment', async () => {
      const activity = ActivityFactory.create();

      mocks.access.activity.checkAlbumOwnerAccess.mockResolvedValue(new Set([activity.id]));
      mocks.activity.delete.mockResolvedValue();

      await sut.delete(AuthFactory.create(), activity.id);

      expect(mocks.activity.delete).toHaveBeenCalledWith(activity.id);
    });
  });
});
