import { type LoginResponseDto } from '@immich/sdk';
import { type Actor, authHeaders } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// T35 — coverage for two uncovered person endpoints:
//
//   GET /search/person          (search.controller.ts:105, searchPerson)
//   PUT /people/:id/reassign    (person.controller.ts:159, reassignFaces — bulk)
//
// Service shape:
//   - searchPerson (search.service.ts:35-38) → personRepository.getByName which
//     scopes by `person.ownerId = auth.user.id` (global only — there's no
//     space-scoped variant on this endpoint).
//   - reassignFaces (person.service.ts:82-): requireAccess(PersonUpdate) on the
//     destination person, then per-item requireAccess(PersonCreate) on each
//     source face. The asset_face row's personId column is updated.

describe('person search + reassign', () => {
  let admin: LoginResponseDto;
  let userA: LoginResponseDto;
  let userB: LoginResponseDto;
  let alicePersonId: string;
  let bobPersonId: string;
  let userBobPersonId: string;
  let userAAssetId: string;
  let aliceFaceId: string;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    [userA, userB] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('t35-userA')),
      utils.userSetup(admin.accessToken, createUserDto.create('t35-userB')),
    ]);

    // Asset owned by userA so the face fixture has somewhere to live.
    const userAAsset = await utils.createAsset(userA.accessToken);
    userAAssetId = userAAsset.id;

    // Two persons owned by userA — alice and bob — so reassignFaces has a
    // src/dest pair to swap between.
    const alicePerson = await utils.createPerson(userA.accessToken, { name: 'Alice T35' });
    alicePersonId = alicePerson.id;
    const bobPerson = await utils.createPerson(userA.accessToken, { name: 'Bob T35' });
    bobPersonId = bobPerson.id;

    // userB also has a "Bob" person to validate cross-user isolation in the
    // searchPerson tests.
    const userBob = await utils.createPerson(userB.accessToken, { name: 'Bob T35' });
    userBobPersonId = userBob.id;

    // Seed a face row for userA's asset assigned to Alice. createFace inserts
    // directly into asset_face.
    aliceFaceId = await utils.createFace({ assetId: userAAssetId, personId: alicePersonId });
    expect(aliceFaceId).toBeDefined();
  });

  describe('GET /search/person', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).get('/search/person?name=Alice').set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it('rejects an empty name with 400 (IsNotEmpty)', async () => {
      const { status } = await request(app).get('/search/person?name=').set(asBearerAuth(userA.accessToken));
      expect(status).toBe(400);
    });

    it('owner can find their own person by name', async () => {
      const { status, body } = await request(app).get('/search/person?name=Alice').set(asBearerAuth(userA.accessToken));
      expect(status).toBe(200);
      const ids = (body as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toContain(alicePersonId);
    });

    it('cross-user isolation: userB does NOT see userA\'s "Bob T35" via name search', async () => {
      // userA has a "Bob T35" (id=bobPersonId). userB has their own "Bob T35"
      // (id=userBobPersonId). When userB searches for "Bob", they should only
      // see their own — the personRepository scopes by ownerId.
      const { status, body } = await request(app).get('/search/person?name=Bob').set(asBearerAuth(userB.accessToken));
      expect(status).toBe(200);
      const ids = (body as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toContain(userBobPersonId);
      expect(ids).not.toContain(bobPersonId);
    });

    it('hidden person is excluded by default and included with withHidden=true', async () => {
      // Combined into one test so the hidden id is in scope for both halves —
      // the previous structure put `hidden` inside the first `it` and the
      // second test had to fall back to a vacuous `length > 0` check (which
      // passed via fuzzy trigram matching against unrelated "Alice" persons).
      // Now both halves assert against the SAME id, making the inclusion
      // check load-bearing.
      const hidden = await utils.createPerson(userA.accessToken, { name: 'HiddenAlice', isHidden: true });

      const defaultRes = await request(app).get('/search/person?name=HiddenAlice').set(asBearerAuth(userA.accessToken));
      const defaultIds = (defaultRes.body as Array<{ id: string }>).map((p) => p.id);
      expect(defaultIds).not.toContain(hidden.id);

      const withHiddenRes = await request(app)
        .get('/search/person?name=HiddenAlice&withHidden=true')
        .set(asBearerAuth(userA.accessToken));
      const withHiddenIds = (withHiddenRes.body as Array<{ id: string }>).map((p) => p.id);
      expect(withHiddenIds).toContain(hidden.id);
    });
  });

  describe('PUT /people/:id/reassign', () => {
    it('requires authentication', async () => {
      const { status } = await request(app)
        .put(`/people/${bobPersonId}/reassign`)
        .set(authHeaders(anonActor))
        .send({ data: [{ personId: alicePersonId, assetId: userAAssetId }] });
      expect(status).toBe(401);
    });

    it('non-existent destination person returns 400 (requireAccess)', async () => {
      const { status } = await request(app)
        .put('/people/00000000-0000-4000-a000-000000000099/reassign')
        .set(asBearerAuth(userA.accessToken))
        .send({ data: [{ personId: alicePersonId, assetId: userAAssetId }] });
      expect(status).toBe(400);
    });

    it('cross-user reassign returns 400 (access check on destination)', async () => {
      // userB tries to reassign userA's Alice face to userA's Bob — userB
      // doesn't have PersonUpdate access on Bob, so requireAccess fires.
      const { status } = await request(app)
        .put(`/people/${bobPersonId}/reassign`)
        .set(asBearerAuth(userB.accessToken))
        .send({ data: [{ personId: alicePersonId, assetId: userAAssetId }] });
      expect(status).toBe(400);
    });

    it('owner can reassign a face from Alice to Bob', async () => {
      // Pre-condition: alice currently owns the face on userAAssetId.
      // Reassign that face (via the alice→bob source person) to bob.
      const { status, body } = await request(app)
        .put(`/people/${bobPersonId}/reassign`)
        .set(asBearerAuth(userA.accessToken))
        .send({ data: [{ personId: alicePersonId, assetId: userAAssetId }] });
      expect(status).toBe(200);
      // Response is the array of UPDATED persons (containing at minimum bob).
      expect(Array.isArray(body)).toBe(true);
      const ids = (body as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toContain(bobPersonId);
    });
  });
});
