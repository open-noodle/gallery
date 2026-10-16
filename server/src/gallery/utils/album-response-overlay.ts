import type { AlbumResponseDto } from 'src/dtos/album.dto.js';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import type { AccessRepository } from 'src/repositories/access.repository.js';
import type { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { AlbumUserRole } from 'src/enum.js';
import { hasDirectAlbumReadAccess } from 'src/gallery/utils/access-grants.js';

type AlbumResponseOverlayDependencies = {
  access: AccessRepository;
  sharedSpace: SharedSpaceRepository;
};

/**
 * The scope AlbumService.getAll passes to AlbumRepository.getMetadataForIds. Stock sync streams album_asset only, so a
 * stock client's count leaves out space contributions.
 */
export const albumListMetadataScope = (auth: AuthDto): { forUserId?: string } => ({
  forUserId: auth.stockClient ? undefined : auth.user.id,
});

/**
 * The scope AlbumService.get passes to AlbumRepository.getMetadataForIds. #1018: for a shared link the count is scoped
 * to the ONE space the link was created from, so it matches the grid the link renders. A link with no space counts
 * owner rows only, as before — passing the creator's id unscoped would count contributions from every space they
 * belong to.
 */
export const albumMetadataScope = (auth: AuthDto): { forUserId?: string; spaceId?: string } => {
  if (auth.sharedLink) {
    return auth.sharedLink.spaceId
      ? { forUserId: auth.sharedLink.userId, spaceId: auth.sharedLink.spaceId }
      : { forUserId: undefined };
  }
  return albumListMetadataScope(auth);
};

/**
 * Fork overlay on GET /albums/:id (AlbumService.get). `hasDirectAccess` gates upstream's contributorCounts (L1:
 * contributor userIds + per-user asset counts are the same PII security-8 gates the rest of albumUsers behind), and
 * `apply` redacts albumUsers for a space-only reader and adds the owner-only `sharedSpaceLinks` (rbac-6).
 */
export const getAlbumResponseOverlay = async (
  deps: AlbumResponseOverlayDependencies,
  { auth, id }: { auth: AuthDto; id: string },
) => {
  // security-8: a caller who reaches the album ONLY through shared-space membership (not the album owner
  // or a shared album_user) must not see other participants' PII (id / name / role / profile image /
  // email). Strip albumUsers down to the album owner (display name only, email redacted), matching
  // getLinkedAlbums; genuine participants and shared-link callers keep the full list.
  const hasDirectAccess = !!auth.sharedLink || (await hasDirectAlbumReadAccess(deps.access, auth.user.id, id));

  const apply = async (response: AlbumResponseDto): Promise<AlbumResponseDto> => {
    if (!hasDirectAccess) {
      const ownerAlbumUser = response.albumUsers.find(({ role }) => role === AlbumUserRole.Owner);
      response.albumUsers = ownerAlbumUser ? [ownerAlbumUser] : response.albumUsers.slice(0, 1);
      for (const albumUser of response.albumUsers) {
        albumUser.user.email = '';
      }
    }

    // rbac-6: the album OWNER (and only the owner) sees the list of shared spaces this album is
    // linked into, so they can review + revoke links (a space editor can link an owner's album).
    // Non-owner callers — including album editors/viewers and space-only readers — get no list.
    // A shared-link visitor is explicitly excluded even though checkOwnerAccess would return true
    // for one (shared-link AuthDto.user.id resolves to the link creator/album owner for access
    // checks) — a public link is not an authenticated owner session and must never expose the
    // owner-only space-link list to whoever holds the link URL.
    let isAlbumOwner = false;
    if (!auth.sharedLink) {
      const ownerIds = await deps.access.album.checkOwnerAccess(auth.user.id, new Set([id]));
      isAlbumOwner = ownerIds.has(id);
    }
    let sharedSpaceLinks: AlbumResponseDto['sharedSpaceLinks'];
    if (isAlbumOwner) {
      const links = await deps.sharedSpace.getAlbumSpaceLinks(id);
      // Omit the field entirely when the album has no space links, so a plain album's response shape is
      // unchanged (the field only appears for the owner when there is at least one link to surface).
      if (links.length > 0) {
        sharedSpaceLinks = links.map((link) => ({
          spaceId: link.spaceId,
          spaceName: link.spaceName,
          linkedById: link.linkedById,
          showInTimeline: link.showInTimeline,
        }));
      }
    }

    return { ...response, sharedSpaceLinks };
  };

  return { hasDirectAccess, apply };
};
