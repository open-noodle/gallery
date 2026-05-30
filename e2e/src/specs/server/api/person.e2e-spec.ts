import {
  getPerson,
  LoginResponseDto,
  mergeScopedPeople,
  PersonResponseDto,
  Type2 as ScopedPersonRefType,
  SharedSpaceRole,
} from '@immich/sdk';
import { createUserDto, uuidDto } from 'src/fixtures';
import { errorDto } from 'src/responses';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

describe('/people', () => {
  let admin: LoginResponseDto;
  let visiblePerson: PersonResponseDto;
  let hiddenPerson: PersonResponseDto;
  let multipleAssetsPerson: PersonResponseDto;

  let nameAlicePerson: PersonResponseDto;
  let nameBobPerson: PersonResponseDto;
  let nameCharliePerson: PersonResponseDto;
  let nameNullPerson4Assets: PersonResponseDto;
  let nameNullPerson3Assets: PersonResponseDto;
  let nameNullPerson1Asset: PersonResponseDto;
  let nameBillPersonFavourite: PersonResponseDto;
  let nameFreddyPersonFavourite: PersonResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    [
      visiblePerson,
      hiddenPerson,
      multipleAssetsPerson,
      nameCharliePerson,
      nameBobPerson,
      nameAlicePerson,
      nameNullPerson4Assets,
      nameNullPerson3Assets,
      nameNullPerson1Asset,
      nameBillPersonFavourite,
      nameFreddyPersonFavourite,
    ] = await Promise.all([
      utils.createPerson(admin.accessToken, {
        name: 'visible_person',
      }),
      utils.createPerson(admin.accessToken, {
        name: 'hidden_person',
        isHidden: true,
      }),
      utils.createPerson(admin.accessToken, {
        name: 'multiple_assets_person',
      }),
      // --- Setup for the specific sorting test ---
      utils.createPerson(admin.accessToken, {
        name: 'Charlie',
      }),
      utils.createPerson(admin.accessToken, {
        name: 'Bob',
      }),
      utils.createPerson(admin.accessToken, {
        name: 'Alice',
      }),
      utils.createPerson(admin.accessToken, {
        name: '',
      }),
      utils.createPerson(admin.accessToken, {
        name: '',
      }),
      utils.createPerson(admin.accessToken, {
        name: '',
      }),
      utils.createPerson(admin.accessToken, {
        name: 'Bill',
        isFavorite: true,
      }),
      utils.createPerson(admin.accessToken, {
        name: 'Freddy',
        isFavorite: true,
      }),
    ]);

    const asset1 = await utils.createAsset(admin.accessToken);
    const asset2 = await utils.createAsset(admin.accessToken);
    const asset3 = await utils.createAsset(admin.accessToken);
    const asset4 = await utils.createAsset(admin.accessToken);

    await Promise.all([
      utils.createFace({ assetId: asset1.id, personId: visiblePerson.id }),
      utils.createFace({ assetId: asset1.id, personId: hiddenPerson.id }),
      utils.createFace({ assetId: asset1.id, personId: multipleAssetsPerson.id }),
      utils.createFace({ assetId: asset1.id, personId: multipleAssetsPerson.id }),
      utils.createFace({ assetId: asset2.id, personId: multipleAssetsPerson.id }),
      utils.createFace({ assetId: asset3.id, personId: multipleAssetsPerson.id }), // 4 assets
      // Named persons
      utils.createFace({ assetId: asset1.id, personId: nameCharliePerson.id }), // 1 asset
      utils.createFace({ assetId: asset1.id, personId: nameBobPerson.id }),
      utils.createFace({ assetId: asset2.id, personId: nameBobPerson.id }), // 2 assets
      utils.createFace({ assetId: asset1.id, personId: nameAlicePerson.id }), // 1 asset
      // Null-named person 4 assets
      utils.createFace({ assetId: asset1.id, personId: nameNullPerson4Assets.id }),
      utils.createFace({ assetId: asset2.id, personId: nameNullPerson4Assets.id }),
      utils.createFace({ assetId: asset3.id, personId: nameNullPerson4Assets.id }),
      utils.createFace({ assetId: asset4.id, personId: nameNullPerson4Assets.id }), // 4 assets
      // Null-named person 3 assets
      utils.createFace({ assetId: asset1.id, personId: nameNullPerson3Assets.id }),
      utils.createFace({ assetId: asset2.id, personId: nameNullPerson3Assets.id }),
      utils.createFace({ assetId: asset3.id, personId: nameNullPerson3Assets.id }), // 3 assets
      // Null-named person 1 asset
      utils.createFace({ assetId: asset3.id, personId: nameNullPerson1Asset.id }),
      // Favourite People
      utils.createFace({ assetId: asset1.id, personId: nameFreddyPersonFavourite.id }),
      utils.createFace({ assetId: asset2.id, personId: nameFreddyPersonFavourite.id }),
      utils.createFace({ assetId: asset1.id, personId: nameBillPersonFavourite.id }),
    ]);
  });

  describe('GET /people', () => {
    beforeEach(async () => {});
    it('should return all people (including hidden)', async () => {
      const { status, body } = await request(app)
        .get('/people')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .query({ withHidden: true });

      expect(status).toBe(200);
      expect(body).toEqual({
        hasNextPage: false,
        total: 10,
        hidden: 1,
        people: [
          expect.objectContaining({ name: 'Bill' }),
          expect.objectContaining({ name: 'Freddy' }),
          expect.objectContaining({ name: 'Alice' }),
          expect.objectContaining({ name: 'Bob' }),
          expect.objectContaining({ name: 'Charlie' }),
          expect.objectContaining({ name: 'multiple_assets_person' }),
          expect.objectContaining({ name: 'visible_person' }),
          expect.objectContaining({ id: nameNullPerson4Assets.id, name: '' }),
          expect.objectContaining({ id: nameNullPerson3Assets.id, name: '' }),
          expect.objectContaining({ name: 'hidden_person' }),
        ],
      });
    });

    it('should sort visible people by favorite, named people alphabetically, then unnamed by asset count', async () => {
      const { status, body } = await request(app).get('/people').set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(body.hasNextPage).toBe(false);
      expect(body.total).toBe(10); // Eligible persons
      expect(body.hidden).toBe(1); // 'hidden_person'

      const people = body.people as PersonResponseDto[];

      expect(people.map((p) => p.id)).toEqual([
        nameBillPersonFavourite.id, // name: 'Bill', count: 1
        nameFreddyPersonFavourite.id, // name: 'Freddy', count: 2
        nameAlicePerson.id, // name: 'Alice', count: 1
        nameBobPerson.id, // name: 'Bob', count: 2
        nameCharliePerson.id, // name: 'Charlie', count: 1
        multipleAssetsPerson.id, // name: 'multiple_assets_person', count: 3
        visiblePerson.id, // name: 'visible_person', count: 1
        nameNullPerson4Assets.id, // name: '', count: 4
        nameNullPerson3Assets.id, // name: '', count: 3
      ]);

      expect(people.some((p) => p.id === hiddenPerson.id)).toBe(false);
    });

    it('should return only visible people', async () => {
      const { status, body } = await request(app).get('/people').set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(body).toEqual({
        hasNextPage: false,
        total: 10,
        hidden: 1,
        people: [
          expect.objectContaining({ name: 'Bill' }),
          expect.objectContaining({ name: 'Freddy' }),
          expect.objectContaining({ name: 'Alice' }),
          expect.objectContaining({ name: 'Bob' }),
          expect.objectContaining({ name: 'Charlie' }),
          expect.objectContaining({ name: 'multiple_assets_person' }),
          expect.objectContaining({ name: 'visible_person' }),
          expect.objectContaining({ id: nameNullPerson4Assets.id, name: '' }),
          expect.objectContaining({ id: nameNullPerson3Assets.id, name: '' }),
        ],
      });
    });

    it('should support pagination', async () => {
      const { status, body } = await request(app)
        .get('/people')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .query({ withHidden: true, page: 5, size: 1 });

      expect(status).toBe(200);
      expect(body).toEqual({
        hasNextPage: true,
        total: 10,
        hidden: 1,
        people: [expect.objectContaining({ name: 'Charlie' })],
      });
    });
  });

  describe('GET /people/:id', () => {
    it('should throw error if person with id does not exist', async () => {
      const { status, body } = await request(app)
        .get(`/people/${uuidDto.notFound}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest());
    });

    it('should return person information', async () => {
      const { status, body } = await request(app)
        .get(`/people/${visiblePerson.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(body).toEqual(expect.objectContaining({ id: visiblePerson.id }));
    });
  });

  describe('GET /people/:id/statistics', () => {
    it('should throw error if person with id does not exist', async () => {
      const { status, body } = await request(app)
        .get(`/people/${uuidDto.notFound}/statistics`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest());
    });

    it('should return the correct number of assets', async () => {
      const { status, body } = await request(app)
        .get(`/people/${multipleAssetsPerson.id}/statistics`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(body).toEqual(expect.objectContaining({ assets: 3 }));
    });
  });

  describe('POST /people', () => {
    it('should create a person', async () => {
      const { status, body } = await request(app)
        .post(`/people`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          name: 'New Person',
          birthDate: '1990-01-01',
          color: '#333',
        });
      expect(status).toBe(201);
      expect(body).toMatchObject({
        id: expect.any(String),
        name: 'New Person',
        birthDate: '1990-01-01',
      });
    });

    it('should create a favorite person', async () => {
      const { status, body } = await request(app)
        .post(`/people`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          name: 'New Favorite Person',
          isFavorite: true,
        });
      expect(status).toBe(201);
      expect(body).toMatchObject({
        id: expect.any(String),
        name: 'New Favorite Person',
        isFavorite: true,
      });
    });
  });

  describe('PUT /people/:id', () => {
    it('should update a date of birth', async () => {
      const { status, body } = await request(app)
        .put(`/people/${visiblePerson.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ birthDate: '1990-01-01' });
      expect(status).toBe(200);
      expect(body).toMatchObject({ birthDate: '1990-01-01' });
    });

    it('should clear a date of birth', async () => {
      const { status, body } = await request(app)
        .put(`/people/${visiblePerson.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ birthDate: null });
      expect(status).toBe(200);
      expect(body).toMatchObject({ birthDate: null });
    });

    it('should set a color', async () => {
      const { status, body } = await request(app)
        .put(`/people/${visiblePerson.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ color: '#555' });
      expect(status).toBe(200);
      expect(body).toMatchObject({ color: '#555' });
    });

    it('should clear a color', async () => {
      const { status, body } = await request(app)
        .put(`/people/${visiblePerson.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ color: null });
      expect(status).toBe(200);
      expect(body.color).toBeUndefined();
    });

    it('should mark a person as favorite', async () => {
      const person = await utils.createPerson(admin.accessToken, {
        name: 'visible_person',
      });

      expect(person.isFavorite).toBe(false);

      const { status, body } = await request(app)
        .put(`/people/${person.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ isFavorite: true });
      expect(status).toBe(200);
      expect(body).toMatchObject({ isFavorite: true });

      const person2 = await getPerson({ id: person.id }, { headers: asBearerAuth(admin.accessToken) });
      expect(person2).toMatchObject({ id: person.id, isFavorite: true });
    });
  });

  describe('POST /people/:id/merge', () => {
    it('should not supporting merging a person into themselves', async () => {
      const { status, body } = await request(app)
        .post(`/people/${visiblePerson.id}/merge`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ ids: [visiblePerson.id] });
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Cannot merge a person into themselves'));
    });
  });
});

// Gives an identity-LESS shared_space_person (from utils.createSpacePerson) its own
// face_identity, so two such rows in the SAME space sit on DIFFERENT identities and
// therefore form a same-space conflict that mergeScopedPeople must collapse.
//
// Mirrors the medium-test `createAccessibleSpaceIdentity` helper: insert a
// face_identity (type 'person'), point both the backing global person row and the
// space-person row at it, and link the backing face to it with source 'manual'.
const giveSpacePersonAnIdentity = async (input: {
  globalPersonId: string;
  spacePersonId: string;
  faceId: string;
}): Promise<string> => {
  const client = await utils.connectDatabase();

  const identityResult = await client.query(
    `INSERT INTO "face_identity" ("type", "representativeFaceId") VALUES ('person', $1) RETURNING id`,
    [input.faceId],
  );
  const identityId = identityResult.rows[0].id as string;

  await client.query(`UPDATE "person" SET "identityId" = $1 WHERE id = $2`, [identityId, input.globalPersonId]);
  await client.query(`UPDATE "shared_space_person" SET "identityId" = $1 WHERE id = $2`, [
    identityId,
    input.spacePersonId,
  ]);
  await client.query(
    `INSERT INTO "face_identity_face" ("assetFaceId", "identityId", "source") VALUES ($1, $2, 'manual')`,
    [input.faceId, identityId],
  );

  return identityId;
};

describe('/people/same-person (scoped merge collapse)', () => {
  let admin: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
  });

  it('collapses two same-owner personal duplicates into one surviving person', async () => {
    // Test case A: two personal people owned by the same user, each on its own identity
    // (utils.createFace mints an identity per person). The merge must collapse the source
    // into the target and delete the source person row.
    const [target, source] = await Promise.all([
      utils.createPerson(admin.accessToken, { name: 'Same Owner Target' }),
      utils.createPerson(admin.accessToken, { name: 'Same Owner Source' }),
    ]);

    const targetAsset = await utils.createAsset(admin.accessToken);
    const sourceAsset = await utils.createAsset(admin.accessToken);
    await utils.createFace({ assetId: targetAsset.id, personId: target.id });
    await utils.createFace({ assetId: sourceAsset.id, personId: source.id });

    await mergeScopedPeople(
      {
        mergeScopedPeopleDto: {
          target: { type: ScopedPersonRefType.Person, id: target.id },
          sources: [{ type: ScopedPersonRefType.Person, id: source.id }],
        },
      },
      { headers: asBearerAuth(admin.accessToken) },
    );

    // Target survives.
    const survivor = await getPerson({ id: target.id }, { headers: asBearerAuth(admin.accessToken) });
    expect(survivor).toMatchObject({ id: target.id });

    // Source person row is gone (collapsed). Missing personal person → 400 (bulk-access pattern).
    const { status: sourceStatus, body: sourceBody } = await request(app)
      .get(`/people/${source.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(sourceStatus).toBe(400);
    expect(sourceBody).toEqual(errorDto.badRequest());
  });

  it('collapses two same-space duplicates into one surviving space person', async () => {
    // Test case B: two space-people in ONE space, on two different identities. The merge
    // collapses them to a single surviving shared_space_person row; the other id is gone.
    const space = await utils.createSpace(admin.accessToken, { name: 'Same Space Collapse' });
    const asset = await utils.createAsset(admin.accessToken);
    await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

    const targetSp = await utils.createSpacePerson(space.id, 'Space Target', admin.userId, asset.id);
    const sourceSp = await utils.createSpacePerson(space.id, 'Space Source', admin.userId, asset.id);
    await giveSpacePersonAnIdentity(targetSp);
    await giveSpacePersonAnIdentity(sourceSp);

    await mergeScopedPeople(
      {
        mergeScopedPeopleDto: {
          target: { type: ScopedPersonRefType.SpacePerson, id: targetSp.spacePersonId, spaceId: space.id },
          sources: [{ type: ScopedPersonRefType.SpacePerson, id: sourceSp.spacePersonId, spaceId: space.id }],
        },
      },
      { headers: asBearerAuth(admin.accessToken) },
    );

    // Exactly one of the two created space-people survives, and it is the target.
    const { status: listStatus, body: listBody } = await request(app)
      .get(`/shared-spaces/${space.id}/people?withHidden=true`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(listStatus).toBe(200);
    const remainingIds = (listBody as { id: string }[]).map((p) => p.id);
    expect(remainingIds).toContain(targetSp.spacePersonId);
    expect(remainingIds).not.toContain(sourceSp.spacePersonId);

    // The collapsed source space-person id is no longer addressable → 400 'Person not found'.
    const { status: sourceStatus, body: sourceBody } = await request(app)
      .get(`/shared-spaces/${space.id}/people/${sourceSp.spacePersonId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(sourceStatus).toBe(400);
    expect((sourceBody as { message: string }).message).toMatch(/Person not found/i);
  });

  it('refuses a same-space conflict in a view-only space with a space-named message', async () => {
    // The actor owns two PERSONAL people on two different identities, and both identities
    // also appear as separate space-people in a space the actor can only VIEW.
    //
    // Why personal refs (not space-person refs): a space-person ref only resolves when the
    // actor is owner/editor of the space (resolveRepairProfile → isRepairRole gate at
    // face-identity.repository.ts:1286). A viewer passing space-person refs would 400
    // ('not found or not accessible'), never reaching the conflict check. To exercise the
    // ForbiddenException path (the actual viewer-refusal behaviour), the actor selects refs
    // it CAN repair (its own personal people) while the blocking same-space conflict is
    // discovered by findBlockingMergeConflictScope — it groups shared_space_person by space,
    // finds two of the merged identities there, and sees the actor is not owner/editor
    // (face-identity.repository.ts:1311-1330), producing the 403 with the space name.
    const owner = await utils.userSetup(admin.accessToken, createUserDto.create('scoped-merge-owner'));
    const viewer = await utils.userSetup(admin.accessToken, createUserDto.create('scoped-merge-viewer'));

    // The space, owned by `owner`; `viewer` is added as a Viewer.
    const space = await utils.createSpace(owner.accessToken, { name: 'View Only Holidays' });
    const ownerAsset = await utils.createAsset(owner.accessToken);
    await utils.addSpaceAssets(owner.accessToken, space.id, [ownerAsset.id]);
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: viewer.userId,
      role: SharedSpaceRole.Viewer,
    });

    // Two space-people on two distinct identities in that view-only space.
    const spA = await utils.createSpacePerson(space.id, 'Alice', owner.userId, ownerAsset.id);
    const spB = await utils.createSpacePerson(space.id, 'Alice (2)', owner.userId, ownerAsset.id);
    const identityA = await giveSpacePersonAnIdentity(spA);
    const identityB = await giveSpacePersonAnIdentity(spB);

    // The viewer's own two personal people, each pinned onto one of those identities so the
    // refs the viewer selects are repairable (own personal rows) but the merge would have to
    // collapse a row in the view-only space.
    const viewerPersonA = await utils.createPerson(viewer.accessToken, { name: 'My Alice' });
    const viewerPersonB = await utils.createPerson(viewer.accessToken, { name: 'My Alice (2)' });
    const client = await utils.connectDatabase();
    await client.query(`UPDATE "person" SET "identityId" = $1 WHERE id = $2`, [identityA, viewerPersonA.id]);
    await client.query(`UPDATE "person" SET "identityId" = $1 WHERE id = $2`, [identityB, viewerPersonB.id]);

    const { status, body } = await request(app)
      .post('/people/same-person')
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .send({
        target: { type: 'person', id: viewerPersonA.id },
        sources: [{ type: 'person', id: viewerPersonB.id }],
      });

    expect(status).toBe(403);
    expect((body as { message: string }).message).toContain('View Only Holidays');
  });
});
