import { TagBulkAssetsDto } from 'src/dtos/tag.dto.js';

/**
What `PUT /tags/assets` did, next to upstream's `count` (specs/2026-11-27-bulk-tag-feedback-design.md). Upstream
answers 200 with `count: 0` when it skipped every requested tag or asset, which reads as a success; these fields say
what was tagged and what was skipped.

`permittedTagIds` and `permittedAssetIds` are the sets `TagService.bulkTagAssets` linked. Links are upserted, so after
the call every permitted asset carries every permitted tag, whether the link is new or already existed. With no
permitted tag nothing was tagged.
*/
export const galleryTagBulkFeedback = (
  dto: TagBulkAssetsDto,
  permittedTagIds: Set<string>,
  permittedAssetIds: Set<string>,
) => {
  const requestedAssetIds = [...new Set(dto.assetIds)];

  return {
    taggedAssetIds: permittedTagIds.size > 0 ? requestedAssetIds.filter((id) => permittedAssetIds.has(id)) : [],
    skippedAssetIds: requestedAssetIds.filter((id) => !permittedAssetIds.has(id)),
    skippedTagIds: [...new Set(dto.tagIds).difference(permittedTagIds)],
  };
};
