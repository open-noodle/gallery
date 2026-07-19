import {
  ActivityCreateDto,
  AlbumUserRole,
  LoginResponseDto,
  ReactionType,
  SharedSpaceRole,
  createActivity as create,
  getActivityStatistics,
} from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

describe('/activities', () => {
  let admin: LoginResponseDto;

  const createActivity = (dto: ActivityCreateDto, accessToken?: string) =>
    create({ activityCreateDto: dto }, { headers: asBearerAuth(accessToken || admin.accessToken) });

  beforeAll(async () => {
    await utils.resetDatabase();

    admin = await utils.adminSetup();
  });

  beforeEach(async () => {
    await utils.resetDatabase(['activity']);
  });

  describe('GET /activities (space-linked album) — album-level activity denied to space-only readers (C1)', () => {
    it('space Viewer sees asset-level activity on a visible asset but NOT album-level comments', async () => {
      const spaceOwner = admin; // album owner
      const spaceViewer = await utils.userSetup(admin.accessToken, createUserDto.create('c1-space-viewer'));
      const c1Asset = await utils.createAsset(spaceOwner.accessToken);
      const c1Album = await utils.createAlbum(spaceOwner.accessToken, {
        albumName: 'C1 Album',
        assetIds: [c1Asset.id],
      });

      // album-level comment (no assetId) + asset-level comment (assetId set)
      await createActivity(
        { albumId: c1Album.id, type: ReactionType.Comment, comment: 'album-level secret' },
        spaceOwner.accessToken,
      );
      await createActivity(
        { albumId: c1Album.id, assetId: c1Asset.id, type: ReactionType.Comment, comment: 'on the photo' },
        spaceOwner.accessToken,
      );

      const space = await utils.createSpace(spaceOwner.accessToken, { name: 'C1 Space' });
      await utils.addSpaceMember(spaceOwner.accessToken, space.id, {
        userId: spaceViewer.userId,
        role: SharedSpaceRole.Viewer,
      });
      await utils.linkSpaceAlbum(spaceOwner.accessToken, space.id, c1Album.id);

      const asMember = await request(app)
        .get('/activities')
        .query({ albumId: c1Album.id })
        .set('Authorization', `Bearer ${spaceViewer.accessToken}`);
      expect(asMember.status).toBe(200);
      expect(asMember.body.map((a: { assetId: string | null }) => a.assetId)).toEqual([c1Asset.id]);
      expect(asMember.body.some((a: { comment?: string }) => a.comment === 'album-level secret')).toBe(false);

      const asOwner = await request(app)
        .get('/activities')
        .query({ albumId: c1Album.id })
        .set('Authorization', `Bearer ${spaceOwner.accessToken}`);
      expect(asOwner.body).toHaveLength(2); // owner sees both
    });

    it('redacts commenter/liker email on asset-level activity for a space-only reader; keeps it for an album participant (M5)', async () => {
      const spaceOwner = admin; // album owner
      const spaceViewer = await utils.userSetup(admin.accessToken, createUserDto.create('m5-space-viewer'));
      const participant = await utils.userSetup(admin.accessToken, createUserDto.create('m5-participant'));
      const m5Asset = await utils.createAsset(spaceOwner.accessToken);
      const m5Album = await utils.createAlbum(spaceOwner.accessToken, {
        albumName: 'M5 Album',
        assetIds: [m5Asset.id],
        albumUsers: [{ userId: participant.userId, role: AlbumUserRole.Viewer }],
      });

      await createActivity(
        { albumId: m5Album.id, assetId: m5Asset.id, type: ReactionType.Comment, comment: 'nice shot' },
        spaceOwner.accessToken,
      );
      await createActivity(
        { albumId: m5Album.id, assetId: m5Asset.id, type: ReactionType.Like },
        spaceOwner.accessToken,
      );

      const space = await utils.createSpace(spaceOwner.accessToken, { name: 'M5 Space' });
      await utils.addSpaceMember(spaceOwner.accessToken, space.id, {
        userId: spaceViewer.userId,
        role: SharedSpaceRole.Viewer,
      });
      await utils.linkSpaceAlbum(spaceOwner.accessToken, space.id, m5Album.id);

      // Negative: a space Viewer (no direct album access) sees both activities but with the
      // commenter/liker email redacted — name/id/avatarColor are still present.
      const asSpaceViewer = await request(app)
        .get('/activities')
        .query({ albumId: m5Album.id })
        .set('Authorization', `Bearer ${spaceViewer.accessToken}`);
      expect(asSpaceViewer.status).toBe(200);
      expect(asSpaceViewer.body).toHaveLength(2);
      for (const activity of asSpaceViewer.body) {
        expect(activity.user.email).toBe('');
        expect(activity.user.name).toBeTruthy();
        expect(activity.user.id).toBeTruthy();
        expect(activity.user.avatarColor).toBeTruthy();
      }

      // Positive control: an album participant (shared album_user) has direct access and sees the
      // real email.
      const asParticipant = await request(app)
        .get('/activities')
        .query({ albumId: m5Album.id })
        .set('Authorization', `Bearer ${participant.accessToken}`);
      expect(asParticipant.status).toBe(200);
      expect(asParticipant.body).toHaveLength(2);
      for (const activity of asParticipant.body) {
        expect(activity.user.email).toBe(spaceOwner.userEmail);
      }
    });

    // I2: GET /activities/statistics gates on the same AlbumRead as GET /activities (C1) but
    // returned the aggregate {comments, likes} count INCLUDING album-level (assetId null) rows to
    // space-only readers. Scope it the same way C1 scopes content.
    it('excludes album-level counts from GET /activities/statistics for a space-only reader; includes them for a direct reader', async () => {
      const spaceOwner = admin; // album owner
      const spaceViewer = await utils.userSetup(admin.accessToken, createUserDto.create('i2-space-viewer'));
      const participant = await utils.userSetup(admin.accessToken, createUserDto.create('i2-participant'));
      const i2Asset = await utils.createAsset(spaceOwner.accessToken);
      const i2Album = await utils.createAlbum(spaceOwner.accessToken, {
        albumName: 'I2 Album',
        assetIds: [i2Asset.id],
        albumUsers: [{ userId: participant.userId, role: AlbumUserRole.Viewer }],
      });

      // album-level like (no assetId) + asset-level comment (assetId set)
      await createActivity({ albumId: i2Album.id, type: ReactionType.Like }, spaceOwner.accessToken);
      await createActivity(
        { albumId: i2Album.id, assetId: i2Asset.id, type: ReactionType.Comment, comment: 'on the photo' },
        spaceOwner.accessToken,
      );

      const space = await utils.createSpace(spaceOwner.accessToken, { name: 'I2 Space' });
      await utils.addSpaceMember(spaceOwner.accessToken, space.id, {
        userId: spaceViewer.userId,
        role: SharedSpaceRole.Viewer,
      });
      await utils.linkSpaceAlbum(spaceOwner.accessToken, space.id, i2Album.id);

      // Negative: a space Viewer (no direct album access) sees the asset-level comment count but
      // NOT the album-level like.
      const asSpaceViewer = await getActivityStatistics(
        { albumId: i2Album.id },
        { headers: asBearerAuth(spaceViewer.accessToken) },
      );
      expect(asSpaceViewer).toEqual({ comments: 1, likes: 0 });

      // Positive control: an album participant (shared album_user) has direct access and sees the
      // full count, including the album-level like.
      const asParticipant = await getActivityStatistics(
        { albumId: i2Album.id },
        { headers: asBearerAuth(participant.accessToken) },
      );
      expect(asParticipant).toEqual({ comments: 1, likes: 1 });
    });
  });
});
