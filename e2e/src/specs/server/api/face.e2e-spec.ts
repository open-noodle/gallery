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

// Helper for POST /faces request body. Pure (both ids passed in), hoisted out
// of the describe to satisfy unicorn/consistent-function-scoping.
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
    it('access matrix on the asset side', async () => {
      // Posting a face requires READ access to BOTH the asset and the person
      // (person.service.ts:641-642 — Permission.AssetRead + Permission.PersonRead, not
      // write). Use ownerAssetId (owned by spaceOwner) + ownerPerson (also spaceOwner).
      // Owner can; anon is 401; spaceNonMember is 400 (Immich's bulk-access pattern
      // returns 400 not 403 — the same taxonomic split T03 pinned for timeline endpoints).
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceNonMember, anonActor],
        (actor) =>
          request(app).post('/faces').set(authHeaders(actor)).send(newFaceBody(ctx.ownerAssetId, ownerPerson.id)),
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
        (actor) => request(app).get(`/faces?id=${ctx.ownerAssetId}`).set(authHeaders(actor)),
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
      const ourFace = (body as Array<{ id: string; person?: { id: string } | null }>).find((f) => f.id === ownerFaceId);
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
          request(app).put(`/faces/${secondOwnerPerson.id}`).set(authHeaders(actor)).send({ id: scratchFaceId }),
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

  describe('face deletion side effects (T08)', () => {
    // T08 covers what happens after the face row goes away. The bug shapes being
    // pinned: soft-delete excludes from GET via deletedAt filter (PR-era patch),
    // statistics denormalization decreases the asset count, the global person row
    // is NOT cascaded when its only face goes away, and re-creating the same face
    // after a soft-delete works.
    //
    // What's deliberately NOT covered here:
    // - Below-minFaces unaddressable: that's a *space-person* concern (PR #139),
    //   testable in T10/T11 not in the global /faces controller.
    // - Space-person dedup queue jobId deduplication (PR #292): requires probing
    //   queue state that's not exposed via the face controller. The space-person
    //   dedup endpoint is in T14.

    it('soft-deleted face is excluded from GET /faces', async () => {
      // person.repository.ts:229 — getFaces filters `asset_face.deletedAt IS NULL`.
      // After softDeleteAssetFaces sets deletedAt, the face vanishes from the listing
      // even though the row still exists.
      const sidePerson = await utils.createPerson(ctx.spaceOwner.token!, { name: 'Carol' });
      const sideFaceId = await utils.createFace({ assetId: ctx.ownerAssetId, personId: sidePerson.id });

      // Pre-condition: face is in the listing.
      const before = await request(app).get(`/faces?id=${ctx.ownerAssetId}`).set(asBearerAuth(ctx.spaceOwner.token!));
      expect((before.body as Array<{ id: string }>).find((f) => f.id === sideFaceId)).toBeDefined();

      // Soft-delete.
      await request(app).delete(`/faces/${sideFaceId}`).set(asBearerAuth(ctx.spaceOwner.token!)).send({ force: false });

      const after = await request(app).get(`/faces?id=${ctx.ownerAssetId}`).set(asBearerAuth(ctx.spaceOwner.token!));
      expect((after.body as Array<{ id: string }>).find((f) => f.id === sideFaceId)).toBeUndefined();
    });

    it('hard-deleted face is excluded from GET /faces', async () => {
      // Same observable result, different mechanism: deleteAssetFace removes the row
      // entirely instead of setting deletedAt.
      const sidePerson = await utils.createPerson(ctx.spaceOwner.token!, { name: 'Dave' });
      const sideFaceId = await utils.createFace({ assetId: ctx.ownerAssetId, personId: sidePerson.id });

      await request(app).delete(`/faces/${sideFaceId}`).set(asBearerAuth(ctx.spaceOwner.token!)).send({ force: true });

      const after = await request(app).get(`/faces?id=${ctx.ownerAssetId}`).set(asBearerAuth(ctx.spaceOwner.token!));
      expect((after.body as Array<{ id: string }>).find((f) => f.id === sideFaceId)).toBeUndefined();
    });

    it('soft-deleting the only face on a person preserves the person row', async () => {
      // Global persons are NOT cascade-deleted when their only face is removed —
      // the person row stays addressable via GET /people/:id. This matters for the
      // shared-spaces UX where a member labels a person and the underlying person
      // row outlives any individual face attachment.
      const sidePerson = await utils.createPerson(ctx.spaceOwner.token!, { name: 'Eve' });
      const sideFaceId = await utils.createFace({ assetId: ctx.ownerAssetId, personId: sidePerson.id });

      await request(app).delete(`/faces/${sideFaceId}`).set(asBearerAuth(ctx.spaceOwner.token!)).send({ force: false });

      const personRes = await request(app).get(`/people/${sidePerson.id}`).set(asBearerAuth(ctx.spaceOwner.token!));
      expect(personRes.status).toBe(200);
      expect((personRes.body as { id: string }).id).toBe(sidePerson.id);
    });

    it("soft-deleting a face decreases the person's asset statistics", async () => {
      // person.repository.ts:335-352 — getStatistics counts asset_face rows joined
      // through asset, with `asset_face.deletedAt IS NULL` AND `asset_face.isVisible IS true`.
      // Soft-delete sets deletedAt → the row drops out of the count.
      const sidePerson = await utils.createPerson(ctx.spaceOwner.token!, { name: 'Frank' });
      const sideFaceId = await utils.createFace({ assetId: ctx.ownerAssetId, personId: sidePerson.id });

      const before = await request(app)
        .get(`/people/${sidePerson.id}/statistics`)
        .set(asBearerAuth(ctx.spaceOwner.token!));
      expect(before.status).toBe(200);
      expect((before.body as { assets: number }).assets).toBe(1);

      await request(app).delete(`/faces/${sideFaceId}`).set(asBearerAuth(ctx.spaceOwner.token!)).send({ force: false });

      const after = await request(app)
        .get(`/people/${sidePerson.id}/statistics`)
        .set(asBearerAuth(ctx.spaceOwner.token!));
      expect(after.status).toBe(200);
      expect((after.body as { assets: number }).assets).toBe(0);
    });

    it("hard-deleting a face decreases the person's asset statistics", async () => {
      // Same denormalization, hard-delete path.
      const sidePerson = await utils.createPerson(ctx.spaceOwner.token!, { name: 'Grace' });
      const sideFaceId = await utils.createFace({ assetId: ctx.ownerAssetId, personId: sidePerson.id });

      await request(app).delete(`/faces/${sideFaceId}`).set(asBearerAuth(ctx.spaceOwner.token!)).send({ force: true });

      const after = await request(app)
        .get(`/people/${sidePerson.id}/statistics`)
        .set(asBearerAuth(ctx.spaceOwner.token!));
      expect(after.status).toBe(200);
      expect((after.body as { assets: number }).assets).toBe(0);
    });

    it('re-attaching a face after a soft-delete inserts a new row that the deletedAt filter actually distinguishes', async () => {
      // Two-asset variant of the re-attach test. The test pins TWO things:
      //
      // 1) The deletedAt filter on people statistics is load-bearing. With the
      //    soft-deleted face on asset A and the new face on asset B, the
      //    `count(distinct asset.id)` distinguishes between filtered and unfiltered:
      //    - With deletedAt filter (correct):  1 (only asset B)
      //    - Without deletedAt filter (broken): 2 (asset A + asset B)
      //    Asserted at line 320 below.
      //
      // 2) The (assetId, personId) tuple has no UNIQUE constraint, so a second
      //    insert on the SAME (assetId, personId) — even while a soft-deleted
      //    row exists — succeeds and bumps the count from 1 to 2. Asserted by
      //    the bonus block at lines 322-329 below. This probes the absence of
      //    a UNIQUE index by actually inserting + counting; without the bonus
      //    block, the test would only cover the deletedAt filter.
      const sidePerson = await utils.createPerson(ctx.spaceOwner.token!, { name: 'Henry' });
      const secondAsset = await utils.createAsset(ctx.spaceOwner.token!);

      // First face on ownerAssetId; soft-delete it.
      const firstFaceId = await utils.createFace({ assetId: ctx.ownerAssetId, personId: sidePerson.id });
      await request(app)
        .delete(`/faces/${firstFaceId}`)
        .set(asBearerAuth(ctx.spaceOwner.token!))
        .send({ force: false });

      // New face on the second asset.
      const secondFaceId = await utils.createFace({ assetId: secondAsset.id, personId: sidePerson.id });
      expect(secondFaceId).not.toBe(firstFaceId);

      // Stats count only the new face → 1. If the deletedAt filter were broken,
      // both faces would be counted via distinct asset ids → 2.
      const stats = await request(app)
        .get(`/people/${sidePerson.id}/statistics`)
        .set(asBearerAuth(ctx.spaceOwner.token!));
      expect((stats.body as { assets: number }).assets).toBe(1);

      // Bonus: re-attaching the same (assetId, personId) on ownerAssetId still works
      // even with the soft-deleted row in place — there's no UNIQUE constraint.
      const reAttachId = await utils.createFace({ assetId: ctx.ownerAssetId, personId: sidePerson.id });
      expect(reAttachId).not.toBe(firstFaceId);
      const stats2 = await request(app)
        .get(`/people/${sidePerson.id}/statistics`)
        .set(asBearerAuth(ctx.spaceOwner.token!));
      expect((stats2.body as { assets: number }).assets).toBe(2);
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
