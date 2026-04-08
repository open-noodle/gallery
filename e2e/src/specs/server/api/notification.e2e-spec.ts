import { type LoginResponseDto } from '@immich/sdk';
import { type Actor, authHeaders } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { errorDto } from 'src/responses';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// T31 — coverage for /notifications and /admin/notifications, neither of which
// has any existing e2e coverage.
//
// Service shape (notification.service.ts + notification-admin.service.ts):
//   /notifications GET/PUT/DELETE — scoped to auth.user.id, no requireAccess.
//     Cross-user IDs surface as 400 ('Notification not found') from the service.
//   /admin/notifications POST/test-email/templates — admin-only via @Authenticated.
//
// The admin-create endpoint is the only way to seed a notification from a test
// (no auto-emit hook is reliable enough to use as a fixture).

describe('/notifications', () => {
  let admin: LoginResponseDto;
  let userA: LoginResponseDto;
  let userB: LoginResponseDto;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    [userA, userB] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('t31-userA')),
      utils.userSetup(admin.accessToken, createUserDto.create('t31-userB')),
    ]);
  });

  // Helper: admin creates a notification for the given user via POST /admin/notifications.
  const seedNotification = async (recipient: LoginResponseDto, title = 't31 seeded') => {
    const { status, body } = await request(app)
      .post('/admin/notifications')
      .set(asBearerAuth(admin.accessToken))
      .send({ userId: recipient.userId, title });
    expect(status).toBe(201);
    return (body as { id: string }).id;
  };

  describe('GET /notifications', () => {
    it('requires authentication', async () => {
      const { status, body } = await request(app).get('/notifications').set(authHeaders(anonActor));
      expect(status).toBe(401);
      expect(body).toEqual(errorDto.unauthorized);
    });

    it('owner sees their own seeded notification', async () => {
      const id = await seedNotification(userA, 't31 list test');
      const { status, body } = await request(app).get('/notifications').set(asBearerAuth(userA.accessToken));
      expect(status).toBe(200);
      const ids = (body as Array<{ id: string }>).map((n) => n.id);
      expect(ids).toContain(id);
    });

    it("cross-user isolation: userB does not see userA's notifications", async () => {
      // Seed at least one notification for EACH user so the no-overlap loop is
      // load-bearing — if userB had none, the assertion would pass vacuously
      // even if scoping were broken.
      const aId = await seedNotification(userA, 't31 isolation-A');
      const bId = await seedNotification(userB, 't31 isolation-B');

      const aList = await request(app).get('/notifications').set(asBearerAuth(userA.accessToken));
      const aIds = (aList.body as Array<{ id: string }>).map((n) => n.id);
      const bList = await request(app).get('/notifications').set(asBearerAuth(userB.accessToken));
      const bIds = (bList.body as Array<{ id: string }>).map((n) => n.id);

      expect(aIds).toContain(aId);
      expect(bIds).toContain(bId);
      // Each list contains at least one item — no vacuous pass possible.
      expect(aIds.length).toBeGreaterThan(0);
      expect(bIds.length).toBeGreaterThan(0);

      // No overlap in either direction.
      for (const id of aIds) {
        expect(bIds).not.toContain(id);
      }
      for (const id of bIds) {
        expect(aIds).not.toContain(id);
      }
    });
  });

  describe('GET /notifications/:id', () => {
    // UPSTREAM BUG: notification.repository.ts:65-72 — `get(id)` uses
    // `WHERE deletedAt IS NOT NULL` (it should be `IS NULL`). The GET single
    // endpoint therefore returns 400 ('Notification not found') for ALL
    // active notifications. The list endpoint at line 39-54 uses the correct
    // `IS NULL` filter, so the only practical impact is that no caller can
    // ever fetch a single notification by id without first soft-deleting it.
    //
    // T31 pins the BROKEN behavior so a future upstream fix will fail this
    // test and prompt a deliberate update. Filed upstream as
    // a candidate fix; see notification.repository.ts:70.
    it('UPSTREAM BUG: owner GET single returns 400 for an active notification', async () => {
      const id = await seedNotification(userA, 't31 get-single');
      const { status } = await request(app).get(`/notifications/${id}`).set(asBearerAuth(userA.accessToken));
      // Bug: should be 200 with the notification body. Currently 400.
      expect(status).toBe(400);
    });

    it('cross-user GET also returns 400', async () => {
      // For a NON-owner, the access check itself fails first (via
      // checkOwnerAccess), so this also returns 400 — but for a DIFFERENT
      // reason than the owner case. Pinning the same status code for both
      // is fine; the underlying mechanism diverges only when the upstream
      // bug is fixed.
      const id = await seedNotification(userA, 't31 cross-user-get');
      const { status } = await request(app).get(`/notifications/${id}`).set(asBearerAuth(userB.accessToken));
      expect(status).toBe(400);
    });
  });

  describe('PUT /notifications/:id', () => {
    it('owner can mark as read', async () => {
      const id = await seedNotification(userA, 't31 mark-read');
      const { status, body } = await request(app)
        .put(`/notifications/${id}`)
        .set(asBearerAuth(userA.accessToken))
        .send({ readAt: new Date().toISOString() });
      expect(status).toBe(200);
      expect((body as { readAt: string | null }).readAt).not.toBeNull();
    });

    it('cross-user PUT returns 400', async () => {
      const id = await seedNotification(userA, 't31 cross-user-put');
      const { status } = await request(app)
        .put(`/notifications/${id}`)
        .set(asBearerAuth(userB.accessToken))
        .send({ readAt: new Date().toISOString() });
      expect(status).toBe(400);
    });
  });

  describe('DELETE /notifications/:id', () => {
    it('owner can delete and the notification disappears from the listing', async () => {
      const id = await seedNotification(userA, 't31 delete-single');
      const del = await request(app).delete(`/notifications/${id}`).set(asBearerAuth(userA.accessToken));
      expect(del.status).toBe(204);

      const list = await request(app).get('/notifications').set(asBearerAuth(userA.accessToken));
      const ids = (list.body as Array<{ id: string }>).map((n) => n.id);
      expect(ids).not.toContain(id);
    });
  });

  describe('PUT /notifications (bulk)', () => {
    it('bulk-marks multiple notifications as read', async () => {
      const id1 = await seedNotification(userA, 't31 bulk-read-1');
      const id2 = await seedNotification(userA, 't31 bulk-read-2');

      const { status } = await request(app)
        .put('/notifications')
        .set(asBearerAuth(userA.accessToken))
        .send({ ids: [id1, id2], readAt: new Date().toISOString() });
      expect(status).toBe(204);

      // Verify via the LIST endpoint, NOT GET-single (which is upstream-broken
      // — see the UPSTREAM BUG note in the GET /notifications/:id describe).
      // The list endpoint correctly filters with `IS NULL` and returns the
      // updated readAt values.
      const list = await request(app).get('/notifications').set(asBearerAuth(userA.accessToken));
      expect(list.status).toBe(200);
      const items = list.body as Array<{ id: string; readAt: string | null }>;
      const item1 = items.find((n) => n.id === id1);
      const item2 = items.find((n) => n.id === id2);
      expect(item1).toBeDefined();
      expect(item2).toBeDefined();
      expect(item1!.readAt).not.toBeNull();
      expect(item2!.readAt).not.toBeNull();
    });

    it('bulk PUT requires non-empty ids (ArrayMinSize)', async () => {
      const { status } = await request(app)
        .put('/notifications')
        .set(asBearerAuth(userA.accessToken))
        .send({ ids: [], readAt: new Date().toISOString() });
      expect(status).toBe(400);
    });
  });

  describe('DELETE /notifications (bulk)', () => {
    it('bulk-deletes multiple notifications', async () => {
      const id1 = await seedNotification(userA, 't31 bulk-del-1');
      const id2 = await seedNotification(userA, 't31 bulk-del-2');

      const { status } = await request(app)
        .delete('/notifications')
        .set(asBearerAuth(userA.accessToken))
        .send({ ids: [id1, id2] });
      expect(status).toBe(204);

      const list = await request(app).get('/notifications').set(asBearerAuth(userA.accessToken));
      const ids = (list.body as Array<{ id: string }>).map((n) => n.id);
      expect(ids).not.toContain(id1);
      expect(ids).not.toContain(id2);
    });
  });

  describe('POST /admin/notifications', () => {
    it('requires authentication', async () => {
      const { status } = await request(app)
        .post('/admin/notifications')
        .set(authHeaders(anonActor))
        .send({ userId: userA.userId, title: 't31 anon-create' });
      expect(status).toBe(401);
    });

    it('non-admin returns 403', async () => {
      const { status } = await request(app)
        .post('/admin/notifications')
        .set(asBearerAuth(userA.accessToken))
        .send({ userId: userA.userId, title: 't31 user-create' });
      expect(status).toBe(403);
    });

    it('admin can create a notification for another user — recipient sees it', async () => {
      const create = await request(app)
        .post('/admin/notifications')
        .set(asBearerAuth(admin.accessToken))
        .send({ userId: userB.userId, title: 't31 admin-create-for-B', description: 'hello B' });
      expect(create.status).toBe(201);
      const createdId = (create.body as { id: string }).id;

      const list = await request(app).get('/notifications').set(asBearerAuth(userB.accessToken));
      const ids = (list.body as Array<{ id: string }>).map((n) => n.id);
      expect(ids).toContain(createdId);
    });
  });

  describe('POST /admin/notifications/test-email', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).post('/admin/notifications/test-email').set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it('non-admin returns 403', async () => {
      const { status } = await request(app)
        .post('/admin/notifications/test-email')
        .set(asBearerAuth(userA.accessToken))
        .send({
          host: 'localhost',
          port: 25,
          username: '',
          password: '',
          from: 'noreply@example.com',
          ignoreCert: true,
        });
      expect(status).toBe(403);
    });
  });

  describe('POST /admin/notifications/templates/:name', () => {
    it('requires authentication', async () => {
      const { status } = await request(app)
        .post('/admin/notifications/templates/welcome')
        .set(authHeaders(anonActor))
        .send({ template: 'Hello' });
      expect(status).toBe(401);
    });

    it('non-admin returns 403', async () => {
      const { status } = await request(app)
        .post('/admin/notifications/templates/welcome')
        .set(asBearerAuth(userA.accessToken))
        .send({ template: 'Hello' });
      expect(status).toBe(403);
    });
  });
});
