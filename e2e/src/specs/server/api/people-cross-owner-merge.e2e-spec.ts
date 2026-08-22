import { LoginResponseDto } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, utils } from 'src/utils';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

// End-to-end coverage for the cross-owner merge policy (issue #733), driven through the real HTTP endpoint
// POST /people/same-person against the real Postgres DB by a NON-admin user.
//
// A merge reaches into another user's library in one of two ways, and only one of them is destructive:
//
//   (a) RE-POINT  — the other owner holds ONE person on the identity set. It is re-pointed at the surviving
//                   identity; their row keeps its name, faces and thumbnail. The recognition job already does
//                   exactly this, unattended, every time it fuses identities across libraries. Never gated.
//
//   (b) COLLAPSE  — the other owner holds people on BOTH identities, so the merge merges two of THEIR people:
//                   one row is deleted, its faces moved. Irreversible, and done to someone who never asked.
//                   Gated on the `server.mergePeopleAcrossOwners` toggle AND an explicit confirmation.
//
// ML is disabled in the e2e stack, so the cross-owner preconditions are seeded directly in SQL (the pattern
// used by global-face-identities.e2e-spec.ts).

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
  /** userB — the other owner, whose library the merge reaches into. */
  otherOwner: LoginResponseDto;
  spaceId: string;
  /** userA's personal person, on identity T — the merge target. */
  targetPersonId: string;
  /** space-person in userA's space, on identity S — the merge source. */
  sourceSpacePersonId: string;
  /** userB's person on identity S. */
  otherOwnerPersonId: string;
  /** userB's person on identity T — only created for the (b) collapse fixture. */
  otherOwnerSecondPersonId?: string;
  identityT: string;
  identityS: string;
}

/**
 * @param withCollapse when true, userB also holds a person on identity T, so merging S into T would merge two
 * of userB's people — the destructive (b) case. Otherwise userB holds a single person and is merely re-pointed.
 */
const setupCrossOwnerMerge = async (options: { withCollapse: boolean }): Promise<CrossOwnerFixture> => {
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
    utils.createFace({ assetId: actorAsset.id, personGroupId: targetPerson.id }),
    utils.createFace({ assetId: otherAsset.id, personGroupId: otherOwnerPerson.id }),
  ]);

  const targetIdentityRow = await db.query(`SELECT "identityId" FROM "person" WHERE id = $1`, [targetPerson.id]);
  const sourceIdentityRow = await db.query(`SELECT "identityId" FROM "person" WHERE id = $1`, [otherOwnerPerson.id]);
  const identityT = targetIdentityRow.rows[0].identityId as string;
  const identityS = sourceIdentityRow.rows[0].identityId as string;

  // A space-person in userA's space carries identity S — userA (space Owner) can repair it, but the same
  // identity S also belongs to userB's personal person, which makes the merge cross-owner.
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

  let otherOwnerSecondPersonId: string | undefined;
  if (options.withCollapse) {
    // userB ALSO has a person on identity T — the same real person, recognised separately in their own library.
    // Merging S into T therefore has to merge userB's two people into one: the destructive case.
    const secondPerson = await utils.createPerson(otherOwner.accessToken, { name: 'Ada Other Owner (dupe)' });
    const secondAsset = await utils.createAsset(otherOwner.accessToken);
    await utils.createFace({ assetId: secondAsset.id, personGroupId: secondPerson.id });
    await db.query(`UPDATE "person" SET "identityId" = $1 WHERE id = $2`, [identityT, secondPerson.id]);
    otherOwnerSecondPersonId = secondPerson.id;
  }

  return {
    admin,
    actor,
    otherOwner,
    spaceId: space.id,
    targetPersonId: targetPerson.id,
    sourceSpacePersonId,
    otherOwnerPersonId: otherOwnerPerson.id,
    otherOwnerSecondPersonId,
    identityT,
    identityS,
  };
};

const enableCrossOwnerMerge = async (admin: LoginResponseDto) => {
  const baseConfig = await utils.getSystemConfig(admin.accessToken);
  await request(app)
    .put('/system-config')
    .set('Authorization', `Bearer ${admin.accessToken}`)
    .send({ ...baseConfig, server: { ...baseConfig.server, mergePeopleAcrossOwners: true } });
};

describe('/people/same-person cross-owner merge (#733)', () => {
  describe('(a) re-pointing another owner’s person — never gated', () => {
    let fx: CrossOwnerFixture;

    beforeEach(async () => {
      await utils.resetDatabase(RESET_TABLES);
      fx = await setupCrossOwnerMerge({ withCollapse: false });
    }, 60_000);

    const mergeAsActor = (confirmCrossOwner?: boolean) =>
      request(app)
        .post('/people/same-person')
        .set('Authorization', `Bearer ${fx.actor.accessToken}`)
        .send({
          target: { type: 'person', id: fx.targetPersonId },
          sources: [{ type: 'space-person', id: fx.sourceSpacePersonId, spaceId: fx.spaceId }],
          ...(confirmCrossOwner !== undefined && { confirmCrossOwner }),
        });

    const otherOwnerPeople = async () => {
      const db = await utils.connectDatabase();
      const { rows } = await db.query(
        `SELECT id, name, "identityId" FROM "person" WHERE "ownerId" = $1 ORDER BY name`,
        [fx.otherOwner.userId],
      );
      return rows as { id: string; name: string; identityId: string }[];
    };

    // This is the merge the #733 reporter is trying to make. It destroys nothing: userB keeps their person,
    // its name and its faces — only the identity it points at changes. It needs no admin toggle.
    it('commits with the toggle off, leaving the other owner’s person intact', async () => {
      await mergeAsActor().expect(204);

      const people = await otherOwnerPeople();
      expect(people).toEqual([
        expect.objectContaining({ id: fx.otherOwnerPersonId, name: 'Ada Other Owner', identityId: fx.identityT }),
      ]);
    });
  });

  describe('(b) merging two of another owner’s people — gated', () => {
    let fx: CrossOwnerFixture;

    beforeEach(async () => {
      await utils.resetDatabase(RESET_TABLES);
      fx = await setupCrossOwnerMerge({ withCollapse: true });
    }, 60_000);

    const mergeAsActor = (confirmCrossOwner?: boolean) =>
      request(app)
        .post('/people/same-person')
        .set('Authorization', `Bearer ${fx.actor.accessToken}`)
        .send({
          target: { type: 'person', id: fx.targetPersonId },
          sources: [{ type: 'space-person', id: fx.sourceSpacePersonId, spaceId: fx.spaceId }],
          ...(confirmCrossOwner !== undefined && { confirmCrossOwner }),
        });

    const otherOwnerPersonIds = async () => {
      const db = await utils.connectDatabase();
      const { rows } = await db.query(`SELECT id FROM "person" WHERE "ownerId" = $1 ORDER BY id`, [
        fx.otherOwner.userId,
      ]);
      return (rows as { id: string }[]).map(({ id }) => id).toSorted((a, b) => a.localeCompare(b));
    };

    it('is blocked for a regular user when the toggle is off (default)', async () => {
      const { status, body } = await mergeAsActor();

      expect(status).toBe(403);
      expect(body.code).toBe('cross_owner_merge_blocked');
      // Nothing written: userB still has both of their people.
      expect(await otherOwnerPersonIds()).toEqual(
        [fx.otherOwnerPersonId, fx.otherOwnerSecondPersonId!].toSorted((a, b) => a.localeCompare(b)),
      );
    });

    it('requires explicit confirmation once an admin enables the toggle', async () => {
      await enableCrossOwnerMerge(fx.admin);

      const { status, body } = await mergeAsActor();

      expect(status).toBe(409);
      expect(body.code).toBe('cross_owner_merge_confirmation_required');
      expect(body.impactedOwnerCount).toBe(1);
      expect(await otherOwnerPersonIds()).toEqual(
        [fx.otherOwnerPersonId, fx.otherOwnerSecondPersonId!].toSorted((a, b) => a.localeCompare(b)),
      );
    });

    it('commits once confirmed, merging the other owner’s two people into one', async () => {
      await enableCrossOwnerMerge(fx.admin);

      await mergeAsActor(true).expect(204);

      // userB is left with a single person on the surviving identity — a real, irreversible write into another
      // user's library, which is exactly why it took a toggle and an acknowledgement to get here.
      const remaining = await otherOwnerPersonIds();
      expect(remaining).toHaveLength(1);

      const db = await utils.connectDatabase();
      const { rows } = await db.query(`SELECT "identityId" FROM "person" WHERE id = $1`, [remaining[0]]);
      expect(rows[0].identityId).toBe(fx.identityT);
    });
  });
});
