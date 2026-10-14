import { AuthDto } from 'src/dtos/auth.dto.js';
import { AlbumUserRole, Permission } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { setDifference, setUnion } from 'src/utils/set.js';

type Grant = (access: AccessRepository, userId: string, ids: Set<string>) => Promise<Set<string>>;

const spaceAssetRead: Grant = (access, userId, ids) => access.spaceAsset.checkSpaceAccess(userId, ids);
const spaceAssetEdit: Grant = (access, userId, ids) => access.spaceAsset.checkSpaceEditAccess(userId, ids);
const spaceAlbumRead: Grant = (access, userId, ids) => access.spaceAlbum.checkSpaceLinkedAlbumReadAccess(userId, ids);
const spaceAlbumWrite: Grant = (access, userId, ids) => access.spaceAlbum.checkSpaceLinkedAlbumAccess(userId, ids);

/**
 * Fork grants that widen upstream's permission switch (utils/access.ts checkOtherAccess) for user sessions. Each runs
 * once, after upstream's grants, over the ids upstream did not grant. Shared-link sessions never reach this table:
 * checkSharedLinkAccess narrows inline, and the Person* replacement stays inline because it removes upstream grants.
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

  [Permission.SharedSpaceRead]: (access, userId, ids) => access.sharedSpace.checkMemberAccess(userId, ids),
};

export const withGalleryGrants = async (
  access: AccessRepository,
  { auth, permission, ids }: { auth: AuthDto; permission: Permission; ids: Set<string> },
  granted: Set<string>,
): Promise<Set<string>> => {
  const grant = galleryAccessGrants[permission];
  return grant ? setUnion(granted, await grant(access, auth.user.id, setDifference(ids, granted))) : granted;
};

/**
 * True when the caller reaches an album through a DIRECT grant — album owner or a shared album_user
 * (Viewer+) — as opposed to ONLY via shared-space membership (checkSpaceLinkedAlbumReadAccess, no role
 * filter). Mirrors upstream's AlbumRead case in utils/access.ts, i.e. everything AlbumRead grants BEFORE the
 * space-linked grant above is unioned in.
 *
 * When AlbumRead passed but this returns false, the caller is a "space-only reader". Used to deny
 * album-level activity (C1) and strip participant PII (security-8) for those callers, while leaving
 * genuine owners/participants untouched.
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
