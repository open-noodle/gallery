/**
 * End-to-end journey for Slice 9 of the space-editor face-assignment feature (spec
 * `docs/superpowers/specs/2026-08-23-space-editor-face-assignment-design.md` §6.1-§6.7): a
 * Shared Space Editor names faces on a fellow member's photo, corrects a mistaken match, draws
 * and deletes her own box, and both mutations she made land in the space's activity feed
 * attributed to her -- plus the negative half that proves the widened permission has a ceiling.
 *
 * Fixture: `buildSpaceContext()` gives `spaceOwner` ("Bob") and `spaceEditor` ("Anna") as members
 * of the same space, with `ctx.spaceAssetId` already a photo of Bob's, reachable in the space.
 * There is no HTTP path that leaves a face unassigned (`POST /faces` requires a `personId`, and
 * the space draw endpoint always attaches on creation) -- production faces come from ML
 * detection, which does not run in this stack -- so unassigned faces are seeded directly via
 * `utils.createUnassignedFace`, mirroring how the sibling journey seeds its own asset instead of
 * depending on a pipeline this stack does not run.
 *
 * Rule under test (spec §6.3, §6.6): a space Owner/Editor may name, correct, draw, and delete
 * their own drawn boxes on ANY member's asset reachable through the space -- but `PersonUpdate`
 * (the owner-only personal-person path) and a DETECTED face's deletability stay untouched, and
 * none of it reaches a face whose asset has left the space.
 */
import {
  attachSpacePersonFace,
  createSpaceAssetFace,
  createSpacePerson,
  deleteSpaceAssetFace,
  getSpaceActivities,
  getSpaceAssetFaces,
  updatePerson,
} from '@immich/sdk';
import { type Actor, authHeaders, buildSpaceContext, forEachActor, type SpaceContext } from 'src/actors';
import { errorDto } from 'src/responses';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

const actorsFor = (ctx: SpaceContext): Actor[] => [
  ctx.spaceOwner,
  ctx.spaceEditor,
  ctx.spaceViewer,
  ctx.spaceNonMember,
];

describe('Space editor face-assign journey (spec 2026-08-23, Slice 9)', () => {
  let ctx: SpaceContext;
  let unrecognisedFaceId: string;
  let wrongMatchFaceId: string;
  let wrongGuessPersonId: string;
  let sueId: string;
  let drawnFaceId: string;

  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext();

    // Two "detected" faces on Bob's already-in-space photo, seeded the only way an unassigned
    // face can exist in this stack (see header comment).
    unrecognisedFaceId = await utils.createUnassignedFace(ctx.spaceAssetId);
    wrongMatchFaceId = await utils.createUnassignedFace(ctx.spaceAssetId);

    // A pre-existing space person Anna will mistakenly attach `wrongMatchFaceId` to, then correct
    // -- fixture setup, not part of the narrative under test, so created by Bob ahead of time.
    // MUST be created seeded (with a throwaway face), not bare: `SharedSpacePersonDedup` runs
    // after every asset-add on the FacialRecognition queue and hard-deletes any
    // `shared_space_person` with zero `shared_space_person_face` rows (see
    // `utils.createSpacePerson`'s own doc comment for this exact race) -- a bare create here is
    // orphaned and gone before test 3 runs.
    const throwawaySeedFaceId = await utils.createUnassignedFace(ctx.spaceAssetId);
    const wrongGuess = await createSpacePerson(
      { id: ctx.spaceId, sharedSpacePersonCreateDto: { name: 'Wrong Guess', assetFaceId: throwawaySeedFaceId } },
      { headers: asBearerAuth(ctx.spaceOwner.token!) },
    );
    wrongGuessPersonId = wrongGuess.id;
  }, 30_000);

  it("1. Anna (editor) lists the faces on Bob's photo", async () => {
    const faces = await getSpaceAssetFaces(
      { id: ctx.spaceId, assetId: ctx.spaceAssetId },
      { headers: asBearerAuth(ctx.spaceEditor.token!) },
    );

    const unrecognised = faces.find((face) => face.id === unrecognisedFaceId);
    const wrongMatch = faces.find((face) => face.id === wrongMatchFaceId);
    expect(unrecognised).toMatchObject({ spacePersonId: null, spacePersonName: null, isEditorDrawn: false });
    expect(wrongMatch).toMatchObject({ spacePersonId: null, spacePersonName: null, isEditorDrawn: false });
  });

  it('2. She names an unrecognised face — creating a space person', async () => {
    const person = await createSpacePerson(
      { id: ctx.spaceId, sharedSpacePersonCreateDto: { name: 'Aunt Sue', assetFaceId: unrecognisedFaceId } },
      { headers: asBearerAuth(ctx.spaceEditor.token!) },
    );
    expect(person.name).toBe('Aunt Sue');
    sueId = person.id;

    const faces = await getSpaceAssetFaces(
      { id: ctx.spaceId, assetId: ctx.spaceAssetId },
      { headers: asBearerAuth(ctx.spaceEditor.token!) },
    );
    expect(faces.find((face) => face.id === unrecognisedFaceId)).toMatchObject({
      spacePersonId: sueId,
      spacePersonName: 'Aunt Sue',
    });
  });

  it('3. She (mistakenly) attaches a face to the wrong person, then corrects it to Aunt Sue', async () => {
    const before = await getSpaceActivities({ id: ctx.spaceId }, { headers: asBearerAuth(ctx.spaceEditor.token!) });

    const wrongAttach = await attachSpacePersonFace(
      { id: ctx.spaceId, personId: wrongGuessPersonId, assetFaceId: wrongMatchFaceId },
      { headers: asBearerAuth(ctx.spaceEditor.token!) },
    );
    expect(wrongAttach.acted).toBe(true);

    const correctedAttach = await attachSpacePersonFace(
      { id: ctx.spaceId, personId: sueId, assetFaceId: wrongMatchFaceId },
      { headers: asBearerAuth(ctx.spaceEditor.token!) },
    );
    expect(correctedAttach.acted).toBe(true);

    const faces = await getSpaceAssetFaces(
      { id: ctx.spaceId, assetId: ctx.spaceAssetId },
      { headers: asBearerAuth(ctx.spaceEditor.token!) },
    );
    // The reassign moved it -- it now belongs to Sue, not Wrong Guess.
    expect(faces.find((face) => face.id === wrongMatchFaceId)).toMatchObject({
      spacePersonId: sueId,
      spacePersonName: 'Aunt Sue',
    });

    const after = await getSpaceActivities({ id: ctx.spaceId }, { headers: asBearerAuth(ctx.spaceEditor.token!) });
    const beforeIds = new Set(before.map((activity) => activity.id));
    const newRows = after.filter((activity) => !beforeIds.has(activity.id));
    // Both attach calls above are `PersonFaceAssign` activity rows -- this pins step 6 of the
    // journey ("both activity rows appear in the feed, attributed to her") at the point they are
    // created, rather than trusting a later bulk assertion to catch a regression correctly.
    expect(newRows).toHaveLength(2);
    for (const row of newRows) {
      expect(row).toMatchObject({ type: 'person_face_assign', userId: ctx.spaceEditor.userId });
    }
  });

  it('4. She draws a box and names it', async () => {
    const face = await createSpaceAssetFace(
      {
        id: ctx.spaceId,
        assetId: ctx.spaceAssetId,
        spaceAssetFaceCreateDto: {
          x: 10,
          y: 10,
          width: 40,
          height: 40,
          imageWidth: 1000,
          imageHeight: 1000,
          spacePersonId: sueId,
        },
      },
      { headers: asBearerAuth(ctx.spaceEditor.token!) },
    );
    expect(face).toMatchObject({ isEditorDrawn: true, spacePersonId: sueId, spacePersonName: 'Aunt Sue' });
    drawnFaceId = face.id;
  });

  it('5. She deletes the box she drew', async () => {
    await deleteSpaceAssetFace(
      { id: ctx.spaceId, assetFaceId: drawnFaceId },
      { headers: asBearerAuth(ctx.spaceEditor.token!) },
    );

    const faces = await getSpaceAssetFaces(
      { id: ctx.spaceId, assetId: ctx.spaceAssetId },
      { headers: asBearerAuth(ctx.spaceEditor.token!) },
    );
    expect(faces.find((face) => face.id === drawnFaceId)).toBeUndefined();
  });

  it("6. Bob sees both of Anna's PersonFaceAssign activity rows in his own view of the feed", async () => {
    const activities = await getSpaceActivities({ id: ctx.spaceId }, { headers: asBearerAuth(ctx.spaceOwner.token!) });
    const annasAssigns = activities.filter(
      (activity) => activity.type === 'person_face_assign' && activity.userId === ctx.spaceEditor.userId,
    );
    expect(annasAssigns.length).toBeGreaterThanOrEqual(2);
  });

  // The negative half is the point: a journey that only walks the happy path proves the feature
  // works and says nothing about whether it is safe.
  describe('the line the feature must hold', () => {
    it("renaming Bob's PERSONAL person (PUT /people/:id) stays owner-only, even for the space's own Editor", async () => {
      const personalPerson = await utils.createPerson(ctx.spaceOwner.token!);

      // `PersonUpdate` is checked via `requireAccess`, which throws BadRequestException (400) --
      // NOT the shared-space `requireRole`/`requireMembership` pair the six routes above use
      // (those throw ForbiddenException/403). Different access mechanism, different status code;
      // both refuse.
      const { status, body } = await request(app)
        .put(`/people/${personalPerson.id}`)
        .set(authHeaders(ctx.spaceEditor))
        .send({ name: 'Overwritten' });
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.noPermission);

      // Positive control: the person's own owner CAN rename it -- proves the refusal above is
      // role-driven, not a blanket lock on the endpoint.
      const renamed = await updatePerson(
        { id: personalPerson.id, personUpdateDto: { name: 'Bob renamed it himself' } },
        { headers: asBearerAuth(ctx.spaceOwner.token!) },
      );
      expect(renamed.name).toBe('Bob renamed it himself');
    });

    it('deleting a genuinely DETECTED face (createdBy IS NULL) is refused, even for the Editor who could delete her own box', async () => {
      const detectedFaceId = await utils.createUnassignedFace(ctx.spaceAssetId);

      const { status, body } = await request(app)
        .delete(`/shared-spaces/${ctx.spaceId}/faces/${detectedFaceId}`)
        .set(authHeaders(ctx.spaceEditor));

      expect(status).toBe(400);
      expect(body.message).toContain('Face not found');
    });

    it("acting on a face whose asset is NOT reachable in Anna's space is refused (attach)", async () => {
      // `ctx.ownerAssetId` is owned by Bob but was never added to the space — unreachable.
      const outOfSpaceFaceId = await utils.createUnassignedFace(ctx.ownerAssetId);

      const { status, body } = await request(app)
        .put(`/shared-spaces/${ctx.spaceId}/people/${sueId}/faces/${outOfSpaceFaceId}`)
        .set(authHeaders(ctx.spaceEditor));

      expect(status).toBe(400);
      expect(body.message).toContain('Face not found');
    });
  });

  // Actor matrix over every route this feature exposes, at HTTP level: Owner/Editor act,
  // Viewer/NonMember are refused. `requireRole`/`requireMembership` (shared-space.service.ts)
  // both throw ForbiddenException (403) — unlike the sibling asset-edit journey's routes, which
  // go through `requireAccess` (400). Verified by reading the service before writing this matrix,
  // not assumed: every one of the six routes below calls `requireRole` first, which throws before
  // any read or write happens, so a refused actor's request is a true no-op, never a silent
  // 200-with-empty-result — no non-throwing `checkAccess` trap exists in this feature (unlike the
  // sibling journey's `PUT /tags/assets` case, which the header comment there documents).
  describe('actor matrix over the widened routes', () => {
    it('GET /shared-spaces/:id/assets/:assetId/faces: owner/editor 200, viewer/non-member 403', async () => {
      await forEachActor(
        actorsFor(ctx),
        (actor) =>
          request(app).get(`/shared-spaces/${ctx.spaceId}/assets/${ctx.spaceAssetId}/faces`).set(authHeaders(actor)),
        { spaceOwner: 200, spaceEditor: 200, spaceViewer: 403, spaceNonMember: 403 },
      );
    });

    it('POST /shared-spaces/:id/people (create-and-attach): owner/editor 201, viewer/non-member 403', async () => {
      const actors = actorsFor(ctx);
      const faceByActor = new Map(
        await Promise.all(
          actors.map(async (actor) => [actor.id, await utils.createUnassignedFace(ctx.spaceAssetId)] as const),
        ),
      );

      await forEachActor(
        actors,
        (actor) =>
          request(app)
            .post(`/shared-spaces/${ctx.spaceId}/people`)
            .set(authHeaders(actor))
            .send({ name: `matrix-${actor.id}`, assetFaceId: faceByActor.get(actor.id) }),
        { spaceOwner: 201, spaceEditor: 201, spaceViewer: 403, spaceNonMember: 403 },
      );
    });

    it('PUT /shared-spaces/:id/people/:personId/faces/:assetFaceId (attach): owner/editor 200, viewer/non-member 403', async () => {
      const actors = actorsFor(ctx);
      const faceByActor = new Map(
        await Promise.all(
          actors.map(async (actor) => [actor.id, await utils.createUnassignedFace(ctx.spaceAssetId)] as const),
        ),
      );

      await forEachActor(
        actors,
        (actor) =>
          request(app)
            .put(`/shared-spaces/${ctx.spaceId}/people/${sueId}/faces/${faceByActor.get(actor.id)}`)
            .set(authHeaders(actor)),
        { spaceOwner: 200, spaceEditor: 200, spaceViewer: 403, spaceNonMember: 403 },
      );
    });

    it('DELETE /shared-spaces/:id/people/:personId/faces/:assetFaceId (detach): owner/editor 200, viewer/non-member 403', async () => {
      const actors = actorsFor(ctx);
      const faceByActor = new Map(
        await Promise.all(
          actors.map(async (actor) => {
            const faceId = await utils.createUnassignedFace(ctx.spaceAssetId);
            // Pre-attach as Bob so there is something for the actor under test to detach.
            await attachSpacePersonFace(
              { id: ctx.spaceId, personId: sueId, assetFaceId: faceId },
              { headers: asBearerAuth(ctx.spaceOwner.token!) },
            );
            return [actor.id, faceId] as const;
          }),
        ),
      );

      await forEachActor(
        actors,
        (actor) =>
          request(app)
            .delete(`/shared-spaces/${ctx.spaceId}/people/${sueId}/faces/${faceByActor.get(actor.id)}`)
            .set(authHeaders(actor)),
        { spaceOwner: 200, spaceEditor: 200, spaceViewer: 403, spaceNonMember: 403 },
      );
    });

    it('POST /shared-spaces/:id/assets/:assetId/faces (draw): owner/editor 201, viewer/non-member 403', async () => {
      await forEachActor(
        actorsFor(ctx),
        (actor) =>
          request(app)
            .post(`/shared-spaces/${ctx.spaceId}/assets/${ctx.spaceAssetId}/faces`)
            .set(authHeaders(actor))
            .send({ x: 1, y: 1, width: 10, height: 10, imageWidth: 1000, imageHeight: 1000, spacePersonId: sueId }),
        { spaceOwner: 201, spaceEditor: 201, spaceViewer: 403, spaceNonMember: 403 },
      );
    });

    it('DELETE /shared-spaces/:id/faces/:assetFaceId (delete a drawn box): owner/editor 204, viewer/non-member 403', async () => {
      const actors = actorsFor(ctx);
      const faceByActor = new Map(
        await Promise.all(
          actors.map(async (actor) => {
            // Drawn by Bob so there is something editor-drawn for the actor under test to delete.
            const face = await createSpaceAssetFace(
              {
                id: ctx.spaceId,
                assetId: ctx.spaceAssetId,
                spaceAssetFaceCreateDto: {
                  x: 1,
                  y: 1,
                  width: 10,
                  height: 10,
                  imageWidth: 1000,
                  imageHeight: 1000,
                  spacePersonId: sueId,
                },
              },
              { headers: asBearerAuth(ctx.spaceOwner.token!) },
            );
            return [actor.id, face.id] as const;
          }),
        ),
      );

      await forEachActor(
        actors,
        (actor) =>
          request(app)
            .delete(`/shared-spaces/${ctx.spaceId}/faces/${faceByActor.get(actor.id)}`)
            .set(authHeaders(actor)),
        { spaceOwner: 204, spaceEditor: 204, spaceViewer: 403, spaceNonMember: 403 },
      );
    });
  });
});
