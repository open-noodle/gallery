// E2E coverage for the three face-suggestion endpoints added in Phase 3:
//
//   GET  /people/:id/face-suggestions          (getPersonFaceSuggestions)
//   POST /people/:id/face-suggestions/:assetFaceId/confirm   (confirmPersonFaceSuggestion)
//   POST /people/:id/face-suggestions/:assetFaceId/dismiss   (dismissPersonFaceSuggestion)
//
// Seed strategy
// -------------
// - person_face_suggestion rows are seeded via raw SQL (the background job that
//   would normally create them is not triggered in the e2e stack).
// - Unassigned asset_face rows are seeded via a minimal INSERT (personId = NULL).
// - The system config machineLearning.facialRecognition.suggestionMaxDistance is
//   updated to 0.8 (> default maxDistance 0.5) so the read gate opens.
// - The config is restored to defaults in afterAll.

import { LoginResponseDto, PersonResponseDto, updateConfig } from '@immich/sdk';
import { createUserDto, uuidDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ---- helpers ----------------------------------------------------------------

/** Insert a bare unassigned asset_face row (personId IS NULL) and return its id. */
async function insertUnassignedFace(db: Awaited<ReturnType<(typeof utils)['connectDatabase']>>, assetId: string) {
  const result = await db.query<{ id: string }>(`INSERT INTO asset_face ("assetId") VALUES ($1) RETURNING id`, [
    assetId,
  ]);
  return result.rows[0].id;
}

/** Insert a pending person_face_suggestion row. */
async function insertSuggestion(
  db: Awaited<ReturnType<(typeof utils)['connectDatabase']>>,
  personId: string,
  assetFaceId: string,
  distance: number,
) {
  await db.query(`INSERT INTO person_face_suggestion ("personId", "assetFaceId", distance) VALUES ($1, $2, $3)`, [
    personId,
    assetFaceId,
    distance,
  ]);
}

// ---- spec -------------------------------------------------------------------

describe('/people/:id/face-suggestions', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let stranger: LoginResponseDto;

  // persons
  let namedPerson: PersonResponseDto;
  let hiddenPerson: PersonResponseDto;

  // assets (owned by owner)
  let ownerAssetId: string;

  // unassigned face IDs for dismiss / confirm / GET tests
  let faceForGet1: string;
  let faceForGet2: string;
  let faceForDismiss: string;
  let faceForConfirm: string;
  let faceForHidden: string;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });

    [owner, stranger] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('fsugg-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('fsugg-stranger')),
    ]);

    // Enable suggestions: set suggestionMaxDistance > maxDistance (0.5)
    const config = await utils.getSystemConfig(admin.accessToken);
    config.machineLearning.facialRecognition.suggestionMaxDistance = 0.8;
    await updateConfig({ systemConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

    // Create persons owned by owner
    [namedPerson, hiddenPerson] = await Promise.all([
      utils.createPerson(owner.accessToken, { name: 'FaceSuggTest Named' }),
      utils.createPerson(owner.accessToken, { name: 'FaceSuggTest Hidden', isHidden: true }),
    ]);

    // Create an asset for owner so face rows have somewhere to live
    const asset = await utils.createAsset(owner.accessToken);
    ownerAssetId = asset.id;

    const db = await utils.connectDatabase();

    // Seed two unassigned faces for the GET list test (in-band: 0.55 and 0.65)
    faceForGet1 = await insertUnassignedFace(db, ownerAssetId);
    faceForGet2 = await insertUnassignedFace(db, ownerAssetId);
    await insertSuggestion(db, namedPerson.id, faceForGet1, 0.55);
    await insertSuggestion(db, namedPerson.id, faceForGet2, 0.65);

    // Separate faces for dismiss / confirm so they don't interfere with each other
    faceForDismiss = await insertUnassignedFace(db, ownerAssetId);
    faceForConfirm = await insertUnassignedFace(db, ownerAssetId);
    await insertSuggestion(db, namedPerson.id, faceForDismiss, 0.6);
    await insertSuggestion(db, namedPerson.id, faceForConfirm, 0.7);

    // Seed a suggestion for the hidden person (the read gate should suppress it)
    faceForHidden = await insertUnassignedFace(db, ownerAssetId);
    await insertSuggestion(db, hiddenPerson.id, faceForHidden, 0.6);
  });

  afterAll(async () => {
    // Restore system config to defaults so we don't leak state into other specs
    const defaults = await utils.getSystemConfig(admin.accessToken);
    defaults.machineLearning.facialRecognition.suggestionMaxDistance = 0;
    await updateConfig({ systemConfigDto: defaults }, { headers: asBearerAuth(admin.accessToken) });
  });

  // --------------------------------------------------------------------------
  // GET /people/:id/face-suggestions
  // --------------------------------------------------------------------------

  describe('GET /people/:id/face-suggestions', () => {
    it('requires authentication (401 without token)', async () => {
      const { status } = await request(app).get(`/people/${namedPerson.id}/face-suggestions`);
      expect(status).toBe(401);
    });

    it('returns 400 for a person that does not exist', async () => {
      const { status, body } = await request(app)
        .get(`/people/${uuidDto.notFound}/face-suggestions`)
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(400);
      // requireAccess throws BadRequestException for missing persons
      expect(body).toMatchObject({ error: expect.any(String) });
    });

    it("returns 400 when a stranger tries to access another user's person (edge 18)", async () => {
      const { status } = await request(app)
        .get(`/people/${namedPerson.id}/face-suggestions`)
        .set(asBearerAuth(stranger.accessToken));
      expect(status).toBe(400);
    });

    it('returns 200 with total and items for the owner', async () => {
      const { status, body } = await request(app)
        .get(`/people/${namedPerson.id}/face-suggestions`)
        .set(asBearerAuth(owner.accessToken));

      expect(status).toBe(200);
      // faceForGet1 (0.55) + faceForGet2 (0.65) are in-band; faceForDismiss and
      // faceForConfirm are also pending but may appear here — we check at least 2.
      expect(body).toMatchObject({
        total: expect.any(Number),
        items: expect.any(Array),
      });
      expect(body.total).toBeGreaterThanOrEqual(2);
      const ids = (body.items as Array<{ assetFaceId: string }>).map((i) => i.assetFaceId);
      expect(ids).toContain(faceForGet1);
      expect(ids).toContain(faceForGet2);
    });

    it('items include required fields per PersonFaceSuggestionResponseDto', async () => {
      const { status, body } = await request(app)
        .get(`/people/${namedPerson.id}/face-suggestions`)
        .set(asBearerAuth(owner.accessToken));

      expect(status).toBe(200);
      for (const item of body.items as Array<Record<string, unknown>>) {
        expect(item).toMatchObject({
          assetFaceId: expect.any(String),
          assetId: expect.any(String),
          distance: expect.any(Number),
          imageWidth: expect.any(Number),
          imageHeight: expect.any(Number),
          boundingBoxX1: expect.any(Number),
          boundingBoxX2: expect.any(Number),
          boundingBoxY1: expect.any(Number),
          boundingBoxY2: expect.any(Number),
        });
      }
    });

    it('returns { total: 0, items: [] } for a hidden person (read gate — edge 7)', async () => {
      const { status, body } = await request(app)
        .get(`/people/${hiddenPerson.id}/face-suggestions`)
        .set(asBearerAuth(owner.accessToken));

      expect(status).toBe(200);
      expect(body).toEqual({ total: 0, items: [] });
    });

    it('results are ordered by distance ascending (best match first)', async () => {
      const { status, body } = await request(app)
        .get(`/people/${namedPerson.id}/face-suggestions`)
        .set(asBearerAuth(owner.accessToken));

      expect(status).toBe(200);
      const distances = (body.items as Array<{ distance: number }>).map((i) => i.distance);
      // Assert each distance is <= the next one
      for (let i = 1; i < distances.length; i++) {
        expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]);
      }
    });
  });

  // --------------------------------------------------------------------------
  // POST /people/:id/face-suggestions/:assetFaceId/dismiss
  // --------------------------------------------------------------------------

  describe('POST /people/:id/face-suggestions/:assetFaceId/dismiss', () => {
    it('requires authentication (401 without token)', async () => {
      const { status } = await request(app).post(
        `/people/${namedPerson.id}/face-suggestions/${faceForDismiss}/dismiss`,
      );
      expect(status).toBe(401);
    });

    it('returns 400 when a stranger tries to dismiss (owner-only)', async () => {
      const { status } = await request(app)
        .post(`/people/${namedPerson.id}/face-suggestions/${faceForDismiss}/dismiss`)
        .set(asBearerAuth(stranger.accessToken));
      expect(status).toBe(400);
    });

    it('owner can dismiss a suggestion (200)', async () => {
      const { status } = await request(app)
        .post(`/people/${namedPerson.id}/face-suggestions/${faceForDismiss}/dismiss`)
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(200);
    });

    it('second dismiss call is idempotent (200)', async () => {
      // faceForDismiss was already dismissed in the previous test
      const { status } = await request(app)
        .post(`/people/${namedPerson.id}/face-suggestions/${faceForDismiss}/dismiss`)
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(200);
    });

    it('dismissed item no longer appears in GET response', async () => {
      const { status, body } = await request(app)
        .get(`/people/${namedPerson.id}/face-suggestions`)
        .set(asBearerAuth(owner.accessToken));

      expect(status).toBe(200);
      const ids = (body.items as Array<{ assetFaceId: string }>).map((i) => i.assetFaceId);
      expect(ids).not.toContain(faceForDismiss);
    });
  });

  // --------------------------------------------------------------------------
  // POST /people/:id/face-suggestions/:assetFaceId/confirm
  // --------------------------------------------------------------------------

  describe('POST /people/:id/face-suggestions/:assetFaceId/confirm', () => {
    it('requires authentication (401 without token)', async () => {
      const { status } = await request(app).post(
        `/people/${namedPerson.id}/face-suggestions/${faceForConfirm}/confirm`,
      );
      expect(status).toBe(401);
    });

    it('returns 400 when a stranger tries to confirm (owner-only)', async () => {
      const { status } = await request(app)
        .post(`/people/${namedPerson.id}/face-suggestions/${faceForConfirm}/confirm`)
        .set(asBearerAuth(stranger.accessToken));
      expect(status).toBe(400);
    });

    it('owner can confirm a suggestion (200)', async () => {
      const { status } = await request(app)
        .post(`/people/${namedPerson.id}/face-suggestions/${faceForConfirm}/confirm`)
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(200);
    });

    it('second confirm call is idempotent (200)', async () => {
      // faceForConfirm was already confirmed (and the face now assigned) in the previous test
      const { status } = await request(app)
        .post(`/people/${namedPerson.id}/face-suggestions/${faceForConfirm}/confirm`)
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(200);
    });
  });
});
