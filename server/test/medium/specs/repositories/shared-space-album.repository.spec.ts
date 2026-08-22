import { Kysely } from 'kysely';
import { AlbumUserRole } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
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

const setupRead = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [AccessRepository],
    mock: [LoggingRepository],
  });
  return { ctx, accessRepo: ctx.get(AccessRepository) };
};

const seedSpaceAndAlbum = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Test Album' });
  return { user, space, album };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('SharedSpaceRepository — Album Link CRUD', () => {
  it('addAlbum inserts a link and is idempotent on (spaceId, albumId)', async () => {
    const { ctx, sut } = setup();
    const { space, album, user } = await seedSpaceAndAlbum(ctx);

    const first = await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    expect(first).toMatchObject({ spaceId: space.id, albumId: album.id, showInTimeline: true });

    const second = await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    expect(second).toBeUndefined(); // onConflict doNothing → no row returned

    const links = await sut.getLinkedAlbums(space.id);
    expect(links).toHaveLength(1);
    expect(links[0].showInTimeline).toBe(true);
  });

  it('hasAlbumLink reflects presence; removeAlbum deletes it', async () => {
    const { ctx, sut } = setup();
    const { space, album } = await seedSpaceAndAlbum(ctx);

    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: null });
    expect(await sut.hasAlbumLink(space.id, album.id)).toBe(true);

    await sut.removeAlbum(space.id, album.id);
    expect(await sut.hasAlbumLink(space.id, album.id)).toBe(false);
  });

  it('setAlbumShowInTimeline toggles the flag', async () => {
    const { ctx, sut } = setup();
    const { space, album } = await seedSpaceAndAlbum(ctx);

    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: null });
    await sut.setAlbumShowInTimeline(space.id, album.id, false);

    const links = await sut.getLinkedAlbums(space.id);
    expect(links).toHaveLength(1);
    expect(links[0].showInTimeline).toBe(false);
  });

  it('getLinkedAlbums excludes soft-deleted albums', async () => {
    const { ctx, sut } = setup();
    const { space, album } = await seedSpaceAndAlbum(ctx);

    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: null });
    await ctx.softDeleteAlbum(album.id);

    const links = await sut.getLinkedAlbums(space.id);
    expect(links).toHaveLength(0);
  });

  it('getSpacesLinkedToAlbum returns spaces containing the album', async () => {
    const { ctx, sut } = setup();
    const { space, album } = await seedSpaceAndAlbum(ctx);

    expect(await sut.getSpacesLinkedToAlbum(album.id)).toHaveLength(0);

    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: null });

    const spaces = await sut.getSpacesLinkedToAlbum(album.id);
    expect(spaces.map((s) => s.spaceId)).toContain(space.id);
  });
});

describe('getAlbumAssetIdsWithoutOtherSpacePath', () => {
  it('excludes assets with a direct, another-album, or library path to the space', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });

    const { result: albumA } = await ctx.newAlbum({ ownerId: user.id, albumName: 'AlbumA' });

    const { asset: a1 } = await ctx.newAsset({ ownerId: user.id });
    const { asset: a2 } = await ctx.newAsset({ ownerId: user.id });
    const { asset: a3 } = await ctx.newAsset({ ownerId: user.id });

    await ctx.newAlbumAsset({ albumId: albumA.id, assetId: a1.id });
    await ctx.newAlbumAsset({ albumId: albumA.id, assetId: a2.id });
    await ctx.newAlbumAsset({ albumId: albumA.id, assetId: a3.id });

    await sut.addAlbum({ spaceId: space.id, albumId: albumA.id, addedById: user.id });

    // a2: direct-add to space
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: a2.id });

    // a3: in another album D linked to space
    const { result: albumD } = await ctx.newAlbum({ ownerId: user.id, albumName: 'AlbumD' });
    await ctx.newAlbumAsset({ albumId: albumD.id, assetId: a3.id });
    await sut.addAlbum({ spaceId: space.id, albumId: albumD.id, addedById: user.id });

    const result = await sut.getAlbumAssetIdsWithoutOtherSpacePath(space.id, albumA.id);
    expect(new Set(result)).toEqual(new Set([a1.id]));
  });

  it('excludes assets whose library is linked to the space', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { result: library } = await ctx.newLibrary({ ownerId: user.id });

    const { result: albumA } = await ctx.newAlbum({ ownerId: user.id, albumName: 'LibAlbumA' });

    // a1: normal asset, only in album A
    const { asset: a1 } = await ctx.newAsset({ ownerId: user.id });
    // a4: asset belonging to linked library
    const { asset: a4 } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });

    await ctx.newAlbumAsset({ albumId: albumA.id, assetId: a1.id });
    await ctx.newAlbumAsset({ albumId: albumA.id, assetId: a4.id });

    await sut.addAlbum({ spaceId: space.id, albumId: albumA.id, addedById: user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    const result = await sut.getAlbumAssetIdsWithoutOtherSpacePath(space.id, albumA.id);
    expect(new Set(result)).toEqual(new Set([a1.id]));
  });

  // #752 F1 (launch review): the severed album's CONTRIBUTED memberships (album_space_asset) are
  // candidates too — an asset whose only space path was a contribution into this album must be
  // swept, or its projected faces outlive the link.
  it('includes an asset whose only space path is a contribution into the severed album', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: contributor } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    const { result: albumA } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'ContribAlbumA' });
    await sut.addAlbum({ spaceId: space.id, albumId: albumA.id, addedById: owner.id });

    // X reaches the space ONLY via a contribution into A — no album_asset row, not in the space
    // pool, no library path.
    const { asset: x } = await ctx.newAsset({ ownerId: contributor.id });
    await ctx.newAlbumSpaceAsset({ albumId: albumA.id, assetId: x.id, spaceId: space.id, addedById: contributor.id });

    const result = await sut.getAlbumAssetIdsWithoutOtherSpacePath(space.id, albumA.id);
    expect(result).toContain(x.id);
  });

  it('retains an asset still contributed into ANOTHER linked album of the same space', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: contributor } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    const { result: albumA } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'ContribAlbumA2' });
    const { result: albumB } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'ContribAlbumB2' });
    await sut.addAlbum({ spaceId: space.id, albumId: albumA.id, addedById: owner.id });
    await sut.addAlbum({ spaceId: space.id, albumId: albumB.id, addedById: owner.id });

    const { asset: x } = await ctx.newAsset({ ownerId: contributor.id });
    await ctx.newAlbumSpaceAsset({ albumId: albumA.id, assetId: x.id, spaceId: space.id, addedById: contributor.id });
    // X is ALSO contributed into B — B still links X into the space after A is severed.
    await ctx.newAlbumSpaceAsset({ albumId: albumB.id, assetId: x.id, spaceId: space.id, addedById: contributor.id });

    const result = await sut.getAlbumAssetIdsWithoutOtherSpacePath(space.id, albumA.id);
    expect(result).not.toContain(x.id);
  });

  it('retains a contributed asset that is also directly in the space pool', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: contributor } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    const { result: albumA } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'ContribAlbumA3' });
    await sut.addAlbum({ spaceId: space.id, albumId: albumA.id, addedById: owner.id });

    const { asset: x } = await ctx.newAsset({ ownerId: contributor.id });
    await ctx.newAlbumSpaceAsset({ albumId: albumA.id, assetId: x.id, spaceId: space.id, addedById: contributor.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: x.id });

    const result = await sut.getAlbumAssetIdsWithoutOtherSpacePath(space.id, albumA.id);
    expect(result).not.toContain(x.id);
  });
});

describe('getAssetCount — soft-deleted album', () => {
  it('getAssetCount excludes assets from a soft-deleted linked album', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });

    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'SoftDeletedAlbum' });
    const { asset: a1 } = await ctx.newAsset({ ownerId: user.id });
    const { asset: a2 } = await ctx.newAsset({ ownerId: user.id });
    const { asset: a3 } = await ctx.newAsset({ ownerId: user.id });

    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a2.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a3.id });

    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    // Before soft-delete: all 3 assets counted
    expect(await sut.getAssetCount(space.id)).toBe(3);

    // Soft-delete the album (link row survives via FK deferral)
    await ctx.softDeleteAlbum(album.id);

    // After soft-delete: album assets must NOT be counted
    expect(await sut.getAssetCount(space.id)).toBe(0);
  });
});

describe('getAlbumAssetCount', () => {
  it('returns 3 for an album with 3 live assets, then 2 after one is soft-deleted', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'CountAlbum' });

    const { asset: a1 } = await ctx.newAsset({ ownerId: user.id });
    const { asset: a2 } = await ctx.newAsset({ ownerId: user.id });
    const { asset: a3 } = await ctx.newAsset({ ownerId: user.id });

    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a2.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a3.id });

    expect(await sut.getAlbumAssetCount(album.id)).toBe(3);

    // Soft-delete one asset — count must exclude it
    await ctx.softDeleteAsset(a3.id);

    expect(await sut.getAlbumAssetCount(album.id)).toBe(2);
  });
});

describe('AccessRepository.album.checkSpaceLinkedAlbumReadAccess', () => {
  it('viewer member is allowed to read a linked album', async () => {
    const { ctx, accessRepo } = setupRead();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'ReadAccess-viewer' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const result = await accessRepo.album.checkSpaceLinkedAlbumReadAccess(viewer.id, new Set([album.id]));
    expect(result.has(album.id)).toBe(true);
  });

  it('editor member is allowed to read a linked album', async () => {
    const { ctx, accessRepo } = setupRead();
    const { user: owner } = await ctx.newUser();
    const { user: editor } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: 'editor' });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'ReadAccess-editor' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const result = await accessRepo.album.checkSpaceLinkedAlbumReadAccess(editor.id, new Set([album.id]));
    expect(result.has(album.id)).toBe(true);
  });

  it('non-member is denied read on a linked album', async () => {
    const { ctx, accessRepo } = setupRead();
    const { user: owner } = await ctx.newUser();
    const { user: nonMember } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'ReadAccess-nonmember' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const result = await accessRepo.album.checkSpaceLinkedAlbumReadAccess(nonMember.id, new Set([album.id]));
    expect(result.has(album.id)).toBe(false);
  });

  it('a not-linked album is denied even for a space member', async () => {
    const { ctx, accessRepo } = setupRead();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });
    // Album B is NOT linked to the space
    const { result: albumB } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'ReadAccess-notlinked' });

    const result = await accessRepo.album.checkSpaceLinkedAlbumReadAccess(viewer.id, new Set([albumB.id]));
    expect(result.has(albumB.id)).toBe(false);
  });

  it('dual-path: user who is BOTH a space member AND an album_user returns album once', async () => {
    const { ctx, accessRepo } = setupRead();
    const { user: owner } = await ctx.newUser();
    const { user: dual } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: dual.id, role: 'viewer' });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'ReadAccess-dual' });
    // dual is also an album_user on the album
    await ctx.newAlbumUser({ albumId: album.id, userId: dual.id, role: AlbumUserRole.Viewer });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const result = await accessRepo.album.checkSpaceLinkedAlbumReadAccess(dual.id, new Set([album.id]));
    // DISTINCT ensures the album appears exactly once
    expect([...result]).toHaveLength(1);
    expect(result.has(album.id)).toBe(true);
  });
});

describe('AccessRepository.person.checkSharedSpaceAccess — album leg', () => {
  it('GRANT — person whose only visible face is on an asset in a linked album is returned', async () => {
    const { ctx, accessRepo } = setupRead();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'PersonReadAlbum' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    const { person } = await ctx.newPerson({ ownerId: owner.id, name: 'AlbumFacePerson' });
    await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });

    const result = await accessRepo.person.checkSharedSpaceAccess(member.id, new Set([person.personGroupId]));

    expect(result.has(person.personGroupId)).toBe(true);
  });

  it('DENY — non-member gets empty set for person accessible only via linked album', async () => {
    const { ctx, accessRepo } = setupRead();
    const { user: owner } = await ctx.newUser();
    const { user: nonMember } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'PersonDenyAlbum' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    const { person } = await ctx.newPerson({ ownerId: owner.id, name: 'DenyAlbumPerson' });
    await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });

    const result = await accessRepo.person.checkSharedSpaceAccess(nonMember.id, new Set([person.personGroupId]));

    expect(result.has(person.personGroupId)).toBe(false);
  });
});

const seedPersonOnSpaceLinkedAlbum = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user: owner } = await ctx.newUser();
  const { user: editor } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: 'editor' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });
  const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'PersonEditAlbum' });
  await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
  const { person } = await ctx.newPerson({ ownerId: owner.id, name: 'EditAlbumPerson' });
  await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
  return { editor, viewer, person };
};

// Slice 3 — M2: checkSharedSpaceEditAccess mirrors checkSharedSpaceAccess but additionally requires
// the caller's shared_space_member.role to be Owner or Editor — a Viewer must get an empty set even
// though checkSharedSpaceAccess (read) grants them.
describe('AccessRepository.person.checkSharedSpaceEditAccess — album leg (M2)', () => {
  it('GRANT — an Editor of the space is returned', async () => {
    const { ctx, accessRepo } = setupRead();
    const { editor, person } = await seedPersonOnSpaceLinkedAlbum(ctx);

    const result = await accessRepo.person.checkSharedSpaceEditAccess(editor.id, new Set([person.personGroupId]));

    expect(result.has(person.personGroupId)).toBe(true);
  });

  it('DENY — a Viewer of the same space gets an empty set even though read access is granted', async () => {
    const { ctx, accessRepo } = setupRead();
    const { viewer, person } = await seedPersonOnSpaceLinkedAlbum(ctx);

    const readResult = await accessRepo.person.checkSharedSpaceAccess(viewer.id, new Set([person.personGroupId]));
    expect(readResult.has(person.personGroupId)).toBe(true); // sanity: viewer DOES have read access

    const editResult = await accessRepo.person.checkSharedSpaceEditAccess(viewer.id, new Set([person.personGroupId]));
    expect(editResult.has(person.personGroupId)).toBe(false);
  });
});

describe('getRecentAssets and getNewAssetCount — album leg (C2 consistency)', () => {
  it('album-only space: getRecentAssets returns album image assets, getNewAssetCount counts them, both equal getAssetCount', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'RecentAlbum' });

    const thumbhash = Buffer.from('deadbeef', 'hex');
    const createdAt = new Date('2024-01-01T00:00:00Z');
    const { asset: a1 } = await ctx.newAsset({ ownerId: user.id, thumbhash, createdAt });
    const { asset: a2 } = await ctx.newAsset({ ownerId: user.id, thumbhash, createdAt });
    const { asset: a3 } = await ctx.newAsset({ ownerId: user.id, thumbhash, createdAt });

    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a2.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a3.id });

    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    const recentAssets = await sut.getRecentAssets(space.id);
    expect(recentAssets).toHaveLength(3);
    const recentIds = recentAssets.map((a) => a.id);
    expect(recentIds).toContain(a1.id);
    expect(recentIds).toContain(a2.id);
    expect(recentIds).toContain(a3.id);

    const newCount = await sut.getNewAssetCount(space.id, new Date(0));
    expect(newCount).toBe(3);

    const totalCount = await sut.getAssetCount(space.id);
    expect(totalCount).toBe(newCount);
  });
});

describe('isFaceInSpace — album leg', () => {
  it('returns true when face belongs to an asset in a linked album', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });

    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'FaceAlbum' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    const { result: faceId } = await ctx.newAssetFace({ assetId: asset.id });

    expect(await sut.isFaceInSpace(space.id, faceId)).toBe(true);
  });

  it('returns false when face belongs to an asset not in any linked album, library, or direct-add', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });

    // Unrelated asset — not in any space path
    const { asset: unrelatedAsset } = await ctx.newAsset({ ownerId: user.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId: unrelatedAsset.id });

    expect(await sut.isFaceInSpace(space.id, faceId)).toBe(false);
  });
});

describe('face-pipeline gates honor album.deletedAt (faces F3a)', () => {
  it('isAssetInSpace and getSpaceIdsForAsset exclude a soft-deleted album', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'GateAlbum' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    // Live album: the asset resolves as in-space and the face pipeline queues the space.
    expect(await sut.isAssetInSpace(space.id, asset.id)).toBe(true);
    const liveSpaceIds = await sut.getSpaceIdsForAsset(asset.id);
    expect(liveSpaceIds.map((r) => r.spaceId)).toContain(space.id);

    await ctx.softDeleteAlbum(album.id);

    // Soft-deleted album: both gates must stop resolving its assets (A1 invariant).
    expect(await sut.isAssetInSpace(space.id, asset.id)).toBe(false);
    const deletedSpaceIds = await sut.getSpaceIdsForAsset(asset.id);
    expect(deletedSpaceIds.map((r) => r.spaceId)).not.toContain(space.id);
  });

  it('keeps an asset in-space via a surviving direct path when its album is soft-deleted', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'GateDualAlbum' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });

    await ctx.softDeleteAlbum(album.id);

    // Direct path survives the album soft-delete.
    expect(await sut.isAssetInSpace(space.id, asset.id)).toBe(true);
    const spaceIds = await sut.getSpaceIdsForAsset(asset.id);
    expect(spaceIds.map((r) => r.spaceId)).toContain(space.id);
  });
});
