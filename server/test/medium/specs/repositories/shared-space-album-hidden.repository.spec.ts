import { Kysely } from 'kysely';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(SharedSpaceRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('hideAlbumForUser / unhideAlbumForUser', () => {
  it('hides an album for one member only', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: memberA } = await ctx.newUser();
    const { user: memberB } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberA.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberB.id });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Shared' });
    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    await sut.hideAlbumForUser(space.id, album.id, memberA.id);

    const scopeA = await sut.getTimelineHiddenScope(memberA.id);
    expect(scopeA.hiddenAlbumIds).toContain(album.id);

    const scopeB = await sut.getTimelineHiddenScope(memberB.id);
    expect(scopeB.hiddenAlbumIds).not.toContain(album.id);
  });

  it('is idempotent', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Idempotent' });
    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    await sut.hideAlbumForUser(space.id, album.id, owner.id);
    await expect(sut.hideAlbumForUser(space.id, album.id, owner.id)).resolves.not.toThrow();

    const rows = await defaultDatabase
      .selectFrom('shared_space_album_hidden')
      .selectAll()
      .where('spaceId', '=', space.id)
      .where('albumId', '=', album.id)
      .where('userId', '=', owner.id)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('unhide removes the row', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Unhide' });
    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    await sut.hideAlbumForUser(space.id, album.id, owner.id);
    await sut.unhideAlbumForUser(space.id, album.id, owner.id);

    const rows = await defaultDatabase
      .selectFrom('shared_space_album_hidden')
      .selectAll()
      .where('spaceId', '=', space.id)
      .where('albumId', '=', album.id)
      .where('userId', '=', owner.id)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('unhide is a no-op when nothing is hidden', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'NoOpUnhide' });
    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    await expect(sut.unhideAlbumForUser(space.id, album.id, owner.id)).resolves.not.toThrow();

    const rows = await defaultDatabase
      .selectFrom('shared_space_album_hidden')
      .selectAll()
      .where('spaceId', '=', space.id)
      .where('albumId', '=', album.id)
      .where('userId', '=', owner.id)
      .execute();
    expect(rows).toHaveLength(0);
  });
});

describe('getTimelineHiddenScope', () => {
  it('rule 1: is scoped to my memberships', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { user: strangerOwner } = await ctx.newUser();

    // user IS a member of a second, unrelated, shown space — so the collapse-when-empty path is
    // not what proves this test (§9.6 test-honesty).
    const { space: mySpace } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: mySpace.id, userId: user.id, showInTimeline: true });

    // A totally separate space the user is NOT a member of, with an album hidden directly at
    // the repo layer (bypassing any service-level membership gate).
    const { space: strangerSpace } = await ctx.newSharedSpace({ createdById: strangerOwner.id });
    await ctx.newSharedSpaceMember({ spaceId: strangerSpace.id, userId: strangerOwner.id });
    const { result: strangerAlbum } = await ctx.newAlbum({ ownerId: strangerOwner.id, albumName: 'StrangerAlbum' });
    await sut.addAlbum({ spaceId: strangerSpace.id, albumId: strangerAlbum.id, addedById: strangerOwner.id });
    await sut.hideAlbumForUser(strangerSpace.id, strangerAlbum.id, user.id);

    const scope = await sut.getTimelineHiddenScope(user.id);
    expect(scope.hiddenAlbumIds).not.toContain(strangerAlbum.id);
    expect(scope.hiddenAlbumSpacePairs).not.toContainEqual({ albumId: strangerAlbum.id, spaceId: strangerSpace.id });
    expect(scope.hiddenSpaceIds).not.toContain(strangerSpace.id);
  });

  it('rule 2a: includes albums I hid myself', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space: shownSpace } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: shownSpace.id, userId: user.id, showInTimeline: true });
    const { result: hiddenAlbum } = await ctx.newAlbum({ ownerId: user.id, albumName: 'HiddenByMe' });
    await sut.addAlbum({ spaceId: shownSpace.id, albumId: hiddenAlbum.id, addedById: user.id });
    await sut.hideAlbumForUser(shownSpace.id, hiddenAlbum.id, user.id);

    // a second, untouched album linked to the same space — proves selectivity, not just collapse.
    const { result: otherAlbum } = await ctx.newAlbum({ ownerId: user.id, albumName: 'NotHidden' });
    await sut.addAlbum({ spaceId: shownSpace.id, albumId: otherAlbum.id, addedById: user.id });

    const scope = await sut.getTimelineHiddenScope(user.id);
    expect(scope.hiddenAlbumIds).toContain(hiddenAlbum.id);
    expect(scope.hiddenAlbumIds).not.toContain(otherAlbum.id);
    expect(scope.hiddenSpaceIds).not.toContain(shownSpace.id);
  });

  it('rule 2b: includes every album linked to a space I hid', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space: hiddenSpace } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: hiddenSpace.id, userId: user.id, showInTimeline: false });
    const { result: cascadedAlbum } = await ctx.newAlbum({ ownerId: user.id, albumName: 'CascadedHidden' });
    await sut.addAlbum({ spaceId: hiddenSpace.id, albumId: cascadedAlbum.id, addedById: user.id });

    // a second, unrelated visible space — proves selectivity.
    const { space: visibleSpace } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: visibleSpace.id, userId: user.id, showInTimeline: true });
    const { result: visibleAlbum } = await ctx.newAlbum({ ownerId: user.id, albumName: 'StillVisible' });
    await sut.addAlbum({ spaceId: visibleSpace.id, albumId: visibleAlbum.id, addedById: user.id });

    const scope = await sut.getTimelineHiddenScope(user.id);
    expect(scope.hiddenSpaceIds).toContain(hiddenSpace.id);
    expect(scope.hiddenAlbumIds).toContain(cascadedAlbum.id);
    expect(scope.hiddenAlbumIds).not.toContain(visibleAlbum.id);
  });

  it('rule 2c: a visibly-linked album cancels the hide (the MINUS)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space: hiddenSpace } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: hiddenSpace.id, userId: user.id, showInTimeline: false });
    const { space: shownSpace } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: shownSpace.id, userId: user.id, showInTimeline: true });

    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'DualLinked' });
    await sut.addAlbum({ spaceId: hiddenSpace.id, albumId: album.id, addedById: user.id });
    await sut.addAlbum({ spaceId: shownSpace.id, albumId: album.id, addedById: user.id });
    // not hidden by me in shownSpace

    const scope = await sut.getTimelineHiddenScope(user.id);
    expect(scope.hiddenSpaceIds).toContain(hiddenSpace.id);
    expect(scope.hiddenAlbumIds).not.toContain(album.id);
    expect(scope.hiddenAlbumSpacePairs).not.toContainEqual({ albumId: album.id, spaceId: hiddenSpace.id });
  });

  it('rule 3: excludes soft-deleted albums from BOTH sides', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space: shownSpace } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: shownSpace.id, userId: user.id, showInTimeline: true });
    const { space: otherShownSpace } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: otherShownSpace.id, userId: user.id, showInTimeline: true });

    // (a) an album I hid that is soft-deleted must not appear as hidden.
    const { result: deletedAlbum } = await ctx.newAlbum({ ownerId: user.id, albumName: 'DeletedHidden' });
    await sut.addAlbum({ spaceId: shownSpace.id, albumId: deletedAlbum.id, addedById: user.id });
    await sut.addAlbum({ spaceId: otherShownSpace.id, albumId: deletedAlbum.id, addedById: user.id });
    await sut.hideAlbumForUser(shownSpace.id, deletedAlbum.id, user.id);
    await ctx.softDeleteAlbum(deletedAlbum.id);

    // (b) a genuinely alive, hidden album, in the SAME user's scope, must not be affected by the
    // soft-deleted album's still-live link into otherShownSpace (a broken cancel-query — e.g. one
    // that cancels globally instead of per-album — would wrongly re-admit it).
    const { result: aliveAlbum } = await ctx.newAlbum({ ownerId: user.id, albumName: 'AliveHidden' });
    await sut.addAlbum({ spaceId: shownSpace.id, albumId: aliveAlbum.id, addedById: user.id });
    await sut.hideAlbumForUser(shownSpace.id, aliveAlbum.id, user.id);

    const scope = await sut.getTimelineHiddenScope(user.id);
    expect(scope.hiddenAlbumIds).not.toContain(deletedAlbum.id); // rule 3a
    expect(scope.hiddenAlbumSpacePairs).not.toContainEqual({ albumId: deletedAlbum.id, spaceId: shownSpace.id });
    expect(scope.hiddenAlbumIds).toContain(aliveAlbum.id); // rule 3b
  });

  it('rule 4: pairs carry the space', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space: personalHideSpace } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: personalHideSpace.id, userId: user.id, showInTimeline: true });
    const { space: cascadeHiddenSpace } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: cascadeHiddenSpace.id, userId: user.id, showInTimeline: false });
    const { space: unrelatedShownSpace } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: unrelatedShownSpace.id, userId: user.id, showInTimeline: true });

    // album X, linked to BOTH a space where I personally hid it and a space that's hidden by
    // space-cascade — two distinct pairs for the SAME album, distinguished only by spaceId.
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'MultiSpace' });
    await sut.addAlbum({ spaceId: personalHideSpace.id, albumId: album.id, addedById: user.id });
    await sut.addAlbum({ spaceId: cascadeHiddenSpace.id, albumId: album.id, addedById: user.id });
    await sut.hideAlbumForUser(personalHideSpace.id, album.id, user.id);
    // NOT linked to unrelatedShownSpace at all.

    const scope = await sut.getTimelineHiddenScope(user.id);
    expect(scope.hiddenAlbumIds).toContain(album.id);
    expect(scope.hiddenAlbumSpacePairs).toContainEqual({ albumId: album.id, spaceId: personalHideSpace.id });
    expect(scope.hiddenAlbumSpacePairs).toContainEqual({ albumId: album.id, spaceId: cascadeHiddenSpace.id });
    expect(scope.hiddenAlbumSpacePairs).not.toContainEqual({ albumId: album.id, spaceId: unrelatedShownSpace.id });
  });

  it('rule 5: the shared flag is NOT consulted', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'SharedFlagOnly' });
    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    // The SHARED space-tab flag is off, but I never personally hid this album, and my space
    // membership is shown. Per §2, this shared flag governs only the space's Photos tab now.
    await sut.setAlbumShowInTimeline(space.id, album.id, false);

    const scope = await sut.getTimelineHiddenScope(user.id);
    expect(scope.hiddenAlbumIds).not.toContain(album.id);
    expect(scope.hiddenAlbumSpacePairs).not.toContainEqual({ albumId: album.id, spaceId: space.id });
    expect(scope.hiddenSpaceIds).not.toContain(space.id);
    expect(scope.hiddenLibraryIds).toEqual([]);
  });

  it('returns four empty lists when I have hidden nothing', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, showInTimeline: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Untouched' });
    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    const scope = await sut.getTimelineHiddenScope(user.id);
    expect(scope.hiddenSpaceIds).toEqual([]);
    expect(scope.hiddenAlbumIds).toEqual([]);
    expect(scope.hiddenAlbumSpacePairs).toEqual([]);
    expect(scope.hiddenLibraryIds).toEqual([]);
  });

  it('includes libraries linked to a space I hid', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space: hiddenSpace } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: hiddenSpace.id, userId: user.id, showInTimeline: false });
    const { library: hiddenLibrary } = await ctx.newLibrary({ ownerId: user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: hiddenSpace.id, libraryId: hiddenLibrary.id });

    // a second, unrelated visible space with its own library — proves selectivity.
    const { space: shownSpace } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: shownSpace.id, userId: user.id, showInTimeline: true });
    const { library: shownLibrary } = await ctx.newLibrary({ ownerId: user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: shownSpace.id, libraryId: shownLibrary.id });

    const scope = await sut.getTimelineHiddenScope(user.id);
    expect(scope.hiddenLibraryIds).toContain(hiddenLibrary.id);
    expect(scope.hiddenLibraryIds).not.toContain(shownLibrary.id);
  });
});
