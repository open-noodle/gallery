import { LoginResponseDto } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, utils } from 'src/utils';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

// Regression coverage for the #733 follow-up: a scoped merge whose two identities BOTH already have a
// profile in the same space.
//
// Same fixture as people-cross-owner-merge.e2e-spec.ts, with ONE extra row: the actor's own person
// (identity T) also has a shared_space_person profile in the same space. That is not exotic — a space grows
// a person profile for every identity whose faces are on its assets, so it is what you get as soon as your
// own photos of that person are in the space (guaranteed when both users' external libraries are connected
// to it, which is the setup issue #733 describes).
//
// The scoped merge used to refuse this outright ("Cannot merge people that already have separate profiles in
// the same scope") because the raw merge engine cannot collapse two profiles that would land in the same
// scope. It now runs through the propagation planner, which collapses them.

const RESET_TABLES = [
  'face_identity_face',
  'face_identity',
  'shared_space',
  'person',
  'album',
  'asset',
  'asset_face',
  'activity',
  'api_key',
  'session',
  'user',
  'system_metadata',
  'tag',
  'user_group',
];

interface Fixture {
  admin: LoginResponseDto;
  actor: LoginResponseDto;
  otherOwner: LoginResponseDto;
  spaceId: string;
  targetPersonId: string;
  /** space-person on identity T — the actor's own person, as it appears inside the space. */
  targetSpacePersonId: string;
  /** space-person on identity S — the other owner's person, as it appears inside the space. */
  sourceSpacePersonId: string;
  otherOwnerPersonId: string;
  identityT: string;
  identityS: string;
}

const setup = async (): Promise<Fixture> => {
  const db = await utils.connectDatabase();
  const admin = await utils.adminSetup();
  const [actor, otherOwner] = await Promise.all([
    utils.userSetup(admin.accessToken, createUserDto.create('same-space-actor')),
    utils.userSetup(admin.accessToken, createUserDto.create('same-space-other')),
  ]);

  const space = await utils.createSpace(actor.accessToken, { name: 'Same Space Conflict' });

  const [targetPerson, otherOwnerPerson] = await Promise.all([
    utils.createPerson(actor.accessToken, { name: 'Ada Target' }),
    utils.createPerson(otherOwner.accessToken, { name: 'Ada Other Owner' }),
  ]);

  const [actorAsset, otherAsset] = await Promise.all([
    utils.createAsset(actor.accessToken),
    utils.createAsset(otherOwner.accessToken),
  ]);

  const [actorFace, otherFace] = await Promise.all([
    utils.createFace({ assetId: actorAsset.id, personId: targetPerson.id }),
    utils.createFace({ assetId: otherAsset.id, personId: otherOwnerPerson.id }),
  ]);

  const targetIdentityRow = await db.query(`SELECT "identityId" FROM "person" WHERE id = $1`, [targetPerson.id]);
  const sourceIdentityRow = await db.query(`SELECT "identityId" FROM "person" WHERE id = $1`, [otherOwnerPerson.id]);
  const identityT = targetIdentityRow.rows[0].identityId as string;
  const identityS = sourceIdentityRow.rows[0].identityId as string;

  const createSpacePerson = async (name: string, faceId: string, identityId: string) => {
    const inserted = await db.query(
      `INSERT INTO "shared_space_person"
         ("spaceId", name, "isHidden", "faceCount", "assetCount", "representativeFaceId", "identityId", "type")
       VALUES ($1, $2, false, 1, 1, $3, $4, 'person')
       RETURNING id`,
      [space.id, name, faceId, identityId],
    );
    const id = inserted.rows[0].id as string;
    await db.query(`INSERT INTO "shared_space_person_face" ("personId", "assetFaceId") VALUES ($1, $2)`, [id, faceId]);
    return id;
  };

  // The extra row vs. the shipped fixture: the actor's own person also lives in the space.
  const targetSpacePersonId = await createSpacePerson('Ada In Space (mine)', actorFace, identityT);
  const sourceSpacePersonId = await createSpacePerson('Ada In Space (theirs)', otherFace, identityS);

  return {
    admin,
    actor,
    otherOwner,
    spaceId: space.id,
    targetPersonId: targetPerson.id,
    targetSpacePersonId,
    sourceSpacePersonId,
    otherOwnerPersonId: otherOwnerPerson.id,
    identityT,
    identityS,
  };
};

describe('scoped people merge with a same-space profile conflict (#733 follow-up)', () => {
  let fx: Fixture;

  beforeEach(async () => {
    await utils.resetDatabase(RESET_TABLES);
    fx = await setup();
  }, 60_000);

  const enableCrossOwnerMerge = async () => {
    const baseConfig = await utils.getSystemConfig(fx.admin.accessToken);
    await request(app)
      .put('/system-config')
      .set('Authorization', `Bearer ${fx.admin.accessToken}`)
      .send({ ...baseConfig, server: { ...baseConfig.server, mergePeopleAcrossOwners: true } });
  };

  const otherOwnerIdentity = async () => {
    const db = await utils.connectDatabase();
    const { rows } = await db.query(`SELECT "identityId" FROM "person" WHERE id = $1`, [fx.otherOwnerPersonId]);
    return rows[0].identityId as string;
  };

  const spacePeopleForIdentity = async (identityId: string) => {
    const db = await utils.connectDatabase();
    const { rows } = await db.query(
      `SELECT id FROM "shared_space_person" WHERE "spaceId" = $1 AND "identityId" = $2 ORDER BY id`,
      [fx.spaceId, identityId],
    );
    return rows.map((row) => row.id as string);
  };

  it('commits the merge, collapsing the two same-space profiles into one', async () => {
    await enableCrossOwnerMerge();

    const { status } = await request(app)
      .post('/people/same-person')
      .set('Authorization', `Bearer ${fx.actor.accessToken}`)
      .send({
        target: { type: 'person', id: fx.targetPersonId },
        sources: [{ type: 'space-person', id: fx.sourceSpacePersonId, spaceId: fx.spaceId }],
        confirmCrossOwner: true,
      });

    expect(status).toBe(204);

    // The space is left holding exactly one profile for the merged identity — the conflict that used to make
    // this merge impossible is now resolved by collapsing it.
    expect(await spacePeopleForIdentity(fx.identityT)).toEqual([fx.targetSpacePersonId]);
    expect(await spacePeopleForIdentity(fx.identityS)).toEqual([]);
    // The other owner's person is re-pointed onto the surviving identity.
    expect(await otherOwnerIdentity()).toBe(fx.identityT);
  });

  it('CONTROL: the in-space merge endpoint collapses the very same pair and commits the identity merge', async () => {
    const { status } = await request(app)
      .post(`/shared-spaces/${fx.spaceId}/people/${fx.targetSpacePersonId}/merge`)
      .set('Authorization', `Bearer ${fx.actor.accessToken}`)
      .send({ ids: [fx.sourceSpacePersonId] });

    expect(status).toBe(204);
    // Same underlying identity merge the global page refused — and note it rewrites the other owner's
    // person WITHOUT the cross-owner toggle being enabled.
    expect(await otherOwnerIdentity()).toBe(fx.identityT);
  });
});

// §5.4 ENTRY-POINT PARITY. The cross-owner policy must be identical whichever endpoint you merge through —
// otherwise the gate is theatre, since a user can simply pick the ungated path. (b) collapse used to be
// performed silently, with no toggle and no confirmation, by both of these endpoints.
describe('cross-owner policy parity across the merge endpoints (#733)', () => {
  let fx: Fixture;

  beforeEach(async () => {
    await utils.resetDatabase(RESET_TABLES);
    fx = await setup();
  }, 60_000);

  const enableCrossOwnerMerge = async () => {
    const baseConfig = await utils.getSystemConfig(fx.admin.accessToken);
    await request(app)
      .put('/system-config')
      .set('Authorization', `Bearer ${fx.admin.accessToken}`)
      .send({ ...baseConfig, server: { ...baseConfig.server, mergePeopleAcrossOwners: true } });
  };

  /** Give the actor a person on identity S, so a classic own-person merge reaches identity S too. */
  const giveActorAPersonOnS = async () => {
    const db = await utils.connectDatabase();
    const asset = await utils.createAsset(fx.actor.accessToken);
    const person = await utils.createPerson(fx.actor.accessToken, { name: 'Ada Mine On S' });
    await utils.createFace({ assetId: asset.id, personId: person.id });
    await db.query(`UPDATE "person" SET "identityId" = $1 WHERE id = $2`, [fx.identityS, person.id]);
    return person.id;
  };

  /** Give the OTHER owner a second person, on identity T, making any T<->S merge a destructive (b) collapse. */
  const giveOtherOwnerAPersonOnT = async () => {
    const db = await utils.connectDatabase();
    const asset = await utils.createAsset(fx.otherOwner.accessToken);
    const person = await utils.createPerson(fx.otherOwner.accessToken, { name: 'Ada Theirs On T' });
    await utils.createFace({ assetId: asset.id, personId: person.id });
    await db.query(`UPDATE "person" SET "identityId" = $1 WHERE id = $2`, [fx.identityT, person.id]);
    return person.id;
  };

  const otherOwnerPersonCount = async () => {
    const db = await utils.connectDatabase();
    const { rows } = await db.query(`SELECT count(*)::int AS count FROM "person" WHERE "ownerId" = $1`, [
      fx.otherOwner.userId,
    ]);
    return rows[0].count as number;
  };

  // (a) — allowed everywhere, no toggle. Re-pointing another owner's person destroys nothing.
  it('classic POST /people/:id/merge commits an (a) re-point with the toggle off', async () => {
    const actorPersonOnS = await giveActorAPersonOnS();

    await request(app)
      .post(`/people/${fx.targetPersonId}/merge`)
      .set('Authorization', `Bearer ${fx.actor.accessToken}`)
      .send({ ids: [actorPersonOnS] })
      .expect(200);

    const db = await utils.connectDatabase();
    const { rows } = await db.query(`SELECT "identityId" FROM "person" WHERE id = $1`, [fx.otherOwnerPersonId]);
    expect(rows[0].identityId).toBe(fx.identityT);
  });

  it('in-space merge commits an (a) re-point with the toggle off', async () => {
    await request(app)
      .post(`/shared-spaces/${fx.spaceId}/people/${fx.targetSpacePersonId}/merge`)
      .set('Authorization', `Bearer ${fx.actor.accessToken}`)
      .send({ ids: [fx.sourceSpacePersonId] })
      .expect(204);

    const db = await utils.connectDatabase();
    const { rows } = await db.query(`SELECT "identityId" FROM "person" WHERE id = $1`, [fx.otherOwnerPersonId]);
    expect(rows[0].identityId).toBe(fx.identityT);
  });

  // (b) — gated everywhere. These endpoints used to perform this silently.
  it('classic POST /people/:id/merge is blocked from a (b) collapse when the toggle is off', async () => {
    const actorPersonOnS = await giveActorAPersonOnS();
    await giveOtherOwnerAPersonOnT();

    const { status, body } = await request(app)
      .post(`/people/${fx.targetPersonId}/merge`)
      .set('Authorization', `Bearer ${fx.actor.accessToken}`)
      .send({ ids: [actorPersonOnS] });

    expect(status).toBe(403);
    expect(body.code).toBe('cross_owner_merge_blocked');
    expect(await otherOwnerPersonCount()).toBe(2);
  });

  it('in-space merge is blocked from a (b) collapse when the toggle is off', async () => {
    await giveOtherOwnerAPersonOnT();

    const { status, body } = await request(app)
      .post(`/shared-spaces/${fx.spaceId}/people/${fx.targetSpacePersonId}/merge`)
      .set('Authorization', `Bearer ${fx.actor.accessToken}`)
      .send({ ids: [fx.sourceSpacePersonId] });

    expect(status).toBe(403);
    expect(body.code).toBe('cross_owner_merge_blocked');
    expect(await otherOwnerPersonCount()).toBe(2);
  });

  it('classic POST /people/:id/merge commits a (b) collapse once enabled and confirmed', async () => {
    const actorPersonOnS = await giveActorAPersonOnS();
    await giveOtherOwnerAPersonOnT();
    await enableCrossOwnerMerge();

    await request(app)
      .post(`/people/${fx.targetPersonId}/merge`)
      .set('Authorization', `Bearer ${fx.actor.accessToken}`)
      .send({ ids: [actorPersonOnS], confirmCrossOwner: true })
      .expect(200);

    expect(await otherOwnerPersonCount()).toBe(1);
  });

  it('in-space merge commits a (b) collapse once enabled and confirmed', async () => {
    await giveOtherOwnerAPersonOnT();
    await enableCrossOwnerMerge();

    await request(app)
      .post(`/shared-spaces/${fx.spaceId}/people/${fx.targetSpacePersonId}/merge`)
      .set('Authorization', `Bearer ${fx.actor.accessToken}`)
      .send({ ids: [fx.sourceSpacePersonId], confirmCrossOwner: true })
      .expect(204);

    expect(await otherOwnerPersonCount()).toBe(1);
  });

  // The intermediate 409 step: toggle ON but no confirmation on the request. Only the scoped endpoint had this
  // asserted end-to-end (people-cross-owner-merge.e2e-spec.ts); the classic and in-space endpoints jumped
  // straight from "blocked" to "committed", never proving the HTTP 409 contract in between.
  it('classic POST /people/:id/merge requires confirmation for a (b) collapse once the toggle is on', async () => {
    const actorPersonOnS = await giveActorAPersonOnS();
    await giveOtherOwnerAPersonOnT();
    await enableCrossOwnerMerge();

    const { status, body } = await request(app)
      .post(`/people/${fx.targetPersonId}/merge`)
      .set('Authorization', `Bearer ${fx.actor.accessToken}`)
      .send({ ids: [actorPersonOnS] });

    expect(status).toBe(409);
    expect(body.code).toBe('cross_owner_merge_confirmation_required');
    // Nothing merged: the other owner still holds both of their people.
    expect(await otherOwnerPersonCount()).toBe(2);
  });

  it('in-space merge requires confirmation for a (b) collapse once the toggle is on', async () => {
    await giveOtherOwnerAPersonOnT();
    await enableCrossOwnerMerge();

    const { status, body } = await request(app)
      .post(`/shared-spaces/${fx.spaceId}/people/${fx.targetSpacePersonId}/merge`)
      .set('Authorization', `Bearer ${fx.actor.accessToken}`)
      .send({ ids: [fx.sourceSpacePersonId] });

    expect(status).toBe(409);
    expect(body.code).toBe('cross_owner_merge_confirmation_required');
    expect(await otherOwnerPersonCount()).toBe(2);
  });
});
