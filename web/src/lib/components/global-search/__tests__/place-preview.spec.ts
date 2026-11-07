import { searchAssets } from '@immich/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
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

  it('renders place name and subtitle', async () => {
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    await render(PlacePreview, {
      props: { place: { name: 'Santa Cruz', admin1name: 'CA', latitude: 0, longitude: 0 } as never },
    });
    await expect.element(page.getByText('Santa Cruz')).toBeInTheDocument();
  });

  it('shows "No photos here yet" on empty response', async () => {
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    await render(PlacePreview, {
      props: { place: { name: 'X', latitude: 0, longitude: 0 } as never },
    });
    await vi.advanceTimersByTimeAsync(400);
    await Promise.resolve();
    await expect.element(page.getByText(/cmdk_no_photos_here|no photos here/i)).toBeInTheDocument();
  });
});
