import type { TimeBucketSize } from '@immich/sdk';
import type {
  AssetApiGetTimeBucketRequest,
  AssetApiGetTimeBucketsRequest,
  TimelineManagerOptions,
} from '$lib/managers/timeline-manager/types';

function getApiRequestOptions(options: TimelineManagerOptions): Omit<AssetApiGetTimeBucketsRequest, 'bucketSize'> {
  return Object.fromEntries(
    Object.entries(options).filter(
      ([key]) => !['grouping', 'timelineAlbumId', 'timelineSpaceId', 'deferInit', 'assetFilter'].includes(key),
    ),
  ) as Omit<AssetApiGetTimeBucketsRequest, 'bucketSize'>;
}

export function toTimeBucketsRequest(
  options: TimelineManagerOptions,
  bucketSize: TimeBucketSize,
): AssetApiGetTimeBucketsRequest {
  return {
    ...getApiRequestOptions(options),
    bucketSize,
  };
}

export function toTimeBucketRequest(
  options: TimelineManagerOptions,
  timeBucket: string,
  bucketSize: TimeBucketSize,
): AssetApiGetTimeBucketRequest {
  return {
    ...getApiRequestOptions(options),
    bucketSize,
    timeBucket,
  };
}
