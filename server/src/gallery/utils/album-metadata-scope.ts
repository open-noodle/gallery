import { AuthDto } from 'src/dtos/auth.dto.js';
import { SharedSpaceRole } from 'src/enum.js';
import { sharedLinkPublisherRoles } from 'src/utils/shared-link-space-tether.js';

export type AlbumMetadataScope = { forUserId?: string; spaceId?: string; memberRole?: SharedSpaceRole[] };

/**
 * #1018: a shared link counts in the ONE space it was created from, and only while its creator may still publish
 * there, so the total matches what the link serves (checkSharedLinkAccess). A link with no space counts owner rows
 * only: passing the creator's id unscoped would count contributions from every space they belong to into a public
 * link's total.
 */
export const sharedLinkAlbumMetadataScope = (link: { userId: string; spaceId?: string | null }): AlbumMetadataScope =>
  link.spaceId ? { forUserId: link.userId, spaceId: link.spaceId, memberRole: sharedLinkPublisherRoles } : {};

/**
 * The scope an album response's count and date range are computed in, so they match the grid the same
 * caller sees: their own rows plus the contributions (#764) live in a space they belong to.
 */
export const albumMetadataScope = (auth: AuthDto): AlbumMetadataScope =>
  auth.sharedLink ? sharedLinkAlbumMetadataScope(auth.sharedLink) : { forUserId: auth.user.id };
