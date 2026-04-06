import { LoginResponseDto, SharedSpaceRole } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { utils } from 'src/utils';
import type { Response } from 'supertest';

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
  | 'admin';

export type Actor = {
  id: ActorId;
  /** Bearer token; undefined for `anon`. */
  token?: string;
  /** Owning user ID; undefined for `anon`. */
  userId?: string;
};

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
};

/**
 * Build a complete space context: admin + space-owner + editor + viewer + non-member,
 * a shared space owned by spaceOwner, and three uploaded assets (one for each member
 * with assets, plus one explicitly added to the space).
 *
 * Call once in `beforeAll` per spec file. Treat the returned fixtures as read-only;
 * mutating tests must restore state in try/finally (see T02 fixture lifetime contract).
 */
export const buildSpaceContext = async (): Promise<SpaceContext> => {
  const adminLogin = await utils.adminSetup();

  const [ownerLogin, editorLogin, viewerLogin, nonMemberLogin] = await Promise.all([
    utils.userSetup(adminLogin.accessToken, createUserDto.create('owner')),
    utils.userSetup(adminLogin.accessToken, createUserDto.create('editor')),
    utils.userSetup(adminLogin.accessToken, createUserDto.create('viewer')),
    utils.userSetup(adminLogin.accessToken, createUserDto.create('nonmember')),
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

  const [ownerAsset, spaceAsset, editorAsset] = await Promise.all([
    utils.createAsset(ownerLogin.accessToken),
    utils.createAsset(ownerLogin.accessToken),
    utils.createAsset(editorLogin.accessToken),
  ]);

  await utils.addSpaceAssets(ownerLogin.accessToken, space.id, [spaceAsset.id]);

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
  };
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
      throw new Error(
        `actor=${actor.id} expected status ${exp}, got ${res.status}. Body: ${JSON.stringify(res.body)}`,
      );
    }
  }
};
