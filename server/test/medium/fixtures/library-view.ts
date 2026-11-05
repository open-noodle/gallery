import { SharedSpaceRole } from 'src/enum.js';
import { SPACE_DATE } from 'test/medium/fixtures/two-owner-space.js';
import { MediumTestContext } from 'test/medium.factory.js';

/**
 * #1038: the viewer's own photos (outside any space, added to a space, in a linked album, in a linked library, in a
 * space hidden from their timeline), a member's photo in the space and a partner's photo. Shared by the timeline and
 * search suites, which apply the same library view through different query builders.
 */
export const seedLibraryView = async (ctx: MediumTestContext) => {
  const { user: me } = await ctx.newUser();
  const { user: peer } = await ctx.newUser();
  const { user: partner } = await ctx.newUser();
  await ctx.newPartner({ sharedById: partner.id, sharedWithId: me.id });

  const newAsset = async (ownerId: string, libraryId?: string) => {
    const { asset } = await ctx.newAsset({ ownerId, libraryId, fileCreatedAt: SPACE_DATE, localDateTime: SPACE_DATE });
    await ctx.newExif({ assetId: asset.id, timeZone: 'UTC' });
    return asset.id;
  };

  const { space } = await ctx.newSharedSpace({ createdById: peer.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: peer.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: me.id, role: SharedSpaceRole.Editor });
  const { space: hiddenSpace } = await ctx.newSharedSpace({ createdById: peer.id });
  await ctx.newSharedSpaceMember({ spaceId: hiddenSpace.id, userId: peer.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({
    spaceId: hiddenSpace.id,
    userId: me.id,
    role: SharedSpaceRole.Editor,
    showInTimeline: false,
  });
  const { library } = await ctx.newLibrary({ ownerId: me.id });

  const ids = {
    mine: await newAsset(me.id),
    mineInSpace: await newAsset(me.id),
    mineInAlbum: await newAsset(me.id),
    mineInLibrary: await newAsset(me.id, library.id),
    mineInHiddenSpace: await newAsset(me.id),
    peerInSpace: await newAsset(peer.id),
    partner: await newAsset(partner.id),
  };

  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: ids.mineInSpace });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: ids.peerInSpace });
  await ctx.newSharedSpaceAsset({ spaceId: hiddenSpace.id, assetId: ids.mineInHiddenSpace });
  const { album } = await ctx.newAlbum({ ownerId: me.id }, [ids.mineInAlbum]);
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: me.id });

  const names = new Map(Object.entries(ids).map(([name, id]) => [id, name]));
  const name = (assetIds: string[]) => assetIds.map((id) => names.get(id) ?? id).toSorted();

  return { me, partner, space, album, ids, name };
};
