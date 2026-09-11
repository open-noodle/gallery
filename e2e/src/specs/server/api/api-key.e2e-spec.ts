import { LoginResponseDto, Permission, createApiKey } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { errorDto } from 'src/responses';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const create = (accessToken: string, permissions: Permission[]) =>
  createApiKey({ apiKeyCreateDto: { name: 'api key', permissions } }, { headers: asBearerAuth(accessToken) });

describe('/api-keys', () => {
  let admin: LoginResponseDto;
  let user: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();

    admin = await utils.adminSetup();
    user = await utils.userSetup(admin.accessToken, createUserDto.user1);
  });

  beforeEach(async () => {
    await utils.resetDatabase(['api_key']);
  });

  describe('POST /api-keys', () => {
    it('should work with apiKey.create', async () => {
      const { secret } = await create(user.accessToken, [Permission.ApiKeyCreate, Permission.ApiKeyRead]);
      const { status, body } = await request(app)
        .post('/api-keys')
        .set('x-api-key', secret)
        .send({
          name: 'API Key',
          permissions: [Permission.ApiKeyRead],
        });
      expect(body).toEqual({
        id: expect.any(String),
        name: 'API Key',
        permissions: [Permission.ApiKeyRead],
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        secret: expect.any(String),
        // TODO: remove in v4
        apiKey: expect.any(Object),
      });
      expect(status).toBe(201);
    });

    it('should not create an api key with all permissions', async () => {
      const { secret } = await create(user.accessToken, [Permission.ApiKeyCreate]);
      const { status, body } = await request(app)
        .post('/api-keys')
        .set('x-api-key', secret)
        .send({ name: 'API Key', permissions: [Permission.All] });
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Cannot grant permissions you do not have'));
    });

    it('should not create an api key with more permissions', async () => {
      const { secret } = await create(user.accessToken, [Permission.ApiKeyCreate]);
      const { status, body } = await request(app)
        .post('/api-keys')
        .set('x-api-key', secret)
        .send({ name: 'API Key', permissions: [Permission.ApiKeyRead] });
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Cannot grant permissions you do not have'));
    });

    it('should create an api key', async () => {
      const { status, body } = await request(app)
        .post('/api-keys')
        .send({ name: 'API Key', permissions: [Permission.All] })
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(body).toEqual({
        id: expect.any(String),
        name: 'API Key',
        permissions: [Permission.All],
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        secret: expect.any(String),
        // TODO: remove in v4
        apiKey: expect.any(Object),
      });
      expect(status).toEqual(201);
    });
  });

  describe('GET /api-keys', () => {
    it('should start off empty', async () => {
      const { status, body } = await request(app).get('/api-keys').set('Authorization', `Bearer ${admin.accessToken}`);
      expect(body).toEqual([]);
      expect(status).toEqual(200);
    });

    it('should return a list of api keys', async () => {
      const [apiKey1, apiKey2, apiKey3] = await Promise.all([
        create(admin.accessToken, [Permission.All]),
        create(admin.accessToken, [Permission.All]),
        create(admin.accessToken, [Permission.All]),
      ]);

      const { status, body } = await request(app).get('/api-keys').set('Authorization', `Bearer ${admin.accessToken}`);
      expect(body).toHaveLength(3);
      expect(body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: apiKey1.id }),
          expect.objectContaining({ id: apiKey2.id }),
          expect.objectContaining({ id: apiKey3.id }),
        ]),
      );
      expect(status).toEqual(200);
    });
  });

  describe('GET /api-keys/:id', () => {
    it('should get api key details', async () => {
      const { id } = await create(user.accessToken, [Permission.All]);
      const { status, body } = await request(app)
        .get(`/api-keys/${id}`)
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(status).toBe(200);
      expect(body).toEqual({
        id: expect.any(String),
        name: 'api key',
        permissions: [Permission.All],
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });
  });

  describe('PUT /api-keys/:id', () => {
    it('should update api key details', async () => {
      const { id } = await create(user.accessToken, [Permission.All]);
      const { status, body } = await request(app)
        .put(`/api-keys/${id}`)
        .send({
          name: 'new name',
          permissions: [Permission.ActivityCreate, Permission.ActivityRead, Permission.ActivityUpdate],
        })
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(status).toBe(200);
      expect(body).toEqual({
        id: expect.any(String),
        name: 'new name',
        permissions: [Permission.ActivityCreate, Permission.ActivityRead, Permission.ActivityUpdate],
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });
  });

  describe('DELETE /api-keys/:id', () => {
    it('should delete an api key', async () => {
      const { id } = await create(user.accessToken, [Permission.All]);
      const { status } = await request(app)
        .delete(`/api-keys/${id}`)
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(status).toBe(204);
    });
  });

  describe('authentication', () => {
    it('should work as a header', async () => {
      const { secret } = await create(user.accessToken, [Permission.All]);
      const { status, body } = await request(app).get('/api-keys').set('x-api-key', secret);
      expect(body).toHaveLength(1);
      expect(status).toBe(200);
    });

    it('should work as a query param', async () => {
      const { secret } = await create(user.accessToken, [Permission.All]);
      const { status, body } = await request(app).get(`/api-keys?apiKey=${secret}`);
      expect(body).toHaveLength(1);
      expect(status).toBe(200);
    });
  });

  describe('game permission', () => {
    // Every game route used to be gated on sharedSpace.read/Update, so a solo player's API key had
    // to carry shared-space scope just to play alone. GET .../games only needs membership (checked
    // in GameService, not here) - listing as the space's own owner (a member by construction) with
    // nothing but game.read proves the route no longer demands sharedSpace.read.
    it('lets a game-scoped API key list a space it belongs to, without any shared-space permission', async () => {
      const space = await utils.createSpace(user.accessToken, { name: 'api-key-game-space' });
      const key = await utils.createApiKey(user.accessToken, [Permission.GameRead]);

      const { status } = await request(app).get(`/shared-spaces/${space.id}/games`).set('x-api-key', key.secret);

      expect(status, 'a game-scoped key must not need sharedSpace.read').toBe(200);
    });

    // The solo half of the same rule, and the one the permission exists for: this route takes no
    // space at all, so a key that could read it only by also carrying sharedSpace.read would be
    // demanding scope over a feature the player may never have used.
    it('lets a game-scoped API key read solo stats, with no shared space anywhere', async () => {
      const key = await utils.createApiKey(user.accessToken, [Permission.GameRead]);

      const { status } = await request(app).get('/games/solo/stats').set('x-api-key', key.secret);

      expect(status, 'a solo game must not need sharedSpace.read').toBe(200);
    });
  });
});
