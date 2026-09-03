// Fork-owned resolver for the "which spaces does this album browse read contributions from?"
// question — the service-side counterpart to the SQL arms in `shared-space-album-scope.ts`.
//
// A space-linked album's contents are the album owner's own `album_asset` rows UNION the cross-owner
// `album_space_asset` contributions (#764). The contributed half is never granted blindly: every
// read re-derives it from live space state, scoped to the space ids resolved HERE. Two callers need
// the same answer — the album time-bucket browse (`timeline.service`) and the album archive
// (`download.service`, #1048) — and they must agree, or "download all" ships something other than
// what the grid just showed.
import { AuthDto } from 'src/dtos/auth.dto';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { sharedLinkPublisherRoles } from 'src/utils/shared-link-space-tether';

/**
 * The live member-spaces whose contributions `albumId` may surface for this caller, or `undefined`
 * when there are none (a personal album, an `album_user` share, a pre-#1018 spaceless link) — in
 * which case the caller falls back to `album_asset` alone, exactly as before #764.
 *
 * - **Shared link**: at most the ONE space the link was created from, never the creator's full
 *   membership — that would leak a contribution from any OTHER space they happen to share the album
 *   into. Role-gated for the same reason the access tether is (#1018): a creator demoted to Viewer no
 *   longer holds the authority that published the contributions.
 * - **Authenticated**: every space the viewer is a live member of that currently links the album,
 *   any role. Not preference-filtered — a member who hid the space from their home timeline still
 *   sees the album's contributions on the album itself.
 *
 * Both branches go through `getMemberSpaceIdsLinkingAlbum`, which enforces the live album↔space
 * link, live membership, and A1 (album not soft-deleted).
 */
export const getAlbumSpaceIds = async ({
  auth,
  albumId,
  repository,
}: {
  auth: AuthDto;
  albumId: string;
  repository: SharedSpaceRepository;
}): Promise<string[] | undefined> => {
  if (auth.sharedLink) {
    const linkSpaceId = auth.sharedLink.spaceId;
    if (!linkSpaceId) {
      return undefined;
    }

    const spaceIds = await repository.getMemberSpaceIdsLinkingAlbum(albumId, auth.sharedLink.userId, {
      roles: sharedLinkPublisherRoles,
    });
    return spaceIds.includes(linkSpaceId) ? [linkSpaceId] : undefined;
  }

  const spaceIds = await repository.getMemberSpaceIdsLinkingAlbum(albumId, auth.user.id);
  return spaceIds.length > 0 ? spaceIds : undefined;
};
