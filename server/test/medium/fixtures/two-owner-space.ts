import { SharedSpaceRole } from 'src/enum';
import { MediumTestContext } from 'test/medium.factory';

/**
 * The bucket (and the date inside it) every asset of the two-owner Space fixture is seeded into.
 *
 * The timeline suite addresses the fixture with `timeBucket: SPACE_BUCKET`; the search suite ignores
 * dates entirely. Keeping both fixtures on one date means the same seed serves both.
 */
export const SPACE_BUCKET = '2026-01-01';
export const SPACE_DATE = new Date('2026-01-15T10:00:00Z');

type SpaceAssetExif = {
  make?: string;
  model?: string;
  lensModel?: string;
  state?: string;
  city?: string;
  country?: string;
};

/** An asset owned by `ownerId`, added to `spaceId`, with the given EXIF. */
export const newSpaceAssetWithExif = async (
  ctx: MediumTestContext,
  spaceId: string,
  ownerId: string,
  exif: SpaceAssetExif,
) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    fileCreatedAt: SPACE_DATE,
    localDateTime: SPACE_DATE,
    width: 400,
    height: 200,
    thumbhash: Buffer.from('thumbhash'),
  });
  await ctx.newExif({ assetId: asset.id, timeZone: 'UTC', ...exif });
  await ctx.newSharedSpaceAsset({ spaceId, assetId: asset.id, addedById: ownerId });
  return asset;
};

/**
 * A Space with TWO contributing owners (anna, ben) plus a viewer and an editor who own NOTHING.
 *
 * The two-owner shape is load-bearing: with a single owner every RBAC assertion built on this
 * fixture passes vacuously and the #655 bug class ("viewers get empty facets for assets owned by
 * someone else") stays invisible. Likewise, a viewer/editor who owns nothing is what makes an
 * "only anna's assets" assertion meaningful — a caller who owns assets of their own could satisfy
 * it through the ownership scope rather than the filter under test. Do not collapse either.
 *
 * Shared between the timeline medium suite (contextual filters over `withTimeBucketAssetFilters`)
 * and the search medium suite (the same filters over `searchAssetBuilder`) — two DIFFERENT query
 * builders that must enforce the same RBAC contract, so they are pinned against one fixture.
 */
export const createTwoOwnerSpace = async (ctx: MediumTestContext) => {
  const { user: anna } = await ctx.newUser();
  const { user: ben } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const { user: editor } = await ctx.newUser();

  const { space } = await ctx.newSharedSpace({ createdById: anna.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: anna.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ben.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: SharedSpaceRole.Editor });

  const annaAsset = await newSpaceAssetWithExif(ctx, space.id, anna.id, {
    make: 'Apple',
    model: 'iPhone 17 Pro Max',
    lensModel: 'iPhone 17 Pro Max back triple camera',
    city: 'Berlin',
    state: 'State of Berlin',
    country: 'Germany',
  });
  const benAsset = await newSpaceAssetWithExif(ctx, space.id, ben.id, {
    make: 'Canon',
    model: 'EOS R5',
    lensModel: 'RF24-70mm F2.8 L IS USM',
    city: 'Hamburg',
    state: 'Hamburg',
    country: 'Germany',
  });

  return { space, anna, ben, viewer, editor, annaAsset, benAsset };
};
