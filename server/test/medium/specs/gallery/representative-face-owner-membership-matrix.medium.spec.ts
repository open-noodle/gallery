/**
A space Editor may change a person's cover face only when the person's owner is in that space: ACTOR × OWNER
MEMBERSHIP matrix (CLAUDE.md rule 7).

`GalleryPeopleService.updateRepresentativeFace` (`PUT /people/{id}/representative-face`) writes the owner's GLOBAL
`person.faceAssetId`. A non-owner passes when the person has a visible face on an asset reachable in a space where the
caller is Owner/Editor (`galleryPerson.checkSharedSpaceEditAccess`). The owner's photos can reach a space without the
owner ever joining it: someone with edit rights on the owner's album links it in. The rest of the space face code
refuses to touch an owner's layer unless that owner is a member (`SharedSpaceService.linkFaceToSpacePerson`,
`createSpaceAssetFace`); this route did not.

The gate under test: the space that grants the edit must also have the person's owner as a member. In every cell the
owner's album is linked into the space by `linker`, an album Editor; the owner either is a space Viewer or not a member
at all. The cover face is read from the database afterwards.

Mutation-checked: without the owner-membership condition, the space owner and editor cells with a non-member owner
fail.
*/
import { Kysely } from 'kysely';
import { AlbumUserRole } from 'src/enum.js';
import { SharedSpaceRole } from 'src/gallery/enum.js';
import { GalleryPeopleService } from 'src/gallery/services/gallery-people.service.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumUserRepository } from 'src/repositories/album-user.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

const ACTORS = [
  'person owner',
  'space owner',
  'space editor',
  'space viewer',
  'non-member',
  'admin non-member',
] as const;
type Actor = (typeof ACTORS)[number];

const OWNER_MEMBERSHIP = ['owner is a member', 'owner is not a member'] as const;
type OwnerMembership = (typeof OWNER_MEMBERSHIP)[number];

/** The rule: the owner always may; a space Owner/Editor only through a space the person's owner belongs to. */
const mayChange = (actor: Actor, membership: OwnerMembership) =>
  actor === 'person owner' ||
  ((actor === 'space owner' || actor === 'space editor') && membership === 'owner is a member');

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      AlbumUserRepository,
      AssetRepository,
      FaceIdentityRepository,
      PersonRepository,
      SharedSpaceRepository,
      UserRepository,
    ],
    mock: [JobRepository, LoggingRepository],
  });
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  return ctx;
};

type Ctx = ReturnType<typeof setup>;

const buildWorld = async (ctx: Ctx, actorLabel: Actor, membership: OwnerMembership) => {
  const { user: host } = await ctx.newUser();
  const { user: owner } = await ctx.newUser();
  const { user: linker } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: host.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: host.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: linker.id, role: SharedSpaceRole.Editor });
  if (membership === 'owner is a member') {
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Viewer });
  }

  // The owner's photo reaches the space only through the owner's album, linked in by `linker`.
  const { asset } = await ctx.newAsset({ ownerId: owner.id });
  const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'owner album' }, [asset.id]);
  await ctx.newAlbumUser({ albumId: album.id, userId: linker.id, role: AlbumUserRole.Editor });
  await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: linker.id });

  const { person } = await ctx.newPerson({ ownerId: owner.id, name: 'Owner person' });
  const { result: coverFaceId } = await ctx.newAssetFace({
    assetId: asset.id,
    personGroupId: person.personGroupId,
    isVisible: true,
  });
  const { result: otherFaceId } = await ctx.newAssetFace({
    assetId: asset.id,
    personGroupId: person.personGroupId,
    isVisible: true,
  });
  await ctx.database
    .updateTable('person')
    .set({ faceAssetId: coverFaceId })
    .where('personGroupId', '=', person.personGroupId)
    .execute();

  let actor: { id: string; isAdmin: boolean };
  switch (actorLabel) {
    case 'person owner': {
      actor = owner;
      break;
    }
    case 'space owner': {
      actor = host;
      break;
    }
    case 'space editor':
    case 'space viewer': {
      ({ user: actor } = await ctx.newUser());
      const role = actorLabel === 'space editor' ? SharedSpaceRole.Editor : SharedSpaceRole.Viewer;
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: actor.id, role });
      break;
    }
    case 'non-member': {
      ({ user: actor } = await ctx.newUser());
      break;
    }
    case 'admin non-member': {
      ({ user: actor } = await ctx.newUser({ isAdmin: true }));
      break;
    }
  }

  return { person, coverFaceId, otherFaceId, actor };
};

const coverOf = async (ctx: Ctx, personGroupId: string) => {
  const { faceAssetId } = await ctx.database
    .selectFrom('person')
    .select('faceAssetId')
    .where('personGroupId', '=', personGroupId)
    .executeTakeFirstOrThrow();
  return faceAssetId;
};

const grid: Partial<Record<Actor, Partial<Record<OwnerMembership, string>>>> = {};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('changing the cover face of a person reachable through a linked album', () => {
  describe.each(OWNER_MEMBERSHIP)('%s', (membership) => {
    it.each(ACTORS)('actor: %s', async (actorLabel) => {
      const ctx = setup();
      const { person, coverFaceId, otherFaceId, actor } = await buildWorld(ctx, actorLabel, membership);
      await expect(coverOf(ctx, person.personGroupId)).resolves.toBe(coverFaceId);

      const outcome = await ctx
        .getService(GalleryPeopleService)
        .updateRepresentativeFace(
          factory.auth({ user: { id: actor.id, isAdmin: actor.isAdmin } }),
          person.personGroupId,
          {
            assetFaceId: otherFaceId,
          },
        )
        .then(() => 'changed')
        .catch((error: Error) => `refused: ${error.message}`);

      const allowed = mayChange(actorLabel, membership);
      expect(outcome.startsWith(allowed ? 'changed' : 'refused')).toBe(true);
      await expect(coverOf(ctx, person.personGroupId)).resolves.toBe(allowed ? otherFaceId : coverFaceId);

      grid[actorLabel] ??= {};
      grid[actorLabel][membership] = outcome;
    });
  });

  it('outcome grid', () => {
    expect(Object.keys(grid).toSorted()).toEqual([...ACTORS].toSorted());
    expect(grid).toMatchSnapshot();
  });
});
