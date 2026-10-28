import { BadRequestException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { AlbumUserRole, Permission } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';

type Grant = (access: AccessRepository, userId: string, ids: Set<string>) => Promise<Set<string>>;

const spaceAssetRead: Grant = (access, userId, ids) => access.spaceAsset.checkSpaceAccess(userId, ids);
const spaceAssetEdit: Grant = (access, userId, ids) => access.spaceAsset.checkSpaceEditAccess(userId, ids);
const spaceStackRead: Grant = (access, userId, ids) => access.spaceAsset.checkSpaceStackAccess(userId, ids);
const spaceAlbumRead: Grant = (access, userId, ids) => access.spaceAlbum.checkSpaceLinkedAlbumReadAccess(userId, ids);
const spaceAlbumWrite: Grant = (access, userId, ids) => access.spaceAlbum.checkSpaceLinkedAlbumAccess(userId, ids);

/**
Fork grants that widen upstream's permission switch (utils/access.ts checkOtherAccess) for user sessions. Each runs
once, after upstream's grants, over the ids upstream did not grant. Shared-link sessions never reach this table:
checkSharedLinkAccess narrows inline, and the Person* replacement stays inline because it removes upstream grants.
*/
export const galleryAccessGrants: Partial<Record<Permission, Grant>> = {
  [Permission.AssetRead]: spaceAssetRead,
  [Permission.AssetView]: spaceAssetRead,
  [Permission.AssetDownload]: spaceAssetRead,

  // #734: asset edits (rotate/crop/trim and revert) follow AssetUpdate: owner OR space Owner/Editor over a member's
  // asset. AssetEditGet is included for consistency, not because a call site needs it today:
  // AssetService.getAssetEdits gates per-asset on AssetRead (which already admits space members), and AssetEditGet
  // currently reaches only the controller's route-scope decorator, never checkAccess. Leaving it owner-only would make
  // it narrower than the read path it names, so a future call site routed through it would silently disagree with
  // Create and Delete.
  [Permission.AssetUpdate]: spaceAssetEdit,
  [Permission.AssetEditGet]: spaceAssetEdit,
  [Permission.AssetEditCreate]: spaceAssetEdit,
  [Permission.AssetEditDelete]: spaceAssetEdit,

  [Permission.AlbumRead]: spaceAlbumRead,
  [Permission.AlbumDownload]: spaceAlbumRead,
  [Permission.AlbumAssetCreate]: spaceAlbumWrite,
  [Permission.AlbumAssetDelete]: spaceAlbumWrite,

  // #1243: the viewer's stack strip. StackUpdate and StackDelete stay with the owner.
  [Permission.StackRead]: spaceStackRead,

  [Permission.SharedSpaceRead]: (access, userId, ids) => access.sharedSpace.checkMemberAccess(userId, ids),
};

export const withGalleryGrants = async (
  access: AccessRepository,
  { auth, permission, ids }: { auth: AuthDto; permission: Permission; ids: Set<string> },
  granted: Set<string>,
): Promise<Set<string>> => {
  const grant = galleryAccessGrants[permission];
  return grant ? granted.union(await grant(access, auth.user.id, ids.difference(granted))) : granted;
};

/**
True when the caller reaches an album through a DIRECT grant — album owner or a shared album_user
(Viewer+) — as opposed to ONLY via shared-space membership (checkSpaceLinkedAlbumReadAccess, no role
filter). Mirrors upstream's AlbumRead case in utils/access.ts, i.e. everything AlbumRead grants BEFORE the
space-linked grant above is unioned in.

When AlbumRead passed but this returns false, the caller is a "space-only reader". Used to deny
album-level activity (C1) and strip participant PII (security-8) for those callers, while leaving
genuine owners/participants untouched.
*/
export const hasDirectAlbumReadAccess = async (
  access: AccessRepository,
  userId: string,
  albumId: string,
): Promise<boolean> => {
  const ids = new Set([albumId]);
  const isOwner = await access.album.checkOwnerAccess(userId, ids);
  if (isOwner.has(albumId)) {
    return true;
  }
  const isShared = await access.album.checkSharedAlbumAccess(userId, ids, AlbumUserRole.Viewer);
  return isShared.has(albumId);
};

/**
AssetShare as it stood before immich-32609: owner ∪ partner, without upstream's new album arm.

Upstream lets an album member re-share the album's assets (adding them to their own albums). Gallery keeps that
for albums, but not for adding assets to a space: a space Owner/Editor holds AssetUpdate over every space asset
(checkSpaceEditAccess), so an album Viewer adding the owner's photos to their own space would turn read access into
write access (rbac-2). SharedSpaceService.addAssets uses this instead of Permission.AssetShare.
*/
export const requireSpaceShareAccess = async (access: AccessRepository, auth: AuthDto, assetIds: string[]) => {
  const ids = new Set(assetIds);
  const owned = await access.asset.checkOwnerAccess(auth.user.id, ids, false);
  const partner = await access.asset.checkPartnerAccess(auth.user.id, ids.difference(owned));
  if (owned.union(partner).size !== ids.size) {
    throw new BadRequestException(`Not found or no ${Permission.AssetShare} access`);
  }
};
