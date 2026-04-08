import { type LoginResponseDto } from '@immich/sdk';
import { type Actor, authHeaders } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Coverage for the /view controller (view.controller.ts) — folder-by-path browsing.
//
// Service shape (view.service.ts:7-16): both endpoints scope strictly to
// `auth.user.id`. No partner sharing, no space scoping, no library scoping. The
// folder browse is owner-only — a fork-side spec leaks here would be a real bug.
// Pinned at the e2e level so a future query refactor that joins through partners
// or shared spaces would be caught.

describe('/view', () => {
  let admin: LoginResponseDto;
  let userA: LoginResponseDto;
  let userB: LoginResponseDto;
  let userAAssetId: string;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    [userA, userB] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('t21-userA')),
      utils.userSetup(admin.accessToken, createUserDto.create('t21-userB')),
    ]);

    // userA gets a real asset to probe folder browsing against. userB needs an
    // asset too so the cross-user-isolation tests have a recipient who actually
    // has folders, but we don't need to track userB's asset id specifically —
    // the assertions key off "userB does not see userAAssetId".
    const [assetA] = await Promise.all([utils.createAsset(userA.accessToken), utils.createAsset(userB.accessToken)]);
    userAAssetId = assetA.id;
  });

  describe('GET /view/folder/unique-paths', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).get('/view/folder/unique-paths').set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it("returns the user's unique folder paths", async () => {
      const { status, body } = await request(app).get('/view/folder/unique-paths').set(asBearerAuth(userA.accessToken));
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect((body as string[]).length).toBeGreaterThan(0);
    });

    it("cross-user isolation — userB does not see userA's paths", async () => {
      // The service scopes by auth.user.id, so userB's paths are independent of
      // userA's. Both have at least one upload, so we assert userB's response
      // doesn't somehow include userA's path.
      const a = await request(app).get('/view/folder/unique-paths').set(asBearerAuth(userA.accessToken));
      const b = await request(app).get('/view/folder/unique-paths').set(asBearerAuth(userB.accessToken));
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      // The actual paths include the userId, so they're guaranteed-distinct. This
      // is a structural assertion: userB's response set has no overlap with userA's
      // paths that contain userA's userId.
      const aPaths = a.body as string[];
      const bPaths = b.body as string[];
      const aPathsContainingUserA = aPaths.filter((p) => p.includes(userA.userId));
      expect(aPathsContainingUserA.length).toBeGreaterThan(0);
      for (const aPath of aPathsContainingUserA) {
        expect(bPaths).not.toContain(aPath);
      }
    });
  });

  describe('GET /view/folder', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).get('/view/folder?path=/x').set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it("returns assets when given a known path from the user's folder list", async () => {
      // Resolve a known path via the unique-paths endpoint, then query getAssetsByOriginalPath.
      const pathsRes = await request(app).get('/view/folder/unique-paths').set(asBearerAuth(userA.accessToken));
      const knownPath = (pathsRes.body as string[])[0];
      expect(typeof knownPath).toBe('string');

      const { status, body } = await request(app)
        .get(`/view/folder?path=${encodeURIComponent(knownPath)}`)
        .set(asBearerAuth(userA.accessToken));
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      const ids = (body as Array<{ id: string }>).map((a) => a.id);
      expect(ids).toContain(userAAssetId);
    });

    it('returns empty array for a path that does not exist', async () => {
      const { status, body } = await request(app)
        .get('/view/folder?path=/nonexistent/path/that/does/not/exist')
        .set(asBearerAuth(userA.accessToken));
      expect(status).toBe(200);
      expect(body).toEqual([]);
    });

    it("cross-user isolation — userB cannot fetch userA's folder contents", async () => {
      // Use userA's known path, but query as userB. The service scopes by auth.user.id
      // so the result should not include userAAssetId. Ideally the response is empty
      // (because userB has no assets at userA's path), but we just assert the leak
      // doesn't happen — userB MUST NOT see userAAssetId regardless of what else is
      // in the response.
      const pathsRes = await request(app).get('/view/folder/unique-paths').set(asBearerAuth(userA.accessToken));
      const userAPath = (pathsRes.body as string[]).find((p) => p.includes(userA.userId));
      expect(userAPath).toBeDefined();

      const { status, body } = await request(app)
        .get(`/view/folder?path=${encodeURIComponent(userAPath!)}`)
        .set(asBearerAuth(userB.accessToken));
      expect(status).toBe(200);
      const ids = (body as Array<{ id: string }>).map((a) => a.id);
      expect(ids).not.toContain(userAAssetId);
    });

    it('missing path query param returns 500 (no validation in controller — server bug)', async () => {
      // The controller at view.controller.ts:33 declares `@Query('path') path: string`
      // with no validation pipe and no default value. The service passes the
      // undefined `path` directly to viewRepository.getAssetsByOriginalPath which
      // trips with a 500. Pinning the actual behavior so a future server-side fix
      // (e.g. adding validation or treating undefined as empty array) forces a
      // deliberate update.
      //
      // Worth filing upstream as a small server bug — should be 400 with a clear
      // validation message.
      const { status } = await request(app).get('/view/folder').set(asBearerAuth(userA.accessToken));
      expect(status).toBe(500);
    });
  });
});
