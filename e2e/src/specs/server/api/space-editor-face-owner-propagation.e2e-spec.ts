/**
 * Spec §6.3.1 (REVISED 2026-08-25): a space editor's face edits propagate into the ASSET OWNER's
 * own layer -- `asset_face.personId` and the face identity -- instead of stopping at the
 * `shared_space_person_face` projection.
 *
 * Why this spec exists as its own file rather than another case in the Slice 9 journey: the
 * behaviour it pins is specifically what the OWNER sees, and the owner's view is a different read
 * path from every assertion in that journey (which reads space surfaces as the editor). The bug
 * that motivated the revision was invisible to space-side assertions -- the editor's own face
 * editor showed "Unassigned" correctly while the asset-detail People row kept rendering the person
 * she had just removed, and no reload converged, because `findSpacePersonsByLinkedPersonIds` is not
 * scoped to the asset and kept resolving a person still attached elsewhere in the space.
 *
 * So each case below asserts BOTH halves:
 *   - `asset_face.personId` via SQL -- which column actually moved;
 *   - `GET /assets/:id` as BOB, the owner, with no space context -- the user-visible result, read
 *     through the path that was broken. Asserting only the first would pass even if the owner's
 *     view never changed, which is precisely the failure this revision was about.
 *
 * Faces are seeded unassigned via `utils.createUnassignedFace` for the same reason the Slice 9
 * journey does it: no HTTP path leaves a face unassigned, and ML detection does not run in this
 * stack.
 *
 * Every space person here is created WITH its seed face (`assetFaceId`), which is both the real UI
 * flow ("add a name" on a face, `CreateSpaceFaceModal`) and deliberate test hygiene: a space person
 * created with no faces is briefly empty, and the background identity/metadata backfills race that
 * window -- an earlier draft of this spec that created the person first and attached second failed
 * roughly one run in three with "Person not found". Do not split them back apart.
 */
import { attachSpacePersonFace, createSpacePerson, detachSpacePersonFace, getAssetInfo } from '@immich/sdk';
import { authHeaders, buildSpaceContext, type SpaceContext } from 'src/actors';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

describe('Space editor face edits propagate to the asset owner (spec §6.3.1 revised)', () => {
  let ctx: SpaceContext;

  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext();
  });

  /** Bob's own view of his own asset, with no space context — the People row's source of truth. */
  const ownerPeopleNames = async (): Promise<string[]> => {
    const asset = await getAssetInfo({ id: ctx.spaceAssetId }, { headers: asBearerAuth(ctx.spaceOwner.token!) });
    return (asset.people ?? []).map((person) => person.name);
  };

  /** Anna names a freshly seeded unassigned face, in one create-and-attach call. */
  const editorNamesNewFace = async (name: string) => {
    const assetFaceId = await utils.createUnassignedFace(ctx.spaceAssetId);
    const person = await createSpacePerson(
      { id: ctx.spaceId, sharedSpacePersonCreateDto: { name, assetFaceId } },
      { headers: asBearerAuth(ctx.spaceEditor.token!) },
    );
    return { assetFaceId, personId: person.id };
  };

  it("writes the owner's personId when an editor names an unrecognised face", async () => {
    const { assetFaceId } = await editorNamesNewFace('Propagated Ada');

    // Bob had never named this human, so the propagation had to CREATE a person in his library.
    const owned = await utils.getFaceOwnerPerson(assetFaceId);
    expect(owned.personId).not.toBeNull();
    expect(owned.name).toBe('Propagated Ada');

    // The half that was broken: Bob's own asset detail now lists her.
    expect(await ownerPeopleNames()).toContain('Propagated Ada');
  });

  it("clears the owner's personId when the editor detaches that same face", async () => {
    const { assetFaceId, personId } = await editorNamesNewFace('Detachable Bea');
    expect((await utils.getFaceOwnerPerson(assetFaceId)).name).toBe('Detachable Bea');
    expect(await ownerPeopleNames()).toContain('Detachable Bea');

    await detachSpacePersonFace(
      { id: ctx.spaceId, personId, assetFaceId },
      { headers: asBearerAuth(ctx.spaceEditor.token!) },
    );

    expect((await utils.getFaceOwnerPerson(assetFaceId)).personId).toBeNull();
    // The originating bug: this used to still contain her, and reloading never helped.
    expect(await ownerPeopleNames()).not.toContain('Detachable Bea');
  });

  /**
   * The guard that separates "propagate the editor's edit" from "let an editor wipe arbitrary
   * owner tags". Detaching space person X must only clear the owner's tag when the owner's person
   * is the SAME human; a face the owner named as someone else is left alone.
   *
   * Two faces are used so the surviving tag is observed while the editor actually detaches a
   * DIFFERENT space person -- a single-face version could pass merely because nothing ran.
   */
  it("leaves the owner's own unrelated tag alone when the editor detaches a different person", async () => {
    const ownTaggedFaceId = await utils.createUnassignedFace(ctx.spaceAssetId);

    // Bob names that face himself, through his own owner-only path. `PUT /faces/:id` takes the
    // PERSON in the path and the face in the body, not the reverse.
    const bobsPerson = await utils.createPerson(ctx.spaceOwner.token!, { name: "Bob's Own Dad" });
    await request(app)
      .put(`/faces/${bobsPerson.id}`)
      .set(authHeaders(ctx.spaceOwner))
      .send({ id: ownTaggedFaceId })
      .expect(200);
    expect((await utils.getFaceOwnerPerson(ownTaggedFaceId)).name).toBe("Bob's Own Dad");

    // Anna attaches and then detaches a space person that has nothing to do with Bob's tagged face.
    const { assetFaceId: unrelatedFaceId, personId } = await editorNamesNewFace('Unrelated Uncle Tom');
    await detachSpacePersonFace(
      { id: ctx.spaceId, personId, assetFaceId: unrelatedFaceId },
      { headers: asBearerAuth(ctx.spaceEditor.token!) },
    );

    // Bob's unrelated tag survives untouched, on both layers.
    expect((await utils.getFaceOwnerPerson(ownTaggedFaceId)).name).toBe("Bob's Own Dad");
    expect(await ownerPeopleNames()).toContain("Bob's Own Dad");
  });

  /**
   * Re-attaching after a detach must restore the owner's tag, not leave the face permanently
   * unassigned. This is the round trip the reported bug made impossible to observe, and it also
   * covers the case where the owner person already exists (created by the first attach) so
   * `getOrCreateOwnerPersonForIdentity` takes its find branch rather than its insert branch.
   */
  it('restores the owner personId when the editor re-attaches a detached face', async () => {
    const { assetFaceId, personId } = await editorNamesNewFace('Round Trip Cara');
    const firstOwnerPersonId = (await utils.getFaceOwnerPerson(assetFaceId)).personId;
    expect(firstOwnerPersonId).not.toBeNull();

    await detachSpacePersonFace(
      { id: ctx.spaceId, personId, assetFaceId },
      { headers: asBearerAuth(ctx.spaceEditor.token!) },
    );
    expect((await utils.getFaceOwnerPerson(assetFaceId)).personId).toBeNull();

    await attachSpacePersonFace(
      { id: ctx.spaceId, personId, assetFaceId },
      { headers: asBearerAuth(ctx.spaceEditor.token!) },
    );

    // Same owner person as the first attach -- a second one would mean a duplicate in Bob's library.
    expect((await utils.getFaceOwnerPerson(assetFaceId)).personId).toBe(firstOwnerPersonId);
    expect(await ownerPeopleNames()).toContain('Round Trip Cara');
  });
});
