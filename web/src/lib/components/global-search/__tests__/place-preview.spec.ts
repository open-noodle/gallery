import { searchAssets } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlacePreview from '../previews/place-preview.svelte';

vi.mock('@immich/sdk', async () => {
  const actual = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return { ...actual, searchAssets: vi.fn() };
});

describe('place-preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders place name and subtitle', () => {
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    render(PlacePreview, {
      props: { place: { name: 'Santa Cruz', admin1name: 'CA', latitude: 0, longitude: 0 } as never },
    });
    expect(screen.getByText('Santa Cruz')).toBeInTheDocument();
  });

  it('shows "No photos here yet" on empty response', async () => {
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    render(PlacePreview, {
      props: { place: { name: 'X', latitude: 0, longitude: 0 } as never },
    });
    await vi.advanceTimersByTimeAsync(400);
    await Promise.resolve();
    expect(screen.getByText(/cmdk_no_photos_here|no photos here/i)).toBeInTheDocument();
  });
});
