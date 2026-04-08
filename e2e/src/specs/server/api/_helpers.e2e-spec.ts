import { type Actor, type SpaceContext, authHeaders, buildSpaceContext, forEachActor } from 'src/actors';
import { app, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Smoke tests for the e2e Actor / SpaceContext / forEachActor helpers in src/actors.ts.
// These exist to validate that the helpers work end-to-end before downstream specs (T03+)
// adopt them. See docs/plans/2026-04-06-e2e-T02-helpers-design.md for the full rationale.
//
// The underscore prefix on the filename groups this spec at the top of the directory listing
// without occupying a "real" spec slot.

describe('test helpers smoke', () => {
  let ctx: SpaceContext;
  const anonActor: Actor = { id: 'anon' };

  // FIXTURE LIFETIME: ctx is built once and treated as read-only.
  // If a test needs to mutate the space, it must restore the field in a try/finally
  // (see fixture lifetime section of T02 design doc).
  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext();
  });

  // Smoke test 1 — auth threading: bearer token reaches the server for every actor variant.
  it('GET /server/ping is reachable for every actor', async () => {
    await forEachActor(
      [anonActor, ctx.spaceOwner, ctx.spaceViewer, ctx.spaceNonMember],
      (actor) => request(app).get('/server/ping').set(authHeaders(actor)),
      { anon: 200, spaceOwner: 200, spaceViewer: 200, spaceNonMember: 200 },
    );
  });

  // Smoke test 2 — anonymous vs authenticated split.
  it('GET /users/me requires auth and returns the right user per actor', async () => {
    await forEachActor(
      [anonActor, ctx.spaceOwner, ctx.spaceViewer],
      (actor) => request(app).get('/users/me').set(authHeaders(actor)),
      { anon: 401, spaceOwner: 200, spaceViewer: 200 },
    );
  });

  // Smoke test 3 — utils.createSpacePerson extended return shape + junction insert.
  // The extended helper returns {globalPersonId, spacePersonId, faceId} (instead of
  // just the spacePersonId string) and inserts a row into shared_space_person_face.
  // T07/T09 and beyond rely on both — see T02 design doc §"Extension to utils.createSpacePerson".
  it('utils.createSpacePerson returns three IDs and creates the junction row', async () => {
    const { globalPersonId, spacePersonId, faceId } = await utils.createSpacePerson(
      ctx.spaceId,
      'Smoke',
      ctx.spaceOwner.userId!,
      ctx.spaceAssetId,
    );

    expect(globalPersonId).toMatch(/^[0-9a-f-]{36}$/);
    expect(spacePersonId).toMatch(/^[0-9a-f-]{36}$/);
    expect(faceId).toMatch(/^[0-9a-f-]{36}$/);

    // Verify the junction row exists — this is the load-bearing insert that T07-T14
    // queries traverse (getPersonAssetIds, reassignPersonFaces, faceCount denormalization,
    // takenAfter/takenBefore EXISTS subquery in getPersonsBySpaceId).
    // We don't disconnect — the pg client gets torn down at worker exit. Disconnecting
    // here would break any later test in the file that uses utils.createSpacePerson.
    const client = await utils.connectDatabase();
    const result = await client.query(
      `SELECT "personId", "assetFaceId" FROM "shared_space_person_face"
       WHERE "personId" = $1 AND "assetFaceId" = $2`,
      [spacePersonId, faceId],
    );
    expect(result.rowCount).toBe(1);
  });

  // Smoke test 4 — role assignment in buildSpaceContext.
  // Without this, a regression that creates spaceEditor as spaceViewer would silently
  // pass smoke tests 1 and 2 (both return 200 regardless of role) and break every
  // downstream PR that depends on the role distinction.
  //
  // PATCH /shared-spaces/:id with {thumbnailCropY: 0} is an Editor-level update.
  // shared-space.service.ts:197-203 — only `name`/`description`/`color`/
  // `faceRecognitionEnabled`/`petsEnabled` count as "metadata" and require Owner.
  // `thumbnailCropY` is Editor-or-above. Viewer must be rejected; Editor and Owner pass.
  // Don't use {name: ...} here — that would require Owner and the smoke test would
  // not distinguish Editor from Viewer (both would 403).
  it('buildSpaceContext assigns the right role to each member', async () => {
    await forEachActor(
      [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer],
      (actor) =>
        request(app).patch(`/shared-spaces/${ctx.spaceId}`).set(authHeaders(actor)).send({ thumbnailCropY: 0 }),
      { spaceOwner: 200, spaceEditor: 200, spaceViewer: 403 },
    );
  });
});
