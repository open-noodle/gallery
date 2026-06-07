import { AssetTypeEnum, AssetVisibility, type AssetResponseDto } from '@immich/sdk';
import { buildGalleryViewerBuckets, getGalleryViewerAssetDate } from '../gallery-viewer-grouping';

function asset(id: string, localDateTime: string, overrides: Partial<AssetResponseDto> = {}): AssetResponseDto {
  return {
    id,
    ownerId: 'user-1',
    type: AssetTypeEnum.Image,
    originalFileName: `${id}.jpg`,
    visibility: AssetVisibility.Timeline,
    isFavorite: false,
    isTrashed: false,
    fileCreatedAt: localDateTime,
    localDateTime,
    thumbhash: `${id}-thumbhash`,
    width: 1600,
    height: 900,
    ...overrides,
  } as AssetResponseDto;
}

describe('gallery viewer grouping helpers', () => {
  it('reads localDateTime before fileCreatedAt for bucket dates', () => {
    const result = getGalleryViewerAssetDate(
      asset('asset-1', '2015-12-31T23:30:00.000Z', { fileCreatedAt: '2016-01-01T00:30:00.000Z' }),
    );

    expect(result).toEqual({ year: 2015, month: 12, day: 31 });
  });

  it('falls back to fileCreatedAt when localDateTime is missing', () => {
    const result = getGalleryViewerAssetDate(
      asset('asset-1', '2015-01-01T00:00:00.000Z', {
        localDateTime: undefined as unknown as string,
        fileCreatedAt: '2016-02-29T10:00:00.000Z',
      }),
    );

    expect(result).toEqual({ year: 2016, month: 2, day: 29 });
  });

  it('rejects malformed and out-of-range bucket dates', () => {
    expect(getGalleryViewerAssetDate(asset('malformed', 'not-a-date'))).toBeUndefined();
    expect(getGalleryViewerAssetDate(asset('bad-month', '2024-99-01T00:00:00.000Z'))).toBeUndefined();
    expect(getGalleryViewerAssetDate(asset('bad-day', '2024-02-30T00:00:00.000Z'))).toBeUndefined();
    expect(getGalleryViewerAssetDate(asset('prefixed-junk', '2024-02-29not-a-date'))).toBeUndefined();
    expect(getGalleryViewerAssetDate(asset('bad-timestamp', '2024-02-29Tbad'))).toBeUndefined();
  });

  it('builds year buckets from loaded assets and uses the first asset as representative', () => {
    const buckets = buildGalleryViewerBuckets(
      [
        asset('asset-2016-a', '2016-01-02T00:00:00.000Z'),
        asset('asset-2015-a', '2015-08-03T00:00:00.000Z'),
        asset('asset-2015-b', '2015-01-01T00:00:00.000Z'),
      ],
      'year',
    );

    expect(buckets).toEqual([
      expect.objectContaining({
        viewId: 'year:2016',
        timeBucket: '2016-01-01T00:00:00.000Z',
        grouping: 'year',
        date: { year: 2016 },
        count: 1,
        representativeAssetId: 'asset-2016-a',
        representativeThumbhash: 'asset-2016-a-thumbhash',
        representativeRatio: 1600 / 900,
      }),
      expect.objectContaining({
        viewId: 'year:2015',
        timeBucket: '2015-01-01T00:00:00.000Z',
        grouping: 'year',
        date: { year: 2015 },
        count: 2,
        representativeAssetId: 'asset-2015-a',
      }),
    ]);
  });

  it('builds month buckets from loaded assets while preserving first-seen bucket order', () => {
    const buckets = buildGalleryViewerBuckets(
      [
        asset('aug-a', '2015-08-03T00:00:00.000Z'),
        asset('jan-a', '2015-01-01T00:00:00.000Z'),
        asset('aug-b', '2015-08-04T00:00:00.000Z'),
      ],
      'month',
    );

    expect(buckets.map((bucket) => [bucket.viewId, bucket.count, bucket.representativeAssetId])).toEqual([
      ['month:2015-08', 2, 'aug-a'],
      ['month:2015-01', 1, 'jan-a'],
    ]);
  });

  it('skips assets with invalid dates when building buckets', () => {
    const buckets = buildGalleryViewerBuckets(
      [
        asset('valid', '2024-02-29T00:00:00.000Z'),
        asset('bad-month', '2024-99-01T00:00:00.000Z'),
        asset('bad-day', '2024-02-30T00:00:00.000Z'),
      ],
      'month',
    );

    expect(buckets.map((bucket) => [bucket.viewId, bucket.count, bucket.representativeAssetId])).toEqual([
      ['month:2024-02', 1, 'valid'],
    ]);
  });
});
