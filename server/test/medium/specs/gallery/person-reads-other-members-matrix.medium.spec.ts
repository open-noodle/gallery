/**
What another account can read about a person (#1317, specs/2026-11-22-cross-account-identity-joins-design.md).

Runs the real PersonService over every actor (each space role, the person's owner, a non-member, a server admin who is
not a member), each setting that changes the answer (owner opted out of sharing names, person hidden, cover photo
private) and each read (`GET /people/:id`, `GET /faces`, `GET /people/:id/thumbnail`). The expected grid comes from the
truth table below, never from the production helper. Mutation-checked once by removing the viewer projection.
*/
import { Kysely } from 'kysely';
import { AssetVisibility, SharedSpaceRole, SourceType } from 'src/enum.js';
import { GalleryPersonRepository } from 'src/gallery/repositories/gallery-person.repository.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { DB } from 'src/schema/index.js';
import { PersonService } from 'src/services/person.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

const OWNER_NAME = 'Owner private name';
const OWNER_BIRTHDAY = '1980-02-03';
const SPACE_NAME = 'Name the space shows';
const SPACE_BIRTHDAY = '1991-04-05';
const STORED_THUMBNAIL = 'upload/thumbs/stored.jpeg';

type Actor = 'person-owner' | SharedSpaceRole | 'non-member' | 'admin-non-member';
const ACTORS: Actor[] = ['person-owner', ...Object.values(SharedSpaceRole), 'non-member', 'admin-non-member'];

type Setting = { sharesNames: boolean; hidden: boolean; privateCover: boolean };
const SETTINGS: Setting[] = [false, true].flatMap((sharesNames) =>
  [false, true].flatMap((hidden) => [false, true].map((privateCover) => ({ sharesNames, hidden, privateCover }))),
);

const isSpaceMember = (actor: Actor) => (Object.values(SharedSpaceRole) as string[]).includes(actor);

type PersonRead = 'denied' | { name: string; birthDate: string | null; isFavorite: boolean; thumbnailPath: string };
type FaceRead = 'denied' | 'no-face' | { name: string; birthDate: string | null };
type ThumbnailRead = 'denied' | 'stored' | 'crop-of-shared-face';

/** The truth table. A member sees what the space publishes, and never the owner's private row. */
const expected = (actor: Actor, { sharesNames, hidden, privateCover }: Setting) => {
  if (actor === 'person-owner') {
    // An owner's hidden person resolves to the space's profile on their own reads. That predates #1317 and shows the
    // owner nothing private of anyone else, so this table records it rather than changing it here.
    const published = sharesNames ? { name: SPACE_NAME, birthDate: SPACE_BIRTHDAY } : { name: '', birthDate: null };
    const own = hidden ? published : { name: OWNER_NAME, birthDate: OWNER_BIRTHDAY };
    return {
      person: { ...own, isFavorite: true, thumbnailPath: STORED_THUMBNAIL } as PersonRead,
      face: own as FaceRead,
      thumbnail: 'stored' as ThumbnailRead,
    };
  }
  if (!isSpaceMember(actor)) {
    return { person: 'denied' as PersonRead, face: 'denied' as FaceRead, thumbnail: 'denied' as ThumbnailRead };
  }
  if (hidden) {
    return { person: 'denied' as PersonRead, face: 'no-face' as FaceRead, thumbnail: 'denied' as ThumbnailRead };
  }
  const published = sharesNames ? { name: SPACE_NAME, birthDate: SPACE_BIRTHDAY } : { name: '', birthDate: null };
  return {
    person: { ...published, isFavorite: false, thumbnailPath: '' } as PersonRead,
    face: published as FaceRead,
    thumbnail: (privateCover ? 'crop-of-shared-face' : 'stored') as ThumbnailRead,
  };
};

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

afterAll(async () => {
  await defaultDatabase.destroy();
});

const setup = () => {
  const { sut, ctx } = newMediumService(PersonService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AssetEditRepository,
      AssetRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      GalleryPersonRepository,
      PartnerRepository,
      PersonRepository,
      SharedSpaceRepository,
    ],
    mock: [JobRepository, LoggingRepository, StorageRepository],
  });
  // Serving bytes needs a storage backend; what matters here is which file the read decided to serve.
  const media = (sut as unknown as { backendMedia: Record<string, unknown> }).backendMedia;
  media.serveFromBackend = (path: string) => Promise.resolve({ stored: path });
  media.getFaceThumbnailSource = () => Promise.resolve('upload/preview.jpeg');
  media.generateFaceThumbnailResponse = (face: { id: string }) => Promise.resolve({ crop: face.id });
  return { sut, ctx };
};

type Ctx = ReturnType<typeof setup>['ctx'];

const addFace = async (ctx: Ctx, ownerId: string, personGroupId: string, identityId: string) => {
  const { asset } = await ctx.newAsset({ ownerId, visibility: AssetVisibility.Timeline });
  await ctx.newExif({ assetId: asset.id, exifImageWidth: 100, exifImageHeight: 100 });
  const { assetFace } = await ctx.newAssetFace({
    assetId: asset.id,
    personGroupId,
    sourceType: SourceType.MachineLearning,
  });
  await ctx.get(FaceIdentityRepository).linkFace({ assetFaceId: assetFace.id, identityId, source: 'owner-person' });
  return { assetId: asset.id, faceId: assetFace.id };
};

const buildWorld = async (ctx: Ctx, actor: Actor, setting: Setting) => {
  const { user: owner } = await ctx.newUser();
  const { user: creator } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: creator.id, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: creator.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Editor });
  await ctx.database
    .updateTable('shared_space_member')
    .set({ sharePersonMetadata: setting.sharesNames })
    .where('spaceId', '=', space.id)
    .where('userId', '=', owner.id)
    .execute();

  const { user: actorUser } =
    actor === 'person-owner' ? { user: owner } : await ctx.newUser({ isAdmin: actor === 'admin-non-member' });
  if (isSpaceMember(actor)) {
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: actorUser.id, role: actor as SharedSpaceRole });
  }

  const { person } = await ctx.newPerson({
    ownerId: owner.id,
    name: OWNER_NAME,
    birthDate: OWNER_BIRTHDAY,
    isFavorite: true,
    isHidden: setting.hidden,
    thumbnailPath: STORED_THUMBNAIL,
  });
  const identity = await ctx.get(FaceIdentityRepository).ensurePersonIdentity(person.personGroupId);
  const shared = await addFace(ctx, owner.id, person.personGroupId, identity.id);
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: shared.assetId, addedById: owner.id });
  const hidden = await addFace(ctx, owner.id, person.personGroupId, identity.id);
  await ctx.database
    .updateTable('person')
    .set({ faceAssetId: setting.privateCover ? hidden.faceId : shared.faceId })
    .where('personGroupId', '=', person.personGroupId)
    .execute();

  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: space.id,
      identityId: identity.id,
      representativeFaceId: shared.faceId,
      name: setting.sharesNames ? SPACE_NAME : '',
      birthDate: setting.sharesNames ? SPACE_BIRTHDAY : null,
      type: 'person',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('shared_space_person_face')
    .values({ personId: spacePerson.id, assetFaceId: shared.faceId })
    .execute();

  return {
    auth: factory.auth({
      user: { id: actorUser.id, name: actorUser.name, email: actorUser.email, isAdmin: actor === 'admin-non-member' },
    }),
    personId: person.personGroupId,
    assetId: shared.assetId,
    sharedFaceId: shared.faceId,
  };
};

const read = async <T>(call: () => Promise<T>): Promise<T | 'denied'> => {
  try {
    return await call();
  } catch {
    return 'denied';
  }
};

describe('what each account can read about a person (#1317)', () => {
  const grid: Record<string, unknown> = {};

  describe.each(ACTORS)('%s', (actor) => {
    it.each(SETTINGS)('sharesNames=$sharesNames hidden=$hidden privateCover=$privateCover', async (setting) => {
      const { sut, ctx } = setup();
      const world = await buildWorld(ctx, actor, setting);
      const before = await ctx.database
        .selectFrom('person')
        .selectAll()
        .where('personGroupId', '=', world.personId)
        .executeTakeFirstOrThrow();

      const person = await read(() => sut.getById(world.auth, world.personId));
      const faces = await read(() => sut.getFacesById(world.auth, { id: world.assetId }));
      const thumbnail = (await read(() => sut.getThumbnail(world.auth, world.personId))) as
        'denied' | { stored?: string; crop?: string };

      const actual = {
        person:
          person === 'denied'
            ? person
            : {
                name: person.name,
                birthDate: person.birthDate ?? null,
                isFavorite: person.isFavorite ?? false,
                thumbnailPath: person.thumbnailPath,
              },
        face:
          faces === 'denied'
            ? faces
            : faces.length === 0
              ? 'no-face'
              : { name: faces[0].person?.name ?? '', birthDate: faces[0].person?.birthDate ?? null },
        thumbnail:
          thumbnail === 'denied'
            ? thumbnail
            : thumbnail.crop === world.sharedFaceId
              ? 'crop-of-shared-face'
              : thumbnail.stored === STORED_THUMBNAIL
                ? 'stored'
                : 'crop-of-another-face',
      };

      expect(actual).toEqual(expected(actor, setting));
      grid[`${actor} names=${setting.sharesNames} hidden=${setting.hidden} privateCover=${setting.privateCover}`] =
        actual;

      // A read changes nothing.
      await expect(
        ctx.database.selectFrom('person').selectAll().where('personGroupId', '=', world.personId).executeTakeFirst(),
      ).resolves.toEqual(before);
    });
  });

  it('matches the recorded grid', () => {
    expect(Object.keys(grid)).toHaveLength(ACTORS.length * SETTINGS.length);
    expect(grid).toMatchSnapshot();
  });
});
