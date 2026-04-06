import { type Actor, type SpaceContext, authHeaders, buildSpaceContext, forEachActor } from 'src/actors';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Coverage for the /faces controller (face.controller.ts). T07 covers the CRUD access
// matrix; T08 covers the side effects (face deletion → space-person dedup, person
// assetCount denormalization, below-minFaces faces unaddressable).
//
// IMPORTANT API SHAPE NOTES:
// - POST /faces creates a face, but returns void (not the created row). To get the
//   face id we use utils.createFace which inserts directly via DB and returns the id.
// - GET /faces?id=<assetId> takes an *asset id* in the `id` query param (the FaceDto
//   field is named `id` but represents the asset). Returns AssetFaceResponseDto[].
// - PUT /faces/:personId is the *target person*; the BODY's id field is the FACE id.
//   The semantics is "reassign the face in the body to the person in the path".
// - DELETE /faces/:faceId — path is the face id; body has { force: boolean }.

describe('/faces', () => {
  let ctx: SpaceContext;
  const anonActor: Actor = { id: 'anon' };

  // Person owned by spaceOwner.
  let ownerPerson: { id: string };
  // A second person owned by spaceOwner — used as the reassign target in PUT tests.
  let secondOwnerPerson: { id: string };
  // A person owned by spaceNonMember — used to assert cross-owner reassign is rejected.
  let crossOwnerPerson: { id: string };

  // The face used by GET / PUT / DELETE access matrix tests. Created via direct DB
  // insert so we get the id back; T08 will exercise the POST /faces endpoint side.
  let ownerFaceId: string;

  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext();

    [ownerPerson, secondOwnerPerson, crossOwnerPerson] = await Promise.all([
      utils.createPerson(ctx.spaceOwner.token!, { name: 'Alice' }),
      utils.createPerson(ctx.spaceOwner.token!, { name: 'Anne' }),
      utils.createPerson(ctx.spaceNonMember.token!, { name: 'Bob' }),
    ]);

    ownerFaceId = await utils.createFace({ assetId: ctx.ownerAssetId, personId: ownerPerson.id });
  });

  describe('POST /faces', () => {
    const newFaceBody = (assetId: string, personId: string) => ({
      personId,
      assetId,
      imageWidth: 100,
      imageHeight: 100,
      x: 50,
      y: 50,
      width: 20,
      height: 20,
    });

    it('access matrix on the asset side', async () => {
      // Posting a face requires write access to BOTH the asset and the person. Use
      // ownerAssetId (owned by spaceOwner) + ownerPerson (also spaceOwner). Owner can;
      // anon is 401; spaceNonMember is 400 (Immich's bulk-access pattern returns 400 not
      // 403 — the same taxonomic split T03 pinned for timeline endpoints).
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceNonMember, anonActor],
        (actor) =>
          request(app)
            .post('/faces')
            .set(authHeaders(actor))
            .send(newFaceBody(ctx.ownerAssetId, ownerPerson.id)),
        { spaceOwner: 201, spaceNonMember: 400, anon: 401 },
      );
    });

    it('cross-owner asset is rejected even when the person belongs to the caller', async () => {
      // spaceNonMember owns crossOwnerPerson but tries to attach a face to ownerAssetId
      // which is owned by spaceOwner. The asset access check fires → 400.
      const { status } = await request(app)
        .post('/faces')
        .set(asBearerAuth(ctx.spaceNonMember.token!))
        .send(newFaceBody(ctx.ownerAssetId, crossOwnerPerson.id));
      expect(status).toBe(400);
    });

    it('cross-owner person is rejected even when the asset belongs to the caller', async () => {
      // spaceOwner owns ownerAssetId but tries to attach a face linked to crossOwnerPerson
      // (owned by spaceNonMember). The person access check rejects → 400.
      const { status } = await request(app)
        .post('/faces')
        .set(asBearerAuth(ctx.spaceOwner.token!))
        .send(newFaceBody(ctx.ownerAssetId, crossOwnerPerson.id));
      expect(status).toBe(400);
    });
  });

  describe('GET /faces', () => {
    it('access matrix when reading faces of an asset', async () => {
      // GET /faces takes ?id=<assetId>. Owner sees the faces on their asset.
      // spaceNonMember has no access path to the asset → 400. anon → 401.
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceNonMember, anonActor],
        (actor) =>
          request(app)
            .get(`/faces?id=${ctx.ownerAssetId}`)
            .set(authHeaders(actor)),
        { spaceOwner: 200, spaceNonMember: 400, anon: 401 },
      );
    });

    it('owner gets the face row with the linked person', async () => {
      // The exact face count is influenced by upstream POST tests and the createPerson
      // helper's setPersonThumbnail side effects. Assert the load-bearing invariant
      // (the face we created is in the response, linked to the right person) rather
      // than a specific count, so the test stays meaningful regardless of how many
      // other faces accumulated on the asset.
      const { status, body } = await request(app)
        .get(`/faces?id=${ctx.ownerAssetId}`)
        .set(asBearerAuth(ctx.spaceOwner.token!));
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      const ourFace = (body as Array<{ id: string; person?: { id: string } | null }>).find(
        (f) => f.id === ownerFaceId,
      );
      expect(ourFace).toBeDefined();
      expect(ourFace?.person?.id).toBe(ownerPerson.id);
    });
  });

  describe('PUT /faces/:personId (reassign)', () => {
    // The path :id is the *target person* and the body { id } is the *face id*.
    // The semantics: "reassign the face provided in the body to the person identified
    // by the id in the path parameter" (face.controller.ts line 49).
    //
    // We use a scratch face per test so the access matrix doesn't permanently mutate
    // ownerFaceId and break the GET assertion test or DELETE tests.
    it('access matrix when reassigning a face to a new person', async () => {
      // Owner can reassign their own face to their own person (Alice → Anne).
      // spaceNonMember can't reach the target person → 400. anon → 401.
      const scratchFaceId = await utils.createFace({
        assetId: ctx.ownerAssetId,
        personId: ownerPerson.id,
      });

      await forEachActor(
        [ctx.spaceOwner, ctx.spaceNonMember, anonActor],
        (actor) =>
          request(app)
            .put(`/faces/${secondOwnerPerson.id}`)
            .set(authHeaders(actor))
            .send({ id: scratchFaceId }),
        { spaceOwner: 200, spaceNonMember: 400, anon: 401 },
      );
    });

    it('reassigning to a cross-owner target person is rejected', async () => {
      // spaceOwner tries to reassign their face to crossOwnerPerson (owned by
      // spaceNonMember). The person-access check on the target rejects → 400.
      const scratchFaceId = await utils.createFace({
        assetId: ctx.ownerAssetId,
        personId: ownerPerson.id,
      });

      const { status } = await request(app)
        .put(`/faces/${crossOwnerPerson.id}`)
        .set(asBearerAuth(ctx.spaceOwner.token!))
        .send({ id: scratchFaceId });
      expect(status).toBe(400);
    });
  });

  describe('DELETE /faces/:id', () => {
    // DELETE mutates state. We create a fresh face per test so the assertions don't
    // collide on shared state.
    it('owner can soft-delete (force=false)', async () => {
      const scratchFaceId = await utils.createFace({
        assetId: ctx.ownerAssetId,
        personId: ownerPerson.id,
      });

      const { status } = await request(app)
        .delete(`/faces/${scratchFaceId}`)
        .set(asBearerAuth(ctx.spaceOwner.token!))
        .send({ force: false });
      expect(status).toBe(204);
    });

    it('owner can force-delete (force=true)', async () => {
      const scratchFaceId = await utils.createFace({
        assetId: ctx.ownerAssetId,
        personId: ownerPerson.id,
      });

      const { status } = await request(app)
        .delete(`/faces/${scratchFaceId}`)
        .set(asBearerAuth(ctx.spaceOwner.token!))
        .send({ force: true });
      expect(status).toBe(204);
    });

    it('access matrix for delete', async () => {
      // The owner-success cases are covered by the two tests above. Here we just probe
      // that non-owner / anon cannot delete a face. Use a fresh face per actor so
      // state doesn't leak across the matrix.
      for (const [actor, expected] of [
        [ctx.spaceNonMember, 400],
        [anonActor, 401],
      ] as const) {
        const scratchFaceId = await utils.createFace({
          assetId: ctx.ownerAssetId,
          personId: ownerPerson.id,
        });

        const { status } = await request(app)
          .delete(`/faces/${scratchFaceId}`)
          .set(authHeaders(actor))
          .send({ force: false });
        expect(status, `actor=${actor.id}`).toBe(expected);
      }
    });
  });
});
