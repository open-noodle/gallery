import { AssetVisibility, PartnerDirection, getPartners } from '@immich/sdk';

export type ShareableCandidate = { id: string; ownerId: string; visibility: AssetVisibility };

// A partner's asset is shareable only while the partner query can see it (checkPartnerAccess).
const PARTNER_SHAREABLE_VISIBILITIES: ReadonlySet<AssetVisibility> = new Set([
  AssetVisibility.Timeline,
  AssetVisibility.Hidden,
]);

/**
The ids `POST /shared-spaces/:id/assets` accepts from `userId`, in input order. Mirrors the server's
`requireSpaceShareAccess` (owner ∪ partner, rbac-2): the caller's own assets, plus timeline or hidden assets of
a user who shares their library with the caller. The server rejects the whole request on any other id, so a
caller sends only these. With no `userId` nothing qualifies.
*/
export const pickSpaceShareableAssetIds = (
  assets: ShareableCandidate[],
  userId: string | undefined,
  partnerIds: ReadonlySet<string>,
): string[] => {
  if (!userId) {
    return [];
  }
  return assets
    .filter(
      ({ ownerId, visibility }) =>
        ownerId === userId || (partnerIds.has(ownerId) && PARTNER_SHAREABLE_VISIBILITIES.has(visibility)),
    )
    .map(({ id }) => id);
};

/**
`pickSpaceShareableAssetIds` with the caller's partners loaded from the server. The partner list is fetched
only when some asset belongs to someone else. If it cannot be loaded, partner assets are left out (fail closed):
the server would reject a wrong guess for the whole request.
*/
export const resolveSpaceShareableAssetIds = async (
  assets: ShareableCandidate[],
  userId: string | undefined,
): Promise<string[]> => {
  if (!userId) {
    return [];
  }
  let partnerIds = new Set<string>();
  if (assets.some(({ ownerId }) => ownerId !== userId)) {
    try {
      const partners = await getPartners({ direction: PartnerDirection.SharedWith });
      partnerIds = new Set(partners.map(({ id }) => id));
    } catch {
      partnerIds = new Set();
    }
  }
  return pickSpaceShareableAssetIds(assets, userId, partnerIds);
};
