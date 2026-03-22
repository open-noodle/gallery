import { clearFilters, createFilterState, getActiveFilterCount } from '../filter-panel';

describe('FilterState utilities', () => {
  it('should create default state', () => {
    const state = createFilterState();
    expect(state.personIds).toEqual([]);
    expect(state.tagIds).toEqual([]);
    expect(state.mediaType).toBe('all');
    expect(state.sortOrder).toBe('desc');
    expect(state.city).toBeUndefined();
    expect(state.rating).toBeUndefined();
  });

  it('should count active filters', () => {
    const state = createFilterState();
    expect(getActiveFilterCount(state)).toBe(0);

    state.personIds = ['p1'];
    expect(getActiveFilterCount(state)).toBe(1);

    state.city = 'Munich';
    expect(getActiveFilterCount(state)).toBe(2);

    state.rating = 3;
    expect(getActiveFilterCount(state)).toBe(3);
  });

  it('should not double-count country when city is set', () => {
    const state = createFilterState();
    state.country = 'Germany';
    state.city = 'Munich';
    // country + city should count as 1, not 2
    expect(getActiveFilterCount(state)).toBe(1);
  });

  it('should clear filters but preserve sortOrder', () => {
    const state = createFilterState();
    state.personIds = ['p1'];
    state.city = 'Munich';
    state.rating = 3;
    state.sortOrder = 'asc';

    const cleared = clearFilters(state);
    expect(cleared.personIds).toEqual([]);
    expect(cleared.city).toBeUndefined();
    expect(cleared.rating).toBeUndefined();
    expect(cleared.sortOrder).toBe('asc'); // preserved!
    expect(cleared.mediaType).toBe('all');
  });
});
