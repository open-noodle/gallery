import { AssetOrder } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import { buildAlbumTimelineOptions } from '$lib/utils/album-filter-options';
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
