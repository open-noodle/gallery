import { get } from 'svelte/store';
import { SortOrder } from '$lib/stores/preferences.store';
import { SpaceSortBy, spaceViewSettings } from '$lib/stores/space-view.store';

describe('space-view store', () => {
  beforeEach(() => {
    localStorage.clear();
    spaceViewSettings.reset();
  });

  it('should default viewMode to card', () => {
    expect(get(spaceViewSettings).viewMode).toBe('card');
  });

  it('should default sortBy to LastActivity', () => {
    expect(get(spaceViewSettings).sortBy).toBe(SpaceSortBy.LastActivity);
  });

  it('should default sortOrder to Desc', () => {
    expect(get(spaceViewSettings).sortOrder).toBe(SortOrder.Desc);
  });
});
