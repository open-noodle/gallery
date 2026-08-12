// E2E coverage for the three face-suggestion endpoints added in Phase 3:
//
//   GET  /people/:id/face-suggestions          (getPersonFaceSuggestions)
//   POST /people/:id/face-suggestions/:assetFaceId/confirm   (confirmPersonFaceSuggestion)
//   POST /people/:id/face-suggestions/:assetFaceId/dismiss   (dismissPersonFaceSuggestion)
//
// Seed strategy
// -------------
// - face_person_verdict rows are seeded via raw SQL (the background job that
//   would normally create them is not triggered in the e2e stack).
// - Unassigned asset_face rows are seeded via a minimal INSERT (personId = NULL).
// - The system config machineLearning.facialRecognition.suggestions toggle is set to
//   { enabled: true, maxDistance: 0.8 } (0.8 > default maxDistance 0.5) so the read gate
//   opens.
// - The config is restored to defaults in afterAll.

import { LoginResponseDto, PersonResponseDto, updateConfig } from '@immich/sdk';
import { type SpaceContext, buildSpaceContext } from 'src/actors';
import { createUserDto, uuidDto } from 'src/fixtures';
import { errorDto } from 'src/responses';
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

/** Insert a pending face_person_verdict row. */
async function insertSuggestion(
  db: Awaited<ReturnType<(typeof utils)['connectDatabase']>>,
  personId: string,
  assetFaceId: string,
  distance: number,
) {
  await db.query(`INSERT INTO face_person_verdict ("personId", "assetFaceId", distance) VALUES ($1, $2, $3)`, [
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

    // Enable suggestions: maxDistance (0.8) must be > recognition maxDistance (0.5)
    const config = await utils.getSystemConfig(admin.accessToken);
    config.machineLearning.facialRecognition.suggestions = { enabled: true, maxDistance: 0.8 };
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
    defaults.machineLearning.facialRecognition.suggestions = { enabled: false, maxDistance: 0.7 };
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
      expect(body).toEqual(errorDto.badRequest());
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
      // An unguarded loop over an empty array would pass vacuously — this endpoint has at least the two
      // seeded in-band faces (faceForGet1, faceForGet2), so the loop below must actually execute.
      expect(body.items.length).toBeGreaterThan(0);
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
      // An empty (or single-item) list would pass the ascending check below vacuously — pin that there are
      // genuinely multiple items to compare.
      expect(distances.length).toBeGreaterThan(1);
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
      // Positive control: the dismiss must be scoped to faceForDismiss only — the two other still-pending
      // faces (not yet acted on at this point in the suite) must still be returned. An endpoint regressed to
      // dropping the whole list (or over-dismissing) would still pass the `not.toContain` check above alone.
      expect(ids).toContain(faceForGet1);
      expect(ids).toContain(faceForGet2);
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
      const db = await utils.connectDatabase();

      // Positive control: before confirming, the face is genuinely unassigned and carries no manual
      // identity link — otherwise the post-condition assertions below would prove nothing.
      const before = await db.query<{ personId: string | null }>(`SELECT "personId" FROM asset_face WHERE id = $1`, [
        faceForConfirm,
      ]);
      expect(before.rows[0].personId).toBeNull();
      const linkBefore = await db.query(`SELECT source FROM face_identity_face WHERE "assetFaceId" = $1`, [
        faceForConfirm,
      ]);
      expect(linkBefore.rows).toHaveLength(0);

      const { status } = await request(app)
        .post(`/people/${namedPerson.id}/face-suggestions/${faceForConfirm}/confirm`)
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(200);

      // Post-conditions: the face actually moved and got a durable manual identity link, not just a 200.
      const after = await db.query<{ personId: string | null }>(`SELECT "personId" FROM asset_face WHERE id = $1`, [
        faceForConfirm,
      ]);
      expect(after.rows[0].personId).toBe(namedPerson.id);
      const linkAfter = await db.query<{ source: string }>(
        `SELECT source FROM face_identity_face WHERE "assetFaceId" = $1`,
        [faceForConfirm],
      );
      expect(linkAfter.rows).toHaveLength(1);
      expect(linkAfter.rows[0].source).toBe('manual');

      // The face left the suggestion queue, and the still-pending control faces did not.
      const { body } = await request(app)
        .get(`/people/${namedPerson.id}/face-suggestions`)
        .set(asBearerAuth(owner.accessToken));
      const ids = (body.items as Array<{ assetFaceId: string }>).map((i) => i.assetFaceId);
      expect(ids).not.toContain(faceForConfirm);
      expect(ids).toContain(faceForGet1);
      expect(ids).toContain(faceForGet2);
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

// --------------------------------------------------------------------------
// GET /people/:id/face-suggestions — space-member read scope (D6)
// --------------------------------------------------------------------------
//
// A person owned by spaceOwner with a face on a space-shared asset is space-reachable via
// PersonRead (owner ∪ shared-space member — see access.ts). Before the D6 fix, that meant a
// space Viewer or Editor could read the OWNER's whole-library pending suggestion queue through
// this endpoint. The fix moves the gate to PersonUpdate (checkOwnerAccess alone, no space
// carve-out): the owner gets 200, viewers and editors both get 400.
describe('GET /people/:id/face-suggestions — space-member read scope (D6)', () => {
  let ctx: SpaceContext;

  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext();

    const config = await utils.getSystemConfig(ctx.admin.token!);
    config.machineLearning.facialRecognition.suggestions = { enabled: true, maxDistance: 0.8 };
    await updateConfig({ systemConfigDto: config }, { headers: asBearerAuth(ctx.admin.token!) });
  });

  afterAll(async () => {
    const defaults = await utils.getSystemConfig(ctx.admin.token!);
    defaults.machineLearning.facialRecognition.suggestions = { enabled: false, maxDistance: 0.7 };
    await updateConfig({ systemConfigDto: defaults }, { headers: asBearerAuth(ctx.admin.token!) });
  });

  it('a space viewer and a space editor are refused (400); the owner is allowed (200)', async () => {
    const person = await utils.createPerson(ctx.spaceOwner.token!, { name: 'D6 Space Person' });
    // The person's face on the space-shared asset is what makes the person space-reachable via
    // PersonRead (own ∪ shared-space member) — the exact condition the D6 fix closes off for
    // this owner-only read.
    await utils.createFace({ assetId: ctx.spaceAssetId, personId: person.id });

    const db = await utils.connectDatabase();
    const unassignedFace = await insertUnassignedFace(db, ctx.spaceAssetId);
    await insertSuggestion(db, person.id, unassignedFace, 0.6);

    const viewerResponse = await request(app)
      .get(`/people/${person.id}/face-suggestions`)
      .set(asBearerAuth(ctx.spaceViewer.token!));
    expect(viewerResponse.status).toBe(400);

    const editorResponse = await request(app)
      .get(`/people/${person.id}/face-suggestions`)
      .set(asBearerAuth(ctx.spaceEditor.token!));
    expect(editorResponse.status).toBe(400);

    const ownerResponse = await request(app)
      .get(`/people/${person.id}/face-suggestions`)
      .set(asBearerAuth(ctx.spaceOwner.token!));
    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.body.total).toBeGreaterThanOrEqual(1);
  });
});

// --------------------------------------------------------------------------
// GET /people/:id/face-suggestions — disabled toggle with a still-valid band
// --------------------------------------------------------------------------
//
// Regression coverage for the decoupled `suggestions.enabled` / `suggestions.maxDistance`
// shape. Under the old flat sentinel, "disabled" was encoded as an inverted distance band
// (suggestionMaxDistance <= maxDistance), so the repository's own band short-circuit
// returned empty for free — there was no way to observe a disabled toggle with a valid
// band. With the nested shape, `enabled: false` and a perfectly valid band (0.8 > the
// default recognition maxDistance of 0.5) can coexist, so that repository short-circuit
// no longer fires. Only the service-level `suggestions.enabled` guard added alongside this
// change stops the endpoint from serving suggestions here — this test pins that guard.
describe('GET /people/:id/face-suggestions — disabled toggle with a valid band', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let person: PersonResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    owner = await utils.userSetup(admin.accessToken, createUserDto.create('fsugg-disabled-owner'));

    // Disabled, but the band itself is still valid (0.8 > 0.5) — the repository's own
    // band short-circuit cannot catch this; it takes the service-level enabled guard.
    const config = await utils.getSystemConfig(admin.accessToken);
    config.machineLearning.facialRecognition.suggestions = { enabled: false, maxDistance: 0.8 };
    await updateConfig({ systemConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

    person = await utils.createPerson(owner.accessToken, { name: 'FaceSuggTest Disabled' });
    const asset = await utils.createAsset(owner.accessToken);

    const db = await utils.connectDatabase();
    const faceId = await insertUnassignedFace(db, asset.id);
    await insertSuggestion(db, person.id, faceId, 0.6); // well within the 0.8 band
  });

  afterAll(async () => {
    const defaults = await utils.getSystemConfig(admin.accessToken);
    defaults.machineLearning.facialRecognition.suggestions = { enabled: false, maxDistance: 0.7 };
    await updateConfig({ systemConfigDto: defaults }, { headers: asBearerAuth(admin.accessToken) });
  });

  it('returns { total: 0, items: [] } when disabled even though the band is valid', async () => {
    const { status, body } = await request(app)
      .get(`/people/${person.id}/face-suggestions`)
      .set(asBearerAuth(owner.accessToken));

    expect(status).toBe(200);
    expect(body).toEqual({ total: 0, items: [] });
  });
});

// --------------------------------------------------------------------------
// POST /people/:id/face-suggestions/:assetFaceId/reject and /ignore (F8: face-level authorization)
// --------------------------------------------------------------------------
//
// reject and ignore previously performed NO authorization check on assetFaceId — only on personId. A
// caller who owns personId but not assetFaceId could still write a verdict row against a face they do
// not own, because the verdict is identity-keyed and read back across owners (see
// person.service.ts rejectFaceSuggestion). These two endpoints also had zero e2e coverage before this
// slice — only confirm and dismiss were exercised.
describe('POST /people/:id/face-suggestions/:assetFaceId/reject and /ignore (F8)', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let stranger: LoginResponseDto;

  let ownerPerson: PersonResponseDto;
  let strangerPerson: PersonResponseDto;

  let ownerAssetId: string;

  let foreignFaceForReject: string;
  let rejectHappyFace: string;
  let ignoreHappyFace: string;
  let controlFace: string;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });

    [owner, stranger] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('fsugg-f8-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('fsugg-f8-stranger')),
    ]);

    const config = await utils.getSystemConfig(admin.accessToken);
    config.machineLearning.facialRecognition.suggestions = { enabled: true, maxDistance: 0.8 };
    await updateConfig({ systemConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

    [ownerPerson, strangerPerson] = await Promise.all([
      utils.createPerson(owner.accessToken, { name: 'F8 Owner Person' }),
      utils.createPerson(stranger.accessToken, { name: 'F8 Stranger Person' }),
    ]);

    const asset = await utils.createAsset(owner.accessToken);
    ownerAssetId = asset.id;

    const db = await utils.connectDatabase();
    foreignFaceForReject = await insertUnassignedFace(db, ownerAssetId);
    rejectHappyFace = await insertUnassignedFace(db, ownerAssetId);
    ignoreHappyFace = await insertUnassignedFace(db, ownerAssetId);
    controlFace = await insertUnassignedFace(db, ownerAssetId);

    await insertSuggestion(db, ownerPerson.id, foreignFaceForReject, 0.6);
    await insertSuggestion(db, ownerPerson.id, rejectHappyFace, 0.6);
    await insertSuggestion(db, ownerPerson.id, ignoreHappyFace, 0.6);
    await insertSuggestion(db, ownerPerson.id, controlFace, 0.6);
  });

  afterAll(async () => {
    const defaults = await utils.getSystemConfig(admin.accessToken);
    defaults.machineLearning.facialRecognition.suggestions = { enabled: false, maxDistance: 0.7 };
    await updateConfig({ systemConfigDto: defaults }, { headers: asBearerAuth(admin.accessToken) });
  });

  it('S4.8: a second user naming their OWN person but a face they do not own gets 400; the face owner still sees it', async () => {
    // Positive control: the owner's queue genuinely contains this face before the refused call.
    const before = await request(app)
      .get(`/people/${ownerPerson.id}/face-suggestions`)
      .set(asBearerAuth(owner.accessToken));
    expect((before.body.items as Array<{ assetFaceId: string }>).map((i) => i.assetFaceId)).toContain(
      foreignFaceForReject,
    );

    // stranger owns strangerPerson (so PersonUpdate passes), but foreignFaceForReject belongs to owner's
    // asset — checkFaceOwnerAccess must refuse it.
    const { status } = await request(app)
      .post(`/people/${strangerPerson.id}/face-suggestions/${foreignFaceForReject}/reject`)
      .set(asBearerAuth(stranger.accessToken));
    expect(status).toBe(400);

    const after = await request(app)
      .get(`/people/${ownerPerson.id}/face-suggestions`)
      .set(asBearerAuth(owner.accessToken));
    const ids = (after.body.items as Array<{ assetFaceId: string }>).map((i) => i.assetFaceId);
    expect(ids).toContain(foreignFaceForReject);
  });

  it('S4.9: reject happy path removes the face from the queue and it does not return on re-read', async () => {
    const { status } = await request(app)
      .post(`/people/${ownerPerson.id}/face-suggestions/${rejectHappyFace}/reject`)
      .set(asBearerAuth(owner.accessToken));
    expect(status).toBe(200);

    const { body } = await request(app)
      .get(`/people/${ownerPerson.id}/face-suggestions`)
      .set(asBearerAuth(owner.accessToken));
    const ids = (body.items as Array<{ assetFaceId: string }>).map((i) => i.assetFaceId);
    expect(ids).not.toContain(rejectHappyFace);
    // Positive control: a still-pending sibling face is not swept up by the same call.
    expect(ids).toContain(controlFace);
  });

  it('S4.9: ignore happy path removes the face from the queue and it does not return on re-read', async () => {
    const { status } = await request(app)
      .post(`/people/${ownerPerson.id}/face-suggestions/${ignoreHappyFace}/ignore`)
      .set(asBearerAuth(owner.accessToken));
    expect(status).toBe(200);

    const { body } = await request(app)
      .get(`/people/${ownerPerson.id}/face-suggestions`)
      .set(asBearerAuth(owner.accessToken));
    const ids = (body.items as Array<{ assetFaceId: string }>).map((i) => i.assetFaceId);
    expect(ids).not.toContain(ignoreHappyFace);
    expect(ids).toContain(controlFace);
  });
});
