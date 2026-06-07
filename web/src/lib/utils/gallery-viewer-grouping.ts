import type { AssetResponseDto } from '@immich/sdk';
import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
import type { ActivatableTimelineBucket } from '$lib/utils/timeline-zoom-navigation';

export type GalleryViewerBucket = ActivatableTimelineBucket & {
  viewId: string;
  timeBucket: string;
  count: number;
  representativeAssetId: string | null;
  representativeThumbhash: string | null;
  representativeRatio: number | null;
  assets: AssetResponseDto[];
};

export type GalleryViewerAssetDate = {
  year: number;
  month: number;
  day: number;
};

const galleryViewerDatePattern = /^(\d{4})-(\d{2})-(\d{2})(?:$|T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)$/;

export function getGalleryViewerAssetDate(asset: AssetResponseDto): GalleryViewerAssetDate | undefined {
  const value = asset.localDateTime || asset.fileCreatedAt;
  const match = value?.match(galleryViewerDatePattern);
  if (!match) {
    return;
  }

  const [, yearValue, monthValue, dayValue] = match;
  const [year, month, day] = [yearValue, monthValue, dayValue].map(Number);

  if (!year || !month || !day) {
    return;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return;
  }

  return { year, month, day };
}

export function buildGalleryViewerBuckets(
  assets: AssetResponseDto[],
  grouping: Exclude<TimelineGrouping, 'day'>,
): GalleryViewerBucket[] {
  const buckets = new Map<string, GalleryViewerBucket>();

  for (const asset of assets) {
    const date = getGalleryViewerAssetDate(asset);
    if (!date) {
      continue;
    }

    const key = grouping === 'year' ? `${date.year}` : `${date.year}-${String(date.month).padStart(2, '0')}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      existing.assets.push(asset);
      continue;
    }

    buckets.set(key, {
      viewId: `${grouping}:${key}`,
      timeBucket:
        grouping === 'year'
          ? `${date.year}-01-01T00:00:00.000Z`
          : `${date.year}-${String(date.month).padStart(2, '0')}-01T00:00:00.000Z`,
      grouping,
      date: grouping === 'year' ? { year: date.year } : { year: date.year, month: date.month },
      count: 1,
      representativeAssetId: asset.id,
      representativeThumbhash: asset.thumbhash ?? null,
      representativeRatio: asset.width && asset.height ? asset.width / asset.height : null,
      assets: [asset],
    });
  }

  return [...buckets.values()];
}
