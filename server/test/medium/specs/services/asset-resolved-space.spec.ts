import { Kysely } from 'kysely';
import { AssetResponseDto } from 'src/dtos/asset-response.dto.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { AssetVisibility, SharedSpaceRole } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { OcrRepository } from 'src/repositories/ocr.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { SharedLinkAssetRepository } from 'src/repositories/shared-link-asset.repository.js';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { AssetService } from 'src/services/asset.service.js';
import { TimelineService } from 'src/services/timeline.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory, newEmbedding, newUuid } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

type Arm = 'direct' | 'library';

const setup = () => {
  const { ctx, sut: assetService } = newMediumService(AssetService, {
    database: defaultDatabase,
    real: [
      AssetRepository,
      AssetEditRepository,
      AssetJobRepository,
      AlbumRepository,
      AccessRepository,
      // The owner branch overlays identity-resolved person metadata.
      FaceIdentityRepository,
      SharedLinkAssetRepository,
      SharedSpaceRepository,
      StackRepository,
      UserRepository,
      SharedLinkRepository,
    ],
    mock: [EventRepository, LoggingRepository, JobRepository, StorageRepository, OcrRepository],
  });
  const { sut: timelineService } = newMediumService(TimelineService, {
    database: defaultDatabase,
    real: [AssetRepository, AccessRepository, FaceIdentityRepository, PartnerRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });
  return { ctx, assetService, timelineService, faceIdentityRepository: ctx.get(FaceIdentityRepository) };
};

/**
 * An admin-owned library photo of "Andressa", identity-backed like real recognition output. Spaces are
 * added per test; each gets its own space person for the same identity, as face sync would create.
 */
const createFixture = async () => {
  const { ctx, assetService, timelineService, faceIdentityRepository } = setup();
  const { user: admin } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const { library } = await ctx.newLibrary({ ownerId: admin.id });
  const { result: person } = await ctx.newPerson({ ownerId: admin.id, name: 'Andressa' });
  const { asset } = await ctx.newAsset({
    ownerId: admin.id,
    libraryId: library.id,
    visibility: AssetVisibility.Timeline,
  });
  await ctx.newExif({ assetId: asset.id, make: 'Canon', timeZone: 'UTC' });
  const { result: faceId } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
  await ctx.database.insertInto('face_search').values({ faceId, embedding: newEmbedding() }).execute();
  const identity = await faceIdentityRepository.ensurePersonIdentity(person.personGroupId);
  await faceIdentityRepository.linkFace({ assetFaceId: faceId, identityId: identity.id, source: 'owner-person' });

  const addSpace = async (input: { id?: string; arm: Arm; viewerTimeline: boolean }) => {
    const { space } = await ctx.newSharedSpace({ id: input.id ?? newUuid(), createdById: admin.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: admin.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: viewer.id,
      role: SharedSpaceRole.Viewer,
      showInTimeline: input.viewerTimeline,
    });
    if (input.arm === 'direct') {
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: admin.id });
    } else {
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: admin.id });
    }
    const spacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId: space.id, identityId: identity.id, name: 'Andressa', representativeFaceId: faceId })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: spacePerson.id, assetFaceId: faceId })
      .execute();
    return { space, spacePerson };
  };

  const getAsset = async (auth: AuthDto, spaceId?: string) =>
    (await assetService.get(auth, asset.id, spaceId)) as AssetResponseDto;

  // The /photos query the chip navigates to (web buildPhotosTimelineOptions), summed over buckets.
  const countPhotosTimeline = async (auth: AuthDto, personIds?: string[]) => {
    const buckets = await timelineService.getTimeBuckets(auth, {
      userId: auth.user.id,
      visibility: AssetVisibility.Timeline,
      withStacked: true,
      withPartners: true,
      withSharedSpaces: true,
      ...(personIds && { personIds }),
    });
    return buckets.reduce((total, bucket) => total + bucket.count, 0);
  };

  return { admin, viewer, person, addSpace, getAsset, countPhotosTimeline };
};

const authFor = (user: { id: string; name: string; email: string }) =>
  factory.auth({ user: { id: user.id, name: user.name, email: user.email } });

const sortedIds = () => [newUuid(), newUuid()].sort();

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('AssetService.get resolvedSpaceId', () => {
  // #1115: an admin fills a Viewer's Space with photos that also sit in another Space the Viewer is in,
  // but hides from their timeline. Opened with no space context, the asset is resolved to a space, and
  // the Info panel's person chip filters /photos by THAT space's `space-person:<id>`. /photos only
  // honours space-person tokens from timeline-enabled spaces, so resolving to the hidden one made the
  // chip return 0 results for a person with many photos.
  //
  // The lookup used to be `UNION ... LIMIT 1` with no ORDER BY, so which space won fell out of the
  // UNION's de-duplication (in practice the lowest space id). Pin the ids so both orderings run.
  describe('asset in a hidden and a timeline-enabled space', () => {
    it.each(
      (['direct', 'library'] as const).flatMap((arm) => [
        { arm, hiddenIdIsLower: true },
        { arm, hiddenIdIsLower: false },
      ]),
    )(
      'resolves the timeline-enabled space, so the person chip narrows /photos to the asset ($arm, hidden id lower: $hiddenIdIsLower)',
      async ({ arm, hiddenIdIsLower }) => {
        const fx = await createFixture();
        const [lowerId, higherId] = sortedIds();
        await fx.addSpace({ id: hiddenIdIsLower ? lowerId : higherId, arm, viewerTimeline: false });
        const timelineSpace = await fx.addSpace({
          id: hiddenIdIsLower ? higherId : lowerId,
          arm,
          viewerTimeline: true,
        });
        const auth = authFor(fx.viewer);

        const detail = await fx.getAsset(auth);

        expect(detail.resolvedSpaceId).toBe(timelineSpace.space.id);
        expect(detail.people).toEqual([
          expect.objectContaining({ name: 'Andressa', spacePersonId: timelineSpace.spacePerson.id }),
        ]);
        await expect(fx.countPhotosTimeline(auth, [`space-person:${detail.people![0].spacePersonId}`])).resolves.toBe(
          1,
        );
      },
    );

    it('pins why the pick matters: the hidden space person narrows /photos to nothing', async () => {
      const fx = await createFixture();
      const hiddenSpace = await fx.addSpace({ arm: 'library', viewerTimeline: false });
      await fx.addSpace({ arm: 'library', viewerTimeline: true });
      const auth = authFor(fx.viewer);

      // The asset IS on the viewer's /photos timeline (via the timeline-enabled space)...
      await expect(fx.countPhotosTimeline(auth)).resolves.toBe(1);
      // ...but a chip carrying the hidden space's person can never find it there. This is the 0-result
      // page from the report; if /photos ever starts honouring hidden-space tokens this test is moot.
      await expect(fx.countPhotosTimeline(auth, [`space-person:${hiddenSpace.spacePerson.id}`])).resolves.toBe(0);
    });

    it('resolves the same space on every read', async () => {
      const fx = await createFixture();
      const [lowerId, higherId] = sortedIds();
      await fx.addSpace({ id: lowerId, arm: 'direct', viewerTimeline: false });
      const timelineSpace = await fx.addSpace({ id: higherId, arm: 'library', viewerTimeline: true });
      const auth = authFor(fx.viewer);

      const reads = await Promise.all([fx.getAsset(auth), fx.getAsset(auth), fx.getAsset(auth)]);

      expect(reads.map((read) => read.resolvedSpaceId)).toEqual([
        timelineSpace.space.id,
        timelineSpace.space.id,
        timelineSpace.space.id,
      ]);
    });
  });

  it.each<Arm>(['direct', 'library'])(
    'keeps resolving a sole space the viewer hides from their timeline, with its people (%s)',
    async (arm) => {
      const fx = await createFixture();
      const hiddenSpace = await fx.addSpace({ arm, viewerTimeline: false });

      const detail = await fx.getAsset(authFor(fx.viewer));

      // A preference, not a filter: the viewer still sees who is in the photo.
      expect(detail.resolvedSpaceId).toBe(hiddenSpace.space.id);
      expect(detail.people).toEqual([
        expect.objectContaining({ name: 'Andressa', spacePersonId: hiddenSpace.spacePerson.id }),
      ]);
    },
  );

  it('honours an explicit spaceId over the timeline preference', async () => {
    const fx = await createFixture();
    const [lowerId, higherId] = sortedIds();
    const hiddenSpace = await fx.addSpace({ id: higherId, arm: 'library', viewerTimeline: false });
    await fx.addSpace({ id: lowerId, arm: 'library', viewerTimeline: true });

    // Opened from inside the hidden space (e.g. /spaces/{id}/photos/{assetId}): that space's people.
    const detail = await fx.getAsset(authFor(fx.viewer), hiddenSpace.space.id);

    expect(detail.resolvedSpaceId).toBeUndefined();
    expect(detail.people).toEqual([
      expect.objectContaining({ name: 'Andressa', spacePersonId: hiddenSpace.spacePerson.id }),
    ]);
  });

  it('does not resolve a space for the asset owner', async () => {
    const fx = await createFixture();
    await fx.addSpace({ arm: 'library', viewerTimeline: false });
    await fx.addSpace({ arm: 'direct', viewerTimeline: true });

    const detail = await fx.getAsset(authFor(fx.admin));

    // The owner's chip filters by their own person, so no space is involved.
    expect(detail.resolvedSpaceId).toBeUndefined();
    expect(detail.people).toEqual([expect.objectContaining({ id: fx.person.personGroupId, name: 'Andressa' })]);
    expect(detail.people![0].spacePersonId).toBeUndefined();
  });
});
