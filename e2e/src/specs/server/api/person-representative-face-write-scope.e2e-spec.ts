/**
 * Slice 3 — M2: `PUT /people/:id/representative-face` (`updateRepresentativeFace`) is reachable by
 * anyone with `PersonRead` — which, per `PersonAccess.checkSharedSpaceAccess`, admits ANY shared-space
 * role (Owner, Editor, and Viewer). Before this fix, that meant a space Viewer could mutate the
 * owner's GLOBAL representative face (the People-page cover) for everyone, not just their own view.
 *
 * The fix requires the caller be the person's owner OR an Editor/Owner of a space the person is
 * shared through (checked via `PersonAccess.checkSharedSpaceEditAccess`); a Viewer is denied with a
 * 403. Owner ∪ Editor — never Viewer-only.
 *
 * `personId` here (owned by `spaceOwner`) has two faces on the space-shared asset
 * (`ctx.spaceAssetId`): the first becomes the representative face automatically (Person.faceAssetId
 * is set on first `createFace`), the second is the target the disputed actor tries to switch to — so
 * the "left unchanged" assertion is meaningful (a no-op same-value write would pass trivially).
 *
 * `PersonResponseDto` does not expose `faceAssetId` in the JSON body (only `thumbnailPath`, populated
 * asynchronously by the PersonGenerateThumbnail job), so change/no-change is asserted directly via
 * `utils.getPersonFaceAssetId` (reads the column over SQL) rather than the PUT/GET response body.
 */

import { type SpaceContext, buildSpaceContext } from 'src/actors';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

describe('PUT /people/:id/representative-face — write scope (Slice 3 / M2)', () => {
  let ctx: SpaceContext;

  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext();
  });

  const createPersonWithTwoSpaceFaces = async () => {
    const person = await utils.createPerson(ctx.spaceOwner.token!, { name: 'M2 RepFace Person' });
    // The first face becomes the representative face automatically (person.faceAssetId is null at
    // creation, and createFace COALESCEs it in).
    const originalFaceId = await utils.createFace({ assetId: ctx.spaceAssetId, personId: person.id });
    // The second face is the target the disputed actor tries to switch the cover to.
    const targetFaceId = await utils.createFace({ assetId: ctx.spaceAssetId, personId: person.id });
    return { personId: person.id, originalFaceId, targetFaceId };
  };

  it('a space Viewer is denied (403) and the person is left unchanged', async () => {
    const { personId, originalFaceId, targetFaceId } = await createPersonWithTwoSpaceFaces();

    const { status } = await request(app)
      .put(`/people/${personId}/representative-face`)
      .set(asBearerAuth(ctx.spaceViewer.token!))
      .send({ assetFaceId: targetFaceId });

    expect(status).toBe(403);

    const faceAssetId = await utils.getPersonFaceAssetId(personId);
    expect(faceAssetId).toBe(originalFaceId);
    expect(faceAssetId).not.toBe(targetFaceId);
  });

  it('a space Editor is allowed (200) — positive control the gate admits editors', async () => {
    const { personId, targetFaceId } = await createPersonWithTwoSpaceFaces();

    const { status } = await request(app)
      .put(`/people/${personId}/representative-face`)
      .set(asBearerAuth(ctx.spaceEditor.token!))
      .send({ assetFaceId: targetFaceId });

    expect(status).toBe(200);
    expect(await utils.getPersonFaceAssetId(personId)).toBe(targetFaceId);
  });

  it('the owner is allowed (200) — unchanged', async () => {
    const { personId, targetFaceId } = await createPersonWithTwoSpaceFaces();

    const { status } = await request(app)
      .put(`/people/${personId}/representative-face`)
      .set(asBearerAuth(ctx.spaceOwner.token!))
      .send({ assetFaceId: targetFaceId });

    expect(status).toBe(200);
    expect(await utils.getPersonFaceAssetId(personId)).toBe(targetFaceId);
  });

  // A non-member has no PersonRead reachability at all, so this fails at the pre-existing
  // `requireAccess(PersonRead)` check (400) — never reaching the new M2 owner/editor gate (403).
  // Pinned here so the boundary between "no PersonRead" (400) and "PersonRead but not Editor/Owner"
  // (403, the M2 fix) stays visible.
  it('a space non-member is denied (400, no PersonRead reachability at all)', async () => {
    const { personId, originalFaceId, targetFaceId } = await createPersonWithTwoSpaceFaces();

    const { status } = await request(app)
      .put(`/people/${personId}/representative-face`)
      .set(asBearerAuth(ctx.spaceNonMember.token!))
      .send({ assetFaceId: targetFaceId });

    expect(status).toBe(400);
    expect(await utils.getPersonFaceAssetId(personId)).toBe(originalFaceId);
  });
});
