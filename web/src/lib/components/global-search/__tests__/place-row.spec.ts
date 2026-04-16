import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import PlaceRow from '../rows/place-row.svelte';

describe('place-row', () => {
  it('renders the place name and admin subtitle', () => {
    render(PlaceRow, {
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
    expect(screen.getByText('Santa Cruz')).toBeInTheDocument();
    expect(screen.getByText(/California/)).toBeInTheDocument();
  });

  it('renders without subtitle when admin fields are missing', () => {
    render(PlaceRow, {
      props: { item: { name: 'Somewhere', latitude: 0, longitude: 0 } },
    });
    expect(screen.getByText('Somewhere')).toBeInTheDocument();
  });

  it('does NOT set role="option"', () => {
    const { container } = render(PlaceRow, {
      props: { item: { name: 'X', latitude: 0, longitude: 0 } },
    });
    expect(container.querySelector('[role="option"]')).toBeNull();
  });
});
