import { type LoginResponseDto } from '@immich/sdk';
import { type Actor, authHeaders } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// T39 — coverage for the auth controller endpoints that aren't pinned at the
// e2e level: change-password, pin-code lifecycle (setup/change/reset), session
// lock/unlock, and the auth status endpoint.
//
// Per-test fresh users are created so password mutations don't pollute each
// other's state. Each fresh user starts with the createUserDto.create-derived
// password (which is `password-${key}`, NOT just 'password').

const NEW_PASSWORD = 'newPassword123!';
const PIN_CODE = '123456';
const NEW_PIN_CODE = '654321';

type FreshUser = { login: LoginResponseDto; password: string };

describe('/auth — change-password / pin-code / session lock', () => {
  let admin: LoginResponseDto;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
  });

  // Helper: create a brand new user. createUserDto.create(key) sets the
  // password to `password-${key}`, captured here so per-test mutations work.
  let nextUserCounter = 0;
  const newUser = async (): Promise<FreshUser> => {
    nextUserCounter++;
    const key = `t39-u${nextUserCounter}`;
    const dto = createUserDto.create(key);
    const login = await utils.userSetup(admin.accessToken, dto);
    return { login, password: dto.password };
  };

  describe('POST /auth/change-password', () => {
    it('requires authentication', async () => {
      const { status } = await request(app)
        .post('/auth/change-password')
        .set(authHeaders(anonActor))
        .send({ password: 'whatever', newPassword: NEW_PASSWORD });
      expect(status).toBe(401);
    });

    it('rejects an incorrect current password with 400', async () => {
      const user = await newUser();
      const { status } = await request(app)
        .post('/auth/change-password')
        .set(asBearerAuth(user.login.accessToken))
        .send({ password: 'totally-wrong', newPassword: NEW_PASSWORD });
      expect(status).toBe(400);
    });

    it('owner can change their password and re-login with the new one', async () => {
      const user = await newUser();
      const change = await request(app)
        .post('/auth/change-password')
        .set(asBearerAuth(user.login.accessToken))
        .send({ password: user.password, newPassword: NEW_PASSWORD });
      expect(change.status).toBe(200);

      // Login with the new password should succeed.
      const login = await request(app)
        .post('/auth/login')
        .send({ email: user.login.userEmail, password: NEW_PASSWORD });
      expect(login.status).toBe(201);
      expect((login.body as { accessToken: string }).accessToken).toBeTruthy();
    });
  });

  describe('POST /auth/pin-code (setup)', () => {
    it('requires authentication', async () => {
      const { status } = await request(app)
        .post('/auth/pin-code')
        .set(authHeaders(anonActor))
        .send({ pinCode: PIN_CODE });
      expect(status).toBe(401);
    });

    it(String.raw`rejects a non-6-digit PIN (Matches /^\d{6}$/)`, async () => {
      const user = await newUser();
      const { status } = await request(app)
        .post('/auth/pin-code')
        .set(asBearerAuth(user.login.accessToken))
        .send({ pinCode: '12345' }); // 5 digits
      expect(status).toBe(400);
    });

    it('owner can set up a PIN code (204) and /auth/status reflects pinCode=true', async () => {
      const user = await newUser();
      const setup = await request(app)
        .post('/auth/pin-code')
        .set(asBearerAuth(user.login.accessToken))
        .send({ pinCode: PIN_CODE });
      expect(setup.status).toBe(204);

      const status = await request(app).get('/auth/status').set(asBearerAuth(user.login.accessToken));
      expect(status.status).toBe(200);
      expect((status.body as { pinCode: boolean }).pinCode).toBe(true);
    });
  });

  describe('PUT /auth/pin-code (change)', () => {
    it('owner can change their PIN code', async () => {
      const user = await newUser();
      // Set up first.
      await request(app).post('/auth/pin-code').set(asBearerAuth(user.login.accessToken)).send({ pinCode: PIN_CODE });

      // Change it.
      const change = await request(app)
        .put('/auth/pin-code')
        .set(asBearerAuth(user.login.accessToken))
        .send({ pinCode: PIN_CODE, newPinCode: NEW_PIN_CODE });
      expect(change.status).toBe(204);
    });
  });

  describe('DELETE /auth/pin-code (reset)', () => {
    it('owner can reset their PIN code by providing the password', async () => {
      const user = await newUser();
      // Set up first.
      await request(app).post('/auth/pin-code').set(asBearerAuth(user.login.accessToken)).send({ pinCode: PIN_CODE });

      // Reset using the account password.
      const reset = await request(app)
        .delete('/auth/pin-code')
        .set(asBearerAuth(user.login.accessToken))
        .send({ password: user.password });
      expect(reset.status).toBe(204);

      // /auth/status now shows pinCode=false.
      const statusRes = await request(app).get('/auth/status').set(asBearerAuth(user.login.accessToken));
      expect((statusRes.body as { pinCode: boolean }).pinCode).toBe(false);
    });
  });

  describe('POST /auth/session/unlock + lock', () => {
    it('owner can unlock + lock the session', async () => {
      const user = await newUser();
      // Need to set up a PIN first (sessions can only unlock if there's a PIN).
      await request(app).post('/auth/pin-code').set(asBearerAuth(user.login.accessToken)).send({ pinCode: PIN_CODE });

      const unlock = await request(app)
        .post('/auth/session/unlock')
        .set(asBearerAuth(user.login.accessToken))
        .send({ pinCode: PIN_CODE });
      expect(unlock.status).toBe(204);

      const lock = await request(app).post('/auth/session/lock').set(asBearerAuth(user.login.accessToken)).send({});
      expect(lock.status).toBe(204);
    });

    it('unlock with wrong PIN returns 400', async () => {
      const user = await newUser();
      await request(app).post('/auth/pin-code').set(asBearerAuth(user.login.accessToken)).send({ pinCode: PIN_CODE });

      const { status } = await request(app)
        .post('/auth/session/unlock')
        .set(asBearerAuth(user.login.accessToken))
        .send({ pinCode: '999999' });
      expect(status).toBe(400);
    });
  });

  describe('GET /auth/status', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).get('/auth/status').set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it('returns the auth status shape for an authenticated user', async () => {
      const user = await newUser();
      const { status, body } = await request(app).get('/auth/status').set(asBearerAuth(user.login.accessToken));
      expect(status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          pinCode: expect.any(Boolean),
          password: expect.any(Boolean),
        }),
      );
      // A fresh user has a password (set during signup) but no PIN.
      expect((body as { password: boolean; pinCode: boolean }).password).toBe(true);
      expect((body as { password: boolean; pinCode: boolean }).pinCode).toBe(false);
    });
  });
});
