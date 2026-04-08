import { LoginResponseDto, SharedSpaceRole } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import type { Response } from 'supertest';
import request from 'supertest';

// E2E test helpers for actor-matrix-style coverage. See
// docs/plans/2026-04-06-e2e-T02-helpers-design.md for the rationale.
//
// Composes existing helpers in src/utils.ts — does NOT make supertest calls
// directly, so when utils.ts evolves during a rebase, this file adapts and
// downstream specs (T03+) don't notice.

export type ActorId =
  | 'anon'
  | 'regularA'
  | 'regularB'
  | 'spaceOwner'
  | 'spaceEditor'
  | 'spaceViewer'
  | 'spaceNonMember'
  | 'partner'
  | 'admin';

export type Actor = {
  id: ActorId;
  /** Bearer token; undefined for `anon`. */
  token?: string;
  /** Owning user ID; undefined for `anon`. */
  userId?: string;
};

/**
 * Build the request `Authorization` header for an actor. Returns an empty object
 * for `anon` so call sites can do `request(app).get(...).set(authHeaders(actor))`
 * without conditionals.
 */
export const authHeaders = (actor: Actor): Record<string, string> =>
  actor.token ? { Authorization: `Bearer ${actor.token}` } : {};

export type SpaceContext = {
  admin: Actor;
  spaceOwner: Actor;
  spaceEditor: Actor;
  spaceViewer: Actor;
  spaceNonMember: Actor;
  spaceId: string;
  /** Asset owned by spaceOwner, NOT in the space. Use to test "own asset must not leak into space view". */
  ownerAssetId: string;
  /** Asset owned by spaceEditor, NOT in the space. */
  editorAssetId: string;
  /** Asset owned by spaceOwner AND added to the space via shared_space_asset. */
  spaceAssetId: string;
  /** Only present when buildSpaceContext was called with `{ withPartner: true }`. */
  partner?: Actor;
  /** Only present when buildSpaceContext was called with `{ withPartner: true }`. Owned by `partner`. */
  partnerAssetId?: string;
};

export type BuildSpaceContextOptions = {
  /**
   * If true, also creates a partner user who has shared their assets with `spaceOwner`,
   * uploads one asset, and exposes them as `partner` / `partnerAssetId` on the returned
   * SpaceContext. Costs one extra user setup + one createPartner call.
   */
  withPartner?: boolean;
};

/**
 * Build a complete space context: admin + space-owner + editor + viewer + non-member,
 * a shared space owned by spaceOwner, and three uploaded assets (one for each member
 * with assets, plus one explicitly added to the space).
 *
 * With `{ withPartner: true }`, also creates a `partner` user who has shared their
 * assets with `spaceOwner` and uploaded one asset.
 *
 * Call once in `beforeAll` per spec file. Treat the returned fixtures as read-only;
 * mutating tests must restore state in try/finally (see T02 fixture lifetime contract).
 */
export const buildSpaceContext = async (options: BuildSpaceContextOptions = {}): Promise<SpaceContext> => {
  const adminLogin = await utils.adminSetup();

  const [ownerLogin, editorLogin, viewerLogin, nonMemberLogin, partnerLogin] = await Promise.all([
    utils.userSetup(adminLogin.accessToken, createUserDto.create('owner')),
    utils.userSetup(adminLogin.accessToken, createUserDto.create('editor')),
    utils.userSetup(adminLogin.accessToken, createUserDto.create('viewer')),
    utils.userSetup(adminLogin.accessToken, createUserDto.create('nonmember')),
    options.withPartner ? utils.userSetup(adminLogin.accessToken, createUserDto.create('partner')) : Promise.resolve(),
  ]);

  const space = await utils.createSpace(ownerLogin.accessToken, { name: 'test space' });

  await utils.addSpaceMember(ownerLogin.accessToken, space.id, {
    userId: editorLogin.userId,
    role: SharedSpaceRole.Editor,
  });
  await utils.addSpaceMember(ownerLogin.accessToken, space.id, {
    userId: viewerLogin.userId,
    role: SharedSpaceRole.Viewer,
  });

  const [ownerAsset, spaceAsset, editorAsset, partnerAsset] = await Promise.all([
    utils.createAsset(ownerLogin.accessToken),
    utils.createAsset(ownerLogin.accessToken),
    utils.createAsset(editorLogin.accessToken),
    partnerLogin ? utils.createAsset(partnerLogin.accessToken) : Promise.resolve(),
  ]);

  await utils.addSpaceAssets(ownerLogin.accessToken, space.id, [spaceAsset.id]);

  if (partnerLogin) {
    // partner shares their library with spaceOwner; spaceOwner is the recipient.
    // The recipient (spaceOwner) enables inTimeline so withPartners=true picks them up.
    await addPartner(
      { token: partnerLogin.accessToken, userId: partnerLogin.userId },
      { token: ownerLogin.accessToken, userId: ownerLogin.userId },
    );
  }

  return {
    admin: actorFrom('admin', adminLogin),
    spaceOwner: actorFrom('spaceOwner', ownerLogin),
    spaceEditor: actorFrom('spaceEditor', editorLogin),
    spaceViewer: actorFrom('spaceViewer', viewerLogin),
    spaceNonMember: actorFrom('spaceNonMember', nonMemberLogin),
    spaceId: space.id,
    ownerAssetId: ownerAsset.id,
    editorAssetId: editorAsset.id,
    spaceAssetId: spaceAsset.id,
    partner: partnerLogin ? actorFrom('partner', partnerLogin) : undefined,
    partnerAssetId: partnerAsset?.id,
  };
};

/**
 * Set up a partner relationship: `from` shares their assets WITH `to`. The recipient
 * can then see the sharer's assets via `?withPartners=true`.
 *
 * The default `partner.inTimeline` column is `false` (verified in
 * `server/src/schema/tables/partner.table.ts:46`), so a fresh `createPartner` call
 * is invisible to `getMyPartnerIds({ timelineEnabled: true })` which is what
 * timeline.service.ts uses. To make tests intuitive, this helper auto-enables
 * `inTimeline` after creation by having the recipient call PUT /partners/:id.
 *
 * Pinned in the backlog as an "Observed invariant" — easy to forget, painful to
 * debug because the empty timeline silently looks correct.
 */
export const addPartner = async (
  from: { token: string; userId: string },
  to: { token: string; userId: string },
): Promise<void> => {
  await utils.createPartner(from.token, to.userId);
  // recipient enables the partnership in their own timeline
  const enable = await request(app)
    .put(`/partners/${from.userId}`)
    .set(asBearerAuth(to.token))
    .send({ inTimeline: true });
  if (enable.status !== 200) {
    throw new Error(`addPartner: failed to enable inTimeline (${enable.status}): ${JSON.stringify(enable.body)}`);
  }
};

const actorFrom = (id: ActorId, login: LoginResponseDto): Actor => ({
  id,
  token: login.accessToken,
  userId: login.userId,
});

type ExpectedMap = Partial<Record<ActorId, number>>;

/**
 * Run an HTTP call once per actor and assert each got the expected status code.
 *
 * The `run` callback receives an actor and returns a supertest `Response`. Call
 * sites just `return request(app).get(...).set(...)` — no need to map into a
 * `{status, body}` shape.
 *
 * Throws an `Error` (not `expect`) so the failure message can name the actor.
 * `expect(status).toBe(exp)` doesn't surface which actor failed, which makes
 * debugging the matrix painful.
 *
 * Sequential, not parallel: tests share a database; parallel actor runs would
 * race on the same fixtures. The matrix is small (≤6 in practice).
 */
export const forEachActor = async (
  actors: Actor[],
  run: (actor: Actor) => Promise<Response>,
  expected: ExpectedMap,
): Promise<void> => {
  for (const actor of actors) {
    const exp = expected[actor.id];
    if (exp === undefined) {
      throw new Error(`forEachActor: no expected status for actor ${actor.id}`);
    }
    const res = await run(actor);
    if (res.status !== exp) {
      throw new Error(`actor=${actor.id} expected status ${exp}, got ${res.status}. Body: ${JSON.stringify(res.body)}`);
    }
  }
};
