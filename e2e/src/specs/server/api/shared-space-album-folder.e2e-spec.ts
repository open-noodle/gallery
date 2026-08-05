import { LoginResponseDto, SharedSpaceResponseDto, SharedSpaceRole } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Space album folder endpoints role matrix.
//
// GET    /shared-spaces/:id/album-folders            — list       (SharedSpaceRead)
// POST   /shared-spaces/:id/album-folders            — create     (SharedSpaceAlbumFolderCreate)
// PATCH  /shared-spaces/:id/album-folders/:folderId  — rename/move(SharedSpaceAlbumFolderUpdate)
// DELETE /shared-spaces/:id/album-folders/:folderId  — delete     (SharedSpaceAlbumFolderDelete)
// PUT    /shared-spaces/:id/albums/:albumId/folder   — place album(SharedSpaceAlbumUpdate)
//
// The `Permission.SharedSpaceAlbumFolder*` decorators on these routes only gate API-key callers
// (AuthService.authenticate only checks `authDto.apiKey.permissions`); for a normal session/bearer
// token, the space-role check happens inside SharedSpaceService via requireRole(), which is the
// FIRST line of every one of these service methods. That still runs before any dto content is
// used, so an unauthorised actor gets 403 before the service ever inspects the payload — but the
// body is already Zod-validated by then (NestJS runs the global ZodValidationPipe as part of
// resolving the controller method's arguments, which happens after guards but before the handler
// body/service call). A body that is invalid **for the endpoint's schema** (missing required
// fields, wrong types) would 400 before reaching the service. R-09 below uses a payload that is
// schema-valid (a well-formed empty-root move name is not sent; instead an out-of-band field is
// used) so the service's own role gate is what's actually being pinned.
//
// Validation failures that the SERVICE raises (bad name, depth-cap, missing/cross-space folder)
// are always 400 — this service never throws ConflictException; that is reserved for a different
// fork feature (merge-policy's structured cross-owner conflict).

describe('/shared-spaces/:id/album-folders', () => {
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let viewer: LoginResponseDto;
  let stranger: LoginResponseDto;
  let space: SharedSpaceResponseDto;
  let otherSpace: SharedSpaceResponseDto;
  let folderId: string;
  // Set by R-08's arrange step — a real folder id that genuinely belongs to otherSpace, reused by
  // the cross-space-400 test below so it exercises "a folder that exists, just in the wrong
  // space" rather than a folder id that doesn't exist anywhere.
  let otherSpaceFolderId: string;

  beforeAll(async () => {
    await utils.resetDatabase();
    const admin = await utils.adminSetup();
    [owner, editor, viewer, stranger] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.user1),
      utils.userSetup(admin.accessToken, createUserDto.user2),
      utils.userSetup(admin.accessToken, createUserDto.user3),
      utils.userSetup(admin.accessToken, createUserDto.user4),
    ]);

    space = await utils.createSpace(owner.accessToken, { name: 'Folders' });
    otherSpace = await utils.createSpace(stranger.accessToken, { name: 'Elsewhere' });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: editor.userId, role: SharedSpaceRole.Editor });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: viewer.userId, role: SharedSpaceRole.Viewer });

    const { body } = await request(app)
      .post(`/shared-spaces/${space.id}/album-folders`)
      .set(asBearerAuth(owner.accessToken))
      .send({ name: 'Trips' });
    folderId = body.id;
  });

  // R-01 / R-02
  it.each([
    ['R-01', 'owner'],
    ['R-02', 'editor'],
  ])('%s: a space %s may create, rename, and delete a folder', async (_id, role) => {
    const token = role === 'owner' ? owner.accessToken : editor.accessToken;

    const created = await request(app)
      .post(`/shared-spaces/${space.id}/album-folders`)
      .set(asBearerAuth(token))
      .send({ name: `Scratch-${role}` });
    expect(created.status).toBe(201);

    const renamed = await request(app)
      .patch(`/shared-spaces/${space.id}/album-folders/${created.body.id}`)
      .set(asBearerAuth(token))
      .send({ name: `Scratch-${role}-renamed` });
    expect(renamed.status).toBe(204);

    const removed = await request(app)
      .delete(`/shared-spaces/${space.id}/album-folders/${created.body.id}`)
      .set(asBearerAuth(token));
    expect(removed.status).toBe(204);
  });

  // R-03 / R-04: every write is refused for a viewer and for a non-member alike.
  it.each([
    ['R-03', 'viewer'],
    ['R-04', 'non-member'],
  ])('%s: a %s is refused every folder write', async (_id, role) => {
    const token = role === 'viewer' ? viewer.accessToken : stranger.accessToken;

    const create = await request(app)
      .post(`/shared-spaces/${space.id}/album-folders`)
      .set(asBearerAuth(token))
      .send({ name: 'Nope' });
    expect(create.status).toBe(403);

    const patch = await request(app)
      .patch(`/shared-spaces/${space.id}/album-folders/${folderId}`)
      .set(asBearerAuth(token))
      .send({ name: 'Nope' });
    expect(patch.status).toBe(403);

    const del = await request(app)
      .delete(`/shared-spaces/${space.id}/album-folders/${folderId}`)
      .set(asBearerAuth(token));
    expect(del.status).toBe(403);
  });

  // R-05
  it('R-05: a viewer may list the folders', async () => {
    const { status, body } = await request(app)
      .get(`/shared-spaces/${space.id}/album-folders`)
      .set(asBearerAuth(viewer.accessToken));

    expect(status).toBe(200);
    expect(body.map((f: { id: string }) => f.id)).toContain(folderId);
  });

  // R-06: a folder name is itself information, so a non-member must be refused rather than
  // handed an empty list that confirms the space exists.
  it('R-06: a non-member gets 403, not an empty list', async () => {
    const { status, body } = await request(app)
      .get(`/shared-spaces/${space.id}/album-folders`)
      .set(asBearerAuth(stranger.accessToken));

    expect(status).toBe(403);
    expect(body).not.toEqual([]);
  });

  // R-08: the listing is space-scoped — the read-side counterpart to the cross-space write guard.
  it('R-08: the listing contains this space and no other', async () => {
    // Arrange: this create must actually succeed, or the "Secret" absence assertion below would
    // pass vacuously (e.g. a bad token or a future schema change silently failing this POST would
    // make "not.toContain('Secret')" true for the wrong reason, masking the exact cross-space
    // leak this test exists to catch).
    const created = await request(app)
      .post(`/shared-spaces/${otherSpace.id}/album-folders`)
      .set(asBearerAuth(stranger.accessToken))
      .send({ name: 'Secret' });
    expect(created.status).toBe(201);
    otherSpaceFolderId = created.body.id;

    const { body } = await request(app)
      .get(`/shared-spaces/${space.id}/album-folders`)
      .set(asBearerAuth(owner.accessToken));

    expect(body.every((f: { spaceId: string }) => f.spaceId === space.id)).toBe(true);
    expect(body.map((f: { name: string }) => f.name)).not.toContain('Secret');
  });

  // R-09: the role gate runs BEFORE the service inspects the payload, so an unauthorised actor
  // learns nothing about whether their content would otherwise have been accepted. The DTO's
  // `name` is schema-valid here (min length 1) — a schema-invalid payload would be rejected by
  // the global ZodValidationPipe before the request reaches the service at all, which would
  // produce a 400 regardless of role and wouldn't isolate the role gate.
  //
  // Accidental but load-bearing: 'Trips' duplicates the folder name created in beforeAll, so this
  // payload would ALSO fail the service's own name-collision check if that check ever ran. Because
  // this suite executes in declaration order (vitest.config.ts pins maxWorkers: 1 / isolate:
  // false, and nothing here shuffles), that duplicate is guaranteed to exist by the time this test
  // runs. That means this test doesn't just prove "a Viewer is denied" — it also catches a
  // regression where a content check (the name-collision check specifically) got reordered ahead
  // of requireRole(): if that happened, this exact request would flip 403 -> 400, whereas R-03's
  // non-colliding 'Nope' payload would not detect it. Do not "tidy" this name to something unique
  // — that would silently remove this property.
  it('R-09: a viewer sending an otherwise-valid create still gets 403 (role gate, not a content check)', async () => {
    const { status } = await request(app)
      .post(`/shared-spaces/${space.id}/album-folders`)
      .set(asBearerAuth(viewer.accessToken))
      .send({ name: 'Trips', parentId: null });

    expect(status).toBe(403);
  });

  // R-07: space Editor alone is enough — album ownership is deliberately not required.
  it('R-07: an editor may place an album owned by someone else', async () => {
    const album = await utils.createAlbum(owner.accessToken, { albumName: 'Owner Album' });
    await utils.linkSpaceAlbum(owner.accessToken, space.id, album.id);

    const { status } = await request(app)
      .put(`/shared-spaces/${space.id}/albums/${album.id}/folder`)
      .set(asBearerAuth(editor.accessToken))
      .send({ folderId });

    expect(status).toBe(204);
  });

  it('rejects a cross-space folder placement with 400', async () => {
    const album = await utils.createAlbum(owner.accessToken, { albumName: 'Cross Space' });
    await utils.linkSpaceAlbum(owner.accessToken, space.id, album.id);

    // Uses otherSpaceFolderId — a folder that genuinely exists, just in otherSpace rather than
    // this space — instead of a globally-nonexistent UUID. getAlbumFolderById is scoped
    // `WHERE spaceId = ? AND id = ?`, so a real id from the wrong space and an id that doesn't
    // exist anywhere are provably indistinguishable to the code: both miss that lookup and 400
    // identically. Using the real cross-space id just makes this test's behaviour match its name.
    const { status } = await request(app)
      .put(`/shared-spaces/${space.id}/albums/${album.id}/folder`)
      .set(asBearerAuth(owner.accessToken))
      .send({ folderId: otherSpaceFolderId });

    expect(status).toBe(400);
  });
});
