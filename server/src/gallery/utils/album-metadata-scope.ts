import { AuthDto } from 'src/dtos/auth.dto.js';
import { SharedSpaceRole } from 'src/enum.js';
import { sharedLinkPublisherRoles } from 'src/utils/shared-link-space-tether.js';

export type AlbumMetadataScope = { forUserId?: string; spaceId?: string; memberRole?: SharedSpaceRole[] };

/**
#1018: a shared link counts in the ONE space it was created from, and only while its creator may still publish
there, so the total matches what the link serves (checkSharedLinkAccess). A link with no space counts owner rows
only: passing the creator's id unscoped would count contributions from every space they belong to into a public
link's total.
*/
export const sharedLinkAlbumMetadataScope = (link: { userId: string; spaceId?: string | null }): AlbumMetadataScope =>
  link.spaceId ? { forUserId: link.userId, spaceId: link.spaceId, memberRole: sharedLinkPublisherRoles } : {};

/**
The scope AlbumService.getAll counts in: the caller's own rows plus the contributions (#764) live in a space they
belong to. A stock client syncs album_asset only, so its count leaves out space contributions.
*/
export const albumListMetadataScope = (auth: AuthDto): AlbumMetadataScope => ({
  forUserId: auth.stockClient ? undefined : auth.user.id,
});

/**
The scope an album response's count and date range are computed in, so they match the grid the same
caller sees (see albumListMetadataScope and sharedLinkAlbumMetadataScope).
*/
export const albumMetadataScope = (auth: AuthDto): AlbumMetadataScope =>
  auth.sharedLink ? sharedLinkAlbumMetadataScope(auth.sharedLink) : albumListMetadataScope(auth);
