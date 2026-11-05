import { Kysely } from 'kysely';
import { TimeBucketDto } from 'src/dtos/time-bucket.dto.js';
import { AssetVisibility, LibraryView } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { DB } from 'src/schema/index.js';
import { TimelineService } from 'src/services/timeline.service.js';
import { seedLibraryView } from 'test/medium/fixtures/library-view.js';
import { SPACE_BUCKET } from 'test/medium/fixtures/two-owner-space.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const seed = async () => {
  const { sut, ctx } = newMediumService(TimelineService, {
    database: defaultDatabase,
    real: [AssetRepository, AccessRepository, PartnerRepository, SharedSpaceRepository, StackRepository],
    mock: [LoggingRepository],
  });
  const world = await seedLibraryView(ctx);
  const auth = factory.auth({ user: world.me });
  const timeline = async (libraryView?: LibraryView, request: Partial<TimeBucketDto> = {}) => {
    const json = await sut.getTimeBucket(auth, {
      userId: world.me.id,
      withPartners: true,
      withSharedSpaces: true,
      visibility: AssetVisibility.Timeline,
      timeBucket: SPACE_BUCKET,
      libraryView,
      ...request,
    });
    return world.name((JSON.parse(json) as { id?: string[] }).id ?? []);
  };
  return { ...world, ctx, sut, auth, timeline };
};

describe('timeline library view', () => {
  it('shows both without a library view', async () => {
    const { timeline } = await seed();

    // #1041: hiding a space from my timeline also hides my own photos in it.
    expect(await timeline()).toEqual(['mine', 'mineInAlbum', 'mineInLibrary', 'mineInSpace', 'partner', 'peerInSpace']);
  });

  it('personal: only my photos that are in no space', async () => {
    const { timeline } = await seed();

    expect(await timeline(LibraryView.Personal)).toEqual(['mine']);
  });

  it('spaces: only the photos that reach me through a space on my timeline, mine included', async () => {
    const { timeline } = await seed();

    expect(await timeline(LibraryView.Spaces)).toEqual(['mineInAlbum', 'mineInLibrary', 'mineInSpace', 'peerInSpace']);
  });

  it('counts the buckets of each view', async () => {
    const { sut, auth, me } = await seed();
    const count = (libraryView: LibraryView) =>
      sut.getTimeBuckets(auth, {
        userId: me.id,
        withSharedSpaces: true,
        visibility: AssetVisibility.Timeline,
        libraryView,
      });

    expect(await count(LibraryView.Personal)).toEqual([{ timeBucket: SPACE_BUCKET, count: 1 }]);
    expect(await count(LibraryView.Spaces)).toEqual([{ timeBucket: SPACE_BUCKET, count: 4 }]);
  });

  it('narrows the album filter of the Photos timeline', async () => {
    const { timeline, album } = await seed();
    const albumFilter = { albumId: album.id, withPartners: undefined };

    expect(await timeline(LibraryView.Personal, albumFilter)).toEqual([]);
    expect(await timeline(LibraryView.Spaces, albumFilter)).toEqual(['mineInAlbum']);
  });

  it('shows a stack where its cover is', async () => {
    const { ctx, timeline, me, ids } = await seed();
    await ctx.newStack({ ownerId: me.id }, [ids.mineInSpace, ids.mine]);

    expect(await timeline(LibraryView.Personal, { withStacked: true })).toEqual([]);
    expect(await timeline(LibraryView.Spaces, { withStacked: true })).toEqual([
      'mineInAlbum',
      'mineInLibrary',
      'mineInSpace',
      'peerInSpace',
    ]);
  });

  it('is refused on an album or space page, on another user timeline, and for spaces without them', async () => {
    const { timeline, partner, space, album } = await seed();
    const otherTimeline = 'libraryView only applies to your own photos';

    await expect(timeline(LibraryView.Personal, { userId: undefined, albumId: album.id })).rejects.toThrow(
      otherTimeline,
    );
    await expect(timeline(LibraryView.Spaces, { userId: undefined, spaceId: space.id })).rejects.toThrow(otherTimeline);
    await expect(timeline(LibraryView.Personal, { userId: partner.id })).rejects.toThrow(otherTimeline);
    await expect(timeline(LibraryView.Spaces, { withSharedSpaces: undefined })).rejects.toThrow(
      'libraryView=spaces requires withSharedSpaces',
    );
  });
});
