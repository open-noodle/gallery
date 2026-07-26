/**
 * RBAC matrix for PATCH /shared-spaces/:id.
 *
 * The endpoint splits its DTO into three field groups with two different role floors
 * (shared-space.service.ts, `update`):
 *
 *   naming     — name, description, color            → Editor
 *   cover      — thumbnailAssetId, thumbnailCropY    → Editor
 *   settings   — faceRecognitionEnabled, petsEnabled → Owner
 *
 * The role check runs against the WHOLE dto before any write, so a mixed payload is
 * rejected outright — never partially applied. That last property is the one most
 * likely to regress silently if the gate is ever refactored per-field, so it gets a
 * dedicated read-back assertion.
 */

import { authHeaders, buildSpaceContext, forEachActor, type SpaceContext } from 'src/actors';
import { app, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

describe('PATCH /shared-spaces/:id — rename and edit RBAC', () => {
  let ctx: SpaceContext;
  const anon = { id: 'anon' as const };

  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext();
  });

  describe('naming fields (name, description, color) — Editor floor', () => {
    it('owner and editor may rename; viewer, non-member and anon may not', async () => {
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, anon],
        (actor) =>
          request(app).patch(`/shared-spaces/${ctx.spaceId}`).set(authHeaders(actor)).send({ name: 'Renamed Space' }),
        { spaceOwner: 200, spaceEditor: 200, spaceViewer: 403, spaceNonMember: 403, anon: 401 },
      );
    });

    it('owner and editor may edit the description', async () => {
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, anon],
        (actor) =>
          request(app).patch(`/shared-spaces/${ctx.spaceId}`).set(authHeaders(actor)).send({ description: 'Edited' }),
        { spaceOwner: 200, spaceEditor: 200, spaceViewer: 403, spaceNonMember: 403, anon: 401 },
      );
    });

    it('owner and editor may edit the color', async () => {
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, anon],
        (actor) => request(app).patch(`/shared-spaces/${ctx.spaceId}`).set(authHeaders(actor)).send({ color: 'blue' }),
        { spaceOwner: 200, spaceEditor: 200, spaceViewer: 403, spaceNonMember: 403, anon: 401 },
      );
    });

    it('an editor rename actually persists', async () => {
      const { status, body } = await request(app)
        .patch(`/shared-spaces/${ctx.spaceId}`)
        .set(authHeaders(ctx.spaceEditor))
        .send({ name: 'Editor Renamed This' });

      expect(status).toBe(200);
      expect((body as { name: string }).name).toBe('Editor Renamed This');

      const readBack = await request(app).get(`/shared-spaces/${ctx.spaceId}`).set(authHeaders(ctx.spaceOwner));
      expect((readBack.body as { name: string }).name).toBe('Editor Renamed This');
    });

    it('an editor can clear the description with an empty string', async () => {
      await request(app)
        .patch(`/shared-spaces/${ctx.spaceId}`)
        .set(authHeaders(ctx.spaceEditor))
        .send({ description: 'Temporary' });

      const { status, body } = await request(app)
        .patch(`/shared-spaces/${ctx.spaceId}`)
        .set(authHeaders(ctx.spaceEditor))
        .send({ description: '' });

      expect(status).toBe(200);
      expect((body as { description: string | null }).description).toBe('');
    });
  });

  describe('cover fields (thumbnailAssetId) — Editor floor, unchanged', () => {
    it('owner and editor may set the cover; viewer, non-member and anon may not', async () => {
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, anon],
        (actor) =>
          request(app)
            .patch(`/shared-spaces/${ctx.spaceId}`)
            .set(authHeaders(actor))
            .send({ thumbnailAssetId: ctx.spaceAssetId }),
        { spaceOwner: 200, spaceEditor: 200, spaceViewer: 403, spaceNonMember: 403, anon: 401 },
      );
    });
  });

  describe('settings fields (faceRecognitionEnabled, petsEnabled) — Owner floor', () => {
    it('only the owner may toggle faceRecognitionEnabled', async () => {
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, anon],
        (actor) =>
          request(app)
            .patch(`/shared-spaces/${ctx.spaceId}`)
            .set(authHeaders(actor))
            .send({ faceRecognitionEnabled: true }),
        { spaceOwner: 200, spaceEditor: 403, spaceViewer: 403, spaceNonMember: 403, anon: 401 },
      );
    });

    it('only the owner may toggle petsEnabled', async () => {
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, anon],
        (actor) =>
          request(app).patch(`/shared-spaces/${ctx.spaceId}`).set(authHeaders(actor)).send({ petsEnabled: true }),
        { spaceOwner: 200, spaceEditor: 403, spaceViewer: 403, spaceNonMember: 403, anon: 401 },
      );
    });
  });

  describe('mixed payloads', () => {
    it('rejects an editor mixing a permitted name with a forbidden setting, and writes neither', async () => {
      const before = await request(app).get(`/shared-spaces/${ctx.spaceId}`).set(authHeaders(ctx.spaceOwner));
      const nameBefore = (before.body as { name: string }).name;

      const { status } = await request(app)
        .patch(`/shared-spaces/${ctx.spaceId}`)
        .set(authHeaders(ctx.spaceEditor))
        .send({ name: 'Should Not Persist', petsEnabled: true });

      expect(status).toBe(403);

      const after = await request(app).get(`/shared-spaces/${ctx.spaceId}`).set(authHeaders(ctx.spaceOwner));
      expect((after.body as { name: string }).name).toBe(nameBefore);
    });
  });

  describe('validation', () => {
    it('rejects a whitespace-only name with 400', async () => {
      const { status } = await request(app)
        .patch(`/shared-spaces/${ctx.spaceId}`)
        .set(authHeaders(ctx.spaceEditor))
        .send({ name: '   ' });

      expect(status).toBe(400);
    });

    it('rejects a name over 100 characters with 400', async () => {
      const { status } = await request(app)
        .patch(`/shared-spaces/${ctx.spaceId}`)
        .set(authHeaders(ctx.spaceEditor))
        .send({ name: 'a'.repeat(101) });

      expect(status).toBe(400);
    });
  });
});
