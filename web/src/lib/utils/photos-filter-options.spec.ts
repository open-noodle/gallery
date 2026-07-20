import { describe, expect, it } from 'vitest';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import { buildPhotosTimelineOptions } from '$lib/utils/photos-filter-options';

describe('photos timeline options — favorites compose with cross-user scopes (#763 slice 4)', () => {
  it('an active favorite filter no longer suppresses partner/space scope', () => {
    const options = buildPhotosTimelineOptions({ ...createFilterState(), isFavorite: true });
    expect(options.isFavorite).toBe(true);
    expect(options.withSharedSpaces).toBe(true);
    expect(options.withPartners).toBe(true);
  });

  it('isFavorite: false also keeps both scopes (the old mirror keyed on undefined)', () => {
    const options = buildPhotosTimelineOptions({ ...createFilterState(), isFavorite: false });
    expect(options.isFavorite).toBe(false);
    expect(options.withSharedSpaces).toBe(true);
    expect(options.withPartners).toBe(true);
  });

  it('no favorite filter: scopes unchanged (regression)', () => {
    const options = buildPhotosTimelineOptions(createFilterState());
    expect(options.isFavorite).toBeUndefined();
    expect(options.withSharedSpaces).toBe(true);
    expect(options.withPartners).toBe(true);
  });
});
