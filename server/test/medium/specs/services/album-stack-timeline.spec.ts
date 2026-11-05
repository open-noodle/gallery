import { Insertable, Kysely } from 'kysely';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import type { TimeBucketDto } from 'src/dtos/time-bucket.dto.js';
import { AlbumUserRole, TimeBucketSize } from 'src/enum.js';
import { SpaceAlbumRepository } from 'src/gallery/repositories/space-album.repository.js';
import { GalleryAlbumService } from 'src/gallery/services/gallery-album.service.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { DB } from 'src/schema/index.js';
import { AssetTable } from 'src/schema/tables/asset.table.js';
import { TimelineService } from 'src/services/timeline.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

// `withStacked` on an album timeline (src/gallery/utils/album-stack-collapse.ts): one photo per stack among the album's
// own members, primary first, then the earliest; only the viewer's own stacks collapse and carry a badge.

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(TimelineService, {
    database: db || defaultDatabase,
    real: [AssetRepository, AccessRepository, PartnerRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });
};

type Context = ReturnType<typeof setup>['ctx'];

const albumStackSetup = () =>
  newMediumService(GalleryAlbumService, {
    database: defaultDatabase,
    real: [AccessRepository, AssetRepository, StackRepository, SpaceAlbumRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });

const BUCKET = '2026-03-01';

const createAsset = async (
  ctx: Pick<Context, 'newAsset' | 'newExif'>,
  ownerId: string,
  day: number,
  options: Partial<Insertable<AssetTable>> = {},
) => {
  const date = new Date(`2026-03-${String(day).padStart(2, '0')}T12:00:00.000Z`);
  const { asset } = await ctx.newAsset({ ownerId, fileCreatedAt: date, localDateTime: date, ...options });
  await ctx.newExif({ assetId: asset.id, make: 'Canon', timeZone: 'UTC' });
  return asset;
};

const albumBucket = async (
  sut: TimelineService,
  auth: AuthDto,
  albumId: string,
  dto: Partial<TimeBucketDto> = {},
): Promise<{ ids: string[]; stack: Array<[string, string] | null> | undefined; count: number }> => {
  const query = { albumId, bucketSize: TimeBucketSize.Month, ...dto };
  const json = JSON.parse(await sut.getTimeBucket(auth, { ...query, timeBucket: BUCKET })) as {
    id: string[];
    stack?: Array<[string, string] | null>;
  };
  const buckets = await sut.getTimeBuckets(auth, query);
  return { ids: json.id, stack: json.stack, count: buckets.reduce((sum, { count }) => sum + count, 0) };
};

/** A stack of three (primary on day 3, children on days 1 and 2) owned by `ownerId`, plus an unstacked photo. */
const createStackFixture = async (ctx: Context, ownerId: string) => {
  const primary = await createAsset(ctx, ownerId, 3);
  const early = await createAsset(ctx, ownerId, 1);
  const late = await createAsset(ctx, ownerId, 2);
  const loose = await createAsset(ctx, ownerId, 4);
  const { stack } = await ctx.newStack({ ownerId }, [primary.id, early.id, late.id]);
  return { primary, early, late, loose, stack };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('album timeline withStacked', () => {
  it('shows the primary when the album holds it, badged with the whole stack', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { primary, early, loose, stack } = await createStackFixture(ctx, user.id);
    const { album } = await ctx.newAlbum({ ownerId: user.id }, [primary.id, early.id, loose.id]);

    const result = await albumBucket(sut, factory.auth({ user }), album.id, { withStacked: true });

    expect(result.ids).toEqual([loose.id, primary.id]);
    expect(result.stack).toEqual([null, [stack.id, '3']]);
    expect(result.count).toBe(2);
  });

  it('shows the earliest album member when the album does not hold the primary', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { early, late, stack } = await createStackFixture(ctx, user.id);
    const { album } = await ctx.newAlbum({ ownerId: user.id }, [late.id, early.id]);

    const result = await albumBucket(sut, factory.auth({ user }), album.id, { withStacked: true });

    expect(result.ids).toEqual([early.id]);
    expect(result.stack).toEqual([[stack.id, '3']]);
    expect(result.count).toBe(1);
  });

  it('keeps every album member without withStacked (upstream behaviour)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { primary, early, late } = await createStackFixture(ctx, user.id);
    const { album } = await ctx.newAlbum({ ownerId: user.id }, [primary.id, early.id, late.id]);

    const result = await albumBucket(sut, factory.auth({ user }), album.id);

    expect(result.ids).toEqual([primary.id, late.id, early.id]);
    expect(result.count).toBe(3);
  });

  it('never hides a photo behind a sibling the filters exclude', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { primary, early, late, stack } = await createStackFixture(ctx, user.id);
    const { album } = await ctx.newAlbum({ ownerId: user.id }, [primary.id, early.id, late.id]);
    await ctx.database
      .insertInto('asset_favorite')
      .values([
        { userId: user.id, assetId: early.id },
        { userId: user.id, assetId: late.id },
      ])
      .execute();

    const result = await albumBucket(sut, factory.auth({ user }), album.id, { withStacked: true, isFavorite: true });

    expect(result.ids).toEqual([early.id]);
    expect(result.stack).toEqual([[stack.id, '3']]);
    expect(result.count).toBe(1);
  });

  it('passes over a trashed primary to the next album member', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { primary, early, late } = await createStackFixture(ctx, user.id);
    const { album } = await ctx.newAlbum({ ownerId: user.id }, [primary.id, early.id, late.id]);
    await ctx.database.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', primary.id).execute();

    const result = await albumBucket(sut, factory.auth({ user }), album.id, { withStacked: true });

    expect(result.ids).toEqual([early.id]);
    expect(result.count).toBe(1);
  });

  it("leaves another user's stack expanded and unbadged in a shared album", async () => {
    const { sut, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { primary, early, stack } = await createStackFixture(ctx, owner.id);
    const { album } = await ctx.newAlbum({ ownerId: owner.id }, [primary.id, early.id]);
    await ctx.newAlbumUser({ albumId: album.id, userId: viewer.id, role: AlbumUserRole.Viewer });

    const asViewer = await albumBucket(sut, factory.auth({ user: viewer }), album.id, { withStacked: true });
    expect(asViewer.ids).toEqual([primary.id, early.id]);
    expect(asViewer.stack).toEqual([null, null]);
    expect(asViewer.count).toBe(2);

    const asOwner = await albumBucket(sut, factory.auth({ user: owner }), album.id, { withStacked: true });
    expect(asOwner.ids).toEqual([primary.id]);
    expect(asOwner.stack).toEqual([[stack.id, '3']]);
  });
});

describe('album timeline stackCountInAlbum', () => {
  it("counts only the stack members the album holds, and drops a stack's badge when it holds one", async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { primary, early, late, stack } = await createStackFixture(ctx, user.id);
    const { album } = await ctx.newAlbum({ ownerId: user.id }, [primary.id, early.id]);
    const auth = factory.auth({ user });

    const wholeStack = await albumBucket(sut, auth, album.id, { withStacked: true });
    expect(wholeStack.stack).toEqual([[stack.id, '3']]);

    const inAlbum = await albumBucket(sut, auth, album.id, { withStacked: true, stackCountInAlbum: true });
    expect(inAlbum.ids).toEqual([primary.id]);
    expect(inAlbum.stack).toEqual([[stack.id, '2']]);

    const { album: single } = await ctx.newAlbum({ ownerId: user.id }, [late.id]);
    const one = await albumBucket(sut, auth, single.id, { withStacked: true, stackCountInAlbum: true });
    expect(one.ids).toEqual([late.id]);
    expect(one.stack).toEqual([null]);
  });
});

describe('GET /albums/:id/stacks/:stackId', () => {
  it('returns only the stack members the album holds', async () => {
    const { sut, ctx } = albumStackSetup();
    const { user } = await ctx.newUser();
    const primary = await createAsset(ctx, user.id, 3);
    const early = await createAsset(ctx, user.id, 1);
    const late = await createAsset(ctx, user.id, 2);
    const { stack } = await ctx.newStack({ ownerId: user.id }, [primary.id, early.id, late.id]);
    const { album } = await ctx.newAlbum({ ownerId: user.id }, [early.id, late.id]);

    const result = await sut.getStack(factory.auth({ user }), album.id, stack.id);

    expect(result.id).toBe(stack.id);
    expect(result.assets.map(({ id }) => id).toSorted()).toEqual([early.id, late.id].toSorted());
  });

  it('refuses an album viewer who does not own the stack, and a user who cannot read the album', async () => {
    const { sut, ctx } = albumStackSetup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const primary = await createAsset(ctx, owner.id, 3);
    const child = await createAsset(ctx, owner.id, 1);
    const { stack } = await ctx.newStack({ ownerId: owner.id }, [primary.id, child.id]);
    const { album } = await ctx.newAlbum({ ownerId: owner.id }, [primary.id, child.id]);
    await ctx.newAlbumUser({ albumId: album.id, userId: viewer.id, role: AlbumUserRole.Viewer });

    await expect(sut.getStack(factory.auth({ user: viewer }), album.id, stack.id)).rejects.toThrow();
    await expect(sut.getStack(factory.auth({ user: stranger }), album.id, stack.id)).rejects.toThrow();
  });
});
