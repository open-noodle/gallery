import { type Actor, type SpaceContext, buildSpaceContext, forEachActor } from 'src/actors';
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

describe('/timeline', () => {
  let ctx: SpaceContext;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    utils.initSdk();
    ctx = await buildSpaceContext();
  });

  describe('GET /timeline/buckets', () => {
    it('requires authentication', async () => {
      await forEachActor(
        [anonActor, ctx.spaceOwner],
        (actor) =>
          request(app)
            .get('/timeline/buckets')
            .set(actor.token ? asBearerAuth(actor.token) : {}),
        { anon: 401, spaceOwner: 200 },
      );
    });

    it('owner sees their own assets when no filter is applied', async () => {
      const { status, body } = await request(app)
        .get('/timeline/buckets')
        .set(asBearerAuth(ctx.spaceOwner.token!));

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
        (actor) =>
          request(app)
            .get(`/timeline/buckets?spaceId=${ctx.spaceId}`)
            .set(actor.token ? asBearerAuth(actor.token) : {}),
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
        (actor) =>
          request(app)
            .get(`/timeline/bucket?timeBucket=${currentMonthBucket}`)
            .set(actor.token ? asBearerAuth(actor.token) : {}),
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
            .set(actor.token ? asBearerAuth(actor.token) : {}),
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
});
