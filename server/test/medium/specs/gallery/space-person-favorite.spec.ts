/**
Favoriting a person in a shared space (specs/2026-11-20-favorite-space-people-design.md): ROLE x OWNERSHIP matrix.

The favorite is the caller's own preference, so every member may set it whatever their role, and nobody else may.
It lives on the caller's own linked person when they have one (person."isFavorite"), else in the fallback table
(face_identity_favorite); the owned person wins on read and a link event drops the fallback row.

The expectations come from the truth table below, not from the production code. Every denied cell also asserts
the database afterwards, so a refused request leaves no partial write. Mutation-checked: with the membership
gate removed from GalleryPeopleService.setSpacePersonFavorite the non-member cells fail.
*/
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { SharedSpaceRole } from 'src/enum.js';
import { GalleryPersonRepository } from 'src/gallery/repositories/gallery-person.repository.js';
import { GalleryPeopleService } from 'src/gallery/services/gallery-people.service.js';
import { moveIdentityFavorites } from 'src/gallery/utils/identity-favorite.js';
import { setPersonIdentity } from 'src/gallery/utils/person-sidecar.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { DB } from 'src/schema/index.js';
import { SharedSpaceService } from 'src/services/shared-space.service.js';
import { MediumTestContext, newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const setup = () => {
  const { sut, ctx } = newMediumService(SharedSpaceService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AssetRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      GalleryPersonRepository,
      PersonRepository,
      SharedSpaceRepository,
      SystemMetadataRepository,
    ],
    mock: [JobRepository, LoggingRepository],
  });
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  ctx.getMock(JobRepository).queueAll.mockResolvedValue();
  return { spaces: sut, people: ctx.getService(GalleryPeopleService), ctx };
};

const authOf = (user: { id: string; email: string }, isAdmin = false) =>
  factory.auth({ user: { id: user.id, email: user.email, isAdmin } });

type Actor = 'owner' | 'editor' | 'viewer' | 'non-member' | 'admin non-member';

// The truth table: who may favorite or unfavorite. Written out, not derived from the service.
const MAY_FAVORITE: Record<Actor, boolean> = {
  owner: true,
  editor: true,
  viewer: true,
  'non-member': false,
  'admin non-member': false,
};

const newUser = async (ctx: MediumTestContext, dto: Parameters<MediumTestContext['newUser']>[0] = {}) => {
  const { user } = await ctx.newUser(dto);
  return user;
};

const buildWorld = async (ctx: MediumTestContext) => {
  const host = await newUser(ctx);
  const users = {
    owner: host,
    editor: await newUser(ctx),
    viewer: await newUser(ctx),
    'non-member': await newUser(ctx),
    'admin non-member': await newUser(ctx, { isAdmin: true }),
  };

  const { space } = await ctx.newSharedSpace({ createdById: host.id, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: users.owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: users.editor.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: users.viewer.id, role: SharedSpaceRole.Viewer });

  const identity = await ctx.database
    .insertInto('face_identity')
    .values({ type: 'person' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const spacePerson = await ctx
    .get(SharedSpaceRepository)
    .createPerson({ spaceId: space.id, name: 'Alice', identityId: identity.id });

  return { users, space, identityId: identity.id, spacePersonId: spacePerson.id };
};

type World = Awaited<ReturnType<typeof buildWorld>>;

const sideRows = (ctx: MediumTestContext, identityId: string) =>
  ctx.database.selectFrom('face_identity_favorite').selectAll().where('identityId', '=', identityId).execute();

const sideUserIds = async (ctx: MediumTestContext, identityId: string) => {
  const rows = await sideRows(ctx, identityId);
  return rows.map((row) => row.userId);
};

const personFlag = async (ctx: MediumTestContext, personGroupId: string) => {
  const row = await ctx.database
    .selectFrom('person')
    .select('isFavorite')
    .where('personGroupId', '=', personGroupId)
    .executeTakeFirstOrThrow();
  return row.isFavorite;
};

const viewerSees = async (
  spaces: SharedSpaceService,
  user: { id: string; email: string },
  world: Pick<World, 'space' | 'spacePersonId'>,
) => {
  const person = await spaces.getSpacePerson(authOf(user), world.space.id, world.spacePersonId);
  return person.isFavorite;
};

const ownPerson = async (ctx: MediumTestContext, ownerId: string, identityId: string) => {
  const { personGroupId } = await ctx
    .get(GalleryPersonRepository)
    .getOrCreateOwnerPersonForIdentity({ ownerId, identityId, name: 'Alice', type: 'person' });
  return personGroupId;
};

describe('favorite a space person: role x ownership matrix', () => {
  const ACTORS = Object.keys(MAY_FAVORITE) as Actor[];

  describe.each([false, true])('actor owns a person linked to the identity: %s', (owns) => {
    it.each(ACTORS)('%s: favorite then unfavorite', async (actor) => {
      const { people, spaces, ctx } = setup();
      const world = await buildWorld(ctx);
      const user = world.users[actor];
      const auth = authOf(user, actor === 'admin non-member');
      const personGroupId = owns ? await ownPerson(ctx, user.id, world.identityId) : undefined;

      const favorite = people.setSpacePersonFavorite(auth, world.space.id, world.spacePersonId, true);
      if (!MAY_FAVORITE[actor]) {
        await expect(favorite).rejects.toBeInstanceOf(ForbiddenException);
        expect(await sideRows(ctx, world.identityId)).toEqual([]);
        if (personGroupId) {
          expect(await personFlag(ctx, personGroupId)).toBe(false);
        }
        return;
      }

      await favorite;
      expect(await viewerSees(spaces, user, world)).toBe(true);
      // never in both places
      expect(await sideUserIds(ctx, world.identityId)).toHaveLength(owns ? 0 : 1);
      if (personGroupId) {
        expect(await personFlag(ctx, personGroupId)).toBe(true);
      }

      await people.setSpacePersonFavorite(auth, world.space.id, world.spacePersonId, false);
      expect(await viewerSees(spaces, user, world)).toBe(false);
      expect(await sideRows(ctx, world.identityId)).toEqual([]);
      if (personGroupId) {
        expect(await personFlag(ctx, personGroupId)).toBe(false);
      }
    });
  });

  it('a denied request is a no-op for unfavorite too', async () => {
    const { people, ctx } = setup();
    const world = await buildWorld(ctx);
    await people.setSpacePersonFavorite(authOf(world.users.viewer), world.space.id, world.spacePersonId, true);

    await expect(
      people.setSpacePersonFavorite(authOf(world.users['non-member']), world.space.id, world.spacePersonId, false),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await sideUserIds(ctx, world.identityId)).toEqual([world.users.viewer.id]);
  });

  it('snapshots the outcome grid', async () => {
    const grid: Record<string, string> = {};
    for (const actor of ACTORS) {
      const { people, ctx } = setup();
      const world = await buildWorld(ctx);
      const user = world.users[actor];
      try {
        await people.setSpacePersonFavorite(
          authOf(user, actor === 'admin non-member'),
          world.space.id,
          world.spacePersonId,
          true,
        );
        grid[actor] = 'allowed';
      } catch (error) {
        grid[actor] = (error as Error).constructor.name;
      }
    }

    expect(grid).toEqual({
      owner: 'allowed',
      editor: 'allowed',
      viewer: 'allowed',
      'non-member': 'ForbiddenException',
      'admin non-member': 'ForbiddenException',
    });
  });
});

describe('favorite a space person: targets and scoping', () => {
  it('refuses a person from another space and a person without an identity', async () => {
    const { people, ctx } = setup();
    const world = await buildWorld(ctx);
    const other = await buildWorld(ctx);
    const noIdentity = await ctx.get(SharedSpaceRepository).createPerson({ spaceId: world.space.id, name: 'Legacy' });
    const auth = authOf(world.users.owner);

    await expect(people.setSpacePersonFavorite(auth, world.space.id, other.spacePersonId, true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(people.setSpacePersonFavorite(auth, world.space.id, noIdentity.id, true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await sideRows(ctx, world.identityId)).toEqual([]);
    expect(await sideRows(ctx, other.identityId)).toEqual([]);
  });

  it("one member's favorite does not change another member's view", async () => {
    const { people, spaces, ctx } = setup();
    const world = await buildWorld(ctx);
    await people.setSpacePersonFavorite(authOf(world.users.editor), world.space.id, world.spacePersonId, true);

    expect(await viewerSees(spaces, world.users.editor, world)).toBe(true);
    expect(await viewerSees(spaces, world.users.viewer, world)).toBe(false);
    expect(await viewerSees(spaces, world.users.owner, world)).toBe(false);
  });

  it('pins a favorite first in the space people list, for the favoriting member only', async () => {
    const { people, ctx } = setup();
    const world = await buildWorld(ctx);
    const repo = ctx.get(SharedSpaceRepository);
    const second = await ctx.database
      .insertInto('face_identity')
      .values({ type: 'person' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const zed = await repo.createPerson({ spaceId: world.space.id, name: 'Zed', identityId: second.id });

    for (const personId of [world.spacePersonId, zed.id]) {
      const { asset } = await ctx.newAsset({ ownerId: world.users.owner.id });
      await ctx.newSharedSpaceAsset({ spaceId: world.space.id, assetId: asset.id, addedById: world.users.owner.id });
      const { result: faceId } = await ctx.newAssetFace({ assetId: asset.id });
      await repo.addPersonFaces([{ personId, assetFaceId: faceId }], { skipRecount: true });
    }

    await people.setSpacePersonFavorite(authOf(world.users.viewer), world.space.id, zed.id, true);

    const names = async (userId: string) => {
      const rows = await repo.getPersonsBySpaceId(world.space.id, { petsEnabled: true, viewerUserId: userId });
      return rows.map((person) => person.name);
    };
    expect(await names(world.users.viewer.id)).toEqual(['Zed', 'Alice']);
    expect(await names(world.users.editor.id)).toEqual(['Alice', 'Zed']);
  });
});

describe('favorite a space person: owned person wins, link and merge cleanups', () => {
  it('reads the owned person flag over a stale fallback row', async () => {
    const { spaces, ctx } = setup();
    const world = await buildWorld(ctx);
    const user = world.users.viewer;
    await ownPerson(ctx, user.id, world.identityId);
    await ctx.database
      .insertInto('face_identity_favorite')
      .values({ userId: user.id, identityId: world.identityId })
      .execute();

    expect(await viewerSees(spaces, user, world)).toBe(false);
  });

  it('linking a person drops the fallback row and carries the favorite over', async () => {
    const { people, spaces, ctx } = setup();
    const world = await buildWorld(ctx);
    const user = world.users.viewer;
    await people.setSpacePersonFavorite(authOf(user), world.space.id, world.spacePersonId, true);
    expect(await sideRows(ctx, world.identityId)).toHaveLength(1);

    const personGroupId = await ownPerson(ctx, user.id, world.identityId);

    expect(await sideRows(ctx, world.identityId)).toEqual([]);
    expect(await personFlag(ctx, personGroupId)).toBe(true);
    expect(await viewerSees(spaces, user, world)).toBe(true);
  });

  it('linking leaves another user fallback row alone', async () => {
    const { people, ctx } = setup();
    const world = await buildWorld(ctx);
    await people.setSpacePersonFavorite(authOf(world.users.editor), world.space.id, world.spacePersonId, true);

    await ownPerson(ctx, world.users.viewer.id, world.identityId);

    expect(await sideUserIds(ctx, world.identityId)).toEqual([world.users.editor.id]);
  });

  it('linking an existing person through setPersonIdentity reconciles too', async () => {
    const { people, ctx } = setup();
    const world = await buildWorld(ctx);
    const user = world.users.viewer;
    await people.setSpacePersonFavorite(authOf(user), world.space.id, world.spacePersonId, true);
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });

    await setPersonIdentity(ctx.database, person.personGroupId, world.identityId);

    expect(await sideRows(ctx, world.identityId)).toEqual([]);
    expect(await personFlag(ctx, person.personGroupId)).toBe(true);
  });

  it('merging identities moves fallback rows to the survivor without duplicates', async () => {
    const { ctx } = setup();
    const world = await buildWorld(ctx);
    const insertIdentity = () =>
      ctx.database.insertInto('face_identity').values({ type: 'person' }).returning('id').executeTakeFirstOrThrow();
    const sourceA = await insertIdentity();
    const sourceB = await insertIdentity();
    const { viewer, editor } = world.users;
    await ctx.database
      .insertInto('face_identity_favorite')
      .values([
        { userId: viewer.id, identityId: sourceA.id },
        { userId: viewer.id, identityId: sourceB.id },
        { userId: viewer.id, identityId: world.identityId },
        { userId: editor.id, identityId: sourceA.id },
      ])
      .execute();

    await moveIdentityFavorites(ctx.database, [sourceA.id, sourceB.id], world.identityId);

    const rows = await ctx.database
      .selectFrom('face_identity_favorite')
      .selectAll()
      .where('userId', 'in', [viewer.id, editor.id])
      .execute();
    expect(rows.map((row) => `${row.userId}:${row.identityId}`).toSorted()).toEqual(
      [`${viewer.id}:${world.identityId}`, `${editor.id}:${world.identityId}`].toSorted(),
    );
  });

  it('deleting the identity or the user removes the fallback rows', async () => {
    const { people, ctx } = setup();
    const world = await buildWorld(ctx);
    await people.setSpacePersonFavorite(authOf(world.users.viewer), world.space.id, world.spacePersonId, true);
    await people.setSpacePersonFavorite(authOf(world.users.editor), world.space.id, world.spacePersonId, true);

    await ctx.database.deleteFrom('user').where('id', '=', world.users.editor.id).execute();
    expect(await sideUserIds(ctx, world.identityId)).toEqual([world.users.viewer.id]);

    await ctx.database.deleteFrom('face_identity').where('id', '=', world.identityId).execute();
    expect(await sideRows(ctx, world.identityId)).toEqual([]);
  });
});
