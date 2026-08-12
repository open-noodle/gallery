import { render, screen } from '@testing-library/svelte';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import SpaceMap from './space-map.svelte';

describe('SpaceMap', () => {
  it('links to /map with the spaceId when no filters are active', () => {
    render(SpaceMap, { spaceId: 'space-123', filters: createFilterState() });

    expect(screen.getByRole('link', { name: 'map' })).toHaveAttribute('href', '/map?spaceId=space-123');
  });

  // #767 / E10 — the link used to be a hard-coded `/map?spaceId=<id>`, so every filter and the
  // active search term were dropped on the way to the map.
  it('carries the space filters and the search query to the map', () => {
    render(SpaceMap, {
      spaceId: 'space-123',
      searchQuery: 'ski',
      filters: { ...createFilterState(), make: 'Apple', personIds: ['space-person:p1'] },
    });

    const href = screen.getByRole('link', { name: 'map' }).getAttribute('href') ?? '';
    expect(href).toContain('spaceId=space-123');
    expect(href).toContain('q=ski');
    expect(href).toContain('make=Apple');
    expect(href).toContain('people=space-person%3Ap1');
  });
});
