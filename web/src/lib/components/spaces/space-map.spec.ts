import { createFilterState } from '#lib/components/filter-panel/filter-panel.ts';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import SpaceMap from './space-map.svelte';

describe('SpaceMap', () => {
  it('links to /map with the spaceId when no filters are active', async () => {
    await render(SpaceMap, { spaceId: 'space-123', filters: createFilterState() });

    expect(page.getByRole('link', { name: 'map', exact: true }).element()).toHaveAttribute(
      'href',
      '/map?spaceId=space-123',
    );
  });

  // #767 / E10 — the link used to be a hard-coded `/map?spaceId=<id>`, so every filter and the
  // active search term were dropped on the way to the map.
  it('carries the space filters and the search query to the map', async () => {
    await render(SpaceMap, {
      spaceId: 'space-123',
      searchQuery: 'ski',
      filters: { ...createFilterState(), make: 'Apple', personIds: ['space-person:p1'] },
    });

    const href = page.getByRole('link', { name: 'map', exact: true }).element().getAttribute('href') ?? '';
    expect(href).toContain('spaceId=space-123');
    expect(href).toContain('q=ski');
    expect(href).toContain('make=Apple');
    expect(href).toContain('people=space-person%3Ap1');
  });
});
