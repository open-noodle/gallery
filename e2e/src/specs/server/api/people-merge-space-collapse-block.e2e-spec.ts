import { LoginResponseDto, SharedSpaceRole } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, utils } from 'src/utils';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

// End-to-end HTTP coverage for a merge whose fan-out would collapse people in a shared space the actor cannot
// edit (issue #733 follow-up, review P1), driven through the real endpoints against the real Postgres DB.
// Collapsing such a space's people is destructive, so — like collapsing another owner's people — it is governed
// by the `mergePeopleAcrossOwners` toggle: refused with `cross_owner_merge_blocked` while the toggle is off, and
// permitted (with an explicit `confirmCrossOwner`) once an administrator turns it on.
//
// The service-level behaviour is proven in server/test/medium/specs/services/people-identity-rbac.spec.ts and
// the policy itself in server/src/utils/merge-policy.spec.ts; these tests pin the HTTP contract for each of the
// three merge endpoints — the one layer those specs do not exercise.
//
// ML is disabled in the e2e stack, so the preconditions are seeded directly in SQL.

const RESET_TABLES = [
  'shared_space_person_face',
  'shared_space_person',
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

const BLOCKED_CODE = 'cross_owner_merge_blocked';

type Db = Awaited<ReturnType<typeof utils.connectDatabase>>;

const enableCrossOwnerMerge = async (admin: LoginResponseDto) => {
  const baseConfig = await utils.getSystemConfig(admin.accessToken);
  await request(app)
    .put('/system-config')
    .set('Authorization', `Bearer ${admin.accessToken}`)
    .send({ ...baseConfig, server: { ...baseConfig.server, mergePeopleAcrossOwners: true } });
};

const mkFace = async (db: Db, assetId: string): Promise<string> => {
  const { rows } = await db.query(`INSERT INTO "asset_face" ("assetId") VALUES ($1) RETURNING id`, [assetId]);
  return rows[0].id as string;
};

const mintIdentity = async (db: Db, faceId: string): Promise<string> => {
  const { rows } = await db.query(
    `INSERT INTO "face_identity" ("type", "representativeFaceId") VALUES ('person', $1) RETURNING id`,
    [faceId],
  );
  const identityId = rows[0].id as string;
  await db.query(`INSERT INTO "face_identity_face" ("assetFaceId", "identityId", "source") VALUES ($1, $2, 'manual')`, [
    faceId,
    identityId,
  ]);
  return identityId;
};

const createSpaceProfile = async (db: Db, spaceId: string, name: string, identityId: string, faceId: string) => {
  const { rows } = await db.query(
    `INSERT INTO "shared_space_person"
       ("spaceId", name, "isHidden", "faceCount", "assetCount", "representativeFaceId", "identityId", "type")
     VALUES ($1, $2, false, 1, 1, $3, $4, 'person')
     RETURNING id`,
    [spaceId, name, faceId, identityId],
  );
  const id = rows[0].id as string;
  await db.query(`INSERT INTO "shared_space_person_face" ("personId", "assetFaceId") VALUES ($1, $2)`, [id, faceId]);
  return id;
};

const personIdentity = async (db: Db, personId: string): Promise<string> => {
  const { rows } = await db.query(`SELECT "identityId" FROM "person" WHERE id = $1`, [personId]);
  return rows[0].identityId as string;
};

const remainingProfiles = async (db: Db, spaceId: string): Promise<number> => {
  const { rows } = await db.query(`SELECT count(*)::int AS count FROM "shared_space_person" WHERE "spaceId" = $1`, [
    spaceId,
  ]);
  return rows[0].count as number;
};

describe('merge un-editable-space collapse over HTTP (#733 follow-up, toggle-governed)', () => {
  let admin: LoginResponseDto;
  let actor: LoginResponseDto;
  let stranger: LoginResponseDto;
  let db: Db;

  beforeEach(async () => {
    await utils.resetDatabase(RESET_TABLES);
    db = await utils.connectDatabase();
    admin = await utils.adminSetup();
    [actor, stranger] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('collapse-block-actor')),
      utils.userSetup(admin.accessToken, createUserDto.create('collapse-block-stranger')),
    ]);
  }, 60_000);

  // A space owned by the stranger, carrying a profile on BOTH merged identities, with the actor in the given role
  // (or not a member when role is null).
  const viewerSpaceWithBothIdentities = async (identityT: string, identityS: string, role: SharedSpaceRole | null) => {
    const space = await utils.createSpace(stranger.accessToken, { name: 'Viewer Fan-out Space' });
    if (role) {
      await utils.addSpaceMember(stranger.accessToken, space.id, { userId: actor.userId, role });
    }
    const asset = await utils.createAsset(stranger.accessToken);
    await createSpaceProfile(db, space.id, 'Fan T', identityT, await mkFace(db, asset.id));
    await createSpaceProfile(db, space.id, 'Fan S', identityS, await mkFace(db, asset.id));
    return space.id;
  };

  const setupClassic = async (role: SharedSpaceRole | null) => {
    const [personA, personB] = await Promise.all([
      utils.createPerson(actor.accessToken, { name: 'Own A' }),
      utils.createPerson(actor.accessToken, { name: 'Own B' }),
    ]);
    const [assetA, assetB] = await Promise.all([
      utils.createAsset(actor.accessToken),
      utils.createAsset(actor.accessToken),
    ]);
    await Promise.all([
      utils.createFace({ assetId: assetA.id, personId: personA.id }),
      utils.createFace({ assetId: assetB.id, personId: personB.id }),
    ]);
    const identityT = await personIdentity(db, personA.id);
    const identityS = await personIdentity(db, personB.id);
    const spaceId = await viewerSpaceWithBothIdentities(identityT, identityS, role);
    return { personA, personB, spaceId };
  };

  // The actor names a source they CAN repair (a space-person in a space they edit), but the fan-out reaches a
  // different, viewer-only space that holds both identities.
  const setupScoped = async () => {
    const personA = await utils.createPerson(actor.accessToken, { name: 'Own A' });
    const assetA = await utils.createAsset(actor.accessToken);
    await utils.createFace({ assetId: assetA.id, personId: personA.id });
    const identityT = await personIdentity(db, personA.id);

    const editorSpace = await utils.createSpace(stranger.accessToken, { name: 'Editor Source Space' });
    await utils.addSpaceMember(stranger.accessToken, editorSpace.id, {
      userId: actor.userId,
      role: SharedSpaceRole.Editor,
    });
    const strangerAsset = await utils.createAsset(stranger.accessToken);
    const identityS = await mintIdentity(db, await mkFace(db, strangerAsset.id));
    const sourceSpacePersonId = await createSpaceProfile(
      db,
      editorSpace.id,
      'Editable Source',
      identityS,
      await mkFace(db, strangerAsset.id),
    );

    const viewerSpaceId = await viewerSpaceWithBothIdentities(identityT, identityS, SharedSpaceRole.Viewer);
    return { personA, editorSpaceId: editorSpace.id, sourceSpacePersonId, viewerSpaceId };
  };

  // The actor is Editor of the initiating space (so the merge is authorized there), but the same two identities
  // are also duplicated in a SECOND space the actor can only view — the fan-out into that space must be refused.
  const setupInSpace = async () => {
    const editorSpace = await utils.createSpace(stranger.accessToken, { name: 'Editor Initiating Space' });
    await utils.addSpaceMember(stranger.accessToken, editorSpace.id, {
      userId: actor.userId,
      role: SharedSpaceRole.Editor,
    });
    const strangerAsset = await utils.createAsset(stranger.accessToken);
    const identityT = await mintIdentity(db, await mkFace(db, strangerAsset.id));
    const identityS = await mintIdentity(db, await mkFace(db, strangerAsset.id));
    const targetSpacePersonId = await createSpaceProfile(
      db,
      editorSpace.id,
      'Edit Target',
      identityT,
      await mkFace(db, strangerAsset.id),
    );
    const sourceSpacePersonId = await createSpaceProfile(
      db,
      editorSpace.id,
      'Edit Source',
      identityS,
      await mkFace(db, strangerAsset.id),
    );

    const viewerSpaceId = await viewerSpaceWithBothIdentities(identityT, identityS, SharedSpaceRole.Viewer);
    return { editorSpaceId: editorSpace.id, targetSpacePersonId, sourceSpacePersonId, viewerSpaceId };
  };

  describe('classic POST /people/:id/merge', () => {
    it('is refused (403 blocked) when the actor can only view the collapsing space and the toggle is off', async () => {
      const { personA, personB, spaceId } = await setupClassic(SharedSpaceRole.Viewer);

      const { status, body } = await request(app)
        .post(`/people/${personA.id}/merge`)
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .send({ ids: [personB.id] });

      expect(status).toBe(403);
      expect(body.code).toBe(BLOCKED_CODE);
      // Nothing destroyed: the space still has both profiles.
      expect(await remainingProfiles(db, spaceId)).toBe(2);
    });

    it('is refused when the actor is not a member of the collapsing space and the toggle is off', async () => {
      const { personA, personB, spaceId } = await setupClassic(null);

      const { status, body } = await request(app)
        .post(`/people/${personA.id}/merge`)
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .send({ ids: [personB.id] });

      expect(status).toBe(403);
      expect(body.code).toBe(BLOCKED_CODE);
      expect(await remainingProfiles(db, spaceId)).toBe(2);
    });

    it('requires confirmation (409) when the toggle is on but the merge is not confirmed', async () => {
      const { personA, personB, spaceId } = await setupClassic(SharedSpaceRole.Viewer);
      await enableCrossOwnerMerge(admin);

      const { status, body } = await request(app)
        .post(`/people/${personA.id}/merge`)
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .send({ ids: [personB.id] });

      expect(status).toBe(409);
      expect(body.impactedSpaceCount).toBe(1);
      expect(await remainingProfiles(db, spaceId)).toBe(2);
    });

    it('commits once the toggle is on and the merge is confirmed, collapsing the un-editable space', async () => {
      const { personA, personB, spaceId } = await setupClassic(SharedSpaceRole.Viewer);
      await enableCrossOwnerMerge(admin);

      const { status } = await request(app)
        .post(`/people/${personA.id}/merge`)
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .send({ ids: [personB.id], confirmCrossOwner: true });

      expect(status).toBeLessThan(300);
      expect(await remainingProfiles(db, spaceId)).toBe(1);
    });
  });

  describe('scoped POST /people/same-person', () => {
    it('is refused (403 blocked) when the fan-out collapses a space the actor can only view and the toggle is off', async () => {
      const { personA, editorSpaceId, sourceSpacePersonId, viewerSpaceId } = await setupScoped();

      const { status, body } = await request(app)
        .post('/people/same-person')
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .send({
          target: { type: 'person', id: personA.id },
          sources: [{ type: 'space-person', id: sourceSpacePersonId, spaceId: editorSpaceId }],
        });

      expect(status).toBe(403);
      expect(body.code).toBe(BLOCKED_CODE);
      expect(await remainingProfiles(db, viewerSpaceId)).toBe(2);
    });

    it('commits once the toggle is on and the merge is confirmed, collapsing the un-editable space', async () => {
      const { personA, editorSpaceId, sourceSpacePersonId, viewerSpaceId } = await setupScoped();
      await enableCrossOwnerMerge(admin);

      const { status } = await request(app)
        .post('/people/same-person')
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .send({
          target: { type: 'person', id: personA.id },
          sources: [{ type: 'space-person', id: sourceSpacePersonId, spaceId: editorSpaceId }],
          confirmCrossOwner: true,
        });

      expect(status).toBe(204);
      expect(await remainingProfiles(db, viewerSpaceId)).toBe(1);
    });
  });

  describe('in-space POST /shared-spaces/:id/people/:personId/merge', () => {
    it('is refused (403 blocked) when the fan-out collapses a different space the actor cannot edit and the toggle is off', async () => {
      const { editorSpaceId, targetSpacePersonId, sourceSpacePersonId, viewerSpaceId } = await setupInSpace();

      const { status, body } = await request(app)
        .post(`/shared-spaces/${editorSpaceId}/people/${targetSpacePersonId}/merge`)
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .send({ ids: [sourceSpacePersonId] });

      expect(status).toBe(403);
      expect(body.code).toBe(BLOCKED_CODE);
      expect(await remainingProfiles(db, viewerSpaceId)).toBe(2);
    });

    it('commits once the toggle is on and the merge is confirmed, collapsing the un-editable space', async () => {
      const { editorSpaceId, targetSpacePersonId, sourceSpacePersonId, viewerSpaceId } = await setupInSpace();
      await enableCrossOwnerMerge(admin);

      const { status } = await request(app)
        .post(`/shared-spaces/${editorSpaceId}/people/${targetSpacePersonId}/merge`)
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .send({ ids: [sourceSpacePersonId], confirmCrossOwner: true });

      expect(status).toBe(204);
      expect(await remainingProfiles(db, viewerSpaceId)).toBe(1);
    });
  });
});
