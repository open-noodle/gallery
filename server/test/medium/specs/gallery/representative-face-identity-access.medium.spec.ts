/**
The representative-face picker lists only faces the caller can read (#1317).

`GET /people/{id}/faces` lists the person's own faces plus every face bound to the person's identity. After
another account's person is joined to that identity, that account's private faces are bound to it too. They must
not reach the owner's picker, and the thumbnail and update routes must answer for them as for any face that is not
the person's, so the routes do not reveal that the face exists.

World: owner A's person P on identity I with three faces of A's (one in space S, one private on the timeline, one
in the locked folder). Member B of S has two faces bound to I: one on an asset in S, one private.
*/
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum.js';
import { SharedSpaceRole } from 'src/gallery/enum.js';
import { GalleryPersonRepository } from 'src/gallery/repositories/gallery-person.repository.js';
import { GalleryPeopleService } from 'src/gallery/services/gallery-people.service.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { DB } from 'src/schema/index.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory, newUuid } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx, sut } = newMediumService(GalleryPeopleService, {
    database: defaultDatabase,
    real: [AccessRepository, FaceIdentityRepository, GalleryPersonRepository, PersonRepository, SharedSpaceRepository],
    mock: [JobRepository, LoggingRepository],
  });
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  return { ctx, sut };
};

const authFor = (user: { id: string; name: string; email: string }, hasElevatedPermission = false) =>
  factory.auth({ user: { id: user.id, name: user.name, email: user.email }, session: { hasElevatedPermission } });

const buildWorld = async () => {
  const { ctx, sut } = setup();
  const faceIdentity = ctx.get(FaceIdentityRepository);
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });

  const { result: person } = await ctx.newPerson({ ownerId: owner.id, name: 'Sam' });
  const identity = await faceIdentity.ensurePersonIdentity(person.personGroupId);
  const { result: memberPerson } = await ctx.newPerson({ ownerId: member.id, name: 'Uncle Sam' });

  const addFace = async (input: {
    ownerId: string;
    personGroupId: string;
    visibility?: AssetVisibility;
    inSpace?: boolean;
    source: 'owner-person' | 'shared-space-evidence';
  }) => {
    const { asset } = await ctx.newAsset({
      ownerId: input.ownerId,
      visibility: input.visibility ?? AssetVisibility.Timeline,
    });
    if (input.inSpace) {
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: input.ownerId });
    }
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: input.personGroupId });
    await faceIdentity.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: input.source });
    return assetFace.id;
  };

  const ownerShared = await addFace({
    ownerId: owner.id,
    personGroupId: person.personGroupId,
    inSpace: true,
    source: 'owner-person',
  });
  const ownerPrivate = await addFace({
    ownerId: owner.id,
    personGroupId: person.personGroupId,
    source: 'owner-person',
  });
  const ownerLocked = await addFace({
    ownerId: owner.id,
    personGroupId: person.personGroupId,
    visibility: AssetVisibility.Locked,
    source: 'owner-person',
  });
  const memberShared = await addFace({
    ownerId: member.id,
    personGroupId: memberPerson.personGroupId,
    inSpace: true,
    source: 'shared-space-evidence',
  });
  const memberPrivate = await addFace({
    ownerId: member.id,
    personGroupId: memberPerson.personGroupId,
    source: 'shared-space-evidence',
  });

  // The space person face matching makes for the identity: another member reads the person only through it.
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({ spaceId: space.id, identityId: identity.id, representativeFaceId: ownerShared, type: 'person' })
    .returning('id')
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('shared_space_person_face')
    .values([ownerShared, memberShared].map((assetFaceId) => ({ personId: spacePerson.id, assetFaceId })))
    .execute();

  return { sut, owner, member, person, faces: { ownerShared, ownerPrivate, ownerLocked, memberShared, memberPrivate } };
};

const listIds = async (sut: GalleryPeopleService, auth: ReturnType<typeof authFor>, personId: string) => {
  const { faces } = await sut.getFacesForPicker(auth, personId, { page: 1, size: 100 });
  return faces.map(({ id }) => id).toSorted();
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

afterAll(async () => {
  await defaultDatabase.destroy();
});

describe('representative face picker access (#1317)', () => {
  it('lists the owner their own faces and readable identity faces, not another account private face', async () => {
    const { sut, owner, person, faces } = await buildWorld();

    await expect(listIds(sut, authFor(owner), person.personGroupId)).resolves.toEqual(
      [faces.ownerShared, faces.ownerPrivate, faces.memberShared].toSorted(),
    );
  });

  it('lists the owner their locked face only with an elevated session', async () => {
    const { sut, owner, person, faces } = await buildWorld();

    await expect(listIds(sut, authFor(owner, true), person.personGroupId)).resolves.toEqual(
      [faces.ownerShared, faces.ownerPrivate, faces.ownerLocked, faces.memberShared].toSorted(),
    );
  });

  it('answers a private identity face on the thumbnail route like an unrelated id', async () => {
    const { sut, owner, person, faces } = await buildWorld();

    await expect(
      sut.getFaceThumbnail(authFor(owner), person.personGroupId, faces.memberPrivate),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(sut.getFaceThumbnail(authFor(owner), person.personGroupId, newUuid())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses a private identity face as the representative face like a face of another person', async () => {
    const { sut, owner, person, faces } = await buildWorld();

    await expect(
      sut.updateRepresentativeFace(authFor(owner), person.personGroupId, { assetFaceId: faces.memberPrivate }),
    ).rejects.toThrow(new BadRequestException('Representative face must belong to the person'));
  });

  it('keeps the space member to faces reachable through the space', async () => {
    const { sut, member, person, faces } = await buildWorld();

    await expect(listIds(sut, authFor(member), person.personGroupId)).resolves.toEqual(
      [faces.ownerShared, faces.memberShared].toSorted(),
    );
  });
});
