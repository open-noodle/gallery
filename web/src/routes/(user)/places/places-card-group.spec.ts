import TestWrapper from '#lib/components/TestWrapper.svelte';
import { factory } from '#test/unit/factories.ts';
import type { Component } from 'svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import PlacesCardGroup from './PlacesCardGroup.svelte';

// eslint-disable-next-line unicorn/no-unnecessary-parameters
function renderGroup(city: string, country?: string | null) {
  const props = { places: [factory.asset({ id: 'asset-1', exifInfo: { city, country } })] };

  return render(TestWrapper as Component<{ component: typeof PlacesCardGroup; componentProps: typeof props }>, {
    component: PlacesCardGroup,
    componentProps: props,
  });
}

describe('PlacesCardGroup', () => {
  // #867: same reasoning as the Explore strip — /search cannot surface shared-space assets, the
  // filtered /photos timeline can.
  it('links a place card to the photos timeline filtered by that city', async () => {
    await renderGroup('Cape Town');

    await expect
      .element(page.getByRole('link', { name: /Cape Town/ }))
      .toHaveAttribute('href', '/photos?city=Cape%20Town');
  });

  // #989: the card linked with `city` alone, so the location filter rendered the city flat beside
  // the countries instead of nested under one. /places already knows the country — it is what the
  // enclosing group is keyed on.
  it('scopes a place card to the country of that place', async () => {
    await renderGroup('Cape Town', 'South Africa');

    await expect
      .element(page.getByRole('link', { name: /Cape Town/ }))
      .toHaveAttribute('href', '/photos?city=Cape%20Town&country=South%20Africa');
  });

  it('falls back to a city-only link when the place has no country', async () => {
    await renderGroup('Cape Town', null);

    await expect
      .element(page.getByRole('link', { name: /Cape Town/ }))
      .toHaveAttribute('href', '/photos?city=Cape%20Town');
  });
});
