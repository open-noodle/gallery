/**
`POST /faces` attaches a face only to the caller's own person: ACTOR matrix (CLAUDE.md rule 7).

Upstream's `PersonService.createFace` requires the person to be the caller's own (`requirePersonAccess` with
`ownerId: auth.user.id`). The fork gated it on `Permission.PersonRead` instead, which the fork widens to every space
member who can see one of the person's faces, Viewers included. So any member could draw a face on their own photo and
attach it to another member's personal person: a manual face, an identity link and a cleared "not this person" verdict
in that member's library, which the member cannot delete (FaceDelete checks the asset's owner). The space face editor
(`SharedSpaceService.createSpaceAssetFace`) never writes a personal person for exactly this reason.

The gate under test: the person must be the caller's own. Each cell draws a face on the actor's OWN photo (so the asset
gate always passes) and names the person of `carol`, a space Editor whose face of that person is on a space photo. The
database is read afterwards. A last case keeps the by-design power (#992, specs/2026-08-14-space-editor-asset-
permissions-design.md): an Editor may still draw a face on a member's photo for the Editor's own person.

Mutation-checked: with createFace gated on PersonRead again, the space owner, editor and viewer cells fail.
*/
import { Kysely } from 'kysely';
import { SharedSpaceRole } from 'src/gallery/enum.js';
import { GalleryAssetRepository } from 'src/gallery/repositories/gallery-asset.repository.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { PersonService } from 'src/services/person.service.js';
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

/** The rule: only the person's owner may attach a face to it. */
const MAY_ATTACH: Record<Actor, boolean> = {
  'person owner': true,
  'space owner': false,
  'space editor': false,
  'space viewer': false,
  'non-member': false,
  'admin non-member': false,
};

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      AssetRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      FacePersonVerdictRepository,
      GalleryAssetRepository,
      PersonRepository,
      SharedSpaceRepository,
      SystemMetadataRepository,
      UserRepository,
    ],
    mock: [EventRepository, JobRepository, LoggingRepository, StorageRepository],
  });
  ctx.getMock(EventRepository).emit.mockResolvedValue();
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  ctx.getMock(JobRepository).queueAll.mockResolvedValue();
  return ctx;
};

type Ctx = ReturnType<typeof setup>;

const newPhoto = async (ctx: Ctx, ownerId: string) => {
  const { asset } = await ctx.newAsset({ ownerId, width: 200, height: 200 });
  await ctx.newExif({ assetId: asset.id, exifImageHeight: 200, exifImageWidth: 200 });
  return asset;
};

const faceBox = { imageWidth: 200, imageHeight: 200, x: 10, y: 10, width: 50, height: 50 };

/** A space where `carol` (Editor) has a person whose visible face is on one of her space photos. */
const buildWorld = async (ctx: Ctx, actorLabel: Actor) => {
  const { user: host } = await ctx.newUser();
  const { user: carol } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: host.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: host.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: carol.id, role: SharedSpaceRole.Editor });

  const carolPhoto = await newPhoto(ctx, carol.id);
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: carolPhoto.id, addedById: carol.id });
  const { person } = await ctx.newPerson({ ownerId: carol.id, name: 'Carol person' });
  const { result: coverFaceId } = await ctx.newAssetFace({
    assetId: carolPhoto.id,
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
      actor = carol;
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

  const actorPhoto = await newPhoto(ctx, actor.id);
  return { space, carol, carolPhoto, person, coverFaceId, actor, actorPhoto };
};

type World = Awaited<ReturnType<typeof buildWorld>>;

/** What the person holds afterwards: its faces on the actor's photo, and its cover face. */
const personState = async (ctx: Ctx, { person, actorPhoto }: World) => {
  const faces = await ctx.database
    .selectFrom('asset_face')
    .select('id')
    .where('personGroupId', '=', person.personGroupId)
    .where('assetId', '=', actorPhoto.id)
    .execute();
  const { faceAssetId } = await ctx.database
    .selectFrom('person')
    .select('faceAssetId')
    .where('personGroupId', '=', person.personGroupId)
    .executeTakeFirstOrThrow();
  return { facesOnActorPhoto: faces.length, faceAssetId };
};

const grid: Partial<Record<Actor, string>> = {};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe("POST /faces naming another member's person", () => {
  it.each(ACTORS)('actor: %s', async (actorLabel) => {
    const ctx = setup();
    const world = await buildWorld(ctx, actorLabel);
    const { actor, actorPhoto, person, coverFaceId } = world;
    await expect(personState(ctx, world)).resolves.toEqual({ facesOnActorPhoto: 0, faceAssetId: coverFaceId });

    const outcome = await ctx
      .getService(PersonService)
      .createFace(factory.auth({ user: { id: actor.id, isAdmin: actor.isAdmin } }), {
        ...faceBox,
        assetId: actorPhoto.id,
        personId: person.personGroupId,
      })
      .then(() => 'created')
      .catch((error: Error) => `refused: ${error.message}`);

    const allowed = MAY_ATTACH[actorLabel];
    expect(outcome.startsWith(allowed ? 'created' : 'refused')).toBe(true);
    // A refused request writes nothing; the cover face is the person's own either way.
    await expect(personState(ctx, world)).resolves.toEqual({
      facesOnActorPhoto: allowed ? 1 : 0,
      faceAssetId: coverFaceId,
    });

    grid[actorLabel] = outcome;
  });

  it("still lets a space editor draw a face on a member's photo for the editor's own person", async () => {
    const ctx = setup();
    const { carolPhoto, space } = await buildWorld(ctx, 'person owner');
    const { user: editor } = await ctx.newUser();
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: SharedSpaceRole.Editor });
    const { person: own } = await ctx.newPerson({ ownerId: editor.id });

    await ctx.getService(PersonService).createFace(factory.auth({ user: { id: editor.id } }), {
      ...faceBox,
      assetId: carolPhoto.id,
      personId: own.personGroupId,
    });

    const faces = await ctx.database
      .selectFrom('asset_face')
      .select('id')
      .where('personGroupId', '=', own.personGroupId)
      .where('assetId', '=', carolPhoto.id)
      .execute();
    expect(faces).toHaveLength(1);
  });

  it('outcome grid', () => {
    expect(Object.keys(grid).toSorted()).toEqual([...ACTORS].toSorted());
    expect(grid).toMatchSnapshot();
  });
});
