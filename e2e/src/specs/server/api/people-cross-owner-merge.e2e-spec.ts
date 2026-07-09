import { LoginResponseDto } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, utils } from 'src/utils';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

// End-to-end coverage for the cross-owner scoped people-merge gate (issue #733), exercised through
// the real HTTP endpoint POST /people/same-person against the real Postgres DB.
//
// ML is disabled in the e2e stack, so the cross-owner precondition — one face identity attached to
// two different owners' `person` rows — is seeded directly in SQL (the pattern used by
// global-face-identities.e2e-spec.ts). The merge is driven by a REGULAR (non-admin) user to prove
// the revised gate is the instance toggle, not admin status: the merge is blocked for everyone when
// the toggle is off, and once an admin enables it any user may perform it after an explicit
// confirmation.

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

interface CrossOwnerFixture {
  admin: LoginResponseDto;
  /** userA — a regular (non-admin) user; owns the merge target and the space holding the source. */
  actor: LoginResponseDto;
  /** userB — owns a personal person on the same identity as the source; the "impacted" other owner. */
  otherOwner: LoginResponseDto;
  spaceId: string;
  /** userA's personal person, on identity T — the merge target. */
  targetPersonId: string;
  /** space-person in userA's space, on identity S — the merge source. */
  sourceSpacePersonId: string;
  /** userB's personal person, on identity S — rewritten onto T when the merge commits. */
  otherOwnerPersonId: string;
  identityT: string;
  identityS: string;
}

const setupCrossOwnerMerge = async (): Promise<CrossOwnerFixture> => {
  const db = await utils.connectDatabase();
  const admin = await utils.adminSetup();
  const [actor, otherOwner] = await Promise.all([
    utils.userSetup(admin.accessToken, createUserDto.create('cross-owner-actor')),
    utils.userSetup(admin.accessToken, createUserDto.create('cross-owner-other')),
  ]);

  // userA owns the space, so as its Owner they can repair the space-person source.
  const space = await utils.createSpace(actor.accessToken, { name: 'Cross Owner Space' });

  const [targetPerson, otherOwnerPerson] = await Promise.all([
    utils.createPerson(actor.accessToken, { name: 'Ada Target' }),
    utils.createPerson(otherOwner.accessToken, { name: 'Ada Other Owner' }),
  ]);

  const [actorAsset, otherAsset] = await Promise.all([
    utils.createAsset(actor.accessToken),
    utils.createAsset(otherOwner.accessToken),
  ]);

  // createFace mints a face_identity for each person and points person.identityId at it:
  //   targetPerson -> identity T, otherOwnerPerson -> identity S.
  const [, otherFace] = await Promise.all([
    utils.createFace({ assetId: actorAsset.id, personId: targetPerson.id }),
    utils.createFace({ assetId: otherAsset.id, personId: otherOwnerPerson.id }),
  ]);

  const targetIdentityRow = await db.query(`SELECT "identityId" FROM "person" WHERE id = $1`, [targetPerson.id]);
  const sourceIdentityRow = await db.query(`SELECT "identityId" FROM "person" WHERE id = $1`, [otherOwnerPerson.id]);
  const identityT = targetIdentityRow.rows[0].identityId as string;
  const identityS = sourceIdentityRow.rows[0].identityId as string;

  // A space-person in userA's space carries identity S — userA (space Owner) can repair it, but the
  // same identity S also belongs to userB's personal person, which makes the merge cross-owner.
  const spacePerson = await db.query(
    `INSERT INTO "shared_space_person"
       ("spaceId", name, "isHidden", "faceCount", "assetCount", "representativeFaceId", "identityId", "type")
     VALUES ($1, 'Ada Shared', false, 1, 1, $2, $3, 'person')
     RETURNING id`,
    [space.id, otherFace, identityS],
  );
  const sourceSpacePersonId = spacePerson.rows[0].id as string;
  await db.query(`INSERT INTO "shared_space_person_face" ("personId", "assetFaceId") VALUES ($1, $2)`, [
    sourceSpacePersonId,
    otherFace,
  ]);

  return {
    admin,
    actor,
    otherOwner,
    spaceId: space.id,
    targetPersonId: targetPerson.id,
    sourceSpacePersonId,
    otherOwnerPersonId: otherOwnerPerson.id,
    identityT,
    identityS,
  };
};

describe('/people/same-person cross-owner merge (#733)', () => {
  let fx: CrossOwnerFixture;

  beforeEach(async () => {
    await utils.resetDatabase(RESET_TABLES);
    fx = await setupCrossOwnerMerge();
  }, 60_000);

  const mergeDto = (confirmCrossOwner?: boolean) => ({
    target: { type: 'person', id: fx.targetPersonId },
    sources: [{ type: 'space-person', id: fx.sourceSpacePersonId, spaceId: fx.spaceId }],
    ...(confirmCrossOwner === undefined ? {} : { confirmCrossOwner }),
  });

  const mergeAsActor = (confirmCrossOwner?: boolean) =>
    request(app)
      .post('/people/same-person')
      .set('Authorization', `Bearer ${fx.actor.accessToken}`)
      .send(mergeDto(confirmCrossOwner));

  // An admin flips the instance-wide switch; every other user just sees the feature turn on.
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

  it('blocks a cross-owner merge for a regular user when the toggle is off (default)', async () => {
    const { status, body } = await mergeAsActor();

    expect(status).toBe(403);
    expect(body.code).toBe('cross_owner_merge_blocked');
    // Nothing merged: the other owner's identity is untouched.
    expect(await otherOwnerIdentity()).toBe(fx.identityS);
  });

  it('requires explicit confirmation once an admin enables the toggle', async () => {
    await enableCrossOwnerMerge();

    const { status, body } = await mergeAsActor();

    expect(status).toBe(409);
    expect(body.code).toBe('cross_owner_merge_confirmation_required');
    expect(body.impactedOwnerCount).toBe(1);
    // Still not committed until the user acknowledges.
    expect(await otherOwnerIdentity()).toBe(fx.identityS);
  });

  it('commits the cross-owner merge for a regular user once confirmed, rewriting the other owner’s identity', async () => {
    await enableCrossOwnerMerge();

    await mergeAsActor(true).expect(204);

    // The source identity S is merged into the target identity T, so the other owner's person is
    // rewritten onto T — a real cross-owner DB write performed by a non-admin user.
    expect(await otherOwnerIdentity()).toBe(fx.identityT);
  });
});
