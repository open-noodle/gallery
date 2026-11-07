import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import PlaceRow from '../rows/place-row.svelte';

describe('place-row', () => {
  it('renders the place name and admin subtitle', async () => {
    await render(PlaceRow, {
      props: {
        item: {
          name: 'Santa Cruz',
          admin1name: 'California',
          admin2name: 'Santa Cruz County',
          latitude: 36.97,
          longitude: -122.03,
        },
      },
    });
    await expect.element(page.getByText('Santa Cruz')).toBeInTheDocument();
    await expect.element(page.getByText(/California/)).toBeInTheDocument();
  });

  it('renders without subtitle when admin fields are missing', async () => {
    await render(PlaceRow, {
      props: { item: { name: 'Somewhere', latitude: 0, longitude: 0 } },
    });
    await expect.element(page.getByText('Somewhere')).toBeInTheDocument();
  });

  it('does NOT set role="option"', async () => {
    const { container } = await render(PlaceRow, {
      props: { item: { name: 'X', latitude: 0, longitude: 0 } },
    });
    expect(container.querySelector('[role="option"]')).toBeNull();
  });
});
