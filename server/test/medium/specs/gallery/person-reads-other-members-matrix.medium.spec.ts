/**
What another account can read about a person (#1317, specs/2026-11-22-cross-account-identity-joins-design.md).

Runs the real PersonService and GalleryPeopleService over every actor (the person's owner, each space role, a
non-member, a server admin who is not a member, a partner the owner shares with, and a member of a shared album holding
the photo), each setting that changes the answer, and each read: `GET /people/:id`, `GET /faces`,
`GET /people/:id/thumbnail`, `GET /people/:id/faces` (the picker), `GET /people/:id/faces/:faceId/thumbnail` and
`GET /people/:id/statistics`, and one write, `PUT /people/:id/representative-face`. The settings are: the owner hid the person, what the space shows for the person (a named
profile, an unnamed one, or none because an editor hid it there), whether the space runs face recognition (it changes
nothing: a space keeps its people when it is turned off), and whether the person's cover photo is one the space cannot
see. The expected grid comes from the truth table below, never from the
production helper. Mutation-checked once by removing the viewer checks.
*/
import { Kysely } from 'kysely';
import { AssetVisibility, SharedSpaceRole, SourceType } from 'src/enum.js';
import { GalleryPersonRepository } from 'src/gallery/repositories/gallery-person.repository.js';
import { GalleryPeopleService } from 'src/gallery/services/gallery-people.service.js';
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

type Actor = 'person-owner' | SharedSpaceRole | 'non-member' | 'admin-non-member' | 'partner' | 'album-member';
const ACTORS: Actor[] = [
  'person-owner',
  ...Object.values(SharedSpaceRole),
  'non-member',
  'admin-non-member',
  'partner',
  'album-member',
];

type SpaceProfile = 'named' | 'unnamed' | 'hidden-in-space';
type Setting = { hidden: boolean; spaceProfile: SpaceProfile; recognition: boolean; privateCover: boolean };
const SETTINGS: Setting[] = [false, true].flatMap((hidden) =>
  (['named', 'unnamed', 'hidden-in-space'] as SpaceProfile[]).flatMap((spaceProfile) =>
    [true, false].flatMap((recognition) =>
      [false, true].map((privateCover) => ({ hidden, spaceProfile, recognition, privateCover })),
    ),
  ),
);

const isSpaceMember = (actor: Actor) => (Object.values(SharedSpaceRole) as string[]).includes(actor);

type PersonRead =
  | 'denied'
  | { name: string; birthDate: string | null; isFavorite: boolean; thumbnailPath: string; opensSpaceProfile: boolean };
type FaceRead = 'denied' | 'no-face' | 'no-person' | { name: string; birthDate: string | null };
type ThumbnailRead = 'denied' | 'stored' | 'crop-of-shared-face';
type PickerRead = 'denied' | 'shared-face-only' | 'every-face';
type FaceThumbnailRead = 'denied' | 'served';
type StatisticsRead = 'denied' | { assets: number };
type CoverWrite = 'denied' | { name: string; birthDate: string | null; isFavorite: boolean; thumbnailPath: string };
type Reads = {
  person: PersonRead;
  face: FaceRead;
  thumbnail: ThumbnailRead;
  picker: PickerRead;
  faceThumbnail: FaceThumbnailRead;
  statistics: StatisticsRead;
  /** `PUT /people/:id/representative-face` with the shared face: what it answers, after checking the write itself. */
  coverWrite: CoverWrite;
};

const DENIED: Reads = {
  person: 'denied',
  face: 'denied',
  thumbnail: 'denied',
  picker: 'denied',
  faceThumbnail: 'denied',
  statistics: 'denied',
  coverWrite: 'denied',
};

/**
The truth table. A member reads a person only through a profile the space shows, and then sees what that profile
shows, never the owner's private row. Partners and shared album members keep #796's behaviour: the photo's faces carry
the owner's name, and the person itself stays closed to them.
*/
const expected = (actor: Actor, { hidden, spaceProfile, privateCover }: Setting): Reads => {
  // Turning face recognition off keeps a space's people, and the asset viewer still shows them (AssetService.get), so
  // every read here does too.
  const shown = spaceProfile !== 'hidden-in-space';
  const published =
    shown && spaceProfile === 'named' ? { name: SPACE_NAME, birthDate: SPACE_BIRTHDAY } : { name: '', birthDate: null };
  if (actor === 'person-owner') {
    // The owner reads their own row. An owner's hidden person resolves to the space's profile on their own reads
    // when the space keeps one visible, whether or not the space runs recognition, and to their own row otherwise.
    // That predates #1317 and shows the owner nothing private of anyone else.
    const ownRow = { name: OWNER_NAME, birthDate: OWNER_BIRTHDAY };
    const spaceRow =
      spaceProfile === 'named' ? { name: SPACE_NAME, birthDate: SPACE_BIRTHDAY } : { name: '', birthDate: null };
    const own = hidden && spaceProfile !== 'hidden-in-space' ? spaceRow : ownRow;
    return {
      person: { ...own, isFavorite: true, thumbnailPath: STORED_THUMBNAIL, opensSpaceProfile: false },
      face: own,
      thumbnail: 'stored',
      picker: 'every-face',
      faceThumbnail: 'served',
      statistics: { assets: 2 },
      // The write answers with the owner's own row as stored.
      coverWrite: { ...ownRow, isFavorite: true, thumbnailPath: STORED_THUMBNAIL },
    };
  }
  if (actor === 'partner' || actor === 'album-member') {
    return { ...DENIED, face: hidden ? 'no-face' : { name: OWNER_NAME, birthDate: OWNER_BIRTHDAY } };
  }
  if (!isSpaceMember(actor)) {
    return DENIED;
  }
  if (hidden) {
    return { ...DENIED, face: 'no-face' };
  }
  if (!shown) {
    // The face stays, as a face nobody is recognised on: the person's id would lead only to refused reads.
    return { ...DENIED, face: 'no-person' };
  }
  return {
    person: { ...published, isFavorite: false, thumbnailPath: '', opensSpaceProfile: true },
    face: published,
    thumbnail: privateCover ? 'crop-of-shared-face' : 'stored',
    picker: 'shared-face-only',
    faceThumbnail: 'served',
    statistics: { assets: 1 },
    // Only a space owner or editor may change the cover, and then gets back what the space shows, as from a read.
    coverWrite: actor === SharedSpaceRole.Viewer ? 'denied' : { ...published, isFavorite: false, thumbnailPath: '' },
  };
};

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

afterAll(async () => {
  await defaultDatabase.destroy();
});

const stubMedia = (service: unknown) => {
  // Serving bytes needs a storage backend; what matters here is which file the read decided to serve.
  const media = (service as { backendMedia: Record<string, unknown> }).backendMedia;
  media.serveFromBackend = (path: string) => Promise.resolve({ stored: path });
  media.getFaceThumbnailSource = () => Promise.resolve('upload/preview.jpeg');
  media.generateFaceThumbnailResponse = (face: { id: string }) => Promise.resolve({ crop: face.id });
};

const setup = () => {
  const real = [
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
  ];
  const mock = [JobRepository, LoggingRepository, StorageRepository];
  const { sut, ctx } = newMediumService(PersonService, { database: defaultDatabase, real, mock });
  const { sut: people, ctx: peopleCtx } = newMediumService(GalleryPeopleService, {
    database: defaultDatabase,
    real,
    mock,
  });
  // A cover change queues a thumbnail job.
  peopleCtx.getMock(JobRepository).queue.mockResolvedValue();
  stubMedia(sut);
  stubMedia(people);
  return { sut, people, ctx };
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
  const { space } = await ctx.newSharedSpace({
    createdById: creator.id,
    faceRecognitionEnabled: setting.recognition,
  });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: creator.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Editor });

  const { user: actorUser } =
    actor === 'person-owner' ? { user: owner } : await ctx.newUser({ isAdmin: actor === 'admin-non-member' });
  if (isSpaceMember(actor)) {
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: actorUser.id, role: actor as SharedSpaceRole });
  }
  if (actor === 'partner') {
    await ctx.newPartner({ sharedById: owner.id, sharedWithId: actorUser.id, inTimeline: true });
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
  if (actor === 'album-member') {
    const { album } = await ctx.newAlbum({ ownerId: owner.id }, [shared.assetId]);
    await ctx.newAlbumUser({ albumId: album.id, userId: actorUser.id });
  }
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
      name: setting.spaceProfile === 'named' ? SPACE_NAME : '',
      birthDate: setting.spaceProfile === 'named' ? SPACE_BIRTHDAY : null,
      isHidden: setting.spaceProfile === 'hidden-in-space',
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
    spaceId: space.id,
    spacePersonId: spacePerson.id,
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
    it.each(SETTINGS)(
      'hidden=$hidden space=$spaceProfile recognition=$recognition privateCover=$privateCover',
      async (setting) => {
        const { sut, people, ctx } = setup();
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
        const picker = await read(() => people.getFacesForPicker(world.auth, world.personId, { page: 1, size: 10 }));
        const faceThumbnail = await read(() => people.getFaceThumbnail(world.auth, world.personId, world.sharedFaceId));
        const statistics = await read(() => sut.getStatistics(world.auth, world.personId));

        const actual: Reads = {
          person:
            person === 'denied'
              ? person
              : {
                  name: person.name,
                  birthDate: person.birthDate ?? null,
                  isFavorite: person.isFavorite ?? false,
                  thumbnailPath: person.thumbnailPath,
                  // The person page filters its photos by this profile. Without it another member sees an empty page.
                  opensSpaceProfile:
                    person.filterId === `space-person:${world.spacePersonId}` &&
                    person.primaryProfile?.type === 'space-person' &&
                    person.primaryProfile.id === world.spacePersonId &&
                    person.primaryProfile.spaceId === world.spaceId,
                },
          face:
            faces === 'denied'
              ? faces
              : faces.length === 0
                ? 'no-face'
                : faces[0].person
                  ? { name: faces[0].person.name, birthDate: faces[0].person.birthDate ?? null }
                  : 'no-person',
          thumbnail:
            thumbnail === 'denied'
              ? thumbnail
              : thumbnail.crop === world.sharedFaceId
                ? 'crop-of-shared-face'
                : thumbnail.stored === STORED_THUMBNAIL
                  ? 'stored'
                  : 'denied',
          picker:
            picker === 'denied'
              ? picker
              : picker.faces.length === 2
                ? 'every-face'
                : picker.faces.length === 1 && picker.faces[0].id === world.sharedFaceId
                  ? 'shared-face-only'
                  : 'denied',
          faceThumbnail: faceThumbnail === 'denied' ? faceThumbnail : 'served',
          statistics: statistics === 'denied' ? statistics : { assets: statistics.assets },
          coverWrite: 'denied',
        };

        // A read changes nothing.
        await expect(
          ctx.database.selectFrom('person').selectAll().where('personGroupId', '=', world.personId).executeTakeFirst(),
        ).resolves.toEqual(before);

        const written = await read(() =>
          people.updateRepresentativeFace(world.auth, world.personId, { assetFaceId: world.sharedFaceId }),
        );
        const cover = await ctx.database
          .selectFrom('person')
          .select('faceAssetId')
          .where('personGroupId', '=', world.personId)
          .executeTakeFirstOrThrow();
        if (written === 'denied') {
          // A refused write leaves the cover as it was.
          expect(cover.faceAssetId).toBe(before.faceAssetId);
        } else {
          expect(cover.faceAssetId).toBe(world.sharedFaceId);
          actual.coverWrite = {
            name: written.name,
            birthDate: written.birthDate ?? null,
            isFavorite: written.isFavorite ?? false,
            thumbnailPath: written.thumbnailPath,
          };
        }

        expect(actual).toEqual(expected(actor, setting));
        grid[
          `${actor} hidden=${setting.hidden} space=${setting.spaceProfile} recognition=${setting.recognition} privateCover=${setting.privateCover}`
        ] = actual;
      },
    );
  });

  // Every case above fills the grid, so a filtered run of this file fails here rather than writing a partial snapshot.
  it('matches the recorded grid', () => {
    expect(Object.keys(grid)).toHaveLength(ACTORS.length * SETTINGS.length);
    expect(grid).toMatchSnapshot();
  });
});
