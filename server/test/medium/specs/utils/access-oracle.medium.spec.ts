/**
 * Access oracle: runs checkAccess for every Permission, for a fixed cast of actors, over every fixture id, and
 * snapshots the granted ids by label. Any change to who can reach what shows up as a snapshot diff, so a refactor of
 * the grant code (upstream switch plus src/gallery/utils/access-grants.ts) must leave this file's snapshot untouched.
 * A new upstream Permission adds a snapshot entry: review it, then update with `-u`.
 */
import { Kysely } from 'kysely';
import { AlbumUserRole, AssetVisibility, Permission, SharedLinkType } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { checkAccess } from 'src/utils/access.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const seed = async () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [AccessRepository],
    mock: [LoggingRepository],
  });

  const { user: owner } = await ctx.newUser();
  const { user: spaceEditor } = await ctx.newUser();
  const { user: spaceViewer } = await ctx.newUser();
  const { user: partner } = await ctx.newUser();
  const { user: albumViewer } = await ctx.newUser();
  const { user: stranger } = await ctx.newUser();

  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: spaceEditor.id, role: 'editor' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: spaceViewer.id, role: 'viewer' });
  await ctx.newPartner({ sharedById: owner.id, sharedWithId: partner.id });

  const { asset: ownAsset } = await ctx.newAsset({ ownerId: owner.id });
  const { asset: spaceAsset } = await ctx.newAsset({ ownerId: owner.id });
  const { asset: lockedSpaceAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });
  const { asset: editorAsset } = await ctx.newAsset({ ownerId: spaceEditor.id });
  const { asset: albumSpaceAsset } = await ctx.newAsset({ ownerId: owner.id });
  const { library } = await ctx.newLibrary({ ownerId: owner.id });
  const { asset: libraryAsset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
  const { asset: stackAsset } = await ctx.newAsset({ ownerId: owner.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: spaceAsset.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: lockedSpaceAsset.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: editorAsset.id });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

  const { album: ownAlbum } = await ctx.newAlbum({ ownerId: owner.id }, [ownAsset.id]);
  await ctx.newAlbumUser({ albumId: ownAlbum.id, userId: albumViewer.id, role: AlbumUserRole.Viewer });
  const { album: spaceAlbum } = await ctx.newAlbum({ ownerId: owner.id }, [albumSpaceAsset.id]);
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: spaceAlbum.id });

  const { person: spacePerson } = await ctx.newPerson({ ownerId: owner.id });
  const { person: privatePerson } = await ctx.newPerson({ ownerId: owner.id });
  const { result: spaceFace } = await ctx.newAssetFace({
    assetId: spaceAsset.id,
    personGroupId: spacePerson.personGroupId,
  });
  const { result: privateFace } = await ctx.newAssetFace({
    assetId: ownAsset.id,
    personGroupId: privatePerson.personGroupId,
  });

  const { memory } = await ctx.newMemory({ ownerId: owner.id });
  const { stack } = await ctx.newStack({ ownerId: owner.id }, [stackAsset.id, ownAsset.id]);
  const { tag } = await ctx.newTag({ userId: owner.id, value: 'oracle' });
  const { session } = await ctx.newSession({ userId: owner.id });

  const { sharedLink: albumLink } = await ctx.newSharedLink({
    userId: owner.id,
    type: SharedLinkType.Album,
    albumId: ownAlbum.id,
  });
  const { sharedLink: spaceLink } = await ctx.newSharedLink({
    userId: owner.id,
    type: SharedLinkType.Individual,
    spaceId: space.id,
    assetIds: [spaceAsset.id, editorAsset.id],
  });

  // Grant branches the fixtures above leave unexercised: a cross-owner album contribution (album_space_asset), an
  // archived space asset (the Archive half of spaceVisibleAssetVisibilities), people reached only through the library
  // and album arms of spaceAssetPathBranches, and an album link made from the space (shared-link contributedAssets).
  const { asset: contributedAsset } = await ctx.newAsset({ ownerId: spaceEditor.id });
  await ctx.newAlbumSpaceAsset({
    albumId: spaceAlbum.id,
    assetId: contributedAsset.id,
    spaceId: space.id,
    addedById: spaceEditor.id,
  });
  const { asset: archivedSpaceAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: archivedSpaceAsset.id });
  const { person: libraryPerson } = await ctx.newPerson({ ownerId: owner.id });
  const { result: libraryFace } = await ctx.newAssetFace({
    assetId: libraryAsset.id,
    personGroupId: libraryPerson.personGroupId,
  });
  const { person: albumPerson } = await ctx.newPerson({ ownerId: owner.id });
  const { result: albumFace } = await ctx.newAssetFace({
    assetId: albumSpaceAsset.id,
    personGroupId: albumPerson.personGroupId,
  });
  const { sharedLink: spaceAlbumLink } = await ctx.newSharedLink({
    userId: owner.id,
    type: SharedLinkType.Album,
    albumId: spaceAlbum.id,
    spaceId: space.id,
  });

  // #1243: a stack whose photos are all in the space (members may read it), and one with a photo outside the space
  // (owner only, or the stack would hand that photo to members). Their assets stay unlabeled, so only the stack
  // labels are new.
  const { asset: spaceStackCover } = await ctx.newAsset({ ownerId: owner.id });
  const { asset: spaceStackOriginal } = await ctx.newAsset({ ownerId: owner.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: spaceStackCover.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: spaceStackOriginal.id });
  const { stack: spaceStack } = await ctx.newStack({ ownerId: owner.id }, [spaceStackCover.id, spaceStackOriginal.id]);
  const { asset: partialStackCover } = await ctx.newAsset({ ownerId: owner.id });
  const { asset: partialStackPrivate } = await ctx.newAsset({ ownerId: owner.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: partialStackCover.id });
  const { stack: partialSpaceStack } = await ctx.newStack({ ownerId: owner.id }, [
    partialStackCover.id,
    partialStackPrivate.id,
  ]);
  // ...and one whose photos reach the space only through its linked album.
  const { asset: albumStackCover } = await ctx.newAsset({ ownerId: owner.id });
  const { asset: albumStackOriginal } = await ctx.newAsset({ ownerId: owner.id });
  await ctx.newAlbumAsset({ albumId: spaceAlbum.id, assetId: albumStackCover.id });
  await ctx.newAlbumAsset({ albumId: spaceAlbum.id, assetId: albumStackOriginal.id });
  const { stack: albumSpaceStack } = await ctx.newStack({ ownerId: owner.id }, [
    albumStackCover.id,
    albumStackOriginal.id,
  ]);

  const labels = new Map<string, string>(
    Object.entries({
      owner: owner.id,
      spaceEditor: spaceEditor.id,
      spaceViewer: spaceViewer.id,
      partner: partner.id,
      albumViewer: albumViewer.id,
      stranger: stranger.id,
      space: space.id,
      ownAsset: ownAsset.id,
      spaceAsset: spaceAsset.id,
      lockedSpaceAsset: lockedSpaceAsset.id,
      editorAsset: editorAsset.id,
      albumSpaceAsset: albumSpaceAsset.id,
      libraryAsset: libraryAsset.id,
      stackAsset: stackAsset.id,
      ownAlbum: ownAlbum.id,
      spaceAlbum: spaceAlbum.id,
      spacePerson: spacePerson.personGroupId,
      privatePerson: privatePerson.personGroupId,
      spaceFace,
      privateFace,
      memory: memory.id,
      stack: stack.id,
      tag: tag.id,
      session: session.id,
      albumLink: albumLink.id,
      spaceLink: spaceLink.id,
      contributedAsset: contributedAsset.id,
      archivedSpaceAsset: archivedSpaceAsset.id,
      libraryPerson: libraryPerson.personGroupId,
      albumPerson: albumPerson.personGroupId,
      libraryFace,
      albumFace,
      spaceAlbumLink: spaceAlbumLink.id,
      spaceStack: spaceStack.id,
      partialSpaceStack: partialSpaceStack.id,
      albumSpaceStack: albumSpaceStack.id,
    }).map(([label, id]) => [id as string, label]),
  );

  const user = (id: string, sessionId?: string) =>
    factory.auth({ user: { id }, session: sessionId ? { id: sessionId } : undefined });
  const actors = {
    owner: user(owner.id, session.id),
    spaceEditor: user(spaceEditor.id),
    spaceViewer: user(spaceViewer.id),
    partner: user(partner.id),
    albumViewer: user(albumViewer.id),
    stranger: user(stranger.id),
    albumLink: factory.auth({ user: { id: owner.id }, sharedLink: { id: albumLink.id, albumId: ownAlbum.id } }),
    spaceLink: factory.auth({
      user: { id: owner.id },
      sharedLink: { id: spaceLink.id, spaceId: space.id, allowUpload: true },
    }),
    spaceAlbumLink: factory.auth({
      user: { id: owner.id },
      sharedLink: { id: spaceAlbumLink.id, albumId: spaceAlbum.id, spaceId: space.id },
    }),
  };

  return { accessRepo: ctx.get(AccessRepository), labels, actors };
};

let world: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
  world = await seed();
});

describe('checkAccess oracle', () => {
  it.each(Object.values(Permission))('%s', async (permission) => {
    const { accessRepo, labels, actors } = world;
    const granted: Record<string, string[]> = {};
    for (const [actor, auth] of Object.entries(actors)) {
      const ids = await checkAccess(accessRepo, { auth, permission, ids: labels.keys().toArray() });
      const names = ids
        .values()
        .map((id) => labels.get(id) ?? `unknown:${id}`)
        .toArray()
        .toSorted();
      if (names.length > 0) {
        granted[actor] = names;
      }
    }
    expect(granted).toMatchSnapshot();
  });
});
