import { render, screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import AlbumPreview from './album-preview.svelte';

vi.mock('@immich/ui', async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  IconButton: vi.fn(() => ({ $$typeof: Symbol.for('svelte.component') })),
}));

describe('AlbumPreview', () => {
  beforeAll(async () => {
    // Load the real en bundle so `$t('cmdk_preview_item_count', { values: { count } })`
    // resolves to English ICU output ("1 item" / "2 items") instead of the raw key.
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  it('metadata line renders with date range', () => {
    render(AlbumPreview, {
      props: {
        item: {
          id: 'a1',
          albumName: 'Hawaii',
          assetCount: 87,
          shared: false,
          albumThumbnailAssetId: 't',
          startDate: '2024-03-01',
          endDate: '2026-03-01',
        },
      } as never,
    });
    // Assert both item count and date range appear
    expect(screen.getByText(/87 items/)).toBeInTheDocument();
    expect(screen.getByText(/2024/)).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it('metadata line omits date range when startDate missing', () => {
    render(AlbumPreview, {
      props: {
        item: {
          id: 'a1',
          albumName: 'x',
          assetCount: 3,
          shared: false,
          albumThumbnailAssetId: null,
          endDate: undefined,
          startDate: undefined,
        },
      } as never,
    });
    expect(screen.getByText('3 items')).toBeInTheDocument();
  });

  it('null thumbnail renders placeholder icon', () => {
    const { container } = render(AlbumPreview, {
      props: {
        item: { id: 'a1', albumName: 'x', assetCount: 0, shared: false, albumThumbnailAssetId: null },
      } as never,
    });
    expect(container.querySelector('[data-testid="album-preview-placeholder"]')).toBeInTheDocument();
  });

  it('renders "Shared" pill when shared=true', () => {
    render(AlbumPreview, {
      props: {
        item: { id: 'a1', albumName: 'x', assetCount: 1, shared: true, albumThumbnailAssetId: 't' },
      } as never,
    });
    expect(screen.getByText(/shared/i)).toBeInTheDocument();
  });

  it('ICU plural: "1 item" vs "2 items"', () => {
    const { unmount } = render(AlbumPreview, {
      props: {
        item: { id: 'a1', albumName: 'x', assetCount: 1, shared: false, albumThumbnailAssetId: null },
      } as never,
    });
    expect(screen.getByText(/1 item\b/)).toBeInTheDocument();
    unmount();
    render(AlbumPreview, {
      props: {
        item: { id: 'a1', albumName: 'x', assetCount: 2, shared: false, albumThumbnailAssetId: null },
      } as never,
    });
    expect(screen.getByText(/2 items/)).toBeInTheDocument();
  });
});
