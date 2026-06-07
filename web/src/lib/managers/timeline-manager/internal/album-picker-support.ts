import {
  AssetOrder,
  type TimeBucketAssetResponseDto,
  type TimeBucketSize,
  type TimeBucketsResponseDto,
} from '@immich/sdk';
import type { AssetApiGetTimeBucketsRequest, TimelineManagerOptions } from '../types';
import { toTimeBucketsRequest } from './request-options';

type RepresentativeMetadata = Pick<
  TimeBucketsResponseDto,
  'representativeAssetId' | 'representativeThumbhash' | 'representativeRatio'
>;

export function getTimelineAlbumQueryOptions(
  options: TimelineManagerOptions,
  bucketSize: TimeBucketSize,
): AssetApiGetTimeBucketsRequest | undefined {
  if (!options.timelineAlbumId) {
    return;
  }

  const requestOptions = toTimeBucketsRequest(options, bucketSize);
  const rest = Object.fromEntries(
    Object.entries(requestOptions).filter(([key]) => !['userId', 'withPartners', 'withSharedSpaces'].includes(key)),
  ) as AssetApiGetTimeBucketsRequest;

  return { ...rest, albumId: options.timelineAlbumId };
}

function getRepresentativeMetadata(
  preferred: TimeBucketsResponseDto | undefined,
  fallback: TimeBucketsResponseDto,
): Partial<RepresentativeMetadata> {
  const bucket = preferred?.representativeAssetId == null ? fallback : preferred;

  if (bucket.representativeAssetId == null) {
    return {};
  }

  return {
    representativeAssetId: bucket.representativeAssetId,
    representativeThumbhash: bucket.representativeThumbhash,
    representativeRatio: bucket.representativeRatio,
  };
}

export function mergeTimeBuckets(
  primary: TimeBucketsResponseDto[],
  secondary: TimeBucketsResponseDto[],
  order: AssetOrder = AssetOrder.Desc,
): TimeBucketsResponseDto[] {
  const merged = new Map<string, TimeBucketsResponseDto>();

  for (const bucket of primary) {
    merged.set(bucket.timeBucket, { ...bucket });
  }

  for (const bucket of secondary) {
    const existing = merged.get(bucket.timeBucket);
    merged.set(bucket.timeBucket, {
      timeBucket: bucket.timeBucket,
      count: (existing?.count ?? 0) + bucket.count,
      ...getRepresentativeMetadata(existing, bucket),
    });
  }

  return [...merged.values()].sort((a, b) =>
    order === AssetOrder.Asc ? a.timeBucket.localeCompare(b.timeBucket) : b.timeBucket.localeCompare(a.timeBucket),
  );
}

export function mergeTimeBucketAssets(
  primary: TimeBucketAssetResponseDto,
  secondary: TimeBucketAssetResponseDto,
): TimeBucketAssetResponseDto {
  const ids = new Set(primary.id);
  const keys = new Set([...Object.keys(primary), ...Object.keys(secondary)]);
  const merged = Object.fromEntries(
    [...keys].map((key) => {
      const values = (primary as Record<string, unknown[]>)[key];
      return [key, values ? [...values] : []];
    }),
  ) as Record<string, unknown[]>;

  for (let index = 0; index < secondary.id.length; index++) {
    const id = secondary.id[index];
    if (ids.has(id)) {
      continue;
    }

    ids.add(id);
    for (const key of keys) {
      const primaryValues = (primary as Record<string, unknown[]>)[key];
      const secondaryValues = (secondary as Record<string, unknown[]>)[key];
      const values = merged[key] ?? [];

      if (!primaryValues && secondaryValues) {
        while (values.length < primary.id.length) {
          values.push(null);
        }
      }

      values.push(secondaryValues ? (secondaryValues[index] ?? null) : null);
      merged[key] = values;
    }
  }

  return merged as TimeBucketAssetResponseDto;
}
