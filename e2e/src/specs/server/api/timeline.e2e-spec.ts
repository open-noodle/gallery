import { AssetVisibility, type LoginResponseDto } from '@immich/sdk';
import { type Actor, type SpaceContext, authHeaders, buildSpaceContext, forEachActor } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Coverage for the timeline endpoints. T03 covers the access matrix (auth + spaceId
// scoping); follow-up tasks T04 (withSharedSpaces), T05 (visibility filters),
// T06 (filter passthrough with spaceId) extend this file.
//
// Important behavioural fact this file pins: timeline-family endpoints route
// through `requireAccess` (src/utils/access.ts:37-42) which throws BadRequestException,
// so non-members get 400 (not 403). Shared-space-family endpoints use
// `requireMembership` which returns 403. See the backlog "Observed invariants" section.

// Helper for summing bucket counts. Pure, hoisted to file scope so all
// describe blocks below can reference it (was duplicated 3× before).
const total = (body: unknown) => (body as Array<{ count: number }>).reduce((acc, b) => acc + b.count, 0);

describe('/timeline', () => {
  let ctx: SpaceContext;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext({ withPartner: true });
    // Drain metadata extraction before inner describes mutate tags/ratings on
    // ctx assets. Late metadata extraction calls applyTagList → replaceAssetTags
    // which DELETEs all tag_asset rows and re-inserts from EXIF (empty for test
    // PNGs), wiping any tags a nested beforeAll applied. Same root cause as the
    // filter-suggestions and tag-suggestions ARM flakes.
    await utils.waitForQueueFinish(ctx.admin.token!, 'metadataExtraction');
  });

  describe('GET /timeline/buckets', () => {
    it('requires authentication', async () => {
      await forEachActor(
        [anonActor, ctx.spaceOwner],
        (actor) => request(app).get('/timeline/buckets').set(authHeaders(actor)),
        { anon: 401, spaceOwner: 200 },
      );
    });

    it('owner sees their own assets when no filter is applied', async () => {
      const { status, body } = await request(app).get('/timeline/buckets').set(asBearerAuth(ctx.spaceOwner.token!));

      expect(status).toBe(200);
      // spaceOwner has 2 assets total: ownerAssetId (not in space) + spaceAssetId (in space).
      // Both are owned by spaceOwner, so the unfiltered timeline should sum to 2.
      const total = (body as Array<{ count: number }>).reduce((acc, b) => acc + b.count, 0);
      expect(total).toBe(2);
    });

    it('spaceId access matrix returns the right status per actor', async () => {
      // The core of this PR: owner/editor/viewer get 200, non-member gets 400 (timeline
      // uses requireAccess → BadRequestException, NOT requireMembership → 403).
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, anonActor],
        (actor) => request(app).get(`/timeline/buckets?spaceId=${ctx.spaceId}`).set(authHeaders(actor)),
        { spaceOwner: 200, spaceEditor: 200, spaceViewer: 200, spaceNonMember: 400, anon: 401 },
      );
    });

    it('spaceId scopes assets to the space, not to the requesting user', async () => {
      // spaceOwner with spaceId should see only spaceAssetId (1 asset), NOT ownerAssetId.
      // If the implementation accidentally `WHERE asset.ownerId = auth.user.id` instead of
      // joining through shared_space_asset, the count would be 2 here.
      const { status, body } = await request(app)
        .get(`/timeline/buckets?spaceId=${ctx.spaceId}`)
        .set(asBearerAuth(ctx.spaceOwner.token!));

      expect(status).toBe(200);
      const total = (body as Array<{ count: number }>).reduce((acc, b) => acc + b.count, 0);
      expect(total).toBe(1);
    });

    it('non-owner space members actually see the space content via spaceId', async () => {
      // The PR #163 / #202 bug shape. spaceEditor and spaceViewer own no assets in this
      // space themselves, but as members they should see spaceAssetId via the join.
      // Pure status-code testing (test 3) is not enough — that bug class returned 200
      // with an empty body.
      for (const actor of [ctx.spaceEditor, ctx.spaceViewer]) {
        const { status, body } = await request(app)
          .get(`/timeline/buckets?spaceId=${ctx.spaceId}`)
          .set(asBearerAuth(actor.token!));

        expect(status, `actor=${actor.id}`).toBe(200);
        const total = (body as Array<{ count: number }>).reduce((acc, b) => acc + b.count, 0);
        expect(total, `actor=${actor.id} should see the 1 space asset`).toBe(1);
      }
    });
  });

  describe('GET /timeline/bucket', () => {
    // The bucket query needs a YYYY-MM-DD identifier corresponding to the start of the
    // month. buildSpaceContext creates assets with fileCreatedAt = new Date() (now), so
    // they all land in the current month bucket.
    const currentMonthBucket = (() => {
      const now = new Date();
      const yyyy = now.getUTCFullYear();
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      return `${yyyy}-${mm}-01`;
    })();

    it('requires authentication', async () => {
      await forEachActor(
        [anonActor, ctx.spaceOwner],
        (actor) => request(app).get(`/timeline/bucket?timeBucket=${currentMonthBucket}`).set(authHeaders(actor)),
        { anon: 401, spaceOwner: 200 },
      );
    });

    it('spaceId access matrix returns the right status per actor', async () => {
      // Mirror of /buckets test 3 — the risk being probed is that someone forgets to
      // apply the same scoping check on the singular endpoint. PR #260 is in this family.
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, anonActor],
        (actor) =>
          request(app)
            .get(`/timeline/bucket?timeBucket=${currentMonthBucket}&spaceId=${ctx.spaceId}`)
            .set(authHeaders(actor)),
        { spaceOwner: 200, spaceEditor: 200, spaceViewer: 200, spaceNonMember: 400, anon: 401 },
      );
    });

    it('non-owner space members see the space asset via the singular endpoint', async () => {
      // Pairs with /buckets test 5 — same bug class, different endpoint. Probes that
      // /bucket also joins through shared_space_asset and doesn't fall back to
      // `WHERE asset.ownerId = auth.user.id`.
      for (const actor of [ctx.spaceEditor, ctx.spaceViewer]) {
        const { status, body } = await request(app)
          .get(`/timeline/bucket?timeBucket=${currentMonthBucket}&spaceId=${ctx.spaceId}`)
          .set(asBearerAuth(actor.token!));

        expect(status, `actor=${actor.id}`).toBe(200);
        // Response is TimeBucketAssetResponseDto — parallel arrays with `id[]` at the top.
        const ids = (body as { id: string[] }).id;
        expect(ids, `actor=${actor.id}`).toContain(ctx.spaceAssetId);
      }
    });

    it('returns the asset arrays, not bucket counts', async () => {
      // Sanity check that /bucket and /buckets return distinct shapes — /buckets returns
      // [{timeBucket, count}], /bucket returns the parallel-array TimeBucketAssetResponseDto.
      const { status, body } = await request(app)
        .get(`/timeline/bucket?timeBucket=${currentMonthBucket}`)
        .set(asBearerAuth(ctx.spaceOwner.token!));

      expect(status).toBe(200);
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('ownerId');
      expect(body).not.toHaveProperty('count');
      expect(Array.isArray((body as { id: string[] }).id)).toBe(true);
    });
  });

  describe('GET /timeline/buckets — withSharedSpaces and withPartners', () => {
    // These flags are gated server-side: timeline.service.ts:91-113 throws 400 if
    // visibility is undefined OR set to Archive (because requestedArchived is true in
    // both cases), so all calls in this block must pass `visibility=TIMELINE` explicitly.

    it('withSharedSpaces=true makes a non-owner member see space content via their own timeline', async () => {
      // spaceEditor owns 1 asset (editorAssetId, NOT in the space). Without withSharedSpaces,
      // their timeline shows just that one. With withSharedSpaces=true, the union picks up
      // spaceAssetId via the membership (which has showInTimeline=true by default).
      const { status: defaultStatus, body: defaultBody } = await request(app)
        .get('/timeline/buckets?visibility=timeline')
        .set(asBearerAuth(ctx.spaceEditor.token!));
      expect(defaultStatus).toBe(200);
      expect(total(defaultBody)).toBe(1);

      const { status, body } = await request(app)
        .get('/timeline/buckets?visibility=timeline&withSharedSpaces=true')
        .set(asBearerAuth(ctx.spaceEditor.token!));
      expect(status).toBe(200);
      expect(total(body)).toBe(2);
    });

    it('toggling showInTimeline=false hides space content from withSharedSpaces=true', async () => {
      // PATCH /shared-spaces/:id/members/me/timeline persists per-user. Snapshot + restore
      // in try/finally per the fixture lifetime contract, so this test doesn't pollute
      // sibling tests in the file.
      try {
        const disable = await request(app)
          .patch(`/shared-spaces/${ctx.spaceId}/members/me/timeline`)
          .set(asBearerAuth(ctx.spaceEditor.token!))
          .send({ showInTimeline: false });
        expect(disable.status).toBe(200);

        const { status, body } = await request(app)
          .get('/timeline/buckets?visibility=timeline&withSharedSpaces=true')
          .set(asBearerAuth(ctx.spaceEditor.token!));
        expect(status).toBe(200);
        // With showInTimeline=false, the space drops out of getSpaceIdsForTimeline,
        // so spaceEditor sees only their own 1 asset.
        expect(total(body)).toBe(1);
      } finally {
        await request(app)
          .patch(`/shared-spaces/${ctx.spaceId}/members/me/timeline`)
          .set(asBearerAuth(ctx.spaceEditor.token!))
          .send({ showInTimeline: true });
      }
    });

    it('withPartners=true makes spaceOwner see partner-shared assets', async () => {
      // partner has shared their library with spaceOwner via createPartner. spaceOwner
      // owns 2 assets (ownerAssetId + spaceAssetId); the partner has 1 (partnerAssetId).
      // With withPartners=true, total = 3.
      const { status, body } = await request(app)
        .get('/timeline/buckets?visibility=timeline&withPartners=true')
        .set(asBearerAuth(ctx.spaceOwner.token!));
      expect(status).toBe(200);
      expect(total(body)).toBe(3);
    });

    it('default (no withPartners) excludes partner-shared assets', async () => {
      const { status, body } = await request(app)
        .get('/timeline/buckets?visibility=timeline')
        .set(asBearerAuth(ctx.spaceOwner.token!));
      expect(status).toBe(200);
      expect(total(body)).toBe(2);
    });

    it('withSharedSpaces and withPartners can be combined', async () => {
      // spaceOwner owns 2; partner has 1; the space contributes 0 NEW assets to spaceOwner
      // (they already own spaceAssetId directly). Total still 3 — verifies the two flags
      // don't double-count assets that satisfy both branches.
      const { status, body } = await request(app)
        .get('/timeline/buckets?visibility=timeline&withPartners=true&withSharedSpaces=true')
        .set(asBearerAuth(ctx.spaceOwner.token!));
      expect(status).toBe(200);
      expect(total(body)).toBe(3);
    });

    it('withSharedSpaces=true without explicit visibility throws 400 with the right message', async () => {
      // Pinned by the backlog "Observed invariants" section. timeline.service.ts:103-113
      // treats `visibility === undefined` as `requestedArchived = true` and rejects when
      // either flag is set. Folded into T05 because it's the visibility-semantics task.
      // We check the error message specifically so a future unrelated 400 (e.g. a DTO
      // validation change) doesn't silently still satisfy the test.
      const { status, body } = await request(app)
        .get('/timeline/buckets?withSharedSpaces=true')
        .set(asBearerAuth(ctx.spaceOwner.token!));
      expect(status).toBe(400);
      expect((body as { message?: string }).message).toMatch(/withSharedSpaces/);
    });

    it('withPartners=true without explicit visibility throws 400 with the right message', async () => {
      // Same invariant, different flag.
      const { status, body } = await request(app)
        .get('/timeline/buckets?withPartners=true')
        .set(asBearerAuth(ctx.spaceOwner.token!));
      expect(status).toBe(400);
      expect((body as { message?: string }).message).toMatch(/withPartners/);
    });
  });

  describe('GET /timeline/buckets — visibility filters', () => {
    // Dedicated user with 4 assets in different visibility states. Using a fresh user
    // (not spaceOwner) keeps the asset counts deterministic and avoids polluting other
    // describes that already assert specific spaceOwner counts.
    //
    // Tests assert on aggregate counts via `total(body)`, not on individual asset IDs,
    // so the asset references are scoped to beforeAll.
    let visibilityUser: LoginResponseDto;

    beforeAll(async () => {
      visibilityUser = await utils.userSetup(ctx.admin.token!, createUserDto.create('visibility'));
      // Three assets in distinct visibility states; created in parallel because none
      // depend on each other.
      await Promise.all([
        utils.createAsset(visibilityUser.accessToken),
        utils.createAsset(visibilityUser.accessToken, { visibility: AssetVisibility.Archive }),
        utils.createAsset(visibilityUser.accessToken, { visibility: AssetVisibility.Hidden }),
      ]);
      // Fourth asset gets soft-deleted (deletedAt set, asset moved to trash). Pulled out
      // of the Promise.all because we need its id for the deleteAssets call.
      const trashed = await utils.createAsset(visibilityUser.accessToken);
      await utils.deleteAssets(visibilityUser.accessToken, [trashed.id]);
    });

    it('default visibility (no param) returns Timeline AND Archive assets', async () => {
      // Non-obvious server behaviour: `withDefaultVisibility` at server/src/utils/database.ts:79-81
      // is `where('asset.visibility', 'in', [Archive, Timeline])` — NOT just Timeline.
      // The web UI's "main timeline" view must pass `visibility=timeline` explicitly to
      // exclude archived assets. Hidden + Locked are always excluded by the default filter,
      // and trashed assets are excluded via `deletedAt IS NULL`.
      //
      // This test pins the invariant. visibilityUser has 4 assets: timeline + archive +
      // hidden + trashed; default returns 2 (timeline + archive).
      const { status, body } = await request(app)
        .get('/timeline/buckets')
        .set(asBearerAuth(visibilityUser.accessToken));
      expect(status).toBe(200);
      expect(total(body)).toBe(2);
    });

    it('visibility=timeline returns only timeline-visible assets', async () => {
      // The strict view that the web UI's main timeline passes explicitly.
      const { status, body } = await request(app)
        .get('/timeline/buckets?visibility=timeline')
        .set(asBearerAuth(visibilityUser.accessToken));
      expect(status).toBe(200);
      expect(total(body)).toBe(1);
    });

    it('visibility=archive returns only archived assets', async () => {
      const { status, body } = await request(app)
        .get('/timeline/buckets?visibility=archive')
        .set(asBearerAuth(visibilityUser.accessToken));
      expect(status).toBe(200);
      expect(total(body)).toBe(1);
    });

    it('visibility=hidden returns only hidden assets', async () => {
      // Hidden visibility is normally used for the video part of live photos / motion
      // photos (per the AssetVisibility enum docstring at server/src/enum.ts:907-909).
      // Setting it on a regular image works at the schema level and the timeline filter
      // honours it — pin that here so a future refactor doesn't break the live-photo path.
      const { status, body } = await request(app)
        .get('/timeline/buckets?visibility=hidden')
        .set(asBearerAuth(visibilityUser.accessToken));
      expect(status).toBe(200);
      expect(total(body)).toBe(1);
    });

    it('soft-deleted (trashed) assets are excluded regardless of visibility filter', async () => {
      // Trashed assets have `deletedAt` set; the timeline query at asset.repository.ts:942
      // filters with `deletedAt IS NULL`, independent of visibility. Verify the exclusion
      // applies under both the default filter and an explicit visibility filter — a
      // regression in either path would inflate the count by 1.
      //
      // Both soft-delete and force-delete set `deletedAt` (asset.service.ts), so this
      // test characterises the deletedAt-based exclusion, which is what the timeline
      // actually depends on. Force-deleted assets are exercised by the trash spec.
      const defaultResult = await request(app).get('/timeline/buckets').set(asBearerAuth(visibilityUser.accessToken));
      expect(defaultResult.status).toBe(200);
      expect(total(defaultResult.body)).toBe(2); // timeline + archive, NOT trashed

      const timelineResult = await request(app)
        .get('/timeline/buckets?visibility=timeline')
        .set(asBearerAuth(visibilityUser.accessToken));
      expect(timelineResult.status).toBe(200);
      expect(total(timelineResult.body)).toBe(1); // only the live timeline asset
    });
  });

  describe('GET /timeline/buckets — filter passthrough with spaceId', () => {
    // T06 probes the PR #260 bug class: timeline.dto.ts has a *dedicated* `spacePersonId`
    // field separate from `personId`. The bug shape was matching a global `personId`
    // against a `shared_space_person.id`. The fork's fix introduced spacePersonId; tests
    // here pin that the two filters route to different code paths.
    //
    // We share the outer ctx (built once per file) but create our own person/tag
    // fixtures in beforeAll. The fixture lifetime contract is preserved because we don't
    // mutate ctx — we only add new rows attached to ctx.spaceId / ctx.spaceAssetId.
    let spacePerson: { globalPersonId: string; spacePersonId: string; faceId: string };
    let decoyGlobalPersonId: string;
    let spaceTagId: string;

    beforeAll(async () => {
      // 1. Add a named space person to the space asset via the T02 helper (inserts the
      // shared_space_person_face junction row that the timeline filter joins through).
      spacePerson = await utils.createSpacePerson(ctx.spaceId, 'Alice', ctx.spaceOwner.userId!, ctx.spaceAssetId);

      // 2. Decoy: a bare global person attached only to ownerAssetId (which is NOT in
      // the space). No shared_space_person row, no junction row. This is the asset that
      // the PR #260 boundary test in test 6 tries to reach by passing the global personId
      // alongside spaceId — it should NOT come back, because the spaceId scoping should
      // restrict the result set to assets in the space.
      const decoy = await utils.createPerson(ctx.spaceOwner.token!, { name: 'Decoy Bob' });
      decoyGlobalPersonId = decoy.id;
      await utils.createFace({ assetId: ctx.ownerAssetId, personId: decoyGlobalPersonId });

      // 3. Create a tag owned by spaceOwner and apply it to spaceAssetId only. The tag is
      // owned globally — there's no "space tag" concept — so the timeline join goes
      // through tag_asset.
      const [tag] = await utils.upsertTags(ctx.spaceOwner.token!, ['T06SpaceTag']);
      spaceTagId = tag.id;
      await utils.tagAssets(ctx.spaceOwner.token!, spaceTagId, [ctx.spaceAssetId]);
    });

    it('spacePersonId filter restricts a space query to assets containing that person', async () => {
      // spaceOwner queries the space and filters by the space-person we just attached.
      // Only spaceAssetId has the face, so result = 1. The filter goes through
      // shared_space_person_face → asset_face → asset.
      const { status, body } = await request(app)
        .get(`/timeline/buckets?spaceId=${ctx.spaceId}&spacePersonId=${spacePerson.spacePersonId}`)
        .set(asBearerAuth(ctx.spaceOwner.token!));
      expect(status).toBe(200);
      expect(total(body)).toBe(1);
    });

    it('passing the GLOBAL personId on a space query stays scoped to space assets', async () => {
      // PR #260 boundary test, part 1. The decoy global person (Bob) is attached only
      // to ownerAssetId, which is NOT in the space. Querying with the decoy's GLOBAL
      // personId alongside spaceId should NOT return ownerAssetId, because the spaceId
      // restriction should fence the result set off to space-scoped assets.
      //
      // If a future regression breaks the spaceId scoping in the timeline query (the
      // PR #260 bug shape), this test would return 1 instead of 0 — the decoy's asset
      // would leak through. The other direction (test 1 returns 1) is also necessary
      // but not sufficient on its own; this test is the actual boundary pin.
      const { status, body } = await request(app)
        .get(`/timeline/buckets?spaceId=${ctx.spaceId}&personId=${decoyGlobalPersonId}`)
        .set(asBearerAuth(ctx.spaceOwner.token!));
      expect(status).toBe(200);
      expect(total(body)).toBe(0);
    });

    it('passing a global personId attached to a space asset still works via the asset_face join', async () => {
      // PR #260 boundary test, part 2. spacePerson.globalPersonId IS attached to
      // spaceAssetId (createSpacePerson inserts the asset_face row), so this query is
      // legitimately allowed to find spaceAssetId via asset_face. Result = 1.
      //
      // Together with the decoy test above, the two tests pin both the "in" and "out"
      // sides of the spaceId boundary on the global personId join: a non-space asset's
      // global person stays excluded, a space asset's global person is reachable.
      const { status, body } = await request(app)
        .get(`/timeline/buckets?spaceId=${ctx.spaceId}&personId=${spacePerson.globalPersonId}`)
        .set(asBearerAuth(ctx.spaceOwner.token!));
      expect(status).toBe(200);
      expect(total(body)).toBe(1);
    });

    it('spacePersonId without spaceId is allowed and matches via the junction join', async () => {
      // Without spaceId, timeBucketChecks defaults dto.userId to auth.user.id (spaceOwner).
      // The spacePersonId join then goes through shared_space_person_face → asset_face,
      // and matches every space-asset that has the spacePersonId on it — *not* restricted
      // to any single space, because the join itself doesn't carry a spaceId predicate
      // here. spaceOwner owns spaceAssetId, which has the face, so the result is 1.
      //
      // Note: this means a future test that puts the same spacePersonId on a second
      // space's asset would observe a count > 1. The current fixture only has one space.
      const { status, body } = await request(app)
        .get(`/timeline/buckets?spacePersonId=${spacePerson.spacePersonId}`)
        .set(asBearerAuth(ctx.spaceOwner.token!));
      expect(status).toBe(200);
      expect(total(body)).toBe(1);
    });

    it('tagIds with spaceId returns space-scoped assets having that tag', async () => {
      // We tagged only spaceAssetId, so the tag-filtered space query returns 1.
      const { status, body } = await request(app)
        .get(`/timeline/buckets?spaceId=${ctx.spaceId}&tagIds=${spaceTagId}`)
        .set(asBearerAuth(ctx.spaceOwner.token!));
      expect(status).toBe(200);
      expect(total(body)).toBe(1);
    });

    it("non-owner space member can filter space content by another user's tag", async () => {
      // The actual invariant being pinned: the timeline tag filter (`hasTags` at
      // server/src/utils/database.ts:228-241) joins through tag_asset → tag_closure with
      // **no `tag.userId` predicate at all**. Tag IDs are universally addressable on
      // the timeline filter — there's no per-user ownership check. spaceEditor passing
      // spaceOwner's tag ID alongside spaceId returns the tagged space asset.
      //
      // The shared-spaces UX consequence: one member labels a photo, all members can
      // filter by that label. Documented here as the load-bearing invariant — a future
      // refactor that adds an owner check to hasTags would break this UX silently
      // unless this test catches it.
      const { status, body } = await request(app)
        .get(`/timeline/buckets?spaceId=${ctx.spaceId}&tagIds=${spaceTagId}`)
        .set(asBearerAuth(ctx.spaceEditor.token!));
      expect(status).toBe(200);
      expect(total(body)).toBe(1);
    });
  });
});
