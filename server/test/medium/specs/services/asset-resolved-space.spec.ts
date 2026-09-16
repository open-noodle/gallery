import { Kysely } from 'kysely';
import { AssetResponseDto } from 'src/dtos/asset-response.dto.js';
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

const setup = () => {
  const { ctx, sut: assetService } = newMediumService(AssetService, {
    database: defaultDatabase,
    real: [
      AssetRepository,
      AssetEditRepository,
      AssetJobRepository,
      AlbumRepository,
      AccessRepository,
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

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('AssetService.get resolvedSpaceId', () => {
  // #1115: an admin fills a Viewer's Space from a library that also backs another Space the Viewer is
  // in, but has hidden from their timeline. Opened from /photos, the asset is resolved to a space
  // with no `spaceId` hint, and the Info panel's person chip filters /photos by THAT space's
  // `space-person:<id>`. /photos only honours space-person tokens from timeline-enabled spaces, so
  // resolving to the hidden one made the chip return 0 results for a person with many photos.
  //
  // The lookup used to be `UNION ... LIMIT 1` with no ORDER BY, so which space won fell out of the
  // UNION's de-duplication (in practice the lowest space id). Pin the ids so both orderings run.
  it.each([
    { order: 'hidden space has the lower id', hiddenIdIsLower: true },
    { order: 'timeline space has the lower id', hiddenIdIsLower: false },
  ])(
    'prefers a timeline-enabled space, so the person chip narrows /photos to the asset ($order)',
    async ({ hiddenIdIsLower }) => {
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

      const [lowerId, higherId] = [newUuid(), newUuid()].sort();
      const addLibrarySpace = async (id: string, showInTimeline: boolean) => {
        const { space } = await ctx.newSharedSpace({ id, createdById: admin.id });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: admin.id, role: SharedSpaceRole.Owner });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
        await ctx.database
          .updateTable('shared_space_member')
          .set({ showInTimeline })
          .where('spaceId', '=', space.id)
          .where('userId', '=', viewer.id)
          .execute();
        await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: admin.id });
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

      await addLibrarySpace(hiddenIdIsLower ? lowerId : higherId, false);
      const timelineSpace = await addLibrarySpace(hiddenIdIsLower ? higherId : lowerId, true);

      const auth = factory.auth({ user: { id: viewer.id, name: viewer.name, email: viewer.email } });
      const detail = (await assetService.get(auth, asset.id)) as AssetResponseDto;

      expect(detail.resolvedSpaceId).toBe(timelineSpace.space.id);
      expect(detail.people).toEqual([
        expect.objectContaining({ name: 'Andressa', spacePersonId: timelineSpace.spacePerson.id }),
      ]);

      // The /photos query the chip navigates to (web buildPhotosTimelineOptions).
      const buckets = await timelineService.getTimeBuckets(auth, {
        userId: viewer.id,
        visibility: AssetVisibility.Timeline,
        withStacked: true,
        withPartners: true,
        withSharedSpaces: true,
        personIds: [`space-person:${detail.people![0].spacePersonId}`],
      });
      expect(buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(1);
    },
  );
});
