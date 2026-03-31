import { LoginResponseDto, QueueCommand } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { errorDto } from 'src/responses';
import { app, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

describe('/classification', () => {
  let admin: LoginResponseDto;
  let user: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();

    admin = await utils.adminSetup();
    user = await utils.userSetup(admin.accessToken, createUserDto.user1);
  });

  describe('POST /classification/scan', () => {
    it('should require authentication', async () => {
      const { status, body } = await request(app).post('/classification/scan');
      expect(status).toBe(401);
      expect(body).toEqual(errorDto.unauthorized);
    });

    it('should require admin access', async () => {
      const { status, body } = await request(app)
        .post('/classification/scan')
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(status).toBe(403);
      expect(body).toEqual(errorDto.forbidden);
    });

    it('should return 204 for admin', async () => {
      const { status } = await request(app)
        .post('/classification/scan')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(204);
    });
  });

  describe('Queue Operations', () => {
    it('should list classification in queues', async () => {
      const { status, body } = await request(app).get('/jobs').set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(body).toHaveProperty('classification');
    });

    it('should accept start command on classification queue', async () => {
      const { status, body } = await request(app)
        .put('/jobs/classification')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ command: QueueCommand.Start, force: false });

      expect(status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          queueStatus: expect.objectContaining({ isPaused: false }),
        }),
      );

      await utils.waitForQueueFinish(admin.accessToken, 'classification');
    });

    it('should accept start command with force on classification queue', async () => {
      const { status, body } = await request(app)
        .put('/jobs/classification')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ command: QueueCommand.Start, force: true });

      expect(status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          queueStatus: expect.objectContaining({ isPaused: false }),
        }),
      );

      await utils.waitForQueueFinish(admin.accessToken, 'classification');
    });

    it('should trigger job via scan endpoint and complete', async () => {
      const { status } = await request(app)
        .post('/classification/scan')
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(204);

      await utils.waitForQueueFinish(admin.accessToken, 'classification');
    });
  });
});
