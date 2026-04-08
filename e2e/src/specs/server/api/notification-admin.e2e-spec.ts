import { type LoginResponseDto } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// T37 — admin notification + email template happy paths and validation, beyond
// the access matrix that T31 already covers.
//
// Endpoints (notification-admin.controller.ts):
//   POST /admin/notifications              create a notification for a user
//   POST /admin/notifications/test-email   verify SMTP + send a test message
//   POST /admin/notifications/templates/:name  render a template preview
//
// T31 already pinned: auth, admin gate, and the basic create + recipient-sees-it
// happy path. T37 fills in:
//   - Create-side DTO validation (missing title, missing userId, malformed UUID)
//   - Template render happy path (welcome, album-invite, album-update)
//   - test-email failure mode (bogus SMTP) — pins the BadRequestException
//     'Failed to verify SMTP configuration' branch
//
// The test-email success path is NOT covered — it would require a real SMTP
// server in the e2e stack, which is out of scope.

describe('/admin/notifications (T37 — content paths)', () => {
  let admin: LoginResponseDto;
  let user: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    user = await utils.userSetup(admin.accessToken, createUserDto.create('t37-user'));
  });

  describe('POST /admin/notifications — DTO validation', () => {
    it('rejects missing title (ValidateString IsNotEmpty)', async () => {
      const { status } = await request(app)
        .post('/admin/notifications')
        .set(asBearerAuth(admin.accessToken))
        .send({ userId: user.userId });
      expect(status).toBe(400);
    });

    it('rejects missing userId', async () => {
      const { status } = await request(app)
        .post('/admin/notifications')
        .set(asBearerAuth(admin.accessToken))
        .send({ title: 't37 no recipient' });
      expect(status).toBe(400);
    });

    it('rejects malformed userId UUID', async () => {
      const { status } = await request(app)
        .post('/admin/notifications')
        .set(asBearerAuth(admin.accessToken))
        .send({ userId: 'not-a-uuid', title: 't37 bad uuid' });
      expect(status).toBe(400);
    });

    it('rejects an invalid level enum', async () => {
      const { status } = await request(app)
        .post('/admin/notifications')
        .set(asBearerAuth(admin.accessToken))
        .send({ userId: user.userId, title: 't37 bad level', level: 'NOPE' });
      expect(status).toBe(400);
    });

    it('rejects an invalid type enum', async () => {
      const { status } = await request(app)
        .post('/admin/notifications')
        .set(asBearerAuth(admin.accessToken))
        .send({ userId: user.userId, title: 't37 bad type', type: 'NOPE' });
      expect(status).toBe(400);
    });

    it('accepts level=Warning + type=SystemMessage and the persisted notification reflects them', async () => {
      // Positive case to make sure the enum constraints are not blocking
      // legitimate values.
      const create = await request(app).post('/admin/notifications').set(asBearerAuth(admin.accessToken)).send({
        userId: user.userId,
        title: 't37 with level + type',
        level: 'warning',
        type: 'SystemMessage',
      });
      expect(create.status).toBe(201);
      expect(create.body).toEqual(
        expect.objectContaining({
          title: 't37 with level + type',
          level: 'warning',
          type: 'SystemMessage',
        }),
      );
    });
  });

  describe('POST /admin/notifications/templates/:name — render happy paths', () => {
    // Auth + admin gate matrix is already pinned by T31's notification.e2e-spec.ts
    // (see the 'POST /admin/notifications/templates/:name' describe there).
    // T37 only adds the rendering happy paths.

    it('renders the welcome template', async () => {
      // notification-admin.service.ts:65-79 — fills in displayName/username/
      // password placeholders and returns the resolved HTML.
      const { status, body } = await request(app)
        .post('/admin/notifications/templates/welcome')
        .set(asBearerAuth(admin.accessToken))
        .send({ template: '' });
      expect(status).toBe(200);
      expect((body as { name: string; html: string }).name).toBe('welcome');
      expect(typeof (body as { html: string }).html).toBe('string');
      expect((body as { html: string }).html.length).toBeGreaterThan(0);
    });

    it('renders the album-invite template', async () => {
      const { status, body } = await request(app)
        .post('/admin/notifications/templates/album-invite')
        .set(asBearerAuth(admin.accessToken))
        .send({ template: '' });
      expect(status).toBe(200);
      expect((body as { name: string }).name).toBe('album-invite');
      expect((body as { html: string }).html.length).toBeGreaterThan(0);
    });

    it('renders the album-update template', async () => {
      const { status, body } = await request(app)
        .post('/admin/notifications/templates/album-update')
        .set(asBearerAuth(admin.accessToken))
        .send({ template: '' });
      expect(status).toBe(200);
      expect((body as { name: string }).name).toBe('album-update');
      expect((body as { html: string }).html.length).toBeGreaterThan(0);
    });

    it('unknown template name returns the empty fallback (default branch)', async () => {
      // notification-admin.service.ts:112-115 — the default branch returns
      // `templateResponse = ''`. The endpoint returns 200 with `html: ''`.
      // Pin this so a future refactor that switches the default to a 400
      // forces a deliberate update.
      const { status, body } = await request(app)
        .post('/admin/notifications/templates/not-a-real-template')
        .set(asBearerAuth(admin.accessToken))
        .send({ template: '' });
      expect(status).toBe(200);
      expect((body as { name: string; html: string }).name).toBe('not-a-real-template');
      expect((body as { html: string }).html).toBe('');
    });
  });

  describe('POST /admin/notifications/test-email — failure path', () => {
    it('returns 400 when SMTP verification fails (bogus host)', async () => {
      // notification-admin.service.ts:32-35 — verifySmtp throws, the service
      // catches and re-throws as BadRequestException('Failed to verify SMTP
      // configuration'). The success path requires a real SMTP server in the
      // e2e stack, which is out of scope.
      const { status, body } = await request(app)
        .post('/admin/notifications/test-email')
        .set(asBearerAuth(admin.accessToken))
        .send({
          enabled: true,
          from: 'noreply@example.com',
          replyTo: 'noreply@example.com',
          transport: {
            host: '127.0.0.1',
            port: 1, // unreachable
            secure: false,
            ignoreCert: true,
            username: '',
            password: '',
          },
        });
      expect(status).toBe(400);
      expect((body as { message: string }).message).toBe('Failed to verify SMTP configuration');
    });
  });
});
