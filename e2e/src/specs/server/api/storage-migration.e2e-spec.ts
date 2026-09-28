import { LoginResponseDto } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { errorDto } from 'src/responses';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

describe('/storage-migration', () => {
  let admin: LoginResponseDto;
  let nonAdmin: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    nonAdmin = await utils.userSetup(admin.accessToken, createUserDto.create('storage-migration-routing'));
  });

  describe('GET /storage-migration/routing', () => {
    it('should require authentication', async () => {
      const { status, body } = await request(app).get('/storage-migration/routing');
      expect(status).toBe(401);
      expect(body).toEqual(errorDto.unauthorized);
    });

    it('should require admin', async () => {
      const { status } = await request(app).get('/storage-migration/routing').set(asBearerAuth(nonAdmin.accessToken));
      expect(status).toBe(403);
    });

    it('should report a resolved backend and a count for every kind', async () => {
      const { status, body } = await request(app)
        .get('/storage-migration/routing')
        .set(asBearerAuth(admin.accessToken));

      expect(status).toBe(200);
      for (const kind of ['originals', 'thumbnails', 'encodedVideo']) {
        expect(['disk', 's3']).toContain(body[kind].routedTo);
        expect(body[kind].misplacedCount).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
