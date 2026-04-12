import { SharedSpaceRole, type LoginResponseDto } from '@immich/sdk';
import { authHeaders, type Actor } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// T34 — coverage for `GET /search/suggestions/tags` (PR #230 introduced the
// `withSharedSpaces` flag and the spaceId scoping branch). Service shape at
// search.service.ts:209-229:
//   - spaceId + withSharedSpaces → 400 'Cannot use both'
//   - spaceId set → requireAccess(SharedSpaceRead) → 400 for non-members
//   - withSharedSpaces=true → expand userIds with timeline space IDs
//   - else → tags belonging to assets owned by the caller (default)
//
// Repository (search.repository.ts:580-630) joins tag → tag_asset → asset and
// filters by visibility=Timeline. The space branch UNIONs assets directly
// added to the space AND assets in libraries linked to the space.

describe('GET /search/suggestions/tags', () => {
  let admin: LoginResponseDto;
  let userA: LoginResponseDto;
  let userB: LoginResponseDto;
  let nonMember: LoginResponseDto;
  let userATagId: string;
  let userBTagId: string;
  let userAAssetId: string;
  let userBAssetId: string;
  let spaceId: string;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    [userA, userB, nonMember] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('t34-userA')),
      utils.userSetup(admin.accessToken, createUserDto.create('t34-userB')),
      utils.userSetup(admin.accessToken, createUserDto.create('t34-nonmember')),
    ]);

    // Each user creates their own asset and tags it with a per-user tag value.
    [userAAssetId, userBAssetId] = await Promise.all([
      utils.createAsset(userA.accessToken).then((a) => a.id),
      utils.createAsset(userB.accessToken).then((a) => a.id),
    ]);

    // Drain metadata extraction before associating tags. Otherwise a late
    // metadata extraction calls applyTagList → replaceAssetTags which DELETEs
    // all tag_asset rows for the asset and re-inserts from EXIF. The test's
    // PNGs have no EXIF tags, so tag associations set below get wiped. On
    // slower ARM runners this race is reliable. Same root cause as the
    // filter-suggestions flake fix.
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');

    // userA's tag → userA's asset
    const aTagRes = await request(app).post('/tags').set(asBearerAuth(userA.accessToken)).send({ name: 't34-tag-A' });
    userATagId = (aTagRes.body as { id: string }).id;
    await request(app)
      .put(`/tags/${userATagId}/assets`)
      .set(asBearerAuth(userA.accessToken))
      .send({ ids: [userAAssetId] });

    // userB's tag → userB's asset
    const bTagRes = await request(app).post('/tags').set(asBearerAuth(userB.accessToken)).send({ name: 't34-tag-B' });
    userBTagId = (bTagRes.body as { id: string }).id;
    await request(app)
      .put(`/tags/${userBTagId}/assets`)
      .set(asBearerAuth(userB.accessToken))
      .send({ ids: [userBAssetId] });

    // Create a shared space owned by userA. userB is added as a member.
    // Add userA's asset (which carries the t34-tag-A tag) to the space, so the
    // space-scoped query has cross-user content to surface.
    const space = await utils.createSpace(userA.accessToken, { name: 't34 space' });
    spaceId = space.id;
    await utils.addSpaceMember(userA.accessToken, spaceId, {
      userId: userB.userId,
      role: SharedSpaceRole.Editor,
    });
    await utils.addSpaceAssets(userA.accessToken, spaceId, [userAAssetId]);
  });

  it('requires authentication', async () => {
    const { status } = await request(app).get('/search/suggestions/tags').set(authHeaders(anonActor));
    expect(status).toBe(401);
  });

  it("default scope returns the caller's own tags only", async () => {
    const { status, body } = await request(app).get('/search/suggestions/tags').set(asBearerAuth(userA.accessToken));
    expect(status).toBe(200);
    const ids = (body as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain(userATagId);
    // Cross-user isolation: userA does NOT see userB's tag in the default scope.
    expect(ids).not.toContain(userBTagId);
  });

  it("userB does not see userA's tag in the default scope", async () => {
    // Symmetric isolation check.
    const { status, body } = await request(app).get('/search/suggestions/tags').set(asBearerAuth(userB.accessToken));
    expect(status).toBe(200);
    const ids = (body as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain(userBTagId);
    expect(ids).not.toContain(userATagId);
  });

  it("spaceId scope surfaces tags from another user's asset added to the space", async () => {
    // userB queries with spaceId of the shared space → sees userA's tag because
    // userA's asset is in the space.
    const { status, body } = await request(app)
      .get(`/search/suggestions/tags?spaceId=${spaceId}`)
      .set(asBearerAuth(userB.accessToken));
    expect(status).toBe(200);
    const ids = (body as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain(userATagId);
  });

  it('withSharedSpaces=true on a member surfaces tags from joined spaces', async () => {
    // userB queries WITHOUT spaceId but with withSharedSpaces=true → the query
    // expands to include assets from spaces userB is a member of, which
    // includes the t34 space and therefore userA's tag.
    const { status, body } = await request(app)
      .get('/search/suggestions/tags?withSharedSpaces=true')
      .set(asBearerAuth(userB.accessToken));
    expect(status).toBe(200);
    const ids = (body as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain(userATagId);
    // userB also still sees their OWN tags.
    expect(ids).toContain(userBTagId);
  });

  it('non-member of the space gets 400 (requireAccess) when using spaceId', async () => {
    // search.service.ts:215 — spaceId triggers requireAccess(SharedSpaceRead),
    // which returns 400 for non-members via the bulk-access pattern.
    const { status } = await request(app)
      .get(`/search/suggestions/tags?spaceId=${spaceId}`)
      .set(asBearerAuth(nonMember.accessToken));
    expect(status).toBe(400);
  });

  it('spaceId + withSharedSpaces both set returns 400 (mutually exclusive)', async () => {
    // search.service.ts:210-212 — 'Cannot use both spaceId and withSharedSpaces'.
    const { status, body } = await request(app)
      .get(`/search/suggestions/tags?spaceId=${spaceId}&withSharedSpaces=true`)
      .set(asBearerAuth(userB.accessToken));
    expect(status).toBe(400);
    expect((body as { message: string }).message).toBe('Cannot use both spaceId and withSharedSpaces');
  });
});
