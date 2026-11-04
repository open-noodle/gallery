import type { TimelineAsset } from '#lib/managers/timeline-manager/types.ts';
import { fromTimelinePlainDateTime } from '#lib/utils/timeline-util.ts';
import type { TimeBucketAssetResponseDto } from '@immich/sdk';

// The time-bucket response for a set of timeline assets. Upstream inlined its copy into the one spec that
// used it (immich-32879); Gallery's specs share this one, which also fills `createdAt`.
export const toResponseDto = (...timelineAsset: TimelineAsset[]) => {
  const bucketAssets: TimeBucketAssetResponseDto = {
    city: [],
    country: [],
    duration: [],
    id: [],
    visibility: [],
    isFavorite: [],
    isImage: [],
    isTrashed: [],
    livePhotoVideoId: [],
    fileCreatedAt: [],
    localOffsetHours: [],
    createdAt: [],
    ownerId: [],
    projectionType: [],
    ratio: [],
    stack: [],
    thumbhash: [],
  };
  for (const asset of timelineAsset) {
    const fileCreatedAt = fromTimelinePlainDateTime(asset.fileCreatedAt).toISO();
    bucketAssets.city?.push(asset.city);
    bucketAssets.country?.push(asset.country);
    bucketAssets.duration.push(asset.duration!);
    bucketAssets.id.push(asset.id);
    bucketAssets.visibility.push(asset.visibility);
    bucketAssets.isFavorite.push(asset.isFavorite);
    bucketAssets.isImage.push(asset.isImage);
    bucketAssets.isTrashed.push(asset.isTrashed);
    bucketAssets.livePhotoVideoId.push(asset.livePhotoVideoId!);
    bucketAssets.fileCreatedAt.push(fileCreatedAt);
    bucketAssets.createdAt.push(fromTimelinePlainDateTime(asset.createdAt).toISO());
    bucketAssets.ownerId.push(asset.ownerId);
    bucketAssets.projectionType.push(asset.projectionType!);
    bucketAssets.ratio.push(asset.ratio);
    bucketAssets.stack?.push(asset.stack ? [asset.stack.id, asset.stack.assetCount.toString()] : null);
    bucketAssets.thumbhash.push(asset.thumbhash!);
  }

  return bucketAssets;
};
