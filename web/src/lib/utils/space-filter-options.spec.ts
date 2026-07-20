import { AssetOrder } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import { buildAlbumAssetPickerOptions, buildAlbumTimelineOptions } from '$lib/utils/album-filter-options';
import { buildMapTimelineOptions } from '$lib/utils/map-filter-options';
import { buildSpaceTimelineOptions } from '$lib/utils/space-filter-options';

describe('space vs album timeline options — stack collapse (#751)', () => {
  it('space timeline requests stack collapse (withStacked: true) (E24)', () => {
    const options = buildSpaceTimelineOptions('space-1', createFilterState());

    expect(options.spaceId).toBe('space-1');
    expect(options.withStacked).toBe(true);
  });

  it('space-album detail does NOT collapse stacks (no withStacked) (E25)', () => {
    const options = buildAlbumTimelineOptions('album-1', AssetOrder.Desc, createFilterState());

    expect(options.withStacked).toBeUndefined();
  });
});

describe('album asset picker options — favorites compose with cross-user scopes (#763 slice 4)', () => {
  it('an active favorite filter no longer suppresses partner scope', () => {
    const options = buildAlbumAssetPickerOptions('album-1', { ...createFilterState(), isFavorite: true });

    expect(options.isFavorite).toBe(true);
    expect(options.withPartners).toBe(true);
  });
});

describe('map timeline options — favorites compose with cross-user scopes (#763 slice 4)', () => {
  it('an active favorite filter no longer suppresses partner scope when the withPartners setting is on', () => {
    const selectedClusterIds = new Set(['asset-1']);
    const options = buildMapTimelineOptions(
      { ...createFilterState(), isFavorite: true },
      '1,2,3,4',
      selectedClusterIds,
      undefined,
      { withPartners: true },
    );

    expect(options.isFavorite).toBe(true);
    expect(options.withPartners).toBe(true);
  });
});
