import type { MockData } from '#test/common/data.ts';
import type { Handlers } from '#test/common/types.ts';
import { TimeBucketSize, type TimeBucketAssetResponseDto } from '@immich/sdk';

// Gallery's timeline groups by year, month or day (`bucketSize`); upstream's mock always groups by month. Month
// requests go straight to upstream's implementation; year and day buckets are built from its monthly answers.

const datePart = (iso: string) => iso.slice(0, 10);

const bucketKey = (iso: string, size: TimeBucketSize) => {
  const date = datePart(iso);
  if (size === TimeBucketSize.Year) {
    return `${date.slice(0, 4)}-01-01`;
  }
  if (size === TimeBucketSize.Month) {
    return `${date.slice(0, 7)}-01`;
  }
  return date;
};

const pick = (bucket: TimeBucketAssetResponseDto, keep: (index: number) => boolean): TimeBucketAssetResponseDto =>
  Object.fromEntries(
    Object.entries(bucket).map(([key, values]) => [
      key,
      Array.isArray(values) ? values.filter((_, index) => keep(index)) : values,
    ]),
  ) as TimeBucketAssetResponseDto;

const concat = (buckets: TimeBucketAssetResponseDto[]): TimeBucketAssetResponseDto => {
  const [first, ...rest] = buckets;
  const merged = structuredClone(first);
  for (const bucket of rest) {
    for (const [key, values] of Object.entries(bucket)) {
      if (Array.isArray(values)) {
        (merged as Record<string, unknown[]>)[key].push(...values);
      }
    }
  }
  return merged;
};

export const galleryTimeBucketHandlers = (data: MockData): Handlers => ({
  getTimeBuckets: ({ params = {} }) => {
    const size = params.bucketSize ?? TimeBucketSize.Month;
    if (size === TimeBucketSize.Month) {
      return { json: data.timeBuckets(params) };
    }
    const counts = new Map<string, number>();
    for (const asset of data.timelineAssets(params)) {
      const key = bucketKey(asset.fileCreatedAt, size);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return { json: Array.from(counts, ([key, count]) => ({ timeBucket: `${key}T00:00:00.000Z`, count })) };
  },

  getTimeBucket: ({ params }) => {
    const size = params.bucketSize ?? TimeBucketSize.Month;
    if (size === TimeBucketSize.Month) {
      return { json: data.timeBucket(params.timeBucket, params) };
    }
    const key = bucketKey(params.timeBucket, size);
    const months = [
      ...new Set(
        data
          .timelineAssets(params)
          .filter((asset) => bucketKey(asset.fileCreatedAt, size) === key)
          .map((asset) => bucketKey(asset.fileCreatedAt, TimeBucketSize.Month)),
      ),
    ];
    if (months.length === 0) {
      return { json: data.timeBucket(params.timeBucket, params) };
    }
    const bucket = concat(months.map((month) => data.timeBucket(`${month}T00:00:00.000Z`, params)));
    return { json: pick(bucket, (index) => bucketKey(bucket.fileCreatedAt[index], size) === key) };
  },

  // Representative cover per requested bucket: its first asset in the same filtered scope.
  getTimeBucketCovers: ({ params }) => {
    const size = params?.bucketSize ?? TimeBucketSize.Month;
    const requested = new Set((params?.timeBuckets ?? []).map((timeBucket) => bucketKey(timeBucket, size)));
    const covers = new Map<string, { id: string; ratio: number; thumbhash: string | null }>();
    for (const asset of data.timelineAssets(params)) {
      const key = bucketKey(asset.fileCreatedAt, size);
      if (requested.has(key) && !covers.has(key)) {
        covers.set(key, {
          id: asset.id,
          ratio: asset.width && asset.height ? asset.width / asset.height : 1,
          thumbhash: asset.thumbhash,
        });
      }
    }
    return {
      json: Array.from(covers, ([key, cover]) => ({
        timeBucket: `${key}T00:00:00.000Z`,
        representativeAssetId: cover.id,
        representativeRatio: cover.ratio,
        representativeThumbhash: cover.thumbhash,
      })),
    };
  },
});
